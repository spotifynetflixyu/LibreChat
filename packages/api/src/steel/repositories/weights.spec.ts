import { searchSteelWeightSpecs } from './weights';

import type { SteelRepositoryClient } from './types';

describe('Steel weight repository', () => {
  it('searches reviewed handbook weight specs and preserves source refs', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '5',
          spec_key: 'H100x100',
          product_family: 'H型鋼',
          shape: 'H',
          material_grade: 'SS400',
          thickness_mm: null,
          width_mm: '100.000',
          height_mm: '100.000',
          flange_width_mm: '100.000',
          web_thickness_mm: '6.000',
          length_m: '6.000',
          weight_kg_per_m: '17.20000',
          weight_kg_per_piece: null,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'handbook_reviewed_data',
              factType: 'handbook_weight',
              locator: 'page=12;row=4',
            },
          ],
        },
      ],
    });

    const result = await searchSteelWeightSpecs({ query } as SteelRepositoryClient, {
      specKey: 'H100x100',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('review_state = $1'), [
      'reviewed',
      'H100x100',
      100,
    ]);
    expect(result[0]).toMatchObject({
      id: 5,
      specKey: 'H100x100',
      productFamily: 'H型鋼',
      weightKgPerM: 17.2,
      reviewState: 'reviewed',
    });
  });
});
