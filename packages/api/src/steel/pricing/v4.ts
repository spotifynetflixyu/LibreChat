import {
  isPriceCategory,
  isPriceSubcategory,
  isProcessingMethod,
  isProcessingShape,
} from './categories';
import { inferSteelPriceSubcategory } from './subcategory';

import type {
  PriceCategory,
  PriceSubcategory,
  ProcessingMethod,
  ProcessingShape,
} from './categories';

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

export type SteelPriceV4WorkbookRow = Record<
  (typeof steelPriceV4WorkbookHeaders)[number],
  SteelPriceV4Cell
> & {
  processing_method?: SteelPriceV4Cell;
  processing_shape?: SteelPriceV4Cell;
};

export interface SteelPriceV4Row {
  formulaCode: string | null;
  erpItemCode: string;
  productName: string | null;
  normalizedSpecText: string | null;
  category: PriceCategory;
  subcategory: PriceSubcategory;
  processingMethod: ProcessingMethod | null;
  processingShape: ProcessingShape | null;
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

function parseProcessingMethod(value: SteelPriceV4Cell): ProcessingMethod | null {
  const method = parseText(value);
  if (method === null || isProcessingMethod(method)) {
    return method;
  }
  throw new Error(`Unknown Steel processing_method: ${method}`);
}

function parseProcessingShape(value: SteelPriceV4Cell): ProcessingShape | null {
  const shape = parseText(value);
  if (shape === null || isProcessingShape(shape)) {
    return shape;
  }
  throw new Error(`Unknown Steel processing_shape: ${shape}`);
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
  heightMm?: number;
  lengthMm?: number;
  diameterMm?: number;
  nominalInch?: string;
  unitWeightValue?: number;
  webMm?: number;
  flangeMm?: number;
  sheetWidthMm?: number;
  sheetLengthMm?: number;
}

const sixMeterDefaultCategories = new Set<PriceCategory>([
  '平鐵',
  '角鐵',
  '圓管',
  '圓條',
  '扁方管',
  '方管',
  '槽鐵',
]);

const hotDipMaterialCategories = new Set<PriceCategory>([
  '平鐵',
  '角鐵',
  '圓管',
  '圓條',
  '扁方管',
  '方管',
  '槽鐵',
]);

function parseInchSize(value: string): { nominalInch: string; diameterMm: number } | undefined {
  const compactMixed = value.match(/^(\d)(\d)\/(\d)$/u);
  const canonical =
    compactMixed?.[1] && compactMixed[2] && compactMixed[3]
      ? `${compactMixed[1]} ${compactMixed[2]}/${compactMixed[3]}`
      : value;
  const mixed = canonical.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/u);
  if (!mixed?.[2] || !mixed[3]) {
    return undefined;
  }

  const whole = Number(mixed[1] ?? 0);
  const numerator = Number(mixed[2]);
  const denominator = Number(mixed[3]);
  if (denominator === 0 || numerator >= denominator) {
    return undefined;
  }

  const diameterMm = Math.round((whole + numerator / denominator) * 25.4 * 1_000_000) / 1_000_000;

  return { nominalInch: canonical, diameterMm };
}

function parseRoundBarNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  const spec = text.match(/(?:中碳光圓|圓條|圓鐵)\s*(.+)$/u)?.[1]?.trim();
  if (!spec) {
    return {};
  }

  const length = spec.match(/(?:x|\(|\s)(\d+(?:\.\d+)?)\s*M\b/iu)?.[1];
  const lengthMm = length ? Number(length) * 1000 : undefined;
  const explicitMetric = spec.match(/^(\d+(?:\.\d+)?)\s*(?:m\s*\/\s*m|mm)/iu);
  const metricRange = explicitMetric
    ? spec.slice(explicitMetric[0].length).match(/^\s*[-~～至]\s*\d/iu)
    : null;
  const bareMetric = spec.match(/^(\d+\.\d+)(?=\s*(?:x|\(|$))/u)?.[1];
  const metric = metricRange ? undefined : (explicitMetric?.[1] ?? bareMetric);
  if (metric) {
    const diameterMm = Number(metric);
    return {
      diameterMm,
      dimensionSignature: `od${diameterMm}`,
      ...(lengthMm === undefined ? {} : { lengthMm }),
    };
  }

  const fraction = spec.match(/^(\d+\/\d+)/u)?.[1];
  const inch = fraction ? parseInchSize(fraction) : undefined;
  if (inch) {
    return {
      ...inch,
      dimensionSignature: `od${inch.diameterMm}|in${inch.nominalInch}`,
      ...(lengthMm === undefined ? {} : { lengthMm }),
    };
  }

  const wholeInch = spec.match(/^(\d+)\s*(?:"|吋|(?=\s*\(整支\)))/u)?.[1];
  if (wholeInch) {
    const nominalInch = String(Number(wholeInch));
    const diameterMm = Number(wholeInch) * 25.4;
    return {
      diameterMm,
      nominalInch,
      dimensionSignature: `od${diameterMm}|in${nominalInch}`,
      ...(lengthMm === undefined ? {} : { lengthMm }),
    };
  }

  return lengthMm === undefined ? {} : { lengthMm };
}

function parseRoundPipeNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  if (text.includes('連料') || text.includes('太陽片')) {
    const specialInch = text.match(/(\d+\/\d+)[^\d]*圓管/u)?.[1];
    const inch = specialInch ? parseInchSize(specialInch) : undefined;
    return inch ?? {};
  }

  const metric = text.match(/(\d+(?:\.\d+)?)\s*(?:m\s*\/\s*m|mm)\s*x\s*(\d+(?:\.\d+)?)/iu);
  const inch = text.match(/(\d+(?:\s+\d+\/\d+|\/\d+)?|\d+")\s*x\s*(\d+(?:\.\d+)?)/u);
  const length = text.match(/x\s*(\d+(?:\.\d+)?)\s*([ML])\b/iu);
  const lengthMm = length?.[1]
    ? Number(length[1]) * (length[2]?.toUpperCase() === 'M' ? 1000 : 1)
    : undefined;
  const unitWeight = text.match(/\(\s*(\d+(?:\.\d+)?)\s*\)\s*$/u)?.[1];
  const unitWeightValue = unitWeight ? Number(unitWeight) : undefined;

  if (metric?.[1] && metric[2]) {
    const diameterMm = Number(metric[1]);
    const thicknessMm = Number(metric[2]);
    return {
      diameterMm,
      thicknessMinMm: thicknessMm,
      thicknessMaxMm: thicknessMm,
      dimensionSignature: `od${diameterMm}|t${thicknessMm}`,
      ...(lengthMm === undefined ? {} : { lengthMm }),
      ...(unitWeightValue === undefined ? {} : { unitWeightValue }),
    };
  }

  if (inch?.[1] && inch[2]) {
    const inchValue = inch[1].replace(/"/gu, '');
    const parsedInch = inchValue.includes('/')
      ? parseInchSize(inchValue)
      : {
          nominalInch: String(Number(inchValue)),
          diameterMm: Math.round(Number(inchValue) * 25.4 * 1_000_000) / 1_000_000,
        };
    if (!parsedInch) {
      return {};
    }
    const thicknessMm = Number(inch[2]);
    return {
      ...parsedInch,
      thicknessMinMm: thicknessMm,
      thicknessMaxMm: thicknessMm,
      dimensionSignature: `od${parsedInch.diameterMm}|in${parsedInch.nominalInch}|t${thicknessMm}`,
      ...(lengthMm === undefined ? {} : { lengthMm }),
      ...(unitWeightValue === undefined ? {} : { unitWeightValue }),
    };
  }

  return {};
}

function parseFlatBarNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  const spec = text.match(/平鐵\s*(\d+(?:\.\d+)?|\d+\/\d+)\s*x\s*(\d+(?:\.\d+)?)/u);
  if (!spec?.[1] || !spec[2]) {
    return {};
  }

  const fractionWidth = spec[1].includes('/') ? parseInchSize(spec[1]) : undefined;
  const widthMm = fractionWidth?.diameterMm ?? Number(spec[1]);
  const thicknessMm = Number(spec[2]);
  const weights = [...text.matchAll(/\(\s*(\d+(?:\.\d+)?)\s*\)/gu)];
  const weight = weights.at(-1)?.[1];

  return {
    widthMm,
    heightMm: thicknessMm,
    thicknessMinMm: thicknessMm,
    thicknessMaxMm: thicknessMm,
    dimensionSignature: `w${widthMm}|t${thicknessMm}`,
    ...(weight === undefined ? {} : { unitWeightValue: Number(weight) }),
  };
}

function parseSquareBarNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  const spec = text.match(/方鐵\s*(.+)$/u)?.[1]?.trim();
  if (!spec || (/切/u.test(spec) && /[-~～至]|以上|以內/u.test(spec))) {
    return {};
  }

  const metric = spec.match(/^(\d+(?:\.\d+)?)\s*(?:m\s*\/\s*m|mm)/iu)?.[1];
  const bareMetric = spec.match(/^(\d+\.\d+)(?=\s*(?:x|\(|$))/u)?.[1];
  const fraction = spec.match(/^(\d+\/\d+)\s*"?/u)?.[1];
  const inch = fraction ? parseInchSize(fraction) : undefined;
  let sideMm = inch?.diameterMm;
  if (bareMetric) {
    sideMm = Number(bareMetric);
  }
  if (metric) {
    sideMm = Number(metric);
  }
  if (sideMm === undefined) {
    return {};
  }

  const weights = [...spec.matchAll(/\(\s*(\d+(?:\.\d+)?)\s*\)/gu)];
  const weight = weights.at(-1)?.[1];
  const lengthMm = parseExplicitLongMaterialLengthMm(text);
  return {
    widthMm: sideMm,
    heightMm: sideMm,
    nominalInch: inch?.nominalInch,
    dimensionSignature: `s${sideMm}`,
    ...(lengthMm === undefined ? {} : { lengthMm }),
    ...(weight === undefined ? {} : { unitWeightValue: Number(weight) }),
  };
}

function parseSquareTubeSize(value: string): { sideMm: number; nominalInch?: string } | undefined {
  const compact = value.replace(/\s+/gu, '').replace(/"/gu, '');
  if (/mm$/iu.test(compact)) {
    const sideMm = Number(compact.replace(/mm$/iu, ''));
    return sideMm > 0 ? { sideMm } : undefined;
  }

  if (compact.includes('/')) {
    const inch = parseInchSize(compact);
    return inch ? { sideMm: inch.diameterMm, nominalInch: inch.nominalInch } : undefined;
  }

  if (value.includes('"')) {
    const sideInch = Number(compact);
    const sideMm = Math.round(sideInch * 25.4 * 1_000_000) / 1_000_000;
    return sideInch > 0 ? { sideMm, nominalInch: String(sideInch) } : undefined;
  }

  const sideMm = Number(compact);
  return sideMm > 0 ? { sideMm } : undefined;
}

function parseSquareTubeNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  const specialProduct = /太陽片|雨棚|沖孔窗|連料/u.test(text);
  if (specialProduct) {
    const beforeTube = text.match(
      /(\d+(?:\.\d+)?\s*mm|\d+(?:\s+\d+\/\d+|\/\d+)?)(?:白鐵)?方管/iu,
    )?.[1];
    const afterTube = text.match(/方管\s*(\d+(?:\.\d+)?\s*mm|\d+(?:\s+\d+\/\d+|\/\d+)?)/iu)?.[1];
    const parsed = parseSquareTubeSize(beforeTube ?? afterTube ?? '');
    if (!parsed) {
      return {};
    }

    return {
      widthMm: parsed.sideMm,
      heightMm: parsed.sideMm,
      nominalInch: parsed.nominalInch,
      dimensionSignature: `h${parsed.sideMm}|w${parsed.sideMm}${parsed.nominalInch ? `|in${parsed.nominalInch}` : ''}`,
    };
  }

  const spec = text.match(
    /方管\s*(?:正\s*)?(\d+(?:\.\d+)?\s*mm|\d+(?:\s+\d+\/\d+|\/\d+)?|\d+(?:\.\d+)?")\s*x\s*(\d+(?:\.\d+)?)/iu,
  );
  if (!spec?.[1] || !spec[2]) {
    return {};
  }

  const parsed = parseSquareTubeSize(spec[1]);
  if (!parsed) {
    return {};
  }

  const thicknessMm = Number(spec[2]);
  return {
    widthMm: parsed.sideMm,
    heightMm: parsed.sideMm,
    nominalInch: parsed.nominalInch,
    thicknessMinMm: thicknessMm,
    thicknessMaxMm: thicknessMm,
    dimensionSignature: `h${parsed.sideMm}|w${parsed.sideMm}|t${thicknessMm}${parsed.nominalInch ? `|in${parsed.nominalInch}` : ''}`,
  };
}

function parseRectangularTubeNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  const spec = text.match(
    /扁方管\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(\s*[ML])?/iu,
  );
  if (!spec?.[1] || !spec[2] || !spec[3]) {
    return {};
  }

  const widthMm = Number(spec[1]);
  const heightMm = Number(spec[2]);
  if (spec[4]) {
    return {
      widthMm,
      heightMm,
      dimensionSignature: `w${widthMm}|h${heightMm}`,
    };
  }

  const thicknessMm = Number(spec[3]);
  return {
    widthMm,
    heightMm,
    thicknessMinMm: thicknessMm,
    thicknessMaxMm: thicknessMm,
    dimensionSignature: `w${widthMm}|h${heightMm}|t${thicknessMm}`,
  };
}

function parseChannelNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  const lengthOnly = text.match(
    /槽鐵\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*[ML]\b/iu,
  );
  const spec = text.match(
    /槽鐵\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/iu,
  );
  const height = Number(lengthOnly?.[1] ?? spec?.[1]);
  const width = Number(lengthOnly?.[2] ?? spec?.[2]);
  if (!height || !width) {
    return {};
  }

  const lengthWeight = text.match(/[ML]\s*\(\s*(\d+(?:\.\d+)?)\s*\)/iu)?.[1];
  const base = {
    widthMm: width,
    heightMm: height,
    ...(lengthWeight === undefined ? {} : { unitWeightValue: Number(lengthWeight) }),
  };
  if (lengthOnly) {
    return { ...base, dimensionSignature: `h${height}|w${width}` };
  }

  const webMm = Number(spec?.[3]);
  if (!webMm) {
    return base;
  }
  const flangeMm = spec?.[4] ? Number(spec[4]) : webMm;
  return {
    ...base,
    webMm,
    flangeMm,
    thicknessMinMm: webMm,
    thicknessMaxMm: webMm,
    dimensionSignature: `h${height}|w${width}|web${webMm}|flange${flangeMm}`,
  };
}

function parseAngleNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source || /塑膠腳套/u.test(source)) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  const unequal = text.match(
    /(?:角鐵|角鋼)\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?=\s*x|\s*\(|\s*$)/u,
  );
  const equal = text.match(/角鐵\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/u);
  const heightMm = Number(unequal?.[1] ?? equal?.[1]);
  const widthMm = Number(unequal?.[2] ?? equal?.[1]);
  const thicknessMm = Number(unequal?.[3] ?? equal?.[2]);
  if (!heightMm || !widthMm || !thicknessMm) {
    return {};
  }

  const weight = text.match(/\(\s*(\d+(?:\.\d+)?)\s*\)/u)?.[1];
  const feet = text.match(/x\s*(\d+(?:\.\d+)?)\s*尺/u)?.[1];
  const lengthMm = feet ? Math.round(Number(feet) * 303) : undefined;
  return {
    heightMm,
    widthMm,
    thicknessMinMm: thicknessMm,
    thicknessMaxMm: thicknessMm,
    dimensionSignature: `h${heightMm}|w${widthMm}|t${thicknessMm}`,
    ...(lengthMm === undefined ? {} : { lengthMm }),
    ...(weight === undefined ? {} : { unitWeightValue: Number(weight) }),
  };
}

function parseMeshNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source || /固定片|安全網/u.test(source)) {
    return {};
  }

  const text = source.normalize('NFKC').replace(/[＊*×]/gu, 'x');
  const pointWeld = text.match(
    /點焊鋼絲網\s*(\d+(?:\.\d+)?)\s*足?\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*M\s*x\s*(\d+(?:\.\d+)?)\s*M\s*\(\s*(\d+(?:\.\d+)?)\s*\)/u,
  );
  if (pointWeld?.[1] && pointWeld[2] && pointWeld[3] && pointWeld[4] && pointWeld[5]) {
    const wireMm = Number(pointWeld[1]);
    const apertureWidthMm = Math.round(Number(pointWeld[2]) * 10);
    const apertureHeightMm = Math.round(Number(pointWeld[3]) * 10);
    const sheetWidthMm = Math.round(Number(pointWeld[4]) * 1000);
    const sheetLengthMm = Math.round(Number(pointWeld[5]) * 1000);
    return {
      widthMm: apertureWidthMm,
      heightMm: apertureHeightMm,
      thicknessMinMm: wireMm,
      thicknessMaxMm: wireMm,
      lengthMm: sheetLengthMm,
      sheetWidthMm,
      sheetLengthMm,
      dimensionSignature: `wire${wireMm}|ap${apertureWidthMm}x${apertureHeightMm}|sheet${sheetWidthMm}x${sheetLengthMm}|pack${pointWeld[6]}`,
    };
  }

  const roll = text.match(
    /網\s*(\d+(?:\.\d+)?)\s*尺\s*x\s*(\d+(?:\.\d+)?)\s*尺\s*(\d+)#\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*(\d+)目\s*\(\s*(\d+(?:\.\d+)?)\s*\)/u,
  );
  if (roll?.[1] && roll[2] && roll[4] && roll[6]) {
    const sheetWidthMm = Math.round(Number(roll[1]) * 303);
    const sheetLengthMm = Math.round(Number(roll[2]) * 303);
    const wireMm = Number(roll[4]);
    const apertureMm = Number(roll[6]);
    return {
      widthMm: apertureMm,
      heightMm: apertureMm,
      thicknessMinMm: wireMm,
      thicknessMaxMm: wireMm,
      lengthMm: sheetLengthMm,
      sheetWidthMm,
      sheetLengthMm,
      dimensionSignature: `wire${wireMm}|mesh${roll[5]}|ap${apertureMm}|roll${sheetWidthMm}x${sheetLengthMm}`,
    };
  }

  const simpleRoll = text.match(
    /ST網\s*(\d+(?:\.\d+)?)\s*尺\s*x?\s*(\d+(?:\.\d+)?)\s*尺.*?\(?\s*(\d+)目\s*\)?/u,
  );
  if (simpleRoll?.[1] && simpleRoll[2] && simpleRoll[3]) {
    const sheetWidthMm = Math.round(Number(simpleRoll[1]) * 303);
    const sheetLengthMm = Math.round(Number(simpleRoll[2]) * 303);
    return {
      lengthMm: sheetLengthMm,
      sheetWidthMm,
      sheetLengthMm,
      dimensionSignature: `mesh${simpleRoll[3]}|roll${sheetWidthMm}x${sheetLengthMm}`,
    };
  }

  const barbed = text.match(/刺網\s*(\d+(?:\.\d+)?)\s*M\s*\(\s*(\d+(?:\.\d+)?)\s*KG\s*\)/iu);
  if (barbed?.[1] && barbed[2]) {
    const lengthMm = Math.round(Number(barbed[1]) * 1000);
    return {
      lengthMm,
      unitWeightValue: Number(barbed[2]),
      dimensionSignature: `roll${lengthMm}`,
    };
  }

  const razor = text.match(
    /刀刺網.*?φ\s*(\d+(?:\.\d+)?).*?可拉\s*(\d+(?:\.\d+)?)\s*[-~～至]\s*(\d+(?:\.\d+)?)\s*M/iu,
  );
  if (razor?.[1] && razor[2] && razor[3]) {
    const diameterMm = Number(razor[1]);
    const minLengthMm = Math.round(Number(razor[2]) * 1000);
    const lengthMm = Math.round(Number(razor[3]) * 1000);
    return {
      diameterMm,
      lengthMm,
      dimensionSignature: `od${diameterMm}|stretch${minLengthMm}-${lengthMm}`,
    };
  }

  const highBed = text.match(
    /高床網\s*(\d+(?:\.\d+)?)\s*x\s*\(\s*(\d+(?:\.\d+)?)\s*mm\s*x\s*(\d+(?:\.\d+)?)\s*mm/u,
  );
  if (highBed?.[1] && highBed[2] && highBed[3]) {
    const wireMm = Number(highBed[1]);
    const widthMm = Number(highBed[2]);
    const heightMm = Number(highBed[3]);
    return {
      widthMm,
      heightMm,
      thicknessMinMm: wireMm,
      thicknessMaxMm: wireMm,
      dimensionSignature: `wire${wireMm}|ap${widthMm}x${heightMm}|rectangle`,
    };
  }

  const explicitWireAperture = text.match(
    /(?:菱形網|菱型網).*?#?\d*\s*線徑\s*(\d+(?:\.\d+)?)\s*x\s*孔\s*(\d+(?:\.\d+)?)\s*mm/iu,
  );
  if (explicitWireAperture?.[1] && explicitWireAperture[2]) {
    const wireMm = Number(explicitWireAperture[1]);
    const apertureMm = Math.round(Number(explicitWireAperture[2]));
    return {
      widthMm: apertureMm,
      heightMm: apertureMm,
      thicknessMinMm: wireMm,
      thicknessMaxMm: wireMm,
      dimensionSignature: `wire${wireMm}|ap${apertureMm}|diamond`,
    };
  }

  const dualGauge = text.match(
    /菱形網\s*(\d+)#\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*x\s*(\d+)#\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*x\s*(\d+(?:\.\d+)?)\s*mm(?:\s*\(\s*(\d+(?:\.\d+)?)\s*(?:m\s*\/\s*m|mm)\s*\))?/iu,
  );
  if (dualGauge?.[2] && dualGauge[4] && dualGauge[5]) {
    const wireMm = Number(dualGauge[2]);
    const secondWireMm = Number(dualGauge[4]);
    const nominalApertureMm = Math.round(Number(dualGauge[5]));
    const apertureMm = Math.round(Number(dualGauge[6] ?? dualGauge[5]));
    return {
      widthMm: apertureMm,
      heightMm: apertureMm,
      thicknessMinMm: wireMm,
      thicknessMaxMm: wireMm,
      dimensionSignature: `wire${wireMm}|wire2-${secondWireMm}|ap${nominalApertureMm}-${apertureMm}|diamond`,
    };
  }

  const aperture = text.match(
    /(?:菱形網|菱型網|浪型網).*?(\d+)#\s*\(\s*(\d+(?:\.\d+)?)\s*\).*?x\s*(\d+(?:\.\d+)?)\s*mm(?:\s*\(\s*(\d+(?:\.\d+)?)\s*(m\s*\/\s*m|mm|cm|公分)\s*\))?/iu,
  );
  if (aperture?.[2] && aperture[3]) {
    const wireMm = Number(aperture[2]);
    const nominalApertureMm = Math.round(Number(aperture[3]));
    const apertureScale = aperture[5] === 'cm' || aperture[5] === '公分' ? 10 : 1;
    const apertureMm = Math.round(Number(aperture[4] ?? aperture[3]) * apertureScale);
    let shape = 'unknown';
    if (text.includes('◇')) {
      shape = 'diamond';
    } else if (text.includes('□')) {
      shape = 'square';
    }
    const coating = text.match(/(\d+(?:\.\d+)?)\s*g\s*\/\s*m2/iu)?.[1];
    return {
      widthMm: apertureMm,
      heightMm: apertureMm,
      thicknessMinMm: wireMm,
      thicknessMaxMm: wireMm,
      dimensionSignature: `wire${wireMm}|ap${nominalApertureMm}-${apertureMm}|${shape}${coating ? `|coat${coating}` : ''}`,
    };
  }

  const widthFeet = text.match(/(?:牛筋網)\s*(\d+(?:\.\d+)?)\s*尺/u)?.[1];
  return widthFeet ? { sheetWidthMm: Math.round(Number(widthFeet) * 303) } : {};
}

function parseRebarNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC');
  const diameter = text.match(/(?:節竹鐵|鋼筋)\s*(\d+(?:\.\d+)?)\s*(?:m\s*\/\s*m|mm)\b/iu)?.[1];
  const rebarNumber = text.match(/\(\s*(\d+)\s*#\s*\)/u)?.[1];
  if (!diameter) {
    return {};
  }

  const diameterMm = Number(diameter);
  return {
    diameterMm,
    dimensionSignature: `od${diameterMm}${rebarNumber ? `|rebar${rebarNumber}` : ''}`,
  };
}

function parseRailNameAttributes(source: string | null): ParsedNameAttributes {
  if (!source) {
    return {};
  }

  const text = source.normalize('NFKC');
  const railGrade = text.match(/(?:^|\s)(\d+)\s*K\s*鐵軌/iu)?.[1];
  if (!railGrade) {
    return {};
  }

  const lengthMeters = text.match(/(?:^|[\s)])(\d+(?:\.\d+)?)\s*M\b/iu)?.[1];
  const unitWeight = text.match(/\(\s*(\d+(?:\.\d+)?)\s*\)(?!\s*支)/u)?.[1];
  const lengthMm = lengthMeters ? Math.round(Number(lengthMeters) * 1000) : undefined;
  const railKey = `${Number(railGrade)}k`;
  return {
    ...(lengthMm === undefined ? {} : { lengthMm }),
    ...(unitWeight === undefined ? {} : { unitWeightValue: Number(unitWeight) }),
    dimensionSignature: `rail${railKey}${lengthMm === undefined ? '' : `|l${lengthMm}`}`,
  };
}

function parseExplicitLongMaterialLengthMm(productName: string | null): number | undefined {
  const text = productName?.normalize('NFKC').replace(/[＊*×]/gu, 'x') ?? '';
  const meterLength = text.match(/(?:^|[x\s(])(\d+(?:\.\d+)?)\s*M(?!\s*\/)\b/iu)?.[1];
  if (meterLength) {
    return Number(meterLength) * 1000;
  }

  const millimeterLength = text.match(/(?:^|[x\s(])(\d+(?:\.\d+)?)\s*L\b/iu)?.[1];
  return millimeterLength ? Math.round(Number(millimeterLength)) : undefined;
}

function parseLongMaterialLengthMm(
  category: PriceCategory,
  productName: string | null,
): number | undefined {
  if (!sixMeterDefaultCategories.has(category)) {
    return undefined;
  }

  if (category === '角鐵' && /塑膠腳套/u.test(productName ?? '')) {
    return undefined;
  }

  return parseExplicitLongMaterialLengthMm(productName) ?? 6000;
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

  if (category === '鐵板' && productName) {
    const plateName = productName
      .normalize('NFKC')
      .replace(/[＊*×]/gu, 'x')
      .trim();
    const thickness =
      plateName.match(/^(?:ST\s*)?(?:2B|NO1|BA|HL)\s*(\d+(?:\.\d+)?)/iu)?.[1] ??
      plateName.match(
        /^(\d+(?:\.\d+)?)(?=\s*(?:m\s*\/\s*m|mm|(?:ST\s*)?(?:2B|NO1|BA|HL)|黑板|錏板|OT板|ST花|錏花|黑花))/iu,
      )?.[1] ??
      plateName.match(/^(?:黑板|錏板|OT板)\s*(\d+(?:\.\d+)?)/iu)?.[1];

    if (thickness) {
      const thicknessMm = Number(thickness);
      return { thicknessMinMm: thicknessMm, thicknessMaxMm: thicknessMm };
    }
  }

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
    return parseRoundBarNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '圓管') {
    return parseRoundPipeNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '平鐵') {
    return parseFlatBarNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '方鐵') {
    return parseSquareBarNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '方管') {
    return parseSquareTubeNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '扁方管') {
    return parseRectangularTubeNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '槽鐵') {
    return parseChannelNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '角鐵') {
    return parseAngleNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '網') {
    return parseMeshNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '鋼筋') {
    return parseRebarNameAttributes(productName ?? normalizedSpecText);
  }

  if (category === '鐵軌') {
    return parseRailNameAttributes(productName ?? normalizedSpecText);
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

  if (category === '圓管') {
    return { thicknessMinMm: null, thicknessMaxMm: null };
  }

  const plateName = productName?.normalize('NFKC').toUpperCase() ?? '';
  const surfaceCodeOnlyThickness =
    category === '鐵板' &&
    ((sourceMinMm === 2 && plateName.includes('2B')) ||
      (sourceMinMm === 1 && plateName.includes('NO1')));
  if (surfaceCodeOnlyThickness) {
    return { thicknessMinMm: null, thicknessMaxMm: null };
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
  const productName = parseText(row.product_name);
  const sourceSubcategory = parseText(row.subcategory) ?? '';
  const subcategory = isPriceSubcategory(category, sourceSubcategory)
    ? sourceSubcategory
    : parseSubcategory(
        category,
        productName ? inferSteelPriceSubcategory(category, productName) : sourceSubcategory,
      );
  const noPriceByName =
    productName !== null && /沒做|勿用|沒出|沒貨|不生產|無生產|不用|沒現貨/u.test(productName);
  const valueState = noPriceByName ? 'no_price' : parseValueState(row.value_state);
  const parsePrice = (value: SteelPriceV4Cell, field: string): number | null =>
    noPriceByName ? null : parseZeroAsNullNumber(value, field);
  const unitPriceBase = parsePrice(row.unit_price_base, 'unit_price_base');
  const unitPriceA = parsePrice(row.unit_price_a, 'unit_price_a');
  const unitPriceB = parsePrice(row.unit_price_b, 'unit_price_b');
  const unitPriceC = parsePrice(row.unit_price_c, 'unit_price_c');
  const unitPriceD = parsePrice(row.unit_price_d, 'unit_price_d');
  const unitPriceE = parsePrice(row.unit_price_e, 'unit_price_e');
  const unitPriceF = parsePrice(row.unit_price_f, 'unit_price_f');
  const priceRatioA = parsePrice(row.price_ratio_a, 'price_ratio_a');
  const priceRatioB = parsePrice(row.price_ratio_b, 'price_ratio_b');
  const priceRatioC = parsePrice(row.price_ratio_c, 'price_ratio_c');
  const priceRatioD = parsePrice(row.price_ratio_d, 'price_ratio_d');
  const priceRatioE = parsePrice(row.price_ratio_e, 'price_ratio_e');
  const priceRatioF = parsePrice(row.price_ratio_f, 'price_ratio_f');
  const sourceThickness = parseZeroAsNullText(row.source_thickness);
  const nameAttributes = parseNameAttributes(category, productName, normalizedSpecText);
  const longMaterialLengthMm = parseLongMaterialLengthMm(category, productName);
  let parsedLengthMm =
    nameAttributes.lengthMm ??
    longMaterialLengthMm ??
    parseZeroAsNullNumber(row.length_mm, 'length_mm');
  if (category === '方鐵') {
    parsedLengthMm = nameAttributes.lengthMm ?? null;
  }
  if (category === '角鐵' && /塑膠腳套/u.test(productName ?? '')) {
    parsedLengthMm = null;
  }
  const thicknessBand =
    category === '方管' ||
    category === '扁方管' ||
    category === '槽鐵' ||
    category === '角鐵' ||
    category === '網' ||
    category === '鋼筋' ||
    category === '鐵軌'
      ? {
          thicknessMinMm: nameAttributes.thicknessMinMm ?? null,
          thicknessMaxMm: nameAttributes.thicknessMaxMm ?? null,
        }
      : parseThicknessBand(category, productName, normalizedSpecText, sourceThickness);

  validateValueState(
    valueState,
    [unitPriceBase, unitPriceA, unitPriceB, unitPriceC, unitPriceD, unitPriceE, unitPriceF],
    [priceRatioA, priceRatioB, priceRatioC, priceRatioD, priceRatioE, priceRatioF],
  );

  const unitWeightValue =
    category === '網'
      ? (nameAttributes.unitWeightValue ?? null)
      : (nameAttributes.unitWeightValue ??
        parseZeroAsNullNumber(row.unit_weight_value, 'unit_weight_value'));
  let unitWeightBasis = parseText(row.unit_weight_basis);
  if (category === '網') {
    unitWeightBasis =
      nameAttributes.unitWeightValue === undefined ? null : 'kg_per_piece_or_stock_length';
  } else if (
    (category === '平鐵' ||
      category === '圓管' ||
      category === '槽鐵' ||
      category === '角鐵' ||
      category === '鐵軌' ||
      (category === '方鐵' && nameAttributes.lengthMm !== undefined)) &&
    nameAttributes.unitWeightValue !== undefined
  ) {
    unitWeightBasis = 'kg_per_piece_or_stock_length';
  }

  return {
    formulaCode: parseText(row.formula_code),
    erpItemCode,
    productName,
    normalizedSpecText,
    category,
    subcategory,
    processingMethod: parseProcessingMethod(row.processing_method),
    processingShape: parseProcessingShape(row.processing_shape),
    material:
      hotDipMaterialCategories.has(category) && /熱[浸進]鍍/u.test(productName ?? '')
        ? '錏/鍍鋅'
        : parseText(row.material),
    dimensionSignature:
      category === '圓管' ||
      category === '方管' ||
      category === '扁方管' ||
      category === '槽鐵' ||
      category === '角鐵' ||
      category === '網'
        ? (nameAttributes.dimensionSignature ?? null)
        : (nameAttributes.dimensionSignature ?? parseText(row.dimension_signature)),
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
    unitWeightValue,
    unitWeightBasis,
    density: parseZeroAsNullNumber(row.density, 'density'),
    sourceThickness,
    ...thicknessBand,
    widthMm:
      category === '方鐵' ||
      category === '方管' ||
      category === '扁方管' ||
      category === '槽鐵' ||
      category === '角鐵' ||
      category === '網'
        ? (nameAttributes.widthMm ?? null)
        : (nameAttributes.widthMm ?? parseZeroAsNullNumber(row.width_mm, 'width_mm')),
    heightMm:
      category === '方鐵' ||
      category === '方管' ||
      category === '扁方管' ||
      category === '槽鐵' ||
      category === '角鐵' ||
      category === '網'
        ? (nameAttributes.heightMm ?? null)
        : (nameAttributes.heightMm ?? parseZeroAsNullNumber(row.height_mm, 'height_mm')),
    lengthMm: parsedLengthMm,
    outerDiameterMm:
      category === '圓管' || category === '鋼筋'
        ? (nameAttributes.diameterMm ?? null)
        : (nameAttributes.diameterMm ??
          parseZeroAsNullNumber(row.outer_diameter_mm, 'outer_diameter_mm')),
    nominalInch:
      category === '圓條' || category === '圓管' || category === '方鐵' || category === '方管'
        ? (nameAttributes.nominalInch ?? null)
        : parseText(row.nominal_inch),
    webMm:
      category === '槽鐵'
        ? (nameAttributes.webMm ?? null)
        : parseZeroAsNullNumber(row.web_mm, 'web_mm'),
    flangeMm:
      category === '槽鐵'
        ? (nameAttributes.flangeMm ?? null)
        : parseZeroAsNullNumber(row.flange_mm, 'flange_mm'),
    lipMm: parseZeroAsNullNumber(row.lip_mm, 'lip_mm'),
    sheetWidthMm:
      category === '網'
        ? (nameAttributes.sheetWidthMm ?? null)
        : parseZeroAsNullNumber(row.sheet_width_mm, 'sheet_width_mm'),
    sheetLengthMm:
      category === '網'
        ? (nameAttributes.sheetLengthMm ?? null)
        : parseZeroAsNullNumber(row.sheet_length_mm, 'sheet_length_mm'),
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
