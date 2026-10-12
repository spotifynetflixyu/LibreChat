import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { SteelMarkdownReference, SteelQuotationScope, IMessage, ISteelQuotationState, ISteelQuotationArtifact } from '~/types';
import { createSteelCustomerMethods } from './steelCustomer';
import { createSteelHistoryMethods } from './steelHistory';
import { createMessageMethods } from './message';
import { createModels } from '~/models';

let server: MongoMemoryReplSet;
const scope: SteelQuotationScope = { userId: 'user-1', conversationId: '019c6e27-e55b-73d1-87d8-4e01f1f75043' };
const query = { ...scope, messageId: 'assistant-1', title: 'customer_data', outputId: 'customer:one' };
const customer = '## customer_data\n\n| 客戶編號 | 客戶名稱 | **價格等級** | 說明 |\n| --- | --- | --- | --- |\n| C1 | 客戶甲 | B | 原始\\|說明 |';
const text = `前言\n\n${customer}\n\n## unrelated\n\n保持原文`;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const methods = createSteelCustomerMethods(mongoose);
const ai: SteelMarkdownReference = { kind: 'customer_data', source: 'ai', snapshotId: 'snapshot:one',
  generationId: 'generation:one', outputId: query.outputId, messageId: query.messageId, title: query.title,
  revision: 'revision:one', sha256: sha(customer), lineageId: 'lineage:one', savedAt: new Date('2026-10-08T00:00:00Z'), version: 1 };

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  await Promise.all(Object.values(createModels(mongoose)).map((model) => model.init()));
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  await mongoose.models.Conversation.create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'agents' });
  await mongoose.models.Message.create({ ...query, user: scope.userId, text, isCreatedByUser: false, unfinished: false,
    content: [{ type: 'text', text }, { type: 'image_file', image_file: { file_id: 'keep-image' } }],
    metadata: { steelMarkdownOwners: { customer_data: ai }, keep: 'metadata' } });
  await mongoose.models.SteelQuotationState.create({ ...scope, currentCustomer: { preparationId: 'preparation:one',
    customerMarkdown: customer, customerIdentity: 'customer:C1', triggeringMessageId: 'user:one', responseId: query.messageId,
    selectionProvenance: { method: 'unique', lookupMessageId: 'lookup:one' } },
    markdownPublication: { nextSequence: 1, current: { customer_data: { ai, effective: ai } } },
    customerLookupEvidence: { responseId: 'lookup:one', lookupMessageId: 'lookup:one', orderHash: 'hash', customers: [] } });
  await mongoose.models.SteelQuotationArtifact.create({ ...scope, runId: 'markdown:generation:one', operationId: 'ai:customer_data',
    kind: 'main', sha256: sha(customer), payload: customer,
    markdownPublication: { reference: ai, rawMarkdown: customer, baselineMarkdown: customer } });
});
const save = (tier: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' = 'D', revision = ai.revision, expectedTier: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' = 'B') =>
  methods.commitSteelCustomer({ ...query, tier, revision, expectedTier });

it('atomically changes the grade and description and persists customer preparation, text mirrors and immutable history', async () => {
  const before = await methods.readSteelCustomer(query);
  expect(before).toMatchObject({ ok: true, value: { tier: 'B', latest: true, revision: ai.revision } });
  const result = await save();
  expect(result).toMatchObject({ ok: true, value: { tier: 'D', latest: true, message: { text: text.replace('| B |', '| D |').replace('原始\\|說明', '指定為D等級') } } });
  const stored = await mongoose.models.Message.findOne({ messageId: query.messageId }).lean<IMessage>().orFail();
  expect(stored.text).toBe(text.replace('| B |', '| D |').replace('原始\\|說明', '指定為D等級'));
  expect(stored.content?.[0]).toMatchObject({ text: stored.text });
  expect(stored.content?.[1]).toEqual({ type: 'image_file', image_file: { file_id: 'keep-image' } });
  expect(stored.metadata?.keep).toBe('metadata');
  const state = await mongoose.models.SteelQuotationState.findOne(scope).lean<ISteelQuotationState>().orFail();
  expect(state.currentCustomer).toMatchObject({ customerMarkdown: customer.replace('| B |', '| D |').replace('原始\\|說明', '指定為D等級'), customerIdentity: 'customer:C1',
    selectionProvenance: { method: 'unique', lookupMessageId: 'lookup:one' } });
  expect(state.currentCustomer?.preparationId).not.toBe('preparation:one');
  expect(state.customerLookupEvidence).toBeUndefined();
  expect(state.markdownPublication?.current?.customer_data?.ai).toEqual(ai);
  const original = await mongoose.models.SteelQuotationArtifact.findOne({ operationId: 'ai:customer_data' }).lean<ISteelQuotationArtifact>().orFail();
  expect(original.markdownPublication?.baselineMarkdown).toBe(customer);
  const history = await createSteelHistoryMethods(mongoose).readSteelMarkdownHistory({ ...scope, messages: [stored] });
  expect(history).toMatchObject([{ kind: 'customer_data', reference: { source: 'human' }, effectiveMarkdown: customer.replace('| B |', '| D |').replace('原始\\|說明', '指定為D等級') }]);
  const versions = await createMessageMethods(mongoose).readSteelMarkdownVersions(scope);
  expect(versions).toHaveLength(1);
  expect(versions?.[0]).toMatchObject({ latest: true, saves: 0, outputId: ai.outputId });
});

