import type {
  JSONValue,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3ToolCall,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { SteelOpenAIReasoningEffort } from './config';
import { serializeSteelRuntimeContext, type SteelRuntimeContext } from '../runtime/context';
import { createSteelPostgresPool } from '../postgres';
import {
  createSteelToolRunState,
  executeSteelTool,
  type SteelToolRunState,
} from '../tools/execute';
import {
  getSteelToolDefinitions,
  isSteelToolName,
  type SteelProviderToolContextMode,
  type SteelProviderToolName,
} from '../tools/registry';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import { steelToolArgsSchemas } from '../tools/schemas';
import { runSteelFileOcr } from '../vision/ocr';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('openai-oauth-provider')>;

const transientProviderMaxAttempts = 3;
const transientProviderRetryDelaysMs = [300, 1000] as const;

type CreateOpenAIOAuth = typeof createOpenAIOAuthType;
type SteelBusinessToolCall = LanguageModelV3ToolCall & { toolName: SteelProviderToolName };
type SearchPriceCandidatesInput = ReturnType<
  typeof steelToolArgsSchemas.search_price_candidates.parse
>;
type SearchPriceCandidateQuery = SearchPriceCandidatesInput['queries'][number];
type SteelRoundTool = LanguageModelV3FunctionTool;
type SteelProviderRoundTiming = {
  round: number;
  generationDurationMs: number;
  toolDurationMs: number;
  promptMessageCount: number;
  generatedToolCallCount: number;
};
type SteelProviderTimings = {
  totalDurationMs: number;
  generationDurationMs: number;
  toolDurationMs: number;
  roundCount: number;
  rounds: SteelProviderRoundTiming[];
};
type SteelProviderRoundProgressStatus = 'started' | 'waiting';

const defaultSteelToolMaxCalls = 8;
const defaultProviderRoundProgressIntervalMs = 30000;

export interface SteelProviderExecuteToolCallOptions {
  toolName: string;
  arguments: unknown;
  providerToolCallId: string;
  runState: SteelToolRunState;
}

export type SteelProviderToolExecutor = (
  options: SteelProviderExecuteToolCallOptions,
) => Promise<SteelToolResult>;

export type SteelProviderToolStatusCallback = (event: {
  toolName: string;
  status: 'started' | 'completed' | 'failed';
  message?: string;
  result?: SteelToolResult;
  errorSummary?: string;
}) => void | Promise<void>;

export type SteelProviderRoundStatusCallback = (event: {
  round: number;
  status: SteelProviderRoundProgressStatus;
  elapsedMs: number;
  promptMessageCount: number;
  message: string;
}) => void | Promise<void>;

export type SteelOAuthChatMessageRole = 'system' | 'user' | 'assistant';

export interface SteelOAuthChatFile {
  filename?: string;
  mediaType: string;
  data: Uint8Array | string | URL;
  pageCount?: number;
}

export interface SteelOAuthChatMessage {
  role: SteelOAuthChatMessageRole;
  content: string;
  messageId?: string;
  files?: SteelOAuthChatFile[];
}

export interface SteelProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface SteelProviderChatResponse {
  provider: 'openai_oauth_responses';
  model: string;
  text: string;
  responseId?: string;
  usage?: SteelProviderUsage;
  timings?: SteelProviderTimings;
  unsupportedSettings: string[];
  warnings: string[];
}

export interface SendSteelOAuthChatOptions {
  abortSignal?: AbortSignal;
  authFilePath?: string;
  conversationId?: string;
  createOpenAIOAuth?: CreateOpenAIOAuth;
  ensureFresh?: boolean;
  executeSteelToolCall?: SteelProviderToolExecutor;
  fetch?: FetchFunction;
  maxOutputTokens?: number;
  messages: SteelOAuthChatMessage[];
  model: string;
  onReasoningSummary?: (summary: string) => void;
  onTextDelta?: (delta: string) => void;
  onToolStatus?: SteelProviderToolStatusCallback;
  onProviderRoundStatus?: SteelProviderRoundStatusCallback;
  passThroughUnsupportedFiles?: boolean;
  providerRoundProgressIntervalMs?: number;
  reasoningEffort: SteelOpenAIReasoningEffort;
  steelToolMaxCalls?: number;
  steelRuntimePolicy?: boolean;
  steelRuntimeContext?: SteelRuntimeContext;
  workingMemorySummary?: string;
}

async function loadCreateOpenAIOAuth(): Promise<typeof createOpenAIOAuthType> {
  const provider = await dynamicImport('openai-oauth-provider');
  return provider.createOpenAIOAuth;
}

let defaultSteelToolClient: ReturnType<typeof createSteelPostgresPool> | undefined;
const steelBusinessFunctionToolsByMode = new Map<
  SteelProviderToolContextMode,
  LanguageModelV3FunctionTool[]
>();

function getDefaultSteelToolClient() {
  defaultSteelToolClient ??= createSteelPostgresPool();
  return defaultSteelToolClient;
}

async function executeDefaultSteelToolCall({
  toolName,
  arguments: args,
  providerToolCallId,
  runState,
}: SteelProviderExecuteToolCallOptions): Promise<SteelToolResult> {
  return executeSteelTool({
    client: getDefaultSteelToolClient(),
    toolName,
    arguments: args,
    providerToolCallId,
    runState,
  });
}

function getSteelBusinessFunctionTools(
  contextMode: SteelProviderToolContextMode,
): LanguageModelV3FunctionTool[] {
  const existingTools = steelBusinessFunctionToolsByMode.get(contextMode);
  if (existingTools) {
    return existingTools;
  }

  const tools = getSteelToolDefinitions({ contextMode }).map(
    (definition): LanguageModelV3FunctionTool => ({
      type: 'function',
      name: definition.name,
      description: definition.description,
      inputSchema: zodToJsonSchema(definition.argsSchema, {
        $refStrategy: 'none',
      }) as LanguageModelV3FunctionTool['inputSchema'],
    }),
  );

  steelBusinessFunctionToolsByMode.set(contextMode, tools);
  return tools;
}

function isVisualEvidenceFile(file: SteelOAuthChatFile): boolean {
  return getFileSourceKinds(file).length > 0;
}

function getRunFileOcrInventoryText(
  files: readonly SteelOAuthChatFile[],
  fileIndexOffset: number,
): string | undefined {
  const entries = files
    .map((file, index) => {
      if (!isVisualEvidenceFile(file)) {
        return undefined;
      }

      return `- fileIndex=${fileIndexOffset + index}; filename=${file.filename ?? '(unnamed)'}; mediaType=${file.mediaType}`;
    })
    .filter((entry): entry is string => entry !== undefined);

  return entries.length > 0
    ? `Uploaded visual evidence files available for OCR context preparation:\n${entries.join('\n')}`
    : undefined;
}

function toLanguageModelMessage(
  message: SteelOAuthChatMessage,
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
    visualFileIndexOffset = 0,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: ReadonlySet<SteelOAuthChatFile>;
    visualFileIndexOffset?: number;
  } = {},
): LanguageModelV3Message {
  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.content,
    };
  }

  const files = message.files ?? [];
  const ocrInventoryFiles =
    ocrAvailableVisualEvidenceFiles === undefined
      ? files
      : files.filter((file) => ocrAvailableVisualEvidenceFiles.has(file));
  const inventoryText = omitVisualEvidenceFileParts
    ? getRunFileOcrInventoryText(ocrInventoryFiles, visualFileIndexOffset)
    : undefined;

  return {
    role: message.role,
    content: [
      {
        type: 'text',
        text: inventoryText ? `${message.content}\n\n${inventoryText}` : message.content,
      },
      ...files
        .filter((file) => !omitVisualEvidenceFileParts || !isVisualEvidenceFile(file))
        .map((file) => {
          const mediaType = file.mediaType.trim().toLowerCase();

          return {
            type: 'file' as const,
            filename: file.filename,
            mediaType: file.mediaType,
            data: file.data,
            ...(mediaType.startsWith('image/')
              ? {
                  providerOptions: {
                    openai: {
                      imageDetail: 'high',
                    },
                  },
                }
              : {}),
          };
        }),
    ],
  };
}

