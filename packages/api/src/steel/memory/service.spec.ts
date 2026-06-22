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
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 01 | 1 | A | CCG075 | 錏輕型鋼 75x45x15x2.3 |  |  | 支 | 2 | 4 | 8 | 26.8 | B | F1 | 2.3 | 75 | 6000 | C型鋼 |  | 已採用價格列 |',
        '| 01 | 2 | A | EQB0090 | 圓鐵 9m/m |  |  | 支 | 3 |  |  | 18 | B | F2 |  |  | 6000 | 圓鐵 |  | 待確認 |',
      ].join('\n'),
    });

    expect(result).toEqual({
      parseStatus: 'saved',
      savedCounts: { working_order_row: 2 },
    });
    await expect(reader.readWorkingOrderItems({ mode: 'page', pageSize: 10 })).resolves.toEqual(
      expect.objectContaining({
        resultCount: 2,
        workingOrderRows: [
          expect.objectContaining({
            rowNo: 1,
            erpItemCode: 'CCG075',
            productName: '錏輕型鋼 75x45x15x2.3',
            quantity: 2,
          }),
          expect.objectContaining({
            rowNo: 2,
            erpItemCode: 'EQB0090',
            productName: '圓鐵 9m/m',
            quantity: 3,
          }),
        ],
      }),
    );

    const superseded = await SteelWorkingOrderMemory.findOne({
      conversationId: 'steel_conversation_1',
      state: 'superseded',
      'payload.erpItemCode': 'OLD001',
    }).lean();
    expect(superseded).toEqual(
      expect.objectContaining({
        supersededByMessageId: 'assistant_4',
      }),
    );
  });

  it('merges row-change Markdown by item number without replacing unrelated rows', async () => {
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
      parseStatus: 'saved',
      savedCounts: { working_order_row: 1 },
    });
    await expect(reader.readWorkingOrderItems({ mode: 'page', pageSize: 10 })).resolves.toEqual(
      expect.objectContaining({
        resultCount: 2,
        workingOrderRows: [
          expect.objectContaining({
            rowNo: 2,
            erpItemCode: 'EQB0090',
            quantity: 3,
          }),
          expect.objectContaining({
            rowNo: 1,
            erpItemCode: 'CCG075',
            quantity: 5,
            備註: '客戶改數量',
          }),
        ],
      }),
    );
  });

  it('captures customer and calculation facts from final Markdown tables', async () => {
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, 'steel_conversation_1');

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
      parseStatus: 'saved',
      savedCounts: {
        calculation_fact: 1,
        customer_fact: 1,
        working_order_row: 0,
      },
    });
    await expect(reader.readWorkingOrderItems({ mode: 'summary' })).resolves.toEqual(
      expect.objectContaining({
        summary: { calculation_fact: 1, customer_fact: 1 },
        memoryEntries: expect.arrayContaining([
          expect.objectContaining({
            memoryKind: 'customer_fact',
            summary: expect.stringContaining('龍頂'),
          }),
          expect.objectContaining({
            memoryKind: 'calculation_fact',
            summary: expect.stringContaining('第 1 項'),
          }),
        ]),
      }),
    );
  });

  it('stores unclassified Markdown tables without mutating active rows', async () => {
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
      parseStatus: 'partial',
      savedCounts: { calculation_fact: 1, working_order_row: 0 },
    });
    await expect(reader.readWorkingOrderItems({ mode: 'page', pageSize: 10 })).resolves.toEqual(
      expect.objectContaining({
        resultCount: 1,
        workingOrderRows: [expect.objectContaining({ erpItemCode: 'CCG075', rowNo: 1 })],
      }),
    );
    await expect(reader.readWorkingOrderItems({ mode: 'summary' })).resolves.toEqual(
      expect.objectContaining({
        summary: { calculation_fact: 1, working_order_row: 1 },
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

  it('captures customer, price, rule, and OCR tool results as bounded memory entries', async () => {
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
    ).resolves.toEqual({ savedCounts: { customer_fact: 1 } });
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
    ).resolves.toEqual({ savedCounts: { price_evidence: 1 } });
    await expect(
      writer.captureToolResult({
        conversationId: 'steel_conversation_1',
        requestId: 'request_8',
        toolName: 'lookup_quote_rules',
        providerToolCallId: 'call_rules',
        turnIndex: 8,
        checkpointTurnIndex: 7,
        data: {
          rules: [{ slug: 'steel-rule', summary: '用 B tier' }],
        },
      }),
    ).resolves.toEqual({ savedCounts: { rule_evidence: 1 } });
    await expect(
      writer.captureToolResult({
        conversationId: 'steel_conversation_1',
        requestId: 'request_8',
        toolName: 'run_file_ocr',
        providerToolCallId: 'call_ocr',
        turnIndex: 8,
        checkpointTurnIndex: 7,
        data: {
          filename: 'a.pdf',
          pageResults: [
            {
              page: 1,
              text: 'A'.repeat(9000),
              tableBlocks: [{ text: '尺寸 75x45' }],
            },
          ],
        },
      }),
    ).resolves.toEqual({ savedCounts: { ocr_extract: 1 } });

    await expect(reader.readWorkingOrderItems({ mode: 'summary' })).resolves.toEqual(
      expect.objectContaining({
        summary: {
          customer_fact: 1,
          price_evidence: 1,
          rule_evidence: 1,
          ocr_extract: 1,
        },
        memoryEntries: expect.arrayContaining([
          expect.objectContaining({ memoryKind: 'customer_fact', summary: expect.stringContaining('龍頂') }),
          expect.objectContaining({ memoryKind: 'price_evidence', summary: expect.stringContaining('CCG075') }),
          expect.objectContaining({ memoryKind: 'rule_evidence', summary: expect.stringContaining('steel-rule') }),
          expect.objectContaining({
            memoryKind: 'ocr_extract',
            sourceRefs: [expect.objectContaining({ filename: 'a.pdf', pageNumber: 1 })],
          }),
        ]),
      }),
    );

    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const ocrEntry = await SteelWorkingOrderMemory.findOne({
      conversationId: 'steel_conversation_1',
      memoryKind: 'ocr_extract',
    }).lean();
    expect(JSON.stringify(ocrEntry?.payload).length).toBeLessThan(5000);
  });
});
