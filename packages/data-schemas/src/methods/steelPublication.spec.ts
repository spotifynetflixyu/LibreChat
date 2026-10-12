import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { bindSteelReviewRowsToOcrContext, createSteelReviewOcrContext } from 'librechat-data-provider';
import type { SteelMarkdownAdmission, SteelMarkdownPublicationInput, SteelQuotationActiveRun, SteelQuotationScope, IMessage } from '~/types';
import { createSteelConversationOcrStateModel, createSteelQuotationStateModel, createSteelQuotationArtifactModel, createSteelReviewOutputModel } from '~/models/steel';
import { createSteelQuotationInputMethods } from './steelQuotationInput';
import { createSteelPublicationMethods } from './steelPublication';
import { createMessageMethods } from './message';
import { createModels } from '~/models';

let server: MongoMemoryReplSet;
const scope: SteelQuotationScope = { userId: '507f1f77bcf86cd799439011', conversationId: '019c6e27-e55b-73d1-87d8-4e01f1f75043' };
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


it.each([
  { user: 'foreign-owner' },
  { user: scope.userId, tenantId: 'foreign-tenant' },
])('refuses new Markdown admission for an ambiguous owner binding %j', async (foreign) => {
  await mongoose.models.Conversation.create({ conversationId: scope.conversationId, endpoint: 'agents', ...foreign });
  const methods = createSteelPublicationMethods(mongoose, jest.fn());
  expect(await methods.admitSteelMarkdown({ scope, responseId: 'assistant-collision', generationId: 'collision' })).toBeNull();
  expect(await createSteelQuotationStateModel(mongoose).countDocuments({})).toBe(0);
});

it.each([
  ['foreign owner, absent OCR', { user: 'foreign-owner' }, false],
  ['foreign tenant, absent OCR', { user: scope.userId, tenantId: 'foreign-tenant' }, false],
  ['foreign owner, existing OCR', { user: 'foreign-owner' }, true],
  ['foreign tenant, existing OCR', { user: scope.userId, tenantId: 'foreign-tenant' }, true],
] as const)('rejects a post-admission identity collision without mirror writes: %s', async (_name, foreign, existing) => {
  const Ocr = createSteelConversationOcrStateModel(mongoose);
  if (existing) await Ocr.create({ conversationId: scope.conversationId, sourceMappings: [], currentOcrResultMarkdown: markdown('1'), currentOcrResultGenerationId: 'before' });
  const save = jest.fn();
  const methods = createSteelPublicationMethods(mongoose, save);
  const admission = await methods.admitSteelMarkdown({ scope, responseId: 'assistant-collision', generationId: 'collision' });
  if (!admission) throw new Error('Missing unique-owner admission');
  await mongoose.models.Conversation.create({ conversationId: scope.conversationId, endpoint: 'agents', ...foreign });
  expect(await methods.publishSteelMarkdown(publication(admission))).toEqual({ ok: false, code: 'superseded' });
  expect(save).not.toHaveBeenCalled();
  expect(await createSteelQuotationArtifactModel(mongoose).countDocuments({})).toBe(0);
  expect(await createSteelReviewOutputModel(mongoose).countDocuments({})).toBe(0);
  expect(await mongoose.models.Message.countDocuments({})).toBe(0);
  const current = await Ocr.findOne({ conversationId: scope.conversationId }).lean();
  expect(current?.currentOcrResultMarkdown).toBe(existing ? markdown('1') : undefined);
  expect((await createSteelQuotationStateModel(mongoose).findOne({}).lean())?.markdownPublication?.current).toBeUndefined();
});

