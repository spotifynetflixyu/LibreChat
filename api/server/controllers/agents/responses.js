const { nanoid } = require('nanoid');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { Callback, formatAgentMessages } = require('@librechat/agents');
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
  buildRunToolSet,
  AgentRunEnvelopeError,
  createAgentRunEnvelope,
  createAgentExecutionContext,
  createMCPRuntimeRequestBody,
  buildAgentScopedContext,
  buildInlineMemoryContext,
  buildAgentContextAttachmentsByAgentId,
  buildDefaultSteelGlobalAgentContext,
  delegateOcrStreamEventName,
  prepareLibreChatSteelChatContext,
  stripSteelOcrPartsFromProviderMessages,
  extractSteelNativeMarkdownText,
  extractSteelNativeResponseOutputText,
  buildSteelNativeResponseMessageMetadata,
  createSteelNativeHistory,
  prepareSteelNativeToolConfig,
  prepareQuotationTurn,
  prepareSteelMarkdownHistory,
  hasQuotationOrder,
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
  resolveSubagentGraphs,
  inspectContent,
  extractAgentContent,
  extractFileContent,
  extractMessageContent,
  extractModelParameterContent,
  extractSkillContent,
  extractToolArgumentContent,
  contentFilterBlockResponse,
  contentFilterUninspectableResponse,
  discoverConnectedAgents,
  getBlockedOpaqueFileField,
  getContentTraversalFragments,
  isContentTraversalProtected,
  isContentTraversalLimitError,
  prependContentTraversalFragments,
  assertModelBoundContent,
  reportLocatorTraversalFailure,
  hasModelBoundContentProtection,
  isContentFilterError,
  getSafeErrorMetadata,
  getUserFacingProviderError,
  getAgentErrorMetadata,
  createToolExecuteHandler,
  createOwnedToolEndHandler,
  resolveRecursionLimit,
  getRemoteAgentPermissions,
  resolveAgentScopedSkillIds,
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
  buildResponsesUsage,
  createResponseAggregator,
  sendResponsesErrorResponse,
  createResponsesEventHandlers,
  createAggregatorEventHandlers,
  createClientToolHandoff,
  getLangfuseTraceMessageFields,
  stripActivityLabelParts,
  stripUnusableSummaryParts,
  CHILD_THREAD_READ_ONLY_ERROR,
  createSteelOcrStateService,
  createSteelQuotationStateService,
  createSteelMarkdownCompletionServices,
  createSteelQuotationPublicationPublisher,
  createSteelFullMarkdownPublisher,
  createSteelQuotationPublicationMessageBuilder,
  finalizeSteelResponsesTurn,
  replaceSteelResponsesMarkdown,
  createSteelOcrResponseAuditService,
  executeAgentRun,
  waitForAgentExecutionWrites,
  resolveToolRoleGrants,
  resolveAdmittedCodeEnvironmentDecision,
  resolvePersistableCodeEnvironmentDecision,
  createTerminalRunErrorObserver,
} = require('@librechat/api');
const {
  createResponsesToolEndCallback,
  buildSummarizationHandlers,
  contextualizeModelUsage,
  createToolEndCallback,
  createDelegateOcrStreamHandler,
  agentLogHandlerObj,
} = require('~/server/controllers/agents/callbacks');
const {
  loadAgentTools,
  loadToolsForExecution,
  isFatalAgentInitializationError,
  resolveDelegateOcrPolicyForRequest,
  runSteelPaddleOcrPreflight,
  prepareDelegateOcrResume,
  executeDelegateOcrResume,
  executeSteelQuotationWorkflow,
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
const { createProvisionFilesCallback } = require('~/server/services/Files/provisionCallback');
const { checkSessionsAlive, loadCodeApiKey } = require('~/server/services/Files/provision');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
const { resolveConfigServers, getAccessibleMcpServerNames } = require('~/server/services/MCP');
const { resolveConversationTitle } = require('~/server/services/Endpoints/titlePolicy');
const { getMCPManager } = require('~/config');
const { logViolation } = require('~/cache');
const db = require('~/models');

const filterFilesByRemoteAgentAccess = (params) =>
  filterFilesByAgentAccess({ ...params, resourceType: ResourceType.REMOTE_AGENT });

function handleExecutionError({ error, res, appConfig }) {
  const protectionEnabled = hasModelBoundContentProtection(
    appConfig?.filters,
    appConfig?.messageFilter?.pii,
  );
  const errorMessage = getUserFacingProviderError(error, protectionEnabled);

  if (res.headersSent) {
    writeDone(res);
    res.end();
    return;
  }
  if (isContentFilterError(error)) {
    return sendResponsesErrorResponse(
      res,
      error.statusCode,
      error.body.message,
      'invalid_request',
      error.body.error,
    );
  }
  const errorMetadata = getAgentErrorMetadata(error);
  const statusCode = errorMetadata?.status ?? 500;
  const errorType = statusCode >= 400 && statusCode < 500 ? 'invalid_request' : 'server_error';
  const errorCode = !protectionEnabled ? errorMetadata?.code : undefined;
  if (errorCode === undefined) {
    sendResponsesErrorResponse(res, statusCode, errorMessage, errorType);
  } else {
    sendResponsesErrorResponse(res, statusCode, errorMessage, errorType, errorCode);
  }
}

/**
 * Creates a tool loader function for the agent.
 * @param {Object} runtime - Request-backed tool adapter state
 * @param {import('express').Request} runtime.req
 * @param {import('express').Response} runtime.res
 * @param {AbortSignal} runtime.signal - The abort signal
 * @param {boolean} [runtime.definitionsOnly=true] - When true, returns only serializable
 *   tool definitions without creating full tool instances (for event-driven mode)
 */
function createToolLoader({ req, res, signal, definitionsOnly = true }) {
  return async function loadTools({
    tools,
    model,
    agentId,
    provider,
    tool_options,
    tool_resources,
    requestBody,
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
        requestBody,
        tool_resources,
        codeExecutionContext,
        agentResourceType: ResourceType.REMOTE_AGENT,
        definitionsOnly,
        accessibleMcpServerNames,
        streamId: null,
      });
    } catch (error) {
      if (isFatalAgentInitializationError(error, { signal }) || isContentFilterError(error)) {
        throw error;
      }
      logger.error('Error loading tools for agent ' + agentId, getSafeErrorMetadata(error));
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
  const fileId = part?.file_id ?? part?.fileId;
  if (typeof fileId !== 'string' || fileId.trim() === '' || filesById.has(fileId)) {
    return;
  }
  let mediaType = parseSteelNativeDataUrlMediaType(part.file_data);
  if (typeof part.media_type === 'string') {
    mediaType = part.media_type;
  }
  if (typeof part.mediaType === 'string') {
    mediaType = part.mediaType;
  }
  mediaType ??= 'application/octet-stream';
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
  for (const message of messages ?? []) {
    if (message?.role !== 'user') {
      continue;
    }
    const fileParts = [...collectSteelNativeFilePartsFromContent(message.content)];
    for (const file of message.files ?? []) {
      const fileId = file?.file_id ?? file?.fileId;
      if (typeof fileId === 'string' && fileId.trim() !== '') {
        fileParts.push({ ...file, file_id: fileId });
      }
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
  for (const message of messages ?? []) {
    if (!steelNativeResponseRoles.has(message?.role)) {
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

function buildSharedRunContextWithSteel(inlineMemoryContext, agentScopedContext, steelRuntimeContext) {
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
 * Collect file-derived context exactly as it will be exposed to the model.
 * Dynamic tool context uses the same synthesis as packages/api/src/agents/run.ts.
 * @param {Array} agents
 * @returns {Array}
 */
function collectModelBoundAgentFiles(agents) {
  const files = [];
  const seenFiles = new Set();
  for (const agent of agents) {
    for (const attachment of [
      ...(agent?.attachments ?? []),
      ...(agent?.requestAttachments ?? []),
      ...(agent?.agentContextAttachments ?? []),
    ]) {
      if (attachment == null || seenFiles.has(attachment)) {
        continue;
      }
      seenFiles.add(attachment);
      files.push(attachment);
    }

    const dynamicToolInstructions = Object.values(agent?.dynamicToolContextMap ?? {})
      .filter((value) => typeof value === 'string' && value !== '')
      .join('\n')
      .trim();
    if (dynamicToolInstructions !== '') {
      files.push({ content: dynamicToolInstructions });
    }
  }
  return files;
}

function extractResponseRequestContent(request, messageFragments) {
  const fragments = [
    ...extractAgentContent({ instructions: request.instructions }),
    ...messageFragments,
  ];

  if (Array.isArray(request.input)) {
    for (const item of request.input) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) {
        continue;
      }
      for (const part of item.content) {
        if (part?.type === 'input_file') {
          fragments.push(...extractFileContent({ name: part.filename }));
          continue;
        }
        if (
          part?.type === 'input_image' &&
          typeof part.image_url === 'string' &&
          !part.image_url.startsWith('data:')
        ) {
          fragments.push(...extractFileContent({ uri: part.image_url }));
        }
      }
    }
  }

  for (const tool of request.tools ?? []) {
    if (tool?.type !== 'function') {
      continue;
    }
    fragments.push(
      ...extractAgentContent({
        name: tool.name,
        description: tool.description,
      }),
    );
    try {
      fragments.push(...extractToolArgumentContent({ arguments: tool.parameters }));
    } catch (error) {
      if (isContentTraversalLimitError(error)) {
        prependContentTraversalFragments(error, fragments);
      }
      throw error;
    }
  }

  try {
    fragments.push(
      ...extractModelParameterContent({
        metadata: request.metadata,
        response_format: request.text?.format,
        additionalModelRequestFields: {
          user: request.user,
          tool_choice: request.tool_choice,
          reasoning: request.reasoning,
        },
      }),
    );
  } catch (error) {
    if (isContentTraversalLimitError(error)) {
      prependContentTraversalFragments(error, fragments);
    }
    throw error;
  }

  return fragments;
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

    return messages.map((msg) => {
      const internalMsg = {
        role: msg.isCreatedByUser ? 'user' : 'assistant',
        content: '',
        messageId: msg.messageId,
        isCreatedByUser: msg.isCreatedByUser === true,
        ...(typeof msg.isUserSubmitted === 'boolean' && {
          isUserSubmitted: msg.isUserSubmitted,
        }),
        ...(Array.isArray(msg.userSubmittedPaths) && {
          userSubmittedPaths: msg.userSubmittedPaths,
        }),
        ...(Array.isArray(msg.userSubmittedMessageFieldPaths) && {
          userSubmittedMessageFieldPaths: msg.userSubmittedMessageFieldPaths,
        }),
      };
      if (typeof msg.text === 'string') {
        internalMsg.text = msg.text;
      }
      if (Array.isArray(msg.content)) {
        internalMsg.content = msg.content;
      } else if (typeof msg.text === 'string') {
        try {
          const parsedText = JSON.parse(msg.text);
          internalMsg.content = Array.isArray(parsedText) ? parsedText : msg.text;
        } catch {
          internalMsg.content = msg.text;
        }
      } else if (msg.text != null) {
        internalMsg.content = String(msg.text);
      }
      if (Array.isArray(msg.files)) {
        internalMsg.files = msg.files;
      }
      return internalMsg;
    });
  } catch (error) {
    logger.error('[Responses API] Error loading previous messages:', getSafeErrorMetadata(error));
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

/**
 * Save response output to database
 * @param {import('express').Request} req
 * @param {string} conversationId
 * @param {string} responseId
 * @param {import('@librechat/api').Response} response
 * @param {string} agentId
 * @param {number | undefined} visibleOutputTokens
 * @returns {Promise<void>}
 */
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
  const langfuseTraceFields = await getLangfuseTraceMessageFields(req.config, responseId);

  // Save the assistant message
  const responseMessage = {
      messageId: responseId,
      conversationId,
      parentMessageId: null,
      isCreatedByUser: false,
      ...langfuseTraceFields,
      text: responseText,
      unfinished: false,
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
  const saveMessageOperation = async (options = {}) => {
    responseMessage.text = responseText;
    responseMessage.unfinished = options.completed === false;
    const saved = await db.saveMessage(req, responseMessage, {
      context: 'Responses API - save assistant response',
    });
    if (!saved) {
      throw new Error('Responses API assistant response could not be persisted');
    }
    return saved;
  };
  let persistedMessage;
  let responseMessagePersisted = false;
  const persistMarkdown = async (options) => {
    const saved = await saveMessageOperation(options);
    responseMessagePersisted = true;
    persistedMessage = saved;
    return saved;
  };
  const publishQuotation = createSteelQuotationPublicationPublisher({
    saveContext: {
      isTemporary: req.body?.isTemporary,
      expiredAt: req._agentEventBindingRetention?.expiredAt ?? req.resolvedConversation?.expiredAt,
      interfaceConfig: req.config?.interfaceConfig,
    },
    buildMessage: ({ markdown }) => ({
      ...responseMessage,
      messageId: responseMessage.messageId,
      sourceMessageId: responseMessage.messageId,
      text: markdown,
    }),
    savePublication: (proof) => db.saveSteelQuotationMessage(proof),
  });
  const markdownCompletion = createSteelMarkdownCompletionServices({
    ocr: createSteelOcrStateService(mongoose),
    quotation: createSteelQuotationStateService(mongoose),
    audit: createSteelOcrResponseAuditService(mongoose),
  });
  const completion = await markdownCompletion.finalize({
    req,
    responseId,
    generationId: responseId,
    markdown: responseText,
    completed: response.status === 'completed',
    stage: 'ui',
    applyMarkdown: (markdown) => {
      responseText = markdown;
      replaceSteelResponsesMarkdown(response, markdown);
      responseMessage.text = markdown;
    },
    persistMarkdown,
    publishQuotation,
    publishMarkdown: createSteelFullMarkdownPublisher({
      saveContext: { isTemporary: req.body?.isTemporary, expiredAt: req.resolvedConversation?.expiredAt, interfaceConfig: req.config?.interfaceConfig },
      buildMessage: ({ markdown }) => ({ ...responseMessage, text: markdown }),
      savePublication: db.publishSteelMarkdown }),
    publishedResponse: {
      load: ({ userId: publishedUserId, responseId: publishedResponseId }) =>
        db.getMessage({ user: publishedUserId, messageId: publishedResponseId }),
      accept: (saved) => {
        responseMessagePersisted = true;
        persistedMessage = saved;
      },
    },
  });
  responseText = completion.markdown;
  responseMessage.text = responseText;
  if (!responseMessagePersisted) {
    await persistMarkdown();
  }
  if (!persistedMessage) {
    throw new Error('Responses API assistant response could not be persisted');
  }
}

/**
 * Save or update conversation
 * @param {import('express').Request} req
 * @param {string} conversationId
 * @param {string} agentId
 * @param {object} agent
 * @param {import('@librechat/api').ConversationCodeEnvironmentDecision} codeEnvironmentDecision
 * @returns {Promise<void>}
 */
async function saveConversation(req, conversationId, agentId, agent, codeEnvironmentDecision) {
  const title = resolveConversationTitle(req, agent?.name || 'Open Responses Conversation');
  await db.saveConvo(
    {
      userId: req?.user?.id,
      isTemporary: req?.resolvedConversation?.isTemporary ?? req?.body?.isTemporary,
      expiredAt: req?.resolvedConversation?.expiredAt,
      interfaceConfig: req?.config?.interfaceConfig,
    },
    {
      conversationId,
      endpoint: EModelEndpoint.agents,
      agent_id: agentId,
      ...resolvePersistableCodeEnvironmentDecision({
        conversationId,
        decision: codeEnvironmentDecision,
        conversation: req.resolvedConversation,
      }),
      ...(title != null && { title }),
      model: agent?.model,
    },
    {
      context: 'Responses API - save conversation',
      initialAgentId: agent?.id === agentId ? agentId : null,
    },
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
  const request = envelope.payload;
  const { principal } = envelope;
  // Request-backed tool adapters still observe the validated envelope payload;
  // shared initialization receives the transport-free runtime below.
  req.body = request;
  const requestedStore = request.store;
  const shouldStoreResponse = normalizeSteelNativeResponseStorage(request);
  req.turnStartedAt = envelope.receivedAt;
  const agentRuntime = createAgentExecutionContext({
    user: req.user,
    appConfig,
    requestBody: request,
    turnStartedAt: envelope.receivedAt,
    conversationCreatedAt: req.conversationCreatedAt,
    resolvedConversation: req.resolvedConversation,
    hasResolvedConversation: Object.prototype.hasOwnProperty.call(req, 'resolvedConversation'),
  });
  const agentId = request.model;
  const manualSkills = extractManualSkills(req.body);
  const isStreaming = request.stream === true;
  const summarizationConfig = appConfig?.summarization;

  const uninspectableField = getBlockedOpaqueFileField(appConfig?.filters, request.input);
  if (uninspectableField != null) {
    const blockResponse = contentFilterUninspectableResponse(uninspectableField);
    return sendResponsesErrorResponse(
      res,
      400,
      blockResponse.message,
      'invalid_request',
      blockResponse.error,
    );
  }

  const inputMessages = convertToInternalMessages(
    typeof request.input === 'string' ? request.input : request.input,
  );
  const messageFragments = [];
  const traversalErrors = [];
  try {
    for (const fragment of extractMessageContent(inputMessages)) {
      messageFragments.push(fragment);
    }
  } catch (error) {
    if (!isContentTraversalLimitError(error)) {
      throw error;
    }
    messageFragments.push(...getContentTraversalFragments(error));
    traversalErrors.push(error);
  }
  let requestFragments;
  try {
    requestFragments = extractResponseRequestContent(request, messageFragments);
  } catch (error) {
    if (!isContentTraversalLimitError(error)) {
      throw error;
    }
    requestFragments = getContentTraversalFragments(error);
    traversalErrors.push(error);
  }
  const contentFinding = inspectContent(
    [...requestFragments, ...(manualSkills ?? []).flatMap((name) => extractSkillContent({ name }))],
    {
      filters: appConfig?.filters,
      legacyPii: appConfig?.messageFilter?.pii,
    },
  );
  if (contentFinding != null) {
    const isLegacyFilter = contentFinding.detectorId === 'legacy-pattern';
    const blockResponse = contentFilterBlockResponse(contentFinding);
    return sendResponsesErrorResponse(
      res,
      400,
      isLegacyFilter
        ? `Message contains a ${contentFinding.label}. Remove it and try again.`
        : blockResponse.message,
      'invalid_request',
      isLegacyFilter ? 'message_filter_pii_block' : blockResponse.error,
    );
  }
  const traversalError = traversalErrors.find((error) =>
    isContentTraversalProtected({
      error,
      filters: appConfig?.filters,
      legacyPii: appConfig?.messageFilter?.pii,
      roles: inputMessages.map((message) => message?.role),
    }),
  );
  if (traversalError != null) {
    return sendResponsesErrorResponse(
      res,
      traversalError.statusCode,
      traversalError.body.message,
      'invalid_request',
      traversalError.body.error,
    );
  }

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
  const terminalRunError = createTerminalRunErrorObserver({
    maxProviderErrorChars: appConfig?.endpoints?.agents?.maxProviderErrorChars,
    logger,
    responseMessageId: responseId,
    source: '[Responses API]',
    protectionEnabled: hasModelBoundContentProtection(
      appConfig?.filters,
      appConfig?.messageFilter?.pii,
    ),
  });
  const context = createResponseContext(request, responseId);

  logger.debug(
    `[Responses API] Request ${responseId} started for agent ${agentId}, stream: ${isStreaming}`,
  );

  let conversationId = uuidv4();
  if (request.previous_response_id != null) {
    if (typeof request.previous_response_id !== 'string') {
      return sendResponsesErrorResponse(
        res,
        400,
        'previous_response_id must be a string',
        'invalid_request',
      );
    }
    let continuation;
    try {
      continuation = await resolveResponseConversation(request.previous_response_id, principal.userId);
    } catch (error) {
      terminalRunError.log(error);
      return handleExecutionError({ error, res, appConfig });
    }
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
    conversationId = continuation.conversationId;
    req.resolvedConversation = continuation.conversation;
  }
  /** @type {Promise<import('librechat-data-provider').TAttachment | null>[]} */
  const artifactPromises = [];
  let artifactWritesCovered = false;
  return executeAgentRun({
    envelope,
    runId: responseId,
    conversationId,
    connection: {
      isClosed: () => res.destroyed === true && res.writableEnded !== true,
      onClose: (listener) => {
        const abortOnResponseClose = () => {
          if (res.writableEnded !== true) {
            logger.debug('[Responses API] Client disconnected, aborting');
            listener();
          }
        };
        res.once('close', abortOnResponseClose);
        return () => res.off('close', abortOnResponseClose);
      },
    },
    /** Conversation delete-all uses the shared owner-admission fence. Remote
     * execution must observe it after durable enrollment and before provider work. */
    isPrincipalActive: db.isSubagentOwnerAdmissible,
    beforeSettle: (execution) => {
      if (!artifactWritesCovered && artifactPromises.length > 0) {
        execution.track(
          waitForAgentExecutionWrites(artifactPromises).catch((artifactError) => {
            logger.warn(
              '[Responses API] Error processing artifacts:',
              getSafeErrorMetadata(artifactError),
            );
          }),
        );
      }
    },
    onSettlementError: (error) => {
      logger.error('[Responses API] Failed to settle execution:', getSafeErrorMetadata(error));
    },
    handleExecutionError: (error, signal) => {
      terminalRunError.log(error, signal);
      return handleExecutionError({ error, res, appConfig });
    },
    execute: async (execution) => {
      if (request.previous_response_id != null) {
        if (typeof request.previous_response_id !== 'string') {
          return sendResponsesErrorResponse(
            res,
            400,
            'previous_response_id must be a string',
            'invalid_request',
          );
        }
        const previousConversation =
          req.resolvedConversation ??
          (await db.getConvo(principal.userId, request.previous_response_id));
        if (!previousConversation) {
          return sendResponsesErrorResponse(res, 404, 'Conversation not found', 'not_found');
        }
        req.resolvedConversation = previousConversation;
        if (previousConversation.subagentThread != null) {
          return sendResponsesErrorResponse(
            res,
            409,
            CHILD_THREAD_READ_ONLY_ERROR,
            'invalid_request',
            'conversation_read_only',
          );
        }
      }

      const { decision: codeEnvironmentDecision, conversation: admittedConversation } =
        await resolveAdmittedCodeEnvironmentDecision({
          appConfig,
          conversation: req.resolvedConversation,
          conversationId,
          requestedMode: request.code_environment_mode,
          requestedSelections: request.code_workspaces,
          readDecision: (id) => db.readAdmittedConvoCodeEnvironmentDecision(principal.userId, id),
        });
      req.resolvedConversation = admittedConversation;
      const parentMessageId = null;
      const mcpRequestBody = createMCPRuntimeRequestBody({
        messageId: responseId,
        conversationId,
        codeEnvironmentMode: codeEnvironmentDecision.mode,
        codeWorkspaces: codeEnvironmentDecision.codeWorkspaces,
      });
      const agentsEConfig = appConfig?.endpoints?.[EModelEndpoint.agents];
      const ordinaryToolCancellationEnabled =
        agentsEConfig?.backgroundTasks?.ordinaryToolCancellation === true;
      const backgroundCompletionResultMaxChars =
        agentsEConfig?.backgroundTasks?.completionResultMaxChars;
      const previousMessages = await prepareSteelMarkdownHistory({
        scope: { userId: principal.userId, conversationId, tenantId: principal.tenantId },
        reader: db,
        messages: request.previous_response_id ? await loadPreviousMessages(conversationId, principal.userId) : [],
      });
      if (request.previous_response_id) {
        assertModelBoundContent({
          onTraversalFailure: reportLocatorTraversalFailure,
          filters: appConfig?.filters,
          legacyPii: appConfig?.messageFilter?.pii,
          storedMessages: previousMessages,
        });
      }

      // Build allowed providers set
      const allowedProviders = new Set(agentsEConfig?.allowedProviders);

      // Create tool loader
      const loadTools = createToolLoader({ req, res, signal: execution.signal });
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
        getDeferredProvisionFiles: db.getDeferredProvisionFiles,
        checkSessionsAlive,
        loadCodeApiKey,
        getToolFilesByIds: db.getToolFilesByIds,
        getCodeGeneratedFiles: db.getCodeGeneratedFiles,
        listSkillsByAccess: skillDbMethods.listSkillsByAccess,
        listAlwaysApplySkills: skillDbMethods.listAlwaysApplySkills,
        getSkillByName: skillDbMethods.getSkillByName,
        getRoleByName: db.getRoleByName,
      };

      const enabledCapabilities = new Set(agentsEConfig?.capabilities);
      const codeCapabilityEnabled = enabledCapabilities.has(AgentCapabilities.execute_code);
      const fileSearchCapabilityEnabled = enabledCapabilities.has(AgentCapabilities.file_search);
      /** Started before the memory read rather than awaited on its own line, so
       *  the role lookup overlaps that query instead of preceding it. Skipped
       *  when the deployment has both capabilities off — both flags are false
       *  either way, so the read would be pure load on every request. One
       *  lookup answers both. */
      const toolRoleGrants =
        codeCapabilityEnabled || fileSearchCapabilityEnabled
          ? resolveToolRoleGrants({ req, getRoleByName: db.getRoleByName })
          : null;
      const memoryAvailable = await resolveMemoryAvailability({
        enabledCapabilities,
        memoryConfig: appConfig?.memory,
        user: req.user,
        getRoleByName: db.getRoleByName,
      });
      /** The deployment switch AND the role grant: `initializeAgent` rebuilds
       *  `bash_tool`, `read_file` and the workspace file tools from this flag,
       *  and forwards the code-environment context to their handlers. */
      const codeEnvAvailable = codeCapabilityEnabled && (await toolRoleGrants)?.runCode === true;
      /** The same pairing for the other gated tool, read only by the resend-file
       *  priming: `false` skips re-hydrating prior-turn `file_search` files for
       *  a tool the loader is about to drop. */
      const fileSearchAvailable =
        fileSearchCapabilityEnabled && (await toolRoleGrants)?.fileSearch === true;
      /** Called by `initializeAgent` only when an agent's built provider config
       *  turns native web search on. It reaches the initializer with `runtime`
       *  and no `req`, so this is what lets it join the grants memoized on this
       *  request instead of issuing its own read. */
      const resolveWebSearchGrant = async () =>
        (await resolveToolRoleGrants({ req, getRoleByName: db.getRoleByName })).webSearch;
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
          runtime: agentRuntime,
          loadTools,
          requestFiles: [],
          conversationId,
          parentMessageId,
          requestBody: mcpRequestBody,
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
          codeEnvAvailable,
          fileSearchAvailable,
          resolveWebSearchGrant,
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
          signal: execution.signal,
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
          signal: execution.signal,
          primaryConfig,
          endpointOption,
          allowedProviders,
          modelsConfig,
          loadTools,
          requestFiles: [],
          conversationId,
          parentMessageId,
          requestBody: mcpRequestBody,
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
          codeEnvAvailable,
          fileSearchAvailable,
          resolveWebSearchGrant,
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
      const modelBoundAgentsById = new Map();
      const pendingModelBoundAgents = [...runAgents];
      for (let index = 0; index < pendingModelBoundAgents.length; index++) {
        const runAgent = pendingModelBoundAgents[index];
        if (!runAgent?.id || modelBoundAgentsById.has(runAgent.id)) {
          continue;
        }
        modelBoundAgentsById.set(runAgent.id, runAgent);
        for (const subagent of runAgent.subagentAgentConfigs?.values?.() ?? []) {
          pendingModelBoundAgents.push(subagent);
        }
        for (const graph of runAgent.subagentGraphConfigs ?? []) {
          pendingModelBoundAgents.push(...graph.memberConfigs);
        }
      }
      const modelBoundAgents = [...modelBoundAgentsById.values()];
      const mergedMCPAuthMap = discoveredMCPAuthMap ?? primaryConfig.userMCPAuthMap;
      assertModelBoundContent({
        onTraversalFailure: reportLocatorTraversalFailure,
        filters: appConfig?.filters,
        legacyPii: appConfig?.messageFilter?.pii,
        agents: modelBoundAgents,
      });

      const agentContextAttachmentsByAgentId =
        buildAgentContextAttachmentsByAgentId(modelBoundAgents);
      const agentScopedContext = await buildAgentScopedContext({
        agentIds: modelBoundAgents.map(({ id }) => id),
        attachmentsByAgentId: agentContextAttachmentsByAgentId,
        req,
        endpoint: primaryConfig.endpoint,
        endpointsByAgentId: new Map(
          modelBoundAgents.map((runAgent) => [runAgent.id, { endpoint: runAgent.endpoint }]),
        ),
      });

      const mcpManager = getMCPManager();
      const configServers = await resolveConfigServers(req);

      // Determine if streaming is enabled (check both request and agent config)
      const streamingDisabled = !!primaryConfig.model_parameters?.disableStreaming;
      const actuallyStreaming = isStreaming && !streamingDisabled;
      const tracker = actuallyStreaming ? createResponseTracker() : null;
      const aggregator = actuallyStreaming ? null : createResponseAggregator();
      const collectedUsage = [];
      const buildQuotationMessageFields = async () => {
        const usage = buildResponsesUsage(collectedUsage);
        const langfuseTraceFields = await getLangfuseTraceMessageFields(appConfig, responseId);
        return {
          sourceMessageId: responseId,
          conversationId,
          user: principal.userId,
          parentMessageId: null,
          isCreatedByUser: false,
          unfinished: false,
          sender: 'Agent',
          endpoint: EModelEndpoint.agents,
          model: agentId,
          finish_reason: 'stop',
          tokenCount: usage.output_tokens,
          processingDurationMs: Math.max(0, Date.now() - requestStartTime),
          ...langfuseTraceFields,
          metadata: buildSteelNativeResponseMessageMetadata({
            conversationId,
            responseId,
            turnIndex: req.steelNativeContext?.assistantTurnIndex,
            checkpointTurnIndex: req.steelNativeContext?.memoryCheckpointTurnIndex,
            requestedStore: req.steelNativeContext?.requestedStore,
            store: req.steelNativeContext?.store === true,
            providerStateMode: req.steelNativeContext?.providerStateMode ?? 'openai_responses_reconstructed',
            contextMetadata: req.steelNativeContext?.contextMetadata,
            activityEvents: req.steelNativeContext?.steelHistory?.activityEvents ?? req.steelNativeContext?.steelActivityEvents,
            preflightToolCalls: req.steelNativeContext?.steelHistory?.preflightToolCalls,
          }),
        };
      };
      let streamingResponseReady = false;

      // Merge previous messages with new input
      const allMessages = [...previousMessages, ...inputMessages];
      const currentTurnFiles = collectSteelNativeInputFileReferences({
        requestInput: request.input,
        inputMessages,
        conversationId,
      });
      // A file-bearing turn needs the stream open before OCR preflight emits
      // tool events. Text-only turns defer opening it until after the second
      // model-bound content check, so a dynamic instruction block remains
      // atomic.
      if (actuallyStreaming && currentTurnFiles.length > 0) {
        setupStreamingResponse(res);
        streamingResponseReady = true;
      }
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
      const steelHistory = createSteelNativeHistory();
      req.steelNativeContext = {
        ...(req.steelNativeContext ?? {}),
        conversationId,
        requestId: responseId,
        assistantTurnIndex: allMessages.length,
        memoryCheckpointTurnIndex: Math.max(0, allMessages.length - 1),
        requestedStore,
        store: shouldStoreResponse,
        providerStateMode: 'openai_responses_reconstructed',
        currentTurnFiles,
        steelHistory,
        steelActivityEvents: steelHistory.activityEvents,
        delegateOcrContext: {
          ...(req.steelNativeContext?.delegateOcrContext ?? {}),
          currentUserTurnText: currentUserTurn?.content ?? '',
          steelConversation,
        },
      };
      const quotation = await prepareQuotationTurn({
        scope: { userId: principal.userId, conversationId, tenantId: principal.tenantId },
        messageId: currentUserTurn?.messageId ?? responseId,
        responseId,
        generationId: responseId,
        publicationStore: db,
        text: currentUserTurn?.content ?? '',
        files: currentTurnFiles,
      });
      req.steelNativeContext.quotation = {
        ...quotation,
        messageId: currentUserTurn?.messageId ?? responseId,
      };
      const delegateOcrResume =
        !quotation.resume && typeof prepareDelegateOcrResume === 'function'
          ? await prepareDelegateOcrResume({
              req,
              conversationId,
              triggeringMessageId: currentUserTurn?.messageId,
              userId: principal.userId,
            })
          : undefined;
      let paddleOcrPreflight;
      if (quotation.resume) {
        paddleOcrPreflight = { ocrTurnActive: false };
      } else if (delegateOcrResume) {
        paddleOcrPreflight = { ocrTurnActive: false, delegateOcrResume: true };
      } else {
        paddleOcrPreflight = await runSteelPaddleOcrPreflight({
          req,
          res,
          agent: primaryConfig,
          signal: execution.signal,
          streamId: req._resumableStreamId || null,
          userMCPAuthMap: mergedMCPAuthMap,
        });
      }
      const ocrTurnActive = paddleOcrPreflight?.ocrTurnActive === true;
      req.steelNativeContext = {
        ...(req.steelNativeContext ?? {}),
        paddleOcrPreflight,
        ocrTurnActive,
        delegateOcrResume,
      };
      const delegateOcrPolicy = delegateOcrResume
        ? { resolved: true, allowed: false, allowedFileKeys: [], reason: 'delegate_ocr_resume' }
        : await resolveDelegateOcrPolicyForRequest({
            req,
            currentUserTurn: currentUserTurn?.content ?? '',
            ocrTurnActive,
          });
      req.steelNativeContext.delegateOcrPolicy = delegateOcrPolicy;
      for (const runAgent of runAgents) {
        Object.assign(
          runAgent,
          prepareSteelNativeToolConfig(runAgent, {
            quotationRole: 'preparation',
            hasQuotationOrder: hasQuotationOrder(quotation.state?.currentOrder?.markdown),
            ocrTurnActive,
            delegateOcrPolicy: delegateOcrResume
              ? { resolved: true, allowed: false, allowedFileKeys: [], reason: 'delegate_ocr_resume' }
              : delegateOcrPolicy,
          }),
        );
      }
      // Keep each request-scoped tool context in step with its agent config.
      // Delegate resume policy filtering is applied to the registry as well as
      // the serialized agent definition, so a resumed run cannot re-enable a
      // hidden delegate tool through the loader context.
      for (const toolContext of agentToolContexts.values()) {
        if (toolContext?.agent) {
          Object.assign(
            toolContext.agent,
            prepareSteelNativeToolConfig(toolContext.agent, {
              quotationRole: 'preparation',
              hasQuotationOrder: hasQuotationOrder(quotation.state?.currentOrder?.markdown),
              ocrTurnActive,
              delegateOcrPolicy,
            }),
          );
        }
        if (toolContext) {
          Object.assign(
            toolContext,
            prepareSteelNativeToolConfig(toolContext, {
              quotationRole: 'preparation',
              hasQuotationOrder: hasQuotationOrder(quotation.state?.currentOrder?.markdown),
              ocrTurnActive,
              delegateOcrPolicy,
            }),
          );
        }
      }

      const attachments = {};
      if (ocrTurnActive) {
        if (paddleOcrPreflight?.currentOcrMarkdownResults?.length > 0) {
          attachments.currentOcrMarkdownResults = paddleOcrPreflight.currentOcrMarkdownResults;
        }
        if (paddleOcrPreflight?.currentOcrSourceFileMapping?.length > 0) {
          attachments.currentOcrSourceFileMapping = paddleOcrPreflight.currentOcrSourceFileMapping;
        }
        if (typeof paddleOcrPreflight?.previousOcrResultMarkdown === 'string') {
          attachments.previousOcrResultMarkdown = paddleOcrPreflight.previousOcrResultMarkdown;
        }
      } else if (currentTurnFiles.length > 0) {
        attachments.currentTurnFiles = currentTurnFiles;
      }
      const steelNativeContext = await buildDefaultSteelGlobalAgentContext({
        conversation: steelConversation,
        ...(Object.keys(attachments).length > 0 && { attachments }),
        renderProfile: 'open_responses',
        mode: ocrTurnActive ? 'ocr' : 'standard',
      });
      req.steelNativeContext.contextMetadata = steelNativeContext.metadata;
      await Promise.all(
        modelBoundAgents.map(async (runAgent) => {
          const memoryContext = await buildInlineMemoryContext({
            agent: runAgent,
            req,
            userId: principal.userId,
            memoryAvailable,
            getFormattedMemories: db.getFormattedMemories,
          });
          return applyContextToAgent({
            agent: runAgent,
            agentId: runAgent.id,
            logger,
            mcpManager,
            configServers,
            globalInstructionPrefix: steelNativeContext.instructionPrefix,
            sharedRunContext: buildSharedRunContextWithSteel(
              memoryContext,
              agentScopedContext.get(runAgent.id),
              [steelNativeContext.runtimeContextText, !ocrTurnActive && quotation.instruction]
                .filter(Boolean)
                .join('\n\n'),
            ),
          });
        }),
      );
      assertModelBoundContent({
        onTraversalFailure: reportLocatorTraversalFailure,
        filters: appConfig?.filters,
        legacyPii: appConfig?.messageFilter?.pii,
        submittedMessages: inputMessages,
        agents: modelBoundAgents,
        skills: [
          ...(primaryConfig.manualSkillPrimes ?? []),
          ...(primaryConfig.alwaysApplySkillPrimes ?? []),
        ],
        files: collectModelBoundAgentFiles(modelBoundAgents),
      });
      if (actuallyStreaming && !streamingResponseReady) {
        setupStreamingResponse(res);
        streamingResponseReady = true;
      }

      /** The caller's function tools: declared to the model with no server-side
       *  executor, handed back when the model calls one, and reported on the
       *  response as the subset that was actually applied.
       *
       *  Built once every agent of the run is known, because the interception
       *  matches on tool name across the whole graph: a name a subagent owns
       *  collides exactly as a primary one does. */
      const clientTools = createClientToolHandoff({
        tools: request.tools,
        agentDefinitions: primaryConfig.toolDefinitions,
        serverDefinitions: modelBoundAgents.flatMap((runAgent) => runAgent.toolDefinitions ?? []),
        responseId,
      });
      if (clientTools.error != null) {
        return sendResponsesErrorResponse(res, 400, clientTools.error, 'invalid_request');
      }
      primaryConfig.toolDefinitions = clientTools.toolDefinitions;
      context.tools = clientTools.appliedTools;

      const toolSet = buildRunToolSet(
        primaryConfig,
        handoffAgentConfigs.values(),
        undefined,
        allMessages,
        true,
      );
      const formatted = formatAgentMessages(
        stripUnusableSummaryParts(stripActivityLabelParts(allMessages)),
        {},
        toolSet,
      );
      const formattedMessages = formatted.messages;
      let providerMessages;
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
      providerMessages = stripSteelOcrPartsFromProviderMessages(formattedMessages, currentTurnFiles);
      req.steelNativeContext.delegateOcrContext = {
        ...(req.steelNativeContext.delegateOcrContext ?? {}),
        history: formattedMessages,
        steelConversation,
      };

      /* Stable for the turn: the primary prime list is fixed once
       `initializeAgent` resolves and is used as the fallback when a
       specific agent context is unavailable. `codeEnvAvailable` is read
       per-agent from the stored tool context (admin cap AND that
       agent's `tools` list includes `execute_code`) — a skills-only
       agent never gains sandbox access even if the admin enabled the
       capability globally. */
      // Set up response for streaming
      if (actuallyStreaming) {
        if (!streamingResponseReady) {
          setupStreamingResponse(res);
        }

        // Create handler config
        const handlerConfig = {
          res,
          context,
          tracker,
          /* The run terminates a caller-executed call's item itself: the server
             never executes one, so `on_tool_end` cannot. */
          clientToolNames: clientTools.clientToolNames,
        };

        // Emit response.created then response.in_progress per Open Responses spec
        emitResponseCreated(handlerConfig);
        emitResponseInProgress(handlerConfig);

        // Create event handlers
        const {
          handlers: responsesHandlers,
          finalizeStream,
          emitClientToolDeferral,
        } = createResponsesEventHandlers(handlerConfig);

        // Collect usage for balance tracking
        // Artifact promises for processing tool outputs
        // Use Responses API-specific callback that emits librechat:attachment events
        const toolEndCallback = createResponsesToolEndCallback({
          req,
          res,
          tracker,
          artifactPromises,
        });

        // Create tool execute options for event-driven tool execution
        const toolExecuteOptions = {
          runSignal: execution.signal,
          foregroundRunId: responseId,
          ordinaryToolCancellation: ordinaryToolCancellationEnabled,
          backgroundCompletionResultMaxChars,
          provisionFiles: createProvisionFilesCallback({
            req,
            agentToolContexts,
            resolvePrimaryAgentId: () => primaryConfig.id,
          }),
          loadTools: async (
            toolNames,
            agentId,
            _configurable,
            callerCapabilityProjection,
            runSignal,
          ) => {
            const ctx =
              agentToolContexts.get(agentId) ?? agentToolContexts.get(primaryConfig.id) ?? {};
            const result = await loadToolsForExecution({
              req,
              res,
              agentResourceType: ResourceType.REMOTE_AGENT,
              conversationId,
              requestBody: mcpRequestBody,
              toolNames,
              agent: ctx.agent ?? agent,
              signal: runSignal,
              toolRegistry: ctx.toolRegistry,
              callerCapabilityProjection,
              backgroundToolNames: ctx.backgroundToolNames,
              intentToolNames: ctx.intentToolNames,
              mcpAvailableTools: ctx.mcpAvailableTools,
              requestScopedConnections: ctx.requestScopedConnections,
              userMCPAuthMap: ctx.userMCPAuthMap,
              tool_resources: ctx.tool_resources,
              actionsEnabled: ctx.actionsEnabled,
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
          on_run_step: clientTools.wrapRunStep(responsesHandlers.on_run_step),
          on_run_step_delta: responsesHandlers.on_run_step_delta,
          on_chat_model_end: {
            handle: (event, data, metadata, graph) => {
              responsesHandlers.on_chat_model_end.handle(event, data);
              const usage = data?.output?.usage_metadata;
              if (usage) {
                const agentContext = graph?.getAgentContext?.(metadata);
                const taggedUsage = contextualizeModelUsage(usage, metadata, agentContext);
                collectedUsage.push(taggedUsage);
              }
            },
          },
          on_tool_end: createOwnedToolEndHandler(toolEndCallback, logger),
          on_run_step_completed: { handle: () => {} },
          on_chain_stream: { handle: () => {} },
          on_chain_end: { handle: () => {} },
          on_agent_update: { handle: () => {} },
          on_custom_event: { handle: () => {} },
          [delegateOcrStreamEventName]: createDelegateOcrStreamHandler(),
          /** The deferral answer is emitted as the call's `function_call_output`,
           *  so a caller can tell an answered call from one handed back to it. */
          on_tool_execute: clientTools.wrapToolExecute(
            createToolExecuteHandler(toolExecuteOptions),
            emitClientToolDeferral,
          ),
          on_agent_log: agentLogHandlerObj,
          ...(summarizationConfig?.enabled !== false
            ? buildSummarizationHandlers({ isStreaming: actuallyStreaming, res })
            : {}),
        };

        // Create and run the agent
        const userId = principal.userId;
        const userMCPAuthMap = mergedMCPAuthMap;

        const run = await createRun({
          oauthCompactionStore: db,
          agents: runAgents,
          messages: providerMessages,
          indexTokenCountMap,
          initialSummary,
          runId: responseId,
          summarizationConfig,
          appConfig,
          signal: execution.signal,
          customHandlers: handlers,
          delegateOcrPolicy: req.steelNativeContext.delegateOcrPolicy,
          openAIOAuthModelOptionsSink: (modelOptions) => {
            req.steelNativeContext.delegateOcrContext.modelOptions = modelOptions;
          },
          initialSessions,
          requestBody: mcpRequestBody,
          user: { ...createSafeUser(req.user), id: userId },
          traceContext: { endpoint: EModelEndpoint.agents },
          tenantId: principal.tenantId,
          modelCallbacks: [terminalRunError.modelCallback],
          clientToolNames: clientTools.clientToolNames,
          /** Bills subagent child-run model calls (reported outside the
           *  streamEvents loop) into the same collectedUsage array. */
          subagentUsageSink: createSubagentUsageSink(collectedUsage),
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
            requestBody: mcpRequestBody,
            ...(userMCPAuthMap != null && { userMCPAuthMap }),
          },
          recursionLimit: resolveRecursionLimit(agentsEConfig, agent),
          signal: execution.signal,
          streamMode: 'values',
          version: 'v2',
        };

        const executeQuotation = () => {
          const buildPublicationMessage = createSteelQuotationPublicationMessageBuilder({
            tracker,
            aggregator,
            buildMessageFields: buildQuotationMessageFields,
          });
          return executeSteelQuotationWorkflow({
            req,
            res,
            signal: execution.signal,
            agent: primaryConfig,
            run,
            userMCPAuthMap,
            requestScopedConnections: agentToolContexts.get(primaryConfig.id)
              ?.requestScopedConnections,
            onUsage: async (usage) => collectedUsage.push(usage),
            onText: async (text) =>
              handlers.on_message_delta.handle('on_message_delta', {
                id: `quotation:${responseId}`,
                delta: { content: [{ type: 'text', text }] },
              }),
            buildPublicationMessage,
          });
        };
        if (req.steelNativeContext?.quotation?.resume) {
          await executeQuotation();
        } else if (delegateOcrResume) {
          await runPreparedResponsesDelegateOcr({
            req,
            res,
            signal: execution.signal,
            agent: primaryConfig,
            resume: delegateOcrResume,
            responseId,
            messageDeltaHandler: handlers.on_message_delta,
          });
        } else {
          await run.processStream({ messages: providerMessages }, config, {
            callbacks: {
              [Callback.TOOL_ERROR]: (graph, error, toolId) => {
                logger.error(`[Responses API] Tool Error "${toolId}"`, getSafeErrorMetadata(error));
              },
            },
          });
          await executeQuotation();
        }

        // Record token usage against balance
        const balanceConfig = getBalanceConfig(appConfig);
        const transactionsConfig = getTransactionsConfig(appConfig);
        execution.track(
          recordCollectedUsage(
            {
              spendTokens: db.spendTokens,
              spendStructuredTokens: db.spendStructuredTokens,
              pricing: {
                getMultiplier: db.getMultiplier,
                getCacheMultiplier: db.getCacheMultiplier,
              },
              bulkWriteOps: {
                insertMany: db.bulkInsertTransactions,
                updateBalance: db.updateBalance,
              },
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
            logger.error('[Responses API] Error recording usage:', getSafeErrorMetadata(err));
          }),
        );

        const usage = buildResponsesUsage(collectedUsage);

        materializeResponsesTrackerText(tracker);
        const finalResponse = markSteelNativeResponseStored(
          buildResponse(context, tracker, 'completed'),
        );
        await finalizeSteelResponsesTurn({
          req, response: finalResponse, responseId, store: shouldStoreResponse,
          saveConversation: () => saveConversation(req, conversationId, agentId, agent, codeEnvironmentDecision),
          saveInput: () => saveInputMessages(req, conversationId, inputMessages, agentId),
          saveOutput: () => saveResponseOutput(req, conversationId, responseId, finalResponse, agentId, Math.max(0, Date.now() - requestStartTime)),
          onPersistenceFailure: () => logger.error('[Responses API] Could not save ordinary response'),
          tracker, streamConfig: handlerConfig,
        });
        finalizeStream(usage);
        res.end();

        const duration = Date.now() - requestStartTime;
        logger.debug(
          `[Responses API] Request ${responseId} completed in ${duration}ms (streaming)`,
        );

        // The HTTP response is complete, while destructive cleanup still waits for artifacts.
        if (artifactPromises.length > 0) {
          execution.track(
            waitForAgentExecutionWrites(artifactPromises).catch((artifactError) => {
              logger.warn(
                '[Responses API] Error processing artifacts:',
                getSafeErrorMetadata(artifactError),
              );
            }),
          );
          artifactWritesCovered = true;
        }
      } else {
        const aggregatorHandlers = createAggregatorEventHandlers(aggregator);

        // Collect usage for balance tracking
        const toolEndCallback = createToolEndCallback({
          req,
          res,
          artifactPromises,
          streamId: null,
        });

        const toolExecuteOptions = {
          runSignal: execution.signal,
          foregroundRunId: responseId,
          ordinaryToolCancellation: ordinaryToolCancellationEnabled,
          backgroundCompletionResultMaxChars,
          provisionFiles: createProvisionFilesCallback({
            req,
            agentToolContexts,
            resolvePrimaryAgentId: () => primaryConfig.id,
          }),
          loadTools: async (
            toolNames,
            agentId,
            _configurable,
            callerCapabilityProjection,
            runSignal,
          ) => {
            const ctx =
              agentToolContexts.get(agentId) ?? agentToolContexts.get(primaryConfig.id) ?? {};
            const result = await loadToolsForExecution({
              req,
              res,
              agentResourceType: ResourceType.REMOTE_AGENT,
              conversationId,
              requestBody: mcpRequestBody,
              toolNames,
              agent: ctx.agent ?? agent,
              signal: runSignal,
              toolRegistry: ctx.toolRegistry,
              callerCapabilityProjection,
              backgroundToolNames: ctx.backgroundToolNames,
              intentToolNames: ctx.intentToolNames,
              mcpAvailableTools: ctx.mcpAvailableTools,
              requestScopedConnections: ctx.requestScopedConnections,
              userMCPAuthMap: ctx.userMCPAuthMap,
              tool_resources: ctx.tool_resources,
              actionsEnabled: ctx.actionsEnabled,
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
          on_run_step: clientTools.wrapRunStep(aggregatorHandlers.on_run_step),
          on_run_step_delta: aggregatorHandlers.on_run_step_delta,
          on_chat_model_end: {
            handle: (event, data, metadata, graph) => {
              aggregatorHandlers.on_chat_model_end.handle(event, data);
              const usage = data?.output?.usage_metadata;
              if (usage) {
                const agentContext = graph?.getAgentContext?.(metadata);
                const taggedUsage = contextualizeModelUsage(usage, metadata, agentContext);
                collectedUsage.push(taggedUsage);
              }
            },
          },
          on_tool_end: createOwnedToolEndHandler(toolEndCallback, logger),
          on_run_step_completed: { handle: () => {} },
          on_chain_stream: { handle: () => {} },
          on_chain_end: { handle: () => {} },
          on_agent_update: { handle: () => {} },
          on_custom_event: { handle: () => {} },
          [delegateOcrStreamEventName]: createDelegateOcrStreamHandler(),
          on_tool_execute: clientTools.wrapToolExecute(
            createToolExecuteHandler(toolExecuteOptions),
            (callId, output) => aggregator.toolOutputs.set(callId, output),
          ),
          on_agent_log: agentLogHandlerObj,
          ...(summarizationConfig?.enabled !== false
            ? buildSummarizationHandlers({ isStreaming: false, res })
            : {}),
        };

        const userId = principal.userId;
        const userMCPAuthMap = mergedMCPAuthMap;

        const run = await createRun({
          oauthCompactionStore: db,
          agents: runAgents,
          messages: providerMessages,
          indexTokenCountMap,
          initialSummary,
          runId: responseId,
          summarizationConfig,
          appConfig,
          signal: execution.signal,
          customHandlers: handlers,
          delegateOcrPolicy: req.steelNativeContext.delegateOcrPolicy,
          openAIOAuthModelOptionsSink: (modelOptions) => {
            req.steelNativeContext.delegateOcrContext.modelOptions = modelOptions;
          },
          initialSessions,
          requestBody: mcpRequestBody,
          user: { ...createSafeUser(req.user), id: userId },
          traceContext: { endpoint: EModelEndpoint.agents },
          tenantId: principal.tenantId,
          modelCallbacks: [terminalRunError.modelCallback],
          clientToolNames: clientTools.clientToolNames,
          /** Bills subagent child-run model calls (reported outside the
           *  streamEvents loop) into the same collectedUsage array. */
          subagentUsageSink: createSubagentUsageSink(collectedUsage),
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
            requestBody: mcpRequestBody,
            ...(userMCPAuthMap != null && { userMCPAuthMap }),
          },
          recursionLimit: resolveRecursionLimit(agentsEConfig, agent),
          signal: execution.signal,
          streamMode: 'values',
          version: 'v2',
        };

        const executeQuotation = () => {
          const buildPublicationMessage = createSteelQuotationPublicationMessageBuilder({
            tracker,
            aggregator,
            buildMessageFields: buildQuotationMessageFields,
          });
          return executeSteelQuotationWorkflow({
            req,
            res,
            signal: execution.signal,
            agent: primaryConfig,
            run,
            userMCPAuthMap,
            requestScopedConnections: agentToolContexts.get(primaryConfig.id)
              ?.requestScopedConnections,
            onUsage: async (usage) => collectedUsage.push(usage),
            onText: async (text) =>
              handlers.on_message_delta.handle('on_message_delta', {
                id: `quotation:${responseId}`,
                delta: { content: [{ type: 'text', text }] },
              }),
            buildPublicationMessage,
          });
        };
        if (req.steelNativeContext?.quotation?.resume) {
          await executeQuotation();
        } else if (delegateOcrResume) {
          await runPreparedResponsesDelegateOcr({
            req,
            res,
            signal: execution.signal,
            agent: primaryConfig,
            resume: delegateOcrResume,
            responseId,
            messageDeltaHandler: handlers.on_message_delta,
          });
        } else {
          await run.processStream({ messages: providerMessages }, config, {
            callbacks: {
              [Callback.TOOL_ERROR]: (graph, error, toolId) => {
                logger.error(`[Responses API] Tool Error "${toolId}"`, getSafeErrorMetadata(error));
              },
            },
          });
          await executeQuotation();
        }

        // Record token usage against balance
        const balanceConfig = getBalanceConfig(appConfig);
        const transactionsConfig = getTransactionsConfig(appConfig);
        execution.track(
          recordCollectedUsage(
            {
              spendTokens: db.spendTokens,
              spendStructuredTokens: db.spendStructuredTokens,
              pricing: {
                getMultiplier: db.getMultiplier,
                getCacheMultiplier: db.getCacheMultiplier,
              },
              bulkWriteOps: {
                insertMany: db.bulkInsertTransactions,
                updateBalance: db.updateBalance,
              },
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
            logger.error('[Responses API] Error recording usage:', getSafeErrorMetadata(err));
          }),
        );

        if (artifactPromises.length > 0) {
          try {
            await waitForAgentExecutionWrites(artifactPromises);
          } catch (artifactError) {
            logger.warn(
              '[Responses API] Error processing artifacts:',
              getSafeErrorMetadata(artifactError),
            );
          }
          artifactWritesCovered = true;
        }

        const response = markSteelNativeResponseStored(buildAggregatedResponse(
          context,
          aggregator,
          buildResponsesUsage(collectedUsage),
        ));

        await finalizeSteelResponsesTurn({
          req, response, responseId, store: shouldStoreResponse,
          saveConversation: () => saveConversation(req, conversationId, agentId, agent, codeEnvironmentDecision),
          saveInput: () => saveInputMessages(req, conversationId, inputMessages, agentId),
          saveOutput: () => saveResponseOutput(req, conversationId, responseId, response, agentId, Math.max(0, Date.now() - requestStartTime)),
          onPersistenceFailure: () => logger.error('[Responses API] Could not save ordinary response'),
        });

        res.json(response);

        const duration = Date.now() - requestStartTime;
        logger.debug(
          `[Responses API] Request ${responseId} completed in ${duration}ms (non-streaming)`,
        );
      }
    },
  });
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
      principal: req.tenantId == null ? req.user : { ...req.user, tenantId: req.tenantId },
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
    logger.error('[Responses API] Error listing models:', getSafeErrorMetadata(error));
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
    logger.error('[Responses API] Error getting response:', getSafeErrorMetadata(error));
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
