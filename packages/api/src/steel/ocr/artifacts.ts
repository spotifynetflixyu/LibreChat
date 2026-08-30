import { createHash } from 'crypto';
import { createSteelOcrPdfChunkArtifactModel } from '@librechat/data-schemas';

import { ocrPreprocessingPipelineVersion } from '../memory/service';

import {
  getOcrPageRangeKey,
  normalizeOcrPageChunks,
  type OcrPageRange,
  type OcrPreprocessingPageChunk,
  validateExactFiftyPageSplit,
} from './chunks';

type Mongoose = typeof import('mongoose');

export interface OcrPdfChunkArtifactRecord extends OcrPreprocessingPageChunk {
  sourcePdfKey: string;
  sourceStorageKey?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  sourceBytes?: number;
  pipelineVersion: number;
  supersededByRanges?: OcrPageRange[];
  supersededAt?: Date;
  artifact: {
    source: 's3' | 'cloudfront';
    storageKey: string;
    storageRegion?: string;
    filepath: string;
    filename: string;
    bytes: number;
    contentType: 'application/pdf';
  };
}

export interface EnsuredOcrPdfChunkArtifact extends OcrPreprocessingPageChunk {
  sourcePdfKey: string;
  source: 's3' | 'cloudfront';
  storageKey: string;
  storageRegion?: string;
  filepath: string;
  filename: string;
  bytes: number;
  contentType: 'application/pdf';
  artifactOrigin: 'existing' | 'repaired' | 'uploaded';
}

export interface OcrPdfChunkArtifactRepository {
  findBySourcePdfKey(input: {
    sourcePdfKey: string;
    pipelineVersion: number;
    chunkSizePages?: number;
  }): Promise<OcrPdfChunkArtifactRecord[]>;
  upsert(artifact: OcrPdfChunkArtifactRecord): Promise<void>;
  compareAndSetSupersededByRanges?(input: {
    sourcePdfKey: string;
    pipelineVersion: number;
    parent: OcrPageRange;
    supersededByRanges: readonly OcrPageRange[];
  }): Promise<'updated' | 'idempotent'>;
}

export function createMongooseOcrPdfChunkArtifactRepository(
  mongoose: Mongoose,
): OcrPdfChunkArtifactRepository {
  const SteelOcrPdfChunkArtifact = createSteelOcrPdfChunkArtifactModel(mongoose);

  return {
    async findBySourcePdfKey({ sourcePdfKey, pipelineVersion }) {
      return await SteelOcrPdfChunkArtifact.find({
        sourcePdfKey,
        pipelineVersion,
      })
        .sort({ pageStart: 1, pageEnd: 1 })
        .lean<OcrPdfChunkArtifactRecord[]>();
    },
    async upsert(artifact) {
      const rangeIdentity = [
        artifact.sourcePdfKey,
        artifact.pipelineVersion,
        artifact.pageStart,
        artifact.pageEnd,
      ];
      const deterministicId = new mongoose.Types.ObjectId(
        createHash('sha256').update(JSON.stringify(rangeIdentity)).digest('hex').slice(0, 24),
      );
      await SteelOcrPdfChunkArtifact.updateOne(
        { _id: deterministicId },
        { $set: artifact },
        { upsert: true },
      );
    },
    async compareAndSetSupersededByRanges({
      sourcePdfKey,
      pipelineVersion,
      parent,
      supersededByRanges,
    }) {
      const expected = validateExactFiftyPageSplit({ parent, children: supersededByRanges });
      const existingRows = await SteelOcrPdfChunkArtifact.find({
        sourcePdfKey,
        pipelineVersion,
        pageStart: parent.pageStart,
        pageEnd: parent.pageEnd,
      })
        .limit(2)
        .lean<Array<OcrPdfChunkArtifactRecord & { _id: unknown }>>();
      if (existingRows.length !== 1) {
        throw new Error(
          `${existingRows.length === 0 ? 'Missing' : 'Duplicate'} OCR parent artifact row for ${parent.pageStart}-${parent.pageEnd}`,
        );
      }
      const existing = existingRows[0]!;
      if (existing.supersededByRanges) {
        const current = normalizeOcrPageChunks(existing.supersededByRanges).map(
          ({ pageStart, pageEnd }) => ({ pageStart, pageEnd }),
        );
        if (JSON.stringify(current) !== JSON.stringify(expected)) {
          throw new Error(
            `Conflicting OCR split marker for ${parent.pageStart}-${parent.pageEnd}`,
          );
        }
        return 'idempotent';
      }
      const result = await SteelOcrPdfChunkArtifact.updateOne(
        {
          _id: existing._id,
          supersededByRanges: { $exists: false },
        },
        {
          $set: {
            supersededByRanges: expected,
            supersededAt: new Date(),
          },
        },
      );
      if (result.modifiedCount === 1) {
        return 'updated';
      }
      const raced = await SteelOcrPdfChunkArtifact.findOne({
        _id: existing._id,
      }).lean<OcrPdfChunkArtifactRecord | null>();
      if (
        raced?.supersededByRanges &&
        JSON.stringify(
          normalizeOcrPageChunks(raced.supersededByRanges).map(({ pageStart, pageEnd }) => ({
            pageStart,
            pageEnd,
          })),
        ) === JSON.stringify(expected)
      ) {
        return 'idempotent';
      }
      throw new Error(`Conflicting OCR split marker for ${parent.pageStart}-${parent.pageEnd}`);
    },
  };
}

