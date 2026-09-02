import { Schema } from 'mongoose';

import type {
  ISteelConversationOcrState,
  SteelActiveDelegateClaim,
  SteelConversationOcrResultProvenance,
  SteelConversationOcrSourceMapping,
  SteelSupersededClaimRecovery,
} from '~/types';

const steelActiveDelegateClaimSchema: Schema<SteelActiveDelegateClaim> =
  new Schema<SteelActiveDelegateClaim>(
    {
      claimToken: { type: String, required: true },
      triggeringMessageId: { type: String, required: true },
      delegateOcrIndex: { type: Number, required: true },
      responseGenerationId: { type: String },
      executionLeaseToken: { type: String },
      phase: { type: String, enum: ['claimed', 'agent_running', 'finalizing'], required: true },
      claimedAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
    },
    { _id: false },
  );

const steelSupersededClaimRecoverySchema: Schema<SteelSupersededClaimRecovery> =
  new Schema<SteelSupersededClaimRecovery>(
    {
      claimToken: { type: String, required: true },
      delegateOcrIndex: { type: Number, required: true },
      supersededByClaimToken: { type: String, required: true },
      reason: { type: String, required: true },
      at: { type: Date, required: true },
    },
    { _id: false },
  );

const steelConversationOcrSourceMappingSchema: Schema<SteelConversationOcrSourceMapping> =
  new Schema<SteelConversationOcrSourceMapping>(
    {
      fileId: { type: String, required: true },
      sourceCode: { type: String, required: true },
      sourceFilename: { type: String, required: true },
      createdAt: { type: Date },
    },
    { _id: false },
  );

const steelConversationOcrResultProvenanceSchema: Schema<SteelConversationOcrResultProvenance> =
  new Schema<SteelConversationOcrResultProvenance>(
    {
      generationId: { type: String, required: true },
      attemptNumber: { type: Number, required: true },
      messageId: { type: String },
      claimToken: { type: String },
      updatedAt: { type: Date },
    },
    { _id: false },
  );

const steelConversationOcrStateSchema: Schema<ISteelConversationOcrState> =
  new Schema<ISteelConversationOcrState>(
    {
      conversationId: { type: String, required: true, unique: true, index: true },
      nextDelegateOcrIndex: { type: Number, required: true, default: 0 },
      activeDelegateClaim: { type: steelActiveDelegateClaimSchema },
      supersededClaimRecovery: { type: steelSupersededClaimRecoverySchema },
      sourceMappings: {
        type: [steelConversationOcrSourceMappingSchema],
        required: true,
        default: [],
      },
      currentOcrResultMarkdown: { type: String },
      currentOcrResultMessageId: { type: String },
      currentOcrResultIndex: { type: Number },
      currentOcrResultGenerationId: { type: String },
      currentOcrResultAttemptNumber: { type: Number },
      currentOcrResultProvenance: { type: steelConversationOcrResultProvenanceSchema },
    },
    { timestamps: true },
  );

export default steelConversationOcrStateSchema;
