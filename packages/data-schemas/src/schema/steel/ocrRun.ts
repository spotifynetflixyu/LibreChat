import { Schema } from 'mongoose';
import { randomUUID } from 'crypto';

import type {
  ISteelOcrRun,
  SteelDelegateOcrFinalizationJournal,
  SteelDelegateOcrFinalizedCandidate,
  SteelDelegateOcrSupersedeProvenance,
  SteelDelegateOcrToolFile,
  SteelDelegateOcrToolParameters,
} from '~/types';

const steelDelegateOcrToolParametersSchema = new Schema({}, {
  _id: false,
  strict: false,
}) as unknown as Schema<SteelDelegateOcrToolParameters>;

const steelDelegateOcrToolFileSchema: Schema<SteelDelegateOcrToolFile> =
  new Schema<SteelDelegateOcrToolFile>(
    {
      fileId: { type: String, required: true },
      filename: { type: String, required: true },
      storageKey: { type: String },
      mediaType: { type: String },
      pageNumber: { type: Number },
      imageIndex: { type: Number },
    },
    { _id: false },
  );

const steelDelegateOcrFinalizedCandidateSchema: Schema<SteelDelegateOcrFinalizedCandidate> =
  new Schema<SteelDelegateOcrFinalizedCandidate>(
    {
      token: { type: String, required: true },
      markdown: { type: String, required: true },
      source: { type: String, enum: ['agent', 'backend'], required: true },
      generationId: { type: String },
      targetMessageId: { type: String },
      createdAt: { type: Date },
    },
    { _id: false },
  );

const steelDelegateOcrFinalizationJournalSchema: Schema<SteelDelegateOcrFinalizationJournal> =
  new Schema<SteelDelegateOcrFinalizationJournal>(
    {
      candidateValidated: { type: Boolean, default: false },
      candidateValidatedToken: { type: String },
      resultPersisted: { type: Boolean, default: false },
      resultPersistedToken: { type: String },
      messagePersisted: { type: Boolean, default: false },
      messagePersistedToken: { type: String },
      claimCleared: { type: Boolean, default: false },
      claimClearedToken: { type: String },
    },
    { _id: false },
  );

const steelDelegateOcrSupersedeProvenanceSchema: Schema<SteelDelegateOcrSupersedeProvenance> =
  new Schema<SteelDelegateOcrSupersedeProvenance>(
    {
      supersededByClaimToken: { type: String, required: true },
      supersededByRunId: { type: String },
      reason: { type: String, required: true },
      at: { type: Date, required: true },
    },
    { _id: false },
  );

const steelOcrRunSchema = new Schema(
  {
    conversationId: { type: String, required: true, index: true },
    userId: { type: String, index: true },
    tenantId: { type: String, index: true },
    runId: { type: String, required: true, unique: true, default: () => randomUUID() },
    kind: { type: String, enum: ['preflight', 'delegate'], required: true, default: 'delegate' },
    completedChunks: { type: Number, required: true, default: 0, min: 0 },
    totalChunks: { type: Number, required: true, default: 0, min: 0 },
    errorMessage: { type: String },
    delegateOcrIndex: { type: Number, required: true },
    claimToken: { type: String, required: true, unique: true },
    activeResumeKey: { type: String, unique: true, sparse: true },
    triggeringMessageId: { type: String, required: true, index: true },
    triggeringMessageText: { type: String },
    toolParameters: { type: steelDelegateOcrToolParametersSchema, required: true },
    files: { type: [steelDelegateOcrToolFileSchema], required: true, default: [] },
    status: {
      type: String,
      enum: ['running', 'paused', 'interrupted', 'failed', 'completed', 'cancelled'],
      required: true,
      index: true,
    },
    stage: {
      type: String,
      required: true,
      index: true,
    },
    executionLeaseToken: { type: String, index: true },
    executionLeaseExpiresAt: { type: Date, index: true },
    agentAttemptNumber: { type: Number, required: true, default: 0 },
    agentAttemptToken: { type: String, index: true },
    saveAttemptNumber: { type: Number, required: true, default: 0 },
    saveAttemptToken: { type: String, index: true },
    responseGenerationId: { type: String, index: true },
    resumeSourceMessageIds: { type: [String], default: undefined },
    executionEpoch: { type: Number },
    targetMessageId: { type: String, index: true },
    finalizedCandidate: { type: steelDelegateOcrFinalizedCandidateSchema },
    failureKind: { type: String, enum: ['invalid_output', 'persistence'] },
    finalizationJournal: {
      type: steelDelegateOcrFinalizationJournalSchema,
      required: true,
      default: () => ({}),
    },
    supersedeProvenance: { type: steelDelegateOcrSupersedeProvenanceSchema },
  },
  { timestamps: true },
) as unknown as Schema<ISteelOcrRun>;

steelOcrRunSchema.index({ conversationId: 1, delegateOcrIndex: 1 }, { unique: true, partialFilterExpression: { kind: 'delegate' } });
steelOcrRunSchema.index({ userId: 1, tenantId: 1, conversationId: 1, kind: 1, createdAt: -1 });
steelOcrRunSchema.index({ conversationId: 1, triggeringMessageId: 1, status: 1 });
steelOcrRunSchema.index({ conversationId: 1, status: 1, executionLeaseExpiresAt: 1 });
steelOcrRunSchema.index({ userId: 1, tenantId: 1, conversationId: 1, responseGenerationId: 1, executionEpoch: 1 }, { unique: true, partialFilterExpression: { kind: 'preflight' } });

export default steelOcrRunSchema;
