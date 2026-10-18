import { Time } from 'librechat-data-provider';
import { logger, redactMessage } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { RequestScopedMCPConnectionStore } from '~/mcp/types';
import type { OcrPdfChunkArtifact, PaddleOcrChunkRunner, OcrPreprocessingFile } from './preprocess';
import type { SteelEmittedEvent, SteelNativeEventRequest } from '../native/stream';
import type { PaddleOcrDiagnosticCode } from './diagnostics';
import type { OcrPreprocessingPageChunk } from './chunks';
import {
  stringifySteelPaddleOcrPayload,
  createSteelPaddleOcrRunStepEvent,
  createSteelPaddleOcrRunStepDeltaEvent,
  createSteelPaddleOcrRunStepCompletedEvent,
} from '../native/steps';
import { getPaddleOcrResultContent, getPaddleOcrResultError } from './text';
import { isPaddleOcrDiagnosticCode, PADDLE_OCR_MCP_SERVER_NAME } from './diagnostics';
import { upsertSteelNativePreflightToolCall } from '../native/events';
import { emitSteelNativeEvents } from '../native/stream';
import { isExpiredSignedUrlError } from '~/storage/url';
import { sha256Hex } from '../utils';

/** PaddleOCR-VL tool name on the PaddleOCR MCP server. */
export const steelPaddleOcrToolName = 'paddleocr_vl';

/** Lowercase error fragments that make a PaddleOCR call worth retrying. */
export const steelPaddleOcrRetryableErrorPatterns: readonly string[] = [
  'connection timeout after',
  'failed to establish connection',
  'connection reset by peer',
  'connectionreseterror',
  'clientconnectorerror',
  'clientoserror',
  'cannot connect to host paddleocr.aistudio-app.com',
  'econnreset',
  'socket hang up',
  'server disconnected',
  'transport closed',
  'terminated',
  'timeout',
  'timed out',
  'fetch failed',
  'network error',
  'service unavailable',
  'temporarily unavailable',
  'try again later',
  'too many requests',
  'rate limit',
  'rate_limit',
  'error calling tool',
  'overloaded',
  '429',
  '408',
  '503',
];

/** Lowercase error fragments that mean the MCP transport must be rebuilt before a retry. */
export const steelPaddleOcrTransportErrorPatterns: readonly string[] = [
  'connection timeout',
  'failed to establish connection',
  'connection reset',
  'connectionreseterror',
  'clientconnectorerror',
  'clientoserror',
  'cannot connect to host',
  'econnreset',
  'socket hang up',
  'server disconnected',
  'transport closed',
  'terminated',
  'fetch failed',
  'network error',
];

export const steelPaddleOcrMaxAttempts = 3;

export const steelPaddleOcrRetryDelayMs = 3000;

export const steelPaddleOcrTaskIntervalMs = 1000;

export const steelPaddleOcrCallTimeoutMs: number = 10 * 60 * 1000;

/** A PaddleOCR failure with the diagnostics the preprocessing pipeline reads. */
export interface SteelPaddleOcrError extends Error {
  diagnosticCode?: PaddleOcrDiagnosticCode;
  ocrFileUrl?: string;
  ocrAdaptiveSplitEligible?: boolean;
  rebuildError?: unknown;
}

/** The request fields the PaddleOCR runner reads and its tool card history. */
export interface SteelPaddleOcrRequest extends SteelNativeEventRequest {
  user?: { id?: string; tenantId?: string };
}

export interface SteelPaddleOcrAgent {
  id?: string;
  provider?: string;
}

export interface SteelPaddleOcrTool {
  name: string;
  invoke?(args: SteelPaddleOcrArgs, config: SteelPaddleOcrInvokeConfig): Promise<unknown>;
  _call?(args: SteelPaddleOcrArgs, config: SteelPaddleOcrInvokeConfig): Promise<unknown>;
}

export interface SteelPaddleOcrArgs {
  input_data: string;
  output_mode: 'detailed';
  return_images: false;
  runtime_params: {
    use_doc_orientation_classify: true;
    use_doc_unwarping: true;
    use_layout_detection: true;
  };
}

