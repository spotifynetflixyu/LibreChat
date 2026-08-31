const { createHash } = require('node:crypto');
const { Constants: AgentConstants } = require('@librechat/agents');
const {
  Tools,
  Constants,
  ResourceType,
  ErrorTypes,
  EModelEndpoint,
  isActionTool,
  actionDelimiter,
  AgentCapabilities,
  defaultAgentCapabilities,
  StepEvents,
  StepTypes,
  ToolCallTypes,
} = require('librechat-data-provider');

const mockGetEndpointsConfig = jest.fn();
const mockInitializeModel = jest.fn();
const mockGetMCPServerTools = jest.fn();
const mockGetCachedTools = jest.fn();
const mockSendEvent = jest.fn();
const mockEmitChunk = jest.fn();
const mockUpdateGenerationMetadata = jest.fn();
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
jest.mock('~/server/services/Config', () => ({
  getEndpointsConfig: (...args) => mockGetEndpointsConfig(...args),
  getMCPServerTools: (...args) => mockGetMCPServerTools(...args),
  getCachedTools: (...args) => mockGetCachedTools(...args),
}));
jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  initializeModel: (...args) => mockInitializeModel(...args),
}));

const mockLoadToolDefinitions = jest.fn();
const mockGetUserMCPAuthMap = jest.fn();
const mockExecuteSteelTool = jest.fn();
const mockCreateSteelToolRunState = jest.fn((maxCalls, maxCallsByTool) => ({
  maxCalls,
  callsUsed: 0,
  maxCallsByTool,
  callsUsedByTool: {},
}));
const mockCaptureSteelNativeToolResult = jest.fn().mockResolvedValue({
  status: 'skipped',
  reason: 'missing_conversation_id',
});
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
  isFatalAgentInitializationError: (error) =>
    ['AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE', 'resource_recovery_required'].includes(error?.code),
  loadToolDefinitions: (...args) => mockLoadToolDefinitions(...args),
  getUserMCPAuthMap: (...args) => mockGetUserMCPAuthMap(...args),
  getPaddleOcrResultError: (...args) => mockGetPaddleOcrResultError(...args),
  createSteelPostgresPool: jest.fn(() => ({ query: jest.fn() })),
  createSteelToolRunState: (...args) => mockCreateSteelToolRunState(...args),
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
  mergeOcrPreprocessingStateMarkdown: ({ state }) => {
    const markdowns = state?.chunks
      ?.filter((chunk) => chunk?.organizedSaved && chunk?.organizedMarkdown !== undefined)
      .sort((first, second) => first.chunkIndex - second.chunkIndex)
      .map((chunk) => chunk.organizedMarkdown);
    if (!markdowns?.length) {
      return undefined;
    }

    const tables = markdowns
      .map((markdown) => {
        const lines = markdown
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('|') && line.endsWith('|'));
        if (lines.length < 3) {
          return undefined;
        }
        const headers = lines[0]
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim());
        const rows = lines.slice(2).map((line) =>
          line
            .split('|')
            .slice(1, -1)
            .map((cell) => cell.trim()),
        );
        return { headers, rows };
      })
      .filter(Boolean);
    if (!tables.length) {
      return markdowns.join('\n\n');
    }

    const headers = [...new Set(tables.flatMap((table) => table.headers))];
    const outputRows = tables.flatMap((table) =>
      table.rows.map((row) => {
        const values = new Map(table.headers.map((header, index) => [header, row[index] ?? '']));
        return headers.map((header) => values.get(header) ?? '');
      }),
    );
    return [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...outputRows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n');
  },
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
  createPdfPageRangeChunk: (...args) => mockCreatePdfPageRangeChunk(...args),
  createPdfPageRangeChunker: (...args) => mockCreatePdfPageRangeChunker(...args),
  ensurePdfChunkArtifacts: (...args) => mockEnsurePdfChunkArtifacts(...args),
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
  executeSteelTool: (...args) => mockExecuteSteelTool(...args),
  captureSteelNativeToolResult: (...args) => mockCaptureSteelNativeToolResult(...args),
  buildSteelPaddleOcrPreflightEventEnvelopes: (...args) =>
    mockBuildSteelPaddleOcrPreflightEventEnvelopes(...args),
  resolveSteelProviderToolName: (name) => {
    const normalized = name.startsWith('steel_') ? name.slice('steel_'.length) : name;
    return ['search_customers', 'search_price_candidates'].includes(normalized)
      ? normalized
      : undefined;
  },
  sendEvent: (...args) => mockSendEvent(...args),
  GenerationJobManager: {
    emitChunk: (...args) => mockEmitChunk(...args),
    updateMetadata: (...args) => mockUpdateGenerationMetadata(...args),
  },
  resolveCodeExecutionContext: (...args) => mockResolveCodeExecutionContext(...args),
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
  primeFiles: jest.fn().mockResolvedValue({}),
}));
jest.mock('~/server/services/Files/Code/process', () => ({
  primeFiles: jest.fn().mockResolvedValue({}),
}));
jest.mock('../ActionService', () => ({
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
jest.mock('~/models', () => ({
  findPluginAuthsByKeys: jest.fn(),
  getFiles: (...args) => mockGetFiles(...args),
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
  resolveDelegateOcrPolicyForRequest,
  processRequiredActions,
  runSteelPaddleOcrPreflight,
  resolveAgentCapabilities,
} = require('../ToolService');
const { createOnSearchResults } = require('~/server/services/Tools/search');
const { reinitMCPServer } = require('~/server/services/Tools/mcp');
const { PENDING_STALE_MS } = require('@librechat/api');

function createMockReq(capabilities) {
  return {
    user: { id: 'user_123' },
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

const steelNativeToolNames = new Set([
  'delegate_ocr',
  'search_customers',
  'search_price_candidates',
]);

function getToolDefinitionName(definition) {
  return typeof definition === 'string' ? definition : definition?.name;
}

function isSteelNativeToolDefinition(definition) {
  return steelNativeToolNames.has(getToolDefinitionName(definition));
}

function getNonSteelToolDefinitions(definitions) {
  return definitions.filter((definition) => !isSteelNativeToolDefinition(definition));
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
      chunkCount:
        metadata.chunkCount ?? entry.chunks?.[0]?.chunkCount ?? entry.chunks?.length ?? 0,
      pageRanges:
        metadata.pageRanges ??
        (String(entry.file?.mediaType ?? '').toLowerCase().startsWith('image/')
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

function mockPaddleOcrBatchWithOrganizer(organizerInputs) {
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
          filepath: 'https://files.example.test/ocr-input.pdf',
          storageKey: 'ocr/ocr-input.pdf',
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
          raw.artifact?.filepath ??
          `https://files.example.test/${pipelineFileInput.file.filename}`,
        mediaType: pipelineFileInput.file.mediaType,
        fileKey: pipelineFileInput.file.ocrFileKey,
        ...(String(pipelineFileInput.file.mediaType ?? '').toLowerCase().startsWith('image/')
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

function expectSteelNativeToolDefinitions(definitions) {
  expect(definitions.filter(isSteelNativeToolDefinition).map(getToolDefinitionName).sort()).toEqual(
    ['delegate_ocr', 'search_customers', 'search_price_candidates'],
  );
}

describe('ToolService - Action Capability Gating', () => {
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
    mockGetMCPServerTools.mockResolvedValue(null);
    mockGetCachedTools.mockResolvedValue(null);
    mockGetUserMCPAuthMap.mockResolvedValue({});
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
    mockCreateMongooseOcrPdfChunkArtifactRepository.mockReturnValue({
      findBySourcePdfKey: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
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
    mockExecuteSteelTool.mockResolvedValue({
      ok: true,
      toolName: 'search_customers',
      data: { customers: [] },
      durationMs: 1,
      redactionVersion: 1,
    });
    mockResolveMcpServerNames.mockResolvedValue([]);
  });

  describe('resolveAgentCapabilities', () => {
    it('should return capabilities from endpoints config', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.actions];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const result = await resolveAgentCapabilities(req, req.config, 'agent_123');

      expect(result).toBeInstanceOf(Set);
      expect(result.has(AgentCapabilities.tools)).toBe(true);
      expect(result.has(AgentCapabilities.actions)).toBe(true);
      expect(result.has(AgentCapabilities.web_search)).toBe(false);
    });

    it('should fall back to default capabilities for ephemeral agents with empty config', async () => {
      const req = createMockReq(defaultAgentCapabilities);
      mockGetEndpointsConfig.mockResolvedValue({});

      const result = await resolveAgentCapabilities(req, req.config, Constants.EPHEMERAL_AGENT_ID);

      for (const cap of defaultAgentCapabilities) {
        expect(result.has(cap)).toBe(true);
      }
    });

    it('should return empty set when no capabilities and not ephemeral', async () => {
      const req = createMockReq([]);
      mockGetEndpointsConfig.mockResolvedValue({});

      const result = await resolveAgentCapabilities(req, req.config, 'agent_123');

      expect(result.size).toBe(0);
    });
  });

  describe('isActionTool — cross-delimiter collision guard', () => {
    it('should identify real action tools', () => {
      expect(isActionTool(`get_weather${actionDelimiter}api_example_com`)).toBe(true);
      expect(isActionTool(`fetch_data${actionDelimiter}my---domain---com`)).toBe(true);
    });

    it('should identify action tools whose operationId contains _mcp_', () => {
      expect(isActionTool(`sync_mcp_state${actionDelimiter}api---example---com`)).toBe(true);
      expect(isActionTool(`get_mcp_config${actionDelimiter}internal---api---com`)).toBe(true);
    });

    it('should reject MCP tools whose name ends with _action', () => {
      expect(isActionTool(`get_action${Constants.mcp_delimiter}myserver`)).toBe(false);
      expect(isActionTool(`fetch_action${Constants.mcp_delimiter}server_name`)).toBe(false);
      expect(isActionTool(`retrieve_action${Constants.mcp_delimiter}srv`)).toBe(false);
    });

    it('should reject MCP tools with _action_ in the middle of their name', () => {
      expect(isActionTool(`get_action_data${Constants.mcp_delimiter}myserver`)).toBe(false);
      expect(isActionTool(`create_action_item${Constants.mcp_delimiter}server`)).toBe(false);
    });

    it('should reject tools without the action delimiter', () => {
      expect(isActionTool('calculator')).toBe(false);
      expect(isActionTool(`web_search${Constants.mcp_delimiter}myserver`)).toBe(false);
    });

    it('known limitation: non-RFC domain with _mcp_ substring yields false negative', () => {
      // RFC 952/1123 prohibit underscores in hostnames, so this is not expected in practice.
      // Encoded domain `api_mcp_internal_com` places `_mcp_` after `_action_`, which
      // the guard interprets as the MCP suffix.
      const edgeCaseTool = `getData${actionDelimiter}api_mcp_internal_com`;
      expect(isActionTool(edgeCaseTool)).toBe(false);
    });
  });

  describe('delegate_ocr backend availability policy', () => {
    it('authorizes current conversation attachments once and skips quote/preflight queries', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.steelNativeContext = {
        delegateOcrContext: {
          steelConversation: {
            currentUserTurn: { role: 'user', content: '重新確認圖面' },
            activeHistory: [
              {
                role: 'user',
                files: [
                  { fileId: 'owned-file', filename: 'owned.pdf', mediaType: 'application/pdf' },
                  { fileId: 'foreign-file', filename: 'foreign.pdf', mediaType: 'application/pdf' },
                ],
              },
            ],
          },
        },
      };
      mockGetFiles.mockResolvedValueOnce([
        { file_id: 'owned-file', user: 'user_123', filename: 'owned.pdf', type: 'application/pdf' },
      ]);

      const policy = await resolveDelegateOcrPolicyForRequest({
        req,
        currentUserTurn: '重新確認圖面',
      });
      const cachedPolicy = await resolveDelegateOcrPolicyForRequest({
        req,
        currentUserTurn: '重新確認圖面',
      });

      expect(policy).toEqual({
        resolved: true,
        allowed: true,
        allowedFileKeys: ['file:owned-file'],
      });
      expect(cachedPolicy).toEqual(policy);
      expect(mockGetFiles).toHaveBeenCalledTimes(1);
      expect(mockGetFiles).toHaveBeenCalledWith(
        {
          user: 'user_123',
          $or: [{ file_id: { $in: ['owned-file', 'foreign-file'] } }],
        },
        {},
        {},
      );

      const quotePolicy = await resolveDelegateOcrPolicyForRequest({
        req,
        currentUserTurn: '重新確認圖面後報價',
      });
      expect(quotePolicy).toEqual({
        resolved: true,
        allowed: false,
        allowedFileKeys: [],
      });
      const preflightPolicy = await resolveDelegateOcrPolicyForRequest({
        req,
        currentUserTurn: '重新確認圖面',
        ocrTurnActive: true,
      });
      expect(preflightPolicy).toEqual({
        resolved: true,
        allowed: false,
        allowedFileKeys: [],
      });
      expect(mockGetFiles).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadAgentTools (definitionsOnly=true) — action tool filtering', () => {
    const actionToolName = `get_weather${actionDelimiter}api_example_com`;
    const regularTool = 'calculator';

    it('should preserve the remote-agent permission boundary while priming files', async () => {
      const capabilities = [
        AgentCapabilities.tools,
        AgentCapabilities.file_search,
        AgentCapabilities.execute_code,
      ];
      const req = createMockReq(capabilities);
      const tool_resources = {
        file_search: { file_ids: ['search-file'] },
        execute_code: { file_ids: ['code-file'] },
      };
      const { primeFiles: primeSearchFiles } = require('~/app/clients/tools/util/fileSearch');
      const { primeFiles: primeCodeFiles } = require('~/server/services/Files/Code/process');
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [Tools.file_search, Tools.execute_code] },
        tool_resources,
        agentResourceType: ResourceType.REMOTE_AGENT,
        definitionsOnly: true,
      });

      const expectedParams = {
        req,
        tool_resources,
        agentId: 'agent_123',
        agentResourceType: ResourceType.REMOTE_AGENT,
      };
      expect(primeSearchFiles).toHaveBeenCalledWith(expectedParams);
      expect(primeCodeFiles).toHaveBeenCalledWith({
        ...expectedParams,
        codeApiBaseUrl: 'https://api.librechat.ai',
        executionProfile: 'default',
      });
    });

    it('primes code files through the initializer-selected stateful route', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.execute_code];
      const req = createMockReq(capabilities);
      const tool_resources = { execute_code: { file_ids: ['stateful-file'] } };
      const { primeFiles: primeCodeFiles } = require('~/server/services/Files/Code/process');
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'stateful-agent', tools: [Tools.execute_code] },
        tool_resources,
        definitionsOnly: true,
        codeExecutionContext: {
          baseUrl: 'https://stateful-code.example.com',
          codeSessionKey: 'execute_code:stateful:v2:user:abc',
          executionProfile: 'stateful',
          runtimeSessionHint: 'v2:user:abc',
          statefulSessions: true,
        },
      });

      expect(primeCodeFiles).toHaveBeenCalledWith({
        req,
        tool_resources,
        agentId: 'stateful-agent',
        agentResourceType: undefined,
        codeApiBaseUrl: 'https://stateful-code.example.com',
        executionProfile: 'stateful',
      });
    });

    it('propagates a typed CodeAPI resource recovery failure before model invocation', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.execute_code];
      const req = createMockReq(capabilities);
      const resourceRecoveryError = Object.assign(new Error('resource recovery required'), {
        code: ErrorTypes.RESOURCE_RECOVERY_REQUIRED,
      });
      const { primeFiles: primeCodeFiles } = require('~/server/services/Files/Code/process');
      primeCodeFiles.mockRejectedValueOnce(resourceRecoveryError);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await expect(
        loadAgentTools({
          req,
          res: {},
          agent: {
            id: 'agent_123',
            tools: [Tools.execute_code, 'run_query_mcp_warehouse'],
          },
          tool_resources: { execute_code: { file_ids: ['stale-file'] } },
          definitionsOnly: true,
        }),
      ).rejects.toBe(resourceRecoveryError);
    });

    it('should exclude action tools from definitions when actions capability is disabled', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.web_search];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool, actionToolName] },
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toContain(regularTool);
      expect(callArgs.tools).not.toContain(actionToolName);
    });

    it('should include action tools in definitions when actions capability is enabled', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.actions];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool, actionToolName] },
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toContain(regularTool);
      expect(callArgs.tools).toContain(actionToolName);
    });

    it('should exclude ask_user_question when its capability is disabled (even if tools is enabled)', async () => {
      // ask_user_question is gated by its OWN capability, like execute_code —
      // NOT the generic `tools` capability. Here `tools` is on but the ask
      // capability is not, so the tool must be filtered out.
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool, 'ask_user_question'] },
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toContain(regularTool);
      expect(callArgs.tools).not.toContain('ask_user_question');
    });

    it('should include ask_user_question when its capability is enabled', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.ask_user_question];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool, 'ask_user_question'] },
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toContain('ask_user_question');
    });

    it('should not filter MCP tools whose name contains _action (cross-delimiter collision)', async () => {
      const mcpToolWithAction = `get_action${Constants.mcp_delimiter}myserver`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool, mcpToolWithAction] },
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toContain(mcpToolWithAction);
      expect(callArgs.tools).toContain(regularTool);
    });

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
      expect(definitionNames).not.toContain('delegate_ocr');
      expect(result.toolRegistry.has('search_customers')).toBe(true);
      expect(result.toolRegistry.has('search_price_candidates')).toBe(true);
      expect(result.toolRegistry.has('delegate_ocr')).toBe(false);
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
      expect(result.toolRegistry.size).toBe(0);
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

    it('omits delegate_ocr from quote-only definitions and registry while retaining it for inspection turns', async () => {
      const capabilities = [AgentCapabilities.tools];
      const quoteReq = createMockReq(capabilities);
      quoteReq.steelNativeContext = {
        delegateOcrContext: {
          steelConversation: {
            currentUserTurn: { role: 'user', content: '第35頁報價' },
            activeHistory: [{ role: 'user', content: '第35頁報價' }],
          },
        },
      };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const quoteResult = await loadAgentTools({
        req: quoteReq,
        res: {},
        agent: { id: 'agent_quote', tools: [regularTool, 'delegate_ocr'] },
        definitionsOnly: true,
      });

      expect(quoteResult.toolDefinitions.map(getToolDefinitionName)).not.toContain('delegate_ocr');
      expect(quoteResult.toolRegistry.has('delegate_ocr')).toBe(false);

      jest.clearAllMocks();
      mockLoadToolDefinitions.mockResolvedValue({
        toolDefinitions: [],
        toolRegistry: new Map(),
        hasDeferredTools: false,
      });
      const inspectionReq = createMockReq(capabilities);
      inspectionReq.steelNativeContext = {
        delegateOcrContext: {
          steelConversation: {
            currentUserTurn: {
              role: 'user',
              content: "I don't need a quote; inspect the PDF",
            },
            activeHistory: [
              { role: 'user', content: "I don't need a quote; inspect the PDF" },
            ],
          },
        },
      };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const inspectionResult = await loadAgentTools({
        req: inspectionReq,
        res: {},
        agent: { id: 'agent_inspection', tools: [regularTool, 'delegate_ocr'] },
        definitionsOnly: true,
      });

      expect(inspectionResult.toolDefinitions.map(getToolDefinitionName)).toContain('delegate_ocr');
      expect(inspectionResult.toolRegistry.has('delegate_ocr')).toBe(true);
    });

    it('routes every current OCR-capable file through the preprocessing pipeline', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
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

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: { id: 'agent_123', provider: EModelEndpoint.openAI },
        signal: new AbortController().signal,
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
      expect(
        mockRunOcrPreprocessingBatchPipeline.mock.calls[0][0].files.map(
          ({ file }) => file.ocrFileKey,
        ),
      ).toEqual(['file:file-a', 'file:file-b', 'file:file-c']);
      expect(result).toEqual({
        status: 'completed',
        ocrTurnActive: true,
        completedKeys: ['file:file-a', 'file:file-b', 'file:file-c'],
        attemptedKeys: ['file:file-a', 'file:file-b', 'file:file-c'],
        failedKeys: [],
        skippedReason: undefined,
        currentPaddleOcrResults: [],
        currentOcrMarkdownResults: expect.arrayContaining([
          expect.objectContaining({
            ocrFileKey: 'file:file-a',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
            content: expect.stringContaining('<file:file-a>'),
          }),
          expect.objectContaining({
            ocrFileKey: 'file:file-b',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
            content: expect.stringContaining('<file:file-b>'),
          }),
          expect.objectContaining({
            ocrFileKey: 'file:file-c',
            kind: 'ocr_preprocessing_merged_markdown',
            ocrSource: 'ocr_preprocessing_merge',
            content: expect.stringContaining('<file:file-c>'),
          }),
        ]),
      });
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
            expect.objectContaining({ errorMessage: expect.stringMatching(/organizer rule markers/u) }),
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

      const result = await runSteelPaddleOcrPreflight({
        req,
        res: {},
        agent: {
          id: 'agent_123',
          provider: 'openai_oauth_responses',
          model: 'gpt-5.6-luna',
          model_parameters: {
            model: 'gpt-5.6-luna',
            max_output_tokens: 24576,
            modelKwargs: { reasoning: { effort: 'high' } },
          },
        },
        signal: new AbortController().signal,
        streamId: 'stream-1',
      });

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(invoke.mock.calls[0][0])).toContain('raw chunk OCR text');
      expect(JSON.stringify(invoke.mock.calls[0][0])).toContain('OCR rules text');
      expect(JSON.stringify(invoke.mock.calls[0][0])).not.toContain('Main-agent OCR rerun policy');
      expect(JSON.stringify(invoke.mock.calls[0][0])).toContain('quote.pdf');
      expect(JSON.stringify(invoke.mock.calls[0][0])).not.toContain('chunk-2.pdf');
      expect(JSON.stringify(invoke.mock.calls[0][0])).toContain('page_range: 51-100');
      expect(JSON.stringify(invoke.mock.calls[0][0])).toContain('chunk: 2/3');
      expect(mockCreateOpenAIOAuthModel).toHaveBeenCalledWith(
        expect.objectContaining({
          maxOutputTokens: 24576,
          model: 'gpt-5.6-luna',
          reasoningEffort: 'high',
        }),
      );
      expect(mockCreateOpenAIOAuthModel).toHaveBeenCalledWith(
        expect.not.objectContaining({ temperature: expect.anything() }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          completedKeys: [],
          failedKeys: ['file:pdf-1'],
          currentOcrFailures: [
            expect.objectContaining({
              ocrFileKey: 'file:pdf-1',
              fileUrl: 'https://files.example.test/uploads/user_123/pdf-1__quote.pdf',
            }),
          ],
        }),
      );
      expect(result).not.toHaveProperty('currentOcrMarkdownResults');
      const organizerFailureStatus = mockEmitChunk.mock.calls
        .map(([, event]) => event)
        .find(
          (event) =>
            event?.data?.type === 'parse_status' &&
            event.data.source === 'ocr_preprocessing' &&
            event.data.parseStatus === 'partial',
        );
      expect(organizerFailureStatus?.data).not.toHaveProperty('missingPageRangesByFileKey');
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
      mockPaddleOcrBatchWithOrganizer(organizerInputs);
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
          'https://files.example.test/ocr-input.pdf',
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
        expect(organizerMessage).not.toContain('https://files.example.test/ocr-input.pdf');
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

      expect(mockLoadToolsUtil).not.toHaveBeenCalled();
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
      expect(mockSendEvent).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          data: expect.objectContaining({
            message: 'Reused PaddleOCR preflight',
            parseStatus: 'saved',
          }),
        }),
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
              message: 'ocr preprocessing failed (file:file-fallback)',
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
      expect(invoke.mock.calls[0][0].input_data).toBe(
        'https://files.example.test/ocr-input.pdf',
      );
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
      const invoke = jest
        .fn()
        .mockRejectedValue(new Error('HTTP 408: Request Timeout'));
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

    it('fails initialization when an explicitly selected MCP tool cannot be resolved', async () => {
      const mcpTool = `search${Constants.mcp_delimiter}warehouse`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockResolveConfigServers.mockResolvedValue({
        warehouse: {
          type: 'streamable-http',
          url: 'https://mcp.example.com/warehouse',
        },
      });
      mockLoadToolDefinitions.mockResolvedValueOnce({
        toolDefinitions: [],
        toolRegistry: new Map(),
        hasDeferredTools: false,
        mcpResolution: { expectedToolCount: 1, resolvedToolCount: 0 },
      });

      await expect(
        loadAgentTools({
          req,
          res: {},
          agent: { id: 'agent_123', name: 'Target Agent', tools: [mcpTool] },
          definitionsOnly: true,
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE',
        statusCode: 503,
        message: expect.stringContaining('can access its selected tools'),
      });
    });

    it('fails closed when MCP definition loading throws before resolution completes', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockLoadToolDefinitions.mockRejectedValueOnce(new Error('MCP registry unavailable'));

      await expect(
        loadAgentTools({
          req,
          res: {},
          agent: {
            id: 'agent_123',
            name: 'Target Agent',
            tools: [`run_query${Constants.mcp_delimiter}warehouse`],
          },
          definitionsOnly: true,
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE',
        statusCode: 503,
        cause: expect.objectContaining({ message: 'MCP registry unavailable' }),
      });
    });

    it('allows a server pin with no explicitly selected MCP tools', async () => {
      const serverPin = `${Constants.mcp_server}${Constants.mcp_delimiter}warehouse`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockLoadToolDefinitions.mockResolvedValueOnce({
        toolDefinitions: [],
        toolRegistry: new Map(),
        hasDeferredTools: false,
        mcpResolution: { expectedToolCount: 0, resolvedToolCount: 0 },
      });

      const result = await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [serverPin] },
        definitionsOnly: true,
      });

      expect(result.toolDefinitions.filter((definition) => definition.toolType === 'mcp')).toEqual(
        [],
      );
    });

    it('allows partial MCP resolution when at least one expected tool is available', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockLoadToolDefinitions.mockResolvedValueOnce({
        toolDefinitions: [{ name: 'list_sources_mcp_warehouse', toolType: 'mcp' }],
        toolRegistry: new Map(),
        hasDeferredTools: false,
        mcpResolution: { expectedToolCount: 2, resolvedToolCount: 1 },
      });

      await expect(
        loadAgentTools({
          req,
          res: {},
          agent: {
            id: 'agent_123',
            tools: [
              `list_sources${Constants.mcp_delimiter}warehouse`,
              `run_query${Constants.mcp_delimiter}warehouse`,
            ],
          },
          definitionsOnly: true,
        }),
      ).resolves.toMatchObject({
        toolDefinitions: expect.arrayContaining([
          expect.objectContaining({ name: 'list_sources_mcp_warehouse' }),
        ]),
      });
    });

    it('should filter MCP tool definitions when user lacks MCP server use permission', async () => {
      const { userCanUseMCPServers } = require('~/server/services/MCP');
      userCanUseMCPServers.mockResolvedValueOnce(false);

      const mcpTool = `search${Constants.mcp_delimiter}myserver`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool, mcpTool] },
        definitionsOnly: true,
      });

      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
      const [callArgs] = mockLoadToolDefinitions.mock.calls[0];
      expect(callArgs.tools).toContain(regularTool);
      expect(callArgs.tools).not.toContain(mcpTool);
    });

    it('fails explicitly when MCP permission filtering removes every expected tool', async () => {
      const { userCanUseMCPServers } = require('~/server/services/MCP');
      userCanUseMCPServers.mockResolvedValueOnce(false);

      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await expect(
        loadAgentTools({
          req,
          res: {},
          agent: {
            id: 'agent_123',
            tools: [`run_query${Constants.mcp_delimiter}warehouse`],
          },
          definitionsOnly: true,
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE',
        statusCode: 503,
      });
      expect(mockLoadToolDefinitions).not.toHaveBeenCalled();
    });

    it('should return actionsEnabled in the result', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const result = await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool] },
        definitionsOnly: true,
      });

      expect(result.actionsEnabled).toBe(false);
    });

    it('emits separate MCP OAuth login steps and completion events for multiple pending servers', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      const res = { writableEnded: false };
      const servers = ['ELI', 'Vespa'];
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig([AgentCapabilities.tools]));
      mockResolveConfigServers.mockResolvedValue(
        Object.fromEntries(
          servers.map((serverName) => [
            serverName,
            {
              type: 'streamable-http',
              url: `https://mcp.example.com/${serverName}`,
              requiresOAuth: true,
            },
          ]),
        ),
      );

      mockLoadToolDefinitions
        .mockImplementationOnce(async (_args, deps) => {
          await deps.getOrFetchMCPServerTools(req.user.id, servers[0]);
          await deps.getOrFetchMCPServerTools(req.user.id, servers[1]);
          return {
            toolDefinitions: [],
            toolRegistry: new Map(),
            hasDeferredTools: false,
          };
        })
        .mockResolvedValue({
          toolDefinitions: [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        });

      reinitMCPServer.mockImplementation(
        async ({ serverName, returnOnOAuth, oauthStart, oauthEnd }) => {
          if (returnOnOAuth === false) {
            await oauthStart(`https://auth.example.com/${serverName}`);
            await oauthEnd();
            return { availableTools: { [`tool_${serverName}`]: {} } };
          }

          await oauthStart(`https://auth.example.com/${serverName}`);
          return { availableTools: null };
        },
      );

      await loadAgentTools({
        req,
        res,
        agent: {
          id: 'agent_123',
          tools: servers.map((server) => `search${Constants.mcp_delimiter}${server}`),
        },
        definitionsOnly: true,
      });

      const runStepEvents = mockSendEvent.mock.calls
        .map(([, event]) => event)
        .filter((event) => event.data?.stepDetails?.type === 'tool_calls');
      const deltaEvents = mockSendEvent.mock.calls
        .map(([, event]) => event)
        .filter((event) => event.data?.delta?.type === 'tool_calls');
      const authDeltaEvents = deltaEvents.filter((event) => event.data.delta.auth);
      const completionEvents = mockSendEvent.mock.calls
        .map(([, event]) => event)
        .filter((event) => event.data?.result?.tool_call?.name?.startsWith('oauth'));

      expect(runStepEvents.map((event) => event.data.index)).toEqual([0, 1]);
      expect(authDeltaEvents.map((event) => event.data.id)).toEqual([
        'step_oauth_login_ELI',
        'step_oauth_login_Vespa',
      ]);
      expect(completionEvents.map((event) => event.data.result.id)).toEqual([
        'step_oauth_login_ELI',
        'step_oauth_login_Vespa',
      ]);
    });

    it('does not count an empty post-OAuth catalog as tools available or reload definitions', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      const res = { writableEnded: false };
      const serverName = 'Empty-Catalog';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig([AgentCapabilities.tools]));
      mockResolveConfigServers.mockResolvedValue({
        [serverName]: {
          type: 'streamable-http',
          url: 'https://mcp.example.com/empty',
          requiresOAuth: true,
        },
      });
      mockGetMCPServerTools.mockResolvedValue(null);
      mockFlowManager.getFlowState.mockResolvedValue(null);
      mockLoadToolDefinitions.mockImplementationOnce(async (params, deps) => {
        await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
          mcpResolution: { resolvedToolCount: 1 },
        };
      });
      reinitMCPServer
        .mockImplementationOnce(async ({ oauthStart }) => {
          await oauthStart(`https://auth.example.com/${serverName}`);
          return { availableTools: null };
        })
        .mockResolvedValueOnce({ availableTools: {} });

      const result = await loadAgentTools({
        req,
        res,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(result.toolDefinitions.filter((definition) => definition.toolType === 'mcp')).toEqual(
        [],
      );
      expect(result.mcpAvailableTools).toEqual({});
      expect(mockLoadToolDefinitions).toHaveBeenCalledTimes(1);
    });

    it('fences resumable MCP OAuth definition events to the owning job epoch', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      const res = { writableEnded: false };
      const serverName = 'Epoch-Server';
      const streamId = 'stream-epoch';
      const jobCreatedAt = 1234;
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig([AgentCapabilities.tools]));
      mockResolveConfigServers.mockResolvedValue({
        [serverName]: {
          type: 'streamable-http',
          url: `https://mcp.example.com/${serverName}`,
          requiresOAuth: true,
        },
      });
      mockLoadToolDefinitions
        .mockImplementationOnce(async (_args, deps) => {
          await deps.getOrFetchMCPServerTools(req.user.id, serverName);
          return {
            toolDefinitions: [],
            toolRegistry: new Map(),
            hasDeferredTools: false,
          };
        })
        .mockResolvedValue({
          toolDefinitions: [mcpTool],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        });
      reinitMCPServer.mockImplementation(async ({ returnOnOAuth, oauthStart, oauthEnd }) => {
        await oauthStart(`https://auth.example.com/${serverName}`);
        if (returnOnOAuth === false) {
          await oauthEnd();
          return { availableTools: { [mcpTool]: {} } };
        }
        return { availableTools: null };
      });

      await loadAgentTools({
        req,
        res,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
        streamId,
        jobCreatedAt,
      });

      expect(mockSendEvent).not.toHaveBeenCalled();
      expect(mockEmitChunk).toHaveBeenCalledTimes(3);
      expect(mockEmitChunk.mock.calls.map(([, event]) => event.event)).toEqual([
        'on_run_step',
        'on_run_step_delta',
        'on_run_step_completed',
      ]);
      for (const [emittedStreamId, , options] of mockEmitChunk.mock.calls) {
        expect(emittedStreamId).toBe(streamId);
        expect(options).toEqual({ expectedCreatedAt: jobCreatedAt });
      }
    });

    it('should not expose cached MCP tool definitions when the registry lookup fails', async () => {
      const serverName = 'private-server';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockGetServerConfig.mockImplementation(() => {
        throw new Error('MCPServersRegistry has not been initialized.');
      });
      mockGetMCPServerTools.mockResolvedValue({
        [mcpTool]: {
          function: {
            name: mcpTool,
            description: 'Cached private search',
            parameters: {},
          },
        },
      });
      mockLoadToolDefinitions.mockImplementation(async (params, deps) => {
        const serverTools = await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: serverTools ? Object.keys(serverTools) : [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        };
      });

      const result = await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(getNonSteelToolDefinitions(result.toolDefinitions)).toEqual([]);
      expectSteelNativeToolDefinitions(result.toolDefinitions);
      expect(mockGetMCPServerTools).not.toHaveBeenCalled();
    });

    it('should re-emit pending MCP OAuth prompts when cached tool definitions exist', async () => {
      const serverName = 'Google-Workspace';
      const authorizationUrl = 'https://auth.example.com/Google-Workspace';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      const res = { writableEnded: false };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockGetServerConfig.mockResolvedValue({
        type: 'streamable-http',
        url: 'https://demo.librechat.ai/mcp',
        requiresOAuth: true,
      });
      mockGetMCPServerTools.mockResolvedValue({
        [mcpTool]: {
          function: {
            name: mcpTool,
            description: 'Cached search',
            parameters: {},
          },
        },
      });
      mockFlowManager.getFlowState.mockResolvedValue({
        status: 'PENDING',
        createdAt: Date.now(),
        metadata: { authorizationUrl },
      });
      mockLoadToolDefinitions.mockImplementation(async (params, deps) => {
        const serverTools = await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: serverTools ? Object.keys(serverTools) : [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        };
      });
      reinitMCPServer.mockImplementation(async ({ oauthStart }) => {
        await oauthStart(authorizationUrl);
        return { availableTools: { [mcpTool]: {} } };
      });

      const result = await loadAgentTools({
        req,
        res,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(getNonSteelToolDefinitions(result.toolDefinitions)).toEqual([mcpTool]);
      expectSteelNativeToolDefinitions(result.toolDefinitions);
      expect(mockGetMCPServerTools).toHaveBeenCalledWith(
        req.user.id,
        serverName,
        expect.objectContaining({ requiresOAuth: true }),
      );
      expect(reinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName,
          returnOnOAuth: false,
          oauthStart: expect.any(Function),
        }),
      );
      expect(mockSendEvent).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          event: 'on_run_step',
          data: expect.objectContaining({
            id: `step_oauth_login_${serverName}`,
          }),
        }),
      );
      expect(mockSendEvent).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          event: 'on_run_step_delta',
          data: expect.objectContaining({
            id: `step_oauth_login_${serverName}`,
            delta: expect.objectContaining({
              auth: authorizationUrl,
            }),
          }),
        }),
      );
    });

    it('should not join in-flight MCP initialization before replaying pending OAuth prompts', async () => {
      const serverName = 'Google-Workspace';
      const authorizationUrl = 'https://auth.example.com/Google-Workspace';
      const mcpTool = `${Constants.mcp_all}${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      const res = { writableEnded: false };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockGetServerConfig.mockResolvedValue({
        type: 'streamable-http',
        url: 'https://demo.librechat.ai/mcp',
        requiresOAuth: true,
      });
      mockGetMCPServerTools.mockResolvedValue(null);
      mockFlowManager.getFlowState.mockResolvedValue({
        status: 'PENDING',
        createdAt: Date.now(),
        metadata: { authorizationUrl },
      });
      mockLoadToolDefinitions.mockImplementation(async (params, deps) => {
        await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        };
      });
      reinitMCPServer.mockImplementation(async ({ oauthStart }) => {
        await oauthStart(authorizationUrl);
        return { availableTools: null };
      });

      await loadAgentTools({
        req,
        res,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(mockGetMCPServerTools).toHaveBeenCalledWith(
        req.user.id,
        serverName,
        expect.objectContaining({ requiresOAuth: true }),
      );
      const matchingServerCalls = reinitMCPServer.mock.calls.filter(
        ([params]) => params?.serverName === serverName,
      );
      expect(matchingServerCalls).toHaveLength(1);
      expect(reinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName,
          returnOnOAuth: false,
          oauthStart: expect.any(Function),
        }),
      );
      expect(mockSendEvent).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          event: 'on_run_step_delta',
          data: expect.objectContaining({
            id: `step_oauth_login_${serverName}`,
            delta: expect.objectContaining({
              auth: authorizationUrl,
            }),
          }),
        }),
      );
    });

    it('should re-emit pending MCP OAuth prompts when selected MCP tools are already concrete', async () => {
      const serverName = `Google${Constants.mcp_delimiter}Workspace`;
      const authorizationUrl = 'https://auth.example.com/Google-Workspace';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      /** A server whose own name contains the delimiter is only resolvable
       *  against the configured set, so the key boundary is unambiguous. */
      mockResolveConfigServers.mockResolvedValue({ [serverName]: {} });
      const res = { writableEnded: false };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockFlowManager.getFlowState.mockResolvedValue({
        status: 'PENDING',
        createdAt: Date.now(),
        metadata: { authorizationUrl },
      });
      mockLoadToolDefinitions.mockResolvedValue({
        toolDefinitions: [mcpTool],
        toolRegistry: new Map(),
        hasDeferredTools: false,
      });
      reinitMCPServer.mockImplementation(async ({ oauthStart }) => {
        await oauthStart(authorizationUrl);
        return { availableTools: { [mcpTool]: {} } };
      });

      const result = await loadAgentTools({
        req,
        res,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(getNonSteelToolDefinitions(result.toolDefinitions)).toEqual([mcpTool]);
      expectSteelNativeToolDefinitions(result.toolDefinitions);
      expect(mockGetMCPServerTools).not.toHaveBeenCalled();
      expect(reinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName,
          returnOnOAuth: false,
          oauthStart: expect.any(Function),
        }),
      );
      expect(mockSendEvent).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          event: 'on_run_step_delta',
          data: expect.objectContaining({
            id: `step_oauth_login_${serverName}`,
            delta: expect.objectContaining({
              auth: authorizationUrl,
            }),
          }),
        }),
      );
    });

    it('should emit stored pending MCP OAuth prompts before waiting on a silent in-flight join', async () => {
      const serverName = 'Google-Workspace';
      const authorizationUrl = 'https://auth.example.com/Google-Workspace';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      const res = { writableEnded: false };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockFlowManager.getFlowState.mockResolvedValue({
        status: 'PENDING',
        createdAt: Date.now(),
        metadata: { authorizationUrl },
      });
      mockLoadToolDefinitions.mockResolvedValue({
        toolDefinitions: [mcpTool],
        toolRegistry: new Map(),
        hasDeferredTools: false,
      });
      reinitMCPServer.mockResolvedValue({ availableTools: null });

      const result = await loadAgentTools({
        req,
        res,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(getNonSteelToolDefinitions(result.toolDefinitions)).toEqual([mcpTool]);
      expectSteelNativeToolDefinitions(result.toolDefinitions);
      expect(reinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName,
          returnOnOAuth: false,
          oauthStart: expect.any(Function),
        }),
      );
      expect(mockSendEvent).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          event: 'on_run_step_delta',
          data: expect.objectContaining({
            id: `step_oauth_login_${serverName}`,
            delta: expect.objectContaining({
              auth: authorizationUrl,
            }),
          }),
        }),
      );
    });

    it('should preserve OAuth URLs emitted while discovering MCP tools before a silent wait join', async () => {
      const serverName = 'Google-Workspace';
      const authorizationUrl = 'https://auth.example.com/Google-Workspace';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      const res = { writableEnded: false };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockGetServerConfig.mockResolvedValue({
        type: 'streamable-http',
        url: 'https://demo.librechat.ai/mcp',
        requiresOAuth: true,
      });
      mockGetMCPServerTools.mockResolvedValue(null);
      mockFlowManager.getFlowState.mockResolvedValue(null);
      mockLoadToolDefinitions.mockImplementation(async (params, deps) => {
        await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        };
      });
      reinitMCPServer
        .mockImplementationOnce(async ({ oauthStart }) => {
          await oauthStart(authorizationUrl, { expiresAt: Date.now() + 60_000 });
          return { availableTools: null };
        })
        .mockResolvedValue({ availableTools: null });

      await loadAgentTools({
        req,
        res,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(reinitMCPServer).toHaveBeenCalledTimes(2);
      expect(mockSendEvent).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          event: 'on_run_step_delta',
          data: expect.objectContaining({
            id: `step_oauth_login_${serverName}`,
            delta: expect.objectContaining({
              auth: authorizationUrl,
            }),
          }),
        }),
      );
    });

    it('should pass request body context into MCP tool definition reinitialization', async () => {
      const serverName = 'Body-Scoped';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      req.body = { conversationId: 'conv-123', messageId: 'msg-123' };

      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockGetServerConfig.mockResolvedValue({
        type: 'streamable-http',
        url: 'https://demo.librechat.ai/messages/{{LIBRECHAT_BODY_MESSAGEID}}/mcp',
        source: 'yaml',
      });
      mockGetMCPServerTools.mockResolvedValue(null);
      mockFlowManager.getFlowState.mockResolvedValue(null);
      mockLoadToolDefinitions.mockImplementation(async (params, deps) => {
        await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        };
      });
      reinitMCPServer.mockResolvedValue({ availableTools: null });

      await loadAgentTools({
        req,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(reinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName,
          requestBody: req.body,
        }),
      );
      expect(mockGetMCPServerTools).toHaveBeenCalledWith(
        req.user.id,
        serverName,
        expect.objectContaining({
          url: expect.stringContaining('LIBRECHAT_BODY_MESSAGEID'),
        }),
      );
    });

    it('returns run-scoped MCP tool definitions for request-scoped servers', async () => {
      const serverName = 'ClickHouse';
      const mcpTool = `list_tables${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      req.body = { conversationId: 'conv-123', messageId: 'msg-123' };
      const availableTools = {
        [mcpTool]: {
          function: {
            name: mcpTool,
            description: 'List tables',
            parameters: { type: 'object', properties: {} },
          },
        },
      };

      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockGetServerConfig.mockResolvedValue({
        type: 'streamable-http',
        url: 'https://mcp.example.com/{{LIBRECHAT_BODY_MESSAGEID}}/mcp',
        source: 'yaml',
      });
      mockGetMCPServerTools.mockResolvedValue(null);
      mockFlowManager.getFlowState.mockResolvedValue(null);
      mockLoadToolDefinitions.mockImplementation(async (params, deps) => {
        const serverTools = await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: serverTools ? Object.keys(serverTools) : [],
          toolRegistry: new Map([[mcpTool, { name: mcpTool }]]),
          hasDeferredTools: false,
        };
      });
      reinitMCPServer.mockResolvedValue({ availableTools });

      const result = await loadAgentTools({
        req,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(getNonSteelToolDefinitions(result.toolDefinitions)).toEqual([mcpTool]);
      expectSteelNativeToolDefinitions(result.toolDefinitions);
      expect(result.mcpAvailableTools).toEqual({ [serverName]: availableTools });
      expect(mockGetMCPServerTools).toHaveBeenCalledWith(
        req.user.id,
        serverName,
        expect.objectContaining({
          url: expect.stringContaining('LIBRECHAT_BODY_MESSAGEID'),
        }),
      );
    });

    it('should preserve pending-flow expiry for OAuth URLs captured during discovery', async () => {
      const serverName = 'Google-Workspace';
      const authorizationUrl = 'https://auth.example.com/Google-Workspace';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      const res = { writableEnded: false };
      const createdAt = Date.now() - 45_000;
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockGetServerConfig.mockResolvedValue({
        type: 'streamable-http',
        url: 'https://demo.librechat.ai/mcp',
        requiresOAuth: true,
      });
      mockGetMCPServerTools.mockResolvedValue(null);
      mockFlowManager.getFlowState.mockResolvedValueOnce(null).mockResolvedValueOnce({
        status: 'PENDING',
        createdAt,
        metadata: { authorizationUrl },
      });
      mockLoadToolDefinitions.mockImplementation(async (params, deps) => {
        await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        };
      });
      reinitMCPServer
        .mockImplementationOnce(async ({ oauthStart }) => {
          await oauthStart(authorizationUrl);
          return { availableTools: null };
        })
        .mockResolvedValue({ availableTools: null });

      await loadAgentTools({
        req,
        res,
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      const authDeltaEvent = mockSendEvent.mock.calls
        .map(([, event]) => event)
        .find((event) => event.data?.delta?.auth === authorizationUrl);
      expect(authDeltaEvent?.data.delta.expires_at).toBe(createdAt + PENDING_STALE_MS);
    });

    it('should use request-scoped MCP config before falling back to the registry', async () => {
      const serverName = 'config-server';
      const mcpTool = `search${Constants.mcp_delimiter}${serverName}`;
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      mockResolveConfigServers.mockResolvedValue({
        [serverName]: {
          type: 'streamable-http',
          url: 'https://config.example.com/mcp',
          customUserVars: {
            TOKEN: { title: 'Token', description: 'Token' },
          },
        },
      });
      mockGetUserMCPAuthMap.mockResolvedValue({
        [`${Constants.mcp_prefix}${serverName}`]: { TOKEN: 'secret' },
      });
      mockGetMCPServerTools.mockResolvedValue({
        [mcpTool]: {
          function: {
            name: mcpTool,
            description: 'Config search',
            parameters: {},
          },
        },
      });
      mockLoadToolDefinitions.mockImplementation(async (params, deps) => {
        const serverTools = await deps.getOrFetchMCPServerTools(params.userId, serverName);
        return {
          toolDefinitions: serverTools ? Object.keys(serverTools) : [],
          toolRegistry: new Map(),
          hasDeferredTools: false,
        };
      });

      const result = await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [mcpTool] },
        definitionsOnly: true,
      });

      expect(getNonSteelToolDefinitions(result.toolDefinitions)).toEqual([mcpTool]);
      expectSteelNativeToolDefinitions(result.toolDefinitions);
      expect(mockGetServerConfig).not.toHaveBeenCalled();
      expect(mockGetMCPServerTools).toHaveBeenCalledWith(
        req.user.id,
        serverName,
        expect.objectContaining({ url: 'https://config.example.com/mcp' }),
      );
    });
  });

  describe('loadAgentTools (definitionsOnly=false) — action tool filtering', () => {
    const actionToolName = `get_weather${actionDelimiter}api_example_com`;
    const regularTool = 'calculator';

    it('threads the owning job epoch into web-search attachment callbacks', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.web_search];
      const req = createMockReq(capabilities);
      const res = {};
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res,
        streamId: 'conversation-1',
        jobCreatedAt: 1234,
        agent: { id: 'agent_123', tools: [Tools.web_search] },
        definitionsOnly: false,
      });

      expect(createOnSearchResults).toHaveBeenCalledWith(res, 'conversation-1', 1234);
    });

    it('should not load action sets when actions capability is disabled', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.web_search];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool, actionToolName] },
        definitionsOnly: false,
      });

      expect(mockLoadActionSets).not.toHaveBeenCalled();
    });

    it('should load action sets when actions capability is enabled and action tools present', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.actions];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [regularTool, actionToolName] },
        definitionsOnly: false,
      });

      expect(mockLoadActionSets).toHaveBeenCalledWith({ agent_id: 'agent_123' });
    });
  });

  describe('loadToolsForExecution — action tool gating', () => {
    it('should preserve the remote-agent permission boundary for deferred tool loading', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.file_search];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123', tools: [Tools.file_search] },
        toolNames: [Tools.file_search],
        agentResourceType: ResourceType.REMOTE_AGENT,
        actionsEnabled: false,
      });

      expect(mockLoadToolsUtil).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            agentResourceType: ResourceType.REMOTE_AGENT,
          }),
        }),
      );
    });

    const actionToolName = `get_weather${actionDelimiter}api_example_com`;
    const regularTool = Tools.web_search;

    it.skip('wraps direct PaddleOCR MCP results into stored OCR Markdown before returning content', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      req.body = { conversationId: 'conv-direct-ocr' };
      req.steelNativeContext = {
        conversationId: 'conv-direct-ocr',
        requestId: 'msg-direct-ocr',
        assistantTurnIndex: 4,
        memoryCheckpointTurnIndex: 3,
        currentTurnFiles: [
          {
            fileId: 'file-bh',
            filename: 'BH.pdf',
            mediaType: 'application/pdf',
            storageKey: 'uploads/user/BH.pdf',
          },
        ],
      };
      const paddleToolName = `paddleocr_vl${Constants.mcp_delimiter}PaddleOCR`;
      const rawPaddleResult = {
        content: 'RAW OCR RESULT THAT MUST NOT REACH MODEL CONTEXT',
        artifact: { content: [{ type: 'text', text: 'raw artifact' }] },
      };
      const invokePaddleOcr = jest.fn().mockResolvedValue(rawPaddleResult);
      const rawPaddleTool = {
        name: paddleToolName,
        invoke: invokePaddleOcr,
      };
      mockLoadToolsUtil.mockResolvedValue({
        loadedTools: [rawPaddleTool],
        toolContextMap: {},
      });
      mockReadOcrPreprocessingState
        .mockResolvedValueOnce({
          ocrFileKey: 'file:file-bh',
          sourcePdfKey: 'uploads/user/BH.pdf',
          pipelineVersion: 1,
          ocrRuleVersion: 'ocr-rules:test',
          chunkSizePages: 50,
          chunkCount: 0,
          chunks: [],
        })
        .mockResolvedValueOnce({
          ocrFileKey: 'file:file-bh',
          sourcePdfKey: 'uploads/user/BH.pdf',
          pipelineVersion: 1,
          ocrRuleVersion: 'ocr-rules:test',
          chunkSizePages: 50,
          chunkCount: 1,
          chunks: [
            {
              chunkIndex: 1,
              chunkCount: 1,
              pageStart: 1,
              pageEnd: 1,
              chunkSizePages: 50,
              rawSaved: true,
              organizedSaved: true,
              rawResultHash: 'hash-direct',
              rawOcrText: rawPaddleResult.content,
              organizedMarkdown: 'organized OCR Markdown',
            },
          ],
        });

      const result = await loadToolsForExecution({
        req,
        res: {},
        streamId: 'stream-direct-ocr',
        agent: { id: 'agent_direct_ocr', tools: [paddleToolName] },
        toolNames: [paddleToolName],
        actionsEnabled: false,
      });
      const output = await result.loadedTools[0].invoke(
        { input_data: 'uploads/user/BH.pdf', output_mode: 'detailed' },
        { toolCall: { id: 'call-direct-ocr' } },
      );

      expect(invokePaddleOcr).toHaveBeenCalledTimes(1);
      expect(mockCapturePaddleOcrChunkResult).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-direct-ocr',
          requestId: 'msg-direct-ocr',
          providerToolCallId: 'call-direct-ocr',
          turnIndex: 4,
          checkpointTurnIndex: 3,
          rawResultHash: expect.any(String),
          data: rawPaddleResult,
          file: expect.objectContaining({
            ocrFileKey: 'file:file-bh',
            sourcePdfKey: 'uploads/user/BH.pdf',
          }),
          chunk: expect.objectContaining({
            sourcePdfKey: 'uploads/user/BH.pdf',
            chunkIndex: 1,
            chunkCount: 1,
          }),
        }),
      );
      expect(mockCaptureOcrPreprocessingChunkMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-direct-ocr',
          requestId: 'msg-direct-ocr',
          content: 'organized OCR Markdown',
        }),
      );
      expect(mockCreateOpenAIOAuthModel).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoningEffort: 'none',
        }),
      );
      expect(output.content).toContain('<file:file-bh>');
      expect(output.content).toContain('organized OCR Markdown');
      expect(output.content).not.toContain('RAW OCR RESULT');
      expect(output.artifact).toBeUndefined();

      const steelEventMessages = mockEmitChunk.mock.calls
        .map(([, event]) => event)
        .filter((event) => event.event === 'steel_event')
        .map((event) => event.data?.message);
      expect(steelEventMessages).toEqual(
        expect.arrayContaining([
          'Running paddleocr_vl in PaddleOCR (chunk 1/1) (file:file-bh)',
          'Ran paddleocr_vl in PaddleOCR (chunk 1/1) (file:file-bh)',
          'Saved PaddleOCR preflight (chunk 1/1) (file:file-bh)',
          'Running OCR markdown process (chunk 1/1) (file:file-bh)',
          'Ran OCR markdown process (chunk 1/1) (file:file-bh)',
          'Saved OCR markdown (chunk 1/1) (file:file-bh)',
          'Read OCR markdowns (file:file-bh: 1 chunks)',
          'Processing pdf with OCR markdowns (file:file-bh)',
        ]),
      );
    });

    it.skip('returns existing merged OCR Markdown for direct PaddleOCR MCP calls without rerunning PaddleOCR', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      req.body = { conversationId: 'conv-existing-ocr' };
      req.steelNativeContext = {
        conversationId: 'conv-existing-ocr',
        requestId: 'msg-existing-ocr',
        assistantTurnIndex: 5,
        memoryCheckpointTurnIndex: 4,
        currentTurnFiles: [
          {
            fileId: 'file-bh',
            filename: 'BH.pdf',
            mediaType: 'application/pdf',
            storageKey: 'uploads/user/BH.pdf',
          },
        ],
      };
      const paddleToolName = `paddleocr_vl${Constants.mcp_delimiter}PaddleOCR`;
      const invokePaddleOcr = jest.fn().mockResolvedValue({
        content: 'RAW OCR RESULT THAT SHOULD NOT RUN',
      });
      mockLoadToolsUtil.mockResolvedValue({
        loadedTools: [
          {
            name: paddleToolName,
            invoke: invokePaddleOcr,
          },
        ],
        toolContextMap: {},
      });
      mockReadOcrPreprocessingState.mockResolvedValueOnce({
        ocrFileKey: 'file:file-bh',
        sourcePdfKey: 'uploads/user/BH.pdf',
        pipelineVersion: 1,
        ocrRuleVersion: 'ocr-rules:test',
        chunkSizePages: 50,
        chunkCount: 2,
        chunks: [
          {
            chunkIndex: 1,
            chunkCount: 2,
            pageStart: 1,
            pageEnd: 50,
            chunkSizePages: 50,
            rawSaved: true,
            organizedSaved: true,
            rawResultHash: 'hash-1',
            rawOcrText: 'raw 1',
            organizedMarkdown:
              '## BH.pdf OCR 結果確認表｜第 1～50 頁\n\n| 品名 | 數量 |\n|---|---|\n| A | 1 |',
          },
          {
            chunkIndex: 2,
            chunkCount: 2,
            pageStart: 51,
            pageEnd: 100,
            chunkSizePages: 50,
            rawSaved: true,
            organizedSaved: true,
            rawResultHash: 'hash-2',
            rawOcrText: 'raw 2',
            organizedMarkdown:
              '## BH.pdf OCR 結果確認表｜第 51～100 頁\n\n| 品名 | 材質 |\n|---|---|\n| B | SS400 |',
          },
        ],
      });

      const result = await loadToolsForExecution({
        req,
        res: {},
        streamId: 'stream-existing-ocr',
        agent: { id: 'agent_existing_ocr', tools: [paddleToolName] },
        toolNames: [paddleToolName],
        actionsEnabled: false,
      });
      const output = await result.loadedTools[0].invoke(
        { input_data: 'uploads/user/BH.pdf', output_mode: 'detailed' },
        { toolCall: { id: 'call-existing-ocr' } },
      );

      expect(invokePaddleOcr).not.toHaveBeenCalled();
      expect(mockCapturePaddleOcrChunkResult).not.toHaveBeenCalled();
      expect(mockCaptureOcrPreprocessingChunkMarkdown).not.toHaveBeenCalled();
      expect(output.content).toContain('<file:file-bh>');
      expect(output.content).toContain('| 品名 | 數量 | 材質 |');
      expect(output.content).not.toContain('第 1～50 頁');
      expect(output.content).not.toContain('第 51～100 頁');
      expect(output.content).not.toContain('RAW OCR RESULT');

      const steelEventMessages = mockEmitChunk.mock.calls
        .map(([, event]) => event)
        .filter((event) => event.event === 'steel_event')
        .map((event) => event.data?.message);
      expect(steelEventMessages).toEqual(
        expect.arrayContaining([
          'Read OCR markdowns (file:file-bh: 2 chunks)',
          'Processing pdf with OCR markdowns (file:file-bh)',
        ]),
      );
      expect(steelEventMessages).not.toEqual(
        expect.arrayContaining(['Running paddleocr_vl in PaddleOCR (chunk 1/1) (file:file-bh)']),
      );
    });

    it('threads the owning job epoch into web-search attachment callbacks', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.web_search];
      const req = createMockReq(capabilities);
      const res = {};
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadToolsForExecution({
        req,
        res,
        streamId: 'conversation-1',
        jobCreatedAt: 1234,
        agent: { id: 'agent_123', tools: [Tools.web_search] },
        toolNames: [Tools.web_search],
        actionsEnabled: false,
      });

      expect(createOnSearchResults).toHaveBeenCalledWith(res, 'conversation-1', 1234);
    });

    it('does not load code execution tools that were not registered for the agent', async () => {
      const capabilities = [
        AgentCapabilities.tools,
        AgentCapabilities.web_search,
        AgentCapabilities.execute_code,
      ];
      const req = createMockReq(capabilities);
      const toolRegistry = new Map([[Tools.web_search, { name: Tools.web_search }]]);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_without_code', tools: [Tools.web_search] },
        toolNames: [AgentConstants.BASH_TOOL, Tools.execute_code],
        toolRegistry,
        actionsEnabled: false,
      });

      expect(result.loadedTools.map((tool) => tool.name)).toEqual([]);
      expect(mockLoadToolsUtil).not.toHaveBeenCalled();
    });

    it('keeps stateless and stateful agents on isolated execution profiles in one run', async () => {
      const capabilities = [
        AgentCapabilities.tools,
        AgentCapabilities.execute_code,
        AgentCapabilities.stateful_code_sessions,
      ];
      const req = createMockReq(capabilities);
      req.body = { conversationId: 'conversation-1' };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      process.env.LIBRECHAT_CODE_BASEURL = 'http://code-default.test/v1';
      process.env.LIBRECHAT_CODE_BASEURL_STATEFUL = 'http://code-stateful.test/v1';

      try {
        const stateless = await loadToolsForExecution({
          req,
          res: {},
          agent: { id: 'stateless-agent', tools: [Tools.execute_code] },
          toolNames: [],
        });
        const stateful = await loadToolsForExecution({
          req,
          res: {},
          agent: {
            id: 'stateful-agent',
            tools: [Tools.execute_code],
            stateful_code_sessions: true,
            stateful_code_environment: 'agent-user',
          },
          toolNames: [],
        });

        expect(stateless.configurable.codeExecutionContext).toEqual({
          baseUrl: 'http://code-default.test/v1',
          codeSessionKey: 'execute_code',
          executionProfile: 'default',
          statefulSessions: false,
        });
        expect(stateful.configurable.codeExecutionContext).toEqual({
          baseUrl: 'http://code-stateful.test/v1',
          codeSessionKey: 'execute_code:stateful:v2:agent-user:7c684f0773d9642c122f67aa30e9e0f4',
          executionProfile: 'stateful',
          runtimeSessionHint: 'v2:agent-user:7c684f0773d9642c122f67aa30e9e0f4',
          statefulSessions: true,
        });
      } finally {
        delete process.env.LIBRECHAT_CODE_BASEURL;
        delete process.env.LIBRECHAT_CODE_BASEURL_STATEFUL;
      }
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

    it('resolves stateful routing when handle_skill is the only requested tool', async () => {
      const capabilities = [
        AgentCapabilities.tools,
        AgentCapabilities.execute_code,
        AgentCapabilities.stateful_code_sessions,
      ];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));
      process.env.LIBRECHAT_CODE_BASEURL_STATEFUL = 'http://code-stateful.test/v1';

      try {
        const result = await loadToolsForExecution({
          req,
          res: {},
          agent: {
            id: 'stateful-agent',
            tools: [Tools.execute_code],
            stateful_code_sessions: true,
            stateful_code_environment: 'agent-user',
          },
          toolNames: [AgentConstants.SKILL_TOOL],
          actionsEnabled: false,
        });

        expect(result.configurable.codeExecutionContext.executionProfile).toBe('stateful');
        expect(mockResolveCodeExecutionContext).toHaveBeenLastCalledWith(
          expect.objectContaining({ statefulSessions: true, environment: 'agent-user' }),
        );
      } finally {
        delete process.env.LIBRECHAT_CODE_BASEURL_STATEFUL;
      }
    });

    it('loads bash PTC under the legacy programmatic tool name when code capabilities are enabled', async () => {
      const capabilities = [
        AgentCapabilities.tools,
        AgentCapabilities.programmatic_tools,
        AgentCapabilities.execute_code,
      ];
      const req = createMockReq(capabilities);
      const toolRegistry = new Map([['custom_tool', { name: 'custom_tool' }]]);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_ptc', tools: [Tools.execute_code] },
        toolNames: [Constants.PROGRAMMATIC_TOOL_CALLING],
        toolRegistry,
        actionsEnabled: false,
      });

      expect(result.loadedTools.map((tool) => tool.name)).toEqual([
        Constants.PROGRAMMATIC_TOOL_CALLING,
      ]);
      expect(result.configurable.toolRegistry).toBe(toolRegistry);
      expect(result.configurable.ptcToolMap.size).toBe(0);
    });

    it('passes run-scoped MCP tool definitions into PTC execution loading', async () => {
      const capabilities = [
        AgentCapabilities.tools,
        AgentCapabilities.programmatic_tools,
        AgentCapabilities.execute_code,
      ];
      const req = createMockReq(capabilities);
      const serverName = 'ClickHouse';
      const mcpTool = `list_tables${Constants.mcp_delimiter}${serverName}`;
      const mcpAvailableTools = {
        [serverName]: {
          [mcpTool]: {
            function: {
              name: mcpTool,
              description: 'List tables',
              parameters: { type: 'object', properties: {} },
            },
          },
        },
      };
      const toolRegistry = new Map([[mcpTool, { name: mcpTool }]]);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_ptc', tools: [Tools.execute_code] },
        toolNames: [Constants.BASH_PROGRAMMATIC_TOOL_CALLING],
        toolRegistry,
        mcpAvailableTools,
        actionsEnabled: false,
      });

      expect(mockLoadToolsUtil).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [mcpTool],
          options: expect.objectContaining({
            mcpAvailableTools,
          }),
        }),
      );
    });

    it('does not load PTC when programmatic tools capability is disabled', async () => {
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.execute_code];
      const req = createMockReq(capabilities);
      const toolRegistry = new Map([['custom_tool', { name: 'custom_tool' }]]);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_ptc', tools: [Tools.execute_code] },
        toolNames: [Constants.BASH_PROGRAMMATIC_TOOL_CALLING],
        toolRegistry,
        actionsEnabled: false,
      });

      expect(result.loadedTools.map((tool) => tool.name)).toEqual([]);
      expect(result.configurable.toolRegistry).toBeUndefined();
      expect(result.configurable.ptcToolMap).toBeUndefined();
    });

    it('does not load PTC when agent did not request execute_code', async () => {
      const capabilities = [
        AgentCapabilities.tools,
        AgentCapabilities.programmatic_tools,
        AgentCapabilities.execute_code,
      ];
      const req = createMockReq(capabilities);
      const toolRegistry = new Map([['custom_tool', { name: 'custom_tool' }]]);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_ptc', tools: [] },
        toolNames: [Constants.BASH_PROGRAMMATIC_TOOL_CALLING],
        toolRegistry,
        actionsEnabled: false,
      });

      expect(result.loadedTools.map((tool) => tool.name)).toEqual([]);
      expect(result.configurable.toolRegistry).toBeUndefined();
      expect(result.configurable.ptcToolMap).toBeUndefined();
    });

    it('should skip action tool loading when actionsEnabled=false', async () => {
      const req = createMockReq([]);
      req.config = {};

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: [regularTool, actionToolName],
        actionsEnabled: false,
      });

      expect(mockLoadActionSets).not.toHaveBeenCalled();
      expect(result.loadedTools).toBeDefined();
    });

    it('should load action tools when actionsEnabled=true', async () => {
      const req = createMockReq([AgentCapabilities.actions]);
      req.config = {};

      await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: [actionToolName],
        actionsEnabled: true,
      });

      expect(mockLoadActionSets).toHaveBeenCalledWith({ agent_id: 'agent_123' });
    });

    it('should resolve actionsEnabled from capabilities when not explicitly provided', async () => {
      const capabilities = [AgentCapabilities.tools];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: [actionToolName],
      });

      expect(mockGetEndpointsConfig).toHaveBeenCalled();
      expect(mockLoadActionSets).not.toHaveBeenCalled();
    });

    it('should not call loadActionSets when there are no action tools', async () => {
      const req = createMockReq([AgentCapabilities.actions]);
      req.config = {};

      await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: [regularTool],
        actionsEnabled: true,
      });

      expect(mockLoadActionSets).not.toHaveBeenCalled();
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
      mockCaptureSteelNativeToolResult.mockResolvedValueOnce({
        status: 'captured',
        result: { savedCounts: { ocr_extract: 1 } },
      });
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
      expect(mockExecuteSteelTool).not.toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'run_file_ocr' }),
      );
      expect(mockEmitChunk).not.toHaveBeenCalledWith(
        'stream-1',
        expect.objectContaining({
          data: expect.objectContaining({ toolName: 'run_file_ocr' }),
        }),
      );
    });

    it('limits price candidate retries independently of the broader Steel call cap', async () => {
      const req = createMockReq([AgentCapabilities.tools]);
      req.body = { conversationId: 'convo-price-limit' };
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig([AgentCapabilities.tools]));
      mockCreateSteelToolRunState.mockClear();
      mockExecuteSteelTool.mockImplementation(async ({ toolName, runState }) => {
        const callsForTool = runState.callsUsedByTool?.[toolName] ?? 0;
        const perToolLimit = runState.maxCallsByTool?.[toolName];
        if (
          runState.callsUsed >= runState.maxCalls ||
          (perToolLimit !== undefined && callsForTool >= perToolLimit)
        ) {
          return {
            ok: false,
            toolName,
            errorCategory: 'rate_limited',
            errorSummary: 'Steel tool call limit exceeded',
            durationMs: 0,
            redactionVersion: 1,
          };
        }
        runState.callsUsed += 1;
        runState.callsUsedByTool[toolName] = callsForTool + 1;
        return {
          ok: true,
          toolName,
          data: {},
          durationMs: 0,
          redactionVersion: 1,
        };
      });

      const firstResult = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_price_limit' },
        toolNames: ['search_price_candidates', 'search_customers'],
        actionsEnabled: false,
      });
      const priceTool = firstResult.loadedTools.find(
        (tool) => tool.name === 'search_price_candidates',
      );

      expect(mockCreateSteelToolRunState).toHaveBeenCalledWith(8, {
        search_price_candidates: 2,
      });
      await expect(priceTool.invoke({})).resolves.toMatchObject({ ok: true });

      const secondResult = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_price_limit' },
        toolNames: ['search_price_candidates'],
        requestScopedConnections: firstResult.configurable.requestScopedConnections,
        actionsEnabled: false,
      });
      const secondPriceTool = secondResult.loadedTools.find(
        (tool) => tool.name === 'search_price_candidates',
      );
      await expect(secondPriceTool.invoke({})).resolves.toMatchObject({ ok: true });

      const thirdResult = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_price_limit' },
        toolNames: ['search_price_candidates'],
        requestScopedConnections: secondResult.configurable.requestScopedConnections,
        actionsEnabled: false,
      });
      const thirdPriceTool = thirdResult.loadedTools.find(
        (tool) => tool.name === 'search_price_candidates',
      );
      await expect(thirdPriceTool.invoke({})).resolves.toMatchObject({
        ok: false,
        errorCategory: 'rate_limited',
      });
      expect(mockCreateSteelToolRunState).toHaveBeenCalledTimes(1);

      const freshReq = createMockReq([AgentCapabilities.tools]);
      freshReq.body = { conversationId: 'convo-price-limit-fresh' };
      const freshPriceResult = await loadToolsForExecution({
        req: freshReq,
        res: {},
        agent: { id: 'agent_price_limit_fresh' },
        toolNames: ['search_price_candidates'],
        actionsEnabled: false,
      });
      const freshPriceTool = freshPriceResult.loadedTools.find(
        (tool) => tool.name === 'search_price_candidates',
      );
      await expect(freshPriceTool.invoke({})).resolves.toMatchObject({ ok: true });
      expect(mockCreateSteelToolRunState).toHaveBeenCalledTimes(2);

      const customerResult = await loadToolsForExecution({
        req: freshReq,
        res: {},
        agent: { id: 'agent_customer_limit' },
        toolNames: ['search_customers'],
        requestScopedConnections: freshPriceResult.configurable.requestScopedConnections,
        actionsEnabled: false,
      });
      const customerToolOnly = customerResult.loadedTools.find(
        (tool) => tool.name === 'search_customers',
      );
      for (let index = 0; index < 7; index += 1) {
        await expect(customerToolOnly.invoke({})).resolves.toMatchObject({ ok: true });
      }
      await expect(customerToolOnly.invoke({})).resolves.toMatchObject({
        ok: false,
        errorCategory: 'rate_limited',
      });
    });

    it('loads delegate_ocr with owner-only lookup, fresh range-artifact signing, and current turn only', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const providerHistory = [new HumanMessage('請重新確認開槽連續邊長')];
      const req = createMockReq([AgentCapabilities.tools]);
      req.config.fileStrategy = 's3';
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1'],
        },
        delegateOcrContext: {
          history: providerHistory,
          modelOptions: {
            authFilePath: '/tmp/auth.json',
            model: 'gpt-5.6-luna',
            reasoningEffort: 'high',
          },
          steelConversation: {
            requestId: 'response-1',
            currentUserTurn: {
              role: 'user',
              content: '重新核對第 35 頁孔數',
            },
            activeHistory: [
              {
                role: 'user',
                content: 'OCR檔案內容，逐一列表給我核對。',
                files: [
                  {
                    fileId: 'drawing-1',
                    mediaType: 'application/pdf',
                    source: 'librechat_file_record',
                  },
                ],
              },
              { role: 'assistant', content: '已完成 OCR。' },
              { role: 'user', content: 'ocr看一下切工' },
            ],
          },
        },
      };
      const oldUrl = 'https://old.example/drawing.pdf?expired=true';
      const freshUrl = 'https://fresh.example/drawing.pdf?expires=43200';
      const fileRecord = {
        file_id: 'drawing-1',
        user: 'user_123',
        filename: 'drawing.pdf',
        type: 'application/pdf',
        source: 's3',
        storageKey: 'uploads/user_123/drawing-1__drawing.pdf',
        filepath: oldUrl,
      };
      const getDownloadURL = jest.fn().mockResolvedValue(freshUrl);
      const getDownloadStream = jest.fn().mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('%PDF-1.7');
        },
      });
      const stream = jest.fn(async function* () {
        yield { content: '連續邊長為 ' };
        yield { content: [{ type: 'text', text: '1,400mm。' }] };
      });
      mockGetFiles.mockResolvedValueOnce([fileRecord]);
      mockGetStrategyFunctions.mockReturnValueOnce({ getDownloadURL, getDownloadStream });
      mockGetPdfPageCount.mockResolvedValueOnce(35);
      mockEnsurePdfChunkArtifacts.mockResolvedValueOnce([
        {
          sourcePdfKey: fileRecord.storageKey,
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 35,
          pageEnd: 35,
          chunkSizePages: 1,
          source: 's3',
          storageKey: fileRecord.storageKey,
          filepath: freshUrl,
          filename: fileRecord.filename,
          bytes: 100,
          contentType: 'application/pdf',
          artifactOrigin: 'uploaded',
        },
      ]);
      mockCreateOpenAIOAuthModel.mockReturnValueOnce({ stream });

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
        enableDelegateOcrStreaming: true,
      });
      const tool = result.loadedTools.find((entry) => entry.name === 'delegate_ocr');
      const output = await tool.invoke(
        { fileKeys: ['file:pdf'] },
        { toolCall: { id: 'call_delegate_1' } },
      );

      expect(output.content).toBe('連續邊長為 1,400mm。');
      expect(mockGetFiles).toHaveBeenCalledWith(
        {
          user: 'user_123',
          $or: [{ file_id: { $in: ['drawing-1'] } }],
        },
        {},
        {},
      );
      expect(mockGetFiles.mock.calls[0][0]).not.toHaveProperty('tenantId');
      expect(getDownloadURL).not.toHaveBeenCalledWith({ file: fileRecord });
      const nestedMessages = stream.mock.calls[0][0];
      expect(mockBuildDefaultSteelGlobalAgentContext).toHaveBeenCalledWith({
        conversation: req.steelNativeContext.delegateOcrContext.steelConversation,
        renderProfile: 'agent_client',
        mode: 'delegate_ocr',
      });
      expect(JSON.stringify(nestedMessages)).toContain('OCR_RULE');
      expect(JSON.stringify(nestedMessages)).toContain('VISION_RULE');
      expect(JSON.stringify(nestedMessages)).toContain('OCR_MAIN_RULE');
      expect(JSON.stringify(nestedMessages)).toContain('[final_ocr_markdown]');
      expect(JSON.stringify(nestedMessages)).not.toContain('[ocr_main_merge]');
      expect(JSON.stringify(nestedMessages)).not.toContain('[ocr_organizer]');
      expect(nestedMessages[1].content).toBe('重新核對第 35 頁孔數');
      expect(JSON.stringify(nestedMessages)).not.toContain('請重新確認開槽連續邊長');
      expect(JSON.stringify(nestedMessages)).toContain(freshUrl);
      expect(JSON.stringify(nestedMessages)).not.toContain(oldUrl);
      expect(mockCreateOpenAIOAuthModel).toHaveBeenCalledWith(
        req.steelNativeContext.delegateOcrContext.modelOptions,
      );
      expect(result.configurable.delegateOcrStreaming).toBe(true);
    });

    it('hard-stops quote-only delegation before any file, signer, rules, or model dependency', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const req = createMockReq([AgentCapabilities.tools]);
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1'],
        },
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
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1'],
        },
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

    it('rejects an out-of-bounds page range before creating any PDF artifact', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const req = createMockReq([AgentCapabilities.tools]);
      req.config.fileStrategy = 's3';
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1'],
        },
        delegateOcrContext: {
          history: [new HumanMessage('重新核對第 35 頁孔數')],
          modelOptions: { model: 'gpt-5.6-luna' },
          steelConversation: {
            currentUserTurn: { role: 'user', content: '重新核對第 35 頁孔數' },
            activeHistory: [{ role: 'user', content: '重新核對第 35 頁孔數' }],
          },
        },
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'drawing-1',
          user: 'user_123',
          filename: 'drawing.pdf',
          type: 'application/pdf',
          source: 's3',
          storageKey: 'uploads/user_123/drawing-1__drawing.pdf',
        },
      ]);
      mockGetStrategyFunctions.mockReturnValueOnce({
        getDownloadStream: jest.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            yield Buffer.from('%PDF-1.7');
          },
        }),
      });
      mockGetPdfPageCount.mockResolvedValueOnce(34);

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      const tool = result.loadedTools.find((entry) => entry.name === 'delegate_ocr');

      await expect(tool.invoke({ fileKeys: ['file:drawing-1'] })).rejects.toThrow(
        'exceeds PDF page count 34',
      );
      expect(mockEnsurePdfChunkArtifacts).not.toHaveBeenCalled();
      expect(mockCreateOpenAIOAuthModel).not.toHaveBeenCalled();
    });

    it('physically splits an explicit page-1 range instead of sending the full PDF', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const req = createMockReq([AgentCapabilities.tools]);
      req.config.fileStrategy = 's3';
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1', 'file:detail-1'],
        },
        delegateOcrContext: {
          history: [new HumanMessage('重新核對第 1 頁孔數')],
          modelOptions: { model: 'gpt-5.6-luna' },
          steelConversation: {
            currentUserTurn: { role: 'user', content: '重新核對第 1 頁孔數' },
            activeHistory: [{ role: 'user', content: '重新核對第 1 頁孔數' }],
          },
        },
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'drawing-1',
          filename: 'drawing.pdf',
          type: 'application/pdf',
          source: 's3',
          storageKey: 'uploads/user_123/drawing-1__drawing.pdf',
        },
      ]);
      mockGetStrategyFunctions.mockReturnValueOnce({
        getDownloadStream: jest.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            yield Buffer.from('%PDF-1.7');
          },
        }),
      });
      mockGetPdfPageCount.mockResolvedValueOnce(3);
      mockEnsurePdfChunkArtifacts.mockResolvedValueOnce([
        {
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 1,
          pageEnd: 1,
          chunkSizePages: 1,
          filepath: 'https://fresh.example/pages-1-1.pdf',
          storageKey: 'ocr/pages-1-1.pdf',
          filename: 'pages-1-1.pdf',
          source: 's3',
        },
      ]);
      const stream = jest.fn(async function* (messages) {
        yield { content: JSON.stringify(messages.at(-1)?.content) };
      });
      mockCreateOpenAIOAuthModel.mockReturnValueOnce({ stream });

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      const tool = result.loadedTools.find((entry) => entry.name === 'delegate_ocr');
      await tool.invoke({ fileKeys: ['file:drawing-1'] });

      expect(mockEnsurePdfChunkArtifacts).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(stream.mock.calls[0][0].at(-1)?.content)).toContain(
        'pages-1-1.pdf',
      );
    });

    it('runs a 106-page PDF through three ordered 50-page Vision batches', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const req = createMockReq([AgentCapabilities.tools]);
      req.config.fileStrategy = 's3';
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1'],
        },
        delegateOcrContext: {
          history: [new HumanMessage('完整 OCR 106 頁 PDF')],
          modelOptions: { model: 'gpt-5.6-luna' },
          steelConversation: {
            currentUserTurn: { role: 'user', content: '完整 OCR 106 頁 PDF' },
            activeHistory: [{ role: 'user', content: '完整 OCR 106 頁 PDF' }],
          },
        },
      };
      const fileRecord = {
        file_id: 'drawing-1',
        user: 'user_123',
        filename: 'drawing.pdf',
        type: 'application/pdf',
        source: 's3',
        storageKey: 'uploads/user_123/drawing-1__drawing.pdf',
      };
      mockGetFiles.mockResolvedValueOnce([fileRecord]);
      mockGetStrategyFunctions.mockReturnValueOnce({
        getDownloadStream: jest.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            yield Buffer.from('%PDF-1.7');
          },
        }),
      });
      mockGetPdfPageCount.mockResolvedValueOnce(106);
      mockBuildPdfPageChunks.mockReturnValueOnce([
        { chunkIndex: 1, chunkCount: 3, pageStart: 1, pageEnd: 50, chunkSizePages: 50 },
        { chunkIndex: 2, chunkCount: 3, pageStart: 51, pageEnd: 100, chunkSizePages: 50 },
        { chunkIndex: 3, chunkCount: 3, pageStart: 101, pageEnd: 106, chunkSizePages: 50 },
      ]);
      mockEnsurePdfChunkArtifacts.mockImplementation(async ({ chunks }) =>
        chunks.map(({ chunkIndex, chunkCount, pageStart, pageEnd, chunkSizePages }) => ({
          chunkIndex,
          chunkCount,
          pageStart,
          pageEnd,
          chunkSizePages,
          filepath: `https://fresh.example/pages-${pageStart}-${pageEnd}.pdf`,
          storageKey: `ocr/pages-${pageStart}-${pageEnd}.pdf`,
          filename: `pages-${pageStart}-${pageEnd}.pdf`,
          source: 's3',
        })),
      );
      const stream = jest.fn(async function* (messages) {
        yield { content: JSON.stringify(messages.at(-1)?.content) };
      });
      mockCreateOpenAIOAuthModel.mockReturnValue({ stream });

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      const tool = result.loadedTools.find((entry) => entry.name === 'delegate_ocr');
      const output = await tool.invoke({ fileKeys: ['file:drawing-1'] });

      expect(stream).toHaveBeenCalledTimes(3);
      expect(stream.mock.calls.map(([messages]) => JSON.stringify(messages.at(-1)?.content))).toEqual(
        expect.arrayContaining([
          expect.stringContaining('pages-1-50.pdf'),
          expect.stringContaining('pages-51-100.pdf'),
          expect.stringContaining('pages-101-106.pdf'),
        ]),
      );
      expect(output.content).toContain('pages-101-106.pdf');
    });

    it('names the failing original range when PDF artifact preparation fails', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const req = createMockReq([AgentCapabilities.tools]);
      req.config.fileStrategy = 's3';
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1'],
        },
        delegateOcrContext: {
          history: [new HumanMessage('重新核對整份圖面')],
          modelOptions: { model: 'gpt-5.6-luna' },
          steelConversation: {
            currentUserTurn: { role: 'user', content: '重新核對整份圖面' },
            activeHistory: [{ role: 'user', content: '重新核對整份圖面' }],
          },
        },
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'drawing-1',
          filename: 'drawing.pdf',
          type: 'application/pdf',
          source: 's3',
          storageKey: 'uploads/user_123/drawing-1__drawing.pdf',
        },
      ]);
      mockGetStrategyFunctions.mockReturnValueOnce({
        getDownloadStream: jest.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            yield Buffer.from('%PDF-1.7');
          },
        }),
      });
      mockGetPdfPageCount.mockResolvedValueOnce(106);
      mockBuildPdfPageChunks.mockReturnValueOnce([
        { chunkIndex: 1, chunkCount: 3, pageStart: 1, pageEnd: 50, chunkSizePages: 50 },
        { chunkIndex: 2, chunkCount: 3, pageStart: 51, pageEnd: 100, chunkSizePages: 50 },
        { chunkIndex: 3, chunkCount: 3, pageStart: 101, pageEnd: 106, chunkSizePages: 50 },
      ]);
      mockEnsurePdfChunkArtifacts.mockImplementation(async ({ chunks }) => {
        if (chunks[0]?.pageStart === 51) {
          throw new Error('storage unavailable');
        }
        return chunks.map((chunk) => ({
          ...chunk,
          filepath: `https://fresh.example/pages-${chunk.pageStart}-${chunk.pageEnd}.pdf`,
          storageKey: `ocr/pages-${chunk.pageStart}-${chunk.pageEnd}.pdf`,
          filename: `pages-${chunk.pageStart}-${chunk.pageEnd}.pdf`,
          source: 's3',
        }));
      });

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      const tool = result.loadedTools.find((entry) => entry.name === 'delegate_ocr');

      await expect(tool.invoke({ fileKeys: ['file:drawing-1'] })).rejects.toThrow(
        'failed preparing pages 51-100',
      );
      expect(mockCreateOpenAIOAuthModel).not.toHaveBeenCalled();
      expect(mockEnsurePdfChunkArtifacts).toHaveBeenCalledTimes(2);
    });

    it('keeps a selected non-PDF source alongside the first PDF range batch', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const req = createMockReq([AgentCapabilities.tools]);
      req.config.fileStrategy = 's3';
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1', 'file:detail-1'],
        },
        delegateOcrContext: {
          history: [new HumanMessage('重新核對第 35 頁孔數')],
          modelOptions: { model: 'gpt-5.6-luna' },
          steelConversation: {
            currentUserTurn: { role: 'user', content: '重新核對第 35 頁孔數' },
            activeHistory: [{ role: 'user', content: '重新核對第 35 頁孔數' }],
          },
        },
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'drawing-1',
          filename: 'drawing.pdf',
          type: 'application/pdf',
          source: 's3',
          storageKey: 'uploads/user_123/drawing-1__drawing.pdf',
        },
        {
          file_id: 'detail-1',
          filename: 'detail.png',
          type: 'image/png',
          source: 's3',
          storageKey: 'uploads/user_123/detail-1__detail.png',
        },
      ]);
      mockGetStrategyFunctions.mockReturnValue({
        getDownloadStream: jest.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            yield Buffer.from('%PDF-1.7');
          },
        }),
        getDownloadURL: jest.fn(({ file }) =>
          Promise.resolve(`https://fresh.example/${file.filename}`),
        ),
      });
      mockGetPdfPageCount.mockResolvedValueOnce(35);
      mockEnsurePdfChunkArtifacts.mockResolvedValueOnce([
        {
          chunkIndex: 1,
          chunkCount: 1,
          pageStart: 35,
          pageEnd: 35,
          chunkSizePages: 1,
          filepath: 'https://fresh.example/pages-35-35.pdf',
          storageKey: 'ocr/pages-35-35.pdf',
          filename: 'pages-35-35.pdf',
          source: 's3',
        },
      ]);
      const stream = jest.fn(async function* (messages) {
        yield { content: JSON.stringify(messages.at(-1)?.content) };
      });
      mockCreateOpenAIOAuthModel.mockReturnValueOnce({ stream });

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      const tool = result.loadedTools.find((entry) => entry.name === 'delegate_ocr');
      await tool.invoke({ fileKeys: ['file:drawing-1', 'file:detail-1'] });

      expect(stream).toHaveBeenCalledTimes(1);
      const source = JSON.stringify(stream.mock.calls[0][0].at(-1)?.content);
      expect(source).toContain('pages-35-35.pdf');
      expect(source).toContain('detail.png');
    });

    it('lets delegate_ocr signing errors propagate to the generic tool error UI path', async () => {
      const { HumanMessage } = require('@librechat/agents/langchain/messages');
      const req = createMockReq([AgentCapabilities.tools]);
      req.config.fileStrategy = 's3';
      req.steelNativeContext = {
        delegateOcrPolicy: {
          resolved: true,
          allowed: true,
          allowedFileKeys: ['file:drawing-1'],
        },
        delegateOcrContext: {
          history: [new HumanMessage('重新解析')],
          modelOptions: { model: 'gpt-5.6-luna' },
          steelConversation: {
            requestId: 'response-1',
            activeHistory: [{ role: 'user', content: '重新解析' }],
          },
        },
      };
      mockGetFiles.mockResolvedValueOnce([
        {
          file_id: 'drawing-1',
          user: 'user_123',
          source: 's3',
          storageKey: 'uploads/user_123/drawing-1__drawing.pdf',
        },
      ]);
      mockGetStrategyFunctions.mockReturnValueOnce({
        getDownloadURL: jest.fn().mockRejectedValue(new Error('S3 signer failed')),
      });

      const result = await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_123' },
        toolNames: ['delegate_ocr'],
        actionsEnabled: false,
      });
      const tool = result.loadedTools.find((entry) => entry.name === 'delegate_ocr');

      await expect(
        tool.invoke(
          { fileKeys: ['file:drawing-1'] },
          { toolCall: { id: 'call_delegate_error' } },
        ),
      ).rejects.toThrow('S3 signer failed');
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

  describe('checkCapability logic', () => {
    const createCheckCapability = (enabledCapabilities, logger = { warn: jest.fn() }) => {
      return (capability) => {
        const enabled = enabledCapabilities.has(capability);
        if (!enabled) {
          const isToolCapability = [
            AgentCapabilities.file_search,
            AgentCapabilities.execute_code,
            AgentCapabilities.web_search,
          ].includes(capability);
          const suffix = isToolCapability ? ' despite configured tool.' : '.';
          logger.warn(`Capability "${capability}" disabled${suffix}`);
        }
        return enabled;
      };
    };

    it('should return true when capability is enabled', () => {
      const enabledCapabilities = new Set([AgentCapabilities.deferred_tools]);
      const checkCapability = createCheckCapability(enabledCapabilities);

      expect(checkCapability(AgentCapabilities.deferred_tools)).toBe(true);
    });

    it('should return false when capability is not enabled', () => {
      const enabledCapabilities = new Set([]);
      const checkCapability = createCheckCapability(enabledCapabilities);

      expect(checkCapability(AgentCapabilities.deferred_tools)).toBe(false);
    });

    it('should log warning with "despite configured tool" for tool capabilities', () => {
      const logger = { warn: jest.fn() };
      const enabledCapabilities = new Set([]);
      const checkCapability = createCheckCapability(enabledCapabilities, logger);

      checkCapability(AgentCapabilities.file_search);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('despite configured tool'));

      logger.warn.mockClear();
      checkCapability(AgentCapabilities.execute_code);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('despite configured tool'));

      logger.warn.mockClear();
      checkCapability(AgentCapabilities.web_search);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('despite configured tool'));
    });

    it('should log warning without "despite configured tool" for non-tool capabilities', () => {
      const logger = { warn: jest.fn() };
      const enabledCapabilities = new Set([]);
      const checkCapability = createCheckCapability(enabledCapabilities, logger);

      checkCapability(AgentCapabilities.deferred_tools);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Capability "deferred_tools" disabled.'),
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('despite configured tool'),
      );

      logger.warn.mockClear();
      checkCapability(AgentCapabilities.tools);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Capability "tools" disabled.'),
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('despite configured tool'),
      );

      logger.warn.mockClear();
      checkCapability(AgentCapabilities.actions);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Capability "actions" disabled.'),
      );
    });

    it('should not log warning when capability is enabled', () => {
      const logger = { warn: jest.fn() };
      const enabledCapabilities = new Set([
        AgentCapabilities.deferred_tools,
        AgentCapabilities.file_search,
      ]);
      const checkCapability = createCheckCapability(enabledCapabilities, logger);

      checkCapability(AgentCapabilities.deferred_tools);
      checkCapability(AgentCapabilities.file_search);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('defaultAgentCapabilities', () => {
    it('should include deferred_tools capability by default', () => {
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.deferred_tools);
    });

    it('should include all expected default capabilities', () => {
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.execute_code);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.file_search);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.web_search);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.artifacts);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.actions);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.context);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.ask_user_question);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.tools);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.chain);
      expect(defaultAgentCapabilities).toContain(AgentCapabilities.ocr);
    });
  });

  describe('userMCPAuthMap gating', () => {
    const shouldFetchMCPAuth = (tools) =>
      tools?.some((t) => t.includes(Constants.mcp_delimiter)) ?? false;

    it('should return true when agent has MCP tools', () => {
      const tools = ['web_search', `search${Constants.mcp_delimiter}my-mcp-server`, 'calculator'];
      expect(shouldFetchMCPAuth(tools)).toBe(true);
    });

    it('should return false when agent has no MCP tools', () => {
      const tools = ['web_search', 'calculator', 'code_interpreter'];
      expect(shouldFetchMCPAuth(tools)).toBe(false);
    });

    it('should return false when tools is empty', () => {
      expect(shouldFetchMCPAuth([])).toBe(false);
    });

    it('should return false when tools is undefined', () => {
      expect(shouldFetchMCPAuth(undefined)).toBe(false);
    });

    it('should return false when tools is null', () => {
      expect(shouldFetchMCPAuth(null)).toBe(false);
    });

    it('should detect MCP tools with different server names', () => {
      const tools = [
        `listFiles${Constants.mcp_delimiter}file-server`,
        `query${Constants.mcp_delimiter}db-server`,
      ];
      expect(shouldFetchMCPAuth(tools)).toBe(true);
    });

    it('should return true even when only one tool is MCP', () => {
      const tools = [
        'web_search',
        'calculator',
        'code_interpreter',
        `echo${Constants.mcp_delimiter}test-server`,
      ];
      expect(shouldFetchMCPAuth(tools)).toBe(true);
    });
  });

  describe('deferredToolsEnabled integration', () => {
    it('should correctly determine deferredToolsEnabled from capabilities set', () => {
      const createCheckCapability = (enabledCapabilities) => {
        return (capability) => enabledCapabilities.has(capability);
      };

      const withDeferred = new Set([AgentCapabilities.deferred_tools, AgentCapabilities.tools]);
      const checkWithDeferred = createCheckCapability(withDeferred);
      expect(checkWithDeferred(AgentCapabilities.deferred_tools)).toBe(true);

      const withoutDeferred = new Set([AgentCapabilities.tools, AgentCapabilities.actions]);
      const checkWithoutDeferred = createCheckCapability(withoutDeferred);
      expect(checkWithoutDeferred(AgentCapabilities.deferred_tools)).toBe(false);
    });

    it('should use defaultAgentCapabilities when no capabilities configured', () => {
      const endpointsConfig = {};
      const enabledCapabilities = new Set(
        endpointsConfig?.capabilities ?? defaultAgentCapabilities,
      );

      expect(enabledCapabilities.has(AgentCapabilities.deferred_tools)).toBe(true);
    });
  });

  describe('multi-action domain collision regression', () => {
    // Two distinct OpenAPI Actions whose `servers[0].url` resolves to the
    // same hostname must both contribute their tools to the agent. The
    // previous implementation indexed processed action sets by encoded
    // domain, so the second action overwrote the first in the map and one
    // action's tools silently disappeared from the LLM payload.
    //
    // The encoded domain we use as the lookup key for the action sets is
    // mocked to a fixed string for both actions to make the collision
    // condition deterministic without depending on the real base64
    // truncation rules.
    const SHARED_DOMAIN = 'https://api.example.com';
    const ENCODED_DOMAIN = 'shared_dom';
    const LEGACY_ENCODED_DOMAIN = 'legacy_dom';

    const buildSpec = (operationId, path) =>
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: `Mock ${operationId}`, version: '1.0.0' },
        servers: [{ url: SHARED_DOMAIN }],
        paths: {
          [path]: {
            get: {
              operationId,
              summary: `Mock ${operationId}`,
              responses: {
                200: {
                  description: 'OK',
                  content: { 'application/json': { schema: { type: 'object' } } },
                },
              },
            },
          },
        },
      });

    const actionA = {
      action_id: 'action_a',
      metadata: {
        domain: SHARED_DOMAIN,
        raw_spec: buildSpec('echoMessage', '/echo'),
      },
    };
    const actionB = {
      action_id: 'action_b',
      metadata: {
        domain: SHARED_DOMAIN,
        raw_spec: buildSpec('listItems', '/items'),
      },
    };

    const toolNameA = `echoMessage${actionDelimiter}${ENCODED_DOMAIN}`;
    const toolNameB = `listItems${actionDelimiter}${ENCODED_DOMAIN}`;

    beforeEach(() => {
      // Both actions share a hostname → both call sites get the same encoded
      // value back. This is precisely the collision shape that triggered
      // the bug in production.
      mockDomainParser.mockResolvedValue(ENCODED_DOMAIN);
      mockLegacyDomainEncode.mockReturnValue(LEGACY_ENCODED_DOMAIN);
      mockDecryptMetadata.mockImplementation(async (metadata) => metadata);
      mockCreateActionTool.mockImplementation(async ({ name, requestBuilder }) => ({
        name,
        // Surface the request builder identity on the returned tool so
        // assertions can verify each tool was wired to the correct action's
        // builder, not its sibling's.
        _builder: requestBuilder,
        // Resolve instead of returning undefined — processRequiredActions
        // chains `.then(handleToolOutput)` directly onto this call, which
        // would throw synchronously on an undefined return and mask the
        // test as a simulated runtime crash.
        _call: jest.fn().mockResolvedValue('{"status":"ok"}'),
        schema: {},
        description: '',
      }));
    });

    const expectBothActionsResolved = (calls) => {
      const callsByName = new Map(calls.map((c) => [c[0].name, c[0]]));
      expect(callsByName.has(toolNameA)).toBe(true);
      expect(callsByName.has(toolNameB)).toBe(true);
      // Each tool's request builder must come from the matching action's
      // own parsed spec — not the sibling's. The previous bug would either
      // route both to the same action's builders (and drop one as
      // undefined) or silently skip one entirely.
      const builderA = callsByName.get(toolNameA).requestBuilder;
      const builderB = callsByName.get(toolNameB).requestBuilder;
      expect(builderA).toBeDefined();
      expect(builderB).toBeDefined();
      expect(builderA).not.toBe(builderB);
      // Each builder targets its own operation path — confirms the
      // request builder lookup didn't cross-contaminate between actions.
      expect(builderA.path).toBe('/echo');
      expect(builderB.path).toBe('/items');
    };

    it('loadAgentTools resolves both actions when they share a hostname', async () => {
      mockLoadActionSets.mockResolvedValue([actionA, actionB]);
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.actions];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_collision', tools: [toolNameA, toolNameB] },
        definitionsOnly: false,
      });

      expect(mockCreateActionTool).toHaveBeenCalledTimes(2);
      expectBothActionsResolved(mockCreateActionTool.mock.calls);
    });

    it('loadAgentTools is order-invariant for two actions sharing a hostname', async () => {
      // Reverse the actionSets order — what used to flip the "winner" of
      // the encoded-domain Map overwrite must now make zero observable
      // difference.
      mockLoadActionSets.mockResolvedValue([actionB, actionA]);
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.actions];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_collision', tools: [toolNameA, toolNameB] },
        definitionsOnly: false,
      });

      expect(mockCreateActionTool).toHaveBeenCalledTimes(2);
      expectBothActionsResolved(mockCreateActionTool.mock.calls);
    });

    it('loadToolsForExecution resolves both actions when they share a hostname', async () => {
      mockLoadActionSets.mockResolvedValue([actionA, actionB]);
      const req = createMockReq([AgentCapabilities.actions]);
      req.config = {};

      await loadToolsForExecution({
        req,
        res: {},
        agent: { id: 'agent_collision' },
        toolNames: [toolNameA, toolNameB],
        actionsEnabled: true,
      });

      expect(mockCreateActionTool).toHaveBeenCalledTimes(2);
      expectBothActionsResolved(mockCreateActionTool.mock.calls);
    });

    it('processRequiredActions resolves both actions when they share a hostname', async () => {
      // The assistants/threads path received the same structural rewrite
      // as the agent paths. Cover it directly so future regressions in the
      // `toolToAction` map shape or the lookup normalization don't slip
      // through just because the agent-path tests still pass.
      mockLoadActionSets.mockResolvedValue([actionA, actionB]);
      const client = {
        req: {
          user: { id: 'user_123' },
          body: {
            assistant_id: 'assistant_collision',
            model: 'gpt-4o-mini',
            endpoint: 'openAI',
          },
          config: {},
        },
        res: {},
        apiKey: 'sk-test',
        mappedOrder: new Map(),
        seenToolCalls: new Map(),
        addContentData: jest.fn(),
      };

      await processRequiredActions(client, [
        {
          tool: toolNameA,
          toolInput: {},
          toolCallId: 'call_a',
          thread_id: 'thread_1',
          run_id: 'run_1',
        },
        {
          tool: toolNameB,
          toolInput: {},
          toolCallId: 'call_b',
          thread_id: 'thread_1',
          run_id: 'run_1',
        },
      ]);

      // The assistants path intentionally doesn't forward `name` to
      // createActionTool (see ToolService.js — "intentionally not passing
      // zodSchema, name, and description for assistants API"), so key
      // resolution assertions off the request builder path instead.
      expect(mockCreateActionTool).toHaveBeenCalledTimes(2);
      const builderPaths = mockCreateActionTool.mock.calls.map((c) => c[0].requestBuilder?.path);
      expect(builderPaths).toEqual(expect.arrayContaining(['/echo', '/items']));
      // Each call must carry a distinct builder — guards against the bug
      // where the surviving action's builders got routed to every tool.
      expect(builderPaths[0]).not.toBe(builderPaths[1]);
    });

    it('loadAgentTools resolves legacy-format tool names via the legacy encoding branch', async () => {
      // Agents whose tool names predate the current domain encoding store
      // them under `legacyDomainEncode`'s output. The map registers both
      // encodings per function so these keep resolving after the fix;
      // this test exercises the `if (legacyNormalized !== normalizedDomain)`
      // branch, which was previously never hit by any test.
      mockLoadActionSets.mockResolvedValue([actionA]);
      const legacyToolName = `echoMessage${actionDelimiter}${LEGACY_ENCODED_DOMAIN}`;
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.actions];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_legacy', tools: [legacyToolName] },
        definitionsOnly: false,
      });

      expect(mockCreateActionTool).toHaveBeenCalledTimes(1);
      const [callArgs] = mockCreateActionTool.mock.calls[0];
      expect(callArgs.name).toBe(legacyToolName);
      expect(callArgs.requestBuilder.path).toBe('/echo');
    });

    it('loadAgentTools distinguishes operationIds that differ only by `---` vs `_`', async () => {
      // `openapiToFunction` uses the user-supplied operationId verbatim
      // and only sanitizes the synthetic `<method>_<path>` fallback, and
      // `sanitizeOperationId` preserves `-`. So two operations whose
      // operationIds differ only by `---` vs `_` (e.g. `get_foo---bar`
      // and `get_foo_bar`) are legitimately distinct on the same spec —
      // or, here, on two actions sharing a hostname.
      //
      // Normalization must only touch the encoded-domain suffix after
      // `actionDelimiter`; if it also collapsed the operationId, both
      // tools would write to the same map slot and resolve to the
      // surviving entry's request builder.
      const hyphenSpec = {
        action_id: 'action_hyphen',
        metadata: {
          domain: SHARED_DOMAIN,
          raw_spec: buildSpec('get_foo---bar', '/foo-bar'),
        },
      };
      const underscoreSpec = {
        action_id: 'action_underscore',
        metadata: {
          domain: SHARED_DOMAIN,
          raw_spec: buildSpec('get_foo_bar', '/foo_bar'),
        },
      };
      mockLoadActionSets.mockResolvedValue([hyphenSpec, underscoreSpec]);

      const hyphenTool = `get_foo---bar${actionDelimiter}${ENCODED_DOMAIN}`;
      const underscoreTool = `get_foo_bar${actionDelimiter}${ENCODED_DOMAIN}`;
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.actions];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_hyphen', tools: [hyphenTool, underscoreTool] },
        definitionsOnly: false,
      });

      expect(mockCreateActionTool).toHaveBeenCalledTimes(2);
      const callsByName = new Map(mockCreateActionTool.mock.calls.map((c) => [c[0].name, c[0]]));
      expect(callsByName.has(hyphenTool)).toBe(true);
      expect(callsByName.has(underscoreTool)).toBe(true);
      expect(callsByName.get(hyphenTool).requestBuilder.path).toBe('/foo-bar');
      expect(callsByName.get(underscoreTool).requestBuilder.path).toBe('/foo_bar');
      // Critical: the two must resolve to distinct builders. If the
      // operationId half of the key is normalized, both collapse to
      // the same map slot and one silently overwrites the other.
      expect(callsByName.get(hyphenTool).requestBuilder).not.toBe(
        callsByName.get(underscoreTool).requestBuilder,
      );
    });

    it('loadAgentTools resolves raw `---`-separated tool names from agent.tools', async () => {
      // Hostnames at or below ENCODED_DOMAIN_LENGTH round-trip through
      // `domainParser(..., true)` as a `---`-separated string, and agents
      // persist that raw form in `agent.tools`. The map is always keyed
      // with the `_`-collapsed form, so the lookup must normalize the
      // incoming name or short-hostname tools silently drop out.
      mockDomainParser.mockResolvedValue('shared---dom');
      mockLoadActionSets.mockResolvedValue([actionA, actionB]);
      const rawNameA = `echoMessage${actionDelimiter}shared---dom`;
      const rawNameB = `listItems${actionDelimiter}shared---dom`;
      const capabilities = [AgentCapabilities.tools, AgentCapabilities.actions];
      const req = createMockReq(capabilities);
      mockGetEndpointsConfig.mockResolvedValue(createEndpointsConfig(capabilities));

      await loadAgentTools({
        req,
        res: {},
        agent: { id: 'agent_short', tools: [rawNameA, rawNameB] },
        definitionsOnly: false,
      });

      expect(mockCreateActionTool).toHaveBeenCalledTimes(2);
      const callsByName = new Map(mockCreateActionTool.mock.calls.map((c) => [c[0].name, c[0]]));
      expect(callsByName.has(rawNameA)).toBe(true);
      expect(callsByName.has(rawNameB)).toBe(true);
      expect(callsByName.get(rawNameA).requestBuilder.path).toBe('/echo');
      expect(callsByName.get(rawNameB).requestBuilder.path).toBe('/items');
    });
  });
});
