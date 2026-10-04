import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Response as ServerResponse } from 'express';
import type { SteelMarkdownCompletionDependencies, SteelPublishedResponseIdentity } from './completion';
import type { SteelResponseRequest } from '../quotation/completion';
import type { ResponseEvent } from '../../agents/responses/types';
import type { SteelMarkdownCompletionInput } from './completion';
import { createSteelMarkdownCompletionServices, registerSteelMarkdownPublication, shouldDeferSteelMarkdownPersistence } from './completion';
import { renderQuotationCustomerMarkdown, prepareQuotationTurn, bindQuotationCustomerResult } from '../quotation/preparation';
import { buildResponse, createResponseTracker, emitOutputTextDone } from '../../agents/responses/handlers';
import { finalizeSteelResponsesTurn, replaceSteelResponsesMarkdown } from '../quotation/transport';
import { acceptQuotationSignal, publishCompletedQuotation } from '../quotation/runner';
import { extractSteelNativeResponseOutputText } from '../native/markdown';
import { createSystemOrderRevisionService } from '../quotation/revision';
import { SteelResponseCompletionError } from '../quotation/completion';
import { createSteelQuotationStateService } from '../quotation/state';
import { createSteelOcrResponseAuditService } from '../ocr/audit';
import { createSteelOcrStateService } from '../ocr/state';

jest.mock('../native/context', () => ({
  buildDefaultSteelGlobalAgentContext: jest.fn(async () => ({ instructionPrefix: 'test quotation rules' })),
}));

const scope = { userId: 'completion-user', conversationId: 'completion-conversation' };
const order = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| 文字訂單 | P1 | 鋼板 | 2 |';
let mongo: MongoMemoryServer;
let dependencies: SteelMarkdownCompletionDependencies;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(() => {
  dependencies = { ocr: createSteelOcrStateService(mongoose), quotation: createSteelQuotationStateService(mongoose),
    audit: createSteelOcrResponseAuditService(mongoose) };
});
afterEach(async () => { await mongoose.connection.dropDatabase(); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

async function turn(markdown: string, text = '確認訂單', language = 'zh-TW') {
  const quotation = await prepareQuotationTurn({ scope, messageId: 'user-message', responseId: 'response', text });
  const req: SteelResponseRequest = { user: { id: scope.userId }, cookies: { lang: language },
    steelNativeContext: { requestId: 'response', quotation } };
  let current = markdown;
  const writes: string[] = [];
  const input: SteelMarkdownCompletionInput = { req, responseId: 'response', generationId: 'generation', markdown, completed: true,
    applyMarkdown: (value: string) => { current = value; },
    persistMarkdown: async (options?: { completed: boolean }) => {
      writes.push(current);
      await mongoose.connection.collection('completion_messages').updateOne({ messageId: 'response' },
        { $set: { markdown: current, unfinished: options?.completed === false } }, { upsert: true });
      return { messageId: 'response' };
    } };
  return { input, writes, req, quotation, run: () => createSteelMarkdownCompletionServices(dependencies).finalize(input) };
}

async function seedCustomer(tier: 'A' | 'B' = 'B') {
  const state = await dependencies.quotation.readState(scope);
  await dependencies.quotation.saveCustomer({ scope, customerMarkdown: renderQuotationCustomerMarkdown({ tier }),
    customerIdentity: `explicit-default:${tier}`, triggeringMessageId: 'prior-user', responseId: 'prior-response',
    orderHash: state?.currentOrder?.sha256,
    selectionProvenance: { method: 'default_tier', selectionMessageId: 'prior-user' } });
}

it.each([false, true])('saves attachment OCR before footer with existing customer=%s', async (customer) => {
  await dependencies.ocr.allocateDelegateSourceMapping({ conversationId: scope.conversationId, fileId: 'file', sourceFilename: 'order.pdf' });
  if (customer) await seedCustomer();
  const expectedOrder = order.replace('文字訂單', 'F1');
  const markdown = `## source_file_mapping\n\n| 來源 | 檔名 |\n| --- | --- |\n| F1 | order.pdf |\n\n${expectedOrder}`;
  const fixture = await turn(markdown);
  fixture.req.steelNativeContext!.ocrTurnActive = true;
  fixture.req.steelNativeContext!.contextMetadata = { mode: 'ocr' };
  expect(fixture.quotation.state.currentOrder).toBeUndefined();
  const originalPersist = fixture.input.persistMarkdown;
  const observed: (string | undefined)[] = [];
  fixture.input.persistMarkdown = async () => {
    observed.push((await dependencies.ocr.readCurrentOcrResult(scope.conversationId))?.markdown);
    return originalPersist();
  };
  const result = await fixture.run();
  expect(result.markdown).toContain(customer ? '請確認資料後回覆「報價」' : '請提供客戶名稱以確認客戶等級');
  expect(result.markdown.match(/\*\*下一步：\*\*/gu)).toHaveLength(1);
  expect(observed).toEqual([undefined, expectedOrder]);
  expect((await dependencies.quotation.readState(scope))?.currentOrder?.markdown).toBe(expectedOrder);
  expect((await mongoose.connection.collection('completion_messages').findOne({ messageId: 'response' }))?.markdown).toBe(result.markdown);
});

it.each(['A', 'B', 'C', 'D', 'E', 'F'] as const)('commits tier %s before deciding next steps', async (tier) => {
  await dependencies.ocr.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'earlier', attemptNumber: 1, markdown: order });
  const fixture = await turn(renderQuotationCustomerMarkdown({ tier }), tier.toLowerCase());
  expect(fixture.quotation.state.currentCustomer).toBeUndefined();
  const result = await fixture.run();
  expect((await dependencies.quotation.readState(scope))?.currentCustomer?.customerMarkdown).toBe(renderQuotationCustomerMarkdown({ tier }));
  expect(result.markdown).toContain('請確認資料後回覆「報價」');
});

