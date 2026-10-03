import { z } from 'zod';

export const steelReviewKinds = ['ocr_result', 'system_order'] as const;
export type SteelReviewKind = (typeof steelReviewKinds)[number];

export function getSteelReviewTableId(kind: SteelReviewKind, markdownIndex: number): string {
  return `${kind}:${markdownIndex}`;
}

export const steelReviewReadQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  tableId: z.string().trim().min(1).max(300),
  partIndex: z.coerce.number().int().nonnegative().max(10_000).optional(),
});
export type SteelReviewReadQuery = z.infer<typeof steelReviewReadQuerySchema>;

export const steelReviewReceiptQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  tableId: z.string().trim().min(1).max(300),
  outputId: z.string().trim().min(1).max(300),
  operationId: z.string().trim().min(1).max(300),
  digest: z.string().length(64),
});
export type SteelReviewReceiptQuery = z.infer<typeof steelReviewReceiptQuerySchema>;

export const steelReviewSourceSchema = z.object({
  fileId: z.string().min(1),
  pageNumber: z.number().int().positive().nullable(),
  filename: z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
});

export const steelReviewCellSchema = z.object({
  baseline: z.string().nullable(),
  effective: z.string().nullable(),
});

export const steelReviewRowSchema = z.object({
  rowId: z.string().min(1),
  values: z.record(z.string(), steelReviewCellSchema),
  source: steelReviewSourceSchema.nullable(),
});

export const steelReviewTargetSchema = z.object({
  partIndex: z.number().int().nonnegative().optional(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  sha256: z.string().length(64),
});

export const steelReviewCaptionSchema = z.object({
  kind: z.enum(steelReviewKinds),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
});

/**
 * The immutable result captured by one successful human save.  This is kept
 * on the receipt rather than read back from the current sidecar so a retry of
 * an older operation cannot accidentally return a later revision.
 */
export const steelReviewSavedSnapshotSchema = z.object({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  outputId: z.string().min(1),
  revision: z.string().min(1),
  headers: z.array(z.string()),
  rows: z.array(steelReviewRowSchema),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
  savedAt: z.string().datetime(),
  messageSha256: z.string().length(64),
  effectiveMarkdown: z.string(),
  displayMarkdown: z.string(),
});

export const steelReviewReceiptSchema = z.object({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  revision: z.string().min(1),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
  savedAt: z.string().datetime(),
  snapshot: steelReviewSavedSnapshotSchema.optional(),
});

export const steelReviewTableSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  tableId: z.string().min(1),
  partIndex: z.number().int().nonnegative().optional(),
  outputId: z.string().min(1),
  kind: z.enum(steelReviewKinds),
  revision: z.string().min(1),
  latestOutputId: z.string().min(1),
  isLatest: z.boolean(),
  readOnly: z.boolean(),
  humanSavedAt: z.string().datetime().optional(),
  updated: z.boolean().optional(),
  previousVersion: z.boolean().optional(),
  aiRawMarkdown: z.string().optional(),
  aiBaselineMarkdown: z.string().optional(),
  humanMarkdown: z.string().optional(),
  effectiveMarkdown: z.string().optional(),
  displayMarkdown: z.string().optional(),
  lastSave: steelReviewReceiptSchema.optional(),
  headers: z.array(z.string()),
  rows: z.array(steelReviewRowSchema),
});

export const steelReviewPrepareSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  tableId: z.string().min(1),
  partIndex: z.number().int().nonnegative().optional(),
  kind: z.enum(steelReviewKinds),
  outputId: z.string().min(1),
  revision: z.string().min(1),
  rows: z.array(steelReviewRowSchema),
});

export const steelReviewPreparedSchema = steelReviewPrepareSchema.extend({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  messageSha256: z.string().length(64),
  target: steelReviewTargetSchema,
  replacementText: z.string(),
  cleanReplacementText: z.string(),
  targetText: z.string(),
  headers: z.array(z.string()),
  effectiveMarkdown: z.string(),
  displayMarkdown: z.string(),
  aiBaselineMarkdown: z.string().optional(),
  aiRawMarkdown: z.string().optional(),
  caption: steelReviewCaptionSchema,
});

export const steelReviewCommitSchema = steelReviewPreparedSchema;

export const steelReviewSaveResponseSchema = steelReviewPreparedSchema.extend({
  savedAt: z.string().datetime(),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
});

export const steelReviewResponseSchema = z.object({
  table: steelReviewTableSchema.nullable(),
});

export const steelReviewReceiptStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('absent') }),
  z.object({ status: z.literal('committed'), snapshot: steelReviewSavedSnapshotSchema }),
]);

export const steelReviewSourceFileSchema = z.object({
  fileId: z.string().min(1),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative().optional(),
});

export const steelReviewSourcesResponseSchema = z.object({
  sources: z.array(steelReviewSourceFileSchema),
});

export const steelReviewSourceQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  tableId: z.string().trim().min(1).max(300).optional(),
});

export const steelReviewSourceBinaryQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
});

export type SteelReviewSource = z.infer<typeof steelReviewSourceSchema>;
export type SteelReviewCell = z.infer<typeof steelReviewCellSchema>;
export type SteelReviewRow = z.infer<typeof steelReviewRowSchema>;
export type SteelReviewTable = z.infer<typeof steelReviewTableSchema>;
export type SteelReviewResponse = z.infer<typeof steelReviewResponseSchema>;
export type SteelReviewReceiptStatus = z.infer<typeof steelReviewReceiptStatusSchema>;
export type SteelReviewTarget = z.infer<typeof steelReviewTargetSchema>;
export type SteelReviewCaption = z.infer<typeof steelReviewCaptionSchema>;
export type SteelReviewSavedSnapshot = z.infer<typeof steelReviewSavedSnapshotSchema>;
export type SteelReviewReceipt = z.infer<typeof steelReviewReceiptSchema>;
export type SteelReviewPrepare = z.infer<typeof steelReviewPrepareSchema>;
export type SteelReviewPrepared = z.infer<typeof steelReviewPreparedSchema>;
export type SteelReviewCommit = z.infer<typeof steelReviewCommitSchema>;
export type SteelReviewSaveResponse = z.infer<typeof steelReviewSaveResponseSchema>;
export type SteelReviewSourceFile = z.infer<typeof steelReviewSourceFileSchema>;
export type SteelReviewSourcesResponse = z.infer<typeof steelReviewSourcesResponseSchema>;
export type SteelReviewSourceQuery = z.infer<typeof steelReviewSourceQuerySchema>;
export type SteelReviewSourceBinaryQuery = z.infer<typeof steelReviewSourceBinaryQuerySchema>;
