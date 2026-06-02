import type { SteelSourceRef } from '../repositories';

export type SteelHoleType =
  | 'round'
  | 'oval'
  | 'long'
  | 'rectangular'
  | 'bolt'
  | 'punched'
  | 'custom'
  | 'unknown';

export type SteelCalculationConfidence = 'high' | 'medium' | 'low';
export type SteelHoleFeeStatus = 'confirmed' | 'estimate' | 'unconfirmed';
export type SteelChargeValueState = 'unknown' | 'confirmed' | 'true_zero' | 'estimate';

export interface SteelHoleGroup {
  holeType: SteelHoleType;
  diameterMm?: number;
  lengthMm?: number;
  widthMm?: number;
  dimensionLabel?: string;
  countPerPiece: number;
  pieceQuantityMultiplier: number;
  confidence: SteelCalculationConfidence;
  sourceRefs: SteelSourceRef[];
}

export interface SteelHoleFeePrice {
  holeType: SteelHoleType;
  diameterMm?: number;
  lengthMm?: number;
  widthMm?: number;
  dimensionLabel?: string;
  unit: 'hole' | string;
  unitPrice: number | null;
  valueState: SteelChargeValueState;
  currency: string;
  sourceRefs: SteelSourceRef[];
}

export interface SteelHoleFeeInput {
  holeGroups: SteelHoleGroup[];
  price: SteelHoleFeePrice | null;
}

export interface SteelHoleFeeResult {
  status: SteelHoleFeeStatus;
  totalHoleCount: number;
  unitPrice: number | null;
  currency?: string;
  confirmedAmount: number | null;
  estimatedAmount?: number;
  manualReviewRequired: boolean;
  lowConfidenceReasons: string[];
  sourceRefs: SteelSourceRef[];
}

function getTotalHoleCount(holeGroups: SteelHoleGroup[]): number {
  return holeGroups.reduce(
    (total, group) => total + group.countPerPiece * group.pieceQuantityMultiplier,
    0,
  );
}

function getSourceRefs(input: SteelHoleFeeInput): SteelSourceRef[] {
  const groupRefs = input.holeGroups.flatMap((group) => group.sourceRefs);
  return input.price ? [...groupRefs, ...input.price.sourceRefs] : groupRefs;
}

function hasLowConfidenceGroup(holeGroups: SteelHoleGroup[]): boolean {
  return holeGroups.some((group) => group.confidence !== 'high');
}

export function calculateHoleFee(input: SteelHoleFeeInput): SteelHoleFeeResult {
  const totalHoleCount = getTotalHoleCount(input.holeGroups);
  const sourceRefs = getSourceRefs(input);
  const lowConfidenceReasons: string[] = [];

  if (hasLowConfidenceGroup(input.holeGroups)) {
    lowConfidenceReasons.push('hole_group_low_confidence');
  }

  if (!input.price || input.price.unitPrice === null || input.price.valueState === 'unknown') {
    lowConfidenceReasons.push('hole_price_missing');

    return {
      status: 'unconfirmed',
      totalHoleCount,
      unitPrice: null,
      confirmedAmount: null,
      manualReviewRequired: true,
      lowConfidenceReasons,
      sourceRefs,
    };
  }

  const amount = totalHoleCount * input.price.unitPrice;

  if (lowConfidenceReasons.length > 0) {
    return {
      status: 'estimate',
      totalHoleCount,
      unitPrice: input.price.unitPrice,
      currency: input.price.currency,
      confirmedAmount: null,
      estimatedAmount: amount,
      manualReviewRequired: true,
      lowConfidenceReasons,
      sourceRefs,
    };
  }

  return {
    status: 'confirmed',
    totalHoleCount,
    unitPrice: input.price.unitPrice,
    currency: input.price.currency,
    confirmedAmount: amount,
    manualReviewRequired: false,
    lowConfidenceReasons,
    sourceRefs,
  };
}
