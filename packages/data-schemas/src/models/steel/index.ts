import type * as t from '~/types';
import type { Model, Schema } from 'mongoose';
import {
  steelAICapabilitySchema,
  steelAIRunSchema,
  steelAdminImportSessionSchema,
  steelAdminMappingProfileSchema,
  steelAdminMergeTableSchema,
  steelAuditLogSchema,
  steelConversationMetaSchema,
  steelConversationTurnSchema,
  steelExcelExportSchema,
  steelMemoryCandidateSchema,
  steelMemorySchema,
  steelOcrPdfChunkArtifactSchema,
  steelProjectSchema,
  steelProjectSourceSchema,
  steelSourceVersionSchema,
  steelToolCallSchema,
  steelWorkingOrderMemorySchema,
} from '~/schema/steel';

type Mongoose = typeof import('mongoose');

function getExistingModel<T>(mongoose: Mongoose, modelName: string): Model<T> | undefined {
  return mongoose.models[modelName] as Model<T> | undefined;
}

function createSteelNamedStateModel(
  mongoose: Mongoose,
  modelName: string,
  schema: Schema<t.ISteelNamedState>,
  collectionName: string,
) : Model<t.ISteelNamedState> {
  return (
    getExistingModel<t.ISteelNamedState>(mongoose, modelName) ||
    mongoose.model<t.ISteelNamedState>(modelName, schema, collectionName)
  );
}

export function createSteelConversationMetaModel(mongoose: Mongoose): Model<t.ISteelConversationMeta> {
  return (
    getExistingModel<t.ISteelConversationMeta>(mongoose, 'SteelConversationMeta') ||
    mongoose.model<t.ISteelConversationMeta>(
      'SteelConversationMeta',
      steelConversationMetaSchema,
      'steel_conversation_meta',
    )
  );
}

export function createSteelConversationTurnModel(mongoose: Mongoose): Model<t.ISteelConversationTurn> {
  return (
    getExistingModel<t.ISteelConversationTurn>(mongoose, 'SteelConversationTurn') ||
    mongoose.model<t.ISteelConversationTurn>(
      'SteelConversationTurn',
      steelConversationTurnSchema,
      'steel_conversation_turns',
    )
  );
}

export function createSteelWorkingOrderMemoryModel(mongoose: Mongoose): Model<t.ISteelWorkingOrderMemory> {
  return (
    getExistingModel<t.ISteelWorkingOrderMemory>(mongoose, 'SteelWorkingOrderMemory') ||
    mongoose.model<t.ISteelWorkingOrderMemory>(
      'SteelWorkingOrderMemory',
      steelWorkingOrderMemorySchema,
      'steel_working_order_memory',
    )
  );
}

export function createSteelOcrPdfChunkArtifactModel(
  mongoose: Mongoose,
): Model<t.ISteelOcrPdfChunkArtifact> {
  return (
    getExistingModel<t.ISteelOcrPdfChunkArtifact>(mongoose, 'SteelOcrPdfChunkArtifact') ||
    mongoose.model<t.ISteelOcrPdfChunkArtifact>(
      'SteelOcrPdfChunkArtifact',
      steelOcrPdfChunkArtifactSchema,
      'steel_ocr_pdf_chunk_artifacts',
    )
  );
}

export function createSteelAIRunModel(mongoose: Mongoose): Model<t.ISteelAIRun> {
  return (
    getExistingModel<t.ISteelAIRun>(mongoose, 'SteelAIRun') ||
    mongoose.model<t.ISteelAIRun>('SteelAIRun', steelAIRunSchema, 'steel_ai_runs')
  );
}

export function createSteelAICapabilityModel(mongoose: Mongoose): Model<t.ISteelAICapability> {
  return (
    getExistingModel<t.ISteelAICapability>(mongoose, 'SteelAICapability') ||
    mongoose.model<t.ISteelAICapability>(
      'SteelAICapability',
      steelAICapabilitySchema,
      'steel_ai_capabilities',
    )
  );
}

export function createSteelAuditLogModel(mongoose: Mongoose): Model<t.ISteelAuditLog> {
  return (
    getExistingModel<t.ISteelAuditLog>(mongoose, 'SteelAuditLog') ||
    mongoose.model<t.ISteelAuditLog>('SteelAuditLog', steelAuditLogSchema, 'steel_audit_logs')
  );
}

export function createSteelSourceVersionModel(mongoose: Mongoose): Model<t.ISteelSourceVersion> {
  return (
    getExistingModel<t.ISteelSourceVersion>(mongoose, 'SteelSourceVersion') ||
    mongoose.model<t.ISteelSourceVersion>(
      'SteelSourceVersion',
      steelSourceVersionSchema,
      'steel_source_versions',
    )
  );
}

export function createSteelToolCallModel(mongoose: Mongoose): Model<t.ISteelToolCall> {
  return (
    getExistingModel<t.ISteelToolCall>(mongoose, 'SteelToolCall') ||
    mongoose.model<t.ISteelToolCall>('SteelToolCall', steelToolCallSchema, 'steel_tool_calls')
  );
}

export function createSteelExcelExportModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelNamedStateModel(
    mongoose,
    'SteelExcelExport',
    steelExcelExportSchema,
    'steel_excel_exports',
  );
}

export function createSteelProjectModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelNamedStateModel(mongoose, 'SteelProject', steelProjectSchema, 'steel_projects');
}

export function createSteelProjectSourceModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelNamedStateModel(
    mongoose,
    'SteelProjectSource',
    steelProjectSourceSchema,
    'steel_project_sources',
  );
}

export function createSteelAdminImportSessionModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelNamedStateModel(
    mongoose,
    'SteelAdminImportSession',
    steelAdminImportSessionSchema,
    'steel_admin_import_sessions',
  );
}

export function createSteelAdminMergeTableModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelNamedStateModel(
    mongoose,
    'SteelAdminMergeTable',
    steelAdminMergeTableSchema,
    'steel_admin_merge_tables',
  );
}

export function createSteelAdminMappingProfileModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelNamedStateModel(
    mongoose,
    'SteelAdminMappingProfile',
    steelAdminMappingProfileSchema,
    'steel_admin_mapping_profiles',
  );
}

export function createSteelMemoryCandidateModel(mongoose: Mongoose): Model<t.ISteelMemoryCandidate> {
  return (
    getExistingModel<t.ISteelMemoryCandidate>(mongoose, 'SteelMemoryCandidate') ||
    mongoose.model<t.ISteelMemoryCandidate>(
      'SteelMemoryCandidate',
      steelMemoryCandidateSchema,
      'steel_memory_candidates',
    )
  );
}

export function createSteelMemoryModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelNamedStateModel(mongoose, 'SteelMemory', steelMemorySchema, 'steel_memories');
}
