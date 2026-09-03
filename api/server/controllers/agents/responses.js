const { nanoid } = require('nanoid');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { Callback, ToolEndHandler, formatAgentMessages } = require('@librechat/agents');
const {
  EModelEndpoint,
  ResourceType,
  PermissionBits,
  hasPermissions,
  AgentCapabilities,
} = require('librechat-data-provider');
const {
  createRun,
  applyContextToAgent,
  buildInitialToolSessions,
  buildToolSet,
  AgentRunEnvelopeError,
  createAgentRunEnvelope,
  buildAgentScopedContext,
  buildInlineMemoryContext,
  buildAgentContextAttachmentsByAgentId,
  buildDefaultSteelGlobalAgentContext,
  delegateOcrStreamEventName,
  prepareLibreChatSteelChatContext,
  prepareSteelNativeToolConfig,
  getLatestHumanMessageText,
  stripSteelOcrPartsFromProviderMessages,
  createSafeUser,
  initializeAgent,
  loadSkillStates,
  getBalanceConfig,
  injectSkillPrimes,
  extractManualSkills,
  recordCollectedUsage,
  createSubagentUsageSink,
  getTransactionsConfig,
  resolveAgentTokenConfig,
  findPiiMatchInMessages,
  discoverConnectedAgents,
  resolveSubagentGraphs,
  createToolExecuteHandler,
  getRemoteAgentPermissions,
  resolveAgentScopedSkillIds,
  extractSteelNativeMarkdownText,
  extractSteelNativeResponseOutputText,
  buildSteelNativeResponseMessageMetadata,
  createSteelNativeHistory,
  // Responses API
  writeDone,
  buildResponse,
  generateResponseId,
  isValidationFailure,
  emitResponseCreated,
  createResponseContext,
  createResponseTracker,
  setupStreamingResponse,
  emitResponseInProgress,
  convertInputToMessages,
  validateResponseRequest,
  buildAggregatedResponse,
  createResponseAggregator,
  sendResponsesErrorResponse,
  createResponsesEventHandlers,
  createAggregatorEventHandlers,
  getLangfuseTraceMessageFields,
  stripActivityLabelParts,
  CHILD_THREAD_READ_ONLY_ERROR,
  createSteelOcrStateService,
  finalizeOcrResponse,
} = require('@librechat/api');
const {
  createResponsesToolEndCallback,
  buildSummarizationHandlers,
  markSummarizationUsage,
  createToolEndCallback,
  createDelegateOcrStreamHandler,
  agentLogHandlerObj,
} = require('~/server/controllers/agents/callbacks');
const {
  loadAgentTools,
  loadToolsForExecution,
  resolveDelegateOcrPolicyForRequest,
  runSteelPaddleOcrPreflight,
  prepareDelegateOcrResume,
  executeDelegateOcrResume,
  isFatalAgentInitializationError,
} = require('~/server/services/ToolService');
const {
  findAccessibleResources,
  getEffectivePermissions,
} = require('~/server/services/PermissionService');
const {
  getSkillToolDeps,
  getSkillDbMethods,
  canAuthorSkillFiles,
  withDeploymentSkillIds,
  buildAgentToolContext,
  resolveMemoryAvailability,
  enrichLoadedToolsWithAgentContext,
} = require('~/server/services/Endpoints/agents/skillDeps');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
const { resolveConfigServers, getAccessibleMcpServerNames } = require('~/server/services/MCP');
const { getMCPManager } = require('~/config');
const { logViolation } = require('~/cache');
const db = require('~/models');

const filterFilesByRemoteAgentAccess = (params) =>
  filterFilesByAgentAccess({ ...params, resourceType: ResourceType.REMOTE_AGENT });

/**
 * Creates a tool loader function for the agent.
 * @param {AbortSignal} signal - The abort signal
 * @param {boolean} [definitionsOnly=true] - When true, returns only serializable
 *   tool definitions without creating full tool instances (for event-driven mode)
 */
function createToolLoader(signal, definitionsOnly = true) {
  return async function loadTools({
    req,
    res,
    tools,
    model,
    agentId,
    provider,
    tool_options,
    tool_resources,
    codeExecutionContext,
    accessibleMcpServerNames,
  }) {
    const agent = { id: agentId, tools, provider, model, tool_options };
    try {
      return await loadAgentTools({
        req,
        res,
        agent,
        signal,
        tool_resources,
        codeExecutionContext,
        agentResourceType: ResourceType.REMOTE_AGENT,
        definitionsOnly,
        accessibleMcpServerNames,
        streamId: null,
      });
    } catch (error) {
      if (isFatalAgentInitializationError(error)) {
        throw error;
      }
      logger.error('Error loading tools for agent ' + agentId, error);
    }
  };
}

/**
 * Convert Open Responses input items to internal messages
 * @param {import('@librechat/api').InputItem[]} input
 * @returns {Array} Internal messages
 */
function convertToInternalMessages(input) {
  return convertInputToMessages(input);
}

const steelNativeResponseRoles = new Set(['system', 'user', 'assistant']);

function parseSteelNativeDataUrlMediaType(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^data:([^;,]+);base64,/i.exec(value);
  return match?.[1];
}

function collectSteelNativeFilePartsFromContent(content) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter(
    (part) =>
      part != null &&
      typeof part === 'object' &&
      (part.type === 'input_file' || part.type === 'input_image'),
  );
}

function addSteelNativeFileReference(filesById, part, conversationId) {
  const fileId = part.file_id;
  if (typeof fileId !== 'string' || fileId.trim() === '' || filesById.has(fileId)) {
    return;
  }

  const mediaType =
    typeof part.mediaType === 'string'
      ? part.mediaType
      : typeof part.media_type === 'string'
        ? part.media_type
        : (parseSteelNativeDataUrlMediaType(part.file_data) ?? 'application/octet-stream');

  filesById.set(fileId, {
    fileId,
    mediaType,
    source: 'librechat_file_record',
    ...(conversationId ? { conversationId } : {}),
    ...(typeof part.filename === 'string' && part.filename.trim() !== ''
      ? { filename: part.filename }
      : {}),
  });
}

function collectSteelNativeInputFileReferencesFromOpenResponsesInput(input, conversationId) {
  const filesById = new Map();
  if (!Array.isArray(input)) {
    return filesById;
  }

  for (const item of input) {
    if (item?.type !== 'message') {
      continue;
    }
    for (const part of collectSteelNativeFilePartsFromContent(item.content)) {
      addSteelNativeFileReference(filesById, part, conversationId);
    }
  }

  return filesById;
}

function collectSteelNativeInputFileReferencesFromMessages(messages, conversationId) {
  const filesById = new Map();

  for (const message of messages) {
    if (message?.role !== 'user') {
      continue;
    }
    const fileParts = [...collectSteelNativeFilePartsFromContent(message.content)];
    for (const file of message.files ?? []) {
      const fileId = file?.file_id ?? file?.fileId;
      if (typeof fileId !== 'string' || fileId.trim() === '') {
        continue;
      }
      fileParts.push({
        ...file,
        file_id: fileId,
      });
    }
    for (const part of fileParts) {
      addSteelNativeFileReference(filesById, part, conversationId);
    }
  }

  return filesById;
}

function collectSteelNativeInputFileReferences({ requestInput, inputMessages, conversationId }) {
  const filesById = collectSteelNativeInputFileReferencesFromOpenResponsesInput(
    requestInput,
    conversationId,
  );

  for (const [fileId, file] of collectSteelNativeInputFileReferencesFromMessages(
    inputMessages,
    conversationId,
  )) {
    if (!filesById.has(fileId)) {
      filesById.set(fileId, file);
    }
  }

  return [...filesById.values()];
}

function collectSteelNativeResponseMessages(messages, conversationId) {
  const activeHistory = [];
  let currentUserTurn;

  for (const message of messages) {
    if (!steelNativeResponseRoles.has(message.role)) {
      continue;
    }

    const files =
      message.role === 'user'
        ? [...collectSteelNativeInputFileReferencesFromMessages([message], conversationId).values()]
        : [];
    const steelMessage = {
      role: message.role,
      content: extractSteelNativeMarkdownText({ content: message.content }),
      ...(typeof message.messageId === 'string' ? { messageId: message.messageId } : {}),
      ...(files.length > 0 ? { files } : {}),
    };
    activeHistory.push(steelMessage);
    if (steelMessage.role === 'user') {
      currentUserTurn = steelMessage;
    }
  }

  return { activeHistory, currentUserTurn };
}

