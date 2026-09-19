import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
import { EmptyText } from './Parts';

type SteelActivityProps = {
  messageId: string;
  isCreatedByUser?: boolean;
  conversationId?: string | null;
  persistedActivityEvents?: readonly unknown[];
};

type Localize = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<Localize>[0];

export function useSteelActivityEvents(
  messageId: string,
  persistedActivityEvents?: readonly unknown[],
): SteelNativeActivityEvent[] {
  const liveEvents = useRecoilValue(steelNativeActivityByMessageId(messageId));
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

  return useMemo(() => {
    if (persistedEvents.length === 0) {
      return liveEvents;
    }
    return liveEvents.reduce<SteelNativeActivityEvent[]>(
      appendSteelNativeActivityEvent,
      persistedEvents,
    );
  }, [liveEvents, persistedEvents]);
}

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
const quotationRepairStages = new Set([
  'chunk_repair_started',
  'chunk_repair_succeeded',
  'chunk_repair_failed',
]);

function isQuotationRepairFailure(event?: SteelNativeActivityEvent): boolean {
  return event?.type === 'quotation_status' && event.stage === 'chunk_repair_failed';
}

function getQuotationRepairStatusText(
  localize: Localize,
  stage: string | undefined,
  chunkIndex: number | undefined,
  repairAttempt: number | undefined,
  maxRepairAttempts: number | undefined,
  completedChunks: number,
  totalChunks: number,
): string | undefined {
  if (!stage || !quotationRepairStages.has(stage) || chunkIndex === undefined) {
    return undefined;
  }

  const options = {
    chunkIndex,
    repairAttempt: repairAttempt ?? '',
    maxRepairAttempts: maxRepairAttempts ?? '',
    completedChunks,
    totalChunks,
  };
  if (stage === 'chunk_repair_started') {
    return localize('com_ui_steel_quote_status_chunk_repair_started', options);
  }
  if (stage === 'chunk_repair_succeeded') {
    return localize('com_ui_steel_quote_status_chunk_repair_succeeded', options);
  }
  return localize('com_ui_steel_quote_status_chunk_repair_failed', options);
}

function isQuotationCancellableStatus(status: SteelQuotationStatus['status']): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'aggregating' ||
    status === 'finalizing' ||
    status === 'interrupted'
  );
}

function isQuotationActiveStatus(status: SteelQuotationStatus['status']): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'aggregating' ||
    status === 'finalizing'
  );
}

