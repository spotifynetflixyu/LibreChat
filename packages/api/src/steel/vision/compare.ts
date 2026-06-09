import { steelDrawingEvidenceResultSchema } from './schema';

import type { SteelDrawingEvidenceResult, SteelDrawingEvidenceRow } from './schema';

type ComparableField =
  | 'name'
  | 'partNo'
  | 'spec'
  | 'quantity'
  | 'boltSize'
  | 'boltTotalExpression'
  | 'boltTotal';

export interface SteelDrawingEvidenceMismatch {
  partNo: string;
  field: ComparableField | 'row';
  expected?: string | number;
  actual?: string | number;
}

export interface SteelDrawingEvidenceComparison {
  fieldAccuracy: number;
  comparedFields: number;
  matchedFields: number;
  mismatches: SteelDrawingEvidenceMismatch[];
}

const comparableFields = [
  'name',
  'partNo',
  'spec',
  'quantity',
  'boltSize',
  'boltTotalExpression',
  'boltTotal',
] as const satisfies readonly ComparableField[];

function normalizeText(value: string) {
  return value
    .trim()
    .replace(/[xX＊*]/g, '×')
    .replace(/\s+/g, '');
}

function normalizeField(field: ComparableField, value: string | number) {
  if (typeof value === 'number') {
    return value;
  }

  if (field === 'spec' || field === 'boltTotalExpression') {
    return normalizeText(value);
  }

  return value.trim();
}

function getField(row: SteelDrawingEvidenceRow, field: ComparableField) {
  return row[field];
}

function indexRows(rows: readonly SteelDrawingEvidenceRow[]) {
  return new Map(rows.map((row) => [row.partNo, row]));
}

export function compareDrawingEvidenceRows({
  expected,
  actual,
}: {
  expected: SteelDrawingEvidenceResult | unknown;
  actual: SteelDrawingEvidenceResult | unknown;
}): SteelDrawingEvidenceComparison {
  const expectedRows = steelDrawingEvidenceResultSchema.parse(expected).rows;
  const actualRows = indexRows(steelDrawingEvidenceResultSchema.parse(actual).rows);
  const mismatches: SteelDrawingEvidenceMismatch[] = [];
  let comparedFields = 0;
  let matchedFields = 0;

  for (const expectedRow of expectedRows) {
    const actualRow = actualRows.get(expectedRow.partNo);

    if (!actualRow) {
      mismatches.push({ partNo: expectedRow.partNo, field: 'row', expected: expectedRow.partNo });
      comparedFields += comparableFields.length;
      continue;
    }

    for (const field of comparableFields) {
      comparedFields += 1;
      const expectedValue = getField(expectedRow, field);
      const actualValue = getField(actualRow, field);

      if (normalizeField(field, expectedValue) === normalizeField(field, actualValue)) {
        matchedFields += 1;
        continue;
      }

      mismatches.push({
        partNo: expectedRow.partNo,
        field,
        expected: expectedValue,
        actual: actualValue,
      });
    }
  }

  return {
    fieldAccuracy: comparedFields === 0 ? 1 : matchedFields / comparedFields,
    comparedFields,
    matchedFields,
    mismatches,
  };
}
