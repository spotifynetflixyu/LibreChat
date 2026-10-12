import { logger } from '@librechat/data-schemas';
import { ContentTypes, StepTypes, steelQuotationMessagePublicationSchema, steelQuotationMessageUpdateEvent } from 'librechat-data-provider';
import type { SteelQuotationSavedMessage, SteelQuotationScope, SteelQuotationSummaryInput, SteelQuotationSummaryResult } from '@librechat/data-schemas';
import type { SteelMarkdownAdmission, SteelMarkdownAdmissionInput } from '@librechat/data-schemas';
import type {
  SteelQuotationPublicationContentPart,
  SteelQuotationPublicationMessageFields,
  SteelQuotationPublicationMessageSnapshot,
} from './publication';
import type { SteelPublishedResponseIdentity } from '../markdown/types';
import type { SteelResponseRequest } from './completion';
import { sanitizeMessageForTransmit } from '../../utils/message';
import { projectSteelQuotationMessage } from './publication';
import { SteelResponseCompletionError } from './completion';
import { getSafeErrorText } from '../../utils/errors';

interface QuotationHandler {
  handle(event: string, data: object, metadata: object): Promise<void>;
}

interface QuotationTextWiring {
  onText(text: string): Promise<void>;
  onCommittedMessage(message: SteelQuotationSavedMessage): void;
  buildPublicationMessage(input: { targetMessageId: string; markdown: string }): SteelQuotationPublicationMessageSnapshot;
}

export function createSteelQuotationPublicationAdmission(input: {
  req: SteelResponseRequest;
  scope: SteelQuotationScope;
  responseId: string;
  generationId: string;
  admit(admission: SteelMarkdownAdmissionInput): Promise<SteelMarkdownAdmission | null>;
}) {
  return async (): Promise<SteelMarkdownAdmission> => {
    const quotation = input.req.steelNativeContext?.quotation;
    if (!quotation || input.req.user?.id !== input.scope.userId ||
      quotation.scope.userId !== input.scope.userId ||
      quotation.scope.conversationId !== input.scope.conversationId ||
      quotation.scope.tenantId !== input.scope.tenantId) {
      throw new SteelResponseCompletionError('invalid_response_scope');
    }
    const admission = await input.admit({
      scope: input.scope,
      responseId: input.responseId,
      generationId: input.generationId,
    });
    if (!admission) throw new SteelResponseCompletionError('invalid_completion_receipt');
    quotation.publicationAdmission = admission;
    return admission;
  };
}

export function createSteelQuotationSummaryAppender(input: {
  append(summary: SteelQuotationSummaryInput): Promise<SteelQuotationSummaryResult>;
  buildMessage(fields: { targetMessageId: string; markdown: string }):
    SteelQuotationPublicationMessageSnapshot | Promise<SteelQuotationPublicationMessageSnapshot>;
}) {
  return async (summary: SteelQuotationSummaryInput): Promise<SteelQuotationSummaryResult> => {
    const message = await input.buildMessage({ targetMessageId: summary.targetMessageId, markdown: '' });
    return input.append({
      ...summary,
      messageFields: {
        metadata: message.metadata ?? undefined,
        tokenCount: message.tokenCount,
        processingDurationMs: message.processingDurationMs,
      },
    });
  };
}

/** Terminal transport carries the canonical identity and main prose; backend partitions travel separately. */
export function projectSteelQuotationTerminalMessage(input: {
  response: SteelPublishedResponseIdentity;
  saved?: SteelPublishedResponseIdentity | null;
}): SteelPublishedResponseIdentity {
  const parsed = steelQuotationMessagePublicationSchema.safeParse(input.saved?.metadata?.steelQuotation);
  if (!input.saved || !parsed.success || !Array.isArray(input.saved.content)) return input.response;
  const publication = parsed.data;
  const content = [...input.saved.content];
  const summary = content[publication.summaryContentIndex];
  const liveSummary = input.response.content?.[publication.summaryContentIndex];
  if (summary && typeof summary === 'object' && 'text' in summary && summary.text === '' &&
    liveSummary && typeof liveSummary === 'object' && 'text' in liveSummary && typeof liveSummary.text === 'string') {
    content[publication.summaryContentIndex] = liveSummary;
  }
  content[publication.tableContentIndex] = { type: 'text', text: '' };
  content[publication.footerContentIndex] = { type: 'text', text: '' };
  const text = content.flatMap((part) => part && typeof part === 'object' &&
    'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string'
    ? [part.text] : []).filter(Boolean).join(' ');
  return {
    ...input.response,
    ...input.saved,
    text,
    content,
    unfinished: input.response.unfinished,
    finish_reason: input.response.finish_reason,
  };
}

