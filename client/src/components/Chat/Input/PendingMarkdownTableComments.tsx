import { memo, useMemo } from 'react';
import { MessageCircle } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import { useLocalize } from '~/hooks';
import store from '~/store';

function groupCommentCounts(
  comments: ReadonlyArray<{ markdownLabel: string; messageId: string; markdownIndex: number }>,
): string {
  const counts = new Map<string, { label: string; count: number }>();

  for (const comment of comments) {
    const key = `${comment.messageId}:${comment.markdownIndex}`;
    const current = counts.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    counts.set(key, { label: comment.markdownLabel, count: 1 });
  }

  return Array.from(counts.values())
    .map((group) => `${group.label}: ${group.count}`)
    .join(', ');
}

function PendingMarkdownTableComments({ conversationId }: { conversationId: string }) {
  const localize = useLocalize();
  const comments = useRecoilValue(store.pendingMarkdownTableCommentsByConvoId(conversationId));
  const summary = useMemo(() => groupCommentCounts(comments), [comments]);
  const hasComments = comments.length > 0;

  if (!hasComments) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-1.5 px-4 pt-2 text-xs text-text-secondary"
      data-testid="pending-markdown-table-comments"
    >
      <MessageCircle className="h-3.5 w-3.5 shrink-0 text-cyan-500" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {localize('com_ui_markdown_table_comments_pending', { 0: summary })}
      </span>
    </div>
  );
}

export default memo(PendingMarkdownTableComments);
