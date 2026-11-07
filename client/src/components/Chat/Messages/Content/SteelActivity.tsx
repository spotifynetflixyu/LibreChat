import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { Button } from '@librechat/client';
import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle } from 'lucide-react';
import type {
  SteelFlowStatus,
  SteelOcrKind,
  SteelQuotationStatus,
} from 'librechat-data-provider';
import type {
  SteelNativeActivityEvent,
  SteelNativeSavedCounts,
  SteelNativeTableCounts,
} from '~/store/steel';
import {
  isSteelFlowExpiredError,
  useCancelSteelOcrMutation,
  useCancelSteelQuotationMutation,
  useGetSteelOcrStatusQuery,
  useGetSteelQuotationStatusQuery,
  usePauseSteelOcrMutation,
  usePauseSteelQuotationMutation,
} from '~/data-provider/Steel';
import {
  appendSteelNativeActivityEvent,
  normalizePersistedSteelActivityEvent,
} from '~/hooks/SSE/useSteelEventHandler';
import { steelNativeActivityByMessageId } from '~/store/steel';
import useLocalize from '~/hooks/useLocalize';
import { ChatContext } from '~/Providers';
import { EmptyText } from './Parts';

export type SteelFlowKind = SteelOcrKind | 'quotation';

export type SteelFlowActionTarget = {
  kind: SteelFlowKind;
  runId: string;
  index?: number;
};

export type SteelActivityProps = {
  messageId: string;
  isCreatedByUser?: boolean;
  conversationId?: string | null;
  persistedActivityEvents?: readonly unknown[];
  onResumeFlow?: (target: SteelFlowActionTarget) => void;
  onRetryFlow?: (target: SteelFlowActionTarget) => void;
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
    status === 'running' ||
    status === 'paused' ||
    status === 'interrupted' ||
    status === 'failed'
  );
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