it('commits the presented trusted lookup before footer', async () => {
  await dependencies.ocr.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'earlier', attemptNumber: 1, markdown: order });
  const fixture = await turn('', '客戶一');
  const result = await bindQuotationCustomerResult({ scope, messageId: 'user-message', responseId: 'response',
    expectedOrderHash: fixture.quotation.state.currentOrder!.sha256,
    result: { ok: true, toolName: 'search_customers', durationMs: 1, redactionVersion: 1,
      data: { customers: [{ id: 1, erpCustomerCode: 'C1', displayName: '客戶一', customerTier: 'A' }] } } });
  if (!result.ok || typeof result.data.customerDataMarkdown !== 'string') throw new Error('lookup fixture failed');
  expect((await dependencies.quotation.readState(scope))?.currentCustomer).toBeUndefined();
  fixture.input.markdown = result.data.customerDataMarkdown;
  const finalized = await fixture.run();
  expect(finalized.markdown).toContain('請確認資料後回覆「報價」');
  expect((await dependencies.quotation.readState(scope))?.currentCustomer?.customerIdentity).toBe('1');
});

it('merges changed OCR rows and saves the complete order before the footer', async () => {
  const base = `${order}\n| 文字訂單 | P2 | 角鐵 | 4 |`;
  await dependencies.ocr.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'earlier', attemptNumber: 1, markdown: base, messageId: 'base-message' });
  await seedCustomer();
  const fixture = await turn(order.replace('ocr_result', 'ocr_result_updates').replace('鋼板 | 2', '鋼板 | 3'), 'P1 數量改成3');
  const result = await fixture.run();
  const saved = await dependencies.ocr.readCurrentOcrResult(scope.conversationId);
  expect(saved?.markdown).toContain('| P1 | 鋼板 | 3 |');
  expect(saved?.markdown).toContain('| P2 | 角鐵 | 4 |');
  expect(result.markdown).toContain('## ocr_result\n');
  expect(result.markdown).toContain('請確認資料後回覆「報價」');
});

it.each(['en', 'zh-TW'])('uses the current response language %s', async (language) => {
  const fixture = await turn(order, '確認', language);
  const result = await fixture.run();
  expect(result.markdown).toContain(language === 'en' ? '**Next steps:**' : '**下一步：**');
});

it.each(['plain text', '## notes\n\n### **ocr_result_chunk**\n\n| x |\n| --- |\n| y |',
  '## ocr_result_chunk\n\n| 來源 | 零件編號 |\n| --- | --- |\n| F1 | P1 |'])('does not treat child or ordinary text as a full order: %s', async (markdown) => {
  const fixture = await turn(markdown);
  const result = await fixture.run();
  // A named notes data section still uses the missing-order branch, never the chunk table as an order.
  if (markdown.startsWith('## notes')) expect(result.markdown).toContain('請先提供材料訂單');
  else expect(result.markdown).toBe(markdown);
  expect(await dependencies.ocr.readCurrentOcrResult(scope.conversationId)).toBeUndefined();
});

it('does not persist an unfinished OCR as canonical or add a footer', async () => {
  const fixture = await turn(order);
  fixture.input.completed = false;
  expect((await fixture.run()).markdown).toBe(order);
  expect(await dependencies.ocr.readCurrentOcrResult(scope.conversationId)).toBeUndefined();
});

