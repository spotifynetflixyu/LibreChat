import {
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseSteelSourceRefs,
} from './types';
import { normalizeSteelSpecKey } from '../normalization/spec';
import { processingPriceCategories } from '../pricing/processing-candidates';

import type { SteelRepositoryClient, SteelSourceBackedRecord, SteelSourceRef } from './types';
import type { PriceLookupMaterialKind, PriceCategory } from '../pricing/enums';
import type { ProcessingPriceCategory } from '../pricing/processing-candidates';

export type SteelPriceKind = 'product' | 'cutting' | 'hole';
export type SteelPriceValueState = 'confirmed' | 'ratio_only' | 'no_price';

interface SteelPriceItemRow {
  id: string | number;
  erp_item_code: string;
  price_kind: string;
  formula_code: string | null;
  spec_key: string;
  product_name: string | null;
  normalized_spec_text: string | null;
  category: string;
  subcategory: string | null;
  processing_method?: string | null;
  processing_shape?: string | null;
  material: string | null;
  dimension_signature: string | null;
  unit: string | null;
  value_state: string;
  unit_price_base: string | number | null;
  unit_price_a: string | number | null;
  unit_price_b: string | number | null;
  unit_price_c: string | number | null;
  unit_price_d: string | number | null;
  unit_price_e: string | number | null;
  unit_price_f: string | number | null;
  price_ratio_a: string | number | null;
  price_ratio_b: string | number | null;
  price_ratio_c: string | number | null;
  price_ratio_d: string | number | null;
  price_ratio_e: string | number | null;
  price_ratio_f: string | number | null;
  unit_weight_value: string | number | null;
  unit_weight_basis: string | null;
  density: string | number | null;
  source_thickness: string | null;
  thickness_min_mm: string | number | null;
  thickness_max_mm: string | number | null;
  width_mm: string | number | null;
  height_mm: string | number | null;
  length_mm: string | number | null;
  outer_diameter_mm: string | number | null;
  nominal_inch: string | null;
  web_mm: string | number | null;
  flange_mm: string | number | null;
  lip_mm: string | number | null;
  sheet_width_mm: string | number | null;
  sheet_length_mm: string | number | null;
  spec_sort_key: string | null;
  cost_basis: string;
  currency: string;
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

interface SteelPriceCandidateGroupRow {
  query_index: string | number;
  query_id: string;
  price_candidates: SteelPriceItemRow[] | string;
  category_candidates: SteelPriceCategoryCandidateRow[] | string;
}

export interface SteelPriceTierValues {
  A: number | null;
  B: number | null;
  C: number | null;
  D: number | null;
  E: number | null;
  F: number | null;
}

export interface SteelPriceItem extends SteelSourceBackedRecord {
  id: number;
  erpItemCode: string;
  priceKind: SteelPriceKind;
  formulaCode?: string;
  specKey: string;
  productName?: string;
  normalizedSpecText?: string;
  category: PriceCategory | string;
  subcategory?: string;
  processingMethod?: string;
  processingShape?: string;
  material?: string;
  dimensionSignature?: string;
  unit?: string;
  valueState: SteelPriceValueState;
  unitPriceBase: number | null;
  tierPrices: SteelPriceTierValues;
  tierRatios: SteelPriceTierValues;
  unitWeightValue: number | null;
  unitWeightBasis?: string;
  density: number | null;
  sourceThickness?: string;
  thicknessMinMm: number | null;
  thicknessMaxMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  outerDiameterMm: number | null;
  nominalInch?: string;
  webMm: number | null;
  flangeMm: number | null;
  lipMm: number | null;
  sheetWidthMm: number | null;
  sheetLengthMm: number | null;
  specSortKey?: string;
  costBasis: string;
  currency: string;
  active: boolean;
  sourceRefs: SteelSourceRef[];
}

export interface SteelPriceLookupQuery {
  queryId: string;
  mode?: 'lookup';
  category: PriceCategory;
  subcategory?: string;
  material?: PriceLookupMaterialKind;
  unit?: string;
  thicknessMm?: readonly string[];
  stockLengthMm?: readonly string[];
  erpItemCode?: string;
  keyword?: string;
}

export interface SteelPriceCategoryDiscoveryQuery {
  queryId: string;
  mode: 'category_discovery';
  keyword: string;
}

export type SteelPriceCandidateQuery = SteelPriceLookupQuery | SteelPriceCategoryDiscoveryQuery;

export interface SearchSteelPriceCandidateGroupsInput {
  queries: readonly SteelPriceCandidateQuery[];
  includeInactive?: boolean;
}

export interface SearchSteelProcessingPriceCandidatesInput {
  includeInactive?: boolean;
  categories?: readonly ProcessingPriceCategory[];
}

export interface SteelPriceCategoryCandidate {
  category: PriceCategory | string;
  material: string | null;
  candidateCount: number;
  exampleErpItemCode?: string;
  exampleProductName?: string;
}

export interface SteelPriceCandidateGroup {
  queryIndex: number;
  queryId: string;
  candidates: SteelPriceItem[];
  categoryCandidates: SteelPriceCategoryCandidate[];
}

interface SerializedPriceQuery {
  query_index: number;
  query_id: string;
  mode: 'lookup' | 'category_discovery';
  category?: PriceCategory;
  subcategory?: string;
  material?: PriceLookupMaterialKind;
  material_terms?: readonly string[];
  unit?: string;
  thickness_mm?: readonly string[];
  stock_length_mm?: readonly string[];
  erp_item_code?: string;
  keyword_terms?: readonly string[];
}

function normalizeKeywordText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[＊*×]/gu, 'x')
    .trim();
}

