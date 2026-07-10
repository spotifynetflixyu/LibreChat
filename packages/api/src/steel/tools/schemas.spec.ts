import { steelToolArgsSchemas } from './schemas';

describe('Steel price candidate tool schema', () => {
  const schema = steelToolArgsSchemas.search_price_candidates;

  it('assigns deterministic query IDs from array order and ignores supplied IDs', () => {
    expect(
      schema.parse({
        queries: [
          { category: 'H型鋼', keyword: 'H200x100' },
          { queryId: '  order-line-2  ', category: '加工/其他', subcategory: '扁鐵' },
          { mode: 'category_discovery', keyword: '不銹鋼管' },
        ],
      }),
    ).toEqual({
      queries: [
        { queryId: 'q1', category: 'H型鋼', keyword: 'H200x100' },
        { queryId: 'q2', category: '加工/其他', subcategory: '扁鐵' },
        { queryId: 'q3', mode: 'category_discovery', keyword: '不銹鋼管' },
      ],
    });
  });

  it('normalizes duplicate supplied IDs to their array positions', () => {
    expect(
      schema.parse({
        queries: [
          { queryId: 'same', category: '鐵板' },
          { queryId: 'same', category: 'H型鋼' },
        ],
      }).queries.map((query) => query.queryId),
    ).toEqual(['q1', 'q2']);
  });

  it('keeps an omitted limit undefined and clamps every positive integer above 100', () => {
    expect(schema.parse({ queries: [{ category: '鐵板' }] }).queries[0]?.limit).toBeUndefined();
    expect(schema.parse({ queries: [{ category: '鐵板', limit: 101 }] }).queries[0]?.limit).toBe(
      100,
    );
    expect(
      schema.parse({ queries: [{ mode: 'category_discovery', keyword: '管', limit: 10_000 }] })
        .queries[0]?.limit,
    ).toBe(100);
  });

  it.each([0, -1, 1.5])('rejects invalid per-query limit %s', (limit) => {
    expect(() => schema.parse({ queries: [{ category: '鐵板', limit }] })).toThrow();
  });

  it('accepts all v4.2 lookup filters and separate 錏/鋅 material enum values', () => {
    expect(
      schema.parse({
        queries: [
          {
            queryId: 'line-1',
            category: '圓管',
            subcategory: '鋼管',
            material: '鎢',
            thicknessMm: ['1.2', '1.5'],
            erpItemCode: '00123',
            keyword: '連料',
            limit: 30,
          },
          { category: '五金/配件', material: '鋅' },
        ],
      }),
    ).toEqual({
      queries: [
        {
          queryId: 'q1',
          category: '圓管',
          subcategory: '鋼管',
          material: '鎢',
          thicknessMm: ['1.2', '1.5'],
          erpItemCode: '00123',
          keyword: '連料',
          limit: 30,
        },
        { queryId: 'q2', category: '五金/配件', material: '鋅' },
      ],
    });
  });

  it('rejects the removed unit query filter', () => {
    expect(() => schema.parse({ queries: [{ category: '圓管', unit: 'M' }] })).toThrow(
      'Unrecognized key',
    );
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
  });

  it('keeps 錏 and 鋅 as distinct accepted material filters', () => {
    expect(schema.parse({ queries: [{ category: '鐵板', material: '錏' }] })).toBeDefined();
    expect(schema.parse({ queries: [{ category: '鐵板', material: '鋅' }] })).toBeDefined();
  });
});
