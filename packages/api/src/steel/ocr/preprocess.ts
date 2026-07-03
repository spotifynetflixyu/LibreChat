import { ocrPreprocessingPipelineVersion } from '../memory/service';
import { getSavedOcrPreprocessingChunkMarkdowns, mergeChunkMarkdownForFileKey } from './merge';

import type {
  CaptureOcrPreprocessingChunkMarkdownInput,
  CapturePaddleOcrChunkResultInput,
  CaptureToolResultResult,
  OfficialOcrMarkdownInput,
  OfficialOcrMarkdownResult,
  OcrPreprocessingState,
  OcrPreprocessingStateInput,
  SteelOcrFileReference,
} from '../memory/service';
import type { OcrPreprocessingPageChunk } from './chunks';
import type { OcrOrganizer, OcrPreprocessingChunkIdentity } from './organizer';

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
  readOfficialOcrMarkdown(input: OfficialOcrMarkdownInput): Promise<OfficialOcrMarkdownResult | undefined>;
  readOcrPreprocessingState(input: OcrPreprocessingStateInput): Promise<OcrPreprocessingState>;
  capturePaddleOcrChunkResult(input: CapturePaddleOcrChunkResultInput): Promise<CaptureToolResultResult>;
  captureOcrPreprocessingChunkMarkdown(
    input: CaptureOcrPreprocessingChunkMarkdownInput,
  ): Promise<CaptureToolResultResult>;
}

export interface RunOcrPreprocessingPipelineResult {
  status: 'ready' | 'completed';
  markdown: string;
}

export interface RunOcrPreprocessingBatchFileInput {
  file: OcrPreprocessingFile;
  chunks: readonly OcrPreprocessingPageChunk[];
  artifacts: OcrPreprocessingArtifactStore;
}

export interface RunOcrPreprocessingBatchFileResult extends RunOcrPreprocessingPipelineResult {
  file: OcrPreprocessingFile;
  chunkCount: number;
}

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
  preflightState?: OcrPreprocessingState;
  pdfChunkArtifacts?: readonly OcrPdfChunkArtifact[];
}

function toChunkIdentity(input: {
  file: OcrPreprocessingFile;
  sourcePdfKey: string;
  chunk: OcrPreprocessingPageChunk;
}): OcrPreprocessingChunkIdentity {
  return {
    pipelineVersion: ocrPreprocessingPipelineVersion,
    sourcePdfKey: input.sourcePdfKey,
    ocrFileKey: input.file.ocrFileKey,
    ...(input.file.fileId !== undefined ? { fileId: input.file.fileId } : {}),
    ...(input.file.filename !== undefined ? { filename: input.file.filename } : {}),
    chunkIndex: input.chunk.chunkIndex,
    chunkCount: input.chunk.chunkCount,
    pageStart: input.chunk.pageStart,
    pageEnd: input.chunk.pageEnd,
    chunkSizePages: input.chunk.chunkSizePages,
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
  const resultSlots = new Array<RunOcrPreprocessingBatchFileResult | undefined>(
    input.files.length,
  );
  const workItems: OcrPreprocessingBatchWorkItem[] = [];

  for (let index = 0; index < input.files.length; index += 1) {
    const entry = input.files[index];
    if (!entry) {
      continue;
    }
    const chunkCount = getExpectedChunkCount(entry.chunks);
    const existingOfficialMarkdown = await input.memory.readOfficialOcrMarkdown({
      conversationId: input.conversationId,
      sourcePdfKey: entry.file.sourcePdfKey,
      ocrFileKey: entry.file.ocrFileKey,
      ocrRuleVersion: input.ocrRuleVersion,
    });
    if (existingOfficialMarkdown) {
      await emitMergedMarkdownProgress({
        pipeline: input,
        file: entry.file,
        chunkCount: existingOfficialMarkdown.chunkCount,
      });
      resultSlots[index] = {
        file: entry.file,
        status: 'ready',
        markdown: existingOfficialMarkdown.markdown,
        chunkCount: existingOfficialMarkdown.chunkCount,
      };
      continue;
    }

    const state = await readPreprocessingState(input, entry.file);
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
    });
  }

  for (const workItem of workItems) {
    if (!hasMissingRawChunk(workItem.initialState, workItem.chunks)) {
      continue;
    }
    const artifacts = await workItem.artifactStore.ensurePdfChunkArtifacts({
      file: workItem.file,
      sourcePdfKey: workItem.file.sourcePdfKey,
      chunks: workItem.chunks,
    });
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
    for (const chunk of workItem.chunks) {
      const savedChunk = getSavedChunk(workItem.initialState, chunk.chunkIndex);

      if (savedChunk?.rawSaved) {
        continue;
      }

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
            ...(artifact.storageRegion !== undefined ? { storageRegion: artifact.storageRegion } : {}),
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
    }
  }

  for (const workItem of workItems) {
    workItem.preflightState = await readPreprocessingState(input, workItem.file);
  }

  for (const workItem of workItems) {
    const preflightState = workItem.preflightState;
    if (!preflightState) {
      throw new Error(`Missing OCR preprocessing preflight state for ${workItem.file.ocrFileKey}`);
    }

    for (const chunk of workItem.chunks) {
      const savedChunk = getSavedChunk(preflightState, chunk.chunkIndex);

      if (savedChunk?.organizedSaved && savedChunk.organizedMarkdown !== undefined) {
        continue;
      }
      if (!savedChunk?.rawSaved) {
        throw new Error(
          `Missing OCR preprocessing raw data for ${workItem.file.ocrFileKey} chunk ${chunk.chunkIndex}`,
        );
      }
      if (savedChunk.rawOcrText === undefined || savedChunk.rawResultHash === undefined) {
        throw new Error(
          `Missing OCR preprocessing raw data for ${workItem.file.ocrFileKey} chunk ${chunk.chunkIndex}`,
        );
      }

      await emitFileProgress(input, workItem.file, {
        stage: 'organizer_chunk_started',
        chunkIndex: chunk.chunkIndex,
        chunkCount: workItem.chunkCount,
      });
      const organized = await input.organizer.organize({
        ocrRulesText: input.ocrRulesText,
        file: workItem.file,
        chunk: toChunkIdentity({
          file: workItem.file,
          sourcePdfKey: workItem.file.sourcePdfKey,
          chunk,
        }),
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
    }
  }

  for (const workItem of workItems) {
    const finalState = await readPreprocessingState(input, workItem.file);
    const chunkMarkdowns = getSavedOcrPreprocessingChunkMarkdowns(finalState);
    if (chunkMarkdowns.length !== workItem.chunks.length) {
      throw new Error(
        `Missing OCR preprocessing markdown chunks for ${workItem.file.ocrFileKey}: expected ${workItem.chunks.length}, got ${chunkMarkdowns.length}`,
      );
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
    files: resultSlots.filter((result): result is RunOcrPreprocessingBatchFileResult => result !== undefined),
  };
}

export async function runOcrPreprocessingPipeline(
  input: RunOcrPreprocessingPipelineInput,
): Promise<RunOcrPreprocessingPipelineResult> {
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

  return {
    status: fileResult.status,
    markdown: fileResult.markdown,
  };
}