const prepareEarlyOrderPublication = async () => {
  const methods = createMessageMethods(mongoose);
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const Output = createSteelReviewOutputModel(mongoose);
  const runId = 'quotation-order-early';
  const responseId = 'assistant-order-early';
  const order = '## system_order\n\n| 品名 | 總數 | 單價 |\n| --- | --- | --- |\n| A | 2 | 99 |';
  const orderHash = sha(order);
  const sourceOrder = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| OCR | P1 | material | 2 |';
  const sourceOrderHash = sha(sourceOrder);
  const customerMarkdown = '## customer_data\n\n| 價格等級 |\n| --- |\n| B |';
  const customerIdentity = 'customer:B';
  const preparationId = 'customer-preparation';
  const now = new Date();
  await State.create({ ...scope,
    currentOrder: { markdown: sourceOrder, sha256: sourceOrderHash },
    currentCustomer: { preparationId, customerMarkdown, customerIdentity, triggeringMessageId: 'trigger', responseId: 'customer-response', selectionProvenance: { method: 'default_tier' } },
    tickets: [{ index: 1, token: 'ticket-token', orderHash: sourceOrderHash, customerMarkdown, customerIdentity, preparationId,
      triggeringMessageId: 'trigger', selectionProvenance: { method: 'default_tier' }, issuedAt: now, acceptedRunId: runId }],
  });
  const admission = await methods.admitSteelMarkdown({ scope, responseId, generationId: 'admission-generation' });
  if (!admission) throw new Error('Missing admission');
  const snapshotPayload = JSON.stringify({ prompts: { child: 'child', main: 'main' }, orderHash: sourceOrderHash, orderMarkdown: sourceOrder, customerMarkdown, customerIdentity });
  const chunkPayload = JSON.stringify({ markdown: order, lookupOperations: [], pythonOperations: [], sourceRowIds: ['source-row-1'] });
  const snapshotRef = { artifactId: `${runId}:snapshot:${sha(snapshotPayload)}`, userId: scope.userId, conversationId: scope.conversationId,
    runId, operationId: 'snapshot', kind: 'snapshot' as const, sha256: sha(snapshotPayload) };
  const chunkRef = { artifactId: `${runId}:chunk:1:${sha(chunkPayload)}`, userId: scope.userId, conversationId: scope.conversationId,
    runId, operationId: 'chunk:1', kind: 'chunk' as const, sha256: sha(chunkPayload) };
  const normalizedRef = { artifactId: `${runId}:system-order:normalized:${orderHash}`, userId: scope.userId, conversationId: scope.conversationId,
    runId, operationId: 'system-order:normalized', kind: 'main' as const, sha256: orderHash };
  await Artifact.create([
    { ...scope, runId, operationId: 'snapshot', kind: 'snapshot', sha256: snapshotRef.sha256, payload: snapshotPayload },
    { ...scope, runId, operationId: chunkRef.operationId, kind: 'chunk', sha256: chunkRef.sha256, payload: chunkPayload },
    { ...scope, runId, operationId: normalizedRef.operationId, kind: 'main', sha256: normalizedRef.sha256, payload: order },
  ]);
  await State.updateOne(scope, { $set: { activeRun: {
    runId, index: 1, status: 'aggregating', triggerMessageId: 'trigger', targetMessageId: responseId,
    leaseToken: 'lease-token', leaseExpiresAt: new Date(Date.now() + 60_000), acceptedAt: now, updatedAt: now,
    snapshotRef, ocrSelection: undefined, chunks: [{ index: 1, sourceRowCount: 1, status: 'completed', checkpointRef: chunkRef }],
    checkpointRefs: [chunkRef, normalizedRef],
  } } });
  const values = ['A', '2', '99'];
  const baseline = { kind: 'system_order' as const, title: 'system_order', outputId: `system_order:${runId}`, revision: runId,
    baselineMarkdown: order, headers: ['品名', '總數', '單價'], rows: [{ rowId: sha(`system_order:${runId}:0:${JSON.stringify(values)}`), values: Object.fromEntries(['品名', '總數', '單價'].map((header, index) => [header, { baseline: values[index], effective: values[index] }])), deleted: false, origin: 'ai' as const, source: null }] };
  const proof = {
    scope, runId, runTargetMessageId: responseId, targetMessageId: responseId, finalSha256: orderHash,
    currentOrderSha256: sourceOrderHash, currentSystemOrderSha256: orderHash,
    customer: { preparationId, customerIdentity, customerMarkdown },
    reviewBaseline: baseline,
    orderPublication: { leaseToken: 'lease-token', inputSnapshotSha256: snapshotRef.sha256, normalizedSha256: orderHash,
      admission, systemOrder: { runId, messageId: responseId, markdown: order, sha256: orderHash, updatedAt: now } },
    message: { messageId: responseId, conversationId: scope.conversationId, user: scope.userId, text: order, isCreatedByUser: false },
  };
  return { methods, State, Artifact, Output, runId, responseId, orderHash, sourceOrderHash, proof };
};

