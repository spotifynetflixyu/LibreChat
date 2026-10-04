import { isSteelReviewSourceAssociationHeader } from 'librechat-data-provider';
import type {
  SteelReviewPrepare,
  SteelReviewRow,
  SteelReviewSource,
  SteelReviewSourceIntent,
  SteelReviewTable,
} from 'librechat-data-provider';
import type { SteelReviewSelection } from './state';

export interface SteelReviewDraftState {
  ownerKey: string;
  cells: Record<string, string>;
  touched: Record<string, string>;
  cellVersions: Record<string, number>;
  sourceDrafts: Record<string, SteelReviewSource | null>;
  sourceVersions: Record<string, number>;
  rowStates: Record<string, SteelReviewRow>;
  past: SteelReviewDraftSnapshot[];
  future: SteelReviewDraftSnapshot[];
  historyGroup?: string;
  changeSequence: number;
}

interface SteelReviewDraftSnapshot {
  cells: Record<string, string>;
  touched: Record<string, string>;
  cellVersions: Record<string, number>;
  sourceDrafts: Record<string, SteelReviewSource | null>;
  sourceVersions: Record<string, number>;
  rowStates: Record<string, SteelReviewRow>;
  changeSequence: number;
}

export function getSteelReviewDraftKey(
  selection: SteelReviewSelection,
  table: Pick<SteelReviewTable, 'outputId' | 'revision' | 'partIndex'>,
): string {
  return JSON.stringify({
    ...JSON.parse(getSteelReviewDraftOwnerKey(selection, table)),
    baseRevision: table.revision,
  });
}

