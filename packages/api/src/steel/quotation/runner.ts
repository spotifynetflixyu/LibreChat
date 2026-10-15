import mongoose from 'mongoose';
import { logger } from '@librechat/data-schemas';
import { createHash, randomUUID } from 'node:crypto';
import {
  bindSteelReviewRowsToOcrContext,
  createSteelReviewOcrContext,
  steelSectionBaseTitle,
} from 'librechat-data-provider';
import {
  steelCalculationCandidateEvidenceSchema,
  type SteelCalculationCandidateEvidence,
  type SteelCalculationCheckpoint,
} from 'librechat-data-provider';
import type {
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationPendingMessageFile,
  SteelQuotationScope,
  SteelQuotationSnapshotPayload,
  SteelQuotationSourceSnapshot,
  SteelQuotationTicket,
  SteelQuotationTicketCompletionReceipt,
  SteelQuotationPublicationProof,
  SteelQuotationOcrSelection,
  SteelQuotationPublicationSaveResult,
  SteelQuotationSummaryInput,
  SteelQuotationSummaryResult,
  SteelQuotationSavedMessage,
  SteelMarkdownAdmission,
} from '@librechat/data-schemas';
import type { SteelReviewMetadata } from 'librechat-data-provider';
import type {
  QuotationBackendFailure,
  QuotationChildResultInput,
  QuotationLookupEvidence,
  QuotationPythonEvidence,
} from './protocol';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import type { QuotationModelInput, QuotationRepairProgress } from './model';
import type { SteelRepositoryClient } from '../repositories/types';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelNativeHistory } from '../native/events';
import type { SavedQuotationLookup } from './history';
import {
  buildQuotationChunks,
  quotationSystemOrderColumns,
  splitQuotationChunk,
  mergeQuotationChildResults,
  QuotationProtocolError,
  extractCustomerDataTable,
  parseQuotationSignal,
  stripLegacyQuotationChildSidecars,
  validateQuotationChildResult,
  finalizeQuotationMainResponse,
  buildQuotationSystemOrderForReview,
  buildQuotationFailureMarkdown,
  restoreQuotationChunks,
} from './protocol';
import {
  commitQuotationCustomerResponse,
  hasQuotationOrder,
  isUnfinishedQuotation,
} from './preparation';
import { getQuotationProgress, QUOTATION_V2_SPLIT_SIZES, QUOTATION_V2_MAX_DEPTH } from './progress';
import { executeSteelTool, createSteelToolRunState } from '../tools/execute';
import { getSafeErrorText, isOwnedAbortError } from '../../utils/errors';
import { quotationOcrSource, sameQuotationOcrSelection } from './input';
import { buildDefaultSteelGlobalAgentContext } from '../native/context';
import { retiredMarkdownSectionTitles } from '../markdown/admission';
import { buildCustomerQuoteFromMarkdown } from '../markdown/quote';
import { buildSteelQuotationStatusEvent } from '../native/events';
import { normalizeSteelChunkMarkdown } from '../markdown/chunk';
import { canonicalizeSystemOrderMarkdown } from './revision';
import { readPublishedQuotationOrder } from './publication';
import { createSteelQuotationStateService } from './state';
import { createSteelReviewBaselineRows } from '../review';
import { parseMarkdownTables } from '../markdown/table';
import { parseAssistantMarkdown } from '../ocr/result';
import { registerQuotationExecution } from './control';
import { createSteelPostgresPool } from '../postgres';
import { readQuotationHistory } from './history';
import { invokeQuotationModel } from './model';

export { commitQuotationCustomerResponse, prepareQuotationCustomerResponse } from './preparation';

export class SteelQuotationPublicationError extends Error {
  readonly code: string;

  constructor(code = 'superseded_response') {
    super('Steel response could not be finalized.');
    this.name = 'SteelQuotationPublicationError';
    this.code = code;
  }
}

function buildQuotationReviewMetadata(input: {
  snapshot: SteelQuotationSnapshotPayload;
  systemOrderMarkdown: string;
  runId: string;
  systemOutputId: string;
  messageId?: string;
  calculationCheckpoint?: SteelCalculationCheckpoint;
}): SteelReviewMetadata | undefined {
  const selected = input.snapshot.ocrSelection?.selected;
  const ocrSections = parseAssistantMarkdown(input.snapshot.orderMarkdown).sections;
  const ocrSection = ocrSections.find(
    (section) => steelSectionBaseTitle(section.title) === 'ocr_result',
  );
  const ocrTable = parseMarkdownTables(ocrSection?.body ?? input.snapshot.orderMarkdown)[0];
  const systemSection = parseAssistantMarkdown(input.systemOrderMarkdown).sections.find(
    (section) => steelSectionBaseTitle(section.title) === 'system_order',
  );
  const systemTable = parseMarkdownTables(systemSection?.body ?? input.systemOrderMarkdown)[0];
  if (!systemSection || !systemTable) return undefined;
  const baselineSystemRows = createSteelReviewBaselineRows(
    systemTable,
    'system_order',
    input.systemOutputId,
    input.snapshot.sourceSnapshot?.mappings ?? [],
    input.calculationCheckpoint,
  );
  const ocrContext =
    input.snapshot.ocrContext ??
    (selected && ocrSection && ocrTable
      ? createSteelReviewOcrContext({
          title: ocrSection.title,
          outputId: selected.outputId,
          revision: selected.revision,
          headers: ocrTable.headers,
          rows: createSteelReviewBaselineRows(
            ocrTable,
            'ocr_result',
            selected.outputId,
            input.snapshot.sourceSnapshot?.mappings ?? [],
          ),
        })
      : null);
  const systemRows = ocrContext
    ? bindSteelReviewRowsToOcrContext(systemTable.headers, baselineSystemRows, ocrContext)
    : baselineSystemRows.map((row) => ({ ...row, source: null, ocrLink: null }));
  return {
    version: 1,
    initialized: true,
    lineage: {
      runId: input.runId,
      outputId: input.systemOutputId,
      revision: input.runId,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(selected
        ? {
            ocrOutputId: selected.outputId,
            ocrRevision: selected.revision,
            ocrHash: selected.sha256,
          }
        : {}),
    },
    ocrContext,
    rows: systemRows,
  };
}

const quotationSummaryControlTitles = new Set([
  ...retiredMarkdownSectionTitles,
  'system_order',
  'system_order_chunk',
  'manual_reviews_chunk',
  'ocr_result',
  'customer_data',
  'customer_quote',
  'quote_signal',
  'quote_lineage',
  'quote_summary',
  'summary',
]);

function quotationSummaryTitle(title: string): string {
  return steelSectionBaseTitle(title).toLowerCase();
}

