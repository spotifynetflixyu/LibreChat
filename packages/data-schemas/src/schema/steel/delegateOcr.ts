import { Schema } from 'mongoose';

import type {
  ISteelDelegateOcrRun,
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

const steelDelegateOcrRunSchema = new Schema(
  {
    conversationId: { type: String, required: true, index: true },
    delegateOcrIndex: { type: Number, required: true },
    claimToken: { type: String, required: true, unique: true },
    activeResumeKey: { type: String, unique: true, sparse: true },
    triggeringMessageId: { type: String, required: true, index: true },
    triggeringMessageText: { type: String },
    toolParameters: { type: steelDelegateOcrToolParametersSchema, required: true },
    files: { type: [steelDelegateOcrToolFileSchema], required: true, default: [] },
    status: {
      type: String,
      enum: [
        'running',
        'agent_running',
        'finalizing',
        'completed',
        'agent_failed',
        'save_failed',
        'superseded',
      ],
      required: true,
      index: true,
    },
    currentStage: {
      type: String,
      enum: ['claiming', 'preflight', 'agent', 'saving', 'finalizing', 'completed', 'failed'],
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
) as unknown as Schema<ISteelDelegateOcrRun>;

steelDelegateOcrRunSchema.index({ conversationId: 1, delegateOcrIndex: 1 }, { unique: true });
steelDelegateOcrRunSchema.index({ conversationId: 1, triggeringMessageId: 1, status: 1 });
steelDelegateOcrRunSchema.index({ conversationId: 1, status: 1, executionLeaseExpiresAt: 1 });

export default steelDelegateOcrRunSchema;
