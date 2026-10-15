import {
  steelNativeStreamEventName,
  parseSteelNativeActivityEvent,
  parseSteelNativePreflightToolCall,
  steelNativePreflightToolCallMaxCount,
} from 'librechat-data-provider';
import type { SteelQuotationOcrSelection } from '@librechat/data-schemas';
import type {
  SteelQuotationOcrSource,
  SteelNativeTableCounts,
  SteelNativeSavedCounts,
  SteelNativeEventSource,
  SteelNativeActivityEvent,
  SteelNativeQuotationStatus,
  SteelNativeDelegateOcrStage,
  SteelNativeDelegateOcrStatus,
  SteelNativePreflightToolCall,
} from 'librechat-data-provider';
import type { SteelOcrMissingPageRangesByFileKey } from '../ocr/failures';
import type { OcrPreprocessingPipelineProgress } from '../ocr/preprocess';
import type { CaptureSteelNativeToolResultResult } from './tool-result';
import { quotationOcrSource } from '../quotation/input';
import { isRecord } from '../utils';

export {
  steelNativeStreamEventName,
  steelNativePreflightToolCallMaxCount,
  steelNativeErrorMessageMaxLength,
} from 'librechat-data-provider';
export type {
  SteelNativeEventSource,
  SteelNativeDelegateOcrStage,
  SteelNativeDelegateOcrStatus,
  SteelNativeQuotationStatus,
  SteelNativeSavedCounts,
  SteelNativeTableCounts,
  SteelNativePreflightToolCall,
} from 'librechat-data-provider';

export const steelNativeActivityEventMaxBytes: number = 16 * 1024;
export const steelNativeActivityEventMaxCount: number = 100;
export const steelNativeActivityEventsMaxBytes: number = 128 * 1024;
export const steelNativeHistoryMaxBytes: number = 12 * 1024 * 1024;

export interface SteelNativeEventBase {
  source: SteelNativeEventSource;
  conversationId?: string;
  requestId?: string;
  messageId?: string;
  toolName?: string;
  providerToolCallId?: string;
}

export type SteelNativeParseStatusEvent = Extract<
  SteelNativeActivityEvent,
  { type: 'parse_status' }
>;
export type SteelNativeMemorySavedEvent = Extract<
  SteelNativeActivityEvent,
  { type: 'memory_saved' }
>;
export type SteelNativeQuotationStatusEvent = Extract<
  SteelNativeActivityEvent,
  { type: 'quotation_status' }
>;
export type SteelNativeQuoteAuditEvent = Extract<SteelNativeActivityEvent, { type: 'quote_audit' }>;
export type SteelNativeCodeInterpreterAuditEvent = SteelNativeQuoteAuditEvent;
/** Live delegate events carry workflow correlation tokens that never reach persistence. */
export type SteelNativeDelegateOcrStatusEvent = Extract<
  SteelNativeActivityEvent,
  { type: 'delegate_ocr_status' }
> & {
  claimToken?: string;
  generationId?: string;
  attemptToken?: string;
};

export type SteelNativeStreamEvent =
  | SteelNativeParseStatusEvent
  | SteelNativeMemorySavedEvent
  | SteelNativeDelegateOcrStatusEvent
  | SteelNativeQuotationStatusEvent
  | SteelNativeQuoteAuditEvent;

export interface SteelNativeEventEnvelope {
  event: typeof steelNativeStreamEventName;
  data: SteelNativeStreamEvent;
}

export interface SteelNativeHistory {
  activityEvents: SteelNativeStreamEvent[];
  preflightToolCalls: SteelNativePreflightToolCall[];
}

interface SteelNativeHistoryContext {
  steelHistory?: SteelNativeHistory;
}

export type SteelNativeHistoryTarget = SteelNativeHistory | SteelNativeStreamEvent[];

function isSteelNativeHistory(value: unknown): value is SteelNativeHistory {
  return (
    isRecord(value) &&
    Array.isArray(value.activityEvents) &&
    Array.isArray(value.preflightToolCalls)
  );
}

function isCountMap(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

/** Canonical, JSON-cloned event plus its serialized size, or undefined when invalid. */
function cloneCanonicalEvent(
  value: unknown,
): { event: SteelNativeStreamEvent; bytes: number } | undefined {
  const event = parseSteelNativeActivityEvent(value);
  if (!event) {
    return undefined;
  }
  const serialized = JSON.stringify(event);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > steelNativeActivityEventMaxBytes) {
    return undefined;
  }
  return { event: JSON.parse(serialized) as SteelNativeStreamEvent, bytes };
}

