import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

export type SteelImportValueState = 'unknown' | 'confirmed' | 'true_zero' | 'estimate';
export type SteelImportReviewState = 'draft' | 'needs_review' | 'reviewed' | 'rejected';

export type SteelImportJsonValue =
  | string
  | number
  | boolean
  | null
  | SteelImportJsonValue[]
  | { [key: string]: SteelImportJsonValue | undefined };

export interface SteelImportSourceRef {
  channel: string;
  factType: string;
  sourceFile: string;
  locator: string;
  confidence?: string;
  extractedLabel?: string;
  canonicalKey?: string;
}

export interface SteelReferenceImportOptions {
  referenceDir: string;
}

export interface SteelCustomerTierImportRow {
  code: string;
  name: string;
  priority: number;
  sourceRefs: SteelImportSourceRef[];
}

export interface SteelCustomerImportRow {
  erpCustomerCode: string;
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  customerTierCode: string | null;
  status: 'active';
  notes: string | null;
  metadata: SteelImportJsonValue;
  importLogId: string;
  sourceRefs: SteelImportSourceRef[];
}

export interface SteelPriceItemImportRow {
  erpItemCode: string;
  customerTierCode: string;
  categoryCode: string;
  specKey: string;
  productName: string;
  catalogFamily: string;
  materialGrade: string | null;
  unit: string;
  unitPrice: number | null;
  productPriceUnitWeight: number | null;
  productPriceUnitWeightUnit: 'kg_per_m' | 'kg_per_piece' | null;
  currency: 'TWD';
  active: boolean;
  valueState: SteelImportValueState;
  reviewState: SteelImportReviewState;
  metadata: SteelImportJsonValue;
  importLogId: string;
  sourceRefs: SteelImportSourceRef[];
}

export interface SteelCatalogFamilyImportRow {
  key: string;
  displayNameZh: string;
  aliases: string[];
  metadata: SteelImportJsonValue;
  active: boolean;
  reviewState: SteelImportReviewState;
  sourceRefs: SteelImportSourceRef[];
}

export interface SteelPriceCategoryImportRow {
  code: string;
  name: string;
  catalogFamily: string;
  defaultUnit: 'piece';
  metadata: SteelImportJsonValue;
  sourceRefs: SteelImportSourceRef[];
}

export interface SteelCuttingPriceImportRow {
  productFamily: string;
  cutType: string;
  specKey: string | null;
  lengthM: number | null;
  unit: 'cut';
  unitPrice: number | null;
  surchargePerKg: number | null;
  currency: 'TWD';
  active: boolean;
  valueState: SteelImportValueState;
  reviewState: SteelImportReviewState;
  metadata: SteelImportJsonValue;
  importLogId: string;
  sourceRefs: SteelImportSourceRef[];
}

export interface SteelFormulaVersionImportRow {
  code: string;
  versionSeq: 1;
  displayName: string | null;
  sourceExpression: string;
  formulaBody: SteelImportJsonValue;
  compiledFormula: null;
  allowedVariables: string[];
  active: boolean;
  reviewState: SteelImportReviewState;
  sourceRefs: SteelImportSourceRef[];
}

export interface SteelQuoteDefaultImportRow {
  defaultType: 'material_rule' | 'preference_rule' | 'formula_hint' | 'true_zero_rule';
  originTable: string;
  originId: string;
  originRevision: string;
  scopeType: 'company' | 'catalog_family' | 'product_family' | 'customer_tier' | 'customer';
  customerTierCode: string | null;
  catalogFamily: string | null;
  productFamily: string | null;
  chargeType: 'material' | 'cutting' | 'hole' | 'slotting' | 'bending' | 'processing' | null;
  formulaCode: string | null;
  selector: SteelImportJsonValue;
  effect:
    | 'calculation_default'
    | 'material_rule'
    | 'preference_rule'
    | 'formula_hint'
    | 'true_zero_rule'
    | 'skip_charge'
    | 'parameter_override';
  defaultParameters: SteelImportJsonValue;
  priority: number;
  confidence: 'low' | 'medium' | 'high';
  active: boolean;
  reviewState: SteelImportReviewState;
  sourceRefs: SteelImportSourceRef[];
}

export interface SteelReferenceImportSummary {
  catalogFamilies: number;
  priceCategories: number;
  customerTiers: number;
  customers: number;
  priceItems: number;
  cuttingPrices: number;
  formulaVersions: number;
  quoteDefaults: number;
}

export interface SteelReferenceImportPlan {
  factSources: string[];
  workbookOnlySources: string[];
  catalogFamilies: SteelCatalogFamilyImportRow[];
  priceCategories: SteelPriceCategoryImportRow[];
  customerTiers: SteelCustomerTierImportRow[];
  customers: SteelCustomerImportRow[];
  priceItems: SteelPriceItemImportRow[];
  cuttingPrices: SteelCuttingPriceImportRow[];
  formulaVersions: SteelFormulaVersionImportRow[];
  quoteDefaults: SteelQuoteDefaultImportRow[];
  summary: SteelReferenceImportSummary;
}

type SheetCell = string | number | boolean | Date | null;
type SheetRow = SheetCell[];

const factSources = [
  '客戶資料.xlsx',
  '產品價格.xlsx',
  '切工價錢.xlsx',
  '公式編號.xlsx',
  'H型鋼.txt',
];
const workbookOnlySources = ['訂單參考.xlsx', '系統訂單.xlsx'];
const customerImportLogId = 'docs-reference-customers-v1';
const priceImportLogId = 'docs-reference-product-prices-v1';
const cuttingImportLogId = 'docs-reference-cutting-prices-v1';
const sourcePrefix = 'docs/reference';
const priceTierCodes = ['A', 'B', 'C', 'F'] as const;
const fuzzyNotePattern = /另計|需人工|人工確認|疑似|未確認|不清|量少|加價|不切|修頭尾|特短/u;
const catalogFamilyImportLogId = 'docs-reference-catalog-families-v1';
const priceCategoryImportLogId = 'docs-reference-price-categories-v1';

type ProductPriceUnitWeightOrigin = 'unit_weight_column' | 'product_name_parentheses' | null;
type ProductPriceUnitBasis = 'per_kg' | 'per_piece_total' | 'per_piece_or_unit';

