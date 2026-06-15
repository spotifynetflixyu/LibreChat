import { Schema } from 'mongoose';

import type { ISteelWorkbookPatch } from '~/types';

const steelWorkbookSheetIdEnum = [
  'quote_details',
  'summary',
  'manual_review',
  'price_sources',
  'interpretation_notes',
  'system_order',
  'customer_data',
  'customer_quote',
];

const steelWorkbookCellValue = Schema.Types.Mixed;

const steelWorkbookPathSchema = new Schema(
  {
    sheetId: {
      type: String,
      enum: steelWorkbookSheetIdEnum,
      required: true,
    },
    rowId: { type: String, required: true },
    columnKey: { type: String, required: true },
  },
  { _id: false },
);

const steelSelectedWorkbookRefSchema = new Schema(
  {
    workbookId: { type: String, required: true },
    workbookVersion: { type: Number, required: true, min: 1 },
    sheetId: {
      type: String,
      enum: steelWorkbookSheetIdEnum,
      required: true,
    },
    rowId: { type: String, required: true },
    columnKey: { type: String, required: true },
    displayLabel: { type: String },
  },
  { _id: false },
);

const steelWorkbookPatchOperationSchema = new Schema(
  {
    op: {
      type: String,
      enum: ['set_cell', 'delete_row'],
      required: true,
    },
    sheetId: {
      type: String,
      enum: steelWorkbookSheetIdEnum,
      required: true,
    },
    rowId: { type: String, required: true },
    columnKey: {
      type: String,
      required(this: { op?: string }) {
        return this.op === 'set_cell';
      },
    },
    value: { type: steelWorkbookCellValue },
    reason: { type: String },
  },
  { _id: false },
);

const steelChangedFieldSummarySchema = new Schema(
  {
    sheetId: {
      type: String,
      enum: steelWorkbookSheetIdEnum,
      required: true,
    },
    rowId: { type: String, required: true },
    columnKey: { type: String, required: true },
    label: { type: String, required: true },
    previousValue: { type: steelWorkbookCellValue },
    nextValue: { type: steelWorkbookCellValue },
  },
  { _id: false },
);

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
    selectedWorkbookRefs: {
      type: [steelSelectedWorkbookRefSchema],
      default: [],
    },
    operations: {
      type: [steelWorkbookPatchOperationSchema],
      default: [],
      required: true,
    },
    changedPaths: {
      type: [steelWorkbookPathSchema],
      default: [],
      required: true,
    },
    changedFieldSummary: {
      type: [steelChangedFieldSummarySchema],
      default: [],
      required: true,
    },
    status: {
      type: String,
      enum: ['accepted', 'rejected'],
      required: true,
      index: true,
    },
    rejectedReason: {
      type: String,
    },
  },
  { timestamps: true },
);

steelWorkbookPatchSchema.index({ workbookId: 1, afterVersion: -1 });
steelWorkbookPatchSchema.index({ workbookId: 1, beforeVersion: 1 });

export default steelWorkbookPatchSchema;