function cloneCanonicalPreflightToolCall(value: unknown): SteelNativePreflightToolCall | undefined {
  const card = parseSteelNativePreflightToolCall(value);
  return card ? (JSON.parse(JSON.stringify(card)) as SteelNativePreflightToolCall) : undefined;
}

/**
 * Parse persisted Steel history through the shared event schema and the same
 * bounds used by the live collectors. The result is always a deep clone, so
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

  const activityEvents: SteelNativeStreamEvent[] = [];
  let activityBytes = 0;
  for (const value of parsed.activityEvents) {
    const canonical = cloneCanonicalEvent(value);
    if (!canonical) {
      return undefined;
    }
    activityEvents.push(canonical.event);
    activityBytes += canonical.bytes;
  }
  if (activityBytes > steelNativeActivityEventsMaxBytes) {
    return undefined;
  }
  const preflightToolCalls: SteelNativePreflightToolCall[] = [];
  for (const value of parsed.preflightToolCalls) {
    const card = cloneCanonicalPreflightToolCall(value);
    if (!card) {
      return undefined;
    }
    preflightToolCalls.push(card);
  }
  const history = { activityEvents, preflightToolCalls };
  if (Buffer.byteLength(JSON.stringify(history), 'utf8') > steelNativeHistoryMaxBytes) {
    return undefined;
  }
  return history;
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
          Reflect.deleteProperty(existingHistory, key);
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
      return existingHistory;
    }
  }

  const history = createSteelNativeHistory();
  context.steelHistory = history;
  return history;
}

function stripHistoryUnknownFields(history: SteelNativeHistory): void {
  for (const key of Object.keys(history)) {
    if (key !== 'activityEvents' && key !== 'preflightToolCalls') {
      Reflect.deleteProperty(history, key);
    }
  }
}

function getHistory(target: SteelNativeHistoryTarget): SteelNativeHistory {
  if (Array.isArray(target)) {
    return { activityEvents: target, preflightToolCalls: [] };
  }
  return target;
}

const entryByteCache = new WeakMap<object, number>();

/** History entries are replaced, never mutated, so their serialized size is cached by identity. */
function entryBytes(entry: object): number {
  let bytes = entryByteCache.get(entry);
  if (bytes === undefined) {
    bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
    entryByteCache.set(entry, bytes);
  }
  return bytes;
}

function listBytes(entries: readonly object[]): number {
  let bytes = entries.length > 0 ? entries.length + 1 : 2;
  for (const entry of entries) bytes += entryBytes(entry);
  return bytes;
}

const historyFrameBytes = '{"activityEvents":,"preflightToolCalls":}'.length;

function historyBytes(history: SteelNativeHistory): number {
  return historyFrameBytes + listBytes(history.activityEvents) + listBytes(history.preflightToolCalls);
}

