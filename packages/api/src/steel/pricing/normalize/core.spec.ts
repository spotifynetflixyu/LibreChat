import { buildSteelPriceV4Rows } from '../v4';
import {
  normalizeSteelPriceWorkbookRow,
  normalizedSteelPriceV4WorkbookHeaders,
  protectedSteelPriceWorkbookHeaders,
} from './core';

import type { SteelPriceV4WorkbookRow } from '../v4';

const legacyHeaders = [
  'erp_item_code',
  'formula_code',
  'product_name',
  'normalized_spec_text',
  'category',
  'subcategory',
  'material',
  'dimension_signature',
  'unit',
  'value_state',
  'unit_price_base',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_d',
  'unit_price_e',
  'unit_price_f',
  'price_ratio_a',
  'price_ratio_b',
  'price_ratio_c',
  'price_ratio_d',
  'price_ratio_e',
  'price_ratio_f',
  'unit_weight_value',
  'unit_weight_basis',
  'density',
  'source_thickness',
  'width_mm',
  'height_mm',
  'length_mm',
  'outer_diameter_mm',
  'nominal_inch',
  'web_mm',
  'flange_mm',
  'lip_mm',
  'sheet_width_mm',
  'sheet_length_mm',
  'spec_sort_key',
  'cost_basis',
] as const;

function makeRow(overrides: Partial<SteelPriceV4WorkbookRow> = {}): SteelPriceV4WorkbookRow {
  return {
    ...Object.fromEntries(legacyHeaders.map((header) => [header, ''])),
    erp_item_code: 'ERP001',
    product_name: 'ST2B 0.5 切',
    normalized_spec_text: 'ST2B 0.5 切 t2mm',
    category: '鐵板',
    material: '白鐵霧面 / ST 2B',
    unit: 'm2',
    value_state: 'confirmed',
    unit_price_a: '100',
    density: '7.85',
    cost_basis: '2.數量',
    ...overrides,
  } as SteelPriceV4WorkbookRow;
}

