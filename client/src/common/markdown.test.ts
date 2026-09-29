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
  messageTimestamp: '2026-06-27T14:32:00.000Z',
  markdownIndex: 2,
  markdownLabel: '2026-06-27 14:32 / Markdown 2',
  markdownTitle: '報價項目',
  tableFingerprint: '| 品名規格 | 數量 |\n| --- | --- |\n| 白鐵板 3mm | 8 |',
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

  it('groups edits for each table under its heading', () => {
    const comments: MarkdownTableComment[] = [
      baseComment,
      {
        ...baseComment,
        id: 'message-b:1:2:1',
        messageId: 'message-b',
        messageTimestampLabel: '2026-06-27 15:10',
        messageTimestamp: '2026-06-27T15:10:00.000Z',
        markdownIndex: 1,
        markdownLabel: '2026-06-27 15:10 / Markdown 1',
        markdownTitle: '加工備註',
        tableFingerprint: '| 備註 | 數量 |\n| --- | --- |\n| 依圖施工 | 1 |',
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
        '## 報價項目',
        '',
        '1. Cell: row 3, column "品名規格"',
        '   Old value: 白鐵板 3mm',
        '   Comment: 改成 No1 白鐵板 3mm',
        '',
        '2. Cell: row 5, column "數量"',
        '   Old value: 8',
        '   Comment: 改成 10',
        '',
        '## 加工備註',
        '',
        '1. Cell: row 2, column "備註"',
        '   Old value: 依圖施工',
        '   Comment: 補上含折彎',
        '',
        '請依照以上 comments，分別輸出每個表格修改後的 row；每個 row 保留完整欄位，不要輸出未修改的 row 或整張表格。',
        '',
        '各表格完整欄位參考（依原表格順序）：',
        '',
        '### 報價項目',
        '',
        '| 品名規格 | 數量 |',
        '',
        '### 加工備註',
        '',
        '| 備註 | 數量 |',
      ].join('\n'),
    );
  });

  it('orders table groups by source message time and table index, not edit order', () => {
    const laterTable = {
      ...baseComment,
      id: 'message-b:1:3:4',
      messageId: 'message-b',
      messageTimestamp: '2026-06-27T15:10:00.000Z',
      markdownIndex: 1,
      markdownTitle: '後一則訊息',
    };
    const earlierTable = {
      ...baseComment,
      id: 'message-a:1:3:4',
      markdownIndex: 1,
      markdownTitle: '第一張表',
    };
    const output = formatMarkdownTableComments([laterTable, baseComment, earlierTable]);

    expect(output.indexOf('## 第一張表')).toBeLessThan(output.indexOf('## 報價項目'));
    expect(output.indexOf('## 報價項目')).toBeLessThan(output.indexOf('## 後一則訊息'));
  });

  it('orders edited cells by row and column within each table', () => {
    const laterCell = { ...baseComment, id: 'message-a:2:5:2', rowIndex: 5, columnIndex: 2 };
    const earlierCell = { ...baseComment, id: 'message-a:2:1:1', rowIndex: 1, columnIndex: 1 };
    const output = formatMarkdownTableComments([laterCell, earlierCell]);

    expect(output.indexOf('Cell: row 1')).toBeLessThan(output.indexOf('Cell: row 5'));
  });

  it('does not present table columns as the heading when an older comment lacks a title', () => {
    const output = formatMarkdownTableComments([{ ...baseComment, markdownTitle: undefined }]);

    expect(output).toContain('## 原始 Markdown 標題未載入');
    expect(output).not.toContain('表格欄位');
    expect(output).not.toContain('Markdown 2');
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
        '## 報價項目',
        '',
        '1. Cell: row 3, column "品名規格"',
        '   Old value: 白鐵板 3mm',
        '   Comment: 改成 No1 白鐵板 3mm',
        '',
        '請依照以上 comments，分別輸出每個表格修改後的 row；每個 row 保留完整欄位，不要輸出未修改的 row 或整張表格。',
        '',
        '各表格完整欄位參考（依原表格順序）：',
        '',
        '### 報價項目',
        '',
        '| 品名規格 | 數量 |',
      ].join('\n'),
    );
  });

  it('starts with the comment block when typed text is empty', () => {
    expect(appendMarkdownTableComments('   ', [baseComment])).toBe(
      [
        'Markdown table comments:',
        '',
        '## 報價項目',
        '',
        '1. Cell: row 3, column "品名規格"',
        '   Old value: 白鐵板 3mm',
        '   Comment: 改成 No1 白鐵板 3mm',
        '',
        '請依照以上 comments，分別輸出每個表格修改後的 row；每個 row 保留完整欄位，不要輸出未修改的 row 或整張表格。',
        '',
        '各表格完整欄位參考（依原表格順序）：',
        '',
        '### 報價項目',
        '',
        '| 品名規格 | 數量 |',
      ].join('\n'),
    );
  });

  it('stores and restores pending markdown table comments by conversation id', () => {
    writeStoredMarkdownTableComments('conversation-a', [baseComment]);

    expect(
      localStorage.getItem(getMarkdownTableCommentsStorageKey('conversation-a')),
    ).not.toBeNull();
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
