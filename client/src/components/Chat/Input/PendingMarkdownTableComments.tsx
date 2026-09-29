import { memo, useMemo } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { MessageCircle } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger } from '@librechat/client';
import { formatMarkdownTableComments, getMarkdownTableCommentLabel } from '~/common';
import type { MarkdownTableComment } from '~/common';
import { useLocalize } from '~/hooks';
import store from '~/store';

function groupCommentCounts(
  comments: readonly MarkdownTableComment[],
): string {
  const counts = new Map<string, { label: string; count: number }>();

  for (const comment of comments) {
    const key = `${comment.messageId}:${comment.markdownIndex}`;
    const current = counts.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    counts.set(key, { label: getMarkdownTableCommentLabel(comment), count: 1 });
  }

  return Array.from(counts.values())
    .map((group) => `${group.label}: ${group.count}`)
    .join(', ');
}

function PendingMarkdownTableComments({ conversationId }: { conversationId: string }) {
  const localize = useLocalize();
  const comments = useRecoilValue(store.pendingMarkdownTableCommentsByConvoId(conversationId));
  const setComments = useSetRecoilState(store.pendingMarkdownTableCommentsByConvoId(conversationId));
  const summary = useMemo(() => groupCommentCounts(comments), [comments]);
  const appendPreview = useMemo(() => formatMarkdownTableComments(comments), [comments]);
  const hasComments = comments.length > 0;

  if (!hasComments) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-4 pt-2 text-xs text-text-secondary">
      <HoverCard openDelay={0} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div
            className="flex min-w-0 items-center gap-1.5"
            data-testid="pending-markdown-table-comments"
            tabIndex={0}
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0 text-cyan-500" aria-hidden="true" />
            <span className="min-w-0 truncate">
              {localize('com_ui_markdown_table_comments_pending', { 0: summary })}
            </span>
          </div>
        </HoverCardTrigger>
        <HoverCardPortal>
          <HoverCardContent
            side="top"
            align="start"
            collisionPadding={12}
            className="z-[90] max-h-[24rem] w-[min(42rem,calc(100vw-2rem))] overflow-auto p-3 text-xs"
          >
            <pre
              className="whitespace-pre-wrap break-words font-sans text-text-primary"
              data-testid="pending-markdown-table-comments-preview"
            >
              {appendPreview}
            </pre>
          </HoverCardContent>
        </HoverCardPortal>
      </HoverCard>
      <button
        type="button"
        className="ml-auto shrink-0 rounded px-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy"
        aria-label={localize('com_ui_clear_markdown_table_comments')}
        onClick={() => setComments([])}
      >
        {localize('com_ui_clear')}
      </button>
    </div>
  );
}

export default memo(PendingMarkdownTableComments);
