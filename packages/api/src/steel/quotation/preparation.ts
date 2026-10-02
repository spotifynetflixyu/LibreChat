import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import type { ISteelQuotationState, SteelQuotationPendingMessageFile, SteelQuotationScope } from '@librechat/data-schemas';
import type { SteelToolJsonObject, SteelToolJsonValue, SteelToolResult } from '../tools/results';
import { createSystemOrderRevisionService, formatSystemOrderRevisionInstruction, isCurrentSystemOrderRun } from './revision';
import { parseAssistantMarkdown, parseOcrResultTable } from '../ocr/result';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { createSteelQuotationStateService } from './state';
import { createSteelOcrStateService } from '../ocr/state';
import { quotationSignal } from './protocol';

export type QuotationCustomerTier = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type QuotationTierSelection =
  | { status: 'selected'; tier: QuotationCustomerTier }
  | { status: 'none' }
  | { status: 'invalid'; reason: 'ambiguous' | 'unrelated' };

const tierCommandPattern = /(?:用|使用|採用|改用|選擇|選定|指定|設定|設為|預設|\b(?:use|set|select|choose|tier)\b)\s*(?:(?:預設|default)\s*)?(?:tier\s*)?([A-F])(?=\s*(?:級|tier)|$|\s|[，,。.!！?？;；、/]|和|與|或|and\b|or\b)/giu;
const tierSuffixPattern = /([A-F])\s*級/giu;

export function parseQuotationTierSelection(messageText?: string): QuotationTierSelection {
  const text = messageText?.trim() ?? '';
  if (!text) return { status: 'none' };
  if (/^[A-F]$/iu.test(text)) {
    return { status: 'selected', tier: text.toUpperCase() as QuotationCustomerTier };
  }
  const standaloneTier = text.match(/^(?:預設\s*)?([A-F])\s*(?:級|tier)(?:\s*(?:進行報價|報價|quote))?$/iu)?.[1];
  if (standaloneTier) {
    return { status: 'selected', tier: standaloneTier.toUpperCase() as QuotationCustomerTier };
  }

  const commandMatches: Array<{ end: number; tier: QuotationCustomerTier }> = [];
  for (const match of text.matchAll(tierCommandPattern)) {
    const tier = match[1]?.toUpperCase() as QuotationCustomerTier | undefined;
    const end = (match.index ?? 0) + match[0].length;
    const following = text.slice(end);
    const tierEvidence = /\btier\b|預設|\bdefault\b/iu.test(match[0]) ||
      /^\s*(?:級|tier\b)/iu.test(following) ||
      /^\s*(?:and\b|or\b|和|與|或|、|,|，|\/)\s*[A-F]\s*(?:級|tier\b)/iu.test(following);
    if (tier && tierEvidence) commandMatches.push({ end, tier });
  }
  const suffixMatches = [...text.matchAll(tierSuffixPattern)].map((match) => ({
    index: match.index ?? 0,
    tier: match[1]!.toUpperCase() as QuotationCustomerTier,
  }));
  const suffixTiers = new Set(suffixMatches.map(({ tier }) => tier));
  const firstCommand = commandMatches[0];
  const alternativeTier = firstCommand && /^\s*(?:級|tier)?\s*(?:and\b|or\b|和|與|或|、|,|，|\/)\s*(?:tier\s*)?[A-F](?=\s*(?:級|tier)|\b|$)/iu.test(text.slice(firstCommand.end));
  if (suffixMatches.length > 1 || suffixTiers.size > 1 || commandMatches.length > 1 || alternativeTier) {
    return { status: 'invalid', reason: 'ambiguous' };
  }
  const commandTier = commandMatches[0]?.tier;
  const suffixTier = suffixMatches[0]?.tier;
  if (commandTier && suffixTier && commandTier !== suffixTier) {
    return { status: 'invalid', reason: 'ambiguous' };
  }
  if (commandTier) return { status: 'selected', tier: commandTier };
  if (suffixTier && /^(?:[A-Fa-f]\s*級|預設\s*[A-Fa-f]\s*級)(?:\s*(?:報價|quote))?$/iu.test(text)) {
    return { status: 'selected', tier: suffixTier };
  }
  if (suffixTier) return { status: 'invalid', reason: 'unrelated' };
  if (/\btier\s*[A-Za-z]\b|(?:用|使用|採用|改用|選擇|選定|指定|設定|設為|預設)\s*[A-Za-z]\s*級/iu.test(text)) {
    return { status: 'invalid', reason: 'unrelated' };
  }
  return { status: 'none' };
}