describe('Steel price workbook normalization core', () => {
  it('adds processing attributes and exact camelCase thickness headers', () => {
    const densityIndex = normalizedSteelPriceV4WorkbookHeaders.indexOf('density');
    const subcategoryIndex = normalizedSteelPriceV4WorkbookHeaders.indexOf('subcategory');

    expect(
      normalizedSteelPriceV4WorkbookHeaders.slice(subcategoryIndex, subcategoryIndex + 4),
    ).toEqual(['subcategory', 'processing_method', 'processing_shape', 'material']);

    expect(normalizedSteelPriceV4WorkbookHeaders.slice(densityIndex, densityIndex + 5)).toEqual([
      'density',
      'thicknessMinMm',
      'thicknessMaxMm',
      'width_mm',
      'height_mm',
    ]);
    expect(normalizedSteelPriceV4WorkbookHeaders).toHaveLength(41);
    expect(normalizedSteelPriceV4WorkbookHeaders).toContain('spec_key');
    expect(normalizedSteelPriceV4WorkbookHeaders).not.toContain('normalized_spec_text');
    expect(normalizedSteelPriceV4WorkbookHeaders).not.toContain('dimension_signature');
    expect(normalizedSteelPriceV4WorkbookHeaders).not.toContain('source_thickness');
  });

  it('normalizes parser fields while preserving protected source cells', () => {
    const source = makeRow();
    const parsed = buildSteelPriceV4Rows([source])[0];
    if (!parsed) {
      throw new Error('Expected parsed row');
    }

    const normalized = normalizeSteelPriceWorkbookRow(source);

    expect(normalized.subcategory).toBe('切板');
    expect(normalized.material).toBe('2B 白鐵霧面');
    expect(normalized.unit).toBe('㎡');
    expect(normalized.thicknessMinMm).toBe(0.5);
    expect(normalized.thicknessMaxMm).toBe(0.5);
    expect(normalized.spec_key).toContain('t0.5mm');
    expect(normalized.spec_key).not.toContain('t2mm');
    expect(parsed.thicknessMinMm).toBe(0.5);
    for (const header of protectedSteelPriceWorkbookHeaders) {
      expect(normalized[header]).toBe(source[header]);
    }
  });

  it('does not infer hot-dip material from an accessory usage description', () => {
    const normalized = normalizeSteelPriceWorkbookRow(
      makeRow({
        erp_item_code: 'FCP1104',
        product_name: '合金底漆(白鐵熱浸鍍鋅用)-1加',
        normalized_spec_text: '合金底漆(白鐵熱浸鍍鋅用)-1加',
        category: '五金/配件',
        material: '',
        unit: '加',
      }),
    );

    expect(normalized.material).toBeNull();
    expect(normalized.subcategory).toBe('塗料/溶劑');
  });

  it('keeps mesh subcategories concise in product workbook normalization', () => {
    const normalized = normalizeSteelPriceWorkbookRow(
      makeRow({
        erp_item_code: 'MESH-WAVE',
        product_name: '錏浪型網 10#(3.0)x25mm □孔',
        normalized_spec_text: '錏浪型網 10#(3.0)x25mm □孔',
        category: '網',
        subcategory: '菱形',
      }),
    );

    expect(normalized.subcategory).toBe('浪型');
  });

  it.each([
    ['鐵板', '花板', '黑花 3.0 切'],
    ['鐵板', '花板', '3.0ST花 雷切割型'],
    ['門窗/門板', '門花', 'D型同心門[花5公分]'],
    ['圓管', 'B管', '白B鍍鋅鋼管'],
    ['網', '鐵網', '錏網'],
    ['五金/配件', '緊固/錨固', '1/2突緣帽'],
    ['五金/配件', '緊固/錨固', '磁鋼板專用小六角釘子'],
  ])(
    'normalizes %s product names to concise subcategory %s',
    (category, subcategory, productName) => {
      const normalized = normalizeSteelPriceWorkbookRow(
        makeRow({ category, subcategory: '', product_name: productName }),
      );

      expect(normalized.subcategory).toBe(subcategory);
    },
  );

  it('adds processing method and shape to spec_key for keyword lookup', () => {
    const normalized = normalizeSteelPriceWorkbookRow(
      makeRow({
        product_name: '3.0 雷射切割',
        category: '加工/切工',
        subcategory: '',
      }),
    );

    expect(normalized).toMatchObject({
      processing_method: '雷射',
      processing_shape: '外形切割',
    });
    expect(normalized.spec_key).toContain('雷射');
    expect(normalized.spec_key).toContain('外形切割');
  });

  it('normalizes a diamond hole symbol to the canonical hole shape keyword', () => {
    const normalized = normalizeSteelPriceWorkbookRow(
      makeRow({
        product_name: '沖3/4◇孔',
        category: '加工/孔',
        subcategory: '',
      }),
    );

    expect(normalized).toMatchObject({
      processing_method: '沖床',
      processing_shape: '菱形孔',
    });
    expect(normalized.spec_key).toContain('菱形孔');
  });

  it('normalizes an allowed hot-dip material category', () => {
    const normalized = normalizeSteelPriceWorkbookRow(
      makeRow({
        product_name: '熱浸鍍槽鐵100*50*5/7.5*6M(59)',
        normalized_spec_text: '熱浸鍍槽鐵100x50x5/7.5x6M(59)',
        category: '槽鐵',
        material: '黑鐵 / OT',
        unit: '支',
      }),
    );

    expect(normalized.material).toBe('錏/鍍鋅');
    expect(normalized.subcategory).toBe('標準');
  });

  it('maps legacy material aliases into the fixed storage enum', () => {
    const normalized = normalizeSteelPriceWorkbookRow(
      makeRow({
        product_name: '白A鋼管 25mm*1.5',
        category: '圓管',
        material: '錏 / 白A',
      }),
    );

    expect(normalized.material).toBe('錏/鍍鋅');
  });
});
