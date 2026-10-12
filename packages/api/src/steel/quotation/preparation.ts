import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import type {
  ISteelQuotationState,
  SteelMarkdownAdmission,
  SteelMarkdownAdmissionInput,
  SteelQuotationCustomerLookupCandidate,
  SteelQuotationCustomerLookupEvidence,
  SteelQuotationCustomerPreparation,
  SteelQuotationPendingMessageFile,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import type { SteelToolJsonObject, SteelToolJsonValue, SteelToolResult } from '../tools/results';
import type { SteelQuotationSaveCustomerInput, SteelQuotationStateService } from './state';
import { parseAssistantMarkdown, parseOcrResultTable } from '../ocr/result';
import { extractCustomerDataTable, quotationSignal } from './protocol';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { createSteelQuotationStateService } from './state';
import { createSteelOcrStateService } from '../ocr/state';
import { isCurrentSystemOrderRun } from './revision';

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
  const sections = parseAssistantMarkdown(markdown).sections.filter((section) => section.title.split(/[｜|]/u)[0]?.trim() === 'ocr_result');
  if (sections.length !== 1) return false;
  const result = parseOcrResultTable(sections[0].body);
  return result.ok && result.table.rows.length > 0 &&
    ['來源', '零件編號', '類別'].every((header) => result.table.headers.includes(header));
}

