import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { SteelMarkdownAdmission, SteelMarkdownPublicationInput, SteelQuotationActiveRun, SteelQuotationScope, IMessage } from '~/types';
import { createSteelConversationOcrStateModel, createSteelQuotationStateModel, createSteelQuotationArtifactModel, createSteelReviewOutputModel } from '~/models/steel';
import { createSteelQuotationInputMethods } from './steelQuotationInput';
import { createSteelPublicationMethods } from './steelPublication';
import { createMessageMethods } from './message';
import { createModels } from '~/models';

let server: MongoMemoryReplSet;
const scope: SteelQuotationScope = { userId: 'user-1', conversationId: '019c6e27-e55b-73d1-87d8-4e01f1f75043' };
const markdown = (quantity: string) => `## ocr_result\n\n| 來源 | 零件編號 | 數量 |\n| --- | --- | --- |\n| 文字訂單 | P1 | ${quantity} |`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
type QuotationArtifactFixture = {
  userId: string;
  conversationId: string;
  runId: string;
  operationId: 'final' | 'published';
  kind: 'final';
  sha256: string;
  payload: string;
};
const quotationRunFixture = (runId: string, targetMessageId: string, published: boolean): {
  run: SteelQuotationActiveRun;
  artifacts: QuotationArtifactFixture[];
} => {
  const now = new Date();
  const finalPayload = `final:${runId}`;
  const finalSha256 = sha(finalPayload);
  const publicationPayload = JSON.stringify({ finalSha256 });
  const finalRef = {
    operationId: 'final',
    kind: 'final' as const,
    artifactId: `${runId}:final:${finalSha256}`,
    sha256: finalSha256,
    updatedAt: now,
  };
  const publishedRef = {
    operationId: 'published',
    kind: 'final' as const,
    artifactId: `${runId}:published:${sha(publicationPayload)}`,
    sha256: sha(publicationPayload),
    updatedAt: now,
  };
  const run: SteelQuotationActiveRun = {
    runId,
    index: 1,
    status: 'completed',
    triggerMessageId: `${runId}:trigger`,
    targetMessageId,
    snapshotRef: {
      artifactId: `${runId}:snapshot:${sha(`snapshot:${runId}`)}`,
      userId: scope.userId,
      conversationId: scope.conversationId,
      runId,
      operationId: 'snapshot',
      kind: 'snapshot',
      sha256: sha(`snapshot:${runId}`),
    },
    chunks: [],
    checkpointRefs: published ? [finalRef, publishedRef] : [finalRef],
    acceptedAt: now,
    updatedAt: now,
  };
  return {
    run,
    artifacts: [
      {
        ...scope,
        runId,
        operationId: 'final' as const,
        kind: 'final' as const,
        sha256: finalSha256,
        payload: finalPayload,
      },
      ...(published ? [{
        ...scope,
        runId,
        operationId: 'published' as const,
        kind: 'final' as const,
        sha256: sha(publicationPayload),
        payload: publicationPayload,
      }] : []),
    ],
  };
};
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

it.each([
  { label: 'a completed run without a published checkpoint', published: false, persistArtifacts: true },
  { label: 'bare final and published checkpoints without matching artifacts', published: true, persistArtifacts: false },
])('rejects full OCR publication with $label and leaves mirrors untouched', async ({ published, persistArtifacts }) => {
  const methods = createMessageMethods(mongoose);
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const Message = mongoose.models.Message;
  const currentOrder = { markdown: 'before-order', sha256: sha('before-order') };
  const currentCustomer = {
    preparationId: 'before-customer',
    customerMarkdown: 'before-customer-markdown',
    customerIdentity: 'before-customer-identity',
    triggeringMessageId: 'before-trigger',
    responseId: 'before-response',
    selectionProvenance: { method: 'default_tier' as const },
  };
  await State.create({ ...scope, currentOrder, currentCustomer });
  const admission = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-2', generationId: 'ai-2' });
  if (!admission) throw new Error('Missing admission');
  const runFixture = quotationRunFixture('quotation-unpublished', admission.responseId, published);
  await Message.create({ messageId: admission.responseId, conversationId: scope.conversationId, user: scope.userId,
    text: 'before-message', unfinished: true });
  await State.updateOne(scope, { $set: { activeRun: runFixture.run } });
  if (persistArtifacts) await Artifact.create(runFixture.artifacts);
  const beforeState = await State.findOne(scope).lean();
  const beforeArtifacts = await Artifact.find({ ...scope, runId: runFixture.run.runId }).lean();

  expect(await methods.publishSteelMarkdown(publication(admission))).toEqual({ ok: false, code: 'superseded' });

  const afterState = await State.findOne(scope).lean();
  expect(afterState?.currentOrder).toEqual(beforeState?.currentOrder);
  expect(afterState?.currentCustomer).toEqual(beforeState?.currentCustomer);
  expect(afterState?.activeRun).toEqual(beforeState?.activeRun);
  expect(await Message.findOne({ messageId: admission.responseId }).lean()).toEqual(
    expect.objectContaining({ text: 'before-message', unfinished: true }),
  );
  expect(await Artifact.find({ ...scope, runId: runFixture.run.runId }).lean()).toEqual(beforeArtifacts);
});

