import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dataService, steelCatalogCandidateSchema, steelReviewTableSchema } from 'librechat-data-provider';
import type { SteelCatalogPage, SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
import SteelReviewCatalog from './Catalog';

const customer = { snapshotId: 'snapshot', revision: 'customer-1', tier: 'B' as const };
const candidate = (id: string, code: string, category = '鐵板', subcategory: string | null = null) => steelCatalogCandidateSchema.parse({
  id, revision: 'a'.repeat(64), erpItemCode: code, productName: 'Steel plate',
  specKey: '400mm', category, costBasis: 'kg', valueState: 'confirmed',
  label: `${code} Steel plate`, unitPrice: '12',
  calculation: { erpItemCode: code, category, ruleVersion: 'steel-catalog-v1', exactPhysical: {} },
  ...Object.fromEntries(['subcategory', 'formulaCode', 'material', 'unit', 'unitWeightValue',
    'unitWeightBasis', 'density', 'thicknessMinMm', 'thicknessMaxMm', 'widthMm', 'heightMm',
    'lengthMm', 'outerDiameterMm', 'webMm', 'flangeMm', 'lipMm', 'sheetWidthMm', 'sheetLengthMm']
    .map((field) => [field, null])),
  subcategory,
});

const catalogTriggerLabel = 'Open catalog';
const processingTriggerLabel = 'Open processing catalog';

const table = steelReviewTableSchema.parse({
  conversationId: 'conversation', messageId: 'message', title: 'system_order',
  kind: 'system_order', outputId: 'system_order:run', revision: 'review-1',
  latestOutputId: 'system_order:run', isLatest: true, readOnly: false,
  headers: ['型號', '品名規格', '類別', '來源'], rows: [{
    rowId: 'material', source: null, system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
    values: {
      型號: { baseline: 'OLD', effective: 'OLD' }, 品名規格: { baseline: 'Old plate', effective: 'Old plate' },
      類別: { baseline: '鐵板', effective: '鐵板' }, 來源: { baseline: 'drawing.pdf', effective: 'drawing.pdf' },
    },
  }],
});
const page = (options: SteelCatalogPage['options'], hasMore = false): SteelCatalogPage => ({
  options, customer, complete: !hasMore, hasMore, nextCursor: hasMore ? 'next' : null,
});

function renderCatalog(
  row: SteelReviewRow = table.rows[0],
  currentTable: SteelReviewTable = table,
  onSelect = jest.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  });
  const result = render(<QueryClientProvider client={queryClient}>
    <SteelReviewCatalog table={currentTable} row={row} header="型號" value="OLD" canEdit
      trigger={<button type="button">{catalogTriggerLabel}</button>} onSelect={onSelect} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open catalog' }));
  return { ...result, queryClient, onSelect };
}

afterEach(() => jest.restoreAllMocks());

it('previews only the selected row columns and applies once on confirm', async () => {
  const selected = candidate('1', 'ABC');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [selected] : []));
  const { onSelect } = renderCatalog();
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  await screen.findByRole('table', { name: 'Steel review table' });

  expect(screen.getByRole('rowheader', { name: '型號' })).toBeInTheDocument();
  expect(screen.getByRole('rowheader', { name: '品名規格' })).toBeInTheDocument();
  expect(screen.getByRole('rowheader', { name: '類別' })).toBeInTheDocument();
  expect(screen.queryByRole('rowheader', { name: '來源' })).toBeNull();
  expect(screen.getByRole('table', { name: 'Steel review table' })).toHaveTextContent('ABC');
  expect(screen.getByRole('table', { name: 'Steel review table' })).toHaveTextContent('Steel plate');
  expect(onSelect).not.toHaveBeenCalled();
  expect(table.rows[0].values['型號']?.effective).toBe('OLD');

  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith(table.rows[0], selected, customer);
});

it('discards staged selections on Cancel and Close', async () => {
  const selected = candidate('1', 'ABC');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [selected] : []));
  const { onSelect } = renderCatalog();
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'ABC' } });
  await screen.findByRole('table', { name: 'Steel review table' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open catalog' }));
  expect(screen.queryByRole('table', { name: 'Steel review table' })).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('table', { name: 'Steel review table' })).toBeInTheDocument();
  expect(api).toHaveBeenLastCalledWith('conversation', expect.objectContaining({ cursor: 'next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
});

it('closes and discards the dialog when its edit scope changes', async () => {
  const selected = candidate('1', 'ABC');
  jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) =>
    page(input.keyword ? [selected] : []));
  const onSelect = jest.fn();
  const { rerender } = renderCatalog(table.rows[0], table, onSelect);
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'ABC' } });
  await screen.findByRole('table', { name: 'Steel review table' });
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
  await screen.findByRole('option', { name: selected.label });
  fireEvent.click(screen.getByRole('option', { name: selected.label }));
  await screen.findByRole('table', { name: 'Steel review table' });
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
  fireEvent.change(await screen.findByPlaceholderText('Search catalog'), { target: { value: 'CUT' } });
  await screen.findByRole('table', { name: 'Steel review table' });
  expect(screen.queryByRole('rowheader', { name: '總數' })).toBeNull();
  expect(screen.getByRole('table', { name: 'Steel review table' })).toHaveTextContent('加工/孔');
});
