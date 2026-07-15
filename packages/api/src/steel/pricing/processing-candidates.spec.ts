import {
  compileProcessingKeyword,
  hasUnusableProcessingProductName,
  isProcessingCandidateApplicable,
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
});
