import { Schema } from 'mongoose';

import { steelConversationCreatedFromEnum, steelConversationStatusEnum } from './common';

import type { ISteelConversationMeta } from '~/types';

const steelConversationMetaSchema = new Schema<ISteelConversationMeta>(
  {
    libreChatConversationId: {
      type: String,
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    guestTokenHash: {
      type: String,
      index: true,
      sparse: true,
    },
    createdFrom: {
      type: String,
      enum: steelConversationCreatedFromEnum,
      required: true,
    },
    status: {
      type: String,
      enum: steelConversationStatusEnum,
      default: 'active',
      index: true,
    },
  },
  { timestamps: true },
);

steelConversationMetaSchema.index({ userId: 1, status: 1, updatedAt: -1 });

export default steelConversationMetaSchema;