function getQuotationRetryError(error: unknown, localize: Localize): string {
  return getFlowActionErrorMessage(error) ?? localize('com_ui_steel_quote_retry_status_failed');
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
  canPause?: boolean;
  canCancel?: boolean;
  canResume?: boolean;
  canRetry?: boolean;
  isPausing?: boolean;
  isCanceling?: boolean;
  isResuming?: boolean;
  isRetrying?: boolean;
  disableRetry?: boolean;
  onPause?: () => void;
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
  canPause = false,
  canCancel = false,
  canResume = false,
  canRetry = false,
  isPausing = false,
  isCanceling = false,
  isResuming = false,
  isRetrying = false,
  disableRetry = false,
  onPause,
  onCancel,
  onResume,
  onRetry,
  localize,
}: SteelFlowCardProps) {
  const isBusy = isPausing || isCanceling || isResuming || isRetrying;
  const isActive = status === 'running';
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

  const showPause = Boolean(onPause) && canPause;
  const showCancel = Boolean(onCancel) && canCancel;
  const showResume = Boolean(onResume) && canResume;
  const showRetry = Boolean(onRetry) && canRetry;

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
        <span className="min-w-0 flex-1 whitespace-normal break-words">{statusText}</span>
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
      {(showResume || showRetry || showPause || showCancel) && (
        <div className="flex items-center justify-end gap-1.5">
          {showResume && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 py-1"
              disabled={isBusy}
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
              disabled={disableRetry || isBusy}
              onClick={onRetry}
            >
              {localize('com_ui_retry')}
            </Button>
          )}
          {showPause && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 py-1"
              disabled={isBusy}
              onClick={onPause}
            >
              {localize('com_ui_pause')}
            </Button>
          )}
          {showCancel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 border-border-destructive px-2 py-1 text-text-destructive hover:bg-status-error-subtle hover:text-text-destructive"
              disabled={isBusy}
              onClick={onCancel}
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

type SteelOcrFlowCardProps = {
  summary: SteelOcrFlowSummary;
  localize: Localize;
  onResumeFlow?: (target: SteelFlowActionTarget) => void;
  onRetryFlow?: (target: SteelFlowActionTarget) => void;
};

const SteelOcrFlowCard = memo(function SteelOcrFlowCard({
  summary,
  localize,
  onResumeFlow,
  onRetryFlow,
}: SteelOcrFlowCardProps) {
  const { conversationId, runId, kind } = summary;
  const ocrQuery = useGetSteelOcrStatusQuery(conversationId, runId);
  const pauseMutation = usePauseSteelOcrMutation(conversationId);
  const cancelMutation = useCancelSteelOcrMutation(conversationId);
  const pauseInFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);

  const queryData = ocrQuery?.data;
  const isMatchingQuery = Boolean(
    queryData && queryData.runId === runId && queryData.kind === kind,
  );
  const terminalEventWins = Boolean(
    isMatchingQuery &&
      (summary.flowStatus === 'completed' || summary.flowStatus === 'cancelled') &&
      queryData?.status !== 'completed' &&
      queryData?.status !== 'cancelled',
  );
  const status: SteelFlowStatus =
    !isMatchingQuery || terminalEventWins || !queryData ? summary.flowStatus : queryData.status;
  const stage =
    !isMatchingQuery || terminalEventWins || !queryData
      ? summary.stage
      : (queryData.stage ?? summary.stage);
  const completedChunks = isMatchingQuery && queryData
    ? Math.max(queryData.completedChunks, summary.completedChunks)
    : summary.completedChunks;
  const totalChunks = isMatchingQuery && queryData
    ? Math.max(queryData.totalChunks, summary.totalChunks)
    : summary.totalChunks;
  const errorMessage = isMatchingQuery && queryData
    ? (queryData.errorMessage ?? summary.errorMessage)
    : summary.errorMessage;

  const isExpiredByQuery = Boolean(
    isMatchingQuery && queryData?.latestRunId && queryData.latestRunId !== runId,
  );
  const isExpiredByMutation =
    isSteelFlowExpiredError(pauseMutation?.error) ||
    isSteelFlowExpiredError(cancelMutation?.error);
  const isSuperseded = isExpiredByQuery || isExpiredByMutation;
  const isTerminal = status === 'completed' || status === 'cancelled';

  const isPausing = Boolean(pauseMutation?.isLoading);
  const isCanceling = Boolean(cancelMutation?.isLoading);

  useEffect(() => {
    pauseInFlightRef.current = false;
  }, [isPausing, pauseMutation?.error, status, runId]);

  useEffect(() => {
    cancelInFlightRef.current = false;
  }, [isCanceling, cancelMutation?.error, status, runId]);

  const canPause = !isSuperseded && !isTerminal && status === 'running';
  const canCancel =
    !isSuperseded &&
    !isTerminal &&
    (status === 'running' ||
      status === 'paused' ||
      status === 'interrupted' ||
      status === 'failed');
  const canResume =
    !isSuperseded &&
    !isTerminal &&
    Boolean(onResumeFlow) &&
    (status === 'paused' || status === 'interrupted');
  const canRetry =
    !isSuperseded && !isTerminal && Boolean(onRetryFlow) && status === 'failed';

  let actionError: string | undefined;
  if (isExpiredByMutation) {
    actionError = localize('com_ui_steel_flow_expired');
  } else if (pauseMutation?.error) {
    const message = getFlowActionErrorMessage(pauseMutation.error);
    if (message) {
      actionError = localize('com_ui_steel_ocr_pause_failed', { error: message });
    }
  } else if (cancelMutation?.error) {
    const message = getFlowActionErrorMessage(cancelMutation.error);
    if (message) {
      actionError = localize('com_ui_steel_ocr_cancel_failed', { error: message });
    }
  }

  const handlePause = () => {
    if (!canPause || pauseInFlightRef.current || isPausing || isCanceling) {
      return;
    }
    pauseInFlightRef.current = true;
    pauseMutation.mutate(runId);
  };

  const handleCancel = () => {
    if (!canCancel || cancelInFlightRef.current || isCanceling || isPausing) {
      return;
    }
    cancelInFlightRef.current = true;
    cancelMutation.mutate(runId);
  };

  return (
    <SteelFlowCard
      kind={kind}
      runId={runId}
      status={status}
      stage={stage}
      statusText={getOcrStatusText(localize, status, completedChunks, totalChunks)}
      errorMessage={errorMessage}
      actionError={actionError}
      canPause={canPause}
      canCancel={canCancel}
      canResume={canResume}
      canRetry={canRetry}
      isPausing={isPausing}
      isCanceling={isCanceling}
      onPause={handlePause}
      onCancel={handleCancel}
      onResume={onResumeFlow ? () => onResumeFlow({ kind, runId }) : undefined}
      onRetry={onRetryFlow ? () => onRetryFlow({ kind, runId }) : undefined}
      localize={localize}
    />
  );
});

type SteelQuotationProgressProps = {
  conversationId: string;
  messageId: string;
  event?: Extract<SteelNativeActivityEvent, { type: 'quotation_status' }>;
  localize: Localize;
  showLoadingDot: boolean;
  onResumeFlow?: (target: SteelFlowActionTarget) => void;
  onRetryFlow?: (target: SteelFlowActionTarget) => void;
};

const SteelQuotationProgress = memo(function SteelQuotationProgress({
  conversationId,
  messageId,
  event,
  localize,
  showLoadingDot,
  onResumeFlow,
  onRetryFlow,
}: SteelQuotationProgressProps) {
  const quotationQuery = useGetSteelQuotationStatusQuery(conversationId);
  const pauseMutation = usePauseSteelQuotationMutation?.(conversationId);
  const cancelMutation = useCancelSteelQuotationMutation(conversationId);
  const chat = useContext(ChatContext);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRetryDispatched, setIsRetryDispatched] = useState(false);
  const [retryError, setRetryError] = useState<string | undefined>();
  const retryInFlightRef = useRef(false);
  const retryDispatchedRef = useRef(false);
  const retrySubmissionStartedRef = useRef(false);
  const retryRunRef = useRef<{ index: number; runId?: string } | null>(null);
  const pauseInFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);
  const currentConversationIdRef = useRef(chat?.conversation?.conversationId);
  const isSubmittingRef = useRef(chat?.isSubmitting ?? false);
  currentConversationIdRef.current = chat?.conversation?.conversationId;
  isSubmittingRef.current = chat?.isSubmitting ?? false;
  const queryData = quotationQuery.data;
  const hasMismatchedQuery = Boolean(
    event &&
      queryData &&
      (event.conversationId !== queryData.conversationId ||
        event.index !== queryData.index ||
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
  const sameRunQuery = Boolean(
    queryData &&
      event &&
      event.conversationId === conversationId &&
      queryData.conversationId === conversationId &&
      event.index === queryData.index &&
      event.runId !== undefined &&
      event.runId === queryData.runId,
  );
  let ocrSource = event?.conversationId === conversationId ? event.ocrSource : undefined;
  if (sameRunQuery) ocrSource = queryData?.ocrSource ?? ocrSource;

  const isPausing = Boolean(pauseMutation?.isLoading);
  const isCanceling = Boolean(cancelMutation?.isLoading);

  useEffect(() => {
    pauseInFlightRef.current = false;
  }, [isPausing, pauseMutation?.error, statusName, statusIndex, statusRunId]);

  useEffect(() => {
    cancelInFlightRef.current = false;
  }, [isCanceling, cancelMutation?.error, statusName, statusIndex, statusRunId]);

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
  const isExpiredByQuery = Boolean(
    !hasMismatchedQuery &&
      queryData?.latestRunId &&
      statusRunId &&
      queryData.latestRunId !== statusRunId,
  );
  const isExpiredByMutation =
    isSteelFlowExpiredError(pauseMutation?.error) ||
    isSteelFlowExpiredError(cancelMutation?.error);
  const isSuperseded = isExpiredByQuery || isExpiredByMutation;
  const isTerminal = status.status === 'completed' || status.status === 'cancelled';

  const canCancel =
    !hasMismatchedQuery &&
    !terminalEventWins &&
    !isSuperseded &&
    !isTerminal &&
    index !== null &&
    (queryData?.canCancel ?? isQuotationCancellableStatus(status.status));
  const canPause =
    !hasMismatchedQuery &&
    !terminalEventWins &&
    !isSuperseded &&
    status.status === 'running' &&
    index !== null &&
    Boolean(pauseMutation);
  const isCurrentConversation = currentConversationIdRef.current === conversationId;
  const canRetryInterrupted =
    isCurrentConversation && canCancel && status.status === 'interrupted' && index !== null;
  const showInterruptedRetry =
    !hasMismatchedQuery &&
    !terminalEventWins &&
    !isSuperseded &&
    status.status === 'interrupted' &&
    index !== null;
  const showCallbackRetry =
    !hasMismatchedQuery &&
    !terminalEventWins &&
    !isSuperseded &&
    status.status === 'failed' &&
    Boolean(onRetryFlow) &&
    Boolean(statusRunId);
  const showCallbackResume =
    !hasMismatchedQuery &&
    !terminalEventWins &&
    !isSuperseded &&
    status.status === 'paused' &&
    Boolean(onResumeFlow) &&
    Boolean(statusRunId);

  let resolvedStage = event?.stage;
  if (!hasMismatchedQuery && !terminalEventWins && queryData) {
    resolvedStage = queryData.stage ?? (event?.status === queryData.status ? event.stage : undefined);
  }
  const resolvedErrorMessage =
    hasMismatchedQuery || terminalEventWins ? undefined : queryData?.errorMessage;

  const statusText = getQuotationStatusText(
    localize,
    status.status,
    completedChunks,
    totalChunks,
    resolvedStage,
    event?.chunkIndex,
    event?.repairAttempt,
    event?.maxRepairAttempts,
  );
  const repairFailed = isQuotationRepairFailure(event);
  const shouldShowLoadingDot =
    showLoadingDot &&
    !hasMismatchedQuery &&
    isQuotationPreflightWaitingStatus(status.status, resolvedStage) &&
    !repairFailed &&
    (queryData == null || isQuotationPreflightWaitingStatus(queryData.status, queryData.stage));

  const retryQuotation = async () => {
    if (
      !canRetryInterrupted ||
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

  let actionError: string | undefined;
  if (!hasMismatchedQuery && !terminalEventWins) {
    if (isExpiredByMutation) {
      actionError = localize('com_ui_steel_flow_expired');
    } else if (status.status === 'interrupted' && retryError) {
      actionError = localize('com_ui_steel_quote_retry_failed', { error: retryError });
    } else if (pauseMutation?.error) {
      const pauseErr = getFlowActionErrorMessage(pauseMutation.error);
      if (pauseErr) {
        actionError = localize('com_ui_steel_quote_pause_failed', { error: pauseErr });
      }
    } else if (cancelMutation?.error) {
      const cancelErr = getFlowActionErrorMessage(cancelMutation.error);
      if (cancelErr) {
        actionError = localize('com_ui_steel_quote_cancel_failed', { error: cancelErr });
      }
    }
  }

  const handlePause = () => {
    if (!canPause || index === null || pauseInFlightRef.current || isPausing || isCanceling) {
      return;
    }
    pauseInFlightRef.current = true;
    pauseMutation?.mutate(index);
  };

  const handleCancel = () => {
    if (!canCancel || index === null || cancelInFlightRef.current || isCanceling || isPausing) {
      return;
    }
    cancelInFlightRef.current = true;
    cancelMutation.mutate(index);
  };

  const metadataText = ocrSource
    ? localize(
        ocrSource.source === 'ai'
          ? 'com_ui_steel_quote_source_ai'
          : 'com_ui_steel_quote_source_human',
        { version: ocrSource.version },
      )
    : undefined;

  let handleRetry: (() => void) | undefined;
  if (showInterruptedRetry) {
    handleRetry = retryQuotation;
  } else if (showCallbackRetry && onRetryFlow && statusRunId) {
    handleRetry = () =>
      onRetryFlow({ kind: 'quotation', runId: statusRunId, index: index ?? undefined });
  }

  return (
    <>
      <SteelFlowCard
        kind="quotation"
        runId={statusRunId}
        status={status.status}
        stage={resolvedStage}
        statusText={statusText}
        note={event?.message}
        metadataText={metadataText}
        errorMessage={resolvedErrorMessage}
        actionError={actionError}
        isWarningState={repairFailed}
        canPause={canPause}
        canCancel={canCancel && status.status !== 'interrupted'}
        canResume={showCallbackResume}
        canRetry={showInterruptedRetry || showCallbackRetry}
        isPausing={isPausing}
        isCanceling={isCanceling}
        isRetrying={isRetrying}
        disableRetry={
          showInterruptedRetry
            ? !canRetryInterrupted || isRetrying || isRetryDispatched || isSubmittingRef.current
            : false
        }
        onPause={pauseMutation ? handlePause : undefined}
        onCancel={handleCancel}
        onResume={
          showCallbackResume && onResumeFlow && statusRunId
            ? () => onResumeFlow({ kind: 'quotation', runId: statusRunId, index: index ?? undefined })
            : undefined
        }
        onRetry={handleRetry}
        localize={localize}
      />
      {shouldShowLoadingDot && (
        <div className="relative min-h-8 overflow-visible ps-2 pt-2">
          <EmptyText />
        </div>
      )}
    </>
  );
});

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

function resolveEventOcrFlowStatus(
  event: Extract<SteelNativeActivityEvent, { type: 'parse_status' | 'delegate_ocr_status' }>,
): SteelFlowStatus {
  if (event.flowStatus) {
    return event.flowStatus;
  }
  if (event.type === 'delegate_ocr_status') {
    if (event.status === 'succeeded') {
      return 'completed';
    }
    if (event.status === 'failed') {
      return 'failed';
    }
    return 'running';
  }
  if (event.parseStatus === 'saved') {
    return 'completed';
  }
  if (event.errorMessage) {
    return 'failed';
  }
  return 'running';
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
  onResumeFlow,
  onRetryFlow,
}: SteelActivityProps) {
  const localize = useLocalize();
  const chatConversationId = useContext(ChatContext)?.conversation?.conversationId;
  const [isExpanded, setIsExpanded] = useState(false);
  const allActivityEvents = useSteelActivityEvents(messageId, persistedActivityEvents);

  const displayEvents = useMemo(
    () => allActivityEvents.filter(shouldDisplayEvent),
    [allActivityEvents],
  );
  const ocrFlowSummaries = useMemo(
    () => extractOcrFlowSummaries(allActivityEvents, conversationId ?? chatConversationId),
    [allActivityEvents, chatConversationId, conversationId],
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
      isQuotationPreflightWaitingStatus(latestQuotationEvent.status, latestQuotationEvent.stage) &&
      !isQuotationRepairFailure(latestQuotationEvent),
  );
  const quotationConversationId =
    conversationId ?? latestQuotationEvent?.conversationId ?? chatConversationId;
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
          localize={localize}
          onResumeFlow={onResumeFlow}
          onRetryFlow={onRetryFlow}
        />
      ))}
      {hasQuotationActivity && quotationConversationId && (
        <SteelQuotationProgress
          conversationId={quotationConversationId}
          messageId={messageId}
          event={latestQuotationEvent}
          localize={localize}
          showLoadingDot={showQuotationLoadingDot}
          onResumeFlow={onResumeFlow}
          onRetryFlow={onRetryFlow}
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
