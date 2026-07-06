import { createHash } from 'crypto';
import { createSteelOcrPdfChunkArtifactModel } from '@librechat/data-schemas';

import { ocrPreprocessingPipelineVersion } from '../memory/service';
import { resolveOcrPreprocessingChunkSizePages } from './config';

import type { OcrPreprocessingPageChunk } from './chunks';

type Mongoose = typeof import('mongoose');

export interface OcrPdfChunkArtifactRecord extends OcrPreprocessingPageChunk {
  sourcePdfKey: string;
  sourceStorageKey?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  sourceBytes?: number;
  pipelineVersion: number;
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
    chunkSizePages: number;
  }): Promise<OcrPdfChunkArtifactRecord[]>;
  upsert(artifact: OcrPdfChunkArtifactRecord): Promise<void>;
}

export function createMongooseOcrPdfChunkArtifactRepository(
  mongoose: Mongoose,
): OcrPdfChunkArtifactRepository {
  const SteelOcrPdfChunkArtifact = createSteelOcrPdfChunkArtifactModel(mongoose);

  return {
    async findBySourcePdfKey({ sourcePdfKey, pipelineVersion, chunkSizePages }) {
      return await SteelOcrPdfChunkArtifact.find({
        sourcePdfKey,
        pipelineVersion,
        chunkSizePages,
      })
        .sort({ chunkIndex: 1 })
        .lean<OcrPdfChunkArtifactRecord[]>();
    },
    async upsert(artifact) {
      await SteelOcrPdfChunkArtifact.updateOne(
        {
          sourcePdfKey: artifact.sourcePdfKey,
          pipelineVersion: artifact.pipelineVersion,
          chunkSizePages: artifact.chunkSizePages,
          chunkIndex: artifact.chunkIndex,
          pageStart: artifact.pageStart,
          pageEnd: artifact.pageEnd,
        },
        { $set: artifact },
        { upsert: true },
      );
    },
  };
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
  const firstChunk = input.chunks[0];
  const pipelineVersion = ocrPreprocessingPipelineVersion;
  const chunkSizePages = firstChunk?.chunkSizePages ?? resolveOcrPreprocessingChunkSizePages();
  const existingRows = await input.repository.findBySourcePdfKey({
    sourcePdfKey: input.sourcePdfKey,
    pipelineVersion,
    chunkSizePages,
  });
  const existingByChunkIndex = new Map(existingRows.map((row) => [row.chunkIndex, row]));
  const artifacts: EnsuredOcrPdfChunkArtifact[] = [];

  for (const chunk of input.chunks) {
    const existing = existingByChunkIndex.get(chunk.chunkIndex);
    if (existing) {
      const existingObjectIsPresent = await input.storage.exists({
        storageKey: existing.artifact.storageKey,
      });
      if (existingObjectIsPresent) {
        artifacts.push({
          sourcePdfKey: existing.sourcePdfKey,
          chunkIndex: existing.chunkIndex,
          chunkCount: existing.chunkCount,
          pageStart: existing.pageStart,
          pageEnd: existing.pageEnd,
          chunkSizePages: existing.chunkSizePages,
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

  return artifacts.sort((left, right) => left.chunkIndex - right.chunkIndex);
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
