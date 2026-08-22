import { z } from 'zod';

import type { ProcessingPriceCategory } from '../pricing/processing-candidates';

import {
  defaultPriceTierCode,
  priceCategories,
  priceLookupMaterialKinds,
  priceTierCodes,
} from '../pricing/enums';
import { processingPriceCategories } from '../pricing/processing-candidates';
import { isPriceSubcategory } from '../pricing/categories';

export const defaultSteelPriceCustomerTier: (typeof priceTierCodes)[number] = defaultPriceTierCode;

const nonEmptyString = z.string().trim().min(1);
const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/u)
  .refine((value) => Number(value) > 0, 'Thickness must be greater than zero');
const limitSchema = z.number().int().min(1).max(100).optional();
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
  categories: (typeof priceCategories)[number][];
  subcategory?: string;
  material?: string;
  unit?: string;
  thicknessMm?: string[];
  stockLengthMm?: string[];
  keyword?: string;
}

interface SteelPriceProcessingQueryInput {
  queryId: string;
  categories: (typeof priceCategories)[number][];
  processingCategories: ProcessingPriceCategory[];
  keyword?: string;
}

interface SteelPriceExactQueryInput {
  queryId: string;
  erpItemCodes: string[];
}

type SearchPriceCandidateQueryInput =
  | SteelPriceLookupQueryInput
  | SteelPriceProcessingQueryInput
  | SteelPriceExactQueryInput;

interface SearchPriceCandidatesInput {
  queries: SearchPriceCandidateQueryInput[];
}

