import mongoose from 'mongoose';
import { parseSteelNativePreflightToolCall } from 'librechat-data-provider';
import type { Response } from 'express';
import type {
  AllMethods,
  SteelQuotationScope,
  SteelQuotationSavedMessage,
} from '@librechat/data-schemas';
import type { AIMessage, BaseMessage } from '@librechat/agents/langchain/messages';
import type { SteelQuotationPublicationMessageSnapshot } from './publication';
import type { SteelNativeHistory, SteelNativeEventEnvelope } from '../native/events';
import type { SteelRepositoryClient } from '../repositories/types';
import type { SteelResponseRequest } from './completion';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { QuotationRunnerInput } from './runner';
import type { SteelEmittedEvent } from '../native/stream';
import {
  createSteelQuotationMessageNotifier,
  createSteelQuotationSummaryAppender,
  createSteelQuotationPublicationAdmission,
} from './wiring';
import {
  ensureSteelNativeHistory,
  steelNativeStreamEventName,
  upsertSteelNativePreflightToolCall,
  buildSteelQuotationStatusEventEnvelope,
} from '../native/events';
import {
  createSteelPaddleOcrRunStepEvent,
  createSteelPaddleOcrRunStepDeltaEvent,
  createSteelPaddleOcrRunStepCompletedEvent,
} from '../native/steps';
import { getQuotationHistoryDelta, upsertQuotationToolContent } from './history';
import { createSteelMarkdownCompletionServices } from '../markdown/completion';
import { getQuotationPreflightNotice, runQuotationPreflight } from './runner';
import { createSteelQuotationPublicationPublisher } from './publication';
import { createSteelFullMarkdownPublisher } from '../markdown/full';
import { isQuotationPreparationComplete } from './signal';
import { createSteelQuotationStateService } from './state';
import { emitSteelNativeEvents } from '../native/stream';
import { quotationMessageText } from './model';

/** The message store methods the quotation workflow persists through. */
export type SteelQuotationWorkflowStore = Pick<
  AllMethods,
  | 'saveMessage'
  | 'getMessage'
  | 'admitSteelMarkdown'
  | 'publishSteelMarkdown'
  | 'saveSteelQuotationMessage'
  | 'appendSteelQuotationSummary'
>;

type SteelResponseContext = NonNullable<SteelResponseRequest['steelNativeContext']>;

/** The request fields the quotation workflow reads. */
export interface SteelQuotationWorkflowRequest extends SteelResponseRequest {
  body?: { isTemporary?: boolean };
  config?: { interfaceConfig?: Parameters<AllMethods['saveMessage']>[0]['interfaceConfig'] };
  resolvedConversation?: { expiredAt?: Date };
  _agentEventBindingRetention?: { expiredAt?: Date };
  steelNativeContext?: SteelResponseContext & {
    steelHistory?: SteelNativeHistory;
    delegateOcrContext?: SteelResponseContext['delegateOcrContext'] & {
      modelOptions?: OpenAIOAuthModelOptions;
    };
  };
}

export interface SteelQuotationWorkflowAgent {
  id?: string;
  name?: string;
}

/** The agents run whose final AI message signals the quotation hand-off. */
export interface SteelQuotationWorkflowRun {
  getRunMessages?(): BaseMessage[] | undefined;
  interrupt?: unknown;
}

export interface SteelQuotationPublicationMessageInput {
  targetMessageId: string;
  markdown: string;
  run?: unknown;
  scope?: SteelQuotationScope;
  agent?: SteelQuotationWorkflowAgent;
  context?: SteelQuotationWorkflowRequest['steelNativeContext'];
}

export interface SteelQuotationWorkflowInput {
  req: SteelQuotationWorkflowRequest;
  res?: Response;
  streamId?: string | null;
  signal: AbortSignal;
  agent?: SteelQuotationWorkflowAgent;
  run?: SteelQuotationWorkflowRun;
  onText(text: string): Promise<void>;
  onUsage?: QuotationRunnerInput['onUsage'];
  contentParts?: unknown[];
  buildPublicationMessage(
    input: SteelQuotationPublicationMessageInput,
  ): SteelQuotationPublicationMessageSnapshot | Promise<SteelQuotationPublicationMessageSnapshot>;
  onCommittedMessage?(message: SteelQuotationSavedMessage): void;
}

export interface SteelQuotationWorkflowDependencies {
  db: SteelQuotationWorkflowStore;
  client: SteelRepositoryClient;
}

/** A restored tool call keeps its saved history slot; a new one appends after the others. */
function findHistoryToolIndex(history: SteelNativeHistory, callId: string): number {
  const savedIndex = history.preflightToolCalls.findIndex((saved) => saved.id === callId);
  return savedIndex < 0 ? history.preflightToolCalls.length : savedIndex;
}

