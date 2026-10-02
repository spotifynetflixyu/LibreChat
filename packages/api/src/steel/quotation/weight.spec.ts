import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import { recalculateSystemOrderWeights } from './weight';

const headers = ['型號', '單位', '數量', '單重', '總數', '厚度', '寬度', '長度', '類別', '備註', '品名規格'];
function result(candidate: SteelToolJsonObject): SteelToolResult {
  return { ok: true, toolName: 'search_price_candidates', durationMs: 1, redactionVersion: 1,
    data: { queryResults: [{ candidates: [candidate] }] } };
}
function calculate(row: string[], results: SteelToolResult[]) {
  return recalculateSystemOrderWeights({ headers, rows: [row], results })[0]!;
}

it('uses plate density and original dimensions before display rounding', () => {
  const row = ['PL', 'Kg', '2支', '999kg', '1998', '6', '100', '200', '鐵板', '原厚度 6.35 mm', 'plate'];
  const calculated = calculate(row, [result({ erpItemCode: 'PL', category: '鐵板', density: 7.85 })]);
  expect(calculated[3]).toBe('0.99695');
  expect(calculated[4]).toBe('1.9939');
  expect(row[3]).toBe('999kg');
});

it('uses the selected solid-square width and material-specific density', () => {
  const row = ['SQ', 'Kg', '3', '999', '2997', '', '6', '1000', '方鐵', '', 'square'];
  expect(calculate(row, [result({ erpItemCode: 'SQ', category: '方鐵', density: 7.93, widthMm: 6.35 })]).slice(3, 5))
    .toEqual(['0.319757425', '0.959272275']);
});

it('uses profile stock weight and length instead of a solid-box density formula', () => {
  const row = ['H', 'Kg', '2', '999', '1998', '14', '250', '3000', 'H型鋼', '', 'H250'];
  expect(calculate(row, [result({ erpItemCode: 'H', category: 'H型鋼', density: 7.85,
    unitWeightValue: 431, unitWeightBasis: 'kg_per_piece_or_stock_length', lengthMm: 6000 })]).slice(3, 5))
    .toEqual(['215.5', '431']);
});

it('uses per-metre profile weight and leaves processing or non-Kg rows unchanged', () => {
  const candidate = result({ erpItemCode: 'C', category: 'C型鋼', unitWeightValue: 4, unitWeightBasis: 'M' });
  const row = ['C', 'Kg', '2', '999', '1998', '2', '100', '763', 'C型鋼', '', 'C100'];
  expect(calculate(row, [candidate]).slice(3, 5)).toEqual(['3.052', '6.104']);
  const processing = [...row]; processing[8] = '加工/孔';
  expect(calculate(processing, [candidate])).toEqual(processing);
  const pieces = [...row]; pieces[1] = '支';
  expect(calculate(pieces, [candidate])).toEqual(pieces);
});

it('does not guess a density or select between conflicting lookup candidates', () => {
  const row = ['PL', 'Kg', '2', '1', '2', '6', '100', '200', '鐵板', '', 'plate'];
  expect(calculate(row, [result({ erpItemCode: 'PL', category: '鐵板' })])).toEqual(row);
  expect(calculate(row, [result({ erpItemCode: 'PL', category: '鐵板', density: 7.85 }),
    result({ erpItemCode: 'PL', category: '鐵板', density: 7.93 })])).toEqual(row);
});
