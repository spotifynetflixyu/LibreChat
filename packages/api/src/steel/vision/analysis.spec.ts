import { createSteelFileAnalysisService } from './analysis';

import type {
  SteelFileAnalysisCreateRecord,
  SteelFileAnalysisRecord,
  SteelFileAnalysisRepository,
} from './analysis';

function createMemoryRepository(): SteelFileAnalysisRepository {
  const records = new Map<string, SteelFileAnalysisRecord>();

  return {
    async create(record: SteelFileAnalysisCreateRecord) {
      records.set(record.id, record);
      return record;
    },
    async findByConversationId(conversationId: string) {
      return (
        [...records.values()].find((record) => record.conversationId === conversationId) ?? null
      );
    },
    async update(record: SteelFileAnalysisRecord) {
      records.set(record.id, record);
      return record;
    },
  };
}

describe('Steel file analysis data service', () => {
  it('creates one workspace per conversation and stores rows from multiple files', async () => {
    let idIndex = 0;
    const service = createSteelFileAnalysisService({
      repository: createMemoryRepository(),
      id: () => {
        idIndex += 1;
        return `id_${idIndex}`;
      },
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });

    const first = await service.patch({
      conversationId: 'conv_1',
      workbookId: 'workbook_1',
      patch: {
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
                cells: { partNo: 'BP1' },
              },
            ],
          },
        ],
      },
    });

    const second = await service.patch({
      conversationId: 'conv_1',
      workbookId: 'workbook_1',
      patch: {
        sourceFiles: [{ fileId: 'file_2', filename: 'detail.pdf', mediaType: 'application/pdf' }],
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertColumns: [{ key: 'note', label: '備註' }],
            upsertRows: [
              {
                sourceRef: {
                  fileId: 'file_2',
                  filename: 'detail.pdf',
                  mediaType: 'application/pdf',
                  page: 3,
                },
                cells: { note: '第 3 頁有開槽記號' },
              },
            ],
          },
        ],
      },
    });

    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(second.sourceFiles.map((file) => file.fileId)).toEqual(['file_1', 'file_2']);
    expect(second.sheets.file_analysis_data.rows).toHaveLength(2);
    expect(second.sheets.file_analysis_data.rows[1]?.sourceRef.fileId).toBe('file_2');
  });

  it('updates existing rows and preserves source refs', async () => {
    const service = createSteelFileAnalysisService({
      repository: createMemoryRepository(),
      id: () => 'stable_id',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });

    await service.patch({
      conversationId: 'conv_1',
      patch: {
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertRows: [
              {
                id: 'row_pl7a',
                sourceRef: {
                  fileId: 'file_1',
                  filename: 'c.png',
                  mediaType: 'image/png',
                  page: 1,
                },
                cells: { partNo: 'PL7A', spec: '362×368×10t' },
              },
            ],
          },
        ],
      },
    });

    const updated = await service.patch({
      conversationId: 'conv_1',
      patch: {
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertRows: [
              {
                id: 'row_pl7a',
                cells: { spec: '362×324×10t' },
                reviewStatus: 'corrected',
                rowWarnings: ['user corrected value'],
              },
            ],
          },
        ],
      },
    });

    const row = updated.sheets.file_analysis_data.rows.find(
      (candidate) => candidate.id === 'row_pl7a',
    );
    expect(row?.sourceRef.fileId).toBe('file_1');
    expect(row?.cells).toEqual({ partNo: 'PL7A', spec: '362×324×10t' });
    expect(row?.reviewStatus).toBe('corrected');
    expect(row?.rowWarnings).toEqual(['user corrected value']);
  });

  it('updates reprocessed OCR rows by stable source key when no row id is supplied', async () => {
    const service = createSteelFileAnalysisService({
      repository: createMemoryRepository(),
      id: () => 'generated_row_id',
      now: () => new Date('2026-06-12T00:00:00.000Z'),
    });

    await service.patch({
      conversationId: 'conv_1',
      patch: {
        sourceFiles: [
          {
            fileId: 'file_1',
            filename: 'multi.pdf',
            mediaType: 'application/pdf',
            pageCount: 2,
            ocrEngine: 'PaddleOCR MCP',
            ocrStatus: 'completed',
          },
        ],
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertRows: [
              {
                sourceRef: {
                  fileId: 'file_1',
                  filename: 'multi.pdf',
                  mediaType: 'application/pdf',
                  sourceKey: 'file_1:page:1:table:main:row:BP1',
                  page: 1,
                  ocrEngine: 'PaddleOCR MCP',
                  ocrStatus: 'completed',
                },
                cells: { partNo: 'BP1', quantity: 12 },
              },
            ],
          },
        ],
      },
    });

    const reprocessed = await service.patch({
      conversationId: 'conv_1',
      patch: {
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertRows: [
              {
                sourceRef: {
                  fileId: 'file_1',
                  filename: 'multi.pdf',
                  mediaType: 'application/pdf',
                  sourceKey: 'file_1:page:1:table:main:row:BP1',
                  page: 1,
                  ocrEngine: 'PaddleOCR MCP',
                  ocrStatus: 'completed',
                  processedAt: '2026-06-12T08:00:00.000Z',
                },
                cells: { partNo: 'BP1', quantity: 14 },
                reviewStatus: 'corrected',
              },
            ],
          },
        ],
        summary: '重新處理 multi.pdf page 1 BP1。',
      },
    });

    expect(reprocessed.sheets.file_analysis_data.rows).toHaveLength(1);
    expect(reprocessed.sheets.file_analysis_data.rows[0]?.id).toBe('generated_row_id');
    expect(reprocessed.sheets.file_analysis_data.rows[0]?.cells.quantity).toBe(14);
    expect(reprocessed.sheets.file_analysis_data.rows[0]?.sourceRef.processedAt).toBe(
      '2026-06-12T08:00:00.000Z',
    );
    expect(reprocessed.sourceFiles[0]?.ocrStatus).toBe('completed');
  });

  it('can patch manual review and interpretation notes without quote workbook mutation', async () => {
    const service = createSteelFileAnalysisService({
      repository: createMemoryRepository(),
      id: () => 'id_review',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });

    const workspace = await service.patch({
      conversationId: 'conv_1',
      patch: {
        patches: [
          {
            sheetId: 'manual_review',
            upsertColumns: [{ key: 'issue', label: '複核項目' }],
            upsertRows: [{ cells: { issue: 'PL7A 規格需人工確認' } }],
          },
          {
            sheetId: 'interpretation_notes',
            upsertColumns: [{ key: 'note', label: '備註' }],
            upsertRows: [{ cells: { note: '第 1 頁表格較小，已標低信心' } }],
          },
        ],
      },
    });

    expect(workspace.sheets.manual_review.rows).toHaveLength(1);
    expect(workspace.sheets.interpretation_notes.rows).toHaveLength(1);
    expect('workbookPatch' in workspace).toBe(false);
  });
});
