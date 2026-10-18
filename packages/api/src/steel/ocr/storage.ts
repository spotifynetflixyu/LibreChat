import mongoose from 'mongoose';
import { FileSources } from 'librechat-data-provider';
import type {
  OcrPdfChunkArtifactRecord,
  OcrPdfChunkArtifactStorage,
  OcrPdfChunkArtifactRepository,
} from './artifacts';
import type { OcrPdfChunkArtifact, OcrPreprocessingArtifactStore } from './preprocess';
import type { OcrPageRange, OcrPreprocessingPageChunk } from './chunks';
import type { SteelOcrFile, SteelOcrPreprocessingSourceFile } from './files';
import {
  commitOcrPdfChunkSplit,
  ensurePdfChunkArtifacts,
  loadExistingPdfChunkArtifacts,
  isUsableOcrPdfChunkArtifactUrl,
  resolveCanonicalOcrPageChunks,
  createMongooseOcrPdfChunkArtifactRepository,
  hasSufficientOcrPdfChunkArtifactUrlValidity,
} from './artifacts';
import {
  getS3DownloadURLForKey,
  s3ObjectExistsByKey,
  saveBufferToS3StorageKey,
} from '~/storage/s3/crud';
import {
  cloudFrontObjectExistsByKey,
  getCloudFrontDownloadURLForKey,
  saveBufferToCloudFrontStorageKey,
} from '~/storage/cloudfront/crud';
import { ocrPreprocessingPipelineVersion } from '../memory/service';
import { createPdfPageRangeChunker } from './chunks';
import { isHttpUrl } from './files';

/** A stored file record as OCR artifact storage reads it. */
export interface SteelOcrStoredFileRecord {
  file_id?: string;
  filename?: string;
  filepath?: string;
  storageKey?: string;
  source?: string;
  type?: string;
  mimetype?: string;
  bytes?: number;
}

/** An OCR input artifact: a PDF range split from the original, or the original file itself. */
export interface SteelOcrStoredArtifact extends OcrPdfChunkArtifact {
  sourcePdfKey?: string;
  filename?: string;
  bytes?: number;
  contentType?: string;
}

/** An artifact store that can also load the PDF range artifacts already split from the original. */
export interface SteelOcrPdfChunkArtifactStore extends OcrPreprocessingArtifactStore {
  loadExistingPdfChunkArtifacts(input: {
    sourcePdfKey: string;
    pageRanges: readonly OcrPageRange[];
  }): Promise<SteelOcrStoredArtifact[]>;
  refreshPdfChunkArtifact(input: {
    file: SteelOcrPreprocessingSourceFile;
    chunk: OcrPreprocessingPageChunk;
    artifact: SteelOcrStoredArtifact;
  }): Promise<SteelOcrStoredArtifact>;
}

type SteelOcrOriginalFileArtifactStore = OcrPreprocessingArtifactStore &
  Required<Pick<OcrPreprocessingArtifactStore, 'refreshPdfChunkArtifact'>>;

type ArtifactSource = OcrPdfChunkArtifactStorage['source'];

function getSteelOcrArtifactSource(
  fileRecord: SteelOcrStoredFileRecord | undefined,
): ArtifactSource {
  return fileRecord?.source === FileSources.cloudfront ? 'cloudfront' : 's3';
}

function getSteelOcrContentType(
  file: SteelOcrFile | undefined,
  fileRecord: SteelOcrStoredFileRecord | undefined,
): string {
  return (
    file?.mediaType ??
    file?.mimeType ??
    file?.mimetype ??
    file?.type ??
    fileRecord?.type ??
    fileRecord?.mimetype ??
    'application/octet-stream'
  );
}

function withArtifactSource<T extends { source?: ArtifactSource }>(
  artifacts: readonly T[],
  fileRecord: SteelOcrStoredFileRecord | undefined,
): T[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    source: artifact.source ?? getSteelOcrArtifactSource(fileRecord),
  }));
}

