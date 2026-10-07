import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { SteelQuotationScope } from '~/types';
import { createSteelConversationOcrStateModel } from '~/models/steel';
import { createConversationModel } from '~/models/convo';
import { createSteelScopedOcrMethods } from './ocr';

const scope: SteelQuotationScope = { userId: 'owner', conversationId: 'conversation' };
const Conversation = createConversationModel(mongoose);
const State = createSteelConversationOcrStateModel(mongoose);
const reader = createSteelScopedOcrMethods(mongoose);
let server: MongoMemoryReplSet;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  await Promise.all([Conversation.init(), State.init()]);
}, 60000);
beforeEach(async () => {
  await Promise.all([Conversation.deleteMany({}), State.deleteMany({})]);
});
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });

async function seed(tenantId?: string) {
  await Conversation.create({ conversationId: scope.conversationId, user: scope.userId, tenantId, endpoint: 'agents' });
  return State.create({ conversationId: scope.conversationId, sourceMappings: [], currentOcrResultMarkdown: 'private OCR' });
}

it.each([undefined, 'tenant-1'])('reads OCR for its single active owner and exact tenant %s', async (tenantId) => {
  await seed(tenantId);
  expect(await reader.readScopedConversationOcrState({ ...scope, tenantId }))
    .toMatchObject({ currentOcrResultMarkdown: 'private OCR' });
});

it('returns documented absence for a missing conversation or OCR record', async () => {
  expect(await reader.readScopedConversationOcrState(scope)).toBeNull();
  await Conversation.create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'agents' });
  expect(await reader.readScopedConversationOcrState(scope)).toBeNull();
});

it('rejects a different owner, tenant and expired conversation', async () => {
  await seed('tenant-1');
  expect(await reader.readScopedConversationOcrState({ ...scope, tenantId: 'tenant-2' })).toBeNull();
  expect(await reader.readScopedConversationOcrState(scope)).toBeNull();
  expect(await reader.readScopedConversationOcrState({ ...scope, userId: 'foreign', tenantId: 'tenant-1' })).toBeNull();
  await Conversation.updateOne({ conversationId: scope.conversationId }, { $set: { expiredAt: new Date(Date.now() - 1000) } });
  expect(await reader.readScopedConversationOcrState({ ...scope, tenantId: 'tenant-1' })).toBeNull();
});

it.each([
  { user: 'foreign-owner' },
  { user: scope.userId, tenantId: 'foreign-tenant' },
  { user: 'expired-foreign', expiredAt: new Date(0) },
])('rejects global OCR whenever a second identity exists %j', async (foreign) => {
  await seed();
  await Conversation.create({ conversationId: scope.conversationId, endpoint: 'agents', ...foreign });
  expect(await reader.readScopedConversationOcrState(scope)).toBeNull();
});

it('propagates a database failure instead of returning absence', async () => {
  await seed();
  const outage = new Error('database unavailable');
  const read = jest.spyOn(State, 'findOne').mockImplementationOnce(() => { throw outage; });
  await expect(reader.readScopedConversationOcrState(scope)).rejects.toBe(outage);
  read.mockRestore();
});


it('reads identity and legacy OCR from one snapshot despite a concurrent foreign writer', async () => {
  await seed();
  const identities = Conversation.find({ conversationId: scope.conversationId });
  const execute = identities.exec.bind(identities);
  jest.spyOn(identities, 'exec').mockImplementationOnce(async () => {
    const owners = await execute();
    await Conversation.create({ conversationId: scope.conversationId, user: 'foreign-owner', endpoint: 'agents' });
    await State.updateOne({ conversationId: scope.conversationId }, { $set: { currentOcrResultMarkdown: 'foreign OCR' } });
    return owners;
  });
  const find = jest.spyOn(Conversation, 'find').mockReturnValueOnce(identities);
  expect(await reader.readScopedConversationOcrState(scope)).toMatchObject({ currentOcrResultMarkdown: 'private OCR' });
  find.mockRestore();
  expect((await State.findOne({ conversationId: scope.conversationId }).lean())?.currentOcrResultMarkdown).toBe('foreign OCR');
  expect(await reader.readScopedConversationOcrState(scope)).toBeNull();
});
