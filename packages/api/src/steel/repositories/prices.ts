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
  productName?: string;
  productNames?: readonly string[];
  erpItemCodes?: readonly string[];
  catalogFamilies?: readonly string[];
  customerTierId?: number;
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

interface SteelProductNameSearch {
  productNameTerms: string[];
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.trim() !== ''))];
}

function parseExplicitThicknessMm(value: string): number[] {
  const thicknessMatches = [
    ...value.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:t|T|mm|m\s*\/\s*m|m\/m)/g),
    ...value.matchAll(/厚(?:度)?\s*(\d+(?:\.\d+)?)/g),
    ...value.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*[*＊×xX]\s*\d+(?:\.\d+)?\s*(?:'|尺)\s*[*＊×xX]\s*\d+(?:\.\d+)?\s*(?:'|尺)/g),
  ];

  return thicknessMatches
    .map((match) => Number(match[1]))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
}

function getProductNameAliasThicknessMm(input: SearchSteelPriceItemsInput): number | undefined {
  const values = [
    input.specKey,
    input.productName,
    ...(input.productNames ?? []),
  ].filter((value): value is string => value !== undefined);
  const thicknessValues = values.flatMap(parseExplicitThicknessMm);

  return thicknessValues.length > 0 ? Math.max(...thicknessValues) : undefined;
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

function getProductNameAliasThicknessPredicate(thicknessExpression: string): string {
  return `(
          product_name_alias.metadata->>'minThicknessMm' IS NULL
          OR (
            ${thicknessExpression} IS NOT NULL
            AND product_name_alias.metadata->>'minThicknessMm' ~ '^[0-9]+(\\.[0-9]+)?$'
            AND (product_name_alias.metadata->>'minThicknessMm')::numeric <= ${thicknessExpression}
          )
        )`;
}

function getProductNameAliasTargetPredicate(): string {
  return `(
          (
            product_name_alias.metadata->>'matchKind' = 'surface_marker'
            AND (
              product_name ~* (
                '(^|[^[:alnum:]])'
                || product_name_alias.target_product_name
                || '([^[:alnum:]]|$)|^[0-9.]+[[:space:]]*'
                || product_name_alias.target_product_name
              )
              OR (
                product_name_alias.target_product_name = 'NO1'
                AND product_name ~* 'ST[[:space:]]*NO[[:space:]]*1|NO[[:space:]]*1'
              )
            )
          )
          OR (
            COALESCE(product_name_alias.metadata->>'matchKind', '') <> 'surface_marker'
            AND product_name ILIKE ('%' || product_name_alias.target_product_name || '%')
          )
        )`;
}

function getProductNameMatchExpression(
  placeholder: string,
  aliasThicknessExpression: string,
): string {
  return `(
    product_name ILIKE ${placeholder}
    OR EXISTS (
      SELECT 1
      FROM steel.product_name_aliases AS product_name_alias
      WHERE product_name_alias.active = true
        AND product_name_alias.review_state = 'reviewed'
        AND lower(product_name_alias.source_product_name) = lower(trim(both '%' from ${placeholder}::text))
        AND (
          product_name_alias.catalog_family IS NULL
          OR product_name_alias.catalog_family = price_item.catalog_family
        )
        AND ${getProductNameAliasThicknessPredicate(aliasThicknessExpression)}
        AND ${getProductNameAliasTargetPredicate()}
    )
  )`;
}

function addDiscoverySearchFilter(
  where: string[],
  values: SteelSqlParameter[],
  input: SearchSteelPriceItemsInput,
): string[] {
  const clauses: string[] = [];
  const scoreExpressions: string[] = [];
  const productNameAliasThicknessMm = getProductNameAliasThicknessMm(input);

  getProductNameSearches(input).forEach((search) => {
    const termClauses = search.productNameTerms.map((productNameTerm) => {
      values.push(`%${productNameTerm}%`);
      const placeholder = `$${values.length}`;
      const aliasThicknessExpression =
        productNameAliasThicknessMm === undefined
          ? 'NULL::numeric'
          : `$${values.push(productNameAliasThicknessMm)}::numeric`;
      const matchExpression = getProductNameMatchExpression(
        placeholder,
        aliasThicknessExpression,
      );
      scoreExpressions.push(`CASE WHEN ${matchExpression} THEN 0 ELSE 1 END`);
      return matchExpression;
    });

    clauses.push(`(${termClauses.join(' AND ')})`);
  });

  uniqueNonEmpty(input.erpItemCodes).forEach((erpItemCode) => {
    values.push(`%${erpItemCode}%`);
    const placeholder = `$${values.length}`;
    scoreExpressions.push(`CASE WHEN erp_item_code ILIKE ${placeholder} THEN 0 ELSE 1 END`);
    clauses.push(`erp_item_code ILIKE ${placeholder}`);
  });

  if (clauses.length > 0) {
    where.push(`(${clauses.join(' OR ')})`);
  }

  return scoreExpressions;
}

function getProductNameSearch(productName: string): SteelProductNameSearch {
  const value = productName.trim();
  const oralAngleProductTerms: Record<string, string[]> = {
    錏角鐵: ['錏', '角鐵'],
    鍍鋅角鐵: ['鍍鋅', '角鐵'],
  };

  return {
    productNameTerms: oralAngleProductTerms[value] ?? [value],
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

  if (!input.includeInactive) {
    where.push('active = true');
  }

  if (input.specKey) {
    values.push(input.specKey);
    where.push(`spec_key = $${values.length}`);
  }

  const discoveryScoreExpressions = addDiscoverySearchFilter(where, values, input);
  const discoveryScore =
    discoveryScoreExpressions.length > 0 ? discoveryScoreExpressions.join(' + ') : '0';

  addTextFacetFilter(where, values, 'catalog_family', input.catalogFamilies);

  if (input.customerTierId !== undefined) {
    values.push(input.customerTierId);
    where.push(`(customer_tier_id = $${values.length} OR customer_tier_id IS NULL)`);
  }

  values.push(getLimit(input.limit, 100));

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
WHERE ${where.join('\n  AND ')}
ORDER BY
  discovery_match_score ASC,
  CASE WHEN customer_tier_id IS NULL THEN 1 ELSE 0 END,
  product_name ASC,
  id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toPriceItem);
}
