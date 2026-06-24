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
  thicknessMm?: readonly string[];
  keyword?: string;
  limit?: number;
}

export interface SearchSteelPriceItemsInput {
  queries: readonly SteelPriceCandidateQuery[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
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

interface ParsedPriceKeyword {
  material?: MaterialKind;
  thicknessMm?: string;
  terms: string[];
}

function normalizeKeywordText(value: string): string {
  return value.normalize('NFKC').replace(/[＊*×]/gu, 'x').trim();
}

function formatThicknessMm(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return normalized;
  }

  return Number.isInteger(parsed) ? `${parsed}.0` : String(parsed);
}

function extractThicknessMm(value: string): { text: string; thicknessMm?: string } {
  let thicknessMm: string | undefined;
  const text = value.replace(/\b(\d+(?:\.\d+)?)\s*(?:m\/m|mm)\b/giu, (_match, numberText) => {
    if (thicknessMm === undefined) {
      thicknessMm = formatThicknessMm(String(numberText));
    }

    return ' ';
  });

  return { text, thicknessMm };
}

function extractMaterial(value: string): { text: string; material?: MaterialKind } {
  if (!/(?:OT板|OT|黑鐵板|黑鐵)/iu.test(value)) {
    return { text: value };
  }

  return {
    text: value.replace(/(?:OT板|OT|黑鐵板|黑鐵)/giu, ' '),
    material: 'OT 黑鐵',
  };
}

function toKeywordTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\s+/u)
        .map((term) => normalizeSteelSpecKey(term) ?? term.trim())
        .filter(Boolean),
    ),
  ];
}

function parsePriceKeyword(
  keyword: string | undefined,
  query: SteelPriceCandidateQuery,
): ParsedPriceKeyword {
  if (!keyword?.trim()) {
    return { terms: [] };
  }

  const normalized = normalizeKeywordText(keyword);
  const thicknessResult = query.thicknessMm === undefined
    ? extractThicknessMm(normalized)
    : { text: normalized, thicknessMm: undefined };
  const materialResult = query.material === undefined && query.category !== '孔'
    ? extractMaterial(thicknessResult.text)
    : { text: thicknessResult.text, material: undefined };

  return {
    material: materialResult.material,
    thicknessMm: thicknessResult.thicknessMm,
    terms: toKeywordTerms(materialResult.text),
  };
}

function addKeywordTermsFilter(
  clauses: string[],
  values: SteelSqlParameter[],
  columns: readonly string[],
  terms: readonly string[],
) {
  if (terms.length === 0) {
    return;
  }

  clauses.push(
    terms
      .map((term) => {
        values.push(`%${term}%`);
        const placeholder = `$${values.length}`;

        return `(${columns.map((column) => `${column} ILIKE ${placeholder}`).join('\n      OR ')})`;
      })
      .join('\n      AND '),
  );
}

function addThicknessMmFilter(
  clauses: string[],
  values: SteelSqlParameter[],
  thicknessMm: readonly string[] | undefined,
) {
  if (!thicknessMm || thicknessMm.length === 0) {
    return;
  }

  const matches = [...new Set(thicknessMm.map(formatThicknessMm).filter(Boolean))];
  if (matches.length === 0) {
    return;
  }

  const matchClauses = matches.map((match) => {
    values.push(match);
    return `source_thickness = $${values.length}`;
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

  const parsedKeyword = parsePriceKeyword(query.keyword, query);
  const material = query.material ?? parsedKeyword.material;
  if (material) {
    values.push(material);
    clauses.push(`material = $${values.length}`);
  }

  addThicknessMmFilter(
    clauses,
    values,
    query.thicknessMm ?? (parsedKeyword.thicknessMm ? [parsedKeyword.thicknessMm] : undefined),
  );

  addKeywordTermsFilter(
    clauses,
    values,
    ['product_name', 'spec_key', 'erp_item_code', 'source_spec'],
    parsedKeyword.terms,
  );

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

  addKeywordTermsFilter(
    clauses,
    values,
    ['product_name', 'spec_key', 'source_spec', 'subcategory'],
    parsePriceKeyword(query.keyword, query).terms,
  );

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
  const selects = input.queries.map((query) => {
    const where: string[] = ['review_state = $1'];

    if (!input.includeInactive) {
      where.push('active = true');
    }

    const filters = [addPriceQueryFilter(values, query)];
    const relatedCuttingFilter = addRelatedCuttingQueryFilter(values, query);
    where.push(`(${(relatedCuttingFilter ? [...filters, relatedCuttingFilter] : filters).join('\n  OR ')})`);

    values.push(getLimit(query.limit, 30));
    return `
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
`;
  });

  if (selects.length === 0) {
    return [];
  }

  const sql = selects.length === 1
    ? selects[0]
    : `
SELECT *
FROM (
${selects.map((select) => `(${select})`).join('\nUNION ALL\n')}
) AS price_candidates
ORDER BY
  product_name ASC,
  id ASC
`;

  const result = await client.query<SteelPriceItemRow>(sql, values);

  return result.rows.map(toPriceItem);
}

export async function discoverSteelPriceCategories(
  client: SteelRepositoryClient,
  input: DiscoverSteelPriceCategoriesInput,
): Promise<SteelPriceCategoryCandidate[]> {
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];
  const where = [
    'review_state = $1',
  ];
  addKeywordTermsFilter(
    where,
    values,
    ['product_name', 'spec_key', 'erp_item_code', 'source_spec'],
    toKeywordTerms(normalizeKeywordText(input.keyword)),
  );

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
