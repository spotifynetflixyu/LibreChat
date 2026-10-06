import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import { steelPriceCategories } from 'librechat-data-provider';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, TooltipAnchor } from '@librechat/client';
import type {
  SteelCatalogCandidate,
  SteelCatalogCustomerEvidence,
  SteelProcessingMeasurement,
  SteelReviewRow,
  SteelReviewTable,
} from 'librechat-data-provider';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import type { SteelMeasurementLabels } from './Measurement';
import type { SteelReviewDraftState } from './session';
import { getSteelReviewDraftCell, getSteelReviewDraftMeasurement } from './session';
import SteelReviewMeasurement from './Measurement';
import SteelReviewSelector from './Selector';
import { getSteelReviewMode } from './mode';

export interface SteelReviewEditorLabels {
  table: string;
  readonly: string;
  emptyCategory: string;
  action: string;
  deleteRow?: string;
  restoreRow?: string;
  bind?: string;
  bound?: string;
  classify?: string;
  material?: string;
  processing?: string;
  measurement?: SteelMeasurementLabels;
}

export interface SteelReviewEditorProps {
  table: SteelReviewTable;
  rows: readonly SteelReviewRow[];
  draft: SteelReviewDraftState;
  labels: SteelReviewEditorLabels;
  onCellChange: (row: SteelReviewRow, header: string, value: string) => void;
  onMeasurementChange?: (row: SteelReviewRow, measurement: SteelProcessingMeasurement | null) => void;
  onCandidateChange?: (row: SteelReviewRow, candidate: SteelCatalogCandidate, customer: SteelCatalogCustomerEvidence) => void;
  canEdit?: boolean;
  onSourceEdit?: (row: SteelReviewRow) => void;
  onDeleteRow?: (row: SteelReviewRow) => void;
  onRestoreRow?: (row: SteelReviewRow) => void;
  onClassify?: (row: SteelReviewRow, kind: 'material' | 'processing') => void;
  onDeleteGroup?: (row: SteelReviewRow) => void;
  systemMaterials?: readonly SteelReviewRow[];
}

export function isSteelReviewCellEditable(table: SteelReviewTable, header: string): boolean {
  return table.isLatest && !table.readOnly && getSteelReviewMode(table.kind).isEditableHeader(header);
}

function displayCellValue(value: string | null | undefined): string {
  return value ?? '';
}

const EMPTY_CATEGORY_VALUE = '__steel_review_empty_category__';

function canRestoreSteelReviewRow(row: SteelReviewRow, systemMaterials: readonly SteelReviewRow[]): boolean {
  if (!row.deleted || row.system?.kind !== 'processing') return Boolean(row.deleted);
  if (row.system.cascadeDeletedBy !== null && row.system.cascadeDeletedBy !== undefined) return false;
  if (!row.system.parentRowId) return true;
  return systemMaterials.some((candidate) => candidate.rowId === row.system?.parentRowId &&
    !candidate.deleted && candidate.system?.kind === 'material');
}

function ReviewActionButton({ label, rowId, onClick, children, linked = false, danger = false }: {
  label: string;
  rowId: string;
  onClick: () => void;
  children: ReactNode;
  linked?: boolean;
  danger?: boolean;
}) {
  return <TooltipAnchor description={label} side="top" render={
    <Button type="button" size="icon-sm" variant={linked ? 'default' : 'outline'} className={danger ? 'hover:border-status-error-border hover:bg-status-error-subtle hover:text-text-destructive' : undefined} aria-label={`${label} ${rowId}`} onClick={onClick}>
      {children}
    </Button>
  } />;
}

