import type {
  SteelReviewOcrContext,
  SteelReviewOcrLink,
  SteelReviewRow,
  SteelReviewTable,
} from 'librechat-data-provider';

export interface SteelReviewReferenceResult {
  mode: 'linked' | 'context' | 'none';
  rows: SteelReviewRow[];
}

function getOcrLink(row: SteelReviewRow): SteelReviewOcrLink | null {
  return row.ocrLink ?? null;
}

function hasMatchingSource(row: SteelReviewRow, fileId: string, pageNumber: number): boolean {
  return row.source?.fileId === fileId && row.source.pageNumber === pageNumber;
}

function getRemark(row: SteelReviewRow): string | undefined {
  const header = Object.keys(row.values).find(
    (candidate) =>
      candidate === '備註' ||
      candidate.trim().toLowerCase() === 'remark' ||
      candidate.trim().toLowerCase() === 'remarks',
  );
  return header ? (row.values[header]?.effective ?? '') : undefined;
}

function sameSource(left: SteelReviewRow['source'], right: SteelReviewRow['source']): boolean {
  return left?.fileId === right?.fileId && left?.pageNumber === right?.pageNumber;
}

function isCurrentOcrLink(row: SteelReviewRow, baseRow: SteelReviewRow | undefined): boolean {
  if (!baseRow) {
    return true;
  }
  if (!sameSource(row.source, baseRow.source)) {
    return false;
  }
  const baseRemark = getRemark(baseRow);
  return baseRemark === undefined || baseRemark === getRemark(row);
}

export function getSteelReviewOcrContext(
  table: SteelReviewTable | undefined,
): SteelReviewOcrContext | null {
  return table?.ocrContext ?? null;
}

export function createSteelReviewOcrContextTable(
  table: SteelReviewTable,
  context: SteelReviewOcrContext,
): SteelReviewTable {
  return {
    ...table,
    title: context.title,
    kind: 'ocr_result',
    outputId: context.outputId,
    revision: context.revision,
    latestOutputId: context.outputId,
    isLatest: false,
    readOnly: true,
    headers: context.headers,
    rows: context.rows,
  };
}

export function getSteelReviewReferenceRows(
  table: SteelReviewTable,
  displayedSystemRows: readonly SteelReviewRow[],
  fileId: string | undefined,
  pageNumber: number,
  baseRows: readonly SteelReviewRow[] = table.rows,
): SteelReviewReferenceResult {
  const context = getSteelReviewOcrContext(table);
  if (table.kind !== 'system_order' || !context || !fileId || displayedSystemRows.length === 0) {
    return { mode: 'none', rows: [] };
  }

  const baseRowsById = new Map(baseRows.map((row) => [row.rowId, row]));
  const contextRowsById = new Map(context.rows.map((row) => [row.rowId, row]));
  const pageSystemRows = displayedSystemRows.filter(
    (row) => !row.deleted && hasMatchingSource(row, fileId, pageNumber),
  );
  if (pageSystemRows.length === 0) {
    return { mode: 'none', rows: [] };
  }
  const linkedRows: SteelReviewRow[] = [];
  const linkedRowIds = new Set<string>();
  for (const row of pageSystemRows) {
    if (!row.rowId || !isCurrentOcrLink(row, baseRowsById.get(row.rowId))) {
      continue;
    }
    const link = getOcrLink(row);
    if (!link || link.outputId !== context.outputId || link.revision !== context.revision) {
      continue;
    }
    const contextRow = contextRowsById.get(link.rowId);
    if (
      !contextRow ||
      !hasMatchingSource(contextRow, fileId, pageNumber) ||
      linkedRowIds.has(contextRow.rowId)
    ) {
      continue;
    }
    linkedRows.push(contextRow);
    linkedRowIds.add(contextRow.rowId);
  }
  if (linkedRows.length > 0) {
    return { mode: 'linked', rows: linkedRows };
  }

  const contextRows = context.rows.filter((row) => hasMatchingSource(row, fileId, pageNumber));
  return contextRows.length > 0
    ? { mode: 'context', rows: contextRows }
    : { mode: 'none', rows: [] };
}