function sanitizeQuotationSummary(markdown: string): string {
  const filter = createQuotationSummaryStreamFilter();
  const filtered = `${filter.append(markdown)}${filter.finish()}`;
  const document = parseAssistantMarkdown(filtered);
  return [
    document.preamble.trim(),
    ...document.sections
      .filter((section) => !quotationSummaryControlTitles.has(quotationSummaryTitle(section.title)))
      .map((section) => section.raw.trim()),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function createQuotationSummaryStreamFilter(): {
  append(delta: string): string;
  finish(): string;
} {
  let pending = '';
  let suppressed = false;
  const heading = /^ {0,3}#{1,3}[ \t]+(.+?)[ \t]*$/u;
  const processLine = (line: string): string => {
    const headingText = line.replace(/\r?\n$/u, '').match(heading)?.[1]?.replace(/[ \t]+#+[ \t]*$/u, '');
    const title = headingText === undefined ? undefined : steelSectionBaseTitle(headingText).toLowerCase();
    if (title !== undefined) suppressed = quotationSummaryControlTitles.has(title);
    return suppressed ? '' : line;
  };
  const isHeadingPrefix = (value: string): boolean => {
    const trimmed = value.trimStart();
    return trimmed.startsWith('#') && /^#{1,3}(?:$|[ \t#])/u.test(trimmed);
  };
  return {
    append(delta: string): string {
      pending += delta;
      let output = '';
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline + 1);
        pending = pending.slice(newline + 1);
        output += processLine(line);
        newline = pending.indexOf('\n');
      }
      if (pending && !isHeadingPrefix(pending)) {
        output += suppressed ? '' : pending;
        pending = '';
      }
      return output;
    },
    finish(): string {
      const output = pending ? processLine(pending) : '';
      pending = '';
      return output;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readExactCandidate(value: unknown): SteelCalculationCandidateEvidence | undefined {
  if (
    !isRecord(value) ||
    typeof value.erpItemCode !== 'string' ||
    typeof value.category !== 'string' ||
    !isRecord(value.exactPhysical)
  ) {
    return undefined;
  }
  const physical = value.exactPhysical;
  const candidate = {
    erpItemCode: value.erpItemCode,
    category: value.category,
    ruleVersion: 'steel-weight-v1',
    ...(typeof value.unitWeightBasis === 'string'
      ? { unitWeightBasis: value.unitWeightBasis }
      : {}),
    exactPhysical: {
      ...(typeof physical.density === 'string' ? { density: physical.density } : {}),
      ...(typeof physical.widthMm === 'string' ? { widthMm: physical.widthMm } : {}),
      ...(typeof physical.lengthMm === 'string' ? { lengthMm: physical.lengthMm } : {}),
      ...(typeof physical.unitWeightValue === 'string'
        ? { unitWeightValue: physical.unitWeightValue }
        : {}),
    },
  };
  const parsed = steelCalculationCandidateEvidenceSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function hasCompleteSteelFormula(candidate: SteelCalculationCandidateEvidence): boolean {
  const physical = candidate.exactPhysical;
  if (candidate.category === '鐵板') {
    return physical.density !== undefined;
  }
  if (candidate.category === '方鐵') {
    return physical.density !== undefined;
  }
  const unitWeightBasis = candidate.unitWeightBasis?.toLowerCase();
  if (
    !['H型鋼', 'C型鋼', '角鐵', '槽鐵', '平鐵', '方管', '圓管', '圓條'].includes(
      candidate.category,
    ) ||
    physical.unitWeightValue === undefined
  ) {
    return false;
  }
  if (candidate.unitWeightBasis === 'kg_per_piece_or_stock_length') {
    return physical.lengthMm !== undefined;
  }
  return ['m', 'kg_per_m', 'kg/m'].includes(unitWeightBasis ?? '');
}

function buildSteelCalculationCheckpoint(
  systemOrderHash: string,
  rows: readonly (readonly string[])[],
  results: readonly QuotationChildResultInput[],
): SteelCalculationCheckpoint {
  const candidatesByIdentity = new Map<string, Map<string, SteelCalculationCandidateEvidence>>();
  for (const result of results) {
    for (const evidence of result.lookupEvidence) {
      if (!evidence.result.ok || !isRecord(evidence.result.data)) continue;
      const queryResults = evidence.result.data.queryResults;
      if (!Array.isArray(queryResults)) continue;
      for (const queryResult of queryResults) {
        if (!isRecord(queryResult) || !Array.isArray(queryResult.candidates)) continue;
        for (const rawCandidate of queryResult.candidates) {
          const candidate = readExactCandidate(rawCandidate);
          if (!candidate || !hasCompleteSteelFormula(candidate)) continue;
          const identity = `${candidate.erpItemCode}\u0000${candidate.category}`;
          const entries =
            candidatesByIdentity.get(identity) ??
            new Map<string, SteelCalculationCandidateEvidence>();
          entries.set(JSON.stringify(candidate), candidate);
          candidatesByIdentity.set(identity, entries);
        }
      }
    }
  }
  const codeIndex = quotationSystemOrderColumns.indexOf('型號');
  const categoryIndex = quotationSystemOrderColumns.indexOf('類別');
  return {
    version: 1,
    systemOrderHash,
    rows: rows.flatMap((row, rowIndex) => {
      const identity = `${row[codeIndex] ?? ''}\u0000${row[categoryIndex] ?? ''}`;
      const candidates = candidatesByIdentity.get(identity);
      if (!candidates || candidates.size !== 1) return [];
      const candidate = [...candidates.values()][0];
      return candidate ? [{ rowIndex, candidate }] : [];
    }),
  };
}

class QuotationChildFailure extends Error {}

interface SavedQuotationChild {
  backendFailure?: QuotationBackendFailure;
  markdown: string;
  sourceRowIds?: string[];
  lookupOperations: string[];
  pythonOperations: string[];
}

interface LoadedQuotationChild extends QuotationChildResultInput {
  lookupOperations: readonly string[];
  pythonOperations: readonly string[];
}

export interface QuotationProgress {
  run: SteelQuotationActiveRun;
  stage?:
    | 'started'
    | 'chunk_started'
    | 'chunk_saved'
    | 'main_consolidating'
    | 'main_review_started'
    | 'main_streaming'
    | QuotationRepairProgress['stage'];
  completedChunks: number;
  totalChunks: number;
  chunkIndex?: number;
  attempt?: string;
  repairAttempt?: number;
  maxRepairAttempts?: number;
  message?: string;
}

export interface QuotationRunnerInput {
  client?: SteelRepositoryClient;
  scope: SteelQuotationScope;
  modelOptions: OpenAIOAuthModelOptions;
  signal: AbortSignal;
  onHistory?(history: SteelNativeHistory): Promise<void>;
  onProgress?(progress: QuotationProgress): Promise<void>;
  onTool?(input: {
    run: SteelQuotationActiveRun;
    id: string;
    chunkIndex: number;
    attempt: string;
    arguments: SteelToolJsonObject;
    result?: SteelToolResult;
  }): Promise<void>;
  publishFinal(
    input: SteelQuotationPublicationProof & { markdown: string },
  ): Promise<SteelQuotationPublicationSaveResult | void>;
  appendSummary?(input: SteelQuotationSummaryInput): Promise<SteelQuotationSummaryResult>;
  onSummaryCommitted?(message: SteelQuotationSavedMessage): Promise<void>;
  onCompletedReplay?(targetMessageId: string): Promise<void>;
  refreshPublicationAdmission?(): Promise<SteelMarkdownAdmission | undefined>;
  summarySourceMessageId?: string;
  onUsage?: QuotationModelInput['onUsage'];
  onTextDelta?: QuotationModelInput['onTextDelta'];
  invokeModel?: typeof invokeQuotationModel;
  executeLookup?: (args: SteelToolJsonObject, callId: string) => Promise<SteelToolResult>;
}

let pool: ReturnType<typeof createSteelPostgresPool> | undefined;

function validateCompletionReceiptReplay(
  state: ISteelQuotationState | null | undefined,
  ticket: SteelQuotationTicket,
  response: string,
): void {
  const receipt = ticket.completionReceipt;
  if (!receipt) return;
  const matchesInput = createHash('sha256').update(response).digest('hex') === receipt.inputHash;
  if (!matchesInput && response !== receipt.markdown) {
    throw new Error('Quotation completion receipt does not match the response');
  }
  if (!state?.activeRun || state.activeRun.runId !== ticket.acceptedRunId) {
    throw new Error('Quotation completion receipt run is stale');
  }
  const customer = state.currentCustomer;
  if (
    state.currentOrder?.sha256 !== ticket.orderHash ||
    !customer ||
    customer.preparationId !== ticket.preparationId ||
    customer.customerIdentity !== ticket.customerIdentity ||
    customer.customerMarkdown !== ticket.customerMarkdown
  ) {
    throw new Error('Quotation completion receipt preparation is stale');
  }
}

export async function acceptQuotationResponse(input: {
  runtimeRulesClient?: SteelRepositoryClient;
  scope: SteelQuotationScope;
  response: string;
  responseId: string;
  messageId?: string;
  messageText?: string;
  messageFiles?: readonly SteelQuotationPendingMessageFile[];
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  completionReceipt?: SteelQuotationTicketCompletionReceipt;
  sourceSnapshot?: SteelQuotationSourceSnapshot;
  ocrSelection?: SteelQuotationOcrSelection;
  finishReason?: string;
  service?: ReturnType<typeof createSteelQuotationStateService>;
}): Promise<SteelQuotationActiveRun | undefined> {
  if (input.finishReason !== 'stop') return undefined;
  if (
    parseAssistantMarkdown(input.response).sections.some((section) =>
      retiredMarkdownSectionTitles.some(
        (title) => title === steelSectionBaseTitle(section.title),
      ),
    )
  ) {
    throw new SteelQuotationPublicationError('retired_control_section');
  }
  const signal = parseQuotationSignal(input.response);
  const sections = parseAssistantMarkdown(input.response).sections;
  const hasSection = (title: string) =>
    sections.some((section) => steelSectionBaseTitle(section.title) === title);
  const hasOrder = hasSection('ocr_result');
  const hasCustomerSection = hasSection('customer_data');
  const customer = extractCustomerDataTable(input.response);
  if (!signal && !hasCustomerSection && !hasOrder) return undefined;
  if (hasCustomerSection && !customer) {
    throw new Error('Customer data must contain one readable Markdown table');
  }
  const service = input.service ?? createSteelQuotationStateService(mongoose);
  const state = await service.readState(input.scope);
  const matchesCustomer = (markdown: string) =>
    JSON.stringify(customer) === JSON.stringify(extractCustomerDataTable(markdown));
  const acceptedTicket = state?.tickets.find(
    (ticket) => ticket.responseId === input.responseId && ticket.acceptedRunId,
  );
  if (acceptedTicket) {
    if (acceptedTicket.completionReceipt) {
      validateCompletionReceiptReplay(state, acceptedTicket, input.response);
      if (!signal) return undefined;
      return acceptQuotationSignal({ ...input, service });
    }
    if (hasCustomerSection) {
      const customerSections = sections.filter(
        (section) => steelSectionBaseTitle(section.title) === 'customer_data',
      );
      if (
        customerSections.length !== 1 ||
        customerSections[0]?.title !== 'customer_data' ||
        !customer ||
        !matchesCustomer(acceptedTicket.customerMarkdown)
      ) {
        throw new Error('Accepted quotation replay customer data does not match the saved ticket');
      }
    }
    if (hasOrder) {
      const orderSections = sections.filter((section) =>
        ['ocr_result'].includes(steelSectionBaseTitle(section.title)),
      );
      const orderSection =
        orderSections.length === 1 && orderSections[0]?.title === 'ocr_result'
          ? orderSections[0]
          : undefined;
      const orderMarkdown = orderSection
        ? `## ${orderSection.title}\n\n${orderSection.body}`
        : undefined;
      if (
        !orderMarkdown ||
        createHash('sha256').update(orderMarkdown).digest('hex') !== acceptedTicket.orderHash
      ) {
        throw new Error('Accepted quotation replay order data does not match the saved ticket');
      }
    }
    if (!signal) return undefined;
    return acceptQuotationSignal({ ...input, service });
  }
  if (
    (isUnfinishedQuotation(state?.activeRun?.status) ||
      (state?.activeRun?.status === 'completed' &&
        !(await service.isPublishedRun(input.scope, state.activeRun)))) &&
    (hasOrder || (customer && !matchesCustomer(state?.currentCustomer?.customerMarkdown ?? '')))
  ) {
    throw new SteelQuotationPublicationError('quotation_busy');
  }
  const committedCustomer = await commitQuotationCustomerResponse({ ...input, service });
  return acceptQuotationSignal({
    ...input,
    ...(committedCustomer
      ? { expectedCustomerPreparationId: committedCustomer.preparationId }
      : {}),
    service,
  });
}

export async function acceptQuotationSignal(input: {
  runtimeRulesClient?: SteelRepositoryClient;
  scope: SteelQuotationScope;
  response: string;
  responseId: string;
  messageId?: string;
  expectedOrderHash?: string;
  expectedCustomerPreparationId?: string;
  completionReceipt?: SteelQuotationTicketCompletionReceipt;
  sourceSnapshot?: SteelQuotationSourceSnapshot;
  ocrSelection?: SteelQuotationOcrSelection;
  finishReason?: string;
  service?: ReturnType<typeof createSteelQuotationStateService>;
}): Promise<SteelQuotationActiveRun | undefined> {
  if (input.finishReason !== 'stop' || !parseQuotationSignal(input.response)) return undefined;
  if (
    parseAssistantMarkdown(input.response).sections.some((section) =>
      retiredMarkdownSectionTitles.some(
        (title) => title === steelSectionBaseTitle(section.title),
      ),
    )
  ) {
    throw new SteelQuotationPublicationError('retired_control_section');
  }
  const service = input.service ?? createSteelQuotationStateService(mongoose);
  const state = await service.readState(input.scope);
  const existingTicket = state?.tickets.find((entry) => entry.responseId === input.responseId);
  if (existingTicket?.acceptedRunId) {
    validateCompletionReceiptReplay(state, existingTicket, input.response);
    return service.acceptSignal({
      scope: input.scope,
      index: existingTicket.index,
      token: existingTicket.token,
      orderHash: existingTicket.orderHash,
      customerMarkdown: existingTicket.customerMarkdown,
      customerIdentity: existingTicket.customerIdentity,
      prompts: { child: 'replay', main: 'replay' },
      chunks: [],
      ...(input.sourceSnapshot ? { sourceSnapshot: input.sourceSnapshot } : {}),
      targetMessageId: input.responseId,
    });
  }
  const preparedCustomer = state?.currentCustomer;
  if (
    !state?.currentOrder ||
    !hasQuotationOrder(state.currentOrder.markdown) ||
    !preparedCustomer
  ) {
    throw new Error('Quotation signal requires a saved complete order and customer');
  }
  if (
    input.expectedOrderHash !== state.currentOrder.sha256 ||
    input.expectedCustomerPreparationId !== preparedCustomer.preparationId
  ) {
    throw new Error('Quotation signal is based on stale preparation data');
  }
  if (
    isUnfinishedQuotation(state.activeRun?.status) ||
    (state.activeRun?.status === 'completed' &&
      !(await service.isPublishedRun(input.scope, state.activeRun)))
  )
    return state.activeRun;
  if (
    input.ocrSelection &&
    !sameQuotationOcrSelection(input.ocrSelection, state.currentOrder.ocrSelection)
  ) {
    throw new Error('Quotation signal OCR selection is stale');
  }
  const chunks = buildQuotationChunks(state.currentOrder.markdown);
  const conversation = {
    requestId: input.responseId,
    conversationId: input.scope.conversationId,
    activeHistory: [],
  };
  const [child, main] = await Promise.all([
    buildDefaultSteelGlobalAgentContext({
      conversation,
      mode: 'quote_child',
      runtimeRulesClient: input.runtimeRulesClient,
    }),
    buildDefaultSteelGlobalAgentContext({
      conversation,
      mode: 'quote_main',
      runtimeRulesClient: input.runtimeRulesClient,
    }),
  ]);
  const ticket = await service.issueTicket({
    scope: input.scope,
    preparationId: preparedCustomer.preparationId,
    responseId: input.responseId,
    orderHash: state.currentOrder.sha256,
    customerMarkdown: preparedCustomer.customerMarkdown,
    customerIdentity: preparedCustomer.customerIdentity,
    triggeringMessageId: input.messageId ?? preparedCustomer.triggeringMessageId,
    selectionProvenance: preparedCustomer.selectionProvenance,
    completionReceipt: input.completionReceipt,
  });
  return service.acceptSignal({
    scope: input.scope,
    index: ticket.index,
    token: ticket.token,
    orderHash: ticket.orderHash,
    customerMarkdown: ticket.customerMarkdown,
    customerIdentity: ticket.customerIdentity,
    targetMessageId: input.responseId,
    prompts: { child: child.instructionPrefix, main: main.instructionPrefix },
    chunks: chunks.map((chunk) => ({
      index: chunk.chunkIndex,
      sourceRowCount: chunk.sourceRows.length,
    })),
    ...(input.sourceSnapshot ? { sourceSnapshot: input.sourceSnapshot } : {}),
    ...(input.ocrSelection ? { ocrSelection: input.ocrSelection } : {}),
  });
}

export type QuotationPreflightStatus = 'completed' | 'cancelled' | 'busy' | 'idle';

const quotationPreflightNotices: Partial<Record<QuotationPreflightStatus, string>> = {
  busy: '\n\n報價正在處理中，將接續同一個報價進程。',
  cancelled: '\n\n報價已取消。',
};

/** Fixed text streamed into the answer when preflight cannot continue the quotation. */
export function getQuotationPreflightNotice(status: QuotationPreflightStatus): string | undefined {
  return quotationPreflightNotices[status];
}

export async function runQuotationPreflight(input: QuotationRunnerInput): Promise<{
  status: QuotationPreflightStatus;
  markdown?: string;
}> {
  const service = createSteelQuotationStateService(mongoose);
  const initial = await service.readState(input.scope);
  const run = initial?.activeRun;
  if (!run) return { status: 'idle' };
  if (input.onHistory) {
    await input.onHistory(await readQuotationHistory({ scope: input.scope, runId: run.runId }));
  }
  if (run.status === 'cancelled') return { status: 'cancelled' };
  const scope = input.scope;
  const runId = run.runId;
  if (run.status === 'completed') {
    const published = await readPublishedQuotationOrder({ scope, service });
    if (published.status !== 'published') {
      throw new Error('Completed quotation has no trusted publication receipt');
    }
    const targetMessageId = published.value.systemOrder.messageId ?? published.value.run.targetMessageId;
    if (!targetMessageId) throw new Error('Completed quotation publication target is unavailable');
    try {
      await input.onCompletedReplay?.(targetMessageId);
    } catch {
      // Replay notification is an observer; the durable publication remains completed.
    }
    return { status: 'completed', markdown: published.value.systemOrder.markdown };
  }
  const lease = await service.acquireLease({ scope, runId });
  if (!lease) return { status: 'busy' };
  const leaseInput = { scope, runId, leaseToken: lease.leaseToken };
  const executionAttempt = randomUUID();
  const registration = registerQuotationExecution(scope, runId);
  const controller = registration.controller;
  const abort = () => controller.abort(input.signal.reason);
  if (input.signal.aborted) abort();
  else input.signal.addEventListener('abort', abort, { once: true });
  let orderPublished = false;
  let heartbeatEnabled = false;
  let heartbeatPending: Promise<void> | undefined;
  const renewLease = async () => {
    try {
      const renewed = await service.heartbeatLease(leaseInput);
      if (renewed || orderPublished) return;
      const active = await service.readActiveRun(scope);
      if (active?.runId === runId && active.status === 'completed' &&
        await service.isPublishedRun(scope, active)) {
        orderPublished = true;
        clearInterval(heartbeat);
        return;
      }
      controller.abort(new Error('Quotation execution lease ended'));
    } catch (error) {
      if (!orderPublished) controller.abort(error);
    }
  };
  const heartbeat = setInterval(() => {
    if (!heartbeatEnabled) return;
    if (heartbeatPending) return heartbeatPending;
    heartbeatPending = renewLease().finally(() => { heartbeatPending = undefined; });
    return heartbeatPending;
  }, 3000);
  heartbeat.unref();
  const operational = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  };
  const assertActive = async () => {
    controller.signal.throwIfAborted();
    const active = await operational(() => service.readActiveRun(scope));
    if (
      !active ||
      active.runId !== runId ||
      active.leaseToken !== lease.leaseToken ||
      active.status === 'cancelled' ||
      active.status === 'completed' ||
      !active.leaseExpiresAt ||
      new Date(active.leaseExpiresAt).getTime() <= Date.now()
    ) {
      const error = new Error('Quotation execution is no longer active');
      controller.abort(error);
      throw error;
    }
    return active;
  };
  const progress = async (
    chunkIndex?: number,
    attempt?: string,
    stage?: QuotationProgress['stage'],
    recoveryPath?: string,
  ) => {
    const active = await assertActive();
    await input.onProgress?.({
      run: active,
      ...getQuotationProgress(active, chunkIndex, recoveryPath),
      attempt: attempt ?? executionAttempt,
      ...(stage ? { stage } : {}),
    });
  };
  const checkpoint = async (
    operationId: string,
    kind: 'chunk' | 'tool' | 'main' | 'final',
    payload: string,
    chunkIndex?: number,
  ) => {
    try {
      const saved = await service.checkpoint({
        ...leaseInput,
        operationId,
        kind,
        payload,
        chunkIndex,
      });
      if (!saved) throw new Error('Quotation checkpoint lost its execution lease');
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  };
  let interruptedChunkIndex: number | undefined;
  let refreshedPublicationAdmission: SteelMarkdownAdmission | undefined;
  try {
    controller.signal.throwIfAborted();
    refreshedPublicationAdmission = await input.refreshPublicationAdmission?.();
    controller.signal.throwIfAborted();
    heartbeatEnabled = true;
    const running = await service.transitionRun({ ...leaseInput, status: 'running' });
    if (!running) throw new Error('Quotation could not start with its execution lease');
    await progress(undefined, undefined, 'started');
    const payload = await service.readArtifact({ scope, ref: run.snapshotRef });
    if (!payload) throw new Error('Quotation input snapshot is missing');
    const snapshot = JSON.parse(payload) as SteelQuotationSnapshotPayload;
    const chunks = restoreQuotationChunks(snapshot.orderMarkdown, run.chunks);
    const results: QuotationChildResultInput[] = [];
    for (const chunk of chunks) {
      interruptedChunkIndex = chunk.chunkIndex;
      const operationId = `chunk:${chunk.chunkIndex}`;
      const [stored, treeSplit] = await Promise.all([
        readCheckpoint(operationId),
        readCheckpoint(`split-v2:${chunk.chunkIndex}:r`),
      ]);
      const children: LoadedQuotationChild[] = [];
      if (stored && !treeSplit) {
        children.push(await loadChild(chunk, stored));
        await progress(chunk.chunkIndex, undefined, 'chunk_saved');
      } else {
        children.push(...(await recoverChild(chunk, 'r', 0)));
      }
      if (!stored) {
        const lookupOperations = children.flatMap((child) => child.lookupOperations);
        const pythonOperations = children.flatMap((child) => child.pythonOperations);
        await checkpoint(
          operationId,
          'chunk',
          JSON.stringify({
            markdown: mergeQuotationChildResults(chunk, children),
            lookupOperations,
            pythonOperations,
            sourceRowIds: chunk.sourceRows.map((row) => row.sourceRowId),
            ...(children.length === 1 && children[0]!.backendFailure
              ? { backendFailure: children[0]!.backendFailure }
              : {}),
          }),
          chunk.chunkIndex,
        );
      }
      const persisted = await readCheckpoint(operationId);
      if (!persisted) throw new Error('Quotation child result was not persisted before aggregation');
      const persistedChild = await loadChild(chunk, persisted);
      const validated = validateQuotationChildResult(persistedChild);
      results.push({
        ...persistedChild,
        response: validated.markdown,
        markdown: validated.markdown,
      });
    }
    interruptedChunkIndex = undefined;
    await service.transitionRun({ ...leaseInput, status: 'finalizing' });
    const aggregate = buildQuotationSystemOrderForReview({
      fullOcrResult: snapshot.orderMarkdown,
      childResults: results,
    });
    const final = finalizeQuotationMainResponse({
      fullOcrResult: snapshot.orderMarkdown,
      mainResponse: aggregate.systemOrderMarkdown,
      childResults: results,
    });
    const canonical = canonicalizeSystemOrderMarkdown(final.systemOrderMarkdown);
    if (!canonical) throw new Error('Quotation has no complete system order');
    const systemOrder = canonical.markdown;
    const calculationCheckpoint = buildSteelCalculationCheckpoint(canonical.sha256, final.rows, results);
    await checkpoint('system-order:normalized', 'main', systemOrder);
    await checkpoint('calculation:basis', 'main', JSON.stringify(calculationCheckpoint));

    const publicationRun = await assertActive();
    const publicationState = await service.readState(scope);
    if (!publicationState || publicationState.activeRun?.runId !== publicationRun.runId) {
      throw new Error('Quotation publication state is no longer current');
    }
    const publicationAdmission =
      refreshedPublicationAdmission ?? publicationState.markdownPublication?.admission;
    const publicationCustomer = publicationState.currentCustomer;
    const runTargetMessageId = publicationRun.targetMessageId;
    const customerQuote = buildCustomerQuoteFromMarkdown(systemOrder);
    if (!publicationAdmission || !publicationCustomer || !runTargetMessageId || !customerQuote) {
      throw new Error('Quotation publication proof is unavailable before summary');
    }
    const reviewMetadata = buildQuotationReviewMetadata({
      snapshot,
      systemOrderMarkdown: systemOrder,
      runId,
      systemOutputId: `system_order:${runId}`,
      messageId: runTargetMessageId,
      calculationCheckpoint,
    });
    const publishedSystemOrder: SteelQuotationCurrentSystemOrder = {
      runId,
      messageId: runTargetMessageId,
      markdown: systemOrder,
      sha256: canonical.sha256,
      customerQuoteMarkdown: customerQuote.markdown,
      calculationCheckpoint,
      ...(snapshot.sourceSnapshot ? { sourceSnapshot: snapshot.sourceSnapshot } : {}),
      ...(snapshot.ocrSelection ? { ocrSelection: snapshot.ocrSelection } : {}),
      ...(reviewMetadata ? { reviewMetadata } : {}),
      updatedAt: new Date(),
    };
    // Publication reads and writes the same state document as lease renewal.
    heartbeatEnabled = false;
    clearInterval(heartbeat);
    await heartbeatPending;
    controller.signal.throwIfAborted();
    await renewLease();
    controller.signal.throwIfAborted();
    const orderPublication = await input.publishFinal({
      scope,
      runId,
      runTargetMessageId,
      targetMessageId: runTargetMessageId,
      run: publicationRun,
      markdown: systemOrder,
      finalSha256: canonical.sha256,
      currentOrderSha256: snapshot.orderHash,
      currentSystemOrderSha256: canonical.sha256,
      calculationCheckpoint,
      ...(snapshot.sourceSnapshot ? { sourceSnapshot: snapshot.sourceSnapshot } : {}),
      ...(reviewMetadata ? { reviewMetadata } : {}),
      customer: {
        preparationId: publicationCustomer.preparationId,
        customerIdentity: publicationCustomer.customerIdentity,
        customerMarkdown: publicationCustomer.customerMarkdown,
      },
      orderPublication: {
        leaseToken: lease.leaseToken,
        inputSnapshotSha256: run.snapshotRef.sha256,
        normalizedSha256: canonical.sha256,
        admission: publicationAdmission,
        systemOrder: publishedSystemOrder,
        signal: controller.signal,
      },
      message: {
        messageId: runTargetMessageId,
        conversationId: scope.conversationId,
        user: scope.userId,
        text: systemOrder,
        ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
      },
    });
    if (orderPublication && !orderPublication.ok) {
      throw new SteelQuotationPublicationError(orderPublication.code);
    }
    orderPublished = true;
    clearInterval(heartbeat);

    const committedState = await service.readState(scope);
    const committedRun = committedState?.activeRun;
    if (!committedRun || committedRun.runId !== runId || committedRun.status !== 'completed') {
      throw new Error('Quotation publication did not complete the quotation run');
    }
    await input.onProgress?.({
      run: committedRun,
      ...getQuotationProgress(committedRun),
      stage: 'main_consolidating',
    });

    const assertSummaryActive = async (): Promise<ISteelQuotationState> => {
      controller.signal.throwIfAborted();
      const state = await service.readState(scope);
      const active = state?.activeRun;
      if (
        !state ||
        !active ||
        active.runId !== runId ||
        active.status !== 'completed' ||
        active.targetMessageId !== runTargetMessageId ||
        !active.checkpointRefs.some((ref) => ref.operationId === 'order-published') ||
        !(await service.isPublishedRun(scope, active))
      ) {
        throw new Error('Quotation summary execution is no longer current');
      }
      const admission = state.markdownPublication?.admission;
      const owner = state.markdownPublication?.current?.system_order;
      const baseline = owner?.ai;
      if (
        !admission ||
        JSON.stringify(admission) !== JSON.stringify(publicationAdmission) ||
        !baseline ||
        baseline.source !== 'ai' ||
        baseline.outputId !== `system_order:${runId}` ||
        baseline.messageId !== runTargetMessageId ||
        baseline.sha256 !== publishedSystemOrder.sha256 ||
        baseline.generationId !== `quotation:${runId}` ||
        baseline.lineageId !== publicationAdmission.lineageId
      ) {
        throw new Error('Quotation summary publication owner is no longer current');
      }
      return state;
    };

    let reviewOutput = '無待複核事項。';
    await input.onProgress?.({
      run: committedRun,
      ...getQuotationProgress(committedRun),
      stage: 'main_review_started',
    });
    const summaryStreamFilter = createQuotationSummaryStreamFilter();
    let summaryStream = Promise.resolve();
    let streamedSummary = false;
    let summaryStreamingStarted = false;
    let streamedSummaryText = '';
    let summaryStreamError: unknown;
    const streamSummaryDelta = async (text: string): Promise<void> => {
      const safe = summaryStreamFilter.append(text);
      if (!safe) return;
      streamedSummary = true;
      streamedSummaryText += safe;
      if (!summaryStreamingStarted) {
        summaryStreamingStarted = true;
        await input.onProgress?.({
          run: committedRun,
          ...getQuotationProgress(committedRun),
          stage: 'main_streaming',
        });
      }
      summaryStream = summaryStream.then(async () => {
        try {
          await input.onTextDelta!(safe);
        } catch (error) {
          summaryStreamError ??= error;
        }
      });
      await summaryStream;
    };
    const output = await (input.invokeModel ?? invokeQuotationModel)({
      role: 'main',
      executionId: `quotation:${runId}:main`,
      // Main output is streamed through a bounded section filter. Provider
      // deltas cannot write backend tables or quotation control sections.
      onTextDelta: input.onTextDelta ? streamSummaryDelta : undefined,
      prompt: snapshot.prompts.main,
      input: JSON.stringify({
        order: snapshot.orderMarkdown,
        ...(snapshot.sourceSnapshot
          ? { source_mappings: snapshot.sourceSnapshot.mappings }
          : {}),
        customer: snapshot.customerMarkdown,
        system_order: systemOrder,
        review_remarks: aggregate.reviewRemarks,
      }),
      modelOptions: input.modelOptions,
      signal: controller.signal,
      assertActive: async () => {
        await assertSummaryActive();
      },
      onUsage: input.onUsage ? (usage) => operational(() => input.onUsage!(usage)) : undefined,
      onPythonEvidence: async () => {
        await assertSummaryActive();
      },
    });
    await assertSummaryActive();
    if (input.onTextDelta) {
      const tail = summaryStreamFilter.finish();
      if (tail) await streamSummaryDelta(tail);
      await summaryStream;
    }
    reviewOutput = sanitizeQuotationSummary(output.markdown || streamedSummaryText || reviewOutput);
    // Review prose is model-owned. Counting display rows never gates the saved quotation.
    const reviews = reviewOutput.trim() === '無待複核事項。' ? '' : reviewOutput.trim();
    const reviewDocument = parseAssistantMarkdown(reviews);
    const reviewSections = reviewDocument.sections;
    const reviewDisplay = [
      reviewDocument.preamble.trim(),
      ...reviewSections
        .filter((section) => section.title !== 'notes')
        .map((section) => section.raw.trim()),
      ...reviewSections
        .filter((section) => section.title === 'notes')
        .map((section) => section.raw.trim()),
    ]
      .filter(Boolean)
      .join('\n\n');
    const reviewCount = reviewSections
      .filter((section) => ['manual_reviews', 'manual_review'].includes(section.title))
      .flatMap((section) => parseMarkdownTables(section.body))
      .reduce((count, table) => count + table.rows.length, 0);
    const failedMaterialCount = results.reduce(
      (count, child) => count + (child.backendFailure ? child.chunk.sourceRows.length : 0),
      0,
    );
    let completion: string;
    if (reviewCount > 0) {
      completion = `查價輸出完成：共 ${final.rows.length} 筆 system_order、${reviewCount} 項待複核事項。`;
    } else if (reviews || failedMaterialCount > 0) {
      completion = `查價輸出完成：共 ${final.rows.length} 筆 system_order。`;
    } else {
      completion = final.summary;
    }
    const categoryColumn = quotationSystemOrderColumns.indexOf('類別');
    const materialCount = final.rows.filter(
      (row) => !row[categoryColumn]?.trim().startsWith('加工/'),
    ).length;
    const sourceCount = chunks.reduce((count, chunk) => count + chunk.sourceRows.length, 0);
    const processingCount = final.rows.length - materialCount;
    const failureSummary =
      failedMaterialCount > 0
        ? `\n\n${failedMaterialCount} 個材料項次報價失敗，已保留 OCR 原值及空白報價欄位，需人工複核。`
        : '';
    const summary = `${completion}\n\n項次核對：材料項次 ${materialCount}／原始訂單 ${sourceCount} 項；加工列 ${processingCount} 筆。${failureSummary}`;
    const footer = `## quote_summary\n\n${summary}`;
    if (input.onTextDelta && reviewDisplay && !streamedSummary) {
      await input.onTextDelta(`\n\n${reviewDisplay}`);
    }
    const summaryInput: SteelQuotationSummaryInput = {
      scope,
      runId,
      targetMessageId: runTargetMessageId,
      sourceMessageId: input.summarySourceMessageId ?? publicationAdmission.responseId,
      admission: publicationAdmission,
      summaryMarkdown: reviewDisplay,
      footerMarkdown: footer,
    };
    if (input.appendSummary) {
      const saved = await input.appendSummary(summaryInput);
      if (!saved.ok) throw new SteelQuotationPublicationError(saved.code);
      try {
        await input.onSummaryCommitted?.(saved.message);
      } catch {
        // Delivery cannot undo the completed message already stored in the database.
      }
      return { status: 'completed', markdown: saved.message.text ?? systemOrder };
    }
    if (summaryStreamError) throw summaryStreamError;
    return { status: 'completed', markdown: systemOrder };

    async function readCheckpoint(operationId: string): Promise<string | undefined> {
      try {
        return await service.readCheckpoint({ scope, runId, operationId });
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    }

    async function recoverChild(
      chunk: ReturnType<typeof buildQuotationChunks>[number],
      path: string,
      depth: number,
    ): Promise<LoadedQuotationChild[]> {
      await assertActive();
      const leafOperation = `leaf-v2:${chunk.chunkIndex}:${path}`;
      const splitOperation = `split-v2:${chunk.chunkIndex}:${path}`;
      const [saved, split] = await Promise.all([
        readCheckpoint(leafOperation),
        readCheckpoint(splitOperation),
      ]);
      if (saved && !split) {
        const loaded = await loadChild(chunk, saved);
        validateQuotationChildResult(loaded);
        const active = await assertActive();
        if (!active.checkpointRefs.some((ref) => ref.operationId === leafOperation)) {
          await checkpoint(leafOperation, 'chunk', saved);
        }
        await progress(chunk.chunkIndex, undefined, 'chunk_saved', path);
        return [loaded];
      }
      let failureReason = '報價子 Agent 未能產出有效結果';
      if (!split) {
        let output: string;
        try {
          output = await generateChild(chunk, path);
        } catch (error) {
          await assertActive();
          if (!(error instanceof QuotationChildFailure)) throw error;
          failureReason = error.message;
          output = '';
        }
        if (output) {
          await checkpoint(leafOperation, 'chunk', output);
          const loaded = await loadChild(chunk, output);
          await progress(chunk.chunkIndex, undefined, 'chunk_saved', path);
          return [loaded];
        }
      }
      if (depth === QUOTATION_V2_MAX_DEPTH) {
        if (split) throw new Error('Quotation recovery exceeds its retry limit');
        const backendFailure: QuotationBackendFailure = { retryDepth: 3, reason: failureReason };
        const output = JSON.stringify({
          markdown: buildQuotationFailureMarkdown(chunk, failureReason),
          backendFailure,
          sourceRowIds: chunk.sourceRows.map((row) => row.sourceRowId),
          lookupOperations: [],
          pythonOperations: [],
        });
        await checkpoint(leafOperation, 'chunk', output);
        const loaded = await loadChild(chunk, output);
        validateQuotationChildResult(loaded);
        await progress(chunk.chunkIndex, undefined, 'chunk_saved', path);
        return [loaded];
      }
      const rowsPerSlice = QUOTATION_V2_SPLIT_SIZES[depth as 0 | 1 | 2]!;
      const slices = splitQuotationChunk(chunk, rowsPerSlice);
      const sourceRowIds = slices.map((slice) => slice.sourceRows.map((row) => row.sourceRowId));
      if (split) {
        const plan = JSON.parse(split) as {
          version: number;
          depth: number;
          rowsPerSlice: number;
          sourceRowIds: string[][];
        };
        if (
          plan.version !== 2 ||
          plan.depth !== depth ||
          plan.rowsPerSlice !== rowsPerSlice ||
          JSON.stringify(plan.sourceRowIds) !== JSON.stringify(sourceRowIds)
        ) {
          throw new Error('Saved quotation recovery plan does not match its source rows');
        }
        const active = await assertActive();
        if (!active.checkpointRefs.some((ref) => ref.operationId === splitOperation)) {
          await checkpoint(splitOperation, 'main', split);
        }
      } else {
        await checkpoint(
          splitOperation,
          'main',
          JSON.stringify({ version: 2, depth, rowsPerSlice, sourceRowIds }),
        );
      }
      const children: LoadedQuotationChild[] = [];
      for (let index = 0; index < slices.length; index += 1) {
        children.push(...(await recoverChild(slices[index]!, `${path}.${index + 1}`, depth + 1)));
      }
      return children;
    }

    async function generateChild(
      chunk: ReturnType<typeof buildQuotationChunks>[number],
      recoveryPath: string,
    ): Promise<string> {
      const attempt = `node-${recoveryPath}-${randomUUID()}`;
      await progress(chunk.chunkIndex, attempt, 'chunk_started', recoveryPath);
      const lookupOperations: string[] = [];
      const pythonOperations: string[] = [];
      const toolState = createSteelToolRunState(120);
      let revision = 0;
      let historyRevision = 0;
      let generated: Awaited<ReturnType<typeof invokeQuotationModel>>;
      try {
        generated = await (input.invokeModel ?? invokeQuotationModel)({
          role: 'child',
          executionId: `quotation:${runId}:child:${chunk.chunkIndex}:${recoveryPath}`,
          maxChildRepairAttempts: 0,
          prompt: snapshot.prompts.child,
          input: JSON.stringify({
            chunk: chunk.markdown,
            ...(snapshot.sourceSnapshot
              ? { source_mappings: snapshot.sourceSnapshot.mappings }
              : {}),
            customer: snapshot.customerMarkdown,
          }),
          modelOptions: input.modelOptions,
          signal: controller.signal,
          assertActive: async () => {
            await assertActive();
          },
          onUsage: input.onUsage ? (usage) => operational(() => input.onUsage!(usage)) : undefined,
          onChildMessages: async (messages) => {
            await checkpoint(
              `child-history:${chunk.chunkIndex}:${attempt}:${historyRevision++}`,
              'main',
              JSON.stringify(messages),
            );
          },
          onChildRepair: async (repair) => {
            const active = await assertActive();
            const event = buildSteelQuotationStatusEvent({
              ...repair,
              conversationId: scope.conversationId,
              runId,
              index: active.index,
              status: active.status,
              ...(active.ocrSelection
                ? { ocrSource: quotationOcrSource(active.ocrSelection) }
                : {}),
              ...getQuotationProgress(active),
              chunkIndex: chunk.chunkIndex,
              attempt,
            });
            await checkpoint(
              `repair:${chunk.chunkIndex}:${attempt}:${repair.repairAttempt}:${repair.stage}`,
              'main',
              JSON.stringify(event),
            );
            await operational(async () =>
              input.onProgress?.({
                ...event,
                ...getQuotationProgress(active, chunk.chunkIndex, recoveryPath),
                stage: repair.stage,
                run: active,
              }),
            );
          },
          validateChildOutput: async (markdown) => {
            await assertActive();
            const normalizedMarkdown = normalizeSteelChunkMarkdown('system_order_chunk', markdown);
            const output = JSON.stringify({
              markdown: normalizedMarkdown,
              lookupOperations,
              pythonOperations,
              sourceRowIds: chunk.sourceRows.map((row) => row.sourceRowId),
            });
            await checkpoint(
              `child-output:${chunk.chunkIndex}:${attempt}:${revision++}`,
              'main',
              output,
            );
            validateQuotationChildResult(await loadChild(chunk, output));
          },
          onPythonEvidence: async (evidence) => {
            const key = `python:${chunk.chunkIndex}:${attempt}:${evidence.toolCallId}:${evidence.type}`;
            await checkpoint(key, 'tool', JSON.stringify(evidence));
            pythonOperations.push(key);
          },
          lookup: async (id, args) => {
            const active = await assertActive();
            await operational(async () =>
              input.onTool?.({
                run: active,
                id,
                chunkIndex: chunk.chunkIndex,
                attempt,
                arguments: args,
              }),
            );
            const result = input.executeLookup
              ? await input.executeLookup(args, id)
              : await executeSteelTool({
                  client: input.client ?? (pool ??= createSteelPostgresPool()),
                  toolName: 'search_price_candidates',
                  arguments: args,
                  providerToolCallId: id,
                  runState: toolState,
                });
            const activeAfterLookup = await assertActive();
            const key = `lookup:${chunk.chunkIndex}:${attempt}:${id}`;
            await checkpoint(
              key,
              'tool',
              JSON.stringify({ lookupCallId: id, arguments: args, result }),
            );
            lookupOperations.push(key);
            await operational(async () =>
              input.onTool?.({
                run: activeAfterLookup,
                id,
                chunkIndex: chunk.chunkIndex,
                attempt,
                arguments: args,
                result,
              }),
            );
            return result;
          },
        });
      } catch (error) {
        await assertActive();
        throw new QuotationChildFailure(
          error instanceof QuotationProtocolError
            ? '報價表格不完整或格式無效'
            : '報價子 Agent 執行失敗',
        );
      }
      const sourceRowIds = chunk.sourceRows.map((row) => row.sourceRowId);
      const normalizedMarkdown = normalizeSteelChunkMarkdown(
        'system_order_chunk',
        generated.markdown,
      );
      let stored = JSON.stringify({
        markdown: normalizedMarkdown,
        lookupOperations,
        pythonOperations,
        sourceRowIds,
      });
      await checkpoint(`child-output:${chunk.chunkIndex}:${attempt}`, 'main', stored);
      const candidate = await loadChild(chunk, stored);
      let validated: ReturnType<typeof validateQuotationChildResult>;
      try {
        validated = validateQuotationChildResult(candidate);
      } catch (error) {
        if (!(error instanceof QuotationProtocolError)) throw error;
        throw new QuotationChildFailure('報價表格不完整或格式無效');
      }
      stored = JSON.stringify({
        markdown: validated.markdown,
        lookupOperations,
        pythonOperations,
        sourceRowIds,
      });
      return stored;
    }

    async function loadChild(
      chunk: ReturnType<typeof buildQuotationChunks>[number],
      serialized: string,
    ): Promise<LoadedQuotationChild> {
      try {
        const saved = JSON.parse(serialized) as SavedQuotationChild;
        if (
          saved.sourceRowIds &&
          JSON.stringify(saved.sourceRowIds) !==
            JSON.stringify(chunk.sourceRows.map((row) => row.sourceRowId))
        ) {
          throw new Error('Saved quotation chunk does not match its source rows');
        }
        const [lookupEvidence, pythonEvidence] = await Promise.all([
          Promise.all(saved.lookupOperations.map(async (key): Promise<QuotationLookupEvidence> => {
            const evidence = await readCheckpoint(key);
            if (!evidence) throw new Error('Quotation lookup evidence is missing');
            const lookup = JSON.parse(evidence) as SavedQuotationLookup;
            if (lookup.result.toolName !== 'search_price_candidates') {
              throw new Error('Quotation lookup evidence is for an unauthorized tool');
            }
            return { lookupCallId: lookup.lookupCallId, persisted: true, result: lookup.result };
          })),
          Promise.all(saved.pythonOperations.map(async (key): Promise<QuotationPythonEvidence> => {
            const payload = await readCheckpoint(key);
            if (!payload) throw new Error('Quotation Python evidence is missing');
            return JSON.parse(payload) as QuotationPythonEvidence;
          })),
        ]);
        return {
          chunk,
          response: normalizeSteelChunkMarkdown(
            'system_order_chunk',
            stripLegacyQuotationChildSidecars(saved.markdown),
          ),
          lookupEvidence,
          pythonEvidence,
          lookupOperations: saved.lookupOperations,
          pythonOperations: saved.pythonOperations,
          ...(saved.backendFailure ? { backendFailure: saved.backendFailure } : {}),
        };
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    }
  } catch (error) {
    heartbeatEnabled = false;
    clearInterval(heartbeat);
    await heartbeatPending;
    let current: ISteelQuotationState | null | undefined;
    let stateReadError: unknown;
    try {
      current = await service.readState(scope);
    } catch (readError) {
      stateReadError = readError;
    }
    const isStop = isOwnedAbortError(error, input.signal) || error === input.signal.reason;
    if (!isStop) {
      const rawCode = error instanceof Error
        ? Reflect.get(error, 'code') ?? Reflect.get(error, 'status')
        : undefined;
      const code =
        (typeof rawCode === 'string' && rawCode.length > 0) || typeof rawCode === 'number'
          ? rawCode
          : null;
      try {
        logger.error(JSON.stringify({
          code,
          message: getSafeErrorText(error instanceof Error ? error.message : 'Unknown error'),
          conversationId: scope.conversationId,
          responseId: input.summarySourceMessageId ?? run.targetMessageId,
        }));
      } catch {
        // Logging must never replace the original quotation error.
      }
    }
    if (stateReadError && !orderPublished) throw error;
    const currentRun = current?.activeRun;
    let publicationCommitted = orderPublished;
    if (!publicationCommitted && currentRun?.runId === runId && currentRun.status === 'completed') {
      try {
        publicationCommitted = await service.isPublishedRun(scope, currentRun);
      } catch {
        throw error;
      }
    }
    if (publicationCommitted) {
      if (!isStop) throw error;
      return {
        status: 'completed',
        ...(current?.currentSystemOrder?.markdown
          ? { markdown: current.currentSystemOrder.markdown }
          : {}),
      };
    }
    if (current?.activeRun?.runId === runId && current.activeRun.status === 'cancelled') {
      await input.onProgress?.({
        run: current.activeRun,
        ...getQuotationProgress(current.activeRun),
      });
      return { status: 'cancelled' };
    }
    const interrupted = await service.interruptRun({
      ...leaseInput,
      interruption: {
        reason: isStop ? 'paused' : 'error',
        ...(interruptedChunkIndex !== undefined && { chunkIndex: interruptedChunkIndex }),
      },
    });
    if (interrupted) {
      try {
        await input.onProgress?.({ run: interrupted, ...getQuotationProgress(interrupted) });
      } catch {
        // The durable interrupted state remains authoritative if the stream has closed.
      }
    }
    throw error;
  } finally {
    heartbeatEnabled = false;
    clearInterval(heartbeat);
    input.signal.removeEventListener('abort', abort);
    registration.dispose();
  }
}