function toPrompt(
  messages: SteelOAuthChatMessage[],
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: readonly SteelOAuthChatFile[];
  } = {},
): LanguageModelV3Prompt {
  let visualFileIndexOffset = 0;
  const ocrAvailableVisualEvidenceFileSet =
    ocrAvailableVisualEvidenceFiles !== undefined
      ? new Set(ocrAvailableVisualEvidenceFiles)
      : undefined;

  return messages.map((message) => {
    const promptMessage = toLanguageModelMessage(message, {
      omitVisualEvidenceFileParts,
      ocrAvailableVisualEvidenceFiles: ocrAvailableVisualEvidenceFileSet,
      visualFileIndexOffset,
    });
    visualFileIndexOffset += (message.files ?? []).filter((file) => {
      return (
        isVisualEvidenceFile(file) &&
        (ocrAvailableVisualEvidenceFileSet === undefined ||
          ocrAvailableVisualEvidenceFileSet.has(file))
      );
    }).length;

    return promptMessage;
  });
}

type VisualEvidenceSourceKind = 'image' | 'pdf' | 'scanned_pdf';

function getFileSourceKinds(file: SteelOAuthChatFile): VisualEvidenceSourceKind[] {
  const mediaType = file.mediaType.trim().toLowerCase();

  if (mediaType.startsWith('image/')) {
    return ['image'];
  }

  if (mediaType === 'application/pdf') {
    return ['pdf', 'scanned_pdf'];
  }

  return [];
}

