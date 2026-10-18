import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { SteelOcrPreprocessingSourceFile } from './files';
import type { OcrPreprocessingPageChunk } from './chunks';
import {
  createSteelOcrPdfChunkArtifactStore,
  createSteelOcrOriginalFileArtifactStore,
} from './storage';
import { createMongooseOcrPdfChunkArtifactRepository } from './artifacts';

const mockGetS3DownloadURLForKey = jest.fn();
const mockS3ObjectExistsByKey = jest.fn();

jest.mock('~/storage/s3/crud', () => ({
  ...jest.requireActual('~/storage/s3/crud'),
  getS3DownloadURLForKey: (...args: unknown[]) => mockGetS3DownloadURLForKey(...args),
  s3ObjectExistsByKey: (...args: unknown[]) => mockS3ObjectExistsByKey(...args),
  saveBufferToS3StorageKey: jest.fn(async () => ({ bytes: 1234 })),
}));

const sourcePdfKey = 'uploads/user_123/pdf-small__small.pdf';
const fileRecord = {
  file_id: 'pdf-small',
  filename: 'small.pdf',
  storageKey: sourcePdfKey,
  source: 's3',
  type: 'application/pdf',
  bytes: 987,
};
const file: SteelOcrPreprocessingSourceFile = {
  fileId: 'pdf-small',
  filename: 'small.pdf',
  mediaType: 'application/pdf',
  ocrFileKey: 'file:pdf-small',
  sourcePdfKey,
  sourceFilename: 'small.pdf',
};
const shortPdfChunk: OcrPreprocessingPageChunk = {
  chunkIndex: 1,
  chunkCount: 1,
  pageStart: 1,
  pageEnd: 49,
  chunkSizePages: 50,
};

let server: MongoMemoryReplSet;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
}, 60000);

afterEach(async () => {
  jest.clearAllMocks();
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

describe('createSteelOcrPdfChunkArtifactStore', () => {
  it('keeps a PDF under 50 pages as its original object and records it as the canonical artifact', async () => {
    mockGetS3DownloadURLForKey.mockResolvedValueOnce(
      'https://files.example.test/original-small.pdf',
    );
    const store = createSteelOcrPdfChunkArtifactStore({ file, fileRecord });

    const artifacts = await store.ensurePdfChunkArtifacts({
      file,
      sourcePdfKey,
      chunks: [shortPdfChunk],
    });

    expect(mockGetS3DownloadURLForKey).toHaveBeenCalledWith({
      storageKey: sourcePdfKey,
      contentType: 'application/pdf',
    });
    expect(artifacts).toEqual([
      expect.objectContaining({
        ...shortPdfChunk,
        sourcePdfKey,
        source: 's3',
        storageKey: sourcePdfKey,
        filepath: 'https://files.example.test/original-small.pdf',
        filename: 'small.pdf',
        bytes: 987,
        artifactOrigin: 'original',
      }),
    ]);
    const rows = await createMongooseOcrPdfChunkArtifactRepository(mongoose).findBySourcePdfKey({
      sourcePdfKey,
      pipelineVersion: 1,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        sourcePdfKey,
        sourceFileId: 'pdf-small',
        pageStart: 1,
        pageEnd: 49,
        artifact: expect.objectContaining({
          storageKey: sourcePdfKey,
          filepath: 'https://files.example.test/original-small.pdf',
        }),
      }),
    ]);
  });

  it('fails closed when the canonical original object is missing from storage', async () => {
    await createMongooseOcrPdfChunkArtifactRepository(mongoose).upsert({
      sourcePdfKey,
      pipelineVersion: 1,
      ...shortPdfChunk,
      artifact: {
        source: 's3',
        storageKey: sourcePdfKey,
        filepath: 'https://files.example.test/expired-original.pdf',
        filename: 'small.pdf',
        bytes: 987,
        contentType: 'application/pdf',
      },
    });
    mockS3ObjectExistsByKey.mockResolvedValueOnce({ exists: false });

    await expect(
      createSteelOcrPdfChunkArtifactStore({ file, fileRecord }).ensurePdfChunkArtifacts({
        file,
        sourcePdfKey,
        chunks: [shortPdfChunk],
      }),
    ).rejects.toThrow('canonical original PDF object is missing');
    expect(mockGetS3DownloadURLForKey).not.toHaveBeenCalled();
  });

  it('persists a re-signed range URL with a compare-and-set on the previous URL', async () => {
    const chunk = { chunkIndex: 1, chunkCount: 1, pageStart: 1, pageEnd: 50, chunkSizePages: 50 };
    const ensuredUrl = 'https://fresh.example/pages-1-50.pdf';
    const refreshedUrl = 'https://fresh.example/ocr/pages-1-50.pdf?Expires=4102444800';
    const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);
    await repository.upsert({
      sourcePdfKey,
      pipelineVersion: 1,
      ...chunk,
      artifact: {
        source: 's3',
        storageKey: 'ocr/pages-1-50.pdf',
        filepath: ensuredUrl,
        filename: 'pages-1-50.pdf',
        bytes: 100,
        contentType: 'application/pdf',
      },
    });
    mockGetS3DownloadURLForKey.mockResolvedValueOnce(refreshedUrl);

    const refreshed = await createSteelOcrPdfChunkArtifactStore({
      file,
      fileRecord,
    }).refreshPdfChunkArtifact({
      file,
      chunk,
      artifact: {
        ...chunk,
        sourcePdfKey,
        storageKey: 'ocr/pages-1-50.pdf',
        filepath: ensuredUrl,
        source: 's3',
      },
    });

    expect(refreshed.filepath).toBe(refreshedUrl);
    expect(mockGetS3DownloadURLForKey).toHaveBeenCalledWith({
      storageKey: 'ocr/pages-1-50.pdf',
      contentType: 'application/pdf',
    });
    const rows = await repository.findBySourcePdfKey({ sourcePdfKey, pipelineVersion: 1 });
    expect(rows[0]?.artifact.filepath).toBe(refreshedUrl);
  });
});

describe('createSteelOcrOriginalFileArtifactStore', () => {
  it('keeps a URL-only original artifact without signing when refreshed', async () => {
    const filepath = 'https://files.example.test/url-only.pdf';
    const urlOnly: SteelOcrPreprocessingSourceFile = {
      ...file,
      fileId: 'pdf-url-only',
      filename: 'url-only.pdf',
      ocrFileKey: 'file:pdf-url-only',
      sourcePdfKey: filepath,
      filepath,
    };
    const store = createSteelOcrOriginalFileArtifactStore({ file: urlOnly });
    const chunk = { chunkIndex: 1, chunkCount: 1, pageStart: 1, pageEnd: 1, chunkSizePages: 50 };

    const [artifact] = await store.ensurePdfChunkArtifacts({
      file: urlOnly,
      sourcePdfKey: filepath,
      chunks: [chunk],
    });
    const refreshed = await store.refreshPdfChunkArtifact({ file: urlOnly, chunk, artifact });

    expect(artifact).toEqual(expect.objectContaining({ storageKey: filepath, filepath }));
    expect(refreshed).toBe(artifact);
    expect(mockGetS3DownloadURLForKey).not.toHaveBeenCalled();
  });
});
