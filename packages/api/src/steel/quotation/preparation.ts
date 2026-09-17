import { createHash } from 'node:crypto';
import mongoose from 'mongoose';

import type { ISteelQuotationState, SteelQuotationPendingMessageFile, SteelQuotationScope } from '@librechat/data-schemas';
import type { SteelToolJsonObject, SteelToolJsonValue, SteelToolResult } from '../tools/results';

import { createSteelOcrStateService } from '../ocr/state';
import { parseAssistantMarkdown, parseOcrResultTable } from '../ocr/result';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { createSteelQuotationStateService } from './state';
import { quotationSignal } from './protocol';

export function isUnfinishedQuotation(status?: string): boolean {
  return status !== undefined && status !== 'completed' && status !== 'cancelled';
}

export function hasQuotationOrder(markdown?: string): boolean {
  if (!markdown) return false;
  const sections = parseAssistantMarkdown(markdown).sections.filter((section) => section.title === 'ocr_result');
  if (sections.length !== 1) return false;
  const result = parseOcrResultTable(sections[0].body);
  return result.ok && result.table.rows.length > 0 &&
    ['來源', '零件編號', '類別'].every((header) => result.table.headers.includes(header));
}

export async function prepareQuotationTurn(input: {
  scope: SteelQuotationScope;
  messageId: string;
  responseId: string;
  text: string;
  files?: readonly SteelQuotationPendingMessageFile[];
}): Promise<{ scope: SteelQuotationScope; state: ISteelQuotationState; instruction: string; resume: boolean }> {
  const service = createSteelQuotationStateService(mongoose);
  let state = await service.ensureState(input.scope);
  const unpublished = state.activeRun?.status === 'completed' &&
    !await service.getArtifact({ scope: input.scope, runId: state.activeRun.runId, operationId: 'published' });
  if (isUnfinishedQuotation(state.activeRun?.status) || unpublished || state.pendingMessages.some((entry) => entry.status !== 'completed')) {
    if (input.messageId !== state.activeRun?.triggerMessageId) {
      await service.enqueuePendingMessage({
        scope: input.scope,
        sourceMessageId: input.messageId,
        sourceMessageText: input.text,
        sourceMessageFiles: input.files,
        targetMessageId: input.responseId,
      });
    }
    return { scope: input.scope, state, instruction: '', resume: true };
  }
  const ocr = await createSteelOcrStateService(mongoose)
    .readConversationOcrState(input.scope.conversationId);
  const markdown = ocr?.currentOcrResultMarkdown;
  if (markdown) {
    state = await service.setOrder({
      scope: input.scope,
      fullMarkdown: markdown,
      revision: ocr.currentOcrResultGenerationId,
      messageId: ocr.currentOcrResultMessageId,
    });
  }
  return {
    scope: input.scope,
    state,
    resume: false,
    instruction: quotationPreparationInstruction(hasQuotationOrder(state.currentOrder?.markdown)
      ? state.currentOrder?.markdown : undefined),
  };
}

export function quotationPreparationInstruction(order?: string): string {
  return [
    '# Current quotation preparation workflow',
    'Before quoting, present one complete ## ocr_result table for the user to confirm. Text orders use the same complete table; use stable 來源=文字訂單 and stable 零件編號 for new text rows.',
    'The ocr_result table must contain 來源, 零件編號, 類別, and the available specification/quantity fields. Preserve existing columns and all user-provided material, size, unit, quantity, and notes; leave unknown facts blank. Keep dimensions in explicitly labeled mm columns where applicable.',
    'Apply corrections or explicit deletions to the whole order and output the full new ocr_result. Never quote in that response; wait for the user to confirm quotation of the displayed revision.',
    order ? `For an explicit deletion only, also emit ## ocr_deletions with columns order_hash, 來源, 零件編號 listing exactly the deleted prior rows. Use order_hash=${quotationFingerprint(order)}. Never use omission alone to delete rows.` : '',
    'Do not call search_customers before a saved ocr_result exists. Only call it when the user confirms the current order and requests quotation.',
    'If multiple customer matches are returned, ask the user to choose and do not output customer_data or quote_signal. After the user chooses, search the exact selected customer again to resolve the selection.',
    'After a unique match or successful no-match search, copy the tool-provided customerDataMarkdown and quoteSignal exactly in the same response, then finish. No-match explicitly uses default B. A tool error is not no-match.',
    'Use exactly ## quote_signal followed by a blank line and start; include no index or token. Never invent customer identity. Do not call search_price_candidates, calculate or output system_order/customer_quote, or output a quotation completion summary in this preparation response.',
    'A saved order is not confirmation by itself. Never reuse confirmation after a correction, and never emit a signal if this response contains ocr_result.',
    order ? `# Saved complete order\n${order}` : '# No saved order exists. Prepare the complete ocr_result first.',
  ].join('\n\n');
}

function object(value: SteelToolJsonValue | undefined): SteelToolJsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function cell(value: SteelToolJsonValue | undefined): string {
  return typeof value === 'string' || typeof value === 'number'
    ? escapeMarkdownTableCell(String(value)) : '';
}

export async function bindQuotationCustomerResult(input: {
  scope: SteelQuotationScope;
  messageId: string;
  responseId: string;
  result: SteelToolResult;
}): Promise<SteelToolResult> {
  const service = createSteelQuotationStateService(mongoose);
  await service.clearCustomer({ scope: input.scope, responseId: input.responseId });
  if (!input.result.ok) {
    return input.result;
  }
  const state = await service.readState(input.scope);
  if (!state?.currentOrder || !hasQuotationOrder(state.currentOrder.markdown) ||
    isUnfinishedQuotation(state.activeRun?.status)) {
    throw new Error('Customer lookup requires a saved order and no unfinished quotation');
  }
  const customers = input.result.data.customers;
  if (!Array.isArray(customers)) {
    throw new Error('Customer lookup returned an invalid customer list');
  }
  if (customers.length > 1) {
    return {
      ...input.result,
      data: { ...input.result.data, quotationSelectionRequired: true },
    };
  }
  const customer = customers.length === 1 ? object(customers[0]) : undefined;
  if (customers.length === 1 && (!customer || typeof customer.id !== 'number')) {
    throw new Error('Customer lookup returned an invalid identity');
  }
  const tier = typeof customer?.customerTier === 'string' && /^[A-F]$/.test(customer.customerTier)
    ? customer.customerTier : 'B';
  const identity = customer ? String(customer.id) : 'no-match:default-B';
  const markdown = [
    '## customer_data',
    '',
    '| 客戶編號 | 客戶名稱 | 價格等級 | 說明 |',
    '| --- | --- | --- | --- |',
    `| ${cell(customer?.erpCustomerCode)} | ${customer ? cell(customer.displayName) : '查無客戶'} | ${tier} | ${!customer || !/^[A-F]$/.test(String(customer.customerTier)) ? '使用預設 B tier' : ''} |`,
  ].join('\n');
  await service.saveCustomer({
    scope: input.scope,
    customerMarkdown: markdown,
    customerIdentity: identity,
    responseId: input.responseId,
    orderHash: state.currentOrder.sha256,
    triggeringMessageId: input.messageId,
    selectionProvenance: {
      method: customer ? 'unique' : 'default_tier',
      lookupMessageId: input.messageId,
      selectedCustomerId: customer ? identity : undefined,
    },
  });
  return {
    ...input.result,
    data: {
      ...input.result.data,
      customerDataMarkdown: markdown,
      quoteSignal: renderQuotationSignal(),
    },
  };
}

export function renderQuotationSignal(): string {
  return quotationSignal;
}

export function quotationFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
