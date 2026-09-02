import type { SteelOcrMissingPageRangesByFileKey } from '../ocr/failures';
import type { OcrPreprocessingPipelineProgress } from '../ocr/preprocess';
import { isPaddleOcrDiagnosticCode } from '../ocr/diagnostics';
import type { CaptureSteelNativeToolResultResult } from './tool-result';

export const steelNativeStreamEventName = 'steel_event' as const;

export const steelNativeActivityEventMaxBytes: number = 16 * 1024;
export const steelNativeActivityEventMaxCount: number = 100;
export const steelNativeActivityEventsMaxBytes: number = 128 * 1024;
export const steelNativeHistoryMaxBytes: number = 12 * 1024 * 1024;
export const steelNativePreflightToolCallMaxCount: number = 100;
export const steelNativePreflightToolCallIdMaxBytes: number = 256;
export const steelNativePreflightToolCallOutputMaxBytes: number = 4 * 1024;
export const steelNativeErrorMessageMaxLength: number = 512;

export type SteelNativeEventSource =
  | 'ocr_preprocessing'
  | 'paddleocr_preflight'
  | 'delegate_ocr_preflight'
  | 'tool_result'
  | 'quote_runtime';

export type SteelNativeDelegateOcrStage =
  | 'resume'
  | 'paddleocr'
  | 'organizer'
  | 'agent'
  | 'reconciliation'
  | 'saving'
  | 'summary'
  | 'response';

export type SteelNativeDelegateOcrStatus =
  | 'started'
  | 'progress'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'replaced';

export type SteelNativeSavedCounts = Record<string, number>;
export type SteelNativeTableCounts = Record<string, number>;

export interface SteelNativeEventBase {
  source: SteelNativeEventSource;
  conversationId?: string;
  requestId?: string;
  messageId?: string;
  toolName?: string;
  providerToolCallId?: string;
}

export interface SteelNativeParseStatusEvent extends SteelNativeEventBase {
  type: 'parse_status';
  message: string;
  parseStatus: 'saved' | 'partial' | 'skipped';
  errorMessage?: string;
  failedKeys?: readonly string[];
  missingPageRangesByFileKey?: SteelOcrMissingPageRangesByFileKey;
  savedCounts?: SteelNativeSavedCounts;
  savedTableCounts?: SteelNativeTableCounts;
  totalSavedCounts?: SteelNativeSavedCounts;
  totalTableCounts?: SteelNativeTableCounts;
}

export interface SteelNativeMemorySavedEvent extends SteelNativeEventBase {
  type: 'memory_saved';
  message: string;
  savedCounts: SteelNativeSavedCounts;
  savedTableCounts?: SteelNativeTableCounts;
  totalSavedCounts?: SteelNativeSavedCounts;
  totalTableCounts?: SteelNativeTableCounts;
}

export interface SteelNativeDelegateOcrStatusEvent extends SteelNativeEventBase {
  type: 'delegate_ocr_status';
  source: 'delegate_ocr_preflight';
  delegateOcrIndex: number;
  stage: SteelNativeDelegateOcrStage;
  status: SteelNativeDelegateOcrStatus;
  message: string;
  errorMessage?: string;
  chunkIndex?: number;
  chunkCount?: number;
  /** Correlation values are accepted on live events but are stripped before persistence. */
  claimToken?: string;
  generationId?: string;
  attemptToken?: string;
}

export interface SteelNativeQuoteAuditStartedEvent extends SteelNativeEventBase {
  type: 'quote_audit';
  stage: 'stage_2';
  status: 'started';
  message: 'Stage 2 started';
}

export interface SteelNativeCodeInterpreterAuditEvent extends SteelNativeEventBase {
  type: 'quote_audit';
  stage: 'stage_1' | 'stage_2';
  status: 'executed';
  message: 'Code Interpreter executed';
  toolName: 'code_interpreter';
}

export type SteelNativeQuoteAuditEvent =
  | SteelNativeQuoteAuditStartedEvent
  | SteelNativeCodeInterpreterAuditEvent;

export type SteelNativeStreamEvent =
  | SteelNativeParseStatusEvent
  | SteelNativeMemorySavedEvent
  | SteelNativeDelegateOcrStatusEvent
  | SteelNativeQuoteAuditEvent;

export interface SteelNativeEventEnvelope {
  event: typeof steelNativeStreamEventName;
  data: SteelNativeStreamEvent;
}

export interface SteelNativePreflightToolCallArgs {
  input_data?: string;
  output_mode: 'detailed';
  return_images: boolean;
  use_doc_orientation_classify: boolean;
  use_doc_unwarping: boolean;
  use_layout_detection: boolean;
}

export interface SteelNativePreflightToolCall {
  type: 'tool_call';
  id: string;
  name: string;
  args: SteelNativePreflightToolCallArgs;
  output?: string;
  progress: 0 | 1;
}

export interface SteelNativeHistory {
  activityEvents: SteelNativeStreamEvent[];
  preflightToolCalls: SteelNativePreflightToolCall[];
}

interface SteelNativeHistoryContext {
  steelHistory?: SteelNativeHistory;
  steelActivityEvents?: SteelNativeStreamEvent[];
}

export type SteelNativeHistoryTarget = SteelNativeHistory | SteelNativeStreamEvent[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSteelNativeHistory(value: unknown): value is SteelNativeHistory {
  return (
    isRecord(value) &&
    Array.isArray(value.activityEvents) &&
    Array.isArray(value.preflightToolCalls)
  );
}

const steelNativeEventBaseFields = [
  'conversationId',
  'requestId',
  'messageId',
  'toolName',
  'providerToolCallId',
] as const;

const steelNativeEventSources = [
  'ocr_preprocessing',
  'paddleocr_preflight',
  'delegate_ocr_preflight',
  'tool_result',
  'quote_runtime',
] as const;
const steelNativeEventSourceSet = new Set<string>(steelNativeEventSources);

function isSteelNativeEventSource(value: unknown): value is SteelNativeEventSource {
  return typeof value === 'string' && steelNativeEventSourceSet.has(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function sanitizeErrorMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .replace(/https?:\/\/[^\s<>"'`]+/giu, '[redacted-url]')
    .replace(
      /\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|authorization|credential|password|secret|signature|sig|token|key)\s*[:=]\s*[^\s&;,]+/giu,
      (match) => `${match.slice(0, match.search(/[:=]/u) + 1)}[REDACTED]`,
    )
    .replace(/\bBearer\s+[^\s"'`]+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-z0-9_-]+/giu, 'sk-[REDACTED]')
    .split('')
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029
        ? ' '
        : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length <= steelNativeErrorMessageMaxLength
    ? normalized
    : `${normalized.slice(0, steelNativeErrorMessageMaxLength - 3)}...`;
}

function canonicalizeCountMap(value: unknown): Record<string, number> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isCountMap(value)) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(value));
}

function canonicalizeMissingPageRanges(
  value: unknown,
): SteelOcrMissingPageRangesByFileKey | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isMissingPageRangesByFileKey(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).map(([fileKey, ranges]) => [
      fileKey,
      ranges.map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd })),
    ]),
  );
}

