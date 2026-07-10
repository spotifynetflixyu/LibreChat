import { searchSteelPriceCandidateGroups } from './prices';

import type { SteelRepositoryClient } from './types';

function createPriceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '10',
    erp_item_code: '00123',
    price_kind: 'product',
    formula_code: null,
    spec_key: '00123 黑鐵鋼管 50x2.0',
    product_name: '黑鐵鋼管',
    normalized_spec_text: '50x2.0',
    category: '圓管',
    subcategory: '鋼管',
    material: '黑鐵 / OT',
    dimension_signature: 'OD50-T2',
    unit: 'Kg',
    value_state: 'confirmed',
    unit_price_base: '35.0000',
    unit_price_a: '40.0000',
    unit_price_b: '42.0000',
    unit_price_c: null,
    unit_price_d: '44.0000',
    unit_price_e: null,
    unit_price_f: '50.0000',
    price_ratio_a: '1.4000',
    price_ratio_b: '1.3000',
    price_ratio_c: null,
    price_ratio_d: '1.2000',
    price_ratio_e: null,
    price_ratio_f: '1.1000',
    unit_weight_value: '12.345000',
    unit_weight_basis: 'Kg/M',
    density: '7.850000',
    source_thickness: '2.0',
    width_mm: null,
    height_mm: null,
    length_mm: '6000.000000',
    outer_diameter_mm: '50.000000',
    nominal_inch: null,
    web_mm: null,
    flange_mm: null,
    lip_mm: null,
    sheet_width_mm: null,
    sheet_length_mm: null,
    spec_sort_key: '050.000-002.000',
    cost_basis: 'Kg',
    currency: 'TWD',
    active: true,
    source_refs: [],
    ...overrides,
  };
}

