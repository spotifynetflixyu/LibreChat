import {
  requiredSteelWorkbookSheetIds,
  type SteelWorkbookPatchRequest,
} from 'librechat-data-provider';

import {
  createSteelWorkbookService,
  SteelWorkbookVersionConflictError,
  type SteelWorkbookCreateRecord,
  type SteelWorkbookPatchRecord,
  type SteelWorkbookRecord,
  type SteelWorkbookRepository,
} from './service';

class MemorySteelWorkbookRepository implements SteelWorkbookRepository {
  readonly workbooks = new Map<string, SteelWorkbookRecord>();
  readonly patches: SteelWorkbookPatchRecord[] = [];

  async create(record: SteelWorkbookCreateRecord): Promise<SteelWorkbookRecord> {
    this.workbooks.set(record.workbookId, record);
    return record;
  }

  async findByWorkbookId(workbookId: string): Promise<SteelWorkbookRecord | null> {
    return this.workbooks.get(workbookId) ?? null;
  }

  async update(record: SteelWorkbookRecord): Promise<SteelWorkbookRecord> {
    this.workbooks.set(record.workbookId, record);
    return record;
  }

  async createPatch(record: SteelWorkbookPatchRecord): Promise<SteelWorkbookPatchRecord> {
    this.patches.push(record);
    return record;
  }
}

const expectedHeadersBySheet = {
  quote_details: [
    '項次',
    '客戶原始品名',
    '標準化品名',
    '搜尋關鍵字',
    '產品價格候選品項',
    '採用產品價格品項',
    '是否完全匹配',
    '未採用候選原因',
    '材料類別',
    '材質',
    '規格',
    '成品長度m',
    '數量',
    '單位',
    '素材長度',
    '素材支數',
    '可裁成品數',
    '餘料長度/重量',
    '單位重量kg/m',
    '單重kg',
    '總重kg',
    '重量算法',
    '客戶',
    '分級',
    '材料單價',
    '材料單價欄位',
    '材料計價單位',
    '計價數量',
    '材料費',
    '切工費',
    '孔費',
    '開槽費',
    '折工費',
    '其他費',
    '小計',
    '信心等級',
    '低信心原因',
    '判斷依據',
    '建議複核',
    '備註',
  ],
  summary: ['項目', '值', '備註'],
  manual_review: [
    '項次',
    '問題類型',
    '暫估值',
    '低信心原因',
    '推定依據',
    '需確認內容',
    '金額影響',
    '建議處理',
  ],
  price_sources: [
    '客戶',
    '分級',
    '客戶原始品名',
    '標準化品名',
    '搜尋關鍵字',
    '產品價格候選品項',
    '採用產品價格品項',
    '採用單價',
    '單價欄位',
    '單位',
    '來源檔案',
    '工作表',
    '列號或頁碼',
    '是否精準匹配',
    '差異說明',
    '信心等級',
    '備註',
  ],
  interpretation_notes: ['項目', '內容', '信心', '依據'],
  system_order: [
    '公司編號',
    '項次',
    '倉庫編號',
    '型號',
    '品名規格',
    '材質編號',
    '廠別編號',
    '單位',
    '數量',
    '單重',
    '總數',
    '單價',
    '計價基準',
    '公式編號',
    '厚度',
    '寬度',
    '長度',
    '類別',
    '交貨日期',
    '備註',
  ],
  customer_quote: ['項次', '品名規格', '數量', '單位', '單價', '小計', '備註'],
};

const expectedLabelsBySheet = {
  quote_details: '報價明細',
  summary: '總結',
  manual_review: '人工複核',
  price_sources: '價格來源',
  interpretation_notes: '判讀備註',
  system_order: '系統訂單',
  customer_quote: '給客戶',
};

describe('createSteelWorkbookService', () => {
  it('creates a renderable seven-sheet workbook for LibreChat UI preview', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });

    const result = await service.create({ conversationMetaId: 'steel_meta_1' });

    expect(result.workbook.id).toBe('wb_1');
    expect(result.workbook.version).toBe(1);
    expect(result.workbook.sheets.map((sheet) => sheet.id)).toEqual(requiredSteelWorkbookSheetIds);

    for (const sheet of result.workbook.sheets) {
      expect(sheet.label).toBe(expectedLabelsBySheet[sheet.id]);
      expect(sheet.columns.map((column) => column.label)).toEqual(expectedHeadersBySheet[sheet.id]);
    }
  });

  it('seeds summary and customer-facing total rows for quote output', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });

    const result = await service.create({});
    const summary = result.workbook.sheets.find((sheet) => sheet.id === 'summary');
    const customerQuote = result.workbook.sheets.find((sheet) => sheet.id === 'customer_quote');

    expect(summary?.rows.map((row) => row.cells.item)).toEqual(['總重量', '總額']);
    expect(customerQuote?.rows).toEqual([
      { id: 'customer_1', cells: { line_no: 1 } },
      { id: 'customer_total', cells: { item_spec: '訂單總額', subtotal: null } },
    ]);
  });

  it('applies a multi-turn cell patch and increments workbook version', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });
    const created = await service.create({});
    const patch: SteelWorkbookPatchRequest = {
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 115,
          reason: 'Second turn confirmed a revised unit price.',
        },
      ],
    };

    const result = await service.patch(patch);

    expect(result.workbook?.version).toBe(2);
    expect(result.changedPaths).toEqual([
      { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
    ]);
    expect(result.changedFieldSummary).toEqual([
      {
        sheetId: 'quote_details',
        rowId: 'line_1',
        columnKey: 'material_unit_price',
        label: '材料單價',
        previousValue: null,
        nextValue: 115,
      },
    ]);
    expect(repository.patches[0]).toMatchObject({
      workbookId: 'wb_1',
      beforeVersion: 1,
      afterVersion: 2,
      status: 'accepted',
    });
  });

  it('rejects stale multi-turn patches instead of overwriting newer workbook content', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });
    const created = await service.create({});
    await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 115,
        },
      ],
    });

    await expect(
      service.patch({
        workbookId: created.workbook.id,
        workbookVersion: created.workbook.version,
        selectedWorkbookRefs: [],
        operations: [
          {
            op: 'set_cell',
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            value: 120,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(SteelWorkbookVersionConflictError);

    expect((await service.read({ workbookId: created.workbook.id })).workbook.version).toBe(2);
  });
});
