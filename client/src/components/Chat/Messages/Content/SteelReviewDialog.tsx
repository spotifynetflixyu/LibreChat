import { useAtom } from 'jotai';
import {
  Button,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
} from '@librechat/client';
import type { SteelReviewTable } from 'librechat-data-provider';
import { steelReviewSelectionAtom, type SteelReviewSelection } from './SteelReview/state';
import { useGetSteelReviewQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) {
    return undefined;
  }
  return typeof response.status === 'number' ? response.status : undefined;
}

function ReviewTable({ table, label }: { table: SteelReviewTable; label: string }) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border border-border-light">
      <table className="min-w-full border-collapse text-sm" aria-label={label}>
        <thead className="bg-surface-secondary">
          <tr>
            {table.headers.map((header) => (
              <th key={header} scope="col" className="border-b border-border-light px-3 py-2 text-left font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.rowId}>
              {table.headers.map((header) => {
                const cell = row.values[header];
                const changed = cell?.baseline !== cell?.effective;
                return (
                  <td key={`${row.rowId}-${header}`} className="border-b border-border-light px-3 py-2 align-top">
                    {changed && cell?.baseline !== null && cell?.baseline !== undefined && (
                      <del className="mr-2 text-text-secondary">{cell.baseline}</del>
                    )}
                    <span>{cell?.effective ?? ''}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SteelReviewDialog({ identity }: { identity: SteelReviewSelection }) {
  const localize = useLocalize();
  const [selection, setSelection] = useAtom(steelReviewSelectionAtom);
  const isOpen = selection != null &&
    selection.conversationId === identity.conversationId &&
    selection.messageId === identity.messageId &&
    selection.kind === identity.kind &&
    selection.tableId === identity.tableId;
  const query = useGetSteelReviewQuery(isOpen ? identity : null);
  const isNotFound = getErrorStatus(query.error) === 404;
  const table = query.data?.table;

  return (
    <OGDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && isOpen) setSelection(null);
      }}
    >
      <OGDialogContent
        aria-label={localize('com_ui_steel_review_title')}
        className="flex max-h-[90vh] w-11/12 max-w-6xl flex-col gap-4 overflow-hidden p-6"
      >
        <OGDialogHeader className="shrink-0 pr-10">
          <OGDialogTitle className="text-left text-xl font-semibold">
            {localize('com_ui_steel_review_title')}
          </OGDialogTitle>
          <OGDialogDescription className="text-left">
            {localize('com_ui_steel_review_readonly')}
          </OGDialogDescription>
        </OGDialogHeader>
        <div className="min-h-0 flex-1" aria-live="polite">
          {query.isLoading && <p>{localize('com_ui_steel_review_loading')}</p>}
          {!query.isLoading && (isNotFound || (!query.isError && !table)) && (
            <p>{localize('com_ui_steel_review_empty')}</p>
          )}
          {!query.isLoading && query.isError && !isNotFound && (
            <div className="space-y-3" role="alert">
              <p>{localize('com_ui_steel_review_error')}</p>
              <Button type="button" variant="outline" onClick={() => void query.refetch()}>
                {localize('com_ui_retry')}
              </Button>
            </div>
          )}
          {!query.isLoading && !query.isError && table && (
            <ReviewTable table={table} label={localize('com_ui_steel_review_table_label')} />
          )}
        </div>
        <div className="flex justify-end">
          <OGDialogClose asChild>
            <Button type="button">{localize('com_ui_close')}</Button>
          </OGDialogClose>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
