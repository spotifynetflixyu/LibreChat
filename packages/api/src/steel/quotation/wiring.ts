import { logger } from '@librechat/data-schemas';
import { ContentTypes, StepTypes, steelQuotationMessagePublicationSchema, steelQuotationMessageUpdateEvent } from 'librechat-data-provider';
import type { SteelQuotationErrorPart, SteelQuotationErrorsAppendInput, SteelQuotationErrorsAppendResult, SteelQuotationSavedMessage, SteelQuotationScope, SteelQuotationSummaryInput, SteelQuotationSummaryResult } from '@librechat/data-schemas';
import type { SteelMarkdownAdmission, SteelMarkdownAdmissionInput } from '@librechat/data-schemas';
import type {
  SteelQuotationPublicationContentPart,
  SteelQuotationPublicationMessageFields,
  SteelQuotationPublicationMessageSnapshot,
} from './publication';
import type { SteelPublishedResponseIdentity } from '../markdown/types';
import type { FailedTurnMessageScope } from '../../utils/message';
import type { SteelResponseRequest } from './completion';
import { sanitizeMessageForTransmit } from '../../utils/message';
import { projectSteelQuotationMessage } from './publication';
import { GENERIC_PROVIDER_ERROR } from '../../agents/errors';
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

export function isQuotationPreparationTurn(
  context: SteelResponseRequest['steelNativeContext'],
  delegateOcrResume?: object | null,
): boolean {
  return Boolean(
    context?.quotation && !context.quotation.resume && !context.ocrTurnActive && !delegateOcrResume,
  );
}

function extractQuotationErrors(content: unknown[] | undefined): SteelQuotationErrorPart[] {
  return (Array.isArray(content) ? content : []).flatMap((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part) || Reflect.get(part, 'type') !== ContentTypes.ERROR) return [];
    const error = Reflect.get(part, 'error');
    return typeof error === 'string' && error.length > 0 ? [{ type: 'error' as const, error }] : [];
  });
}

function quotationText(part: unknown): string | undefined {
  if (!part || typeof part !== 'object' || Reflect.get(part, 'type') !== ContentTypes.TEXT) return undefined;
  const text = Reflect.get(part, 'text');
  return typeof text === 'string' ? text : undefined;
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

export function createSteelQuotationErrorAppender(input: {
  response: SteelPublishedResponseIdentity;
  scope: SteelQuotationScope;
  admission?: SteelMarkdownAdmission;
  append(errors: SteelQuotationErrorsAppendInput): Promise<SteelQuotationErrorsAppendResult>;
}) {
  return async (record: SteelPublishedResponseIdentity): Promise<SteelPublishedResponseIdentity | null> => {
    const errors = extractQuotationErrors(input.response.content);
    if (errors.length === 0) return record;
    const publication = steelQuotationMessagePublicationSchema.safeParse(record.metadata?.steelQuotation);
    if (!input.admission || !publication.success || publication.data.sourceMessageId !== input.admission.responseId) return null;
    const result = await input.append({
      scope: input.scope,
      runId: publication.data.runId,
      targetMessageId: record.messageId,
      sourceMessageId: publication.data.sourceMessageId,
      admission: input.admission,
      errors,
      summaryMarkdown: quotationText(input.response.content?.[publication.data.summaryContentIndex]),
      footerMarkdown: quotationText(input.response.content?.[publication.data.footerContentIndex]),
    });
    return result.ok ? { ...result.message, metadata: result.message.metadata ?? undefined } : null;
  };
}

export { projectTerminalMessage as projectSteelQuotationTerminalMessage } from '../../utils/message';

/** Quotation errors use the same chat UX, with the publication writer enforcing table ownership. */
export function createSteelQuotationFailurePersistence(input: {
  req: SteelResponseRequest;
  responseId?: string;
  errorText?: string;
  getMessages(filter: Record<string, string>): Promise<SteelPublishedResponseIdentity[]>;
  append(errors: SteelQuotationErrorsAppendInput): Promise<SteelQuotationErrorsAppendResult>;
}): {
  preservePublished?: () => Promise<boolean>;
  appendError?: (scope: FailedTurnMessageScope & { error: string }) => Promise<null>;
} {
  const quotation = input.req.steelNativeContext?.quotation;
  if (!quotation) return {};
  return {
    // An unpublished or invalid quotation must never bypass its guarded writer.
    appendError: async () => null,
    preservePublished: async () => {
      if (!input.responseId || !quotation.publicationAdmission) return false;
      const records = await input.getMessages({
        user: quotation.scope.userId,
        conversationId: quotation.scope.conversationId,
        'metadata.steelQuotation.sourceMessageId': input.responseId,
      });
      const record = records[0];
      if (!record) return false;
      const append = createSteelQuotationErrorAppender({
        response: {
          ...record,
          content: [{ type: ContentTypes.ERROR, error: input.errorText ?? GENERIC_PROVIDER_ERROR }],
        },
        scope: quotation.scope,
        admission: quotation.publicationAdmission,
        append: input.append,
      });
      if (!await append(record)) throw new SteelResponseCompletionError('invalid_completion_receipt');
      return true;
    },
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
