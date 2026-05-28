import { createSteelConversationMetaModel } from '@librechat/data-schemas';

import type { SteelConversationRecord, SteelConversationRepository } from './service';

type Mongoose = typeof import('mongoose');

interface SteelConversationDocument {
  _id: { toString(): string };
  libreChatConversationId?: string;
  userId?: string;
  guestTokenHash?: string;
  createdFrom: 'authenticated' | 'guest';
  status: 'active' | 'archived';
  workbookId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

function toRecord(document: SteelConversationDocument): SteelConversationRecord {
  const createdAt = document.createdAt ?? new Date();
  const updatedAt = document.updatedAt ?? createdAt;

  return {
    id: document._id.toString(),
    libreChatConversationId: document.libreChatConversationId,
    userId: document.userId,
    guestTokenHash: document.guestTokenHash,
    createdFrom: document.createdFrom,
    status: document.status,
    workbookId: document.workbookId,
    createdAt,
    updatedAt,
  };
}

export function createMongooseSteelConversationRepository(
  mongoose: Mongoose,
): SteelConversationRepository {
  const SteelConversationMeta = createSteelConversationMetaModel(mongoose);

  return {
    async create(record) {
      const document = await SteelConversationMeta.create(record);
      return toRecord(document);
    },
    async findById(id) {
      const document = await SteelConversationMeta.findById(id).lean<SteelConversationDocument>();
      return document ? toRecord(document) : null;
    },
  };
}
