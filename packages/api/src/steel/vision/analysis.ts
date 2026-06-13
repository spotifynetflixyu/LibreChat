import crypto from 'crypto';

import {
  patchFileAnalysisDataToolInputSchema,
  steelFileAnalysisDataSchema,
  type PatchFileAnalysisDataToolInput,
  type SteelFileAnalysisColumn,
  type SteelFileAnalysisData,
  type SteelFileAnalysisNoteRow,
  type SteelFileAnalysisReviewRow,
  type SteelFileAnalysisRow,
  type SteelFileAnalysisSheetId,
  type SteelFileAnalysisSourceFile,
} from 'librechat-data-provider';

type FileAnalysisSheet = SteelFileAnalysisData['sheets']['file_analysis_data'];
type ManualReviewSheet = SteelFileAnalysisData['sheets']['manual_review'];
type InterpretationNotesSheet = SteelFileAnalysisData['sheets']['interpretation_notes'];
type AnyFileAnalysisRow =
  | SteelFileAnalysisRow
  | SteelFileAnalysisReviewRow
  | SteelFileAnalysisNoteRow;
type PartialFileAnalysisRow<Row extends AnyFileAnalysisRow> = Partial<Row> & {
  id?: string;
  sourceRef?: Row['sourceRef'];
  cells?: Row['cells'];
  rowWarnings?: string[];
};

export interface SteelFileAnalysisCreateRecord extends SteelFileAnalysisData {
  createdAt: Date;
  updatedAt: Date;
}

export type SteelFileAnalysisRecord = SteelFileAnalysisCreateRecord;

export interface SteelFileAnalysisRepository {
  create(record: SteelFileAnalysisCreateRecord): Promise<SteelFileAnalysisRecord>;
  findByConversationId(conversationId: string): Promise<SteelFileAnalysisRecord | null>;
  update(record: SteelFileAnalysisRecord): Promise<SteelFileAnalysisRecord>;
}

interface SteelFileAnalysisServiceDeps {
  repository: SteelFileAnalysisRepository;
  id?: () => string;
  now?: () => Date;
}

interface PatchSteelFileAnalysisInput {
  conversationId: string;
  patch: PatchFileAnalysisDataToolInput;
}

function defaultId() {
  return `steel_fad_${crypto.randomUUID()}`;
}