export function createSteelQuotationMessageNotifier(input: {
  scope?: SteelQuotationScope;
  responseId: string;
  onCommittedMessage?(message: SteelQuotationSavedMessage): void;
  emit(event: { event: string; data: object }): Promise<void>;
}) {
  return async (
    source: SteelPublishedResponseIdentity | (() => Promise<SteelPublishedResponseIdentity | null | undefined>),
    update: 'order' | 'summary' = 'order',
  ): Promise<void> => {
    try {
      const message = typeof source === 'function' ? await source() : source;
      if (!message) throw new Error('Quotation committed message is unavailable');
      if (!input.scope || message.user !== input.scope.userId ||
        message.conversationId !== input.scope.conversationId ||
        message.tenantId !== input.scope.tenantId) {
        throw new Error('Quotation update scope does not match its committed message');
      }
      const publication = steelQuotationMessagePublicationSchema.parse(message.metadata?.steelQuotation);
      const slots = [publication.tableContentIndex, publication.summaryContentIndex, publication.footerContentIndex];
      if (!Array.isArray(message.content) || slots.some((index) => {
        const part = message.content?.[index];
        return !part || typeof part !== 'object' || !('type' in part) || part.type !== 'text' ||
          !('text' in part) || typeof part.text !== 'string';
      })) {
        throw new Error('Quotation committed message partitions are unavailable');
      }
      input.onCommittedMessage?.({ ...message, metadata: message.metadata ?? undefined });
      const transmitted = {
        ...sanitizeMessageForTransmit({ ...message, metadata: message.metadata ?? undefined, content: undefined }),
        content: message.content,
      };
      await input.emit({
        event: steelQuotationMessageUpdateEvent,
        data: { message: transmitted, publication, update },
      });
    } catch (error) {
      try {
        const errorCode = error && typeof error === 'object'
          ? Reflect.get(error, 'code') ?? Reflect.get(error, 'status') : null;
        logger.error(`[Steel AI] ${JSON.stringify({
          code: typeof errorCode === 'string' || typeof errorCode === 'number' ? errorCode : null,
          message: getSafeErrorText(error instanceof Error ? error.message : 'Unknown error'),
          conversationId: input.scope?.conversationId,
          responseId: input.responseId,
        })}`);
      } catch {
        return;
      }
    }
  };
}

/** Keeps the backend table out of the model's text buffer while reserving its message slots. */
export function createSteelQuotationTextWiring(input: {
  responseId: string;
  conversationId: string;
  agentId?: string;
  contentParts: SteelQuotationPublicationContentPart[];
  configurable?: object;
  stepHandler?: QuotationHandler;
  deltaHandler?: QuotationHandler;
  stepMap?: { get(stepId: string): { index: number } | undefined };
  buildMessageFields(targetMessageId: string): SteelQuotationPublicationMessageFields;
}): QuotationTextWiring {
  let summaryIndex: number | undefined;
  let messageId = input.responseId;
  let seeded = false;
  const stepId = `quotation:${input.responseId}`;
  const metadata = {
    ...input.configurable,
    run_id: input.responseId,
    thread_id: input.conversationId,
    last_agent_id: input.agentId,
    langgraph_node: input.agentId,
  };

  const onText = async (text: string): Promise<void> => {
    if (summaryIndex === undefined) summaryIndex = input.contentParts.length;
    if (!seeded) {
      seeded = true;
      await input.stepHandler?.handle('on_run_step', {
        id: stepId,
        runId: messageId,
        index: summaryIndex,
        stepDetails: {
          type: StepTypes.MESSAGE_CREATION,
          message_creation: { message_id: messageId },
        },
      }, metadata);
      const step = input.stepMap?.get(stepId);
      if (step) step.index = summaryIndex;
    }
    if (input.deltaHandler) {
      await input.deltaHandler.handle('on_message_delta', {
        id: stepId,
        delta: { content: [{ type: ContentTypes.TEXT, text }] },
      }, metadata);
      return;
    }
    const existing = input.contentParts[summaryIndex];
    input.contentParts[summaryIndex] = {
      type: ContentTypes.TEXT,
      text: (existing?.type === ContentTypes.TEXT ? existing.text ?? '' : '') + text,
    };
  };

  return {
    onText,
    onCommittedMessage: (message: SteelQuotationSavedMessage): void => {
      const publication = steelQuotationMessagePublicationSchema.parse(message.metadata?.steelQuotation);
      messageId = message.messageId;
      metadata.run_id = messageId;
      summaryIndex = publication.summaryContentIndex;
      for (const index of [publication.tableContentIndex, summaryIndex, publication.footerContentIndex]) {
        input.contentParts[index] ??= { type: ContentTypes.TEXT, text: '' };
      }
    },
    buildPublicationMessage: ({ targetMessageId, markdown }: {
      targetMessageId: string;
      markdown: string;
    }) => projectSteelQuotationMessage({
      message: {
        ...input.buildMessageFields(targetMessageId),
        messageId: targetMessageId,
        sourceMessageId: input.responseId,
        text: markdown,
        content: input.contentParts,
      },
      markdown,
    }),
  };
}
