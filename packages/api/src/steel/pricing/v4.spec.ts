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

describe('Steel price v4.2 parser', () => {
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
      sourceDataset: 'product_price_v4_2',
      sourceRowKey: '00123',
      currency: 'TWD',
      active: true,
      reviewState: 'reviewed',
    });
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

  it('derives hole and cutting price kinds from processing categories', () => {
    const [hole, cutting] = buildSteelPriceV4Rows([
      makeWorkbookRow({ erp_item_code: 'HOLE01', category: '加工/孔', subcategory: '' }),
      makeWorkbookRow({ erp_item_code: 'CUT01', category: '加工/折工', subcategory: '' }),
    ]);

    expect(hole?.priceKind).toBe('hole');
    expect(cutting?.priceKind).toBe('cutting');
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
      reviewState: 'reviewed',
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
      reviewState: 'reviewed',
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
