import { memo, useEffect, useMemo, useState } from 'react';
import { FileSearch, Loader2, Plus, X } from 'lucide-react';
import { requiredSteelFileAnalysisSheetIds } from 'librechat-data-provider';

import type {
  SteelFileAnalysisCellValue,
  SteelFileAnalysisColumn,
  SteelFileAnalysisData,
  SteelFileAnalysisManualPatchRequest,
  SteelFileAnalysisRow,
  SteelFileAnalysisSheetId,
  SteelFileAnalysisSourceRef,
} from 'librechat-data-provider';

interface SteelFileAnalysisPreviewProps {
  fileAnalysisData: SteelFileAnalysisData | null;
  onSave?: (
    conversationId: string,
    payload: SteelFileAnalysisManualPatchRequest,
  ) => Promise<SteelFileAnalysisData>;
}

const emptyFileAnalysisText = 'No file analysis yet';
const fileAnalysisTitle = 'File Analysis Data';
const waitingForRowsText = 'Waiting for rows';
const savedText = 'saved';
const saveText = 'Save';
const addRowText = 'Add row';

type FileAnalysisSheet = {
  id: SteelFileAnalysisSheetId;
  columns: SteelFileAnalysisColumn[];
  rows: Array<{
    id: string;
    cells: Record<string, SteelFileAnalysisCellValue>;
  }>;
};

function cellText(value: SteelFileAnalysisCellValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function parseCellValue(
  value: string,
  column: SteelFileAnalysisColumn,
): SteelFileAnalysisCellValue {
  if (value.trim().length === 0) {
    return '';
  }
  if (column.valueType === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (column.valueType === 'boolean') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
  }

  return value;
}

function cloneFileAnalysisData(fileAnalysisData: SteelFileAnalysisData): SteelFileAnalysisData {
  return {
    ...fileAnalysisData,
    sourceFiles: fileAnalysisData.sourceFiles.map((file) => ({ ...file })),
    sheets: {
      file_analysis_data: {
        columns: fileAnalysisData.sheets.file_analysis_data.columns.map((column) => ({
          ...column,
        })),
        rows: fileAnalysisData.sheets.file_analysis_data.rows.map((row) => ({
          ...row,
          sourceRef: { ...row.sourceRef },
          cells: { ...row.cells },
          rowWarnings: [...row.rowWarnings],
        })),
      },
      manual_review: {
        columns: fileAnalysisData.sheets.manual_review.columns.map((column) => ({ ...column })),
        rows: fileAnalysisData.sheets.manual_review.rows.map((row) => ({
          ...row,
          sourceRef: row.sourceRef ? { ...row.sourceRef } : undefined,
          cells: { ...row.cells },
          rowWarnings: [...row.rowWarnings],
        })),
      },
      interpretation_notes: {
        columns: fileAnalysisData.sheets.interpretation_notes.columns.map((column) => ({
          ...column,
        })),
        rows: fileAnalysisData.sheets.interpretation_notes.rows.map((row) => ({
          ...row,
          sourceRef: row.sourceRef ? { ...row.sourceRef } : undefined,
          cells: { ...row.cells },
        })),
      },
    },
  };
}

function getFileAnalysisSheets(fileAnalysisData: SteelFileAnalysisData): FileAnalysisSheet[] {
  return requiredSteelFileAnalysisSheetIds.map((id) => ({
    id,
    columns: fileAnalysisData.sheets[id].columns,
    rows: fileAnalysisData.sheets[id].rows,
  }));
}

function getActiveSheet(
  sheets: readonly FileAnalysisSheet[],
  activeSheetId: string | null,
): FileAnalysisSheet | null {
  return sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0] ?? null;
}

function getSourceFileText(count: number): string {
  if (count === 1) {
    return '1 source file';
  }

  return `${count} source files`;
}

function getUnsavedText(changeCount: number): string {
  if (changeCount === 1) {
    return 'draft · 1 unsaved change';
  }

  return `draft · ${changeCount} unsaved changes`;
}

