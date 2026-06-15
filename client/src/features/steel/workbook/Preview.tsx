import { memo, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, Loader2, RefreshCw } from 'lucide-react';

import type {
  SteelChangedPath,
  SteelWorkbook,
  SteelWorkbookSheet,
  SteelWorkbookSheetId,
} from 'librechat-data-provider';

interface SteelWorkbookPreviewProps {
  workbook: SteelWorkbook | null;
  changedPaths: SteelChangedPath[];
  error?: string | null;
  exportSheetIds?: SteelWorkbookSheetId[];
  isLoading?: boolean;
  isDownloading?: boolean;
  downloadError?: string | null;
  onDownload?: () => void;
  onRetry?: () => void;
  onToggleExportSheet?: (sheetId: SteelWorkbookSheetId) => void;
}

export const visibleSteelWorkbookSheetIds = [
  'system_order',
  'customer_data',
  'manual_review',
  'customer_quote',
] satisfies readonly SteelWorkbookSheetId[];

const visibleSteelWorkbookSheetIdSet: ReadonlySet<SteelWorkbookSheetId> = new Set(
  visibleSteelWorkbookSheetIds,
);

function isVisibleSteelWorkbookSheetId(sheetId: SteelWorkbookSheetId): boolean {
  return visibleSteelWorkbookSheetIdSet.has(sheetId);
}

export function getVisibleSteelWorkbookSheetIds(workbook: SteelWorkbook): SteelWorkbookSheetId[] {
  return workbook.sheets
    .filter((sheet) => isVisibleSteelWorkbookSheetId(sheet.id))
    .map((sheet) => sheet.id);
}

function pathKey(path: SteelChangedPath): string {
  return `${path.sheetId}:${path.rowId}:${path.columnKey}`;
}

function cellText(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function getActiveSheet(
  sheets: SteelWorkbookSheet[],
  activeSheetId: string | null,
): SteelWorkbookSheet | null {
  return sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0] ?? null;
}

function getWorkbookSheetLabel(sheet: SteelWorkbookSheet): string {
  return sheet.id === 'manual_review' ? '人工複核' : sheet.label;
}

const SteelWorkbookPreview = memo(function SteelWorkbookPreview({
  workbook,
  changedPaths,
  error = null,
  exportSheetIds = [],
  isLoading = false,
  isDownloading = false,
  downloadError = null,
  onDownload,
  onRetry,
  onToggleExportSheet,
}: SteelWorkbookPreviewProps) {
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const changedKeys = useMemo(() => new Set(changedPaths.map(pathKey)), [changedPaths]);
  const visibleSheets = useMemo(
    () => workbook?.sheets.filter((sheet) => isVisibleSteelWorkbookSheetId(sheet.id)) ?? [],
    [workbook],
  );
  const activeSheet = getActiveSheet(visibleSheets, activeSheetId);

  useEffect(() => {
    if (!workbook) {
      setActiveSheetId(null);
      return;
    }
    if (!activeSheetId || !visibleSheets.some((sheet) => sheet.id === activeSheetId)) {
      setActiveSheetId(visibleSheets[0]?.id ?? null);
    }
  }, [activeSheetId, visibleSheets, workbook]);

  if (!workbook) {
    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-text-secondary">
          <AlertCircle className="h-5 w-5 text-red-500" aria-hidden="true" />
          <div>
            <p className="font-medium text-text-primary">Workbook failed to load</p>
            <p className="mt-1 max-w-sm break-words">{error}</p>
          </div>
          {onRetry && (
            <button
              type="button"
              aria-label="Retry workbook"
              className="flex h-9 items-center gap-2 rounded border border-border-light px-3 text-sm text-text-primary hover:bg-surface-hover"
              onClick={onRetry}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry workbook
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center text-sm text-text-secondary">
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {isLoading ? 'Workbook loading' : 'No workbook yet'}
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface-primary">
      <header className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-primary">報價 Workbook</h2>
          <p className="mt-0.5 text-xs text-text-secondary">v{workbook.version}</p>
        </div>
        {onDownload && (
          <button
            type="button"
            aria-label="Download XLSX"
            disabled={isDownloading || exportSheetIds.length === 0}
            className="flex h-9 items-center gap-2 rounded border border-border-light px-3 text-sm text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onDownload}
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            Download XLSX
          </button>
        )}
      </header>

      {downloadError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-500">
          {downloadError}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border-light px-3 py-2">
        {visibleSheets.map((sheet) => (
          <div
            key={sheet.id}
            className={`flex items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-sm transition-colors ${
              activeSheet?.id === sheet.id
                ? 'bg-surface-active-alt text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {onToggleExportSheet && (
              <input
                type="checkbox"
                aria-label={`Export ${sheet.id}`}
                checked={exportSheetIds.includes(sheet.id)}
                className="h-3.5 w-3.5"
                onChange={() => onToggleExportSheet(sheet.id)}
              />
            )}
            <button type="button" onClick={() => setActiveSheetId(sheet.id)}>
              {getWorkbookSheetLabel(sheet)}
            </button>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {activeSheet && (
          <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
            <thead className="sticky top-0 z-[1] bg-surface-primary">
              <tr>
                {activeSheet.columns.map((column) => (
                  <th
                    key={column.key}
                    className="min-w-[9rem] max-w-[18rem] border-b border-border-light px-3 py-2 font-medium text-text-secondary"
                    style={column.widthPx ? { minWidth: column.widthPx } : undefined}
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
                  {activeSheet.columns.map((column) => {
                    const changed = changedKeys.has(
                      pathKey({
                        sheetId: activeSheet.id,
                        rowId: row.id,
                        columnKey: column.key,
                      }),
                    );
                    return (
                      <td
                        key={column.key}
                        className={`max-w-[18rem] border-b border-border-light px-3 py-2 align-top text-text-primary ${
                          changed ? 'bg-yellow-200/50 dark:bg-yellow-500/20' : ''
                        }`}
                      >
                        <span
                          className="line-clamp-2 break-words"
                          title={cellText(row.cells[column.key])}
                        >
                          {cellText(row.cells[column.key])}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
});

export default SteelWorkbookPreview;
