import { useTranslation } from 'react-i18next';
import { cn, getMessageTimestamp } from '~/utils';
import useTimeTick from '~/hooks/useTimeTick';
import { formatElapsedTime } from './MessageElapsedTimer';

type Timestamp = NonNullable<ReturnType<typeof getMessageTimestamp>>;
const SECOND = 1_000;
const MINUTE = 60_000;

function TimestampText({
  timestamp,
  className,
  revealOnHover = true,
  processingDurationMs,
}: {
  timestamp: Timestamp;
  className?: string;
  revealOnHover?: boolean;
  processingDurationMs?: number;
}) {
  return (
    <time
      dateTime={timestamp.iso}
      title={timestamp.isRecent ? timestamp.absolute : undefined}
      className={cn(
        'message-timestamp text-xs font-normal text-text-secondary',
        revealOnHover &&
          'ml-2 transition-opacity duration-theme-normal ease-out motion-reduce:transition-none',
        className,
      )}
    >
      {timestamp.isRecent ? timestamp.relative : timestamp.absolute}
      {typeof processingDurationMs === 'number' &&
        Number.isFinite(processingDurationMs) &&
        Number.isSafeInteger(processingDurationMs) &&
        processingDurationMs >= 0 && <> ({formatElapsedTime(processingDurationMs)})</>}
    </time>
  );
}

/** Only recent timestamps subscribe to the shared minute ticker, so the
 * per-minute sweep re-renders a handful of rows instead of every message. */
function RecentTimestamp({
  value,
  language,
  className,
  revealOnHover,
  processingDurationMs,
}: {
  value?: string | null;
  language: string;
  className?: string;
  revealOnHover?: boolean;
  processingDurationMs?: number;
}) {
  const parsedTime = value ? Date.parse(value) : Number.NaN;
  const age = Date.now() - parsedTime;
  const now = useTimeTick(Number.isFinite(age) && age >= 0 && age < MINUTE ? SECOND : MINUTE);
  const timestamp = getMessageTimestamp(value, language, now);

  if (!timestamp) {
    return null;
  }

  return (
    <TimestampText
      timestamp={timestamp}
      className={className}
      revealOnHover={revealOnHover}
      processingDurationMs={processingDurationMs}
    />
  );
}

/**
 * Inline message timestamp shown next to the author name in the message header.
 * On hover-capable pointers it reveals on row hover/focus; on touch and other
 * non-hover devices it stays visible. Recent messages show the relative form
 * ("10 minutes ago") with the absolute date on hover; older messages show the
 * absolute date directly.
 */
export default function MessageTimestamp({
  value,
  className,
  revealOnHover,
  processingDurationMs,
}: {
  value?: string | null;
  className?: string;
  revealOnHover?: boolean;
  processingDurationMs?: number;
}) {
  const { i18n } = useTranslation();
  const timestamp = getMessageTimestamp(value, i18n.language);

  if (!timestamp) {
    return null;
  }

  if (timestamp.isRecent) {
    return (
      <RecentTimestamp
        value={value}
        language={i18n.language}
        className={className}
        revealOnHover={revealOnHover}
        processingDurationMs={processingDurationMs}
      />
    );
  }

  return (
    <TimestampText
      timestamp={timestamp}
      className={className}
      revealOnHover={revealOnHover}
      processingDurationMs={processingDurationMs}
    />
  );
}
