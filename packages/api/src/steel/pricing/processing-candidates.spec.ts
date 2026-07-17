import {
  compileProcessingKeyword,
  hasUnusableProcessingProductName,
  isProcessingCandidateApplicable,
  isProcessingCandidateSpecApplicable,
  matchesProcessingKeyword,
  matchesProcessingKeywordTerms,
} from './processing-candidates';

describe('processing price candidate applicability', () => {
  it('rejects garbled bending names containing private-use glyphs', () => {
    const candidate = {
      category: '加工/折工',
      subcategory: '一般',
      productName: '板折 \uE000 型(0.8-2.0)',
      normalizedSpecText: '板折 型 0.8-2.0',
      erpItemCode: 'BKZA010',
    };

    expect(hasUnusableProcessingProductName(candidate)).toBe(true);
    expect(isProcessingCandidateApplicable(candidate, new Set(['鐵板']))).toBe(false);
  });

  it('keeps readable bending names and limits them to plate targets', () => {
    const candidate = {
      category: '加工/折工',
      subcategory: '一般',
      productName: '鐵板折工 90度',
      normalizedSpecText: '鐵板折工 90度',
      erpItemCode: 'BEND-90',
    };

    expect(hasUnusableProcessingProductName(candidate)).toBe(false);
    expect(isProcessingCandidateApplicable(candidate, new Set(['鐵板']))).toBe(true);
    expect(isProcessingCandidateApplicable(candidate, new Set(['C型鋼']))).toBe(false);
  });

  it('matches normalized keyword terms against processing names', () => {
    const candidate = {
      category: '加工/孔',
      subcategory: '鐵板',
      productName: '鐵板雷射圓孔',
      normalizedSpecText: '鐵板 雷射 圓孔',
      erpItemCode: 'HOLE-1',
    };

    expect(matchesProcessingKeyword(candidate, '雷射 圓孔')).toBe(true);
    expect(matchesProcessingKeyword(candidate, '雷射 方孔')).toBe(false);
  });

  it('matches a precompiled keyword without changing the public matcher contract', () => {
    const candidate = {
      category: '加工/孔',
      productName: '鐵板雷射圓孔',
      normalizedSpecText: '鐵板 雷射 圓孔',
      erpItemCode: 'HOLE-1',
    };
    const terms = compileProcessingKeyword('雷射 圓孔');

    expect(matchesProcessingKeywordTerms(candidate, terms)).toBe(true);
    expect(matchesProcessingKeyword(candidate, '雷射 圓孔')).toBe(true);
  });

  it('matches multiple cutting thickness specs against structured exact and range fields', () => {
    const rangeCandidate = {
      category: '加工/切工',
      subcategory: '鐵板',
      productName: '12.0-30.0mm板切φ',
      normalizedSpecText: '12.0-30.0mm板切φ',
      erpItemCode: 'DNB2002',
      thicknessMinMm: 12,
      thicknessMaxMm: 30,
    };
    const exactCandidate = {
      ...rangeCandidate,
      erpItemCode: 'DNB3002',
      thicknessMinMm: 30,
      thicknessMaxMm: 30,
    };

    expect(isProcessingCandidateSpecApplicable(rangeCandidate, ['6', '15'])).toBe(true);
    expect(isProcessingCandidateSpecApplicable(rangeCandidate, ['6'])).toBe(false);
    expect(isProcessingCandidateSpecApplicable(rangeCandidate, ['30'])).toBe(false);
    expect(isProcessingCandidateSpecApplicable(exactCandidate, ['30'])).toBe(true);
  });

  it('keeps generic cutting prices and leaves non-cutting categories outside this matcher', () => {
    const genericCutting = {
      category: '加工/切工',
      subcategory: '通用',
      productName: '切工',
      normalizedSpecText: '切工',
      erpItemCode: 'BKZZB',
      thicknessMinMm: null,
      thicknessMaxMm: null,
    };
    const hole = {
      ...genericCutting,
      category: '加工/孔',
      thicknessMinMm: 6,
      thicknessMaxMm: 10,
    };

    expect(isProcessingCandidateSpecApplicable(genericCutting, ['15'])).toBe(true);
    expect(isProcessingCandidateSpecApplicable(hole, ['15'])).toBe(true);
  });

  it.each(['通用', '', null])(
    'treats cutting subcategory %p as a generic fallback',
    (subcategory) => {
      const candidate = {
        category: '加工/切工',
        subcategory,
        productName: '切工',
        normalizedSpecText: '切工',
        erpItemCode: 'GENERIC-CUT',
      };

      expect(isProcessingCandidateApplicable(candidate, new Set(['鐵板']))).toBe(true);
      expect(isProcessingCandidateApplicable(candidate, new Set(['網']))).toBe(true);
    },
  );

  it('rejects a cutting candidate with an incomplete structured thickness range', () => {
    const candidate = {
      category: '加工/切工',
      subcategory: '鐵板',
      productName: '切工',
      normalizedSpecText: '切工',
      erpItemCode: 'BROKEN-CUT',
      thicknessMinMm: 6,
      thicknessMaxMm: null,
    };

    expect(isProcessingCandidateSpecApplicable(candidate, ['6'])).toBe(false);
    expect(isProcessingCandidateSpecApplicable(candidate, undefined)).toBe(false);
  });
});
