import { memo, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import type { SteelChangedPath, SteelWorkbook, SteelWorkbookSheet } from 'librechat-data-provider';

interface SteelWorkbookPreviewProps {
  workbook: SteelWorkbook | null;
  changedPaths: SteelChangedPath[];
  error?: string | null;
  isLoading?: boolean;
  onRetry?: () => void;
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
  workbook: SteelWorkbook | null,
  activeSheetId: string | null,
): SteelWorkbookSheet | null {
  if (!workbook) {
    return null;
  }

  return workbook.sheets.find((sheet) => sheet.id === activeSheetId) ?? workbook.sheets[0] ?? null;
}

function getWorkbookSheetLabel(sheet: SteelWorkbookSheet): string {
  return sheet.id === 'manual_review' ? '人工複核' : sheet.label;
}

const SteelWorkbookPreview = memo(function SteelWorkbookPreview({
  workbook,
  changedPaths,
  error = null,
  isLoading = false,
  onRetry,
}: SteelWorkbookPreviewProps) {
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const changedKeys = useMemo(() => new Set(changedPaths.map(pathKey)), [changedPaths]);
  const activeSheet = getActiveSheet(workbook, activeSheetId);

  useEffect(() => {
    if (!workbook) {
      setActiveSheetId(null);
      return;
    }
    if (!activeSheetId || !workbook.sheets.some((sheet) => sheet.id === activeSheetId)) {
      setActiveSheetId(workbook.sheets[0]?.id ?? null);
    }
  }, [activeSheetId, workbook]);

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
        Workbook loading
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
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-border-light px-3 py-2">
        {workbook.sheets.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            onClick={() => setActiveSheetId(sheet.id)}
            className={`whitespace-nowrap rounded px-3 py-1.5 text-sm transition-colors ${
              activeSheet?.id === sheet.id
                ? 'bg-surface-active-alt text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {getWorkbookSheetLabel(sheet)}
          </button>
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
                    className="border-b border-border-light px-3 py-2 font-medium text-text-secondary"
                    style={column.widthPx ? { minWidth: column.widthPx } : undefined}
                  >
                    {column.label}
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
                        className={`border-b border-border-light px-3 py-2 text-text-primary ${
                          changed ? 'bg-yellow-200/50 dark:bg-yellow-500/20' : ''
                        }`}
                      >
                        {cellText(row.cells[column.key])}
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
