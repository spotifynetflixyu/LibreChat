import { createSteelToolRunState, executeSteelTool } from './execute';
import { steelToolArgsSchemas } from './schemas';

function row(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: String(index),
    erp_item_code: `ERP-${index}`,
    formula_code: 'F1',
    spec_key: `鐵板 ${index}`,
    product_name: `鐵板 ${index}`,
    category: '鐵板',
    subcategory: null,
    processing_method: null,
    processing_shape: null,
    material: '黑鐵 / OT',
    unit: 'Kg',
    value_state: 'confirmed',
    unit_price_base: null,
    unit_price_a: '10',
    unit_price_b: '10',
    unit_price_c: null,
    unit_price_d: null,
    unit_price_e: null,
    unit_price_f: null,
    price_ratio_a: null,
    price_ratio_b: null,
    price_ratio_c: null,
    price_ratio_d: null,
    price_ratio_e: null,
    price_ratio_f: null,
    unit_weight_value: '1',
    unit_weight_basis: 'Kg/M',
    density: '7.85',
    thickness_min_mm: '6',
    thickness_max_mm: '6',
    width_mm: '100',
    height_mm: null,
    length_mm: '6000',
    outer_diameter_mm: null,
    nominal_inch: null,
    web_mm: null,
    flange_mm: null,
    lip_mm: null,
    sheet_width_mm: null,
    sheet_length_mm: null,
    spec_sort_key: String(index).padStart(4, '0'),
    cost_basis: 'Kg',
    ...overrides,
  };
}

function client(batches: object[][]) {
  const calls: string[] = [];
  const values: unknown[][] = [];
  return {
    calls,
    values,
    query: async <Row extends object>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<{ rows: Row[] }> => {
      calls.push(sql);
      values.push([...params]);
      return { rows: (batches.shift() ?? []) as Row[] };
    },
  };
}

