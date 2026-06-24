import { z } from 'zod';

const confidenceSchema = z.enum(['high', 'medium', 'low']);
const nonEmptyString = z.string().trim().min(1);

export interface SteelPriceSearchCandidate {
  queryId: string;
  label?: string;
  productNames?: string[];
  erpItemCodes?: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  sourceCandidateId?: string;
}

interface SteelPriceStructuredFilters {
  categories?: string[];
  surfaces?: string[];
  sizeAMm?: number;
  sizeBMm?: number;
  thicknessMm?: number;
  lengthM?: number;
}

export const steelPriceSearchCandidateSchema: z.ZodType<SteelPriceSearchCandidate> = z
  .object({
    queryId: nonEmptyString,
    label: nonEmptyString.optional(),
    productNames: z
      .array(nonEmptyString)
      .min(1)
      .max(10)
      .describe(
        'Product-price product-name/spec text candidates. The price lookup backend normalizes these values to spec_key format before matching steel.price_items.spec_key.',
      )
      .optional(),
    erpItemCodes: z
      .array(nonEmptyString)
      .min(1)
      .max(10)
      .describe(
        'ERP item codes or code prefixes. The price lookup backend normalizes these values to spec_key format before matching steel.price_items.spec_key.',
      )
      .optional(),
    confidence: confidenceSchema,
    reason: nonEmptyString,
    sourceCandidateId: nonEmptyString.optional(),
  })
  .refine(
    (candidate) => candidate.productNames !== undefined || candidate.erpItemCodes !== undefined,
    {
      message: 'Provide productNames or erpItemCodes',
    },
  );

type SteelPriceSearchCandidateInput = z.input<typeof steelPriceSearchCandidateSchema>;

interface SteelPriceSearchQueryText {
  productNames?: string[];
  erpItemCodes?: string[];
}

const steelPriceStructuredFiltersSchema: z.ZodType<SteelPriceStructuredFilters> = z.object({
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
  const queryTexts = [...(candidate.productNames ?? []), ...(candidate.erpItemCodes ?? [])];

  return queryTexts.some((queryText) => normalizeComparableText(queryText) === normalizedOriginal);
}

function formatPlateThicknessMm(value: string): string {
  return Number(value).toFixed(1);
}

function getOralPlateSpec(value: string): { thicknessMm: string } | undefined {
  const match = value.match(/\bPL\s*(\d+(?:\.\d+)?)\s*[*＊×xX]\s*\d+(?:\.\d+)?\b/u);
  if (!match?.[1]) {
    return undefined;
  }

  return { thicknessMm: formatPlateThicknessMm(match[1]) };
}

function getOtLaserPlateProductNames(thicknessMm: string): string[] {
  return [`${thicknessMm}m/mOT板雷射切割`, 'OT板雷射切割', '黑鐵板 雷射切割'];
}

function getOralPlateSpecCandidateValues(candidate: SteelPriceSearchCandidateInput): string[] {
  return [candidate.label, ...(candidate.productNames ?? [])].filter(
    (value): value is string => value !== undefined,
  );
}

function getDerivedOralPlateCandidates(
  input: SteelPriceSearchTermsRawInput,
): SteelPriceSearchCandidateInput[] {
  return input.candidates.flatMap((candidate) => {
    const spec = [input.originalText, ...getOralPlateSpecCandidateValues(candidate)]
      .map(getOralPlateSpec)
      .find((entry) => entry !== undefined);
    if (!spec) {
      return [];
    }

    return [
      {
        queryId: `${candidate.queryId}:ot-laser`,
        label: `${spec.thicknessMm}m/mOT板雷射切割`,
        productNames: getOtLaserPlateProductNames(spec.thicknessMm),
        confidence: 'high',
        reason: 'PL oral plate spec uses OT black iron laser-cut plate price rows.',
        sourceCandidateId: candidate.queryId,
      },
    ];
  });
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
  return (
    input.candidates.some((candidate) => !hasRawUserTextQuery(input.originalText, candidate)) ||
    getDerivedOralPlateCandidates(input).length > 0
  );
}

export interface SteelPriceSearchTermsInput {
  originalText: string;
  candidates: SteelPriceSearchCandidate[];
  structuredFilters?: SteelPriceStructuredFilters;
  maxQueries?: number;
}

export const steelPriceSearchTermsInputSchema: z.ZodType<SteelPriceSearchTermsInput> = z
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

export interface SteelRejectedPriceSearchQuery {
  queryId: string;
  reason: 'raw_user_text_is_not_a_reviewed_candidate';
}

export interface SteelPriceSearchTermsResult {
  originalText: string;
  rawTextSearchAllowed: false;
  candidateQueries: SteelPriceSearchCandidate[];
  rejectedQueries: SteelRejectedPriceSearchQuery[];
  structuredFilters?: SteelPriceStructuredFilters;
}

export function generateSteelPriceSearchTerms(
  input: SteelPriceSearchTermsInput,
): SteelPriceSearchTermsResult {
  const parsed = steelPriceSearchTermsInputSchema.parse(input);
  const maxQueries = parsed.maxQueries ?? 10;
  const derivedCandidates = getDerivedOralPlateCandidates(parsed);
  const candidateQueries = [...derivedCandidates, ...parsed.candidates]
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
