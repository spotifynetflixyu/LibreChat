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
  StepEvents,
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
const mockFindMissingPaddleOcrFileKeys = jest.fn();
const mockCapturePaddleOcrResult = jest.fn();
const mockReadOcrPreprocessingState = jest.fn();
const mockCapturePaddleOcrChunkResult = jest.fn();
const mockCaptureOcrPreprocessingChunkMarkdown = jest.fn();
const mockRunOcrPreprocessingBatchPipeline = jest.fn();
const mockBuildPdfPageChunks = jest.fn();
const mockGetPdfPageCount = jest.fn();
const mockCreatePdfPageRangeChunk = jest.fn();
const mockCreatePdfPageRangeChunker = jest.fn();
const mockEnsurePdfChunkArtifacts = jest.fn();
const mockLoadExistingPdfChunkArtifacts = jest.fn();
const mockCreateMongooseOcrPdfChunkArtifactRepository = jest.fn();
const mockGetS3DownloadURLForKey = jest.fn();
const mockS3ObjectExistsByKey = jest.fn();
const mockSaveBufferToS3StorageKey = jest.fn();
const mockGetCloudFrontDownloadURLForKey = jest.fn();
const mockCloudFrontObjectExistsByKey = jest.fn();
const mockSaveBufferToCloudFrontStorageKey = jest.fn();
const mockCreateSteelContextDependencies = jest.fn();
const mockBuildDefaultSteelGlobalAgentContext = jest.fn();
const mockCreateOpenAIOAuthModel = jest.fn();
const mockGetPaddleOcrResultError = jest.fn((...args) =>
  jest.requireActual('@librechat/api').getPaddleOcrResultError(...args),
);
const mockBuildSteelPaddleOcrPreflightEventEnvelopes = jest.fn(() => [
  {
    event: 'steel_event',
    data: {
      type: 'memory_saved',
      source: 'paddleocr_preflight',
      message: 'Saved PaddleOCR preflight',
      savedCounts: { paddleocr_preflight: 1 },
    },
  },
]);
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
  getPaddleOcrResultError: (...args) => mockGetPaddleOcrResultError(...args),
  createSteelPostgresPool: jest.fn(() => ({ query: jest.fn() })),
  createMongooseSteelWorkingOrderMemoryWriter: jest.fn(() => ({
    captureToolResult: jest.fn(),
    findMissingPaddleOcrFileKeys: (...args) => mockFindMissingPaddleOcrFileKeys(...args),
    capturePaddleOcrResult: (...args) => mockCapturePaddleOcrResult(...args),
    readOcrPreprocessingState: (...args) => mockReadOcrPreprocessingState(...args),
    capturePaddleOcrChunkResult: (...args) => mockCapturePaddleOcrChunkResult(...args),
    captureOcrPreprocessingChunkMarkdown: (...args) =>
      mockCaptureOcrPreprocessingChunkMarkdown(...args),
  })),
  runOcrPreprocessingBatchPipeline: (...args) => mockRunOcrPreprocessingBatchPipeline(...args),
  getPaddleOcrResultContent: (result) => {
    if (typeof result === 'string') {
      return result;
    }
    if (result?.content) {
      return result.content;
    }
    if (result?.text) {
      return result.text;
    }
    return JSON.stringify(result ?? '');
  },
  resolveOcrPreprocessingChunkSizePages: jest.fn(() => 50),
  buildPdfPageChunks: (...args) => mockBuildPdfPageChunks(...args),
  getPdfPageCount: (...args) => mockGetPdfPageCount(...args),
  createPdfPageRangeChunker: (...args) => mockCreatePdfPageRangeChunker(...args),
  ensurePdfChunkArtifacts: (...args) => mockEnsurePdfChunkArtifacts(...args),
  loadExistingPdfChunkArtifacts: (...args) => mockLoadExistingPdfChunkArtifacts(...args),
  createMongooseOcrPdfChunkArtifactRepository: (...args) =>
    mockCreateMongooseOcrPdfChunkArtifactRepository(...args),
  getS3DownloadURLForKey: (...args) => mockGetS3DownloadURLForKey(...args),
  s3ObjectExistsByKey: (...args) => mockS3ObjectExistsByKey(...args),
  saveBufferToS3StorageKey: (...args) => mockSaveBufferToS3StorageKey(...args),
  getCloudFrontDownloadURLForKey: (...args) => mockGetCloudFrontDownloadURLForKey(...args),
  cloudFrontObjectExistsByKey: (...args) => mockCloudFrontObjectExistsByKey(...args),
  saveBufferToCloudFrontStorageKey: (...args) => mockSaveBufferToCloudFrontStorageKey(...args),
  createSteelContextDependencies: (...args) => mockCreateSteelContextDependencies(...args),
  buildDefaultSteelGlobalAgentContext: (...args) =>
    mockBuildDefaultSteelGlobalAgentContext(...args),
  createOpenAIOAuthModel: (...args) => mockCreateOpenAIOAuthModel(...args),
  normalizeDelegateOcrChunk: (content) => {
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
        return typeof part?.text === 'string' ? part.text : '';
      })
      .join('');
  },
  createSteelNativeTool: ({ nativeToolName, steelToolName, execute }) => ({
    name: nativeToolName,
    invoke: (args, config) =>
      execute({
        toolName: steelToolName,
        arguments: args,
        providerToolCallId: config?.toolCall?.id,
      }),
  }),
  buildSteelPaddleOcrPreflightEventEnvelopes: (...args) =>
    mockBuildSteelPaddleOcrPreflightEventEnvelopes(...args),
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
  runSteelPaddleOcrPreflight,
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
const { reinitMCPServer } = require('~/server/services/Tools/mcp');

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

function createMockOcrBatchResult(
  input,
  markdown = '| 項次 | 品名規格 |\n| --- | --- |\n| 1 | OCR |',
  metadata = {},
) {
  return {
    files: (input.files ?? []).map((entry) => ({
      file: entry.file,
      status: 'completed',
      markdown,
      chunkCount: metadata.chunkCount ?? entry.chunks?.[0]?.chunkCount ?? entry.chunks?.length ?? 0,
      pageRanges:
        metadata.pageRanges ??
        (String(entry.file?.mediaType ?? '')
          .toLowerCase()
          .startsWith('image/')
          ? []
          : (entry.chunks ?? []).map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd }))),
    })),
  };
}

function createMockPaddleOcrPreflightReq(file) {
  const req = createMockReq([AgentCapabilities.tools]);
  req.body = { conversationId: 'convo-1' };
  req.steelNativeContext = {
    requestId: 'resp-1',
    assistantTurnIndex: 4,
    memoryCheckpointTurnIndex: 3,
    currentTurnFiles: [file],
  };
  return req;
}

function mockSingleFilePaddleOcrPipeline(
  file,
  markdown = '| OCR |\n| --- |\n| OCR result |',
  metadata,
) {
  const ocrFileKey = `file:${file.fileId}`;
  mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
    completedKeys: [],
    missingFiles: [
      {
        ocrFileKey,
        fileId: file.fileId,
        filename: file.filename,
        mediaType: file.mediaType,
      },
    ],
    missingKeys: [ocrFileKey],
  });
  mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => {
    const pipelineFileInput = input.files[0];
    const chunk = {
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 1,
      chunkSizePages: 50,
    };
    await input.paddleOcr.runChunk({
      file: pipelineFileInput.file,
      chunk,
      artifact: {
        ...chunk,
        filepath: `https://files.example.test/${file.filename}`,
        storageKey: `ocr/${file.filename}`,
      },
    });
    await input.onProgress({
      file: pipelineFileInput.file,
      progress: {
        stage: 'paddleocr_chunk_saved',
        chunkIndex: 1,
        chunkCount: 1,
      },
    });
    return createMockOcrBatchResult(input, markdown, metadata);
  });
}

function mockPaddleOcrToolLoads(...invokes) {
  for (const invoke of invokes) {
    mockLoadToolsUtil.mockResolvedValueOnce({
      loadedTools: [
        {
          name: `paddleocr_vl${Constants.mcp_delimiter}PaddleOCR`,
          invoke,
        },
      ],
      toolContextMap: {},
    });
  }
}

function setupSequentialPaddleOcrPreflight() {
  const pdf = {
    fileId: 'pdf-interval',
    filename: 'interval.pdf',
    mediaType: 'application/pdf',
  };
  const image = {
    fileId: 'image-interval',
    filename: 'interval.jpg',
    mediaType: 'image/jpeg',
    filepath: 'https://files.example.test/interval.jpg',
  };
  const req = createMockReq([AgentCapabilities.tools]);
  req.user = { id: 'user_123', tenantId: 'tenant-a' };
  req.body = { conversationId: 'convo-interval' };
  req.steelNativeContext = {
    requestId: 'resp-interval',
    assistantTurnIndex: 4,
    memoryCheckpointTurnIndex: 3,
    currentTurnFiles: [pdf, image],
  };
  mockGetFiles.mockResolvedValueOnce([
    {
      file_id: pdf.fileId,
      filename: pdf.filename,
      filepath: 'https://files.example.test/interval.pdf',
      storageKey: 'uploads/user_123/pdf-interval__interval.pdf',
      source: 's3',
      type: pdf.mediaType,
      bytes: 1234,
      user: 'user_123',
      tenantId: 'tenant-a',
    },
  ]);
  mockGetPdfPageCount.mockResolvedValueOnce(2);
  const pdfChunks = [
    { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 1, chunkSizePages: 50 },
    { chunkIndex: 2, chunkCount: 2, pageStart: 2, pageEnd: 2, chunkSizePages: 50 },
  ];
  mockBuildPdfPageChunks.mockReturnValueOnce(pdfChunks);
  const invokeTimes = [];
  const invoke = jest.fn().mockImplementation(async () => {
    invokeTimes.push(performance.now());
    return { content: 'OCR' };
  });
  mockPaddleOcrToolLoads(invoke);
  mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => {
    const pdfInput = input.files[0];
    const imageInput = input.files[1];
    const run = (entry, chunk, suffix) =>
      input.paddleOcr.runChunk({
        file: entry.file,
        chunk,
        artifact: {
          ...chunk,
          filepath: `https://files.example.test/${suffix}`,
          storageKey: `ocr/${suffix}`,
        },
      });
    await run(pdfInput, pdfInput.chunks[0], 'interval-chunk-1.pdf');
    await run(pdfInput, pdfInput.chunks[1], 'interval-chunk-2.pdf');
    await run(imageInput, imageInput.chunks[0], 'interval-image.jpg');
    return createMockOcrBatchResult(input);
  });
  return { req, invoke, invokeTimes };
}

