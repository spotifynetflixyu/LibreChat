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
    conversationId: event.conversationId,
    requestId: event.requestId,
    messageId: event.messageId,
    toolName: event.toolName,
    providerToolCallId: event.providerToolCallId,
    parseStatus: event.type === 'parse_status' ? event.parseStatus : undefined,
    savedCounts: event.savedCounts,
  });
}

export function appendSteelNativeActivityEvent(
  current: SteelNativeActivityEvent[],
  incoming: SteelNativeActivityEvent,
): SteelNativeActivityEvent[] {
  const incomingKey = stableEventKey(incoming);
  if (current.some((event) => stableEventKey(event) === incomingKey)) {
    return current;
  }

  return [...current, incoming].slice(-MAX_STEEL_ACTIVITY_EVENTS);
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
