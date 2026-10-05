import {
  applyMaterialCandidate,
  steelMaterialCandidateHeaders,
  calculateSteelProcessingMeasurement,
  calculateSteelSystemOrderRow,
  isSteelReviewSourceAssociationHeader,
} from 'librechat-data-provider';
import type {
  SteelReviewPrepared,
  SteelReviewOperation,
  SteelReviewOperationPrepare,
  SteelReviewCommit,
  SteelReviewRow,
  SteelReviewSource,
  SteelReviewSystemState,
  SteelReviewTable,
  SteelProcessingMeasurement,
  SteelCatalogCandidate,
  SteelCatalogCustomerEvidence,
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
  measurementDrafts: Record<string, SteelProcessingMeasurement | null>;
  measurementVersions: Record<string, number>;
  materialSelections: Record<string, {
    id: string;
    revision: string;
    evidence: {
      snapshotId: string;
      revision: string;
      tier: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
    };
  }>;
  materialSelectionVersions: Record<string, number>;
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
  measurementDrafts?: Record<string, SteelProcessingMeasurement | null>;
  measurementVersions?: Record<string, number>;
  materialSelections?: SteelReviewDraftState['materialSelections'];
  materialSelectionVersions?: Record<string, number>;
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
    measurementDrafts: {},
    measurementVersions: {},
    materialSelections: {},
    materialSelectionVersions: {},
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
    measurementDrafts: draft.measurementDrafts,
    measurementVersions: draft.measurementVersions,
    materialSelections: draft.materialSelections,
    materialSelectionVersions: draft.materialSelectionVersions,
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
    measurementDrafts: snapshot.measurementDrafts ?? draft.measurementDrafts,
    measurementVersions: snapshot.measurementVersions ?? draft.measurementVersions,
    materialSelections: snapshot.materialSelections ?? draft.materialSelections,
    materialSelectionVersions: snapshot.materialSelectionVersions ?? draft.materialSelectionVersions,
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

export function setSteelReviewDraftCandidate(
  draft: SteelReviewDraftState,
  table: Pick<SteelReviewTable, 'headers'>,
  row: SteelReviewRow,
  candidate: SteelCatalogCandidate,
  customer: SteelCatalogCustomerEvidence,
): SteelReviewDraftState {
  if (!row.rowId || row.system?.kind !== 'material') return draft;
  const changeSequence = draft.changeSequence + 1;
  const baseRow = draft.rowStates[row.rowId] ?? row;
  const nextRow = applyMaterialCandidate(baseRow, candidate, table.headers, customer.tier);
  const cells = { ...draft.cells };
  const touched = { ...draft.touched };
  const cellVersions = { ...draft.cellVersions };
  for (const header of materialCandidateHeaders) {
    const key = getSteelReviewDraftCellKey(row.rowId, header);
    delete cells[key];
    delete touched[key];
    delete cellVersions[key];
  }
  const materialSelections = {
    ...draft.materialSelections,
    [row.rowId]: {
      id: candidate.id,
      revision: candidate.revision,
      evidence: {
        snapshotId: customer.snapshotId,
        revision: customer.revision,
        tier: customer.tier,
      },
    },
  };
  return recordMutation(draft, {
    ...draft,
    cells,
    touched,
    cellVersions,
    rowStates: { ...draft.rowStates, [row.rowId]: nextRow },
    materialSelections,
    materialSelectionVersions: {
      ...draft.materialSelectionVersions,
      [row.rowId]: changeSequence,
    },
    changeSequence,
  }, `candidate:${row.rowId}:${changeSequence}`);
}

function cloneSteelProcessingMeasurement(
  measurement: SteelProcessingMeasurement | null,
): SteelProcessingMeasurement | null {
  if (!measurement || measurement.mode !== 'cutting') return measurement;
  return { ...measurement, groups: measurement.groups.map((group) => ({ ...group })) };
}

export function setSteelReviewDraftMeasurement(
  draft: SteelReviewDraftState,
  row: SteelReviewRow,
  measurement: SteelProcessingMeasurement | null,
): SteelReviewDraftState {
  if (!row.rowId || row.system?.kind !== 'processing') return draft;
  const currentMeasurement = row.calculation?.measurement ?? null;
  const nextMeasurement = cloneSteelProcessingMeasurement(measurement);
  const draftMeasurement = Object.prototype.hasOwnProperty.call(draft.measurementDrafts, row.rowId)
    ? draft.measurementDrafts[row.rowId]
    : currentMeasurement;
  if (JSON.stringify(draftMeasurement) === JSON.stringify(nextMeasurement)) {
    return draft;
  }
  const changeSequence = draft.changeSequence + 1;
  const measurementDrafts = { ...draft.measurementDrafts, [row.rowId]: nextMeasurement };
  const measurementVersions = { ...draft.measurementVersions, [row.rowId]: changeSequence };
  const historyBase = Object.prototype.hasOwnProperty.call(draft.measurementDrafts, row.rowId)
    ? draft
    : { ...draft, measurementDrafts: { ...draft.measurementDrafts, [row.rowId]: currentMeasurement } };
  return recordMutation(historyBase, {
    ...draft,
    measurementDrafts,
    measurementVersions,
    changeSequence,
  }, `measurement:${row.rowId}`);
}

export function getSteelReviewDraftMeasurement(
  draft: SteelReviewDraftState,
  rowId: string,
): SteelProcessingMeasurement | null | undefined {
  return Object.prototype.hasOwnProperty.call(draft.measurementDrafts, rowId)
    ? draft.measurementDrafts[rowId]
    : undefined;
}

export function deleteSteelReviewDraftGroup(
  draft: SteelReviewDraftState,
  rows: readonly SteelReviewRow[],
  material: SteelReviewRow,
  savedRows: readonly SteelReviewRow[],
): SteelReviewDraftState {
  if (!material.rowId) return draft;
  const group = rows.filter((row) => row.rowId === material.rowId ||
    (row.system?.kind === 'processing' && row.system.parentRowId === material.rowId));
  if (group.length === 0) return draft;
  const savedById = new Map(savedRows.map((row) => [row.rowId, row]));
  const hasSavedParent = savedById.has(material.rowId);
  const rowStates = { ...draft.rowStates };
  const sourceDrafts = { ...draft.sourceDrafts };
  const changeSequence = draft.changeSequence + 1;
  for (const row of group) {
    if (!row.rowId) continue;
    const savedRow = savedById.get(row.rowId);
    if (!savedRow && (row.origin ?? 'ai') === 'manual') {
      delete rowStates[row.rowId];
      delete sourceDrafts[row.rowId];
      continue;
    }
    const canceledDerivedRelation = !hasSavedParent && savedRow?.system
      ? { system: { ...savedRow.system }, source: savedRow.source }
      : {};
    rowStates[row.rowId] = {
      ...(rowStates[row.rowId] ?? row),
      deleted: true,
      ...canceledDerivedRelation,
      ...(hasSavedParent && row.system?.kind === 'processing' && !row.deleted
        ? { system: { ...row.system, cascadeDeletedBy: material.rowId } }
        : {}),
    };
    if (!hasSavedParent && row.system?.kind === 'processing') {
      delete sourceDrafts[row.rowId];
    }
  }
  return recordMutation(draft, { ...draft, rowStates, sourceDrafts, changeSequence }, `delete-group:${material.rowId}`);
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
    candidate: row.calculation?.candidate ?? null,
    measurement: row.calculation?.measurement ?? null,
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

const calculationOutputDependencies: Record<string, readonly string[]> = {
  單重: ['厚度', '寬度', '長度'],
  總數: ['厚度', '寬度', '長度', '單重', '數量'],
};

function hasEarlierDraftDependency(row: SteelReviewRow, header: string, draft: SteelReviewDraftState): boolean {
  if (!row.system) return false;
  const version = draft.cellVersions[getSteelReviewDraftCellKey(row.rowId, header)] ?? 0;
  return (calculationOutputDependencies[header] ?? []).some((dependency) => {
    const key = getSteelReviewDraftCellKey(row.rowId, dependency);
    const dependencyVersion = draft.cellVersions[key] ?? 0;
    return dependencyVersion > 0 && dependencyVersion < version &&
      Object.prototype.hasOwnProperty.call(draft.touched, key) &&
      draft.touched[key] !== (row.values[dependency]?.effective ?? '');
  });
}

function orderedDraftCells(row: SteelReviewRow, draft: SteelReviewDraftState): Array<{ header: string; value: string }> {
  return Object.keys(row.values)
    .filter((header) => {
      const key = getSteelReviewDraftCellKey(row.rowId, header);
      const value = draft.cells[key] ?? draft.touched[key];
      const hasIntent = Object.prototype.hasOwnProperty.call(draft.cells, key) ||
        (draft.cellVersions[key] ?? 0) > 0 && Object.prototype.hasOwnProperty.call(draft.touched, key);
      return hasIntent && (value !== (row.values[header]?.effective ?? '') ||
        hasEarlierDraftDependency(row, header, draft));
    })
    .sort((left, right) => (draft.cellVersions[getSteelReviewDraftCellKey(row.rowId, left)] ?? 0) -
      (draft.cellVersions[getSteelReviewDraftCellKey(row.rowId, right)] ?? 0))
    .map((header) => {
      const key = getSteelReviewDraftCellKey(row.rowId, header);
      return { header, value: draft.cells[key] ?? draft.touched[key] ?? '' };
    });
}

function projectDraftBusinessValues(
  row: SteelReviewRow,
  projectedRow: SteelReviewRow,
  draft: SteelReviewDraftState,
  previewCalculations: boolean,
): SteelReviewRow['values'] {
  const values = draft.materialSelections[row.rowId]
    ? { ...projectedRow.values }
    : { ...row.values };
  const headers = Object.keys(values);
  let provenance = projectedRow.calculation?.fields;
  for (const { header, value } of orderedDraftCells(row, draft)) {
    values[header] = { ...values[header], effective: value };
    if (!previewCalculations || !projectedRow.system) continue;
    const calculationHeaders = projectedRow.system.kind === 'material' ? headers : [header];
    const calculated = calculateSteelSystemOrderRow({
      headers: calculationHeaders,
      values: calculationHeaders.map((name) => values[name]?.effective ?? ''),
      candidate: projectedRow.system.kind === 'material' ? projectedRow.calculation?.candidate : undefined,
      changedHeaders: [header],
      provenance,
    });
    provenance = calculated.provenance;
    calculationHeaders.forEach((name, index) => {
      const effective = calculated.values[index] ?? '';
      if ((values[name]?.effective ?? '') !== effective) {
        values[name] = { ...values[name], effective };
      }
    });
  }
  return values;
}

export function applySteelReviewDrafts(
  rows: readonly SteelReviewRow[],
  draft: SteelReviewDraftState,
  previewCalculations = true,
): SteelReviewRow[] {
  const projectRow = (row: SteelReviewRow, sourceOverride?: SteelReviewSource | null): SteelReviewRow => {
    if (!row.rowId) {
      return row;
    }

    const projectedRow = draft.rowStates[row.rowId] ?? row;

    const values = projectDraftBusinessValues(row, projectedRow, draft, previewCalculations);
    const measurement = getSteelReviewDraftMeasurement(draft, row.rowId);
    let calculation = projectedRow.calculation
      ? { ...projectedRow.calculation }
      : undefined;
    if (measurement !== undefined) {
      if (measurement === null) {
        if (calculation) delete calculation.measurement;
      } else if (calculation) {
        calculation.measurement = cloneSteelProcessingMeasurement(measurement) ?? undefined;
      } else {
        calculation = { measurement: cloneSteelProcessingMeasurement(measurement) ?? undefined };
      }
    }
    const draftSource = getSteelReviewDraftSource(draft, projectedRow.rowId);
    let source = sourceOverride;
    if (source === undefined) {
      source = draftSource === undefined && projectedRow.origin === 'manual' && projectedRow.source !== null
        ? projectedRow.source
        : draftSource;
    }
    if (source === undefined) {
      return { ...projectedRow, values, ...(calculation ? { calculation } : {}) };
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
    return { ...projectedRow, values: projectedValues, source, ...(calculation ? { calculation } : {}) };
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
  if (!previewCalculations) return projectedWithSystemSources;
  const byId = new Map(projectedWithSystemSources.map((row) => [row.rowId, row]));
  return projectedWithSystemSources.map((row) => {
    if (row.system?.kind !== 'processing' || row.deleted || !row.calculation?.measurement ||
      row.values['總數'] === undefined || Object.prototype.hasOwnProperty.call(draft.cells, getSteelReviewDraftCellKey(row.rowId, '總數'))) {
      return row;
    }
    const parent = row.system.parentRowId ? byId.get(row.system.parentRowId) : undefined;
    if (row.calculation.measurement.mode !== 'batch' && (!parent || parent.deleted || parent.system?.kind !== 'material')) return row;
    const headers = Object.keys(row.values);
    const total = calculateSteelProcessingMeasurement({
      headers,
      values: headers.map((header) => row.values[header]?.effective ?? ''),
      measurement: row.calculation.measurement,
      parentHeaders: parent ? Object.keys(parent.values) : [],
      parentValues: parent ? Object.keys(parent.values).map((header) => parent.values[header]?.effective ?? '') : [],
    });
    if (total === undefined) return row;
    return {
      ...row,
      values: { ...row.values, 總數: { ...row.values['總數'], effective: total } },
    };
  });
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
    .filter((header) => (previous.values[header]?.effective ?? null) !== (next.values[header]?.effective ?? null) ||
      hasEarlierDraftDependency(previous, header, draft))
    .sort((left, right) => (draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, left)] ?? 0) -
      (draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, right)] ?? 0))
    .map((header) => ({ header, value: next.values[header]?.effective ?? null }));
}

