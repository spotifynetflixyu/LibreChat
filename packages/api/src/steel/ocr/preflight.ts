import mongoose from 'mongoose';
import { FileSources } from 'librechat-data-provider';
import { logger, redactMessage } from '@librechat/data-schemas';
import { createSteelOcrRunMethods } from '@librechat/data-schemas';
import type { AllMethods, SteelOcrRunMethods } from '@librechat/data-schemas';
import type { Readable } from 'node:stream';
import type { Response } from 'express';
import type {
  SteelPaddleOcrServer,
  SteelPaddleOcrRequest,
  SteelPaddleOcrMcpScope,
  SteelPaddleOcrChunkStatus,
  CreateSteelPaddleOcrChunkRunnerInput,
} from './paddle';
import type {
  OcrPreprocessingFile,
  OcrPreprocessingFailure,
  RunOcrPreprocessingBatchFileInput,
} from './preprocess';
import type {
  SteelOcrFile,
  SteelOcrPreprocessingRules,
  SteelOcrPreprocessingSourceFile,
} from './files';
import type { SteelRepositoryClient } from '../repositories/types';
import type { SteelOcrFileReference } from '../memory/service';
import type { SteelNativeHistory } from '../native/events';
import type { SteelOcrStoredFileRecord } from './storage';
import type { SteelOcrOrganizerAgent } from './agent';
import type { SteelOcrStateService } from './state';
import type { SteelPaddleOcrAgent } from './paddle';
import type { OcrPageRange } from './chunks';
import {
  isHttpUrl,
  isPdfSteelFile,
  getSteelFileId,
  buildSingleOriginalOcrChunk,
  toSteelOcrPreprocessingFile,
  getSuggestedOcrResultColumns,
} from './files';
import {
  ensureSteelNativeHistory,
  buildSteelOcrPreprocessingEventEnvelopes,
  buildSteelPaddleOcrPreflightEventEnvelopes,
} from '../native/events';
import {
  getSteelOcrFileDescriptor,
  ocrPreprocessingPipelineVersion,
  createMongooseSteelWorkingOrderMemoryWriter,
} from '../memory/service';
import {
  createSteelOcrPdfChunkArtifactStore,
  createSteelOcrOriginalFileArtifactStore,
} from './storage';
import {
  isSteelOcrAbortError,
  steelPaddleOcrToolName,
  createSteelPaddleOcrChunkRunner,
} from './paddle';
import {
  createMongooseOcrPdfChunkArtifactRepository,
  resolveCanonicalOcrPageChunks,
} from './artifacts';
import { buildPdfPageChunks, getPdfPageCount, normalizeOcrPageChunks } from './chunks';
import { isPaddleOcrDiagnosticCode, PADDLE_OCR_MCP_SERVER_NAME } from './diagnostics';
import { runWithSteelOcrExecution, getSteelOcrFailureStatus } from './control';
import { groupSteelOcrMissingPageRangesByFileKey } from './failures';
import { getSteelRequestConversationId } from '../native/execute';
import { resolveOcrPreprocessingChunkSizePages } from './config';
import { runOcrPreprocessingBatchPipeline } from './preprocess';
import { resolveSteelOcrPreprocessingRules } from './rules';
import { normalizeOcrOrganizerFileKey } from './organizer';
import { emitSteelNativeEvents } from '../native/stream';
import { createSteelOcrStateService } from './state';
import { createSteelOcrChunkError } from './retry';
import { createSteelOcrOrganizer } from './agent';
import { buildMCPToolKey } from '~/mcp/utils';

/** The request fields PaddleOCR preflight reads; its tool cards and activity land on the history. */
export interface SteelOcrPreflightRequest extends SteelPaddleOcrRequest {
  _resumableJobCreatedAt?: number;
  body?: { conversationId?: string };
  steelNativeContext?: {
    conversationId?: string;
    requestId?: string;
    assistantTurnIndex?: number;
    memoryCheckpointTurnIndex?: number;
    currentTurnFiles?: readonly SteelOcrFile[];
    steelHistory?: SteelNativeHistory;
  };
}

/** A failed OCR file or range; any one of them fails the turn. */
export interface SteelOcrCurrentFailure {
  ocrFileKey: string;
  filename?: string;
  mediaType?: string;
  sourceCode?: string;
  sourceFilename: string;
  fileUrl?: string;
  stage: string;
  chunkIndex?: number;
  pageStart?: number;
  pageEnd?: number;
  diagnosticCode?: OcrPreprocessingFailure['diagnosticCode'];
  errorMessage: string;
}

/** The organized Markdown for one current file, as the turn's model receives it. */
export interface SteelOcrMergedMarkdownResult
  extends Omit<SteelOcrFile, 'sourcePdfKey' | 'filepath' | 'path'> {
  sourceFilename: string;
  ocrFileKey: string;
  kind: 'ocr_preprocessing_merged_markdown';
  ocrSource: 'ocr_preprocessing_merge';
  content: string;
  ocrPreprocessing: {
    pipelineVersion: number;
    sourcePdfKey?: string;
    chunkCount: number;
    pageRanges: OcrPageRange[];
    ocrRuleVersion: string;
    source: 'paddleocr_markdowns';
  };
}

