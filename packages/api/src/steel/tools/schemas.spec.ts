import { zodToJsonSchema } from 'zod-to-json-schema';

import { processingPriceCategories } from '../pricing/processing-candidates';
import { steelToolArgsSchemas } from './schemas';

describe('Steel price candidate tool schema', () => {
  const schema = steelToolArgsSchemas.search_price_candidates;

  it('does not expose backend-generated queryId fields to the AI', () => {
    const aiVisibleSchema = zodToJsonSchema(schema, { $refStrategy: 'none' });

    expect(JSON.stringify(aiVisibleSchema)).not.toContain('queryId');
  });

  it('assigns deterministic query IDs from array order', () => {
    expect(
      schema.parse({
        queries: [
          { categories: ['H型鋼'], stockLengthMm: ['6000', '9000'] },
          { categories: ['鐵板'], subcategory: '平板' },
          { erpItemCodes: ['ERP-1'] },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', categories: ['H型鋼'], stockLengthMm: ['6000', '9000'] },
        { queryId: 'q2', categories: ['鐵板'], subcategory: '平板' },
        { queryId: 'q3', erpItemCodes: ['ERP-1'] },
      ],
    });
  });

  it('rejects caller-supplied query IDs in every AI-visible query shape', () => {
    expect(() => schema.parse({ queries: [{ queryId: 'q1', categories: ['鐵板'] }] })).toThrow(
      'Unrecognized key',
    );
    expect(() => schema.parse({ queries: [{ categories: ['鐵板'], productNames: ['x'] }] })).toThrow(
      'Unrecognized key',
    );
    expect(() => schema.parse({ queries: [{ categories: ['鐵板'], processingQueries: [] }] })).toThrow(
      'Unrecognized key',
    );
    expect(() => schema.parse({ queries: [{ categories: ['鐵板'], erpItemCode: 'ERP-1' }] })).toThrow(
      'Unrecognized key',
    );
    expect(() => schema.parse({ queries: [{ categories: ['鐵板'] }], processingQueries: [] })).toThrow();
    expect(() => schema.parse({ queries: [{ categories: ['鐵板'] }], erpItemCodes: ['ERP-1'] })).toThrow();
  });

  it('accepts up to three processing queries and assigns deterministic IDs', () => {
    expect(
      schema.parse({
        queries: [
          {
            categories: ['鐵板', 'C型鋼'],
            processingCategories: ['加工/切工', '加工/孔'],
            keyword: '雷射',
          },
          { categories: ['鐵板'], processingCategories: ['加工/折工'] },
          { categories: ['H型鋼'], processingCategories: ['加工/孔'] },
        ],
      }).queries,
    ).toEqual([
      {
        queryId: 'q1',
        categories: ['鐵板', 'C型鋼'],
        processingCategories: ['加工/切工', '加工/孔'],
        keyword: '雷射',
      },
      { queryId: 'q2', categories: ['鐵板'], processingCategories: ['加工/折工'] },
      { queryId: 'q3', categories: ['H型鋼'], processingCategories: ['加工/孔'] },
    ]);

    expect(() =>
      schema.parse({
        queries: [
          { categories: ['鐵板'], processingCategories: ['加工/切工'] },
          { categories: ['鐵板'], processingCategories: ['加工/孔'] },
          { categories: ['鐵板'], processingCategories: ['加工/折工'] },
          { categories: ['鐵板'], processingCategories: ['加工/其他'] },
        ],
      }),
    ).toThrow('At most three processing query items');
  });

  it('rejects keyword for H型鋼 while allowing its category-rule stock lengths', () => {
    expect(() =>
      schema.parse({ queries: [{ categories: ['H型鋼'], keyword: '300x300x10/15' }] }),
    ).toThrow('must not use keyword');
    expect(
      schema.parse({
        queries: [{ categories: ['H型鋼'], stockLengthMm: ['6000', '9000', '12000'] }],
      }).queries[0],
    ).toEqual({
      queryId: 'q1',
      categories: ['H型鋼'],
      stockLengthMm: ['6000', '9000', '12000'],
    });
  });

  it('accepts the complete canonical processing category list', () => {
    expect(
      schema.parse({
        queries: [{ categories: ['鐵板'], processingCategories: [...processingPriceCategories] }],
      }).queries[0],
    ).toMatchObject({ processingCategories: processingPriceCategories });
  });

  it('accepts exact ERP queries and rejects legacy or mixed top-level fields', () => {
    expect(schema.parse({ queries: [{ erpItemCodes: ['ERP-1', 'ERP-2'] }] })).toEqual({
      queries: [{ queryId: 'q1', erpItemCodes: ['ERP-1', 'ERP-2'] }],
    });
    expect(() => schema.parse({ queries: [{ erpItemCodes: ['ERP-1', 'ERP-1'] }] })).toThrow(
      'unique',
    );
    expect(() => schema.parse({ productNames: ['雷射切工 1'] })).toThrow();
    expect(() => schema.parse({ queries: [{ erpItemCodes: ['ERP-1'], categories: ['鐵板'] }] })).toThrow();
    expect(() => schema.parse({})).toThrow();
  });

  it('rejects product categories in processingCategories and processing categories as targets', () => {
    expect(() =>
      schema.parse({
        queries: [{ categories: ['加工/孔'], processingCategories: ['加工/孔'] }],
      }),
    ).toThrow('product or material categories');
    expect(() =>
      schema.parse({
        queries: [{ categories: ['鐵板'], processingCategories: ['鐵板'] }],
      }),
    ).toThrow();
  });

  it('accepts a bounded batch of strict query items', () => {
    const queries = Array.from({ length: 25 }, (_, index) => ({
      categories: ['鐵板'] as const,
      thicknessMm: [String(index + 1)],
    }));

    expect(schema.parse({ queries }).queries).toHaveLength(25);
  });

  it('rejects AI-controlled limits and obsolete query modes', () => {
    expect(schema.safeParse({ queries: [{ categories: ['鐵板'], limit: 10 }] }).success).toBe(false);
    expect(schema.safeParse({ queries: [{ mode: 'category_discovery', keyword: '管' }] }).success).toBe(false);
  });

  it('accepts all v4.2 lookup filters and separate 錏/鋅 material enum values', () => {
    expect(
      schema.parse({
        queries: [
          {
            categories: ['圓管'],
            subcategory: '一般',
            material: '鎢',
            thicknessMm: ['1.2', '1.5'],
            stockLengthMm: ['6000', '9000', '10000', '12000'],
            keyword: '連料',
          },
          { categories: ['五金/配件'], material: '鋅' },
        ],
      }),
    ).toEqual({
      queries: [
        {
          queryId: 'q1',
          categories: ['圓管'],
          subcategory: '一般',
          material: '鎢',
          thicknessMm: ['1.2', '1.5'],
          stockLengthMm: ['6000', '9000', '10000', '12000'],
          keyword: '連料',
        },
        { queryId: 'q2', categories: ['五金/配件'], material: '鋅' },
      ],
    });
  });

  it('accepts omitted and explicit plate filters without silently inventing values', () => {
    expect(
      schema.parse({
        queries: [
          { categories: ['鐵板'] },
          { categories: ['鐵板'], unit: 'kg', material: '黑鐵' },
          { categories: ['鐵板'], unit: '片', material: '黑鐵' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', categories: ['鐵板'] },
        { queryId: 'q2', categories: ['鐵板'], unit: 'kg', material: '黑鐵' },
        { queryId: 'q3', categories: ['鐵板'], unit: '片', material: '黑鐵' },
      ],
    });
  });

  it('accepts recognized material aliases and rejects unknown explicit values', () => {
    expect(
      schema.parse({
        queries: [
          { categories: ['鐵板'], material: 'ST', thicknessMm: ['2.9'] },
          { categories: ['圓管'], material: 'NO1' },
          { categories: ['圓管'], material: '白鐵 / ST' },
          { categories: ['圓管'], material: '白鐵 / NO1' },
          { categories: ['圓管'], material: '白鐵霧面 / ST 2B' },
        ],
      }).queries,
    ).toEqual([
      { queryId: 'q1', categories: ['鐵板'], material: 'ST', thicknessMm: ['2.9'] },
      { queryId: 'q2', categories: ['圓管'], material: 'NO1' },
      { queryId: 'q3', categories: ['圓管'], material: '白鐵 / ST' },
      { queryId: 'q4', categories: ['圓管'], material: '白鐵 / NO1' },
      { queryId: 'q5', categories: ['圓管'], material: '白鐵霧面 / ST 2B' },
    ]);
    expect(() => schema.parse({ queries: [{ categories: ['圓管'], material: 'invalid' }] })).toThrow(
      'Invalid material',
    );
  });

  it('leaves omitted 圓管 material for backend defaults and preserves valid filters', () => {
    expect(
      schema.parse({
        queries: [
          { categories: ['圓管'] },
          { categories: ['圓管'], material: '黑鐵' },
          { categories: ['圓管'], material: '白鐵' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', categories: ['圓管'] },
        { queryId: 'q2', categories: ['圓管'], material: '黑鐵' },
        { queryId: 'q3', categories: ['圓管'], material: '白鐵' },
      ],
    });
  });

  it('accepts explicit 平鐵 material filters and leaves omitted defaults to execution', () => {
    expect(
      schema.parse({
        queries: [
          { categories: ['平鐵'] },
          { categories: ['平鐵'], material: '黑鐵' },
          { categories: ['平鐵'], material: '白鐵' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', categories: ['平鐵'] },
        { queryId: 'q2', categories: ['平鐵'], material: '黑鐵' },
        { queryId: 'q3', categories: ['平鐵'], material: '白鐵' },
      ],
    });
  });

  it('accepts explicit 方鐵 material filters and leaves omitted defaults to execution', () => {
    expect(
      schema.parse({
        queries: [
          { categories: ['方鐵'] },
          { categories: ['方鐵'], material: '黑鐵' },
          { categories: ['方鐵'], material: '白鐵' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', categories: ['方鐵'] },
        { queryId: 'q2', categories: ['方鐵'], material: '黑鐵' },
        { queryId: 'q3', categories: ['方鐵'], material: '白鐵' },
      ],
    });
  });

  it('accepts 槽鐵 material aliases without silently rewriting input', () => {
    expect(
      schema.parse({
        queries: [
          { categories: ['槽鐵'], keyword: '50x25x5' },
          { categories: ['槽鐵'], material: '熱浸鍍', keyword: '75x40x5/7' },
          { categories: ['槽鐵'], material: '熱浸鍍鋅', keyword: '75x40x5/7' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', categories: ['槽鐵'], keyword: '50x25x5' },
        { queryId: 'q2', categories: ['槽鐵'], material: '熱浸鍍', keyword: '75x40x5/7' },
        { queryId: 'q3', categories: ['槽鐵'], material: '熱浸鍍鋅', keyword: '75x40x5/7' },
      ],
    });
  });

  it('accepts 角鐵 material aliases without silently rewriting input', () => {
    expect(
      schema.parse({
        queries: [
          { categories: ['角鐵'], keyword: '25x2.5' },
          { categories: ['角鐵'], material: '熱進鍍鋅', keyword: '100x75x7' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', categories: ['角鐵'], keyword: '25x2.5' },
        { queryId: 'q2', categories: ['角鐵'], material: '熱進鍍鋅', keyword: '100x75x7' },
      ],
    });
  });

  it('rejects invalid mesh unit filters instead of silently dropping them', () => {
    expect(() => schema.parse({ queries: [{ categories: ['網'], unit: '㎡', subcategory: '點焊' }] })).toThrow(
      'Invalid unit',
    );
    expect(schema.parse({ queries: [{ categories: ['網'], subcategory: '菱形' }] })).toEqual({
      queries: [{ queryId: 'q1', categories: ['網'], subcategory: '菱形' }],
    });
  });

  it('validates subcategories against their category and rejects legacy names', () => {
    expect(() => schema.parse({ queries: [{ categories: ['加工/其他'], subcategory: '扁' }] })).toThrow();
    expect(() => schema.parse({ queries: [{ categories: ['鐵板'], subcategory: '鋼管' }] })).toThrow();
    expect(() => schema.parse({ queries: [{ categories: ['鐵板/鋼板'] }] })).toThrow();
    expect(schema.parse({ queries: [{ categories: ['其他'], keyword: '鐵板' }] })).toBeDefined();
    expect(() =>
      schema.parse({ queries: [{ categories: ['加工/切工'], processingMethod: '雷射' }] }),
    ).toThrow();
  });

  it('keeps 錏 and 鋅 as distinct accepted material filters', () => {
    expect(schema.parse({ queries: [{ categories: ['鐵板'], material: '錏' }] })).toBeDefined();
    expect(schema.parse({ queries: [{ categories: ['鐵板'], material: '鋅' }] })).toBeDefined();
  });

  it.each(['0', '-1', '6mm', 'NaN', 'Infinity', '1e2'])(
    'rejects non-positive or non-decimal thickness %s',
    (thicknessMm) => {
      expect(() =>
        schema.parse({ queries: [{ categories: ['鐵板'], thicknessMm: [thicknessMm] }] }),
      ).toThrow();
    },
  );

  it('rejects invalid stock lengths instead of silently dropping them', () => {
    expect(() => schema.parse({
      queries: [{ categories: ['圓管'], stockLengthMm: ['0', '-1', '6m', 'NaN'] }],
    })).toThrow();
  });

  it('rounds normalized stock-length millimeters to integers and deduplicates them', () => {
    expect(
      schema.parse({
        queries: [{ categories: ['圓管'], stockLengthMm: ['5999.6', '6000.4', '6000.6'] }],
      }),
    ).toEqual({
      queries: [
        {
          queryId: 'q1',
          categories: ['圓管'],
          stockLengthMm: ['6000', '6001'],
        },
      ],
    });
  });

  it('allows H型鋼 stock lengths only at or above 6000mm', () => {
    expect(() => schema.parse({
      queries: [{ categories: ['H型鋼'], stockLengthMm: ['3000', '6000'] }],
    })).toThrow('at least 6000');
    expect(schema.parse({ queries: [{ categories: ['H型鋼'], stockLengthMm: ['6000', '9000'] }] })).toEqual({
      queries: [{ queryId: 'q1', categories: ['H型鋼'], stockLengthMm: ['6000', '9000'] }],
    });
  });
});