interface SearchCustomersInput {
  keywords: string[];
  limit?: number;
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

const _legacyLookupQuoteRulesSchema = lookupInstructionsSchema.extend({
  customerContext: z
    .object({
      customerId: z.number().int().positive().optional(),
      customerTier: z.enum(priceTierCodes).optional(),
      customerName: nonEmptyString.optional(),
      tierKnown: z.boolean().optional(),
    })
    .optional(),
});

const _lookupDefaultsSchema = z.object({
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

const stockLengthMmSchema = z.array(positiveDecimalString).min(1).max(20);

const directMaterialAliases = new Map<string, (typeof priceLookupMaterialKinds)[number]>([
  ['黑鐵', '黑鐵'],
  ['白鐵', '白鐵'],
  ['2B', '2B'],
  ['NO1', 'NO1'],
  ['HL', 'HL'],
  ['沙面', 'HL'],
  ['砂面', 'HL'],
  ['BA', 'BA'],
  ['亮面', 'BA'],
  ['鋁', '鋁'],
  ['錏', '錏'],
  ['熱浸鍍', '錏'],
  ['熱浸鍍鋅', '錏'],
  ['熱進鍍鋅', '錏'],
  ['鋅', '鋅'],
  ['鎢', '鎢'],
  ['塑膠', '塑膠'],
]);

const materialPriceQuerySchema = z
  .object({
    categories: z
      .array(z.enum(priceCategories))
      .min(1)
      .max(20)
      .describe(
        'Ordered OR material categories. First query is category-only unless a category rule allows a filter, e.g. {"categories":["鐵板"]}; add other filters only on a corrected retry.',
      ),
    subcategory: nonEmptyString
      .optional()
      .describe('Confirmed subcategory; retry-only unless a category rule allows first query, e.g. {"categories":["鐵板"],"subcategory":"平板"}.'),
    material: nonEmptyString
      .optional()
      .describe('Confirmed material/surface; retry-only unless a category rule allows first query, e.g. {"categories":["圓管"],"material":"黑鐵"}.'),
    unit: nonEmptyString
      .optional()
      .describe('Confirmed unit; retry-only unless a category rule allows first query, e.g. {"categories":["鐵板"],"unit":"Kg"}.'),
    thicknessMm: z
      .array(positiveDecimalString)
      .min(1)
      .max(20)
      .optional()
      .describe(
        'Material thickness in mm, never finished/stock length; retry-only unless a category rule allows first query, e.g. {"categories":["鐵板"],"thicknessMm":["6"]}.',
      ),
    stockLengthMm: stockLengthMmSchema
      .optional()
      .describe(
        'Acceptable mother-stock lengths in mm; a relevant category rule may allow first query (H型鋼 example), otherwise retry-only, e.g. {"categories":["H型鋼"],"stockLengthMm":["6000","9000"]}.',
      ),
    keyword: nonEmptyString
      .optional()
      .describe('Category/spec text, never an ERP code; retry-only unless a category rule allows first query, e.g. {"categories":["鐵板"],"keyword":"雷射"}.'),
  })
  .strict()
  .superRefine((query, ctx) => {
    query.categories.forEach((category, categoryIndex) => {
      if (category.startsWith('加工/')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Material categories must be product or material categories',
          path: ['categories', categoryIndex],
        });
      }
      if (query.subcategory && !isPriceSubcategory(category, query.subcategory)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid subcategory ${query.subcategory} for category ${category}`,
          path: ['categories', categoryIndex],
        });
      }
      if (query.stockLengthMm?.some((value) => category === 'H型鋼' && Number(value) < 6000)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'H型鋼 stockLengthMm must be at least 6000',
          path: ['stockLengthMm'],
        });
      }
      if (category === 'H型鋼' && query.keyword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'H型鋼 queries must not use keyword',
          path: ['keyword'],
        });
      }
      if (
        query.unit &&
        ((category === '鐵板' && !['kg', '片'].includes(query.unit.toLowerCase())) ||
          (category === '網' && query.unit.trim() !== ''))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid unit ${query.unit} for category ${category}`,
          path: ['unit'],
        });
      }
    });
    if (query.material) {
      const key = query.material.normalize('NFKC').trim().toUpperCase();
      const recognized =
        directMaterialAliases.has(key) ||
        key === '不鏽鋼' ||
        key.includes('白鐵') ||
        key === '白鐵' ||
        key === 'ST' ||
        key.includes('2B') ||
        key.includes('NO1') ||
        key.includes('霧面') ||
        key.includes('亮面') ||
        /(?:^|[\s/])HL(?:$|[\s/])/u.test(key) ||
        /(?:^|[\s/])BA(?:$|[\s/])/u.test(key) ||
        key === 'STHL' ||
        key === 'STBA' ||
        /[沙砂]面/u.test(key);
      if (!recognized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid material ${query.material}`,
          path: ['material'],
        });
      }
    }
  });

const processingPriceQuerySchema = z
  .object({
    categories: z
      .array(z.enum(priceCategories))
      .min(1)
      .max(20)
      .describe('Processing target categories only; use with processingCategories, e.g. {"categories":["鐵板"],"processingCategories":["加工/切工"]}.'),
    processingCategories: z
      .array(z.enum(priceCategories))
      .min(1)
      .max(processingPriceCategories.length)
      .describe('Processing-only categories, never material filters, e.g. {"categories":["鐵板"],"processingCategories":["加工/切工"]}.'),
    keyword: nonEmptyString.optional().describe('Category-rule-specific processing text; never an ERP code, e.g. {"categories":["鐵板"],"processingCategories":["加工/孔"],"keyword":"圓孔"}.'),
  })
  .strict()
  .superRefine((query, ctx) => {
    query.categories?.forEach((category, index) => {
      if (category.startsWith('加工/')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'processingQuery categories must be product or material categories',
          path: ['categories', index],
        });
      }
    });
    query.processingCategories.forEach((category, index) => {
      if (!category.startsWith('加工/')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'processingCategories must contain processing categories',
          path: ['processingCategories', index],
        });
      }
    });
  });

const exactPriceQuerySchema = z
  .object({
    erpItemCodes: z
      .array(nonEmptyString)
      .min(1)
      .max(100)
      .describe('Exact-only ERP codes used after a material result exceeds 20 and returns selectionRequired=true; choose by candidateRefs.productName, copy each paired erpItemCode, and never infer codes, e.g. {"erpItemCodes":["ERP-1"]}.'),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (new Set(query.erpItemCodes).size !== query.erpItemCodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'erpItemCodes must contain unique values',
        path: ['erpItemCodes'],
      });
    }
  });

const searchPriceCandidateQuerySchema = z.union([
  materialPriceQuerySchema,
  processingPriceQuerySchema,
  exactPriceQuerySchema,
]);

const searchPriceCandidatesSchema: z.ZodType<SearchPriceCandidatesInput, z.ZodTypeDef, unknown> = z
  .object({
    queries: z
      .array(searchPriceCandidateQuerySchema)
      .min(1)
      .max(100)
      .describe(
        'Strict nonempty union in input order: material {categories:[...]}, processing {categories:[...],processingCategories:[...]}, or exact {erpItemCodes:[...]}; material and processing example: {"queries":[{"categories":["鐵板"]},{"categories":["鐵板"],"processingCategories":["加工/孔"]}]}.',
      ),
  })
  .strict()
  .superRefine((input, ctx) => {
    const processingQueryCount = input.queries.filter(
      (query) => 'processingCategories' in query,
    ).length;
    if (processingQueryCount > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At most three processing query items are allowed',
        path: ['queries'],
      });
    }
  })
  .transform(
    (input): SearchPriceCandidatesInput => ({
      queries: input.queries.map((query, index) => {
        const normalizedQuery =
          'stockLengthMm' in query && query.stockLengthMm
            ? {
                ...query,
                stockLengthMm: [
                  ...new Set(query.stockLengthMm.map((value) => String(Math.round(Number(value))))),
                ],
              }
            : query;
        return { ...normalizedQuery, queryId: `q${index + 1}` };
      }) as SearchPriceCandidateQueryInput[],
    }),
  );

const _runVisualInspectionSchema: z.ZodType<RunVisualInspectionInput> = z
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
} = {
  search_customers: searchCustomersSchema,
  search_price_candidates: searchPriceCandidatesSchema,
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
export type SteelBusinessToolName = SteelToolName;
