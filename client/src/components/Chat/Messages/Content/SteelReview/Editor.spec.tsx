import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SteelReviewSourceFile, SteelReviewTable } from 'librechat-data-provider';
import { createSteelReviewDraftState, setSteelReviewDraftCell } from './session';
import SteelReviewEditor, { isSteelReviewCellEditable } from './Editor';

const table = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  tableId: 'ocr_result:1',
  outputId: 'ocr_result:generation-1',
  kind: 'ocr_result' as const,
  revision: 'revision-1',
  latestOutputId: 'ocr_result:generation-1',
  isLatest: true,
  readOnly: false,
  headers: ['品名規格', '來源'],
  rows: [{
    rowId: 'row-1',
    source: null,
    values: {
      品名規格: { baseline: '鋼板', effective: '鋼板' },
      來源: { baseline: 'drawing.pdf', effective: 'drawing.pdf' },
    },
  }],
} as SteelReviewTable;

describe('Steel review local editor gates', () => {
  it('allows only latest editable OCR business cells', () => {
    expect(isSteelReviewCellEditable(table, '品名規格')).toBe(true);
    expect(isSteelReviewCellEditable(table, 'Profile')).toBe(true);
    expect(isSteelReviewCellEditable(table, 'source code')).toBe(true);
    expect(isSteelReviewCellEditable(table, '來源檔案')).toBe(false);
    expect(isSteelReviewCellEditable(table, '頁碼')).toBe(false);
  });

  it('keeps system order and historical output cells read-only', () => {
    expect(isSteelReviewCellEditable({ ...table, kind: 'system_order' }, '品名規格')).toBe(false);
    expect(isSteelReviewCellEditable({ ...table, isLatest: false }, '品名規格')).toBe(false);
    expect(isSteelReviewCellEditable({ ...table, readOnly: true }, '品名規格')).toBe(false);
  });

  it('renders the shared Input for editable cells and stages a local change', () => {
    const onCellChange = jest.fn();
    function EditorHarness() {
      const [draft, setDraft] = useState(() => createSteelReviewDraftState('owner'));
      return (
        <SteelReviewEditor
          table={table}
          rows={table.rows}
          draft={draft}
          labels={{ table: 'Steel review table', readonly: 'Read-only cell' }}
          onCellChange={(row, header, value) => {
            onCellChange(row, header, value);
            setDraft((current) => setSteelReviewDraftCell(current, row, header, value));
          }}
        />
      );
    }

    render(
      <EditorHarness />,
    );

    const input = screen.getByRole('textbox', { name: '品名規格 row-1' });
    fireEvent.change(input, { target: { value: '鍍鋅鋼板' } });

    expect(input).toHaveValue('鍍鋅鋼板');
    expect(onCellChange).toHaveBeenCalledWith(table.rows[0], '品名規格', '鍍鋅鋼板');
    expect(screen.queryByRole('textbox', { name: '來源 row-1' })).toBeNull();
  });

  it('renders system-order cells as read-only without an editable input', () => {
    render(
      <SteelReviewEditor
        table={{ ...table, kind: 'system_order' }}
        rows={table.rows}
        draft={createSteelReviewDraftState('owner')}
        labels={{ table: 'Steel review table', readonly: 'Read-only cell' }}
        onCellChange={jest.fn()}
      />,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByLabelText('品名規格: Read-only cell')).toHaveTextContent('鋼板');
  });

  it('offers a source correction action with stable source labels', () => {
    const onSourceEdit = jest.fn();
    const sources: SteelReviewSourceFile[] = [{
      fileId: 'file-1',
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
    }];
    render(
      <SteelReviewEditor
        table={table}
        rows={table.rows}
        draft={createSteelReviewDraftState('owner')}
        labels={{
          table: 'Steel review table',
          readonly: 'Read-only cell',
          changeSource: 'Change source',
          sourceFile: 'Source file',
          sourceActions: 'Source actions',
        }}
        sources={sources}
        onCellChange={jest.fn()}
        onSourceEdit={onSourceEdit}
        onSourceChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Source actions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change source row-1' }));
    expect(onSourceEdit).toHaveBeenCalledWith(table.rows[0]);
  });

  it('keeps the source selector visible after entering a correction row', () => {
    render(
      <SteelReviewEditor
        table={table}
        rows={table.rows}
        draft={createSteelReviewDraftState('owner')}
        labels={{
          table: 'Steel review table',
          readonly: 'Read-only cell',
          sourceFile: 'Source file',
          sourcePage: 'Source page',
          sourceNoPage: 'No page',
          clearSource: 'Clear source',
          sourceActions: 'Source actions',
        }}
        sources={[{ fileId: 'file-1', filename: 'drawing.png', mediaType: 'image/png' }]}
        sourceCorrectionRowId="row-1"
        onCellChange={jest.fn()}
        onSourceChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Source actions' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Source file' })).toBeInTheDocument();
  });

  it('offers a retry when the selected source page count is unavailable', () => {
    const onSourcePageRetry = jest.fn();
    const sourceRow = {
      ...table.rows[0],
      source: { fileId: 'file-1', pageNumber: null, filename: 'drawing.pdf' },
    };
    render(
      <SteelReviewEditor
        table={table}
        rows={[sourceRow]}
        draft={createSteelReviewDraftState('owner')}
        labels={{
          table: 'Steel review table',
          readonly: 'Read-only cell',
          sourceFile: 'Source file',
          sourcePage: 'Source page',
          sourceNoPage: 'No page',
          sourceActions: 'Source actions',
          sourcePageUnavailable: 'Source pages unavailable',
          sourcePageRetry: 'Retry',
        }}
        sources={[{ fileId: 'file-1', filename: 'drawing.pdf', mediaType: 'application/pdf' }]}
        sourceCorrectionRowId="row-1"
        sourcePageCountError
        onSourcePageRetry={onSourcePageRetry}
        onCellChange={jest.fn()}
        onSourceChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Source pages unavailable');
    fireEvent.click(screen.getByRole('button', { name: /Retry/u }));
    expect(onSourcePageRetry).toHaveBeenCalledTimes(1);
  });
});
