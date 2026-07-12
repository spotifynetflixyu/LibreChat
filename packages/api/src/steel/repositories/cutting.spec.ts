import { filterSteelCuttingPriceGroups, searchSteelCuttingPriceGroups } from './cutting';

import type { SteelPriceItem } from './prices';
import type { SteelRepositoryClient } from './types';
import type { SteelCuttingPriceGroup, SteelCuttingPriceRecord } from './cutting';

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

function createCuttingRecord(
  overrides: Partial<SteelCuttingPriceRecord> = {},
): SteelCuttingPriceRecord {
  return {
    id: 1,
    cuttingCategory: 'H型鋼',
    recordType: 'price',
    itemName: '250x250',
    cutType: '加工/切工',
    specText: '250*250',
    normalizedSpecText: '250x250',
    inchMin: null,
    inchMax: null,
    mmMin: null,
    mmMax: null,
    unit: '刀',
    tierPrices: { A: 100, B: 100, C: 100, F: 100 },
    tierBSource: 'B',
    conditions: {},
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
    supplements: [],
    ...overrides,
  };
}

function createPriceItem(overrides: Partial<SteelPriceItem> = {}): SteelPriceItem {
  return {
    id: 1,
    erpItemCode: 'EHS252510',
    priceKind: 'product',
    specKey: 'EHS252510 H型鋼250x250x9/14x10M',
    productName: 'H型鋼250*250*9/14*10M',
    normalizedSpecText: 'H型鋼250x250x9/14x10M',
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
    currency: 'TWD',
    active: true,
    sourceRefs: [],
    ...overrides,
  };
}

