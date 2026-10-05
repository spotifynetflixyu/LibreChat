import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMethods, createModels, createSteelReviewWriteMethods } from '@librechat/data-schemas';
import type { SteelMarkdownCompletionInput } from './completion';
import { prepareQuotationTurn, renderQuotationCustomerMarkdown } from '../quotation/preparation';
import { createSteelQuotationStateService } from '../quotation/state';
import { createSteelMarkdownCompletionServices } from './completion';
import { createSteelFullMarkdownPublisher } from './full';
import { createSteelOcrStateService } from '../ocr/state';
import { createSteelReviewService } from '../review';

const scope = { userId: '507f1f77bcf86cd799439011', conversationId: '6bf991da-be8c-5300-bd85-ff6ee2d17bb5' };
const order = (quantity: string) => `## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| 文字訂單 | P1 | 鋼板 | ${quantity} |`;
let server: MongoMemoryReplSet;
let db: ReturnType<typeof createMethods>;
const services = () => ({ ocr: createSteelOcrStateService(mongoose), quotation: createSteelQuotationStateService(mongoose) });
beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  const models = createModels(mongoose);
  await Promise.all(Object.values(models).map((model) => model.init()));
  db = createMethods(mongoose);
}, 60000);
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  await mongoose.models.Conversation.create({ ...scope, user: scope.userId, endpoint: 'agents' });
});
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });

async function turn(markdown: string, responseId = 'assistant-2', generationId = 'ai-2', text = '數量2') {
  const quotation = await prepareQuotationTurn({ scope, messageId: `user-${generationId}`, responseId, generationId, publicationStore: db, text });
  let physical = markdown;
  const persist = jest.fn(async () => db.saveMessage({ userId: scope.userId }, { ...scope, messageId: responseId, user: scope.userId, text: physical, isCreatedByUser: false }, { context: 'ordinary completion test' }));
  const input: SteelMarkdownCompletionInput = { req: { user: { id: scope.userId }, cookies: { lang: 'zh-TW' }, steelNativeContext: { requestId: responseId, quotation } },
    responseId, generationId, markdown, completed: true,
    applyMarkdown: (value) => { physical = value; }, persistMarkdown: persist,
    publishMarkdown: createSteelFullMarkdownPublisher({ buildMessage: ({ markdown: clean }) => ({ ...scope, messageId: responseId, user: scope.userId, text: clean, isCreatedByUser: false }), savePublication: db.publishSteelMarkdown }) };
  return { input, persist, run: () => createSteelMarkdownCompletionServices(services()).finalize(input) };
}

it('publishes the full clean response and fresh review baseline atomically', async () => {
  const fixture = await turn(order('2'));
  const result = await fixture.run();
  expect(fixture.persist).not.toHaveBeenCalled();
  expect((await db.getMessage({ user: scope.userId, messageId: 'assistant-2' }))?.text).toBe(result.markdown);
  expect((await services().ocr.readCurrentOcrResult(scope.conversationId))?.markdown).toBe(order('2'));
  expect((await services().quotation.readState(scope))?.currentOrder?.markdown).toBe(order('2'));
  expect(await db.readSteelMarkdownVersions(scope)).toEqual([expect.objectContaining({ latest: true, saves: 0, outputId: 'ocr_result:ai-2' })]);
});

it.each(['## ocr_result_updates\n\n| x |\n| --- |\n| y |', `${order('2')}\n\n## ocr_deletions\n\nP1`])('rejects retired controls before any managed writes', async (markdown) => {
  const fixture = await turn(markdown);
  await expect(fixture.run()).rejects.toMatchObject({ code: 'retired_control_section' });
  expect(fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: 'assistant-2' })).toBeNull();
  expect((await services().quotation.readState(scope))?.currentOrder).toBeUndefined();
});

it('allows fenced historical instructions while requiring a complete real target', async () => {
  const markdown = `\x60\x60\x60markdown\n## ocr_result_updates\nold example\n\x60\x60\x60\n\n${order('2')}`;
  const result = await (await turn(markdown)).run();
  expect(result.markdown).toContain('old example');
  expect((await services().ocr.readCurrentOcrResult(scope.conversationId))?.markdown).toContain(order('2'));
});

