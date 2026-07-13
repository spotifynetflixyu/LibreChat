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
const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/u)
  .refine((value) => Number(value) > 0, 'Thickness must be greater than zero');
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
  unit?: string;
  thicknessMm?: string[];
  stockLengthMm?: string[];
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

const stockLengthMmSchema = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter((item) => positiveDecimalString.safeParse(item).success)
              .map((item) => String(Math.round(Number(item)))),
          ),
        ].slice(0, 20)
      : value,
  z.array(positiveDecimalString),
);

const tolerantStringSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value : undefined),
  z.string().optional(),
);

const directMaterialAliases = new Map<string, (typeof priceLookupMaterialKinds)[number]>([
  ['黑鐵', '黑鐵'],
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

const priceLookupQuerySchema = z
  .object({
    queryId: nonEmptyString.optional(),
    mode: z.literal('lookup').optional(),
    category: z
      .enum(priceCategories)
      .describe('Known price category; use category_discovery when unknown.'),
    subcategory: optionalFilterString.describe('Optional confirmed subcategory.'),
    material: tolerantStringSchema.describe('Optional confirmed material or surface.'),
    unit: tolerantStringSchema.describe('Optional requested price unit.'),
    thicknessMm: z.array(positiveDecimalString).min(1).max(20).optional(),
    stockLengthMm: stockLengthMmSchema
      .optional()
      .describe('Optional acceptable stock lengths in millimeters.'),
    erpItemCode: nonEmptyString.optional(),
    keyword: nonEmptyString.optional(),
    limit: priceQueryLimitSchema,
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.subcategory && !isPriceSubcategory(query.category, query.subcategory)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid subcategory ${query.subcategory} for category ${query.category}`,
        path: ['subcategory'],
      });
    }
  });

const priceCategoryDiscoveryQuerySchema = z
  .object({
    queryId: nonEmptyString.optional(),
    mode: z.literal('category_discovery'),
    keyword: nonEmptyString.describe('Keyword for discovering an unknown category.'),
    limit: priceQueryLimitSchema,
  })
  .strict();

const searchPriceCandidateQuerySchema = z.union([
  priceCategoryDiscoveryQuerySchema,
  priceLookupQuerySchema,
]);

function normalizeStockLengthMm(
  values: unknown[] | undefined,
  category: (typeof priceCategories)[number],
): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const minimum = category === 'H型鋼' ? 6000 : 0;
  const normalized = values.flatMap((value) => {
    if (typeof value !== 'string') {
      return [];
    }

    const parsed = positiveDecimalString.safeParse(value.normalize('NFKC').trim());
    if (!parsed.success || Number(parsed.data) < minimum) {
      return [];
    }

    return [String(Number(parsed.data))];
  });

  return [...new Set(normalized)].slice(0, 20);
}

function normalizeMaterial(
  value: string | undefined,
  category: (typeof priceCategories)[number],
  thicknessMm: string[] | undefined,
): (typeof priceLookupMaterialKinds)[number] | undefined {
  const text = value?.normalize('NFKC').trim();
  const key = text?.toUpperCase();
  if (key && (key.includes('2B') || key.includes('霧面'))) {
    return '2B';
  }
  if (key?.includes('NO1')) {
    return 'NO1';
  }
  if (key && (/(?:^|[\s/])HL(?:$|[\s/])/u.test(key) || key === 'STHL' || /[沙砂]面/u.test(key))) {
    return 'HL';
  }
  if (key && (/(?:^|[\s/])BA(?:$|[\s/])/u.test(key) || key === 'STBA' || key.includes('亮面'))) {
    return 'BA';
  }
  const normalized = key ? directMaterialAliases.get(key) : undefined;
  if (normalized) {
    return normalized;
  }

  if (key === '不鏽鋼') {
    return '白鐵';
  }
  if (key !== '白鐵' && key !== 'ST') {
    return category === '鐵板' ||
      category === '圓管' ||
      category === '平鐵' ||
      category === '方鐵' ||
      category === '槽鐵' ||
      category === '角鐵'
      ? '黑鐵'
      : undefined;
  }
  if (category !== '鐵板' || !thicknessMm || thicknessMm.length === 0) {
    return '白鐵';
  }

  const thicknesses = thicknessMm.map(Number);
  if (thicknesses.every((thickness) => thickness < 3)) {
    return '2B';
  }
  if (thicknesses.every((thickness) => thickness >= 3)) {
    return 'NO1';
  }

  return '白鐵';
}

function normalizeUnit(
  value: string | undefined,
  category: (typeof priceCategories)[number],
): string | undefined {
  if (category === '鐵板') {
    return value?.toLowerCase() === 'kg' || value === undefined ? 'Kg' : '片';
  }

  if (category === '網') {
    return undefined;
  }

  return value?.trim() || undefined;
}

const searchPriceCandidatesSchema: z.ZodType<SearchPriceCandidatesInput, z.ZodTypeDef, unknown> = z
  .object({
    queries: z.array(searchPriceCandidateQuerySchema, { required_error: 'Provide queries' }).min(1),
  })
  .strict()
  .transform(
    (input): SearchPriceCandidatesInput => ({
      queries: input.queries.map((query, index) => {
        if (query.mode === 'category_discovery') {
          return { ...query, queryId: `q${index + 1}` };
        }

        const { material: rawMaterial, unit: rawUnit, limit: rawLimit, ...queryFields } = query;
        const stockLengthMm = normalizeStockLengthMm(query.stockLengthMm, query.category);
        const material = normalizeMaterial(rawMaterial, query.category, query.thicknessMm);
        const unit = normalizeUnit(rawUnit, query.category);
        const limit = rawLimit;
        const normalizedQuery = {
          ...queryFields,
          ...(material ? { material } : {}),
          ...(unit ? { unit } : {}),
          ...(limit === undefined ? {} : { limit }),
          ...(stockLengthMm === undefined ? {} : { stockLengthMm }),
          queryId: `q${index + 1}`,
        };

        return normalizedQuery;
      }) as SearchPriceCandidateQueryInput[],
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
  readonly read_markdown: z.ZodType<ReadMarkdownInput>;
} = {
  search_customers: searchCustomersSchema,
  search_price_candidates: searchPriceCandidatesSchema,
  read_markdown: readMarkdownSchema,
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
export type SteelBusinessToolName = SteelToolName;
