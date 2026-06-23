import {
  getLimit,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
  parseValueState,
} from './types';
import {
  type MaterialKind,
  type PriceCategory,
} from '../pricing/enums';
import { normalizeSteelSpecKey } from '../normalization/spec';

import type {
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
  SteelValueState,
} from './types';

export type SteelPriceKind = 'product' | 'cutting' | 'hole';

interface SteelPriceItemRow {
  id: string | number;
  erp_item_code: string | null;
  price_kind: string;
  spec_key: string;
  product_name: string;
  category: string;
  subcategory: string | null;
  material: string | null;
  source_subcategory_label: string | null;
  source_thickness: string | null;
  source_spec: string | null;
  unit: string;
  unit_price_a: string | number | null;
  unit_price_b: string | number | null;
  unit_price_c: string | number | null;
  unit_price_f: string | number | null;
  ratio_a: string | number | null;
  ratio_b: string | number | null;
  ratio_c: string | number | null;
  ratio_f: string | number | null;
  product_price_unit_weight: string | number | null;
  product_price_unit_weight_unit: string | null;
  currency: string;
  value_state: string;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}

interface SteelPriceCategoryCandidateRow {
  category: string;
  material: string | null;
  candidate_count: string | number;
  example_erp_item_code: string | null;
  example_product_name: string | null;
}

export interface SteelPriceTierValues {
  A: number | null;
  B: number | null;
  C: number | null;
  F: number | null;
}

export interface SteelPriceItem extends SteelSourceBackedRecord {
  id: number;
  erpItemCode?: string;
  priceKind: SteelPriceKind;
  specKey: string;
  productName: string;
  category: PriceCategory | string;
  subcategory?: string;
  material?: MaterialKind | string;
  sourceSubcategoryLabel?: string;
  sourceThickness?: string;
  sourceSpec?: string;
  unit: string;
  tierPrices: SteelPriceTierValues;
  tierRatios: SteelPriceTierValues;
  productPriceUnitWeight: number | null;
  productPriceUnitWeightUnit?: string;
  currency: string;
  valueState: SteelValueState;
  reviewState: SteelReviewState;
  active: boolean;
  sourceRefs: SteelSourceRef[];
}

export interface SteelPriceCandidateQuery {
  category: PriceCategory;
  material?: MaterialKind;
  thicknesses?: readonly string[];
  specs?: readonly string[];
  keyword?: string;
}

