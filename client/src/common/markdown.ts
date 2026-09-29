export type MarkdownTableComment = {
  id: string;
  conversationId: string;
  messageId: string;
  messageTimestampLabel: string;
  messageTimestamp?: string;
  markdownIndex: number;
  markdownLabel: string;
  markdownTitle?: string;
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
  '請依照以上 comments，分別輸出每個表格修改後的 row；每個 row 保留完整欄位，不要輸出未修改的 row 或整張表格。';
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

function getTableHeader(tableFingerprint: string): string {
  return tableFingerprint.split('\n', 1)[0]?.trim() ?? '';
}

function getGroupKey(comment: MarkdownTableComment): string {
  return `${comment.messageId}:${comment.markdownIndex}`;
}

export function getMarkdownTableCommentLabel(comment: MarkdownTableComment): string {
  const title = comment.markdownTitle?.trim();
  return title || '原始 Markdown 標題未載入';
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
    (value.rowLabel === undefined || typeof value.rowLabel === 'string') &&
    (value.messageTimestamp === undefined || typeof value.messageTimestamp === 'string') &&
    (value.markdownTitle === undefined || typeof value.markdownTitle === 'string')
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
  const groups = new Map<
    string,
    {
      label: string;
      messageId: string;
      messageTimestamp?: string;
      markdownIndex: number;
      comments: MarkdownTableComment[];
    }
  >();

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
      group.messageTimestamp ??= comment.messageTimestamp;
      continue;
    }

    groups.set(key, {
      label: getMarkdownTableCommentLabel(comment),
      messageId: comment.messageId,
      messageTimestamp: comment.messageTimestamp,
      markdownIndex: comment.markdownIndex,
      comments: [nextComment],
    });
  }

  if (groups.size === 0) {
    return '';
  }

  const lines = ['Markdown table comments:'];

  const messageOrder = new Map<string, number>();
  const messageTimes = new Map<string, number>();
  for (const group of groups.values()) {
    if (!messageOrder.has(group.messageId)) {
      messageOrder.set(group.messageId, messageOrder.size);
    }
    const time = Date.parse(group.messageTimestamp ?? '');
    if (Number.isFinite(time)) {
      messageTimes.set(group.messageId, time);
    }
  }
  const orderedGroups = Array.from(groups.values()).sort((a, b) => {
    const aTime = messageTimes.get(a.messageId) ?? Infinity;
    const bTime = messageTimes.get(b.messageId) ?? Infinity;
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    const messageDifference =
      (messageOrder.get(a.messageId) ?? 0) - (messageOrder.get(b.messageId) ?? 0);
    return messageDifference || a.markdownIndex - b.markdownIndex;
  });

  for (const group of orderedGroups) {
    lines.push('', `## ${group.label}`, '');
    const orderedComments = [...group.comments].sort(
      (a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex,
    );
    orderedComments.forEach((comment, index) => {
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

  lines.push('', markdownTableCommentsInstruction, '', '各表格完整欄位參考（依原表格順序）：');

  for (const group of orderedGroups) {
    const header = getTableHeader(group.comments[0].tableFingerprint);
    if (header) {
      lines.push('', `### ${group.label}`, '', header);
    }
  }

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
