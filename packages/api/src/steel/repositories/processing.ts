import {
  getLimit,
  parseJsonObject,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
  parseValueState,
} from './types';

import type {
  SteelJsonValue,
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
  SteelValueState,
} from './types';

interface SearchStateInput {
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

interface ProcessingPriceRow {
  id: string | number;
  processing_type: string;
  product_family: string | null;
  spec_key: string | null;
  unit: string;
  unit_price: string | number | null;
  min_price: string | number | null;
  currency: string;
  value_state: string;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}

interface HolePriceRow {
  id: string | number;
  hole_type: string;
  diameter_mm: string | number | null;
  length_mm: string | number | null;
  width_mm: string | number | null;
  dimension_label: string | null;
  thickness_min_mm: string | number | null;
  thickness_max_mm: string | number | null;
  unit: string;
  unit_price: string | number | null;
  currency: string;
  value_state: string;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}

interface SlottingPriceRow {
  id: string | number;
  slot_type: string;
  length_mm: string | number | null;
  width_mm: string | number | null;
  unit: string;
  unit_price: string | number | null;
  currency: string;
  value_state: string;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}

interface BendingPriceRow {
  id: string | number;
  bend_type: string;
  catalog_family: string | null;
  thickness_min_mm: string | number | null;
  thickness_max_mm: string | number | null;
  unit: string;
  unit_price: string | number | null;
  currency: string;
  value_state: string;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}

interface MaterialRuleRow {
  id: string | number;
  code: string;
  name: string;
  rule_type: string;
  rule_body: SteelJsonValue | null;
  priority: string | number;
  catalog_family: string | null;
  condition_type: string | null;
  active: boolean;
  review_state: string;
  source_refs: unknown;
}

export interface SteelChargeRow extends SteelSourceBackedRecord {
  id: number;
  unit: string;
  unitPrice: number | null;
  currency: string;
  valueState: SteelValueState;
  reviewState: SteelReviewState;
  active: boolean;
  sourceRefs: SteelSourceRef[];
}

export interface SteelProcessingPrice extends SteelChargeRow {
  processingType: string;
  productFamily?: string;
  specKey?: string;
  minPrice: number | null;
}

export interface SteelHolePrice extends SteelChargeRow {
  holeType: string;
  diameterMm: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  dimensionLabel?: string;
  thicknessMinMm: number | null;
  thicknessMaxMm: number | null;
}

export interface SteelSlottingPrice extends SteelChargeRow {
  slotType: string;
  lengthMm: number | null;
  widthMm: number | null;
}

export interface SteelBendingPrice extends SteelChargeRow {
  bendType: string;
  catalogFamily?: string;
  thicknessMinMm: number | null;
  thicknessMaxMm: number | null;
}

export interface SteelMaterialRule extends SteelSourceBackedRecord {
  id: number;
  code: string;
  name: string;
  ruleType: string;
  ruleBody: SteelJsonValue;
  priority: number;
  catalogFamily?: string;
  conditionType?: string;
  active: boolean;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

interface SearchSteelProcessingPricesInput extends SearchStateInput {
  processingType?: string;
  productFamily?: string;
  specKey?: string;
}

interface SearchSteelHolePricesInput extends SearchStateInput {
  holeType?: string;
  diameterMm?: number;
  lengthMm?: number;
  widthMm?: number;
  dimensionLabel?: string;
}

interface SearchSteelSlottingPricesInput extends SearchStateInput {
  slotType?: string;
}

interface SearchSteelBendingPricesInput extends SearchStateInput {
  bendType?: string;
  catalogFamily?: string;
}

interface SearchSteelMaterialRulesInput extends SearchStateInput {
  catalogFamily?: string;
  ruleType?: string;
  conditionType?: string;
}

function addDefaultStateFilters(
  where: string[],
  values: SteelSqlParameter[],
  input: SearchStateInput,
) {
  values.push(input.reviewState ?? 'reviewed');
  where.push(`review_state = $${values.length}`);

  if (!input.includeInactive) {
    where.push('active = true');
  }
}

function addOptionalFilter(
  where: string[],
  values: SteelSqlParameter[],
  column: string,
  value: string | undefined,
) {
  if (!value) {
    return;
  }

  values.push(value);
  where.push(`${column} = $${values.length}`);
}

function addOptionalNumberFilter(
  where: string[],
  values: SteelSqlParameter[],
  column: string,
  value: number | undefined,
) {
  if (value === undefined) {
    return;
  }

  values.push(value);
  where.push(`${column} = $${values.length}`);
}

function mapCharge(row: {
  id: string | number;
  unit: string;
  unit_price: string | number | null;
  currency: string;
  value_state: string;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}): SteelChargeRow {
  return {
    id: parseRequiredNumber(row.id),
    unit: row.unit,
    unitPrice: parseNullableNumber(row.unit_price),
    currency: row.currency,
    valueState: parseValueState(row.value_state),
    reviewState: parseReviewState(row.review_state),
    active: row.active,
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function searchSteelProcessingPrices(
  client: SteelRepositoryClient,
  input: SearchSteelProcessingPricesInput,
): Promise<SteelProcessingPrice[]> {
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];
  addDefaultStateFilters(where, values, input);
  addOptionalFilter(where, values, 'processing_type', input.processingType);
  addOptionalFilter(where, values, 'product_family', input.productFamily);
  addOptionalFilter(where, values, 'spec_key', input.specKey);
  values.push(getLimit(input.limit));

  const result = await client.query<ProcessingPriceRow>(
    `
SELECT
  id,
  processing_type,
  product_family,
  spec_key,
  unit,
  unit_price,
  min_price,
  currency,
  value_state,
  review_state,
  active,
  source_refs
FROM steel.processing_prices
WHERE ${where.join('\n  AND ')}
ORDER BY processing_type ASC, product_family ASC NULLS LAST, spec_key ASC NULLS LAST, id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map((row) => ({
    ...mapCharge(row),
    processingType: row.processing_type,
    productFamily: parseNullableString(row.product_family),
    specKey: parseNullableString(row.spec_key),
    minPrice: parseNullableNumber(row.min_price),
  }));
}

export async function searchSteelHolePrices(
  client: SteelRepositoryClient,
  input: SearchSteelHolePricesInput,
): Promise<SteelHolePrice[]> {
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];
  addDefaultStateFilters(where, values, input);
  addOptionalFilter(where, values, 'hole_type', input.holeType);
  addOptionalNumberFilter(where, values, 'diameter_mm', input.diameterMm);
  addOptionalNumberFilter(where, values, 'length_mm', input.lengthMm);
  addOptionalNumberFilter(where, values, 'width_mm', input.widthMm);
  addOptionalFilter(where, values, 'dimension_label', input.dimensionLabel);
  values.push(getLimit(input.limit));

  const result = await client.query<HolePriceRow>(
    `
SELECT
  id,
  hole_type,
  diameter_mm,
  length_mm,
  width_mm,
  dimension_label,
  thickness_min_mm,
  thickness_max_mm,
  unit,
  unit_price,
  currency,
  value_state,
  review_state,
  active,
  source_refs
FROM steel.hole_prices
WHERE ${where.join('\n  AND ')}
ORDER BY
  hole_type ASC,
  diameter_mm ASC NULLS LAST,
  length_mm ASC NULLS LAST,
  width_mm ASC NULLS LAST,
  id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map((row) => ({
    ...mapCharge(row),
    holeType: row.hole_type,
    diameterMm: parseNullableNumber(row.diameter_mm),
    lengthMm: parseNullableNumber(row.length_mm),
    widthMm: parseNullableNumber(row.width_mm),
    dimensionLabel: parseNullableString(row.dimension_label),
    thicknessMinMm: parseNullableNumber(row.thickness_min_mm),
    thicknessMaxMm: parseNullableNumber(row.thickness_max_mm),
  }));
}

export async function searchSteelSlottingPrices(
  client: SteelRepositoryClient,
  input: SearchSteelSlottingPricesInput,
): Promise<SteelSlottingPrice[]> {
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];
  addDefaultStateFilters(where, values, input);
  addOptionalFilter(where, values, 'slot_type', input.slotType);
  values.push(getLimit(input.limit));

  const result = await client.query<SlottingPriceRow>(
    `
SELECT
  id,
  slot_type,
  length_mm,
  width_mm,
  unit,
  unit_price,
  currency,
  value_state,
  review_state,
  active,
  source_refs
FROM steel.slotting_prices
WHERE ${where.join('\n  AND ')}
ORDER BY slot_type ASC, length_mm ASC NULLS LAST, width_mm ASC NULLS LAST, id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map((row) => ({
    ...mapCharge(row),
    slotType: row.slot_type,
    lengthMm: parseNullableNumber(row.length_mm),
    widthMm: parseNullableNumber(row.width_mm),
  }));
}

export async function searchSteelBendingPrices(
  client: SteelRepositoryClient,
  input: SearchSteelBendingPricesInput,
): Promise<SteelBendingPrice[]> {
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];
  addDefaultStateFilters(where, values, input);
  addOptionalFilter(where, values, 'bend_type', input.bendType);
  addOptionalFilter(where, values, 'catalog_family', input.catalogFamily);
  values.push(getLimit(input.limit));

  const result = await client.query<BendingPriceRow>(
    `
SELECT
  id,
  bend_type,
  catalog_family,
  thickness_min_mm,
  thickness_max_mm,
  unit,
  unit_price,
  currency,
  value_state,
  review_state,
  active,
  source_refs
FROM steel.bending_prices
WHERE ${where.join('\n  AND ')}
ORDER BY bend_type ASC, catalog_family ASC NULLS LAST, id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map((row) => ({
    ...mapCharge(row),
    bendType: row.bend_type,
    catalogFamily: parseNullableString(row.catalog_family),
    thicknessMinMm: parseNullableNumber(row.thickness_min_mm),
    thicknessMaxMm: parseNullableNumber(row.thickness_max_mm),
  }));
}

export async function searchSteelMaterialRules(
  client: SteelRepositoryClient,
  input: SearchSteelMaterialRulesInput,
): Promise<SteelMaterialRule[]> {
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];
  addDefaultStateFilters(where, values, input);
  addOptionalFilter(where, values, 'catalog_family', input.catalogFamily);
  addOptionalFilter(where, values, 'rule_type', input.ruleType);
  addOptionalFilter(where, values, 'condition_type', input.conditionType);
  values.push(getLimit(input.limit));

  const result = await client.query<MaterialRuleRow>(
    `
SELECT
  id,
  code,
  name,
  rule_type,
  rule_body,
  priority,
  catalog_family,
  condition_type,
  active,
  review_state,
  source_refs
FROM steel.material_rules
WHERE ${where.join('\n  AND ')}
ORDER BY priority ASC, code ASC, id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map((row) => ({
    id: parseRequiredNumber(row.id),
    code: row.code,
    name: row.name,
    ruleType: row.rule_type,
    ruleBody: parseJsonObject(row.rule_body),
    priority: parseRequiredNumber(row.priority),
    catalogFamily: parseNullableString(row.catalog_family),
    conditionType: parseNullableString(row.condition_type),
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  }));
}