function copyBaseEventFields(
  value: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  target.source = value.source;
  for (const field of steelNativeEventBaseFields) {
    if (typeof value[field] === 'string') {
      target[field] = value[field];
    }
  }
}

/**
 * Parse persisted Steel history through the same validators and bounds used by
 * the live event collectors. The returned value is always a deep clone, so
 * callers cannot mutate a job-store snapshot by retaining the input object.
 */
export function parseSteelNativeHistory(value: unknown): SteelNativeHistory | undefined {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isSteelNativeHistory(parsed)) {
    return undefined;
  }
  if (
    parsed.activityEvents.length > steelNativeActivityEventMaxCount ||
    parsed.preflightToolCalls.length > steelNativePreflightToolCallMaxCount
  ) {
    return undefined;
  }

  try {
    const activityEvents = parsed.activityEvents.map((event) => {
      const canonicalEvent = canonicalizeSteelNativeEvent(event);
      if (!canonicalEvent) {
        throw new Error('invalid Steel activity event');
      }
      const serialized = JSON.stringify(canonicalEvent);
      if (
        typeof serialized !== 'string' ||
        Buffer.byteLength(serialized, 'utf8') > steelNativeActivityEventMaxBytes
      ) {
        throw new Error('oversized Steel activity event');
      }
      return JSON.parse(serialized) as SteelNativeStreamEvent;
    });
    const preflightToolCalls = parsed.preflightToolCalls.map((card) => {
      const canonicalCard = canonicalizeSteelNativePreflightToolCall(card, true);
      if (!canonicalCard) {
        throw new Error('invalid Steel preflight tool call');
      }
      const serialized = JSON.stringify(canonicalCard);
      if (typeof serialized !== 'string') {
        throw new Error('invalid Steel preflight tool call serialization');
      }
      return JSON.parse(serialized) as SteelNativePreflightToolCall;
    });
    const history = { activityEvents, preflightToolCalls };
    const activityBytes = activityEvents.reduce(
      (total, event) => total + Buffer.byteLength(JSON.stringify(event), 'utf8'),
      0,
    );
    if (activityBytes > steelNativeActivityEventsMaxBytes) {
      return undefined;
    }
    const serialized = JSON.stringify(history);
    if (
      typeof serialized !== 'string' ||
      Buffer.byteLength(serialized, 'utf8') > steelNativeHistoryMaxBytes
    ) {
      return undefined;
    }
    return history;
  } catch {
    return undefined;
  }
}

export function cloneSteelNativeHistory(value: unknown): SteelNativeHistory | undefined {
  return parseSteelNativeHistory(value);
}

export function createSteelNativeHistory(): SteelNativeHistory {
  return { activityEvents: [], preflightToolCalls: [] };
}

export function ensureSteelNativeHistory(context: SteelNativeHistoryContext): SteelNativeHistory {
  const existingHistory = context.steelHistory;
  if (isSteelNativeHistory(existingHistory)) {
    const parsed = parseSteelNativeHistory(existingHistory);
    if (parsed) {
      for (const key of Object.keys(existingHistory)) {
        if (key !== 'activityEvents' && key !== 'preflightToolCalls') {
          delete (existingHistory as Record<string, unknown>)[key];
        }
      }
      existingHistory.activityEvents.splice(
        0,
        existingHistory.activityEvents.length,
        ...parsed.activityEvents,
      );
      existingHistory.preflightToolCalls.splice(
        0,
        existingHistory.preflightToolCalls.length,
        ...parsed.preflightToolCalls,
      );
      context.steelHistory = existingHistory;
      context.steelActivityEvents = existingHistory.activityEvents;
      return existingHistory;
    }
  }

  const history = createSteelNativeHistory();
  if (Array.isArray(context.steelActivityEvents)) {
    const parsed = parseSteelNativeHistory({
      activityEvents: context.steelActivityEvents,
      preflightToolCalls: [],
    });
    if (parsed) {
      context.steelActivityEvents.splice(
        0,
        context.steelActivityEvents.length,
        ...parsed.activityEvents,
      );
      history.activityEvents = context.steelActivityEvents;
    }
  }

  context.steelHistory = history;
  context.steelActivityEvents = history.activityEvents;
  return history;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isCountMap(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

function isSafePageRange(value: unknown): value is { pageStart: number; pageEnd: number } {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.pageStart) &&
    Number.isSafeInteger(value.pageEnd) &&
    (value.pageStart as number) >= 1 &&
    (value.pageEnd as number) >= (value.pageStart as number)
  );
}

function isMissingPageRangesByFileKey(value: unknown): value is SteelOcrMissingPageRangesByFileKey {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (ranges) => Array.isArray(ranges) && ranges.every((range) => isSafePageRange(range)),
    )
  );
}

function hasValidBaseEventFields(value: Record<string, unknown>): boolean {
  return ['conversationId', 'requestId', 'messageId', 'toolName', 'providerToolCallId'].every(
    (field) => value[field] === undefined || typeof value[field] === 'string',
  );
}

