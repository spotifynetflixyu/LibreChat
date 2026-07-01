import { useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalMessagesOperations } from '~/Providers';

type TimerTimestamp = string | number | null | undefined;

type MessageElapsedTimerProps = {
  isCreatedByUser?: boolean;
  isSubmitting?: boolean;
  startedAt?: TimerTimestamp;
  parentMessageId?: string | null;
  timerKey?: string | null;
};

function parseTimestampMs(value: TimerTimestamp): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatElapsedTime(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export default function MessageElapsedTimer({
  isCreatedByUser,
  isSubmitting = false,
  startedAt,
  parentMessageId,
  timerKey,
}: MessageElapsedTimerProps) {
  const { getMessages } = useOptionalMessagesOperations();
  const parentStartedAt = useMemo(() => {
    if (!parentMessageId) {
      return null;
    }
    const parentMessage = getMessages()?.find((message) => message.messageId === parentMessageId);
    return parentMessage?.createdAt ?? parentMessage?.clientTimestamp ?? null;
  }, [getMessages, parentMessageId]);

  const resolvedStartedAt = parseTimestampMs(parentStartedAt) ?? parseTimestampMs(startedAt);
  const keyRef = useRef<string | null | undefined>(timerKey);
  const startAtRef = useRef<number>(resolvedStartedAt ?? Date.now());
  const hasStartedRef = useRef(isCreatedByUser !== true && isSubmitting);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [completedAtMs, setCompletedAtMs] = useState<number | null>(null);

  useEffect(() => {
    if (keyRef.current === timerKey) {
      return;
    }
    keyRef.current = timerKey;
    startAtRef.current = resolvedStartedAt ?? Date.now();
    hasStartedRef.current = isCreatedByUser !== true && isSubmitting;
    setCompletedAtMs(null);
    setNowMs(Date.now());
  }, [isCreatedByUser, isSubmitting, resolvedStartedAt, timerKey]);

  useEffect(() => {
    if (isCreatedByUser === true) {
      return;
    }
    if (!isSubmitting) {
      if (hasStartedRef.current) {
        setCompletedAtMs((current) => current ?? Date.now());
      }
      return;
    }

    hasStartedRef.current = true;
    setCompletedAtMs(null);
    setNowMs(Date.now());

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isCreatedByUser, isSubmitting]);

  if (isCreatedByUser === true || !hasStartedRef.current) {
    return null;
  }

  const endAtMs = isSubmitting ? nowMs : completedAtMs;
  if (endAtMs == null) {
    return null;
  }

  return (
    <span
      data-testid="message-elapsed-timer"
      className="ml-2 text-xs font-normal tabular-nums text-text-secondary"
    >
      {formatElapsedTime(endAtMs - startAtRef.current)}
    </span>
  );
}
