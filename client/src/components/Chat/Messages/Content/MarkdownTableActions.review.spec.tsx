import { Profiler } from 'react';
import { RecoilRoot } from 'recoil';
import { createStore, Provider } from 'jotai';
import { dataService, DynamicQueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import type { SteelReviewIdentity, SteelReviewSelection } from './SteelReview/state';
import { steelReviewDraftStateFamily, steelReviewSelectionAtom } from './SteelReview/state';
import { getSteelReviewDraftKey, getSteelReviewDraftOwnerKey } from './SteelReview/session';
import SteelReviewDialog, { type SteelReviewSaveGate } from './SteelReviewDialog';
import { SteelVersionsContext } from './SteelReview/heading';
import MarkdownTableActions from './MarkdownTableActions';

let mockIsDesktop = false;

jest.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'pdf-worker.js' }), { virtual: true });
jest.mock('pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: jest.fn(),
}));

jest.mock('@librechat/client', () => {
  const { Spinner, ResizableHandle, ResizablePanel, ResizablePanelGroup } = jest.requireActual('@librechat/client');
  const React = jest.requireActual<typeof import('react')>('react');
  const Pass = ({ children, asChild: _asChild, ...props }: {
    children?: React.ReactNode;
    asChild?: boolean;
  }) => React.createElement('div', props, children);
  const Button = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', props, children);
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement('input', props);
  const Checkbox = ({ checked, onCheckedChange, ...props }: React.InputHTMLAttributes<HTMLInputElement> & {
    onCheckedChange?: (checked: boolean) => void;
  }) => React.createElement('input', {
    ...props,
    type: 'checkbox',
    checked,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onCheckedChange?.(event.target.checked),
  });
  const Tag = ({ label, ...props }: { label: string; variant?: string }) =>
    React.createElement('div', props, label);
  const Select = ({ value, onValueChange, children, disabled }: {
    value?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  }) => React.createElement(
    'select',
    { value, disabled, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value) },
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
    Spinner,
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
    Button,
    useMediaQuery: () => mockIsDesktop,
    useNestedPopoverStyle: () => ({ zIndex: 150, pointerEvents: 'auto' }),
    TooltipAnchor: ({ render, description }: {
      render: React.ReactElement;
      description: string;
    }) => React.cloneElement(render, { title: description }),
    Checkbox,
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
});

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
  mockIsDesktop = false;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() });
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
  useGetSteelReviewCatalogQuery: jest.fn(() => ({
    data: undefined,
    error: null,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
    isSuccess: false,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    refetch: jest.fn(),
    remove: jest.fn(),
  })),
}));
const {
  useGetSteelReviewQuery: mockUseGetSteelReviewQuery,
  useGetSteelReviewSourcesQuery: mockUseGetSteelReviewSourcesQuery,
  useGetSteelReviewSourceQuery: mockUseGetSteelReviewSourceQuery,
  useGetSteelReviewSourcePageCountQuery: mockUseGetSteelReviewSourcePageCountQuery,
  usePrepareSteelReviewMutation: mockUsePrepareSteelReviewMutation,
  useCommitSteelReviewMutation: mockUseCommitSteelReviewMutation,
  useGetSteelReviewReceiptQuery: mockUseGetSteelReviewReceiptQuery,
} = jest.requireMock('~/data-provider') as {
  useGetSteelReviewQuery: jest.Mock;
  useGetSteelReviewSourcesQuery: jest.Mock;
  useGetSteelReviewSourceQuery: jest.Mock;
  useGetSteelReviewSourcePageCountQuery: jest.Mock;
  usePrepareSteelReviewMutation: jest.Mock;
  useCommitSteelReviewMutation: jest.Mock;
  useGetSteelReviewReceiptQuery: jest.Mock;
};
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    key === 'com_ui_steel_review_save_count' ? `com_ui_steel_review_save (${values?.[0] ?? 0})` : key,
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

function getEditableTextbox(name: string): HTMLElement {
  const existing = screen.queryByRole('textbox', { name });
  if (existing) return existing;
  const rowId = name.slice(name.lastIndexOf(' ') + 1);
  fireEvent.click(screen.getByRole('button', { name: `com_ui_edit ${rowId}` }));
  return screen.getByRole('textbox', { name });
}

function querySteelReviewCell(text: string): HTMLTableCellElement | null {
  return [...document.querySelectorAll<HTMLTableCellElement>('table tbody td')]
    .find((cell) => cell.textContent?.trim() === text) ?? null;
}

async function findEditableTextbox(name: string): Promise<HTMLElement> {
  const rowId = name.slice(name.lastIndexOf(' ') + 1);
  await screen.findByRole('button', { name: `com_ui_edit ${rowId}` });
  return getEditableTextbox(name);
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

it('locks an open previous OCR dialog when a regenerated sibling becomes latest', async () => {
  const { table } = createReopenLifecycleFixture();
  mockUseGetSteelReviewQuery.mockReturnValue({ data: { table }, refetch: jest.fn() });
  const queryClient = new QueryClient();
  const store = createStore();
  store.set(steelReviewSelectionAtom, reviewSelection);
  const version = (latest: boolean) =>
    new Map([
      [
        JSON.stringify([table.messageId, table.kind, table.title, table.outputId]),
        { ...reviewIdentity, outputId: table.outputId, revision: table.revision, latest, saves: 0 },
      ],
    ]);
  const view = (latest: boolean) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <SteelVersionsContext.Provider value={version(latest)}>
          <SteelReviewDialog identity={reviewIdentity} />
        </SteelVersionsContext.Provider>
      </Provider>
    </QueryClientProvider>
  );
  const rendered = render(view(true));
  expect(await screen.findByRole('button', { name: 'com_ui_edit row-1' })).toBeEnabled();
  rendered.rerender(view(false));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'com_ui_edit row-1' })).toBeNull(),
  );
  expect(screen.getByText('com_ui_steel_review_previous_version')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /com_ui_steel_review_save/ })).toBeDisabled();
});

