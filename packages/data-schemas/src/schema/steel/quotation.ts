import { Schema } from 'mongoose';

import type { SteelCalculationCheckpoint } from 'librechat-data-provider';

import type {
  ISteelQuotationArtifact,
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationArtifactRef,
  SteelQuotationCheckpointRef,
  SteelQuotationChunkState,
  SteelQuotationCustomerPreparation,
  SteelQuotationCustomerLookupEvidence,
  SteelQuotationCustomerLookupCandidate,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationRequoteProvenance,
  SteelQuotationOrder,
  SteelQuotationPendingMessage,
  SteelQuotationPendingMessageFile,
  SteelQuotationSelectionProvenance,
  SteelQuotationOcrSelection,
  SteelQuotationSourceMapping,
  SteelQuotationSourceSnapshot,
  SteelQuotationTicket,
} from '~/types';

const steelMarkdownReferenceSchema = new Schema({
  kind: { type: String, enum: ['ocr_result', 'system_order', 'customer_data'], required: true },
  source: { type: String, enum: ['ai', 'human'], required: true },
  snapshotId: { type: String, required: true },
  generationId: { type: String, required: true },
  outputId: { type: String, required: true },
  messageId: { type: String, required: true },
  title: { type: String, required: true },
  revision: { type: String, required: true },
  sha256: { type: String, required: true },
  lineageId: { type: String, required: true },
  version: { type: Number, min: 1 },
  savedAt: { type: Date, required: true },
  operationId: { type: String },
}, { _id: false });

const steelQuotationOcrSelectionSchema = new Schema<SteelQuotationOcrSelection>({
  candidates: {
    type: new Schema({
      ai: { type: steelMarkdownReferenceSchema },
      human: { type: steelMarkdownReferenceSchema },
    }, { _id: false }),
    required: true,
  },
  selected: { type: steelMarkdownReferenceSchema, required: true },
  version: { type: Number, min: 1, required: true },
}, { _id: false });

const steelQuotationSourceSnapshotSchema = new Schema<SteelQuotationSourceSnapshot>({
  orderHash: { type: String, required: true },
  generationId: { type: String },
  resultMessageId: { type: String },
  resultHash: { type: String },
  mappings: { type: [new Schema({
    fileId: { type: String, required: true },
    sourceCode: { type: String, required: true },
    sourceFilename: { type: String, required: true },
    mediaType: { type: String },
  }, { _id: false })], required: true, default: [] },
}, { _id: false });

const steelQuotationOrderSchema = new Schema<SteelQuotationOrder>(
  {
    markdown: { type: String, required: true },
    sha256: { type: String, required: true },
    revision: { type: String },
    messageId: { type: String },
    ocrSelection: { type: steelQuotationOcrSelectionSchema },
    sourceSnapshot: { type: steelQuotationSourceSnapshotSchema },
  },
  { _id: false },
);

const steelQuotationSourceMappingSchema = new Schema<SteelQuotationSourceMapping>(
  {
    fileId: { type: String, required: true },
    sourceCode: { type: String, required: true },
    sourceFilename: { type: String, required: true },
    mediaType: { type: String },
  },
  { _id: false },
);

const steelCalculationCheckpointSchema = new Schema<SteelCalculationCheckpoint>(
  {
    version: { type: Number, enum: [1], required: true },
    systemOrderHash: { type: String, required: true, match: /^[a-f0-9]{64}$/u },
    rows: {
      type: [new Schema({
        rowIndex: { type: Number, required: true, min: 0 },
        rowId: { type: String },
        candidate: {
          type: new Schema({
            erpItemCode: { type: String, required: true },
            category: { type: String, required: true },
            ruleVersion: { type: String, required: true },
            unitWeightBasis: { type: String },
            exactPhysical: {
              type: new Schema({
                density: { type: String },
                widthMm: { type: String },
                lengthMm: { type: String },
                unitWeightValue: { type: String },
              }, { _id: false }),
              required: true,
            },
          }, { _id: false }),
          required: true,
        },
      }, { _id: false })],
      required: true,
      default: [],
    },
  },
  { _id: false },
);