export interface SteelPaddleOcrPreflightResult {
  status: 'completed' | 'partial' | 'skipped';
  ocrTurnActive: boolean;
  completedKeys: string[];
  attemptedKeys: string[];
  failedKeys: string[];
  skippedReason?: string;
  currentPaddleOcrResults: [];
  currentPaddleOcrStatuses?: SteelPaddleOcrChunkStatus[];
  currentOcrMarkdownResults?: SteelOcrMergedMarkdownResult[];
  currentOcrSourceFileMapping?: { sourceCode: string; sourceFilename: string }[];
  previousOcrResultMarkdown?: string;
  suggestedOcrResultColumns?: string[];
}

/** The server pieces OCR needs: file records and bytes, rules, and PaddleOCR MCP control. */
export interface SteelOcrServiceDependencies {
  db: Pick<AllMethods, 'getFiles'>;
  client: SteelRepositoryClient;
  getStrategy(source: string): {
    getDownloadStream?(req: SteelOcrPreflightRequest, filePath: string): Promise<Readable>;
  };
  server: SteelPaddleOcrServer;
  stateService?: SteelOcrSourceMappingStore;
  runStore?: Pick<SteelOcrRunMethods, 'createPreflightRun' | 'updatePreflightRun' | 'settleTurn'>;
}

/** The conversation OCR state preflight reads and the source codes it allocates. */
export type SteelOcrSourceMappingStore = Pick<
  SteelOcrStateService,
  'readConversationOcrState' | 'allocateDelegateSourceMapping' | 'readSourceMappings'
>;

export interface RunSteelPaddleOcrPreflightInput extends SteelPaddleOcrMcpScope {
  req: SteelOcrPreflightRequest;
  res?: Response;
  signal?: AbortSignal;
  agent?: SteelPaddleOcrAgent & SteelOcrOrganizerAgent;
  streamId?: string | null;
}

export interface SteelOcrService {
  runSteelPaddleOcrPreflight(
    input: RunSteelPaddleOcrPreflightInput,
  ): Promise<SteelPaddleOcrPreflightResult>;
  createPaddleOcrChunkRunner(
    input: Omit<CreateSteelPaddleOcrChunkRunnerInput, 'server'>,
  ): ReturnType<typeof createSteelPaddleOcrChunkRunner>;
  resolvePreprocessingRules(): Promise<SteelOcrPreprocessingRules>;
  createOrganizer: typeof createSteelOcrOrganizer;
  createPdfChunkArtifactStore: typeof createSteelOcrPdfChunkArtifactStore;
}

type SteelOcrVisibleFile = SteelOcrPreprocessingSourceFile & {
  path?: string;
  storage_key?: string;
  fileUrl?: string;
  file_url?: string;
  ocrFileUrl?: string;
  ocr_file_url?: string;
  url?: string;
  downloadUrl?: string;
  download_url?: string;
  sourceUrl?: string;
  source_url?: string;
};

interface SteelOcrFailureSource {
  fileUrl?: string;
  ocrFileUrl?: string;
  file?: SteelOcrFile & { path?: string };
  stage?: string;
  chunkIndex?: number;
  pageStart?: number;
  pageEnd?: number;
  diagnosticCode?: OcrPreprocessingFailure['diagnosticCode'];
  errorMessage?: string;
}

