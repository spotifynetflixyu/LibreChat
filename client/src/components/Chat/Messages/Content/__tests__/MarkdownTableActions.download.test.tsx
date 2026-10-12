import React from 'react';
import JSZip from 'jszip';
import { Provider } from 'jotai';
import { RecoilRoot } from 'recoil';
import userEvent from '@testing-library/user-event';
import { DynamicQueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { SteelReviewResponse } from 'librechat-data-provider';
import { MessageContext } from '~/Providers/MessageContext';
import MarkdownTableActions from '../MarkdownTableActions';
import store from '~/store';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

function renderReviewedOrder(isSubmitting = false): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const title = 'system_order';
  const headers = ['類別', '厚度', '零件編號'];
  const displayRow = ['鐵板', '6', 'A'];
  const response: SteelReviewResponse = {
    table: {
      conversationId: 'conv1',
      messageId: 'msg-table',
      outputId: 'system_order:run-1',
      latestOutputId: 'system_order:run-1',
      title,
      kind: 'system_order',
      revision: 'human-v1',
      isLatest: true,
      readOnly: false,
      headers,
      rows: [
        {
          rowId: 'material-1',
          source: null,
          values: {
            類別: { baseline: '鐵板', effective: '鐵板' },
            厚度: { baseline: '6', effective: '9' },
            零件編號: { baseline: 'A', effective: 'A' },
          },
        },
      ],
    },
  };
  client.setQueryData(
    DynamicQueryKeys.steelReview('conv1', 'system_order', 'msg-table', title),
    response,
  );
  render(
    <QueryClientProvider client={client}>
      <Provider>
        <RecoilRoot
          initializeState={({ set }) => {
            set(store.queriesEnabled, false);
            set(store.conversationByIndex(0), {
              conversationId: 'conv1',
              title: 'Order',
              endpoint: null,
              createdAt: '2026-06-27T14:32:05.000Z',
              updatedAt: '2026-06-27T14:32:05.000Z',
            });
          }}
        >
          <MessageContext.Provider
            value={{
              messageId: 'msg-table',
              conversationId: 'conv1',
              isExpanded: true,
              isCreatedByUser: false,
              isSubmitting,
              messageTimestamp: '2026-06-27T14:32:05',
            }}
          >
            <div className="message-render">
              <div className="message-content">
                <h2>{title}</h2>
                <MarkdownTableActions markdownIndex={0}>
                  <thead>
                    <tr>
                      {headers.map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {displayRow.map((value) => (
                        <td key={value}>{value}</td>
                      ))}
                    </tr>
                  </tbody>
                </MarkdownTableActions>
              </div>
            </div>
          </MessageContext.Provider>
        </RecoilRoot>
      </Provider>
    </QueryClientProvider>,
  );
  return client;
}

describe('reviewed system_order grouped download', () => {
  it('shows the generating tooltip on hover and keyboard focus while review is disabled', async () => {
    const user = userEvent.setup();
    const client = renderReviewedOrder(true);
    try {
      const open = await screen.findByRole('button', { name: 'com_ui_steel_review_open' });
      expect(open).toBeDisabled();
      const anchor = screen.getByLabelText('com_ui_steel_review_open', { selector: 'span' });
      await user.hover(anchor);
      expect(await screen.findByRole('tooltip')).toHaveTextContent('com_ui_generating');
      await user.unhover(anchor);
      await user.tab();
      await user.tab();
      await user.tab();
      expect(anchor).toHaveFocus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent('com_ui_generating');
      await user.keyboard('{Enter} ');
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      client.clear();
    }
  });

  it.each([false, true])(
    'downloads by thickness before any CSV download (expanded: %s)',
    async (expanded) => {
      const user = userEvent.setup();
      const createObjectURL = jest.fn((blob: Blob) => {
        expect(blob.type).toBe('application/zip');
        return 'blob:reviewed-order';
      });
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
      const anchorClick = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      const client = renderReviewedOrder();
      try {
        if (expanded) {
          await user.click(screen.getByLabelText('com_ui_expand_table'));
        }
        const toolbar = expanded ? within(screen.getByRole('dialog')) : screen;
        await user.click(toolbar.getByLabelText('com_ui_download'));
        const groupedDownload = screen.getByRole('menuitem', {
          name: 'com_ui_download_table_by_thickness_zip',
        });
        expect(groupedDownload).not.toHaveAttribute('data-disabled');
        expect(createObjectURL).not.toHaveBeenCalled();
        await user.click(groupedDownload);
        await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(createObjectURL.mock.calls[0][0]);
        });
        const zip = await JSZip.loadAsync(bytes);
        expect(Object.keys(zip.files)).toEqual(['01_鐵板_9.csv']);
        expect(await zip.file('01_鐵板_9.csv')?.async('string')).toBe(
          '\uFEFF厚度,類別,零件編號\r\n9,鐵板,A',
        );
      } finally {
        anchorClick.mockRestore();
        client.clear();
      }
    },
  );
});
