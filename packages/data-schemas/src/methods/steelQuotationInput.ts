import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type {
  ISteelQuotationArtifact,
  ISteelQuotationState,
  ISteelReviewOutput,
  SteelMarkdownReference,
  SteelQuotationActiveRun,
  SteelQuotationArtifactRef,
  SteelQuotationChunkState,
  SteelQuotationOcrInput,
  SteelQuotationOcrSelection,
  SteelQuotationOrder,
  SteelQuotationScope,
  SteelQuotationSnapshotPayload,
  SteelQuotationSourceMapping,
  SteelQuotationSourceSnapshot,
} from '~/types';
import {
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models/steel';
import { createSteelQuotationPublicationProof } from './published';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';
import { createFileModel } from '~/models/file';

type Mongoose = typeof import('mongoose');

type InputFailure = { ok: false; code: 'invalid_snapshot' | 'concurrent_change' };

export interface SteelQuotationInputReadResult {
  ok: true;
  input?: SteelQuotationOcrInput;
}

export interface SteelQuotationInputPrepareResult {
  ok: true;
  state: ISteelQuotationState;
  input?: SteelQuotationOcrInput;
}

export interface SteelQuotationInputChunk {
  index: number;
  sourceRowCount: number;
}

export interface SteelQuotationInputAdmission {
  scope: SteelQuotationScope;
  index: number;
  token: string;
  orderHash: string;
  customerMarkdown: string;
  customerIdentity: string;
  prompts: SteelQuotationSnapshotPayload['prompts'];
  chunks: readonly SteelQuotationInputChunk[];
  targetMessageId?: string;
  selection?: SteelQuotationOcrSelection;
  sourceSnapshot?: SteelQuotationSourceSnapshot;
  now?: Date;
}

export interface SteelQuotationInputStaleCheck {
  scope: SteelQuotationScope;
  runId: string;
  selection: SteelQuotationOcrSelection;
}

export interface SteelQuotationInputStaleResult {
  ok: true;
  needsRequote: boolean;
}

/** The user-facing snapshot lifetime is fixed at one day from admission. */
export const STEEL_QUOTATION_INPUT_TTL_MS: number = 24 * 60 * 60 * 1000;

export interface SteelQuotationInputRetirement {
  scope: SteelQuotationScope;
  runId: string;
  reason: 'cancelled' | 'expired' | 'published';
  now?: Date;
}

export interface SteelQuotationInputMethods {
  isSteelQuotationRunPublished(scope: SteelQuotationScope, run: SteelQuotationActiveRun): Promise<boolean>;
  retireSteelQuotationInput(input: SteelQuotationInputRetirement): Promise<{
    ok: true; state: ISteelQuotationState | null;
  } | InputFailure>;
  readSteelQuotationOcrInput(
    scope: SteelQuotationScope,
  ): Promise<SteelQuotationInputReadResult | InputFailure>;
  prepareSteelQuotationOcrInput(input: {
    scope: SteelQuotationScope;
    expectedOrderHash: string | null;
  }): Promise<SteelQuotationInputPrepareResult | InputFailure>;
  admitSteelQuotationOcrInput(
    input: SteelQuotationInputAdmission,
  ): Promise<{ ok: true; run: SteelQuotationActiveRun } | InputFailure>;
  markSteelQuotationOcrStale(
    input: SteelQuotationInputStaleCheck,
  ): Promise<SteelQuotationInputStaleResult | InputFailure>;
}

interface Candidate {
  reference: SteelMarkdownReference;
  markdown: string;
  sourceSnapshot: SteelQuotationSourceSnapshot;
}

interface ResolvedInput {
  state: ISteelQuotationState;
  invalid?: boolean;
  selection?: SteelQuotationOcrSelection;
  input?: SteelQuotationOcrInput;
}

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex');
const MAX_INPUT_ORDER_BYTES = 250_000;
const MAX_INPUT_CUSTOMER_BYTES = 100_000;
const MAX_INPUT_PROMPT_BYTES = 250_000;
const MAX_INPUT_TICKETS = 64;
const MAX_INPUT_PENDING_MESSAGES = 64;
const MAX_INPUT_PENDING_FILES = 32;
const MAX_INPUT_CHUNKS = 512;
const MAX_INPUT_ARTIFACT_BYTES = 2_000_000;
const MAX_INPUT_AUTHORITY_BYTES = 1_000_000;

function tenantFilter(scope: SteelQuotationScope): Record<string, unknown> {
  return scope.tenantId === undefined
    ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
    : { tenantId: scope.tenantId };
}

function scopeFilter(scope: SteelQuotationScope): Record<string, unknown> {
  return {
    userId: scope.userId,
    conversationId: scope.conversationId,
    ...tenantFilter(scope),
  };
}

function messageFilter(scope: SteelQuotationScope): Record<string, unknown> {
  return {
    user: scope.userId,
    conversationId: scope.conversationId,
    ...tenantFilter(scope),
  };
}

function isScope(scope: SteelQuotationScope): boolean {
  return scope.userId.length > 0 && scope.conversationId.length > 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameReference(
  left: SteelMarkdownReference | undefined,
  right: SteelMarkdownReference | undefined,
): boolean {
  return sameValue(
    left ? { ...left, version: left.version ?? 1 } : left,
    right ? { ...right, version: right.version ?? 1 } : right,
  );
}

function referenceShape(reference: SteelMarkdownReference | undefined): reference is SteelMarkdownReference {
  if (!reference) return false;
  return reference.kind === 'ocr_result' &&
    (reference.source === 'ai' || reference.source === 'human') &&
    [reference.snapshotId, reference.generationId, reference.outputId, reference.messageId,
      reference.title, reference.revision, reference.sha256, reference.lineageId]
      .every((value) => typeof value === 'string' && value.length > 0) &&
    /^[a-f0-9]{64}$/u.test(reference.sha256) &&
    Number.isSafeInteger(reference.version ?? 1) && (reference.version ?? 1) > 0 &&
    reference.savedAt instanceof Date;
}

function validMappings(value: unknown): value is SteelQuotationSourceMapping[] {
  if (!Array.isArray(value)) return false;
  const sourceCodes = new Set<string>();
  const fileIds = new Set<string>();
  for (const mapping of value) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return false;
    const candidate = mapping as Partial<SteelQuotationSourceMapping>;
    if (!candidate.fileId || !candidate.sourceCode || !candidate.sourceFilename ||
      typeof candidate.fileId !== 'string' || typeof candidate.sourceCode !== 'string' ||
      typeof candidate.sourceFilename !== 'string' || sourceCodes.has(candidate.sourceCode) ||
      fileIds.has(candidate.fileId)) return false;
    sourceCodes.add(candidate.sourceCode);
    fileIds.add(candidate.fileId);
  }
  return true;
}

function sourceSnapshot(
  reference: SteelMarkdownReference,
  mappings: SteelQuotationSourceMapping[] | undefined,
): SteelQuotationSourceSnapshot {
  return {
    orderHash: reference.sha256,
    generationId: reference.generationId,
    resultMessageId: reference.messageId,
    resultHash: reference.sha256,
    mappings: mappings ?? [],
  };
}

async function authorizeSourceMappings(
  File: ReturnType<typeof createFileModel>,
  Message: ReturnType<typeof createMessageModel>,
  scope: SteelQuotationScope,
  mappings: readonly SteelQuotationSourceMapping[],
  session: ClientSession | null,
): Promise<SteelQuotationSourceMapping[]> {
  if (mappings.length === 0) return [];
  const messageIds = await Message.find({
    ...messageFilter(scope),
    $and: [tenantFilter(scope), activeExpirationFilter()],
  })
    .session(session).select({ messageId: 1 }).lean<Array<{ messageId: string }>>();
  const files = await File.find({
    user: scope.userId,
    file_id: { $in: mappings.map((mapping) => mapping.fileId) },
    $and: [
      tenantFilter(scope),
      activeExpirationFilter(),
      {
        $or: [
          { conversationId: scope.conversationId },
          { conversationId: null, messageId: { $in: messageIds.map((message) => message.messageId) } },
        ],
      },
    ],
  }).session(session).select({ file_id: 1, filename: 1 }).lean<Array<{ file_id: string; filename: string }>>();
  const byFileId = new Map(files.map((file) => [file.file_id, file]));
  return mappings.filter((mapping) => byFileId.get(mapping.fileId)?.filename === mapping.sourceFilename);
}

function parsePublicationSnapshot(
  artifact: ISteelQuotationArtifact | undefined,
  reference: SteelMarkdownReference,
): Candidate | undefined {
  const operationId = reference.operationId ?? 'ai:ocr_result';
  if (!artifact || artifact.kind !== 'main' || artifact.runId !== `markdown:${reference.generationId}` ||
    artifact.operationId !== operationId || !artifact.markdownPublication) return undefined;
  const publication = artifact.markdownPublication;
  if (
    artifact.operationId !== operationId || !publication ||
    !sameReference(publication.reference, reference) ||
    hashText(artifact.payload) !== artifact.sha256 ||
    hashText(publication.baselineMarkdown) !== reference.sha256 ||
    !validMappings(publication.sourceMappings ?? [])) return undefined;
  try {
    const payload = JSON.parse(artifact.payload) as {
      rawMarkdown?: unknown;
      baselineMarkdown?: unknown;
    };
    if (payload.rawMarkdown !== publication.rawMarkdown || payload.baselineMarkdown !== publication.baselineMarkdown) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return {
    reference: { ...reference, version: reference.version ?? 1 },
    markdown: publication.baselineMarkdown,
    sourceSnapshot: sourceSnapshot({ ...reference, version: reference.version ?? 1 }, publication.sourceMappings),
  };
}

function parseHistoricalAiSnapshot(
  artifacts: readonly ISteelQuotationArtifact[],
  human: SteelMarkdownReference,
): Candidate | undefined {
  const artifact = artifacts.find((candidate) => {
    const reference = candidate.markdownPublication?.reference;
    return candidate.kind === 'main' && candidate.operationId === 'ai:ocr_result' &&
      reference?.kind === 'ocr_result' && reference.source === 'ai' &&
      reference.generationId === human.generationId && reference.outputId === human.outputId &&
      reference.messageId === human.messageId && reference.title === human.title &&
      reference.lineageId === human.lineageId;
  });
  const historicalReference = artifact?.markdownPublication?.reference;
  if (!historicalReference || historicalReference.generationId !== human.generationId ||
    historicalReference.lineageId !== human.lineageId) return undefined;
  return parsePublicationSnapshot(artifact, historicalReference);
}

function snapshotMappings(
  snapshot: NonNullable<ISteelReviewOutput['receipts'][number]['snapshot']>,
): SteelQuotationSourceMapping[] {
  if (snapshot.sourceMappings !== undefined && snapshot.sourceMappings.length > 0) {
    return validMappings(snapshot.sourceMappings) ? snapshot.sourceMappings : [];
  }
  const sourceColumn = snapshot.headers.find((header) => header === '來源') ??
    snapshot.headers.find((header) => header.toLowerCase() === 'source');
  if (!sourceColumn) return [];
  const byCode = new Map<string, SteelQuotationSourceMapping>();
  const byFile = new Map<string, SteelQuotationSourceMapping>();
  const blockedCodes = new Set<string>();
  const blockedFiles = new Set<string>();
  for (const row of snapshot.rows) {
    if (!row.source) continue;
    const sourceCode = row.values[sourceColumn]?.effective?.trim();
    if (!sourceCode || !row.source.fileId || !row.source.filename) continue;
    const mapping: SteelQuotationSourceMapping = {
      fileId: row.source.fileId,
      sourceCode,
      sourceFilename: row.source.filename,
      ...(row.source.mediaType ? { mediaType: row.source.mediaType } : {}),
    };
    const byCodeValue = byCode.get(sourceCode);
    const byFileValue = byFile.get(mapping.fileId);
    if (byCodeValue && !sameValue(byCodeValue, mapping)) {
      blockedCodes.add(sourceCode);
      blockedFiles.add(byCodeValue.fileId);
      blockedFiles.add(mapping.fileId);
    }
    if (byFileValue && !sameValue(byFileValue, mapping)) {
      blockedFiles.add(mapping.fileId);
      blockedCodes.add(byFileValue.sourceCode);
      blockedCodes.add(sourceCode);
    }
    byCode.set(sourceCode, mapping);
    byFile.set(mapping.fileId, mapping);
  }
  return [...byCode.values()].filter((mapping) =>
    !blockedCodes.has(mapping.sourceCode) && !blockedFiles.has(mapping.fileId));
}

function parseReviewSnapshot(
  output: ISteelReviewOutput,
  reference: SteelMarkdownReference,
  messageText: string | undefined,
): Candidate | undefined {
  if (output.kind !== 'ocr_result' || output.outputId !== reference.outputId ||
    output.messageId !== reference.messageId || output.title !== reference.title ||
    output.effectiveMarkdown === undefined || hashText(output.effectiveMarkdown) !== reference.sha256) return undefined;
  const receiptIndex = output.receipts.findIndex((candidate) =>
    candidate.operationId === reference.operationId && candidate.snapshot?.operationId === candidate.operationId &&
    candidate.digest === candidate.snapshot.digest && candidate.revision === reference.revision &&
    candidate.snapshot.outputId === reference.outputId && candidate.snapshot.revision === reference.revision &&
    candidate.snapshot.title === reference.title && candidate.snapshot.savedAt instanceof Date &&
    candidate.savedAt instanceof Date && candidate.savedAt.getTime() === reference.savedAt.getTime() &&
    candidate.snapshot.savedAt.getTime() === candidate.savedAt.getTime());
  const receipt = receiptIndex >= 0 ? output.receipts[receiptIndex] : undefined;
  const snapshot = receipt?.snapshot;
  if (!receipt || !snapshot || (reference.version !== undefined && reference.version !== receiptIndex + 2) ||
    snapshot.conversationId !== output.conversationId ||
    snapshot.messageId !== reference.messageId || snapshot.effectiveMarkdown !== output.effectiveMarkdown ||
    hashText(snapshot.effectiveMarkdown) !== reference.sha256 ||
    hashText(snapshot.messageText) !== snapshot.messageSha256 ||
    (messageText !== undefined && (snapshot.messageText !== messageText || snapshot.messageSha256 !== hashText(messageText)))) {
    return undefined;
  }
  const mappings = snapshotMappings(snapshot);
  const normalizedReference = {
    ...reference,
    version: reference.version ?? receiptIndex + 2,
  };
  return {
    reference: normalizedReference,
    markdown: snapshot.effectiveMarkdown,
    sourceSnapshot: sourceSnapshot(normalizedReference, mappings),
  };
}

function candidateReferences(state: ISteelQuotationState): {
  ai?: SteelMarkdownReference;
  human?: SteelMarkdownReference;
} {
  const ai = state.markdownPublication?.current?.ocr_result?.ai;
  const human = state.markdownPublication?.lastHumanOcr;
  return {
    ...(referenceShape(ai) ? { ai } : {}),
    ...(referenceShape(human) ? { human } : {}),
  };
}

function completedRun(status: SteelQuotationActiveRun['status'] | undefined): boolean {
  return status === 'completed' || status === 'cancelled';
}

function unfinishedRun(status: SteelQuotationActiveRun['status'] | undefined): boolean {
  return status !== undefined && !completedRun(status);
}

function artifactRef(
  scope: SteelQuotationScope,
  runId: string,
  operationId: string,
  kind: 'snapshot' | 'archive',
  sha256: string,
): SteelQuotationArtifactRef {
  return {
    artifactId: `${runId}:${operationId}:${sha256}`,
    userId: scope.userId,
    conversationId: scope.conversationId,
    ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
    runId,
    operationId,
    kind,
    sha256,
  };
}

function archivedRun(payload: string, expectedRunId: string): SteelQuotationActiveRun | undefined {
  try {
    const parsed = JSON.parse(payload) as { run?: SteelQuotationActiveRun };
    if (!parsed.run || parsed.run.runId !== expectedRunId || !completedRun(parsed.run.status) ||
      parsed.run.snapshotRef?.runId !== expectedRunId || parsed.run.snapshotRef.kind !== 'snapshot') return undefined;
    return parsed.run;
  } catch {
    return undefined;
  }
}

function nextOrder(input: SteelQuotationOcrInput): SteelQuotationOrder {
  return {
    markdown: input.markdown,
    sha256: input.selection.selected.sha256,
    revision: input.selection.selected.revision,
    messageId: input.selection.selected.messageId,
    ocrSelection: input.selection,
    sourceSnapshot: input.sourceSnapshot,
  };
}

function sameOrder(left: SteelQuotationOrder | undefined, right: SteelQuotationOrder): boolean {
  return Boolean(left) && left?.markdown === right.markdown && left.sha256 === right.sha256 &&
    left.revision === right.revision && left.messageId === right.messageId &&
    sameValue(left.ocrSelection, right.ocrSelection) && sameValue(left.sourceSnapshot, right.sourceSnapshot);
}

async function resolveInput(
  State: ReturnType<typeof createSteelQuotationStateModel>,
  Artifact: ReturnType<typeof createSteelQuotationArtifactModel>,
  Output: ReturnType<typeof createSteelReviewOutputModel>,
  Message: ReturnType<typeof createMessageModel>,
  File: ReturnType<typeof createFileModel>,
  Conversation: ReturnType<typeof createConversationModel>,
  scope: SteelQuotationScope,
  session?: ClientSession,
  knownState?: ISteelQuotationState | null,
): Promise<ResolvedInput | undefined> {
  const querySession = session ?? null;
  const state = knownState ?? await State.findOne(scopeFilter(scope)).session(querySession).lean<ISteelQuotationState>();
  if (!state) return undefined;
  const rawAi = state.markdownPublication?.current?.ocr_result?.ai;
  const rawHuman = state.markdownPublication?.lastHumanOcr;
  const candidates = candidateReferences(state);
  const ai = candidates.ai;
  const human = candidates.human;
  if ((rawAi !== undefined && !ai) || (rawHuman !== undefined && !human)) {
    return { state, invalid: true };
  }
  const conversation = await Conversation.findOne({
    ...messageFilter(scope),
    $and: [tenantFilter(scope), activeExpirationFilter()],
  })
    .session(querySession).lean();
  const artifactGenerations = [...new Set([ai?.generationId, human?.generationId].filter((value): value is string => Boolean(value)))];
  const artifacts = artifactGenerations.length > 0
    ? await Artifact.find({
      userId: scope.userId,
      conversationId: scope.conversationId,
      runId: { $in: artifactGenerations.map((generationId) => `markdown:${generationId}`) },
      $and: [tenantFilter(scope), activeExpirationFilter()],
    })
      .session(querySession).lean<ISteelQuotationArtifact[]>()
    : [];
  const outputs = human
    ? await Output.find({
      userId: scope.userId,
      conversationId: scope.conversationId,
      kind: 'ocr_result',
      outputId: human.outputId,
      messageId: human.messageId,
      title: human.title,
      $and: [tenantFilter(scope), activeExpirationFilter()],
    })
      .session(querySession).lean<ISteelReviewOutput[]>()
    : [];
  const messages = await Message.find({
    ...messageFilter(scope),
    $and: [tenantFilter(scope), activeExpirationFilter()],
    messageId: { $in: [ai?.messageId, human?.messageId].filter(Boolean) },
  })
    .session(querySession).select({ messageId: 1, text: 1 }).lean<Array<{ messageId: string; text?: string }>>();
  if (!conversation) return { state, invalid: Boolean(ai || human) };
  const aiCandidate = ai
    ? parsePublicationSnapshot(artifacts.find((artifact: ISteelQuotationArtifact) =>
      artifact.runId === `markdown:${ai.generationId}` && artifact.operationId === (ai.operationId ?? 'ai:ocr_result')), ai)
    : undefined;
  const aiMessage = messages.find((message: { messageId: string; text?: string }) => message.messageId === ai?.messageId);
  const trustedAi = aiCandidate && aiMessage ? aiCandidate : undefined;
  const historicalAi = human && !ai ? parseHistoricalAiSnapshot(artifacts, human) : undefined;
  const humanLineage = trustedAi?.reference.lineageId ?? historicalAi?.reference.lineageId;
  const humanMessage = messages.find((message) => message.messageId === human?.messageId);
  const humanCandidate = human && humanMessage && humanLineage === human.lineageId && outputs.length === 1
    ? parseReviewSnapshot(
      outputs[0],
      human,
      ai && human.generationId === ai.generationId
        ? humanMessage.text
        : undefined,
    )
    : undefined;
  const aiVerified = trustedAi
    ? {
        ...trustedAi,
        sourceSnapshot: {
          ...trustedAi.sourceSnapshot,
          mappings: await authorizeSourceMappings(File, Message, scope, trustedAi.sourceSnapshot.mappings, querySession),
        },
      }
    : undefined;
  const humanVerified = humanCandidate
    ? {
        ...humanCandidate,
        sourceSnapshot: {
          ...humanCandidate.sourceSnapshot,
          mappings: await authorizeSourceMappings(File, Message, scope, humanCandidate.sourceSnapshot.mappings, querySession),
        },
      }
    : undefined;
  if ((ai && !aiVerified) || (human && !humanVerified)) return { state, invalid: true };
  const selected = humanVerified &&
    (!aiVerified || humanVerified.reference.savedAt.getTime() > aiVerified.reference.savedAt.getTime())
    ? humanVerified
    : aiVerified;
  if (!selected) return { state, invalid: Boolean(ai || human) };
  const selection: SteelQuotationOcrSelection = {
    candidates,
    selected: selected.reference,
    version: selected.reference.version ?? 1,
  };
  return {
    state,
    selection,
    input: {
      selection,
      markdown: selected.markdown,
      sourceSnapshot: selected.sourceSnapshot,
    },
  };
}

export function createSteelQuotationInputMethods(mongoose: Mongoose): SteelQuotationInputMethods {
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const Output = createSteelReviewOutputModel(mongoose);
  const Message = createMessageModel(mongoose);
  const File = createFileModel(mongoose);
  const Conversation = createConversationModel(mongoose);

  const isRunPublished = async (
    scope: SteelQuotationScope,
    run: SteelQuotationActiveRun,
    session?: ClientSession,
  ): Promise<boolean> => createSteelQuotationPublicationProof(Artifact, session).isPublished(scope, run);

  async function isSteelQuotationRunPublished(
    scope: SteelQuotationScope,
    run: SteelQuotationActiveRun,
  ): Promise<boolean> {
    return isRunPublished(scope, run);
  }

  async function blocksFreshRun(scope: SteelQuotationScope, run?: SteelQuotationActiveRun,
    session?: ClientSession): Promise<boolean> {
    return Boolean(run && (unfinishedRun(run.status) ||
      (run.status === 'completed' && !await isRunPublished(scope, run, session))));
  }

  async function readSteelQuotationOcrInput(
    scope: SteelQuotationScope,
  ): Promise<SteelQuotationInputReadResult | InputFailure> {
    if (!isScope(scope)) return { ok: false, code: 'invalid_snapshot' };
    const resolved = await resolveInput(State, Artifact, Output, Message, File, Conversation, scope);
    if (resolved?.invalid) return { ok: false, code: 'invalid_snapshot' };
    return resolved?.input ? { ok: true, input: resolved.input } : { ok: true };
  }

  async function prepareSteelQuotationOcrInput(input: {
    scope: SteelQuotationScope;
    expectedOrderHash: string | null;
  }): Promise<SteelQuotationInputPrepareResult | InputFailure> {
    if (!isScope(input.scope)) return { ok: false, code: 'invalid_snapshot' };
    const legacy = await State.findOne(scopeFilter(input.scope)).lean<ISteelQuotationState>();
    const currentOrderHash = legacy?.currentOrder?.sha256;
    if (input.expectedOrderHash === null ? currentOrderHash !== undefined : currentOrderHash !== input.expectedOrderHash) {
      return { ok: false, code: 'concurrent_change' };
    }
    const hasPublishedReference = legacy?.markdownPublication?.current?.ocr_result?.ai !== undefined ||
      legacy?.markdownPublication?.lastHumanOcr !== undefined;
    if (!hasPublishedReference && legacy) {
      if (await blocksFreshRun(input.scope, legacy.activeRun)) return { ok: false, code: 'concurrent_change' };
      return { ok: true, state: legacy };
    }
    const session = await mongoose.startSession();
    let result: SteelQuotationInputPrepareResult | InputFailure = { ok: false, code: 'concurrent_change' };
    try {
      await session.withTransaction(async () => {
        const current = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        if (input.expectedOrderHash === null
          ? current?.currentOrder?.sha256 !== undefined
          : current?.currentOrder?.sha256 !== input.expectedOrderHash) {
          result = { ok: false, code: 'concurrent_change' };
          return;
        }
        if (await blocksFreshRun(input.scope, current?.activeRun, session)) {
          result = { ok: false, code: 'concurrent_change' };
          return;
        }
        const resolved = await resolveInput(State, Artifact, Output, Message, File, Conversation, input.scope, session, current);
        if (!resolved || resolved.invalid) {
          result = { ok: false, code: 'invalid_snapshot' };
          return;
        }
        if (!resolved.input) {
          result = { ok: true, state: resolved.state };
          return;
        }
        const order = nextOrder(resolved.input);
        if (sameOrder(resolved.state.currentOrder, order)) {
          result = { ok: true, state: resolved.state, input: resolved.input };
          return;
        }
        const now = new Date();
        const update = await State.findOneAndUpdate(
          { ...scopeFilter(input.scope), ...(resolved.state._id ? { _id: resolved.state._id } : {}) },
          {
            $set: { currentOrder: order, tickets: resolved.state.tickets.filter((ticket) => ticket.acceptedRunId), updatedAt: now },
            $unset: { customerLookupEvidence: 1 },
          },
          { new: true, session },
        ).lean<ISteelQuotationState>();
        if (!update) {
          result = { ok: false, code: 'concurrent_change' };
          return;
        }
        result = { ok: true, state: update, input: resolved.input };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async function admitSteelQuotationOcrInput(
    input: SteelQuotationInputAdmission,
  ): Promise<{ ok: true; run: SteelQuotationActiveRun } | InputFailure> {
    if (!isScope(input.scope) || !Number.isSafeInteger(input.index) || input.index < 1 ||
      !input.token || !input.orderHash ||
      (input.selection && (!Number.isSafeInteger(input.selection.version) || input.selection.version < 1))) {
      return { ok: false, code: 'invalid_snapshot' };
    }
    const session = await mongoose.startSession();
    const concurrent = new Error('Steel quotation input changed concurrently');
    let result: { ok: true; run: SteelQuotationActiveRun } | InputFailure = { ok: false, code: 'concurrent_change' };
    try {
      await session.withTransaction(async () => {
        const current = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        const ticket = current?.tickets.find((candidate) => candidate.index === input.index && candidate.token === input.token);
        if (!current || !ticket) {
          result = { ok: false, code: 'invalid_snapshot' };
          return;
        }
        if (ticket.acceptedRunId) {
          const active = current.activeRun?.runId === ticket.acceptedRunId ? current.activeRun : undefined;
          if (active) {
            result = { ok: true, run: active };
            return;
          }
          const archive = await Artifact.findOne({ ...scopeFilter(input.scope), runId: ticket.acceptedRunId, operationId: 'archive', kind: 'archive' })
            .session(session).lean<ISteelQuotationArtifact>();
          const archived = archive && hashText(archive.payload) === archive.sha256
            ? archivedRun(archive.payload, ticket.acceptedRunId)
            : undefined;
          result = archived ? { ok: true, run: archived } : { ok: false, code: 'invalid_snapshot' };
          return;
        }
        const resolved = input.selection
          ? await resolveInput(State, Artifact, Output, Message, File, Conversation, input.scope, session, current)
          : undefined;
        const selected = resolved?.input;
        const order = selected ? nextOrder(selected) : current.currentOrder;
        const candidatesMatch = input.selection
          ? Boolean(selected) && !resolved?.invalid && sameValue(selected?.selection, input.selection) &&
            sameValue(current.markdownPublication?.current?.ocr_result?.ai, input.selection.candidates.ai) &&
            sameValue(current.markdownPublication?.lastHumanOcr, input.selection.candidates.human) &&
            Boolean(order && sameOrder(current.currentOrder, order))
          : current.markdownPublication?.current?.ocr_result?.ai === undefined &&
            current.markdownPublication?.lastHumanOcr === undefined && current.currentOrder?.ocrSelection === undefined;
        if (!candidatesMatch || !order || order.sha256 !== input.orderHash ||
          ticket.orderHash !== input.orderHash || ticket.customerMarkdown !== input.customerMarkdown ||
          ticket.customerIdentity !== input.customerIdentity) {
          result = { ok: false, code: 'concurrent_change' };
          return;
        }
        const customer = current.currentCustomer;
        const provenance = customer?.selectionProvenance;
        if ((ticket.preparationId !== undefined || ticket.responseId !== undefined) &&
          (ticket.preparationId === undefined || ticket.responseId === undefined ||
            !customer || customer.preparationId !== ticket.preparationId ||
            customer.customerMarkdown !== ticket.customerMarkdown ||
            customer.customerIdentity !== ticket.customerIdentity ||
            provenance?.method !== ticket.selectionProvenance.method ||
            provenance?.lookupMessageId !== ticket.selectionProvenance.lookupMessageId ||
            provenance?.selectionMessageId !== ticket.selectionProvenance.selectionMessageId ||
            provenance?.selectedCustomerId !== ticket.selectionProvenance.selectedCustomerId)) {
          result = { ok: false, code: 'concurrent_change' };
          return;
        }
        if (await blocksFreshRun(input.scope, current.activeRun, session)) {
          result = { ok: false, code: 'concurrent_change' };
          return;
        }
        const now = input.now ?? new Date();
        const runId = input.token;
        const snapshotPayload: SteelQuotationSnapshotPayload = {
          prompts: input.prompts,
          orderMarkdown: order.markdown,
          orderHash: order.sha256,
          customerMarkdown: input.customerMarkdown,
          customerIdentity: input.customerIdentity,
          ...((selected?.sourceSnapshot ?? input.sourceSnapshot)
            ? { sourceSnapshot: selected?.sourceSnapshot ?? input.sourceSnapshot } : {}),
          ...(selected ? { ocrSelection: selected.selection } : {}),
        };
        const payload = JSON.stringify(snapshotPayload);
        const snapshotHash = hashText(payload);
        const snapshotRef = artifactRef(input.scope, runId, 'snapshot', 'snapshot', snapshotHash);
        const chunkIndexes = new Set<number>();
        if (input.chunks.length > MAX_INPUT_CHUNKS || current.tickets.length > MAX_INPUT_TICKETS ||
          current.pendingMessages.length > MAX_INPUT_PENDING_MESSAGES ||
          current.pendingMessages.some((message) => (message.sourceMessageFiles?.length ?? 0) > MAX_INPUT_PENDING_FILES) ||
          Buffer.byteLength(order.markdown, 'utf8') > MAX_INPUT_ORDER_BYTES ||
          Buffer.byteLength(input.customerMarkdown, 'utf8') > MAX_INPUT_CUSTOMER_BYTES ||
          Buffer.byteLength(input.customerIdentity, 'utf8') > MAX_INPUT_CUSTOMER_BYTES ||
          Buffer.byteLength(input.prompts.child, 'utf8') > MAX_INPUT_PROMPT_BYTES ||
          Buffer.byteLength(input.prompts.main, 'utf8') > MAX_INPUT_PROMPT_BYTES ||
          input.chunks.some((chunk) => !Number.isSafeInteger(chunk.index) || chunk.index < 1 ||
            chunkIndexes.has(chunk.index) || !chunkIndexes.add(chunk.index) ||
            !Number.isSafeInteger(chunk.sourceRowCount) || chunk.sourceRowCount < 0)) {
          result = { ok: false, code: 'invalid_snapshot' };
          return;
        }
        const chunks: SteelQuotationChunkState[] = input.chunks.map((chunk) => ({
          index: chunk.index,
          sourceRowCount: chunk.sourceRowCount,
          status: 'pending',
        }));
        const nextRun: SteelQuotationActiveRun = {
          runId,
          index: input.index,
          status: 'queued',
          triggerMessageId: ticket.triggeringMessageId,
          ...(input.targetMessageId ? { targetMessageId: input.targetMessageId } : {}),
          ...(selected ? { ocrSelection: selected.selection } : {}),
          snapshotRef,
          chunks,
          checkpointRefs: [],
          acceptedAt: now,
          updatedAt: now,
        };
        const projectedTickets = current.tickets.map((ticket) =>
          ticket.index === input.index && ticket.token === input.token ? { ...ticket, acceptedRunId: runId } : ticket);
        const authorityPayload = JSON.stringify({
          userId: current.userId,
          conversationId: current.conversationId,
          tenantId: current.tenantId,
          currentOrder: order,
          currentSystemOrder: current.currentSystemOrder,
          currentCustomer: current.currentCustomer,
          customerLookupEvidence: current.customerLookupEvidence,
          nextSignalIndex: current.nextSignalIndex,
          tickets: projectedTickets,
          activeRun: nextRun,
          pendingMessages: current.pendingMessages,
        });
        if (Buffer.byteLength(payload, 'utf8') > MAX_INPUT_ARTIFACT_BYTES ||
          Buffer.byteLength(authorityPayload, 'utf8') > MAX_INPUT_AUTHORITY_BYTES) {
          result = { ok: false, code: 'invalid_snapshot' };
          return;
        }
        await Artifact.create([{
          userId: input.scope.userId,
          conversationId: input.scope.conversationId,
          ...(input.scope.tenantId !== undefined ? { tenantId: input.scope.tenantId } : {}),
          runId,
          operationId: 'snapshot',
          kind: 'snapshot',
          sha256: snapshotHash,
          payload,
          expiresAt: new Date(now.getTime() + STEEL_QUOTATION_INPUT_TTL_MS),
          createdAt: now,
          updatedAt: now,
        }], { session });
        if (current.activeRun && completedRun(current.activeRun.status)) {
          const archivePayload = JSON.stringify({ run: current.activeRun });
          const archiveHash = hashText(archivePayload);
          await Artifact.create([{
            userId: input.scope.userId,
            conversationId: input.scope.conversationId,
            ...(input.scope.tenantId !== undefined ? { tenantId: input.scope.tenantId } : {}),
            runId: current.activeRun.runId,
            operationId: 'archive',
            kind: 'archive',
            sha256: archiveHash,
            payload: archivePayload,
            createdAt: now,
            updatedAt: now,
          }], { session });
        }
        const updated = await State.updateOne(
          {
            ...scopeFilter(input.scope),
            _id: current._id,
            'currentOrder.sha256': input.orderHash,
            'tickets': { $elemMatch: { index: input.index, token: input.token, acceptedRunId: { $exists: false } } },
            ...(current.activeRun ? { 'activeRun.runId': current.activeRun.runId,
              'activeRun.status': current.activeRun.status, 'activeRun.checkpointRefs': current.activeRun.checkpointRefs,
            } : { activeRun: { $exists: false } }),
          },
          { $set: { activeRun: nextRun, 'tickets.$.acceptedRunId': runId, updatedAt: now } },
          { session },
        );
        if (updated.matchedCount !== 1) throw concurrent;
        result = { ok: true, run: nextRun };
      });
      return result;
    } catch (error) {
      if (error === concurrent) return { ok: false, code: 'concurrent_change' };
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async function retireSteelQuotationInput(
    input: SteelQuotationInputRetirement,
  ): Promise<{ ok: true; state: ISteelQuotationState | null } | InputFailure> {
    if (!isScope(input.scope) || !input.runId) return { ok: false, code: 'invalid_snapshot' };
    const now = input.now ?? new Date();
    const session = await mongoose.startSession();
    const concurrent = new Error('Steel quotation input retirement changed concurrently');
    let result: { ok: true; state: ISteelQuotationState | null } | InputFailure = {
      ok: false, code: 'concurrent_change',
    };
    try {
      await session.withTransaction(async () => {
        const current = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        const run = current?.activeRun;
        if (!current || !run || run.runId !== input.runId) {
          result = { ok: true, state: current };
          return;
        }
        const published = run.checkpointRefs.find((ref) => ref.operationId === 'published' && ref.kind === 'final');
        if (input.reason === 'expired' && new Date(run.acceptedAt).getTime() + STEEL_QUOTATION_INPUT_TTL_MS > now.getTime()) {
          result = { ok: true, state: current };
          return;
        }
        if (input.reason === 'published' || (input.reason === 'expired' && published)) {
          if (!await isRunPublished(input.scope, run, session)) {
            result = { ok: false, code: 'invalid_snapshot' };
            return;
          }
        } else if (input.reason === 'cancelled' && run.status === 'completed') {
          result = { ok: true, state: current };
          return;
        }
        const ref = run.snapshotRef;
        if (ref.kind !== 'snapshot' || ref.operationId !== 'snapshot' || ref.runId !== run.runId ||
          ref.userId !== input.scope.userId || ref.conversationId !== input.scope.conversationId ||
          ref.tenantId !== input.scope.tenantId) {
          result = { ok: false, code: 'invalid_snapshot' };
          return;
        }
        const terminal = input.reason === 'published' || Boolean(published);
        const updated = await State.findOneAndUpdate({ ...scopeFilter(input.scope), _id: current._id,
          'activeRun.runId': run.runId, 'activeRun.status': run.status, 'activeRun.acceptedAt': run.acceptedAt }, {
          $set: { updatedAt: now, ...(!terminal ? {
            'activeRun.status': 'cancelled', 'activeRun.updatedAt': now,
          } : {}) },
          ...(!terminal ? { $unset: { 'activeRun.leaseToken': 1, 'activeRun.leaseExpiresAt': 1 } } : {}),
        }, { new: true, session }).lean<ISteelQuotationState>();
        if (!updated) throw concurrent;
        await Artifact.deleteOne({ ...scopeFilter(input.scope), runId: run.runId, operationId: 'snapshot',
          kind: 'snapshot', sha256: ref.sha256 }, { session });
        result = { ok: true, state: updated };
      });
      return result;
    } catch (error) {
      if (error === concurrent) return { ok: false, code: 'concurrent_change' };
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async function markSteelQuotationOcrStale(
    input: SteelQuotationInputStaleCheck,
  ): Promise<SteelQuotationInputStaleResult | InputFailure> {
    if (!isScope(input.scope) || !input.runId ||
      !Number.isSafeInteger(input.selection.version) || input.selection.version < 1) {
      return { ok: false, code: 'invalid_snapshot' };
    }
    const session = await mongoose.startSession();
    let result: SteelQuotationInputStaleResult | InputFailure = { ok: false, code: 'concurrent_change' };
    try {
      await session.withTransaction(async () => {
        const current = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        const systemOrder = current?.currentSystemOrder;
        if (!current || !systemOrder || systemOrder.runId !== input.runId ||
          !sameValue(systemOrder.ocrSelection, input.selection)) {
          result = { ok: false, code: 'concurrent_change' };
          return;
        }
        const resolved = await resolveInput(State, Artifact, Output, Message, File, Conversation, input.scope, session, current);
        if (!resolved?.input || resolved.invalid) {
          result = { ok: false, code: 'invalid_snapshot' };
          return;
        }
        if (sameReference(resolved.input.selection.selected, input.selection.selected)) {
          result = { ok: true, needsRequote: Boolean(systemOrder.needsRequote) };
          return;
        }
        if (systemOrder.needsRequote) {
          result = { ok: true, needsRequote: true };
          return;
        }
        const updated = await State.findOneAndUpdate(
          {
            ...scopeFilter(input.scope),
            _id: current._id,
            'currentSystemOrder.runId': input.runId,
            'currentSystemOrder.ocrSelection': input.selection,
            'currentSystemOrder.needsRequote': { $ne: true },
          },
          {
            $set: {
              'currentSystemOrder.needsRequote': true,
              'currentSystemOrder.updatedAt': new Date(),
              updatedAt: new Date(),
            },
          },
          { new: true, session },
        ).lean<ISteelQuotationState>();
        if (!updated) {
          result = { ok: false, code: 'concurrent_change' };
          return;
        }
        result = { ok: true, needsRequote: true };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  return {
    isSteelQuotationRunPublished,
    retireSteelQuotationInput,
    readSteelQuotationOcrInput,
    prepareSteelQuotationOcrInput,
    admitSteelQuotationOcrInput,
    markSteelQuotationOcrStale,
  };
}
