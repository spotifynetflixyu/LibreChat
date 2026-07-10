import { searchSteelCuttingPriceGroups } from './cutting';

import type { SteelRepositoryClient } from './types';

function createCuttingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lookup_term: '鐵管',
    id: '1',
    cutting_category: '鐵管',
    record_type: 'price',
    item_name: '1/2"',
    cut_type: '加工/切工',
    spec_text: '1/2"',
    normalized_spec_text: '1/2"',
    inch_min: '0.500000000',
    inch_max: '0.500000000',
    mm_min: '12.700000000',
    mm_max: '12.700000000',
    unit: '刀',
    unit_price_a: '10.0000',
    unit_price_b: null,
    unit_price_c: '10.0000',
    unit_price_f: '10.0000',
    conditions: {},
    calculation_rule: null,
    notes: null,
    ...overrides,
  };
}

describe('Steel cutting price repository', () => {
  it('runs one unlimited contains-only query after mapping and deduplicating supported categories', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        createCuttingRow(),
        createCuttingRow({
          lookup_term: '鐵板',
          id: '2',
          cutting_category: '鐵板/平鐵',
          item_name: '65~100',
          spec_text: '65~100',
          normalized_spec_text: '65~100',
          inch_min: null,
          inch_max: null,
          mm_min: null,
          mm_max: null,
          unit_price_a: '20.0000',
          unit_price_c: '20.0000',
          unit_price_f: '20.0000',
        }),
        createCuttingRow({
          lookup_term: '平鐵',
          id: '2',
          cutting_category: '鐵板/平鐵',
          item_name: '65~100',
          spec_text: '65~100',
          normalized_spec_text: '65~100',
          inch_min: null,
          inch_max: null,
          mm_min: null,
          mm_max: null,
          unit_price_a: '20.0000',
          unit_price_c: '20.0000',
          unit_price_f: '20.0000',
        }),
      ],
    });

    const groups = await searchSteelCuttingPriceGroups({ query } as SteelRepositoryClient, [
      { queryId: 'pipe-1', category: '圓管' },
      { queryId: 'pipe-2', category: '方管' },
      { queryId: 'pipe-3', category: '扁方管' },
      { queryId: 'flat', category: '平鐵' },
      { queryId: 'plate', category: '鐵板' },
      { queryId: 'discover', mode: 'category_discovery', keyword: 'H型鋼' },
      { queryId: 'unsupported', category: '五金/配件' },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, string[]];
    expect(sql).toContain("c.cutting_category ILIKE '%' || lookup.lookup_term || '%'");
    expect(sql).not.toMatch(/\bLIMIT\b/iu);
    expect(sql).not.toContain('record_type =');
    expect(sql).not.toContain('review_state');
    expect(sql).not.toContain('thickness');
    expect(sql).not.toContain('normalized_spec_text ILIKE');
    expect(JSON.parse(values[0] ?? '[]')).toEqual([
      { lookup_term: '鐵管' },
      { lookup_term: '平鐵' },
      { lookup_term: '鐵板' },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        cuttingCategory: '鐵管',
        sourceCategories: ['圓管', '方管', '扁方管'],
        queryIds: ['pipe-1', 'pipe-2', 'pipe-3'],
        prices: [
          expect.objectContaining({
            tierPrices: { A: 10, B: 10, C: 10, F: 10 },
            tierBSource: 'A/C/F',
          }),
        ],
        supplements: [],
      }),
      expect.objectContaining({
        cuttingCategory: '鐵板/平鐵',
        sourceCategories: ['平鐵', '鐵板'],
        queryIds: ['flat', 'plate'],
        prices: [expect.objectContaining({ id: 2 })],
      }),
    ]);
  });

  it('preserves explicit tier B and separates supplemental rows', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        createCuttingRow({ unit_price_b: '12.0000' }),
        createCuttingRow({
          id: '2',
          record_type: 'supplement',
          item_name: '方管厚度',
          cut_type: '補充',
          spec_text: '方管厚度',
          normalized_spec_text: '方管厚度',
          inch_min: null,
          inch_max: null,
          mm_min: null,
          mm_max: null,
          unit: null,
          unit_price_a: null,
          unit_price_b: null,
          unit_price_c: null,
          unit_price_f: null,
          notes: '方管厚度 1.2 以下不切',
        }),
      ],
    });

    const [group] = await searchSteelCuttingPriceGroups({ query } as SteelRepositoryClient, [
      { queryId: 'pipe', category: '圓管' },
    ]);

    expect(group?.prices[0]).toEqual(
      expect.objectContaining({
        tierPrices: { A: 10, B: 12, C: 10, F: 10 },
        tierBSource: 'B',
      }),
    );
    expect(group?.supplements).toEqual([
      expect.objectContaining({ itemName: '方管厚度', notes: '方管厚度 1.2 以下不切' }),
    ]);
  });

  it('skips the cutting database query when no supported lookup category is present', async () => {
    const query = jest.fn();

    const groups = await searchSteelCuttingPriceGroups({ query } as SteelRepositoryClient, [
      { queryId: 'hardware', category: '五金/配件' },
      { queryId: 'discover', mode: 'category_discovery', keyword: 'H型鋼' },
    ]);

    expect(groups).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