it('does not duplicate canonical writes or footer on a request retry', async () => {
  const fixture = await turn(order);
  const write = jest.spyOn(dependencies.ocr, 'upsertCurrentOcrResult');
  const first = await fixture.run();
  const second = await fixture.run();
  expect(second.markdown).toBe(first.markdown);
  expect(write).toHaveBeenCalledTimes(1);
  expect(second.markdown.match(/\*\*下一步：\*\*/gu)).toHaveLength(1);
});

it('retries a failed decorated save without merging or saving the order again', async () => {
  const fixture = await turn(order);
  const write = jest.spyOn(dependencies.ocr, 'upsertCurrentOcrResult');
  const original = fixture.input.persistMarkdown;
  let fail = true;
  fixture.input.persistMarkdown = async () => {
    if (fail && fixture.writes.length === 1) { fail = false; throw new Error('private failure'); }
    return original();
  };
  await expect(fixture.run()).rejects.toMatchObject({ code: 'response_save_failed' });
  const result = await fixture.run();
  expect(result.markdown).toContain('**下一步：**');
  expect(write).toHaveBeenCalledTimes(1);
});

it('keeps the base message unfinished until canonical OCR state is saved', async () => {
  const fixture = await turn(order);
  jest.spyOn(dependencies.quotation, 'setOrder').mockRejectedValueOnce(new Error('private failure'));
  await expect(fixture.run()).rejects.toBeInstanceOf(SteelResponseCompletionError);
  const message = await mongoose.connection.collection('completion_messages').findOne({ messageId: 'response' });
  expect(message?.unfinished).toBe(true);
  expect(message?.markdown).not.toContain('**下一步：**');
});

it.each(['chat', 'responses'])('adopts a branded pending publication in multi-part %s output without repeating canonical writes', async (transport) => {
  const pending = await turn(order);
  const write = jest.spyOn(dependencies.ocr, 'upsertCurrentOcrResult');
  const result = await createSteelMarkdownCompletionServices(dependencies).finalize({ ...pending.input, stage: 'pending' });
  if (!result.publication) throw new Error('publication missing');
  const prefix = `${order.replace('ocr_result', 'ocr_result_updates')}\n\n`;
  const composite = prefix + result.markdown;
  const parent = await turn(composite);
  parent.req.steelNativeContext!.ocrTurnActive = true;
  parent.req._resumableJobCreatedAt = 123;
  parent.input.generationId = '123';
  registerSteelMarkdownPublication(parent.req, result.publication, 'response');
  if (transport === 'responses') {
    const tracker = createResponseTracker();
    tracker.items.push({ type: 'message', role: 'assistant', id: 'intro', status: 'completed',
      content: [{ type: 'output_text', text: prefix, annotations: [], logprobs: [] }] });
    tracker.currentMessage = { type: 'message', role: 'assistant', id: 'last', status: 'in_progress',
      content: [{ type: 'output_text', text: result.markdown, annotations: [], logprobs: [] }] };
    tracker.items.push(tracker.currentMessage);
    const response = buildResponse({ responseId: 'response', model: 'agent', createdAt: 0 }, tracker, 'completed');
    await finalizeSteelResponsesTurn({ req: parent.req, response, responseId: 'response', store: false,
      saveConversation: async () => {}, saveInput: async () => {}, saveOutput: async () => { await parent.run(); } });
    expect(extractSteelNativeResponseOutputText(response)).toBe(composite);
  } else expect((await parent.run()).markdown).toBe(composite);
  expect((await mongoose.connection.collection('completion_messages').findOne({ messageId: 'response' }))?.markdown).toBe(composite);
  expect(write).toHaveBeenCalledTimes(1);
  expect(Object.isFrozen(result.publication)).toBe(true);
  expect(shouldDeferSteelMarkdownPersistence(parent.req, result.markdown)).toBe(true);
});

it('rejects copied publication objects and superseded pending data', async () => {
  const pending = await turn(order);
  const result = await createSteelMarkdownCompletionServices(dependencies).finalize({ ...pending.input, stage: 'pending' });
  if (!result.publication) throw new Error('publication missing');
  const parent = await turn(result.markdown);
  parent.input.generationId = 'response';
  expect(() => registerSteelMarkdownPublication(parent.req, { ...result.publication! }, 'response'))
    .toThrow(SteelResponseCompletionError);
  registerSteelMarkdownPublication(parent.req, result.publication, 'response');
  await dependencies.ocr.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'newer',
    expectedGenerationId: 'generation', attemptNumber: 1, markdown: order.replace('鋼板 | 2', '鋼板 | 8') });
  await expect(parent.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect(parent.writes).toHaveLength(0);
});

