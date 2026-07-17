import { steelToolArgsSchemas } from './schemas';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { processingPriceCategories } from '../pricing/processing-candidates';

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
          { category: 'H型鋼', keyword: 'H200x100' },
          { category: '加工/其他', subcategory: '厚板' },
          { mode: 'category_discovery', keyword: '不銹鋼管' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: 'H型鋼', keyword: 'H200x100' },
        { queryId: 'q2', category: '加工/其他', subcategory: '厚板' },
        { queryId: 'q3', mode: 'category_discovery', keyword: '不銹鋼管' },
      ],
    });
  });

  it('rejects caller-supplied query IDs in every AI-visible query shape', () => {
    expect(() => schema.parse({ queries: [{ queryId: 'q1', category: '鐵板' }] })).toThrow(
      'Unrecognized key',
    );
    expect(() =>
      schema.parse({ queries: [{ queryId: 'q1', mode: 'category_discovery', keyword: '鐵板' }] }),
    ).toThrow('Unrecognized key');
    expect(() =>
      schema.parse({ processingQueries: [{ queryId: 'p1', categories: ['鐵板'] }] }),
    ).toThrow('Unrecognized key');
  });

  it('accepts up to three processing queries and assigns deterministic IDs', () => {
    expect(
      schema.parse({
        queries: [{ category: '鐵板' }, { category: 'C型鋼' }],
        processingQueries: [
          {
            categories: ['鐵板', 'C型鋼'],
            processingCategories: ['加工/切工', '加工/孔'],
            keyword: '雷射',
          },
          { categories: ['鐵板'], processingCategories: ['加工/折工'] },
        ],
      }).processingQueries,
    ).toEqual([
      {
        queryId: 'p1',
        categories: ['鐵板', 'C型鋼'],
        processingCategories: ['加工/切工', '加工/孔'],
        keyword: '雷射',
      },
      { queryId: 'p2', categories: ['鐵板'], processingCategories: ['加工/折工'] },
    ]);
  });

  it('accepts the complete canonical processing category list', () => {
    expect(
      schema.parse({
        processingQueries: [
          { categories: ['鐵板'], processingCategories: [...processingPriceCategories] },
        ],
      }).processingQueries?.[0]?.processingCategories,
    ).toEqual(processingPriceCategories);
  });

  it('accepts top-level exact productNames without either query array', () => {
    expect(schema.parse({ productNames: ['雷射切工 1', '雷射切工 2'] })).toEqual({
      queries: [],
      productNames: ['雷射切工 1', '雷射切工 2'],
    });
    expect(() =>
      schema.parse({
        queries: [{ category: '鐵板' }],
        productNames: ['雷射切工 1'],
      }),
    ).toThrow('cannot include');
    expect(() => schema.parse({})).toThrow('Provide queries, processingQueries, or productNames');
  });

  it('rejects product categories in processingCategories and processing categories as targets', () => {
    expect(() =>
      schema.parse({
        queries: [{ category: '鐵板' }],
        processingQueries: [{ categories: ['加工/孔'], processingCategories: ['加工/孔'] }],
      }),
    ).toThrow('product or material categories');
    expect(() =>
      schema.parse({
        queries: [{ category: '鐵板' }],
        processingQueries: [{ categories: ['鐵板'], processingCategories: ['鐵板'] }],
      }),
    ).toThrow('processing categories');
  });

  it('does not impose a top-level query count limit', () => {
    const queries = Array.from({ length: 25 }, (_, index) => ({
      category: '鐵板' as const,
      thicknessMm: [String(index + 1)],
    }));

    expect(schema.parse({ queries }).queries).toHaveLength(25);
  });

  it('rejects AI-controlled limits for lookup and category discovery queries', () => {
    expect(schema.safeParse({ queries: [{ category: '鐵板', limit: 10 }] }).success).toBe(false);
    expect(
      schema.safeParse({
        queries: [{ mode: 'category_discovery', keyword: '管', limit: 10 }],
      }).success,
    ).toBe(false);
  });

  it('accepts all v4.2 lookup filters and separate 錏/鋅 material enum values', () => {
    expect(
      schema.parse({
        queries: [
          {
            category: '圓管',
            subcategory: '一般',
            material: '鎢',
            thicknessMm: ['1.2', '1.5'],
            stockLengthMm: ['6000', '9000', '10000', '12000'],
            erpItemCode: '00123',
            keyword: '連料',
          },
          { category: '五金/配件', material: '鋅' },
        ],
      }),
    ).toEqual({
      queries: [
        {
          queryId: 'q1',
          category: '圓管',
          subcategory: '一般',
          material: '鎢',
          thicknessMm: ['1.2', '1.5'],
          stockLengthMm: ['6000', '9000', '10000', '12000'],
          erpItemCode: '00123',
          keyword: '連料',
        },
        { queryId: 'q2', category: '五金/配件', material: '鋅' },
      ],
    });
  });

  it('defaults plate unit/material and lets explicit unit override the default', () => {
    expect(
      schema.parse({
        queries: [
          { category: '鐵板' },
          { category: '鐵板', unit: 'kg', material: 'bad-material' },
          { category: '鐵板', unit: '支', material: null },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: '鐵板', unit: 'Kg', material: '黑鐵' },
        { queryId: 'q2', category: '鐵板', unit: 'Kg', material: '黑鐵' },
        { queryId: 'q3', category: '鐵板', unit: '片', material: '黑鐵' },
      ],
    });
  });

  it('normalizes material aliases for every category without rejecting invalid values', () => {
    expect(
      schema.parse({
        queries: [
          { category: '鐵板', material: 'ST', thicknessMm: ['2.9'] },
          { category: '鐵板', material: 'st', thicknessMm: ['3'] },
          { category: '圓管', material: 'NO1' },
          { category: '圓管', material: '沙面' },
          { category: '圓管', material: '亮面' },
          { category: '圓管', material: '不鏽鋼' },
          { category: '圓管', material: '白鐵 / NO1' },
          { category: '圓管', material: '白鐵霧面 / ST 2B' },
          { category: '圓管', material: '白鐵沙面 / ST HL' },
          { category: '圓管', material: '白鐵亮面 / ST BA' },
          { category: '圓管', material: 'invalid' },
          { category: '圓管', unit: 'Kg' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: '鐵板', unit: 'Kg', material: '2B', thicknessMm: ['2.9'] },
        { queryId: 'q2', category: '鐵板', unit: 'Kg', material: 'NO1', thicknessMm: ['3'] },
        { queryId: 'q3', category: '圓管', material: 'NO1' },
        { queryId: 'q4', category: '圓管', material: 'HL' },
        { queryId: 'q5', category: '圓管', material: 'BA' },
        { queryId: 'q6', category: '圓管', material: '白鐵' },
        { queryId: 'q7', category: '圓管', material: 'NO1' },
        { queryId: 'q8', category: '圓管', material: '2B' },
        { queryId: 'q9', category: '圓管', material: 'HL' },
        { queryId: 'q10', category: '圓管', material: 'BA' },
        { queryId: 'q11', category: '圓管', material: '黑鐵' },
        { queryId: 'q12', category: '圓管', material: '黑鐵', unit: 'Kg' },
      ],
    });
  });

  it('defaults 圓管 material to 黑鐵 unless a valid material is supplied', () => {
    expect(
      schema.parse({
        queries: [
          { category: '圓管' },
          { category: '圓管', material: 'invalid' },
          { category: '圓管', material: '白鐵' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: '圓管', material: '黑鐵' },
        { queryId: 'q2', category: '圓管', material: '黑鐵' },
        { queryId: 'q3', category: '圓管', material: '白鐵' },
      ],
    });
  });

  it('defaults 平鐵 material to 黑鐵 unless a valid material is supplied', () => {
    expect(
      schema.parse({
        queries: [
          { category: '平鐵' },
          { category: '平鐵', material: 'invalid' },
          { category: '平鐵', material: '白鐵' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: '平鐵', material: '黑鐵' },
        { queryId: 'q2', category: '平鐵', material: '黑鐵' },
        { queryId: 'q3', category: '平鐵', material: '白鐵' },
      ],
    });
  });

  it('defaults 方鐵 material to 黑鐵 unless a valid material is supplied', () => {
    expect(
      schema.parse({
        queries: [
          { category: '方鐵' },
          { category: '方鐵', material: 'invalid' },
          { category: '方鐵', material: '白鐵' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: '方鐵', material: '黑鐵' },
        { queryId: 'q2', category: '方鐵', material: '黑鐵' },
        { queryId: 'q3', category: '方鐵', material: '白鐵' },
      ],
    });
  });

  it('defaults 槽鐵 material to 黑鐵 and normalizes 熱浸鍍 to 錏', () => {
    expect(
      schema.parse({
        queries: [
          { category: '槽鐵', keyword: '50x25x5' },
          { category: '槽鐵', material: '熱浸鍍', keyword: '75x40x5/7' },
          { category: '槽鐵', material: '熱浸鍍鋅', keyword: '75x40x5/7' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: '槽鐵', material: '黑鐵', keyword: '50x25x5' },
        { queryId: 'q2', category: '槽鐵', material: '錏', keyword: '75x40x5/7' },
        { queryId: 'q3', category: '槽鐵', material: '錏', keyword: '75x40x5/7' },
      ],
    });
  });

  it('defaults 角鐵 material to 黑鐵 and normalizes 熱進鍍鋅 to 錏', () => {
    expect(
      schema.parse({
        queries: [
          { category: '角鐵', keyword: '25x2.5' },
          { category: '角鐵', material: '熱進鍍鋅', keyword: '100x75x7' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: '角鐵', material: '黑鐵', keyword: '25x2.5' },
        { queryId: 'q2', category: '角鐵', material: '錏', keyword: '100x75x7' },
      ],
    });
  });

  it('removes mesh unit filters', () => {
    expect(
      schema.parse({
        queries: [
          { category: '網', unit: '㎡', subcategory: '點焊' },
          { category: '網', unit: '捲', subcategory: '刺網' },
          { category: '網', unit: '張', subcategory: '點焊' },
          { category: '網', subcategory: '菱形' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: '網', subcategory: '點焊' },
        { queryId: 'q2', category: '網', subcategory: '刺網' },
        { queryId: 'q3', category: '網', subcategory: '點焊' },
        { queryId: 'q4', category: '網', subcategory: '菱形' },
      ],
    });
  });

  it('validates subcategories against their category and rejects legacy names', () => {
    expect(() => schema.parse({ queries: [{ category: '加工/其他', subcategory: '扁' }] })).toThrow(
      '扁',
    );
    expect(() => schema.parse({ queries: [{ category: '鐵板', subcategory: '鋼管' }] })).toThrow(
      '鋼管',
    );
    expect(() => schema.parse({ queries: [{ category: '鐵板/鋼板' }] })).toThrow();
    expect(() => schema.parse({ queries: [{ category: '孔', keyword: '鐵板' }] })).toThrow();
    expect(() =>
      schema.parse({ queries: [{ category: '加工/切工', processingMethod: '雷射' }] }),
    ).toThrow();
  });

  it('keeps 錏 and 鋅 as distinct accepted material filters', () => {
    expect(schema.parse({ queries: [{ category: '鐵板', material: '錏' }] })).toBeDefined();
    expect(schema.parse({ queries: [{ category: '鐵板', material: '鋅' }] })).toBeDefined();
  });

  it.each(['0', '-1', '6mm', 'NaN', 'Infinity', '1e2'])(
    'rejects non-positive or non-decimal thickness %s',
    (thicknessMm) => {
      expect(() =>
        schema.parse({ queries: [{ category: '加工/孔', thicknessMm: [thicknessMm] }] }),
      ).toThrow();
    },
  );

  it('silently removes invalid stock lengths without rejecting the query', () => {
    expect(
      schema.parse({
        queries: [
          {
            category: '圓管',
            stockLengthMm: ['0', '-1', '6m', 'NaN', 'Infinity', '1e4', 6000, null, '6000'],
          },
        ],
      }),
    ).toEqual({
      queries: [{ queryId: 'q1', category: '圓管', material: '黑鐵', stockLengthMm: ['6000'] }],
    });
  });

  it('rounds normalized stock-length millimeters to integers and deduplicates them', () => {
    expect(
      schema.parse({
        queries: [{ category: '圓管', stockLengthMm: ['5999.6', '6000.4', '6000.6'] }],
      }),
    ).toEqual({
      queries: [
        {
          queryId: 'q1',
          category: '圓管',
          material: '黑鐵',
          stockLengthMm: ['6000', '6001'],
        },
      ],
    });
  });

  it('silently removes H型鋼 stock lengths below 6000mm without rejecting the query', () => {
    expect(
      schema.parse({
        queries: [{ category: 'H型鋼', stockLengthMm: ['3000', '5000', '5999.9', '6000'] }],
      }),
    ).toEqual({
      queries: [{ queryId: 'q1', category: 'H型鋼', stockLengthMm: ['6000'] }],
    });

    expect(schema.parse({ queries: [{ category: 'H型鋼', stockLengthMm: ['4000'] }] })).toEqual({
      queries: [{ queryId: 'q1', category: 'H型鋼', stockLengthMm: [] }],
    });
  });
});
