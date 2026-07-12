import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import OpenAIOAuthUsageRemaining from '../OpenAIOAuthUsageRemaining';
import {
  OpenAIOAuthCodexLoginDialog,
  OpenAIOAuthCodexLoginProvider,
  OpenAIOAuthCodexLogoutDialog,
} from '../OpenAIOAuthCodexLogin';

const mockQueryClientSetQueryData = jest.fn();
const mockQueryClientInvalidateQueries = jest.fn();
const mockQueryClientRefetchQueries = jest.fn();
const mockQueryClientRemoveQueries = jest.fn();
const mockUseGetOpenAIOAuthUsageQuery = jest.fn();
const mockUseGetOpenAIOAuthCodexLoginStatusQuery = jest.fn();
const mockUseGetOpenAIOAuthTokenStatusQuery = jest.fn();
const mockUseCancelOpenAIOAuthCodexLoginMutation = jest.fn();
const mockUseRefreshOpenAIOAuthTokenMutation = jest.fn();
const mockUseLogoutOpenAIOAuthCodexMutation = jest.fn();
const mockUseStartOpenAIOAuthCodexLoginMutation = jest.fn();
const mockUseAuthContext = jest.fn();
const mockWindowOpen = jest.fn();
const mockClipboardWriteText = jest.fn();

jest.mock('~/data-provider', () => ({
  useCancelOpenAIOAuthCodexLoginMutation: () => mockUseCancelOpenAIOAuthCodexLoginMutation(),
  useGetOpenAIOAuthCodexLoginStatusQuery: (...args: unknown[]) =>
    mockUseGetOpenAIOAuthCodexLoginStatusQuery(...args),
  useGetOpenAIOAuthUsageQuery: () => mockUseGetOpenAIOAuthUsageQuery(),
  useGetOpenAIOAuthTokenStatusQuery: () => mockUseGetOpenAIOAuthTokenStatusQuery(),
  useLogoutOpenAIOAuthCodexMutation: () => mockUseLogoutOpenAIOAuthCodexMutation(),
  useRefreshOpenAIOAuthTokenMutation: () => mockUseRefreshOpenAIOAuthTokenMutation(),
  useStartOpenAIOAuthCodexLoginMutation: () => mockUseStartOpenAIOAuthCodexLoginMutation(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockQueryClientInvalidateQueries,
    refetchQueries: mockQueryClientRefetchQueries,
    removeQueries: mockQueryClientRemoveQueries,
    setQueryData: mockQueryClientSetQueryData,
  }),
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => mockUseAuthContext(),
  useLocalize: () => (key: string) =>
    ({
      com_ui_access_token: 'Access token',
      com_ui_available: 'Available',
      com_ui_back: 'Back',
      com_ui_checked: 'Checked',
      com_ui_codex_cli: 'Codex CLI',
      com_ui_codex_app_server: 'Codex app-server',
      com_ui_codex_login: 'Login Codex',
      com_ui_codex_login_unavailable: 'Codex CLI unavailable',
      com_ui_copied: 'Copied!',
      com_ui_browser_login: 'Browser login',
      com_ui_cancel: 'Cancel',
      com_ui_confirm: 'Confirm',
      com_ui_confirm_logout: 'Are you sure you want to log out of OpenAI OAuth?',
      com_ui_copy: 'Copy',
      com_ui_copy_verification_code_first: 'Copy the verification code first.',
      com_ui_device_code_login: 'Device code login',
      com_ui_device_code_login_recommended: 'Device code is recommended.',
      com_ui_expires: 'Expires',
      com_ui_expired: 'Expired',
      com_ui_login_failed: 'Failed',
      com_ui_login_pending: 'Pending',
      com_ui_login_starting: 'Starting...',
      com_ui_login_status: 'Login status',
      com_ui_login_url: 'Login URL',
      com_ui_logged_out: 'Logged out',
      com_ui_logging_out: 'Logging out...',
      com_ui_logout: 'Logout',
      com_ui_logout_failed: 'Logout failed',
      com_ui_oauth_token: 'OAuth token',
      com_ui_loading: 'Loading...',
      com_ui_open_link: 'Open link',
      com_ui_open_link_to_finish_login: 'Open the page to complete login verification.',
      com_ui_refresh_failed: 'Refresh failed',
      com_ui_refresh: 'Refresh',
      com_ui_refreshing: 'Refreshing...',
      com_ui_refresh_token: 'Refresh token',
      com_ui_status: 'Status',
      com_ui_unavailable: 'Unavailable',
      com_ui_close: 'Close',
      com_ui_usage_remaining: 'Usage remaining',
      com_ui_valid: 'Valid',
      com_ui_verification_code: 'Verification code',
      com_ui_weekly: 'Weekly',
    })[key] ?? key,
}));

