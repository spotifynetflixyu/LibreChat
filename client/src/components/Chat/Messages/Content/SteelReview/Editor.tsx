import { memo } from 'react';
import { steelPriceCategories, isSteelReviewSourceAssociationHeader } from 'librechat-data-provider';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@librechat/client';
import type { SteelReviewRow, SteelReviewSource, SteelReviewSourceFile, SteelReviewTable } from 'librechat-data-provider';
import type { SteelProcessingMeasurement } from 'librechat-data-provider';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import type { SteelMeasurementLabels } from './Measurement';
import type { SteelReviewDraftState } from './session';
import { getSteelReviewDraftCell, getSteelReviewDraftMeasurement } from './session';
import SteelReviewMeasurement from './Measurement';

export interface SteelReviewEditorLabels {
  table: string;
  readonly: string;
  emptyCategory: string;
  changeSource: string;
  sourceFile: string;
  sourcePage: string;
  sourceNoPage: string;
  clearSource: string;
  sourceActions: string;
  sourcePageLoading: string;
  sourcePageUnavailable: string;
  sourcePageRetry: string;
  deleteRow?: string;
  restoreRow?: string;
  bindProcessing?: string;
  parent?: string;
  deleteGroup?: string;
  addProcessingUnder?: string;
  classify?: string;
  material?: string;
  processing?: string;
  rowActions?: string;
  measurement?: SteelMeasurementLabels;
}

export interface SteelReviewEditorProps {
  table: SteelReviewTable;
  rows: readonly SteelReviewRow[];
  draft: SteelReviewDraftState;
  labels: SteelReviewEditorLabels;
  onCellChange: (row: SteelReviewRow, header: string, value: string) => void;
  onCellHistoryBoundary?: () => void;
  onMeasurementChange?: (row: SteelReviewRow, measurement: SteelProcessingMeasurement | null) => void;
  canEdit?: boolean;
  sources?: readonly SteelReviewSourceFile[];
  sourceCorrectionRowId?: string;
  sourcePageCount?: number;
  sourcePageCountLoading?: boolean;
  sourcePageCountError?: boolean;
  onSourcePageRetry?: () => void;
  onSourceEdit?: (row: SteelReviewRow) => void;
  onSourceChange?: (row: SteelReviewRow, source: SteelReviewSource | null) => void;
  onDeleteRow?: (row: SteelReviewRow) => void;
  onRestoreRow?: (row: SteelReviewRow) => void;
  onSystemChange?: (row: SteelReviewRow, parentRowId: string | null) => void;
  onClassify?: (row: SteelReviewRow, kind: 'material' | 'processing') => void;
  onDeleteGroup?: (row: SteelReviewRow) => void;
  onAddProcessingUnder?: (row: SteelReviewRow) => void;
  systemMaterials?: readonly SteelReviewRow[];
}

export function isSteelReviewCellEditable(table: SteelReviewTable, header: string): boolean {
  if (!table.isLatest || table.readOnly || isSteelReviewSourceAssociationHeader(header)) {
    return false;
  }
  if (table.kind === 'system_order') {
    return true;
  }
  return table.kind === 'ocr_result';
}

function displayCellValue(value: string | null | undefined): string {
  return value ?? '';
}

const CLEAR_SOURCE_VALUE = '__steel_review_clear_source__';
const NO_SOURCE_PAGE_VALUE = '__steel_review_no_source_page__';
const EMPTY_CATEGORY_VALUE = '__steel_review_empty_category__';

function sourceLabel(source: SteelReviewSource | null | undefined): string {
  return source?.filename ?? source?.fileId ?? '';
}

