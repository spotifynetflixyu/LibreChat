import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { SteelMarkdownAdmission, SteelMarkdownPublicationInput } from '~/types';
import { createSteelConversationOcrStateModel, createSteelQuotationStateModel, createSteelQuotationArtifactModel, createSteelReviewOutputModel } from '~/models/steel';
import { createMessageMethods } from './message';
import { createModels } from '~/models';

let server: MongoMemoryReplSet;
const scope = { userId: 'user-1', conversationId: '019c6e27-e55b-73d1-87d8-4e01f1f75043' };
const markdown = (quantity: string) => `## ocr_result\n\n| 來源 | 零件編號 | 數量 |\n| --- | --- | --- |\n| 文字訂單 | P1 | ${quantity} |`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const publication = (admission: SteelMarkdownAdmission, quantity = '2'): SteelMarkdownPublicationInput => {
  const text = markdown(quantity);
  const outputId = `ocr_result:${admission.generationId}`;
  const values = ['文字訂單', 'P1', quantity];
  return { scope, admission, rawMarkdown: text,
    message: { messageId: admission.responseId, conversationId: scope.conversationId, user: scope.userId, text, isCreatedByUser: false, unfinished: false },
    targets: [{ kind: 'ocr_result', title: 'ocr_result', outputId, revision: admission.generationId, baselineMarkdown: text,
      headers: ['來源', '零件編號', '數量'], rows: [{ source: null, rowId: sha(`${outputId}:0:${JSON.stringify(values)}`), values: Object.fromEntries(['來源', '零件編號', '數量'].map((key, index) => [key, { baseline: values[index], effective: values[index] }])) }] }],
    ocr: { attemptNumber: 1 },
  };
};

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  const models = createModels(mongoose);
  await Promise.all(Object.values(models).map((model) => model.init()));
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  await mongoose.models.Conversation.create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'agents' });
});

it('allocates trusted sequence before work and refuses an older normal completion', async () => {
  const methods = createMessageMethods(mongoose);
  const first = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-2', generationId: 'ai-2' });
  const latest = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-4', generationId: 'ai-4' });
  expect(first?.sequence).toBe(1);
  expect(latest?.sequence).toBe(2);
  expect(first && await methods.publishSteelMarkdown(publication(first))).toEqual({ ok: false, code: 'superseded' });
  const published = latest && await methods.publishSteelMarkdown(publication(latest, '4'));
  expect(published?.ok).toBe(true);
  expect(await mongoose.models.Message.findOne({ messageId: 'assistant-2' })).toBeNull();
  const ocr = await createSteelConversationOcrStateModel(mongoose).findOne({ conversationId: scope.conversationId }).lean();
  expect(ocr?.currentOcrResultGenerationId).toBe('ai-4');
  expect(ocr?.currentOcrResultMarkdown).toBe(markdown('4'));
  const order = await createSteelQuotationStateModel(mongoose).findOne(scope).lean();
  expect(order?.currentOrder?.markdown).toBe(markdown('4'));
});

it('keeps immutable baseline and successful time on replay and isolates a new generation', async () => {
  const methods = createMessageMethods(mongoose);
  const first = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-2', generationId: 'ai-2' });
  if (!first) throw new Error('Missing admission');
  const published = await methods.publishSteelMarkdown(publication(first));
  const replay = await methods.publishSteelMarkdown(publication(first));
  expect(published.ok).toBe(true);
  expect(replay).toEqual(published);
  const newer = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-4', generationId: 'ai-4' });
  if (!newer) throw new Error('Missing next admission');
  expect(newer.lineageId).toBe(first.lineageId);
  expect((await methods.publishSteelMarkdown(publication(newer, '4'))).ok).toBe(true);
  const outputs = await createSteelReviewOutputModel(mongoose).find({ conversationId: scope.conversationId }).sort({ aiUpdatedAt: 1 }).lean();
  expect(outputs).toHaveLength(2);
  expect(outputs[0]).toMatchObject({ outputId: 'ocr_result:ai-2', state: 'historical', aiBaselineMarkdown: markdown('2'), effectiveMarkdown: markdown('2'), receipts: [] });
  expect(outputs[1]).toMatchObject({ outputId: 'ocr_result:ai-4', state: 'current', aiBaselineMarkdown: markdown('4'), effectiveMarkdown: markdown('4'), receipts: [] });
  expect(outputs[1].humanSavedAt).toBeUndefined();
  const artifacts = await createSteelQuotationArtifactModel(mongoose).find({ operationId: 'ai:ocr_result' }).lean();
  expect(artifacts).toHaveLength(2);
});

it('rolls back the message and all mirrors on an operational publication failure', async () => {
  const methods = createMessageMethods(mongoose);
  const admission = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-2', generationId: 'ai-2' });
  if (!admission) throw new Error('Missing admission');
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const failure = jest.spyOn(Artifact, 'create').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(methods.publishSteelMarkdown(publication(admission))).rejects.toThrow('Storage unavailable');
  failure.mockRestore();
  expect(await mongoose.models.Message.findOne({ messageId: admission.responseId })).toBeNull();
  expect(await createSteelReviewOutputModel(mongoose).countDocuments({ conversationId: scope.conversationId })).toBe(0);
  expect(await createSteelConversationOcrStateModel(mongoose).findOne({ conversationId: scope.conversationId })).toBeNull();
  const state = await createSteelQuotationStateModel(mongoose).findOne(scope).lean();
  expect(state?.currentOrder).toBeUndefined();
  expect(state?.markdownPublication?.current).toBeUndefined();
  expect((await methods.publishSteelMarkdown(publication(admission))).ok).toBe(true);
});