function toKeywordTerms(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const terms = [
    ...new Set(
      normalizeKeywordText(value)
        .split(/\s+/u)
        .map((term) => normalizeSteelSpecKey(term) ?? term.trim())
        .filter(Boolean),
    ),
  ];

  return terms.length > 0 ? terms : undefined;
}

function formatDecimalString(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return normalized;
  }

  return String(parsed);
}

function serializePriceQuery(query: SteelPriceCandidateQuery, queryIndex: number) {
  const base = {
    query_index: queryIndex,
    query_id: query.queryId,
    mode: query.mode ?? 'lookup',
    keyword_terms: toKeywordTerms(query.keyword),
  } as const;

  if (query.mode === 'category_discovery') {
    return base satisfies SerializedPriceQuery;
  }

  return {
    ...base,
    category: query.category,
    subcategory: query.subcategory,
    material: query.material,
    material_terms: query.material ? [query.material] : undefined,
    unit: query.unit,
    thickness_mm: query.thicknessMm
      ? [...new Set(query.thicknessMm.map(formatDecimalString))]
      : undefined,
    stock_length_mm: query.stockLengthMm
      ? [...new Set(query.stockLengthMm.map(formatDecimalString))]
      : undefined,
    erp_item_code: query.erpItemCode,
  } satisfies SerializedPriceQuery;
}

function parsePriceKind(value: string): SteelPriceKind {
  if (value === 'product' || value === 'cutting' || value === 'hole') {
    return value;
  }

  throw new Error(`Unexpected Steel price_kind: ${value}`);
}

function parsePriceValueState(value: string): SteelPriceValueState {
  if (value === 'confirmed' || value === 'ratio_only' || value === 'no_price') {
    return value;
  }

  throw new Error(`Unexpected Steel price value_state: ${value}`);
}

function toTierValues(input: {
  a: string | number | null;
  b: string | number | null;
  c: string | number | null;
  d: string | number | null;
  e: string | number | null;
  f: string | number | null;
}): SteelPriceTierValues {
  return {
    A: parseNullableNumber(input.a),
    B: parseNullableNumber(input.b),
    C: parseNullableNumber(input.c),
    D: parseNullableNumber(input.d),
    E: parseNullableNumber(input.e),
    F: parseNullableNumber(input.f),
  };
}