export async function prepareQuotationTurn(input: {
  scope: SteelQuotationScope;
  messageId: string;
  responseId: string;
  generationId?: string;
  publicationStore?: { admitSteelMarkdown(input: SteelMarkdownAdmissionInput): Promise<SteelMarkdownAdmission | null> };
  service?: SteelQuotationStateService;
  text: string;
  files?: readonly SteelQuotationPendingMessageFile[];
}): Promise<{
  scope: SteelQuotationScope;
  messageId: string;
  state: ISteelQuotationState;
  instruction: string;
  resume: boolean;
  publicationAdmission?: SteelMarkdownAdmission;
  messageText: string;
  messageFiles?: readonly SteelQuotationPendingMessageFile[];
}> {
  const service = input.service ?? createSteelQuotationStateService(mongoose);
  let state = await service.ensureState(input.scope);
  const admit = async () => input.publicationStore ? (await input.publicationStore.admitSteelMarkdown({ scope: input.scope, responseId: input.responseId, generationId: input.generationId ?? input.responseId })) ?? undefined : undefined;
  const originalMessage = {
    messageText: input.text,
    ...(input.files ? { messageFiles: input.files } : {}),
  };
  if (isUnfinishedQuotation(state.activeRun?.status)) {
    return { scope: input.scope, messageId: input.messageId, state, instruction: '', resume: true, ...originalMessage };
  }
  const unpublished = state.activeRun?.status === 'completed' &&
    !await service.isPublishedRun(input.scope, state.activeRun);
  if (unpublished) {
    return { scope: input.scope, messageId: input.messageId, state, instruction: '', resume: true, ...originalMessage };
  }
  const selected = await service.prepareOcrOrder(input.scope, state.currentOrder?.sha256 ?? null);
  state = selected.state;
  const [ocr, hasSavedSystemOrder] = await Promise.all([
    selected.input ? Promise.resolve(null) : createSteelOcrStateService(mongoose).readScopedConversationOcrState(input.scope),
    service.hasSystemOrder(input.scope),
  ]);
  const markdown = ocr?.currentOcrResultMarkdown;
  if (markdown) {
    state = await service.setOrder({
      scope: input.scope,
      fullMarkdown: markdown,
      revision: ocr.currentOcrResultGenerationId,
      messageId: ocr.currentOcrResultMessageId,
      expectedOrderHash: state.currentOrder?.sha256 ?? null,
    });
  }
  const hasSystemOrder = hasSavedSystemOrder && isCurrentSystemOrderRun(state);
  return {
    scope: input.scope,
    messageId: input.messageId,
    state,
    resume: false,
    publicationAdmission: await admit(),
    ...originalMessage,
    instruction: [
      ...(selected.input ? [`# Saved OCR source mappings\n${JSON.stringify(selected.input.sourceSnapshot.mappings)}`] : []),
      quotationPreparationInstruction(
        state.currentOrder?.markdown, state.currentCustomer?.customerMarkdown, hasSystemOrder,
      ),
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
    'For a new order or any correction to a saved order, output exactly one complete ## ocr_result table containing every current row. A correction replaces the complete saved order; never emit ocr_result_updates, ocr_deletions, or any other delta/control section. Do not delegate OCR unless the original attachment must be read again. Text orders use the same complete table; use stable 來源=文字訂單 and stable 零件編號 for new text rows.',
    'The ocr_result table must contain 來源, 零件編號, 類別, and the available specification/quantity fields. Preserve existing columns and all user-provided material, size, unit, quantity, and notes; leave unknown facts blank. Keep dimensions in explicitly labeled mm columns where applicable.',
    'If the input reports no saved customer_data, resolve the customer or tier first. The regular preparation response never outputs system_order or customer_quote. A system-order correction must be a fresh complete system_order output using the existing pricing rules and the confirmed customer context; do not emit system_order_revision or system_order_updates. When changing quantity, dimensions, or unit weight, update the affected 總數 using confirmed pricing rules, or leave it blank if the required inputs are missing; never retain a stale total or claim a fresh price lookup.',
    'Treat order confirmation, customer/tier selection, presentation of customer_data, and consent to start quoting as prerequisites, not a fixed interview sequence. Reuse unchanged information and explicit confirmations; ask only for missing or changed facts. Customer details may arrive before the order, but do not call search_customers before a saved ocr_result exists.',
    'If multiple customer matches are returned, ask the user to choose and do not output customer_data or quote_signal. After the user chooses, search the exact selected customer again to resolve the selection.',
    'Ask for a customer name or an explicit A-F tier choice only if neither is known. Customer names and identities require search_customers; never invent or infer a customer identity. After a unique match or successful no-match search, present the tool-provided customerDataMarkdown exactly. A successful no-match explicitly uses default B; a tool error is not no-match.',
    'Accept a direct tier only from a clear current-user command such as 使用預設 B 級進行報價, 用A級, tier c, use Tier D, set tier F, 使用c級, or a single A-F/a-f letter. Apart from an exact single-letter message, a tier command requires 級, tier, or explicit default-tier wording; letters in material codes, material choices, and customer names are not tier commands. A direct A-F tier choice does not call search_customers. Reject multiple tier letters or unrelated letters and ask the user to clarify. For a direct tier choice, present a complete ## customer_data table with blank customer code, 未指定客戶, the selected tier, and 用戶指定預設 X tier. If a resolved named customer already exists, preserve its identity and details while changing only the selected tier.',
    'Whenever this response presents customer_data, wait for the next user turn; even an explicit simultaneous quotation request cannot emit quoteSignal in this response. Reuse already-presented unchanged customer data on the next turn. A customer name or any tier choice alone is not start consent. Never emit customer_data_updates. Customer_data and quoteSignal must be in separate responses; any order or customer change requires a fresh confirmation.',
    'Emit quoteSignal only after all prerequisites are satisfied, then finish. Order confirmation and start consent may be in one user message; do not ask the same question again. Changes to the order or customer/tier invalidate prior start consent. A new explicit request to re-quote unchanged confirmed data is fresh start consent, including after cancellation.',
    'Use exactly ## quote_signal followed by a blank line and start; include no index or token. Never invent customer identity. Do not call search_price_candidates, calculate or output system_order/customer_quote, or output a quotation completion summary in this preparation response.',
    'A saved order is not confirmation by itself. Never reuse confirmation after a correction, and never emit a signal if this response contains ocr_result, system_order, or customer_data. Do not emit a fixed 下一步 template or ask whether to start quoting. Ask only for missing, changed, or ambiguous order facts, customer choices, or pricing conditions.',
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

function customerLookupCandidate(value: SteelToolJsonValue | undefined): SteelQuotationCustomerLookupCandidate | undefined {
  const candidate = object(value);
  if (!candidate || typeof candidate.id !== 'number' || !Number.isSafeInteger(candidate.id) || candidate.id < 0) {
    return undefined;
  }
  const customerTier = typeof candidate.customerTier === 'string' && /^[A-F]$/u.test(candidate.customerTier)
    ? candidate.customerTier.toUpperCase() as SteelQuotationCustomerLookupCandidate['customerTier']
    : undefined;
  return {
    id: candidate.id,
    ...(typeof candidate.erpCustomerCode === 'string' ? { erpCustomerCode: candidate.erpCustomerCode } : {}),
    ...(typeof candidate.displayName === 'string' ? { displayName: candidate.displayName } : {}),
    ...(customerTier ? { customerTier } : {}),
  };
}

function customerMarkdownForCandidate(candidate: SteelQuotationCustomerLookupCandidate | undefined): string {
  const tier = candidate?.customerTier ?? 'B';
  return renderQuotationCustomerMarkdown({
    tier,
    ...(candidate
      ? { customerCode: candidate.erpCustomerCode, customerName: candidate.displayName, description: '' }
      : {}),
  });
}

function isResolvedCustomer(customer: SteelQuotationCustomerPreparation): boolean {
  return !customer.customerIdentity.startsWith('explicit-default:') &&
    !customer.customerIdentity.startsWith('no-match:');
}

function sameCustomerData(left: string, right: string): boolean {
  return JSON.stringify(extractCustomerDataTable(left)) === JSON.stringify(extractCustomerDataTable(right));
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
    (isUnfinishedQuotation(state.activeRun?.status) || (state.activeRun?.status === 'completed' &&
      !await service.isPublishedRun(input.scope, state.activeRun)))) {
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
    await service.clearCustomerLookupEvidence({ scope: input.scope, responseId: input.responseId,
      orderHash: input.expectedOrderHash });
    return input.result;
  }
  const customers = input.result.data.customers;
  if (!Array.isArray(customers)) {
    throw new Error('Customer lookup returned an invalid customer list');
  }
  const candidates = customers.map(customerLookupCandidate);
  if (candidates.some((candidate) => candidate === undefined)) {
    throw new Error('Customer lookup returned an invalid identity');
  }
  const safeCandidates = candidates as SteelQuotationCustomerLookupCandidate[];
  const customer = safeCandidates.length === 1 ? safeCandidates[0] : undefined;
  const markdown = customerMarkdownForCandidate(customer);
  const evidence: SteelQuotationCustomerLookupEvidence = {
    responseId: input.responseId,
    lookupMessageId: input.messageId,
    orderHash: state.currentOrder.sha256,
    ...(input.expectedCustomerPreparationId
      ? { customerPreparationId: input.expectedCustomerPreparationId }
      : {}),
    customers: safeCandidates,
    ...(safeCandidates.length <= 1 ? { customerMarkdown: markdown } : {}),
  };
  await service.saveCustomerLookupEvidence({
    scope: input.scope,
    evidence,
    expectedOrderHash: input.expectedOrderHash,
    expectedCustomerPreparationId: input.expectedCustomerPreparationId,
  });
  const serializedEvidence: SteelToolJsonObject = {
    responseId: evidence.responseId,
    lookupMessageId: evidence.lookupMessageId,
    orderHash: evidence.orderHash,
    ...(evidence.customerPreparationId ? { customerPreparationId: evidence.customerPreparationId } : {}),
    customers: evidence.customers.map((candidate) => ({
      id: candidate.id,
      ...(candidate.erpCustomerCode ? { erpCustomerCode: candidate.erpCustomerCode } : {}),
      ...(candidate.displayName ? { displayName: candidate.displayName } : {}),
      ...(candidate.customerTier ? { customerTier: candidate.customerTier } : {}),
    })),
    ...(evidence.customerMarkdown ? { customerMarkdown: evidence.customerMarkdown } : {}),
  };
  if (safeCandidates.length > 1) {
    await clearPrevious();
  }
  return {
    ...input.result,
    data: {
      ...input.result.data,
      customerLookupEvidence: serializedEvidence,
      ...(safeCandidates.length === 1 || safeCandidates.length === 0
        ? { customerDataMarkdown: markdown }
        : { quotationSelectionRequired: true }),
    },
  };
}

export type PreparedQuotationCustomerResponse =
  | { kind: 'unchanged'; customer: SteelQuotationCustomerPreparation }
  | { kind: 'save'; input: SteelQuotationSaveCustomerInput };

export async function prepareQuotationCustomerResponse(input: {
  scope: SteelQuotationScope;
  response: string;
  responseId: string;
  messageId?: string;
  messageText?: string;
  messageFiles?: readonly SteelQuotationPendingMessageFile[];
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  service?: SteelQuotationStateService;
  finishReason?: string;
}): Promise<PreparedQuotationCustomerResponse | undefined> {
  const sections = parseAssistantMarkdown(input.response).sections;
  const hasCustomerSection = sections.some((section) => section.title.split(/[｜|]/u)[0]?.trim() === 'customer_data');
  if (!hasCustomerSection) return undefined;
  const customer = extractCustomerDataTable(input.response);
  if (!customer) {
    throw new Error('Customer data must contain one readable Markdown table');
  }
  const service = input.service ?? createSteelQuotationStateService(mongoose);
  const state = await service.readState(input.scope);
  const orderHash = state?.currentOrder?.sha256;
  if (input.expectedOrderHash !== orderHash) {
    throw new Error('Customer data is based on stale preparation data');
  }
  const currentCustomer = state?.currentCustomer;
  if (currentCustomer && currentCustomer.responseId === input.responseId &&
    sameCustomerData(currentCustomer.customerMarkdown, input.response)) {
    return { kind: 'unchanged', customer: currentCustomer };
  }
  if ((state?.currentCustomer?.preparationId ?? undefined) !== input.expectedCustomerPreparationId) {
    throw new Error('Customer data customer preparation is stale');
  }
  const tierSelection = parseQuotationTierSelection(input.messageText);
  if (tierSelection.status === 'invalid') {
    throw new Error('Customer tier selection is ambiguous or unrelated to the current user message');
  }
  if (!input.messageId && tierSelection.status === 'none' && currentCustomer &&
    sameCustomerData(currentCustomer.customerMarkdown, input.response)) {
    return { kind: 'unchanged', customer: currentCustomer };
  }
  if (!input.messageId) {
    throw new Error('Customer data requires the original user message id');
  }
  let targetMarkdown: string;
  let customerIdentity: string;
  let selectionProvenance: SteelQuotationCustomerPreparation['selectionProvenance'];
  if (tierSelection.status === 'selected') {
    const currentRow = currentCustomer
      ? extractCustomerDataTable(currentCustomer.customerMarkdown)
      : undefined;
    const currentValues = currentRow?.rows.length === 1 ? currentRow.rows[0] : undefined;
    targetMarkdown = renderQuotationCustomerMarkdown({
      tier: tierSelection.tier,
      ...(currentCustomer && isResolvedCustomer(currentCustomer) && currentValues
        ? { customerCode: currentValues[0], customerName: currentValues[1], description: currentValues[3] }
        : {}),
    });
    customerIdentity = currentCustomer && isResolvedCustomer(currentCustomer)
      ? currentCustomer.customerIdentity
      : `explicit-default:${tierSelection.tier}`;
    selectionProvenance = {
      method: 'default_tier',
      selectionMessageId: input.messageId,
    };
  } else if (currentCustomer && sameCustomerData(currentCustomer.customerMarkdown, input.response)) {
    return { kind: 'unchanged', customer: currentCustomer };
  } else {
    const evidence = state?.customerLookupEvidence;
    if (!evidence || evidence.responseId !== input.responseId || evidence.orderHash !== orderHash ||
      (evidence.customerPreparationId ?? undefined) !== input.expectedCustomerPreparationId ||
      evidence.customers.length !== 1 && evidence.customers.length !== 0 ||
      !evidence.customerMarkdown || !sameCustomerData(evidence.customerMarkdown, input.response)) {
      throw new Error('Customer data does not match trusted customer lookup evidence');
    }
    const candidate = evidence.customers[0];
    targetMarkdown = evidence.customerMarkdown;
    customerIdentity = candidate ? String(candidate.id) : 'no-match:default-B';
    selectionProvenance = {
      method: candidate ? 'unique' : 'default_tier',
      lookupMessageId: evidence.lookupMessageId,
      ...(candidate ? { selectedCustomerId: String(candidate.id) } : {}),
    };
  }
  if (!sameCustomerData(targetMarkdown, input.response)) {
    throw new Error('Customer data does not match trusted current customer or tier selection');
  }
  return {
    kind: 'save',
    input: {
      scope: input.scope,
      customerMarkdown: targetMarkdown,
      customerIdentity,
      triggeringMessageId: input.messageId,
      responseId: input.responseId,
      ...(orderHash !== undefined ? { orderHash } : {}),
      expectedPreparationId: input.expectedCustomerPreparationId ?? null,
      selectionProvenance,
    },
  };
}

export async function commitQuotationCustomerResponse(input: {
  scope: SteelQuotationScope;
  response: string;
  responseId: string;
  messageId?: string;
  messageText?: string;
  messageFiles?: readonly SteelQuotationPendingMessageFile[];
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  service?: SteelQuotationStateService;
  finishReason?: string;
}): Promise<SteelQuotationCustomerPreparation | undefined> {
  const prepared = await prepareQuotationCustomerResponse(input);
  if (!prepared || prepared.kind === 'unchanged') return prepared?.customer;
  const service = input.service ?? createSteelQuotationStateService(mongoose);
  return service.saveCustomer(prepared.input);
}

export function renderQuotationSignal(): string {
  return quotationSignal;
}

export function quotationFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
