import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import Markdown from '../Markdown';
import MarkdownLite from '../MarkdownLite';
import { RecoilRoot, useRecoilValue } from 'recoil';
import type { TConversation } from 'librechat-data-provider';
import type { MarkdownTableComment } from '~/common';
import { UI_RESOURCE_MARKER } from '~/components/MCPUIResource/plugin';
import {
  MessageContext,
  useOptionalMessagesConversation,
  useOptionalMessagesOperations,
} from '~/Providers';
import { useGetMessagesByConvoId } from '~/data-provider';
import { useLocalize } from '~/hooks';
import store from '~/store';

// Mocks for hooks used by MCPUIResource when rendered inside Markdown.
// Keep Provider components intact while mocking only the hooks we use.
jest.mock('~/Providers', () => ({
  ...jest.requireActual('~/Providers'),
  useOptionalMessagesConversation: jest.fn(),
  useOptionalMessagesOperations: jest.fn(),
}));
jest.mock('~/data-provider');
jest.mock('~/hooks');
jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  const ReactActual = jest.requireActual('react');

  return {
    ...actual,
    ControlCombobox: ({
      ariaLabel,
      displayValue,
      items,
      searchPlaceholder,
      setValue,
    }: {
      ariaLabel: string;
      displayValue: string;
      items: { value: string; label: string }[];
      searchPlaceholder: string;
      setValue: (value: string) => void;
    }) => {
      const [isOpen, setIsOpen] = ReactActual.useState(false);

      return ReactActual.createElement(
        'div',
        { className: 'mock-control-combobox' },
        ReactActual.createElement(
          'button',
          { type: 'button', 'aria-label': ariaLabel, onClick: () => setIsOpen(true) },
          displayValue,
        ),
        isOpen &&
          ReactActual.createElement(
            ReactActual.Fragment,
            null,
            ReactActual.createElement('input', { placeholder: searchPlaceholder, readOnly: true }),
            items.map((item) =>
              ReactActual.createElement(
                'button',
                { key: item.value, type: 'button', onClick: () => setValue(item.value) },
                item.label,
              ),
            ),
          ),
      );
    },
  };
});

// Mock @mcp-ui/client to render identifiable elements for assertions
jest.mock('@mcp-ui/client', () => ({
  UIResourceRenderer: ({ resource }: any) => (
    <span data-testid="ui-resource-renderer" data-resource-uri={resource?.uri} />
  ),
}));

const mockUseMessagesConversation = useOptionalMessagesConversation as jest.MockedFunction<
  typeof useOptionalMessagesConversation
>;
const mockUseMessagesOperations = useOptionalMessagesOperations as jest.MockedFunction<
  typeof useOptionalMessagesOperations
>;
const mockUseGetMessagesByConvoId = useGetMessagesByConvoId as jest.MockedFunction<
  typeof useGetMessagesByConvoId
>;
const mockUseLocalize = useLocalize as jest.MockedFunction<typeof useLocalize>;

function PendingCommentsProbe({
  conversationId,
  onChange,
}: {
  conversationId: string;
  onChange: (comments: MarkdownTableComment[]) => void;
}) {
  const comments = useRecoilValue(store.pendingMarkdownTableCommentsByConvoId(conversationId));

  React.useEffect(() => {
    onChange(comments);
  }, [comments, onChange]);

  return null;
}

function renderMarkdownWithMessageContext({
  children,
  content,
  conversationTitle = '',
  messageContext,
}: {
  children?: React.ReactNode;
  content: string;
  conversationTitle?: string;
  messageContext?: Record<string, unknown>;
}) {
  return render(
    <RecoilRoot
      initializeState={({ set }) =>
        set(store.conversationByIndex(0), {
          conversationId: 'conv1',
          title: conversationTitle,
        } as TConversation)
      }
    >
      <MessageContext.Provider
        value={
          {
            messageId: 'msg-table',
            isExpanded: true,
            conversationId: 'conv1',
            isCreatedByUser: false,
            messageTimestamp: '2026-06-27T14:32:00.000Z',
            markdownTableBaseIndex: 0,
            ...messageContext,
          } as any
        }
      >
        <Markdown content={content} isLatestMessage={false} />
      </MessageContext.Provider>
      {children}
    </RecoilRoot>,
  );
}

