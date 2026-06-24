import { z } from 'zod';
import {
  defaultPriceTierCode,
  materialKinds,
  priceCategories,
  priceTierCodes,
} from '../pricing/enums';
import { steelRuntimeActiveOutputSheetIds } from '../runtime/context';

export const defaultSteelPriceCustomerTier: (typeof priceTierCodes)[number] = defaultPriceTierCode;

const nonEmptyString = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100).optional();
const reviewStateSchema = z.enum(['draft', 'needs_review', 'reviewed', 'rejected']).optional();
const keywordsSchema = z.array(nonEmptyString).min(1).max(20);
const activeWorkbookSheetIdSchema = z.enum(steelRuntimeActiveOutputSheetIds);

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

export interface LookupQuoteRulesToolInput {
  keywords: string[];
  limit?: number;
}

interface SteelPriceLookupQueryInput {
  mode?: 'lookup';
  category: (typeof priceCategories)[number];
  material?: (typeof materialKinds)[number];
  thicknessMm?: string[];
  keyword?: string;
  limit?: number;
}

interface SteelPriceCategoryDiscoveryQueryInput {
  mode: 'category_discovery';
  keyword: string;
  limit?: number;
}

interface SearchPriceCandidatesInput {
  queries: Array<SteelPriceLookupQueryInput | SteelPriceCategoryDiscoveryQueryInput>;
}

interface SearchCustomersInput {
  keywords: string[];
  limit?: number;
}

export interface RunFileOcrInput {
  filename?: string;
  fileIndex?: number;
  output_mode?: 'markdown' | 'detailed' | 'json';
  dpi?: number;
}

export interface ReadWorkingOrderItemsInput {
  mode: 'summary' | 'rowNo' | 'erpItemCode' | 'query' | 'source' | 'page';
  rowNo?: number;
  erpItemCode?: string;
  query?: string;
  filename?: string;
  pageNumber?: number;
  imageIndex?: number;
  page?: number;
  pageSize?: number;
}

export interface ReadActiveWorkbookInput {
  query: string;
  sheetIds?: Array<(typeof steelRuntimeActiveOutputSheetIds)[number]>;
  limit?: number;
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

function isCoordinateOnlyQuery(value: string): boolean {
  const normalized = value.normalize('NFKC').trim();
  const compact = normalized.replace(/\s+/gu, '');

  return (
    /^[A-Z]{1,2}\d+(?::[A-Z]{1,2}\d+)?$/iu.test(compact) ||
    /^(?:row|rows|column|columns|col)\d+$/iu.test(compact) ||
    /^第?\d+[列欄行]$/u.test(compact) ||
    /^[A-Z]{1,3}欄$/iu.test(compact)
  );
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
      .enum(materialKinds)
      .optional()
      .describe('Optional material enum value. Use the visible enum value, for example OT 黑鐵 or 錏.'),
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

const searchPriceCandidateQuerySchema = z.preprocess(
  normalizeSearchPriceCandidateQueryInput,
  z.union([priceCategoryDiscoveryQuerySchema, priceLookupQuerySchema]),
);

const searchPriceCandidatesSchema: z.ZodType<SearchPriceCandidatesInput> = z
  .object({
    queries: z.array(searchPriceCandidateQuerySchema, { required_error: 'Provide queries' }).min(1).max(20),
  })
  .strict();

const runFileOcrSchema: z.ZodType<RunFileOcrInput> = z
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

const readWorkingOrderItemsSchema: z.ZodType<ReadWorkingOrderItemsInput> = z
  .object({
    mode: z
      .enum(['summary', 'rowNo', 'erpItemCode', 'query', 'source', 'page'])
      .describe('Read mode for conversation-scoped Working Order Memory.'),
    rowNo: z.number().int().positive().optional(),
    erpItemCode: nonEmptyString.optional(),
    query: nonEmptyString.optional(),
    filename: nonEmptyString.optional(),
    pageNumber: z.number().int().positive().optional(),
    imageIndex: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.mode === 'rowNo' && input.rowNo === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide rowNo',
      });
    }
    if (input.mode === 'erpItemCode' && input.erpItemCode === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide erpItemCode',
      });
    }
    if (input.mode === 'query' && input.query === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide query',
      });
    }
    if (
      input.mode === 'source' &&
      input.filename === undefined &&
      input.pageNumber === undefined &&
      input.imageIndex === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide filename, pageNumber, or imageIndex',
      });
    }
    if (input.mode === 'page' && input.page === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide page',
      });
    }
  });

const readActiveWorkbookSchema: z.ZodType<ReadActiveWorkbookInput> = z
  .object({
    query: nonEmptyString.describe(
      'Required semantic keyword query for active workbook rows. Use item codes, product names, customer names, part numbers, status words, or quote text. Do not use spreadsheet coordinates.',
    ),
    sheetIds: z.array(activeWorkbookSheetIdSchema).min(1).max(4).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    reason: nonEmptyString.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (!isCoordinateOnlyQuery(input.query)) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use semantic keywords, not spreadsheet coordinates or row/column references',
      path: ['query'],
    });
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
  readonly lookup_quote_rules: z.ZodType<LookupQuoteRulesToolInput>;
  readonly search_customers: z.ZodType<SearchCustomersInput>;
  readonly search_price_candidates: z.ZodType<SearchPriceCandidatesInput>;
  readonly run_file_ocr: z.ZodType<RunFileOcrInput>;
  readonly read_active_workbook: z.ZodType<ReadActiveWorkbookInput>;
  readonly read_working_order_items: z.ZodType<ReadWorkingOrderItemsInput>;
} = {
  lookup_quote_rules: lookupQuoteRulesSchema,
  search_customers: searchCustomersSchema,
  search_price_candidates: searchPriceCandidatesSchema,
  run_file_ocr: runFileOcrSchema,
  read_active_workbook: readActiveWorkbookSchema,
  read_working_order_items: readWorkingOrderItemsSchema,
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
export type SteelBusinessToolName = SteelToolName;
