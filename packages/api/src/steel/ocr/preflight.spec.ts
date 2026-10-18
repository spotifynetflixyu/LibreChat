import mongoose from 'mongoose';
import { Readable } from 'node:stream';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Constants, EModelEndpoint, StepEvents } from 'librechat-data-provider';
import type { Response } from 'express';
import type {
  OcrPdfChunkArtifact,
  OcrPreprocessingFile,
  RunOcrPreprocessingBatchPipelineInput,
  RunOcrPreprocessingBatchPipelineResult,
} from './preprocess';
import type {
  SteelOcrPreflightRequest,
  SteelOcrSourceMappingStore,
  RunSteelPaddleOcrPreflightInput,
} from './preflight';
import type { OcrPreprocessingPageChunk } from './chunks';
import type { SteelOcrFile } from './files';
import { GenerationJobManager } from '~/stream/GenerationJobManager';
import { createSteelDelegateOcrStateService } from './state';
import { createSteelOcrService } from './preflight';

const mockPipeline = jest.fn();
const mockGetPdfPageCount = jest.fn();
const mockBuildPdfPageChunks = jest.fn();
const mockCreatePdfPageRangeChunker = jest.fn();
const mockEnsurePdfChunkArtifacts = jest.fn();
const mockCreateArtifactRepository = jest.fn();
const mockGetS3DownloadURLForKey = jest.fn();
const mockS3ObjectExistsByKey = jest.fn();
const mockListRules = jest.fn();
const mockCreateOAuthModel = jest.fn();
const mockInitializeModel = jest.fn();
const mockBuildPreflightEvents = jest.fn();
const mockWriter = {
  readOcrPreprocessingState: jest.fn(),
  capturePaddleOcrChunkResult: jest.fn(),
  captureOcrPreprocessingChunkMarkdown: jest.fn(),
};

jest.mock('./preprocess', () => ({
  ...jest.requireActual('./preprocess'),
  runOcrPreprocessingBatchPipeline: (input: RunOcrPreprocessingBatchPipelineInput) =>
    mockPipeline(input),
}));
jest.mock('./chunks', () => ({
  ...jest.requireActual('./chunks'),
  getPdfPageCount: (...args: unknown[]) => mockGetPdfPageCount(...args),
  buildPdfPageChunks: (...args: unknown[]) => mockBuildPdfPageChunks(...args),
  createPdfPageRangeChunker: (...args: unknown[]) => mockCreatePdfPageRangeChunker(...args),
}));
jest.mock('./artifacts', () => ({
  ...jest.requireActual('./artifacts'),
  ensurePdfChunkArtifacts: (...args: unknown[]) => mockEnsurePdfChunkArtifacts(...args),
  createMongooseOcrPdfChunkArtifactRepository: () => mockCreateArtifactRepository(),
}));
jest.mock('~/storage/s3/crud', () => ({
  ...jest.requireActual('~/storage/s3/crud'),
  getS3DownloadURLForKey: (...args: unknown[]) => mockGetS3DownloadURLForKey(...args),
  s3ObjectExistsByKey: (...args: unknown[]) => mockS3ObjectExistsByKey(...args),
  saveBufferToS3StorageKey: jest.fn(async () => ({ bytes: 1234 })),
}));
jest.mock('../native/context', () => ({
  ...jest.requireActual('../native/context'),
  createSteelContextDependencies: () => ({ listOtherGlobalRules: () => mockListRules() }),
}));
jest.mock('../native/oauth', () => ({
  ...jest.requireActual('../native/oauth'),
  createOpenAIOAuthModel: (...args: unknown[]) => mockCreateOAuthModel(...args),
}));
jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  initializeModel: (...args: unknown[]) => mockInitializeModel(...args),
}));
jest.mock('../native/events', () => {
  const actual = jest.requireActual('../native/events');
  return {
    ...actual,
    buildSteelPaddleOcrPreflightEventEnvelopes: (...args: unknown[]) =>
      mockBuildPreflightEvents(...args),
  };
});
jest.mock('../memory/service', () => ({
  ...jest.requireActual('../memory/service'),
  createMongooseSteelWorkingOrderMemoryWriter: () => mockWriter,
}));

const paddleToolName = `paddleocr_vl${Constants.mcp_delimiter}PaddleOCR`;
const singleChunk: OcrPreprocessingPageChunk = {
  chunkIndex: 1,
  chunkCount: 1,
  pageStart: 1,
  pageEnd: 1,
  chunkSizePages: 50,
};
const openAIAgent = { id: 'agent_123', provider: EModelEndpoint.openAI };
const oauthAgent = {
  id: 'agent_123',
  provider: 'openai_oauth_responses',
  model: 'gpt-5.6-luna',
  model_parameters: { model: 'gpt-5.6-luna' },
};
const defaultRules = {
  ocrSharedRules: [
    {
      slug: 'steel-ocr-shared-policy',
      title: 'Steel OCR shared',
      prompt: ['[ocr_shared]', 'Shared OCR evidence policy', '[/ocr_shared]'].join('\n'),
    },
  ],
  ocrVisionRules: [
    {
      slug: 'steel-vision-policy',
      title: 'Vision processing rule',
      prompt: '[vision_processing]\nVision rule must reach Organizer\n[/vision_processing]',
    },
  ],
  ocrMainRules: [
    {
      slug: 'steel-main-policy',
      title: 'OCR main rule',
      prompt: '[ocr_main_merge]\nMain rule must not reach Organizer\n[/ocr_main_merge]',
    },
  ],
  ocrOrganizerRules: [
    {
      slug: 'steel-ocr-subagent-organizer-policy',
      title: 'Steel OCR organizer',
      prompt: ['[ocr_organizer]', 'OCR rules text', '[/ocr_organizer]'].join('\n'),
    },
  ],
};

interface StoredFileFixture {
  file_id: string;
  filename: string;
  filepath?: string;
  storageKey?: string;
  source?: string;
  type?: string;
  bytes?: number;
  user?: string;
  tenantId?: string;
}

let server: MongoMemoryReplSet;
let emitChunk: jest.SpyInstance;
let updateMetadata: jest.SpyInstance;
const getFiles = jest.fn();
const getDownloadStream = jest.fn();
const loadTools = jest.fn();
const disconnectAppConnection = jest.fn();
const resolveConfigServers = jest.fn();
const reinitServer = jest.fn();

/** Source codes allocated in memory, for tests that run on fake timers. */
function createMemorySourceMappings(): SteelOcrSourceMappingStore {
  const mappings: { fileId: string; sourceCode: string; sourceFilename: string }[] = [];
  return {
    readConversationOcrState: async () => null,
    allocateDelegateSourceMapping: async ({ fileId, sourceFilename }) => {
      const existing = mappings.find((mapping) => mapping.fileId === fileId);
      if (existing) return existing;
      const mapping = { fileId, sourceFilename, sourceCode: `F${mappings.length + 1}` };
      mappings.push(mapping);
      return mapping;
    },
    readSourceMappings: async () => mappings,
  };
}