function isSteelNativeEventData(value: unknown): value is SteelNativeStreamEvent {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    typeof value.source !== 'string' ||
    !isSteelNativeEventSource(value.source) ||
    !hasValidBaseEventFields(value)
  ) {
    return false;
  }

  if (value.type === 'parse_status') {
    if (
      !hasOnlyKeys(value, [
        'type',
        'source',
        ...steelNativeEventBaseFields,
        'message',
        'parseStatus',
        'errorMessage',
        'failedKeys',
        'missingPageRangesByFileKey',
        'savedCounts',
        'savedTableCounts',
        'totalSavedCounts',
        'totalTableCounts',
      ])
    ) {
      return false;
    }
    return (
      typeof value.message === 'string' &&
      ['saved', 'partial', 'skipped'].includes(value.parseStatus as string) &&
      (value.errorMessage === undefined || typeof value.errorMessage === 'string') &&
      (value.failedKeys === undefined || isStringArray(value.failedKeys)) &&
      (value.missingPageRangesByFileKey === undefined ||
        isMissingPageRangesByFileKey(value.missingPageRangesByFileKey)) &&
      (value.savedCounts === undefined || isCountMap(value.savedCounts)) &&
      (value.totalSavedCounts === undefined || isCountMap(value.totalSavedCounts)) &&
      (value.savedTableCounts === undefined || isCountMap(value.savedTableCounts)) &&
      (value.totalTableCounts === undefined || isCountMap(value.totalTableCounts))
    );
  }

  if (value.type === 'delegate_ocr_status') {
    if (
      !hasOnlyKeys(value, [
        'type',
        'source',
        ...steelNativeEventBaseFields,
        'delegateOcrIndex',
        'stage',
        'status',
        'message',
        'errorMessage',
        'chunkIndex',
        'chunkCount',
        'claimToken',
        'generationId',
        'attemptToken',
      ])
    ) {
      return false;
    }
    return (
      value.source === 'delegate_ocr_preflight' &&
      isSafeInteger(value.delegateOcrIndex) &&
      value.delegateOcrIndex >= 1 &&
      ['resume', 'paddleocr', 'organizer', 'agent', 'reconciliation', 'saving', 'summary', 'response'].includes(
        value.stage as string,
      ) &&
      ['started', 'progress', 'retrying', 'succeeded', 'failed', 'replaced'].includes(
        value.status as string,
      ) &&
      typeof value.message === 'string' &&
      (value.errorMessage === undefined || typeof value.errorMessage === 'string') &&
      (value.chunkIndex === undefined || (isSafeInteger(value.chunkIndex) && value.chunkIndex >= 0)) &&
      (value.chunkCount === undefined || (isSafeInteger(value.chunkCount) && value.chunkCount >= 1)) &&
      (value.claimToken === undefined || typeof value.claimToken === 'string') &&
      (value.generationId === undefined || typeof value.generationId === 'string') &&
      (value.attemptToken === undefined || typeof value.attemptToken === 'string')
    );
  }

  if (value.type === 'memory_saved') {
    if (
      !hasOnlyKeys(value, [
        'type',
        'source',
        ...steelNativeEventBaseFields,
        'message',
        'savedCounts',
        'savedTableCounts',
        'totalSavedCounts',
        'totalTableCounts',
      ])
    ) {
      return false;
    }
    return (
      typeof value.message === 'string' &&
      isCountMap(value.savedCounts) &&
      (value.savedTableCounts === undefined || isCountMap(value.savedTableCounts)) &&
      (value.totalSavedCounts === undefined || isCountMap(value.totalSavedCounts)) &&
      (value.totalTableCounts === undefined || isCountMap(value.totalTableCounts))
    );
  }

  if (value.type !== 'quote_audit') {
    return false;
  }

  if (value.stage === 'stage_2' && value.status === 'started') {
    if (
      !hasOnlyKeys(value, [
        'type',
        'source',
        ...steelNativeEventBaseFields,
        'stage',
        'status',
        'message',
      ])
    ) {
      return false;
    }
    return value.source === 'quote_runtime' && value.message === 'Stage 2 started';
  }

  if (
    !hasOnlyKeys(value, [
      'type',
      'source',
      ...steelNativeEventBaseFields,
      'stage',
      'status',
      'message',
    ])
  ) {
    return false;
  }
  return (
    value.source === 'quote_runtime' &&
    (value.stage === 'stage_1' || value.stage === 'stage_2') &&
    value.status === 'executed' &&
    value.message === 'Code Interpreter executed' &&
    value.toolName === 'code_interpreter'
  );
}

function isPreflightToolCallArgs(value: unknown): value is SteelNativePreflightToolCallArgs {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  const requiredKeys = [
    'output_mode',
    'return_images',
    'use_doc_orientation_classify',
    'use_doc_unwarping',
    'use_layout_detection',
  ];
  const acceptedKeys =
    value.input_data === undefined ? requiredKeys : [...requiredKeys, 'input_data'];
  if (keys.join(',') !== acceptedKeys.sort().join(',')) {
    return false;
  }
  return (
    (value.input_data === undefined || typeof value.input_data === 'string') &&
    value.output_mode === 'detailed' &&
    typeof value.return_images === 'boolean' &&
    typeof value.use_doc_orientation_classify === 'boolean' &&
    typeof value.use_doc_unwarping === 'boolean' &&
    typeof value.use_layout_detection === 'boolean'
  );
}

const steelNativePaddleOcrCompactSuccessOutputKeys = [
  'status',
  'paddleocr',
  'ocrEngine',
  'ocrFileKey',
  'filename',
  'chunkIndex',
  'chunkCount',
  'pageStart',
  'pageEnd',
  'dataSizeBytes',
] as const;

const steelNativePaddleOcrHistoricalSuccessOutputKeys = [
  'status',
  'paddleocr',
  'ocrEngine',
  'ocrFileKey',
  'filename',
  'chunkIndex',
  'chunkCount',
  'pageStart',
  'pageEnd',
  'rawTextLength',
  'rawResultHash',
  'outputStorage',
] as const;

const steelNativePaddleOcrLegacySuccessOutputKeys =
  steelNativePaddleOcrHistoricalSuccessOutputKeys.filter((key) => key !== 'paddleocr');

const steelNativePaddleOcrFailureOutputKeys = [
  'status',
  'paddleocr',
  'ocrEngine',
  'ocrFileKey',
  'filename',
  'chunkIndex',
  'chunkCount',
  'pageStart',
  'pageEnd',
  'dataSizeBytes',
  'attemptsUsed',
  'error',
  'errorMessage',
] as const;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  return actualKeys.join(',') === [...keys].sort().join(',');
}

function hasExactPaddleOcrFailureKeys(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, steelNativePaddleOcrFailureOutputKeys) ||
    hasExactKeys(value, [...steelNativePaddleOcrFailureOutputKeys, 'errorCode'])
  );
}

