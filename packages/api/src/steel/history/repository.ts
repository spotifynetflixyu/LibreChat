import {
  createSteelConversationTurnModel,
  createSteelWorkingOrderMemoryModel,
} from '@librechat/data-schemas';

import type {
  SteelConversationTurnRecord,
  SteelConversationHistoryRepository,
  SteelConversationTurnCreateInput,
  SteelConversationTurnAttachmentRef,
  SteelConversationTurnFinalResponseMetadata,
  SteelConversationTurnQueuedSteer,
  SteelConversationTurnRevision,
  SteelWorkingOrderMemoryRollbackRepository,
} from './service';

type Mongoose = typeof import('mongoose');

interface SteelConversationTurnDocument {
  _id: { toString(): string };
  conversationId: string;
  requestId?: string;
  messageId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  source: 'user_input' | 'assistant_final' | 'queued_steer';
  state: 'active' | 'superseded';
  content: string;
  attachments?: SteelConversationTurnAttachmentRef[];
  tableHashes?: string[];
  finalResponseMetadata?: SteelConversationTurnFinalResponseMetadata;
  queuedSteer?: SteelConversationTurnQueuedSteer;
  revisions?: SteelConversationTurnRevision[];
  supersededAt?: Date;
  supersededByMessageId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

function toTurnRecord(document: SteelConversationTurnDocument): SteelConversationTurnRecord {
  const createdAt = document.createdAt ?? new Date();

  return {
    id: document._id.toString(),
    conversationId: document.conversationId,
    requestId: document.requestId,
    messageId: document.messageId,
    turnIndex: document.turnIndex,
    role: document.role,
    source: document.source,
    state: document.state,
    content: document.content,
    attachments: document.attachments,
    tableHashes: document.tableHashes,
    finalResponseMetadata: document.finalResponseMetadata,
    queuedSteer: document.queuedSteer,
    revisions: document.revisions ?? [],
    supersededAt: document.supersededAt,
    supersededByMessageId: document.supersededByMessageId,
    createdAt,
    updatedAt: document.updatedAt ?? createdAt,
  };
}

function createTurnDocument(turn: SteelConversationTurnCreateInput) {
  return {
    ...turn,
    state: turn.state ?? 'active',
  };
}

export function createMongooseSteelConversationHistoryRepository(
  mongoose: Mongoose,
): SteelConversationHistoryRepository {
  const SteelConversationTurn = createSteelConversationTurnModel(mongoose);

  return {
    async appendTurn(turn) {
      const document = await SteelConversationTurn.findOneAndUpdate(
        {
          conversationId: turn.conversationId,
          messageId: turn.messageId,
        },
        {
          $setOnInsert: createTurnDocument(turn),
        },
        {
          new: true,
          upsert: true,
        },
      ).lean<SteelConversationTurnDocument>();

      if (!document) {
        throw new Error('Steel conversation turn upsert did not return a document.');
      }

      return toTurnRecord(document);
    },

    async findTurnByMessageId({ conversationId, messageId }) {
      const document = await SteelConversationTurn.findOne({
        conversationId,
        messageId,
      }).lean<SteelConversationTurnDocument>();

      return document ? toTurnRecord(document) : null;
    },

    async listActiveTurns({ conversationId, maxTurns }) {
      const query = SteelConversationTurn.find({
        conversationId,
        state: 'active',
      });
      const hasLimit = typeof maxTurns === 'number' && maxTurns > 0;
      const documents = await (hasLimit
        ? query.sort({ turnIndex: -1 }).limit(maxTurns)
        : query.sort({ turnIndex: 1 })
      ).lean<SteelConversationTurnDocument[]>();

      return (hasLimit ? documents.reverse() : documents).map(toTurnRecord);
    },

    async markTurnsSupersededAfter({
      conversationId,
      turnIndex,
      supersededAt,
      supersededByMessageId,
    }) {
      const result = await SteelConversationTurn.updateMany(
        {
          conversationId,
          state: 'active',
          turnIndex: { $gt: turnIndex },
        },
        {
          $set: {
            state: 'superseded',
            supersededAt,
            supersededByMessageId,
          },
        },
      );

      return result.modifiedCount;
    },

    async updateUserMessageRevision({
      conversationId,
      messageId,
      nextContent,
      editedAt,
      editedByUserId,
    }) {
      const previous = await SteelConversationTurn.findOne({
        conversationId,
        messageId,
        role: 'user',
      }).lean<SteelConversationTurnDocument>();

      if (!previous) {
        return null;
      }

      await SteelConversationTurn.updateOne(
        { _id: previous._id },
        {
          $set: {
            content: nextContent,
            updatedAt: editedAt,
          },
          $push: {
            revisions: {
              content: previous.content,
              revisedAt: editedAt,
              ...(editedByUserId ? { revisedByUserId: editedByUserId } : {}),
            },
          },
        },
      );

      const updated = await SteelConversationTurn.findOne({
        conversationId,
        messageId,
      }).lean<SteelConversationTurnDocument>();

      return updated ? toTurnRecord(updated) : null;
    },
  };
}

export function createMongooseSteelWorkingOrderMemoryRollbackRepository(
  mongoose: Mongoose,
): SteelWorkingOrderMemoryRollbackRepository {
  const SteelWorkingOrderMemory = createSteelWorkingOrderMemoryModel(mongoose);

  return {
    async markEntriesSupersededFromTurn({
      conversationId,
      turnIndex,
      supersededAt,
      supersededByMessageId,
    }) {
      const result = await SteelWorkingOrderMemory.updateMany(
        {
          conversationId,
          state: 'active',
          turnIndex: { $gte: turnIndex },
        },
        {
          $set: {
            state: 'superseded',
            supersededAt,
            supersededByMessageId,
          },
        },
      );

      return result.modifiedCount;
    },
  };
}
