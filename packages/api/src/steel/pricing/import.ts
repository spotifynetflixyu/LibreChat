import { materialKinds, priceCategories, type MaterialKind, type PriceCategory } from './enums';
import { normalizeSteelSpecKey, normalizeSteelSpecKeyOrUnknown } from '../normalization/spec';

import type { SteelValueState, SteelReviewState } from '../repositories/types';

export interface SteelPriceWorkbookInputRow {
  workbookName: string;
  worksheetRowNumber: number;
  row: Record<string, unknown>;
}

export interface SteelPriceImportRow {
  priceKind: 'product' | 'cutting' | 'hole';
  sourceDataset: string;
  sourceRowKey: string;
  erpItemCode: string | null;
  productName: string;
  specKey: string;
  category: PriceCategory;
  subcategory: string | null;
  material: MaterialKind | null;
  sourceCategoryLabel: string | null;
  sourceSubcategoryLabel: string | null;
  sourceMaterialLabel: string | null;
  sourceThickness: string | null;
  sourceSpec: string | null;
  unit: string;
  currency: 'TWD';
  unitPriceA: number | null;
  unitPriceB: number | null;
  unitPriceC: number | null;
  unitPriceF: number | null;
  ratioA: number | null;
  ratioB: number | null;
  ratioC: number | null;
  ratioF: number | null;
  productPriceUnitWeight: number | null;
  productPriceUnitWeightUnit: string | null;
  active: boolean;
  valueState: SteelValueState;
  reviewState: SteelReviewState;
  metadata: Record<string, unknown>;
  sourceRefs: Array<{
    channel: string;
    factType: string;
    sourceFile: string;
    locator: string;
    extractedLabel?: string;
  }>;
}

const sourceDataset = 'product_price_v3';
const normalizedCategories = new Set<string>(priceCategories);
const normalizedMaterials = new Set<string>(materialKinds);
const plateCorrectionErpCodes = new Set([
  'B4NA900010',
  'B4NA900012',
  'B4NA900015',
  'B4NH900010',
  'B4NH900012',
  'B4NH900015',
  'B4NS900010',
  'B4NS900012',
  'B4NS900015',
  'B4NS900020',
  'B4NS900030',
  'B4NT900030',
  'B4NT900045',
  'B4NT900060',
  'B4XS900030',
]);

function readCell(row: Record<string, unknown>, key: string): string {
  const value = row[key];

  if (value === null || value === undefined) {
    return '';
  }

  return String(value).normalize('NFKC').trim();
}

function normalizeCategory(value: string): PriceCategory {
  const normalized = value === '其他加工' ? '加工' : value;

  if (!normalizedCategories.has(normalized)) {
    throw new Error(`Unknown Steel price category: ${value}`);
  }

  return normalized as PriceCategory;
}

function shouldApplyPlateCorrection(input: SteelPriceWorkbookInputRow, erpItemCode: string | null) {
  return (
    erpItemCode !== null &&
    plateCorrectionErpCodes.has(erpItemCode) &&
    input.workbookName.includes('產品價格_03_鐵板')
  );
}

function normalizeMaterial(value: string): MaterialKind | null {
  const normalized = (() => {
    if (value === '' || value === '不適用') {
      return '無';
    }
    if (value === 'No1 白鐵3t以上含') {
      return 'No1 白鐵';
    }
    if (value === '鋁/鋁合金') {
      return '鋁';
    }
    if (value === 'PVC' || value === 'PC') {
      return '塑膠';
    }

    return value;
  })();

  if (!normalizedMaterials.has(normalized)) {
    throw new Error(`Unknown Steel material: ${value}`);
  }

  return normalized as MaterialKind;
}

function normalizeIntegerString(value: string): string {
  if (/^\d+$/u.test(value)) {
    return `${value}.0`;
  }

  return value;
}

function normalizeTextField(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return normalizeIntegerString(trimmed);
}

function normalizeSpecField(...values: readonly string[]): string | null {
  const joined = values.map((value) => value.trim()).filter(Boolean).join(' ');
  if (!joined) {
    return null;
  }

  return normalizeSteelSpecKey(joined) ?? joined;
}

function normalizeSubcategory(value: string): string | null {
  return normalizeTextField(value);
}

