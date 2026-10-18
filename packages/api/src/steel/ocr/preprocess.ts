import { logger } from '@librechat/data-schemas';
import type {
  CaptureOcrPreprocessingChunkMarkdownInput,
  CapturePaddleOcrChunkResultInput,
  CaptureToolResultResult,
  OcrPreprocessingState,
  OcrPreprocessingStateInput,
  SteelOcrFileReference,
} from '../memory/service';
import type { SteelOcrChunkError } from './retry';
import type { OcrOrganizer } from './organizer';
import {
  getOcrPageRangeKey,
  normalizeOcrPageChunks,
  splitOcrPageRange,
  type OcrPageRange,
  type OcrPreprocessingPageChunk,
} from './chunks';
import { getSavedOcrPreprocessingChunkMarkdowns, mergeChunkMarkdownForFileKey } from './merge';
import { isPaddleOcrDiagnosticCode, type PaddleOcrDiagnosticCode } from './diagnostics';
import { runWithSteelOcrRetries, createSteelOcrChunkError } from './retry';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { normalizeSteelChunkMarkdown } from '../markdown/chunk';
import { normalizeOcrOrganizerFileKey } from './organizer';
import { parseMarkdownTables } from '../markdown/table';

/** The raw result hash of a chunk PaddleOCR gave up on; its Organizer Markdown is keyed by it. */
export const paddleFailedRawResultHash = 'paddle_failed';

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
  /** Exact signed artifact used by the successful PaddleOCR attempt. */
  artifact?: OcrPdfChunkArtifact;
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
  fileUrl?: string;
  diagnosticCode?: PaddleOcrDiagnosticCode;
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
  | { stage: 'paddleocr_chunk_loaded'; chunkIndex: number; chunkCount: number }
  | { stage: 'paddleocr_chunk_started'; chunkIndex: number; chunkCount: number }
  | { stage: 'paddleocr_chunk_saved'; chunkIndex: number; chunkCount: number }
  | { stage: 'organizer_chunk_loaded'; chunkIndex: number; chunkCount: number }
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
  signal?: AbortSignal;
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
  signal?: AbortSignal;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  if (isAbortError(signal.reason)) {
    throw signal.reason;
  }

  const error = new Error(
    signal.reason instanceof Error
      ? signal.reason.message
      : typeof signal.reason === 'string'
        ? signal.reason
        : 'OCR preprocessing aborted',
  );
  error.name = 'AbortError';
  if (signal.reason !== undefined) {
    error.cause = signal.reason;
  }
  throw error;
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
  fileUrl?: string;
}): OcrPreprocessingFailure {
  const diagnosticCode =
    input.error &&
    typeof input.error === 'object' &&
    isPaddleOcrDiagnosticCode((input.error as { diagnosticCode?: unknown }).diagnosticCode)
      ? (input.error as { diagnosticCode: PaddleOcrDiagnosticCode }).diagnosticCode
      : undefined;
  return {
    stage: input.stage,
    ...(input.chunk
      ? {
          chunkIndex: input.chunk.chunkIndex,
          pageStart: input.chunk.pageStart,
          pageEnd: input.chunk.pageEnd,
        }
      : {}),
    ...(input.fileUrl !== undefined ? { fileUrl: input.fileUrl } : {}),
    ...(diagnosticCode ? { diagnosticCode } : {}),
    errorMessage: toErrorMessage(input.error),
  };
}

function getPaddleOcrFileUrl(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const fileUrl = (error as { ocrFileUrl?: unknown }).ocrFileUrl;
    if (typeof fileUrl === 'string' && fileUrl.trim() !== '') {
      return fileUrl.trim();
    }
  }
  return fallback;
}

