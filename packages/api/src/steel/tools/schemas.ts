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
  productNames?: string[];
  candidateQueries?: Array<{
    label?: string;
    productNames?: string[];
  }>;
}): string[] {
  const values = [
    input.originalText,
    ...(input.productNames ?? []),
    ...(input.candidateQueries ?? []).flatMap((candidate) => [
      candidate.label,
      ...(candidate.productNames ?? []),
    ]),
  ].filter((value): value is string => value !== undefined);

  return uniqueNonEmptyStrings(
    values.map(getExpectedCTypeCompactSpec).filter((value): value is string => value !== undefined),
  );
}

function hasCTypeCompactSpecFragment(
  input: {
    productNames?: string[];
    candidateQueries?: Array<{ productNames?: string[] }>;
  },
  expectedSpec: string,
): boolean {
  const expected = normalizeCatalogFilterText(expectedSpec);
  const specValues = [
    ...(input.productNames ?? []),
    ...(input.candidateQueries ?? []).flatMap((candidate) => candidate.productNames ?? []),
  ];

  return specValues.some((value) => normalizeCatalogFilterText(value).includes(expected));
}

function getPriceSearchProductNames(input: {
  productNames?: string[];
  candidateQueries?: Array<{
    label?: string;
    productNames?: string[];
  }>;
}): string[] {
  return [
    ...(input.productNames ?? []),
    ...(input.candidateQueries ?? []).flatMap((candidate) => candidate.productNames ?? []),
  ];
}

function hasPlateSearchSignal(value: string): boolean {
  return /(?:\bPL\s*\d|板|黑鐵|黑板|OT板)/iu.test(value);
}

function hasSquareCutPlateProductName(input: {
  originalText?: string;
  productNames?: string[];
  candidateQueries?: Array<{
    label?: string;
    productNames?: string[];
  }>;
}): boolean {
  const productNames = getPriceSearchProductNames(input);
  const contextText = [
    input.originalText,
    ...productNames,
    ...(input.candidateQueries ?? []).map((candidate) => candidate.label),
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ');

  return productNames.some(
    (productName) => productName.includes('四方切') && hasPlateSearchSignal(contextText),
  );
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
    productNames: z
      .array(nonEmptyString)
      .min(1)
      .max(10)
      .describe(
        'Multiple product-price product-name text candidates to search in one tool call. Values may be Chinese product names, formal product-name fragments, or specification text as it appears inside product names, for example 錏輕型鋼 or 75*2.3.',
      )
      .optional(),
    erpItemCodes: z
      .array(nonEmptyString)
      .min(1)
      .max(10)
      .describe(
        'ERP item codes or code prefixes to search in one tool call, for example CCG, CCG07523, BNG, or DNB70.',
      )
      .optional(),
    candidateQueries: z
      .array(steelPriceSearchCandidateSchema)
      .max(10)
      .describe(
        'Batch multiple per-candidate product-name/spec text and ERP-code searches in one tool call. Use this instead of calling search_price_candidates once per keyword, material alternative, or line when they share compatible top-level filters.',
      )
      .optional(),
    customerTierId: z.number().int().positive().optional(),
    reviewState: reviewStateSchema,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasDirectFilter =
      input.productNames !== undefined || input.erpItemCodes !== undefined;
    const hasCandidateQueries =
      input.candidateQueries !== undefined && input.candidateQueries.length > 0;

    if (!hasDirectFilter && !hasCandidateQueries) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide productNames, erpItemCodes, or candidateQueries',
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

    if (
      input.originalText !== undefined &&
      input.productNames?.some((productName) =>
        isRawUserTextPriceSearchQuery(input.originalText!, { productNames: [productName] }),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Do not search reviewed prices with raw user text in productNames',
        path: ['productNames'],
      });
    }

    const expectedSpecs = getCTypeExpectedCompactSpecs(input);
    const missingSpecs = expectedSpecs.filter(
      (expectedSpec) => !hasCTypeCompactSpecFragment(input, expectedSpec),
    );
    if (missingSpecs.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `For c_type price search, include productNames spec fragments like ${missingSpecs.join(
          ' or ',
        )} derived from width and thickness; do not only use the full section such as 100x50x20x2.3.`,
      });
    }

    if (hasSquareCutPlateProductName(input)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'For plate price search, use laser-cut plate productNames instead of square-cut productNames.',
        path: ['productNames'],
      });
    }
  });

const runFileOcrSchema = z
  .object({
    filename: nonEmptyString.optional(),
    fileIndex: z.number().int().min(0).optional(),
    page: z.number().int().min(1).optional(),
    imageIndex: z.number().int().min(1).optional(),
    file_type: z.enum(['image', 'pdf']).optional(),
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
  lookup_catalog_families: lookupCatalogFamiliesSchema,
  search_customers: z.object({
    searchText: nonEmptyString,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  }),
  search_price_candidates: searchPriceCandidatesSchema,
  run_file_ocr: runFileOcrSchema,
  run_visual_inspection: runVisualInspectionSchema,
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
export type SteelBusinessToolName = Exclude<
  SteelToolName,
  'run_file_ocr' | 'run_visual_inspection'
>;
export type LookupDefaultsInput = z.infer<typeof lookupDefaultsSchema>;
export type LookupCatalogFamiliesInput = z.infer<typeof lookupCatalogFamiliesSchema>;
export type LookupInstructionsInput = z.infer<typeof lookupInstructionsSchema>;
export type LookupQuoteRulesInput = z.infer<typeof lookupQuoteRulesSchema>;
export type RunFileOcrInput = z.infer<typeof runFileOcrSchema>;
export type RunVisualInspectionInput = z.infer<typeof runVisualInspectionSchema>;