export function getSteelReviewDraftOwnerKey(
  selection: SteelReviewSelection,
  table: Pick<SteelReviewTable, 'outputId' | 'partIndex'>,
): string {
  return JSON.stringify({
    conversationId: selection.conversationId,
    messageId: selection.messageId,
    kind: selection.kind,
    tableId: selection.tableId,
    partIndex: selection.partIndex ?? table.partIndex ?? null,
    outputId: table.outputId,
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
    sourceDrafts: {},
    sourceVersions: {},
    rowStates: {},
    past: [],
    future: [],
    changeSequence: 0,
  };
}

function snapshotOf(draft: SteelReviewDraftState): SteelReviewDraftSnapshot {
  return {
    cells: draft.cells,
    touched: draft.touched,
    cellVersions: draft.cellVersions,
    sourceDrafts: draft.sourceDrafts,
    sourceVersions: draft.sourceVersions,
    rowStates: draft.rowStates,
    changeSequence: draft.changeSequence,
  };
}

function recordMutation(
  draft: SteelReviewDraftState,
  next: Omit<SteelReviewDraftState, 'past' | 'future' | 'historyGroup'>,
  group: string,
): SteelReviewDraftState {
  const past = draft.historyGroup === group
    ? [...draft.past.slice(0, -1), snapshotOf(draft)]
    : [...draft.past, snapshotOf(draft)];
  return {
    ...next,
    past,
    future: [],
    historyGroup: group,
  };
}

function restoreSnapshot(
  draft: SteelReviewDraftState,
  snapshot: SteelReviewDraftSnapshot,
  past: SteelReviewDraftSnapshot[],
  future: SteelReviewDraftSnapshot[],
): SteelReviewDraftState {
  return {
    ...draft,
    ...snapshot,
    past,
    future,
    historyGroup: undefined,
    changeSequence: draft.changeSequence + 1,
  };
}

export function setSteelReviewDraftSource(
  draft: SteelReviewDraftState,
  row: SteelReviewRow,
  source: SteelReviewSource | null,
): SteelReviewDraftState {
  if (!row.rowId) {
    return draft;
  }
  const normalizedSource = source && row.source?.fileId === source.fileId && row.source.mediaType === undefined
    ? (({ mediaType: _mediaType, ...legacySource }) => legacySource)(source)
    : source;
  const sourceDrafts = { ...draft.sourceDrafts };
  const sourceVersions = { ...draft.sourceVersions };
  const changeSequence = draft.changeSequence + 1;
  sourceVersions[row.rowId] = changeSequence;
  if (JSON.stringify(normalizedSource) === JSON.stringify(row.source)) {
    delete sourceDrafts[row.rowId];
  } else {
    sourceDrafts[row.rowId] = normalizedSource;
  }
  const historyBase = Object.prototype.hasOwnProperty.call(draft.sourceDrafts, row.rowId)
    ? draft
    : { ...draft, sourceDrafts: { ...draft.sourceDrafts, [row.rowId]: row.source } };
  // A source menu selection is a complete semantic operation. Keep successive
  // file/page choices separate so Undo walks the user's source history one
  // choice at a time; focused cell edits are the only coalesced mutations.
  return recordMutation(historyBase, { ...draft, sourceDrafts, sourceVersions, changeSequence }, `source:${row.rowId}:${changeSequence}`);
}

export function getSteelReviewDraftSource(
  draft: SteelReviewDraftState,
  rowId: string,
): SteelReviewSource | null | undefined {
  return Object.prototype.hasOwnProperty.call(draft.sourceDrafts, rowId)
    ? draft.sourceDrafts[rowId]
    : undefined;
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

  const historyBase = Object.prototype.hasOwnProperty.call(draft.touched, key)
    ? draft
    : {
        ...draft,
        cells: { ...draft.cells, [key]: effective },
        touched: { ...draft.touched, [key]: effective },
      };
  return recordMutation(historyBase, { ...draft, cells, touched, cellVersions, changeSequence }, `cell:${key}`);
}

export function getSteelReviewDraftCell(
  draft: SteelReviewDraftState,
  rowId: string,
  header: string,
): string | undefined {
  return draft.cells[getSteelReviewDraftCellKey(rowId, header)];
}

export function getSteelReviewDirtyRowIds(
  table: { rows: readonly SteelReviewRow[] },
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
  for (const rowId of Object.keys(draft.sourceDrafts)) {
    if (trustedRowIds.has(rowId)) {
      rowIds.add(rowId);
    }
  }
  for (const [rowId, row] of Object.entries(draft.rowStates)) {
    const trusted = table.rows.find((candidate) => candidate.rowId === rowId);
    if (!trusted) {
      if (!row.deleted) {
        rowIds.add(rowId);
      }
      continue;
    }
    if (JSON.stringify({ ...trusted, origin: trusted.origin ?? 'ai', deleted: trusted.deleted ?? false }) !==
      JSON.stringify({ ...row, origin: row.origin ?? 'ai', deleted: row.deleted ?? false })) {
      rowIds.add(rowId);
    }
  }
  return [
    ...table.rows.map((row) => row.rowId).filter((rowId) => rowIds.has(rowId)),
    ...Object.keys(draft.rowStates).filter((rowId) => !trustedRowIds.has(rowId) && rowIds.has(rowId)),
  ];
}

export function applySteelReviewDrafts(
  rows: readonly SteelReviewRow[],
  draft: SteelReviewDraftState,
): SteelReviewRow[] {
  const projectedRows = rows.map((row) => {
    if (!row.rowId) {
      return row;
    }

    const projectedRow = draft.rowStates[row.rowId] ?? row;

    const values = Object.fromEntries(
      Object.entries(projectedRow.values).map(([header, cell]) => {
        const value = getSteelReviewDraftCell(draft, projectedRow.rowId, header);
        return [header, value === undefined ? cell : { ...cell, effective: value }];
      }),
    );
    const source = getSteelReviewDraftSource(draft, projectedRow.rowId);
    if (source === undefined) {
      return { ...projectedRow, values };
    }
    const sourceColumn = Object.keys(values).find((header) => {
      const normalized = header.trim().toLowerCase().replace(/[\s_]+/gu, '');
      return normalized === 'source' || normalized === '來源' ||
        isSteelReviewSourceAssociationHeader(header) &&
        [
          'file', 'filename', 'sourcefile', 'sourcefilename', 'originalfile',
          'originalfilename', '原始檔案', '原始檔名', '來源檔案', '來源檔名',
        ]
          .includes(normalized);
    });
    const pageColumn = Object.keys(values).find((header) => {
      const normalized = header.trim().toLowerCase().replace(/[\s_]+/gu, '');
      return [
        'page', 'pagenumber', 'sourcepage', 'originalpage', 'originalpagenumber',
        '頁碼', '原檔頁碼', '原始頁碼', '來源頁碼',
      ]
        .includes(normalized);
    });
    const projectedValues = { ...values };
    if (sourceColumn) {
      const sameFile = source !== null && source.fileId === projectedRow.source?.fileId;
      projectedValues[sourceColumn] = {
        ...projectedValues[sourceColumn],
        effective: source === null || !sameFile ? '' : projectedValues[sourceColumn]?.effective ?? '',
      };
    }
    if (pageColumn) {
      projectedValues[pageColumn] = {
        ...projectedValues[pageColumn],
        effective: source?.pageNumber == null ? '' : String(source.pageNumber),
      };
    }
    return { ...projectedRow, values: projectedValues, source };
  });
  const existing = new Set(rows.map((row) => row.rowId));
  return [
    ...projectedRows,
    ...Object.values(draft.rowStates).filter((row) => !existing.has(row.rowId) && !row.deleted),
  ];
}

export function addSteelReviewDraftRow(
  draft: SteelReviewDraftState,
  table: Pick<SteelReviewTable, 'headers' | 'rows'>,
  anchor: SteelReviewRow | undefined,
  source: SteelReviewSource | null,
): SteelReviewDraftState {
  const rowId = globalThis.crypto?.randomUUID?.() ??
    `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const values = Object.fromEntries(table.headers.map((header) => [header, { baseline: null, effective: '' }]));
  const inheritedAnchor = anchor?.origin === 'manual' ? anchor.insertion : undefined;
  const anchorKind = inheritedAnchor?.kind ?? (anchor?.rowId ? 'after' : 'end');
  const anchorRowId = inheritedAnchor?.kind === 'after'
    ? inheritedAnchor.rowId
    : anchor?.rowId;
  const anchorKey = anchorKind === 'after' ? `after:${anchorRowId}` : anchorKind;
  const ordinal = Object.values(draft.rowStates)
    .filter((row) => {
      const insertion = row.insertion;
      if (!insertion) return false;
      const key = insertion.kind === 'after' ? `after:${insertion.rowId}` : insertion.kind;
      return key === anchorKey;
    })
    .reduce((max, row) => Math.max(max, row.insertion?.ordinal ?? -1), -1) + 1;
  const insertion = anchorKind === 'after'
    ? { kind: 'after' as const, rowId: anchorRowId!, ordinal }
    : { kind: anchorKind as 'start' | 'end', ordinal };
  const row: SteelReviewRow = { rowId, origin: 'manual', deleted: false, insertion, values, source };
  return recordMutation(draft, {
    ...draft,
    rowStates: { ...draft.rowStates, [rowId]: row },
    changeSequence: draft.changeSequence + 1,
  }, `add:${rowId}`);
}

export function deleteSteelReviewDraftRow(
  draft: SteelReviewDraftState,
  row: SteelReviewRow,
  isSaved: boolean,
): SteelReviewDraftState {
  if (!row.rowId) return draft;
  const rowStates = { ...draft.rowStates };
  if (!isSaved && (row.origin ?? 'ai') === 'manual') {
    delete rowStates[row.rowId];
  } else {
    rowStates[row.rowId] = { ...row, deleted: true };
  }
  return recordMutation(draft, { ...draft, rowStates, changeSequence: draft.changeSequence + 1 }, `delete:${row.rowId}`);
}

export function restoreSteelReviewDraftRow(
  draft: SteelReviewDraftState,
  row: SteelReviewRow,
): SteelReviewDraftState {
  if (!row.rowId) return draft;
  return recordMutation(draft, {
    ...draft,
    rowStates: { ...draft.rowStates, [row.rowId]: { ...row, deleted: false } },
    changeSequence: draft.changeSequence + 1,
  }, `restore:${row.rowId}`);
}

export function canUndoSteelReviewDraft(draft: SteelReviewDraftState): boolean {
  return draft.past.length > 0;
}

export function canRedoSteelReviewDraft(draft: SteelReviewDraftState): boolean {
  return draft.future.length > 0;
}

export function undoSteelReviewDraft(draft: SteelReviewDraftState): SteelReviewDraftState {
  const previous = draft.past[draft.past.length - 1];
  if (!previous) return draft;
  return restoreSnapshot(draft, previous, draft.past.slice(0, -1), [snapshotOf(draft), ...draft.future]);
}

export function redoSteelReviewDraft(draft: SteelReviewDraftState): SteelReviewDraftState {
  const next = draft.future[0];
  if (!next) return draft;
  return restoreSnapshot(draft, next, [...draft.past, snapshotOf(draft)], draft.future.slice(1));
}

export function getSteelReviewPrepareInput(
  selection: SteelReviewSelection,
  table: SteelReviewTable,
  draft: SteelReviewDraftState,
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
    ...(Object.entries(draftSourceIntents(draft, rows)).length > 0
      ? { sourceIntents: draftSourceIntents(draft, rows) }
      : {}),
  };
}

function draftSourceIntents(
  draft: SteelReviewDraftState,
  rows: readonly SteelReviewRow[],
): SteelReviewSourceIntent[] {
  const byId = new Map(rows.map((row) => [row.rowId, row]));
  const sourceDrafts = { ...draft.sourceDrafts };
  for (const row of rows) {
    if (row.origin === 'manual' && row.source !== null && !Object.prototype.hasOwnProperty.call(sourceDrafts, row.rowId)) {
      sourceDrafts[row.rowId] = row.source;
    }
  }
  return Object.entries(sourceDrafts)
    .filter(([rowId]) => byId.has(rowId))
    .map(([rowId, source]) => ({
      rowId,
      fileId: source?.fileId ?? null,
      pageNumber: source?.pageNumber ?? null,
    }));
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

  const sourceDrafts = { ...draft.sourceDrafts };
  for (const [rowId, source] of Object.entries(sourceDrafts)) {
    if ((draft.sourceVersions[rowId] ?? 0) <= submittedChangeSequence) {
      delete sourceDrafts[rowId];
      continue;
    }
    const savedSource = savedRows.find((row) => row.rowId === rowId)?.source ?? null;
    if (JSON.stringify(source) === JSON.stringify(savedSource)) {
      delete sourceDrafts[rowId];
    }
  }

  const rowStates = { ...draft.rowStates };
  for (const [rowId, row] of Object.entries(rowStates)) {
    const saved = savedRows.find((candidate) => candidate.rowId === rowId);
    if (saved && JSON.stringify({ ...saved, origin: saved.origin ?? 'ai', deleted: saved.deleted ?? false }) ===
      JSON.stringify({ ...row, origin: row.origin ?? 'ai', deleted: row.deleted ?? false })) {
      delete rowStates[rowId];
    }
  }

  const rebaseSnapshot = (snapshot: SteelReviewDraftSnapshot): SteelReviewDraftSnapshot => {
    const snapshotCells: Record<string, string> = {};
    for (const [key, value] of Object.entries(snapshot.touched)) {
      if (value !== rowsByCell.get(key)) {
        snapshotCells[key] = value;
      }
    }
    const snapshotRows = { ...snapshot.rowStates };
    for (const saved of savedRows) {
      if (Object.prototype.hasOwnProperty.call(snapshotRows, saved.rowId)) {
        continue;
      }
      const origin = saved.origin ?? 'ai';
      if (origin === 'manual' && !saved.deleted) {
        snapshotRows[saved.rowId] = { ...saved, deleted: true };
      } else if (origin === 'ai' && saved.deleted) {
        snapshotRows[saved.rowId] = { ...saved, deleted: false };
      }
    }
    return { ...snapshot, cells: snapshotCells, rowStates: snapshotRows };
  };

  return {
    ...draft,
    cells,
    sourceDrafts,
    rowStates,
    past: draft.past.map(rebaseSnapshot),
    future: draft.future.map(rebaseSnapshot),
    historyGroup: undefined,
  };
}