function isPaddleOcrChunkBounds(value: Record<string, unknown>): boolean {
  return (
    isSafeInteger(value.chunkIndex) &&
    isSafeInteger(value.chunkCount) &&
    isSafeInteger(value.pageStart) &&
    isSafeInteger(value.pageEnd) &&
    value.chunkIndex >= 0 &&
    value.chunkCount >= 1 &&
    value.pageStart >= 1 &&
    value.pageEnd >= value.pageStart
  );
}

function canonicalizePreflightOutput(value: string, allowLegacyError = false): string | undefined {
  if (Buffer.byteLength(value, 'utf8') > steelNativePreflightToolCallOutputMaxBytes) {
    return undefined;
  }
  if (value.startsWith('Error:')) {
    if (!allowLegacyError) {
      return undefined;
    }
    const errorOutput = sanitizeErrorMessage(value);
    return errorOutput && errorOutput.length <= steelNativeErrorMessageMaxLength
      ? errorOutput
      : undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.ocrEngine !== 'string' ||
      parsed.ocrEngine !== 'paddleocr_vl'
    ) {
      return undefined;
    }

    const isCompactSuccess = hasExactKeys(parsed, steelNativePaddleOcrCompactSuccessOutputKeys);
    const isHistoricalSuccess = hasExactKeys(
      parsed,
      steelNativePaddleOcrHistoricalSuccessOutputKeys,
    );
    const isLegacySuccess = hasExactKeys(parsed, steelNativePaddleOcrLegacySuccessOutputKeys);
    if (
      ((parsed.status === 'ok' && parsed.paddleocr === 'ok' && isCompactSuccess) ||
        (parsed.status === 'completed' &&
          (parsed.paddleocr === 'ok' || parsed.paddleocr === undefined) &&
          (isHistoricalSuccess || isLegacySuccess))) &&
      typeof parsed.ocrFileKey === 'string' &&
      typeof parsed.filename === 'string' &&
      isPaddleOcrChunkBounds(parsed) &&
      ((isCompactSuccess && isSafeInteger(parsed.dataSizeBytes) && parsed.dataSizeBytes >= 0) ||
        (!isCompactSuccess &&
          isSafeInteger(parsed.rawTextLength) &&
          parsed.rawTextLength >= 0 &&
          typeof parsed.rawResultHash === 'string' &&
          parsed.outputStorage === 'steel_working_order_memory:paddleocr_preflight'))
    ) {
      return JSON.stringify({
        status: 'ok',
        paddleocr: 'ok',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: parsed.ocrFileKey,
        filename: parsed.filename,
        chunkIndex: parsed.chunkIndex,
        chunkCount: parsed.chunkCount,
        pageStart: parsed.pageStart,
        pageEnd: parsed.pageEnd,
        dataSizeBytes: isCompactSuccess ? parsed.dataSizeBytes : parsed.rawTextLength,
      });
    }

    const isCompactFailure = hasExactPaddleOcrFailureKeys(parsed);
    const isHistoricalFailure =
      parsed.status === 'failed' &&
      parsed.paddleocr === 'fail' &&
      (hasExactKeys(
        parsed,
        steelNativePaddleOcrFailureOutputKeys.filter(
          (key) => !['dataSizeBytes', 'error'].includes(key),
        ),
      ) ||
        hasExactKeys(parsed, [
          ...steelNativePaddleOcrFailureOutputKeys.filter(
            (key) => !['dataSizeBytes', 'error'].includes(key),
          ),
          'diagnosticCode',
        ]));
    if (
      (parsed.status !== 'fail' && !isHistoricalFailure) ||
      parsed.paddleocr !== 'fail' ||
      (!isCompactFailure && !isHistoricalFailure) ||
      typeof parsed.ocrFileKey !== 'string' ||
      typeof parsed.filename !== 'string' ||
      !isPaddleOcrChunkBounds(parsed) ||
      !isSafeInteger(parsed.attemptsUsed) ||
      parsed.attemptsUsed < 1 ||
      (!isPaddleOcrDiagnosticCode(parsed.errorCode) && parsed.errorCode !== undefined) ||
      (!isPaddleOcrDiagnosticCode(parsed.diagnosticCode) && parsed.diagnosticCode !== undefined) ||
      (isCompactFailure &&
        (!isSafeInteger(parsed.dataSizeBytes) ||
          parsed.dataSizeBytes < 0 ||
          typeof parsed.error !== 'string')) ||
      typeof parsed.errorMessage !== 'string'
    ) {
      return undefined;
    }

    const errorMessage = sanitizeErrorMessage(parsed.errorMessage);
    if (!errorMessage) {
      return undefined;
    }

    return JSON.stringify({
      status: 'fail',
      paddleocr: 'fail',
      ocrEngine: 'paddleocr_vl',
      ocrFileKey: parsed.ocrFileKey,
      filename: parsed.filename,
      chunkIndex: parsed.chunkIndex,
      chunkCount: parsed.chunkCount,
      pageStart: parsed.pageStart,
      pageEnd: parsed.pageEnd,
      dataSizeBytes: isCompactFailure ? parsed.dataSizeBytes : Buffer.byteLength(value, 'utf8'),
      attemptsUsed: parsed.attemptsUsed,
      ...(parsed.errorCode !== undefined || parsed.diagnosticCode !== undefined
        ? { errorCode: parsed.errorCode ?? parsed.diagnosticCode }
        : {}),
      error:
        sanitizeErrorMessage(isCompactFailure ? parsed.error : parsed.errorMessage) ?? errorMessage,
      errorMessage,
    });
  } catch {
    return undefined;
  }
}

function isSafePreflightOutput(value: string, allowLegacyError = false): boolean {
  return canonicalizePreflightOutput(value, allowLegacyError) !== undefined;
}

function isPaddleOcrToolName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === 'paddleocr_vl' || /^paddleocr_vl(?:---|_mcp_)[A-Za-z0-9_-]+$/u.test(value))
  );
}

function isSteelNativePreflightToolCall(
  value: unknown,
  allowLegacyError = false,
): value is SteelNativePreflightToolCall {
  return (
    isRecord(value) &&
    value.type === 'tool_call' &&
    isPaddleOcrToolName(value.name) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    Buffer.byteLength(value.id, 'utf8') <= steelNativePreflightToolCallIdMaxBytes &&
    isPreflightToolCallArgs(value.args) &&
    (value.progress === 0 || value.progress === 1) &&
    (value.output === undefined ||
      (typeof value.output === 'string' && isSafePreflightOutput(value.output, allowLegacyError)))
  );
}

