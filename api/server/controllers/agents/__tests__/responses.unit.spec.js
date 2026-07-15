/**
 * Unit tests for Open Responses API controller
 * Tests that recordCollectedUsage is called correctly for token spending
 */

const mockSpendTokens = jest.fn().mockResolvedValue({});
const mockSpendStructuredTokens = jest.fn().mockResolvedValue({});
const mockRecordCollectedUsage = jest
  .fn()
  .mockResolvedValue({ input_tokens: 100, output_tokens: 50 });
const mockGetBalanceConfig = jest.fn().mockReturnValue({ enabled: true });
const mockGetTransactionsConfig = jest.fn().mockReturnValue({ enabled: true });
const mockBuildSkillPrimedIdsByName = jest.fn((manualSkillPrimes, alwaysApplySkillPrimes) => {
  const primed = {};
  for (const skill of alwaysApplySkillPrimes ?? []) {
    primed[skill.name] = skill._id.toString();
  }
  for (const skill of manualSkillPrimes ?? []) {
    primed[skill.name] = skill._id.toString();
  }
  return Object.keys(primed).length > 0 ? primed : undefined;
});
const mockEnrichWithSkillConfigurable = jest.fn((result) => result);
const mockBuildAgentToolContext = jest.fn(({ agent, config }) => ({
  agent,
  toolRegistry: config.toolRegistry,
  userMCPAuthMap: config.userMCPAuthMap,
  tool_resources: config.tool_resources,
  actionsEnabled: config.actionsEnabled,
  accessibleSkillIds: config.accessibleSkillIds,
  activeSkillNames: config.activeSkillNames,
  codeEnvAvailable: config.codeEnvAvailable,
  skillAuthoringAvailable: config.skillAuthoringAvailable,
  fileAuthoringToolNames: config.fileAuthoringToolNames,
  skillPrimedIdsByName:
    mockBuildSkillPrimedIdsByName(config.manualSkillPrimes, config.alwaysApplySkillPrimes) ?? {},
}));
const mockEnrichLoadedToolsWithAgentContext = jest.fn(({ result, req, ctx }) =>
  mockEnrichWithSkillConfigurable({
    result,
    context: {
      req,
      accessibleSkillIds: ctx.accessibleSkillIds,
      codeEnvAvailable: ctx.codeEnvAvailable === true,
      skillPrimedIdsByName: ctx.skillPrimedIdsByName,
      activeSkillNames: ctx.activeSkillNames,
      skillAuthoringAvailable: ctx.skillAuthoringAvailable === true,
      fileAuthoringToolNames: ctx.fileAuthoringToolNames,
    },
  }),
);
const mockCanAuthorSkillFiles = jest.fn(
  ({ scopedEditableSkillIds = [], skillCreateAllowed }) =>
    scopedEditableSkillIds.length > 0 || skillCreateAllowed === true,
);
const mockGetSkillToolDeps = jest.fn(() => ({}));
const mockBuildAgentScopedContext = jest.fn().mockResolvedValue(new Map());
const mockBuildAgentContextAttachmentsByAgentId = jest.fn().mockReturnValue(new Map());
const mockApplyContextToAgent = jest.fn().mockResolvedValue(undefined);
const mockSteelNativeContext = {
  instructionPrefix: 'Steel global prefix',
  runtimeContextText: 'Steel runtime tail',
  metadata: {
    nativeContextVersion: 1,
    mode: 'standard',
    renderProfile: 'open_responses',
    globalApplied: true,
  },
};
const mockBuildDefaultSteelGlobalAgentContext = jest.fn().mockResolvedValue(mockSteelNativeContext);
const mockExtractSteelNativeMarkdownText = jest.fn(({ content }) => {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (!part || typeof part !== 'object') {
        return '';
      }
      if (typeof part.text === 'string') {
        return part.text;
      }
      return typeof part.text?.value === 'string' ? part.text.value : '';
    })
    .filter(Boolean)
    .join('');
});
const mockExtractSteelNativeResponseOutputText = jest.fn((response) =>
  (response?.output ?? [])
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join(''),
);
const mockPrepareLibreChatSteelChatContext = jest.fn((conversation) => {
  const currentUserTurn = conversation.currentUserTurn
    ? { ...conversation.currentUserTurn, content: '' }
    : undefined;
  return {
    ...conversation,
    activeHistory: conversation.activeHistory
      .filter((message) => {
        if (!conversation.currentUserTurn) {
          return true;
        }
        if (message.messageId && conversation.currentUserTurn.messageId) {
          return message.messageId !== conversation.currentUserTurn.messageId;
        }
        return (
          message.role !== conversation.currentUserTurn.role ||
          message.content !== conversation.currentUserTurn.content
        );
      })
      .map((message) => ({ ...message, content: '' })),
    ...(currentUserTurn ? { currentUserTurn } : {}),
  };
});
const mockBuildSteelNativeResponseMessageMetadata = jest.fn().mockReturnValue({
  steel: {
    native: {
      ingress: 'open_responses',
      renderProfile: 'open_responses',
    },
  },
});
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-nanoid-123'),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-456'),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@librechat/agents', () => ({
  Callback: { TOOL_ERROR: 'TOOL_ERROR' },
  ToolEndHandler: jest.fn(),
  formatAgentMessages: jest.fn().mockReturnValue({
    messages: [],
    indexTokenCountMap: {},
  }),
}));

