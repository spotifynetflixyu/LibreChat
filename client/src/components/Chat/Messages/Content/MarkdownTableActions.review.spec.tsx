import { RecoilRoot } from 'recoil';
import { createStore, Provider } from 'jotai';
import { dataService, DynamicQueryKeys } from 'librechat-data-provider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { MutableRefObject } from 'react';
import type { SteelReviewIdentity, SteelReviewSelection } from './SteelReview/state';
import { steelReviewDraftStateFamily, steelReviewSelectionAtom } from './SteelReview/state';
import { getSteelReviewDraftKey, getSteelReviewDraftOwnerKey } from './SteelReview/session';
import SteelReviewDialog, { type SteelReviewSaveGate } from './SteelReviewDialog';
import MarkdownTableActions from './MarkdownTableActions';

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

beforeEach(() => {
  jest.spyOn(dataService, 'getMessagesByConvoId').mockResolvedValue([]);
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: jest.fn(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

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
  useGetSteelReviewSourcePageCountQuery: jest.fn(() => ({
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
  useGetSteelReviewReceiptQuery: mockUseGetSteelReviewReceiptQuery,
} = jest.requireMock('~/data-provider') as {
  useGetSteelReviewQuery: jest.Mock;
  useGetSteelReviewSourcesQuery: jest.Mock;
  useGetSteelReviewSourceQuery: jest.Mock;
  usePrepareSteelReviewMutation: jest.Mock;
  useCommitSteelReviewMutation: jest.Mock;
  useGetSteelReviewReceiptQuery: jest.Mock;
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
  title: 'ocr_result',
};
const reviewSelection: SteelReviewSelection = {
  ...reviewIdentity,
  captureId: 'capture-1',
};

const testHeading = 'ocr_result';
const sourceHeader = '來源';
const partHeader = '零件編號';
const firstPart = 'P-1';
const secondPart = 'P-2';

function renderDialog(
  queryClient = new QueryClient(),
  selection: SteelReviewSelection = reviewSelection,
  store = createStore(),
  identity: SteelReviewIdentity = reviewIdentity,
  saveGateRef?: MutableRefObject<SteelReviewSaveGate | undefined>,
) {
  store.set(steelReviewSelectionAtom, selection);
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <SteelReviewDialog identity={identity} saveGateRef={saveGateRef} />
      </Provider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient, store };
}

function createReopenLifecycleFixture() {
  const table = {
    ...reviewIdentity,
    kind: 'ocr_result' as const,
    outputId: 'ocr_result:generation-reopen',
    revision: 'generation-reopen',
    latestOutputId: 'ocr_result:generation-reopen',
    isLatest: true,
    readOnly: false,
    headers: ['數量'],
    rows: [{
      rowId: 'row-1',
      source: null,
      values: { 數量: { baseline: '2', effective: '2' } },
    }],
  };
  const prepared = {
    ...reviewIdentity,
    outputId: table.outputId,
    revision: table.revision,
    rows: table.rows,
    operationId: 'operation-reopen-old',
    digest: 'u'.repeat(64),
    messageSha256: 'v'.repeat(64),
    target: { start: 0, end: 1, sha256: 'w'.repeat(64) },
    replacementText: 'replacement',
    cleanReplacementText: 'replacement',
    targetText: 'target',
    headers: table.headers,
    effectiveMarkdown: 'effective',
    displayMarkdown: 'display',
    caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
  };
  const savedSnapshot = {
    operationId: prepared.operationId,
    digest: prepared.digest,
    outputId: prepared.outputId,
    revision: 'generation-reopen-save-1',
    headers: table.headers,
    rows: [{
      rowId: 'row-1',
      source: null,
      values: { 數量: { baseline: '2', effective: '9' } },
    }],
    changedRows: 1,
    changedRowIds: ['row-1'],
    savedAt: '2026-10-03T00:00:00.000Z',
    messageSha256: 'x'.repeat(64),
    conversationId: reviewIdentity.conversationId,
    messageId: reviewIdentity.messageId,
    messageText: 'saved',
    effectiveMarkdown: 'effective',
    displayMarkdown: 'display',
  };
  return { table, prepared, savedSnapshot };
}

function seedReopenedDraft(
  store: ReturnType<typeof createStore>,
  selection: SteelReviewSelection,
  table: ReturnType<typeof createReopenLifecycleFixture>['table'],
) {
  const draftAtomKey = getSteelReviewDraftOwnerKey(selection, table, selection.captureId);
  const ownerKey = `${getSteelReviewDraftKey(selection, table)}:${selection.captureId}`;
  const draftAtom = steelReviewDraftStateFamily(draftAtomKey);
  const history = {
    cells: { 'row-1\u0000數量': 'history' },
    touched: { 'row-1\u0000數量': 'history' },
    cellVersions: { 'row-1\u0000數量': 1 },
    sourceDrafts: {},
    sourceVersions: {},
    systemVersions: {},
    rowStates: {},
    changeSequence: 41,
  };
  store.set(draftAtom, (current) => ({
    ...current,
    ownerKey,
    cells: { 'row-1\u0000數量': 'reopened' },
    touched: { 'row-1\u0000數量': 'reopened' },
    cellVersions: { 'row-1\u0000數量': 42 },
    past: [history],
    future: [history],
    historyGroup: 'reopened',
    changeSequence: 42,
  }));
  return { draftAtom, before: store.get(draftAtom) };
}

function createReopenedSelection(
  table: ReturnType<typeof createReopenLifecycleFixture>['table'],
  captureId = 'capture-reopened',
): SteelReviewSelection {
  return {
    ...reviewSelection,
    captureId,
    capturedAuthority: {
      outputId: table.outputId,
      revision: table.revision,
      table,
    },
  };
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

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
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

  it('exports a recognized confirmed table while the review dialog is closed', async () => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['來源', '零件編號', '數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
          數量: { baseline: '2', effective: '2' },
        },
      }],
    };
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:review-export'),
    });
    mockUseGetSteelReviewQuery.mockImplementation((input) => input
      ? { data: { table }, error: null, isError: false, isLoading: false }
      : { data: undefined, error: null, isError: false, isLoading: false });

    renderTable();

    const download = await screen.findByRole('button', { name: 'com_ui_download_table_csv' });
    fireEvent.click(download);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  });

  it('exports only active rows from a confirmed table', async () => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['來源', '零件編號', '數量'],
      rows: [
        {
          rowId: 'row-active',
          source: null,
          values: {
            來源: { baseline: 'A', effective: 'A' },
            零件編號: { baseline: 'P-1', effective: 'P-1' },
            數量: { baseline: '2', effective: '2' },
          },
        },
        {
          rowId: 'row-deleted',
          source: null,
          deleted: true,
          values: {
            來源: { baseline: 'A', effective: 'A' },
            零件編號: { baseline: 'P-2', effective: 'P-2' },
            數量: { baseline: '4', effective: '4' },
          },
        },
      ],
    };
    const createObjectURL = jest.fn(() => 'blob:review-active-export');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    mockUseGetSteelReviewQuery.mockImplementation((input) => input
      ? { data: { table }, error: null, isError: false, isLoading: false }
      : { data: undefined, error: null, isError: false, isLoading: false });

    renderTable();

    fireEvent.click(await screen.findByRole('button', { name: 'com_ui_download_table_csv' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const csv = await readBlob((createObjectURL.mock.calls as unknown as Array<[Blob]>)[0][0]);
    expect(csv).toContain('P-1');
    expect(csv).not.toContain('P-2');
  });

  it('exports a header-only CSV when every confirmed row is deleted', async () => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-deleted',
        source: null,
        deleted: true,
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-2', effective: 'P-2' },
        },
      }],
    };
    const createObjectURL = jest.fn(() => 'blob:review-header-export');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    mockUseGetSteelReviewQuery.mockImplementation((input) => input
      ? { data: { table }, error: null, isError: false, isLoading: false }
      : { data: undefined, error: null, isError: false, isLoading: false });

    renderTable();

    fireEvent.click(await screen.findByRole('button', { name: 'com_ui_download_table_csv' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const csv = await readBlob((createObjectURL.mock.calls as unknown as Array<[Blob]>)[0][0]);
    expect(csv).toContain('來源');
    expect(csv).toContain('零件編號');
    expect(csv).not.toContain('P-2');
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

  it('allows approved system-order structure and material-source controls while keeping prices editable', async () => {
    const systemIdentity: SteelReviewIdentity = {
      ...reviewIdentity,
      kind: 'system_order',
      title: 'system_order｜報價單 A',
    };
    const systemSelection: SteelReviewSelection = {
      ...reviewSelection,
      ...systemIdentity,
    };
    const table = {
      ...systemIdentity,
      outputId: 'system_order:run-1',
      revision: 'revision-1',
      latestOutputId: 'system_order:run-1',
      isLatest: true,
      readOnly: false,
      headers: ['品名規格', '總數', '單價'],
      rows: [{
        rowId: 'row-1',
        system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
        source: { fileId: 'drawing-1', pageNumber: 1, filename: 'drawing.pdf' },
        values: {
          品名規格: { baseline: '雷射板', effective: '雷射板' },
          總數: { baseline: '2', effective: '2' },
          單價: { baseline: '40', effective: '40' },
        },
      }],
    };
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
    });

    renderDialog(new QueryClient(), systemSelection, createStore(), systemIdentity);

    expect(await screen.findByRole('textbox', { name: '總數 row-1' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: '單價 row-1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'com_ui_steel_review_add_material' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_steel_review_add_processing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /com_ui_steel_review_delete_row/u })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /com_ui_steel_review_restore_row/u })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'com_ui_steel_review_source_actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /com_ui_steel_review_change_source/u })).toBeInTheDocument();
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
    expect(store.get(steelReviewSelectionAtom)).toEqual(reviewSelection);
  });

  it('retains the captured owner and local draft across a dialog remount', async () => {
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
    const newAiTable = {
      ...firstTable,
      outputId: 'ocr_result:generation-2',
      revision: 'generation-2',
      latestOutputId: 'ocr_result:generation-2',
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 品名: { baseline: '新AI', effective: '新AI' } },
      }],
    };
    let liveTable = firstTable;
    mockUseGetSteelReviewQuery.mockImplementation((input) => input
      ? { data: { table: liveTable }, error: null, isError: false, isLoading: false }
      : { data: undefined, error: null, isError: false, isLoading: false });

    const firstRender = renderDialog();
    await waitFor(() => expect(firstRender.store.get(steelReviewSelectionAtom)?.capturedAuthority?.outputId)
      .toBe(firstTable.outputId));
    fireEvent.change(await screen.findByRole('textbox', { name: '品名 row-1' }), { target: { value: '本地草稿' } });
    firstRender.unmount();
    liveTable = newAiTable;

    render(
      <QueryClientProvider client={firstRender.queryClient}>
        <Provider store={firstRender.store}>
          <SteelReviewDialog identity={reviewIdentity} />
        </Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(screen.getByText('本地草稿')).toBeInTheDocument();
    expect(screen.getByText('com_ui_steel_review_readonly')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_ui_steel_review_add_row' })).toBeNull();
    expect(firstRender.store.get(steelReviewSelectionAtom)?.capturedAuthority?.outputId)
      .toBe(firstTable.outputId);
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
    fireEvent.change(input, { target: { value: '另一種鋼板' } });
    fireEvent.change(input, { target: { value: '鋼板' } });
    expect(screen.queryByText('com_ui_steel_review_unsaved_caption')).toBeNull();
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
      title: 'ocr_result',
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
    const authorityTable = {
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
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: authorityTable },
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn().mockResolvedValue({ data: { table: authorityTable }, error: null }),
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
      operations: [{
        rowId: 'row-1',
        type: 'update',
        changes: [{ header: '品名', value: '鍍鋅鋼板' }],
      }],
    }));
    expect(commit).toHaveBeenCalledWith(prepared);
    expect(screen.queryByText('com_ui_steel_review_unsaved_caption')).toBeNull();
  });

  it('shows authoritative prepared and confirmed row counts across a delayed commit', async () => {
    const prepared = {
      ...reviewIdentity,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      rows: [],
      operationId: 'operation-caption',
      digest: 'j'.repeat(64),
      messageSha256: 'k'.repeat(64),
      target: { start: 0, end: 1, sha256: 'l'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: ['品名'],
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const authorityTable = {
      ...reviewIdentity,
      outputId: prepared.outputId,
      revision: prepared.revision,
      latestOutputId: prepared.outputId,
      isLatest: true,
      readOnly: false,
      headers: ['品名'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 品名: { baseline: '鋼板', effective: '鋼板' } },
      }],
    };
    const savedSnapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: prepared.revision,
      headers: authorityTable.headers,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 品名: { baseline: '鋼板', effective: '鍍鋅鋼板' } },
      }],
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 'm'.repeat(64),
      conversationId: prepared.conversationId,
      messageId: prepared.messageId,
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
    };
    let resolveCommit!: (value: { changedRows: number; changedRowIds: string[]; savedSnapshot: typeof savedSnapshot }) => void;
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn(() => new Promise<{ changedRows: number; changedRowIds: string[]; savedSnapshot: typeof savedSnapshot }>((resolve) => {
      resolveCommit = resolve;
    }));
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: authorityTable },
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn().mockResolvedValue({ data: { table: authorityTable }, error: null }),
    });

    renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: '品名 row-1' }), { target: { value: '鍍鋅鋼板' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(screen.getByText('com_ui_steel_review_save_caption')).toBeInTheDocument();
    expect(screen.queryByText('com_ui_steel_review_updated_caption')).toBeNull();

    resolveCommit({ changedRows: 1, changedRowIds: ['row-1'], savedSnapshot });
    await waitFor(() => expect(screen.getByText('com_ui_steel_review_updated_caption')).toBeInTheDocument());
    expect(screen.queryByText('com_ui_steel_review_save_caption')).toBeNull();
  });

  it('rebases a normalized no-op against fresh authority without projecting a snapshot', async () => {
    const table = {
      ...reviewIdentity,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const prepared = {
      ...reviewIdentity,
      outputId: table.outputId,
      revision: table.revision,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: ' 2 ' } },
      }],
      operationId: 'operation-normalized-no-op',
      digest: 'a'.repeat(64),
      messageSha256: 'b'.repeat(64),
      target: { start: 0, end: 1, sha256: 'c'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockResolvedValue({ changedRows: 0, changedRowIds: [] });
    const refetch = jest.fn().mockResolvedValue({ data: { table }, error: null });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    const queryClient = new QueryClient();
    const reviewQueryKey = DynamicQueryKeys.steelReview(
      reviewIdentity.conversationId,
      reviewIdentity.kind,
      reviewIdentity.messageId,
      reviewIdentity.title,
    );
    queryClient.setQueryData(reviewQueryKey, { table });
    renderDialog(queryClient);

    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: ' 2 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(input).toHaveValue('2'));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('com_ui_steel_review_unsaved_caption')).toBeNull();
    expect(screen.queryByText('com_ui_steel_review_updated')).toBeNull();
    expect(queryClient.getQueryData(reviewQueryKey)).toEqual({ table });
  });

  it('preserves an edit made after a normalized no-op submit while rereading authority', async () => {
    const table = {
      ...reviewIdentity,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const prepared = {
      ...reviewIdentity,
      outputId: table.outputId,
      revision: table.revision,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: ' 2 ' } },
      }],
      operationId: 'operation-normalized-no-op-late-edit',
      digest: 'd'.repeat(64),
      messageSha256: 'e'.repeat(64),
      target: { start: 0, end: 1, sha256: 'f'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockResolvedValue({ changedRows: 0, changedRowIds: [] });
    let resolveRefetch!: (result: { data: { table: typeof table }; error: null }) => void;
    const refetch = jest.fn(() => new Promise<{ data: { table: typeof table }; error: null }>((resolve) => {
      resolveRefetch = resolve;
    }));
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    renderDialog();
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: ' 2 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: '10' } });
    resolveRefetch({ data: { table }, error: null });

    await waitFor(() => {
      expect(input).toHaveValue('10');
      expect(screen.getByText('com_ui_steel_review_unsaved_caption')).toBeInTheDocument();
    });
  });

  it('keeps a normalized draft when the authority reread fails, then retries safely', async () => {
    const table = {
      ...reviewIdentity,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const prepared = {
      ...reviewIdentity,
      outputId: table.outputId,
      revision: table.revision,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: ' 2 ' } },
      }],
      operationId: 'operation-normalized-no-op-retry',
      digest: 'g'.repeat(64),
      messageSha256: 'h'.repeat(64),
      target: { start: 0, end: 1, sha256: 'i'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockResolvedValue({ changedRows: 0, changedRowIds: [] });
    const refetch = jest.fn()
      .mockRejectedValueOnce(new Error('authority unavailable'))
      .mockResolvedValueOnce({ data: { table }, error: null });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    renderDialog();
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: ' 2 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(input).toHaveValue(' 2 ');
      expect(screen.getByText('com_ui_steel_review_unsaved_caption')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('com_ui_steel_review_save_uncertain');
    });

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => {
      expect(commit).toHaveBeenCalledTimes(2);
      expect(refetch).toHaveBeenCalledTimes(2);
      expect(input).toHaveValue('2');
      expect(screen.queryByText('com_ui_steel_review_unsaved_caption')).toBeNull();
    });
  });

  it('preserves an edit made during commit when the confirmed revision changes the atom owner', async () => {
    const queryClient = new QueryClient();
    const reviewQueryKey = DynamicQueryKeys.steelReview(
      reviewIdentity.conversationId,
      reviewIdentity.kind,
      reviewIdentity.messageId,
      reviewIdentity.title,
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
      title: reviewIdentity.title,
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
        input?.title ?? '',
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

  it('retries a failed receipt lookup and preserves edits made after discard starts', async () => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
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
    const prepared = {
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      kind: reviewIdentity.kind,
      title: reviewIdentity.title,
      outputId: table.outputId,
      revision: table.revision,
      rows: table.rows,
      operationId: 'operation-receipt-retry',
      digest: 'a'.repeat(64),
      messageSha256: 'b'.repeat(64),
      target: { start: 0, end: 1, sha256: 'c'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const reviewRefetch = jest.fn().mockResolvedValue({ data: { table }, error: null });
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockRejectedValue(new Error('connection lost'));
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    let receiptResolve!: (result: { data: { status: 'absent' }; error: null }) => void;
    let receiptCalls = 0;
    const receiptRefetch = jest.fn().mockImplementation(() => {
      receiptCalls += 1;
      if (receiptCalls === 1) {
        return Promise.reject(new Error('receipt unavailable'));
      }
      return new Promise((resolve) => {
        receiptResolve = resolve;
      });
    });
    mockUseGetSteelReviewReceiptQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      refetch: receiptRefetch,
    });

    renderDialog();
    const input = screen.getByRole('textbox', { name: '品名 row-1' });
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_discard_unsaved' }));
    await waitFor(() => expect(receiptCalls).toBe(1));
    const retryReceipt = await screen.findByRole('button', { name: 'com_ui_steel_review_receipt_retry' });
    expect(retryReceipt).toBeEnabled();
    expect(input).toHaveValue('7');

    fireEvent.click(retryReceipt);
    await waitFor(() => expect(receiptCalls).toBe(2));
    fireEvent.change(input, { target: { value: '10' } });
    receiptResolve({ data: { status: 'absent' }, error: null });

    await waitFor(() => {
      expect(input).toHaveValue('10');
      expect(screen.getByText('com_ui_steel_review_unsaved_caption')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'com_ui_steel_review_receipt_retry' })).toBeNull();
    });
  });

  it.each([
    ['conversationId', 'conversation-foreign'],
    ['messageId', 'message-foreign'],
    ['kind', 'system_order'],
    ['title', 'table-foreign'],
  ] as const)('does not acknowledge a receipt for a captured authority with a different %s', async (field, value) => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const foreignTable = { ...table, [field]: value };
    const newAiTable = {
      ...table,
      outputId: 'ocr_result:generation-2',
      revision: 'generation-2',
      latestOutputId: 'ocr_result:generation-2',
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '4', effective: '4' } },
      }],
    };
    const prepared = {
      ...reviewIdentity,
      outputId: table.outputId,
      revision: table.revision,
      rows: table.rows,
      operationId: `operation-receipt-mismatch-${field}`,
      digest: 'q'.repeat(64),
      messageSha256: 'r'.repeat(64),
      target: { start: 0, end: 1, sha256: 's'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const snapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: 'generation-1-save-1',
      headers: table.headers,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '9' } },
      }],
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 't'.repeat(64),
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
    };
    const reviewRefetch = jest.fn().mockResolvedValue({ data: { table: newAiTable }, error: null });
    const commit = jest.fn().mockRejectedValue(new Error('connection lost'));
    let receiptResolve!: (result: { data: { status: 'committed'; snapshot: typeof snapshot }; error: null }) => void;
    const receiptRefetch = jest.fn().mockImplementation(() => new Promise((resolve) => {
      receiptResolve = resolve;
    }));
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(prepared) });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    mockUseGetSteelReviewReceiptQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      refetch: receiptRefetch,
    });

    const { store } = renderDialog(new QueryClient(), {
      ...reviewIdentity,
      captureId: 'capture-receipt-mismatch',
      capturedAuthority: {
        outputId: table.outputId,
        revision: table.revision,
        table: foreignTable,
      },
    });
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_discard_unsaved' }));
    await waitFor(() => expect(receiptRefetch).toHaveBeenCalledTimes(1));
    receiptResolve({ data: { status: 'committed', snapshot }, error: null });

    await waitFor(() => expect(store.get(steelReviewSelectionAtom)?.capturedAuthority?.revision)
      .toBe(table.revision));
    expect(store.get(steelReviewSelectionAtom)).toEqual(expect.objectContaining({
      capturedAuthority: expect.objectContaining({ table: foreignTable }),
    }));
  });

  it.each([
    ['commit', 'conversationId', 'conversation-foreign'],
    ['commit', 'messageId', 'message-foreign'],
    ['commit', 'kind', 'system_order'],
    ['commit', 'title', 'table-foreign'],
    ['no-op', 'conversationId', 'conversation-foreign'],
    ['no-op', 'messageId', 'message-foreign'],
    ['no-op', 'kind', 'system_order'],
    ['no-op', 'title', 'table-foreign'],
  ] as const)('does not acknowledge a %s when the current table has a different %s', async (mode, field, value) => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const foreignTable = { ...table, [field]: value, revision: 'foreign-revision' };
    const prepared = {
      ...reviewIdentity,
      outputId: table.outputId,
      revision: table.revision,
      rows: [{
        ...table.rows[0],
        values: { 數量: { baseline: '2', effective: mode === 'no-op' ? ' 2 ' : '9' } },
      }],
      operationId: `operation-current-mismatch-${mode}-${field}`,
      digest: 'u'.repeat(64),
      messageSha256: 'v'.repeat(64),
      target: { start: 0, end: 1, sha256: 'w'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const savedSnapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: 'generation-1-save-1',
      headers: table.headers,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '9' } },
      }],
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 'x'.repeat(64),
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
    };
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockResolvedValue(mode === 'no-op'
      ? { changedRows: 0, changedRowIds: [] }
      : { changedRows: 1, changedRowIds: ['row-1'], savedSnapshot });
    const refetch = jest.fn().mockResolvedValue({ data: { table: foreignTable }, error: null });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    const { store } = renderDialog();
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: mode === 'no-op' ? ' 2 ' : '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.get(steelReviewSelectionAtom)?.capturedAuthority?.revision)
      .toBe(table.revision));
    const draftAtom = steelReviewDraftStateFamily(getSteelReviewDraftOwnerKey(reviewIdentity, table, reviewSelection.captureId));
    expect(store.get(draftAtom).past.length).toBeGreaterThan(0);
    expect(screen.getByText('com_ui_steel_review_unsaved_caption')).toBeInTheDocument();
  });

  it('does not apply an old receipt after selection changes while messages refetch waits', async () => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const foreignTable = { ...table, title: 'table-foreign', revision: 'foreign-revision' };
    const foreignSelection = {
      ...reviewIdentity,
      title: foreignTable.title,
      captureId: 'capture-foreign-receipt',
      capturedAuthority: {
        outputId: foreignTable.outputId,
        revision: foreignTable.revision,
        table: foreignTable,
      },
    };
    const prepared = {
      ...reviewIdentity,
      outputId: table.outputId,
      revision: table.revision,
      rows: table.rows,
      operationId: 'operation-receipt-selection-change',
      digest: 'y'.repeat(64),
      messageSha256: 'z'.repeat(64),
      target: { start: 0, end: 1, sha256: 'a'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const snapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: 'generation-1-save-1',
      headers: table.headers,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '9' } },
      }],
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 'b'.repeat(64),
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
    };
    const commit = jest.fn().mockRejectedValue(new Error('connection lost'));
    const reviewRefetch = jest.fn().mockResolvedValue({ data: { table }, error: null });
    const receiptRefetch = jest.fn().mockResolvedValue({
      data: { status: 'committed', snapshot },
      error: null,
    });
    let resolveMessages!: (messages: never[]) => void;
    const messagesPromise = new Promise<never[]>((resolve) => {
      resolveMessages = resolve;
    });
    const messagesQuery = jest.spyOn(dataService, 'getMessagesByConvoId');
    messagesQuery.mockImplementation(() => messagesPromise);
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(prepared) });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    mockUseGetSteelReviewReceiptQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      refetch: receiptRefetch,
    });

    const rendered = renderDialog();
    const { queryClient, store } = rendered;
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_discard_unsaved' }));
    await waitFor(() => expect(messagesQuery).toHaveBeenCalledTimes(1));

    const foreignDraftKey = getSteelReviewDraftOwnerKey(foreignSelection, foreignTable, foreignSelection.captureId);
    const foreignDraftAtom = steelReviewDraftStateFamily(foreignDraftKey);
    store.set(foreignDraftAtom, (current) => ({
      ...current,
      ownerKey: foreignDraftKey,
      cells: { 'row-1\u0000數量': 'foreign' },
      changeSequence: 42,
    }));
    rendered.unmount();
    store.set(steelReviewSelectionAtom, foreignSelection);
    const remounted = renderDialog(queryClient, foreignSelection, store, foreignSelection);
    resolveMessages([]);

    await waitFor(() => expect(store.get(steelReviewSelectionAtom)).toEqual(foreignSelection));
    await waitFor(() => {
      expect(store.get(foreignDraftAtom).cells['row-1\u0000數量']).toBe('foreign');
      expect(store.get(foreignDraftAtom).changeSequence).toBe(42);
    });
    remounted.unmount();
  });

  it('does not let an unmounted save-and-close clear a reopened foreign selection', async () => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const foreignTable = {
      ...table,
      title: 'table-foreign',
      outputId: 'ocr_result:foreign-generation',
      revision: 'foreign-generation',
      latestOutputId: 'ocr_result:foreign-generation',
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '4', effective: '4' } },
      }],
    };
    const prepared = {
      ...reviewIdentity,
      outputId: table.outputId,
      revision: table.revision,
      rows: table.rows,
      operationId: 'operation-unmounted-save-close',
      digest: 'u'.repeat(64),
      messageSha256: 'v'.repeat(64),
      target: { start: 0, end: 1, sha256: 'w'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const savedSnapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: 'generation-1-save-1',
      headers: table.headers,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '9' } },
      }],
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 'x'.repeat(64),
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
    };
    const savedTable = {
      ...table,
      revision: savedSnapshot.revision,
      rows: savedSnapshot.rows,
    };
    let resolveCommit!: (result: { changedRows: number; changedRowIds: string[]; savedSnapshot: typeof savedSnapshot }) => void;
    const commit = jest.fn(() => new Promise<{ changedRows: number; changedRowIds: string[]; savedSnapshot: typeof savedSnapshot }>((resolve) => {
      resolveCommit = resolve;
    }));
    const prepare = jest.fn().mockResolvedValue(prepared);
    const reviewRefetch = jest.fn().mockResolvedValue({ data: { table: savedTable }, error: null });
    mockUseGetSteelReviewQuery.mockImplementation((input) => input?.title === foreignTable.title
      ? { data: { table: foreignTable }, error: null, isError: false, isLoading: false, refetch: jest.fn() }
      : { data: { table }, error: null, isError: false, isLoading: false, refetch: reviewRefetch });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    const rendered = renderDialog();
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save_updates' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    const foreignSelection = {
      ...reviewIdentity,
      title: foreignTable.title,
      captureId: 'capture-foreign-save-close',
      capturedAuthority: {
        outputId: foreignTable.outputId,
        revision: foreignTable.revision,
        table: foreignTable,
      },
    };
    rendered.unmount();
    const foreignRender = renderDialog(new QueryClient(), foreignSelection, rendered.store, foreignSelection);
    resolveCommit({ changedRows: 1, changedRowIds: ['row-1'], savedSnapshot });

    await waitFor(() => expect(rendered.store.get(steelReviewSelectionAtom)).toEqual(foreignSelection));
    foreignRender.unmount();
  });

  it('does not let an unmounted save-and-close clear a reopened same-owner capture', async () => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const prepared = {
      ...reviewIdentity,
      outputId: table.outputId,
      revision: table.revision,
      rows: table.rows,
      operationId: 'operation-unmounted-same-owner-save-close',
      digest: 'u'.repeat(64),
      messageSha256: 'v'.repeat(64),
      target: { start: 0, end: 1, sha256: 'w'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const savedSnapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: 'generation-1-save-1',
      headers: table.headers,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '9' } },
      }],
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 'x'.repeat(64),
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
    };
    const savedTable = { ...table, revision: savedSnapshot.revision, rows: savedSnapshot.rows };
    let resolveCommit!: (result: {
      changedRows: number;
      changedRowIds: string[];
      savedSnapshot: typeof savedSnapshot;
    }) => void;
    const commit = jest.fn(() => new Promise<{
      changedRows: number;
      changedRowIds: string[];
      savedSnapshot: typeof savedSnapshot;
    }>((resolve) => {
      resolveCommit = resolve;
    }));
    const reviewRefetch = jest.fn().mockResolvedValue({ data: { table: savedTable }, error: null });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(prepared) });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    const rendered = renderDialog();
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save_updates' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    const reopenedSelection: SteelReviewSelection = {
      ...reviewSelection,
      captureId: 'capture-reopened',
      capturedAuthority: {
        outputId: table.outputId,
        revision: table.revision,
        table,
      },
    };
    rendered.unmount();
    const saveGateRef: MutableRefObject<SteelReviewSaveGate | undefined> = { current: undefined };
    const reopened = renderDialog(new QueryClient(), reopenedSelection, rendered.store, reviewIdentity, saveGateRef);
    const reopenedDraft = seedReopenedDraft(rendered.store, reopenedSelection, table);

    resolveCommit({ changedRows: 1, changedRowIds: ['row-1'], savedSnapshot });

    await waitFor(() => {
      expect(rendered.store.get(steelReviewSelectionAtom)).toEqual(reopenedSelection);
      expect(rendered.store.get(reopenedDraft.draftAtom)).toEqual(reopenedDraft.before);
      expect(saveGateRef.current?.getMatrix()).toEqual([['數量'], ['reopened']]);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    reopened.unmount();
  });

  it('keeps a reopened same-owner capture isolated while a no-op finishes after messages refresh', async () => {
    const { table, prepared } = createReopenLifecycleFixture();
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockResolvedValue({ changedRows: 0, changedRowIds: [] });
    let resolveReview!: (result: { data: { table: typeof table }; error: null }) => void;
    const reviewRefetch = jest.fn(() => new Promise<{ data: { table: typeof table }; error: null }>((resolve) => {
      resolveReview = resolve;
    }));
    let resolveMessages!: (messages: never[]) => void;
    const messagesPromise = new Promise<never[]>((resolve) => {
      resolveMessages = resolve;
    });
    jest.spyOn(dataService, 'getMessagesByConvoId').mockImplementation(() => messagesPromise);
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    const rendered = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: '數量 row-1' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => {
      expect(commit).toHaveBeenCalledTimes(1);
      expect(reviewRefetch).toHaveBeenCalledTimes(1);
    });

    resolveReview({ data: { table }, error: null });
    await waitFor(() => expect(dataService.getMessagesByConvoId).toHaveBeenCalledTimes(1));

    const reopenedSelection = createReopenedSelection(table, 'capture-reopened-noop');
    rendered.unmount();
    const saveGateRef: MutableRefObject<SteelReviewSaveGate | undefined> = { current: undefined };
    const reopened = renderDialog(new QueryClient(), reopenedSelection, rendered.store, reviewIdentity, saveGateRef);
    const reopenedDraft = seedReopenedDraft(rendered.store, reopenedSelection, table);
    resolveMessages([]);

    await waitFor(() => {
      expect(rendered.store.get(steelReviewSelectionAtom)).toEqual(reopenedSelection);
      expect(rendered.store.get(reopenedDraft.draftAtom)).toEqual(reopenedDraft.before);
      expect(saveGateRef.current?.getMatrix()).toEqual([['數量'], ['reopened']]);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    reopened.unmount();
  });

  it('keeps a reopened same-owner capture isolated while a committed receipt finishes after messages refresh', async () => {
    const { table, prepared, savedSnapshot } = createReopenLifecycleFixture();
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockRejectedValue(new Error('connection lost'));
    const receiptRefetch = jest.fn().mockResolvedValue({
      data: { status: 'committed', snapshot: savedSnapshot },
      error: null,
    });
    let resolveReview!: (result: { data: { table: typeof table }; error: null }) => void;
    const reviewRefetch = jest.fn(() => new Promise<{ data: { table: typeof table }; error: null }>((resolve) => {
      resolveReview = resolve;
    }));
    let resolveMessages!: (messages: never[]) => void;
    const messagesPromise = new Promise<never[]>((resolve) => {
      resolveMessages = resolve;
    });
    jest.spyOn(dataService, 'getMessagesByConvoId').mockImplementation(() => messagesPromise);
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    mockUseGetSteelReviewReceiptQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      refetch: receiptRefetch,
    });

    const rendered = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: '數量 row-1' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_discard_unsaved' }));
    await waitFor(() => {
      expect(receiptRefetch).toHaveBeenCalledTimes(1);
      expect(reviewRefetch).toHaveBeenCalledTimes(1);
    });

    resolveReview({ data: { table }, error: null });
    await waitFor(() => expect(dataService.getMessagesByConvoId).toHaveBeenCalledTimes(1));
    const reopenedSelection = createReopenedSelection(table, 'capture-reopened-receipt');
    rendered.unmount();
    const saveGateRef: MutableRefObject<SteelReviewSaveGate | undefined> = { current: undefined };
    const reopened = renderDialog(new QueryClient(), reopenedSelection, rendered.store, reviewIdentity, saveGateRef);
    const reopenedDraft = seedReopenedDraft(rendered.store, reopenedSelection, table);
    resolveMessages([]);

    await waitFor(() => {
      expect(rendered.store.get(steelReviewSelectionAtom)).toEqual(reopenedSelection);
      expect(rendered.store.get(reopenedDraft.draftAtom)).toEqual(reopenedDraft.before);
      expect(saveGateRef.current?.getMatrix()).toEqual([['數量'], ['reopened']]);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    reopened.unmount();
  });

  it('does not reuse a delayed prepare after a same-owner capture reopens and starts a fresh save', async () => {
    const { table, prepared } = createReopenLifecycleFixture();
    const nextPrepared = { ...prepared, operationId: 'operation-reopen-new' };
    let resolvePrepare!: (value: typeof prepared) => void;
    const prepare = jest.fn()
      .mockImplementationOnce(() => new Promise<typeof prepared>((resolve) => {
        resolvePrepare = resolve;
      }))
      .mockResolvedValueOnce(nextPrepared);
    const commit = jest.fn().mockResolvedValue({ changedRows: 0, changedRowIds: [] });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn().mockResolvedValue({ data: { table }, error: null }),
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    const rendered = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: '數量 row-1' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));

    const reopenedSelection = createReopenedSelection(table, 'capture-reopened-prepare');
    rendered.unmount();
    const saveGateRef: MutableRefObject<SteelReviewSaveGate | undefined> = { current: undefined };
    const reopened = renderDialog(new QueryClient(), reopenedSelection, rendered.store, reviewIdentity, saveGateRef);
    const reopenedDraft = seedReopenedDraft(rendered.store, reopenedSelection, table);
    resolvePrepare(prepared);

    await waitFor(() => {
      expect(commit).not.toHaveBeenCalled();
      expect(rendered.store.get(reopenedDraft.draftAtom)).toEqual(reopenedDraft.before);
      expect(saveGateRef.current?.getMatrix()).toEqual([['數量'], ['reopened']]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => {
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(commit).toHaveBeenCalledTimes(1);
    });
    expect(prepare.mock.calls[1]?.[0]?.operationId).not.toBe(prepared.operationId);
    await waitFor(() => {
      expect(rendered.store.get(reopenedDraft.draftAtom).past).toEqual([]);
      expect(rendered.store.get(reopenedDraft.draftAtom).future).toEqual([]);
      expect(screen.queryByRole('alert')).toBeNull();
    });
    reopened.unmount();
  });

  it.each([
    ['409 conflict', { response: { status: 409, data: { code: 'REVIEW_CONFLICT' } } }],
    ['ordinary error', new Error('connection lost')],
  ] as const)('does not apply a delayed %s to a reopened same-owner capture', async (_label, failure) => {
    const { table, prepared } = createReopenLifecycleFixture();
    let rejectCommit!: (reason: unknown) => void;
    const commit = jest.fn(() => new Promise<never>((_resolve, reject) => {
      rejectCommit = reject;
    }));
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn(),
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(prepared) });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });

    const rendered = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: '數量 row-1' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    const reopenedSelection = createReopenedSelection(table, `capture-reopened-${_label}`);
    rendered.unmount();
    const saveGateRef: MutableRefObject<SteelReviewSaveGate | undefined> = { current: undefined };
    const reopened = renderDialog(new QueryClient(), reopenedSelection, rendered.store, reviewIdentity, saveGateRef);
    const reopenedDraft = seedReopenedDraft(rendered.store, reopenedSelection, table);
    rejectCommit(failure);

    await waitFor(() => {
      expect(rendered.store.get(steelReviewSelectionAtom)).toEqual(reopenedSelection);
      expect(rendered.store.get(reopenedDraft.draftAtom)).toEqual(reopenedDraft.before);
      expect(saveGateRef.current?.getMatrix()).toEqual([['數量'], ['reopened']]);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    reopened.unmount();
  });

  it('acknowledges a committed receipt into the captured session after a new AI owner appears', async () => {
    const table = {
      ...reviewIdentity,
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      latestOutputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      headers: ['數量'],
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '2' } },
      }],
    };
    const newAiTable = {
      ...table,
      outputId: 'ocr_result:generation-2',
      revision: 'generation-2',
      latestOutputId: 'ocr_result:generation-2',
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '4', effective: '4' } },
      }],
    };
    const prepared = {
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      kind: reviewIdentity.kind,
      title: reviewIdentity.title,
      outputId: table.outputId,
      revision: table.revision,
      rows: table.rows,
      operationId: 'operation-receipt-new-ai',
      digest: 'q'.repeat(64),
      messageSha256: 'r'.repeat(64),
      target: { start: 0, end: 1, sha256: 's'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: table.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: { kind: reviewIdentity.kind, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const snapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: 'generation-1-save-1',
      headers: table.headers,
      rows: [{
        rowId: 'row-1',
        source: null,
        values: { 數量: { baseline: '2', effective: '9' } },
      }],
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 't'.repeat(64),
      conversationId: reviewIdentity.conversationId,
      messageId: reviewIdentity.messageId,
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
    };
    let reviewResolve!: (result: { data: { table: typeof newAiTable }; error: null }) => void;
    const reviewRefetch = jest.fn().mockImplementation(() => new Promise((resolve) => {
      reviewResolve = resolve;
    }));
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockRejectedValue(new Error('connection lost'));
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    let receiptResolve!: (result: { data: { status: 'committed'; snapshot: typeof snapshot }; error: null }) => void;
    const receiptRefetch = jest.fn().mockImplementation(() => new Promise((resolve) => {
      receiptResolve = resolve;
    }));
    mockUseGetSteelReviewReceiptQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      refetch: receiptRefetch,
    });

    const { store } = renderDialog();
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: '9' } });
    const draftAtom = steelReviewDraftStateFamily(getSteelReviewDraftOwnerKey(reviewIdentity, table, reviewSelection.captureId));
    const submittedChangeSequence = store.get(draftAtom).changeSequence;
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_discard_unsaved' }));
    await waitFor(() => expect(receiptRefetch).toHaveBeenCalledTimes(1));
    // Publish the newer owner while receipt reconciliation is awaiting the
    // authoritative current review. The captured prepared operation must stay
    // available for the receipt lookup.
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: newAiTable },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    fireEvent.change(input, { target: { value: '10' } });
    receiptResolve({ data: { status: 'committed', snapshot }, error: null });
    await waitFor(() => expect(reviewRefetch).toHaveBeenCalledTimes(1));
    reviewResolve({ data: { table: newAiTable }, error: null });

    await waitFor(() => {
      expect(input).toHaveValue('10');
      expect(screen.getByText('com_ui_steel_review_unsaved_caption')).toBeInTheDocument();
      expect(store.get(steelReviewSelectionAtom)?.capturedAuthority?.revision)
        .toBe(snapshot.revision);
      expect(store.get(steelReviewSelectionAtom)?.capturedAuthority?.table.rows[0]?.values.數量?.effective)
        .toBe('9');
      const draft = store.get(draftAtom);
      expect(draft.cells['row-1\u0000數量']).toBe('10');
      expect(draft.changeSequence).toBeGreaterThan(submittedChangeSequence);
      expect(draft.past).toEqual([]);
      expect(draft.future).toEqual([]);
      expect(draft.historyGroup).toBeUndefined();
    });
  });

  it('closes the captured session after a committed receipt when new AI arrives without later input', async () => {
    const { table, prepared, savedSnapshot } = createReopenLifecycleFixture();
    const newAiTable = {
      ...table,
      outputId: 'ocr_result:generation-reopen-new-ai',
      revision: 'generation-reopen-new-ai',
      latestOutputId: 'ocr_result:generation-reopen-new-ai',
      rows: [{
        ...table.rows[0],
        values: { 數量: { baseline: '4', effective: '4' } },
      }],
    };
    const reviewRefetch = jest.fn<Promise<{ data: { table: typeof newAiTable }; error: null }>, []>();
    let resolveReview!: (result: { data: { table: typeof newAiTable }; error: null }) => void;
    reviewRefetch.mockImplementation(() => new Promise((resolve) => {
      resolveReview = resolve;
    }));
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockRejectedValue(new Error('connection lost'));
    const receiptResolvers: Array<(result: {
      data: { status: 'committed'; snapshot: typeof savedSnapshot };
      error: null;
    }) => void> = [];
    const committedReceipt: {
      data: { status: 'committed'; snapshot: typeof savedSnapshot };
      error: null;
    } = { data: { status: 'committed', snapshot: savedSnapshot }, error: null };
    let receiptReleased = false;
    const receiptRefetch = jest.fn().mockImplementation(() => receiptReleased
      ? Promise.resolve({ ...committedReceipt })
      : new Promise((resolve) => {
        receiptResolvers.push(resolve);
      }));
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    mockUseGetSteelReviewReceiptQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      refetch: receiptRefetch,
    });

    const rendered = renderDialog();
    const input = screen.getByRole('textbox', { name: '數量 row-1' });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_discard_unsaved' }));
    await waitFor(() => expect(receiptRefetch).toHaveBeenCalledTimes(1));

    receiptReleased = true;
    receiptResolvers.forEach((resolve) => resolve(committedReceipt));
    await waitFor(() => expect(reviewRefetch).toHaveBeenCalledTimes(1));
    // The production refetch updates React Query's table while reconciliation
    // is still awaiting the current response. This re-render changes the
    // capture-scoped callbacks mid-await, the ordering that used to cancel the
    // committed receipt before it could close the old session.
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: newAiTable },
      error: null,
      isError: false,
      isLoading: false,
      refetch: reviewRefetch,
    });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <Provider store={rendered.store}>
          <SteelReviewDialog identity={reviewIdentity} />
        </Provider>
      </QueryClientProvider>,
    );
    resolveReview({ data: { table: newAiTable }, error: null });

    await waitFor(() => {
      expect(rendered.store.get(steelReviewSelectionAtom)).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
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
          title: 'ocr_result',
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
        title: 'ocr_result',
      }),
      expect.any(Object),
    ]);
    expect(candidateCall?.[0]).not.toHaveProperty('partIndex');
    mockMessageContext = { ...mockMessageContext, partIndex: undefined };
  });
});
