import { z } from 'zod';

import { steelQuoteItemCandidatesInputSchema } from '../normalization/clarify';
import { steelRankPriceCandidatesInputSchema } from '../pricing/decision';

const nonEmptyString = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100).optional();
const reviewStateSchema = z.enum(['draft', 'needs_review', 'reviewed', 'rejected']).optional();

function atLeastOneFilter<Field extends string>(fields: readonly Field[]) {
  return (value: Partial<{ [key in Field]: string | number | undefined }>) =>
    fields.some((field) => value[field] !== undefined && value[field] !== '');
}

export const steelToolArgsSchemas = {
  lookup_customer: z.object({
    searchText: nonEmptyString,
  }),
  search_customers: z.object({
    searchText: nonEmptyString,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  }),
  normalize_quote_item: steelQuoteItemCandidatesInputSchema,
  search_price_candidates: z
    .object({
      specKey: nonEmptyString.optional(),
      productName: nonEmptyString.optional(),
      customerTierId: z.number().int().positive().optional(),
      reviewState: reviewStateSchema,
      includeInactive: z.boolean().optional(),
      limit: limitSchema,
    })
    .refine(atLeastOneFilter(['specKey', 'productName']), {
      message: 'Provide specKey or productName',
    }),
  rank_price_candidates: steelRankPriceCandidatesInputSchema,
  lookup_spec_price: z.object({
    specKey: nonEmptyString,
    customerTierId: z.number().int().positive().optional(),
    reviewState: reviewStateSchema,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  }),
  lookup_weight_spec: z.object({
    specKey: nonEmptyString,
    productFamily: nonEmptyString.optional(),
    shape: nonEmptyString.optional(),
    reviewState: reviewStateSchema,
    limit: limitSchema,
  }),
  lookup_cutting_price: z
    .object({
      productFamily: nonEmptyString.optional(),
      cutType: nonEmptyString.optional(),
      specKey: nonEmptyString.optional(),
      reviewState: reviewStateSchema,
      includeInactive: z.boolean().optional(),
      limit: limitSchema,
    })
    .refine(atLeastOneFilter(['productFamily', 'cutType', 'specKey']), {
      message: 'Provide productFamily, cutType, or specKey',
    }),
  lookup_hole_price: z
    .object({
      holeType: nonEmptyString.optional(),
      diameterMm: z.number().positive().optional(),
      lengthMm: z.number().positive().optional(),
      widthMm: z.number().positive().optional(),
      dimensionLabel: nonEmptyString.optional(),
      reviewState: reviewStateSchema,
      includeInactive: z.boolean().optional(),
      limit: limitSchema,
    })
    .refine(
      (value) =>
        value.holeType !== undefined ||
        value.diameterMm !== undefined ||
        value.lengthMm !== undefined ||
        value.widthMm !== undefined ||
        value.dimensionLabel !== undefined,
      {
        message: 'Provide holeType, diameterMm, lengthMm, widthMm, or dimensionLabel',
      },
    ),
  lookup_processing_price: z
    .object({
      processingType: nonEmptyString.optional(),
      productFamily: nonEmptyString.optional(),
      specKey: nonEmptyString.optional(),
      reviewState: reviewStateSchema,
      includeInactive: z.boolean().optional(),
      limit: limitSchema,
    })
    .refine(atLeastOneFilter(['processingType', 'productFamily', 'specKey']), {
      message: 'Provide processingType, productFamily, or specKey',
    }),
  lookup_material_rules: z
    .object({
      materialFamily: nonEmptyString.optional(),
      ruleType: nonEmptyString.optional(),
      conditionType: nonEmptyString.optional(),
      reviewState: reviewStateSchema,
      includeInactive: z.boolean().optional(),
      limit: limitSchema,
    })
    .refine(atLeastOneFilter(['materialFamily', 'ruleType', 'conditionType']), {
      message: 'Provide materialFamily, ruleType, or conditionType',
    }),
  lookup_formula_version: z.object({
    code: nonEmptyString,
    reviewState: reviewStateSchema,
  }),
  find_order_items: z.object({
    erpOrderCode: nonEmptyString,
    limit: z.number().int().min(1).max(200).optional(),
  }),
  search_source_chunks: z
    .object({
      projectSourceId: nonEmptyString.optional(),
      searchText: nonEmptyString.optional(),
      status: z.enum(['active', 'inactive', 'deleted']).optional(),
      limit: limitSchema,
    })
    .refine(atLeastOneFilter(['projectSourceId', 'searchText']), {
      message: 'Provide projectSourceId or searchText',
    }),
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
