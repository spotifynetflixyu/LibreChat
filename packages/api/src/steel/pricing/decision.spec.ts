import { rankSteelPriceCandidates } from './decision';

describe('rankSteelPriceCandidates', () => {
  it('treats zero from product price data as no price', () => {
    const result = rankSteelPriceCandidates({
      productFamily: 'C型鋼',
      chargeType: 'material',
      candidates: [
        {
          candidateId: 'price-zero',
          label: 'C150 材料價',
          specKey: 'C150',
          unit: 'kg',
          unitPrice: 0,
          valueState: 'confirmed',
          matchType: 'exact',
          sourceRefs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              sourceFile: 'docs/reference/產品價格.xlsx',
              canonicalKey: 'unit_price',
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      action: 'no_price',
      confirmationRequired: false,
      manualReviewRequired: true,
      reason: 'no_usable_price',
      selectedCandidate: undefined,
      options: [],
      rejectedCandidates: [
        {
          candidateId: 'price-zero',
          reason: 'product_price_zero_is_missing',
        },
      ],
      skipRemainderCalculation: false,
    });
  });

  it('accepts cutting zero only when an AI-selected lesson confirms the free charge', () => {
    const result = rankSteelPriceCandidates({
      productFamily: 'C型鋼',
      chargeType: 'cutting',
      selectedCalculationRule: {
        ruleId: 'c-type-cutting-free',
        source: 'ai_selected_lesson',
        appliesToChargeTypes: ['cutting'],
        effect: 'true_zero_charge',
        confidence: 'high',
        skipRemainderCalculation: true,
        sourceRefs: [
          {
            channel: 'memory',
            factType: 'calculation_lesson',
            canonicalKey: 'c_type_cutting_free',
          },
        ],
      },
      candidates: [
        {
          candidateId: 'c-cut-free',
          label: 'C型鋼切工不收費',
          specKey: 'C150',
          unit: 'piece',
          unitPrice: 0,
          valueState: 'confirmed',
          matchType: 'exact',
          sourceRefs: [
            {
              channel: 'admin_review',
              factType: 'cutting_price',
              canonicalKey: 'cutting_unit_price',
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      action: 'use_price',
      confirmationRequired: false,
      manualReviewRequired: false,
      reason: 'calculation_rule_true_zero',
      skipRemainderCalculation: true,
      calculationRule: {
        ruleId: 'c-type-cutting-free',
        source: 'ai_selected_lesson',
      },
      selectedCandidate: {
        candidateId: 'c-cut-free',
        unitPrice: 0,
        valueState: 'true_zero',
      },
    });
  });

  it('still rejects C-type cutting zero when the zero only comes from product price data', () => {
    const result = rankSteelPriceCandidates({
      productFamily: 'C型鋼',
      chargeType: 'cutting',
      candidates: [
        {
          candidateId: 'c-cut-product-zero',
          label: '產品價格 C型鋼切工 0',
          specKey: 'C150',
          unit: 'piece',
          unitPrice: 0,
          valueState: 'confirmed',
          matchType: 'exact',
          sourceRefs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              sourceFile: 'docs/reference/產品價格.xlsx',
              canonicalKey: 'cutting_unit_price',
            },
          ],
        },
      ],
    });

    expect(result.action).toBe('no_price');
    expect(result.rejectedCandidates).toEqual([
      {
        candidateId: 'c-cut-product-zero',
        reason: 'product_price_zero_is_missing',
      },
    ]);
  });

  it('accepts hole zero only when a memory rule confirms the free charge', () => {
    const result = rankSteelPriceCandidates({
      productFamily: 'C型鋼',
      chargeType: 'hole',
      selectedCalculationRule: {
        ruleId: 'c-type-hole-free',
        source: 'memory',
        appliesToChargeTypes: ['hole'],
        effect: 'true_zero_charge',
        confidence: 'high',
        skipRemainderCalculation: true,
        sourceRefs: [],
      },
      candidates: [
        {
          candidateId: 'c-hole-free',
          label: 'C型鋼孔加工不收費',
          specKey: 'C150',
          unit: 'piece',
          unitPrice: 0,
          valueState: 'confirmed',
          matchType: 'exact',
          sourceRefs: [],
        },
      ],
    });

    expect(result).toMatchObject({
      action: 'use_price',
      reason: 'calculation_rule_true_zero',
      skipRemainderCalculation: true,
      selectedCandidate: {
        unitPrice: 0,
        valueState: 'true_zero',
      },
    });
  });

  it('does not treat C-type zero cutting prices as confirmed without a selected calculation rule', () => {
    const result = rankSteelPriceCandidates({
      productFamily: 'C型鋼',
      chargeType: 'cutting',
      candidates: [
        {
          candidateId: 'c-cut-zero',
          label: 'C型鋼切工 0',
          specKey: 'C150',
          unit: 'piece',
          unitPrice: 0,
          valueState: 'confirmed',
          matchType: 'exact',
          sourceRefs: [],
        },
      ],
    });

    expect(result.action).toBe('no_price');
    expect(result.rejectedCandidates).toEqual([
      {
        candidateId: 'c-cut-zero',
        reason: 'zero_price_requires_calculation_rule',
      },
    ]);
  });

  it('rejects zero price when the selected calculation rule is not high confidence', () => {
    const result = rankSteelPriceCandidates({
      productFamily: 'C型鋼',
      chargeType: 'hole',
      selectedCalculationRule: {
        ruleId: 'c-type-hole-free',
        source: 'ai_selected_lesson',
        appliesToChargeTypes: ['hole'],
        effect: 'true_zero_charge',
        confidence: 'medium',
        skipRemainderCalculation: true,
        sourceRefs: [],
      },
      candidates: [
        {
          candidateId: 'c-hole-zero',
          label: 'C型鋼孔加工 0',
          specKey: 'C150',
          unit: 'piece',
          unitPrice: 0,
          valueState: 'confirmed',
          matchType: 'exact',
          sourceRefs: [],
        },
      ],
    });

    expect(result.action).toBe('no_price');
    expect(result.rejectedCandidates).toEqual([
      {
        candidateId: 'c-hole-zero',
        reason: 'calculation_rule_not_confirmed',
      },
    ]);
  });

  it('uses a high-confidence user price override as an adjustable calculation parameter', () => {
    const result = rankSteelPriceCandidates({
      productFamily: 'C型鋼',
      chargeType: 'cutting',
      selectedCalculationRule: {
        ruleId: 'c-type-cutting-formula',
        source: 'memory',
        formulaCode: 'cutting_fee_v1',
        appliesToChargeTypes: ['cutting'],
        effect: 'normal_formula',
        confidence: 'high',
        skipRemainderCalculation: true,
        defaultParameters: [
          {
            parameterKey: 'unitPrice',
            valueType: 'money',
            value: 0,
            unit: 'TWD/piece',
            sourceRefs: [
              {
                channel: 'memory',
                factType: 'calculation_default',
                canonicalKey: 'c_type_cutting_default_unit_price',
              },
            ],
          },
        ],
        parameterOverrides: [
          {
            parameterKey: 'unitPrice',
            valueType: 'money',
            value: 25,
            unit: 'TWD/piece',
            source: 'user_message',
            confidence: 'high',
            sourceRefs: [
              {
                channel: 'conversation',
                factType: 'quote_specific_override',
                locator: 'message=latest',
              },
            ],
          },
        ],
        sourceRefs: [],
      },
      candidates: [
        {
          candidateId: 'c-cut-missing',
          label: 'C型鋼切工',
          specKey: 'C150',
          unit: 'piece',
          unitPrice: null,
          valueState: 'unknown',
          matchType: 'exact',
          sourceRefs: [],
        },
      ],
    });

    expect(result).toMatchObject({
      action: 'use_price',
      reason: 'calculation_parameter_override',
      skipRemainderCalculation: true,
      selectedCandidate: {
        candidateId: 'c-cut-missing',
        unitPrice: 25,
        valueState: 'confirmed',
      },
      calculationRule: {
        ruleId: 'c-type-cutting-formula',
        formulaCode: 'cutting_fee_v1',
        parameterOverrides: [
          {
            parameterKey: 'unitPrice',
            value: 25,
            source: 'user_message',
          },
        ],
      },
    });
  });

  it('rejects an uncertain user price override instead of silently using it', () => {
    const result = rankSteelPriceCandidates({
      productFamily: 'C型鋼',
      chargeType: 'cutting',
      selectedCalculationRule: {
        ruleId: 'c-type-cutting-formula',
        source: 'memory',
        formulaCode: 'cutting_fee_v1',
        appliesToChargeTypes: ['cutting'],
        effect: 'normal_formula',
        confidence: 'high',
        skipRemainderCalculation: true,
        parameterOverrides: [
          {
            parameterKey: 'unitPrice',
            valueType: 'money',
            value: 25,
            unit: 'TWD/piece',
            source: 'user_message',
            confidence: 'medium',
            sourceRefs: [],
          },
        ],
        sourceRefs: [],
      },
      candidates: [
        {
          candidateId: 'c-cut-missing',
          label: 'C型鋼切工',
          specKey: 'C150',
          unit: 'piece',
          unitPrice: null,
          valueState: 'unknown',
          matchType: 'exact',
          sourceRefs: [],
        },
      ],
    });

    expect(result.action).toBe('no_price');
    expect(result.rejectedCandidates).toEqual([
      {
        candidateId: 'c-cut-missing',
        reason: 'parameter_override_not_confirmed',
      },
    ]);
  });

  it('asks the user to confirm when multiple positive candidates remain usable', () => {
    const result = rankSteelPriceCandidates({
      productFamily: '角鐵',
      chargeType: 'material',
      candidates: [
        {
          candidateId: 'angle-a',
          label: 'L38x38x2.5 A',
          specKey: 'L38x38x2.5_A',
          unit: 'kg',
          unitPrice: 31,
          valueState: 'confirmed',
          matchType: 'exact',
          sourceRefs: [],
        },
        {
          candidateId: 'angle-b',
          label: 'L38x38x2.5 B',
          specKey: 'L38x38x2.5_B',
          unit: 'kg',
          unitPrice: 33,
          valueState: 'confirmed',
          matchType: 'alias',
          sourceRefs: [],
        },
      ],
    });

    expect(result).toMatchObject({
      action: 'confirm_candidates',
      confirmationRequired: true,
      manualReviewRequired: false,
      reason: 'multiple_usable_candidates',
      skipRemainderCalculation: false,
    });
    expect(result.options.map((option) => option.optionId)).toEqual(['angle-a', 'angle-b']);
  });
});
