interface CuttingNormalizer {
  mapRawCuttingRow: (row: Record<string, string | number>, sourceRow: number) => Record<string, unknown> | null;
  normalizeCuttingWorkbookRow: (row: Record<string, string | number | null>) => Record<string, unknown>;
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
  it('maps only the four authoritative price operations and preserves source row', () => {
    expect(normalizer.mapRawCuttingRow(raw({ 加工: '加工/切斜' }), 55)).toBeNull();
    expect(normalizer.mapRawCuttingRow(raw(), 62)).toMatchObject({
      record_type: 'price',
      source_sheet: '全部整理資料',
      source_row: 62,
      unit: '刀',
      unit_price_a: 30,
      unit_price_b: null,
      unit_price_c: 30,
      unit_price_f: 30,
      inch_min: 4,
      inch_max: 4,
      mm_min: 101.6,
      mm_max: 101.6,
    });
  });

  it('normalizes all category selector axes and formal thickness fields', () => {
    const h = normalizer.mapRawCuttingRow(raw({ 來源區塊: 'H型鋼', '品項/尺寸': '200*100' }), 5)!;
    expect(JSON.parse(String(h.spec_selector_json)).selectors[0].axes).toEqual({
      height_mm: { kind: 'exact', value: 200 },
      width_mm: { kind: 'exact', value: 100 },
    });
    const special = normalizer.mapRawCuttingRow(raw({ 來源區塊: 'H型鋼', '品項/尺寸': '', 加工: '加工/孔', 備註: '14m/m 以上另計' }), 3)!;
    expect(special).toMatchObject({ mm_min: null, mm_max: null, thickness_axis: 'flange', thickness_mm_min: 14, thickness_mm_max: null });
    const flat = normalizer.mapRawCuttingRow(raw({ 來源區塊: '鐵板/平鐵', '品項/尺寸': '5/8~2"', 備註: '厚度：3、4.5、6' }), 99)!;
    expect(flat).toMatchObject({ inch_min: 0.625, inch_max: 2, mm_min: 15.875, mm_max: 50.8, thickness_axis: 'material', thickness_mm_values: '[3,4.5,6]' });
    expect(JSON.parse(String(flat.spec_selector_json)).selectors[0].axes.width_mm).toMatchObject({ kind: 'range', min: 15.875, max: 50.8 });

    const iBeam = normalizer.mapRawCuttingRow(raw({ 來源區塊: '工字鐵/H型鋼', '品項/尺寸': '194*150' }), 25)!;
    expect(iBeam).toMatchObject({ mm_min: 194, mm_max: 194 });

    const angle = normalizer.mapRawCuttingRow(raw({ 來源區塊: '角鐵', '品項/尺寸': '1 1/2"' }), 77)!;
    expect(angle).toMatchObject({ inch_min: 1.5, inch_max: 1.5, mm_min: 38.1, mm_max: 38.1 });

    const channelThickness = normalizer.mapRawCuttingRow(raw({ 來源區塊: '槽鐵', '品項/尺寸': '150X9.0' }), 92)!;
    expect(channelThickness).toMatchObject({ mm_min: 150, mm_max: 150, thickness_axis: 'material', thickness_mm_values: '[9]' });
    expect(JSON.parse(String(channelThickness.spec_selector_json)).selectors[0].axes).toEqual({
      height_mm: { kind: 'exact', value: 150 },
      thickness_mm: { kind: 'exact', value: 9 },
    });

    const channelWidth = normalizer.mapRawCuttingRow(raw({ 來源區塊: '槽鐵', '品項/尺寸': '200X90' }), 95)!;
    expect(JSON.parse(String(channelWidth.spec_selector_json)).selectors[0].axes).toEqual({
      height_mm: { kind: 'exact', value: 200 },
      width_mm: { kind: 'exact', value: 90 },
    });
  });

  it('keeps zero and blank tiers as null, including seven unpriced source rows', () => {
    const row = normalizer.mapRawCuttingRow(raw({ 來源區塊: 'H型鋼', '品項/尺寸': '400*408', 'tier A/C/F': '', 'tier B': '' }), 15)!;
    expect(row.unit_price_a).toBeNull();
    expect(row.unit_price_b).toBeNull();
    expect(row.unit_price_c).toBeNull();
    expect(row.unit_price_f).toBeNull();
  });
});