function seedReopenedDraft(
  store: ReturnType<typeof createStore>,
  selection: SteelReviewSelection,
  table: ReturnType<typeof createReopenLifecycleFixture>['table'],
) {
  const draftAtomKey = getSteelReviewDraftOwnerKey(selection, table, selection.captureId);
  const ownerKey = `${getSteelReviewDraftKey(selection, table)}:${selection.captureId}`;
  const draftAtom = steelReviewDraftStateFamily(draftAtomKey);
  store.set(draftAtom, (current) => ({
    ...current,
    ownerKey,
    cells: { 'row-1\u0000數量': 'reopened' },
    touched: { 'row-1\u0000數量': 'reopened' },
    cellVersions: { 'row-1\u0000數量': 42 },
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

function renderTable(title = testHeading) {
  const queryClient = new QueryClient();
  const store = createStore();
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <RecoilRoot>
          <div className="message-render">
            <div className="message-content">
              <h2>{title}</h2>
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
      </Provider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient, store };
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
  it.each(['ocr_result', 'system_order', 'system_order｜報價單 A'])(
    'opens review for %s when the backend has no saved table', async (title) => {
      mockUseGetSteelReviewQuery.mockReturnValue({
        data: undefined,
        error: { response: { status: 404 } },
        isError: true,
        isLoading: false,
      });

      const { store } = renderTable(title);
      fireEvent.click(await screen.findByRole('button', { name: 'com_ui_steel_review_open' }));

      expect(store.get(steelReviewSelectionAtom)).toMatchObject({
        conversationId: 'conversation-1', messageId: 'message-1', title,
        kind: title === 'ocr_result' ? 'ocr_result' : 'system_order',
      });
      expect(screen.getByRole('dialog')).toHaveTextContent('com_ui_steel_review_empty');
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ })).toBeDisabled();
    },
  );

  it.each(['ocr_result', 'system_order'])(
    'opens the loading state for %s before recognition finishes', async (title) => {
      mockUseGetSteelReviewQuery.mockReturnValue({
        data: undefined, error: null, isError: false, isLoading: true,
      });
      renderTable(title);
      fireEvent.click(await screen.findByRole('button', { name: 'com_ui_steel_review_open' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('com_ui_steel_review_loading');
      expect(screen.queryByRole('textbox')).toBeNull();
    },
  );

  it('does not offer review for ordinary tables or user-authored Steel headings', () => {
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: undefined, error: null, isError: false, isLoading: false,
    });
    const ordinary = renderTable('Other table');
    expect(screen.queryByRole('button', { name: 'com_ui_steel_review_open' })).toBeNull();
    ordinary.unmount();
    mockMessageContext = { ...mockMessageContext, isCreatedByUser: true };
    try {
      renderTable();
      expect(screen.queryByRole('button', { name: 'com_ui_steel_review_open' })).toBeNull();
    } finally {
      mockMessageContext = { ...mockMessageContext, isCreatedByUser: false };
    }
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

  it('saves a newly added processing row after classification and completed matching remarks', async () => {
    const systemIdentity: SteelReviewIdentity = {
      ...reviewIdentity,
      kind: 'system_order',
      title: 'system_order｜下載測試',
    };
    const systemSelection: SteelReviewSelection = {
      ...reviewSelection,
      ...systemIdentity,
    };
    const addedProcessingRowId: ReturnType<typeof crypto.randomUUID> =
      '00000000-0000-4000-8000-000000000001';
    const material = {
      rowId: 'material-1',
      source: null,
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      values: {
        品名規格: { baseline: '材料A', effective: '材料A' },
        備註: { baseline: 'P1', effective: 'P1' },
        總數: { baseline: '2', effective: '2' },
        單價: { baseline: '10', effective: '10' },
      },
    };
    const processing = {
      rowId: 'processing-1',
      source: null,
      system: { kind: 'processing' as const, parentRowId: material.rowId, cascadeDeletedBy: null },
      values: {
        品名規格: { baseline: '加工A', effective: '加工A' },
        備註: { baseline: 'P1', effective: 'P1' },
        總數: { baseline: '1', effective: '1' },
        單價: { baseline: '3', effective: '3' },
      },
    };
    const addedProcessing = {
      rowId: addedProcessingRowId,
      source: null,
      origin: 'manual' as const,
      deleted: false,
      insertion: { kind: 'after' as const, rowId: material.rowId, ordinal: 0 },
      system: { kind: 'processing' as const, parentRowId: material.rowId, cascadeDeletedBy: null },
      values: {
        品名規格: { baseline: null, effective: '加工B' },
        備註: { baseline: null, effective: 'P1' },
        總數: { baseline: null, effective: '1' },
        單價: { baseline: null, effective: '4' },
      },
    };
    const initialTable = {
      ...systemIdentity,
      outputId: 'system_order:download-run',
      revision: 'download-revision-1',
      latestOutputId: 'system_order:download-run',
      isLatest: true,
      readOnly: false,
      headers: ['品名規格', '總數', '單價', '備註'],
      rows: [material, processing],
    };
    const latestTable = {
      ...initialTable,
      revision: 'download-revision-2',
      rows: [material, processing, addedProcessing],
    };
    const prepared = {
      ...systemIdentity,
      outputId: initialTable.outputId,
      revision: initialTable.revision,
      rows: latestTable.rows,
      operationId: 'download-operation',
      digest: 'a'.repeat(64),
      messageSha256: 'b'.repeat(64),
      target: { start: 0, end: 1, sha256: 'c'.repeat(64) },
      replacementText: 'replacement',
      cleanReplacementText: 'replacement',
      targetText: 'target',
      headers: initialTable.headers,
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: {
        kind: 'system_order' as const,
        changedRows: 1,
        changedRowIds: [addedProcessing.rowId],
        customerQuoteChangedRows: 0,
        customerQuoteTotal: null,
      },
    };
    const savedSnapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      outputId: prepared.outputId,
      revision: latestTable.revision,
      headers: latestTable.headers,
      rows: latestTable.rows,
      changedRows: 1,
      changedRowIds: [addedProcessing.rowId],
      savedAt: '2026-10-03T00:00:00.000Z',
      messageSha256: 'd'.repeat(64),
      conversationId: systemIdentity.conversationId,
      messageId: systemIdentity.messageId,
      messageText: 'saved',
      effectiveMarkdown: 'effective',
      displayMarkdown: 'display',
      caption: prepared.caption,
    };
    const prepare = jest.fn().mockResolvedValue(prepared);
    const commit = jest.fn().mockResolvedValue({
      changedRows: 1,
      changedRowIds: [addedProcessing.rowId],
      savedSnapshot,
    });
    const refetch = jest.fn().mockResolvedValue({ data: { table: latestTable }, error: null });
    jest.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(addedProcessing.rowId);
    mockUsePrepareSteelReviewMutation.mockReturnValue({ mutateAsync: prepare });
    mockUseCommitSteelReviewMutation.mockReturnValue({ mutateAsync: commit });
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: initialTable },
      error: null,
      isError: false,
      isLoading: false,
      refetch,
    });

    const queryClient = new QueryClient();
    queryClient.setQueryData(DynamicQueryKeys.steelReview(
      systemIdentity.conversationId,
      systemIdentity.kind,
      systemIdentity.messageId,
      systemIdentity.title,
    ), { table: initialTable });
    renderDialog(queryClient, systemSelection, createStore(), systemIdentity);
    fireEvent.click(await screen.findByRole('button', { name: 'com_ui_steel_review_add_row' }));
    const addedRow = document.querySelector<HTMLElement>(`tr[data-row-id="${addedProcessingRowId}"]`)!;
    fireEvent.click(within(addedRow).getByRole('button', { name: `com_ui_edit ${addedProcessingRowId}` }));
    fireEvent.change(within(addedRow).getByRole('combobox'), { target: { value: 'processing' } });
    const remark = within(addedRow).getByRole('textbox', { name: `備註 ${addedProcessingRowId}` });
    fireEvent.focus(remark);
    fireEvent.change(remark, { target: { value: 'P1' } });
    fireEvent.blur(remark);
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      operations: [expect.objectContaining({ type: 'add', rowId: addedProcessingRowId,
        system: { kind: 'processing', parentRowId: material.rowId } })],
    }));
    expect(screen.queryByRole('button', { name: 'com_ui_download_table_csv' })).toBeNull();
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

    expect(await findEditableTextbox('總數 row-1')).toBeEnabled();
    expect(getEditableTextbox('單價 row-1')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'com_ui_steel_review_add_row' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_steel_review_delete_row row-1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /com_ui_steel_review_restore_row/u })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'com_ui_steel_review_action' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /com_ui_steel_review_bound/u })).toBeInTheDocument();
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
    fireEvent.change(await findEditableTextbox('品名 row-1'), { target: { value: '本地草稿' } });
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
    const input = getEditableTextbox('品名 row-1');
    fireEvent.change(input, { target: { value: '鍍鋅鋼板' } });
    fireEvent.change(input, { target: { value: '另一種鋼板' } });
    fireEvent.change(input, { target: { value: '鋼板' } });
    expect(screen.queryByText('com_ui_steel_review_unsaved_caption')).toBeNull();
    fireEvent.change(input, { target: { value: '鍍鋅鋼板' } });
    expect(screen.getByRole('button', { name: /^com_ui_steel_review_save \([1-9]\d*\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    const closeButtons = within(screen.getByRole('alertdialog')).getAllByRole('button');
    expect(closeButtons.map((button) => button.textContent)).toEqual([
      'com_ui_steel_review_discard_unsaved',
      'com_ui_steel_review_continue_editing',
      'com_ui_steel_review_save (1)',
    ]);
    expect(closeButtons[0]).toHaveAttribute('variant', 'destructive');
    expect(closeButtons[2]).toHaveAttribute('variant', 'submit');
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_continue_editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(getEditableTextbox('品名 row-1')).toHaveValue('鍍鋅鋼板');

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
    fireEvent.change(getEditableTextbox('品名 row-1'), { target: { value: '鍍鋅鋼板' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));

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

  it('does not restore a persisted save caption when the review closes and reopens', async () => {
    const { table, savedSnapshot } = createReopenLifecycleFixture();
    const savedTable = {
      ...table,
      revision: savedSnapshot.revision,
      rows: savedSnapshot.rows,
      lastSave: { revision: savedSnapshot.revision, changedRows: 1, snapshot: savedSnapshot },
    };
    mockUseGetSteelReviewQuery.mockReturnValue({
      data: { table: savedTable }, error: null, isError: false, isLoading: false,
      refetch: jest.fn().mockResolvedValue({ data: { table: savedTable }, error: null }),
    });
    const { store } = renderDialog();
    expect(screen.queryByText('com_ui_steel_review_updated_caption')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'com_ui_close' }).at(-1)!);
    await waitFor(() => expect(store.get(steelReviewSelectionAtom)).toBeNull());
    act(() => store.set(steelReviewSelectionAtom, { ...reviewSelection, captureId: 'capture-after-close' }));
    await screen.findByRole('dialog');
    expect(screen.queryByText('com_ui_steel_review_updated_caption')).toBeNull();
    expect(screen.queryByText('com_ui_steel_review_save_caption')).toBeNull();
  });

  it('shows the prepared row count while saving and closes only after a confirmed commit', async () => {
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

    const { store } = renderDialog();
    fireEvent.change(getEditableTextbox('品名 row-1'), { target: { value: '鍍鋅鋼板' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(screen.getByText('com_ui_steel_review_saving_count_one')).toBeInTheDocument();
    expect(screen.queryByText('com_ui_steel_review_save_caption')).toBeNull();
    expect(screen.queryByText('com_ui_steel_review_saving')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText('com_ui_steel_review_updated_caption')).toBeNull();
    expect(store.get(steelReviewSelectionAtom)).not.toBeNull();

    resolveCommit({ changedRows: 1, changedRowIds: ['row-1'], savedSnapshot });
    await waitFor(() => expect(store.get(steelReviewSelectionAtom)).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
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
    const { store } = renderDialog(queryClient);

    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: ' 2 ' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.get(steelReviewSelectionAtom)).toBeNull());
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: ' 2 ' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: '10' } });
    resolveRefetch({ data: { table }, error: null });

    await waitFor(() => {
      expect(input).toHaveValue('10');
      expect(screen.getByRole('button', { name: /^com_ui_steel_review_save \([1-9]\d*\)$/ })).toBeInTheDocument();
    });
  });

  it('keeps a normalized draft while the authority reread is uncertain', async () => {
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: ' 2 ' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(getEditableTextbox('數量 row-1')).toHaveValue('2');
      expect(screen.getByRole('button', { name: /^com_ui_steel_review_save \([1-9]\d*\)$/ })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('com_ui_steel_review_save_uncertain');
    });

    await waitFor(() => {
      expect(commit).toHaveBeenCalledTimes(1);
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'com_ui_close' })).toBeEnabled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveClass('text-text-destructive');
    });
  });

  it('locks edits and closing while commit is pending', async () => {
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

    fireEvent.change(getEditableTextbox('品名 row-1'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'com_ui_close' })).toBeDisabled();
    });
    expect(screen.queryByRole('textbox', { name: '品名 row-1' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    resolveCommit(commitResult);

    await waitFor(() => {
      expect(rendered.store.get(steelReviewSelectionAtom)).toBeNull();
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    rendered.unmount();
    activeReviewQueryClient = undefined;
  });

  it.skip('retries a failed receipt lookup and preserves edits made after discard starts', async () => {
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
    const input = getEditableTextbox('品名 row-1');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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
      expect(screen.getByRole('button', { name: /^com_ui_steel_review_save \([1-9]\d*\)$/ })).toBeInTheDocument();
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: mode === 'no-op' ? ' 2 ' : '9' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.get(steelReviewSelectionAtom)?.capturedAuthority?.revision)
      .toBe(table.revision));
    const draftAtom = steelReviewDraftStateFamily(getSteelReviewDraftOwnerKey(reviewIdentity, table, reviewSelection.captureId));
    expect(store.get(draftAtom).changeSequence).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^com_ui_steel_review_save \([1-9]\d*\)$/ })).toBeInTheDocument();
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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
    fireEvent.change(getEditableTextbox('數量 row-1'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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
    fireEvent.change(getEditableTextbox('數量 row-1'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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
    fireEvent.change(getEditableTextbox('數量 row-1'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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

    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
    await waitFor(() => {
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(commit).toHaveBeenCalledTimes(1);
    });
    expect(prepare.mock.calls[1]?.[0]?.operationId).not.toBe(prepared.operationId);
    await waitFor(() => {
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
    fireEvent.change(getEditableTextbox('數量 row-1'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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

  it.skip('acknowledges a committed receipt into the captured session after a new AI owner appears', async () => {
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: '9' } });
    const draftAtom = steelReviewDraftStateFamily(getSteelReviewDraftOwnerKey(reviewIdentity, table, reviewSelection.captureId));
    const submittedChangeSequence = store.get(draftAtom).changeSequence;
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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
      expect(screen.getByRole('button', { name: /^com_ui_steel_review_save \([1-9]\d*\)$/ })).toBeInTheDocument();
      expect(store.get(steelReviewSelectionAtom)?.capturedAuthority?.revision)
        .toBe(snapshot.revision);
      expect(store.get(steelReviewSelectionAtom)?.capturedAuthority?.table.rows[0]?.values.數量?.effective)
        .toBe('9');
      const draft = store.get(draftAtom);
      expect(draft.cells['row-1\u0000數量']).toBe('10');
      expect(draft.changeSequence).toBeGreaterThan(submittedChangeSequence);
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
    const input = getEditableTextbox('數量 row-1');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /^com_ui_steel_review_save(?: \(\d+\))?$/ }));
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

  it('reserves the source layout without showing unfiltered rows while sources load or fail', async () => {
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
      rows: [row, {
        ...row,
        rowId: 'other-page',
        values: { Part: { baseline: 'P-2', effective: 'P-2' } },
        source: { ...row.source, pageNumber: 2 },
      }, {
        ...row,
        rowId: 'other-file',
        values: { Part: { baseline: 'P-3', effective: 'P-3' } },
        source: { ...row.source, fileId: 'drawing-b' },
      }],
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
    expect(screen.queryByText('P-1')).not.toBeInTheDocument();
    expect(screen.queryByText('P-2')).not.toBeInTheDocument();
    expect(screen.queryByText('P-3')).not.toBeInTheDocument();
    expect(screen.getByText('com_ui_steel_review_source')).toBeInTheDocument();
    expect(screen.getByText('com_ui_steel_review_page')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    screen.getAllByRole('combobox').forEach((selector) => expect(selector).toBeDisabled());
    expect(screen.getByRole('checkbox', { name: 'com_ui_steel_review_unlinked' })).toBeDisabled();

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
    expect(screen.queryByText('P-1')).not.toBeInTheDocument();
    expect(screen.queryByText('P-2')).not.toBeInTheDocument();
    expect(screen.queryByText('P-3')).not.toBeInTheDocument();
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
    await waitFor(() => expect(querySteelReviewCell('P-1')).not.toBeNull());
    expect(querySteelReviewCell('P-2')).toBeNull();
    expect(querySteelReviewCell('P-3')).toBeNull();
  });

  it('keeps show-unlinked scoped to unlinked rows through binding and a dialog refresh', async () => {
    const table = {
      ...reviewIdentity,
      outputId: 'ocr_result:unlinked-filter',
      revision: 'unlinked-filter',
      latestOutputId: 'ocr_result:unlinked-filter',
      isLatest: true,
      readOnly: false,
      headers: ['Part'],
      rows: [{
        rowId: 'bound-row',
        values: { Part: { baseline: 'BOUND', effective: 'BOUND' } },
        source: { fileId: 'drawing-a', pageNumber: 1, filename: 'drawing-a.png', mediaType: 'image/png' },
      }, {
        rowId: 'unlinked-row',
        values: { Part: { baseline: 'UNLINKED', effective: 'UNLINKED' } },
        source: null,
      }],
    };
    mockUseGetSteelReviewQuery.mockReturnValue({ data: { table }, error: null, isError: false, isLoading: false });
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: { sources: [{ fileId: 'drawing-a', filename: 'drawing-a.png', mediaType: 'image/png' }] },
      error: null,
      isError: false,
      isLoading: false,
    });
    mockUseGetSteelReviewSourceQuery.mockReturnValue({ data: undefined, isError: false, isLoading: false });

    const rendered = renderDialog(new QueryClient(), {
      ...reviewSelection,
      captureId: 'capture-unlinked-filter',
    });
    const checkbox = await screen.findByRole('checkbox', { name: 'com_ui_steel_review_unlinked' });
    expect(screen.getByText('BOUND')).toBeInTheDocument();
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(checkbox).toBeChecked();
      expect(screen.getByText('UNLINKED')).toBeInTheDocument();
      expect(screen.queryByText('BOUND')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_bind unlinked-row' }));
    const linkDialog = screen.getAllByRole('dialog').at(-1);
    expect(linkDialog).toBeDefined();
    expect(within(linkDialog!).getByRole('button', { name: 'com_ui_confirm' })).toBeEnabled();
    fireEvent.click(within(linkDialog!).getByRole('button', { name: 'com_ui_confirm' }));

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'com_ui_steel_review_unlinked' })).toBeChecked();
      expect(screen.queryByText('UNLINKED')).not.toBeInTheDocument();
    });

    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <Provider store={rendered.store}>
          <SteelReviewDialog identity={reviewIdentity} />
        </Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('checkbox', { name: 'com_ui_steel_review_unlinked' })).toBeChecked();
    expect(screen.queryByText('UNLINKED')).not.toBeInTheDocument();
  });

  it.each(['ocr_result', 'system_order'] as const)('uses the initial source page in every %s render', async (kind) => {
    const identity = { ...reviewIdentity, kind, title: kind };
    const table = {
      ...identity,
      outputId: `${kind}:initial-page`,
      revision: 'initial-page',
      latestOutputId: `${kind}:initial-page`,
      isLatest: true,
      readOnly: true,
      headers: ['Part'],
      rows: [3, 1].map((pageNumber) => ({
        rowId: `page-${pageNumber}`,
        source: { fileId: 'drawing-a', pageNumber, filename: 'drawing-a.pdf' },
        values: { Part: { baseline: `Part-${pageNumber}`, effective: `Part-${pageNumber}` } },
      })),
    };
    mockUseGetSteelReviewQuery.mockReturnValue({ data: { table }, error: null, isError: false, isLoading: false });
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({ data: undefined, isError: false, isLoading: true });
    mockUseGetSteelReviewSourceQuery.mockReturnValue({ data: undefined, isError: false, isLoading: true });
    const store = createStore();
    store.set(steelReviewSelectionAtom, { ...identity, captureId: `capture-${kind}-initial-page` });
    const queryClient = new QueryClient();
    const commits: { page: string; firstPageVisible: boolean; thirdPageVisible: boolean }[] = [];
    const captureCommit = () => {
      const commit = {
        page: (screen.queryAllByRole('combobox')[1] as HTMLSelectElement | undefined)?.value ?? '',
        firstPageVisible: querySteelReviewCell('Part-1') !== null,
        thirdPageVisible: querySteelReviewCell('Part-3') !== null,
      };
      commits.push(commit);
    };
    const renderTree = () => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <Profiler id="review-source-page" onRender={captureCommit}>
            <SteelReviewDialog identity={identity} />
          </Profiler>
        </Provider>
      </QueryClientProvider>
    );
    const rendered = render(renderTree());
    await waitFor(() => {
      expect(commits.length).toBeGreaterThan(0);
      expect(commits.every((commit) => !commit.firstPageVisible && !commit.thirdPageVisible)).toBe(true);
    });
    commits.length = 0;
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: { sources: [{ fileId: 'drawing-a', filename: 'drawing-a.pdf', mediaType: 'application/pdf' }] },
      isError: false,
      isLoading: false,
    });
    rendered.rerender(renderTree());
    await waitFor(() => {
      expect(commits.length).toBeGreaterThan(0);
      expect(commits.every((commit) => commit.page === '3' && !commit.firstPageVisible && commit.thirdPageVisible)).toBe(true);
    });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '1' } });
    expect(querySteelReviewCell('Part-1')).not.toBeNull();
    expect(querySteelReviewCell('Part-3')).toBeNull();
  });

  it('renders source loading, failure, and selectors for system-order reviews', async () => {
    const identity = {
      ...reviewIdentity,
      kind: 'system_order' as const,
      title: 'system_order',
    };
    const selection: SteelReviewSelection = { ...identity, captureId: 'capture-system-source' };
    const table = {
      ...identity,
      outputId: 'system_order:run-1',
      revision: 'revision-1',
      latestOutputId: 'system_order:run-1',
      isLatest: true,
      readOnly: true,
      headers: ['品名'],
      rows: [{
        rowId: 'material-1',
        system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
        source: { fileId: 'drawing-a', pageNumber: 1, filename: 'drawing-a.png' },
        values: { 品名: { baseline: '鋼板', effective: '鋼板' } },
      }],
    };
    const sourceRefetch = jest.fn();
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
    const rendered = renderDialog(new QueryClient(), selection, createStore(), identity);
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_steel_review_sources_loading');
    expect(screen.queryByText('鋼板')).not.toBeInTheDocument();

    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: undefined,
      error: new Error('source listing failed'),
      isError: true,
      isLoading: false,
      refetch: sourceRefetch,
    });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <Provider store={rendered.store}>
          <SteelReviewDialog identity={identity} />
        </Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_steel_review_sources_error');
    expect(screen.queryByText('鋼板')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'com_ui_retry' }).click();
    expect(sourceRefetch).toHaveBeenCalledTimes(1);

    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: { sources: [{ fileId: 'drawing-a', filename: 'drawing-a.png', mediaType: 'image/png' }] },
      error: null,
      isError: false,
      isLoading: false,
      refetch: sourceRefetch,
    });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <Provider store={rendered.store}>
          <SteelReviewDialog identity={identity} />
        </Provider>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('option', { name: 'drawing-a.png' })).toBeInTheDocument();
  });

  it.each([true, false])('places source controls in the footer only on desktop: %s', (isDesktop) => {
    mockIsDesktop = isDesktop;
    const table = {
      ...reviewIdentity,
      outputId: 'ocr_result:source-layout',
      revision: 'source-layout',
      latestOutputId: 'ocr_result:source-layout',
      isLatest: true,
      readOnly: false,
      headers: ['Part'],
      rows: [{
        rowId: 'layout-row',
        values: { Part: { baseline: 'D3', effective: 'D3' } },
        source: { fileId: 'layout-pdf', pageNumber: 1, filename: 'PL.pdf' },
      }],
    };
    mockUseGetSteelReviewQuery.mockReturnValue({ data: { table }, error: null, isError: false, isLoading: false });
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: { sources: [{ fileId: 'layout-pdf', filename: 'PL.pdf', mediaType: 'application/pdf' }] },
      isError: false,
      isLoading: false,
    });
    mockUseGetSteelReviewSourceQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderDialog();
    const resizeHandle = screen.getByRole('separator', { name: 'com_ui_steel_review_resize_panels' });
    expect(resizeHandle).toHaveAttribute('aria-orientation', 'horizontal');
    expect(resizeHandle).toHaveClass('cursor-row-resize');
    const sourceSelector = screen.getByRole('option', { name: 'PL.pdf' }).parentElement;
    const closeButtons = screen.getAllByRole('button', { name: 'com_ui_close' });
    const footer = closeButtons.at(-1)?.parentElement;
    expect(footer?.contains(sourceSelector)).toBe(isDesktop);
    const addRow = screen.getByRole('button', { name: 'com_ui_steel_review_add_row' });
    expect(addRow.textContent).toBe('');
    expect(addRow.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('com_ui_steel_review_editable')).not.toBeInTheDocument();
    if (isDesktop) {
      fireEvent.click(addRow);
      fireEvent.click(closeButtons[0]);
      expect(screen.getByRole('alertdialog', { name: 'com_ui_steel_review_close_confirm' })).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    }
  });

  it.each(['metadata', 'cache'])('opens a linked source with its known page range from %s without another request', (countOrigin) => {
    const table = {
      ...reviewIdentity,
      outputId: 'ocr_result:known-page-range',
      revision: 'known-page-range',
      latestOutputId: 'ocr_result:known-page-range',
      isLatest: true,
      readOnly: false,
      headers: ['Part'],
      rows: [{
        rowId: 'linked-row',
        values: { Part: { baseline: 'D3', effective: 'D3' } },
        source: { fileId: 'known-pdf', pageNumber: 2, filename: 'PL.pdf' },
      }],
    };
    mockUseGetSteelReviewQuery.mockReturnValue({ data: { table }, error: null, isError: false, isLoading: false });
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: { sources: [{ fileId: 'known-pdf', filename: 'PL.pdf', mediaType: 'application/pdf', pageCount: countOrigin === 'metadata' ? 4 : undefined }] },
      isError: false,
      isLoading: false,
    });
    mockUseGetSteelReviewSourceQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUseGetSteelReviewSourcePageCountQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const queryClient = new QueryClient();
    if (countOrigin === 'cache') {
      queryClient.setQueryData(DynamicQueryKeys.steelReviewSourcePageCount(
        reviewIdentity.conversationId, reviewIdentity.kind, reviewIdentity.messageId, 'known-pdf',
      ), { pageCount: 4 });
    }
    renderDialog(queryClient);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_bound linked-row' }));
    const linkDialog = screen.getAllByRole('dialog')[1];
    expect(within(linkDialog).queryByText('com_ui_steel_review_source_page_loading')).not.toBeInTheDocument();
    const pageSelector = within(linkDialog).getAllByRole('combobox')[1];
    expect(within(pageSelector).getAllByRole('option').map((option) => option.textContent)).toEqual(['1', '2', '3', '4']);
    expect(pageSelector).toHaveValue('2');
    expect(within(linkDialog).getByRole('button', { name: 'com_ui_confirm' })).toBeEnabled();
    expect(mockUseGetSteelReviewSourcePageCountQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileId: 'known-pdf' }), expect.objectContaining({ enabled: false }),
    );
    mockUseGetSteelReviewSourcePageCountQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  });

  it('renders a readonly OCR reference for bound system rows and updates it after manual rebinding', async () => {
    const identity = {
      ...reviewIdentity,
      kind: 'system_order' as const,
      title: 'system_order｜報價單',
    };
    const selection: SteelReviewSelection = { ...identity, captureId: 'capture-system-ocr-reference' };
    const ocrOutputId = 'ocr_result:reference-output';
    const ocrRevision = 'reference-revision';
    const table = {
      ...identity,
      outputId: 'system_order:reference-output',
      revision: 'system-reference-revision',
      latestOutputId: 'system_order:reference-output',
      isLatest: true,
      readOnly: false,
      headers: ['零件編號'],
      rows: [{
        rowId: 'system-row-1',
        system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
        source: { fileId: 'drawing-a', pageNumber: 1, filename: 'drawing-a.png', mediaType: 'image/png' },
        values: { 零件編號: { baseline: 'D3', effective: 'D3' } },
        ocrLink: { outputId: ocrOutputId, revision: ocrRevision, rowId: 'ocr-row-1' },
      }],
      ocrContext: {
        title: 'ocr_result｜PL.pdf',
        outputId: ocrOutputId,
        revision: ocrRevision,
        headers: ['零件編號'],
        rows: [{
          rowId: 'ocr-row-1',
          source: { fileId: 'drawing-a', pageNumber: 1, filename: 'drawing-a.png', mediaType: 'image/png' },
          values: { 零件編號: { baseline: 'OCR-D3', effective: 'OCR-D3' } },
        }, {
          rowId: 'ocr-row-2',
          source: { fileId: 'drawing-b', pageNumber: 2, filename: 'PL.pdf', mediaType: 'application/pdf' },
          values: { 零件編號: { baseline: 'OCR-S3', effective: 'OCR-S3' } },
        }],
      },
    };
    const sourceBlob = new Blob(['image'], { type: 'image/png' });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:steel-reference') });
    mockUseGetSteelReviewQuery.mockReturnValue({ data: { table }, error: null, isError: false, isLoading: false });
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: {
        sources: [
          { fileId: 'drawing-a', filename: 'drawing-a.png', mediaType: 'image/png' },
          { fileId: 'drawing-b', filename: 'PL.pdf', mediaType: 'application/pdf', pageCount: 2 },
        ],
      },
      error: null,
      isError: false,
      isLoading: false,
    });
    mockUseGetSteelReviewSourceQuery.mockReturnValue({
      data: sourceBlob,
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn(),
    });

    renderDialog(new QueryClient(), selection, createStore(), identity);

    expect(await screen.findByRole('img', { name: 'com_ui_steel_review_preview_canvas' })).toBeInTheDocument();
    const sourceSelectors = screen.getAllByRole('combobox');
    expect(sourceSelectors[0]).toHaveValue('drawing-a');
    expect(sourceSelectors[1]).toHaveValue('1');
    const initialReadonlyCells = screen.getAllByLabelText('零件編號: com_ui_steel_review_cell_readonly');
    expect(initialReadonlyCells[0]).toHaveTextContent('OCR-D3');
    expect(screen.queryByRole('button', { name: 'com_ui_edit ocr-row-1' })).not.toBeInTheDocument();
    const referenceTitle = screen.getByRole('heading', { name: /^ocr_result｜PL\.pdf/ });
    expect(referenceTitle).toHaveTextContent('com_ui_steel_review_readonly_badge');
    const systemTitle = screen.getByRole('heading', { name: 'system_order｜報價單' });
    expect(referenceTitle.compareDocumentPosition(systemTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const collapse = screen.getByRole('button', { name: 'com_ui_collapse' });
    expect(collapse).toHaveAttribute('title', 'com_ui_collapse');
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    const referenceContent = document.getElementById(collapse.getAttribute('aria-controls')!);
    expect(referenceContent).toBeVisible();
    fireEvent.click(collapse);
    expect(referenceContent).not.toBeVisible();
    expect(referenceTitle).toBeVisible();
    expect(systemTitle).toBeVisible();
    const expand = screen.getByRole('button', { name: 'com_ui_expand' });
    expect(expand).toHaveAttribute('title', 'com_ui_expand');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);
    expect(referenceContent).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_bound system-row-1' }));
    const linkDialog = screen.getAllByRole('dialog').at(-1);
    expect(linkDialog).toBeDefined();
    const linkSelectors = within(linkDialog!).getAllByRole('combobox');
    fireEvent.change(linkSelectors[0], { target: { value: 'drawing-b' } });
    fireEvent.change(linkSelectors[1], { target: { value: '2' } });
    fireEvent.click(within(linkDialog!).getByRole('button', { name: 'com_ui_confirm' }));

    await waitFor(() => {
      const nextSelectors = screen.getAllByRole('combobox');
      expect(nextSelectors[0]).toHaveValue('drawing-b');
      expect(nextSelectors[1]).toHaveValue('2');
      expect(screen.getAllByLabelText('零件編號: com_ui_steel_review_cell_readonly')[0]).toHaveTextContent('OCR-S3');
    });
    expect(document.body).not.toHaveTextContent('OCR-D3');
    const nextReadonlyCells = screen.getAllByLabelText('零件編號: com_ui_steel_review_cell_readonly');
    expect(nextReadonlyCells[0]).toHaveTextContent('OCR-S3');
    expect(screen.queryByRole('button', { name: 'com_ui_edit ocr-row-2' })).not.toBeInTheDocument();
  });

  it('inherits the active preview source when adding a material, and leaves it empty without one', async () => {
    const identity = {
      ...reviewIdentity,
      kind: 'system_order' as const,
      title: 'system_order',
    };
    const selection: SteelReviewSelection = { ...identity, captureId: 'capture-system-add-source' };
    const table = {
      ...identity,
      outputId: 'system_order:run-add-source',
      revision: 'revision-add-source',
      latestOutputId: 'system_order:run-add-source',
      isLatest: true,
      readOnly: false,
      headers: ['品名'],
      rows: [],
    };
    mockUseGetSteelReviewQuery.mockReturnValue({ data: { table }, error: null, isError: false, isLoading: false });
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: { sources: [{ fileId: 'preview-file', filename: 'preview.pdf', mediaType: 'application/pdf' }] },
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn(),
    });
    const rendered = renderDialog(new QueryClient(), selection, createStore(), identity);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_add_row' }));
    const draft = rendered.store.get(steelReviewDraftStateFamily(getSteelReviewDraftOwnerKey(identity, table, selection.captureId)));
    expect(Object.values(draft.rowStates)[0].source).toEqual(expect.objectContaining({ fileId: 'preview-file', pageNumber: 1 }));

    rendered.unmount();
    mockUseGetSteelReviewSourcesQuery.mockReturnValue({
      data: { sources: [] },
      error: null,
      isError: false,
      isLoading: false,
      refetch: jest.fn(),
    });
    const emptyRendered = renderDialog(new QueryClient(), { ...selection, captureId: 'capture-system-add-empty' }, createStore(), identity);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_steel_review_add_row' }));
    const emptyDraft = emptyRendered.store.get(steelReviewDraftStateFamily(getSteelReviewDraftOwnerKey(identity, table, 'capture-system-add-empty')));
    expect(Object.values(emptyDraft.rowStates)[0].source).toBeNull();
    emptyRendered.unmount();
  });

  it.each(['ocr_result', 'system_order'])(
    'keeps the %s entry available and offers retry inside the dialog on read failure', async (title) => {
      const refetch = jest.fn();
      mockUseGetSteelReviewQuery.mockReturnValue({
        data: undefined,
        error: { response: { status: 500 } },
        isError: true,
        isLoading: false,
        refetch,
      });

      renderTable(title);
      const open = await screen.findByRole('button', { name: 'com_ui_steel_review_open' });
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(open);
      expect(screen.getByRole('dialog')).toHaveTextContent('com_ui_steel_review_error');
      expect(screen.queryByRole('textbox')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['ocr_result', 'system_order'])(
    'disables %s review while generating and enables it when submission completes',
    async (title) => {
      const refetch = jest.fn();
      mockMessageContext = { ...mockMessageContext, isSubmitting: true };
      mockUseGetSteelReviewQuery.mockReturnValue({
        data: undefined,
        error: { response: { status: 404 } },
        isError: true,
        isLoading: false,
        refetch,
      });
      const rendered = renderTable(title);
      const open = await screen.findByRole('button', { name: 'com_ui_steel_review_open' });
      expect(open).toBeDisabled();
      expect(open.parentElement).toHaveAttribute('title', 'com_ui_generating');
      expect(open.parentElement).toHaveAttribute('tabindex', '0');
      fireEvent.click(open);
      expect(rendered.store.get(steelReviewSelectionAtom)).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'com_ui_expand_table' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'com_ui_copy_markdown_table' })).toBeEnabled();

      mockMessageContext = { ...mockMessageContext, isSubmitting: false };
      rendered.rerender(
        <QueryClientProvider client={rendered.queryClient}>
          <Provider store={rendered.store}>
            <RecoilRoot>
              <div className="message-render">
                <div className="message-content">
                  <h2>{title}</h2>
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
          </Provider>
        </QueryClientProvider>,
      );

      await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
      const completedOpen = screen.getByRole('button', { name: 'com_ui_steel_review_open' });
      expect(completedOpen).toBeEnabled();
      expect(completedOpen).toHaveAttribute('title', 'com_ui_steel_review_open');
      fireEvent.click(completedOpen);
      expect(rendered.store.get(steelReviewSelectionAtom)).toMatchObject({ title });
      expect(screen.getByRole('dialog')).toHaveTextContent('com_ui_steel_review_empty');
      rendered.unmount();
      mockMessageContext = { ...mockMessageContext, isSubmitting: false };
    },
  );

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
        <Provider store={rendered.store}>
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
        </Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    rendered.unmount();
  });

  it('keeps the entry available after the scoped backend read recognizes the table', async () => {
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