function readFinishReason(message: AIMessage): string | undefined {
  const reason = message.response_metadata?.finish_reason;
  return typeof reason === 'string' ? reason : undefined;
}

function findFinalAiMessage(run: SteelQuotationWorkflowRun | undefined): AIMessage | undefined {
  const messages = run?.getRunMessages?.() ?? [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.getType() === 'ai') {
      return message as AIMessage;
    }
  }
  return undefined;
}

/**
 * Builds the shared post-response/pre-turn quotation adapter for the chat and
 * Responses transports: admits the AI order as the quotation input, then runs
 * the quotation preflight and streams its tool cards, progress and publications.
 */
export function createSteelQuotationWorkflow({ db, client }: SteelQuotationWorkflowDependencies) {
  return async function executeSteelQuotationWorkflow({
    req,
    res,
    streamId,
    signal,
    agent,
    run,
    onText,
    onUsage,
    contentParts,
    buildPublicationMessage,
    onCommittedMessage,
  }: SteelQuotationWorkflowInput): Promise<void> {
    const context = req.steelNativeContext;
    const quotation = context?.quotation;
    if (!context || !quotation) return;
    const { scope } = quotation;
    const requestId = context.requestId;
    if (!requestId) throw new Error('Quotation workflow requires the response id');
    const generationId = String(req._resumableJobCreatedAt ?? requestId);
    const saveContext = {
      isTemporary: req.body?.isTemporary,
      interfaceConfig: req.config?.interfaceConfig,
    };
    const emit = (events: readonly SteelEmittedEvent[], historyChanged?: boolean) =>
      emitSteelNativeEvents({ req, res, streamId, events, historyChanged });
    const service = createSteelQuotationStateService(mongoose);

    if (!quotation.resume) {
      const last = findFinalAiMessage(run);
      if (!last || last.tool_calls?.length || signal.aborted || run?.interrupt) return;
      let response = quotationMessageText(last);
      const persistWorkflowResponse = async () => {
        const saved = await db.saveMessage(
          { userId: req.user?.id ?? scope.userId, ...saveContext },
          {
            messageId: requestId,
            conversationId: scope.conversationId,
            parentMessageId: quotation.messageId ?? null,
            isCreatedByUser: false,
            text: response,
            unfinished: true,
            sender: agent?.name ?? 'Agent',
            endpoint: 'agents',
            model: agent?.id,
            finish_reason: readFinishReason(last),
            metadata: {
              steel: {
                activityEvents: context.steelHistory?.activityEvents,
                preflightToolCalls: context.steelHistory?.preflightToolCalls,
              },
            },
          },
          { context: 'Quotation workflow signal durable publication' },
        );
        if (!saved) throw new Error('Quotation workflow response publication failed');
        return saved;
      };
      const completion = await createSteelMarkdownCompletionServices({
        runtimeRulesClient: client,
        quotation: service,
      }).finalize({
        req,
        responseId: requestId,
        generationId,
        publishMarkdown: createSteelFullMarkdownPublisher({
          saveContext,
          buildMessage: ({ markdown }) => ({
            messageId: requestId,
            conversationId: scope.conversationId,
            user: scope.userId,
            parentMessageId: quotation.messageId ?? null,
            isCreatedByUser: false,
            text: markdown,
            sender: agent?.name ?? 'Agent',
            endpoint: 'agents',
            model: agent?.id,
          }),
          savePublication: db.publishSteelMarkdown,
        }),
        markdown: response,
        completed: isQuotationPreparationComplete(last),
        stage: 'workflow',
        assertActive: async () => {
          if (signal.aborted || run?.interrupt)
            throw new Error('Quotation workflow was interrupted');
        },
        applyMarkdown: (markdown) => {
          response = markdown;
        },
        persistMarkdown: persistWorkflowResponse,
      });
      if (!completion.acceptedRun) return;
    }

    const modelOptions = context.delegateOcrContext?.modelOptions;
    if (!modelOptions) throw new Error('Quotation requires resolved model options');
    const quotationToolIndexes = new Map<string, number>();
    const notifyQuotationMessage = createSteelQuotationMessageNotifier({
      scope,
      responseId: requestId,
      onCommittedMessage,
      emit: (event) => emit([event]),
    });
    const publishFinal = createSteelQuotationPublicationPublisher({
      scope,
      saveContext: {
        ...saveContext,
        expiredAt:
          req._agentEventBindingRetention?.expiredAt ?? req.resolvedConversation?.expiredAt,
      },
      buildMessage: ({ targetMessageId, markdown, proof }) =>
        buildPublicationMessage({
          targetMessageId,
          markdown,
          run: proof.run,
          scope,
          agent,
          context,
        }),
      savePublication: (proof) => db.saveSteelQuotationMessage(proof),
      onPublicationCommitted: (message) => notifyQuotationMessage(message, 'order'),
    });

    const result = await runQuotationPreflight({
      scope,
      modelOptions,
      signal,
      onUsage,
      client,
      onTextDelta: onText,
      onHistory: async (restored) => {
        const history = ensureSteelNativeHistory(context);
        const delta = getQuotationHistoryDelta(history, restored);
        const events: SteelEmittedEvent[] = delta.activityEvents.map(
          (data): SteelNativeEventEnvelope => ({ event: steelNativeStreamEventName, data }),
        );
        let historyChanged = false;
        for (const call of delta.preflightToolCalls) {
          const toolIndex = contentParts
            ? upsertQuotationToolContent(contentParts, call)
            : findHistoryToolIndex(history, call.id);
          quotationToolIndexes.set(call.id, toolIndex);
          historyChanged = upsertSteelNativePreflightToolCall(history, call) || historyChanged;
          const step = {
            stepId: `${call.id}:step`,
            providerToolCallId: call.id,
            toolName: call.name,
            index: toolIndex,
          };
          events.push(
            createSteelPaddleOcrRunStepEvent({ ...step, requestId }),
            createSteelPaddleOcrRunStepDeltaEvent({ ...step, args: call.args }),
            createSteelPaddleOcrRunStepCompletedEvent({
              ...step,
              args: call.args,
              output: JSON.parse(call.output ?? 'null'),
            }),
          );
        }
        await emit(events, historyChanged);
      },
      onProgress: async ({ run: active, stage, ...progress }) => {
        await emit([
          buildSteelQuotationStatusEventEnvelope({
            conversationId: scope.conversationId,
            requestId,
            messageId: requestId,
            index: active.index,
            runId: active.runId,
            ocrSelection: active.ocrSelection,
            stage: stage ?? active.status,
            status: active.status,
            completedChunks: progress.completedChunks,
            totalChunks: progress.totalChunks,
            chunkIndex: progress.chunkIndex,
            attempt: progress.attempt,
            repairAttempt: progress.repairAttempt,
            maxRepairAttempts: progress.maxRepairAttempts,
            message: progress.message,
          }),
        ]);
      },
      onTool: async ({
        run: active,
        id,
        chunkIndex,
        attempt,
        arguments: args,
        result: toolResult,
      }) => {
        const providerToolCallId = `quotation:${active.runId}:${chunkIndex}:${attempt}:${id}`;
        const call = parseSteelNativePreflightToolCall({
          type: 'tool_call',
          id: providerToolCallId,
          name: 'search_price_candidates',
          args,
          progress: toolResult ? 1 : 0,
          ...(toolResult ? { output: JSON.stringify(toolResult) } : {}),
        });
        if (!call) return;
        const index = contentParts
          ? upsertQuotationToolContent(contentParts, call)
          : (quotationToolIndexes.get(providerToolCallId) ??
            context.steelHistory?.preflightToolCalls?.length ??
            0);
        quotationToolIndexes.set(providerToolCallId, index);
        const historyChanged = context.steelHistory
          ? upsertSteelNativePreflightToolCall(context.steelHistory, call)
          : false;
        const step = {
          stepId: `${providerToolCallId}:step`,
          providerToolCallId,
          toolName: call.name,
          index,
        };
        await emit(
          toolResult
            ? [createSteelPaddleOcrRunStepCompletedEvent({ ...step, args, output: toolResult })]
            : [
                createSteelPaddleOcrRunStepEvent({ ...step, requestId }),
                createSteelPaddleOcrRunStepDeltaEvent({ ...step, args }),
              ],
          historyChanged,
        );
      },
      publishFinal,
      appendSummary: createSteelQuotationSummaryAppender({
        append: db.appendSteelQuotationSummary,
        buildMessage: buildPublicationMessage,
      }),
      summarySourceMessageId: requestId,
      refreshPublicationAdmission: createSteelQuotationPublicationAdmission({
        req,
        scope,
        responseId: requestId,
        generationId,
        admit: db.admitSteelMarkdown,
      }),
      onSummaryCommitted: (message) => notifyQuotationMessage(message, 'summary'),
      onCompletedReplay: (targetMessageId) =>
        notifyQuotationMessage(
          () => db.getMessage({ user: scope.userId, messageId: targetMessageId }),
          'order',
        ),
    });
    const notice = getQuotationPreflightNotice(result.status);
    if (notice) {
      await onText(notice);
    }
  };
}
