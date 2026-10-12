import { applySteelReviewOperations, normalizeSteelReviewLedgerRows } from 'librechat-data-provider';
import type { SteelReviewRow } from 'librechat-data-provider';
import {
  addSteelReviewDraftRow,
  applySteelReviewDrafts,
  compileSteelReviewOperations,
  createSteelReviewDraftState,
  setSteelReviewDraftCell,
} from './session';

const headers = ['類別', '數量', '總數', '單位', '備註'];

function rows(quantity = '11', amount = '12', total = '132', unit = '孔'): SteelReviewRow[] {
  const make = (rowId: string, values: string[], kind: 'material' | 'processing'): SteelReviewRow => ({
    rowId,
    values: Object.fromEntries(headers.map((header, index) => [
      header, { baseline: values[index], effective: values[index] },
    ])),
    source: null,
    origin: 'ai',
    deleted: false,
    system: { kind, parentRowId: kind === 'processing' ? 'material' : null, cascadeDeletedBy: null },
  });
  return [
    make('material', ['鐵板', quantity, '69.328688', 'Kg', 'CP5'], 'material'),
    make('processing', [unit === '孔' ? '加工/孔' : '加工/開槽', amount, total, unit, 'CP5'], 'processing'),
  ];
}

function project(original: SteelReviewRow[], edits: readonly [string, string, string][]) {
  let draft = createSteelReviewDraftState('processing-owner');
  for (const [rowId, header, value] of edits) {
    draft = setSteelReviewDraftCell(draft, original.find((row) => row.rowId === rowId)!, header, value);
  }
  const projected = applySteelReviewDrafts(original, draft);
  const operations = compileSteelReviewOperations({ headers, rows: original }, draft, projected);
  const saved = applySteelReviewOperations({
    currentRows: normalizeSteelReviewLedgerRows(original),
    expectedRows: normalizeSteelReviewLedgerRows(original),
    headers,
    operations,
  });
  expect(saved.ok).toBe(true);
  const preview = projected.find((row) => row.rowId === 'processing')!;
  if (saved.ok) {
    const stored = saved.currentRows.find((row) => row.rowId === 'processing')!;
    expect([stored.values['數量'].effective, stored.values['總數'].effective]).toEqual([
      preview.values['數量'].effective, preview.values['總數'].effective,
    ]);
    expect(stored.calculation?.measurement).toEqual(preview.calculation?.measurement);
  }
  return { preview, operations };
}