function readFailureSource(value: unknown): SteelOcrFailureSource {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const source = value as SteelOcrFailureSource;
  const optionalString = (field: unknown) => (typeof field === 'string' ? field : undefined);
  const optionalNumber = (field: unknown) => (typeof field === 'number' ? field : undefined);
  return {
    fileUrl: optionalString(source.fileUrl),
    ocrFileUrl: optionalString(source.ocrFileUrl),
    file: source.file && typeof source.file === 'object' ? source.file : undefined,
    stage: optionalString(source.stage),
    chunkIndex: optionalNumber(source.chunkIndex),
    pageStart: optionalNumber(source.pageStart),
    pageEnd: optionalNumber(source.pageEnd),
    diagnosticCode: isPaddleOcrDiagnosticCode(source.diagnosticCode)
      ? source.diagnosticCode
      : undefined,
    errorMessage: optionalString(source.errorMessage),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function getSteelOcrSourceCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^F[1-9][0-9]*$/u.test(value) ? value : undefined;
}

/** Working-order memory keys OCR captures by file identity, not by this conversation's source code. */
function withoutSteelOcrSourceCode(
  file: SteelOcrFileReference & { sourceCode?: string },
): SteelOcrFileReference {
  const { sourceCode: _sourceCode, ...metadata } = file;
  return metadata;
}

function normalizeSafeSteelAiUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function createCurrentOcrFailureResult({
  file,
  result,
  errorMessage,
}: {
  file: SteelOcrPreprocessingSourceFile;
  result?: unknown;
  errorMessage?: string;
}): SteelOcrCurrentFailure {
  const failure = readFailureSource(result);
  const fileUrl = [
    failure.fileUrl,
    failure.ocrFileUrl,
    failure.file?.filepath,
    failure.file?.path,
    file.filepath,
  ]
    .map(normalizeSafeSteelAiUrl)
    .find((value) => value !== undefined);
  const sourceCode = getSteelOcrSourceCode(failure.file?.sourceCode ?? file.sourceCode);
  return {
    ocrFileKey: failure.file?.ocrFileKey ?? file.ocrFileKey,
    filename: failure.file?.filename ?? file.filename,
    mediaType: failure.file?.mediaType ?? file.mediaType,
    ...(sourceCode ? { sourceCode } : {}),
    sourceFilename: file.sourceFilename,
    ...(fileUrl ? { fileUrl } : {}),
    stage: failure.stage ?? 'preflight',
    ...(failure.chunkIndex !== undefined ? { chunkIndex: failure.chunkIndex } : {}),
    ...(failure.pageStart !== undefined ? { pageStart: failure.pageStart } : {}),
    ...(failure.pageEnd !== undefined ? { pageEnd: failure.pageEnd } : {}),
    ...(failure.diagnosticCode ? { diagnosticCode: failure.diagnosticCode } : {}),
    errorMessage: redactMessage(
      failure.errorMessage ?? errorMessage ?? 'OCR preprocessing failed',
      512,
    ),
  };
}

function sanitizeCurrentOcrPageRanges(
  pageRanges: readonly OcrPageRange[],
  chunkCount: number,
): OcrPageRange[] {
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || pageRanges.length !== chunkCount) {
    return [];
  }

  const sanitized: OcrPageRange[] = [];
  for (const range of pageRanges) {
    if (
      !Number.isInteger(range.pageStart) ||
      range.pageStart < 1 ||
      !Number.isInteger(range.pageEnd) ||
      range.pageEnd < range.pageStart
    ) {
      return [];
    }
    const previous = sanitized[sanitized.length - 1];
    if (previous && range.pageStart !== previous.pageEnd + 1) {
      return [];
    }
    sanitized.push({ pageStart: range.pageStart, pageEnd: range.pageEnd });
  }
  return sanitized;
}

function createCurrentOcrMergedMarkdownResult({
  file,
  markdown,
  chunkCount,
  pageRanges = [],
  ocrRuleVersion,
}: {
  file: SteelOcrVisibleFile;
  markdown: string;
  chunkCount: number;
  pageRanges?: readonly OcrPageRange[];
  ocrRuleVersion: string;
}): SteelOcrMergedMarkdownResult {
  const safeOcrFileKey = normalizeOcrOrganizerFileKey({
    fileKey:
      file.ocrFileKey ??
      file.fileId ??
      file.file_id ??
      file.id ??
      file.storageKey ??
      file.storage_key ??
      file.filepath ??
      file.path ??
      '',
    fileId: file.fileId ?? file.file_id ?? file.id,
  });
  const {
    sourceCode: rawSourceCode,
    sourceFilename,
    sourcePdfKey,
    filepath: _filepath,
    path: _path,
    fileUrl: _fileUrl,
    file_url: _file_url,
    ocrFileUrl: _ocrFileUrl,
    ocr_file_url: _ocr_file_url,
    url: _url,
    downloadUrl: _downloadUrl,
    download_url: _download_url,
    sourceUrl: _sourceUrl,
    source_url: _source_url,
    storageKey,
    storage_key: storageKeySnake,
    ...visibleFile
  } = file;
  const sourceCode = getSteelOcrSourceCode(rawSourceCode);
  return {
    ...visibleFile,
    ...(storageKey !== undefined && !isHttpUrl(storageKey) ? { storageKey } : {}),
    ...(storageKeySnake !== undefined && !isHttpUrl(storageKeySnake)
      ? { storage_key: storageKeySnake }
      : {}),
    ...(sourceCode ? { sourceCode } : {}),
    sourceFilename: typeof sourceFilename === 'string' ? sourceFilename : '',
    ocrFileKey: safeOcrFileKey,
    kind: 'ocr_preprocessing_merged_markdown',
    ocrSource: 'ocr_preprocessing_merge',
    content: `<${safeOcrFileKey}>\n${markdown}`,
    ocrPreprocessing: {
      pipelineVersion: ocrPreprocessingPipelineVersion,
      ...(isHttpUrl(sourcePdfKey) ? {} : { sourcePdfKey }),
      chunkCount,
      pageRanges: sanitizeCurrentOcrPageRanges(pageRanges, chunkCount),
      ocrRuleVersion,
      source: 'paddleocr_markdowns',
    },
  };
}

