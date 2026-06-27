import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button, Input } from '@librechat/client';
import type { MarkdownTableComment } from '~/common';

type CommentableTableCellProps = {
  cellProps: React.TdHTMLAttributes<HTMLTableCellElement>;
  children: React.ReactNode;
  columnHeader: string;
  comment?: MarkdownTableComment;
  commentLabel: string;
  columnIndex: number;
  oldValue: string;
  onCommit: (comment: string) => void;
  rowIndex: number;
};

function joinClassNames(...classNames: Array<string | undefined>): string | undefined {
  return classNames.filter(Boolean).join(' ') || undefined;
}

export function getReactNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getReactNodeText).join(' ');
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getReactNodeText(node.props.children);
  }
  return '';
}

const CommentableTableCell = memo(function CommentableTableCell({
  cellProps,
  children,
  columnHeader,
  columnIndex,
  comment,
  commentLabel,
  oldValue,
  onCommit,
  rowIndex,
}: CommentableTableCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [draft, setDraft] = useState(comment?.comment ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const hasComment = !!comment?.comment.trim();

  useEffect(() => {
    if (!isEditing) {
      setDraft(comment?.comment ?? '');
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [comment?.comment, isEditing]);

  const saveDraft = useCallback(() => {
    setIsEditing(false);
    onCommit(draft.trim());
  }, [draft, onCommit]);

  const cancelEditing = useCallback(() => {
    cancelRef.current = true;
    setDraft(comment?.comment ?? '');
    setIsEditing(false);
  }, [comment?.comment]);

  const handleBlur = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }

    saveDraft();
  }, [saveDraft]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveDraft();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditing();
      }
    },
    [cancelEditing, saveDraft],
  );

  const commentButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={commentLabel}
      className={joinClassNames(
        'markdown-table-cell-comment-button',
        hasComment ? 'markdown-table-cell-comment-button-active' : undefined,
      )}
      onClick={() => setIsEditing(true)}
    >
      <MessageCircle className="size-3.5" aria-hidden="true" />
    </Button>
  );

  return (
    <td
      {...cellProps}
      className={joinClassNames(cellProps.className, 'markdown-table-commentable-cell')}
      data-comment-row-index={rowIndex}
      data-comment-column-index={columnIndex}
      data-comment-column-header={columnHeader}
      data-comment-old-value={oldValue}
    >
      <div className="markdown-table-comment-cell-inner">
        {commentButton}
        <div
          className={joinClassNames(
            'markdown-table-comment-cell-content',
            hasComment ? 'markdown-table-comment-cell-content-muted' : undefined,
          )}
        >
          {children}
        </div>
        {hasComment && (
          <div className="markdown-table-comment-cell-comment-text">{comment?.comment}</div>
        )}
        {isEditing && (
          <Input
            ref={inputRef}
            type="text"
            value={draft}
            aria-label={commentLabel}
            className="markdown-table-cell-comment-input"
            onBlur={handleBlur}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        )}
      </div>
    </td>
  );
});

export default CommentableTableCell;
