import { calculateHoleFee } from './holes';

describe('calculateHoleFee', () => {
  it('calculates oval hole fees from a reviewed non-round hole price', () => {
    const result = calculateHoleFee({
      holeGroups: [
        {
          holeType: 'oval',
          lengthMm: 30,
          widthMm: 15,
          countPerPiece: 2,
          pieceQuantityMultiplier: 4,
          confidence: 'high',
          sourceRefs: [],
        },
      ],
      price: {
        holeType: 'oval',
        lengthMm: 30,
        widthMm: 15,
        unit: 'hole',
        unitPrice: 18,
        valueState: 'confirmed',
        currency: 'TWD',
        sourceRefs: [],
      },
    });

    expect(result).toEqual({
      status: 'confirmed',
      totalHoleCount: 8,
      unitPrice: 18,
      currency: 'TWD',
      confirmedAmount: 144,
      manualReviewRequired: false,
      lowConfidenceReasons: [],
      sourceRefs: [],
    });
  });

  it('returns unconfirmed when a non-round hole has no reviewed price', () => {
    const result = calculateHoleFee({
      holeGroups: [
        {
          holeType: 'rectangular',
          lengthMm: 45,
          widthMm: 18,
          countPerPiece: 1,
          pieceQuantityMultiplier: 6,
          confidence: 'high',
          sourceRefs: [],
        },
      ],
      price: null,
    });

    expect(result).toMatchObject({
      status: 'unconfirmed',
      totalHoleCount: 6,
      unitPrice: null,
      confirmedAmount: null,
      manualReviewRequired: true,
      lowConfidenceReasons: ['hole_price_missing'],
    });
  });

  it('requires manual review when hole evidence is low confidence', () => {
    const result = calculateHoleFee({
      holeGroups: [
        {
          holeType: 'round',
          diameterMm: 22,
          countPerPiece: 4,
          pieceQuantityMultiplier: 3,
          confidence: 'low',
          sourceRefs: [],
        },
      ],
      price: {
        holeType: 'round',
        diameterMm: 22,
        unit: 'hole',
        unitPrice: 6,
        valueState: 'confirmed',
        currency: 'TWD',
        sourceRefs: [],
      },
    });

    expect(result).toMatchObject({
      status: 'estimate',
      totalHoleCount: 12,
      unitPrice: 6,
      confirmedAmount: null,
      estimatedAmount: 72,
      manualReviewRequired: true,
      lowConfidenceReasons: ['hole_group_low_confidence'],
    });
  });
});
