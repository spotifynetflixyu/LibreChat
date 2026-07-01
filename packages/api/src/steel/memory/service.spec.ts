import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSteelWorkingOrderMemoryModel } from '@librechat/data-schemas';

import {
  createMongooseSteelOutputSheetMemoryReader,
  createMongooseSteelWorkingOrderMemoryReader,
  createMongooseSteelWorkingOrderMemoryWriter,
} from './service';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Mongoose Steel working-order memory reader', () => {
  it('reads full active Output Sheet Memory for provider context without compact summaries', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const reader = createMongooseSteelOutputSheetMemoryReader(mongoose, 'steel_conversation_1');

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'active system row',
        payload: {
          rowNo: 1,
          erpItemCode: 'CCG075',
          productName: '錏輕型鋼 75x45',
          quantity: 2,
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'customer_fact',
        sourceKind: 'tool_result',
        state: 'active',
        summary: 'active customer',
        payload: {
          displayName: '龍頂',
          customerTierId: 2,
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 3,
        checkpointTurnIndex: 2,
        memoryKind: 'price_evidence',
        sourceKind: 'tool_result',
        state: 'active',
        summary: 'active price',
        payload: {
          erpItemCode: 'CCG075',
          unitPrice: 268,
          customerTierId: 2,
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 4,
        checkpointTurnIndex: 3,
        memoryKind: 'calculation_fact',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'active quote line',
        payload: {
          rowNo: 1,
          subtotal: 536,
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 4,
        checkpointTurnIndex: 3,
        memoryKind: 'calculation_fact',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'active manual review',
        payload: {
          rowNo: 1,
          reason: '尺寸待確認',
          reviewStatus: 'manual_review',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 5,
        checkpointTurnIndex: 4,
        memoryKind: 'ocr_extract',
        sourceKind: 'ocr_result',
        state: 'active',
        summary: 'active OCR',
        payload: {
          filename: 'drawing.pdf',
          page: 1,
          text: '尺寸 75x45',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 6,
        checkpointTurnIndex: 5,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'superseded',
        summary: 'superseded row',
        payload: {
          rowNo: 1,
          erpItemCode: 'OLD001',
        },
      },
      {
        conversationId: 'steel_conversation_2',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'other conversation row',
        payload: {
          rowNo: 1,
          erpItemCode: 'OTHER001',
        },
      },
    ]);

    const result = await reader.readOutputSheetMemory();

    expect(Object.keys(result.previousOutputSheets)).toEqual([
      'system_order',
      'customer_data',
      'manual_review',
      'customer_quote',
    ]);
    expect(result).not.toHaveProperty('resultCount');
    expect(result).not.toHaveProperty('summary');
    expect(result.previousOutputSheets.system_order.rows).toEqual([
      expect.objectContaining({
        cells: expect.objectContaining({
          erpItemCode: 'CCG075',
          quantity: 2,
        }),
      }),
    ]);
    expect(result.previousOutputSheets.customer_data.rows).toEqual([
      expect.objectContaining({
        cells: expect.objectContaining({
          customerTierId: 2,
        }),
      }),
    ]);
    expect(result.previousOutputSheets.customer_quote.rows).toEqual([
      expect.objectContaining({
        cells: expect.objectContaining({
          rowNo: 1,
          subtotal: 536,
        }),
      }),
    ]);
    expect(result.previousOutputSheets.manual_review.rows).toEqual([
      expect.objectContaining({
        cells: expect.objectContaining({
          rowNo: 1,
          reviewStatus: 'manual_review',
        }),
      }),
    ]);
    expect(result.derivedIndex).toEqual(
      expect.objectContaining({
        lineItems: [expect.objectContaining({ erpItemCode: 'CCG075' })],
        customers: [expect.objectContaining({ customerTierId: 2 })],
        adoptedPrices: [expect.objectContaining({ erpItemCode: 'CCG075', unitPrice: 268 })],
        calculations: expect.arrayContaining([
          expect.objectContaining({ rowNo: 1, subtotal: 536 }),
          expect.objectContaining({ rowNo: 1, reason: '尺寸待確認' }),
        ]),
        ocrExtracts: [expect.objectContaining({ filename: 'drawing.pdf', page: 1 })],
        unresolvedItems: [expect.objectContaining({ rowNo: 1, reviewStatus: 'manual_review' })],
      }),
    );
  });

  it('reads active rows by item number and excludes superseded memory', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, 'steel_conversation_1');

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: '第 12 項 CCG075',
        payload: {
          rowNo: 12,
          erpItemCode: 'CCG075',
          productName: '錏輕型鋼 75x45',
          quantity: 2,
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 3,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'superseded',
        summary: '舊第 12 項',
        payload: {
          rowNo: 12,
          erpItemCode: 'OLD075',
          productName: '舊資料',
          quantity: 1,
        },
      },
    ]);

    const result = await reader.readWorkingOrderItems({
      mode: 'rowNo',
      rowNo: 12,
    });

    expect(result).toEqual(
      expect.objectContaining({
        mode: 'rowNo',
        resultCount: 1,
        workingOrderRows: [
          expect.objectContaining({
            erpItemCode: 'CCG075',
            rowNo: 12,
          }),
        ],
      }),
    );
  });

  it('searches active rows by ERP item code and spec/product query text', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, 'steel_conversation_1');

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: '第 1 項',
        payload: {
          rowNo: 1,
          erpItemCode: 'CCG075',
          productName: '錏輕型鋼',
          specKey: 'CCG075_75x45',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 3,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: '第 2 項',
        payload: {
          rowNo: 2,
          erpItemCode: 'EQB0090',
          productName: '圓鐵',
          specKey: '9m/m',
        },
      },
    ]);

    await expect(
      reader.readWorkingOrderItems({
        mode: 'erpItemCode',
        erpItemCode: 'CCG075',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        resultCount: 1,
        workingOrderRows: [expect.objectContaining({ erpItemCode: 'CCG075' })],
      }),
    );
    await expect(
      reader.readWorkingOrderItems({
        mode: 'query',
        query: '75x45',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        resultCount: 1,
        workingOrderRows: [expect.objectContaining({ erpItemCode: 'CCG075' })],
      }),
    );
  });

  it('returns active memory entry summaries for compact prompt summary injection', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, 'steel_conversation_1');

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'customer_fact',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: '龍頂 B tier',
        payload: {
          customerName: '龍頂',
          customerTierId: 2,
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 3,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: '第 1 項 CCG075',
        payload: {
          rowNo: 1,
          erpItemCode: 'CCG075',
        },
      },
    ]);

    await expect(reader.readWorkingOrderItems({ mode: 'summary' })).resolves.toEqual(
      expect.objectContaining({
        summary: { customer_fact: 1, working_order_row: 1 },
        memoryEntries: [
          expect.objectContaining({ memoryKind: 'customer_fact', summary: '龍頂 B tier' }),
          expect.objectContaining({ memoryKind: 'working_order_row', summary: '第 1 項 CCG075' }),
        ],
      }),
    );
  });

  it('captures final assistant system-order Markdown as the active working-order row snapshot', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, 'steel_conversation_1');

    await SteelWorkingOrderMemory.create({
      conversationId: 'steel_conversation_1',
      turnIndex: 2,
      checkpointTurnIndex: 1,
      memoryKind: 'working_order_row',
      sourceKind: 'assistant_final_markdown',
      state: 'active',
      summary: '第 1 項 OLD001 舊資料',
      payload: {
        rowNo: 1,
        erpItemCode: 'OLD001',
        productName: '舊資料',
      },
    });

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      requestId: 'request_4',
      messageId: 'assistant_4',
      turnIndex: 4,
      checkpointTurnIndex: 3,
      content: [
        '## system_order',
        '',
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 01 | 1 | A | CCG075 | 錏輕型鋼 75x45x15x2.3 |  |  | 支 | 2 | 4 | 8 | 26.8 | B | F1 | 2.3 | 75 | 6000 | C型鋼 |  | 已採用價格列 |',
        '| 01 | 2 | A | EQB0090 | 圓鐵 9m/m |  |  | 支 | 3 |  |  | 18 | B | F2 |  |  | 6000 | 圓鐵 |  | 待確認 |',
      ].join('\n'),
    });

    expect(result).toEqual({
      parseStatus: 'saved',
      savedCounts: { working_order_row: 2 },
      savedTableCounts: { system_order_table: 1 },
      totalSavedCounts: { working_order_row: 2 },
      totalTableCounts: { system_order_table: 1 },
    });
    await expect(reader.readWorkingOrderItems({ mode: 'page', pageSize: 10 })).resolves.toEqual(
      expect.objectContaining({
        resultCount: 2,
        workingOrderRows: [
          expect.objectContaining({
            rowNo: 10,
            項次: '10',
            erpItemCode: 'CCG075',
            productName: '錏輕型鋼 75x45x15x2.3',
            quantity: 2,
          }),
          expect.objectContaining({
            rowNo: 20,
            項次: '20',
            erpItemCode: 'EQB0090',
            productName: '圓鐵 9m/m',
            quantity: 3,
          }),
        ],
      }),
    );

    const oldRow = await SteelWorkingOrderMemory.findOne({
      conversationId: 'steel_conversation_1',
      'payload.erpItemCode': 'OLD001',
    }).lean();
    expect(oldRow).toBeNull();
  });

  it('only saves OCR and system tables when their titles contain the required keyword', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_title_filter',
      turnIndex: 10,
      checkpointTurnIndex: 9,
      content: [
        '## Drawing Review',
        '',
        '| 來源檔案 | 編號 | 斷面規格 | 信心程度 | 是否需人工複核 |',
        '| --- | --- | --- | --- | --- |',
        '| drawing.pdf | A1 | PL6*80*1000 | 高 | 否 |',
        '',
        '## ocr extracted table for user review',
        '',
        '| 來源檔案 | 編號 | 斷面規格 | 信心程度 | 是否需人工複核 |',
        '| --- | --- | --- | --- | --- |',
        '| drawing.pdf | A2 | PL9*100*1200 | 中 | 是 |',
        '',
        '## Quote Lines',
        '',
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 01 | 1 | A | SHOULD_SKIP | 不應儲存 |  |  | 支 | 1 |  |  | 1 | B | F1 |  |  |  |  |  | title 沒有 system |',
        '',
        '## generated system data table',
        '',
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 01 | 2 | A | KEEP001 | 應儲存 |  |  | 支 | 2 |  |  | 2 | B | F2 |  |  |  |  |  | title 有 system |',
      ].join('\n'),
    });
    const activeEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      state: 'active',
    })
      .sort({ memoryKind: 1 })
      .lean();

    expect(result).toEqual({
      parseStatus: 'saved',
      savedCounts: { ocr_extract: 1, working_order_row: 1 },
      savedTableCounts: { ocr_table: 1, system_order_table: 1 },
      totalSavedCounts: { ocr_extract: 1, working_order_row: 1 },
      totalTableCounts: { ocr_table: 1, system_order_table: 1 },
    });
    expect(activeEntries.map((entry) => entry.memoryKind).sort()).toEqual([
      'ocr_extract',
      'working_order_row',
    ]);
    expect(activeEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryKind: 'ocr_extract',
          payload: expect.objectContaining({
            rows: [['drawing.pdf', 'A2', 'PL9*100*1200', '中', '是']],
          }),
        }),
        expect.objectContaining({
          memoryKind: 'working_order_row',
          payload: expect.objectContaining({
            erpItemCode: 'KEEP001',
          }),
        }),
      ]),
    );
    expect(activeEntries).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            erpItemCode: 'SHOULD_SKIP',
          }),
        }),
      ]),
    );
  });

  it('keeps OCR and workbook tables separated by OCR file key', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_multi_file',
      turnIndex: 10,
      checkpointTurnIndex: 9,
      currentTurnFiles: [
        { fileId: 'file-a', filename: 'a.pdf', mediaType: 'application/pdf' },
        { fileId: 'file-b', filename: 'b.pdf', mediaType: 'application/pdf' },
      ],
      content: [
        '## OCR result a.pdf',
        '',
        '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 | 信心程度 | 是否需人工複核 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| a.pdf | A1 | PL6*80*1000 | 4 | 8 | 高 | 否 |',
        '',
        '## OCR result b.pdf',
        '',
        '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 | 信心程度 | 是否需人工複核 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| b.pdf | B1 | PL9*100*1200 | 2 | 4 | 中 | 是 |',
        '',
        '## system_order a.pdf',
        '',
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 01 | 1 | A | A001 | A PDF item |  |  | PCS | 1 |  |  | 10 | B | F1 | 6 | 80 | 1000 | 鐵板 |  |  |',
        '',
        '## system_order b.pdf',
        '',
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 01 | 1 | A | B001 | B PDF item |  |  | PCS | 2 |  |  | 20 | B | F2 | 9 | 100 | 1200 | 鐵板 |  |  |',
      ].join('\n'),
    });
    const activeEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      state: 'active',
    })
      .sort({ memoryKind: 1, 'payload.ocrFileKey': 1, 'payload.erpItemCode': 1 })
      .lean();

    expect(result).toEqual({
      parseStatus: 'saved',
      savedCounts: { ocr_extract: 2, working_order_row: 2 },
      savedTableCounts: { ocr_table: 2, system_order_table: 2 },
      totalSavedCounts: { ocr_extract: 2, working_order_row: 2 },
      totalTableCounts: { ocr_table: 2, system_order_table: 2 },
    });
    expect(activeEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryKind: 'ocr_extract',
          payload: expect.objectContaining({
            ocrFileKey: 'file:file-a',
            fileId: 'file-a',
            filename: 'a.pdf',
          }),
        }),
        expect.objectContaining({
          memoryKind: 'ocr_extract',
          payload: expect.objectContaining({
            ocrFileKey: 'file:file-b',
            fileId: 'file-b',
            filename: 'b.pdf',
          }),
        }),
        expect.objectContaining({
          memoryKind: 'working_order_row',
          payload: expect.objectContaining({
            ocrFileKey: 'file:file-a',
            fileId: 'file-a',
            filename: 'a.pdf',
            erpItemCode: 'A001',
          }),
        }),
        expect.objectContaining({
          memoryKind: 'working_order_row',
          payload: expect.objectContaining({
            ocrFileKey: 'file:file-b',
            fileId: 'file-b',
            filename: 'b.pdf',
            erpItemCode: 'B001',
          }),
        }),
      ]),
    );
  });

  it('keeps sequential OCR turns separated by OCR file key and reports aggregate totals', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await writer.capturePaddleOcrResult({
      conversationId: 'steel_conversation_1',
      requestId: 'request_a',
      providerToolCallId: 'preflight_a',
      turnIndex: 8,
      checkpointTurnIndex: 7,
      file: { fileId: 'file-a', filename: 'a.jpg', mediaType: 'image/jpeg' },
      data: { text: 'raw OCR A' },
    });
    const first = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_ocr_a',
      turnIndex: 8,
      checkpointTurnIndex: 7,
      currentTurnFiles: [{ fileId: 'file-a', filename: 'a.jpg', mediaType: 'image/jpeg' }],
      content: [
        '## OCR result a.jpg',
        '',
        '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 | 信心程度 | 是否需人工複核 |',
        '|---|---|---|---:|---:|---|---|',
        '| a.jpg | A1 | PL6*80*1000 | 4 | 8 | 高 | 否 |',
      ].join('\n'),
    });

    const secondPreflight = await writer.capturePaddleOcrResult({
      conversationId: 'steel_conversation_1',
      requestId: 'request_b',
      providerToolCallId: 'preflight_b',
      turnIndex: 9,
      checkpointTurnIndex: 8,
      file: { fileId: 'file-b', filename: 'b.jpg', mediaType: 'image/jpeg' },
      data: { text: 'raw OCR B' },
    });
    const second = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_ocr_b',
      turnIndex: 9,
      checkpointTurnIndex: 8,
      currentTurnFiles: [{ fileId: 'file-b', filename: 'b.jpg', mediaType: 'image/jpeg' }],
      content: [
        '## OCR result b.jpg',
        '',
        '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 | 信心程度 | 是否需人工複核 |',
        '|---|---|---|---:|---:|---|---|',
        '| b.jpg | B1 | PL9*100*1200 | 2 | 4 | 中 | 是 |',
      ].join('\n'),
    });
    const activeOcr = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      memoryKind: 'ocr_extract',
      state: 'active',
    })
      .sort({ 'payload.ocrFileKey': 1 })
      .lean();

    expect(first).toEqual({
      parseStatus: 'saved',
      savedCounts: { ocr_extract: 1 },
      savedTableCounts: { ocr_table: 1 },
      totalSavedCounts: { paddleocr_preflight: 1, ocr_extract: 1 },
      totalTableCounts: { ocr_table: 1 },
    });
    expect(secondPreflight).toEqual({
      savedCounts: { paddleocr_preflight: 1 },
      totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 1 },
      totalTableCounts: { ocr_table: 1 },
    });
    expect(second).toEqual({
      parseStatus: 'saved',
      savedCounts: { ocr_extract: 1 },
      savedTableCounts: { ocr_table: 1 },
      totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2 },
      totalTableCounts: { ocr_table: 2 },
    });
    expect(activeOcr.map((entry) => entry.payload)).toEqual([
      expect.objectContaining({
        ocrFileKey: 'file:file-a',
        fileId: 'file-a',
        filename: 'a.jpg',
      }),
      expect.objectContaining({
        ocrFileKey: 'file:file-b',
        fileId: 'file-b',
        filename: 'b.jpg',
      }),
    ]);
  });

  it('replaces workbook rows only within the matching OCR file key or default group', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'old A',
        payload: {
          ocrFileKey: 'file:file-a',
          fileId: 'file-a',
          filename: 'a.pdf',
          rowNo: 10,
          erpItemCode: 'OLD_A',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'old B',
        payload: {
          ocrFileKey: 'file:file-b',
          fileId: 'file-b',
          filename: 'b.pdf',
          rowNo: 10,
          erpItemCode: 'KEEP_B',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'old default',
        payload: {
          rowNo: 10,
          erpItemCode: 'OLD_DEFAULT',
        },
      },
    ]);

    const keyedResult = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_update_a',
      turnIndex: 3,
      checkpointTurnIndex: 2,
      currentTurnFiles: [
        { fileId: 'file-a', filename: 'a.pdf', mediaType: 'application/pdf' },
        { fileId: 'file-b', filename: 'b.pdf', mediaType: 'application/pdf' },
      ],
      content: [
        '## system_order a.pdf',
        '',
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 01 | 1 | A | NEW_A | New A item |  |  | PCS | 1 |  |  | 10 | B | F1 | 6 | 80 | 1000 | 鐵板 |  |  |',
      ].join('\n'),
    });

    expect(keyedResult.savedTableCounts).toEqual({ system_order_table: 1 });

    const defaultResult = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_default',
      turnIndex: 4,
      checkpointTurnIndex: 3,
      content: [
        '## system_order',
        '',
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 01 | 1 | A | NEW_DEFAULT | New default item |  |  | PCS | 3 |  |  | 30 | B | F3 |  |  |  |  |  |  |',
      ].join('\n'),
    });
    const activeRows = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      memoryKind: 'working_order_row',
      state: 'active',
    })
      .sort({ 'payload.ocrFileKey': 1, 'payload.erpItemCode': 1 })
      .lean();

    expect(defaultResult.savedTableCounts).toEqual({ system_order_table: 1 });
    expect(defaultResult.totalSavedCounts).toEqual({ working_order_row: 3 });
    expect(defaultResult.totalTableCounts).toEqual({ system_order_table: 3 });
    expect(activeRows.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ocrFileKey: 'file:file-a', erpItemCode: 'NEW_A' }),
        expect.objectContaining({ ocrFileKey: 'file:file-b', erpItemCode: 'KEEP_B' }),
        expect.objectContaining({ erpItemCode: 'NEW_DEFAULT' }),
      ]),
    );
    expect(activeRows.map((row) => row.payload)).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ erpItemCode: 'OLD_A' }),
        expect.objectContaining({ erpItemCode: 'OLD_DEFAULT' }),
      ]),
    );
  });

  it('skips partial row-change confirmation Markdown without backend row patches', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, 'steel_conversation_1');

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: '第 1 項 CCG075',
        payload: {
          rowNo: 1,
          erpItemCode: 'CCG075',
          productName: '錏輕型鋼',
          quantity: 1,
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: '第 2 項 EQB0090',
        payload: {
          rowNo: 2,
          erpItemCode: 'EQB0090',
          productName: '圓鐵',
          quantity: 3,
        },
      },
    ]);

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_4',
      turnIndex: 4,
      checkpointTurnIndex: 3,
      content: [
        '| 項次 | 數量 | 備註 |',
        '| --- | --- | --- |',
        '| 1 | 5 | 客戶改數量 |',
      ].join('\n'),
    });

    expect(result).toEqual({
      parseStatus: 'skipped',
      savedCounts: {},
    });
    await expect(reader.readWorkingOrderItems({ mode: 'page', pageSize: 10 })).resolves.toEqual(
      expect.objectContaining({
        resultCount: 2,
        workingOrderRows: expect.arrayContaining([
          expect.objectContaining({
            rowNo: 1,
            erpItemCode: 'CCG075',
            quantity: 1,
          }),
          expect.objectContaining({
            rowNo: 2,
            erpItemCode: 'EQB0090',
            quantity: 3,
          }),
        ]),
      }),
    );
    await expect(reader.readWorkingOrderItems({ mode: 'summary' })).resolves.toEqual(
      expect.objectContaining({
        summary: { working_order_row: 2 },
      }),
    );
  });

  it('skips customer and calculation Markdown tables without OCR or system titles', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_5',
      turnIndex: 5,
      checkpointTurnIndex: 4,
      content: [
        '| 客戶名稱 | 客戶代號 | 計價基準 |',
        '| --- | --- | --- |',
        '| 龍頂 | LD001 | B |',
        '',
        '| 項目 | 公式 | 小計 |',
        '| --- | --- | --- |',
        '| 第 1 項 | 4 * 6 * 26.8 | 643.2 |',
      ].join('\n'),
    });

    expect(result).toEqual({
      parseStatus: 'skipped',
      savedCounts: {},
    });
    await expect(
      SteelWorkingOrderMemory.countDocuments({
        conversationId: 'steel_conversation_1',
      }),
    ).resolves.toBe(0);
  });

  it('skips non-system quote tables while carrying existing sheets forward', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const outputReader = createMongooseSteelOutputSheetMemoryReader(mongoose, 'steel_conversation_1');

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'system row',
        payload: {
          rowNo: 10,
          erpItemCode: 'CCG075',
          productName: '錏輕型鋼',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'calculation_fact',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'old quote',
        payload: {
          項目: '第 10 項',
          小計: '100',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'calculation_fact',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'manual review',
        payload: {
          項目: '待確認',
          reason: '尺寸待確認',
        },
      },
    ]);

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_8',
      turnIndex: 8,
      checkpointTurnIndex: 7,
      content: [
        '| 項目 | 公式 | 小計 |',
        '| --- | --- | --- |',
        '| 第 10 項 | 2 * 26.8 | 53.6 |',
      ].join('\n'),
    });
    const snapshot = await outputReader.readOutputSheetMemory();

    expect(result).toEqual({
      parseStatus: 'skipped',
      savedCounts: {},
    });
    expect(snapshot.previousOutputSheets.system_order.rows).toHaveLength(1);
    expect(snapshot.previousOutputSheets.system_order.rows[0].cells).toEqual(
      expect.objectContaining({
        erpItemCode: 'CCG075',
      }),
    );
    expect(snapshot.previousOutputSheets.customer_quote.rows).toEqual([
      expect.objectContaining({
        cells: expect.objectContaining({
          小計: '100',
        }),
      }),
    ]);
    expect(snapshot.previousOutputSheets.manual_review.rows).toEqual([
      expect.objectContaining({
        cells: expect.objectContaining({
          reason: '尺寸待確認',
        }),
      }),
    ]);
  });

  it('skips unclassified Markdown tables without mutating active rows', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, 'steel_conversation_1');

    await SteelWorkingOrderMemory.create({
      conversationId: 'steel_conversation_1',
      turnIndex: 2,
      checkpointTurnIndex: 1,
      memoryKind: 'working_order_row',
      sourceKind: 'assistant_final_markdown',
      state: 'active',
      summary: '第 1 項 CCG075',
      payload: {
        rowNo: 1,
        erpItemCode: 'CCG075',
      },
    });

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_6',
      turnIndex: 6,
      checkpointTurnIndex: 5,
      content: [
        '| 說明 | 值 |',
        '| --- | --- |',
        '| 內部備註 | 需要人工確認 |',
      ].join('\n'),
    });

    expect(result).toEqual({
      parseStatus: 'skipped',
      savedCounts: {},
    });
    await expect(reader.readWorkingOrderItems({ mode: 'page', pageSize: 10 })).resolves.toEqual(
      expect.objectContaining({
        resultCount: 1,
        workingOrderRows: [expect.objectContaining({ erpItemCode: 'CCG075', rowNo: 1 })],
      }),
    );
    await expect(reader.readWorkingOrderItems({ mode: 'summary' })).resolves.toEqual(
      expect.objectContaining({
        summary: { working_order_row: 1 },
      }),
    );
  });

  it('captures assistant OCR Markdown as the current OCR extract', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const outputReader = createMongooseSteelOutputSheetMemoryReader(
      mongoose,
      'steel_conversation_1',
    );

    await SteelWorkingOrderMemory.create({
      conversationId: 'steel_conversation_1',
      turnIndex: 2,
      checkpointTurnIndex: 1,
      memoryKind: 'ocr_extract',
      sourceKind: 'assistant_final_markdown',
      state: 'active',
      summary: 'old OCR',
      payload: {
        markdown: '| 舊資料 |\\n| --- |\\n| should be replaced |',
      },
    });

    const ocrMarkdown = [
      '## OCR 結果確認表',
      '',
      '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 | 信心程度 | 是否需人工複核 |',
      '|---|---|---|---:|---:|---|---|',
      '| drawing.pdf | P1 | PL6*80*1000 | 4 | 8 | 高 | 否 |',
    ].join('\n');
    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_ocr_1',
      turnIndex: 8,
      checkpointTurnIndex: 7,
      content: ocrMarkdown,
    });
    const ocrEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      memoryKind: 'ocr_extract',
    }).lean();
    const snapshot = await outputReader.readOutputSheetMemory();

    expect(result).toEqual({
      parseStatus: 'saved',
      savedCounts: { ocr_extract: 1 },
      savedTableCounts: { ocr_table: 1 },
      totalSavedCounts: { ocr_extract: 1 },
      totalTableCounts: { ocr_table: 1 },
    });
    expect(ocrEntries).toHaveLength(1);
    expect(ocrEntries[0]).toEqual(
      expect.objectContaining({
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        payload: expect.objectContaining({
          kind: 'assistant_ocr_markdown',
          markdown: expect.stringContaining('PL6*80*1000'),
          tableIndex: 1,
        }),
        sourceRefs: [expect.objectContaining({ sourceId: 'assistant_ocr_1' })],
      }),
    );
    expect(snapshot.derivedIndex.ocrExtracts).toEqual([
      expect.objectContaining({
        markdown: expect.stringContaining('PL6*80*1000'),
      }),
    ]);
  });

  it('captures OCR tables when file-key metadata appears between the OCR heading and table', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_ocr_with_file_key_metadata',
      turnIndex: 8,
      checkpointTurnIndex: 7,
      currentTurnFiles: [
        {
          fileId: 'file-a',
          filename: 'a.jpg',
          mediaType: 'image/jpeg',
        },
      ],
      content: [
        'PaddleOCR MCP returned an error, so the assistant provided OCR fallback Markdown.',
        '',
        '## OCR result review table - a.jpg',
        'file key: `file:file-a`',
        '',
        '| 項次 | 來源 | 孔數 / 件 | 總孔數 | 低信心與複核原因 |',
        '|---:|---|---:|---:|---|',
        '| 1 | a.jpg | 0 | 0 | fallback review |',
      ].join('\n'),
    });
    const activeEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      memoryKind: 'ocr_extract',
      state: 'active',
    }).lean();

    expect(result).toEqual({
      parseStatus: 'saved',
      savedCounts: { ocr_extract: 1 },
      savedTableCounts: { ocr_table: 1 },
      totalSavedCounts: { ocr_extract: 1 },
      totalTableCounts: { ocr_table: 1 },
    });
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0]?.payload).toEqual(
      expect.objectContaining({
        kind: 'assistant_ocr_markdown',
        ocrFileKey: 'file:file-a',
        fileId: 'file-a',
        filename: 'a.jpg',
        mediaType: 'image/jpeg',
      }),
    );
  });

  it('keeps assistant OCR file-keyed but still missing for PaddleOCR preflight', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_ocr_1',
      turnIndex: 8,
      checkpointTurnIndex: 7,
      currentTurnFiles: [
        {
          fileId: 'file-ai-fallback',
          filename: 'fallback.pdf',
          mediaType: 'application/pdf',
        },
      ],
      content: [
        '## OCR 結果確認表',
        '',
        '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 | 信心程度 | 是否需人工複核 |',
        '|---|---|---|---:|---:|---|---|',
        '| fallback.pdf | P1 | PL6*80*1000 | 4 | 8 | 中 | 是 |',
      ].join('\n'),
    });
    const missing = await writer.findMissingPaddleOcrFileKeys({
      conversationId: 'steel_conversation_1',
      files: [
        {
          fileId: 'file-ai-fallback',
          filename: 'fallback.pdf',
          mediaType: 'application/pdf',
        },
      ],
    });
    const [entry] = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      memoryKind: 'ocr_extract',
    }).lean();

    expect(result).toEqual({
      parseStatus: 'saved',
      savedCounts: { ocr_extract: 1 },
      savedTableCounts: { ocr_table: 1 },
      totalSavedCounts: { ocr_extract: 1 },
      totalTableCounts: { ocr_table: 1 },
    });
    expect(entry).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          ocrFileKey: 'file:file-ai-fallback',
          fileId: 'file-ai-fallback',
          filename: 'fallback.pdf',
          mediaType: 'application/pdf',
          ocrSource: 'assistant_ocr',
          ocrEngine: 'assistant',
        }),
      }),
    );
    expect(missing).toEqual({
      completedKeys: [],
      missingFiles: [
        expect.objectContaining({
          ocrFileKey: 'file:file-ai-fallback',
          fileId: 'file-ai-fallback',
        }),
      ],
      missingKeys: ['file:file-ai-fallback'],
    });
  });

  it('finds only files without active PaddleOCR OCR', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'paddleocr_preflight',
        sourceKind: 'ocr_result',
        state: 'active',
        summary: 'PaddleOCR A',
        payload: {
          ocrFileKey: 'file:file-a',
          ocrSource: 'paddleocr_mcp',
          ocrEngine: 'paddleocr_vl',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 3,
        checkpointTurnIndex: 2,
        memoryKind: 'paddleocr_preflight',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: 'assistant B',
        payload: {
          ocrFileKey: 'file:file-b',
          ocrSource: 'assistant_ocr',
          ocrEngine: 'assistant',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 4,
        checkpointTurnIndex: 3,
        memoryKind: 'paddleocr_preflight',
        sourceKind: 'ocr_result',
        state: 'superseded',
        summary: 'old PaddleOCR C',
        payload: {
          ocrFileKey: 'file:file-c',
          ocrSource: 'paddleocr_mcp',
          ocrEngine: 'paddleocr_vl',
        },
      },
    ]);

    const result = await writer.findMissingPaddleOcrFileKeys({
      conversationId: 'steel_conversation_1',
      files: [
        { fileId: 'file-a', filename: 'a.pdf', mediaType: 'application/pdf' },
        { fileId: 'file-b', filename: 'b.png', mediaType: 'image/png' },
        { fileId: 'file-c', filename: 'c.pdf', mediaType: 'application/pdf' },
        { fileId: 'file-d', filename: 'd.txt', mediaType: 'text/plain' },
      ],
    });

    expect(result).toEqual({
      completedKeys: ['file:file-a'],
      missingFiles: [
        expect.objectContaining({ ocrFileKey: 'file:file-b', fileId: 'file-b' }),
        expect.objectContaining({ ocrFileKey: 'file:file-c', fileId: 'file-c' }),
      ],
      missingKeys: ['file:file-b', 'file:file-c'],
    });
  });

  it('does not treat fallback OCR rows as completed PaddleOCR preflight state', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await SteelWorkingOrderMemory.create({
      conversationId: 'steel_conversation_1',
      turnIndex: 3,
      checkpointTurnIndex: 2,
      memoryKind: 'paddleocr_preflight',
      sourceKind: 'assistant_final_markdown',
      state: 'active',
      summary: 'assistant fallback B',
      payload: {
        kind: 'assistant_ocr_markdown',
        ocrFileKey: 'file:file-b',
        fileId: 'file-b',
        filename: 'b.jpg',
        ocrSource: 'paddleocr_mcp',
        ocrEngine: 'assistant',
      },
    });

    const result = await writer.findMissingPaddleOcrFileKeys({
      conversationId: 'steel_conversation_1',
      files: [{ fileId: 'file-b', filename: 'b.jpg', mediaType: 'image/jpeg' }],
    });

    expect(result).toEqual({
      completedKeys: [],
      missingFiles: [expect.objectContaining({ ocrFileKey: 'file:file-b', fileId: 'file-b' })],
      missingKeys: ['file:file-b'],
    });
  });

  it('replaces PaddleOCR OCR only for the matching file key', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const outputReader = createMongooseSteelOutputSheetMemoryReader(
      mongoose,
      'steel_conversation_1',
    );

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'paddleocr_preflight',
        sourceKind: 'ocr_result',
        state: 'active',
        summary: 'old A',
        payload: {
          ocrFileKey: 'file:file-a',
          fileId: 'file-a',
          filename: 'a.pdf',
          ocrSource: 'paddleocr_mcp',
          ocrEngine: 'paddleocr_vl',
          text: 'old A',
        },
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'paddleocr_preflight',
        sourceKind: 'ocr_result',
        state: 'active',
        summary: 'current B',
        payload: {
          ocrFileKey: 'file:file-b',
          fileId: 'file-b',
          filename: 'b.pdf',
          ocrSource: 'paddleocr_mcp',
          ocrEngine: 'paddleocr_vl',
          text: 'current B',
        },
      },
    ]);

    const result = await writer.capturePaddleOcrResult({
      conversationId: 'steel_conversation_1',
      requestId: 'request_ocr',
      providerToolCallId: 'preflight_file_a',
      turnIndex: 5,
      checkpointTurnIndex: 4,
      file: {
        fileId: 'file-a',
        filename: 'a.pdf',
        mediaType: 'application/pdf',
      },
      data: {
        text: 'new A',
      },
    });
    const activeEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      memoryKind: 'paddleocr_preflight',
      state: 'active',
    })
      .sort({ 'payload.ocrFileKey': 1 })
      .lean();
    const snapshot = await outputReader.readOutputSheetMemory();

    expect(result).toEqual({
      savedCounts: { paddleocr_preflight: 1 },
      totalSavedCounts: { paddleocr_preflight: 2 },
      totalTableCounts: {},
    });
    expect(activeEntries).toHaveLength(2);
    expect(snapshot.derivedIndex.ocrExtracts).toEqual([]);
    expect(activeEntries).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          ocrFileKey: 'file:file-a',
          fileId: 'file-a',
          filename: 'a.pdf',
          mediaType: 'application/pdf',
          ocrSource: 'paddleocr_mcp',
          ocrEngine: 'paddleocr_vl',
          result: expect.objectContaining({ text: 'new A' }),
        }),
        sourceRefs: [
          expect.objectContaining({
            sourceKind: 'paddleocr_mcp',
            sourceId: 'preflight_file_a',
            ocrFileKey: 'file:file-a',
          }),
        ],
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          ocrFileKey: 'file:file-b',
          fileId: 'file-b',
          text: 'current B',
        }),
      }),
    ]);
  });

  it('does not save OCR confirmation helper tables as workbook state', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    const content = [
      '## OCR 結果確認表',
      '',
      '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 | 信心程度 | 是否需人工複核 |',
      '|---|---|---|---:|---:|---|---|',
      '| drawing.pdf | P1 | PL6*80*1000 | 4 | 8 | 高 | 否 |',
      '',
      '## 給使用者確認的 OCR 疑問',
      '',
      '| 項目 | OCR 判讀 | 備註 |',
      '| --- | --- | --- |',
      '| 1 | 5 | OCR 讀值待確認 |',
      '| 2 | 3 | 圖面文字模糊 |',
      '| 3 | 1 | 孔位需人工確認 |',
    ].join('\n');

    const result = await writer.captureAssistantFinalMarkdown({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_ocr_confirm',
      turnIndex: 9,
      checkpointTurnIndex: 8,
      content,
    });
    const activeEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      state: 'active',
    })
      .sort({ memoryKind: 1 })
      .lean();

    expect(result).toEqual({
      parseStatus: 'saved',
      savedCounts: { ocr_extract: 1 },
      savedTableCounts: { ocr_table: 1 },
      totalSavedCounts: { ocr_extract: 1 },
      totalTableCounts: { ocr_table: 1 },
    });
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0]).toEqual(
      expect.objectContaining({
        memoryKind: 'ocr_extract',
        payload: expect.objectContaining({
          kind: 'assistant_ocr_markdown',
          tableIndex: 1,
          rows: [['drawing.pdf', 'P1', 'PL6*80*1000', '4', '8', '高', '否']],
        }),
      }),
    );
  });

  it('skips malformed Markdown without saving memory or throwing', async () => {
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await expect(
      writer.captureAssistantFinalMarkdown({
        conversationId: 'steel_conversation_1',
        messageId: 'assistant_7',
        turnIndex: 7,
        checkpointTurnIndex: 6,
        content: '| 項次 | 型號 |\n| 1 | CCG075 |',
      }),
    ).resolves.toEqual({
      parseStatus: 'skipped',
      savedCounts: {},
    });
  });

  it('captures customer and price tool results as bounded memory entries', async () => {
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, 'steel_conversation_1');

    await expect(
      writer.captureToolResult({
        conversationId: 'steel_conversation_1',
        requestId: 'request_8',
        toolName: 'search_customers',
        providerToolCallId: 'call_customers',
        turnIndex: 8,
        checkpointTurnIndex: 7,
        data: {
          customers: [
            {
              id: 21,
              erpCustomerCode: 'LD001',
              displayName: '龍頂',
              customerTier: { id: 2, code: 'B', name: 'B級' },
              sourceRefs: [{ channel: 'customer', factType: 'customer', locator: 'row:21' }],
            },
          ],
        },
      }),
    ).resolves.toEqual({
      savedCounts: { customer_fact: 1 },
      totalSavedCounts: { customer_fact: 1 },
      totalTableCounts: {},
    });
    await expect(
      writer.captureToolResult({
        conversationId: 'steel_conversation_1',
        requestId: 'request_8',
        toolName: 'search_price_candidates',
        providerToolCallId: 'call_price',
        turnIndex: 8,
        checkpointTurnIndex: 7,
        data: {
          customerTierId: 2,
          searchQueries: ['CCG075'],
          priceCandidates: [
            {
              id: 10,
              erpItemCode: 'CCG075',
              productName: '錏輕型鋼',
              specKey: '75x45',
              unitPrice: 26.8,
              sourceRefs: [{ channel: 'price', factType: 'price', locator: 'row:10' }],
            },
          ],
        },
      }),
    ).resolves.toEqual({
      savedCounts: { price_evidence: 1 },
      totalSavedCounts: { customer_fact: 1, price_evidence: 1 },
      totalTableCounts: {},
    });
    await expect(reader.readWorkingOrderItems({ mode: 'summary' })).resolves.toEqual(
      expect.objectContaining({
        summary: {
          customer_fact: 1,
          price_evidence: 1,
        },
        memoryEntries: expect.arrayContaining([
          expect.objectContaining({ memoryKind: 'customer_fact', summary: expect.stringContaining('龍頂') }),
          expect.objectContaining({ memoryKind: 'price_evidence', summary: expect.stringContaining('CCG075') }),
        ]),
      }),
    );
  });

  it('ignores removed run_file_ocr tool results without deleting current OCR Markdown', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await SteelWorkingOrderMemory.create({
      conversationId: 'steel_conversation_1',
      turnIndex: 2,
      checkpointTurnIndex: 1,
      memoryKind: 'ocr_extract',
      sourceKind: 'assistant_final_markdown',
      state: 'active',
      summary: 'current OCR Markdown',
      payload: {
        markdown: '| 來源檔案 |\n| --- |\n| current.pdf |',
      },
    });

    await expect(writer.captureToolResult({
      conversationId: 'steel_conversation_1',
      requestId: 'request_ocr_2',
      toolName: 'run_file_ocr',
      providerToolCallId: 'call_ocr_2',
      turnIndex: 4,
      checkpointTurnIndex: 3,
      data: {
        filename: 'second.pdf',
        pageResults: [{ page: 2, text: 'second' }],
      },
    })).resolves.toEqual({ savedCounts: {} });

    const ocrEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      memoryKind: 'ocr_extract',
    }).lean();

    expect(ocrEntries).toHaveLength(1);
    expect(ocrEntries[0]).toEqual(
      expect.objectContaining({
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        payload: expect.objectContaining({
          markdown: expect.stringContaining('current.pdf'),
        }),
      }),
    );
  });
});
