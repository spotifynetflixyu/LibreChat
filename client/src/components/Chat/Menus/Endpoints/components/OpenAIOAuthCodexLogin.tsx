import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink } from 'lucide-react';
import {
  Button,
  Input,
  Skeleton,
  OGDialog,
  OGDialogContent,
  OGDialogTitle,
} from '@librechat/client';
import { QueryKeys, SystemRoles, openAIOAuthTokenLoginStatusSchema } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import type {
  OpenAIOAuthTokenLoginMethod,
  OpenAIOAuthTokenLoginStatus,
} from 'librechat-data-provider';
import {
  useCancelOpenAIOAuthCodexLoginMutation,
  useGetOpenAIOAuthCodexLoginStatusQuery,
  useLogoutOpenAIOAuthCodexMutation,
  useStartOpenAIOAuthCodexLoginMutation,
} from '~/data-provider';
import type { LocalizeFunction } from '~/common';
import { useAuthContext, useLocalize } from '~/hooks';

const codexLoginSessionStorageKey = 'openai_oauth_codex_login_session_id';
type OpenAIOAuthCodexLoginContextValue = {
  dialogOpen: boolean;
  loginBusy: boolean;
  loginIsLoading: boolean;
  loginMethod?: OpenAIOAuthTokenLoginMethod;
  loginPollingIsError: boolean;
  loginStatus?: OpenAIOAuthTokenLoginStatus;
  logoutDialogOpen: boolean;
  logoutFailed: boolean;
  logoutIsLoading: boolean;
  logoutSucceeded: boolean;
  closeCodexLogin: () => void;
  closeCodexLogout: () => void;
  confirmCodexLogout: () => void;
  openCodexLogin: () => void;
  openCodexLogout: () => void;
  returnToLoginMethods: () => void;
  returningToLoginMethods: boolean;
  resetCodexLogin: () => void;
  setDialogOpen: (open: boolean) => void;
  startCodexLogin: (method: OpenAIOAuthTokenLoginMethod) => void;
};

const OpenAIOAuthCodexLoginContext = createContext<OpenAIOAuthCodexLoginContextValue | undefined>(
  undefined,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStoredCodexLoginSessionId(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.sessionStorage.getItem(codexLoginSessionStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStoredCodexLoginSessionId(sessionId: string): void {
  try {
    window.sessionStorage.setItem(codexLoginSessionStorageKey, sessionId);
  } catch {
    // Session persistence is helpful, but login polling still works without it.
  }
}

function removeStoredCodexLoginSessionId(): void {
  try {
    window.sessionStorage.removeItem(codexLoginSessionStorageKey);
  } catch {
    // Ignore storage failures in locked-down browser contexts.
  }
}

function getCodexLoginStatusFromError(error: unknown): OpenAIOAuthTokenLoginStatus | undefined {
  if (!isRecord(error) || !isRecord(error.response)) {
    return undefined;
  }

  const parsed = openAIOAuthTokenLoginStatusSchema.safeParse(error.response.data);
  return parsed.success ? parsed.data : undefined;
}

function createClientLoginFailedStatus({
  reason = 'login_failed',
  sessionId,
}: {
  reason?: NonNullable<OpenAIOAuthTokenLoginStatus['reason']>;
  sessionId?: string;
} = {}): OpenAIOAuthTokenLoginStatus {
  const now = new Date().toISOString();
  return {
    status: 'failed',
    ...(sessionId ? { sessionId } : {}),
    startedAt: now,
    updatedAt: now,
    reason,
  };
}

function getDisplayCodexDeviceCode(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/gu, '-').toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4,5}$/u.test(normalized)) {
    return undefined;
  }
  if (!/\d/u.test(normalized)) {
    return undefined;
  }

  return normalized;
}

export function OAuthTokenStatusRow({
  label,
  value,
  valueClassName = '',
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(5rem,1fr)_auto] items-center gap-3 text-xs text-text-secondary">
      <span className="min-w-0 truncate">{label}</span>
      <span className={`shrink-0 text-right${valueClassName ? ` ${valueClassName}` : ''}`}>
        {value}
      </span>
    </div>
  );
}

