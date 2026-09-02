import { useCallback } from 'react';
import { useRecoilCallback } from 'recoil';
import type { EventSubmission } from 'librechat-data-provider';
import type {
  SteelNativeActivityEnvelope,
  SteelNativeActivityEvent,
  SteelNativeDelegateOcrStage,
  SteelNativeDelegateOcrStatus,
} from '~/store/steel';
import { steelNativeActivityByMessageId, steelNativeStreamEventName } from '~/store/steel';

const MAX_STEEL_ACTIVITY_EVENTS = 100;

type MaybeSteelNativeActivityEnvelope = Partial<SteelNativeActivityEnvelope> & {
  data?: Partial<SteelNativeActivityEvent>;
};

const steelActivitySources = new Set([
  'assistant_markdown',
  'ocr_preprocessing',
  'paddleocr_preflight',
  'delegate_ocr_preflight',
  'quote_runtime',
  'responses_output',
  'tool_result',
]);

const steelActivityEventTypes = new Set([
  'parse_status',
  'memory_saved',
  'quote_audit',
  'delegate_ocr_status',
]);

function isSavedCounts(value: unknown): value is Record<string, number> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((count) => typeof count === 'number' && Number.isFinite(count));
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isMissingPageRangesByFileKey(
  value: unknown,
): value is Record<string, readonly { pageStart: number; pageEnd: number }[]> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(
    ([fileKey, ranges]) =>
      fileKey.length > 0 &&
      Array.isArray(ranges) &&
      ranges.length > 0 &&
      ranges.every(
        (range) =>
          range != null &&
          typeof range === 'object' &&
          !Array.isArray(range) &&
          Number.isInteger(range.pageStart) &&
          Number.isInteger(range.pageEnd) &&
          range.pageStart > 0 &&
          range.pageStart <= range.pageEnd,
      ),
  );
}

const steelActivityErrorMaxLength = 512;

function sanitizeSteelActivityError(value: unknown): string | undefined {
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
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized) {
    return undefined;
  }
  return normalized.length <= steelActivityErrorMaxLength
    ? normalized
    : `${normalized.slice(0, steelActivityErrorMaxLength - 3)}...`;
}

function normalizedCountMetadata(data: Partial<SteelNativeActivityEvent>) {
  return {
    ...(isSavedCounts(data.savedTableCounts) ? { savedTableCounts: data.savedTableCounts } : {}),
    ...(isSavedCounts(data.totalSavedCounts) ? { totalSavedCounts: data.totalSavedCounts } : {}),
    ...(isSavedCounts(data.totalTableCounts) ? { totalTableCounts: data.totalTableCounts } : {}),
  };
}