export interface SearchSteelPriceItemsInput {
  queries: readonly SteelPriceCandidateQuery[];
  includeRelatedCutting?: boolean;
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

export interface DiscoverSteelPriceCategoriesInput {
  keyword: string;
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

export interface SteelPriceCategoryCandidate {
  category: PriceCategory | string;
  material: MaterialKind | string | null;
  candidateCount: number;
  exampleErpItemCode?: string;
  exampleProductName?: string;
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeNumericString(value: string): string {
  const normalized = value.normalize('NFKC').trim();

  if (/^\d+$/u.test(normalized)) {
    return `${normalized}.0`;
  }

  return normalized;
}

function normalizeSpecTerm(value: string): string {
  return normalizeSteelSpecKey(value) ?? value;
}

function addContainsAnyFilter(
  clauses: string[],
  values: SteelSqlParameter[],
  columnExpression: string,
  matches: readonly string[] | undefined,
  normalize: (value: string) => string = (value) => value,
) {
  const uniqueMatches = uniqueNonEmpty(matches).map(normalize).filter(Boolean);

  if (uniqueMatches.length === 0) {
    return;
  }

  const matchClauses = uniqueMatches.map((match) => {
    values.push(`%${match}%`);
    return `${columnExpression} ILIKE $${values.length}`;
  });

  clauses.push(`(${matchClauses.join(' OR ')})`);
}

function addThicknessAnyFilter(
  clauses: string[],
  values: SteelSqlParameter[],
  matches: readonly string[] | undefined,
) {
  const uniqueMatches = uniqueNonEmpty(matches).map(normalizeNumericString).filter(Boolean);

  if (uniqueMatches.length === 0) {
    return;
  }

  const matchClauses = uniqueMatches.map((match) => {
    if (/^\d+(?:\.\d+)?$/u.test(match)) {
      values.push(match);
      return `source_thickness = $${values.length}`;
    }

    values.push(`%${match}%`);
    return `source_thickness ILIKE $${values.length}`;
  });

  clauses.push(`(${matchClauses.join(' OR ')})`);
}

function addPriceQueryFilter(
  values: SteelSqlParameter[],
  query: SteelPriceCandidateQuery,
): string {
  const clauses: string[] = [];

  values.push(query.category);
  clauses.push(`category = $${values.length}`);

  if (query.material) {
    values.push(query.material);
    clauses.push(`material = $${values.length}`);
  }

  addThicknessAnyFilter(clauses, values, query.thicknesses);
  addContainsAnyFilter(
    clauses,
    values,
    'COALESCE(source_spec, spec_key)',
    query.specs,
    normalizeSpecTerm,
  );

  if (query.keyword) {
    values.push(`%${query.keyword}%`);
    const placeholder = `$${values.length}`;
    clauses.push(`(
      product_name ILIKE ${placeholder}
      OR spec_key ILIKE ${placeholder}
      OR erp_item_code ILIKE ${placeholder}
    )`);
  }

  return `(${clauses.join('\n    AND ')})`;
}

function getRelatedCuttingSubcategories(category: string): string[] {
  if (category === 'H型鋼') {
    return ['H型鋼', '工字鐵/H型鋼'];
  }
  if (category === '工字鐵/I字鐵') {
    return ['工字鐵/H型鋼'];
  }
  if (category === '圓管/鋼管' || category === '方管' || category === '扁方管') {
    return ['管'];
  }
  if (category === '角鐵/角鋼') {
    return ['角鐵'];
  }
  if (category === '槽鐵') {
    return ['槽鐵'];
  }
  if (category === '平鐵/扁鐵') {
    return ['平鐵/扁鐵'];
  }

  return [];
}

function addRelatedCuttingQueryFilter(
  values: SteelSqlParameter[],
  query: SteelPriceCandidateQuery,
): string | undefined {
  const subcategories = getRelatedCuttingSubcategories(query.category);
  if (subcategories.length === 0) {
    return undefined;
  }

  const clauses = [`price_kind = 'cutting'`];
  values.push('切工/切割');
  clauses.push(`category = $${values.length}`);
  values.push(subcategories);
  clauses.push(`subcategory = ANY($${values.length}::text[])`);
  addContainsAnyFilter(
    clauses,
    values,
    'COALESCE(source_spec, spec_key)',
    query.specs,
    normalizeSpecTerm,
  );

  if (query.keyword) {
    values.push(`%${query.keyword}%`);
    const placeholder = `$${values.length}`;
    clauses.push(`(
      product_name ILIKE ${placeholder}
      OR spec_key ILIKE ${placeholder}
      OR source_spec ILIKE ${placeholder}
      OR subcategory ILIKE ${placeholder}
    )`);
  }

  return `(${clauses.join('\n    AND ')})`;
}

function toTierValues(input: {
  a: string | number | null;
  b: string | number | null;
  c: string | number | null;
  f: string | number | null;
}): SteelPriceTierValues {
  return {
    A: parseNullableNumber(input.a),
    B: parseNullableNumber(input.b),
    C: parseNullableNumber(input.c),
    F: parseNullableNumber(input.f),
  };
}

function parsePriceKind(value: string): SteelPriceKind {
  if (value === 'product' || value === 'cutting' || value === 'hole') {
    return value;
  }

  throw new Error(`Unexpected Steel price_kind: ${value}`);
}

function toPriceItem(row: SteelPriceItemRow): SteelPriceItem {
  const tierPrices = toTierValues({
    a: row.unit_price_a,
    b: row.unit_price_b,
    c: row.unit_price_c,
    f: row.unit_price_f,
  });
  const tierRatios = toTierValues({
    a: row.ratio_a,
    b: row.ratio_b,
    c: row.ratio_c,
    f: row.ratio_f,
  });

  return {
    id: parseRequiredNumber(row.id),
    erpItemCode: parseNullableString(row.erp_item_code),
    priceKind: parsePriceKind(row.price_kind),
    specKey: row.spec_key,
    productName: row.product_name,
    category: row.category,
    subcategory: parseNullableString(row.subcategory),
    material: parseNullableString(row.material),
    sourceSubcategoryLabel: parseNullableString(row.source_subcategory_label),
    sourceThickness: parseNullableString(row.source_thickness),
    sourceSpec: parseNullableString(row.source_spec),
    unit: row.unit,
    tierPrices,
    tierRatios,
    productPriceUnitWeight: parseNullableNumber(row.product_price_unit_weight),
    productPriceUnitWeightUnit: parseNullableString(row.product_price_unit_weight_unit),
    currency: row.currency,
    valueState: parseValueState(row.value_state),
    reviewState: parseReviewState(row.review_state),
    active: row.active,
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

function toCategoryCandidate(
  row: SteelPriceCategoryCandidateRow,
): SteelPriceCategoryCandidate {
  return {
    category: row.category,
    material: row.material,
    candidateCount: parseRequiredNumber(row.candidate_count),
    exampleErpItemCode: parseNullableString(row.example_erp_item_code),
    exampleProductName: parseNullableString(row.example_product_name),
  };
}

export async function searchSteelPriceItems(
  client: SteelRepositoryClient,
  input: SearchSteelPriceItemsInput,
): Promise<SteelPriceItem[]> {
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];
  const where: string[] = [`review_state = $${values.length}`];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  const queryFilters = input.queries.flatMap((query) => {
    const filters = [addPriceQueryFilter(values, query)];
    const relatedCuttingFilter = input.includeRelatedCutting
      ? addRelatedCuttingQueryFilter(values, query)
      : undefined;

    return relatedCuttingFilter ? [...filters, relatedCuttingFilter] : filters;
  });
  if (queryFilters.length > 0) {
    where.push(`(${queryFilters.join('\n  OR ')})`);
  }

  values.push(getLimit(input.limit, 100));

  const result = await client.query<SteelPriceItemRow>(
    `
SELECT
  id,
  erp_item_code,
  price_kind,
  spec_key,
  product_name,
  category,
  subcategory,
  material,
  source_subcategory_label,
  source_thickness,
  source_spec,
  unit,
  unit_price_a,
  unit_price_b,
  unit_price_c,
  unit_price_f,
  ratio_a,
  ratio_b,
  ratio_c,
  ratio_f,
  product_price_unit_weight,
  product_price_unit_weight_unit,
  currency,
  value_state,
  review_state,
  active,
  source_refs
FROM steel.prices
WHERE ${where.join('\n  AND ')}
ORDER BY
  product_name ASC,
  id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toPriceItem);
}

export async function discoverSteelPriceCategories(
  client: SteelRepositoryClient,
  input: DiscoverSteelPriceCategoriesInput,
): Promise<SteelPriceCategoryCandidate[]> {
  const normalizedKeyword = normalizeSteelSpecKey(input.keyword) ?? input.keyword;
  const values: SteelSqlParameter[] = [
    input.reviewState ?? 'reviewed',
    `%${input.keyword}%`,
    `%${normalizedKeyword}%`,
  ];
  const where = [
    'review_state = $1',
    `(
      product_name ILIKE $2
      OR spec_key ILIKE $3
      OR erp_item_code ILIKE $2
    )`,
  ];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  values.push(getLimit(input.limit, 100));

  const result = await client.query<SteelPriceCategoryCandidateRow>(
    `
SELECT
  category,
  material,
  COUNT(*) AS candidate_count,
  MIN(erp_item_code) AS example_erp_item_code,
  MIN(product_name) AS example_product_name
FROM steel.prices
WHERE ${where.join('\n  AND ')}
GROUP BY category, material
ORDER BY
  candidate_count DESC,
  category ASC,
  material ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toCategoryCandidate);
}
