import { z } from 'zod';
import type { SteelReviewRow } from './review';
import { steelCalculationCandidateEvidenceSchema } from './calculation';

export const steelCatalogSearchFieldSchema = z.enum(['model', 'description']);
export type SteelCatalogSearchField = z.infer<typeof steelCatalogSearchFieldSchema>;

export const steelCatalogPriceTierSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);
export type SteelCatalogPriceTier = z.infer<typeof steelCatalogPriceTierSchema>;

export const steelCatalogCustomerEvidenceSchema = z.object({
  snapshotId: z.string().min(1),
  revision: z.string().min(1),
  tier: steelCatalogPriceTierSchema,
}).strict();
export type SteelCatalogCustomerEvidence = z.infer<typeof steelCatalogCustomerEvidenceSchema>;

const nullableDecimalString = z.string().min(1).nullable();

export const steelCatalogCandidateSchema = z.object({
  id: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  erpItemCode: z.string().min(1),
  productName: z.string().nullable(),
  specKey: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().nullable(),
  formulaCode: z.string().nullable(),
  material: z.string().nullable(),
  unit: z.string().nullable(),
  costBasis: z.string().min(1),
  valueState: z.string().min(1),
  unitWeightValue: nullableDecimalString,
  unitWeightBasis: z.string().nullable(),
  density: nullableDecimalString,
  thicknessMinMm: nullableDecimalString,
  thicknessMaxMm: nullableDecimalString,
  widthMm: nullableDecimalString,
  heightMm: nullableDecimalString,
  lengthMm: nullableDecimalString,
  outerDiameterMm: nullableDecimalString,
  webMm: nullableDecimalString,
  flangeMm: nullableDecimalString,
  lipMm: nullableDecimalString,
  sheetWidthMm: nullableDecimalString,
  sheetLengthMm: nullableDecimalString,
  unitPrice: nullableDecimalString,
  calculation: steelCalculationCandidateEvidenceSchema,
  label: z.string().min(1),
}).strict();
export type SteelCatalogCandidate = z.infer<typeof steelCatalogCandidateSchema>;

export const steelCatalogPageSchema = z.object({
  options: z.array(steelCatalogCandidateSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  complete: z.boolean(),
  customer: steelCatalogCustomerEvidenceSchema,
}).strict();
export type SteelCatalogPage = z.infer<typeof steelCatalogPageSchema>;

export const steelCatalogQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
  outputId: z.string().trim().min(1).max(300),
  revision: z.string().trim().min(1).max(300),
  rowId: z.string().trim().min(1).max(300),
  kind: z.enum(['material', 'processing']).optional(),
  parentRowId: z.string().trim().min(1).max(300).optional(),
  materialCategory: z.string().max(300).optional(),
  materialThicknessMm: z.string().max(300).optional(),
  field: steelCatalogSearchFieldSchema,
  keyword: z.string().max(300).default(''),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict().superRefine((query, context) => {
  if (query.kind === 'processing' && (!query.parentRowId || query.materialCategory === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Processing queries require a material scope' });
  }
  if (query.kind !== 'processing' && (query.parentRowId !== undefined || query.materialCategory !== undefined || query.materialThicknessMm !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Only processing queries use a material scope' });
  }
});
export type SteelCatalogQuery = z.infer<typeof steelCatalogQuerySchema>;

export const steelCatalogSelectionSchema = z.object({
  id: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  evidence: steelCatalogCustomerEvidenceSchema,
}).strict();
export type SteelCatalogSelection = z.infer<typeof steelCatalogSelectionSchema>;

export const steelCatalogSelectionEvidenceSchema = z.object({
  rowId: z.string().min(1),
  candidateId: z.string().min(1),
  candidateRevision: z.string().regex(/^[a-f0-9]{64}$/),
  customerSnapshotId: z.string().min(1),
  customerRevision: z.string().min(1),
  customerTier: steelCatalogPriceTierSchema,
  unitPrice: nullableDecimalString,
}).strict();
export type SteelCatalogSelectionEvidence = z.infer<typeof steelCatalogSelectionEvidenceSchema>;

export function steelCatalogDescription(candidate: Pick<SteelCatalogCandidate, 'productName' | 'specKey'>): string {
  return candidate.productName?.trim() ?? '';
}

export function steelCatalogOptionLabel(candidate: Pick<SteelCatalogCandidate, 'erpItemCode' | 'productName' | 'specKey'>): string {
  const description = steelCatalogDescription(candidate);
  return `${candidate.erpItemCode} ${description}`.trim();
}

function exactDimension(minimum: string | null, maximum: string | null): string {
  return minimum !== null && minimum === maximum ? minimum : '';
}

export const steelMaterialCandidateHeaders = [
  '型號', '品名規格', '類別', '材質編號', '單位', '計價基準', '公式編號',
  '厚度', '單價',
] as const;

function candidateFields(
  row: SteelReviewRow,
  candidate: SteelCatalogCandidate,
  headers: readonly string[],
  tier: SteelCatalogPriceTier,
): { values: SteelReviewRow['values']; changedHeaders: string[] } {
  const values = { ...row.values };
  const candidateValues: Record<string, string> = {
    型號: candidate.erpItemCode,
    品名規格: steelCatalogDescription(candidate),
    類別: candidate.category,
    材質編號: candidate.material ?? '',
    單位: candidate.unit ?? '',
    計價基準: String(tier.charCodeAt(0) - 64),
    公式編號: candidate.formulaCode ?? '',
    厚度: exactDimension(candidate.thicknessMinMm, candidate.thicknessMaxMm),
    單價: candidate.unitPrice ?? '',
  };
  const changedHeaders = Object.keys(candidateValues).filter((header) => headers.includes(header));
  for (const header of changedHeaders) {
    values[header] = {
      ...(values[header] ?? { baseline: null, effective: null }),
      effective: candidateValues[header] ?? '',
    };
  }
  return { values, changedHeaders };
}

/** Apply one trusted catalog candidate to one material row without touching its siblings. */
export function applyMaterialCandidate(
  row: SteelReviewRow,
  candidate: SteelCatalogCandidate,
  headers: readonly string[],
  tier: SteelCatalogPriceTier,
): SteelReviewRow {
  const { values, changedHeaders } = candidateFields(row, candidate, headers, tier);
  const fields = { ...(row.calculation?.fields ?? {}) };
  for (const header of changedHeaders) {
    fields[header] = { kind: 'candidate', candidateCode: candidate.erpItemCode, ruleVersion: candidate.calculation.ruleVersion };
  }
  return {
    ...row,
    values,
    calculation: {
      ...(row.calculation ?? {}),
      candidate: candidate.calculation,
      fields,
    },
  };
}

export const steelProcessingCandidateHeaders = steelMaterialCandidateHeaders;

/** Replace an explicit processing candidate while retaining its material and measurement inputs. */
export function applyProcessingCandidate(
  row: SteelReviewRow,
  candidate: SteelCatalogCandidate,
  headers: readonly string[],
  tier: SteelCatalogPriceTier,
  _parent: SteelReviewRow,
): SteelReviewRow {
  return applyMaterialCandidate(row, candidate, headers, tier);
}
