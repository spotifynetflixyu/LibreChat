import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SteelReviewSourceFile, SteelReviewTable } from 'librechat-data-provider';
import { createSteelReviewDraftState, setSteelReviewDraftCell } from './session';
import SteelReviewEditor, { isSteelReviewCellEditable } from './Editor';

const table = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  title: 'ocr_result',
  outputId: 'ocr_result:generation-1',
  kind: 'ocr_result' as const,
  revision: 'revision-1',
  latestOutputId: 'ocr_result:generation-1',
  isLatest: true,
  readOnly: false,
  headers: ['品名規格', '來源', '單價', '總數'],
  rows: [{
    rowId: 'row-1',
    source: null,
    values: {
      品名規格: { baseline: '鋼板', effective: '鋼板' },
      來源: { baseline: 'drawing.pdf', effective: 'drawing.pdf' },
      單價: { baseline: '10', effective: '10' },
      總數: { baseline: '2', effective: '2' },
    },
  }],
} as SteelReviewTable;

const sourceLabels = {
  changeSource: 'Change source',
  sourceFile: 'Source file',
  sourcePage: 'Source page',
  sourceNoPage: 'No page',
  clearSource: 'Clear source',
  sourceActions: 'Source actions',
  sourcePageLoading: 'Loading pages',
  sourcePageUnavailable: 'Source pages unavailable',
  sourcePageRetry: 'Retry',
};

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
    expect(isSteelReviewCellEditable({ ...table, kind: 'system_order' }, '單價')).toBe(true);
    expect(isSteelReviewCellEditable({ ...table, kind: 'system_order' }, '總數')).toBe(true);
    expect(isSteelReviewCellEditable({ ...table, kind: 'system_order' }, '來源')).toBe(false);
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
          labels={{ ...sourceLabels, table: 'Steel review table', readonly: 'Read-only cell' }}
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

  it('renders system-order price and total inputs while keeping other cells read-only', () => {
    render(
      <SteelReviewEditor
        table={{ ...table, kind: 'system_order' }}
        rows={table.rows}
        draft={createSteelReviewDraftState('owner')}
        labels={{ ...sourceLabels, table: 'Steel review table', readonly: 'Read-only cell' }}
        onCellChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('textbox', { name: '單價 row-1' })).toHaveValue('10');
    expect(screen.getByRole('textbox', { name: '總數 row-1' })).toHaveValue('2');
    expect(screen.getByLabelText('品名規格: Read-only cell')).toHaveTextContent('鋼板');
  });

  it('offers a material-scoped processing insertion action', () => {
    const material = {
      ...table.rows[0],
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
    };
    const onAddProcessingUnder = jest.fn();
    render(
      <SteelReviewEditor
        table={{ ...table, kind: 'system_order' }}
        rows={[material]}
        draft={createSteelReviewDraftState('owner')}
        labels={{
          ...sourceLabels,
          table: 'Steel review table',
          readonly: 'Read-only cell',
          addProcessingUnder: 'Add processing under',
        }}
        onCellChange={jest.fn()}
        onAddProcessingUnder={onAddProcessingUnder}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add processing under row-1' }));
    expect(onAddProcessingUnder).toHaveBeenCalledWith(material);
  });

  it('hides mutable relation controls and child restore for cascade tombstones', () => {
    const material = {
      ...table.rows[0],
      rowId: 'material-1',
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      deleted: false,
    };
    const cascadeChild = {
      ...table.rows[0],
      rowId: 'processing-1',
      system: { kind: 'processing' as const, parentRowId: material.rowId, cascadeDeletedBy: material.rowId },
      deleted: true,
    };
    const deletedUnassigned = {
      ...table.rows[0],
      rowId: 'unassigned-1',
      system: { kind: 'unassigned' as const, parentRowId: null, cascadeDeletedBy: null },
      deleted: true,
    };
    render(
      <SteelReviewEditor
        table={{ ...table, kind: 'system_order', rows: [material, cascadeChild, deletedUnassigned] }}
        rows={[material, cascadeChild, deletedUnassigned]}
        systemMaterials={[material, cascadeChild, deletedUnassigned]}
        draft={createSteelReviewDraftState('owner')}
        labels={{
          ...sourceLabels,
          table: 'Steel review table',
          readonly: 'Read-only cell',
          rowActions: 'Row actions',
          bindProcessing: 'Bind processing',
          parent: 'Parent',
          restoreRow: 'Restore',
          deleteRow: 'Delete',
          deleteGroup: 'Delete group',
          addProcessingUnder: 'Add processing under',
          classify: 'Classify',
          material: 'Material',
          processing: 'Processing',
        }}
        onCellChange={jest.fn()}
        onSystemChange={jest.fn()}
        onRestoreRow={jest.fn()}
        onDeleteRow={jest.fn()}
        onDeleteGroup={jest.fn()}
        onAddProcessingUnder={jest.fn()}
      />,
    );

    expect(screen.queryByRole('combobox', { name: 'Bind processing processing-1' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Classify unassigned-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore processing-1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete group material-1' })).toBeInTheDocument();
  });

  it('allows an individually deleted bound child to restore under an active parent', () => {
    const material = {
      ...table.rows[0],
      rowId: 'material-1',
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      deleted: false,
    };
    const deletedChild = {
      ...table.rows[0],
      rowId: 'processing-1',
      system: { kind: 'processing' as const, parentRowId: material.rowId, cascadeDeletedBy: null },
      deleted: true,
    };
    const onRestoreRow = jest.fn();
    render(
      <SteelReviewEditor
        table={{ ...table, kind: 'system_order', rows: [material, deletedChild] }}
        rows={[material, deletedChild]}
        systemMaterials={[material, deletedChild]}
        draft={createSteelReviewDraftState('owner')}
        labels={{
          ...sourceLabels,
          table: 'Steel review table',
          readonly: 'Read-only cell',
          rowActions: 'Row actions',
          bindProcessing: 'Bind processing',
          restoreRow: 'Restore',
          deleteRow: 'Delete',
          deleteGroup: 'Delete group',
        }}
        onCellChange={jest.fn()}
        onSystemChange={jest.fn()}
        onRestoreRow={onRestoreRow}
        onDeleteRow={jest.fn()}
      />,
    );

    expect(screen.queryByRole('combobox', { name: 'Bind processing processing-1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore processing-1' }));
    expect(onRestoreRow).toHaveBeenCalledWith(deletedChild);
  });

  it('offers one group action for a material row', () => {
    const material = {
      ...table.rows[0],
      rowId: 'material-1',
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      deleted: false,
    };
    render(
      <SteelReviewEditor
        table={{ ...table, kind: 'system_order', rows: [material] }}
        rows={[material]}
        draft={createSteelReviewDraftState('owner')}
        labels={{
          ...sourceLabels,
          table: 'Steel review table',
          readonly: 'Read-only cell',
          rowActions: 'Row actions',
          deleteRow: 'Delete',
          deleteGroup: 'Delete group',
        }}
        onCellChange={jest.fn()}
        onDeleteRow={jest.fn()}
        onDeleteGroup={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete group material-1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete material-1' })).toBeNull();
  });

  it('keeps a captured prior-generation editor read-only even when the live table is latest', () => {
    const onCellChange = jest.fn();
    const onSourceEdit = jest.fn();
    render(
      <SteelReviewEditor
        table={table}
        rows={table.rows}
        draft={createSteelReviewDraftState('owner')}
        canEdit={false}
        labels={{
          ...sourceLabels,
          table: 'Steel review table',
          readonly: 'Read-only cell',
          changeSource: 'Change source',
          sourceFile: 'Source file',
          sourceActions: 'Source actions',
        }}
        sources={[{ fileId: 'file-1', filename: 'drawing.pdf', mediaType: 'application/pdf' }]}
        onCellChange={onCellChange}
        onSourceEdit={onSourceEdit}
        onSourceChange={jest.fn()}
        onDeleteRow={jest.fn()}
      />,
    );

    expect(screen.queryByRole('textbox', { name: '品名規格 row-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change source row-1' })).toBeNull();
    expect(screen.getByLabelText('品名規格: Read-only cell')).toHaveTextContent('鋼板');
    expect(onCellChange).not.toHaveBeenCalled();
    expect(onSourceEdit).not.toHaveBeenCalled();
  });

  it('ends focused history on Enter and blur', () => {
    const onCellHistoryBoundary = jest.fn();
    render(
      <SteelReviewEditor
        table={table}
        rows={table.rows}
        draft={createSteelReviewDraftState('owner')}
        labels={{ ...sourceLabels, table: 'Steel review table', readonly: 'Read-only cell' }}
        onCellChange={jest.fn()}
        onCellHistoryBoundary={onCellHistoryBoundary}
      />,
    );

    const input = screen.getByRole('textbox', { name: '品名規格 row-1' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onCellHistoryBoundary).toHaveBeenCalled();
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
          ...sourceLabels,
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
          ...sourceLabels,
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
          ...sourceLabels,
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

  it('closes the source page menu on its first Escape', () => {
    const sourceRow = {
      ...table.rows[0],
      source: { fileId: 'file-1', pageNumber: 1, filename: 'drawing.pdf' },
    };
    render(
      <SteelReviewEditor
        table={table}
        rows={[sourceRow]}
        draft={createSteelReviewDraftState('owner')}
        labels={{
          ...sourceLabels,
          table: 'Steel review table',
          readonly: 'Read-only cell',
        }}
        sources={[{ fileId: 'file-1', filename: 'drawing.pdf', mediaType: 'application/pdf' }]}
        sourceCorrectionRowId="row-1"
        sourcePageCount={2}
        onCellChange={jest.fn()}
        onSourceChange={jest.fn()}
      />,
    );

    const pageTrigger = screen.getByRole('combobox', { name: 'Source page' });
    fireEvent.click(pageTrigger);
    expect(screen.getByRole('option', { name: '2' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? pageTrigger, { key: 'Escape' });
    expect(screen.queryByRole('option', { name: '2' })).toBeNull();
  });
});