export interface SteelPaddleOcrInvokeConfig {
  configurable: object & {
    req: SteelPaddleOcrRequest;
    user?: SteelPaddleOcrRequest['user'];
    user_id?: string;
    requestBody: { messageId?: string; conversationId: string };
  };
  metadata: { provider?: string; thread_id: string; run_id: string };
  signal: AbortSignal;
  toolCall: { id: string; name: string; args: SteelPaddleOcrArgs };
}

export interface SteelPaddleOcrMcpScope {
  userMCPAuthMap?: Record<string, Record<string, string>>;
  requestScopedConnections?: RequestScopedMCPConnectionStore;
}

/** The server's tool loading and MCP connection control used to run and rebuild PaddleOCR. */
export interface SteelPaddleOcrServer {
  loadTools(
    input: SteelPaddleOcrMcpScope & {
      req: SteelPaddleOcrRequest;
      res?: Response;
      signal?: AbortSignal;
      agent?: SteelPaddleOcrAgent;
      toolNames: string[];
      streamId?: string | null;
      actionsEnabled: false;
      allowPaddleOcr: true;
    },
  ): Promise<{ loadedTools: readonly SteelPaddleOcrTool[]; configurable?: object }>;
  disconnectAppConnection(input: { userId?: string; serverName: string }): Promise<void>;
  resolveConfigServers(req: SteelPaddleOcrRequest): Promise<object | undefined>;
  reinitServer(
    input: SteelPaddleOcrMcpScope & {
      user: SteelPaddleOcrRequest['user'];
      signal?: AbortSignal;
      serverName: string;
      configServers?: object;
      requestBody: { messageId?: string; conversationId: string };
      forceNew: true;
      returnOnOAuth: false;
      connectionTimeout: number;
    },
  ): Promise<unknown>;
}

export interface SteelPaddleOcrChunkStatus {
  paddleocr: 'ok' | 'fail';
  ocrFileKey: string;
  filename?: string;
  mediaType?: string;
  chunkIndex: number;
  chunkCount: number;
  pageStart?: number;
  pageEnd?: number;
}

export interface CreateSteelPaddleOcrChunkRunnerInput extends SteelPaddleOcrMcpScope {
  server: SteelPaddleOcrServer;
  req: SteelPaddleOcrRequest;
  res?: Response;
  signal?: AbortSignal;
  agent?: SteelPaddleOcrAgent;
  streamId?: string | null;
  conversationId: string;
  requestId?: string;
  toolName: string;
  refreshArtifact?(input: {
    file: OcrPreprocessingFile;
    chunk: OcrPreprocessingPageChunk;
    artifact: OcrPdfChunkArtifact;
  }): Promise<OcrPdfChunkArtifact>;
  getNextIndex(): number;
  onChunkResult?(status: SteelPaddleOcrChunkStatus): void;
}

const paddleOcrRetryableDiagnosticCodes: ReadonlySet<PaddleOcrDiagnosticCode> = new Set([
  'ai_studio_unavailable',
  'ai_studio_rate_limited',
  'ai_studio_timeout',
  'ai_studio_job_failed',
  'ai_studio_inference',
]);

function withDiagnosticCode<T extends Error>(error: T, code: unknown): T {
  if (isPaddleOcrDiagnosticCode(code)) {
    Object.defineProperty(error, 'diagnosticCode', {
      value: code,
      enumerable: false,
      configurable: true,
    });
  }
  return error;
}

function readDiagnosticCode(value: unknown): PaddleOcrDiagnosticCode | undefined {
  const code =
    value && typeof value === 'object'
      ? (value as { diagnosticCode?: unknown }).diagnosticCode
      : undefined;
  return isPaddleOcrDiagnosticCode(code) ? code : undefined;
}

function hashPaddleOcrText(text: string): string {
  return sha256Hex(text.replace(/\r\n/gu, '\n').trim());
}

