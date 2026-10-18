const { createHash } = require('node:crypto');
const { Constants: AgentConstants } = require('@librechat/agents');
const {
  Tools,
  Constants,
  Permissions,
  EToolResources,
  EModelEndpoint,
  PermissionTypes,
  AgentCapabilities,
  ImageVisionTool,
} = require('librechat-data-provider');

const mockGetEndpointsConfig = jest.fn();
const mockInitializeModel = jest.fn();
const mockGetAppConfig = jest.fn();
const mockGetMCPServerTools = jest.fn();
const mockGetCachedTools = jest.fn();
const mockSendEvent = jest.fn();
const mockEmitChunk = jest.fn();
const mockUpdateGenerationMetadata = jest.fn();
const mockCreateAttachedWorkspaceBashTool = jest.fn(() => ({ name: AgentConstants.BASH_TOOL }));
const attachedWorkspaceOperations = [
  'read_file',
  'search_text',
  'list_files',
  'write_file',
  'preview_edit',
  'edit_file',
  'execute_command',
];
const mockResolveCodeExecutionContext = jest.fn(
  ({ statefulSessions, environment, userId, agentId, conversationId }) => {
    if (!statefulSessions) {
      return {
        baseUrl: (process.env.LIBRECHAT_CODE_BASEURL ?? 'https://api.librechat.ai').replace(
          /\/$/,
          '',
        ),
        codeSessionKey: 'execute_code',
        executionProfile: 'default',
        statefulSessions: false,
      };
    }
    const baseUrl = process.env.LIBRECHAT_CODE_BASEURL_STATEFUL?.replace(/\/$/, '');
    if (!baseUrl) {
      throw new Error('LIBRECHAT_CODE_BASEURL_STATEFUL is not configured');
    }
    const fingerprint = (...parts) =>
      createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
    let runtimeSessionHint = `v2:user:${fingerprint(userId)}`;
    if (environment === 'agent-user') {
      runtimeSessionHint = `v2:agent-user:${fingerprint(userId, agentId)}`;
    } else if (environment === 'conversation') {
      runtimeSessionHint = `v2:conversation:${fingerprint(userId, conversationId)}`;
    }
    return {
      baseUrl,
      codeSessionKey: `execute_code:stateful:${runtimeSessionHint}`,
      executionProfile: 'stateful',
      runtimeSessionHint,
      statefulSessions: true,
    };
  },
);
const mockResolveCodeExecutionWorkspaceContext = jest.fn(async ({ context }) => {
  if (context.environmentType !== 'attached') {
    return context;
  }
  const environmentId = context.environmentId ?? 'personal-machine';
  return {
    ...context,
    environmentId,
    codeWorkspace: {
      environmentId,
      workspaceId: 'project-a',
      operations: attachedWorkspaceOperations,
    },
  };
});
const mockPrimeSearchFiles = jest.fn().mockResolvedValue({});
const mockPrimeCodeFiles = jest.fn().mockResolvedValue({});
jest.mock('~/server/services/Config', () => ({
  getEndpointsConfig: (...args) => mockGetEndpointsConfig(...args),
  getAppConfig: (...args) => mockGetAppConfig(...args),
  getMCPServerTools: (...args) => mockGetMCPServerTools(...args),
  getCachedTools: (...args) => mockGetCachedTools(...args),
}));
jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  initializeModel: (...args) => mockInitializeModel(...args),
}));