describe('direct price candidates contract', () => {
  it('rejects ERP-only query and returns 250 of 251 usable material rows', async () => {
    expect(() => steelToolArgsSchemas.search_price_candidates.parse({ queries: [{ erpItemCodes: ['ERP-1'] }] })).toThrow();
    const rows = [
      row(0, { erp_item_code: '', product_name: 'missing code' }),
      row(1, { product_name: null }),
      ...Array.from({ length: 251 }, (_, index) => row(index + 2)),
    ];
    const mock = client([
      [{ query_index: '0', query_id: 'q1', price_candidates: rows, category_candidates: [] }],
      [],
      [],
    ]);
    const result = await executeSteelTool({
      client: mock,
      toolName: 'search_price_candidates',
      arguments: { queries: [{ categories: ['鐵板'] }] },
    });
    if (!result.ok) throw new Error(result.errorSummary);
    const queryResults = result.data.queryResults as Array<Record<string, unknown>>;
    const query = queryResults[0];
    expect(query).toEqual(expect.objectContaining({
      defaultMaterial: '黑鐵',
      availableMaterials: ['黑鐵', '白鐵', '錏'],
      totalAvailable: 251,
      returnedCount: 250,
      truncated: true,
    }));
    expect((query.candidates as unknown[]).length).toBe(250);
    expect(JSON.stringify(query)).not.toContain('pricingOptions');
    const serializedQueries = JSON.parse(String(mock.values[0]?.[0])) as Array<{
      material_terms: string[];
    }>;
    expect(serializedQueries[0]).toEqual(
      expect.objectContaining({
        material_terms: ['黑鐵'],
      }),
    );
  });

  it('returns structured unsupported and mixed-default query items without failing batch', async () => {
    const mock = client([]);
    const result = await executeSteelTool({
      client: mock,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          { categories: ['H型鋼'], materials: ['鋁'] },
          { categories: ['C型鋼', 'H型鋼'] },
        ],
      },
    });
    if (!result.ok) throw new Error(result.errorSummary);
    const queryResults = result.data.queryResults as Array<Record<string, unknown>>;
    expect(queryResults[0]).toEqual(expect.objectContaining({ status: 'unsupported_material' }));
    expect(queryResults[0]).not.toEqual(
      expect.objectContaining({ candidates: expect.anything(), totalAvailable: expect.anything(), returnedCount: expect.anything(), truncated: expect.anything() }),
    );
    expect(queryResults[1]).toEqual(
      expect.objectContaining({ status: 'split_required_mixed_defaults' }),
    );
    expect(queryResults[1]).not.toEqual(
      expect.objectContaining({ candidates: expect.anything(), totalAvailable: expect.anything(), returnedCount: expect.anything(), truncated: expect.anything() }),
    );
    expect(mock.calls).toHaveLength(0);
  });

  it('partitions a mixed-category surface query and returns supported candidates', async () => {
    const mock = client([
      [{ query_index: '0', query_id: 'q1:c2', price_candidates: [row(1)], category_candidates: [] }],
      [],
      [],
    ]);
    const result = await executeSteelTool({
      client: mock,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ categories: ['方管', '鐵板'], materials: ['NO1'] }],
      },
    });

    if (!result.ok) throw new Error(result.errorSummary);
    const [query] = result.data.queryResults as Array<Record<string, unknown>>;
    expect(query).toEqual(
      expect.objectContaining({
        queryId: 'q1',
        status: 'ok',
        candidates: [expect.objectContaining({ erpItemCode: 'ERP-1', category: '鐵板' })],
        availableWhiteSteelSurfaces: ['ST', 'BA'],
        categoryMaterialOptions: [
          expect.objectContaining({
            category: '方管',
            defaultMaterial: '黑鐵',
            availableWhiteSteelSurfaces: ['ST', 'BA'],
          }),
          expect.objectContaining({
            category: '鐵板',
            defaultMaterial: '黑鐵',
            availableWhiteSteelSurfaces: ['ST', '2B', 'NO1', 'HL', 'BA'],
          }),
        ],
        unsupportedMaterials: [
          expect.objectContaining({
            category: '方管',
            material: 'NO1',
            availableWhiteSteelSurfaces: ['ST', 'BA'],
          }),
        ],
      }),
    );
    expect(mock.calls).toHaveLength(2);
    const serializedQueries = JSON.parse(String(mock.values[0]?.[0])) as Array<{
      query_id: string;
      category: string;
      material_terms: string[];
    }>;
    expect(serializedQueries).toEqual([
      expect.objectContaining({ query_id: 'q1:c2', category: '鐵板', material_terms: ['NO1'] }),
    ]);
  });

  it('uses 2B for generic white steel and preserves an explicit surface for SQL filtering', async () => {
    const mock = client([
      [
        { query_index: '0', query_id: 'q1:c1', price_candidates: [], category_candidates: [] },
        { query_index: '1', query_id: 'q2:c1', price_candidates: [], category_candidates: [] },
        { query_index: '2', query_id: 'q3:c1', price_candidates: [], category_candidates: [] },
      ],
      [],
      [],
    ]);

    const result = await executeSteelTool({
      client: mock,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [
          { categories: ['鐵板'], materials: ['白鐵'] },
          { categories: ['鐵板'], materials: ['ST'] },
          { categories: ['鐵板'], materials: ['BA'] },
        ],
      },
    });

    expect(result.ok).toBe(true);
    const serializedQueries = JSON.parse(String(mock.values[0]?.[0])) as Array<{
      material_terms: string[];
    }>;
    expect(serializedQueries.map(({ material_terms }) => material_terms)).toEqual([
      ['2B'],
      ['ST'],
      ['BA'],
    ]);
  });

  it('keeps stable OR material terms for mixed surfaces and families', async () => {
    const mock = client([
      [{ query_index: '0', query_id: 'q1:c1', price_candidates: [], category_candidates: [] }],
      [],
      [],
    ]);
    const result = await executeSteelTool({
      client: mock,
      toolName: 'search_price_candidates',
      arguments: {
        queries: [{ categories: ['鐵板'], materials: ['ST', '2B', '黑鐵', '白鐵', '2B'] }],
      },
    });

    expect(result.ok).toBe(true);
    const serializedQueries = JSON.parse(String(mock.values[0]?.[0])) as Array<{
      material_terms: string[];
    }>;
    expect(serializedQueries[0]?.material_terms).toEqual(['ST', '2B', '黑鐵']);
  });

  it('enforces optional per-tool limits while preserving total call limit', async () => {
    const runState = createSteelToolRunState(8, { search_price_candidates: 2 });
    const mock = client([[], [], [], [], [], []]);
    const args = { queries: [{ categories: ['鐵板'] }] };
    expect((await executeSteelTool({ client: mock, runState, toolName: 'search_price_candidates', arguments: args })).ok).toBe(true);
    expect((await executeSteelTool({ client: mock, runState, toolName: 'search_price_candidates', arguments: args })).ok).toBe(true);
    expect((await executeSteelTool({ client: mock, runState, toolName: 'search_price_candidates', arguments: args })).ok).toBe(false);
  });
});
