import { filterSteelCuttingPriceGroups, searchSteelCuttingPriceGroups } from './cutting';

import type { SteelPriceItem } from './prices';
import type { SteelRepositoryClient } from './types';
import type { SteelCuttingPriceGroup, SteelCuttingPriceRecord } from './cutting';

function createCuttingRecord(
  overrides: Partial<SteelCuttingPriceRecord> = {},
): SteelCuttingPriceRecord {
  return {
    id: 1,
    cuttingCategory: 'H型鋼',
    itemName: '250x250',
    cutType: '加工/切工',
    specText: '250*250',
    inchMin: null,
    inchMax: null,
    mmMin: null,
    mmMax: null,
    heightMm: 250,
    widthMm: 250,
    thicknessMmValues: null,
    thicknessMmMin: null,
    thicknessMmMax: null,
    unit: '刀',
    tierPrices: { A: 100, B: 100, C: 100, F: 100 },
    ...overrides,
  };
}

function createCuttingGroup(
  overrides: Partial<SteelCuttingPriceGroup> = {},
): SteelCuttingPriceGroup {
  return {
    cuttingCategory: 'H型鋼',
    sourceCategories: ['H型鋼'],
    queryIds: ['q1'],
    prices: [],
    candidateMatches: [],
    ...overrides,
  };
}

function createPriceItem(overrides: Partial<SteelPriceItem> = {}): SteelPriceItem {
  return {
    id: 1,
    erpItemCode: 'EHS252510',
    specKey: 'EHS252510 H型鋼250x250x9/14x10M',
    productName: 'H型鋼250*250*9/14*10M',
    category: 'H型鋼',
    unit: 'Kg',
    valueState: 'confirmed',
    unitPriceBase: null,
    tierPrices: { A: 29.3, B: 29.3, C: 29.3, D: 29.3, E: 29.3, F: 29.3 },
    tierRatios: { A: null, B: null, C: null, D: null, E: null, F: null },
    unitWeightValue: 718,
    density: null,
    thicknessMinMm: 9,
    thicknessMaxMm: 9,
    widthMm: 250,
    heightMm: 250,
    lengthMm: 10000,
    outerDiameterMm: null,
    webMm: null,
    flangeMm: null,
    lipMm: null,
    sheetWidthMm: null,
    sheetLengthMm: null,
    costBasis: 'tier_price',
    ...overrides,
  };
}

function createCuttingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lookup_cutting_category: '鐵管',
    id: '1',
    cutting_category: '鐵管',
    item_name: '1/2"',
    cut_type: '加工/切工',
    spec_text: '1/2"',
    inch_min: '0.500000000',
    inch_max: '0.500000000',
    mm_min: '12.700000000',
    mm_max: '12.700000000',
    height_mm: null,
    width_mm: null,
    thickness_mm_values: null,
    thickness_mm_min: null,
    thickness_mm_max: null,
    unit: '刀',
    unit_price_a: '10.0000',
    unit_price_b: null,
    unit_price_c: '11.0000',
    unit_price_f: '12.0000',
    notes: null,
    ...overrides,
  };
}