function isQuotationPreflightWaitingStatus(status: SteelQuotationStatus['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'aggregating';
}

function getQuotationStatusText(
  localize: Localize,
  status: SteelQuotationStatus['status'],
  completedChunks: number,
  totalChunks: number,
  stage?: string,
  chunkIndex?: number,
  repairAttempt?: number,
  maxRepairAttempts?: number,
): string {
  if (status === 'aggregating' && stage === 'main_review_started') {
    return localize('com_ui_steel_quote_status_main_review_started', {
      completedChunks,
      totalChunks,
    });
  }
  if (status === 'aggregating' && stage === 'main_streaming') {
    return localize('com_ui_steel_quote_status_main_responding', {
      completedChunks,
      totalChunks,
    });
  }
  if (status === 'queued') {
    return localize('com_ui_steel_quote_status_queued');
  }
  if (status === 'running') {
    const repairText = getQuotationRepairStatusText(
      localize,
      stage,
      chunkIndex,
      repairAttempt,
      maxRepairAttempts,
      completedChunks,
      totalChunks,
    );
    if (repairText) {
      return repairText;
    }
    if (chunkIndex !== undefined && stage === 'chunk') {
      return localize('com_ui_steel_quote_status_chunk_running', {
        chunkIndex,
        completedChunks,
        totalChunks,
      });
    }
    if (chunkIndex !== undefined && stage === 'chunk_started') {
      return localize('com_ui_steel_quote_status_chunk_started', {
        chunkIndex,
        completedChunks,
        totalChunks,
      });
    }
    if (chunkIndex !== undefined && stage === 'chunk_saved') {
      return localize('com_ui_steel_quote_status_chunk_saved', {
        chunkIndex,
        completedChunks,
        totalChunks,
      });
    }
    return localize('com_ui_steel_quote_status_running', { completedChunks, totalChunks });
  }
  if (status === 'aggregating') {
    return localize('com_ui_steel_quote_status_main_consolidating', {
      completedChunks,
      totalChunks,
    });
  }
  if (status === 'finalizing') {
    return localize('com_ui_steel_quote_status_finalizing', { completedChunks, totalChunks });
  }
  if (status === 'interrupted') {
    return localize('com_ui_steel_quote_status_interrupted');
  }
  if (status === 'completed') {
    return localize('com_ui_steel_quote_status_completed', { completedChunks, totalChunks });
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

function getQuotationRetryError(error: unknown, localize: Localize): string {
  return getQuotationCancelError(error) ?? localize('com_ui_steel_quote_retry_status_failed');
}

type SteelQuotationProgressProps = {
  conversationId: string;
  messageId: string;
  event?: Extract<SteelNativeActivityEvent, { type: 'quotation_status' }>;
  localize: Localize;
  showLoadingDot: boolean;
};

const SteelQuotationProgress = memo(function SteelQuotationProgress({
  conversationId,
  messageId,
  event,
  localize,
  showLoadingDot,
}: SteelQuotationProgressProps) {
  const quotationQuery = useGetSteelQuotationStatusQuery(conversationId);
  const cancelMutation = useCancelSteelQuotationMutation(conversationId);
  const chat = useContext(ChatContext);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRetryDispatched, setIsRetryDispatched] = useState(false);
  const [retryError, setRetryError] = useState<string | undefined>();
  const retryInFlightRef = useRef(false);
  const retryDispatchedRef = useRef(false);
  const retrySubmissionStartedRef = useRef(false);
  const retryRunRef = useRef<{ index: number; runId?: string } | null>(null);
  const currentConversationIdRef = useRef(chat?.conversation?.conversationId);
  const isSubmittingRef = useRef(chat?.isSubmitting ?? false);
  currentConversationIdRef.current = chat?.conversation?.conversationId;
  isSubmittingRef.current = chat?.isSubmitting ?? false;
  const queryData = quotationQuery.data;
  const hasMismatchedQuery = Boolean(
    event &&
      queryData &&
      (event.index !== queryData.index ||
        (event.runId !== undefined && event.runId !== queryData.runId)),
  );
  const terminalEventWins = Boolean(
    event &&
      queryData &&
      !hasMismatchedQuery &&
      (event.status === 'completed' || event.status === 'cancelled'),
  );
  let status = queryData ?? event;
  if (hasMismatchedQuery || terminalEventWins) {
    status = event;
  }
  const statusIndex = status?.index;
  const statusRunId = status?.runId;
  const statusName = status?.status;

  useEffect(() => {
    setRetryError(undefined);
    const retryRun = retryRunRef.current;
    const hasRunChanged =
      retryRun &&
      (statusName !== 'interrupted' ||
        statusIndex !== retryRun.index ||
        statusRunId !== retryRun.runId);
    if (retryDispatchedRef.current && isSubmittingRef.current) {
      retrySubmissionStartedRef.current = true;
    }
    if (
      hasRunChanged ||
      (retryDispatchedRef.current && retrySubmissionStartedRef.current && !isSubmittingRef.current)
    ) {
      retryDispatchedRef.current = false;
      setIsRetryDispatched(false);
      retrySubmissionStartedRef.current = false;
      retryRunRef.current = null;
    }
  }, [chat?.isSubmitting, statusIndex, statusName, statusRunId]);

  if (!status) {
    return null;
  }

  const sameRunProgress =
    !hasMismatchedQuery && event?.runId !== undefined && event.runId === queryData?.runId;
  const completedChunks = sameRunProgress
    ? Math.max(status.completedChunks, event.completedChunks)
    : status.completedChunks;
  const totalChunks = sameRunProgress
    ? Math.max(status.totalChunks, event.totalChunks)
    : status.totalChunks;
  const index = status.index ?? event?.index ?? null;
  const canCancel =
    !hasMismatchedQuery &&
    !terminalEventWins &&
    (queryData?.canCancel ?? isQuotationCancellableStatus(status.status));
  const isCurrentConversation = currentConversationIdRef.current === conversationId;
  const canRetry =
    isCurrentConversation && canCancel && status.status === 'interrupted' && index !== null;
  let cancelError: string | undefined;
  if (!hasMismatchedQuery && !terminalEventWins) {
    cancelError = getQuotationCancelError(cancelMutation.error);
  }
  const statusText = getQuotationStatusText(
    localize,
    status.status,
    completedChunks,
    totalChunks,
    event?.stage,
    event?.chunkIndex,
    event?.repairAttempt,
    event?.maxRepairAttempts,
  );
  const isCanceling = cancelMutation.isLoading;
  const repairFailed = isQuotationRepairFailure(event);
  const shouldShowLoadingDot =
    showLoadingDot &&
    !hasMismatchedQuery &&
    isQuotationPreflightWaitingStatus(status.status) &&
    !repairFailed &&
    (queryData == null || isQuotationPreflightWaitingStatus(queryData.status));
  const isActive = isQuotationActiveStatus(status.status);
  let StatusIcon = AlertTriangle;
  let statusIconClass = 'text-status-error';
  if ((isActive && !repairFailed) || isCanceling || isRetrying) {
    StatusIcon = LoaderCircle;
    statusIconClass = 'animate-spin text-text-secondary';
  } else if (status.status === 'completed') {
    StatusIcon = CheckCircle2;
    statusIconClass = 'text-status-success';
  }

  const retryQuotation = async () => {
    if (
      !canRetry ||
      retryInFlightRef.current ||
      isRetrying ||
      retryDispatchedRef.current ||
      isSubmittingRef.current ||
      !chat ||
      currentConversationIdRef.current !== conversationId
    ) {
      return;
    }

    retryInFlightRef.current = true;
    setIsRetrying(true);
    setRetryError(undefined);
    try {
      const expectedIndex = index;
      const expectedRunId = status.runId ?? event?.runId;
      const refetchResult = await quotationQuery.refetch();
      const freshStatus = refetchResult.data;
      if (refetchResult.isError) {
        setRetryError(getQuotationRetryError(refetchResult.error, localize));
        return;
      }
      if (
        !freshStatus ||
        freshStatus.conversationId !== conversationId ||
        freshStatus.index !== expectedIndex ||
        freshStatus.status !== 'interrupted' ||
        (expectedRunId !== undefined && freshStatus.runId !== expectedRunId) ||
        currentConversationIdRef.current !== conversationId ||
        isSubmittingRef.current
      ) {
        return;
      }

      const messages = chat.getMessages(conversationId);
      const assistantMessage = messages?.find(
        (message) => message.messageId === messageId && message.isCreatedByUser !== true,
      );
      const parentMessage = assistantMessage?.parentMessageId
        ? messages?.find(
            (message) =>
              message.messageId === assistantMessage.parentMessageId &&
              message.isCreatedByUser === true,
          )
        : undefined;
      if (!assistantMessage || !parentMessage) {
        return;
      }

      if (chat.regenerate(assistantMessage) === false) {
        setRetryError(localize('com_ui_steel_quote_retry_unavailable'));
        return;
      }
      retryDispatchedRef.current = true;
      setIsRetryDispatched(true);
      retrySubmissionStartedRef.current = false;
      retryRunRef.current = { index: expectedIndex, runId: expectedRunId };
    } catch (error) {
      setRetryError(getQuotationRetryError(error, localize));
    } finally {
      retryInFlightRef.current = false;
      setIsRetrying(false);
    }
  };
  const actionError = status.status === 'interrupted' ? retryError : cancelError;

  return (
    <>
      <div
        className="my-3 flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 dark:border-border-medium dark:bg-surface-tertiary"
        aria-label={localize('com_ui_steel_activity_quotation')}
      >
        <StatusIcon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${statusIconClass}`} />
        <span className="min-w-0 flex-1 whitespace-normal break-words">{statusText}</span>
        {event?.message && (
          <span className="min-w-0 whitespace-normal break-words text-text-tertiary">
            {event.message}
          </span>
        )}
        {!hasMismatchedQuery &&
          !terminalEventWins &&
          (status.status === 'interrupted' || canCancel) &&
          index !== null &&
          status.status !== 'completed' &&
          status.status !== 'cancelled' &&
          (status.status === 'interrupted' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ms-auto h-7 shrink-0 px-2 py-1"
              disabled={!canRetry || isRetrying || isRetryDispatched || isSubmittingRef.current}
              onClick={retryQuotation}
            >
              {isRetrying ? localize('com_ui_steel_quote_retrying') : localize('com_ui_retry')}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ms-auto h-7 shrink-0 px-2 py-1"
              disabled={isCanceling}
              onClick={() => cancelMutation.mutate(index)}
            >
              {isCanceling
                ? localize('com_ui_steel_quote_canceling')
                : localize('com_ui_steel_quote_cancel')}
            </Button>
          ))}
        {actionError && (
          <span className="min-w-0 whitespace-normal break-words text-status-error">
            {localize(
              status.status === 'interrupted'
                ? 'com_ui_steel_quote_retry_failed'
                : 'com_ui_steel_quote_cancel_failed',
              { error: actionError },
            )}
          </span>
        )}
      </div>
      {shouldShowLoadingDot && (
        <div className="relative min-h-8 overflow-visible ps-2 pt-2">
          <EmptyText />
        </div>
      )}
    </>
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
    if (event.stage === 'started') {
      return localize('com_ui_steel_quote_status_started', {
        completedChunks: event.completedChunks,
        totalChunks: event.totalChunks,
      });
    }

    if (event.stage === 'chunk_started' && event.chunkIndex !== undefined) {
      return localize('com_ui_steel_quote_status_chunk_started', {
        chunkIndex: event.chunkIndex,
        completedChunks: event.completedChunks,
        totalChunks: event.totalChunks,
      });
    }

    if (event.stage === 'chunk_saved' && event.chunkIndex !== undefined) {
      return localize('com_ui_steel_quote_status_chunk_saved', {
        chunkIndex: event.chunkIndex,
        completedChunks: event.completedChunks,
        totalChunks: event.totalChunks,
      });
    }

    return getQuotationStatusText(
      localize,
      event.status,
      event.completedChunks,
      event.totalChunks,
      event.stage,
      event.chunkIndex,
      event.repairAttempt,
      event.maxRepairAttempts,
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
    return event.status !== 'queued';
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
  const [isExpanded, setIsExpanded] = useState(false);
  const allActivityEvents = useSteelActivityEvents(messageId, persistedActivityEvents);

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
  const showQuotationLoadingDot = Boolean(
    latestQuotationEvent &&
      isQuotationPreflightWaitingStatus(latestQuotationEvent.status) &&
      !isQuotationRepairFailure(latestQuotationEvent),
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
          messageId={messageId}
          event={latestQuotationEvent}
          localize={localize}
          showLoadingDot={showQuotationLoadingDot}
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
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-status-success" />
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
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-status-success" />
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
        const quotationNote = event.type === 'quotation_status' ? event.message : undefined;
        const hasError = Boolean(errorMessage) || isQuotationRepairFailure(event);
        const Icon = hasError ? AlertTriangle : CheckCircle2;
        return (
          <div
            key={`${event.type}-${event.source}-${event.messageId ?? messageId}-${event.providerToolCallId ?? eventIndex}`}
            className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-border-light bg-surface-secondary px-2 py-1 dark:border-border-medium dark:bg-surface-tertiary"
          >
            <Icon
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 ${hasError ? 'text-red-600' : 'text-status-success'}`}
            />
            <span className="min-w-0 whitespace-normal break-words">
              {getActivityLabel(event, localize)}
            </span>
            {quotationNote && (
              <span
                className={`min-w-0 whitespace-normal break-words ${
                  isQuotationRepairFailure(event) ? 'text-status-error' : 'text-text-tertiary'
                }`}
              >
                {quotationNote}
              </span>
            )}
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
