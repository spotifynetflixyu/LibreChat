import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { dataService, steelCatalogCandidateSchema, steelReviewTableSchema } from 'librechat-data-provider';
import type { SteelCatalogPage, SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
import SteelReviewCatalog from './Catalog';

const customer = { snapshotId: 'snapshot', revision: 'customer-1', tier: 'B' as const };
type CandidateOverrides = Partial<{
  productName: string;
  specKey: string;
  material: string;
  formulaCode: string;
  unit: string;
  unitPrice: string;
}>;

const candidate = (
  id: string,
  code: string,
  category = '鐵板',
  subcategory: string | null = null,
  overrides: CandidateOverrides = {},
) => steelCatalogCandidateSchema.parse({
  id, revision: 'a'.repeat(64), erpItemCode: code,
  productName: overrides.productName ?? 'Steel plate', specKey: overrides.specKey ?? '400mm',
  category, costBasis: 'kg', valueState: 'confirmed',
  label: `${code} ${overrides.productName ?? 'Steel plate'}`,
  unitPrice: overrides.unitPrice ?? '12',
  calculation: {
    erpItemCode: code, category, ruleVersion: 'steel-catalog-v1', unitWeightBasis: 'kg_per_piece_or_stock_length',
    exactPhysical: { density: '7.85', widthMm: '999', lengthMm: '888', unitWeightValue: '666' },
  },
  subcategory, formulaCode: overrides.formulaCode ?? 'FORMULA-1', material: overrides.material ?? 'MAT-1',
  unit: overrides.unit ?? 'kg', unitWeightValue: '666', unitWeightBasis: 'kg_per_piece_or_stock_length',
  density: '7.85', thicknessMinMm: '4', thicknessMaxMm: '4', widthMm: '999', heightMm: '777',
  lengthMm: '888', outerDiameterMm: '555', webMm: '444', flangeMm: '333', lipMm: '222',
  sheetWidthMm: '111', sheetLengthMm: '110',
});

const catalogTriggerLabel = 'Open catalog';
const processingTriggerLabel = 'Open processing catalog';
const systemOrderHeaders = [
  '型號', '品名規格', '材質編號', '單價', '數量', '總數', '厚度', '寬度', '長度',
  '肚', '單位', '類別', '單重', '計價基準', '公式編號', '備註', '來源',
];
const catalogPreviewHeaders = [
  '型號', '品名規格', '材質編號', '單價', '厚度', '單位', '類別', '計價基準', '公式編號',
];
const originalSystemOrderValues: Record<string, string> = {
  型號: 'OLD', 品名規格: 'Old plate', 類別: '鐵板', 來源: 'drawing.pdf',
};
const systemOrderValues = Object.fromEntries(systemOrderHeaders.map((header) => {
  const value = originalSystemOrderValues[header] ?? `old-${header}`;
  return [header, { baseline: value, effective: value }];
}));

const table = steelReviewTableSchema.parse({
  conversationId: 'conversation', messageId: 'message', title: 'system_order',
  kind: 'system_order', outputId: 'system_order:run', revision: 'review-1',
  latestOutputId: 'system_order:run', isLatest: true, readOnly: false,
  headers: systemOrderHeaders, rows: [{
    rowId: 'material', source: null, system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
    values: systemOrderValues,
  }],
});
const page = (options: SteelCatalogPage['options'], hasMore = false): SteelCatalogPage => ({
  options, customer, complete: !hasMore, hasMore, nextCursor: hasMore ? 'next' : null,
});

function renderCatalog(
  row: SteelReviewRow = table.rows[0],
  currentTable: SteelReviewTable = table,
  onSelect = jest.fn(),
  header: '型號' | '品名規格' = '型號',
  triggerLabel = catalogTriggerLabel,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  });
  const result = render(<QueryClientProvider client={queryClient}>
    <SteelReviewCatalog table={currentTable} row={row} header={header} value={row.values[header]?.effective ?? ''} canEdit
      trigger={<button type="button">{triggerLabel}</button>} onSelect={onSelect} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: triggerLabel }));
  return { ...result, queryClient, onSelect };
}