describe('Steel cutting price repository', () => {
  it('matches H dimensions per candidate and preserves candidate correlation', () => {
    const groups = [
      createCuttingGroup({
        prices: [
          createCuttingRecord({ id: 1 }),
          createCuttingRecord({
            id: 2,
            itemName: '340x250',
            specText: '340x250',
            heightMm: 340,
            widthMm: 250,
          }),
        ],
      }),
    ];

    const filtered = filterSteelCuttingPriceGroups(groups, [
      { queryId: 'q1', category: 'H型鋼', candidates: [createPriceItem()] },
      {
        queryId: 'q2',
        category: 'H型鋼',
        candidates: [
          createPriceItem({ id: 2, erpItemCode: 'EHS342510', specKey: 'H 340x250', heightMm: 340 }),
        ],
      },
    ]);

    expect(filtered).toEqual([
      expect.objectContaining({
        queryIds: ['q1', 'q2'],
        prices: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })],
        candidateMatches: [
          {
            queryId: 'q1',
            priceCandidateId: 1,
            erpItemCode: 'EHS252510',
            specKey: 'EHS252510 H型鋼250x250x9/14x10M',
            cuttingPriceIds: [1],
          },
          {
            queryId: 'q2',
            priceCandidateId: 2,
            erpItemCode: 'EHS342510',
            specKey: 'H 340x250',
            cuttingPriceIds: [2],
          },
        ],
      }),
    ]);
  });

  it('keeps base-only candidates eligible for cutting-price matching', () => {
    const [filtered] = filterSteelCuttingPriceGroups(
      [createCuttingGroup({ prices: [createCuttingRecord()] })],
      [
        {
          queryId: 'q1',
          category: 'H型鋼',
          candidates: [
            createPriceItem({
              unitPriceBase: 35,
              tierPrices: { A: null, B: null, C: null, D: null, E: null, F: null },
            }),
          ],
        },
      ],
    );

    expect(filtered.candidateMatches).toEqual([
      expect.objectContaining({ priceCandidateId: 1, cuttingPriceIds: [1] }),
    ]);
  });

  it('exposes the H 30~50 note as manual confirmation without changing prices', () => {
    const groups = [
      createCuttingGroup({
        cuttingCategory: '工字鐵/H型鋼',
        prices: [
          createCuttingRecord({
            cuttingCategory: '工字鐵/H型鋼',
            notes: 'H型鋼 另+30~50',
          }),
        ],
      }),
    ];

    const [filtered] = filterSteelCuttingPriceGroups(groups, [
      { queryId: 'q1', category: 'H型鋼', candidates: [createPriceItem()] },
    ]);

    expect(filtered).toMatchObject({
      manualReviewRequired: true,
      manualReviewNotes: [expect.stringMatching(/H型鋼 另\+30~50.*人工確認/u)],
      prices: [
        expect.objectContaining({
          tierPrices: { A: 100, B: 100, C: 100, F: 100 },
        }),
      ],
    });
  });

  it('matches all catalog categories from retained dimensions and thickness fields', () => {
    const groups = [
      createCuttingGroup({
        cuttingCategory: '鐵管',
        sourceCategories: ['圓管'],
        prices: [
          createCuttingRecord({
            id: 10,
            cuttingCategory: '鐵管',
            itemName: '4"',
            specText: '4"',
            inchMin: 4,
            inchMax: 4,
            mmMin: 101.6,
            mmMax: 101.6,
            heightMm: null,
            widthMm: null,
          }),
          createCuttingRecord({
            id: 11,
            cuttingCategory: '鐵管',
            itemName: '318.5',
            specText: '318.5',
            mmMin: 318.5,
            mmMax: 318.5,
            heightMm: null,
            widthMm: null,
          }),
        ],
      }),
      createCuttingGroup({
        cuttingCategory: '角鐵',
        sourceCategories: ['角鐵'],
        prices: [
          createCuttingRecord({
            id: 20,
            cuttingCategory: '角鐵',
            itemName: '75x50',
            specText: '75x50',
            heightMm: null,
            widthMm: null,
          }),
        ],
      }),
      createCuttingGroup({
        cuttingCategory: '槽鐵',
        sourceCategories: ['槽鐵'],
        prices: [
          createCuttingRecord({
            id: 30,
            cuttingCategory: '槽鐵',
            itemName: '150x9.0',
            specText: '150x9.0',
            mmMin: 150,
            mmMax: 150,
            heightMm: null,
            widthMm: null,
            thicknessMmValues: [9],
          }),
        ],
      }),
      createCuttingGroup({
        cuttingCategory: '平鐵',
        sourceCategories: ['平鐵'],
        prices: [
          createCuttingRecord({
            id: 40,
            cuttingCategory: '平鐵',
            itemName: '65~100',
            specText: '65~100',
            mmMin: 65,
            mmMax: 100,
            heightMm: null,
            widthMm: null,
            thicknessMmValues: [6.1, 9.8],
          }),
        ],
      }),
    ];

    const filtered = filterSteelCuttingPriceGroups(groups, [
      {
        queryId: 'pipe-nominal',
        category: '圓管',
        candidates: [createPriceItem({ id: 10, category: '圓管', nominalInch: '4' })],
      },
      {
        queryId: 'pipe-outer',
        category: '圓管',
        candidates: [
          createPriceItem({
            id: 11,
            category: '圓管',
            nominalInch: undefined,
            outerDiameterMm: 318.5,
            widthMm: null,
            heightMm: null,
          }),
        ],
      },
      {
        queryId: 'angle',
        category: '角鐵',
        candidates: [createPriceItem({ id: 20, category: '角鐵', heightMm: 50, widthMm: 75 })],
      },
      {
        queryId: 'channel',
        category: '槽鐵',
        candidates: [
          createPriceItem({
            id: 30,
            category: '槽鐵',
            heightMm: 150,
            widthMm: 75,
            thicknessMinMm: 9.9,
            thicknessMaxMm: 9.9,
          }),
        ],
      },
      {
        queryId: 'flat',
        category: '平鐵',
        candidates: [
          createPriceItem({
            id: 40,
            category: '平鐵',
            widthMm: 80,
            heightMm: 6.9,
            thicknessMinMm: null,
            thicknessMaxMm: null,
          }),
        ],
      },
    ]);

    expect(filtered.map(({ prices }) => prices.map(({ id }) => id))).toEqual([
      [10, 11],
      [20],
      [30],
      [40],
    ]);
  });

  it('maps equal metric angle sizes to inch rows and rejects unequal legs', () => {
    const sizes = [
      { id: 21, metric: 25, inch: 1 },
      { id: 22, metric: 38, inch: 1.5 },
      { id: 23, metric: 50, inch: 2 },
      { id: 24, metric: 75, inch: 3 },
    ];
    const group = createCuttingGroup({
      cuttingCategory: '角鐵',
      sourceCategories: ['角鐵'],
      prices: sizes.map(({ id, inch }) =>
        createCuttingRecord({
          id,
          cuttingCategory: '角鐵',
          itemName: `${inch}"`,
          specText: `${inch}"`,
          inchMin: inch,
          inchMax: inch,
          mmMin: inch * 25.4,
          mmMax: inch * 25.4,
          heightMm: null,
          widthMm: null,
        }),
      ),
    });

    const [filtered] = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'angle',
          category: '角鐵',
          candidates: [
            ...sizes.map(({ id, metric }) =>
              createPriceItem({ id, category: '角鐵', heightMm: metric, widthMm: metric }),
            ),
            createPriceItem({ id: 25, category: '角鐵', heightMm: 25, widthMm: 20 }),
          ],
        },
      ],
    );

    expect(filtered.prices.map(({ id }) => id)).toEqual([21, 22, 23, 24]);
    expect(filtered.candidateMatches.map(({ priceCandidateId }) => priceCandidateId)).toEqual([
      21, 22, 23, 24,
    ]);
  });

  it('prefers an exact metric angle row over its approved inch alias', () => {
    const group = createCuttingGroup({
      cuttingCategory: '角鐵',
      sourceCategories: ['角鐵'],
      prices: [
        createCuttingRecord({
          id: 31,
          cuttingCategory: '角鐵',
          itemName: '1 1/2"',
          specText: '1 1/2"',
          inchMin: 1.5,
          inchMax: 1.5,
          mmMin: 38.1,
          mmMax: 38.1,
          heightMm: null,
          widthMm: null,
        }),
        createCuttingRecord({
          id: 32,
          cuttingCategory: '角鐵',
          itemName: '40',
          specText: '40',
          mmMin: 40,
          mmMax: 40,
          heightMm: null,
          widthMm: null,
        }),
      ],
    });

    const [filtered] = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'angle-40',
          category: '角鐵',
          candidates: [createPriceItem({ category: '角鐵', heightMm: 40, widthMm: 40 })],
        },
      ],
    );

    expect(filtered.prices.map(({ id }) => id)).toEqual([32]);
    expect(filtered.candidateMatches[0]?.cuttingPriceIds).toEqual([32]);
  });

  it('fails closed for unsupported or incomplete retained specifications', () => {
    const group = createCuttingGroup({
      prices: [
        createCuttingRecord({
          id: 1,
          itemName: 'unknown',
          specText: undefined,
          heightMm: null,
          widthMm: null,
        }),
        createCuttingRecord({
          id: 2,
          itemName: '250',
          specText: '250',
          heightMm: null,
          widthMm: null,
        }),
      ],
    });

    expect(
      filterSteelCuttingPriceGroups(
        [group],
        [{ queryId: 'q1', category: 'H型鋼', candidates: [createPriceItem()] }],
      ),
    ).toEqual([]);
  });

  it('compares mm dimensions by integer part after dispatching on cutting category', () => {
    const groups = [
      createCuttingGroup({
        cuttingCategory: 'H型鋼',
        prices: [createCuttingRecord({ heightMm: 250.9, widthMm: 125.9 })],
      }),
      createCuttingGroup({
        cuttingCategory: '鐵管',
        prices: [
          createCuttingRecord({
            id: 2,
            cuttingCategory: '鐵管',
            inchMin: null,
            inchMax: null,
            mmMin: 12.7,
            mmMax: 12.7,
            heightMm: null,
            widthMm: null,
          }),
        ],
      }),
    ];

    const filtered = filterSteelCuttingPriceGroups(groups, [
      {
        queryId: 'h',
        category: 'H型鋼',
        candidates: [createPriceItem({ heightMm: 250.1, widthMm: 125.2 })],
      },
      {
        queryId: 'pipe',
        category: '圓管',
        candidates: [
          createPriceItem({
            id: 2,
            category: '圓管',
            nominalInch: undefined,
            outerDiameterMm: 12.1,
            heightMm: null,
            widthMm: null,
          }),
        ],
      },
    ]);

    expect(filtered.map(({ prices }) => prices.map(({ id }) => id))).toEqual([[1], [2]]);
  });

  it('uses integer-part mm fallback for an inch-labelled pipe row without nominal inch', () => {
    const group = createCuttingGroup({
      cuttingCategory: '鐵管',
      sourceCategories: ['圓管'],
      prices: [
        createCuttingRecord({
          cuttingCategory: '鐵管',
          inchMin: 0.5,
          inchMax: 0.5,
          mmMin: 12.7,
          mmMax: 12.7,
          heightMm: null,
          widthMm: null,
        }),
      ],
    });

    const [filtered] = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'pipe',
          category: '圓管',
          candidates: [
            createPriceItem({
              category: '圓管',
              nominalInch: undefined,
              outerDiameterMm: 12.1,
              heightMm: null,
              widthMm: null,
            }),
          ],
        },
      ],
    );

    expect(filtered.prices.map(({ id }) => id)).toEqual([1]);
  });

  it('does not apply one cutting category matcher to another category', () => {
    const pipeGroup = createCuttingGroup({
      cuttingCategory: '鐵管',
      prices: [
        createCuttingRecord({
          cuttingCategory: '鐵管',
          mmMin: 250,
          mmMax: 250,
          heightMm: null,
          widthMm: null,
        }),
      ],
    });

    expect(
      filterSteelCuttingPriceGroups(
        [pipeGroup],
        [{ queryId: 'h', category: 'H型鋼', candidates: [createPriceItem()] }],
      ),
    ).toEqual([]);
  });

  it('queries only runtime price fields and normalizes Tier B strictly from A', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        createCuttingRow({ unit_price_b: '   ' }),
        createCuttingRow({
          id: '2',
          unit_price_a: null,
          unit_price_b: '',
          unit_price_c: '20.0000',
          unit_price_f: '30.0000',
        }),
      ],
    });

    const groups = await searchSteelCuttingPriceGroups({ query } as SteelRepositoryClient, [
      { queryId: 'h', category: 'H型鋼' },
      { queryId: 'i', category: 'I型鋼/工字鐵' },
      { queryId: 'plate', category: '鐵板' },
      { queryId: 'flat', category: '平鐵' },
      { queryId: 'pipe', category: '圓管' },
    ]);

    const [sql, values] = query.mock.calls[0] as [string, string[]];
    expect(sql).toContain("c.cut_type = '加工/切工'");
    expect(sql).not.toMatch(/\bLIMIT\b/iu);
    expect(sql).not.toContain('supplement');
    expect(sql).not.toContain('normalized_spec_text');
    expect(sql).not.toContain('thickness_mm =');
    for (const internalColumn of [
      'record_type',
      'conditions',
      'calculation_rule',
      'source_sheet',
      'source_row',
      'spec_selector',
      'thickness_axis',
    ]) {
      expect(sql).not.toContain(internalColumn);
    }
    expect(sql).toContain('ON c.cutting_category = lookup.cutting_category');
    expect(sql).not.toContain('ILIKE');
    expect(JSON.parse(values[0] ?? '[]')).toEqual([
      { cutting_category: 'H型鋼' },
      { cutting_category: '工字鐵/H型鋼' },
      { cutting_category: '平鐵' },
      { cutting_category: '鐵管' },
    ]);
    expect(groups[0]?.prices[0]).toMatchObject({
      tierPrices: { A: 10, B: 10, C: 11, F: 12 },
    });
    expect(groups[0]?.prices[1]).toMatchObject({
      tierPrices: { A: null, B: null, C: 20, F: 30 },
    });
    const returnedPrice = groups[0]?.prices[0] as unknown as Record<string, unknown>;
    for (const internalField of [
      'recordType',
      'conditions',
      'calculationRule',
      'sourceSheet',
      'sourceRow',
      'specSelector',
      'thicknessAxis',
      'tierBSource',
    ]) {
      expect(returnedPrice).not.toHaveProperty(internalField);
    }
  });

  it('lets one H category lookup return both direct and shared H cutting categories', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        createCuttingRow({
          lookup_cutting_category: 'H型鋼',
          id: '1',
          cutting_category: 'H型鋼',
          item_name: '200x100',
          spec_text: '200x100',
          inch_min: null,
          inch_max: null,
          mm_min: null,
          mm_max: null,
          height_mm: '200',
          width_mm: '100',
        }),
        createCuttingRow({
          lookup_cutting_category: '工字鐵/H型鋼',
          id: '2',
          cutting_category: '工字鐵/H型鋼',
          item_name: '200x100',
          spec_text: '200x100',
          inch_min: null,
          inch_max: null,
          mm_min: null,
          mm_max: null,
          height_mm: '200',
          width_mm: '100',
        }),
      ],
    });

    const groups = await searchSteelCuttingPriceGroups({ query } as SteelRepositoryClient, [
      { queryId: 'h', category: 'H型鋼' },
    ]);

    expect(groups.map(({ cuttingCategory }) => cuttingCategory)).toEqual(['H型鋼', '工字鐵/H型鋼']);
  });

  it('skips the database for plate and other unsupported cutting categories', async () => {
    const query = jest.fn();

    await expect(
      searchSteelCuttingPriceGroups({ query } as SteelRepositoryClient, [
        { queryId: 'plate', category: '鐵板' },
        { queryId: 'hardware', category: '五金/配件' },
        { queryId: 'discover', mode: 'category_discovery', keyword: 'H型鋼' },
      ]),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
