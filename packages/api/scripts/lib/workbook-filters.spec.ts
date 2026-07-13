import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';

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
  addWorksheetAutoFilter: (xml: string) => { xml: string; range: string | null };
  addWorksheetAutoFiltersToXlsx: (
    filePath: string,
  ) => Promise<Array<{ path: string; range: string }>>;
  enableCuttingHeaderFilters: (
    sheet: FilterSheet,
    used: { address: string },
    sheetName: string,
  ) => void;
}

const { addWorksheetAutoFilter, addWorksheetAutoFiltersToXlsx, enableCuttingHeaderFilters } =
  jest.requireActual<WorkbookFiltersModule>('./workbook-filters.cjs');

describe('XLSX workbook filters', () => {
  it('inserts a namespaced worksheet-level filter after sheet data', () => {
    const source =
      '<?xml version="1.0"?><x:worksheet xmlns:x="urn:test"><x:dimension ref="A1:T20" />' +
      '<x:sheetData><x:row r="1" /></x:sheetData><x:tableParts /></x:worksheet>';

    const result = addWorksheetAutoFilter(source);

    expect(result.range).toBe('A1:T20');
    expect(result.xml).toContain('</x:sheetData><x:autoFilter ref="A1:T20" /><x:tableParts />');
  });

  it('derives the used range from cell references when dimension is absent', () => {
    const source =
      '<x:worksheet xmlns:x="urn:test"><x:sheetData><x:row r="1">' +
      '<x:c r="A1"/><x:c r="T1"/></x:row><x:row r="20"><x:c r="T20"/>' +
      '</x:row></x:sheetData></x:worksheet>';

    const result = addWorksheetAutoFilter(source);

    expect(result.range).toBe('A1:T20');
    expect(result.xml).toContain('</x:sheetData><x:autoFilter ref="A1:T20" />');
  });

  it('replaces an existing worksheet filter and leaves table XML untouched', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worksheet-filters-'));
    const workbookPath = path.join(directory, 'fixture.xlsx');
    const zip = new JSZip();
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><dimension ref="A1:C4"/><sheetData/><autoFilter ref="A1:B4"/></worksheet>',
    );
    zip.file('xl/tables/table1.xml', '<table><autoFilter ref="A1:B4"/></table>');
    fs.writeFileSync(workbookPath, await zip.generateAsync({ type: 'nodebuffer' }));

    try {
      const filters = await addWorksheetAutoFiltersToXlsx(workbookPath);
      const updatedZip = await JSZip.loadAsync(fs.readFileSync(workbookPath));
      const worksheetXml = await updatedZip.file('xl/worksheets/sheet1.xml')!.async('string');
      const tableXml = await updatedZip.file('xl/tables/table1.xml')!.async('string');

      expect(filters).toEqual([{ path: 'xl/worksheets/sheet1.xml', range: 'A1:C4' }]);
      expect(worksheetXml).toContain('<autoFilter ref="A1:C4" />');
      expect(tableXml).toBe('<table><autoFilter ref="A1:B4"/></table>');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

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
