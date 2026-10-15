import { createHash } from 'node:crypto';
import {
  bindSteelReviewRowsToOcrContext,
  createSteelReviewOcrContext,
  parseSteelReviewMarkdownTables,
  normalizeSteelReviewLedgerRows,
  steelQuotationMessagePublicationSchema,
  steelSectionBaseTitle,
} from 'librechat-data-provider';
import type { SteelReviewMetadata, SteelQuotationMessagePublication } from 'librechat-data-provider';
import type { ClientSession } from 'mongoose';
import type { IMessage, IConversation, ISteelQuotationState, ISteelQuotationArtifact, ISteelReviewOutput, ISteelConversationOcrState, SteelQuotationScope, SteelMarkdownAdmissionInput, SteelMarkdownAdmission, SteelMarkdownExpected, SteelMarkdownPublicationInput, SteelMarkdownPublicationResult, SteelMarkdownReference, SteelMarkdownKind, SteelMarkdownVersion, SteelQuotationSnapshotPayload, SteelQuotationOrderPublicationReceipt, SteelMarkdownQuotationOrderInput, SteelQuotationSummaryAppendInput, SteelQuotationSummaryAppendResult, SteelQuotationSummaryReceipt, SteelQuotationCheckpointRef, SteelQuotationErrorsAppendInput, SteelQuotationErrorsAppendResult, SteelQuotationPublicationProof, SteelQuotationPublicationSaveResult, SteelQuotationSavedMessage } from '~/types';
import type { SteelReviewAuthorizedFile } from './steelSourceAuthorization';
import { createSteelDelegateOcrRunModel, createSteelQuotationStateModel, createSteelQuotationArtifactModel, createSteelConversationOcrStateModel, createSteelReviewOutputModel } from '~/models/steel';
import { hasConsistentMessageText, renderMessageTextContent } from '~/utils/content';
import { createSteelReviewSourceAuthorization } from './steelSourceAuthorization';
import { createSteelScopedOcrMethods, hasUniqueSteelOcrScope } from './ocr';
import { protectSteelConversationWrite } from '~/models/steel/lifecycle';
import { STEEL_QUOTATION_INPUT_TTL_MS } from './steelQuotationInput';
import { createSteelQuotationPublicationProof } from './published';
import { steelReviewTitleStorageId } from '~/utils/identity';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';

type Mongoose = typeof import('mongoose');
type SaveMessage = (input: SteelMarkdownPublicationInput, message: SteelMarkdownPublicationInput['message'], session: ClientSession) => Promise<IMessage | null | undefined>;
const kinds: SteelMarkdownKind[] = ['ocr_result', 'system_order', 'customer_data'];
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const equal = (left: object | undefined, right: object | undefined): boolean => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
}
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(canonicalJson(left ?? null)) === JSON.stringify(canonicalJson(right ?? null));
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Steel quotation publication aborted');
}
const scopeFilter = (scope: SteelQuotationScope) => ({ userId: scope.userId, conversationId: scope.conversationId,
  ...(scope.tenantId === undefined ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] } : { tenantId: scope.tenantId }) });
const messageFilter = (scope: SteelQuotationScope, messageId?: string) => ({ user: scope.userId, conversationId: scope.conversationId,
  ...(messageId ? { messageId } : {}), ...(scope.tenantId === undefined ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] } : { tenantId: scope.tenantId }) });

function textContentIndex(content: unknown[] | undefined, predicate: (text: string) => boolean): number {
  return (content ?? []).findIndex((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part) || Reflect.get(part, 'type') !== 'text') return false;
    const text = Reflect.get(part, 'text');
    return typeof text === 'string' && predicate(text);
  });
}

function hasSection(markdown: string, names: readonly string[]): boolean {
  const expected = new Set(names);
  return [...markdown.matchAll(/^ {0,3}#{1,6}[ \t]+([^\n#]+?)[ \t]*#?[ \t]*$/gmu)].some((match) => {
    const title = steelSectionBaseTitle(match[1] ?? '').toLowerCase();
    return title !== undefined && expected.has(title);
  });
}

function validSummaryMarkdown(markdown: string): boolean {
  if (!markdown.trim()) return true;
  return !hasSection(markdown, [
    'system_order', 'system_order_chunk', 'manual_reviews_chunk', 'ocr_result', 'customer_data',
    'customer_quote', 'control', 'signal', 'quote_signal', 'quote_lineage',
    'ocr_result_updates', 'ocr_deletions', 'ocr_update_summary', 'system_order_revision',
    'system_order_updates', 'customer_data_updates',
  ]);
}

function orderContentSlots(content: unknown[] | undefined, text: string): {
  content: unknown[];
  tableContentIndex: number;
  summaryContentIndex: number;
  footerContentIndex: number;
} {
  const next = [...(content ?? [])];
  let tableContentIndex = textContentIndex(next, (part) => hasSection(part, ['system_order']));
  if (tableContentIndex < 0) {
    tableContentIndex = next.length;
    next.push({ type: 'text', text });
  }
  const summaryContentIndex = next.length;
  next.push({ type: 'text', text: '' });
  const footerContentIndex = next.length;
  next.push({ type: 'text', text: '' });
  return { content: next, tableContentIndex, summaryContentIndex, footerContentIndex };
}

