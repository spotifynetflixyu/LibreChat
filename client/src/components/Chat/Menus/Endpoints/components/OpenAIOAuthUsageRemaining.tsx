import { Gauge } from 'lucide-react';
import type { OpenAIOAuthUsageWindow } from 'librechat-data-provider';
import { useGetOpenAIOAuthUsageQuery } from '~/data-provider';
import type { LocalizeFunction } from '~/common';
import { useLocalize } from '~/hooks';

function getWindowLabel(
  window: OpenAIOAuthUsageWindow,
  localize: LocalizeFunction,
): string {
  if (window.key === 'secondary' || window.limitWindowSeconds >= 604800) {
    return localize('com_ui_weekly');
  }

  const hours = window.limitWindowSeconds / 3600;
  if (Number.isInteger(hours)) {
    return `${hours}h`;
  }

  const minutes = Math.round(window.limitWindowSeconds / 60);
  return `${minutes}m`;
}

function formatResetLabel(window: OpenAIOAuthUsageWindow): string {
  const resetAt = new Date(window.resetAt);
  if (Number.isNaN(resetAt.getTime())) {
    return '';
  }

  const options: Intl.DateTimeFormatOptions =
    window.key === 'secondary' || window.limitWindowSeconds >= 86400
      ? { month: 'short', day: 'numeric' }
      : { hour: 'numeric', minute: '2-digit' };

  return new Intl.DateTimeFormat(undefined, options).format(resetAt);
}

function getUnavailableReason({
  dataReason,
  isError,
}: {
  dataReason?: string;
  isError: boolean;
}): string | undefined {
  if (dataReason) {
    return dataReason;
  }
  return isError ? 'request_failed' : undefined;
}

function UsageRows({
  localize,
  windows,
}: {
  localize: LocalizeFunction;
  windows: OpenAIOAuthUsageWindow[];
}) {
  if (windows.length === 0) {
    return <span className="text-xs text-text-secondary">{localize('com_ui_unavailable')}</span>;
  }

  return (
    <div className="space-y-1">
      {windows.map((window) => (
        <div
          key={window.key}
          className="flex items-center justify-between gap-3 text-xs text-text-secondary"
        >
          <span className="min-w-0 truncate">{getWindowLabel(window, localize)}</span>
          <span className="flex shrink-0 items-center gap-2 tabular-nums">
            <span>{Math.round(window.remainingPercent)}%</span>
            <span>{formatResetLabel(window)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OpenAIOAuthUsageRemaining() {
  const localize = useLocalize();
  const usageQuery = useGetOpenAIOAuthUsageQuery();
  const windows = usageQuery.data?.status === 'available' ? usageQuery.data.windows : [];
  const showUnavailable =
    usageQuery.isError || (usageQuery.data && usageQuery.data.status !== 'available');
  const unavailableReason = getUnavailableReason({
    dataReason: usageQuery.data?.reason,
    isError: usageQuery.isError,
  });
  const unavailableText = unavailableReason
    ? `${localize('com_ui_unavailable')}: ${unavailableReason}`
    : localize('com_ui_unavailable');

  return (
    <div className="mx-2 mt-1 border-t border-border-light px-1 pb-1 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm text-text-primary">
        <span className="flex min-w-0 items-center gap-2">
          <Gauge className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="truncate">{localize('com_ui_usage_remaining')}</span>
        </span>
      </div>
      {usageQuery.isLoading ? (
        <span className="text-xs text-text-secondary">{localize('com_ui_loading')}</span>
      ) : showUnavailable ? (
        <span className="text-xs text-text-secondary">{unavailableText}</span>
      ) : (
        <UsageRows localize={localize} windows={windows} />
      )}
    </div>
  );
}