function canonicalizeSteelNativeEvent(value: unknown): SteelNativeStreamEvent | undefined {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !isSteelNativeEventSource(value.source) ||
    !hasValidBaseEventFields(value)
  ) {
    return undefined;
  }

  const event: Record<string, unknown> = {};
  copyBaseEventFields(value, event);

  if (value.type === 'parse_status') {
    if (
      typeof value.message !== 'string' ||
      !['saved', 'partial', 'skipped'].includes(value.parseStatus as string)
    ) {
      return undefined;
    }
    event.type = 'parse_status';
    event.message = value.message;
    event.parseStatus = value.parseStatus;

    if (value.errorMessage !== undefined) {
      if (typeof value.errorMessage !== 'string') {
        return undefined;
      }
      const errorMessage = sanitizeErrorMessage(value.errorMessage);
      if (errorMessage) {
        event.errorMessage = errorMessage;
      }
    }
    if (value.failedKeys !== undefined) {
      if (!isStringArray(value.failedKeys)) {
        return undefined;
      }
      event.failedKeys = [...value.failedKeys];
    }
    if (value.missingPageRangesByFileKey !== undefined) {
      const ranges = canonicalizeMissingPageRanges(value.missingPageRangesByFileKey);
      if (!ranges) {
        return undefined;
      }
      event.missingPageRangesByFileKey = ranges;
    }
    for (const field of [
      'savedCounts',
      'savedTableCounts',
      'totalSavedCounts',
      'totalTableCounts',
    ]) {
      if (value[field] !== undefined) {
        const counts = canonicalizeCountMap(value[field]);
        if (!counts) {
          return undefined;
        }
        event[field] = counts;
      }
    }
  } else if (value.type === 'memory_saved') {
    if (typeof value.message !== 'string') {
      return undefined;
    }
    const savedCounts = canonicalizeCountMap(value.savedCounts);
    if (!savedCounts) {
      return undefined;
    }
    event.type = 'memory_saved';
    event.message = value.message;
    event.savedCounts = savedCounts;
    for (const field of ['savedTableCounts', 'totalSavedCounts', 'totalTableCounts']) {
      if (value[field] !== undefined) {
        const counts = canonicalizeCountMap(value[field]);
        if (!counts) {
          return undefined;
        }
        event[field] = counts;
      }
    }
  } else if (value.type === 'delegate_ocr_status') {
    if (
      value.source !== 'delegate_ocr_preflight' ||
      !isSafeInteger(value.delegateOcrIndex) ||
      value.delegateOcrIndex < 1 ||
      !['resume', 'paddleocr', 'organizer', 'agent', 'reconciliation', 'saving', 'summary', 'response'].includes(
        value.stage as string,
      ) ||
      !['started', 'progress', 'retrying', 'succeeded', 'failed', 'replaced'].includes(
        value.status as string,
      ) ||
      typeof value.message !== 'string'
    ) {
      return undefined;
    }
    event.type = 'delegate_ocr_status';
    event.source = 'delegate_ocr_preflight';
    event.delegateOcrIndex = value.delegateOcrIndex;
    event.stage = value.stage;
    event.status = value.status;
    event.message = value.message;
    if (value.errorMessage !== undefined) {
      if (typeof value.errorMessage !== 'string') {
        return undefined;
      }
      const errorMessage = sanitizeErrorMessage(value.errorMessage);
      if (errorMessage) {
        event.errorMessage = errorMessage;
      }
    }
    if (value.chunkIndex !== undefined) {
      if (!isSafeInteger(value.chunkIndex) || value.chunkIndex < 0) {
        return undefined;
      }
      event.chunkIndex = value.chunkIndex;
    }
    if (value.chunkCount !== undefined) {
      if (!isSafeInteger(value.chunkCount) || value.chunkCount < 1) {
        return undefined;
      }
      event.chunkCount = value.chunkCount;
    }
    // claim/generation/attempt tokens intentionally do not cross persistence boundaries.
  } else if (value.type === 'quote_audit') {
    if (value.stage === 'stage_2' && value.status === 'started') {
      if (value.source !== 'quote_runtime' || value.message !== 'Stage 2 started') {
        return undefined;
      }
      event.type = 'quote_audit';
      event.stage = 'stage_2';
      event.status = 'started';
      event.message = 'Stage 2 started';
    } else if (
      value.source === 'quote_runtime' &&
      (value.stage === 'stage_1' || value.stage === 'stage_2') &&
      value.status === 'executed' &&
      value.message === 'Code Interpreter executed' &&
      value.toolName === 'code_interpreter'
    ) {
      event.type = 'quote_audit';
      event.stage = value.stage;
      event.status = 'executed';
      event.message = 'Code Interpreter executed';
      event.toolName = 'code_interpreter';
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }

  return isSteelNativeEventData(event) ? event : undefined;
}

function canonicalizeSteelNativePreflightToolCall(
  value: unknown,
  allowLegacyError = false,
): SteelNativePreflightToolCall | undefined {
  if (
    !isRecord(value) ||
    value.type !== 'tool_call' ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    Buffer.byteLength(value.id, 'utf8') > steelNativePreflightToolCallIdMaxBytes ||
    !isPaddleOcrToolName(value.name) ||
    !isPreflightToolCallArgs(value.args) ||
    (value.progress !== 0 && value.progress !== 1)
  ) {
    return undefined;
  }

  let output: string | undefined;
  if (value.output !== undefined) {
    if (typeof value.output !== 'string') {
      return undefined;
    }
    output = canonicalizePreflightOutput(value.output, allowLegacyError);
    if (output === undefined) {
      return undefined;
    }
  }

  const card: Record<string, unknown> = {
    type: 'tool_call',
    id: value.id,
    name: value.name,
    args: {
      ...(value.args.input_data !== undefined ? { input_data: value.args.input_data } : {}),
      output_mode: value.args.output_mode,
      return_images: value.args.return_images,
      use_doc_orientation_classify: value.args.use_doc_orientation_classify,
      use_doc_unwarping: value.args.use_doc_unwarping,
      use_layout_detection: value.args.use_layout_detection,
    },
    progress: value.progress,
    ...(output !== undefined ? { output } : {}),
  };

  return isSteelNativePreflightToolCall(card, allowLegacyError) ? card : undefined;
}

