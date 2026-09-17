import { memo, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle } from 'lucide-react';
import { Button } from '@librechat/client';
import { useRecoilValue } from 'recoil';
import type { SteelQuotationStatus } from 'librechat-data-provider';
import type {
  SteelNativeActivityEvent,
  SteelNativeSavedCounts,
  SteelNativeTableCounts,
} from '~/store/steel';
import { steelNativeActivityByMessageId } from '~/store/steel';
import useLocalize from '~/hooks/useLocalize';
import {
  useCancelSteelQuotationMutation,
  useGetSteelQuotationStatusQuery,
} from '~/data-provider/Steel';
import { ChatContext } from '~/Providers';
import {
  appendSteelNativeActivityEvent,
  normalizePersistedSteelActivityEvent,
} from '~/hooks/SSE/useSteelEventHandler';

type SteelActivityProps = {
  messageId: string;
  isCreatedByUser?: boolean;
  conversationId?: string | null;
  persistedActivityEvents?: readonly unknown[];
};

type Localize = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<Localize>[0];

const assistantOcrSavedCountKeys = new Set(['ocr_extract']);
const officialOcrMarkdownSavedCountKeys = new Set(['ocr_markdown']);
const paddleOcrSavedCountKeys = new Set(['paddleocr_preflight']);
const workbookRowSavedCountKeys = new Set(['working_order_row']);
const ocrTableCountKeys = new Set(['ocr_table']);
const workbookTableCountKeys = new Set(['system_order_table']);
const collapsedActivityEventCount = 3;
const savedRecordLabelKeys = new Map<string, LocalizeKey>([
  ['calculation_fact', 'com_ui_steel_activity_record_calculation_facts'],
  ['customer_fact', 'com_ui_steel_activity_record_customer_facts'],
  ['ocr_extract', 'com_ui_steel_activity_record_ocr_extracts'],
  ['price_evidence', 'com_ui_steel_activity_record_price_evidence'],
  ['working_order_row', 'com_ui_steel_activity_record_working_order_rows'],
]);

function isQuotationCancellableStatus(status: SteelQuotationStatus['status']): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'aggregating' ||
    status === 'finalizing' ||
    status === 'interrupted'
  );
}

function getQuotationStatusText(
  localize: Localize,
  status: SteelQuotationStatus['status'],
  completedChunks: number,
  totalChunks: number,
): string {
  if (status === 'queued') {
    return localize('com_ui_steel_quote_status_queued');
  }
  if (status === 'running') {
    return localize('com_ui_steel_quote_status_running', { completedChunks, totalChunks });
  }
  if (status === 'aggregating') {
    return localize('com_ui_steel_quote_status_aggregating');
  }
  if (status === 'finalizing') {
    return localize('com_ui_steel_quote_status_finalizing');
  }
  if (status === 'interrupted') {
    return localize('com_ui_steel_quote_status_interrupted');
  }
  if (status === 'completed') {
    return localize('com_ui_steel_quote_status_completed');
  }
  if (status === 'cancelled') {
    return localize('com_ui_steel_quote_status_cancelled');
  }
  return localize('com_ui_steel_quote_status_idle');
}

function getQuotationCancelError(error: unknown): string | undefined {
  let message: string | undefined;
  if (error instanceof Error && error.message) {
    message = error.message;
  } else if (typeof error === 'string' && error) {
    message = error;
  }
  return message;
}

type SteelQuotationProgressProps = {
  conversationId: string;
  event?: Extract<SteelNativeActivityEvent, { type: 'quotation_status' }>;
  localize: Localize;
};

