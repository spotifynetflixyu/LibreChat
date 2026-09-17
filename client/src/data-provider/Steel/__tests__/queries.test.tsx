import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { PropsWithChildren } from 'react';
import type { OpenAIOAuthTokenStatus } from 'librechat-data-provider';

import {
  useCancelSteelQuotationMutation,
  useLogoutOpenAIOAuthCodexMutation,
  useRefreshOpenAIOAuthTokenMutation,
} from '../queries';

jest.mock('recoil', () => ({
  useRecoilValue: () => true,
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { queriesEnabled: {} },
}));

const token: OpenAIOAuthTokenStatus = {
  provider: 'openai_oauth_responses',
  status: 'available',
  fetchedAt: '2026-07-11T14:00:00.000Z',
  accessToken: { status: 'valid' },
  refresh: { available: true },
  login: { available: true },
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('OpenAI OAuth token mutations', () => {
  it('refreshes only token state', async () => {
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const refetch = jest.spyOn(queryClient, 'refetchQueries');
    jest.spyOn(dataService, 'refreshOpenAIOAuthToken').mockResolvedValue(token);
    const { result } = renderHook(() => useRefreshOpenAIOAuthTokenMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(queryClient.getQueryData([QueryKeys.openAIOAuthTokenStatus])).toEqual(token);
    expect(invalidate).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('updates token state and invalidates usage limits after logout', async () => {
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const refetch = jest.spyOn(queryClient, 'refetchQueries');
    const loggedOutToken: OpenAIOAuthTokenStatus = {
      ...token,
      status: 'unavailable',
      reason: 'auth_unavailable',
      accessToken: { status: 'unknown' },
      refresh: { available: false },
    };
    jest.spyOn(dataService, 'logoutOpenAIOAuthCodex').mockResolvedValue({
      status: 'succeeded',
      fetchedAt: '2026-07-11T14:01:00.000Z',
      token: loggedOutToken,
    });
    const { result } = renderHook(() => useLogoutOpenAIOAuthCodexMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(queryClient.getQueryData([QueryKeys.openAIOAuthTokenStatus])).toEqual(loggedOutToken);
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.openAIOAuthUsage]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('Steel quotation cancellation', () => {
  const conversationId = 'conversation-1';
  const runningStatus = {
    conversationId,
    index: 4,
    runId: 'quotation-run-4',
    status: 'running' as const,
    completedChunks: 1,
    totalChunks: 3,
    canCancel: true,
  };

  it('stores the backend cancellation result under the exact status query key', async () => {
    const queryClient = new QueryClient();
    const cancelledStatus = { ...runningStatus, status: 'cancelled' as const, canCancel: false };
    jest.spyOn(dataService, 'cancelSteelQuotation').mockResolvedValue(cancelledStatus);
    const { result } = renderHook(() => useCancelSteelQuotationMutation(conversationId), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(4);
    });

    expect(queryClient.getQueryData([QueryKeys.steelQuotationStatus, conversationId])).toEqual(
      cancelledStatus,
    );
  });

  it('does not fabricate a terminal cancellation result when the API fails', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData([QueryKeys.steelQuotationStatus, conversationId], runningStatus);
    jest.spyOn(dataService, 'cancelSteelQuotation').mockRejectedValue(new Error('request failed'));
    const { result } = renderHook(() => useCancelSteelQuotationMutation(conversationId), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(4)).rejects.toThrow('request failed');
    });

    expect(queryClient.getQueryData([QueryKeys.steelQuotationStatus, conversationId])).toEqual(
      runningStatus,
    );
  });
});
