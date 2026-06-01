import { z } from 'zod';

const chargeTypeSchema = z.enum([
  'material',
  'cutting',
  'hole',
  'slotting',
  'bending',
  'processing',
]);

const sourceRefSchema = z.object({
  channel: z.string().trim().min(1),
  factType: z.string().trim().min(1),
  sourceFile: z.string().trim().min(1).optional(),
  sourceVersionId: z.string().trim().min(1).optional(),
  locator: z.string().trim().min(1).optional(),
  confidence: z.string().trim().min(1).optional(),
  extractedLabel: z.string().trim().min(1).optional(),
  canonicalKey: z.string().trim().min(1).optional(),
});

const calculationParameterSchema = z.object({
  parameterKey: z.string().trim().min(1),
  valueType: z.enum(['money', 'quantity', 'rate', 'percentage']),
  value: z.number().nonnegative(),
  unit: z.string().trim().min(1).optional(),
  sourceRefs: z.array(sourceRefSchema).default([]),
});

const calculationParameterOverrideSchema = calculationParameterSchema.extend({
  source: z.enum(['user_message', 'quote_evidence', 'admin_review']),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const steelPriceCandidateSchema = z.object({
  candidateId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  specKey: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  unitPrice: z.number().nonnegative().nullable(),
  valueState: z.enum(['unknown', 'confirmed', 'true_zero', 'estimate']),
  matchType: z.enum(['exact', 'alias', 'estimate', 'manual']),
  sourceRefs: z.array(sourceRefSchema).default([]),
});

export const steelSelectedCalculationRuleSchema = z.object({
  ruleId: z.string().trim().min(1),
  source: z.enum(['ai_selected_lesson', 'memory', 'admin_review']),
  formulaCode: z.string().trim().min(1).optional(),
  appliesToChargeTypes: z.array(chargeTypeSchema).min(1),
  effect: z.enum(['true_zero_charge', 'normal_formula']),
  confidence: z.enum(['high', 'medium', 'low']),
  skipRemainderCalculation: z.boolean().default(false),
  defaultParameters: z.array(calculationParameterSchema).default([]),
  parameterOverrides: z.array(calculationParameterOverrideSchema).default([]),
  sourceRefs: z.array(sourceRefSchema).default([]),
});

export const steelRankPriceCandidatesInputSchema = z.object({
  productFamily: z.string().trim().min(1).optional(),
  chargeType: chargeTypeSchema,
  selectedCalculationRule: steelSelectedCalculationRuleSchema.optional(),
  candidates: z.array(steelPriceCandidateSchema).max(20),
  maxOptions: z.number().int().min(1).max(10).optional(),
});

export type SteelPriceCandidate = z.infer<typeof steelPriceCandidateSchema>;
export type SteelCalculationParameter = z.infer<typeof calculationParameterSchema>;
export type SteelCalculationParameterOverride = z.infer<typeof calculationParameterOverrideSchema>;
export type SteelSelectedCalculationRule = z.infer<typeof steelSelectedCalculationRuleSchema>;
export type SteelRankPriceCandidatesInput = z.input<typeof steelRankPriceCandidatesInputSchema>;

export type SteelPriceDecisionAction = 'use_price' | 'confirm_candidates' | 'no_price';

export type SteelPriceDecisionReason =
  | 'confirmed_price'
  | 'calculation_parameter_override'
  | 'calculation_rule_true_zero'
  | 'multiple_usable_candidates'
  | 'no_usable_price';

export type SteelRejectedPriceCandidateReason =
  | 'missing_price'
  | 'product_price_zero_is_missing'
  | 'zero_price_requires_calculation_rule'
  | 'parameter_override_not_confirmed'
  | 'calculation_rule_not_confirmed';

export interface SteelRejectedPriceCandidate {
  candidateId: string;
  reason: SteelRejectedPriceCandidateReason;
}

export interface SteelPriceConfirmationOption {
  optionId: string;
  label: string;
  specKey: string;
  unit: string;
  unitPrice: number;
  valueState: SteelPriceCandidate['valueState'];
  matchType: SteelPriceCandidate['matchType'];
}

export interface SteelRankedPriceCandidate extends SteelPriceCandidate {
  valueState: SteelPriceCandidate['valueState'];
}

export interface SteelPriceDecision {
  action: SteelPriceDecisionAction;
  confirmationRequired: boolean;
  manualReviewRequired: boolean;
  reason: SteelPriceDecisionReason;
  selectedCandidate?: SteelRankedPriceCandidate;
  options: SteelPriceConfirmationOption[];
  rejectedCandidates: SteelRejectedPriceCandidate[];
  skipRemainderCalculation: boolean;
  calculationRule?: SteelSelectedCalculationRule;
}

function isProductPriceSource(candidate: SteelPriceCandidate): boolean {
  return candidate.sourceRefs.some(
    (sourceRef) =>
      sourceRef.factType === 'product_price' || sourceRef.sourceFile?.includes('產品價格.xlsx'),
  );
}

function isRuleApplicableToChargeType(
  rule: SteelSelectedCalculationRule | undefined,
  chargeType: z.infer<typeof chargeTypeSchema>,
): rule is SteelSelectedCalculationRule {
  return rule !== undefined && rule.appliesToChargeTypes.includes(chargeType);
}

function isTrueZeroRuleApplicableToChargeType(
  rule: SteelSelectedCalculationRule | undefined,
  chargeType: z.infer<typeof chargeTypeSchema>,
): rule is SteelSelectedCalculationRule {
  return isRuleApplicableToChargeType(rule, chargeType) && rule.effect === 'true_zero_charge';
}

function getConfirmedTrueZeroRule(
  input: z.infer<typeof steelRankPriceCandidatesInputSchema>,
): SteelSelectedCalculationRule | undefined {
  if (!isTrueZeroRuleApplicableToChargeType(input.selectedCalculationRule, input.chargeType)) {
    return undefined;
  }

  return input.selectedCalculationRule.confidence === 'high'
    ? input.selectedCalculationRule
    : undefined;
}

function getZeroPriceRejectionReason(
  input: z.infer<typeof steelRankPriceCandidatesInputSchema>,
): SteelRejectedPriceCandidateReason {
  if (!isTrueZeroRuleApplicableToChargeType(input.selectedCalculationRule, input.chargeType)) {
    return 'zero_price_requires_calculation_rule';
  }

  return 'calculation_rule_not_confirmed';
}

function isUnitPriceParameterKey(parameterKey: string): boolean {
  return parameterKey === 'unitPrice' || parameterKey === 'unit_price';
}

function findUnitPriceOverride(
  input: z.infer<typeof steelRankPriceCandidatesInputSchema>,
): SteelCalculationParameterOverride | undefined {
  if (!isRuleApplicableToChargeType(input.selectedCalculationRule, input.chargeType)) {
    return undefined;
  }

  return input.selectedCalculationRule.parameterOverrides.find((override) =>
    isUnitPriceParameterKey(override.parameterKey),
  );
}

function getConfirmedUnitPriceOverride(
  input: z.infer<typeof steelRankPriceCandidatesInputSchema>,
): SteelCalculationParameterOverride | undefined {
  const override = findUnitPriceOverride(input);
  if (!override || input.selectedCalculationRule?.confidence !== 'high') {
    return undefined;
  }

  return override.confidence === 'high' ? override : undefined;
}

function getMissingPriceRejectionReason(
  input: z.infer<typeof steelRankPriceCandidatesInputSchema>,
): SteelRejectedPriceCandidateReason {
  return findUnitPriceOverride(input) ? 'parameter_override_not_confirmed' : 'missing_price';
}

function applyUnitPriceOverride(
  candidate: SteelPriceCandidate,
  override: SteelCalculationParameterOverride,
): SteelRankedPriceCandidate {
  return {
    ...candidate,
    unitPrice: override.value,
    valueState: override.value === 0 ? 'true_zero' : 'confirmed',
    sourceRefs: [...candidate.sourceRefs, ...override.sourceRefs],
  };
}

function toOption(candidate: SteelRankedPriceCandidate): SteelPriceConfirmationOption {
  return {
    optionId: candidate.candidateId,
    label: candidate.label,
    specKey: candidate.specKey,
    unit: candidate.unit,
    unitPrice: candidate.unitPrice ?? 0,
    valueState: candidate.valueState,
    matchType: candidate.matchType,
  };
}

function createSelectedPriceDecision(
  reason: SteelPriceDecisionReason,
  selectedCandidate: SteelRankedPriceCandidate,
  rejectedCandidates: SteelRejectedPriceCandidate[],
  skipRemainderCalculation: boolean,
  calculationRule?: SteelSelectedCalculationRule,
): SteelPriceDecision {
  return {
    action: 'use_price',
    confirmationRequired: false,
    manualReviewRequired: false,
    reason,
    selectedCandidate,
    options: [],
    rejectedCandidates,
    skipRemainderCalculation,
    calculationRule,
  };
}

function noPrice(rejectedCandidates: SteelRejectedPriceCandidate[]): SteelPriceDecision {
  return {
    action: 'no_price',
    confirmationRequired: false,
    manualReviewRequired: true,
    reason: 'no_usable_price',
    selectedCandidate: undefined,
    options: [],
    rejectedCandidates,
    skipRemainderCalculation: false,
  };
}

export function rankSteelPriceCandidates(input: SteelRankPriceCandidatesInput): SteelPriceDecision {
  const parsed = steelRankPriceCandidatesInputSchema.parse(input);
  const rejectedCandidates: SteelRejectedPriceCandidate[] = [];
  const unitPriceOverride = getConfirmedUnitPriceOverride(parsed);
  const usableCandidates = parsed.candidates.reduce<SteelRankedPriceCandidate[]>(
    (usable, candidate) => {
      if (unitPriceOverride) {
        usable.push(applyUnitPriceOverride(candidate, unitPriceOverride));
        return usable;
      }

      if (candidate.unitPrice === null || candidate.valueState === 'unknown') {
        rejectedCandidates.push({
          candidateId: candidate.candidateId,
          reason: getMissingPriceRejectionReason(parsed),
        });
        return usable;
      }

      if (candidate.unitPrice === 0 && isProductPriceSource(candidate)) {
        rejectedCandidates.push({
          candidateId: candidate.candidateId,
          reason: 'product_price_zero_is_missing',
        });
        return usable;
      }

      if (candidate.unitPrice === 0) {
        const calculationRule = getConfirmedTrueZeroRule(parsed);
        if (calculationRule) {
          usable.push({
            ...candidate,
            valueState: 'true_zero',
          });
          return usable;
        }

        rejectedCandidates.push({
          candidateId: candidate.candidateId,
          reason: getZeroPriceRejectionReason(parsed),
        });
        return usable;
      }

      usable.push(candidate);
      return usable;
    },
    [],
  );

  if (usableCandidates.length === 0) {
    return noPrice(rejectedCandidates);
  }

  if (usableCandidates.length > 1) {
    return {
      action: 'confirm_candidates',
      confirmationRequired: true,
      manualReviewRequired: false,
      reason: 'multiple_usable_candidates',
      selectedCandidate: undefined,
      options: usableCandidates.slice(0, parsed.maxOptions ?? 5).map(toOption),
      rejectedCandidates,
      skipRemainderCalculation: false,
    };
  }

  const [selectedCandidate] = usableCandidates;
  let calculationRule: SteelSelectedCalculationRule | undefined;
  if (unitPriceOverride !== undefined) {
    calculationRule = parsed.selectedCalculationRule;
  } else if (selectedCandidate.unitPrice === 0) {
    calculationRule = getConfirmedTrueZeroRule(parsed);
  }

  const skipRemainderCalculation = calculationRule?.skipRemainderCalculation ?? false;

  if (unitPriceOverride) {
    return createSelectedPriceDecision(
      'calculation_parameter_override',
      selectedCandidate,
      rejectedCandidates,
      skipRemainderCalculation,
      calculationRule,
    );
  }

  if (selectedCandidate.unitPrice === 0 && calculationRule) {
    return createSelectedPriceDecision(
      'calculation_rule_true_zero',
      selectedCandidate,
      rejectedCandidates,
      skipRemainderCalculation,
      calculationRule,
    );
  }

  return createSelectedPriceDecision(
    'confirmed_price',
    selectedCandidate,
    rejectedCandidates,
    false,
  );
}
