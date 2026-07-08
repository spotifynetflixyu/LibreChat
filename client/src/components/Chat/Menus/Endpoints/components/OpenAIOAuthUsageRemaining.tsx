import { Gauge, KeyRound, LogIn, RefreshCw } from 'lucide-react';
import { SystemRoles } from 'librechat-data-provider';
import type {
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenStatus,
  OpenAIOAuthUsageWindow,
} from 'librechat-data-provider';
import type { ReactNode } from 'react';
import {
  useGetOpenAIOAuthUsageQuery,
  useGetOpenAIOAuthTokenStatusQuery,
  useRefreshOpenAIOAuthTokenMutation,
} from '~/data-provider';
import type { LocalizeFunction } from '~/common';
import { useAuthContext, useLocalize } from '~/hooks';
import {
  getCodexLoginStatusValue,
  OpenAIOAuthStatusValue,
  OAuthTokenStatusRow,
  useOpenAIOAuthCodexLogin,
} from './OpenAIOAuthCodexLogin';

function getWindowLabel(window: OpenAIOAuthUsageWindow, localize: LocalizeFunction): string {
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

function formatExpiresLabel(status: OpenAIOAuthTokenStatus): string {
  const expiresAt = status.accessToken.expiresAt
    ? new Date(status.accessToken.expiresAt)
    : undefined;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(expiresAt);
}

function getAccessTokenStatusValue(
  status: OpenAIOAuthTokenStatus,
  localize: LocalizeFunction,
): ReactNode {
  if (status.status !== 'available') {
    return (
      <OpenAIOAuthStatusValue tone="red">{localize('com_ui_unavailable')}</OpenAIOAuthStatusValue>
    );
  }
  if (status.accessToken.status === 'valid') {
    return <OpenAIOAuthStatusValue tone="green">{localize('com_ui_valid')}</OpenAIOAuthStatusValue>;
  }
  if (status.accessToken.status === 'expired') {
    return <OpenAIOAuthStatusValue tone="red">{localize('com_ui_expired')}</OpenAIOAuthStatusValue>;
  }
  return (
    <OpenAIOAuthStatusValue tone="red">{localize('com_ui_unavailable')}</OpenAIOAuthStatusValue>
  );
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

function OAuthTokenStatus({
  localize,
  statusLabel,
  status,
}: {
  localize: LocalizeFunction;
  statusLabel?: ReactNode;
  status?: OpenAIOAuthTokenStatus;
}) {
  if (!status) {
    return <span className="text-xs text-text-secondary">{localize('com_ui_unavailable')}</span>;
  }

  const expiresLabel = formatExpiresLabel(status);
  const codexCliStatus = status.login.available
    ? localize('com_ui_available')
    : localize('com_ui_unavailable');

  return (
    <div className="space-y-1">
      <OAuthTokenStatusRow
        label={localize('com_ui_status')}
        value={statusLabel ?? getAccessTokenStatusValue(status, localize)}
      />
      {expiresLabel && (
        <OAuthTokenStatusRow
          label={localize('com_ui_expires')}
          value={expiresLabel}
          valueClassName="tabular-nums"
        />
      )}
      <OAuthTokenStatusRow label={localize('com_ui_codex_cli')} value={codexCliStatus} />
    </div>
  );
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

function getTokenActionStatusValue({
  isLoginPollingError,
  localize,
  loginIsLoading,
  loginStatus,
  refreshFailed,
  refreshIsLoading,
  refreshSucceeded,
}: {
  isLoginPollingError: boolean;
  localize: LocalizeFunction;
  loginIsLoading: boolean;
  loginStatus?: OpenAIOAuthTokenLoginStatus;
  refreshFailed: boolean;
  refreshIsLoading: boolean;
  refreshSucceeded: boolean;
}): ReactNode | undefined {
  if (refreshIsLoading) {
    return (
      <OpenAIOAuthStatusValue tone="yellow">
        {localize('com_ui_refreshing')}
      </OpenAIOAuthStatusValue>
    );
  }

  const loginStatusValue = getCodexLoginStatusValue({
    isLoginPollingError,
    localize,
    loginIsLoading,
    loginStatus,
  });
  if (loginIsLoading || loginStatus?.status === 'pending') {
    return loginStatusValue;
  }
  if (refreshFailed) {
    return (
      <OpenAIOAuthStatusValue tone="red">
        {localize('com_ui_refresh_failed')}
      </OpenAIOAuthStatusValue>
    );
  }
  if (loginStatusValue) {
    return loginStatusValue;
  }
  if (refreshSucceeded) {
    return <OpenAIOAuthStatusValue tone="green">{localize('com_ui_checked')}</OpenAIOAuthStatusValue>;
  }

  return undefined;
}

export default function OpenAIOAuthUsageRemaining() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const {
    loginBusy,
    loginIsLoading,
    loginPollingIsError,
    loginStatus,
    startCodexLogin,
  } = useOpenAIOAuthCodexLogin();
  const usageQuery = useGetOpenAIOAuthUsageQuery();
  const tokenQuery = useGetOpenAIOAuthTokenStatusQuery({ enabled: isAdmin });
  const refreshMutation = useRefreshOpenAIOAuthTokenMutation();
  const tokenStatus = tokenQuery.data;
  const windows = usageQuery.data?.status === 'available' ? usageQuery.data.windows : [];
  const showUnavailable =
    usageQuery.isError || (usageQuery.data && usageQuery.data.status !== 'available');
  const refreshFailed =
    refreshMutation.isError ||
    (refreshMutation.isSuccess && refreshMutation.data?.status !== 'available');
  const tokenActionStatusValue = getTokenActionStatusValue({
    isLoginPollingError: loginPollingIsError,
    localize,
    loginIsLoading,
    loginStatus,
    refreshFailed,
    refreshIsLoading: refreshMutation.isLoading,
    refreshSucceeded: refreshMutation.isSuccess,
  });
  const loginAvailable = tokenStatus?.login.available === true;
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
        <span className="text-xs text-text-secondary">
          <OpenAIOAuthStatusValue tone="red">{unavailableText}</OpenAIOAuthStatusValue>
        </span>
      ) : (
        <UsageRows localize={localize} windows={windows} />
      )}
      {isAdmin && (
        <div className="mt-2 border-t border-border-light pt-2">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-sm text-text-primary">
            <span className="flex min-w-0 items-center gap-2">
              <KeyRound className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="truncate">{localize('com_ui_oauth_token')}</span>
            </span>
          </div>
          {tokenQuery.isLoading ? (
            <span className="text-xs text-text-secondary">{localize('com_ui_loading')}</span>
          ) : tokenQuery.isError ? (
            <span className="text-xs text-text-secondary">{localize('com_ui_unavailable')}</span>
          ) : (
            <OAuthTokenStatus
              localize={localize}
              status={tokenStatus}
              statusLabel={tokenActionStatusValue}
            />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-border-light px-2 py-1 text-xs text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={refreshMutation.isLoading || loginBusy}
              onClick={() => refreshMutation.mutate()}
            >
              <RefreshCw
                className={`size-3.5${refreshMutation.isLoading ? ' animate-spin' : ''}`}
                aria-hidden="true"
              />
              {refreshMutation.isLoading
                ? localize('com_ui_refreshing')
                : localize('com_ui_refresh_token')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-border-light px-2 py-1 text-xs text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!loginAvailable || loginIsLoading}
              onClick={startCodexLogin}
            >
              <LogIn className={`size-3.5${loginBusy ? ' animate-pulse' : ''}`} aria-hidden="true" />
              {localize('com_ui_codex_login')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
