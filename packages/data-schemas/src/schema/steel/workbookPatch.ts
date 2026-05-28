import { Schema } from 'mongoose';

import type { ISteelWorkbookPatch } from '~/types';

const steelWorkbookPatchSchema = new Schema<ISteelWorkbookPatch>(
  {
    workbookId: {
      type: String,
      required: true,
      index: true,
    },
    beforeVersion: {
      type: Number,
      required: true,
      min: 1,
    },
    afterVersion: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ['accepted', 'rejected'],
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

steelWorkbookPatchSchema.index({ workbookId: 1, afterVersion: -1 });

export default steelWorkbookPatchSchema;
