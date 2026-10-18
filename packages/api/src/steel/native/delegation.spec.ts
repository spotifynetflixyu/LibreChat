import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMethods, createModels } from '@librechat/data-schemas';
import type { IMongoFile } from '@librechat/data-schemas';
import type { SteelOcrPdfChunkArtifactStore, SteelOcrStoredArtifact } from '../ocr/storage';
import type { SteelDelegateOcrRequest, SteelDelegateOcrDependencies } from './delegation';
import type { DelegateOcrFileInput, DelegateOcrStoredFileRecord } from './delegate';
import { createSteelDelegateOcrStateService } from '../ocr/state';
import { createSteelDelegateOcrService } from './delegation';

const mockCreateModel = jest.fn();
const mockBuildContext = jest.fn();

jest.mock('./oauth', () => ({
  ...jest.requireActual('./oauth'),
  createOpenAIOAuthModel: (...args: unknown[]) => mockCreateModel(...args),
}));
jest.mock('./context', () => ({
  ...jest.requireActual('./context'),
  buildDefaultSteelGlobalAgentContext: (...args: unknown[]) => mockBuildContext(...args),
}));

const userId = '507f1f77bcf86cd799439011';
const otherUserId = '507f1f77bcf86cd799439012';
const client = { query: jest.fn() };
const drawingKey = `uploads/${userId}/drawing-1__drawing.pdf`;

let server: MongoMemoryReplSet;
let db: ReturnType<typeof createMethods>;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
}, 60000);

