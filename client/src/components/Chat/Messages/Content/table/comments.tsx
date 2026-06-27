import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button, Input } from '@librechat/client';
import * as Popover from '@radix-ui/react-popover';
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
  const finalizedRef = useRef(false);
  const [draft, setDraft] = useState(comment?.comment ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const hasComment = !!comment?.comment.trim();

  useEffect(() => {
    if (!isEditing) {
      setDraft(comment?.comment ?? '');
      return;
    }

    cancelRef.current = false;
    finalizedRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [comment?.comment, isEditing]);

  const saveDraft = useCallback(() => {
    if (finalizedRef.current) {
      return;
    }

    finalizedRef.current = true;
    setIsEditing(false);
    onCommit(draft.trim());
  }, [draft, onCommit]);

  const cancelEditing = useCallback(() => {
    if (finalizedRef.current) {
      return;
    }

    cancelRef.current = true;
    finalizedRef.current = true;
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

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setIsEditing(true);
        return;
      }

      if (!isEditing) {
        return;
      }

      saveDraft();
    },
    [isEditing, saveDraft],
  );

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
    <Popover.Trigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={commentLabel}
        className={joinClassNames(
          'markdown-table-cell-comment-button',
          hasComment || isEditing ? 'markdown-table-cell-comment-button-active' : undefined,
        )}
      >
        <MessageCircle className="size-3.5" aria-hidden="true" />
      </Button>
    </Popover.Trigger>
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
      <Popover.Root open={isEditing} onOpenChange={handleOpenChange}>
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
            <Popover.Portal>
              <Popover.Content
                align="end"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                className="markdown-table-cell-comment-popover"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={saveDraft}
              >
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
              </Popover.Content>
            </Popover.Portal>
          )}
        </div>
      </Popover.Root>
    </td>
  );
});

export default CommentableTableCell;
