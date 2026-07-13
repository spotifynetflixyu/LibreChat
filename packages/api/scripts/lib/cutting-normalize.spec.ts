interface CuttingNormalizer {
  normalizeCuttingWorkbookRow: (row: Record<string, string | number>) => Record<string, unknown>;
}

const normalizer = jest.requireActual<CuttingNormalizer>('./cutting-normalize.cjs');

function makeRow(overrides: Record<string, string | number> = {}) {
  return {
    cutting_category: '鐵管',
    record_type: 'price',
    item_name: '4”',
    cut_type: '加工/切工',
    spec_text: '4＊1',
    normalized_spec_text: '',
    inch_min: 4,
    inch_max: 4,
    mm_min: 101.6,
    mm_max: 101.6,
    unit: '刀',
    unit_price_a: 10,
    unit_price_b: 0,
    unit_price_c: 10,
    unit_price_f: 10,
    conditions_json: '{}',
    calculation_rule: '',
    notes: '鋸床切割',
    source_sheet: '全部整理資料',
    source_row: 1,
    ...overrides,
  };
}

describe('cutting workbook normalization', () => {
  it('normalizes searchable specs and adds v4.4 processing metadata without changing prices', () => {
    const row = normalizer.normalizeCuttingWorkbookRow(makeRow());
    const conditions = JSON.parse(String(row.conditions_json)) as Record<string, unknown>;

    expect(row).toMatchObject({
      normalized_spec_text: '4x1 鋸床 直線切割',
      unit: '刀',
      unit_price_a: 10,
      unit_price_b: '',
      unit_price_c: 10,
      unit_price_f: 10,
    });
    expect(conditions).toEqual({
      applicable_categories: ['圓管', '方管', '扁方管', '圓條', '方鐵'],
      processing_category: '加工/切工',
      processing_method: '鋸床',
      processing_shape: '直線切割',
    });
  });

  it('uses supplement notes when the item name is only 補充', () => {
    const row = normalizer.normalizeCuttingWorkbookRow(
      makeRow({
        record_type: 'supplement',
        item_name: '補充',
        cut_type: '補充',
        spec_text: '',
        normalized_spec_text: '',
        unit: '',
        unit_price_a: '',
        unit_price_b: '',
        unit_price_c: '',
        unit_price_f: '',
        notes: '圓條不切',
      }),
    );

    expect(row.normalized_spec_text).toBe('圓條不切');
    expect(JSON.parse(String(row.conditions_json))).toMatchObject({
      applicable_categories: ['圓管', '方管', '扁方管', '圓條'],
      processing_category: '加工/切工',
    });
  });
});
