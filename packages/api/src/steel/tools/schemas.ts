import { z } from 'zod';

import { isRawUserTextPriceSearchQuery, steelPriceSearchCandidateSchema } from '../normalization';

const nonEmptyString = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100).optional();
const reviewStateSchema = z.enum(['draft', 'needs_review', 'reviewed', 'rejected']).optional();

function normalizeCatalogFilterText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[＊*×]/g, 'x')
    .trim();
}

function includesCatalogFamily(input: { catalogFamilies?: string[] }, familyKey: string): boolean {
  return input.catalogFamilies?.some((family) => family.trim() === familyKey) ?? false;
}

function isCTypeFamilyLabelProductName(value: string): boolean {
  const normalized = normalizeCatalogFilterText(value);

  return normalized.includes('c型鋼') || normalized.includes('c鋼');
}

function hasCTypeFamilyLabelProductName(input: {
  productName?: string;
  candidateQueries?: Array<{ productName?: string }>;
}): boolean {
  const productNames = [
    input.productName,
    ...(input.candidateQueries ?? []).map((candidate) => candidate.productName),
  ].filter((value): value is string => value !== undefined);

  return productNames.some(isCTypeFamilyLabelProductName);
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function extractNumbers(value: string): string[] {
  return Array.from(value.matchAll(/\d+(?:\.\d+)?/g), (match) => match[0]);
}

function getExpectedCTypeCompactSpec(value: string): string | undefined {
  const fullSectionPattern =
    /\d+(?:\.\d+)?\s*[xX*＊×]\s*\d+(?:\.\d+)?\s*[xX*＊×]\s*\d+(?:\.\d+)?(?:\s*[xX*＊×]\s*|\s+)\d+(?:\.\d+)?\s*t?/u;
  const match = value.match(fullSectionPattern);
  if (!match?.[0]) {
    return undefined;
  }

  const numbers = extractNumbers(match[0]);
  if (numbers.length < 4) {
    return undefined;
  }

  return `${numbers[0]}x${numbers[3]}`;
}

function getCTypeExpectedCompactSpecs(input: {
  originalText?: string;
  specKey?: string;
  specKeyContains?: string;
  productName?: string;
  candidateQueries?: Array<{
    label?: string;
    productName?: string;
    specKey?: string;
    specKeyContains?: string;
  }>;
}): string[] {
  const values = [
    input.originalText,
    input.specKey,
    input.specKeyContains,
    input.productName,
    ...(input.candidateQueries ?? []).flatMap((candidate) => [
      candidate.label,
      candidate.productName,
      candidate.specKey,
      candidate.specKeyContains,
    ]),
  ].filter((value): value is string => value !== undefined);

  return uniqueNonEmptyStrings(
    values.map(getExpectedCTypeCompactSpec).filter((value): value is string => value !== undefined),
  );
}

function hasCTypeCompactSpecFragment(
  input: {
    specKey?: string;
    specKeyContains?: string;
    candidateQueries?: Array<{ specKey?: string; specKeyContains?: string }>;
  },
  expectedSpec: string,
): boolean {
  const expected = normalizeCatalogFilterText(expectedSpec);
  const specValues = [
    input.specKey,
    input.specKeyContains,
    ...(input.candidateQueries ?? []).flatMap((candidate) => [
      candidate.specKey,
      candidate.specKeyContains,
    ]),
  ].filter((value): value is string => value !== undefined);

  return specValues.some((value) => normalizeCatalogFilterText(value).includes(expected));
}

const instructionCatalogContextSchema = z.object({
  lineRefs: z.array(nonEmptyString).min(1).max(20).optional(),
  packetGroupHints: z.array(nonEmptyString).min(1).max(20).optional(),
  catalogCandidates: z.array(nonEmptyString).min(1).max(20).optional(),
  surfaceCandidates: z.array(nonEmptyString).min(1).max(20).optional(),
  formulaCandidates: z.array(nonEmptyString).min(1).max(20).optional(),
  processingTypes: z.array(nonEmptyString).min(1).max(20).optional(),
  lowConfidenceReasons: z.array(nonEmptyString).min(1).max(20).optional(),
});

const lookupInstructionsSchema = z.object({
  taskTypes: z.array(nonEmptyString).min(1).max(20),
  packetGroupHints: z.array(nonEmptyString).min(1).max(20).optional(),
  evidenceSummary: nonEmptyString,
  catalogContexts: z.array(instructionCatalogContextSchema).min(1).max(20),
  customerContext: z
    .object({
      customerName: nonEmptyString.optional(),
      tierKnown: z.boolean().optional(),
    })
    .optional(),
  reviewState: reviewStateSchema,
  includeInactive: z.boolean().optional(),
  limit: limitSchema,
});

const lookupQuoteRulesSchema = lookupInstructionsSchema.extend({
  customerContext: z
    .object({
      customerId: z.number().int().positive().optional(),
      customerTierId: z.number().int().positive().optional(),
      customerName: nonEmptyString.optional(),
      tierKnown: z.boolean().optional(),
    })
    .optional(),
});

const lookupCatalogFamiliesSchema = z
  .object({
    searchText: nonEmptyString.optional(),
    keys: z.array(nonEmptyString).min(1).max(20).optional(),
    reviewState: reviewStateSchema,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.searchText !== undefined || input.keys !== undefined) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide searchText or keys',
    });
  });

