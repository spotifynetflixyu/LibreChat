import { Schema } from 'mongoose';

import type { ISteelToolCall } from '~/types';

const steelToolCallSchema = new Schema<ISteelToolCall>(
  {
    conversationMetaId: {
      type: String,
      index: true,
    },
    aiRunId: {
      type: String,
      index: true,
    },
    toolName: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed'],
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

export default steelToolCallSchema;
