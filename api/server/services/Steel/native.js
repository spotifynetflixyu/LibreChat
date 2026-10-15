const steelPostgres = require('./postgres');
const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const {
  sendEvent,
  GenerationJobManager,
  captureSteelNativeToolResult,
  buildSteelNativeEventEnvelopes,
  appendSteelNativeActivityEvent,
  steelNativeStreamEventName,
  createSteelToolRunState,
  executeSteelTool,
  bindQuotationCustomerResult,
  createSteelQuotationStateService,
  hasQuotationOrder,
  isUnfinishedQuotation,
  mergeSteelToolDefinitions,
  prepareSteelNativeToolConfig,
  getSteelOcrFileDescriptor,
  createMongooseSteelWorkingOrderMemoryWriter,
  PADDLE_OCR_MCP_SERVER_NAME: steelPaddleOcrMcpServerName,
} = require('@librechat/api');
const { Constants } = require('librechat-data-provider');

const defaultSteelNativeToolMaxCalls = 8;

const steelNativeToolPerToolLimits = Object.freeze({
  search_price_candidates: 2,
});

/**
 * The provider event handlers load native tools on demand for each tool round.
 * Keep the budget keyed by the request/run-scoped MCP context (or the request
 * itself when no context is available) so reloaded tool instances share one
 * cap without introducing process-global state.
 */
const steelNativeToolRunStates = new WeakMap();

const steelPaddleOcrToolName = 'paddleocr_vl';

const steelPaddleOcrRetryableErrorPatterns = [
  'connection timeout after',
  'failed to establish connection',
  'connection reset by peer',
  'connectionreseterror',
  'clientconnectorerror',
  'clientoserror',
  'cannot connect to host paddleocr.aistudio-app.com',
  'econnreset',
  'socket hang up',
  'server disconnected',
  'transport closed',
  'terminated',
  'timeout',
  'timed out',
  'fetch failed',
  'network error',
  'service unavailable',
  'temporarily unavailable',
  'try again later',
  'too many requests',
  'rate limit',
  'rate_limit',
  'error calling tool',
  'overloaded',
  '429',
  '408',
  '503',
];

const steelPaddleOcrTransportErrorPatterns = [
  'connection timeout',
  'failed to establish connection',
  'connection reset',
  'connectionreseterror',
  'clientconnectorerror',
  'clientoserror',
  'cannot connect to host',
  'econnreset',
  'socket hang up',
  'server disconnected',
  'transport closed',
  'terminated',
  'fetch failed',
  'network error',
];

const steelPaddleOcrMaxAttempts = 3;

const steelPaddleOcrRetryDelayMs = 3000;

const steelPaddleOcrTaskIntervalMs = 1000;

const steelPaddleOcrCallTimeoutMs = 10 * 60 * 1000;

function getSteelNativeToolRunState({ req, requestScopedConnections }) {
  const scope = requestScopedConnections ?? req;
  let runState = steelNativeToolRunStates.get(scope);
  if (!runState) {
    runState = createSteelToolRunState(
      defaultSteelNativeToolMaxCalls,
      steelNativeToolPerToolLimits,
    );
    steelNativeToolRunStates.set(scope, runState);
  }
  return runState;
}

function getRequestConversationId(req) {
  const conversationId = req.body?.conversationId ?? req.steelNativeContext?.conversationId;
  return typeof conversationId === 'string' && conversationId.trim() !== ''
    ? conversationId
    : undefined;
}

function collectSteelOcrCandidateDescriptors(req, requestAttachments) {
  const candidateGroups = [
    req?.steelNativeContext?.currentTurnFiles,
    requestAttachments,
    req?.body?.files,
    req?.body?.attachments,
  ];
  const candidates = [];
  const seen = new Set();

  for (const group of candidateGroups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const file of group) {
      if (!file || typeof file !== 'object') {
        continue;
      }
      const descriptor = getSteelOcrFileDescriptor(file);
      if (!descriptor || seen.has(descriptor.ocrFileKey)) {
        continue;
      }
      seen.add(descriptor.ocrFileKey);
      candidates.push(descriptor);
    }
  }

  return candidates;
}

function addSteelPaddleOcrMcpTool(selectedTools, req, requestAttachments) {
  const serverToken = `${Constants.mcp_all}${Constants.mcp_delimiter}${steelPaddleOcrMcpServerName}`;
  if (
    selectedTools.some(
      (tool) =>
        tool === serverToken ||
        tool?.endsWith(`${Constants.mcp_delimiter}${steelPaddleOcrMcpServerName}`),
    )
  ) {
    return selectedTools;
  }

  const ocrableFiles = collectSteelOcrCandidateDescriptors(req, requestAttachments);
  if (ocrableFiles.length === 0) {
    return selectedTools;
  }

  logger.debug('[Steel OCR] Injecting PaddleOCR MCP server during tool initialization', {
    serverName: steelPaddleOcrMcpServerName,
    files: ocrableFiles.map((file) => ({
      fileId: file.fileId,
      filename: file.filename,
      mediaType: file.mediaType,
    })),
  });
  return [...selectedTools, serverToken];
}

