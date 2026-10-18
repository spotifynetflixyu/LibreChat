const steelPostgres = require('./postgres');
const mongoose = require('mongoose');
const {
  upsertSteelNativePreflightToolCall,
  ensureSteelNativeHistory,
  getQuotationHistoryDelta,
  upsertQuotationToolContent,
  steelNativeStreamEventName,
  runQuotationPreflight,
  getQuotationPreflightNotice,
  createSteelQuotationPublicationPublisher,
  createSteelQuotationMessageNotifier,
  createSteelQuotationSummaryAppender,
  createSteelQuotationPublicationAdmission,
  createSteelFullMarkdownPublisher,
  quotationMessageText,
  isQuotationPreparationComplete,
  buildSteelQuotationStatusEventEnvelope,
  createSteelMarkdownCompletionServices,
  createSteelQuotationStateService,
  emitSteelNativeEvents,
} = require('@librechat/api');
const db = require('~/models');
const {
  createSteelPaddleOcrRunStepEvent,
  createSteelPaddleOcrRunStepDeltaEvent,
  createSteelPaddleOcrRunStepCompletedEvent,
} = require('./ocr');

/** Shared post-response/pre-turn quotation adapter for chat and Responses transports. */
async function executeSteelQuotationWorkflow({
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
}) {
  const context = req?.steelNativeContext;
  const quotation = context?.quotation;
  if (!quotation) return;
  const { scope } = quotation;
  const publicationSaveContext = {
    isTemporary: req.body?.isTemporary,
    expiredAt: req._agentEventBindingRetention?.expiredAt ?? req.resolvedConversation?.expiredAt,
    interfaceConfig: req.config?.interfaceConfig,
  };
  const service = createSteelQuotationStateService(mongoose);
  if (!quotation.resume) {
    const messages = run?.getRunMessages?.() ?? [];
    const last = [...messages]
      .reverse()
      .find((message) => message.getType?.() === 'ai' || message._getType?.() === 'ai');
    if (!last || last.tool_calls?.length || signal.aborted || run?.interrupt) return;
    let response = quotationMessageText(last);
    const persistWorkflowResponse = async () => {
      const saved = await db.saveMessage(
        {
          userId: req.user?.id,
          isTemporary: req.body?.isTemporary,
          interfaceConfig: req.config?.interfaceConfig,
        },
        {
          messageId: context.requestId,
          conversationId: scope.conversationId,
          parentMessageId: quotation.messageId ?? null,
          isCreatedByUser: false,
          text: response,
          unfinished: true,
          sender: agent?.name ?? 'Agent',
          endpoint: 'agents',
          model: agent?.id,
          finish_reason: last.response_metadata?.finish_reason,
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
      runtimeRulesClient: steelPostgres.client,
      quotation: service,
    }).finalize({
      req,
      responseId: context.requestId,
      generationId: String(req._resumableJobCreatedAt ?? context.requestId),
      publishMarkdown: createSteelFullMarkdownPublisher({
        saveContext: {
          isTemporary: req.body?.isTemporary,
          interfaceConfig: req.config?.interfaceConfig,
        },
        buildMessage: ({ markdown }) => ({
          messageId: context.requestId,
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
        if (signal.aborted || run?.interrupt) throw new Error('Quotation workflow was interrupted');
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
  const quotationToolIndexes = new Map();
  const notifyQuotationMessage = createSteelQuotationMessageNotifier({
    scope,
    responseId: context.requestId,
    onCommittedMessage,
    emit: (event) => emitSteelNativeEvents({ req, res, streamId, events: [event] }),
  });
  const publishFinal = createSteelQuotationPublicationPublisher({
    scope,
    saveContext: publicationSaveContext,
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
  const runPreflight = () =>
    runQuotationPreflight({
      scope,
      modelOptions,
      signal,
      onUsage,
      client: steelPostgres.client,
      onTextDelta: onText,
      onHistory: async (restored) => {
        const history = ensureSteelNativeHistory(context);
        const delta = getQuotationHistoryDelta(history, restored);
        const events = delta.activityEvents.map((data) => ({
          event: steelNativeStreamEventName,
          data,
        }));
        let historyChanged = false;
        for (const call of delta.preflightToolCalls) {
          const index = history.preflightToolCalls.findIndex((saved) => saved.id === call.id);
          let toolIndex;
          if (contentParts) {
            toolIndex = upsertQuotationToolContent(contentParts, call);
          } else {
            toolIndex = index < 0 ? history.preflightToolCalls.length : index;
          }
          quotationToolIndexes.set(call.id, toolIndex);
          historyChanged = upsertSteelNativePreflightToolCall(history, call) || historyChanged;
          const stepId = `${call.id}:step`;
          events.push(
            createSteelPaddleOcrRunStepEvent({
              requestId: context.requestId,
              stepId,
              providerToolCallId: call.id,
              toolName: call.name,
              index: toolIndex,
            }),
            createSteelPaddleOcrRunStepDeltaEvent({
              stepId,
              providerToolCallId: call.id,
              toolName: call.name,
              args: call.args,
              index: toolIndex,
            }),
            createSteelPaddleOcrRunStepCompletedEvent({
              stepId,
              providerToolCallId: call.id,
              toolName: call.name,
              args: call.args,
              output: JSON.parse(call.output),
              index: toolIndex,
            }),
          );
        }
        await emitSteelNativeEvents({ req, res, streamId, events, historyChanged });
      },
      onProgress: async ({
        run: active,
        completedChunks,
        totalChunks,
        chunkIndex,
        attempt,
        stage,
        repairAttempt,
        maxRepairAttempts,
        message,
      }) => {
        await emitSteelNativeEvents({
          req,
          res,
          streamId,
          events: [
            buildSteelQuotationStatusEventEnvelope({
              conversationId: scope.conversationId,
              requestId: context.requestId,
              messageId: context.requestId,
              index: active.index,
              runId: active.runId,
              ocrSelection: active.ocrSelection,
              stage: stage ?? active.status,
              status: active.status,
              completedChunks,
              totalChunks,
              chunkIndex,
              attempt,
              repairAttempt,
              maxRepairAttempts,
              message,
            }),
          ],
        });
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
        const stepId = `${providerToolCallId}:step`;
        const call = {
          type: 'tool_call',
          id: providerToolCallId,
          name: 'search_price_candidates',
          args,
          progress: toolResult ? 1 : 0,
          ...(toolResult ? { output: JSON.stringify(toolResult) } : {}),
        };
        const index = contentParts
          ? upsertQuotationToolContent(contentParts, call)
          : (quotationToolIndexes.get(providerToolCallId) ??
            context.steelHistory?.preflightToolCalls?.length ??
            0);
        quotationToolIndexes.set(providerToolCallId, index);
        const historyChanged = upsertSteelNativePreflightToolCall(context.steelHistory, call);
        await emitSteelNativeEvents({
          req,
          res,
          streamId,
          historyChanged,
          events: toolResult
            ? [
                createSteelPaddleOcrRunStepCompletedEvent({
                  stepId,
                  providerToolCallId,
                  toolName: call.name,
                  args,
                  output: toolResult,
                  index,
                }),
              ]
            : [
                createSteelPaddleOcrRunStepEvent({
                  requestId: context.requestId,
                  stepId,
                  providerToolCallId,
                  toolName: call.name,
                  index,
                }),
                createSteelPaddleOcrRunStepDeltaEvent({
                  stepId,
                  providerToolCallId,
                  toolName: call.name,
                  args,
                  index,
                }),
              ],
        });
      },
      publishFinal,
      appendSummary: createSteelQuotationSummaryAppender({
        append: db.appendSteelQuotationSummary,
        buildMessage: buildPublicationMessage,
      }),
      summarySourceMessageId: context.requestId,
      refreshPublicationAdmission: createSteelQuotationPublicationAdmission({
        req,
        scope,
        responseId: context.requestId,
        generationId: String(req._resumableJobCreatedAt ?? context.requestId),
        admit: db.admitSteelMarkdown,
      }),
      onSummaryCommitted: (message) => notifyQuotationMessage(message, 'summary'),
      onCompletedReplay: (targetMessageId) =>
        notifyQuotationMessage(
          () => db.getMessage({ user: scope.userId, messageId: targetMessageId }),
          'order',
        ),
    });
  const result = await runPreflight();
  const notice = getQuotationPreflightNotice(result.status);
  if (notice) {
    await onText(notice);
  }
}

module.exports = {
  executeSteelQuotationWorkflow,
};