const materialCandidateHeaders = new Set<string>(steelMaterialCandidateHeaders);

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
  const rawRowsById = new Map(applySteelReviewDrafts(table.rows, draft, false).map((row) => [row.rowId, row]));
  const operationEntries: Array<{ rowId: string; operation: SteelReviewOperation; activation: boolean }> = [];
  const deferredGroupDeletes: SteelReviewOperation[] = [];
  const baseOrderedRows = [...projectedRows].sort((left, right) => {
    const leftVersion = Math.max(...Object.entries(left.values).map(([header]) => draft.cellVersions[getSteelReviewDraftCellKey(left.rowId, header)] ?? 0), draft.sourceVersions[left.rowId] ?? 0, draft.systemVersions[left.rowId] ?? 0, draft.measurementVersions[left.rowId] ?? 0);
    const rightVersion = Math.max(...Object.entries(right.values).map(([header]) => draft.cellVersions[getSteelReviewDraftCellKey(right.rowId, header)] ?? 0), draft.sourceVersions[right.rowId] ?? 0, draft.systemVersions[right.rowId] ?? 0, draft.measurementVersions[right.rowId] ?? 0);
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
  const materialActivationIds = new Set(projectedRows.flatMap((next) => {
    const previous = originalById.get(next.rowId);
    if (next.system?.kind !== 'material') return [];
    if (!previous) return next.origin === 'manual' && !next.deleted ? [next.rowId] : [];
    const classified = previous.system?.kind === 'unassigned' &&
      systemChanged(previous.system, next.system) && (draft.systemVersions[next.rowId] ?? 0) > 0;
    const restored = previous.deleted && !next.deleted;
    return classified || restored ? [next.rowId] : [];
  }));
  const pushOperation = (rowId: string, operation: SteelReviewOperation, activation = false) => {
    operationEntries.push({ rowId, operation, activation });
  };
  const addedRowIds = new Set(baseOrderedRows
    .filter((row) => !originalById.has(row.rowId) && row.origin === 'manual' && !row.deleted)
    .map((row) => row.rowId));
  const orderedRows: SteelReviewRow[] = [];
  const pendingRows = [...baseOrderedRows];
  const orderedRowIds = new Set<string>();
  while (pendingRows.length > 0) {
    const nextIndex = pendingRows.findIndex((row) => {
      if (row.system?.kind !== 'processing' || !row.system.parentRowId || !addedRowIds.has(row.system.parentRowId)) {
        return true;
      }
      return orderedRowIds.has(row.system.parentRowId);
    });
    if (nextIndex < 0) {
      orderedRows.push(...pendingRows);
      break;
    }
    const [next] = pendingRows.splice(nextIndex, 1);
    if (next) {
      orderedRows.push(next);
      orderedRowIds.add(next.rowId);
    }
  }
  for (const projected of orderedRows) {
    const next = rawRowsById.get(projected.rowId) ?? projected;
    const previous = originalById.get(next.rowId);
    if (!previous) {
      if (next.origin !== 'manual' || next.deleted) continue;
      const changes = table.headers
        .filter((header) => !isSourceHeader(header))
        .sort((left, right) => (draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, left)] ?? 0) -
          (draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, right)] ?? 0))
        .map((header) => ({ header, value: next.values[header]?.effective ?? null }));
      const add: Extract<SteelReviewOperation, { type: 'add' }> = {
        type: 'add',
        rowId: next.rowId,
        position: resolveInsertionPosition(next, allRowsById, trustedIds),
        changes,
      };
      if (next.source !== null && next.system?.kind !== 'processing') add.source = sourceIntent(next.source);
      if (next.system) {
        add.system = { kind: next.system.kind, parentRowId: next.system.parentRowId };
      }
      if (Object.prototype.hasOwnProperty.call(draft.measurementDrafts, next.rowId)) {
        add.measurement = next.calculation?.measurement;
      }
      pushOperation(next.rowId, add, next.system?.kind === 'material');
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
    const measurementWasChanged = Object.prototype.hasOwnProperty.call(draft.measurementDrafts, next.rowId) &&
      JSON.stringify(previous.calculation?.measurement ?? null) !== JSON.stringify(next.calculation?.measurement ?? null);
    const classify = previous.system?.kind === 'unassigned' && next.system && next.system.kind !== 'unassigned' && systemWasChanged
      ? { type: 'classify' as const, rowId: next.rowId, system: { kind: next.system.kind, parentRowId: next.system.parentRowId } }
      : undefined;
    const isCascadeChildDelete = next.deleted && next.system?.kind === 'processing' &&
      next.system.cascadeDeletedBy !== null && next.system.cascadeDeletedBy !== undefined &&
      groupDeleteParentIds.has(next.system.cascadeDeletedBy);
    const isCascadeChildRestore = previous.deleted && previous.system?.kind === 'processing' &&
      previous.system.cascadeDeletedBy !== null && previous.system.cascadeDeletedBy !== undefined &&
      groupRestoreParentIds.has(previous.system.cascadeDeletedBy);
    if (!previous.deleted && next.deleted) {
      if (classify) pushOperation(next.rowId, classify, classify.system.kind === 'material');
      if (changes.length > 0 || sourceWasChanged || binding || measurementWasChanged) {
        const update: Extract<SteelReviewOperation, { type: 'update' }> = {
          type: 'update', rowId: next.rowId,
          ...(changes.length > 0 ? { changes } : {}),
          ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
          ...(binding ? { binding } : {}),
          ...(measurementWasChanged ? { measurement: next.calculation?.measurement ?? null } : {}),
        };
        pushOperation(next.rowId, update);
      }
      if (!isCascadeChildDelete) {
        const deletion = { type: 'delete' as const, rowId: next.rowId };
        if (groupDeleteParentIds.has(next.rowId)) {
          deferredGroupDeletes.push(deletion);
        } else {
          pushOperation(next.rowId, deletion);
        }
      }
      continue;
    }
    if (previous.deleted && !next.deleted) {
      if (!isCascadeChildRestore) {
        pushOperation(next.rowId, { type: 'restore', rowId: next.rowId }, materialActivationIds.has(next.rowId));
      }
      if (classify) pushOperation(next.rowId, classify, classify.system.kind === 'material');
      if (changes.length > 0 || sourceWasChanged || binding || measurementWasChanged) {
        pushOperation(next.rowId, {
          type: 'update', rowId: next.rowId,
          ...(changes.length > 0 ? { changes } : {}),
          ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
          ...(binding ? { binding } : {}),
          ...(measurementWasChanged ? { measurement: next.calculation?.measurement ?? null } : {}),
        });
      }
      continue;
    }
    const isCascadeChildRestoreDelete = previous.deleted && next.deleted && isCascadeChildRestore;
    const materialSelection = draft.materialSelections[next.rowId];
    if (materialSelection && next.system?.kind === 'material' && !next.deleted) {
      const selectionVersion = draft.materialSelectionVersions[next.rowId] ?? 0;
      const selectionChanges = changes.filter(({ header }) => {
        const version = draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, header)] ?? 0;
        return !materialCandidateHeaders.has(header) || version > selectionVersion;
      });
      const beforeChanges = selectionChanges.filter(({ header }) =>
        (draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, header)] ?? 0) <= selectionVersion);
      const afterChanges = selectionChanges.filter(({ header }) =>
        (draft.cellVersions[getSteelReviewDraftCellKey(next.rowId, header)] ?? 0) > selectionVersion);
      const pushUpdate = (rowChanges: Array<{ header: string; value: string | null }>, includeSource: boolean) => {
        if (rowChanges.length === 0 && (!includeSource || !sourceWasChanged) && !binding && !measurementWasChanged) return;
        pushOperation(next.rowId, {
          type: 'update', rowId: next.rowId,
          ...(rowChanges.length > 0 ? { changes: rowChanges } : {}),
          ...(includeSource && sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
          ...(binding ? { binding } : {}),
          ...(measurementWasChanged ? { measurement: next.calculation?.measurement ?? null } : {}),
        });
      };
      const sourceBefore = (draft.sourceVersions[next.rowId] ?? 0) <= selectionVersion;
      pushUpdate(beforeChanges, sourceBefore);
      pushOperation(next.rowId, { type: 'replace_material', rowId: next.rowId, selection: materialSelection });
      pushUpdate(afterChanges, !sourceBefore);
      continue;
    }
    if (previous.deleted && next.deleted && (changes.length > 0 || sourceWasChanged || binding || measurementWasChanged || classify || isCascadeChildRestoreDelete)) {
      if (!isCascadeChildRestore) {
        pushOperation(next.rowId, { type: 'restore', rowId: next.rowId }, materialActivationIds.has(next.rowId));
      }
      if (classify) pushOperation(next.rowId, classify, classify.system.kind === 'material');
      if (changes.length > 0 || sourceWasChanged || binding || measurementWasChanged) {
        pushOperation(next.rowId, {
          type: 'update', rowId: next.rowId,
          ...(changes.length > 0 ? { changes } : {}),
          ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
          ...(binding ? { binding } : {}),
          ...(measurementWasChanged ? { measurement: next.calculation?.measurement ?? null } : {}),
        });
      }
      pushOperation(next.rowId, { type: 'delete', rowId: next.rowId });
      continue;
    }
    if (classify) pushOperation(next.rowId, classify, classify.system.kind === 'material');
    if (changes.length > 0 || sourceWasChanged || binding || measurementWasChanged) {
      pushOperation(next.rowId, {
        type: 'update', rowId: next.rowId,
        ...(changes.length > 0 ? { changes } : {}),
        ...(sourceWasChanged ? { source: sourceIntent(next.source) } : {}),
        ...(binding ? { binding } : {}),
        ...(measurementWasChanged ? { measurement: next.calculation?.measurement ?? null } : {}),
      });
    }
  }
  const activationEntriesByRow = new Map<string, number[]>();
  operationEntries.forEach((entry, index) => {
    if (!entry.activation) return;
    const entries = activationEntriesByRow.get(entry.rowId) ?? [];
    entries.push(index);
    activationEntriesByRow.set(entry.rowId, entries);
  });
  const dependencies = operationEntries.map(() => new Set<number>());
  for (const next of projectedRows) {
    if (next.system?.kind !== 'processing') continue;
    const previous = originalById.get(next.rowId);
    const parentIds = new Set<string>();
    if (next.system.parentRowId) parentIds.add(next.system.parentRowId);
    if (previous?.deleted && previous.system?.kind === 'processing' && previous.system.cascadeDeletedBy &&
      groupRestoreParentIds.has(previous.system.cascadeDeletedBy)) {
      parentIds.add(previous.system.cascadeDeletedBy);
    }
    const rowEntries = operationEntries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.rowId === next.rowId);
    for (const parentId of parentIds) {
      for (const activationIndex of activationEntriesByRow.get(parentId) ?? []) {
        for (const { index } of rowEntries) {
          if (activationIndex !== index) dependencies[index]!.add(activationIndex);
        }
      }
    }
  }
  const dependents = operationEntries.map(() => [] as number[]);
  const indegree = dependencies.map((dependencySet) => dependencySet.size);
  dependencies.forEach((dependencySet, index) => {
    for (const dependency of dependencySet) dependents[dependency]!.push(index);
  });
  const available = indegree.flatMap((degree, index) => degree === 0 ? [index] : []);
  const sortedEntries: typeof operationEntries = [];
  while (available.length > 0) {
    available.sort((left, right) => left - right);
    const index = available.shift()!;
    sortedEntries.push(operationEntries[index]!);
    for (const dependent of dependents[index]!) {
      indegree[dependent] = indegree[dependent]! - 1;
      if (indegree[dependent] === 0) available.push(dependent);
    }
  }
  const orderedOperations = sortedEntries.length === operationEntries.length
    ? sortedEntries.map((entry) => entry.operation)
    : operationEntries.map((entry) => entry.operation);
  return [...orderedOperations, ...deferredGroupDeletes];
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
  const touched = { ...draft.touched };
  const cellVersions = { ...draft.cellVersions };
  for (const [key, value] of Object.entries(draft.touched)) {
    if ((draft.cellVersions[key] ?? 0) <= submittedChangeSequence) {
      delete cells[key];
      delete touched[key];
      delete cellVersions[key];
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

  const measurementDrafts = { ...draft.measurementDrafts };
  const measurementVersions = { ...draft.measurementVersions };
  for (const [rowId, measurement] of Object.entries(measurementDrafts)) {
    if ((measurementVersions[rowId] ?? 0) <= submittedChangeSequence) {
      delete measurementDrafts[rowId];
      delete measurementVersions[rowId];
      continue;
    }
    const savedMeasurement = savedRows.find((row) => row.rowId === rowId)?.calculation?.measurement ?? null;
    if (JSON.stringify(measurement) === JSON.stringify(savedMeasurement)) {
      delete measurementDrafts[rowId];
      delete measurementVersions[rowId];
    }
  }

  const materialSelections = { ...draft.materialSelections };
  const materialSelectionVersions = { ...draft.materialSelectionVersions };
  for (const rowId of Object.keys(materialSelections)) {
    if ((materialSelectionVersions[rowId] ?? 0) <= submittedChangeSequence) {
      delete materialSelections[rowId];
      delete materialSelectionVersions[rowId];
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
    const snapshotMeasurements = { ...(snapshot.measurementDrafts ?? {}) };
    const snapshotMeasurementVersions = { ...(snapshot.measurementVersions ?? {}) };
    for (const [rowId, measurement] of Object.entries(snapshotMeasurements)) {
      const savedMeasurement = savedRows.find((row) => row.rowId === rowId)?.calculation?.measurement ?? null;
      if (JSON.stringify(measurement) === JSON.stringify(savedMeasurement)) {
        delete snapshotMeasurements[rowId];
        delete snapshotMeasurementVersions[rowId];
      }
    }
    return {
      ...snapshot,
      cells: snapshotCells,
      sourceDrafts: snapshotSources,
      measurementDrafts: snapshotMeasurements,
      measurementVersions: snapshotMeasurementVersions,
      rowStates: snapshotRows,
    };
  };

  return {
    ...draft,
    cells,
    touched,
    cellVersions,
    sourceDrafts,
    systemVersions,
    measurementDrafts,
    measurementVersions,
    materialSelections,
    materialSelectionVersions,
    rowStates,
    past: draft.past.map(rebaseSnapshot),
    future: draft.future.map(rebaseSnapshot),
    historyGroup: undefined,
  };
}
