import { getSavedOcrPreprocessingChunkMarkdowns, mergeChunkMarkdownForFileKey } from './merge';

import type {
  CaptureOcrPreprocessingChunkMarkdownInput,
  CapturePaddleOcrChunkResultInput,
  CaptureToolResultResult,
  OcrPreprocessingState,
  OcrPreprocessingStateInput,
  SteelOcrFileReference,
} from '../memory/service';
import {
  getOcrPageRangeKey,
  normalizeOcrPageChunks,
  splitExactFiftyPageRange,
  type OcrPageRange,
  type OcrPreprocessingPageChunk,
} from './chunks';
import { normalizeOcrOrganizerFileKey } from './organizer';
import type { OcrOrganizer } from './organizer';

export interface OcrPreprocessingFile extends SteelOcrFileReference {
  ocrFileKey: string;
  sourcePdfKey: string;
}

export interface OcrPdfChunkArtifact extends OcrPreprocessingPageChunk {
  filepath: string;
  storageKey: string;
  storageRegion?: string;
  source?: 's3' | 'cloudfront';
  artifactOrigin?: 'existing' | 'repaired' | 'uploaded' | 'original';
}

export interface OcrPreprocessingArtifactStore {
  resolveCanonicalChunks?(input: {
    sourcePdfKey: string;
    chunks: readonly OcrPreprocessingPageChunk[];
  }): Promise<OcrPreprocessingPageChunk[]>;
  ensurePdfChunkArtifacts(input: {
    file: OcrPreprocessingFile;
    sourcePdfKey: string;
    chunks: readonly OcrPreprocessingPageChunk[];
  }): Promise<OcrPdfChunkArtifact[]>;
  commitPdfChunkSplit?(input: {
    file: OcrPreprocessingFile;
    sourcePdfKey: string;
    parent: OcrPreprocessingPageChunk;
    children: readonly OcrPreprocessingPageChunk[];
    chunks: readonly OcrPreprocessingPageChunk[];
  }): Promise<OcrPdfChunkArtifact[]>;
  refreshPdfChunkArtifact?(input: {
    file: OcrPreprocessingFile;
    chunk: OcrPreprocessingPageChunk;
    artifact: OcrPdfChunkArtifact;
  }): Promise<OcrPdfChunkArtifact>;
}

export interface PaddleOcrChunkRunResult {
  rawResult: unknown;
  rawOcrText: string;
  rawResultHash: string;
}

export interface PaddleOcrChunkRunner {
  runChunk(input: {
    file: OcrPreprocessingFile;
    chunk: OcrPreprocessingPageChunk;
    artifact: OcrPdfChunkArtifact;
  }): Promise<PaddleOcrChunkRunResult>;
}

export interface OcrPreprocessingMemoryStore {
  readOcrPreprocessingState(input: OcrPreprocessingStateInput): Promise<OcrPreprocessingState>;
  capturePaddleOcrChunkResult(
    input: CapturePaddleOcrChunkResultInput,
  ): Promise<CaptureToolResultResult>;
  captureOcrPreprocessingChunkMarkdown(
    input: CaptureOcrPreprocessingChunkMarkdownInput,
  ): Promise<CaptureToolResultResult>;
}

export interface RunOcrPreprocessingPipelineResult {
  status: 'ready' | 'completed';
  markdown: string;
  chunkCount: number;
  pageRanges: OcrPageRange[];
}

export type OcrPreprocessingFailureStage =
  | 'state'
  | 'artifacts'
  | 'paddleocr'
  | 'organizer'
  | 'merge';

export interface OcrPreprocessingFailure {
  stage: OcrPreprocessingFailureStage;
  chunkIndex?: number;
  pageStart?: number;
  pageEnd?: number;
  errorMessage: string;
}

export interface RunOcrPreprocessingFailedFileResult extends OcrPreprocessingFailure {
  file: OcrPreprocessingFile;
  status: 'failed';
  failures: OcrPreprocessingFailure[];
}

