import { isPriceCategory, isPriceSubcategory } from './categories';

import type { PriceCategory, PriceSubcategory } from './categories';

export type SteelPriceV4Cell = string | number | null | undefined;
export type SteelPriceV4ValueState = 'confirmed' | 'ratio_only' | 'no_price';
export type SteelPriceV4Kind = 'product' | 'cutting' | 'hole';
export type SteelPriceV4CostBasis = '1.總數' | '2.數量';

export const steelPriceV4SourceDataset = 'product_price_v4_3' as const;
export const steelPriceV4WorkbookHeaders = Object.freeze([
  'erp_item_code',
  'formula_code',
  'product_name',
  'normalized_spec_text',
  'category',
  'subcategory',
  'material',
  'dimension_signature',
  'unit',
  'value_state',
  'unit_price_base',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_d',
  'unit_price_e',
  'unit_price_f',
  'price_ratio_a',
  'price_ratio_b',
  'price_ratio_c',
  'price_ratio_d',
  'price_ratio_e',
  'price_ratio_f',
  'unit_weight_value',
  'unit_weight_basis',
  'density',
  'source_thickness',
  'width_mm',
  'height_mm',
  'length_mm',
  'outer_diameter_mm',
  'nominal_inch',
  'web_mm',
  'flange_mm',
  'lip_mm',
  'sheet_width_mm',
  'sheet_length_mm',
  'spec_sort_key',
  'cost_basis',
] as const);

export interface SteelPriceV4WorkbookRow
  extends Record<(typeof steelPriceV4WorkbookHeaders)[number], SteelPriceV4Cell> {}

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
  thicknessMinMm: number | null;
  thicknessMaxMm: number | null;
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
  costBasis: SteelPriceV4CostBasis;
  specKey: string;
  priceKind: SteelPriceV4Kind;
  sourceDataset: typeof steelPriceV4SourceDataset;
  sourceRowKey: string;
  currency: 'TWD';
  active: boolean;
}

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
    throw new Error(`Steel price v4.3 row requires ${field}`);
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
    throw new Error(`Invalid Steel price v4.3 number for ${field}: ${text}`);
  }

  return parsed;
}

function parseZeroAsNullNumber(value: SteelPriceV4Cell, field: string): number | null {
  const parsed = parseNumber(value, field);

  if (parsed !== null && parsed < 0) {
    throw new Error(`Steel price v4.3 ${field} must be nonnegative`);
  }

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

  throw new Error(`Unknown Steel price v4.3 value_state: ${state}`);
}

function parseCostBasis(value: SteelPriceV4Cell): SteelPriceV4CostBasis {
  const costBasis = parseRequiredText(value, 'cost_basis');
  if (costBasis === '1.總數' || costBasis === '2.數量') {
    return costBasis;
  }

  throw new Error(`Unknown Steel price v4.3 cost_basis: ${costBasis}`);
}

function getPriceKind(category: PriceCategory): SteelPriceV4Kind {
  if (category === '加工/孔') {
    return 'hole';
  }

  return category.startsWith('加工/') ? 'cutting' : 'product';
}

interface ParsedNameAttributes {
  dimensionSignature?: string;
  thicknessMinMm?: number;
  thicknessMaxMm?: number;
  widthMm?: number;
  lengthMm?: number;
  diameterMm?: number;
}

function parseNameRange(
  match: RegExpMatchArray | null,
): { thicknessMinMm: number; thicknessMaxMm: number } | undefined {
  if (!match?.[1]) {
    return undefined;
  }

  const thicknessMinMm = Number(match[1]);
  const thicknessMaxMm = Number(match[2] ?? match[1]);
  if (thicknessMinMm <= 0 || thicknessMaxMm < thicknessMinMm) {
    return undefined;
  }

  return { thicknessMinMm, thicknessMaxMm };
}

function parseNameAttributes(
  category: PriceCategory,
  productName: string | null,
  normalizedSpecText: string | null,
): ParsedNameAttributes {
  const text = `${productName ?? ''} ${normalizedSpecText ?? ''}`
    .normalize('NFKC')
    .replace(/[＊*×]/gu, 'x');

  if (category === '加工/孔') {
    const angle = text.match(
      /(\d+(?:\.\d+)?)\s*mm\s*x\s*(\d+(?:\.\d+)?)\s*(單|雙)\s*x\s*(\d+(?:\.\d+)?)\s*m\b/iu,
    );
    if (angle?.[1] && angle[2] && angle[3] && angle[4]) {
      const widthMm = Number(angle[1]);
      const thickness = Number(angle[2]);
      const lengthMm = Number(angle[4]) * 1000;
      const punch = angle[3] === '單' ? 'single' : 'double';

      return {
        widthMm,
        lengthMm,
        thicknessMinMm: thickness,
        thicknessMaxMm: thickness,
        dimensionSignature: `w${widthMm}|t${thickness}|l${lengthMm}|punch:${punch}`,
      };
    }

    const hole = text.match(/沖\s*(\d+(?:\s+\d+\/\d+|\/\d+)?)\s*([□○])\s*孔/iu);
    if (hole?.[1] && hole[2]) {
      return { dimensionSignature: `hole:${hole[1].replace(/\s+/gu, ' ')}|shape:${hole[2]}` };
    }

    return (
      parseNameRange(
        text.match(
          /厚度\s*(\d+(?:\.\d+)?)\s*(?:[-~～至]\s*(\d+(?:\.\d+)?))?\s*(?:m\s*\/\s*m|mm|t)?/iu,
        ),
      ) ?? {}
    );
  }

  if (category === '加工/切工') {
    return (
      parseNameRange(text.match(/^(\d+(?:\.\d+)?)\s*[-~～至]\s*(\d+(?:\.\d+)?)\s*mm\s*板切/iu)) ??
      parseNameRange(text.match(/^(\d+(?:\.\d+)?)\s+雷射切割/iu)) ??
      parseNameRange(text.match(/雷射切割\(\s*(\d+(?:\.\d+)?)\s*\)/iu)) ??
      {}
    );
  }

  if (category === '加工/折工') {
    return (
      parseNameRange(text.match(/型\(\s*(\d+(?:\.\d+)?)\s*[-~～至]\s*(\d+(?:\.\d+)?)\s*\)/iu)) ?? {}
    );
  }

  if (category === '圓條') {
    const diameter = text.match(/(?:光圓|圓條|圓鐵)\s*(\d+(?:\.\d+)?)\s*(?:m\s*\/\s*m|mm)/iu)?.[1];
    return diameter ? { diameterMm: Number(diameter) } : {};
  }

  return {};
}

