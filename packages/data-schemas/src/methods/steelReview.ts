import { createHash } from 'node:crypto';
import type {
  IMessage,
  ISteelConversationOcrState,
  ISteelDelegateOcrRun,
  ISteelQuotationState,
  ISteelReviewOutput,
  SteelReviewReadInput,
  SteelReviewReadRecord,
  SteelReviewSourceMapping,
  SteelReviewTextPart,
} from '~/types';
import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';
import { createFileModel } from '~/models/file';

type Mongoose = typeof import('mongoose');

export interface SteelReviewReadMethods {
  readSteelReview(input: SteelReviewReadInput): Promise<SteelReviewReadRecord | null>;
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

function messageFilter(input: SteelReviewReadInput): Record<string, unknown> {
  return {
    messageId: input.messageId,
    conversationId: input.conversationId,
    user: input.userId,
    ...tenantFilter(input.tenantId),
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
  output: Pick<ISteelReviewOutput, 'userId' | 'tenantId' | 'conversationId' | 'kind' | 'messageId' | 'tableId' | 'outputId' | 'revision' | 'state' | 'headers' | 'rows' | 'latestOutputId'>,
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

function messageFileIds(files: unknown[] | undefined): string[] {
  return (files ?? []).flatMap((file) => {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) {
      return [];
    }
    const fileId = (file as { file_id?: unknown }).file_id;
    return typeof fileId === 'string' && fileId.length > 0 ? [fileId] : [];
  });
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
  const File = createFileModel(mongoose);

  const readAuthorizedFiles = async (
    input: SteelReviewReadInput,
    fileIds: readonly string[],
    attachedFileIds: readonly string[],
  ): Promise<Map<string, AuthorizedFile>> => {
    const uniqueFileIds = [...new Set(fileIds.filter((fileId) => fileId.length > 0))];
    // File.user is an ObjectId. Invalid legacy/test identities cannot authorize a file.
    if (uniqueFileIds.length === 0 || !mongoose.Types.ObjectId.isValid(input.userId)) {
      return new Map();
    }
    const files = await File.find({
      $and: [
        {
          file_id: { $in: uniqueFileIds },
          user: input.userId,
          $or: [
            { conversationId: input.conversationId },
            { conversationId: null, messageId: input.messageId },
            { file_id: { $in: attachedFileIds } },
          ],
        },
        tenantFilter(input.tenantId),
        activeExpirationFilter(),
      ],
    })
      .select({ file_id: 1, filename: 1 })
      .lean<Array<{ file_id: string; filename: string }>>();
    return new Map(files.map((file) => [file.file_id, {
      fileId: file.file_id,
      filename: file.filename,
    }]));
  };

  return {
    async readSteelReview(input) {
      const [messageRecord, conversationMessages, conversation, conversationIdentities] = await Promise.all([
        Message.findOne(messageFilter(input))
          .select({ messageId: 1, text: 1, content: 1, files: 1 })
          .lean<Pick<IMessage, 'messageId' | 'text' | 'content' | 'files'>>(),
        Message.find({
          $and: [
            { user: input.userId, conversationId: input.conversationId, 'files.0': { $exists: true } },
            tenantFilter(input.tenantId),
            activeExpirationFilter(),
          ],
        })
          .select({ files: 1 })
          .lean<Array<Pick<IMessage, 'files'>>>(),
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
      if (!messageRecord || !conversation) {
        return null;
      }
      const message = renderedMessageText(messageRecord, input.partIndex);
      if (!message) {
        return null;
      }
      const attachedFileIds = [
        ...messageFileIds(messageRecord.files),
        ...conversationMessages.flatMap((message) => messageFileIds(message.files)),
      ];
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
        ], attachedFileIds);
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
      ], attachedFileIds);
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
