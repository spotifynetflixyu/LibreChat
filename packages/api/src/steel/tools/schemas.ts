import { z } from 'zod';

import { isRawUserTextPriceSearchQuery, steelPriceSearchCandidateSchema } from '../normalization';

const nonEmptyString = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100).optional();
const reviewStateSchema = z.enum(['draft', 'needs_review', 'reviewed', 'rejected']).optional();

function atLeastOneFilter<Field extends string>(fields: readonly Field[]) {
  return (value: Partial<{ [key in Field]: string | number | undefined }>) =>
    fields.some((field) => value[field] !== undefined && value[field] !== '');
}

const searchPriceCandidatesSchema = z
  .object({
    originalText: nonEmptyString.optional(),
    specKey: nonEmptyString.optional(),
    specKeyContains: nonEmptyString.optional(),
    productName: nonEmptyString.optional(),
    candidateQueries: z.array(steelPriceSearchCandidateSchema).max(10).optional(),
    customerTierId: z.number().int().positive().optional(),
    reviewState: reviewStateSchema,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  })
  .superRefine((input, ctx) => {
    const hasDirectFilter =
      input.specKey !== undefined ||
      input.specKeyContains !== undefined ||
      input.productName !== undefined;
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
  });

export const steelToolArgsSchemas = {
  lookup_customer: z.object({
    searchText: nonEmptyString,
  }),
  search_customers: z.object({
    searchText: nonEmptyString,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  }),
  search_price_candidates: searchPriceCandidatesSchema,
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