function buildSharedRunContextWithSteel(
  inlineMemoryContext,
  agentScopedContext,
  steelRuntimeContext,
) {
  return [inlineMemoryContext, agentScopedContext, steelRuntimeContext]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

function normalizeSteelNativeResponseStorage(request) {
  request.store = true;
  return true;
}

function markSteelNativeResponseStored(response) {
  response.store = true;
  return response;
}

async function resolveResponseConversation(responseId, userId) {
  const directConversation = await db.getConvo(userId, responseId);
  if (directConversation) {
    return { conversationId: responseId, conversation: directConversation };
  }

  if (!responseId.startsWith('resp_')) {
    return null;
  }

  const responseMessage = await db.getMessage({ user: userId, messageId: responseId });
  const conversationId =
    responseMessage && typeof responseMessage.conversationId === 'string'
      ? responseMessage.conversationId
      : undefined;
  if (!conversationId || conversationId === responseId) {
    return null;
  }

  const conversation = await db.getConvo(userId, conversationId);
  return conversation ? { conversationId, conversation } : null;
}

/**
 * Load messages from a previous response/conversation
 * @param {string} conversationId - The conversation/response ID
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} Messages from the conversation
 */
async function loadPreviousMessages(conversationId, userId) {
  try {
    const messages = await db.getMessages({ conversationId, user: userId });
    if (!messages || messages.length === 0) {
      return [];
    }

    // Convert stored messages to internal format
    return messages.map((msg) => {
      const internalMsg = {
        role: msg.isCreatedByUser ? 'user' : 'assistant',
        content: '',
        messageId: msg.messageId,
      };

      // Handle content - could be string or array
      if (typeof msg.text === 'string') {
        try {
          const parsedText = JSON.parse(msg.text);
          internalMsg.content = Array.isArray(parsedText) ? parsedText : msg.text;
        } catch {
          internalMsg.content = msg.text;
        }
      } else if (Array.isArray(msg.content)) {
        // Handle content parts
        internalMsg.content = msg.content;
      } else if (msg.text) {
        internalMsg.content = String(msg.text);
      }

      if (Array.isArray(msg.files)) {
        internalMsg.files = msg.files;
      }

      return internalMsg;
    });
  } catch (error) {
    logger.error('[Responses API] Error loading previous messages:', error);
    return [];
  }
}

/**
 * Save input messages to database
 * @param {import('express').Request} req
 * @param {string} conversationId
 * @param {Array} inputMessages - Internal format messages
 * @param {string} agentId
 * @returns {Promise<void>}
 */
async function saveInputMessages(req, conversationId, inputMessages, agentId) {
  for (const msg of inputMessages) {
    if (msg.role === 'user') {
      await db.saveMessage(
        req,
        {
          messageId: msg.messageId || nanoid(),
          conversationId,
          parentMessageId: null,
          isCreatedByUser: true,
          text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          sender: 'User',
          endpoint: EModelEndpoint.agents,
          model: agentId,
        },
        { context: 'Responses API - save user input' },
      );
    }
  }
}

function replaceResponsesOutputText(response, text) {
  let replaced = false;
  for (const output of response.output ?? []) {
    for (const content of output?.content ?? []) {
      if (typeof content?.text !== 'string') {
        continue;
      }
      content.text = replaced ? '' : text;
      replaced = true;
    }
  }
}

function materializeResponsesTrackerText(tracker, text = tracker?.accumulatedText ?? '') {
  if (!tracker?.currentMessage || !Array.isArray(tracker.currentMessage.content)) {
    return;
  }
  tracker.accumulatedText = text;
  const content = tracker.currentMessage.content[tracker.currentContentIndex];
  if (content && typeof content === 'object' && 'text' in content) {
    content.text = text;
  }
}

async function runPreparedResponsesDelegateOcr({
  req,
  res,
  signal,
  agent,
  resume,
  responseId,
  messageDeltaHandler,
}) {
  return executeDelegateOcrResume({
    req,
    res,
    signal,
    agent,
    resume,
    onDelta: async (delta) => {
      if (!delta) {
        return;
      }
      await messageDeltaHandler.handle('on_message_delta', {
        id: `delegate_ocr_resume:${responseId}`,
        delta: { content: [{ type: 'text', text: delta }] },
      });
    },
  });
}

/**
 * Save response output to database
 * @param {import('express').Request} req
 * @param {string} conversationId
 * @param {string} responseId
 * @param {import('@librechat/api').Response} response
 * @param {string} agentId
 * @param {number} [processingDurationMs]
 * @returns {Promise<void>}
 */
async function saveResponseOutput(
  req,
  conversationId,
  responseId,
  response,
  agentId,
  processingDurationMs,
) {
  let responseText = extractSteelNativeResponseOutputText(response);
  let ocrFinalization;
  if (/^ {0,3}##(?!#)[ \t]+ocr_result[ \t]*$/imu.test(responseText)) {
    const stateService = createSteelOcrStateService(mongoose);
    const state = await stateService.readConversationOcrState(conversationId);
    const delegateContext = req.steelNativeContext?.delegateOcrContext;
    const delegateRun = delegateContext?.delegateOcrRun;
    const executionLeaseToken =
      delegateContext?.delegateOcrExecutionLease?.executionLeaseToken ??
      delegateRun?.executionLeaseToken;
    const agentKind = delegateRun
      ? 'delegate_ocr'
      : req.steelNativeContext?.ocrTurnActive === true
        ? 'regular_ocr'
        : 'other';
    const finalized = finalizeOcrResponse({
      assistantResponse: responseText,
      previousOcrMarkdown: state?.currentOcrResultMarkdown,
      canonicalMapping: (state?.sourceMappings ?? []).map(({ sourceCode, sourceFilename }) => ({
        sourceCode,
        sourceFilename,
      })),
      delegateSummary: agentKind === 'delegate_ocr',
      agentKind,
    });
    if (finalized.ok) {
      responseText = finalized.finalResponse;
      replaceResponsesOutputText(response, responseText);
      const candidateToken = `${responseId}:${Date.now()}`;
      if (delegateRun?.claimToken) {
        const candidate = await stateService.setDelegateFinalizedCandidate({
          claimToken: delegateRun.claimToken,
          ...(executionLeaseToken ? { executionLeaseToken } : {}),
          candidate: {
            token: candidateToken,
            markdown: finalized.finalResponse,
            source: 'backend',
            generationId: responseId,
            targetMessageId: responseId,
            createdAt: new Date(),
          },
        });
        if (!candidate) {
          throw new Error('delegate_ocr finalization lease is stale');
        }
        const journal = await stateService.updateDelegateFinalizationJournal({
            claimToken: delegateRun.claimToken,
            ...(executionLeaseToken ? { executionLeaseToken } : {}),
            candidateToken,
            journal: {
              candidateValidated: true,
              candidateValidatedToken: candidateToken,
            },
          });
        if (!journal) {
          throw new Error('delegate_ocr finalization journal lease is stale');
        }
      }
      ocrFinalization = {
        stateService,
        state,
        finalized,
        delegateRun,
        executionLeaseToken,
        candidateToken,
      };
    } else if (finalized.reason === 'mapping_mismatch') {
      responseText = '目前 AI model 暫時不可用，建議先切換別的 model。';
      replaceResponsesOutputText(response, responseText);
    }
  }

  const langfuseTraceFields = await getLangfuseTraceMessageFields(req.config, responseId);

  // Save the assistant message
  const responseMessage = {
      messageId: responseId,
      conversationId,
      parentMessageId: null,
      isCreatedByUser: false,
      ...langfuseTraceFields,
      text: responseText,
      sender: 'Agent',
      endpoint: EModelEndpoint.agents,
      model: agentId,
      finish_reason: response.status === 'completed' ? 'stop' : response.status,
      tokenCount: response.usage?.output_tokens,
      ...(Number.isSafeInteger(processingDurationMs) && processingDurationMs >= 0
        ? { processingDurationMs }
        : {}),
      metadata: buildSteelNativeResponseMessageMetadata({
        conversationId,
        responseId,
        turnIndex: req.steelNativeContext?.assistantTurnIndex,
        checkpointTurnIndex: req.steelNativeContext?.memoryCheckpointTurnIndex,
        requestedStore: req.steelNativeContext?.requestedStore,
        store: req.steelNativeContext?.store === true,
        providerStateMode:
          req.steelNativeContext?.providerStateMode ?? 'openai_responses_reconstructed',
        contextMetadata: req.steelNativeContext?.contextMetadata,
        activityEvents:
          req.steelNativeContext?.steelHistory?.activityEvents ??
          req.steelNativeContext?.steelActivityEvents,
        preflightToolCalls: req.steelNativeContext?.steelHistory?.preflightToolCalls,
      }),
    };
  const saveMessageOperation = () =>
    db.saveMessage(req, responseMessage, { context: 'Responses API - save assistant response' });
  let savedMessage;
  let responseMessageSaveError;
  for (let attempt = 1; attempt <= (ocrFinalization ? 3 : 1); attempt += 1) {
    try {
      savedMessage = await saveMessageOperation();
      if (!savedMessage) {
        throw new Error('Responses API OCR message save returned no document');
      }
      break;
    } catch (error) {
      if (attempt >= 3 || !ocrFinalization) {
        responseMessageSaveError = error;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (responseMessageSaveError) {
    if (ocrFinalization?.delegateRun?.claimToken) {
      await ocrFinalization.stateService
        .transitionDelegateOcrRun({
          claimToken: ocrFinalization.delegateRun.claimToken,
          ...(ocrFinalization.executionLeaseToken
            ? { executionLeaseToken: ocrFinalization.executionLeaseToken }
            : {}),
          status: 'save_failed',
          currentStage: 'failed',
          failureKind: 'persistence',
        })
        .catch(() => undefined);
    }
    throw responseMessageSaveError;
  }
  if (ocrFinalization) {
    if (ocrFinalization.delegateRun?.claimToken) {
      const journal = await ocrFinalization.stateService.updateDelegateFinalizationJournal({
        claimToken: ocrFinalization.delegateRun.claimToken,
        ...(ocrFinalization.executionLeaseToken
          ? { executionLeaseToken: ocrFinalization.executionLeaseToken }
          : {}),
        candidateToken: ocrFinalization.candidateToken,
        journal: {
          messagePersisted: true,
          messagePersistedToken: ocrFinalization.candidateToken,
        },
      });
      if (!journal) {
        throw new Error('delegate_ocr message journal lease is stale');
      }
    }
    const saveOcrResult = () =>
      ocrFinalization.stateService.upsertCurrentOcrResult({
        conversationId,
        generationId: responseId,
        attemptNumber: ocrFinalization.delegateRun?.agentAttemptNumber ?? 1,
        markdown: ocrFinalization.finalized.ocrResultMarkdown,
        messageId: responseId,
        ...(ocrFinalization.delegateRun?.claimToken
          ? { claimToken: ocrFinalization.delegateRun.claimToken }
          : {}),
        ...(ocrFinalization.executionLeaseToken
          ? { executionLeaseToken: ocrFinalization.executionLeaseToken }
          : {}),
        ...(ocrFinalization.delegateRun?.delegateOcrIndex !== undefined
          ? { delegateOcrIndex: ocrFinalization.delegateRun.delegateOcrIndex }
          : {}),
        ...(ocrFinalization.state?.currentOcrResultGenerationId
          ? { expectedGenerationId: ocrFinalization.state.currentOcrResultGenerationId }
          : {}),
      });
    let ocrResultSaved = false;
    let ocrResultSaveError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const saved = await saveOcrResult();
        if (!saved) {
          throw new Error('Responses API OCR result save returned no document');
        }
        ocrResultSaved = true;
        break;
      } catch (error) {
        ocrResultSaveError = error;
        if (attempt >= 3) {
          logger.error('[Responses API] Corrected message saved but OCR result state failed', {
            conversationId,
            responseId,
            error: error?.message,
          });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (ocrFinalization.delegateRun?.claimToken) {
      const runInput = {
        claimToken: ocrFinalization.delegateRun.claimToken,
        ...(ocrFinalization.executionLeaseToken
          ? { executionLeaseToken: ocrFinalization.executionLeaseToken }
          : {}),
      };
      if (ocrResultSaved) {
        await ocrFinalization.stateService.updateDelegateFinalizationJournal({
          ...runInput,
          candidateToken: ocrFinalization.candidateToken,
          journal: {
            resultPersisted: true,
            resultPersistedToken: ocrFinalization.candidateToken,
          },
        });
        const completedRun = await ocrFinalization.stateService.transitionDelegateOcrRun({
          ...runInput,
          status: 'completed',
          currentStage: 'completed',
        });
        if (!completedRun) {
          throw new Error('delegate_ocr completion lease is stale');
        }
        const clearedClaim = await ocrFinalization.stateService.clearCompletedDelegateClaim({
          conversationId,
          claimToken: ocrFinalization.delegateRun.claimToken,
          delegateOcrIndex: ocrFinalization.delegateRun.delegateOcrIndex,
          ...(ocrFinalization.executionLeaseToken
            ? { executionLeaseToken: ocrFinalization.executionLeaseToken }
            : {}),
        });
        if (!clearedClaim) {
          throw new Error('delegate_ocr completed claim lease is stale');
        }
        await ocrFinalization.stateService.updateDelegateFinalizationJournal({
          ...runInput,
          candidateToken: ocrFinalization.candidateToken,
          journal: {
            claimCleared: true,
            claimClearedToken: ocrFinalization.candidateToken,
          },
        });
      } else {
        await ocrFinalization.stateService.transitionDelegateOcrRun({
          ...runInput,
          status: 'save_failed',
          currentStage: 'failed',
          failureKind: 'persistence',
        });
        logger.error('[Responses API] Delegate OCR final save failed', {
          conversationId,
          responseId,
          error: ocrResultSaveError?.message,
        });
      }
    }
  }
}

/**
 * Save or update conversation
 * @param {import('express').Request} req
 * @param {string} conversationId
 * @param {string} agentId
 * @param {object} agent
 * @returns {Promise<void>}
 */
async function saveConversation(req, conversationId, agentId, agent) {
  await db.saveConvo(
    {
      userId: req?.user?.id,
      isTemporary: req?.body?.isTemporary,
      interfaceConfig: req?.config?.interfaceConfig,
    },
    {
      conversationId,
      endpoint: EModelEndpoint.agents,
      agentId,
      title: agent?.name || 'Open Responses Conversation',
      model: agent?.model,
    },
    { context: 'Responses API - save conversation' },
  );
}

/**
 * Convert stored messages to Open Responses output format
 * @param {Array} messages - Stored messages
 * @returns {Array} Output items
 */
function convertMessagesToOutputItems(messages) {
  const output = [];

  for (const msg of messages) {
    if (!msg.isCreatedByUser) {
      output.push({
        type: 'message',
        id: msg.messageId,
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: msg.text || '',
            annotations: [],
          },
        ],
      });
    }
  }

  return output;
}

/**
 * Runs a validated Responses envelope in the current process.
 * Express remains runtime-only state while the envelope is the portable run input.
 *
 * @param {import('@librechat/api').ResponsesRunEnvelope} envelope
 * @param {{req: import('express').Request, res: import('express').Response}} runtime
 */
const executeResponse = async (envelope, { req, res }) => {
  const appConfig = req.config;
  const requestStartTime = envelope.receivedAt;
  const { principal } = envelope;
  const request = envelope.payload;
  // The local executor keeps the current Express-dependent initialization path,
  // but all request-body reads now observe the detached envelope payload.
  req.body = request;
  const requestedStore = request.store;
  const shouldStoreResponse = normalizeSteelNativeResponseStorage(request);
  const agentId = request.model;
  const isStreaming = request.stream === true;
  const summarizationConfig = appConfig?.summarization;

  // Look up the agent
  const agent = await db.getAgent({ id: agentId });
  if (!agent) {
    return sendResponsesErrorResponse(
      res,
      404,
      `Agent not found: ${agentId}`,
      'not_found',
      'model_not_found',
    );
  }

  // Generate IDs
  const responseId = generateResponseId();
  const context = createResponseContext(request, responseId);

  logger.debug(
    `[Responses API] Request ${responseId} started for agent ${agentId}, stream: ${isStreaming}`,
  );

  // Set up abort controller
  const abortController = new AbortController();

  // Handle client disconnect
  req.on('close', () => {
    if (!abortController.signal.aborted) {
      abortController.abort();
      logger.debug('[Responses API] Client disconnected, aborting');
    }
  });

  try {
    let continuationConversationId = null;
    if (request.previous_response_id != null) {
      if (typeof request.previous_response_id !== 'string') {
        return sendResponsesErrorResponse(
          res,
          400,
          'previous_response_id must be a string',
          'invalid_request',
        );
      }
      const continuation = await resolveResponseConversation(
        request.previous_response_id,
        principal?.userId ?? req.user?.id,
      );
      if (!continuation) {
        return sendResponsesErrorResponse(res, 404, 'Conversation not found', 'not_found');
      }
      if (continuation.conversation.subagentThread != null) {
        return sendResponsesErrorResponse(
          res,
          409,
          CHILD_THREAD_READ_ONLY_ERROR,
          'invalid_request',
          'conversation_read_only',
        );
      }
      continuationConversationId = continuation.conversationId;
    }

    const conversationId = continuationConversationId ?? uuidv4();
    const parentMessageId = null;
    const agentsEConfig = appConfig?.endpoints?.[EModelEndpoint.agents];

    // Build allowed providers set
    const allowedProviders = new Set(agentsEConfig?.allowedProviders);

    // Create tool loader
    const loadTools = createToolLoader(abortController.signal);
    const skillDbMethods = getSkillDbMethods();

    // Initialize the agent first to check for disableStreaming
    const endpointOption = {
      endpoint: agent.provider,
      model_parameters: agent.model_parameters ?? {},
    };

    const dbMethods = {
      getConvoFiles: db.getConvoFiles,
      getFiles: db.getFiles,
      filterFilesByAgentAccess: filterFilesByRemoteAgentAccess,
      getUserKey: db.getUserKey,
      getMessages: db.getMessages,
      getAccessibleMcpServerNames,
      updateFilesUsage: db.updateFilesUsage,
      getUserKeyValues: db.getUserKeyValues,
      getUserCodeFiles: db.getUserCodeFiles,
      getToolFilesByIds: db.getToolFilesByIds,
      getCodeGeneratedFiles: db.getCodeGeneratedFiles,
      listSkillsByAccess: skillDbMethods.listSkillsByAccess,
      listAlwaysApplySkills: skillDbMethods.listAlwaysApplySkills,
      getSkillByName: skillDbMethods.getSkillByName,
    };

    const enabledCapabilities = new Set(agentsEConfig?.capabilities);
    const memoryAvailable = await resolveMemoryAvailability({
      enabledCapabilities,
      memoryConfig: appConfig?.memory,
      user: req.user,
      getRoleByName: db.getRoleByName,
    });
    const skillsCapabilityEnabled = enabledCapabilities.has(AgentCapabilities.skills);
    const ephemeralSkillsToggle = request.ephemeralAgent?.skills === true;
    const accessibleSkillIds = skillsCapabilityEnabled
      ? withDeploymentSkillIds(
          await findAccessibleResources({
            userId: principal.userId,
            role: principal.role,
            resourceType: ResourceType.SKILL,
            requiredPermissions: PermissionBits.VIEW,
          }),
        )
      : [];
    const editableSkillIds = skillsCapabilityEnabled
      ? await findAccessibleResources({
          userId: principal.userId,
          role: principal.role,
          resourceType: ResourceType.SKILL,
          requiredPermissions: PermissionBits.EDIT,
        })
      : [];
    const skillCreateAllowed = skillsCapabilityEnabled
      ? await getSkillToolDeps().canCreateSkill({ req })
      : false;

    const { skillStates, defaultActiveOnShare } = await loadSkillStates({
      userId: principal.userId,
      appConfig,
      getUserById: db.getUserById,
      accessibleSkillIds,
    });

    const manualSkills = extractManualSkills(request);

    const primaryScopedSkillIds = resolveAgentScopedSkillIds({
      agent,
      accessibleSkillIds,
      skillsCapabilityEnabled,
      ephemeralSkillsToggle,
    });
    const primaryScopedEditableSkillIds = resolveAgentScopedSkillIds({
      agent,
      accessibleSkillIds: editableSkillIds,
      skillsCapabilityEnabled,
      ephemeralSkillsToggle,
    });

    const primaryConfig = await initializeAgent(
      {
        req,
        res,
        loadTools,
        requestFiles: [],
        conversationId,
        parentMessageId,
        agent,
        endpointOption,
        allowedProviders,
        isInitialAgent: true,
        accessibleSkillIds: primaryScopedSkillIds,
        skillAuthoringAvailable: canAuthorSkillFiles({
          agent,
          scopedEditableSkillIds: primaryScopedEditableSkillIds,
          skillCreateAllowed,
          skillsCapabilityEnabled,
          ephemeralSkillsToggle,
        }),
        codeEnvAvailable: enabledCapabilities.has(AgentCapabilities.execute_code),
        backgroundToolsAvailable: enabledCapabilities.has(AgentCapabilities.run_in_background),
        toolIntentsAvailable: enabledCapabilities.has(AgentCapabilities.tool_intents),
        statefulSessionsAvailable: enabledCapabilities.has(
          AgentCapabilities.stateful_code_sessions,
        ),
        allowedStatefulCodeEnvironments: agentsEConfig?.statefulCodeSessions?.allowedEnvironments,
        memoryAvailable,
        skillStates,
        defaultActiveOnShare,
        manualSkills,
      },
      dbMethods,
    );

    /**
     * Per-agent tool-execution context map, keyed by agentId. Ensures the
     * ON_TOOL_EXECUTE callback routes each sub-agent's tool calls to the
     * correct toolRegistry / userMCPAuthMap / tool_resources.
     * @type {Map<string, {
     *   agent: object,
     *   toolRegistry?: import('@librechat/agents').LCToolRegistry,
     *   requestScopedConnections?: import('@librechat/api').RequestScopedMCPConnectionStore,
     *   userMCPAuthMap?: Record<string, Record<string, string>>,
     *   tool_resources?: object,
     *   actionsEnabled?: boolean,
     * }>}
     */
    const agentToolContexts = new Map();
    agentToolContexts.set(
      primaryConfig.id,
      buildAgentToolContext({ agent, config: primaryConfig }),
    );

    let handoffAgentConfigs = new Map();
    let discoveredEdges = [];
    let discoveredMCPAuthMap;
    const subagentsCapabilityEnabled = enabledCapabilities.has(AgentCapabilities.subagents);
    const primaryHasGraphSubagents =
      subagentsCapabilityEnabled &&
      primaryConfig.subagents?.enabled === true &&
      (primaryConfig.subagents.graphs?.length ?? 0) > 0;
    if (primaryConfig.edges?.length || primaryHasGraphSubagents) {
      const modelsConfig = await getModelsConfig(req);
      const discoveryParams = {
        req,
        res,
        primaryConfig,
        endpointOption,
        allowedProviders,
        modelsConfig,
        loadTools,
        requestFiles: [],
        conversationId,
        parentMessageId,
        resourceType: ResourceType.REMOTE_AGENT,
        computeAccessibleSkillIds: (handoffAgent) =>
          resolveAgentScopedSkillIds({
            agent: handoffAgent,
            accessibleSkillIds,
            skillsCapabilityEnabled,
            ephemeralSkillsToggle,
          }),
        computeSkillAuthoringAvailable: (handoffAgent) =>
          canAuthorSkillFiles({
            agent: handoffAgent,
            scopedEditableSkillIds: resolveAgentScopedSkillIds({
              agent: handoffAgent,
              accessibleSkillIds: editableSkillIds,
              skillsCapabilityEnabled,
              ephemeralSkillsToggle,
            }),
            skillCreateAllowed,
            skillsCapabilityEnabled,
            ephemeralSkillsToggle,
          }),
        skillStates,
        defaultActiveOnShare,
        codeEnvAvailable: enabledCapabilities.has(AgentCapabilities.execute_code),
        backgroundToolsAvailable: enabledCapabilities.has(AgentCapabilities.run_in_background),
        toolIntentsAvailable: enabledCapabilities.has(AgentCapabilities.tool_intents),
        statefulSessionsAvailable: enabledCapabilities.has(
          AgentCapabilities.stateful_code_sessions,
        ),
        allowedStatefulCodeEnvironments: agentsEConfig?.statefulCodeSessions?.allowedEnvironments,
        memoryAvailable,
      };
      const discoveryDeps = {
        getAgent: db.getAgent,
        checkPermission: async ({ userId, role, resourceId, requiredPermission }) => {
          const permissions = await getRemoteAgentPermissions(
            { getEffectivePermissions },
            userId,
            role,
            resourceId,
          );
          return hasPermissions(permissions, requiredPermission);
        },
        logViolation,
        db: dbMethods,
        onAgentInitialized: (loadedAgentId, loadedAgent, config) => {
          agentToolContexts.set(
            loadedAgentId,
            buildAgentToolContext({ agent: loadedAgent, config }),
          );
        },
        initializeAgent,
      };
      if (primaryConfig.edges?.length) {
        ({
          agentConfigs: handoffAgentConfigs,
          edges: discoveredEdges,
          userMCPAuthMap: discoveredMCPAuthMap,
        } = await discoverConnectedAgents(discoveryParams, discoveryDeps));
      }
      if (subagentsCapabilityEnabled) {
        discoveredMCPAuthMap = await resolveSubagentGraphs(
          {
            ...discoveryParams,
            rootConfigs: [primaryConfig, ...handoffAgentConfigs.values()],
          },
          discoveryDeps,
        );
      }
    }

    primaryConfig.edges = discoveredEdges;
    const endpointTokenConfigByAgentId = new Map();
    for (const [agentId, context] of agentToolContexts) {
      endpointTokenConfigByAgentId.set(agentId, context.endpointTokenConfig);
    }
    const resolveEndpointTokenConfig = (usage) =>
      resolveAgentTokenConfig({
        agentId: usage?.agentId,
        byAgentId: endpointTokenConfigByAgentId,
        fallback: primaryConfig.endpointTokenConfig,
      });
    const runAgents = [primaryConfig, ...handoffAgentConfigs.values()];
    const initialSessions = buildInitialToolSessions({ agents: runAgents });
    const contextAgentsById = new Map(runAgents.map((runAgent) => [runAgent.id, runAgent]));
    for (const runAgent of runAgents) {
      for (const graph of runAgent.subagentGraphConfigs ?? []) {
        for (const memberConfig of graph.memberConfigs) {
          contextAgentsById.set(memberConfig.id, memberConfig);
        }
      }
    }
    const contextAgents = [...contextAgentsById.values()];
    const mergedMCPAuthMap = discoveredMCPAuthMap ?? primaryConfig.userMCPAuthMap;

    const agentContextAttachmentsByAgentId = buildAgentContextAttachmentsByAgentId(contextAgents);
    const agentScopedContext = await buildAgentScopedContext({
      agentIds: contextAgents.map(({ id }) => id),
      attachmentsByAgentId: agentContextAttachmentsByAgentId,
      req,
    });

    const mcpManager = getMCPManager();
    const configServers = await resolveConfigServers(req);

    const inlineMemoryContextByAgentId = new Map();
    await Promise.all(
      contextAgents.map(async (runAgent) => {
        const memoryContext = await buildInlineMemoryContext({
          agent: runAgent,
          req,
          userId: principal.userId,
          memoryAvailable,
          getFormattedMemories: db.getFormattedMemories,
        });
        if (memoryContext) {
          inlineMemoryContextByAgentId.set(runAgent.id, memoryContext);
        }
      }),
    );
    // Determine if streaming is enabled (check both request and agent config)
    const streamingDisabled = !!primaryConfig.model_parameters?.disableStreaming;
    const actuallyStreaming = isStreaming && !streamingDisabled;

    // Load previous messages if previous_response_id is provided
    let previousMessages = [];
    if (request.previous_response_id) {
      const userId = principal?.userId ?? req.user?.id ?? 'api-user';
      previousMessages = await loadPreviousMessages(conversationId, userId);
    }

    // Convert input to internal messages
    const inputMessages = convertToInternalMessages(request.input);
    const currentTurnFiles = collectSteelNativeInputFileReferences({
      requestInput: request.input,
      inputMessages,
      conversationId,
    });

    const piiHit = findPiiMatchInMessages(inputMessages, appConfig?.messageFilter?.pii);
    if (piiHit != null) {
      return sendResponsesErrorResponse(
        res,
        400,
        piiHit.misconfigured
          ? 'Message filtering is misconfigured; contact your administrator.'
          : `Message contains a ${piiHit.label}. Remove it and try again.`,
        'invalid_request',
        'message_filter_pii_block',
      );
    }

    // Merge previous messages with new input
    const allMessages = [...previousMessages, ...inputMessages];
    const assistantTurnIndex = allMessages.length;
    const tracker = actuallyStreaming ? createResponseTracker() : null;
    const aggregator = actuallyStreaming ? null : createResponseAggregator();
    const handlerConfig = actuallyStreaming
      ? {
          res,
          context,
          tracker,
        }
      : null;

    if (handlerConfig) {
      setupStreamingResponse(res);
      emitResponseCreated(handlerConfig);
      emitResponseInProgress(handlerConfig);
    }

    const steelHistory = createSteelNativeHistory();
    req.steelNativeContext = {
      ...(req.steelNativeContext ?? {}),
      conversationId,
      requestId: responseId,
      assistantTurnIndex,
      memoryCheckpointTurnIndex: Math.max(0, assistantTurnIndex - 1),
      requestedStore,
      store: shouldStoreResponse,
      providerStateMode: 'openai_responses_reconstructed',
      currentTurnFiles,
      steelHistory,
      steelActivityEvents: steelHistory.activityEvents,
    };
    const { activeHistory, currentUserTurn } = collectSteelNativeResponseMessages(
      allMessages,
      conversationId,
    );
    if (currentUserTurn && currentTurnFiles.length > 0) {
      currentUserTurn.files = currentTurnFiles;
    }
    const steelConversation = prepareLibreChatSteelChatContext({
      conversationId,
      requestId: responseId,
      activeHistory,
      ...(currentUserTurn ? { currentUserTurn } : {}),
    });
    const currentUserTurnText = getLatestHumanMessageText(inputMessages);
    req.steelNativeContext.delegateOcrContext = {
      ...(req.steelNativeContext.delegateOcrContext ?? {}),
      currentUserTurnText,
      steelConversation,
    };
    const delegateOcrResume =
      typeof prepareDelegateOcrResume === 'function'
        ? await prepareDelegateOcrResume({
            req,
            conversationId,
            triggeringMessageId: currentUserTurn?.messageId,
            userId: principal?.userId ?? req.user?.id,
          })
        : undefined;
    const paddleOcrPreflight = delegateOcrResume
      ? { ocrTurnActive: false, delegateOcrResume: true }
      : await runSteelPaddleOcrPreflight({
          req,
          res,
          agent: primaryConfig,
          signal: abortController.signal,
          streamId: req._resumableStreamId || null,
          userMCPAuthMap: mergedMCPAuthMap,
        });
    req.steelNativeContext = {
      ...(req.steelNativeContext ?? {}),
      paddleOcrPreflight,
      ocrTurnActive: paddleOcrPreflight?.ocrTurnActive === true,
    };
    const delegateOcrPolicy = delegateOcrResume
      ? { resolved: true, allowed: false, allowedFileKeys: [], reason: 'delegate_ocr_resume' }
      : await resolveDelegateOcrPolicyForRequest({
          req,
          currentUserTurn: currentUserTurnText,
          ocrTurnActive: paddleOcrPreflight?.ocrTurnActive === true,
        });
    req.steelNativeContext.delegateOcrPolicy = delegateOcrPolicy;
    for (const runAgent of runAgents) {
      Object.assign(
        runAgent,
        prepareSteelNativeToolConfig(runAgent, {
          ocrTurnActive: paddleOcrPreflight?.ocrTurnActive === true,
          delegateOcrPolicy,
        }),
      );
    }
    for (const context of agentToolContexts.values()) {
      if (context?.agent) {
        Object.assign(
          context.agent,
          prepareSteelNativeToolConfig(context.agent, {
            ocrTurnActive: paddleOcrPreflight?.ocrTurnActive === true,
            delegateOcrPolicy,
          }),
        );
      }
      if (context) {
        Object.assign(
          context,
          prepareSteelNativeToolConfig(context, {
            ocrTurnActive: paddleOcrPreflight?.ocrTurnActive === true,
            delegateOcrPolicy,
          }),
        );
      }
    }
    const ocrTurnActive = paddleOcrPreflight?.ocrTurnActive === true;
    const steelNativeContext = await buildDefaultSteelGlobalAgentContext({
      conversation: steelConversation,
      ...(ocrTurnActive
        ? {
            attachments: {
              ...(paddleOcrPreflight?.currentOcrMarkdownResults?.length > 0
                ? { currentOcrMarkdownResults: paddleOcrPreflight.currentOcrMarkdownResults }
                : {}),
              ...(paddleOcrPreflight?.currentOcrSourceFileMapping?.length > 0
                ? { currentOcrSourceFileMapping: paddleOcrPreflight.currentOcrSourceFileMapping }
                : {}),
              ...(typeof paddleOcrPreflight?.previousOcrResultMarkdown === 'string'
                ? { previousOcrResultMarkdown: paddleOcrPreflight.previousOcrResultMarkdown }
                : {}),
              ...(paddleOcrPreflight?.suggestedOcrResultColumns?.length > 0
                ? { suggestedOcrResultColumns: paddleOcrPreflight.suggestedOcrResultColumns }
                : {}),
            },
          }
        : currentTurnFiles.length > 0 ||
            paddleOcrPreflight?.currentOcrMarkdownResults?.length > 0 ||
            paddleOcrPreflight?.currentPaddleOcrStatuses?.length > 0 ||
            paddleOcrPreflight?.currentOcrFailures?.length > 0 ||
            paddleOcrPreflight?.currentOcrSourceFileMapping?.length > 0
          ? {
              attachments: {
                ...(currentTurnFiles.length > 0 ? { currentTurnFiles } : {}),
                ...(paddleOcrPreflight?.currentPaddleOcrStatuses?.length > 0
                  ? { currentPaddleOcrStatuses: paddleOcrPreflight.currentPaddleOcrStatuses }
                  : {}),
                ...(paddleOcrPreflight?.currentOcrMarkdownResults?.length > 0
                  ? { currentOcrMarkdownResults: paddleOcrPreflight.currentOcrMarkdownResults }
                  : {}),
                ...(paddleOcrPreflight?.currentOcrFailures?.length > 0
                  ? { currentOcrFailures: paddleOcrPreflight.currentOcrFailures }
                  : {}),
                ...(paddleOcrPreflight?.currentOcrSourceFileMapping?.length > 0
                  ? { currentOcrSourceFileMapping: paddleOcrPreflight.currentOcrSourceFileMapping }
                  : {}),
              },
            }
          : {}),
      renderProfile: 'open_responses',
      mode: ocrTurnActive ? 'ocr' : 'standard',
    });
    req.steelNativeContext = {
      ...(req.steelNativeContext ?? {}),
      contextMetadata: steelNativeContext.metadata,
    };

    await Promise.all(
      contextAgents.map((runAgent) =>
        applyContextToAgent({
          agent: runAgent,
          agentId: runAgent.id,
          logger,
          mcpManager,
          configServers,
          globalInstructionPrefix: steelNativeContext.instructionPrefix,
          sharedRunContext: buildSharedRunContextWithSteel(
            inlineMemoryContextByAgentId.get(runAgent.id),
            agentScopedContext.get(runAgent.id),
            steelNativeContext.runtimeContextText,
          ),
        }),
      ),
    );

    const toolSet = buildToolSet(primaryConfig);
    const formatted = formatAgentMessages(stripActivityLabelParts(allMessages), {}, toolSet);
    const formattedMessages = formatted.messages;
    const initialSummary = formatted.summary;
    let indexTokenCountMap = formatted.indexTokenCountMap;

    /**
     * Inject manual + always-apply skill primes so the model sees SKILL.md
     * bodies for this turn — parity with AgentClient's chat path. The
     * Responses API uses its own response-builder shape, so LibreChat-
     * style card SSE events don't apply; only the message-context part
     * carries over.
     */
    const manualSkillPrimes = primaryConfig.manualSkillPrimes;
    const alwaysApplySkillPrimes = primaryConfig.alwaysApplySkillPrimes;
    if (
      (manualSkillPrimes && manualSkillPrimes.length > 0) ||
      (alwaysApplySkillPrimes && alwaysApplySkillPrimes.length > 0)
    ) {
      const primeResult = injectSkillPrimes({
        initialMessages: formattedMessages,
        indexTokenCountMap,
        manualSkillPrimes,
        alwaysApplySkillPrimes,
      });
      indexTokenCountMap = primeResult.indexTokenCountMap;
      /* Surface the cap-driven always-apply truncation at the controller
         layer too — `injectSkillPrimes` already logs internally, but the
         controller-level warn includes endpoint context so operators can
         tell at a glance which path hit the cap. Mirrors AgentClient's
         warn in `client.js`. */
      if (primeResult.alwaysApplyDropped > 0) {
        logger.warn(
          `[Responses API] Dropped ${primeResult.alwaysApplyDropped} always-apply prime(s) to stay within MAX_PRIMED_SKILLS_PER_TURN.`,
        );
      }
    }
    const providerMessages = stripSteelOcrPartsFromProviderMessages(
      formattedMessages,
      currentTurnFiles,
    );
    req.steelNativeContext = {
      ...(req.steelNativeContext ?? {}),
      delegateOcrContext: {
        ...(req.steelNativeContext?.delegateOcrContext ?? {}),
        history: formattedMessages,
        steelConversation,
      },
    };

    /* Stable for the turn: the primary prime list is fixed once
       `initializeAgent` resolves and is used as the fallback when a
       specific agent context is unavailable. `codeEnvAvailable` is read
       per-agent from the stored tool context (admin cap AND that
       agent's `tools` list includes `execute_code`) — a skills-only
       agent never gains sandbox access even if the admin enabled the
       capability globally. */
    if (actuallyStreaming) {
      // Create event handlers
      const { handlers: responsesHandlers, finalizeStream } =
        createResponsesEventHandlers(handlerConfig);

      // Collect usage for balance tracking
      const collectedUsage = [];

      // Artifact promises for processing tool outputs
      /** @type {Promise<import('librechat-data-provider').TAttachment | null>[]} */
      const artifactPromises = [];
      // Use Responses API-specific callback that emits librechat:attachment events
      const toolEndCallback = createResponsesToolEndCallback({
        req,
        res,
        tracker,
        artifactPromises,
      });

      // Create tool execute options for event-driven tool execution
      const toolExecuteOptions = {
        loadTools: async (toolNames, agentId) => {
          const ctx =
            agentToolContexts.get(agentId) ?? agentToolContexts.get(primaryConfig.id) ?? {};
          const result = await loadToolsForExecution({
            req,
            res,
            agentResourceType: ResourceType.REMOTE_AGENT,
            conversationId,
            toolNames,
            agent: ctx.agent ?? agent,
            signal: abortController.signal,
            toolRegistry: ctx.toolRegistry,
            backgroundToolNames: ctx.backgroundToolNames,
            intentToolNames: ctx.intentToolNames,
            mcpAvailableTools: ctx.mcpAvailableTools,
            requestScopedConnections: ctx.requestScopedConnections,
            userMCPAuthMap: ctx.userMCPAuthMap,
            tool_resources: ctx.tool_resources,
            actionsEnabled: ctx.actionsEnabled,
            enableDelegateOcrStreaming: true,
            accessibleMcpServerNames: ctx.accessibleMcpServerNames,
          });
          return enrichLoadedToolsWithAgentContext({
            result,
            req,
            ctx,
          });
        },
        toolEndCallback,
        ...getSkillToolDeps(),
      };

      // Combine handlers
      const handlers = {
        on_message_delta: responsesHandlers.on_message_delta,
        on_reasoning_delta: responsesHandlers.on_reasoning_delta,
        on_run_step: responsesHandlers.on_run_step,
        on_run_step_delta: responsesHandlers.on_run_step_delta,
        on_chat_model_end: {
          handle: (event, data, metadata) => {
            responsesHandlers.on_chat_model_end.handle(event, data);
            const usage = data?.output?.usage_metadata;
            if (usage) {
              const taggedUsage = markSummarizationUsage(usage, metadata);
              collectedUsage.push(taggedUsage);
            }
          },
        },
        on_tool_end: new ToolEndHandler(toolEndCallback, logger),
        on_run_step_completed: { handle: () => {} },
        on_chain_stream: { handle: () => {} },
        on_chain_end: { handle: () => {} },
        on_agent_update: { handle: () => {} },
        on_custom_event: { handle: () => {} },
        on_tool_execute: createToolExecuteHandler(toolExecuteOptions),
        [delegateOcrStreamEventName]: createDelegateOcrStreamHandler(),
        on_agent_log: agentLogHandlerObj,
        ...(summarizationConfig?.enabled !== false
          ? buildSummarizationHandlers({ isStreaming: actuallyStreaming, res })
          : {}),
      };

      // Create and run the agent
      const userId = principal.userId;
      const userMCPAuthMap = mergedMCPAuthMap;

      const run = await createRun({
        agents: runAgents,
        messages: providerMessages,
        indexTokenCountMap,
        initialSummary,
        runId: responseId,
        summarizationConfig,
        appConfig,
        signal: abortController.signal,
        customHandlers: handlers,
        initialSessions,
        delegateOcrPolicy: req.steelNativeContext.delegateOcrPolicy,
        requestBody: {
          messageId: responseId,
          conversationId,
        },
        user: { id: userId },
        tenantId: principal?.tenantId ?? req.user?.tenantId,
        openAIOAuthModelOptionsSink: (modelOptions) => {
          req.steelNativeContext.delegateOcrContext.modelOptions = modelOptions;
        },
        /** Bills subagent child-run model calls (reported outside the
         *  streamEvents loop) into the same collectedUsage array. */
        subagentUsageSink: createSubagentUsageSink(collectedUsage, (usage) => {
          responsesHandlers.on_chat_model_end.handle('on_chat_model_end', {
            output: { usage_metadata: usage },
          });
        }),
      });

      if (!run) {
        throw new Error('Failed to create agent run');
      }

      // Process the stream
      const config = {
        runName: 'AgentRun',
        configurable: {
          thread_id: conversationId,
          user_id: userId,
          user: createSafeUser(req.user),
          requestBody: {
            messageId: responseId,
            conversationId,
          },
          ...(userMCPAuthMap != null && { userMCPAuthMap }),
        },
        signal: abortController.signal,
        streamMode: 'values',
        version: 'v2',
      };

      if (delegateOcrResume) {
        await runPreparedResponsesDelegateOcr({
          req,
          res,
          signal: abortController.signal,
          agent: primaryConfig,
          resume: delegateOcrResume,
          responseId,
          messageDeltaHandler: handlers.on_message_delta,
        });
      } else {
        await run.processStream({ messages: providerMessages }, config, {
          callbacks: {
            [Callback.TOOL_ERROR]: (graph, error, toolId) => {
              logger.error(`[Responses API] Tool Error "${toolId}"`, error);
            },
          },
        });
      }

      // Record token usage against balance
      const balanceConfig = getBalanceConfig(appConfig);
      const transactionsConfig = getTransactionsConfig(appConfig);
      recordCollectedUsage(
        {
          spendTokens: db.spendTokens,
          spendStructuredTokens: db.spendStructuredTokens,
          pricing: { getMultiplier: db.getMultiplier, getCacheMultiplier: db.getCacheMultiplier },
          bulkWriteOps: { insertMany: db.bulkInsertTransactions, updateBalance: db.updateBalance },
        },
        {
          user: userId,
          conversationId,
          collectedUsage,
          context: 'message',
          messageId: responseId,
          balance: balanceConfig,
          transactions: transactionsConfig,
          model: primaryConfig.model || agent.model_parameters?.model,
          endpointTokenConfig: primaryConfig.endpointTokenConfig,
          resolveEndpointTokenConfig,
        },
      ).catch((err) => {
        logger.error('[Responses API] Error recording usage:', err);
      });

      if (shouldStoreResponse) {
        try {
          // Save conversation
          await saveConversation(req, conversationId, agentId, agent);

          // Save input messages
          await saveInputMessages(req, conversationId, inputMessages, agentId);

          // Build response for saving (use tracker with buildResponse for streaming)
          materializeResponsesTrackerText(tracker);
          const finalResponse = markSteelNativeResponseStored(
            buildResponse(context, tracker, 'completed'),
          );
          await saveResponseOutput(
            req,
            conversationId,
            responseId,
            finalResponse,
            agentId,
            Math.max(0, Date.now() - requestStartTime),
          );
          materializeResponsesTrackerText(
            tracker,
            extractSteelNativeResponseOutputText(finalResponse),
          );

          logger.debug(
            `[Responses API] Stored response ${responseId} in conversation ${conversationId}`,
          );
        } catch (saveError) {
          logger.error('[Responses API] Error saving response:', saveError);
          // Don't fail the request if saving fails
        }
      }

      // Finalize the stream
      finalizeStream();
      res.end();

      const duration = Date.now() - requestStartTime;
      logger.debug(`[Responses API] Request ${responseId} completed in ${duration}ms (streaming)`);

      // Wait for artifact processing after response ends (non-blocking)
      if (artifactPromises.length > 0) {
        Promise.all(artifactPromises).catch((artifactError) => {
          logger.warn('[Responses API] Error processing artifacts:', artifactError);
        });
      }
    } else {
      const aggregatorHandlers = createAggregatorEventHandlers(aggregator);

      // Collect usage for balance tracking
      const collectedUsage = [];

      /** @type {Promise<import('librechat-data-provider').TAttachment | null>[]} */
      const artifactPromises = [];
      const toolEndCallback = createToolEndCallback({ req, res, artifactPromises, streamId: null });

      const toolExecuteOptions = {
        loadTools: async (toolNames, agentId) => {
          const ctx =
            agentToolContexts.get(agentId) ?? agentToolContexts.get(primaryConfig.id) ?? {};
          const result = await loadToolsForExecution({
            req,
            res,
            agentResourceType: ResourceType.REMOTE_AGENT,
            conversationId,
            toolNames,
            agent: ctx.agent ?? agent,
            signal: abortController.signal,
            toolRegistry: ctx.toolRegistry,
            backgroundToolNames: ctx.backgroundToolNames,
            intentToolNames: ctx.intentToolNames,
            mcpAvailableTools: ctx.mcpAvailableTools,
            requestScopedConnections: ctx.requestScopedConnections,
            userMCPAuthMap: ctx.userMCPAuthMap,
            tool_resources: ctx.tool_resources,
            actionsEnabled: ctx.actionsEnabled,
            enableDelegateOcrStreaming: true,
            accessibleMcpServerNames: ctx.accessibleMcpServerNames,
          });
          return enrichLoadedToolsWithAgentContext({
            result,
            req,
            ctx,
          });
        },
        toolEndCallback,
        ...getSkillToolDeps(),
      };

      const handlers = {
        on_message_delta: aggregatorHandlers.on_message_delta,
        on_reasoning_delta: aggregatorHandlers.on_reasoning_delta,
        on_run_step: aggregatorHandlers.on_run_step,
        on_run_step_delta: aggregatorHandlers.on_run_step_delta,
        on_chat_model_end: {
          handle: (event, data, metadata) => {
            aggregatorHandlers.on_chat_model_end.handle(event, data);
            const usage = data?.output?.usage_metadata;
            if (usage) {
              const taggedUsage = markSummarizationUsage(usage, metadata);
              collectedUsage.push(taggedUsage);
            }
          },
        },
        on_tool_end: new ToolEndHandler(toolEndCallback, logger),
        on_run_step_completed: { handle: () => {} },
        on_chain_stream: { handle: () => {} },
        on_chain_end: { handle: () => {} },
        on_agent_update: { handle: () => {} },
        on_custom_event: { handle: () => {} },
        on_tool_execute: createToolExecuteHandler(toolExecuteOptions),
        [delegateOcrStreamEventName]: createDelegateOcrStreamHandler(),
        on_agent_log: agentLogHandlerObj,
        ...(summarizationConfig?.enabled !== false
          ? buildSummarizationHandlers({ isStreaming: false, res })
          : {}),
      };

      const userId = principal.userId;
      const userMCPAuthMap = mergedMCPAuthMap;

      const run = await createRun({
        agents: runAgents,
        messages: providerMessages,
        indexTokenCountMap,
        initialSummary,
        runId: responseId,
        summarizationConfig,
        appConfig,
        signal: abortController.signal,
        customHandlers: handlers,
        initialSessions,
        delegateOcrPolicy: req.steelNativeContext.delegateOcrPolicy,
        requestBody: {
          messageId: responseId,
          conversationId,
        },
        user: { id: userId },
        tenantId: principal?.tenantId ?? req.user?.tenantId,
        openAIOAuthModelOptionsSink: (modelOptions) => {
          req.steelNativeContext.delegateOcrContext.modelOptions = modelOptions;
        },
        /** Bills subagent child-run model calls (reported outside the
         *  streamEvents loop) into the same collectedUsage array. */
        subagentUsageSink: createSubagentUsageSink(collectedUsage, (usage) => {
          aggregatorHandlers.on_chat_model_end.handle('on_chat_model_end', {
            output: { usage_metadata: usage },
          });
        }),
      });

      if (!run) {
        throw new Error('Failed to create agent run');
      }

      const config = {
        runName: 'AgentRun',
        configurable: {
          thread_id: conversationId,
          user_id: userId,
          user: createSafeUser(req.user),
          requestBody: {
            messageId: responseId,
            conversationId,
          },
          ...(userMCPAuthMap != null && { userMCPAuthMap }),
        },
        signal: abortController.signal,
        streamMode: 'values',
        version: 'v2',
      };

      if (delegateOcrResume) {
        await runPreparedResponsesDelegateOcr({
          req,
          res,
          signal: abortController.signal,
          agent: primaryConfig,
          resume: delegateOcrResume,
          responseId,
          messageDeltaHandler: handlers.on_message_delta,
        });
      } else {
        await run.processStream({ messages: providerMessages }, config, {
          callbacks: {
            [Callback.TOOL_ERROR]: (graph, error, toolId) => {
              logger.error(`[Responses API] Tool Error "${toolId}"`, error);
            },
          },
        });
      }

      // Record token usage against balance
      const balanceConfig = getBalanceConfig(appConfig);
      const transactionsConfig = getTransactionsConfig(appConfig);
      recordCollectedUsage(
        {
          spendTokens: db.spendTokens,
          spendStructuredTokens: db.spendStructuredTokens,
          pricing: { getMultiplier: db.getMultiplier, getCacheMultiplier: db.getCacheMultiplier },
          bulkWriteOps: { insertMany: db.bulkInsertTransactions, updateBalance: db.updateBalance },
        },
        {
          user: userId,
          conversationId,
          collectedUsage,
          context: 'message',
          messageId: responseId,
          balance: balanceConfig,
          transactions: transactionsConfig,
          model: primaryConfig.model || agent.model_parameters?.model,
          endpointTokenConfig: primaryConfig.endpointTokenConfig,
          resolveEndpointTokenConfig,
        },
      ).catch((err) => {
        logger.error('[Responses API] Error recording usage:', err);
      });

      if (artifactPromises.length > 0) {
        try {
          await Promise.all(artifactPromises);
        } catch (artifactError) {
          logger.warn('[Responses API] Error processing artifacts:', artifactError);
        }
      }

      const response = markSteelNativeResponseStored(buildAggregatedResponse(context, aggregator));

      if (shouldStoreResponse) {
        try {
          await saveConversation(req, conversationId, agentId, agent);

          await saveInputMessages(req, conversationId, inputMessages, agentId);

          await saveResponseOutput(
            req,
            conversationId,
            responseId,
            response,
            agentId,
            Math.max(0, Date.now() - requestStartTime),
          );

          logger.debug(
            `[Responses API] Stored response ${responseId} in conversation ${conversationId}`,
          );
        } catch (saveError) {
          logger.error('[Responses API] Error saving response:', saveError);
          // Don't fail the request if saving fails
        }
      }

      res.json(response);

      const duration = Date.now() - requestStartTime;
      logger.debug(
        `[Responses API] Request ${responseId} completed in ${duration}ms (non-streaming)`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An error occurred';
    logger.error('[Responses API] Error:', error);

    // Check if we already started streaming (headers sent)
    if (res.headersSent) {
      // Headers already sent, write error event and close
      writeDone(res);
      res.end();
    } else {
      // Forward upstream provider status codes (e.g., Anthropic 400s) instead of masking as 500
      const statusCode =
        typeof error?.status === 'number' && error.status >= 400 && error.status < 600
          ? error.status
          : 500;
      const errorType = statusCode >= 400 && statusCode < 500 ? 'invalid_request' : 'server_error';
      const errorCode = typeof error?.code === 'string' ? error.code : undefined;
      if (errorCode === undefined) {
        sendResponsesErrorResponse(res, statusCode, errorMessage, errorType);
      } else {
        sendResponsesErrorResponse(res, statusCode, errorMessage, errorType, errorCode);
      }
    }
  }
};

/**
 * Open Responses ingress adapter for agents.
 * Authentication and remote-agent authorization have already run in route middleware.
 *
 * POST /v1/responses
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const createResponse = async (req, res) => {
  const receivedAt = Date.now();
  const validation = validateResponseRequest(req.body);
  if (isValidationFailure(validation)) {
    return sendResponsesErrorResponse(res, 400, validation.error);
  }

  let envelope;
  try {
    envelope = createAgentRunEnvelope({
      protocol: 'responses',
      requestId: req.requestId ?? req.id ?? `agent-run-${nanoid()}`,
      receivedAt,
      principal: req.user,
      payload: validation.request,
    });
  } catch (error) {
    if (error instanceof AgentRunEnvelopeError) {
      return sendResponsesErrorResponse(res, 400, error.message, 'invalid_request');
    }
    throw error;
  }

  return executeResponse(envelope, { req, res });
};

/**
 * List available agents as models - GET /v1/models (also works with /v1/responses/models)
 *
 * Returns a list of available agents the user has remote access to.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const listModels = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId) {
      return sendResponsesErrorResponse(res, 401, 'Authentication required', 'auth_error');
    }

    // Find agents the user has remote access to (VIEW permission on REMOTE_AGENT)
    const accessibleAgentIds = await findAccessibleResources({
      userId,
      role: userRole,
      resourceType: ResourceType.REMOTE_AGENT,
      requiredPermissions: PermissionBits.VIEW,
    });

    // Get the accessible agents
    let agents = [];
    if (accessibleAgentIds.length > 0) {
      agents = await db.getAgents({ _id: { $in: accessibleAgentIds } });
    }

    // Convert to models format
    const models = agents.map((agent) => ({
      id: agent.id,
      object: 'model',
      created: Math.floor(new Date(agent.createdAt).getTime() / 1000),
      owned_by: agent.author ?? 'librechat',
      // Additional metadata
      name: agent.name,
      description: agent.description,
      provider: agent.provider,
    }));

    res.json({
      object: 'list',
      data: models,
    });
  } catch (error) {
    logger.error('[Responses API] Error listing models:', error);
    sendResponsesErrorResponse(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to list models',
      'server_error',
    );
  }
};

/**
 * Get Response - GET /v1/responses/:id
 *
 * Retrieves a stored response by its ID.
 * The response ID maps to a conversationId in LibreChat's storage.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getResponse = async (req, res) => {
  try {
    const responseId = req.params.id;
    const userId = req.user?.id;

    if (!responseId) {
      return sendResponsesErrorResponse(res, 400, 'Response ID is required');
    }

    const resolvedResponse = await resolveResponseConversation(responseId, userId);
    if (!resolvedResponse) {
      return sendResponsesErrorResponse(
        res,
        404,
        `Response not found: ${responseId}`,
        'not_found',
        'response_not_found',
      );
    }
    const { conversationId, conversation } = resolvedResponse;

    // Load messages for this conversation
    const messages = await db.getMessages({ conversationId, user: userId });

    if (!messages || messages.length === 0) {
      return sendResponsesErrorResponse(
        res,
        404,
        `No messages found for response: ${responseId}`,
        'not_found',
        'response_not_found',
      );
    }

    // Convert messages to Open Responses output format
    const output = convertMessagesToOutputItems(messages);

    // Find the last assistant message for usage info
    const lastAssistantMessage = messages.filter((m) => !m.isCreatedByUser).pop();

    // Build the response object
    const response = {
      id: responseId,
      object: 'response',
      created_at: Math.floor(new Date(conversation.createdAt || Date.now()).getTime() / 1000),
      completed_at: Math.floor(new Date(conversation.updatedAt || Date.now()).getTime() / 1000),
      status: 'completed',
      incomplete_details: null,
      model: conversation.agentId || conversation.model || 'unknown',
      previous_response_id: null,
      instructions: null,
      output,
      error: null,
      tools: [],
      tool_choice: 'auto',
      truncation: 'disabled',
      parallel_tool_calls: true,
      text: { format: { type: 'text' } },
      temperature: 1,
      top_p: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      top_logprobs: null,
      reasoning: null,
      user: userId,
      usage: lastAssistantMessage?.tokenCount
        ? {
            input_tokens: 0,
            output_tokens: lastAssistantMessage.tokenCount,
            total_tokens: lastAssistantMessage.tokenCount,
          }
        : null,
      max_output_tokens: null,
      max_tool_calls: null,
      store: true,
      background: false,
      service_tier: 'default',
      metadata: {},
      safety_identifier: null,
      prompt_cache_key: null,
    };

    res.json(response);
  } catch (error) {
    logger.error('[Responses API] Error getting response:', error);
    sendResponsesErrorResponse(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to get response',
      'server_error',
    );
  }
};

module.exports = {
  createResponse,
  getResponse,
  listModels,
};