function canRestoreSteelReviewRow(
  row: SteelReviewRow,
  systemMaterials: readonly SteelReviewRow[],
): boolean {
  if (!row.deleted || row.system?.kind !== 'processing') {
    return Boolean(row.deleted);
  }
  if (row.system.cascadeDeletedBy !== null && row.system.cascadeDeletedBy !== undefined) {
    return false;
  }
  if (!row.system.parentRowId) {
    return true;
  }
  return systemMaterials.some((candidate) => candidate.rowId === row.system?.parentRowId &&
    !candidate.deleted && candidate.system?.kind === 'material');
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
  canEdit,
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
  canEdit: boolean;
}) {
  const editable = Boolean(
    row.rowId &&
    !row.deleted &&
    sourceCorrectionRowId === row.rowId &&
    canEdit &&
    (table.kind === 'ocr_result' || (table.kind === 'system_order' && row.system?.kind === 'material')) &&
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
  let pageControl: ReactNode;
  if (!source) {
    pageControl = null;
  } else if (sourcePageCountLoading && !pageCount) {
    pageControl = <span role="status">{labels.sourcePageLoading}</span>;
  } else if (sourcePageCountError && !pageCount) {
    pageControl = (
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
    );
  } else {
    pageControl = (
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
        <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
          <SelectItem value={NO_SOURCE_PAGE_VALUE}>{labels.sourceNoPage}</SelectItem>
          {pageValues.map((page) => (
            <SelectItem key={page} value={String(page)}>{page}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (!editable) {
    return (
      <td className="border-b border-border-light px-3 py-2 align-top">
        <div className="flex min-w-40 items-center gap-2">
          <span aria-label={`${labels.sourceFile}: ${sourceLabel(source) || labels.readonly}`}>
            {sourceLabel(source) || labels.readonly}
          </span>
          {canEdit && onSourceEdit && row.rowId && !row.deleted &&
            (table.kind === 'ocr_result' || (table.kind === 'system_order' && row.system?.kind === 'material')) &&
            table.isLatest && !table.readOnly && (
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
            <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
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
            {pageControl}
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
  emptyCategoryLabel,
  onCellChange,
  onCellHistoryBoundary,
  canEdit = true,
}: {
  table: SteelReviewTable;
  row: SteelReviewRow;
  header: string;
  draft: SteelReviewDraftState;
  readonlyLabel: string;
  emptyCategoryLabel: string;
  onCellChange: SteelReviewEditorProps['onCellChange'];
  onCellHistoryBoundary?: SteelReviewEditorProps['onCellHistoryBoundary'];
  canEdit: boolean;
}) {
  const cell = row.values[header];
  if (!cell) {
    return <td className="border-b border-border-light px-3 py-2 align-top" />;
  }

  const draftValue = row.rowId ? getSteelReviewDraftCell(draft, row.rowId, header) : undefined;
  const currentValue = draftValue ?? displayCellValue(cell.effective);
  const changed = displayCellValue(cell.baseline) !== currentValue;
  const editable = Boolean(row.rowId) && canEdit && !row.deleted && isSteelReviewCellEditable(table, header);
  const deletedValue = row.deleted && row.origin !== 'manual'
    ? <del className="text-text-secondary">{displayCellValue(cell.baseline)}</del>
    : null;
  const previousValue = !row.deleted && changed && cell.baseline !== null && cell.baseline !== undefined
    ? <del className="mr-2 text-text-secondary">{cell.baseline}</del>
    : null;
  let editorContent: ReactNode = null;
  if (!row.deleted && editable && table.kind === 'system_order' && header === '類別') {
    const categoryOptions = [...new Set([...steelPriceCategories, cell.baseline ?? '', currentValue])]
      .filter((category) => category !== '');
    editorContent = (
      <Select
        value={currentValue || EMPTY_CATEGORY_VALUE}
        onValueChange={(value) => {
          onCellChange(row, header, value === EMPTY_CATEGORY_VALUE ? '' : value);
          onCellHistoryBoundary?.();
        }}
      >
        <SelectTrigger aria-label={`${header} ${row.rowId}`} className="min-w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
          <SelectItem value={EMPTY_CATEGORY_VALUE}>{emptyCategoryLabel}</SelectItem>
          {categoryOptions.map((category) => (
            <SelectItem key={category} value={category}>{category}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (!row.deleted && editable) {
    editorContent = (
      <Input
        aria-label={`${header} ${row.rowId}`}
        className="min-w-24"
        value={currentValue}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onCellChange(row, header, event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onCellHistoryBoundary?.();
            event.currentTarget.blur();
          }
        }}
        onBlur={onCellHistoryBoundary}
      />
    );
  } else if (!row.deleted) {
    editorContent = <span aria-label={`${header}: ${readonlyLabel}`}>{currentValue}</span>;
  }

  return (
    <td className="border-b border-border-light px-3 py-2 align-top">
      {deletedValue}
      {previousValue}
      {editorContent}
    </td>
  );
}

const SteelReviewEditor = memo(function SteelReviewEditor({
  table,
  rows,
  draft,
  labels,
  onCellChange,
  onCellHistoryBoundary,
  canEdit = true,
  sources = [],
  sourceCorrectionRowId,
  sourcePageCount,
  sourcePageCountLoading = false,
  sourcePageCountError = false,
  onSourcePageRetry,
  onSourceEdit,
  onSourceChange,
  onDeleteRow,
  onRestoreRow,
  onSystemChange,
  onClassify,
  onDeleteGroup,
  onAddProcessingUnder,
  onMeasurementChange,
  systemMaterials = rows,
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
            {(onDeleteRow || onRestoreRow || onSystemChange || onDeleteGroup || onAddProcessingUnder || onMeasurementChange) && (
              <th scope="col" className="border-b border-border-light px-3 py-2 text-left font-semibold">
                {labels.rowActions}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.rowId || `ephemeral-${rowIndex}`} className={row.deleted ? 'opacity-70' : undefined}>
              {table.headers.map((header) => (
                <ReviewCell
                  key={`${row.rowId || `ephemeral-${rowIndex}`}-${header}`}
                  table={table}
                  row={row}
                  header={header}
                  draft={draft}
                  readonlyLabel={labels.readonly}
                  emptyCategoryLabel={labels.emptyCategory}
                  onCellChange={onCellChange}
                  onCellHistoryBoundary={onCellHistoryBoundary}
                  canEdit={canEdit}
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
                  canEdit={canEdit}
                />
              )}
              {(onDeleteRow || onRestoreRow || onSystemChange || onDeleteGroup || onAddProcessingUnder) && (
                <td className="border-b border-border-light px-3 py-2 align-top">
                  {row.system?.kind === 'processing' && !row.deleted && onSystemChange && (
                    <label className="mb-2 flex flex-col gap-1 text-xs text-text-secondary">
                      <span>{labels.parent ?? labels.bindProcessing}</span>
                      <Select
                        value={row.system.parentRowId ?? ''}
                        onValueChange={(value) => onSystemChange(row, value || null)}
                      >
                        <SelectTrigger aria-label={`${labels.bindProcessing} ${row.rowId}`}>
                          <SelectValue placeholder={labels.bindProcessing} />
                        </SelectTrigger>
                        <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                          {systemMaterials.filter((candidate) => !candidate.deleted && candidate.system?.kind === 'material').map((candidate) => {
                            const name = Object.values(candidate.values).find((cell) => (cell.effective ?? '').trim())?.effective ?? candidate.rowId;
                            return <SelectItem key={candidate.rowId} value={candidate.rowId}>{name}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                  {row.system?.kind === 'processing' && !row.deleted && onMeasurementChange && labels.measurement && (
                    <SteelReviewMeasurement
                      rowId={row.rowId}
                      rowUnit={row.values['單位']?.effective ?? ''}
                      measurement={getSteelReviewDraftMeasurement(draft, row.rowId) === undefined
                        ? row.calculation?.measurement ?? null
                        : getSteelReviewDraftMeasurement(draft, row.rowId)}
                      labels={labels.measurement}
                      canEdit={canEdit}
                      onChange={(measurement) => onMeasurementChange(row, measurement)}
                      onHistoryBoundary={onCellHistoryBoundary}
                    />
                  )}
                  {row.system?.kind === 'unassigned' && !row.deleted && onClassify && (
                    <Select value="" onValueChange={(value) => onClassify(row, value as 'material' | 'processing')}>
                      <SelectTrigger aria-label={`${labels.classify} ${row.rowId}`}>
                        <SelectValue placeholder={labels.classify} />
                      </SelectTrigger>
                      <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                        <SelectItem value="material">{labels.material}</SelectItem>
                        <SelectItem value="processing">{labels.processing}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {row.system?.kind === 'material' && !row.deleted && (
                    <>
                      {onAddProcessingUnder && (
                        <Button
                          type="button"
                          variant="outline"
                          className="mb-2"
                          aria-label={`${labels.addProcessingUnder} ${row.rowId}`}
                          onClick={() => onAddProcessingUnder(row)}
                        >
                          {labels.addProcessingUnder}
                        </Button>
                      )}
                      {onDeleteGroup && (
                        <Button
                          type="button"
                          variant="outline"
                          className="mb-2"
                          aria-label={`${labels.deleteGroup} ${row.rowId}`}
                          onClick={() => onDeleteGroup(row)}
                        >
                          {labels.deleteGroup}
                        </Button>
                      )}
                    </>
                  )}
                  {row.deleted && canRestoreSteelReviewRow(row, systemMaterials) && (
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`${labels.restoreRow} ${row.rowId}`}
                      onClick={() => onRestoreRow?.(row)}
                    >
                      {labels.restoreRow}
                    </Button>
                  )}
                  {!row.deleted && (!row.system || row.system.kind !== 'material' || !onDeleteGroup) && (
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`${labels.deleteRow} ${row.rowId}`}
                      onClick={() => onDeleteRow?.(row)}
                    >
                      {labels.deleteRow}
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default SteelReviewEditor;
