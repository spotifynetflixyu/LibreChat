import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createSteelConversationTurnModel,
  createSteelWorkingOrderMemoryModel,
} from '@librechat/data-schemas';

import {
  createMongooseSteelConversationHistoryRepository,
  createMongooseSteelWorkingOrderMemoryRollbackRepository,
} from './repository';

const createdAt = new Date('2026-06-17T00:00:00.000Z');
const supersededAt = new Date('2026-06-17T00:01:00.000Z');

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Mongoose Steel conversation history repository', () => {
  it('idempotently appends turns with final response and queued steer metadata', async () => {
    const repository = createMongooseSteelConversationHistoryRepository(mongoose);

    const first = await repository.appendTurn({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_1',
      turnIndex: 2,
      role: 'assistant',
      source: 'assistant_final',
      content: 'final quote',
      tableHashes: ['hash_1'],
      finalResponseMetadata: {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        responseId: 'resp_1',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      },
    });
    const second = await repository.appendTurn({
      conversationId: 'steel_conversation_1',
      messageId: 'assistant_1',
      turnIndex: 2,
      role: 'assistant',
      source: 'assistant_final',
      content: 'final quote',
      tableHashes: ['hash_1'],
      finalResponseMetadata: {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        responseId: 'resp_1',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      },
    });
    const steer = await repository.appendTurn({
      conversationId: 'steel_conversation_1',
      messageId: 'steer_1',
      requestId: 'request_1',
      turnIndex: 3,
      role: 'user',
      source: 'queued_steer',
      content: '數量改成 3 支',
      queuedSteer: {
        targetRequestId: 'request_1',
        status: 'queued',
      },
    });

    expect(second.id).toBe(first.id);
    expect(second.finalResponseMetadata).toEqual(
      expect.objectContaining({
        provider: 'openai_oauth_responses',
        responseId: 'resp_1',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      }),
    );
    expect(steer.queuedSteer).toEqual({
      targetRequestId: 'request_1',
      status: 'queued',
    });
  });

  it('updates edited user text and excludes later superseded turns from active history', async () => {
    const repository = createMongooseSteelConversationHistoryRepository(mongoose);
    const SteelConversationTurn = createSteelConversationTurnModel(mongoose);

    await repository.appendTurn({
      conversationId: 'steel_conversation_1',
      messageId: 'u1',
      turnIndex: 1,
      role: 'user',
      source: 'user_input',
      content: '原本 1 支',
    });
    await repository.appendTurn({
      conversationId: 'steel_conversation_1',
      messageId: 'a1',
      turnIndex: 2,
      role: 'assistant',
      source: 'assistant_final',
      content: '| 項次 | 數量 |\n|---|---|\n| 1 | 1 |',
    });
    await repository.appendTurn({
      conversationId: 'steel_conversation_1',
      messageId: 's1',
      turnIndex: 3,
      role: 'user',
      source: 'queued_steer',
      content: '順便急件',
    });

    const updatedTurn = await repository.updateUserMessageRevision({
      conversationId: 'steel_conversation_1',
      messageId: 'u1',
      nextContent: '改成 2 支',
      editedAt: supersededAt,
    });
    const supersededCount = await repository.markTurnsSupersededAfter({
      conversationId: 'steel_conversation_1',
      turnIndex: 1,
      supersededAt,
      supersededByMessageId: 'u1',
    });
    const activeTurns = await repository.listActiveTurns({
      conversationId: 'steel_conversation_1',
    });
    const supersededAssistant = await SteelConversationTurn.findOne({
      messageId: 'a1',
    }).lean();

    expect(updatedTurn?.content).toBe('改成 2 支');
    expect(updatedTurn?.revisions).toEqual([
      {
        content: '原本 1 支',
        revisedAt: supersededAt,
      },
    ]);
    expect(supersededCount).toBe(2);
    expect(activeTurns.map((turn) => turn.messageId)).toEqual(['u1']);
    expect(supersededAssistant?.state).toBe('superseded');
    expect(supersededAssistant?.supersededByMessageId).toBe('u1');
  });
});

describe('Mongoose Steel working-order memory rollback repository', () => {
  it('logically supersedes memory entries from the edited turn boundary onward', async () => {
    const repository = createMongooseSteelWorkingOrderMemoryRollbackRepository(mongoose);
    const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

    await SteelWorkingOrderMemory.create([
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 0,
        checkpointTurnIndex: 0,
        memoryKind: 'customer_fact',
        sourceKind: 'user_input',
        state: 'active',
        summary: '既有客戶',
        createdAt,
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 2,
        checkpointTurnIndex: 1,
        memoryKind: 'working_order_row',
        sourceKind: 'assistant_final_markdown',
        state: 'active',
        summary: '舊表格第 1 項',
        createdAt,
      },
      {
        conversationId: 'steel_conversation_1',
        turnIndex: 3,
        checkpointTurnIndex: 1,
        memoryKind: 'price_evidence',
        sourceKind: 'tool_result',
        state: 'active',
        summary: '舊價格',
        createdAt,
      },
    ]);

    const supersededCount = await repository.markEntriesSupersededFromTurn({
      conversationId: 'steel_conversation_1',
      turnIndex: 1,
      supersededAt,
      supersededByMessageId: 'u1',
    });
    const activeEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      state: 'active',
    })
      .sort({ turnIndex: 1 })
      .lean();
    const supersededEntries = await SteelWorkingOrderMemory.find({
      conversationId: 'steel_conversation_1',
      state: 'superseded',
    }).lean();

    expect(supersededCount).toBe(2);
    expect(activeEntries.map((entry) => entry.summary)).toEqual(['既有客戶']);
    expect(supersededEntries.map((entry) => entry.summary).sort()).toEqual([
      '舊價格',
      '舊表格第 1 項',
    ]);
    expect(supersededEntries.every((entry) => entry.supersededByMessageId === 'u1')).toBe(true);
  });
});
