import { z } from 'zod';

import { isRawUserTextPriceSearchQuery, steelPriceSearchCandidateSchema } from '../normalization';

const nonEmptyString = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100).optional();
const reviewStateSchema = z.enum(['draft', 'needs_review', 'reviewed', 'rejected']).optional();

const instructionMaterialContextSchema = z.object({
  lineRefs: z.array(nonEmptyString).min(1).max(20).optional(),
  packetGroupHints: z.array(nonEmptyString).min(1).max(20).optional(),
  materialCandidates: z.array(nonEmptyString).min(1).max(20).optional(),
  surfaceCandidates: z.array(nonEmptyString).min(1).max(20).optional(),
  formulaCandidates: z.array(nonEmptyString).min(1).max(20).optional(),
  processingTypes: z.array(nonEmptyString).min(1).max(20).optional(),
  lowConfidenceReasons: z.array(nonEmptyString).min(1).max(20).optional(),
});

const lookupInstructionsSchema = z.object({
  taskTypes: z.array(nonEmptyString).min(1).max(20),
  packetGroupHints: z.array(nonEmptyString).min(1).max(20).optional(),
  evidenceSummary: nonEmptyString,
  materialContexts: z.array(instructionMaterialContextSchema).min(1).max(20),
  customerContext: z
    .object({
      customerName: nonEmptyString.optional(),
      tierKnown: z.boolean().optional(),
    })
    .optional(),
  limit: limitSchema,
});

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
  lookup_instructions: lookupInstructionsSchema,
  lookup_defaults: z.object({
    materialContexts: z.array(instructionMaterialContextSchema).min(1).max(20),
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
  }),
  lookup_formula: z.object({
    materialContexts: z.array(instructionMaterialContextSchema).min(1).max(20),
    reviewState: reviewStateSchema,
  }),
  search_customers: z.object({
    searchText: nonEmptyString,
    includeInactive: z.boolean().optional(),
    limit: limitSchema,
  }),
  search_price_candidates: searchPriceCandidatesSchema,
} as const;

export type SteelToolName = keyof typeof steelToolArgsSchemas;
export type LookupDefaultsInput = z.infer<typeof steelToolArgsSchemas.lookup_defaults>;
export type LookupFormulaInput = z.infer<typeof steelToolArgsSchemas.lookup_formula>;
export type LookupInstructionsInput = z.infer<typeof lookupInstructionsSchema>;