describe('Steel cutting price repository', () => {
  it('filters H cutting rows by matched candidate dimensions and flange processing threshold', () => {
    const genericHole = createCuttingRecord({
      id: 2,
      itemName: '加工/孔',
      cutType: '加工/孔',
      specText: undefined,
      normalizedSpecText: undefined,
      notes: '14m/m 以上另計',
    });
    const groups = [
      createCuttingGroup({
        prices: [
          genericHole,
          createCuttingRecord({ id: 5, itemName: '250x125', normalizedSpecText: '250x125' }),
          createCuttingRecord({ id: 11, itemName: '150x150', normalizedSpecText: '150x150' }),
          createCuttingRecord({ id: 4, itemName: '200x100', normalizedSpecText: '200x100' }),
        ],
        queryIds: ['q1', 'q2', 'q3', 'q4'],
      }),
      createCuttingGroup({
        cuttingCategory: '工字鐵/H型鋼',
        prices: [
          createCuttingRecord({
            id: 33,
            cuttingCategory: '工字鐵/H型鋼',
            itemName: '250x250',
            normalizedSpecText: '250x250',
          }),
          createCuttingRecord({
            id: 36,
            cuttingCategory: '工字鐵/H型鋼',
            itemName: '340x250',
            normalizedSpecText: '340x250',
          }),
          createCuttingRecord({
            id: 35,
            cuttingCategory: '工字鐵/H型鋼',
            itemName: '300x300',
            normalizedSpecText: '300x300',
          }),
        ],
        supplements: [
          createCuttingRecord({
            id: 101,
            cuttingCategory: '工字鐵/H型鋼',
            recordType: 'supplement',
            itemName: '加工/切斜',
            cutType: '加工/切斜',
          }),
        ],
        queryIds: ['q1', 'q2', 'q3', 'q4'],
      }),
    ];

    const filtered = filterSteelCuttingPriceGroups(groups, [
      { queryId: 'q1', category: 'H型鋼', candidates: [createPriceItem()] },
      {
        queryId: 'q2',
        category: 'H型鋼',
        candidates: [
          createPriceItem({
            id: 2,
            erpItemCode: 'EHS342510',
            productName: 'H型鋼340*250*9/14*10M',
            normalizedSpecText: 'H型鋼340x250x9/14x10M',
            heightMm: 340,
          }),
        ],
      },
      {
        queryId: 'q3',
        category: 'H型鋼',
        candidates: [
          createPriceItem({
            id: 3,
            erpItemCode: 'EHS251210',
            productName: 'H型鋼250*125*6/9*10M',
            normalizedSpecText: 'H型鋼250x125x6/9x10M',
            widthMm: 125,
            heightMm: 250,
          }),
        ],
      },
      {
        queryId: 'q4',
        category: 'H型鋼',
        candidates: [
          createPriceItem({
            id: 4,
            erpItemCode: 'EHS151510',
            productName: 'H型鋼150*150*7/10*10M',
            normalizedSpecText: 'H型鋼150x150x7/10x10M',
            widthMm: 150,
            heightMm: 150,
          }),
        ],
      },
    ]);

    expect(filtered).toEqual([
      expect.objectContaining({
        cuttingCategory: 'H型鋼',
        queryIds: ['q1', 'q2', 'q3', 'q4'],
        prices: [
          expect.objectContaining({ id: 2 }),
          expect.objectContaining({ id: 5 }),
          expect.objectContaining({ id: 11 }),
        ],
      }),
      expect.objectContaining({
        cuttingCategory: '工字鐵/H型鋼',
        queryIds: ['q1', 'q2'],
        prices: [expect.objectContaining({ id: 33 }), expect.objectContaining({ id: 36 })],
        supplements: [expect.objectContaining({ id: 101 })],
      }),
    ]);
  });

  it('filters pipe prices to matched nominal or approved metric aliases and removes no-match provenance', () => {
    const group = createCuttingGroup({
      cuttingCategory: '鐵管',
      sourceCategories: ['圓管', '方管'],
      queryIds: ['q1', 'q2', 'q3'],
      prices: [
        createCuttingRecord({
          id: 62,
          cuttingCategory: '鐵管',
          itemName: '4"',
          inchMin: 4,
          inchMax: 4,
        }),
        createCuttingRecord({
          id: 64,
          cuttingCategory: '鐵管',
          itemName: '6"',
          inchMin: 6,
          inchMax: 6,
        }),
        createCuttingRecord({
          id: 65,
          cuttingCategory: '鐵管',
          itemName: '8"',
          inchMin: 8,
          inchMax: 8,
        }),
      ],
      supplements: [
        createCuttingRecord({
          id: 109,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '方管厚度',
          cutType: '補充',
        }),
        createCuttingRecord({
          id: 110,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '白A、錏方管',
          cutType: '補充',
          notes: '+5 元',
        }),
        createCuttingRecord({
          id: 111,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '白鐵 100 以下',
          cutType: '補充',
        }),
        createCuttingRecord({
          id: 113,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '1"以下小方管',
          cutType: '補充',
        }),
        createCuttingRecord({
          id: 114,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '圓條不切',
          cutType: '補充',
        }),
      ],
    });

    const filtered = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'q1',
          category: '圓管',
          candidates: [createPriceItem({ category: '圓管', nominalInch: '4' })],
        },
        { queryId: 'q2', category: '方管', candidates: [] },
        {
          queryId: 'q3',
          category: '方管',
          candidates: [
            createPriceItem({
              category: '方管',
              nominalInch: undefined,
              widthMm: 150,
              heightMm: 150,
            }),
          ],
        },
      ],
    );

    expect(filtered).toEqual([
      expect.objectContaining({
        cuttingCategory: '鐵管',
        sourceCategories: ['圓管', '方管'],
        queryIds: ['q1', 'q3'],
        prices: [expect.objectContaining({ id: 62 }), expect.objectContaining({ id: 64 })],
        supplements: [],
      }),
    ]);
  });

  it('does not fall back to a full cutting catalog when matched candidates lack usable dimensions', () => {
    const group = createCuttingGroup({
      cuttingCategory: '鐵管',
      sourceCategories: ['方管'],
      queryIds: ['q1'],
      prices: [
        createCuttingRecord({
          id: 62,
          cuttingCategory: '鐵管',
          itemName: '4"',
          inchMin: 4,
          inchMax: 4,
        }),
      ],
      supplements: [
        createCuttingRecord({
          id: 109,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '方管厚度',
          cutType: '補充',
        }),
      ],
    });

    const filtered = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'q1',
          category: '方管',
          candidates: [
            createPriceItem({
              category: '方管',
              nominalInch: undefined,
              widthMm: null,
              heightMm: null,
            }),
          ],
        },
      ],
    );

    expect(filtered).toEqual([]);
  });

  it('matches angle and channel cutting rows by their candidate profile dimensions', () => {
    const groups = [
      createCuttingGroup({
        cuttingCategory: '角鐵',
        sourceCategories: ['角鐵'],
        prices: [
          createCuttingRecord({
            id: 72,
            cuttingCategory: '角鐵',
            itemName: '65',
            normalizedSpecText: '65',
          }),
          createCuttingRecord({
            id: 75,
            cuttingCategory: '角鐵',
            itemName: '100',
            normalizedSpecText: '100',
          }),
        ],
        supplements: [
          createCuttingRecord({
            id: 116,
            cuttingCategory: '角鐵',
            recordType: 'supplement',
            itemName: '白鐵角鐵',
            cutType: '補充',
          }),
        ],
      }),
      createCuttingGroup({
        cuttingCategory: '槽鐵',
        sourceCategories: ['槽鐵'],
        prices: [
          createCuttingRecord({
            id: 86,
            cuttingCategory: '槽鐵',
            itemName: '200',
            normalizedSpecText: '200',
          }),
          createCuttingRecord({
            id: 81,
            cuttingCategory: '槽鐵',
            itemName: '100',
            normalizedSpecText: '100',
          }),
          createCuttingRecord({
            id: 87,
            cuttingCategory: '槽鐵',
            itemName: '200x90',
            normalizedSpecText: '200x90',
          }),
          createCuttingRecord({
            id: 88,
            cuttingCategory: '槽鐵',
            itemName: '150x9.0',
            normalizedSpecText: '150x9.0',
          }),
        ],
      }),
    ];

    const filtered = filterSteelCuttingPriceGroups(groups, [
      {
        queryId: 'q1',
        category: '角鐵',
        candidates: [
          createPriceItem({ category: '角鐵', widthMm: 65, heightMm: 65, nominalInch: '0.2' }),
        ],
      },
      {
        queryId: 'q2',
        category: '槽鐵',
        candidates: [
          createPriceItem({ category: '槽鐵', widthMm: 90, heightMm: 200, nominalInch: '0.1' }),
        ],
      },
      {
        queryId: 'q3',
        category: '槽鐵',
        candidates: [
          createPriceItem({
            category: '槽鐵',
            widthMm: 75,
            heightMm: 150,
            thicknessMinMm: 9,
            thicknessMaxMm: 9,
          }),
        ],
      },
    ]);

    expect(filtered).toEqual([
      expect.objectContaining({
        cuttingCategory: '角鐵',
        prices: [expect.objectContaining({ id: 72 })],
        supplements: [],
      }),
      expect.objectContaining({
        cuttingCategory: '槽鐵',
        prices: [expect.objectContaining({ id: 87 }), expect.objectContaining({ id: 88 })],
      }),
    ]);
  });

  it('matches flat cutting width and thickness ranges and keeps only applicable supplements', () => {
    const group = createCuttingGroup({
      cuttingCategory: '鐵板/平鐵',
      sourceCategories: ['平鐵'],
      queryIds: ['q1', 'q2'],
      prices: [
        createCuttingRecord({
          id: 91,
          cuttingCategory: '鐵板/平鐵',
          itemName: '5/8~2"',
          normalizedSpecText: '5/8~2"',
          mmMin: 15.875,
          mmMax: 50.8,
          notes: '厚度:3、4.5、6',
        }),
        createCuttingRecord({
          id: 93,
          cuttingCategory: '鐵板/平鐵',
          itemName: '65~100',
          normalizedSpecText: '65~100',
          notes: '厚度:6',
        }),
        createCuttingRecord({
          id: 94,
          cuttingCategory: '鐵板/平鐵',
          itemName: '65~100',
          normalizedSpecText: '65~100',
          notes: '厚度:9、12',
        }),
      ],
      supplements: [
        createCuttingRecord({
          id: 119,
          cuttingCategory: '鐵板/平鐵',
          recordType: 'supplement',
          itemName: '白鐵平鐵另計,1”以下平鐵量少加價',
          cutType: '補充',
        }),
      ],
    });

    const filtered = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'q1',
          category: '平鐵',
          candidates: [
            createPriceItem({
              category: '平鐵',
              material: '黑鐵',
              productName: '黑鐵平鐵 80x6',
              widthMm: 80,
              heightMm: 6,
              thicknessMinMm: null,
              thicknessMaxMm: null,
            }),
          ],
        },
        {
          queryId: 'q2',
          category: '平鐵',
          candidates: [
            createPriceItem({
              category: '平鐵',
              material: '黑鐵',
              productName: '黑鐵平鐵 20x6',
              widthMm: 20,
              heightMm: 6,
              thicknessMinMm: null,
              thicknessMaxMm: null,
            }),
          ],
        },
      ],
    );

    expect(filtered).toEqual([
      expect.objectContaining({
        cuttingCategory: '鐵板/平鐵',
        queryIds: ['q1', 'q2'],
        prices: [expect.objectContaining({ id: 91 }), expect.objectContaining({ id: 93 })],
        supplements: [expect.objectContaining({ id: 119 })],
      }),
    ]);
  });

  it('omits a query when quoteable candidates resolve to different cutting keys', () => {
    const group = createCuttingGroup({
      cuttingCategory: '角鐵',
      sourceCategories: ['角鐵'],
      queryIds: ['q1'],
      prices: [
        createCuttingRecord({
          id: 71,
          cuttingCategory: '角鐵',
          itemName: '2"',
          inchMin: 2,
          inchMax: 2,
        }),
        createCuttingRecord({
          id: 72,
          cuttingCategory: '角鐵',
          itemName: '65',
          normalizedSpecText: '65',
        }),
      ],
    });

    const filtered = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'q1',
          category: '角鐵',
          candidates: [
            createPriceItem({ category: '角鐵', widthMm: 50, heightMm: 50 }),
            createPriceItem({ category: '角鐵', widthMm: 65, heightMm: 65 }),
          ],
        },
      ],
    );

    expect(filtered).toEqual([]);
  });

  it('omits cutting rows when the material candidates are not quoteable', () => {
    const group = createCuttingGroup({
      cuttingCategory: '工字鐵/H型鋼',
      sourceCategories: ['I型鋼/工字鐵'],
      queryIds: ['q1'],
      prices: [
        createCuttingRecord({
          id: 25,
          cuttingCategory: '工字鐵/H型鋼',
          itemName: '200x100',
          normalizedSpecText: '200x100',
        }),
      ],
    });

    const filtered = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'q1',
          category: 'I型鋼/工字鐵',
          candidates: [
            createPriceItem({
              category: 'I型鋼/工字鐵',
              widthMm: 100,
              heightMm: 200,
              tierPrices: { A: null, B: null, C: null, D: null, E: null, F: null },
              tierRatios: { A: null, B: null, C: null, D: null, E: null, F: null },
            }),
          ],
        },
      ],
    );

    expect(filtered).toEqual([]);
  });

  it('returns only no-cut supplements for round bars without borrowing pipe prices', () => {
    const group = createCuttingGroup({
      cuttingCategory: '鐵管',
      sourceCategories: ['圓條'],
      queryIds: ['q1'],
      prices: [
        createCuttingRecord({
          id: 56,
          cuttingCategory: '鐵管',
          itemName: '1"',
          inchMin: 1,
          inchMax: 1,
        }),
      ],
      supplements: [
        createCuttingRecord({
          id: 114,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '補充',
          cutType: '補充',
          notes: '圓條不切',
        }),
        createCuttingRecord({
          id: 115,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '1"以下圓條',
          cutType: '補充',
          notes: '不切/要外切',
        }),
      ],
    });

    const filtered = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'q1',
          category: '圓條',
          candidates: [
            createPriceItem({
              category: '圓條',
              productName: '磨光圓鐵 10m/m (6M)',
              normalizedSpecText: '磨光圓鐵 10mm (6M)',
              widthMm: null,
              heightMm: null,
              nominalInch: undefined,
            }),
          ],
        },
      ],
    );

    expect(filtered).toEqual([
      expect.objectContaining({
        cuttingCategory: '鐵管',
        sourceCategories: ['圓條'],
        queryIds: ['q1'],
        prices: [],
        supplements: [expect.objectContaining({ id: 114 }), expect.objectContaining({ id: 115 })],
      }),
    ]);
  });

  it('enforces pipe supplement size bands and square-tube no-cut thickness', () => {
    const group = createCuttingGroup({
      cuttingCategory: '鐵管',
      sourceCategories: ['方管'],
      queryIds: ['q1'],
      prices: [
        createCuttingRecord({
          id: 62,
          cuttingCategory: '鐵管',
          itemName: '4"',
          inchMin: 4,
          inchMax: 4,
        }),
      ],
      supplements: [
        createCuttingRecord({
          id: 109,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '方管厚度',
          cutType: '補充',
          notes: '方管厚度 1.2 以下不切',
        }),
        createCuttingRecord({
          id: 111,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '白鐵 100 以下',
          cutType: '補充',
        }),
        createCuttingRecord({
          id: 112,
          cuttingCategory: '鐵管',
          recordType: 'supplement',
          itemName: '白鐵 100 以上',
          cutType: '補充',
        }),
      ],
    });

    const thin = filterSteelCuttingPriceGroups(
      [group],
      [
        {
          queryId: 'q1',
          category: '方管',
          candidates: [
            createPriceItem({
              category: '方管',
              material: '白鐵 / ST',
              productName: '白鐵方管 100x1.2',
              widthMm: 100,
              heightMm: 100,
              thicknessMinMm: 1.2,
              thicknessMaxMm: 1.2,
              nominalInch: undefined,
            }),
          ],
        },
      ],
    );

    expect(thin).toEqual([
      expect.objectContaining({
        prices: [],
        supplements: [
          expect.objectContaining({ id: 109 }),
          expect.objectContaining({ id: 111 }),
          expect.objectContaining({ id: 112 }),
        ],
      }),
    ]);
  });

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
      { queryId: 'round-bar', category: '圓條' },
      { queryId: 'flat', category: '平鐵' },
      { queryId: 'plate', category: '鐵板' },
      { queryId: 'i-beam', category: 'I型鋼/工字鐵' },
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
      { lookup_term: '工字鐵' },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        cuttingCategory: '鐵管',
        sourceCategories: ['圓管', '方管', '扁方管', '圓條'],
        queryIds: ['pipe-1', 'pipe-2', 'pipe-3', 'round-bar'],
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
        sourceCategories: ['平鐵'],
        queryIds: ['flat'],
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