let useMemorySourceMappings = false;

function createService() {
  return createSteelOcrService({
    db: { getFiles },
    client: { query: jest.fn() },
    getStrategy: () => ({ getDownloadStream }),
    server: { loadTools, disconnectAppConnection, resolveConfigServers, reinitServer },
    stateService: useMemorySourceMappings
      ? createMemorySourceMappings()
      : createSteelDelegateOcrStateService(mongoose),
  });
}

function runPreflight(
  input: Partial<RunSteelPaddleOcrPreflightInput> & { req: SteelOcrPreflightRequest },
) {
  return createService().runSteelPaddleOcrPreflight({
    res: {} as Response,
    agent: openAIAgent,
    signal: new AbortController().signal,
    ...input,
  });
}

function createRequest(
  files: SteelOcrFile[],
  conversationId = 'convo-1',
  extra: Partial<SteelOcrPreflightRequest> = {},
): SteelOcrPreflightRequest {
  return {
    user: { id: 'user_123', tenantId: 'tenant-a' },
    body: { conversationId },
    steelNativeContext: {
      requestId: 'resp-1',
      assistantTurnIndex: 4,
      memoryCheckpointTurnIndex: 3,
      currentTurnFiles: files,
    },
    ...extra,
  };
}

function storedPdf(fileId: string, filename: string, extra: Partial<StoredFileFixture> = {}) {
  return {
    file_id: fileId,
    filename,
    filepath: `https://files.example.test/uploads/user_123/${fileId}__${filename}`,
    storageKey: `uploads/user_123/${fileId}__${filename}`,
    source: 's3',
    type: 'application/pdf',
    bytes: 1234,
    user: 'user_123',
    tenantId: 'tenant-a',
    ...extra,
  };
}

function mockBatchResult(
  input: RunOcrPreprocessingBatchPipelineInput,
  markdown = '| 項次 | 品名規格 |\n| --- | --- |\n| 1 | OCR |',
  metadata: { chunkCount?: number; pageRanges?: { pageStart: number; pageEnd: number }[] } = {},
): RunOcrPreprocessingBatchPipelineResult {
  return {
    files: input.files.map((entry) => ({
      file: entry.file,
      status: 'completed',
      markdown,
      chunkCount: metadata.chunkCount ?? entry.chunks[0]?.chunkCount ?? entry.chunks.length,
      pageRanges:
        metadata.pageRanges ??
        (String(entry.file.mediaType ?? '')
          .toLowerCase()
          .startsWith('image/')
          ? []
          : entry.chunks.map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd }))),
    })),
  };
}

function artifactFor(chunk: OcrPreprocessingPageChunk, name: string): OcrPdfChunkArtifact {
  return { ...chunk, filepath: `https://files.example.test/${name}`, storageKey: `ocr/${name}` };
}

function mockPaddleOcrToolLoads(...invokes: jest.Mock[]) {
  for (const invoke of invokes) {
    loadTools.mockResolvedValueOnce({ loadedTools: [{ name: paddleToolName, invoke }] });
  }
}

/** The pipeline runs one PaddleOCR chunk for the single file, then reports the saved chunk. */
function mockSingleFilePaddleOcrPipeline(
  markdown = '| OCR |\n| --- |\n| OCR result |',
  metadata?: { chunkCount?: number; pageRanges?: { pageStart: number; pageEnd: number }[] },
) {
  mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => {
    const { file } = input.files[0];
    await input.paddleOcr.runChunk({
      file,
      chunk: singleChunk,
      artifact: artifactFor(singleChunk, file.filename ?? 'file'),
    });
    await input.onProgress?.({
      file,
      progress: { stage: 'paddleocr_chunk_saved', chunkIndex: 1, chunkCount: 1 },
    });
    return mockBatchResult(input, markdown, metadata);
  });
}

