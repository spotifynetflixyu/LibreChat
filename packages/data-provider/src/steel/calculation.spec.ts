import {
  calculateSteelSystemOrderRow,
  convertSteelDimensionToMillimetres,
  divideSteelDecimalsExactly,
  multiplySteelDecimals,
  normalizeSteelDecimal,
} from './calculation';

describe('Steel exact calculation seam', () => {
  it('normalizes decimal text without conflating blank and zero', () => {
    expect(normalizeSteelDecimal(' 001.2300 ')).toBe('1.23');
    expect(normalizeSteelDecimal('0')).toBe('0');
    expect(normalizeSteelDecimal('')).toBeUndefined();
    expect(normalizeSteelDecimal('1e-3')).toBeUndefined();
    expect(normalizeSteelDecimal('100')).toBe('100');
    expect(normalizeSteelDecimal('1000')).toBe('1000');
    expect(normalizeSteelDecimal('1,000')).toBe('1000');
  });

  it('converts supported dimensions as exact decimal strings', () => {
    expect(convertSteelDimensionToMillimetres('1.25 cm')).toBe('12.5');
    expect(convertSteelDimensionToMillimetres('1 in')).toBe('25.4');
    expect(convertSteelDimensionToMillimetres('0 mm')).toBe('0');
  });

  it('returns exact finite division and rejects repeating decimals', () => {
    expect(divideSteelDecimalsExactly('1', '8')).toBe('0.125');
    expect(divideSteelDecimalsExactly('1', '3')).toBeUndefined();
    expect(multiplySteelDecimals(['0.125', '8'])).toBe('1');
  });

  it('calculates a trusted plate row using newly entered dimensions', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '厚度', '寬度', '長度'],
      values: ['PL', '鐵板', 'kg', '2', '0.5', '1', '1 mm', '100 mm', '1000 mm'],
      candidate: {
        erpItemCode: 'PL',
        category: '鐵板',
        ruleVersion: 'steel-weight-v1',
        exactPhysical: { density: '7.85' },
      },
      changedHeaders: ['厚度'],
    });

    expect(result.values).toEqual(['PL', '鐵板', 'kg', '2', '0.785', '1.57', '1', '100 mm', '1000 mm']);
    expect(result.calculatedHeaders).toEqual(['單重', '總數']);
    expect(result.provenance?.['單重']?.kind).toBe('derived');
    expect(result.provenance?.['總數']?.dependencies).toEqual({ 單重: '0.785', 數量: '2' });
  });

  it('leaves an output untouched when the trusted division repeats', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '長度'],
      values: ['H', 'H型鋼', 'kg', '2', '9', '18', '1 mm'],
      candidate: {
        erpItemCode: 'H',
        category: 'H型鋼',
        ruleVersion: 'steel-weight-v1',
        exactPhysical: { unitWeightValue: '1', lengthMm: '3' },
        unitWeightBasis: 'kg_per_piece_or_stock_length',
      },
      changedHeaders: ['長度'],
    });

    expect(result.values).toEqual(['H', 'H型鋼', 'kg', '2', '9', '18', '1']);
  });

  it('derives total from manual weight and quantity without catalog evidence', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '單價'],
      values: ['manual', '未分類', 'kg', '3', '2.5', '7.5', '10'],
      changedHeaders: ['數量'],
    });

    expect(result.values).toEqual(['manual', '未分類', 'kg', '3', '2.5', '7.5', '10']);
    expect(result.provenance?.['總數']?.kind).toBe('derived');
    expect(result.calculatedHeaders).toEqual(['總數']);
  });

  it('leaves processing outputs untouched while normalizing an explicit input', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數'],
      values: ['processing', '加工', 'kg', '3', '2.5', '7.5'],
      changedHeaders: ['數量'],
      systemKind: 'processing',
    });

    expect(result.values).toEqual(['processing', '加工', 'kg', '3', '2.5', '7.5']);
    expect(result.calculatedHeaders).toEqual([]);
    expect(result.provenance).toBeUndefined();
  });

  it('keeps a dependent output when an explicitly changed input is blank', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數'],
      values: ['manual', '未分類', 'kg', '3', '', '7.5'],
      changedHeaders: ['單重'],
    });

    expect(result.values).toEqual(['manual', '未分類', 'kg', '3', '', '7.5']);
  });

  it('uses current effective dimensions even when notes contain an older original', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '厚度', '寬度', '長度', '備註'],
      values: ['PL', '鐵板', 'kg', '1', '1', '1', '2 mm', '100 mm', '1000 mm', '原厚度 1 mm'],
      candidate: {
        erpItemCode: 'PL',
        category: '鐵板',
        ruleVersion: 'steel-weight-v1',
        exactPhysical: { density: '7.85' },
      },
      changedHeaders: ['厚度'],
    });

    expect(result.values[4]).toBe('1.57');
    expect(result.values[5]).toBe('1.57');
  });

  it('does not recalculate dimensions for a manual price edit', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '單價', '厚度', '寬度', '長度'],
      values: ['PL', '鐵板', 'kg', '1', '1', '1', '10', '2 mm', '100 mm', '1000 mm'],
      candidate: {
        erpItemCode: 'PL',
        category: '鐵板',
        ruleVersion: 'steel-weight-v1',
        exactPhysical: { density: '7.85' },
      },
      changedHeaders: ['單價'],
    });

    expect(result.values).toEqual(['PL', '鐵板', 'kg', '1', '1', '1', '10', '2 mm', '100 mm', '1000 mm']);
  });

  it('accepts the repository Kg/M basis without guessing a profile weight', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '長度'],
      values: ['H', 'H型鋼', 'kg', '2', '9', '18', '3 m'],
      candidate: {
        erpItemCode: 'H',
        category: 'H型鋼',
        ruleVersion: 'steel-weight-v1',
        unitWeightBasis: 'Kg/M',
        exactPhysical: { unitWeightValue: '1', lengthMm: '3' },
      },
      changedHeaders: ['長度'],
    });

    expect(result.values).toEqual(['H', 'H型鋼', 'kg', '2', '3', '6', '3000']);
  });

  it('calculates a per-metre profile when the candidate has no stock length', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '長度'],
      values: ['H', 'H型鋼', 'kg', '2', '9', '18', '3 m'],
      candidate: {
        erpItemCode: 'H',
        category: 'H型鋼',
        ruleVersion: 'steel-weight-v1',
        unitWeightBasis: 'kg_per_m',
        exactPhysical: { unitWeightValue: '1' },
      },
      changedHeaders: ['長度'],
    });

    expect(result.values).toEqual(['H', 'H型鋼', 'kg', '2', '3', '6', '3000']);
  });
});