export function normalizeSteelActivityEvent(
  event: MaybeSteelNativeActivityEnvelope,
): SteelNativeActivityEvent | null {
  if (event.event !== steelNativeStreamEventName || event.data == null) {
    return null;
  }

  const { data } = event;
  if (
    typeof data.type !== 'string' ||
    !steelActivityEventTypes.has(data.type) ||
    typeof data.source !== 'string' ||
    !steelActivitySources.has(data.source) ||
    typeof data.message !== 'string'
  ) {
    return null;
  }

  if (data.type === 'delegate_ocr_status') {
    if (
      data.source !== 'delegate_ocr_preflight' ||
      !Number.isSafeInteger(data.delegateOcrIndex) ||
      (data.delegateOcrIndex as number) < 1 ||
      ![
        'resume',
        'paddleocr',
        'organizer',
        'agent',
        'reconciliation',
        'saving',
        'summary',
        'response',
      ].includes(data.stage as string) ||
      !['started', 'progress', 'retrying', 'succeeded', 'failed', 'replaced'].includes(
        data.status as string,
      )
    ) {
      return null;
    }
    if (
      (data.chunkIndex !== undefined &&
        (!Number.isSafeInteger(data.chunkIndex) || (data.chunkIndex as number) < 0)) ||
      (data.chunkCount !== undefined &&
        (!Number.isSafeInteger(data.chunkCount) || (data.chunkCount as number) < 1))
    ) {
      return null;
    }
    const errorMessage = sanitizeSteelActivityError(data.errorMessage);
    return {
      type: 'delegate_ocr_status',
      source: 'delegate_ocr_preflight',
      message: data.message,
      delegateOcrIndex: data.delegateOcrIndex as number,
      stage: data.stage as SteelNativeDelegateOcrStage,
      status: data.status as SteelNativeDelegateOcrStatus,
      ...(errorMessage ? { errorMessage } : {}),
      ...(typeof data.chunkIndex === 'number' ? { chunkIndex: data.chunkIndex } : {}),
      ...(typeof data.chunkCount === 'number' ? { chunkCount: data.chunkCount } : {}),
      ...(typeof data.conversationId === 'string' ? { conversationId: data.conversationId } : {}),
      ...(typeof data.requestId === 'string' ? { requestId: data.requestId } : {}),
      ...(typeof data.messageId === 'string' ? { messageId: data.messageId } : {}),
      ...(typeof data.toolName === 'string' ? { toolName: data.toolName } : {}),
      ...(typeof data.providerToolCallId === 'string'
        ? { providerToolCallId: data.providerToolCallId }
        : {}),
    };
  }

  if (data.type === 'quote_audit') {
    if (
      data.source === 'quote_runtime' &&
      data.message === 'Stage 2 started' &&
      data.stage === 'stage_2' &&
      data.status === 'started'
    ) {
      return {
        type: 'quote_audit',
        source: 'quote_runtime',
        message: 'Stage 2 started',
        stage: 'stage_2',
        status: 'started',
        ...(typeof data.conversationId === 'string' ? { conversationId: data.conversationId } : {}),
        ...(typeof data.requestId === 'string' ? { requestId: data.requestId } : {}),
        ...(typeof data.messageId === 'string' ? { messageId: data.messageId } : {}),
        ...(typeof data.toolName === 'string' ? { toolName: data.toolName } : {}),
        ...(typeof data.providerToolCallId === 'string'
          ? { providerToolCallId: data.providerToolCallId }
          : {}),
      };
    }

    if (
      data.source !== 'quote_runtime' ||
      data.message !== 'Code Interpreter executed' ||
      (data.stage !== 'stage_1' && data.stage !== 'stage_2') ||
      data.status !== 'executed' ||
      data.toolName !== 'code_interpreter' ||
      (data.providerToolCallId !== undefined &&
        (typeof data.providerToolCallId !== 'string' || data.providerToolCallId === ''))
    ) {
      return null;
    }

    return {
      type: 'quote_audit',
      source: 'quote_runtime',
      message: 'Code Interpreter executed',
      stage: data.stage,
      status: 'executed',
      toolName: 'code_interpreter',
      ...(typeof data.conversationId === 'string' ? { conversationId: data.conversationId } : {}),
      ...(typeof data.requestId === 'string' ? { requestId: data.requestId } : {}),
      ...(typeof data.messageId === 'string' ? { messageId: data.messageId } : {}),
      ...(typeof data.providerToolCallId === 'string'
        ? { providerToolCallId: data.providerToolCallId }
        : {}),
    };
  }

  if (data.type === 'parse_status') {
    if (
      data.parseStatus !== 'saved' &&
      data.parseStatus !== 'partial' &&
      data.parseStatus !== 'skipped'
    ) {
      return null;
    }

    return {
      type: 'parse_status',
      source: data.source,
      message: data.message,
      parseStatus: data.parseStatus,
      ...(isSavedCounts(data.savedCounts) ? { savedCounts: data.savedCounts } : {}),
      ...normalizedCountMetadata(data),
      ...(typeof data.conversationId === 'string' ? { conversationId: data.conversationId } : {}),
      ...(typeof data.requestId === 'string' ? { requestId: data.requestId } : {}),
      ...(typeof data.messageId === 'string' ? { messageId: data.messageId } : {}),
      ...(typeof data.toolName === 'string' ? { toolName: data.toolName } : {}),
      ...(typeof data.providerToolCallId === 'string'
        ? { providerToolCallId: data.providerToolCallId }
        : {}),
      ...(typeof data.errorMessage === 'string' ? { errorMessage: data.errorMessage } : {}),
      ...(isStringArray(data.failedKeys) ? { failedKeys: data.failedKeys } : {}),
      ...(isMissingPageRangesByFileKey(data.missingPageRangesByFileKey)
        ? { missingPageRangesByFileKey: data.missingPageRangesByFileKey }
        : {}),
    };
  }

  if (!isSavedCounts(data.savedCounts)) {
    return null;
  }

  return {
    type: 'memory_saved',
    source: data.source,
    message: data.message,
    savedCounts: data.savedCounts,
    ...normalizedCountMetadata(data),
    ...(typeof data.conversationId === 'string' ? { conversationId: data.conversationId } : {}),
    ...(typeof data.requestId === 'string' ? { requestId: data.requestId } : {}),
    ...(typeof data.messageId === 'string' ? { messageId: data.messageId } : {}),
    ...(typeof data.toolName === 'string' ? { toolName: data.toolName } : {}),
    ...(typeof data.providerToolCallId === 'string'
      ? { providerToolCallId: data.providerToolCallId }
      : {}),
  };
}

export function normalizePersistedSteelActivityEvent(
  value: unknown,
): SteelNativeActivityEvent | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return normalizeSteelActivityEvent({
    event: steelNativeStreamEventName,
    data: value,
  } as MaybeSteelNativeActivityEnvelope);
}