/** The pipeline runs PaddleOCR then the organizer for one file, failing the file on any error. */
function mockPaddleOcrBatchWithOrganizer(
  organizerInputs: object[],
  artifactUrl = 'https://files.example.test/ocr-input.pdf',
) {
  mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => {
    const { file } = input.files[0];
    const isImage = String(file.mediaType ?? '')
      .toLowerCase()
      .startsWith('image/');
    try {
      const raw = await input.paddleOcr.runChunk({
        file,
        chunk: singleChunk,
        artifact: {
          ...singleChunk,
          filepath: artifactUrl,
          storageKey: `ocr/${artifactUrl.split('/').pop()}`,
        },
      });
      await input.memory.capturePaddleOcrChunkResult({
        conversationId: input.conversationId,
        requestId: input.requestId,
        turnIndex: 4,
        checkpointTurnIndex: 3,
        file,
        chunk: {
          ...singleChunk,
          pipelineVersion: 1,
          sourcePdfKey: file.sourcePdfKey,
          pdfChunk: { source: 's3', storageKey: 'ocr/input', filepath: artifactUrl },
        },
        rawResultHash: raw.rawResultHash,
        data: { text: raw.rawOcrText },
      });
      const organizerInput = {
        ocrRulesText: input.ocrRulesText,
        rawOcrText: raw.rawOcrText,
        sourceFile: file.filename,
        artifactUrl: raw.artifact?.filepath ?? artifactUrl,
        mediaType: file.mediaType,
        fileKey: file.ocrFileKey,
        ...(isImage ? {} : { pageStart: 1, pageEnd: 1, chunkIndex: 1, chunkCount: 1 }),
      };
      organizerInputs.push(organizerInput);
      const organized = await input.organizer.organize(organizerInput);
      return {
        files: [
          {
            file,
            status: 'completed',
            markdown: organized.markdown,
            chunkCount: 1,
            pageRanges: isImage ? [] : [{ pageStart: 1, pageEnd: 1 }],
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failure = {
        stage: 'paddleocr' as const,
        chunkIndex: 1,
        pageStart: 1,
        pageEnd: 1,
        errorMessage,
      };
      return { files: [{ file, status: 'failed', ...failure, failures: [failure] }] };
    }
  });
}

function emittedEvents(): { event: string; data: { [key: string]: unknown } }[] {
  return emitChunk.mock.calls.map(([, event]) => event);
}

function preflightSummary(): { [key: string]: unknown } {
  return mockBuildPreflightEvents.mock.calls[mockBuildPreflightEvents.mock.calls.length - 1]?.[0]
    ?.preflight;
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
}, 60000);

beforeEach(() => {
  const actualEvents = jest.requireActual('../native/events');
  mockBuildPreflightEvents.mockImplementation(
    actualEvents.buildSteelPaddleOcrPreflightEventEnvelopes,
  );
  emitChunk = jest.spyOn(GenerationJobManager, 'emitChunk').mockResolvedValue(undefined);
  updateMetadata = jest.spyOn(GenerationJobManager, 'updateMetadata').mockResolvedValue(undefined);
  getFiles.mockResolvedValue([]);
  getDownloadStream.mockImplementation(async () => Readable.from([Buffer.from('%PDF-1.7')]));
  loadTools.mockResolvedValue({ loadedTools: [] });
  disconnectAppConnection.mockResolvedValue(undefined);
  resolveConfigServers.mockResolvedValue({});
  reinitServer.mockResolvedValue(undefined);
  mockWriter.readOcrPreprocessingState.mockImplementation(
    async (input: { ocrFileKey: string; sourcePdfKey: string; ocrRuleVersion: string }) => ({
      ...input,
      pipelineVersion: 1,
      chunkSizePages: 50,
      chunkCount: 0,
      chunks: [],
    }),
  );
  mockWriter.capturePaddleOcrChunkResult.mockResolvedValue({
    savedCounts: { paddleocr_preflight: 1 },
  });
  mockWriter.captureOcrPreprocessingChunkMarkdown.mockResolvedValue({
    savedCounts: { ocr_extract: 1 },
  });
  mockPipeline.mockImplementation(async (input: RunOcrPreprocessingBatchPipelineInput) =>
    mockBatchResult(input),
  );
  mockBuildPdfPageChunks.mockReturnValue([singleChunk]);
  mockGetPdfPageCount.mockResolvedValue(1);
  mockCreatePdfPageRangeChunker.mockResolvedValue(async () => new Uint8Array([37, 80, 68, 70]));
  mockEnsurePdfChunkArtifacts.mockResolvedValue([]);
  mockCreateArtifactRepository.mockReturnValue({
    findBySourcePdfKey: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
    compareAndSetArtifactFilepath: jest.fn(async ({ filepath }: { filepath: string }) => filepath),
  });
  mockGetS3DownloadURLForKey.mockResolvedValue('https://files.example.test/original.pdf');
  mockS3ObjectExistsByKey.mockResolvedValue({ exists: false });
  mockListRules.mockResolvedValue(defaultRules);
  mockCreateOAuthModel.mockReturnValue({
    invoke: jest.fn().mockResolvedValue({ content: 'organized OCR Markdown' }),
  });
  mockInitializeModel.mockReturnValue({
    invoke: jest.fn().mockResolvedValue({ content: '| OCR |\n| --- |\n| organized |' }),
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

describe('runSteelPaddleOcrPreflight orchestration', () => {
  it('routes every current OCR-capable file through one preprocessing batch with stable source codes', async () => {
    const signal = new AbortController().signal;
    const req = createRequest([
      { fileId: 'file-a', filename: 'a.pdf', mediaType: 'application/pdf' },
      { fileId: 'file-b', filename: 'b.png', mediaType: 'image/png' },
      { fileId: 'file-c', filename: 'c.pdf', mediaType: 'application/pdf' },
    ]);
    mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => {
      await input.onProgress?.({
        file: input.files[0].file,
        progress: { stage: 'paddleocr_chunk_loaded', chunkIndex: 1, chunkCount: 1 },
      });
      return mockBatchResult(input);
    });

    const result = await runPreflight({ req, signal, streamId: 'stream-1' });

    expect(loadTools).not.toHaveBeenCalled();
    expect(preflightSummary()).toEqual(
      expect.objectContaining({ status: 'completed', paddleOcrSavedCount: 0 }),
    );
    const pipelineInput = mockPipeline.mock.calls[0][0] as RunOcrPreprocessingBatchPipelineInput;
    expect(mockPipeline).toHaveBeenCalledTimes(1);
    expect(pipelineInput.signal).toBe(signal);
    expect(req.steelNativeContext?.steelHistory?.activityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'parse_status', parseStatus: 'partial' }),
      ]),
    );
    expect(pipelineInput.files.map(({ file }) => file.ocrFileKey)).toEqual([
      'file:file-a',
      'file:file-b',
      'file:file-c',
    ]);
    expect(
      pipelineInput.files.map(({ file }) => (file as { sourceCode?: string }).sourceCode),
    ).toEqual(['F1', 'F2', 'F3']);
    expect(result).toEqual({
      status: 'completed',
      ocrTurnActive: true,
      completedKeys: ['file:file-a', 'file:file-b', 'file:file-c'],
      attemptedKeys: ['file:file-a', 'file:file-b', 'file:file-c'],
      failedKeys: [],
      currentPaddleOcrResults: [],
      currentOcrMarkdownResults: ['a', 'b', 'c'].map((suffix, index) =>
        expect.objectContaining({
          ocrFileKey: `file:file-${suffix}`,
          sourceCode: `F${index + 1}`,
          kind: 'ocr_preprocessing_merged_markdown',
          ocrSource: 'ocr_preprocessing_merge',
          content: expect.stringContaining(`<file:file-${suffix}>`),
        }),
      ),
    });
  });

  it('keeps request-scoped source codes stable across failures and partial results', async () => {
    const req = createRequest(
      ['a', 'b', 'c'].map((suffix) => ({
        fileId: `file-${suffix}`,
        filename: `${suffix}.png`,
        mediaType: 'image/png',
      })),
      'convo-source-codes',
    );
    getFiles.mockResolvedValueOnce(
      ['a', 'b', 'c'].map((suffix) => ({
        file_id: `file-${suffix}`,
        filename: `persisted-${suffix}.png`,
      })),
    );
    mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => {
      const [first, second, third] = input.files;
      await input.memory.capturePaddleOcrChunkResult({
        conversationId: input.conversationId,
        requestId: input.requestId,
        turnIndex: 4,
        checkpointTurnIndex: 3,
        file: first.file,
        chunk: {
          ...singleChunk,
          pipelineVersion: 1,
          sourcePdfKey: first.file.sourcePdfKey,
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
            stage: 'paddleocr',
            errorMessage: 'first file failed',
            failures: [{ stage: 'paddleocr', errorMessage: 'first file failed' }],
          },
          {
            file: second.file,
            status: 'failed',
            stage: 'organizer',
            errorMessage: 'second file partial',
            failures: [{ stage: 'organizer', errorMessage: 'second file partial' }],
            partial: { markdown: '| OCR |\n| --- |\n| partial |', chunkCount: 1, pageRanges: [] },
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

    const result = await runPreflight({ req });

    const pipelineInput = mockPipeline.mock.calls[0][0] as RunOcrPreprocessingBatchPipelineInput;
    expect(
      pipelineInput.files.map(({ file }) => (file as { sourceCode?: string }).sourceCode),
    ).toEqual(['F1', 'F2', 'F3']);
    expect(mockWriter.capturePaddleOcrChunkResult).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.not.objectContaining({ sourceCode: 'F1' }) }),
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

  it('maps sources by the owner-scoped persisted filename while keeping the request filename visible', async () => {
    const req = createRequest(
      [{ fileId: 'file-db-name', filename: 'request-name.pdf', mediaType: 'application/pdf' }],
      'convo-source-filename',
    );
    getFiles.mockResolvedValueOnce([storedPdf('file-db-name', 'persisted-name.pdf')]);

    const result = await runPreflight({ req });

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

  it('fails a file closed when the loaded organizer rules are malformed', async () => {
    const req = createRequest([
      {
        fileId: 'image-malformed-rules',
        filename: 'malformed-rules.png',
        mediaType: 'image/png',
        storageKey: 'uploads/user/image-malformed-rules.png',
      },
    ]);
    mockListRules.mockResolvedValueOnce({
      ocrSharedRules: [],
      ocrVisionRules: [],
      ocrMainRules: [],
      ocrOrganizerRules: [
        {
          slug: 'malformed',
          title: 'Malformed organizer rule',
          prompt: 'Organizer instructions without required markers',
        },
      ],
    });

    const result = await runPreflight({ req });

    expect(mockPipeline).not.toHaveBeenCalled();
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
    const req = createRequest([
      {
        fileId: 'image-unavailable-rules',
        filename: 'unavailable-rules.png',
        mediaType: 'image/png',
        storageKey: 'uploads/user/image-unavailable-rules.png',
      },
    ]);
    mockListRules.mockRejectedValueOnce(new Error('rule database unavailable'));

    await runPreflight({ req });

    expect(mockPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ ocrRulesText: '', ocrRuleVersion: 'ocr-rules:unavailable' }),
    );
  });

  it('splits a stored PDF into page chunks with the organizer rules only', async () => {
    const req = createRequest([
      { fileId: 'pdf-1', filename: 'quote.pdf', mediaType: 'application/pdf' },
    ]);
    getFiles.mockResolvedValueOnce([storedPdf('pdf-1', 'quote.pdf')]);
    mockGetPdfPageCount.mockResolvedValueOnce(75);
    const pageChunks = [
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 50, chunkSizePages: 50 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 51, pageEnd: 75, chunkSizePages: 50 },
    ];
    mockBuildPdfPageChunks.mockReturnValueOnce(pageChunks);
    mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) =>
      mockBatchResult(input, '| 項次 | 品名規格 |\n| --- | --- |\n| 1 | PL-100 |'),
    );

    const result = await runPreflight({ req });

    expect(getFiles).toHaveBeenCalledWith(
      { file_id: { $in: ['pdf-1'] }, user: 'user_123', tenantId: 'tenant-a' },
      {},
      {},
    );
    expect(mockGetPdfPageCount).toHaveBeenCalledWith({ pdfBytes: expect.any(Buffer) });
    expect(mockBuildPdfPageChunks).toHaveBeenCalledWith({ pageCount: 75, chunkSizePages: 50 });
    const pipelineInput = mockPipeline.mock.calls[0][0] as RunOcrPreprocessingBatchPipelineInput;
    expect(pipelineInput.files).toEqual([
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
    ]);
    expect(pipelineInput.ocrRuleVersion).toMatch(/^ocr-rules:/u);
    expect(pipelineInput.ocrRulesText).toContain('OCR rules text');
    expect(pipelineInput.ocrRulesText).toContain('[ocr_organizer]');
    expect(pipelineInput.ocrRulesText).toContain('[ocr_shared]');
    expect(pipelineInput.ocrRulesText).toContain('Vision rule must reach Organizer');
    expect(pipelineInput.ocrRulesText).not.toContain('Main rule must not reach Organizer');
    expect(pipelineInput.ocrRulesText).not.toContain('steel-ocr-shared-policy');
    expect(loadTools).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'completed',
      ocrTurnActive: true,
      completedKeys: ['file:pdf-1'],
      attemptedKeys: ['file:pdf-1'],
      failedKeys: [],
      currentOcrSourceFileMapping: [{ sourceCode: 'F1', sourceFilename: 'quote.pdf' }],
      currentPaddleOcrResults: [],
      currentOcrMarkdownResults: [
        expect.objectContaining({
          ocrFileKey: 'file:pdf-1',
          fileId: 'pdf-1',
          filename: 'quote.pdf',
          storageKey: 'uploads/user_123/pdf-1__quote.pdf',
          kind: 'ocr_preprocessing_merged_markdown',
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
    const req = createRequest([
      { fileId: 'pdf-malformed-ranges', filename: 'malformed-ranges.jpg', mediaType: 'image/jpeg' },
    ]);
    mockSingleFilePaddleOcrPipeline('| OCR |\n| --- |\n| malformed |', {
      chunkCount: 2,
      pageRanges: [
        { pageStart: 1, pageEnd: 10 },
        { pageStart: 12, pageEnd: 20 },
      ],
    });
    mockPaddleOcrToolLoads(jest.fn().mockResolvedValue({ text: 'OCR' }));

    const result = await runPreflight({ req });

    expect(result.currentOcrMarkdownResults?.[0]?.ocrPreprocessing).toEqual(
      expect.objectContaining({ chunkCount: 2, pageRanges: [] }),
    );
  });

  it('returns PDF preparation failures to the OCR/Vision fallback turn', async () => {
    const req = createRequest([
      { fileId: 'pdf-prepare', filename: 'prepare.pdf', mediaType: 'application/pdf' },
    ]);
    getFiles.mockResolvedValueOnce([storedPdf('pdf-prepare', 'prepare.pdf')]);
    mockGetPdfPageCount.mockRejectedValueOnce(new Error('invalid PDF'));

    const result = await runPreflight({ req, streamId: 'stream-1' });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'partial',
        ocrTurnActive: true,
        attemptedKeys: ['file:pdf-prepare'],
        failedKeys: ['file:pdf-prepare'],
      }),
    );
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  it('returns a failed batch to the OCR/Vision fallback turn with its error', async () => {
    const req = createRequest([
      { fileId: 'pdf-1', filename: 'quote.pdf', mediaType: 'application/pdf' },
    ]);
    getFiles.mockResolvedValueOnce([storedPdf('pdf-1', 'quote.pdf')]);
    mockPipeline.mockRejectedValueOnce(new Error('organizer timeout'));

    const result = await runPreflight({ req, streamId: 'stream-1' });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'partial',
        ocrTurnActive: true,
        attemptedKeys: ['file:pdf-1'],
        failedKeys: ['file:pdf-1'],
      }),
    );
    expect(result).not.toHaveProperty('currentOcrMarkdownResults');
    expect(emittedEvents()).toEqual(
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

  it('keeps completed organizer Markdown when another file fails and reports its missing ranges', async () => {
    const req = createRequest([
      { fileId: 'pdf-a', filename: 'a.pdf', mediaType: 'application/pdf' },
      { fileId: 'pdf-b', filename: 'b.pdf', mediaType: 'application/pdf' },
    ]);
    getFiles.mockResolvedValueOnce([storedPdf('pdf-a', 'a.pdf'), storedPdf('pdf-b', 'b.pdf')]);
    mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => ({
      files: [
        {
          file: input.files[0].file,
          status: 'completed',
          chunkCount: 1,
          pageRanges: [],
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

    const result = await runPreflight({ req, streamId: 'stream-1' });

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
            fileUrl: 'https://files.example.test/uploads/user_123/pdf-b__b.pdf',
          }),
          expect.objectContaining({ ocrFileKey: 'file:pdf-b', pageStart: 101, pageEnd: 120 }),
        ],
      }),
    );
    expect(emittedEvents()).toEqual(
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
    const req = createRequest([
      { fileId: 'pdf-1', filename: 'quote.pdf', mediaType: 'application/pdf' },
    ]);
    getFiles.mockResolvedValueOnce([storedPdf('pdf-1', 'quote.pdf')]);
    mockCreateOAuthModel.mockReturnValueOnce({
      invoke: jest.fn().mockRejectedValueOnce(new Error('terminated')),
    });
    mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => {
      await input.organizer.organize({
        ocrRulesText: input.ocrRulesText,
        rawOcrText: 'raw chunk OCR text',
        sourceFile: 'quote.pdf',
        artifactUrl: 'https://files.example.test/quote-pages-51-100.pdf',
        mediaType: 'application/pdf',
        fileKey: 'file:pdf-1',
        pageStart: 51,
        pageEnd: 100,
        chunkIndex: 2,
        chunkCount: 3,
      });
      return mockBatchResult(input);
    });

    const result = await runPreflight({ req, agent: oauthAgent, streamId: 'stream-1' });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'partial',
        ocrTurnActive: true,
        failedKeys: ['file:pdf-1'],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('raw chunk OCR text');
  });

  it('inlines the exact PDF chunk for a frontend-selected OpenAI organizer model', async () => {
    const req = createRequest([
      { fileId: 'file-openai-pdf', filename: 'openai.pdf', mediaType: 'application/pdf' },
    ]);
    const organizerInvoke = jest
      .fn()
      .mockResolvedValue({ content: '| OCR |\n| --- |\n| organized OpenAI PDF |' });
    mockPaddleOcrToolLoads(jest.fn().mockResolvedValue({ content: 'OpenAI PDF OCR text' }));
    mockPaddleOcrBatchWithOrganizer([], 'https://files.example.test/quote-pages-51-100.pdf');
    mockInitializeModel.mockReturnValueOnce({ invoke: organizerInvoke });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(Buffer.from('%PDF-1.7 exact chunk'), { status: 200 }));

    const result = await runPreflight({
      req,
      agent: {
        id: 'agent_123',
        provider: EModelEndpoint.openAI,
        model: 'gpt-5.4',
        model_parameters: { model: 'gpt-5.4', max_tokens: 32000, reasoning_effort: 'high' },
      },
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
  });

  it.each([
    ['persisted three-chunk plan', 3],
    ['persisted two-chunk plan', 2],
  ])('reuses a complete organized %s before downloading the PDF', async (_label, count) => {
    const req = createRequest([
      { fileId: 'file-a', filename: 'a.pdf', mediaType: 'application/pdf' },
    ]);
    getFiles.mockResolvedValueOnce([storedPdf('file-a', 'a.pdf')]);
    const savedChunks = Array.from({ length: count }, (_, index) => ({
      chunkIndex: index + 1,
      chunkCount: count,
      pageStart: index * 50 + 1,
      pageEnd: (index + 1) * 50,
      chunkSizePages: 50,
      rawSaved: true,
      organizedSaved: true,
      organizedMarkdown: `| OCR |\n| --- |\n| Chunk ${index + 1} |`,
    }));
    mockWriter.readOcrPreprocessingState.mockResolvedValueOnce({
      ocrFileKey: 'file:file-a',
      sourcePdfKey: 'uploads/user_123/file-a__a.pdf',
      pipelineVersion: 1,
      ocrRuleVersion: 'ocr-rules:test',
      chunkSizePages: 50,
      chunkCount: count,
      chunks: savedChunks,
    });
    const res = { writableEnded: false, write: jest.fn() } as unknown as Response & {
      write: jest.Mock;
    };

    const result = await runPreflight({ req, res });

    expect(getDownloadStream).not.toHaveBeenCalled();
    expect(mockGetPdfPageCount).not.toHaveBeenCalled();
    expect(mockBuildPdfPageChunks).not.toHaveBeenCalled();
    expect(loadTools).not.toHaveBeenCalled();
    expect(mockCreateOAuthModel).not.toHaveBeenCalled();
    expect(preflightSummary()).toEqual(
      expect.objectContaining({ attemptedKeys: ['file:file-a'], paddleOcrSavedCount: 0 }),
    );
    expect(res.write).toHaveBeenCalled();
    const pipelineInput = mockPipeline.mock.calls[0][0] as RunOcrPreprocessingBatchPipelineInput;
    expect(pipelineInput.files[0].chunks).toEqual(
      savedChunks.map(({ chunkIndex, chunkCount, pageStart, pageEnd }) =>
        expect.objectContaining({ chunkIndex, chunkCount, pageStart, pageEnd, chunkSizePages: 50 }),
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'completed',
        completedKeys: ['file:file-a'],
        currentOcrSourceFileMapping: [{ sourceCode: 'F1', sourceFilename: 'a.pdf' }],
        currentPaddleOcrResults: [],
        currentOcrMarkdownResults: [
          expect.objectContaining({
            ocrFileKey: 'file:file-a',
            ocrPreprocessing: expect.objectContaining({ chunkCount: count }),
          }),
        ],
      }),
    );
  });

  it('does not save a failed batch as completed OCR and keeps the fallback turn active', async () => {
    const req = createRequest([
      { fileId: 'file-fallback', filename: 'fallback.pdf', mediaType: 'application/pdf' },
    ]);
    mockPipeline.mockRejectedValueOnce(new Error('provider timeout'));

    const result = await runPreflight({ req, streamId: 'stream-1' });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'partial',
        ocrTurnActive: true,
        attemptedKeys: ['file:file-fallback'],
        failedKeys: ['file:file-fallback'],
      }),
    );
    expect(preflightSummary()).toEqual(
      expect.objectContaining({ status: 'partial', paddleOcrSavedCount: 0 }),
    );
    expect(emittedEvents()).toEqual(
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

  it('keeps raw PaddleOCR output out of same-turn runtime attachments', async () => {
    const req = createRequest([
      { fileId: 'file-large', filename: 'large.pdf', mediaType: 'application/pdf' },
    ]);
    mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) =>
      mockBatchResult(input, '| OCR |\n| --- |\n| organized markdown |'),
    );

    const result = await runPreflight({ req });

    expect(result.currentPaddleOcrResults).toEqual([]);
    expect(result.currentOcrMarkdownResults?.[0]).toEqual(
      expect.objectContaining({
        ocrFileKey: 'file:file-large',
        content: expect.stringContaining('organized markdown'),
      }),
    );
  });

  it('rethrows an aborted batch instead of saving partial failure state', async () => {
    const req = createRequest([
      { fileId: 'file-abort', filename: 'abort.pdf', mediaType: 'application/pdf' },
    ]);
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockPipeline.mockRejectedValueOnce(abortError);

    await expect(runPreflight({ req })).rejects.toBe(abortError);
    expect(mockBuildPreflightEvents).not.toHaveBeenCalled();
  });

  it('skips turns without a conversation, turn index, or OCR-capable files', async () => {
    const service = createService();
    const base = createRequest([
      { fileId: 'notes', filename: 'notes.txt', mediaType: 'text/plain' },
    ]);
    await expect(
      service.runSteelPaddleOcrPreflight({ req: { ...base, body: {} } }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'skipped', skippedReason: 'missing_conversation_id' }),
    );
    await expect(
      service.runSteelPaddleOcrPreflight({
        req: {
          ...base,
          steelNativeContext: { ...base.steelNativeContext, assistantTurnIndex: undefined },
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ skippedReason: 'missing_turn_index' }));
    await expect(service.runSteelPaddleOcrPreflight({ req: base })).resolves.toEqual(
      expect.objectContaining({
        status: 'skipped',
        skippedReason: 'no_ocr_capable_files',
        ocrTurnActive: false,
      }),
    );
    expect(mockPipeline).not.toHaveBeenCalled();
  });
});

