import mongoose, { mongo } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Document as MongoDocument } from 'mongodb';
import {
  createSteelConversationOcrStateModel,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  fenceSteelConversationWrites as fenceWrites,
  readSteelConversationDeletionScope,
} from './index';
import { tenantStorage } from '~/config/tenantContext';
import { createConversationModel } from '../convo';

let mongoServer: MongoMemoryReplSet;

const stateDocument = (userId: string, conversationId: string, tenantId?: string) => ({
  userId,
  conversationId,
  ...(tenantId ? { tenantId } : {}),
  nextSignalIndex: 0,
  tickets: [],
  pendingMessages: [],
});

async function fenceSteelConversationWrites(connection: typeof mongoose, scope: { userId: string; conversationId: string; tenantId?: string }): Promise<boolean> {
  await createConversationModel(connection).updateOne(
    { conversationId: scope.conversationId, user: scope.userId, tenantId: scope.tenantId ?? null },
    { $setOnInsert: { endpoint: 'openAI' } },
    { upsert: true },
  );
  return fenceWrites(connection, scope);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    createConversationModel(mongoose).init(),
    createSteelQuotationStateModel(mongoose).init(),
    createSteelQuotationArtifactModel(mongoose).init(),
    createSteelConversationOcrStateModel(mongoose).init(),
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

describe('Steel conversation lifecycle fence', () => {
  it('creates an active gate for normal writes, direct saves, and bulk inserts', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-normal', conversationId: 'conversation-normal' };

    await State.create(stateDocument(scope.userId, scope.conversationId));
    await new State(stateDocument(scope.userId, 'conversation-save')).save();
    await State.bulkWrite([
      { insertOne: { document: stateDocument(scope.userId, 'conversation-bulk') } },
    ]);

    const Gate = mongoose.models.SteelConversationLifecycle;
    const gate = await Gate.findOne({
      _id: scope.conversationId,
    }).lean();
    expect(gate).toMatchObject({ deleted: false, pendingWrites: 0 });
    expect(await State.countDocuments({ userId: scope.userId })).toBe(3);
  });

  it('rejects late writes after fencing and preserves the deleted readback', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-deleted', conversationId: 'conversation-deleted' };

    await fenceSteelConversationWrites(mongoose, scope);
    await expect(State.create(stateDocument(scope.userId, scope.conversationId))).rejects.toMatchObject({
      code: 'STEEL_CONVERSATION_DELETED',
    });
    await expect(new State(stateDocument(scope.userId, scope.conversationId)).save()).rejects.toMatchObject({
      code: 'STEEL_CONVERSATION_DELETED',
    });
    await expect(State.bulkWrite([
      { insertOne: { document: stateDocument(scope.userId, scope.conversationId) } },
    ])).rejects.toMatchObject({ code: 'STEEL_CONVERSATION_DELETED' });

    expect(await State.countDocuments({ userId: scope.userId })).toBe(0);
    await expect(readSteelConversationDeletionScope(mongoose, scope)).resolves.toEqual({
      deleted: true,
      });
  });

  it('keeps cleanup incomplete while a durable writer reservation is pending', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-pending', conversationId: 'conversation-pending' };
    const gateKey = scope.conversationId;

    await State.create(stateDocument(scope.userId, scope.conversationId));
    const Gate = mongoose.models.SteelConversationLifecycle;
    await Gate.updateOne({ _id: gateKey }, { $inc: { pendingWrites: 1 } });

    await expect(fenceSteelConversationWrites(mongoose, scope)).rejects.toMatchObject({
      code: 'STEEL_CONVERSATION_IDENTITY_PENDING',
    });
    await expect(readSteelConversationDeletionScope(mongoose, scope)).resolves.toEqual({
      deleted: false,
      });

    await Gate.updateOne({ _id: gateKey }, { $inc: { pendingWrites: -1 } });
    await expect(fenceSteelConversationWrites(mongoose, scope)).resolves.toBe(true);
    await expect(readSteelConversationDeletionScope(mongoose, scope)).resolves.toEqual({
      deleted: true,
      });
  });

  it('releases a reservation after a definite duplicate-key rejection', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-duplicate', conversationId: 'conversation-duplicate' };
    await State.create(stateDocument(scope.userId, scope.conversationId));

    await expect(State.create(stateDocument(scope.userId, scope.conversationId))).rejects.toMatchObject({
      code: 11000,
    });
    const gate = await mongoose.models.SteelConversationLifecycle.findOne({
      _id: scope.conversationId,
    }).lean();
    expect(gate).toMatchObject({ pendingWrites: 0 });
  });

  it('clears a reservation after local BSON serialization rejects before send', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-ambiguous', conversationId: 'conversation-ambiguous' };
    const document: Record<string, unknown> = stateDocument(scope.userId, scope.conversationId);
    document.cycle = document;

    await expect(State.collection.insertOne(document)).rejects.toThrow();
    const gate = await mongoose.models.SteelConversationLifecycle.findOne({
      _id: scope.conversationId,
    }).lean();
    expect(gate).toMatchObject({ pendingWrites: 0 });
    await expect(fenceSteelConversationWrites(mongoose, scope)).resolves.toBe(true);
  });

  it('preserves a local write rejection when reservation cleanup also fails', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-cleanup-error', conversationId: 'cleanup-error' };
    const document: Record<string, unknown> = stateDocument(scope.userId, scope.conversationId);
    document.cycle = document;
    const cleanup = jest.spyOn(mongoose.models.SteelConversationLifecycle.collection, 'updateOne')
      .mockRejectedValueOnce(new mongo.MongoNetworkError('cleanup unavailable'));
    try {
      await expect(State.collection.insertOne(document)).rejects.toBeInstanceOf(mongo.BSON.BSONError);
    } finally {
      cleanup.mockRestore();
    }
    expect(await mongoose.models.SteelConversationLifecycle.findById(scope.conversationId).lean())
      .toMatchObject({ pendingWrites: 1 });
  });

  it('keeps a reservation when the driver outcome is an unknown network failure', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-network', conversationId: 'conversation-network' };
    const nativeCollection = (State.collection as unknown as {
      collection: {
        insertOne(document: MongoDocument, options?: Record<string, unknown>): Promise<unknown>;
      };
    }).collection;
    const originalInsertOne = nativeCollection.insertOne;
    nativeCollection.insertOne = async () => {
      throw new mongo.MongoNetworkError('simulated network failure');
    };
    try {
      await expect(State.collection.insertOne(stateDocument(scope.userId, scope.conversationId)))
        .rejects.toThrow('simulated network failure');
    } finally {
      nativeCollection.insertOne = originalInsertOne;
    }

    const gate = await mongoose.models.SteelConversationLifecycle.findOne({
      _id: scope.conversationId,
    }).lean();
    expect(gate).toMatchObject({ pendingWrites: 1 });
    await expect(fenceSteelConversationWrites(mongoose, scope)).rejects.toMatchObject({
      code: 'STEEL_CONVERSATION_IDENTITY_PENDING',
    });
  });

  it('rejects ambiguous upserts and identity moves before the driver write', async () => {
    const State = createSteelQuotationStateModel(mongoose);

    await expect(State.collection.updateOne(
      {
        $or: [
          { userId: 'user-a', conversationId: 'conversation-ambiguous' },
          { userId: 'user-b', conversationId: 'conversation-ambiguous' },
        ],
      },
      { $setOnInsert: { nextSignalIndex: 0, tickets: [], pendingMessages: [] } },
      { upsert: true },
    )).rejects.toThrow('Steel conversation upsert identity is missing.');

    await State.create(stateDocument('user-move', 'conversation-move'));
    await expect(State.collection.updateOne(
      { userId: 'user-move', conversationId: 'conversation-move' },
      { $set: { userId: 'user-other' } },
    )).rejects.toThrow('Steel conversation identity mutation is invalid.');
    await expect(State.findOne({ conversationId: 'conversation-move' })).resolves.toMatchObject({
      userId: 'user-move',
    });

    await expect(State.bulkWrite([
      {
        updateOne: {
          filter: { userId: 'user-move', conversationId: 'conversation-move' },
          update: { $set: { userId: 'user-other' } },
        },
      },
    ])).rejects.toThrow('Steel conversation identity mutation is invalid.');
    await expect(State.collection.replaceOne(
      { userId: 'user-move', conversationId: 'conversation-move' },
      stateDocument('user-other', 'conversation-move'),
    )).rejects.toThrow('Steel conversation identity mutation is not allowed.');
  });

  it('checks the gate for bulk upserts even when no previous artifact exists', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-bulk-upsert', conversationId: 'conversation-bulk-upsert' };

    await fenceSteelConversationWrites(mongoose, scope);
    await expect(State.bulkWrite([
      {
        updateOne: {
          filter: scope,
          update: { $setOnInsert: { nextSignalIndex: 0, tickets: [], pendingMessages: [] } },
          upsert: true,
        },
      },
    ])).rejects.toMatchObject({ code: 'STEEL_CONVERSATION_DELETED' });
    expect(await State.countDocuments({ conversationId: scope.conversationId })).toBe(0);
  });

  it('rejects pipeline and operator-based identity mutations before any write', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-operators', conversationId: 'conversation-operators' };
    await State.create(stateDocument(scope.userId, scope.conversationId));

    await expect(State.collection.updateOne(scope, [{ $set: { conversationId: 'other' } }]))
      .rejects.toThrow('Steel conversation identity mutation is invalid.');
    await expect(State.collection.updateOne(scope, { $unset: { tenantId: 1 } }))
      .rejects.toThrow('Steel conversation identity mutation is invalid.');
    await expect(State.collection.updateOne(scope, { $rename: { conversationId: 'otherId' } }))
      .rejects.toThrow('Steel conversation identity mutation is invalid.');
    await expect(State.collection.updateOne(scope, { $set: { 'conversationId.value': 'other' } }))
      .rejects.toThrow('Steel conversation identity mutation is invalid.');
    await expect(State.findOne({ conversationId: scope.conversationId })).resolves.toMatchObject(scope);
  });

  it('rejects raw and bulk identity moves toward a fenced scope', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const fenced = { userId: 'user-fenced', conversationId: 'conversation-fenced' };
    const alternate = { userId: 'user-alternate', conversationId: fenced.conversationId };
    await fenceSteelConversationWrites(mongoose, fenced);

    await expect(State.collection.updateOne(
      alternate,
      { $set: { userId: fenced.userId } },
      { upsert: true },
    )).rejects.toThrow('Steel conversation identity mutation is invalid.');
    await expect(State.bulkWrite([
      {
        updateOne: {
          filter: alternate,
          update: { $set: { userId: fenced.userId } },
          upsert: true,
        },
      },
    ])).rejects.toThrow('Steel conversation identity mutation is invalid.');
    expect(await State.countDocuments({ conversationId: fenced.conversationId })).toBe(0);
  });

  it('serializes an in-flight transaction before a fence and rejects the later writer', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-race', conversationId: 'conversation-race' };
    const writerSession = await mongoose.startSession();
    let releaseWriter: () => void = () => undefined;
    const writerHeld = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let enteredWriter: () => void = () => undefined;
    const writerEntered = new Promise<void>((resolve) => {
      enteredWriter = resolve;
    });

    const writer = writerSession.withTransaction(async (session) => {
      await State.collection.insertOne(stateDocument(scope.userId, scope.conversationId), { session });
      enteredWriter();
      await writerHeld;
    });

    await writerEntered;
    const fence = fenceSteelConversationWrites(mongoose, scope);
    releaseWriter();
    await writer;
    await fence;
    await writerSession.endSession();

    await expect(State.collection.insertOne(stateDocument(scope.userId, scope.conversationId)))
      .rejects.toMatchObject({ code: 'STEEL_CONVERSATION_DELETED' });
    expect(await State.countDocuments({ conversationId: scope.conversationId })).toBe(1);
  }, 60_000);

  it('classifies a deleted bootstrap gate without querying the aborted transaction', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-deleted-tx', conversationId: 'conversation-deleted-tx' };
    await fenceSteelConversationWrites(mongoose, scope);
    const session = await mongoose.startSession();
    try {
      await expect(session.withTransaction(async (transactionSession) => {
        await State.collection.insertOne(stateDocument(scope.userId, scope.conversationId), {
          session: transactionSession,
        });
      })).rejects.toMatchObject({ code: 'STEEL_CONVERSATION_DELETED' });
    } finally {
      await session.endSession();
    }
    expect(await State.countDocuments(scope)).toBe(0);
  }, 60_000);

  it('preserves a deleted error after an earlier bulk reservation in a transaction', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const active = { userId: 'user-multi', conversationId: 'active-multi' };
    const deleted = { userId: active.userId, conversationId: 'deleted-multi' };
    await fenceSteelConversationWrites(mongoose, deleted);
    const session = await mongoose.startSession();
    try {
      await expect(session.withTransaction(async (transactionSession) => {
        await State.collection.insertMany([
          stateDocument(active.userId, active.conversationId),
          stateDocument(deleted.userId, deleted.conversationId),
        ], { session: transactionSession });
      })).rejects.toMatchObject({ code: 'STEEL_CONVERSATION_DELETED' });
    } finally {
      await session.endSession();
    }
    expect(await State.countDocuments({ userId: active.userId })).toBe(0);
    expect(await mongoose.models.SteelConversationLifecycle.findById(active.conversationId)).toBeNull();
  });

  it('preserves a duplicate rejection and rolls its transactional reservation back', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-duplicate-tx', conversationId: 'duplicate-tx' };
    await State.create(stateDocument(scope.userId, scope.conversationId));
    const session = await mongoose.startSession();
    try {
      await expect(session.withTransaction(async (transactionSession) => {
        await State.collection.insertOne(stateDocument(scope.userId, scope.conversationId), { session: transactionSession });
      })).rejects.toMatchObject({ code: 11000 });
    } finally {
      await session.endSession();
    }
    expect(await mongoose.models.SteelConversationLifecycle.findById(scope.conversationId).lean())
      .toMatchObject({ pendingWrites: 0 });
  });

  it('preserves first-owner binding if the gate is claimed during deletion', async () => {
    const scope = { userId: 'deleting-owner', conversationId: 'owner-claim' };
    await createConversationModel(mongoose).create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'openAI' });
    const Gate = mongoose.models.SteelConversationLifecycle;
    const originalUpdate = Gate.collection.updateOne.bind(Gate.collection);
    const update = jest.spyOn(Gate.collection, 'updateOne').mockImplementationOnce(async (filter, values, options) => {
      await createSteelQuotationStateModel(mongoose).create(stateDocument('claiming-owner', scope.conversationId));
      return originalUpdate(filter, values, options);
    });
    try {
      await expect(fenceWrites(mongoose, scope)).rejects.toMatchObject({ code: 'STEEL_CONVERSATION_OWNER_MISMATCH' });
    } finally {
      update.mockRestore();
    }
    expect(await Gate.findById(scope.conversationId).lean()).toMatchObject({ userId: 'claiming-owner', deleted: false });
  });

  it('refuses conflicting stored ownership outside the active tenant', async () => {
    const scope = { userId: 'owner-a', tenantId: 'tenant-a', conversationId: 'stored-conflict' };
    const Conversation = createConversationModel(mongoose);
    await Conversation.create([
      { conversationId: scope.conversationId, user: scope.userId, tenantId: scope.tenantId, endpoint: 'openAI' },
      { conversationId: scope.conversationId, user: 'owner-b', tenantId: 'tenant-b', endpoint: 'openAI' },
    ]);
    await expect(tenantStorage.run({ tenantId: scope.tenantId }, async () => fenceWrites(mongoose, scope)))
      .rejects.toMatchObject({ code: 'STEEL_CONVERSATION_OWNER_MISMATCH' });
    expect(await mongoose.models.SteelConversationLifecycle.findById(scope.conversationId)).toBeNull();
  });

  it('shares a fence across canonical snapshots and legacy OCR state', async () => {
    const scope = { userId: 'user-shared', conversationId: 'shared-fence' };
    await createSteelConversationOcrStateModel(mongoose).create({ conversationId: scope.conversationId });
    await createSteelQuotationStateModel(mongoose).create(stateDocument(scope.userId, scope.conversationId));
    await fenceSteelConversationWrites(mongoose, scope);
    await expect(createSteelConversationOcrStateModel(mongoose).updateOne(
      { conversationId: scope.conversationId }, { $set: { sourceMappings: [] } },
    )).rejects.toMatchObject({ code: 'STEEL_CONVERSATION_DELETED' });
    await createConversationModel(mongoose).deleteMany({ conversationId: scope.conversationId });
    await expect(fenceWrites(mongoose, scope)).resolves.toBe(true);
    await expect(fenceWrites(mongoose, { ...scope, userId: 'foreign-user' }))
      .rejects.toMatchObject({ code: 'STEEL_CONVERSATION_OWNER_MISMATCH' });
    await expect(readSteelConversationDeletionScope(mongoose, { ...scope, userId: 'foreign-user' }))
      .resolves.toEqual({ deleted: false });
  });

  it('retries concurrent initial gate upserts without losing either artifact', async () => {
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    const scope = { userId: 'user-bootstrap', conversationId: 'conversation-bootstrap' };
    const artifact = (runId: string) => ({
      ...scope,
      runId,
      operationId: `operation-${runId}`,
      kind: 'snapshot' as const,
      sha256: `sha-${runId}`,
      payload: `payload-${runId}`,
    });

    await Promise.all([
      Artifact.collection.insertOne(artifact('run-a')),
      Artifact.collection.insertOne(artifact('run-b')),
    ]);

    expect(await Artifact.countDocuments(scope)).toBe(2);
    const gate = await mongoose.models.SteelConversationLifecycle.findOne({
      _id: scope.conversationId,
    }).lean();
    expect(gate).toMatchObject({ deleted: false, pendingWrites: 0 });
  }, 60_000);

  it('retries concurrent first gate bootstrap inside separate transactions', async () => {
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    const scope = { userId: 'user-bootstrap-tx', conversationId: 'conversation-bootstrap-tx' };
    const sessions = [await mongoose.startSession(), await mongoose.startSession()];
    let readyCount = 0;
    let releaseStart: () => void = () => undefined;
    const start = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const artifact = (runId: string) => ({
      ...scope,
      runId,
      operationId: `operation-${runId}`,
      kind: 'snapshot' as const,
      sha256: `sha-${runId}`,
      payload: `payload-${runId}`,
    });

    try {
      const writes = sessions.map((session, index) => session.withTransaction(async (transactionSession) => {
        readyCount += 1;
        if (readyCount === 2) releaseStart();
        await start;
        return Artifact.collection.insertOne(artifact(`run-${index}`), { session: transactionSession });
      }));
      const outcomes = await Promise.allSettled(writes);
      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    } finally {
      await Promise.all(sessions.map((session) => session.endSession()));
    }

    expect(await Artifact.countDocuments(scope)).toBe(2);
    const gate = await mongoose.models.SteelConversationLifecycle.findOne({
      _id: scope.conversationId,
    }).lean();
    expect(gate).toMatchObject({ deleted: false, pendingWrites: 0 });
  }, 60_000);
});