jest.mock('@librechat/api', () => ({
  createRun: jest.fn().mockResolvedValue({
    processStream: jest.fn().mockResolvedValue(undefined),
  }),
  applyContextToAgent: (...args) => mockApplyContextToAgent(...args),
  stripPaddleOcrToolsForMainAgent: (config) => config,
  stripSteelToolsForOcrTurn: jest.fn((config) => config),
  stripSteelOcrPartsFromProviderMessages: (messages) => [...messages],
  buildDefaultSteelGlobalAgentContext: mockBuildDefaultSteelGlobalAgentContext,
  prepareLibreChatSteelChatContext: (...args) => mockPrepareLibreChatSteelChatContext(...args),
  extractSteelNativeMarkdownText: (...args) => mockExtractSteelNativeMarkdownText(...args),
  extractSteelNativeResponseOutputText: (...args) =>
    mockExtractSteelNativeResponseOutputText(...args),
  buildSteelNativeResponseMessageMetadata: (...args) =>
    mockBuildSteelNativeResponseMessageMetadata(...args),
  buildToolSet: jest.fn().mockReturnValue(new Set()),
  buildAgentScopedContext: (...args) => mockBuildAgentScopedContext(...args),
  buildAgentContextAttachmentsByAgentId: (...args) =>
    mockBuildAgentContextAttachmentsByAgentId(...args),
  scopeSkillIds: jest.fn().mockImplementation((ids) => ids),
  resolveAgentScopedSkillIds: jest
    .fn()
    .mockImplementation(({ accessibleSkillIds }) => accessibleSkillIds),
  loadSkillStates: jest.fn().mockResolvedValue({ skillStates: {}, defaultActiveOnShare: false }),
  createSafeUser: jest.fn().mockReturnValue({ id: 'user-123' }),
  initializeAgent: jest.fn().mockResolvedValue({
    id: 'agent-123',
    model: 'claude-3',
    model_parameters: {},
    toolRegistry: {},
    edges: [],
    agentContextAttachments: [],
  }),
  discoverConnectedAgents: jest.fn().mockImplementation(async (computedParams, deps) => {
    // Call onAgentInitialized for each agent config if provided by the mock setup
    if (deps?.onAgentInitialized && mockGlobalDiscoveredAgentConfigs) {
      for (const [agentId, config] of mockGlobalDiscoveredAgentConfigs) {
        deps.onAgentInitialized(agentId, config, config);
      }
    }
    return {
      agentConfigs: mockGlobalDiscoveredAgentConfigs ?? new Map(),
      edges: [],
      skippedAgentIds: new Set(),
      userMCPAuthMap: undefined,
    };
  }),
  getBalanceConfig: mockGetBalanceConfig,
  getTransactionsConfig: mockGetTransactionsConfig,
  recordCollectedUsage: mockRecordCollectedUsage,
  createSubagentUsageSink: jest.fn().mockReturnValue(jest.fn()),
  extractManualSkills: jest.fn().mockReturnValue(undefined),
  injectSkillPrimes: jest.fn().mockReturnValue({
    initialMessages: [],
    indexTokenCountMap: {},
    inserted: 0,
    insertIdx: -1,
    alwaysApplyDropped: 0,
    alwaysApplyDedupedFromManual: 0,
  }),
  createToolExecuteHandler: jest.fn().mockReturnValue({ handle: jest.fn() }),
  // Responses API
  writeDone: jest.fn(),
  buildResponse: jest.fn().mockReturnValue({ id: 'resp_123', output: [] }),
  generateResponseId: jest.fn().mockReturnValue('resp_mock-123'),
  isValidationFailure: jest.fn().mockReturnValue(false),
  findPiiMatchInMessages: jest.fn().mockReturnValue(null),
  emitResponseCreated: jest.fn(),
  createResponseContext: jest.fn().mockReturnValue({ responseId: 'resp_123' }),
  createResponseTracker: jest.fn().mockReturnValue({
    usage: { promptTokens: 100, completionTokens: 50 },
  }),
  setupStreamingResponse: jest.fn(),
  emitResponseInProgress: jest.fn(),
  convertInputToMessages: jest.fn().mockReturnValue([]),
  validateResponseRequest: jest.fn().mockReturnValue({
    request: { model: 'agent-123', input: 'Hello', stream: false },
  }),
  buildAggregatedResponse: jest.fn().mockReturnValue({
    id: 'resp_123',
    status: 'completed',
    output: [],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }),
  createResponseAggregator: jest.fn().mockReturnValue({
    usage: { promptTokens: 100, completionTokens: 50 },
  }),
  sendResponsesErrorResponse: jest.fn(),
  createResponsesEventHandlers: jest.fn().mockReturnValue({
    handlers: {
      on_message_delta: { handle: jest.fn() },
      on_reasoning_delta: { handle: jest.fn() },
      on_run_step: { handle: jest.fn() },
      on_run_step_delta: { handle: jest.fn() },
      on_chat_model_end: { handle: jest.fn() },
    },
    finalizeStream: jest.fn(),
  }),
  createAggregatorEventHandlers: jest.fn().mockReturnValue({
    on_message_delta: { handle: jest.fn() },
    on_reasoning_delta: { handle: jest.fn() },
    on_run_step: { handle: jest.fn() },
    on_run_step_delta: { handle: jest.fn() },
    on_chat_model_end: { handle: jest.fn() },
  }),
}));