export interface RunOcrPreprocessingBatchFileInput {
  file: OcrPreprocessingFile;
  chunks: readonly OcrPreprocessingPageChunk[];
  artifacts: OcrPreprocessingArtifactStore;
}

export interface RunOcrPreprocessingReadyFileResult extends RunOcrPreprocessingPipelineResult {
  file: OcrPreprocessingFile;
}

export type RunOcrPreprocessingBatchFileResult =
  | RunOcrPreprocessingReadyFileResult
  | RunOcrPreprocessingFailedFileResult;

export interface RunOcrPreprocessingBatchPipelineResult {
  files: RunOcrPreprocessingBatchFileResult[];
}

export type OcrPreprocessingPipelineProgress =
  | {
      stage: 'pdf_chunks_ready';
      pageCount: number;
      chunkCount: number;
      source: 'fetched' | 'uploaded';
    }
  | { stage: 'paddleocr_chunk_started'; chunkIndex: number; chunkCount: number }
  | { stage: 'paddleocr_chunk_saved'; chunkIndex: number; chunkCount: number }
  | { stage: 'organizer_chunk_started'; chunkIndex: number; chunkCount: number }
  | { stage: 'organizer_chunk_saved'; chunkIndex: number; chunkCount: number }
  | { stage: 'merged_markdowns_read'; chunkCount: number }
  | { stage: 'processing_with_merged_markdown'; chunkCount: number };

type OcrPreprocessingProgressHandler = (
  progress: OcrPreprocessingPipelineProgress,
) => Promise<void> | void;

type OcrPreprocessingBatchProgressHandler = (input: {
  file: OcrPreprocessingFile;
  progress: OcrPreprocessingPipelineProgress;
}) => Promise<void> | void;

export interface RunOcrPreprocessingPipelineInput {
  conversationId: string;
  file: OcrPreprocessingFile;
  ocrRuleVersion: string;
  ocrRulesText: string;
  chunks: readonly OcrPreprocessingPageChunk[];
  artifacts: OcrPreprocessingArtifactStore;
  memory: OcrPreprocessingMemoryStore;
  organizer: OcrOrganizer;
  paddleOcr: PaddleOcrChunkRunner;
  requestId?: string;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  onProgress?: OcrPreprocessingProgressHandler;
}

export interface RunOcrPreprocessingBatchPipelineInput {
  conversationId: string;
  ocrRuleVersion: string;
  ocrRulesText: string;
  files: readonly RunOcrPreprocessingBatchFileInput[];
  memory: OcrPreprocessingMemoryStore;
  organizer: OcrOrganizer;
  paddleOcr: PaddleOcrChunkRunner;
  requestId?: string;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  onProgress?: OcrPreprocessingBatchProgressHandler;
}

interface OcrPreprocessingBatchWorkItem {
  index: number;
  file: OcrPreprocessingFile;
  chunks: OcrPreprocessingPageChunk[];
  artifactStore: OcrPreprocessingArtifactStore;
  chunkCount: number;
  initialState: OcrPreprocessingState;
  failures: OcrPreprocessingFailure[];
  preflightState?: OcrPreprocessingState;
  pdfChunkArtifacts?: readonly OcrPdfChunkArtifact[];
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (
    candidate.name === 'AbortError' ||
    candidate.code === 'ABORT_ERR' ||
    (typeof candidate.message === 'string' && /(?:abort|cancel)/iu.test(candidate.message))
  ) {
    return true;
  }

  return candidate.cause !== undefined && isAbortError(candidate.cause);
}

function isAdaptiveSplitEligiblePaddleOcrError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as { ocrAdaptiveSplitEligible?: unknown }).ocrAdaptiveSplitEligible === true,
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim() !== '') {
    return error.trim();
  }
  return 'OCR preprocessing failed';
}

