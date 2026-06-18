import { searchSteelPriceItems } from './prices';

import type { SteelRepositoryClient } from './types';

describe('Steel price repositories', () => {
  it('searches reviewed active price candidates with source refs and value state', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '10',
          erp_item_code: 'A001',
          category_id: '3',
          customer_tier_id: '2',
          customer_tier_code: 'B',
          customer_tier_name: 'B級',
          spec_key: 'H100x100',
          product_name: 'H型鋼',
          material_grade: 'SS400',
          unit: 'kg',
          unit_price: '37.5000',
          product_price_unit_weight: '17.20000',
          product_price_unit_weight_unit: 'kg_per_m',
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'product_price',
              locator: 'sheet=Sheet1;row=6',
            },
          ],
        },
      ],
    });

    const result = await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      specKey: 'H100x100',
      customerTierId: 2,
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('review_state = $1'), [
      'reviewed',
      'H100x100',
      2,
      5,
    ]);
    expect(result).toEqual([
      {
        id: 10,
        erpItemCode: 'A001',
        categoryId: 3,
        customerTierId: 2,
        customerTierCode: 'B',
        customerTierName: 'B級',
        specKey: 'H100x100',
        productName: 'H型鋼',
        catalogFamily: undefined,
        materialGrade: 'SS400',
        unit: 'kg',
        unitPrice: 37.5,
        productPriceUnitWeight: 17.2,
        productPriceUnitWeightUnit: 'kg_per_m',
        currency: 'TWD',
        valueState: 'confirmed',
        reviewState: 'reviewed',
        active: true,
        sourceRefs: [
          {
            channel: 'admin_erp_xlsx',
            factType: 'product_price',
            sourceFile: undefined,
            locator: 'sheet=Sheet1;row=6',
            confidence: undefined,
            extractedLabel: undefined,
            canonicalKey: undefined,
            sourceVersionId: undefined,
          },
        ],
      },
    ]);
  });

  it('defaults price candidate query limit to 100 when limit is not provided', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['錏方管'],
      customerTierId: 2,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $4'), [
      'reviewed',
      '%錏方管%',
      2,
      100,
    ]);
  });

  it('preserves unknown reviewed prices as null instead of zero', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '11',
          erp_item_code: null,
          category_id: null,
          customer_tier_id: null,
          spec_key: 'C75',
          product_name: 'C型鋼',
          material_grade: null,
          unit: 'kg',
          unit_price: null,
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'unknown',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    });

    const result = await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      specKey: 'C75',
    });

    expect(result[0]?.unitPrice).toBeNull();
    expect(result[0]?.valueState).toBe('unknown');
  });

  it('searches all price discovery keywords through spec_key contains', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['錏輕型鋼', '75*2.3'],
      erpItemCodes: ['CCG'],
      limit: 10,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining(' OR '), [
      'reviewed',
      '%錏輕型鋼%',
      '%75x2.3%',
      '%CCG%',
      10,
    ]);
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('spec_key ILIKE $2'));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('spec_key ILIKE $3'));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('spec_key ILIKE $4'));
    expect(query.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining('product_name ILIKE'));
    expect(query.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining('erp_item_code ILIKE'));
  });

  it('normalizes product price keywords before spec_key contains search', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['6.0m/mOT板', '16.0m/mOT板'],
      customerTierId: 2,
      limit: 50,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).toContain('spec_key ILIKE $2');
    expect(sql).toContain('spec_key ILIKE $3');
    expect(sql).not.toContain('product_name ILIKE');
    expect(sql).not.toContain('erp_item_code ILIKE');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '%6.0m_mOT板%',
      '%16.0m_mOT板%',
      2,
      50,
    ]);
  });

  it('does not expand product-name aliases for price discovery terms', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['C', '75*2.3'],
      erpItemCodes: ['CCG075'],
      customerTierId: 2,
      limit: 10,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).not.toContain('steel.product_name_aliases');
    expect(sql).not.toContain('target_product_name');
    expect(sql).toContain(' OR ');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '%C%',
      '%75x2.3%',
      '%CCG075%',
      2,
      10,
    ]);
  });

  it('treats surface marker text as spec_key discovery text only', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['白鐵亮面'],
      limit: 10,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).toContain('spec_key ILIKE $2');
    expect(sql).not.toContain('product_name_alias');
    expect(sql).not.toContain('product_name ~*');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '%白鐵亮面%',
      10,
    ]);
  });

  it('does not add surface alias thickness predicates for broad text', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['白鐵'],
      limit: 10,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).toContain('spec_key ILIKE $2');
    expect(sql).not.toContain("product_name_alias.metadata->>'minThicknessMm'");
    expect(sql).not.toContain('NULL::numeric IS NOT NULL');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '%白鐵%',
      10,
    ]);
  });

  it('searches thickness evidence as another spec_key term', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['白鐵', '3t'],
      limit: 10,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).toContain('spec_key ILIKE $2');
    expect(sql).toContain('spec_key ILIKE $3');
    expect(sql).not.toContain("product_name_alias.metadata->>'minThicknessMm'");
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '%白鐵%',
      '%3t%',
      10,
    ]);
  });

  it('searches NO1 product text directly through spec_key', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['白鐵', '3.0m/mSTNO1雷射切割'],
      limit: 10,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).toContain('spec_key ILIKE $2');
    expect(sql).toContain('spec_key ILIKE $3');
    expect(sql).not.toContain('ST[[:space:]]*NO[[:space:]]*1');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '%白鐵%',
      '%3.0m_mSTNO1雷射切割%',
      10,
    ]);
  });

  it('searches NO1 plate-size text directly through spec_key', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['白鐵', "STNO1 3.0*4'*8'(73.5)"],
      limit: 10,
    });

    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'reviewed',
      '%白鐵%',
      '%STNO13.0x4_x8_73.5%',
      10,
    ]);
  });

  it('searches reviewed price candidates with product-name terms', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '21',
          erp_item_code: 'A-L30-25',
          category_id: null,
          customer_tier_id: '1',
          spec_key: 'angle_L30x30x2.5x6M',
          product_name: '錏成型角鐵',
          material_grade: null,
          unit: 'piece',
          unit_price: '194.3000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productName: '錏成型角鐵',
      customerTierId: 1,
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('spec_key ILIKE'), [
      'reviewed',
      '%錏成型角鐵%',
      1,
      5,
    ]);
  });

  it('matches oral zinc angle candidates as a single spec_key term', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productName: '錏角鐵',
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('spec_key ILIKE $2'), [
      'reviewed',
      '%錏角鐵%',
      5,
    ]);
  });

  it('batches multiple product-name candidates as product-name text searches', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['錏成型角鐵 L30x30', '鍍鋅角鐵 L40x40'],
      catalogFamilies: ['angle'],
      customerTierId: 1,
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining(' OR '), [
      'reviewed',
      '%錏成型角鐵L30x30%',
      '%鍍鋅角鐵L40x40%',
      'angle',
      1,
      5,
    ]);
  });

  it('orders broad discovery candidates by combined product-name and ERP-code match score', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productNames: ['錏方管', '方管', '75*2.0'],
      erpItemCodes: ['GDH'],
      customerTierId: 2,
      limit: 20,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');

    expect(sql).toContain('discovery_match_score');
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('discovery_match_score ASC');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('spec_key ILIKE'), [
      'reviewed',
      '%錏方管%',
      '%方管%',
      '%75x2.0%',
      '%GDH%',
      2,
      20,
    ]);
  });

  it('searches reviewed price candidates by normalized catalog family keys', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '31',
          erp_item_code: 'EHS100506',
          category_id: null,
          customer_tier_id: '1',
          spec_key: 'EHS100506_H型鋼100x50x5_7x6M_56_進口',
          product_name: 'H型鋼100*50*5/7*6M(56)進口',
          catalog_family: 'h_beam',
          material_grade: null,
          unit: 'piece',
          unit_price: '1800.0000',
          product_price_unit_weight: '56.00000',
          product_price_unit_weight_unit: 'kg_per_piece',
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    });

    const result = await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      catalogFamilies: ['h_beam'],
      customerTierId: 1,
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('catalog_family IN ($2)'), [
      'reviewed',
      'h_beam',
      1,
      5,
    ]);
    expect(result[0]?.catalogFamily).toBe('h_beam');
  });

  it('searches reviewed price candidates by generic catalog family keys', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '41',
          erp_item_code: 'FTB0311',
          category_id: '9',
          customer_tier_id: '1',
          spec_key: 'FTB0311_磁鋼板專用小六角釘子_黑_電白_5_8_1000支',
          product_name: '磁鋼板專用小六角釘子(黑/電白)5/8 (1000支)',
          catalog_family: 'screw',
          material_grade: null,
          unit: 'piece',
          unit_price: '300.0000',
          product_price_unit_weight: null,
          product_price_unit_weight_unit: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    });

    const result = await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      catalogFamilies: ['screw'],
      customerTierId: 1,
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('catalog_family IN ($2)'), [
      'reviewed',
      'screw',
      1,
      5,
    ]);
    expect(result[0]).toMatchObject({
      catalogFamily: 'screw',
      productName: '磁鋼板專用小六角釘子(黑/電白)5/8 (1000支)',
    });
  });

  it('keeps size text inside product-name candidate searches', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productName: '錏成型角鐵 30x30',
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('spec_key ILIKE'), [
      'reviewed',
      '%錏成型角鐵30x30%',
      5,
    ]);
  });

  it('keeps oral product-name candidates as direct spec_key terms', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productName: '錏角鐵 L30x30',
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('spec_key ILIKE'), [
      'reviewed',
      '%錏角鐵L30x30%',
      5,
    ]);
  });
});