it('publishes a quotation whose signal response differs from the customer preparation response', async () => {
  const { methods, State, responseId, proof } = await prepareEarlyOrderPublication();
  await State.updateOne(scope, { $set: { 'tickets.0.responseId': responseId } });
  const state = await State.findOne(scope).lean();
  expect(state?.currentCustomer?.responseId).not.toBe(responseId);
  expect((await methods.saveSteelQuotationMessage(proof)).ok).toBe(true);
});

it.each(['canonical', 'legacy', 'empty-prefix'])('appends quotation summary blocks to a %s multipart message', async (format) => {
  const { methods, responseId, runId, proof } = await prepareEarlyOrderPublication();
  const order = proof.message.text;
  const prefix = 'first second\n\n';
  const message = {
    ...proof.message,
    text: format === 'empty-prefix' ? `\n\n${order}`
      : `${prefix}${format === 'canonical' ? '\n\n' : ' '}${order}`,
    content: format === 'empty-prefix' ? [{ type: 'text', text: order }] : [
      { type: 'text', text: 'first' },
      { type: 'tool_call', id: 'lookup' },
      { type: 'text', text: 'second\n\n' },
      { type: 'text', text: order },
    ],
  };
  expect((await methods.saveSteelQuotationMessage({ ...proof, message })).ok).toBe(true);
  const result = await methods.appendSteelQuotationSummary({
    scope,
    runId,
    targetMessageId: responseId,
    sourceMessageId: proof.orderPublication!.admission.responseId,
    admission: proof.orderPublication!.admission,
    summaryMarkdown: 'Completed review.',
    footerMarkdown: '## quote_summary\n\nCompleted quotation.',
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Summary publication failed');
  if (format !== 'empty-prefix') expect(result.message.text).toContain('first second');
  expect(result.message.text).toContain('\n\n## quote_summary\n\n');
  expect(result.message.content?.[format === 'empty-prefix' ? 0 : 3]).toEqual({ type: 'text', text: order });
});

it('rejects summary publication when stored text disagrees with both multipart projections', async () => {
  const { methods, responseId, runId, proof } = await prepareEarlyOrderPublication();
  expect((await methods.saveSteelQuotationMessage(proof)).ok).toBe(true);
  await mongoose.models.Message.updateOne({ user: scope.userId, messageId: responseId }, {
    $set: { text: 'Unrelated persisted text.' },
  });
  expect(await methods.appendSteelQuotationSummary({
    scope,
    runId,
    targetMessageId: responseId,
    sourceMessageId: proof.orderPublication!.admission.responseId,
    admission: proof.orderPublication!.admission,
    summaryMarkdown: 'Completed review.',
    footerMarkdown: '## quote_summary\n\nCompleted quotation.',
  })).toEqual({ ok: false, code: 'superseded' });
});

it.each([
  ['currentCustomer.preparationId', 'replaced-preparation'],
  ['currentCustomer.customerIdentity', 'replaced-customer'],
  ['tickets.0.preparationId', 'replaced-ticket-preparation'],
])('rejects stale customer authority at %s without publishing a message', async (field, value) => {
  const { methods, State, Artifact, Output, runId, proof } = await prepareEarlyOrderPublication();
  await State.updateOne(scope, { $set: { 'tickets.0.responseId': proof.targetMessageId, [field]: value } });
  expect(await methods.saveSteelQuotationMessage(proof)).toEqual({ ok: false, code: 'superseded' });
  expect(await mongoose.models.Message.countDocuments({})).toBe(0);
  expect(await Output.countDocuments({ ...scope, outputId: `system_order:${runId}` })).toBe(0);
  expect(await Artifact.countDocuments({ ...scope, runId, operationId: 'order-published' })).toBe(0);
});

it('publishes a normalized order early, keeps the input snapshot, and replays the receipt idempotently', async () => {
  const { methods, State, Artifact, Output, runId, responseId, orderHash, proof } = await prepareEarlyOrderPublication();
  const first = await methods.saveSteelQuotationMessage(proof);
  const replay = await methods.saveSteelQuotationMessage(proof);
  expect(first.ok).toBe(true);
  expect(replay.ok).toBe(true);
  expect(await Artifact.countDocuments({ ...scope, runId, operationId: 'snapshot' })).toBe(1);
  expect(await Artifact.countDocuments({ ...scope, runId, operationId: 'order-published' })).toBe(1);
  expect(await Output.countDocuments({ ...scope, outputId: `system_order:${runId}` })).toBe(1);
  const state = await State.findOne(scope).lean();
  expect(state?.activeRun?.status).toBe('completed');
  expect(state?.activeRun?.leaseToken).toBeUndefined();
  expect(state?.activeRun?.leaseExpiresAt).toBeUndefined();
  expect(state?.activeRun?.checkpointRefs.filter((ref) => ref.operationId === 'order-published')).toHaveLength(1);
  expect(state?.currentSystemOrder).toMatchObject({ runId, sha256: orderHash, messageId: responseId });
  expect(first.ok && first.message.metadata?.steelQuotation).toMatchObject({
    runId,
    outputId: `system_order:${runId}`,
    sourceMessageId: proof.orderPublication!.admission.responseId,
    admissionSequence: 1,
  });
});

it('appends summary and footer slots after completion without replacing the table', async () => {
  const { methods, Artifact, runId, responseId, proof } = await prepareEarlyOrderPublication();
  expect((await methods.saveSteelQuotationMessage(proof)).ok).toBe(true);
  const summary = '## quote_summary\n\n已完成報價校對。';
  const footer = '## quote_footer\n\n來源：已保存資料。';
  const input = {
    scope,
    runId,
    targetMessageId: responseId,
    sourceMessageId: proof.orderPublication!.admission.responseId,
    admission: proof.orderPublication!.admission,
    summaryMarkdown: summary,
    footerMarkdown: footer,
    messageFields: {
      metadata: {
        hostTrace: 'fresh-host-value',
        steel: { forged: true },
        steelQuotation: { forged: true },
        steelReview: { forged: true },
        steelMarkdownOwners: { forged: true },
        ocr: { forged: true },
      },
      tokenCount: 42,
      processingDurationMs: 123,
    },
  };
  const first = await methods.appendSteelQuotationSummary(input);
  const replay = await methods.appendSteelQuotationSummary(input);
  expect(first.ok).toBe(true);
  expect(replay.ok).toBe(true);
  const saved = await createModels(mongoose).Message.findOne({ user: scope.userId, conversationId: scope.conversationId, messageId: responseId }).lean();
  expect(saved?.text).toContain('## system_order');
  expect(saved?.text).toContain(summary);
  expect(saved?.text).toContain(footer);
  expect(saved?.text?.match(/已完成報價校對。/gu)).toHaveLength(1);
  expect(saved?.metadata?.steelQuotation).toMatchObject({ runId, outputId: `system_order:${runId}`, admissionSequence: 1, summaryReceiptSha256: expect.any(String) });
  expect(saved?.metadata?.hostTrace).toBe('fresh-host-value');
  expect(saved?.metadata?.steel).not.toEqual({ forged: true });
  expect(saved?.tokenCount).toBe(42);
  expect(saved?.processingDurationMs).toBe(123);
  expect(await Artifact.countDocuments({ ...scope, runId, operationId: 'summary-appended' })).toBe(1);
});

it.each(['quote_signal', 'quote_lineage', 'system_order_chunk', 'system_order_updates'])(
  'refuses quotation control section %s at the summary persistence boundary', async (title) => {
    const { methods, Artifact, runId, responseId, proof } = await prepareEarlyOrderPublication();
    expect((await methods.saveSteelQuotationMessage(proof)).ok).toBe(true);
    await expect(methods.appendSteelQuotationSummary({
      scope, runId, targetMessageId: responseId,
      sourceMessageId: proof.orderPublication!.admission.responseId,
      admission: proof.orderPublication!.admission,
      summaryMarkdown: `## ${title}\n\nforbidden`,
      footerMarkdown: 'Completed quotation.',
    })).resolves.toEqual({ ok: false, code: 'superseded' });
    expect(await Artifact.countDocuments({ ...scope, runId, operationId: 'summary-appended' })).toBe(0);
  },
);

it('keeps the first committed summary receipt for a run', async () => {
  const { methods, Artifact, runId, responseId, proof } = await prepareEarlyOrderPublication();
  expect((await methods.saveSteelQuotationMessage(proof)).ok).toBe(true);
  const first = await methods.appendSteelQuotationSummary({
    scope,
    runId,
    targetMessageId: responseId,
    sourceMessageId: proof.orderPublication!.admission.responseId,
    admission: proof.orderPublication!.admission,
    summaryMarkdown: '第一版校對。',
    footerMarkdown: '## quote_footer\n\n第一版結尾。',
  });
  const second = await methods.appendSteelQuotationSummary({
    scope,
    runId,
    targetMessageId: responseId,
    sourceMessageId: proof.orderPublication!.admission.responseId,
    admission: proof.orderPublication!.admission,
    summaryMarkdown: '第二版校對。',
    footerMarkdown: '## quote_footer\n\n第二版結尾。',
  });
  expect(first.ok).toBe(true);
  expect(second).toEqual({ ok: false, code: 'superseded' });
  const saved = await createModels(mongoose).Message.findOne({ user: scope.userId, conversationId: scope.conversationId, messageId: responseId }).lean();
  expect(saved?.text).toContain('第一版校對。');
  expect(saved?.text).not.toContain('第二版校對。');
  expect(await Artifact.countDocuments({ ...scope, runId, operationId: 'summary-appended' })).toBe(1);
});

it.each([
  ['empty chunks', async ({ State }: Awaited<ReturnType<typeof prepareEarlyOrderPublication>>) => {
    await State.updateOne(scope, { $set: { 'activeRun.chunks': [] } });
  }],
  ['wrong chunk kind', async ({ State }: Awaited<ReturnType<typeof prepareEarlyOrderPublication>>) => {
    await State.updateOne(scope, { $set: { 'activeRun.chunks.0.checkpointRef.kind': 'main' } });
  }],
  ['wrong chunk operation', async ({ State }: Awaited<ReturnType<typeof prepareEarlyOrderPublication>>) => {
    await State.updateOne(scope, { $set: { 'activeRun.chunks.0.checkpointRef.operationId': 'slice:1' } });
  }],
  ['noncanonical chunk index', async ({ State }: Awaited<ReturnType<typeof prepareEarlyOrderPublication>>) => {
    await State.updateOne(scope, { $set: { 'activeRun.chunks.0.index': 2 } });
  }],
  ['missing source row proof', async ({ Artifact, runId }: Awaited<ReturnType<typeof prepareEarlyOrderPublication>>) => {
    await Artifact.updateOne({ ...scope, runId, operationId: 'chunk:1' }, { $set: { payload: JSON.stringify({ markdown: 'order', lookupOperations: [], pythonOperations: [] }) } });
  }],
] as const)('rejects quotation publication with %s without mirror writes', async (_name, mutate) => {
  const fixture = await prepareEarlyOrderPublication();
  await mutate(fixture);
  const result = await fixture.methods.saveSteelQuotationMessage(fixture.proof);
  expect(result).toEqual({ ok: false, code: 'superseded' });
  expect(await mongoose.models.Message.countDocuments({})).toBe(0);
  expect(await fixture.Output.countDocuments({ ...scope, outputId: `system_order:${fixture.runId}` })).toBe(0);
  expect(await fixture.Artifact.countDocuments({ ...scope, runId: fixture.runId, operationId: 'order-published' })).toBe(0);
  expect((await fixture.State.findOne(scope).lean())?.currentSystemOrder).toBeUndefined();
});

it('binds quotation review rows and source mappings to the frozen snapshot', async () => {
  const fixture = await prepareEarlyOrderPublication();
  const forged = {
    ...fixture.proof,
    reviewBaseline: { ...fixture.proof.reviewBaseline, sourceMappings: [{ fileId: 'forged-file', sourceCode: 'OCR', sourceFilename: 'forged.pdf' }] },
    orderPublication: {
      ...fixture.proof.orderPublication,
      systemOrder: {
        ...fixture.proof.orderPublication.systemOrder,
        reviewMetadata: {
          version: 1 as const,
          initialized: true as const,
          lineage: { runId: fixture.runId, outputId: `system_order:${fixture.runId}`, revision: fixture.runId, messageId: fixture.responseId },
          ocrContext: null,
          rows: [],
        },
      },
    },
  };
  const result = await fixture.methods.saveSteelQuotationMessage(forged);
  expect(result).toEqual({ ok: false, code: 'superseded' });
  expect(await mongoose.models.Message.countDocuments({})).toBe(0);
  expect(await fixture.Artifact.countDocuments({ ...scope, runId: fixture.runId, operationId: 'order-published' })).toBe(0);
  expect(await fixture.Output.countDocuments({ ...scope, outputId: `system_order:${fixture.runId}` })).toBe(0);
});

it('rejects a snapshot without both immutable prompt fields before writing mirrors', async () => {
  const fixture = await prepareEarlyOrderPublication();
  const brokenPayload = JSON.stringify({ prompts: { child: 'child' }, orderHash: fixture.sourceOrderHash,
    orderMarkdown: '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| OCR | P1 | material | 2 |',
    customerMarkdown: '## customer_data\n\n| 價格等級 |\n| --- |\n| B |', customerIdentity: 'customer:B' });
  const brokenHash = sha(brokenPayload);
  await fixture.Artifact.updateOne({ ...scope, runId: fixture.runId, operationId: 'snapshot' }, { $set: { payload: brokenPayload, sha256: brokenHash } });
  await fixture.State.updateOne(scope, { $set: { 'activeRun.snapshotRef.sha256': brokenHash, 'activeRun.snapshotRef.artifactId': `${fixture.runId}:snapshot:${brokenHash}` } });
  const proof = { ...fixture.proof, orderPublication: { ...fixture.proof.orderPublication, inputSnapshotSha256: brokenHash } };
  expect(await fixture.methods.saveSteelQuotationMessage(proof)).toEqual({ ok: false, code: 'superseded' });
  expect(await mongoose.models.Message.countDocuments({})).toBe(0);
  expect(await fixture.Output.countDocuments({ ...scope, outputId: `system_order:${fixture.runId}` })).toBe(0);
  expect(await fixture.Artifact.countDocuments({ ...scope, runId: fixture.runId, operationId: 'order-published' })).toBe(0);
});

it('accepts an authorized file-bound OCR projection with immutable selection dates', async () => {
  const fixture = await prepareEarlyOrderPublication();
  const fileId = 'source-file';
  const sourceFilename = 'order.pdf';
  const sourceMediaType = 'application/pdf';
  await mongoose.models.File.create({ user: scope.userId, conversationId: scope.conversationId, file_id: fileId,
    bytes: 1, filename: sourceFilename, filepath: `/tmp/${sourceFilename}`, type: sourceMediaType });
  const sourceMapping = { fileId, sourceCode: 'OCR', sourceFilename, mediaType: sourceMediaType };
  const sourceValues = ['OCR', 'P1', 'material', '2'];
  const ocrOutputId = 'ocr_result:admitted';
  const ocrRevision = 'ocr-revision';
  const savedAt = new Date('2026-01-02T03:04:05.000Z');
  const ocrContext = createSteelReviewOcrContext({ title: 'ocr_result', outputId: ocrOutputId, revision: ocrRevision,
    headers: ['來源', '零件編號', '類別', '數量'], rows: [{
      rowId: sha(`${ocrOutputId}:0:${JSON.stringify(sourceValues)}`),
      values: Object.fromEntries(['來源', '零件編號', '類別', '數量'].map((header, index) => [header, { baseline: sourceValues[index], effective: sourceValues[index] }])),
      source: { fileId, pageNumber: 1, filename: sourceFilename, mediaType: sourceMediaType },
    }] });
  const sourceSnapshot = { orderHash: fixture.sourceOrderHash, mappings: [sourceMapping] };
  const selected = { kind: 'ocr_result' as const, source: 'ai' as const, snapshotId: 'ocr-snapshot', generationId: 'ocr-generation',
    outputId: ocrOutputId, messageId: 'ocr-message', title: 'ocr_result', revision: ocrRevision, sha256: fixture.sourceOrderHash,
    lineageId: 'ocr-lineage', version: 1, savedAt };
  const ocrSelection = { version: 1, candidates: { ai: selected }, selected };
  const order = '## system_order\n\n| 備註 | 總數 | 單價 | 類別 |\n| --- | --- | --- | --- |\n| P1 | 2 | 99 | material |';
  const orderHash = sha(order);
  const values = ['P1', '2', '99', 'material'];
  const unboundRows = [{ rowId: sha(`system_order:${fixture.runId}:0:${JSON.stringify(values)}`),
    values: Object.fromEntries(['備註', '總數', '單價', '類別'].map((header, index) => [header, { baseline: values[index], effective: values[index] }])),
    deleted: false, origin: 'ai' as const, source: null, system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null } }];
  const boundRows = bindSteelReviewRowsToOcrContext(['備註', '總數', '單價', '類別'], unboundRows, ocrContext);
  const reviewMetadata = { version: 1 as const, initialized: true as const,
    lineage: { runId: fixture.runId, outputId: `system_order:${fixture.runId}`, revision: fixture.runId, messageId: fixture.responseId,
      ocrOutputId, ocrRevision, ocrHash: fixture.sourceOrderHash }, ocrContext, rows: boundRows };
  const state = await fixture.State.findOne(scope).lean();
  const activeRun = state?.activeRun;
  if (!activeRun) throw new Error('Missing active quotation run');
  const snapshotPayload = JSON.stringify({ prompts: { child: 'child', main: 'main' }, orderHash: fixture.sourceOrderHash,
    orderMarkdown: '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| OCR | P1 | material | 2 |',
    customerMarkdown: '## customer_data\n\n| 價格等級 |\n| --- |\n| B |', customerIdentity: 'customer:B', sourceSnapshot, ocrSelection,
    ocrContext });
  const snapshotHash = sha(snapshotPayload);
  await fixture.Artifact.updateOne({ ...scope, runId: fixture.runId, operationId: 'snapshot' }, { $set: { payload: snapshotPayload, sha256: snapshotHash } });
  await fixture.Artifact.updateOne({ ...scope, runId: fixture.runId, operationId: 'system-order:normalized' }, { $set: { payload: order, sha256: orderHash } });
  await fixture.State.updateOne(scope, { $set: {
    'currentOrder.sourceSnapshot': sourceSnapshot, 'currentOrder.ocrSelection': ocrSelection,
    'activeRun.ocrSelection': ocrSelection, 'activeRun.snapshotRef.sha256': snapshotHash,
    'activeRun.snapshotRef.artifactId': `${fixture.runId}:snapshot:${snapshotHash}`,
    'activeRun.checkpointRefs.1.sha256': orderHash,
    'activeRun.checkpointRefs.1.artifactId': `${fixture.runId}:system-order:normalized:${orderHash}`,
  } });
  const target = { ...fixture.proof.reviewBaseline, baselineMarkdown: order, headers: ['備註', '總數', '單價', '類別'], rows: boundRows, sourceMappings: [sourceMapping] };
  const systemOrder = { ...fixture.proof.orderPublication.systemOrder, markdown: order, sha256: orderHash, sourceSnapshot, ocrSelection, reviewMetadata, updatedAt: savedAt };
  const proof = { ...fixture.proof, finalSha256: orderHash, currentSystemOrderSha256: orderHash, reviewBaseline: target,
    orderPublication: { ...fixture.proof.orderPublication, inputSnapshotSha256: snapshotHash, normalizedSha256: orderHash, systemOrder },
    message: { ...fixture.proof.message, text: order } };
  const result = await fixture.methods.saveSteelQuotationMessage(proof);
  expect(result.ok).toBe(true);
  expect(await fixture.Artifact.countDocuments({ ...scope, runId: fixture.runId, operationId: 'order-published' })).toBe(1);
  expect((await fixture.Output.findOne({ ...scope, outputId: `system_order:${fixture.runId}` }).lean())?.rows[0]?.source).toMatchObject({
    fileId, pageNumber: 1, filename: sourceFilename, mediaType: sourceMediaType,
  });
});

it('keeps an early publication read-only when a later final callback is replayed', async () => {
  const fixture = await prepareEarlyOrderPublication();
  expect((await fixture.methods.saveSteelQuotationMessage(fixture.proof)).ok).toBe(true);
  const before = await mongoose.models.Message.findOne({ messageId: fixture.responseId }).lean();
  const finalMarkdown = `${fixture.proof.orderPublication.systemOrder.markdown}\n\n## quote_summary\n\n完成`;
  const finalSha = sha(finalMarkdown);
  await fixture.Artifact.create({ ...scope, runId: fixture.runId, operationId: 'final', kind: 'final', sha256: finalSha, payload: finalMarkdown });
  await fixture.State.updateOne(scope, {
    $set: { 'activeRun.status': 'completed' },
    $push: { 'activeRun.checkpointRefs': {
      operationId: 'final', kind: 'final', artifactId: `${fixture.runId}:final:${finalSha}`, sha256: finalSha, updatedAt: new Date(),
    } },
  });
  const { orderPublication: _orderPublication, ...finalBase } = fixture.proof;
  const final = await fixture.methods.saveSteelQuotationMessage({
    ...finalBase,
    finalSha256: finalSha,
    currentSystemOrderSha256: fixture.proof.currentSystemOrderSha256,
    message: { ...fixture.proof.message, text: finalMarkdown, unfinished: false },
  });
  expect(final.ok).toBe(true);
  expect(await mongoose.models.Message.findOne({ messageId: fixture.responseId }).lean()).toEqual(before);
  expect(await fixture.Artifact.countDocuments({ ...scope, runId: fixture.runId, operationId: 'published' })).toBe(0);
});
