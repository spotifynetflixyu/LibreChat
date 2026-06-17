import { z } from 'zod';

export const defaultSteelPriceCustomerTierId = 2;

const nonEmptyString = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100).optional();
const reviewStateSchema = z.enum(['draft', 'needs_review', 'reviewed', 'rejected']).optional();
const keywordsSchema = z.array(nonEmptyString).min(1).max(20);

function normalizeCatalogFilterText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[＊*×]/g, 'x')
    .trim();
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
  candidateQueries?: string[];
}): string[] {
  const values = [input.originalText, ...(input.candidateQueries ?? [])].filter(
    (value): value is string => value !== undefined,
  );

  return uniqueNonEmptyStrings(
    values.map(getExpectedCTypeCompactSpec).filter((value): value is string => value !== undefined),
  );
}

function hasCTypeCompactSpecFragment(
  input: {
    candidateQueries?: string[];
  },
  expectedSpec: string,
): boolean {
  const expected = normalizeCatalogFilterText(expectedSpec);
  const specValues = input.candidateQueries ?? [];

  return specValues.some((value) => normalizeCatalogFilterText(value).includes(expected));
}

function hasPlateSearchSignal(value: string): boolean {
  return /(?:\bPL\s*\d|板|黑鐵|黑板|OT板)/iu.test(value);
}

function hasSquareCutPlateProductName(input: {
  originalText?: string;
  candidateQueries?: string[];
}): boolean {
  const candidateQueries = input.candidateQueries ?? [];
  const contextText = [input.originalText, ...candidateQueries]
    .filter((value): value is string => value !== undefined)
    .join(' ');

  return candidateQueries.some(
    (candidateQuery) => candidateQuery.includes('四方切') && hasPlateSearchSignal(contextText),
  );
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[＊*×]/g, 'x')
    .trim();
}

const instructionCatalogContextSchema = z.object({
  lineRefs: z.array(nonEmptyString).min(1).max(20).optional(),
  packetGroupHints: z.array(nonEmptyString).min(1).max(20).optional(),
  catalogCandidates: z.array(nonEmptyString).min(1).max(20).optional(),
  productNameCandidates: z.array(nonEmptyString).min(1).max(20).optional(),
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

const legacyLookupQuoteRulesSchema = lookupInstructionsSchema.extend({
  customerContext: z
    .object({
      customerId: z.number().int().positive().optional(),
      customerTierId: z.number().int().positive().optional(),
      customerName: nonEmptyString.optional(),
      tierKnown: z.boolean().optional(),
    })
    .optional(),
});

const lookupQuoteRulesSchema = z
  .object({
    keywords: keywordsSchema.describe(
      'AI-selected Steel rule lookup keywords. Use product names, material words, processing terms, customer/rule hints, formula codes, or quote-context fragments as separate strings.',
    ),
    limit: limitSchema,
  })
  .strict();

const lookupDefaultsSchema = z.object({
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
});

const searchPriceCandidatesSchema = z
  .object({
    candidateQueries: z
      .array(nonEmptyString, { required_error: 'Provide candidateQueries' })
      .min(1)
      .max(20)
      .describe(
        'Required AI-selected price lookup keywords. Put each product name, spec fragment, ERP item code, code prefix, or prior-table code + product-name spec_key-like anchor in its own string; backend applies contains-style spec_key lookup without unit/category/review/active filters.',
      ),
    customerTierId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Known Steel customer tier id from customer lookup or conversation context. If omitted, price lookup defaults to B tier.',
      ),
    limit: limitSchema,
  })
  .strict();

const runFileOcrSchema = z
  .object({
    filename: nonEmptyString.optional(),
    fileIndex: z.number().int().min(0).optional(),
    output_mode: z.enum(['markdown', 'detailed', 'json']).optional(),
    dpi: z.number().int().min(150).max(600).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.filename !== undefined || input.fileIndex !== undefined) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide filename or fileIndex',
    });
  });

const runVisualInspectionSchema = z
  .object({
    filename: nonEmptyString.optional(),
    fileIndex: z.number().int().min(0).optional(),
    page: z.number().int().min(1).optional(),
    imageIndex: z.number().int().min(1).optional(),
    inspection_types: z
      .array(
        z.enum([
          'holes',
          'slots',
          'continuous_edges',
          'bends',
          'cut_corners',
          'notches',
          'geometry_consistency',
        ]),
      )
      .min(1)
      .max(10),
    prompt: nonEmptyString,
    dpi: z.number().int().min(150).max(600).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.filename !== undefined || input.fileIndex !== undefined) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide filename or fileIndex',
    });
  });

export const steelToolArgsSchemas = {
  lookup_quote_rules: lookupQuoteRulesSchema,
  search_customers: z.object({
    keywords: keywordsSchema,
    limit: limitSchema,
  }),
  search_price_candidates: searchPriceCandidatesSchema,
  run_file_ocr: runFileOcrSchema,
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
export type SteelBusinessToolName = SteelToolName;
export type LookupDefaultsInput = z.infer<typeof lookupDefaultsSchema>;
export type LookupInstructionsInput = z.infer<typeof lookupInstructionsSchema>;
export type LookupQuoteRulesInput = z.infer<typeof legacyLookupQuoteRulesSchema>;
export type LookupQuoteRulesToolInput = z.infer<typeof lookupQuoteRulesSchema>;
export type RunFileOcrInput = z.infer<typeof runFileOcrSchema>;
export type RunVisualInspectionInput = z.infer<typeof runVisualInspectionSchema>;