describe('processing quantity and total draft parity', () => {
  it('previews and saves a quantity edit without submitting its derived total', () => {
    const { preview, operations } = project(rows(), [['processing', '數量', '13']]);
    expect(preview.values['總數'].effective).toBe('143');
    expect(operations).toEqual([{ type: 'update', rowId: 'processing', changes: [{ header: '數量', value: '13' }] }]);
  });

  it('previews and saves the inverse quantity from an edited total', () => {
    const { preview } = project(rows(), [['processing', '總數', '154']]);
    expect(preview.values['數量'].effective).toBe('14');
  });

  it('uses continuous edge length for slot quantities in both directions', () => {
    const original = rows('11', '0.5', '5.5', 'M');
    expect(project(original, [['processing', '數量', '0.6']]).preview.values['總數'].effective).toBe('6.6');
    expect(project(original, [['processing', '總數', '6.6']]).preview.values['數量'].effective).toBe('0.6');
  });

  it.each([true, false])('uses the final material quantity when parent is edited first=%s', (parentFirst) => {
    const parent: [string, string, string] = ['material', '數量', '12'];
    const child: [string, string, string] = ['processing', '總數', '156'];
    const { preview } = project(rows(), parentFirst ? [parent, child] : [child, parent]);
    expect(preview.values['數量'].effective).toBe('13');
    expect(preview.values['總數'].effective).toBe('156');
  });

  it('keeps an explicit return to the saved total after a quantity edit', () => {
    const { preview, operations } = project(rows(), [
      ['processing', '數量', '13'], ['processing', '總數', '132'],
    ]);
    expect(preview.values['數量'].effective).toBe('12');
    expect(operations[0]).toMatchObject({ changes: [
      { header: '數量', value: '13' }, { header: '總數', value: '132' },
    ] });
  });

  it('keeps an explicit return to the saved quantity after a total edit', () => {
    const { preview } = project(rows(), [
      ['processing', '總數', '143'], ['processing', '數量', '12'],
    ]);
    expect(preview.values['總數'].effective).toBe('132');
  });

  it('keeps a saved total intent after changing the material quantity', () => {
    const { preview } = project(rows(), [['material', '數量', '12'], ['processing', '總數', '132']]);
    expect(preview.values['數量'].effective).toBe('11');
  });

  it('skips inverse calculation when the material quantity is missing', () => {
    const { preview } = project(rows(''), [['processing', '總數', '154']]);
    expect(preview.values['數量'].effective).toBe('12');
  });

  it('saves an unbound processing input while skipping the counterpart calculation', () => {
    const original = rows();
    original[0].system = { kind: 'unassigned', parentRowId: null, cascadeDeletedBy: null };
    const { preview } = project(original, [['processing', '數量', '13']]);
    expect(preview.values['數量'].effective).toBe('13');
    expect(preview.values['總數'].effective).toBe('132');
  });

  it('does not reinterpret legacy batch quantities on a parent edit', () => {
    const { preview } = project(rows('11', '132'), [['material', '數量', '12']]);
    expect(preview.values['數量'].effective).toBe('132');
    expect(preview.values['總數'].effective).toBe('132');
  });

  it('preserves the parent-dependent result when the child quantity is then cleared', () => {
    const { preview } = project(rows(), [['material', '數量', '12'], ['processing', '數量', '']]);
    expect(preview.values['數量'].effective).toBe('');
    expect(preview.values['總數'].effective).toBe('144');
  });

  it('retains a same-field return to a legacy saved amount as explicit per-piece intent', () => {
    const { preview, operations } = project(rows('11', '132'), [
      ['processing', '數量', '133'], ['processing', '數量', '132'],
    ]);
    expect(preview.values['總數'].effective).toBe('1452');
    expect(operations[0]).toMatchObject({ changes: [{ header: '數量', value: '132' }] });
  });

  it('retains a saved total entered before a later parent edit', () => {
    const { preview } = project(rows(), [['processing', '總數', '132'], ['material', '數量', '12']]);
    expect(preview.values['數量'].effective).toBe('11');
    expect(preview.values['總數'].effective).toBe('132');
  });

  it('clears stale metadata when the user reasserts a zero total with a zero parent', () => {
    const original = rows('0', '12', '0');
    original[1].calculation = { measurement: { mode: 'perPiece', amount: '12', unit: '孔' } };
    const { preview, operations } = project(original, [['processing', '總數', '0']]);
    expect(preview.calculation?.measurement).toBeUndefined();
    expect(operations[0]).toMatchObject({ changes: [{ header: '總數', value: '0' }] });
  });

  it('orders an existing parent quantity edit before a new processing row total', () => {
    const original = [rows()[0]];
    const table = { headers, rows: original };
    let draft = addSteelReviewDraftRow(createSteelReviewDraftState('owner'), table, original[0], null, {
      kind: 'processing', parentRowId: original[0].rowId, cascadeDeletedBy: null,
    });
    const added = Object.values(draft.rowStates)[0];
    for (const [header, value] of [['類別', '加工/孔'], ['單位', '孔'], ['備註', 'CP5'], ['總數', '156']]) {
      draft = setSteelReviewDraftCell(draft, added, header, value);
    }
    draft = setSteelReviewDraftCell(draft, original[0], '數量', '12');
    const projected = applySteelReviewDrafts(original, draft);
    const operations = compileSteelReviewOperations(table, draft, projected);
    expect(operations.map((operation) => operation.type)).toEqual(['update', 'add']);
    const saved = applySteelReviewOperations({
      headers, operations, currentRows: normalizeSteelReviewLedgerRows(original),
      expectedRows: normalizeSteelReviewLedgerRows(original),
    });
    expect(saved.ok).toBe(true);
    expect(projected.find((row) => row.rowId === added.rowId)?.values['數量'].effective).toBe('13');
    if (saved.ok) {
      expect(saved.currentRows.find((row) => row.rowId === added.rowId)?.values['數量'].effective).toBe('13');
    }
  });
});