function toFailure(input: {
  stage: OcrPreprocessingFailureStage;
  error: unknown;
  chunk?: OcrPreprocessingPageChunk;
}): OcrPreprocessingFailure {
  return {
    stage: input.stage,
    ...(input.chunk
      ? {
          chunkIndex: input.chunk.chunkIndex,
          pageStart: input.chunk.pageStart,
          pageEnd: input.chunk.pageEnd,
        }
      : {}),
    errorMessage: toErrorMessage(input.error),
  };
}

function toFailedFileResult(input: {
  file: OcrPreprocessingFile;
  failures: OcrPreprocessingFailure[];
}): RunOcrPreprocessingFailedFileResult {
  const firstFailure = input.failures[0] ?? {
    stage: 'state' as const,
    errorMessage: 'OCR preprocessing failed',
  };
  return {
    file: input.file,
    status: 'failed',
    ...firstFailure,
    failures: input.failures,
  };
}

function findArtifact(input: {
  file: OcrPreprocessingFile;
  artifacts: readonly OcrPdfChunkArtifact[];
  chunk: OcrPreprocessingPageChunk;
}): OcrPdfChunkArtifact {
  const artifact = input.artifacts.find(
    (entry) =>
      entry.pageStart === input.chunk.pageStart && entry.pageEnd === input.chunk.pageEnd,
  );
  if (!artifact) {
    throw new Error(
      `Missing OCR preprocessing PDF chunk artifact ${input.chunk.pageStart}-${input.chunk.pageEnd} for ${input.file.ocrFileKey}`,
    );
  }
  return artifact;
}

function getSavedChunk(
  currentState: OcrPreprocessingState,
  chunk: Pick<OcrPreprocessingPageChunk, 'pageStart' | 'pageEnd'>,
) {
  return currentState.chunks.find(
    (entry) => entry.pageStart === chunk.pageStart && entry.pageEnd === chunk.pageEnd,
  );
}

function getExpectedChunkCount(chunks: readonly OcrPreprocessingPageChunk[]) {
  return chunks.length;
}

function getPageCount(chunks: readonly OcrPreprocessingPageChunk[]) {
  return chunks.reduce((maxPage, chunk) => Math.max(maxPage, chunk.pageEnd), 0);
}

function getOcrSourceFile(file: OcrPreprocessingFile): string | undefined {
  const candidates = [
    file.filename,
    file.name,
    file.originalname,
    file.filepath,
    file.path,
    file.sourcePdfKey,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      continue;
    }
    const path = candidate.trim().replace(/\\/gu, '/').split(/[?#]/u)[0] ?? '';
    const basename = path.split('/').filter(Boolean).pop();
    if (basename && basename !== '.' && basename !== '..') {
      return basename;
    }
  }
  return undefined;
}

function isImageOcrFile(file: OcrPreprocessingFile): boolean {
  const mediaType =
    typeof file.mediaType === 'string'
      ? (file.mediaType.trim().toLowerCase().split(';', 1)[0] ?? '')
      : '';
  if (mediaType.startsWith('image/')) {
    return true;
  }
  if (mediaType !== '' && mediaType !== 'application/octet-stream') {
    return false;
  }

  const filename = getOcrSourceFile(file) ?? '';
  return /\.(?:png|jpe?g|webp|bmp|gif|tiff?)$/iu.test(filename);
}

function getResultPageRanges(
  file: OcrPreprocessingFile,
  chunks: readonly OcrPreprocessingPageChunk[],
): OcrPageRange[] {
  return isImageOcrFile(file)
    ? []
    : chunks.map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd }));
}

function hasMissingRawChunk(
  state: OcrPreprocessingState,
  chunks: readonly OcrPreprocessingPageChunk[],
) {
  return chunks.some((chunk) => !getSavedChunk(state, chunk)?.rawSaved);
}

