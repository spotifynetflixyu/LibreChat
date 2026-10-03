import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSteelConversationOcrStateModel, createSteelReviewOutputModel } from '~/models/steel';
import { createSteelReviewReadMethods } from './steelReview';
import { createModels } from '~/models';

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

describe('Steel review read methods', () => {
  it('authorizes the message scope and returns the trusted current OCR owner', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P-1 |',
    ].join('\n');
    await models.Message.create({
      messageId: 'assistant-1',
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      isCreatedByUser: false,
      text: [
        '| ordinary | table |',
        '| --- | --- |',
        '| ignored | row |',
        '',
        markdown,
      ].join('\n'),
    });
    await models.Conversation.create({
      conversationId: 'conversation-1',
      user: 'user-1',
      tenantId: 'tenant-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await State.create({
      conversationId: 'conversation-1',
      sourceMappings: [{
        fileId: 'file-1',
        sourceCode: 'A',
        sourceFilename: 'drawing.pdf',
      }],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'assistant-1',
      currentOcrResultGenerationId: 'generation-1',
    });

    const record = await read.readSteelReview({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'assistant-1',
      tableId: 'ocr_result:2',
    });

    expect(record).toEqual(expect.objectContaining({
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      state: 'current',
      messageText: expect.stringContaining('| ordinary | table |'),
    }));
    expect(await read.readSteelReview({
      userId: 'other-user',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'assistant-1',
      tableId: 'ocr_result:2',
    })).toBeNull();
  });

  it('reads an explicitly owned historical sidecar without writing a message', async () => {
    const models = createModels(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    await models.Message.create({
      messageId: 'assistant-history',
      conversationId: 'conversation-history',
      user: 'user-1',
      isCreatedByUser: false,
      text: '## ocr_result',
    });
    await models.Conversation.create({
      conversationId: 'conversation-history',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await ReviewOutput.create({
      userId: 'user-1',
      conversationId: 'conversation-history',
      kind: 'ocr_result',
      messageId: 'assistant-history',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:old',
      revision: 'old-revision',
      state: 'historical',
      latestOutputId: 'ocr_result:new',
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
    });
    const before = await models.Message.countDocuments();
    const record = await read.readSteelReview({
      userId: 'user-1',
      conversationId: 'conversation-history',
      kind: 'ocr_result',
      messageId: 'assistant-history',
      tableId: 'ocr_result:1',
    });

    expect(record).toEqual(expect.objectContaining({
      outputId: 'ocr_result:old',
      state: 'historical',
      latestOutputId: 'ocr_result:new',
      rows: expect.arrayContaining([expect.objectContaining({
        values: expect.objectContaining({
          '零件編號': { baseline: 'P-1', effective: 'P-1' },
        }),
      })]),
    }));
    expect(await models.Message.countDocuments()).toBe(before);
  });

  it('rejects a message whose conversation is missing or expired', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    await models.Message.create({
      messageId: 'orphan-message',
      conversationId: 'orphan-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: '## ocr_result',
    });
    await State.create({
      conversationId: 'orphan-conversation',
      currentOcrResultMarkdown: '## ocr_result',
      currentOcrResultMessageId: 'orphan-message',
      currentOcrResultGenerationId: 'generation-1',
      sourceMappings: [],
    });
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'orphan-conversation',
      kind: 'ocr_result',
      messageId: 'orphan-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();

    await models.Conversation.create({
      conversationId: 'expired-conversation',
      user: 'user-1',
      expiredAt: new Date(Date.now() - 60_000),
      title: 'Expired',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'expired-message',
      conversationId: 'expired-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: '## ocr_result',
    });
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'expired-conversation',
      kind: 'ocr_result',
      messageId: 'expired-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
  });
});
