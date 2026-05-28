import { Schema } from 'mongoose';

import type { ISteelWorkbook } from '~/types';

const steelWorkbookSchema = new Schema<ISteelWorkbook>(
  {
    conversationMetaId: {
      type: String,
      index: true,
    },
    workbookId: {
      type: String,
      required: true,
      unique: true,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true },
);

export default steelWorkbookSchema;