function getVisualEvidenceFiles(
  messages: readonly SteelOAuthChatMessage[],
): SteelOAuthChatFile[] {
  const files: SteelOAuthChatFile[] = [];

  for (const message of messages) {
    for (const file of message.files ?? []) {
      if (getFileSourceKinds(file).length === 0) {
        continue;
      }

      files.push(file);
    }
  }

  return files;
}

function toPromptWithSystemInstruction(
  messages: SteelOAuthChatMessage[],
  systemInstruction: string,
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: readonly SteelOAuthChatFile[];
  } = {},
): LanguageModelV3Prompt {
  return [
    {
      role: 'system',
      content: systemInstruction,
    },
    ...toPrompt(messages, { omitVisualEvidenceFileParts, ocrAvailableVisualEvidenceFiles }),
  ];
}

function getSystemInstruction({
  steelRuntimePolicy,
  steelRuntimeContext,
}: {
  steelRuntimePolicy?: boolean;
  steelRuntimeContext?: SteelRuntimeContext;
}): string | undefined {
  if (!steelRuntimePolicy) {
    return undefined;
  }

  if (!steelRuntimeContext) {
    throw new Error('Steel runtime context is required for Steel runtime policy.');
  }

  return `Steel Runtime Context\n\n${serializeSteelRuntimeContext(steelRuntimeContext)}`;
}

function getGeneratedText(result: LanguageModelV3GenerateResult): string {
  return result.content.reduce((text, part) => {
    if (part.type !== 'text') {
      return text;
    }

    return `${text}${part.text}`;
  }, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReadableStreamErrorMessage(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed !== '[object Object]';
}

function extractJsonStreamErrorMessage(value: string, depth: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }

  try {
    return extractStreamErrorMessage(JSON.parse(trimmed), depth + 1);
  } catch {
    return undefined;
  }
}

function extractStreamErrorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 5) {
    return undefined;
  }

  if (typeof value === 'string') {
    const parsedMessage = extractJsonStreamErrorMessage(value, depth);
    if (parsedMessage) {
      return parsedMessage;
    }
    return isReadableStreamErrorMessage(value) ? value.trim() : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const message = extractStreamErrorMessage(entry, depth + 1);
      if (message) {
        return message;
      }
    }
    return undefined;
  }

  if (value instanceof Error) {
    return (
      extractStreamErrorMessage(value.cause, depth + 1) ??
      extractStreamErrorMessage(value.message, depth + 1)
    );
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const fields = [
    'message',
    'error',
    'errorSummary',
    'detail',
    'details',
    'description',
    'reason',
    'cause',
    'response',
    'data',
    'body',
    'error_description',
    'errorMessage',
    'statusText',
  ];

  for (const field of fields) {
    const message = extractStreamErrorMessage(value[field], depth + 1);
    if (message) {
      return message;
    }
  }

  return undefined;
}

function createProviderStreamError(error: unknown): Error {
  const message = extractStreamErrorMessage(error) ?? 'OpenAI OAuth provider stream failed.';
  if (error instanceof Error && error.message === message) {
    return error;
  }

  return new Error(message, { cause: error });
}

function isTransientProviderError(error: unknown): boolean {
  const message = extractStreamErrorMessage(error)?.toLowerCase() ?? '';
  return (
    message.includes('overloaded') ||
    message.includes('try again later') ||
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('too many requests') ||
    message.includes('temporarily unavailable') ||
    message.includes('service unavailable') ||
    message.includes('server unavailable') ||
    message.includes('etimedout') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('connection reset') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    /\b429\b/.test(message) ||
    /\b503\b/.test(message)
  );
}

function getTransientProviderRetryDelayMs(attemptIndex: number): number {
  return (
    transientProviderRetryDelaysMs[attemptIndex] ??
    transientProviderRetryDelaysMs[transientProviderRetryDelaysMs.length - 1] ??
    0
  );
}

function createProviderAbortError() {
  return new Error('OpenAI OAuth provider request aborted.');
}

function throwIfProviderAborted(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw createProviderAbortError();
  }
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(createProviderAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      abortSignal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(createProviderAbortError());
    };
    abortSignal?.addEventListener('abort', abort, { once: true });
  });
}

