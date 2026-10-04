import { isSteelReviewSourceAssociationHeader } from 'librechat-data-provider';
import type {
  SteelReviewPrepared,
  SteelReviewOperation,
  SteelReviewOperationPrepare,
  SteelReviewCommit,
  SteelReviewRow,
  SteelReviewSource,
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
  table: Pick<SteelReviewTable, 'outputId' | 'revision'>,
): string {
  return JSON.stringify({
    ...JSON.parse(getSteelReviewDraftOwnerKey(selection, table)),
    baseRevision: table.revision,
  });
}

export function getSteelReviewDraftOwnerKey(
  selection: SteelReviewSelection,
  table: Pick<SteelReviewTable, 'outputId'>,
): string {
  return JSON.stringify({
    conversationId: selection.conversationId,
    messageId: selection.messageId,
    kind: selection.kind,
    title: selection.title,
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
      'title',
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
  snapshot = snapshotOf(draft),
): SteelReviewDraftState {
  // Preserve the first pre-group snapshot. Replacing it with the previous
  // keystroke makes Undo stop at the penultimate character instead of the
  // value that was present when the focused edit began.
  const past = draft.historyGroup === group ? draft.past : [...draft.past, snapshot];
  return {
    ...next,
    past,
    future: [],
    historyGroup: group,
  };
}

export function finishSteelReviewDraftHistory(draft: SteelReviewDraftState): SteelReviewDraftState {
  if (draft.historyGroup === undefined) {
    return draft;
  }
  return { ...draft, historyGroup: undefined };
}

export function clearSteelReviewDraftHistory(draft: SteelReviewDraftState): SteelReviewDraftState {
  return { ...draft, past: [], future: [], historyGroup: undefined };
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
  const currentEffective = getSteelReviewDraftCell(draft, row.rowId, header) ?? cell.effective ?? '';
  const confirmedEffective = cell.effective ?? '';
  const changeSequence = draft.changeSequence + 1;
  cellVersions[key] = changeSequence;
  if (value === confirmedEffective) {
    delete cells[key];
  } else {
    cells[key] = value;
  }

  const group = `cell:${key}`;
  const isSameCellGroup = draft.historyGroup === group;
  const historyBase = isSameCellGroup
    ? draft
    : {
        ...draft,
        cells: { ...draft.cells, [key]: currentEffective },
        touched: { ...draft.touched, [key]: currentEffective },
      };
  const historySnapshot = isSameCellGroup
    ? undefined
    : snapshotOf({
        ...historyBase,
        sourceDrafts: {
          ...historyBase.sourceDrafts,
          [row.rowId]: row.source,
        },
      });
  return recordMutation(historyBase, { ...draft, cells, touched, cellVersions, changeSequence }, group, historySnapshot);
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
  const normalizeRow = (row: SteelReviewRow) => ({
    rowId: row.rowId,
    origin: row.origin ?? 'ai',
    deleted: row.deleted ?? false,
    insertion: row.insertion ?? null,
    source: row.source ?? null,
    values: Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [header, {
      baseline: cell.baseline ?? null,
      effective: cell.effective ?? '',
    }])),
  });
  const confirmedRows = new Map(table.rows.map((row) => [row.rowId, normalizeRow(row)]));
  const projectedRows = new Map(applySteelReviewDrafts(table.rows, draft)
    .map((row) => [row.rowId, normalizeRow(row)]));
  const dirty = new Set<string>();
  for (const [rowId, confirmed] of confirmedRows) {
    const projected = projectedRows.get(rowId);
    if (!projected || JSON.stringify(projected) !== JSON.stringify(confirmed)) {
      dirty.add(rowId);
    }
  }
  for (const [rowId, projected] of projectedRows) {
    if (!confirmedRows.has(rowId) && !projected.deleted) {
      dirty.add(rowId);
    }
  }
  return [
    ...table.rows.map((row) => row.rowId).filter((rowId) => dirty.has(rowId)),
    ...[...projectedRows.keys()].filter((rowId) => !confirmedRows.has(rowId) && dirty.has(rowId)),
  ];
}