function OpenAIOAuthUsageRemainingHarness({ showUsage = true }: { showUsage?: boolean }) {
  return (
    <OpenAIOAuthCodexLoginProvider>
      {showUsage && <OpenAIOAuthUsageRemaining />}
      <OpenAIOAuthCodexLoginDialog />
      <OpenAIOAuthCodexLogoutDialog />
    </OpenAIOAuthCodexLoginProvider>
  );
}

function renderOpenAIOAuthUsageRemaining() {
  return render(<OpenAIOAuthUsageRemainingHarness />);
}

describe('OpenAIOAuthUsageRemaining', () => {
  beforeEach(() => {
    mockUseGetOpenAIOAuthUsageQuery.mockReset();
    mockUseGetOpenAIOAuthCodexLoginStatusQuery.mockReset();
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReset();
    mockUseCancelOpenAIOAuthCodexLoginMutation.mockReset();
    mockUseRefreshOpenAIOAuthTokenMutation.mockReset();
    mockUseLogoutOpenAIOAuthCodexMutation.mockReset();
    mockUseStartOpenAIOAuthCodexLoginMutation.mockReset();
    mockUseAuthContext.mockReset();
    mockQueryClientInvalidateQueries.mockReset();
    mockQueryClientRefetchQueries.mockReset();
    mockQueryClientRemoveQueries.mockReset();
    mockQueryClientSetQueryData.mockReset();
    mockWindowOpen.mockReset();
    mockClipboardWriteText.mockReset();
    mockClipboardWriteText.mockResolvedValue(undefined);
    window.sessionStorage.clear();
    mockWindowOpen.mockReturnValue(null);
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: mockWindowOpen,
      writable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockClipboardWriteText,
      },
    });
    mockUseAuthContext.mockReturnValue({ user: { role: 'USER' } });
    mockUseGetOpenAIOAuthCodexLoginStatusQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
    });
    mockUseRefreshOpenAIOAuthTokenMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate: jest.fn(),
    });
    mockUseCancelOpenAIOAuthCodexLoginMutation.mockReturnValue({
      isError: false,
      isLoading: false,
      mutate: jest.fn((_sessionId, options?: { onSuccess?: () => void }) => options?.onSuccess?.()),
    });
    mockUseLogoutOpenAIOAuthCodexMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate: jest.fn(),
      reset: jest.fn(),
    });
    mockUseStartOpenAIOAuthCodexLoginMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate: jest.fn(),
      reset: jest.fn(),
    });
  });

  it('renders primary and weekly remaining windows', () => {
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [
          {
            key: 'primary',
            usedPercent: 20,
            remainingPercent: 80,
            limitReached: false,
            limitWindowSeconds: 18000,
            resetAfterSeconds: 14685,
            resetAt: '2026-06-26T11:06:09.000Z',
          },
          {
            key: 'secondary',
            usedPercent: 45,
            remainingPercent: 55,
            limitReached: false,
            limitWindowSeconds: 604800,
            resetAfterSeconds: 517868,
            resetAt: '2026-07-02T06:52:32.000Z',
          },
        ],
      },
      isError: false,
      isLoading: false,
    });

    renderOpenAIOAuthUsageRemaining();

    expect(screen.getByText('Usage remaining')).toBeInTheDocument();
    expect(screen.getByText('5h')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
  });

  it('renders the available parts of partial usage windows', () => {
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [
          {
            key: 'primary',
            usedPercent: 20,
            remainingPercent: 80,
            limitReached: false,
          },
          {
            key: 'secondary',
            usedPercent: 45,
            remainingPercent: 55,
            limitReached: false,
          },
        ],
      },
      isError: false,
      isLoading: false,
    });

    renderOpenAIOAuthUsageRemaining();

    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.queryByText('NaNm')).not.toBeInTheDocument();
    expect(screen.queryByText(/Unavailable/)).not.toBeInTheDocument();
  });

  it('labels a seven-day primary window as weekly when secondary is missing', () => {
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [
          {
            key: 'primary',
            usedPercent: 45,
            remainingPercent: 55,
            limitWindowSeconds: 604800,
            limitReached: false,
          },
        ],
      },
      isError: false,
      isLoading: false,
    });

    renderOpenAIOAuthUsageRemaining();

    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.queryByText('5h')).not.toBeInTheDocument();
  });

  it('renders loading state', () => {
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      isError: false,
      isLoading: true,
    });

    renderOpenAIOAuthUsageRemaining();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders unavailable state', () => {
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'unavailable',
        reason: 'auth_unavailable',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });

    renderOpenAIOAuthUsageRemaining();

    expect(screen.getByText('Unavailable: auth_unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('openai-oauth-status-dot-red')).toBeInTheDocument();
  });

  it('renders OAuth token status and actions for admins only', () => {
    const refreshToken = jest.fn();
    const refreshUsage = jest.fn();
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'unavailable',
        reason: 'auth_unavailable',
        windows: [],
      },
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: refreshUsage,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'available',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        accessToken: {
          status: 'valid',
          expiresAt: '2026-07-18T02:34:02.000Z',
          expiresInSeconds: 864000,
        },
        refresh: {
          available: true,
        },
        login: {
          available: false,
          reason: 'codex_cli_unavailable',
        },
      },
      isError: false,
      isLoading: false,
    });
    mockUseRefreshOpenAIOAuthTokenMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate: refreshToken,
    });
    renderOpenAIOAuthUsageRemaining();

    expect(screen.getByText('OAuth token')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.getByText('Codex app-server')).toBeInTheDocument();
    expect(screen.getByText('Codex app-server').closest('div')).toHaveTextContent('Unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh token' }));
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Login Codex' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeEnabled();
  });

  it('starts Codex login and shows the device login details for admins', async () => {
    const mutate = jest.fn((_payload, options?: { onSuccess?: (data: unknown) => void }) => {
      options?.onSuccess?.({
        status: 'pending',
        sessionId: 'session_1',
        startedAt: '2026-07-08T02:34:02.000Z',
        updatedAt: '2026-07-08T02:34:02.000Z',
        expiresAt: '2026-07-08T02:44:02.000Z',
      });
    });
    const cancelMutate = jest.fn((_sessionId, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'unavailable',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        reason: 'auth_unavailable',
        accessToken: {
          status: 'unknown',
        },
        refresh: {
          available: false,
        },
        login: {
          available: true,
        },
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthCodexLoginStatusQuery.mockImplementation((sessionId?: string) => ({
      data: sessionId
        ? {
            status: 'pending',
            sessionId,
            startedAt: '2026-07-08T02:34:02.000Z',
            updatedAt: '2026-07-08T02:34:03.000Z',
            expiresAt: '2026-07-08T02:44:02.000Z',
            device: {
              verificationUri: 'https://auth.openai.com/codex/device',
              userCode: 'ABCD-EFGH1',
            },
          }
        : undefined,
      isError: false,
      isLoading: false,
    }));
    mockUseStartOpenAIOAuthCodexLoginMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate,
      reset: jest.fn(),
    });
    mockUseCancelOpenAIOAuthCodexLoginMutation.mockReturnValue({
      isError: false,
      isLoading: false,
      mutate: cancelMutate,
    });

    renderOpenAIOAuthUsageRemaining();

    fireEvent.click(screen.getByRole('button', { name: 'Login Codex' }));

    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Device code login' }));
    expect(mutate).toHaveBeenCalledWith('device_code', expect.any(Object));
    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('openai_oauth_codex_login_session_id')).toBe('session_1');
    await waitFor(() =>
      expect(screen.getByText('Status').closest('div')).toHaveTextContent('Pending'),
    );
    expect(screen.getByText('Login status').closest('div')).toHaveTextContent('Pending');
    expect(screen.getAllByTestId('openai-oauth-status-dot-yellow')).toHaveLength(2);
    expect(screen.getByLabelText('Login URL')).toHaveValue('https://auth.openai.com/codex/device');
    expect(screen.getByRole('button', { name: 'Open link' })).toBeDisabled();
    expect(screen.getByText('Copy the verification code first.')).toBeInTheDocument();
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(mockClipboardWriteText).toHaveBeenCalledWith('ABCD-EFGH1'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument(),
    );
    expect(screen.queryByText('Copy the verification code first.')).not.toBeInTheDocument();
    expect(screen.getByText('Open the page to complete login verification.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://auth.openai.com/codex/device',
      '_blank',
      'noopener,noreferrer',
    );
    expect(screen.getByText('ABCD-EFGH1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(cancelMutate).toHaveBeenCalledWith('session_1', expect.any(Object));
    expect(window.sessionStorage.getItem('openai_oauth_codex_login_session_id')).toBeNull();
    expect(screen.getByRole('button', { name: 'Device code login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browser login' })).toBeInTheDocument();
  });

  it('logs out from the OAuth token actions and clears the login session', async () => {
    window.sessionStorage.setItem('openai_oauth_codex_login_session_id', 'session_old');
    const mutate = jest.fn((_payload, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: { status: 'available', windows: [] },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'available',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        accessToken: { status: 'valid' },
        refresh: { available: true },
        login: { available: true },
      },
      isError: false,
      isLoading: false,
    });
    mockUseLogoutOpenAIOAuthCodexMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate,
      reset: jest.fn(),
    });

    const { rerender } = renderOpenAIOAuthUsageRemaining();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText('Are you sure you want to log out of OpenAI OAuth?'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(mutate).toHaveBeenCalledWith(undefined, expect.any(Object));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(<OpenAIOAuthUsageRemainingHarness showUsage={false} />);
    expect(screen.queryByText('Usage remaining')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    mockUseLogoutOpenAIOAuthCodexMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
      isSuccess: false,
      mutate,
    });
    rerender(<OpenAIOAuthUsageRemainingHarness />);
    expect(within(screen.getByRole('dialog')).getByText('Logging out...')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByRole('button')).not.toBeInTheDocument();
    mockUseLogoutOpenAIOAuthCodexMutation.mockReturnValue({
      data: { status: 'succeeded', fetchedAt: '2026-07-08T02:35:02.000Z' },
      isError: false,
      isLoading: false,
      isSuccess: true,
      mutate,
    });
    rerender(<OpenAIOAuthUsageRemainingHarness />);
    expect(within(screen.getByRole('dialog')).getByText('Logged out')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('openai_oauth_codex_login_session_id')).toBeNull();
    expect(mockQueryClientRemoveQueries).toHaveBeenCalledWith(['openAIOAuthCodexLoginStatus']);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('starts structured browser login from the login method dialog', () => {
    const mutate = jest.fn((_method, options?: { onSuccess?: (data: unknown) => void }) => {
      options?.onSuccess?.({
        status: 'pending',
        method: 'browser',
        sessionId: 'session_browser',
        startedAt: '2026-07-08T02:34:02.000Z',
        updatedAt: '2026-07-08T02:34:02.000Z',
        browser: { authUrl: 'https://auth.openai.com/oauth/authorize' },
      });
    });
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: { status: 'available', windows: [] },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'unavailable',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        accessToken: { status: 'unknown' },
        refresh: { available: false },
        login: { available: true },
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthCodexLoginStatusQuery.mockImplementation((sessionId?: string) => ({
      data: sessionId
        ? {
            status: 'pending',
            method: 'browser',
            sessionId,
            startedAt: '2026-07-08T02:34:02.000Z',
            updatedAt: '2026-07-08T02:34:02.000Z',
            browser: { authUrl: 'https://auth.openai.com/oauth/authorize' },
          }
        : undefined,
      isError: false,
      isLoading: false,
    }));
    mockUseStartOpenAIOAuthCodexLoginMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate,
      reset: jest.fn(),
    });

    renderOpenAIOAuthUsageRemaining();
    expect(screen.getByRole('button', { name: 'Login Codex' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh token' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Login Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browser login' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));

    expect(mutate).toHaveBeenCalledWith('browser', expect.any(Object));
    expect(screen.getByText('Login URL').previousElementSibling).toBeNull();
    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/authorize',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('shows only the Login URL skeleton while browser login is starting', () => {
    const mutate = jest.fn();
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: { status: 'available', windows: [] },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'unavailable',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        accessToken: { status: 'unknown' },
        refresh: { available: false },
        login: { available: true },
      },
      isError: false,
      isLoading: false,
    });
    mockUseStartOpenAIOAuthCodexLoginMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate,
      reset: jest.fn(),
    });

    const { rerender } = render(<OpenAIOAuthUsageRemainingHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Login Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browser login' }));
    mockUseStartOpenAIOAuthCodexLoginMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
      isSuccess: false,
      mutate,
      reset: jest.fn(),
    });
    rerender(<OpenAIOAuthUsageRemainingHarness />);

    expect(screen.getAllByRole('status', { name: 'Loading...' })).toHaveLength(1);
    expect(screen.getByText('Login URL').previousElementSibling).toBeNull();
  });

  it('cancels and clears a pending login when the modal closes', async () => {
    window.sessionStorage.setItem('openai_oauth_codex_login_session_id', 'stale_session');
    const mutate = jest.fn();
    const cancelMutate = jest.fn((_sessionId, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'unavailable',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        reason: 'auth_unavailable',
        accessToken: {
          status: 'unknown',
        },
        refresh: {
          available: false,
        },
        login: {
          available: true,
        },
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthCodexLoginStatusQuery.mockImplementation((sessionId?: string) => ({
      data:
        sessionId === 'stale_session'
          ? {
              status: 'pending',
              sessionId,
              startedAt: '2026-07-08T02:30:02.000Z',
              updatedAt: '2026-07-08T02:31:02.000Z',
              expiresAt: '2026-07-08T02:44:02.000Z',
              device: {
                verificationUri: 'https://auth.openai.com/codex/device',
                userCode: 'ABCD-12345',
              },
            }
          : undefined,
      isError: false,
      isLoading: false,
    }));
    mockUseStartOpenAIOAuthCodexLoginMutation.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isSuccess: false,
      mutate,
      reset: jest.fn(),
    });
    mockUseCancelOpenAIOAuthCodexLoginMutation.mockReturnValue({
      isError: false,
      isLoading: false,
      mutate: cancelMutate,
    });

    renderOpenAIOAuthUsageRemaining();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(mutate).not.toHaveBeenCalled();
    expect(cancelMutate).toHaveBeenCalledWith('stale_session', expect.any(Object));
    expect(window.sessionStorage.getItem('openai_oauth_codex_login_session_id')).toBeNull();
    expect(screen.queryByText('ABCD-12345')).not.toBeInTheDocument();
  });

  it('shows the sanitized start-login failure reason from an HTTP error body', async () => {
    const mutate = jest.fn(
      (
        _payload,
        options?: {
          onError?: (error: unknown) => void;
        },
      ) => {
        options?.onError?.({
          response: {
            data: {
              status: 'unavailable',
              startedAt: '2026-07-08T02:34:02.000Z',
              updatedAt: '2026-07-08T02:34:02.000Z',
              reason: 'codex_cli_unavailable',
            },
          },
        });
      },
    );
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'unavailable',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        reason: 'auth_unavailable',
        accessToken: {
          status: 'unknown',
        },
        refresh: {
          available: false,
        },
        login: {
          available: true,
        },
      },
      isError: false,
      isLoading: false,
    });
    mockUseStartOpenAIOAuthCodexLoginMutation.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      isSuccess: false,
      mutate,
      reset: jest.fn(),
    });

    renderOpenAIOAuthUsageRemaining();

    fireEvent.click(screen.getByRole('button', { name: 'Login Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Device code login' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Login status').closest('div')).toHaveTextContent(
        'Failed: codex_cli_unavailable',
      ),
    );
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });

  it('restores a pending Codex login modal after the model overlay remounts', async () => {
    window.sessionStorage.setItem('openai_oauth_codex_login_session_id', 'session_1');
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'unavailable',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        reason: 'auth_unavailable',
        accessToken: {
          status: 'unknown',
        },
        refresh: {
          available: false,
        },
        login: {
          available: true,
        },
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthCodexLoginStatusQuery.mockImplementation((sessionId?: string) => ({
      data:
        sessionId === 'session_1'
          ? {
              status: 'pending',
              sessionId,
              startedAt: '2026-07-08T02:34:02.000Z',
              updatedAt: '2026-07-08T02:34:03.000Z',
              expiresAt: '2026-07-08T02:44:02.000Z',
              device: {
                verificationUri: 'https://auth.openai.com/codex/device',
                userCode: 'WXYZ-12345',
              },
            }
          : undefined,
      isError: false,
      isLoading: false,
    }));

    const { rerender } = render(<OpenAIOAuthUsageRemainingHarness />);

    expect(mockUseGetOpenAIOAuthCodexLoginStatusQuery).toHaveBeenCalledWith(
      'session_1',
      expect.objectContaining({
        enabled: true,
      }),
    );
    expect(screen.getByText('Status').closest('div')).toHaveTextContent('Pending');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Login URL')).toHaveValue('https://auth.openai.com/codex/device');
    expect(screen.getByText('WXYZ-12345')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open link' })).toBeDisabled();
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
    expect(mockWindowOpen).not.toHaveBeenCalled();

    rerender(<OpenAIOAuthUsageRemainingHarness showUsage={false} />);

    expect(screen.queryByText('Usage remaining')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('WXYZ-12345')).toBeInTheDocument();
  });

  it('shows Login instead of Logout when a stale token snapshot has a timed-out login', async () => {
    window.sessionStorage.setItem('openai_oauth_codex_login_session_id', 'stale_session');
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'available',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        accessToken: {
          status: 'valid',
        },
        refresh: {
          available: false,
        },
        login: {
          available: true,
        },
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthCodexLoginStatusQuery.mockReturnValue({
      data: {
        status: 'failed',
        reason: 'login_timeout',
        sessionId: 'stale_session',
        startedAt: '2026-07-08T02:34:02.000Z',
        updatedAt: '2026-07-08T02:44:02.000Z',
      },
      isError: false,
      isLoading: false,
    });

    renderOpenAIOAuthUsageRemaining();

    await waitFor(() =>
      expect(screen.getByText('Login status').closest('div')).toHaveTextContent(
        'Failed: login_timeout',
      ),
    );
    expect(window.sessionStorage.getItem('openai_oauth_codex_login_session_id')).toBeNull();
    expect(screen.getByText('Status').closest('div')).toHaveTextContent('Failed: login_timeout');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Login Codex' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  });

  it('does not render stale prose that looks like a Codex device code', () => {
    window.sessionStorage.setItem('openai_oauth_codex_login_session_id', 'session_1');
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthTokenStatusQuery.mockReturnValue({
      data: {
        provider: 'openai_oauth_responses',
        status: 'unavailable',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        reason: 'auth_unavailable',
        accessToken: {
          status: 'unknown',
        },
        refresh: {
          available: false,
        },
        login: {
          available: true,
        },
      },
      isError: false,
      isLoading: false,
    });
    mockUseGetOpenAIOAuthCodexLoginStatusQuery.mockReturnValue({
      data: {
        status: 'pending',
        sessionId: 'session_1',
        startedAt: '2026-07-08T02:34:02.000Z',
        updatedAt: '2026-07-08T02:34:03.000Z',
        expiresAt: '2026-07-08T02:44:02.000Z',
        device: {
          verificationUri: 'https://auth.openai.com/codex/device',
          userCode: 'OPEN-THIS',
        },
      },
      isError: false,
      isLoading: false,
    });

    renderOpenAIOAuthUsageRemaining();

    expect(screen.getByText('Status').closest('div')).toHaveTextContent('Pending');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('OPEN-THIS')).not.toBeInTheDocument();
  });

  it('does not render OAuth token controls for non-admin users', async () => {
    window.sessionStorage.setItem('openai_oauth_codex_login_session_id', 'stale_session');
    mockUseAuthContext.mockReturnValue({ user: { role: 'USER' } });
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'unavailable',
        reason: 'auth_unavailable',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });

    renderOpenAIOAuthUsageRemaining();

    expect(screen.queryByText('OAuth token')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh token' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login Codex' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(window.sessionStorage.getItem('openai_oauth_codex_login_session_id')).toBeNull(),
    );
  });
});
