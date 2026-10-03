import { useCallback, useEffect, useMemo } from 'react';
import { useAtom } from 'jotai';
import { Maximize2, Minimize2 } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@librechat/client';
import type { SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
import {
  steelReviewDialogStateFamily,
  steelReviewIdentityKey,
  steelReviewSelectionAtom,
  steelReviewSourcePreviewKey,
  type SteelReviewSelection,
} from './SteelReview/state';
import {
  useGetSteelReviewQuery,
  useGetSteelReviewSourceQuery,
  useGetSteelReviewSourcesQuery,
} from '~/data-provider';
import { getSteelReviewPreviewRows, type SteelReviewPreviewRows } from './SteelReview/filter';
import SteelReviewSourcePreview from './SteelReview/SourcePreview';
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

function ReviewTable({
  table,
  label,
  rows = table.rows,
}: {
  table: SteelReviewTable;
  label: string;
  rows?: readonly SteelReviewRow[];
}) {
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
          {rows.map((row) => (
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
    selection.tableId === identity.tableId &&
    selection.partIndex === identity.partIndex;
  const query = useGetSteelReviewQuery(isOpen ? identity : null, { retry: false });
  const isNotFound = getErrorStatus(query.error) === 404;
  const table = query.data?.table;
  const dialogStateKey = steelReviewIdentityKey(identity);
  const [dialogState, setDialogState] = useAtom(steelReviewDialogStateFamily(dialogStateKey));
  const {
    selectedFileId,
    pageNumber,
    pageCount,
    fullScreen,
  } = dialogState;
  const sourcesQuery = useGetSteelReviewSourcesQuery(
    isOpen
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          tableId: identity.tableId,
        }
      : null,
    { enabled: isOpen && !!table },
  );
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const selectedSource = useMemo(
    () => sources.find((source) => source.fileId === selectedFileId) ?? sources[0],
    [selectedFileId, sources],
  );
  const selectedSourceId = selectedSource?.fileId;
  const selectedSourcePage = useMemo(
    () => table?.rows.find((row) => row.source?.fileId === selectedSource?.fileId)?.source?.pageNumber,
    [selectedSource?.fileId, table?.rows],
  );
  useEffect(() => {
    setDialogState((state) => {
      if (state.isOpen === isOpen) {
        return state;
      }
      return {
        ...state,
        isOpen,
        selectedFileId: undefined,
        pageNumber: 1,
        pageCount: 0,
        fullScreen: false,
        initializedSourceId: undefined,
      };
    });
  }, [isOpen, setDialogState]);
  useEffect(() => {
    setDialogState((state) => {
      if (!selectedSourceId) {
        if (!state.selectedFileId && !state.initializedSourceId && state.pageNumber === 1) {
          return state;
        }
        return {
          ...state,
          selectedFileId: undefined,
          pageNumber: 1,
          initializedSourceId: undefined,
        };
      }
      if (state.initializedSourceId === selectedSourceId) {
        return state;
      }
      return {
        ...state,
        selectedFileId: selectedSourceId,
        pageNumber: selectedSourcePage ?? 1,
        initializedSourceId: selectedSourceId,
      };
    });
  }, [selectedSourceId, selectedSourcePage, setDialogState]);
  useEffect(() => {
    if (selectedSourceId) {
      setDialogState((state) => ({ ...state, pageCount: 0 }));
    }
  }, [selectedSourceId, setDialogState]);
  const sourceQuery = useGetSteelReviewSourceQuery(
    isOpen && selectedSource
      ? {
          conversationId: identity.conversationId,
          kind: identity.kind,
          messageId: identity.messageId,
          fileId: selectedSource.fileId,
        }
      : null,
    { enabled: isOpen && !!selectedSource },
  );
  const previewRows: SteelReviewPreviewRows = useMemo(
    () => getSteelReviewPreviewRows(
      table?.rows ?? [],
      selectedSource?.fileId,
      pageNumber,
      new Set(sources.map((source) => source.fileId)),
      pageCount,
    ),
    [pageCount, pageNumber, selectedSource?.fileId, sources, table?.rows],
  );
  const onPageCount = useCallback((count: number) => {
    setDialogState((state) => ({
      ...state,
      pageCount: count,
      pageNumber: count > 0 ? Math.min(state.pageNumber, count) : state.pageNumber,
    }));
  }, [setDialogState]);
  const goPrevious = useCallback(() => {
    setDialogState((state) => ({ ...state, pageNumber: Math.max(1, state.pageNumber - 1) }));
  }, [setDialogState]);
  const goNext = useCallback(() => {
    setDialogState((state) => ({
      ...state,
      pageNumber: Math.min(state.pageCount || state.pageNumber + 1, state.pageNumber + 1),
    }));
  }, [setDialogState]);

  return (
    <OGDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && isOpen) setSelection(null);
      }}
    >
      <OGDialogContent
        aria-label={localize('com_ui_steel_review_title')}
        className={fullScreen
          ? 'fixed inset-0 left-0 top-0 flex h-screen w-screen max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-4 overflow-hidden rounded-none p-6'
          : 'flex max-h-[95vh] w-[min(96vw,96rem)] max-w-none flex-col gap-4 overflow-hidden p-6'}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
            return;
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goPrevious();
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            goNext();
          }
        }}
      >
        <OGDialogHeader className="shrink-0 pr-10">
          <OGDialogTitle className="text-left text-xl font-semibold">
            {localize('com_ui_steel_review_title')}
          </OGDialogTitle>
          <OGDialogDescription className="text-left">
            {localize('com_ui_steel_review_readonly')}
          </OGDialogDescription>
        </OGDialogHeader>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            aria-label={localize(fullScreen ? 'com_ui_steel_review_exit_fullscreen' : 'com_ui_steel_review_fullscreen')}
            onClick={() => setDialogState((state) => ({ ...state, fullScreen: !state.fullScreen }))}
          >
            {fullScreen ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto" aria-live="polite">
          {query.isLoading && <p>{localize('com_ui_steel_review_loading')}</p>}
          {!query.isLoading && (isNotFound || (!query.isError && (!table || table.rows.length === 0))) && (
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
            <div className="space-y-4">
              {sourcesQuery.isLoading && (
                <p aria-live="polite" role="status">
                  {localize('com_ui_steel_review_sources_loading')}
                </p>
              )}
              {sourcesQuery.isError && (
                <div className="space-y-2" role="alert">
                  <p>{localize('com_ui_steel_review_sources_error')}</p>
                  <Button type="button" variant="outline" onClick={() => void sourcesQuery.refetch()}>
                    {localize('com_ui_retry')}
                  </Button>
                </div>
              )}
              {sources.length > 0 && (
                <div className="grid gap-3 rounded-md border border-border-light p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="flex min-w-0 flex-col gap-1 text-sm text-text-secondary">
                    <span>{localize('com_ui_steel_review_source')}</span>
                    <Select
                      value={selectedSource?.fileId ?? ''}
                      onValueChange={(value) => setDialogState((state) => ({
                        ...state,
                        selectedFileId: value || undefined,
                        pageNumber: 1,
                        initializedSourceId: undefined,
                      }))}
                    >
                      <SelectTrigger
                        aria-label={localize('com_ui_steel_review_source')}
                        className="w-full"
                      >
                        <SelectValue placeholder={localize('com_ui_steel_review_source')} />
                      </SelectTrigger>
                      <SelectContent>
                        {sources.map((source) => (
                          <SelectItem key={source.fileId} value={source.fileId}>
                            {source.filename}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <div className="flex items-end gap-2">
                    <Button type="button" variant="outline" aria-label={localize('com_ui_steel_review_previous_page')} onClick={goPrevious} disabled={pageNumber <= 1}>
                      ‹
                    </Button>
                    <label className="flex flex-col gap-1 text-sm text-text-secondary">
                      <span>{localize('com_ui_steel_review_page')}</span>
                      <Select
                        value={String(pageNumber)}
                        onValueChange={(value) => setDialogState((state) => ({ ...state, pageNumber: Number(value) }))}
                      >
                        <SelectTrigger
                          aria-label={localize('com_ui_steel_review_page')}
                          className="w-20"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1).map((page) => (
                            <SelectItem key={page} value={String(page)}>
                              {page}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <Button type="button" variant="outline" aria-label={localize('com_ui_steel_review_next_page')} onClick={goNext} disabled={pageCount > 0 && pageNumber >= pageCount}>
                      ›
                    </Button>
                  </div>
                </div>
              )}
              {selectedSource && (
                <SteelReviewSourcePreview
                  stateKey={steelReviewSourcePreviewKey(identity, selectedSource.fileId)}
                  source={selectedSource}
                  pageNumber={pageNumber}
                  blob={sourceQuery.data}
                  loading={sourceQuery.isLoading}
                  error={sourceQuery.isError}
                  onRetry={() => void sourceQuery.refetch()}
                  onPageCount={onPageCount}
                  labels={{
                    zoomIn: localize('com_ui_steel_review_zoom_in'),
                    zoomOut: localize('com_ui_steel_review_zoom_out'),
                    loading: localize('com_ui_steel_review_preview_loading'),
                    retry: localize('com_ui_retry'),
                    unavailable: localize('com_ui_steel_review_preview_unavailable'),
                    canvas: localize('com_ui_steel_review_preview_canvas'),
                  }}
                />
              )}
              {selectedSource ? (
                <>
                  <ReviewTable table={table} rows={previewRows.located} label={localize('com_ui_steel_review_table_label')} />
                  {previewRows.unlocated.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">{localize('com_ui_steel_review_unlocated')}</h3>
                      <ReviewTable table={table} rows={previewRows.unlocated} label={localize('com_ui_steel_review_unlocated')} />
                    </div>
                  )}
                </>
              ) : (
                <ReviewTable table={table} label={localize('com_ui_steel_review_table_label')} />
              )}
            </div>
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
