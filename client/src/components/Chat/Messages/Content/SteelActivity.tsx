import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { Button } from '@librechat/client';
import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle } from 'lucide-react';
import type {
  SteelFlowResume,
  SteelFlowStatus,
  SteelOcrStatus,
  SteelOcrKind,
} from 'librechat-data-provider';
import type { SteelQuotationStatus } from 'librechat-data-provider';
import type {
  SteelNativeActivityEvent,
  SteelNativeSavedCounts,
  SteelNativeTableCounts,
} from '~/store/steel';
import type { SteelQuotationFlowStatus } from '~/data-provider/Steel';
import {
  isSteelFlowExpiredError,
  useCancelSteelOcrMutation,
  useCancelSteelQuotationMutation,
  useGetSteelOcrStatusQuery,
  useGetSteelQuotationStatusQuery,
} from '~/data-provider/Steel';
import {
  appendSteelNativeActivityEvent,
  normalizePersistedSteelActivityEvent,
} from '~/hooks/SSE/useSteelEventHandler';
import { isSupersededSteelFlow, resolveEventOcrFlowStatus } from '~/data-provider/Steel/flow';
import { steelNativeActivityByMessageId } from '~/store/steel';
import useLocalize from '~/hooks/useLocalize';
import { EmptyText } from './Parts';

export type SteelFlowKind = SteelOcrKind | 'quotation';

type SteelFlowActions = {
  onResumeFlow?: (target: SteelFlowResume) => false | void;
  onRetryFlow?: (target: SteelFlowResume) => false | void;
  isSubmitting?: boolean;
};

