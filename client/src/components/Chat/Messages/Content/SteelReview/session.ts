import { isSteelReviewSourceAssociationHeader } from 'librechat-data-provider';
import type {
  SteelReviewPrepared,
  SteelReviewOperation,
  SteelReviewOperationPrepare,
  SteelReviewCommit,
  SteelReviewRow,
  SteelReviewSource,
  SteelReviewSystemState,
  SteelReviewTable,
} from 'librechat-data-provider';
import type { SteelReviewIdentity } from './state';

export interface SteelReviewDraftState {
  ownerKey: string;
  cells: Record<string, string>;
  touched: Record<string, string>;
  cellVersions: Record<string, number>;
  sourceDrafts: Record<string, SteelReviewSource | null>;
  sourceVersions: Record<string, number>;
  systemVersions: Record<string, number>;
  rowStates: Record<string, SteelReviewRow>;
  past: SteelReviewDraftSnapshot[];
  future: SteelReviewDraftSnapshot[];
  historyGroup?: string;
  changeSequence: number;
}

type SteelReviewDraftLogicalOwner = SteelReviewIdentity & { outputId: string };

interface SteelReviewDraftSnapshot {
  cells: Record<string, string>;
  touched: Record<string, string>;
  cellVersions: Record<string, number>;
  sourceDrafts: Record<string, SteelReviewSource | null>;
  sourceVersions: Record<string, number>;
  systemVersions: Record<string, number>;
  rowStates: Record<string, SteelReviewRow>;
  changeSequence: number;
}

export function getSteelReviewDraftKey(
  selection: SteelReviewIdentity,
  table: Pick<SteelReviewTable, 'outputId' | 'revision'>,
): string {
  return JSON.stringify({
    ...JSON.parse(getSteelReviewDraftOwnerKey(selection, table)),
    baseRevision: table.revision,
  });
}

export function getSteelReviewDraftOwnerKey(
  selection: SteelReviewIdentity,
  table: Pick<SteelReviewTable, 'outputId'>,
  captureId?: string,
): string {
  const owner = {
    conversationId: selection.conversationId,
    messageId: selection.messageId,
    kind: selection.kind,
    title: selection.title,
    outputId: table.outputId,
  };
  return captureId ? `${JSON.stringify(owner)}:${captureId}` : JSON.stringify(owner);
}