function ReviewCell({
  table,
  row,
  header,
  draft,
  labels,
  onCellChange,
  onCandidateChange,
  parent,
  canEdit,
}: {
  table: SteelReviewTable;
  row: SteelReviewRow;
  header: string;
  draft: SteelReviewDraftState;
  labels: SteelReviewEditorLabels;
  onCellChange: SteelReviewEditorProps['onCellChange'];
  onCandidateChange?: SteelReviewEditorProps['onCandidateChange'];
  parent?: SteelReviewRow;
  canEdit: boolean;
}) {
  const [remarkEditing, setRemarkEditing] = useState(false);
  const [remarkValue, setRemarkValue] = useState('');
  const mode = getSteelReviewMode(table.kind);
  const deferRemark = mode.defersHeader(header);
  const cell = row.values[header];
  if (!cell) return <td className="min-h-16 border-b border-border-light px-3 py-2 align-top" />;
  const draftValue = row.rowId ? getSteelReviewDraftCell(draft, row.rowId, header) : undefined;
  const currentValue = draftValue ?? displayCellValue(cell.effective);
  const changed = displayCellValue(cell.baseline) !== currentValue;
  const editable = Boolean(row.rowId) && canEdit && !row.deleted && isSteelReviewCellEditable(table, header);
  const previousValue = !row.deleted && changed && cell.baseline !== null && cell.baseline !== undefined
    ? <del className="mr-2 text-text-secondary">{cell.baseline}</del>
    : null;
  let editorContent: ReactNode = null;
  if (!row.deleted && mode.usesCatalog(row, header) && onCandidateChange) {
    editorContent = <SteelReviewSelector table={table} row={row} parent={parent} header={header} value={currentValue}
      canEdit={editable && (row.system?.kind !== 'processing' || Boolean(parent && !parent.deleted && parent.system?.kind === 'material'))}
      onSelect={onCandidateChange} />;
  } else if (!row.deleted && editable && mode.usesCategoryMenu(header)) {
    const categoryOptions = [...new Set([...steelPriceCategories, cell.baseline ?? '', currentValue])].filter(Boolean);
    editorContent = (
      <Select value={currentValue || EMPTY_CATEGORY_VALUE} onValueChange={(value) => {
        onCellChange(row, header, value === EMPTY_CATEGORY_VALUE ? '' : value);
      }}>
        <SelectTrigger aria-label={`${header} ${row.rowId}`} className="min-w-24"><SelectValue /></SelectTrigger>
        <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
          <SelectItem value={EMPTY_CATEGORY_VALUE}>{labels.emptyCategory}</SelectItem>
          {categoryOptions.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  } else if (!row.deleted && editable) {
    editorContent = (
      <Input
        aria-label={`${header} ${row.rowId}`}
        data-steel-review-deferred={deferRemark || undefined}
        className="min-w-24"
        value={deferRemark && remarkEditing ? remarkValue : currentValue}
        onFocus={() => {
          if (!deferRemark) return;
          setRemarkValue(currentValue);
          setRemarkEditing(true);
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          if (deferRemark) {
            setRemarkValue(event.target.value);
            setRemarkEditing(true);
          } else onCellChange(row, header, event.target.value);
        }}
        onBlur={(event) => {
          if (!deferRemark) return;
          setRemarkEditing(false);
          onCellChange(row, header, event.target.value);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    );
  } else if (!row.deleted) {
    editorContent = <span aria-label={`${header}: ${labels.readonly}`}>{currentValue}</span>;
  } else {
    editorContent = <del className="text-text-secondary">{displayCellValue(cell.baseline)}</del>;
  }
  return <td className="min-h-16 border-b border-border-light px-3 py-2 align-top">{previousValue}{editorContent}</td>;
}

const SteelReviewEditor = memo(function SteelReviewEditor({
  table,
  rows,
  draft,
  labels,
  onCellChange,
  canEdit = true,
  onSourceEdit,
  onDeleteRow,
  onRestoreRow,
  onClassify,
  onDeleteGroup,
  onMeasurementChange,
  onCandidateChange,
  systemMaterials = rows,
}: SteelReviewEditorProps) {
  const materialById = useMemo(() => new Map(systemMaterials.map((material) => [material.rowId, material])), [systemMaterials]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const seenManualRows = useRef(new Set(rows.filter((row) => row.origin === 'manual').map((row) => row.rowId)));
  const showActions = Boolean(onSourceEdit || onDeleteRow || onRestoreRow || onDeleteGroup || onMeasurementChange || onClassify);

  useEffect(() => {
    const manualRows = rows.filter((row) => row.origin === 'manual' && !row.deleted && row.rowId);
    const newest = manualRows.find((row) => !seenManualRows.current.has(row.rowId));
    manualRows.forEach((row) => seenManualRows.current.add(row.rowId));
    if (!newest) return;
    const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(newest.rowId) : newest.rowId.replace(/"/gu, '\\"');
    const rowElement = viewportRef.current?.querySelector<HTMLElement>(`tr[data-row-id="${escapedId}"]`);
    rowElement?.scrollIntoView({ block: 'nearest' });
    const businessSelector = showActions
      ? 'td:not(:first-child) input,td:not(:first-child) textarea,td:not(:first-child) [role="combobox"]'
      : 'td input,td textarea,td [role="combobox"]';
    rowElement?.querySelector<HTMLElement>(businessSelector)?.focus();
  }, [rows, showActions]);

  return (
    <div ref={viewportRef} className="h-44 min-h-44 max-h-44 min-w-0 shrink-0 overflow-auto rounded-md border border-border-light">
      <table className="min-w-full border-collapse text-sm" aria-label={labels.table}>
        <thead className="sticky top-0 z-10 bg-surface-secondary">
          <tr>
            {showActions && <th scope="col" className="border-b border-border-light whitespace-nowrap px-3 py-2 text-left font-semibold">{labels.action}</th>}
            {table.headers.map((header) => (
              <th key={header} scope="col" className="border-b border-border-light whitespace-nowrap px-3 py-2 text-left font-semibold">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const rowKey = row.rowId || `ephemeral-${rowIndex}`;
            const parent = row.system?.parentRowId ? materialById.get(row.system.parentRowId) : undefined;
            const bindable = Boolean(onSourceEdit && row.rowId && !row.deleted && row.system?.kind !== 'processing' && canEdit);
            const bound = Boolean(row.source?.fileId && row.source.pageNumber !== null);
            return (
              <tr key={rowKey} data-row-id={row.rowId || undefined} className={row.deleted ? 'opacity-70' : undefined}>
                {showActions && (
                  <td className="min-h-16 border-b border-border-light px-3 py-2 align-top">
                    <div className="flex min-w-20 flex-wrap items-start gap-1">
                      {bindable && (
                        <ReviewActionButton linked={bound} label={(bound ? labels.bound : labels.bind) ?? labels.action} rowId={row.rowId} onClick={() => onSourceEdit?.(row)}>
                          <Link2 className="size-4" aria-hidden="true" />
                        </ReviewActionButton>
                      )}
                      {row.system?.kind === 'processing' && !row.deleted && onMeasurementChange && labels.measurement && (
                        <SteelReviewMeasurement
                          rowId={row.rowId}
                          rowUnit={row.values['單位']?.effective ?? ''}
                          measurement={getSteelReviewDraftMeasurement(draft, row.rowId) === undefined ? row.calculation?.measurement ?? null : getSteelReviewDraftMeasurement(draft, row.rowId)}
                          labels={labels.measurement}
                          canEdit={canEdit}
                          onChange={(measurement) => onMeasurementChange(row, measurement)}
                        />
                      )}
                      {row.system?.kind === 'unassigned' && !row.deleted && onClassify && (
                        <Select value="" onValueChange={(value) => onClassify(row, value as 'material' | 'processing')}>
                          <SelectTrigger className="min-w-24" aria-label={`${labels.classify} ${row.rowId}`}><SelectValue placeholder={labels.classify} /></SelectTrigger>
                          <SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>
                            <SelectItem value="material">{labels.material}</SelectItem>
                            <SelectItem value="processing">{labels.processing}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {row.system?.kind === 'material' && !row.deleted && onDeleteGroup && (
                        <ReviewActionButton danger label={labels.deleteRow ?? labels.action} rowId={row.rowId} onClick={() => onDeleteGroup(row)}><Trash2 className="size-4" aria-hidden="true" /></ReviewActionButton>
                      )}
                      {row.deleted && onRestoreRow && canRestoreSteelReviewRow(row, systemMaterials) && (
                        <Button type="button" size="sm" variant="outline" className="shrink-0" aria-label={`${labels.restoreRow} ${row.rowId}`} onClick={() => onRestoreRow(row)}>{labels.restoreRow}</Button>
                      )}
                      {!row.deleted && onDeleteRow && (!row.system || row.system.kind !== 'material' || !onDeleteGroup) && (
                        <ReviewActionButton danger label={labels.deleteRow ?? labels.action} rowId={row.rowId} onClick={() => onDeleteRow(row)}><Trash2 className="size-4" aria-hidden="true" /></ReviewActionButton>
                      )}
                    </div>
                  </td>
                )}
                {table.headers.map((header) => (
                  <ReviewCell key={`${rowKey}-${header}`} table={table} row={row} header={header} draft={draft} labels={labels}
                    onCellChange={onCellChange} onCandidateChange={onCandidateChange}
                    parent={parent} canEdit={canEdit} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

export default SteelReviewEditor;