afterEach(async () => {
  jest.restoreAllMocks();
  mockCreateModel.mockReset();
  mockBuildContext.mockReset();
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

async function insertFile(file: Partial<IMongoFile> & { file_id: string }, owner = userId) {
  await mongoose.connection.collection('files').insertOne({
    user: new mongoose.Types.ObjectId(owner),
    object: 'file',
    bytes: 100,
    filepath: `https://stored.example/${file.file_id}`,
    filename: `${file.file_id}.pdf`,
    type: 'application/pdf',
    source: 's3',
    ...file,
  });
}

function rangeArtifact(pageStart: number, pageEnd: number, index = 1, count = 1) {
  return {
    chunkIndex: index,
    chunkCount: count,
    pageStart,
    pageEnd,
    chunkSizePages: pageEnd - pageStart + 1,
    filepath: `https://fresh.example/pages-${pageStart}-${pageEnd}.pdf`,
    storageKey: `ocr/pages-${pageStart}-${pageEnd}.pdf`,
    filename: `pages-${pageStart}-${pageEnd}.pdf`,
    source: 's3' as const,
  };
}

function createArtifactStore(
  loadExisting: SteelOcrPdfChunkArtifactStore['loadExistingPdfChunkArtifacts'],
): SteelOcrPdfChunkArtifactStore &
  Record<'loadExistingPdfChunkArtifacts' | 'refreshPdfChunkArtifact', jest.Mock> {
  return {
    loadExistingPdfChunkArtifacts: jest.fn(loadExisting),
    refreshPdfChunkArtifact: jest.fn(),
    ensurePdfChunkArtifacts: jest.fn(),
  };
}

function createDeps(artifactStore?: SteelOcrPdfChunkArtifactStore) {
  const getDownloadURL = jest.fn(
    async ({ file }: { file: DelegateOcrStoredFileRecord }) =>
      `https://signed.example/${file.filename}`,
  );
  const deps: SteelDelegateOcrDependencies = {
    db,
    client,
    getStrategy: jest.fn(() => ({ getDownloadURL })),
    stateService: createSteelDelegateOcrStateService(mongoose),
    ocr: {
      resolvePreprocessingRules: jest.fn(),
      createOrganizer: jest.fn(),
      createPaddleOcrChunkRunner: jest.fn(),
      createPdfChunkArtifactStore: jest.fn(() => {
        if (!artifactStore) throw new Error('No PDF artifact store in this test');
        return artifactStore;
      }),
    },
  };
  return { deps, getDownloadURL };
}

function createRequest(turn: string, extra: SteelDelegateOcrRequest['steelNativeContext'] = {}) {
  const req: SteelDelegateOcrRequest = {
    user: { id: userId },
    config: { fileStrategy: 's3' },
    steelNativeContext: {
      delegateOcrPolicy: { resolved: true, allowed: true, allowedFileKeys: ['file:drawing-1'] },
      delegateOcrContext: {
        modelOptions: { model: 'gpt-5.6-luna', tools: [] },
        steelConversation: {
          requestId: 'response-1',
          currentUserTurn: { role: 'user', content: turn },
          activeHistory: [{ role: 'user', content: turn }],
        },
      },
      ...extra,
    },
  };
  return req;
}

/** A model that echoes the files it was given, so tests can see which sources it read. */
function echoModel() {
  const stream = jest.fn(async function* (messages: { content: unknown }[]) {
    yield { content: JSON.stringify(messages[messages.length - 1]?.content) };
  });
  mockCreateModel.mockReturnValue({ stream });
  return stream;
}

function sourcesOf(stream: jest.Mock): string[] {
  return stream.mock.calls.map(([messages]: [{ content: unknown }[]]) =>
    JSON.stringify(messages[messages.length - 1]?.content),
  );
}

async function seedResumableRun({
  files,
  fileIds,
  triggeringMessageId = 'user-message-1',
}: {
  files: DelegateOcrFileInput[];
  fileIds: string[];
  triggeringMessageId?: string;
}) {
  const stateService = createSteelDelegateOcrStateService(mongoose);
  const claim = await stateService.claimNewDelegateOcrIndex({
    conversationId: 'convo-1',
    triggeringMessageId,
  });
  if (!claim) throw new Error('Expected a delegate OCR claim');
  await stateService.materializeDelegateOcrRun({
    conversationId: 'convo-1',
    delegateOcrIndex: claim.delegateOcrIndex,
    claimToken: claim.claimToken,
    triggeringMessageId,
    toolParameters: {
      files: files.map(({ fileKey, pageRanges }) => ({
        fileKey,
        ...(pageRanges ? { pageRanges: pageRanges.map((range) => ({ ...range })) } : {}),
      })),
    },
    files: fileIds.map((fileId) => ({ fileId, filename: `${fileId}.pdf` })),
  });
  await stateService.transitionDelegateOcrRun({ claimToken: claim.claimToken, status: 'running' });
  return claim;
}

describe('resolveDelegateOcrPolicyForRequest', () => {
  it('allows only owned conversation attachments, looks them up once, and skips quote/preflight turns', async () => {
    await insertFile({ file_id: 'owned-file' });
    await insertFile({ file_id: 'foreign-file' }, otherUserId);
    const { deps } = createDeps();
    const getFiles = jest.spyOn(db, 'getFiles');
    const service = createSteelDelegateOcrService(deps);
    const req = createRequest('重新確認圖面');
    req.steelNativeContext!.delegateOcrContext!.steelConversation!.activeHistory = [
      {
        role: 'user',
        content: '重新確認圖面',
        files: [
          { fileId: 'owned-file', source: 'librechat_file_record', mediaType: 'application/pdf' },
          { fileId: 'foreign-file', source: 'librechat_file_record', mediaType: 'application/pdf' },
        ],
      },
    ];

    const policy = await service.resolveDelegateOcrPolicyForRequest({
      req,
      currentUserTurn: '重新確認圖面',
    });
    await expect(
      service.resolveDelegateOcrPolicyForRequest({ req, currentUserTurn: '重新確認圖面' }),
    ).resolves.toEqual(policy);

    expect(policy).toEqual({ resolved: true, allowed: true, allowedFileKeys: ['file:owned-file'] });
    expect(getFiles).toHaveBeenCalledTimes(1);
    await expect(
      service.resolveDelegateOcrPolicyForRequest({ req, currentUserTurn: '重新確認圖面後報價' }),
    ).resolves.toEqual({ resolved: true, allowed: false, allowedFileKeys: [] });
    await expect(
      service.resolveDelegateOcrPolicyForRequest({
        req,
        currentUserTurn: '重新確認圖面',
        ocrTurnActive: true,
      }),
    ).resolves.toEqual({ resolved: true, allowed: false, allowedFileKeys: [] });
    expect(getFiles).toHaveBeenCalledTimes(1);
  });
});

describe('prepareDelegateOcrResume', () => {
  const originalFiles = [
    { fileKey: 'filename:file-1.pdf', pageRanges: [{ pageStart: 3, pageEnd: 7 }] },
  ];

  it('resumes only the exact user message with its saved params after re-authorizing the files', async () => {
    await insertFile({ file_id: 'file-1' });
    const claim = await seedResumableRun({ files: originalFiles, fileIds: ['file-1'] });
    const { deps } = createDeps();
    const service = createSteelDelegateOcrService(deps);
    const req = createRequest('繼續');

    await expect(
      service.prepareDelegateOcrResume({
        req,
        conversationId: 'convo-1',
        triggeringMessageId: 'other-message',
        userId,
      }),
    ).resolves.toBeUndefined();
    const resume = await service.prepareDelegateOcrResume({
      req,
      conversationId: 'convo-1',
      triggeringMessageId: 'user-message-1',
      userId,
    });

    expect(resume?.files).toEqual(originalFiles);
    expect(resume?.claim).toEqual(expect.objectContaining({ claimToken: claim.claimToken }));
    expect(resume?.lease?.executionLeaseToken).toEqual(expect.stringMatching(/^[0-9a-f-]{16,}$/iu));
    expect(resume?.policy.allowedFileKeys).toEqual(['filename:file-1.pdf', 'file:file-1']);
    const delegateContext = req.steelNativeContext?.delegateOcrContext;
    expect(delegateContext?.delegateOcrPolicy).toEqual({
      resolved: true,
      allowed: false,
      allowedFileKeys: [],
      reason: 'delegate_ocr_resume',
    });
    expect(delegateContext?.delegateOcrRun?.claimToken).toBe(claim.claimToken);
    expect(delegateContext?.delegateOcrWorkflow).toEqual(
      expect.objectContaining({
        claimToken: claim.claimToken,
        triggeringMessageId: 'user-message-1',
        filesOverride: originalFiles,
        executionLeaseToken: resume?.lease?.executionLeaseToken,
      }),
    );
    expect(req.steelNativeContext?.delegateOcrResume).toBe(resume);
  });

  it('fails closed when a saved file is no longer owned or the lease CAS loses the race', async () => {
    await insertFile({ file_id: 'file-1' }, otherUserId);
    await seedResumableRun({ files: originalFiles, fileIds: ['file-1'] });
    const { deps } = createDeps();
    const service = createSteelDelegateOcrService(deps);
    const input = {
      req: createRequest('繼續'),
      conversationId: 'convo-1',
      triggeringMessageId: 'user-message-1',
      userId,
    };

    await expect(service.prepareDelegateOcrResume(input)).rejects.toThrow(
      'delegate_ocr resume authorization failed',
    );

    await insertFile({ file_id: 'file-1' });
    const acquire = jest
      .spyOn(deps.stateService!, 'acquireDelegateExecutionLease')
      .mockResolvedValue(undefined);
    await expect(service.prepareDelegateOcrResume(input)).rejects.toThrow(
      'delegate_ocr resume execution lease is unavailable',
    );
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedConversationId: 'convo-1',
        expectedTriggeringMessageId: 'user-message-1',
        expectedLeaseToken: null,
      }),
    );
  });
});