function hasCompleteOrganizedChunks(
  state: OcrPreprocessingState,
  chunks: readonly OcrPreprocessingPageChunk[],
): boolean {
  const saved = new Set(
    state.chunks
      .filter((chunk) => chunk.organizedSaved && chunk.organizedMarkdown !== undefined)
      .map(getOcrPageRangeKey),
  );
  return chunks.every((chunk) => saved.has(getOcrPageRangeKey(chunk)));
}

function getExpectedSavedChunkMarkdowns(
  state: OcrPreprocessingState,
  chunks: readonly OcrPreprocessingPageChunk[],
) {
  const expectedRanges = new Set(chunks.map(getOcrPageRangeKey));
  return getSavedOcrPreprocessingChunkMarkdowns(state).filter(
    (chunk) => {
      const { pageStart, pageEnd } = chunk;
      return (
        pageStart !== undefined &&
        pageEnd !== undefined &&
        expectedRanges.has(getOcrPageRangeKey({ pageStart, pageEnd }))
      );
    },
  );
}

async function readPreprocessingState(
  input: RunOcrPreprocessingBatchPipelineInput,
  file: OcrPreprocessingFile,
) {
  return input.memory.readOcrPreprocessingState({
    conversationId: input.conversationId,
    sourcePdfKey: file.sourcePdfKey,
    ocrFileKey: file.ocrFileKey,
    ocrRuleVersion: input.ocrRuleVersion,
  });
}

async function emitFileProgress(
  input: RunOcrPreprocessingBatchPipelineInput,
  file: OcrPreprocessingFile,
  progress: OcrPreprocessingPipelineProgress,
) {
  await input.onProgress?.({ file, progress });
}

async function emitMergedMarkdownProgress(input: {
  pipeline: RunOcrPreprocessingBatchPipelineInput;
  file: OcrPreprocessingFile;
  chunkCount: number;
}) {
  await emitFileProgress(input.pipeline, input.file, {
    stage: 'merged_markdowns_read',
    chunkCount: input.chunkCount,
  });
  await emitFileProgress(input.pipeline, input.file, {
    stage: 'processing_with_merged_markdown',
    chunkCount: input.chunkCount,
  });
}