function trimSteelNativeHistory(history: SteelNativeHistory): boolean {
  while (history.activityEvents.length > steelNativeActivityEventMaxCount) {
    history.activityEvents.shift();
  }
  while (history.preflightToolCalls.length > steelNativePreflightToolCallMaxCount) {
    history.preflightToolCalls.shift();
  }
  let activityBytes = history.activityEvents.reduce((total, event) => total + entryBytes(event), 0);
  while (activityBytes > steelNativeActivityEventsMaxBytes) {
    const removed = history.activityEvents.shift();
    if (!removed) {
      return false;
    }
    activityBytes -= entryBytes(removed);
  }

  let totalBytes = historyBytes(history);
  while (totalBytes > steelNativeHistoryMaxBytes) {
    const removed = history.activityEvents.shift() ?? history.preflightToolCalls.shift();
    if (!removed) {
      return false;
    }
    totalBytes = historyBytes(history);
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

    const canonical = cloneCanonicalEvent(value);
    if (!canonical) {
      return false;
    }
    const { event: cloned, bytes: eventBytes } = canonical;
    entryByteCache.set(cloned, eventBytes);

    const history = getHistory(sink);
    stripHistoryUnknownFields(history);
    let totalBytes = history.activityEvents.reduce((total, entry) => total + entryBytes(entry), 0);

    while (
      history.activityEvents.length >= steelNativeActivityEventMaxCount ||
      totalBytes + eventBytes > steelNativeActivityEventsMaxBytes
    ) {
      const removed = history.activityEvents.shift();
      if (!removed) {
        break;
      }
      totalBytes -= entryBytes(removed);
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
    stripHistoryUnknownFields(history);
    const cloned = cloneCanonicalPreflightToolCall(value);
    if (!cloned) {
      return false;
    }
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
  filename?: string;
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
  const eventBase = {
    source: 'delegate_ocr_preflight',
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.providerToolCallId ? { providerToolCallId: input.providerToolCallId } : {}),
  } as const;
  return {
    ...eventBase,
    type: 'delegate_ocr_status',
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

export interface BuildSteelQuotationStatusEventInput {
  conversationId: string;
  requestId?: string;
  messageId?: string;
  index: number;
  runId?: string;
  stage: string;
  status: SteelNativeQuotationStatus;
  completedChunks: number;
  totalChunks: number;
  message?: string;
  chunkIndex?: number;
  attempt?: string;
  repairAttempt?: number;
  maxRepairAttempts?: number;
  ocrSource?: SteelQuotationOcrSource;
}

export function buildSteelQuotationStatusEvent({
  conversationId,
  requestId,
  messageId,
  index,
  runId,
  stage,
  status,
  completedChunks,
  totalChunks,
  message,
  chunkIndex,
  attempt,
  repairAttempt,
  maxRepairAttempts,
  ocrSource,
}: BuildSteelQuotationStatusEventInput): SteelNativeQuotationStatusEvent {
  return {
    type: 'quotation_status',
    source: 'quotation_preflight',
    conversationId,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    index,
    ...(runId !== undefined ? { runId } : {}),
    stage,
    status,
    completedChunks,
    totalChunks,
    ...(message !== undefined ? { message } : {}),
    ...(chunkIndex !== undefined ? { chunkIndex } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(repairAttempt !== undefined ? { repairAttempt } : {}),
    ...(maxRepairAttempts !== undefined ? { maxRepairAttempts } : {}),
    ...(ocrSource !== undefined ? { ocrSource } : {}),
  };
}

export function buildSteelQuotationStatusEventEnvelope(
  input: BuildSteelQuotationStatusEventInput & { ocrSelection?: SteelQuotationOcrSelection },
): SteelNativeEventEnvelope {
  return {
    event: steelNativeStreamEventName,
    data: buildSteelQuotationStatusEvent({ ...input,
      ocrSource: input.ocrSelection ? quotationOcrSource(input.ocrSelection) : input.ocrSource,
    }),
  };
}

export type BuildSteelCodeInterpreterAuditEventInput = Omit<
  SteelNativeEventBase,
  'source' | 'toolName'
> & {
  stage: 'stage_1';
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
    source: 'quote_runtime',
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
              failedKeys: [...(preflight.failedKeys ?? [])],
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
  filename,
  progress,
  ...input
}: BuildSteelOcrPreprocessingEventEnvelopesInput): SteelNativeEventEnvelope[] {
  const eventBase = baseEvent({ ...input, source: 'ocr_preprocessing' });
  const displayName = filename?.trim() || ocrFileKey;

  switch (progress.stage) {
    case 'pdf_chunks_ready': {
      const message =
        progress.source === 'fetched'
          ? `Fetched pdf chunks (${progress.pageCount} pages / ${progress.chunkCount} chunks) (${displayName})`
          : `Uploaded pdf to S3 (${progress.pageCount} pages / ${progress.chunkCount} chunks) (${displayName})`;
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
            message: `Running paddleocr_vl in PaddleOCR (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${displayName})`,
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
            message: `Loaded saved PaddleOCR (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${displayName})`,
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
            message: `Ran paddleocr_vl in PaddleOCR (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${displayName})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'memory_saved',
            message: `Saved PaddleOCR preflight (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${displayName})`,
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
            message: `Running OCR markdown process (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${displayName})`,
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
            message: `Loaded saved OCR markdown (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${displayName})`,
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
            message: `Ran OCR markdown process (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${displayName})`,
            parseStatus: 'partial',
            ...eventBase,
          },
        },
        {
          event: steelNativeStreamEventName,
          data: {
            type: 'memory_saved',
            message: `Saved OCR markdown (chunk ${progress.chunkIndex}/${progress.chunkCount}) (${displayName})`,
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
            message: `Read OCR markdowns (${displayName}: ${progress.chunkCount} chunks)`,
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
            message: `Processing pdf with OCR markdowns (${displayName})`,
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
            message: `ocr preprocessing failed (${displayName})`,
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
