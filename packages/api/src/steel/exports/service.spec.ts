import ExcelJS from 'exceljs';

import { renderSteelWorkbookXlsx } from './service';

import type { SteelWorkbook } from 'librechat-data-provider';

const requiredSheetIds = [
  'system_order',
  'quote_details',
  'summary',
  'manual_review',
  'price_sources',
  'interpretation_notes',
  'customer_quote',
] as const;

function createWorkbook(): SteelWorkbook {
  return {
    id: 'wb_1',
    version: 4,
    sheets: requiredSheetIds.map((sheetId) => ({
      id: sheetId,
      label:
        sheetId === 'quote_details'
          ? '報價明細'
          : sheetId === 'system_order'
            ? '系統訂單'
            : sheetId,
      columns: [
        { key: 'line_no', label: '項次', valueType: 'number', editable: false, widthPx: 80 },
        {
          key: 'material_unit_price',
          label: '材料單價',
          valueType: 'currency',
          editable: true,
          widthPx: 120,
        },
        { key: 'subtotal', label: '小計', valueType: 'currency', editable: true },
      ],
      rows: [
        {
          id: `${sheetId}_line_1`,
          cells: { line_no: 1, material_unit_price: null, subtotal: 0 },
        },
      ],
    })),
  };
}

describe('renderSteelWorkbookXlsx', () => {
  it('renders all seven workbook sheets from persisted workbook JSON', async () => {
    const buffer = await renderSteelWorkbookXlsx({ workbook: createWorkbook() });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '系統訂單',
      '報價明細',
      'summary',
      'manual_review',
      'price_sources',
      'interpretation_notes',
      'customer_quote',
    ]);
    expect(workbook.getWorksheet('報價明細')?.getRow(1).values).toEqual([
      undefined,
      '項次',
      '材料單價',
      '小計',
    ]);
  });

  it('renders arbitrary selected sheets and keeps unconfirmed currency values explicit', async () => {
    const buffer = await renderSteelWorkbookXlsx({
      workbook: createWorkbook(),
      sheetIds: ['quote_details', 'system_order'],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const quoteSheet = workbook.getWorksheet('報價明細');

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['報價明細', '系統訂單']);
    expect(quoteSheet?.getCell('B2').value).toBe('未確認');
    expect(quoteSheet?.getCell('C2').value).toBe(0);
  });
});