const SteelQuotationProgress = memo(function SteelQuotationProgress({
  conversationId,
  event,
  localize,
}: SteelQuotationProgressProps) {
  const quotationQuery = useGetSteelQuotationStatusQuery(conversationId);
  const cancelMutation = useCancelSteelQuotationMutation(conversationId);
  const status = quotationQuery.data ?? event;

  if (!status) {
    return null;
  }

  const index = status.index ?? event?.index ?? null;
  const canCancel = quotationQuery.data?.canCancel ?? isQuotationCancellableStatus(status.status);
  const cancelError = getQuotationCancelError(cancelMutation.error);
  const statusText = getQuotationStatusText(
    localize,
    status.status,
    status.completedChunks,
    status.totalChunks,
  );
  const isCanceling = cancelMutation.isLoading;
  const hasError = Boolean(cancelError);

  return (
    <div
      className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 dark:border-border-medium dark:bg-surface-tertiary"
      aria-label={localize('com_ui_steel_activity_quotation')}
    >
      <LoaderCircle
        aria-hidden="true"
        className={`h-3.5 w-3.5 shrink-0 ${isCanceling ? 'animate-spin text-text-secondary' : 'text-text-secondary'}`}
      />
      <span className="min-w-0 whitespace-normal break-words">{statusText}</span>
      {event?.message && (
        <span className="min-w-0 whitespace-normal break-words text-text-tertiary">
          {event.message}
        </span>
      )}
      {canCancel && index !== null && status.status !== 'completed' && status.status !== 'cancelled' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 py-1"
          disabled={isCanceling}
          onClick={() => cancelMutation.mutate(index)}
        >
          {isCanceling
            ? localize('com_ui_steel_quote_canceling')
            : localize('com_ui_steel_quote_cancel')}
        </Button>
      )}
      {hasError && (
        <span className="min-w-0 whitespace-normal break-words text-status-error">
          {localize('com_ui_steel_quote_cancel_failed', { error: cancelError })}
        </span>
      )}
    </div>
  );
});

function getSavedCountTotal(event: SteelNativeActivityEvent): number {
  return Object.values(event.savedCounts ?? {}).reduce((total, count) => {
    if (!Number.isFinite(count) || count <= 0) {
      return total;
    }

    return total + count;
  }, 0);
}

function getCountForKeys(
  counts: SteelNativeSavedCounts | SteelNativeTableCounts | undefined,
  keys: Set<string>,
) {
  if (!counts) {
    return 0;
  }

  return Object.entries(counts).reduce((total, [key, count]) => {
    if (!keys.has(key) || !Number.isFinite(count) || count <= 0) {
      return total;
    }

    return total + count;
  }, 0);
}

function formatCountText(localize: Localize, sourceKey: LocalizeKey, count: number) {
  return localize('com_ui_steel_activity_source_count', {
    source: localize(sourceKey),
    count,
  });
}

function getSavedRecordCountTexts(
  savedCounts: SteelNativeSavedCounts | undefined,
  localize: Localize,
) {
  return Object.entries(savedCounts ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([key, count]) => {
      const labelKey = savedRecordLabelKeys.get(key);
      const source = labelKey ? localize(labelKey) : key.replaceAll('_', ' ');
      return localize('com_ui_steel_activity_source_count', { source, count });
    });
}

function isGenericSavedRecordsEvent(event: SteelNativeActivityEvent): boolean {
  return (
    event.type === 'memory_saved' &&
    event.source !== 'paddleocr_preflight' &&
    getCountForKeys(event.savedCounts, officialOcrMarkdownSavedCountKeys) === 0
  );
}

