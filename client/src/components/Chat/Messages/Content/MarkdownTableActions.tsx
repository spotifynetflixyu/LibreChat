import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import filenamify from 'filenamify';
import { atom, useAtom } from 'jotai';
import { useRecoilValue } from 'recoil';
import { createPortal } from 'react-dom';
import { steelCustomerTierSchema } from 'librechat-data-provider';
import { Check, Copy, Download, FileSearch, Maximize2, X } from 'lucide-react';
import {
  ControlCombobox,
  EditIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TooltipAnchor,
} from '@librechat/client';
import type { SteelReviewKind, SteelReviewTable, SteelMarkdownVersion } from 'librechat-data-provider';
import type { SteelReviewDownloadAuthority, SteelReviewSaveGate } from './SteelReviewDialog';
import type { TableMatrix } from './table/export';
import { canGroupByThickness, createCsvBlob, createThicknessZip } from './table/export';
import { orderSystemMatrix, orderSystemTable } from './table/order';
import { useSteelMarkdownVersion } from './SteelReview/heading';
import { steelReviewSelectionAtom } from './SteelReview/state';
import { useGetSteelReviewQuery } from '~/data-provider';
import SteelReviewDialog from './SteelReviewDialog';
import SteelCustomer from './SteelReview/Customer';
import { useMessageContext } from '~/Providers';
import { triggerDownload } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

type MarkdownTableActionsProps = {
  children: React.ReactNode;
  markdownIndex: number;
};

type ThemeAttributes = {
  className: string;
  dataTheme?: string;
};

type TableToolbarProps = {
  tableRef: React.RefObject<HTMLTableElement>;
  copied: boolean;
  downloadFilename: string;
  expanded: boolean;
  downloadMenu: boolean;
  headerOptions?: readonly TableHeaderOption[];
  onClose?: () => void;
  onCopied: () => void;
  onExpand?: () => void;
  customerVersion?: SteelMarkdownVersion;
  customerOnly?: boolean;
  reviewLabel?: string;
  reviewDisabled?: boolean;
  onReview?: () => void;
  onBeforeDownload?: () => Promise<boolean>;
  getDownloadMatrix?: () => TableMatrix;
  onStickyColumnChange?: (columnIndex: number | undefined) => void;
  stickyColumnIndex?: number;
};

type TableHeaderOption = {
  index: number;
  label: string;
};

type SteelReviewCandidate = {
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  title: string;
};

const wideColumnTextThreshold = 36;

function getReviewCandidateKey(candidate: SteelReviewCandidate): string {
  return `${candidate.conversationId}:${candidate.messageId}:${candidate.kind}:${candidate.title}`;
}

function getReviewKind(markdownTitle?: string): SteelReviewKind | undefined {
  if (markdownTitle === 'ocr_result') {
    return 'ocr_result';
  }
  if (markdownTitle === 'system_order' || markdownTitle?.startsWith('system_order｜')) {
    return 'system_order';
  }
  return undefined;
}

function getReviewErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) {
    return undefined;
  }
  return typeof response.status === 'number' ? response.status : undefined;
}

function formatFilenameTimestamp(timestamp?: string | null): string {
  const parsed = timestamp ? new Date(timestamp) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  ].join('_');
}

function getDownloadFilename(title: string | null | undefined, timestamp?: string | null): string {
  const safeTitle = filenamify(title?.trim() || 'Longding');
  return `${safeTitle}_${formatFilenameTimestamp(timestamp)}.csv`;
}

function getMarkdownTitle(table: HTMLTableElement | null): string | undefined {
  const container = table?.closest('.markdown-table-container');
  const message = container?.closest('.message-render');
  if (!message || !container) {
    return undefined;
  }

  let title: string | undefined;
  for (const element of message.querySelectorAll('.message-content h2, .markdown-table-container')) {
    if (element === container) {
      break;
    }
    if (element.tagName === 'H2') {
      title = (element.getAttribute('data-markdown-title') ?? element.textContent)?.trim() || title;
    }
  }

  return title;
}

