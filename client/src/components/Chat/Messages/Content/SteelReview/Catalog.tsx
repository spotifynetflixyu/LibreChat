import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogFooter,
  OGDialogHeader,
  OGDialogTitle,
  OGDialogTrigger,
} from '@librechat/client';
import { applyMaterialCandidate, applyProcessingCandidate, isSteelProcessingCatalogCandidateApplicable, steelMaterialCandidateHeaders, steelProcessingCandidateHeaders, steelProcessingMaterialForRow } from 'librechat-data-provider';
import type { SteelCatalogCandidate, SteelCatalogCustomerEvidence, SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
import type { ReactElement } from 'react';
import { CollapsibleCellContent } from '../table/Cell';
import { orderSystemHeaders } from '../table/order';
import { displaySteelReviewValue } from './values';
import SteelReviewSelector from './Selector';
import { useLocalize } from '~/hooks';

const materialCandidateHeaders = new Set<string>(steelMaterialCandidateHeaders);
const processingCandidateHeaders = new Set<string>(steelProcessingCandidateHeaders);

interface StagedSelection {
  scope: string;
  candidate: SteelCatalogCandidate;
  customer: SteelCatalogCustomerEvidence;
}

export interface SteelReviewCatalogProps {
  table: SteelReviewTable;
  row: SteelReviewRow;
  parent?: SteelReviewRow;
  header: '型號' | '品名規格';
  value: string;
  canEdit: boolean;
  trigger?: ReactElement;
  onSelect: (
    row: SteelReviewRow,
    candidate: SteelCatalogCandidate,
    customer: SteelCatalogCustomerEvidence,
  ) => void;
}

function catalogScope(
  table: SteelReviewTable,
  row: SteelReviewRow,
  parent: SteelReviewRow | undefined,
  header: '型號' | '品名規格',
): string {
  const material = row.system?.kind === 'processing' && parent
    ? steelProcessingMaterialForRow(parent)
    : null;
  return JSON.stringify([table.conversationId, table.messageId, table.outputId, table.revision, row.rowId, header, row.system?.kind, material]);
}

export default function SteelReviewCatalog({
  table,
  row,
  parent,
  header,
  value,
  canEdit,
  trigger,
  onSelect,
}: SteelReviewCatalogProps) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState<StagedSelection | null>(null);
  const [validationError, setValidationError] = useState(false);
  const processing = row.system?.kind === 'processing';
  const scope = catalogScope(table, row, parent, header);
  const currentScope = useRef(scope);
  const currentMaterial = useMemo(() => processing && parent
    ? steelProcessingMaterialForRow(parent)
    : undefined, [parent, processing]);

  useEffect(() => {
    if (currentScope.current === scope) return;
    currentScope.current = scope;
    setStaged(null);
    setValidationError(false);
    setOpen(false);
  }, [scope]);

  useEffect(() => {
    if (canEdit) return;
    setStaged(null);
    setValidationError(false);
    setOpen(false);
  }, [canEdit]);

  const discard = useCallback(() => {
    setStaged(null);
    setValidationError(false);
    setOpen(false);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      setStaged(null);
      setValidationError(false);
    }
    setOpen(next && canEdit);
  }, [canEdit]);

  const stage = useCallback((selectedRow: SteelReviewRow, candidate: SteelCatalogCandidate,
    customer: SteelCatalogCustomerEvidence) => {
    if (!canEdit || currentScope.current !== scope || selectedRow.rowId !== row.rowId || row.deleted) return;
    if (processing && (!parent || parent.deleted || parent.system?.kind !== 'material' || !currentMaterial ||
      !isSteelProcessingCatalogCandidateApplicable(candidate, currentMaterial))) return;
    setStaged({ scope, candidate, customer });
    setValidationError(false);
  }, [canEdit, currentMaterial, parent, processing, row.deleted, row.rowId, scope]);

  const stagedRow = useMemo(() => {
    if (!staged || staged.scope !== scope) return undefined;
    if (processing) {
      if (!parent) return undefined;
      return applyProcessingCandidate(row, staged.candidate, table.headers, staged.customer.tier, parent);
    }
    return applyMaterialCandidate(row, staged.candidate, table.headers, staged.customer.tier);
  }, [parent, processing, row, scope, staged, table.headers]);
  const previewRow = stagedRow ?? row;
  const previewHeaders = useMemo(() => {
    const headers = processing ? processingCandidateHeaders : materialCandidateHeaders;
    const displayHeaders = table.kind === 'system_order' ? orderSystemHeaders(table.headers) : table.headers;
    return displayHeaders.filter((candidateHeader) => headers.has(candidateHeader) &&
      Object.prototype.hasOwnProperty.call(row.values, candidateHeader));
  }, [processing, row.values, table.headers, table.kind]);

  const intentChanged = useCallback(() => {
    setValidationError(false);
  }, []);

  const confirm = () => {
    const selection = staged;
    const valid = selection != null && selection.scope === scope && canEdit && !row.deleted &&
      (!processing || (parent != null && !parent.deleted && parent.system?.kind === 'material' && currentMaterial != null &&
        isSteelProcessingCatalogCandidateApplicable(selection.candidate, currentMaterial)));
    if (!valid || !selection) {
      setValidationError(true);
      return;
    }
    onSelect(row, selection.candidate, selection.customer);
    setStaged(null);
    setValidationError(false);
    setOpen(false);
  };

  const defaultTrigger = (
    <Button type="button" variant="outline" disabled={!canEdit} aria-haspopup="dialog">
      {value || header}
    </Button>
  );

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <OGDialogTrigger asChild>{trigger ?? defaultTrigger}</OGDialogTrigger>
      <OGDialogContent showCloseButton={false} className="!flex !flex-col h-[70dvh] !max-h-[90dvh] w-11/12 max-w-3xl !overflow-visible">
        <OGDialogHeader className="shrink-0">
          <OGDialogTitle>{header}</OGDialogTitle>
        </OGDialogHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SteelReviewSelector
            table={table}
            row={row}
            parent={parent}
            header={header}
            value={stagedRow?.values[header]?.effective ?? value}
            canEdit={canEdit}
            onIntentChange={intentChanged}
            selectedCandidate={staged?.candidate}
            onSelect={stage}
          />
          {previewHeaders.length > 0 && (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-md border border-border-light">
              <table className="w-full border-collapse text-sm" aria-label={localize('com_ui_steel_review_table_label')}>
                <tbody>
                  {previewHeaders.map((previewHeader) => (
                    <tr key={previewHeader}>
                      <th scope="row" className="whitespace-nowrap border-b border-border-light bg-surface-secondary px-3 py-2 text-left font-semibold align-top">{previewHeader}</th>
                      <td className="border-b border-border-light px-3 py-2 align-top"><CollapsibleCellContent>{displaySteelReviewValue(table.kind, previewHeader, previewRow.values[previewHeader]?.effective)}</CollapsibleCellContent></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {validationError && <div className="mt-3 shrink-0 text-sm text-status-error-text" role="alert">
            {localize('com_ui_steel_review_catalog_changed')}
          </div>}
        </div>
        <OGDialogFooter className="shrink-0 flex-row items-center justify-end gap-2 sm:space-x-0">
          <OGDialogClose asChild>
            <Button type="button" variant="outline" onClick={discard}>{localize('com_ui_cancel')}</Button>
          </OGDialogClose>
          <Button type="button" disabled={staged == null} onClick={confirm}>{localize('com_ui_confirm')}</Button>
        </OGDialogFooter>
      </OGDialogContent>
    </OGDialog>
  );
}
