import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
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

const labels = {
  table: 'Steel review table',
  readonly: 'Read-only cell',
  emptyCategory: 'No category',
  action: 'Action',
  bind: 'Link',
  bound: 'Linked',
  classify: 'Classify',
  material: 'Material',
  processing: 'Processing',
  deleteRow: 'Delete',
  restoreRow: 'Restore',
};

function systemRow(rowId: string, kind: 'material' | 'processing' | 'unassigned', system?: Partial<NonNullable<SteelReviewRow['system']>>): SteelReviewRow {
  return {
    ...table.rows[0],
    rowId,
    source: null,
    system: {
      kind,
      parentRowId: null,
      cascadeDeletedBy: null,
      ...system,
    },
  };
}

describe('Steel review local editor gates', () => {
  it('allows only latest editable business cells and keeps source association fields read-only', () => {
    expect(isSteelReviewCellEditable(table, '品名規格')).toBe(true);
    expect(isSteelReviewCellEditable(table, 'source code')).toBe(true);
    expect(isSteelReviewCellEditable(table, '來源檔案')).toBe(false);
    expect(isSteelReviewCellEditable({ ...table, isLatest: false }, '品名規格')).toBe(false);
    expect(isSteelReviewCellEditable({ ...table, readOnly: true }, '品名規格')).toBe(false);
  });

  it('renders editable cells, stages a local change, and exposes stable row ids', () => {
    const onCellChange = jest.fn();
    function EditorHarness() {
      const [draft, setDraft] = useState(() => createSteelReviewDraftState('owner'));
      return <SteelReviewEditor
        table={table}
        rows={table.rows}
        draft={draft}
        labels={labels}
        onCellChange={(row, header, value) => {
          onCellChange(row, header, value);
          setDraft((current) => setSteelReviewDraftCell(current, row, header, value));
        }}
      />;
    }

    render(<EditorHarness />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(table.headers);
    const input = screen.getByRole('textbox', { name: '品名規格 row-1' });
    fireEvent.change(input, { target: { value: '鍍鋅鋼板' } });

    expect(input).toHaveValue('鍍鋅鋼板');
    expect(onCellChange).toHaveBeenCalledWith(table.rows[0], '品名規格', '鍍鋅鋼板');
    expect(screen.getByRole('table', { name: labels.table }).querySelector('tr[data-row-id="row-1"]')).toBeInTheDocument();
  });

  it('offers Link and Linked for non-processing rows and no Link for processing rows', () => {
    const material = systemRow('material-1', 'material');
    const processing = systemRow('processing-1', 'processing', { parentRowId: material.rowId });
    const linked = { ...systemRow('material-2', 'material'), source: { fileId: 'file-1', pageNumber: 1 } };
    const onSourceEdit = jest.fn();
    render(<SteelReviewEditor
      table={{ ...table, kind: 'system_order', rows: [material, linked, processing] }}
      rows={[material, linked, processing]}
      systemMaterials={[material, linked, processing]}
      draft={createSteelReviewDraftState('owner')}
      labels={labels}
      onCellChange={jest.fn()}
      onSourceEdit={onSourceEdit}
    />);

    const link = screen.getByRole('button', { name: 'Link material-1' });
    const linkedButton = screen.getByRole('button', { name: 'Linked material-2' });
    expect(link.textContent).toBe('');
    expect(linkedButton.textContent).toBe('');
    expect(link).toHaveClass('bg-transparent');
    expect(linkedButton).toHaveClass('bg-surface-inverted');
    expect(linkedButton).not.toHaveClass('bg-surface-submit');
    expect(link.querySelector('svg')?.getAttribute('class')).toBe(linkedButton.querySelector('svg')?.getAttribute('class'));
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(linkedButton);
    expect(onSourceEdit).toHaveBeenCalledWith(linked);
    expect(screen.queryByRole('button', { name: 'Link processing-1' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Link processing processing-1' })).toBeNull();
  });

  it('uses one generic Delete action for a material cascade and hides restore for cascade tombstones', () => {
    const material = systemRow('material-1', 'material');
    const cascadeChild = {
      ...systemRow('processing-1', 'processing', { parentRowId: material.rowId, cascadeDeletedBy: material.rowId }),
      deleted: true,
    };
    const onDeleteGroup = jest.fn();
    render(<SteelReviewEditor
      table={{ ...table, kind: 'system_order', rows: [material, cascadeChild] }}
      rows={[material, cascadeChild]}
      systemMaterials={[material, cascadeChild]}
      draft={createSteelReviewDraftState('owner')}
      labels={labels}
      onCellChange={jest.fn()}
      onDeleteGroup={onDeleteGroup}
      onRestoreRow={jest.fn()}
    />);

    const deleteButton = screen.getByRole('button', { name: 'Delete material-1' });
    expect(deleteButton.textContent).toBe('');
    expect(deleteButton).toHaveClass('hover:text-text-destructive', 'hover:bg-status-error-subtle');
    expect(deleteButton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(deleteButton);
    expect(onDeleteGroup).toHaveBeenCalledWith(material);
    expect(screen.queryByRole('button', { name: 'Restore processing-1' })).toBeNull();
  });

  it('allows an individually deleted processing row to restore under an active material', () => {
    const material = systemRow('material-1', 'material');
    const deletedChild = {
      ...systemRow('processing-1', 'processing', { parentRowId: material.rowId }),
      deleted: true,
    };
    const onRestoreRow = jest.fn();
    render(<SteelReviewEditor
      table={{ ...table, kind: 'system_order', rows: [material, deletedChild] }}
      rows={[material, deletedChild]}
      systemMaterials={[material, deletedChild]}
      draft={createSteelReviewDraftState('owner')}
      labels={labels}
      onCellChange={jest.fn()}
      onRestoreRow={onRestoreRow}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Restore processing-1' }));
    expect(onRestoreRow).toHaveBeenCalledWith(deletedChild);
  });

  it('keeps a captured prior-generation editor read-only', () => {
    const onCellChange = jest.fn();
    render(<SteelReviewEditor
      table={table}
      rows={table.rows}
      draft={createSteelReviewDraftState('owner')}
      canEdit={false}
      labels={labels}
      onCellChange={onCellChange}
      onSourceEdit={jest.fn()}
      onDeleteRow={jest.fn()}
    />);

    expect(screen.queryByRole('textbox', { name: '品名規格 row-1' })).toBeNull();
    expect(screen.getByLabelText('品名規格: Read-only cell')).toHaveTextContent('鋼板');
    expect(onCellChange).not.toHaveBeenCalled();
  });
});

describe('Steel review category menu', () => {
  const categoryTable: SteelReviewTable = {
    ...table,
    title: 'system_order',
    kind: 'system_order',
    headers: ['類別'],
    rows: [{
      ...table.rows[0],
      rowId: 'category-row',
      system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
      values: { 類別: { baseline: '既有特殊類別', effective: '既有特殊類別' } },
    }],
  };

  it.each(['system_order', 'ocr_result'] as const)('selects a category for %s and retains the AI comparison', (kind) => {
    const onCellChange = jest.fn();
    function CategoryHarness() {
      const [draft, setDraft] = useState(() => createSteelReviewDraftState('category-owner'));
      return <SteelReviewEditor
        table={{ ...categoryTable, kind }}
        rows={categoryTable.rows}
        draft={draft}
        labels={labels}
        onCellChange={(row, header, value) => {
          onCellChange(row, header, value);
          setDraft((current) => setSteelReviewDraftCell(current, row, header, value));
        }}
      />;
    }
    const { container } = render(<CategoryHarness />);
    const selector = screen.getByRole('combobox', { name: '類別 category-row' });
    fireEvent.click(selector);
    fireEvent.click(screen.getByRole('option', { name: 'H型鋼' }));
    expect(selector).toHaveTextContent('H型鋼');
    expect(onCellChange).toHaveBeenLastCalledWith(categoryTable.rows[0], '類別', 'H型鋼');
    expect(container.querySelector('del')).toHaveTextContent('既有特殊類別');
  });
});


describe('system order remarks completion', () => {
  it('commits remarks only on blur for system order, while OCR remains immediate', () => {
    const onCellChange = jest.fn();
    const remarkRow = { ...table.rows[0], values: { 備註: { baseline: 'P1', effective: 'P1' } } };
    const props = { rows: [remarkRow], draft: createSteelReviewDraftState('owner'), labels, onCellChange };
    const rendered = render(<SteelReviewEditor {...props} table={{ ...table, kind: 'system_order', headers: ['備註'] }} />);
    const input = screen.getByRole('textbox', { name: '備註 row-1' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'P2' } });
    expect(input).toHaveValue('P2');
    expect(onCellChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCellChange).toHaveBeenCalledWith(remarkRow, '備註', 'P2');
    onCellChange.mockClear();
    rendered.rerender(<SteelReviewEditor {...props} table={{ ...table, headers: ['備註'] }} />);
    fireEvent.change(screen.getByRole('textbox', { name: '備註 row-1' }), { target: { value: 'P3' } });
    expect(onCellChange).toHaveBeenCalledWith(remarkRow, '備註', 'P3');
  });
});
