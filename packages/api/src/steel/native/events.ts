import type { SteelOcrMissingPageRangesByFileKey } from '../ocr/failures';
import type { CaptureSteelNativeToolResultResult } from './tool-result';

export const steelNativeStreamEventName = 'steel_event' as const;

export const steelNativeActivityEventMaxBytes: number = 16 * 1024;
export const steelNativeActivityEventMaxCount: number = 100;
export const steelNativeActivityEventsMaxBytes: number = 128 * 1024;
export const steelNativePreflightToolCallMaxBytes: number = 4 * 1024;
export const steelNativePreflightToolCallMaxCount: number = 100;
export const steelNativePreflightToolCallIdMaxBytes: number = 256;

export type SteelNativeEventSource =
  | 'ocr_preprocessing'
  | 'paddleocr_preflight'
  | 'tool_result'
  | 'quote_runtime';

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
  | SteelNativeQuoteAuditEvent;

export interface SteelNativeEventEnvelope {
  event: typeof steelNativeStreamEventName;
  data: SteelNativeStreamEvent;
}

export interface SteelNativePreflightToolCallArgs {
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

export function createSteelNativeHistory(): SteelNativeHistory {
  return { activityEvents: [], preflightToolCalls: [] };
}

export function ensureSteelNativeHistory(context: SteelNativeHistoryContext): SteelNativeHistory {
  const existingHistory = context.steelHistory;
  const hasCanonicalHistory = isSteelNativeHistory(existingHistory);
  const history = hasCanonicalHistory ? existingHistory : createSteelNativeHistory();

  if (!hasCanonicalHistory && Array.isArray(context.steelActivityEvents)) {
    history.activityEvents = context.steelActivityEvents;
  }

  context.steelHistory = history;
  context.steelActivityEvents = history.activityEvents;
  return history;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
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

function isMissingPageRangesByFileKey(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (ranges) => Array.isArray(ranges) && ranges.every((range) => isSafePageRange(range)),
    )
  );
}

function hasValidBaseEventFields(value: Record<string, unknown>): boolean {
  return [
    'conversationId',
    'requestId',
    'messageId',
    'toolName',
    'providerToolCallId',
  ].every((field) => value[field] === undefined || typeof value[field] === 'string');
}

function isSteelNativeEventData(value: unknown): value is SteelNativeStreamEvent {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    typeof value.source !== 'string' ||
    !hasValidBaseEventFields(value)
  ) {
    return false;
  }

  if (
    ![
      'ocr_preprocessing',
      'paddleocr_preflight',
      'tool_result',
      'quote_runtime',
    ].includes(value.source)
  ) {
    return false;
  }

  if (value.type === 'parse_status') {
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

  if (value.type === 'memory_saved') {
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
    return value.source === 'quote_runtime' && value.message === 'Stage 2 started';
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
  if (
    keys.join(',') !==
    [
      'output_mode',
      'return_images',
      'use_doc_orientation_classify',
      'use_doc_unwarping',
      'use_layout_detection',
    ]
      .sort()
      .join(',')
  ) {
    return false;
  }
  return (
    value.output_mode === 'detailed' &&
    typeof value.return_images === 'boolean' &&
    typeof value.use_doc_orientation_classify === 'boolean' &&
    typeof value.use_doc_unwarping === 'boolean' &&
    typeof value.use_layout_detection === 'boolean'
  );
}

function isSafePreflightOutput(value: string): boolean {
  if (value.startsWith('Error:')) {
    return value.length <= 512 && !/https?:\/\//iu.test(value);
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return false;
    }
    const keys = Object.keys(parsed).sort();
    const expected = [
      'chunkIndex',
      'chunkCount',
      'filename',
      'ocrEngine',
      'ocrFileKey',
      'outputStorage',
      'pageEnd',
      'pageStart',
      'rawResultHash',
      'rawTextLength',
      'status',
    ]
      .sort()
      .join(',');
    if (keys.join(',') !== expected) {
      return false;
    }
    return (
      parsed.status === 'completed' &&
      parsed.ocrEngine === 'paddleocr_vl' &&
      parsed.outputStorage === 'steel_working_order_memory:paddleocr_preflight' &&
      typeof parsed.ocrFileKey === 'string' &&
      typeof parsed.filename === 'string' &&
      typeof parsed.rawResultHash === 'string' &&
      Number.isSafeInteger(parsed.chunkIndex) &&
      Number.isSafeInteger(parsed.chunkCount) &&
      Number.isSafeInteger(parsed.pageStart) &&
      Number.isSafeInteger(parsed.pageEnd) &&
      Number.isSafeInteger(parsed.rawTextLength) &&
      parsed.chunkIndex >= 0 &&
      parsed.chunkCount >= 1 &&
      parsed.pageStart >= 1 &&
      parsed.pageEnd >= parsed.pageStart &&
      parsed.rawTextLength >= 0
    );
  } catch {
    return false;
  }
}

function isSteelNativePreflightToolCall(value: unknown): value is SteelNativePreflightToolCall {
  return (
    isRecord(value) &&
    value.type === 'tool_call' &&
    typeof value.name === 'string' &&
    (value.name === 'paddleocr_vl' ||
      /^paddleocr_vl(?:---|_mcp_)[A-Za-z0-9_-]+$/u.test(value.name)) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    Buffer.byteLength(value.id, 'utf8') <= steelNativePreflightToolCallIdMaxBytes &&
    isPreflightToolCallArgs(value.args) &&
    (value.progress === 0 || value.progress === 1) &&
    (value.output === undefined ||
      (typeof value.output === 'string' && isSafePreflightOutput(value.output)))
  );
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
  const serialized = () => JSON.stringify(history);
  let encoded = serialized();
  if (typeof encoded !== 'string') {
    return false;
  }

  while (Buffer.byteLength(encoded, 'utf8') > steelNativeActivityEventsMaxBytes) {
    if (history.activityEvents.length > 0) {
      history.activityEvents.shift();
    } else if (history.preflightToolCalls.length > 0) {
      history.preflightToolCalls.shift();
    } else {
      return false;
    }
    encoded = serialized();
    if (typeof encoded !== 'string') {
      return false;
    }
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
    if ((!Array.isArray(sink) && !isRecord(sink)) || !isSteelNativeEventData(value)) {
      return false;
    }

    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') {
      return false;
    }
    const eventBytes = Buffer.byteLength(serialized, 'utf8');
    if (eventBytes > steelNativeActivityEventMaxBytes) {
      return false;
    }

    const cloned = JSON.parse(serialized) as unknown;
    if (!isSteelNativeEventData(cloned)) {
      return false;
    }

    const history = getHistory(sink);
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
    if (!isSteelNativePreflightToolCall(value)) {
      return false;
    }
    const serialized = JSON.stringify(value);
    if (
      typeof serialized !== 'string' ||
      Buffer.byteLength(serialized, 'utf8') > steelNativePreflightToolCallMaxBytes
    ) {
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
    if (!trimSteelNativeHistory(history)) {
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
  | { stage: 'processing_with_merged_markdown'; chunkCount: number }
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

function hasSavedCounts(
  savedCounts?: SteelNativeSavedCounts,
): savedCounts is SteelNativeSavedCounts {
  if (!savedCounts) {
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
    toolName: 'code_interpreter',
    ...baseEvent({ ...input, source: 'quote_runtime' }),
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
    case 'pdf_chunks_ready':
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
