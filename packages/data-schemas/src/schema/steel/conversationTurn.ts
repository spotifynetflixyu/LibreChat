import { Schema } from 'mongoose';

import {
  steelConversationTurnRoleEnum,
  steelConversationTurnSourceEnum,
  steelConversationTurnStateEnum,
  steelProviderEnum,
  steelQueuedSteerStatusEnum,
} from './common';

import type {
  ISteelConversationTurn,
  SteelConversationTurnAttachmentRef,
  SteelConversationTurnFinalResponseMetadata,
  SteelConversationTurnQueuedSteer,
  SteelConversationTurnRevision,
} from '~/types';

const steelConversationTurnRevisionSchema = new Schema<SteelConversationTurnRevision>(
  {
    content: {
      type: String,
      required: true,
    },
    revisedAt: {
      type: Date,
      required: true,
    },
    revisedByUserId: {
      type: String,
    },
  },
  { _id: false },
);

const steelConversationTurnAttachmentRefSchema = new Schema<SteelConversationTurnAttachmentRef>(
  {
    fileId: {
      type: String,
      required: true,
    },
    filename: {
      type: String,
    },
    mediaType: {
      type: String,
    },
  },
  { _id: false },
);

const steelConversationTurnFinalResponseMetadataSchema =
  new Schema<SteelConversationTurnFinalResponseMetadata>(
    {
      provider: {
        type: String,
        enum: steelProviderEnum,
        required: true,
      },
      model: {
        type: String,
        required: true,
      },
      responseId: {
        type: String,
      },
      usage: {
        inputTokens: {
          type: Number,
        },
        outputTokens: {
          type: Number,
        },
        totalTokens: {
          type: Number,
        },
      },
    },
    { _id: false },
  );

const steelConversationTurnQueuedSteerSchema = new Schema<SteelConversationTurnQueuedSteer>(
  {
    targetRequestId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: steelQueuedSteerStatusEnum,
      required: true,
    },
    appliedAt: {
      type: Date,
    },
    deferredAt: {
      type: Date,
    },
  },
  { _id: false },
);

const steelConversationTurnSchema = new Schema<ISteelConversationTurn>(
  {
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    requestId: {
      type: String,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
    },
    turnIndex: {
      type: Number,
      required: true,
    },
    role: {
      type: String,
      enum: steelConversationTurnRoleEnum,
      required: true,
    },
    source: {
      type: String,
      enum: steelConversationTurnSourceEnum,
      required: true,
    },
    state: {
      type: String,
      enum: steelConversationTurnStateEnum,
      default: 'active',
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    attachments: {
      type: [steelConversationTurnAttachmentRefSchema],
      default: undefined,
    },
    tableHashes: {
      type: [String],
      default: undefined,
    },
    finalResponseMetadata: {
      type: steelConversationTurnFinalResponseMetadataSchema,
      default: undefined,
    },
    queuedSteer: {
      type: steelConversationTurnQueuedSteerSchema,
      default: undefined,
    },
    revisions: {
      type: [steelConversationTurnRevisionSchema],
      default: undefined,
    },
    supersededAt: {
      type: Date,
    },
    supersededByMessageId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

steelConversationTurnSchema.index({ conversationId: 1, state: 1, turnIndex: 1 });
steelConversationTurnSchema.index({ conversationId: 1, createdAt: -1 });
steelConversationTurnSchema.index({ conversationId: 1, messageId: 1 }, { unique: true });

export default steelConversationTurnSchema;
