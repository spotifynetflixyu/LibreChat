import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSteelWorkingOrderMemoryModel } from '@librechat/data-schemas';

import { createMongooseSteelWorkingOrderMemoryWriter } from './service';

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

describe('Steel working-order memory writer', () => {
  it('retains customer facts and price evidence with a query reference', async () => {
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await expect(
      writer.captureToolResult({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        providerToolCallId: 'call_customer',
        toolName: 'search_customers',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        data: {
          customers: [
            {
              id: 21,
              displayName: '龍頂',
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
        conversationId: 'conversation_1',
        requestId: 'request_2',
        providerToolCallId: 'call_price',
        toolName: 'search_price_candidates',
        turnIndex: 3,
        checkpointTurnIndex: 2,
        data: {
          queryResults: [
            {
              queryId: 'q1',
              candidates: [
                {
                  id: 10,
                  productName: '錏輕型鋼',
                  sourceRefs: [{ channel: 'price', factType: 'price', locator: 'row:10' }],
                },
              ],
            },
          ],
        },
      }),
    ).resolves.toEqual({
      savedCounts: { price_evidence: 1 },
      totalSavedCounts: { customer_fact: 1, price_evidence: 1 },
      totalTableCounts: {},
    });

    const document = await SteelWorkingOrderMemory.findOne({ memoryKind: 'price_evidence' }).lean();
    expect(document?.payload).toEqual(
      expect.objectContaining({
        productName: '錏輕型鋼',
        queryRef: { providerToolCallId: 'call_price', queryId: 'q1' },
      }),
    );
    expect(document?.payload).not.toHaveProperty('searchQuery');
    expect(document?.sourceRefs).toEqual([
      expect.objectContaining({ sourceKind: 'price:price', sourceId: 'call_price' }),
    ]);
  });

  it('does not create price evidence without a provider call id', async () => {
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await expect(
      writer.captureToolResult({
        conversationId: 'conversation_1',
        toolName: 'search_price_candidates',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        data: {
          queryResults: [{ queryId: 'q1', candidates: [{ id: 1 }] }],
        },
      }),
    ).resolves.toEqual({ savedCounts: {} });
  });

  it('does not create price evidence without a query id', async () => {
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);

    await expect(
      writer.captureToolResult({
        conversationId: 'conversation_1',
        providerToolCallId: 'call_price',
        toolName: 'search_price_candidates',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        data: { queryResults: [{ candidates: [{ id: 1 }] }] },
      }),
    ).resolves.toEqual({ savedCounts: {} });
  });

  it('preserves raw PaddleOCR and organized chunk Markdown resume state', async () => {
    const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    const file = {
      fileId: 'file-a',
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
    };
    const chunk = {
      sourcePdfKey: 'pdf-a',
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 2,
      pdfChunk: {
        source: 's3' as const,
        storageKey: 'chunks/a.pdf',
        filepath: '/tmp/a.pdf',
      },
    };

    await expect(
      writer.capturePaddleOcrChunkResult({
        conversationId: 'conversation_ocr',
        providerToolCallId: 'call_ocr',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        file,
        chunk,
        rawResultHash: 'hash-a',
        data: { text: 'raw OCR text' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ savedCounts: { paddleocr_preflight: 1 } }),
    );

    await expect(
      writer.captureOcrPreprocessingChunkMarkdown({
        conversationId: 'conversation_ocr',
        requestId: 'request_ocr',
        turnIndex: 3,
        checkpointTurnIndex: 2,
        file,
        chunk,
        rawResultHash: 'hash-a',
        ocrRuleVersion: 'rules-v1',
        content: '| 型號 |\n| --- |\n| A |',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ savedCounts: { ocr_preprocessing_chunk_markdown: 1 } }),
    );

    await expect(
      writer.readOcrPreprocessingState({
        conversationId: 'conversation_ocr',
        sourcePdfKey: 'pdf-a',
        ocrFileKey: 'file:file-a',
        ocrRuleVersion: 'rules-v1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        chunkCount: 1,
        chunks: [
          expect.objectContaining({
            rawSaved: true,
            organizedSaved: true,
            organizedMarkdown: '| 型號 |\n| --- |\n| A |',
          }),
        ],
      }),
    );
  });
});