it('updates the description on confirmation and treats repeated identical confirmation as a no-op', async () => {
  const first = await save('B');
  expect(first).toMatchObject({ ok: true, value: { tier: 'B', message: { text: text.replace('原始\\|說明', '指定為B等級') } } });
  if (!first.ok) throw new Error('Expected save success');
  const state = await mongoose.models.SteelQuotationState.findOne(scope).lean<ISteelQuotationState>().orFail();
  expect(await save('B', first.value.revision)).toMatchObject({ ok: true, value: { revision: first.value.revision } });
  const after = await mongoose.models.SteelQuotationState.findOne(scope).lean<ISteelQuotationState>().orFail();
  expect(after.currentCustomer?.preparationId).toBe(state.currentCustomer?.preparationId);
  expect(await mongoose.models.SteelQuotationArtifact.countDocuments()).toBe(2);
});

it('returns the effective customer revision for reopen after a save and reload', async () => {
  const saved = await save('F');
  if (!saved.ok) throw new Error('Expected save success');
  const versions = await createMessageMethods(mongoose).readSteelMarkdownVersions(scope);
  expect(versions).toMatchObject([{ title: query.title, messageId: query.messageId, outputId: query.outputId,
    revision: saved.value.revision, latest: true }]);
  expect(await save('C', versions![0].revision, 'F')).toMatchObject({ ok: true, value: { tier: 'C' } });
});

it('rejects stale revisions and serializes simultaneous edits', async () => {
  expect(await save('F', 'wrong')).toEqual({ ok: false, code: 'CUSTOMER_CONFLICT' });
  const results = await Promise.all([save('A'), save('F')]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: 'CUSTOMER_CONFLICT' }]);
  expect(await mongoose.models.SteelQuotationArtifact.countDocuments()).toBe(2);
});

it('keeps previous customer edits in history and rejects edits after regeneration', async () => {
  expect(await save()).toMatchObject({ ok: true });
  await mongoose.models.SteelQuotationState.updateOne(scope, { $set: { 'markdownPublication.current.customer_data.ai.outputId': 'new:owner' } });
  expect(await methods.readSteelCustomer(query)).toMatchObject({ ok: true, value: { latest: false, tier: 'D' } });
  expect(await save('A')).toEqual({ ok: false, code: 'CUSTOMER_HISTORICAL' });
  const stored = await mongoose.models.Message.findOne({ messageId: query.messageId }).lean<IMessage>().orFail();
  expect(await createSteelHistoryMethods(mongoose).readSteelMarkdownHistory({ ...scope, messages: [stored] }))
    .toMatchObject([{ effectiveMarkdown: customer.replace('| B |', '| D |').replace('原始\\|說明', '指定為D等級') }]);
});

it('does not reveal or change another user or tenant customer', async () => {
  for (const outside of [{ userId: 'other' }, { tenantId: 'other' }]) {
    expect(await methods.readSteelCustomer({ ...query, ...outside })).toEqual({ ok: false, code: 'CUSTOMER_NOT_FOUND' });
    expect(await methods.commitSteelCustomer({ ...query, ...outside, tier: 'A', expectedTier: 'B', revision: ai.revision })).toEqual({ ok: false, code: 'CUSTOMER_NOT_FOUND' });
  }
  expect(await mongoose.models.SteelQuotationArtifact.countDocuments()).toBe(1);
});