function canonicalizeHistoryEntries(history: SteelNativeHistory):
  | {
      activityEvents: SteelNativeStreamEvent[];
      preflightToolCalls: SteelNativePreflightToolCall[];
    }
  | undefined {
  const activityEvents: SteelNativeStreamEvent[] = [];
  for (const event of history.activityEvents) {
    const canonicalEvent = canonicalizeSteelNativeEvent(event);
    if (!canonicalEvent) {
      return undefined;
    }
    activityEvents.push(canonicalEvent);
  }
  const preflightToolCalls: SteelNativePreflightToolCall[] = [];
  for (const card of history.preflightToolCalls) {
    const canonicalCard = canonicalizeSteelNativePreflightToolCall(card, true);
    if (!canonicalCard) {
      return undefined;
    }
    preflightToolCalls.push(canonicalCard);
  }
  return {
    activityEvents,
    preflightToolCalls,
  };
}

function replaceHistoryEntries(
  history: SteelNativeHistory,
  canonical: {
    activityEvents: SteelNativeStreamEvent[];
    preflightToolCalls: SteelNativePreflightToolCall[];
  },
): void {
  history.activityEvents.splice(0, history.activityEvents.length, ...canonical.activityEvents);
  history.preflightToolCalls.splice(
    0,
    history.preflightToolCalls.length,
    ...canonical.preflightToolCalls,
  );
}

function stripHistoryUnknownFields(history: SteelNativeHistory): void {
  for (const key of Object.keys(history)) {
    if (key !== 'activityEvents' && key !== 'preflightToolCalls') {
      delete (history as Record<string, unknown>)[key];
    }
  }
}

function getHistory(target: SteelNativeHistoryTarget): SteelNativeHistory {
  if (Array.isArray(target)) {
    return { activityEvents: target, preflightToolCalls: [] };
  }
  return target;
}

function trimSteelNativeHistory(history: SteelNativeHistory): boolean {
  while (history.activityEvents.length > steelNativeActivityEventMaxCount) {
    history.activityEvents.shift();
  }
  while (history.preflightToolCalls.length > steelNativePreflightToolCallMaxCount) {
    history.preflightToolCalls.shift();
  }
  let activityBytes = history.activityEvents.reduce(
    (total, event) => total + Buffer.byteLength(JSON.stringify(event), 'utf8'),
    0,
  );
  while (activityBytes > steelNativeActivityEventsMaxBytes) {
    const removed = history.activityEvents.shift();
    if (!removed) {
      return false;
    }
    activityBytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8');
  }

  let serialized = JSON.stringify(history);
  while (Buffer.byteLength(serialized, 'utf8') > steelNativeHistoryMaxBytes) {
    if (history.activityEvents.length > 0) {
      history.activityEvents.shift();
    } else if (history.preflightToolCalls.length > 0) {
      history.preflightToolCalls.shift();
    } else {
      return false;
    }
    serialized = JSON.stringify(history);
  }
  return true;
}

/**
 * Append one validated native Steel event to a bounded activity sink.
 *
 * Sink identity stays stable because entries are evicted and appended in place.
 * All failures are fail-closed and non-throwing so event persistence cannot
 * interrupt the live SSE path.
 */