interface ProductPriceTierSource {
  unitPrice: number | null;
  priceRatio: number | null;
}

interface ProductPriceUnitWeightInfo {
  value: number | null;
  origin: ProductPriceUnitWeightOrigin;
  parentheticalValue: number | null;
}

const fixedLengthMeterPattern = /\d+(?:\.\d+)?\s*[mMＭ](?:$|[^/a-zA-ZｍＭmM])/u;
const parenthesizedNumberAtEndPattern = /\(\s*(\d+(?:\.\d+)?)\s*\)\s*$/u;

function numbersAreClose(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.05;
}

function getParentheticalUnitWeightCandidate(productName: string): number | null {
  const fixedLengthMatch = productName.match(/\d+(?:\.\d+)?\s*[mMＭ]\s*\(\s*(\d+(?:\.\d+)?)\s*\)/u);
  if (fixedLengthMatch?.[1]) {
    return parseNumber(fixedLengthMatch[1]);
  }

  const match = productName.match(parenthesizedNumberAtEndPattern);
  return match?.[1] ? parseNumber(match[1]) : null;
}

function hasPieceTotalPriceEvidence(
  unitWeight: number | null,
  tierSources: ProductPriceTierSource[],
): boolean {
  if (!unitWeight || unitWeight <= 0) {
    return false;
  }

  return tierSources.some(({ unitPrice, priceRatio }) =>
    Boolean(
      unitPrice &&
        unitPrice > 0 &&
        priceRatio &&
        priceRatio > 0 &&
        numbersAreClose(unitPrice, unitWeight * priceRatio),
    ),
  );
}

function getProductPriceUnitWeightInfo(
  productName: string,
  sourceUnitWeight: number | null,
  tierSources: ProductPriceTierSource[],
): ProductPriceUnitWeightInfo {
  const parentheticalValue = getParentheticalUnitWeightCandidate(productName);

  if (sourceUnitWeight && sourceUnitWeight > 0) {
    return {
      value: sourceUnitWeight,
      origin: 'unit_weight_column',
      parentheticalValue,
    };
  }

  if (parentheticalValue && hasPieceTotalPriceEvidence(parentheticalValue, tierSources)) {
    return {
      value: parentheticalValue,
      origin: 'product_name_parentheses',
      parentheticalValue,
    };
  }

  return {
    value: null,
    origin: null,
    parentheticalValue,
  };
}

function getProductPriceUnitBasis(
  productName: string,
  unitWeight: number | null,
  tierSources: ProductPriceTierSource[],
): ProductPriceUnitBasis {
  if (hasPieceTotalPriceEvidence(unitWeight, tierSources)) {
    return 'per_piece_total';
  }

  if (
    fixedLengthMeterPattern.test(productName) &&
    tierSources.some(({ unitPrice, priceRatio }) =>
      Boolean(unitPrice && unitPrice > 0 && priceRatio && priceRatio > 0),
    )
  ) {
    return 'per_piece_total';
  }

  return unitWeight && unitWeight > 0 ? 'per_kg' : 'per_piece_or_unit';
}

function getProductPriceUnitWeightUnit(
  productName: string,
  unitWeight: number | null,
  priceUnitBasis: ProductPriceUnitBasis,
): SteelPriceItemImportRow['productPriceUnitWeightUnit'] {
  if (!unitWeight || unitWeight <= 0) {
    return null;
  }

  if (priceUnitBasis === 'per_piece_total' || fixedLengthMeterPattern.test(productName)) {
    return 'kg_per_piece';
  }

  return 'kg_per_m';
}

function getProductPriceUnit(
  weightUnit: SteelPriceItemImportRow['productPriceUnitWeightUnit'],
  priceUnitBasis: ProductPriceUnitBasis,
) {
  if (!weightUnit) {
    return 'piece';
  }

  return priceUnitBasis === 'per_piece_total' ? 'piece' : 'kg';
}

interface CatalogFamilySeed {
  key: string;
  displayNameZh: string;
  aliases: string[];
  searchHints?: string[];
  productPatterns: RegExp[];
  erpCodePatterns: RegExp[];
  excludeProductPatterns?: RegExp[];
}

interface ProductPriceSourceRow {
  rowNumber: number;
  erpItemCode: string;
  productName: string;
  erpCodePrefix: string;
  categoryCode: string;
  catalogFamily: string;
  catalogFamilyMatchedBy: string;
}

