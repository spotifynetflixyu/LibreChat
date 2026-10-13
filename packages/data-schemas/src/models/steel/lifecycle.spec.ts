import mongoose, { mongo } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
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
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
      args: ['--setParameter', 'enableTestCommands=1'],
    },
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
  it('uses one deletion fence for all protected writes in one transaction, and reacquires it in the next', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    const scope = { userId: 'user-once', conversationId: 'conversation-once' };
    const session = await mongoose.startSession();
    const marker = mongoose.models.SteelConversationLifecycle;
    const fence = jest.spyOn(marker.collection, 'findOneAndUpdate');
    const cleanup = jest.spyOn(marker.collection, 'updateOne');
    const artifact = { ...scope, runId: 'run-one', operationId: 'one', kind: 'main', sha256: 'a'.repeat(64), payload: 'one' };
    try {
      await session.withTransaction(async () => {
        await State.create([stateDocument(scope.userId, scope.conversationId)], { session });
        await Artifact.create([artifact], { session });
        await State.updateOne(scope, { $set: { nextSignalIndex: 1 } }, { session });
      });
      expect(fence).toHaveBeenCalledTimes(1);
      expect(cleanup).not.toHaveBeenCalled();
      expect(await marker.findById(scope.conversationId).lean()).toMatchObject({ revision: 1, deleted: false });
      await session.withTransaction(() => Artifact.create([{ ...artifact, operationId: 'two' }], { session }));
      expect(fence).toHaveBeenCalledTimes(2);
      expect(await marker.findById(scope.conversationId).lean()).toMatchObject({ revision: 2 });
    } finally {
      fence.mockRestore();
      cleanup.mockRestore();
      await session.endSession();
    }
  });

  it('reacquires the deletion fence after the driver retries a whole transaction', async () => {
    const Artifact = createSteelQuotationArtifactModel(mongoose);
    const scope = { userId: 'user-retry', conversationId: 'conversation-retry' };
    const marker = mongoose.models.SteelConversationLifecycle;
    const fence = jest.spyOn(marker.collection, 'findOneAndUpdate');
    const admin = mongoose.connection.db!.admin();
    await admin.command({ configureFailPoint: 'failCommand', mode: { times: 1 },
      data: { failCommands: ['insert'], errorCode: 112, errorLabels: ['TransientTransactionError'] } });
    try {
      await Artifact.create({ ...scope, runId: 'run-one', operationId: 'one', kind: 'main', sha256: 'a'.repeat(64), payload: 'one' });
      expect(fence).toHaveBeenCalledTimes(2);
      expect(await marker.findById(scope.conversationId).lean()).toMatchObject({ revision: 1, deleted: false });
      expect(await Artifact.countDocuments(scope)).toBe(1);
    } finally {
      fence.mockRestore();
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
  });

  it('rolls back a failed primary write without leaving a cleanup reservation', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-rollback', conversationId: 'conversation-rollback' };
    const document = { ...stateDocument(scope.userId, scope.conversationId), cycle: {} };
    document.cycle = document;
    await expect(State.collection.insertOne(document)).rejects.toBeInstanceOf(mongo.BSON.BSONError);
    expect(await mongoose.models.SteelConversationLifecycle.findById(scope.conversationId)).toBeNull();
    expect(await State.countDocuments(scope)).toBe(0);
  });

  it('rejects an unacknowledged write before creating a deletion marker', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const scope = { userId: 'user-w0', conversationId: 'conversation-w0' };
    await expect(State.collection.insertOne(stateDocument(scope.userId, scope.conversationId), { writeConcern: { w: 0 } }))
      .rejects.toThrow('acknowledged MongoDB operations');
    expect(await mongoose.models.SteelConversationLifecycle.findById(scope.conversationId)).toBeNull();
  });

  it('rejects a delayed transaction whose snapshot predates the committed deletion marker', async () => {
    const State = createSteelQuotationStateModel(mongoose);
    const Conversation = createConversationModel(mongoose);
    const scope = { userId: 'user-delayed', conversationId: 'conversation-delayed' };
    await Conversation.create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'agents' });
    const session = await mongoose.startSession();
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let attempts = 0;
    const writer = session.withTransaction(async () => {
      attempts += 1;
      await Conversation.findOne({ conversationId: scope.conversationId }).session(session);
      if (attempts === 1) { entered(); await hold; }
      await State.create([stateDocument(scope.userId, scope.conversationId)], { session });
    });
    const outcome = writer.catch((error: Error) => error);
    try {
      await ready;
      await fenceWrites(mongoose, scope);
      await Conversation.deleteOne({ conversationId: scope.conversationId });
      release();
      await expect(outcome).resolves.toMatchObject({ code: 'STEEL_CONVERSATION_DELETED' });
      expect(await State.countDocuments(scope)).toBe(0);
      expect(await readSteelConversationDeletionScope(mongoose, scope)).toEqual({ deleted: true });
    } finally {
      release();
      await session.endSession();
    }
  });

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
    expect(gate).toMatchObject({ deleted: false });
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
      .toMatchObject({ deleted: false });
  });

  it('preserves the first owner when deletion is requested by a different marker owner', async () => {
    const scope = { userId: 'deleting-owner', conversationId: 'owner-claim' };
    await createConversationModel(mongoose).create({ conversationId: scope.conversationId, user: scope.userId, endpoint: 'openAI' });
    await createSteelQuotationStateModel(mongoose).create(stateDocument('claiming-owner', scope.conversationId));
    await expect(fenceWrites(mongoose, scope)).rejects.toMatchObject({ code: 'STEEL_CONVERSATION_OWNER_MISMATCH' });
    expect(await mongoose.models.SteelConversationLifecycle.findById(scope.conversationId).lean())
      .toMatchObject({ userId: 'claiming-owner', deleted: false });
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
    expect(gate).toMatchObject({ deleted: false });
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
    expect(gate).toMatchObject({ deleted: false });
  }, 60_000);
});
