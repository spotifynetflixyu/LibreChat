import { createHash } from 'node:crypto';
import type {
  IMessage,
  ISteelConversationOcrState,
  ISteelDelegateOcrRun,
  ISteelQuotationState,
  ISteelReviewOutput,
  SteelReviewReadInput,
  SteelReviewReadRecord,
  SteelReviewReceipt,
  SteelReviewScope,
  SteelReviewSourceMapping,
  SteelReviewTextPart,
} from '~/types';
import type {
  SteelReviewCaption,
  SteelReviewRow,
  SteelReviewTarget,
} from 'librechat-data-provider';
import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models';
import { createSteelReviewSourceAuthorization } from './steelSourceAuthorization';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';

type Mongoose = typeof import('mongoose');

export interface SteelReviewReadMethods {
  readSteelReview(input: SteelReviewReadInput): Promise<SteelReviewReadRecord | null>;
}

export interface SteelReviewCommitInput extends SteelReviewReadInput {
  outputId: string;
  revision: string;
  operationId: string;
  digest: string;
  rows: SteelReviewRow[];
  headers: string[];
  messageSha256: string;
  target: SteelReviewTarget;
  targetText: string;
  replacementText: string;
  cleanReplacementText: string;
  effectiveMarkdown: string;
  displayMarkdown: string;
  aiBaselineMarkdown?: string;
  aiRawMarkdown?: string;
  caption: SteelReviewCaption;
}

export interface SteelReviewCommitResult {
  operationId: string;
  digest: string;
  outputId: string;
  revision: string;
  changedRows: number;
  changedRowIds: string[];
  savedAt: Date;
  messageSha256: string;
  effectiveMarkdown: string;
  displayMarkdown: string;
}

export interface SteelReviewWriteMethods {
  commitSteelReview(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult>;
  isManagedSteelReviewMessage(input: SteelReviewScope & { messageId: string }): Promise<boolean>;
}

export class SteelReviewWriteError extends Error {
  readonly code: 'REVIEW_CONFLICT' | 'REVIEW_NOT_FOUND' | 'REVIEW_INVALID_OPERATION';

  constructor(
    code: SteelReviewWriteError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'SteelReviewWriteError';
    this.code = code;
  }
}

function tenantFilter(tenantId?: string): Record<string, unknown> {
  return tenantId === undefined
    ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
    : { tenantId };
}

function scopeFilter(input: SteelReviewReadInput): Record<string, unknown> {
  return {
    userId: input.userId,
    ...tenantFilter(input.tenantId),
    conversationId: input.conversationId,
  };
}

function reviewScope(input: SteelReviewScope): Record<string, unknown> {
  return {
    userId: input.userId,
    ...tenantFilter(input.tenantId),
    conversationId: input.conversationId,
  };
}

function messageFilter(input: SteelReviewReadInput): Record<string, unknown> {
  return {
    $and: [
      {
        messageId: input.messageId,
        conversationId: input.conversationId,
        user: input.userId,
      },
      tenantFilter(input.tenantId),
      activeExpirationFilter(),
    ],
  };
}

function appendRenderedText(current: string, next: string): string {
  if (current.length > 0 && next.length > 0 &&
    current[current.length - 1] !== ' ' && next[0] !== ' ') {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
}

function renderedMessageText(
  message: Pick<IMessage, 'text' | 'content'>,
  requestedPartIndex?: number,
): { selected: string; parts: SteelReviewTextPart[]; selectedPartIndex?: number } | undefined {
  if (typeof message.text !== 'string') {
    return undefined;
  }
  // Native Responses messages may persist only the rendered text. There is
  // no part locator to claim in that shape, but the text itself remains the
  // trusted message boundary.
  if (!Array.isArray(message.content)) {
    return requestedPartIndex === undefined ? { selected: message.text, parts: [] } : undefined;
  }
  const parts = message.content.flatMap((part, partIndex) => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      return [];
    }
    const value = part as { type?: unknown; text?: unknown };
    return value.type === 'text' && typeof value.text === 'string'
      ? [{ partIndex, text: value.text }]
      : [];
  });
  if (parts.length === 0) {
    return undefined;
  }
  const selectedPart = requestedPartIndex === undefined
    ? undefined
    : parts.find((part) => part.partIndex === requestedPartIndex);
  if (requestedPartIndex !== undefined && !selectedPart) {
    return undefined;
  }
  const rendered = parts.reduce((result, part) => appendRenderedText(result, part.text), '');
  if (rendered !== message.text) {
    return undefined;
  }
  return {
    selected: selectedPart?.text ?? message.text,
    parts,
    ...(selectedPart ? { selectedPartIndex: selectedPart.partIndex } : {}),
  };
}

