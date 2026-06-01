import { z } from 'zod';

const confidenceSchema = z.enum(['high', 'medium', 'low']);

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

export const steelQuoteItemCandidateSchema = z.object({
  candidateId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  specKey: z.string().trim().min(1),
  productFamily: z.string().trim().min(1).optional(),
  materialGrade: z.string().trim().min(1).optional(),
  surfaceTreatment: z.string().trim().min(1).optional(),
  thicknessMm: z.number().positive().optional(),
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  lengthM: z.number().positive().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().min(1).optional(),
  confidence: confidenceSchema,
  missingFields: z.array(z.string().trim().min(1)).default([]),
  sourceRefs: z.array(sourceRefSchema).default([]),
});

export const steelQuoteItemCandidatesInputSchema = z.object({
  originalText: z.string().trim().min(1),
  candidates: z.array(steelQuoteItemCandidateSchema).max(20),
  maxOptions: z.number().int().min(1).max(10).optional(),
});

export type SteelQuoteItemCandidate = z.infer<typeof steelQuoteItemCandidateSchema>;
export type SteelQuoteItemCandidatesInput = z.input<typeof steelQuoteItemCandidatesInputSchema>;
export type SteelNormalizedQuoteItemCandidate = z.infer<typeof steelQuoteItemCandidateSchema>;

export type SteelQuoteItemClarificationReason =
  | 'single_high_confidence_candidate'
  | 'ai_uncertain'
  | 'multiple_plausible_candidates'
  | 'missing_required_fields'
  | 'no_candidates';

export interface SteelQuoteItemConfirmationOption {
  optionId: string;
  label: string;
  specKey: string;
  productFamily?: string;
  confidence: SteelNormalizedQuoteItemCandidate['confidence'];
  missingFields: string[];
}

export interface SteelQuoteItemCandidateDecision {
  action: 'use_candidate' | 'ask_user' | 'confirm_candidates';
  confirmationRequired: boolean;
  manualReviewRequired: boolean;
  reason: SteelQuoteItemClarificationReason;
  question?: string;
  missingFields?: string[];
  options?: SteelQuoteItemConfirmationOption[];
  selectedCandidate?: SteelNormalizedQuoteItemCandidate;
}

function toConfirmationOption(
  candidate: SteelNormalizedQuoteItemCandidate,
): SteelQuoteItemConfirmationOption {
  return {
    optionId: candidate.candidateId,
    label: candidate.displayName,
    specKey: candidate.specKey,
    productFamily: candidate.productFamily,
    confidence: candidate.confidence,
    missingFields: candidate.missingFields,
  };
}

function buildOptions(
  candidates: SteelNormalizedQuoteItemCandidate[],
  maxOptions: number,
): SteelQuoteItemConfirmationOption[] {
  return candidates.slice(0, maxOptions).map(toConfirmationOption);
}

export function resolveSteelQuoteItemCandidates(
  input: SteelQuoteItemCandidatesInput,
): SteelQuoteItemCandidateDecision {
  const parsed = steelQuoteItemCandidatesInputSchema.parse(input);
  const maxOptions = parsed.maxOptions ?? 5;

  if (parsed.candidates.length === 0) {
    return {
      action: 'ask_user',
      confirmationRequired: true,
      manualReviewRequired: true,
      reason: 'no_candidates',
      question: '請補充或確認客戶要報價的規格。',
      options: [],
    };
  }

  if (parsed.candidates.length > 1) {
    return {
      action: 'confirm_candidates',
      confirmationRequired: true,
      manualReviewRequired: false,
      reason: 'multiple_plausible_candidates',
      question: '查到多個可能規格，請使用者確認要採用哪一個。',
      options: buildOptions(parsed.candidates, maxOptions),
    };
  }

  const [candidate] = parsed.candidates;
  if (candidate.missingFields.length > 0) {
    return {
      action: 'ask_user',
      confirmationRequired: true,
      manualReviewRequired: false,
      reason: 'missing_required_fields',
      question: `請補充缺少的規格欄位：${candidate.missingFields.join('、')}。`,
      missingFields: candidate.missingFields,
      options: buildOptions(parsed.candidates, maxOptions),
    };
  }

  if (candidate.confidence !== 'high') {
    return {
      action: 'ask_user',
      confirmationRequired: true,
      manualReviewRequired: false,
      reason: 'ai_uncertain',
      question: '請確認客戶要的是哪一個規格。',
      options: buildOptions(parsed.candidates, maxOptions),
    };
  }

  return {
    action: 'use_candidate',
    confirmationRequired: false,
    manualReviewRequired: false,
    reason: 'single_high_confidence_candidate',
    selectedCandidate: candidate,
  };
}
