import { buildSteelPriceV4Rows } from './v4';

import type { SteelPriceV4WorkbookRow } from './v4';

function makeWorkbookRow(
  overrides: Partial<SteelPriceV4WorkbookRow> = {},
): SteelPriceV4WorkbookRow {
  return {
    formula_code: 'H200100',
    erp_item_code: '00123',
    product_name: 'H型鋼 200x100',
    normalized_spec_text: 'H200x100x5.5x8',
    category: 'H型鋼',
    subcategory: '',
    material: 'OT 黑鐵',
    dimension_signature: '200x100x5.5x8',
    unit: '支',
    value_state: 'confirmed',
    unit_price_base: '0',
    unit_price_a: '1,200',
    unit_price_b: '1100',
    unit_price_c: 1000,
    unit_price_d: '0',
    unit_price_e: '',
    unit_price_f: '900',
    price_ratio_a: '0',
    price_ratio_b: '1.2',
    price_ratio_c: 1.1,
    price_ratio_d: '0',
    price_ratio_e: '',
    price_ratio_f: null,
    unit_weight_value: '21.3',
    unit_weight_basis: 'M',
    density: '7.85',
    source_thickness: '5.5',
    width_mm: '200',
    height_mm: '100',
    length_mm: '6000',
    outer_diameter_mm: '',
    nominal_inch: null,
    web_mm: '5.5',
    flange_mm: '8',
    lip_mm: '0',
    sheet_width_mm: '',
    sheet_length_mm: '',
    spec_sort_key: '0200|0100|0055|0080',
    cost_basis: '2.數量',
    ...overrides,
  };
}