describe('Steel price candidate repository', () => {
  it('uses one SQL round trip for ordered lookup and discovery groups with exact filters', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          query_index: 1,
          query_id: 'discover',
          price_candidates: [],
          category_candidates: [
            {
              category: '圓管',
              material: '黑鐵 / OT',
              candidate_count: '12',
              example_erp_item_code: '00123',
              example_product_name: '黑鐵鋼管',
            },
          ],
        },
        {
          query_index: 0,
          query_id: 'line-1',
          price_candidates: [createPriceRow()],
          category_candidates: [],
        },
      ],
    });

    const result = await searchSteelPriceCandidateGroups({ query } as SteelRepositoryClient, {
      queries: [
        {
          queryId: 'line-1',
          category: '圓管',
          subcategory: '鋼管',
          material: '黑鐵',
          thicknessMm: ['2', '2.0', '2.3'],
          erpItemCode: '00123',
          keyword: '黑鐵鋼管 50*2',
          limit: 101,
        },
        {
          queryId: 'discover',
          mode: 'category_discovery',
          keyword: '黑鐵 鋼管',
        },
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0] ?? '');
    const values = query.mock.calls[0]?.[1] as string[];
    const serializedQueries = JSON.parse(values[0] ?? '[]') as Array<Record<string, unknown>>;

    expect(sql).toContain('jsonb_to_recordset($1::jsonb)');
    expect(sql).toContain('p.erp_item_code = input_query.erp_item_code');
    expect(sql).toContain('p.category = input_query.category');
    expect(sql).toContain('p.subcategory = input_query.subcategory');
    expect(sql).toContain('p.material ILIKE');
    expect(sql).toContain('p.source_thickness::numeric');
    expect(sql).not.toContain('p.unit = input_query.unit');
    expect(sql).toContain('p.spec_key ILIKE');
    expect(sql).toContain('p.normalized_spec_text ILIKE');
    expect(sql).not.toContain('review_state');
    expect(sql).toContain('p.active = true');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).not.toContain('source_subcategory_label');
    expect(sql).not.toContain('source_spec');
    expect(sql).not.toContain('product_price_unit_weight');
    expect(serializedQueries).toEqual([
      expect.objectContaining({
        query_index: 0,
        query_id: 'line-1',
        mode: 'lookup',
        category: '圓管',
        subcategory: '鋼管',
        material: '黑鐵',
        keyword_terms: ['黑鐵鋼管', '50x2'],
        thickness_mm: ['2', '2.3'],
        erp_item_code: '00123',
        query_limit: 100,
      }),
      expect.objectContaining({
        query_index: 1,
        query_id: 'discover',
        mode: 'category_discovery',
        query_limit: 30,
      }),
    ]);
    expect(result.map((group) => group.queryId)).toEqual(['line-1', 'discover']);
    expect(result[0]?.candidates[0]).toEqual(
      expect.objectContaining({
        id: 10,
        erpItemCode: '00123',
        normalizedSpecText: '50x2.0',
        category: '圓管',
        subcategory: '鋼管',
        unit: 'Kg',
        tierPrices: { A: 40, B: 42, C: null, D: 44, E: null, F: 50 },
        tierRatios: { A: 1.4, B: 1.3, C: null, D: 1.2, E: null, F: 1.1 },
        unitPriceBase: 35,
        valueState: 'confirmed',
      }),
    );
    expect(result[1]?.categoryCandidates).toEqual([
      {
        category: '圓管',
        material: '黑鐵 / OT',
        candidateCount: 12,
        exampleErpItemCode: '00123',
        exampleProductName: '黑鐵鋼管',
      },
    ]);
  });

  it('keeps 錏 and 鋅 material contains terms distinct', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          query_index: 0,
          query_id: 'galvanized',
          price_candidates: [createPriceRow({ material: '錏 / 白A' })],
          category_candidates: [],
        },
      ],
    });

    await searchSteelPriceCandidateGroups({ query } as SteelRepositoryClient, {
      queries: [
        { queryId: 'galvanized', category: '圓管', material: '錏' },
        { queryId: 'zinc', category: '圓管', material: '鋅' },
      ],
    });

    const values = query.mock.calls[0]?.[1] as string[];
    const serializedQueries = JSON.parse(values[0] ?? '[]') as Array<Record<string, unknown>>;

    expect(serializedQueries[0]).toEqual(
      expect.objectContaining({
        material: '錏',
        material_terms: ['錏'],
      }),
    );
    expect(serializedQueries[1]).toEqual(
      expect.objectContaining({
        material: '鋅',
        material_terms: ['鋅'],
      }),
    );
  });

  it('deduplicates only within a query group and preserves the same row across groups', async () => {
    const shared = createPriceRow();
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          query_index: 0,
          query_id: 'line-1',
          price_candidates: [shared, shared],
          category_candidates: [],
        },
        {
          query_index: 1,
          query_id: 'line-2',
          price_candidates: [shared],
          category_candidates: [],
        },
      ],
    });

    const result = await searchSteelPriceCandidateGroups({ query } as SteelRepositoryClient, {
      queries: [
        { queryId: 'line-1', category: '圓管', keyword: '00123' },
        { queryId: 'line-2', category: '圓管', keyword: '00123' },
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(result[0]?.candidates).toHaveLength(1);
    expect(result[1]?.candidates).toHaveLength(1);
    expect(result[0]?.candidates[0]?.id).toBe(10);
    expect(result[1]?.candidates[0]?.id).toBe(10);
  });

  it('preserves nullable v4.2 prices and ratios without zero filling', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          query_index: 0,
          query_id: 'ratio',
          price_candidates: [
            createPriceRow({
              value_state: 'ratio_only',
              unit_price_base: null,
              unit_price_a: null,
              unit_price_b: null,
              unit_price_c: null,
              unit_price_d: null,
              unit_price_e: null,
              unit_price_f: null,
            }),
          ],
          category_candidates: [],
        },
      ],
    });

    const result = await searchSteelPriceCandidateGroups({ query } as SteelRepositoryClient, {
      queries: [{ queryId: 'ratio', category: '圓管' }],
    });

    expect(result[0]?.candidates[0]).toEqual(
      expect.objectContaining({
        tierPrices: { A: null, B: null, C: null, D: null, E: null, F: null },
        tierRatios: { A: 1.4, B: 1.3, C: null, D: 1.2, E: null, F: 1.1 },
        valueState: 'ratio_only',
      }),
    );
  });
});
