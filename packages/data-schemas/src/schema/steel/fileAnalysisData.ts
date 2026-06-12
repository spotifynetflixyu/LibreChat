import { Schema } from 'mongoose';

import type { ISteelFileAnalysisData } from '~/types';

const sourceFileSchema = new Schema(
  {
    fileId: { type: String, required: true },
    filename: { type: String },
    mediaType: { type: String, required: true },
    pageCount: { type: Number, min: 1 },
    ocrEngine: { type: String },
    ocrStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
    },
    processedAt: { type: String },
    errorMessage: { type: String },
  },
  { _id: false },
);

const columnSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    valueType: { type: String, default: 'text', required: true },
  },
  { _id: false },
);

const sourceRefSchema = new Schema(
  {
    fileId: { type: String, required: true },
    filename: { type: String },
    mediaType: { type: String, required: true },
    sourceKey: { type: String },
    imageIndex: { type: Number, min: 1 },
    page: { type: Number, min: 1 },
    regionLabel: { type: String },
    orientation: { type: String, enum: ['0', '90', '180', '270'] },
    ocrEngine: { type: String },
    ocrStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
    },
    processedAt: { type: String },
    errorMessage: { type: String },
  },
  { _id: false },
);

const analysisRowSchema = new Schema(
  {
    id: { type: String, required: true },
    sourceRef: { type: sourceRefSchema, required: true },
    cells: { type: Map, of: Schema.Types.Mixed, default: {} },
    confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    reviewStatus: {
      type: String,
      enum: ['pending_review', 'confirmed', 'corrected'],
      default: 'pending_review',
    },
    rowWarnings: { type: [String], default: [] },
  },
  { _id: false },
);

const looseRowSchema = new Schema(
  {
    id: { type: String, required: true },
    sourceRef: { type: sourceRefSchema },
    cells: { type: Map, of: Schema.Types.Mixed, default: {} },
    confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'low' },
    reviewStatus: {
      type: String,
      enum: ['pending_review', 'confirmed', 'corrected'],
      default: 'pending_review',
    },
    rowWarnings: { type: [String], default: [] },
  },
  { _id: false },
);

const noteRowSchema = new Schema(
  {
    id: { type: String, required: true },
    sourceRef: { type: sourceRefSchema },
    cells: { type: Map, of: Schema.Types.Mixed, default: {} },
    confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  },
  { _id: false },
);

const fileAnalysisDataSchema = new Schema<ISteelFileAnalysisData>(
  {
    fileAnalysisDataId: { type: String, required: true, unique: true },
    conversationId: { type: String, required: true, unique: true },
    workbookId: { type: String },
    version: { type: Number, min: 1, default: 1, required: true },
    status: {
      type: String,
      enum: ['draft', 'user_confirmed', 'projected_to_workbook'],
      default: 'draft',
      required: true,
    },
    sourceFiles: { type: [sourceFileSchema], default: [], required: true },
    sheets: {
      file_analysis_data: {
        columns: { type: [columnSchema], default: [] },
        rows: { type: [analysisRowSchema], default: [] },
      },
      manual_review: {
        columns: { type: [columnSchema], default: [] },
        rows: { type: [looseRowSchema], default: [] },
      },
      interpretation_notes: {
        columns: { type: [columnSchema], default: [] },
        rows: { type: [noteRowSchema], default: [] },
      },
    },
  },
  { timestamps: true },
);

fileAnalysisDataSchema.index({ workbookId: 1, updatedAt: -1 });

export default fileAnalysisDataSchema;