const catalogFamilySeeds: CatalogFamilySeed[] = [
  {
    key: 'b_pipe',
    displayNameZh: 'B管',
    aliases: ['B管', '鍍鋅B管'],
    productPatterns: [/B管/u],
    erpCodePatterns: [],
  },
  {
    key: 'a_pipe',
    displayNameZh: 'A管',
    aliases: ['A管', '黑A鋼管', '白A鋼管', '美亞A管'],
    productPatterns: [/A鋼管/u, /A管/u, /美亞A管/u],
    erpCodePatterns: [],
  },
  {
    key: 'p_pipe',
    displayNameZh: 'P型管',
    aliases: ['P型管', '白鐵P型管'],
    productPatterns: [/P型管/u],
    erpCodePatterns: [/^FLA/u],
  },
  {
    key: 'steel_pipe',
    displayNameZh: '鋼管',
    aliases: ['鋼管', '黑鋼管', '白鋼管'],
    productPatterns: [/鋼管/u],
    erpCodePatterns: [/^GO[BG]/u],
  },
  {
    key: 'piping',
    displayNameZh: '配管',
    aliases: ['配管', '白鐵配管', '配管彎頭'],
    productPatterns: [/配管/u],
    erpCodePatterns: [/^GOS/u],
  },
  {
    key: 'wall_panel',
    displayNameZh: '壁板',
    aliases: ['壁板', '屋面壁板'],
    productPatterns: [/壁板/u],
    erpCodePatterns: [],
  },
  {
    key: 'resin_panel',
    displayNameZh: '樹脂',
    aliases: ['樹脂', '樹脂板', '樹脂清板'],
    productPatterns: [/樹脂/u],
    erpCodePatterns: [],
  },
  {
    key: 'water_stop_plate',
    displayNameZh: '擋水板',
    aliases: ['擋水板', '鋁合金擋水板'],
    productPatterns: [/擋水板/u],
    erpCodePatterns: [],
  },
  {
    key: 'aluminum_window',
    displayNameZh: '鋁窗',
    aliases: ['鋁窗', '免收邊鋁窗', '收邊鋁窗', '氣密鋁窗'],
    productPatterns: [/鋁窗/u],
    erpCodePatterns: [/^HS[ABCDEFGH]/u],
  },
  {
    key: 'iron_door',
    displayNameZh: '鐵門',
    aliases: ['鐵門', '白鐵門', '黑鐵門'],
    productPatterns: [/鐵門/u],
    erpCodePatterns: [/^HSS/u],
  },
  {
    key: 'canopy_frame',
    displayNameZh: '棚架',
    aliases: ['棚架', '雨棚架'],
    productPatterns: [/棚架/u, /雨棚架/u],
    erpCodePatterns: [/^JL[AS]/u],
  },
  {
    key: 'square_pipe_connector',
    displayNameZh: '方管連料',
    aliases: ['方管連料', '方管連料U型'],
    productPatterns: [/方管連料/u],
    erpCodePatterns: [/^JU[AS]/u],
  },
  {
    key: 'telescopic_gate',
    displayNameZh: '伸縮大門',
    aliases: ['伸縮大門', '伸縮門'],
    productPatterns: [/伸縮大門/u, /伸縮門/u],
    erpCodePatterns: [/^SA[CS]?/u],
  },
  {
    key: 'screen_mesh',
    displayNameZh: '紗網',
    aliases: ['紗網', 'ST紗網'],
    productPatterns: [/紗網/u],
    erpCodePatterns: [/^FPL/u],
  },
  {
    key: 'door_decoration',
    displayNameZh: '門花',
    aliases: ['門花', '鑄花'],
    productPatterns: [/門花/u, /鑄花/u],
    erpCodePatterns: [/^FP[ACDEFGHIJKZ]/u, /^FQ[BCDEG]/u, /^FS[DF]/u],
  },
  {
    key: 'screw',
    displayNameZh: '螺絲',
    aliases: ['螺絲', '鏍絲', '螺母', '鏍帽', '自攻釘', '拉丁', '釘子'],
    productPatterns: [/螺絲/u, /鏍絲/u, /螺母/u, /鏍帽/u, /自攻釘/u, /拉丁/u, /釘子/u],
    erpCodePatterns: [/^FT[BSG]/u, /^FG[BHS]/u],
  },
  {
    key: 'corner_wheel',
    displayNameZh: '角輪',
    aliases: ['角輪', 'H輪', '輪子'],
    productPatterns: [/角輪/u, /H輪/u],
    erpCodePatterns: [/^FFP/u],
  },
  {
    key: 'door_lock',
    displayNameZh: '門鎖',
    aliases: ['門鎖', '鎖', '鋁門鎖', '防火門鎖', '伸縮門鎖'],
    productPatterns: [/門鎖/u, /鋁門鎖/u, /防火門鎖/u, /伸縮門鎖/u],
    erpCodePatterns: [/^FFL/u],
  },
  {
    key: 'measuring_tool',
    displayNameZh: '量尺',
    aliases: ['尺', '捲尺', '鋼捲尺', '水平尺', '角尺'],
    productPatterns: [/捲尺/u, /鋼捲尺/u, /水平尺/u, /角尺/u],
    erpCodePatterns: [],
  },
  {
    key: 'i_beam',
    displayNameZh: 'I字鐵',
    aliases: ['I字鐵', '工字鐵', 'I-Beam'],
    productPatterns: [/I字鐵/u, /工字鐵/u],
    erpCodePatterns: [/^EZB/u],
  },
  {
    key: 'round_bar',
    displayNameZh: '圓鐵/圓條',
    aliases: ['圓鐵', '圓條', '圓鋼'],
    productPatterns: [/圓鐵/u, /圓條/u, /圓鋼/u],
    erpCodePatterns: [/^EQ[ABCGS]/u],
  },
  {
    key: 'square_bar',
    displayNameZh: '方鐵',
    aliases: ['方鐵', '方鋼'],
    productPatterns: [/方鐵/u, /方鋼/u],
    erpCodePatterns: [/^ED[ABS]/u],
  },
  {
    key: 'galvanized_plate',
    displayNameZh: '錏板',
    aliases: ['錏板', '鍍鋅板'],
    productPatterns: [/錏板/u, /鍍鋅板/u, /錏花板/u],
    erpCodePatterns: [/^BNG/u, /^BXH/u],
  },
  {
    key: 'ot_plate',
    displayNameZh: 'OT板',
    aliases: ['OT板', 'OT花板'],
    productPatterns: [/OT板/u, /OT花板/u],
    erpCodePatterns: [/^BNB/u, /^BXB/u],
  },
  {
    key: 'black_plate',
    displayNameZh: '黑板',
    aliases: ['黑板', '黑鐵板'],
    productPatterns: [/黑鐵板/u, /黑板/u],
    erpCodePatterns: [/^DNB/u],
  },
  {
    key: 'grating',
    displayNameZh: '鐵格板',
    aliases: ['鐵格板', '格板'],
    productPatterns: [/鐵格板/u],
    erpCodePatterns: [/^AN[BS]/u],
  },
  {
    key: 'floor_deck',
    displayNameZh: '樓層板',
    aliases: ['樓層板', '鋼樓層板', '50型樓層板', '75型樓層板', '錏樓層板'],
    productPatterns: [/樓層板/u],
    erpCodePatterns: [],
  },
  {
    key: 'h_beam',
    displayNameZh: 'H型鋼',
    aliases: ['H型鋼', 'H鋼', 'H 型鋼', 'H-BEAM', 'H型'],
    productPatterns: [/H\s*型鋼/u, /輕量H/u],
    erpCodePatterns: [/^EHS/u, /^EHC/u],
  },
  {
    key: 'c_type',
    displayNameZh: 'C型鋼',
    aliases: ['C型鋼', 'C鋼', 'C 型鋼', 'C型', '輕型鋼', '型鋼'],
    searchHints: ['白鐵輕型鋼', '錏輕型鋼', '黑鐵輕型鋼', '100x2.3'],
    productPatterns: [/輕型鋼/u, /(?<!H)型鋼/u],
    erpCodePatterns: [/^CC[BCGS]/u],
  },
  {
    key: 'wire_mesh',
    displayNameZh: '點焊網',
    aliases: ['點焊網', '點焊鋼絲網', '鋼絲網', '鐵網', '錏網', '菱形網', '浪型網'],
    productPatterns: [/點焊/u, /鋼絲網/u, /鐵網/u, /錏網/u, /菱形網/u, /浪型網/u],
    erpCodePatterns: [],
    excludeProductPatterns: [/人工草皮/u, /塑膠/u, /PE/u, /安全網/u, /固定片/u],
  },
  {
    key: 'expanded_metal',
    displayNameZh: '網板',
    aliases: ['網板', 'OT網板', '鍍鋅網板', 'ST網板', '擴張網板', 'Expanded Metal'],
    productPatterns: [/網板/u],
    erpCodePatterns: [/^BW[BGS]/u],
  },
  {
    key: 'angle',
    displayNameZh: '角鐵',
    aliases: ['角鐵', 'L角鐵', 'L型鋼', '錏角鐵', '鍍鋅角鐵', '黑角鐵', '白鐵角鐵'],
    productPatterns: [/角鐵/u],
    erpCodePatterns: [/^EL[ABDG]/u],
  },
  {
    key: 'channel',
    displayNameZh: '槽鐵',
    aliases: ['槽鐵', 'U型鋼', 'U鋼', '槽鋼'],
    productPatterns: [/槽鐵/u],
    erpCodePatterns: [/^EU[BGS]/u],
  },
  {
    key: 'flat_bar',
    displayNameZh: '平鐵',
    aliases: ['平鐵', '扁鐵', '扁鋼', '黑平鐵', '白鐵平鐵'],
    productPatterns: [/平鐵/u, /扁鐵/u],
    erpCodePatterns: [/^EI[BGS]/u],
  },
  {
    key: 'rail',
    displayNameZh: '鐵軌',
    aliases: ['鐵軌', '軌道鋼', '鋼軌'],
    productPatterns: [/鐵軌/u],
    erpCodePatterns: [/^ERB/u],
  },
  {
    key: 'rectangular_pipe',
    displayNameZh: '扁方管',
    aliases: ['扁方管', '矩形管', '矩形鋼管', '黑鐵扁方管', '錏扁方管', '白鐵扁方管'],
    productPatterns: [/扁方管/u],
    erpCodePatterns: [/^GE[BHS]/u, /^JES/u],
  },
  {
    key: 'round_pipe',
    displayNameZh: '圓管',
    aliases: ['圓管', '圓鐵管', '黑鐵管', '白鐵圓管'],
    productPatterns: [/圓管/u, /鐵管/u],
    erpCodePatterns: [/^EP[BGS]/u],
  },
  {
    key: 'square_pipe',
    displayNameZh: '方管',
    aliases: ['方管', '四方管', '方鐵管', '白鐵方管'],
    productPatterns: [/方管/u, /四方管/u],
    erpCodePatterns: [/^EQ[BGS]/u],
  },
  {
    key: 'corrugated_panel',
    displayNameZh: '浪板/收邊',
    aliases: [
      '浪板',
      '角浪板',
      '收邊',
      '屋面板',
      '壁板',
      '清板',
      'PU板',
      'OPP板',
      '琉璃瓦',
      '浪板收邊',
    ],
    productPatterns: [],
    erpCodePatterns: [/^HM[CGSU]/u, /^HN[CG]/u],
  },
  {
    key: 'plate',
    displayNameZh: '板材',
    aliases: ['板材', '鐵板', '鋼板', '黑鐵板', '白鐵板', 'ST板', '2B板', 'HL板', 'NO1板'],
    productPatterns: [/鐵板/u, /鋼板/u, /^ST(?:BA|2B|HL|NO1)?/u, /^2B/u, /^HL/u],
    erpCodePatterns: [/^DNB/u, /^BN[ASHOT]/u, /^BXS/u],
    excludeProductPatterns: [/專用/u, /釘/u, /螺絲/u, /壁板/u, /浪板/u, /清板/u],
  },
];