function getDefaultSourceRef(
  fileAnalysisData: SteelFileAnalysisData,
): SteelFileAnalysisSourceRef | null {
  const [firstRow] = fileAnalysisData.sheets.file_analysis_data.rows;
  if (firstRow) {
    return { ...firstRow.sourceRef };
  }

  const [firstFile] = fileAnalysisData.sourceFiles;
  return firstFile ? { ...firstFile } : null;
}

const SteelFileAnalysisPreview = memo(function SteelFileAnalysisPreview({
  fileAnalysisData,
  onSave,
}: SteelFileAnalysisPreviewProps) {
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<SteelFileAnalysisData | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnKey: string;
  } | null>(null);
  const [deletedRowIds, setDeletedRowIds] = useState<string[]>([]);
  const [changeCount, setChangeCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const sheets = useMemo(() => (draftData ? getFileAnalysisSheets(draftData) : []), [draftData]);
  const activeSheet = getActiveSheet(sheets, activeSheetId);
  const canEditActiveSheet = activeSheet?.id === 'file_analysis_data';

  useEffect(() => {
    setDraftData(fileAnalysisData ? cloneFileAnalysisData(fileAnalysisData) : null);
    setDeletedRowIds([]);
    setChangeCount(0);
    setEditingCell(null);
  }, [fileAnalysisData]);

  useEffect(() => {
    if (!draftData) {
      setActiveSheetId(null);
      return;
    }
    if (!activeSheetId || !sheets.some((sheet) => sheet.id === activeSheetId)) {
      setActiveSheetId(sheets[0]?.id ?? null);
    }
  }, [activeSheetId, draftData, sheets]);

  if (!draftData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-secondary">
        <FileSearch className="mr-2 h-4 w-4" aria-hidden="true" />
        {emptyFileAnalysisText}
      </div>
    );
  }

  const versionLabel = `v${draftData.version}`;
  const statusText = changeCount > 0 ? getUnsavedText(changeCount) : savedText;

  const updateCell = (
    row: FileAnalysisSheet['rows'][number],
    column: SteelFileAnalysisColumn,
    value: string,
  ) => {
    setDraftData((current) => {
      if (!current) {
        return current;
      }

      const next = cloneFileAnalysisData(current);
      const nextRow = next.sheets.file_analysis_data.rows.find(
        (candidate) => candidate.id === row.id,
      );
      if (!nextRow) {
        return current;
      }

      const nextValue = parseCellValue(value, column);
      if (nextRow.cells[column.key] === nextValue) {
        return current;
      }

      nextRow.cells[column.key] = nextValue;
      setChangeCount((count) => count + 1);
      return next;
    });
  };

  const addRow = () => {
    const sourceRef = getDefaultSourceRef(draftData);
    if (!sourceRef) {
      return;
    }

    setDraftData((current) => {
      if (!current) {
        return current;
      }

      const next = cloneFileAnalysisData(current);
      const cells = Object.fromEntries(
        next.sheets.file_analysis_data.columns.map((column) => [column.key, '']),
      );
      next.sheets.file_analysis_data.rows.push({
        id: `manual_row_${Date.now()}`,
        sourceRef,
        cells,
        confidence: 'medium',
        reviewStatus: 'pending_review',
        rowWarnings: [],
      });
      return next;
    });
    setChangeCount((count) => count + 1);
  };

  const deleteRow = (rowId: string) => {
    setDraftData((current) => {
      if (!current) {
        return current;
      }

      const next = cloneFileAnalysisData(current);
      next.sheets.file_analysis_data.rows = next.sheets.file_analysis_data.rows.filter(
        (row) => row.id !== rowId,
      );
      return next;
    });
    setDeletedRowIds((current) => (current.includes(rowId) ? current : [...current, rowId]));
    setChangeCount((count) => count + 1);
  };

  const save = async () => {
    if (!onSave || changeCount === 0) {
      return;
    }

    setIsSaving(true);
    try {
      const saved = await onSave(draftData.conversationId, {
        sourceFiles: draftData.sourceFiles,
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertColumns: draftData.sheets.file_analysis_data.columns,
            upsertRows: draftData.sheets.file_analysis_data.rows as SteelFileAnalysisRow[],
            deleteRowIds: deletedRowIds,
          },
        ],
      });
      setDraftData(cloneFileAnalysisData(saved));
      setDeletedRowIds([]);
      setChangeCount(0);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface-primary">
      <header className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-primary">{fileAnalysisTitle}</h2>
          <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-text-secondary">
            <span>{versionLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{getSourceFileText(draftData.sourceFiles.length)}</span>
            <span aria-hidden="true">·</span>
            <span>{statusText}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label="Save file analysis changes"
          disabled={!onSave || changeCount === 0 || isSaving}
          className="flex h-9 items-center gap-2 rounded border border-border-light px-3 text-sm text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            void save();
          }}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {changeCount > 0 ? saveText : savedText}
        </button>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-border-light px-3 py-2">
        {sheets.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            className={`whitespace-nowrap rounded px-2 py-1.5 text-sm transition-colors ${
              activeSheet?.id === sheet.id
                ? 'bg-surface-active-alt text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
            onClick={() => setActiveSheetId(sheet.id)}
          >
            {sheet.id}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {activeSheet && activeSheet.columns.length > 0 && (
          <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
            <thead className="sticky top-0 z-[1] bg-surface-primary">
              <tr>
                {canEditActiveSheet && (
                  <th className="w-8 border-b border-border-light px-2 py-2" />
                )}
                {activeSheet.columns.map((column) => (
                  <th
                    key={column.key}
                    className="min-w-[9rem] max-w-[18rem] border-b border-border-light px-3 py-2 font-medium text-text-secondary"
                  >
                    <span className="line-clamp-2 break-words" title={column.label}>
                      {column.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeSheet.rows.map((row) => (
                <tr key={row.id} className="border-b border-border-light">
                  {canEditActiveSheet && (
                    <td className="w-8 border-b border-border-light px-2 py-2">
                      <button
                        type="button"
                        aria-label={`Delete file analysis row ${row.id}`}
                        className="flex h-5 w-5 items-center justify-center rounded text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                        onClick={() => deleteRow(row.id)}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                  {activeSheet.columns.map((column) => (
                    <td
                      key={column.key}
                      className="max-w-[18rem] border-b border-border-light px-3 py-2 align-top text-text-primary"
                      onDoubleClick={() => {
                        if (canEditActiveSheet) {
                          setEditingCell({ rowId: row.id, columnKey: column.key });
                        }
                      }}
                    >
                      {editingCell?.rowId === row.id && editingCell.columnKey === column.key ? (
                        <input
                          aria-label={`Edit ${column.label} ${row.id}`}
                          className="w-full min-w-20 rounded border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary outline-none"
                          defaultValue={cellText(row.cells[column.key])}
                          onBlur={(event) => {
                            updateCell(row, column, event.target.value);
                            setEditingCell(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              updateCell(row, column, event.currentTarget.value);
                              setEditingCell(null);
                            }
                            if (event.key === 'Escape') {
                              setEditingCell(null);
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="line-clamp-2 break-words"
                          title={cellText(row.cells[column.key])}
                        >
                          {cellText(row.cells[column.key])}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {activeSheet && activeSheet.columns.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-text-secondary">
            <Loader2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {waitingForRowsText}
          </div>
        )}
        {canEditActiveSheet && (
          <button
            type="button"
            aria-label="Add file analysis row"
            className="mt-3 flex h-8 items-center gap-2 rounded border border-border-light px-3 text-xs text-text-primary hover:bg-surface-hover"
            onClick={addRow}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {addRowText}
          </button>
        )}
      </div>
    </section>
  );
});

export default SteelFileAnalysisPreview;
