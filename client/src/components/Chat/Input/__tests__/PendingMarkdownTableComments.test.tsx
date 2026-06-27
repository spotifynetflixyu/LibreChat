import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { writeStoredMarkdownTableComments } from '~/common';
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

  it('shows grouped pending comment counts by markdown label', () => {
    renderWithComments([
      comment(),
      comment({ id: 'message-1:1:4:3', rowIndex: 4 }),
      comment({
        id: 'message-1:2:2:3',
        markdownIndex: 2,
        markdownLabel: '2026-06-27 14:32 / Markdown 2',
      }),
    ]);

    const helper = screen.getByTestId('pending-markdown-table-comments');
    expect(helper).toHaveTextContent('com_ui_markdown_table_comments_pending:');
    expect(helper).toHaveTextContent('2026-06-27 14:32 / Markdown 1: 2');
    expect(helper).toHaveTextContent('2026-06-27 14:32 / Markdown 2: 1');
  });

  it('shows the exact appended comments block on hover', async () => {
    const user = userEvent.setup();

    renderWithComments([
      comment(),
      comment({
        id: 'message-1:2:2:3',
        markdownIndex: 2,
        markdownLabel: '2026-06-27 14:32 / Markdown 2',
        oldValue: '8',
        comment: '改成 10',
      }),
    ]);

    await user.hover(screen.getByTestId('pending-markdown-table-comments'));

    const preview = await screen.findByTestId('pending-markdown-table-comments-preview');
    expect(preview).toHaveTextContent('Markdown table comments:');
    expect(preview).toHaveTextContent('### 2026-06-27 14:32 / Markdown 1');
    expect(preview).toHaveTextContent('Old value: 10');
    expect(preview).toHaveTextContent('Comment: 改成 12');
    expect(preview).toHaveTextContent('### 2026-06-27 14:32 / Markdown 2');
    expect(preview).toHaveTextContent('Old value: 8');
    expect(preview).toHaveTextContent('Comment: 改成 10');
    expect(preview).toHaveTextContent(
      '請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。',
    );
  });

  it('restores pending comments from localStorage', () => {
    writeStoredMarkdownTableComments(CONVO_ID, [comment()]);

    renderFromStorage();

    expect(screen.getByTestId('pending-markdown-table-comments')).toHaveTextContent(
      '2026-06-27 14:32 / Markdown 1: 1',
    );
  });
});
