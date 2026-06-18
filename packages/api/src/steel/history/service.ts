export type SteelConversationTurnRole = 'user' | 'assistant';
export type SteelConversationTurnSource = 'user_input' | 'assistant_final' | 'queued_steer';
export type SteelConversationTurnState = 'active' | 'superseded';
export type SteelProviderId = 'openai_oauth_responses' | 'openai_api';
export type SteelQueuedSteerStatus = 'queued' | 'applied' | 'deferred' | 'superseded';

export interface SteelConversationTurnRevision {
  content: string;
  revisedAt: Date;
  revisedByUserId?: string;
}

export interface SteelConversationTurnAttachmentRef {
  fileId: string;
  filename?: string;
  mediaType?: string;
}

export interface SteelConversationTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface SteelConversationTurnFinalResponseMetadata {
  provider: SteelProviderId;
  model: string;
  responseId?: string;
  usage?: SteelConversationTurnUsage;
}

export interface SteelConversationTurnQueuedSteer {
  targetRequestId: string;
  status: SteelQueuedSteerStatus;
  appliedAt?: Date;
  deferredAt?: Date;
}

export interface SteelConversationTurnRecord {
  id: string;
  conversationId: string;
  requestId?: string;
  messageId: string;
  turnIndex: number;
  role: SteelConversationTurnRole;
  source: SteelConversationTurnSource;
  state: SteelConversationTurnState;
  content: string;
  attachments?: SteelConversationTurnAttachmentRef[];
  tableHashes?: string[];
  finalResponseMetadata?: SteelConversationTurnFinalResponseMetadata;
  queuedSteer?: SteelConversationTurnQueuedSteer;
  revisions: SteelConversationTurnRevision[];
  supersededAt?: Date;
  supersededByMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SteelConversationTurnCreateInput {
  conversationId: string;
  requestId?: string;
  messageId: string;
  turnIndex: number;
  role: SteelConversationTurnRole;
  source: SteelConversationTurnSource;
  state?: SteelConversationTurnState;
  content: string;
  attachments?: SteelConversationTurnAttachmentRef[];
  tableHashes?: string[];
  finalResponseMetadata?: SteelConversationTurnFinalResponseMetadata;
  queuedSteer?: SteelConversationTurnQueuedSteer;
}

interface ConversationScopedInput {
  conversationId: string;
}

interface MessageScopedInput extends ConversationScopedInput {
  messageId: string;
}

interface SupersedeTurnsInput extends ConversationScopedInput {
  turnIndex: number;
  supersededAt: Date;
  supersededByMessageId: string;
}

interface UpdateUserMessageRevisionInput extends MessageScopedInput {
  nextContent: string;
  editedAt: Date;
  editedByUserId?: string;
}

interface MemoryRollbackInput extends SupersedeTurnsInput {}

export interface SteelConversationHistoryRepository {
  appendTurn(turn: SteelConversationTurnCreateInput): Promise<SteelConversationTurnRecord>;
  findTurnByMessageId(input: MessageScopedInput): Promise<SteelConversationTurnRecord | null>;
  listActiveTurns(input: ConversationScopedInput): Promise<SteelConversationTurnRecord[]>;
  markTurnsSupersededAfter(input: SupersedeTurnsInput): Promise<number>;
  updateUserMessageRevision(
    input: UpdateUserMessageRevisionInput,
  ): Promise<SteelConversationTurnRecord | null>;
}

export interface SteelWorkingOrderMemoryRollbackRepository {
  markEntriesSupersededFromTurn(input: MemoryRollbackInput): Promise<number>;
}

interface SteelConversationHistoryServiceDeps {
  historyRepository: SteelConversationHistoryRepository;
  memoryRepository: SteelWorkingOrderMemoryRollbackRepository;
  now?: () => Date;
}

interface EditUserMessageInput extends MessageScopedInput {
  nextContent: string;
  editedByUserId?: string;
}

interface BuildHistoryWindowInput extends ConversationScopedInput {
  maxTurns: number;
}

export class SteelConversationHistoryNotFoundError extends Error {
  constructor() {
    super('Steel conversation turn not found');
    this.name = 'SteelConversationHistoryNotFoundError';
  }
}

export class SteelConversationHistoryRoleError extends Error {
  constructor() {
    super('Only user messages can be edited');
    this.name = 'SteelConversationHistoryRoleError';
  }
}

function byTurnIndex(left: SteelConversationTurnRecord, right: SteelConversationTurnRecord) {
  return left.turnIndex - right.turnIndex;
}

export function createSteelConversationHistoryService({
  historyRepository,
  memoryRepository,
  now = () => new Date(),
}: SteelConversationHistoryServiceDeps) {
  return {
    appendTurn(turn: SteelConversationTurnCreateInput) {
      return historyRepository.appendTurn(turn);
    },

    async editUserMessage({
      conversationId,
      messageId,
      nextContent,
      editedByUserId,
    }: EditUserMessageInput) {
      const targetTurn = await historyRepository.findTurnByMessageId({
        conversationId,
        messageId,
      });

      if (!targetTurn) {
        throw new SteelConversationHistoryNotFoundError();
      }

      if (targetTurn.role !== 'user') {
        throw new SteelConversationHistoryRoleError();
      }

      const supersededAt = now();
      const updatedTurn = await historyRepository.updateUserMessageRevision({
        conversationId,
        messageId,
        nextContent,
        editedAt: supersededAt,
        editedByUserId,
      });

      if (!updatedTurn) {
        throw new SteelConversationHistoryNotFoundError();
      }

      const supersedeInput = {
        conversationId,
        turnIndex: targetTurn.turnIndex,
        supersededAt,
        supersededByMessageId: messageId,
      };
      const [supersededTurnCount, supersededMemoryCount] = await Promise.all([
        historyRepository.markTurnsSupersededAfter(supersedeInput),
        memoryRepository.markEntriesSupersededFromTurn(supersedeInput),
      ]);

      return {
        updatedTurn,
        supersededTurnCount,
        supersededMemoryCount,
      };
    },

    async buildHistoryWindow({ conversationId, maxTurns }: BuildHistoryWindowInput) {
      if (maxTurns <= 0) {
        return [];
      }

      const activeTurns = await historyRepository.listActiveTurns({ conversationId });
      return activeTurns.sort(byTurnIndex).slice(-maxTurns);
    },
  };
}
