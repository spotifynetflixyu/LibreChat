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
        specKey: 'H100x100',
        productName: 'H型鋼',
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
            locator: 'sheet=Sheet1;row=6',
          },
        ],
      },
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

  it('searches reviewed price candidates with derived product and partial spec terms', async () => {
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
      specKeyContains: '30x30',
      customerTierId: 1,
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('spec_key ILIKE'), [
      'reviewed',
      '%30x30%',
      '%錏成型角鐵%',
      1,
      5,
    ]);
  });

  it('matches oral zinc angle candidates with bounded product-name tokens', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productName: '錏角鐵',
      specKeyContains: '30x30',
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('product_name ILIKE $3'), [
      'reviewed',
      '%30x30%',
      '%錏%',
      '%角鐵%',
      5,
    ]);
  });

  it('splits size text out of derived product-name candidates', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productName: '錏成型角鐵 30x30',
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('spec_key ILIKE $2'), [
      'reviewed',
      '%30x30%',
      '%錏成型角鐵%',
      5,
    ]);
  });

  it('splits L-size text out of oral product-name candidates', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await searchSteelPriceItems({ query } as SteelRepositoryClient, {
      productName: '錏角鐵 L30x30',
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('spec_key ILIKE $2'), [
      'reviewed',
      '%30x30%',
      '%錏%',
      '%角鐵%',
      5,
    ]);
  });
});
