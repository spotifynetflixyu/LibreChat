import { useRecoilValue } from 'recoil';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DynamicQueryKeys,
  MutationKeys,
  QueryKeys,
  dataService,
  isSteelQuotationActiveStatus,
} from 'librechat-data-provider';
import type {
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenLoginMethod,
  OpenAIOAuthTokenLogoutStatus,
  OpenAIOAuthTokenStatus,
  OpenAIOAuthUsageRemaining,
  SteelCatalogQuery,
  SteelCustomerCommit,
  SteelCustomerQuery,
  SteelCustomerResponse,
  SteelCustomerSaveResponse,
  SteelReviewKind,
  SteelReviewCommit,
  SteelReviewPrepare,
  SteelReviewPrepared,
  SteelReviewResponse,
  SteelMarkdownVersions,
  SteelReviewReceiptStatus,
  SteelReviewSaveResponse,
  SteelReviewSourcesResponse,
  SteelReviewSourcePageCount,
  SteelQuotationStatus,
  TMessage,
} from 'librechat-data-provider';
import type {
  QueryObserverResult,
  UseMutationResult,
  UseQueryOptions,
} from '@tanstack/react-query';
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

export const useGetSteelMarkdownVersionsQuery = (
  conversationId: string,
  enabled: boolean,
): QueryObserverResult<SteelMarkdownVersions> => useQuery<SteelMarkdownVersions>(
  DynamicQueryKeys.steelMarkdownVersions(conversationId),
  () => dataService.getSteelMarkdownVersions(conversationId),
  { enabled, staleTime: Infinity, refetchOnWindowFocus: false },
);

export const useGetSteelCustomerQuery = (
  input?: SteelCustomerQuery | null,
  config?: UseQueryOptions<SteelCustomerResponse>,
): QueryObserverResult<SteelCustomerResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  const enabled = Boolean(input) && (config?.enabled ?? true) && queriesEnabled;
  return useQuery<SteelCustomerResponse>(
    DynamicQueryKeys.steelCustomer(
      input?.conversationId ?? '',
      input?.messageId ?? '',
      input?.title ?? '',
      input?.outputId ?? '',
    ),
    () => dataService.getSteelCustomer(input!),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 0,
      ...config,
      enabled,
    },
  );
};

export const useGetSteelReviewQuery = (
  input?: {
    conversationId: string;
    kind: SteelReviewKind;
    messageId: string;
    title: string;
  } | null,
  config?: UseQueryOptions<SteelReviewResponse>,
): QueryObserverResult<SteelReviewResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  const enabled = Boolean(input) && (config?.enabled ?? true) && queriesEnabled;
  return useQuery<SteelReviewResponse>(
    DynamicQueryKeys.steelReview(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.messageId ?? '',
      input?.title ?? '',
    ),
    () => dataService.getSteelReview(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.messageId ?? '',
      input?.title ?? '',
    ),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 0,
      ...config,
      enabled,
    },
  );
};

export const useGetSteelReviewSourcesQuery = (
  input?: {
    conversationId: string;
    kind: SteelReviewKind;
    messageId: string;
    title: string;
  } | null,
  config?: UseQueryOptions<SteelReviewSourcesResponse>,
): QueryObserverResult<SteelReviewSourcesResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  const enabled = Boolean(input) && (config?.enabled ?? true) && queriesEnabled;
  return useQuery<SteelReviewSourcesResponse>(
    DynamicQueryKeys.steelReviewSources(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.messageId ?? '',
      input?.title ?? '',
    ),
    () => dataService.getSteelReviewSources(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.messageId ?? '',
      input?.title ?? '',
    ),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 30_000,
      ...config,
      enabled,
    },
  );
};

export const useGetSteelReviewSourceQuery = (
  input?: {
    conversationId: string;
    kind: SteelReviewKind;
    fileId: string;
    messageId: string;
  } | null,
  config?: UseQueryOptions<Blob>,
): QueryObserverResult<Blob> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  const enabled = Boolean(input) && (config?.enabled ?? true) && queriesEnabled;
  return useQuery<Blob>(
    DynamicQueryKeys.steelReviewSource(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.messageId ?? '',
      input?.fileId ?? '',
    ),
    async () => {
      const response = await dataService.getSteelReviewSource(
        input?.conversationId ?? '',
        input?.kind ?? 'ocr_result',
        input?.fileId ?? '',
        input?.messageId ?? '',
      );
      return response.data;
    },
    {
      enabled,
      retry: false,
      staleTime: 0,
      cacheTime: 0,
      ...config,
    },
  );
};

export const useGetSteelReviewSourcePageCountQuery = (
  input?: {
    conversationId: string;
    kind: SteelReviewKind;
    fileId: string;
    messageId: string;
  } | null,
  config?: UseQueryOptions<SteelReviewSourcePageCount>,
): QueryObserverResult<SteelReviewSourcePageCount> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  const enabled = Boolean(input) && (config?.enabled ?? true) && queriesEnabled;
  return useQuery<SteelReviewSourcePageCount>(
    DynamicQueryKeys.steelReviewSourcePageCount(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.messageId ?? '',
      input?.fileId ?? '',
    ),
    () => dataService.getSteelReviewSourcePageCount(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.fileId ?? '',
      input?.messageId ?? '',
    ),
    {
      enabled,
      retry: false,
      staleTime: 30_000,
      ...config,
    },
  );
};

