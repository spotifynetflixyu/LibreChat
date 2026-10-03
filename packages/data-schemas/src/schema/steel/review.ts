import { Schema } from 'mongoose';

import type {
  SteelReviewCell,
  SteelReviewRow,
  SteelReviewSource,
} from 'librechat-data-provider';
import type {
  ISteelReviewOutput,
  SteelReviewOwnerUpdatedRecord,
} from '~/types';

const steelReviewSourceSchema = new Schema<SteelReviewSource>(
  {
    fileId: { type: String, required: true },
    pageNumber: { type: Number, min: 1, default: null },
    filename: { type: String },
    mediaType: { type: String },
  },
  { _id: false },
);

const steelReviewCellSchema = new Schema<SteelReviewCell>(
  {
    baseline: { type: String, default: null },
    effective: { type: String, default: null },
  },
  { _id: false },
);

const steelReviewRowSchema: Schema<SteelReviewRow> = new Schema(
  {
    rowId: { type: String, required: true },
    values: { type: Map, of: steelReviewCellSchema, required: true },
    source: { type: steelReviewSourceSchema, default: null },
  },
  { _id: false },
);

const steelReviewOwnerUpdatedSchema = new Schema<SteelReviewOwnerUpdatedRecord>(
  {
    version: { type: Number, enum: [1], required: true },
    kind: { type: String, enum: ['ocr_result', 'system_order'], required: true },
    conversationId: { type: String, required: true },
    messageId: { type: String, required: true },
    tableId: { type: String, required: true },
    outputId: { type: String, required: true },
    revision: { type: String, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const steelReviewReceiptSchema = new Schema(
  {
    operationId: { type: String, required: true },
    digest: { type: String, required: true },
    revision: { type: String, required: true },
    changedRows: { type: Number, required: true, min: 0 },
    changedRowIds: { type: [String], required: true, default: [] },
    savedAt: { type: Date, required: true },
    snapshot: {
      type: new Schema(
        {
          operationId: { type: String, required: true },
          digest: { type: String, required: true },
          outputId: { type: String, required: true },
          revision: { type: String, required: true },
          headers: { type: [String], required: true, default: [] },
          rows: { type: [steelReviewRowSchema], required: true, default: [] },
          changedRows: { type: Number, required: true, min: 0 },
          changedRowIds: { type: [String], required: true, default: [] },
          savedAt: { type: Date, required: true },
          messageSha256: { type: String, required: true },
          conversationId: { type: String, required: true },
          messageId: { type: String, required: true },
          messageText: { type: String, required: true },
          messageTextParts: {
            type: [
              new Schema(
                {
                  partIndex: { type: Number, required: true, min: 0 },
                  text: { type: String, required: true },
                },
                { _id: false },
              ),
            ],
            default: undefined,
          },
          effectiveMarkdown: { type: String, required: true },
          displayMarkdown: { type: String, required: true },
          ownerUpdated: { type: steelReviewOwnerUpdatedSchema },
        },
        { _id: false },
      ),
    },
  },
  { _id: false },
);

const steelReviewOutputSchema: Schema<ISteelReviewOutput> = new Schema<ISteelReviewOutput>(
  {
    userId: { type: String, required: true },
    tenantId: { type: String },
    conversationId: { type: String, required: true },
    kind: { type: String, enum: ['ocr_result', 'system_order'], required: true },
    messageId: { type: String, required: true },
    tableId: { type: String, required: true },
    outputId: { type: String, required: true },
    revision: { type: String, required: true },
    state: { type: String, enum: ['current', 'historical'], required: true },
    headers: { type: [String], required: true, default: [] },
    rows: { type: [steelReviewRowSchema], required: true, default: [] },
    latestOutputId: { type: String },
    aiUpdatedAt: { type: Date },
    aiRawMarkdown: { type: String },
    aiBaselineMarkdown: { type: String },
    humanMarkdown: { type: String },
    humanSavedAt: { type: Date },
    effectiveMarkdown: { type: String },
    displayMarkdown: { type: String },
    receipts: { type: [steelReviewReceiptSchema], required: true, default: [] },
  },
  { timestamps: true },
);

steelReviewOutputSchema.index({
  userId: 1,
  tenantId: 1,
  conversationId: 1,
  kind: 1,
  messageId: 1,
  tableId: 1,
  outputId: 1,
}, { unique: true });
steelReviewOutputSchema.index({
  userId: 1,
  tenantId: 1,
  conversationId: 1,
  kind: 1,
  tableId: 1,
  state: 1,
  updatedAt: -1,
});

export default steelReviewOutputSchema;
