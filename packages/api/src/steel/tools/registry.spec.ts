import { getSteelToolDefinition, getSteelToolDefinitions } from './registry';

describe('Steel tool registry', () => {
  it('exposes only the minimal AI-led tool surface', () => {
    const toolNames = getSteelToolDefinitions().map((definition) => definition.name);

    expect(toolNames).toEqual([
      'lookup_quote_rules',
      'search_customers',
      'search_price_candidates',
      'run_file_ocr',
      'read_working_order_items',
    ]);
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
        candidateQueries: ['錏輕型鋼', '75*2.3', 'CCG075'],
        customerTierId: 5,
        limit: 5,
      }),
    ).toEqual({
      candidateQueries: ['錏輕型鋼', '75*2.3', 'CCG075'],
      customerTierId: 5,
      limit: 5,
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
    expect(() => definition.argsSchema.parse({ productNames: ['錏輕型鋼'], limit: 2 })).toThrow(
      'Unrecognized key',
    );
    expect(() => definition.argsSchema.parse({ erpItemCodes: ['CCG075'], limit: 2 })).toThrow(
      'Unrecognized key',
    );
    expect(() => definition.argsSchema.parse({ productName: '錏成型角鐵', limit: 5 })).toThrow(
      'Unrecognized key',
    );
    expect(() =>
      definition.argsSchema.parse({
        candidateQueries: ['OT板雷射切割'],
        customerTierId: 2,
      }),
    ).not.toThrow();
    expect(() =>
      definition.argsSchema.parse({
        candidateQueries: ['OT板雷射切割'],
        reviewState: 'reviewed',
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      definition.argsSchema.parse({
        candidateQueries: ['OT板雷射切割'],
        includeInactive: true,
      }),
    ).toThrow('Unrecognized key');
    expect(() => definition.argsSchema.parse({ specKey: '30x30', limit: 5 })).toThrow(
      'Unrecognized key',
    );
    expect(() => definition.argsSchema.parse({ specKeyContains: '30x30', limit: 5 })).toThrow(
      'Unrecognized key',
    );
    expect(() => definition.argsSchema.parse({ catalogFamilies: ['c_type'], limit: 5 })).toThrow(
      'Unrecognized key',
    );
    expect(() => definition.argsSchema.parse({ limit: 2 })).toThrow(
      'Provide candidateQueries',
    );
    expect(definition.description).toContain('candidateQueries');
    expect(definition.description).not.toContain('productNames');
    expect(definition.description).not.toContain('erpItemCodes');
  });

  it('uses AI-supplied keyword arrays for rule and customer lookups', () => {
    expect(
      getSteelToolDefinition('lookup_quote_rules').argsSchema.parse({
        keywords: ['OT板雷射切割', 'PL6'],
        limit: 20,
      }),
    ).toEqual({
      keywords: ['OT板雷射切割', 'PL6'],
      limit: 20,
    });
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
      getSteelToolDefinition('lookup_quote_rules').argsSchema.parse({ catalogContexts: [] }),
    ).toThrow();
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
    }).toThrow('Unknown Steel tool');
  });

  it('lets AI read working-order memory without exposing a save tool', () => {
    const definition = getSteelToolDefinition('read_working_order_items');

    expect(
      definition.argsSchema.parse({
        mode: 'rowNo',
        rowNo: 12,
      }),
    ).toEqual({
      mode: 'rowNo',
      rowNo: 12,
    });
    expect(
      definition.argsSchema.parse({
        mode: 'query',
        query: '75x45',
        pageSize: 10,
      }),
    ).toEqual({
      mode: 'query',
      query: '75x45',
      pageSize: 10,
    });
    expect(() =>
      definition.argsSchema.parse({
        mode: 'rowNo',
      }),
    ).toThrow('Provide rowNo');
    expect(() =>
      definition.argsSchema.parse({
        mode: 'erpItemCode',
      }),
    ).toThrow('Provide erpItemCode');
    expect(() =>
      definition.argsSchema.parse({
        mode: 'query',
      }),
    ).toThrow('Provide query');
    expect(() =>
      definition.argsSchema.parse({
        mode: 'source',
      }),
    ).toThrow('Provide filename, pageNumber, or imageIndex');
    expect(() => {
      // @ts-expect-error exercising a deliberately absent public tool name.
      getSteelToolDefinition('save_working_order_items');
    }).toThrow('Unknown Steel tool');
  });
});
