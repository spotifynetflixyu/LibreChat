import mongoose from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  createModels,
  createMethods,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewOutputModel,
} from '..';
import type { SteelReviewMetadata } from 'librechat-data-provider';
import type { SteelQuotationPublicationProof } from '~/types';

let mongoServer: MongoMemoryReplSet;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  createModels(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('guarded Steel quotation publication', () => {
  it.each([false, true])('saves the message, receipt and cleanup atomically (retry cleanup failure: %s)', async (failCleanup) => {
    const userId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const runId = randomUUID();
    const order = '## system_order\n\n| 品名 | 總數 | 單價 |\n| --- | --- | --- |\n| A | 2 | 10 |';
    const finalMarkdown = `${order}\n\n## quote_summary\n\n完成`;
    const currentOrderSha256 = sha256('## ocr_result\n\nsource');
    const currentSystemOrderSha256 = sha256(order);
    const finalSha256 = sha256(finalMarkdown);
    const preparationId = randomUUID();
    const customerMarkdown = '## customer_data\n\n| 價格等級 |\n| --- |\n| B |';
    const reviewMetadata: SteelReviewMetadata = {
      version: 1, initialized: true,
      lineage: { runId, outputId: `system_order:${runId}`, revision: runId, messageId,
        ocrOutputId: 'ocr_result:original', ocrRevision: 'original', ocrHash: sha256('original') },
      ocrContext: { title: 'ocr_result', outputId: 'ocr_result:original', revision: 'original',
        headers: ['零件編號'], rows: [{ rowId: 'ocr-original-row', source: null,
          values: { 零件編號: { baseline: 'P1', effective: 'P1' } } }] },
      rows: [{ rowId: 'system-original-row', source: null,
        values: { 品名: { baseline: 'A', effective: 'A' }, 總數: { baseline: '2', effective: '2' }, 單價: { baseline: '10', effective: '10' } } }],
    };
    const proof: SteelQuotationPublicationProof = {
      scope: { userId, conversationId },
      runId,
      runTargetMessageId: messageId,
      targetMessageId: messageId,
      finalSha256,
      reviewBaseline: { kind: 'system_order', title: 'system_order', outputId: `system_order:${runId}`,
        revision: runId, baselineMarkdown: order, headers: ['品名', '總數', '單價'], rows: reviewMetadata.rows, sourceMappings: [] },
      currentOrderSha256,
      currentSystemOrderSha256,
      saveContext: { isTemporary: true, expiredAt: new Date('2026-10-05T00:00:00.000Z') },
      customer: { preparationId, customerIdentity: 'customer:B', customerMarkdown },
      message: {
        messageId,
        conversationId,
        text: order,
        user: userId,
        content: [{ type: 'text', text: order }],
        isCreatedByUser: false,
      },
    };
    const Models = mongoose.models as typeof mongoose.models & {
      Conversation: mongoose.Model<Record<string, unknown>>;
      Message: mongoose.Model<Record<string, unknown>>;
    };
    await Models.Conversation.create({ conversationId, user: userId, title: 'quotation', endpoint: 'openAI' });
    await Models.Message.create({ messageId, conversationId, user: userId, text: 'partial', unfinished: true });
    const State = createSteelQuotationStateModel(mongoose);
    await State.create({
      userId,
      conversationId,
      nextSignalIndex: 1,
      currentOrder: { markdown: '## ocr_result\n\nsource', sha256: currentOrderSha256 },
      currentCustomer: {
        preparationId,
        customerMarkdown,
        customerIdentity: 'customer:B',
        triggeringMessageId: randomUUID(),
        responseId: randomUUID(),
        selectionProvenance: { method: 'default_tier' },
      },
      currentSystemOrder: { runId, sha256: currentSystemOrderSha256, markdown: order, messageId, reviewMetadata, updatedAt: new Date() },
      tickets: [],
      pendingMessages: [],
      activeRun: {
        runId,
        index: 1,
        status: 'completed',
        triggerMessageId: randomUUID(),
        targetMessageId: messageId,
        snapshotRef: { artifactId: `${runId}:snapshot:x`, userId, conversationId, runId, operationId: 'snapshot', kind: 'snapshot', sha256: currentOrderSha256 },
        chunks: [],
        checkpointRefs: [{ operationId: 'final', kind: 'final', artifactId: `${runId}:final:${finalSha256}`, sha256: finalSha256, updatedAt: new Date() }],
        acceptedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    await Artifact.create({ userId, conversationId, runId, operationId: 'final', kind: 'final', sha256: finalSha256, payload: finalMarkdown });

    await Artifact.create({ userId, conversationId, runId, operationId: 'snapshot', kind: 'snapshot',
      sha256: currentOrderSha256, payload: '## ocr_result\n\nsource' });
    if (failCleanup) {
      const cleanup = jest.spyOn(Artifact.collection, 'deleteOne').mockRejectedValueOnce(new Error('cleanup unavailable'));
      try {
        await expect(createMethods(mongoose).saveSteelQuotationMessage(proof)).rejects.toThrow('cleanup unavailable');
        expect((await Models.Message.findOne({ messageId }).lean())?.text).toBe('partial');
        expect(await Artifact.exists({ userId, conversationId, runId, operationId: 'published' })).toBeNull();
        expect(await Artifact.exists({ userId, conversationId, runId, operationId: 'snapshot' })).not.toBeNull();
      } finally {
        cleanup.mockRestore();
      }
    }
    const result = await createMethods(mongoose).saveSteelQuotationMessage(proof);
    expect(await Artifact.exists({ userId, conversationId, runId, operationId: 'snapshot' })).toBeNull();

    expect(result.ok).toBe(true);
    const Output = createSteelReviewOutputModel(mongoose);
    expect((await Output.findOne({ userId, conversationId, outputId: `system_order:${runId}` }).lean())?.reviewMetadata)
      .toEqual(reviewMetadata);
    await State.updateOne({ userId, conversationId }, { $set: { 'currentSystemOrder.reviewMetadata.ocrContext.rows.0.values.零件編號.effective': 'changed-later' } });
    expect((await Output.findOne({ userId, conversationId, outputId: `system_order:${runId}` }).lean())?.reviewMetadata?.ocrContext?.rows[0].values.零件編號.effective)
      .toBe('P1');
    expect((await Models.Message.findOne({ messageId }).lean())).toEqual(expect.objectContaining({
      text: order,
      user: userId,
      isTemporary: true,
      expiredAt: new Date('2026-10-05T00:00:00.000Z'),
    }));
    expect((await State.findOne({ userId, conversationId }).lean())?.activeRun?.checkpointRefs)
      .toEqual(expect.arrayContaining([expect.objectContaining({ operationId: 'published' })]));
    expect(await Artifact.findOne({ userId, conversationId, runId, operationId: 'published' }).lean())
      .toEqual(expect.objectContaining({ payload: JSON.stringify({ finalSha256 }) }));
  });

  it('returns superseded without changing the target when the captured order hash is stale', async () => {
    const methods = createMethods(mongoose);
    const userId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const result = await methods.saveSteelQuotationMessage({
      scope: { userId, conversationId },
      runId: randomUUID(),
      runTargetMessageId: messageId,
      targetMessageId: messageId,
      finalSha256: sha256('final'),
      currentOrderSha256: sha256('order'),
      currentSystemOrderSha256: sha256('system'),
      customer: { preparationId: randomUUID(), customerIdentity: 'customer:B', customerMarkdown: 'customer' },
      message: { messageId, conversationId, text: 'stale', user: userId },
    });
    expect(result).toEqual({ ok: false, code: 'superseded' });
  });

  it('guards a revised current message separately from the completed run target', async () => {
    const userId = randomUUID();
    const conversationId = randomUUID();
    const runTargetMessageId = randomUUID();
    const targetMessageId = randomUUID();
    const runId = randomUUID();
    const order = '## system_order\n\n| 品名 | 總數 | 單價 |\n| --- | --- | --- |\n| A | 2 | 10 |';
    const finalMarkdown = `${order}\n\n## quote_summary\n\n完成`;
    const currentOrderSha256 = sha256('## ocr_result\n\nsource');
    const currentSystemOrderSha256 = sha256(order);
    const finalSha256 = sha256(finalMarkdown);
    const preparationId = randomUUID();
    const customerMarkdown = '## customer_data\n\n| 價格等級 |\n| --- |\n| B |';
    const State = createSteelQuotationStateModel(mongoose);
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    const Models = mongoose.models as typeof mongoose.models & {
      Conversation: mongoose.Model<Record<string, unknown>>;
      Message: mongoose.Model<Record<string, unknown>>;
    };
    await Models.Conversation.create({ conversationId, user: userId, title: 'quotation', endpoint: 'openAI' });
    await Models.Message.create({ messageId: targetMessageId, conversationId, user: userId, text: order,
      content: [{ type: 'text', text: order }, { type: 'tool_call', tool_call: { id: 'stored-b' } }],
      metadata: { responseOwner: 'B', unrelated: { keep: true } }, unfinished: true });
    await State.create({
      userId, conversationId, nextSignalIndex: 1,
      currentOrder: { markdown: '## ocr_result\n\nsource', sha256: currentOrderSha256 },
      currentCustomer: {
        preparationId, customerMarkdown, customerIdentity: 'customer:B', triggeringMessageId: randomUUID(),
        responseId: randomUUID(), selectionProvenance: { method: 'default_tier' },
      },
      currentSystemOrder: { runId, sha256: currentSystemOrderSha256, markdown: order, messageId: targetMessageId, updatedAt: new Date() },
      tickets: [], pendingMessages: [], activeRun: {
        runId, index: 1, status: 'completed', triggerMessageId: randomUUID(), targetMessageId: runTargetMessageId,
        snapshotRef: { artifactId: `${runId}:snapshot:x`, userId, conversationId, runId, operationId: 'snapshot', kind: 'snapshot', sha256: currentOrderSha256 },
        chunks: [], checkpointRefs: [{ operationId: 'final', kind: 'final', artifactId: `${runId}:final:${finalSha256}`, sha256: finalSha256, updatedAt: new Date() }],
        acceptedAt: new Date(), updatedAt: new Date(),
      },
    });
    await Artifact.create({ userId, conversationId, runId, operationId: 'final', kind: 'final', sha256: finalSha256, payload: finalMarkdown });

    const result = await createMethods(mongoose).saveSteelQuotationMessage({
      scope: { userId, conversationId }, runId, runTargetMessageId, targetMessageId,
      finalSha256, currentOrderSha256, currentSystemOrderSha256,
      customer: { preparationId, customerIdentity: 'customer:B', customerMarkdown },
      message: { messageId: targetMessageId, sourceMessageId: runTargetMessageId, conversationId, text: 'host-A', user: userId,
        content: [{ type: 'text', text: 'host-A' }], metadata: { responseOwner: 'A' }, unfinished: false },
    });

    expect(result.ok).toBe(true);
    expect(await Models.Message.findOne({ messageId: targetMessageId }).lean()).toEqual(expect.objectContaining({
      text: order,
      content: [{ type: 'text', text: order }, { type: 'tool_call', tool_call: { id: 'stored-b' } }],
      metadata: { responseOwner: 'B', unrelated: { keep: true } },
      unfinished: false,
    }));
  });

  it('rolls back the message when the guarded publication transaction fails', async () => {
    const userId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const runId = randomUUID();
    const order = '## system_order\n\n| 品名 | 總數 | 單價 |\n| --- | --- | --- |\n| A | 2 | 10 |';
    const finalMarkdown = `${order}\n\n## quote_summary\n\n完成`;
    const currentOrderSha256 = sha256('## ocr_result\n\nsource');
    const currentSystemOrderSha256 = sha256(order);
    const finalSha256 = sha256(finalMarkdown);
    const preparationId = randomUUID();
    const customerMarkdown = '## customer_data\n\n| 價格等級 |\n| --- |\n| B |';
    const State = createSteelQuotationStateModel(mongoose);
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    const Models = mongoose.models as typeof mongoose.models & {
      Conversation: mongoose.Model<Record<string, unknown>>;
      Message: mongoose.Model<Record<string, unknown>>;
    };
    await Models.Conversation.create({ conversationId, user: userId, title: 'quotation', endpoint: 'openAI' });
    await Models.Message.create({ messageId, conversationId, user: userId, text: 'before', unfinished: true });
    await State.create({
      userId, conversationId, nextSignalIndex: 1, currentOrder: { markdown: '## ocr_result\n\nsource', sha256: currentOrderSha256 },
      currentCustomer: { preparationId, customerMarkdown, customerIdentity: 'customer:B', triggeringMessageId: randomUUID(),
        responseId: randomUUID(), selectionProvenance: { method: 'default_tier' } },
      currentSystemOrder: { runId, sha256: currentSystemOrderSha256, markdown: order, messageId, updatedAt: new Date() },
      tickets: [], pendingMessages: [], activeRun: {
        runId, index: 1, status: 'completed', triggerMessageId: randomUUID(), targetMessageId: messageId,
        snapshotRef: { artifactId: `${runId}:snapshot:x`, userId, conversationId, runId, operationId: 'snapshot', kind: 'snapshot', sha256: currentOrderSha256 },
        chunks: [], checkpointRefs: [{ operationId: 'final', kind: 'final', artifactId: `${runId}:final:${finalSha256}`, sha256: finalSha256, updatedAt: new Date() }],
        acceptedAt: new Date(), updatedAt: new Date(),
      },
    });
    await Artifact.create({ userId, conversationId, runId, operationId: 'final', kind: 'final', sha256: finalSha256, payload: finalMarkdown });
    const proof: SteelQuotationPublicationProof = {
      scope: { userId, conversationId }, runId, targetMessageId: messageId, finalSha256,
      runTargetMessageId: messageId,
      currentOrderSha256, currentSystemOrderSha256,
      customer: { preparationId, customerIdentity: 'customer:B', customerMarkdown },
      message: { messageId, conversationId, text: order, user: userId, content: [{ type: 'text', text: order }] },
    };
    const update = jest.spyOn(State, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('injected publication failure');
    });
    await expect(createMethods(mongoose).saveSteelQuotationMessage(proof)).rejects.toThrow('injected publication failure');
    update.mockRestore();
    expect(await Models.Message.findOne({ messageId }).lean()).toEqual(expect.objectContaining({ text: 'before', unfinished: true }));
    expect((await State.findOne({ userId, conversationId }).lean())?.activeRun?.checkpointRefs)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ operationId: 'published' })]));
    expect(await Artifact.findOne({ userId, conversationId, runId, operationId: 'published' }).lean()).toBeNull();
  });

  it('keeps a human save across concurrent publication retries', async () => {
    const userId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const runId = randomUUID();
    const order = '## system_order\n\n| 品名 | 總數 | 單價 |\n| --- | --- | --- |\n| A | 2 | 10 |';
    const finalMarkdown = `${order}\n\n## quote_summary\n\n完成`;
    const currentOrderSha256 = sha256('## ocr_result\n\nsource');
    const currentSystemOrderSha256 = sha256(order);
    const finalSha256 = sha256(finalMarkdown);
    const preparationId = randomUUID();
    const customerMarkdown = '## customer_data\n\n| 價格等級 |\n| --- |\n| B |';
    const State = createSteelQuotationStateModel(mongoose);
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    const ReviewOutput = createSteelReviewOutputModel(mongoose);
    const Models = mongoose.models as typeof mongoose.models & {
      Conversation: mongoose.Model<Record<string, unknown>>;
      Message: mongoose.Model<Record<string, unknown>>;
    };
    await Models.Conversation.create({ conversationId, user: userId, title: 'quotation', endpoint: 'openAI' });
    await Models.Message.create({ messageId, conversationId, user: userId, text: 'partial', unfinished: true });
    await State.create({
      userId, conversationId, nextSignalIndex: 1,
      currentOrder: { markdown: '## ocr_result\n\nsource', sha256: currentOrderSha256 },
      currentCustomer: {
        preparationId, customerMarkdown, customerIdentity: 'customer:B', triggeringMessageId: randomUUID(),
        responseId: randomUUID(), selectionProvenance: { method: 'default_tier' },
      },
      currentSystemOrder: { runId, sha256: currentSystemOrderSha256, markdown: order, messageId, updatedAt: new Date() },
      tickets: [], pendingMessages: [], activeRun: {
        runId, index: 1, status: 'completed', triggerMessageId: randomUUID(), targetMessageId: messageId,
        snapshotRef: { artifactId: `${runId}:snapshot:x`, userId, conversationId, runId, operationId: 'snapshot', kind: 'snapshot', sha256: currentOrderSha256 },
        chunks: [], checkpointRefs: [{ operationId: 'final', kind: 'final', artifactId: `${runId}:final:${finalSha256}`, sha256: finalSha256, updatedAt: new Date() }],
        acceptedAt: new Date(), updatedAt: new Date(),
      },
    });
    await Artifact.create({ userId, conversationId, runId, operationId: 'final', kind: 'final', sha256: finalSha256, payload: finalMarkdown });
    const proof: SteelQuotationPublicationProof = {
      scope: { userId, conversationId }, runId, targetMessageId: messageId, finalSha256,
      runTargetMessageId: messageId,
      currentOrderSha256, currentSystemOrderSha256,
      saveContext: { isTemporary: true, expiredAt: new Date('2026-10-05T00:00:00.000Z') },
      customer: { preparationId, customerIdentity: 'customer:B', customerMarkdown },
      message: { messageId, conversationId, text: order, user: userId, content: [{ type: 'text', text: order }] },
    };
    const methods = createMethods(mongoose);
    const [first, retry] = await Promise.all([
      methods.saveSteelQuotationMessage(proof), methods.saveSteelQuotationMessage(proof),
    ]);
    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    const humanMarkdown = `${order.replace('| 10 |', '| 12 |')}\n\n## quote_summary\n\n人工作業`;
    const humanSystemOrder = order.replace('| 10 |', '| 12 |');
    const humanSystemOrderSha256 = sha256(humanSystemOrder);
    const humanReviewRevision = sha256(`${currentSystemOrderSha256}:human-review`);
    const humanSave = await methods.saveMessage({ userId }, {
      messageId, conversationId, text: humanMarkdown, isCreatedByUser: false,
      metadata: {
        steelReview: {
          system_order: {
            version: 1,
            kind: 'system_order',
            conversationId,
            messageId,
            title: 'system_order',
            outputId: `system_order:${runId}`,
            revision: humanReviewRevision,
            updatedAt: new Date(),
          },
        },
      },
    });
    expect(humanSave?.text).toBe(humanMarkdown);
    await State.updateOne({ userId, conversationId }, {
      $set: { 'currentSystemOrder.markdown': humanSystemOrder, 'currentSystemOrder.sha256': humanSystemOrderSha256 },
    });
    await ReviewOutput.create({
      userId, conversationId, kind: 'system_order', messageId, tableId: 'system_order:table',
      outputId: `system_order:${runId}`, state: 'current', title: 'system_order', revision: humanReviewRevision,
      headers: ['品名', '總數', '單價'], rows: [{ rowId: 'row-a', values: {
        品名: { baseline: 'A', effective: 'A' }, 總數: { baseline: '2', effective: '2' }, 單價: { baseline: '10', effective: '12' },
      }, origin: 'manual', deleted: false, source: null }],
      humanMarkdown: humanSystemOrder, humanSavedAt: new Date(), effectiveMarkdown: humanSystemOrder,
      displayMarkdown: humanSystemOrder,
    });
    const replay = await methods.saveSteelQuotationMessage({
      ...proof,
      currentSystemOrderSha256: humanSystemOrderSha256,
    });
    expect(replay).toMatchObject({ ok: true, message: { text: humanMarkdown } });
    expect((await Models.Message.findOne({ messageId }).lean())?.text).toBe(humanMarkdown);
    expect((await Artifact.find({ userId, conversationId, runId, operationId: 'published' }).lean())).toHaveLength(1);
    expect((await State.findOne({ userId, conversationId }).lean())?.activeRun?.checkpointRefs
      .filter((entry) => entry.operationId === 'published')).toHaveLength(1);
  });
});