export function resolveCanonicalOcrPageChunks(input: {
  defaultChunks: readonly OcrPreprocessingPageChunk[];
  artifactRows: readonly OcrPdfChunkArtifactRecord[];
}): OcrPreprocessingPageChunk[] {
  let chunks = normalizeOcrPageChunks(input.defaultChunks);
  const rowsByRange = new Map<string, OcrPdfChunkArtifactRecord>();
  for (const row of input.artifactRows) {
    const key = getOcrPageRangeKey(row);
    if (row.supersededByRanges) {
      validateExactFiftyPageSplit({ parent: row, children: row.supersededByRanges });
    }
    const existing = rowsByRange.get(key);
    if (existing) {
      throw new Error(`Duplicate OCR artifact rows for ${row.pageStart}-${row.pageEnd}`);
    }
    rowsByRange.set(key, row);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const next: OcrPreprocessingPageChunk[] = [];
    for (const chunk of chunks) {
      const row = rowsByRange.get(getOcrPageRangeKey(chunk));
      if (!row?.supersededByRanges) {
        next.push(chunk);
        continue;
      }
      const children = validateExactFiftyPageSplit({
        parent: chunk,
        children: row.supersededByRanges,
      });
      next.push(...children.map((child) => ({ ...child, chunkIndex: 1, chunkCount: 2 })));
      changed = true;
    }
    chunks = normalizeOcrPageChunks(next);
  }
  return chunks;
}

export interface OcrPdfChunkArtifactStorage {
  source: 's3' | 'cloudfront';
  exists(input: { storageKey: string }): Promise<boolean>;
  saveBuffer(input: {
    storageKey: string;
    filename: string;
    bytes: Uint8Array;
    contentType: 'application/pdf';
  }): Promise<{ bytes: number; storageRegion?: string }>;
  getDownloadUrl(input: { storageKey: string }): Promise<string>;
}

export interface EnsurePdfChunkArtifactsInput {
  sourcePdfKey: string;
  sourceStorageKey?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  sourceBytes?: number;
  chunks: readonly OcrPreprocessingPageChunk[];
  repository: OcrPdfChunkArtifactRepository;
  storage: OcrPdfChunkArtifactStorage;
  createPdfChunk(input: { chunk: OcrPreprocessingPageChunk }): Promise<Uint8Array>;
}

export interface CommitOcrPdfChunkSplitInput extends EnsurePdfChunkArtifactsInput {
  parent: OcrPageRange;
  children: readonly OcrPageRange[];
}

export function buildOcrPdfChunkArtifactStorageKey(input: {
  sourcePdfKey: string;
  pipelineVersion?: number;
  chunk: Pick<OcrPreprocessingPageChunk, 'pageStart' | 'pageEnd'>;
}): string {
  const pipelineVersion = input.pipelineVersion ?? ocrPreprocessingPipelineVersion;
  const sourceHash = createHash('sha256').update(input.sourcePdfKey).digest('hex');
  const pageStart = String(input.chunk.pageStart).padStart(6, '0');
  const pageEnd = String(input.chunk.pageEnd).padStart(6, '0');

  return `ocr-preprocessing/${sourceHash}/v${pipelineVersion}/pages-${pageStart}-${pageEnd}.pdf`;
}

