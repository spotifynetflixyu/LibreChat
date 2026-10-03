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
  if (typeof message.text !== 'string' || !Array.isArray(message.content)) {
    return undefined;
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

function sourceMappings(state: ISteelConversationOcrState): SteelReviewSourceMapping[] {
  return (state.sourceMappings ?? []).map((mapping) => ({
    fileId: mapping.fileId,
    sourceCode: mapping.sourceCode,
    sourceFilename: mapping.sourceFilename,
  }));
}

function sidecarRecord(
  output: Pick<ISteelReviewOutput, 'userId' | 'tenantId' | 'conversationId' | 'kind' | 'messageId' | 'tableId' | 'outputId' | 'revision' | 'state' | 'headers' | 'rows' | 'latestOutputId'>,
  message?: { selected: string; parts: SteelReviewTextPart[]; selectedPartIndex?: number },
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
    rows: output.rows.map((row) => ({
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

  return {
    async readSteelReview(input) {
      const [messageRecord, conversation] = await Promise.all([
        Message.findOne(messageFilter(input))
          .select({ messageId: 1, text: 1, content: 1 })
          .lean<Pick<IMessage, 'messageId' | 'text' | 'content'>>(),
        Conversation.findOne({
          user: input.userId,
          conversationId: input.conversationId,
          ...tenantFilter(input.tenantId),
          ...activeExpirationFilter(),
        })
          .select({ conversationId: 1 })
          .lean(),
      ]);
      if (!messageRecord || !conversation) {
        return null;
      }
      const message = renderedMessageText(messageRecord, input.partIndex);
      if (!message) {
        return null;
      }

      const selected = await ReviewOutput.findOne({
        ...scopeFilter(input),
        kind: input.kind,
        messageId: input.messageId,
        tableId: input.tableId,
      })
        .sort({ updatedAt: -1 })
        .lean<ISteelReviewOutput>();
      if (selected) {
        let resolvedLatestOutputId: string | undefined;
        if (input.kind === 'ocr_result') {
          const latest = await OcrState.findOne({ conversationId: input.conversationId })
            .select({ currentOcrResultGenerationId: 1 })
            .lean<Pick<ISteelConversationOcrState, 'currentOcrResultGenerationId'>>();
          if (latest?.currentOcrResultGenerationId) {
            resolvedLatestOutputId = `ocr_result:${latest.currentOcrResultGenerationId}`;
          }
        } else {
          const latest = await QuotationState.findOne(scopeFilter(input))
            .select({ 'currentSystemOrder.runId': 1 })
            .lean<Pick<ISteelQuotationState, 'currentSystemOrder'>>();
          if (latest?.currentSystemOrder?.runId) {
            resolvedLatestOutputId = `system_order:${latest.currentSystemOrder.runId}`;
          }
        }
        const { latestOutputId: _ignoredLatestOutputId, ...selectedWithoutLatest } = selected;
        return sidecarRecord({
          ...selectedWithoutLatest,
          ...(resolvedLatestOutputId ? { latestOutputId: resolvedLatestOutputId } : {}),
        }, message);
      }

      if (input.kind === 'ocr_result') {
        const [state, historicalRun] = await Promise.all([
          OcrState.findOne({ conversationId: input.conversationId })
            .lean<ISteelConversationOcrState>(),
          OcrRun.findOne({
            conversationId: input.conversationId,
            status: { $in: ['completed', 'superseded'] },
            'finalizedCandidate.targetMessageId': input.messageId,
          })
            .sort({ updatedAt: -1 })
            .lean<ISteelDelegateOcrRun>(),
        ]);

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
            sourceMappings: sourceMappings(state),
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

      const quotation = await QuotationState.findOne(scopeFilter(input))
        .lean<ISteelQuotationState>();
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
