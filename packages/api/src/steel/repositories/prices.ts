import {
  getLimit,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
  parseValueState,
} from './types';
import { normalizeSteelSpecKey } from '../normalization/spec';

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
  unfiltered?: boolean;
  specKey?: string;
  productName?: string;
  productNames?: readonly string[];
  erpItemCodes?: readonly string[];
  catalogFamilies?: readonly string[];
  customerTierId?: number;
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
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

function getDiscoverySearchTerms(input: SearchSteelPriceItemsInput): string[] {
  return uniqueNonEmpty([
    input.productName,
    ...(input.productNames ?? []),
    ...(input.erpItemCodes ?? []),
  ].filter((value): value is string => value !== undefined));
}

function getSpecKeyContainsTerms(input: SearchSteelPriceItemsInput): string[] {
  return uniqueNonEmpty(
    getDiscoverySearchTerms(input).map((term) => {
      const normalizedTerm = normalizeSteelSpecKey(term);

      return normalizedTerm || term;
    }),
  );
}

function addDiscoverySearchFilter(
  where: string[],
  values: SteelSqlParameter[],
  input: SearchSteelPriceItemsInput,
): string[] {
  const clauses: string[] = [];
  const scoreExpressions: string[] = [];

  getSpecKeyContainsTerms(input).forEach((term) => {
    values.push(`%${term}%`);
    const placeholder = `$${values.length}`;
    const matchExpression = `spec_key ILIKE ${placeholder}`;
    scoreExpressions.push(`CASE WHEN ${matchExpression} THEN 0 ELSE 1 END`);
    clauses.push(matchExpression);
  });

  if (clauses.length > 0) {
    where.push(`(${clauses.join(' OR ')})`);
  }

  return scoreExpressions;
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
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];

  if (!input.unfiltered || input.reviewState !== undefined) {
    values.push(input.reviewState ?? 'reviewed');
    where.push(`review_state = $${values.length}`);
  }

  if (input.includeInactive === false || (!input.unfiltered && !input.includeInactive)) {
    where.push('active = true');
  }

  if (input.specKey) {
    values.push(input.specKey);
    where.push(`spec_key = $${values.length}`);
  }

  const discoveryScoreExpressions = addDiscoverySearchFilter(where, values, input);
  const discoveryScore =
    discoveryScoreExpressions.length > 0 ? discoveryScoreExpressions.join(' + ') : '0';

  if (!input.unfiltered) {
    addTextFacetFilter(where, values, 'catalog_family', input.catalogFamilies);
  }

  if (input.customerTierId !== undefined) {
    values.push(input.customerTierId);
    where.push(`(customer_tier_id = $${values.length} OR customer_tier_id IS NULL)`);
  }

  values.push(getLimit(input.limit, 100));
  const whereClause = where.length > 0 ? `WHERE ${where.join('\n  AND ')}` : '';
  const tierSort = input.customerTierId === undefined
    ? ''
    : `
  CASE WHEN customer_tier_id IS NULL THEN 1 ELSE 0 END,`;

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
  source_refs,
  ${discoveryScore} AS discovery_match_score
FROM (
  SELECT
    price_item.*,
    tier.code AS customer_tier_code,
    tier.name AS customer_tier_name
  FROM steel.price_items AS price_item
  LEFT JOIN steel.customer_tiers AS tier ON tier.id = price_item.customer_tier_id
) AS price_item
${whereClause}
ORDER BY
  discovery_match_score ASC,${tierSort}
  product_name ASC,
  id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toPriceItem);
}
