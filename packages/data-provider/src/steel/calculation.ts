import { z } from 'zod';

const decimalPattern = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
const dimensionPattern = /^(\d+(?:\.\d+)?)\s*(mm|毫米|公厘|cm|公分|厘米|m|公尺|米|in|inch|英吋|英寸|吋|")?$/i;

export const steelCalculationProvenanceKindSchema = z.enum(['candidate', 'manual', 'derived', 'legacy']);
export type SteelCalculationProvenanceKind = z.infer<typeof steelCalculationProvenanceKindSchema>;

export const steelCalculationCandidateEvidenceSchema = z.object({
  erpItemCode: z.string().min(1),
  category: z.string().min(1),
  ruleVersion: z.string().min(1),
  unitWeightBasis: z.string().min(1).optional(),
  exactPhysical: z.object({
    density: z.string().min(1).optional(),
    widthMm: z.string().min(1).optional(),
    lengthMm: z.string().min(1).optional(),
    unitWeightValue: z.string().min(1).optional(),
  }).strict(),
}).strict();
export type SteelCalculationCandidateEvidence = z.infer<typeof steelCalculationCandidateEvidenceSchema>;

export const steelCalculationFieldProvenanceSchema = z.object({
  kind: steelCalculationProvenanceKindSchema,
  candidateCode: z.string().min(1).optional(),
  ruleVersion: z.string().min(1).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
}).strict();
export type SteelCalculationFieldProvenance = z.infer<typeof steelCalculationFieldProvenanceSchema>;

export const steelProcessingMeasurementRuleVersion = 'v1' as const;
const steelMeasurementDecimalSchema = z.string().regex(/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/);
const steelMeasurementIntegerSchema = z.string().regex(/^\d+$/);

export const steelProcessingMeasurementModeSchema = z.enum(['perPiece', 'batch', 'cutting']);
export type SteelProcessingMeasurementMode = z.infer<typeof steelProcessingMeasurementModeSchema>;

export const steelProcessingMeasurementSimpleSchema = z.object({
  mode: z.enum(['perPiece', 'batch']),
  amount: steelMeasurementDecimalSchema.nullable(),
  unit: z.string(),
  ruleVersion: z.literal(steelProcessingMeasurementRuleVersion).optional(),
}).strict();

export const steelProcessingCuttingGroupSchema = z.object({
  stockLengthMm: steelMeasurementDecimalSchema.nullable(),
  pieceLengthMm: steelMeasurementDecimalSchema.nullable(),
  pieceCount: steelMeasurementIntegerSchema.nullable(),
  stockCount: steelMeasurementIntegerSchema.nullable(),
  lossMm: steelMeasurementDecimalSchema.nullable(),
  remainderMm: steelMeasurementDecimalSchema.nullable(),
  headTrimMm: steelMeasurementDecimalSchema.nullable(),
  tailTrimMm: steelMeasurementDecimalSchema.nullable(),
  pieceHeadTrimMm: steelMeasurementDecimalSchema.nullable(),
  pieceTailTrimMm: steelMeasurementDecimalSchema.nullable(),
}).strict();

export const steelProcessingCuttingMeasurementSchema = z.object({
  mode: z.literal('cutting'),
  amount: z.null(),
  unit: z.literal('刀'),
  ruleVersion: z.literal(steelProcessingMeasurementRuleVersion).optional(),
  planId: z.string().min(1).nullable().optional(),
  planVersion: z.string().min(1).nullable().optional(),
  confirmed: z.boolean(),
  groups: z.array(steelProcessingCuttingGroupSchema),
}).strict();

export const steelProcessingMeasurementSchema = z.union([
  steelProcessingMeasurementSimpleSchema,
  steelProcessingCuttingMeasurementSchema,
]);
export type SteelProcessingMeasurement = z.infer<typeof steelProcessingMeasurementSchema>;
export type SteelProcessingCuttingGroup = z.infer<typeof steelProcessingCuttingGroupSchema>;

export const steelCalculationRowMetadataSchema = z.object({
  candidate: steelCalculationCandidateEvidenceSchema.optional(),
  measurement: steelProcessingMeasurementSchema.optional(),
  fields: z.record(z.string(), steelCalculationFieldProvenanceSchema).optional(),
}).strict();
export type SteelCalculationRowMetadata = z.infer<typeof steelCalculationRowMetadataSchema>;

export const steelCalculationCheckpointRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  rowId: z.string().min(1).optional(),
  candidate: steelCalculationCandidateEvidenceSchema,
}).strict();
export type SteelCalculationCheckpointRow = z.infer<typeof steelCalculationCheckpointRowSchema>;