const steelQuotationCurrentSystemOrderSchema = new Schema<SteelQuotationCurrentSystemOrder>(
  {
    reviewOutputId: { type: String },
    runId: { type: String, required: true },
    sha256: { type: String, required: true },
    markdown: { type: String, required: true },
    messageId: { type: String },
    responseId: { type: String },
    customerQuoteMarkdown: { type: String },
    calculationCheckpoint: { type: steelCalculationCheckpointSchema },
    sourceSnapshot: { type: steelQuotationSourceSnapshotSchema },
    ocrSelection: { type: steelQuotationOcrSelectionSchema },
    needsRequote: { type: Boolean },
    requoteProvenance: {
      type: new Schema<SteelQuotationRequoteProvenance>(
        {
          sourceKind: { type: String, enum: ['ocr_result'], required: true },
          sourceMessageId: { type: String, required: true },
          sourceTableId: { type: String, required: true },
          sourceOutputId: { type: String, required: true },
          sourceRevision: { type: String, required: true },
          changedRows: { type: Number, required: true, min: 1 },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
    },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const steelQuotationSelectionProvenanceSchema = new Schema<SteelQuotationSelectionProvenance>(
  {
    method: {
      type: String,
      enum: ['unique', 'selected', 'default_tier'],
      required: true,
    },
    lookupMessageId: { type: String },
    selectionMessageId: { type: String },
    selectedCustomerId: { type: String },
  },
  { _id: false },
);

const steelQuotationCustomerPreparationSchema = new Schema<SteelQuotationCustomerPreparation>(
  {
    preparationId: { type: String, required: true },
    customerMarkdown: { type: String, required: true },
    customerIdentity: { type: String, required: true },
    orderHash: { type: String },
    triggeringMessageId: { type: String, required: true },
    responseId: { type: String, required: true },
    selectionProvenance: {
      type: steelQuotationSelectionProvenanceSchema,
      required: true,
    },
  },
  { _id: false },
);

const steelQuotationCustomerLookupCandidateSchema = new Schema<SteelQuotationCustomerLookupCandidate>(
  {
    id: { type: Number, required: true },
    erpCustomerCode: { type: String },
    displayName: { type: String },
    customerTier: { type: String, enum: ['A', 'B', 'C', 'D', 'E', 'F'] },
  },
  { _id: false },
);

const steelQuotationCustomerLookupEvidenceSchema = new Schema<SteelQuotationCustomerLookupEvidence>(
  {
    responseId: { type: String, required: true },
    lookupMessageId: { type: String, required: true },
    orderHash: { type: String, required: true },
    customerPreparationId: { type: String },
    customers: { type: [steelQuotationCustomerLookupCandidateSchema], required: true, default: [] },
    customerMarkdown: { type: String },
  },
  { _id: false },
);

const steelQuotationTicketCompletionReceiptSchema = new Schema(
  {
    inputHash: { type: String, required: true },
    markdown: { type: String, required: true },
    ocrGeneration: { type: String },
    ocrHash: { type: String },
    systemOrderHash: { type: String },
  },
  { _id: false },
);

const steelQuotationTicketSchema = new Schema<SteelQuotationTicket>(
  {
    index: { type: Number, required: true },
    token: { type: String, required: true },
    orderHash: { type: String, required: true },
    customerMarkdown: { type: String, required: true },
    customerIdentity: { type: String, required: true },
    triggeringMessageId: { type: String, required: true },
    selectionProvenance: {
      type: steelQuotationSelectionProvenanceSchema,
      required: true,
    },
    issuedAt: { type: Date, required: true },
    preparationId: { type: String },
    responseId: { type: String },
    acceptedRunId: { type: String },
    completionReceipt: { type: steelQuotationTicketCompletionReceiptSchema },
  },
  { _id: false },
);

const steelQuotationArtifactRefSchema = new Schema<SteelQuotationArtifactRef>(
  {
    artifactId: { type: String, required: true },
    userId: { type: String, required: true },
    conversationId: { type: String, required: true },
    tenantId: { type: String },
    runId: { type: String, required: true },
    operationId: { type: String, required: true },
    kind: {
      type: String,
      enum: ['snapshot', 'chunk', 'tool', 'main', 'final', 'archive'],
      required: true,
    },
    sha256: { type: String, required: true },
  },
  { _id: false },
);

const steelQuotationChunkSchema = new Schema<SteelQuotationChunkState>(
  {
    index: { type: Number, required: true },
    sourceRowCount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'completed'], required: true },
    checkpointRef: { type: steelQuotationArtifactRefSchema },
  },
  { _id: false },
);

const steelQuotationCheckpointRefSchema = new Schema<SteelQuotationCheckpointRef>(
  {
    operationId: { type: String, required: true },
    kind: {
      type: String,
      enum: ['snapshot', 'chunk', 'tool', 'main', 'final', 'archive'],
      required: true,
    },
    artifactId: { type: String, required: true },
    sha256: { type: String, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const steelQuotationActiveRunSchema = new Schema<SteelQuotationActiveRun>(
  {
    runId: { type: String, required: true },
    index: { type: Number, required: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'aggregating', 'finalizing', 'interrupted', 'completed', 'cancelled'],
      required: true,
    },
    triggerMessageId: { type: String, required: true },
    targetMessageId: { type: String },
    ocrSelection: { type: steelQuotationOcrSelectionSchema },
    snapshotRef: { type: steelQuotationArtifactRefSchema, required: true },
    chunks: { type: [steelQuotationChunkSchema], required: true, default: [] },
    checkpointRefs: {
      type: [steelQuotationCheckpointRefSchema],
      required: true,
      default: [],
    },
    leaseToken: { type: String },
    leaseExpiresAt: { type: Date },
    interruption: {
      type: new Schema<NonNullable<SteelQuotationActiveRun['interruption']>>({
        reason: { type: String, enum: ['paused', 'error'], required: true },
        chunkIndex: { type: Number, min: 1 },
      }, { _id: false }),
    },
    acceptedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const steelQuotationPendingMessageSchema = new Schema<SteelQuotationPendingMessage>(
  {
    sourceMessageId: { type: String, required: true },
    sourceMessageText: { type: String },
    sourceMessageFiles: {
      type: [
        new Schema<SteelQuotationPendingMessageFile>(
          {
            fileId: { type: String },
            filename: { type: String },
            storageKey: { type: String },
            mediaType: { type: String },
            pageNumber: { type: Number },
            imageIndex: { type: Number },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    targetMessageId: { type: String },
    status: { type: String, enum: ['pending', 'claimed', 'completed'], required: true },
    claimToken: { type: String },
    claimExpiresAt: { type: Date },
    resultRef: { type: steelQuotationArtifactRefSchema },
    completedTargetMessageId: { type: String },
    enqueuedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const steelMarkdownOwnerSchema = new Schema({
  ai: { type: steelMarkdownReferenceSchema, required: true },
  effective: { type: steelMarkdownReferenceSchema, required: true },
}, { _id: false });
const steelMarkdownOwnersSchema = new Schema({
  ocr_result: { type: steelMarkdownOwnerSchema },
  system_order: { type: steelMarkdownOwnerSchema },
  customer_data: { type: steelMarkdownOwnerSchema },
}, { _id: false });
const steelMarkdownExpectedSchema = new Schema({
  ocrGeneration: { type: String },
  ocrHash: { type: String },
  orderHash: { type: String },
  systemOrderHash: { type: String },
  customerPreparationId: { type: String },
  owners: { type: steelMarkdownOwnersSchema },
}, { _id: false });
const steelMarkdownAdmissionSchema = new Schema({
  sequence: { type: Number, required: true, min: 1 },
  responseId: { type: String, required: true },
  generationId: { type: String, required: true },
  lineageId: { type: String, required: true },
  expected: { type: steelMarkdownExpectedSchema, required: true },
}, { _id: false });
const steelMarkdownStateSchema = new Schema({
  nextSequence: { type: Number, required: true, default: 0 },
  admission: { type: steelMarkdownAdmissionSchema },
  current: { type: steelMarkdownOwnersSchema },
  lastHumanOcr: { type: steelMarkdownReferenceSchema },
}, { _id: false });

const steelQuotationStateSchema: Schema<ISteelQuotationState> = new Schema<ISteelQuotationState>(
  {
    userId: { type: String, required: true },
    conversationId: { type: String, required: true },
    tenantId: { type: String },
    markdownPublication: { type: steelMarkdownStateSchema },
    currentOrder: { type: steelQuotationOrderSchema },
    currentSystemOrder: { type: steelQuotationCurrentSystemOrderSchema },
    currentCustomer: { type: steelQuotationCustomerPreparationSchema },
    customerLookupEvidence: { type: steelQuotationCustomerLookupEvidenceSchema },
    nextSignalIndex: { type: Number, required: true, default: 0 },
    tickets: { type: [steelQuotationTicketSchema], required: true, default: [] },
    activeRun: { type: steelQuotationActiveRunSchema },
    pendingMessages: {
      type: [steelQuotationPendingMessageSchema],
      required: true,
      default: [],
    },
  },
  { timestamps: true },
);

steelQuotationStateSchema.index({ userId: 1, conversationId: 1 }, { unique: true });

const steelQuotationArtifactSchema: Schema<ISteelQuotationArtifact> =
  new Schema<ISteelQuotationArtifact>(
    {
      userId: { type: String, required: true },
      conversationId: { type: String, required: true },
      tenantId: { type: String },
      runId: { type: String, required: true },
      operationId: { type: String, required: true },
      kind: {
        type: String,
        enum: ['snapshot', 'chunk', 'tool', 'main', 'final', 'archive'],
        required: true,
      },
      sha256: { type: String, required: true },
      payload: { type: String, required: true },
      markdownPublication: { type: new Schema({
        reference: { type: steelMarkdownReferenceSchema, required: true },
        rawMarkdown: { type: String, required: true },
        baselineMarkdown: { type: String, required: true },
        sourceMappings: { type: [steelQuotationSourceMappingSchema], default: undefined },
      }, { _id: false }) },
    },
    { timestamps: true },
  );

steelQuotationArtifactSchema.index(
  { userId: 1, conversationId: 1, runId: 1, operationId: 1, sha256: 1 },
  { unique: true },
);
steelQuotationArtifactSchema.index({ userId: 1, conversationId: 1, runId: 1, operationId: 1 });

export { steelQuotationArtifactSchema };
export default steelQuotationStateSchema;