jest.mock('~/server/services/ToolService', () => ({
  loadAgentTools: jest.fn().mockResolvedValue([]),
  loadToolsForExecution: jest.fn().mockResolvedValue([]),
  runSteelPaddleOcrPreflight: jest.fn().mockResolvedValue({
    status: 'skipped',
    completedKeys: [],
    attemptedKeys: [],
    failedKeys: [],
    skippedReason: 'no_current_files',
    currentPaddleOcrResults: [],
    currentOcrMarkdownResults: [],
  }),
}));

const mockGetMultiplier = jest.fn().mockReturnValue(1);
const mockGetCacheMultiplier = jest.fn().mockReturnValue(null);

jest.mock('~/server/controllers/agents/callbacks', () => {
  const noop = { handle: jest.fn() };
  return {
    createToolEndCallback: jest.fn().mockReturnValue(jest.fn()),
    createResponsesToolEndCallback: jest.fn().mockReturnValue(jest.fn()),
    markSummarizationUsage: jest.fn().mockImplementation((usage) => usage),
    agentLogHandlerObj: noop,
    buildSummarizationHandlers: jest.fn().mockReturnValue({
      on_summarize_start: noop,
      on_summarize_delta: noop,
      on_summarize_complete: noop,
    }),
  };
});

jest.mock('~/server/services/PermissionService', () => ({
  findAccessibleResources: jest.fn().mockResolvedValue([]),
  checkPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/server/services/MCP', () => ({
  resolveConfigServers: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/config', () => ({
  getMCPManager: jest.fn().mockReturnValue({}),
}));

jest.mock('~/server/services/Files/permissions', () => ({
  filterFilesByAgentAccess: jest.fn(),
}));

jest.mock('~/server/services/Endpoints/agents/skillDeps', () => ({
  getSkillToolDeps: mockGetSkillToolDeps,
  getSkillDbMethods: jest.fn(() => ({})),
  canAuthorSkillFiles: mockCanAuthorSkillFiles,
  withDeploymentSkillIds: jest.fn((ids = []) => ids),
  enrichWithSkillConfigurable: mockEnrichWithSkillConfigurable,
  buildSkillPrimedIdsByName: mockBuildSkillPrimedIdsByName,
  buildAgentToolContext: mockBuildAgentToolContext,
  enrichLoadedToolsWithAgentContext: mockEnrichLoadedToolsWithAgentContext,
}));

jest.mock('~/cache', () => ({
  logViolation: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn().mockReturnValue({}),
}));

jest.mock('~/server/services/Files/Code/crud', () => ({
  batchUploadCodeEnvFiles: jest.fn().mockResolvedValue({ session_id: '', files: [] }),
}));

jest.mock('~/server/services/Files/Code/process', () => ({
  getSessionInfo: jest.fn().mockResolvedValue(null),
  checkIfActive: jest.fn().mockReturnValue(false),
}));

const mockUpdateBalance = jest.fn().mockResolvedValue({});
const mockBulkInsertTransactions = jest.fn().mockResolvedValue(undefined);

jest.mock('~/models', () => ({
  getAgent: jest.fn().mockResolvedValue({ id: 'agent-123', name: 'Test Agent' }),
  getFiles: jest.fn(),
  getUserKey: jest.fn(),
  getMessages: jest.fn().mockResolvedValue([]),
  getMessage: jest.fn().mockResolvedValue(null),
  saveMessage: jest.fn().mockResolvedValue({}),
  updateFilesUsage: jest.fn(),
  getUserKeyValues: jest.fn(),
  getUserCodeFiles: jest.fn(),
  getToolFilesByIds: jest.fn(),
  getCodeGeneratedFiles: jest.fn(),
  updateBalance: mockUpdateBalance,
  bulkInsertTransactions: mockBulkInsertTransactions,
  spendTokens: mockSpendTokens,
  spendStructuredTokens: mockSpendStructuredTokens,
  getMultiplier: mockGetMultiplier,
  getCacheMultiplier: mockGetCacheMultiplier,
  getConvoFiles: jest.fn().mockResolvedValue([]),
  saveConvo: jest.fn().mockResolvedValue({}),
  getConvo: jest.fn().mockResolvedValue(null),
}));

let mockGlobalDiscoveredAgentConfigs = null;