function parseThicknessBand(
  category: PriceCategory,
  productName: string | null,
  normalizedSpecText: string | null,
  sourceThickness: string | null,
): { thicknessMinMm: number | null; thicknessMaxMm: number | null } {
  const sourceMatch = sourceThickness?.match(
    /^([0-9]+(?:\.[0-9]+)?)\s*(?:[-~～至]\s*([0-9]+(?:\.[0-9]+)?))?\s*(?:m\s*\/\s*m|mm|t)?$/iu,
  );
  if (sourceThickness !== null && !sourceMatch?.[1]) {
    throw new Error(`Invalid Steel source thickness: ${sourceThickness}`);
  }
  const sourceMinMm = sourceMatch?.[1] ? Number(sourceMatch[1]) : null;
  const sourceMaxMm = sourceMatch?.[2] ? Number(sourceMatch[2]) : sourceMinMm;
  if (
    sourceMinMm !== null &&
    (sourceMinMm <= 0 || sourceMaxMm === null || sourceMaxMm < sourceMinMm)
  ) {
    throw new Error(`Invalid Steel source thickness: ${sourceThickness}`);
  }
  const derived = parseNameAttributes(category, productName, normalizedSpecText);
  if (derived.thicknessMinMm !== undefined && derived.thicknessMaxMm !== undefined) {
    return {
      thicknessMinMm: derived.thicknessMinMm,
      thicknessMaxMm: derived.thicknessMaxMm,
    };
  }

  return { thicknessMinMm: sourceMinMm, thicknessMaxMm: sourceMaxMm };
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

  throw new Error(`Steel price v4.3 ${state} row violates price and ratio invariants`);
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
  const productName = parseText(row.product_name);
  const sourceThickness = parseZeroAsNullText(row.source_thickness);
  const nameAttributes = parseNameAttributes(category, productName, normalizedSpecText);
  const thicknessBand = parseThicknessBand(
    category,
    productName,
    normalizedSpecText,
    sourceThickness,
  );

  validateValueState(
    valueState,
    [unitPriceBase, unitPriceA, unitPriceB, unitPriceC, unitPriceD, unitPriceE, unitPriceF],
    [priceRatioA, priceRatioB, priceRatioC, priceRatioD, priceRatioE, priceRatioF],
  );

  return {
    formulaCode: parseText(row.formula_code),
    erpItemCode,
    productName,
    normalizedSpecText,
    category,
    subcategory,
    material: parseText(row.material),
    dimensionSignature: nameAttributes.dimensionSignature ?? parseText(row.dimension_signature),
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
    sourceThickness,
    ...thicknessBand,
    widthMm: nameAttributes.widthMm ?? parseZeroAsNullNumber(row.width_mm, 'width_mm'),
    heightMm: parseZeroAsNullNumber(row.height_mm, 'height_mm'),
    lengthMm: nameAttributes.lengthMm ?? parseZeroAsNullNumber(row.length_mm, 'length_mm'),
    outerDiameterMm:
      nameAttributes.diameterMm ??
      parseZeroAsNullNumber(row.outer_diameter_mm, 'outer_diameter_mm'),
    nominalInch: parseText(row.nominal_inch),
    webMm: parseZeroAsNullNumber(row.web_mm, 'web_mm'),
    flangeMm: parseZeroAsNullNumber(row.flange_mm, 'flange_mm'),
    lipMm: parseZeroAsNullNumber(row.lip_mm, 'lip_mm'),
    sheetWidthMm: parseZeroAsNullNumber(row.sheet_width_mm, 'sheet_width_mm'),
    sheetLengthMm: parseZeroAsNullNumber(row.sheet_length_mm, 'sheet_length_mm'),
    specSortKey: parseText(row.spec_sort_key),
    costBasis: parseCostBasis(row.cost_basis),
    specKey: normalizedSpecText ? `${erpItemCode} ${normalizedSpecText}` : erpItemCode,
    priceKind: getPriceKind(category),
    sourceDataset: steelPriceV4SourceDataset,
    sourceRowKey: erpItemCode,
    currency: 'TWD',
    active: true,
  };
}

export function buildSteelPriceV4Rows(rows: readonly SteelPriceV4WorkbookRow[]): SteelPriceV4Row[] {
  return rows.map(parseRow);
}
