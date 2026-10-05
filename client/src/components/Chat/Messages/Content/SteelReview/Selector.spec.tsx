import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { dataService, steelCatalogCandidateSchema, steelReviewTableSchema } from 'librechat-data-provider';
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
  label: `${code} Steel plate 400mm`, unitPrice: null,
  calculation: { erpItemCode: code, category: '鐵板', ruleVersion: 'steel-catalog-v1', exactPhysical: {} },
  ...Object.fromEntries(['subcategory', 'formulaCode', 'material', 'unit', 'unitWeightValue',
    'unitWeightBasis', 'density', 'thicknessMinMm', 'thicknessMaxMm', 'widthMm', 'heightMm',
    'lengthMm', 'outerDiameterMm', 'webMm', 'flangeMm', 'lipMm', 'sheetWidthMm', 'sheetLengthMm']
    .map((field) => [field, null])),
});
const page = (options: SteelCatalogPage['options'], hasMore = false): SteelCatalogPage => ({
  options, customer, complete: !hasMore, hasMore, nextCursor: hasMore ? 'next' : null,
});

function setup(header: '型號' | '品名規格' = '型號') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  });
  const onSelect = jest.fn();
  const result = render(<QueryClientProvider client={queryClient}>
    <SteelReviewSelector table={table} row={table.rows[0]} header={header}
      value="OLD" canEdit onSelect={onSelect} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('combobox', { name: `${header} material` }));
  return { ...result, queryClient, onSelect };
}

afterEach(() => jest.restoreAllMocks());

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

it('shows code and full specification labels and ignores an older query response', async () => {
  let finishOld: ((value: SteelCatalogPage) => void) | undefined;
  const api = jest.spyOn(dataService, 'getSteelReviewCatalog').mockImplementation(async (_conversationId, input) => {
    if (input.keyword === 'old') return new Promise<SteelCatalogPage>((resolve) => { finishOld = resolve; });
    return page(input.keyword ? [candidate('2', 'NEW-B'), candidate('1', 'NEW-A')] : []);
  });
  const { onSelect } = setup('品名規格');
  const search = await screen.findByPlaceholderText('Search catalog');
  fireEvent.change(search, { target: { value: 'old' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('conversation', expect.objectContaining({ keyword: 'old' })));
  fireEvent.change(search, { target: { value: 'new' } });
  await screen.findByRole('option', { name: 'NEW-B Steel plate 400mm' });
  expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
    'NEW-B Steel plate 400mm', 'NEW-A Steel plate 400mm',
  ]);
  await act(async () => finishOld?.(page([candidate('3', 'OLD-RESULT')])));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('option', { name: 'NEW-A Steel plate 400mm' }));
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
  await screen.findByText('No matching catalog items');
  fireEvent.change(search, { target: { value: 'single' } });
  await screen.findByRole('option', { name: 'ABC Steel plate 400mm' });
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
