import { z } from 'zod';

export const steelRuleProposalTypes = [
  'customer_default',
  'material_rule',
  'price_override',
  'formula_default',
] as const;

export const steelRuleProposalStatuses = ['needs_review', 'reviewed', 'rejected'] as const;

export const steelRuleProposalScopeTypes = [
  'customer',
  'customer_tier',
  'catalog_family',
  'product_family',
  'company',
] as const;

export const steelRuleProposalChargeTypes = [
  'material',
  'cutting',
  'hole',
  'slotting',
  'bending',
  'processing',
] as const;

export const steelRuleProposalConfidences = ['low', 'medium', 'high'] as const;

export const steelRuleProposalParameterValueTypes = [
  'string',
  'number',
  'boolean',
  'null',
] as const;

export const steelRuleProposalTypeSchema = z.enum(steelRuleProposalTypes);
export const steelRuleProposalStatusSchema = z.enum(steelRuleProposalStatuses);
export const steelRuleProposalScopeTypeSchema = z.enum(steelRuleProposalScopeTypes);
export const steelRuleProposalChargeTypeSchema = z.enum(steelRuleProposalChargeTypes);
export const steelRuleProposalConfidenceSchema = z.enum(steelRuleProposalConfidences);
export const steelRuleProposalParameterValueTypeSchema = z.enum(
  steelRuleProposalParameterValueTypes,
);

const steelRuleProposalParameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

function validateParameterValue(
  value: string | number | boolean | null,
  valueType: z.infer<typeof steelRuleProposalParameterValueTypeSchema>,
  ctx: z.RefinementCtx,
) {
  if (valueType === 'null' && value !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'null parameter values must use null',
      path: ['value'],
    });
    return;
  }
  if (valueType !== 'null' && typeof value !== valueType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `parameter value must be ${valueType}`,
      path: ['value'],
    });
  }
}

export const steelRuleProposalSelectorEntrySchema = z
  .object({
    key: z.string().min(1),
    value: steelRuleProposalParameterValueSchema,
  })
  .strict();

export type SteelRuleProposalSelectorEntry = z.infer<typeof steelRuleProposalSelectorEntrySchema>;

export const steelRuleProposalSelectorSchema = z
  .object({
    catalogFamily: z.string().min(1).optional(),
    productFamily: z.string().min(1).optional(),
    specification: z.string().min(1).optional(),
    workType: z.string().min(1).optional(),
    conditionText: z.string().min(1).optional(),
    customerAlias: z.string().min(1).optional(),
    additionalSelectors: z.array(steelRuleProposalSelectorEntrySchema).default([]),
  })
  .strict()
  .superRefine((selector, ctx) => {
    const hasNamedSelector =
      selector.catalogFamily !== undefined ||
      selector.productFamily !== undefined ||
      selector.specification !== undefined ||
      selector.workType !== undefined ||
      selector.conditionText !== undefined ||
      selector.customerAlias !== undefined;

    if (!hasNamedSelector && selector.additionalSelectors.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rule proposal selector requires at least one task selector',
      });
    }
  });

export type SteelRuleProposalSelector = z.infer<typeof steelRuleProposalSelectorSchema>;

export const steelRuleProposalDefaultParameterSchema = z
  .object({
    key: z.string().min(1),
    value: steelRuleProposalParameterValueSchema,
    valueType: steelRuleProposalParameterValueTypeSchema,
    unit: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((parameter, ctx) => {
    validateParameterValue(parameter.value, parameter.valueType, ctx);
  });

export type SteelRuleProposalDefaultParameter = z.infer<
  typeof steelRuleProposalDefaultParameterSchema
>;

export const steelRuleProposalSourceRefSchema = z
  .object({
    channel: z.string().min(1),
    factType: z.string().min(1),
    sourceFile: z.string().min(1).optional(),
    sourceVersionId: z.string().min(1).optional(),
    locator: z.string().min(1).optional(),
    confidence: steelRuleProposalConfidenceSchema.optional(),
    extractedLabel: z.string().min(1).optional(),
    canonicalKey: z.string().min(1).optional(),
  })
  .strict();

export type SteelRuleProposalSourceRef = z.infer<typeof steelRuleProposalSourceRefSchema>;

interface ScopeCheckInput {
  scopeType: z.infer<typeof steelRuleProposalScopeTypeSchema>;
  customerId?: string;
  customerTierId?: string;
  catalogFamily?: string;
  productFamily?: string;
}

function validateScopeSelectors(value: ScopeCheckInput, ctx: z.RefinementCtx) {
  const scopeRequirements: Array<{
    scopeType: ScopeCheckInput['scopeType'];
    field: 'customerId' | 'customerTierId' | 'catalogFamily' | 'productFamily';
  }> = [
    { scopeType: 'customer', field: 'customerId' },
    { scopeType: 'customer_tier', field: 'customerTierId' },
    { scopeType: 'catalog_family', field: 'catalogFamily' },
    { scopeType: 'product_family', field: 'productFamily' },
  ];

  for (const requirement of scopeRequirements) {
    if (value.scopeType === requirement.scopeType && value[requirement.field] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${requirement.scopeType} proposals require ${requirement.field}`,
        path: [requirement.field],
      });
    }
  }
}

const steelRuleProposalBaseSchema = z
  .object({
    proposalType: steelRuleProposalTypeSchema,
    scopeType: steelRuleProposalScopeTypeSchema,
    customerId: z.string().min(1).optional(),
    customerTierId: z.string().min(1).optional(),
    catalogFamily: z.string().min(1).optional(),
    productFamily: z.string().min(1).optional(),
    chargeType: steelRuleProposalChargeTypeSchema,
    formulaCode: z.string().min(1),
    formulaVersionId: z.string().min(1).optional(),
    selector: steelRuleProposalSelectorSchema,
    proposedDefaultParameters: z.array(steelRuleProposalDefaultParameterSchema).min(1),
    sourceRefs: z.array(steelRuleProposalSourceRefSchema).min(1),
    createdFromConversationId: z.string().min(1),
    reason: z.string().min(1),
    confidence: steelRuleProposalConfidenceSchema,
  })
  .strict();

export const steelRuleProposalCreateRequestSchema =
  steelRuleProposalBaseSchema.superRefine(validateScopeSelectors);

export type SteelRuleProposalCreateRequest = z.infer<typeof steelRuleProposalCreateRequestSchema>;

export const steelRuleProposalResponseSchema = steelRuleProposalBaseSchema
  .extend({
    id: z.string().min(1),
    status: steelRuleProposalStatusSchema,
    createdByUserId: z.string().min(1),
    reviewedByUserId: z.string().min(1).optional(),
    reviewedAt: z.string().min(1).optional(),
    reviewNote: z.string().min(1).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict()
  .superRefine(validateScopeSelectors);

export type SteelRuleProposalResponse = z.infer<typeof steelRuleProposalResponseSchema>;