const searchPriceCandidatesSchema = z
  .object({
    originalText: nonEmptyString.optional(),
    specKey: nonEmptyString.optional(),
    specKeyContains: nonEmptyString.optional(),
    productName: nonEmptyString.optional(),
    catalogFamilies: z.array(nonEmptyString).min(1).max(20).optional(),
    candidateQueries: z.array(steelPriceSearchCandidateSchema).max(10).optional(),
    customerTierId: z.number().int().positive().optional(),
    reviewState: reviewStateSchema,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasDirectFilter =
      input.specKey !== undefined ||
      input.specKeyContains !== undefined ||
      input.productName !== undefined ||
      input.catalogFamilies !== undefined;
    const hasCandidateQueries =
      input.candidateQueries !== undefined && input.candidateQueries.length > 0;

    if (!hasDirectFilter && !hasCandidateQueries) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide specKey, specKeyContains, productName, or candidateQueries',
      });
    }

    if (hasCandidateQueries && input.originalText === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide originalText with candidateQueries',
        path: ['originalText'],
      });
    }

    if (
      input.originalText !== undefined &&
      isRawUserTextPriceSearchQuery(input.originalText, input)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Do not search reviewed prices with raw user text',
      });
    }

    if (includesCatalogFamily(input, 'c_type') && hasCTypeFamilyLabelProductName(input)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Do not use C型鋼 as productName after selecting c_type; use catalogFamilies: [c_type] plus specKeyContains such as 100x2.3, or reviewed product names such as 白鐵輕型鋼 / 錏輕型鋼 / 黑鐵輕型鋼.',
      });
    }

    if (includesCatalogFamily(input, 'c_type')) {
      const expectedSpecs = getCTypeExpectedCompactSpecs(input);
      const missingSpecs = expectedSpecs.filter(
        (expectedSpec) => !hasCTypeCompactSpecFragment(input, expectedSpec),
      );
      if (missingSpecs.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `For c_type price search, include specKeyContains like ${missingSpecs.join(
            ' or ',
          )} derived from width and thickness; do not only use the full section such as 100x50x20x2.3.`,
        });
      }
    }
  });

export const steelToolArgsSchemas = {
  lookup_instructions: lookupInstructionsSchema,
  lookup_quote_rules: lookupQuoteRulesSchema,
  lookup_catalog_families: lookupCatalogFamiliesSchema,
  lookup_defaults: z.object({
    catalogContexts: z.array(instructionCatalogContextSchema).min(1).max(20),
    customerContext: z
      .object({
        customerId: z.number().int().positive().optional(),
        customerTierId: z.number().int().positive().optional(),
        customerName: nonEmptyString.optional(),
        tierKnown: z.boolean().optional(),
      })
      .optional(),
    reviewState: reviewStateSchema,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  }),
  lookup_formula: z.object({
    catalogContexts: z.array(instructionCatalogContextSchema).min(1).max(20),
    reviewState: reviewStateSchema,
  }),
  search_customers: z.object({
    searchText: nonEmptyString,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  }),
  search_price_candidates: searchPriceCandidatesSchema,
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
export type LookupDefaultsInput = z.infer<typeof steelToolArgsSchemas.lookup_defaults>;
export type LookupCatalogFamiliesInput = z.infer<typeof lookupCatalogFamiliesSchema>;
export type LookupFormulaInput = z.infer<typeof steelToolArgsSchemas.lookup_formula>;
export type LookupInstructionsInput = z.infer<typeof lookupInstructionsSchema>;
export type LookupQuoteRulesInput = z.infer<typeof lookupQuoteRulesSchema>;
