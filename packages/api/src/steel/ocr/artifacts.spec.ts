import mongoose from 'mongoose';
import { createSteelOcrPdfChunkArtifactModel } from '@librechat/data-schemas';

import { buildPdfPageChunks } from './chunks';
import {
  buildOcrPdfChunkArtifactStorageKey,
  commitOcrPdfChunkSplit,
  createMongooseOcrPdfChunkArtifactRepository,
  ensurePdfChunkArtifacts,
  resolveCanonicalOcrPageChunks,
  type OcrPdfChunkArtifactRecord,
} from './artifacts';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  createSteelOcrPdfChunkArtifactModel: jest.fn(),
}));

const createArtifactModel = jest.mocked(createSteelOcrPdfChunkArtifactModel);

describe('OCR PDF chunk artifacts', () => {
  it('upserts by a deterministic source, version, and page-range id', async () => {
    const updateOne = jest.fn<
      Promise<void>,
      [
        { _id: mongoose.Types.ObjectId },
        { $set: OcrPdfChunkArtifactRecord },
        { upsert: true },
      ]
    >(async () => undefined);
    createArtifactModel.mockReturnValueOnce({ updateOne } as never);
    const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);
    const artifact: OcrPdfChunkArtifactRecord = {
      sourcePdfKey: 's3://bucket/original.pdf',
      pipelineVersion: 1,
      chunkIndex: 1,
      chunkCount: 2,
      pageStart: 1,
      pageEnd: 50,
      chunkSizePages: 50,
      sourceFilename: 'original.pdf',
      artifact: {
        source: 's3',
        storageKey: 'chunks/pages-1-50.pdf',
        filepath: 'https://cdn.example/chunks/pages-1-50.pdf',
        filename: 'pages-1-50.pdf',
        bytes: 100,
        contentType: 'application/pdf',
      },
    };

    await repository.upsert(artifact);
    await repository.upsert({
      ...artifact,
      chunkIndex: 9,
      chunkCount: 9,
      sourceFilename: 'renamed.pdf',
      artifact: { ...artifact.artifact, bytes: 200 },
    });
    await repository.upsert({ ...artifact, sourcePdfKey: 's3://bucket/other.pdf' });
    await repository.upsert({ ...artifact, pipelineVersion: 2 });
    await repository.upsert({ ...artifact, pageStart: 51, pageEnd: 100 });

    const firstId = updateOne.mock.calls[0]?.[0]._id;
    const secondId = updateOne.mock.calls[1]?.[0]._id;
    const changedIdentityIds = updateOne.mock.calls.slice(2).map(([filter]) => filter._id);
    expect(firstId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(firstId).toEqual(secondId);
    expect(changedIdentityIds).toHaveLength(3);
    expect(changedIdentityIds.every((id) => !id.equals(firstId))).toBe(true);
    expect(new Set(changedIdentityIds.map(String)).size).toBe(3);
    expect(updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: firstId },
      { $set: artifact },
      { upsert: true },
    );
  });

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

  it('requires a committed parent marker before child rows supersede the default plan', () => {
    const defaults = buildPdfPageChunks({ pageCount: 50 });
    const childRows = [
      {
        ...defaults[0],
        chunkIndex: 1,
        chunkCount: 2,
        pageStart: 1,
        pageEnd: 25,
        chunkSizePages: 25,
      },
      {
        ...defaults[0],
        chunkIndex: 2,
        chunkCount: 2,
        pageStart: 26,
        pageEnd: 50,
        chunkSizePages: 25,
      },
    ] as OcrPdfChunkArtifactRecord[];
    expect(resolveCanonicalOcrPageChunks({ defaultChunks: defaults, artifactRows: childRows })).toEqual(
      defaults,
    );
    expect(
      resolveCanonicalOcrPageChunks({
        defaultChunks: defaults,
        artifactRows: [
          {
            ...defaults[0],
            supersededByRanges: [
              { pageStart: 1, pageEnd: 25 },
              { pageStart: 26, pageEnd: 50 },
            ],
          },
          ...childRows,
        ],
      }),
    ).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 25, chunkSizePages: 25 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 26, pageEnd: 50, chunkSizePages: 25 },
    ]);
  });

  it('persists both child artifacts before committing the parent split marker', async () => {
    const parent = buildPdfPageChunks({ pageCount: 50 })[0]!;
    const children = [
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 25, chunkSizePages: 25 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 26, pageEnd: 50, chunkSizePages: 25 },
    ];
    const events: string[] = [];
    const parentRow = {
      ...parent,
      sourcePdfKey: 's3://bucket/original.pdf',
      pipelineVersion: 1,
      artifact: {
        source: 's3' as const,
        storageKey: 'chunks/parent.pdf',
        filepath: 'https://cdn.example/chunks/parent.pdf',
        filename: 'parent.pdf',
        bytes: 100,
        contentType: 'application/pdf' as const,
      },
    };
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [parentRow]),
      upsert: jest.fn(async (artifact) => {
        events.push(`upsert:${artifact.pageStart}-${artifact.pageEnd}`);
      }),
      compareAndSetSupersededByRanges: jest.fn(async () => {
        events.push('commit-marker');
        return 'updated' as const;
      }),
    };
    const storage = {
      source: 's3' as const,
      exists: jest.fn(async () => false),
      saveBuffer: jest.fn(async ({ filename }) => {
        events.push(`save:${filename}`);
        return { bytes: 25 };
      }),
      getDownloadUrl: jest.fn(async ({ storageKey }) => `https://cdn.example/${storageKey}`),
    };

    const artifacts = await commitOcrPdfChunkSplit({
      sourcePdfKey: 's3://bucket/original.pdf',
      sourceFilename: 'original.pdf',
      parent,
      children,
      chunks: children,
      repository,
      storage,
      createPdfChunk: jest.fn(async () => new Uint8Array([1, 2, 3])),
    });

    expect(artifacts.map(({ pageStart, pageEnd }) => [pageStart, pageEnd])).toEqual([
      [1, 25],
      [26, 50],
    ]);
    expect(events.at(-1)).toBe('commit-marker');
    expect(repository.upsert).toHaveBeenCalledTimes(2);
    expect(repository.compareAndSetSupersededByRanges).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: expect.objectContaining({ pageStart: 1, pageEnd: 50 }),
        supersededByRanges: [
          { pageStart: 1, pageEnd: 25 },
          { pageStart: 26, pageEnd: 50 },
        ],
      }),
    );
  });

  it('rejects malformed parent markers', () => {
    expect(() =>
      resolveCanonicalOcrPageChunks({
        defaultChunks: buildPdfPageChunks({ pageCount: 50 }),
        artifactRows: [
          {
            ...buildPdfPageChunks({ pageCount: 50 })[0],
            supersededByRanges: [{ pageStart: 1, pageEnd: 25 }],
          } as OcrPdfChunkArtifactRecord,
        ],
      }),
    ).toThrow();
  });
});
