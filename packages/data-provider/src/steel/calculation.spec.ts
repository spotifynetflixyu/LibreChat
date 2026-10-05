import {
  calculateSteelProcessingMeasurement,
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

  it('calculates an exact per-piece processing amount from the linked parent quantity', () => {
    expect(calculateSteelProcessingMeasurement({
      headers: ['單位'],
      values: ['刀'],
      measurement: { mode: 'perPiece', amount: '0.125', unit: '刀', ruleVersion: 'v1' },
      parentHeaders: ['數量'],
      parentValues: ['8'],
    })).toBe('1');
  });

  it('keeps batch measurements independent from the linked parent quantity', () => {
    expect(calculateSteelProcessingMeasurement({
      headers: ['單位'],
      values: ['刀'],
      measurement: { mode: 'batch', amount: '2.50', unit: '刀', ruleVersion: 'v1' },
      parentHeaders: ['數量'],
      parentValues: ['8'],
    })).toBe('2.5');
  });

  it('preserves the existing total when the business unit basis is blank', () => {
    expect(calculateSteelProcessingMeasurement({
      headers: ['單位'],
      values: [''],
      measurement: { mode: 'batch', amount: '2', unit: '' },
      parentHeaders: ['數量'],
      parentValues: ['8'],
    })).toBeUndefined();
  });

  it('counts only an explicitly confirmed balanced multi-stock cutting plan', () => {
    expect(calculateSteelProcessingMeasurement({
      headers: ['類別', '長度', '數量', '單位'],
      values: ['加工/切工', '', '', '刀'],
      measurement: {
        mode: 'cutting', amount: null, unit: '刀', ruleVersion: 'v1', confirmed: true,
        groups: [{
          stockLengthMm: '12000', pieceLengthMm: '6000', pieceCount: '1', stockCount: '5',
          lossMm: '0', remainderMm: '6000', headTrimMm: '0', tailTrimMm: '0',
          pieceHeadTrimMm: '0', pieceTailTrimMm: '0',
        }],
      },
      parentHeaders: ['類別', '長度', '數量'],
      parentValues: ['H型鋼', '6000 mm', '5'],
    })).toBe('5');
  });

  it('preserves unsupported or unbalanced cutting plans', () => {
    const measurement = {
      mode: 'cutting' as const, amount: null, unit: '刀' as const, ruleVersion: 'v1' as const, confirmed: true,
      groups: [{
        stockLengthMm: '12000', pieceLengthMm: '6000', pieceCount: '1', stockCount: '1',
        lossMm: '1', remainderMm: '6000', headTrimMm: '0', tailTrimMm: '0',
        pieceHeadTrimMm: '0', pieceTailTrimMm: '0',
      }],
    };
    expect(calculateSteelProcessingMeasurement({
      headers: ['單位'], values: ['刀'], measurement,
      parentHeaders: ['類別', '長度', '數量'], parentValues: ['鐵板', '6000 mm', '1'],
    })).toBeUndefined();
    expect(calculateSteelProcessingMeasurement({
      headers: ['單位'], values: ['片'], measurement: { ...measurement, unit: '刀' },
      parentHeaders: ['類別', '長度', '數量'], parentValues: ['H型鋼', '6000 mm', '1'],
    })).toBeUndefined();
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

  it('preserves manual plate outputs when only belly changes', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '厚度', '寬度', '長度', '肚'],
      values: ['PL', '鐵板', 'kg', '2', '99', '198', '1 mm', '100 mm', '1000 mm', '10 mm'],
      candidate: {
        erpItemCode: 'PL',
        category: '鐵板',
        ruleVersion: 'steel-weight-v1',
        exactPhysical: { density: '7.85' },
      },
      changedHeaders: ['肚'],
      systemKind: 'material',
    });

    expect(result.values).toEqual(['PL', '鐵板', 'kg', '2', '99', '198', '1 mm', '100 mm', '1000 mm', '10']);
    expect(result.calculatedHeaders).toEqual([]);
  });

  it('preserves manual profile outputs when an unrelated width changes', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '寬度', '長度'],
      values: ['H', 'H型鋼', 'kg', '2', '99', '198', '100 mm', '3 m'],
      candidate: {
        erpItemCode: 'H',
        category: 'H型鋼',
        ruleVersion: 'steel-weight-v1',
        unitWeightBasis: 'kg_per_m',
        exactPhysical: { unitWeightValue: '1' },
      },
      changedHeaders: ['寬度'],
      systemKind: 'material',
    });

    expect(result.values).toEqual(['H', 'H型鋼', 'kg', '2', '99', '198', '100', '3 m']);
    expect(result.calculatedHeaders).toEqual([]);
  });

  it('uses the current square width and records only consumed dimensions', () => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '寬度', '長度'],
      values: ['SQ', '方鐵', 'kg', '2', '99', '198', '40 mm', '1000 mm'],
      candidate: {
        erpItemCode: 'SQ',
        category: '方鐵',
        ruleVersion: 'steel-weight-v1',
        exactPhysical: { density: '7.85', widthMm: '20' },
      },
      changedHeaders: ['寬度'],
      systemKind: 'material',
    });

    expect(result.values).toEqual(['SQ', '方鐵', 'kg', '2', '12.56', '25.12', '40', '1000 mm']);
    expect(result.provenance?.['單重']?.dependencies).toEqual({ 寬度: '40', 長度: '1000' });
  });

  it.each(['平鐵', '圓條'])('calculates the canonical profile category %s', (category) => {
    const result = calculateSteelSystemOrderRow({
      headers: ['型號', '類別', '單位', '數量', '單重', '總數', '長度'],
      values: ['PROFILE', category, 'kg', '2', '9', '18', '3 m'],
      candidate: {
        erpItemCode: 'PROFILE',
        category,
        ruleVersion: 'steel-weight-v1',
        unitWeightBasis: 'kg_per_m',
        exactPhysical: { unitWeightValue: '1' },
      },
      changedHeaders: ['長度'],
      systemKind: 'material',
    });

    expect(result.values).toEqual(['PROFILE', category, 'kg', '2', '3', '6', '3000']);
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