describe('executeDelegateOcrResume', () => {
  it('re-emits a finalized candidate without model options or rerunning the agent', async () => {
    const markdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| F1 | P1 |';
    const claim = await seedResumableRun({
      files: [{ fileKey: 'file:file-1' }],
      fileIds: ['file-1'],
    });
    const stateService = createSteelDelegateOcrStateService(mongoose);
    await stateService.transitionDelegateOcrRun({
      claimToken: claim.claimToken,
      status: 'save_failed',
      responseGenerationId: 'generation-4',
    });
    const run = await stateService.findDelegateOcrRunByClaimToken(claim.claimToken);
    if (!run) throw new Error('Expected the seeded delegate OCR run');
    const onDelta = jest.fn();
    const service = createSteelDelegateOcrService(createDeps().deps);
    const req: SteelDelegateOcrRequest = {
      steelNativeContext: { delegateOcrContext: { delegateOcrWorkflow: {} } },
    };

    const result = await service.executeDelegateOcrResume({
      req,
      resume: {
        run,
        claim,
        files: [{ fileKey: 'file:file-1' }],
        records: [],
        policy: { resolved: true, allowed: true, allowedFileKeys: ['file:file-1'] },
        candidate: { token: 'candidate-1', markdown, source: 'backend' },
      },
      onDelta,
    });

    expect(result).toBe(markdown);
    expect(onDelta).toHaveBeenCalledWith(markdown, {
      claimToken: claim.claimToken,
      generationId: 'generation-4',
      attemptToken: undefined,
    });
    expect(req.steelNativeContext?.delegateOcrContext?.delegateOcrWorkflow).toEqual(
      expect.objectContaining({ finalizedByBackend: true }),
    );
    expect(mockCreateModel).not.toHaveBeenCalled();
  });
});