export function renderQuotationCustomerMarkdown(input: {
  tier: QuotationCustomerTier;
  customerCode?: string;
  customerName?: string;
  description?: string;
}): string {
  const customerName = input.customerName?.trim() || '未指定客戶';
  const description = input.description ?? (customerName === '未指定客戶'
    ? `用戶指定預設 ${input.tier} tier`
    : '');
  return [
    '## customer_data',
    '',
    '| 客戶編號 | 客戶名稱 | 價格等級 | 說明 |',
    '| --- | --- | --- | --- |',
    `| ${cell(input.customerCode)} | ${cell(customerName)} | ${input.tier} | ${cell(description)} |`,
  ].join('\n');
}

export const defaultQuotationCustomerMarkdown: string = renderQuotationCustomerMarkdown({ tier: 'B' });

export function quotationPreparationStatus(order?: string, customer?: string, hasSystemOrder = false): {
  hasOcrResult: boolean;
  hasCustomerData: boolean;
  hasSystemOrder: boolean;
  shouldAskToQuote: boolean;
} {
  const hasOcrResult = hasQuotationOrder(order);
  const hasCustomerData = Boolean(customer?.trim());
  return {
    hasOcrResult,
    hasCustomerData,
    hasSystemOrder,
    shouldAskToQuote: hasOcrResult && hasCustomerData && !hasSystemOrder,
  };
}

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
}): Promise<{
  scope: SteelQuotationScope;
  state: ISteelQuotationState;
  instruction: string;
  resume: boolean;
  messageText: string;
  messageFiles?: readonly SteelQuotationPendingMessageFile[];
}> {
  const service = createSteelQuotationStateService(mongoose);
  let state = await service.ensureState(input.scope);
  const originalMessage = {
    messageText: input.text,
    ...(input.files ? { messageFiles: input.files } : {}),
  };
  if (isUnfinishedQuotation(state.activeRun?.status)) {
    return {
      scope: input.scope,
      state,
      resume: false,
      instruction: quotationPreparationInstruction(
        state.currentOrder?.markdown,
        state.currentCustomer?.customerMarkdown,
        false,
      ),
      ...originalMessage,
    };
  }
  const unpublished = state.activeRun?.status === 'completed' &&
    !await service.getArtifact({ scope: input.scope, runId: state.activeRun.runId, operationId: 'published' });
  if (unpublished || state.pendingMessages.some((entry) => entry.status !== 'completed')) {
    if (input.messageId !== state.activeRun?.triggerMessageId) {
      await service.enqueuePendingMessage({
        scope: input.scope,
        sourceMessageId: input.messageId,
        sourceMessageText: input.text,
        sourceMessageFiles: input.files,
        targetMessageId: input.responseId,
        preserveExistingTarget: true,
      });
    }
    return { scope: input.scope, state, instruction: '', resume: true, ...originalMessage };
  }
  const [ocr, hasSavedSystemOrder] = await Promise.all([
    createSteelOcrStateService(mongoose).readConversationOcrState(input.scope.conversationId),
    service.hasSystemOrder(input.scope),
  ]);
  const markdown = ocr?.currentOcrResultMarkdown;
  if (markdown) {
    state = await service.setOrder({
      scope: input.scope,
      fullMarkdown: markdown,
      revision: ocr.currentOcrResultGenerationId,
      messageId: ocr.currentOcrResultMessageId,
    });
  }
  const hasSystemOrder = hasSavedSystemOrder && isCurrentSystemOrderRun(state);
  const currentSystemOrder = hasSystemOrder
    ? await createSystemOrderRevisionService({
        read: service.readState,
        readCurrentSystemOrder: service.readCurrentSystemOrder,
        readCheckpoint: service.readCheckpoint,
        saveCurrentSystemOrder: service.saveCurrentSystemOrder,
      }).readCurrentSystemOrder(input.scope, state)
    : undefined;
  return {
    scope: input.scope,
    state,
    resume: false,
    ...originalMessage,
    instruction: [
      quotationPreparationInstruction(
        state.currentOrder?.markdown, state.currentCustomer?.customerMarkdown, hasSystemOrder,
      ),
      currentSystemOrder ? formatSystemOrderRevisionInstruction(currentSystemOrder) : '',
    ].filter(Boolean).join('\n\n'),
  };
}