function toPriceItem(row: SteelPriceItemRow): SteelPriceItem {
  return {
    id: parseRequiredNumber(row.id),
    erpItemCode: row.erp_item_code,
    priceKind: parsePriceKind(row.price_kind),
    formulaCode: parseNullableString(row.formula_code),
    specKey: row.spec_key,
    productName: parseNullableString(row.product_name),
    normalizedSpecText: parseNullableString(row.normalized_spec_text),
    category: row.category,
    subcategory: parseNullableString(row.subcategory),
    processingMethod: parseNullableString(row.processing_method),
    processingShape: parseNullableString(row.processing_shape),
    material: parseNullableString(row.material),
    dimensionSignature: parseNullableString(row.dimension_signature),
    unit: parseNullableString(row.unit),
    valueState: parsePriceValueState(row.value_state),
    unitPriceBase: parseNullableNumber(row.unit_price_base),
    tierPrices: toTierValues({
      a: row.unit_price_a,
      b: row.unit_price_b,
      c: row.unit_price_c,
      d: row.unit_price_d,
      e: row.unit_price_e,
      f: row.unit_price_f,
    }),
    tierRatios: toTierValues({
      a: row.price_ratio_a,
      b: row.price_ratio_b,
      c: row.price_ratio_c,
      d: row.price_ratio_d,
      e: row.price_ratio_e,
      f: row.price_ratio_f,
    }),
    unitWeightValue: parseNullableNumber(row.unit_weight_value),
    unitWeightBasis: parseNullableString(row.unit_weight_basis),
    density: parseNullableNumber(row.density),
    sourceThickness: parseNullableString(row.source_thickness),
    thicknessMinMm: parseNullableNumber(row.thickness_min_mm),
    thicknessMaxMm: parseNullableNumber(row.thickness_max_mm),
    widthMm: parseNullableNumber(row.width_mm),
    heightMm: parseNullableNumber(row.height_mm),
    lengthMm: parseNullableNumber(row.length_mm),
    outerDiameterMm: parseNullableNumber(row.outer_diameter_mm),
    nominalInch: parseNullableString(row.nominal_inch),
    webMm: parseNullableNumber(row.web_mm),
    flangeMm: parseNullableNumber(row.flange_mm),
    lipMm: parseNullableNumber(row.lip_mm),
    sheetWidthMm: parseNullableNumber(row.sheet_width_mm),
    sheetLengthMm: parseNullableNumber(row.sheet_length_mm),
    specSortKey: parseNullableString(row.spec_sort_key),
    costBasis: row.cost_basis,
    currency: row.currency,
    active: row.active,
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

function toCategoryCandidate(row: SteelPriceCategoryCandidateRow): SteelPriceCategoryCandidate {
  return {
    category: row.category,
    material: row.material,
    candidateCount: parseRequiredNumber(row.candidate_count),
    exampleErpItemCode: parseNullableString(row.example_erp_item_code),
    exampleProductName: parseNullableString(row.example_product_name),
  };
}

function parseDatabaseRows<Row extends object>(value: Row[] | string, field: string): Row[] {
  if (Array.isArray(value)) {
    return value;
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error(`Steel price query ${field} must be an array`);
  }

  return parsed as Row[];
}

function dedupePriceItems(rows: readonly SteelPriceItemRow[]): SteelPriceItem[] {
  const seen = new Set<number>();
  const candidates: SteelPriceItem[] = [];

  for (const row of rows) {
    const candidate = toPriceItem(row);
    if (seen.has(candidate.id)) {
      continue;
    }

    seen.add(candidate.id);
    candidates.push(candidate);
  }

  return candidates;
}

function toCandidateGroup(row: SteelPriceCandidateGroupRow): SteelPriceCandidateGroup {
  return {
    queryIndex: parseRequiredNumber(row.query_index),
    queryId: row.query_id,
    candidates: dedupePriceItems(parseDatabaseRows(row.price_candidates, 'price_candidates')),
    categoryCandidates: parseDatabaseRows(row.category_candidates, 'category_candidates').map(
      toCategoryCandidate,
    ),
  };
}

const groupedPriceCandidatesSql = `
WITH input_queries AS (
  SELECT *
  FROM jsonb_to_recordset($1::jsonb) AS input_query(
    query_index INTEGER,
    query_id TEXT,
    mode TEXT,
    category TEXT,
    subcategory TEXT,
    material TEXT,
    material_terms TEXT[],
    unit TEXT,
    thickness_mm TEXT[],
    stock_length_mm TEXT[],
    erp_item_code TEXT,
    keyword_terms TEXT[]
  )
)
SELECT
  input_query.query_index,
  input_query.query_id,
  COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(price_candidate))
      FROM (
        SELECT
          p.id,
          p.erp_item_code,
          p.price_kind,
          p.formula_code,
          p.spec_key,
          p.product_name,
          p.normalized_spec_text,
          p.category,
          p.subcategory,
          p.processing_method,
          p.processing_shape,
          p.material,
          p.dimension_signature,
          p.unit,
          p.value_state,
          p.unit_price_base,
          p.unit_price_a,
          p.unit_price_b,
          p.unit_price_c,
          p.unit_price_d,
          p.unit_price_e,
          p.unit_price_f,
          p.price_ratio_a,
          p.price_ratio_b,
          p.price_ratio_c,
          p.price_ratio_d,
          p.price_ratio_e,
          p.price_ratio_f,
          p.unit_weight_value,
          p.unit_weight_basis,
          p.density,
          p.source_thickness,
          p.thickness_min_mm,
          p.thickness_max_mm,
          p.width_mm,
          p.height_mm,
          p.length_mm,
          p.outer_diameter_mm,
          p.nominal_inch,
          p.web_mm,
          p.flange_mm,
          p.lip_mm,
          p.sheet_width_mm,
          p.sheet_length_mm,
          p.spec_sort_key,
          p.cost_basis,
          p.currency,
          p.active,
          p.source_refs
        FROM steel.prices AS p
        WHERE input_query.mode = 'lookup'
          AND ($2::boolean OR p.active = true)
          AND p.value_state <> 'no_price'
          AND p.category = input_query.category
          AND (input_query.subcategory IS NULL OR p.subcategory = input_query.subcategory)
          AND (input_query.unit IS NULL OR p.unit = input_query.unit)
          AND (
            input_query.material_terms IS NULL
            OR EXISTS (
              SELECT 1
              FROM unnest(input_query.material_terms) AS material_term
              WHERE p.material ILIKE '%' || material_term || '%'
            )
          )
          AND (
            input_query.thickness_mm IS NULL
            OR EXISTS (
              SELECT 1
              FROM unnest(input_query.thickness_mm) AS requested_thickness
              WHERE requested_thickness ~ '^[[:space:]]*([0-9]+([.][0-9]*)?|[.][0-9]+)[[:space:]]*$'
                AND (
                  (
                    p.thickness_min_mm = p.thickness_max_mm
                    AND p.thickness_min_mm = requested_thickness::numeric
                  )
                  OR (
                    p.thickness_min_mm < p.thickness_max_mm
                    AND p.thickness_min_mm <= requested_thickness::numeric
                    AND requested_thickness::numeric < p.thickness_max_mm
                  )
                )
            )
          )
          AND (
            input_query.erp_item_code IS NULL
            OR p.erp_item_code = input_query.erp_item_code
          )
          AND (
            input_query.stock_length_mm IS NULL
            OR EXISTS (
              SELECT 1
              FROM unnest(input_query.stock_length_mm) AS requested_stock_length
              WHERE p.length_mm = requested_stock_length::numeric
            )
          )
          AND (
            input_query.keyword_terms IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM unnest(input_query.keyword_terms) AS keyword_term
              WHERE NOT COALESCE(
                p.spec_key ILIKE '%' || keyword_term || '%'
                  OR p.product_name ILIKE '%' || keyword_term || '%'
                  OR p.normalized_spec_text ILIKE '%' || keyword_term || '%'
                  OR p.dimension_signature ILIKE '%' || keyword_term || '%'
                  OR p.erp_item_code ILIKE '%' || keyword_term || '%',
                false
              )
            )
        )
      ORDER BY p.spec_sort_key ASC NULLS LAST, p.product_name ASC NULLS LAST, p.id ASC
    ) AS price_candidate
    ),
    '[]'::jsonb
  ) AS price_candidates,
  COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(category_candidate))
      FROM (
        SELECT
          p.category,
          p.material,
          COUNT(*) AS candidate_count,
          MIN(p.erp_item_code) AS example_erp_item_code,
          MIN(p.product_name) AS example_product_name
        FROM steel.prices AS p
        WHERE input_query.mode = 'category_discovery'
          AND ($2::boolean OR p.active = true)
          AND p.value_state <> 'no_price'
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(input_query.keyword_terms) AS keyword_term
            WHERE NOT COALESCE(
              p.spec_key ILIKE '%' || keyword_term || '%'
                OR p.product_name ILIKE '%' || keyword_term || '%'
                OR p.normalized_spec_text ILIKE '%' || keyword_term || '%'
                OR p.dimension_signature ILIKE '%' || keyword_term || '%'
                OR p.material ILIKE '%' || keyword_term || '%'
                OR p.erp_item_code ILIKE '%' || keyword_term || '%',
              false
            )
          )
      GROUP BY p.category, p.material
      ORDER BY candidate_count DESC, p.category ASC, p.material ASC NULLS LAST
    ) AS category_candidate
    ),
    '[]'::jsonb
  ) AS category_candidates
FROM input_queries AS input_query
ORDER BY input_query.query_index ASC
`;

const processingPriceCandidatesSql = `
SELECT
  p.id,
  p.erp_item_code,
  p.price_kind,
  p.formula_code,
  p.spec_key,
  p.product_name,
  p.normalized_spec_text,
  p.category,
  p.subcategory,
  p.processing_method,
  p.processing_shape,
  p.material,
  p.dimension_signature,
  p.unit,
  p.value_state,
  p.unit_price_base,
  p.unit_price_a,
  p.unit_price_b,
  p.unit_price_c,
  p.unit_price_d,
  p.unit_price_e,
  p.unit_price_f,
  p.price_ratio_a,
  p.price_ratio_b,
  p.price_ratio_c,
  p.price_ratio_d,
  p.price_ratio_e,
  p.price_ratio_f,
  p.unit_weight_value,
  p.unit_weight_basis,
  p.density,
  p.source_thickness,
  p.thickness_min_mm,
  p.thickness_max_mm,
  p.width_mm,
  p.height_mm,
  p.length_mm,
  p.outer_diameter_mm,
  p.nominal_inch,
  p.web_mm,
  p.flange_mm,
  p.lip_mm,
  p.sheet_width_mm,
  p.sheet_length_mm,
  p.spec_sort_key,
  p.cost_basis,
  p.currency,
  p.active,
  p.source_refs
FROM steel.prices AS p
WHERE ($1::boolean OR p.active = true)
  AND p.value_state <> 'no_price'
  AND (
    ($3::text[] IS NULL AND p.category = ANY($2::text[]))
    OR ($3::text[] IS NOT NULL AND p.product_name = ANY($3::text[]))
  )
ORDER BY p.category ASC, p.spec_sort_key ASC NULLS LAST, p.product_name ASC NULLS LAST, p.id ASC
`;

export async function searchSteelPriceCandidateGroups(
  client: SteelRepositoryClient,
  input: SearchSteelPriceCandidateGroupsInput,
): Promise<SteelPriceCandidateGroup[]> {
  if (input.queries.length === 0) {
    return [];
  }

  const serializedQueries = input.queries.map(serializePriceQuery);
  const result = await client.query<SteelPriceCandidateGroupRow>(groupedPriceCandidatesSql, [
    JSON.stringify(serializedQueries),
    input.includeInactive ?? false,
  ]);

  return result.rows
    .map(toCandidateGroup)
    .sort((left, right) => left.queryIndex - right.queryIndex);
}

export async function searchSteelProcessingPriceCandidates(
  client: SteelRepositoryClient,
  input: SearchSteelProcessingPriceCandidatesInput = {},
): Promise<SteelPriceItem[]> {
  const result = await client.query<SteelPriceItemRow>(processingPriceCandidatesSql, [
    input.includeInactive ?? false,
    input.categories ?? processingPriceCategories,
    null,
  ]);

  return dedupePriceItems(result.rows);
}

export async function searchSteelPricesByProductNames(
  client: SteelRepositoryClient,
  productNames: readonly string[],
): Promise<SteelPriceItem[]> {
  if (productNames.length === 0) {
    return [];
  }

  const result = await client.query<SteelPriceItemRow>(processingPriceCandidatesSql, [
    false,
    [],
    productNames,
  ]);

  return dedupePriceItems(result.rows);
}
