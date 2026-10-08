import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import {
  dataService,
  DynamicQueryKeys,
  steelCatalogCandidateSchema,
  steelReviewTableSchema,
} from 'librechat-data-provider';
import type { SteelCatalogPage } from 'librechat-data-provider';
import SteelReviewSelector from './Selector';

const table = steelReviewTableSchema.parse({
  conversationId: 'conversation', messageId: 'message', title: 'system_order',
  kind: 'system_order', outputId: 'system_order:run', revision: 'review-1',
  latestOutputId: 'system_order:run', isLatest: true, readOnly: false,
  headers: ['型號', '品名規格'], rows: [{
    rowId: 'material', source: null, system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
    values: { 型號: { baseline: 'OLD', effective: 'OLD' }, 品名規格: { baseline: 'Old plate', effective: 'Old plate' } },
  }],
});
const customer = { snapshotId: 'snapshot', revision: 'customer-1', tier: 'B' as const };
const candidate = (id: string, code: string) => steelCatalogCandidateSchema.parse({
  id, revision: 'a'.repeat(64), erpItemCode: code, productName: 'Steel plate',
  specKey: '400mm', category: '鐵板', costBasis: 'kg', valueState: 'confirmed',
  label: `${code} Steel plate`, unitPrice: null,
  calculation: { erpItemCode: code, category: '鐵板', ruleVersion: 'steel-catalog-v1', exactPhysical: {} },
  ...Object.fromEntries(['subcategory', 'formulaCode', 'material', 'unit', 'unitWeightValue',
    'unitWeightBasis', 'density', 'thicknessMinMm', 'thicknessMaxMm', 'widthMm', 'heightMm',
    'lengthMm', 'outerDiameterMm', 'webMm', 'flangeMm', 'lipMm', 'sheetWidthMm', 'sheetLengthMm']
    .map((field) => [field, null])),
});
const page = (options: SteelCatalogPage['options'], hasMore = false): SteelCatalogPage => ({
  options, customer, complete: !hasMore, hasMore, nextCursor: hasMore ? 'next' : null,
});

function setup(header: '型號' | '品名規格' = '型號', onIntentChange?: () => void, catalogCustomer?: SteelCatalogPage['customer']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  });
  const onSelect = jest.fn();
  const result = render(<QueryClientProvider client={queryClient}>
    <SteelReviewSelector table={{ ...table, ...(catalogCustomer ? { catalogCustomer } : {}) }} row={table.rows[0]} header={header}
      value={table.rows[0].values[header]?.effective ?? ''} canEdit onIntentChange={onIntentChange} onSelect={onSelect} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('combobox', { name: `${header} material` }));
  return { ...result, queryClient, onSelect };
}

afterEach(() => jest.restoreAllMocks());

it.each(['型號', '品名規格'] as const)('keeps the %s menu open while loading and after appending the last page', async (header) => {
  let finish: ((result: SteelCatalogPage) => void) | undefined;
  const first = candidate('1', 'ABC-A');
  const second = candidate('2', 'ABC-B');
  const next = candidate('3', 'ABC-C');
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) => {
    if (input.cursor) return new Promise<SteelCatalogPage>((resolve) => { finish = resolve; });
    return page([first, second], true);
  });
  const { onSelect } = setup(header);
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'AB' } });
  const loadMore = await screen.findByRole('button', { name: 'Load more' });
  loadMore.focus();
  fireEvent.click(loadMore);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(search).toHaveFocus();
  expect(search).toBeVisible();
  expect(loadMore).toBeDisabled();
  await act(async () => finish?.(page([next])));
  expect(await screen.findByRole('option', { name: next.label })).toBeVisible();
  expect(screen.getByRole('option', { name: first.label })).toBeVisible();
  expect(search).toBeVisible();
  expect(search).toHaveFocus();
  expect(onSelect).not.toHaveBeenCalled();
});

it('sends the loaded customer price tier and evidence without another customer lookup', async () => {
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockResolvedValue(page([]));
  setup('型號', undefined, customer);
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'dnb' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('conversation', expect.objectContaining({
    keyword: 'dnb', customerTier: 'B', customerSnapshotId: 'snapshot', customerRevision: 'customer-1',
  }), expect.any(AbortSignal)));
});

it.each(['型號', '品名規格'] as const)('opens %s with an empty search without querying', async (header) => {
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockResolvedValue(page([]));
  const { onSelect } = setup(header);
  expect(await screen.findByPlaceholderText('Search catalog')).toHaveValue('');
  expect(api).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});

