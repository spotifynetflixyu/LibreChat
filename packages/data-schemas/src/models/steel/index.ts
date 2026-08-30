import type * as t from '~/types';
import type { Model, Schema } from 'mongoose';
import {
  steelAICapabilitySchema,
  steelAIRunSchema,
  steelAdminImportSessionSchema,
  steelAdminMappingProfileSchema,
  steelAdminMergeTableSchema,
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
  return createSteelModel(
    mongoose,
    'SteelWorkingOrderMemory',
    steelWorkingOrderMemorySchema,
    'steel_working_order_memory',
  );
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

export function createSteelAIRunModel(mongoose: Mongoose): Model<t.ISteelAIRun> {
  return createSteelModel(mongoose, 'SteelAIRun', steelAIRunSchema, 'steel_ai_runs');
}

export function createSteelAICapabilityModel(mongoose: Mongoose): Model<t.ISteelAICapability> {
  return createSteelModel(
    mongoose,
    'SteelAICapability',
    steelAICapabilitySchema,
    'steel_ai_capabilities',
  );
}

export function createSteelSourceVersionModel(mongoose: Mongoose): Model<t.ISteelSourceVersion> {
  return createSteelModel(
    mongoose,
    'SteelSourceVersion',
    steelSourceVersionSchema,
    'steel_source_versions',
  );
}

export function createSteelToolCallModel(mongoose: Mongoose): Model<t.ISteelToolCall> {
  return createSteelModel(mongoose, 'SteelToolCall', steelToolCallSchema, 'steel_tool_calls');
}

export function createSteelExcelExportModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelModel(
    mongoose,
    'SteelExcelExport',
    steelExcelExportSchema,
    'steel_excel_exports',
  );
}

export function createSteelProjectModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelModel(mongoose, 'SteelProject', steelProjectSchema, 'steel_projects');
}

export function createSteelProjectSourceModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelModel(
    mongoose,
    'SteelProjectSource',
    steelProjectSourceSchema,
    'steel_project_sources',
  );
}

export function createSteelAdminImportSessionModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelModel(
    mongoose,
    'SteelAdminImportSession',
    steelAdminImportSessionSchema,
    'steel_admin_import_sessions',
  );
}

export function createSteelAdminMergeTableModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelModel(
    mongoose,
    'SteelAdminMergeTable',
    steelAdminMergeTableSchema,
    'steel_admin_merge_tables',
  );
}

export function createSteelAdminMappingProfileModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelModel(
    mongoose,
    'SteelAdminMappingProfile',
    steelAdminMappingProfileSchema,
    'steel_admin_mapping_profiles',
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

export function createSteelMemoryModel(mongoose: Mongoose): Model<t.ISteelNamedState> {
  return createSteelModel(mongoose, 'SteelMemory', steelMemorySchema, 'steel_memories');
}
