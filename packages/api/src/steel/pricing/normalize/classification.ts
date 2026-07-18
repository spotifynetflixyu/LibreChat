import { isPriceCategory } from '../categories';
import { inferPriceCategoryCandidate } from './category';

import type { SteelPriceV4WorkbookRow } from '../v4';

const bhPlateErpItemCodes = new Set([
  'DNB20',
  'DNB2001',
  'DNB2002',
  'DNB2003',
  'DNB30',
  'DNB3001',
  'DNB3002',
  'DNB3003',
  'DNB40',
]);

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
  const formulaCode = String(source.formula_code ?? '')
    .normalize('NFKC')
    .trim();
  const erpItemCode = String(source.erp_item_code ?? '')
    .normalize('NFKC')
    .trim();
  if (formulaCode === 'BH' && bhPlateErpItemCodes.has(erpItemCode)) {
    return { ...source, category: '鐵板' };
  }

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