function readThemeAttributes(): ThemeAttributes {
  if (typeof document === 'undefined') {
    return { className: '' };
  }

  const root = document.documentElement;
  const themeClasses = ['dark', 'light'].filter((className) => root.classList.contains(className));
  const dataTheme = root.getAttribute('data-theme') ?? undefined;

  return {
    className: themeClasses.join(' '),
    dataTheme,
  };
}

function useThemeAttributes(enabled: boolean): ThemeAttributes {
  const [themeAttributes, setThemeAttributes] = useState(readThemeAttributes);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const updateThemeAttributes = () => setThemeAttributes(readThemeAttributes());

    if (typeof MutationObserver === 'undefined') {
      updateThemeAttributes();
      return undefined;
    }

    const observer = new MutationObserver(updateThemeAttributes);

    observer.observe(document.documentElement, {
      attributeFilter: ['class', 'data-theme'],
      attributes: true,
    });

    updateThemeAttributes();
    return () => observer.disconnect();
  }, [enabled]);

  return themeAttributes;
}

function normalizeCellText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getNormalizedCellText(cell: HTMLTableCellElement): string {
  const content = cell.querySelector(':scope > [data-markdown-cell-content], :scope > [data-markdown-cell-wrapper] > [data-markdown-cell-content]') ?? cell;
  return normalizeCellText(content.textContent ?? '');
}


function getTableMatrix(table: HTMLTableElement | null): TableMatrix {
  if (!table) {
    return [];
  }

  return Array.from(table.rows).map((row) => Array.from(row.cells).map(getNormalizedCellText));
}

function getReviewTableMatrix(table: SteelReviewTable): TableMatrix {
  const matrix = [
    table.headers,
    ...table.rows
      .filter((row) => !row.deleted)
      .map((row) => table.headers.map((header) => row.values[header]?.effective ?? '')),
  ];
  return table.kind === 'system_order' ? orderSystemMatrix(matrix) : matrix;
}

function getTableHeaderOptions(table: HTMLTableElement | null): TableHeaderOption[] {
  const headerCells = table?.tHead?.rows[0]?.cells ?? table?.rows[0]?.cells;

  if (!headerCells) {
    return [];
  }

  return Array.from(headerCells).map((cell, index) => ({
    index,
    label: getNormalizedCellText(cell) || `Column ${index + 1}`,
  }));
}

function areHeaderOptionsEqual(
  previous: readonly TableHeaderOption[],
  next: readonly TableHeaderOption[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((option, index) => {
      const nextOption = next[index];
      return nextOption?.index === option.index && nextOption.label === option.label;
    })
  );
}

function setStickyColumn(cell: HTMLTableCellElement, enabled: boolean): void {
  cell.classList.toggle('markdown-table-sticky-column', enabled);
  if (enabled) {
    cell.setAttribute('data-sticky-column', 'true');
    return;
  }

  cell.removeAttribute('data-sticky-column');
}

function getWideColumnIndexes(table: HTMLTableElement): Set<number> {
  const wideColumnIndexes = new Set<number>();

  Array.from(table.rows).forEach((row, rowIndex) => {
    if (rowIndex === 0) {
      return;
    }

    Array.from(row.cells).forEach((cell, cellIndex) => {
      if (getNormalizedCellText(cell).length >= wideColumnTextThreshold) {
        wideColumnIndexes.add(cellIndex);
      }
    });
  });

  return wideColumnIndexes;
}

function applyStaticModalTableClasses(table: HTMLTableElement): void {
  const wideColumnIndexes = getWideColumnIndexes(table);

  Array.from(table.rows).forEach((row) => {
    Array.from(row.cells).forEach((cell, cellIndex) => {
      cell.classList.toggle('markdown-table-wide-column', wideColumnIndexes.has(cellIndex));
    });
  });
}

