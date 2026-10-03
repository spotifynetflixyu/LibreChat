import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import filenamify from 'filenamify';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useRecoilState, useRecoilValue } from 'recoil';
import { getSteelReviewTableId } from 'librechat-data-provider';
import { Check, Copy, Download, FileSearch, Maximize2, X } from 'lucide-react';
import {
  ControlCombobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@librechat/client';
import type { SteelReviewKind } from 'librechat-data-provider';
import type { MarkdownTableComment } from '~/common';
import type { TableMatrix } from './table/export';
import { canGroupByThickness, createCsvBlob, createThicknessZip } from './table/export';
import CommentableTableCell, { getReactNodeText } from './table/comments';
import { getMessageTimestamp, triggerDownload } from '~/utils';
import { steelReviewSelectionAtom } from './SteelReview/state';
import { useGetSteelReviewQuery } from '~/data-provider';
import { buildMarkdownTableCommentId } from '~/common';
import SteelReviewDialog from './SteelReviewDialog';
import { useMessageContext } from '~/Providers';
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
  reviewLabel?: string;
  onReview?: () => void;
  reviewRetryLabel?: string;
  onReviewRetry?: () => void;
  onStickyColumnChange?: (columnIndex: number | undefined) => void;
  stickyColumnIndex?: number;
};

type TableHeaderOption = {
  index: number;
  label: string;
};

type TableSectionProps = React.HTMLAttributes<HTMLTableSectionElement> & {
  children?: React.ReactNode;
};

type TableRowProps = React.HTMLAttributes<HTMLTableRowElement> & {
  children?: React.ReactNode;
};

type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
  children?: React.ReactNode;
};

type CommentableTableChildrenInput = {
  children: React.ReactNode;
  columnHeaders: readonly TableHeaderOption[];
  commentsByCell: ReadonlyMap<string, MarkdownTableComment>;
  commentLabel: string;
  onCommit: (input: {
    columnHeader: string;
    columnIndex: number;
    comment: string;
    oldValue: string;
    rowIndex: number;
  }) => void;
};

type SteelReviewCandidate = {
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  tableId: string;
  partIndex?: number;
};

const wideColumnTextThreshold = 36;

function getReviewCandidateKey(candidate: SteelReviewCandidate): string {
  return `${candidate.conversationId}:${candidate.messageId}:${candidate.kind}:${candidate.tableId}:${candidate.partIndex ?? ''}`;
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
      title = element.textContent?.trim() || title;
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
  return normalizeCellText(cell.textContent ?? '');
}

function getCellCommentKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`;
}

function getTableMatrix(table: HTMLTableElement | null): TableMatrix {
  if (!table) {
    return [];
  }

  return Array.from(table.rows).map((row) => Array.from(row.cells).map(getNormalizedCellText));
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

function getColumnHeader(columnHeaders: readonly TableHeaderOption[], columnIndex: number): string {
  return (
    columnHeaders.find((header) => header.index === columnIndex)?.label ||
    `Column ${columnIndex + 1}`
  );
}

function getElementTagName(element: React.ReactElement): string | undefined {
  if (typeof element.type === 'string') {
    return element.type.toLowerCase();
  }

  const node = (element.props as { node?: { tagName?: string } }).node;
  return node?.tagName?.toLowerCase();
}

function renderCommentableTableChildren({
  children,
  columnHeaders,
  commentsByCell,
  commentLabel,
  onCommit,
}: CommentableTableChildrenInput): React.ReactNode {
  let dataRowIndex = 0;

  const renderNode = (node: React.ReactNode, inTableBody: boolean): React.ReactNode => {
    if (!React.isValidElement<TableSectionProps | TableRowProps | TableCellProps>(node)) {
      return node;
    }

    const tagName = getElementTagName(node);
    const isTableBody = tagName === 'tbody';

    if (inTableBody && tagName === 'tr') {
      dataRowIndex += 1;
      const rowIndex = dataRowIndex;
      const cells = React.Children.map(node.props.children, (cell, columnIndex) => {
        if (!React.isValidElement<TableCellProps>(cell) || getElementTagName(cell) !== 'td') {
          return cell;
        }

        const { children: cellChildren, ...cellProps } = cell.props;
        const oldValue = normalizeCellText(getReactNodeText(cellChildren));
        const columnHeader = getColumnHeader(columnHeaders, columnIndex);
        const key = getCellCommentKey(rowIndex, columnIndex);

        return (
          <CommentableTableCell
            key={`commentable-${rowIndex}-${columnIndex}`}
            cellProps={cellProps}
            columnHeader={columnHeader}
            columnIndex={columnIndex}
            comment={commentsByCell.get(key)}
            commentLabel={commentLabel}
            oldValue={oldValue}
            rowIndex={rowIndex}
            onCommit={(comment) =>
              onCommit({
                columnHeader,
                columnIndex,
                comment,
                oldValue,
                rowIndex,
              })
            }
          >
            {cellChildren}
          </CommentableTableCell>
        );
      });

      return React.cloneElement(node, node.props, cells);
    }

    const nextChildren = React.Children.map(node.props.children, (child) =>
      renderNode(child, inTableBody || isTableBody),
    );

    return React.cloneElement(node, node.props, nextChildren);
  };

  return React.Children.map(children, (child) => renderNode(child, false));
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
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="markdown-table-action"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
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
  reviewLabel,
  onReview,
  reviewRetryLabel,
  onReviewRetry,
}: TableToolbarProps) {
  const localize = useLocalize();
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
    const url = URL.createObjectURL(createCsvBlob(getTableMatrix(tableRef.current)));
    triggerDownload(url, downloadFilename);
  }, [downloadFilename, tableRef]);
  const handleGroupedDownload = useCallback(async () => {
    setIsDownloading(true);
    setDownloadFailed(false);
    try {
      const blob = await createThicknessZip(getTableMatrix(tableRef.current));
      triggerDownload(URL.createObjectURL(blob), downloadFilename.replace(/\.csv$/, '.zip'));
    } catch {
      setDownloadFailed(true);
    } finally {
      setIsDownloading(false);
    }
  }, [downloadFilename, tableRef]);
  const handleStickyColumnChange = useCallback(
    (value: string) => {
      onStickyColumnChange?.(value === '' ? undefined : Number(value));
    },
    [onStickyColumnChange],
  );

  return (
    <div
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
      <TableActionButton label={copyLabel} onClick={handleCopy}>
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </TableActionButton>
      {reviewLabel && onReview && (
        <TableActionButton label={reviewLabel} onClick={onReview}>
          <FileSearch className="size-4" aria-hidden="true" />
        </TableActionButton>
      )}
      {!reviewLabel && reviewRetryLabel && onReviewRetry && (
        <TableActionButton label={reviewRetryLabel} onClick={onReviewRetry}>
          <FileSearch className="size-4" aria-hidden="true" />
        </TableActionButton>
      )}
      {downloadMenu ? (
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) {
              setCanGroup(canGroupByThickness(getTableMatrix(tableRef.current)));
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="markdown-table-action"
              aria-label={downloadLabel}
              title={downloadLabel}
              disabled={isDownloading}
              aria-busy={isDownloading}
            >
              <Download className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
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
        <TableActionButton label={downloadLabel} onClick={handleDownload}>
          <Download className="size-4" aria-hidden="true" />
        </TableActionButton>
      )}
      {downloadFailed && <span role="alert">{localize('com_ui_download_table_error')}</span>}
      {expanded ? (
        <TableActionButton label={closeLabel} onClick={onClose ?? (() => undefined)}>
          <X className="size-4" aria-hidden="true" />
        </TableActionButton>
      ) : (
        <TableActionButton label={expandLabel} onClick={onExpand ?? (() => undefined)}>
          <Maximize2 className="size-4" aria-hidden="true" />
        </TableActionButton>
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
  const [markdownTitle, setMarkdownTitle] = useState<string>();
  const [, setSelection] = useAtom(steelReviewSelectionAtom);
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const { conversationId, isCreatedByUser, messageId, messageTimestamp, isSubmitting } =
    useMessageContext() ?? {};
  const downloadFilename = useMemo(
    () => getDownloadFilename(conversation?.title, messageTimestamp),
    [conversation?.title, messageTimestamp],
  );
  const commentConversationId = conversationId ?? '';
  const [pendingComments, setPendingComments] = useRecoilState(
    store.pendingMarkdownTableCommentsByConvoId(commentConversationId),
  );
  const themeAttributes = useThemeAttributes(isExpanded);
  const modalClassName = ['markdown-table-modal', themeAttributes.className]
    .filter(Boolean)
    .join(' ');
  const commentLabel = localize('com_ui_markdown_table_cell_comment');
  const messageTimestampLabel = useMemo(() => {
    const formatted = getMessageTimestamp(messageTimestamp, i18n.language);
    return formatted?.absolute ?? messageTimestamp ?? 'Unknown time';
  }, [i18n.language, messageTimestamp]);
  const markdownLabel = `${messageTimestampLabel} / Markdown ${markdownIndex}`;
  const reviewKind: SteelReviewKind | undefined =
    markdownTitle === 'ocr_result'
      ? 'ocr_result'
      : markdownTitle === 'system_order' || markdownTitle?.startsWith('system_order｜')
        ? 'system_order'
        : undefined;
  const reviewCandidate = useMemo(
    () =>
      reviewKind && messageId && commentConversationId && isCreatedByUser !== true
        ? {
            conversationId: commentConversationId,
            messageId,
            kind: reviewKind,
            tableId: getSteelReviewTableId(reviewKind, markdownIndex),
          }
        : null,
    [commentConversationId, isCreatedByUser, markdownIndex, messageId, reviewKind],
  );
  const reviewQuery = useGetSteelReviewQuery(reviewCandidate, {
    enabled: reviewCandidate != null,
    retry: false,
  });
  const [recognizedReview, setRecognizedReview] = useState<typeof reviewCandidate>(null);
  const previousSubmittingRef = useRef(isSubmitting === true);
  const completionRefreshKeyRef = useRef<string>();
  const reviewErrorStatus = getReviewErrorStatus(reviewQuery.error);
  const candidateKey = reviewCandidate ? getReviewCandidateKey(reviewCandidate) : undefined;
  const reviewIdentity = recognizedReview && candidateKey === getReviewCandidateKey(recognizedReview)
    ? recognizedReview
    : reviewQuery.data?.table
      ? reviewCandidate
      : null;
  const reviewRetryAvailable = reviewQuery.isError === true && reviewErrorStatus !== 404 && !reviewIdentity;
  useEffect(() => {
    if (!reviewCandidate) {
      setRecognizedReview(null);
      completionRefreshKeyRef.current = undefined;
      return;
    }
    if (reviewQuery.data?.table) {
      setRecognizedReview(reviewCandidate);
      return;
    }
    if (reviewErrorStatus === 404) {
      setRecognizedReview(null);
    }
  }, [candidateKey, reviewCandidate, reviewErrorStatus, reviewQuery.data?.table]);
  useEffect(() => {
    const wasSubmitting = previousSubmittingRef.current;
    previousSubmittingRef.current = isSubmitting === true;
    if (!wasSubmitting || isSubmitting === true || !reviewCandidate || !candidateKey ||
      completionRefreshKeyRef.current === candidateKey) {
      return;
    }
    completionRefreshKeyRef.current = candidateKey;
    void reviewQuery.refetch();
  }, [candidateKey, isSubmitting, reviewCandidate, reviewQuery.refetch]);
  const reviewLabel = localize('com_ui_steel_review_open');
  const reviewRetryLabel = localize('com_ui_steel_review_retry');
  const canComment = isCreatedByUser !== true && !!messageId && !!commentConversationId;
  const commentsByCell = useMemo(() => {
    const comments = new Map<string, MarkdownTableComment>();

    if (!canComment) {
      return comments;
    }

    pendingComments.forEach((comment) => {
      if (comment.messageId !== messageId || comment.markdownIndex !== markdownIndex) {
        return;
      }

      comments.set(getCellCommentKey(comment.rowIndex, comment.columnIndex), comment);
    });

    return comments;
  }, [canComment, markdownIndex, messageId, pendingComments]);
  useEffect(() => {
    const title = getMarkdownTitle(tableRef.current);
    setMarkdownTitle(title);
    setDownloadMenu(/^system_order(?:\s|$)/i.test(title ?? ''));
  }, [children]);
  useEffect(() => {
    if (!canComment || !messageId) {
      return;
    }

    const hasPendingComments = pendingComments.some(
      (entry) => entry.messageId === messageId && entry.markdownIndex === markdownIndex,
    );
    if (!hasPendingComments) {
      return;
    }

    const title = getMarkdownTitle(tableRef.current);
    if (!title) {
      return;
    }

    const needsTitle = pendingComments.some(
      (entry) =>
        entry.messageId === messageId &&
        entry.markdownIndex === markdownIndex &&
        entry.markdownTitle !== title,
    );
    if (!needsTitle) {
      return;
    }

    setPendingComments((current) =>
      current.map((entry) =>
        entry.messageId === messageId && entry.markdownIndex === markdownIndex
          ? { ...entry, markdownTitle: title, ...(messageTimestamp && { messageTimestamp }) }
          : entry,
      ),
    );
  }, [canComment, markdownIndex, messageId, messageTimestamp, pendingComments, setPendingComments]);
  const getTableFingerprint = useCallback(
    () => tableMatrixToMarkdown(getTableMatrix(tableRef.current)),
    [],
  );
  const handleCommitCellComment = useCallback(
    ({
      columnHeader,
      columnIndex,
      comment,
      oldValue,
      rowIndex,
    }: {
      columnHeader: string;
      columnIndex: number;
      comment: string;
      oldValue: string;
      rowIndex: number;
    }) => {
      if (!canComment || !messageId) {
        return;
      }

      const id = buildMarkdownTableCommentId({
        messageId,
        markdownIndex,
        rowIndex,
        columnIndex,
      });
      const normalizedComment = comment.trim();
      const markdownTitle = getMarkdownTitle(tableRef.current);

      setPendingComments((current) => {
        const existing = current.find((entry) => entry.id === id);

        if (!normalizedComment) {
          return current.filter((entry) => entry.id !== id);
        }

        if (existing) {
          return current.map((entry) =>
            entry.id === id
              ? { ...entry, comment: normalizedComment, ...(markdownTitle && { markdownTitle }) }
              : entry,
          );
        }

        return [
          ...current,
          {
            id,
            conversationId: commentConversationId,
            messageId,
            messageTimestampLabel,
            ...(messageTimestamp && { messageTimestamp }),
            markdownIndex,
            markdownLabel,
            markdownTitle,
            tableFingerprint: getTableFingerprint(),
            rowIndex,
            columnIndex,
            columnHeader,
            oldValue,
            comment: normalizedComment,
          },
        ];
      });
    },
    [
      canComment,
      commentConversationId,
      getTableFingerprint,
      markdownIndex,
      markdownLabel,
      messageId,
      messageTimestampLabel,
      messageTimestamp,
      setPendingComments,
    ],
  );
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
    if (reviewIdentity) {
      setSelection(reviewIdentity);
    }
  }, [reviewIdentity, setSelection]);
  const retryReviewRecognition = useCallback(() => {
    void reviewQuery.refetch();
  }, [reviewQuery.refetch]);

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
  }, [children, isExpanded]);

  useEffect(() => {
    if (!isExpanded || !modalTableRef.current) {
      return undefined;
    }

    applyStickyColumnClasses(modalTableRef.current, stickyColumnIndex);

    return undefined;
  }, [children, isExpanded, stickyColumnIndex]);

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

  const modalChildren = useMemo(() => {
    if (!canComment) {
      return children;
    }

    return renderCommentableTableChildren({
      children,
      columnHeaders: headerOptions,
      commentsByCell,
      commentLabel,
      onCommit: handleCommitCellComment,
    });
  }, [canComment, children, commentLabel, commentsByCell, handleCommitCellComment, headerOptions]);

  return (
    <div className="markdown-table-container" data-markdown-index={markdownIndex}>
      <TableToolbar
        tableRef={tableRef}
        copied={copied}
        downloadFilename={downloadFilename}
        expanded={false}
        downloadMenu={downloadMenu}
        reviewLabel={reviewIdentity ? reviewLabel : undefined}
        onReview={reviewIdentity ? openReview : undefined}
        reviewRetryLabel={reviewCandidate && reviewRetryAvailable
          ? reviewRetryLabel
          : undefined}
        onReviewRetry={reviewCandidate && reviewRetryAvailable
          ? retryReviewRecognition
          : undefined}
        onCopied={handleCopied}
        onExpand={openModal}
      />
      <div className="markdown-table-wrapper w-full max-w-full">
        <table ref={tableRef}>{children}</table>
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
                reviewLabel={reviewIdentity ? reviewLabel : undefined}
                onReview={reviewIdentity ? openReview : undefined}
                reviewRetryLabel={reviewCandidate && reviewRetryAvailable
                  ? reviewRetryLabel
                  : undefined}
                onReviewRetry={reviewCandidate && reviewRetryAvailable
                  ? retryReviewRecognition
                  : undefined}
                headerOptions={headerOptions}
                onClose={closeModal}
                onCopied={handleModalCopied}
                onStickyColumnChange={setStickyColumnIndex}
                stickyColumnIndex={stickyColumnIndex}
              />
              <div className="markdown-table-modal-scroll">
                <table ref={modalTableRef}>{modalChildren}</table>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {reviewIdentity && <SteelReviewDialog identity={reviewIdentity} />}
    </div>
  );
});

export default MarkdownTableActions;
