import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getElapsedDurationLabels } from '~/utils/runStepDuration';
import { useOptionalMessagesOperations } from '~/Providers';
import useLocalize from '~/hooks/useLocalize';
import useTimeTick from '~/hooks/useTimeTick';
import { isValidTimestamp } from '~/utils';

type TimerTimestamp = string | number | null | undefined;

type MessageElapsedTimerProps = {
  isCreatedByUser?: boolean;
  isSubmitting?: boolean;
  startedAt?: TimerTimestamp;
  submissionStartedAt?: number | null;
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
  submissionStartedAt,
  parentMessageId,
  timerKey,
}: MessageElapsedTimerProps) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { getMessages } = useOptionalMessagesOperations();
  const parentStartedAt = useMemo(() => {
    if (!parentMessageId) {
      return null;
    }
    const parentMessage = getMessages()?.find((message) => message.messageId === parentMessageId);
    return isValidTimestamp(parentMessage?.createdAt)
      ? parentMessage.createdAt
      : (parentMessage?.clientTimestamp ?? null);
  }, [getMessages, parentMessageId]);

  const parentStartedAtMs = parseTimestampMs(parentStartedAt);
  const responseStartedAtMs = parseTimestampMs(startedAt);
  const submissionStartedAtMs = parseTimestampMs(submissionStartedAt);
  const resolvedStartedAt = submissionStartedAtMs ?? responseStartedAtMs ?? parentStartedAtMs;
  const keyRef = useRef<string | null | undefined>(timerKey);
  const resolvedStartedAtRef = useRef<number | null>(resolvedStartedAt);
  const hasStartedRef = useRef(isCreatedByUser !== true && isSubmitting);
  const wasSubmittingRef = useRef(isSubmitting);
  const [startAtMs, setStartAtMs] = useState(() => resolvedStartedAt ?? Date.now());
  const [completedAtMs, setCompletedAtMs] = useState<number | null>(null);
  useTimeTick(1_000);

  useLayoutEffect(() => {
    const keyChanged = keyRef.current !== timerKey;
    const startChanged = resolvedStartedAtRef.current !== resolvedStartedAt;
    if (!keyChanged && !startChanged) {
      return;
    }
    keyRef.current = timerKey;
    resolvedStartedAtRef.current = resolvedStartedAt;

    if (keyChanged) {
      setStartAtMs(resolvedStartedAt ?? Date.now());
      hasStartedRef.current = isCreatedByUser !== true && isSubmitting;
      setCompletedAtMs(null);
    } else if (resolvedStartedAt !== null) {
      setStartAtMs((current) => {
        if (submissionStartedAtMs !== null || !hasStartedRef.current) {
          return resolvedStartedAt;
        }
        return Math.min(current, resolvedStartedAt);
      });
    }
  }, [isCreatedByUser, isSubmitting, resolvedStartedAt, submissionStartedAtMs, timerKey]);

  useEffect(() => {
    if (isCreatedByUser === true) {
      wasSubmittingRef.current = false;
      return;
    }
    if (!isSubmitting) {
      wasSubmittingRef.current = false;
      if (hasStartedRef.current) {
        setCompletedAtMs((current) => current ?? Date.now());
      }
      return;
    }

    const isRestarting = !wasSubmittingRef.current;
    wasSubmittingRef.current = true;
    if (isRestarting) {
      setStartAtMs(submissionStartedAtMs ?? Date.now());
    }
    hasStartedRef.current = true;
    setCompletedAtMs(null);
  }, [isCreatedByUser, isSubmitting, submissionStartedAtMs]);

  if (isCreatedByUser === true || !hasStartedRef.current) {
    return null;
  }

  const endAtMs = isSubmitting ? Date.now() : completedAtMs;
  if (endAtMs == null) {
    return null;
  }

  const durationMs = Math.max(0, Math.floor((endAtMs - startAtMs) / 1000)) * 1000;
  const labels = getElapsedDurationLabels(durationMs, i18n.language);
  const values = { ...labels.values };
  if (durationMs >= 60_000) {
    const seconds = Math.floor(durationMs / 1000) % 60;
    try {
      values[1] = new Intl.NumberFormat(i18n.language, { minimumIntegerDigits: 2 }).format(seconds);
    } catch {
      values[1] = String(seconds).padStart(2, '0');
    }
  }
  return (
    <span
      data-testid="message-elapsed-timer"
      aria-label={localize(labels.announcedKey, labels.announcedValues)}
      className="ml-2 text-xs font-normal tabular-nums text-text-secondary"
    >
      {localize(labels.key, values)}
    </span>
  );
}
