import { isProcessingCandidateSpecApplicable } from './processing';

const cutting = {
  category: '加工/切工', subcategory: '通用', erpItemCode: 'CUT-1', specKey: 'Cutting',
  thicknessMinMm: '9007199254740992', thicknessMaxMm: '9007199254740993',
};

describe('processing catalog material applicability', () => {
  it('keeps exact inclusive minimum and exclusive maximum thickness boundaries', () => {
    expect(isProcessingCandidateSpecApplicable(cutting, ['9007199254740992'])).toBe(true);
    expect(isProcessingCandidateSpecApplicable(cutting, ['9007199254740993'])).toBe(false);
    expect(isProcessingCandidateSpecApplicable({ ...cutting, thicknessMaxMm: '9007199254740992' }, ['9007199254740992'])).toBe(true);
  });
});
