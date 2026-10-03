import { createHash, randomUUID } from 'node:crypto';
import {
  encodeSteelReviewDigest,
  isSteelReviewSourceAssociationHeader,
  normalizeSteelReviewRows,
  sameSteelReviewSource,
} from 'librechat-data-provider';
import type {
  SteelReviewCell,
  SteelReviewCaption,
  SteelReviewRow,
  SteelReviewTarget,
} from 'librechat-data-provider';
import type {
  IMessage,
  ISteelConversationOcrState,
  ISteelDelegateOcrRun,
  ISteelQuotationState,
  ISteelReviewOutput,
  SteelReviewReadInput,
  SteelReviewReadRecord,
  SteelReviewReceipt,
  SteelReviewReceiptLookup,
  SteelReviewSavedSnapshotRecord,
  SteelReviewScope,
  SteelReviewSourceMapping,
  SteelReviewTextPart,
  SteelReviewOwnerUpdatedRecord,
  SteelReviewRequoteProvenanceRecord,
} from '~/types';
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

export type SteelReviewMessageMutationCheckResult =
  | { ok: true; value: { managed: boolean } }
  | { ok: false; error: { code: 'REVIEW_NOT_FOUND' } };

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
  snapshot?: SteelReviewSavedSnapshotRecord;
}

