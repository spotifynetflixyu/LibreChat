import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentTypes, DynamicQueryKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type {
  SteelCustomerCommit,
  SteelCustomerSaveResponse,
  SteelMarkdownVersions,
  TMessage,
} from 'librechat-data-provider';
import type { PropsWithChildren } from 'react';
import { useCommitSteelCustomerMutation } from './queries';

jest.mock('recoil', () => ({
  useRecoilValue: jest.fn(() => true),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { queriesEnabled: {} },
}));

const input: SteelCustomerCommit = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  title: 'customer_data',
  outputId: 'customer-1',
  revision: 'revision-1',
  tier: 'F',
  expectedTier: 'B',
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createMessage(messageId: string, text: string): TMessage {
  return {
    messageId,
    conversationId: input.conversationId,
    parentMessageId: null,
    text,
    isCreatedByUser: false,
    metadata: { persisted: true },
    files: [{ file_id: 'file-1' }],
    content: [{ type: ContentTypes.TEXT, text }],
  };
}

describe('useCommitSteelCustomerMutation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('patches the saved message and invalidates related Steel queries', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const target = createMessage(input.messageId, 'old customer data');
    const sibling = createMessage('message-2', 'sibling response');
    const messages = [target, sibling];
    const messageQueryKey = [QueryKeys.messages, input.conversationId] as const;
    const customerQueryKey = DynamicQueryKeys.steelCustomer(
      input.conversationId,
      input.messageId,
      input.title,
      input.outputId,
    );
    queryClient.setQueryData(messageQueryKey, messages);
    const boundVersion = { kind: 'customer_data' as const, messageId: input.messageId, title: input.title,
      outputId: input.outputId, revision: input.revision, latest: true, saves: 0 };
    const historyVersion = { ...boundVersion, messageId: 'history-message', latest: false };
    const versionsKey = DynamicQueryKeys.steelMarkdownVersions(input.conversationId);
    queryClient.setQueryData(versionsKey, { versions: [boundVersion, historyVersion] });

    const response: SteelCustomerSaveResponse = {
      conversationId: input.conversationId,
      messageId: input.messageId,
      title: input.title,
      outputId: input.outputId,
      revision: 'revision-2',
      tier: input.tier,
      latest: true,
      message: {
        messageId: input.messageId,
        text: 'updated customer data',
        content: [{ type: ContentTypes.TEXT, text: 'updated customer data' }],
      },
    };
    jest.spyOn(dataService, 'commitSteelCustomer').mockResolvedValue(response);
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCommitSteelCustomerMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    const patchedMessages = queryClient.getQueryData<TMessage[]>(messageQueryKey);
    expect(patchedMessages?.[0]).toMatchObject({
      messageId: input.messageId,
      text: 'updated customer data',
      content: [{ type: ContentTypes.TEXT, text: 'updated customer data' }],
    });
    expect(patchedMessages?.[0].metadata).toBe(target.metadata);
    expect(patchedMessages?.[0].files).toBe(target.files);
    expect(patchedMessages?.[1]).toBe(sibling);
    expect(queryClient.getQueryData(customerQueryKey)).toEqual(response);
    const versions = queryClient.getQueryData<SteelMarkdownVersions>(versionsKey)?.versions;
    expect(versions?.[0]).toEqual({ ...boundVersion, revision: response.revision });
    expect(versions?.[1]).toBe(historyVersion);
    expect(invalidate).toHaveBeenCalledWith(
      DynamicQueryKeys.steelMarkdownVersions(input.conversationId),
    );
    expect(invalidate).toHaveBeenCalledWith(customerQueryKey);
    expect(invalidate).toHaveBeenCalledWith(
      DynamicQueryKeys.steelQuotationStatus(input.conversationId),
    );
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.steelReview, input.conversationId]);
  });
});