/** Drops a failed chunk's status once its adaptive child ranges fully covered it. */
function getFinalPaddleOcrChunkStatuses(
  statuses: readonly SteelPaddleOcrChunkStatus[],
): SteelPaddleOcrChunkStatus[] {
  return statuses.filter((status, index) => {
    const { pageStart, pageEnd } = status;
    if (
      status.paddleocr !== 'fail' ||
      !Number.isSafeInteger(pageStart) ||
      !Number.isSafeInteger(pageEnd)
    ) {
      return true;
    }
    const start = pageStart as number;
    const end = pageEnd as number;
    const childRanges = statuses
      .slice(index + 1)
      .filter(
        (candidate): candidate is SteelPaddleOcrChunkStatus & OcrPageRange =>
          candidate.ocrFileKey === status.ocrFileKey &&
          Number.isSafeInteger(candidate.pageStart) &&
          Number.isSafeInteger(candidate.pageEnd) &&
          (candidate.pageStart as number) >= start &&
          (candidate.pageEnd as number) <= end &&
          ((candidate.pageStart as number) > start || (candidate.pageEnd as number) < end),
      )
      .sort((left, right) => left.pageStart - right.pageStart);
    let nextPage = start;
    for (const child of childRanges) {
      if (child.pageStart > nextPage) {
        return true;
      }
      nextPage = Math.max(nextPage, child.pageEnd + 1);
      if (nextPage > end) {
        return false;
      }
    }
    return true;
  });
}

function toReusableOcrPreprocessingChunks(
  state: Awaited<
    ReturnType<
      ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>['readOcrPreprocessingState']
    >
  >,
  fallbackChunkSizePages: number,
) {
  const chunks = state.chunks ?? [];
  if (chunks.length === 0) {
    return undefined;
  }
  const reusableChunks = chunks.filter(
    (chunk) =>
      chunk.rawSaved &&
      chunk.organizedSaved &&
      chunk.organizedMarkdown !== undefined &&
      Number.isInteger(chunk.pageStart) &&
      Number.isInteger(chunk.pageEnd),
  );
  if (reusableChunks.length !== chunks.length) {
    return undefined;
  }
  try {
    return normalizeOcrPageChunks(
      reusableChunks.map((chunk) => ({
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        chunkSizePages: chunk.chunkSizePages ?? fallbackChunkSizePages,
      })),
    );
  } catch {
    return undefined;
  }
}

async function readStreamBytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Builds the Steel OCR service: PaddleOCR preflight for a turn's current files,
 * plus the runner, organizer, rules and artifact stores delegate OCR reuses.
 */