function getProviderRoundProgressIntervalMs(intervalMs: number | undefined): number {
  if (intervalMs !== undefined) {
    return Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0;
  }

  const parsed = Number(process.env.STEEL_OPENAI_OAUTH_PROVIDER_ROUND_PROGRESS_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultProviderRoundProgressIntervalMs;
}

function getProviderRoundProgressMessage({
  elapsedMs,
  round,
  status,
}: {
  elapsedMs: number;
  round: number;
  status: SteelProviderRoundProgressStatus;
}): string {
  const baseMessage =
    round === 0
      ? `Provider round ${round} waiting for model`
      : `Provider round ${round} generating final response after tool results`;

  if (status !== 'waiting') {
    return baseMessage;
  }

  const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  return `${baseMessage} (${elapsedSeconds}s elapsed)`;
}

function emitProviderRoundStatus(
  onProviderRoundStatus: SteelProviderRoundStatusCallback | undefined,
  event: Parameters<SteelProviderRoundStatusCallback>[0],
): void {
  if (!onProviderRoundStatus) {
    return;
  }

  void Promise.resolve(onProviderRoundStatus(event)).catch(() => undefined);
}

function startProviderRoundProgress({
  onProviderRoundStatus,
  progressIntervalMs,
  promptMessageCount,
  round,
}: {
  onProviderRoundStatus?: SteelProviderRoundStatusCallback;
  progressIntervalMs?: number;
  promptMessageCount: number;
  round: number;
}): () => void {
  if (!onProviderRoundStatus) {
    return () => undefined;
  }

  const startedAt = Date.now();
  const intervalMs = getProviderRoundProgressIntervalMs(progressIntervalMs);
  emitProviderRoundStatus(onProviderRoundStatus, {
    elapsedMs: 0,
    message: getProviderRoundProgressMessage({ elapsedMs: 0, round, status: 'started' }),
    promptMessageCount,
    round,
    status: 'started',
  });

  if (intervalMs <= 0) {
    return () => undefined;
  }

  const interval = setInterval(() => {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    emitProviderRoundStatus(onProviderRoundStatus, {
      elapsedMs,
      message: getProviderRoundProgressMessage({ elapsedMs, round, status: 'waiting' }),
      promptMessageCount,
      round,
      status: 'waiting',
    });
  }, intervalMs);

  return () => {
    clearInterval(interval);
  };
}

async function runWithProviderRoundProgress<T>({
  onProviderRoundStatus,
  progressIntervalMs,
  promptMessageCount,
  round,
  run,
}: {
  onProviderRoundStatus?: SteelProviderRoundStatusCallback;
  progressIntervalMs?: number;
  promptMessageCount: number;
  round: number;
  run: () => Promise<T>;
}): Promise<T> {
  const stopProgress = startProviderRoundProgress({
    onProviderRoundStatus,
    progressIntervalMs,
    promptMessageCount,
    round,
  });

  try {
    return await run();
  } finally {
    stopProgress();
  }
}

function isSteelBusinessToolCall(
  part: LanguageModelV3GenerateResult['content'][number],
  contextMode: SteelProviderToolContextMode,
): part is SteelBusinessToolCall {
  return part.type === 'tool-call' && isSteelToolName(part.toolName, { contextMode });
}

function getSteelBusinessToolCalls(
  result: LanguageModelV3GenerateResult,
  contextMode: SteelProviderToolContextMode,
): SteelBusinessToolCall[] {
  return result.content.filter((part): part is SteelBusinessToolCall =>
    isSteelBusinessToolCall(part, contextMode),
  );
}

function parseToolCallInput(call: LanguageModelV3ToolCall): unknown {
  return JSON.parse(call.input);
}

function createInvalidToolInputResult(call: LanguageModelV3ToolCall): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'invalid_arguments',
    errorSummary: 'Steel tool input must be valid JSON.',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function createToolExecutionErrorResult(
  call: LanguageModelV3ToolCall,
  error: unknown,
): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'repository_error',
    errorSummary: error instanceof Error ? error.message : 'Steel tool execution failed.',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function isFatalSteelToolResult(result: SteelToolResult): boolean {
  return !result.ok && ['rate_limited', 'repository_error'].includes(result.errorCategory);
}

function getFatalSteelToolErrorMessage(call: SteelBusinessToolCall, result: SteelToolResult) {
  if (result.ok) {
    return '';
  }

  return `Steel tool ${call.toolName} failed: ${result.errorSummary}`;
}

function toJsonValue(value: unknown): JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return null;
  }

  return JSON.parse(serialized) as JSONValue;
}

