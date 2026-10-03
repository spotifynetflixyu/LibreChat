import type {
  SteelReviewPrepare,
  SteelReviewRow,
  SteelReviewTable,
} from 'librechat-data-provider';
import type { SteelReviewSelection } from './state';

export interface SteelReviewDraftState {
  ownerKey: string;
  cells: Record<string, string>;
  touched: Record<string, string>;
  cellVersions: Record<string, number>;
  changeSequence: number;
}

export function getSteelReviewDraftKey(
  selection: SteelReviewSelection,
  table: Pick<SteelReviewTable, 'outputId' | 'revision' | 'partIndex'>,
): string {
  return JSON.stringify({
    conversationId: selection.conversationId,
    messageId: selection.messageId,
    kind: selection.kind,
    tableId: selection.tableId,
    partIndex: selection.partIndex ?? table.partIndex ?? null,
    outputId: table.outputId,
    baseRevision: table.revision,
  });
}

export function areSteelReviewDraftOwnersSame(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  try {
    const leftOwner = JSON.parse(left) as Record<string, unknown>;
    const rightOwner = JSON.parse(right) as Record<string, unknown>;
    return [
      'conversationId',
      'messageId',
      'kind',
      'tableId',
      'partIndex',
      'outputId',
    ].every((field) => leftOwner[field] === rightOwner[field]);
  } catch {
    return false;
  }
}

export function getSteelReviewDraftCellKey(rowId: string, header: string): string {
  return `${rowId}\u0000${header}`;
}

export function createSteelReviewDraftState(ownerKey: string): SteelReviewDraftState {
  return {
    ownerKey,
    cells: {},
    touched: {},
    cellVersions: {},
    changeSequence: 0,
  };
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
  const touched = { ...draft.touched, [getSteelReviewDraftCellKey(row.rowId, header)]: value };
  const cellVersions = { ...draft.cellVersions };
  const key = getSteelReviewDraftCellKey(row.rowId, header);
  const effective = cell.effective ?? '';
  const changeSequence = draft.changeSequence + 1;
  cellVersions[key] = changeSequence;
  if (value === effective) {
    delete cells[key];
  } else {
    cells[key] = value;
  }

  return { ...draft, cells, touched, cellVersions, changeSequence };
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

export function getSteelReviewPrepareInput(
  selection: SteelReviewSelection,
  table: SteelReviewTable,
  rows: SteelReviewRow[],
): SteelReviewPrepare {
  const partIndex = table.partIndex ?? selection.partIndex;
  return {
    conversationId: selection.conversationId,
    messageId: selection.messageId,
    kind: selection.kind,
    tableId: selection.tableId,
    ...(partIndex !== undefined ? { partIndex } : {}),
    outputId: table.outputId,
    revision: table.revision,
    rows,
  };
}

export function rebaseSteelReviewDraftState(
  draft: SteelReviewDraftState,
  savedRows: readonly SteelReviewRow[],
  submittedChangeSequence: number,
): SteelReviewDraftState {
  const rowsByCell = new Map<string, string>();
  for (const row of savedRows) {
    for (const [header, cell] of Object.entries(row.values)) {
      rowsByCell.set(getSteelReviewDraftCellKey(row.rowId, header), cell.effective ?? '');
    }
  }

  const cells = { ...draft.cells };
  for (const [key, value] of Object.entries(draft.touched)) {
    if ((draft.cellVersions[key] ?? 0) <= submittedChangeSequence) {
      delete cells[key];
      continue;
    }
    if (value === rowsByCell.get(key)) {
      delete cells[key];
    } else {
      cells[key] = value;
    }
  }

  return { ...draft, cells };
}
