import { resolveSteelQuoteItemCandidates } from './clarify';

describe('resolveSteelQuoteItemCandidates', () => {
  it('allows one high-confidence complete AI candidate to proceed', () => {
    const result = resolveSteelQuoteItemCandidates({
      originalText: '鍍鋅 C150 3.0 6M 10支',
      candidates: [
        {
          candidateId: 'c150',
          displayName: '鍍鋅 C150x50x20x3.0 6M',
          specKey: 'C150x50x20x3.0',
          productFamily: 'C型鋼',
          confidence: 'high',
          missingFields: [],
          sourceRefs: [
            {
              channel: 'quote_evidence',
              factType: 'quote_item_spec',
              locator: 'message:1',
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      action: 'use_candidate',
      confirmationRequired: false,
      manualReviewRequired: false,
      selectedCandidate: {
        candidateId: 'c150',
        displayName: '鍍鋅 C150x50x20x3.0 6M',
        specKey: 'C150x50x20x3.0',
        productFamily: 'C型鋼',
        confidence: 'high',
        missingFields: [],
        sourceRefs: [
          {
            channel: 'quote_evidence',
            factType: 'quote_item_spec',
            locator: 'message:1',
          },
        ],
      },
      reason: 'single_high_confidence_candidate',
    });
  });

  it('asks the user when AI confidence is not high', () => {
    const result = resolveSteelQuoteItemCandidates({
      originalText: '黑圓管 1英半',
      candidates: [
        {
          candidateId: 'pipe-48',
          displayName: '黑圓管 48.3mm',
          specKey: 'black_round_pipe_48.3',
          productFamily: '圓管',
          confidence: 'medium',
          missingFields: [],
          sourceRefs: [],
        },
      ],
    });

    expect(result).toMatchObject({
      action: 'ask_user',
      confirmationRequired: true,
      manualReviewRequired: false,
      reason: 'ai_uncertain',
      question: '請確認客戶要的是哪一個規格。',
      options: [
        {
          optionId: 'pipe-48',
          label: '黑圓管 48.3mm',
          specKey: 'black_round_pipe_48.3',
          confidence: 'medium',
        },
      ],
    });
  });

  it('asks the user to choose when multiple plausible candidates exist', () => {
    const result = resolveSteelQuoteItemCandidates({
      originalText: 'L38 2.5 2米 26支',
      candidates: [
        {
          candidateId: 'angle-38',
          displayName: '鍍鋅角鐵 L38x38x2.5',
          specKey: 'L38x38x2.5_galvanized',
          productFamily: '角鐵',
          confidence: 'high',
          missingFields: [],
          sourceRefs: [],
        },
        {
          candidateId: 'flat-38',
          displayName: '鍍鋅扁鐵 38x2.5',
          specKey: 'flat_38x2.5_galvanized',
          productFamily: '扁鐵',
          confidence: 'high',
          missingFields: [],
          sourceRefs: [],
        },
      ],
    });

    expect(result).toMatchObject({
      action: 'confirm_candidates',
      confirmationRequired: true,
      manualReviewRequired: false,
      reason: 'multiple_plausible_candidates',
      question: '查到多個可能規格，請使用者確認要採用哪一個。',
    });
    expect(result.options?.map((option) => option.optionId)).toEqual(['angle-38', 'flat-38']);
  });

  it('asks targeted missing-field questions before pricing', () => {
    const result = resolveSteelQuoteItemCandidates({
      originalText: 'C150 10支',
      candidates: [
        {
          candidateId: 'c150',
          displayName: 'C150',
          specKey: 'C150',
          productFamily: 'C型鋼',
          confidence: 'high',
          missingFields: ['thicknessMm', 'lengthM'],
          sourceRefs: [],
        },
      ],
    });

    expect(result).toMatchObject({
      action: 'ask_user',
      confirmationRequired: true,
      manualReviewRequired: false,
      reason: 'missing_required_fields',
      missingFields: ['thicknessMm', 'lengthM'],
      question: '請補充缺少的規格欄位：thicknessMm、lengthM。',
    });
  });

  it('bounds confirmation options so tool output stays compact', () => {
    const result = resolveSteelQuoteItemCandidates({
      originalText: 'C型鋼',
      maxOptions: 3,
      candidates: Array.from({ length: 5 }, (_, index) => ({
        candidateId: `candidate-${index + 1}`,
        displayName: `候選 ${index + 1}`,
        specKey: `C${index + 1}`,
        productFamily: 'C型鋼',
        confidence: 'high' as const,
        missingFields: [],
        sourceRefs: [],
      })),
    });

    expect(result.action).toBe('confirm_candidates');
    expect(result.options).toHaveLength(3);
  });
});
