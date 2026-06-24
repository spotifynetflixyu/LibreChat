import { Schema } from 'mongoose';

import { steelCapabilityStatusEnum, steelProviderEnum } from './common';

import type { ISteelAICapability } from '~/types';

const steelAICapabilitySchema: Schema<ISteelAICapability> = new Schema<ISteelAICapability>(
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
      enum: steelCapabilityStatusEnum,
      required: true,
    },
    checkedAt: Date,
    errorCategory: String,
    errorSummary: String,
  },
  { timestamps: true },
);

steelAICapabilitySchema.index({ provider: 1, model: 1, capability: 1 }, { unique: true });

export default steelAICapabilitySchema;
