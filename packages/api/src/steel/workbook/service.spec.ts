import os from 'os';

import {
  requiredSteelWorkbookSheetIds,
  type SteelWorkbookInternalPatchRequest,
} from 'librechat-data-provider';

import {
  createSteelWorkbookService,
  SteelWorkbookVersionConflictError,
  type SteelWorkbookCreateRecord,
  type SteelWorkbookPatchRecord,
  type SteelWorkbookRecord,
  type SteelWorkbookRepository,
} from './service';
import { buildSemanticWorkbookPatchOperations } from './semantic';

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

  async findByConversationMetaId(conversationMetaId: string): Promise<SteelWorkbookRecord | null> {
    return (
      Array.from(this.workbooks.values()).find(
        (workbook) =>
          workbook.conversationMetaId === conversationMetaId && workbook.status === 'active',
      ) ?? null
    );
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
  customer_data: ['客戶編號', '廠商名稱', '等級', '確認狀態', '備註'],
  customer_quote: ['項次', '品名規格', '數量', '單位', '單價', '小計', '備註'],
};

const expectedLabelsBySheet = {
  quote_details: '報價明細',
  summary: '總結',
  manual_review: '人工複核',
  price_sources: '價格來源',
  interpretation_notes: '判讀備註',
  system_order: '系統訂單',
  customer_data: '客戶資料',
  customer_quote: '報價單',
};