it('preserves immutable AI and human history while a new AI owner resets its difference', async () => {
  await (await turn(order('2'))).run();
  const review = createSteelReviewService({ reader: db, writer: createSteelReviewWriteMethods(mongoose) });
  async function save(messageId: string, value: string) {
    const { table } = await review.read({ ...scope, messageId, kind: 'ocr_result', title: 'ocr_result' });
    const prepared = await review.prepare({ ...scope, messageId, title: table.title, kind: table.kind, outputId: table.outputId, revision: table.revision,
      operations: [{ type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value }] }] });
    if (!('operationRequest' in prepared)) throw new Error('Missing operation request');
    return review.commit({ ...scope, ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest });
  }
  await save('assistant-2', '3');
  const savedHumanMessage = await db.getMessage({ user: scope.userId, messageId: 'assistant-2' });
  const humanHistory = await db.readSteelMarkdownHistory({ ...scope, messages: [{ messageId: 'assistant-2', metadata: savedHumanMessage?.metadata ?? undefined }] });
  expect(humanHistory).toEqual([expect.objectContaining({ reference: expect.objectContaining({ source: 'human' }), effectiveMarkdown: order('3') })]);
  const firstVersions = await db.readSteelMarkdownVersions(scope);
  expect(firstVersions).toEqual([expect.objectContaining({ latest: true, saves: 1 })]);
  await (await turn(order('4'), 'assistant-4', 'ai-4', '數量4')).run();
  const historical = await review.read({ ...scope, messageId: 'assistant-2', kind: 'ocr_result', title: 'ocr_result' });
  expect(historical.table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '3' });
  const fresh = await review.read({ ...scope, messageId: 'assistant-4', kind: 'ocr_result', title: 'ocr_result' });
  expect(fresh.table.rows[0].values['數量']).toEqual({ baseline: '4', effective: '4' });
  await save('assistant-4', '5');
  expect(await db.readSteelMarkdownVersions(scope)).toEqual(expect.arrayContaining([
    expect.objectContaining({ messageId: 'assistant-2', latest: false, saves: 1 }),
    expect.objectContaining({ messageId: 'assistant-4', latest: true, saves: 1 }),
  ]));
});

it('creates a fresh baseline for the same text and physical message in a different generation', async () => {
  await (await turn(order('2'))).run();
  await (await turn(order('2'), 'assistant-2', 'ai-4')).run();
  expect(await db.readSteelMarkdownVersions(scope)).toEqual([expect.objectContaining({ outputId: 'ocr_result:ai-4', latest: true, saves: 0 })]);
});

it('publishes confirmed direct tier data with a version badge and no editor', async () => {
  await (await turn(renderQuotationCustomerMarkdown({ tier: 'B' }), 'assistant-customer', 'customer-2', '使用預設 B tier')).run();
  expect(await db.readSteelMarkdownVersions(scope)).toEqual([expect.objectContaining({ kind: 'customer_data', latest: true, saves: 0 })]);
});

it('refuses an older admitted normal turn without overwriting the latest owner', async () => {
  const older = await turn(order('2'));
  const newer = await turn(order('4'), 'assistant-4', 'ai-4');
  await newer.run();
  await expect(older.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect((await services().ocr.readCurrentOcrResult(scope.conversationId))?.markdown).toBe(order('4'));
});

it('commits delegate completion and claim cleanup with its full clean publication', async () => {
  const fixture = await turn(order('2'));
  const ocr = services().ocr;
  await mongoose.models.File.create({ user: scope.userId, conversationId: scope.conversationId,
    file_id: 'order-file', filename: 'order.pdf', filepath: '/test/order.pdf', type: 'application/pdf', bytes: 1, source: 'local' });
  await ocr.allocateDelegateSourceMapping({ conversationId: scope.conversationId, fileId: 'order-file', sourceFilename: 'order.pdf' });
  fixture.input.markdown = `## source_file_mapping\n\n| 來源 | 檔名 |\n| --- | --- |\n| F1 | order.pdf |\n\n${order('2').replace('文字訂單', 'F1')}`;
  const claim = await ocr.claimNewDelegateOcrIndex({ conversationId: scope.conversationId, triggeringMessageId: 'user-ai-2', claimToken: 'delegate-claim' });
  if (!claim) throw new Error('Missing delegate claim');
  await ocr.materializeDelegateOcrRun({ ...claim, toolParameters: {}, files: [{ fileId: 'order-file', filename: 'order.pdf' }] });
  const lease = await ocr.acquireDelegateExecutionLease({ claimToken: claim.claimToken, leaseToken: 'delegate-lease' });
  if (!lease) throw new Error('Missing delegate lease');
  fixture.input.req.steelNativeContext!.delegateOcrContext = { didExecute: true,
    delegateOcrExecutionLease: lease, activeRun: { claimToken: claim.claimToken,
      delegateOcrIndex: claim.delegateOcrIndex, executionLeaseToken: lease.executionLeaseToken, agentAttemptNumber: 1 } };
  const result = await fixture.run();
  const run = await ocr.findDelegateOcrRunByClaimToken(claim.claimToken);
  expect(run?.status).toBe('completed');
  expect(run?.finalizationJournal).toMatchObject({ candidateValidated: true, messagePersisted: true, resultPersisted: true, claimCleared: true });
  expect(await ocr.readActiveDelegateClaim(scope.conversationId)).toBeUndefined();
  expect((await db.getMessage({ user: scope.userId, messageId: 'assistant-2' }))?.text).toBe(result.markdown);
  expect(await fixture.run()).toMatchObject({ markdown: result.markdown });
});
