import { fireEvent, render, screen } from '@testing-library/react';
import type { MarkdownTableComment } from '~/common';
import CommentableTableCell from './comments';

const baseComment: MarkdownTableComment = {
  id: 'message-1:1:2:3',
  conversationId: 'conversation-1',
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
};

function renderCell({
  comment,
  onCommit = jest.fn(),
}: {
  comment?: MarkdownTableComment;
  onCommit?: jest.Mock;
} = {}) {
  render(
    <table>
      <tbody>
        <tr>
          <CommentableTableCell
            cellProps={{}}
            columnHeader="Qty"
            columnIndex={3}
            comment={comment}
            commentLabel="Comment on table cell"
            oldValue="10"
            rowIndex={2}
            onCommit={onCommit}
          >
            10
          </CommentableTableCell>
        </tr>
      </tbody>
    </table>,
  );

  return onCommit;
}

describe('CommentableTableCell', () => {
  it('saves the draft on Enter', () => {
    const onCommit = renderCell();

    fireEvent.click(screen.getByRole('button', { name: 'Comment on table cell' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on table cell' }), {
      target: { value: '改成 12' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment on table cell' }), {
      key: 'Enter',
    });

    expect(onCommit).toHaveBeenCalledWith('改成 12');
  });

  it('saves the draft on blur', () => {
    const onCommit = renderCell();

    fireEvent.click(screen.getByRole('button', { name: 'Comment on table cell' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on table cell' }), {
      target: { value: '改成 15' },
    });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Comment on table cell' }));

    expect(onCommit).toHaveBeenCalledWith('改成 15');
  });

  it('cancels the draft on Escape', () => {
    const onCommit = renderCell({ comment: baseComment });

    fireEvent.click(screen.getByRole('button', { name: 'Comment on table cell' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on table cell' }), {
      target: { value: '改成 20' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment on table cell' }), {
      key: 'Escape',
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Comment on table cell' })).toBeNull();
  });

  it('does not render inline comment text when comment text is empty', () => {
    renderCell();

    expect(screen.getByRole('button', { name: 'Comment on table cell' })).not.toHaveAttribute(
      'title',
    );
    expect(screen.queryByText('改成 12')).toBeNull();
  });

  it('renders the saved comment directly in the cell and fades the original value', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <CommentableTableCell
              cellProps={{}}
              columnHeader="Qty"
              columnIndex={3}
              comment={baseComment}
              commentLabel="Comment on table cell"
              oldValue="10"
              rowIndex={2}
              onCommit={jest.fn()}
            >
              <span data-testid="original-cell-value">10</span>
            </CommentableTableCell>
          </tr>
        </tbody>
      </table>,
    );

    const button = screen.getByRole('button', { name: 'Comment on table cell' });
    expect(button).not.toHaveAttribute('title');
    expect(screen.getByText('改成 12')).toHaveClass('markdown-table-comment-cell-comment-text');
    expect(screen.getByTestId('original-cell-value').parentElement).toHaveClass(
      'markdown-table-comment-cell-content-muted',
    );
    expect(container.querySelector('.markdown-table-comment-cell-comment-text')).toHaveTextContent(
      '改成 12',
    );
  });
});