it('allows full OCR publication when the completed run has durable final and published proof', async () => {
  const methods = createMessageMethods(mongoose);
  const admission = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-2', generationId: 'ai-2' });
  if (!admission) throw new Error('Missing admission');
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const runFixture = quotationRunFixture('quotation-published', admission.responseId, true);
  await State.updateOne(scope, { $set: { activeRun: runFixture.run } });
  await Artifact.create(runFixture.artifacts);

  const result = await methods.publishSteelMarkdown(publication(admission));

  expect(result.ok).toBe(true);
  expect((await State.findOne(scope).lean())?.currentOrder?.markdown).toBe(markdown('2'));
});

it('rolls back a full OCR publication when another admitted run completes between proof and transaction write', async () => {
  const methods = createMessageMethods(mongoose);
  const inputMethods = createSteelQuotationInputMethods(mongoose);
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const Message = mongoose.models.Message;
  const currentOrder = { markdown: markdown('2'), sha256: sha(markdown('2')) };
  const publishedFixture = quotationRunFixture('quotation-published', 'published-result', true);
  const ticket = { index: 2, token: 'quotation-replacement', orderHash: currentOrder.sha256,
    customerMarkdown: 'customer', customerIdentity: 'customer-1', triggeringMessageId: 'new-quote',
    selectionProvenance: { method: 'unique' as const }, issuedAt: new Date() };
  await State.create({ ...scope, currentOrder, activeRun: publishedFixture.run, nextSignalIndex: 2, tickets: [ticket] });
  await Artifact.create(publishedFixture.artifacts);
  const admission = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-2', generationId: 'ai-2' });
  if (!admission) throw new Error('Missing admission');
  let interleaved = false;
  const publisher = createSteelPublicationMethods(mongoose, async (input, message, session) => {
    if (!interleaved) {
      interleaved = true;
      const accepted = await inputMethods.admitSteelQuotationOcrInput({ scope, index: ticket.index, token: ticket.token,
        orderHash: currentOrder.sha256, customerMarkdown: ticket.customerMarkdown, customerIdentity: ticket.customerIdentity,
        prompts: { child: 'child', main: 'main' }, chunks: [{ index: 1, sourceRowCount: 1 }], targetMessageId: 'new-quote-result' });
      if (!accepted.ok) throw new Error('Missing second admission');
      const completed = quotationRunFixture(accepted.run.runId, 'new-quote-result', false);
      await Artifact.create(completed.artifacts);
      await State.updateOne({ ...scope, 'activeRun.runId': accepted.run.runId }, { $set: {
        'activeRun.status': 'completed', 'activeRun.checkpointRefs': completed.run.checkpointRefs,
      } });
    }
    return Message.findOneAndUpdate({ user: input.scope.userId, conversationId: input.scope.conversationId,
      messageId: message.messageId }, { $set: message }, { session, new: true, upsert: true }).lean<IMessage>();
  });
  expect(await publisher.publishSteelMarkdown(publication(admission, '4'))).toEqual({ ok: false, code: 'superseded' });
  expect(interleaved).toBe(true);
  const after = await State.findOne(scope).lean();
  expect(after?.activeRun?.runId).toBe(ticket.token);
  expect(after?.activeRun?.status).toBe('completed');
  expect(after?.currentOrder).toEqual(currentOrder);
  expect(after?.tickets[0].acceptedRunId).toBe(ticket.token);
  expect(await Message.findOne({ messageId: admission.responseId }).lean()).toBeNull();
  expect(await Artifact.countDocuments({ ...scope, operationId: 'ai:ocr_result' })).toBe(0);
  expect(await Artifact.countDocuments({ ...scope, kind: 'snapshot' })).toBe(1);
  expect(await createSteelReviewOutputModel(mongoose).countDocuments(scope)).toBe(0);
  expect(await createSteelConversationOcrStateModel(mongoose).countDocuments({ conversationId: scope.conversationId })).toBe(0);
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