function uniquePriceQueries(queries: readonly SearchPriceCandidateQuery[]): SearchPriceCandidateQuery[] {
  const seen = new Set<string>();

  return queries.filter((query) => {
    const key = JSON.stringify(query);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function createBatchedSearchPriceInput(
  inputs: readonly SearchPriceCandidatesInput[],
): SearchPriceCandidatesInput | undefined {
  if (inputs.length < 2) {
    return undefined;
  }

  const queries = uniquePriceQueries(inputs.flatMap((input) => input.queries));
  if (queries.length === 0 || queries.length > 20) {
    return undefined;
  }

  return steelToolArgsSchemas.search_price_candidates.parse({
    queries,
  });
}

interface ExecutedSteelToolCall {
  call: SteelBusinessToolCall;
  input: unknown;
  result: SteelToolResult;
  coalescedResultOfToolCallId?: string;
}

function getJsonArrayCount(value: SteelToolJsonObject[string]): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function createCoalescedSearchPriceResult(
  result: SteelToolResult,
  primaryToolCallId: string,
): SteelToolResult {
  if (!result.ok || result.toolName !== 'search_price_candidates') {
    return result;
  }

  const data: SteelToolJsonObject = {
    coalescedWithProviderToolCallId: primaryToolCallId,
    message: 'Full search_price_candidates data is available in the referenced tool result.',
  };
  const priceCandidateCount = getJsonArrayCount(result.data.priceCandidates);
  const categoryCandidateCount = getJsonArrayCount(result.data.categoryCandidates);
  const searchQueryCount = getJsonArrayCount(result.data.searchQueries);

  if (priceCandidateCount !== undefined) {
    data.priceCandidateCount = priceCandidateCount;
  }
  if (categoryCandidateCount !== undefined) {
    data.categoryCandidateCount = categoryCandidateCount;
  }
  if (searchQueryCount !== undefined) {
    data.searchQueryCount = searchQueryCount;
  }

  return {
    ...result,
    data,
  };
}

function createInvalidToolArgumentsResult(
  call: LanguageModelV3ToolCall,
  errorSummary: string,
): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'invalid_arguments',
    errorSummary,
    durationMs: 0,
    redactionVersion: 1,
  };
}

function reserveProviderToolCall(
  call: LanguageModelV3ToolCall,
  runState: SteelToolRunState,
): SteelToolResult | undefined {
  if (runState.callsUsed < runState.maxCalls) {
    runState.callsUsed += 1;
    return undefined;
  }

  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'rate_limited',
    errorSummary: 'Steel tool call limit exceeded',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function recordProviderToolCallIfNeeded(
  runState: SteelToolRunState,
  callsUsedBeforeExecution: number,
  result: SteelToolResult,
) {
  if (
    runState.callsUsed === callsUsedBeforeExecution &&
    (!result.ok ? result.errorCategory !== 'rate_limited' : true)
  ) {
    runState.callsUsed += 1;
  }
}

async function executeProviderBusinessToolCall({
  call,
  executeSteelToolCall,
  input,
  runState,
}: {
  call: SteelBusinessToolCall;
  executeSteelToolCall: SteelProviderToolExecutor;
  input: unknown;
  runState: SteelToolRunState;
}): Promise<SteelToolResult> {
  if (runState.callsUsed >= runState.maxCalls) {
    return {
      ok: false,
      toolName: call.toolName,
      errorCategory: 'rate_limited',
      errorSummary: 'Steel tool call limit exceeded',
      durationMs: 0,
      redactionVersion: 1,
    };
  }

  const callsUsedBeforeExecution = runState.callsUsed;

  try {
    const result = await executeSteelToolCall({
      toolName: call.toolName,
      arguments: input,
      providerToolCallId: call.toolCallId,
      runState,
    });
    recordProviderToolCallIfNeeded(runState, callsUsedBeforeExecution, result);
    return result;
  } catch (error) {
    const result = createToolExecutionErrorResult(call, error);
    recordProviderToolCallIfNeeded(runState, callsUsedBeforeExecution, result);
    return result;
  }
}

async function executeSteelBusinessToolCalls({
  calls,
  executeSteelToolCall,
  files,
  onToolStatus,
  runState,
}: {
  calls: SteelBusinessToolCall[];
  executeSteelToolCall: SteelProviderToolExecutor;
  files: readonly SteelOAuthChatFile[];
  onToolStatus?: SteelProviderToolStatusCallback;
  runState: SteelToolRunState;
}): Promise<ExecutedSteelToolCall[]> {
  const executedCalls: ExecutedSteelToolCall[] = [];
  const coalescedToolCallIds = new Set<string>();

  for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
    const call = calls[callIndex];
    if (!call || coalescedToolCallIds.has(call.toolCallId)) {
      continue;
    }

    let input: unknown;
    let result: SteelToolResult;
    try {
      input = parseToolCallInput(call);
    } catch {
      input = {};
      result = createInvalidToolInputResult(call);
      executedCalls.push({
        call,
        input,
        result,
      });
      continue;
    }

    if (call.toolName === 'run_file_ocr') {
      const parsedOcrInput = steelToolArgsSchemas.run_file_ocr.safeParse(input);
      if (!parsedOcrInput.success) {
        result = createInvalidToolArgumentsResult(
          call,
          parsedOcrInput.error.issues.map((issue) => issue.message).join('; '),
        );
        executedCalls.push({
          call,
          input,
          result,
        });
        continue;
      }

      result =
        reserveProviderToolCall(call, runState) ??
        (await (async () => {
          await onToolStatus?.({
            toolName: call.toolName,
            status: 'started',
            message: `${call.toolName} started`,
          });
          const toolResult = await runSteelFileOcr({
            arguments: parsedOcrInput.data,
            files,
            providerToolCallId: call.toolCallId,
          });
          await onToolStatus?.({
            toolName: call.toolName,
            status: toolResult.ok ? 'completed' : 'failed',
            message: toolResult.ok
              ? `${call.toolName} completed`
              : `${call.toolName} failed: ${toolResult.errorSummary}`,
            result: toolResult,
            errorSummary: toolResult.ok ? undefined : toolResult.errorSummary,
          });
          return toolResult;
        })());

      executedCalls.push({
        call,
        input: parsedOcrInput.data,
        result,
      });

      if (isFatalSteelToolResult(result)) {
        throw new Error(getFatalSteelToolErrorMessage(call, result));
      }
      continue;
    }

    if (call.toolName === 'search_price_candidates') {
      const parsedSearchInput = steelToolArgsSchemas.search_price_candidates.safeParse(input);
      if (parsedSearchInput.success) {
        const searchInput = parsedSearchInput.data;
        input = searchInput;
        const groupedCalls: Array<{
          call: SteelBusinessToolCall;
          input: unknown;
          searchInput: SearchPriceCandidatesInput;
        }> = [{ call, input, searchInput }];

        for (const siblingCall of calls.slice(callIndex + 1)) {
          if (
            siblingCall.toolName !== 'search_price_candidates' ||
            coalescedToolCallIds.has(siblingCall.toolCallId)
          ) {
            continue;
          }

          let siblingInput: unknown;
          try {
            siblingInput = parseToolCallInput(siblingCall);
          } catch {
            continue;
          }

          const parsedSiblingSearchInput =
            steelToolArgsSchemas.search_price_candidates.safeParse(siblingInput);
          if (parsedSiblingSearchInput.success) {
            groupedCalls.push({
              call: siblingCall,
              input: parsedSiblingSearchInput.data,
              searchInput: parsedSiblingSearchInput.data,
            });
          }
        }

        const batchedInput = createBatchedSearchPriceInput(
          groupedCalls.map(({ searchInput }) => searchInput),
        );
        if (batchedInput) {
          result = await executeProviderBusinessToolCall({
            call,
            executeSteelToolCall,
            input: batchedInput,
            runState,
          });

          for (const groupedCall of groupedCalls) {
            coalescedToolCallIds.add(groupedCall.call.toolCallId);
            executedCalls.push({
              call: groupedCall.call,
              input: groupedCall.input,
              result,
              ...(groupedCall.call.toolCallId !== call.toolCallId
                ? { coalescedResultOfToolCallId: call.toolCallId }
                : {}),
            });
          }

          if (isFatalSteelToolResult(result)) {
            throw new Error(getFatalSteelToolErrorMessage(call, result));
          }
          continue;
        }
      }
    }

    result = await executeProviderBusinessToolCall({
      call,
      executeSteelToolCall,
      input,
      runState,
    });

    if (isFatalSteelToolResult(result)) {
      executedCalls.push({
        call,
        input,
        result,
      });
      throw new Error(getFatalSteelToolErrorMessage(call, result));
    }

    executedCalls.push({
      call,
      input,
      result,
    });
  }

  return executedCalls;
}

function toAssistantToolCallMessage(executedCalls: ExecutedSteelToolCall[]): LanguageModelV3Message {
  return {
    role: 'assistant',
    content: [
      ...executedCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
    ],
  };
}

function toToolResultMessage(executedCalls: ExecutedSteelToolCall[]): LanguageModelV3Message {
  return {
    role: 'tool',
    content: [
      ...executedCalls.map(({ call, coalescedResultOfToolCallId, result }) => {
        const outputResult = coalescedResultOfToolCallId
          ? createCoalescedSearchPriceResult(result, coalescedResultOfToolCallId)
          : result;

        return {
          type: 'tool-result' as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: {
            type: 'json' as const,
            value: toJsonValue(outputResult),
          },
        };
      }),
    ],
  };
}

function getReasoningSummaries(result: LanguageModelV3GenerateResult): string[] {
  return result.content
    .filter(
      (
        part,
      ): part is Extract<LanguageModelV3GenerateResult['content'][number], { type: 'reasoning' }> =>
        part.type === 'reasoning',
    )
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0);
}

