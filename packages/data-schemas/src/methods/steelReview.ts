import type {
  IMessage,
  ISteelConversationOcrState,
  ISteelDelegateOcrRun,
  ISteelQuotationState,
  ISteelReviewOutput,
  SteelReviewReadInput,
  SteelReviewReadRecord,
  SteelReviewSourceMapping,
} from '~/types';
import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
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

function scopeFilter(input: SteelReviewReadInput): Record<string, string> {
  return {
    userId: input.userId,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    conversationId: input.conversationId,
  };
}

function messageFilter(input: SteelReviewReadInput): Record<string, string> {
  return {
    messageId: input.messageId,
    conversationId: input.conversationId,
    user: input.userId,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
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
  messageText?: string,
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
    ...(messageText ? { messageText } : {}),
  };
}

export function createSteelReviewReadMethods(mongoose: Mongoose): SteelReviewReadMethods {
  const Message = createMessageModel(mongoose);
  const Conversation = createConversationModel(mongoose);
  const OcrState = createSteelConversationOcrStateModel(mongoose);
  const OcrRun = createSteelDelegateOcrRunModel(mongoose);
  const QuotationState = createSteelQuotationStateModel(mongoose);
  const ReviewOutput = createSteelReviewOutputModel(mongoose);

  return {
    async readSteelReview(input) {
      const [message, conversation] = await Promise.all([
        Message.findOne(messageFilter(input))
          .select({ messageId: 1, text: 1 })
          .lean<IMessage>(),
        Conversation.findOne({
          user: input.userId,
          conversationId: input.conversationId,
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          ...activeExpirationFilter(),
        })
          .select({ conversationId: 1 })
          .lean(),
      ]);
      if (!message || !conversation) {
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
        const latest = await ReviewOutput.findOne({
          ...scopeFilter(input),
          kind: input.kind,
          tableId: input.tableId,
          state: 'current',
        })
          .sort({ updatedAt: -1 })
          .select({ outputId: 1 })
          .lean<Pick<ISteelReviewOutput, 'outputId'>>();
        return sidecarRecord({
          ...selected,
          latestOutputId: selected.latestOutputId ?? latest?.outputId,
        }, message.text);
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
            ...(message.text ? { messageText: message.text } : {}),
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
            ...(message.text ? { messageText: message.text } : {}),
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
          ...(message.text ? { messageText: message.text } : {}),
        };
      }
      return null;
    },
  };
}