export function applySteelReviewDrafts(
  rows: readonly SteelReviewRow[],
  draft: SteelReviewDraftState,
): SteelReviewRow[] {
  const projectRow = (row: SteelReviewRow): SteelReviewRow => {
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
    const draftSource = getSteelReviewDraftSource(draft, projectedRow.rowId);
    const source = draftSource === undefined && projectedRow.origin === 'manual' && projectedRow.source !== null
      ? projectedRow.source
      : draftSource;
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
  };
  const projectedRows = rows.map(projectRow);
  const existing = new Set(rows.map((row) => row.rowId));
  return [
    ...projectedRows,
    ...Object.values(draft.rowStates)
      .filter((row) => !existing.has(row.rowId) && !row.deleted)
      .map(projectRow),
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
  let anchorKind: 'start' | 'end' | 'after' = 'end';
  let anchorRowId: string | undefined;
  if (inheritedAnchor?.kind === 'after') {
    anchorKind = 'after';
    anchorRowId = inheritedAnchor.rowId;
  } else if (inheritedAnchor?.kind === 'start' || inheritedAnchor?.kind === 'end') {
    anchorKind = inheritedAnchor.kind;
  } else if (anchor?.rowId) {
    anchorKind = 'after';
    anchorRowId = anchor.rowId;
  }
  const anchorKey = anchorKind === 'after' ? `after:${anchorRowId}` : anchorKind;
  const ordinal = [...table.rows, ...Object.values(draft.rowStates)]
    .filter((row) => {
      const insertion = row.insertion;
      if (!insertion) return false;
      const key = insertion.kind === 'after' ? `after:${insertion.rowId}` : insertion.kind;
      return key === anchorKey;
    })
    .reduce((max, row) => Math.max(max, row.insertion?.ordinal ?? -1), -1) + 1;
  const insertion = anchorKind === 'after' && anchorRowId
    ? { kind: 'after' as const, rowId: anchorRowId, ordinal }
    : { kind: anchorKind === 'start' ? 'start' as const : 'end' as const, ordinal };
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
  const historySnapshot = isSaved
    ? snapshotOf({
        ...draft,
        rowStates: { ...draft.rowStates, [row.rowId]: { ...row, deleted: false } },
      })
    : undefined;
  return recordMutation(draft, { ...draft, rowStates, changeSequence: draft.changeSequence + 1 }, `delete:${row.rowId}`, historySnapshot);
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
): SteelReviewOperationPrepare {
  const operations = compileSteelReviewOperations(table, draft, rows);
  return {
    conversationId: selection.conversationId,
    messageId: selection.messageId,
    kind: selection.kind,
    title: selection.title,
    outputId: table.outputId,
    revision: table.revision,
    operations,
  };
}

function isSourceHeader(header: string): boolean {
  return isSteelReviewSourceAssociationHeader(header);
}

type SteelReviewOperationSource = NonNullable<Extract<SteelReviewOperation, { type: 'update' }>['source']>;

function sourceIntent(source: SteelReviewSource | null): SteelReviewOperationSource {
  return source === null
    ? { fileId: null, pageNumber: null }
    : { fileId: source.fileId, pageNumber: source.pageNumber };
}

function sourceChanged(left: SteelReviewSource | null, right: SteelReviewSource | null): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function rowValuesChanged(
  table: Pick<SteelReviewTable, 'headers'>,
  previous: SteelReviewRow,
  next: SteelReviewRow,
  draft: SteelReviewDraftState,
): Array<{ header: string; value: string | null }> {
  const headers = table.headers.filter((header) => !isSourceHeader(header));
  return headers
    .filter((header) => (previous.values[header]?.effective ?? null) !== (next.values[header]?.effective ?? null))
    .sort((left, right) => (draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, left)] ?? 0) -
      (draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, right)] ?? 0))
    .map((header) => ({ header, value: next.values[header]?.effective ?? null }));
}

function resolveInsertionPosition(
  row: SteelReviewRow,
  rowsById: Map<string, SteelReviewRow>,
  trustedIds: Set<string>,
): { kind: 'start' } | { kind: 'end' } | { kind: 'after'; rowId: string } {
  const insertion = row.insertion;
  if (!insertion) {
    return { kind: 'end' };
  }
  if (insertion.kind === 'start') {
    return { kind: 'start' };
  }
  if (insertion.kind === 'end') {
    return { kind: 'end' };
  }
  const anchorId = insertion.rowId;
  if (!anchorId) {
    return { kind: 'end' };
  }
  const anchor = rowsById.get(anchorId);
  if (!anchor || trustedIds.has(anchor.rowId) || anchor.origin !== 'manual' || !anchor.insertion) {
    return { kind: 'after', rowId: anchorId };
  }
  return resolveInsertionPosition(anchor, rowsById, trustedIds);
}