export interface SteelReviewWriteMethods {
  commitSteelReview(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult>;
  resolveSteelReviewReceipt(input: SteelReviewCommitInput): Promise<SteelReviewCommitResult | null>;
  readSteelReviewReceipt(input: SteelReviewReceiptLookup): Promise<SteelReviewCommitResult | null>;
  checkSteelReviewMessageMutation(
    input: SteelReviewScope & { messageId: string },
  ): Promise<SteelReviewMessageMutationCheckResult>;
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

function hasCellProperty(cell: SteelReviewCell | undefined, property: keyof SteelReviewCell): boolean {
  return cell !== undefined && Object.prototype.hasOwnProperty.call(cell, property);
}

function sameCellProperty(
  left: SteelReviewCell | undefined,
  leftProperty: keyof SteelReviewCell,
  right: SteelReviewCell | undefined,
  rightProperty: keyof SteelReviewCell,
): boolean {
  const leftHasProperty = hasCellProperty(left, leftProperty);
  const rightHasProperty = hasCellProperty(right, rightProperty);
  return leftHasProperty === rightHasProperty &&
    (!leftHasProperty || left?.[leftProperty] === right?.[rightProperty]);
}

function rowsAreNormalized(rows: readonly SteelReviewRow[]): boolean {
  return JSON.stringify(normalizeSteelReviewRows(rows)) === JSON.stringify(rows);
}

function sameSourceAssociationCellAsBaseline(cell: SteelReviewCell | undefined): boolean {
  return sameCellProperty(cell, 'effective', cell, 'baseline');
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

function messageFilter(
  input: Pick<SteelReviewReadInput, 'messageId' | 'conversationId' | 'userId' | 'tenantId'>,
): Record<string, unknown> {
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

function readOwnerUpdated(
  metadata: IMessage['metadata'],
  kind: SteelReviewReadInput['kind'],
): SteelReviewOwnerUpdatedRecord | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const value = metadata.steelReview;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const scoped = (value as Record<string, unknown>)[kind];
  const candidate = (scoped && typeof scoped === 'object' && !Array.isArray(scoped)
    ? scoped
    : value) as Partial<SteelReviewOwnerUpdatedRecord>;
  if (candidate.version !== 1 ||
    (candidate.kind !== 'ocr_result' && candidate.kind !== 'system_order') ||
    typeof candidate.conversationId !== 'string' || typeof candidate.messageId !== 'string' ||
    typeof candidate.tableId !== 'string' || typeof candidate.outputId !== 'string' ||
    typeof candidate.revision !== 'string' || !(candidate.updatedAt instanceof Date)) {
    return undefined;
  }
  return candidate as SteelReviewOwnerUpdatedRecord;
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
  output: Pick<ISteelReviewOutput, 'userId' | 'tenantId' | 'conversationId' | 'kind' | 'messageId' | 'tableId' | 'outputId' | 'revision' | 'state' | 'headers' | 'rows' | 'latestOutputId' | 'aiUpdatedAt' | 'aiRawMarkdown' | 'aiBaselineMarkdown' | 'humanMarkdown' | 'humanSavedAt' | 'effectiveMarkdown' | 'displayMarkdown' | 'receipts'>,
  message?: { selected: string; parts: SteelReviewTextPart[]; selectedPartIndex?: number; ownerUpdated?: SteelReviewOwnerUpdatedRecord },
  authorizedFiles: ReadonlyMap<string, AuthorizedFile> = new Map(),
  aiUpdatedAt?: Date,
  requote?: { needsRequote?: boolean; requoteProvenance?: SteelReviewRequoteProvenanceRecord },
): SteelReviewReadRecord {
  const lastSave = output.receipts?.[output.receipts.length - 1];
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
    ...(output.aiUpdatedAt ? { aiUpdatedAt: output.aiUpdatedAt } : {}),
    ...(output.aiRawMarkdown ? { aiRawMarkdown: output.aiRawMarkdown } : {}),
    ...(output.aiBaselineMarkdown ? { aiBaselineMarkdown: output.aiBaselineMarkdown } : {}),
    ...(output.humanMarkdown ? { humanMarkdown: output.humanMarkdown } : {}),
    ...(output.humanSavedAt ? { humanSavedAt: output.humanSavedAt } : {}),
    ...(output.effectiveMarkdown ? { effectiveMarkdown: output.effectiveMarkdown } : {}),
    ...(output.displayMarkdown ? { displayMarkdown: output.displayMarkdown } : {}),
    ...(aiUpdatedAt ? { aiUpdatedAt } : {}),
    ...(requote?.needsRequote !== undefined ? { needsRequote: requote.needsRequote } : {}),
    ...(requote?.requoteProvenance ? { requoteProvenance: requote.requoteProvenance } : {}),
    ...(message?.ownerUpdated ? { ownerUpdated: message.ownerUpdated } : {}),
    ...(lastSave
      ? {
          lastSave: {
            ...lastSave,
            ...(lastSave.snapshot ? { snapshot: normalizeSnapshot(lastSave.snapshot) } : {}),
          },
        }
      : {}),
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
          .select({ messageId: 1, text: 1, content: 1, files: 1, metadata: 1 })
          .lean<Pick<IMessage, 'messageId' | 'text' | 'content' | 'files' | 'metadata'>[]>(),
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
          const aiUpdatedAt = selected.aiUpdatedAt ??
            (state?.currentOcrResultGenerationId === selected.outputId.replace(/^ocr_result:/u, '')
              ? state.currentOcrResultProvenance?.updatedAt ?? state.updatedAt
              : undefined);
          return sidecarRecord({
            ...selectedWithoutLatest,
            ...(authority ? { latestOutputId: authority.outputId } : {}),
          }, {
            ...message,
            ...(readOwnerUpdated(messageRecord.metadata, input.kind)
              ? { ownerUpdated: readOwnerUpdated(messageRecord.metadata, input.kind) }
              : {}),
          }, authorizedFiles, aiUpdatedAt);
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
            ...(state.currentOcrResultProvenance?.generationId === state.currentOcrResultGenerationId &&
              (state.currentOcrResultProvenance.updatedAt ?? state.updatedAt)
              ? { aiUpdatedAt: state.currentOcrResultProvenance.updatedAt ?? state.updatedAt }
              : {}),
            ...(readOwnerUpdated(messageRecord.metadata, input.kind)
              ? { ownerUpdated: readOwnerUpdated(messageRecord.metadata, input.kind) }
              : {}),
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
        }, {
          ...message,
          ...(readOwnerUpdated(messageRecord.metadata, input.kind)
            ? { ownerUpdated: readOwnerUpdated(messageRecord.metadata, input.kind) }
            : {}),
        }, authorizedFiles, undefined, {
          needsRequote: quotation?.currentSystemOrder?.needsRequote,
          requoteProvenance: quotation?.currentSystemOrder?.requoteProvenance,
        });
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
          ...(quotation.currentSystemOrder.needsRequote !== undefined
            ? { needsRequote: quotation.currentSystemOrder.needsRequote }
            : {}),
          ...(quotation.currentSystemOrder.requoteProvenance
            ? { requoteProvenance: quotation.currentSystemOrder.requoteProvenance }
            : {}),
          ...(readOwnerUpdated(messageRecord.metadata, input.kind)
            ? { ownerUpdated: readOwnerUpdated(messageRecord.metadata, input.kind) }
            : {}),
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
  return createHash('sha256').update(encodeSteelReviewDigest(input)).digest('hex');
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

function normalizeSnapshot(snapshot: SteelReviewSavedSnapshotRecord): SteelReviewSavedSnapshotRecord {
  const { messageTextParts, ...snapshotWithoutParts } = snapshot;
  return {
    ...snapshotWithoutParts,
    ...(messageTextParts && messageTextParts.length > 0 ? { messageTextParts } : {}),
  };
}

function resultFromReceipt(
  receipt: SteelReviewReceipt,
): SteelReviewCommitResult {
  if (!receipt.snapshot) {
    throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review receipt snapshot is unavailable');
  }
  const snapshot = normalizeSnapshot(receipt.snapshot);
  return {
    operationId: receipt.operationId,
    digest: receipt.digest,
    outputId: snapshot.outputId,
    revision: snapshot.revision,
    changedRows: snapshot.changedRows,
    changedRowIds: snapshot.changedRowIds,
    savedAt: snapshot.savedAt,
    messageSha256: snapshot.messageSha256,
    effectiveMarkdown: snapshot.effectiveMarkdown,
    displayMarkdown: snapshot.displayMarkdown,
    snapshot,
  };
}

function markdownSha256(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

function quotationIsLinkedToOcr(
  quotation: ISteelQuotationState | null,
  input: SteelReviewCommitInput,
  output?: Pick<ISteelReviewOutput, 'humanMarkdown' | 'effectiveMarkdown'>,
): boolean {
  const current = quotation?.currentSystemOrder;
  if (!current) {
    return false;
  }
  const generationId = input.outputId.replace(/^ocr_result:/u, '');
  const sourceHashes = new Set(
    [input.aiRawMarkdown, input.aiBaselineMarkdown, output?.humanMarkdown, output?.effectiveMarkdown]
      .filter((value): value is string => value !== undefined)
      .map(markdownSha256),
  );
  const ticket = quotation?.tickets?.find((candidate) => candidate.acceptedRunId === current.runId);
  const receipt = ticket?.completionReceipt;
  const receiptLinked = receipt !== undefined &&
    (receipt.ocrGeneration === generationId ||
      (receipt.ocrHash !== undefined && sourceHashes.has(receipt.ocrHash)));
  return receiptLinked;
}

function matchesReviewOutputOwner(
  output: Pick<ISteelReviewOutput, 'userId' | 'tenantId' | 'conversationId' | 'kind' | 'messageId' | 'tableId' | 'outputId'>,
  input: SteelReviewCommitInput,
): boolean {
  return output.userId === input.userId &&
    matchesTenantScope(output.tenantId, input.tenantId) &&
    output.conversationId === input.conversationId &&
    output.kind === input.kind &&
    output.messageId === input.messageId &&
    output.tableId === input.tableId &&
    output.outputId === input.outputId;
}

export function createSteelReviewWriteMethods(mongoose: Mongoose): SteelReviewWriteMethods {
  const Message = createMessageModel(mongoose);
  const Conversation = createConversationModel(mongoose);
  const OcrState = createSteelConversationOcrStateModel(mongoose);
  const OcrRun = createSteelDelegateOcrRunModel(mongoose);
  const QuotationState = createSteelQuotationStateModel(mongoose);
  const ReviewOutput = createSteelReviewOutputModel(mongoose);

  const unavailableMessageMutation = (): SteelReviewMessageMutationCheckResult => ({
    ok: false,
    error: { code: 'REVIEW_NOT_FOUND' },
  });

  const assertReceiptScope = async (input: SteelReviewReceiptLookup): Promise<void> => {
    const [conversations, messages] = await Promise.all([
      Conversation.find({
        $and: [
          { conversationId: input.conversationId, user: input.userId },
          tenantFilter(input.tenantId),
          activeExpirationFilter(),
        ],
      }).limit(2).select({ conversationId: 1 }).lean(),
      Message.find(messageFilter(input))
        .limit(2)
        .select({ messageId: 1 })
        .lean(),
    ]);
    if (conversations.length > 1 || messages.length > 1) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review receipt authority is ambiguous');
    }
    if (conversations.length !== 1 || messages.length !== 1) {
      throw new SteelReviewWriteError('REVIEW_NOT_FOUND', 'Review receipt scope is unavailable');
    }
  };

  const findReceipt = async (
    input: SteelReviewReceiptLookup,
  ): Promise<SteelReviewCommitResult | null> => {
    await assertReceiptScope(input);
    const priors = await ReviewOutput.find({
      ...scopeFilter(input),
      kind: input.kind,
      messageId: input.messageId,
      tableId: input.tableId,
      outputId: input.outputId,
      'receipts.operationId': input.operationId,
    }).limit(2).lean<ISteelReviewOutput[]>();
    if (priors.length > 1) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review receipt authority is ambiguous');
    }
    const prior = priors[0];
    if (!prior) {
      return null;
    }
    const receipt = prior.receipts?.find((candidate) => candidate.operationId === input.operationId);
    if (!receipt) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review operation is unavailable');
    }
    if (receipt.digest !== input.digest) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review operation payload changed');
    }
    return resultFromReceipt(receipt);
  };

  const resolveReceipt = async (input: SteelReviewCommitInput): Promise<SteelReviewCommitResult | null> => {
    if (input.kind !== 'ocr_result') {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'This review save is available for OCR results only');
    }
    const computedDigest = commitDigest(input);
    if (computedDigest !== input.digest) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review operation digest mismatch');
    }
    return findReceipt(input);
  };

  return {
    async checkSteelReviewMessageMutation(input) {
      const [conversations, messages, conversationIdentities] = await Promise.all([
        Conversation.find({
          $and: [
            { conversationId: input.conversationId, user: input.userId },
            tenantFilter(input.tenantId),
            activeExpirationFilter(),
          ],
        })
          .limit(2)
          .select({ conversationId: 1 })
          .lean(),
        Message.find(messageFilter(input))
          .limit(2)
          .select({ messageId: 1 })
          .lean(),
        Conversation.find({ conversationId: input.conversationId })
          .limit(2)
          .select({ user: 1, tenantId: 1 })
          .lean<Array<{ user?: string; tenantId?: string | null }>>(),
      ]);
      if (conversations.length !== 1 || messages.length !== 1 || conversationIdentities.length !== 1) {
        return unavailableMessageMutation();
      }
      if (!matchesTenantScope(conversationIdentities[0]?.tenantId, input.tenantId) ||
        conversationIdentities[0]?.user !== input.userId) {
        return unavailableMessageMutation();
      }

      const [outputs, ocrStates, quotations, historicalRuns] = await Promise.all([
        ReviewOutput.find({
          ...reviewScope(input),
          messageId: input.messageId,
        })
          .limit(2)
          .select({ _id: 1 })
          .lean(),
        OcrState.find({
          conversationId: input.conversationId,
          currentOcrResultMessageId: input.messageId,
        })
          .limit(2)
          .select({ _id: 1 })
          .lean(),
        QuotationState.find({
          ...reviewScope(input),
          'currentSystemOrder.messageId': input.messageId,
        })
          .limit(2)
          .select({ _id: 1 })
          .lean(),
        OcrRun.find({
          conversationId: input.conversationId,
          status: 'completed',
          'finalizedCandidate.targetMessageId': input.messageId,
        })
          .limit(2)
          .select({ finalizedCandidate: 1, responseGenerationId: 1 })
          .lean<Pick<ISteelDelegateOcrRun, 'finalizedCandidate' | 'responseGenerationId'>[]>(),
      ]);
      const historicalOcr = historicalRuns.some((run) => {
        const candidate = run.finalizedCandidate;
        const revision = candidate?.generationId ?? run.responseGenerationId;
        return Boolean(candidate?.markdown && revision);
      });
      if (outputs.length > 1 || ocrStates.length > 1 || quotations.length > 1 || historicalRuns.length > 1) {
        return unavailableMessageMutation();
      }
      return {
        ok: true,
        value: {
          managed: outputs.length > 0 || ocrStates.length > 0 || quotations.length > 0 || historicalOcr,
        },
      };
    },

    async commitSteelReview(input) {
      if (input.kind !== 'ocr_result') {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'This review save is available for OCR results only');
      }
      const resolved = await resolveReceipt(input);
      if (resolved) {
        return resolved;
      }

      const session = await mongoose.startSession();
      try {
        let result: SteelReviewCommitResult | undefined;
        await session.withTransaction(async () => {
          const [conversations, messages, ocrStates, quotations] = await Promise.all([
            Conversation.find({
              $and: [
                { conversationId: input.conversationId, user: input.userId },
                tenantFilter(input.tenantId),
                activeExpirationFilter(),
              ],
            }).limit(2).session(session).lean(),
            Message.find(messageFilter(input))
              .select({ messageId: 1, text: 1, content: 1, metadata: 1 })
              .limit(2)
              .session(session)
              .lean<Array<Pick<IMessage, 'messageId' | 'text' | 'content' | 'metadata'>>>(),
            input.kind === 'ocr_result'
              ? OcrState.find({ conversationId: input.conversationId })
                .limit(2)
                .session(session)
                .lean<ISteelConversationOcrState[]>()
              : Promise.resolve([] as ISteelConversationOcrState[]),
            QuotationState.find(reviewScope(input))
              .limit(2)
              .session(session)
              .lean<ISteelQuotationState[]>(),
          ]);
          if (conversations.length > 1 || messages.length > 1 || ocrStates.length > 1 || quotations.length > 1) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review authority is ambiguous');
          }
          const conversation = conversations[0];
          const message = messages[0];
          const ocrState = ocrStates[0];
          const quotation = quotations[0];
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
            kind: input.kind,
            messageId: input.messageId,
            tableId: input.tableId,
            outputId: input.outputId,
          };
          const outputs = await ReviewOutput.find(outputFilter)
            .limit(2)
            .session(session)
            .lean<ISteelReviewOutput[]>();
          if (outputs.length > 1) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output authority is ambiguous');
          }
          const output = outputs[0];
          if (output && !matchesReviewOutputOwner(output, input)) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output owner changed');
          }
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
              if (!next || previous.rowId !== next.rowId || !sameSteelReviewSource(previous.source, next.source)) {
                throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review row identity changed');
              }
              for (const header of input.headers) {
                if ((previous.values[header]?.baseline ?? null) !== (next.values[header]?.baseline ?? null)) {
                  throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review AI baseline changed');
                }
                if (isSteelReviewSourceAssociationHeader(header) &&
                  !sameCellProperty(previous.values[header], 'effective', next.values[header], 'effective')) {
                  throw new SteelReviewWriteError(
                    'REVIEW_INVALID_OPERATION',
                    'Review source association cell is read-only',
                  );
                }
              }
            }
          } else if (input.headers.some((header) => isSteelReviewSourceAssociationHeader(header) &&
            input.rows.some((row) => !sameSourceAssociationCellAsBaseline(row.values[header])))) {
            throw new SteelReviewWriteError(
              'REVIEW_INVALID_OPERATION',
              'Review source association cell is read-only',
            );
          }
          if (!rowsAreNormalized(input.rows)) {
            throw new SteelReviewWriteError(
              'REVIEW_INVALID_OPERATION',
              'Review effective cell representation is not canonical',
            );
          }
          const canonicalRows = normalizeSteelReviewRows(input.rows);
          const canonicalBaselineRows = normalizeSteelReviewRows(baselineRows);
          const previousEffective = new Map(
            canonicalBaselineRows.map((row) => [
              row.rowId,
              JSON.stringify(output
                ? row.values
                : Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [
                  header,
                  { ...cell, effective: cell.baseline },
                ]))),
            ]),
          );
          const changedRowIds = canonicalRows
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

          if (!ocrState?._id) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }
          const reviewLockToken = randomUUID();
          const fenced = await OcrState.updateOne(
            {
              _id: ocrState._id,
              conversationId: input.conversationId,
              currentOcrResultMessageId: input.messageId,
              currentOcrResultGenerationId: input.outputId.replace(/^ocr_result:/u, ''),
            },
            { $set: { reviewLockToken } },
            { session, timestamps: false },
          );
          if (fenced.matchedCount !== 1 || fenced.modifiedCount !== 1) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review output is no longer current');
          }

          const savedAt = new Date();
          const nextRevision = createHash('sha256')
            .update(`${input.revision}:${input.digest}`)
            .digest('hex');
          const nextMessageSha256 = createHash('sha256').update(nextText).digest('hex');
          const ownerUpdated: SteelReviewOwnerUpdatedRecord = {
            version: 1,
            kind: input.kind,
            conversationId: input.conversationId,
            messageId: input.messageId,
            tableId: input.tableId,
            outputId: input.outputId,
            revision: nextRevision,
            updatedAt: savedAt,
          };
          const messageTextParts = safeNextParts.flatMap((part) =>
            part.contentIndex !== undefined && part.type === 'text' && typeof part.text === 'string'
              ? [{ partIndex: part.contentIndex, text: part.text }]
              : [],
          );
          const receipt: SteelReviewReceipt = {
            operationId: input.operationId,
            digest: input.digest,
            revision: nextRevision,
            changedRows: changedRowIds.length,
            changedRowIds,
            savedAt,
            snapshot: {
              operationId: input.operationId,
              digest: input.digest,
              outputId: input.outputId,
              revision: nextRevision,
              headers: input.headers,
              rows: canonicalRows,
              changedRows: changedRowIds.length,
              changedRowIds,
              savedAt,
              messageSha256: nextMessageSha256,
              conversationId: input.conversationId,
              messageId: input.messageId,
              messageText: nextText,
              ...(messageTextParts.length > 0 ? { messageTextParts } : {}),
              effectiveMarkdown: input.effectiveMarkdown,
              displayMarkdown: input.displayMarkdown,
              ownerUpdated,
            },
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
              rows: canonicalRows,
              latestOutputId: input.outputId,
              humanMarkdown: input.effectiveMarkdown,
              humanSavedAt: savedAt,
              effectiveMarkdown: input.effectiveMarkdown,
              displayMarkdown: input.displayMarkdown,
              ...(output?.aiUpdatedAt ||
              (ocrState?.currentOcrResultGenerationId === input.outputId.replace(/^ocr_result:/u, '') &&
                (ocrState.currentOcrResultProvenance?.updatedAt ?? ocrState.updatedAt))
                ? {
                    aiUpdatedAt: output?.aiUpdatedAt ??
                      ocrState?.currentOcrResultProvenance?.updatedAt ?? ocrState?.updatedAt,
                  }
                : {}),
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
              ? { ...outputFilter, _id: output._id, state: 'current', revision: input.revision }
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
            {
              $set: {
                text: nextText,
                ...(nextContent ? { content: nextContent } : {}),
                [`metadata.steelReview.${input.kind}`]: ownerUpdated,
              },
            },
            { session },
          );
          if (messageUpdate.matchedCount !== 1) {
            throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review message changed');
          }
          if (input.kind === 'ocr_result' && changedRowIds.length > 0 && quotationIsLinkedToOcr(quotation, input, output)) {
            const requoteProvenance = {
              sourceKind: 'ocr_result' as const,
              sourceMessageId: input.messageId,
              sourceTableId: input.tableId,
              sourceOutputId: input.outputId,
              sourceRevision: nextRevision,
              changedRows: changedRowIds.length,
              at: savedAt,
            };
            const quotationUpdate = await QuotationState.updateOne(
              {
                ...reviewScope(input),
                'currentSystemOrder.runId': quotation?.currentSystemOrder?.runId,
              },
              {
                $set: {
                  'currentSystemOrder.needsRequote': true,
                  'currentSystemOrder.requoteProvenance': requoteProvenance,
                },
              },
              { session },
            );
            if (quotationUpdate.matchedCount !== 1) {
              throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Quotation state changed');
            }
          }
          result = {
            operationId: receipt.operationId,
            digest: receipt.digest,
            outputId: updated.outputId,
            revision: updated.revision,
            changedRows: receipt.changedRows,
            changedRowIds: receipt.changedRowIds,
            savedAt: receipt.savedAt,
            messageSha256: nextMessageSha256,
            effectiveMarkdown: input.effectiveMarkdown,
            displayMarkdown: input.displayMarkdown,
            snapshot: receipt.snapshot,
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

    resolveSteelReviewReceipt: resolveReceipt,
    readSteelReviewReceipt: findReceipt,
  };
}