it('rejects malformed or duplicate tables and divergent text parts without writes', async () => {
  await mongoose.models.Message.updateOne({ messageId: query.messageId }, { $set: { text: `${text}\n\n${customer}` } });
  expect(await save()).toEqual({ ok: false, code: 'CUSTOMER_INVALID_TABLE' });
  await mongoose.models.Message.updateOne({ messageId: query.messageId }, { $set: { text, content: [{ type: 'text', text: 'divergent' }] } });
  expect(await save()).toEqual({ ok: false, code: 'CUSTOMER_CONFLICT' });
  expect(await mongoose.models.SteelQuotationArtifact.countDocuments()).toBe(1);
});

it('invalidates the prior quotation and updates default customer identity', async () => {
  await mongoose.models.SteelQuotationState.updateOne(scope, { $set: {
    'currentCustomer.customerIdentity': 'explicit-default:B',
    currentSystemOrder: { runId: 'old', messageId: 'old-message', markdown: 'old', sha256: 'old-hash', updatedAt: new Date() },
  } });
  expect(await save('C')).toMatchObject({ ok: true });
  const state = await mongoose.models.SteelQuotationState.findOne(scope).lean<ISteelQuotationState>().orFail();
  expect(state.currentCustomer?.customerIdentity).toBe('explicit-default:C');
  expect(state.currentSystemOrder?.needsRequote).toBe(true);
});

it('blocks edits during an unpublished quotation', async () => {
  await mongoose.models.SteelQuotationState.updateOne(scope, { $set: { activeRun: {
    runId: 'busy', index: 1, status: 'completed', triggerMessageId: 'trigger', targetMessageId: 'quote',
    snapshotRef: { artifactId: 'busy:snapshot', ...scope, runId: 'busy', operationId: 'snapshot', kind: 'snapshot', sha256: 'hash' },
    chunks: [], checkpointRefs: [], acceptedAt: new Date(), updatedAt: new Date(),
  } } });
  expect(await save()).toEqual({ ok: false, code: 'CUSTOMER_BUSY' });
  expect(await mongoose.models.SteelQuotationArtifact.countDocuments()).toBe(1);
});

it.each(['messageId', 'title', 'outputId', 'kind'] as const)('does not reuse a customer revision from a mismatched effective %s', async (field) => {
  const saved = await save('D');
  if (!saved.ok) throw new Error('Expected save success');
  await mongoose.models.SteelQuotationState.updateOne(scope, { $set: {
    [`markdownPublication.current.customer_data.effective.${field}`]: field === 'kind' ? 'ocr_result' : 'different',
  } });
  const versions = await createMessageMethods(mongoose).readSteelMarkdownVersions(scope);
  expect(versions?.[0].revision).toBe(ai.revision);
  expect(await methods.readSteelCustomer(query)).toEqual({ ok: false, code: 'CUSTOMER_CONFLICT' });
  const before = await mongoose.models.Message.findOne({ messageId: query.messageId }).lean<IMessage>().orFail();
  expect(await save('F', saved.value.revision)).toEqual({ ok: false, code: 'CUSTOMER_CONFLICT' });
  const after = await mongoose.models.Message.findOne({ messageId: query.messageId }).lean<IMessage>().orFail();
  expect(after.text).toBe(before.text);
  expect(await mongoose.models.SteelQuotationArtifact.countDocuments()).toBe(2);
});

it('rejects a stale displayed tier even when the submitted revision is current', async () => {
  const saved = await save('F');
  if (!saved.ok) throw new Error('Expected save success');
  expect(await save('B', saved.value.revision, 'B')).toEqual({ ok: false, code: 'CUSTOMER_CONFLICT' });
  const stored = await mongoose.models.Message.findOne({ messageId: query.messageId }).lean<IMessage>().orFail();
  expect(stored.text).toContain('| F | 指定為F等級 |');
  expect(await mongoose.models.SteelQuotationArtifact.countDocuments()).toBe(2);
});
