import { getSteelToolDefinition, getSteelToolDefinitions } from './registry';

type GetToolDefinitionsWithMode = (input?: {
  contextMode?: 'full' | 'compact_workbook';
}) => Array<{
  name: string;
  argsSchema: {
    parse(value: unknown): unknown;
  };
}>;

describe('Steel tool registry', () => {
  it('exposes only the minimal AI-led tool surface', () => {
    const toolNames = getSteelToolDefinitions().map((definition) => definition.name);

    expect(toolNames).toEqual([
      'search_customers',
      'search_price_candidates',
      'run_file_ocr',
    ]);
    expect(toolNames).not.toContain('read_active_workbook');
    expect(toolNames).not.toContain('lookup_quote_rules');
    expect(toolNames).not.toContain('read_working_order_items');
    expect(toolNames).not.toContain('save_working_order_items');
    expect(toolNames).not.toContain('lookup_catalog_families');
    expect(toolNames).not.toContain('lookup_formula');
    expect(toolNames).not.toContain('lookup_instructions');
    expect(toolNames).not.toContain('lookup_defaults');
    expect(toolNames).not.toContain('normalize_quote_item');
    expect(toolNames).not.toContain('generate_price_search_terms');
    expect(toolNames).not.toContain('rank_price_candidates');
    expect(toolNames).not.toContain('raw_sql');
    expect(toolNames).not.toContain('read_file');
  });

  it('keeps Zod validation owned by the backend registry', () => {
    const definition = getSteelToolDefinition('search_price_candidates');

    expect(
      definition.argsSchema.parse({
        queries: [
          {
            category: '扁方管',
            material: '黑鐵',
            thicknessMm: ['2'],
            keyword: '75x45 扁方管',
            limit: 5,
          },
        ],
      }),
    ).toEqual({
      queries: [
        {
          category: '扁方管',
          material: '黑鐵',
          thicknessMm: ['2'],
          keyword: '75x45 扁方管',
          limit: 5,
        },
      ],
    });
    expect(
      definition.argsSchema.parse({
        queries: [{ category: '孔', keyword: '鐵板' }],
      }),
    ).toEqual({
      queries: [{ category: '孔', keyword: '鐵板' }],
    });
    expect(
      definition.argsSchema.parse({
        queries: [
          {
            category: '孔',
            material: 'OT 黑鐵',
            thicknessMm: ['15'],
            keyword: '鑽孔',
            limit: 5,
          },
        ],
      }),
    ).toEqual({
      queries: [{ category: '孔', keyword: '鐵板' }],
    });
    expect(
      definition.argsSchema.parse({
        queries: [{ mode: 'category_discovery', keyword: '白鐵 方管', limit: 10 }],
      }),
    ).toEqual({
      queries: [{ mode: 'category_discovery', keyword: '白鐵 方管', limit: 10 }],
    });
    expect(
      definition.argsSchema.parse({
        queries: [{ category: '鐵板/鋼板', material: '白鐵', thicknessMm: ['3'], limit: 10 }],
      }),
    ).toEqual({
      queries: [{ category: '鐵板/鋼板', material: '白鐵', thicknessMm: ['3'], limit: 10 }],
    });
    expect(
      definition.argsSchema.parse({
        queries: [
          { category: '角鐵/角鋼', material: '錏', keyword: 'L50', limit: 10 },
          { category: '非鋼材/其他材料', material: '鋁', keyword: '扁條', limit: 10 },
          { category: '浪板/收邊', material: '鋅', keyword: '收邊', limit: 10 },
        ],
      }),
    ).toEqual({
      queries: [
        { category: '角鐵/角鋼', material: '錏', keyword: 'L50', limit: 10 },
        { category: '非鋼材/其他材料', material: '鋁', keyword: '扁條', limit: 10 },
        { category: '浪板/收邊', material: '鋅', keyword: '收邊', limit: 10 },
      ],
    });
    expect(() =>
      definition.argsSchema.parse({
        candidateQueries: [
          {
            queryId: 'c75',
            productNames: ['錏輕型鋼', '75*2.3'],
            erpItemCodes: ['CCG075'],
            confidence: 'medium',
            reason: 'old nested candidate shape',
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ material: 'OT 黑鐵', keyword: '方管' }],
      }),
    ).toThrow('Required');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: 'rectangular_tube', material: 'OT 黑鐵' }],
      }),
    ).toThrow();
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '扁方管', material: 'ot_black_iron' }],
      }),
    ).toThrow();
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '鐵板/鋼板', material: 'No1 白鐵' }],
      }),
    ).toThrow();
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '扁方管', material: 'OT 黑鐵' }],
      }),
    ).toThrow();
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '扁方管', material: '錏/鍍鋅' }],
      }),
    ).toThrow();
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '扁方管', material: '鋁鋅' }],
      }),
    ).toThrow();
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '扁方管', material: '黑鐵' }],
        customerTier: 'b',
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '扁方管', material: '黑鐵' }],
        customerTier: 'A',
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '扁方管' }],
        customerTierId: 2,
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '鐵板/鋼板', material: '黑鐵' }],
        reviewState: 'reviewed',
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '鐵板/鋼板', material: '黑鐵' }],
        includeInactive: true,
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '鐵板/鋼板', specs: ['雷射切割'] }],
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: 'H型鋼', keyword: '200x100' }],
        includeRelatedCutting: true,
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: 'H型鋼', keyword: '200x100' }],
        limit: 5,
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        mode: 'category_discovery',
        keyword: '白鐵 方管',
      }),
    ).toThrow('Unrecognized key');
    expect(
      definition.argsSchema.parse({
        queries: [{ category: '孔', keyword: '鐵板', thicknessMm: 15 }],
      }),
    ).toEqual({
      queries: [{ category: '孔', keyword: '鐵板' }],
    });
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '鐵板/鋼板', thicknessMm: [15] }],
      }),
    ).toThrow();
    expect(
      definition.argsSchema.parse({
        queries: [{ category: '孔', material: '無', keyword: '鐵板' }],
      }),
    ).toEqual({
      queries: [{ category: '孔', keyword: '鐵板' }],
    });
    expect(
      definition.argsSchema.parse({
        queries: [{ category: '孔', keyword: '鑽孔' }],
      }),
    ).toEqual({
      queries: [{ category: '孔', keyword: '鐵板' }],
    });
    expect(() => definition.argsSchema.parse({ limit: 2 })).toThrow();
    expect(definition.description).toContain('queries');
    expect(definition.description).toContain('category');
    expect(definition.description).toContain('thicknessMm');
    expect(definition.description).not.toContain('specs');
    expect(definition.description).not.toContain('includeRelatedCutting');
    expect(definition.description).not.toContain('customerTier');
    expect(definition.description).not.toContain('customerTierId');
    expect(definition.description).not.toContain('candidateQueries');
    expect(definition.description).not.toContain('productNames');
    expect(definition.description).not.toContain('erpItemCodes');
  });

  it('uses AI-supplied keyword arrays for customer lookup only', () => {
    expect(
      getSteelToolDefinition('search_customers').argsSchema.parse({
        keywords: ['大成', 'A001'],
        limit: 10,
      }),
    ).toEqual({
      keywords: ['大成', 'A001'],
      limit: 10,
    });
    expect(() =>
      // @ts-expect-error exercising a removed provider-visible tool name.
      getSteelToolDefinition('lookup_quote_rules').argsSchema.parse({ catalogContexts: [] }),
    ).toThrow('Unknown Steel provider tool');
    expect(() =>
      getSteelToolDefinition('search_customers').argsSchema.parse({
        searchText: '大成',
      }),
    ).toThrow();
  });

  it('lets AI trigger whole-file OCR without page-level arguments', () => {
    const definition = getSteelToolDefinition('run_file_ocr');

    expect(
      definition.argsSchema.parse({
        fileIndex: 0,
        output_mode: 'markdown',
      }),
    ).toEqual({
      fileIndex: 0,
      output_mode: 'markdown',
    });
    expect(() =>
      definition.argsSchema.parse({
        fileIndex: 0,
        page: 1,
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        fileIndex: 0,
        imageIndex: 1,
      }),
    ).toThrow('Unrecognized key');
    expect(() => {
      // @ts-expect-error exercising a removed public tool name.
      getSteelToolDefinition('lookup_catalog_families');
    }).toThrow('Unknown Steel provider tool');
  });

  it('exposes keyword-only active workbook reads only for compact workbook context', () => {
    const compactDefinitions = (getSteelToolDefinitions as GetToolDefinitionsWithMode)({
      contextMode: 'compact_workbook',
    });
    const definition = compactDefinitions.find((entry) => entry.name === 'read_active_workbook');

    expect(definition).toBeDefined();
    expect(definition?.argsSchema.parse({
      query: 'CCG075 龍頂',
      sheetIds: ['system_order', 'customer_quote'],
      limit: 5,
      reason: 'Need exact rows after compact context',
    })).toEqual({
      query: 'CCG075 龍頂',
      sheetIds: ['system_order', 'customer_quote'],
      limit: 5,
      reason: 'Need exact rows after compact context',
    });
    expect(() => definition?.argsSchema.parse({ query: 'A12' })).toThrow(
      'Use semantic keywords',
    );
    expect(() =>
      definition?.argsSchema.parse({
        query: 'CCG075',
        column: 'A',
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition?.argsSchema.parse({
        rowNo: 12,
        sheetIds: ['system_order'],
      }),
    ).toThrow('Unrecognized key');
    expect(getSteelToolDefinitions().map((entry) => entry.name)).not.toContain(
      'read_active_workbook',
    );
  });

  it('does not expose working-order memory reads as a provider tool', () => {
    expect(() => {
      // @ts-expect-error exercising a removed provider-visible tool name.
      getSteelToolDefinition('read_working_order_items');
    }).toThrow('Unknown Steel provider tool');
    expect(() => {
      // @ts-expect-error exercising a deliberately absent public tool name.
      getSteelToolDefinition('save_working_order_items');
    }).toThrow('Unknown Steel provider tool');
  });
});
