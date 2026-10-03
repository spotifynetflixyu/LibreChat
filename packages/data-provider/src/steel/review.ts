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
  headers: z.array(z.string()),
  rows: z.array(steelReviewRowSchema),
});

export const steelReviewResponseSchema = z.object({
  table: steelReviewTableSchema.nullable(),
});

export type SteelReviewSource = z.infer<typeof steelReviewSourceSchema>;
export type SteelReviewCell = z.infer<typeof steelReviewCellSchema>;
export type SteelReviewRow = z.infer<typeof steelReviewRowSchema>;
export type SteelReviewTable = z.infer<typeof steelReviewTableSchema>;
export type SteelReviewResponse = z.infer<typeof steelReviewResponseSchema>;
