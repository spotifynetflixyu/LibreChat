import { SSE } from 'sse.js';
import { Provider, createStore } from 'jotai';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DynamicQueryKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type { OpenAIOAuthTokenStatus, SteelQuotationStatus } from 'librechat-data-provider';
import type { PropsWithChildren } from 'react';
import {
  useGetSteelQuotationStatusQuery,
  useGetSteelReviewReceiptQuery,
  useLogoutOpenAIOAuthCodexMutation,
  useRefreshOpenAIOAuthTokenMutation,
} from '../queries';
import { trackSteelStream, writeSteelFlowStatus } from '../flow';

jest.mock('recoil', () => ({
  useRecoilValue: jest.fn(() => true),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { queriesEnabled: {} },
}));

const recoil = jest.requireMock('recoil') as { useRecoilValue: jest.Mock };

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

describe('Steel flow status cache', () => {
  const conversationId = 'conversation-flow';
  const running: SteelQuotationStatus = {
    conversationId,
    index: 1,
    runId: 'run-a',
    status: 'running',
    completedChunks: 0,
    totalChunks: 3,
  };

  it('shares a fresh status across mounts and preserves a replaced run’s own progress', async () => {
    const client = new QueryClient();
    const getStatus = jest.spyOn(dataService, 'getSteelQuotationStatus').mockResolvedValue({
      ...running,
      completedChunks: 1,
    });
    const Wrapper = createWrapper(client);
    const first = renderHook(
      () => useGetSteelQuotationStatusQuery(conversationId, 'run-a', running),
      {
        wrapper: Wrapper,
      },
    );
    await waitFor(() => expect(first.result.current.data?.completedChunks).toBe(1));
    renderHook(() => useGetSteelQuotationStatusQuery(conversationId, 'run-a', running), {
      wrapper: Wrapper,
    });
    expect(getStatus).toHaveBeenCalledTimes(1);

    getStatus.mockResolvedValue({ ...running, index: 2, runId: 'run-b', completedChunks: 3 });
    await act(async () => {
      const refreshed = await first.result.current.refetch();
      expect(refreshed.data).toMatchObject({
        runId: 'run-a',
        latestRunId: 'run-b',
        completedChunks: 1,
      });
    });
  });

  it('expires an older quotation card when a newer terminal run is fetched', async () => {
    const client = new QueryClient();
    const olderKey = DynamicQueryKeys.steelFlowStatus(conversationId, 'quotation', 'run-a');
    client.setQueryData(olderKey, { ...running, status: 'paused', completedChunks: 1 });
    jest.spyOn(dataService, 'getSteelQuotationStatus').mockResolvedValue({
      ...running,
      index: 2,
      runId: 'run-b',
      status: 'completed',
      completedChunks: 3,
    });
    renderHook(() => useGetSteelQuotationStatusQuery(conversationId, 'run-b'), {
      wrapper: createWrapper(client),
    });
    await waitFor(() =>
      expect(client.getQueryData(olderKey)).toMatchObject({
        runId: 'run-a',
        latestRunId: 'run-b',
        status: 'paused',
        completedChunks: 1,
      }),
    );
  });

  it('polls a disconnected running flow once per interval across cards and stops when paused', async () => {
    jest.useFakeTimers();
    try {
      const client = new QueryClient();
      const getStatus = jest
        .spyOn(dataService, 'getSteelQuotationStatus')
        .mockResolvedValueOnce(running)
        .mockResolvedValue({ ...running, status: 'paused' });
      const wrapper = createWrapper(client);
      const useStatus = () => useGetSteelQuotationStatusQuery(conversationId, 'run-a', running);
      renderHook(useStatus, { wrapper });
      renderHook(useStatus, { wrapper });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2_499);
      });
      expect(getStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2);
      });
      expect(getStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      expect(getStatus).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels polling on attach, ignores a late HTTP result, and fetches after the last detach', async () => {
    const client = new QueryClient();
    const store = createStore();
    let resolveStatus: (value: SteelQuotationStatus) => void = () => {};
    const getStatus = jest
      .spyOn(dataService, 'getSteelQuotationStatus')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStatus = resolve;
          }),
      )
      .mockResolvedValue({ ...running, status: 'paused', completedChunks: 2 });
    const createConnection = () => {
      const events = new EventTarget();
      const stream = {
        readyState: Number(SSE.CONNECTING),
        addEventListener: (_event: string, callback: () => void) =>
          events.addEventListener('readystatechange', callback),
      };
      trackSteelStream(client, store, stream, () => conversationId);
      return (state: number) => {
        stream.readyState = state;
        events.dispatchEvent(new Event('readystatechange'));
      };
    };
    const first = createConnection();
    const replacement = createConnection();
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <Provider store={store}>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </Provider>
      );
    }
    const { result } = renderHook(
      () => useGetSteelQuotationStatusQuery(conversationId, 'run-a', running),
      {
        wrapper: Wrapper,
      },
    );
    expect(getStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      first(SSE.OPEN);
      replacement(SSE.OPEN);
      writeSteelFlowStatus(client, conversationId, 'quotation', 'run-a', {
        ...running,
        completedChunks: 2,
      });
      first(SSE.CLOSED);
      resolveStatus(running);
    });
    expect(result.current.data?.completedChunks).toBe(2);
    expect(getStatus).toHaveBeenCalledTimes(1);

    act(() => replacement(SSE.CLOSED));
    await waitFor(() => expect(result.current.data?.status).toBe('paused'));
    expect(getStatus).toHaveBeenCalledTimes(2);
  });
});

describe('Steel review receipt query', () => {
  it('uses only its input and config enabled state', () => {
    recoil.useRecoilValue.mockImplementation(() => {
      throw new Error('receipt query must not read the global Recoil toggle');
    });
    try {
      const { result } = renderHook(
        () =>
          useGetSteelReviewReceiptQuery(
            {
              conversationId: 'conversation-1',
              kind: 'ocr_result',
              messageId: 'message-1',
              title: 'ocr_result',
              outputId: 'ocr_result:generation-1',
              operationId: 'operation-1',
              digest: 'a'.repeat(64),
            },
            { enabled: false },
          ),
        {
          wrapper: createWrapper(new QueryClient()),
        },
      );
      expect(result.current.fetchStatus).toBe('idle');
    } finally {
      recoil.useRecoilValue.mockImplementation(() => true);
    }
  });
});