function getCountTexts({
  savedCounts,
  tableCounts,
  localize,
}: {
  savedCounts?: SteelNativeSavedCounts;
  tableCounts?: SteelNativeTableCounts;
  localize: ReturnType<typeof useLocalize>;
}) {
  const rawOcrCount = getCountForKeys(savedCounts, paddleOcrSavedCountKeys);
  const officialOcrMarkdownCount = getCountForKeys(savedCounts, officialOcrMarkdownSavedCountKeys);
  const explicitOcrTableCount = getCountForKeys(tableCounts, ocrTableCountKeys);
  const legacyOcrTableCount =
    explicitOcrTableCount > 0 ? 0 : getCountForKeys(savedCounts, assistantOcrSavedCountKeys);
  const ocrTableCount = explicitOcrTableCount || legacyOcrTableCount;
  const workbookTableCount = getCountForKeys(tableCounts, workbookTableCountKeys);
  const workbookRowCount = getCountForKeys(savedCounts, workbookRowSavedCountKeys);

  return [
    rawOcrCount > 0
      ? formatCountText(localize, 'com_ui_steel_activity_source_ocr_raw', rawOcrCount)
      : null,
    officialOcrMarkdownCount > 0
      ? formatCountText(
          localize,
          'com_ui_steel_activity_source_ocr_markdown',
          officialOcrMarkdownCount,
        )
      : null,
    ocrTableCount > 0
      ? formatCountText(localize, 'com_ui_steel_activity_source_ocr_tables', ocrTableCount)
      : null,
    workbookTableCount > 0
      ? formatCountText(
          localize,
          'com_ui_steel_activity_source_workbook_tables',
          workbookTableCount,
        )
      : null,
    workbookRowCount > 0
      ? formatCountText(localize, 'com_ui_steel_activity_source_workbook_rows', workbookRowCount)
      : null,
  ].filter((countText): countText is string => Boolean(countText));
}

function getActivityLabel(
  event: SteelNativeActivityEvent,
  localize: ReturnType<typeof useLocalize>,
) {
  if (event.type === 'quotation_status') {
    return (
      event.message ??
      getQuotationStatusText(localize, event.status, event.completedChunks, event.totalChunks)
    );
  }

  if (event.type === 'delegate_ocr_status') {
    return event.message;
  }

  if (event.type === 'quote_audit') {
    return event.message;
  }

  if (event.source === 'ocr_preprocessing') {
    return event.message;
  }

  if (getCountForKeys(event.savedCounts, officialOcrMarkdownSavedCountKeys) > 0) {
    return localize('com_ui_steel_activity_ocr_markdown_saved');
  }

  if (event.source === 'paddleocr_preflight') {
    if (event.type === 'memory_saved') {
      return localize('com_ui_steel_activity_paddleocr_saved');
    }

    if (event.parseStatus === 'saved') {
      return localize('com_ui_steel_activity_paddleocr_saved');
    }

    if (event.parseStatus === 'partial') {
      return localize('com_ui_steel_activity_paddleocr_partial');
    }

    if (event.parseStatus === 'skipped') {
      return localize('com_ui_steel_activity_paddleocr_skipped');
    }
  }

  if (event.type === 'memory_saved') {
    const recordCounts = getSavedRecordCountTexts(event.savedCounts, localize);
    if (recordCounts.length > 0) {
      return localize('com_ui_steel_activity_records_saved_detail', {
        counts: recordCounts.join(', '),
      });
    }
    return localize('com_ui_steel_activity_state_saved');
  }

  if (event.parseStatus === 'partial') {
    return localize('com_ui_steel_activity_parse_partial');
  }

  if (event.parseStatus === 'skipped') {
    return localize('com_ui_steel_activity_parse_skipped');
  }

  return localize('com_ui_steel_activity_parse_saved');
}

function getSavedCountText(
  event: SteelNativeActivityEvent,
  localize: ReturnType<typeof useLocalize>,
) {
  if (isGenericSavedRecordsEvent(event)) {
    return null;
  }

  const sourceCounts = getCountTexts({
    savedCounts: event.savedCounts,
    tableCounts: event.savedTableCounts,
    localize,
  });

  if (sourceCounts.length > 0) {
    return localize('com_ui_steel_activity_this_turn_counts', {
      counts: sourceCounts.join(', '),
    });
  }

  const savedCount = getSavedCountTotal(event);
  return savedCount > 0
    ? localize('com_ui_steel_activity_this_turn_counts', {
        counts: localize('com_ui_steel_activity_records_saved', { count: savedCount }),
      })
    : null;
}