function getWarningText(warning: SharedV3Warning): string {
  if (warning.type === 'other') {
    return warning.message;
  }

  return warning.details ? `${warning.feature}: ${warning.details}` : warning.feature;
}

function sumTokenTotals(
  results: LanguageModelV3GenerateResult[],
  getTotal: (result: LanguageModelV3GenerateResult) => number | undefined,
) {
  const totals = results
    .map(getTotal)
    .filter((value): value is number => typeof value === 'number');

  return totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) : undefined;
}

function getUsage(results: LanguageModelV3GenerateResult[]): SteelProviderChatResponse['usage'] {
  const inputTokens = sumTokenTotals(results, (result) => result.usage.inputTokens.total);
  const outputTokens = sumTokenTotals(results, (result) => result.usage.outputTokens.total);
  const totalTokens =
    typeof inputTokens === 'number' && typeof outputTokens === 'number'
      ? inputTokens + outputTokens
      : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function getWarnings(results: LanguageModelV3GenerateResult[]): string[] {
  return results.flatMap((result) => result.warnings.map(getWarningText));
}

function sumRoundTimings(
  rounds: readonly SteelProviderRoundTiming[],
  getDuration: (round: SteelProviderRoundTiming) => number,
) {
  return rounds.reduce((total, round) => total + getDuration(round), 0);
}

function getProviderTimings({
  rounds,
  startedAt,
}: {
  rounds: readonly SteelProviderRoundTiming[];
  startedAt: number;
}): SteelProviderTimings {
  return {
    totalDurationMs: Math.max(0, Date.now() - startedAt),
    generationDurationMs: sumRoundTimings(rounds, (round) => round.generationDurationMs),
    toolDurationMs: sumRoundTimings(rounds, (round) => round.toolDurationMs),
    roundCount: rounds.length,
    rounds: [...rounds],
  };
}

function countGeneratedToolCalls(result: LanguageModelV3GenerateResult): number {
  return result.content.filter((part) => part.type === 'tool-call').length;
}

function getDefaultFinishReason() {
  return { unified: 'stop' as const, raw: 'stop' };
}

function getDefaultUsage(): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 0,
      text: 0,
      reasoning: 0,
    },
  };
}

