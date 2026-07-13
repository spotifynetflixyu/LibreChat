import { isPriceCategory } from '../categories';
import { inferPriceCategoryCandidate, normalizeProductNameForCategory } from './category';

import type { PriceCategory } from '../categories';
import type { SteelPriceV4Cell } from '../v4';

export interface SteelProductListRow {
  [field: string]: SteelPriceV4Cell;
  erp_item_code: SteelPriceV4Cell;
  product_name: SteelPriceV4Cell;
  category?: SteelPriceV4Cell;
}

export interface PriceCategoryReference {
  byProductName: ReadonlyMap<string, PriceCategory>;
}

export type PriceCategoryResolution =
  | {
      status: 'resolved';
      category: PriceCategory;
      source: 'reference' | 'rule';
    }
  | {
      status: 'unknown';
      reason: 'blank_product_name' | 'no_matching_rule';
    };

export interface CategoryStageReviewRow {
  erpItemCode: string;
  productName: string;
  reason: 'blank_product_name' | 'no_matching_rule';
}

export interface CategoryStageSummary {
  rowCount: number;
  changedCategoryCount: number;
  resolvedByReference: number;
  resolvedByRule: number;
  preservedPlaceholderCount: number;
  unknownCount: number;
  readyForNormalization: boolean;
}

export interface CategoryStageResult {
  rows: SteelProductListRow[];
  reviewRows: CategoryStageReviewRow[];
  summary: CategoryStageSummary;
}

function parseCellText(value: SteelPriceV4Cell): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim();
}

export function buildPriceCategoryReference(
  rows: readonly SteelProductListRow[],
): PriceCategoryReference {
  const byProductName = new Map<string, PriceCategory>();
  for (const row of rows) {
    const productName = normalizeProductNameForCategory(parseCellText(row.product_name));
    if (!productName) {
      continue;
    }
    const category = parseCellText(row.category);
    if (!isPriceCategory(category)) {
      throw new Error(`Invalid reference category for ${productName}: ${category || '(blank)'}`);
    }
    const existing = byProductName.get(productName);
    if (existing && existing !== category) {
      throw new Error(
        `Reference product_name has conflicting categories: ${productName} (${existing}, ${category})`,
      );
    }
    byProductName.set(productName, category);
  }

  return { byProductName };
}

export function resolvePriceCategory(
  productName: string,
  reference: PriceCategoryReference,
): PriceCategoryResolution {
  const normalizedName = normalizeProductNameForCategory(productName);
  if (!normalizedName) {
    return { status: 'unknown', reason: 'blank_product_name' };
  }
  const referenced = reference.byProductName.get(normalizedName);
  if (referenced) {
    return { status: 'resolved', category: referenced, source: 'reference' };
  }
  const inferred = inferPriceCategoryCandidate(normalizedName);
  return inferred
    ? { status: 'resolved', category: inferred, source: 'rule' }
    : { status: 'unknown', reason: 'no_matching_rule' };
}

export function applyCategoryStage(
  sourceRows: readonly SteelProductListRow[],
  reference: PriceCategoryReference,
): CategoryStageResult {
  const seenErpCodes = new Set<string>();
  const reviewRows: CategoryStageReviewRow[] = [];
  const summary: CategoryStageSummary = {
    rowCount: sourceRows.length,
    changedCategoryCount: 0,
    resolvedByReference: 0,
    resolvedByRule: 0,
    preservedPlaceholderCount: 0,
    unknownCount: 0,
    readyForNormalization: false,
  };

  const rows = sourceRows.map((source) => {
    const erpItemCode = parseCellText(source.erp_item_code);
    if (!erpItemCode || seenErpCodes.has(erpItemCode)) {
      throw new Error(`Category stage duplicate erp_item_code: ${erpItemCode || '(blank)'}`);
    }
    seenErpCodes.add(erpItemCode);

    const productName = parseCellText(source.product_name);
    const resolution = resolvePriceCategory(productName, reference);
    if (resolution.status === 'resolved') {
      summary[resolution.source === 'reference' ? 'resolvedByReference' : 'resolvedByRule'] += 1;
      summary.changedCategoryCount += source.category === resolution.category ? 0 : 1;
      return { ...source, category: resolution.category };
    }

    const existingCategory = parseCellText(source.category);
    if (resolution.reason === 'blank_product_name' && isPriceCategory(existingCategory)) {
      summary.preservedPlaceholderCount += 1;
      return { ...source, category: existingCategory };
    }

    summary.unknownCount += 1;
    reviewRows.push({ erpItemCode, productName, reason: resolution.reason });
    return { ...source };
  });

  summary.readyForNormalization = summary.unknownCount === 0;
  return { rows, reviewRows, summary };
}
