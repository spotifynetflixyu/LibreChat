import path from 'path';
import * as XLSX from 'xlsx';

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

  it('classifies AX-prefix subcategories from category plus product_name', () => {
    const workbook = XLSX.readFile(
      path.resolve(__dirname, '../../../../../../docs/products_db_v4.3.xlsx'),
      { raw: false },
    );
    const rows = XLSX.utils
      .sheet_to_json<SteelPriceV4WorkbookRow>(workbook.Sheets.products_db_ready!, {
        defval: '',
        raw: false,
      })
      .filter((row) => String(row.erp_item_code).startsWith('AX'));
    const normalized = rows.map(applyPriceCategory).map(normalizeSteelPriceWorkbookRow);
    const counts = normalized.reduce<Record<string, number>>((result, row) => {
      const key = `${row.category} :: ${row.subcategory || '(空)'}`;
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});

    expect(rows).toHaveLength(171);
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
      '捲門/伸縮門 :: 伸縮門': 24,
      '捲門/伸縮門 :: 百葉': 1,
      '捲門/伸縮門 :: 門片/簾片': 31,
      '門窗/門板 :: 成品窗/百葉': 2,
      '門窗/門板 :: 窗花': 18,
      '門窗/門板 :: 門花': 22,
      '門窗/門板 :: 花格/防盜': 69,
      '門窗/門板 :: 紗網': 1,
      '五金/配件 :: 螺絲': 1,
    });
    expect(rows.flatMap((row) => (getPendingPriceCategoryProposal(row) ? [row] : []))).toEqual([]);
  });
});
