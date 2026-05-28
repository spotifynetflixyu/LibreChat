import { Schema } from 'mongoose';

import { steelAuditActorTypeEnum, steelAuditResultEnum } from './common';

import type { ISteelAuditLog } from '~/types';

const steelAuditLogSchema = new Schema<ISteelAuditLog>(
  {
    actorType: {
      type: String,
      enum: steelAuditActorTypeEnum,
      required: true,
      index: true,
    },
    actorId: {
      type: String,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    targetType: String,
    targetId: {
      type: String,
      index: true,
    },
    result: {
      type: String,
      enum: steelAuditResultEnum,
      required: true,
      index: true,
    },
    errorCategory: String,
    correlationId: {
      type: String,
      index: true,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
    },
  },
  { timestamps: true },
);

steelAuditLogSchema.index({ action: 1, createdAt: -1 });
steelAuditLogSchema.index({ actorType: 1, actorId: 1, createdAt: -1 });
steelAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export default steelAuditLogSchema;
