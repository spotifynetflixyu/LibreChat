import mongoose from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  createModels,
  createMethods,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
} from '..';
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

async function createLegacyFixture() {
  const userId = randomUUID();
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const runId = randomUUID();
  const order = '## system_order\n\n| 品名 | 總數 | 單價 |\n| --- | --- | --- |\n| A | 2 | 10 |';
  const finalMarkdown = `${order}\n\n## quote_summary\n\n完成`;
  const currentOrderSha256 = sha256('## ocr_result\n\nsource');
  const currentSystemOrderSha256 = sha256(order);
  const finalSha256 = sha256(finalMarkdown);
  const publicationPayload = JSON.stringify({ finalSha256 });
  const publicationSha256 = sha256(publicationPayload);
  const preparationId = randomUUID();
  const customerMarkdown = '## customer_data\n\n| 價格等級 |\n| --- |\n| B |';
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const Message = mongoose.models.Message as mongoose.Model<Record<string, unknown>>;
  await Message.create({
    messageId,
    conversationId,
    user: userId,
    text: finalMarkdown,
    content: [{ type: 'text', text: finalMarkdown }, { type: 'tool_call', tool_call: { id: 'kept' } }],
    metadata: {
      steelMarkdownOwners: {
        system_order: {
          kind: 'system_order',
          source: 'ai',
          outputId: `system_order:${runId}`,
          messageId,
          sha256: currentSystemOrderSha256,
        },
      },
      steelQuotation: { preserved: true },
    },
    isCreatedByUser: false,
    unfinished: false,
  });
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
    currentSystemOrder: { runId, sha256: currentSystemOrderSha256, markdown: order, messageId, updatedAt: new Date() },
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
      checkpointRefs: [
        { operationId: 'final', kind: 'final', artifactId: `${runId}:final:${finalSha256}`, sha256: finalSha256, updatedAt: new Date() },
        { operationId: 'published', kind: 'final', artifactId: `${runId}:published:${publicationSha256}`, sha256: publicationSha256, updatedAt: new Date() },
      ],
      acceptedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await Artifact.create([
    { userId, conversationId, runId, operationId: 'final', kind: 'final', sha256: finalSha256, payload: finalMarkdown },
    { userId, conversationId, runId, operationId: 'published', kind: 'final', sha256: publicationSha256, payload: publicationPayload },
  ]);
  const proof: SteelQuotationPublicationProof = {
    scope: { userId, conversationId },
    runId,
    runTargetMessageId: messageId,
    targetMessageId: messageId,
    finalSha256,
    currentOrderSha256,
    currentSystemOrderSha256,
    customer: { preparationId, customerIdentity: 'customer:B', customerMarkdown },
    message: { messageId, conversationId, text: order, user: userId, isCreatedByUser: false },
  };
  return { Artifact, Message, State, proof, messageId, runId, userId, conversationId };
}

describe('legacy Steel quotation publication compatibility', () => {
  it('returns the already persisted message without writing legacy publication records', async () => {
    const fixture = await createLegacyFixture();
    const beforeMessage = await fixture.Message.findOne({ messageId: fixture.messageId }).lean();
    const beforeState = await fixture.State.findOne({ userId: fixture.userId, conversationId: fixture.conversationId }).lean();
    const result = await createMethods(mongoose).saveSteelQuotationMessage(fixture.proof);

    expect(result).toEqual({ ok: true, message: expect.objectContaining({
      messageId: fixture.messageId,
      text: expect.stringContaining('完成'),
      content: expect.any(Array),
      metadata: expect.objectContaining({ steelQuotation: { preserved: true } }),
    }) });
    expect(await fixture.Message.findOne({ messageId: fixture.messageId }).lean()).toEqual(beforeMessage);
    expect(await fixture.State.findOne({ userId: fixture.userId, conversationId: fixture.conversationId }).lean()).toEqual(beforeState);
    expect(await fixture.Artifact.countDocuments({ runId: fixture.runId, operationId: 'published' })).toBe(1);
  });

  it('rejects an unpublished completed run without creating or updating anything', async () => {
    const fixture = await createLegacyFixture();
    await fixture.Artifact.deleteMany({ runId: fixture.runId, operationId: 'published' });
    const beforeMessage = await fixture.Message.findOne({ messageId: fixture.messageId }).lean();
    const result = await createMethods(mongoose).saveSteelQuotationMessage(fixture.proof);

    expect(result).toEqual({ ok: false, code: 'superseded' });
    expect(await fixture.Message.findOne({ messageId: fixture.messageId }).lean()).toEqual(beforeMessage);
    expect(await fixture.Artifact.countDocuments({ runId: fixture.runId, operationId: 'published' })).toBe(0);
  });

  it('does not treat an early completed run as a legacy final publication', async () => {
    const fixture = await createLegacyFixture();
    await fixture.State.updateOne(
      { userId: fixture.userId, conversationId: fixture.conversationId },
      { $set: { 'activeRun.checkpointRefs': [] } },
    );
    const result = await createMethods(mongoose).saveSteelQuotationMessage(fixture.proof);
    expect(result).toEqual({ ok: false, code: 'superseded' });
    expect(await fixture.Artifact.countDocuments({ runId: fixture.runId })).toBe(2);
  });

  it('rejects a target that is absent from the authenticated scope', async () => {
    const fixture = await createLegacyFixture();
    const targetMessageId = randomUUID();
    const result = await createMethods(mongoose).saveSteelQuotationMessage({
      ...fixture.proof,
      targetMessageId,
      message: { ...fixture.proof.message, messageId: targetMessageId },
    });
    expect(result).toEqual({ ok: false, code: 'superseded' });
  });
});