const mockLoadToolDefinitions = jest.fn();
const mockGetUserMCPAuthMap = jest.fn();
jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE: 'AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE',
  isFatalAgentInitializationError: (error, { signal } = {}) =>
    (signal?.aborted === true && (error === signal.reason || error?.name === 'AbortError')) ||
    ['AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE', 'resource_recovery_required'].includes(error?.code),
  selectMCPUpstreamTokenProvider: ({
    upstreamTokenProvider,
    upstreamTokenProviderResolver,
    createSessionProvider,
  }) =>
    upstreamTokenProviderResolver
      ? upstreamTokenProvider
      : (upstreamTokenProvider ?? createSessionProvider()),
  loadToolDefinitions: (...args) => mockLoadToolDefinitions(...args),
  getUserMCPAuthMap: (...args) => mockGetUserMCPAuthMap(...args),
  createSteelPostgresPool: jest.fn(() => ({ query: jest.fn() })),
  createSteelNativeTool: ({ nativeToolName, steelToolName, execute }) => ({
    name: nativeToolName,
    invoke: (args, config) =>
      execute({
        toolName: steelToolName,
        arguments: args,
        providerToolCallId: config?.toolCall?.id,
      }),
  }),
  resolveSteelProviderToolName: (name) => {
    const normalized = name.startsWith('steel_') ? name.slice('steel_'.length) : name;
    return ['search_customers', 'search_price_candidates'].includes(normalized)
      ? normalized
      : undefined;
  },
  createAuthIdentityContext: ({ user, tenantId }) => ({
    appUserId: user?._id?.toString?.() ?? user?.id,
    openidSubject: user?.openidId,
    tenantId: tenantId ?? user?.tenantId,
    openidIssuer: user?.openidIssuer,
  }),
  sendEvent: (...args) => mockSendEvent(...args),
  resolveCodeExecutionContext: (...args) => mockResolveCodeExecutionContext(...args),
  resolveCodeExecutionWorkspaceContext: (...args) =>
    mockResolveCodeExecutionWorkspaceContext(...args),
  createAttachedWorkspaceBashTool: (...args) => mockCreateAttachedWorkspaceBashTool(...args),
}));

const mockLoadToolsUtil = jest.fn();
jest.mock('~/app/clients/tools/util', () => ({
  loadTools: (...args) => mockLoadToolsUtil(...args),
}));

const mockLoadActionSets = jest.fn();
const mockDomainParser = jest.fn();
const mockLegacyDomainEncode = jest.fn();
const mockDecryptMetadata = jest.fn();
const mockCreateActionTool = jest.fn();
const mockGetServerConfig = jest.fn();
const mockFlowManager = { getFlowState: jest.fn() };
const mockResolveConfigServers = jest.fn();
const mockResolveMcpServerNames = jest.fn();
const mockUserCanUseMCPServers = jest.fn().mockResolvedValue(true);
const mockMCPManager = {
  appConnections: {
    disconnect: jest.fn(),
  },
};
jest.mock('~/server/services/Tools/credentials', () => ({
  loadAuthValues: jest.fn().mockResolvedValue({}),
}));
jest.mock('~/server/services/Tools/search', () => ({
  createOnSearchResults: jest.fn(),
}));
jest.mock('~/server/services/Tools/mcp', () => ({
  reinitMCPServer: jest.fn(),
}));
jest.mock('~/server/services/Files/process', () => ({
  processFileURL: jest.fn(),
  uploadImageBuffer: jest.fn(),
}));
const mockGetStrategyFunctions = jest.fn();
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: (...args) => mockGetStrategyFunctions(...args),
}));
jest.mock('~/app/clients/tools/util/fileSearch', () => ({
  primeFiles: (...args) => mockPrimeSearchFiles(...args),
}));
jest.mock('~/server/services/Files/Code/process', () => ({
  primeFiles: (...args) => mockPrimeCodeFiles(...args),
}));
jest.mock('~/server/services/ActionService', () => ({
  loadActionSets: (...args) => mockLoadActionSets(...args),
  decryptMetadata: (...args) => mockDecryptMetadata(...args),
  createActionTool: (...args) => mockCreateActionTool(...args),
  domainParser: (...args) => mockDomainParser(...args),
  legacyDomainEncode: (...args) => mockLegacyDomainEncode(...args),
}));
jest.mock('~/server/services/Threads', () => ({
  recordUsage: jest.fn(),
}));
const mockGetFiles = jest.fn();
const mockGetRoleByName = jest.fn();
jest.mock('~/models', () => ({
  findPluginAuthsByKeys: jest.fn(),
  getFiles: (...args) => mockGetFiles(...args),
  getRoleByName: (...args) => mockGetRoleByName(...args),
}));
jest.mock('~/config', () => ({
  getFlowStateManager: jest.fn(() => mockFlowManager),
  getMCPManager: jest.fn(() => mockMCPManager),
  getMCPServersRegistry: jest.fn(() => ({
    getServerConfig: (...args) => mockGetServerConfig(...args),
  })),
}));
jest.mock('~/server/services/MCP', () => ({
  resolveConfigServers: (...args) => mockResolveConfigServers(...args),
  resolveMcpServerNames: (...args) => mockResolveMcpServerNames(...args),
  resolveMcpServerContext: async (...args) => {
    const configServers = (await mockResolveConfigServers(...args)) ?? {};
    const serverNames = Object.keys(configServers);
    return { configServers, serverNames, rawServerNames: serverNames };
  },
  /** Mirrors the real resolver's shape; these fixtures use safe names, so the
   *  raw set is always the complete audit. */
  resolveCollisionAuditNames: jest.fn(async ({ rawServerNames, accessibleServerNames }) => ({
    names: accessibleServerNames?.length ? accessibleServerNames : rawServerNames,
    complete: true,
  })),
  createMCPPermissionContext: jest.fn((req) => ({
    canUseServers: (user) => mockUserCanUseMCPServers(user, req),
  })),
  userCanUseMCPServers: mockUserCanUseMCPServers,
}));
jest.mock('~/cache', () => ({
  getLogStores: jest.fn(() => ({})),
}));
const {
  loadAgentTools,
  loadToolsForExecution,
  processRequiredActions,
} = require('~/server/services/ToolService');
const { GenerationJobManager } = require('@librechat/api');

