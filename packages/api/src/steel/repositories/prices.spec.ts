import { discoverSteelPriceCategories, searchSteelPriceItems } from './prices';

import type { SteelRepositoryClient } from './types';

function createPriceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '10',
    erp_item_code: 'GDH075',
    price_kind: 'product',
    spec_key: 'GDH075_黑方管75x45x2.0',
    product_name: '黑方管 75*45*2.0',
    category: '扁方管',
    subcategory: null,
    material: 'OT 黑鐵',
    source_subcategory_label: null,
    source_thickness: '2.0',
    source_spec: '75*45',
    unit: 'piece',
    unit_price_a: '100.0000',
    unit_price_b: '110.0000',
    unit_price_c: '120.0000',
    unit_price_f: '130.0000',
    ratio_a: null,
    ratio_b: null,
    ratio_c: null,
    ratio_f: null,
    product_price_unit_weight: '12.34500',
    product_price_unit_weight_unit: 'kg_per_piece',
    currency: 'TWD',
    value_state: 'confirmed',
    review_state: 'reviewed',
    active: true,
    source_refs: [
      {
        channel: 'admin_erp_xlsx',
        factType: 'product_price',
        locator: 'sheet=整理後資料;row=6',
      },
    ],
    ...overrides,
  };
}

describe('Steel price repositories', () => {
  it('searches unified reviewed active price rows by category, material, thickness, spec, and keyword', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [createPriceRow()],
    });

    const result = await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      queries: [
        {
          category: '扁方管',
          material: 'OT 黑鐵',
          thicknesses: ['2'],
          specs: ['75*45'],
          keyword: '黑方管',
        },
      ],
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.prices'), [
      'reviewed',
      '扁方管',
      'OT 黑鐵',
      '2.0',
      '%75x45%',
      '%黑方管%',
      5,
    ]);
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('review_state = $1'));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('active = true'));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('category = $2'));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('material = $3'));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('source_thickness = $4'));
    expect(query.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining('steel.price_items'));
    expect(query.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining('customer_tier_id'));
    expect(result).toEqual([
      {
        id: 10,
        erpItemCode: 'GDH075',
        priceKind: 'product',
        specKey: 'GDH075_黑方管75x45x2.0',
        productName: '黑方管 75*45*2.0',
        category: '扁方管',
        subcategory: undefined,
        material: 'OT 黑鐵',
        sourceSubcategoryLabel: undefined,
        sourceThickness: '2.0',
        sourceSpec: '75*45',
        unit: 'piece',
        tierPrices: { A: 100, B: 110, C: 120, F: 130 },
        tierRatios: { A: null, B: null, C: null, F: null },
        productPriceUnitWeight: 12.345,
        productPriceUnitWeightUnit: 'kg_per_piece',
        currency: 'TWD',
        valueState: 'confirmed',
        reviewState: 'reviewed',
        active: true,
        sourceRefs: [
          {
            channel: 'admin_erp_xlsx',
            factType: 'product_price',
            sourceFile: undefined,
            locator: 'sheet=整理後資料;row=6',
            confidence: undefined,
            extractedLabel: undefined,
            canonicalKey: undefined,
            sourceVersionId: undefined,
          },
        ],
      },
    ]);
  });

  it('returns all tier prices without adding a customer tier predicate', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [createPriceRow()] });

    const result = await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      queries: [{ category: '扁方管', keyword: 'GDH075' }],
    });

    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '扁方管',
      '%GDH075%',
      100,
    ]);
    expect(query.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining('customer_tier'));
    expect(result[0]?.tierPrices).toEqual({ A: 100, B: 110, C: 120, F: 130 });
  });

  it('preserves unknown reviewed prices as null instead of zero', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        createPriceRow({
          unit_price_a: null,
          unit_price_b: null,
          unit_price_c: null,
          unit_price_f: null,
          value_state: 'unknown',
        }),
      ],
    });

    const result = await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      queries: [{ category: '扁方管', keyword: 'GDH075' }],
    });

    expect(result[0]?.tierPrices).toEqual({ A: null, B: null, C: null, F: null });
    expect(result[0]?.valueState).toBe('unknown');
  });

  it('searches multiple query objects as OR groups while keeping each query facets conjunctive', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      queries: [
        { category: '扁方管', material: 'OT 黑鐵', specs: ['75'] },
        { category: '扁方管', material: '錏', specs: ['50'] },
      ],
      limit: 10,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).toContain(' OR ');
    expect(sql).toContain('category = $2');
    expect(sql).toContain('material = $3');
    expect(sql).toContain('category = $5');
    expect(sql).toContain('material = $6');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '扁方管',
      'OT 黑鐵',
      '%75%',
      '扁方管',
      '錏',
      '%50%',
      10,
    ]);
  });

  it('can include related cutting rows in the same price lookup', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        createPriceRow({
          id: '20',
          erp_item_code: null,
          price_kind: 'cutting',
          spec_key: 'H型鋼200x100切工',
          product_name: 'H型鋼 200*100 切工',
          category: '切工/切割',
          subcategory: 'H型鋼',
          material: '無',
          source_subcategory_label: 'H型鋼',
          source_spec: '200x100',
          unit: '刀',
        }),
      ],
    });

    const result = await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      queries: [{ category: 'H型鋼', specs: ['200*100'] }],
      includeRelatedCutting: true,
      limit: 20,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).toContain('category = $2');
    expect(sql).toContain("price_kind = 'cutting'");
    expect(sql).toContain('category = $4');
    expect(sql).toContain('subcategory = ANY($5::text[])');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      'H型鋼',
      '%200x100%',
      '切工/切割',
      ['H型鋼', '工字鐵/H型鋼'],
      '%200x100%',
      20,
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        id: 20,
        priceKind: 'cutting',
        category: '切工/切割',
        subcategory: 'H型鋼',
        sourceSubcategoryLabel: 'H型鋼',
        sourceSpec: '200x100',
        unit: '刀',
      }),
    ]);
  });

  it('discovers candidate categories before exact lookup when category is unknown', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          category: '扁方管',
          material: 'OT 黑鐵',
          candidate_count: '8',
          example_erp_item_code: 'GDH075',
          example_product_name: '黑方管 75*45',
        },
      ],
    });

    const result = await discoverSteelPriceCategories({ query } as SteelRepositoryClient, {
      keyword: '黑方管 75',
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('GROUP BY category, material'), [
      'reviewed',
      '%黑方管 75%',
      '%黑方管75%',
      5,
    ]);
    expect(result).toEqual([
      {
        category: '扁方管',
        material: 'OT 黑鐵',
        candidateCount: 8,
        exampleErpItemCode: 'GDH075',
        exampleProductName: '黑方管 75*45',
      },
    ]);
  });
});
