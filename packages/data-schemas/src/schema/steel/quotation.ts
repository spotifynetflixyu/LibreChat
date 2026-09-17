import { Schema } from 'mongoose';

import type {
  ISteelQuotationArtifact,
  ISteelQuotationState,
  SteelQuotationActiveRun,
  SteelQuotationArtifactRef,
  SteelQuotationCheckpointRef,
  SteelQuotationChunkState,
  SteelQuotationCustomerPreparation,
  SteelQuotationOrder,
  SteelQuotationPendingMessage,
  SteelQuotationPendingMessageFile,
  SteelQuotationSelectionProvenance,
  SteelQuotationSnapshotPrompts,
  SteelQuotationTicket,
} from '~/types';

const steelQuotationOrderSchema = new Schema<SteelQuotationOrder>(
  {
    markdown: { type: String, required: true },
    sha256: { type: String, required: true },
    revision: { type: String },
    messageId: { type: String },
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
  },
  { _id: false },
);

const steelQuotationSnapshotPromptsSchema = new Schema<SteelQuotationSnapshotPrompts>(
  {
    child: { type: String, required: true },
    main: { type: String, required: true },
  },
  { _id: false },
);

const steelQuotationArtifactRefSchema = new Schema<SteelQuotationArtifactRef>(
  {
    artifactId: { type: String, required: true },
    userId: { type: String, required: true },
    conversationId: { type: String, required: true },
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
    snapshotRef: { type: steelQuotationArtifactRefSchema, required: true },
    chunks: { type: [steelQuotationChunkSchema], required: true, default: [] },
    checkpointRefs: {
      type: [steelQuotationCheckpointRefSchema],
      required: true,
      default: [],
    },
    leaseToken: { type: String },
    leaseExpiresAt: { type: Date },
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

const steelQuotationStateSchema: Schema<ISteelQuotationState> = new Schema<ISteelQuotationState>(
  {
    userId: { type: String, required: true },
    conversationId: { type: String, required: true },
    currentOrder: { type: steelQuotationOrderSchema },
    currentCustomer: { type: steelQuotationCustomerPreparationSchema },
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
      runId: { type: String, required: true },
      operationId: { type: String, required: true },
      kind: {
        type: String,
        enum: ['snapshot', 'chunk', 'tool', 'main', 'final', 'archive'],
        required: true,
      },
      sha256: { type: String, required: true },
      payload: { type: String, required: true },
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
