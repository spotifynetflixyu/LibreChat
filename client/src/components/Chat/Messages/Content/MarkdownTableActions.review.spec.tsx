import { RecoilRoot } from 'recoil';
import { createStore, Provider } from 'jotai';
import { DynamicQueryKeys } from 'librechat-data-provider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { steelReviewSelectionAtom } from './SteelReview/state';
import MarkdownTableActions from './MarkdownTableActions';
import SteelReviewDialog from './SteelReviewDialog';

jest.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'pdf-worker.js' }), { virtual: true });
jest.mock('pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: jest.fn(),
}));

jest.mock('@librechat/client', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const Pass = ({ children, asChild: _asChild, ...props }: {
    children?: React.ReactNode;
    asChild?: boolean;
  }) => React.createElement('div', props, children);
  const Button = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', props, children);
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement('input', props);
  const Tag = ({ label, ...props }: { label: string; variant?: string }) =>
    React.createElement('div', props, label);
  const Select = ({ value, onValueChange, children }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  }) => React.createElement(
    'select',
    { value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value) },
    children,
  );
  const SelectContent = ({ children }: { children?: React.ReactNode }) => children;
  const SelectItem = ({ value, children }: { value: string; children?: React.ReactNode }) =>
    React.createElement('option', { value }, children);
  const SelectTrigger = () => null;
  const SelectValue = () => null;
  const Dialog = ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    (open ? React.createElement('div', { role: 'dialog' }, children) : null);
  return {
    Button,
    Input,
    Tag,
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  };
}, { virtual: true });

let mockMessageContext: {
  conversationId: string;
  isCreatedByUser: boolean;
  messageId: string;
  isSubmitting: boolean;
  partIndex?: number;
} = {
  conversationId: 'conversation-1',
  isCreatedByUser: false,
  messageId: 'message-1',
  isSubmitting: false,
};

let activeReviewQueryClient: QueryClient | undefined;

jest.mock('~/data-provider', () => ({
  useGetSteelReviewQuery: jest.fn(),
  useGetSteelReviewSourcesQuery: jest.fn(() => ({
    data: { sources: [] },
    error: null,
    isError: false,
    isLoading: false,
  })),
  useGetSteelReviewSourceQuery: jest.fn(() => ({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    refetch: jest.fn(),
  })),
  usePrepareSteelReviewMutation: jest.fn(() => ({ mutateAsync: jest.fn() })),
  useCommitSteelReviewMutation: jest.fn(() => ({ mutateAsync: jest.fn() })),
  useGetSteelReviewReceiptQuery: jest.fn(() => ({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    refetch: jest.fn(),
  })),
}));
const {
  useGetSteelReviewQuery: mockUseGetSteelReviewQuery,
  useGetSteelReviewSourcesQuery: mockUseGetSteelReviewSourcesQuery,
  useGetSteelReviewSourceQuery: mockUseGetSteelReviewSourceQuery,
  usePrepareSteelReviewMutation: mockUsePrepareSteelReviewMutation,
  useCommitSteelReviewMutation: mockUseCommitSteelReviewMutation,
} = jest.requireMock('~/data-provider') as {
  useGetSteelReviewQuery: jest.Mock;
  useGetSteelReviewSourcesQuery: jest.Mock;
  useGetSteelReviewSourceQuery: jest.Mock;
  usePrepareSteelReviewMutation: jest.Mock;
  useCommitSteelReviewMutation: jest.Mock;
};
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));
jest.mock('~/Providers', () => ({
  useMessageContext: () => mockMessageContext,
}));


const reviewIdentity = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  kind: 'ocr_result' as const,
  tableId: 'ocr_result:1',
};

const testHeading = 'ocr_result';
const sourceHeader = '來源';
const partHeader = '零件編號';
const firstPart = 'P-1';
const secondPart = 'P-2';

function renderDialog(queryClient = new QueryClient()) {
  const store = createStore();
  store.set(steelReviewSelectionAtom, reviewIdentity);
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <SteelReviewDialog identity={reviewIdentity} />
      </Provider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient, store };
}