afterEach(() => jest.restoreAllMocks());

it.each(['型號', '品名規格'] as const)('allows confirming the current %s option selected again', async (header) => {
  const selected = candidate('1', 'ABC');
  const other = candidate('2', 'ABC-B');
  const row = { ...table.rows[0], values: { ...table.rows[0].values, 型號: { baseline: 'ABC', effective: 'ABC' } } };
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockResolvedValue(page([selected, other]));
  const { onSelect } = renderCatalog(row, table, jest.fn(), header);
  fireEvent.click(screen.getByRole('combobox', { name: `${header} material` }));
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'AB' } });
  const option = await screen.findByRole('option', { name: selected.label });
  expect(option).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(option);
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith(row, selected, customer);
});

it.each(['型號', '品名規格'] as const)('caches %s options until the catalog dialog closes', async (header) => {
  const options = [candidate('1', 'ABC-A'), candidate('2', 'ABC-B')];
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockResolvedValue(page(options));
  const { queryClient, onSelect } = renderCatalog(table.rows[0], table, jest.fn(), header);
  const selector = screen.getByRole('combobox', { name: `${header} material` });
  fireEvent.click(selector);
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  await screen.findByRole('option', { name: options[0].label });
  expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenLastCalledWith('conversation', expect.objectContaining({
    keyword: 'ABC',
  }), expect.any(AbortSignal));
  fireEvent.click(selector);
  await waitFor(() => expect(screen.getByPlaceholderText('Search catalog')).not.toBeVisible());
  fireEvent.click(selector);
  await screen.findByRole('option', { name: options[0].label });
  fireEvent.change(screen.getByPlaceholderText('Search catalog'), {
    target: { value: table.rows[0].values[header]?.effective },
  });
  expect(screen.getByPlaceholderText('Search catalog')).toHaveValue(table.rows[0].values[header]?.effective);
  expect(screen.getByRole('option', { name: options[1].label })).toBeVisible();
  fireEvent.click(selector);
  await waitFor(() => expect(screen.getByPlaceholderText('Search catalog')).not.toBeVisible());
  fireEvent.click(selector);
  expect(await screen.findByPlaceholderText('Search catalog')).toHaveValue(table.rows[0].values[header]?.effective);
  await screen.findByRole('option', { name: options[1].label });
  expect(api).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryCache().getAll().filter((query) => query.state.data)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0));
  fireEvent.click(screen.getByRole('button', { name: catalogTriggerLabel }));
  fireEvent.click(screen.getByRole('combobox', { name: `${header} material` }));
  expect(await screen.findByPlaceholderText('Search catalog')).toHaveValue('');
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  await screen.findByRole('option', { name: options[0].label });
  expect(api).toHaveBeenCalledTimes(2);
  expect(onSelect).not.toHaveBeenCalled();
});