function mockPaddleOcrBatchWithOrganizer(
  organizerInputs,
  artifactUrl = 'https://files.example.test/ocr-input.pdf',
) {
  mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => {
    const pipelineFileInput = input.files[0];
    const chunk = {
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 1,
      chunkSizePages: 50,
    };
    try {
      const raw = await input.paddleOcr.runChunk({
        file: pipelineFileInput.file,
        chunk,
        artifact: {
          ...chunk,
          filepath: artifactUrl,
          storageKey: `ocr/${artifactUrl.split('/').pop()}`,
        },
      });
      await input.memory.capturePaddleOcrChunkResult({
        conversationId: input.conversationId,
        requestId: input.requestId,
        file: pipelineFileInput.file,
        chunk,
        rawResultHash: raw.rawResultHash,
        data: raw.rawResult,
      });
      await input.onProgress({
        file: pipelineFileInput.file,
        progress: { stage: 'paddleocr_chunk_saved', chunkIndex: 1, chunkCount: 1 },
      });
      const organizerInput = {
        ocrRulesText: input.ocrRulesText,
        rawOcrText: raw.rawOcrText,
        sourceFile: pipelineFileInput.file.filename,
        artifactUrl:
          raw.artifact?.filepath ?? `https://files.example.test/${pipelineFileInput.file.filename}`,
        mediaType: pipelineFileInput.file.mediaType,
        fileKey: pipelineFileInput.file.ocrFileKey,
        ...(String(pipelineFileInput.file.mediaType ?? '')
          .toLowerCase()
          .startsWith('image/')
          ? {}
          : {
              pageStart: chunk.pageStart,
              pageEnd: chunk.pageEnd,
              chunkIndex: chunk.chunkIndex,
              chunkCount: chunk.chunkCount,
            }),
      };
      organizerInputs.push(organizerInput);
      const organized = await input.organizer.organize(organizerInput);
      return {
        files: [
          {
            file: pipelineFileInput.file,
            status: 'completed',
            markdown: organized.markdown,
            chunkCount: 1,
            pageRanges: String(pipelineFileInput.file.mediaType ?? '')
              .toLowerCase()
              .startsWith('image/')
              ? []
              : [{ pageStart: 1, pageEnd: 1 }],
          },
        ],
      };
    } catch (error) {
      return {
        files: [
          {
            file: pipelineFileInput.file,
            status: 'failed',
            stage: 'paddleocr',
            chunkIndex: 1,
            pageStart: 1,
            pageEnd: 1,
            errorMessage: error.message,
            failures: [
              {
                stage: 'paddleocr',
                chunkIndex: 1,
                pageStart: 1,
                pageEnd: 1,
                errorMessage: error.message,
              },
            ],
          },
        ],
      };
    }
  });
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
    mockFindMissingPaddleOcrFileKeys.mockResolvedValue({
      completedKeys: [],
      missingFiles: [],
      missingKeys: [],
    });
    mockCapturePaddleOcrResult.mockResolvedValue({ savedCounts: { paddleocr_preflight: 1 } });
    mockReadOcrPreprocessingState.mockResolvedValue({
      ocrFileKey: 'file:file-ocr',
      sourcePdfKey: 'uploads/user/file-ocr.pdf',
      pipelineVersion: 1,
      ocrRuleVersion: 'ocr-rules:test',
      chunkSizePages: 50,
      chunkCount: 0,
      chunks: [],
    });
    mockCapturePaddleOcrChunkResult.mockResolvedValue({
      savedCounts: { paddleocr_preflight: 1 },
    });
    mockCaptureOcrPreprocessingChunkMarkdown.mockResolvedValue({
      savedCounts: { ocr_extract: 1 },
    });
    mockRunOcrPreprocessingBatchPipeline.mockImplementation(async (input) =>
      createMockOcrBatchResult(input),
    );
    mockBuildPdfPageChunks.mockReturnValue([
      {
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 1,
        chunkSizePages: 50,
      },
    ]);
    mockGetPdfPageCount.mockResolvedValue(1);
    mockCreatePdfPageRangeChunk.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    mockCreatePdfPageRangeChunker.mockResolvedValue((range) => mockCreatePdfPageRangeChunk(range));
    mockEnsurePdfChunkArtifacts.mockResolvedValue([
      {
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 1,
        chunkSizePages: 50,
        filepath: 'https://files.example.test/chunk.pdf',
        storageKey: 'ocr-preprocessing/source/v1/pages-000001-000001.pdf',
        source: 's3',
      },
    ]);
    mockLoadExistingPdfChunkArtifacts.mockResolvedValue([
      {
        sourcePdfKey: 'uploads/user/file-ocr.pdf',
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 1,
        chunkSizePages: 50,
        filepath: 'https://files.example.test/chunk.pdf',
        storageKey: 'ocr-preprocessing/source/v1/pages-000001-000001.pdf',
        source: 's3',
      },
    ]);
    mockCreateMongooseOcrPdfChunkArtifactRepository.mockReturnValue({
      findBySourcePdfKey: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      compareAndSetArtifactFilepath: jest.fn(async ({ filepath }) => filepath),
    });
    mockGetS3DownloadURLForKey.mockResolvedValue('https://files.example.test/original.pdf');
    mockS3ObjectExistsByKey.mockResolvedValue({ exists: false });
    mockSaveBufferToS3StorageKey.mockResolvedValue({ bytes: 1234, storageRegion: 'us-east-1' });
    mockGetCloudFrontDownloadURLForKey.mockResolvedValue('https://cdn.example.test/original.pdf');
    mockCloudFrontObjectExistsByKey.mockResolvedValue({ exists: false });
    mockSaveBufferToCloudFrontStorageKey.mockResolvedValue({
      bytes: 1234,
      storageRegion: 'us-east-1',
    });
    mockCreateSteelContextDependencies.mockReturnValue({
      listOtherGlobalRules: jest.fn().mockResolvedValue({
        ocrSharedRules: [
          {
            slug: 'steel-ocr-shared-policy',
            title: 'Steel OCR shared',
            ruleType: 'other',
            ruleSections: ['ocr_shared'],
            prompt: ['[ocr_shared]', 'Shared OCR evidence policy', '[/ocr_shared]'].join('\n'),
            toolPolicy: {},
            outputPolicy: {},
          },
        ],
        ocrVisionRules: [
          {
            slug: 'steel-vision-policy',
            title: 'Vision processing rule',
            ruleType: 'other',
            ruleSections: ['vision_processing'],
            prompt: '[vision_processing]\nVision rule must reach Organizer\n[/vision_processing]',
          },
        ],
        ocrMainRules: [
          {
            slug: 'steel-main-policy',
            title: 'OCR main rule',
            ruleType: 'other',
            ruleSections: ['ocr_main_flow'],
            prompt: '[ocr_main_merge]\nMain rule must not reach Organizer\n[/ocr_main_merge]',
          },
        ],
        ocrOrganizerRules: [
          {
            slug: 'steel-ocr-subagent-organizer-policy',
            title: 'Steel OCR organizer',
            ruleType: 'other',
            ruleSections: ['ocr_organizer'],
            prompt: ['[ocr_organizer]', 'OCR rules text', '[/ocr_organizer]'].join('\n'),
            toolPolicy: {},
            outputPolicy: {},
          },
        ],
        fileRules: [],
        sourcePriorityRules: [],
        markdownOutputRules: [],
      }),
    });
    mockCreateOpenAIOAuthModel.mockReset();
    mockCreateOpenAIOAuthModel.mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: 'organized OCR Markdown' }),
    });
    mockInitializeModel.mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: '| OCR |\n| --- |\n| organized |' }),
    });
    mockBuildDefaultSteelGlobalAgentContext.mockResolvedValue({
      instructionPrefix: [
        '[ocr_shared]\nOCR_RULE\n[/ocr_shared]',
        '[vision_processing]\nVISION_RULE\n[/vision_processing]',
        '[final_ocr_markdown]\nOCR_MAIN_RULE\n[/final_ocr_markdown]',
      ].join('\n'),
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

    it('routes every current OCR-capable file through the preprocessing pipeline', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      const signal = new AbortController().signal;
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          { fileId: 'file-a', filename: 'a.pdf', mediaType: 'application/pdf' },
          { fileId: 'file-b', filename: 'b.png', mediaType: 'image/png' },
          { fileId: 'file-c', filename: 'c.pdf', mediaType: 'application/pdf' },
        ],
      };
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => {
        await input.onProgress({
          file: input.files[0].file,
          progress: { stage: 'paddleocr_chunk_loaded', chunkIndex: 1, chunkCount: 1 },
        });
        return createMockOcrBatchResult(input);
      });

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal,
        streamId: 'stream-1',
      });

      expect(mockFindMissingPaddleOcrFileKeys).not.toHaveBeenCalled();
      expect(mockLoadToolsUtil).not.toHaveBeenCalled();
      expect(mockCapturePaddleOcrResult).not.toHaveBeenCalled();
      expect(mockBuildSteelPaddleOcrPreflightEventEnvelopes).toHaveBeenCalledWith(
        expect.objectContaining({
          preflight: expect.objectContaining({
            status: 'completed',
            paddleOcrSavedCount: 0,
          }),
        }),
      );
      expect(mockRunOcrPreprocessingBatchPipeline).toHaveBeenCalledTimes(1);
      expect(mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0].signal).toBe(signal);
      expect(req.steelNativeContext.steelHistory.activityEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'parse_status',
            parseStatus: 'partial',
          }),
        ]),
      );
      expect(
        mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0].files.map(
          ({ file }) => file.ocrFileKey,
        ),
      ).toEqual(['file:file-a', 'file:file-b', 'file:file-c']);
      expect(
        mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0].files.map(
          ({ file }) => file.sourceCode,
        ),
      ).toEqual(['F1', 'F2', 'F3']);
      expect(result).toEqual({
        status: 'completed',
        ocrTurnActive: true,
        completedKeys: ['file:file-a', 'file:file-b', 'file:file-c'],
        attemptedKeys: ['file:file-a', 'file:file-b', 'file:file-c'],
        failedKeys: [],
        skippedReason: undefined,
        currentOcrSourceFileMapping: [
          { sourceCode: 'F1', sourceFilename: '' },
          { sourceCode: 'F2', sourceFilename: '' },
          { sourceCode: 'F3', sourceFilename: '' },
        ],
        currentPaddleOcrResults: [],
        currentOcrMarkdownResults: expect.arrayContaining([
          expect.objectContaining({
            ocrFileKey: 'file:file-a',
            sourceCode: 'F1',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
            content: expect.stringContaining('<file:file-a>'),
          }),
          expect.objectContaining({
            ocrFileKey: 'file:file-b',
            sourceCode: 'F2',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
            content: expect.stringContaining('<file:file-b>'),
          }),
          expect.objectContaining({
            ocrFileKey: 'file:file-c',
            sourceCode: 'F3',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
            content: expect.stringContaining('<file:file-c>'),
          }),
        ]),
      });
    });

    it('keeps request-scoped source codes stable across failures and partial results', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-source-codes' };
      req.steelNativeContext = {
        requestId: 'resp-source-codes',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          { fileId: 'file-a', filename: 'a.png', mediaType: 'image/png' },
          { fileId: 'file-b', filename: 'b.png', mediaType: 'image/png' },
          { fileId: 'file-c', filename: 'c.png', mediaType: 'image/png' },
        ],
      };
      mockGetFiles.mockResolvedValueOnce([
        { file_id: 'file-a', filename: 'persisted-a.png' },
        { file_id: 'file-b', filename: 'persisted-b.png' },
        { file_id: 'file-c', filename: 'persisted-c.png' },
      ]);
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => {
        const [first, second, third] = input.files;
        await input.memory.capturePaddleOcrChunkResult({
          conversationId: input.conversationId,
          requestId: input.requestId,
          turnIndex: 4,
          checkpointTurnIndex: 3,
          file: first.file,
          chunk: {
            pipelineVersion: 1,
            sourcePdfKey: first.file.sourcePdfKey,
            chunkIndex: 1,
            chunkCount: 1,
            pageStart: 1,
            pageEnd: 1,
            pdfChunk: {
              source: 's3',
              storageKey: 'ocr/source-code-test.png',
              filepath: 'https://files.example.test/source-code-test.png',
            },
          },
          rawResultHash: 'source-code-test-hash',
          data: { text: 'raw OCR' },
        });
        return {
          files: [
            {
              file: first.file,
              status: 'failed',
              errorMessage: 'first file failed',
              failures: [{ stage: 'paddleocr', errorMessage: 'first file failed' }],
            },
            {
              file: second.file,
              status: 'failed',
              errorMessage: 'second file partial',
              failures: [{ stage: 'organizer', errorMessage: 'second file partial' }],
              partial: {
                markdown: '| OCR |\n| --- |\n| partial |',
                chunkCount: 1,
                pageRanges: [],
              },
            },
            {
              file: third.file,
              status: 'completed',
              markdown: '| OCR |\n| --- |\n| success |',
              chunkCount: 1,
              pageRanges: [],
            },
          ],
        };
      });

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(
        mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0].files.map(
          ({ file }) => file.sourceCode,
        ),
      ).toEqual(['F1', 'F2', 'F3']);
      expect(mockCapturePaddleOcrChunkResult).toHaveBeenCalledWith(
        expect.objectContaining({
          file: expect.not.objectContaining({ sourceCode: 'F1' }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          completedKeys: ['file:file-c'],
          failedKeys: ['file:file-a', 'file:file-b'],
          currentOcrFailures: [
            expect.objectContaining({
              ocrFileKey: 'file:file-a',
              sourceCode: 'F1',
              sourceFilename: 'persisted-a.png',
            }),
            expect.objectContaining({
              ocrFileKey: 'file:file-b',
              sourceCode: 'F2',
              sourceFilename: 'persisted-b.png',
            }),
          ],
          currentOcrMarkdownResults: [
            expect.objectContaining({
              ocrFileKey: 'file:file-b',
              sourceCode: 'F2',
              sourceFilename: 'persisted-b.png',
            }),
            expect.objectContaining({
              ocrFileKey: 'file:file-c',
              sourceCode: 'F3',
              sourceFilename: 'persisted-c.png',
            }),
          ],
          currentOcrSourceFileMapping: [
            { sourceCode: 'F1', sourceFilename: 'persisted-a.png' },
            { sourceCode: 'F2', sourceFilename: 'persisted-b.png' },
            { sourceCode: 'F3', sourceFilename: 'persisted-c.png' },
          ],
        }),
      );
    });

    it('uses the owner-scoped persisted filename for OCR source mapping', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-source-filename' };
      req.steelNativeContext = {
        requestId: 'resp-source-filename',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'file-db-name',
            filename: 'request-name.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'file-db-name',
          filename: 'persisted-name.pdf',
          filepath: 'https://files.example.test/uploads/file-db-name.pdf',
          storageKey: 'uploads/user_123/file-db-name.pdf',
          source: 's3',
          type: 'application/pdf',
          user: 'user_123',
        },
      ]);

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(result.currentOcrSourceFileMapping).toEqual([
        { sourceCode: 'F1', sourceFilename: 'persisted-name.pdf' },
      ]);
      expect(result.currentOcrMarkdownResults?.[0]).toEqual(
        expect.objectContaining({
          filename: 'request-name.pdf',
          sourceFilename: 'persisted-name.pdf',
        }),
      );
    });

    it('fails closed when loaded OCR organizer rules are malformed', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'image-malformed-rules',
            filename: 'malformed-rules.png',
            mediaType: 'image/png',
            storageKey: 'uploads/user/image-malformed-rules.png',
          },
        ],
      };
      mockCreateSteelContextDependencies.mockReturnValueOnce({
        listOtherGlobalRules: jest.fn().mockResolvedValue({
          ocrSharedRules: [],
          ocrVisionRules: [],
          ocrMainRules: [],
          ocrOrganizerRules: [
            {
              slug: 'malformed-organizer-rule',
              title: 'Malformed organizer rule',
              ruleType: 'other',
              ruleSections: ['ocr_organizer'],
              prompt: 'Organizer instructions without required markers',
            },
          ],
        }),
      });

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(mockRunOcrPreprocessingBatchPipeline).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          failedKeys: ['file:image-malformed-rules'],
          currentOcrFailures: [
            expect.objectContaining({
              errorMessage: expect.stringMatching(/organizer rule markers/u),
            }),
          ],
        }),
      );
    });

    it('uses the empty-rule fallback only when OCR rules cannot be loaded', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'image-unavailable-rules',
            filename: 'unavailable-rules.png',
            mediaType: 'image/png',
            storageKey: 'uploads/user/image-unavailable-rules.png',
          },
        ],
      };
      mockCreateSteelContextDependencies.mockReturnValueOnce({
        listOtherGlobalRules: jest.fn().mockRejectedValue(new Error('rule database unavailable')),
      });

      await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(mockRunOcrPreprocessingBatchPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          ocrRulesText: '',
          ocrRuleVersion: 'ocr-rules:unavailable',
        }),
      );
    });

    it('routes current PDFs through the OCR preprocessing pipeline instead of whole-file raw injection', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'pdf-1',
            filename: 'quote.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
        completedKeys: ['file:pdf-1'],
        missingFiles: [],
        missingKeys: [],
      });
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'pdf-1',
          filename: 'quote.pdf',
          filepath: 'https://files.example.test/uploads/user_123/pdf-1__quote.pdf',
          storageKey: 'uploads/user_123/pdf-1__quote.pdf',
          source: 's3',
          type: 'application/pdf',
          bytes: 1234,
          user: 'user_123',
          tenantId: 'tenant-a',
        },
      ]);
      mockGetPdfPageCount.mockResolvedValueOnce(75);
      const pageChunks = [
        {
          chunkIndex: 1,
          chunkCount: 2,
          pageStart: 1,
          pageEnd: 50,
          chunkSizePages: 50,
        },
        {
          chunkIndex: 2,
          chunkCount: 2,
          pageStart: 51,
          pageEnd: 75,
          chunkSizePages: 50,
        },
      ];
      mockBuildPdfPageChunks.mockReturnValueOnce(pageChunks);
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) =>
        createMockOcrBatchResult(input, '| 項次 | 品名規格 |\n| --- | --- |\n| 1 | PL-100 |'),
      );

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(mockGetFiles).toHaveBeenCalledWith(
        {
          file_id: { $in: ['pdf-1'] },
          user: 'user_123',
          tenantId: 'tenant-a',
        },
        {},
        {},
      );
      expect(mockGetPdfPageCount).toHaveBeenCalledWith({
        pdfBytes: expect.any(Buffer),
      });
      expect(mockBuildPdfPageChunks).toHaveBeenCalledWith({ pageCount: 75, chunkSizePages: 50 });
      expect(mockRunOcrPreprocessingBatchPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'convo-1',
          files: [
            expect.objectContaining({
              file: expect.objectContaining({
                ocrFileKey: 'file:pdf-1',
                fileId: 'pdf-1',
                filename: 'quote.pdf',
                mediaType: 'application/pdf',
                sourcePdfKey: 'uploads/user_123/pdf-1__quote.pdf',
                storageKey: 'uploads/user_123/pdf-1__quote.pdf',
              }),
              chunks: pageChunks,
            }),
          ],
          ocrRulesText: expect.stringContaining('OCR rules text'),
          ocrRuleVersion: expect.stringMatching(/^ocr-rules:/),
        }),
      );
      const pipelineInput = mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0];
      expect(pipelineInput.ocrRulesText).toContain('OCR rules text');
      expect(pipelineInput.ocrRulesText).toContain('[ocr_organizer]');
      expect(pipelineInput.ocrRulesText).toContain('[ocr_shared]');
      expect(pipelineInput.ocrRulesText).not.toContain('Main-agent OCR rerun policy');
      expect(pipelineInput.ocrRulesText).toContain('Vision rule must reach Organizer');
      expect(pipelineInput.ocrRulesText).not.toContain('Main rule must not reach Organizer');
      expect(pipelineInput.ocrRulesText).not.toContain('steel-ocr-shared-policy');
      expect(pipelineInput.ocrRulesText).not.toContain('ruleSections:');
      const pipelineFileInput = pipelineInput.files[0];
      expect(typeof pipelineFileInput.artifacts.ensurePdfChunkArtifacts).toBe('function');
      expect(typeof pipelineInput.memory.capturePaddleOcrChunkResult).toBe('function');
      expect(typeof pipelineInput.organizer.organize).toBe('function');
      expect(typeof pipelineInput.paddleOcr.runChunk).toBe('function');
      expect(mockLoadToolsUtil).not.toHaveBeenCalled();
      expect(mockCapturePaddleOcrResult).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'completed',
        ocrTurnActive: true,
        completedKeys: ['file:pdf-1'],
        attemptedKeys: ['file:pdf-1'],
        failedKeys: [],
        skippedReason: undefined,
        currentOcrSourceFileMapping: [{ sourceCode: 'F1', sourceFilename: 'quote.pdf' }],
        currentPaddleOcrResults: [],
        currentOcrMarkdownResults: [
          expect.objectContaining({
            ocrFileKey: 'file:pdf-1',
            fileId: 'pdf-1',
            filename: 'quote.pdf',
            mediaType: 'application/pdf',
            storageKey: 'uploads/user_123/pdf-1__quote.pdf',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
            ocrPreprocessing: expect.objectContaining({
              chunkCount: 2,
              pageRanges: [
                { pageStart: 1, pageEnd: 50 },
                { pageStart: 51, pageEnd: 75 },
              ],
              source: 'paddleocr_markdowns',
              sourcePdfKey: 'uploads/user_123/pdf-1__quote.pdf',
            }),
            content: '<file:pdf-1>\n| 項次 | 品名規格 |\n| --- | --- |\n| 1 | PL-100 |',
          }),
        ],
      });
    });

    it('omits malformed OCR page ranges instead of retaining a partial subset', async () => {
      const file = {
        fileId: 'pdf-malformed-ranges',
        filename: 'malformed-ranges.jpg',
        mediaType: 'image/jpeg',
      };
      const req = createMockPaddleOcrPreflightReq(file);
      mockSingleFilePaddleOcrPipeline(file, '| OCR |\n| --- |\n| malformed |', {
        chunkCount: 2,
        pageRanges: [
          { pageStart: 1, pageEnd: 10 },
          { pageStart: 12, pageEnd: 20 },
        ],
      });
      mockPaddleOcrToolLoads(jest.fn().mockResolvedValue({ text: 'OCR' }));

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(result.currentOcrMarkdownResults?.[0]?.ocrPreprocessing).toEqual(
        expect.objectContaining({ chunkCount: 2, pageRanges: [] }),
      );
    });

    it('uses the original PDF artifact for PDFs under 50 pages while keeping OCR markdown flow', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-small-pdf' };
      req.steelNativeContext = {
        requestId: 'resp-small-pdf',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'pdf-small',
            filename: 'small.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
        completedKeys: ['file:pdf-small'],
        missingFiles: [],
        missingKeys: [],
      });
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'pdf-small',
          filename: 'small.pdf',
          filepath: 'https://files.example.test/uploads/user_123/pdf-small__small.pdf',
          storageKey: 'uploads/user_123/pdf-small__small.pdf',
          source: 's3',
          type: 'application/pdf',
          bytes: 987,
          user: 'user_123',
          tenantId: 'tenant-a',
        },
      ]);
      mockGetPdfPageCount.mockResolvedValueOnce(49);
      const pageChunks = [
        {
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 1,
          pageEnd: 49,
          chunkSizePages: 50,
        },
      ];
      mockBuildPdfPageChunks.mockReturnValueOnce(pageChunks);
      mockGetS3DownloadURLForKey.mockResolvedValueOnce(
        'https://files.example.test/original-small.pdf',
      );
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) =>
        createMockOcrBatchResult(input, '| 項次 | 品名規格 |\n| --- | --- |\n| 1 | SMALL |'),
      );

      await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      const pipelineInput = mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0];
      const pipelineFileInput = pipelineInput.files[0];
      const artifacts = await pipelineFileInput.artifacts.ensurePdfChunkArtifacts({
        file: pipelineFileInput.file,
        sourcePdfKey: pipelineFileInput.file.sourcePdfKey,
        chunks: pageChunks,
      });

      expect(mockBuildPdfPageChunks).toHaveBeenCalledWith({ pageCount: 49, chunkSizePages: 50 });
      expect(mockEnsurePdfChunkArtifacts).not.toHaveBeenCalled();
      expect(mockCreatePdfPageRangeChunk).not.toHaveBeenCalled();
      expect(mockGetS3DownloadURLForKey).toHaveBeenCalledWith({
        storageKey: 'uploads/user_123/pdf-small__small.pdf',
        contentType: 'application/pdf',
      });
      expect(artifacts).toEqual([
        expect.objectContaining({
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 1,
          pageEnd: 49,
          sourcePdfKey: 'uploads/user_123/pdf-small__small.pdf',
          source: 's3',
          storageKey: 'uploads/user_123/pdf-small__small.pdf',
          filepath: 'https://files.example.test/original-small.pdf',
          filename: 'small.pdf',
          bytes: 987,
          contentType: 'application/pdf',
        }),
      ]);
      const artifactRepository =
        mockCreateMongooseOcrPdfChunkArtifactRepository.mock.results.at(-1)?.value;
      expect(artifactRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePdfKey: 'uploads/user_123/pdf-small__small.pdf',
          sourceStorageKey: 'uploads/user_123/pdf-small__small.pdf',
          sourceFileId: 'pdf-small',
          pipelineVersion: 1,
          pageStart: 1,
          pageEnd: 49,
          artifact: expect.objectContaining({
            storageKey: 'uploads/user_123/pdf-small__small.pdf',
            filepath: 'https://files.example.test/original-small.pdf',
          }),
        }),
      );
      expect(mockRunOcrPreprocessingBatchPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [
            expect.objectContaining({
              chunks: pageChunks,
            }),
          ],
          paddleOcr: expect.objectContaining({ runChunk: expect.any(Function) }),
          organizer: expect.objectContaining({ organize: expect.any(Function) }),
        }),
      );
    });

    it('keeps URL-only original PDF artifacts when refreshing without signing', async () => {
      const filepath = 'https://files.example.test/url-only.pdf';
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-url-only' };
      req.steelNativeContext = {
        requestId: 'resp-url-only',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'pdf-url-only',
            filename: 'url-only.pdf',
            mediaType: 'application/pdf',
            filepath,
          },
        ],
      };

      await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      const pipelineInput = mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0];
      const pipelineFileInput = pipelineInput.files[0];
      const chunk = {
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 1,
        chunkSizePages: 50,
      };
      const artifacts = await pipelineFileInput.artifacts.ensurePdfChunkArtifacts({
        file: pipelineFileInput.file,
        chunks: [chunk],
      });
      const refreshed = await pipelineFileInput.artifacts.refreshPdfChunkArtifact({
        file: pipelineFileInput.file,
        chunk,
        artifact: artifacts[0],
      });

      expect(artifacts[0]).toEqual(expect.objectContaining({ storageKey: filepath, filepath }));
      expect(refreshed).toBe(artifacts[0]);
      expect(mockGetS3DownloadURLForKey).not.toHaveBeenCalled();
    });

    it('fails closed when a canonical original PDF object is missing', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-missing-original' };
      req.steelNativeContext = {
        requestId: 'resp-missing-original',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'pdf-missing-original',
            filename: 'missing-original.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      const sourcePdfKey = 'uploads/user_123/pdf-missing-original__missing-original.pdf';
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'pdf-missing-original',
          filename: 'missing-original.pdf',
          filepath: 'https://files.example.test/missing-original.pdf',
          storageKey: sourcePdfKey,
          source: 's3',
          type: 'application/pdf',
          bytes: 987,
          user: 'user_123',
          tenantId: 'tenant-a',
        },
      ]);
      const chunk = {
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 49,
        chunkSizePages: 50,
      };
      const row = {
        sourcePdfKey,
        pipelineVersion: 1,
        ...chunk,
        artifact: {
          source: 's3',
          storageKey: sourcePdfKey,
          filepath: 'https://files.example.test/expired-original.pdf',
          filename: 'missing-original.pdf',
          bytes: 987,
          contentType: 'application/pdf',
        },
      };
      const repository = {
        findBySourcePdfKey: jest.fn().mockResolvedValue([row]),
        upsert: jest.fn(),
        compareAndSetArtifactFilepath: jest.fn(),
      };
      mockCreateMongooseOcrPdfChunkArtifactRepository.mockReturnValueOnce(repository);
      mockGetPdfPageCount.mockResolvedValueOnce(49);
      mockBuildPdfPageChunks.mockReturnValueOnce([chunk]);
      mockS3ObjectExistsByKey.mockResolvedValueOnce({ exists: false });
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) =>
        createMockOcrBatchResult(input),
      );

      await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      const pipelineInput = mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0];
      await expect(
        pipelineInput.files[0].artifacts.ensurePdfChunkArtifacts({
          file: pipelineInput.files[0].file,
          sourcePdfKey,
          chunks: [chunk],
        }),
      ).rejects.toThrow('canonical original PDF object is missing');
      expect(mockGetS3DownloadURLForKey).not.toHaveBeenCalled();
      expect(repository.compareAndSetArtifactFilepath).not.toHaveBeenCalled();
    });

    it('emits compact PaddleOCR chunk tool output while preserving raw result for DB capture', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'pdf-1',
            filename: 'quote.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      req._resumableJobCreatedAt = 1000;
      mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
        completedKeys: ['file:pdf-1'],
        missingFiles: [],
        missingKeys: [],
      });
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'pdf-1',
          filename: 'quote.pdf',
          filepath: 'https://files.example.test/uploads/user_123/pdf-1__quote.pdf',
          storageKey: 'uploads/user_123/pdf-1__quote.pdf',
          source: 's3',
          type: 'application/pdf',
          bytes: 1234,
          user: 'user_123',
          tenantId: 'tenant-a',
        },
      ]);
      mockGetPdfPageCount.mockResolvedValueOnce(50);
      const pageChunks = [
        {
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 1,
          pageEnd: 50,
          chunkSizePages: 50,
        },
      ];
      const rawContent = `raw OCR provider payload ${'R'.repeat(2048)}`;
      const paddleInvoke = jest.fn().mockResolvedValueOnce({
        type: 'tool',
        content: rawContent,
      });
      mockBuildPdfPageChunks.mockReturnValueOnce(pageChunks);
      mockLoadToolsUtil.mockResolvedValueOnce({
        loadedTools: [
          {
            name: `paddleocr_vl${Constants.mcp_delimiter}PaddleOCR`,
            invoke: paddleInvoke,
          },
        ],
        configurable: { mcpConfig: true },
        toolContextMap: {},
      });
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => {
        const pipelineFileInput = input.files[0];
        const raw = await input.paddleOcr.runChunk({
          file: pipelineFileInput.file,
          chunk: pageChunks[0],
          artifact: {
            ...pageChunks[0],
            filepath: 'https://files.example.test/chunk-1.pdf',
            storageKey: 'ocr/chunk-1.pdf',
            source: 's3',
          },
        });
        await input.memory.capturePaddleOcrChunkResult({
          conversationId: input.conversationId,
          requestId: input.requestId,
          providerToolCallId: 'ocr_preprocessing_chunk_1',
          turnIndex: 4,
          checkpointTurnIndex: 3,
          file: pipelineFileInput.file,
          chunk: {
            ...pageChunks[0],
            sourcePdfKey: pipelineFileInput.file.sourcePdfKey,
            pdfChunk: {
              source: 's3',
              storageKey: 'ocr/chunk-1.pdf',
              filepath: 'https://files.example.test/chunk-1.pdf',
            },
          },
          rawResultHash: raw.rawResultHash,
          data: raw.rawResult,
        });
        return createMockOcrBatchResult(input, '| item |\n| --- |\n| ok |');
      });

      const preflightResult = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      const completedEvents = mockEmitChunk.mock.calls
        .map(([, event]) => event)
        .filter((event) => event.event === StepEvents.ON_RUN_STEP_COMPLETED);
      const completedOutput = completedEvents[0]?.data?.result?.tool_call?.output ?? '';
      const parsedOutput = JSON.parse(completedOutput);

      expect(paddleInvoke).toHaveBeenCalledWith(
        {
          input_data: 'https://files.example.test/chunk-1.pdf',
          output_mode: 'detailed',
          return_images: false,
          runtime_params: {
            use_doc_orientation_classify: true,
            use_doc_unwarping: true,
            use_layout_detection: true,
          },
        },
        expect.any(Object),
      );
      expect(completedOutput).not.toContain(rawContent);
      expect(parsedOutput).toEqual(
        expect.objectContaining({
          status: 'completed',
          paddleocr: 'ok',
          ocrEngine: 'paddleocr_vl',
          ocrFileKey: 'file:pdf-1',
          filename: 'quote.pdf',
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 1,
          pageEnd: 50,
          rawTextLength: rawContent.length,
          outputStorage: 'steel_working_order_memory:paddleocr_preflight',
        }),
      );
      expect(preflightResult.currentPaddleOcrStatuses).toEqual([
        {
          paddleocr: 'ok',
          ocrFileKey: 'file:pdf-1',
          filename: 'quote.pdf',
          mediaType: 'application/pdf',
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 1,
          pageEnd: 50,
        },
      ]);
      expect(req.steelNativeContext.steelHistory.preflightToolCalls).toHaveLength(1);
      expect(req.steelNativeContext.steelHistory.preflightToolCalls[0]).toEqual(
        expect.objectContaining({
          type: 'tool_call',
          id: expect.stringContaining('steel_paddleocr_preflight_'),
          name: `paddleocr_vl${Constants.mcp_delimiter}PaddleOCR`,
          progress: 1,
        }),
      );
      const persistedSuccessOutput = JSON.parse(
        req.steelNativeContext.steelHistory.preflightToolCalls[0].output,
      );
      expect(persistedSuccessOutput).toEqual({
        status: 'ok',
        paddleocr: 'ok',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:pdf-1',
        filename: 'quote.pdf',
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 50,
        dataSizeBytes: Buffer.byteLength(rawContent, 'utf8'),
      });
      expect(req.steelNativeContext.steelHistory.preflightToolCalls[0].args.input_data).toBe(
        'https://files.example.test/chunk-1.pdf',
      );
      expect(mockUpdateGenerationMetadata).toHaveBeenCalledWith(
        'stream-1',
        {
          steelHistory: expect.objectContaining({
            activityEvents: expect.any(Array),
            preflightToolCalls: expect.any(Array),
          }),
        },
        1000,
      );
      expect(mockEmitChunk).toHaveBeenCalled();
      for (const [, , options] of mockEmitChunk.mock.calls) {
        expect(options).toEqual({ expectedCreatedAt: 1000 });
      }
      expect(
        mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0].memory.capturePaddleOcrChunkResult,
      ).toBeDefined();
    });

    it('returns PDF preparation failures to the OCR/Vision fallback turn', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          { fileId: 'pdf-prepare', filename: 'prepare.pdf', mediaType: 'application/pdf' },
        ],
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'pdf-prepare',
          filename: 'prepare.pdf',
          filepath: 'https://files.example.test/uploads/user_123/pdf-prepare__prepare.pdf',
          storageKey: 'uploads/user_123/pdf-prepare__prepare.pdf',
          source: 's3',
          type: 'application/pdf',
          bytes: 1234,
          user: 'user_123',
          tenantId: 'tenant-a',
        },
      ]);
      mockGetPdfPageCount.mockRejectedValueOnce(new Error('invalid PDF'));

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          ocrTurnActive: true,
          attemptedKeys: ['file:pdf-prepare'],
          failedKeys: ['file:pdf-prepare'],
        }),
      );
      expect(mockRunOcrPreprocessingBatchPipeline).not.toHaveBeenCalled();
    });

    it('returns OCR organizer failures to the OCR/Vision fallback turn', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'pdf-1',
            filename: 'quote.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
        completedKeys: ['file:pdf-1'],
        missingFiles: [],
        missingKeys: [],
      });
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'pdf-1',
          filename: 'quote.pdf',
          filepath: 'https://files.example.test/uploads/user_123/pdf-1__quote.pdf',
          storageKey: 'uploads/user_123/pdf-1__quote.pdf',
          source: 's3',
          type: 'application/pdf',
          bytes: 1234,
          user: 'user_123',
          tenantId: 'tenant-a',
        },
      ]);
      mockGetPdfPageCount.mockResolvedValueOnce(25);
      mockBuildPdfPageChunks.mockReturnValueOnce([
        {
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 1,
          pageEnd: 25,
          chunkSizePages: 50,
        },
      ]);
      mockRunOcrPreprocessingBatchPipeline.mockRejectedValueOnce(new Error('organizer timeout'));

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          ocrTurnActive: true,
          attemptedKeys: ['file:pdf-1'],
          failedKeys: ['file:pdf-1'],
        }),
      );
      expect(result).not.toHaveProperty('currentOcrMarkdownResults');
      expect(mockEmitChunk.mock.calls.map(([, event]) => event)).toEqual(
        expect.arrayContaining([
          {
            event: 'steel_event',
            data: expect.objectContaining({
              type: 'parse_status',
              source: 'ocr_preprocessing',
              parseStatus: 'partial',
              errorMessage: 'organizer timeout',
              failedKeys: ['file:pdf-1'],
            }),
          },
        ]),
      );
    });

    it('preserves completed organizer Markdown when another file in the batch fails', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          { fileId: 'pdf-a', filename: 'a.pdf', mediaType: 'application/pdf' },
          { fileId: 'pdf-b', filename: 'b.pdf', mediaType: 'application/pdf' },
        ],
      };
      mockGetFiles.mockResolvedValueOnce(
        ['a', 'b'].map((suffix) => ({
          file_id: `pdf-${suffix}`,
          filename: `${suffix}.pdf`,
          filepath: `https://files.example.test/uploads/user_123/pdf-${suffix}.pdf`,
          storageKey: `uploads/user_123/pdf-${suffix}.pdf`,
          source: 's3',
          type: 'application/pdf',
          bytes: 1234,
          user: 'user_123',
          tenantId: 'tenant-a',
        })),
      );
      const readCounts = new Map();
      mockReadOcrPreprocessingState.mockImplementation(async (input) => {
        const count = (readCounts.get(input.ocrFileKey) ?? 0) + 1;
        readCounts.set(input.ocrFileKey, count);
        const base = {
          ocrFileKey: input.ocrFileKey,
          sourcePdfKey: input.sourcePdfKey,
          pipelineVersion: 1,
          ocrRuleVersion: input.ocrRuleVersion,
          chunkSizePages: 50,
          chunkCount: count > 1 && input.ocrFileKey === 'file:pdf-a' ? 1 : 0,
        };
        if (count > 1 && input.ocrFileKey === 'file:pdf-a') {
          return {
            ...base,
            chunks: [
              {
                chunkIndex: 1,
                chunkCount: 1,
                pageStart: 1,
                pageEnd: 1,
                chunkSizePages: 50,
                rawSaved: true,
                organizedSaved: true,
                organizedMarkdown: '| file | value |\n|---|---|\n| A | organized |',
              },
            ],
          };
        }
        return { ...base, chunks: [] };
      });
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => ({
        files: [
          {
            file: input.files[0].file,
            status: 'completed',
            chunkCount: 1,
            markdown: '| file | value |\n|---|---|\n| A | organized |',
          },
          {
            file: input.files[1].file,
            status: 'failed',
            stage: 'paddleocr',
            chunkIndex: 1,
            pageStart: 1,
            pageEnd: 1,
            errorMessage: 'file B failed',
            partial: {
              markdown: '| file | value |\n|---|---|\n| B | organized pages 51-100 |',
              pageRanges: [{ pageStart: 51, pageEnd: 100 }],
              chunkCount: 1,
            },
            failures: [
              {
                stage: 'paddleocr',
                chunkIndex: 1,
                pageStart: 1,
                pageEnd: 50,
                fileUrl: 'storage:private/chunk-1.pdf',
                errorMessage: 'file B chunk 1 failed',
              },
              {
                stage: 'paddleocr',
                chunkIndex: 3,
                pageStart: 101,
                pageEnd: 120,
                errorMessage: 'file B chunk 3 failed',
              },
            ],
          },
        ],
      }));

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          ocrTurnActive: true,
          completedKeys: ['file:pdf-a'],
          failedKeys: ['file:pdf-b'],
          currentOcrMarkdownResults: [
            expect.objectContaining({
              ocrFileKey: 'file:pdf-a',
              content: expect.stringContaining('| A | organized |'),
            }),
            expect.objectContaining({
              ocrFileKey: 'file:pdf-b',
              fileId: 'pdf-b',
              filename: 'b.pdf',
              mediaType: 'application/pdf',
              content: expect.stringContaining('| B | organized pages 51-100 |'),
              ocrPreprocessing: expect.objectContaining({
                partial: true,
                chunkCount: 1,
                pageRanges: [{ pageStart: 51, pageEnd: 100 }],
              }),
            }),
          ],
          currentOcrFailures: [
            expect.objectContaining({
              ocrFileKey: 'file:pdf-b',
              pageStart: 1,
              pageEnd: 50,
              fileUrl: 'https://files.example.test/uploads/user_123/pdf-b.pdf',
            }),
            expect.objectContaining({ ocrFileKey: 'file:pdf-b', pageStart: 101, pageEnd: 120 }),
          ],
        }),
      );
      expect(mockEmitChunk.mock.calls.map(([, event]) => event)).toEqual(
        expect.arrayContaining([
          {
            event: 'steel_event',
            data: expect.objectContaining({
              type: 'parse_status',
              source: 'ocr_preprocessing',
              failedKeys: ['file:pdf-b'],
              missingPageRangesByFileKey: {
                'file:pdf-b': [
                  { pageStart: 1, pageEnd: 50 },
                  { pageStart: 101, pageEnd: 120 },
                ],
              },
            }),
          },
        ]),
      );
    });

    it('keeps organizer failures active without exposing raw OCR to the main turn', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.user = { id: 'user_123', tenantId: 'tenant-a' };
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'pdf-1',
            filename: 'quote.pdf',
            mediaType: 'application/pdf',
          },
        ],
      };
      const pageChunk = {
        chunkIndex: 2,
        chunkCount: 3,
        pageStart: 51,
        pageEnd: 100,
        chunkSizePages: 50,
      };
      const invoke = jest.fn().mockRejectedValueOnce(new Error('terminated'));
      mockCreateOpenAIOAuthModel.mockReturnValueOnce({ invoke });
      mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
        completedKeys: ['file:pdf-1'],
        missingFiles: [],
        missingKeys: [],
      });
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'pdf-1',
          filename: 'quote.pdf',
          filepath: 'https://files.example.test/uploads/user_123/pdf-1__quote.pdf',
          storageKey: 'uploads/user_123/pdf-1__quote.pdf',
          source: 's3',
          type: 'application/pdf',
          bytes: 1234,
          user: 'user_123',
          tenantId: 'tenant-a',
        },
      ]);
      mockGetPdfPageCount.mockResolvedValueOnce(106);
      mockBuildPdfPageChunks.mockReturnValueOnce([pageChunk]);
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => {
        await input.organizer.organize({
          ocrRulesText: input.ocrRulesText,
          rawOcrText: 'raw chunk OCR text',
          sourceFile: 'quote.pdf',
          artifactUrl: 'https://files.example.test/quote-pages-51-100.pdf',
          mediaType: 'application/pdf',
          fileKey: 'file:pdf-1',
          pageStart: pageChunk.pageStart,
          pageEnd: pageChunk.pageEnd,
          chunkIndex: pageChunk.chunkIndex,
          chunkCount: pageChunk.chunkCount,
        });
        return createMockOcrBatchResult(input, '| OCR |\n| --- |\n| organized after retry |');
      });
      reinitMCPServer.mockResolvedValue({ availableTools: null });

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          ocrTurnActive: true,
          failedKeys: ['file:pdf-1'],
        }),
      );
      expect(JSON.stringify(result)).not.toContain('raw chunk OCR text');
    });

    it('encodes the exact PDF chunk for a frontend-selected OpenAI Organizer model', async () => {
      const file = {
        fileId: 'file-openai-pdf',
        filename: 'openai.pdf',
        mediaType: 'application/pdf',
      };
      const req = createMockPaddleOcrPreflightReq(file);
      const paddleInvoke = jest.fn().mockResolvedValue({ content: 'OpenAI PDF OCR text' });
      const organizerInvoke = jest
        .fn()
        .mockResolvedValue({ content: '| OCR |\n| --- |\n| organized OpenAI PDF |' });
      const organizerInputs = [];
      mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
        completedKeys: [],
        missingFiles: [],
        missingKeys: [`file:${file.fileId}`],
      });
      mockPaddleOcrToolLoads(paddleInvoke);
      mockPaddleOcrBatchWithOrganizer(
        organizerInputs,
        'https://files.example.test/quote-pages-51-100.pdf',
      );
      mockInitializeModel.mockReturnValueOnce({ invoke: organizerInvoke });
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('%PDF-1.7 exact chunk'),
      });

      try {
        const result = await runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: {
            id: 'agent_123',
            provider: EModelEndpoint.openAI,
            model: 'gpt-5.4',
            model_parameters: {
              model: 'gpt-5.4',
              max_tokens: 32000,
              reasoning_effort: 'high',
            },
          },
          signal: new AbortController().signal,
          streamId: 'stream-1',
        });

        expect(fetchSpy).toHaveBeenCalledWith(
          'https://files.example.test/quote-pages-51-100.pdf',
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(mockInitializeModel).toHaveBeenCalledWith({
          provider: EModelEndpoint.openAI,
          clientOptions: expect.objectContaining({
            model: 'gpt-5.4',
            max_tokens: 32000,
            reasoning_effort: 'high',
          }),
        });
        const organizerMessage = JSON.stringify(organizerInvoke.mock.calls[0][0]);
        expect(organizerMessage).toContain('data:application/pdf;base64,JVBERi0xLjc');
        expect(organizerMessage).not.toContain('https://files.example.test/quote-pages-51-100.pdf');
        expect(result).toEqual(expect.objectContaining({ status: 'completed' }));
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('lets the preprocessing pipeline reuse persisted organizer chunk Markdown', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [{ fileId: 'file-a', filename: 'a.pdf', mediaType: 'application/pdf' }],
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'file-a',
          filename: 'a.pdf',
          filepath: 'https://files.example.test/uploads/user_123/file-a__a.pdf',
          storageKey: 'uploads/user_123/file-a__a.pdf',
          source: 's3',
          type: 'application/pdf',
          bytes: 1234,
          user: 'user_123',
        },
      ]);
      mockReadOcrPreprocessingState.mockResolvedValueOnce({
        chunkCount: 3,
        chunks: [1, 2, 3].map((chunkIndex) => ({
          chunkIndex,
          chunkCount: 3,
          pageStart: chunkIndex,
          pageEnd: chunkIndex,
          chunkSizePages: 50,
          rawSaved: true,
          organizedSaved: true,
          organizedMarkdown: `| OCR |\n| --- |\n| chunk ${chunkIndex} |`,
        })),
      });
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) =>
        createMockOcrBatchResult(input, '| OCR |\n| --- |\n| Official |'),
      );

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(mockCapturePaddleOcrResult).not.toHaveBeenCalled();
      expect(mockFindMissingPaddleOcrFileKeys).not.toHaveBeenCalled();
      expect(mockGetPdfPageCount).not.toHaveBeenCalled();
      expect(mockGetStrategyFunctions).not.toHaveBeenCalled();
      expect(mockBuildPdfPageChunks).not.toHaveBeenCalled();
      expect(mockRunOcrPreprocessingBatchPipeline).toHaveBeenCalledTimes(1);
      expect(mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0].files[0].chunks).toEqual([
        expect.objectContaining({
          chunkIndex: 1,
          chunkCount: 3,
          pageStart: 1,
          pageEnd: 1,
        }),
        expect.objectContaining({ chunkIndex: 2, chunkCount: 3 }),
        expect.objectContaining({ chunkIndex: 3, chunkCount: 3 }),
      ]);
      expect(result).toEqual({
        status: 'completed',
        ocrTurnActive: true,
        completedKeys: ['file:file-a'],
        attemptedKeys: ['file:file-a'],
        failedKeys: [],
        skippedReason: undefined,
        currentOcrSourceFileMapping: [{ sourceCode: 'F1', sourceFilename: 'a.pdf' }],
        currentPaddleOcrResults: [],
        currentOcrMarkdownResults: [
          expect.objectContaining({
            ocrFileKey: 'file:file-a',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
          }),
        ],
      });
    });

    it('reuses complete organized OCR preprocessing state before downloading PDFs', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [{ fileId: 'file-a', filename: 'a.pdf', mediaType: 'application/pdf' }],
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'file-a',
          filename: 'a.pdf',
          filepath: 'https://files.example.test/uploads/user_123/file-a__a.pdf',
          storageKey: 'uploads/user_123/file-a__a.pdf',
          source: 's3',
          type: 'application/pdf',
          bytes: 1234,
          user: 'user_123',
        },
      ]);
      const savedChunks = [
        {
          chunkIndex: 1,
          chunkCount: 2,
          pageStart: 1,
          pageEnd: 50,
          chunkSizePages: 50,
          rawSaved: true,
          organizedSaved: true,
          organizedMarkdown: '| OCR |\n| --- |\n| Chunk 1 |',
        },
        {
          chunkIndex: 2,
          chunkCount: 2,
          pageStart: 51,
          pageEnd: 75,
          chunkSizePages: 50,
          rawSaved: true,
          organizedSaved: true,
          organizedMarkdown: '| OCR |\n| --- |\n| Chunk 2 |',
        },
      ];
      mockReadOcrPreprocessingState.mockResolvedValueOnce({
        ocrFileKey: 'file:file-a',
        sourcePdfKey: 'uploads/user_123/file-a__a.pdf',
        pipelineVersion: 1,
        ocrRuleVersion: 'ocr-rules:test',
        chunkSizePages: 50,
        chunkCount: 2,
        chunks: savedChunks,
      });
      mockBuildSteelPaddleOcrPreflightEventEnvelopes.mockReturnValueOnce([
        {
          event: 'steel_event',
          data: {
            type: 'parse_status',
            source: 'paddleocr_preflight',
            message: 'Reused PaddleOCR preflight',
            parseStatus: 'saved',
          },
        },
      ]);
      const res = { writableEnded: false, write: jest.fn() };

      const result = await runSteelPaddleOcrPreflight({
        req,
        res,
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(mockGetPdfPageCount).not.toHaveBeenCalled();
      expect(mockGetStrategyFunctions).not.toHaveBeenCalled();
      expect(mockBuildPdfPageChunks).not.toHaveBeenCalled();
      expect(mockLoadToolsUtil).not.toHaveBeenCalled();
      expect(mockCreateOpenAIOAuthModel).not.toHaveBeenCalled();
      expect(mockBuildSteelPaddleOcrPreflightEventEnvelopes).toHaveBeenCalledWith(
        expect.objectContaining({
          preflight: expect.objectContaining({
            attemptedKeys: ['file:file-a'],
            paddleOcrSavedCount: 0,
          }),
        }),
      );
      expect(res.write.mock.calls.map(([chunk]) => JSON.parse(chunk.split('data: ')[1]))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              message: 'Reused PaddleOCR preflight',
              parseStatus: 'saved',
            }),
          }),
        ]),
      );
      expect(mockRunOcrPreprocessingBatchPipeline).toHaveBeenCalledTimes(1);
      expect(mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0].files[0].chunks).toEqual([
        expect.objectContaining({
          chunkIndex: 1,
          chunkCount: 2,
          pageStart: 1,
          pageEnd: 50,
          chunkSizePages: 50,
        }),
        expect.objectContaining({
          chunkIndex: 2,
          chunkCount: 2,
          pageStart: 51,
          pageEnd: 75,
          chunkSizePages: 50,
        }),
      ]);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'completed',
          completedKeys: ['file:file-a'],
          currentPaddleOcrResults: [],
          currentOcrMarkdownResults: [
            expect.objectContaining({
              ocrFileKey: 'file:file-a',
              ocrPreprocessing: expect.objectContaining({ chunkCount: 2 }),
            }),
          ],
        }),
      );
    });

    it('does not save PaddleOCR failures as completed OCR and keeps the fallback turn active', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          { fileId: 'file-fallback', filename: 'fallback.pdf', mediaType: 'application/pdf' },
        ],
      };
      mockRunOcrPreprocessingBatchPipeline.mockRejectedValueOnce(new Error('provider timeout'));

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          ocrTurnActive: true,
          attemptedKeys: ['file:file-fallback'],
          failedKeys: ['file:file-fallback'],
        }),
      );

      expect(mockCapturePaddleOcrResult).not.toHaveBeenCalled();
      expect(mockBuildSteelPaddleOcrPreflightEventEnvelopes).toHaveBeenCalledWith(
        expect.objectContaining({
          preflight: expect.objectContaining({
            status: 'partial',
            paddleOcrSavedCount: 0,
          }),
        }),
      );
      expect(mockEmitChunk.mock.calls.map(([, event]) => event)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'steel_event',
            data: expect.objectContaining({
              source: 'ocr_preprocessing',
              errorMessage: 'provider timeout',
            }),
          }),
        ]),
      );
    });

    it('rebuilds and retries PaddleOCR preflight after a sequential provider connection reset', async () => {
      const file = { fileId: 'file-second', filename: 'second.jpg', mediaType: 'image/jpeg' };
      const req = createMockPaddleOcrPreflightReq(file);
      const firstInvoke = jest
        .fn()
        .mockRejectedValueOnce(
          new Error(
            'ClientConnectorError: Cannot connect to host paddleocr.aistudio-app.com:443 ssl:default [Connection reset by peer]',
          ),
        );
      const secondInvoke = jest.fn().mockResolvedValueOnce({ text: 'Second OCR' });
      mockSingleFilePaddleOcrPipeline(file, '| OCR |\n| --- |\n| Second OCR |');
      mockPaddleOcrToolLoads(firstInvoke, secondInvoke);

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(mockMCPManager.appConnections.disconnect).toHaveBeenCalledWith('PaddleOCR');
      expect(reinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          user: req.user,
          serverName: 'PaddleOCR',
          forceNew: true,
          returnOnOAuth: false,
        }),
      );
      expect(mockLoadToolsUtil).toHaveBeenCalledTimes(2);
      expect(firstInvoke).toHaveBeenCalledTimes(1);
      expect(secondInvoke).toHaveBeenCalledTimes(1);
      expect(mockCapturePaddleOcrResult).not.toHaveBeenCalled();
      expect(mockBuildSteelPaddleOcrPreflightEventEnvelopes).toHaveBeenCalledWith(
        expect.objectContaining({
          preflight: expect.objectContaining({
            status: 'completed',
            paddleOcrSavedCount: 1,
          }),
        }),
      );
      expect(result).toEqual({
        status: 'completed',
        ocrTurnActive: true,
        completedKeys: ['file:file-second'],
        attemptedKeys: ['file:file-second'],
        failedKeys: [],
        skippedReason: undefined,
        currentOcrSourceFileMapping: [{ sourceCode: 'F1', sourceFilename: '' }],
        currentPaddleOcrResults: [],
        currentPaddleOcrStatuses: [
          {
            paddleocr: 'ok',
            ocrFileKey: 'file:file-second',
            filename: 'second.jpg',
            mediaType: 'image/jpeg',
            chunkIndex: 1,
            chunkCount: 1,
          },
        ],
        currentOcrMarkdownResults: [
          expect.objectContaining({
            ocrFileKey: 'file:file-second',
            fileId: 'file-second',
            filename: 'second.jpg',
            mediaType: 'image/jpeg',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
            content: expect.stringContaining('Second OCR'),
          }),
        ],
      });
    });

    it('retries PaddleOCR error-content without rebuilding MCP and refreshes the input URL', async () => {
      const file = {
        fileId: 'file-error-content',
        filename: 'error-content.jpg',
        mediaType: 'image/jpeg',
      };
      const req = createMockPaddleOcrPreflightReq(file);
      const invoke = jest
        .fn()
        .mockResolvedValueOnce({
          status: 'success',
          content: "Error calling tool 'paddleocr_vl'",
        })
        .mockResolvedValueOnce({
          status: 'success',
          content: 'Recovered OCR text',
        });
      const organizerInputs = [];
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('%PDF-1.7'),
      });
      mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
        completedKeys: [],
        missingFiles: [],
        missingKeys: [`file:${file.fileId}`],
      });
      mockGetS3DownloadURLForKey.mockResolvedValueOnce(
        'https://files.example.test/refreshed-error-content.jpg',
      );
      mockPaddleOcrToolLoads(invoke);
      mockPaddleOcrBatchWithOrganizer(organizerInputs);

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: {
          id: 'agent_123',
          provider: 'openai_oauth_responses',
          model: 'gpt-5.6-luna',
          model_parameters: { model: 'gpt-5.6-luna' },
        },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke.mock.calls[0][0].input_data).toBe('https://files.example.test/ocr-input.pdf');
      expect(invoke.mock.calls[1][0].input_data).toBe(
        'https://files.example.test/refreshed-error-content.jpg',
      );
      expect(mockMCPManager.appConnections.disconnect).not.toHaveBeenCalled();
      expect(reinitMCPServer).not.toHaveBeenCalled();
      expect(mockLoadToolsUtil).toHaveBeenCalledTimes(1);
      expect(mockCapturePaddleOcrChunkResult).toHaveBeenCalledTimes(1);
      expect(organizerInputs).toEqual([
        expect.objectContaining({
          rawOcrText: 'Recovered OCR text',
          sourceFile: 'error-content.jpg',
          artifactUrl: 'https://files.example.test/refreshed-error-content.jpg',
          mediaType: 'image/jpeg',
          fileKey: 'file:file-error-content',
        }),
      ]);
      expect(organizerInputs[0]).not.toHaveProperty('pageStart');
      expect(organizerInputs[0]).not.toHaveProperty('pageRange');
      expect(organizerInputs[0]).not.toHaveProperty('sourceCode');
      expect(result).toEqual(
        expect.objectContaining({
          status: 'completed',
          ocrTurnActive: true,
          completedKeys: ['file:file-error-content'],
          failedKeys: [],
          currentOcrMarkdownResults: [
            expect.objectContaining({ content: expect.stringContaining('organized OCR Markdown') }),
          ],
        }),
      );
      fetchSpy.mockRestore();
    });

    it('retries explicit signed URL expiry without rebuilding MCP and refreshes the input URL', async () => {
      jest.useFakeTimers();
      try {
        const file = {
          fileId: 'file-signed-expired',
          filename: 'signed-expired.jpg',
          mediaType: 'image/jpeg',
        };
        const req = createMockPaddleOcrPreflightReq(file);
        const invoke = jest
          .fn()
          .mockResolvedValueOnce({ status: 'error', error: 'RequestExpired' })
          .mockResolvedValueOnce({ status: 'success', content: 'Recovered signed OCR' });
        const refreshedUrl = 'https://files.example.test/refreshed-signed-expired.jpg';
        mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
          completedKeys: [],
          missingFiles: [],
          missingKeys: [`file:${file.fileId}`],
        });
        mockGetS3DownloadURLForKey.mockResolvedValueOnce(refreshedUrl);
        mockPaddleOcrToolLoads(invoke);
        mockPaddleOcrBatchWithOrganizer([]);

        const resultPromise = runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: {
            id: 'agent_123',
            provider: 'openai_oauth_responses',
            model: 'gpt-5.6-luna',
            model_parameters: { model: 'gpt-5.6-luna' },
          },
          signal: new AbortController().signal,
          streamId: 'stream-1',
        });
        await jest.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.status).toBe('completed');
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(invoke.mock.calls[0][0].input_data).toBe('https://files.example.test/ocr-input.pdf');
        expect(invoke.mock.calls[1][0].input_data).toBe(refreshedUrl);
        expect(mockMCPManager.appConnections.disconnect).not.toHaveBeenCalled();
        expect(reinitMCPServer).not.toHaveBeenCalled();
        expect(mockLoadToolsUtil).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps error-content PaddleOCR failures recoverable without saving raw OCR or organizing it', async () => {
      const file = {
        fileId: 'file-error-content-failure',
        filename: 'error-content-failure.jpg',
        mediaType: 'image/jpeg',
      };
      const req = createMockPaddleOcrPreflightReq(file);
      const invoke = jest.fn().mockResolvedValue({
        status: 'success',
        content: "Error calling tool 'paddleocr_vl'",
      });
      const organizerInputs = [];
      mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
        completedKeys: [],
        missingFiles: [],
        missingKeys: [`file:${file.fileId}`],
      });
      mockPaddleOcrToolLoads(invoke);
      mockPaddleOcrBatchWithOrganizer(organizerInputs);

      jest.useFakeTimers();
      let result;
      try {
        const resultPromise = runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
          signal: new AbortController().signal,
          streamId: 'stream-1',
        });
        await jest.runAllTimersAsync();
        result = await resultPromise;
      } finally {
        jest.useRealTimers();
      }

      expect(invoke).toHaveBeenCalledTimes(3);
      expect(mockMCPManager.appConnections.disconnect).not.toHaveBeenCalled();
      expect(reinitMCPServer).not.toHaveBeenCalled();
      expect(mockCapturePaddleOcrResult).not.toHaveBeenCalled();
      expect(mockCapturePaddleOcrChunkResult).not.toHaveBeenCalled();
      expect(organizerInputs).toEqual([]);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          ocrTurnActive: true,
          completedKeys: [],
          failedKeys: ['file:file-error-content-failure'],
          currentOcrFailures: [
            expect.objectContaining({
              ocrFileKey: 'file:file-error-content-failure',
              errorMessage: expect.stringContaining("Error calling tool 'paddleocr_vl'"),
            }),
          ],
        }),
      );
      expect(result).not.toHaveProperty('currentOcrMarkdownResults');
      expect(mockEmitChunk.mock.calls.map(([, event]) => event)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'steel_event',
            data: expect.objectContaining({
              source: 'ocr_preprocessing',
              errorMessage: expect.stringContaining("Error calling tool 'paddleocr_vl'"),
            }),
          }),
        ]),
      );
    });

    it('uses two fixed retry waits and persists only typed PaddleOCR diagnostics', async () => {
      jest.useFakeTimers();
      try {
        const file = {
          fileId: 'file-diagnostic',
          filename: 'diagnostic.jpg',
          mediaType: 'image/jpeg',
        };
        const req = createMockPaddleOcrPreflightReq(file);
        const invokeError = new Error('PaddleOCR tool failed');
        Object.defineProperty(invokeError, 'diagnosticCode', {
          value: 'ai_studio_timeout',
          enumerable: false,
        });
        const invoke = jest.fn().mockRejectedValue(invokeError);
        mockSingleFilePaddleOcrPipeline(file);
        mockPaddleOcrToolLoads(invoke);

        const resultPromise = runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
          signal: new AbortController().signal,
          streamId: 'stream-1',
        });
        await jest.advanceTimersByTimeAsync(0);
        expect(invoke).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(2999);
        expect(invoke).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(invoke).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(2999);
        expect(invoke).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1);
        const result = await resultPromise;

        expect(invoke).toHaveBeenCalledTimes(3);
        expect(mockCapturePaddleOcrChunkResult).not.toHaveBeenCalled();
        expect(result.currentOcrFailures).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              diagnosticCode: 'ai_studio_timeout',
              stage: 'preflight',
            }),
          ]),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('waits one second between completed PaddleOCR tasks while keeping the first call immediate', async () => {
      jest.useFakeTimers();
      try {
        const { req, invoke, invokeTimes } = setupSequentialPaddleOcrPreflight();
        const resultPromise = runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
          signal: new AbortController().signal,
          streamId: 'stream-interval',
        });

        await jest.advanceTimersByTimeAsync(0);
        expect(invoke).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(999);
        expect(invoke).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(invoke).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(999);
        expect(invoke).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1);
        const result = await resultPromise;

        expect(invoke).toHaveBeenCalledTimes(3);
        expect(invokeTimes[0]).toBeDefined();
        expect(invokeTimes[1] - invokeTimes[0]).toBeGreaterThanOrEqual(1000);
        expect(invokeTimes[2] - invokeTimes[1]).toBeGreaterThanOrEqual(1000);
        expect(result.status).toBe('completed');
      } finally {
        jest.useRealTimers();
      }
    });

    it('aborts immediately while waiting between PaddleOCR tasks without starting the next invoke', async () => {
      jest.useFakeTimers();
      try {
        const { req, invoke } = setupSequentialPaddleOcrPreflight();
        const controller = new AbortController();
        const resultPromise = runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
          signal: controller.signal,
          streamId: 'stream-interval-abort',
        });

        await jest.advanceTimersByTimeAsync(0);
        expect(invoke).toHaveBeenCalledTimes(1);
        controller.abort();

        await expect(resultPromise).rejects.toMatchObject({
          name: 'AbortError',
          message: 'OCR task interval aborted',
        });
        expect(invoke).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('gives every PaddleOCR chunk call an independent ten-minute hard deadline', async () => {
      jest.useFakeTimers();
      const firstTimeoutController = new AbortController();
      const secondTimeoutController = new AbortController();
      const timeoutSignals = [firstTimeoutController.signal, secondTimeoutController.signal];
      const timeoutSpy = jest
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation(() => timeoutSignals.shift());
      const userController = new AbortController();
      try {
        const file = {
          fileId: 'file-hard-timeout',
          filename: 'hard-timeout.jpg',
          mediaType: 'image/jpeg',
        };
        const req = createMockPaddleOcrPreflightReq(file);
        const invokeSignals = [];
        const invoke = jest.fn((_args, config) => {
          invokeSignals.push(config.signal);
          return new Promise((_, reject) => {
            const rejectAbort = () => {
              reject(new Error('late provider failure after parent abort'));
            };
            if (config.signal.aborted) {
              rejectAbort();
              return;
            }
            config.signal.addEventListener('abort', rejectAbort, { once: true });
          });
        });
        mockSingleFilePaddleOcrPipeline(file);
        mockPaddleOcrToolLoads(invoke);

        const resultPromise = runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
          signal: userController.signal,
          streamId: 'stream-1',
        });
        await jest.advanceTimersByTimeAsync(0);

        expect(timeoutSpy).toHaveBeenNthCalledWith(1, 600_000);
        firstTimeoutController.abort();
        await jest.advanceTimersByTimeAsync(3000);

        expect(invoke).toHaveBeenCalledTimes(2);
        expect(timeoutSpy).toHaveBeenNthCalledWith(2, 600_000);
        expect(invokeSignals[1]).not.toBe(invokeSignals[0]);
        expect(invokeSignals[1].aborted).toBe(false);

        userController.abort(new Error('user cancelled'));
        await expect(resultPromise).rejects.toMatchObject({
          name: 'AbortError',
          message: 'user cancelled',
        });
      } finally {
        timeoutSpy.mockRestore();
        jest.useRealTimers();
      }
    });

    it('reports only final child statuses after adaptive PaddleOCR chunk recovery', async () => {
      jest.useFakeTimers();
      try {
        const file = {
          fileId: 'file-adaptive-status',
          filename: 'adaptive-status.pdf',
          mediaType: 'application/pdf',
        };
        const req = createMockPaddleOcrPreflightReq(file);
        mockFindMissingPaddleOcrFileKeys.mockResolvedValueOnce({
          completedKeys: [],
          missingFiles: [
            {
              ocrFileKey: `file:${file.fileId}`,
              fileId: file.fileId,
              filename: file.filename,
              mediaType: file.mediaType,
            },
          ],
          missingKeys: [`file:${file.fileId}`],
        });
        const invoke = jest
          .fn()
          .mockRejectedValueOnce(new Error('HTTP 408: parent timeout 1'))
          .mockRejectedValueOnce(new Error('HTTP 408: parent timeout 2'))
          .mockRejectedValueOnce(new Error('HTTP 408: parent timeout 3'))
          .mockResolvedValueOnce({ content: 'child one' })
          .mockResolvedValueOnce({ content: 'child two' });
        mockPaddleOcrToolLoads(invoke);
        mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) => {
          const pipelineFile = input.files[0].file;
          const runChunk = (chunk) =>
            input.paddleOcr.runChunk({
              file: pipelineFile,
              chunk,
              artifact: {
                ...chunk,
                filepath: `https://files.example.test/${chunk.pageStart}-${chunk.pageEnd}.pdf`,
                storageKey: `ocr/${chunk.pageStart}-${chunk.pageEnd}.pdf`,
              },
            });
          await expect(
            runChunk({
              chunkIndex: 1,
              chunkCount: 1,
              pageStart: 1,
              pageEnd: 50,
              chunkSizePages: 50,
            }),
          ).rejects.toMatchObject({ ocrAdaptiveSplitEligible: true });
          await runChunk({
            chunkIndex: 1,
            chunkCount: 2,
            pageStart: 1,
            pageEnd: 25,
            chunkSizePages: 25,
          });
          await runChunk({
            chunkIndex: 2,
            chunkCount: 2,
            pageStart: 26,
            pageEnd: 50,
            chunkSizePages: 25,
          });
          return {
            files: [
              {
                file: pipelineFile,
                status: 'completed',
                markdown: '| OCR |\n| --- |\n| recovered |',
                chunkCount: 2,
                pageRanges: [
                  { pageStart: 1, pageEnd: 25 },
                  { pageStart: 26, pageEnd: 50 },
                ],
              },
            ],
          };
        });

        const resultPromise = runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
          signal: new AbortController().signal,
          streamId: 'stream-1',
        });
        await jest.advanceTimersByTimeAsync(6000);
        expect(invoke).toHaveBeenCalledTimes(3);
        await jest.advanceTimersByTimeAsync(999);
        expect(invoke).toHaveBeenCalledTimes(3);
        await jest.advanceTimersByTimeAsync(1);
        expect(invoke).toHaveBeenCalledTimes(4);
        await jest.advanceTimersByTimeAsync(999);
        expect(invoke).toHaveBeenCalledTimes(4);
        await jest.advanceTimersByTimeAsync(1);
        const result = await resultPromise;

        expect(invoke).toHaveBeenCalledTimes(5);
        expect(result.currentPaddleOcrStatuses).toEqual([
          expect.objectContaining({
            paddleocr: 'ok',
            pageStart: 1,
            pageEnd: 25,
          }),
          expect.objectContaining({
            paddleocr: 'ok',
            pageStart: 26,
            pageEnd: 50,
          }),
        ]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('rebuilds and retries PaddleOCR preflight after connection establishment timeout', async () => {
      const file = { fileId: 'file-connect', filename: 'connect.jpg', mediaType: 'image/jpeg' };
      const req = createMockPaddleOcrPreflightReq(file);
      const firstInvoke = jest
        .fn()
        .mockRejectedValueOnce(new Error('Connection timeout after 30000ms'));
      const secondInvoke = jest.fn().mockResolvedValueOnce({ text: 'Connected OCR' });
      mockSingleFilePaddleOcrPipeline(file, '| OCR |\n| --- |\n| Connected OCR |');
      mockPaddleOcrToolLoads(firstInvoke, secondInvoke);

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(reinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          user: req.user,
          serverName: 'PaddleOCR',
          forceNew: true,
          returnOnOAuth: false,
        }),
      );
      expect(mockLoadToolsUtil).toHaveBeenCalledTimes(2);
      expect(firstInvoke).toHaveBeenCalledTimes(1);
      expect(secondInvoke).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'completed',
          completedKeys: ['file:file-connect'],
          failedKeys: [],
        }),
      );
    });

    it('does not rebuild or retry non-transient PaddleOCR provider errors', async () => {
      const file = { fileId: 'file-invalid', filename: 'invalid.jpg', mediaType: 'image/jpeg' };
      const req = createMockPaddleOcrPreflightReq(file);
      const providerError = new Error('invalid PaddleOCR authentication configuration; timeout');
      Object.defineProperty(providerError, 'diagnosticCode', {
        value: 'ai_studio_auth',
        enumerable: false,
      });
      const invoke = jest.fn().mockRejectedValueOnce(providerError);
      mockSingleFilePaddleOcrPipeline(file);
      mockPaddleOcrToolLoads(invoke);

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(mockLoadToolsUtil).toHaveBeenCalledTimes(1);
      expect(reinitMCPServer).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          failedKeys: ['file:file-invalid'],
          currentOcrFailures: [expect.objectContaining({ errorMessage: providerError.message })],
        }),
      );
      expect(result.currentPaddleOcrStatuses).toEqual([
        {
          paddleocr: 'fail',
          ocrFileKey: 'file:file-invalid',
          filename: 'invalid.jpg',
          mediaType: 'image/jpeg',
          chunkIndex: 1,
          chunkCount: 1,
        },
      ]);
      const failedChunkEvent = mockEmitChunk.mock.calls
        .map(([, event]) => event)
        .find((event) => event.event === StepEvents.ON_RUN_STEP_COMPLETED);
      expect(JSON.parse(failedChunkEvent.data.result.tool_call.output)).toEqual(
        expect.objectContaining({
          status: 'failed',
          paddleocr: 'fail',
          ocrFileKey: 'file:file-invalid',
          filename: 'invalid.jpg',
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 1,
          pageEnd: 1,
          attemptsUsed: 1,
          diagnosticCode: 'ai_studio_auth',
          errorMessage: providerError.message,
        }),
      );
      const persistedFailureOutput = JSON.parse(
        req.steelNativeContext.steelHistory.preflightToolCalls[0].output,
      );
      expect(persistedFailureOutput).toEqual({
        status: 'fail',
        paddleocr: 'fail',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:file-invalid',
        filename: 'invalid.jpg',
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 1,
        dataSizeBytes: Buffer.byteLength(failedChunkEvent.data.result.tool_call.output, 'utf8'),
        attemptsUsed: 1,
        errorCode: 'ai_studio_auth',
        error: providerError.message,
        errorMessage: providerError.message,
      });
    });

    it('keeps the provider error primary when rebuilding PaddleOCR fails', async () => {
      const file = { fileId: 'file-rebuild', filename: 'rebuild.jpg', mediaType: 'image/jpeg' };
      const req = createMockPaddleOcrPreflightReq(file);
      const providerError = new Error('Connection reset by peer');
      const rebuildError = new Error('PaddleOCR MCP reinitialization failed');
      const firstInvoke = jest.fn().mockRejectedValueOnce(providerError);
      mockSingleFilePaddleOcrPipeline(file);
      mockPaddleOcrToolLoads(firstInvoke);
      mockLoadToolsUtil.mockRejectedValueOnce(rebuildError);

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(firstInvoke).toHaveBeenCalledTimes(1);
      expect(mockLoadToolsUtil).toHaveBeenCalledTimes(2);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          failedKeys: ['file:file-rebuild'],
          currentOcrFailures: [expect.objectContaining({ errorMessage: providerError.message })],
        }),
      );
      expect(providerError.cause).toBe(rebuildError);
    });

    it('retries HTTP 408 twice without rebuilding MCP and keeps the fallback turn active', async () => {
      const file = {
        fileId: 'file-timeout',
        filename: 'timeout.pdf',
        mediaType: 'application/pdf',
      };
      const req = createMockPaddleOcrPreflightReq(file);
      const invoke = jest.fn().mockRejectedValue(new Error('HTTP 408: Request Timeout'));
      mockSingleFilePaddleOcrPipeline(file);
      mockPaddleOcrToolLoads(invoke);

      jest.useFakeTimers();
      let result;
      try {
        const resultPromise = runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
          signal: new AbortController().signal,
          streamId: 'stream-1',
        });
        await jest.runAllTimersAsync();
        result = await resultPromise;
      } finally {
        jest.useRealTimers();
      }

      expect(reinitMCPServer).not.toHaveBeenCalled();
      expect(mockMCPManager.appConnections.disconnect).not.toHaveBeenCalled();
      expect(mockLoadToolsUtil).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(3);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          ocrTurnActive: true,
          failedKeys: ['file:file-timeout'],
        }),
      );
    });

    it('keeps raw PaddleOCR output out of same-turn runtime attachments', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          { fileId: 'file-large', filename: 'large.pdf', mediaType: 'application/pdf' },
        ],
      };
      const longText = 'x'.repeat(1500);
      mockRunOcrPreprocessingBatchPipeline.mockImplementationOnce(async (input) =>
        createMockOcrBatchResult(input, '| OCR |\n| --- |\n| organized markdown |'),
      );

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
      });

      expect(mockCapturePaddleOcrResult).not.toHaveBeenCalled();
      expect(JSON.stringify(result.currentPaddleOcrResults)).not.toContain(longText);
      expect(result.currentPaddleOcrResults).toEqual([]);
      expect(result.currentOcrMarkdownResults[0]).toEqual(
        expect.objectContaining({
          ocrFileKey: 'file:file-large',
          content: expect.stringContaining('organized markdown'),
        }),
      );
    });

    it('rethrows aborted PaddleOCR preflight calls instead of saving partial failure state', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-1' };
      req.steelNativeContext = {
        requestId: 'resp-1',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          { fileId: 'file-abort', filename: 'abort.pdf', mediaType: 'application/pdf' },
        ],
      };
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockRunOcrPreprocessingBatchPipeline.mockRejectedValueOnce(abortError);

      await expect(
        runSteelPaddleOcrPreflight({
          req,
          res: {},
          agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
          signal: new AbortController().signal,
        }),
      ).rejects.toBe(abortError);

      expect(mockCapturePaddleOcrResult).not.toHaveBeenCalled();
      expect(mockBuildSteelPaddleOcrPreflightEventEnvelopes).not.toHaveBeenCalled();
      expect(mockBuildSteelPaddleOcrPreflightEventEnvelopes).not.toHaveBeenCalledWith(
        expect.objectContaining({
          preflight: expect.objectContaining({ status: 'partial' }),
        }),
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

    it('persists a refreshed PDF range URL through the artifact repository CAS', async () => {
      const { createSteelOcrPdfChunkArtifactStore } = require('~/server/services/Steel/ocr');
      const fileRecord = {
        file_id: 'drawing-1',
        user: 'user_123',
        filename: 'drawing.pdf',
        type: 'application/pdf',
        source: 's3',
        storageKey: 'uploads/user_123/drawing-1__drawing.pdf',
      };
      const ensuredUrl = 'https://fresh.example/pages-1-50.pdf';
      const refreshedUrl = 'https://fresh.example/ocr/pages-1-50.pdf?Expires=4102444800';
      const compareAndSetArtifactFilepath = jest.fn().mockResolvedValue(refreshedUrl);
      mockCreateMongooseOcrPdfChunkArtifactRepository.mockReturnValueOnce({
        findBySourcePdfKey: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        compareAndSetArtifactFilepath,
      });
      mockGetS3DownloadURLForKey.mockResolvedValueOnce(refreshedUrl);
      const file = {
        fileId: 'drawing-1',
        filename: 'drawing.pdf',
        ocrFileKey: 'file:drawing-1',
        sourcePdfKey: fileRecord.storageKey,
      };
      const artifact = {
        sourcePdfKey: fileRecord.storageKey,
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 50,
        chunkSizePages: 50,
        source: 's3',
        storageKey: 'ocr/pages-1-50.pdf',
        filepath: ensuredUrl,
        filename: 'pages-1-50.pdf',
        bytes: 100,
        contentType: 'application/pdf',
        artifactOrigin: 'uploaded',
      };

      const refreshed = await createSteelOcrPdfChunkArtifactStore({
        file,
        fileRecord,
      }).refreshPdfChunkArtifact({
        file,
        chunk: { pageStart: 1, pageEnd: 50, chunkIndex: 1, chunkCount: 1, chunkSizePages: 50 },
        artifact,
      });

      expect(refreshed.filepath).toBe(refreshedUrl);
      expect(compareAndSetArtifactFilepath).toHaveBeenCalledWith({
        sourcePdfKey: fileRecord.storageKey,
        pipelineVersion: 1,
        pageStart: 1,
        pageEnd: 50,
        previousFilepath: ensuredUrl,
        filepath: refreshedUrl,
      });
      expect(mockGetS3DownloadURLForKey).toHaveBeenCalledWith({
        storageKey: artifact.storageKey,
        contentType: 'application/pdf',
      });
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
      expect(mockBuildDefaultSteelGlobalAgentContext).not.toHaveBeenCalled();
      expect(mockCreateOpenAIOAuthModel).not.toHaveBeenCalled();
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
      expect(mockBuildDefaultSteelGlobalAgentContext).not.toHaveBeenCalled();
      expect(mockCreateOpenAIOAuthModel).not.toHaveBeenCalled();
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