function getTargetMessageIds(
  event: SteelNativeActivityEvent,
  submission: EventSubmission,
): string[] {
  const ids = new Set<string>();
  if (event.messageId) {
    ids.add(event.messageId);
  }

  const currentResponseId = submission.initialResponse?.messageId;
  if (
    !event.messageId ||
    event.source === 'assistant_markdown' ||
    event.source === 'ocr_preprocessing' ||
    event.source === 'paddleocr_preflight' ||
    event.source === 'delegate_ocr_preflight'
  ) {
    if (currentResponseId) {
      ids.add(currentResponseId);
    }
  }

  return Array.from(ids);
}

function stableEventKey(event: SteelNativeActivityEvent): string {
  return JSON.stringify({
    type: event.type,
    source: event.source,
    message: event.message,
    conversationId: event.conversationId,
    requestId: event.requestId,
    messageId: event.messageId,
    toolName: event.toolName,
    providerToolCallId: event.providerToolCallId,
    parseStatus: event.type === 'parse_status' ? event.parseStatus : undefined,
    savedCounts: event.savedCounts,
    savedTableCounts: event.savedTableCounts,
    totalSavedCounts: event.totalSavedCounts,
    totalTableCounts: event.totalTableCounts,
    stage: event.type === 'quote_audit' ? event.stage : undefined,
    status: event.type === 'quote_audit' ? event.status : undefined,
    delegateOcrIndex: event.type === 'delegate_ocr_status' ? event.delegateOcrIndex : undefined,
    delegateStage: event.type === 'delegate_ocr_status' ? event.stage : undefined,
    delegateStatus: event.type === 'delegate_ocr_status' ? event.status : undefined,
    chunkIndex:
      event.type === 'delegate_ocr_status' ? event.chunkIndex : undefined,
    chunkCount:
      event.type === 'delegate_ocr_status' ? event.chunkCount : undefined,
    errorMessage:
      event.type === 'parse_status' || event.type === 'delegate_ocr_status'
        ? event.errorMessage
        : undefined,
    failedKeys: event.type === 'parse_status' ? event.failedKeys : undefined,
    missingPageRangesByFileKey:
      event.type === 'parse_status' ? event.missingPageRangesByFileKey : undefined,
  });
}

function getOcrPreprocessingProgressState(event: SteelNativeActivityEvent):
  | {
      key: string;
      state: 'running' | 'ran';
    }
  | undefined {
  if (
    event.source !== 'ocr_preprocessing' ||
    event.type !== 'parse_status' ||
    event.parseStatus !== 'partial'
  ) {
    return undefined;
  }

  const paddleOcrMatch =
    /^(Running|Ran) paddleocr_vl in PaddleOCR \(chunk (\d+)\/(\d+)\) \((.*)\)$/u.exec(
      event.message,
    );
  const organizerMatch =
    /^(Running|Ran) OCR markdown process \(chunk (\d+)\/(\d+)\) \((.*)\)$/u.exec(event.message);
  const match = paddleOcrMatch ?? organizerMatch;
  if (!match) {
    return undefined;
  }

  return {
    key: JSON.stringify({
      source: event.source,
      conversationId: event.conversationId,
      requestId: event.requestId,
      messageId: event.messageId,
      stage: paddleOcrMatch ? 'paddleocr' : 'organizer',
      chunkIndex: match[2],
      chunkCount: match[3],
      file: match[4],
    }),
    state: match[1] === 'Ran' ? 'ran' : 'running',
  };
}

export function appendSteelNativeActivityEvent(
  current: SteelNativeActivityEvent[],
  incoming: SteelNativeActivityEvent,
): SteelNativeActivityEvent[] {
  const incomingKey = stableEventKey(incoming);
  if (current.some((event) => stableEventKey(event) === incomingKey)) {
    return current;
  }

  const incomingProgress = getOcrPreprocessingProgressState(incoming);
  const nextCurrent =
    incomingProgress?.state === 'ran'
      ? current.filter((event) => {
          const progress = getOcrPreprocessingProgressState(event);
          return progress?.key !== incomingProgress.key || progress.state !== 'running';
        })
      : current;

  return [...nextCurrent, incoming].slice(-MAX_STEEL_ACTIVITY_EVENTS);
}

export default function useSteelEventHandler() {
  const setSteelActivity = useRecoilCallback(
    ({ set }) =>
      (messageId: string, event: SteelNativeActivityEvent) => {
        set(steelNativeActivityByMessageId(messageId), (current) =>
          appendSteelNativeActivityEvent(current, {
            ...event,
            receivedAt: event.receivedAt ?? Date.now(),
          }),
        );
      },
    [],
  );

  return useCallback(
    (event: MaybeSteelNativeActivityEnvelope, submission: EventSubmission) => {
      const activityEvent = normalizeSteelActivityEvent(event);
      if (!activityEvent) {
        return;
      }

      const messageIds = getTargetMessageIds(activityEvent, submission);
      if (messageIds.length === 0) {
        return;
      }

      for (const messageId of messageIds) {
        setSteelActivity(messageId, activityEvent);
      }
    },
    [setSteelActivity],
  );
}