it.each(['message', 'ocr', 'quotation'] as const)('does not publish a success footer after %s persistence failure', async (stage) => {
  const fixture = await turn(order);
  if (stage === 'message') fixture.input.persistMarkdown = async () => { throw new Error('private connection string'); };
  if (stage === 'ocr') jest.spyOn(dependencies.ocr, 'upsertCurrentOcrResult').mockResolvedValueOnce(null);
  if (stage === 'quotation') jest.spyOn(dependencies.quotation, 'setOrder').mockRejectedValueOnce(new Error('private query'));
  await expect(fixture.run()).rejects.toBeInstanceOf(SteelResponseCompletionError);
  expect(fixture.writes.some((markdown) => markdown.includes('**下一步：**'))).toBe(false);
});

it('rejects a superseded OCR generation before publishing a footer', async () => {
  const fixture = await turn(order);
  const original = dependencies.quotation.setOrder;
  jest.spyOn(dependencies.quotation, 'setOrder').mockImplementationOnce(async (input) => {
    const state = await original(input);
    await dependencies.ocr.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'newer',
      expectedGenerationId: 'generation', attemptNumber: 1, markdown: order.replace('鋼板 | 2', '鋼板 | 9') });
    return state;
  });
  await expect(fixture.run()).rejects.toMatchObject({ code: 'superseded_order' });
  expect(fixture.writes.some((markdown) => markdown.includes('**下一步：**'))).toBe(false);
});

it('validates scope before making any writes', async () => {
  const fixture = await turn(order);
  fixture.req.user = { id: 'another-user' };
  await expect(fixture.run()).rejects.toMatchObject({ code: 'invalid_response_scope' });
  expect(fixture.writes).toEqual([]);
});

it('commits same-turn order and tier before admitting its quotation signal', async () => {
  const fixture = await turn(`${order}\n\n${renderQuotationCustomerMarkdown({ tier: 'B' })}\n\n## quote_signal\n\nstart`, '使用 B 級，報價');
  const result = await createSteelMarkdownCompletionServices(dependencies).finalize({ ...fixture.input, stage: 'workflow' });
  expect(result.acceptedRun?.status).toBe('queued');
  expect(result.markdown).not.toContain('**下一步：**');
  const state = await dependencies.quotation.readState(scope);
  expect(state?.currentOrder?.markdown).toBe(order);
  expect(state?.currentCustomer?.customerMarkdown).toBe(renderQuotationCustomerMarkdown({ tier: 'B' }));
  expect(state?.activeRun?.runId).toBe(result.acceptedRun?.runId);
  expect(fixture.writes).toHaveLength(1);
});

it('retains the saved data gate for a signal with no order/customer', async () => {
  const fixture = await turn('## quote_signal\n\nstart', 'Quote');
  await expect(fixture.run()).rejects.toMatchObject({ code: 'quotation_data_required' });
  expect((await dependencies.quotation.readState(scope))?.activeRun).toBeUndefined();
  expect(fixture.writes.some((markdown) => markdown.includes('**下一步：**'))).toBe(false);
});

it('replays a fresh-request data-plus-signal retry after final-save failure without enqueueing itself', async () => {
  const markdown = `${order}\n\n${renderQuotationCustomerMarkdown({ tier: 'B' })}\n\n## quote_signal\n\nstart`;
  const fixture = await turn(markdown, '使用 B 級，報價');
  const original = fixture.input.persistMarkdown;
  fixture.input.persistMarkdown = async (options) => {
    if (options?.completed) throw new Error('final message save failed');
    return original(options);
  };
  await expect(fixture.run()).rejects.toMatchObject({ code: 'response_save_failed' });
  const accepted = await dependencies.quotation.readState(scope);
  expect(accepted?.activeRun?.status).toBe('queued');
  const retry = await turn(markdown, '使用 B 級，報價');
  const result = await retry.run();
  expect(result.acceptedRun?.runId).toBe(accepted?.activeRun?.runId);
  const saved = await dependencies.quotation.readState(scope);
  expect(saved?.pendingMessages).toHaveLength(0);
  expect(saved?.currentCustomer?.preparationId).toBe(accepted?.currentCustomer?.preparationId);
});

