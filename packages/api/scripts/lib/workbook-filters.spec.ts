interface FilterTable {
  style?: string;
  showFilterButton: boolean;
  delete: jest.Mock<void, []>;
}

interface FilterSheet {
  tables: {
    items: FilterTable[];
    add: jest.Mock<FilterTable, [string, boolean, string]>;
  };
}

interface WorkbookFiltersModule {
  enableCuttingHeaderFilters: (
    sheet: FilterSheet,
    used: { address: string },
    sheetName: string,
  ) => void;
}

const { enableCuttingHeaderFilters } =
  jest.requireActual<WorkbookFiltersModule>('./workbook-filters.cjs');

describe('XLSX workbook filters', () => {
  it('rebuilds an existing table over the complete used range and preserves its style', () => {
    const existingTable = {
      style: 'TableStyleMedium2',
      showFilterButton: false,
      delete: jest.fn(),
    };
    const replacementTable = { showFilterButton: false, delete: jest.fn() };
    const sheet: FilterSheet = {
      tables: { items: [existingTable], add: jest.fn(() => replacementTable) },
    };

    enableCuttingHeaderFilters(sheet, { address: 'A1:T101' }, 'cutting_prices');

    expect(existingTable.delete).toHaveBeenCalledTimes(1);
    expect(sheet.tables.add).toHaveBeenCalledWith('A1:T101', true, 'CuttingPricesTable');
    expect(replacementTable).toMatchObject({
      style: 'TableStyleMedium2',
      showFilterButton: true,
    });
  });

  it('creates a deterministic full-range table when the sheet has none', () => {
    const table = { showFilterButton: false, delete: jest.fn() };
    const sheet: FilterSheet = {
      tables: { items: [], add: jest.fn(() => table) },
    };

    enableCuttingHeaderFilters(sheet, { address: 'A1:T20' }, 'cutting_supplements');

    expect(sheet.tables.add).toHaveBeenCalledWith('A1:T20', true, 'CuttingSupplementsTable');
    expect(table.showFilterButton).toBe(true);
  });
});
