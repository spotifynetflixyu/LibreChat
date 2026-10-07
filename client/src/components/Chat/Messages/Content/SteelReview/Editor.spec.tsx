import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
import { createSteelReviewDraftState, setSteelReviewDraftCell } from './session';
import SteelReviewEditor, { isSteelReviewCellEditable } from './Editor';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: () => undefined });
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
  Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
});

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
  edit: 'Edit',
  reset: 'Reset',
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
  it.each([true, false])('keeps current and original numeric values together on desktop=%s', (isDesktop) => {
    const row = { ...table.rows[0], values: { ...table.rows[0].values,
      總數: { baseline: '5280', effective: '1234.50' },
    } };
    render(<SteelReviewEditor table={table} rows={[row]} draft={createSteelReviewDraftState('owner')}
      labels={labels} onCellChange={jest.fn()} isDesktop={isDesktop} />);
    expect(screen.getByText('1234.50')).toHaveClass('whitespace-nowrap');
    expect(screen.getByText('5280')).toHaveClass('whitespace-nowrap');
    expect(screen.getByText('5280').closest('del')).toBeInTheDocument();
  });

  it.each([true, false])('collapses long cells independently on desktop=%s without editing their values', (isDesktop) => {
    const firstText = 'First long review cell. '.repeat(12).trim();
    const secondText = 'Second long review cell. '.repeat(12).trim();
    const reviewRows = [firstText, secondText].map((text, index) => ({
      rowId: `long-${index}`,
      source: null,
      values: { 備註: { baseline: text, effective: text } },
    }));
    const onCellChange = jest.fn();
    const heightSpy = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-markdown-cell-content') && (this.textContent?.length ?? 0) > 80 ? 96 : 24;
    });
    try {
      render(<SteelReviewEditor table={{ ...table, headers: ['備註'], rows: reviewRows }} rows={reviewRows}
        draft={createSteelReviewDraftState('owner')} labels={labels} onCellChange={onCellChange} isDesktop={isDesktop} />);
      const firstContent = screen.getByText(firstText).closest('[data-markdown-cell-content]');
      const secondContent = screen.getByText(secondText).closest('[data-markdown-cell-content]');
      const buttons = screen.getAllByRole('button', { name: /show.*all/i });
      expect(buttons).toHaveLength(2);
      expect(firstContent).toHaveClass('line-clamp-3');
      fireEvent.click(buttons[0]);
      expect(firstContent).not.toHaveClass('line-clamp-3');
      expect(secondContent).toHaveClass('line-clamp-3');
      fireEvent.click(screen.getByRole('button', { name: /show.*less/i }));
      expect(firstContent).toHaveClass('line-clamp-3');
      expect(onCellChange).not.toHaveBeenCalled();
    } finally {
      heightSpy.mockRestore();
    }
  });

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
        onSourceEdit={jest.fn()}
        onCellChange={(row, header, value) => {
          onCellChange(row, header, value);
          setDraft((current) => setSteelReviewDraftCell(current, row, header, value));
        }}
      />;
    }

    render(<EditorHarness />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([labels.action, ...table.headers]);
    expect(screen.queryByRole('textbox', { name: '品名規格 row-1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit row-1' }));
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
      const [draft, setDraft] = useState(() => createSteelReviewDraftState(`${kind}-category-owner`));
      return <SteelReviewEditor
        table={{ ...categoryTable, kind }}
        rows={categoryTable.rows}
        draft={draft}
        labels={labels}
        onSourceEdit={jest.fn()}
        onCellChange={(row, header, value) => {
          onCellChange(row, header, value);
          setDraft((current) => setSteelReviewDraftCell(current, row, header, value));
        }}
      />;
    }
    const { container } = render(<CategoryHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit category-row' }));
    const selector = screen.getByRole('combobox', { name: '類別 category-row' });
    fireEvent.click(selector);
    const categories = screen.getAllByRole('option').map((option) => option.textContent);
    expect(categories.indexOf('鐵板')).toBeLessThan(categories.indexOf('加工/切工'));
    expect(categories.indexOf('H型鋼')).toBeLessThan(categories.indexOf('加工/切工'));
    expect(categories.indexOf('加工/其他')).toBeLessThan(categories.indexOf('既有特殊類別'));
    ['捲門/伸縮門', '格板/隔板', '五金/配件', '門窗/門板'].forEach((category) => {
      expect(categories.indexOf('加工/其他')).toBeLessThan(categories.indexOf(category));
    });
    expect(categories.indexOf('圓條') + 1).toBe(categories.indexOf('圓管'));
    expect(categories.at(-1)).toBe('其他');
    fireEvent.click(screen.getByRole('option', { name: 'H型鋼' }));
    expect(selector).toHaveTextContent('H型鋼');
    expect(onCellChange).toHaveBeenLastCalledWith(categoryTable.rows[0], '類別', 'H型鋼');
    expect(container.querySelector('del')).toHaveTextContent('既有特殊類別');
  });
  it('selects a portaled desktop category exactly once and dismisses without stale writes', async () => {
    const user = userEvent.setup();
    const onCellChange = jest.fn();
    render(<SteelReviewEditor table={categoryTable} rows={categoryTable.rows}
      draft={createSteelReviewDraftState('desktop-category-pointer-owner')}
      labels={labels} isDesktop onCellChange={onCellChange} />);
    await user.click(screen.getByRole('button', { name: 'Edit 類別 category-row' }));
    await user.click(screen.getByRole('combobox', { name: '類別 category-row' }));
    await user.click(screen.getByRole('option', { name: 'H型鋼' }));
    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange).toHaveBeenCalledWith(categoryTable.rows[0], '類別', 'H型鋼');
    await user.click(document.body);
    expect(onCellChange).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Edit 類別 category-row' }));
    await user.click(screen.getByRole('combobox', { name: '類別 category-row' }));
    await user.keyboard('{Escape}');
    await user.click(document.body);
    expect(onCellChange).toHaveBeenCalledTimes(1);
  });

});

