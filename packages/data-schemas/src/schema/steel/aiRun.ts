import { Schema } from 'mongoose';

import { steelProviderEnum } from './common';

import type { ISteelAIRun } from '~/types';

const steelAIRunSchema = new Schema<ISteelAIRun>(
  {
    conversationMetaId: {
      type: String,
      index: true,
    },
    requestedProvider: {
      type: String,
      enum: steelProviderEnum,
      required: true,
    },
    effectiveProvider: {
      type: String,
      enum: steelProviderEnum,
    },
    selectedModel: {
      type: String,
      required: true,
      index: true,
    },
    unsupportedSettings: {
      type: [String],
      default: [],
    },
    providerSessionId: String,
    providerConversationId: String,
    providerResponseId: String,
    contextRefs: {
      type: [String],
      default: [],
    },
    toolCallIds: {
      type: [String],
      default: [],
    },
    attachedFileRefs: {
      type: [String],
      default: [],
    },
    fallbackReason: String,
    errorCategory: String,
    errorSummary: String,
  },
  { timestamps: true },
);

steelAIRunSchema.index({ conversationMetaId: 1, createdAt: -1 });
steelAIRunSchema.index({ requestedProvider: 1, effectiveProvider: 1 });

export default steelAIRunSchema;
