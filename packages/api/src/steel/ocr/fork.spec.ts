import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createModels,
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
  createSteelWorkingOrderMemoryModel,
} from '@librechat/data-schemas';
import { createSteelOcrForkService } from './fork';
import { prepareQuotationTurn } from '../quotation/preparation';
import { finalizeOcrResponse } from './result';
import { createSteelOcrStateService } from './state';

let server: MongoMemoryServer;
const userId = new mongoose.Types.ObjectId().toString();
const otherUserId = new mongoose.Types.ObjectId().toString();
const models = createModels(mongoose);
const State = createSteelConversationOcrStateModel(mongoose);
const Memory = createSteelWorkingOrderMemoryModel(mongoose);
const Runs = createSteelDelegateOcrRunModel(mongoose);
const full = (quantity: number, title = 'ocr_result'): string => `## ${title}\n\n| 來源 | 零件編號 | 類別 | 數量 | 備註 |\n| --- | --- | --- | --- | --- |\n| F1 | A-6M06 | H型鋼 | ${quantity} | 每件14孔；總${quantity * 14}孔 |`;
type ForkMessages = Parameters<ReturnType<typeof createSteelOcrForkService>['prepare']>[0]['messages'];
const messages: ForkMessages = [
  { messageId: 'u1', parentMessageId: null, isCreatedByUser: true, text: 'OCR', files: [{ file_id: 'file-1' }] },
  { messageId: 'a1', parentMessageId: 'u1', isCreatedByUser: false, text: full(7) },
  { messageId: 'u2', parentMessageId: 'a1', isCreatedByUser: true, text: '數量改為3' },
  { messageId: 'a2', parentMessageId: 'u2', isCreatedByUser: false, text: full(3, 'ocr_result_updates') },
];
const input = (selected = messages, targetMessageId = selected[selected.length - 1].messageId) => ({
  userId, sourceConversationId: 'source', destinationConversationId: 'fork',
  messages: selected, targetMessageId,
  messageIdMap: new Map(selected.map((message) => [message.messageId, `fork-${message.messageId}`])),
});
const memory = (requestId = 'a1', payload: Record<string, unknown> = {}) => ({
  conversationId: 'source', requestId, turnIndex: 1, checkpointTurnIndex: 0,
  memoryKind: 'ocr_extract', sourceKind: 'ocr_result', state: 'active',
  payload: { fileId: 'file-1', ocrFileKey: 'file:file-1', content: '原始 OCR markdown', ...payload },
  sourceRefs: [{ sourceKind: 'file', fileId: 'file-1', filename: 'AH.pdf' }],
});

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Promise.all(Object.values(models).map((model) => model.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
beforeEach(async () => {
  await Promise.all([models.Conversation.deleteMany({}), models.File.deleteMany({}), State.deleteMany({}), Memory.deleteMany({}), Runs.deleteMany({}), models.SteelQuotationState.deleteMany({})]);
  await models.Conversation.create({ conversationId: 'source', user: userId, endpoint: 'agents' });
  await models.File.create({ user: userId, file_id: 'file-1', bytes: 10, filename: 'AH.pdf', filepath: '/AH.pdf', type: 'application/pdf' });
  await State.create({
    conversationId: 'source', nextDelegateOcrIndex: 9,
    sourceMappings: [{ fileId: 'file-1', sourceCode: 'F1', sourceFilename: 'AH.pdf' }],
    currentOcrResultMarkdown: full(99), currentOcrResultMessageId: 'future',
    activeDelegateClaim: { claimToken: 'live', triggeringMessageId: 'future', delegateOcrIndex: 9, phase: 'agent_running', claimedAt: new Date(), updatedAt: new Date() },
  });
});

it('reconstructs the selected order, copies independent evidence, and supplies it on the next correction turn', async () => {
  const sourceMemory = await Memory.create(memory());
  await Memory.create(memory('future', { content: 'must not copy future' }));
  const fork = await createSteelOcrForkService(mongoose).prepare(input());
  expect(await State.exists({ conversationId: 'fork' })).toBeNull();
  await fork.persist();
  const saved = await State.findOne({ conversationId: 'fork' }).lean();
  expect(saved?.currentOcrResultMarkdown).toBe(full(3));
  expect(saved?.currentOcrResultMessageId).toBe('fork-a2');
  expect(saved?.activeDelegateClaim).toBeUndefined();
  expect(saved?.nextDelegateOcrIndex).toBe(0);
  expect(saved?.sourceMappings).toHaveLength(1);
  const evidence = await Memory.find({ conversationId: 'fork' }).lean();
  expect(evidence).toHaveLength(1);
  expect(String(evidence[0]._id)).not.toBe(String(sourceMemory._id));
  expect(evidence[0].requestId).toBe('fork-a1');
  expect(evidence[0].payload).toEqual(sourceMemory.payload);
  const turn = await prepareQuotationTurn({
    scope: { conversationId: 'fork', userId }, messageId: 'next-user', responseId: 'next-response', text: '數量改為2',
  });
  expect(turn.instruction).toContain('"hasOcrResult":true');
  expect(turn.state.currentOrder?.markdown).toBe(full(3));
  const correction = finalizeOcrResponse({ assistantResponse: full(2, 'ocr_result_updates'), previousOcrMarkdown: turn.state.currentOrder?.markdown, canonicalMapping: [], agentKind: 'other' });
  expect(correction.ok).toBe(true);
  if (!correction.ok) throw new Error('Correction failed');
  await createSteelOcrStateService(mongoose).upsertCurrentOcrResult({
    conversationId: 'fork', markdown: correction.ocrResultMarkdown,
    messageId: 'next-response', generationId: 'next-generation', attemptNumber: 1,
    expectedGenerationId: saved?.currentOcrResultGenerationId,
  });
  expect((await State.findOne({ conversationId: 'fork' }))?.currentOcrResultMarkdown).toBe(full(2));
  expect((await State.findOne({ conversationId: 'source' }))?.currentOcrResultMarkdown).toBe(full(99));
  await Memory.updateOne({ _id: evidence[0]._id }, { $set: { 'payload.content': 'fork changed' } });
  expect((await Memory.findById(sourceMemory._id))?.payload).toEqual(sourceMemory.payload);
});

it('uses the target ancestry even when sibling and future messages were copied', async () => {
  const sibling = { messageId: 'sibling', parentMessageId: 'u1', isCreatedByUser: false, text: full(50) };
  await (await createSteelOcrForkService(mongoose).prepare(input([...messages, sibling], 'a1'))).persist();
  expect((await State.findOne({ conversationId: 'fork' }))?.currentOcrResultMarkdown).toBe(full(7));
});

it('prefers the published canonical full result appended after a visible delta', async () => {
  const selected = messages.map((message) => message.messageId === 'a2' ? { ...message, text: `${full(3, 'ocr_result_updates')}\n\n${full(3)}` } : message);
  await (await createSteelOcrForkService(mongoose).prepare(input(selected))).persist();
  expect((await State.findOne({ conversationId: 'fork' }))?.currentOcrResultMarkdown).toBe(full(3));
});

it('does not promote a user-pasted table or an update without a copied base', async () => {
  const selected = messages.slice(2).map((message) => message.messageId === 'u2' ? { ...message, text: full(100) } : message);
  await (await createSteelOcrForkService(mongoose).prepare(input(selected))).persist();
  expect((await State.findOne({ conversationId: 'fork' }))?.currentOcrResultMarkdown).toBeUndefined();
});

it.each([
  '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| F1 | broken |',
  `${full(3)}\n\n${full(4)}`,
  '## ocr_result_updates\n\nbroken',
])('rejects malformed or ambiguous selected OCR instead of publishing a stale base: %s', async (text) => {
  const selected = messages.map((message) => message.messageId === 'a2' ? { ...message, text } : message);
  await expect(createSteelOcrForkService(mongoose).prepare(input(selected))).rejects.toThrow();
  expect(await State.exists({ conversationId: 'fork' })).toBeNull();
});

it('copies completed delegate evidence only with selected generation provenance and remaps references', async () => {
  const run = { conversationId: 'source', delegateOcrIndex: 1, claimToken: 'old-claim', triggeringMessageId: 'u1', targetMessageId: 'a1', responseGenerationId: 'gen-1', status: 'completed', currentStage: 'completed', toolParameters: {}, files: [{ fileId: 'file-1', filename: 'AH.pdf' }] };
  await Runs.create(run);
  await Runs.create({ ...run, delegateOcrIndex: 2, claimToken: 'active-claim', responseGenerationId: 'active-gen', status: 'agent_running' });
  await Memory.create(memory('gen-1', { preflightMode: 'delegate', delegateOcrIndex: 1, targetMessageId: 'a1', generationId: 'gen-1', ocrPreprocessing: { preflightMode: 'delegate', delegateOcrIndex: 1 } }));
  await Memory.create(memory('active-gen', { preflightMode: 'delegate', delegateOcrIndex: 2 }));
  await (await createSteelOcrForkService(mongoose).prepare(input(messages.slice(0, 2)))).persist();
  const evidence = await Memory.find({ conversationId: 'fork' }).lean();
  expect(evidence).toHaveLength(1);
  expect(evidence[0].requestId).not.toBe('gen-1');
  expect(evidence[0].payload).toEqual(expect.objectContaining({ targetMessageId: 'fork-a1', generationId: evidence[0].requestId }));
  expect(await Runs.countDocuments({ conversationId: 'fork' })).toBe(0);
  expect(evidence[0].payload).toEqual(expect.objectContaining({ preflightMode: 'regular', ocrPreprocessing: { preflightMode: 'regular' } }));
  expect((await State.findOne({ conversationId: 'fork' }))?.currentOcrResultGenerationId).toBe(evidence[0].requestId);
  await models.Conversation.create({ conversationId: 'fork', user: userId, endpoint: 'agents' });
  const forkMessages = messages.slice(0, 2).map((message) => ({ ...message, messageId: `fork-${message.messageId}`, parentMessageId: message.parentMessageId ? `fork-${message.parentMessageId}` : null }));
  const secondInput = { ...input(forkMessages), sourceConversationId: 'fork', destinationConversationId: 'second' };
  await (await createSteelOcrForkService(mongoose).prepare(secondInput)).persist();
  expect(await Memory.countDocuments({ conversationId: 'second' })).toBe(1);
});

it('blocks other owners, foreign attachments, and preexisting destinations', async () => {
  await expect(createSteelOcrForkService(mongoose).prepare({ ...input(), userId: otherUserId })).rejects.toThrow('ownership');
  await models.File.updateOne({ file_id: 'file-1' }, { $set: { user: otherUserId } });
  await expect(createSteelOcrForkService(mongoose).prepare(input())).rejects.toThrow('attachment');
  await models.File.updateOne({ file_id: 'file-1' }, { $set: { user: userId } });
  await State.create({ conversationId: 'fork' });
  await expect(createSteelOcrForkService(mongoose).prepare(input())).rejects.toThrow('already exists');
});

it('cleans partial OCR writes after insertion failure without deleting source data', async () => {
  await Memory.create(memory());
  const fork = await createSteelOcrForkService(mongoose).prepare(input());
  jest.spyOn(Memory, 'insertMany').mockRejectedValueOnce(new Error('write failed'));
  await expect(fork.persist()).rejects.toThrow('write failed');
  expect(await State.exists({ conversationId: 'fork' })).toBeNull();
  expect(await Memory.countDocuments({ conversationId: 'source' })).toBe(1);
  expect(await State.exists({ conversationId: 'source' })).not.toBeNull();
});


it('rejects source codes without a verified attachment mapping', async () => {
  const selected = messages.slice(0, 2).map((message) => message.messageId === 'a1' ? { ...message, text: full(3).replace('F1', 'F2') } : message);
  await expect(createSteelOcrForkService(mongoose).prepare(input(selected))).rejects.toThrow('Missing OCR fork source mapping');
});

it('recovers a mapping from published history and copied file metadata when source state is missing', async () => {
  await State.deleteOne({ conversationId: 'source' });
  const selected = messages.slice(0, 2).map((message) => message.messageId === 'a1' ? { ...message, text: `## source_file_mapping\n\n| 來源 | 檔名 |\n| --- | --- |\n| F1 | AH.pdf |\n\n${full(3)}` } : message);
  await (await createSteelOcrForkService(mongoose).prepare(input(selected))).persist();
  expect((await State.findOne({ conversationId: 'fork' }))?.sourceMappings[0].fileId).toBe('file-1');
});

it('permits text orders without pretending there is an original attachment', async () => {
  const selected = [{ messageId: 'text', parentMessageId: null, isCreatedByUser: false, text: full(3).replace('F1', '文字訂單') }];
  await (await createSteelOcrForkService(mongoose).prepare(input(selected))).persist();
  expect((await State.findOne({ conversationId: 'fork' }))?.sourceMappings).toHaveLength(0);
});

it('uses stored canonical markdown only when its provenance names the selected assistant message', async () => {
  await State.updateOne({ conversationId: 'source' }, { $set: { currentOcrResultMessageId: 'a1', currentOcrResultMarkdown: full(3) } });
  const selected = messages.slice(0, 2).map((message) => message.messageId === 'a1' ? { ...message, text: 'OCR 已完成' } : message);
  await (await createSteelOcrForkService(mongoose).prepare(input(selected))).persist();
  expect((await State.findOne({ conversationId: 'fork' }))?.currentOcrResultMarkdown).toBe(full(3));
});


it('forks ordinary conversations without OCR state or files', async () => {
  await State.deleteOne({ conversationId: 'source' });
  const selected = [{ messageId: 'plain', parentMessageId: null, isCreatedByUser: false, text: 'Hello' }];
  await (await createSteelOcrForkService(mongoose).prepare(input(selected))).persist();
  expect((await State.findOne({ conversationId: 'fork' }))?.currentOcrResultMarkdown).toBeUndefined();
});
