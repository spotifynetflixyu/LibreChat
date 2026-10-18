import { z } from 'zod';

import type { ProcessingPriceCategory } from '../pricing/processing-candidates';

import { priceCategories, priceLookupMaterialKinds } from '../pricing/enums';
import { processingPriceCategories } from '../pricing/processing-candidates';
import { isPriceSubcategory } from '../pricing/categories';

const nonEmptyString = z.string().trim().min(1);
const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/u)
  .refine((value) => Number(value) > 0, 'Thickness must be greater than zero');
const limitSchema = z.number().int().min(1).max(100).optional();

const keywordsSchema = z.array(nonEmptyString).min(1).max(20);

interface SteelPriceLookupQueryInput {
  queryId: string;
  categories: (typeof priceCategories)[number][];
  subcategory?: string;
  materials?: string[];
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

type SearchPriceCandidateQueryInput =
  | SteelPriceLookupQueryInput
  | SteelPriceProcessingQueryInput;

interface SearchPriceCandidatesInput {
  queries: SearchPriceCandidateQueryInput[];
}

interface SearchCustomersInput {
  keywords: string[];
  limit?: number;
}

const stockLengthMmSchema = z.array(positiveDecimalString).min(1).max(20);

const directMaterialAliases = new Map<string, (typeof priceLookupMaterialKinds)[number]>([
  ['OT', '黑鐵'],
  ['黑鐵', '黑鐵'],
  ['白鐵', '白鐵'],
  ['ST', '白鐵'],
  ['2B', '2B'],
  ['NO1', 'NO1'],
  ['HL', 'HL'],
  ['沙面', 'HL'],
  ['砂面', 'HL'],
  ['BA', 'BA'],
  ['亮面', 'BA'],
  ['鋁', '鋁'],
  ['錏', '錏'],
  ['鍍鋅', '錏'],
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
        'Ordered OR material categories. Use category-only when optional facts are unknown; use one or more confirmed OR materials, including mixed families/surfaces, e.g. {"categories":["鐵板"],"materials":["OT"]}, {"categories":["鐵板"],"materials":["ST","2B"]}.',
      ),
    subcategory: nonEmptyString
      .optional()
      .describe('Confirmed subcategory needed to distinguish products, e.g. {"categories":["鐵板"],"subcategory":"平板"}.'),
    materials: z
      .array(nonEmptyString)
      .min(1)
      .max(20)
      .optional()
      .describe('Optional OR material list. Use one family or surface, multiple surfaces, or mixed families/surfaces, e.g. {"categories":["圓管"],"materials":["BA"]}, {"categories":["鐵板"],"materials":["ST","2B"]}, or {"categories":["鐵板"],"materials":["黑鐵","2B"]}.'),
    unit: nonEmptyString
      .optional()
      .describe('Confirmed quote unit needed to distinguish products, e.g. {"categories":["鐵板"],"unit":"Kg"}.'),
    thicknessMm: z
      .array(positiveDecimalString)
      .min(1)
      .max(20)
      .optional()
      .describe(
        'Confirmed material thicknesses in mm, never finished/stock length, e.g. {"categories":["鐵板"],"thicknessMm":["6"]}.',
      ),
    stockLengthMm: stockLengthMmSchema
      .optional()
      .describe(
        'Confirmed acceptable mother-stock lengths in mm; H型鋼 may send multiple planned lengths together, e.g. {"categories":["H型鋼"],"stockLengthMm":["6000","9000"]}.',
      ),
    keyword: nonEmptyString
      .optional()
      .describe('Confirmed category/spec text allowed by the category rule; never a candidate productName or ERP code, e.g. {"categories":["鐵板"],"keyword":"雷射"}.'),
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
    query.materials?.forEach((material, materialIndex) => {
      const key = material.normalize('NFKC').trim().toUpperCase();
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
          message: `Invalid material ${material}`,
          path: ['materials', materialIndex],
        });
      }
    });
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

const searchPriceCandidateQuerySchema = z.union([materialPriceQuerySchema, processingPriceQuerySchema]);

const searchPriceCandidatesSchema: z.ZodType<SearchPriceCandidatesInput, z.ZodTypeDef, unknown> = z
  .object({
    queries: z
      .array(searchPriceCandidateQuerySchema)
      .min(1)
      .max(100)
      .describe(
        'Strict nonempty union in input order: material {categories:[...]} or processing {categories:[...],processingCategories:[...]}. Results contain direct flat candidates.',
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
