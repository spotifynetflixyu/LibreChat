import {
  bindSteelReviewSystemRows,
  orderSteelReviewSystemRows,
  calculateSteelProcessingMeasurement,
  isSteelReviewSourceAssociationHeader,
} from 'librechat-data-provider';
import type { SteelReviewRow } from 'librechat-data-provider';
import type { SteelReviewMode, SteelReviewProjection } from './types';

function projectSystemRows(rows: SteelReviewRow[], context: SteelReviewProjection): SteelReviewRow[] {
  const headers = Object.keys(rows[0]?.values ?? {});
  const boundRows = bindSteelReviewSystemRows(headers, rows);
  const orderedRows = headers.includes('備註') ? orderSteelReviewSystemRows(boundRows) : boundRows;
  if (!context.previewCalculations) return orderedRows;
  const byId = new Map(orderedRows.map((row) => [row.rowId, row]));
  return orderedRows.map((row) => {
    if (row.system?.kind !== 'processing' || row.deleted || row.values['總數'] === undefined ||
      context.hasManualTotal(row.rowId) || context.preservesCandidateTotal(row.rowId, row.system.parentRowId)) return row;
    const parent = row.system.parentRowId ? byId.get(row.system.parentRowId) : undefined;
    const measurement = row.calculation?.measurement;
    if (measurement?.mode !== 'batch' && (!parent || parent.deleted || parent.system?.kind !== 'material')) return row;
    const rowHeaders = Object.keys(row.values);
    const total = measurement ? calculateSteelProcessingMeasurement({
      headers: rowHeaders,
      values: rowHeaders.map((header) => row.values[header]?.effective ?? ''),
      measurement,
      parentHeaders: parent ? Object.keys(parent.values) : [],
      parentValues: parent ? Object.keys(parent.values).map((header) => parent.values[header]?.effective ?? '') : [],
    }) : undefined;
    if (total === undefined && !context.hasSelectedCandidate(row.rowId)) return row;
    return { ...row, values: { ...row.values, 總數: { ...row.values['總數'], effective: total ?? '' } } };
  });
}

export const systemReviewMode: SteelReviewMode = {
  isEditableHeader: (header) => !isSteelReviewSourceAssociationHeader(header),
  defersHeader: (header) => header === '備註',
  usesCatalog: (row, header): header is '型號' | '品名規格' => (row.system?.kind === 'material' || row.system?.kind === 'processing') &&
    (header === '型號' || header === '品名規格'),
  usesCategoryMenu: (header) => header === '類別',
  projectRows: projectSystemRows,
};