it('replays committed OCR updates with a signal and rejects changed inputs or OCR versions', async () => {
  await dependencies.ocr.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'earlier', attemptNumber: 1, markdown: order });
  await dependencies.quotation.setOrder({ scope, fullMarkdown: order });
  await seedCustomer();
  const markdown = `${order.replace('ocr_result', 'ocr_result_updates').replace('鋼板 | 2', '鋼板 | 3')}\n\n## quote_signal\n\nstart`;
  const fixture = await turn(markdown, '數量改成3，報價');
  const original = fixture.input.persistMarkdown;
  fixture.input.persistMarkdown = async (options) => {
    if (options?.completed) throw new Error('final save failed');
    return original(options);
  };
  await expect(fixture.run()).rejects.toMatchObject({ code: 'response_save_failed' });
  const accepted = await dependencies.quotation.readState(scope);
  expect(accepted?.activeRun?.status).toBe('queued');
  const retry = await turn(markdown, '數量改成3，報價');
  const result = await retry.run();
  expect(result.acceptedRun?.runId).toBe(accepted?.activeRun?.runId);
  expect(result.markdown).toContain('## ocr_result\n');
  expect((await dependencies.quotation.readState(scope))?.pendingMessages).toHaveLength(0);
  const changed = await turn(markdown.replace('鋼板 | 3', '鋼板 | 4'), '數量改成4，報價');
  await expect(changed.run()).rejects.toMatchObject({ code: 'invalid_completion_receipt' });
  expect(changed.writes).toHaveLength(0);
  await dependencies.ocr.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'newer',
    expectedGenerationId: 'generation', attemptNumber: 1, markdown: order.replace('鋼板 | 2', '鋼板 | 8') });
  const stale = await turn(markdown, '數量改成3，報價');
  await expect(stale.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect(stale.writes).toHaveLength(0);
});

async function completedOrder() {
  await dependencies.quotation.setOrder({ scope, fullMarkdown: order });
  await seedCustomer();
  const ticket = await dependencies.quotation.issueTicket({ scope,
    customerMarkdown: renderQuotationCustomerMarkdown({ tier: 'B' }), customerIdentity: 'explicit-default:B',
    triggeringMessageId: 'quote-user', selectionProvenance: { method: 'default_tier', selectionMessageId: 'quote-user' } });
  const run = await dependencies.quotation.acceptSignal({ scope, index: ticket.index, token: ticket.token,
    orderHash: ticket.orderHash, customerMarkdown: ticket.customerMarkdown, customerIdentity: ticket.customerIdentity,
    prompts: { child: 'child', main: 'main' }, chunks: [{ index: 1, sourceRowCount: 1 }], targetMessageId: 'quote-response' });
  const lease = await dependencies.quotation.acquireLease({ scope, runId: run.runId, leaseToken: 'lease' });
  if (!lease) throw new Error('lease missing');
  const systemOrder = '## system_order\n\n| 品名規格 | 數量 | 總數 | 單價 |\n| --- | --- | --- | --- |\n| A | 2 | 2 | 10 |';
  await dependencies.quotation.checkpoint({ scope, runId: run.runId, leaseToken: lease.leaseToken,
    operationId: 'final', kind: 'final', payload: systemOrder });
  const ref = (await dependencies.quotation.readState(scope))?.activeRun?.checkpointRefs.find((entry) => entry.operationId === 'final');
  if (!ref) throw new Error('checkpoint missing');
  await dependencies.quotation.completeRun({ scope, runId: run.runId, leaseToken: lease.leaseToken,
    finalRef: { ...scope, runId: run.runId, ...ref, kind: 'final' } });
  await dependencies.quotation.markPublished({ scope, runId: run.runId, targetMessageId: 'quote-response',
    finalSha256: createHash('sha256').update(systemOrder).digest('hex') });
  const revision = createSystemOrderRevisionService({ read: dependencies.quotation.readState,
    readCurrentSystemOrder: dependencies.quotation.readCurrentSystemOrder, readCheckpoint: dependencies.quotation.readCheckpoint,
    saveCurrentSystemOrder: dependencies.quotation.saveCurrentSystemOrder });
  const snapshot = await revision.readCurrentSystemOrder(scope);
  if (!snapshot) throw new Error('snapshot missing');
  return { systemOrder, snapshot, revision };
}

it('replays system-order updates plus signal after a final-save failure', async () => {
  const { snapshot } = await completedOrder();
  const markdown = `## system_order_updates\n\n| base_hash | row_index | 品名規格 | 數量 | 總數 | 單價 |\n| --- | --- | --- | --- | --- | --- |\n| ${snapshot.sha256} | 1 | A | 2 | 3 | 10 |\n\n## quote_signal\n\nstart`;
  const fixture = await turn(markdown, '總數改成3，報價');
  const original = fixture.input.persistMarkdown;
  fixture.input.persistMarkdown = async (options) => {
    if (options?.completed) throw new Error('final save failed');
    return original(options);
  };
  await expect(fixture.run()).rejects.toMatchObject({ code: 'response_save_failed' });
  const accepted = await dependencies.quotation.readState(scope);
  expect(accepted?.activeRun?.status).toBe('queued');
  const retry = await turn(markdown, '總數改成3，報價');
  const result = await retry.run();
  expect(result.acceptedRun?.runId).toBe(accepted?.activeRun?.runId);
  expect(result.markdown).toContain('| A | 2 | 3 | 10 |');
  expect((await dependencies.quotation.readState(scope))?.pendingMessages).toHaveLength(0);
});

