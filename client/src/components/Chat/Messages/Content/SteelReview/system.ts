import {
  bindSteelReviewSystemRows,
  orderSteelReviewSystemRows,
  calculateSteelProcessingRow,
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
    if (row.system?.kind !== 'processing' || row.deleted || row.values['總數'] === undefined) return row;
    const changes = context.processingChanges?.(row.rowId) ?? [];
    if (changes.length === 0 && (context.hasManualTotal(row.rowId) ||
      context.hasClearedMeasurement?.(row.rowId) ||
      context.preservesCandidateTotal(row.rowId, row.system.parentRowId))) return row;
    const linkedParent = row.system.parentRowId ? byId.get(row.system.parentRowId) : undefined;
    const parent = linkedParent?.system?.kind === 'material' && !linkedParent.deleted ? linkedParent : undefined;
    let measurement = row.calculation?.measurement;
    if (changes.length === 0 && measurement?.mode !== 'batch' && !parent) return row;
    const rowHeaders = Object.keys(row.values);
    const parentHeaders = parent ? Object.keys(parent.values) : [];
    const saved = context.getSavedRow?.(row.rowId) ?? row;
    const savedParent = parent ? context.getSavedRow?.(parent.rowId) ?? parent : undefined;
    let values = rowHeaders.map((header) => row.values[header]?.effective ?? '');
    if (changes.length > 0) {
      for (const header of ['數量', '總數']) {
        const index = rowHeaders.indexOf(header);
        if (index >= 0) values[index] = saved.values[header]?.effective ?? '';
      }
    }
    const intents = changes.length > 0 ? changes : [undefined];
    let calculated = false;
    if (changes.length > 0 && savedParent &&
      parent?.values['數量']?.effective !== savedParent.values['數量']?.effective) {
      const prior = calculateSteelProcessingRow({
        headers: rowHeaders,
        values,
        measurement,
        parentHeaders,
        parentValues: parentHeaders.map((header) => parent?.values[header]?.effective ?? ''),
        referenceValues: rowHeaders.map((header) => saved.values[header]?.effective ?? ''),
        referenceParentValues: parentHeaders.map((header) => savedParent.values[header]?.effective ?? ''),
      });
      values = prior.values;
      if (prior.measurement !== undefined) measurement = prior.measurement ?? undefined;
      calculated = prior.calculatedHeaders.length > 0;
    }
    let measurementChanged = false;
    for (const change of intents) {
      if (change && change.header !== '數量' && change.header !== '總數') continue;
      const changedHeader = change?.header === '數量' || change?.header === '總數' ? change.header : undefined;
      if (change) {
        const index = rowHeaders.indexOf(change.header);
        if (index >= 0) values[index] = change.value ?? '';
      }
      const result = calculateSteelProcessingRow({
        headers: rowHeaders,
        values,
        measurement,
        changedHeader,
        parentHeaders,
        parentValues: parentHeaders.map((header) => parent?.values[header]?.effective ?? ''),
        referenceValues: rowHeaders.map((header) => saved.values[header]?.effective ?? ''),
        referenceParentValues: parentHeaders.map((header) => savedParent?.values[header]?.effective ?? ''),
      });
      values = result.values;
      if (result.measurement !== undefined) {
        measurement = result.measurement ?? undefined;
        if (change) measurementChanged = true;
      }
      calculated ||= result.calculatedHeaders.length > 0;
    }
    if (!calculated && changes.length === 0 && context.hasSelectedCandidate(row.rowId)) {
      const index = rowHeaders.indexOf('總數');
      if (index >= 0) values[index] = '';
    }
    const calculation = { ...row.calculation };
    if (measurementChanged) {
      if (measurement) calculation.measurement = measurement;
      else delete calculation.measurement;
    }
    return { ...row,
      ...(measurementChanged ? { calculation: Object.keys(calculation).length > 0 ? calculation : undefined } : {}),
      values: Object.fromEntries(rowHeaders.map((header, index) => [
      header, { ...row.values[header], effective: values[index] },
    ])) };
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