it.each(['', '   '])('skips blank searches (%j)', async (value) => {
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockResolvedValue(page([]));
  const { onSelect } = setup();
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value } });
  expect(api).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.change(search, { target: { value: 'ABC' } });
  await screen.findByText('No matching catalog items');
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.change(search, { target: { value } });
  expect(search).toHaveValue(value);
  expect(api).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
});

it('keeps cached options when the search matches the current field value', async () => {
  const options = [candidate('1', 'ABC-A'), candidate('2', 'ABC-B')];
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword === 'ABC' ? options : []));
  const { onSelect, queryClient } = setup();
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await screen.findByRole('option', { name: options[0].label });
  const calls = api.mock.calls.length;
  fireEvent.change(search, { target: { value: 'OLD' } });
  expect(search).toHaveValue('OLD');
  expect(screen.getByRole('option', { name: options[0].label })).toBeVisible();
  expect(screen.getByRole('option', { name: options[1].label })).toBeVisible();
  expect(queryClient.getQueryCache().getAll().filter((query) => query.state.data)).toHaveLength(1);
  expect(api).toHaveBeenCalledTimes(calls);
  expect(onSelect).not.toHaveBeenCalled();
});

it.each(['型號', '品名規格'] as const)('debounces %s rapid typing to the final keyword', async (header) => {
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockResolvedValue(page([]));
  setup(header);
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'd' } });
  fireEvent.change(search, { target: { value: 'dn' } });
  fireEvent.change(search, { target: { value: 'dnb' } });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenCalledWith(
    'conversation',
    expect.objectContaining({ field: header === '型號' ? 'model' : 'description', keyword: 'dnb' }),
    expect.any(AbortSignal),
  );
});

it.each(['', 'OLD'])('cancels a pending result while keeping the search manual for %j', async (value) => {
  let finish: ((result: SteelCatalogPage) => void) | undefined;
  let signal: AbortSignal | undefined;
  const option = candidate('1', 'ABC');
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation((_conversationId, _input, requestSignal?: AbortSignal) =>
    new Promise<SteelCatalogPage>((resolve) => {
      finish = resolve;
      signal = requestSignal;
    }));
  const { onSelect, queryClient } = setup();
  const cancelQueries = jest.spyOn(queryClient, 'cancelQueries');
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  fireEvent.change(search, { target: { value } });
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(cancelQueries).toHaveBeenCalledWith(
    DynamicQueryKeys.steelReviewCatalog('conversation', api.mock.calls[0][1]),
    { exact: true },
  );
  await act(async () => finish?.(page([option])));
  expect(search).toHaveValue(value);
  expect(api).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole('option', { name: option.label })).toBeNull();
});

it('applies a complete single missing-tier-price option once, only after typing', async () => {
  const option = candidate('9007199254740993', 'ABC');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [option] : []));
  const { onSelect, queryClient } = setup();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(table.rows[0], option, customer));
  await act(async () => { await queryClient.invalidateQueries(); });
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect.mock.calls[0][1].unitPrice).toBeNull();
});

it('notifies the catalog host when the search intent changes', async () => {
  const onIntentChange = jest.fn();
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async () => page([]));
  setup('型號', onIntentChange);
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  await waitFor(() => expect(onIntentChange).toHaveBeenCalledTimes(1));
});

it('shows code and full specification labels and ignores an older query response', async () => {
  let finishOld: ((value: SteelCatalogPage) => void) | undefined;
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) => {
    if (input.keyword === 'old') return new Promise<SteelCatalogPage>((resolve) => { finishOld = resolve; });
    return page(input.keyword ? [candidate('2', 'NEW-B'), candidate('1', 'NEW-A')] : []);
  });
  const { onSelect } = setup('品名規格');
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'old' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('conversation', expect.objectContaining({ keyword: 'old' }), expect.any(AbortSignal)));
  fireEvent.change(search, { target: { value: 'new' } });
  await screen.findByRole('option', { name: 'NEW-B Steel plate' });
  expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
    'NEW-B Steel plate', 'NEW-A Steel plate',
  ]);
  await act(async () => finishOld?.(page([candidate('3', 'OLD-RESULT')])));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('option', { name: 'NEW-A Steel plate' }));
  expect(onSelect).toHaveBeenCalledWith(table.rows[0], candidate('1', 'NEW-A'), customer);
});

