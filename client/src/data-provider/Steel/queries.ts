import { useRecoilValue } from 'recoil';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  QueryObserverResult,
  UseMutationResult,
  UseQueryOptions,
} from '@tanstack/react-query';
import type {
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenStatus,
  OpenAIOAuthUsageRemaining,
} from 'librechat-data-provider';
import store from '~/store';

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
        queryClient.invalidateQueries([QueryKeys.openAIOAuthUsage]);
      },
    },
  );
};

export const useStartOpenAIOAuthCodexLoginMutation = (): UseMutationResult<
  OpenAIOAuthTokenLoginStatus,
  unknown,
  void,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.startOpenAIOAuthCodexLogin],
    () => dataService.startOpenAIOAuthCodexLogin(),
    {
      onSuccess: (data) => {
        if (data.sessionId) {
          queryClient.setQueryData([QueryKeys.openAIOAuthCodexLoginStatus, data.sessionId], data);
        }
        if (data.status === 'succeeded' && data.token) {
          queryClient.setQueryData([QueryKeys.openAIOAuthTokenStatus], data.token);
          queryClient.invalidateQueries([QueryKeys.openAIOAuthUsage]);
        }
      },
    },
  );
};
