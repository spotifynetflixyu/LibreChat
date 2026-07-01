import { z } from 'zod';
import {
  defaultPriceTierCode,
  priceLookupMaterialKinds,
  priceCategories,
  priceTierCodes,
} from '../pricing/enums';

export const defaultSteelPriceCustomerTier: (typeof priceTierCodes)[number] = defaultPriceTierCode;

const nonEmptyString = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100).optional();
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

export interface LookupQuoteRulesInput
  extends Omit<LookupInstructionsInput, 'customerContext'> {
  customerContext?: LookupCustomerContextInput;
}

interface SteelPriceLookupQueryInput {
  mode?: 'lookup';
  category: (typeof priceCategories)[number];
  material?: (typeof priceLookupMaterialKinds)[number];
  thicknessMm?: string[];
  keyword?: string;
  limit?: number;
}

interface SteelPriceCategoryDiscoveryQueryInput {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSearchPriceCandidateQueryInput(value: unknown): unknown {
  if (!isRecord(value) || value.category !== '孔') {
    return value;
  }

  return {
    category: '孔',
    keyword: '鐵板',
  };
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
    mode: z.literal('lookup').optional(),
    category: z
      .enum(priceCategories)
      .describe(
        'Required price category enum value. If the category is unknown, call category_discovery mode first instead of guessing.',
      ),
    material: z
      .enum(priceLookupMaterialKinds)
      .optional()
      .describe('Optional material keyword enum value. Use one of 黑鐵, 白鐵, 錏, 鋁, or 鋅.'),
    thicknessMm: z.array(nonEmptyString).min(1).max(20).optional(),
    keyword: nonEmptyString.optional(),
    limit: limitSchema,
  })
  .strict();

const priceCategoryDiscoveryQuerySchema = z
  .object({
    mode: z.literal('category_discovery'),
    keyword: nonEmptyString.describe('Required keyword used to discover candidate categories.'),
    limit: limitSchema,
  })
  .strict();

const searchPriceCandidateQuerySchema: z.ZodType<
  SearchPriceCandidateQueryInput,
  z.ZodTypeDef,
  unknown
> = z.preprocess(
  normalizeSearchPriceCandidateQueryInput,
  z.union([priceCategoryDiscoveryQuerySchema, priceLookupQuerySchema]),
);

const searchPriceCandidatesSchema: z.ZodType<
  SearchPriceCandidatesInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    queries: z.array(searchPriceCandidateQuerySchema, { required_error: 'Provide queries' }).min(1).max(20),
  })
  .strict();

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
