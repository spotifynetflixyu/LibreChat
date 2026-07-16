import { useCallback } from 'react';
import { useRecoilCallback } from 'recoil';
import type { EventSubmission } from 'librechat-data-provider';
import type { SteelNativeActivityEnvelope, SteelNativeActivityEvent } from '~/store/steel';
import { steelNativeActivityByMessageId, steelNativeStreamEventName } from '~/store/steel';

const MAX_STEEL_ACTIVITY_EVENTS = 100;

type MaybeSteelNativeActivityEnvelope = Partial<SteelNativeActivityEnvelope> & {
  data?: Partial<SteelNativeActivityEvent>;
};

const steelActivityEventTypes = new Set(['parse_status', 'memory_saved']);
const steelActivitySources = new Set([
  'assistant_markdown',
  'ocr_preprocessing',
  'paddleocr_preflight',
  'responses_output',
  'tool_result',
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

function normalizedCountMetadata(data: Partial<SteelNativeActivityEvent>) {
  return {
    ...(isSavedCounts(data.savedTableCounts) ? { savedTableCounts: data.savedTableCounts } : {}),
    ...(isSavedCounts(data.totalSavedCounts) ? { totalSavedCounts: data.totalSavedCounts } : {}),
    ...(isSavedCounts(data.totalTableCounts) ? { totalTableCounts: data.totalTableCounts } : {}),
  };
}

function normalizeSteelActivityEvent(
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

function getTargetMessageIds(
  event: SteelNativeActivityEvent,
  submission: EventSubmission,
): string[] {
  const ids = new Set<string>();
  if (event.messageId) {
    ids.add(event.messageId);
  }

  const currentResponseId = submission.initialResponse?.messageId;
  if (!event.messageId || event.source === 'assistant_markdown') {
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
    errorMessage: event.type === 'parse_status' ? event.errorMessage : undefined,
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
