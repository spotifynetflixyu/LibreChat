import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createSteelConversationOcrStateModel,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '~/models/steel';
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
      content: [{
        type: 'text',
        text: [
          '| ordinary | table |',
          '| --- | --- |',
          '| ignored | row |',
          '',
          markdown,
        ].join('\n'),
      }],
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
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    await models.Message.create({
      messageId: 'assistant-history',
      conversationId: 'conversation-history',
      user: 'user-1',
      isCreatedByUser: false,
      text: '## ocr_result',
      content: [{ type: 'text', text: '## ocr_result' }],
    });
    await models.Conversation.create({
      conversationId: 'conversation-history',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await State.create({
      conversationId: 'conversation-history',
      sourceMappings: [],
      currentOcrResultMessageId: 'current-message',
      currentOcrResultGenerationId: 'new',
      currentOcrResultMarkdown: '## ocr_result',
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

  it('derives sidecar latest status from the same-kind canonical owner', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const oldMarkdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | OLD |';
    const currentMarkdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | CURRENT |';
    await models.Conversation.create({
      conversationId: 'sidecar-current-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'sidecar-old-message',
      conversationId: 'sidecar-current-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: oldMarkdown,
      content: [{ type: 'text', text: oldMarkdown }],
    });
    await models.Message.create({
      messageId: 'sidecar-current-message',
      conversationId: 'sidecar-current-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: currentMarkdown,
      content: [{ type: 'text', text: currentMarkdown }],
    });
    await State.create({
      conversationId: 'sidecar-current-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: currentMarkdown,
      currentOcrResultMessageId: 'sidecar-current-message',
      currentOcrResultGenerationId: 'generation-current',
    });
    await ReviewOutput.create({
      userId: 'user-1',
      conversationId: 'sidecar-current-conversation',
      kind: 'ocr_result',
      messageId: 'sidecar-old-message',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:old-sidecar',
      revision: 'old-revision',
      state: 'current',
      latestOutputId: 'ocr_result:old-sidecar',
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-old',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'OLD', effective: 'OLD' },
        },
        source: null,
      }],
    });

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'sidecar-current-conversation',
      kind: 'ocr_result',
      messageId: 'sidecar-old-message',
      tableId: 'ocr_result:1',
    })).resolves.toEqual(expect.objectContaining({
      outputId: 'ocr_result:old-sidecar',
      latestOutputId: 'ocr_result:generation-current',
      state: 'current',
    }));
  });

  it('reads a published historical system order from its owned quotation run artifact', async () => {
    const models = createModels(mongoose);
    const QuotationState = createSteelQuotationStateModel(mongoose);
    const QuotationArtifact = createSteelQuotationArtifactModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = [
      '## system_order',
      '',
      '| 類別 | 零件編號 | 數量 |',
      '| --- | --- | --- |',
      '| 材料 | P-1 | 2 |',
    ].join('\n');
    const finalPayload = `${markdown}\n\n## quote_summary\n\n完成`;
    const finalSha256 = createHash('sha256').update(finalPayload).digest('hex');
    await models.Conversation.create({
      conversationId: 'historical-order-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'historical-order-message',
      conversationId: 'historical-order-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: finalPayload,
      content: [{ type: 'text', text: finalPayload }],
    });
    await QuotationState.create({
      userId: 'user-1',
      conversationId: 'historical-order-conversation',
      currentSystemOrder: {
        runId: 'run-current',
        sha256: 'current-revision',
        markdown,
        messageId: 'current-order-message',
        updatedAt: new Date(),
      },
      nextSignalIndex: 2,
      tickets: [{
        index: 1,
        token: 'ticket-token',
        orderHash: 'order-hash',
        customerMarkdown: 'customer',
        customerIdentity: 'customer-id',
        triggeringMessageId: 'trigger-message',
        selectionProvenance: { method: 'unique' },
        issuedAt: new Date(),
        responseId: 'historical-order-message',
        acceptedRunId: 'run-old',
      }],
      pendingMessages: [],
    });
    await QuotationArtifact.create([
      {
        userId: 'user-1',
        conversationId: 'historical-order-conversation',
        runId: 'run-old',
        operationId: 'final',
        kind: 'final',
        sha256: finalSha256,
        payload: finalPayload,
      },
      {
        userId: 'user-1',
        conversationId: 'historical-order-conversation',
        runId: 'run-old',
        operationId: 'published',
        kind: 'final',
        sha256: createHash('sha256').update(JSON.stringify({ finalSha256 })).digest('hex'),
        payload: JSON.stringify({ finalSha256 }),
      },
      {
        userId: 'user-1',
        conversationId: 'historical-order-conversation',
        runId: 'run-old',
        operationId: 'archive',
        kind: 'archive',
        sha256: createHash('sha256').update(JSON.stringify({
          run: { runId: 'run-old', status: 'completed', targetMessageId: 'historical-order-message' },
        })).digest('hex'),
        payload: JSON.stringify({
          run: { runId: 'run-old', status: 'completed', targetMessageId: 'historical-order-message' },
        }),
      },
    ]);

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'historical-order-conversation',
      kind: 'system_order',
      messageId: 'historical-order-message',
      tableId: 'system_order:1',
    })).resolves.toEqual(expect.objectContaining({
      outputId: 'system_order:run-old',
      revision: finalSha256,
      state: 'historical',
      latestOutputId: 'system_order:run-current',
      messageText: finalPayload,
    }));
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
      content: [{ type: 'text', text: '## ocr_result' }],
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

  it('rejects a stale or ambiguous rendered content mirror', async () => {
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
    await models.Conversation.create({
      conversationId: 'mirror-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await State.create({
      conversationId: 'mirror-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'mirror-message',
      currentOcrResultGenerationId: 'generation-1',
    });
    await models.Message.create({
      messageId: 'mirror-message',
      conversationId: 'mirror-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: markdown,
      content: [{ type: 'text', text: markdown.replace('P-1', 'P-2') }],
    });
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'mirror-conversation',
      kind: 'ocr_result',
      messageId: 'mirror-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();

    await models.Message.updateOne(
      { messageId: 'mirror-message' },
      { $set: { content: [{ type: 'text', text: markdown }, { type: 'text', text: markdown }] } },
    );
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'mirror-conversation',
      kind: 'ocr_result',
      messageId: 'mirror-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
  });

  it('reads a selected rendered part without combining unrelated text parts', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const firstPart = '| ordinary | table |\n| --- | --- |\n| keep | this |';
    const secondPart = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    await models.Conversation.create({
      conversationId: 'multi-part-conversation',
      user: 'user-1',
      title: 'Review',
      endpoint: 'openAI',
    });
    await models.Message.create({
      messageId: 'multi-part-message',
      conversationId: 'multi-part-conversation',
      user: 'user-1',
      isCreatedByUser: false,
      text: `${firstPart} ${secondPart}`,
      content: [{ type: 'text', text: firstPart }, { type: 'text', text: secondPart }],
    });
    await State.create({
      conversationId: 'multi-part-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: secondPart,
      currentOcrResultMessageId: 'multi-part-message',
      currentOcrResultGenerationId: 'generation-multi-part',
    });

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'multi-part-conversation',
      kind: 'ocr_result',
      messageId: 'multi-part-message',
      tableId: 'ocr_result:2',
    })).resolves.toEqual(expect.objectContaining({
      messageTextParts: [
        { partIndex: 0, text: firstPart },
        { partIndex: 1, text: secondPart },
      ],
      messageTextPartIndex: undefined,
    }));
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'multi-part-conversation',
      kind: 'ocr_result',
      messageId: 'multi-part-message',
      tableId: 'ocr_result:2',
      partIndex: 1,
    })).resolves.toEqual(expect.objectContaining({
      messageText: secondPart,
      messageTextPartIndex: 1,
      messageTextParts: [{ partIndex: 0, text: firstPart }, { partIndex: 1, text: secondPart }],
    }));
  });

  it('keeps tenantless reads isolated from tenant-owned messages and sidecars', async () => {
    const models = createModels(mongoose);
    const State = createSteelConversationOcrStateModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const read = createSteelReviewReadMethods(mongoose);
    const markdown = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| A | P-1 |';
    await models.Conversation.create([
      { conversationId: 'tenant-conversation', user: 'user-1', tenantId: 'tenant-a', title: 'Review', endpoint: 'openAI' },
      { conversationId: 'tenantless-conversation', user: 'user-1', title: 'Review', endpoint: 'openAI' },
    ]);
    await models.Message.create([
      {
        messageId: 'tenant-message',
        conversationId: 'tenant-conversation',
        user: 'user-1',
        tenantId: 'tenant-a',
        isCreatedByUser: false,
        text: markdown,
        content: [{ type: 'text', text: markdown }],
      },
      {
        messageId: 'tenantless-message',
        conversationId: 'tenantless-conversation',
        user: 'user-1',
        isCreatedByUser: false,
        text: markdown,
        content: [{ type: 'text', text: markdown }],
      },
    ]);
    await State.create({
      conversationId: 'tenant-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'tenant-message',
      currentOcrResultGenerationId: 'generation-tenant',
    });
    await State.create({
      conversationId: 'tenantless-conversation',
      sourceMappings: [],
      currentOcrResultMarkdown: markdown,
      currentOcrResultMessageId: 'tenantless-message',
      currentOcrResultGenerationId: 'generation-tenantless',
    });
    await ReviewOutput.create({
      userId: 'user-1',
      tenantId: 'tenant-a',
      conversationId: 'tenant-conversation',
      kind: 'ocr_result',
      messageId: 'tenant-message',
      tableId: 'ocr_result:1',
      outputId: 'tenant-output',
      revision: 'tenant-revision',
      state: 'current',
      headers: ['來源', '零件編號'],
      rows: [],
    });

    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'tenant-conversation',
      kind: 'ocr_result',
      messageId: 'tenant-message',
      tableId: 'ocr_result:1',
    })).resolves.toBeNull();
    await expect(read.readSteelReview({
      userId: 'user-1',
      tenantId: 'tenant-a',
      conversationId: 'tenant-conversation',
      kind: 'ocr_result',
      messageId: 'tenant-message',
      tableId: 'ocr_result:1',
    })).resolves.toEqual(expect.objectContaining({
      outputId: 'tenant-output',
      latestOutputId: 'ocr_result:generation-tenant',
    }));
    await expect(read.readSteelReview({
      userId: 'user-1',
      conversationId: 'tenantless-conversation',
      kind: 'ocr_result',
      messageId: 'tenantless-message',
      tableId: 'ocr_result:1',
    })).resolves.toEqual(expect.objectContaining({ outputId: 'ocr_result:generation-tenantless' }));
  });
});
