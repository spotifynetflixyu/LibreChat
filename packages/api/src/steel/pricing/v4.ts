import { isPriceCategory, isPriceSubcategory } from './categories';

import type { PriceCategory, PriceSubcategory } from './categories';
import type { SteelReviewState } from '../repositories/types';

export type SteelPriceV4Cell = string | number | null | undefined;
export type SteelPriceV4ValueState = 'confirmed' | 'ratio_only' | 'no_price';
export type SteelPriceV4Kind = 'product' | 'cutting' | 'hole';

export interface SteelPriceV4WorkbookRow {
  formula_code: SteelPriceV4Cell;
  erp_item_code: SteelPriceV4Cell;
  product_name: SteelPriceV4Cell;
  normalized_spec_text: SteelPriceV4Cell;
  category: SteelPriceV4Cell;
  subcategory: SteelPriceV4Cell;
  material: SteelPriceV4Cell;
  dimension_signature: SteelPriceV4Cell;
  unit: SteelPriceV4Cell;
  value_state: SteelPriceV4Cell;
  unit_price_base: SteelPriceV4Cell;
  unit_price_a: SteelPriceV4Cell;
  unit_price_b: SteelPriceV4Cell;
  unit_price_c: SteelPriceV4Cell;
  unit_price_d: SteelPriceV4Cell;
  unit_price_e: SteelPriceV4Cell;
  unit_price_f: SteelPriceV4Cell;
  price_ratio_a: SteelPriceV4Cell;
  price_ratio_b: SteelPriceV4Cell;
  price_ratio_c: SteelPriceV4Cell;
  price_ratio_d: SteelPriceV4Cell;
  price_ratio_e: SteelPriceV4Cell;
  price_ratio_f: SteelPriceV4Cell;
  unit_weight_value: SteelPriceV4Cell;
  unit_weight_basis: SteelPriceV4Cell;
  density: SteelPriceV4Cell;
  source_thickness: SteelPriceV4Cell;
  width_mm: SteelPriceV4Cell;
  height_mm: SteelPriceV4Cell;
  length_mm: SteelPriceV4Cell;
  outer_diameter_mm: SteelPriceV4Cell;
  nominal_inch: SteelPriceV4Cell;
  web_mm: SteelPriceV4Cell;
  flange_mm: SteelPriceV4Cell;
  lip_mm: SteelPriceV4Cell;
  sheet_width_mm: SteelPriceV4Cell;
  sheet_length_mm: SteelPriceV4Cell;
  spec_sort_key: SteelPriceV4Cell;
  cost_basis: SteelPriceV4Cell;
}

export interface SteelPriceV4Row {
  formulaCode: string | null;
  erpItemCode: string;
  productName: string | null;
  normalizedSpecText: string | null;
  category: PriceCategory;
  subcategory: PriceSubcategory;
  material: string | null;
  dimensionSignature: string | null;
  unit: string | null;
  valueState: SteelPriceV4ValueState;
  unitPriceBase: number | null;
  unitPriceA: number | null;
  unitPriceB: number | null;
  unitPriceC: number | null;
  unitPriceD: number | null;
  unitPriceE: number | null;
  unitPriceF: number | null;
  priceRatioA: number | null;
  priceRatioB: number | null;
  priceRatioC: number | null;
  priceRatioD: number | null;
  priceRatioE: number | null;
  priceRatioF: number | null;
  unitWeightValue: number | null;
  unitWeightBasis: string | null;
  density: number | null;
  sourceThickness: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  outerDiameterMm: number | null;
  nominalInch: string | null;
  webMm: number | null;
  flangeMm: number | null;
  lipMm: number | null;
  sheetWidthMm: number | null;
  sheetLengthMm: number | null;
  specSortKey: string | null;
  costBasis: string | null;
  specKey: string;
  priceKind: SteelPriceV4Kind;
  sourceDataset: 'product_price_v4_2';
  sourceRowKey: string;
  currency: 'TWD';
  active: boolean;
  reviewState: SteelReviewState;
}

const sourceDataset = 'product_price_v4_2' as const;

function parseText(value: SteelPriceV4Cell): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).normalize('NFKC').trim();

  return normalized || null;
}

function parseRequiredText(value: SteelPriceV4Cell, field: string): string {
  const parsed = parseText(value);

  if (parsed === null) {
    throw new Error(`Steel price v4.2 row requires ${field}`);
  }

  return parsed;
}