describe('createResponse controller', () => {
  let createResponse, getResponse;
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGlobalDiscoveredAgentConfigs = null;

    const controller = require('../responses');
    createResponse = controller.createResponse;
    getResponse = controller.getResponse;

    req = {
      body: {
        model: 'agent-123',
        input: 'Hello',
        stream: false,
      },
      user: { id: 'user-123' },
      config: {
        endpoints: {
          agents: { allowedProviders: ['anthropic'] },
        },
      },
      on: jest.fn(),
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
    };
  });

  describe('conversation ownership validation', () => {
    it('should skip ownership check when previous_response_id is not provided', async () => {
      const { getConvo } = require('~/models');
      await createResponse(req, res);
      expect(getConvo).not.toHaveBeenCalled();
    });

    it('should return 400 when previous_response_id is not a string', async () => {
      const { validateResponseRequest, sendResponsesErrorResponse } = require('@librechat/api');
      validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: 'Hello',
          stream: false,
          previous_response_id: { $gt: '' },
        },
      });

      await createResponse(req, res);
      expect(sendResponsesErrorResponse).toHaveBeenCalledWith(
        res,
        400,
        'previous_response_id must be a string',
        'invalid_request',
      );
    });

    it('should return 404 when conversation is not owned by user', async () => {
      const { validateResponseRequest, sendResponsesErrorResponse } = require('@librechat/api');
      const { getConvo } = require('~/models');
      validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: 'Hello',
          stream: false,
          previous_response_id: 'resp_abc',
        },
      });
      getConvo.mockResolvedValueOnce(null);

      await createResponse(req, res);
      expect(getConvo).toHaveBeenCalledWith('user-123', 'resp_abc');
      expect(sendResponsesErrorResponse).toHaveBeenCalledWith(
        res,
        404,
        'Conversation not found',
        'not_found',
      );
    });

    it('should proceed when conversation is owned by user', async () => {
      const { validateResponseRequest, sendResponsesErrorResponse } = require('@librechat/api');
      const { getConvo } = require('~/models');
      validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: 'Hello',
          stream: false,
          previous_response_id: 'resp_abc',
        },
      });
      getConvo.mockResolvedValueOnce({ conversationId: 'resp_abc', user: 'user-123' });

      await createResponse(req, res);
      expect(getConvo).toHaveBeenCalledWith('user-123', 'resp_abc');
      expect(sendResponsesErrorResponse).not.toHaveBeenCalledWith(
        res,
        404,
        expect.any(String),
        expect.any(String),
      );
    });

    it('should resolve generated previous_response_id to its stored conversation', async () => {
      const { createRun, validateResponseRequest } = require('@librechat/api');
      const { getConvo, getMessage, getMessages } = require('~/models');
      validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: 'Follow up',
          stream: false,
          previous_response_id: 'resp_previous',
        },
      });
      getConvo
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ conversationId: 'convo-abc', user: 'user-123' });
      getMessage.mockResolvedValueOnce({
        messageId: 'resp_previous',
        conversationId: 'convo-abc',
      });
      getMessages.mockResolvedValueOnce([
        {
          isCreatedByUser: false,
          messageId: 'resp_previous',
          text: 'Stored answer',
        },
      ]);

      await createResponse(req, res);

      expect(getConvo).toHaveBeenNthCalledWith(1, 'user-123', 'resp_previous');
      expect(getMessage).toHaveBeenCalledWith({
        user: 'user-123',
        messageId: 'resp_previous',
      });
      expect(getConvo).toHaveBeenNthCalledWith(2, 'user-123', 'convo-abc');
      expect(getMessages).toHaveBeenCalledWith({ conversationId: 'convo-abc', user: 'user-123' });
      expect(createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ conversationId: 'convo-abc' }),
        }),
      );
    });

    it('should return 500 when getConvo throws a DB error', async () => {
      const { validateResponseRequest, sendResponsesErrorResponse } = require('@librechat/api');
      const { getConvo } = require('~/models');
      validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: 'Hello',
          stream: false,
          previous_response_id: 'resp_abc',
        },
      });
      getConvo.mockRejectedValueOnce(new Error('DB connection failed'));

      await createResponse(req, res);
      expect(sendResponsesErrorResponse).toHaveBeenCalledWith(
        res,
        500,
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('getResponse resolver', () => {
    it('retrieves a stored response by generated response id', async () => {
      const { getConvo, getMessage, getMessages } = require('~/models');
      req.params = { id: 'resp_previous' };
      getConvo.mockResolvedValueOnce(null).mockResolvedValueOnce({
        conversationId: 'convo-abc',
        user: 'user-123',
        createdAt: new Date('2026-06-25T00:00:00.000Z'),
        updatedAt: new Date('2026-06-25T00:01:00.000Z'),
      });
      getMessage.mockResolvedValueOnce({
        messageId: 'resp_previous',
        conversationId: 'convo-abc',
      });
      getMessages.mockResolvedValueOnce([
        {
          isCreatedByUser: false,
          messageId: 'resp_previous',
          text: 'Stored answer',
          tokenCount: 12,
        },
      ]);

      await getResponse(req, res);

      expect(getMessage).toHaveBeenCalledWith({
        user: 'user-123',
        messageId: 'resp_previous',
      });
      expect(getMessages).toHaveBeenCalledWith({
        conversationId: 'convo-abc',
        user: 'user-123',
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'resp_previous',
          status: 'completed',
          output: expect.arrayContaining([
            expect.objectContaining({
              id: 'resp_previous',
              type: 'message',
            }),
          ]),
        }),
      );
    });
  });

  describe('token usage recording - non-streaming', () => {
    it('normalizes non-streaming store false requests into durable Steel storage', async () => {
      const { validateResponseRequest } = require('@librechat/api');
      const { saveConvo, saveMessage } = require('~/models');
      validateResponseRequest.mockReturnValueOnce({
        request: { model: 'agent-123', input: 'Hello', stream: false, store: false },
      });

      await createResponse(req, res);

      expect(saveConvo).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ conversationId: expect.any(String) }),
        expect.any(Object),
      );
      expect(saveMessage).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ store: true }));
    });

    it('stores auditable Steel metadata on the assistant response message', async () => {
      const { validateResponseRequest } = require('@librechat/api');
      const { saveMessage } = require('~/models');
      validateResponseRequest.mockReturnValueOnce({
        request: { model: 'agent-123', input: 'Hello', stream: false, store: false },
      });

      await createResponse(req, res);

      expect(mockBuildSteelNativeResponseMessageMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'mock-uuid-456',
          responseId: 'resp_mock-123',
          turnIndex: 0,
          checkpointTurnIndex: 0,
          requestedStore: false,
          store: true,
          providerStateMode: 'openai_responses_reconstructed',
          contextMetadata: mockSteelNativeContext.metadata,
        }),
      );
      const assistantMessage = saveMessage.mock.calls
        .map((call) => call[1])
        .find((message) => message.isCreatedByUser === false);
      expect(assistantMessage).toEqual(
        expect.objectContaining({
          messageId: 'resp_mock-123',
          metadata: {
            steel: {
              native: {
                ingress: 'open_responses',
                renderProfile: 'open_responses',
              },
            },
          },
        }),
      );
    });

    it('saves normalized Open Responses text on the assistant message', async () => {
      const api = require('@librechat/api');
      const { saveMessage } = require('~/models');
      api.buildAggregatedResponse.mockReturnValueOnce({
        id: 'resp_123',
        status: 'completed',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'text', text: '## OCR 結果確認表\n\n| 頁 | 圖號 |\n' }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      });

      await createResponse(req, res);

      const assistantMessage = saveMessage.mock.calls
        .map((call) => call[1])
        .find((message) => message.isCreatedByUser === false);
      expect(mockExtractSteelNativeResponseOutputText).toHaveBeenCalledWith(
        expect.objectContaining({
          output: expect.arrayContaining([
            expect.objectContaining({
              content: [{ type: 'text', text: '## OCR 結果確認表\n\n| 頁 | 圖號 |\n' }],
            }),
          ]),
        }),
      );
      expect(assistantMessage).toEqual(
        expect.objectContaining({
          text: '## OCR 結果確認表\n\n| 頁 | 圖號 |\n',
        }),
      );
    });

    it('should call recordCollectedUsage after successful non-streaming completion', async () => {
      await createResponse(req, res);

      expect(mockRecordCollectedUsage).toHaveBeenCalledTimes(1);
      expect(mockRecordCollectedUsage).toHaveBeenCalledWith(
        {
          spendTokens: mockSpendTokens,
          spendStructuredTokens: mockSpendStructuredTokens,
          pricing: { getMultiplier: mockGetMultiplier, getCacheMultiplier: mockGetCacheMultiplier },
          bulkWriteOps: {
            insertMany: mockBulkInsertTransactions,
            updateBalance: mockUpdateBalance,
          },
        },
        expect.objectContaining({
          user: 'user-123',
          conversationId: expect.any(String),
          collectedUsage: expect.any(Array),
          context: 'message',
        }),
      );
    });

    it('should pass balance and transactions config to recordCollectedUsage', async () => {
      mockGetBalanceConfig.mockReturnValue({ enabled: true, startBalance: 2000 });
      mockGetTransactionsConfig.mockReturnValue({ enabled: true });

      await createResponse(req, res);

      expect(mockRecordCollectedUsage).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          balance: { enabled: true, startBalance: 2000 },
          transactions: { enabled: true },
        }),
      );
    });

    it('should pass spendTokens, spendStructuredTokens, pricing, and bulkWriteOps as dependencies', async () => {
      await createResponse(req, res);

      const [deps] = mockRecordCollectedUsage.mock.calls[0];
      expect(deps).toHaveProperty('spendTokens', mockSpendTokens);
      expect(deps).toHaveProperty('spendStructuredTokens', mockSpendStructuredTokens);
      expect(deps).toHaveProperty('pricing');
      expect(deps.pricing).toHaveProperty('getMultiplier', mockGetMultiplier);
      expect(deps.pricing).toHaveProperty('getCacheMultiplier', mockGetCacheMultiplier);
      expect(deps).toHaveProperty('bulkWriteOps');
      expect(deps.bulkWriteOps).toHaveProperty('insertMany', mockBulkInsertTransactions);
      expect(deps.bulkWriteOps).toHaveProperty('updateBalance', mockUpdateBalance);
    });

    it('should include model from primaryConfig in recordCollectedUsage params', async () => {
      await createResponse(req, res);

      expect(mockRecordCollectedUsage).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          model: 'claude-3',
        }),
      );
    });
  });

  describe('agent context parity with UI path', () => {
    it('applies Steel global context from reconstructed Responses messages before createRun', async () => {
      const api = require('@librechat/api');
      const db = require('~/models');
      api.validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: 'new quote request',
          stream: false,
          previous_response_id: 'convo-abc',
        },
      });
      api.convertInputToMessages.mockReturnValueOnce([
        { role: 'user', content: 'new quote request', messageId: 'user-2' },
      ]);
      db.getConvo.mockResolvedValueOnce({ conversationId: 'convo-abc', user: 'user-123' });
      db.getMessages.mockResolvedValueOnce([
        {
          isCreatedByUser: false,
          messageId: 'assistant-1',
          text: 'previous quote answer',
        },
      ]);
      mockBuildAgentScopedContext.mockResolvedValueOnce(
        new Map([['agent-123', 'PDF context: drawing.pdf']]),
      );

      await createResponse(req, res);

      expect(api.buildDefaultSteelGlobalAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({
          renderProfile: 'open_responses',
          conversation: expect.objectContaining({
            conversationId: 'convo-abc',
            requestId: 'resp_mock-123',
            activeHistory: [
              {
                role: 'assistant',
                content: '',
                messageId: 'assistant-1',
              },
            ],
            currentUserTurn: {
              role: 'user',
              content: '',
              messageId: 'user-2',
            },
          }),
        }),
      );
      expect(mockApplyContextToAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          globalInstructionPrefix: 'Steel global prefix',
          sharedRunContext: 'PDF context: drawing.pdf\n\nSteel runtime tail',
        }),
      );
    });

    it('preserves nested text content for Steel native Open Responses context', async () => {
      const api = require('@librechat/api');
      api.validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: 'new quote request',
          stream: false,
        },
      });
      api.convertInputToMessages.mockReturnValueOnce([
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: {
                value: 'nested quote request',
              },
            },
          ],
          messageId: 'user-2',
        },
      ]);

      await createResponse(req, res);

      expect(mockPrepareLibreChatSteelChatContext).toHaveBeenCalledWith(
        expect.objectContaining({
          currentUserTurn: {
            role: 'user',
            content: 'nested quote request',
            messageId: 'user-2',
          },
        }),
      );
    });

    it('passes Open Responses input_file references into Steel native OCR context', async () => {
      const api = require('@librechat/api');
      const { runSteelPaddleOcrPreflight } = require('~/server/services/ToolService');
      api.initializeAgent.mockResolvedValueOnce({
        id: 'agent-123',
        model: 'claude-3',
        model_parameters: {},
        tools: [],
        toolDefinitions: [],
        toolRegistry: new Map(),
        edges: [],
        agentContextAttachments: [],
      });
      const currentOcrMarkdownResults = [
        {
          ocrFileKey: 'file:file-drawing',
          fileId: 'file-drawing',
          filename: 'drawing.pdf',
          ocrSource: 'ocr_preprocessing_merge',
          content: 'merged OCR markdown',
        },
      ];
      api.validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                { type: 'input_text', text: '請分析這張圖' },
                { type: 'input_file', file_id: 'file-drawing', filename: 'drawing.pdf' },
                { type: 'input_file', file_id: 'file-drawing', filename: 'drawing-copy.pdf' },
              ],
            },
          ],
          stream: false,
        },
      });
      api.convertInputToMessages.mockReturnValueOnce([
        {
          role: 'user',
          content: [
            { type: 'text', text: '請分析這張圖' },
            { type: 'input_file', file_id: 'file-drawing', filename: 'drawing.pdf' },
            { type: 'input_file', file_id: 'file-drawing', filename: 'drawing-copy.pdf' },
          ],
        },
      ]);
      runSteelPaddleOcrPreflight.mockResolvedValueOnce({
        status: 'completed',
        ocrTurnActive: true,
        completedKeys: ['file:file-drawing'],
        attemptedKeys: ['file:file-drawing'],
        failedKeys: [],
        skippedReason: undefined,
        currentPaddleOcrResults: [
          {
            ocrFileKey: 'file:file-drawing',
            fileId: 'file-drawing',
            filename: 'drawing.pdf',
            result: { text: 'raw OCR' },
          },
        ],
        currentOcrMarkdownResults,
      });

      await createResponse(req, res);

      expect(runSteelPaddleOcrPreflight).toHaveBeenCalledWith(
        expect.objectContaining({
          req,
          res,
          agent: expect.objectContaining({ id: 'agent-123' }),
        }),
      );
      expect(runSteelPaddleOcrPreflight.mock.invocationCallOrder[0]).toBeLessThan(
        api.buildDefaultSteelGlobalAgentContext.mock.invocationCallOrder[0],
      );
      expect(req.steelNativeContext.currentTurnFiles).toEqual([
        {
          fileId: 'file-drawing',
          filename: 'drawing.pdf',
          mediaType: 'application/octet-stream',
          source: 'librechat_file_record',
          conversationId: 'mock-uuid-456',
        },
      ]);
      expect(api.buildDefaultSteelGlobalAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: {
            currentTurnFiles: [
              {
                fileId: 'file-drawing',
                filename: 'drawing.pdf',
                mediaType: 'application/octet-stream',
                source: 'librechat_file_record',
                conversationId: 'mock-uuid-456',
              },
            ],
            currentOcrMarkdownResults,
          },
          conversation: expect.objectContaining({
            currentUserTurn: expect.objectContaining({
              files: [
                {
                  fileId: 'file-drawing',
                  filename: 'drawing.pdf',
                  mediaType: 'application/octet-stream',
                  source: 'librechat_file_record',
                  conversationId: 'mock-uuid-456',
                },
              ],
            }),
          }),
        }),
      );
      expect(api.createRun.mock.calls[0][0]).not.toHaveProperty(
        'openAIOAuthReasoningEffortOverride',
      );
    });

    it('applies agent-scoped attachment context before createRun', async () => {
      const api = require('@librechat/api');
      api.initializeAgent.mockResolvedValueOnce({
        id: 'agent-123',
        model: 'claude-3',
        model_parameters: {},
        toolRegistry: {},
        edges: [],
        agentContextAttachments: [{ file_id: 'file-1', filename: 'ocr_file.pdf' }],
      });
      mockBuildAgentContextAttachmentsByAgentId.mockReturnValueOnce(
        new Map([['agent-123', [{ file_id: 'file-1', filename: 'ocr_file.pdf' }]]]),
      );
      mockBuildAgentScopedContext.mockResolvedValueOnce(
        new Map([['agent-123', 'PDF context: ocr_file.pdf']]),
      );

      await createResponse(req, res);

      expect(mockBuildAgentContextAttachmentsByAgentId).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'agent-123' }),
      ]);
      expect(mockBuildAgentScopedContext).toHaveBeenCalledWith(
        expect.objectContaining({
          agentIds: ['agent-123'],
          attachmentsByAgentId: expect.any(Map),
          req,
        }),
      );
      expect(mockApplyContextToAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: expect.objectContaining({ id: 'agent-123' }),
          agentId: 'agent-123',
          globalInstructionPrefix: 'Steel global prefix',
          sharedRunContext: 'PDF context: ocr_file.pdf\n\nSteel runtime tail',
        }),
      );
    });

    it('applies context to primary and discovered handoff agents', async () => {
      const api = require('@librechat/api');
      const handoffConfig = {
        id: 'agent-handoff',
        model: 'claude-3',
        model_parameters: {},
        toolRegistry: {},
        edges: [],
        agentContextAttachments: [{ file_id: 'file-2', filename: 'handoff_context.pdf' }],
      };

      // Set primary agent to have edges pointing to handoff agent
      api.initializeAgent.mockResolvedValueOnce({
        id: 'agent-123',
        model: 'claude-3',
        model_parameters: {},
        toolRegistry: {},
        edges: [{ source: 'agent-123', target: 'agent-handoff' }],
        agentContextAttachments: [{ file_id: 'file-1', filename: 'primary_context.pdf' }],
      });

      // Set global config so discoverConnectedAgents mock can invoke onAgentInitialized
      mockGlobalDiscoveredAgentConfigs = new Map([['agent-handoff', handoffConfig]]);

      mockBuildAgentScopedContext.mockResolvedValueOnce(
        new Map([
          ['agent-123', 'Primary context'],
          ['agent-handoff', 'Handoff context'],
        ]),
      );

      await createResponse(req, res);

      const appliedAgentIds = mockApplyContextToAgent.mock.calls.map((call) => call[0].agentId);
      expect(appliedAgentIds).toEqual(expect.arrayContaining(['agent-123', 'agent-handoff']));
      expect(mockApplyContextToAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-handoff',
          globalInstructionPrefix: 'Steel global prefix',
          sharedRunContext: 'Handoff context\n\nSteel runtime tail',
        }),
      );
    });
  });

  describe('token usage recording - streaming', () => {
    beforeEach(() => {
      req.body.stream = true;

      const api = require('@librechat/api');
      api.validateResponseRequest.mockReturnValue({
        request: { model: 'agent-123', input: 'Hello', stream: true },
      });
    });

    it('should call recordCollectedUsage after successful streaming completion', async () => {
      await createResponse(req, res);

      expect(mockRecordCollectedUsage).toHaveBeenCalledTimes(1);
      expect(mockRecordCollectedUsage).toHaveBeenCalledWith(
        {
          spendTokens: mockSpendTokens,
          spendStructuredTokens: mockSpendStructuredTokens,
          pricing: { getMultiplier: mockGetMultiplier, getCacheMultiplier: mockGetCacheMultiplier },
          bulkWriteOps: {
            insertMany: mockBulkInsertTransactions,
            updateBalance: mockUpdateBalance,
          },
        },
        expect.objectContaining({
          user: 'user-123',
          context: 'message',
        }),
      );
    });

    it('normalizes streaming store false requests into durable Steel storage', async () => {
      const { validateResponseRequest } = require('@librechat/api');
      const { saveConvo, saveMessage } = require('~/models');
      validateResponseRequest.mockReturnValueOnce({
        request: { model: 'agent-123', input: 'Hello', stream: true, store: false },
      });

      await createResponse(req, res);

      expect(saveConvo).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ conversationId: expect.any(String) }),
        expect.any(Object),
      );
      expect(saveMessage).toHaveBeenCalled();
    });

    it('initializes streaming before PaddleOCR preflight emits tool-call events', async () => {
      const api = require('@librechat/api');
      const { runSteelPaddleOcrPreflight } = require('~/server/services/ToolService');
      api.validateResponseRequest.mockReturnValueOnce({
        request: {
          model: 'agent-123',
          input: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_file', file_id: 'file-drawing', filename: 'drawing.pdf' }],
            },
          ],
          stream: true,
        },
      });
      api.convertInputToMessages.mockReturnValueOnce([
        {
          role: 'user',
          content: [{ type: 'input_file', file_id: 'file-drawing', filename: 'drawing.pdf' }],
        },
      ]);

      await createResponse(req, res);

      expect(api.setupStreamingResponse.mock.invocationCallOrder[0]).toBeLessThan(
        runSteelPaddleOcrPreflight.mock.invocationCallOrder[0],
      );
      expect(runSteelPaddleOcrPreflight.mock.invocationCallOrder[0]).toBeLessThan(
        api.buildDefaultSteelGlobalAgentContext.mock.invocationCallOrder[0],
      );
    });

    it('saves the final response without structured Markdown capture', async () => {
      const { saveMessage } = require('~/models');
      await createResponse(req, res);

      expect(saveMessage).toHaveBeenCalled();
    });
  });

  describe('collectedUsage population', () => {
    it('should collect usage from on_chat_model_end events', async () => {
      const api = require('@librechat/api');

      api.createRun.mockImplementation(async ({ customHandlers }) => {
        return {
          processStream: jest.fn().mockImplementation(async () => {
            customHandlers.on_chat_model_end.handle('on_chat_model_end', {
              output: {
                usage_metadata: {
                  input_tokens: 150,
                  output_tokens: 75,
                  model: 'claude-3',
                },
              },
            });
          }),
        };
      });

      await createResponse(req, res);
      expect(mockRecordCollectedUsage).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          collectedUsage: expect.arrayContaining([
            expect.objectContaining({
              input_tokens: 150,
              output_tokens: 75,
            }),
          ]),
        }),
      );
    });
  });

  describe('sub-agent skill priming', () => {
    it('keeps Steel execution tools on standard turns', async () => {
      const { stripSteelToolsForOcrTurn } = require('@librechat/api');

      await createResponse(req, res);

      expect(stripSteelToolsForOcrTurn).not.toHaveBeenCalled();
    });

    it('keeps standard-turn skill primes in the provider messages after OCR file filtering', async () => {
      const { initializeAgent, injectSkillPrimes, createRun } = require('@librechat/api');
      initializeAgent.mockResolvedValueOnce({
        id: 'agent-123',
        model: 'claude-3',
        model_parameters: {},
        toolRegistry: new Map(),
        edges: [],
        agentContextAttachments: [],
        manualSkillPrimes: [{ name: 'primary-skill', _id: 'primary-skill-id' }],
      });
      injectSkillPrimes.mockImplementationOnce(({ initialMessages, indexTokenCountMap }) => {
        initialMessages.unshift({ role: 'system', content: 'PRIMARY SKILL PRIME' });
        return {
          initialMessages,
          indexTokenCountMap,
          inserted: 1,
          insertIdx: 0,
          alwaysApplyDropped: 0,
          alwaysApplyDedupedFromManual: 0,
        };
      });

      await createResponse(req, res);

      expect(createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: 'PRIMARY SKILL PRIME' }),
          ]),
        }),
      );
    });

    it('uses the shared native tool execution callback in streaming responses', async () => {
      const { validateResponseRequest, createToolExecuteHandler } = require('@librechat/api');
      const { loadToolsForExecution } = require('~/server/services/ToolService');
      req.body.stream = true;
      validateResponseRequest.mockReturnValueOnce({
        request: { model: 'agent-123', input: 'Hello', stream: true },
      });

      await createResponse(req, res);

      const toolExecuteOptions = createToolExecuteHandler.mock.calls.at(-1)[0];
      await toolExecuteOptions.loadTools(['search_price_candidates'], 'agent-123');

      expect(loadToolsForExecution).toHaveBeenLastCalledWith(
        expect.objectContaining({
          req,
          res,
          toolNames: ['search_price_candidates'],
          agent: expect.objectContaining({ id: 'agent-123' }),
        }),
      );
    });

    it('passes the sub-agent primed skill IDs into non-streaming tool execution', async () => {
      const {
        initializeAgent,
        discoverConnectedAgents,
        createToolExecuteHandler,
      } = require('@librechat/api');
      const { loadToolsForExecution } = require('~/server/services/ToolService');
      const subAgent = { id: 'agent-sub', name: 'Sub Agent' };
      const subConfig = {
        id: 'agent-sub',
        model: 'claude-3',
        model_parameters: {},
        toolRegistry: new Map(),
        userMCPAuthMap: { sub: { token: 'sub-token' } },
        tool_resources: { code_interpreter: { file_ids: ['sub-file'] } },
        actionsEnabled: true,
        accessibleSkillIds: ['sub-skill-id'],
        activeSkillNames: ['sub-hidden-skill'],
        codeEnvAvailable: true,
        skillAuthoringAvailable: true,
        fileAuthoringToolNames: ['create_file', 'edit_file'],
        manualSkillPrimes: [{ name: 'sub-hidden-skill', _id: { toString: () => 'sub-manual-id' } }],
        alwaysApplySkillPrimes: [
          { name: 'sub-always-skill', _id: { toString: () => 'sub-always-id' } },
        ],
      };

      initializeAgent.mockResolvedValueOnce({
        id: 'agent-123',
        model: 'claude-3',
        model_parameters: {},
        toolRegistry: new Map(),
        edges: [{ source: 'agent-123', target: 'agent-sub' }],
        accessibleSkillIds: ['primary-skill-id'],
        activeSkillNames: ['primary-skill'],
        codeEnvAvailable: false,
        skillAuthoringAvailable: false,
        fileAuthoringToolNames: [],
        manualSkillPrimes: [{ name: 'primary-skill', _id: { toString: () => 'primary-skill-id' } }],
      });
      discoverConnectedAgents.mockImplementationOnce(async (_params, deps) => {
        deps.onAgentInitialized('agent-sub', subAgent, subConfig);
        return {
          agentConfigs: new Map([['agent-sub', subConfig]]),
          edges: [],
          skippedAgentIds: new Set(),
          userMCPAuthMap: undefined,
        };
      });

      await createResponse(req, res);

      const toolExecuteOptions = createToolExecuteHandler.mock.calls.at(-1)[0];
      await toolExecuteOptions.loadTools(['read_file'], 'agent-sub');

      expect(loadToolsForExecution).toHaveBeenLastCalledWith(
        expect.objectContaining({
          agent: subAgent,
          toolRegistry: subConfig.toolRegistry,
          userMCPAuthMap: subConfig.userMCPAuthMap,
          tool_resources: subConfig.tool_resources,
          actionsEnabled: true,
        }),
      );
      expect(mockEnrichWithSkillConfigurable).toHaveBeenLastCalledWith({
        result: expect.anything(),
        context: {
          req,
          accessibleSkillIds: ['sub-skill-id'],
          codeEnvAvailable: true,
          skillPrimedIdsByName: {
            'sub-always-skill': 'sub-always-id',
            'sub-hidden-skill': 'sub-manual-id',
          },
          activeSkillNames: ['sub-hidden-skill'],
          skillAuthoringAvailable: true,
          fileAuthoringToolNames: ['create_file', 'edit_file'],
        },
      });
    });
  });
});
