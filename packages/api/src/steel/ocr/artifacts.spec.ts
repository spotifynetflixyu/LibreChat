import mongoose from 'mongoose';
import { createSteelOcrPdfChunkArtifactModel } from '@librechat/data-schemas';

import { buildPdfPageChunks } from './chunks';
import {
  buildOcrPdfChunkArtifactStorageKey,
  commitOcrPdfChunkSplit,
  createMongooseOcrPdfChunkArtifactRepository,
  ensurePdfChunkArtifacts,
  getSignedUrlRemainingValiditySeconds,
  hasSufficientOcrPdfChunkArtifactUrlValidity,
  isUsableOcrPdfChunkArtifactUrl,
  loadExistingPdfChunkArtifacts,
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

  it('rotates a canonical URL with a targeted compare-and-set update', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    createArtifactModel.mockReturnValueOnce({ updateOne } as never);
    const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);

    await expect(
      repository.compareAndSetArtifactFilepath?.({
        sourcePdfKey: 's3://bucket/original.pdf',
        pipelineVersion: 1,
        pageStart: 1,
        pageEnd: 50,
        previousFilepath: 'https://cdn.example/old.pdf',
        filepath: 'https://cdn.example/fresh.pdf',
      }),
    ).resolves.toBe('https://cdn.example/fresh.pdf');
    expect(updateOne).toHaveBeenCalledWith(
      {
        sourcePdfKey: 's3://bucket/original.pdf',
        pipelineVersion: 1,
        pageStart: 1,
        pageEnd: 50,
        'artifact.filepath': 'https://cdn.example/old.pdf',
      },
      { $set: { 'artifact.filepath': 'https://cdn.example/fresh.pdf' } },
    );
  });

  it('returns the concurrent URL winner when compare-and-set loses the race', async () => {
    const winner = {
      artifact: {
        filepath: 'https://cdn.example/winner.pdf',
      },
    };
    const updateOne = jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
    const lean = jest.fn(async () => winner);
    const findOne = jest.fn(() => ({ lean }));
    createArtifactModel.mockReturnValueOnce({ updateOne, findOne } as never);
    const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);

    await expect(
      repository.compareAndSetArtifactFilepath?.({
        sourcePdfKey: 's3://bucket/original.pdf',
        pipelineVersion: 1,
        pageStart: 1,
        pageEnd: 50,
        previousFilepath: 'https://cdn.example/old.pdf',
        filepath: 'https://cdn.example/fresh.pdf',
      }),
    ).resolves.toBe('https://cdn.example/winner.pdf');
    expect(findOne).toHaveBeenCalledWith({
      sourcePdfKey: 's3://bucket/original.pdf',
      pipelineVersion: 1,
      pageStart: 1,
      pageEnd: 50,
    });
  });

  it('fails closed when compare-and-set cannot find the canonical row', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
    const lean = jest.fn(async () => null);
    const findOne = jest.fn(() => ({ lean }));
    createArtifactModel.mockReturnValueOnce({ updateOne, findOne } as never);
    const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);

    await expect(
      repository.compareAndSetArtifactFilepath?.({
        sourcePdfKey: 's3://bucket/original.pdf',
        pipelineVersion: 1,
        pageStart: 1,
        pageEnd: 50,
        previousFilepath: 'https://cdn.example/old.pdf',
        filepath: 'https://cdn.example/fresh.pdf',
      }),
    ).rejects.toThrow('Missing OCR artifact row');
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

  it('parses S3 and CloudFront signed URL expiry with an inclusive six-hour boundary', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const s3Date = '20260101T000000Z';
    const s3Url = `https://s3.example/chunk.pdf?X-Amz-Date=${s3Date}&X-Amz-Expires=21600`;
    const cloudFrontUrl = `https://cdn.example/chunk.pdf?Expires=${now / 1000 + 21600}`;

    expect(getSignedUrlRemainingValiditySeconds(s3Url, now)).toBe(21600);
    expect(hasSufficientOcrPdfChunkArtifactUrlValidity(s3Url, now)).toBe(true);
    expect(hasSufficientOcrPdfChunkArtifactUrlValidity(cloudFrontUrl, now)).toBe(true);
    expect(
      isUsableOcrPdfChunkArtifactUrl(
        `http://cdn.example/chunk.pdf?Expires=${now / 1000 + 21600}`,
        'chunk.pdf',
        now,
      ),
    ).toBe(false);
    expect(
      hasSufficientOcrPdfChunkArtifactUrlValidity(
        `https://cdn.example/chunk.pdf?Expires=${now / 1000 + 21599}`,
        now,
      ),
    ).toBe(false);
  });

  it('parses CloudFront custom policy expiry and rejects malformed policies', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const policy = Buffer.from(
      JSON.stringify({ Statement: [{ Condition: { DateLessThan: { 'AWS:EpochTime': now / 1000 + 21600 } } }] }),
    ).toString('base64url');

    expect(
      getSignedUrlRemainingValiditySeconds(`https://cdn.example/chunk.pdf?Policy=${policy}`, now),
    ).toBe(21600);
    const policyWithWindow = Buffer.from(
      JSON.stringify({
        Statement: [
          {
            Condition: {
              DateGreaterThan: { 'AWS:EpochTime': now / 1000 - 60 },
              DateLessThan: { 'AWS:EpochTime': now / 1000 + 21600 },
            },
          },
        ],
      }),
    ).toString('base64url');
    expect(
      getSignedUrlRemainingValiditySeconds(
        `https://cdn.example/chunk.pdf?Policy=${policyWithWindow}`,
        now,
      ),
    ).toBe(21600);
    const cloudFrontPolicy = Buffer.from(
      JSON.stringify({
        Statement: [
          {
            Resource: 'https://cdn.example/xx/檔案.pdf',
            Condition: { DateLessThan: { 'AWS:EpochTime': now / 1000 + 21600 } },
          },
        ],
      }),
    )
      .toString('base64')
      .replace(/\+/gu, '-')
      .replace(/=/gu, '_')
      .replace(/\//gu, '~');
    expect(cloudFrontPolicy).toMatch(/[~_]/u);
    expect(
      getSignedUrlRemainingValiditySeconds(
        `https://cdn.example/chunk.pdf?Policy=${cloudFrontPolicy}`,
        now,
      ),
    ).toBe(21600);
    expect(
      hasSufficientOcrPdfChunkArtifactUrlValidity(
        'https://cdn.example/chunk.pdf?Policy=not-base64-json',
        now,
      ),
    ).toBe(false);
    const oversizedPolicy = Buffer.from(
      JSON.stringify({ Statement: [{ Condition: { DateLessThan: { 'AWS:EpochTime': 1e30 } } }] }),
    ).toString('base64url');
    expect(
      getSignedUrlRemainingValiditySeconds(
        `https://cdn.example/chunk.pdf?Policy=${oversizedPolicy}`,
        now,
      ),
    ).toBeUndefined();
    const oversizedValidPolicy = Buffer.from(
      JSON.stringify({
        Statement: [
          {
            Condition: { DateLessThan: { 'AWS:EpochTime': now / 1000 + 21600 } },
            padding: 'x'.repeat(20_000),
          },
        ],
      }),
    ).toString('base64url');
    expect(
      getSignedUrlRemainingValiditySeconds(
        `https://cdn.example/chunk.pdf?Policy=${oversizedValidPolicy}`,
        now,
      ),
    ).toBeUndefined();
    expect(
      getSignedUrlRemainingValiditySeconds(
        'https://s3.example/chunk.pdf?X-Amz-Date=20261301T000000Z&X-Amz-Expires=21600',
        now,
      ),
    ).toBeUndefined();
  });

  it('loads canonical split children directly from existing artifact rows', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const expires = now / 1000 + 21600;
    const row = (
      pageStart: number,
      pageEnd: number,
      supersededByRanges?: Array<{ pageStart: number; pageEnd: number }>,
    ): OcrPdfChunkArtifactRecord => ({
      sourcePdfKey: 'uploads/user/pdf-1.pdf',
      sourceStorageKey: 'uploads/user/pdf-1.pdf',
      sourceFileId: 'pdf-1',
      pipelineVersion: 1,
      chunkIndex: 1,
      chunkCount: 1,
      pageStart,
      pageEnd,
      chunkSizePages: pageEnd - pageStart + 1,
      ...(supersededByRanges ? { supersededByRanges } : {}),
      artifact: {
        source: 's3',
        storageKey: `ocr/pages-${pageStart}-${pageEnd}.pdf`,
        filepath: `https://cdn.example/ocr/pages-${pageStart}-${pageEnd}.pdf?Expires=${expires}`,
        filename: `pages-${pageStart}-${pageEnd}.pdf`,
        bytes: 100,
        contentType: 'application/pdf',
      },
    });
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [
        row(1, 50, [
          { pageStart: 1, pageEnd: 25 },
          { pageStart: 26, pageEnd: 50 },
        ]),
        row(1, 25),
        row(26, 50),
      ]),
      upsert: jest.fn(),
      compareAndSetArtifactFilepath: jest.fn(async ({ filepath }) => filepath),
    };
    const storage = {
      source: 's3' as const,
      exists: jest.fn(async () => true),
      saveBuffer: jest.fn(),
      getDownloadUrl: jest.fn(),
    };

    const artifacts = await loadExistingPdfChunkArtifacts({
      sourcePdfKey: 'uploads/user/pdf-1.pdf',
      sourceStorageKey: 'uploads/user/pdf-1.pdf',
      sourceFileId: 'pdf-1',
      pageRanges: [{ pageStart: 1, pageEnd: 50 }],
      repository,
      storage,
      now,
    });

    expect(artifacts.map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd }))).toEqual([
      { pageStart: 1, pageEnd: 25 },
      { pageStart: 26, pageEnd: 50 },
    ]);
    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('re-signs an expired or mismatched DB URL from the trusted artifact storage key', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const storageKey = 'ocr/pages-1-50.pdf';
    const staleUrl = `https://cdn.example/ocr/wrong.pdf?Expires=${now / 1000 + 21600}`;
    const freshUrl = `https://cdn.example/${storageKey}?Expires=${now / 1000 + 21600}`;
    const record: OcrPdfChunkArtifactRecord = {
      sourcePdfKey: 'uploads/user/pdf-1.pdf',
      sourceStorageKey: 'uploads/user/pdf-1.pdf',
      sourceFileId: 'pdf-1',
      pipelineVersion: 1,
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 50,
      chunkSizePages: 50,
      artifact: {
        source: 's3',
        storageKey,
        filepath: staleUrl,
        filename: 'pages-1-50.pdf',
        bytes: 100,
        contentType: 'application/pdf',
      },
    };
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [record]),
      upsert: jest.fn(),
      compareAndSetArtifactFilepath: jest.fn(async ({ filepath }) => filepath),
    };
    const storage = {
      source: 's3' as const,
      exists: jest.fn(async () => true),
      saveBuffer: jest.fn(),
      getDownloadUrl: jest.fn(async () => freshUrl),
    };

    await expect(
      loadExistingPdfChunkArtifacts({
        sourcePdfKey: record.sourcePdfKey,
        sourceStorageKey: record.sourceStorageKey,
        sourceFileId: record.sourceFileId,
        pageRanges: [{ pageStart: 1, pageEnd: 50 }],
        repository,
        storage,
        now,
      }),
    ).resolves.toEqual([expect.objectContaining({ storageKey, filepath: freshUrl })]);
    expect(storage.getDownloadUrl).toHaveBeenCalledWith({ storageKey });
    expect(repository.compareAndSetArtifactFilepath).toHaveBeenCalledWith({
      sourcePdfKey: record.sourcePdfKey,
      pipelineVersion: 1,
      pageStart: 1,
      pageEnd: 50,
      previousFilepath: staleUrl,
      filepath: freshUrl,
    });
  });

  it('fails closed when the DB artifact object is missing', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const record: OcrPdfChunkArtifactRecord = {
      sourcePdfKey: 'uploads/user/pdf-1.pdf',
      sourceStorageKey: 'uploads/user/pdf-1.pdf',
      sourceFileId: 'pdf-1',
      pipelineVersion: 1,
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 50,
      chunkSizePages: 50,
      artifact: {
        source: 's3',
        storageKey: 'ocr/pages-1-50.pdf',
        filepath: `https://cdn.example/ocr/pages-1-50.pdf?Expires=${now / 1000 + 21600}`,
        filename: 'pages-1-50.pdf',
        bytes: 100,
        contentType: 'application/pdf',
      },
    };
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [record]),
      upsert: jest.fn(),
      compareAndSetArtifactFilepath: jest.fn(async ({ filepath }) => filepath),
    };
    const storage = {
      source: 's3' as const,
      exists: jest.fn(async () => false),
      saveBuffer: jest.fn(),
      getDownloadUrl: jest.fn(),
    };

    await expect(
      loadExistingPdfChunkArtifacts({
        sourcePdfKey: record.sourcePdfKey,
        sourceStorageKey: record.sourceStorageKey,
        sourceFileId: record.sourceFileId,
        pageRanges: [{ pageStart: 1, pageEnd: 50 }],
        repository,
        storage,
        now,
      }),
    ).rejects.toThrow('OCR artifact object is missing for 1:50');
    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('updates reused legacy parent metadata when committing a new partial split', async () => {
    const parentId = new mongoose.Types.ObjectId();
    const legacyParent = {
      _id: parentId,
      sourcePdfKey: 's3://bucket/original.pdf',
      pipelineVersion: 1,
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 15,
      chunkSizePages: 50,
    };
    const lean = jest.fn(async () => [legacyParent]);
    const limit = jest.fn(() => ({ lean }));
    const find = jest.fn(() => ({ limit }));
    const updateOne = jest.fn(async () => ({ modifiedCount: 1 }));
    createArtifactModel.mockReturnValueOnce({ find, updateOne } as never);
    const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);

    await expect(
      repository.compareAndSetSupersededByRanges?.({
        sourcePdfKey: legacyParent.sourcePdfKey,
        pipelineVersion: legacyParent.pipelineVersion,
        parent: { pageStart: 1, pageEnd: 15, chunkSizePages: 24 },
        supersededByRanges: [
          { pageStart: 1, pageEnd: 12 },
          { pageStart: 13, pageEnd: 15 },
        ],
      }),
    ).resolves.toBe('updated');
    expect(updateOne).toHaveBeenCalledWith(
      { _id: parentId, supersededByRanges: { $exists: false } },
      {
        $set: {
          chunkSizePages: 24,
          supersededByRanges: [
            { pageStart: 1, pageEnd: 12 },
            { pageStart: 13, pageEnd: 15 },
          ],
          supersededAt: expect.any(Date),
        },
      },
    );
  });

  it('reuses global artifact rows for the same source PDF key across conversations', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 100, chunkSizePages: 50 });
    const rows = new Map();
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [...rows.values()]),
      upsert: jest.fn(async (artifact) => {
        rows.set(`${artifact.chunkIndex}`, artifact);
      }),
      compareAndSetArtifactFilepath: jest.fn(async ({ filepath }) => filepath),
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

  it('persists a fresh URL before returning a reused artifact', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 });
    const existingRow: OcrPdfChunkArtifactRecord = {
      sourcePdfKey: 's3://bucket/original.pdf',
      pipelineVersion: 1,
      ...chunks[0]!,
      artifact: {
        source: 's3',
        storageKey: 'ocr/pages-1-50.pdf',
        filepath: 'https://cdn.example/old.pdf',
        filename: 'pages-1-50.pdf',
        bytes: 123,
        contentType: 'application/pdf',
      },
    };
    const compareAndSetArtifactFilepath = jest
      .fn()
      .mockResolvedValue('https://cdn.example/fresh.pdf');
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [existingRow]),
      upsert: jest.fn(),
      compareAndSetArtifactFilepath,
    };
    const storage = {
      source: 's3' as const,
      exists: jest.fn().mockResolvedValue(true),
      saveBuffer: jest.fn(),
      getDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example/fresh.pdf'),
    };

    const [artifact] = await ensurePdfChunkArtifacts({
      sourcePdfKey: existingRow.sourcePdfKey,
      chunks,
      repository,
      storage,
      createPdfChunk: jest.fn(),
    });

    expect(compareAndSetArtifactFilepath).toHaveBeenCalledWith({
      sourcePdfKey: existingRow.sourcePdfKey,
      pipelineVersion: existingRow.pipelineVersion,
      pageStart: existingRow.pageStart,
      pageEnd: existingRow.pageEnd,
      previousFilepath: 'https://cdn.example/old.pdf',
      filepath: 'https://cdn.example/fresh.pdf',
    });
    expect(artifact?.filepath).toBe('https://cdn.example/fresh.pdf');
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('reuses a present canonical artifact URL with at least six hours remaining', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const chunks = buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 });
    const filepath = `https://s3.example/chunk.pdf?X-Amz-Date=20260101T000000Z&X-Amz-Expires=21600`;
    const existingRow: OcrPdfChunkArtifactRecord = {
      sourcePdfKey: 's3://bucket/original.pdf',
      pipelineVersion: 1,
      ...chunks[0]!,
      artifact: {
        source: 's3',
        storageKey: 'ocr/pages-1-50.pdf',
        filepath,
        filename: 'pages-1-50.pdf',
        bytes: 123,
        contentType: 'application/pdf',
      },
    };
    const repository = {
      findBySourcePdfKey: jest.fn(async () => [existingRow]),
      upsert: jest.fn(),
      compareAndSetArtifactFilepath: jest.fn(),
    };
    const storage = {
      source: 's3' as const,
      exists: jest.fn().mockResolvedValue(true),
      saveBuffer: jest.fn(),
      getDownloadUrl: jest.fn(),
    };

    const [artifact] = await ensurePdfChunkArtifacts({
      sourcePdfKey: existingRow.sourcePdfKey,
      chunks,
      repository,
      storage,
      createPdfChunk: jest.fn(),
      now,
    });

    expect(artifact?.filepath).toBe(filepath);
    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
    expect(repository.compareAndSetArtifactFilepath).not.toHaveBeenCalled();
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('recreates stored rows whose S3 chunk object is missing', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 });
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
      compareAndSetArtifactFilepath: jest.fn(async ({ filepath }) => filepath),
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
    const defaults = buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 });
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

  it('uses the persisted parent chunk size for partial split markers', () => {
    const parent = {
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 15,
      chunkSizePages: 24,
    };
    expect(
      resolveCanonicalOcrPageChunks({
        defaultChunks: [parent],
        artifactRows: [
          {
            ...parent,
            supersededByRanges: [
              { pageStart: 1, pageEnd: 12 },
              { pageStart: 13, pageEnd: 15 },
            ],
          } as OcrPdfChunkArtifactRecord,
        ],
      }),
    ).toEqual([
      { chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 12, chunkSizePages: 12 },
      { chunkIndex: 2, chunkCount: 2, pageStart: 13, pageEnd: 15, chunkSizePages: 12 },
    ]);
  });

  it('persists both child artifacts before committing the parent split marker', async () => {
    const parent = buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 })[0]!;
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
      compareAndSetArtifactFilepath: jest.fn(async ({ filepath }) => filepath),
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
        defaultChunks: buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 }),
        artifactRows: [
          {
            ...buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 })[0],
            supersededByRanges: [{ pageStart: 1, pageEnd: 25 }],
          } as OcrPdfChunkArtifactRecord,
        ],
      }),
    ).toThrow();
  });
});
