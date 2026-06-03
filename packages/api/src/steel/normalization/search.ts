import { z } from 'zod';

const confidenceSchema = z.enum(['high', 'medium', 'low']);
const nonEmptyString = z.string().trim().min(1);

export const steelPriceSearchCandidateSchema = z
  .object({
    queryId: nonEmptyString,
    label: nonEmptyString.optional(),
    productName: nonEmptyString.optional(),
    specKey: nonEmptyString.optional(),
    specKeyContains: nonEmptyString.optional(),
    confidence: confidenceSchema,
    reason: nonEmptyString,
    sourceCandidateId: nonEmptyString.optional(),
  })
  .refine(
    (candidate) =>
      candidate.productName !== undefined ||
      candidate.specKey !== undefined ||
      candidate.specKeyContains !== undefined,
    {
      message: 'Provide productName, specKey, or specKeyContains',
    },
  );

type SteelPriceSearchCandidateInput = z.input<typeof steelPriceSearchCandidateSchema>;

interface SteelPriceSearchQueryText {
  productName?: string;
  specKey?: string;
  specKeyContains?: string;
}

const steelPriceStructuredFiltersSchema = z.object({
  categories: z.array(nonEmptyString).max(10).optional(),
  surfaces: z.array(nonEmptyString).max(10).optional(),
  sizeAMm: z.number().positive().optional(),
  sizeBMm: z.number().positive().optional(),
  thicknessMm: z.number().positive().optional(),
  lengthM: z.number().positive().optional(),
});

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[＊*×]/g, 'x')
    .trim();
}

function hasRawUserTextQuery(originalText: string, candidate: SteelPriceSearchQueryText): boolean {
  const normalizedOriginal = normalizeComparableText(originalText);
  const queryTexts = [candidate.productName, candidate.specKey, candidate.specKeyContains].filter(
    (value): value is string => value !== undefined,
  );

  return queryTexts.some((queryText) => normalizeComparableText(queryText) === normalizedOriginal);
}

interface SteelPriceSearchTermsRawInput {
  originalText: string;
  candidates: SteelPriceSearchCandidateInput[];
}

export function isRawUserTextPriceSearchQuery(
  originalText: string,
  candidate: SteelPriceSearchQueryText,
): boolean {
  return hasRawUserTextQuery(originalText, candidate);
}

function hasDerivedCandidate(input: SteelPriceSearchTermsRawInput): boolean {
  return input.candidates.some((candidate) => !hasRawUserTextQuery(input.originalText, candidate));
}

export const steelPriceSearchTermsInputSchema = z
  .object({
    originalText: nonEmptyString,
    candidates: z.array(steelPriceSearchCandidateSchema).max(20),
    structuredFilters: steelPriceStructuredFiltersSchema.optional(),
    maxQueries: z.number().int().min(1).max(10).optional(),
  })
  .superRefine((input, ctx) => {
    if (!hasDerivedCandidate(input)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one derived price search candidate',
        path: ['candidates'],
      });
    }
  });

export type SteelPriceSearchCandidate = z.infer<typeof steelPriceSearchCandidateSchema>;
export type SteelPriceSearchTermsInput = z.input<typeof steelPriceSearchTermsInputSchema>;

export interface SteelRejectedPriceSearchQuery {
  queryId: string;
  reason: 'raw_user_text_is_not_a_reviewed_candidate';
}

export interface SteelPriceSearchTermsResult {
  originalText: string;
  rawTextSearchAllowed: false;
  candidateQueries: SteelPriceSearchCandidate[];
  rejectedQueries: SteelRejectedPriceSearchQuery[];
  structuredFilters?: z.infer<typeof steelPriceStructuredFiltersSchema>;
}

export function generateSteelPriceSearchTerms(
  input: SteelPriceSearchTermsInput,
): SteelPriceSearchTermsResult {
  const parsed = steelPriceSearchTermsInputSchema.parse(input);
  const maxQueries = parsed.maxQueries ?? 10;
  const candidateQueries = parsed.candidates
    .filter((candidate) => !hasRawUserTextQuery(parsed.originalText, candidate))
    .slice(0, maxQueries);
  const rejectedQueries = parsed.candidates
    .filter((candidate) => hasRawUserTextQuery(parsed.originalText, candidate))
    .map((candidate) => ({
      queryId: candidate.queryId,
      reason: 'raw_user_text_is_not_a_reviewed_candidate' as const,
    }));

  return {
    originalText: parsed.originalText,
    rawTextSearchAllowed: false,
    candidateQueries,
    rejectedQueries,
    ...(parsed.structuredFilters ? { structuredFilters: parsed.structuredFilters } : {}),
  };
}
