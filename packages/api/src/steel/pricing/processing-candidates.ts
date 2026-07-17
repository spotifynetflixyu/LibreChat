import { normalizeSteelSpecKey } from '../normalization/spec';

import type { PriceCategory } from './enums';

const processingPriceCategoryValues = [
  '加工/切工',
  '加工/孔',
  '加工/倒角',
  '加工/開槽',
  '加工/折工',
  '加工/焊接',
  '加工/其他',
] as const;

export type ProcessingPriceCategory = (typeof processingPriceCategoryValues)[number];

export const processingPriceCategories: readonly ProcessingPriceCategory[] = Object.freeze(
  processingPriceCategoryValues,
);

export interface ProcessingCandidateDescriptor {
  category: PriceCategory | string;
  subcategory?: string | null;
  productName?: string;
  normalizedSpecText?: string;
  thicknessMinMm?: number | null;
  thicknessMaxMm?: number | null;
  erpItemCode: string;
}

export function isGenericProcessingSubcategory(subcategory: string | null | undefined): boolean {
  const normalized = subcategory?.trim();
  return !normalized || normalized === '通用';
}

const materialCategorySet = new Set<PriceCategory>([
  '圓條',
  '網',
  '鐵板',
  'C型鋼',
  '板/浪板',
  '方鐵',
  'H型鋼',
  'T型鋼',
  '平鐵',
  '角鐵',
  '鋼筋',
  '圓管',
  '鐵軌',
  '槽鐵',
  'I型鋼/工字鐵',
  '方管',
  '扁方管',
  '門窗/門板',
  '五金/配件',
]);

const otherTargetRules = Object.freeze([
  ['C型鋼', /C型鋼|型鋼結筒/u],
  ['H型鋼', /H型鋼|H鋼/u],
  ['平鐵', /平鐵|扁鐵/u],
  ['角鐵', /角鐵|角座/u],
  ['圓條', /圓條|圓鐵|丸條/u],
  ['槽鐵', /槽鐵/u],
  ['網', /(?:鐵|點焊|菱形|浪型)?網/u],
  ['門窗/門板', /門板|門窗|捲門/u],
  ['圓管', /圓管|鐵管/u],
  ['鐵板', /鐵板|厚板|花板|板滾|滾圓|端板|喇叭桶|壓花|整平|雕花|雷射畫線/u],
] as const satisfies readonly (readonly [PriceCategory, RegExp])[]);

function isProcessingPriceCategory(value: string): value is ProcessingPriceCategory {
  return processingPriceCategories.some((category) => category === value);
}

function getCandidateText(candidate: ProcessingCandidateDescriptor): string {
  return `${candidate.productName ?? ''} ${candidate.normalizedSpecText ?? ''}`.normalize('NFKC');
}

export function hasUnusableProcessingProductName(
  candidate: ProcessingCandidateDescriptor,
): boolean {
  return (
    candidate.category === '加工/折工' &&
    /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFFFD]/u.test(
      candidate.productName ?? '',
    )
  );
}

function getExplicitTargets(candidate: ProcessingCandidateDescriptor): readonly PriceCategory[] {
  const subcategory = candidate.subcategory as PriceCategory | undefined;
  if (subcategory && materialCategorySet.has(subcategory)) {
    return [subcategory];
  }

  if (candidate.category === '加工/折工') {
    return ['鐵板'];
  }
  if (candidate.category === '加工/開槽') {
    return ['鐵板', 'H型鋼'];
  }
  if (candidate.category === '加工/孔') {
    if (candidate.subcategory === '門') {
      return ['門窗/門板'];
    }
    if (candidate.subcategory === '接頭' || candidate.subcategory === '五金') {
      return ['五金/配件'];
    }
  }
  if (candidate.category === '加工/其他') {
    const text = getCandidateText(candidate);
    const match = otherTargetRules.find(([, pattern]) => pattern.test(text));
    return match ? [match[0]] : [];
  }

  return [];
}

export function isProcessingCandidateApplicable(
  candidate: ProcessingCandidateDescriptor,
  targetCategories: ReadonlySet<PriceCategory>,
): boolean {
  if (!isProcessingPriceCategory(candidate.category)) {
    return false;
  }
  if (hasUnusableProcessingProductName(candidate)) {
    return false;
  }

  const explicitTargets = getExplicitTargets(candidate);
  if (explicitTargets.length > 0) {
    return explicitTargets.some((category) => targetCategories.has(category));
  }

  return (
    (candidate.category === '加工/切工' && isGenericProcessingSubcategory(candidate.subcategory)) ||
    candidate.subcategory === '通用' ||
    candidate.category === '加工/焊接'
  );
}

export function isProcessingCandidateSpecApplicable(
  candidate: ProcessingCandidateDescriptor,
  thicknessMm: readonly string[] | undefined,
): boolean {
  if (candidate.category !== '加工/切工') {
    return true;
  }

  const { thicknessMinMm, thicknessMaxMm } = candidate;
  if (thicknessMinMm == null && thicknessMaxMm == null) {
    return true;
  }
  if (thicknessMinMm == null || thicknessMaxMm == null) {
    return false;
  }
  if (!thicknessMm) {
    return true;
  }

  return thicknessMm.some((value) => {
    const requested = Number(value);
    if (!Number.isFinite(requested)) {
      return false;
    }
    if (thicknessMinMm === thicknessMaxMm) {
      return requested === thicknessMinMm;
    }

    return thicknessMinMm <= requested && requested < thicknessMaxMm;
  });
}

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

  const text =
    `${candidate.erpItemCode} ${candidate.productName ?? ''} ${candidate.normalizedSpecText ?? ''}`
      .normalize('NFKC')
      .replace(/[＊*×]/gu, 'x');

  return terms.every((term) => text.includes(term));
}
