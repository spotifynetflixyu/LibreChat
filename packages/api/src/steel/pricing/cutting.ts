export type SteelCuttingSourceValue = string | number | null;

export interface SteelCuttingSourceRow {
  sourceBlock: string;
  itemSpec: string | null;
  processing: string;
  tierAcf: SteelCuttingSourceValue;
  tierB: SteelCuttingSourceValue;
  notes: string | null;
  sourceSheet: string;
  sourceRow: number;
}

export type SteelCuttingRecordType = 'price' | 'supplement';

export interface SteelCuttingRow {
  cuttingCategory: string;
  recordType: SteelCuttingRecordType;
  itemName: string;
  cutType: string;
  specText: string | null;
  normalizedSpecText: string | null;
  inchMin: number | null;
  inchMax: number | null;
  mmMin: number | null;
  mmMax: number | null;
  unit: string | null;
  unitPriceA: number | null;
  unitPriceB: number | null;
  unitPriceC: number | null;
  unitPriceF: number | null;
  conditions: Record<string, string>;
  calculationRule: string | null;
  notes: string | null;
  sourceSheet: string;
  sourceRow: number;
}

export interface SteelCuttingRows {
  prices: SteelCuttingRow[];
  supplements: SteelCuttingRow[];
}

interface InchRange {
  inchMin: number | null;
  inchMax: number | null;
  mmMin: number | null;
  mmMax: number | null;
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/[＊*×X]/gu, 'x').trim();
}

function parseNullablePrice(value: SteelCuttingSourceValue): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Number(value.normalize('NFKC').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInchNumber(value: string): number | null {
  const normalized = value
    .normalize('NFKC')
    .replace(/["”″吋]/gu, '')
    .trim();
  const mixed = normalized.match(/^(\d+)\s+(\d+)\/(\d+)$/u);

  if (mixed) {
    const denominator = Number(mixed[3]);
    return denominator === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / denominator;
  }

  const fraction = normalized.match(/^(\d+)\/(\d+)$/u);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMillimeters(inches: number): number {
  return Math.round(inches * 25.4 * 1_000_000_000) / 1_000_000_000;
}

function parseInchRange(specText: string | null): InchRange {
  if (!specText || !/["”″吋]/u.test(specText)) {
    return { inchMin: null, inchMax: null, mmMin: null, mmMax: null };
  }

  const parts = specText.normalize('NFKC').split(/[~～]/u);
  if (parts.length > 2) {
    return { inchMin: null, inchMax: null, mmMin: null, mmMax: null };
  }

  const inchMin = parseInchNumber(parts[0]);
  const inchMax = parseInchNumber(parts[1] ?? parts[0]);
  if (inchMin === null || inchMax === null) {
    return { inchMin: null, inchMax: null, mmMin: null, mmMax: null };
  }

  return {
    inchMin,
    inchMax,
    mmMin: toMillimeters(inchMin),
    mmMax: toMillimeters(inchMax),
  };
}

function getRecordType(row: SteelCuttingSourceRow): SteelCuttingRecordType {
  if (normalizeText(row.processing) === '補充') {
    return 'supplement';
  }
  if (typeof row.tierAcf === 'string' && parseNullablePrice(row.tierAcf) === null) {
    return 'supplement';
  }
  if (typeof row.tierB === 'string' && parseNullablePrice(row.tierB) === null) {
    return 'supplement';
  }

  return 'price';
}

function buildSteelCuttingRow(row: SteelCuttingSourceRow): SteelCuttingRow {
  const cuttingCategory = normalizeText(row.sourceBlock);
  const sourceIdentity = `${row.sourceSheet}:${row.sourceRow}`;
  if (!cuttingCategory) {
    throw new Error(`Missing cutting category at ${sourceIdentity}`);
  }

  const cutType = normalizeText(row.processing);
  if (!cutType) {
    throw new Error(`Missing cutting type at ${sourceIdentity}`);
  }

  const recordType = getRecordType(row);
  const specText = row.itemSpec?.trim() || null;
  const normalizedSpecText = specText ? normalizeText(specText) : null;
  const tierAcf = recordType === 'price' ? parseNullablePrice(row.tierAcf) : null;
  const tierB = recordType === 'price' ? parseNullablePrice(row.tierB) : null;
  const calculationRule =
    recordType === 'supplement' && typeof row.tierAcf === 'string'
      ? normalizeText(row.tierAcf)
      : null;

  return {
    cuttingCategory,
    recordType,
    itemName: normalizedSpecText ?? cutType,
    cutType,
    specText,
    normalizedSpecText,
    ...parseInchRange(specText),
    unit: recordType === 'price' ? '刀' : null,
    unitPriceA: tierAcf,
    unitPriceB: tierB,
    unitPriceC: tierAcf,
    unitPriceF: tierAcf,
    conditions: {},
    calculationRule,
    notes: row.notes?.trim() || null,
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
  };
}

export function buildSteelCuttingRows(rows: readonly SteelCuttingSourceRow[]): SteelCuttingRows {
  const seenSourceRows = new Set<string>();

  return rows.reduce<SteelCuttingRows>(
    (result, row) => {
      const sourceIdentity = `${row.sourceSheet}:${row.sourceRow}`;
      if (seenSourceRows.has(sourceIdentity)) {
        throw new Error(`Duplicate cutting source row: ${sourceIdentity}`);
      }
      seenSourceRows.add(sourceIdentity);

      const parsed = buildSteelCuttingRow(row);
      result[parsed.recordType === 'price' ? 'prices' : 'supplements'].push(parsed);
      return result;
    },
    { prices: [], supplements: [] },
  );
}
