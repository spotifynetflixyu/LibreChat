import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMessageModel } from '~/models/message';
import { createMessageMethods } from './message';

let mongo: MongoMemoryServer;
const scope = { user: 'user', conversationId: 'conversation', parentMessageId: 'parent', messageId: 'response' };
const error = 'An error occurred while processing the request';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => { await mongoose.connection.dropDatabase(); });
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function seed(fields: Record<string, unknown> = {}) {
  return createMessageModel(mongoose).create({
    ...scope, isCreatedByUser: false, text: 'published',
    content: [{ type: 'text', text: 'published' }],
    metadata: { preserved: true }, ...fields,
  });
}

it('preserves published content and metadata and appends the same terminal error once', async () => {
  await seed({ content: [{ type: 'tool_call', tool_call: { id: 'tool' } }, { type: 'text', text: 'published' }] });
  const { appendMessageError } = createMessageMethods(mongoose);
  await Promise.all(Array.from({ length: 8 }, () => appendMessageError({ ...scope, error })));
  const stored = await createMessageModel(mongoose).findOne(scope).lean();
  expect(stored).toMatchObject({ text: 'published', metadata: { preserved: true }, error: false });
  expect(stored?.content).toEqual([
    { type: 'tool_call', tool_call: { id: 'tool' } }, { type: 'text', text: 'published' },
    { type: 'error', error },
  ]);
});

it('normalizes a text-only response without losing its text', async () => {
  await seed({ content: undefined });
  const result = await createMessageMethods(mongoose).appendMessageError({ ...scope, error: '$private' });
  expect(result?.content).toEqual([{ type: 'text', text: 'published' }, { type: 'error', error: '$private' }]);
  expect(result?.text).toBe('published');
});

it.each(['user', 'conversationId', 'parentMessageId', 'messageId'] as const)('rejects a mismatched %s', async (field) => {
  await seed();
  expect(await createMessageMethods(mongoose).appendMessageError({ ...scope, [field]: 'other', error })).toBeNull();
});

it('rejects user rows and retains an already-durable standalone error row', async () => {
  const row = await seed({ isCreatedByUser: true });
  const { appendMessageError } = createMessageMethods(mongoose);
  expect(await appendMessageError({ ...scope, error })).toBeNull();
  await row.updateOne({ $set: { isCreatedByUser: false, error: true } });
  const retained = await appendMessageError({ ...scope, error });
  expect(retained).toMatchObject({ error: true, text: 'published' });
  expect(retained?.content).toEqual([{ type: 'text', text: 'published' }]);
});

it('requires the exact tenant, including tenant absence', async () => {
  await seed({ tenantId: 'tenant-a' });
  const { appendMessageError } = createMessageMethods(mongoose);
  expect(await appendMessageError({ ...scope, error })).toBeNull();
  expect(await appendMessageError({ ...scope, tenantId: 'tenant-b', error })).toBeNull();
  expect(await appendMessageError({ ...scope, tenantId: 'tenant-a', error })).toMatchObject({ tenantId: 'tenant-a' });
});

it('never recreates a deleted message', async () => {
  const row = await seed();
  await row.deleteOne();
  expect(await createMessageMethods(mongoose).appendMessageError({ ...scope, error })).toBeNull();
  expect(await createMessageModel(mongoose).countDocuments()).toBe(0);
});

it('preserves an edit committed before the terminal append', async () => {
  const row = await seed();
  await row.updateOne({ $set: { text: 'corrected', content: [{ type: 'text', text: 'corrected' }] } });
  const result = await createMessageMethods(mongoose).appendMessageError({ ...scope, error });
  expect(result?.text).toBe('corrected');
  expect(result?.content).toEqual([{ type: 'text', text: 'corrected' }, { type: 'error', error }]);
});