describe('Markdown with MCP UI markers (resource IDs)', () => {
  let currentTestMessages: any[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    currentTestMessages = [];

    mockUseMessagesConversation.mockReturnValue({
      conversation: { conversationId: 'conv1' },
      conversationId: 'conv1',
    } as any);
    mockUseMessagesOperations.mockReturnValue({
      ask: jest.fn(),
      getMessages: () => currentTestMessages,
    } as any);
    mockUseLocalize.mockReturnValue(((key: string) => key) as any);
  });

  it('renders two UIResourceRenderer components for markers with resource IDs across separate attachments', () => {
    // Two tool responses, each produced one ui_resources attachment
    const paris = {
      resourceId: 'abc123',
      uri: 'ui://weather/paris',
      mimeType: 'text/html',
      text: '<div>Paris Weather</div>',
    };
    const nyc = {
      resourceId: 'def456',
      uri: 'ui://weather/nyc',
      mimeType: 'text/html',
      text: '<div>NYC Weather</div>',
    };

    currentTestMessages = [
      {
        messageId: 'msg-weather',
        attachments: [
          { type: 'ui_resources', ui_resources: [paris] },
          { type: 'ui_resources', ui_resources: [nyc] },
        ],
      },
    ];

    mockUseGetMessagesByConvoId.mockReturnValue({ data: currentTestMessages } as any);

    const content = [
      'Here are the current weather conditions for both Paris and New York:',
      '',
      '- Paris: Slight rain, 53°F, humidity 76%, wind 9 mph.',
      '- New York: Clear sky, 63°F, humidity 91%, wind 6 mph.',
      '',
      `Browse these weather cards for more details ${UI_RESOURCE_MARKER}{abc123} ${UI_RESOURCE_MARKER}{def456}`,
    ].join('\n');

    renderMarkdownWithMessageContext({
      content,
      messageContext: { messageId: 'msg-weather' },
    });

    const renderers = screen.getAllByTestId('ui-resource-renderer');
    expect(renderers).toHaveLength(2);
    expect(renderers[0]).toHaveAttribute('data-resource-uri', 'ui://weather/paris');
    expect(renderers[1]).toHaveAttribute('data-resource-uri', 'ui://weather/nyc');
  });
});