export async function runOcrPreprocessingBatchPipeline(
  input: RunOcrPreprocessingBatchPipelineInput,
): Promise<RunOcrPreprocessingBatchPipelineResult> {
  const turnIndex = input.turnIndex ?? 0;
  const checkpointTurnIndex = input.checkpointTurnIndex ?? turnIndex;
  const resultSlots = new Array<RunOcrPreprocessingBatchFileResult | undefined>(input.files.length);
  const workItems: OcrPreprocessingBatchWorkItem[] = [];

  for (let index = 0; index < input.files.length; index += 1) {
    const entry = input.files[index];
    if (!entry) {
      continue;
    }
    let effectiveChunks: OcrPreprocessingPageChunk[];
    try {
      let resolvedChunks: readonly OcrPreprocessingPageChunk[] = entry.chunks;
      if (entry.artifacts.resolveCanonicalChunks) {
        resolvedChunks = await entry.artifacts.resolveCanonicalChunks({
          sourcePdfKey: entry.file.sourcePdfKey,
          chunks: resolvedChunks,
        });
      }
      effectiveChunks = normalizeOcrPageChunks(resolvedChunks);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      resultSlots[index] = toFailedFileResult({
        file: entry.file,
        failures: [toFailure({ stage: 'artifacts', error })],
      });
      continue;
    }
    const chunkCount = getExpectedChunkCount(effectiveChunks);
    let state: OcrPreprocessingState;
    try {
      state = await readPreprocessingState(input, entry.file);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      resultSlots[index] = toFailedFileResult({
        file: entry.file,
        failures: [toFailure({ stage: 'state', error })],
      });
      continue;
    }
    const savedChunkMarkdowns = getExpectedSavedChunkMarkdowns(state, effectiveChunks);
    if (effectiveChunks.length > 0 && hasCompleteOrganizedChunks(state, effectiveChunks)) {
      await emitMergedMarkdownProgress({
        pipeline: input,
        file: entry.file,
        chunkCount,
      });
      resultSlots[index] = {
        file: entry.file,
        status: 'ready',
        markdown: mergeChunkMarkdownForFileKey({
          ocrFileKey: entry.file.ocrFileKey,
          ocrRuleVersion: input.ocrRuleVersion,
          chunks: savedChunkMarkdowns,
        }),
        chunkCount,
        pageRanges: getResultPageRanges(entry.file, effectiveChunks),
      };
      continue;
    }

    workItems.push({
      index,
      file: entry.file,
      chunks: effectiveChunks,
      artifactStore: entry.artifacts,
      chunkCount,
      initialState: state,
      failures: [],
    });
  }

  for (const workItem of workItems) {
    const needsArtifacts =
      hasMissingRawChunk(workItem.initialState, workItem.chunks) ||
      workItem.chunks.some((chunk) => {
        const savedChunk = getSavedChunk(workItem.initialState, chunk);
        return !savedChunk?.organizedSaved || savedChunk.organizedMarkdown === undefined;
      });
    if (!needsArtifacts) {
      continue;
    }
    let artifacts: OcrPdfChunkArtifact[];
    try {
      artifacts = await workItem.artifactStore.ensurePdfChunkArtifacts({
        file: workItem.file,
        sourcePdfKey: workItem.file.sourcePdfKey,
        chunks: workItem.chunks,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      resultSlots[workItem.index] = toFailedFileResult({
        file: workItem.file,
        failures: [toFailure({ stage: 'artifacts', error })],
      });
      continue;
    }
    const pdfChunkSource = artifacts.every((artifact) => artifact.artifactOrigin === 'existing')
      ? 'fetched'
      : 'uploaded';
    workItem.pdfChunkArtifacts = artifacts;
    await emitFileProgress(input, workItem.file, {
      stage: 'pdf_chunks_ready',
      pageCount: getPageCount(workItem.chunks),
      chunkCount: workItem.chunkCount,
      source: pdfChunkSource,
    });
  }

  const runRawChunk = async (captureInput: {
    workItem: OcrPreprocessingBatchWorkItem;
    chunk: OcrPreprocessingPageChunk;
    artifact: OcrPdfChunkArtifact;
  }) => {
    const { workItem, chunk, artifact } = captureInput;
    await emitFileProgress(input, workItem.file, {
      stage: 'paddleocr_chunk_started',
      chunkIndex: chunk.chunkIndex,
      chunkCount: workItem.chunkCount,
    });
    return await input.paddleOcr.runChunk({
      file: workItem.file,
      chunk,
      artifact,
    });
  };

  const saveRawChunk = async (captureInput: {
    workItem: OcrPreprocessingBatchWorkItem;
    chunk: OcrPreprocessingPageChunk;
    artifact: OcrPdfChunkArtifact;
    raw: PaddleOcrChunkRunResult;
  }) => {
    const { workItem, chunk, artifact, raw } = captureInput;
    await input.memory.capturePaddleOcrChunkResult({
      conversationId: input.conversationId,
      requestId: input.requestId,
      turnIndex,
      checkpointTurnIndex,
      file: workItem.file,
      chunk: {
        ...chunk,
        sourcePdfKey: workItem.file.sourcePdfKey,
        pdfChunk: {
          source: artifact.source ?? 's3',
          storageKey: artifact.storageKey,
          ...(artifact.storageRegion !== undefined
            ? { storageRegion: artifact.storageRegion }
            : {}),
          filepath: artifact.filepath,
        },
      },
      rawResultHash: raw.rawResultHash,
      data: raw.rawResult,
      includeTotals: false,
    });
    await emitFileProgress(input, workItem.file, {
      stage: 'paddleocr_chunk_saved',
      chunkIndex: chunk.chunkIndex,
      chunkCount: workItem.chunkCount,
    });
  };

  for (const workItem of workItems) {
    if (resultSlots[workItem.index]?.status === 'failed') {
      continue;
    }
    for (let chunkPosition = 0; chunkPosition < workItem.chunks.length; chunkPosition += 1) {
      const chunk = workItem.chunks[chunkPosition];
      if (!chunk) {
        continue;
      }
      const savedChunk = getSavedChunk(workItem.initialState, chunk);

      if (savedChunk?.rawSaved) {
        continue;
      }

      let artifact: OcrPdfChunkArtifact;
      try {
        artifact = findArtifact({
          file: workItem.file,
          artifacts: workItem.pdfChunkArtifacts ?? [],
          chunk,
        });
      } catch (artifactError) {
        workItem.failures.push(toFailure({ stage: 'artifacts', chunk, error: artifactError }));
        continue;
      }
      try {
        const raw = await runRawChunk({ workItem, chunk, artifact });
        try {
          await saveRawChunk({ workItem, chunk, artifact, raw });
        } catch (saveError) {
          if (isAbortError(saveError)) {
            throw saveError;
          }
          workItem.failures.push(toFailure({ stage: 'state', chunk, error: saveError }));
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (!isAdaptiveSplitEligiblePaddleOcrError(error)) {
          workItem.failures.push(toFailure({ stage: 'paddleocr', chunk, error }));
          continue;
        }
        const split = splitExactFiftyPageRange(chunk);
        if (!split) {
          workItem.failures.push(toFailure({ stage: 'paddleocr', chunk, error }));
          continue;
        }
        const nextChunks = normalizeOcrPageChunks([
          ...workItem.chunks.filter((candidate) => candidate !== chunk),
          ...split,
        ]);
        let nextArtifacts: OcrPdfChunkArtifact[];
        try {
          if (!workItem.artifactStore.commitPdfChunkSplit) {
            throw new Error('OCR artifact store cannot commit split markers');
          }
          nextArtifacts = await workItem.artifactStore.commitPdfChunkSplit({
            file: workItem.file,
            sourcePdfKey: workItem.file.sourcePdfKey,
            parent: chunk,
            children: split,
            chunks: nextChunks,
          });
        } catch (splitError) {
          workItem.failures.push(toFailure({ stage: 'artifacts', chunk, error: splitError }));
          continue;
        }
        workItem.chunks = nextChunks;
        workItem.chunkCount = nextChunks.length;
        workItem.pdfChunkArtifacts = nextArtifacts;
        for (const child of split) {
          const childChunk = nextChunks.find(
            (candidate) =>
              candidate.pageStart === child.pageStart && candidate.pageEnd === child.pageEnd,
          );
          if (!childChunk) {
            workItem.failures.push(toFailure({ stage: 'paddleocr', chunk: child, error: new Error('Missing OCR split child range') }));
            continue;
          }
          let childArtifact: OcrPdfChunkArtifact;
          try {
            childArtifact = findArtifact({
              file: workItem.file,
              artifacts: nextArtifacts,
              chunk: childChunk,
            });
          } catch (childArtifactError) {
            workItem.failures.push(
              toFailure({ stage: 'artifacts', chunk: childChunk, error: childArtifactError }),
            );
            continue;
          }
          let childRaw: PaddleOcrChunkRunResult;
          try {
            childRaw = await runRawChunk({
              workItem,
              chunk: childChunk,
              artifact: childArtifact,
            });
          } catch (childError) {
            if (isAbortError(childError)) {
              throw childError;
            }
            workItem.failures.push(
              toFailure({ stage: 'paddleocr', chunk: childChunk, error: childError }),
            );
            continue;
          }
          try {
            await saveRawChunk({
              workItem,
              chunk: childChunk,
              artifact: childArtifact,
              raw: childRaw,
            });
          } catch (childSaveError) {
            if (isAbortError(childSaveError)) {
              throw childSaveError;
            }
            workItem.failures.push(
              toFailure({ stage: 'state', chunk: childChunk, error: childSaveError }),
            );
          }
        }
        chunkPosition += 1;
        continue;
      }
    }
  }

  for (const workItem of workItems) {
    if (resultSlots[workItem.index]?.status === 'failed') {
      continue;
    }
    try {
      workItem.preflightState = await readPreprocessingState(input, workItem.file);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      workItem.failures.push(toFailure({ stage: 'state', error }));
    }
  }

  for (const workItem of workItems) {
    if (resultSlots[workItem.index]?.status === 'failed') {
      continue;
    }
    const preflightState = workItem.preflightState;
    if (!preflightState) {
      workItem.failures.push(
        toFailure({
          stage: 'state',
          error: new Error(
            `Missing OCR preprocessing preflight state for ${workItem.file.ocrFileKey}`,
          ),
        }),
      );
      continue;
    }

    for (const chunk of workItem.chunks) {
      const savedChunk = getSavedChunk(preflightState, chunk);

      if (savedChunk?.organizedSaved && savedChunk.organizedMarkdown !== undefined) {
        continue;
      }
      if (!savedChunk?.rawSaved) {
        const alreadyFailed = workItem.failures.some(
          (failure) =>
            failure.pageStart === chunk.pageStart && failure.pageEnd === chunk.pageEnd,
        );
        if (!alreadyFailed) {
          workItem.failures.push(
            toFailure({
              stage: 'state',
              chunk,
              error: new Error(
                `Missing OCR preprocessing raw data for ${workItem.file.ocrFileKey} chunk ${chunk.chunkIndex}`,
              ),
            }),
          );
        }
        continue;
      }
      if (savedChunk.rawOcrText === undefined || savedChunk.rawResultHash === undefined) {
        workItem.failures.push(
          toFailure({
            stage: 'state',
            chunk,
            error: new Error(
              `Missing OCR preprocessing raw data for ${workItem.file.ocrFileKey} chunk ${chunk.chunkIndex}`,
            ),
          }),
        );
        continue;
      }

      let organized: { markdown: string } | undefined;
      let organizerError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await emitFileProgress(input, workItem.file, {
          stage: 'organizer_chunk_started',
          chunkIndex: chunk.chunkIndex,
          chunkCount: workItem.chunkCount,
        });
        try {
          const organizerInput = {
            ocrRulesText: input.ocrRulesText,
            rawOcrText: savedChunk.rawOcrText,
            fileKey: normalizeOcrOrganizerFileKey({
              fileKey: workItem.file.ocrFileKey,
              fileId: workItem.file.fileId ?? workItem.file.file_id ?? workItem.file.id,
            }),
            sourceFile: getOcrSourceFile(workItem.file) ?? null,
            ...(isImageOcrFile(workItem.file)
              ? {}
              : {
                  pageStart: chunk.pageStart,
                  pageEnd: chunk.pageEnd,
                  chunkIndex: chunk.chunkIndex,
                  chunkCount: workItem.chunkCount,
                }),
          };
          organized = await input.organizer.organize(organizerInput);
          break;
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          organizerError = error;
        }
      }

      if (!organized) {
        workItem.failures.push(
          toFailure({
            stage: 'organizer',
            chunk,
            error: organizerError ?? new Error('OCR organizer failed'),
          }),
        );
        continue;
      }

      try {
        await input.memory.captureOcrPreprocessingChunkMarkdown({
          conversationId: input.conversationId,
          requestId: input.requestId,
          turnIndex,
          checkpointTurnIndex,
          file: workItem.file,
          chunk: {
            ...chunk,
            sourcePdfKey: workItem.file.sourcePdfKey,
          },
          rawResultHash: savedChunk.rawResultHash,
          ocrRuleVersion: input.ocrRuleVersion,
          content: organized.markdown,
          includeTotals: false,
        });
        await emitFileProgress(input, workItem.file, {
          stage: 'organizer_chunk_saved',
          chunkIndex: chunk.chunkIndex,
          chunkCount: workItem.chunkCount,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        workItem.failures.push(toFailure({ stage: 'organizer', chunk, error }));
        continue;
      }
    }
  }

  for (const workItem of workItems) {
    if (resultSlots[workItem.index]?.status === 'failed') {
      continue;
    }
    if (workItem.failures.length > 0) {
      resultSlots[workItem.index] = toFailedFileResult({
        file: workItem.file,
        failures: workItem.failures,
      });
      continue;
    }
    let finalState: OcrPreprocessingState;
    try {
      finalState = await readPreprocessingState(input, workItem.file);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      resultSlots[workItem.index] = toFailedFileResult({
        file: workItem.file,
        failures: [toFailure({ stage: 'state', error })],
      });
      continue;
    }
    const chunkMarkdowns = getExpectedSavedChunkMarkdowns(finalState, workItem.chunks);
    if (!hasCompleteOrganizedChunks(finalState, workItem.chunks)) {
      const expectedRanges = new Set(workItem.chunks.map(getOcrPageRangeKey));
      const actualRanges = chunkMarkdowns.filter(
        (chunk) => {
          const { pageStart, pageEnd } = chunk;
          return (
            pageStart !== undefined &&
            pageEnd !== undefined &&
            expectedRanges.has(getOcrPageRangeKey({ pageStart, pageEnd }))
          );
        },
      ).length;
      resultSlots[workItem.index] = toFailedFileResult({
        file: workItem.file,
        failures: [
          toFailure({
            stage: 'merge',
            error: new Error(
              `Missing OCR preprocessing markdown chunks for ${workItem.file.ocrFileKey}: expected ${workItem.chunks.length}, got ${actualRanges}`,
            ),
          }),
        ],
      });
      continue;
    }

    await emitFileProgress(input, workItem.file, {
      stage: 'merged_markdowns_read',
      chunkCount: workItem.chunkCount,
    });
    const markdown = mergeChunkMarkdownForFileKey({
      ocrFileKey: workItem.file.ocrFileKey,
      ocrRuleVersion: input.ocrRuleVersion,
      chunks: chunkMarkdowns,
    });
    await emitFileProgress(input, workItem.file, {
      stage: 'processing_with_merged_markdown',
      chunkCount: workItem.chunkCount,
    });
    resultSlots[workItem.index] = {
      file: workItem.file,
      status: 'completed',
      markdown,
      chunkCount: workItem.chunkCount,
      pageRanges: getResultPageRanges(workItem.file, workItem.chunks),
    };
  }

  return {
    files: resultSlots.filter(
      (result): result is RunOcrPreprocessingBatchFileResult => result !== undefined,
    ),
  };
}

export async function runOcrPreprocessingPipeline(
  input: RunOcrPreprocessingPipelineInput,
): Promise<RunOcrPreprocessingPipelineResult | RunOcrPreprocessingFailedFileResult> {
  const result = await runOcrPreprocessingBatchPipeline({
    conversationId: input.conversationId,
    requestId: input.requestId,
    turnIndex: input.turnIndex,
    checkpointTurnIndex: input.checkpointTurnIndex,
    ocrRuleVersion: input.ocrRuleVersion,
    ocrRulesText: input.ocrRulesText,
    files: [
      {
        file: input.file,
        chunks: input.chunks,
        artifacts: input.artifacts,
      },
    ],
    memory: input.memory,
    organizer: input.organizer,
    paddleOcr: input.paddleOcr,
    onProgress: ({ progress }) => input.onProgress?.(progress),
  });

  const fileResult = result.files[0];
  if (!fileResult) {
    throw new Error(`OCR preprocessing returned no result for ${input.file.ocrFileKey}`);
  }

  if (fileResult.status === 'failed') {
    return fileResult;
  }

  return {
    status: fileResult.status,
    markdown: fileResult.markdown,
    chunkCount: fileResult.chunkCount,
    pageRanges: fileResult.pageRanges,
  };
}
