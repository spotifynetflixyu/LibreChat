import type { Model, Schema } from 'mongoose';
import type * as t from '~/types';
import {
  steelMemoryCandidateSchema,
  steelOcrPdfChunkArtifactSchema,
  steelWorkingOrderMemorySchema,
  steelDelegateOcrRunSchema,
  steelConversationOcrStateSchema,
  steelOcrResponseAuditSchema,
  steelQuotationStateSchema,
  steelQuotationArtifactSchema,
  steelReviewOutputSchema,
} from '~/schema/steel';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import { guardSteelConversationModel } from './lifecycle';

export {
  fenceSteelConversationWrites,
  guardSteelConversationModel,
  readSteelConversationDeletionScope,
  SteelConversationDeletedError,
} from './lifecycle';

type Mongoose = typeof import('mongoose');

function createSteelModel<T>(
  mongoose: Mongoose,
  modelName: string,
  schema: Schema<T>,
  collectionName: string,
): Model<T> {
  return (
    (mongoose.models[modelName] as Model<T> | undefined) ||
    mongoose.model<T>(modelName, schema, collectionName)
  );
}

export function createSteelWorkingOrderMemoryModel(
  mongoose: Mongoose,
): Model<t.ISteelWorkingOrderMemory> {
  return guardSteelConversationModel(mongoose, createSteelModel(
    mongoose,
    'SteelWorkingOrderMemory',
    steelWorkingOrderMemorySchema,
    'steel_working_order_memory',
  ), true);
}

export function createSteelDelegateOcrRunModel(
  mongoose: Mongoose,
): Model<t.ISteelDelegateOcrRun> {
  return guardSteelConversationModel(mongoose, createSteelModel(
    mongoose,
    'SteelDelegateOcrRun',
    steelDelegateOcrRunSchema,
    'steel_delegate_ocr_runs',
  ), true);
}

export function createSteelConversationOcrStateModel(
  mongoose: Mongoose,
): Model<t.ISteelConversationOcrState> {
  return guardSteelConversationModel(mongoose, createSteelModel(
    mongoose,
    'SteelConversationOcrState',
    steelConversationOcrStateSchema,
    'steel_conversation_ocr_state',
  ), true);
}

export function createSteelOcrResponseAuditModel(
  mongoose: Mongoose,
): Model<t.ISteelOcrResponseAudit> {
  applyTenantIsolation(steelOcrResponseAuditSchema);
  return guardSteelConversationModel(mongoose, createSteelModel(
    mongoose,
    'SteelOcrResponseAudit',
    steelOcrResponseAuditSchema,
    'steel_ocr_response_audits',
  ), false);
}

export function createSteelQuotationStateModel(mongoose: Mongoose): Model<t.ISteelQuotationState> {
  return guardSteelConversationModel(mongoose, createSteelModel(
    mongoose,
    'SteelQuotationState',
    steelQuotationStateSchema,
    'steel_quotation_states',
  ), false);
}

export function createSteelQuotationArtifactModel(
  mongoose: Mongoose,
): Model<t.ISteelQuotationArtifact> {
  return guardSteelConversationModel(mongoose, createSteelModel(
    mongoose,
    'SteelQuotationArtifact',
    steelQuotationArtifactSchema,
    'steel_quotation_artifacts',
  ), false);
}

export function createSteelReviewOutputModel(mongoose: Mongoose): Model<t.ISteelReviewOutput> {
  return guardSteelConversationModel(mongoose, createSteelModel(
    mongoose,
    'SteelReviewOutput',
    steelReviewOutputSchema,
    'steel_review_outputs',
  ), false);
}

export function createSteelOcrPdfChunkArtifactModel(
  mongoose: Mongoose,
): Model<t.ISteelOcrPdfChunkArtifact> {
  return createSteelModel(
    mongoose,
    'SteelOcrPdfChunkArtifact',
    steelOcrPdfChunkArtifactSchema,
    'steel_ocr_pdf_chunk_artifacts',
  );
}

export function createSteelMemoryCandidateModel(
  mongoose: Mongoose,
): Model<t.ISteelMemoryCandidate> {
  return createSteelModel(
    mongoose,
    'SteelMemoryCandidate',
    steelMemoryCandidateSchema,
    'steel_memory_candidates',
  );
}