function parseNumber(value: string): number | null {
  const compact = value.replace(/,/gu, '').trim();

  if (!compact) {
    return null;
  }

  const parsed = Number(compact);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeUnit(value: string): string {
  return value === 'Kg' ? 'kg' : value || 'piece';
}

function getPriceKind(category: PriceCategory): SteelPriceImportRow['priceKind'] {
  if (category === '孔') {
    return 'hole';
  }

  if (category === '切工/切割' || category === '折工' || category === '加工') {
    return 'cutting';
  }

  return 'product';
}

function getProductWeightUnit(unitWeight: number | null): string | null {
  return unitWeight === null ? null : 'kg_per_piece';
}

function toSourceRowKey(input: SteelPriceWorkbookInputRow): string {
  return `${input.workbookName}:整理後資料:${input.worksheetRowNumber}`;
}

function toImportRow(input: SteelPriceWorkbookInputRow): SteelPriceImportRow | null {
  const erpItemCode = readCell(input.row, '型號') || null;
  const productName = readCell(input.row, '品名規格');

  if (!erpItemCode && !productName) {
    return null;
  }

  if (!productName) {
    return null;
  }

  const rawSourceCategoryLabel = readCell(input.row, '類別');
  const sourceSubcategoryLabel = normalizeSubcategory(readCell(input.row, '次類別'));
  const sourceMaterialLabel = readCell(input.row, '材質');
  const applyPlateCorrection = shouldApplyPlateCorrection(input, erpItemCode);
  const sourceCategoryLabel = applyPlateCorrection ? '鐵板/鋼板' : rawSourceCategoryLabel;
  const category = applyPlateCorrection
    ? '鐵板/鋼板'
    : normalizeCategory(rawSourceCategoryLabel);
  const material = normalizeMaterial(sourceMaterialLabel);
  const sourceThickness = normalizeTextField(readCell(input.row, '厚度'));
  const sourceSpec = normalizeSpecField(
    readCell(input.row, '規格'),
    readCell(input.row, '欄C'),
    readCell(input.row, '欄D'),
  );
  const priceStatus = readCell(input.row, '價格狀態');
  const active = readCell(input.row, '停用/缺貨註記') !== '是';
  const hasPrice = priceStatus === '有售價';
  const valueState: SteelValueState = hasPrice ? 'confirmed' : 'unknown';
  const reviewState: SteelReviewState = hasPrice && active ? 'reviewed' : 'needs_review';
  const unitWeight = hasPrice ? parseNumber(readCell(input.row, '單位重')) : null;

  return {
    priceKind: getPriceKind(category),
    sourceDataset,
    sourceRowKey: toSourceRowKey(input),
    erpItemCode,
    productName,
    specKey: normalizeSteelSpecKeyOrUnknown(
      erpItemCode,
      productName,
      sourceThickness,
      sourceSubcategoryLabel,
      sourceSpec,
    ),
    category,
    subcategory: sourceSubcategoryLabel,
    material,
    sourceCategoryLabel,
    sourceSubcategoryLabel,
    sourceMaterialLabel,
    sourceThickness,
    sourceSpec,
    unit: normalizeUnit(readCell(input.row, '單位')),
    currency: 'TWD',
    unitPriceA: hasPrice ? parseNumber(readCell(input.row, '售價A')) : null,
    unitPriceB: hasPrice ? parseNumber(readCell(input.row, '售價B')) : null,
    unitPriceC: hasPrice ? parseNumber(readCell(input.row, '售價C')) : null,
    unitPriceF: hasPrice ? parseNumber(readCell(input.row, '售價F')) : null,
    ratioA: hasPrice ? parseNumber(readCell(input.row, '比率A')) : null,
    ratioB: hasPrice ? parseNumber(readCell(input.row, '比率B')) : null,
    ratioC: hasPrice ? parseNumber(readCell(input.row, '比率C')) : null,
    ratioF: hasPrice ? parseNumber(readCell(input.row, '比率F')) : null,
    productPriceUnitWeight: unitWeight === 0 ? null : unitWeight,
    productPriceUnitWeightUnit: getProductWeightUnit(unitWeight === 0 ? null : unitWeight),
    active,
    valueState,
    reviewState,
    metadata: {
      priceStatus,
      stoppedOrOutOfStock: readCell(input.row, '停用/缺貨註記'),
      originalRowNumber: readCell(input.row, '原始列號') || null,
    },
    sourceRefs: [
      {
        channel: 'admin_erp_xlsx',
        factType: 'product_price',
        sourceFile: input.workbookName,
        locator: `sheet=整理後資料;row=${input.worksheetRowNumber}`,
        extractedLabel: productName,
      },
    ],
  };
}

export function buildSteelPriceImportRows(
  rows: readonly SteelPriceWorkbookInputRow[],
): SteelPriceImportRow[] {
  return rows.flatMap((row) => {
    const importRow = toImportRow(row);

    return importRow ? [importRow] : [];
  });
}
