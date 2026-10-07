import type { SteelPriceCategory } from './categories';
import type { SteelReviewRow } from './review';
import { compareSteelDecimals, convertSteelDimensionToMillimetres } from './calculation';

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
  category: SteelPriceCategory | string;
  subcategory?: string | null;
  productName?: string | null;
  specKey: string;
  thicknessMinMm?: number | string | null;
  thicknessMaxMm?: number | string | null;
  erpItemCode: string;
}

export function isGenericProcessingSubcategory(subcategory: string | null | undefined): boolean {
  const normalized = subcategory?.trim();
  return !normalized || normalized === '通用';
}

const materialCategorySet = new Set<SteelPriceCategory>([
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
  ['C型鋼', new RegExp('C型鋼|型鋼結筒', 'u')],
  ['H型鋼', new RegExp('H型鋼|H鋼', 'u')],
  ['平鐵', new RegExp('平鐵|扁鐵', 'u')],
  ['角鐵', new RegExp('角鐵|角座', 'u')],
  ['圓條', new RegExp('圓條|圓鐵|丸條', 'u')],
  ['槽鐵', new RegExp('槽鐵', 'u')],
  ['網', new RegExp('(?:鐵|點焊|菱形|浪型)?網', 'u')],
  ['門窗/門板', new RegExp('門板|門窗|捲門', 'u')],
  ['圓管', new RegExp('圓管|鐵管', 'u')],
  ['鐵板', new RegExp('鐵板|厚板|花板|板滾|滾圓|端板|喇叭桶|壓花|整平|雕花|雷射畫線', 'u')],
] as const satisfies readonly (readonly [SteelPriceCategory, RegExp])[]);

function isProcessingPriceCategory(value: string): value is ProcessingPriceCategory {
  return processingPriceCategories.some((category) => category === value);
}

export function getProcessingCandidateText(candidate: ProcessingCandidateDescriptor): string {
  const prefix = `${candidate.erpItemCode} `;
  const specText = candidate.specKey.startsWith(prefix)
    ? candidate.specKey.slice(prefix.length)
    : candidate.specKey;
  return `${candidate.productName ?? ''} ${specText}`.normalize('NFKC');
}

export function hasUnusableProcessingProductName(
  candidate: ProcessingCandidateDescriptor,
): boolean {
  return (
    candidate.category === '加工/折工' &&
    new RegExp("[\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}\\uFFFD]", 'u').test(
      candidate.productName ?? '',
    )
  );
}

function getExplicitTargets(candidate: ProcessingCandidateDescriptor): readonly SteelPriceCategory[] {
  const subcategory = candidate.subcategory as SteelPriceCategory | undefined;
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
    const text = getProcessingCandidateText(candidate);
    const match = otherTargetRules.find(([, pattern]) => pattern.test(text));
    return match ? [match[0]] : [];
  }

  return [];
}

export function isProcessingCandidateApplicable(
  candidate: ProcessingCandidateDescriptor,
  targetCategories: ReadonlySet<string>,
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

  const minimum = String(thicknessMinMm);
  const maximum = String(thicknessMaxMm);
  const equalBounds = compareSteelDecimals(minimum, maximum) === 0;
  return thicknessMm.some((value) => {
    const minimumComparison = compareSteelDecimals(value, minimum);
    const maximumComparison = compareSteelDecimals(value, maximum);
    if (minimumComparison === undefined || maximumComparison === undefined) return false;
    return equalBounds ? minimumComparison === 0 : minimumComparison >= 0 && maximumComparison < 0;
  });
}

export interface SteelProcessingMaterial {
  rowId: string;
  category: string;
  thicknessMm?: string | null;
}

export function isSteelProcessingCatalogCandidateApplicable(
  candidate: ProcessingCandidateDescriptor,
  material: SteelProcessingMaterial,
): boolean {
  const categories = new Set([material.category]);
  return isProcessingCandidateApplicable(candidate, categories) &&
    isProcessingCandidateSpecApplicable(candidate, material.thicknessMm ? [material.thicknessMm] : undefined);
}

export function steelProcessingMaterialForRow(row: SteelReviewRow): SteelProcessingMaterial {
  return {
    rowId: row.rowId,
    category: row.values['類別']?.effective ?? '',
    thicknessMm: convertSteelDimensionToMillimetres(row.values['厚度']?.effective ?? ''),
  };
}