export function areSteelReviewDraftOwnersSame(left: string, right: string): boolean {
  const parseOwner = (key: string): SteelReviewDraftLogicalOwner | undefined => {
    const jsonEnd = key.lastIndexOf('}');
    if (jsonEnd < 0) {
      return undefined;
    }
    const suffix = key.slice(jsonEnd + 1);
    if (suffix !== '' && !/^:[^:]+$/u.test(suffix)) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(key.slice(0, jsonEnd + 1));
    } catch {
      return undefined;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const owner = parsed;
    const allowedFields = new Set([
      'conversationId',
      'messageId',
      'kind',
      'title',
      'outputId',
      'baseRevision',
    ]);
    if (Object.keys(owner).some((field) => !allowedFields.has(field))) {
      return undefined;
    }
    const readString = (field: string): string | undefined => {
      const value = Reflect.get(owner, field);
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };
    const conversationId = readString('conversationId');
    const messageId = readString('messageId');
    const kind = readString('kind');
    const title = readString('title');
    const outputId = readString('outputId');
    const baseRevision = Reflect.get(owner, 'baseRevision');
    if (!conversationId || !messageId || (kind !== 'ocr_result' && kind !== 'system_order') ||
      !title || !outputId || (baseRevision !== undefined &&
        (typeof baseRevision !== 'string' || baseRevision.length === 0))) {
      return undefined;
    }
    return { conversationId, messageId, kind, title, outputId };
  };
  const leftOwner = parseOwner(left);
  const rightOwner = parseOwner(right);
  return leftOwner !== undefined && rightOwner !== undefined &&
    leftOwner.conversationId === rightOwner.conversationId &&
    leftOwner.messageId === rightOwner.messageId &&
    leftOwner.kind === rightOwner.kind &&
    leftOwner.title === rightOwner.title &&
    leftOwner.outputId === rightOwner.outputId;
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
    systemVersions: {},
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
    systemVersions: draft.systemVersions,
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

export function setSteelReviewDraftSystem(
  draft: SteelReviewDraftState,
  row: SteelReviewRow,
  system: SteelReviewSystemState,
): SteelReviewDraftState {
  if (!row.rowId) {
    return draft;
  }
  const changeSequence = draft.changeSequence + 1;
  const baseRow = draft.rowStates[row.rowId] ?? row;
  if (JSON.stringify(baseRow.system ?? null) === JSON.stringify(system)) {
    return draft;
  }
  return recordMutation(draft, {
    ...draft,
    rowStates: { ...draft.rowStates, [row.rowId]: { ...baseRow, system } },
    systemVersions: { ...draft.systemVersions, [row.rowId]: changeSequence },
    changeSequence,
  }, `system:${row.rowId}`);
}

export function deleteSteelReviewDraftGroup(
  draft: SteelReviewDraftState,
  rows: readonly SteelReviewRow[],
  material: SteelReviewRow,
): SteelReviewDraftState {
  if (!material.rowId) return draft;
  const group = rows.filter((row) => row.rowId === material.rowId ||
    (row.system?.kind === 'processing' && row.system.parentRowId === material.rowId));
  if (group.length === 0) return draft;
  const rowStates = { ...draft.rowStates };
  const changeSequence = draft.changeSequence + 1;
  for (const row of group) {
    if (!row.rowId) continue;
    if ((row.origin ?? 'ai') === 'manual' && !rows.some((candidate) => candidate.rowId === row.rowId)) {
      delete rowStates[row.rowId];
      continue;
    }
    rowStates[row.rowId] = {
      ...(rowStates[row.rowId] ?? row),
      deleted: true,
      ...(row.system?.kind === 'processing' && !row.deleted
        ? { system: { ...row.system, cascadeDeletedBy: material.rowId } }
        : {}),
    };
  }
  return recordMutation(draft, { ...draft, rowStates, changeSequence }, `delete-group:${material.rowId}`);
}

export function restoreSteelReviewDraftGroup(
  draft: SteelReviewDraftState,
  rows: readonly SteelReviewRow[],
  material: SteelReviewRow,
): SteelReviewDraftState {
  if (!material.rowId) return draft;
  const group = rows.filter((row) => row.rowId === material.rowId ||
    (row.deleted && row.system?.kind === 'processing' && row.system.cascadeDeletedBy === material.rowId));
  if (group.length === 0) return draft;
  const rowStates = { ...draft.rowStates };
  for (const row of group) {
    if (!row.rowId) continue;
    rowStates[row.rowId] = {
      ...(rowStates[row.rowId] ?? row),
      deleted: false,
      ...(row.system?.kind === 'processing'
        ? { system: { ...row.system, cascadeDeletedBy: null } }
        : {}),
    };
  }
  return recordMutation(draft, {
    ...draft,
    rowStates,
    changeSequence: draft.changeSequence + 1,
  }, `restore-group:${material.rowId}`);
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
    system: row.system ?? null,
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
  const projectRow = (row: SteelReviewRow, sourceOverride?: SteelReviewSource | null): SteelReviewRow => {
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
    let source = sourceOverride;
    if (source === undefined) {
      source = draftSource === undefined && projectedRow.origin === 'manual' && projectedRow.source !== null
        ? projectedRow.source
        : draftSource;
    }
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
  const baseRows = [
    ...rows,
    ...Object.values(draft.rowStates).filter((row) => !rows.some((candidate) => candidate.rowId === row.rowId) && !row.deleted),
  ];
  const projectedRows = baseRows.map((row) => projectRow(row));
  const projectedById = new Map(projectedRows.map((row) => [row.rowId, row]));
  const projectedWithSystemSources = projectedRows.map((row) => {
    if (row.system?.kind !== 'processing' || row.deleted) {
      return row;
    }
    const parent = row.system.parentRowId ? projectedById.get(row.system.parentRowId) : undefined;
    if (!parent || parent.deleted) {
      return row;
    }
    const projected = projectRow(row, parent.source);
    const values = { ...projected.values };
    for (const [header, cell] of Object.entries(parent.values)) {
      if (isSteelReviewSourceAssociationHeader(header) && values[header]) {
        values[header] = { ...values[header], effective: cell.effective };
      }
    }
    return { ...projected, values };
  });
  return projectedWithSystemSources;
}

export function addSteelReviewDraftRow(
  draft: SteelReviewDraftState,
  table: Pick<SteelReviewTable, 'headers' | 'rows'>,
  anchor: SteelReviewRow | undefined,
  source: SteelReviewSource | null,
  system?: SteelReviewSystemState,
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
  const row: SteelReviewRow = {
    rowId, origin: 'manual', deleted: false, insertion, values, source,
    ...(system ? { system } : {}),
  };
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
  selection: SteelReviewIdentity,
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

function systemChanged(left: SteelReviewSystemState | undefined, right: SteelReviewSystemState | undefined): boolean {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
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
  const deferredGroupDeletes: SteelReviewOperation[] = [];
  const orderedRows = [...projectedRows].sort((left, right) => {
    const leftVersion = Math.max(...Object.entries(left.values).map(([header]) => draft.cellVersions[getSteelReviewDraftCellKey(left.rowId, header)] ?? 0), draft.sourceVersions[left.rowId] ?? 0, draft.systemVersions[left.rowId] ?? 0);
    const rightVersion = Math.max(...Object.entries(right.values).map(([header]) => draft.cellVersions[getSteelReviewDraftCellKey(right.rowId, header)] ?? 0), draft.sourceVersions[right.rowId] ?? 0, draft.systemVersions[right.rowId] ?? 0);
    return leftVersion - rightVersion;
  });
  const allRowsById = new Map([...table.rows, ...Object.values(draft.rowStates)].map((row) => [row.rowId, row]));
  const trustedIds = new Set(table.rows.map((row) => row.rowId));
  const groupDeleteParentIds = new Set(projectedRows.flatMap((next) => {
    const previous = originalById.get(next.rowId);
    return next.system?.kind === 'material' && previous && !previous.deleted && next.deleted ? [next.rowId] : [];
  }));
  const groupRestoreParentIds = new Set(projectedRows.flatMap((next) => {
    const previous = originalById.get(next.rowId);
    return next.system?.kind === 'material' && previous?.deleted && !next.deleted ? [next.rowId] : [];
  }));
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
      if (next.source !== null && next.system?.kind !== 'processing') add.source = sourceIntent(next.source);
      if (next.system && (next.system.kind === 'material' || next.system.kind === 'processing')) {
        add.system = { kind: next.system.kind, parentRowId: next.system.parentRowId };
      }
      operations.push(add);
      continue;
    }
    const changes = rowValuesChanged(table, previous, next, draft);
    const sourceWasChanged = next.system?.kind !== 'processing' && sourceChanged(previous.source, next.source) &&
      (draft.sourceVersions[next.rowId] ?? 0) > 0;
    const systemWasChanged = systemChanged(previous.system, next.system) &&
      (draft.systemVersions[next.rowId] ?? 0) > 0;
    const binding = next.system?.kind === 'processing' && previous.system?.kind === 'processing' &&
      next.system.parentRowId !== previous.system.parentRowId
      ? { parentRowId: next.system.parentRowId }
      : undefined;
    const classify = previous.system?.kind === 'unassigned' && next.system && next.system.kind !== 'unassigned' && systemWasChanged
      ? { type: 'classify' as const, rowId: next.rowId, system: { kind: next.system.kind, parentRowId: next.system.parentRowId } }
      : undefined;
    const isCascadeChildDelete = next.deleted && next.system?.kind === 'processing' &&
      next.system.cascadeDeletedBy !== null && next.system.cascadeDeletedBy !== undefined &&
      groupDeleteParentIds.has(next.system.cascadeDeletedBy);
    const isCascadeChildRestore = previous.deleted && !next.deleted && previous.system?.kind === 'processing' &&
      previous.system.cascadeDeletedBy !== null && previous.system.cascadeDeletedBy !== undefined &&
      groupRestoreParentIds.has(previous.system.cascadeDeletedBy);
    if (!previous.deleted && next.deleted) {
      if (changes.length > 0 || sourceWasChanged || binding) {
        const update: Extract<SteelReviewOperation, { type: 'update' }> = {
          type: 'update', rowId: next.rowId,
          ...(changes.length > 0 ? { changes } : {}),
          ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
          ...(binding ? { binding } : {}),
        };
        operations.push(update);
      }
      if (classify) operations.push(classify);
      if (!isCascadeChildDelete) {
        const deletion = { type: 'delete' as const, rowId: next.rowId };
        if (groupDeleteParentIds.has(next.rowId)) {
          deferredGroupDeletes.push(deletion);
        } else {
          operations.push(deletion);
        }
      }
      continue;
    }
    if (previous.deleted && !next.deleted) {
      if (!isCascadeChildRestore) {
        operations.push({ type: 'restore', rowId: next.rowId });
      }
      if (changes.length > 0 || sourceWasChanged || binding) {
        operations.push({
          type: 'update', rowId: next.rowId,
          ...(changes.length > 0 ? { changes } : {}),
          ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
          ...(binding ? { binding } : {}),
        });
      }
      if (classify) operations.push(classify);
      continue;
    }
    if (changes.length > 0 || sourceWasChanged || binding) {
      operations.push({
        type: 'update', rowId: next.rowId,
        ...(changes.length > 0 ? { changes } : {}),
        ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
        ...(binding ? { binding } : {}),
      });
    }
    if (classify) operations.push(classify);
  }
  return [...operations, ...deferredGroupDeletes];
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

  const systemVersions = { ...draft.systemVersions };
  for (const [rowId, version] of Object.entries(systemVersions)) {
    if (version <= submittedChangeSequence) {
      delete systemVersions[rowId];
    }
  }

  const rowStates = { ...draft.rowStates };
  for (const [rowId, row] of Object.entries(rowStates)) {
    const saved = savedRows.find((candidate) => candidate.rowId === rowId);
    if (!saved) {
      continue;
    }
    const rebasedRow = { ...saved, deleted: row.deleted ?? false, system: row.system ?? saved.system };
    if (JSON.stringify({ ...saved, origin: saved.origin ?? 'ai', deleted: saved.deleted ?? false, system: saved.system ?? null }) ===
      JSON.stringify({ ...row, origin: row.origin ?? 'ai', deleted: row.deleted ?? false, system: row.system ?? null })) {
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
          system: snapshotRows[saved.rowId]?.system ?? saved.system,
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
    systemVersions,
    rowStates,
    past: draft.past.map(rebaseSnapshot),
    future: draft.future.map(rebaseSnapshot),
    historyGroup: undefined,
  };
}