it.each(['ocr', 'system'])('publishes a new flow quotation after committed %s updates without merging the primary correction twice', async (kind) => {
  const { snapshot, systemOrder } = await completedOrder();
  await dependencies.ocr.upsertCurrentOcrResult({ conversationId: scope.conversationId, generationId: 'base', attemptNumber: 1, markdown: order });
  const correction = kind === 'ocr' ? order.replace('ocr_result', 'ocr_result_updates').replace('鋼板 | 2', '鋼板 | 3')
    : `## system_order_updates\n\n| base_hash | row_index | 品名規格 | 數量 | 總數 | 單價 |\n| --- | --- | --- | --- | --- | --- |\n| ${snapshot.sha256} | 1 | A | 2 | 3 | 10 |`;
  const markdown = `${correction}\n\n## quote_signal\n\nstart`;
  const fixture = await turn(markdown, '數量改成3，報價');
  const finalizer = createSteelMarkdownCompletionServices(dependencies);
  const started = await finalizer.finalize({ ...fixture.input, stage: 'workflow' });
  if (!started.acceptedRun) throw new Error('flow not accepted');
  const runId = started.acceptedRun.runId;
  const lease = await dependencies.quotation.acquireLease({ scope, runId, leaseToken: 'new-flow-lease' });
  if (!lease) throw new Error('new flow lease missing');
  const final = systemOrder.replace('| A | 2 | 2 | 10 |', '| A | 3 | 3 | 10 |');
  await dependencies.quotation.checkpoint({ scope, runId, leaseToken: lease.leaseToken, operationId: 'final', kind: 'final', payload: final });
  const ref = (await dependencies.quotation.readState(scope))?.activeRun?.checkpointRefs.find((entry) => entry.operationId === 'final');
  if (!ref) throw new Error('new flow checkpoint missing');
  await dependencies.quotation.completeRun({ scope, runId, leaseToken: lease.leaseToken,
    finalRef: { ...scope, runId, ...ref, kind: 'final' } });
  await dependencies.quotation.markPublished({ scope, runId, targetMessageId: 'response', finalSha256: createHash('sha256').update(final).digest('hex') });
  const composite = `${markdown}\n\n${final}`;
  const result = await finalizer.finalize({ ...fixture.input, markdown: composite, stage: 'ui' });
  expect(result.markdown).toBe(composite);
  expect(result.markdown).not.toContain('**下一步：**');
  expect((await dependencies.quotation.readState(scope))?.pendingMessages).toHaveLength(0);
  const persistedBeforeReplay = await mongoose.connection.collection('completion_messages').findOne({ messageId: 'response' });
  const fresh = await turn(markdown, '數量改成3，報價');
  fresh.input.generationId = 'fresh-generation';
  const replay = await fresh.run();
  expect(replay.markdown).toBe(final);
  expect(await mongoose.connection.collection('completion_messages').findOne({ messageId: 'response' })).toEqual(persistedBeforeReplay);
});

