import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import * as Popover from '@radix-ui/react-popover';
import { Link2, Pencil, Trash2 } from 'lucide-react';
import { steelPriceCategories } from 'librechat-data-provider';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, TooltipAnchor, useNestedPopoverStyle } from '@librechat/client';
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
import { steelReviewCellEditStateFamily, steelReviewRowEditStateFamily } from './state';
import { getSteelReviewDraftCell, getSteelReviewDraftMeasurement } from './session';
import { CollapsibleCellContent } from '../table/Cell';
import SteelReviewMeasurement from './Measurement';
import SteelReviewSelector from './Selector';
import { getSteelReviewMode } from './mode';

export interface SteelReviewEditorLabels {
  table: string;
  readonly: string;
  emptyCategory: string;
  action: string;
  edit?: string;
  reset?: string;
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
  isDesktop?: boolean;
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

const categoryMenuOrder = new Map<string, number>(steelPriceCategories.map((category, index) => [
  category,
  category === '圓條' ? steelPriceCategories.indexOf('圓管') - 0.5 : index,
]));
const secondaryCategories = new Set(['捲門/伸縮門', '格板/隔板', '五金/配件', '門窗/門板']);

function categoryPriority(category: string): number {
  if (category === '其他') return 3;
  if (category.startsWith('加工/')) return 1;
  if (secondaryCategories.has(category)) return 2;
  return categoryMenuOrder.has(category) ? 0 : 2;
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

function protectNestedSelector(
  event: { detail: { originalEvent: { target: EventTarget | null } }; preventDefault: () => void },
  content: HTMLDivElement | null,
): boolean {
  const target = event.detail.originalEvent.target;
  const listbox = target instanceof Element ? target.closest('[role="listbox"]') : null;
  if (!listbox?.id || !content) return false;
  for (const trigger of content.querySelectorAll('[role="combobox"][aria-controls]')) {
    if (trigger.getAttribute('aria-controls')?.split(/\s+/u).includes(listbox.id)) {
      event.preventDefault();
      return true;
    }
  }
  return false;
}

function ReviewRowEditButton({
  table,
  row,
  draft,
  canEdit,
  isDesktop,
  label,
}: {
  table: SteelReviewTable;
  row: SteelReviewRow;
  draft: SteelReviewDraftState;
  canEdit: boolean;
  isDesktop: boolean;
  label: string;
}) {
  const [editing, setEditing] = useAtom(steelReviewRowEditStateFamily(JSON.stringify([draft.ownerKey, row.rowId])));
  if (isDesktop || !row.rowId || !canEdit || row.deleted || !table.isLatest || table.readOnly ||
    !table.headers.some((header) => isSteelReviewCellEditable(table, header))) return null;
  return (
    <ReviewActionButton linked={editing} label={label} rowId={row.rowId} onClick={() => setEditing((current) => !current)}>
      <Pencil className="size-4" fill={editing ? 'currentColor' : 'none'} aria-hidden="true" />
    </ReviewActionButton>
  );
}

function ReviewMeasurementEditor({
  row,
  measurement,
  labels,
  canEdit,
  isDesktop,
  onChange,
  editLabel,
}: {
  row: SteelReviewRow;
  measurement?: SteelProcessingMeasurement | null;
  labels: SteelMeasurementLabels;
  canEdit: boolean;
  isDesktop: boolean;
  onChange: (measurement: SteelProcessingMeasurement | null) => void;
  editLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const nestedPopoverStyle = useNestedPopoverStyle();
  if (!isDesktop || !canEdit) {
    return <SteelReviewMeasurement rowId={row.rowId} rowUnit={row.values['單位']?.effective ?? ''} measurement={measurement}
      labels={labels} canEdit={canEdit} onChange={onChange} />;
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" size="icon-sm" variant={open ? 'default' : 'outline'} aria-label={`${editLabel} ${labels.title} ${row.rowId}`}>
          <Pencil className="size-4" fill={open ? 'currentColor' : 'none'} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          side="top"
          align="start"
          sideOffset={4}
          className="w-80 rounded-md border border-border-light bg-surface-secondary p-3 text-text-primary shadow-md outline-none"
          style={nestedPopoverStyle}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onFocusOutside={(event) => { protectNestedSelector(event, contentRef.current); }}
          onInteractOutside={(event) => { protectNestedSelector(event, contentRef.current); }}
        >
          <SteelReviewMeasurement rowId={row.rowId} rowUnit={row.values['單位']?.effective ?? ''} measurement={measurement}
            labels={labels} canEdit={canEdit} onChange={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
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
  isDesktop,
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
  isDesktop: boolean;
}) {
  const [remarkEditing, setRemarkEditing] = useState(false);
  const [remarkValue, setRemarkValue] = useState('');
  const rowEditKey = JSON.stringify([draft.ownerKey, row.rowId]);
  const rowEditing = useAtomValue(steelReviewRowEditStateFamily(rowEditKey));
  const cellEditKey = JSON.stringify([draft.ownerKey, row.rowId, header]);
  const [editState, setEditState] = useAtom(steelReviewCellEditStateFamily(cellEditKey));
  const editStateRef = useRef(editState);
  const currentValueRef = useRef('');
  const editableRef = useRef(false);
  const composingRef = useRef(false);
  const nestedPopoverStyle = useNestedPopoverStyle();
  const contentRef = useRef<HTMLDivElement>(null);
  const mode = getSteelReviewMode(table.kind);
  const deferRemark = mode.defersHeader(header);
  const cell = row.values[header];
  const draftValue = row.rowId ? getSteelReviewDraftCell(draft, row.rowId, header) : undefined;
  const currentValue = draftValue ?? displayCellValue(cell?.effective);
  const baseEditable = Boolean(row.rowId) && canEdit && !row.deleted && isSteelReviewCellEditable(table, header);
  const editable = baseEditable && (isDesktop || rowEditing);
  const catalogEditable = editable && (row.system?.kind !== 'processing' || Boolean(parent && !parent.deleted && parent.system?.kind === 'material'));
  const desktopEditable = isDesktop && baseEditable && (!mode.usesCatalog(row, header) || Boolean(onCandidateChange && catalogEditable));
  const commitOnDismiss = !mode.usesCatalog(row, header) && !mode.usesCategoryMenu(header);

  editStateRef.current = editState;
  currentValueRef.current = currentValue;
  editableRef.current = desktopEditable;

  const clearEdit = useCallback((consumed = true) => {
    const next = { ownerKey: draft.ownerKey, open: false, value: '', consumed };
    editStateRef.current = next;
    setEditState(next);
  }, [draft.ownerKey, setEditState]);

  const openEdit = useCallback(() => {
    if (!editableRef.current) return;
    const next = { ownerKey: draft.ownerKey, open: true, value: currentValueRef.current, consumed: false };
    editStateRef.current = next;
    setEditState(next);
  }, [draft.ownerKey, setEditState]);

  const setEditValue = useCallback((value: string) => {
    const current = editStateRef.current;
    if (!current.open || current.consumed || current.ownerKey !== draft.ownerKey) return;
    const next = { ...current, value };
    editStateRef.current = next;
    setEditState(next);
  }, [draft.ownerKey, setEditState]);

  const cancelEdit = useCallback(() => {
    const current = editStateRef.current;
    if (!current.open || current.consumed || current.ownerKey !== draft.ownerKey) return;
    clearEdit();
  }, [clearEdit, draft.ownerKey]);

  const finishEdit = useCallback((value?: string, onFinish?: (nextValue: string) => void, force = false) => {
    const current = editStateRef.current;
    if (!current.open || current.consumed || current.ownerKey !== draft.ownerKey || !editableRef.current) return;
    const nextValue = value ?? current.value;
    const changed = nextValue !== currentValueRef.current;
    clearEdit();
    if (force || changed) {
      onFinish?.(nextValue);
      if (!onFinish && commitOnDismiss) onCellChange(row, header, nextValue);
    }
  }, [clearEdit, commitOnDismiss, draft.ownerKey, header, onCellChange, row]);

  useEffect(() => {
    if (!editState.open) return;
    if (!desktopEditable || editState.ownerKey !== draft.ownerKey) clearEdit();
  }, [clearEdit, desktopEditable, draft.ownerKey, editState.open, editState.ownerKey]);

  if (!cell) return <td className="min-h-16 max-w-screen-sm [overflow-wrap:anywhere] border-b border-border-light px-3 py-2 align-top" />;
  const changed = displayCellValue(cell.baseline) !== currentValue;
  const hasOriginalValue = cell.baseline !== null && cell.baseline !== undefined;
  const inputChanged = hasOriginalValue && editState.value !== displayCellValue(cell.baseline);
  const previousValue = !row.deleted && changed && cell.baseline !== null && cell.baseline !== undefined
    ? <del className="mt-1 block text-text-secondary">{cell.baseline}</del>
    : null;
  let editorContent: ReactNode = null;
  let desktopEditorContent: ReactNode = null;
  if (!row.deleted && mode.usesCatalog(row, header) && onCandidateChange) {
    if (!isDesktop && rowEditing) {
      editorContent = <SteelReviewSelector table={table} row={row} parent={parent} header={header} value={currentValue}
        canEdit={catalogEditable} onSelect={onCandidateChange} />;
    }
    desktopEditorContent = <SteelReviewSelector table={table} row={row} parent={parent} header={header} value={currentValue}
      canEdit={catalogEditable}
      onSelect={(nextRow, candidate, customer) => finishEdit(undefined, () => onCandidateChange(nextRow, candidate, customer), true)} />;
  } else if (!row.deleted && editable && mode.usesCategoryMenu(header)) {
    const categoryOptions = [...new Set([...steelPriceCategories, cell.baseline ?? '', currentValue])]
      .filter(Boolean)
      .sort((left, right) => categoryPriority(left) - categoryPriority(right) ||
        (categoryMenuOrder.get(left) ?? categoryMenuOrder.size) - (categoryMenuOrder.get(right) ?? categoryMenuOrder.size));
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
    desktopEditorContent = (
      <Select value={currentValue || EMPTY_CATEGORY_VALUE} onValueChange={(value) => {
        const nextValue = value === EMPTY_CATEGORY_VALUE ? '' : value;
        finishEdit(nextValue, (committedValue) => onCellChange(row, header, committedValue));
      }}>
        <SelectTrigger aria-label={`${header} ${row.rowId}`} className="min-w-48"><SelectValue /></SelectTrigger>
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
    desktopEditorContent = (
      <Textarea
        aria-label={`${header} ${row.rowId}`}
        data-steel-review-deferred={deferRemark || undefined}
        className="min-w-48 text-base"
        rows={3}
        value={editState.value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setEditValue(event.target.value)}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && contentRef.current?.contains(event.relatedTarget)) return;
          finishEdit(undefined, (committedValue) => onCellChange(row, header, committedValue));
        }}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelEdit();
            return;
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !composingRef.current) {
            event.preventDefault();
            finishEdit(undefined, (committedValue) => onCellChange(row, header, committedValue));
          }
        }}
      />
    );
  }

  if (isDesktop && desktopEditable) {
    return (
      <td className="group min-h-16 max-w-screen-sm [overflow-wrap:anywhere] border-b border-border-light px-3 py-2 align-top">
        <Popover.Root open={editState.open} onOpenChange={(open) => {
          if (open) openEdit();
          else finishEdit();
        }}>
          <div className="flex min-h-6 min-w-12 items-start gap-1">
            <CollapsibleCellContent className="min-w-8 flex-1">{currentValue}{previousValue}</CollapsibleCellContent>
            <Popover.Trigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="size-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`${labels.edit ?? labels.action} ${header} ${row.rowId}`}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </Button>
            </Popover.Trigger>
          </div>
          <Popover.Portal>
            <Popover.Content
              ref={contentRef}
              side="top"
              align="start"
              sideOffset={4}
              className="w-72 rounded-md border border-border-light bg-surface-secondary p-3 text-text-primary shadow-md outline-none"
              style={nestedPopoverStyle}
              onEscapeKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                cancelEdit();
              }}
              onFocusOutside={(event) => {
                if (!protectNestedSelector(event, contentRef.current)) finishEdit();
              }}
              onInteractOutside={(event) => {
                if (!protectNestedSelector(event, contentRef.current)) finishEdit();
              }}
            >
              {desktopEditorContent}
              {commitOnDismiss ? (
                <div className="mt-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-sm text-text-secondary [overflow-wrap:anywhere]">
                    {inputChanged && <del>{cell.baseline}</del>}
                  </div>
                  <Button type="button" size="sm" variant="ghost" disabled={!inputChanged}
                    aria-label={`${labels.reset ?? labels.action} ${header} ${row.rowId}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => setEditValue(displayCellValue(cell.baseline))}>
                    {labels.reset}
                  </Button>
                </div>
              ) : changed && previousValue}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </td>
    );
  }

  if (!row.deleted && editorContent) {
    return <td className="min-h-16 max-w-screen-sm [overflow-wrap:anywhere] border-b border-border-light px-3 py-2 align-top">{editorContent}{previousValue}</td>;
  }
  if (!row.deleted) {
    return <td className="min-h-16 max-w-screen-sm [overflow-wrap:anywhere] border-b border-border-light px-3 py-2 align-top"><CollapsibleCellContent><span aria-label={`${header}: ${labels.readonly}`}>{currentValue}</span>{previousValue}</CollapsibleCellContent></td>;
  }
  return <td className="min-h-16 max-w-screen-sm [overflow-wrap:anywhere] border-b border-border-light px-3 py-2 align-top"><CollapsibleCellContent><del className="text-text-secondary">{displayCellValue(cell.baseline)}</del></CollapsibleCellContent></td>;
}

const SteelReviewEditor = memo(function SteelReviewEditor({
  table,
  rows,
  draft,
  labels,
  onCellChange,
  canEdit = true,
  isDesktop = false,
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
  const columnWidths = useMemo(() => table.headers.map((header) => {
    const values = [header];
    rows.forEach((row) => {
      const cell = row.values[header];
      if (cell) {
        values.push(displayCellValue(cell.baseline), displayCellValue(cell.effective));
        if (row.rowId) values.push(getSteelReviewDraftCell(draft, row.rowId, header) ?? '');
      }
    });
    const contentWidth = Math.max(...values.map((value) =>
      Array.from(value).reduce((width, character) => width + (character.charCodeAt(0) <= 255 ? 8 : 16), 0)), 1);
    return Math.min(640, Math.max(96, contentWidth + 24));
  }), [draft, rows, table.headers]);
  const totalColumnWidth = columnWidths.reduce((total, width) => total + width, 0);
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
    <div ref={viewportRef} className="h-28 min-h-28 max-h-28 min-w-0 shrink-0 overflow-auto rounded-md border border-border-light">
      <table className="w-full border-collapse text-sm" aria-label={labels.table}>
        <colgroup>
          {showActions && <col key="actions" />}
          {columnWidths.map((width, index) => <col key={`${table.headers[index]}-${index}`} style={{ width: `${width / totalColumnWidth * 100}%` }} />)}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface-secondary">
          <tr className="h-10">
            {showActions && <th scope="col" className="border-b border-border-light whitespace-nowrap px-3 py-2 text-left font-semibold">{labels.action}</th>}
            {table.headers.map((header) => (
              <th key={header} scope="col" className="whitespace-nowrap border-b border-border-light px-3 py-2 text-left font-semibold">{header}</th>
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
              <tr key={rowKey} data-row-id={row.rowId || undefined} className={row.deleted ? 'h-16 opacity-70' : 'h-16'}>
                {showActions && (
                  <td className="min-h-16 whitespace-nowrap border-b border-border-light px-3 py-2 align-top">
                    <div className="flex min-w-max flex-nowrap items-start gap-1">
                      <ReviewRowEditButton table={table} row={row} draft={draft} canEdit={canEdit} isDesktop={isDesktop} label={labels.edit ?? labels.action} />
                      {bindable && (
                        <ReviewActionButton linked={bound} label={(bound ? labels.bound : labels.bind) ?? labels.action} rowId={row.rowId} onClick={() => onSourceEdit?.(row)}>
                          <Link2 className="size-4" aria-hidden="true" />
                        </ReviewActionButton>
                      )}
                      {row.system?.kind === 'processing' && !row.deleted && onMeasurementChange && labels.measurement && (
                        <ReviewMeasurementEditor
                          row={row}
                          measurement={getSteelReviewDraftMeasurement(draft, row.rowId) === undefined ? row.calculation?.measurement ?? null : getSteelReviewDraftMeasurement(draft, row.rowId)}
                          labels={labels.measurement}
                          canEdit={canEdit}
                          isDesktop={isDesktop}
                          editLabel={labels.edit ?? labels.action}
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
                    parent={parent} canEdit={canEdit} isDesktop={isDesktop} />
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
