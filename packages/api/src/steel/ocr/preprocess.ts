import { getSavedOcrPreprocessingChunkMarkdowns, mergeChunkMarkdownForFileKey } from './merge';

import type {
  CaptureOcrPreprocessingChunkMarkdownInput,
  CapturePaddleOcrChunkResultInput,
  CaptureToolResultResult,
  OcrPreprocessingState,
  OcrPreprocessingStateInput,
  SteelOcrFileReference,
} from '../memory/service';
import type { OcrPreprocessingPageChunk } from './chunks';
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
  ensurePdfChunkArtifacts(input: {
    file: OcrPreprocessingFile;
    sourcePdfKey: string;
    chunks: readonly OcrPreprocessingPageChunk[];
  }): Promise<OcrPdfChunkArtifact[]>;
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
  chunkCount: number;
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
  chunks: readonly OcrPreprocessingPageChunk[];
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
  const artifact = input.artifacts.find((entry) => entry.chunkIndex === input.chunk.chunkIndex);
  if (!artifact) {
    throw new Error(
      `Missing OCR preprocessing PDF chunk artifact ${input.chunk.chunkIndex} for ${input.file.ocrFileKey}`,
    );
  }
  return artifact;
}

function getSavedChunk(currentState: OcrPreprocessingState, chunkIndex: number) {
  return currentState.chunks.find((entry) => entry.chunkIndex === chunkIndex);
}

function getExpectedChunkCount(chunks: readonly OcrPreprocessingPageChunk[]) {
  return chunks[0]?.chunkCount ?? chunks.length;
}

function getPageCount(chunks: readonly OcrPreprocessingPageChunk[]) {
  return chunks.reduce((maxPage, chunk) => Math.max(maxPage, chunk.pageEnd), 0);
}

function hasMissingRawChunk(
  state: OcrPreprocessingState,
  chunks: readonly OcrPreprocessingPageChunk[],
) {
  return chunks.some((chunk) => !getSavedChunk(state, chunk.chunkIndex)?.rawSaved);
}

function getOcrPreprocessingProviderToolCallId(input: {
  file: OcrPreprocessingFile;
  chunk: OcrPreprocessingPageChunk;
}) {
  const safeFileKey = input.file.ocrFileKey.replace(/[^A-Za-z0-9_-]+/g, '_');
  return `ocr_preprocessing_${safeFileKey}_chunk_${input.chunk.chunkIndex}`;
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
  try {
    await input.onProgress?.({ file, progress });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
  }
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
    const chunkCount = getExpectedChunkCount(entry.chunks);
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
    const savedChunkMarkdowns = getSavedOcrPreprocessingChunkMarkdowns(state);
    if (savedChunkMarkdowns.length === entry.chunks.length && entry.chunks.length > 0) {
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
      };
      continue;
    }

    workItems.push({
      index,
      file: entry.file,
      chunks: entry.chunks,
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
        const savedChunk = getSavedChunk(workItem.initialState, chunk.chunkIndex);
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

  for (const workItem of workItems) {
    if (resultSlots[workItem.index]?.status === 'failed') {
      continue;
    }
    for (const chunk of workItem.chunks) {
      const savedChunk = getSavedChunk(workItem.initialState, chunk.chunkIndex);

      if (savedChunk?.rawSaved) {
        continue;
      }

      try {
        const artifact = findArtifact({
          file: workItem.file,
          artifacts: workItem.pdfChunkArtifacts ?? [],
          chunk,
        });
        await emitFileProgress(input, workItem.file, {
          stage: 'paddleocr_chunk_started',
          chunkIndex: chunk.chunkIndex,
          chunkCount: workItem.chunkCount,
        });
        const raw = await input.paddleOcr.runChunk({
          file: workItem.file,
          chunk,
          artifact,
        });
        await input.memory.capturePaddleOcrChunkResult({
          conversationId: input.conversationId,
          requestId: input.requestId,
          providerToolCallId: getOcrPreprocessingProviderToolCallId({ file: workItem.file, chunk }),
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
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        workItem.failures.push(toFailure({ stage: 'paddleocr', chunk, error }));
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
      const savedChunk = getSavedChunk(preflightState, chunk.chunkIndex);

      if (savedChunk?.organizedSaved && savedChunk.organizedMarkdown !== undefined) {
        continue;
      }
      if (!savedChunk?.rawSaved) {
        const alreadyFailed = workItem.failures.some(
          (failure) => failure.chunkIndex === chunk.chunkIndex,
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

      try {
        await emitFileProgress(input, workItem.file, {
          stage: 'organizer_chunk_started',
          chunkIndex: chunk.chunkIndex,
          chunkCount: workItem.chunkCount,
        });
        const organized = await input.organizer.organize({
          ocrRulesText: input.ocrRulesText,
          rawOcrText: savedChunk.rawOcrText,
        });
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
    const chunkMarkdowns = getSavedOcrPreprocessingChunkMarkdowns(finalState);
    if (chunkMarkdowns.length !== workItem.chunks.length) {
      resultSlots[workItem.index] = toFailedFileResult({
        file: workItem.file,
        failures: [
          toFailure({
            stage: 'merge',
            error: new Error(
              `Missing OCR preprocessing markdown chunks for ${workItem.file.ocrFileKey}: expected ${workItem.chunks.length}, got ${chunkMarkdowns.length}`,
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
  };
}