it.each([
  { header: '型號' as const, field: 'model' as const, keyword: 'ABC', triggerLabel: catalogTriggerLabel },
  { header: '品名規格' as const, field: 'description' as const, keyword: 'plate', triggerLabel: 'Open description catalog' },
])('previews the nine catalog columns for $header and $field and applies once on confirm', async ({ header, field, keyword, triggerLabel }) => {
  const selected = {
    ...candidate('1', 'ABC', '鐵板', null, { productName: 'Steel plate description', unitPrice: '12.340000' }),
    thicknessMinMm: '15.000000',
    thicknessMaxMm: '15.000000',
  };
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [selected] : []));
  const { onSelect } = renderCatalog(table.rows[0], table, jest.fn(), header, triggerLabel);
  expect(screen.getByRole('dialog', { name: header })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  const preview = screen.getByRole('table', { name: 'Steel review table' });
  for (const previewHeader of catalogPreviewHeaders) {
    const previewCell = within(preview).getByRole('rowheader', { name: previewHeader }).parentElement;
    expect(previewCell).toHaveTextContent(table.rows[0].values[previewHeader].effective ?? '');
  }
  expect(api).not.toHaveBeenCalled();
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: keyword } });
  await waitFor(() => expect(api).toHaveBeenLastCalledWith('conversation', expect.objectContaining({ field, keyword }), expect.any(AbortSignal)));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());

  expect(within(preview).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(catalogPreviewHeaders);
  expect(within(preview).getByRole('rowheader', { name: '型號' })).toBeInTheDocument();
  expect(within(preview).getByRole('rowheader', { name: '品名規格' })).toBeInTheDocument();
  expect(within(preview).getByRole('rowheader', { name: '類別' })).toBeInTheDocument();
  for (const protectedHeader of ['寬度', '長度', '肚', '單重', '數量', '總數', '備註', '來源']) {
    expect(within(preview).queryByRole('rowheader', { name: protectedHeader })).toBeNull();
  }
  for (const protectedValue of ['999', '888', '777', '666']) {
    expect(preview).not.toHaveTextContent(protectedValue);
  }
  expect(preview).toHaveTextContent('ABC');
  expect(preview).toHaveTextContent('Steel plate description');
  expect(within(preview).getByRole('rowheader', { name: '厚度' }).parentElement).toHaveTextContent('15');
  expect(within(preview).getByRole('rowheader', { name: '單價' }).parentElement).toHaveTextContent('12.34');
  expect(preview).not.toHaveTextContent('.000000');
  expect(onSelect).not.toHaveBeenCalled();
  expect(table.rows[0].values['型號']?.effective).toBe('OLD');

  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith(table.rows[0], selected, customer);
});

it('discards staged selections on Cancel', async () => {
  const selected = candidate('1', 'ABC');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [selected] : []));
  const { onSelect } = renderCatalog();
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open catalog' }));
  expect(screen.getByRole('table', { name: 'Steel review table' })).toHaveTextContent('OLD');
  expect(screen.getByRole('table', { name: 'Steel review table' })).not.toHaveTextContent('ABC');
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps the staged preview available when a later page fails', async () => {
  const first = candidate('1', 'ABC-A');
  const second = candidate('2', 'ABC-B');
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) => {
    if (input.cursor) throw new Error('private provider diagnostic');
    return page(input.keyword ? [first, second] : [] , Boolean(input.keyword));
  });
  const { onSelect } = renderCatalog();
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await screen.findByRole('option', { name: first.label });
  fireEvent.click(screen.getByRole('option', { name: first.label }));
  await screen.findByRole('table', { name: 'Steel review table' });
  fireEvent.click(screen.getByRole('combobox', { name: '型號 material' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('table', { name: 'Steel review table' })).toBeInTheDocument();
  expect(api).toHaveBeenLastCalledWith('conversation', expect.objectContaining({ cursor: 'next' }), expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
});

it.each(['型號', '品名規格'] as const)('retains the selected option and preview after reopening %s without choosing again', async (header) => {
  const selected = candidate('1', 'ABC-A');
  const other = candidate('2', 'ABC-B');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async () => page([selected, other]));
  const { onSelect } = renderCatalog(table.rows[0], table, jest.fn(), header);
  const selector = screen.getByRole('combobox', { name: `${header} material` });
  fireEvent.click(selector);
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  fireEvent.click(await screen.findByRole('option', { name: selected.label }));
  await waitFor(() => expect(screen.getByPlaceholderText('Search catalog')).not.toBeVisible());
  const preview = screen.getByRole('table', { name: 'Steel review table' });
  expect(preview).toHaveTextContent('ABC-A');
  fireEvent.click(selector);
  expect(await screen.findByRole('option', { name: selected.label })).toHaveAttribute('aria-selected', 'true');
  expect(preview).toHaveTextContent('ABC-A');
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  fireEvent.click(selector);
  await waitFor(() => expect(screen.getByPlaceholderText('Search catalog')).not.toBeVisible());
  expect(preview).toHaveTextContent('ABC-A');
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(onSelect).toHaveBeenCalledWith(table.rows[0], selected, customer);
});

