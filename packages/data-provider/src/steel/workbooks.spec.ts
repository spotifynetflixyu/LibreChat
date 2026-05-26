import {
  requiredSteelWorkbookSheetIds,
  steelSelectedWorkbookRefSchema,
  steelWorkbookSchema,
} from './workbooks';

describe('Steel workbook public contracts', () => {
  it('keeps the fixed seven-sheet workbook contract', () => {
    expect(requiredSteelWorkbookSheetIds).toEqual([
      'quote_details',
      'summary',
      'manual_review',
      'price_sources',
      'interpretation_notes',
      'system_order',
      'customer_quote',
    ]);
  });

  it('validates selected workbook refs as structured data, not marker text', () => {
    expect(
      steelSelectedWorkbookRefSchema.parse({
        workbookId: 'wb_1',
        workbookVersion: 3,
        sheetId: 'quote_details',
        rowId: 'line_1',
        columnKey: 'quoted_unit_price',
        displayLabel: '報價明細 quoted_unit_price',
      }),
    ).toMatchObject({
      workbookId: 'wb_1',
      workbookVersion: 3,
      sheetId: 'quote_details',
      columnKey: 'quoted_unit_price',
    });
  });

  it('rejects workbook payloads missing one of the seven sheets', () => {
    const result = steelWorkbookSchema.safeParse({
      id: 'wb_1',
      version: 1,
      sheets: [
        { id: 'quote_details', label: '報價明細', rows: [] },
        { id: 'summary', label: '總結', rows: [] },
      ],
    });

    expect(result.success).toBe(false);
  });
});