function getTotalCountText(
  events: SteelNativeActivityEvent[],
  localize: ReturnType<typeof useLocalize>,
) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const sourceCounts = getCountTexts({
      savedCounts: event?.totalSavedCounts,
      tableCounts: event?.totalTableCounts,
      localize,
    });

    if (sourceCounts.length > 0) {
      return localize('com_ui_steel_activity_total_counts', {
        counts: sourceCounts.join(', '),
      });
    }
  }

  return null;
}

function shouldDisplayEvent(event: SteelNativeActivityEvent): boolean {
  if (event.type === 'quotation_status') {
    return false;
  }

  if (event.type === 'delegate_ocr_status') {
    return true;
  }

  if (event.type === 'quote_audit') {
    return true;
  }

  if (event.type === 'memory_saved') {
    return getSavedCountTotal(event) > 0;
  }

  return event.parseStatus !== 'saved';
}

function getErrorMessage(event: SteelNativeActivityEvent): string | undefined {
  return event.type === 'parse_status' || event.type === 'delegate_ocr_status'
    ? event.errorMessage
    : undefined;
}

function formatPageRange(range: { pageStart: number; pageEnd: number }): string {
  return range.pageStart === range.pageEnd
    ? String(range.pageStart)
    : `${range.pageStart}-${range.pageEnd}`;
}

function getMissingPageRangeTexts(
  events: SteelNativeActivityEvent[],
  localize: Localize,
): string[] {
  const rangesByFileKey = new Map<string, { pageStart: number; pageEnd: number }[]>();
  for (const event of events) {
    if (event.type !== 'parse_status' || !event.missingPageRangesByFileKey) {
      continue;
    }

    for (const [fileKey, ranges] of Object.entries(event.missingPageRangesByFileKey)) {
      rangesByFileKey.set(fileKey, [...(rangesByFileKey.get(fileKey) ?? []), ...ranges]);
    }
  }

  return [...rangesByFileKey.entries()].map(([fileKey, ranges]) => {
    const mergedRanges: { pageStart: number; pageEnd: number }[] = [];
    for (const range of ranges.sort(
      (left, right) => left.pageStart - right.pageStart || left.pageEnd - right.pageEnd,
    )) {
      const previousRange = mergedRanges[mergedRanges.length - 1];
      if (previousRange && range.pageStart <= previousRange.pageEnd + 1) {
        previousRange.pageEnd = Math.max(previousRange.pageEnd, range.pageEnd);
        continue;
      }
      mergedRanges.push({ ...range });
    }

    return localize('com_ui_steel_activity_missing_page_ranges', {
      fileKey,
      ranges: mergedRanges.map(formatPageRange).join(', '),
    });
  });
}