it('keeps an incomplete single page manual and exposes empty, failure and retry states', async () => {
  let failed = true;
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) => {
    if (input.keyword === 'bad' && failed) throw new Error('private provider diagnostic');
    if (input.keyword === 'single') return page([candidate('1', 'ABC')], true);
    return page([]);
  });
  const { onSelect } = setup();
  const search = await screen.findByPlaceholderText('Search catalog');
  expect(screen.queryByText('No matching catalog items')).toBeNull();
  fireEvent.change(search, { target: { value: 'single' } });
  await screen.findByRole('option', { name: 'ABC Steel plate' });
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
  fireEvent.change(search, { target: { value: 'bad' } });
  await screen.findByRole('alert');
  expect(screen.queryByText('private provider diagnostic')).toBeNull();
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('No matching catalog items');
  expect(onSelect).not.toHaveBeenCalled();
});


it('retains the latest keyword and options on reopen and keyboard navigation without querying again', async () => {
  const options = [candidate('1', 'ABC-A'), candidate('2', 'ABC-B')];
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async () => page(options));
  const { onSelect, queryClient } = setup();
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('conversation', expect.objectContaining({ keyword: 'ABC' }), expect.any(AbortSignal)));
  await screen.findByRole('option', { name: options[0].label });
  fireEvent.click(screen.getByRole('option', { name: options[0].label }));
  await waitFor(() => expect(screen.getByPlaceholderText('Search catalog')).not.toBeVisible());
  const calls = api.mock.calls.length;
  fireEvent.click(screen.getByRole('combobox', { name: '型號 material' }));
  const reopened = await screen.findByPlaceholderText('Search catalog');
  expect(reopened).toHaveValue('ABC');
  await screen.findByRole('option', { name: options[1].label });
  fireEvent.keyDown(reopened, { key: 'ArrowDown' });
  await waitFor(() => expect(onSelect.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByPlaceholderText('Search catalog')).toBeVisible();
  await act(async () => { await queryClient.invalidateQueries(); });
  expect(api).toHaveBeenCalledTimes(calls);
});