export type SteelActivityProps = SteelFlowActions & {
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

function isQuotationPreflightWaitingStatus(
  status: SteelQuotationStatus['status'],
  stage?: string | null,
): boolean {
  return status === 'running' && stage !== 'finalizing';
}

function getQuotationStatusText(
  localize: Localize,
  status: SteelQuotationStatus['status'],
  completedChunks: number,
  totalChunks: number,
  stage?: string | null,
  chunkIndex?: number,
  repairAttempt?: number,
  maxRepairAttempts?: number,
): string {
  if (status === 'paused') {
    return localize('com_ui_steel_quote_status_paused', { completedChunks, totalChunks });
  }
  if (status === 'interrupted') {
    return localize('com_ui_steel_quote_status_interrupted');
  }
  if (status === 'failed') {
    return localize('com_ui_steel_quote_status_failed');
  }
  if (status === 'cancelled') {
    return localize('com_ui_steel_quote_status_cancelled');
  }
  if (stage === 'main_consolidating' || stage === 'aggregating') {
    return localize('com_ui_steel_quote_status_main_consolidating', {
      completedChunks,
      totalChunks,
    });
  }
  if (stage === 'main_review_started') {
    return localize('com_ui_steel_quote_status_main_review_started', {
      completedChunks,
      totalChunks,
    });
  }
  if (stage === 'main_streaming') {
    return localize('com_ui_steel_quote_status_main_responding', {
      completedChunks,
      totalChunks,
    });
  }
  if (stage === 'queued') {
    return localize('com_ui_steel_quote_status_preparing');
  }
  if (stage === 'finalizing' && status === 'running') {
    return localize('com_ui_steel_quote_status_finalizing', { completedChunks, totalChunks });
  }
  if (status === 'running') {
    const repairText = getQuotationRepairStatusText(
      localize,
      stage ?? undefined,
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
  if (status === 'completed') {
    return localize('com_ui_steel_quote_status_completed', { completedChunks, totalChunks });
  }
  return localize('com_ui_steel_quote_status_idle');
}

function getOcrStatusText(
  localize: Localize,
  status: SteelFlowStatus,
  completedChunks: number,
  totalChunks: number,
): string {
  if (status === 'running') {
    return localize('com_ui_steel_ocr_status_running', { completedChunks, totalChunks });
  }
  if (status === 'paused') {
    return localize('com_ui_steel_ocr_status_paused', { completedChunks, totalChunks });
  }
  if (status === 'interrupted') {
    return localize('com_ui_steel_ocr_status_interrupted');
  }
  if (status === 'failed') {
    return localize('com_ui_steel_ocr_status_failed');
  }
  if (status === 'completed') {
    return localize('com_ui_steel_ocr_status_completed', { completedChunks, totalChunks });
  }
  return localize('com_ui_steel_ocr_status_cancelled');
}

function getFlowActionErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return undefined;
}

export type SteelFlowCardProps = {
  kind: SteelFlowKind;
  runId?: string;
  status: SteelFlowStatus | 'idle';
  stage?: string | null;
  statusText: string;
  note?: string;
  metadataText?: string;
  errorMessage?: string | null;
  actionError?: string;
  isWarningState?: boolean;
  canCancel?: boolean;
  isCanceling?: boolean;
  isReplaying?: boolean;
  disableRecovery?: boolean;
  isSuperseded?: boolean;
  onCancel?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  localize: Localize;
};

export const SteelFlowCard = memo(function SteelFlowCard({
  kind,
  runId,
  status,
  stage,
  statusText,
  note,
  metadataText,
  errorMessage,
  actionError,
  isWarningState = false,
  canCancel = true,
  isCanceling = false,
  isReplaying = false,
  disableRecovery = false,
  isSuperseded = false,
  onCancel,
  onResume,
  onRetry,
  localize,
}: SteelFlowCardProps) {
  const cancelRequested = useRef(false);
  useEffect(() => {
    cancelRequested.current = false;
  }, [actionError, isCanceling, status, runId]);
  const isBusy = isCanceling || isReplaying;
  const isActive = status === 'running' && !isSuperseded;
  let StatusIcon = AlertTriangle;
  let statusIconClass = 'text-status-error';
  if ((isActive && !isWarningState) || isBusy) {
    StatusIcon = LoaderCircle;
    statusIconClass = 'animate-spin text-text-secondary motion-reduce:animate-none';
  } else if (status === 'completed') {
    StatusIcon = CheckCircle2;
    statusIconClass = 'text-status-success';
  }

  let flowTitleKey: LocalizeKey = 'com_ui_steel_flow_quotation';
  let regionLabelKey: LocalizeKey = 'com_ui_steel_activity_quotation';
  if (kind === 'preflight') {
    flowTitleKey = 'com_ui_steel_flow_ocr_preflight';
    regionLabelKey = 'com_ui_steel_flow_ocr_preflight';
  } else if (kind === 'delegate') {
    flowTitleKey = 'com_ui_steel_flow_ocr_delegate';
    regionLabelKey = 'com_ui_steel_flow_ocr_delegate';
  }

  const showCancel = Boolean(onCancel) && canCancel && status === 'running';
  const showResume = Boolean(onResume) && status === 'paused';
  const showRetry = Boolean(onRetry) && (status === 'interrupted' || status === 'failed');

  return (
    <div
      role="region"
      data-testid={`steel-flow-card-${kind}${runId ? `-${runId}` : ''}`}
      className="my-3 flex min-h-5 flex-col gap-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 dark:border-border-medium dark:bg-surface-tertiary"
      aria-label={localize(regionLabelKey)}
    >
      <div className="flex min-w-0 items-center gap-x-1.5 gap-y-1">
        <StatusIcon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${statusIconClass}`} />
        <span className="shrink-0 font-medium text-text-primary">{localize(flowTitleKey)}</span>
        <span className="min-w-0 flex-1 whitespace-normal break-words">
          {isSuperseded ? localize('com_ui_steel_flow_expired') : statusText}
        </span>
        {stage && (
          <span className="ms-auto shrink-0 text-text-tertiary">
            {localize('com_ui_steel_flow_stage', { stage })}
          </span>
        )}
      </div>
      {(note || metadataText || errorMessage) && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {note && (
            <span className="min-w-0 whitespace-normal break-words text-text-tertiary">{note}</span>
          )}
          {metadataText && (
            <span className="min-w-0 whitespace-normal break-words text-text-tertiary">
              {metadataText}
            </span>
          )}
          {errorMessage && (
            <span className="min-w-0 whitespace-normal break-words text-status-error">
              {errorMessage}
            </span>
          )}
        </div>
      )}
      {actionError && (
        <span role="alert" className="min-w-0 whitespace-normal break-words text-status-error">
          {actionError}
        </span>
      )}
      {(showResume || showRetry || showCancel) && (
        <div className="flex items-center justify-end gap-1.5">
          {showResume && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 py-1"
              disabled={disableRecovery || isBusy || isSuperseded}
              onClick={onResume}
            >
              {localize('com_ui_resume')}
            </Button>
          )}
          {showRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 py-1"
              disabled={disableRecovery || isBusy || isSuperseded}
              onClick={onRetry}
            >
              {localize('com_ui_retry')}
            </Button>
          )}
          {showCancel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 border-border-destructive px-2 py-1 text-text-destructive hover:bg-status-error-subtle hover:text-text-destructive"
              disabled={isBusy || isSuperseded}
              onClick={() => {
                if (cancelRequested.current) return;
                cancelRequested.current = true;
                onCancel?.();
              }}
            >
              {localize('com_ui_cancel')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

type SteelOcrFlowSummary = {
  runId: string;
  kind: SteelOcrKind;
  conversationId: string;
  flowStatus: SteelFlowStatus;
  stage?: string;
  completedChunks: number;
  totalChunks: number;
  errorMessage?: string;
};

function useFlowRecovery(
  { onResumeFlow, onRetryFlow, isSubmitting }: SteelFlowActions,
  localize: Localize,
) {
  const requested = useRef(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isSubmitting) {
      requested.current = false;
      setIsReplaying(false);
    }
  }, [isSubmitting]);

  const recover = (
    action: 'resume' | 'retry',
    target: SteelFlowResume,
    isSuperseded: boolean,
  ) => {
    const callback = action === 'resume' ? onResumeFlow : onRetryFlow;
    if (!callback || isSubmitting || isSuperseded || requested.current) return;
    requested.current = true;
    setError(undefined);
    try {
      if (callback(target) !== false) {
        setIsReplaying(true);
        return;
      }
    } catch {
      // Starting the submission can fail before the stream opens.
    }
    requested.current = false;
    setError(localize('com_ui_steel_flow_replay_unavailable'));
  };

  return { recover, isReplaying, error };
}

function SteelOcrFlowCard({
  summary,
  actions,
  localize,
}: {
  summary: SteelOcrFlowSummary;
  actions: SteelFlowActions;
  localize: Localize;
}) {
  const { conversationId, runId, kind } = summary;
  const initialData: SteelOcrStatus = {
    runId,
    kind,
    status: summary.flowStatus,
    stage: summary.stage ?? '',
    completedChunks: summary.completedChunks,
    totalChunks: summary.totalChunks,
    errorMessage: summary.errorMessage ?? null,
    latestRunId: runId,
  };
  const query = useGetSteelOcrStatusQuery(conversationId, runId, kind, initialData);
  const cancel = useCancelSteelOcrMutation(conversationId);
  const recovery = useFlowRecovery(actions, localize);
  const data = query.data ?? initialData;
  const { status, stage, completedChunks, totalChunks, errorMessage } = data;
  const isSuperseded =
    isSupersededSteelFlow(data) ||
    isSteelFlowExpiredError(query.error) ||
    isSteelFlowExpiredError(cancel.error);
  const cancelError = getFlowActionErrorMessage(cancel.error);
  const actionError =
    recovery.error ??
    (cancelError ? localize('com_ui_steel_ocr_cancel_failed', { error: cancelError }) : undefined);

  return (
    <SteelFlowCard
      kind={kind}
      runId={runId}
      status={status}
      stage={stage}
      statusText={getOcrStatusText(localize, status, completedChunks, totalChunks)}
      errorMessage={errorMessage}
      actionError={isSuperseded ? undefined : actionError}
      isSuperseded={isSuperseded}
      isCanceling={cancel.isLoading}
      isReplaying={recovery.isReplaying}
      disableRecovery={
        actions.isSubmitting || !(status === 'paused' ? actions.onResumeFlow : actions.onRetryFlow)
      }
      onCancel={() => cancel.mutate(runId)}
      onResume={() => recovery.recover('resume', { kind, runId }, isSuperseded)}
      onRetry={() => recovery.recover('retry', { kind, runId }, isSuperseded)}
      localize={localize}
    />
  );
}

function SteelQuotationProgress({
  conversationId,
  actions,
  event,
  localize,
}: {
  conversationId: string;
  actions: SteelFlowActions;
  event: Extract<SteelNativeActivityEvent, { type: 'quotation_status' }>;
  localize: Localize;
}) {
  const runKey = event.runId ?? `legacy:${event.index}`;
  const initialData: SteelQuotationFlowStatus = {
    ...event,
    note: event.message,
    canCancel: event.status === 'running',
  };
  const query = useGetSteelQuotationStatusQuery(conversationId, runKey, initialData);
  const cancel = useCancelSteelQuotationMutation(conversationId);
  const recovery = useFlowRecovery(actions, localize);
  const mismatchedQuery = Boolean(
    query.data &&
      (query.data.index !== event.index || (event.runId && query.data.runId !== event.runId)),
  );
  const data = mismatchedQuery ? initialData : query.data ?? initialData;
  const { index, status, runId, stage, completedChunks, totalChunks, ocrSource } = data;
  const isSuperseded =
    mismatchedQuery ||
    isSupersededSteelFlow(data) ||
    isSteelFlowExpiredError(query.error) ||
    isSteelFlowExpiredError(cancel.error);
  const cancelError = getFlowActionErrorMessage(cancel.error);
  const actionError =
    recovery.error ??
    (cancelError ? localize('com_ui_steel_quote_cancel_failed', { error: cancelError }) : undefined);
  const repairFailed = stage === 'chunk_repair_failed';
  const showProgress =
    !isSuperseded && !repairFailed && isQuotationPreflightWaitingStatus(status, stage);
  const statusText = getQuotationStatusText(
    localize,
    status,
    completedChunks,
    totalChunks,
    stage,
    data.chunkIndex,
    data.repairAttempt,
    data.maxRepairAttempts,
  );
  const metadataText = ocrSource
    ? localize(
        ocrSource.source === 'ai' ? 'com_ui_steel_quote_source_ai' : 'com_ui_steel_quote_source_human',
        { version: ocrSource.version },
      )
    : undefined;

  return (
    <>
      <SteelFlowCard
        kind="quotation"
        runId={runId}
        status={status}
        stage={stage}
        statusText={statusText}
        note={data.note}
        metadataText={metadataText}
        errorMessage={
          data.errorMessage === 'quotation_unpublished'
            ? localize('com_ui_steel_quote_unpublished')
            : data.errorMessage
        }
        actionError={isSuperseded ? undefined : actionError}
        isWarningState={repairFailed}
        isSuperseded={isSuperseded}
        canCancel={data.canCancel && index !== null}
        isCanceling={cancel.isLoading}
        isReplaying={recovery.isReplaying}
        disableRecovery={
          !runId ||
          actions.isSubmitting ||
          !(status === 'paused' ? actions.onResumeFlow : actions.onRetryFlow)
        }
        onCancel={() => index !== null && cancel.mutate(index)}
        onResume={() =>
          runId && recovery.recover('resume', { kind: 'quotation', runId }, isSuperseded)
        }
        onRetry={() =>
          runId && recovery.recover('retry', { kind: 'quotation', runId }, isSuperseded)
        }
        localize={localize}
      />
      {showProgress && (
        <div className="relative min-h-8 overflow-visible ps-2 pt-2">
          <EmptyText />
        </div>
      )}
    </>
  );
}

type SteelCountedEvent = Extract<
  SteelNativeActivityEvent,
  { type: 'parse_status' | 'memory_saved' }
>;
type SteelEventCounts = Partial<
  Pick<
    SteelCountedEvent,
    'savedCounts' | 'savedTableCounts' | 'totalSavedCounts' | 'totalTableCounts'
  >
>;

/** Only parse and memory events carry saved-record counts. */
function getEventCounts(event: SteelNativeActivityEvent | undefined): SteelEventCounts {
  return event?.type === 'parse_status' || event?.type === 'memory_saved' ? event : {};
}

function getSavedCountTotal(event: SteelNativeActivityEvent): number {
  return Object.values(getEventCounts(event).savedCounts ?? {}).reduce((total, count) => {
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

  const counts = getEventCounts(event);
  const sourceCounts = getCountTexts({
    savedCounts: counts.savedCounts,
    tableCounts: counts.savedTableCounts,
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
    const counts = getEventCounts(events[index]);
    const sourceCounts = getCountTexts({
      savedCounts: counts.totalSavedCounts,
      tableCounts: counts.totalTableCounts,
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
    return event.stage !== 'queued';
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

function extractOcrFlowSummaries(
  events: readonly SteelNativeActivityEvent[],
  fallbackConversationId?: string | null,
): SteelOcrFlowSummary[] {
  const summariesByRunId = new Map<string, SteelOcrFlowSummary>();
  for (const event of events) {
    if (event.type !== 'parse_status' && event.type !== 'delegate_ocr_status') {
      continue;
    }
    if (
      event.type === 'parse_status' &&
      event.source !== 'ocr_preprocessing' &&
      event.source !== 'paddleocr_preflight'
    ) {
      continue;
    }
    const runId = event.runId?.trim();
    const resolvedConversationId = (event.conversationId ?? fallbackConversationId ?? '').trim();
    if (!runId || !resolvedConversationId) {
      continue;
    }
    const kind: SteelOcrKind =
      event.kind ?? (event.type === 'delegate_ocr_status' ? 'delegate' : 'preflight');
    const eventStatus = resolveEventOcrFlowStatus(event);
    const existing = summariesByRunId.get(runId);
    if (!existing) {
      summariesByRunId.set(runId, {
        runId,
        kind,
        conversationId: resolvedConversationId,
        flowStatus: eventStatus,
        stage: event.stage,
        completedChunks: event.completedChunks ?? 0,
        totalChunks: event.totalChunks ?? 0,
        errorMessage: event.errorMessage,
      });
      continue;
    }
    const isExistingTerminal =
      existing.flowStatus === 'completed' || existing.flowStatus === 'cancelled';
    const isIncomingTerminal = eventStatus === 'completed' || eventStatus === 'cancelled';
    if (isExistingTerminal && !isIncomingTerminal) {
      continue;
    }
    summariesByRunId.set(runId, {
      ...existing,
      flowStatus: eventStatus,
      stage: event.stage ?? existing.stage,
      completedChunks: Math.max(existing.completedChunks, event.completedChunks ?? 0),
      totalChunks: Math.max(existing.totalChunks, event.totalChunks ?? 0),
      errorMessage: event.errorMessage ?? existing.errorMessage,
    });
  }
  return [...summariesByRunId.values()];
}

export function isSteelFlowActiveInEvents(
  events: readonly SteelNativeActivityEvent[],
  conversationId?: string | null,
): boolean {
  const latestQuotationEvent = [...events]
    .reverse()
    .find(
      (event): event is Extract<SteelNativeActivityEvent, { type: 'quotation_status' }> =>
        event.type === 'quotation_status' &&
        (!conversationId || !event.conversationId || event.conversationId === conversationId),
    );
  if (latestQuotationEvent?.status === 'running') {
    return true;
  }

  const ocrSummaries = extractOcrFlowSummaries(events, conversationId);
  if (ocrSummaries.some((summary) => summary.flowStatus === 'running')) {
    return true;
  }

  const latestOcrEvent = [...events]
    .reverse()
    .find(
      (
        event,
      ): event is Extract<
        SteelNativeActivityEvent,
        { type: 'parse_status' | 'delegate_ocr_status' }
      > =>
        (event.type === 'delegate_ocr_status' ||
          (event.type === 'parse_status' &&
            (event.source === 'ocr_preprocessing' || event.source === 'paddleocr_preflight'))) &&
        (!conversationId || !event.conversationId || event.conversationId === conversationId),
    );
  if (!latestOcrEvent) {
    return false;
  }
  return resolveEventOcrFlowStatus(latestOcrEvent) === 'running';
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
  ...actions
}: SteelActivityProps) {
  const localize = useLocalize();
  const [isExpanded, setIsExpanded] = useState(false);
  const allActivityEvents = useSteelActivityEvents(messageId, persistedActivityEvents);

  const displayEvents = useMemo(
    () => allActivityEvents.filter(shouldDisplayEvent),
    [allActivityEvents],
  );
  const ocrFlowSummaries = useMemo(
    () => extractOcrFlowSummaries(allActivityEvents, conversationId),
    [allActivityEvents, conversationId],
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
    conversationId ?? latestQuotationEvent?.conversationId;
  const hasQuotationActivity = latestQuotationEvent !== undefined;
  const hasOcrFlowActivity = ocrFlowSummaries.length > 0;

  if (
    isCreatedByUser ||
    (displayEvents.length === 0 && !hasQuotationActivity && !hasOcrFlowActivity)
  ) {
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
      {ocrFlowSummaries.map((summary) => (
        <SteelOcrFlowCard
          key={summary.runId}
          summary={summary}
          actions={actions}
          localize={localize}
        />
      ))}
      {latestQuotationEvent && quotationConversationId && (
        <SteelQuotationProgress
          key={latestQuotationEvent.runId ?? latestQuotationEvent.index}
          conversationId={quotationConversationId}
          actions={actions}
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
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-status-success" />
          <span className="font-medium">{eventCountText}</span>
          <ChevronDown
            className={[
              'size-4 shrink-0 text-text-secondary transition-transform duration-200 ease-out motion-reduce:transition-none',
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
        <div className="flex min-h-5 items-start gap-1.5 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-status-error dark:border-border-medium dark:bg-surface-tertiary">
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
              className={`h-3.5 w-3.5 shrink-0 ${hasError ? 'text-status-error' : 'text-status-success'}`}
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
              <span className="min-w-0 whitespace-normal break-words text-status-error">
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