async function streamToGenerateResult({
  stream,
  onReasoningSummary,
  onTextDelta,
}: {
  stream: ReadableStream<LanguageModelV3StreamPart>;
  onReasoningSummary?: (summary: string) => void;
  onTextDelta?: (delta: string) => void;
}): Promise<LanguageModelV3GenerateResult> {
  const content: LanguageModelV3GenerateResult['content'] = [];
  const warnings: SharedV3Warning[] = [];
  let response: LanguageModelV3GenerateResult['response'];
  let usage: LanguageModelV3GenerateResult['usage'] = getDefaultUsage();
  let finishReason: LanguageModelV3GenerateResult['finishReason'] = getDefaultFinishReason();
  let currentText = '';

  const flushText = () => {
    if (currentText.length === 0) {
      return;
    }

    content.push({ type: 'text', text: currentText });
    currentText = '';
  };

  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      const part = next.value;
      switch (part.type) {
        case 'stream-start':
          warnings.push(...part.warnings);
          break;
        case 'response-metadata':
          response = part;
          break;
        case 'text-delta':
          currentText += part.delta;
          onTextDelta?.(part.delta);
          break;
        case 'text-end':
          flushText();
          break;
        case 'reasoning-delta':
          onReasoningSummary?.(part.delta);
          break;
        case 'tool-call':
          flushText();
          content.push(part);
          break;
        case 'finish':
          flushText();
          usage = part.usage;
          finishReason = part.finishReason;
          break;
        case 'error':
          throw createProviderStreamError(part.error);
        default:
          break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  flushText();

  return {
    content,
    finishReason,
    usage,
    response,
    warnings,
  };
}

async function generateProviderRoundWithRetry({
  callOptions,
  languageModel,
  onReasoningSummary,
  onTextDelta,
}: {
  callOptions: LanguageModelV3CallOptions;
  languageModel: LanguageModelV3;
  onReasoningSummary?: (summary: string) => void;
  onTextDelta?: (delta: string) => void;
}): Promise<LanguageModelV3GenerateResult> {
  for (let attemptIndex = 0; attemptIndex < transientProviderMaxAttempts; attemptIndex += 1) {
    throwIfProviderAborted(callOptions.abortSignal);
    let streamedTextDelta = false;
    const onAttemptTextDelta = onTextDelta
      ? (delta: string) => {
          streamedTextDelta = true;
          onTextDelta(delta);
        }
      : undefined;

    try {
      if (onTextDelta && typeof languageModel.doStream === 'function') {
        return await streamToGenerateResult({
          ...(await languageModel.doStream(callOptions)),
          onReasoningSummary,
          onTextDelta: onAttemptTextDelta,
        });
      }

      return await languageModel.doGenerate(callOptions);
    } catch (error) {
      const canRetry =
        !streamedTextDelta &&
        attemptIndex < transientProviderMaxAttempts - 1 &&
        isTransientProviderError(error);
      if (!canRetry) {
        throw error;
      }

      await sleep(getTransientProviderRetryDelayMs(attemptIndex), callOptions.abortSignal);
    }
  }

  throw new Error('OpenAI OAuth provider retry loop exited unexpectedly.');
}

export async function sendSteelOAuthChat({
  abortSignal,
  authFilePath,
  createOpenAIOAuth: injectedCreateOpenAIOAuth,
  ensureFresh = true,
  executeSteelToolCall = executeDefaultSteelToolCall,
  fetch,
  maxOutputTokens,
  messages,
  model,
  onReasoningSummary,
  onTextDelta,
  onToolStatus,
  onProviderRoundStatus,
  passThroughUnsupportedFiles,
  providerRoundProgressIntervalMs,
  reasoningEffort,
  steelToolMaxCalls,
  steelRuntimePolicy,
  steelRuntimeContext,
}: SendSteelOAuthChatOptions): Promise<SteelProviderChatResponse> {
  const providerStartedAt = Date.now();
  const promptMessages = messages;
  const allVisualEvidenceFiles =
    steelRuntimePolicy === true ? getVisualEvidenceFiles(promptMessages) : [];
  const systemInstruction = getSystemInstruction({
    steelRuntimePolicy,
    steelRuntimeContext,
  });
  const runtimeContextMode = steelRuntimeContext?.outputSheets.contextMode ?? 'full';
  const createOpenAIOAuth = injectedCreateOpenAIOAuth ?? (await loadCreateOpenAIOAuth());
  const openai = createOpenAIOAuth({
    authFilePath,
    ensureFresh,
    fetch,
    responsesState: false,
  });
  const tools = [
    ...(steelRuntimePolicy ? getSteelBusinessFunctionTools(runtimeContextMode) : []),
  ] satisfies SteelRoundTool[];
  const maxToolCalls = steelToolMaxCalls ?? defaultSteelToolMaxCalls;
  const runState = createSteelToolRunState(maxToolCalls);
  const omitVisualEvidenceFileParts = false;
  let prompt = systemInstruction
    ? toPromptWithSystemInstruction(promptMessages, systemInstruction, {
        omitVisualEvidenceFileParts,
        ocrAvailableVisualEvidenceFiles: allVisualEvidenceFiles,
      })
    : toPrompt(promptMessages, {
        omitVisualEvidenceFileParts,
        ocrAvailableVisualEvidenceFiles: allVisualEvidenceFiles,
      });
  const generationResults: LanguageModelV3GenerateResult[] = [];
  const roundTimings: SteelProviderRoundTiming[] = [];

  for (let round = 0; round <= maxToolCalls; round += 1) {
    const promptMessageCount = prompt.length;
    const generationStartedAt = Date.now();
    const languageModel = openai(model);
    const callOptions: LanguageModelV3CallOptions = {
      abortSignal,
      prompt,
      maxOutputTokens,
      ...(tools.length > 0
        ? {
            tools,
            toolChoice: { type: 'auto' as const },
          }
        : {}),
      providerOptions: {
        openai: {
          passThroughUnsupportedFiles,
          reasoningEffort,
          ...(onReasoningSummary ? { reasoningSummary: 'auto' as const } : {}),
        },
      },
    };
    const result = await runWithProviderRoundProgress({
      onProviderRoundStatus,
      progressIntervalMs: providerRoundProgressIntervalMs,
      promptMessageCount,
      round,
      run: () =>
        generateProviderRoundWithRetry({
          callOptions,
          languageModel,
          onReasoningSummary,
          onTextDelta,
        }),
    });
    const generationDurationMs = Math.max(0, Date.now() - generationStartedAt);
    let toolDurationMs = 0;

    generationResults.push(result);
    for (const summary of getReasoningSummaries(result)) {
      onReasoningSummary?.(summary);
    }
    let recordedRoundTiming = false;
    const recordRoundTiming = () => {
      if (recordedRoundTiming) {
        return;
      }

      recordedRoundTiming = true;
      roundTimings.push({
        round,
        generationDurationMs,
        toolDurationMs,
        promptMessageCount,
        generatedToolCallCount: countGeneratedToolCalls(result),
      });
    };

    const steelBusinessToolCalls = steelRuntimePolicy
      ? getSteelBusinessToolCalls(result, runtimeContextMode)
      : [];
    if (steelBusinessToolCalls.length === 0) {
      recordRoundTiming();
      break;
    }
    if (round >= maxToolCalls) {
      throw new Error('Steel tool call limit exceeded');
    }

    const steelBusinessToolsStartedAt = Date.now();
    const executedCalls = await executeSteelBusinessToolCalls({
      calls: steelBusinessToolCalls,
      executeSteelToolCall,
      files: allVisualEvidenceFiles,
      onToolStatus,
      runState,
    });
    toolDurationMs += Math.max(0, Date.now() - steelBusinessToolsStartedAt);
    const nextPrompt = [
      ...prompt,
      toAssistantToolCallMessage(executedCalls),
      toToolResultMessage(executedCalls),
    ];
    prompt = nextPrompt;
    recordRoundTiming();
  }

  const result = generationResults[generationResults.length - 1];
  if (!result) {
    throw new Error('OpenAI OAuth provider did not return a Steel chat result.');
  }

  return {
    provider: 'openai_oauth_responses',
    model,
    text: getGeneratedText(result),
    responseId: result.response?.id,
    usage: getUsage(generationResults),
    timings: getProviderTimings({ rounds: roundTimings, startedAt: providerStartedAt }),
    unsupportedSettings: [],
    warnings: getWarnings(generationResults),
  };
}
