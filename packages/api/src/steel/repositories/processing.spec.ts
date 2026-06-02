import {
  searchSteelBendingPrices,
  searchSteelCuttingPrices,
  searchSteelHolePrices,
  searchSteelMaterialRules,
  searchSteelProcessingPrices,
  searchSteelSlottingPrices,
} from './processing';

import type { SteelRepositoryClient } from './types';

describe('Steel processing repositories', () => {
  it('filters processing prices to reviewed active rows by default', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '1',
          processing_type: 'drill',
          product_family: '板材',
          spec_key: null,
          unit: 'hole',
          unit_price: '12.0000',
          min_price: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    });

    const result = await searchSteelProcessingPrices({ query } as SteelRepositoryClient, {
      processingType: 'drill',
      productFamily: '板材',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('active = true'), [
      'reviewed',
      'drill',
      '板材',
      20,
    ]);
    expect(result[0]?.unitPrice).toBe(12);
  });

  it('searches cutting price rows without converting their pricing unit', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '2',
          product_family: 'H型鋼',
          cut_type: 'saw',
          spec_key: 'H100x100',
          length_m: '6.000',
          unit: 'cut',
          unit_price: '80.0000',
          surcharge_per_kg: null,
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    });

    const result = await searchSteelCuttingPrices({ query } as SteelRepositoryClient, {
      productFamily: 'H型鋼',
      cutType: 'saw',
      specKey: 'H100x100',
    });

    expect(result[0]).toMatchObject({
      unit: 'cut',
      unitPrice: 80,
      valueState: 'confirmed',
    });
  });

  it('searches hole, slotting, and bending tables through typed helpers', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: '3',
            hole_type: 'round',
            diameter_mm: '12.000',
            thickness_min_mm: null,
            thickness_max_mm: '9.000',
            unit: 'hole',
            unit_price: '10.0000',
            currency: 'TWD',
            value_state: 'confirmed',
            review_state: 'reviewed',
            active: true,
            source_refs: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '4',
            slot_type: 'long',
            length_mm: '40.000',
            width_mm: '12.000',
            unit: 'slot',
            unit_price: '18.0000',
            currency: 'TWD',
            value_state: 'confirmed',
            review_state: 'reviewed',
            active: true,
            source_refs: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '5',
            bend_type: 'single',
            material_family: '板材',
            thickness_min_mm: '1.000',
            thickness_max_mm: '6.000',
            unit: 'bend',
            unit_price: null,
            currency: 'TWD',
            value_state: 'unknown',
            review_state: 'reviewed',
            active: true,
            source_refs: [],
          },
        ],
      });

    expect(
      await searchSteelHolePrices({ query } as SteelRepositoryClient, { holeType: 'round' }),
    ).toEqual([
      expect.objectContaining({
        id: 3,
        diameterMm: 12,
      }),
    ]);
    expect(
      await searchSteelSlottingPrices({ query } as SteelRepositoryClient, {
        slotType: 'long',
      }),
    ).toEqual([
      expect.objectContaining({
        id: 4,
        lengthMm: 40,
      }),
    ]);
    expect(
      await searchSteelBendingPrices({ query } as SteelRepositoryClient, {
        bendType: 'single',
      }),
    ).toEqual([
      expect.objectContaining({
        id: 5,
        unitPrice: null,
        valueState: 'unknown',
      }),
    ]);
  });

  it('searches non-round hole prices by typed dimensions', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '7',
          hole_type: 'oval',
          diameter_mm: null,
          length_mm: '30.000',
          width_mm: '15.000',
          dimension_label: '30x15',
          thickness_min_mm: null,
          thickness_max_mm: '12.000',
          unit: 'hole',
          unit_price: '18.0000',
          currency: 'TWD',
          value_state: 'confirmed',
          review_state: 'reviewed',
          active: true,
          source_refs: [],
        },
      ],
    });

    const result = await searchSteelHolePrices({ query } as SteelRepositoryClient, {
      holeType: 'oval',
      lengthMm: 30,
      widthMm: 15,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('length_mm = $3'), [
      'reviewed',
      'oval',
      30,
      15,
      20,
    ]);
    expect(result[0]).toMatchObject({
      id: 7,
      holeType: 'oval',
      diameterMm: null,
      lengthMm: 30,
      widthMm: 15,
      dimensionLabel: '30x15',
      unitPrice: 18,
    });
  });

  it('searches reviewed active material rules by lookup selector', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '6',
          code: 'H_NON_STANDARD_LENGTH',
          name: 'H型鋼非標準長度',
          rule_type: 'material_surcharge',
          rule_body: { surcharge_per_kg: 0.3 },
          priority: 10,
          material_family: 'H型鋼',
          condition_type: 'length_not_in',
          active: true,
          review_state: 'reviewed',
          source_refs: [],
        },
      ],
    });

    const result = await searchSteelMaterialRules({ query } as SteelRepositoryClient, {
      materialFamily: 'H型鋼',
      ruleType: 'material_surcharge',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY priority ASC'), [
      'reviewed',
      'H型鋼',
      'material_surcharge',
      20,
    ]);
    expect(result[0]?.ruleBody).toEqual({ surcharge_per_kg: 0.3 });
  });
});
