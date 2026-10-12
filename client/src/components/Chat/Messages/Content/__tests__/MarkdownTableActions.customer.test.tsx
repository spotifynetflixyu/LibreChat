import React from 'react';
import { RecoilRoot } from 'recoil';
import { DynamicQueryKeys } from 'librechat-data-provider';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SteelMarkdownVersion, TMessage } from 'librechat-data-provider';
import { SteelHeading, SteelVersionsProvider } from '../SteelReview/heading';
import { MessageContext } from '~/Providers/MessageContext';
import MarkdownTableActions from '../MarkdownTableActions';
import store from '~/store';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

function renderCustomer(latest: boolean, outputId = 'customer:current') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const version: SteelMarkdownVersion = {
    messageId: 'customer-message',
    outputId: 'customer:current',
    title: 'customer_data',
    kind: 'customer_data',
    revision: 'customer-revision',
    latest,
    saves: 0,
  };
  const header = '價格等級';
  const message: TMessage = {
    messageId: version.messageId,
    conversationId: 'customer-conversation',
    parentMessageId: null,
    text: '## customer_data\n\n| 價格等級 |\n| --- |\n| B |',
    isCreatedByUser: false,
    metadata: { steelMarkdownOwners: { customer_data: { outputId, title: version.title } } },
  };
  client.setQueryData(DynamicQueryKeys.steelMarkdownVersions(message.conversationId!), {
    versions: [version],
  });
  render(
    <QueryClientProvider client={client}>
      <RecoilRoot initializeState={({ set }) => set(store.queriesEnabled, false)}>
        <SteelVersionsProvider
          conversationId={message.conversationId}
          messages={[message]}
          isSubmitting={false}
        >
          <MessageContext.Provider value={{
            messageId: message.messageId,
            conversationId: message.conversationId,
            isExpanded: false,
            isCreatedByUser: false,
            isSubmitting: false,
          }}>
            <div className="message-render">
              <div className="message-content">
                <SteelHeading>{version.title}</SteelHeading>
                <MarkdownTableActions markdownIndex={0}>
                  <thead><tr><th>{header}</th></tr></thead>
                  <tbody><tr><td>B</td></tr></tbody>
                </MarkdownTableActions>
              </div>
            </div>
          </MessageContext.Provider>
        </SteelVersionsProvider>
      </RecoilRoot>
    </QueryClientProvider>,
  );
  return client;
}

describe('customer table toolbar', () => {
  it.each([true, false])('keeps only the edit action in the customer toolbar (latest: %s)', (latest) => {
    const client = renderCustomer(latest);
    try {
      const edit = screen.getByRole('button', { name: 'com_ui_steel_customer_edit' });
      const toolbar = edit.closest('.markdown-table-toolbar')!;
      expect(edit).toHaveClass('markdown-table-action');
      if (latest) expect(edit).toBeEnabled();
      else expect(edit).toBeDisabled();
      expect(within(toolbar as HTMLElement).getAllByRole('button')).toEqual([edit]);
      expect(within(screen.getByRole('heading')).queryByRole('button')).toBeNull();
    } finally {
      client.clear();
    }
  });

  it('does not enable editing for a different cached owner', () => {
    const client = renderCustomer(true, 'customer:other');
    try {
      expect(screen.queryByRole('button')).toBeNull();
    } finally {
      client.clear();
    }
  });
});
