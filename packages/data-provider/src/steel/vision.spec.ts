import {
  patchFileAnalysisDataToolInputSchema,
  requiredSteelFileAnalysisSheetIds,
  steelFileAnalysisManualPatchRequestSchema,
  steelFileAnalysisManualPatchResponseSchema,
  steelFileAnalysisDataSchema,
} from './vision';

describe('Steel file analysis data schemas', () => {
  it('accepts one conversation workspace with flexible rows from multiple source files', () => {
    const workspace = steelFileAnalysisDataSchema.parse({
      id: 'fad_1',
      conversationId: 'conv_1',
      workbookId: 'workbook_1',
      version: 2,
      status: 'draft',
      sourceFiles: [
        { fileId: 'file_1', filename: 'c.png', mediaType: 'image/png' },
        { fileId: 'file_2', filename: 'detail.pdf', mediaType: 'application/pdf' },
      ],
      sheets: {
        file_analysis_data: {
          columns: [
            { key: 'partNo', label: '件號' },
            { key: 'spec', label: '規格' },
          ],
          rows: [
            {
              id: 'row_1',
              sourceRef: {
                fileId: 'file_1',
                filename: 'c.png',
                mediaType: 'image/png',
                page: 1,
                regionLabel: '螺栓統計表',
                orientation: '0',
              },
              cells: { partNo: 'BP1', spec: '650×650×28t' },
              confidence: 'medium',
              reviewStatus: 'pending_review',
            },
            {
              id: 'row_2',
              sourceRef: {
                fileId: 'file_2',
                filename: 'detail.pdf',
                mediaType: 'application/pdf',
                page: 3,
              },
              cells: { note: '第三頁新增開槽記號' },
            },
          ],
        },
        manual_review: {
          columns: [{ key: 'issue', label: '複核項目' }],
          rows: [],
        },
        interpretation_notes: {
          columns: [{ key: 'note', label: '判讀備註' }],
          rows: [],
        },
      },
    });

    expect(requiredSteelFileAnalysisSheetIds).toEqual([
      'file_analysis_data',
      'manual_review',
      'interpretation_notes',
    ]);
    expect(workspace.sourceFiles).toHaveLength(2);
    expect(workspace.sheets.file_analysis_data.rows).toHaveLength(2);
    expect(workspace.sheets.file_analysis_data.rows[1]?.sourceRef.fileId).toBe('file_2');
  });

  it('validates patch_file_analysis_data flexible columns and rows', () => {
    const input = patchFileAnalysisDataToolInputSchema.parse({
      sourceFiles: [{ fileId: 'file_1', filename: 'c.png', mediaType: 'image/png' }],
      patches: [
        {
          sheetId: 'file_analysis_data',
          upsertColumns: [{ key: 'partNo', label: '件號' }],
          upsertRows: [
            {
              sourceRef: {
                fileId: 'file_1',
                filename: 'c.png',
                mediaType: 'image/png',
                page: 1,
              },
              cells: { partNo: 'BP1', uncertain: false, quantity: 14 },
              confidence: 'medium',
            },
          ],
        },
      ],
      summary: '新增 c.png 第 1 頁螺栓統計表 1 列。',
    });

    expect(input.patches[0]?.sheetId).toBe('file_analysis_data');
    expect(input.patches[0]?.upsertRows[0]?.cells.quantity).toBe(14);
  });

  it('rejects unknown sheet ids', () => {
    expect(() =>
      patchFileAnalysisDataToolInputSchema.parse({
        patches: [{ sheetId: 'quote_details', upsertRows: [] }],
      }),
    ).toThrow();
  });

  it('validates manual file_analysis_data patch requests and responses', () => {
    const request = steelFileAnalysisManualPatchRequestSchema.parse({
      conversationId: 'conv_1',
      workbookId: 'workbook_1',
      sourceFiles: [{ fileId: 'file_1', filename: 'c.png', mediaType: 'image/png' }],
      patches: [
        {
          sheetId: 'file_analysis_data',
          upsertColumns: [{ key: 'quantity', label: '數量', valueType: 'number' }],
          upsertRows: [
            {
              id: 'row_1',
              sourceRef: {
                fileId: 'file_1',
                filename: 'c.png',
                mediaType: 'image/png',
                page: 1,
              },
              cells: { quantity: 2 },
            },
          ],
          deleteRowIds: ['row_2'],
        },
      ],
    });

    expect(request.patches[0]?.sheetId).toBe('file_analysis_data');
    expect(request.patches[0]?.deleteRowIds).toEqual(['row_2']);
    expect(() =>
      steelFileAnalysisManualPatchRequestSchema.parse({
        conversationId: 'conv_1',
        patches: [{ sheetId: 'manual_review', upsertRows: [] }],
      }),
    ).toThrow();

    const response = steelFileAnalysisManualPatchResponseSchema.parse({
      fileAnalysisData: {
        id: 'fad_1',
        conversationId: 'conv_1',
        version: 1,
        sourceFiles: [],
        sheets: {
          file_analysis_data: { columns: [], rows: [] },
          manual_review: { columns: [], rows: [] },
          interpretation_notes: { columns: [], rows: [] },
        },
      },
    });

    expect(response.fileAnalysisData.id).toBe('fad_1');
  });
});