/** S3 or CloudFront object storage for OCR artifacts, following the source file's storage. */
export function createSteelOcrPdfChunkStorage({
  fileRecord,
  contentType = 'application/pdf',
}: {
  fileRecord?: SteelOcrStoredFileRecord;
  contentType?: string;
}): OcrPdfChunkArtifactStorage {
  const source = getSteelOcrArtifactSource(fileRecord);
  const cloudfront = source === 'cloudfront';
  const existsByKey = cloudfront ? cloudFrontObjectExistsByKey : s3ObjectExistsByKey;
  const saveByKey = cloudfront ? saveBufferToCloudFrontStorageKey : saveBufferToS3StorageKey;
  const getDownloadUrl = cloudfront ? getCloudFrontDownloadURLForKey : getS3DownloadURLForKey;

  return {
    source,
    async exists({ storageKey }) {
      return (await existsByKey({ storageKey })).exists;
    },
    async saveBuffer({ storageKey, bytes, contentType: bufferContentType }) {
      const result = await saveByKey({
        storageKey,
        buffer: Buffer.from(bytes),
        contentType: bufferContentType,
      });
      return {
        bytes: result.bytes,
        ...(result.storageRegion ? { storageRegion: result.storageRegion } : {}),
      };
    },
    getDownloadUrl: ({ storageKey }) => getDownloadUrl({ storageKey, contentType }),
  };
}

/** Re-signs an artifact URL; range artifacts persist it with a compare-and-set on the old URL. */
export async function refreshSteelOcrPdfChunkArtifact<T extends SteelOcrStoredArtifact>({
  artifact,
  storage,
  repository,
  file,
  chunk,
  validateUrl = false,
}: {
  artifact: T;
  storage: OcrPdfChunkArtifactStorage;
  repository?: OcrPdfChunkArtifactRepository;
  file?: Pick<SteelOcrPreprocessingSourceFile, 'sourcePdfKey'>;
  chunk?: OcrPageRange;
  validateUrl?: boolean;
}): Promise<T> {
  if (!artifact.storageKey || isHttpUrl(artifact.storageKey)) {
    return artifact;
  }
  const filepath = await storage.getDownloadUrl({ storageKey: artifact.storageKey });
  if (validateUrl && !isUsableOcrPdfChunkArtifactUrl(filepath, artifact.storageKey)) {
    throw new Error(
      `OCR artifact signer returned an invalid URL for pages ${chunk?.pageStart}-${chunk?.pageEnd}`,
    );
  }
  const sourcePdfKey = artifact.sourcePdfKey ?? file?.sourcePdfKey;
  const persistedFilepath =
    repository &&
    sourcePdfKey &&
    chunk &&
    Number.isInteger(chunk.pageStart) &&
    Number.isInteger(chunk.pageEnd)
      ? await repository.compareAndSetArtifactFilepath({
          sourcePdfKey,
          pipelineVersion: ocrPreprocessingPipelineVersion,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          previousFilepath: artifact.filepath,
          filepath,
        })
      : filepath;
  if (validateUrl && !isUsableOcrPdfChunkArtifactUrl(persistedFilepath, artifact.storageKey)) {
    throw new Error(`OCR artifact URL is invalid for pages ${chunk?.pageStart}-${chunk?.pageEnd}`);
  }
  return { ...artifact, filepath: persistedFilepath };
}

function isSingleOriginalPdfChunk(chunks: readonly OcrPreprocessingPageChunk[]): boolean {
  const chunk = chunks[0];
  return (
    chunks.length === 1 &&
    chunk?.chunkIndex === 1 &&
    chunk.chunkCount === 1 &&
    chunk.pageStart === 1 &&
    chunk.pageEnd >= chunk.pageStart &&
    chunk.pageEnd - chunk.pageStart + 1 !== 50
  );
}

async function createOriginalPdfChunkArtifact({
  file,
  fileRecord,
  storage,
  chunks,
  sourcePdfKey = file.sourcePdfKey,
}: {
  file: SteelOcrPreprocessingSourceFile;
  fileRecord?: SteelOcrStoredFileRecord;
  storage: OcrPdfChunkArtifactStorage;
  chunks: readonly OcrPreprocessingPageChunk[];
  sourcePdfKey?: string;
}): Promise<SteelOcrStoredArtifact | undefined> {
  const chunk = chunks[0];
  const storageKey = fileRecord?.storageKey ?? file.storageKey;
  let filepath: string | undefined;
  if (storageKey) {
    filepath = await storage.getDownloadUrl({ storageKey });
  } else if (isHttpUrl(fileRecord?.filepath)) {
    filepath = fileRecord.filepath;
  } else if (isHttpUrl(file.filepath)) {
    filepath = file.filepath;
  }
  if (!chunk || !filepath) {
    return undefined;
  }

  return {
    ...chunk,
    sourcePdfKey,
    source: getSteelOcrArtifactSource(fileRecord),
    storageKey: storageKey ?? filepath,
    filepath,
    filename: file.filename ?? fileRecord?.filename ?? 'source.pdf',
    bytes: fileRecord?.bytes ?? 0,
    contentType: getSteelOcrContentType(file, fileRecord),
    artifactOrigin: 'original',
  };
}

