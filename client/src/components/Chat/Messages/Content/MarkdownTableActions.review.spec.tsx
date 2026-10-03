import { RecoilRoot } from 'recoil';
import { createStore, Provider } from 'jotai';
import { render, screen, waitFor } from '@testing-library/react';
import { steelReviewSelectionAtom } from './SteelReview/state';
import MarkdownTableActions from './MarkdownTableActions';
import SteelReviewDialog from './SteelReviewDialog';

jest.mock('@librechat/client', () => {
  const React = require('react');
  const Pass = ({ children, asChild: _asChild, ...props }: {
    children?: React.ReactNode;
    asChild?: boolean;
  }) => React.createElement('div', props, children);
  const Button = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', props, children);
  const Dialog = ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    (open ? React.createElement('div', { role: 'dialog' }, children) : null);
  return {
    Button,
    ControlCombobox: Pass,
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Pass,
    DropdownMenuTrigger: Pass,
    OGDialog: Dialog,
    OGDialogClose: Pass,
    OGDialogContent: Pass,
    OGDialogDescription: Pass,
    OGDialogHeader: Pass,
    OGDialogTitle: Pass,
  };
}, { virtual: true });

const mockUseGetSteelReviewQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetSteelReviewQuery: (...args: unknown[]) => mockUseGetSteelReviewQuery(...args),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));
jest.mock('~/Providers', () => ({
  useMessageContext: () => ({
    conversationId: 'conversation-1',
    isCreatedByUser: false,
    messageId: 'message-1',
  }),
}));


const reviewIdentity = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  kind: 'ocr_result' as const,
  tableId: 'ocr_result:1',
};

function renderDialog() {
  const store = createStore();
  store.set(steelReviewSelectionAtom, reviewIdentity);
  const rendered = render(
    <Provider store={store}>
      <SteelReviewDialog identity={reviewIdentity} />
    </Provider>,
  );
  return { ...rendered, store };
}

function renderTable() {
  return render(
    <RecoilRoot>
      <div className="message-render">
        <div className="message-content">
          <h2>ocr_result</h2>
          <MarkdownTableActions markdownIndex={1}>
            <thead>
              <tr><th>來源</th><th>零件編號</th></tr>
            </thead>
            <tbody>
              <tr><td>A</td><td>P-1</td></tr>
            </tbody>
          </MarkdownTableActions>
        </div>
      </div>
    </RecoilRoot>,
  );
}

describe('MarkdownTableActions Steel review entry', () => {
  it('does not offer an entry when the scoped backend read rejects a same-heading table', async () => {
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: undefined,
      error: { response: { status: 404 } },
      isError: true,
      isLoading: false,
    });

    renderTable();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'com_ui_steel_review_open' })).toBeNull(),
    );
  });


  it('renders loading, empty, and failure states without exposing edit controls', () => {
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
    });
    const { rerender, store } = renderDialog();
    expect(screen.getByText('com_ui_steel_review_loading')).toBeInTheDocument();

    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: null },
      error: null,
      isError: false,
      isLoading: false,
    });
    rerender(
      <Provider store={store}>
        <SteelReviewDialog identity={reviewIdentity} />
      </Provider>,
    );
    expect(screen.getByText('com_ui_steel_review_empty')).toBeInTheDocument();

    const refetch = jest.fn();
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: undefined,
      error: { response: { status: 500 } },
      isError: true,
      isLoading: false,
      refetch,
    });
    rerender(
      <Provider store={store}>
        <SteelReviewDialog identity={reviewIdentity} />
      </Provider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_steel_review_error');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers an entry only after the scoped backend read recognizes the table', async () => {
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: {
        table: {
          conversationId: 'conversation-1',
          messageId: 'message-1',
          tableId: 'ocr_result:1',
          outputId: 'ocr_result:generation-1',
          kind: 'ocr_result',
          revision: 'generation-1',
          latestOutputId: 'ocr_result:generation-1',
          isLatest: true,
          readOnly: false,
          headers: ['來源', '零件編號'],
          rows: [],
        },
      },
      error: null,
      isError: false,
      isLoading: false,
    });

    renderTable();

    expect(await screen.findByRole('button', { name: 'com_ui_steel_review_open' })).toBeVisible();
  });
});