function toPaddleOcrFailure(input: {
  chunk: OcrPreprocessingPageChunk;
  artifact: OcrPdfChunkArtifact;
  error: unknown;
}): OcrPreprocessingFailure {
  return toFailure({
    stage: 'paddleocr',
    chunk: input.chunk,
    error: input.error,
    fileUrl: getPaddleOcrFileUrl(input.error, input.artifact.filepath),
  });
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

function isSavedRawChunk(
  state: OcrPreprocessingState,
  chunk: OcrPreprocessingPageChunk,
): boolean {
  const savedChunk = getSavedChunk(state, chunk);
  return Boolean(
    savedChunk?.rawSaved &&
      typeof savedChunk.rawResultHash === 'string' &&
      savedChunk.rawResultHash.trim() !== '' &&
      (typeof savedChunk.rawOcrText === 'string' || savedChunk.paddleFailed === true),
  );
}

function isSavedOrganizedChunk(
  state: OcrPreprocessingState,
  chunk: OcrPreprocessingPageChunk,
): boolean {
  const savedChunk = getSavedChunk(state, chunk);
  return Boolean(
    savedChunk?.organizedSaved &&
      typeof savedChunk.organizedMarkdown === 'string' &&
      savedChunk.organizedMarkdown.trim() !== '',
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

function getArtifactUrlRedactionVariants(artifactUrl: string): {
  exact: string[];
  paths: string[];
} {
  const variants = new Set<string>();
  const add = (value: string) => {
    if (value) {
      variants.add(value);
      variants.add(value.replaceAll('&', '&amp;'));
      variants.add(encodeURI(value));
      variants.add(encodeURIComponent(value));
      try {
        variants.add(decodeURIComponent(value));
      } catch {
        // Keep the original URL variants when it contains malformed escaping.
      }
    }
  };

  add(artifactUrl);
  const paths = new Set<string>();
  try {
    const parsed = new URL(artifactUrl);
    const path = `${parsed.origin}${parsed.pathname}`;
    paths.add(path);
    paths.add(path.replaceAll('&', '&amp;'));
    paths.add(encodeURI(path));
    paths.add(encodeURIComponent(path));
    try {
      paths.add(decodeURIComponent(path));
    } catch {
      // Keep the original path variants when it contains malformed escaping.
    }
  } catch {
    // Attachment validation reports invalid URLs before Organizer invocation.
  }
  return {
    exact: [...variants].sort((left, right) => right.length - left.length),
    paths: [...paths].sort((left, right) => right.length - left.length),
  };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function redactArtifactUrl(markdown: string, artifactUrl: string): string {
  const variants = getArtifactUrlRedactionVariants(artifactUrl);
  const exactRedacted = variants.exact.reduce(
    (content, variant) => content.split(variant).join('[REDACTED_ARTIFACT_URL]'),
    markdown,
  );
  return variants.paths.reduce((content, path) => {
    const query = '(?:(?:\\?|%3f)[^\\s|<>"\']*)?';
    return content.replace(
      new RegExp(`${escapeRegularExpression(path)}${query}`, 'giu'),
      '[REDACTED_ARTIFACT_URL]',
    );
  }, exactRedacted);
}

function normalizeOrganizerMarkdown(markdown: string, artifactUrl?: string): string {
  const artifactRedacted = artifactUrl
    ? redactArtifactUrl(markdown, artifactUrl)
    : markdown;
  const redacted = artifactRedacted
    .replace(/data:(?:application\/pdf|image\/[a-z0-9.+-]+);base64,[a-z0-9+/=]+/giu, '[REDACTED_DATA_URL]');
  const normalized = normalizeSteelChunkMarkdown('ocr_result_chunk', redacted);
  const tables = parseMarkdownTables(normalized);
  if (tables.length === 0) {
    throw new Error('OCR organizer output must contain at least one Markdown table');
  }

  const content = tables
    .map((table) => [
      `| ${table.headers.map(escapeMarkdownTableCell).join(' | ')} |`,
      `| ${table.headers.map(() => '---').join(' | ')} |`,
      ...table.rows.map(
        (row) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`,
      ),
    ].join('\n'))
    .join('\n\n');
  return normalizeSteelChunkMarkdown('ocr_result_chunk', content);
}

function getResultPageRanges(
  file: OcrPreprocessingFile,
  chunks: readonly OcrPageRange[],
): OcrPageRange[] {
  return isImageOcrFile(file)
    ? []
    : chunks.map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd }));
}

function hasMissingRawChunk(
  state: OcrPreprocessingState,
  chunks: readonly OcrPreprocessingPageChunk[],
) {
  return chunks.some((chunk) => !isSavedRawChunk(state, chunk));
}

function hasCompleteOrganizedChunks(
  state: OcrPreprocessingState,
  chunks: readonly OcrPreprocessingPageChunk[],
): boolean {
  const saved = new Set(
    state.chunks
      .filter(
        (chunk) =>
          chunk.organizedSaved &&
          typeof chunk.organizedMarkdown === 'string' &&
          chunk.organizedMarkdown.trim() !== '',
      )
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

function didCaptureSave(
  result: CaptureToolResultResult,
  memoryKind: 'paddleocr_preflight' | 'ocr_preprocessing_chunk_markdown',
): boolean {
  return (result?.savedCounts?.[memoryKind] ?? 0) > 0;
}

async function readPreprocessingState(
  input: RunOcrPreprocessingBatchPipelineInput,
  file: OcrPreprocessingFile,
) {
  throwIfAborted(input.signal);
  const state = await input.memory.readOcrPreprocessingState({
    conversationId: input.conversationId,
    sourcePdfKey: file.sourcePdfKey,
    ocrFileKey: file.ocrFileKey,
    ocrRuleVersion: input.ocrRuleVersion,
  });
  throwIfAborted(input.signal);
  return state;
}

async function emitFileProgress(
  input: RunOcrPreprocessingBatchPipelineInput,
  file: OcrPreprocessingFile,
  progress: OcrPreprocessingPipelineProgress,
) {
  throwIfAborted(input.signal);
  await input.onProgress?.({ file, progress });
  throwIfAborted(input.signal);
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

interface OcrPipelineRun {
  input: RunOcrPreprocessingBatchPipelineInput;
  turnIndex: number;
  checkpointTurnIndex: number;
  resultSlots: Array<RunOcrPreprocessingBatchFileResult | undefined>;
  workItems: OcrPreprocessingBatchWorkItem[];
}

/** Splits files into ready results and work items that still need OCR or organizing. */
async function planOcrWorkItems({ input, resultSlots, workItems }: OcrPipelineRun): Promise<void> {
  for (let index = 0; index < input.files.length; index += 1) {
    throwIfAborted(input.signal);
    const entry = input.files[index];
    if (!entry) {
      continue;
    }
    let effectiveChunks: OcrPreprocessingPageChunk[];
    try {
      let resolvedChunks: readonly OcrPreprocessingPageChunk[] = entry.chunks;
      if (entry.artifacts.resolveCanonicalChunks) {
        throwIfAborted(input.signal);
        resolvedChunks = await entry.artifacts.resolveCanonicalChunks({
          sourcePdfKey: entry.file.sourcePdfKey,
          chunks: resolvedChunks,
        });
        throwIfAborted(input.signal);
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
    for (const chunk of effectiveChunks) {
      if (isSavedRawChunk(state, chunk)) {
        await emitFileProgress(input, entry.file, {
          stage: 'paddleocr_chunk_loaded',
          chunkIndex: chunk.chunkIndex,
          chunkCount,
        });
      }
    }
    const savedChunkMarkdowns = getExpectedSavedChunkMarkdowns(state, effectiveChunks);
    if (effectiveChunks.length > 0 && hasCompleteOrganizedChunks(state, effectiveChunks)) {
      for (const chunk of effectiveChunks) {
        if (isSavedOrganizedChunk(state, chunk)) {
          await emitFileProgress(input, entry.file, {
            stage: 'organizer_chunk_loaded',
            chunkIndex: chunk.chunkIndex,
            chunkCount,
          });
        }
      }
      await emitMergedMarkdownProgress({
        pipeline: input,
        file: entry.file,
        chunkCount,
      });
      const markdown = mergeChunkMarkdownForFileKey({
        ocrFileKey: entry.file.ocrFileKey,
        ocrRuleVersion: input.ocrRuleVersion,
        chunks: savedChunkMarkdowns,
      });
      resultSlots[index] = {
        file: entry.file,
        status: 'ready',
        markdown,
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
}

/** Ensures PDF chunk artifacts for work items that still need OCR or organizing. */
async function prepareOcrArtifacts({
  input,
  resultSlots,
  workItems,
}: OcrPipelineRun): Promise<void> {
  for (const workItem of workItems) {
    const needsArtifacts =
      hasMissingRawChunk(workItem.initialState, workItem.chunks) ||
      workItem.chunks.some((chunk) => !isSavedOrganizedChunk(workItem.initialState, chunk));
    if (!needsArtifacts) {
      continue;
    }
    let artifacts: OcrPdfChunkArtifact[];
    try {
      throwIfAborted(input.signal);
      artifacts = await workItem.artifactStore.ensurePdfChunkArtifacts({
        file: workItem.file,
        sourcePdfKey: workItem.file.sourcePdfKey,
        chunks: workItem.chunks,
      });
      throwIfAborted(input.signal);
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
}

/** Any failed file stops the batch: no further chunk is started. */
function hasPipelineFailure({ resultSlots, workItems }: OcrPipelineRun): boolean {
  return (
    resultSlots.some((result) => result?.status === 'failed') ||
    workItems.some((workItem) => workItem.failures.length > 0)
  );
}

/**
 * Runs and saves PaddleOCR for every missing raw chunk. A failed chunk is
 * halved down to the minimum size; a minimum-size chunk that still fails is
 * saved as `paddle_failed` and the Organizer reads its PDF pages alone.
 */
async function runRawOcrPhase(run: OcrPipelineRun): Promise<void> {
  const { input, turnIndex, checkpointTurnIndex } = run;

  const saveRawChunk = async (captureInput: {
    workItem: OcrPreprocessingBatchWorkItem;
    chunk: OcrPreprocessingPageChunk;
    artifact: OcrPdfChunkArtifact;
    rawResultHash: string;
    data: unknown;
    paddleFailed?: boolean;
  }) => {
    const { workItem, chunk, artifact } = captureInput;
    throwIfAborted(input.signal);
    const captureResult = await input.memory.capturePaddleOcrChunkResult({
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
      rawResultHash: captureInput.rawResultHash,
      data: captureInput.data,
      ...(captureInput.paddleFailed ? { paddleFailed: true } : {}),
      includeTotals: false,
    });
    throwIfAborted(input.signal);
    if (!didCaptureSave(captureResult, 'paddleocr_preflight')) {
      return;
    }
    await emitFileProgress(input, workItem.file, {
      stage: 'paddleocr_chunk_saved',
      chunkIndex: chunk.chunkIndex,
      chunkCount: workItem.chunkCount,
    });
  };

  const runPaddleOcr = async (
    workItem: OcrPreprocessingBatchWorkItem,
    chunk: OcrPreprocessingPageChunk,
    artifact: OcrPdfChunkArtifact,
  ): Promise<PaddleOcrChunkRunResult> => {
    await emitFileProgress(input, workItem.file, {
      stage: 'paddleocr_chunk_started',
      chunkIndex: chunk.chunkIndex,
      chunkCount: workItem.chunkCount,
    });
    const raw = await input.paddleOcr.runChunk({ file: workItem.file, chunk, artifact });
    throwIfAborted(input.signal);
    const effectiveArtifact = raw.artifact ?? artifact;
    if (
      effectiveArtifact.pageStart !== chunk.pageStart ||
      effectiveArtifact.pageEnd !== chunk.pageEnd
    ) {
      throw new Error(
        `PaddleOCR returned an artifact for the wrong page range ${effectiveArtifact.pageStart}-${effectiveArtifact.pageEnd}`,
      );
    }
    workItem.pdfChunkArtifacts = (workItem.pdfChunkArtifacts ?? []).map((candidate) =>
      candidate.pageStart === chunk.pageStart && candidate.pageEnd === chunk.pageEnd
        ? effectiveArtifact
        : candidate,
    );
    return { ...raw, artifact: effectiveArtifact };
  };

  /** Commits the split marker, so a resumed run reads the halved ranges too. */
  const commitSplit = async (
    workItem: OcrPreprocessingBatchWorkItem,
    chunk: OcrPreprocessingPageChunk,
    split: readonly OcrPreprocessingPageChunk[],
  ): Promise<OcrPreprocessingPageChunk[]> => {
    const nextChunks = normalizeOcrPageChunks([
      ...workItem.chunks.filter(
        (candidate) => getOcrPageRangeKey(candidate) !== getOcrPageRangeKey(chunk),
      ),
      ...split,
    ]);
    throwIfAborted(input.signal);
    const nextArtifacts = await workItem.artifactStore.commitPdfChunkSplit!({
      file: workItem.file,
      sourcePdfKey: workItem.file.sourcePdfKey,
      parent: chunk,
      children: split,
      chunks: nextChunks,
    });
    throwIfAborted(input.signal);
    workItem.chunks = nextChunks;
    workItem.chunkCount = nextChunks.length;
    workItem.pdfChunkArtifacts = nextArtifacts;
    const childKeys = new Set(split.map(getOcrPageRangeKey));
    return nextChunks.filter((candidate) => childKeys.has(getOcrPageRangeKey(candidate)));
  };

  const runChunk = async (
    workItem: OcrPreprocessingBatchWorkItem,
    chunk: OcrPreprocessingPageChunk,
  ): Promise<void> => {
    let artifact: OcrPdfChunkArtifact;
    try {
      artifact = findArtifact({
        file: workItem.file,
        artifacts: workItem.pdfChunkArtifacts ?? [],
        chunk,
      });
    } catch (artifactError) {
      workItem.failures.push(toFailure({ stage: 'artifacts', chunk, error: artifactError }));
      return;
    }

    let raw: PaddleOcrChunkRunResult | undefined;
    let paddleError: unknown;
    try {
      raw = await runPaddleOcr(workItem, chunk, artifact);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      paddleError = error;
    }

    if (raw) {
      try {
        await saveRawChunk({
          workItem,
          chunk,
          artifact: raw.artifact ?? artifact,
          rawResultHash: raw.rawResultHash,
          data: raw.rawResult,
        });
      } catch (saveError) {
        if (isAbortError(saveError)) {
          throw saveError;
        }
        workItem.failures.push(toFailure({ stage: 'state', chunk, error: saveError }));
      }
      return;
    }

    const split = workItem.artifactStore.commitPdfChunkSplit ? splitOcrPageRange(chunk) : undefined;
    if (split) {
      let children: OcrPreprocessingPageChunk[];
      try {
        children = await commitSplit(workItem, chunk, split);
      } catch (splitError) {
        if (isAbortError(splitError)) {
          throw splitError;
        }
        workItem.failures.push(toFailure({ stage: 'artifacts', chunk, error: splitError }));
        return;
      }
      for (const child of children) {
        if (hasPipelineFailure(run)) {
          return;
        }
        await runChunk(workItem, child);
      }
      return;
    }

    const failure = toPaddleOcrFailure({ chunk, artifact, error: paddleError });
    logger.warn(
      '[Steel OCR] PaddleOCR gave up on a chunk; the Organizer reads its PDF pages alone',
      {
        conversationId: input.conversationId,
        requestId: input.requestId,
        ocrFileKey: workItem.file.ocrFileKey,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        error: failure.errorMessage,
      },
    );
    try {
      await saveRawChunk({
        workItem,
        chunk,
        artifact,
        rawResultHash: paddleFailedRawResultHash,
        data: {
          paddleOcrFailed: true,
          errorMessage: failure.errorMessage,
          ...(failure.diagnosticCode ? { diagnosticCode: failure.diagnosticCode } : {}),
        },
        paddleFailed: true,
      });
    } catch (saveError) {
      if (isAbortError(saveError)) {
        throw saveError;
      }
      workItem.failures.push(toFailure({ stage: 'state', chunk, error: saveError }));
    }
  };

  for (const workItem of run.workItems) {
    for (const chunk of [...workItem.chunks]) {
      throwIfAborted(input.signal);
      if (hasPipelineFailure(run)) {
        return;
      }
      if (!isSavedRawChunk(workItem.initialState, chunk)) {
        await runChunk(workItem, chunk);
      }
    }
  }
}

/** Re-reads state after raw OCR and reports chunks that are already organized. */
async function loadOrganizerPreflightState({
  input,
  resultSlots,
  workItems,
}: OcrPipelineRun): Promise<void> {
  for (const workItem of workItems) {
    throwIfAborted(input.signal);
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
    if (workItem.preflightState) {
      for (const chunk of workItem.chunks) {
        if (isSavedOrganizedChunk(workItem.preflightState, chunk)) {
          await emitFileProgress(input, workItem.file, {
            stage: 'organizer_chunk_loaded',
            chunkIndex: chunk.chunkIndex,
            chunkCount: workItem.chunkCount,
          });
        }
      }
    }
  }
}

/**
 * Organizes every raw chunk that has no saved organizer Markdown yet. The
 * Organizer always reads the chunk's PDF pages and compares them with the raw
 * PaddleOCR text when there is one. Each chunk gets three attempts; a chunk
 * that still fails stops the batch.
 */
async function runOrganizerPhase(run: OcrPipelineRun): Promise<void> {
  const { input, turnIndex, checkpointTurnIndex } = run;

  const organizeChunk = async (
    workItem: OcrPreprocessingBatchWorkItem,
    chunk: OcrPreprocessingPageChunk,
    savedChunk: OcrPreprocessingState['chunks'][number],
  ): Promise<string> => {
    let artifact = findArtifact({
      file: workItem.file,
      artifacts: workItem.pdfChunkArtifacts ?? [],
      chunk,
    });
    const isImage = isImageOcrFile(workItem.file);
    return runWithSteelOcrRetries({
      signal: input.signal,
      isRetryable: (error) => !isAbortError(error),
      run: async (attemptNumber) => {
        await emitFileProgress(input, workItem.file, {
          stage: 'organizer_chunk_started',
          chunkIndex: chunk.chunkIndex,
          chunkCount: workItem.chunkCount,
        });
        if (attemptNumber > 1 && workItem.artifactStore.refreshPdfChunkArtifact) {
          artifact = await workItem.artifactStore.refreshPdfChunkArtifact({
            file: workItem.file,
            chunk,
            artifact,
          });
        }
        if (typeof artifact.filepath !== 'string' || artifact.filepath.trim() === '') {
          throw new Error(
            `Missing OCR organizer artifact URL for ${workItem.file.ocrFileKey} chunk ${chunk.chunkIndex}`,
          );
        }
        throwIfAborted(input.signal);
        const organizerResult = await input.organizer.organize({
          ocrRulesText: input.ocrRulesText,
          ...(savedChunk.rawOcrText !== undefined ? { rawOcrText: savedChunk.rawOcrText } : {}),
          fileKey: normalizeOcrOrganizerFileKey({
            fileKey: workItem.file.ocrFileKey,
            fileId: workItem.file.fileId ?? workItem.file.file_id ?? workItem.file.id,
          }),
          sourceFile: getOcrSourceFile(workItem.file) ?? null,
          artifactUrl: artifact.filepath,
          ...(workItem.file.mediaType ? { mediaType: workItem.file.mediaType } : {}),
          ...(isImage
            ? {}
            : {
                pageStart: chunk.pageStart,
                pageEnd: chunk.pageEnd,
                chunkIndex: chunk.chunkIndex,
                chunkCount: workItem.chunkCount,
              }),
        });
        throwIfAborted(input.signal);
        return normalizeOrganizerMarkdown(organizerResult.markdown, artifact.filepath);
      },
    });
  };

  /** A failed save is retried on its own; the Organizer answer is not regenerated. */
  const saveOrganizedChunk = (
    workItem: OcrPreprocessingBatchWorkItem,
    chunk: OcrPreprocessingPageChunk,
    rawResultHash: string,
    markdown: string,
  ) =>
    runWithSteelOcrRetries({
      signal: input.signal,
      isRetryable: (error) => !isAbortError(error),
      run: async () => {
        throwIfAborted(input.signal);
        const captureResult = await input.memory.captureOcrPreprocessingChunkMarkdown({
          conversationId: input.conversationId,
          requestId: input.requestId,
          turnIndex,
          checkpointTurnIndex,
          file: workItem.file,
          chunk: {
            ...chunk,
            sourcePdfKey: workItem.file.sourcePdfKey,
          },
          rawResultHash,
          ocrRuleVersion: input.ocrRuleVersion,
          content: markdown,
          includeTotals: false,
        });
        throwIfAborted(input.signal);
        if (!didCaptureSave(captureResult, 'ocr_preprocessing_chunk_markdown')) {
          throw new Error(
            `OCR result chunk for pages ${chunk.pageStart}-${chunk.pageEnd} was not saved`,
          );
        }
      },
    });

  for (const workItem of run.workItems) {
    throwIfAborted(input.signal);
    if (hasPipelineFailure(run)) {
      return;
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
      return;
    }

    for (const chunk of workItem.chunks) {
      throwIfAborted(input.signal);
      if (isSavedOrganizedChunk(preflightState, chunk)) {
        continue;
      }
      const savedChunk = getSavedChunk(preflightState, chunk);
      const rawResultHash = savedChunk?.rawResultHash;
      if (!savedChunk || !rawResultHash || !isSavedRawChunk(preflightState, chunk)) {
        workItem.failures.push(
          toFailure({
            stage: 'state',
            chunk,
            error: new Error(
              `Missing OCR preprocessing raw data for ${workItem.file.ocrFileKey} chunk ${chunk.chunkIndex}`,
            ),
          }),
        );
        return;
      }

      let markdown: string;
      try {
        markdown = await organizeChunk(workItem, chunk, savedChunk);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        workItem.failures.push(toFailure({ stage: 'organizer', chunk, error }));
        return;
      }
      try {
        await saveOrganizedChunk(workItem, chunk, rawResultHash, markdown);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        workItem.failures.push(toFailure({ stage: 'state', chunk, error }));
        return;
      }
      await emitFileProgress(input, workItem.file, {
        stage: 'organizer_chunk_saved',
        chunkIndex: chunk.chunkIndex,
        chunkCount: workItem.chunkCount,
      });
    }
  }
}

/** Merges each file's organized chunks into its final result slot. */
async function collectOcrResults({ input, resultSlots, workItems }: OcrPipelineRun): Promise<void> {
  for (const workItem of workItems) {
    throwIfAborted(input.signal);
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
}

/**
 * The turn error for files whose OCR result chunks could not all be produced.
 * Saved chunks stay for a resumed run; the turn is not rerun.
 */
export function toSteelOcrChunkError(
  failedFiles: readonly RunOcrPreprocessingFailedFileResult[],
): SteelOcrChunkError {
  return createSteelOcrChunkError(
    failedFiles.flatMap((result) =>
      (result.failures.length > 0 ? result.failures : [result]).map((failure) => ({
        ...failure,
        label: result.file.ocrFileKey,
      })),
    ),
  );
}

export async function runOcrPreprocessingBatchPipeline(
  input: RunOcrPreprocessingBatchPipelineInput,
): Promise<RunOcrPreprocessingBatchPipelineResult> {
  const turnIndex = input.turnIndex ?? 0;
  const run: OcrPipelineRun = {
    input,
    turnIndex,
    checkpointTurnIndex: input.checkpointTurnIndex ?? turnIndex,
    resultSlots: new Array<RunOcrPreprocessingBatchFileResult | undefined>(input.files.length),
    workItems: [],
  };
  await planOcrWorkItems(run);
  await prepareOcrArtifacts(run);
  await runRawOcrPhase(run);
  await loadOrganizerPreflightState(run);
  await runOrganizerPhase(run);
  await collectOcrResults(run);
  return {
    files: run.resultSlots.filter(
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
    signal: input.signal,
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