async function persistOriginalPdfChunkArtifact({
  artifact,
  file,
  fileRecord,
  repository,
}: {
  artifact: SteelOcrStoredArtifact;
  file: SteelOcrPreprocessingSourceFile;
  fileRecord?: SteelOcrStoredFileRecord;
  repository: OcrPdfChunkArtifactRepository;
}): Promise<void> {
  if (!artifact.storageKey || isHttpUrl(artifact.storageKey) || !artifact.sourcePdfKey) {
    return;
  }
  await repository.upsert({
    sourcePdfKey: artifact.sourcePdfKey,
    sourceStorageKey: fileRecord?.storageKey,
    sourceFileId: file.fileId,
    sourceFilename: file.filename,
    sourceBytes: fileRecord?.bytes,
    pipelineVersion: ocrPreprocessingPipelineVersion,
    chunkIndex: artifact.chunkIndex,
    chunkCount: artifact.chunkCount,
    pageStart: artifact.pageStart,
    pageEnd: artifact.pageEnd,
    chunkSizePages: artifact.chunkSizePages,
    artifact: {
      source: artifact.source ?? 's3',
      storageKey: artifact.storageKey,
      filepath: artifact.filepath,
      filename: artifact.filename ?? 'source.pdf',
      bytes: artifact.bytes ?? 0,
      contentType: 'application/pdf',
    },
  });
}

function mapCanonicalOriginalPdfChunkArtifact({
  row,
  chunk,
  filepath = row.artifact.filepath,
}: {
  row: OcrPdfChunkArtifactRecord;
  chunk: OcrPreprocessingPageChunk;
  filepath?: string;
}): SteelOcrStoredArtifact {
  return {
    ...chunk,
    sourcePdfKey: row.sourcePdfKey,
    source: row.artifact.source,
    storageKey: row.artifact.storageKey,
    storageRegion: row.artifact.storageRegion,
    filepath,
    filename: row.artifact.filename,
    bytes: row.artifact.bytes,
    contentType: row.artifact.contentType,
    artifactOrigin: 'original',
  };
}

/**
 * The PDF range artifact store for one source PDF: reuses canonical ranges,
 * keeps a short PDF as its original object, and splits and uploads ranges on demand.
 */
