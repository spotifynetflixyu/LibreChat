import {
  getLimit,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
  parseValueState,
} from './types';

import type {
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
  SteelValueState,
} from './types';

interface SteelPriceItemRow {
  id: string | number;
  erp_item_code: string | null;
  category_id: string | number | null;
  customer_tier_id: string | number | null;
  customer_tier_code: string | null;
  customer_tier_name: string | null;
  spec_key: string;
  product_name: string;
  catalog_family: string | null;
  material_grade: string | null;
  unit: string;
  unit_price: string | number | null;
  product_price_unit_weight: string | number | null;
  product_price_unit_weight_unit: string | null;
  currency: string;
  value_state: string;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}

export interface SteelPriceItem extends SteelSourceBackedRecord {
  id: number;
  erpItemCode?: string;
  categoryId: number | null;
  customerTierId: number | null;
  customerTierCode?: string;
  customerTierName?: string;
  specKey: string;
  productName: string;
  catalogFamily?: string;
  materialGrade?: string;
  unit: string;
  unitPrice: number | null;
  productPriceUnitWeight: number | null;
  productPriceUnitWeightUnit?: string;
  currency: string;
  valueState: SteelValueState;
  reviewState: SteelReviewState;
  active: boolean;
  sourceRefs: SteelSourceRef[];
}

export interface SearchSteelPriceItemsInput {
  specKey?: string;
  specKeyContains?: string;
  productName?: string;
  productNames?: readonly string[];
  catalogFamilies?: readonly string[];
  customerTierId?: number;
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

interface SteelProductNameSearch {
  productNameTerms: string[];
  specKeyContains?: string;
}

function normalizeSpecSize(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[＊*×]/g, 'x')
    .replace(/^l/i, '');
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.trim() !== ''))];
}

function addTextFacetFilter(
  where: string[],
  values: SteelSqlParameter[],
  column: string,
  matches: readonly string[] | undefined,
) {
  const uniqueMatches = uniqueNonEmpty(matches);

  if (uniqueMatches.length === 0) {
    return;
  }

  const placeholders = uniqueMatches.map((match) => {
    values.push(match);
    return `$${values.length}`;
  });

  where.push(`${column} IN (${placeholders.join(', ')})`);
}

function getProductNameSearches(input: SearchSteelPriceItemsInput): SteelProductNameSearch[] {
  return uniqueNonEmpty([
    ...(input.productName ? [input.productName] : []),
    ...(input.productNames ?? []),
  ]).map(getProductNameSearch);
}

function addProductNameSearchFilter(
  where: string[],
  values: SteelSqlParameter[],
  searches: readonly SteelProductNameSearch[],
  includeDerivedSpecKey: boolean,
) {
  if (searches.length === 0) {
    return;
  }

  const searchClauses = searches.map((search) => {
    const termClauses = search.productNameTerms.map((productNameTerm) => {
      values.push(`%${productNameTerm}%`);
      return `product_name ILIKE $${values.length}`;
    });

    if (includeDerivedSpecKey && search.specKeyContains) {
      values.push(`%${search.specKeyContains}%`);
      termClauses.push(`spec_key ILIKE $${values.length}`);
    }

    return `(${termClauses.join(' AND ')})`;
  });

  where.push(`(${searchClauses.join(' OR ')})`);
}

function getProductNameSearch(productName: string): SteelProductNameSearch {
  const value = productName.trim();
  const sizeMatch = value.match(/\bL?\s*\d+(?:\.\d+)?\s*[xX*＊×]\s*\d+(?:\.\d+)?\b/u);
  const productNameOnly = sizeMatch ? value.replace(sizeMatch[0], '').trim() || value : value;
  const oralAngleProductTerms: Record<string, string[]> = {
    錏角鐵: ['錏', '角鐵'],
    鍍鋅角鐵: ['鍍鋅', '角鐵'],
  };

  return {
    productNameTerms: oralAngleProductTerms[productNameOnly] ?? [productNameOnly],
    ...(sizeMatch ? { specKeyContains: normalizeSpecSize(sizeMatch[0]) } : {}),
  };
}

function toPriceItem(row: SteelPriceItemRow): SteelPriceItem {
  return {
    id: parseRequiredNumber(row.id),
    erpItemCode: parseNullableString(row.erp_item_code),
    categoryId: parseNullableNumber(row.category_id),
    customerTierId: parseNullableNumber(row.customer_tier_id),
    customerTierCode: parseNullableString(row.customer_tier_code),
    customerTierName: parseNullableString(row.customer_tier_name),
    specKey: row.spec_key,
    productName: row.product_name,
    catalogFamily: parseNullableString(row.catalog_family),
    materialGrade: parseNullableString(row.material_grade),
    unit: row.unit,
    unitPrice: parseNullableNumber(row.unit_price),
    productPriceUnitWeight: parseNullableNumber(row.product_price_unit_weight),
    productPriceUnitWeightUnit: parseNullableString(row.product_price_unit_weight_unit),
    currency: row.currency,
    valueState: parseValueState(row.value_state),
    reviewState: parseReviewState(row.review_state),
    active: row.active,
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function searchSteelPriceItems(
  client: SteelRepositoryClient,
  input: SearchSteelPriceItemsInput,
): Promise<SteelPriceItem[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];
  const productNameSearches = getProductNameSearches(input);

  if (!input.includeInactive) {
    where.push('active = true');
  }

  if (input.specKey) {
    values.push(input.specKey);
    where.push(`spec_key = $${values.length}`);
  }

  if (input.specKeyContains) {
    values.push(`%${input.specKeyContains}%`);
    where.push(`spec_key ILIKE $${values.length}`);
  }

  addProductNameSearchFilter(
    where,
    values,
    productNameSearches,
    !input.specKey && !input.specKeyContains,
  );

  addTextFacetFilter(where, values, 'catalog_family', input.catalogFamilies);

  if (input.customerTierId !== undefined) {
    values.push(input.customerTierId);
    where.push(`(customer_tier_id = $${values.length} OR customer_tier_id IS NULL)`);
  }

  values.push(getLimit(input.limit));

  const result = await client.query<SteelPriceItemRow>(
    `
SELECT
  id,
  erp_item_code,
  category_id,
  customer_tier_id,
  customer_tier_code,
  customer_tier_name,
  spec_key,
  product_name,
  catalog_family,
  material_grade,
  unit,
  unit_price,
  product_price_unit_weight,
  product_price_unit_weight_unit,
  currency,
  value_state,
  review_state,
  active,
  source_refs
FROM (
  SELECT
    price_item.*,
    tier.code AS customer_tier_code,
    tier.name AS customer_tier_name
  FROM steel.price_items AS price_item
  LEFT JOIN steel.customer_tiers AS tier ON tier.id = price_item.customer_tier_id
) AS price_item
WHERE ${where.join('\n  AND ')}
ORDER BY
  CASE WHEN customer_tier_id IS NULL THEN 1 ELSE 0 END,
  product_name ASC,
  id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toPriceItem);
}
