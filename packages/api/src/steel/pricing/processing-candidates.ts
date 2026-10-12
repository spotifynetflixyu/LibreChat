import { getProcessingCandidateText } from 'librechat-data-provider';
import type { ProcessingCandidateDescriptor } from 'librechat-data-provider';
import { normalizeSteelSpecKey } from '../normalization/spec';

export {
  processingPriceCategories,
  isGenericProcessingSubcategory,
  getProcessingCandidateText,
  hasUnusableProcessingProductName,
  isProcessingCandidateApplicable,
  isProcessingCandidateSpecApplicable,
} from 'librechat-data-provider';
export type { ProcessingPriceCategory, ProcessingCandidateDescriptor } from 'librechat-data-provider';

export function matchesProcessingKeyword(
  candidate: ProcessingCandidateDescriptor,
  keyword: string | undefined,
): boolean {
  return matchesProcessingKeywordTerms(candidate, compileProcessingKeyword(keyword));
}

export function compileProcessingKeyword(
  keyword: string | undefined,
): readonly string[] | undefined {
  if (!keyword) {
    return undefined;
  }

  return keyword
    .normalize('NFKC')
    .replace(/[＊*×]/gu, 'x')
    .trim()
    .split(/\s+/u)
    .map((term) => normalizeSteelSpecKey(term) ?? term)
    .filter(Boolean);
}

export function matchesProcessingKeywordTerms(
  candidate: ProcessingCandidateDescriptor,
  terms: readonly string[] | undefined,
): boolean {
  if (!terms) {
    return true;
  }

  const text = `${candidate.erpItemCode} ${getProcessingCandidateText(candidate)}`
    .normalize('NFKC')
    .replace(/[＊*×]/gu, 'x');

  return terms.every((term) => text.includes(term));
}