describe('runSteelPaddleOcrPreflight PaddleOCR calls', () => {
  beforeAll(() => {
    useMemorySourceMappings = true;
  });
  afterAll(() => {
    useMemorySourceMappings = false;
  });
  const imageRequest = (fileId: string, filename: string) =>
    createRequest([
      { fileId, filename, mediaType: filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' },
    ]);

  it('streams a compact URL-free tool card while handing the raw result to DB capture', async () => {
    const req = createRequest(
      [{ fileId: 'pdf-1', filename: 'quote.pdf', mediaType: 'application/pdf' }],
      'convo-1',
      {
        _resumableJobCreatedAt: 1000,
      },
    );
    getFiles.mockResolvedValueOnce([storedPdf('pdf-1', 'quote.pdf')]);
    const pageChunk = {
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 50,
      chunkSizePages: 50,
    };
    mockBuildPdfPageChunks.mockReturnValueOnce([pageChunk]);
    const rawContent = `raw OCR provider payload ${'R'.repeat(2048)}`;
    const paddleInvoke = jest.fn().mockResolvedValueOnce({ type: 'tool', content: rawContent });
    loadTools.mockResolvedValueOnce({
      loadedTools: [{ name: paddleToolName, invoke: paddleInvoke }],
      configurable: { mcpConfig: true },
    });
    let rawResultForCapture: unknown;
    mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => {
      const raw = await input.paddleOcr.runChunk({
        file: input.files[0].file,
        chunk: pageChunk,
        artifact: {
          ...pageChunk,
          filepath: 'https://files.example.test/chunk-1.pdf',
          storageKey: 'ocr/chunk-1.pdf',
          source: 's3',
        },
      });
      rawResultForCapture = raw.rawResult;
      return mockBatchResult(input, '| item |\n| --- |\n| ok |');
    });

    const result = await runPreflight({ req, streamId: 'stream-1' });

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
      expect.objectContaining({
        configurable: expect.objectContaining({ mcpConfig: true, user_id: 'user_123' }),
        metadata: { provider: EModelEndpoint.openAI, thread_id: 'convo-1', run_id: 'resp-1' },
      }),
    );
    expect(rawResultForCapture).toEqual({ type: 'tool', content: rawContent });
    const completed = emittedEvents().find(
      (event) => event.event === StepEvents.ON_RUN_STEP_COMPLETED,
    );
    const output = (completed?.data as { result: { tool_call: { output: string } } }).result
      .tool_call.output;
    expect(output).not.toContain(rawContent);
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        status: 'completed',
        paddleocr: 'ok',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:pdf-1',
        filename: 'quote.pdf',
        pageStart: 1,
        pageEnd: 50,
        rawTextLength: rawContent.length,
        outputStorage: 'steel_working_order_memory:paddleocr_preflight',
      }),
    );
    expect(result.currentPaddleOcrStatuses).toEqual([
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
    const history = req.steelNativeContext?.steelHistory?.preflightToolCalls ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(
      expect.objectContaining({
        type: 'tool_call',
        id: expect.stringContaining('steel_paddleocr_preflight_'),
        name: paddleToolName,
        progress: 1,
      }),
    );
    expect(JSON.parse(history[0].output ?? '{}')).toEqual({
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
    expect(updateMetadata).toHaveBeenCalledWith(
      'stream-1',
      { steelHistory: expect.objectContaining({ preflightToolCalls: expect.any(Array) }) },
      1000,
    );
    for (const [, , options] of emitChunk.mock.calls) {
      expect(options).toEqual({ expectedCreatedAt: 1000 });
    }
  });

  it.each([
    [
      'a sequential provider connection reset',
      'ClientConnectorError: Cannot connect to host paddleocr.aistudio-app.com:443 ssl:default [Connection reset by peer]',
    ],
    ['a connection establishment timeout', 'Connection timeout after 30000ms'],
  ])('rebuilds the MCP connection and retries after %s', async (_label, message) => {
    const req = imageRequest('file-second', 'second.jpg');
    const firstInvoke = jest.fn().mockRejectedValueOnce(new Error(message));
    const secondInvoke = jest.fn().mockResolvedValueOnce({ text: 'Second OCR' });
    mockSingleFilePaddleOcrPipeline('| OCR |\n| --- |\n| Second OCR |');
    mockPaddleOcrToolLoads(firstInvoke, secondInvoke);
    jest.useFakeTimers();
    try {
      const resultPromise = runPreflight({ req, streamId: 'stream-1' });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(disconnectAppConnection).toHaveBeenCalledWith({
        userId: 'user_123',
        serverName: 'PaddleOCR',
      });
      expect(reinitServer).toHaveBeenCalledWith(
        expect.objectContaining({
          user: req.user,
          serverName: 'PaddleOCR',
          forceNew: true,
          returnOnOAuth: false,
        }),
      );
      expect(loadTools).toHaveBeenCalledTimes(2);
      expect(firstInvoke).toHaveBeenCalledTimes(1);
      expect(secondInvoke).toHaveBeenCalledTimes(1);
      expect(preflightSummary()).toEqual(
        expect.objectContaining({ status: 'completed', paddleOcrSavedCount: 1 }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'completed',
          completedKeys: ['file:file-second'],
          failedKeys: [],
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
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['error content', { status: 'success', content: "Error calling tool 'paddleocr_vl'" }],
    ['an explicit signed URL expiry', { status: 'error', error: 'RequestExpired' }],
  ])('retries %s without rebuilding MCP and re-signs the input URL', async (_label, failure) => {
    const req = imageRequest('file-error-content', 'error-content.jpg');
    const invoke = jest
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce({ status: 'success', content: 'Recovered OCR text' });
    const organizerInputs: object[] = [];
    mockGetS3DownloadURLForKey.mockResolvedValueOnce(
      'https://files.example.test/refreshed-error-content.jpg',
    );
    mockPaddleOcrToolLoads(invoke);
    mockPaddleOcrBatchWithOrganizer(organizerInputs);
    jest.useFakeTimers();
    try {
      const resultPromise = runPreflight({ req, agent: oauthAgent, streamId: 'stream-1' });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke.mock.calls[0][0].input_data).toBe('https://files.example.test/ocr-input.pdf');
      expect(invoke.mock.calls[1][0].input_data).toBe(
        'https://files.example.test/refreshed-error-content.jpg',
      );
      expect(disconnectAppConnection).not.toHaveBeenCalled();
      expect(reinitServer).not.toHaveBeenCalled();
      expect(loadTools).toHaveBeenCalledTimes(1);
      expect(mockWriter.capturePaddleOcrChunkResult).toHaveBeenCalledTimes(1);
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
      expect(organizerInputs[0]).not.toHaveProperty('sourceCode');
      expect(result).toEqual(
        expect.objectContaining({
          status: 'completed',
          completedKeys: ['file:file-error-content'],
          currentOcrMarkdownResults: [
            expect.objectContaining({ content: expect.stringContaining('organized OCR Markdown') }),
          ],
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps persistent error content recoverable without saving or organizing raw OCR', async () => {
    const req = imageRequest('file-error-content-failure', 'error-content-failure.jpg');
    const invoke = jest
      .fn()
      .mockResolvedValue({ status: 'success', content: "Error calling tool 'paddleocr_vl'" });
    const organizerInputs: object[] = [];
    mockPaddleOcrToolLoads(invoke);
    mockPaddleOcrBatchWithOrganizer(organizerInputs);
    jest.useFakeTimers();
    try {
      const resultPromise = runPreflight({ req, streamId: 'stream-1' });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(invoke).toHaveBeenCalledTimes(3);
      expect(reinitServer).not.toHaveBeenCalled();
      expect(mockWriter.capturePaddleOcrChunkResult).not.toHaveBeenCalled();
      expect(organizerInputs).toEqual([]);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
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
      expect(emittedEvents()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              source: 'ocr_preprocessing',
              errorMessage: expect.stringContaining("Error calling tool 'paddleocr_vl'"),
            }),
          }),
        ]),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses two fixed retry waits and reports only a typed diagnostic code', async () => {
    jest.useFakeTimers();
    try {
      const req = imageRequest('file-diagnostic', 'diagnostic.jpg');
      const invokeError = new Error('PaddleOCR tool failed');
      Object.defineProperty(invokeError, 'diagnosticCode', {
        value: 'ai_studio_timeout',
        enumerable: false,
      });
      const invoke = jest.fn().mockRejectedValue(invokeError);
      mockSingleFilePaddleOcrPipeline();
      mockPaddleOcrToolLoads(invoke);

      const resultPromise = runPreflight({ req, streamId: 'stream-1' });
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
      expect(mockWriter.capturePaddleOcrChunkResult).not.toHaveBeenCalled();
      const failedCard = emittedEvents().find(
        (event) => event.event === StepEvents.ON_RUN_STEP_COMPLETED,
      );
      expect(
        JSON.parse(
          (failedCard?.data as { result: { tool_call: { output: string } } }).result.tool_call
            .output,
        ),
      ).toEqual(expect.objectContaining({ attemptsUsed: 3, diagnosticCode: 'ai_studio_timeout' }));
      expect(result.currentOcrFailures).toEqual([
        expect.objectContaining({ diagnosticCode: 'ai_studio_timeout', stage: 'preflight' }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('task pacing', () => {
    function setupSequentialPreflight() {
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
      const req = createRequest([pdf, image], 'convo-interval');
      getFiles.mockResolvedValueOnce([storedPdf(pdf.fileId, pdf.filename)]);
      mockGetPdfPageCount.mockResolvedValueOnce(2);
      mockBuildPdfPageChunks.mockReturnValueOnce([
        { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 1, chunkSizePages: 50 },
        { chunkIndex: 2, chunkCount: 2, pageStart: 2, pageEnd: 2, chunkSizePages: 50 },
      ]);
      const invokeTimes: number[] = [];
      const invoke = jest.fn().mockImplementation(async () => {
        invokeTimes.push(performance.now());
        return { content: 'OCR' };
      });
      mockPaddleOcrToolLoads(invoke);
      mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => {
        const [pdfInput, imageInput] = input.files;
        const run = (file: OcrPreprocessingFile, chunk: OcrPreprocessingPageChunk, name: string) =>
          input.paddleOcr.runChunk({ file, chunk, artifact: artifactFor(chunk, name) });
        await run(pdfInput.file, pdfInput.chunks[0], 'interval-chunk-1.pdf');
        await run(pdfInput.file, pdfInput.chunks[1], 'interval-chunk-2.pdf');
        await run(imageInput.file, imageInput.chunks[0], 'interval-image.jpg');
        return mockBatchResult(input);
      });
      return { req, invoke, invokeTimes };
    }

    it('waits one second between completed tasks while keeping the first call immediate', async () => {
      jest.useFakeTimers();
      try {
        const { req, invoke, invokeTimes } = setupSequentialPreflight();
        const resultPromise = runPreflight({ req, streamId: 'stream-interval' });

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
        expect(invokeTimes[1] - invokeTimes[0]).toBeGreaterThanOrEqual(1000);
        expect(invokeTimes[2] - invokeTimes[1]).toBeGreaterThanOrEqual(1000);
        expect(result.status).toBe('completed');
      } finally {
        jest.useRealTimers();
      }
    });

    it('aborts immediately while waiting between tasks without starting the next invoke', async () => {
      jest.useFakeTimers();
      try {
        const { req, invoke } = setupSequentialPreflight();
        const controller = new AbortController();
        const resultPromise = runPreflight({
          req,
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
  });

  it('gives every PaddleOCR call an independent ten-minute hard deadline', async () => {
    jest.useFakeTimers();
    const timeoutControllers = [new AbortController(), new AbortController()];
    const timeoutSignals = timeoutControllers.map((controller) => controller.signal);
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => timeoutSignals.shift() as AbortSignal);
    const userController = new AbortController();
    try {
      const req = imageRequest('file-hard-timeout', 'hard-timeout.jpg');
      const invokeSignals: AbortSignal[] = [];
      const invoke = jest.fn((_args: unknown, config: { signal: AbortSignal }) => {
        invokeSignals.push(config.signal);
        return new Promise((_, reject) => {
          const rejectAbort = () => reject(new Error('late provider failure after parent abort'));
          if (config.signal.aborted) {
            rejectAbort();
            return;
          }
          config.signal.addEventListener('abort', rejectAbort, { once: true });
        });
      });
      mockSingleFilePaddleOcrPipeline();
      mockPaddleOcrToolLoads(invoke);

      const resultPromise = runPreflight({
        req,
        signal: userController.signal,
        streamId: 'stream-1',
      });
      await jest.advanceTimersByTimeAsync(0);

      expect(timeoutSpy).toHaveBeenNthCalledWith(1, 600_000);
      timeoutControllers[0].abort();
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
      jest.useRealTimers();
    }
  });

  it('reports only final child statuses after adaptive chunk recovery', async () => {
    jest.useFakeTimers();
    try {
      const req = imageRequest('file-adaptive-status', 'adaptive-status.pdf');
      const invoke = jest
        .fn()
        .mockRejectedValueOnce(new Error('HTTP 408: parent timeout 1'))
        .mockRejectedValueOnce(new Error('HTTP 408: parent timeout 2'))
        .mockRejectedValueOnce(new Error('HTTP 408: parent timeout 3'))
        .mockResolvedValueOnce({ content: 'child one' })
        .mockResolvedValueOnce({ content: 'child two' });
      mockPaddleOcrToolLoads(invoke);
      mockPipeline.mockImplementationOnce(async (input: RunOcrPreprocessingBatchPipelineInput) => {
        const { file } = input.files[0];
        const runChunk = (chunk: OcrPreprocessingPageChunk) =>
          input.paddleOcr.runChunk({
            file,
            chunk,
            artifact: artifactFor(chunk, `${chunk.pageStart}-${chunk.pageEnd}.pdf`),
          });
        await expect(
          runChunk({ chunkIndex: 1, chunkCount: 1, pageStart: 1, pageEnd: 50, chunkSizePages: 50 }),
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
              file,
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

      const resultPromise = runPreflight({ req, streamId: 'stream-1' });
      await jest.advanceTimersByTimeAsync(6000);
      expect(invoke).toHaveBeenCalledTimes(3);
      await jest.advanceTimersByTimeAsync(1000);
      expect(invoke).toHaveBeenCalledTimes(4);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(invoke).toHaveBeenCalledTimes(5);
      expect(result.currentPaddleOcrStatuses).toEqual([
        expect.objectContaining({ paddleocr: 'ok', pageStart: 1, pageEnd: 25 }),
        expect.objectContaining({ paddleocr: 'ok', pageStart: 26, pageEnd: 50 }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not rebuild or retry a non-transient provider error and records its typed failure', async () => {
    const req = imageRequest('file-invalid', 'invalid.jpg');
    const providerError = new Error('invalid PaddleOCR authentication configuration; timeout');
    Object.defineProperty(providerError, 'diagnosticCode', {
      value: 'ai_studio_auth',
      enumerable: false,
    });
    const invoke = jest.fn().mockRejectedValueOnce(providerError);
    mockPaddleOcrBatchWithOrganizer([]);
    mockPaddleOcrToolLoads(invoke);

    const result = await runPreflight({ req, streamId: 'stream-1' });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(loadTools).toHaveBeenCalledTimes(1);
    expect(reinitServer).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'partial',
        failedKeys: ['file:file-invalid'],
        currentOcrFailures: [expect.objectContaining({ errorMessage: providerError.message })],
        currentPaddleOcrStatuses: [
          {
            paddleocr: 'fail',
            ocrFileKey: 'file:file-invalid',
            filename: 'invalid.jpg',
            mediaType: 'image/jpeg',
            chunkIndex: 1,
            chunkCount: 1,
          },
        ],
      }),
    );
    const failedCard = emittedEvents().find(
      (event) => event.event === StepEvents.ON_RUN_STEP_COMPLETED,
    );
    const output = (failedCard?.data as { result: { tool_call: { output: string } } }).result
      .tool_call.output;
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        status: 'failed',
        paddleocr: 'fail',
        ocrFileKey: 'file:file-invalid',
        attemptsUsed: 1,
        diagnosticCode: 'ai_studio_auth',
        errorMessage: providerError.message,
      }),
    );
    expect(
      JSON.parse(req.steelNativeContext?.steelHistory?.preflightToolCalls[0]?.output ?? '{}'),
    ).toEqual({
      status: 'fail',
      paddleocr: 'fail',
      ocrEngine: 'paddleocr_vl',
      ocrFileKey: 'file:file-invalid',
      filename: 'invalid.jpg',
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 1,
      dataSizeBytes: Buffer.byteLength(output, 'utf8'),
      attemptsUsed: 1,
      errorCode: 'ai_studio_auth',
      error: providerError.message,
      errorMessage: providerError.message,
    });
  });

  it('keeps the provider error primary when rebuilding PaddleOCR fails', async () => {
    const req = imageRequest('file-rebuild', 'rebuild.jpg');
    const providerError = new Error('Connection reset by peer');
    const rebuildError = new Error('PaddleOCR MCP reinitialization failed');
    mockPaddleOcrBatchWithOrganizer([]);
    mockPaddleOcrToolLoads(jest.fn().mockRejectedValueOnce(providerError));
    loadTools.mockRejectedValueOnce(rebuildError);
    jest.useFakeTimers();
    try {
      const resultPromise = runPreflight({ req, streamId: 'stream-1' });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(loadTools).toHaveBeenCalledTimes(2);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          failedKeys: ['file:file-rebuild'],
          currentOcrFailures: [expect.objectContaining({ errorMessage: providerError.message })],
        }),
      );
      expect(providerError.cause).toBe(rebuildError);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries HTTP 408 twice without rebuilding MCP and keeps the fallback turn active', async () => {
    const req = imageRequest('file-timeout', 'timeout.pdf');
    const invoke = jest.fn().mockRejectedValue(new Error('HTTP 408: Request Timeout'));
    mockPaddleOcrBatchWithOrganizer([]);
    mockPaddleOcrToolLoads(invoke);
    jest.useFakeTimers();
    try {
      const resultPromise = runPreflight({ req, streamId: 'stream-1' });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(reinitServer).not.toHaveBeenCalled();
      expect(disconnectAppConnection).not.toHaveBeenCalled();
      expect(loadTools).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(3);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'partial',
          ocrTurnActive: true,
          failedKeys: ['file:file-timeout'],
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