function applyStickyColumnClasses(table: HTMLTableElement, stickyColumnIndex?: number): void {
  Array.from(table.rows).forEach((row) => {
    Array.from(row.cells).forEach((cell, cellIndex) => {
      setStickyColumn(cell, stickyColumnIndex === cellIndex);
    });
  });
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function tableMatrixToMarkdown(matrix: TableMatrix): string {
  const [header, ...rows] = matrix;
  if (!header || header.length === 0) {
    return '';
  }

  const divider = header.map(() => '---');
  return [header, divider, ...rows]
    .map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`)
    .join('\n');
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function TableActionButton({
  children,
  label,
  description = label,
  disabled = false,
  onClick,
  portalElement,
}: {
  children: React.ReactNode;
  label: string;
  description?: string;
  disabled?: boolean;
  onClick: () => void;
  portalElement?: HTMLElement | null;
}) {
  const button = (
    <button
      type="button"
      className="markdown-table-action disabled:pointer-events-none disabled:opacity-50"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
  return (
    <TooltipAnchor
      side="top"
      description={description}
      portalElement={portalElement}
      className={disabled ? 'cursor-not-allowed' : undefined}
      render={
        disabled ? (
          <span tabIndex={0} aria-label={label}>
            {button}
          </span>
        ) : (
          button
        )
      }
    />
  );
}

function TableToolbar({
  tableRef,
  copied,
  downloadFilename,
  expanded,
  downloadMenu,
  headerOptions = [],
  onClose,
  onCopied,
  onExpand,
  onStickyColumnChange,
  stickyColumnIndex,
  customerVersion,
  customerOnly = false,
  reviewLabel,
  reviewDisabled = false,
  onReview,
  onBeforeDownload,
  getDownloadMatrix,
}: TableToolbarProps) {
  const localize = useLocalize();
  const tooltipHostAtom = useMemo(() => atom<HTMLElement | null>(null), []);
  const [tooltipHost, setTooltipHost] = useAtom(tooltipHostAtom);
  const copyLabel = localize('com_ui_copy_markdown_table');
  const downloadLabel = localize(downloadMenu ? 'com_ui_download' : 'com_ui_download_table_csv');
  const [canGroup, setCanGroup] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const expandLabel = localize('com_ui_expand_table');
  const closeLabel = localize('com_ui_close_table');
  const showStickyColumnSelector = expanded && headerOptions.length > 0;
  const stickyColumnLabel = showStickyColumnSelector ? localize('com_ui_sticky_table_column') : '';
  const noStickyColumnLabel = showStickyColumnSelector
    ? localize('com_ui_no_sticky_table_column')
    : '';
  const stickyColumnSearchLabel = showStickyColumnSelector
    ? localize('com_ui_search_table_columns')
    : '';
  const stickyColumnValue = stickyColumnIndex === undefined ? '' : String(stickyColumnIndex);
  const stickyColumnItems = showStickyColumnSelector
    ? [
        { value: '', label: noStickyColumnLabel },
        ...headerOptions.map((header) => ({
          value: String(header.index),
          label: header.label,
        })),
      ]
    : [];
  const stickyColumnDisplayValue = showStickyColumnSelector
    ? (stickyColumnItems.find((item) => item.value === stickyColumnValue)?.label ??
      noStickyColumnLabel)
    : '';
  const handleCopy = useCallback(() => {
    void writeClipboardText(tableMatrixToMarkdown(getTableMatrix(tableRef.current))).then(onCopied);
  }, [onCopied, tableRef]);
  const handleDownload = useCallback(() => {
    const download = async () => {
      setIsDownloading(true);
      setDownloadFailed(false);
      try {
        if (onBeforeDownload && !(await onBeforeDownload())) {
          return;
        }
        const matrix = getDownloadMatrix?.() ?? getTableMatrix(tableRef.current);
        if (matrix.length === 0) {
          return;
        }
        const url = URL.createObjectURL(createCsvBlob(matrix));
        triggerDownload(url, downloadFilename);
      } catch {
        setDownloadFailed(true);
      } finally {
        setIsDownloading(false);
      }
    };
    void download();
  }, [downloadFilename, getDownloadMatrix, onBeforeDownload, tableRef]);
  const handleGroupedDownload = useCallback(async () => {
    setIsDownloading(true);
    setDownloadFailed(false);
    try {
      if (onBeforeDownload && !(await onBeforeDownload())) {
        return;
      }
      const matrix = getDownloadMatrix?.() ?? getTableMatrix(tableRef.current);
      if (matrix.length === 0) {
        return;
      }
      const blob = await createThicknessZip(matrix);
      triggerDownload(URL.createObjectURL(blob), downloadFilename.replace(/\.csv$/, '.zip'));
    } catch {
      setDownloadFailed(true);
    } finally {
      setIsDownloading(false);
    }
  }, [downloadFilename, getDownloadMatrix, onBeforeDownload, tableRef]);
  const handleStickyColumnChange = useCallback(
    (value: string) => {
      onStickyColumnChange?.(value === '' ? undefined : Number(value));
    },
    [onStickyColumnChange],
  );

  return (
    <div
      ref={expanded ? setTooltipHost : undefined}
      className={
        expanded
          ? 'markdown-table-toolbar markdown-table-toolbar-expanded'
          : 'markdown-table-toolbar'
      }
    >
      {showStickyColumnSelector && (
        <div className="markdown-table-selector">
          <ControlCombobox
            selectedValue={stickyColumnValue}
            displayValue={stickyColumnDisplayValue}
            searchPlaceholder={stickyColumnSearchLabel}
            setValue={handleStickyColumnChange}
            items={stickyColumnItems}
            className="h-8 rounded-xl"
            containerClassName="px-0"
            ariaLabel={stickyColumnLabel}
            isCollapsed={false}
            showCarat={true}
            placement="bottom-end"
            popoverClassName="markdown-table-selector-popover"
          />
        </div>
      )}
      {customerVersion && (
        <SteelCustomer
          version={customerVersion}
          getInitialTier={() => {
            const matrix = getTableMatrix(tableRef.current);
            if (matrix.length !== 2 || matrix[0].length !== matrix[1].length) return undefined;
            const columns = matrix[0].flatMap((header, index) => header.trim() === '價格等級' ? [index] : []);
            if (columns.length !== 1) return undefined;
            const parsed = steelCustomerTierSchema.safeParse(matrix[1][columns[0]].trim());
            return parsed.success ? parsed.data : undefined;
          }}
          renderTrigger={(props) => (
            <TableActionButton {...props} portalElement={tooltipHost}>
              <EditIcon className="size-4" aria-hidden="true" />
            </TableActionButton>
          )}
        />
      )}
      {!customerOnly && (
        <>
          <TableActionButton label={copyLabel} onClick={handleCopy} portalElement={tooltipHost}>
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </TableActionButton>
          {downloadMenu ? (
            <DropdownMenu
              onOpenChange={(open) => {
                if (open) {
                  setCanGroup(canGroupByThickness(getTableMatrix(tableRef.current)));
                }
              }}
            >
              <TooltipAnchor
                side="top"
                description={downloadLabel}
                portalElement={tooltipHost}
                render={
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="markdown-table-action"
                      aria-label={downloadLabel}
                      disabled={isDownloading}
                      aria-busy={isDownloading}
                    >
                      <Download className="size-4" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                }
              />
              <DropdownMenuContent
                align="end"
                style={expanded ? { zIndex: 1001 } : undefined}
                onEscapeKeyDown={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem className="cursor-pointer" onSelect={handleDownload}>
                  {localize('com_ui_download_table_all_csv')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer data-[disabled]:cursor-default"
                  disabled={!canGroup || isDownloading}
                  onSelect={() => void handleGroupedDownload()}
                >
                  {localize('com_ui_download_table_by_thickness_zip')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <TableActionButton label={downloadLabel} onClick={handleDownload} portalElement={tooltipHost}>
              <Download className="size-4" aria-hidden="true" />
            </TableActionButton>
          )}
          {downloadFailed && <span role="alert">{localize('com_ui_download_table_error')}</span>}
          {reviewLabel && onReview && (
            <TableActionButton
              label={reviewLabel}
              description={reviewDisabled ? localize('com_ui_generating') : reviewLabel}
              disabled={reviewDisabled}
              onClick={onReview}
              portalElement={tooltipHost}
            >
              <FileSearch className="size-4" aria-hidden="true" />
            </TableActionButton>
          )}
          {expanded ? (
            <TableActionButton label={closeLabel} onClick={onClose ?? (() => undefined)} portalElement={tooltipHost}>
              <X className="size-4" aria-hidden="true" />
            </TableActionButton>
          ) : (
            <TableActionButton label={expandLabel} onClick={onExpand ?? (() => undefined)} portalElement={tooltipHost}>
              <Maximize2 className="size-4" aria-hidden="true" />
            </TableActionButton>
          )}
        </>
      )}
    </div>
  );
}

const MarkdownTableActions = memo(function MarkdownTableActions({
  children,
  markdownIndex,
}: MarkdownTableActionsProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const modalTableRef = useRef<HTMLTableElement>(null);
  const copiedResetTimerRef = useRef<number>();
  const modalCopiedResetTimerRef = useRef<number>();
  const [isExpanded, setIsExpanded] = useState(false);
  const [downloadMenu, setDownloadMenu] = useState(false);

  const [headerOptions, setHeaderOptions] = useState<TableHeaderOption[]>([]);
  const [stickyColumnIndex, setStickyColumnIndex] = useState<number>();
  const [copied, setCopied] = useState(false);
  const [modalCopied, setModalCopied] = useState(false);
  const saveGateRef = useRef<SteelReviewSaveGate>();
  const reviewTableRef = useRef<SteelReviewTable>();
  const downloadAuthorityRef = useRef<{
    authority: SteelReviewDownloadAuthority;
    gate?: SteelReviewSaveGate;
  }>();
  const [markdownTitle, setMarkdownTitle] = useState<string>();
  const [, setSelection] = useAtom(steelReviewSelectionAtom);
  const localize = useLocalize();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const { conversationId, isCreatedByUser, messageId, messageTimestamp, isSubmitting } =
    useMessageContext() ?? {};
  const downloadFilename = useMemo(
    () => getDownloadFilename(conversation?.title, messageTimestamp),
    [conversation?.title, messageTimestamp],
  );
  const reviewConversationId = conversationId ?? '';
  const themeAttributes = useThemeAttributes(isExpanded);
  const modalClassName = ['markdown-table-modal', themeAttributes.className]
    .filter(Boolean)
    .join(' ');
  const customerVersion = useSteelMarkdownVersion(markdownTitle ?? '', 'customer_data');
  const reviewKind = getReviewKind(markdownTitle);
  const displayChildren = useMemo(() => reviewKind === 'system_order'
    ? orderSystemTable(children) : children, [children, reviewKind]);
  const reviewCandidate = useMemo(
    () =>
      reviewKind && messageId && reviewConversationId && isCreatedByUser !== true
        ? {
            conversationId: reviewConversationId,
            messageId,
            kind: reviewKind,
            title: markdownTitle!,
          }
        : null,
    [reviewConversationId, isCreatedByUser, markdownTitle, messageId, reviewKind],
  );
  const reviewQuery = useGetSteelReviewQuery(reviewCandidate, {
    enabled: reviewCandidate != null,
    retry: false,
  });
  const { refetch: refetchReview } = reviewQuery;
  const [recognizedReview, setRecognizedReview] = useState<typeof reviewCandidate>(null);
  const previousSubmittingRef = useRef(isSubmitting === true);
  const previousChildrenRef = useRef(children);
  const completionRefreshKeyRef = useRef<string>();
  const reviewErrorStatus = getReviewErrorStatus(reviewQuery.error);
  const candidateKey = reviewCandidate ? getReviewCandidateKey(reviewCandidate) : undefined;
  let reviewIdentity: SteelReviewCandidate | null = null;
  if (recognizedReview && candidateKey === getReviewCandidateKey(recognizedReview)) {
    reviewIdentity = recognizedReview;
  } else if (reviewCandidate && reviewQuery.data?.table) {
    reviewIdentity = {
      ...reviewCandidate,
    };
  }
  useEffect(() => {
    if (!reviewCandidate) {
      setRecognizedReview(null);
      completionRefreshKeyRef.current = undefined;
      return;
    }
    if (reviewQuery.data?.table) {
      setRecognizedReview({
        ...reviewCandidate,
      });
      return;
    }
    if (reviewErrorStatus === 404) {
      setRecognizedReview(null);
    }
  }, [candidateKey, reviewCandidate, reviewErrorStatus, reviewQuery.data?.table]);
  useEffect(() => {
    const wasSubmitting = previousSubmittingRef.current;
    const childrenChanged = previousChildrenRef.current !== children;
    previousSubmittingRef.current = isSubmitting === true;
    previousChildrenRef.current = children;
    if ((!wasSubmitting && !childrenChanged) || isSubmitting === true || !reviewCandidate || !candidateKey ||
      completionRefreshKeyRef.current === candidateKey) {
      return;
    }
    completionRefreshKeyRef.current = candidateKey;
    void refetchReview();
  }, [candidateKey, children, isSubmitting, reviewCandidate, refetchReview]);
  const reviewLabel = localize('com_ui_steel_review_open');
  const reviewTable = reviewQuery.data?.table;
  reviewTableRef.current = reviewTable ?? undefined;
  useEffect(() => {
    const title = getMarkdownTitle(tableRef.current);
    setMarkdownTitle(title);
    setDownloadMenu(/^system_order(?:\s|$)/i.test(title ?? ''));
  }, [children]);
  const handleCopied = useCallback(() => {
    if (copiedResetTimerRef.current) {
      window.clearTimeout(copiedResetTimerRef.current);
    }
    setCopied(true);
    copiedResetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedResetTimerRef.current = undefined;
    }, 1200);
  }, []);
  const handleModalCopied = useCallback(() => {
    if (modalCopiedResetTimerRef.current) {
      window.clearTimeout(modalCopiedResetTimerRef.current);
    }
    setModalCopied(true);
    modalCopiedResetTimerRef.current = window.setTimeout(() => {
      setModalCopied(false);
      modalCopiedResetTimerRef.current = undefined;
    }, 1200);
  }, []);
  const closeModal = useCallback(() => setIsExpanded(false), []);
  const openModal = useCallback(() => {
    setHeaderOptions(getTableHeaderOptions(tableRef.current));
    setStickyColumnIndex(undefined);
    setIsExpanded(true);
  }, []);
  const openReview = useCallback(() => {
    if (reviewCandidate && isSubmitting !== true) {
      setSelection({ ...reviewCandidate, captureId: crypto.randomUUID() });
    }
  }, [isSubmitting, reviewCandidate, setSelection]);
  const prepareReviewDownload = useCallback(async () => {
    const currentTable = reviewTableRef.current;
    if (!currentTable || !reviewIdentity) {
      return false;
    }
    const authority = {
      outputId: currentTable.outputId,
      revision: currentTable.revision,
    };
    const gate = saveGateRef.current?.isOpen ? saveGateRef.current : undefined;
    downloadAuthorityRef.current = { authority, gate };
    if (gate) {
      const gateMatrix = gate.getMatrix();
      if (!(await gate.ensureSaved(authority)) && gateMatrix.length > 0) {
        return false;
      }
    }
    const latestTable = reviewTableRef.current;
    if (!latestTable || latestTable.outputId !== authority.outputId) {
      return false;
    }
    if (!gate && latestTable.revision !== authority.revision) {
      return false;
    }
    return true;
  }, [reviewIdentity]);
  const getReviewDownloadMatrix = useCallback(() => {
    const currentTable = reviewTableRef.current;
    const downloadAuthority = downloadAuthorityRef.current;
    if (!currentTable || !downloadAuthority || currentTable.outputId !== downloadAuthority.authority.outputId) {
      return [];
    }
    const managedMatrix = downloadAuthority.gate?.getMatrix();
    if (managedMatrix && managedMatrix.length > 0) {
      return currentTable.kind === 'system_order' ? orderSystemMatrix(managedMatrix) : managedMatrix;
    }
    return getReviewTableMatrix(currentTable);
  }, []);

  useEffect(() => {
    if (!isExpanded || !modalTableRef.current) {
      return undefined;
    }

    const table = modalTableRef.current;
    const nextHeaderOptions = getTableHeaderOptions(table);

    applyStaticModalTableClasses(table);
    setHeaderOptions((current) =>
      areHeaderOptionsEqual(current, nextHeaderOptions) ? current : nextHeaderOptions,
    );
    setStickyColumnIndex((current) =>
      current !== undefined && current >= nextHeaderOptions.length ? undefined : current,
    );

    return undefined;
  }, [displayChildren, isExpanded]);

  useEffect(() => {
    if (!isExpanded || !modalTableRef.current) {
      return undefined;
    }

    applyStickyColumnClasses(modalTableRef.current, stickyColumnIndex);

    return undefined;
  }, [displayChildren, isExpanded, stickyColumnIndex]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.stopPropagation();
      setIsExpanded(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  useEffect(
    () => () => {
      if (copiedResetTimerRef.current) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
      if (modalCopiedResetTimerRef.current) {
        window.clearTimeout(modalCopiedResetTimerRef.current);
      }
    },
    [],
  );

  return (
    <div className="markdown-table-container" data-markdown-index={markdownIndex}>
      <TableToolbar
        tableRef={tableRef}
        copied={copied}
        downloadFilename={downloadFilename}
        expanded={false}
        customerVersion={customerVersion}
        customerOnly={/^customer_data(?:[\t ｜]|$)/.test(markdownTitle ?? '')}
        downloadMenu={downloadMenu}
        reviewLabel={reviewCandidate ? reviewLabel : undefined}
        reviewDisabled={isSubmitting === true}
        onReview={reviewCandidate ? openReview : undefined}
        onBeforeDownload={reviewIdentity ? prepareReviewDownload : undefined}
        getDownloadMatrix={reviewIdentity ? getReviewDownloadMatrix : undefined}
        onCopied={handleCopied}
        onExpand={openModal}
      />
      <div className="markdown-table-wrapper w-full max-w-full">
        <table ref={tableRef}>{displayChildren}</table>
      </div>
      {isExpanded &&
        createPortal(
          <div
            className={modalClassName}
            data-theme={themeAttributes.dataTheme}
            role="dialog"
            aria-modal="true"
            aria-label={localize('com_ui_expand_table')}
          >
            <div className="markdown-table-modal-surface markdown">
              <TableToolbar
                tableRef={modalTableRef}
                copied={modalCopied}
                downloadFilename={downloadFilename}
                expanded={true}
                downloadMenu={downloadMenu}
                onBeforeDownload={reviewIdentity ? prepareReviewDownload : undefined}
                getDownloadMatrix={reviewIdentity ? getReviewDownloadMatrix : undefined}
                headerOptions={headerOptions}
                onClose={closeModal}
                onCopied={handleModalCopied}
                onStickyColumnChange={setStickyColumnIndex}
                stickyColumnIndex={stickyColumnIndex}
              />
              <div className="markdown-table-modal-scroll">
                <table ref={modalTableRef}>{displayChildren}</table>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {reviewCandidate && (
        <SteelReviewDialog
          identity={reviewCandidate}
          downloadFilename={downloadFilename}
          saveGateRef={saveGateRef}
        />
      )}
    </div>
  );
});

export default MarkdownTableActions;
