import {
  appendMarkdownTableComments,
  buildMarkdownTableCommentId,
  formatMarkdownTableComments,
  getMarkdownTableCommentsStorageKey,
  readStoredMarkdownTableComments,
  writeStoredMarkdownTableComments,
} from './markdown';
import type { MarkdownTableComment } from './markdown';

const baseComment: MarkdownTableComment = {
  id: 'message-a:2:3:4',
  conversationId: 'conversation-a',
  messageId: 'message-a',
  messageTimestampLabel: '2026-06-27 14:32',
  markdownIndex: 2,
  markdownLabel: '2026-06-27 14:32 / Markdown 2',
  tableFingerprint: 'fingerprint-a',
  rowIndex: 3,
  columnIndex: 4,
  columnHeader: '品名規格',
  oldValue: '白鐵板 3mm',
  comment: '改成 No1 白鐵板 3mm',
};

describe('markdown table comments', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds one stable id per message markdown cell', () => {
    expect(
      buildMarkdownTableCommentId({
        messageId: 'message-a',
        markdownIndex: 2,
        rowIndex: 3,
        columnIndex: 4,
      }),
    ).toBe('message-a:2:3:4');
  });

  it('groups comments by message and markdown index in first-seen order', () => {
    const comments: MarkdownTableComment[] = [
      baseComment,
      {
        ...baseComment,
        id: 'message-b:1:2:1',
        messageId: 'message-b',
        messageTimestampLabel: '2026-06-27 15:10',
        markdownIndex: 1,
        markdownLabel: '2026-06-27 15:10 / Markdown 1',
        rowIndex: 2,
        columnIndex: 1,
        columnHeader: '備註',
        oldValue: '依圖施工',
        comment: '補上含折彎',
      },
      {
        ...baseComment,
        id: 'message-a:2:5:2',
        rowIndex: 5,
        columnIndex: 2,
        columnHeader: '數量',
        oldValue: '8',
        comment: '改成 10',
      },
    ];

    expect(formatMarkdownTableComments(comments)).toBe(
      [
        'Markdown table comments:',
        '',
        '### 2026-06-27 14:32 / Markdown 2',
        '',
        '1. Cell: row 3, column "品名規格"',
        '   Old value: 白鐵板 3mm',
        '   Comment: 改成 No1 白鐵板 3mm',
        '',
        '2. Cell: row 5, column "數量"',
        '   Old value: 8',
        '   Comment: 改成 10',
        '',
        '### 2026-06-27 15:10 / Markdown 1',
        '',
        '1. Cell: row 2, column "備註"',
        '   Old value: 依圖施工',
        '   Comment: 補上含折彎',
        '',
        '請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。',
      ].join('\n'),
    );
  });

  it('returns an empty block when there are no comments', () => {
    expect(formatMarkdownTableComments([])).toBe('');
  });

  it('appends comments after typed text with a separator', () => {
    expect(appendMarkdownTableComments('請更新表格。', [baseComment])).toBe(
      [
        '請更新表格。',
        '',
        '---',
        '',
        'Markdown table comments:',
        '',
        '### 2026-06-27 14:32 / Markdown 2',
        '',
        '1. Cell: row 3, column "品名規格"',
        '   Old value: 白鐵板 3mm',
        '   Comment: 改成 No1 白鐵板 3mm',
        '',
        '請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。',
      ].join('\n'),
    );
  });

  it('starts with the comment block when typed text is empty', () => {
    expect(appendMarkdownTableComments('   ', [baseComment])).toBe(
      [
        'Markdown table comments:',
        '',
        '### 2026-06-27 14:32 / Markdown 2',
        '',
        '1. Cell: row 3, column "品名規格"',
        '   Old value: 白鐵板 3mm',
        '   Comment: 改成 No1 白鐵板 3mm',
        '',
        '請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。',
      ].join('\n'),
    );
  });

  it('stores and restores pending markdown table comments by conversation id', () => {
    writeStoredMarkdownTableComments('conversation-a', [baseComment]);

    expect(localStorage.getItem(getMarkdownTableCommentsStorageKey('conversation-a'))).not.toBeNull();
    expect(readStoredMarkdownTableComments('conversation-a')).toEqual([baseComment]);
    expect(readStoredMarkdownTableComments('conversation-b')).toEqual([]);
  });

  it('removes pending markdown table comments from storage when the queue is empty', () => {
    writeStoredMarkdownTableComments('conversation-a', [baseComment]);
    writeStoredMarkdownTableComments('conversation-a', []);

    expect(localStorage.getItem(getMarkdownTableCommentsStorageKey('conversation-a'))).toBeNull();
    expect(readStoredMarkdownTableComments('conversation-a')).toEqual([]);
  });

  it('drops invalid pending markdown table comments from storage', () => {
    localStorage.setItem(getMarkdownTableCommentsStorageKey('conversation-a'), '{"bad":true}');

    expect(readStoredMarkdownTableComments('conversation-a')).toEqual([]);
    expect(localStorage.getItem(getMarkdownTableCommentsStorageKey('conversation-a'))).toBeNull();
  });
});