function expected(state: ISteelQuotationState | null, ocr: ISteelConversationOcrState | null): SteelMarkdownExpected {
  return {
    ...(ocr?.currentOcrResultGenerationId ? { ocrGeneration: ocr.currentOcrResultGenerationId } : {}),
    ...(ocr?.currentOcrResultMarkdown ? { ocrHash: sha(ocr.currentOcrResultMarkdown) } : {}),
    ...(state?.currentOrder?.sha256 ? { orderHash: state.currentOrder.sha256 } : {}),
    ...(state?.currentSystemOrder?.sha256 ? { systemOrderHash: state.currentSystemOrder.sha256 } : {}),
    ...(state?.currentCustomer?.preparationId ? { customerPreparationId: state.currentCustomer.preparationId } : {}),
    ...(state?.markdownPublication?.current ? { owners: state.markdownPublication.current } : {}),
  };
}
function validTargets(input: SteelMarkdownPublicationInput): boolean {
  const quotationTarget = input.quotationOrder;
  const sourceMatchesAdmission = input.message.sourceMessageId === undefined
    ? input.message.messageId === input.admission.responseId
    : input.message.sourceMessageId === input.admission.responseId;
  const targetMatchesAdmission = quotationTarget
    ? input.message.messageId === quotationTarget.runTargetMessageId &&
      sourceMatchesAdmission
    : input.message.messageId === input.admission.responseId;
  if (!input.scope.userId || !input.scope.conversationId || input.message.user !== input.scope.userId ||
    input.message.conversationId !== input.scope.conversationId || !targetMatchesAdmission ||
    input.message.tenantId !== input.scope.tenantId || input.message.isCreatedByUser !== false || !input.message.text || input.targets.length === 0 ||
    new Set(input.targets.map((target) => target.kind)).size !== input.targets.length ||
    (quotationTarget && (input.targets.length !== 1 || input.targets[0]?.kind !== 'system_order' || !input.systemOrder))) return false;
  const tables = parseSteelReviewMarkdownTables(input.message.text);
  return input.targets.every((target) => {
    const rendered = tables.filter((table) => table.title === target.title);
    const baseline = parseSteelReviewMarkdownTables(target.baselineMarkdown).filter((table) => table.title === target.title);
    const parsedKind = target.title.split(/[\s｜:：([{]/u)[0];
    if (!kinds.includes(target.kind) || parsedKind !== target.kind || rendered.length !== 1 || baseline.length !== 1 ||
      !equal({ headers: rendered[0].headers, rows: rendered[0].rows }, { headers: baseline[0].headers, rows: baseline[0].rows })) return false;
    if (target.kind === 'customer_data') return Boolean(input.customer && input.customer.customerMarkdown === target.baselineMarkdown);
    const table = baseline[0];
    if (!target.headers || !target.rows || !equal({ headers: target.headers }, { headers: table.headers }) ||
      table.rows.length !== target.rows.length || table.rows.some((row) => row.length !== table.headers.length)) return false;
    return target.rows.every((row, index) => row.rowId === sha(`${target.outputId}:${index}:${JSON.stringify(table.rows[index])}`) &&
      !row.deleted && row.origin !== 'manual' && table.headers.every((header, column) => row.values[header]?.baseline === table.rows[index][column] &&
        row.values[header]?.effective === table.rows[index][column]));
  });
}

function scopedArtifactRef(
  scope: SteelQuotationScope,
  ref: { userId: string; conversationId: string; tenantId?: string; runId: string; operationId: string; kind: string; sha256: string },
  runId: string,
): boolean {
  return ref.userId === scope.userId && ref.conversationId === scope.conversationId &&
    ref.tenantId === scope.tenantId && ref.runId === runId;
}

function parsePayload<T>(payload: string): T | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : null;
  } catch {
    return null;
  }
}

function checkpointMatchesRef(
  ref: Pick<SteelQuotationCheckpointRef, 'operationId' | 'kind' | 'artifactId' | 'sha256'>,
  candidate: Pick<SteelQuotationCheckpointRef, 'operationId' | 'kind' | 'artifactId' | 'sha256'>,
): boolean {
  return ref.operationId === candidate.operationId && ref.kind === candidate.kind &&
    ref.artifactId === candidate.artifactId && ref.sha256 === candidate.sha256;
}

function sourceFileIds(rows: SteelReviewMetadata['rows'] | undefined): string[] {
  return (rows ?? []).flatMap((row) => row.source?.fileId ? [row.source.fileId] : []);
}

function fallbackOcrContextMatches(
  context: NonNullable<SteelReviewMetadata['ocrContext']>,
  snapshot: SteelQuotationSnapshotPayload,
): boolean {
  const selected = snapshot.ocrSelection?.selected;
  const tables = parseSteelReviewMarkdownTables(snapshot.orderMarkdown).filter((table) =>
    steelSectionBaseTitle(table.title ?? '') === 'ocr_result');
  if (tables.length !== 1 || !tables[0]?.title || !selected ||
    context.title !== tables[0].title || context.outputId !== selected.outputId ||
    context.revision !== selected.revision || JSON.stringify(context.headers) !== JSON.stringify(tables[0].headers) ||
    context.rows.length !== tables[0].rows.length) return false;
  const mappings = snapshot.sourceSnapshot?.mappings ?? [];
  const sourceIndex = tables[0].headers.indexOf('來源');
  return context.rows.every((row, index) => {
    const cells = tables[0]?.rows[index];
    if (!cells || row.rowId !== sha(`${context.outputId}:${index}:${JSON.stringify(cells)}`) ||
      row.origin !== undefined || row.deleted !== undefined || row.insertion !== undefined || row.system !== undefined ||
      row.calculation !== undefined || row.ocrLink !== undefined) return false;
    const headers = tables[0]?.headers ?? [];
    if (Object.keys(row.values).length !== headers.length || headers.some((header, column) =>
      row.values[header]?.baseline !== cells[column] || row.values[header]?.effective !== cells[column])) return false;
    const sourceCode = sourceIndex >= 0 ? cells[sourceIndex]?.trim() : '';
    const mapping = mappings.filter((candidate) => candidate.sourceCode === sourceCode);
    if (mapping.length !== 1) return row.source === null;
    return row.source?.fileId === mapping[0].fileId && row.source.pageNumber === null &&
      row.source.filename === mapping[0].sourceFilename &&
      row.source.mediaType === mapping[0].mediaType;
  });
}

function frozenChunkSourceRowIds(
  orderMarkdown: string,
  chunks: readonly { index: number; sourceRowCount: number }[],
): string[][] | null {
  if (chunks.length === 0) return null;
  const tables = parseSteelReviewMarkdownTables(orderMarkdown).filter((table) =>
    steelSectionBaseTitle(table.title ?? '') === 'ocr_result');
  const table = tables.length === 1 ? tables[0] : undefined;
  const categoryIndex = table?.headers.indexOf('類別') ?? -1;
  if (!table || categoryIndex < 0 || table.rows.length === 0) return null;
  const ordered = [...chunks].sort((left, right) => left.index - right.index);
  if (ordered.some((chunk, position) => chunk.index !== position + 1 ||
    !Number.isSafeInteger(chunk.sourceRowCount) || chunk.sourceRowCount <= 0)) return null;
  const categories = new Map<string, string[]>();
  table.rows.forEach((row, rowIndex) => {
    const category = row[categoryIndex] ?? '';
    const sourceRows = categories.get(category) ?? [];
    sourceRows.push(`source-row-${rowIndex + 1}`);
    categories.set(category, sourceRows);
  });
  const expected: string[][] = [];
  let chunkIndex = 0;
  for (const sourceRows of categories.values()) {
    let offset = 0;
    while (offset < sourceRows.length) {
      const chunk = ordered[chunkIndex++];
      if (!chunk || chunk.sourceRowCount > sourceRows.length - offset) return null;
      expected.push(sourceRows.slice(offset, offset + chunk.sourceRowCount));
      offset += chunk.sourceRowCount;
    }
  }
  return chunkIndex === ordered.length ? expected : null;
}

/** Scoped full publication. All writes and mirror checks share one Mongo transaction. */
export interface SteelPublicationMethods {
  admitSteelMarkdown(input: SteelMarkdownAdmissionInput): Promise<SteelMarkdownAdmission | null>;
  publishSteelMarkdown(input: SteelMarkdownPublicationInput): Promise<SteelMarkdownPublicationResult>;
  appendSteelQuotationSummary(input: SteelQuotationSummaryAppendInput): Promise<SteelQuotationSummaryAppendResult>;
  appendSteelQuotationErrors(input: SteelQuotationErrorsAppendInput): Promise<SteelQuotationErrorsAppendResult>;
  readSteelMarkdownVersions(scope: SteelQuotationScope): Promise<SteelMarkdownVersion[] | null>;
  saveSteelQuotationMessage(input: SteelQuotationPublicationProof): Promise<SteelQuotationPublicationSaveResult>;
}

export function createSteelPublicationMethods(mongoose: Mongoose, saveMessage: SaveMessage): SteelPublicationMethods {
  const State = createSteelQuotationStateModel(mongoose);
  const DelegateRun = createSteelDelegateOcrRunModel(mongoose);
  const Ocr = createSteelConversationOcrStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const Output = createSteelReviewOutputModel(mongoose);
  const Conversation = createConversationModel(mongoose);
  const Message = createMessageModel(mongoose);
  const authorizeFiles = createSteelReviewSourceAuthorization(mongoose);
  const hasScopedOcrIdentity = (scope: SteelQuotationScope, session?: ClientSession) =>
    hasUniqueSteelOcrScope(Conversation, scope, session);
  const { readScopedConversationOcrState: readScopedOcr } = createSteelScopedOcrMethods(mongoose);
  const quotationOrderSuperseded = new Error('Steel quotation order publication superseded');

  type QuotationOrderGuard = { valid: boolean; replay?: SteelMarkdownPublicationResult };

  async function validateQuotationOrder(
    input: SteelMarkdownPublicationInput,
    conversation: IConversation,
    state: ISteelQuotationState,
    ocr: ISteelConversationOcrState | null,
    session: ClientSession,
  ): Promise<QuotationOrderGuard> {
    const quotationOrder: SteelMarkdownQuotationOrderInput | undefined = input.quotationOrder;
    const target = input.targets[0];
    const systemOrder = input.systemOrder;
    const customer = quotationOrder?.customer;
    if (!quotationOrder || !target || target.kind !== 'system_order' || !systemOrder || !customer) return { valid: false };
    throwIfAborted(quotationOrder.signal);

    const run = state.activeRun;
    const baselineHash = sha(target.baselineMarkdown);
    const outputId = `system_order:${quotationOrder.runId}`;
    const receipt: SteelQuotationOrderPublicationReceipt = {
      version: 1,
      runId: quotationOrder.runId,
      targetMessageId: input.message.messageId,
      outputId,
      inputSnapshotSha256: quotationOrder.inputSnapshotSha256,
      normalizedSha256: quotationOrder.normalizedSha256,
      systemOrderSha256: systemOrder.sha256,
    };
    const receiptPayload = JSON.stringify(receipt);
    const receiptSha256 = sha(receiptPayload);
    const receiptArtifactId = `${quotationOrder.runId}:order-published:${receiptSha256}`;
    throwIfAborted(quotationOrder.signal);
    const oldMessage = await Message.findOne(messageFilter(input.scope, input.message.messageId))
      .session(session).lean<IMessage | null>();
    throwIfAborted(quotationOrder.signal);
    const receiptArtifact = await Artifact.findOne({ ...scopeFilter(input.scope), runId: quotationOrder.runId,
      operationId: 'order-published', kind: 'main', sha256: receiptSha256 }).session(session).lean<ISteelQuotationArtifact | null>();
    const receiptRef = run?.checkpointRefs.find((ref) => ref.operationId === 'order-published' && ref.kind === 'main');
    const currentOwner = state.markdownPublication?.current?.system_order;
    const currentSystemOrder = state.currentSystemOrder;
    throwIfAborted(quotationOrder.signal);
    const output = await Output.findOne({ ...scopeFilter(input.scope), kind: 'system_order',
      messageId: input.message.messageId, outputId, state: 'current' }).session(session).lean<ISteelReviewOutput | null>();
    const ownerMetadata = oldMessage?.metadata?.steelMarkdownOwners && typeof oldMessage.metadata.steelMarkdownOwners === 'object' &&
      !Array.isArray(oldMessage.metadata.steelMarkdownOwners)
      ? Reflect.get(oldMessage.metadata.steelMarkdownOwners, 'system_order') as SteelMarkdownReference | undefined
      : undefined;
    const ownerMatches = Boolean(ownerMetadata?.source === 'ai' && ownerMetadata.outputId === receipt.outputId &&
      ownerMetadata.messageId === receipt.targetMessageId && ownerMetadata.sha256 === receipt.systemOrderSha256);
    const outputMatches = Boolean(output && output.outputId === receipt.outputId && output.messageId === receipt.targetMessageId &&
      output.revision === target.revision && output.aiBaselineMarkdown === systemOrder.markdown &&
      sha(output.aiBaselineMarkdown) === receipt.systemOrderSha256);
    const receiptMatches = Boolean(receiptArtifact && receiptArtifact.payload === receiptPayload &&
      receiptArtifact.sha256 === receiptSha256 && receiptArtifact.kind === 'main' &&
      receiptRef && receiptRef.sha256 === receiptSha256 && receiptRef.artifactId === receiptArtifactId &&
      receiptRef.userId === input.scope.userId && receiptRef.conversationId === input.scope.conversationId &&
      receiptRef.tenantId === input.scope.tenantId && receiptRef.runId === receipt.runId &&
      receiptRef.operationId === 'order-published' && receiptRef.kind === 'main' &&
      oldMessage && currentSystemOrder && currentSystemOrder.runId === receipt.runId &&
      currentSystemOrder.messageId === receipt.targetMessageId &&
      run?.status === 'completed' && run.targetMessageId === receipt.targetMessageId &&
      sha(currentSystemOrder.markdown) === currentSystemOrder.sha256 &&
      currentSystemOrder.reviewOutputId === receipt.outputId &&
      currentOwner?.ai.outputId === receipt.outputId && currentOwner.effective.outputId === receipt.outputId &&
      currentOwner.ai.sha256 === receipt.systemOrderSha256 &&
      ownerMatches && outputMatches);
    if (receiptArtifact) {
      if (!receiptMatches) return { valid: false };
      return { valid: true, replay: { ok: true, message: oldMessage!, references: currentOwner ? [currentOwner.ai] : [] } };
    }

    const now = new Date();
    const snapshotRef = run?.snapshotRef;
    const ticket = run ? state.tickets.find((candidate) => candidate.acceptedRunId === run.runId) : undefined;
    const normalizedRef = run?.checkpointRefs.find((ref) => ref.operationId === 'system-order:normalized' && ref.kind === 'main' &&
      ref.sha256 === quotationOrder.normalizedSha256);
    const admissionMatches = Boolean(state.markdownPublication?.admission &&
      sameJson(state.markdownPublication.admission, input.admission) &&
      state.markdownPublication.nextSequence === input.admission.sequence);
    const liveRun = Boolean(run && (run.status === 'aggregating' || run.status === 'finalizing') &&
      run.runId === quotationOrder.runId && run.targetMessageId === quotationOrder.runTargetMessageId &&
      run.leaseToken === quotationOrder.leaseToken && run.leaseExpiresAt && new Date(run.leaseExpiresAt).getTime() > now.getTime() &&
      new Date(run.acceptedAt).getTime() + STEEL_QUOTATION_INPUT_TTL_MS > now.getTime());
    const customerMatches = Boolean(state.currentCustomer &&
      state.currentCustomer.preparationId === customer.preparationId &&
      state.currentCustomer.customerIdentity === customer.customerIdentity &&
      state.currentCustomer.customerMarkdown === customer.customerMarkdown && ticket &&
      ticket.orderHash === state.currentOrder?.sha256 && ticket.customerMarkdown === customer.customerMarkdown &&
      ticket.customerIdentity === customer.customerIdentity &&
      (ticket.preparationId === undefined || ticket.preparationId === customer.preparationId) &&
      ticket.triggeringMessageId === run?.triggerMessageId);
    const currentOrderMatches = Boolean(state.currentOrder &&
      state.currentOrder.sha256 === input.admission.expected.orderHash &&
      run && sameJson(run.ocrSelection ?? null, state.currentOrder.ocrSelection ?? null));
    const candidateMatches = target.outputId === outputId && systemOrder.runId === quotationOrder.runId && systemOrder.sha256 === quotationOrder.normalizedSha256 &&
      systemOrder.markdown === target.baselineMarkdown && baselineHash === systemOrder.sha256 &&
      (!systemOrder.messageId || systemOrder.messageId === input.message.messageId) &&
      sameJson(systemOrder.ocrSelection ?? null, run?.ocrSelection ?? null);
    const priorOwnerMatches = Boolean(currentSystemOrder && currentSystemOrder.runId !== quotationOrder.runId) || currentSystemOrder === undefined;
    const snapshotScopeMatches = Boolean(snapshotRef && scopedArtifactRef(input.scope, snapshotRef, quotationOrder.runId) &&
      snapshotRef.operationId === 'snapshot' && snapshotRef.kind === 'snapshot' &&
      snapshotRef.sha256 === quotationOrder.inputSnapshotSha256);
    const snapshotArtifact = snapshotScopeMatches && snapshotRef
      ? (throwIfAborted(quotationOrder.signal), await Artifact.findOne({ ...scopeFilter(input.scope), runId: quotationOrder.runId, operationId: 'snapshot', kind: 'snapshot',
        sha256: quotationOrder.inputSnapshotSha256 }).session(session).lean<ISteelQuotationArtifact | null>()
        )
      : null;
    const snapshotPayload = snapshotArtifact ? parsePayload<SteelQuotationSnapshotPayload>(snapshotArtifact.payload) : null;
    const snapshotPromptsMatch = Boolean(snapshotPayload?.prompts && typeof snapshotPayload.prompts.child === 'string' && snapshotPayload.prompts.child.length > 0 &&
      typeof snapshotPayload.prompts.main === 'string' && snapshotPayload.prompts.main.length > 0);
    const snapshotMatches = Boolean(snapshotArtifact && snapshotPayload && snapshotPromptsMatch && snapshotArtifact.sha256 === sha(snapshotArtifact.payload) &&
      (!snapshotArtifact.expiresAt || new Date(snapshotArtifact.expiresAt).getTime() > now.getTime()) &&
      snapshotPayload.orderHash === state.currentOrder?.sha256 && snapshotPayload.orderMarkdown === state.currentOrder?.markdown &&
      snapshotPayload.customerMarkdown === customer.customerMarkdown && snapshotPayload.customerIdentity === customer.customerIdentity &&
      sameJson(snapshotPayload.sourceSnapshot ?? null, systemOrder.sourceSnapshot ?? null) &&
      sameJson(snapshotPayload.ocrSelection ?? null, run?.ocrSelection ?? null));
    const snapshotMappings = snapshotPayload?.sourceSnapshot?.mappings ?? [];
    const targetMappings = target.sourceMappings ?? [];
    const candidateMappings = systemOrder.sourceSnapshot?.mappings ?? [];
    const reviewMetadata = systemOrder.reviewMetadata;
    const fallbackReviewContext = snapshotPayload && reviewMetadata?.ocrContext && !snapshotPayload.ocrContext &&
      fallbackOcrContextMatches(reviewMetadata.ocrContext, snapshotPayload)
      ? reviewMetadata.ocrContext
      : undefined;
    const frozenReviewContext = snapshotPayload?.ocrContext ?? fallbackReviewContext;
    const boundReviewRows = frozenReviewContext && target.rows
      ? bindSteelReviewRowsToOcrContext(target.headers ?? [], target.rows, frozenReviewContext)
      : target.rows;
    const targetRowsBound = sameJson(target.rows, boundReviewRows) &&
      (!target.rows?.some((row) => row.source !== null) || Boolean(frozenReviewContext));
    const reviewMetadataMatches = Boolean(snapshotPayload &&
      sameJson(targetMappings, snapshotMappings) && sameJson(candidateMappings, snapshotMappings) &&
      targetRowsBound &&
      (reviewMetadata
        ? reviewMetadata.initialized === true && reviewMetadata.version === 1 &&
          reviewMetadata.lineage.runId === quotationOrder.runId &&
          reviewMetadata.lineage.outputId === target.outputId &&
          reviewMetadata.lineage.revision === target.revision &&
          reviewMetadata.lineage.messageId === input.message.messageId &&
          sameJson(reviewMetadata.rows, boundReviewRows) &&
          (snapshotPayload.ocrContext
            ? sameJson(reviewMetadata.ocrContext, snapshotPayload.ocrContext)
            : reviewMetadata.ocrContext === null || fallbackOcrContextMatches(reviewMetadata.ocrContext, snapshotPayload))
        : !snapshotPayload.ocrContext));
    const sourceIds = [...new Set([
      ...snapshotMappings.map((mapping) => mapping.fileId),
      ...targetMappings.map((mapping) => mapping.fileId),
      ...candidateMappings.map((mapping) => mapping.fileId),
      ...sourceFileIds(target.rows),
      ...sourceFileIds(reviewMetadata?.rows),
      ...sourceFileIds(reviewMetadata?.ocrContext?.rows),
    ])];
    const sourceRefsAreFrozen = [target.rows ?? [], reviewMetadata?.rows ?? [], reviewMetadata?.ocrContext?.rows ?? []]
      .flatMap((rows) => rows.flatMap((row) => row.source?.fileId ? [row.source.fileId] : []))
      .every((fileId) => snapshotMappings.some((mapping) => mapping.fileId === fileId));
    const normalizedArtifact = normalizedRef
      ? (throwIfAborted(quotationOrder.signal), await Artifact.findOne({ ...scopeFilter(input.scope), runId: quotationOrder.runId, operationId: 'system-order:normalized', kind: 'main',
        sha256: quotationOrder.normalizedSha256 }).session(session).lean<ISteelQuotationArtifact | null>()
        )
      : null;
    const normalizedMatches = Boolean(normalizedRef && normalizedArtifact && normalizedArtifact.sha256 === sha(normalizedArtifact.payload) &&
      normalizedArtifact.payload === systemOrder.markdown);
    const frozenChunks = snapshotPayload && run
      ? frozenChunkSourceRowIds(snapshotPayload.orderMarkdown, run.chunks)
      : null;
    let chunksMatch = Boolean(run && frozenChunks);
    if (run && frozenChunks) {
      const orderedChunks = [...run.chunks].sort((left, right) => left.index - right.index);
      for (const [chunkIndex, chunk] of orderedChunks.entries()) {
        const chunkRef = chunk.checkpointRef;
        const expectedOperationId = `chunk:${chunk.index}`;
        const expectedSourceRowIds = frozenChunks[chunkIndex];
        const trusted = chunkRef && run.checkpointRefs.some((ref) => checkpointMatchesRef(ref, chunkRef));
        if (chunk.status !== 'completed' || !chunkRef || !expectedSourceRowIds ||
          chunk.sourceRowCount !== expectedSourceRowIds.length || chunkRef.operationId !== expectedOperationId ||
          chunkRef.kind !== 'chunk' || chunkRef.artifactId !== `${quotationOrder.runId}:${expectedOperationId}:${chunkRef.sha256}` ||
          !trusted || !scopedArtifactRef(input.scope, chunkRef, quotationOrder.runId)) {
          chunksMatch = false;
          break;
        }
        throwIfAborted(quotationOrder.signal);
        const artifact = await Artifact.findOne({ ...scopeFilter(input.scope), runId: quotationOrder.runId,
          operationId: chunkRef.operationId, kind: chunkRef.kind, sha256: chunkRef.sha256 }).session(session).lean<ISteelQuotationArtifact | null>();
        const payload = artifact ? parsePayload<{ markdown?: unknown; lookupOperations?: unknown; pythonOperations?: unknown; sourceRowIds?: unknown }>(artifact.payload) : null;
        if (!artifact || artifact.sha256 !== sha(artifact.payload) || !payload || typeof payload.markdown !== 'string' ||
          !Array.isArray(payload.lookupOperations) || !payload.lookupOperations.every((value) => typeof value === 'string') ||
          !Array.isArray(payload.pythonOperations) || !payload.pythonOperations.every((value) => typeof value === 'string') ||
          !Array.isArray(payload.sourceRowIds) || !payload.sourceRowIds.every((value) => typeof value === 'string') ||
          sameJson(payload.sourceRowIds, expectedSourceRowIds) === false) {
          chunksMatch = false;
          break;
        }
      }
    }
    const authorized = sourceIds.length
      ? await authorizeFiles({ ...input.scope, messageId: input.message.messageId, kind: 'ocr_result' }, sourceIds, session, { conversation, message: input.message })
      : new Map<string, SteelReviewAuthorizedFile>();
    const authorizedMappingsMatch = snapshotMappings.every((mapping) => {
      const file = authorized.get(mapping.fileId);
      return file?.filename === mapping.sourceFilename && (!mapping.mediaType || file.type === mapping.mediaType);
    });
    const authorizedSourcesMatch = authorized.size === sourceIds.length && sourceIds.every((fileId) => authorized.has(fileId)) && authorizedMappingsMatch;
    const scopedOcrIdentityMatches = await hasScopedOcrIdentity(input.scope, session);
    const expectedMatches = sameJson(expected(state, ocr), input.admission.expected);
    if (!conversation || !scopedOcrIdentityMatches || !admissionMatches || !liveRun || !customerMatches || !currentOrderMatches || !candidateMatches ||
      !priorOwnerMatches || !snapshotMatches || !reviewMetadataMatches || !sourceRefsAreFrozen || !authorizedSourcesMatch || !normalizedMatches || !chunksMatch ||
      !expectedMatches || output) return { valid: false };

    return { valid: true };
  }

  async function admitSteelMarkdown(input: SteelMarkdownAdmissionInput): Promise<SteelMarkdownAdmission | null> {
    if (!input.scope.userId || !input.scope.conversationId || !input.responseId || !input.generationId) return null;
    const session = await mongoose.startSession();
    let admitted: SteelMarkdownAdmission | null = null;
    try {
      await session.withTransaction(async () => {
        const conversation = await Conversation.findOne({ ...messageFilter(input.scope), ...activeExpirationFilter() }).session(session).lean<IConversation>();
        if (!conversation) return;
        const state = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        const previous = state?.markdownPublication?.admission;
        if (previous?.responseId === input.responseId && previous.generationId === input.generationId) { admitted = previous; return; }
        if (!await hasScopedOcrIdentity(input.scope, session)) return;
        const ocr = await Ocr.findOne({ conversationId: input.scope.conversationId })
          .session(session).lean<ISteelConversationOcrState>();
        const sequence = (state?.markdownPublication?.nextSequence ?? 0) + 1;
        admitted = { sequence, responseId: input.responseId, generationId: input.generationId,
          lineageId: state?.markdownPublication?.current?.ocr_result?.ai.lineageId ?? input.generationId, expected: expected(state, ocr) };
        await State.findOneAndUpdate(scopeFilter(input.scope), { $set: { 'markdownPublication.nextSequence': sequence, 'markdownPublication.admission': admitted },
          $setOnInsert: { userId: input.scope.userId, conversationId: input.scope.conversationId, ...(input.scope.tenantId ? { tenantId: input.scope.tenantId } : {}) } },
          { upsert: true, session, new: true });
      });
      return admitted;
    } finally { await session.endSession(); }
  }

  async function publishSteelMarkdown(input: SteelMarkdownPublicationInput): Promise<SteelMarkdownPublicationResult> {
    if (!validTargets(input)) return { ok: false, code: 'invalid_target' };
    const session = await mongoose.startSession();
    let result: SteelMarkdownPublicationResult = { ok: false, code: 'superseded' };
    const superseded = new Error('Steel publication superseded');
    try {
      await session.withTransaction(async () => {
        result = { ok: false, code: 'superseded' };
        throwIfAborted(input.quotationOrder?.signal);
        const conversation = await Conversation.findOne({ ...messageFilter(input.scope), ...activeExpirationFilter() }).session(session).lean<IConversation>();
        const state = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        if (input.quotationOrder) {
          if (!conversation || !state) return;
          const ocr = await Ocr.findOne({ conversationId: input.scope.conversationId })
            .session(session).lean<ISteelConversationOcrState>();
          const guard = await validateQuotationOrder(input, conversation, state, ocr, session);
          if (!guard.valid) return;
          if (guard.replay) { result = guard.replay; return; }
        }
        if (!conversation || !state || (!input.quotationOrder && (!equal(state.markdownPublication?.admission, input.admission) ||
          state.markdownPublication?.nextSequence !== input.admission.sequence))) return;
        const oldMessage = await Message.findOne(messageFilter(input.scope, input.message.messageId)).session(session).lean<IMessage>();
        const prior = await Artifact.find({ ...scopeFilter(input.scope), runId: `markdown:${input.admission.generationId}`, operationId: { $in: input.targets.map((target) => `ai:${target.kind}`) } }).session(session).lean<ISteelQuotationArtifact[]>();
        if (!input.quotationOrder && prior.length === input.targets.length && oldMessage && input.targets.every((target) => {
          const snapshot = prior.find((artifact) => artifact.operationId === `ai:${target.kind}`)?.markdownPublication;
          if (!snapshot || snapshot.reference.outputId !== state.markdownPublication?.current?.[target.kind]?.ai.outputId) return false;
          const exactRaw = snapshot.rawMarkdown === input.rawMarkdown && snapshot.baselineMarkdown === target.baselineMarkdown;
          const originalTable = parseSteelReviewMarkdownTables(snapshot.baselineMarkdown).filter((table) => table.title === target.title);
          const replayTable = parseSteelReviewMarkdownTables(target.baselineMarkdown).filter((table) => table.title === target.title);
          const exactSavedProjection = input.rawMarkdown === oldMessage.text && input.message.text === oldMessage.text &&
            originalTable.length === 1 && replayTable.length === 1 &&
            equal({ headers: originalTable[0].headers, rows: originalTable[0].rows }, { headers: replayTable[0].headers, rows: replayTable[0].rows });
          return exactRaw || exactSavedProjection;
        })) {
          result = { ok: true, message: oldMessage, references: prior.flatMap((artifact) => artifact.markdownPublication ? [artifact.markdownPublication.reference] : []) };
          return;
        }
        if (!input.quotationOrder && prior.length > 0) return;
        if (!input.quotationOrder && !await hasScopedOcrIdentity(input.scope, session)) return;
        const publicationProof = createSteelQuotationPublicationProof(Artifact, session);
        const activeRun = state.activeRun;
        if (!input.quotationOrder && activeRun && activeRun.status !== 'cancelled' &&
          (activeRun.status !== 'completed' || !await publicationProof.isPublished(input.scope, activeRun))) return;
        const ocr = await Ocr.findOne({ conversationId: input.scope.conversationId })
          .session(session).lean<ISteelConversationOcrState>();
        if (!input.quotationOrder && !equal(expected(state, ocr), input.admission.expected)) return;
        if (input.ocr?.claimToken) {
          if (input.ocr.delegateOcrIndex === undefined || !input.ocr.executionLeaseToken || !input.ocr.candidateToken ||
            ocr?.activeDelegateClaim?.claimToken !== input.ocr.claimToken ||
            ocr.activeDelegateClaim.executionLeaseToken !== input.ocr.executionLeaseToken ||
            ocr.activeDelegateClaim.delegateOcrIndex !== input.ocr.delegateOcrIndex) return;
          const delegate = await DelegateRun.exists({ conversationId: input.scope.conversationId, claimToken: input.ocr.claimToken,
            delegateOcrIndex: input.ocr.delegateOcrIndex, executionLeaseToken: input.ocr.executionLeaseToken,
            executionLeaseExpiresAt: { $gt: new Date() }, 'finalizedCandidate.token': input.ocr.candidateToken,
            'finalizedCandidate.generationId': input.admission.generationId, 'finalizedCandidate.targetMessageId': input.message.messageId,
            'finalizedCandidate.markdown': input.message.text, 'finalizationJournal.candidateValidatedToken': input.ocr.candidateToken }).session(session);
          if (!delegate) return;
        }
        const ocrTarget = input.targets.find((target) => target.kind === 'ocr_result');
        const systemTarget = input.targets.find((target) => target.kind === 'system_order');
        const sourceIds = [...new Set(input.targets.flatMap((target) => [
          ...(target.sourceMappings ?? []).map((mapping) => mapping.fileId),
          ...(target.rows ?? []).flatMap((row) => row.source?.fileId ? [row.source.fileId] : []),
        ]))];
        const authorized = !input.quotationOrder && sourceIds.length ? await authorizeFiles({ ...input.scope, messageId: input.message.messageId, kind: 'ocr_result' }, sourceIds, session, { conversation, message: input.message }) : new Map<string, SteelReviewAuthorizedFile>();
        for (const target of input.targets) {
          const trustedMappings = target.kind === 'system_order'
            ? input.systemOrder?.sourceSnapshot?.mappings ?? target.sourceMappings ?? []
            : target.sourceMappings ?? [];
          const trustedFileIds = new Set([
            ...trustedMappings.map((mapping) => mapping.fileId),
            ...(target.kind === 'system_order' ? (ocrTarget?.sourceMappings ?? []).map((mapping) => mapping.fileId) : []),
          ]);
          const authorizedRowFileIds = target.kind === 'system_order'
            ? new Set((target.rows ?? []).flatMap((row) => row.source && authorized.has(row.source.fileId) ? [row.source.fileId] : []))
            : new Set<string>();
          for (const mapping of trustedMappings) {
            const file = authorized.get(mapping.fileId);
            const canonical = target.kind === 'system_order'
              ? mapping
              : ocr?.sourceMappings.find((entry) => entry.fileId === mapping.fileId);
            if (!input.quotationOrder && (!file || !canonical || canonical.sourceCode !== mapping.sourceCode || canonical.sourceFilename !== mapping.sourceFilename || file.filename !== mapping.sourceFilename)) return;
          }
          if (!input.quotationOrder && target.rows?.some((row) => row.source &&
            !authorizedRowFileIds.has(row.source.fileId) && !trustedFileIds.has(row.source.fileId))) return;
        }
        const now = new Date();
        const publicationGenerationId = input.quotationOrder ? `quotation:${input.quotationOrder.runId}` : input.admission.generationId;
        const orderReceipt = input.quotationOrder && systemTarget && input.systemOrder
          ? {
              version: 1 as const,
              runId: input.quotationOrder.runId,
              targetMessageId: input.message.messageId,
              outputId: `system_order:${input.quotationOrder.runId}`,
              inputSnapshotSha256: input.quotationOrder.inputSnapshotSha256,
              normalizedSha256: input.quotationOrder.normalizedSha256,
              systemOrderSha256: input.systemOrder.sha256,
            } satisfies SteelQuotationOrderPublicationReceipt
          : undefined;
        const references: SteelMarkdownReference[] = input.targets.map((target) => ({
          kind: target.kind, source: 'ai', snapshotId: `markdown:${publicationGenerationId}:ai:${target.kind}`,
          generationId: publicationGenerationId, outputId: input.quotationOrder && target.kind === 'system_order'
            ? `system_order:${input.quotationOrder.runId}` : target.outputId, messageId: input.message.messageId, title: target.title,
          revision: target.revision, sha256: sha(target.baselineMarkdown), lineageId: input.admission.lineageId, version: 1, savedAt: now,
        }));
        const metadata: Record<string, unknown> = { ...oldMessage?.metadata, ...input.message.metadata };
        const priorSteelReview = oldMessage?.metadata?.steelReview;
        const steelReview: Record<string, unknown> = priorSteelReview && typeof priorSteelReview === 'object' && !Array.isArray(priorSteelReview) ? { ...priorSteelReview } : {};
        for (const target of input.targets) delete steelReview[target.kind];
        if (Object.keys(steelReview).length > 0) metadata.steelReview = steelReview;
        else delete metadata.steelReview;
        const existingOwners = oldMessage?.metadata?.steelMarkdownOwners;
        const ownerMetadata: Partial<Record<SteelMarkdownKind, SteelMarkdownReference>> = {};
        if (existingOwners && typeof existingOwners === 'object' && !Array.isArray(existingOwners)) {
          for (const kind of kinds) {
            const current = state.markdownPublication?.current?.[kind]?.ai;
            if (current?.messageId === input.message.messageId) ownerMetadata[kind] = current;
          }
        }
        for (const reference of references) ownerMetadata[reference.kind] = reference;
        metadata.steelMarkdownOwners = ownerMetadata;
        const systemReference = references.find((reference) => reference.kind === 'system_order');
        if (systemReference) {
          const currentReview = metadata.steelReview && typeof metadata.steelReview === 'object' && !Array.isArray(metadata.steelReview)
            ? metadata.steelReview as Record<string, unknown>
            : {};
          currentReview.system_order = {
            version: 1,
            kind: 'system_order',
            conversationId: input.scope.conversationId,
            messageId: input.message.messageId,
            title: systemReference.title,
            outputId: systemReference.outputId,
            revision: systemReference.revision,
            effectiveVersion: 1,
            updatedAt: now,
          };
          metadata.steelReview = currentReview;
        }
        const quotationSlots = input.quotationOrder
          ? orderContentSlots(input.message.content ?? oldMessage?.content, input.message.text)
          : undefined;
        if (input.quotationOrder && orderReceipt && quotationSlots) {
          metadata.steelQuotation = {
            version: 1,
            runId: orderReceipt.runId,
            outputId: orderReceipt.outputId,
            sourceMessageId: input.message.sourceMessageId ?? input.admission.responseId,
            receiptSha256: sha(JSON.stringify(orderReceipt)),
            admissionSequence: input.admission.sequence,
            tableContentIndex: quotationSlots.tableContentIndex,
            summaryContentIndex: quotationSlots.summaryContentIndex,
            footerContentIndex: quotationSlots.footerContentIndex,
          };
        }
        const publicationMessage = input.quotationOrder
          ? (() => { const { sourceMessageId: _sourceMessageId, ...stored } = input.message; return { ...stored, ...(quotationSlots ? { content: quotationSlots.content } : {}), metadata }; })()
          : { ...input.message, metadata };
        throwIfAborted(input.quotationOrder?.signal);
        const saved = await saveMessage(input, publicationMessage, session);
        if (!saved) throw new Error('Steel message publication failed');
        const current = { ...state.markdownPublication?.current };
        const suppliedSystemMetadata = systemTarget && input.systemOrder?.reviewMetadata &&
          input.systemOrder.reviewMetadata.initialized &&
          input.systemOrder.reviewMetadata.lineage.outputId === systemTarget.outputId &&
          input.systemOrder.reviewMetadata.lineage.revision === systemTarget.revision
          ? input.systemOrder.reviewMetadata
          : undefined;
        const systemOcrContext = suppliedSystemMetadata?.ocrContext ?? (ocrTarget?.headers && ocrTarget.rows
          ? createSteelReviewOcrContext({
              title: ocrTarget.title,
              outputId: ocrTarget.outputId,
              revision: ocrTarget.revision,
              headers: ocrTarget.headers,
              rows: ocrTarget.rows,
            })
          : null);
        const systemRows = systemTarget?.rows
          ? suppliedSystemMetadata?.rows ?? (systemOcrContext
            ? bindSteelReviewRowsToOcrContext(systemTarget.headers ?? [], systemTarget.rows, systemOcrContext)
            : systemTarget.rows.map((row) => ({ ...row, source: null, ocrLink: null })))
          : undefined;
        const systemReviewMetadata: SteelReviewMetadata | undefined = systemTarget && systemRows
          ? {
              ...(input.systemOrder?.reviewMetadata ?? {
                version: 1,
                initialized: true,
                lineage: {
                  runId: input.systemOrder?.runId ?? systemTarget.outputId,
                  outputId: systemTarget.outputId,
                  revision: systemTarget.revision,
                },
              }),
              initialized: true,
              lineage: {
                ...(input.systemOrder?.reviewMetadata?.lineage ?? {
                  runId: input.systemOrder?.runId ?? systemTarget.outputId,
                  outputId: systemTarget.outputId,
                  revision: systemTarget.revision,
                }),
                outputId: systemTarget.outputId,
                revision: systemTarget.revision,
                messageId: input.message.messageId,
                ...(ocrTarget ? {
                  ocrOutputId: ocrTarget.outputId,
                  ocrRevision: ocrTarget.revision,
                  ocrHash: sha(ocrTarget.baselineMarkdown),
                } : {}),
              },
              ocrContext: systemOcrContext,
              rows: systemRows,
            }
          : undefined;
        for (const target of input.targets) {
          const reference = references.find((candidate) => candidate.kind === target.kind)!;
          current[target.kind] = { ai: reference, effective: reference };
          const payload = JSON.stringify({ rawMarkdown: input.rawMarkdown, baselineMarkdown: target.baselineMarkdown });
          throwIfAborted(input.quotationOrder?.signal);
          await Artifact.create([{ userId: input.scope.userId, conversationId: input.scope.conversationId, ...(input.scope.tenantId ? { tenantId: input.scope.tenantId } : {}),
            runId: `markdown:${publicationGenerationId}`, operationId: `ai:${target.kind}`, kind: 'main', sha256: sha(payload), payload,
            markdownPublication: { reference, rawMarkdown: input.rawMarkdown, baselineMarkdown: target.baselineMarkdown,
              ...(target.sourceMappings ? { sourceMappings: target.sourceMappings } : {}) } }], { session });
          if (target.kind !== 'customer_data') {
            throwIfAborted(input.quotationOrder?.signal);
            await Output.updateMany({ ...scopeFilter(input.scope), kind: target.kind, state: 'current' }, { $set: { state: 'historical', latestOutputId: target.outputId } }, { session, timestamps: false });
            throwIfAborted(input.quotationOrder?.signal);
            await Output.create([{ userId: input.scope.userId, conversationId: input.scope.conversationId,
              ...(input.scope.tenantId ? { tenantId: input.scope.tenantId } : {}), kind: target.kind, messageId: input.message.messageId, title: target.title,
              tableId: steelReviewTitleStorageId({ userId: input.scope.userId, tenantId: input.scope.tenantId, conversationId: input.scope.conversationId,
                messageId: input.message.messageId, kind: target.kind, outputId: target.outputId, title: target.title }),
              outputId: target.outputId, revision: target.revision, state: 'current', latestOutputId: target.outputId,
              headers: target.headers, rows: normalizeSteelReviewLedgerRows(target.kind === 'system_order' ? systemRows ?? [] : target.rows ?? []), sourceMappings: target.sourceMappings,
              ...(target.kind === 'system_order' && systemReviewMetadata ? { reviewMetadata: systemReviewMetadata } : {}),
              aiUpdatedAt: now, aiRawMarkdown: input.rawMarkdown, aiBaselineMarkdown: target.baselineMarkdown,
              effectiveMarkdown: target.baselineMarkdown, displayMarkdown: target.baselineMarkdown, receipts: [] }], { session });
          }
        }
        if (systemTarget && (!input.systemOrder || input.systemOrder.markdown !== systemTarget.baselineMarkdown || input.systemOrder.sha256 !== sha(systemTarget.baselineMarkdown))) throw new Error('Steel system-order publication proof is invalid');
        if (ocrTarget && !input.quotationOrder) {
          await Ocr.updateOne({ conversationId: input.scope.conversationId }, { $set: {
            currentOcrResultMarkdown: ocrTarget.baselineMarkdown, currentOcrResultMessageId: input.message.messageId,
            currentOcrResultGenerationId: input.admission.generationId, currentOcrResultAttemptNumber: input.ocr?.attemptNumber ?? 1,
            ...(input.ocr?.delegateOcrIndex !== undefined ? { currentOcrResultIndex: input.ocr.delegateOcrIndex } : {}),
            currentOcrResultProvenance: { generationId: input.admission.generationId, messageId: input.message.messageId,
              attemptNumber: input.ocr?.attemptNumber ?? 1, ...(input.ocr?.claimToken ? { claimToken: input.ocr.claimToken } : {}), updatedAt: now },
          } }, { upsert: true, session });
        }
        if (ocrTarget && !input.quotationOrder && input.ocr?.claimToken && input.ocr.candidateToken) {
          const token = input.ocr.candidateToken;
          const finished = await DelegateRun.updateOne({ conversationId: input.scope.conversationId, claimToken: input.ocr.claimToken,
            executionLeaseToken: input.ocr.executionLeaseToken, 'finalizedCandidate.token': token }, { $set: {
              status: 'completed', currentStage: 'completed', 'finalizationJournal.messagePersisted': true,
              'finalizationJournal.messagePersistedToken': token, 'finalizationJournal.resultPersisted': true,
              'finalizationJournal.resultPersistedToken': token, 'finalizationJournal.claimCleared': true,
              'finalizationJournal.claimClearedToken': token } }, { session });
          if (finished.matchedCount !== 1) throw superseded;
          const cleared = await Ocr.updateOne({ conversationId: input.scope.conversationId,
            'activeDelegateClaim.claimToken': input.ocr.claimToken, 'activeDelegateClaim.executionLeaseToken': input.ocr.executionLeaseToken,
            'activeDelegateClaim.delegateOcrIndex': input.ocr.delegateOcrIndex }, { $unset: { activeDelegateClaim: 1 } }, { session });
          if (cleared.matchedCount !== 1) throw superseded;
        }
        const updates = { 'markdownPublication.current': current,
          ...(ocrTarget ? { currentOrder: { markdown: ocrTarget.baselineMarkdown, sha256: sha(ocrTarget.baselineMarkdown), revision: input.admission.generationId, messageId: input.message.messageId } } : {}),
          ...(input.customer ? { currentCustomer: input.customer } : {}),
          ...(systemTarget && input.systemOrder ? { currentSystemOrder: {
            ...input.systemOrder,
            responseId: input.message.sourceMessageId ?? input.admission.responseId,
            ...(systemReviewMetadata ? { reviewMetadata: systemReviewMetadata } : {}),
            reviewOutputId: systemTarget.outputId,
            messageId: input.message.messageId,
            updatedAt: now,
          } } : {}),
          ...(ocrTarget && state.currentSystemOrder && !systemTarget ? { 'currentSystemOrder.needsRequote': true } : {}),
        };
        if (orderReceipt) {
          const receiptPayload = JSON.stringify(orderReceipt);
          throwIfAborted(input.quotationOrder?.signal);
          await Artifact.create([{ ...input.scope, runId: orderReceipt.runId, operationId: 'order-published', kind: 'main',
            sha256: sha(receiptPayload), payload: receiptPayload, createdAt: now, updatedAt: now }], { session });
        }
        let activeRunFilter: Record<string, unknown>;
        if (input.quotationOrder) {
          activeRunFilter = { 'activeRun.runId': input.quotationOrder.runId, 'activeRun.targetMessageId': input.quotationOrder.runTargetMessageId,
            'activeRun.status': { $in: ['aggregating', 'finalizing'] }, 'activeRun.leaseToken': input.quotationOrder.leaseToken,
            'activeRun.leaseExpiresAt': { $gt: now }, 'activeRun.acceptedAt': { $gt: new Date(now.getTime() - STEEL_QUOTATION_INPUT_TTL_MS) },
            'activeRun.checkpointRefs': state.activeRun?.checkpointRefs, 'activeRun.chunks': state.activeRun?.chunks,
            'currentOrder.sha256': input.admission.expected.orderHash };
        } else if (state.activeRun) {
          activeRunFilter = { 'activeRun.runId': state.activeRun.runId, 'activeRun.status': state.activeRun.status,
            'activeRun.checkpointRefs': state.activeRun.checkpointRefs };
        } else {
          activeRunFilter = { activeRun: { $exists: false } };
        }
        const changedFilter = {
          $and: [
            scopeFilter(input.scope),
            { 'markdownPublication.admission.sequence': input.admission.sequence, 'markdownPublication.admission.generationId': input.admission.generationId },
            activeRunFilter,
            ...(input.quotationOrder ? [{ 'activeRun.checkpointRefs': { $not: { $elemMatch: { operationId: 'order-published' } } } }] : []),
          ],
        };
        throwIfAborted(input.quotationOrder?.signal);
        const changed = await State.updateOne(changedFilter, {
          $set: {
            ...updates,
            ...(input.quotationOrder ? {
              'activeRun.status': 'completed',
              'activeRun.updatedAt': now,
            } : {}),
          },
          ...(input.quotationOrder ? {
            $unset: {
              'activeRun.leaseToken': 1,
              'activeRun.leaseExpiresAt': 1,
              'activeRun.interruption': 1,
            },
          } : {}),
          ...(orderReceipt ? { $push: { 'activeRun.checkpointRefs': {
            userId: input.scope.userId,
            conversationId: input.scope.conversationId,
            ...(input.scope.tenantId !== undefined ? { tenantId: input.scope.tenantId } : {}),
            runId: orderReceipt.runId,
            operationId: 'order-published', kind: 'main',
            artifactId: `${orderReceipt.runId}:order-published:${sha(JSON.stringify(orderReceipt))}`,
            sha256: sha(JSON.stringify(orderReceipt)), updatedAt: now,
          } } } : {}),
        }, { session });
        if (changed.matchedCount !== 1) throw superseded;
        throwIfAborted(input.quotationOrder?.signal);
        result = { ok: true, message: saved, references };
      });
      return result;
    } catch (error) { if (error === superseded || error === quotationOrderSuperseded) return { ok: false, code: 'superseded' }; throw error; }
    finally { await session.endSession(); }
  }

  type QuotationMessageIdentity = Pick<SteelQuotationErrorsAppendInput,
    'scope' | 'runId' | 'targetMessageId' | 'sourceMessageId' | 'admission'>;
  type QuotationStoredMessage = Pick<IMessage, 'text' | 'metadata'> & { content: NonNullable<IMessage['content']> };
  type QuotationMessageChange = Partial<Pick<IMessage, 'metadata' | 'tokenCount' | 'processingDurationMs'>> & {
    content: NonNullable<IMessage['content']>;
  };

  async function updateQuotationMessage(
    input: QuotationMessageIdentity,
    build: (message: QuotationStoredMessage, publication: SteelQuotationMessagePublication) => QuotationMessageChange | null | undefined,
  ): Promise<SteelQuotationErrorsAppendResult> {
    if (!input.scope.userId || !input.scope.conversationId || !input.runId || !input.targetMessageId ||
      !input.sourceMessageId || !input.admission.responseId) return { ok: false, code: 'superseded' };
    const outputId = `system_order:${input.runId}`;
    const session = await mongoose.startSession();
    let result: SteelQuotationErrorsAppendResult = { ok: false, code: 'superseded' };
    try {
      await session.withTransaction(async () => {
        result = { ok: false, code: 'superseded' };
        await protectSteelConversationWrite(mongoose, input.scope, session);
        const state = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        if (state?.activeRun?.runId !== input.runId || state.activeRun.status !== 'completed' ||
          state.activeRun.targetMessageId !== input.targetMessageId ||
          state.currentSystemOrder?.messageId !== input.targetMessageId ||
          state.currentSystemOrder.responseId !== input.sourceMessageId ||
          state.markdownPublication?.nextSequence !== input.admission.sequence ||
          !sameJson(state.markdownPublication.admission, input.admission)) return;
        const owner = state.markdownPublication.current?.system_order;
        if (owner?.ai.outputId !== outputId || owner.ai.messageId !== input.targetMessageId ||
          owner.effective.outputId !== outputId || owner.effective.messageId !== input.targetMessageId) return;
        const message = await Message.findOne(messageFilter(input.scope, input.targetMessageId))
          .session(session).lean<IMessage | null>();
        if (!message || message.isCreatedByUser || message.unfinished || !Array.isArray(message.content) ||
          !hasConsistentMessageText(message)) return;
        const parsed = steelQuotationMessagePublicationSchema.safeParse(message.metadata?.steelQuotation);
        if (!parsed.success) return;
        const publication = parsed.data;
        if (publication.runId !== input.runId || publication.outputId !== outputId ||
          publication.sourceMessageId !== input.sourceMessageId || input.sourceMessageId !== input.admission.responseId ||
          publication.admissionSequence !== input.admission.sequence) return;
        const messageOwner = message.metadata?.steelMarkdownOwners;
        const owned = messageOwner && typeof messageOwner === 'object' && !Array.isArray(messageOwner)
          ? Reflect.get(messageOwner, 'system_order') : undefined;
        if (!owned || typeof owned !== 'object' || Reflect.get(owned, 'outputId') !== outputId ||
          Reflect.get(owned, 'messageId') !== input.targetMessageId) return;
        const content = message.content;
        const slots = [publication.tableContentIndex, publication.summaryContentIndex, publication.footerContentIndex];
        if (slots.some((index) => {
          const part = content[index];
          return !part || typeof part !== 'object' || Reflect.get(part, 'type') !== 'text' ||
            typeof Reflect.get(part, 'text') !== 'string';
        })) return;
        const table = message.content[publication.tableContentIndex];
        if (!table || typeof table !== 'object' || Reflect.get(table, 'text') !== state.currentSystemOrder.markdown) return;
        const changes = build({ text: message.text, metadata: message.metadata, content }, publication);
        if (changes === null) return;
        if (changes === undefined) {
          result = { ok: true, message };
          return;
        }
        const updated = await Message.findOneAndUpdate(
          { ...messageFilter(input.scope, input.targetMessageId), text: message.text,
            'metadata.steelQuotation.receiptSha256': publication.receiptSha256 },
          { $set: { ...changes, text: renderMessageTextContent(changes.content, publication.tableContentIndex) } },
          { new: true, session },
        ).lean<IMessage | null>();
        if (updated) result = { ok: true, message: updated };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async function appendSteelQuotationSummary(
    input: SteelQuotationSummaryAppendInput,
  ): Promise<SteelQuotationSummaryAppendResult> {
    if (!validSummaryMarkdown(input.summaryMarkdown) || !input.footerMarkdown.trim() ||
      !validSummaryMarkdown(input.footerMarkdown)) return { ok: false, code: 'superseded' };
    let receiptSha256 = '';
    const result = await updateQuotationMessage(input, (message, publication) => {
      const receipt: SteelQuotationSummaryReceipt = {
        version: 1, runId: input.runId, targetMessageId: input.targetMessageId, sourceMessageId: input.sourceMessageId,
        outputId: publication.outputId, admissionSequence: input.admission.sequence,
        publicationReceiptSha256: publication.receiptSha256,
        summarySha256: sha(input.summaryMarkdown), footerSha256: sha(input.footerMarkdown),
        tableContentIndex: publication.tableContentIndex, summaryContentIndex: publication.summaryContentIndex,
        footerContentIndex: publication.footerContentIndex,
      };
      receiptSha256 = sha(JSON.stringify(receipt));
      if (publication.summaryReceiptSha256) return publication.summaryReceiptSha256 === receiptSha256 ? undefined : null;
      const content = [...message.content];
      content[publication.summaryContentIndex] = { type: 'text', text: input.summaryMarkdown };
      content[publication.footerContentIndex] = { type: 'text', text: input.footerMarkdown };
      const hostMetadata = Object.fromEntries(Object.entries(input.messageFields?.metadata ?? {}).filter(([key]) =>
        key !== 'steel' && key !== 'ocr' && !key.startsWith('steel') && !key.startsWith('ocr')));
      return {
        content,
        metadata: { ...message.metadata, ...hostMetadata, steelQuotation: { ...publication, summaryReceiptSha256: receiptSha256 } },
        ...(input.messageFields?.tokenCount !== undefined ? { tokenCount: input.messageFields.tokenCount } : {}),
        ...(input.messageFields?.processingDurationMs !== undefined ? { processingDurationMs: input.messageFields.processingDurationMs } : {}),
      };
    });
    if (!result.ok) return result;
    const publication = steelQuotationMessagePublicationSchema.parse(result.message.metadata?.steelQuotation);
    return { ...result, receiptSha256, summaryContentIndex: publication.summaryContentIndex, footerContentIndex: publication.footerContentIndex };
  }

  async function appendSteelQuotationErrors(
    input: SteelQuotationErrorsAppendInput,
  ): Promise<SteelQuotationErrorsAppendResult> {
    return updateQuotationMessage(input, (message, publication) => {
      const content = [...message.content];
      const seen = new Set(content.flatMap((part) => {
        if (!part || typeof part !== 'object' || Reflect.get(part, 'type') !== 'error') return [];
        const error = Reflect.get(part, 'error');
        return typeof error === 'string' ? [error] : [];
      }));
      let changed = false;
      for (const part of input.errors) {
        if (part.type !== 'error' || !part.error || seen.has(part.error)) continue;
        content.push({ type: 'error', error: part.error });
        seen.add(part.error);
        changed = true;
      }
      if (!publication.summaryReceiptSha256) {
        for (const [index, text] of [
          [publication.summaryContentIndex, input.summaryMarkdown],
          [publication.footerContentIndex, input.footerMarkdown],
        ] as const) {
          const current = content[index];
          if (text && validSummaryMarkdown(text) && current && typeof current === 'object' && Reflect.get(current, 'text') === '') {
            content[index] = { type: 'text', text };
            changed = true;
          }
        }
      }
      return changed ? { content } : undefined;
    });
  }

  async function readSteelMarkdownVersions(scope: SteelQuotationScope): Promise<SteelMarkdownVersion[] | null> {
    const conversation = await Conversation.exists({ ...messageFilter(scope), ...activeExpirationFilter() });
    if (!conversation) return null;
    const [state, artifacts, outputs, ocr, messages] = await Promise.all([
      State.findOne(scopeFilter(scope)).lean<ISteelQuotationState>(),
      Artifact.find({ ...scopeFilter(scope), 'markdownPublication.reference': { $exists: true } }).select({ 'markdownPublication.reference': 1 }).lean<ISteelQuotationArtifact[]>(),
      Output.find(scopeFilter(scope)).select({ kind: 1, messageId: 1, outputId: 1, title: 1, revision: 1, 'receipts.changedRows': 1, state: 1 }).lean<ISteelReviewOutput[]>(),
      readScopedOcr(scope),
      Message.find(messageFilter(scope)).select({ messageId: 1, 'metadata.steelMarkdownOwners': 1, 'metadata.steelReview': 1 }).lean<IMessage[]>(),
    ]);
    const messagesById = new Map(messages.map((message) => [message.messageId, message]));
    const outputsByOwner = new Map(outputs.map((output) => [JSON.stringify([output.kind, output.messageId, output.outputId, output.title]), output]));
    const versions = new Map<string, SteelMarkdownVersion>();
    for (const artifact of artifacts) {
      const ref = artifact.markdownPublication?.reference;
      if (!ref || ref.source !== 'ai') continue;
      const bound = messagesById.get(ref.messageId)?.metadata?.steelMarkdownOwners;
      if (!bound || typeof bound !== 'object' || Array.isArray(bound) || !(ref.kind in bound)) continue;
      const owner: unknown = Reflect.get(bound, ref.kind);
      if (!owner || typeof owner !== 'object' || Array.isArray(owner) || !('outputId' in owner) || owner.outputId !== ref.outputId) continue;
      const output = outputsByOwner.get(JSON.stringify([ref.kind, ref.messageId, ref.outputId, ref.title]));
      const current = state?.markdownPublication?.current?.[ref.kind];
      const matchesCurrent = current?.ai.outputId === ref.outputId && current.ai.messageId === ref.messageId && current.ai.title === ref.title;
      const customerRevision = ref.kind === 'customer_data' && matchesCurrent && current.effective.kind === ref.kind &&
        current.effective.outputId === ref.outputId && current.effective.messageId === ref.messageId && current.effective.title === ref.title
          ? current.effective.revision : undefined;
      versions.set(JSON.stringify([ref.messageId, ref.title]), { kind: ref.kind, messageId: ref.messageId, title: ref.title, outputId: ref.outputId,
        revision: customerRevision ?? output?.revision ?? ref.revision, latest: matchesCurrent,
        saves: output?.receipts.filter((receipt) => receipt.changedRows > 0).length ?? 0 });
    }
    for (const output of outputs) {
      if (!output.title || versions.has(JSON.stringify([output.messageId, output.title]))) continue;
      const latest = output.kind === 'ocr_result' ? ocr?.currentOcrResultMessageId === output.messageId && `ocr_result:${ocr.currentOcrResultGenerationId}` === output.outputId
        : state?.currentSystemOrder?.messageId === output.messageId && (state.currentSystemOrder.reviewOutputId ?? `system_order:${state.currentSystemOrder.runId}`) === output.outputId;
      versions.set(JSON.stringify([output.messageId, output.title]), { kind: output.kind, messageId: output.messageId, title: output.title, outputId: output.outputId, revision: output.revision,
        latest, saves: output.receipts.filter((receipt) => receipt.changedRows > 0).length });
    }
    return [...versions.values()];
  }
  async function saveSteelQuotationMessage(
    input: SteelQuotationPublicationProof,
  ): Promise<SteelQuotationPublicationSaveResult> {
    const { scope, message } = input;
    if (!scope.userId || !scope.conversationId || !input.runId || !input.runTargetMessageId ||
      input.targetMessageId !== message.messageId || message.conversationId !== scope.conversationId ||
      typeof message.text !== 'string' || !/^[a-f0-9]{64}$/u.test(input.finalSha256) ||
      !/^[a-f0-9]{64}$/u.test(input.currentOrderSha256) ||
      !/^[a-f0-9]{64}$/u.test(input.currentSystemOrderSha256)) {
      throw new Error('Quotation publication proof is invalid');
    }
    if (input.orderPublication) {
      if (!input.reviewBaseline || input.orderPublication.systemOrder.sha256 !== input.orderPublication.normalizedSha256 ||
        input.finalSha256 !== input.orderPublication.normalizedSha256) {
        throw new Error('Quotation order publication proof is invalid');
      }
      const published = await publishSteelMarkdown({
        scope,
        admission: input.orderPublication.admission,
        message,
        rawMarkdown: message.text,
        saveContext: input.saveContext,
        targets: [input.reviewBaseline],
        systemOrder: input.orderPublication.systemOrder,
        quotationOrder: {
          runId: input.runId,
          runTargetMessageId: input.runTargetMessageId,
          leaseToken: input.orderPublication.leaseToken,
          inputSnapshotSha256: input.orderPublication.inputSnapshotSha256,
          normalizedSha256: input.orderPublication.normalizedSha256,
          customer: input.customer,
          signal: input.orderPublication.signal,
        },
      });
      return published.ok
        ? { ok: true, message: published.message }
        : { ok: false, code: 'superseded' };
    }
    const tenantFilter = scope.tenantId === undefined
      ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
      : { tenantId: scope.tenantId };
    const stateFilter = { userId: scope.userId, conversationId: scope.conversationId, ...tenantFilter };
    const [quotation, currentMessage] = await Promise.all([
      State.findOne(stateFilter).lean<ISteelQuotationState | null>(),
      Message.findOne({ user: scope.userId, conversationId: scope.conversationId, messageId: input.targetMessageId, ...tenantFilter })
        .lean<IMessage | null>(),
    ]);
    const run = quotation?.activeRun;
    const currentSystemOrder = quotation?.currentSystemOrder;
    const customer = quotation?.currentCustomer;
    const finalCheckpoint = run?.checkpointRefs.find((ref) => ref.operationId === 'final' && ref.kind === 'final');
    const owner = currentMessage?.metadata?.steelMarkdownOwners;
    const systemOrderOwner = owner && typeof owner === 'object' && !Array.isArray(owner)
      ? Reflect.get(owner, 'system_order')
      : undefined;
    const proof = run && createSteelQuotationPublicationProof(Artifact);
    const isPublished = run && proof ? await proof.isPublished(scope, run) : false;
    const valid = Boolean(currentMessage && quotation && run && isPublished &&
      currentMessage.messageId === input.targetMessageId &&
      currentMessage.user === scope.userId && currentMessage.conversationId === scope.conversationId &&
      currentMessage.isCreatedByUser !== true && currentMessage.unfinished !== true &&
      run.runId === input.runId && run.status === 'completed' && run.targetMessageId === input.runTargetMessageId &&
      finalCheckpoint?.sha256 === input.finalSha256 &&
      quotation.currentOrder?.sha256 === input.currentOrderSha256 &&
      JSON.stringify(run.ocrSelection ?? null) === JSON.stringify(quotation.currentOrder?.ocrSelection ?? null) &&
      JSON.stringify(run.ocrSelection ?? null) === JSON.stringify(currentSystemOrder?.ocrSelection ?? null) &&
      customer?.preparationId === input.customer.preparationId &&
      customer.customerIdentity === input.customer.customerIdentity &&
      customer.customerMarkdown === input.customer.customerMarkdown &&
      currentSystemOrder?.runId === input.runId && currentSystemOrder.messageId === input.targetMessageId &&
      currentSystemOrder.sha256 === input.currentSystemOrderSha256 &&
      JSON.stringify(currentSystemOrder.sourceSnapshot ?? null) === JSON.stringify(input.sourceSnapshot ?? null) &&
      JSON.stringify(currentSystemOrder.calculationCheckpoint ?? null) === JSON.stringify(input.calculationCheckpoint ?? null) &&
      systemOrderOwner && typeof systemOrderOwner === 'object' && !Array.isArray(systemOrderOwner) &&
      Reflect.get(systemOrderOwner, 'source') === 'ai' &&
      Reflect.get(systemOrderOwner, 'kind') === 'system_order' &&
      Reflect.get(systemOrderOwner, 'outputId') === `system_order:${input.runId}` &&
      Reflect.get(systemOrderOwner, 'messageId') === input.targetMessageId);
    return valid
      ? { ok: true, message: currentMessage as SteelQuotationSavedMessage }
      : { ok: false, code: 'superseded' };
  }

  return { admitSteelMarkdown, publishSteelMarkdown, appendSteelQuotationSummary, appendSteelQuotationErrors, readSteelMarkdownVersions, saveSteelQuotationMessage };
}