export function createSteelOcrService(deps: SteelOcrServiceDependencies): SteelOcrService {
  const getStateService = (): SteelOcrSourceMappingStore =>
    deps.stateService ?? createSteelOcrStateService(mongoose);
  const resolvePreprocessingRules = () => resolveSteelOcrPreprocessingRules(deps.client);
  const createPaddleOcrChunkRunner: SteelOcrService['createPaddleOcrChunkRunner'] = (input) =>
    createSteelPaddleOcrChunkRunner({ ...input, server: deps.server });

  async function getSteelCurrentFileRecords(
    req: SteelOcrPreflightRequest,
    files: readonly SteelOcrFile[],
  ): Promise<Map<string, SteelOcrStoredFileRecord>> {
    const fileIds = uniqueStrings(files.map(getSteelFileId).filter((id): id is string => !!id));
    const userId = req.user?.id;
    if (!userId || fileIds.length === 0) {
      return new Map();
    }
    const records =
      (await deps.db.getFiles(
        {
          file_id: { $in: fileIds },
          user: userId,
          ...(req.user?.tenantId ? { tenantId: req.user.tenantId } : {}),
        },
        {},
        {},
      )) ?? [];
    const recordsById = new Map<string, SteelOcrStoredFileRecord>();
    for (const record of records) {
      const fileId = getSteelFileId(record);
      if (fileId) {
        recordsById.set(fileId, record);
      }
    }
    return recordsById;
  }

  async function readSteelStoredFileBytes(
    req: SteelOcrPreflightRequest,
    fileRecord: SteelOcrStoredFileRecord,
  ): Promise<Buffer> {
    const source = fileRecord.source ?? FileSources.local;
    const { getDownloadStream } = deps.getStrategy(source);
    if (!getDownloadStream) {
      throw new Error(`File source "${source}" is not downloadable`);
    }
    const filePath = fileRecord.storageKey || fileRecord.filepath;
    if (!filePath) {
      throw new Error(
        `File "${fileRecord.file_id ?? fileRecord.filename ?? 'unknown'}" has no filepath`,
      );
    }
    return readStreamBytes(await getDownloadStream(req, filePath));
  }

  async function runPreflight({
    req,
    res,
    signal,
    agent,
    streamId = null,
    userMCPAuthMap,
    requestScopedConnections,
    flow,
  }: RunSteelPaddleOcrPreflightInput & {
    flow?: {
      runId: string;
      getSummary: () => { stage: string; completedChunks: number; totalChunks: number };
      track: (
        file: Pick<OcrPreprocessingFile, 'ocrFileKey' | 'filename'>,
        progress: Parameters<typeof buildSteelOcrPreprocessingEventEnvelopes>[0]['progress'],
      ) => Promise<{
        runId: string;
        kind: 'preflight';
        stage: string;
        flowStatus: 'running' | 'failed';
        completedChunks: number;
        totalChunks: number;
      }>;
    };
  }): Promise<SteelPaddleOcrPreflightResult> {
    const nativeContext = req.steelNativeContext;
    if (nativeContext) {
      ensureSteelNativeHistory(nativeContext);
    }
    const conversationId = getSteelRequestConversationId(req);
    const turnIndex = nativeContext?.assistantTurnIndex;
    const requestId = nativeContext?.requestId;
    const files = nativeContext?.currentTurnFiles ?? [];
    const attemptedKeys: string[] = [];
    const failedKeys: string[] = [];
    const currentPaddleOcrStatuses: SteelPaddleOcrChunkStatus[] = [];
    const currentOcrMarkdownResults: SteelOcrMergedMarkdownResult[] = [];
    const currentOcrFailures: SteelOcrCurrentFailure[] = [];
    let currentPaddleOcrSavedCount = 0;
    let nextToolEventIndex = 0;
    const eventScope = { conversationId, requestId, messageId: requestId };
    const emitPreprocessing = async (
      file: Pick<OcrPreprocessingFile, 'ocrFileKey' | 'filename'>,
      progress: Parameters<typeof buildSteelOcrPreprocessingEventEnvelopes>[0]['progress'],
    ) => {
      const tracked = flow ? await flow.track(file, progress) : undefined;
      await emitSteelNativeEvents({
        req,
        res,
        streamId,
        events: buildSteelOcrPreprocessingEventEnvelopes({
          ...eventScope,
          ocrFileKey: file.ocrFileKey,
          filename: file.filename,
          progress,
          ...(tracked ?? {}),
        }),
      });
    };
    const finish = async (
      result: Omit<SteelPaddleOcrPreflightResult, 'ocrTurnActive' | 'currentPaddleOcrResults'>,
    ): Promise<SteelPaddleOcrPreflightResult> => {
      const preflight: SteelPaddleOcrPreflightResult = {
        ...result,
        ocrTurnActive:
          result.attemptedKeys.length > 0 || (result.currentOcrMarkdownResults?.length ?? 0) > 0,
        currentPaddleOcrResults: [],
      };
      const summary = flow?.getSummary();
      await emitSteelNativeEvents({
        req,
        res,
        streamId,
        events: buildSteelPaddleOcrPreflightEventEnvelopes({
          ...eventScope,
          preflight: { ...preflight, paddleOcrSavedCount: currentPaddleOcrSavedCount },
          ...(flow && summary
            ? {
                runId: flow.runId,
                kind: 'preflight',
                stage: preflight.status === 'partial' ? 'failed' : 'agent',
                flowStatus: preflight.status === 'partial' ? 'failed' : 'running',
                completedChunks: summary.completedChunks,
                totalChunks: summary.totalChunks,
              }
            : {}),
        }),
      });
      return preflight;
    };
    const skip = (skippedReason: string) =>
      finish({ status: 'skipped', completedKeys: [], attemptedKeys, failedKeys, skippedReason });

    if (!conversationId) {
      return skip('missing_conversation_id');
    }
    if (turnIndex === undefined) {
      return skip('missing_turn_index');
    }
    if (files.length === 0) {
      return skip('no_current_files');
    }

    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const ocrStateService = getStateService();
    const conversationOcrState = await ocrStateService.readConversationOcrState(conversationId);
    const previousOcrResultMarkdown = conversationOcrState?.currentOcrResultMarkdown;
    const suggestedOcrResultColumns = getSuggestedOcrResultColumns(previousOcrResultMarkdown);
    const currentTargets = files.flatMap((originalFile) => {
      const descriptor = getSteelOcrFileDescriptor(originalFile);
      return descriptor ? [{ originalFile, descriptor, sourceCode: '' }] : [];
    });
    currentTargets.forEach((target, index) => {
      target.sourceCode = `F${index + 1}`;
    });
    const fileRecordsById = await getSteelCurrentFileRecords(req, files);
    for (const target of currentTargets) {
      const fileId = target.descriptor.fileId;
      const sourceFilename = fileId ? (fileRecordsById.get(fileId)?.filename?.trim() ?? '') : '';
      if (!fileId || !sourceFilename) {
        continue;
      }
      const mapping = await ocrStateService.allocateDelegateSourceMapping({
        conversationId,
        fileId,
        sourceFilename,
      });
      target.sourceCode = mapping.sourceCode;
    }
    const currentOcrSourceFileMapping = (
      await ocrStateService.readSourceMappings(conversationId)
    ).map(({ sourceCode, sourceFilename }) => ({ sourceCode, sourceFilename }));
    const toolName = buildMCPToolKey(steelPaddleOcrToolName, PADDLE_OCR_MCP_SERVER_NAME);

    if (currentTargets.length === 0) {
      return skip('no_ocr_capable_files');
    }

    let ocrPreprocessingRules: SteelOcrPreprocessingRules | undefined;
    const ocrPreprocessingChunkSizePages = resolveOcrPreprocessingChunkSizePages();
    const batchFiles: RunOcrPreprocessingBatchFileInput[] = [];
    const batchSourceFiles = new Map<string, SteelOcrPreprocessingSourceFile>();
    for (const target of currentTargets) {
      const fileRecord = target.descriptor.fileId
        ? fileRecordsById.get(target.descriptor.fileId)
        : undefined;
      const preprocessingFile = toSteelOcrPreprocessingFile(
        { ...target.originalFile, ...target.descriptor, sourceCode: target.sourceCode },
        fileRecord,
      );
      if (!preprocessingFile) {
        continue;
      }

      attemptedKeys.push(preprocessingFile.ocrFileKey);
      try {
        ocrPreprocessingRules ??= await resolvePreprocessingRules();
        const existingState = await writer.readOcrPreprocessingState({
          conversationId,
          sourcePdfKey: preprocessingFile.sourcePdfKey,
          ocrFileKey: preprocessingFile.ocrFileKey,
          ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
        });
        const reusableChunks = toReusableOcrPreprocessingChunks(
          existingState,
          ocrPreprocessingChunkSizePages,
        );
        const isPdfRecord = isPdfSteelFile(preprocessingFile) && fileRecord !== undefined;
        let entry: RunOcrPreprocessingBatchFileInput | undefined;

        if (reusableChunks && isPdfRecord) {
          const artifactRows = await createMongooseOcrPdfChunkArtifactRepository(
            mongoose,
          ).findBySourcePdfKey({
            sourcePdfKey: preprocessingFile.sourcePdfKey,
            pipelineVersion: ocrPreprocessingPipelineVersion,
          });
          const canonicalChunks = resolveCanonicalOcrPageChunks({
            defaultChunks: reusableChunks,
            artifactRows: artifactRows ?? [],
          });
          const reusablePlanIsCanonical =
            canonicalChunks.length === reusableChunks.length &&
            canonicalChunks.every(
              (chunk, index) =>
                chunk.pageStart === reusableChunks[index]?.pageStart &&
                chunk.pageEnd === reusableChunks[index]?.pageEnd,
            );
          if (reusablePlanIsCanonical) {
            entry = {
              file: preprocessingFile,
              chunks: canonicalChunks,
              artifacts: createSteelOcrOriginalFileArtifactStore({
                file: preprocessingFile,
                fileRecord,
              }),
            };
          }
        }

        if (!entry && reusableChunks && !isPdfRecord) {
          entry = {
            file: preprocessingFile,
            chunks: reusableChunks,
            artifacts: createSteelOcrOriginalFileArtifactStore({
              file: preprocessingFile,
              fileRecord,
            }),
          };
        } else if (!entry && isPdfRecord && fileRecord) {
          const pdfBytes = await readSteelStoredFileBytes(req, fileRecord);
          const pageCount = await getPdfPageCount({ pdfBytes });
          entry = {
            file: preprocessingFile,
            chunks: buildPdfPageChunks({
              pageCount,
              chunkSizePages: ocrPreprocessingChunkSizePages,
            }),
            artifacts: createSteelOcrPdfChunkArtifactStore({
              file: preprocessingFile,
              fileRecord,
              pdfBytes,
            }),
          };
        } else if (!entry) {
          entry = {
            file: preprocessingFile,
            chunks: buildSingleOriginalOcrChunk(),
            artifacts: createSteelOcrOriginalFileArtifactStore({
              file: preprocessingFile,
              fileRecord,
            }),
          };
        }
        batchFiles.push(entry);
        batchSourceFiles.set(preprocessingFile.ocrFileKey, preprocessingFile);
      } catch (error) {
        if (isSteelOcrAbortError(error, signal)) {
          throw error;
        }
        const errorMessage = redactMessage(
          error instanceof Error ? error.message : 'OCR preprocessing failed',
          512,
        );
        failedKeys.push(preprocessingFile.ocrFileKey);
        await emitPreprocessing(preprocessingFile, { stage: 'failed', errorMessage });
        currentOcrFailures.push(
          createCurrentOcrFailureResult({ file: preprocessingFile, result: error, errorMessage }),
        );
        logger.warn('[Steel OCR] OCR preprocessing pipeline failed for current PDF', {
          conversationId,
          requestId,
          ocrFileKey: preprocessingFile.ocrFileKey,
          error: errorMessage,
        });
      }
    }

    const sourceFileOf = (file: OcrPreprocessingFile): SteelOcrPreprocessingSourceFile =>
      batchSourceFiles.get(file.ocrFileKey) ?? { ...file, sourceFilename: '' };

    if (batchFiles.length > 0 && failedKeys.length === 0) {
      try {
        const rules = (ocrPreprocessingRules ??= await resolvePreprocessingRules());
        const batchResult = await runOcrPreprocessingBatchPipeline({
          conversationId,
          requestId,
          turnIndex,
          checkpointTurnIndex:
            nativeContext?.memoryCheckpointTurnIndex ?? Math.max(0, turnIndex - 1),
          signal,
          files: batchFiles,
          ocrRuleVersion: rules.ocrRuleVersion,
          ocrRulesText: rules.ocrRulesText,
          memory: {
            readOcrPreprocessingState: (input) => writer.readOcrPreprocessingState(input),
            capturePaddleOcrChunkResult: (input) =>
              writer.capturePaddleOcrChunkResult({
                ...input,
                file: withoutSteelOcrSourceCode(input.file),
              }),
            captureOcrPreprocessingChunkMarkdown: (input) =>
              writer.captureOcrPreprocessingChunkMarkdown({
                ...input,
                file: withoutSteelOcrSourceCode(input.file),
              }),
          },
          organizer: createSteelOcrOrganizer({ agent, signal }),
          paddleOcr: createPaddleOcrChunkRunner({
            req,
            res,
            signal,
            agent,
            streamId,
            conversationId,
            requestId,
            toolName,
            userMCPAuthMap,
            requestScopedConnections,
            refreshArtifact: async ({ file, chunk, artifact }) => {
              const batchFile = batchFiles.find(
                (entry) => entry.file.ocrFileKey === file.ocrFileKey,
              );
              return batchFile?.artifacts.refreshPdfChunkArtifact
                ? batchFile.artifacts.refreshPdfChunkArtifact({ file, chunk, artifact })
                : artifact;
            },
            getNextIndex: () => nextToolEventIndex++,
            onChunkResult: (status) => currentPaddleOcrStatuses.push(status),
          }),
          onProgress: ({ file, progress }) => {
            if (progress.stage === 'paddleocr_chunk_saved') {
              currentPaddleOcrSavedCount += 1;
            }
            return emitPreprocessing(file, progress);
          },
        });

        for (const fileResult of batchResult.files) {
          if (fileResult.status === 'failed') {
            if (!failedKeys.includes(fileResult.file.ocrFileKey)) {
              failedKeys.push(fileResult.file.ocrFileKey);
            }
            logger.warn('[Steel OCR] OCR preprocessing failed for a current file', {
              conversationId,
              requestId,
              ocrFileKey: fileResult.file.ocrFileKey,
              error: fileResult.errorMessage,
            });
            const failures = fileResult.failures.length > 0 ? fileResult.failures : [fileResult];
            const currentFileFailures = failures.map((failure) =>
              createCurrentOcrFailureResult({
                file: sourceFileOf(fileResult.file),
                result: failure,
              }),
            );
            const missingPageRangesByFileKey = groupSteelOcrMissingPageRangesByFileKey(
              currentFileFailures.map((failure) => ({ ...failure })),
            );
            currentOcrFailures.push(...currentFileFailures);
            await emitPreprocessing(fileResult.file, {
              stage: 'failed',
              errorMessage: fileResult.errorMessage,
              ...(Object.keys(missingPageRangesByFileKey).length > 0
                ? { missingPageRangesByFileKey }
                : {}),
            });
            continue;
          }
          currentOcrMarkdownResults.push(
            createCurrentOcrMergedMarkdownResult({
              file: sourceFileOf(fileResult.file),
              markdown: fileResult.markdown,
              chunkCount: fileResult.chunkCount,
              pageRanges: fileResult.pageRanges,
              ocrRuleVersion: rules.ocrRuleVersion,
            }),
          );
        }
      } catch (error) {
        if (isSteelOcrAbortError(error, signal)) {
          throw error;
        }
        const errorMessage = redactMessage(
          error instanceof Error ? error.message : 'OCR preprocessing failed',
          512,
        );
        for (const { file } of batchFiles) {
          if (!failedKeys.includes(file.ocrFileKey)) {
            failedKeys.push(file.ocrFileKey);
          }
          currentOcrFailures.push(
            createCurrentOcrFailureResult({
              file: sourceFileOf(file),
              result: error,
              errorMessage,
            }),
          );
          await emitPreprocessing(file, { stage: 'failed', errorMessage });
        }
        logger.warn('[Steel OCR] OCR preprocessing batch failed for current files', {
          conversationId,
          requestId,
          ocrFileKeys: batchFiles.map(({ file }) => file.ocrFileKey),
          error: errorMessage,
        });
      }
    }

    const finalStatuses = getFinalPaddleOcrChunkStatuses(currentPaddleOcrStatuses);
    if (failedKeys.length > 0) {
      await finish({
        status: 'partial',
        completedKeys: uniqueStrings(attemptedKeys.filter((key) => !failedKeys.includes(key))),
        attemptedKeys,
        failedKeys,
        ...(finalStatuses.length > 0 ? { currentPaddleOcrStatuses: finalStatuses } : {}),
      });
      throw createSteelOcrChunkError(
        currentOcrFailures.map((failure) => ({
          ...failure,
          label: failure.filename ?? failure.ocrFileKey,
        })),
      );
    }
    return finish({
      status: failedKeys.length > 0 ? 'partial' : 'completed',
      completedKeys: uniqueStrings(attemptedKeys.filter((key) => !failedKeys.includes(key))),
      attemptedKeys,
      failedKeys,
      ...(currentOcrSourceFileMapping.length > 0 ? { currentOcrSourceFileMapping } : {}),
      ...(typeof previousOcrResultMarkdown === 'string' ? { previousOcrResultMarkdown } : {}),
      ...(suggestedOcrResultColumns.length > 0 ? { suggestedOcrResultColumns } : {}),
      ...(finalStatuses.length > 0 ? { currentPaddleOcrStatuses: finalStatuses } : {}),
      ...(currentOcrMarkdownResults.length > 0 ? { currentOcrMarkdownResults } : {}),
    });
  }

  async function runSteelPaddleOcrPreflight(input: RunSteelPaddleOcrPreflightInput): Promise<SteelPaddleOcrPreflightResult> {
    const context = input.req.steelNativeContext;
    const conversationId = getSteelRequestConversationId(input.req);
    const userId = input.req.user?.id;
    const responseGenerationId = context?.requestId;
    if (!conversationId || !userId || !responseGenerationId || context?.assistantTurnIndex === undefined ||
      !context.currentTurnFiles?.some((file) => getSteelOcrFileDescriptor(file))) return runPreflight(input);
    const scope = { userId, conversationId, tenantId: input.req.user?.tenantId };
    const runs = deps.runStore ?? createSteelOcrRunMethods(mongoose);
    const executionEpoch = input.req._resumableJobCreatedAt;
    const run = await runs.createPreflightRun({ scope, responseGenerationId, executionEpoch, triggeringMessageId: responseGenerationId });
    const progressByFile = new Map<string, { total: number; completed: Set<number> }>();
    let latestStage = 'preflight';
    let latestTotalChunks = 0;
    let latestCompletedChunks = 0;
    const track = async (file: Pick<OcrPreprocessingFile, 'ocrFileKey' | 'filename'>,
      progress: Parameters<typeof buildSteelOcrPreprocessingEventEnvelopes>[0]['progress']) => {
      const entry = progressByFile.get(file.ocrFileKey) ?? { total: 0, completed: new Set<number>() };
      if ('chunkCount' in progress && typeof progress.chunkCount === 'number') entry.total = progress.chunkCount;
      if ((progress.stage === 'organizer_chunk_saved' || progress.stage === 'organizer_chunk_loaded') &&
        'chunkIndex' in progress && typeof progress.chunkIndex === 'number') entry.completed.add(progress.chunkIndex);
      if (progress.stage === 'processing_with_merged_markdown') {
        entry.completed = new Set(Array.from({ length: progress.chunkCount }, (_, index) => index + 1));
      }
      progressByFile.set(file.ocrFileKey, entry);
      let totalChunks = 0;
      let completedChunks = 0;
      for (const item of progressByFile.values()) {
        totalChunks += item.total;
        completedChunks += item.completed.size;
      }
      latestStage = progress.stage;
      latestTotalChunks = Math.max(totalChunks, completedChunks);
      latestCompletedChunks = completedChunks;
      const updated = await runs.updatePreflightRun({ scope, runId: run.runId, stage: progress.stage,
        totalChunks: latestTotalChunks, completedChunks: latestCompletedChunks });
      if (!updated) throw new DOMException('OCR execution is no longer active', 'AbortError');
      return {
        runId: run.runId,
        kind: 'preflight' as const,
        stage: latestStage,
        flowStatus: (progress.stage === 'failed' ? 'failed' : 'running') as 'running' | 'failed',
        completedChunks: latestCompletedChunks,
        totalChunks: latestTotalChunks,
      };
    };
    return runWithSteelOcrExecution({ scope, responseGenerationId, executionEpoch, signal: input.signal }, async (signal) => {
      try {
        const result = await runPreflight({
          ...input,
          signal,
          flow: {
            runId: run.runId,
            getSummary: () => ({
              stage: latestStage,
              completedChunks: latestCompletedChunks,
              totalChunks: latestTotalChunks,
            }),
            track,
          },
        });
        await runs.updatePreflightRun({ scope, runId: run.runId, stage: 'agent' });
        return result;
      } catch (error) {
        await runs.settleTurn({ scope, responseGenerationId, executionEpoch,
          status: getSteelOcrFailureStatus(signal) });
        throw error;
      }
    });
  }

  return {
    runSteelPaddleOcrPreflight,
    createPaddleOcrChunkRunner,
    resolvePreprocessingRules,
    createOrganizer: createSteelOcrOrganizer,
    createPdfChunkArtifactStore: createSteelOcrPdfChunkArtifactStore,
  };
}
