import { Schema } from 'mongoose';

import type { ISteelWorkbook } from '~/types';

const steelWorkbookColumnValueTypeEnum = [
  'text',
  'number',
  'currency',
  'boolean',
  'date',
  'status',
  'formula',
];

const steelWorkbookSheetIdEnum = [
  'quote_details',
  'summary',
  'manual_review',
  'price_sources',
  'interpretation_notes',
  'system_order',
  'customer_quote',
];

const steelWorkbookColumnSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    valueType: {
      type: String,
      enum: steelWorkbookColumnValueTypeEnum,
      default: 'text',
      required: true,
    },
    editable: { type: Boolean, default: false, required: true },
    widthPx: { type: Number, min: 1 },
  },
  { _id: false },
);

const steelWorkbookRowSchema = new Schema(
  {
    id: { type: String, required: true },
    cells: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false },
);

const steelWorkbookSheetSchema = new Schema(
  {
    id: {
      type: String,
      enum: steelWorkbookSheetIdEnum,
      required: true,
    },
    label: { type: String, required: true },
    columns: {
      type: [steelWorkbookColumnSchema],
      default: [],
      required: true,
    },
    rows: {
      type: [steelWorkbookRowSchema],
      default: [],
      required: true,
    },
  },
  { _id: false },
);

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
    sheets: {
      type: [steelWorkbookSheetSchema],
      default: [],
      required: true,
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

steelWorkbookSchema.index({ conversationMetaId: 1, status: 1, updatedAt: -1 });

export default steelWorkbookSchema;