describe('Steel price v4.3 parser', () => {
  it('preserves leading-zero ERP codes and returns every workbook field', () => {
    const [row] = buildSteelPriceV4Rows([makeWorkbookRow()]);

    expect(row).toEqual({
      formulaCode: 'H200100',
      erpItemCode: '00123',
      productName: 'H型鋼 200x100',
      normalizedSpecText: 'H200x100x5.5x8',
      category: 'H型鋼',
      subcategory: '',
      material: 'OT 黑鐵',
      dimensionSignature: '200x100x5.5x8',
      unit: '支',
      valueState: 'confirmed',
      unitPriceBase: null,
      unitPriceA: 1200,
      unitPriceB: 1100,
      unitPriceC: 1000,
      unitPriceD: null,
      unitPriceE: null,
      unitPriceF: 900,
      priceRatioA: null,
      priceRatioB: 1.2,
      priceRatioC: 1.1,
      priceRatioD: null,
      priceRatioE: null,
      priceRatioF: null,
      unitWeightValue: 21.3,
      unitWeightBasis: 'M',
      density: 7.85,
      sourceThickness: '5.5',
      thicknessMinMm: 5.5,
      thicknessMaxMm: 5.5,
      widthMm: 200,
      heightMm: 100,
      lengthMm: 6000,
      outerDiameterMm: null,
      nominalInch: null,
      webMm: 5.5,
      flangeMm: 8,
      lipMm: null,
      sheetWidthMm: null,
      sheetLengthMm: null,
      specSortKey: '0200|0100|0055|0080',
      costBasis: '2.數量',
      specKey: '00123 H200x100x5.5x8',
      priceKind: 'product',
      sourceDataset: 'product_price_v4_3',
      sourceRowKey: '00123',
      currency: 'TWD',
      active: true,
    });
    expect(row).not.toHaveProperty('reviewState');
  });

  it('keeps nullable product, normalized spec, and unit fields as null', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: '00000',
        product_name: '',
        normalized_spec_text: null,
        unit: undefined,
      }),
    ]);

    expect(row).toMatchObject({
      erpItemCode: '00000',
      productName: null,
      normalizedSpecText: null,
      unit: null,
      specKey: '00000',
    });
  });

  it('normalizes optional physical zero placeholders to null', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        unit_weight_value: '0',
        density: 0,
        source_thickness: '0.0',
        width_mm: '0',
        height_mm: 0,
        length_mm: '0.0',
        outer_diameter_mm: '0',
        web_mm: 0,
        flange_mm: '0.0',
        lip_mm: '0',
        sheet_width_mm: 0,
        sheet_length_mm: '0.0',
      }),
    ]);

    expect(row).toMatchObject({
      unitWeightValue: null,
      density: null,
      sourceThickness: null,
      widthMm: null,
      heightMm: null,
      lengthMm: null,
      outerDiameterMm: null,
      webMm: null,
      flangeMm: null,
      lipMm: null,
      sheetWidthMm: null,
      sheetLengthMm: null,
    });
  });

  it.each([
    { unit_price_a: '-1' },
    { price_ratio_b: '-1' },
    { unit_weight_value: '-1' },
    { density: '-1' },
    { width_mm: '-1' },
  ])('rejects negative database-constrained numeric values', (overrides) => {
    expect(() => buildSteelPriceV4Rows([makeWorkbookRow(overrides)])).toThrow();
  });

  it.each(['', 'bogus'])('rejects unsupported cost basis %s', (costBasis) => {
    expect(() => buildSteelPriceV4Rows([makeWorkbookRow({ cost_basis: costBasis })])).toThrow();
  });

  it('derives hole and cutting price kinds from processing categories', () => {
    const [hole, cutting] = buildSteelPriceV4Rows([
      makeWorkbookRow({ erp_item_code: 'HOLE01', category: '加工/孔', subcategory: '' }),
      makeWorkbookRow({ erp_item_code: 'CUT01', category: '加工/折工', subcategory: '' }),
    ]);

    expect(hole?.priceKind).toBe('hole');
    expect(cutting?.priceKind).toBe('cutting');
  });

  it('derives inclusive material-thickness bands without treating hole diameters as thickness', () => {
    const [range, exact, sourceRange, diameterRange] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'DZA0612',
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: '厚度6.0-12.0m/m鐵板鑽孔φ',
        normalized_spec_text: '厚度6.0-12.0mm鐵板鑽孔φ t6mm',
        source_thickness: '6',
      }),
      makeWorkbookRow({
        erp_item_code: 'HOLE03',
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: '厚度3.0m/m鐵板鑽孔φ',
        normalized_spec_text: '厚度3.0mm鐵板鑽孔φ',
        source_thickness: '3',
      }),
      makeWorkbookRow({
        erp_item_code: 'HOLE-RANGE',
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: '鐵板鑽孔φ',
        normalized_spec_text: '鐵板鑽孔φ',
        source_thickness: '20~25m/m',
      }),
      makeWorkbookRow({
        erp_item_code: 'BLZZE2',
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: '沖孔φ(1.0~2.0)',
        normalized_spec_text: '沖孔φ(1.0~2.0)',
        source_thickness: '',
      }),
    ]);

    expect(range).toMatchObject({ thicknessMinMm: 6, thicknessMaxMm: 12 });
    expect(exact).toMatchObject({ thicknessMinMm: 3, thicknessMaxMm: 3 });
    expect(sourceRange).toMatchObject({ thicknessMinMm: 20, thicknessMaxMm: 25 });
    expect(diameterRange).toMatchObject({ thicknessMinMm: null, thicknessMaxMm: null });
  });

  it('derives category-specific attributes from v4.3 processing names', () => {
    const [angleHole, squareHole, laserLeading, laserParenthesized, plateCut, bend, roundBar] =
      buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: 'ELH020',
          category: '加工/孔',
          subcategory: '角鐵',
          product_name: '冷鍍鋅角鐵沖孔 51mm*3.5 單*3M',
          normalized_spec_text: '冷鍍鋅角鐵沖孔 51mmx3.5 單x3M 2in 50.8mm',
          dimension_signature: 'in2',
          source_thickness: '',
          width_mm: '',
          length_mm: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'KADS06',
          category: '加工/孔',
          subcategory: '鐵板',
          product_name: '沖3/4□孔',
          normalized_spec_text: '沖3/4□孔',
          dimension_signature: '',
          source_thickness: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'BKZZM2',
          category: '加工/切工',
          subcategory: '鐵板',
          product_name: '2.0 雷射切割',
          normalized_spec_text: '2.0 雷射切割',
          source_thickness: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'BLZZM3',
          category: '加工/切工',
          subcategory: '鐵板',
          product_name: '雷射切割(3.0)',
          normalized_spec_text: '雷射切割(3.0)',
          source_thickness: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'DNB2002',
          category: '加工/切工',
          subcategory: 'H型鋼',
          product_name: '12.0-30.0mm板切φ',
          normalized_spec_text: '12.0-30.0mm板切φ t30mm',
          source_thickness: '30',
        }),
        makeWorkbookRow({
          erp_item_code: 'BKZA010',
          category: '加工/折工',
          subcategory: '鐵板',
          product_name: '板折  型(0.8-2.0)',
          normalized_spec_text: '板折  型(0.8-2.0)',
          source_thickness: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'EQC0280',
          category: '圓條',
          subcategory: '',
          product_name: '磨光中碳光圓 28m/m',
          normalized_spec_text: '磨光中碳光圓 28mm',
          source_thickness: '',
          outer_diameter_mm: '',
        }),
      ]);

    expect(angleHole).toMatchObject({
      widthMm: 51,
      lengthMm: 3000,
      thicknessMinMm: 3.5,
      thicknessMaxMm: 3.5,
      dimensionSignature: 'w51|t3.5|l3000|punch:single',
    });
    expect(squareHole).toMatchObject({ dimensionSignature: 'hole:3/4|shape:□' });
    expect(laserLeading).toMatchObject({ thicknessMinMm: 2, thicknessMaxMm: 2 });
    expect(laserParenthesized).toMatchObject({ thicknessMinMm: 3, thicknessMaxMm: 3 });
    expect(plateCut).toMatchObject({ thicknessMinMm: 12, thicknessMaxMm: 30 });
    expect(bend).toMatchObject({ thicknessMinMm: 0.8, thicknessMaxMm: 2 });
    expect(roundBar).toMatchObject({ outerDiameterMm: 28 });
  });

  it('accepts ratio_only rows only when prices are absent and a ratio exists', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        value_state: 'ratio_only',
        unit_price_a: '0',
        unit_price_b: '0',
        unit_price_c: '0',
        unit_price_f: '0',
        price_ratio_b: '1.25',
      }),
    ]);

    expect(row).toMatchObject({
      valueState: 'ratio_only',
      unitPriceA: null,
      unitPriceB: null,
      unitPriceC: null,
      unitPriceF: null,
      priceRatioB: 1.25,
      active: true,
    });
    expect(() =>
      buildSteelPriceV4Rows([makeWorkbookRow({ value_state: 'ratio_only', unit_price_a: '100' })]),
    ).toThrow('ratio_only');
  });

  it('accepts no_price rows only when both prices and ratios are absent', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        value_state: 'no_price',
        unit_price_a: '0',
        unit_price_b: '0',
        unit_price_c: '0',
        unit_price_f: '0',
        price_ratio_b: '0',
        price_ratio_c: '0',
      }),
    ]);

    expect(row).toMatchObject({
      valueState: 'no_price',
      active: true,
    });
    expect(() =>
      buildSteelPriceV4Rows([makeWorkbookRow({ value_state: 'no_price', price_ratio_a: '1.1' })]),
    ).toThrow('no_price');
  });

  it('requires confirmed rows to contain at least one price', () => {
    expect(() =>
      buildSteelPriceV4Rows([
        makeWorkbookRow({
          unit_price_a: '0',
          unit_price_b: '0',
          unit_price_c: '0',
          unit_price_f: '0',
        }),
      ]),
    ).toThrow('confirmed');
  });

  it('rejects unknown categories and category-mismatched subcategories', () => {
    expect(() => buildSteelPriceV4Rows([makeWorkbookRow({ category: '未知' })])).toThrow(
      'Unknown Steel price category: 未知',
    );
    expect(() =>
      buildSteelPriceV4Rows([makeWorkbookRow({ category: 'T型鋼', subcategory: 'H型鋼' })]),
    ).toThrow('Invalid Steel price subcategory H型鋼 for category T型鋼');
  });
});
