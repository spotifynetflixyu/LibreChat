import {
  requiredSteelWorkbookSheetIds,
  steelWorkbookPatchRequestSchema,
  steelSelectedWorkbookRefSchema,
  steelWorkbookSchema,
} from './workbooks';

describe('Steel workbook public contracts', () => {
  it('keeps the fixed seven-sheet workbook contract', () => {
    expect(requiredSteelWorkbookSheetIds).toEqual([
      'system_order',
      'summary',
      'manual_review',
      'quote_details',
      'price_sources',
      'interpretation_notes',
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
        columnKey: 'material_unit_price',
        displayLabel: '報價明細 material_unit_price',
      }),
    ).toMatchObject({
      workbookId: 'wb_1',
      workbookVersion: 3,
      sheetId: 'quote_details',
      columnKey: 'material_unit_price',
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

  it('requires renderable columns for each sheet so LibreChat can preview tabs directly', () => {
    const workbook = steelWorkbookSchema.parse({
      id: 'wb_1',
      version: 1,
      sheets: requiredSteelWorkbookSheetIds.map((sheetId) => ({
        id: sheetId,
        label: sheetId,
        columns: [
          {
            key: 'line_no',
            label: '項次',
            valueType: 'number',
            editable: false,
          },
          {
            key: 'material_unit_price',
            label: '材料單價',
            valueType: 'currency',
            editable: true,
          },
        ],
        rows: [{ id: `${sheetId}-row-1`, cells: { line_no: 1, material_unit_price: 120 } }],
      })),
    });

    expect(workbook.sheets[0]?.columns[1]).toMatchObject({
      key: 'material_unit_price',
      label: '材料單價',
      valueType: 'currency',
      editable: true,
    });
  });

  it('accepts explicit patch operations for multi-turn workbook updates', () => {
    const patch = steelWorkbookPatchRequestSchema.parse({
      workbookId: 'wb_1',
      workbookVersion: 2,
      selectedWorkbookRefs: [
        {
          workbookId: 'wb_1',
          workbookVersion: 2,
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
        },
      ],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 115,
          reason: 'User confirmed revised unit price in the next turn.',
        },
      ],
    });

    expect(patch.operations).toHaveLength(1);
    expect(patch.operations[0]).toMatchObject({
      op: 'set_cell',
      sheetId: 'quote_details',
      rowId: 'line_1',
      columnKey: 'material_unit_price',
      value: 115,
    });
  });
});