function VerificationCodeValue({
  code,
  copied,
  localize,
  onCopied,
}: {
  code: string;
  copied: boolean;
  localize: LocalizeFunction;
  onCopied: (code: string) => void;
}) {
  const copyCode = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      void navigator.clipboard
        .writeText(code)
        .then(() => onCopied(code))
        .catch(() => undefined);
    } catch {
      return;
    }
  }, [code, onCopied]);

  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-3 py-2 font-mono text-sm tabular-nums text-text-primary">
        {code}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5"
        onClick={copyCode}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copied ? localize('com_ui_copied') : localize('com_ui_copy')}
      </Button>
    </div>
  );
}

export type OpenAIOAuthStatusTone = 'green' | 'red' | 'yellow';

const statusToneClassName: Record<OpenAIOAuthStatusTone, string> = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-400',
};

export function OpenAIOAuthStatusValue({
  children,
  tone,
}: {
  children: ReactNode;
  tone: OpenAIOAuthStatusTone;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span
        aria-hidden="true"
        data-testid={`openai-oauth-status-dot-${tone}`}
        className={`size-2 rounded-full ${statusToneClassName[tone]}`}
      />
      <span>{children}</span>
    </span>
  );
}

function VerificationCodeSkeleton({ localize }: { localize: LocalizeFunction }) {
  return (
    <div
      role="status"
      aria-label={localize('com_ui_loading')}
      className="mt-2 flex items-center gap-2"
    >
      <Skeleton className="h-10 min-w-0 flex-1 rounded-md" />
      <Skeleton className="h-10 w-24 shrink-0 rounded-md" />
    </div>
  );
}

function LoginUrlSkeleton({ localize }: { localize: LocalizeFunction }) {
  return (
    <div
      role="status"
      aria-label={localize('com_ui_loading')}
      className="mt-2 flex items-center gap-2"
    >
      <Skeleton className="h-9 min-w-0 flex-1 rounded-md" />
      <Skeleton className="h-9 w-28 shrink-0 rounded-md" />
    </div>
  );
}

export function getCodexLoginStatusValue({
  isLoginPollingError,
  localize,
  loginIsLoading,
  loginStatus,
}: {
  isLoginPollingError: boolean;
  localize: LocalizeFunction;
  loginIsLoading: boolean;
  loginStatus?: OpenAIOAuthTokenLoginStatus;
}): ReactNode | undefined {
  if (loginIsLoading) {
    return (
      <OpenAIOAuthStatusValue tone="yellow">
        {localize('com_ui_login_starting')}
      </OpenAIOAuthStatusValue>
    );
  }
  if (loginStatus?.status === 'pending') {
    return (
      <OpenAIOAuthStatusValue tone="yellow">
        {localize('com_ui_login_pending')}
      </OpenAIOAuthStatusValue>
    );
  }
  if (
    loginStatus?.status === 'failed' ||
    loginStatus?.status === 'unavailable' ||
    isLoginPollingError
  ) {
    return (
      <OpenAIOAuthStatusValue tone="red">
        {loginStatus?.reason
          ? `${localize('com_ui_login_failed')}: ${loginStatus.reason}`
          : localize('com_ui_login_failed')}
      </OpenAIOAuthStatusValue>
    );
  }
  if (loginStatus?.status === 'succeeded') {
    return (
      <OpenAIOAuthStatusValue tone="green">{localize('com_ui_checked')}</OpenAIOAuthStatusValue>
    );
  }

  return undefined;
}

export function useOpenAIOAuthCodexLogin() {
  const context = useContext(OpenAIOAuthCodexLoginContext);
  if (!context) {
    throw new Error('useOpenAIOAuthCodexLogin must be used within OpenAIOAuthCodexLoginProvider');
  }

  return context;
}

export function OpenAIOAuthCodexLoginProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const userRole = user?.role;
  const isAdmin = userRole === SystemRoles.ADMIN;
  const [loginSessionId, setLoginSessionId] = useState<string | undefined>(() =>
    isAdmin ? readStoredCodexLoginSessionId() : undefined,
  );
  const [dialogOpen, setDialogOpen] = useState(Boolean(loginSessionId));
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [loginStartErrorStatus, setLoginStartErrorStatus] = useState<
    OpenAIOAuthTokenLoginStatus | undefined
  >(undefined);
  const [selectedLoginMethod, setSelectedLoginMethod] = useState<
    OpenAIOAuthTokenLoginMethod | undefined
  >(undefined);
  const loginMutation = useStartOpenAIOAuthCodexLoginMutation();
  const cancelLoginMutation = useCancelOpenAIOAuthCodexLoginMutation();
  const logoutMutation = useLogoutOpenAIOAuthCodexMutation();
  const loginStatusQuery = useGetOpenAIOAuthCodexLoginStatusQuery(loginSessionId, {
    enabled: isAdmin && Boolean(loginSessionId),
    refetchInterval: (data) => (data?.status === 'pending' ? 2_000 : false),
  });
  const loginStatus = loginStartErrorStatus ?? loginStatusQuery.data ?? loginMutation.data;
  const loginBusy = loginMutation.isLoading || loginStatus?.status === 'pending';

  useEffect(() => {
    if (!userRole) {
      return;
    }
    if (!isAdmin) {
      removeStoredCodexLoginSessionId();
      setLoginSessionId(undefined);
      setDialogOpen(false);
      setLoginStartErrorStatus(undefined);
      setSelectedLoginMethod(undefined);
      return;
    }

    const storedSessionId = readStoredCodexLoginSessionId();
    if (storedSessionId && !loginSessionId) {
      setLoginSessionId(storedSessionId);
      setDialogOpen(true);
    }
  }, [isAdmin, loginSessionId, userRole]);

  useEffect(() => {
    if (!loginStatusQuery.isError || !loginSessionId) {
      return;
    }

    removeStoredCodexLoginSessionId();
    setLoginStartErrorStatus(
      createClientLoginFailedStatus({
        reason: 'login_not_found',
        sessionId: loginSessionId,
      }),
    );
    setLoginSessionId(undefined);
  }, [loginSessionId, loginStatusQuery.isError]);

  useEffect(() => {
    if (loginStatus?.status === 'failed' || loginStatus?.status === 'unavailable') {
      removeStoredCodexLoginSessionId();
    }
  }, [loginStatus?.status]);

  useEffect(() => {
    if (loginStatus?.status !== 'succeeded' || !loginStatus.token) {
      return;
    }

    removeStoredCodexLoginSessionId();
    queryClient.setQueryData([QueryKeys.openAIOAuthTokenStatus], loginStatus.token);
    queryClient.invalidateQueries([QueryKeys.openAIOAuthUsage]);
  }, [loginStatus, queryClient]);

  const resetCodexLogin = useCallback(() => {
    removeStoredCodexLoginSessionId();
    setLoginSessionId(undefined);
    setLoginStartErrorStatus(undefined);
    setSelectedLoginMethod(undefined);
    loginMutation.reset();
    queryClient.removeQueries([QueryKeys.openAIOAuthCodexLoginStatus]);
  }, [loginMutation, queryClient]);

  const openCodexLogin = useCallback(() => {
    setDialogOpen(true);
    if (loginStatus?.status === 'pending' && loginSessionId) {
      return;
    }

    resetCodexLogin();
  }, [loginSessionId, loginStatus?.status, resetCodexLogin]);

  const returnToLoginMethods = useCallback(() => {
    if (!loginSessionId || loginStatus?.status !== 'pending') {
      resetCodexLogin();
      return;
    }
    cancelLoginMutation.mutate(loginSessionId, { onSuccess: resetCodexLogin });
  }, [cancelLoginMutation, loginSessionId, loginStatus?.status, resetCodexLogin]);

  const closeCodexLogin = useCallback(() => {
    const closeDialog = () => {
      resetCodexLogin();
      setDialogOpen(false);
    };
    if (!loginSessionId || loginStatus?.status !== 'pending') {
      closeDialog();
      return;
    }
    cancelLoginMutation.mutate(loginSessionId, { onSuccess: closeDialog });
  }, [cancelLoginMutation, loginSessionId, loginStatus?.status, resetCodexLogin]);

  const openCodexLogout = useCallback(() => {
    logoutMutation.reset();
    setLogoutDialogOpen(true);
  }, [logoutMutation]);

  const closeCodexLogout = useCallback(() => {
    if (!logoutMutation.isLoading) {
      setLogoutDialogOpen(false);
    }
  }, [logoutMutation.isLoading]);

  const confirmCodexLogout = useCallback(() => {
    logoutMutation.mutate(undefined, { onSuccess: resetCodexLogin });
  }, [logoutMutation, resetCodexLogin]);

  const startCodexLogin = useCallback(
    (method: OpenAIOAuthTokenLoginMethod) => {
      setDialogOpen(true);
      if (loginStatus?.status === 'pending' && loginSessionId) {
        return;
      }

      removeStoredCodexLoginSessionId();
      setLoginSessionId(undefined);
      setLoginStartErrorStatus(undefined);
      setSelectedLoginMethod(method);
      loginMutation.mutate(method, {
        onSuccess: (data) => {
          if (data.sessionId) {
            writeStoredCodexLoginSessionId(data.sessionId);
            setLoginSessionId(data.sessionId);
            return;
          }

          if (data.status === 'failed' || data.status === 'unavailable') {
            setLoginStartErrorStatus(data);
          }
        },
        onError: (error) => {
          setLoginStartErrorStatus(
            getCodexLoginStatusFromError(error) ?? createClientLoginFailedStatus(),
          );
        },
      });
    },
    [loginMutation, loginSessionId, loginStatus?.status],
  );

  return (
    <OpenAIOAuthCodexLoginContext.Provider
      value={{
        dialogOpen,
        closeCodexLogin,
        loginBusy,
        loginIsLoading: loginMutation.isLoading,
        loginMethod: loginStatus?.method ?? selectedLoginMethod,
        loginPollingIsError: loginStatusQuery.isError,
        loginStatus,
        logoutDialogOpen,
        logoutFailed:
          logoutMutation.isError ||
          (logoutMutation.isSuccess && logoutMutation.data?.status !== 'succeeded'),
        logoutIsLoading: logoutMutation.isLoading,
        logoutSucceeded: logoutMutation.isSuccess && logoutMutation.data?.status === 'succeeded',
        openCodexLogin,
        openCodexLogout,
        closeCodexLogout,
        confirmCodexLogout,
        returnToLoginMethods,
        returningToLoginMethods: cancelLoginMutation.isLoading,
        resetCodexLogin,
        setDialogOpen,
        startCodexLogin,
      }}
    >
      {children}
    </OpenAIOAuthCodexLoginContext.Provider>
  );
}

