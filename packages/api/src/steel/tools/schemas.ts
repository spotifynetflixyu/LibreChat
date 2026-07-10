import { z } from 'zod';
import {
  defaultPriceTierCode,
  priceLookupMaterialKinds,
  priceCategories,
  priceTierCodes,
} from '../pricing/enums';
import { isPriceSubcategory } from '../pricing/categories';

export const defaultSteelPriceCustomerTier: (typeof priceTierCodes)[number] = defaultPriceTierCode;

const nonEmptyString = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100).optional();
const priceQueryLimitSchema = z
  .number()
  .int()
  .positive()
  .transform((limit) => Math.min(limit, 100))
  .optional();
const optionalFilterString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  nonEmptyString.optional(),
);
const reviewStateSchema = z.enum(['draft', 'needs_review', 'reviewed', 'rejected']).optional();
const keywordsSchema = z.array(nonEmptyString).min(1).max(20);

interface InstructionCatalogContextInput {
  lineRefs?: string[];
  packetGroupHints?: string[];
  catalogCandidates?: string[];
  productNameCandidates?: string[];
  surfaceCandidates?: string[];
  formulaCandidates?: string[];
  processingTypes?: string[];
  lowConfidenceReasons?: string[];
}

interface LookupCustomerContextInput {
  customerId?: number;
  customerTier?: (typeof priceTierCodes)[number];
  customerName?: string;
  tierKnown?: boolean;
}

type ReviewStateInput = 'draft' | 'needs_review' | 'reviewed' | 'rejected';

export interface LookupDefaultsInput {
  catalogContexts: InstructionCatalogContextInput[];
  customerContext?: LookupCustomerContextInput;
  reviewState?: ReviewStateInput;
  includeInactive?: boolean;
  limit?: number;
}

export interface LookupInstructionsInput {
  taskTypes: string[];
  packetGroupHints?: string[];
  evidenceSummary: string;
  catalogContexts: InstructionCatalogContextInput[];
  customerContext?: Pick<LookupCustomerContextInput, 'customerName' | 'tierKnown'>;
  reviewState?: ReviewStateInput;
  includeInactive?: boolean;
  limit?: number;
}

export interface LookupQuoteRulesInput extends Omit<LookupInstructionsInput, 'customerContext'> {
  customerContext?: LookupCustomerContextInput;
}

interface SteelPriceLookupQueryInput {
  queryId: string;
  mode?: 'lookup';
  category: (typeof priceCategories)[number];
  subcategory?: string;
  material?: (typeof priceLookupMaterialKinds)[number];
  thicknessMm?: string[];
  erpItemCode?: string;
  keyword?: string;
  limit?: number;
}

interface SteelPriceCategoryDiscoveryQueryInput {
  queryId: string;
  mode: 'category_discovery';
  keyword: string;
  limit?: number;
}

type SearchPriceCandidateQueryInput =
  | SteelPriceLookupQueryInput
  | SteelPriceCategoryDiscoveryQueryInput;

interface SearchPriceCandidatesInput {
  queries: SearchPriceCandidateQueryInput[];
}

interface SearchCustomersInput {
  keywords: string[];
  limit?: number;
}

export interface ReadMarkdownInput {
  scope: 'workbook' | 'ocr';
  ocrFileKey?: string;
  fileKey?: string;
  reason?: string;
}

export interface RunVisualInspectionInput {
  filename?: string;
  fileIndex?: number;
  page?: number;
  imageIndex?: number;
  inspection_types: Array<
    | 'holes'
    | 'slots'
    | 'continuous_edges'
    | 'bends'
    | 'cut_corners'
    | 'notches'
    | 'geometry_consistency'
  >;
  prompt: string;
  dpi?: number;
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
      customerTier: z.enum(priceTierCodes).optional(),
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
      customerTier: z.enum(priceTierCodes).optional(),
      customerName: nonEmptyString.optional(),
      tierKnown: z.boolean().optional(),
    })
    .optional(),
  reviewState: reviewStateSchema,
  includeInactive: z.boolean().optional(),
  limit: limitSchema,
});

const priceLookupQuerySchema = z
  .object({
    queryId: nonEmptyString.optional(),
    mode: z.literal('lookup').optional(),
    category: z
      .enum(priceCategories)
      .describe(
        'Required price category enum value. If the category is unknown, call category_discovery mode first instead of guessing.',
      ),
    subcategory: optionalFilterString.describe(
      'Optional subcategory enum for the selected category. Empty means no subcategory filter.',
    ),
    material: z
      .enum(priceLookupMaterialKinds)
      .optional()
      .describe(
        'Optional contains-match material family. Use one of 黑鐵, 白鐵, 鋁, 錏, 鋅, 鎢, or 塑膠.',
      ),
    thicknessMm: z.array(nonEmptyString).min(1).max(20).optional(),
    erpItemCode: nonEmptyString.optional(),
    keyword: nonEmptyString.optional(),
    limit: priceQueryLimitSchema,
  })
  .strict()
  .superRefine((query, ctx) => {
    if (!query.subcategory || isPriceSubcategory(query.category, query.subcategory)) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid subcategory ${query.subcategory} for category ${query.category}`,
      path: ['subcategory'],
    });
  });

const priceCategoryDiscoveryQuerySchema = z
  .object({
    queryId: nonEmptyString.optional(),
    mode: z.literal('category_discovery'),
    keyword: nonEmptyString.describe('Required keyword used to discover candidate categories.'),
    limit: priceQueryLimitSchema,
  })
  .strict();

const searchPriceCandidateQuerySchema = z.union([
  priceCategoryDiscoveryQuerySchema,
  priceLookupQuerySchema,
]);

const searchPriceCandidatesSchema: z.ZodType<SearchPriceCandidatesInput, z.ZodTypeDef, unknown> = z
  .object({
    queries: z
      .array(searchPriceCandidateQuerySchema, { required_error: 'Provide queries' })
      .min(1)
      .max(20),
  })
  .strict()
  .transform(
    (input): SearchPriceCandidatesInput => ({
      queries: input.queries.map((query, index) => ({
        ...query,
        queryId: query.queryId ?? `q${index + 1}`,
      })) as SearchPriceCandidateQueryInput[],
    }),
  );

const readMarkdownSchema: z.ZodType<ReadMarkdownInput> = z
  .object({
    scope: z.enum(['workbook', 'ocr']),
    ocrFileKey: nonEmptyString.optional(),
    fileKey: nonEmptyString.optional(),
    reason: nonEmptyString.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ocrFileKey && value.fileKey && value.ocrFileKey !== value.fileKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ocrFileKey and fileKey must match when both are provided',
        path: ['fileKey'],
      });
    }
  });

const runVisualInspectionSchema: z.ZodType<RunVisualInspectionInput> = z
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

const searchCustomersSchema: z.ZodType<SearchCustomersInput> = z.object({
  keywords: keywordsSchema,
  limit: limitSchema,
});

export const steelToolArgsSchemas: {
  readonly search_customers: z.ZodType<SearchCustomersInput>;
  readonly search_price_candidates: z.ZodType<SearchPriceCandidatesInput, z.ZodTypeDef, unknown>;
  readonly read_markdown: z.ZodType<ReadMarkdownInput>;
} = {
  search_customers: searchCustomersSchema,
  search_price_candidates: searchPriceCandidatesSchema,
  read_markdown: readMarkdownSchema,
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
export type SteelBusinessToolName = SteelToolName;
