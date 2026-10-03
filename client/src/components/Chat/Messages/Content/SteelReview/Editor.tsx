import { memo } from 'react';
import { isSteelReviewSourceAssociationHeader } from 'librechat-data-provider';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@librechat/client';
import type { SteelReviewRow, SteelReviewSource, SteelReviewSourceFile, SteelReviewTable } from 'librechat-data-provider';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { SteelReviewDraftState } from './session';
import { getSteelReviewDraftCell } from './session';

export interface SteelReviewEditorLabels {
  table: string;
  readonly: string;
  changeSource: string;
  sourceFile: string;
  sourcePage: string;
  sourceNoPage: string;
  clearSource: string;
  sourceActions: string;
  sourcePageLoading: string;
  sourcePageUnavailable: string;
  sourcePageRetry: string;
}

export interface SteelReviewEditorProps {
  table: SteelReviewTable;
  rows: readonly SteelReviewRow[];
  draft: SteelReviewDraftState;
  labels: SteelReviewEditorLabels;
  onCellChange: (row: SteelReviewRow, header: string, value: string) => void;
  sources?: readonly SteelReviewSourceFile[];
  sourceCorrectionRowId?: string;
  sourcePageCount?: number;
  sourcePageCountLoading?: boolean;
  sourcePageCountError?: boolean;
  onSourcePageRetry?: () => void;
  onSourceEdit?: (row: SteelReviewRow) => void;
  onSourceChange?: (row: SteelReviewRow, source: SteelReviewSource | null) => void;
}

export function isSteelReviewCellEditable(table: SteelReviewTable, header: string): boolean {
  return table.kind === 'ocr_result' && table.isLatest && !table.readOnly &&
    !isSteelReviewSourceAssociationHeader(header);
}

function displayCellValue(value: string | null | undefined): string {
  return value ?? '';
}

const CLEAR_SOURCE_VALUE = '__steel_review_clear_source__';
const NO_SOURCE_PAGE_VALUE = '__steel_review_no_source_page__';

function sourceLabel(source: SteelReviewSource | null | undefined): string {
  return source?.filename ?? source?.fileId ?? '';
}