function parseNumber(value: SteelPriceV4Cell, field: string): number | null {
  const text = parseText(value);
  if (text === null) {
    return null;
  }

  const parsed = Number(text.replace(/,/gu, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Steel price v4.2 number for ${field}: ${text}`);
  }

  return parsed;
}

function parseZeroAsNullNumber(value: SteelPriceV4Cell, field: string): number | null {
  const parsed = parseNumber(value, field);

  return parsed === 0 ? null : parsed;
}

function parseZeroAsNullText(value: SteelPriceV4Cell): string | null {
  const parsed = parseText(value);
  if (parsed === null) {
    return null;
  }

  const numericValue = Number(parsed.replace(/,/gu, ''));

  return Number.isFinite(numericValue) && numericValue === 0 ? null : parsed;
}

function parseCategory(value: SteelPriceV4Cell): PriceCategory {
  const category = parseRequiredText(value, 'category');
  if (!isPriceCategory(category)) {
    throw new Error(`Unknown Steel price category: ${category}`);
  }

  return category;
}

function parseSubcategory(category: PriceCategory, value: SteelPriceV4Cell): PriceSubcategory {
  const subcategory = parseText(value) ?? '';
  if (!isPriceSubcategory(category, subcategory)) {
    throw new Error(`Invalid Steel price subcategory ${subcategory} for category ${category}`);
  }

  return subcategory;
}

function parseValueState(value: SteelPriceV4Cell): SteelPriceV4ValueState {
  const state = parseRequiredText(value, 'value_state');

  if (state === 'confirmed' || state === 'ratio_only' || state === 'no_price') {
    return state;
  }

  throw new Error(`Unknown Steel price v4.2 value_state: ${state}`);
}

function getPriceKind(category: PriceCategory): SteelPriceV4Kind {
  if (category === '加工/孔') {
    return 'hole';
  }

  return category.startsWith('加工/') ? 'cutting' : 'product';
}

function validateValueState(
  state: SteelPriceV4ValueState,
  prices: readonly (number | null)[],
  ratios: readonly (number | null)[],
): void {
  const hasPrice = prices.some((price) => price !== null);
  const hasRatio = ratios.some((ratio) => ratio !== null);

  if (state === 'confirmed' && hasPrice) {
    return;
  }
  if (state === 'ratio_only' && !hasPrice && hasRatio) {
    return;
  }
  if (state === 'no_price' && !hasPrice && !hasRatio) {
    return;
  }

  throw new Error(`Steel price v4.2 ${state} row violates price and ratio invariants`);
}

function parseRow(row: SteelPriceV4WorkbookRow): SteelPriceV4Row {
  const erpItemCode = parseRequiredText(row.erp_item_code, 'erp_item_code');
  const normalizedSpecText = parseText(row.normalized_spec_text);
  const category = parseCategory(row.category);
  const subcategory = parseSubcategory(category, row.subcategory);
  const valueState = parseValueState(row.value_state);
  const unitPriceBase = parseZeroAsNullNumber(row.unit_price_base, 'unit_price_base');
  const unitPriceA = parseZeroAsNullNumber(row.unit_price_a, 'unit_price_a');
  const unitPriceB = parseZeroAsNullNumber(row.unit_price_b, 'unit_price_b');
  const unitPriceC = parseZeroAsNullNumber(row.unit_price_c, 'unit_price_c');
  const unitPriceD = parseZeroAsNullNumber(row.unit_price_d, 'unit_price_d');
  const unitPriceE = parseZeroAsNullNumber(row.unit_price_e, 'unit_price_e');
  const unitPriceF = parseZeroAsNullNumber(row.unit_price_f, 'unit_price_f');
  const priceRatioA = parseZeroAsNullNumber(row.price_ratio_a, 'price_ratio_a');
  const priceRatioB = parseZeroAsNullNumber(row.price_ratio_b, 'price_ratio_b');
  const priceRatioC = parseZeroAsNullNumber(row.price_ratio_c, 'price_ratio_c');
  const priceRatioD = parseZeroAsNullNumber(row.price_ratio_d, 'price_ratio_d');
  const priceRatioE = parseZeroAsNullNumber(row.price_ratio_e, 'price_ratio_e');
  const priceRatioF = parseZeroAsNullNumber(row.price_ratio_f, 'price_ratio_f');

  validateValueState(
    valueState,
    [unitPriceBase, unitPriceA, unitPriceB, unitPriceC, unitPriceD, unitPriceE, unitPriceF],
    [priceRatioA, priceRatioB, priceRatioC, priceRatioD, priceRatioE, priceRatioF],
  );

  return {
    formulaCode: parseText(row.formula_code),
    erpItemCode,
    productName: parseText(row.product_name),
    normalizedSpecText,
    category,
    subcategory,
    material: parseText(row.material),
    dimensionSignature: parseText(row.dimension_signature),
    unit: parseText(row.unit),
    valueState,
    unitPriceBase,
    unitPriceA,
    unitPriceB,
    unitPriceC,
    unitPriceD,
    unitPriceE,
    unitPriceF,
    priceRatioA,
    priceRatioB,
    priceRatioC,
    priceRatioD,
    priceRatioE,
    priceRatioF,
    unitWeightValue: parseZeroAsNullNumber(row.unit_weight_value, 'unit_weight_value'),
    unitWeightBasis: parseText(row.unit_weight_basis),
    density: parseZeroAsNullNumber(row.density, 'density'),
    sourceThickness: parseZeroAsNullText(row.source_thickness),
    widthMm: parseZeroAsNullNumber(row.width_mm, 'width_mm'),
    heightMm: parseZeroAsNullNumber(row.height_mm, 'height_mm'),
    lengthMm: parseZeroAsNullNumber(row.length_mm, 'length_mm'),
    outerDiameterMm: parseZeroAsNullNumber(row.outer_diameter_mm, 'outer_diameter_mm'),
    nominalInch: parseText(row.nominal_inch),
    webMm: parseZeroAsNullNumber(row.web_mm, 'web_mm'),
    flangeMm: parseZeroAsNullNumber(row.flange_mm, 'flange_mm'),
    lipMm: parseZeroAsNullNumber(row.lip_mm, 'lip_mm'),
    sheetWidthMm: parseZeroAsNullNumber(row.sheet_width_mm, 'sheet_width_mm'),
    sheetLengthMm: parseZeroAsNullNumber(row.sheet_length_mm, 'sheet_length_mm'),
    specSortKey: parseText(row.spec_sort_key),
    costBasis: parseText(row.cost_basis),
    specKey: normalizedSpecText ? `${erpItemCode} ${normalizedSpecText}` : erpItemCode,
    priceKind: getPriceKind(category),
    sourceDataset,
    sourceRowKey: erpItemCode,
    currency: 'TWD',
    active: true,
    reviewState: 'reviewed',
  };
}

export function buildSteelPriceV4Rows(rows: readonly SteelPriceV4WorkbookRow[]): SteelPriceV4Row[] {
  return rows.map(parseRow);
}