export function quotationPreparationInstruction(
  order?: string,
  customer?: string,
  hasSystemOrder = false,
): string {
  const status = quotationPreparationStatus(order, customer, hasSystemOrder);
  return [
    '# Saved quotation state for this turn',
    JSON.stringify(status),
    'These flags report saved data, not user consent. hasSystemOrder is true only for the latest accepted quotation whose run is completed and whose full final result is saved and whose accepted order and customer/tier still match the saved complete order and customer data. A completed result may belong to a previous user turn. Earlier archived results do not make this flag true if the latest accepted quotation is unfinished, interrupted, or cancelled. Do not ask whether to start quoting or emit a next-step template asking the user to reply 報價 or quote. hasSystemOrder describes saved quotation state, not whether the current request has been fulfilled. An explicit current request to quote, requote, or resubmit the unchanged confirmed order and customer/tier is fresh start consent even when hasSystemOrder=true. Treat 報價 and the English word quote case-insensitively as quotation intent. Ordinary inquiries about an old quotation do not authorize a new quote_signal. Do not resume or start a run in the AI response.',
    '# Current quotation preparation workflow',
    'For a new order with no saved ocr_result, output one complete ## ocr_result table for the user to confirm. The general agent directly handles textual corrections to a saved order. Output only changed or added rows in one ## ocr_result_updates table. Do not delegate OCR unless the original attachment must be read again. Never output both titles or duplicate update sections yourself. Reuse an unchanged saved order rather than presenting it again on every turn. Text orders use the same complete table; use stable 來源=文字訂單 and stable 零件編號 for new text rows.',
    'The ocr_result table must contain 來源, 零件編號, 類別, and the available specification/quantity fields. Preserve existing columns and all user-provided material, size, unit, quantity, and notes; leave unknown facts blank. Keep dimensions in explicitly labeled mm columns where applicable.',
    'For corrections, reuse the saved column names and order and output each changed or added row with all columns, preserving its unchanged values. Omit unchanged rows. Preserve the existing 來源 and 零件編號 values. Never change these identifiers to locate a different row, or blank an unchanged cell. If an identity has multiple independent rows, include the whole group with all its columns and distinguishing values, never a partial group. Explicit deletions require ocr_deletions; omission is not deletion. A deletion-only delta contains the existing columns under ocr_result_updates with header and separator without data rows. Never quote in that response; wait for the user to confirm quotation of the revised order.',
    order ? `For an explicit deletion only, also emit ## ocr_deletions with columns order_hash, 來源, 零件編號 listing exactly the deleted prior rows. Use order_hash=${quotationFingerprint(order)}. Never use omission alone to delete rows.` : '',
    'If the input reports no saved customer_data, resolve the customer or tier first and do not revise an old system_order. The regular preparation response never outputs system_order. If the input supplies ## system_order_revision and the user only corrects an existing quotation row, use one ## system_order_updates table with columns base_hash, row_index, then every original system_order column in the supplied order; row_index is 1-based and existing-row only, preserve all unchanged cells, omit unchanged rows, and do not add or delete rows. When changing quantity, dimensions, or unit weight, update the affected 總數 using confirmed pricing rules, or leave it blank if the required inputs are missing; never retain a stale total or claim a fresh price lookup. Additions and deletions require an OCR order correction and a later confirmed quotation. Never emit system_order_updates with quote_signal.',
    'Treat order confirmation, customer/tier selection, presentation of customer_data, and consent to start quoting as prerequisites, not a fixed interview sequence. Reuse unchanged information and explicit confirmations; ask only for missing or changed facts. Customer details may arrive before the order, but do not call search_customers before a saved ocr_result exists.',
    'If multiple customer matches are returned, ask the user to choose and do not output customer_data or quote_signal. After the user chooses, search the exact selected customer again to resolve the selection.',
    'Ask for a customer name or an explicit A-F tier choice only if neither is known. Customer names and identities require search_customers; never invent or infer a customer identity. After a unique match or successful no-match search, present the tool-provided customerDataMarkdown exactly. A successful no-match explicitly uses default B; a tool error is not no-match.',
    'Accept a direct tier only from a clear current-user command such as 使用預設 B 級進行報價, 用A級, tier c, use Tier D, set tier F, 使用c級, or a single A-F/a-f letter. Apart from an exact single-letter message, a tier command requires 級, tier, or explicit default-tier wording; letters in material codes, material choices, and customer names are not tier commands. A direct A-F tier choice does not call search_customers. Reject multiple tier letters or unrelated letters and ask the user to clarify. For a direct tier choice, present a complete ## customer_data table with blank customer code, 未指定客戶, the selected tier, and 用戶指定預設 X tier. If a resolved named customer already exists, preserve its identity and details while changing only the selected tier.',
    'Whenever this response presents customer_data, wait for the next user turn; even an explicit simultaneous quotation request cannot emit quoteSignal in this response. Reuse already-presented unchanged customer data on the next turn. A customer name or any tier choice alone is not start consent. Never emit customer_data_updates. Customer_data and quoteSignal must be in separate responses; any order or customer change requires a fresh confirmation.',
    'Emit quoteSignal only after all prerequisites are satisfied, then finish. Order confirmation and start consent may be in one user message; do not ask the same question again. Changes to the order or customer/tier invalidate prior start consent. A new explicit request to re-quote unchanged confirmed data is fresh start consent, including after cancellation.',
    'Use exactly ## quote_signal followed by a blank line and start; include no index or token. Never invent customer identity. Do not call search_price_candidates, calculate or output system_order/customer_quote, or output a quotation completion summary in this preparation response.',
    'A saved order is not confirmation by itself. Never reuse confirmation after a correction, and never emit a signal if this response contains ocr_result, ocr_result_updates, system_order_updates, or customer_data. Do not emit a fixed 下一步 template or ask whether to start quoting. Ask only for missing, changed, or ambiguous order facts, customer choices, or pricing conditions.',
    status.hasOcrResult ? `# Saved complete order\n${order}` : '# No saved complete order exists. Prepare the complete ocr_result first.',
    status.hasCustomerData ? `# Saved customer data\n${customer}` : '# No saved customer_data exists. Ask for a customer name or a clear A-F tier choice if it is not already known.',
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
  expectedOrderHash: string;
  expectedCustomerPreparationId?: string;
  result: SteelToolResult;
}): Promise<SteelToolResult> {
  const service = createSteelQuotationStateService(mongoose);
  const state = await service.readState(input.scope);
  if (!state?.currentOrder || !hasQuotationOrder(state.currentOrder.markdown) ||
    isUnfinishedQuotation(state.activeRun?.status)) {
    throw new Error('Customer lookup requires a saved order and no unfinished quotation');
  }
  if (state.currentOrder.sha256 !== input.expectedOrderHash ||
    state.currentCustomer?.preparationId !== input.expectedCustomerPreparationId) {
    throw new Error('Customer lookup is based on stale preparation data');
  }
  const clearPrevious = async () => {
    if (input.expectedCustomerPreparationId) {
      await service.clearCustomer({ scope: input.scope, responseId: input.responseId,
        preparationId: input.expectedCustomerPreparationId, orderHash: input.expectedOrderHash,
      });
    }
  };
  if (!input.result.ok) {
    await clearPrevious();
    return input.result;
  }
  const customers = input.result.data.customers;
  if (!Array.isArray(customers)) {
    throw new Error('Customer lookup returned an invalid customer list');
  }
  if (customers.length > 1) {
    await clearPrevious();
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
    expectedPreparationId: input.expectedCustomerPreparationId ?? null,
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