describe('createDelegateOcrExecute', () => {
  const execute = (deps: SteelDelegateOcrDependencies, req: SteelDelegateOcrRequest) =>
    createSteelDelegateOcrService(deps).createDelegateOcrExecute({
      req,
      agent: { id: 'agent_123' },
    });

  it('reads the owner-scoped range artifact with the current turn and delegate rules only', async () => {
    await insertFile({
      file_id: 'drawing-1',
      storageKey: drawingKey,
      filepath: 'https://old.example/expired.pdf',
    });
    const artifactStore = createArtifactStore(async () => [rangeArtifact(35, 35)]);
    const { deps, getDownloadURL } = createDeps(artifactStore);
    mockBuildContext.mockResolvedValue({ instructionPrefix: 'DELEGATE_RULES' });
    const stream = echoModel();
    const req = createRequest('重新核對第 35 頁孔數');
    req.steelNativeContext!.delegateOcrContext!.steelConversation!.activeHistory = [
      { role: 'user', content: '請重新確認開槽連續邊長' },
    ];

    const output = await execute(
      deps,
      req,
    )({
      files: [{ fileKey: 'file:drawing-1', pageRanges: [{ pageStart: 35, pageEnd: 35 }] }],
    });

    expect(output).toContain('pages-35-35.pdf');
    expect(artifactStore.loadExistingPdfChunkArtifacts).toHaveBeenCalledWith({
      sourcePdfKey: drawingKey,
      pageRanges: [{ pageStart: 35, pageEnd: 35 }],
    });
    expect(getDownloadURL).not.toHaveBeenCalled();
    expect(mockBuildContext).toHaveBeenCalledWith({
      runtimeRulesClient: client,
      conversation: req.steelNativeContext?.delegateOcrContext?.steelConversation,
      renderProfile: 'agent_client',
      mode: 'delegate_ocr',
    });
    const messages = JSON.stringify(stream.mock.calls[0][0]);
    expect(messages).toContain('DELEGATE_RULES');
    expect(messages).toContain('重新核對第 35 頁孔數');
    expect(messages).not.toContain('請重新確認開槽連續邊長');
    expect(messages).not.toContain('https://old.example/expired.pdf');
    expect(mockCreateModel).toHaveBeenCalledWith(expect.objectContaining({ tools: [] }));
  });

  it('refreshes an expired range URL before retrying the agent', async () => {
    await insertFile({ file_id: 'drawing-1', storageKey: drawingKey });
    const artifact = rangeArtifact(1, 50);
    const refreshed: SteelOcrStoredArtifact = {
      ...artifact,
      filepath: 'https://fresh.example/ocr/pages-1-50.pdf?Expires=4102444800',
    };
    const artifactStore = createArtifactStore(async () => [artifact]);
    artifactStore.refreshPdfChunkArtifact.mockResolvedValue(refreshed);
    mockBuildContext.mockResolvedValue({ instructionPrefix: 'DELEGATE_RULES' });
    let attempt = 0;
    const stream = jest.fn(async function* (messages: { content: unknown }[]) {
      attempt += 1;
      if (attempt === 1) throw new Error('RequestExpired');
      yield { content: JSON.stringify(messages[messages.length - 1]?.content) };
    });
    mockCreateModel.mockReturnValue({ stream });

    const output = await execute(
      createDeps(artifactStore).deps,
      createRequest('重新確認圖面'),
    )({
      files: [{ fileKey: 'file:drawing-1', pageRanges: [{ pageStart: 1, pageEnd: 50 }] }],
    });

    expect(stream).toHaveBeenCalledTimes(2);
    expect(output).toContain(refreshed.filepath);
    expect(artifactStore.refreshPdfChunkArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact,
        chunk: expect.objectContaining({ pageStart: 1, pageEnd: 50 }),
      }),
    );
  });

  it('runs a long PDF as ordered range batches and a selected image as its own batch', async () => {
    await insertFile({ file_id: 'drawing-1', storageKey: drawingKey });
    await insertFile({ file_id: 'detail-1', filename: 'detail.png', type: 'image/png' });
    const artifactStore = createArtifactStore(async ({ pageRanges }) =>
      pageRanges.map(({ pageStart, pageEnd }, index) =>
        rangeArtifact(pageStart, pageEnd, index + 1, pageRanges.length),
      ),
    );
    const { deps, getDownloadURL } = createDeps(artifactStore);
    mockBuildContext.mockResolvedValue({ instructionPrefix: 'DELEGATE_RULES' });
    const stream = echoModel();
    const req = createRequest('完整 OCR 106 頁 PDF');
    req.steelNativeContext!.delegateOcrPolicy!.allowedFileKeys = [
      'file:drawing-1',
      'file:detail-1',
    ];
    const pageRanges = [
      { pageStart: 1, pageEnd: 50 },
      { pageStart: 51, pageEnd: 100 },
      { pageStart: 101, pageEnd: 106 },
    ];

    await execute(
      deps,
      req,
    )({
      files: [
        { fileKey: 'file:drawing-1', pageRanges },
        { fileKey: 'file:detail-1', pageRanges: [{ pageStart: 999, pageEnd: 999 }] },
      ],
    });

    expect(artifactStore.loadExistingPdfChunkArtifacts).toHaveBeenCalledTimes(1);
    expect(artifactStore.loadExistingPdfChunkArtifacts).toHaveBeenCalledWith({
      sourcePdfKey: drawingKey,
      pageRanges,
    });
    const sources = sourcesOf(stream);
    expect(sources).toHaveLength(4);
    expect(sources[0]).toContain('pages-1-50.pdf');
    expect(sources[1]).toContain('pages-51-100.pdf');
    expect(sources[2]).toContain('pages-101-106.pdf');
    expect(sources[3]).toContain('https://signed.example/detail.png');
    expect(getDownloadURL).toHaveBeenCalledTimes(1);
  });

  it('names the failing range and never starts the agent when artifacts are unavailable', async () => {
    await insertFile({ file_id: 'drawing-1', storageKey: drawingKey });
    const artifactStore = createArtifactStore(async () => {
      throw new Error('OCR artifact object is missing for 51-100');
    });
    mockBuildContext.mockResolvedValue({ instructionPrefix: 'DELEGATE_RULES' });

    await expect(
      execute(
        createDeps(artifactStore).deps,
        createRequest('重新核對整份圖面'),
      )({
        files: [{ fileKey: 'file:drawing-1', pageRanges: [{ pageStart: 1, pageEnd: 100 }] }],
      }),
    ).rejects.toThrow(
      'delegate_ocr failed preparing file:drawing-1: OCR artifact object is missing for 51-100',
    );
    expect(mockCreateModel).not.toHaveBeenCalled();
  });

  it('lets a signing failure reach the generic tool error path', async () => {
    await insertFile({ file_id: 'drawing-1', filename: 'drawing.png', type: 'image/png' });
    const { deps } = createDeps();
    deps.getStrategy = () => {
      throw new Error('S3 signer failed');
    };
    mockBuildContext.mockResolvedValue({ instructionPrefix: 'DELEGATE_RULES' });

    await expect(
      execute(
        deps,
        createRequest('重新解析'),
      )({
        files: [{ fileKey: 'file:drawing-1', pageRanges: [{ pageStart: 1, pageEnd: 1 }] }],
      }),
    ).rejects.toThrow('S3 signer failed');
  });

  it('refuses quote-only turns before reading files, rules, or the model', async () => {
    const { deps } = createDeps();
    const getFiles = jest.spyOn(db, 'getFiles');

    await expect(
      execute(deps, createRequest('第35頁報價'))({ files: [{ fileKey: 'file:drawing-1' }] }),
    ).rejects.toThrow('delegate_ocr is not used for quote-only requests');
    expect(getFiles).not.toHaveBeenCalled();
    expect(mockBuildContext).not.toHaveBeenCalled();
    expect(mockCreateModel).not.toHaveBeenCalled();
  });
});
