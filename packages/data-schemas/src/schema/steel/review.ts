import { Schema } from 'mongoose';

import type {
  SteelCatalogSelectionEvidence,
  SteelReviewCell,
  SteelReviewRow,
  SteelReviewSource,
  SteelReviewSourceMapping,
  SteelReviewSystemState,
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

const steelReviewSystemStateSchema = new Schema<SteelReviewSystemState>(
  {
    kind: { type: String, enum: ['material', 'processing', 'unassigned'], required: true },
    parentRowId: { type: String, default: null },
    cascadeDeletedBy: { type: String, default: null },
  },
  { _id: false },
);

const steelCalculationSchema = new Schema(
  {
    candidate: { type: Schema.Types.Mixed },
    measurement: {
      type: new Schema({
        mode: { type: String, enum: ['perPiece', 'batch', 'cutting'], required: true },
        amount: { type: String, default: null },
        unit: { type: String, required: true },
        ruleVersion: { type: String },
        planId: { type: String },
        planVersion: { type: String },
        confirmed: { type: Boolean },
        groups: {
          type: [new Schema({
            stockLengthMm: { type: String, default: null },
            pieceLengthMm: { type: String, default: null },
            pieceCount: { type: String, default: null },
            stockCount: { type: String, default: null },
            lossMm: { type: String, default: null },
            remainderMm: { type: String, default: null },
            headTrimMm: { type: String, default: null },
            tailTrimMm: { type: String, default: null },
            pieceHeadTrimMm: { type: String, default: null },
            pieceTailTrimMm: { type: String, default: null },
          }, { _id: false })],
          default: undefined,
        },
      }, { _id: false }),
    },
    fields: { type: Map, of: new Schema({
      kind: { type: String, enum: ['candidate', 'manual', 'derived', 'legacy'], required: true },
      candidateCode: { type: String },
      ruleVersion: { type: String },
      dependencies: { type: Map, of: String },
    }, { _id: false }) },
  },
  { _id: false },
);

const steelReviewRowSchema: Schema<SteelReviewRow> = new Schema(
  {
    rowId: { type: String, required: true },
    values: { type: Map, of: steelReviewCellSchema, required: true },
    source: { type: steelReviewSourceSchema, default: null },
    origin: { type: String, enum: ['ai', 'manual'] },
    deleted: { type: Boolean },
    insertion: {
      type: new Schema(
        {
          kind: { type: String, enum: ['start', 'end', 'after'], required: true },
          rowId: { type: String },
          ordinal: { type: Number, required: true, min: 0 },
        },
        { _id: false },
      ),
    },
    system: { type: steelReviewSystemStateSchema },
    calculation: { type: steelCalculationSchema },
  },
  { _id: false },
);

const steelReviewSourceMappingSchema = new Schema<SteelReviewSourceMapping>(
  {
    fileId: { type: String, required: true },
    sourceCode: { type: String, required: true },
    sourceFilename: { type: String, required: true },
    mediaType: { type: String },
  },
  { _id: false },
);

const steelReviewOwnerUpdatedSchema = new Schema<SteelReviewOwnerUpdatedRecord>(
  {
    version: { type: Number, enum: [1], required: true },
    kind: { type: String, enum: ['ocr_result', 'system_order'], required: true },
    conversationId: { type: String, required: true },
    messageId: { type: String, required: true },
    title: { type: String, required: true },
    outputId: { type: String, required: true },
    revision: { type: String, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const steelReviewTargetSchema = new Schema(
  {
    partIndex: { type: Number, min: 0 },
    start: { type: Number, required: true, min: 0 },
    end: { type: Number, required: true, min: 0 },
    sha256: { type: String, required: true },
  },
  { _id: false },
);

const steelReviewCaptionSchema = new Schema(
  {
    kind: { type: String, enum: ['ocr_result', 'system_order'], required: true },
    changedRows: { type: Number, required: true, min: 0 },
    changedRowIds: { type: [String], required: true, default: [] },
    customerQuoteChangedRows: { type: Number, min: 0 },
    customerQuoteTotal: { type: String },
  },
  { _id: false },
);

const steelCatalogSelectionEvidenceSchema = new Schema<SteelCatalogSelectionEvidence>(
  {
    rowId: { type: String, required: true },
    candidateId: { type: String, required: true },
    candidateRevision: { type: String, required: true, match: /^[a-f0-9]{64}$/u },
    customerSnapshotId: { type: String, required: true },
    customerRevision: { type: String, required: true, match: /^[a-f0-9]{64}$/u },
    customerTier: { type: String, enum: ['A', 'B', 'C', 'D', 'E', 'F'], required: true },
    unitPrice: { type: String, default: null, match: /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u },
  },
  { _id: false },
);

const steelReviewReceiptSchema = new Schema(
  {
    operationId: { type: String, required: true },
    digest: { type: String, required: true },
    title: { type: String },
    requestDigest: { type: String },
    revision: { type: String, required: true },
    changedRows: { type: Number, required: true, min: 0 },
    changedRowIds: { type: [String], required: true, default: [] },
    savedAt: { type: Date, required: true },
    snapshot: {
      type: new Schema(
        {
          operationId: { type: String, required: true },
          digest: { type: String, required: true },
          title: { type: String },
          requestDigest: { type: String },
          outputId: { type: String, required: true },
          revision: { type: String, required: true },
          headers: { type: [String], required: true, default: [] },
          rows: { type: [steelReviewRowSchema], required: true, default: [] },
          sourceMappings: { type: [steelReviewSourceMappingSchema], default: undefined },
          changedRows: { type: Number, required: true, min: 0 },
          changedRowIds: { type: [String], required: true, default: [] },
          savedAt: { type: Date, required: true },
          selectionEvidence: { type: [steelCatalogSelectionEvidenceSchema], default: undefined },
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
          target: { type: steelReviewTargetSchema },
          targetText: { type: String },
          replacementText: { type: String },
          cleanReplacementText: { type: String },
          aiBaselineMarkdown: { type: String },
          aiRawMarkdown: { type: String },
          caption: { type: steelReviewCaptionSchema },
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
    title: { type: String },
    outputId: { type: String, required: true },
    revision: { type: String, required: true },
    state: { type: String, enum: ['current', 'historical'], required: true },
    headers: { type: [String], required: true, default: [] },
    rows: { type: [steelReviewRowSchema], required: true, default: [] },
    sourceMappings: { type: [steelReviewSourceMappingSchema], default: undefined },
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
  messageId: 1,
  outputId: 1,
  title: 1,
}, {
  unique: true,
  partialFilterExpression: { title: { $type: 'string' } },
});
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
