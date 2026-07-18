import { normalizeSteelPriceWorkbookRow } from './core';
import { applyPriceCategory, getPendingPriceCategoryProposal } from './classification';

import type { SteelPriceV4WorkbookRow } from '../v4';

const makeRow = (overrides: Partial<SteelPriceV4WorkbookRow>): SteelPriceV4WorkbookRow =>
  ({
    erp_item_code: 'TEST',
    formula_code: '',
    product_name: '水電',
    normalized_spec_text: '',
    category: '其他',
    subcategory: '',
    material: '',
    dimension_signature: '',
    unit: '式',
    value_state: 'no_price',
    unit_price_base: '0',
    unit_price_a: '0',
    unit_price_b: '0',
    unit_price_c: '0',
    unit_price_d: '0',
    unit_price_e: '0',
    unit_price_f: '0',
    price_ratio_a: '0',
    price_ratio_b: '0',
    price_ratio_c: '0',
    price_ratio_d: '0',
    price_ratio_e: '0',
    price_ratio_f: '0',
    unit_weight_value: '0',
    unit_weight_basis: '',
    density: '0',
    source_thickness: '',
    width_mm: '',
    height_mm: '',
    length_mm: '',
    outer_diameter_mm: '',
    nominal_inch: '',
    web_mm: '',
    flange_mm: '',
    lip_mm: '',
    sheet_width_mm: '',
    sheet_length_mm: '',
    spec_sort_key: '',
    cost_basis: '2.數量',
    ...overrides,
  }) as SteelPriceV4WorkbookRow;

describe('Steel product category stage', () => {
  it('applies confirmed category before subcategory normalization', () => {
    const ax0292 = applyPriceCategory(
      makeRow({
        erp_item_code: 'AX0292',
        product_name: '百葉窗用銅鏍絲',
        category: '其他',
      }),
    );
    const dnb60 = applyPriceCategory(
      makeRow({
        erp_item_code: 'DNB60',
        product_name: '黑鐵板剪床切倒角',
        category: '鐵板',
      }),
    );

    expect(normalizeSteelPriceWorkbookRow(ax0292)).toMatchObject({
      category: '五金/配件',
      subcategory: '螺絲',
    });
    expect(normalizeSteelPriceWorkbookRow(dnb60)).toMatchObject({
      category: '加工/倒角',
      subcategory: '鐵板',
      processing_method: '剪床',
      processing_shape: null,
    });
  });

  it('keeps category protected inside the normalization parser itself', () => {
    const source = makeRow({ product_name: '百葉窗用銅鏍絲', category: '其他' });
    expect(normalizeSteelPriceWorkbookRow(source).category).toBe('其他');
  });

  it.each([
    ['DNB20', '黑鐵板切圓φ'],
    ['DNB2001', '6.0-10.0mm板切φ'],
    ['DNB2002', '12.0-30.0mm板切φ'],
    ['DNB2003', '32.0-50.0mm板切φ'],
    ['DNB30', '黑鐵板切內外圓◎'],
    ['DNB3001', '6mm-10mm板切 ◎'],
    ['DNB3002', '12mm-30mm板切 ◎'],
    ['DNB3003', '32mm-50mm板切 ◎'],
    ['DNB40', '黑鐵板 CNC切割'],
  ])('uses formula code BH to keep %s in the plate catalog', (erpItemCode, productName) => {
    expect(
      applyPriceCategory(
        makeRow({
          erp_item_code: erpItemCode,
          formula_code: 'BH',
          product_name: productName,
          category: '鐵板',
        }),
      ).category,
    ).toBe('鐵板');
  });

  it('does not apply the BH plate override to an unconfirmed ERP code', () => {
    expect(
      applyPriceCategory(
        makeRow({
          erp_item_code: 'TEST',
          formula_code: 'BH',
          product_name: '黑鐵板 CNC切割',
          category: '鐵板',
        }),
      ).category,
    ).toBe('加工/切工');
  });

  it('does not apply the plate override when the formula code differs', () => {
    expect(
      applyPriceCategory(
        makeRow({
          erp_item_code: 'DNB20',
          formula_code: 'OTHER',
          product_name: '黑鐵板切圓φ',
          category: '鐵板',
        }),
      ).category,
    ).toBe('加工/切工');
  });

  it('classifies AX-prefix subcategories from category plus product_name', () => {
    const rows = [
      makeRow({ erp_item_code: 'AX0000', product_name: '', category: '其他' }),
      makeRow({ erp_item_code: 'AX0001', product_name: '另加烤漆', category: '其他' }),
      makeRow({
        erp_item_code: 'AX0002',
        product_name: '300扁鐵白鐵伸縮(最小30才)',
        category: '捲門/伸縮門',
      }),
      makeRow({
        erp_item_code: 'AX0003',
        product_name: '另加百葉',
        category: '捲門/伸縮門',
      }),
      makeRow({
        erp_item_code: 'AX0004',
        product_name: '601台揚白鐵消音典雅型',
        category: '捲門/伸縮門',
      }),
      makeRow({ erp_item_code: 'AX0005', product_name: '虹龍鋁窗 3尺6', category: '其他' }),
      makeRow({ erp_item_code: 'AX0006', product_name: 'ST花窗1號', category: '其他' }),
      makeRow({ erp_item_code: 'AX0007', product_name: '中式 AU 型門花', category: '其他' }),
      makeRow({
        erp_item_code: 'AX0008',
        product_name: '銀行 43 號花格',
        category: '門窗/門板',
      }),
      makeRow({ erp_item_code: 'AX0009', product_name: 'ST紗網角雙槽', category: '其他' }),
      makeRow({
        erp_item_code: 'AX0292',
        product_name: '百葉窗用銅鏍絲',
        category: '其他',
      }),
    ];
    const normalized = rows.map(applyPriceCategory).map(normalizeSteelPriceWorkbookRow);
    const counts = normalized.reduce<Record<string, number>>((result, row) => {
      const key = `${row.category} :: ${row.subcategory || '(空)'}`;
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});

    expect(rows).toHaveLength(11);
    expect(normalized.filter((row) => String(row.product_name).trim() && !row.subcategory)).toEqual(
      [],
    );
    expect(normalized.find((row) => row.erp_item_code === 'AX0292')).toMatchObject({
      category: '五金/配件',
      subcategory: '螺絲',
    });
    expect(counts).toEqual({
      '其他 :: (空)': 1,
      '加工/其他 :: 烤漆': 1,
      '捲門/伸縮門 :: 伸縮門': 1,
      '捲門/伸縮門 :: 百葉': 1,
      '捲門/伸縮門 :: 門片/簾片': 1,
      '門窗/門板 :: 成品窗/百葉': 1,
      '門窗/門板 :: 窗花': 1,
      '門窗/門板 :: 門花': 1,
      '門窗/門板 :: 花格/防盜': 1,
      '門窗/門板 :: 紗網': 1,
      '五金/配件 :: 螺絲': 1,
    });
    expect(rows.flatMap((row) => (getPendingPriceCategoryProposal(row) ? [row] : []))).toEqual([]);
  });
});
