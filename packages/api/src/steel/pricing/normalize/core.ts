import { buildSteelPriceV4Rows, steelPriceV4WorkbookHeaders } from '../v4';
import { materialKinds } from '../enums';
import { inferProcessingAttributes } from './processing';
import { inferSteelPriceSubcategory } from '../subcategory';

import type { SteelPriceV4Cell, SteelPriceV4WorkbookRow } from '../v4';

export const protectedSteelPriceWorkbookHeaders = Object.freeze([
  'erp_item_code',
  'formula_code',
  'product_name',
  'category',
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
  'density',
  'cost_basis',
] as const);

export const normalizedSteelPriceV4WorkbookHeaders = steelPriceV4WorkbookHeaders;

export type NormalizedSteelPriceV4WorkbookRow = Record<
  (typeof normalizedSteelPriceV4WorkbookHeaders)[number],
  SteelPriceV4Cell
>;

const hotDipMaterialCategories = new Set([
  '平鐵',
  '角鐵',
  '圓管',
  '圓條',
  '扁方管',
  '方管',
  '槽鐵',
]);

const noPriceNamePattern = /沒做|勿用|沒出|沒貨|不生產|不用|沒現貨|無生產/u;
const canonicalMaterialKinds = new Set<string>(materialKinds);

function text(value: SteelPriceV4Cell): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).normalize('NFKC').trim();
  return normalized || null;
}

function normalizeUnit(value: SteelPriceV4Cell): string | null {
  const unit = text(value);
  if (!unit) {
    return null;
  }

  const aliases: Readonly<Record<string, string>> = {
    kg: 'Kg',
    KG: 'Kg',
    m: 'M',
    m2: '㎡',
    M2: '㎡',
    平方公尺: '㎡',
    卷: '捲',
  };

  return aliases[unit] ?? unit;
}

function normalizeMaterial(
  category: string,
  productName: string,
  value: SteelPriceV4Cell,
): string | null {
  if (hotDipMaterialCategories.has(category) && /熱[浸進]鍍/u.test(productName)) {
    return '錏/鍍鋅';
  }

  const material = text(value);
  if (/ST\s*2B|白鐵霧面/iu.test(productName) || /ST\s*2B|白鐵霧面/iu.test(material ?? '')) {
    return '2B 白鐵霧面';
  }
  if (/ST\s*BA|白鐵亮面/iu.test(productName) || /ST\s*BA|白鐵亮面/iu.test(material ?? '')) {
    return 'BA 白鐵亮面';
  }
  if (/ST\s*HL|白鐵沙面/iu.test(productName) || /ST\s*HL|白鐵沙面/iu.test(material ?? '')) {
    return 'HL 白鐵沙面';
  }
  if (
    /ST\s*NO\s*1|白鐵.*NO\s*1/iu.test(productName) ||
    /ST\s*NO\s*1|白鐵.*NO\s*1/iu.test(material ?? '')
  ) {
    return 'No1 白鐵';
  }

  const aliases: Readonly<Record<string, string>> = {
    '黑鐵 / OT': 'OT 黑鐵',
    'OT / 黑鐵': 'OT 黑鐵',
    黑鐵: 'OT 黑鐵',
    OT: 'OT 黑鐵',
    '白鐵 / ST': 'ST 白鐵',
    '白鐵 / ST 白鐵': 'ST 白鐵',
    '白鐵 / 不鏽鋼 / ST': 'ST 白鐵',
    '白鐵 / 不鏽鋼': 'ST 白鐵',
    'ST / 白鐵': 'ST 白鐵',
    白鐵: 'ST 白鐵',
    ST: 'ST 白鐵',
    '白鐵霧面 / ST 2B': '2B 白鐵霧面',
    '白鐵亮面 / ST BA': 'BA 白鐵亮面',
    '白鐵沙面 / ST HL': 'HL 白鐵沙面',
    '白鐵 / ST NO1': 'No1 白鐵',
    '錏 / 鍍鋅': '錏/鍍鋅',
    '錏 / 白A': '錏/鍍鋅',
    '錏 / 鍍鋅/白B': '錏/鍍鋅',
    '錏 / 鍍鋅/美亞管': '錏/鍍鋅',
    鎢: '非鋼材',
    水泥: '非鋼材',
  };

  if (!material) {
    return null;
  }
  const normalized = aliases[material] ?? material;
  return canonicalMaterialKinds.has(normalized) ? normalized : '待確認';
}

function compactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function buildNormalizedSpecText(
  productName: string,
  parsed: ReturnType<typeof buildSteelPriceV4Rows>[number],
  processing: ReturnType<typeof inferProcessingAttributes>,
): string {
  const tokens = [
    productName
      .normalize('NFKC')
      .replace(/[＊*×]/gu, 'x')
      .replace(/\s+/gu, ' ')
      .trim(),
  ];
  if (parsed.outerDiameterMm !== null) {
    tokens.push(`od${compactNumber(parsed.outerDiameterMm)}`);
  }
  if (parsed.heightMm !== null && parsed.widthMm !== null) {
    tokens.push(`h${compactNumber(parsed.heightMm)}|w${compactNumber(parsed.widthMm)}`);
  }
  if (parsed.webMm !== null) {
    tokens.push(`web${compactNumber(parsed.webMm)}`);
  }
  if (parsed.flangeMm !== null) {
    tokens.push(`flange${compactNumber(parsed.flangeMm)}`);
  }
  if (parsed.thicknessMinMm !== null) {
    const max = parsed.thicknessMaxMm ?? parsed.thicknessMinMm;
    tokens.push(
      parsed.thicknessMinMm === max
        ? `t${compactNumber(parsed.thicknessMinMm)}mm`
        : `t${compactNumber(parsed.thicknessMinMm)}-${compactNumber(max)}mm`,
    );
  }
  if (parsed.nominalInch) {
    tokens.push(`in${parsed.nominalInch}`);
  }
  if (processing?.processingMethod) {
    tokens.push(processing.processingMethod);
  }
  if (processing?.processingShape) {
    tokens.push(processing.processingShape);
  }
  return [...new Set(tokens)].join(' ');
}

export function normalizeSteelPriceWorkbookRow(
  source: SteelPriceV4WorkbookRow,
): NormalizedSteelPriceV4WorkbookRow {
  const parsed = buildSteelPriceV4Rows([{ ...source, subcategory: '' }])[0];
  if (!parsed) {
    throw new Error('Expected Steel price parser output');
  }

  const productName = text(source.product_name) ?? '';
  const processing = inferProcessingAttributes(String(source.category ?? ''), productName);
  const normalized = Object.fromEntries(
    normalizedSteelPriceV4WorkbookHeaders.map((header) => [
      header,
      source[header as keyof SteelPriceV4WorkbookRow] ?? null,
    ]),
  ) as NormalizedSteelPriceV4WorkbookRow;

  const normalizedSpecText = buildNormalizedSpecText(productName, parsed, processing);
  normalized.spec_key =
    text(source.spec_key) ?? `${parsed.erpItemCode} ${normalizedSpecText}`.trim();
  normalized.subcategory =
    inferSteelPriceSubcategory(String(source.category ?? ''), productName) ?? null;
  normalized.processing_method = processing?.processingMethod ?? null;
  normalized.processing_shape = processing?.processingShape ?? null;
  normalized.material = normalizeMaterial(
    String(source.category ?? ''),
    productName,
    source.material,
  );
  normalized.unit = normalizeUnit(source.unit);
  normalized.value_state = noPriceNamePattern.test(productName) ? 'no_price' : parsed.valueState;
  normalized.unit_weight_value = parsed.unitWeightValue;
  normalized.unit_weight_basis = parsed.unitWeightBasis;
  normalized.thicknessMinMm = parsed.thicknessMinMm;
  normalized.thicknessMaxMm = parsed.thicknessMaxMm;
  normalized.width_mm = parsed.widthMm;
  normalized.height_mm = parsed.heightMm;
  normalized.length_mm = parsed.lengthMm;
  normalized.outer_diameter_mm = parsed.outerDiameterMm;
  normalized.nominal_inch = parsed.nominalInch;
  normalized.web_mm = parsed.webMm;
  normalized.flange_mm = parsed.flangeMm;
  normalized.lip_mm = parsed.lipMm;
  normalized.sheet_width_mm = parsed.sheetWidthMm;
  normalized.sheet_length_mm = parsed.sheetLengthMm;
  normalized.spec_sort_key = parsed.specSortKey;

  for (const header of protectedSteelPriceWorkbookHeaders) {
    normalized[header] = source[header];
  }

  return normalized;
}
