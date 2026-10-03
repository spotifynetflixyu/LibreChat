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
    changeSequence: 0,
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
  return { ...draft, sourceDrafts, sourceVersions, changeSequence };
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
    const source = getSteelReviewDraftSource(draft, row.rowId);
    if (source === undefined) {
      return { ...row, values };
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
      const sameFile = source !== null && source.fileId === row.source?.fileId;
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
    return { ...row, values: projectedValues, source };
  });
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
    ...(Object.entries(draftSourceIntents(draft, table.rows)).length > 0
      ? { sourceIntents: draftSourceIntents(draft, table.rows) }
      : {}),
  };
}

function draftSourceIntents(
  draft: SteelReviewDraftState,
  rows: readonly SteelReviewRow[],
): SteelReviewSourceIntent[] {
  const byId = new Map(rows.map((row) => [row.rowId, row]));
  return Object.entries(draft.sourceDrafts)
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

  return { ...draft, cells, sourceDrafts };
}