function renderTable() {
  const queryClient = new QueryClient();
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <div className="message-render">
          <div className="message-content">
            <h2>{testHeading}</h2>
            <MarkdownTableActions markdownIndex={1}>
              <thead>
                <tr><th>{sourceHeader}</th><th>{partHeader}</th></tr>
              </thead>
              <tbody>
                <tr><td>A</td><td>{firstPart}</td></tr>
              </tbody>
            </MarkdownTableActions>
          </div>
        </div>
      </RecoilRoot>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
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
    const { queryClient, rerender, store } = renderDialog();
    expect(screen.getByText('com_ui_steel_review_loading')).toBeInTheDocument();

    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: null },
      error: null,
      isError: false,
      isLoading: false,
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <SteelReviewDialog identity={reviewIdentity} />
        </Provider>
      </QueryClientProvider>,
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
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <SteelReviewDialog identity={reviewIdentity} />
        </Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_steel_review_error');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders the managed empty table state without edit controls', () => {
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: { ...reviewIdentity, rows: [], headers: ['來源'], readOnly: false } },
      error: null,
      isError: false,
      isLoading: false,
    });
    const { store } = renderDialog();
    expect(screen.getByText('com_ui_steel_review_empty')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(store.get(steelReviewSelectionAtom)).toEqual(reviewIdentity);
  });

  it('keeps OCR edits local and requires an explicit discard or continue choice on close', () => {
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: {
        table: {
          ...reviewIdentity,
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          latestOutputId: 'ocr_result:generation-1',
          isLatest: true,
          readOnly: false,
          headers: ['品名'],
          rows: [{
            rowId: 'row-1',
            source: null,
            values: { 品名: { baseline: '鋼板', effective: '鋼板' } },
          }],
        },
      },
      error: null,
      isError: false,
      isLoading: false,
    });

    const { store } = renderDialog();
    const input = screen.getByRole('textbox', { name: '品名 row-1' });
    fireEvent.change(input, { target: { value: '鍍鋅鋼板' } });
    expect(screen.getByText('com_ui_steel_review_unsaved_caption')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_steel_review_save' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_steel_review_save_updates' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_continue_editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: '品名 row-1' })).toHaveValue('鍍鋅鋼板');

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_discard_unsaved' }));
    expect(store.get(steelReviewSelectionAtom)).toBeNull();
  });

  it('prepares the focused draft and commits the exact prepared operation', async () => {
    const prepared = {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'ocr_result',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      rows: [],
      operationId: 'operation-1',
      digest: 'a'.repeat(64),
      messageSha256: 'b'.repeat(64),
      target: { start: 0, end: 1, sha256: 'c'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: ['品名'],
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: 'ocr_result', changedRows: 1, changedRowIds: ['row-1'] },
    };
    const savedSnapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: 'generation-2',
      headers: ['品名'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 品名: { baseline: '鋼板', effective: '鍍鋅鋼板' } },
      }],
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 'd'.repeat(64),
      conversationId: 'conversation-1',
      messageId: 'message-1',
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
    };
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockResolvedValue({ changedRows: 1, changedRowIds: ['row-1'], savedSnapshot });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: {
        table: {
          ...reviewIdentity,
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          latestOutputId: 'ocr_result:generation-1',
          isLatest: true,
          readOnly: false,
          headers: ['品名'],
          rows: [{
            rowId: 'row-1',
            source: null,
            values: { 品名: { baseline: '鋼板', effective: '鋼板' } },
          }],
        },
      },
      error: null,
      isError: false,
      isLoading: false,
    });

    renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: '品名 row-1' }), { target: { value: '鍍鋅鋼板' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      rows: [expect.objectContaining({
        rowId: 'row-1',
        values: { 品名: { baseline: '鋼板', effective: '鍍鋅鋼板' } },
      })],
    }));
    expect(commit).toHaveBeenCalledWith(prepared);
    expect(screen.queryByText('com_ui_steel_review_unsaved_caption')).toBeNull();
  });

  it('preserves an edit made during commit when the confirmed revision changes the atom owner', async () => {
    const queryClient = new QueryClient();
    const reviewQueryKey = DynamicQueryKeys.steelReview(
      reviewIdentity.conversationId,
      reviewIdentity.kind,
      reviewIdentity.messageId,
      reviewIdentity.tableId,
      reviewIdentity.partIndex,
    );
    const firstTable = {
      ...reviewIdentity,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['品名'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 品名: { baseline: '鋼板', effective: '鋼板' } },
      }],
    };
    const savedRows = [{
      rowId: 'row-1',
      source: null,
      values: { 品名: { baseline: '鋼板', effective: '7' } },
    }];
    const prepared = {
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      kind: reviewIdentity.kind,
      tableId: reviewIdentity.tableId,
      outputId: firstTable.outputId,
      revision: firstTable.revision,
      rows: [firstTable.rows[0]],
      operationId: 'operation-inflight',
      digest: 'a'.repeat(64),
      messageSha256: 'b'.repeat(64),
      target: { start: 0, end: 1, sha256: 'c'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: firstTable.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const commitResult = {
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedSnapshot: {
        operationId: prepared.operationId,
        digest: prepared.digest,
        outputId: prepared.outputId,
        revision: 'generation-2',
        headers: firstTable.headers,
        rows: savedRows,
        changedRows: 1,
        changedRowIds: ['row-1'],
        savedAt: '2026-10-03T00:00:00.000Z',
        messageSha256: 'd'.repeat(64),
        conversationId: reviewIdentity.conversationId,
        messageId: reviewIdentity.messageId,
        messageText: 'saved',
        effectiveMarkdown: 'effective',
        displayMarkdown: 'display',
      },
    };
    let resolveCommit!: (value: typeof commitResult) => void;
    const commit = jest.fn(() => new Promise<typeof commitResult>((resolve) => {
      resolveCommit = resolve;
    }));
    mockUseGetSteelReviewQuery.mockImplementation((input) => {
      const key = DynamicQueryKeys.steelReview(
        input?.conversationId ?? '',
        input?.kind ?? 'ocr_result',
        input?.messageId ?? '',
        input?.tableId ?? '',
        input?.partIndex,
      );
      return useQuery({
        queryKey: key,
        queryFn: () => activeReviewQueryClient?.getQueryData(key) ?? { table: null },
        enabled: Boolean(input),
        retry: false,
      });
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(prepared) });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    queryClient.setQueryData(reviewQueryKey, { table: firstTable });
    activeReviewQueryClient = queryClient;
    const rendered = renderDialog(queryClient);

    fireEvent.change(screen.getByRole('textbox', { name: '品名 row-1' }), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: '品名 row-1' }), { target: { value: '10' } });

    resolveCommit(commitResult);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '品名 row-1' })).toHaveValue('10');
      expect(screen.getByText('com_ui_steel_review_unsaved_caption')).toBeInTheDocument();
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(screen.getByRole('textbox', { name: '品名 row-1' })).toHaveValue('10');
    expect(screen.getByText('com_ui_steel_review_unsaved_caption')).toBeInTheDocument();
    rendered.unmount();
    activeReviewQueryClient = undefined;
  });

  it('keeps source rows visible while sources load or fail, then renders an image preview', async () => {
    const row = {
      rowId: 'drawing-row',
      values: { Part: { baseline: 'P-1', effective: 'P-1' } },
      source: { fileId: 'drawing-a', pageNumber: 1, filename: 'drawing-a.png' },
    };
    const table = {
      ...reviewIdentity,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: true,
      headers: ['Part'],
      rows: [row],
    };
    const sourceRefetch = jest.fn();
    const sourceBlob = new Blob(['image'], { type: 'image/png' });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:image') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
    mockUseGetSteelReviewQuery.mockReturnValue({ data: { table }, error: null, isError: false, isLoading: false });
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
      refetch: sourceRefetch,
    });
    mockUseGetSteelReviewSourceQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn(),
    });
    const { queryClient, rerender, store } = renderDialog();
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_steel_review_sources_loading');
    expect(screen.getByText('P-1')).toBeInTheDocument();

    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: undefined,
      error: new Error('source listing failed'),
      isError: true,
      isLoading: false,
      refetch: sourceRefetch,
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <SteelReviewDialog identity={reviewIdentity} />
        </Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_steel_review_sources_error');
    expect(screen.getByText('P-1')).toBeInTheDocument();
    screen.getByRole('button', { name: 'com_ui_retry' }).click();
    expect(sourceRefetch).toHaveBeenCalledTimes(1);

    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: { sources: [{ fileId: 'drawing-a', filename: 'drawing-a.png', mediaType: 'image/png' }] },
      error: null,
      isError: false,
      isLoading: false,
      refetch: sourceRefetch,
    });
    mockUseGetSteelReviewSourceQuery.mockReturnValue({
      data: sourceBlob,
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn(),
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <SteelReviewDialog identity={reviewIdentity} />
        </Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('img', { name: 'com_ui_steel_review_preview_canvas' })).toBeInTheDocument();
  });

  it('keeps transient recognition failures retryable without opening ordinary Markdown review', async () => {
    const refetch = jest.fn();
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: undefined,
      error: { response: { status: 500 } },
      isError: true,
      isLoading: false,
      refetch,
    });

    renderTable();

    const retry = await screen.findByRole('button', { name: 'com_ui_steel_review_retry' });
    expect(screen.queryByRole('button', { name: 'com_ui_steel_review_open' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    retry.click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes recognition once when trusted message submission completes', async () => {
    const refetch = jest.fn();
    mockMessageContext = { ...mockMessageContext, isSubmitting: true };
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: undefined,
      error: { response: { status: 404 } },
      isError: true,
      isLoading: false,
      refetch,
    });
    const rendered = renderTable();

    mockMessageContext = { ...mockMessageContext, isSubmitting: false };
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <RecoilRoot>
          <div className="message-render">
            <div className="message-content">
              <h2>{testHeading}</h2>
              <MarkdownTableActions markdownIndex={1}>
                <thead><tr><th>{sourceHeader}</th><th>{partHeader}</th></tr></thead>
                <tbody><tr><td>A</td><td>{firstPart}</td></tr></tbody>
              </MarkdownTableActions>
            </div>
          </div>
        </RecoilRoot>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    rendered.unmount();
    mockMessageContext = { ...mockMessageContext, isSubmitting: false };
  });

  it('refreshes once when rendered children settle after an initial absence', async () => {
    const refetch = jest.fn();
    mockMessageContext = { ...mockMessageContext, isSubmitting: false };
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: undefined,
      error: { response: { status: 404 } },
      isError: true,
      isLoading: false,
      refetch,
    });
    const rendered = renderTable();

    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <RecoilRoot>
          <div className="message-render">
            <div className="message-content">
              <h2>{testHeading}</h2>
              <MarkdownTableActions markdownIndex={1}>
                <thead><tr><th>{sourceHeader}</th><th>{partHeader}</th></tr></thead>
                <tbody><tr><td>A</td><td>{secondPart}</td></tr></tbody>
              </MarkdownTableActions>
            </div>
          </div>
        </RecoilRoot>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    rendered.unmount();
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

  it('uses the message table identity without forwarding a synthetic displayed part index', () => {
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: {
        table: {
          ...reviewIdentity,
          outputId: 'ocr_result:generation-1',
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
    mockMessageContext = { ...mockMessageContext, partIndex: 3 };
    renderTable();

    const candidateCall = mockUseGetSteelReviewQuery.mock.calls
      .filter(([input]) => input != null)
      .at(-1);
    expect(candidateCall).toEqual([
      expect.objectContaining({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        tableId: 'ocr_result:1',
      }),
      expect.any(Object),
    ]);
    expect(candidateCall?.[0]).not.toHaveProperty('partIndex');
    mockMessageContext = { ...mockMessageContext, partIndex: undefined };
  });
});