it('replays a completed publication from the saved system order without rewriting the human message', async () => {
  await dependencies.quotation.setOrder({ scope, fullMarkdown: order });
  await seedCustomer();
  const systemOrder = '## system_order\n\n| 品名規格 | 數量 | 總數 | 單價 |\n| --- | --- | --- | --- |\n| A | 2 | 2 | 10 |';
  const completionInput = `${systemOrder}\n\n## quote_signal\n\nstart`;
  const run = await acceptQuotationSignal({
    scope,
    response: completionInput,
    responseId: 'response',
    messageId: 'user-message',
    expectedOrderHash: (await dependencies.quotation.readState(scope))?.currentOrder?.sha256,
    expectedCustomerPreparationId: (await dependencies.quotation.readState(scope))?.currentCustomer?.preparationId,
    completionReceipt: {
      inputHash: createHash('sha256').update(completionInput).digest('hex'),
      markdown: completionInput,
    },
    finishReason: 'stop',
    service: dependencies.quotation,
  });
  if (!run) throw new Error('quotation run was not accepted');
  const lease = await dependencies.quotation.acquireLease({ scope, runId: run.runId, leaseToken: 'replay-lease' });
  if (!lease) throw new Error('quotation lease was not acquired');
  const rawFinal = `${systemOrder}\n\n## customer_quote|歷史\n\n| 項目 | 小計 |\n| --- | --- |\n| A | 20 |\n\n## quote_summary\n\n歷史摘要`;
  await dependencies.quotation.checkpoint({ scope, runId: run.runId, leaseToken: lease.leaseToken,
    operationId: 'final', kind: 'final', payload: rawFinal });
  const finalRef = (await dependencies.quotation.readState(scope))?.activeRun?.checkpointRefs.find(
    (entry) => entry.operationId === 'final',
  );
  if (!finalRef) throw new Error('final checkpoint was not saved');
  await dependencies.quotation.completeRun({ scope, runId: run.runId, leaseToken: lease.leaseToken,
    finalRef: { ...scope, runId: run.runId, ...finalRef, kind: 'final' } });

  const first = await turn(completionInput, '報價');
  const published = await publishCompletedQuotation({
    scope,
    run,
    markdown: rawFinal,
    service: dependencies.quotation,
    publishFinal: async ({ markdown }) => {
      first.input.applyMarkdown(markdown);
      await first.input.persistMarkdown({ completed: true });
    },
  });
  expect(published.markdown).not.toContain('## customer_quote');
  expect(first.writes).toHaveLength(1);

  const beforeState = await dependencies.quotation.readState(scope);
  const savedOrder = await dependencies.quotation.readCurrentSystemOrder(scope);
  if (!beforeState?.currentOrder || !beforeState.currentCustomer || !savedOrder) {
    throw new Error('published quotation state was not materialized');
  }
  const humanSystemOrder = savedOrder.markdown.replace('| A | 2 | 2 | 10 |', '| A | 2 | 2 | 77 |');
  const humanHash = createHash('sha256').update(humanSystemOrder).digest('hex');
  await dependencies.quotation.saveCurrentSystemOrder({
    scope,
    snapshot: { ...savedOrder, markdown: humanSystemOrder, sha256: humanHash, updatedAt: new Date() },
    expectedRunId: run.runId,
    expectedCurrentOrderSha256: beforeState.currentOrder.sha256,
    expectedCustomer: {
      customerIdentity: beforeState.currentCustomer.customerIdentity,
      customerMarkdown: beforeState.currentCustomer.customerMarkdown,
    },
    expectedCurrentSystemOrderSha256: savedOrder.sha256,
    expectedCurrentSystemOrderPresent: true,
  });
  const humanMessage = published.markdown.replace(savedOrder.markdown, humanSystemOrder);
  await mongoose.connection.collection('completion_messages').updateOne(
    { messageId: 'response' },
    { $set: { markdown: humanMessage } },
  );
  const persistedBeforeReplay = await mongoose.connection.collection('completion_messages').findOne({ messageId: 'response' });
  const replay = await turn(completionInput, '報價');
  replay.input.generationId = 'fresh-generation';
  const replayed = await replay.run();

  expect(replayed.markdown).toContain('| A | 2 | 2 | 77 |');
  expect(replayed.markdown).not.toContain('## customer_quote');
  expect(replay.writes).toEqual([]);
  expect(await mongoose.connection.collection('completion_messages').findOne({ messageId: 'response' })).toEqual(persistedBeforeReplay);
  expect((await dependencies.quotation.readCurrentSystemOrder(scope))?.markdown).toBe(humanSystemOrder);
  expect(await dependencies.quotation.readCheckpoint({ scope, runId: run.runId, operationId: 'final' })).toBe(rawFinal);

  await mongoose.connection.collection('completion_messages').updateOne(
    { messageId: 'response' },
    { $set: { conversationId: scope.conversationId, user: scope.userId } },
  );
  const loaded: SteelPublishedResponseIdentity[] = [];
  let loadCount = 0;
  const acceptedReplay = await turn(completionInput, '報價');
  acceptedReplay.input.generationId = 'another-fresh-generation';
  acceptedReplay.input.publishedResponse = {
    load: async () => {
      loadCount += 1;
      const record = await mongoose.connection.collection('completion_messages').findOne({
        messageId: 'response',
        user: scope.userId,
      });
      return record as SteelPublishedResponseIdentity | null;
    },
    accept: (record) => { loaded.push(record); },
  };
  const projected = jest.spyOn(acceptedReplay.input, 'applyMarkdown');
  const acceptedResult = await acceptedReplay.run();
  expect(acceptedResult.markdown).toContain('| A | 2 | 2 | 77 |');
  expect(projected).toHaveBeenCalledWith(acceptedResult.markdown);
  expect(loadCount).toBe(1);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toEqual(expect.objectContaining({
    messageId: 'response', conversationId: scope.conversationId, user: scope.userId,
  }));
  expect(acceptedReplay.writes).toEqual([]);

  const rejectedReplay = await turn(completionInput, '報價');
  rejectedReplay.input.generationId = 'foreign-record-generation';
  rejectedReplay.input.publishedResponse = {
    load: async () => ({ messageId: 'other-response', conversationId: scope.conversationId, user: scope.userId }),
    accept: jest.fn(),
  };
  await expect(rejectedReplay.run()).rejects.toMatchObject({ code: 'response_save_failed' });
  expect(rejectedReplay.writes).toEqual([]);
});