export function appendSteelNativeActivityEvent(
  sink: SteelNativeHistoryTarget,
  value: unknown,
): boolean {
  try {
    if (!Array.isArray(sink) && !isRecord(sink)) {
      return false;
    }

    if (typeof JSON.stringify(value) !== 'string') {
      return false;
    }

    const canonicalEvent = canonicalizeSteelNativeEvent(value);
    if (!canonicalEvent) {
      return false;
    }

    const serialized = JSON.stringify(canonicalEvent);
    if (typeof serialized !== 'string') {
      return false;
    }
    const eventBytes = Buffer.byteLength(serialized, 'utf8');
    if (eventBytes > steelNativeActivityEventMaxBytes) {
      return false;
    }

    const cloned = JSON.parse(serialized) as SteelNativeStreamEvent;

    const history = getHistory(sink);
    const canonicalHistory = canonicalizeHistoryEntries(history);
    if (!canonicalHistory) {
      return false;
    }
    replaceHistoryEntries(history, canonicalHistory);
    stripHistoryUnknownFields(history);
    const entryBytes = history.activityEvents.map((entry) => {
      const entryJson = JSON.stringify(entry);
      if (typeof entryJson !== 'string') {
        throw new Error('invalid existing Steel activity event');
      }
      return Buffer.byteLength(entryJson, 'utf8');
    });
    let totalBytes = entryBytes.reduce((total, bytes) => total + bytes, 0);

    while (
      history.activityEvents.length >= steelNativeActivityEventMaxCount ||
      totalBytes + eventBytes > steelNativeActivityEventsMaxBytes
    ) {
      const removedBytes = entryBytes.shift();
      if (removedBytes === undefined) {
        break;
      }
      history.activityEvents.shift();
      totalBytes -= removedBytes;
    }

    if (
      history.activityEvents.length >= steelNativeActivityEventMaxCount ||
      totalBytes + eventBytes > steelNativeActivityEventsMaxBytes
    ) {
      return false;
    }

    history.activityEvents.push(cloned);
    if (!trimSteelNativeHistory(history)) {
      history.activityEvents.pop();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function upsertSteelNativePreflightToolCall(
  history: SteelNativeHistory,
  value: unknown,
): boolean {
  try {
    if (
      !isRecord(history) ||
      !Array.isArray(history.activityEvents) ||
      !Array.isArray(history.preflightToolCalls)
    ) {
      return false;
    }
    const canonicalHistory = canonicalizeHistoryEntries(history);
    if (!canonicalHistory) {
      return false;
    }
    replaceHistoryEntries(history, canonicalHistory);
    stripHistoryUnknownFields(history);
    const canonicalCard = canonicalizeSteelNativePreflightToolCall(value);
    if (!canonicalCard) {
      return false;
    }
    const serialized = JSON.stringify(canonicalCard);
    if (typeof serialized !== 'string') {
      return false;
    }
    const cloned = JSON.parse(serialized) as SteelNativePreflightToolCall;
    const previousActivityEvents = history.activityEvents.slice();
    const previousPreflightToolCalls = history.preflightToolCalls.slice();
    const existingIndex = history.preflightToolCalls.findIndex((entry) => entry.id === cloned.id);
    if (existingIndex >= 0) {
      history.preflightToolCalls[existingIndex] = cloned;
    } else {
      if (history.preflightToolCalls.length >= steelNativePreflightToolCallMaxCount) {
        history.preflightToolCalls.shift();
      }
      history.preflightToolCalls.push(cloned);
    }
    if (
      !trimSteelNativeHistory(history) ||
      !history.preflightToolCalls.some((entry) => entry.id === cloned.id)
    ) {
      history.activityEvents.splice(0, history.activityEvents.length, ...previousActivityEvents);
      history.preflightToolCalls.splice(
        0,
        history.preflightToolCalls.length,
        ...previousPreflightToolCalls,
      );
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const appendSteelNativePreflightToolCall: typeof upsertSteelNativePreflightToolCall =
  upsertSteelNativePreflightToolCall;

export interface BuildSteelNativeEventEnvelopesInput extends SteelNativeEventBase {
  capture: CaptureSteelNativeToolResultResult;
}

export interface SteelPaddleOcrPreflightActivityResult {
  status: 'completed' | 'partial' | 'skipped';
  completedKeys?: readonly string[];
  attemptedKeys?: readonly string[];
  failedKeys?: readonly string[];
  paddleOcrSavedCount?: number;
  errorMessage?: string;
  skippedReason?: string;
  totalSavedCounts?: SteelNativeSavedCounts;
  totalTableCounts?: SteelNativeTableCounts;
}

export interface BuildSteelPaddleOcrPreflightEventEnvelopesInput
  extends Omit<SteelNativeEventBase, 'source'> {
  preflight: SteelPaddleOcrPreflightActivityResult;
}

export type SteelOcrPreprocessingProgress =
  | OcrPreprocessingPipelineProgress
  | {
      stage: 'failed';
      errorMessage: string;
      missingPageRangesByFileKey?: SteelOcrMissingPageRangesByFileKey;
    };

export interface BuildSteelOcrPreprocessingEventEnvelopesInput
  extends Omit<SteelNativeEventBase, 'source'> {
  ocrFileKey: string;
  progress: SteelOcrPreprocessingProgress;
}

function hasSavedCounts(savedCounts: unknown): savedCounts is SteelNativeSavedCounts {
  if (!isCountMap(savedCounts)) {
    return false;
  }

  return Object.values(savedCounts).some((count) => Number.isFinite(count) && count > 0);
}

function captureCountMetadata(
  result: Extract<CaptureSteelNativeToolResultResult, { status: 'captured' }>['result'],
) {
  return {
    ...('savedTableCounts' in result && hasSavedCounts(result.savedTableCounts)
      ? { savedTableCounts: result.savedTableCounts }
      : {}),
    ...('totalSavedCounts' in result && hasSavedCounts(result.totalSavedCounts)
      ? { totalSavedCounts: result.totalSavedCounts }
      : {}),
    ...('totalTableCounts' in result && hasSavedCounts(result.totalTableCounts)
      ? { totalTableCounts: result.totalTableCounts }
      : {}),
  };
}

function preflightCountMetadata(preflight: SteelPaddleOcrPreflightActivityResult) {
  return {
    ...('totalSavedCounts' in preflight && hasSavedCounts(preflight.totalSavedCounts)
      ? { totalSavedCounts: preflight.totalSavedCounts }
      : {}),
    ...('totalTableCounts' in preflight && hasSavedCounts(preflight.totalTableCounts)
      ? { totalTableCounts: preflight.totalTableCounts }
      : {}),
  };
}

function baseEvent(input: SteelNativeEventBase): SteelNativeEventBase {
  return {
    source: input.source,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.providerToolCallId ? { providerToolCallId: input.providerToolCallId } : {}),
  };
}

export type BuildSteelQuoteAuditEventInput = Omit<SteelNativeEventBase, 'source'>;

export interface BuildSteelDelegateOcrStatusEventInput extends Omit<SteelNativeEventBase, 'source'> {
  delegateOcrIndex: number;
  stage: SteelNativeDelegateOcrStage;
  status: SteelNativeDelegateOcrStatus;
  message: string;
  errorMessage?: string;
  chunkIndex?: number;
  chunkCount?: number;
  claimToken?: string;
  generationId?: string;
  attemptToken?: string;
}

/** Build one delegate OCR lifecycle event. Correlation tokens are for live gating only. */
export function buildSteelDelegateOcrStatusEvent({
  delegateOcrIndex,
  stage,
  status,
  message,
  errorMessage,
  chunkIndex,
  chunkCount,
  claimToken,
  generationId,
  attemptToken,
  ...input
}: BuildSteelDelegateOcrStatusEventInput): SteelNativeDelegateOcrStatusEvent {
  return {
    type: 'delegate_ocr_status',
    source: 'delegate_ocr_preflight',
    delegateOcrIndex,
    stage,
    status,
    message,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(chunkIndex !== undefined ? { chunkIndex } : {}),
    ...(chunkCount !== undefined ? { chunkCount } : {}),
    ...(claimToken !== undefined ? { claimToken } : {}),
    ...(generationId !== undefined ? { generationId } : {}),
    ...(attemptToken !== undefined ? { attemptToken } : {}),
    ...baseEvent({ ...input, source: 'delegate_ocr_preflight' }),
  };
}

export function buildSteelDelegateOcrStatusEventEnvelope(
  input: BuildSteelDelegateOcrStatusEventInput,
): SteelNativeEventEnvelope {
  return {
    event: steelNativeStreamEventName,
    data: buildSteelDelegateOcrStatusEvent(input),
  };
}

export function buildSteelDelegateOcrStatusEventEnvelopes(
  input: BuildSteelDelegateOcrStatusEventInput,
): SteelNativeEventEnvelope[] {
  return [buildSteelDelegateOcrStatusEventEnvelope(input)];
}

export const buildSteelDelegateOcrEvent: typeof buildSteelDelegateOcrStatusEvent =
  buildSteelDelegateOcrStatusEvent;
export const buildSteelDelegateOcrEventEnvelope: typeof buildSteelDelegateOcrStatusEventEnvelope =
  buildSteelDelegateOcrStatusEventEnvelope;

export function buildSteelQuoteAuditEvent(
  input: BuildSteelQuoteAuditEventInput = {},
): SteelNativeQuoteAuditStartedEvent {
  return {
    type: 'quote_audit',
    message: 'Stage 2 started',
    stage: 'stage_2',
    status: 'started',
    ...baseEvent({ ...input, source: 'quote_runtime' }),
  };
}

export type BuildSteelCodeInterpreterAuditEventInput = Omit<
  SteelNativeEventBase,
  'source' | 'toolName'
> & {
  stage: 'stage_1' | 'stage_2';
};

export function buildSteelCodeInterpreterAuditEvent({
  stage,
  ...input
}: BuildSteelCodeInterpreterAuditEventInput): SteelNativeCodeInterpreterAuditEvent {
  return {
    type: 'quote_audit',
    message: 'Code Interpreter executed',
    stage,
    status: 'executed',
    ...baseEvent({ ...input, source: 'quote_runtime' }),
    toolName: 'code_interpreter',
  };
}

export function buildSteelNativeEventEnvelopes({
  capture,
  ...input
}: BuildSteelNativeEventEnvelopesInput): SteelNativeEventEnvelope[] {
  if (capture.status !== 'captured') {
    return [];
  }

  if (!hasSavedCounts(capture.result.savedCounts)) {
    return [];
  }

  return [
    {
      event: steelNativeStreamEventName,
      data: {
        type: 'memory_saved',
        message: 'Saved Working Order Memory',
        savedCounts: capture.result.savedCounts,
        ...captureCountMetadata(capture.result),
        ...baseEvent(input),
      },
    },
  ];
}

function getPaddleOcrSavedCount(preflight: SteelPaddleOcrPreflightActivityResult): number {
  if (typeof preflight.paddleOcrSavedCount === 'number') {
    return preflight.paddleOcrSavedCount;
  }

  const failedKeys = new Set(preflight.failedKeys ?? []);
  return (preflight.attemptedKeys ?? []).filter((key) => !failedKeys.has(key)).length;
}

function getPaddleOcrParseStatus(
  preflight: SteelPaddleOcrPreflightActivityResult,
  savedCount: number,
): SteelNativeParseStatusEvent['parseStatus'] | undefined {
  if (preflight.status === 'completed') {
    if (savedCount === 0 && (preflight.attemptedKeys?.length ?? 0) > 0) {
      return 'saved';
    }
    return undefined;
  }

  if (preflight.status === 'partial') {
    return 'partial';
  }

  if (preflight.skippedReason === 'all_files_already_have_paddleocr') {
    return 'skipped';
  }

  return undefined;
}

export function buildSteelPaddleOcrPreflightEventEnvelopes({
  preflight,
  ...input
}: BuildSteelPaddleOcrPreflightEventEnvelopesInput): SteelNativeEventEnvelope[] {
  const savedCount = getPaddleOcrSavedCount(preflight);
  const parseStatus = getPaddleOcrParseStatus(preflight, savedCount);
  const eventBase = baseEvent({ ...input, source: 'paddleocr_preflight' });
  const savedCounts = savedCount > 0 ? { paddleocr_preflight: savedCount } : undefined;
  const countMetadata = preflightCountMetadata(preflight);
  const events: SteelNativeEventEnvelope[] = [];

  if (parseStatus) {
    events.push({
      event: steelNativeStreamEventName,
      data: {
        type: 'parse_status',
        message:
          parseStatus === 'saved' && preflight.status === 'completed'
            ? 'Reused PaddleOCR preflight'
            : `PaddleOCR preflight ${parseStatus}`,
        parseStatus,
        ...(savedCounts ? { savedCounts } : {}),
        ...(preflight.errorMessage
          ? {
              errorMessage: preflight.errorMessage,
              failedKeys: preflight.failedKeys ?? [],
            }
          : {}),
        ...countMetadata,
        ...eventBase,
      },
    });
  }

  if (savedCounts) {
    events.push({
      event: steelNativeStreamEventName,
      data: {
        type: 'memory_saved',
        message: 'Saved PaddleOCR preflight',
        savedCounts,
        ...countMetadata,
        ...eventBase,
      },
    });
  }

  return events;
}

export function buildSteelOcrPreprocessingEventEnvelopes({
  ocrFileKey,
  progress,
  ...input
}: BuildSteelOcrPreprocessingEventEnvelopesInput): SteelNativeEventEnvelope[] {
  const eventBase = baseEvent({ ...input, source: 'ocr_preprocessing' });

  switch (progress.stage) {
    case 'pdf_chunks_ready': {
      const message =
        progress.source === 'fetched'
          ? `Fetched pdf chunks (${progress.pageCount} pages / ${progress.chunkCount} chunks) (${ocrFileKey})`
          : `Uploaded pdf to S3 (${progress.pageCount} pages / ${progress.chunkCount} chunks) (${ocrFileKey})`;
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    }
    case 'paddleocr_chunk_started':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Running paddleocr_vl in PaddleOCR (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'paddleocr_chunk_loaded':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Loaded saved PaddleOCR (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'paddleocr_chunk_saved':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Ran paddleocr_vl in PaddleOCR (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'memory_saved',
            message: `Saved PaddleOCR preflight (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            savedCounts: { paddleocr_preflight: 1 },
            ...eventBase,
          },
        },
      ];
    case 'organizer_chunk_started':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Running OCR markdown process (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'organizer_chunk_loaded':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Loaded saved OCR markdown (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'organizer_chunk_saved':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Ran OCR markdown process (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'memory_saved',
            message: `Saved OCR markdown (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${ocrFileKey})`,
            savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
            ...eventBase,
          },
        },
      ];
    case 'merged_markdowns_read':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Read OCR markdowns (${ocrFileKey}: ${progress.chunkCount} chunks)`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'processing_with_merged_markdown':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `Processing pdf with OCR markdowns (${ocrFileKey})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
      ];
    case 'failed':
      return [
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'parse_status',
            message: `ocr preprocessing failed (${ocrFileKey})`,
            parseStatus: 'partial',
            errorMessage: progress.errorMessage,
            failedKeys: [ocrFileKey],
            ...(progress.missingPageRangesByFileKey
              ? { missingPageRangesByFileKey: progress.missingPageRangesByFileKey }
              : {}),
            ...eventBase,
          },
        },
      ];
    default:
      return [];
  }
}