it('keeps option data for only the active row and resets the previous row on a new row query', async () => {
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async () =>
    page([candidate('1', 'ABC-A'), candidate('2', 'ABC-B')]));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } });
  const other = { ...table.rows[0], rowId: 'other-material' };
  render(<QueryClientProvider client={queryClient}>
    {[table.rows[0], other].map((row) => <SteelReviewSelector key={row.rowId}
      table={table} row={row} header="型號" value="OLD" canEdit onSelect={() => undefined} />)}
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('combobox', { name: '型號 material' }));
  const search = await screen.findByRole('combobox', { name: '' });
  fireEvent.change(search, { target: { value: 'ABC' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('conversation', expect.objectContaining({ rowId: 'material', keyword: 'ABC' }), expect.any(AbortSignal)));
  fireEvent.keyDown(search, { key: 'Escape' });
  const calls = api.mock.calls.length;
  fireEvent.focus(screen.getByRole('combobox', { name: '型號 other-material' }));
  expect(api).toHaveBeenCalledTimes(calls);
  expect(queryClient.getQueryCache().getAll().filter((query) => query.state.data)).toHaveLength(1);
  fireEvent.click(screen.getByRole('combobox', { name: '型號 other-material' }));
  fireEvent.change(await screen.findByRole('combobox', { name: '' }), { target: { value: 'DEF' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('conversation', expect.objectContaining({ rowId: 'other-material', keyword: 'DEF' }), expect.any(AbortSignal)));
  await waitFor(() => expect(queryClient.getQueryCache().getAll().filter((query) => query.state.data)).toHaveLength(1));
});

it('aborts and resets a pending selector when another row claims the catalog scope', async () => {
  const finishers = new Map<string, (result: SteelCatalogPage) => void>();
  const signals = new Map<string, AbortSignal | undefined>();
  const option = candidate('1', 'ABC');
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation((_conversationId, input, signal?: AbortSignal) =>
    new Promise<SteelCatalogPage>((resolve) => {
      finishers.set(input.rowId, resolve);
      signals.set(input.rowId, signal);
    }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } });
  const cancelQueries = jest.spyOn(queryClient, 'cancelQueries');
  const onSelect = jest.fn();
  const other = { ...table.rows[0], rowId: 'other-material' };
  render(<QueryClientProvider client={queryClient}>
    {[table.rows[0], other].map((row) => <SteelReviewSelector key={row.rowId}
      table={table} row={row} header="型號" value="OLD" canEdit onSelect={onSelect} />)}
  </QueryClientProvider>);

  fireEvent.click(screen.getByRole('combobox', { name: '型號 material' }));
  const searches = await screen.findAllByRole('combobox', { name: '' });
  fireEvent.change(searches[0], { target: { value: 'ABC' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith(
    'conversation', expect.objectContaining({ rowId: 'material', keyword: 'ABC' }), expect.any(AbortSignal),
  ));

  fireEvent.click(screen.getByRole('combobox', { name: '型號 other-material' }));
  const openSearches = await screen.findAllByRole('combobox', { name: '' });
  fireEvent.change(openSearches[openSearches.length - 1], { target: { value: 'DEF' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith(
    'conversation', expect.objectContaining({ rowId: 'other-material', keyword: 'DEF' }), expect.any(AbortSignal),
  ));
  await waitFor(() => expect(signals.get('material')?.aborted).toBe(true));
  expect(cancelQueries).toHaveBeenCalledWith(
    DynamicQueryKeys.steelReviewCatalog('conversation', api.mock.calls[0][1]),
    { exact: true },
  );

  expect(screen.getByRole('combobox', { name: '型號 material' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByDisplayValue('ABC')).toBeNull();
  expect(screen.queryByRole('option', { name: option.label })).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(2);

  await act(async () => {
    finishers.get('material')?.(page([option]));
    finishers.get('other-material')?.(page([]));
  });
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: '型號 material' })).toHaveAttribute('aria-expanded', 'false');
});

it('cancels the exact catalog query when the selector closes', async () => {
  let signal: AbortSignal | undefined;
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation((_conversationId, _input, requestSignal?: AbortSignal) =>
    new Promise<SteelCatalogPage>(() => { signal = requestSignal; }));
  const { queryClient } = setup();
  const cancelQueries = jest.spyOn(queryClient, 'cancelQueries');
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(search, { key: 'Escape' });
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(cancelQueries).toHaveBeenCalledWith(
    DynamicQueryKeys.steelReviewCatalog('conversation', api.mock.calls[0][1]),
    { exact: true },
  );
});

it('cancels the exact catalog query when the selector unmounts', async () => {
  let signal: AbortSignal | undefined;
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation((_conversationId, _input, requestSignal?: AbortSignal) =>
    new Promise<SteelCatalogPage>(() => { signal = requestSignal; }));
  const { queryClient, unmount } = setup();
  const cancelQueries = jest.spyOn(queryClient, 'cancelQueries');
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  unmount();
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(cancelQueries).toHaveBeenCalledWith(
    DynamicQueryKeys.steelReviewCatalog('conversation', api.mock.calls[0][1]),
    { exact: true },
  );
});

it('retains processing options without querying on a material edit and captures the new material on keyword input', async () => {
  const plate = { ...candidate('hole', 'HOLE'), category: '加工/孔', subcategory: '鐵板' };
  const weld = { ...candidate('weld', 'WELD'), category: '加工/焊接', subcategory: '通用' };
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword === 'next' ? [weld] : [plate, weld]));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } });
  const onSelect = jest.fn();
  const parent = { ...table.rows[0], values: { ...table.rows[0].values,
    類別: { baseline: '鐵板', effective: '鐵板' }, 厚度: { baseline: '4', effective: '4' } } };
  const processing = { ...table.rows[0], rowId: 'processing',
    system: { kind: 'processing' as const, parentRowId: parent.rowId, cascadeDeletedBy: null } };
  const content = (material: typeof parent) => <QueryClientProvider client={queryClient}>
    <SteelReviewSelector table={table} row={processing} parent={material} header="型號"
      value="OLD" canEdit onSelect={onSelect} />
  </QueryClientProvider>;
  const { rerender } = render(content(parent));
  fireEvent.click(screen.getByRole('combobox', { name: '型號 processing' }));
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'catalog' } });
  await screen.findByRole('option', { name: plate.label });
  expect(api).toHaveBeenLastCalledWith('conversation', expect.objectContaining({
    kind: 'processing', parentRowId: 'material', materialCategory: '鐵板', materialThicknessMm: '4', keyword: 'catalog',
  }), expect.any(AbortSignal));
  const calls = api.mock.calls.length;
  rerender(content({ ...parent, values: { ...parent.values, 類別: { baseline: '鐵板', effective: 'C型鋼' } } }));
  await waitFor(() => expect(screen.queryByRole('option', { name: plate.label })).toBeNull());
  expect(screen.getByRole('option', { name: weld.label })).toBeVisible();
  expect(api).toHaveBeenCalledTimes(calls);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: 'next' } });
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(processing, weld, customer));
  expect(api).toHaveBeenLastCalledWith('conversation', expect.objectContaining({ materialCategory: 'C型鋼', keyword: 'next' }), expect.any(AbortSignal));
});
