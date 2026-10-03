import type { SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
import type { SteelReviewSelection } from './state';

export interface SteelReviewDraftState {
  ownerKey: string;
  cells: Record<string, string>;
}

export function getSteelReviewDraftKey(
  selection: SteelReviewSelection,
  table: Pick<SteelReviewTable, 'outputId' | 'revision'>,
): string {
  return [
    selection.conversationId,
    selection.messageId,
    selection.kind,
    selection.tableId,
    table.outputId,
    table.revision,
  ].join(':');
}

export function getSteelReviewDraftCellKey(rowId: string, header: string): string {
  return `${rowId}\u0000${header}`;
}

export function createSteelReviewDraftState(ownerKey: string): SteelReviewDraftState {
  return { ownerKey, cells: {} };
}

export function setSteelReviewDraftCell(
  draft: SteelReviewDraftState,
  row: SteelReviewRow,
  header: string,
  value: string,
): SteelReviewDraftState {
  if (!row.rowId) {
    return draft;
  }

  const cell = row.values[header];
  if (!cell) {
    return draft;
  }

  const cells = { ...draft.cells };
  const key = getSteelReviewDraftCellKey(row.rowId, header);
  const effective = cell.effective ?? '';
  if (value === effective) {
    delete cells[key];
  } else {
    cells[key] = value;
  }

  return { ...draft, cells };
}

export function getSteelReviewDraftCell(
  draft: SteelReviewDraftState,
  rowId: string,
  header: string,
): string | undefined {
  return draft.cells[getSteelReviewDraftCellKey(rowId, header)];
}

export function getSteelReviewDirtyRowIds(
  table: Pick<SteelReviewTable, 'rows'>,
  draft: SteelReviewDraftState,
): string[] {
  const trustedRowIds = new Set(table.rows.map((row) => row.rowId).filter(Boolean));
  const rowIds = new Set<string>();
  for (const key of Object.keys(draft.cells)) {
    const separatorIndex = key.indexOf('\u0000');
    if (separatorIndex < 1) {
      continue;
    }
    const rowId = key.slice(0, separatorIndex);
    if (trustedRowIds.has(rowId)) {
      rowIds.add(rowId);
    }
  }
  return table.rows.map((row) => row.rowId).filter((rowId) => rowIds.has(rowId));
}

export function applySteelReviewDrafts(
  rows: readonly SteelReviewRow[],
  draft: SteelReviewDraftState,
): SteelReviewRow[] {
  return rows.map((row) => {
    if (!row.rowId) {
      return row;
    }

    const values = Object.fromEntries(
      Object.entries(row.values).map(([header, cell]) => {
        const value = getSteelReviewDraftCell(draft, row.rowId, header);
        return [header, value === undefined ? cell : { ...cell, effective: value }];
      }),
    );
    return { ...row, values };
  });
}