export function compileSteelReviewOperations(
  table: Pick<SteelReviewTable, 'headers' | 'rows'>,
  draft: SteelReviewDraftState,
  projectedRows: readonly SteelReviewRow[],
): SteelReviewOperation[] {
  const originalById = new Map(table.rows.map((row) => [row.rowId, row]));
  const operations: SteelReviewOperation[] = [];
  const orderedRows = [...projectedRows].sort((left, right) => {
    const leftVersion = Math.max(...Object.entries(left.values).map(([header]) => draft.cellVersions[getSteelReviewDraftCellKey(left.rowId, header)] ?? 0), draft.sourceVersions[left.rowId] ?? 0);
    const rightVersion = Math.max(...Object.entries(right.values).map(([header]) => draft.cellVersions[getSteelReviewDraftCellKey(right.rowId, header)] ?? 0), draft.sourceVersions[right.rowId] ?? 0);
    return leftVersion - rightVersion;
  });
  const allRowsById = new Map([...table.rows, ...Object.values(draft.rowStates)].map((row) => [row.rowId, row]));
  const trustedIds = new Set(table.rows.map((row) => row.rowId));
  for (const next of orderedRows) {
    const previous = originalById.get(next.rowId);
    if (!previous) {
      if (next.origin !== 'manual' || next.deleted) continue;
      const changes = table.headers
        .filter((header) => !isSourceHeader(header))
        .map((header) => ({ header, value: next.values[header]?.effective ?? null }));
      const add: Extract<SteelReviewOperation, { type: 'add' }> = {
        type: 'add',
        rowId: next.rowId,
        position: resolveInsertionPosition(next, allRowsById, trustedIds),
        changes,
      };
      if (next.source !== null) add.source = sourceIntent(next.source);
      operations.push(add);
      continue;
    }
    const changes = rowValuesChanged(table, previous, next, draft);
    const sourceWasChanged = sourceChanged(previous.source, next.source) &&
      (draft.sourceVersions[next.rowId] ?? 0) > 0;
    if (!previous.deleted && next.deleted) {
      if (changes.length > 0 || sourceWasChanged) {
        const update: Extract<SteelReviewOperation, { type: 'update' }> = {
          type: 'update', rowId: next.rowId,
          ...(changes.length > 0 ? { changes } : {}),
          ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
        };
        operations.push(update);
      }
      operations.push({ type: 'delete', rowId: next.rowId });
      continue;
    }
    if (previous.deleted && !next.deleted) {
      operations.push({ type: 'restore', rowId: next.rowId });
      if (changes.length > 0 || sourceWasChanged) {
        operations.push({
          type: 'update', rowId: next.rowId,
          ...(changes.length > 0 ? { changes } : {}),
          ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
        });
      }
      continue;
    }
    if (changes.length > 0 || sourceWasChanged) {
      operations.push({
        type: 'update', rowId: next.rowId,
        ...(changes.length > 0 ? { changes } : {}),
        ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
      });
    }
  }
  return operations;
}

export function getSteelReviewCommitInput(prepared: SteelReviewPrepared): SteelReviewCommit {
  if ('operationRequest' in prepared) {
    return {
      ...prepared.operationRequest,
      operationId: prepared.operationId,
      digest: prepared.digest,
    };
  }
  return prepared;
}

export function rebaseSteelReviewDraftState(
  draft: SteelReviewDraftState,
  savedRows: readonly SteelReviewRow[],
  submittedChangeSequence: number,
  options?: { preserveUnchangedRows?: boolean },
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
    if (!saved) {
      continue;
    }
    const rebasedRow = { ...saved, deleted: row.deleted ?? false };
    if (JSON.stringify({ ...saved, origin: saved.origin ?? 'ai', deleted: saved.deleted ?? false }) ===
      JSON.stringify({ ...row, origin: row.origin ?? 'ai', deleted: row.deleted ?? false })) {
      delete rowStates[rowId];
    } else {
      rowStates[rowId] = rebasedRow;
    }
  }

  const rebaseSnapshot = (snapshot: SteelReviewDraftSnapshot): SteelReviewDraftSnapshot => {
    const snapshotCells: Record<string, string> = {};
    for (const [key, value] of Object.entries(snapshot.cells)) {
      if (value !== rowsByCell.get(key)) {
        snapshotCells[key] = value;
      }
    }
    const snapshotRows = { ...snapshot.rowStates };
    for (const saved of savedRows) {
      if (Object.prototype.hasOwnProperty.call(snapshotRows, saved.rowId)) {
        snapshotRows[saved.rowId] = {
          ...saved,
          deleted: snapshotRows[saved.rowId]?.deleted ?? saved.deleted ?? false,
        };
        continue;
      }
      if (!options?.preserveUnchangedRows) {
        const origin = saved.origin ?? 'ai';
        if (origin === 'manual' && !saved.deleted) {
          snapshotRows[saved.rowId] = { ...saved, deleted: true };
        } else if (origin === 'ai' && saved.deleted) {
          snapshotRows[saved.rowId] = { ...saved, deleted: false };
        }
      }
    }
    const snapshotSources = { ...snapshot.sourceDrafts };
    for (const [rowId, source] of Object.entries(snapshotSources)) {
      const savedSource = savedRows.find((row) => row.rowId === rowId)?.source ?? null;
      if (JSON.stringify(source) === JSON.stringify(savedSource)) {
        delete snapshotSources[rowId];
      }
    }
    return { ...snapshot, cells: snapshotCells, sourceDrafts: snapshotSources, rowStates: snapshotRows };
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
