import { Schema } from 'mongoose';

import type { ISteelAICapability, ISteelAIRun, ISteelConversationMeta } from '~/types';

const steelProviderEnum = ['openai_oauth_responses', 'openai_api'] as const;

export const steelConversationMetaSchema = new Schema<ISteelConversationMeta>(
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
      enum: ['authenticated', 'guest'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
      index: true,
    },
    workbookId: {
      type: String,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

steelConversationMetaSchema.index({ libreChatConversationId: 1, tenantId: 1 });
steelConversationMetaSchema.index({ userId: 1, tenantId: 1 });
steelConversationMetaSchema.index({ guestTokenHash: 1, tenantId: 1 }, { sparse: true });

export const steelAIRunSchema = new Schema<ISteelAIRun>(
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
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

steelAIRunSchema.index({ conversationMetaId: 1, createdAt: -1 });
steelAIRunSchema.index({ requestedProvider: 1, effectiveProvider: 1, tenantId: 1 });

export const steelAICapabilitySchema = new Schema<ISteelAICapability>(
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
    capability: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['passed', 'failed', 'not_run', 'disabled', 'not_applicable'],
      required: true,
    },
    checkedAt: {
      type: Date,
    },
    errorCategory: String,
    errorSummary: String,
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

steelAICapabilitySchema.index(
  { provider: 1, model: 1, capability: 1, tenantId: 1 },
  { unique: true },
);