describe('desktop steel review cells', () => {
  it('keeps text at rest, supports multiline text, and commits once on Ctrl+Enter', () => {
    const onCellChange = jest.fn();
    render(<SteelReviewEditor
      table={table}
      rows={table.rows}
      draft={createSteelReviewDraftState('desktop-owner')}
      labels={labels}
      isDesktop
      onCellChange={onCellChange}
    />);

    expect(screen.queryByRole('textbox', { name: '品名規格 row-1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit 品名規格 row-1' }));
    const input = screen.getByRole('textbox', { name: '品名規格 row-1' });
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.closest('[role="dialog"]')?.querySelector('del')).toBeNull();
    fireEvent.change(input, { target: { value: '鍍鋅鋼板' } });
    expect(input.closest('[role="dialog"]')?.querySelector('del')).toHaveTextContent('鋼板');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    expect(onCellChange).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '鍍鋅鋼板\n第二行' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });
    fireEvent.blur(input);

    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange).toHaveBeenCalledWith(table.rows[0], '品名規格', '鍍鋅鋼板\n第二行');
    expect(screen.queryByRole('textbox', { name: '品名規格 row-1' })).toBeNull();
  });

  it('resets the input without committing and disables Reset when the original value is restored', async () => {
    const user = userEvent.setup();
    const onCellChange = jest.fn();
    render(<SteelReviewEditor
      table={table}
      rows={table.rows}
      draft={createSteelReviewDraftState('desktop-reset-owner')}
      labels={labels}
      isDesktop
      onCellChange={onCellChange}
    />);

    await user.click(screen.getByRole('button', { name: 'Edit 單價 row-1' }));
    const input = screen.getByRole('textbox', { name: '單價 row-1' });
    const reset = screen.getByRole('button', { name: 'Reset 單價 row-1' });
    const popover = input.closest('[role="dialog"]');
    expect(reset).toBeDisabled();
    expect(popover?.querySelector('del')).toBeNull();

    await user.clear(input);
    await user.type(input, '11');
    expect(reset).toBeEnabled();
    expect(popover?.querySelector('del')).toHaveTextContent('10');
    fireEvent.pointerDown(reset);
    fireEvent.click(reset);
    expect(input).toHaveValue('10');
    expect(reset).toBeDisabled();
    expect(popover?.querySelector('del')).toBeNull();
    expect(onCellChange).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '12');
    await user.tab();
    expect(reset).toHaveFocus();
    expect(onCellChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('10');
    expect(reset).toBeDisabled();
    expect(popover?.querySelector('del')).toBeNull();
    expect(input).toBeInTheDocument();
    expect(onCellChange).not.toHaveBeenCalled();
  });

  it('commits on focus leave before the popover closes and ignores a second completion', () => {
    const onCellChange = jest.fn();
    render(<SteelReviewEditor
      table={table}
      rows={table.rows}
      draft={createSteelReviewDraftState('desktop-outside-owner')}
      labels={labels}
      isDesktop
      onCellChange={onCellChange}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit 單價 row-1' }));
    const input = screen.getByRole('textbox', { name: '單價 row-1' });
    fireEvent.change(input, { target: { value: '11' } });
    fireEvent.blur(input);
    fireEvent.mouseDown(document.body);

    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange).toHaveBeenCalledWith(table.rows[0], '單價', '11');
  });

  it('cancels on Escape and leaves source fields without a field edit control', () => {
    const onCellChange = jest.fn();
    render(<SteelReviewEditor
      table={table}
      rows={table.rows}
      draft={createSteelReviewDraftState('desktop-escape-owner')}
      labels={labels}
      isDesktop
      onCellChange={onCellChange}
    />);

    expect(screen.queryByRole('button', { name: 'Edit 來源 row-1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit 總數 row-1' }));
    const input = screen.getByRole('textbox', { name: '總數 row-1' });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(onCellChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '總數 row-1' })).toBeNull();
  });

  it('retains the original value below a changed desktop value and clears a stale edit', () => {
    const onCellChange = jest.fn();
    const changedDraft = setSteelReviewDraftCell(createSteelReviewDraftState('desktop-stale-owner'), table.rows[0], '單價', '11');
    const rendered = render(<SteelReviewEditor
      table={table}
      rows={table.rows}
      draft={changedDraft}
      labels={labels}
      isDesktop
      onCellChange={onCellChange}
    />);

    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('10', { selector: 'del' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit 單價 row-1' }));
    expect(screen.getByRole('textbox', { name: '單價 row-1' })).toBeInTheDocument();
    rendered.rerender(<SteelReviewEditor
      table={{ ...table, readOnly: true }}
      rows={table.rows}
      draft={changedDraft}
      labels={labels}
      isDesktop
      onCellChange={onCellChange}
    />);

    expect(screen.queryByRole('textbox', { name: '單價 row-1' })).toBeNull();
    expect(onCellChange).not.toHaveBeenCalled();
  });
});