export function getSteelPaddleOcrPreflightToolCallId(ocrFileKey: string): string {
  return `steel_paddleocr_preflight_${ocrFileKey.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
}

/** A redacted PaddleOCR error message with signed URLs removed. */
export function getSafeSteelPaddleOcrErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : undefined;
  return redactMessage(message ?? 'PaddleOCR preflight failed', 512).replace(
    /https?:\/\/\S+/giu,
    '[redacted-url]',
  );
}

interface ErrorChainLink {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

function* walkErrorChain(error: unknown): Generator<ErrorChainLink> {
  const visited = new Set<object>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    yield current as ErrorChainLink;
    current = (current as ErrorChainLink).cause;
  }
}

/** Whether an error, or any error in its cause chain, is an abort. */
export function isSteelOcrAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }
  for (const link of walkErrorChain(error)) {
    const message = typeof link.message === 'string' ? link.message : '';
    if (
      link.name === 'AbortError' ||
      link.code === 'ABORT_ERR' ||
      message.includes('AbortError') ||
      /(?:operation|request|stream) was aborted/i.test(message)
    ) {
      return true;
    }
  }
  return false;
}

function getParentAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }
  const error = new Error(reason instanceof Error ? reason.message : 'OCR request aborted', {
    ...(reason !== undefined ? { cause: reason } : {}),
  });
  error.name = 'AbortError';
  return error;
}

function collectErrorMessages(error: unknown): string {
  const messages: string[] = [];
  for (const link of walkErrorChain(error)) {
    for (const value of [link.name, link.code, link.message]) {
      if (typeof value === 'string' && value.trim() !== '') {
        messages.push(value);
      }
    }
  }
  if (typeof error === 'string') {
    messages.push(error);
  }
  return messages.join('\n').toLowerCase();
}

function isRetryableSteelPaddleOcrError(error: unknown): boolean {
  if (isExpiredSignedUrlError(error)) {
    return true;
  }
  const diagnosticCode = readDiagnosticCode(error);
  if (diagnosticCode) {
    return paddleOcrRetryableDiagnosticCodes.has(diagnosticCode);
  }
  const combined = collectErrorMessages(error);
  return (
    Boolean(combined) &&
    steelPaddleOcrRetryableErrorPatterns.some((pattern) => combined.includes(pattern))
  );
}

function isTransportSteelPaddleOcrError(error: unknown): boolean {
  const combined = collectErrorMessages(error);
  return (
    Boolean(combined) &&
    steelPaddleOcrTransportErrorPatterns.some((pattern) => combined.includes(pattern))
  );
}

function sleepSteelPaddleOcrDelay({
  signal,
  delay,
  abortMessage,
}: {
  signal?: AbortSignal;
  delay: number;
  abortMessage: string;
}): Promise<void> {
  const abortError = () => {
    const error = new Error(abortMessage);
    error.name = 'AbortError';
    return error;
  };
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Keeps the provider error primary while recording why the MCP rebuild failed too. */
function retainProviderErrorWithRebuildFailure(
  providerError: unknown,
  rebuildError: unknown,
): unknown {
  if (providerError && typeof providerError === 'object') {
    const target = providerError as SteelPaddleOcrError;
    try {
      if (target.cause === undefined) {
        target.cause = rebuildError;
      } else {
        target.rebuildError = rebuildError;
      }
    } catch (error) {
      logger.debug('[Steel OCR] Could not attach PaddleOCR rebuild failure to provider error', {
        error: error instanceof Error ? error.message : undefined,
      });
    }
  }
  return providerError;
}

function createSteelPaddleOcrCallTimeoutError(): SteelPaddleOcrError {
  return withDiagnosticCode(
    new Error('PaddleOCR call timed out after 10 minutes'),
    'ai_studio_timeout',
  );
}

function errorMessageOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/** Drops the cached request and app PaddleOCR connections and reinitializes the MCP server. */
async function rebuildSteelPaddleOcrConnection({
  server,
  req,
  signal,
  conversationId,
  requestId,
  ocrFileKey,
  error,
  userMCPAuthMap,
  requestScopedConnections,
}: SteelPaddleOcrMcpScope & {
  server: SteelPaddleOcrServer;
  req: SteelPaddleOcrRequest;
  signal?: AbortSignal;
  conversationId: string;
  requestId?: string;
  ocrFileKey: string;
  error: unknown;
}): Promise<void> {
  const logContext = { conversationId, requestId, ocrFileKey };
  logger.warn('[Steel OCR] Rebuilding PaddleOCR MCP connection before retrying preflight', {
    ...logContext,
    error: errorMessageOf(error),
  });

  const userId = req.user?.id;
  const connectionKey = userId ? `${userId}:${PADDLE_OCR_MCP_SERVER_NAME}` : undefined;
  if (connectionKey && requestScopedConnections) {
    const connection = requestScopedConnections.connections.get(connectionKey);
    requestScopedConnections.pending.delete(connectionKey);
    requestScopedConnections.connections.delete(connectionKey);
    const disconnect =
      connection && typeof connection === 'object'
        ? (connection as { disconnect?: unknown }).disconnect
        : undefined;
    if (typeof disconnect === 'function') {
      try {
        await disconnect.call(connection);
      } catch (disconnectError) {
        logger.warn(
          '[Steel OCR] Failed to disconnect request-scoped PaddleOCR connection before retry',
          { ...logContext, error: errorMessageOf(disconnectError) },
        );
      }
    }
  }

  try {
    await server.disconnectAppConnection({ userId, serverName: PADDLE_OCR_MCP_SERVER_NAME });
  } catch (disconnectError) {
    logger.warn('[Steel OCR] Failed to disconnect PaddleOCR app connection before retry', {
      ...logContext,
      error: errorMessageOf(disconnectError),
    });
  }

  let configServers: object | undefined;
  try {
    configServers = await server.resolveConfigServers(req);
  } catch (configError) {
    logger.warn('[Steel OCR] Failed to resolve MCP config servers before PaddleOCR retry', {
      ...logContext,
      error: errorMessageOf(configError),
    });
  }

  try {
    await server.reinitServer({
      user: req.user,
      signal,
      serverName: PADDLE_OCR_MCP_SERVER_NAME,
      ...(configServers ? { configServers } : {}),
      ...(userMCPAuthMap ? { userMCPAuthMap } : {}),
      requestBody: { messageId: requestId, conversationId },
      requestScopedConnections,
      forceNew: true,
      returnOnOAuth: false,
      connectionTimeout: Time.THIRTY_SECONDS,
    });
  } catch (reinitError) {
    logger.warn('[Steel OCR] Failed to reinitialize PaddleOCR MCP before retry', {
      ...logContext,
      error: errorMessageOf(reinitError),
    });
  }
}

interface SteelPaddleOcrToolOutput {
  ocrEngine?: string;
  ocrFileKey?: string;
  filename?: string;
  chunkIndex?: number;
  chunkCount?: number;
  pageStart?: number;
  pageEnd?: number;
  paddleocr?: 'ok' | 'fail';
  dataSizeBytes?: number;
  attemptsUsed?: number;
  diagnosticCode?: PaddleOcrDiagnosticCode;
  errorMessage?: string;
}

/** The compact, URL-free tool card the chat history keeps for one PaddleOCR call. */
function createSteelPaddleOcrHistoryToolCall({
  providerToolCallId,
  toolName,
  args,
  output,
  progress,
}: {
  providerToolCallId: string;
  toolName: string;
  args: SteelPaddleOcrArgs;
  output?: SteelPaddleOcrToolOutput;
  progress: 0 | 1;
}) {
  const compactArgs = {
    input_data: args.input_data,
    output_mode: 'detailed' as const,
    return_images: args.return_images,
    use_doc_orientation_classify: args.runtime_params.use_doc_orientation_classify,
    use_doc_unwarping: args.runtime_params.use_doc_unwarping,
    use_layout_detection: args.runtime_params.use_layout_detection,
  };
  let compactOutput: string | undefined;
  if (output !== undefined) {
    const chunkIdentity = {
      ocrEngine: output.ocrEngine,
      ocrFileKey: String(output.ocrFileKey ?? '').slice(0, 256),
      filename: String(output.filename ?? '').slice(0, 256),
      chunkIndex: output.chunkIndex,
      chunkCount: output.chunkCount,
      pageStart: output.pageStart,
      pageEnd: output.pageEnd,
    };
    if (output.paddleocr === 'fail') {
      const failureMessage = getSafeSteelPaddleOcrErrorMessage(
        new Error(output.errorMessage ?? 'PaddleOCR preflight failed'),
      );
      compactOutput = JSON.stringify({
        status: 'fail',
        paddleocr: 'fail',
        ...chunkIdentity,
        dataSizeBytes: Buffer.byteLength(stringifySteelPaddleOcrPayload(output), 'utf8'),
        attemptsUsed: output.attemptsUsed,
        ...(isPaddleOcrDiagnosticCode(output.diagnosticCode)
          ? { errorCode: output.diagnosticCode }
          : {}),
        error: failureMessage,
        errorMessage: failureMessage,
      });
    } else {
      compactOutput = JSON.stringify({
        status: 'ok',
        paddleocr: 'ok',
        ...chunkIdentity,
        dataSizeBytes: output.dataSizeBytes,
      });
    }
  }
  return {
    type: 'tool_call',
    id: providerToolCallId.slice(0, 256),
    name: toolName,
    args: compactArgs,
    ...(compactOutput !== undefined ? { output: compactOutput } : {}),
    progress,
  };
}

function recordToolCard(
  req: SteelPaddleOcrRequest,
  card: ReturnType<typeof createSteelPaddleOcrHistoryToolCall>,
): boolean {
  const history = req.steelNativeContext?.steelHistory;
  return history ? upsertSteelNativePreflightToolCall(history, card) : false;
}

function createPaddleOcrChunkToolOutput({
  file,
  chunk,
  rawOcrText,
  rawResultHash,
}: {
  file: OcrPreprocessingFile;
  chunk: OcrPreprocessingPageChunk;
  rawOcrText: string;
  rawResultHash: string;
}) {
  return {
    status: 'completed',
    paddleocr: 'ok' as const,
    ocrEngine: 'paddleocr_vl',
    ocrFileKey: file.ocrFileKey,
    filename: file.filename,
    chunkIndex: chunk.chunkIndex,
    chunkCount: chunk.chunkCount,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    rawTextLength: rawOcrText.length,
    dataSizeBytes: Buffer.byteLength(rawOcrText, 'utf8'),
    rawResultHash,
    outputStorage: 'steel_working_order_memory:paddleocr_preflight',
  };
}

function createPaddleOcrChunkFailureToolOutput({
  file,
  chunk,
  errorMessage,
  diagnosticCode,
  attemptsUsed,
}: {
  file: OcrPreprocessingFile;
  chunk: OcrPreprocessingPageChunk;
  errorMessage: string;
  diagnosticCode?: PaddleOcrDiagnosticCode;
  attemptsUsed: number;
}) {
  return {
    status: 'failed',
    paddleocr: 'fail' as const,
    ocrEngine: 'paddleocr_vl',
    ocrFileKey: file.ocrFileKey,
    filename: file.filename,
    chunkIndex: chunk.chunkIndex,
    chunkCount: chunk.chunkCount,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    attemptsUsed,
    ...(diagnosticCode ? { diagnosticCode } : {}),
    errorMessage: getSafeSteelPaddleOcrErrorMessage(new Error(errorMessage)),
  };
}

function createPaddleOcrChunkStatus({
  file,
  chunk,
  paddleocr,
}: {
  file: OcrPreprocessingFile;
  chunk: OcrPreprocessingPageChunk;
  paddleocr: 'ok' | 'fail';
}): SteelPaddleOcrChunkStatus {
  const isImage = String(file.mediaType ?? '')
    .trim()
    .toLowerCase()
    .startsWith('image/');
  return {
    paddleocr,
    ocrFileKey: file.ocrFileKey,
    filename: file.filename,
    mediaType: file.mediaType,
    chunkIndex: chunk.chunkIndex,
    chunkCount: chunk.chunkCount,
    ...(!isImage ? { pageStart: chunk.pageStart, pageEnd: chunk.pageEnd } : {}),
  };
}

async function invokeLoadedTool(
  tool: SteelPaddleOcrTool,
  args: SteelPaddleOcrArgs,
  config: SteelPaddleOcrInvokeConfig,
): Promise<unknown> {
  if (tool.invoke) {
    return tool.invoke(args, config);
  }
  if (tool._call) {
    return tool._call(args, config);
  }
  throw new Error(`Loaded tool "${tool.name}" is not invokable`);
}

/**
 * Runs PaddleOCR-VL over one artifact chunk at a time through the MCP tool:
 * each call gets a hard deadline, retryable failures wait and re-sign the
 * input URL, transport failures rebuild the MCP connection, and every call is
 * streamed as a tool card.
 */
export function createSteelPaddleOcrChunkRunner({
  server,
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
  refreshArtifact,
  getNextIndex,
  onChunkResult,
}: CreateSteelPaddleOcrChunkRunnerInput): PaddleOcrChunkRunner {
  let paddleTool: SteelPaddleOcrTool | undefined;
  let configurable: object | undefined;
  let lastTaskCompletedAt: number | undefined;
  const mcpScope = {
    ...(userMCPAuthMap ? { userMCPAuthMap } : {}),
    ...(requestScopedConnections ? { requestScopedConnections } : {}),
  };

  const loadTool = async () => {
    const loaded = await server.loadTools({
      req,
      res,
      signal,
      agent,
      toolNames: [toolName],
      streamId,
      actionsEnabled: false,
      allowPaddleOcr: true,
      ...mcpScope,
    });
    paddleTool = loaded.loadedTools.find((tool) => tool.name === toolName);
    configurable = loaded.configurable;
  };

  const emitToolCard = (
    events: SteelEmittedEvent[],
    card: ReturnType<typeof createSteelPaddleOcrHistoryToolCall>,
  ) =>
    emitSteelNativeEvents({
      req,
      res,
      streamId,
      historyChanged: recordToolCard(req, card),
      events,
    });

  async function runChunk({
    file,
    chunk,
    artifact,
  }: Parameters<PaddleOcrChunkRunner['runChunk']>[0]): Promise<
    Awaited<ReturnType<PaddleOcrChunkRunner['runChunk']>>
  > {
    const providerToolCallId = `${getSteelPaddleOcrPreflightToolCallId(file.ocrFileKey)}_pages_${chunk.pageStart}_${chunk.pageEnd}`;
    const step = {
      stepId: `${providerToolCallId}_step`,
      providerToolCallId,
      toolName,
      index: getNextIndex(),
    };
    let currentArtifact = artifact;
    const createArgs = (): SteelPaddleOcrArgs => ({
      input_data: currentArtifact.filepath,
      output_mode: 'detailed',
      return_images: false,
      runtime_params: {
        use_doc_orientation_classify: true,
        use_doc_unwarping: true,
        use_layout_detection: true,
      },
    });
    let args = createArgs();

    await emitToolCard(
      [
        createSteelPaddleOcrRunStepEvent({ ...step, requestId }),
        createSteelPaddleOcrRunStepDeltaEvent({ ...step, args }),
      ],
      createSteelPaddleOcrHistoryToolCall({ providerToolCallId, toolName, args, progress: 0 }),
    );
    const complete = async (output: SteelPaddleOcrToolOutput, paddleocr: 'ok' | 'fail') => {
      await emitToolCard(
        [createSteelPaddleOcrRunStepCompletedEvent({ ...step, args, output })],
        createSteelPaddleOcrHistoryToolCall({
          providerToolCallId,
          toolName,
          args,
          output,
          progress: 1,
        }),
      );
      onChunkResult?.(createPaddleOcrChunkStatus({ file, chunk, paddleocr }));
    };

    let lastError: unknown;
    let attemptsUsed = 0;
    let invokeAttemptsUsed = 0;
    for (let attemptIndex = 0; attemptIndex < steelPaddleOcrMaxAttempts; attemptIndex += 1) {
      attemptsUsed = attemptIndex + 1;
      let timeoutSignal: AbortSignal | undefined;
      let result: unknown;
      try {
        if (attemptIndex > 0 && refreshArtifact) {
          currentArtifact = await refreshArtifact({ file, chunk, artifact: currentArtifact });
          args = createArgs();
        }
        if (!paddleTool) {
          await loadTool();
        }
        if (!paddleTool) {
          throw new Error('missing_paddleocr_tool');
        }
        invokeAttemptsUsed += 1;
        timeoutSignal = AbortSignal.timeout(steelPaddleOcrCallTimeoutMs);
        const callSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
        result = await invokeLoadedTool(paddleTool, args, {
          configurable: {
            ...configurable,
            req,
            user: req.user,
            user_id: req.user?.id,
            requestBody: { messageId: requestId, conversationId },
          },
          metadata: {
            provider: agent?.provider,
            thread_id: conversationId,
            run_id: requestId ?? conversationId,
          },
          signal: callSignal,
          toolCall: { id: providerToolCallId, name: toolName, args },
        });
        const resultError = getPaddleOcrResultError(result);
        if (resultError) {
          throw withDiagnosticCode(new Error(resultError), readDiagnosticCode(result));
        }
      } catch (caughtError) {
        if (signal?.aborted) {
          throw getParentAbortError(signal);
        }
        const error = timeoutSignal?.aborted ? createSteelPaddleOcrCallTimeoutError() : caughtError;
        if (isSteelOcrAbortError(error, signal)) {
          throw error;
        }
        lastError = error;
        if (
          attemptIndex >= steelPaddleOcrMaxAttempts - 1 ||
          !isRetryableSteelPaddleOcrError(error)
        ) {
          break;
        }

        await sleepSteelPaddleOcrDelay({
          signal,
          delay: steelPaddleOcrRetryDelayMs,
          abortMessage: 'OCR retry aborted',
        });
        if (isTransportSteelPaddleOcrError(error)) {
          try {
            await rebuildSteelPaddleOcrConnection({
              server,
              req,
              signal,
              conversationId,
              requestId,
              ocrFileKey: file.ocrFileKey,
              error,
              ...mcpScope,
            });
            paddleTool = undefined;
            await loadTool();
            if (!paddleTool) {
              lastError = retainProviderErrorWithRebuildFailure(
                error,
                new Error('missing_paddleocr_tool_after_rebuild'),
              );
              break;
            }
          } catch (rebuildError) {
            lastError = retainProviderErrorWithRebuildFailure(error, rebuildError);
            paddleTool = undefined;
            break;
          }
        }
        continue;
      }

      const rawOcrText = getPaddleOcrResultContent(result);
      const rawResultHash = hashPaddleOcrText(rawOcrText);
      await complete(
        createPaddleOcrChunkToolOutput({ file, chunk, rawOcrText, rawResultHash }),
        'ok',
      );
      return { rawResult: result, rawOcrText, rawResultHash, artifact: currentArtifact };
    }

    const error = lastError ?? new Error('PaddleOCR preflight failed');
    const safeErrorMessage = getSafeSteelPaddleOcrErrorMessage(error);
    const exhaustedError: SteelPaddleOcrError = withDiagnosticCode(
      new Error(
        attemptsUsed > 1
          ? `PaddleOCR failed for pages ${chunk.pageStart}-${chunk.pageEnd} after ${attemptsUsed} attempts: ${safeErrorMessage}`
          : safeErrorMessage,
        { cause: error },
      ),
      readDiagnosticCode(error),
    );
    if (typeof currentArtifact.filepath === 'string') {
      exhaustedError.ocrFileUrl = currentArtifact.filepath;
    }
    exhaustedError.ocrAdaptiveSplitEligible = invokeAttemptsUsed === steelPaddleOcrMaxAttempts;
    await complete(
      createPaddleOcrChunkFailureToolOutput({
        file,
        chunk,
        errorMessage: exhaustedError.message,
        diagnosticCode: exhaustedError.diagnosticCode,
        attemptsUsed,
      }),
      'fail',
    );
    throw exhaustedError;
  }

  return {
    async runChunk(input) {
      if (lastTaskCompletedAt !== undefined) {
        const elapsed = performance.now() - lastTaskCompletedAt;
        if (elapsed < steelPaddleOcrTaskIntervalMs) {
          await sleepSteelPaddleOcrDelay({
            signal,
            delay: steelPaddleOcrTaskIntervalMs - elapsed,
            abortMessage: 'OCR task interval aborted',
          });
        }
      }
      try {
        return await runChunk(input);
      } finally {
        lastTaskCompletedAt = performance.now();
      }
    },
  };
}