export async function ensurePdfChunkArtifacts(
  input: EnsurePdfChunkArtifactsInput,
): Promise<EnsuredOcrPdfChunkArtifact[]> {
  const pipelineVersion = ocrPreprocessingPipelineVersion;
  const existingRows = await input.repository.findBySourcePdfKey({
    sourcePdfKey: input.sourcePdfKey,
    pipelineVersion,
  });
  const chunks = resolveCanonicalOcrPageChunks({
    defaultChunks: input.chunks,
    artifactRows: existingRows,
  });
  const existingByIdentity = new Map(
    existingRows.map((row) => [
      getOcrPageRangeKey(row),
      row,
    ]),
  );
  const artifacts: EnsuredOcrPdfChunkArtifact[] = [];

  for (const chunk of chunks) {
    const existing = existingByIdentity.get(getOcrPageRangeKey(chunk));
    if (existing) {
      const existingObjectIsPresent = await input.storage.exists({
        storageKey: existing.artifact.storageKey,
      });
      if (existingObjectIsPresent) {
        artifacts.push({
          sourcePdfKey: existing.sourcePdfKey,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          chunkSizePages: chunk.chunkSizePages,
          source: existing.artifact.source,
          storageKey: existing.artifact.storageKey,
          storageRegion: existing.artifact.storageRegion,
          filepath: await input.storage.getDownloadUrl({
            storageKey: existing.artifact.storageKey,
          }),
          filename: existing.artifact.filename,
          bytes: existing.artifact.bytes,
          contentType: existing.artifact.contentType,
          artifactOrigin: 'existing',
        });
        continue;
      }
    }

    const storageKey =
      existing?.artifact.storageKey ??
      buildOcrPdfChunkArtifactStorageKey({
        sourcePdfKey: input.sourcePdfKey,
        pipelineVersion,
        chunk,
      });
    const filename = existing?.artifact.filename ?? buildChunkFilename(input.sourceFilename, chunk);
    const objectExists = existing ? false : await input.storage.exists({ storageKey });
    const chunkBytes = objectExists ? undefined : await input.createPdfChunk({ chunk });
    const saved = objectExists
      ? { bytes: 0, storageRegion: undefined }
      : await input.storage.saveBuffer({
          storageKey,
          filename,
          bytes: chunkBytes ?? new Uint8Array(),
          contentType: 'application/pdf',
        });
    const filepath = await input.storage.getDownloadUrl({ storageKey });
    const artifact: OcrPdfChunkArtifactRecord = {
      sourcePdfKey: input.sourcePdfKey,
      sourceStorageKey: input.sourceStorageKey,
      sourceFileId: input.sourceFileId,
      sourceFilename: input.sourceFilename,
      sourceBytes: input.sourceBytes,
      pipelineVersion,
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      chunkSizePages: chunk.chunkSizePages,
      artifact: {
        source: input.storage.source,
        storageKey,
        storageRegion: saved.storageRegion,
        filepath,
        filename,
        bytes: saved.bytes,
        contentType: 'application/pdf',
      },
    };

    await input.repository.upsert(artifact);
    artifacts.push({
      sourcePdfKey: artifact.sourcePdfKey,
      chunkIndex: artifact.chunkIndex,
      chunkCount: artifact.chunkCount,
      pageStart: artifact.pageStart,
      pageEnd: artifact.pageEnd,
      chunkSizePages: artifact.chunkSizePages,
      source: artifact.artifact.source,
      storageKey: artifact.artifact.storageKey,
      storageRegion: artifact.artifact.storageRegion,
      filepath: artifact.artifact.filepath,
      filename: artifact.artifact.filename,
      bytes: artifact.artifact.bytes,
      contentType: artifact.artifact.contentType,
      artifactOrigin: objectExists ? 'repaired' : 'uploaded',
    });
  }

  return artifacts.sort((left, right) => left.pageStart - right.pageStart || left.pageEnd - right.pageEnd);
}

export async function commitOcrPdfChunkSplit(
  input: CommitOcrPdfChunkSplitInput,
): Promise<EnsuredOcrPdfChunkArtifact[]> {
  const children = validateExactFiftyPageSplit({
    parent: input.parent,
    children: input.children,
  });
  const artifacts = await ensurePdfChunkArtifacts({
    ...input,
    chunks: input.chunks,
  });
  const childKeys = new Set(children.map(getOcrPageRangeKey));
  const childArtifacts = artifacts.filter((artifact) => childKeys.has(getOcrPageRangeKey(artifact)));
  if (childArtifacts.length !== children.length) {
    throw new Error('OCR split child artifacts could not be addressed after upload');
  }
  if (!input.repository.compareAndSetSupersededByRanges) {
    throw new Error('OCR artifact repository cannot commit split markers');
  }
  await input.repository.compareAndSetSupersededByRanges({
    sourcePdfKey: input.sourcePdfKey,
    pipelineVersion: ocrPreprocessingPipelineVersion,
    parent: input.parent,
    supersededByRanges: children,
  });
  return artifacts;
}

function buildChunkFilename(
  sourceFilename: string | undefined,
  chunk: Pick<OcrPreprocessingPageChunk, 'pageStart' | 'pageEnd'>,
): string {
  const baseName = sourceFilename?.replace(/\.pdf$/iu, '') || 'document';
  const pageStart = String(chunk.pageStart).padStart(6, '0');
  const pageEnd = String(chunk.pageEnd).padStart(6, '0');

  return `${baseName}.pages-${pageStart}-${pageEnd}.pdf`;
}
