import type * as t from '~/types';
import {
  steelAICapabilitySchema,
  steelAIRunSchema,
  steelAdminImportSessionSchema,
  steelAdminMappingProfileSchema,
  steelAdminMergeTableSchema,
  steelAuditLogSchema,
  steelConversationMetaSchema,
  steelExcelExportSchema,
  steelMemoryCandidateSchema,
  steelMemorySchema,
  steelProjectSchema,
  steelProjectSourceSchema,
  steelSourceVersionSchema,
  steelToolCallSchema,
} from '~/schema/steel';

type Mongoose = typeof import('mongoose');

function createSteelNamedStateModel(
  mongoose: Mongoose,
  modelName: string,
  schema: Parameters<Mongoose['model']>[1],
  collectionName: string,
) {
  return (
    mongoose.models[modelName] ||
    mongoose.model<t.ISteelNamedState>(modelName, schema, collectionName)
  );
}

export function createSteelConversationMetaModel(mongoose: Mongoose) {
  return (
    mongoose.models.SteelConversationMeta ||
    mongoose.model<t.ISteelConversationMeta>(
      'SteelConversationMeta',
      steelConversationMetaSchema,
      'steel_conversation_meta',
    )
  );
}

export function createSteelAIRunModel(mongoose: Mongoose) {
  return (
    mongoose.models.SteelAIRun ||
    mongoose.model<t.ISteelAIRun>('SteelAIRun', steelAIRunSchema, 'steel_ai_runs')
  );
}

export function createSteelAICapabilityModel(mongoose: Mongoose) {
  return (
    mongoose.models.SteelAICapability ||
    mongoose.model<t.ISteelAICapability>(
      'SteelAICapability',
      steelAICapabilitySchema,
      'steel_ai_capabilities',
    )
  );
}

export function createSteelAuditLogModel(mongoose: Mongoose) {
  return (
    mongoose.models.SteelAuditLog ||
    mongoose.model<t.ISteelAuditLog>('SteelAuditLog', steelAuditLogSchema, 'steel_audit_logs')
  );
}

export function createSteelSourceVersionModel(mongoose: Mongoose) {
  return (
    mongoose.models.SteelSourceVersion ||
    mongoose.model<t.ISteelSourceVersion>(
      'SteelSourceVersion',
      steelSourceVersionSchema,
      'steel_source_versions',
    )
  );
}

export function createSteelToolCallModel(mongoose: Mongoose) {
  return (
    mongoose.models.SteelToolCall ||
    mongoose.model<t.ISteelToolCall>('SteelToolCall', steelToolCallSchema, 'steel_tool_calls')
  );
}

export function createSteelExcelExportModel(mongoose: Mongoose) {
  return createSteelNamedStateModel(
    mongoose,
    'SteelExcelExport',
    steelExcelExportSchema,
    'steel_excel_exports',
  );
}

export function createSteelProjectModel(mongoose: Mongoose) {
  return createSteelNamedStateModel(mongoose, 'SteelProject', steelProjectSchema, 'steel_projects');
}

export function createSteelProjectSourceModel(mongoose: Mongoose) {
  return createSteelNamedStateModel(
    mongoose,
    'SteelProjectSource',
    steelProjectSourceSchema,
    'steel_project_sources',
  );
}

export function createSteelAdminImportSessionModel(mongoose: Mongoose) {
  return createSteelNamedStateModel(
    mongoose,
    'SteelAdminImportSession',
    steelAdminImportSessionSchema,
    'steel_admin_import_sessions',
  );
}

export function createSteelAdminMergeTableModel(mongoose: Mongoose) {
  return createSteelNamedStateModel(
    mongoose,
    'SteelAdminMergeTable',
    steelAdminMergeTableSchema,
    'steel_admin_merge_tables',
  );
}

export function createSteelAdminMappingProfileModel(mongoose: Mongoose) {
  return createSteelNamedStateModel(
    mongoose,
    'SteelAdminMappingProfile',
    steelAdminMappingProfileSchema,
    'steel_admin_mapping_profiles',
  );
}

export function createSteelMemoryCandidateModel(mongoose: Mongoose) {
  return (
    mongoose.models.SteelMemoryCandidate ||
    mongoose.model<t.ISteelMemoryCandidate>(
      'SteelMemoryCandidate',
      steelMemoryCandidateSchema,
      'steel_memory_candidates',
    )
  );
}

export function createSteelMemoryModel(mongoose: Mongoose) {
  return createSteelNamedStateModel(mongoose, 'SteelMemory', steelMemorySchema, 'steel_memories');
}