interface AuthorizedFile {
  fileId: string;
  filename: string;
}

function sourceMappings(
  state: ISteelConversationOcrState,
  authorizedFiles: ReadonlyMap<string, AuthorizedFile>,
): SteelReviewSourceMapping[] {
  return (state.sourceMappings ?? []).map((mapping) => ({
    fileId: mapping.fileId,
    sourceCode: mapping.sourceCode,
    sourceFilename: authorizedFiles.get(mapping.fileId)?.filename ?? mapping.sourceFilename,
  })).filter((mapping) => authorizedFiles.has(mapping.fileId));
}

function sanitizeRows(
  rows: ISteelReviewOutput['rows'],
  authorizedFiles: ReadonlyMap<string, AuthorizedFile>,
): ISteelReviewOutput['rows'] {
  return rows.map((row) => {
    if (!row.source || !authorizedFiles.has(row.source.fileId)) {
      return { ...row, source: null };
    }
    const file = authorizedFiles.get(row.source.fileId);
    return {
      ...row,
      source: {
        ...row.source,
        ...(file ? { filename: file.filename } : {}),
      },
    };
  });
}

function sidecarRecord(
  output: Pick<ISteelReviewOutput, 'userId' | 'tenantId' | 'conversationId' | 'kind' | 'messageId' | 'tableId' | 'outputId' | 'revision' | 'state' | 'headers' | 'rows' | 'latestOutputId' | 'aiRawMarkdown' | 'aiBaselineMarkdown' | 'humanMarkdown' | 'humanSavedAt' | 'effectiveMarkdown' | 'displayMarkdown' | 'receipts'>,
  message?: { selected: string; parts: SteelReviewTextPart[]; selectedPartIndex?: number },
  authorizedFiles: ReadonlyMap<string, AuthorizedFile> = new Map(),
): SteelReviewReadRecord {
  return {
    userId: output.userId,
    ...(output.tenantId ? { tenantId: output.tenantId } : {}),
    conversationId: output.conversationId,
    kind: output.kind,
    messageId: output.messageId,
    tableId: output.tableId,
    outputId: output.outputId,
    revision: output.revision,
    state: output.state,
    headers: output.headers,
    rows: sanitizeRows(output.rows, authorizedFiles).map((row) => ({
      ...row,
      values: row.values instanceof Map ? Object.fromEntries(row.values) : row.values,
    })),
    ...(output.latestOutputId ? { latestOutputId: output.latestOutputId } : {}),
    ...(output.aiRawMarkdown ? { aiRawMarkdown: output.aiRawMarkdown } : {}),
    ...(output.aiBaselineMarkdown ? { aiBaselineMarkdown: output.aiBaselineMarkdown } : {}),
    ...(output.humanMarkdown ? { humanMarkdown: output.humanMarkdown } : {}),
    ...(output.humanSavedAt ? { humanSavedAt: output.humanSavedAt } : {}),
    ...(output.effectiveMarkdown ? { effectiveMarkdown: output.effectiveMarkdown } : {}),
    ...(output.displayMarkdown ? { displayMarkdown: output.displayMarkdown } : {}),
    ...(output.receipts?.length > 0 ? { lastSave: output.receipts[output.receipts.length - 1] } : {}),
    ...(message
      ? {
          messageText: message.selected,
          messageTextParts: message.parts,
          messageTextPartIndex: message.selectedPartIndex,
        }
      : {}),
  };
}

interface ReviewAuthority {
  outputId: string;
  messageId?: string;
}

function matchesTenantScope(value: unknown, tenantId?: string): boolean {
  return tenantId === undefined ? value == null : value === tenantId;
}

