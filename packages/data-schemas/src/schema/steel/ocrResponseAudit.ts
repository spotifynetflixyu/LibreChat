import { Schema } from 'mongoose';

import type { ISteelOcrResponseAudit } from '~/types';

const steelOcrResponseAuditSchema: Schema<ISteelOcrResponseAudit> = new Schema<ISteelOcrResponseAudit>(
  {
    userId: { type: String, required: true, immutable: true },
    tenantId: { type: String, immutable: true },
    conversationId: { type: String, required: true, immutable: true },
    messageId: { type: String, required: true, immutable: true },
    generationId: { type: String, required: true, immutable: true },
    attemptId: { type: String, immutable: true },
    attemptNumber: { type: Number, required: true, immutable: true, default: 1 },
    sourceStage: {
      type: String,
      enum: ['normal_request', 'responses', 'pending', 'delegate'],
      required: true,
      immutable: true,
    },
    baseRevision: { type: String, immutable: true },
    baseHash: { type: String, required: true, immutable: true },
    rawResponse: {
      type: String,
      immutable: true,
      validate: {
        validator: (value: string) => typeof value === 'string',
        message: 'rawResponse must be a string',
      },
    },
    rawResponseHash: { type: String, required: true, immutable: true },
    idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

steelOcrResponseAuditSchema.index({
  tenantId: 1,
  userId: 1,
  conversationId: 1,
  sourceStage: 1,
  createdAt: -1,
});

export default steelOcrResponseAuditSchema;
