import {
  getLimit,
  parseJsonObject,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
} from './types';

import type {
  SteelJsonValue,
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
} from './types';

interface SteelQuoteDefaultRow {
  id: string | number;
  default_type: string;
  origin_table: string;
  origin_id: string;
  origin_revision: string | null;
  scope_type: string;
  customer_id: string | number | null;
  customer_tier_id: string | number | null;
  catalog_family: string | null;
  product_family: string | null;
  charge_type: string | null;
  formula_code: string | null;
  selector: SteelJsonValue | null;
  effect: string;
  default_parameters: SteelJsonValue | null;
  priority: string | number;
  confidence: string;
  active: boolean;
  review_state: string;
  source_refs: unknown;
}

export interface SteelQuoteDefault extends SteelSourceBackedRecord {
  id: number;
  defaultType: string;
  originTable: string;
  originId: string;
  originRevision?: string;
  scopeType: string;
  customerId: number | null;
  customerTierId: number | null;
  catalogFamily?: string;
  productFamily?: string;
  chargeType?: string;
  formulaCode?: string;
  selector: SteelJsonValue;
  effect: string;
  defaultParameters: SteelJsonValue;
  priority: number;
  confidence: string;
  active: boolean;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

export interface SearchSteelQuoteDefaultsInput {
  customerId?: number;
  customerTierId?: number;
  catalogFamilies?: readonly string[];
  productFamilies?: readonly string[];
  chargeTypes?: readonly string[];
  formulaCodes?: readonly string[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.trim() !== ''))];
}

function addScopeFilters(
  where: string[],
  values: SteelSqlParameter[],
  input: SearchSteelQuoteDefaultsInput,
) {
  const scopeFilters = ["scope_type IN ('company', 'catalog_family', 'product_family')"];

  if (input.customerId !== undefined) {
    values.push(input.customerId);
    scopeFilters.push(`(scope_type = 'customer' AND customer_id = $${values.length})`);
  }

  if (input.customerTierId !== undefined) {
    values.push(input.customerTierId);
    scopeFilters.push(`(scope_type = 'customer_tier' AND customer_tier_id = $${values.length})`);
  }

  where.push(`(${scopeFilters.join(' OR ')})`);
}

function addNullableTextFacetFilter(
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

  where.push(`(${column} IS NULL OR ${column} IN (${placeholders.join(', ')}))`);
}

function toQuoteDefault(row: SteelQuoteDefaultRow): SteelQuoteDefault {
  return {
    id: parseRequiredNumber(row.id),
    defaultType: row.default_type,
    originTable: row.origin_table,
    originId: row.origin_id,
    originRevision: parseNullableString(row.origin_revision),
    scopeType: row.scope_type,
    customerId: parseNullableNumber(row.customer_id),
    customerTierId: parseNullableNumber(row.customer_tier_id),
    catalogFamily: parseNullableString(row.catalog_family),
    productFamily: parseNullableString(row.product_family),
    chargeType: parseNullableString(row.charge_type),
    formulaCode: parseNullableString(row.formula_code),
    selector: parseJsonObject(row.selector),
    effect: row.effect,
    defaultParameters: parseJsonObject(row.default_parameters),
    priority: parseRequiredNumber(row.priority),
    confidence: row.confidence,
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function searchSteelQuoteDefaults(
  client: SteelRepositoryClient,
  input: SearchSteelQuoteDefaultsInput,
): Promise<SteelQuoteDefault[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  addScopeFilters(where, values, input);
  addNullableTextFacetFilter(where, values, 'catalog_family', input.catalogFamilies);
  addNullableTextFacetFilter(where, values, 'product_family', input.productFamilies);
  addNullableTextFacetFilter(where, values, 'charge_type', input.chargeTypes);
  addNullableTextFacetFilter(where, values, 'formula_code', input.formulaCodes);
  values.push(getLimit(input.limit));

  const result = await client.query<SteelQuoteDefaultRow>(
    `
SELECT
  id,
  default_type,
  origin_table,
  origin_id,
  origin_revision,
  scope_type,
  customer_id,
  customer_tier_id,
  catalog_family,
  product_family,
  charge_type,
  formula_code,
  selector,
  effect,
  default_parameters,
  priority,
  confidence,
  active,
  review_state,
  source_refs
FROM steel.quote_defaults
WHERE ${where.join('\n  AND ')}
ORDER BY
  CASE scope_type
    WHEN 'customer' THEN 0
    WHEN 'customer_tier' THEN 1
    WHEN 'catalog_family' THEN 2
    WHEN 'product_family' THEN 3
    ELSE 4
  END ASC,
  priority ASC,
  id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toQuoteDefault);
}
