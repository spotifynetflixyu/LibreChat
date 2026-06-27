export type MarkdownTableComment = {
  id: string;
  conversationId: string;
  messageId: string;
  messageTimestampLabel: string;
  markdownIndex: number;
  markdownLabel: string;
  tableFingerprint: string;
  rowIndex: number;
  columnIndex: number;
  columnHeader: string;
  rowLabel?: string;
  oldValue: string;
  comment: string;
};

type MarkdownTableCommentIdInput = {
  messageId: string;
  markdownIndex: number;
  rowIndex: number;
  columnIndex: number;
};

type MarkdownTableCommentRecord = Partial<Record<keyof MarkdownTableComment, unknown>>;

const markdownTableCommentsStoragePrefix = 'librechat.pendingMarkdownTableComments.';
const markdownTableCommentsInstruction =
  '請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。';
const markdownTableCommentStringFields = [
  'id',
  'conversationId',
  'messageId',
  'messageTimestampLabel',
  'markdownLabel',
  'tableFingerprint',
  'columnHeader',
  'oldValue',
  'comment',
] as const;
const markdownTableCommentNumberFields = ['markdownIndex', 'rowIndex', 'columnIndex'] as const;

function escapeQuotedValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function getGroupKey(comment: MarkdownTableComment): string {
  return `${comment.messageId}:${comment.markdownIndex}`;
}

function getGroupLabel(comment: MarkdownTableComment): string {
  if (comment.markdownLabel.trim()) {
    return comment.markdownLabel.trim();
  }

  return `${comment.messageTimestampLabel || 'Unknown time'} / Markdown ${comment.markdownIndex}`;
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is MarkdownTableCommentRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasStringFields(
  record: MarkdownTableCommentRecord,
  fields: readonly (keyof MarkdownTableComment)[],
): boolean {
  return fields.every((field) => typeof record[field] === 'string');
}

function hasNumberFields(
  record: MarkdownTableCommentRecord,
  fields: readonly (keyof MarkdownTableComment)[],
): boolean {
  return fields.every((field) => typeof record[field] === 'number');
}

function isMarkdownTableComment(value: unknown): value is MarkdownTableComment {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasStringFields(value, markdownTableCommentStringFields) &&
    hasNumberFields(value, markdownTableCommentNumberFields) &&
    (value.rowLabel === undefined || typeof value.rowLabel === 'string')
  );
}

export function buildMarkdownTableCommentId(input: MarkdownTableCommentIdInput): string {
  return `${input.messageId}:${input.markdownIndex}:${input.rowIndex}:${input.columnIndex}`;
}

export function getMarkdownTableCommentsStorageKey(conversationId: string): string {
  return `${markdownTableCommentsStoragePrefix}${conversationId}`;
}

export function readStoredMarkdownTableComments(conversationId: string): MarkdownTableComment[] {
  const storage = getLocalStorage();

  if (!storage) {
    return [];
  }

  const key = getMarkdownTableCommentsStorageKey(conversationId);
  const raw = storage.getItem(key);

  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed) || parsed.some((entry) => !isMarkdownTableComment(entry))) {
      storage.removeItem(key);
      return [];
    }

    return parsed;
  } catch {
    storage.removeItem(key);
    return [];
  }
}

export function writeStoredMarkdownTableComments(
  conversationId: string,
  comments: readonly MarkdownTableComment[],
): void {
  const storage = getLocalStorage();

  if (!storage) {
    return;
  }

  const key = getMarkdownTableCommentsStorageKey(conversationId);

  if (comments.length === 0) {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, JSON.stringify(comments));
}

export function formatMarkdownTableComments(comments: readonly MarkdownTableComment[]): string {
  const groups = new Map<string, { label: string; comments: MarkdownTableComment[] }>();

  for (const comment of comments) {
    const normalizedComment = comment.comment.trim();

    if (!normalizedComment) {
      continue;
    }

    const key = getGroupKey(comment);
    const group = groups.get(key);
    const nextComment = { ...comment, comment: normalizedComment };

    if (group) {
      group.comments.push(nextComment);
      continue;
    }

    groups.set(key, {
      label: getGroupLabel(comment),
      comments: [nextComment],
    });
  }

  if (groups.size === 0) {
    return '';
  }

  const lines = ['Markdown table comments:'];

  for (const group of groups.values()) {
    lines.push('', `### ${group.label}`, '');
    group.comments.forEach((comment, index) => {
      if (index > 0) {
        lines.push('');
      }

      lines.push(
        `${index + 1}. Cell: row ${comment.rowIndex}, column "${escapeQuotedValue(
          comment.columnHeader,
        )}"`,
        `   Old value: ${comment.oldValue}`,
        `   Comment: ${comment.comment}`,
      );
    });
  }

  lines.push('', markdownTableCommentsInstruction);

  return lines.join('\n');
}

export function appendMarkdownTableComments(
  text: string,
  comments: readonly MarkdownTableComment[],
): string {
  const commentsBlock = formatMarkdownTableComments(comments);

  if (!commentsBlock) {
    return text;
  }

  const normalizedText = text.trimEnd();

  if (!normalizedText.trim()) {
    return commentsBlock;
  }

  return `${normalizedText}\n\n---\n\n${commentsBlock}`;
}