const SteelActivity = memo(function SteelActivity({
  messageId,
  isCreatedByUser,
  conversationId,
  persistedActivityEvents,
}: SteelActivityProps) {
  const localize = useLocalize();
  const chatConversationId = useContext(ChatContext)?.conversation?.conversationId;
  const liveEvents = useRecoilValue(steelNativeActivityByMessageId(messageId));
  const [isExpanded, setIsExpanded] = useState(false);

  const persistedEvents = useMemo(
    () =>
      (persistedActivityEvents ?? []).reduce<SteelNativeActivityEvent[]>(
        (current, persistedEvent) => {
          const normalized = normalizePersistedSteelActivityEvent(persistedEvent);
          return normalized ? appendSteelNativeActivityEvent(current, normalized) : current;
        },
        [],
      ),
    [persistedActivityEvents],
  );

  const allActivityEvents = useMemo(() => {
    const allEvents =
      persistedEvents.length === 0
        ? liveEvents
        : liveEvents.reduce<SteelNativeActivityEvent[]>(
            appendSteelNativeActivityEvent,
            persistedEvents,
          );
    return allEvents;
  }, [liveEvents, persistedEvents]);

  const displayEvents = useMemo(
    () => allActivityEvents.filter(shouldDisplayEvent),
    [allActivityEvents],
  );
  const latestQuotationEvent = useMemo(
    () =>
      [...allActivityEvents]
        .reverse()
        .find(
          (event): event is Extract<SteelNativeActivityEvent, { type: 'quotation_status' }> =>
            event.type === 'quotation_status',
        ),
    [allActivityEvents],
  );
  const quotationConversationId =
    conversationId ?? latestQuotationEvent?.conversationId ?? chatConversationId;
  const hasQuotationActivity = latestQuotationEvent !== undefined;

  if (isCreatedByUser || (displayEvents.length === 0 && !hasQuotationActivity)) {
    return null;
  }

  const totalCountText = getTotalCountText(displayEvents, localize);
  const missingPageTexts = getMissingPageRangeTexts(displayEvents, localize);
  const isCollapsible = displayEvents.length > collapsedActivityEventCount;
  const firstVisibleIndex =
    isCollapsible && !isExpanded ? displayEvents.length - collapsedActivityEventCount : 0;
  const visibleEvents =
    isCollapsible && !isExpanded ? displayEvents.slice(firstVisibleIndex) : displayEvents;
  const eventCountText = localize('com_ui_steel_activity_events', {
    count: displayEvents.length,
  });

  return (
    <div
      aria-label={localize('com_ui_steel_activity')}
      className="mt-1 flex flex-col gap-1 text-xs text-text-secondary"
    >
      {hasQuotationActivity && quotationConversationId && (
        <SteelQuotationProgress
          conversationId={quotationConversationId}
          event={latestQuotationEvent}
          localize={localize}
        />
      )}
      {isCollapsible && (
        <button
          type="button"
          className="inline-flex w-full items-center gap-1.5 py-1 text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
          aria-label={eventCountText}
        >
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-green-600" />
          <span className="font-medium">{eventCountText}</span>
          <ChevronDown
            className={[
              'size-4 shrink-0 text-text-secondary transition-transform duration-200 ease-out',
              isExpanded ? 'rotate-180' : '',
            ].join(' ')}
            aria-hidden="true"
          />
        </button>
      )}
      {totalCountText && (
        <div className="flex min-h-5 items-center gap-1.5 rounded-md border border-border-light bg-surface-secondary px-2 py-1 font-medium dark:border-border-medium dark:bg-surface-tertiary">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-green-600" />
          <span className="min-w-0 whitespace-normal break-words">{totalCountText}</span>
        </div>
      )}
      {missingPageTexts.length > 0 && (
        <div className="flex min-h-5 items-start gap-1.5 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-red-600 dark:border-border-medium dark:bg-surface-tertiary">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            {missingPageTexts.map((missingPageText) => (
              <div key={missingPageText} className="whitespace-normal break-words">
                {missingPageText}
              </div>
            ))}
          </div>
        </div>
      )}
      {visibleEvents.map((event, index) => {
        const eventIndex = firstVisibleIndex + index;
        const savedText = getSavedCountText(event, localize);
        const errorMessage = getErrorMessage(event);
        const hasError = Boolean(errorMessage);
        const Icon = hasError ? AlertTriangle : CheckCircle2;
        return (
          <div
            key={`${event.type}-${event.source}-${event.messageId ?? messageId}-${event.providerToolCallId ?? eventIndex}`}
            className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-border-light bg-surface-secondary px-2 py-1 dark:border-border-medium dark:bg-surface-tertiary"
          >
            <Icon
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 ${hasError ? 'text-red-600' : 'text-green-600'}`}
            />
            <span className="min-w-0 whitespace-normal break-words">
              {getActivityLabel(event, localize)}
            </span>
            {errorMessage && (
              <span className="min-w-0 whitespace-normal break-words text-red-600">
                {errorMessage}
              </span>
            )}
            {savedText && (
              <span className="min-w-0 whitespace-normal break-words text-text-tertiary">
                {savedText}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default SteelActivity;
