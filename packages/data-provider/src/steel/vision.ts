import { z } from 'zod';

export const requiredSteelFileAnalysisSheetIds = [
  'file_analysis_data',
  'manual_review',
  'interpretation_notes',
] as const;

export type SteelFileAnalysisSheetId = (typeof requiredSteelFileAnalysisSheetIds)[number];

export const steelFileAnalysisSheetIdSchema = z.enum(requiredSteelFileAnalysisSheetIds);

export const steelFileAnalysisCellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type SteelFileAnalysisCellValue = z.infer<typeof steelFileAnalysisCellValueSchema>;

export const steelFileAnalysisColumnValueTypes = [
  'text',
  'number',
  'boolean',
  'date',
  'status',
] as const;

export const steelFileAnalysisColumnValueTypeSchema = z.enum(steelFileAnalysisColumnValueTypes);

export const steelFileAnalysisColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  valueType: steelFileAnalysisColumnValueTypeSchema.default('text'),
});

export type SteelFileAnalysisColumn = z.infer<typeof steelFileAnalysisColumnSchema>;

export const steelFileAnalysisOcrStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'skipped',
]);

export const steelFileAnalysisSourceFileSchema = z.object({
  fileId: z.string().min(1),
  filename: z.string().min(1).optional(),
  mediaType: z.string().min(1),
  pageCount: z.number().int().positive().optional(),
  ocrEngine: z.string().min(1).optional(),
  ocrStatus: steelFileAnalysisOcrStatusSchema.optional(),
  processedAt: z.string().datetime().optional(),
  errorMessage: z.string().min(1).optional(),
});

export type SteelFileAnalysisSourceFile = z.infer<typeof steelFileAnalysisSourceFileSchema>;

export const steelFileAnalysisSourceRefSchema = steelFileAnalysisSourceFileSchema.extend({
  sourceKey: z.string().min(1).optional(),
  imageIndex: z.number().int().positive().optional(),
  page: z.number().int().positive().optional(),
  regionLabel: z.string().min(1).optional(),
  orientation: z.enum(['0', '90', '180', '270']).optional(),
});

export type SteelFileAnalysisSourceRef = z.infer<typeof steelFileAnalysisSourceRefSchema>;

export const steelFileAnalysisReviewStatusSchema = z.enum([
  'pending_review',
  'confirmed',
  'corrected',
]);

export const steelFileAnalysisConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const steelFileAnalysisRowSchema = z.object({
  id: z.string().min(1),
  sourceRef: steelFileAnalysisSourceRefSchema,
  cells: z.record(steelFileAnalysisCellValueSchema).default({}),
  confidence: steelFileAnalysisConfidenceSchema.default('medium'),
  reviewStatus: steelFileAnalysisReviewStatusSchema.default('pending_review'),
  rowWarnings: z.array(z.string()).default([]),
});

export type SteelFileAnalysisRow = z.infer<typeof steelFileAnalysisRowSchema>;

export const steelFileAnalysisReviewRowSchema = z.object({
  id: z.string().min(1),
  sourceRef: steelFileAnalysisSourceRefSchema.optional(),
  cells: z.record(steelFileAnalysisCellValueSchema).default({}),
  confidence: steelFileAnalysisConfidenceSchema.default('low'),
  reviewStatus: steelFileAnalysisReviewStatusSchema.default('pending_review'),
  rowWarnings: z.array(z.string()).default([]),
});

export type SteelFileAnalysisReviewRow = z.infer<typeof steelFileAnalysisReviewRowSchema>;

export const steelFileAnalysisNoteRowSchema = z.object({
  id: z.string().min(1),
  sourceRef: steelFileAnalysisSourceRefSchema.optional(),
  cells: z.record(steelFileAnalysisCellValueSchema).default({}),
  confidence: steelFileAnalysisConfidenceSchema.default('medium'),
});

export type SteelFileAnalysisNoteRow = z.infer<typeof steelFileAnalysisNoteRowSchema>;

export const steelFileAnalysisSheetSchema = z.object({
  columns: z.array(steelFileAnalysisColumnSchema).default([]),
  rows: z.array(steelFileAnalysisRowSchema).default([]),
});

export const steelFileAnalysisReviewSheetSchema = z.object({
  columns: z.array(steelFileAnalysisColumnSchema).default([]),
  rows: z.array(steelFileAnalysisReviewRowSchema).default([]),
});

export const steelFileAnalysisNoteSheetSchema = z.object({
  columns: z.array(steelFileAnalysisColumnSchema).default([]),
  rows: z.array(steelFileAnalysisNoteRowSchema).default([]),
});

export const steelFileAnalysisDataSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'user_confirmed', 'projected_to_workbook']).default('draft'),
  sourceFiles: z.array(steelFileAnalysisSourceFileSchema).default([]),
  sheets: z.object({
    file_analysis_data: steelFileAnalysisSheetSchema,
    manual_review: steelFileAnalysisReviewSheetSchema,
    interpretation_notes: steelFileAnalysisNoteSheetSchema,
  }),
});

export type SteelFileAnalysisData = z.infer<typeof steelFileAnalysisDataSchema>;

export const steelFileAnalysisReadResponseSchema = z.object({
  fileAnalysisData: steelFileAnalysisDataSchema.nullable(),
});

export type SteelFileAnalysisReadResponse = z.infer<typeof steelFileAnalysisReadResponseSchema>;

const patchFileAnalysisRowSchema = z.object({
  id: z.string().min(1).optional(),
  sourceRef: steelFileAnalysisSourceRefSchema.optional(),
  cells: z.record(steelFileAnalysisCellValueSchema).default({}),
  confidence: steelFileAnalysisConfidenceSchema.optional(),
  reviewStatus: steelFileAnalysisReviewStatusSchema.optional(),
  rowWarnings: z.array(z.string()).optional(),
});

export const patchFileAnalysisDataToolInputSchema = z.object({
  fileAnalysisDataId: z.string().min(1).optional(),
  sourceFiles: z.array(steelFileAnalysisSourceFileSchema).default([]),
  patches: z.array(
    z.object({
      sheetId: steelFileAnalysisSheetIdSchema,
      upsertColumns: z.array(steelFileAnalysisColumnSchema).default([]),
      upsertRows: z.array(patchFileAnalysisRowSchema).default([]),
      deleteRowIds: z.array(z.string().min(1)).default([]),
    }),
  ),
  summary: z.string().min(1).optional(),
});

export type PatchFileAnalysisDataToolInput = z.infer<typeof patchFileAnalysisDataToolInputSchema>;

export const steelFileAnalysisManualPatchRequestSchema = patchFileAnalysisDataToolInputSchema
  .omit({ fileAnalysisDataId: true })
  .refine((input) => input.patches.every((patch) => patch.sheetId === 'file_analysis_data'), {
    message: 'Manual file analysis patches may only update file_analysis_data.',
    path: ['patches'],
  });

export type SteelFileAnalysisManualPatchRequest = z.infer<
  typeof steelFileAnalysisManualPatchRequestSchema
>;

export const steelFileAnalysisManualPatchResponseSchema = z.object({
  fileAnalysisData: steelFileAnalysisDataSchema,
});

export type SteelFileAnalysisManualPatchResponse = z.infer<
  typeof steelFileAnalysisManualPatchResponseSchema
>;