export const usePrepareSteelReviewMutation = (): UseMutationResult<
  SteelReviewPrepared,
  unknown,
  SteelReviewPrepare,
  unknown
> => {
  return useMutation(
    [MutationKeys.prepareSteelReview],
    (input: SteelReviewPrepare) => dataService.prepareSteelReview(input),
  );
};

export const useCommitSteelReviewMutation = (): UseMutationResult<
  SteelReviewSaveResponse,
  unknown,
  SteelReviewCommit,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.commitSteelReview],
    (input: SteelReviewCommit) => dataService.commitSteelReview(input),
    {
      onSuccess: (_data, input) => {
        void queryClient.invalidateQueries(DynamicQueryKeys.steelMarkdownVersions(input.conversationId));
        void queryClient.invalidateQueries(
          DynamicQueryKeys.steelReview(
            input.conversationId,
            input.kind,
            input.messageId,
            input.title,
          ),
        );
      },
    },
  );
};

export const useCommitSteelCustomerMutation = (): UseMutationResult<
  SteelCustomerSaveResponse,
  unknown,
  SteelCustomerCommit,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.commitSteelCustomer],
    (input: SteelCustomerCommit) => dataService.commitSteelCustomer(input),
    {
      onSuccess: (data, input) => {
        const messageQueryKey = [QueryKeys.messages, input.conversationId] as const;
        const messages = queryClient.getQueryData<TMessage[]>(messageQueryKey);
        if (messages) {
          queryClient.setQueryData<TMessage[]>(
            messageQueryKey,
            messages.map((message) => {
              if (message.messageId !== data.message.messageId) {
                return message;
              }
              return {
                ...message,
                text: data.message.text,
                ...(data.message.content !== undefined ? { content: data.message.content } : {}),
              };
            }),
          );
        }

        const customerQueryKey = DynamicQueryKeys.steelCustomer(
          input.conversationId,
          input.messageId,
          input.title,
          input.outputId,
        );
        queryClient.setQueryData(customerQueryKey, data);
        const versionsKey = DynamicQueryKeys.steelMarkdownVersions(input.conversationId);
        queryClient.setQueryData<SteelMarkdownVersions>(versionsKey, (current) => current ? {
          ...current,
          versions: current.versions.map((version) =>
            version.kind === 'customer_data' && version.messageId === input.messageId &&
            version.outputId === input.outputId && version.title === input.title
              ? { ...version, revision: data.revision }
              : version),
        } : current);
        void queryClient.invalidateQueries(versionsKey);
        void queryClient.invalidateQueries(customerQueryKey);
        void queryClient.invalidateQueries(
          DynamicQueryKeys.steelQuotationStatus(input.conversationId),
        );
        void queryClient.invalidateQueries([QueryKeys.steelReview, input.conversationId]);
      },
    },
  );
};

export const useGetSteelReviewReceiptQuery = (
  input?: {
    conversationId: string;
    kind: SteelReviewKind;
    messageId: string;
    outputId: string;
    operationId: string;
    digest: string;
    title: string;
  } | null,
  config?: UseQueryOptions<SteelReviewReceiptStatus>,
): QueryObserverResult<SteelReviewReceiptStatus> => {
  const enabled = Boolean(input) && (config?.enabled ?? true);
  return useQuery<SteelReviewReceiptStatus>(
    DynamicQueryKeys.steelReviewReceipt(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.messageId ?? '',
      input?.outputId ?? '',
      input?.operationId ?? '',
      input?.digest ?? '',
      input?.title ?? '',
    ),
    () => dataService.getSteelReviewReceipt(
      input?.conversationId ?? '',
      input?.kind ?? 'ocr_result',
      input?.messageId ?? '',
      input?.outputId ?? '',
      input?.operationId ?? '',
      input?.digest ?? '',
      input?.title ?? '',
    ),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
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

export const useGetSteelReviewCatalogQuery = (
  conversationId: string,
  input: SteelCatalogQuery,
  enabled: boolean,
  onQuery?: () => void,
) => {
  const queryClient = useQueryClient();
  const key = DynamicQueryKeys.steelReviewCatalog(conversationId, input);
  return useInfiniteQuery(
    key,
    ({ pageParam, signal }) => {
      onQuery?.();
      const query = {
        ...input,
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
      };
      return signal
        ? dataService.getSteelReviewCatalog(conversationId, query, signal)
        : dataService.getSteelReviewCatalog(conversationId, query);
    },
    {
      enabled: enabled && queryClient.getQueryData(key) === undefined,
      staleTime: Infinity,
      cacheTime: 0,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    },
  );
};