function SourceCell({
  table,
  row,
  labels,
  sources,
  sourceCorrectionRowId,
  sourcePageCount,
  sourcePageCountLoading,
  sourcePageCountError,
  onSourcePageRetry,
  onSourceEdit,
  onSourceChange,
}: {
  table: SteelReviewTable;
  row: SteelReviewRow;
  labels: SteelReviewEditorLabels;
  sources: readonly SteelReviewSourceFile[];
  sourceCorrectionRowId?: string;
  sourcePageCount?: number;
  sourcePageCountLoading?: boolean;
  sourcePageCountError?: boolean;
  onSourcePageRetry?: () => void;
  onSourceEdit?: (row: SteelReviewRow) => void;
  onSourceChange?: (row: SteelReviewRow, source: SteelReviewSource | null) => void;
}) {
  const editable = Boolean(
    row.rowId &&
    sourceCorrectionRowId === row.rowId &&
    table.kind === 'ocr_result' &&
    table.isLatest &&
    !table.readOnly &&
    onSourceChange,
  );
  const source = row.source;
  const selectedFile = source ? sources.find((candidate) => candidate.fileId === source.fileId) : undefined;
  const pageCount = selectedFile?.mediaType.startsWith('image/')
    ? 1
    : sourcePageCount;
  const pageValues = pageCount && pageCount > 0
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : [];

  if (!editable) {
    return (
      <td className="border-b border-border-light px-3 py-2 align-top">
        <div className="flex min-w-40 items-center gap-2">
          <span aria-label={`${labels.sourceFile}: ${sourceLabel(source) || labels.readonly}`}>
            {sourceLabel(source) || labels.readonly}
          </span>
          {onSourceEdit && row.rowId && table.kind === 'ocr_result' && table.isLatest && !table.readOnly && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              aria-label={`${labels.changeSource} ${row.rowId}`}
              onClick={() => onSourceEdit(row)}
            >
              {labels.changeSource}
            </Button>
          )}
        </div>
      </td>
    );
  }

  return (
    <td className="border-b border-border-light px-3 py-2 align-top">
      <div className="flex min-w-64 flex-col gap-2" aria-label={labels.sourceActions}>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          <span>{labels.sourceFile}</span>
          <Select
            value={source?.fileId ?? CLEAR_SOURCE_VALUE}
            onValueChange={(value) => {
              if (value === CLEAR_SOURCE_VALUE) {
                onSourceChange?.(row, null);
                return;
              }
              const next = sources.find((candidate) => candidate.fileId === value);
              if (!next) {
                return;
              }
              onSourceChange?.(row, {
                fileId: next.fileId,
                pageNumber: null,
                filename: next.filename,
                mediaType: next.mediaType,
              });
            }}
          >
            <SelectTrigger aria-label={labels.sourceFile}>
              <SelectValue placeholder={labels.sourceFile} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CLEAR_SOURCE_VALUE}>{labels.clearSource}</SelectItem>
              {sources.map((candidate) => (
                <SelectItem key={candidate.fileId} value={candidate.fileId}>
                  {candidate.filename}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {source && (
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            <span>{labels.sourcePage}</span>
            {sourcePageCountLoading && !pageCount ? (
              <span role="status">{labels.sourcePageLoading}</span>
            ) : sourcePageCountError && !pageCount ? (
              <div className="flex items-center gap-2" role="alert">
                <span>{labels.sourcePageUnavailable}</span>
                {onSourcePageRetry && (
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={labels.sourcePageRetry}
                    onClick={onSourcePageRetry}
                  >
                    {labels.sourcePageRetry}
                  </Button>
                )}
              </div>
            ) : (
              <Select
                value={source.pageNumber === null ? NO_SOURCE_PAGE_VALUE : String(source.pageNumber)}
                onValueChange={(value) => onSourceChange?.(row, {
                  ...source,
                  pageNumber: value === NO_SOURCE_PAGE_VALUE ? null : Number(value),
                })}
              >
                <SelectTrigger aria-label={labels.sourcePage}>
                  <SelectValue placeholder={labels.sourceNoPage} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SOURCE_PAGE_VALUE}>{labels.sourceNoPage}</SelectItem>
                  {pageValues.map((page) => (
                    <SelectItem key={page} value={String(page)}>{page}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </label>
        )}
      </div>
    </td>
  );
}

function ReviewCell({
  table,
  row,
  header,
  draft,
  readonlyLabel,
  onCellChange,
}: {
  table: SteelReviewTable;
  row: SteelReviewRow;
  header: string;
  draft: SteelReviewDraftState;
  readonlyLabel: string;
  onCellChange: SteelReviewEditorProps['onCellChange'];
}) {
  const cell = row.values[header];
  if (!cell) {
    return <td className="border-b border-border-light px-3 py-2 align-top" />;
  }

  const draftValue = row.rowId ? getSteelReviewDraftCell(draft, row.rowId, header) : undefined;
  const currentValue = draftValue ?? displayCellValue(cell.effective);
  const changed = displayCellValue(cell.baseline) !== currentValue;
  const editable = Boolean(row.rowId) && isSteelReviewCellEditable(table, header);

  return (
    <td className="border-b border-border-light px-3 py-2 align-top">
      {changed && cell.baseline !== null && cell.baseline !== undefined && (
        <del className="mr-2 text-text-secondary">{cell.baseline}</del>
      )}
      {editable ? (
        <Input
          aria-label={`${header} ${row.rowId}`}
          className="min-w-24"
          value={currentValue}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onCellChange(row, header, event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span aria-label={`${header}: ${readonlyLabel}`}>{currentValue}</span>
      )}
    </td>
  );
}

const SteelReviewEditor = memo(function SteelReviewEditor({
  table,
  rows,
  draft,
  labels,
  onCellChange,
  sources = [],
  sourceCorrectionRowId,
  sourcePageCount,
  sourcePageCountLoading = false,
  sourcePageCountError = false,
  onSourcePageRetry,
  onSourceEdit,
  onSourceChange,
}: SteelReviewEditorProps) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border border-border-light">
      <table className="min-w-full border-collapse text-sm" aria-label={labels.table}>
        <thead className="bg-surface-secondary">
          <tr>
            {table.headers.map((header) => (
              <th key={header} scope="col" className="border-b border-border-light px-3 py-2 text-left font-semibold">
                {header}
              </th>
            ))}
            {onSourceChange && (
              <th scope="col" className="border-b border-border-light px-3 py-2 text-left font-semibold">
                {labels.sourceActions}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.rowId || `ephemeral-${rowIndex}`}>
              {table.headers.map((header) => (
                <ReviewCell
                  key={`${row.rowId || `ephemeral-${rowIndex}`}-${header}`}
                  table={table}
                  row={row}
                  header={header}
                  draft={draft}
                  readonlyLabel={labels.readonly}
                  onCellChange={onCellChange}
                />
              ))}
              {onSourceChange && (
                <SourceCell
                  table={table}
                  row={row}
                  labels={labels}
                  sources={sources}
                  sourceCorrectionRowId={sourceCorrectionRowId}
                  sourcePageCount={sourcePageCount}
                  sourcePageCountLoading={sourcePageCountLoading}
                  sourcePageCountError={sourcePageCountError}
                  onSourcePageRetry={onSourcePageRetry}
                  onSourceEdit={onSourceEdit}
                  onSourceChange={onSourceChange}
                />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default SteelReviewEditor;