describe('Markdown table rendering', () => {
  const tableMarkdown = [
    '| Alpha | Bravo | Charlie | Delta | Echo | Foxtrot | Golf | Hotel |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| one | two | three | four | five | six | seven | eight |',
    '| nine | ten | eleven | twelve | thirteen | fourteen | fifteen | sixteen |',
  ].join('\n');
  let writeClipboardText: jest.Mock;
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.removeAttribute('data-theme');
    mockUseLocalize.mockReturnValue(((key: string) => key) as any);

    writeClipboardText = jest.fn().mockResolvedValue(undefined);
    createObjectURL = jest.fn(() => 'blob:markdown-table');
    revokeObjectURL = jest.fn();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeClipboardText },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  it('wraps GFM tables in a horizontally scrollable container', () => {
    renderMarkdownWithMessageContext({ content: tableMarkdown });

    expect(screen.getByRole('table').parentElement).toHaveClass(
      'markdown-table-wrapper',
      'w-full',
      'max-w-full',
    );
  });

  it('wraps lightweight Markdown tables in a horizontally scrollable container', () => {
    render(
      <RecoilRoot>
        <MarkdownLite content={tableMarkdown} />
      </RecoilRoot>,
    );

    expect(screen.getByRole('table').parentElement).toHaveClass(
      'markdown-table-wrapper',
      'w-full',
      'max-w-full',
    );
  });

  it('adds copy, download, and expand actions above Markdown tables', () => {
    renderMarkdownWithMessageContext({ content: tableMarkdown });

    expect(screen.getByLabelText('com_ui_copy_markdown_table')).toBeInTheDocument();
    expect(screen.getByLabelText('com_ui_download_table_xlsx')).toBeInTheDocument();
    expect(screen.getByLabelText('com_ui_expand_table')).toBeInTheDocument();
  });

  it('uses the message context table base index for Markdown table labels', () => {
    const { container } = renderMarkdownWithMessageContext({
      content: tableMarkdown,
      messageContext: { markdownTableBaseIndex: 1 },
    });

    expect(container.querySelector('[data-markdown-index="2"]')).toBeInTheDocument();
  });

  it('copies the rendered table as Markdown text', async () => {
    renderMarkdownWithMessageContext({ content: tableMarkdown });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('com_ui_copy_markdown_table'));
    });

    expect(writeClipboardText).toHaveBeenCalledWith(
      [
        '| Alpha | Bravo | Charlie | Delta | Echo | Foxtrot | Golf | Hotel |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        '| one | two | three | four | five | six | seven | eight |',
        '| nine | ten | eleven | twelve | thirteen | fourteen | fifteen | sixteen |',
      ].join('\n'),
    );
  });

  it('downloads the rendered table as an XLSX blob', () => {
    let downloadedFilename = '';
    const clickAnchor = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function captureFilename(this: HTMLAnchorElement) {
        downloadedFilename = this.download;
      });
    renderMarkdownWithMessageContext({
      content: tableMarkdown,
      conversationTitle: 'Steel Pricing Review',
      messageContext: { messageTimestamp: '2026-06-27T14:32:05' },
    });

    fireEvent.click(screen.getByLabelText('com_ui_download_table_xlsx'));

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(downloadedFilename).toBe('Steel Pricing Review_2026-06-27_14-32-05.xlsx');
    expect(clickAnchor).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:markdown-table');

    clickAnchor.mockRestore();
  });

  it('uses Longding when the conversation title is empty', () => {
    let downloadedFilename = '';
    const clickAnchor = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function captureFilename(this: HTMLAnchorElement) {
        downloadedFilename = this.download;
      });
    renderMarkdownWithMessageContext({
      content: tableMarkdown,
      messageContext: { messageTimestamp: '2026-06-27T14:32:05' },
    });

    fireEvent.click(screen.getByLabelText('com_ui_download_table_xlsx'));

    expect(downloadedFilename).toBe('Longding_2026-06-27_14-32-05.xlsx');

    clickAnchor.mockRestore();
  });

  it('opens a themed full-viewport table modal with table actions', () => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');

    renderMarkdownWithMessageContext({ content: tableMarkdown });

    fireEvent.click(screen.getByLabelText('com_ui_expand_table'));

    const modal = screen.getByRole('dialog');
    expect(modal).toHaveClass('markdown-table-modal', 'dark');
    expect(modal).toHaveAttribute('data-theme', 'dark');
    expect(within(modal).getByLabelText('com_ui_copy_markdown_table')).toBeInTheDocument();
    expect(within(modal).getByLabelText('com_ui_download_table_xlsx')).toBeInTheDocument();
    expect(within(modal).getByLabelText('com_ui_close_table')).toBeInTheDocument();

    fireEvent.click(within(modal).getByLabelText('com_ui_close_table'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not show cell comment buttons for user-authored Markdown tables', () => {
    renderMarkdownWithMessageContext({
      content: tableMarkdown,
      messageContext: { isCreatedByUser: true, messageId: 'user-table' },
    });

    fireEvent.click(screen.getByLabelText('com_ui_expand_table'));

    expect(
      within(screen.getByRole('dialog')).queryByLabelText('com_ui_markdown_table_cell_comment'),
    ).not.toBeInTheDocument();
  });

  it('adds, persists, replaces, and removes pending modal cell comments', () => {
    const commentLabel = 'com_ui_markdown_table_cell_comment';
    const observedComments: MarkdownTableComment[][] = [];

    renderMarkdownWithMessageContext({
      content: tableMarkdown,
      children: (
        <PendingCommentsProbe
          conversationId="conv1"
          onChange={(comments) => observedComments.push(comments)}
        />
      ),
    });

    expect(screen.queryByLabelText(commentLabel)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('com_ui_expand_table'));

    let modal = screen.getByRole('dialog');
    let firstCommentButton = within(modal).getAllByLabelText(commentLabel)[0];
    expect(firstCommentButton).not.toHaveClass('markdown-table-cell-comment-button-active');

    fireEvent.click(firstCommentButton);
    let commentEditor = screen.getByRole('textbox', { name: commentLabel });
    expect(commentEditor.closest('td')).toBeNull();
    expect(commentEditor.closest('.markdown-table-cell-comment-popover')).not.toBeNull();
    fireEvent.change(commentEditor, {
      target: { value: '改成 12' },
    });
    fireEvent.keyDown(commentEditor, {
      key: 'Enter',
    });

    firstCommentButton = within(modal).getAllByLabelText(commentLabel)[0];
    expect(firstCommentButton).toHaveClass('markdown-table-cell-comment-button-active');
    expect(firstCommentButton).not.toHaveAttribute('title');
    expect(within(modal).getByText('改成 12')).toHaveClass(
      'markdown-table-comment-cell-comment-text',
    );

    let latestComments = observedComments.at(-1) ?? [];
    expect(latestComments).toHaveLength(1);
    expect(latestComments[0]).toMatchObject({
      conversationId: 'conv1',
      messageId: 'msg-table',
      markdownIndex: 1,
      markdownLabel: expect.stringContaining('Markdown 1'),
      rowIndex: 1,
      columnIndex: 0,
      columnHeader: 'Alpha',
      oldValue: 'one',
      comment: '改成 12',
    });
    expect(latestComments[0].tableFingerprint).toContain('| Alpha | Bravo |');

    fireEvent.click(within(modal).getByLabelText('com_ui_close_table'));
    fireEvent.click(screen.getByLabelText('com_ui_expand_table'));

    modal = screen.getByRole('dialog');
    firstCommentButton = within(modal).getAllByLabelText(commentLabel)[0];
    expect(firstCommentButton).toHaveClass('markdown-table-cell-comment-button-active');

    fireEvent.click(firstCommentButton);
    commentEditor = screen.getByRole('textbox', { name: commentLabel });
    fireEvent.change(commentEditor, {
      target: { value: '改成 13' },
    });
    fireEvent.keyDown(commentEditor, {
      key: 'Enter',
    });

    latestComments = observedComments.at(-1) ?? [];
    expect(latestComments).toHaveLength(1);
    expect(latestComments[0].comment).toBe('改成 13');
    expect(latestComments[0].oldValue).toBe('one');
    expect(within(modal).queryByText('改成 12')).toBeNull();
    expect(within(modal).getByText('改成 13')).toHaveClass(
      'markdown-table-comment-cell-comment-text',
    );
    expect(within(modal).getAllByLabelText(commentLabel)[0]).toHaveClass(
      'markdown-table-cell-comment-button-active',
    );

    fireEvent.click(within(modal).getAllByLabelText(commentLabel)[0]);
    commentEditor = screen.getByRole('textbox', { name: commentLabel });
    fireEvent.change(commentEditor, {
      target: { value: '   ' },
    });
    fireEvent.keyDown(commentEditor, {
      key: 'Enter',
    });

    latestComments = observedComments.at(-1) ?? [];
    expect(latestComments).toHaveLength(0);
    expect(within(modal).queryByText('改成 13')).toBeNull();
    firstCommentButton = within(modal).getAllByLabelText(commentLabel)[0];
    expect(firstCommentButton).not.toHaveClass('markdown-table-cell-comment-button-active');
    expect(firstCommentButton).not.toHaveAttribute('title');
  });

  it('closes the expanded table modal with Escape', () => {
    renderMarkdownWithMessageContext({ content: tableMarkdown });

    fireEvent.click(screen.getByLabelText('com_ui_expand_table'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders expanded modal tables with sticky headers and alternating rows', () => {
    renderMarkdownWithMessageContext({ content: tableMarkdown });

    fireEvent.click(screen.getByLabelText('com_ui_expand_table'));

    const modal = screen.getByRole('dialog');
    const scrollRegion = modal.querySelector('.markdown-table-modal-scroll');
    const rows = within(modal).getAllByRole('row');

    expect(scrollRegion).toHaveClass('markdown-table-modal-scroll');
    expect(scrollRegion?.querySelector('thead th')).toHaveTextContent('Alpha');
    expect(rows).toHaveLength(3);
  });

  it('widens modal columns with long cell content', () => {
    const longCellMarkdown = [
      '| 類別 | 交貨日期 | 備註 |',
      '| --- | --- | --- |',
      '| 鐵板/鋼板 |  | 來源 PL.pdf 第1頁；件號 D3；PL15*500；材料 A36；暫依 OT 黑鐵板雷射切割報價 |',
      '| 孔 |  | D3 孔加工；10件 × 每件6孔 = 60孔；孔型 2-Ø30、4-Ø24 |',
    ].join('\n');

    renderMarkdownWithMessageContext({ content: longCellMarkdown });

    fireEvent.click(screen.getByLabelText('com_ui_expand_table'));

    const rows = within(screen.getByRole('dialog')).getAllByRole('row');
    const headerCells = within(rows[0]).getAllByRole('columnheader');
    const dataCells = within(rows[1]).getAllByRole('cell');

    expect(headerCells[2]).toHaveClass('markdown-table-wide-column');
    expect(dataCells[2]).toHaveClass('markdown-table-wide-column');
    expect(dataCells[0]).not.toHaveClass('markdown-table-wide-column');
  });

  it('pins a selected modal column to the left by header name', () => {
    renderMarkdownWithMessageContext({ content: tableMarkdown });

    fireEvent.click(screen.getByLabelText('com_ui_expand_table'));

    const modal = screen.getByRole('dialog');
    const selector = within(modal).getByLabelText('com_ui_sticky_table_column');

    expect(screen.queryByPlaceholderText('com_ui_search_table_columns')).not.toBeInTheDocument();

    fireEvent.click(selector);

    const searchInput = screen.getByPlaceholderText('com_ui_search_table_columns');
    expect(searchInput).toBeInTheDocument();

    const selectorWrapper = selector.closest('.mock-control-combobox');
    expect(selectorWrapper).not.toBeNull();

    fireEvent.click(within(selectorWrapper as HTMLElement).getByText('Bravo'));

    const rows = within(modal).getAllByRole('row');
    const headerCells = within(rows[0]).getAllByRole('columnheader');
    const dataCells = within(rows[1]).getAllByRole('cell');

    expect(headerCells[1]).toHaveClass('markdown-table-sticky-column');
    expect(headerCells[1]).toHaveAttribute('data-sticky-column', 'true');
    expect(dataCells[1]).toHaveClass('markdown-table-sticky-column');
    expect(dataCells[0]).not.toHaveClass('markdown-table-sticky-column');
  });
});