function selectSidecar(
  candidates: ISteelReviewOutput[],
  authority: ReviewAuthority | undefined,
  requestedMessageId: string,
): ISteelReviewOutput | undefined {
  if (authority) {
    const current = authority.messageId === requestedMessageId
      ? candidates.filter((candidate) => candidate.outputId === authority.outputId)
      : [];
    if (current.length === 1) {
      return current[0];
    }
    // Without a proven different target, an old sidecar must not hide current data.
    if (authority.messageId === undefined || authority.messageId === requestedMessageId) {
      return undefined;
    }
    // A current output bound to another message cannot certify this sidecar as current.
    if (candidates.some((candidate) => candidate.outputId === authority.outputId)) {
      return candidates.length === 1 && candidates[0]?.outputId !== authority.outputId
        ? candidates[0]
        : undefined;
    }
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function isPublishedFinalArtifact(
  artifact: { sha256: string },
  publication: { payload: string } | undefined,
): boolean {
  if (!publication) {
    return false;
  }
  try {
    const value: unknown = JSON.parse(publication.payload);
    return typeof value === 'object' && value !== null &&
      'finalSha256' in value && value.finalSha256 === artifact.sha256;
  } catch {
    return false;
  }
}

function archivedRunOwnsMessage(
  artifact: { runId: string; payload: string },
  messageId: string,
): boolean {
  try {
    const value: unknown = JSON.parse(artifact.payload);
    if (typeof value !== 'object' || value === null || !('run' in value) ||
      typeof value.run !== 'object' || value.run === null) {
      return false;
    }
    const run = value.run as { runId?: unknown; status?: unknown; targetMessageId?: unknown };
    return run.runId === artifact.runId && run.status === 'completed' &&
      run.targetMessageId === messageId;
  } catch {
    return false;
  }
}

export function createSteelReviewReadMethods(mongoose: Mongoose): SteelReviewReadMethods {
  const Message = createMessageModel(mongoose);
  const Conversation = createConversationModel(mongoose);
  const OcrState = createSteelConversationOcrStateModel(mongoose);
  const OcrRun = createSteelDelegateOcrRunModel(mongoose);
  const QuotationState = createSteelQuotationStateModel(mongoose);
  const QuotationArtifact = createSteelQuotationArtifactModel(mongoose);
  const ReviewOutput = createSteelReviewOutputModel(mongoose);
  const authorizeFiles = createSteelReviewSourceAuthorization(mongoose);

  const readAuthorizedFiles = async (
    input: SteelReviewReadInput,
    fileIds: readonly string[],
  ): Promise<Map<string, AuthorizedFile>> => {
    const files = await authorizeFiles(input, fileIds);
    const authorized = new Map<string, AuthorizedFile>();
    for (const file of files.values()) {
      authorized.set(file.file_id, { fileId: file.file_id, filename: file.filename });
    }
    return authorized;
  };

  return {
    async readSteelReview(input) {
      const [messageRecords, conversation, conversationIdentities] = await Promise.all([
        Message.find(messageFilter(input))
          .select({ messageId: 1, text: 1, content: 1, files: 1 })
          .lean<Pick<IMessage, 'messageId' | 'text' | 'content' | 'files'>[]>(),
        Conversation.findOne({
          $and: [
            { user: input.userId, conversationId: input.conversationId },
            tenantFilter(input.tenantId),
            activeExpirationFilter(),
          ],
        })
          .select({ conversationId: 1 })
          .lean(),
        Conversation.find({ conversationId: input.conversationId })
          .select({ user: 1, tenantId: 1 })
          .lean<Array<{ user?: string; tenantId?: string | null }>>(),
      ]);
      if (messageRecords.length !== 1 || !conversation) {
        return null;
      }
      const messageRecord = messageRecords[0];
      const message = renderedMessageText(messageRecord, input.partIndex);
      if (!message) {
        return null;
      }
      const trustedGlobalConversation = conversationIdentities.length === 1 &&
        conversationIdentities[0]?.user === input.userId &&
        matchesTenantScope(conversationIdentities[0]?.tenantId, input.tenantId);
      const sidecarCandidatesPromise = ReviewOutput.find({
        ...scopeFilter(input),
        kind: input.kind,
        messageId: input.messageId,
        tableId: input.tableId,
      })
        .lean<ISteelReviewOutput[]>();

      if (input.kind === 'ocr_result') {
        const [sidecarCandidates, ocrData] = await Promise.all([
          sidecarCandidatesPromise,
          trustedGlobalConversation
            ? Promise.all([
              OcrState.findOne({ conversationId: input.conversationId })
                .lean<ISteelConversationOcrState>(),
              OcrRun.findOne({
                conversationId: input.conversationId,
                status: 'completed',
                'finalizedCandidate.targetMessageId': input.messageId,
              })
                .sort({ updatedAt: -1 })
                .lean<ISteelDelegateOcrRun>(),
            ])
            : Promise.resolve([undefined, undefined] as const),
        ]);
        const [state, historicalRun] = ocrData;
        const authority = state?.currentOcrResultGenerationId
          ? {
              outputId: `ocr_result:${state.currentOcrResultGenerationId}`,
              messageId: state.currentOcrResultMessageId,
            }
          : undefined;
        const selected = selectSidecar(sidecarCandidates, authority, input.messageId);
        const authorizedFiles = await readAuthorizedFiles(input, [
          ...(state?.sourceMappings ?? []).map((mapping) => mapping.fileId),
          ...(selected?.rows ?? []).flatMap((row) => row.source?.fileId ? [row.source.fileId] : []),
        ]);
        if (selected) {
          const { latestOutputId: _ignoredLatestOutputId, ...selectedWithoutLatest } = selected;
          return sidecarRecord({
            ...selectedWithoutLatest,
            ...(authority ? { latestOutputId: authority.outputId } : {}),
          }, message, authorizedFiles);
        }

        if (
          state?.currentOcrResultMessageId === input.messageId &&
          state.currentOcrResultMarkdown &&
          state.currentOcrResultGenerationId
        ) {
          return {
            userId: input.userId,
            ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            conversationId: input.conversationId,
            kind: input.kind,
            messageId: input.messageId,
            tableId: input.tableId,
            outputId: `ocr_result:${state.currentOcrResultGenerationId}`,
            revision: state.currentOcrResultGenerationId,
            state: 'current',
            markdown: state.currentOcrResultMarkdown,
            sourceMappings: sourceMappings(state, authorizedFiles),
            latestOutputId: `ocr_result:${state.currentOcrResultGenerationId}`,
            messageText: message.selected,
            messageTextParts: message.parts,
            messageTextPartIndex: message.selectedPartIndex,
          };
        }

        const candidate = historicalRun?.finalizedCandidate;
        const revision = candidate?.generationId ?? historicalRun?.responseGenerationId;
        if (candidate?.markdown && revision && candidate.targetMessageId === input.messageId) {
          return {
            userId: input.userId,
            ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            conversationId: input.conversationId,
            kind: input.kind,
            messageId: input.messageId,
            tableId: input.tableId,
            outputId: `ocr_result:${revision}`,
            revision,
            state: 'historical',
            markdown: candidate.markdown,
            // Historical runs do not carry a trusted source-code-to-file owner; keep rows unlocated.
            sourceMappings: [],
            ...(state?.currentOcrResultGenerationId
              ? { latestOutputId: `ocr_result:${state.currentOcrResultGenerationId}` }
              : {}),
            messageText: message.selected,
            messageTextParts: message.parts,
            messageTextPartIndex: message.selectedPartIndex,
          };
        }
        return null;
      }

      const [sidecarCandidates, quotation] = await Promise.all([
        sidecarCandidatesPromise,
        QuotationState.findOne(scopeFilter(input)).lean<ISteelQuotationState>(),
      ]);
      const authority = quotation?.currentSystemOrder?.runId
        ? {
            outputId: `system_order:${quotation.currentSystemOrder.runId}`,
            messageId: quotation.currentSystemOrder.messageId,
          }
        : undefined;
      const selected = selectSidecar(sidecarCandidates, authority, input.messageId);
      const authorizedFiles = await readAuthorizedFiles(input, [
        ...(selected?.rows ?? []).flatMap((row) => row.source?.fileId ? [row.source.fileId] : []),
      ]);
      if (selected) {
        const { latestOutputId: _ignoredLatestOutputId, ...selectedWithoutLatest } = selected;
        return sidecarRecord({
          ...selectedWithoutLatest,
          ...(authority ? { latestOutputId: authority.outputId } : {}),
        }, message, authorizedFiles);
      }

      if (
        quotation?.currentSystemOrder?.messageId === input.messageId &&
        quotation.currentSystemOrder.markdown
      ) {
        const { runId, markdown } = quotation.currentSystemOrder;
        return {
          userId: input.userId,
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          conversationId: input.conversationId,
          kind: input.kind,
          messageId: input.messageId,
          tableId: input.tableId,
          outputId: `system_order:${runId}`,
          revision: quotation.currentSystemOrder.sha256,
          state: 'current',
          markdown,
          latestOutputId: `system_order:${runId}`,
          messageText: message.selected,
          messageTextParts: message.parts,
          messageTextPartIndex: message.selectedPartIndex,
        };
      }

      const [finalArtifacts, publicationArtifacts, archiveArtifacts] = await Promise.all([
        QuotationArtifact.find({
          ...scopeFilter(input),
          kind: 'final',
          operationId: 'final',
        })
          .sort({ updatedAt: -1 })
          .lean(),
        QuotationArtifact.find({
          ...scopeFilter(input),
          kind: 'final',
          operationId: 'published',
        })
          .lean(),
        QuotationArtifact.find({
          ...scopeFilter(input),
          kind: 'archive',
          operationId: 'archive',
        })
          .lean(),
      ]);
      const historical = finalArtifacts.filter((artifact) => {
        if (createHash('sha256').update(artifact.payload).digest('hex') !== artifact.sha256) {
          return false;
        }
        const publication = publicationArtifacts.find((candidate) => candidate.runId === artifact.runId);
        const archive = archiveArtifacts.find((candidate) => candidate.runId === artifact.runId);
        return isPublishedFinalArtifact(artifact, publication) &&
          archive !== undefined && archivedRunOwnsMessage(archive, input.messageId);
      });
      if (historical.length !== 1) {
        return null;
      }
      const [artifact] = historical;
      return {
        userId: input.userId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        conversationId: input.conversationId,
        kind: input.kind,
        messageId: input.messageId,
        tableId: input.tableId,
        outputId: `system_order:${artifact.runId}`,
        revision: artifact.sha256,
        state: 'historical',
        markdown: artifact.payload,
        ...(quotation?.currentSystemOrder?.runId
          ? { latestOutputId: `system_order:${quotation.currentSystemOrder.runId}` }
          : {}),
        messageText: message.selected,
        messageTextParts: message.parts,
        messageTextPartIndex: message.selectedPartIndex,
      };
    },
  };
}

function commitDigest(input: Omit<SteelReviewCommitInput, 'digest'>): string {
  const canonical = JSON.stringify({
    userId: input.userId,
    tenantId: input.tenantId ?? null,
    conversationId: input.conversationId,
    kind: input.kind,
    messageId: input.messageId,
    tableId: input.tableId,
    partIndex: input.partIndex ?? null,
    outputId: input.outputId,
    revision: input.revision,
    rows: input.rows,
    headers: input.headers,
    messageSha256: input.messageSha256,
    target: input.target,
    targetText: input.targetText,
    replacementText: input.replacementText,
    cleanReplacementText: input.cleanReplacementText,
    effectiveMarkdown: input.effectiveMarkdown,
    displayMarkdown: input.displayMarkdown,
    aiBaselineMarkdown: input.aiBaselineMarkdown ?? null,
    aiRawMarkdown: input.aiRawMarkdown ?? null,
    caption: input.caption,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

type SteelTextPart = { contentIndex?: number; type?: string; text?: string; [key: string]: unknown };

function readTextMirror(message: Pick<IMessage, 'text' | 'content'>): {
  text: string;
  parts: SteelTextPart[];
} | null {
  if (typeof message.text !== 'string') {
    return null;
  }
  if (!Array.isArray(message.content)) {
    return { text: message.text, parts: [] };
  }
  const parts = message.content.flatMap((part, contentIndex) => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      return [];
    }
    return [{ ...(part as SteelTextPart), contentIndex }];
  });
  const rendered = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .reduce(appendRenderedText, '');
  if (rendered !== message.text) {
    return null;
  }
  return { text: message.text, parts };
}

function renderTextParts(parts: readonly SteelTextPart[]): string {
  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .reduce(appendRenderedText, '');
}

function withTextPart(
  parts: readonly SteelTextPart[],
  partIndex: number,
  start: number,
  end: number,
  target: string,
  replacement: string,
): SteelTextPart[] | null {
  const next = parts.map((part) => ({ ...part }));
  const part = next.find((candidate) => candidate.contentIndex === partIndex);
  if (!part || part.type !== 'text' || typeof part.text !== 'string') {
    return null;
  }
  if (part.text.slice(start, end) !== target) {
    return null;
  }
  part.text = `${part.text.slice(0, start)}${replacement}${part.text.slice(end)}`;
  return next;
}

function updateAtRange(text: string, start: number, end: number, expected: string, replacement: string): string | null {
  if (start < 0 || end < start || end > text.length || text.slice(start, end) !== expected) {
    return null;
  }
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function resultFromReceipt(
  receipt: SteelReviewReceipt,
  output: Pick<ISteelReviewOutput, 'outputId' | 'effectiveMarkdown' | 'displayMarkdown'>,
  messageSha256: string,
): SteelReviewCommitResult {
  return {
    operationId: receipt.operationId,
    digest: receipt.digest,
    outputId: output.outputId,
    revision: receipt.revision,
    changedRows: receipt.changedRows,
    changedRowIds: receipt.changedRowIds,
    savedAt: receipt.savedAt,
    messageSha256,
    effectiveMarkdown: output.effectiveMarkdown ?? '',
    displayMarkdown: output.displayMarkdown ?? '',
  };
}

export function createSteelReviewWriteMethods(mongoose: Mongoose): SteelReviewWriteMethods {
  const Message = createMessageModel(mongoose);
  const Conversation = createConversationModel(mongoose);
  const OcrState = createSteelConversationOcrStateModel(mongoose);
  const QuotationState = createSteelQuotationStateModel(mongoose);
  const ReviewOutput = createSteelReviewOutputModel(mongoose);

  return {
    async isManagedSteelReviewMessage(input) {
        const [output, ocrState, quotation] = await Promise.all([
        ReviewOutput.exists({
          userId: input.userId,
          ...tenantFilter(input.tenantId),
          conversationId: input.conversationId,
          messageId: input.messageId,
          state: 'current',
        }),
        OcrState.exists({
          conversationId: input.conversationId,
          currentOcrResultMessageId: input.messageId,
        }),
        (async () => {
          const QuotationState = createSteelQuotationStateModel(mongoose);
          return QuotationState.exists({
            userId: input.userId,
            ...tenantFilter(input.tenantId),
            conversationId: input.conversationId,
            'currentSystemOrder.messageId': input.messageId,
          });
        })(),
      ]);
      return output !== null || ocrState !== null || quotation !== null;
    },

    async commitSteelReview(input) {
      const computedDigest = commitDigest(input);
      if (computedDigest !== input.digest) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation digest mismatch');
      }

      const receiptOwnerFilter = {
        ...scopeFilter(input),
        kind: input.kind,
        messageId: input.messageId,
        tableId: input.tableId,
        'receipts.operationId': input.operationId,
      };
      const prior = await ReviewOutput.findOne(receiptOwnerFilter)
        .lean<ISteelReviewOutput | null>();
      if (prior) {
        const receipt = prior.receipts?.find((candidate) => candidate.operationId === input.operationId);
        if (!receipt) {
          throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review operation is unavailable');
        }
        if (receipt.digest !== input.digest) {
          throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review operation payload changed');
        }
        return resultFromReceipt(receipt, prior, input.messageSha256);
      }

      const session = await mongoose.startSession();
      try {
        let result: SteelReviewCommitResult | undefined;
        await session.withTransaction(async () => {
          const [conversation, message, ocrState, quotation] = await Promise.all([
            Conversation.findOne({
              $and: [
                { conversationId: input.conversationId, user: input.userId },
                tenantFilter(input.tenantId),
                activeExpirationFilter(),
              ],
            }).session(session).lean(),
            Message.findOne(messageFilter(input))
              .select({ messageId: 1, text: 1, content: 1 })
              .session(session)
              .lean<Pick<IMessage, 'messageId' | 'text' | 'content'> | null>(),
            input.kind === 'ocr_result'
              ? OcrState.findOne({ conversationId: input.conversationId })
                .session(session)
                .lean<ISteelConversationOcrState | null>()
              : Promise.resolve(null),
            input.kind === 'system_order'
              ? QuotationState.findOne(reviewScope(input))
                .session(session)
                .lean<ISteelQuotationState | null>()
              : Promise.resolve(null),
          ]);
          if (!conversation || !message) {
            throw new SteelReviewWriteError('REVIEW_NOT_FOUND', 'Review table not found');
          }
          if (input.kind === 'ocr_result' &&
            (ocrState?.currentOcrResultMessageId !== input.messageId ||
              ocrState?.currentOcrResultGenerationId !== input.outputId.replace(/^ocr_result:/u, ''))) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }
          if (input.kind === 'system_order' &&
            (quotation?.currentSystemOrder?.messageId !== input.messageId ||
              quotation?.currentSystemOrder?.runId !== input.outputId.replace(/^system_order:/u, ''))) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }
          if (typeof message.text !== 'string' || createHash('sha256').update(message.text).digest('hex') !== input.messageSha256) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message changed');
          }

          const mirror = readTextMirror(message);
          if (!mirror) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message mirror changed');
          }
          const selectedText = input.partIndex === undefined
            ? mirror.text
            : mirror.parts.find((part) => part.contentIndex === input.partIndex)?.text;
          if (selectedText === undefined) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message part changed');
          }
          const targetHash = createHash('sha256').update(input.targetText).digest('hex');
          if (targetHash !== input.target.sha256) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review target digest mismatch');
          }
          if (input.target.partIndex !== input.partIndex) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review target part mismatch');
          }
          const selectedNext = updateAtRange(
            selectedText,
            input.target.start,
            input.target.end,
            input.targetText,
            input.replacementText,
          );
          const selectedClean = updateAtRange(
            selectedText,
            input.target.start,
            input.target.end,
            input.targetText,
            input.cleanReplacementText,
          );
          if (selectedNext === null || selectedClean === null) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review target moved or was removed');
          }
          const nextParts = input.partIndex === undefined
            ? mirror.parts
            : withTextPart(
                mirror.parts,
                input.partIndex,
                input.target.start,
                input.target.end,
                input.targetText,
                input.cleanReplacementText,
              );
          if (input.partIndex !== undefined && !nextParts) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message part changed');
          }
          const safeNextParts = nextParts ?? [];
          const nextContent = input.partIndex === undefined || safeNextParts.length === 0
            ? message.content
            : safeNextParts.map(({ contentIndex: _contentIndex, ...part }) => part);
          const nextText = input.partIndex === undefined
            ? selectedNext
            : renderTextParts(safeNextParts);

          const outputFilter = {
            ...reviewScope(input),
            outputId: input.outputId,
          };
          const output = await ReviewOutput.findOne(outputFilter)
            .session(session)
            .lean<ISteelReviewOutput | null>();
          if (output && (output.state !== 'current' || output.revision !== input.revision)) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }
          const baselineRows = output?.rows ?? input.rows;
          if (output && (output.rows.length !== input.rows.length ||
            JSON.stringify(output.headers) !== JSON.stringify(input.headers))) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review rows changed');
          }
          if (output) {
            for (let index = 0; index < output.rows.length; index += 1) {
              const previous = output.rows[index];
              const next = input.rows[index];
              if (!next || previous.rowId !== next.rowId ||
                JSON.stringify(previous.source) !== JSON.stringify(next.source)) {
                throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review row identity changed');
              }
              for (const header of input.headers) {
                if ((previous.values[header]?.baseline ?? null) !== (next.values[header]?.baseline ?? null)) {
                  throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review AI baseline changed');
                }
              }
            }
          }
          const previousEffective = new Map(
            baselineRows.map((row) => [
              row.rowId,
              JSON.stringify(output
                ? row.values
                : Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [
                  header,
                  { ...cell, effective: cell.baseline },
                ]))),
            ]),
          );
          const changedRowIds = input.rows
            .filter((row) => previousEffective.get(row.rowId) !== JSON.stringify(row.values))
            .map((row) => row.rowId);
          if (changedRowIds.length !== input.caption.changedRows ||
            changedRowIds.some((rowId) => !input.caption.changedRowIds.includes(rowId))) {
            throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review caption does not match rows');
          }
          if (changedRowIds.length === 0) {
            result = {
              operationId: input.operationId,
              digest: input.digest,
              outputId: input.outputId,
              revision: input.revision,
              changedRows: 0,
              changedRowIds: [],
              savedAt: output?.humanSavedAt ?? new Date(0),
              messageSha256: input.messageSha256,
              effectiveMarkdown: output?.effectiveMarkdown ?? input.effectiveMarkdown,
              displayMarkdown: output?.displayMarkdown ?? input.displayMarkdown,
            };
            return;
          }

          const savedAt = new Date();
          const nextRevision = createHash('sha256')
            .update(`${input.revision}:${input.digest}`)
            .digest('hex');
          const receipt: SteelReviewReceipt = {
            operationId: input.operationId,
            digest: input.digest,
            revision: nextRevision,
            changedRows: changedRowIds.length,
            changedRowIds,
            savedAt,
          };
          const update = {
            $set: {
              userId: input.userId,
              ...(input.tenantId ? { tenantId: input.tenantId } : {}),
              conversationId: input.conversationId,
              kind: input.kind,
              messageId: input.messageId,
              tableId: input.tableId,
              outputId: input.outputId,
              revision: nextRevision,
              state: 'current' as const,
              headers: input.headers,
              rows: input.rows,
              latestOutputId: input.outputId,
              humanMarkdown: input.effectiveMarkdown,
              humanSavedAt: savedAt,
              effectiveMarkdown: input.effectiveMarkdown,
              displayMarkdown: input.displayMarkdown,
              ...(output?.aiBaselineMarkdown || input.aiBaselineMarkdown
                ? { aiBaselineMarkdown: output?.aiBaselineMarkdown ?? input.aiBaselineMarkdown }
                : {}),
              ...(output?.aiRawMarkdown || input.aiRawMarkdown
                ? { aiRawMarkdown: output?.aiRawMarkdown ?? input.aiRawMarkdown }
                : {}),
            },
            $push: { receipts: receipt },
          };
          const updated = await ReviewOutput.findOneAndUpdate(
            output
              ? { ...outputFilter, state: 'current', revision: input.revision }
              : outputFilter,
            update,
            { upsert: !output, new: true, session },
          ).lean<ISteelReviewOutput>();
          if (!updated) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output changed');
          }
          const messageUpdate = await Message.updateOne(
            {
              ...messageFilter(input),
              text: message.text,
            },
            { $set: { text: nextText, ...(nextContent ? { content: nextContent } : {}) } },
            { session },
          );
          if (messageUpdate.matchedCount !== 1) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message changed');
          }
          if (input.kind === 'ocr_result') {
            await OcrState.updateOne(
              { conversationId: input.conversationId },
              { $set: { currentOcrResultMarkdown: input.effectiveMarkdown } },
              { session },
            );
          }
          result = {
            operationId: receipt.operationId,
            digest: receipt.digest,
            outputId: updated.outputId,
            revision: updated.revision,
            changedRows: receipt.changedRows,
            changedRowIds: receipt.changedRowIds,
            savedAt: receipt.savedAt,
            messageSha256: createHash('sha256').update(nextText).digest('hex'),
            effectiveMarkdown: input.effectiveMarkdown,
            displayMarkdown: input.displayMarkdown,
          };
        });
        if (!result) {
          throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review save did not complete');
        }
        return result;
      } finally {
        await session.endSession();
      }
    },
  };
}