export function OpenAIOAuthCodexLoginDialog() {
  const localize = useLocalize();
  const [copiedCode, setCopiedCode] = useState<string | undefined>(undefined);
  const {
    dialogOpen,
    closeCodexLogin,
    loginIsLoading,
    loginMethod,
    loginPollingIsError,
    loginStatus,
    returnToLoginMethods,
    returningToLoginMethods,
    setDialogOpen,
    startCodexLogin,
  } = useOpenAIOAuthCodexLogin();
  const verificationUri = loginStatus?.device?.verificationUri;
  const browserAuthUrl = loginStatus?.browser?.authUrl;
  const userCode = getDisplayCodexDeviceCode(loginStatus?.device?.userCode);
  const statusValue = getCodexLoginStatusValue({
    isLoginPollingError: loginPollingIsError,
    localize,
    loginIsLoading,
    loginStatus,
  });
  const codeCopied = Boolean(userCode && copiedCode === userCode);

  useEffect(() => {
    if (copiedCode && copiedCode !== userCode) {
      setCopiedCode(undefined);
    }
  }, [copiedCode, userCode]);

  let loginUrlContent: ReactNode = <LoginUrlSkeleton localize={localize} />;
  if (browserAuthUrl) {
    loginUrlContent = (
      <div className="mt-2 flex items-center gap-2">
        <Input
          readOnly
          dir="ltr"
          value={browserAuthUrl}
          aria-label={localize('com_ui_login_url')}
          onFocus={(event) => event.currentTarget.select()}
          className="h-9 text-xs text-text-secondary"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => window.open(browserAuthUrl, '_blank', 'noopener,noreferrer')}
        >
          {localize('com_ui_open_link')}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  } else if (verificationUri) {
    loginUrlContent = (
      <>
        <div className="mt-2 flex items-center gap-2">
          <Input
            readOnly
            dir="ltr"
            value={verificationUri}
            aria-label={localize('com_ui_login_url')}
            onFocus={(event) => event.currentTarget.select()}
            className="h-9 text-xs text-text-secondary"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={!codeCopied}
            onClick={() => window.open(verificationUri, '_blank', 'noopener,noreferrer')}
          >
            {localize('com_ui_open_link')}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        {!codeCopied && (
          <div className="mt-2 text-xs text-text-secondary">
            {localize('com_ui_copy_verification_code_first')}
          </div>
        )}
        {codeCopied && (
          <div className="mt-2 text-xs text-text-secondary">
            {localize('com_ui_open_link_to_finish_login')}
          </div>
        )}
      </>
    );
  }

  return (
    <OGDialog
      open={dialogOpen}
      onOpenChange={(open) => (open ? setDialogOpen(true) : closeCodexLogin())}
    >
      <OGDialogContent
        showCloseButton={false}
        className="w-11/12 max-w-md overflow-hidden rounded-2xl border-border-light bg-surface-primary text-text-primary"
      >
        <OGDialogTitle className="text-base font-semibold leading-6 text-text-primary">
          {localize('com_ui_codex_login')}
        </OGDialogTitle>
        {!loginStatus && !loginIsLoading ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" onClick={() => startCodexLogin('device_code')}>
                {localize('com_ui_device_code_login')}
              </Button>
              <Button type="button" variant="outline" onClick={() => startCodexLogin('browser')}>
                {localize('com_ui_browser_login')}
              </Button>
            </div>
            <div className="text-xs text-text-secondary">
              {localize('com_ui_device_code_login_recommended')}
            </div>
            <div className="flex justify-end pt-2">
              <Button type="button" variant="outline" onClick={closeCodexLogin}>
                {localize('com_ui_close')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <OAuthTokenStatusRow
              label={localize('com_ui_login_status')}
              value={
                statusValue ?? (
                  <OpenAIOAuthStatusValue tone="yellow">
                    {localize('com_ui_login_starting')}
                  </OpenAIOAuthStatusValue>
                )
              }
            />
            {loginMethod !== 'browser' && (
              <div className="rounded-lg border border-border-light p-3">
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="flex size-5 items-center justify-center rounded-full border border-border-light text-[11px]">
                    1
                  </span>
                  <span>{localize('com_ui_verification_code')}</span>
                </div>
                {userCode ? (
                  <VerificationCodeValue
                    code={userCode}
                    copied={codeCopied}
                    localize={localize}
                    onCopied={setCopiedCode}
                  />
                ) : (
                  <VerificationCodeSkeleton localize={localize} />
                )}
              </div>
            )}
            <div className="rounded-lg border border-border-light p-3">
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                {loginMethod !== 'browser' && (
                  <span className="flex size-5 items-center justify-center rounded-full border border-border-light text-[11px]">
                    2
                  </span>
                )}
                <span>{localize('com_ui_login_url')}</span>
              </div>
              {loginUrlContent}
            </div>
            <div className="flex justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={returningToLoginMethods}
                onClick={() => {
                  setCopiedCode(undefined);
                  returnToLoginMethods();
                }}
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                {localize('com_ui_back')}
              </Button>
              <Button type="button" variant="outline" onClick={closeCodexLogin}>
                {localize('com_ui_close')}
              </Button>
            </div>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}

export function OpenAIOAuthCodexLogoutDialog() {
  const localize = useLocalize();
  const {
    closeCodexLogout,
    confirmCodexLogout,
    logoutDialogOpen,
    logoutFailed,
    logoutIsLoading,
    logoutSucceeded,
  } = useOpenAIOAuthCodexLogin();

  let content: ReactNode = (
    <>
      <p className="text-sm text-text-secondary">{localize('com_ui_confirm_logout')}</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={closeCodexLogout}>
          {localize('com_ui_cancel')}
        </Button>
        <Button type="button" onClick={confirmCodexLogout}>
          {localize('com_ui_confirm')}
        </Button>
      </div>
    </>
  );
  if (logoutIsLoading) {
    content = (
      <OpenAIOAuthStatusValue tone="yellow">
        {localize('com_ui_logging_out')}
      </OpenAIOAuthStatusValue>
    );
  } else if (logoutSucceeded || logoutFailed) {
    content = (
      <>
        <OpenAIOAuthStatusValue tone={logoutSucceeded ? 'green' : 'red'}>
          {localize(logoutSucceeded ? 'com_ui_logged_out' : 'com_ui_logout_failed')}
        </OpenAIOAuthStatusValue>
        <div className="flex justify-end pt-2">
          <Button type="button" variant="outline" onClick={closeCodexLogout}>
            {localize('com_ui_close')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <OGDialog open={logoutDialogOpen} onOpenChange={(open) => !open && closeCodexLogout()}>
      <OGDialogContent
        showCloseButton={false}
        className="w-11/12 max-w-sm rounded-2xl border-border-light bg-surface-primary text-text-primary"
      >
        <OGDialogTitle className="text-base font-semibold leading-6 text-text-primary">
          {localize('com_ui_logout')}
        </OGDialogTitle>
        {content}
      </OGDialogContent>
    </OGDialog>
  );
}
