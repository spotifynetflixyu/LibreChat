import { useRecoilValue } from 'recoil';
import {
  DynamicQueryKeys,
  MutationKeys,
  QueryKeys,
  dataService,
  isSteelQuotationActiveStatus,
} from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  QueryObserverResult,
  UseMutationResult,
  UseQueryOptions,
} from '@tanstack/react-query';
import type {
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenLoginMethod,
  OpenAIOAuthTokenLogoutStatus,
  OpenAIOAuthTokenStatus,
  OpenAIOAuthUsageRemaining,
  SteelQuotationStatus,
} from 'librechat-data-provider';
import store from '~/store';

async function refreshOpenAIOAuthQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  token?: OpenAIOAuthTokenStatus,
): Promise<void> {
  if (token) {
    queryClient.setQueryData([QueryKeys.openAIOAuthTokenStatus], token);
  }
  await queryClient.invalidateQueries([QueryKeys.openAIOAuthUsage]);
}

export const useGetOpenAIOAuthUsageQuery = (
  config?: UseQueryOptions<OpenAIOAuthUsageRemaining>,
): QueryObserverResult<OpenAIOAuthUsageRemaining> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<OpenAIOAuthUsageRemaining>(
    [QueryKeys.openAIOAuthUsage],
    () => dataService.getOpenAIOAuthUsage(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      refetchInterval: (data) => (data?.status === 'unavailable' ? 10_000 : false),
      staleTime: 30_000,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetSteelQuotationStatusQuery = (
  conversationId?: string | null,
  config?: UseQueryOptions<SteelQuotationStatus>,
): QueryObserverResult<SteelQuotationStatus> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  const enabled = Boolean(conversationId) && (config?.enabled ?? true) && queriesEnabled;
  return useQuery<SteelQuotationStatus>(
    DynamicQueryKeys.steelQuotationStatus(conversationId ?? ''),
    () => dataService.getSteelQuotationStatus(conversationId ?? ''),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      refetchInterval: (data) =>
        data && isSteelQuotationActiveStatus(data.status) ? 1_000 : false,
      staleTime: 0,
      ...config,
      enabled,
    },
  );
};

export const useGetOpenAIOAuthTokenStatusQuery = (
  config?: UseQueryOptions<OpenAIOAuthTokenStatus>,
): QueryObserverResult<OpenAIOAuthTokenStatus> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<OpenAIOAuthTokenStatus>(
    [QueryKeys.openAIOAuthTokenStatus],
    () => dataService.getOpenAIOAuthTokenStatus(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 30_000,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetOpenAIOAuthCodexLoginStatusQuery = (
  sessionId?: string,
  config?: UseQueryOptions<OpenAIOAuthTokenLoginStatus>,
): QueryObserverResult<OpenAIOAuthTokenLoginStatus> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<OpenAIOAuthTokenLoginStatus>(
    [QueryKeys.openAIOAuthCodexLoginStatus, sessionId],
    () => dataService.getOpenAIOAuthCodexLoginStatus(sessionId ?? ''),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 0,
      ...config,
      enabled: Boolean(sessionId) && (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useRefreshOpenAIOAuthTokenMutation = (): UseMutationResult<
  OpenAIOAuthTokenStatus,
  unknown,
  void,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.refreshOpenAIOAuthToken],
    () => dataService.refreshOpenAIOAuthToken(),
    {
      onSuccess: (data) => {
        queryClient.setQueryData([QueryKeys.openAIOAuthTokenStatus], data);
      },
    },
  );
};

export const useCancelSteelQuotationMutation = (
  conversationId?: string | null,
): UseMutationResult<SteelQuotationStatus, unknown, number, unknown> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.cancelSteelQuotation, conversationId],
    (index: number) => dataService.cancelSteelQuotation(conversationId ?? '', index),
    {
      onSuccess: (data) => {
        queryClient.setQueryData(DynamicQueryKeys.steelQuotationStatus(conversationId ?? ''), data);
      },
    },
  );
};

export const useStartOpenAIOAuthCodexLoginMutation = (): UseMutationResult<
  OpenAIOAuthTokenLoginStatus,
  unknown,
  OpenAIOAuthTokenLoginMethod,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.startOpenAIOAuthCodexLogin],
    (method) => dataService.startOpenAIOAuthCodexLogin(method),
    {
      onSuccess: async (data) => {
        if (data.sessionId) {
          queryClient.setQueryData([QueryKeys.openAIOAuthCodexLoginStatus, data.sessionId], data);
        }
        if (data.status === 'succeeded' && data.token) {
          await refreshOpenAIOAuthQueries(queryClient, data.token);
        }
      },
    },
  );
};

export const useCancelOpenAIOAuthCodexLoginMutation = (): UseMutationResult<
  void,
  unknown,
  string,
  unknown
> => {
  return useMutation([MutationKeys.cancelOpenAIOAuthCodexLogin], (sessionId) =>
    dataService.cancelOpenAIOAuthCodexLogin(sessionId),
  );
};

export const useLogoutOpenAIOAuthCodexMutation = (): UseMutationResult<
  OpenAIOAuthTokenLogoutStatus,
  unknown,
  void,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.logoutOpenAIOAuthCodex],
    () => dataService.logoutOpenAIOAuthCodex(),
    {
      onSuccess: async (data) => {
        await refreshOpenAIOAuthQueries(queryClient, data.token);
        queryClient.removeQueries([QueryKeys.openAIOAuthCodexLoginStatus]);
      },
    },
  );
};