/** Steel events reach the job stream through the real manager, so spy on it rather than replace it. */
beforeEach(() => {
  jest
    .spyOn(GenerationJobManager, 'emitChunk')
    .mockImplementation((...args) => mockEmitChunk(...args));
  jest
    .spyOn(GenerationJobManager, 'updateMetadata')
    .mockImplementation((...args) => mockUpdateGenerationMetadata(...args));
});

/** Role document shape `checkAccess` reads; all three role-gated tools granted. */
function buildRole(overrides = {}) {
  return {
    name: 'USER',
    permissions: {
      [PermissionTypes.FILE_SEARCH]: { [Permissions.USE]: true },
      [PermissionTypes.RUN_CODE]: { [Permissions.USE]: true },
      [PermissionTypes.WEB_SEARCH]: { [Permissions.USE]: true },
      ...overrides,
    },
  };
}

function createMockReq(capabilities) {
  return {
    user: { id: 'user_123', role: 'USER' },
    config: {
      endpoints: {
        [EModelEndpoint.agents]: {
          capabilities,
        },
      },
    },
  };
}

function createEndpointsConfig(capabilities) {
  return {
    [EModelEndpoint.agents]: { capabilities },
  };
}

function getToolDefinitionName(definition) {
  return typeof definition === 'string' ? definition : definition?.name;
}