describe('createSteelWorkbookService', () => {
  it('creates a renderable eight-sheet workbook for LibreChat UI preview', async () => {
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

  it('starts new quote workbooks with headers only and no quote data rows', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });

    const result = await service.create({});

    expect(result.workbook.sheets.map((sheet) => sheet.id)).toEqual(requiredSteelWorkbookSheetIds);
    expect(
      Object.fromEntries(result.workbook.sheets.map((sheet) => [sheet.id, sheet.rows])),
    ).toEqual({
      system_order: [],
      customer_data: [],
      quote_details: [],
      summary: [],
      manual_review: [],
      price_sources: [],
      interpretation_notes: [],
      customer_quote: [],
    });
  });

  it('reads the active workbook bound to a conversation meta id', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });

    await service.create({ conversationMetaId: 'steel_meta_1' });

    await expect(
      service.readByConversationMetaId({ conversationMetaId: 'steel_meta_1' }),
    ).resolves.toEqual(
      expect.objectContaining({
        workbook: expect.objectContaining({ id: 'wb_1' }),
      }),
    );
    await expect(
      service.readByConversationMetaId({ conversationMetaId: 'steel_meta_missing' }),
    ).resolves.toBeNull();
  });

  it('patches the unique workbook bound to a conversation meta id', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });

    const first = await service.patchByConversationMetaId({
      conversationMetaId: 'steel_meta_1',
      workbookVersion: 1,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 643.2,
        },
      ],
    });
    const second = await service.patchByConversationMetaId({
      conversationMetaId: 'steel_meta_1',
      workbookVersion: first.workbook.version,
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

    expect(repository.workbooks.size).toBe(1);
    expect([...repository.workbooks.values()][0]).toMatchObject({
      workbookId: 'wb_1',
      conversationMetaId: 'steel_meta_1',
    });
    expect(second.workbook.id).toBe('wb_1');
    expect(second.workbook.version).toBe(2);
  });

  it('creates the target row when a validated patch writes the first quote data', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });
    const created = await service.create({});

    const result = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_new',
          columnKey: 'subtotal',
          value: 643.2,
          reason: 'First provisional quote row from reviewed C-type candidate.',
        },
      ],
    });

    const quoteDetails = result.workbook?.sheets.find((sheet) => sheet.id === 'quote_details');
    expect(quoteDetails?.rows).toEqual([
      {
        id: 'line_new',
        cells: {
          subtotal: 643.2,
        },
      },
    ]);
    expect(result.workbook.version).toBe(1);
    expect(result.changedPaths).toEqual([]);
    expect(result.changedFieldSummary).toEqual([
      {
        sheetId: 'quote_details',
        rowId: 'line_new',
        columnKey: 'subtotal',
        label: '小計',
        previousValue: null,
        nextValue: 643.2,
      },
    ]);
  });

  it('creates visible workbook rows when a C75 semantic patch targets rows that do not exist yet', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });
    const created = await service.create({});

    const result = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: buildSemanticWorkbookPatchOperations({
        quoteLines: [
          {
            lineId: 'line_3',
            lineNo: 3,
            customerOriginalItemName: 'C75',
            normalizedItemName: '錏輕型鋼 75*2.3',
            adoptedProductPriceItem: 'CCG07523 錏輕型鋼 75*2.3',
            quantity: 288,
            unit: '隻',
            unitWeightKgPerM: 3.25,
            totalWeightKg: 4122.82,
            materialUnitPrice: 26.8,
            materialPricingUnit: 'Kg',
            billableQuantity: 4122.82,
            subtotal: 110491.58,
            systemOrder: {
              modelCode: 'CCG07523',
              itemSpec: '錏輕型鋼 75*2.3',
              unit: 'Kg',
              quantity: 4122.82,
              unitPrice: 26.8,
            },
            customerQuote: {
              itemSpec: 'C75 錏輕型鋼（暫採75*2.3）',
              quantity: 288,
              unit: '隻',
              subtotal: 110491.58,
            },
            manualReview: {
              confirmationNeeded: '確認 C75 是否為 75*2.3 厚度',
            },
          },
        ],
      }),
    });

    const systemOrder = result.workbook.sheets.find((sheet) => sheet.id === 'system_order');
    const customerQuote = result.workbook.sheets.find((sheet) => sheet.id === 'customer_quote');
    const manualReview = result.workbook.sheets.find((sheet) => sheet.id === 'manual_review');

    expect(systemOrder?.rows.find((row) => row.id === 'order_3')).toMatchObject({
      cells: {
        model_code: 'CCG07523',
        item_spec: '錏輕型鋼 75*2.3',
      },
    });
    expect(customerQuote?.rows.find((row) => row.id === 'customer_3')).toMatchObject({
      cells: {
        item_spec: 'C75 錏輕型鋼（暫採75*2.3）',
        subtotal: 110491.58,
      },
    });
    expect(manualReview?.rows.find((row) => row.id === 'review_3')).toMatchObject({
      cells: {
        confirmation_needed: '確認 C75 是否為 75*2.3 厚度',
      },
    });
    expect(repository.patches[0]?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'set_cell',
          sheetId: 'system_order',
          rowId: 'order_3',
          columnKey: 'item_spec',
        }),
      ]),
    );
  });

  it('keeps customer quote total as the final row and recalculates it after adding lines', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-15T00:00:00.000Z'),
      repository,
    });
    const created = await service.create({});
    const initial = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'item_spec',
          value: '黑鐵板 PL15*500，L=300mm（暫估）',
        },
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'subtotal',
          value: 6270.19,
        },
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_2',
          columnKey: 'item_spec',
          value: '黑鐵板 PL15*277，L=5280mm（暫估）',
        },
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_2',
          columnKey: 'subtotal',
          value: 122273.67,
        },
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_total',
          columnKey: 'item_spec',
          value: '報價總額',
        },
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_total',
          columnKey: 'subtotal',
          value: 128543.86,
        },
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_total',
          columnKey: 'note',
          value: '含暫估，待確認',
        },
      ],
    });

    const result = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: initial.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_3',
          columnKey: 'item_spec',
          value: '黑鐵板 PL15*277，L=399mm（暫估）',
        },
        {
          op: 'set_cell',
          sheetId: 'customer_quote',
          rowId: 'customer_3',
          columnKey: 'subtotal',
          value: 9240,
        },
      ],
    });

    const customerQuote = result.workbook.sheets.find((sheet) => sheet.id === 'customer_quote');
    expect(customerQuote?.rows.map((row) => row.id)).toEqual([
      'customer_1',
      'customer_2',
      'customer_3',
      'customer_total',
    ]);
    expect(customerQuote?.rows.at(-1)).toMatchObject({
      id: 'customer_total',
      cells: {
        item_spec: '報價總額',
        subtotal: 137783.86,
        note: '含暫估，待確認',
      },
    });
    expect(result.changedFieldSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_total',
          columnKey: 'subtotal',
          previousValue: 128543.86,
          nextValue: 137783.86,
        }),
      ]),
    );
  });

  it('removes an existing workbook row with delete_row operations', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });
    const created = await service.create({});
    const initial = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'item_spec',
          value: '錏輕型鋼 75*2.3',
        },
        {
          op: 'set_cell',
          sheetId: 'system_order',
          rowId: 'order_2',
          columnKey: 'item_spec',
          value: '未確認 鍍鋅方管',
        },
      ],
    });

    const result = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: initial.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'delete_row',
          sheetId: 'system_order',
          rowId: 'order_2',
          reason: 'User requested removing unconfirmed system-order rows.',
        },
      ],
    });

    const systemOrder = result.workbook?.sheets.find((sheet) => sheet.id === 'system_order');
    expect(systemOrder?.rows).toEqual([
      {
        id: 'order_1',
        cells: {
          item_spec: '錏輕型鋼 75*2.3',
        },
      },
    ]);
    expect(result.workbook.version).toBe(2);
    expect(repository.patches[1]).toMatchObject({
      workbookId: 'wb_1',
      beforeVersion: 1,
      afterVersion: 2,
      operations: [
        {
          op: 'delete_row',
          sheetId: 'system_order',
          rowId: 'order_2',
          reason: 'User requested removing unconfirmed system-order rows.',
        },
      ],
      status: 'accepted',
    });
  });

  it('treats the first data patch on an empty workbook as initial load without highlights or version bump', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });
    const created = await service.create({});

    const result = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'model_code',
          value: 'CCG10023',
          reason: 'First provisional quote row from reviewed C-type candidate.',
        },
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 643.2,
          reason: 'First provisional quote row from reviewed C-type candidate.',
        },
      ],
    });

    expect(result.workbook.version).toBe(1);
    expect(result.changedPaths).toEqual([]);
    expect(result.changedFieldSummary).toEqual([
      {
        sheetId: 'system_order',
        rowId: 'order_1',
        columnKey: 'model_code',
        label: '型號',
        previousValue: null,
        nextValue: 'CCG10023',
      },
      {
        sheetId: 'quote_details',
        rowId: 'line_1',
        columnKey: 'subtotal',
        label: '小計',
        previousValue: null,
        nextValue: 643.2,
      },
    ]);
    expect(repository.patches[0]).toMatchObject({
      workbookId: 'wb_1',
      beforeVersion: 1,
      afterVersion: 1,
      changedPaths: [],
      changedFieldSummary: result.changedFieldSummary,
      status: 'accepted',
    });
  });

  it('keeps the reference workbook sheet and column structure without seeding reference rows', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });

    const result = await service.create({});
    const rowCounts = Object.fromEntries(
      result.workbook.sheets.map((sheet) => [sheet.id, sheet.rows.length]),
    );
    const quoteDetails = result.workbook.sheets.find((sheet) => sheet.id === 'quote_details');

    expect(rowCounts).toEqual({
      system_order: 0,
      customer_data: 0,
      quote_details: 0,
      summary: 0,
      manual_review: 0,
      price_sources: 0,
      interpretation_notes: 0,
      customer_quote: 0,
    });
    expect(quoteDetails?.columns).toHaveLength(39);
  });

  it('creates the workbook from code constants without reading the xlsm at runtime', async () => {
    const previousCwd = process.cwd();
    jest.resetModules();
    process.chdir(os.tmpdir());

    try {
      const { createSteelWorkbookService: createWorkbookService } = await import('./service');
      const repository = new MemorySteelWorkbookRepository();
      const service = createWorkbookService({
        id: () => 'wb_no_reference_file_runtime',
        now: () => new Date('2026-06-02T00:00:00.000Z'),
        repository,
      });

      const result = await service.create({});
      const rowCounts = Object.fromEntries(
        result.workbook.sheets.map((sheet) => [sheet.id, sheet.rows.length]),
      );

      expect(result.workbook.sheets.map((sheet) => sheet.id)).toEqual(
        requiredSteelWorkbookSheetIds,
      );
      expect(rowCounts).toMatchObject({
        system_order: 0,
        customer_data: 0,
        quote_details: 0,
        summary: 0,
        manual_review: 0,
        price_sources: 0,
        interpretation_notes: 0,
        customer_quote: 0,
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('applies a multi-turn cell patch and increments workbook version', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const service = createSteelWorkbookService({
      id: () => 'wb_1',
      now: () => new Date('2026-06-02T00:00:00.000Z'),
      repository,
    });
    const created = await service.create({});
    const initialLoad = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 643.2,
          reason: 'Initial quote preview load.',
        },
      ],
    });
    const patch: SteelWorkbookInternalPatchRequest = {
      workbookId: created.workbook.id,
      workbookVersion: initialLoad.workbook.version,
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

    expect(initialLoad.workbook.version).toBe(1);
    expect(initialLoad.changedPaths).toEqual([]);
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
    expect(repository.patches[1]).toMatchObject({
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
    const initialLoad = await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 643.2,
        },
      ],
    });
    await service.patch({
      workbookId: created.workbook.id,
      workbookVersion: initialLoad.workbook.version,
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