describe('system order remarks completion', () => {
  it('commits remarks only on blur for system order, while OCR remains immediate', () => {
    const onCellChange = jest.fn();
    const remarkRow = { ...table.rows[0], values: { 備註: { baseline: 'P1', effective: 'P1' } } };
    const props = { rows: [remarkRow], draft: createSteelReviewDraftState('remarks-owner'), labels, onCellChange, onSourceEdit: jest.fn() };
    const rendered = render(<SteelReviewEditor {...props} table={{ ...table, kind: 'system_order', headers: ['備註'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit row-1' }));
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


describe('desktop nested measurement selector', () => {
  it('keeps the measurement editor open while choosing a portaled mode', async () => {
    const user = userEvent.setup();
    const onMeasurementChange = jest.fn();
    const row = systemRow('measurement-row', 'processing');
    const measurementLabels = {
      title: 'Calculation data', mode: 'Measurement basis', none: 'No measurement',
      perPiece: 'Per piece', batch: 'Whole batch', cutting: 'Confirmed cutting plan',
      amount: 'Amount', unit: 'Unit', planId: 'Plan', planVersion: 'Version',
      confirmed: 'Confirmed', stockGroup: 'Stock', addGroup: 'Add', removeGroup: 'Remove',
      groups: {
        stockLengthMm: 'Stock length', pieceLengthMm: 'Piece length', pieceCount: 'Piece count',
        stockCount: 'Stock count', lossMm: 'Loss', remainderMm: 'Remainder', headTrimMm: 'Head',
        tailTrimMm: 'Tail', pieceHeadTrimMm: 'Piece head', pieceTailTrimMm: 'Piece tail',
      },
    };
    render(<SteelReviewEditor table={{ ...table, kind: 'system_order', rows: [row] }}
      rows={[row]} draft={createSteelReviewDraftState('desktop-measurement-pointer-owner')}
      labels={{ ...labels, measurement: measurementLabels }} isDesktop
      onCellChange={jest.fn()} onMeasurementChange={onMeasurementChange} />);
    await user.click(screen.getByRole('button', { name: 'Edit Calculation data measurement-row' }));
    await user.click(screen.getByRole('combobox', { name: 'Measurement basis measurement-row' }));
    await user.click(screen.getByRole('option', { name: 'Whole batch' }));
    expect(onMeasurementChange).toHaveBeenCalledTimes(1);
    expect(onMeasurementChange).toHaveBeenCalledWith(row, expect.objectContaining({ mode: 'batch' }));
    expect(screen.getByRole('combobox', { name: 'Measurement basis measurement-row' })).toBeInTheDocument();
  });
});
