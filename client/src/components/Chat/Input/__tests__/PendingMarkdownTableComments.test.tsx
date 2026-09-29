import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  getMarkdownTableCommentsStorageKey,
  writeStoredMarkdownTableComments,
} from '~/common';
import type { MarkdownTableComment } from '~/common';
import store from '~/store';
import PendingMarkdownTableComments from '../PendingMarkdownTableComments';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, unknown>) =>
    `${key}:${params?.[0] ?? ''}`,
}));

const CONVO_ID = 'convo-1';

const comment = (overrides: Partial<MarkdownTableComment> = {}): MarkdownTableComment => ({
  id: 'message-1:1:2:3',
  conversationId: CONVO_ID,
  messageId: 'message-1',
  messageTimestampLabel: '2026-06-27 14:32',
  markdownIndex: 1,
  markdownLabel: '2026-06-27 14:32 / Markdown 1',
  markdownTitle: '第一張表',
  tableFingerprint: '| A | B |',
  rowIndex: 2,
  columnIndex: 3,
  columnHeader: 'Qty',
  oldValue: '10',
  comment: '改成 12',
  ...overrides,
});

const renderWithComments = (comments: MarkdownTableComment[]) =>
  render(
    <RecoilRoot
      initializeState={({ set }) =>
        set(store.pendingMarkdownTableCommentsByConvoId(CONVO_ID), comments)
      }
    >
      <PendingMarkdownTableComments conversationId={CONVO_ID} />
    </RecoilRoot>,
  );

const renderFromStorage = () =>
  render(
    <RecoilRoot>
      <PendingMarkdownTableComments conversationId={CONVO_ID} />
    </RecoilRoot>,
  );

describe('PendingMarkdownTableComments', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders nothing when no markdown table comments are pending', () => {
    const { container } = renderWithComments([]);

    expect(container.firstChild).toBeNull();
  });

  it('shows grouped pending comment counts by table title', () => {
    renderWithComments([
      comment(),
      comment({ id: 'message-1:1:4:3', rowIndex: 4 }),
      comment({
        id: 'message-1:2:2:3',
        markdownIndex: 2,
        markdownLabel: '2026-06-27 14:32 / Markdown 2',
        markdownTitle: '第二張表',
      }),
    ]);

    const helper = screen.getByTestId('pending-markdown-table-comments');
    expect(helper).toHaveTextContent('com_ui_markdown_table_comments_pending:');
    expect(helper).toHaveTextContent('第一張表: 2');
    expect(helper).toHaveTextContent('第二張表: 1');
  });

  it('shows the exact appended comments block on hover', async () => {
    const user = userEvent.setup();

    renderWithComments([
      comment(),
      comment({
        id: 'message-1:2:2:3',
        markdownIndex: 2,
        markdownLabel: '2026-06-27 14:32 / Markdown 2',
        markdownTitle: '第二張表',
        oldValue: '8',
        comment: '改成 10',
      }),
    ]);

    await user.hover(screen.getByTestId('pending-markdown-table-comments'));

    const preview = await screen.findByTestId('pending-markdown-table-comments-preview');
    expect(preview).toHaveTextContent('Markdown table comments:');
    expect(preview).toHaveTextContent('## 第一張表');
    expect(preview).toHaveTextContent('Old value: 10');
    expect(preview).toHaveTextContent('Comment: 改成 12');
    expect(preview).toHaveTextContent('## 第二張表');
    expect(preview).toHaveTextContent('Old value: 8');
    expect(preview).toHaveTextContent('Comment: 改成 10');
    expect(preview).toHaveTextContent(
      '請依照以上 comments，分別輸出每個表格修改後的 row；每個 row 保留完整欄位，不要輸出未修改的 row 或整張表格。',
    );
  });

  it('restores pending comments from localStorage', () => {
    writeStoredMarkdownTableComments(CONVO_ID, [comment()]);

    renderFromStorage();

    expect(screen.getByTestId('pending-markdown-table-comments')).toHaveTextContent(
      '第一張表: 1',
    );
  });

  it('clears pending comments and their stored copy', async () => {
    const user = userEvent.setup();
    writeStoredMarkdownTableComments(CONVO_ID, [comment()]);
    writeStoredMarkdownTableComments('convo-2', [comment({ conversationId: 'convo-2' })]);
    renderFromStorage();

    await user.click(screen.getByRole('button', { name: 'com_ui_clear_markdown_table_comments:' }));

    expect(screen.queryByTestId('pending-markdown-table-comments')).not.toBeInTheDocument();
    expect(localStorage.getItem(getMarkdownTableCommentsStorageKey(CONVO_ID))).toBeNull();
    expect(localStorage.getItem(getMarkdownTableCommentsStorageKey('convo-2'))).not.toBeNull();
  });
});