it('keeps the selected values visible during a new search, empty results and failure', async () => {
  const selected = candidate('1', 'ABC');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) => {
    if (input.keyword === 'bad') throw new Error('private provider diagnostic');
    return page(input.keyword === 'ABC' ? [selected] : []);
  });
  const { onSelect } = renderCatalog();
  const preview = screen.getByRole('table', { name: 'Steel review table' });
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await waitFor(() => expect(preview).toHaveTextContent('ABC'));
  fireEvent.change(search, { target: { value: 'missing' } });
  expect(preview).toHaveTextContent('ABC');
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  await screen.findByText('No matching catalog items');
  expect(preview).toHaveTextContent('ABC');
  fireEvent.change(search, { target: { value: 'bad' } });
  await screen.findByRole('alert');
  expect(preview).toHaveTextContent('ABC');
  expect(screen.queryByText('private provider diagnostic')).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(onSelect).toHaveBeenCalledWith(table.rows[0], selected, customer);
});

it('closes and discards the dialog when its edit scope changes', async () => {
  const selected = candidate('1', 'ABC');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [selected] : []));
  const onSelect = jest.fn();
  const { rerender } = renderCatalog(table.rows[0], table, onSelect);
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } })}>
    <SteelReviewCatalog table={{ ...table, revision: 'review-2' }} row={table.rows[0]} header="型號" value="OLD" canEdit
      trigger={<button type="button">{catalogTriggerLabel}</button>} onSelect={onSelect} />
  </QueryClientProvider>);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onSelect).not.toHaveBeenCalled();
});

it('keeps the dialog open when the staged row becomes invalid before confirm', async () => {
  const selected = candidate('1', 'ABC');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [selected] : []));
  const onSelect = jest.fn();
  const { rerender, queryClient } = renderCatalog(table.rows[0], table, onSelect);
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  rerender(<QueryClientProvider client={queryClient}>
    <SteelReviewCatalog table={table} row={{ ...table.rows[0], deleted: true }} header="型號" value="OLD" canEdit
      trigger={<button type="button">{catalogTriggerLabel}</button>} onSelect={onSelect} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: '型號' })).toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();
});

it('previews a processing candidate against the processing row columns', async () => {
  const material = { ...table.rows[0], values: {
    ...table.rows[0].values, 類別: { baseline: '鐵板', effective: '鐵板' }, 厚度: { baseline: '4', effective: '4' },
  } };
  const processing = { ...table.rows[0], rowId: 'processing', system: {
    kind: 'processing' as const, parentRowId: material.rowId, cascadeDeletedBy: null,
  } };
  const processingTable = { ...table, headers: ['型號', '品名規格', '類別', '總數'], rows: [processing] };
  const selected = candidate('1', 'CUT', '加工/孔', '通用');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [selected] : []));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } })}>
    <SteelReviewCatalog table={processingTable} row={processing} parent={material} header="型號" value="OLD" canEdit
      trigger={<button type="button">{processingTriggerLabel}</button>} onSelect={jest.fn()} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open processing catalog' }));
  expect(screen.getByRole('table', { name: 'Steel review table' })).toHaveTextContent('Old plate');
  expect(screen.queryByRole('rowheader', { name: '總數' })).toBeNull();
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'CUT' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  expect(screen.queryByRole('rowheader', { name: '總數' })).toBeNull();
  expect(screen.getByRole('table', { name: 'Steel review table' })).toHaveTextContent('加工/孔');
});
