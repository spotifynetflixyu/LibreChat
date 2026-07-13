import { Gauge, KeyRound, LogIn, LogOut, RefreshCw } from 'lucide-react';
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

function getWindowLabel(
  window: OpenAIOAuthUsageWindow,
  localize: LocalizeFunction,
): string | undefined {
  if (window.key === 'secondary') {
    return localize('com_ui_weekly');
  }
  if (window.limitWindowSeconds === undefined) {
    return undefined;
  }
  if (window.limitWindowSeconds >= 604800) {
    return localize('com_ui_weekly');
  }

  const hours = window.limitWindowSeconds / 3600;
  if (Number.isInteger(hours)) {
    return `${hours}h`;
  }

  const minutes = Math.round(window.limitWindowSeconds / 60);
  return `${minutes}m`;
}

function formatResetLabel(window: OpenAIOAuthUsageWindow): string | undefined {
  if (!window.resetAt) {
    return undefined;
  }
  const resetAt = new Date(window.resetAt);
  if (Number.isNaN(resetAt.getTime())) {
    return undefined;
  }

  const options: Intl.DateTimeFormatOptions =
    window.key === 'secondary' || (window.limitWindowSeconds ?? 0) >= 86400
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
  if (status.accessToken.status === 'invalid') {
    return <OpenAIOAuthStatusValue tone="red">{localize('com_ui_invalid')}</OpenAIOAuthStatusValue>;
  }
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
  const appServerStatus = status.login.available
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
      <OAuthTokenStatusRow label={localize('com_ui_codex_app_server')} value={appServerStatus} />
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
      {windows.map((window) => {
        const label = getWindowLabel(window, localize);
        const resetLabel = formatResetLabel(window);

        return (
          <div
            key={window.key}
            className="flex items-center justify-between gap-3 text-xs text-text-secondary"
          >
            {label && <span className="min-w-0 truncate">{label}</span>}
            <span className="flex shrink-0 items-center gap-2 tabular-nums">
              <span>{Math.round(window.remainingPercent)}%</span>
              {resetLabel && <span>{resetLabel}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function getTokenActionStatusValue({
  isLoginPollingError,
  localize,
  loginIsLoading,
  loginStatus,
  logoutFailed,
  logoutIsLoading,
  logoutSucceeded,
}: {
  isLoginPollingError: boolean;
  localize: LocalizeFunction;
  loginIsLoading: boolean;
  loginStatus?: OpenAIOAuthTokenLoginStatus;
  logoutFailed: boolean;
  logoutIsLoading: boolean;
  logoutSucceeded: boolean;
}): ReactNode | undefined {
  if (logoutIsLoading) {
    return (
      <OpenAIOAuthStatusValue tone="yellow">
        {localize('com_ui_logging_out')}
      </OpenAIOAuthStatusValue>
    );
  }
  if (logoutFailed) {
    return (
      <OpenAIOAuthStatusValue tone="red">{localize('com_ui_logout_failed')}</OpenAIOAuthStatusValue>
    );
  }
  if (logoutSucceeded) {
    return (
      <OpenAIOAuthStatusValue tone="green">{localize('com_ui_logged_out')}</OpenAIOAuthStatusValue>
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
  if (loginStatusValue) {
    return loginStatusValue;
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
    logoutFailed,
    logoutIsLoading,
    logoutSucceeded,
    openCodexLogin,
    openCodexLogout,
  } = useOpenAIOAuthCodexLogin();
  const usageQuery = useGetOpenAIOAuthUsageQuery();
  const tokenQuery = useGetOpenAIOAuthTokenStatusQuery({ enabled: isAdmin });
  const refreshTokenMutation = useRefreshOpenAIOAuthTokenMutation();
  const tokenStatus = tokenQuery.data;
  const usageUnauthorized = usageQuery.data?.reason === 'unauthorized';
  const displayedTokenStatus =
    usageUnauthorized && tokenStatus
      ? {
          ...tokenStatus,
          status: 'unavailable' as const,
          reason: 'verification_failed' as const,
          accessToken: { ...tokenStatus.accessToken, status: 'invalid' as const },
        }
      : tokenStatus;
  const windows = usageQuery.data?.status === 'available' ? usageQuery.data.windows : [];
  const showUnavailable =
    usageQuery.isError || (usageQuery.data && usageQuery.data.status !== 'available');
  const tokenActionStatusValue = getTokenActionStatusValue({
    isLoginPollingError: loginPollingIsError,
    localize,
    loginIsLoading,
    loginStatus,
    logoutFailed,
    logoutIsLoading,
    logoutSucceeded,
  });
  const loginFailed = loginStatus?.status === 'failed' || loginStatus?.status === 'unavailable';
  const isLoggedIn =
    displayedTokenStatus?.status === 'available' &&
    displayedTokenStatus.accessToken.status === 'valid' &&
    !loginFailed;
  const unavailableReason = getUnavailableReason({
    dataReason: usageQuery.data?.reason,
    isError: usageQuery.isError,
  });
  const unavailableText = unavailableReason
    ? `${localize('com_ui_unavailable')}: ${unavailableReason}`
    : localize('com_ui_unavailable');
  let usageContent: ReactNode = <UsageRows localize={localize} windows={windows} />;
  if (usageQuery.isLoading) {
    usageContent = (
      <span className="text-xs text-text-secondary">{localize('com_ui_loading')}</span>
    );
  } else if (showUnavailable) {
    usageContent = (
      <span className="text-xs text-text-secondary">
        <OpenAIOAuthStatusValue tone="red">{unavailableText}</OpenAIOAuthStatusValue>
      </span>
    );
  }
  let tokenContent: ReactNode = (
    <OAuthTokenStatus
      localize={localize}
      status={displayedTokenStatus}
      statusLabel={tokenActionStatusValue}
    />
  );
  if (tokenQuery.isFetching || tokenQuery.isLoading) {
    tokenContent = (
      <span className="text-xs text-text-secondary">{localize('com_ui_loading')}</span>
    );
  } else if (tokenQuery.isError) {
    tokenContent = (
      <span className="text-xs text-text-secondary">{localize('com_ui_unavailable')}</span>
    );
  }

  return (
    <div className="mx-2 mt-1 border-t border-border-light px-1 pb-1 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm text-text-primary">
        <span className="flex min-w-0 items-center gap-2">
          <Gauge className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="truncate">{localize('com_ui_usage_remaining')}</span>
        </span>
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={localize('com_ui_refresh')}
          disabled={usageQuery.isFetching}
          onClick={() => usageQuery.refetch()}
        >
          <RefreshCw
            className={usageQuery.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'}
            aria-hidden="true"
          />
        </button>
      </div>
      {usageContent}
      {isAdmin && (
        <div className="mt-2 border-t border-border-light pt-2">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-sm text-text-primary">
            <span className="flex min-w-0 items-center gap-2">
              <KeyRound className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="truncate">{localize('com_ui_oauth_token')}</span>
            </span>
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={localize('com_ui_verify')}
              disabled={tokenQuery.isFetching}
              onClick={() => tokenQuery.refetch()}
            >
              <RefreshCw
                className={tokenQuery.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'}
                aria-hidden="true"
              />
            </button>
          </div>
          {tokenContent}
          {!tokenQuery.isFetching &&
            !tokenQuery.isLoading &&
            !tokenQuery.isError &&
            displayedTokenStatus && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {isLoggedIn ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded border border-border-light px-2 py-1 text-xs text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={refreshTokenMutation.isLoading || logoutIsLoading}
                      onClick={() => refreshTokenMutation.mutate()}
                    >
                      <RefreshCw
                        className={
                          refreshTokenMutation.isLoading ? 'size-3.5 animate-spin' : 'size-3.5'
                        }
                        aria-hidden="true"
                      />
                      {refreshTokenMutation.isLoading
                        ? localize('com_ui_refreshing')
                        : localize('com_ui_refresh_token')}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded border border-border-light px-2 py-1 text-xs text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={logoutIsLoading || loginBusy || refreshTokenMutation.isLoading}
                      onClick={openCodexLogout}
                    >
                      <LogOut
                        className={logoutIsLoading ? 'size-3.5 animate-pulse' : 'size-3.5'}
                        aria-hidden="true"
                      />
                      {logoutIsLoading ? localize('com_ui_logging_out') : localize('com_ui_logout')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded border border-border-light px-2 py-1 text-xs text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={loginIsLoading || logoutIsLoading}
                    onClick={openCodexLogin}
                  >
                    <LogIn
                      className={loginBusy ? 'size-3.5 animate-pulse' : 'size-3.5'}
                      aria-hidden="true"
                    />
                    {localize('com_ui_codex_login')}
                  </button>
                )}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