function mergeSteelNativeToolDefinitions(result, visibilityOptions = {}) {
  const merged = mergeSteelToolDefinitions({
    toolDefinitions: result.toolDefinitions ?? [],
    toolRegistry: result.toolRegistry,
  });
  const visible = prepareSteelNativeToolConfig(merged, visibilityOptions);

  return {
    ...result,
    toolDefinitions: visible.toolDefinitions,
    toolRegistry: visible.toolRegistry,
  };
}

async function emitSteelNativeEvents({ events, res, streamId, req, historyChanged = false }) {
  let steelHistoryChanged = historyChanged;
  for (const event of events) {
    if (event?.event === steelNativeStreamEventName) {
      steelHistoryChanged =
        appendSteelNativeActivityEvent(req?.steelNativeContext?.steelHistory, event.data) ||
        steelHistoryChanged;
    }
  }
  if (
    steelHistoryChanged &&
    streamId &&
    typeof GenerationJobManager?.updateMetadata === 'function'
  ) {
    const history = req?.steelNativeContext?.steelHistory;
    if (history) {
      await GenerationJobManager.updateMetadata(
        streamId,
        { steelHistory: history },
        req?._resumableJobCreatedAt,
      );
    }
  }
  for (const event of events) {
    if (streamId) {
      const expectedCreatedAt = req?._resumableJobCreatedAt;
      await GenerationJobManager.emitChunk(
        streamId,
        event,
        expectedCreatedAt == null ? undefined : { expectedCreatedAt },
      );
    } else if (typeof res?.write === 'function' && !res.writableEnded) {
      sendEvent(res, event);
    }
  }
}

function createSteelNativeToolExecute({ req, res, streamId, runState }) {
  const conversationId = getRequestConversationId(req);
  let workingOrderMemoryWriter;

  const getWorkingOrderMemoryWriter = () => {
    if (!conversationId) {
      return undefined;
    }
    workingOrderMemoryWriter ??= createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    return workingOrderMemoryWriter;
  };

  return async ({ toolName, arguments: args, providerToolCallId }) => {
    const quotation = req.steelNativeContext?.quotation;
    let quotationLookupState;
    if (quotation) {
      if (toolName === 'search_price_candidates') {
        throw new Error('Price lookup is only available inside quotation chunks');
      }
      const state = await createSteelQuotationStateService(mongoose).readState(quotation.scope);
      quotationLookupState = state;
      if (
        !hasQuotationOrder(state?.currentOrder?.markdown) ||
        isUnfinishedQuotation(state?.activeRun?.status)
      ) {
        throw new Error('Customer lookup requires a saved order and no unfinished quotation');
      }
    }
    let result = await executeSteelTool({
      client: steelPostgres.client,
      toolName,
      arguments: args,
      providerToolCallId,
      runState,
    });
    if (quotation && toolName === 'search_customers') {
      result = await bindQuotationCustomerResult({
        scope: quotation.scope,
        messageId: quotation.messageId,
        responseId: req.steelNativeContext.requestId,
        expectedOrderHash: quotationLookupState.currentOrder.sha256,
        expectedCustomerPreparationId: quotationLookupState.currentCustomer?.preparationId,
        result,
      });
    }
    const captureResult = await captureSteelNativeToolResult({
      writer: getWorkingOrderMemoryWriter(),
      conversationId,
      requestId: req.steelNativeContext?.requestId,
      providerToolCallId,
      toolName,
      turnIndex: req.steelNativeContext?.assistantTurnIndex,
      checkpointTurnIndex: req.steelNativeContext?.memoryCheckpointTurnIndex,
      result,
    });

    logger.debug('[ToolService] Steel native tool result capture', {
      toolName,
      providerToolCallId,
      status: captureResult.status,
      reason: captureResult.status === 'skipped' ? captureResult.reason : undefined,
      savedCounts:
        captureResult.status === 'captured' ? captureResult.result.savedCounts : undefined,
    });
    await emitSteelNativeEvents({
      req,
      res,
      streamId,
      events: buildSteelNativeEventEnvelopes({
        source: 'tool_result',
        conversationId,
        requestId: req.steelNativeContext?.requestId,
        toolName,
        providerToolCallId,
        capture: captureResult,
      }),
    });

    return result;
  };
}

module.exports = {
  emitSteelNativeEvents,
  steelPaddleOcrToolName,
  getRequestConversationId,
  addSteelPaddleOcrMcpTool,
  steelPaddleOcrMaxAttempts,
  steelPaddleOcrRetryDelayMs,
  getSteelNativeToolRunState,
  steelPaddleOcrCallTimeoutMs,
  steelPaddleOcrTaskIntervalMs,
  createSteelNativeToolExecute,
  mergeSteelNativeToolDefinitions,
  steelPaddleOcrRetryableErrorPatterns,
  steelPaddleOcrTransportErrorPatterns,
};
