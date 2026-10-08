import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  fenceSteelConversationWrites,
  readSteelConversationDeletionScope,
} from './index';
import { createConversationModel } from '../convo';

let mongoServer: MongoMemoryServer;

const stateDocument = (userId: string, conversationId: string, runId = 'run-one') => ({
  userId,
  conversationId,
  nextSignalIndex: 0,
  tickets: [],
  pendingMessages: [],
  runId,
  operationId: `operation-${runId}`,
  kind: 'snapshot' as const,
  sha256: `sha-${runId}`,
  payload: `payload-${runId}`,
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: { storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    createConversationModel(mongoose).init(),
    createSteelQuotationStateModel(mongoose).init(),
    createSteelQuotationArtifactModel(mongoose).init(),
  ]);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
  await mongoose.models.SteelConversationLifecycle?.deleteMany({});
});

it('supports standalone Conversation and Steel writes, then fences after a pending retry', async () => {
  const Conversation = createConversationModel(mongoose);
  const State = createSteelQuotationStateModel(mongoose);
  const scope = { userId: 'standalone-user', conversationId: 'standalone-conversation' };

  await Conversation.create({
    conversationId: scope.conversationId,
    user: scope.userId,
    endpoint: 'openAI',
  });
  await State.create({
    userId: scope.userId,
    conversationId: scope.conversationId,
    nextSignalIndex: 0,
    tickets: [],
    pendingMessages: [],
  });
  await State.updateOne(scope, { $set: { nextSignalIndex: 1 } });
  await State.bulkWrite([
    { insertOne: { document: stateDocument(scope.userId, 'standalone-bulk') } },
  ]);

  const gateKey = scope.conversationId;
  const Gate = mongoose.models.SteelConversationLifecycle;
  await Gate.updateOne({ _id: gateKey }, { $inc: { pendingWrites: 1 } });
  await expect(fenceSteelConversationWrites(mongoose, scope)).rejects.toMatchObject({
    code: 'STEEL_CONVERSATION_IDENTITY_PENDING',
  });
  await Gate.updateOne({ _id: gateKey }, { $inc: { pendingWrites: -1 } });

  await expect(fenceSteelConversationWrites(mongoose, scope)).resolves.toBe(true);
  await expect(readSteelConversationDeletionScope(mongoose, scope)).resolves.toEqual({
    deleted: true,
  });
  await expect(State.create({
    userId: scope.userId,
    conversationId: scope.conversationId,
    nextSignalIndex: 2,
    tickets: [],
    pendingMessages: [],
  })).rejects.toMatchObject({ code: 'STEEL_CONVERSATION_DELETED' });
});