export function createSteelOcrPdfChunkArtifactStore({
  file,
  fileRecord,
  pdfBytes,
  forceSplit = false,
}: {
  file: SteelOcrPreprocessingSourceFile;
  fileRecord?: SteelOcrStoredFileRecord;
  pdfBytes?: Uint8Array;
  forceSplit?: boolean;
}): SteelOcrPdfChunkArtifactStore {
  const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);
  const storage = createSteelOcrPdfChunkStorage({ fileRecord });
  let createPdfChunkPromise: ReturnType<typeof createPdfPageRangeChunker> | undefined;
  const createPdfChunk = async ({ chunk }: { chunk: OcrPageRange }) => {
    if (!pdfBytes) {
      throw new Error(`OCR source PDF bytes are unavailable for ${file.ocrFileKey}`);
    }
    createPdfChunkPromise ??= createPdfPageRangeChunker({ pdfBytes });
    return (await createPdfChunkPromise)({ pageStart: chunk.pageStart, pageEnd: chunk.pageEnd });
  };
  const sourceIdentity = {
    sourceStorageKey: fileRecord?.storageKey,
    sourceFileId: file.fileId,
    sourceFilename: file.filename,
    sourceBytes: fileRecord?.bytes,
  };

  return {
    async loadExistingPdfChunkArtifacts({ sourcePdfKey, pageRanges }) {
      const artifacts = await loadExistingPdfChunkArtifacts({
        sourcePdfKey,
        sourceStorageKey: fileRecord?.storageKey,
        sourceFileId: file.fileId,
        pageRanges,
        repository,
        storage,
      });
      return withArtifactSource(artifacts, fileRecord);
    },
    async resolveCanonicalChunks({ sourcePdfKey, chunks }) {
      const rows = await repository.findBySourcePdfKey({
        sourcePdfKey,
        pipelineVersion: ocrPreprocessingPipelineVersion,
      });
      return resolveCanonicalOcrPageChunks({ defaultChunks: chunks, artifactRows: rows });
    },
    async ensurePdfChunkArtifacts({ sourcePdfKey, chunks }) {
      if (!forceSplit && isSingleOriginalPdfChunk(chunks)) {
        const originalChunk = chunks[0];
        const existingRows = await repository.findBySourcePdfKey({
          sourcePdfKey,
          pipelineVersion: ocrPreprocessingPipelineVersion,
        });
        const existing = existingRows.find(
          (row) =>
            row.pageStart === originalChunk.pageStart && row.pageEnd === originalChunk.pageEnd,
        );
        if (existing) {
          if (!(await storage.exists({ storageKey: existing.artifact.storageKey }))) {
            throw new Error(
              `OCR canonical original PDF object is missing for pages ${originalChunk.pageStart}-${originalChunk.pageEnd}`,
            );
          }
          if (hasSufficientOcrPdfChunkArtifactUrlValidity(existing.artifact.filepath)) {
            return [mapCanonicalOriginalPdfChunkArtifact({ row: existing, chunk: originalChunk })];
          }
          const filepath = await storage.getDownloadUrl({
            storageKey: existing.artifact.storageKey,
          });
          const persistedFilepath = await repository.compareAndSetArtifactFilepath({
            sourcePdfKey: existing.sourcePdfKey,
            pipelineVersion: existing.pipelineVersion,
            pageStart: existing.pageStart,
            pageEnd: existing.pageEnd,
            previousFilepath: existing.artifact.filepath,
            filepath,
          });
          return [
            mapCanonicalOriginalPdfChunkArtifact({
              row: existing,
              chunk: originalChunk,
              filepath: persistedFilepath,
            }),
          ];
        }
        const originalArtifact = await createOriginalPdfChunkArtifact({
          file,
          fileRecord,
          storage,
          chunks,
          sourcePdfKey,
        });
        if (originalArtifact) {
          await persistOriginalPdfChunkArtifact({
            artifact: originalArtifact,
            file,
            fileRecord,
            repository,
          });
          return [originalArtifact];
        }
      }

      const artifacts = await ensurePdfChunkArtifacts({
        sourcePdfKey,
        ...sourceIdentity,
        chunks,
        repository,
        storage,
        createPdfChunk,
      });
      return withArtifactSource(artifacts, fileRecord);
    },
    async commitPdfChunkSplit({ sourcePdfKey, parent, children, chunks }) {
      const artifacts = await commitOcrPdfChunkSplit({
        sourcePdfKey,
        ...sourceIdentity,
        parent,
        children,
        chunks,
        repository,
        storage,
        createPdfChunk,
      });
      return withArtifactSource(artifacts, fileRecord);
    },
    refreshPdfChunkArtifact: ({ artifact, chunk }) =>
      refreshSteelOcrPdfChunkArtifact({
        artifact,
        storage,
        repository,
        file,
        chunk,
        validateUrl: true,
      }),
  };
}

/** The artifact store for a file OCR reads whole: images and reused single-chunk sources. */
export function createSteelOcrOriginalFileArtifactStore({
  file,
  fileRecord,
}: {
  file: SteelOcrPreprocessingSourceFile;
  fileRecord?: SteelOcrStoredFileRecord;
}): SteelOcrOriginalFileArtifactStore {
  const storage = createSteelOcrPdfChunkStorage({
    fileRecord,
    contentType: getSteelOcrContentType(file, fileRecord),
  });

  return {
    async ensurePdfChunkArtifacts({ chunks }) {
      const originalArtifact = await createOriginalPdfChunkArtifact({
        file,
        fileRecord,
        storage,
        chunks,
      });
      if (!originalArtifact) {
        throw new Error(`No OCR input URL available for ${file.filename ?? file.ocrFileKey}`);
      }
      return [originalArtifact];
    },
    refreshPdfChunkArtifact: ({ artifact }) =>
      refreshSteelOcrPdfChunkArtifact({ artifact, storage }),
  };
}
