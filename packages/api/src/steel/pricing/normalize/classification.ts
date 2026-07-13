import { isPriceCategory } from '../categories';
import { inferPriceCategoryCandidate } from './category';

import type { SteelPriceV4WorkbookRow } from '../v4';

export interface PendingPriceCategoryProposal {
  category: string;
  subcategory: string;
}

export function getPendingPriceCategoryProposal(
  _source: SteelPriceV4WorkbookRow,
): PendingPriceCategoryProposal | undefined {
  return undefined;
}

export function applyPriceCategory(source: SteelPriceV4WorkbookRow): SteelPriceV4WorkbookRow {
  const productName = String(source.product_name ?? '');
  const inferred = inferPriceCategoryCandidate(productName);
  if (inferred) {
    return { ...source, category: inferred };
  }

  const existing = String(source.category ?? '')
    .normalize('NFKC')
    .trim();
  if (!isPriceCategory(existing)) {
    throw new Error(
      `Cannot classify Steel product category: ${productName || '(blank product_name)'}`,
    );
  }

  return { ...source, category: existing };
}