const productPriceWeightRuleCatalogFamilies = new Set([
  'b_pipe',
  'a_pipe',
  'p_pipe',
  'steel_pipe',
  'piping',
  'i_beam',
  'round_bar',
  'square_bar',
  'galvanized_plate',
  'ot_plate',
  'black_plate',
  'grating',
  'floor_deck',
  'h_beam',
  'c_type',
  'wire_mesh',
  'expanded_metal',
  'angle',
  'channel',
  'flat_bar',
  'rail',
  'rectangular_pipe',
  'round_pipe',
  'square_pipe',
  'corrugated_panel',
  'plate',
]);

function shouldApplyProductPriceWeightRule(catalogFamily: string): boolean {
  return productPriceWeightRuleCatalogFamilies.has(catalogFamily);
}

function sourcePath(referenceDir: string, sourceFile: string): string {
  return path.join(referenceDir, sourceFile);
}

function readWorkbookRows(referenceDir: string, sourceFile: string, sheetName: string): SheetRow[] {
  const workbook = XLSX.readFile(sourcePath(referenceDir, sourceFile), { cellDates: false });
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error(`${sourceFile} is missing sheet ${sheetName}`);
  }

  return XLSX.utils.sheet_to_json<SheetRow>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });
}

function asText(value: SheetCell | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function parseNumber(value: SheetCell | undefined): number | null {
  const text = asText(value).replace(/,/g, '');

  if (!text) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTierCode(value: SheetCell | undefined): string | null {
  const text = asText(value).replace(/級$/u, '').trim().toUpperCase();
  return text ? text : null;
}

function normalizeSpecKey(...parts: Array<string | null | undefined>): string {
  const joined = parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join('_')
    .normalize('NFKC')
    .replace(/[＊*×]/gu, 'x')
    .replace(/\s+/gu, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');

  return joined || 'unknown_spec';
}

function sourceRef(input: {
  sourceFile: string;
  factType: string;
  row: number;
  sheet?: string;
  confidence?: string;
  extractedLabel?: string;
  canonicalKey?: string;
}): SteelImportSourceRef {
  const sheetPart = input.sheet ? `sheet=${input.sheet};` : '';

  return {
    channel: 'admin_erp_xlsx',
    factType: input.factType,
    sourceFile: `${sourcePrefix}/${input.sourceFile}`,
    locator: `${sheetPart}row=${input.row}`,
    confidence: input.confidence,
    extractedLabel: input.extractedLabel,
    canonicalKey: input.canonicalKey,
  };
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = getKey(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

function parseCustomers(referenceDir: string): {
  customerTiers: SteelCustomerTierImportRow[];
  customers: SteelCustomerImportRow[];
} {
  const rows = readWorkbookRows(referenceDir, '客戶資料.xlsx', 'Sheet1');
  const customers: SteelCustomerImportRow[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    if (rowNumber < 7 || rowNumber > 2262) {
      continue;
    }

    const erpCustomerCode = asText(row[0]);
    const sourceDisplayName = asText(row[1]);
    const displayName = sourceDisplayName || erpCustomerCode;
    if (!erpCustomerCode) {
      continue;
    }

    const customerTierCode = normalizeTierCode(row[3]);
    customers.push({
      erpCustomerCode,
      displayName,
      legalName: displayName,
      taxId: null,
      customerTierCode,
      status: 'active',
      notes: null,
      metadata: {
        sourceMissingDisplayName: sourceDisplayName ? undefined : true,
        contactName: asText(row[2]) || undefined,
        phone1: asText(row[4]) || undefined,
        phone2: asText(row[6]) || undefined,
        mobile: asText(row[7]) || undefined,
        address: asText(row[9]) || undefined,
      },
      importLogId: customerImportLogId,
      sourceRefs: [
        sourceRef({
          sourceFile: '客戶資料.xlsx',
          factType: 'customer',
          sheet: 'Sheet1',
          row: rowNumber,
          extractedLabel: '客戶編/客戶名稱/等級',
          canonicalKey: 'erp_customer_code',
        }),
      ],
    });
  }

  const customerTiers = uniqueBy(
    customers
      .map((customer) => customer.customerTierCode)
      .filter((code): code is string => Boolean(code))
      .sort()
      .map((code, index) => ({
        code,
        name: `${code}級`,
        priority: (index + 1) * 10,
        sourceRefs: [
          sourceRef({
            sourceFile: '客戶資料.xlsx',
            factType: 'customer_tier',
            sheet: 'Sheet1',
            row: 5,
            extractedLabel: '等級',
            canonicalKey: 'customer_tier_code',
          }),
        ],
      })),
    (tier) => tier.code,
  );

  return { customerTiers, customers };
}

function classifyPrice(value: number | null): {
  unitPrice: number | null;
  valueState: SteelImportValueState;
  reviewState: SteelImportReviewState;
} {
  if (value === null || value <= 0) {
    return {
      unitPrice: null,
      valueState: 'unknown',
      reviewState: 'needs_review',
    };
  }

  return {
    unitPrice: value,
    valueState: 'confirmed',
    reviewState: 'reviewed',
  };
}

function getCatalogFamilyMatch(
  erpItemCode: string,
  productName: string,
): { key: string; matchedBy: string } | null {
  const normalizedProductName = productName.normalize('NFKC');
  const normalizedErpItemCode = erpItemCode.normalize('NFKC').toUpperCase();

  for (const seed of catalogFamilySeeds) {
    if (
      seed.excludeProductPatterns?.some((pattern) => pattern.test(normalizedProductName)) === true
    ) {
      continue;
    }

    if (seed.erpCodePatterns.some((pattern) => pattern.test(normalizedErpItemCode))) {
      return { key: seed.key, matchedBy: 'erp_item_code' };
    }

    if (seed.productPatterns.some((pattern) => pattern.test(normalizedProductName))) {
      return { key: seed.key, matchedBy: 'product_name' };
    }
  }

  return null;
}

function getErpCodePrefix(erpItemCode: string): string {
  const normalized = erpItemCode.normalize('NFKC').toUpperCase();
  const letterPrefix = normalized.match(/^[A-Z]+/u)?.[0];

  if (letterPrefix) {
    return letterPrefix;
  }

  if (/^\d+/u.test(normalized)) {
    return 'NUMERIC';
  }

  return 'OTHER';
}

function getFallbackCatalogFamilyKey(erpCodePrefix: string): string {
  return `erp_${erpCodePrefix.toLowerCase().replace(/[^a-z0-9]+/gu, '_')}`;
}

function getPriceCategoryCode(erpCodePrefix: string): string {
  return getFallbackCatalogFamilyKey(erpCodePrefix);
}

function getBestCategoryName(rows: readonly ProductPriceSourceRow[]): string {
  const headerLikeRow = rows.find(
    (row) => row.erpItemCode.normalize('NFKC').toUpperCase() === row.erpCodePrefix,
  );

  return headerLikeRow?.productName ?? rows[0]?.productName ?? rows[0]?.erpCodePrefix ?? '未分類';
}

function getDominantCatalogFamily(rows: readonly ProductPriceSourceRow[]): string {
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.catalogFamily, (counts.get(row.catalogFamily) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'erp_other';
}

function readProductPriceSourceRows(rows: SheetRow[]): ProductPriceSourceRow[] {
  const productRows: ProductPriceSourceRow[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    if (rowNumber < 6 || rowNumber > 6764) {
      continue;
    }

    const erpItemCode = asText(row[0]);
    const productName = asText(row[1]);
    if (!erpItemCode || !productName) {
      continue;
    }

    const erpCodePrefix = getErpCodePrefix(erpItemCode);
    const catalogFamilyMatch = getCatalogFamilyMatch(erpItemCode, productName);
    productRows.push({
      rowNumber,
      erpItemCode,
      productName,
      erpCodePrefix,
      categoryCode: getPriceCategoryCode(erpCodePrefix),
      catalogFamily: catalogFamilyMatch?.key ?? getFallbackCatalogFamilyKey(erpCodePrefix),
      catalogFamilyMatchedBy: catalogFamilyMatch?.matchedBy ?? 'erp_prefix_fallback',
    });
  }

  return productRows;
}

function groupRowsBy<T>(rows: readonly T[], getKey: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = getKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return groups;
}

function buildCatalogFamilies(
  productRows: readonly ProductPriceSourceRow[],
): SteelCatalogFamilyImportRow[] {
  const counts = new Map<string, number>();

  for (const row of productRows) {
    counts.set(row.catalogFamily, (counts.get(row.catalogFamily) ?? 0) + 1);
  }

  const seedByKey = new Map(catalogFamilySeeds.map((seed) => [seed.key, seed]));
  const fallbackRowsByFamily = groupRowsBy(
    productRows.filter((row) => row.catalogFamilyMatchedBy === 'erp_prefix_fallback'),
    (row) => row.catalogFamily,
  );

  return [...counts.keys()].sort().map((key) => {
    const seed = seedByKey.get(key);
    const fallbackRows = fallbackRowsByFamily.get(key) ?? [];
    const fallbackName = getBestCategoryName(fallbackRows);

    return {
      key,
      displayNameZh: seed?.displayNameZh ?? fallbackName,
      aliases: seed ? [...seed.aliases] : [fallbackName, fallbackRows[0]?.erpCodePrefix ?? key],
      metadata: {
        importLogId: catalogFamilyImportLogId,
        sourceProductRowCount: counts.get(key) ?? 0,
        sourceKind: seed ? 'curated' : 'erp_prefix_fallback',
        searchHints: seed?.searchHints,
        erpCodePrefix: seed ? undefined : fallbackRows[0]?.erpCodePrefix,
      },
      active: true,
      reviewState: 'reviewed',
      sourceRefs: [
        sourceRef({
          sourceFile: '產品價格.xlsx',
          factType: 'catalog_family',
          sheet: 'Sheet1',
          row: fallbackRows[0]?.rowNumber ?? 5,
          extractedLabel: '型號/品名規格',
          canonicalKey: 'catalog_family',
        }),
      ],
    };
  });
}

function buildPriceCategories(
  productRows: readonly ProductPriceSourceRow[],
): SteelPriceCategoryImportRow[] {
  return [...groupRowsBy(productRows, (row) => row.categoryCode).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, rows]) => ({
      code,
      name: getBestCategoryName(rows),
      catalogFamily: getDominantCatalogFamily(rows),
      defaultUnit: 'piece',
      metadata: {
        importLogId: priceCategoryImportLogId,
        sourceProductRowCount: rows.length,
        erpCodePrefix: rows[0]?.erpCodePrefix,
      },
      sourceRefs: [
        sourceRef({
          sourceFile: '產品價格.xlsx',
          factType: 'price_category',
          sheet: 'Sheet1',
          row: rows[0]?.rowNumber ?? 5,
          extractedLabel: '型號/品名規格',
          canonicalKey: 'price_category',
        }),
      ],
    }));
}

function parseProductPrices(referenceDir: string): {
  catalogFamilies: SteelCatalogFamilyImportRow[];
  priceCategories: SteelPriceCategoryImportRow[];
  customerTiers: SteelCustomerTierImportRow[];
  priceItems: SteelPriceItemImportRow[];
} {
  const rows = readWorkbookRows(referenceDir, '產品價格.xlsx', 'Sheet1');
  const priceItems: SteelPriceItemImportRow[] = [];
  const productRows = readProductPriceSourceRows(rows);
  const sourceRowsByRowNumber = new Map(productRows.map((row) => [row.rowNumber, row]));
  const catalogFamilies = buildCatalogFamilies(productRows);
  const priceCategories = buildPriceCategories(productRows);
  const customerTiers = priceTierCodes.map((code, index) => ({
    code,
    name: `${code}級`,
    priority: (index + 1) * 10,
    sourceRefs: [
      sourceRef({
        sourceFile: '產品價格.xlsx',
        factType: 'customer_tier',
        sheet: 'Sheet1',
        row: 5,
        extractedLabel: `售價${code}`,
        canonicalKey: `unit_price_by_tier.${code}`,
      }),
    ],
  }));

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    if (rowNumber < 6 || rowNumber > 6764) {
      continue;
    }

    const erpItemCode = asText(row[0]);
    const productName = asText(row[1]);
    if (!erpItemCode || !productName) {
      continue;
    }

    const productRow = sourceRowsByRowNumber.get(rowNumber);
    if (!productRow) {
      continue;
    }

    const tierSources = priceTierCodes.map((_, tierOffset) => ({
      unitPrice: parseNumber(row[4 + tierOffset]),
      priceRatio: parseNumber(row[8 + tierOffset]),
    }));
    const sourceUnitWeight = parseNumber(row[12]);
    const applyWeightRule = shouldApplyProductPriceWeightRule(productRow.catalogFamily);
    const unitWeightInfo = applyWeightRule
      ? getProductPriceUnitWeightInfo(productName, sourceUnitWeight, tierSources)
      : {
          value: null,
          origin: null,
          parentheticalValue: getParentheticalUnitWeightCandidate(productName),
        };
    const priceUnitBasis = getProductPriceUnitBasis(productName, unitWeightInfo.value, tierSources);
    const productPriceUnitWeightUnit = getProductPriceUnitWeightUnit(
      productName,
      unitWeightInfo.value,
      priceUnitBasis,
    );

    for (const [tierOffset, customerTierCode] of priceTierCodes.entries()) {
      const tierSource = tierSources[tierOffset];
      const price = classifyPrice(tierSource?.unitPrice ?? null);
      priceItems.push({
        erpItemCode,
        customerTierCode,
        categoryCode: productRow.categoryCode,
        specKey: normalizeSpecKey(erpItemCode, productName),
        productName,
        catalogFamily: productRow.catalogFamily,
        materialGrade: null,
        unit: getProductPriceUnit(productPriceUnitWeightUnit, priceUnitBasis),
        unitPrice: price.unitPrice,
        productPriceUnitWeight: unitWeightInfo.value,
        productPriceUnitWeightUnit,
        currency: 'TWD',
        active: true,
        valueState: price.valueState,
        reviewState: price.reviewState,
        metadata: {
          sourceProductName: productName,
          sourceTierCode: customerTierCode,
          sourceRatio: tierSource?.priceRatio ?? null,
          sourcePriceUnitBasis: priceUnitBasis,
          sourceUnitWeightColumn: sourceUnitWeight,
          sourceUnitWeightOrigin: unitWeightInfo.origin,
          sourceParentheticalUnitWeight: unitWeightInfo.value
            ? unitWeightInfo.parentheticalValue
            : null,
          catalogFamilyMatch: {
            key: productRow.catalogFamily,
            matchedBy: productRow.catalogFamilyMatchedBy,
          },
          priceCategoryCode: productRow.categoryCode,
        },
        importLogId: priceImportLogId,
        sourceRefs: [
          sourceRef({
            sourceFile: '產品價格.xlsx',
            factType: 'product_price',
            sheet: 'Sheet1',
            row: rowNumber,
            extractedLabel: `售價${customerTierCode}`,
            canonicalKey: `unit_price_by_tier.${customerTierCode}`,
          }),
          ...(unitWeightInfo.value
            ? [
                sourceRef({
                  sourceFile: '產品價格.xlsx',
                  factType: 'product_price_unit_weight',
                  sheet: 'Sheet1',
                  row: rowNumber,
                  confidence:
                    unitWeightInfo.origin === 'product_name_parentheses' ? 'medium' : 'high',
                  extractedLabel:
                    unitWeightInfo.origin === 'product_name_parentheses'
                      ? '品名括號單位重'
                      : '單位重',
                  canonicalKey: 'product_price_unit_weight',
                }),
              ]
            : []),
        ],
      });
    }
  }

  return { catalogFamilies, priceCategories, customerTiers, priceItems };
}

function inferProductFamily(sourceSection: string, spec: string): string {
  if (/H|型鋼/u.test(sourceSection)) {
    return 'H型鋼';
  }
  if (/角鐵/u.test(sourceSection)) {
    return '黑角鐵';
  }
  if (/管/u.test(sourceSection)) {
    return '黑鐵管類';
  }
  if (/槽/u.test(sourceSection)) {
    return '黑槽鐵';
  }
  if (/平鐵/u.test(sourceSection)) {
    return '黑平鐵';
  }

  return spec || sourceSection || '未分類';
}

function confidenceToReviewState(confidence: string, price: number | null): SteelImportReviewState {
  if (confidence === '高' && price !== null && price > 0) {
    return 'reviewed';
  }

  return 'needs_review';
}

function confidenceToLevel(confidence: string): 'low' | 'medium' | 'high' {
  if (confidence === '高') {
    return 'high';
  }
  if (confidence === '中') {
    return 'medium';
  }

  return 'low';
}

function parseCuttingPrices(referenceDir: string): {
  cuttingPrices: SteelCuttingPriceImportRow[];
  quoteDefaults: SteelQuoteDefaultImportRow[];
} {
  const rows = readWorkbookRows(referenceDir, '切工價錢.xlsx', '全部整理資料');
  const cuttingPrices: SteelCuttingPriceImportRow[] = [];
  const quoteDefaults: SteelQuoteDefaultImportRow[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    if (rowNumber < 2) {
      continue;
    }

    const sourceSection = asText(row[0]);
    const spec = asText(row[1]);
    const cutType = asText(row[2]) || '切工';
    const processingItemCode = asText(row[3]);
    const note = asText(row[6]);
    const confidence = asText(row[7]) || '未確認';
    const productFamily = inferProductFamily(sourceSection, spec);

    for (const tierGroup of [
      { label: 'A/C/F', value: row[4], tierGroup: 'A_C_F' },
      { label: 'B', value: row[5], tierGroup: 'B' },
    ]) {
      const unitPrice = parseNumber(tierGroup.value);
      const price = classifyPrice(unitPrice);

      cuttingPrices.push({
        productFamily,
        cutType,
        specKey: spec ? normalizeSpecKey(productFamily, spec) : null,
        lengthM: null,
        unit: 'cut',
        unitPrice: price.unitPrice,
        surchargePerKg: null,
        currency: 'TWD',
        active: true,
        valueState: price.valueState,
        reviewState: confidenceToReviewState(confidence, unitPrice),
        metadata: {
          sourceSection,
          sourceSpec: spec,
          processingItemCode: processingItemCode || undefined,
          note: note || undefined,
          tierGroup: tierGroup.tierGroup,
        },
        importLogId: cuttingImportLogId,
        sourceRefs: [
          sourceRef({
            sourceFile: '切工價錢.xlsx',
            factType: 'cutting_price',
            sheet: '全部整理資料',
            row: rowNumber,
            confidence,
            extractedLabel: tierGroup.label,
            canonicalKey: `cutting_unit_price_by_tier.${tierGroup.tierGroup}`,
          }),
        ],
      });
    }

    if (note && fuzzyNotePattern.test(note)) {
      quoteDefaults.push(
        buildFuzzyNoteDefault({
          originId: `cutting-note-row-${rowNumber}`,
          sourceFile: '切工價錢.xlsx',
          sheet: '全部整理資料',
          row: rowNumber,
          note,
          confidence,
          productFamily,
          chargeType: chargeTypeFromCutType(cutType),
          selector: {
            sourceSection,
            spec,
            cutType,
          },
        }),
      );
    }
  }

  quoteDefaults.push(...parseCuttingNoteDefaults(referenceDir));

  return { cuttingPrices, quoteDefaults };
}

function chargeTypeFromCutType(cutType: string): 'cutting' | 'hole' | 'slotting' | 'processing' {
  if (/孔|沖孔/u.test(cutType)) {
    return 'hole';
  }
  if (/槽/u.test(cutType)) {
    return 'slotting';
  }
  if (/切/u.test(cutType)) {
    return 'cutting';
  }

  return 'processing';
}

function buildFuzzyNoteDefault(input: {
  originId: string;
  sourceFile: string;
  sheet: string;
  row: number;
  note: string;
  confidence: string;
  productFamily: string | null;
  chargeType: 'cutting' | 'hole' | 'slotting' | 'bending' | 'processing' | null;
  selector: SteelImportJsonValue;
}): SteelQuoteDefaultImportRow {
  return {
    defaultType: 'preference_rule',
    originTable: `${sourcePrefix}/${input.sourceFile}`,
    originId: input.originId,
    originRevision: '1',
    scopeType: input.productFamily ? 'product_family' : 'company',
    customerTierCode: null,
    catalogFamily: null,
    productFamily: input.productFamily,
    chargeType: input.chargeType,
    formulaCode: null,
    selector: input.selector,
    effect: 'preference_rule',
    defaultParameters: [
      {
        parameterKey: 'note',
        valueType: 'text',
        value: input.note,
      },
      {
        parameterKey: 'requiresConfirmation',
        valueType: 'boolean',
        value: true,
      },
    ],
    priority: 50,
    confidence: confidenceToLevel(input.confidence),
    active: true,
    reviewState: input.confidence === '高' ? 'reviewed' : 'needs_review',
    sourceRefs: [
      sourceRef({
        sourceFile: input.sourceFile,
        factType: 'quote_default',
        sheet: input.sheet,
        row: input.row,
        confidence: input.confidence,
        extractedLabel: '備註',
        canonicalKey: 'quote_default_note',
      }),
    ],
  };
}

function parseCuttingNoteDefaults(referenceDir: string): SteelQuoteDefaultImportRow[] {
  const defaults: SteelQuoteDefaultImportRow[] = [];
  const sheetNames = ['斜切加價備註', '判讀備註'];

  for (const sheetName of sheetNames) {
    const rows = readWorkbookRows(referenceDir, '切工價錢.xlsx', sheetName);
    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 1;
      if (rowNumber < 2) {
        continue;
      }

      const item = asText(row[0]);
      const note = asText(row[1]);
      const confidence = asText(row[2]) || (fuzzyNotePattern.test(note) ? '低' : '中');
      if (!note || !fuzzyNotePattern.test(note)) {
        continue;
      }

      defaults.push(
        buildFuzzyNoteDefault({
          originId: `cutting-${sheetName}-row-${rowNumber}`,
          sourceFile: '切工價錢.xlsx',
          sheet: sheetName,
          row: rowNumber,
          note,
          confidence,
          productFamily: item || null,
          chargeType: 'cutting',
          selector: {
            item,
            note,
          },
        }),
      );
    }
  }

  return defaults;
}

function parseFormulas(referenceDir: string): SteelFormulaVersionImportRow[] {
  const rows = readWorkbookRows(referenceDir, '公式編號.xlsx', 'Sheet1');
  const formulas: SteelFormulaVersionImportRow[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    if (rowNumber < 19) {
      continue;
    }

    const code = asText(row[0]);
    const displayName = asText(row[2]);
    const expression = asText(row[4]);
    if (!code || !expression) {
      continue;
    }

    const length = parseNumber(row[12]);
    formulas.push({
      code,
      versionSeq: 1,
      displayName: displayName || null,
      sourceExpression: expression,
      formulaBody: {
        name: displayName || undefined,
        expression,
        length,
      },
      compiledFormula: null,
      allowedVariables: [],
      active: true,
      reviewState: 'reviewed',
      sourceRefs: [
        sourceRef({
          sourceFile: '公式編號.xlsx',
          factType: 'formula',
          sheet: 'Sheet1',
          row: rowNumber,
          extractedLabel: '公式編號/公式計算式',
          canonicalKey: 'formula_code',
        }),
      ],
    });
  }

  return formulas;
}

function parseHTypeDefaults(referenceDir: string): SteelQuoteDefaultImportRow[] {
  const sourceFile = 'H型鋼.txt';
  const text = fs.readFileSync(sourcePath(referenceDir, sourceFile), 'utf8');
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  const sourceText = lines.join('\n');

  return [
    {
      defaultType: 'material_rule',
      originTable: `${sourcePrefix}/${sourceFile}`,
      originId: 'h-type-non-standard-length-surcharge-v1',
      originRevision: '1',
      scopeType: 'catalog_family',
      customerTierCode: null,
      catalogFamily: 'h_beam',
      productFamily: null,
      chargeType: 'material',
      formulaCode: null,
      selector: {
        regularLengthsM: [6, 9, 10, 12],
        nonStandardLengthExamplesM: [7, 8, 11, 13, 14, 15],
      },
      effect: 'parameter_override',
      defaultParameters: [
        {
          parameterKey: 'surchargePerKg',
          valueType: 'money_per_kg',
          value: 0.3,
        },
        {
          parameterKey: 'requiresConfirmation',
          valueType: 'boolean',
          value: false,
        },
        {
          parameterKey: 'sourceText',
          valueType: 'text',
          value: sourceText,
        },
      ],
      priority: 10,
      confidence: 'high',
      active: true,
      reviewState: 'reviewed',
      sourceRefs: [
        {
          channel: 'manual',
          factType: 'quote_default',
          sourceFile: `${sourcePrefix}/${sourceFile}`,
          locator: `line=1-${lines.length}`,
          confidence: '高',
          extractedLabel: 'H型鋼非常規長度加價',
          canonicalKey: 'surcharge_per_kg',
        },
      ],
    },
  ];
}

export function buildSteelReferenceImportPlan(
  options: SteelReferenceImportOptions,
): SteelReferenceImportPlan {
  const customerData = parseCustomers(options.referenceDir);
  const productPriceData = parseProductPrices(options.referenceDir);
  const cuttingData = parseCuttingPrices(options.referenceDir);
  const formulaVersions = parseFormulas(options.referenceDir);
  const quoteDefaults = [...parseHTypeDefaults(options.referenceDir), ...cuttingData.quoteDefaults];
  const customerTiers = uniqueBy(
    [...customerData.customerTiers, ...productPriceData.customerTiers],
    (tier) => tier.code,
  ).sort((left, right) => left.priority - right.priority);

  return {
    factSources: [...factSources],
    workbookOnlySources: [...workbookOnlySources],
    catalogFamilies: productPriceData.catalogFamilies,
    priceCategories: productPriceData.priceCategories,
    customerTiers,
    customers: customerData.customers,
    priceItems: productPriceData.priceItems,
    cuttingPrices: cuttingData.cuttingPrices,
    formulaVersions,
    quoteDefaults,
    summary: {
      catalogFamilies: productPriceData.catalogFamilies.length,
      priceCategories: productPriceData.priceCategories.length,
      customerTiers: customerTiers.length,
      customers: customerData.customers.length,
      priceItems: productPriceData.priceItems.length,
      cuttingPrices: cuttingData.cuttingPrices.length,
      formulaVersions: formulaVersions.length,
      quoteDefaults: quoteDefaults.length,
    },
  };
}
