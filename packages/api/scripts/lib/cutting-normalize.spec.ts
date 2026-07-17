interface CuttingNormalizer {
  mapRawCuttingRow: (row: Record<string, string | number>) => Record<string, unknown> | null;
  normalizeCuttingWorkbookRow: (row: Record<string, unknown>) => Record<string, unknown>;
}

const normalizer = jest.requireActual<CuttingNormalizer>('./cutting-normalize.cjs');

function raw(overrides: Record<string, string | number> = {}) {
  return {
    來源區塊: '鐵管',
    '品項/尺寸': '4"',
    加工: '加工/切工',
    'tier A/C/F': '30',
    'tier B': '',
    備註: '',
    ...overrides,
  };
}

describe('price-only cutting normalization', () => {
  it('maps only 加工/切工 and fills blank tier B from tier A', () => {
    expect(normalizer.mapRawCuttingRow(raw({ 加工: '加工/切斜' }))).toBeNull();
    expect(normalizer.mapRawCuttingRow(raw({ 加工: '加工/孔' }))).toBeNull();
    expect(normalizer.mapRawCuttingRow(raw({ 加工: '加工/倒角' }))).toBeNull();
    expect(normalizer.mapRawCuttingRow(raw({ 加工: '加工/開槽' }))).toBeNull();
    const row = normalizer.mapRawCuttingRow(raw())!;
    expect(row).toMatchObject({
      unit: '刀',
      unit_price_a: 30,
      unit_price_b: 30,
      unit_price_c: 30,
      unit_price_f: 30,
      inch_min: 4,
      inch_max: 4,
      mm_min: 101.6,
      mm_max: 101.6,
    });
    for (const removedField of [
      'record_type',
      'conditions_json',
      'calculation_rule',
      'source_sheet',
      'source_row',
      'spec_selector_json',
      'thickness_axis',
      'normalized_spec_text',
    ]) {
      expect(row).not.toHaveProperty(removedField);
    }
  });

  it('normalizes category-specific dimensions and formal thickness fields', () => {
    const h = normalizer.mapRawCuttingRow(raw({ 來源區塊: 'H型鋼', '品項/尺寸': '200*100' }))!;
    expect(h).toMatchObject({
      height_mm: 200,
      width_mm: 100,
      inch_min: null,
      inch_max: null,
      mm_min: null,
      mm_max: null,
    });
    const flat = normalizer.mapRawCuttingRow(raw({ 來源區塊: '鐵板/平鐵', '品項/尺寸': '5/8~2"', 備註: '厚度：3、4.5、6' }))!;
    expect(flat).toMatchObject({ cutting_category: '平鐵', inch_min: 0.625, inch_max: 2, mm_min: 15.875, mm_max: 50.8, height_mm: null, width_mm: null, thickness_mm_values: '[3,4.5,6]', notes: '厚度:3、4.5、6；白鐵另計' });

    const renormalizedFlat = normalizer.normalizeCuttingWorkbookRow(flat);
    expect(String(renormalizedFlat.notes).match(/白鐵另計/gu)).toHaveLength(1);
    expect(
      normalizer.mapRawCuttingRow(
        raw({ 來源區塊: '黑平鐵', '品項/尺寸': '65~100', 備註: '厚度：6' }),
      ),
    ).toMatchObject({ cutting_category: '平鐵', notes: '厚度:6；白鐵另計' });

    const iBeam = normalizer.mapRawCuttingRow(raw({ 來源區塊: '工字鐵/H型鋼', '品項/尺寸': '194*150' }))!;
    expect(iBeam).toMatchObject({ height_mm: 194, width_mm: 150, mm_min: null, mm_max: null });

    const angle = normalizer.mapRawCuttingRow(raw({ 來源區塊: '角鐵', '品項/尺寸': '1 1/2"' }))!;
    expect(angle).toMatchObject({ inch_min: 1.5, inch_max: 1.5, mm_min: 38.1, mm_max: 38.1 });

    const channelThickness = normalizer.mapRawCuttingRow(raw({ 來源區塊: '槽鐵', '品項/尺寸': '150X9.0' }))!;
    expect(channelThickness).toMatchObject({ mm_min: 150, mm_max: 150, height_mm: null, width_mm: null, thickness_mm_values: '[9]' });

    const channelWidth = normalizer.mapRawCuttingRow(raw({ 來源區塊: '槽鐵', '品項/尺寸': '200X90' }))!;
    expect(channelWidth).toMatchObject({ mm_min: 200, mm_max: 200, height_mm: null, width_mm: null });
  });

  it('keeps zero and blank tiers as null, including seven unpriced source rows', () => {
    const row = normalizer.mapRawCuttingRow(raw({ 來源區塊: 'H型鋼', '品項/尺寸': '400*408', 'tier A/C/F': '', 'tier B': '' }))!;
    expect(row.unit_price_a).toBeNull();
    expect(row.unit_price_b).toBeNull();
    expect(row.unit_price_c).toBeNull();
    expect(row.unit_price_f).toBeNull();
  });

  it('preserves an explicit tier B instead of replacing it with tier A', () => {
    expect(normalizer.mapRawCuttingRow(raw({ 'tier A/C/F': '30', 'tier B': '35' }))).toMatchObject({
      unit_price_a: 30,
      unit_price_b: 35,
    });
  });
});
