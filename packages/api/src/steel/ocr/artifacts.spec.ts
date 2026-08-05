import { buildPdfPageChunks } from './chunks';
import {
  buildOcrPdfChunkArtifactStorageKey,
  ensurePdfChunkArtifacts,
  type OcrPdfChunkArtifactRecord,
} from './artifacts';

describe('OCR PDF chunk artifacts', () => {
  it('builds deterministic storage keys from source PDF key and page range', () => {
    expect(
      buildOcrPdfChunkArtifactStorageKey({
        sourcePdfKey: 's3://bucket/r/prod/t/tenant/uploads/original.pdf',
        pipelineVersion: 1,
        chunk: {
          pageStart: 1,
          pageEnd: 50,
        },
      }),
    ).toMatch(/^ocr-preprocessing\/[a-f0-9]{64}\/v1\/pages-000001-000050\.pdf$/);
  });

  it('reuses global artifact rows for the same source PDF key across conversations', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 100 });
    const rows = new Map();
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [...rows.values()]),
      upsert: jest.fn(async (artifact) => {
        rows.set(`${artifact.chunkIndex}`, artifact);
      }),
    };
    const storage = {
      source: 's3' as const,
      exists: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true),
      saveBuffer: jest.fn(async () => ({
        bytes: 123,
        storageRegion: 'ap-east-1',
      })),
      getDownloadUrl: jest.fn(async ({ storageKey }) => `https://cdn.example/${storageKey}`),
    };
    const createPdfChunk = jest.fn(async () => new Uint8Array([1, 2, 3]));

    await ensurePdfChunkArtifacts({
      sourcePdfKey: 's3://bucket/r/prod/t/tenant/uploads/original.pdf',
      sourceFilename: 'quote.pdf',
      chunks,
      repository,
      storage,
      createPdfChunk,
    });
    const second = await ensurePdfChunkArtifacts({
      sourcePdfKey: 's3://bucket/r/prod/t/tenant/uploads/original.pdf',
      sourceFilename: 'quote.pdf',
      chunks,
      repository,
      storage,
      createPdfChunk,
    });

    expect(createPdfChunk).toHaveBeenCalledTimes(2);
    expect(storage.saveBuffer).toHaveBeenCalledTimes(2);
    expect(storage.exists).toHaveBeenCalledTimes(4);
    expect(repository.upsert).toHaveBeenCalledTimes(2);
    expect(second).toHaveLength(2);
    expect(second.every((artifact) => artifact.artifactOrigin === 'existing')).toBe(true);
    expect(second.map((artifact) => artifact.filepath)).toEqual([
      expect.stringContaining('/pages-000001-000050.pdf'),
      expect.stringContaining('/pages-000051-000100.pdf'),
    ]);
  });

  it('recreates stored rows whose S3 chunk object is missing', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 50 });
    const rows = new Map();
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [...rows.values()]),
      upsert: jest.fn(async (artifact) => {
        rows.set(`${artifact.chunkIndex}`, artifact);
      }),
    };
    const storage = {
      source: 'cloudfront' as const,
      exists: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      saveBuffer: jest.fn(async () => ({
        bytes: 456,
        storageRegion: 'ap-east-1',
      })),
      getDownloadUrl: jest.fn(async ({ storageKey }) => `https://cdn.example/${storageKey}`),
    };
    const createPdfChunk = jest.fn(async () => new Uint8Array([1, 2, 3]));

    await ensurePdfChunkArtifacts({
      sourcePdfKey: 's3://bucket/r/prod/t/tenant/uploads/original.pdf',
      sourceFilename: 'quote.pdf',
      chunks,
      repository,
      storage,
      createPdfChunk,
    });
    const recreated = await ensurePdfChunkArtifacts({
      sourcePdfKey: 's3://bucket/r/prod/t/tenant/uploads/original.pdf',
      sourceFilename: 'quote.pdf',
      chunks,
      repository,
      storage,
      createPdfChunk,
    });

    expect(storage.exists).toHaveBeenCalledTimes(2);
    expect(createPdfChunk).toHaveBeenCalledTimes(2);
    expect(storage.saveBuffer).toHaveBeenCalledTimes(2);
    expect(repository.upsert).toHaveBeenCalledTimes(2);
    expect(recreated[0]).toEqual(
      expect.objectContaining({ artifactOrigin: 'uploaded', source: 'cloudfront' }),
    );
  });

  it('does not reuse a cached page-35 row for a page-36 request with the same chunk index', async () => {
    const rows = new Map<string, OcrPdfChunkArtifactRecord>();
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [...rows.values()]),
      upsert: jest.fn(async (artifact) => {
        rows.set(`${artifact.chunkIndex}:${artifact.pageStart}:${artifact.pageEnd}`, artifact);
      }),
    };
    const storage = {
      source: 's3' as const,
      exists: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      saveBuffer: jest.fn(async () => ({ bytes: 10 })),
      getDownloadUrl: jest.fn(async ({ storageKey }) => `https://cdn.example/${storageKey}`),
    };
    const createPdfChunk = jest.fn(async () => new Uint8Array([1, 2, 3]));
    const baseInput = {
      sourcePdfKey: 's3://bucket/original.pdf',
      sourceFilename: 'quote.pdf',
      repository,
      storage,
      createPdfChunk,
    };

    await ensurePdfChunkArtifacts({
      ...baseInput,
      chunks: [
        { chunkIndex: 1, chunkCount: 1, pageStart: 35, pageEnd: 35, chunkSizePages: 1 },
      ],
    });
    const page36 = await ensurePdfChunkArtifacts({
      ...baseInput,
      chunks: [
        { chunkIndex: 1, chunkCount: 1, pageStart: 36, pageEnd: 36, chunkSizePages: 1 },
      ],
    });

    expect(page36[0]).toEqual(
      expect.objectContaining({
        pageStart: 36,
        pageEnd: 36,
        storageKey: expect.stringContaining('pages-000036-000036.pdf'),
      }),
    );
    expect(page36[0]?.storageKey).not.toContain('pages-000035-000035.pdf');
    expect(repository.upsert).toHaveBeenCalledTimes(2);
  });
});
