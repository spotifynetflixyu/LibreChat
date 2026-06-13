import { z } from 'zod';

export const requiredSteelWorkbookSheetIds = [
  'system_order',
  'quote_details',
  'summary',
  'manual_review',
  'price_sources',
  'interpretation_notes',
  'customer_quote',
] as const;

export type SteelWorkbookSheetId = (typeof requiredSteelWorkbookSheetIds)[number];

export const steelWorkbookSheetIdSchema = z.enum(requiredSteelWorkbookSheetIds);

export const steelSelectedWorkbookRefSchema = z.object({
  workbookId: z.string().min(1),
  workbookVersion: z.number().int().positive(),
  sheetId: steelWorkbookSheetIdSchema,
  rowId: z.string().min(1),
  columnKey: z.string().min(1),
  displayLabel: z.string().min(1).optional(),
});

export type SteelSelectedWorkbookRef = z.infer<typeof steelSelectedWorkbookRefSchema>;

export const steelChangedPathSchema = z.object({
  sheetId: steelWorkbookSheetIdSchema,
  rowId: z.string().min(1),
  columnKey: z.string().min(1),
});

export type SteelChangedPath = z.infer<typeof steelChangedPathSchema>;

export const steelChangedFieldSummarySchema = steelChangedPathSchema.extend({
  label: z.string().min(1),
  previousValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  nextValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export type SteelChangedFieldSummary = z.infer<typeof steelChangedFieldSummarySchema>;

const steelWorkbookCellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type SteelWorkbookCellValue = z.infer<typeof steelWorkbookCellValueSchema>;

export const steelWorkbookColumnValueTypes = [
  'text',
  'number',
  'currency',
  'boolean',
  'date',
  'status',
  'formula',
] as const;

export const steelWorkbookColumnValueTypeSchema = z.enum(steelWorkbookColumnValueTypes);

export const steelWorkbookColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  valueType: steelWorkbookColumnValueTypeSchema.default('text'),
  editable: z.boolean().default(false),
  widthPx: z.number().int().positive().optional(),
});

export type SteelWorkbookColumn = z.infer<typeof steelWorkbookColumnSchema>;

export const steelWorkbookRowSchema = z.object({
  id: z.string().min(1),
  cells: z.record(steelWorkbookCellValueSchema).default({}),
});

export type SteelWorkbookRow = z.infer<typeof steelWorkbookRowSchema>;

export const steelWorkbookSheetSchema = z.object({
  id: steelWorkbookSheetIdSchema,
  label: z.string().min(1),
  columns: z.array(steelWorkbookColumnSchema).min(1),
  rows: z.array(steelWorkbookRowSchema),
});

export type SteelWorkbookSheet = z.infer<typeof steelWorkbookSheetSchema>;

export const steelWorkbookSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    sheets: z.array(steelWorkbookSheetSchema),
  })
  .superRefine((workbook, ctx) => {
    const present = new Set(workbook.sheets.map((sheet) => sheet.id));
    for (const sheetId of requiredSteelWorkbookSheetIds) {
      if (!present.has(sheetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Steel workbook is missing required sheet: ${sheetId}`,
          path: ['sheets'],
        });
      }
    }
  });

export type SteelWorkbook = z.infer<typeof steelWorkbookSchema>;

export const steelWorkbookPatchOperationSchema = z.object({
  op: z.literal('set_cell'),
  sheetId: steelWorkbookSheetIdSchema,
  rowId: z.string().min(1),
  columnKey: z.string().min(1),
  value: steelWorkbookCellValueSchema,
  reason: z.string().min(1).optional(),
});

export type SteelWorkbookPatchOperation = z.infer<typeof steelWorkbookPatchOperationSchema>;

export const steelWorkbookPatchRequestSchema = z.object({
  workbookVersion: z.number().int().positive(),
  selectedWorkbookRefs: z.array(steelSelectedWorkbookRefSchema).default([]),
  operations: z.array(steelWorkbookPatchOperationSchema).min(1),
});

export type SteelWorkbookPatchRequest = z.infer<typeof steelWorkbookPatchRequestSchema>;

export const steelWorkbookInternalPatchRequestSchema = steelWorkbookPatchRequestSchema.extend({
  workbookId: z.string().min(1),
});

export type SteelWorkbookInternalPatchRequest = z.infer<
  typeof steelWorkbookInternalPatchRequestSchema
>;

export const steelWorkbookCreateRequestSchema = z.object({
  conversationMetaId: z.string().min(1).optional(),
});

export type SteelWorkbookCreateRequest = z.infer<typeof steelWorkbookCreateRequestSchema>;

export const steelWorkbookExportRequestSchema = z.object({
  workbookVersion: z.number().int().positive(),
  sheetIds: z
    .array(steelWorkbookSheetIdSchema)
    .min(1)
    .default(() => [...requiredSteelWorkbookSheetIds]),
});

export type SteelWorkbookExportRequest = z.infer<typeof steelWorkbookExportRequestSchema>;

export const steelWorkbookReadResponseSchema = z.object({
  workbook: steelWorkbookSchema,
});

export type SteelWorkbookReadResponse = z.infer<typeof steelWorkbookReadResponseSchema>;

export const steelWorkbookConversationReadResponseSchema = z.object({
  workbook: steelWorkbookSchema.nullable(),
});

export type SteelWorkbookConversationReadResponse = z.infer<
  typeof steelWorkbookConversationReadResponseSchema
>;

export const steelWorkbookPatchResponseSchema = z.object({
  workbook: steelWorkbookSchema.optional(),
  changedPaths: z.array(steelChangedPathSchema).default([]),
  changedFieldSummary: z.array(steelChangedFieldSummarySchema).default([]),
  rejectedReason: z.string().optional(),
});

export type SteelWorkbookPatchResponse = z.infer<typeof steelWorkbookPatchResponseSchema>;