function createEmptyWorkspace({
  conversationId,
  id,
  now,
}: {
  conversationId: string;
  id: () => string;
  now: () => Date;
}): SteelFileAnalysisCreateRecord {
  const timestamp = now();

  const workspace = steelFileAnalysisDataSchema.parse({
    id: id(),
    conversationId,
    version: 1,
    status: 'draft',
    sourceFiles: [],
    sheets: {
      file_analysis_data: { columns: [], rows: [] },
      manual_review: { columns: [], rows: [] },
      interpretation_notes: { columns: [], rows: [] },
    },
  });

  return {
    ...workspace,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function mergeSourceFiles(
  existing: readonly SteelFileAnalysisSourceFile[],
  next: readonly SteelFileAnalysisSourceFile[],
) {
  const byId = new Map(existing.map((file) => [file.fileId, file]));
  for (const file of next) {
    byId.set(file.fileId, { ...byId.get(file.fileId), ...file });
  }

  return [...byId.values()];
}

function mergeColumns(
  existing: readonly SteelFileAnalysisColumn[],
  next: readonly SteelFileAnalysisColumn[],
) {
  const byKey = new Map(existing.map((column) => [column.key, column]));
  for (const column of next) {
    byKey.set(column.key, { ...byKey.get(column.key), ...column });
  }

  return [...byKey.values()];
}

function getSourceKey(sourceRef?: { sourceKey?: string }) {
  const sourceKey = sourceRef?.sourceKey?.trim();
  return sourceKey && sourceKey.length > 0 ? sourceKey : undefined;
}

function mergeRows<Row extends AnyFileAnalysisRow>(
  existing: readonly Row[],
  upsertRows: readonly PartialFileAnalysisRow<Row>[],
  deleteRowIds: readonly string[],
  id: () => string,
) {
  const deleted = new Set(deleteRowIds);
  const byId = new Map(existing.filter((row) => !deleted.has(row.id)).map((row) => [row.id, row]));
  const rowIdBySourceKey = new Map<string, string>();
  for (const row of byId.values()) {
    const sourceKey = getSourceKey(row.sourceRef);
    if (sourceKey) {
      rowIdBySourceKey.set(sourceKey, row.id);
    }
  }

  for (const row of upsertRows) {
    const sourceKey = getSourceKey(row.sourceRef);
    const rowId = row.id ?? (sourceKey ? rowIdBySourceKey.get(sourceKey) : undefined) ?? id();
    const previous = byId.get(rowId);
    const sourceRef = row.sourceRef ?? previous?.sourceRef;
    const previousWarnings =
      previous && 'rowWarnings' in previous ? previous.rowWarnings : undefined;
    const merged = {
      ...previous,
      ...row,
      id: rowId,
      ...(sourceRef ? { sourceRef } : {}),
      cells: {
        ...(previous?.cells ?? {}),
        ...(row.cells ?? {}),
      },
      ...(row.rowWarnings || previousWarnings
        ? { rowWarnings: row.rowWarnings ?? previousWarnings ?? [] }
        : {}),
    } as Row;

    byId.set(rowId, merged);
    const mergedSourceKey = getSourceKey(merged.sourceRef);
    if (mergedSourceKey) {
      rowIdBySourceKey.set(mergedSourceKey, rowId);
    }
  }

  return [...byId.values()];
}

function patchSheet(
  workspace: SteelFileAnalysisRecord,
  patch: PatchFileAnalysisDataToolInput['patches'][number],
  id: () => string,
) {
  if (patch.sheetId === 'file_analysis_data') {
    const sheet: FileAnalysisSheet = workspace.sheets.file_analysis_data;
    sheet.columns = mergeColumns(sheet.columns, patch.upsertColumns);
    sheet.rows = mergeRows(
      sheet.rows,
      patch.upsertRows as Partial<SteelFileAnalysisRow>[],
      patch.deleteRowIds,
      id,
    );
    return;
  }

  if (patch.sheetId === 'manual_review') {
    const sheet: ManualReviewSheet = workspace.sheets.manual_review;
    sheet.columns = mergeColumns(sheet.columns, patch.upsertColumns);
    sheet.rows = mergeRows(
      sheet.rows,
      patch.upsertRows as Partial<SteelFileAnalysisReviewRow>[],
      patch.deleteRowIds,
      id,
    );
    return;
  }

  const sheet: InterpretationNotesSheet = workspace.sheets.interpretation_notes;
  sheet.columns = mergeColumns(sheet.columns, patch.upsertColumns);
  sheet.rows = mergeRows(
    sheet.rows,
    patch.upsertRows as Partial<SteelFileAnalysisNoteRow>[],
    patch.deleteRowIds,
    id,
  );
}

function cloneWorkspace(record: SteelFileAnalysisRecord): SteelFileAnalysisRecord {
  return {
    ...record,
    sourceFiles: record.sourceFiles.map((file) => ({ ...file })),
    sheets: {
      file_analysis_data: {
        columns: record.sheets.file_analysis_data.columns.map((column) => ({ ...column })),
        rows: record.sheets.file_analysis_data.rows.map((row) => ({
          ...row,
          sourceRef: { ...row.sourceRef },
          cells: { ...row.cells },
          rowWarnings: [...row.rowWarnings],
        })),
      },
      manual_review: {
        columns: record.sheets.manual_review.columns.map((column) => ({ ...column })),
        rows: record.sheets.manual_review.rows.map((row) => ({
          ...row,
          sourceRef: row.sourceRef ? { ...row.sourceRef } : undefined,
          cells: { ...row.cells },
          rowWarnings: [...row.rowWarnings],
        })),
      },
      interpretation_notes: {
        columns: record.sheets.interpretation_notes.columns.map((column) => ({ ...column })),
        rows: record.sheets.interpretation_notes.rows.map((row) => ({
          ...row,
          sourceRef: row.sourceRef ? { ...row.sourceRef } : undefined,
          cells: { ...row.cells },
        })),
      },
    },
  };
}

export function createSteelFileAnalysisService({
  repository,
  id = defaultId,
  now = () => new Date(),
}: SteelFileAnalysisServiceDeps) {
  return {
    async readByConversationId(conversationId: string): Promise<SteelFileAnalysisRecord | null> {
      return repository.findByConversationId(conversationId);
    },

    async patch({
      conversationId,
      patch,
    }: PatchSteelFileAnalysisInput): Promise<SteelFileAnalysisRecord> {
      const parsedPatch = patchFileAnalysisDataToolInputSchema.parse(patch);
      const existing = await repository.findByConversationId(conversationId);
      const workspace = existing
        ? cloneWorkspace(existing)
        : await repository.create(createEmptyWorkspace({ conversationId, id, now }));
      workspace.sourceFiles = mergeSourceFiles(workspace.sourceFiles, parsedPatch.sourceFiles);
      for (const sheetPatch of parsedPatch.patches) {
        patchSheet(workspace, sheetPatch, id);
      }
      workspace.version = existing ? workspace.version + 1 : 1;
      workspace.updatedAt = now();

      const parsedWorkspace = {
        ...steelFileAnalysisDataSchema.parse(workspace),
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      };
      return existing ? repository.update(parsedWorkspace) : repository.update(parsedWorkspace);
    },
  };
}

export type { SteelFileAnalysisSheetId };
