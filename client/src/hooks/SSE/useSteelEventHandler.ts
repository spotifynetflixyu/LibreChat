import { useCallback } from 'react';
import { useRecoilCallback } from 'recoil';
import { parseSteelNativeActivityEvent } from 'librechat-data-provider';
import type { EventSubmission } from 'librechat-data-provider';
import type { SteelNativeActivityEvent, SteelNativeQuotationStatus } from '~/store/steel';
import { steelNativeActivityByMessageId, steelNativeStreamEventName } from '~/store/steel';

const MAX_STEEL_ACTIVITY_EVENTS = 100;

type MaybeSteelNativeActivityEnvelope = { event?: unknown; data?: unknown };

export function normalizeSteelActivityEvent(
  event: MaybeSteelNativeActivityEnvelope,
): SteelNativeActivityEvent | null {
  if (event.event !== steelNativeStreamEventName) {
    return null;
  }
  return parseSteelNativeActivityEvent(event.data) ?? null;
}

export function normalizePersistedSteelActivityEvent(
  value: unknown,
): SteelNativeActivityEvent | null {
  return parseSteelNativeActivityEvent(value) ?? null;
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
    event.source === 'ocr_preprocessing' ||
    event.source === 'paddleocr_preflight' ||
    event.source === 'delegate_ocr_preflight' ||
    event.source === 'quotation_preflight'
  ) {
    if (currentResponseId) {
      ids.add(currentResponseId);
    }
  }

  return Array.from(ids);
}

function computeStableEventKey(event: SteelNativeActivityEvent): string {
  if (event.type === 'quotation_status') {
    return JSON.stringify({
      type: event.type,
      source: event.source,
      conversationId: event.conversationId,
      index: event.index,
      runId: event.runId,
      quotationStage: event.stage,
      quotationStatus: event.status,
      completedChunks: event.completedChunks,
      totalChunks: event.totalChunks,
      chunkIndex: event.chunkIndex,
      attempt: event.attempt,
      repairAttempt: event.repairAttempt,
      maxRepairAttempts: event.maxRepairAttempts,
      ocrSource: event.ocrSource,
      toolName: event.toolName,
      providerToolCallId: event.providerToolCallId,
    });
  }

  const { receivedAt: _receivedAt, ...canonical } = event;
  return JSON.stringify(canonical);
}

function isTerminalQuotationStatus(status: SteelNativeQuotationStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

function isSameQuotationRun(
  left: Extract<SteelNativeActivityEvent, { type: 'quotation_status' }>,
  right: Extract<SteelNativeActivityEvent, { type: 'quotation_status' }>,
): boolean {
  return (
    left.conversationId === right.conversationId &&
    left.index === right.index &&
    left.runId === right.runId
  );
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

const stableEventKeys = new WeakMap<SteelNativeActivityEvent, string>();

/** Activity events are immutable once stored, so their dedupe key is cached by identity. */
function stableEventKey(event: SteelNativeActivityEvent): string {
  let key = stableEventKeys.get(event);
  if (key === undefined) {
    key = computeStableEventKey(event);
    stableEventKeys.set(event, key);
  }
  return key;
}

export function appendSteelNativeActivityEvent(
  current: SteelNativeActivityEvent[],
  incoming: SteelNativeActivityEvent,
): SteelNativeActivityEvent[] {
  if (incoming.type === 'quotation_status' && !isTerminalQuotationStatus(incoming.status)) {
    const terminalEvent = current.find(
      (event): event is Extract<SteelNativeActivityEvent, { type: 'quotation_status' }> =>
        event.type === 'quotation_status' &&
        isTerminalQuotationStatus(event.status) &&
        isSameQuotationRun(event, incoming),
    );
    if (terminalEvent) {
      return current;
    }
  }

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