describe('Steel tool loading through ToolService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateGenerationMetadata.mockResolvedValue(undefined);
    mockLoadToolsUtil.mockReset();
    mockLoadToolDefinitions.mockResolvedValue({
      toolDefinitions: [],
      toolRegistry: new Map(),
      hasDeferredTools: false,
    });
    mockLoadToolsUtil.mockResolvedValue({ loadedTools: [], toolContextMap: {} });
    mockLoadActionSets.mockResolvedValue([]);
    mockDecryptMetadata.mockImplementation(async (metadata) => metadata);
    mockGetMCPServerTools.mockResolvedValue(null);
    mockGetCachedTools.mockResolvedValue(null);
    mockGetUserMCPAuthMap.mockResolvedValue({});
    mockGetRoleByName.mockResolvedValue(buildRole());
    mockGetServerConfig.mockResolvedValue(undefined);
    mockMCPManager.appConnections.disconnect.mockResolvedValue(undefined);
    mockFlowManager.getFlowState.mockResolvedValue(undefined);
    mockResolveConfigServers.mockResolvedValue({});
    mockInitializeModel.mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: '| OCR |\n| --- |\n| organized |' }),
    });
    mockGetFiles.mockResolvedValue([]);
    mockGetStrategyFunctions.mockReturnValue({
      getDownloadStream: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
      saveBuffer: jest.fn().mockResolvedValue('https://files.example.test/chunk.pdf'),
      getDownloadURL: jest.fn().mockResolvedValue('https://files.example.test/chunk.pdf'),
    });
    mockResolveMcpServerNames.mockResolvedValue([]);
    mockPrimeSearchFiles.mockResolvedValue({});
    mockPrimeCodeFiles.mockResolvedValue({});
  });

  describe('processRequiredActions content protection', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const buildFilters = (field, sentinel) => ({
      toolArguments: {
        pii: {
          fields: [field],
          starterPatterns: [],
          customPatterns: [
            {
              id: 'private',
              label: 'private value',
              regex: sentinel,
            },
          ],
        },
      },
    });

    const buildClient = (filters) => ({
      req: {
        user: { id: 'user_123' },
        body: {
          assistant_id: 'assistant_content_filter',
          model: 'gpt-4o-mini',
          endpoint: 'openAI',
        },
        config: { filters },
      },
      res: {},
      apiKey: 'test-key',
      mappedOrder: new Map([['call_1', 0]]),
      seenToolCalls: new Map(),
      addContentData: jest.fn(),
    });

    const buildAction = (overrides = {}) => ({
      tool: 'safe_tool',
      toolInput: { value: 'safe' },
      toolCallId: 'call_1',
      thread_id: 'thread_1',
      run_id: 'run_1',
      ...overrides,
    });

    it('sanitizes filtered vision output before returning it to the model', async () => {
      const privateOutput = 'PRIVATE-VISION-OUTPUT';
      const client = buildClient(buildFilters('output', privateOutput));
      client.visionPromise = Promise.resolve({
        choices: [{ message: { content: privateOutput } }],
      });

      const result = await processRequiredActions(client, [
        buildAction({ tool: ImageVisionTool.function.name }),
      ]);

      expect(result.tool_outputs).toEqual([
        {
          tool_call_id: 'call_1',
          output: JSON.stringify({
            error: 'content_filter_block',
            message: 'Submitted content was blocked by content policy.',
            source: 'tool_argument',
            field: 'output',
          }),
        },
      ]);
      expect(JSON.stringify(result)).not.toContain(privateOutput);
    });

    it('sanitizes constructed tool errors before returning them to the model', async () => {
      const privateOutput = 'PRIVATE-ERROR-OUTPUT';
      const errorSpy = jest.spyOn(require('@librechat/data-schemas').logger, 'error');
      mockLoadToolsUtil.mockResolvedValue({
        loadedTools: [
          {
            name: 'safe_tool',
            _call: jest.fn().mockRejectedValue(new Error(privateOutput)),
          },
        ],
        toolContextMap: {},
      });
      const client = buildClient(buildFilters('output', privateOutput));

      const result = await processRequiredActions(client, [buildAction()]);
      const output = result.tool_outputs[0].output;

      expect(JSON.parse(output)).toEqual({
        error: 'content_filter_block',
        message: 'Submitted content was blocked by content policy.',
        source: 'tool_argument',
        field: 'output',
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateOutput);
    });
  });

  describe('loadAgentTools (definitionsOnly=true) — action tool filtering', () => {
    const regularTool = 'calculator';

    it('exposes Steel native tools for an empty agent on a quote-only turn', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1'],
        },
        delegateOcrContext: {
          steelConversation: {
            currentUserTurn: { role: 'user', content: '第35頁報價' },
            activeHistory: [{ role: 'user', content: '第35頁報價' }],
          },
        },
      };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const result = await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_quote_empty', tools: [] },
        definitionsOnly: true,
      });

      const definitionNames = result.toolDefinitions.map(getToolDefinitionName);
      expect(definitionNames).toEqual(
        expect.arrayContaining(['search_customers', 'search_price_candidates']),
      );
      expect(result.toolRegistry.has('search_customers')).toBe(true);
      expect(result.toolRegistry.has('search_price_candidates')).toBe(true);
    });

    it('keeps Steel native tools empty when the tools capability is disabled', async () => {
      const req = createMockReq([]);
      req.steelNativeContext = {};
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig([]));

      const result = await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_tools_disabled', tools: [] },
        definitionsOnly: true,
      });

      expect(result.toolDefinitions).toEqual([]);
      expect(result.toolRegistry?.size ?? 0).toBe(0);
    });

    it('exposes Steel native tools for an empty agent without Steel context', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const result = await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_empty_without_context', tools: [] },
        definitionsOnly: true,
      });

      const definitionNames = result.toolDefinitions.map(getToolDefinitionName);
      expect(definitionNames).toEqual(
        expect.arrayContaining(['delegate_ocr', 'search_customers', 'search_price_candidates']),
      );
      expect(result.toolRegistry.has('search_customers')).toBe(true);
      expect(result.toolRegistry.has('search_price_candidates')).toBe(true);
      expect(result.toolRegistry.has('delegate_ocr')).toBe(true);
    });

    it('injects PaddleOCR MCP for Steel native PDF/image turns before tool definitions load', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      req.steelNativeContext = {
        currentTurnFiles: [
          {
            fileId: 'file-1',
            filename: 'drawing.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool] },
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toEqual(
        expect.arrayContaining([
          regularTool,
          `${Constants.mcp_all}${Constants.mcp_delimiter}PaddleOCR`,
        ]),
      );
    });

    it('does not inject PaddleOCR MCP during initialization without OCR-capable files', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      req.steelNativeContext = {
        currentTurnFiles: [
          {
            fileId: 'file-1',
            filename: 'notes.txt',
            mediaType: 'text/plain',
          },
        ],
      };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool] },
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toContain(regularTool);
      expect(callArgs.tools).not.toContain(
        `${Constants.mcp_all}${Constants.mcp_delimiter}PaddleOCR`,
      );
    });

    it('injects PaddleOCR MCP during initialization tool loading for request PDF attachments', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool] },
        requestAttachments: [
          {
            file_id: 'file-1',
            filename: 'drawing.pdf',
            filepath: '/uploads/user/file-1__drawing.pdf',
            type: 'application/pdf',
          },
        ],
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toEqual(
        expect.arrayContaining([
          regularTool,
          `${Constants.mcp_all}${Constants.mcp_delimiter}PaddleOCR`,
        ]),
      );
    });

    it('retries without the injected PaddleOCR server when it is the only unavailable MCP tool', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockLoadToolDefinitions.mockResolvedValueOnce({
        toolDefinitions: [],
        toolRegistry: new Map(),
        hasDeferredTools: false,
        mcpResolution: { resolvedToolCount: 0 },
      });

      const result = await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool] },
        requestAttachments: [
          {
            file_id: 'file-1',
            filename: 'drawing.pdf',
            filepath: '/uploads/user/file-1__drawing.pdf',
            type: 'application/pdf',
          },
        ],
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(2);
      expect(mockLoadToolDefinitions.mock.calls[1][0].tools).toEqual([regularTool]);
      expect(result.toolDefinitions.map(getToolDefinitionName)).toEqual(
        expect.arrayContaining(['search_customers']),
      );
    });
  });

  describe('loadToolsForExecution — action tool gating', () => {
    it('does not load Steel tools for the regular OCR main agent', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      req.steelNativeContext = {
        ocrTurnActive: true,
        delegateOcrPolicy: { resolved: true, allowed: true, allowedFileKeys: ['file:drawing'] },
      };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      const toolNames = ['search_customers', 'search_price_candidates', 'delegate_ocr'];
      const toolRegistry = new Map(toolNames.map((name) => [name, { name }]));

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'ocr-agent', tools: toolNames },
        toolNames,
        toolRegistry,
        actionsEnabled: false,
      });

      expect(result.loadedTools).toEqual([]);
      expect(mockLoadToolsUtil).not.toHaveBeenCalled();
      expect(toolRegistry.size).toBe(3);
    });

    it('resolves stateful routing for host file tools with the controller conversation ID', async () => {
      const capabilities = [
        AgentCapabilities.tools,
        AgentCapabilities.execute_code,
        AgentCapabilities.stateful_code_sessions,
      ];
      const req = createMockReq(capabilities);
      req.body = {};
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      process.env.LIBRECHAT_CODE_BASEURL_STATEFUL = 'http://code-stateful.test/v1';

      try {
        const result = await loadToolsForExecution({
          req,
          res: {},
          conversationId: 'resolved-api-conversation',
          agent: {
            id: 'stateful-agent',
            tools: [Tools.execute_code],
            stateful_code_sessions: true,
            stateful_code_environment: 'conversation',
          },
          toolNames: [AgentConstants.READ_FILE],
          actionsEnabled: false,
        });

        expect(result.configurable.codeExecutionContext.executionProfile).toBe('stateful');
        expect(mockResolveCodeExecutionContext).toHaveBeenLastCalledWith(
          expect.objectContaining({
            statefulSessions: true,
            conversationId: 'resolved-api-conversation',
          }),
        );
      } finally {
        delete process.env.LIBRECHAT_CODE_BASEURL_STATEFUL;
      }
    });

    it('does not expose removed run_file_ocr through native Steel tool execution', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 2,
        memoryCheckpointTurnIndex: 1,
        currentTurnFiles: [
          {
            fileId: 'file-1',
            filename: 'drawing.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig([AgentCapabilities.tools]));

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['run_file_ocr'],
        streamId: 'stream-1',
        actionsEnabled: false,
      });
      const ocrTool = result.loadedTools.find((tool) => tool.name === 'run_file_ocr');

      expect(ocrTool).toBeUndefined();
      expect(mockEmitChunk).not.toHaveBeenCalledWith(
        'stream-1',
        expect.objectContaining({
          data: expect.objectContaining({ toolName: 'run_file_ocr' }),
        }),
      );
    });

    it('hard-stops quote-only delegation before any file, signer, rules, or model dependency', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const req = createMockReq([AgentCapabilities.tools]);
      req.steelNativeContext = {
        delegateOcrPolicy: { resolved: true, allowed: false, allowedFileKeys: [] },
        delegateOcrContext: {
          history: [new HumanMessage('第35頁報價')],
          modelOptions: { model: 'gpt-5.6-luna' },
          steelConversation: {
            currentUserTurn: { role: 'user', content: '第35頁報價' },
            activeHistory: [{ role: 'user', content: '第35頁報價' }],
          },
        },
      };

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      expect(result.loadedTools.find((entry) => entry.name === 'delegate_ocr')).toBeUndefined();
      expect(result.configurable).not.toHaveProperty('delegateOcrStreaming');
      expect(mockGetFiles).not.toHaveBeenCalled();
      expect(mockGetStrategyFunctions).not.toHaveBeenCalled();
    });

    it('hard-stops delegate OCR for mixed inspection and quote intent', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.steelNativeContext = {
        delegateOcrPolicy: { resolved: true, allowed: false, allowedFileKeys: [] },
        delegateOcrContext: {
          modelOptions: { model: 'gpt-5.6-luna' },
          steelConversation: {
            currentUserTurn: { role: 'user', content: '重新核對第 35 頁孔數後報價' },
            activeHistory: [{ role: 'user', content: '重新核對第 35 頁孔數後報價' }],
          },
        },
      };

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      expect(result.loadedTools.find((entry) => entry.name === 'delegate_ocr')).toBeUndefined();
      expect(result.configurable).not.toHaveProperty('delegateOcrStreaming');
      expect(mockGetFiles).not.toHaveBeenCalled();
      expect(mockGetStrategyFunctions).not.toHaveBeenCalled();
    });

    it('removes delegate_ocr when request policy is unavailable', async () => {
      const req = createMockReq([AgentCapabilities.tools]);

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      const tool = result.loadedTools.find((entry) => entry.name === 'delegate_ocr');

      expect(result.configurable).not.toHaveProperty('delegateOcrStreaming');
      expect(tool).toBeUndefined();
    });
  });

  /**
   * `AgentCapabilities` is the instance-wide switch; `FILE_SEARCH`/`RUN_CODE` are
   * the per-role grants. A tool has to clear both, on the definitions path and the
   * runtime path alike — otherwise a denied user is handed a definition the model
   * will call and the loader will refuse.
   */
  describe('loadAgentTools — tool role permission gating', () => {
    const capabilities = [
      AgentCapabilities.tools,
      AgentCapabilities.file_search,
      AgentCapabilities.execute_code,
      AgentCapabilities.web_search,
    ];

    const denyPermission = (deniedType) =>
      mockGetRoleByName.mockResolvedValue(
        buildRole({ [deniedType]: { [Permissions.USE]: false } }),
      );

    beforeEach(() => {
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
    });

    /** Dropping `execute_code` from the tool list is not enough: this flag also
     *  reaches tool classification and the programmatic bash tool, either of
     *  which would otherwise run code for a role denied `RUN_CODE`. */

    it('primes resources only for tools surviving role filtering', async () => {
      denyPermission(PermissionTypes.FILE_SEARCH);

      await expect(
        loadAgentTools({
          req: createMockReq(capabilities),
          res: {},
          agent: { id: 'agent_123', tools: [Tools.file_search, Tools.execute_code] },
          tool_resources: {
            [EToolResources.file_search]: { file_ids: ['denied-search-file'] },
            [EToolResources.execute_code]: { file_ids: ['code-file'] },
          },
          definitionsOnly: true,
        }),
      ).resolves.toBeDefined();

      expect(mockPrimeCodeFiles).toHaveBeenCalledTimes(1);
      expect(mockPrimeSearchFiles).not.toHaveBeenCalled();
    });
  });
});