it('keeps streamed revision deltas, done text, completed output and persisted message identical', async () => {
  const { systemOrder, snapshot, revision } = await completedOrder();
  for (const [markdown, text] of [
    [`${systemOrder}\n\n${systemOrder.replace('| A | 2 | 2 | 10 |', '| B | 1 | 1 | 99 |')}`, '核對報價'],
    [`${systemOrder}\n\n${order.replace('鋼板 | 2', '鋼板 | 9')}`, '數量改成9'],
    [`${systemOrder}\n\n${renderQuotationCustomerMarkdown({ tier: 'C' })}`, '使用 C 級'],
  ]) {
    const invalid = await turn(markdown, text);
    await expect(invalid.run()).rejects.toMatchObject({ code: 'invalid_system_order' });
    expect(invalid.writes).toHaveLength(0);
    expect((await dependencies.quotation.readState(scope))?.currentOrder?.markdown).toBe(order);
    expect((await dependencies.quotation.readState(scope))?.currentCustomer?.customerMarkdown).toBe(renderQuotationCustomerMarkdown({ tier: 'B' }));
  }
  const complete = await turn(systemOrder);
  expect((await complete.run()).markdown).toBe(systemOrder);
  const correction = `## system_order_updates\n\n| base_hash | row_index | 品名規格 | 數量 | 總數 | 單價 |\n| --- | --- | --- | --- | --- | --- |\n| ${snapshot.sha256} | 1 | A | 2 | 3 | 10 |`;
  const intro = '已核對報價。\n\n';
  const fixture = await turn(`${intro}${correction}`, '總數改成3');
  const tracker = createResponseTracker();
  tracker.items.push({ type: 'message', role: 'assistant', id: 'intro', status: 'completed',
    content: [{ type: 'output_text', text: intro, annotations: [], logprobs: [] }] });
  tracker.currentMessage = { type: 'message', role: 'assistant', id: 'last', status: 'in_progress',
    content: [{ type: 'output_text', text: correction, annotations: [], logprobs: [] }] };
  tracker.items.push(tracker.currentMessage);
  tracker.accumulatedText = correction;
  const context = { responseId: 'response', model: 'agent', createdAt: 0 };
  const response = buildResponse(context, tracker, 'completed');
  const events: ResponseEvent[] = [];
  const res = { write: (chunk: string) => { if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)) as ResponseEvent); return true; } } as ServerResponse;
  const streamConfig = { res, tracker, context };
  await finalizeSteelResponsesTurn({ req: fixture.req, response, responseId: 'response', store: false, tracker, streamConfig,
    saveConversation: async () => {}, saveInput: async () => {},
    saveOutput: async () => { await createSteelMarkdownCompletionServices(dependencies).finalize({ ...fixture.input,
      applyMarkdown: (markdown) => { fixture.input.applyMarkdown(markdown); replaceSteelResponsesMarkdown(response, markdown); } }); } });
  emitOutputTextDone(streamConfig);
  const delta = events.filter((entry) => entry.type === 'response.output_text.delta').map((entry) => entry.delta).join('');
  const done = events.find((entry) => entry.type === 'response.output_text.done');
  const persisted = await mongoose.connection.collection('completion_messages').findOne({ messageId: 'response' });
  expect(done).toMatchObject({ text: correction + delta });
  expect(extractSteelNativeResponseOutputText(response)).toBe(intro + correction + delta);
  expect(extractSteelNativeResponseOutputText(buildResponse(context, tracker, 'completed'))).toBe(persisted?.markdown);
  expect(persisted?.markdown).toContain('## system_order\n');
  expect(persisted?.markdown).not.toContain('**下一步：**');
  expect(persisted?.unfinished).toBe(false);
  expect((await revision.readCurrentSystemOrder(scope))?.markdown).toContain('| A | 2 | 3 | 10 |');
});
