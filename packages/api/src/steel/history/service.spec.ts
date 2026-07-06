import {
  createSteelConversationHistoryService,
  type SteelConversationTurnRecord,
  type SteelConversationHistoryRepository,
  type SteelWorkingOrderMemoryRollbackRepository,
} from './service';

const createdAt = new Date('2026-06-17T00:00:00.000Z');
const editedAt = new Date('2026-06-17T00:01:00.000Z');

function createTurn(overrides: Partial<SteelConversationTurnRecord>): SteelConversationTurnRecord {
  return {
    id: overrides.messageId ?? 'turn_1',
    conversationId: 'steel_conversation_1',
    messageId: 'message_1',
    requestId: 'request_1',
    turnIndex: 1,
    role: 'user',
    source: 'user_input',
    state: 'active',
    content: 'original',
    revisions: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function createDeps() {
  const matchesScope = (
    turn: SteelConversationTurnRecord,
    scope: { conversationId: string; userId?: string },
  ) =>
    turn.conversationId === scope.conversationId &&
    (scope.userId === undefined || turn.userId === scope.userId);
  const turns = [
    createTurn({ messageId: 'u1', turnIndex: 1, content: '原本要 1 支' }),
    createTurn({
      messageId: 'a1',
      turnIndex: 2,
      role: 'assistant',
      source: 'assistant_final',
      content: '| 項次 | 型號 | 數量 |\n|---|---|---|\n| 1 | CCG075 | 1 |',
    }),
    createTurn({
      messageId: 's1',
      turnIndex: 3,
      source: 'queued_steer',
      content: '順便改成急件',
    }),
  ];
  const historyRepository: SteelConversationHistoryRepository = {
    appendTurn: jest.fn(async (turn) =>
      createTurn({
        ...turn,
        id: turn.messageId,
        createdAt,
        updatedAt: createdAt,
      }),
    ),
    findTurnByMessageId: jest.fn(async ({ conversationId, messageId, userId }) => {
      return (
        turns.find(
          (turn) => matchesScope(turn, { conversationId, userId }) && turn.messageId === messageId,
        ) ?? null
      );
    }),
    listActiveTurns: jest.fn(async ({ conversationId, userId }) => {
      return turns.filter(
        (turn) => matchesScope(turn, { conversationId, userId }) && turn.state === 'active',
      );
    }),
    markTurnsSupersededAfter: jest.fn(
      async ({ conversationId, turnIndex, supersededAt, userId }) => {
        let updatedCount = 0;
        for (const turn of turns) {
          if (!matchesScope(turn, { conversationId, userId }) || turn.turnIndex <= turnIndex) {
            continue;
          }
          turn.state = 'superseded';
          turn.supersededAt = supersededAt;
          updatedCount += 1;
        }
        return updatedCount;
      },
    ),
    updateUserMessageRevision: jest.fn(
      async ({ conversationId, messageId, nextContent, editedAt, userId }) => {
        const turn = turns.find(
          (candidate) =>
            matchesScope(candidate, { conversationId, userId }) &&
            candidate.messageId === messageId,
        );
        if (!turn) {
          return null;
        }
        const previousContent = turn.content;
        turn.content = nextContent;
        turn.updatedAt = editedAt;
        turn.revisions = [
          ...turn.revisions,
          {
            content: previousContent,
            revisedAt: editedAt,
          },
        ];
        return turn;
      },
    ),
  };
  const memoryRepository: SteelWorkingOrderMemoryRollbackRepository = {
    markEntriesSupersededFromTurn: jest.fn(async () => 4),
  };

  return { historyRepository, memoryRepository, turns };
}

describe('Steel conversation history service', () => {
  it('edits a user message by superseding later turns and rolling memory back', async () => {
    const deps = createDeps();
    const service = createSteelConversationHistoryService({
      historyRepository: deps.historyRepository,
      memoryRepository: deps.memoryRepository,
      now: () => editedAt,
    });

    const result = await service.editUserMessage({
      conversationId: 'steel_conversation_1',
      messageId: 'u1',
      nextContent: '改成 2 支',
    });

    expect(result.updatedTurn.content).toBe('改成 2 支');
    expect(result.supersededTurnCount).toBe(2);
    expect(result.supersededMemoryCount).toBe(4);
    expect(deps.historyRepository.markTurnsSupersededAfter).toHaveBeenCalledWith({
      conversationId: 'steel_conversation_1',
      turnIndex: 1,
      supersededAt: editedAt,
      supersededByMessageId: 'u1',
    });
    expect(deps.memoryRepository.markEntriesSupersededFromTurn).toHaveBeenCalledWith({
      conversationId: 'steel_conversation_1',
      turnIndex: 1,
      supersededAt: editedAt,
      supersededByMessageId: 'u1',
    });
    expect(deps.turns.find((turn) => turn.messageId === 'a1')?.state).toBe('superseded');
    expect(deps.turns.find((turn) => turn.messageId === 's1')?.state).toBe('superseded');
  });

  it('scopes edit and reload history operations by user id when provided', async () => {
    const deps = createDeps();
    deps.turns.forEach((turn) => {
      turn.userId = 'user_a';
    });
    deps.turns.push(
      createTurn({
        userId: 'user_b',
        messageId: 'u2',
        turnIndex: 1,
        content: '別人的對話',
      }),
    );
    const service = createSteelConversationHistoryService({
      historyRepository: deps.historyRepository,
      memoryRepository: deps.memoryRepository,
      now: () => editedAt,
    });

    await service.editUserMessage({
      conversationId: 'steel_conversation_1',
      messageId: 'u1',
      nextContent: 'user_a 改成 2 支',
      userId: 'user_a',
      editedByUserId: 'user_a',
    });
    const activeTurns = await service.listActiveTurns({
      conversationId: 'steel_conversation_1',
      userId: 'user_a',
    });

    expect(deps.historyRepository.findTurnByMessageId).toHaveBeenCalledWith({
      conversationId: 'steel_conversation_1',
      messageId: 'u1',
      userId: 'user_a',
    });
    expect(deps.historyRepository.markTurnsSupersededAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'steel_conversation_1',
        userId: 'user_a',
      }),
    );
    expect(deps.memoryRepository.markEntriesSupersededFromTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'steel_conversation_1',
        userId: 'user_a',
      }),
    );
    expect(activeTurns.map((turn) => turn.messageId)).toEqual(['u1']);
  });

  it('builds prompt history from active latest-visible turns only', async () => {
    const deps = createDeps();
    const service = createSteelConversationHistoryService({
      historyRepository: deps.historyRepository,
      memoryRepository: deps.memoryRepository,
      now: () => editedAt,
    });

    await service.editUserMessage({
      conversationId: 'steel_conversation_1',
      messageId: 'u1',
      nextContent: '改成 2 支',
    });
    const historyWindow = await service.buildHistoryWindow({
      conversationId: 'steel_conversation_1',
      maxTurns: 10,
    });

    expect(deps.historyRepository.listActiveTurns).toHaveBeenCalledWith({
      conversationId: 'steel_conversation_1',
      maxTurns: 10,
    });
    expect(historyWindow).toEqual([
      expect.objectContaining({
        content: '改成 2 支',
        messageId: 'u1',
        role: 'user',
      }),
    ]);
  });

  it('lists all active turns for UI conversation reload', async () => {
    const deps = createDeps();
    const service = createSteelConversationHistoryService({
      historyRepository: deps.historyRepository,
      memoryRepository: deps.memoryRepository,
      now: () => editedAt,
    });

    const activeTurns = await service.listActiveTurns({
      conversationId: 'steel_conversation_1',
    });

    expect(deps.historyRepository.listActiveTurns).toHaveBeenCalledWith({
      conversationId: 'steel_conversation_1',
    });
    expect(activeTurns.map((turn) => turn.messageId)).toEqual(['u1', 'a1', 's1']);
  });
});