export const steelCalculationCheckpointSchema = z.object({
  version: z.literal(1),
  systemOrderHash: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(steelCalculationCheckpointRowSchema),
}).strict();
export type SteelCalculationCheckpoint = z.infer<typeof steelCalculationCheckpointSchema>;

export interface SteelCalculationRowInput {
  headers: readonly string[];
  values: readonly string[];
  candidate?: SteelCalculationCandidateEvidence;
  changedHeaders?: readonly string[];
  provenance?: Readonly<Record<string, SteelCalculationFieldProvenance>>;
  systemKind?: 'material' | 'processing' | 'unassigned';
}

export interface SteelCalculationRowResult {
  values: string[];
  provenance?: Record<string, SteelCalculationFieldProvenance>;
  calculated: boolean;
  calculatedHeaders: string[];
}

interface DecimalParts {
  digits: bigint;
  scale: number;
}

function parseDecimal(value: string): DecimalParts | undefined {
  const normalized = normalizeSteelDecimal(value);
  if (normalized === undefined) return undefined;
  const [integer = '0', fraction = ''] = normalized.split('.');
  return { digits: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function decimalText(parts: DecimalParts): string {
  if (parts.digits === BigInt(0)) return '0';
  const negative = parts.digits < BigInt(0);
  const digits = (negative ? -parts.digits : parts.digits).toString().padStart(parts.scale + 1, '0');
  if (parts.scale === 0) return `${negative ? '-' : ''}${digits}`;
  const result = `${digits.slice(0, -parts.scale)}.${digits.slice(-parts.scale)}`;
  return `${negative ? '-' : ''}${result.replace(/0+$/g, '').replace(/\.$/g, '')}`;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < BigInt(0) ? -left : left;
  let b = right < BigInt(0) ? -right : right;
  while (b !== BigInt(0)) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function powerOfTen(exponent: number): bigint {
  return BigInt(`1${'0'.repeat(exponent)}`);
}

export function normalizeSteelDecimal(value: string | null | undefined): string | undefined {
  const text = value?.trim() ?? '';
  if (!text || !decimalPattern.test(text)) return undefined;
  const parsed = parseUnsignedDecimal(text.replace(/,/g, ''));
  if (!parsed) return undefined;
  return decimalText(parsed);
}

function parseUnsignedDecimal(value: string): DecimalParts | undefined {
  const [integer = '0', fraction = ''] = value.split('.');
  const digits = BigInt(`${integer}${fraction}`);
  return { digits, scale: fraction.length };
}

function multiplyParts(left: DecimalParts, right: DecimalParts): DecimalParts {
  return { digits: left.digits * right.digits, scale: left.scale + right.scale };
}

function rationalToDecimal(numerator: bigint, denominator: bigint, inputScale: number): string | undefined {
  if (denominator === BigInt(0)) return undefined;
  denominator *= powerOfTen(inputScale);
  const divisor = gcd(numerator, denominator);
  let reducedDenominator = denominator / divisor;
  for (const factor of [BigInt(2), BigInt(5)]) {
    while (reducedDenominator % factor === BigInt(0)) reducedDenominator /= factor;
  }
  if (reducedDenominator !== BigInt(1)) return undefined;
  let digits = numerator;
  let outputScale = 0;
  while ((digits * powerOfTen(outputScale)) % denominator !== BigInt(0)) outputScale += 1;
  digits = (digits * powerOfTen(outputScale)) / denominator;
  return decimalText({ digits, scale: outputScale });
}

export function multiplySteelDecimals(values: readonly string[]): string | undefined {
  let result: DecimalParts = { digits: BigInt(1), scale: 0 };
  for (const value of values) {
    const parsed = parseDecimal(value);
    if (!parsed) return undefined;
    result = multiplyParts(result, parsed);
  }
  return decimalText(result);
}

function factorForDimension(unitValue: string | undefined): { numerator: bigint; denominator: bigint } | undefined {
  const unit = unitValue?.trim().toLowerCase() ?? 'mm';
  if (unit === 'cm' || unit === '公分' || unit === '厘米') return { numerator: BigInt(10), denominator: BigInt(1) };
  if (unit === 'm' || unit === '公尺' || unit === '米') return { numerator: BigInt(1000), denominator: BigInt(1) };
  if (unit === 'in' || unit === 'inch' || unit === '英吋' || unit === '英寸' || unit === '吋' || unit === '"') {
    return { numerator: BigInt(127), denominator: BigInt(5) };
  }
  return { numerator: BigInt(1), denominator: BigInt(1) };
}

export function convertSteelDimensionToMillimetres(value: string | null | undefined): string | undefined {
  const text = value?.trim() ?? '';
  const match = text.match(dimensionPattern);
  if (!match) return undefined;
  const decimal = normalizeSteelDecimal(match[1]);
  if (decimal === undefined) return undefined;
  const parsed = parseDecimal(decimal);
  const factor = factorForDimension(match[2]);
  if (!parsed || !factor) return undefined;
  return rationalToDecimal(parsed.digits * factor.numerator, factor.denominator, parsed.scale);
}

export function divideSteelDecimalsExactly(numerator: string, denominator: string): string | undefined {
  const left = parseDecimal(numerator);
  const right = parseDecimal(denominator);
  if (!left || !right || right.digits === BigInt(0)) return undefined;
  return rationalToDecimal(left.digits * powerOfTen(right.scale), right.digits * powerOfTen(left.scale), 0);
}

const profileCategories = new Set(['H型鋼', 'C型鋼', '角鐵', '槽鐵', '平鐵', '方管', '圓管', '圓條']);
const cuttingCategories = new Set(['H型鋼', 'C型鋼', '角鐵', '槽鐵', '平鐵', '方管', '圓管', '扁方管', '圓條', '方鐵']);

function valueAt(headers: readonly string[], values: readonly string[], header: string): string {
  const index = headers.indexOf(header);
  return index < 0 ? '' : values[index] ?? '';
}

function dimensionAt(headers: readonly string[], values: readonly string[], header: string): string | undefined {
  return convertSteelDimensionToMillimetres(valueAt(headers, values, header));
}

function setValue(headers: readonly string[], values: string[], header: string, value: string): void {
  const index = headers.indexOf(header);
  if (index >= 0) values[index] = value;
}

function addDecimalValues(values: readonly string[]): string | undefined {
  const parts = values.map(parseDecimal);
  if (parts.some((part) => !part)) return undefined;
  const scale = Math.max(...parts.map((part) => part?.scale ?? 0));
  const digits = parts.reduce((sum, part) => {
    if (!part) return sum;
    return sum + part.digits * powerOfTen(scale - part.scale);
  }, BigInt(0));
  return decimalText({ digits, scale });
}

function subtractOne(value: string): string | undefined {
  const parsed = parseDecimal(value);
  if (!parsed || parsed.scale !== 0 || parsed.digits <= BigInt(0)) return undefined;
  return decimalText({ digits: parsed.digits - BigInt(1), scale: 0 });
}

function compareDecimalValues(left: string, right: string): number | undefined {
  const leftParts = parseDecimal(left);
  const rightParts = parseDecimal(right);
  if (!leftParts || !rightParts) return undefined;
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftDigits = leftParts.digits * powerOfTen(scale - leftParts.scale);
  const rightDigits = rightParts.digits * powerOfTen(scale - rightParts.scale);
  return leftDigits === rightDigits ? 0 : leftDigits < rightDigits ? -1 : 1;
}

function isPositiveDecimal(value: string | undefined): boolean {
  return value !== undefined && compareDecimalValues(value, '0') === 1;
}

function isIntegerDecimal(value: string | undefined): boolean {
  return value !== undefined && !value.includes('.') && !value.includes(',');
}

function quantityValue(headers: readonly string[], values: readonly string[]): string | undefined {
  return normalizeSteelDecimal(valueAt(headers, values, '數量'));
}

function exactCuttingGroupCount(group: SteelProcessingCuttingGroup): string | undefined {
  const stockLength = normalizeSteelDecimal(group.stockLengthMm);
  const pieceLength = normalizeSteelDecimal(group.pieceLengthMm);
  const pieceCount = normalizeSteelDecimal(group.pieceCount);
  const stockCount = normalizeSteelDecimal(group.stockCount);
  const loss = normalizeSteelDecimal(group.lossMm);
  const remainder = normalizeSteelDecimal(group.remainderMm);
  const headTrim = normalizeSteelDecimal(group.headTrimMm);
  const tailTrim = normalizeSteelDecimal(group.tailTrimMm);
  const pieceHeadTrim = normalizeSteelDecimal(group.pieceHeadTrimMm);
  const pieceTailTrim = normalizeSteelDecimal(group.pieceTailTrimMm);
  if (!stockLength || !pieceLength || !pieceCount || !stockCount || !loss || !remainder ||
    !headTrim || !tailTrim || !pieceHeadTrim || !pieceTailTrim ||
    !isPositiveDecimal(stockLength) || !isPositiveDecimal(pieceLength) ||
    !isPositiveDecimal(pieceCount) || !isPositiveDecimal(stockCount) ||
    !isIntegerDecimal(pieceCount) || !isIntegerDecimal(stockCount)) {
    return undefined;
  }
  const finishedPieceLength = addDecimalValues([pieceLength, pieceHeadTrim, pieceTailTrim]);
  const usedPieces = finishedPieceLength && multiplySteelDecimals([pieceCount, finishedPieceLength]);
  const balance = usedPieces && addDecimalValues([usedPieces, headTrim, tailTrim, loss, remainder]);
  if (!balance || compareDecimalValues(balance, stockLength) !== 0) return undefined;
  const perStock = addDecimalValues([
    compareDecimalValues(remainder, '0') === 1 ? pieceCount : subtractOne(pieceCount) ?? '',
    compareDecimalValues(headTrim, '0') === 1 ? '1' : '0',
    compareDecimalValues(tailTrim, '0') === 1 ? '1' : '0',
    multiplySteelDecimals([
      pieceCount,
      addDecimalValues([
        compareDecimalValues(pieceHeadTrim, '0') === 1 ? '1' : '0',
        compareDecimalValues(pieceTailTrim, '0') === 1 ? '1' : '0',
      ]) ?? '',
    ]) ?? '',
  ]);
  return perStock ? multiplySteelDecimals([perStock, stockCount]) : undefined;
}

function cuttingMeasurementTotal(
  measurement: Extract<SteelProcessingMeasurement, { mode: 'cutting' }>,
  parentHeaders: readonly string[],
  parentValues: readonly string[],
): string | undefined {
  if (measurement.ruleVersion !== undefined && measurement.ruleVersion !== steelProcessingMeasurementRuleVersion) {
    return undefined;
  }
  if (!measurement.confirmed) return undefined;
  const parentCategory = valueAt(parentHeaders, parentValues, '類別').trim();
  if (!cuttingCategories.has(parentCategory)) return undefined;
  const parentQuantity = quantityValue(parentHeaders, parentValues);
  const parentLength = dimensionAt(parentHeaders, parentValues, '長度');
  if (parentQuantity === undefined || parentLength === undefined || !isIntegerDecimal(parentQuantity)) return undefined;
  if (measurement.groups.length === 0) {
    return compareDecimalValues(parentQuantity, '0') === 0 ? '0' : undefined;
  }
  let total = '0';
  let pieces = '0';
  for (const group of measurement.groups) {
    const pieceLength = normalizeSteelDecimal(group.pieceLengthMm);
    const pieceCount = normalizeSteelDecimal(group.pieceCount);
    if (pieceLength === undefined || pieceCount === undefined || compareDecimalValues(pieceLength, parentLength) !== 0) {
      return undefined;
    }
    const stockCount = normalizeSteelDecimal(group.stockCount);
    const nextCount = stockCount
      ? addDecimalValues([pieces, multiplySteelDecimals([pieceCount, stockCount]) ?? ''])
      : undefined;
    const groupCount = exactCuttingGroupCount(group);
    if (!nextCount || !groupCount) return undefined;
    pieces = nextCount;
    total = addDecimalValues([total, groupCount]) ?? '';
    if (!total) return undefined;
  }
  return compareDecimalValues(pieces, parentQuantity) === 0 ? total : undefined;
}

export function calculateSteelProcessingMeasurement({
  headers,
  values,
  measurement,
  parentHeaders,
  parentValues,
}: {
  headers: readonly string[];
  values: readonly string[];
  measurement: SteelProcessingMeasurement;
  parentHeaders: readonly string[];
  parentValues: readonly string[];
}): string | undefined {
  if (measurement.ruleVersion !== undefined && measurement.ruleVersion !== steelProcessingMeasurementRuleVersion) {
    return undefined;
  }
  const unit = valueAt(headers, values, '單位');
  if (unit.trim().length === 0 || measurement.unit.trim().length === 0 || unit !== measurement.unit) return undefined;
  if (measurement.mode === 'cutting') {
    return cuttingMeasurementTotal(measurement, parentHeaders, parentValues);
  }
  if (measurement.amount === null) return undefined;
  const amount = normalizeSteelDecimal(measurement.amount);
  if (amount === undefined) return undefined;
  if (measurement.mode === 'batch') return amount;
  const quantity = quantityValue(parentHeaders, parentValues);
  return quantity === undefined ? undefined : multiplySteelDecimals([amount, quantity]);
}

function provenanceFor(
  candidate: SteelCalculationCandidateEvidence,
  dependencies: Record<string, string>,
): SteelCalculationFieldProvenance {
  return {
    kind: 'derived',
    candidateCode: candidate.erpItemCode,
    ruleVersion: candidate.ruleVersion,
    dependencies,
  };
}

export function calculateSteelSystemOrderRow(input: SteelCalculationRowInput): SteelCalculationRowResult {
  const values = [...input.values];
  const calculatedHeaders: string[] = [];
  const changedHeaders = new Set(input.changedHeaders ?? []);
  changedHeaders.forEach((header) => {
    const index = input.headers.indexOf(header);
    if (index < 0) return;
    const raw = values[index] ?? '';
    if (header === '厚度' || header === '寬度' || header === '長度' || header === '肚') {
      const normalized = convertSteelDimensionToMillimetres(raw);
      if (normalized !== undefined) values[index] = normalized;
    } else if (['數量', '單重', '總數', '單價'].includes(header)) {
      const normalized = normalizeSteelDecimal(raw);
      if (normalized !== undefined || raw.trim() === '') values[index] = normalized ?? '';
    }
  });
  const candidate = input.candidate;
  const changed = new Set(input.changedHeaders ?? []);
  if (valueAt(input.headers, values, '單位').toLowerCase() !== 'kg') {
    return {
      values,
      ...(input.provenance ? { provenance: { ...input.provenance } } : {}),
      calculated: false,
      calculatedHeaders,
    };
  }
  if (input.systemKind !== undefined && input.systemKind !== 'material') {
    return {
      values,
      ...(input.provenance ? { provenance: { ...input.provenance } } : {}),
      calculated: false,
      calculatedHeaders,
    };
  }
  const nextProvenance = { ...(input.provenance ?? {}) };
  const currentWeight = normalizeSteelDecimal(valueAt(input.headers, values, '單重'));
  const quantity = normalizeSteelDecimal(valueAt(input.headers, values, '數量'));
  if ((changed.has('單重') || changed.has('數量')) && !changed.has('總數') && currentWeight && quantity) {
    const total = multiplySteelDecimals([currentWeight, quantity]);
    if (total !== undefined) {
      setValue(input.headers, values, '總數', total);
      nextProvenance['總數'] = {
        kind: 'derived',
        dependencies: { 單重: currentWeight, 數量: quantity },
      };
      calculatedHeaders.push('總數');
    }
  }
  if (!candidate || valueAt(input.headers, values, '型號') !== candidate.erpItemCode ||
    valueAt(input.headers, values, '類別') !== candidate.category) {
    return {
      values,
      ...(Object.keys(nextProvenance).length > 0 ? { provenance: nextProvenance } : {}),
      calculated: false,
      calculatedHeaders,
    };
  }
  const category = candidate.category;
  let dimensionChanged = false;
  if (category === '鐵板') {
    dimensionChanged = ['厚度', '寬度', '長度'].some((header) => changed.has(header));
  } else if (category === '方鐵') {
    dimensionChanged = ['寬度', '長度'].some((header) => changed.has(header));
  } else if (profileCategories.has(category)) {
    dimensionChanged = changed.has('長度');
  }
  if (!dimensionChanged) {
    return {
      values,
      ...(Object.keys(nextProvenance).length > 0 ? { provenance: nextProvenance } : {}),
      calculated: false,
      calculatedHeaders,
    };
  }
  const length = dimensionAt(input.headers, values, '長度');
  let weight: string | undefined;
  if (category === '鐵板') {
    const thickness = dimensionAt(input.headers, values, '厚度');
    const width = dimensionAt(input.headers, values, '寬度');
    const density = candidate.exactPhysical.density;
    const product = thickness && width && length && density
      ? multiplySteelDecimals([thickness, width, length, density]) : undefined;
    if (product) weight = divideSteelDecimalsExactly(product, '1000000');
  } else if (category === '方鐵') {
    const width = dimensionAt(input.headers, values, '寬度');
    const density = candidate.exactPhysical.density;
    const product = width && length && density
      ? multiplySteelDecimals([width, width, length, density]) : undefined;
    if (product) weight = divideSteelDecimalsExactly(product, '1000000');
  } else if (profileCategories.has(category) && !/(?:C2|2C|結筒)/i.test(`${valueAt(input.headers, values, '品名規格')} ${valueAt(input.headers, values, '備註')}`)) {
    const unitWeight = candidate.exactPhysical.unitWeightValue;
    if (unitWeight && length && candidate.unitWeightBasis === 'kg_per_piece_or_stock_length' && candidate.exactPhysical.lengthMm) {
      weight = divideSteelDecimalsExactly(multiplySteelDecimals([unitWeight, length]) ?? '', candidate.exactPhysical.lengthMm);
    } else if (unitWeight && length && ['m', 'kg_per_m', 'kg/m'].includes(candidate.unitWeightBasis?.toLowerCase() ?? '')) {
      weight = multiplySteelDecimals([unitWeight, length, '0.001']);
    }
  }
  if (!weight) {
    return {
      values,
      ...(Object.keys(nextProvenance).length > 0 ? { provenance: nextProvenance } : {}),
      calculated: false,
      calculatedHeaders,
    };
  }
  setValue(input.headers, values, '單重', weight);
  calculatedHeaders.push('單重');
  nextProvenance['單重'] = provenanceFor(candidate, {
    ...(category === '鐵板' ? { 厚度: dimensionAt(input.headers, values, '厚度') ?? '' } : {}),
    ...(category === '鐵板' || category === '方鐵' ? { 寬度: dimensionAt(input.headers, values, '寬度') ?? '' } : {}),
    長度: length ?? '',
  });
  if (quantity !== undefined && !changed.has('總數')) {
    const total = multiplySteelDecimals([weight, quantity]);
    if (total !== undefined) {
      setValue(input.headers, values, '總數', total);
      calculatedHeaders.push('總數');
      nextProvenance['總數'] = provenanceFor(candidate, { 單重: weight, 數量: quantity });
    }
  }
  return { values, provenance: nextProvenance, calculated: true, calculatedHeaders };
}
