import {
  getExecutableSteelToolDefinition,
  getSteelToolDefinition,
  getSteelToolDefinitions,
} from './registry';
import { steelToolArgsSchemas } from './schemas';

describe('Steel tool registry', () => {
  it('exposes only the minimal AI-led tool surface', () => {
    const toolNames = getSteelToolDefinitions().map((definition) => definition.name);

    expect(toolNames).toEqual(['search_customers', 'search_price_candidates']);
    expect(toolNames).not.toContain('run_file_ocr');
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

  it('deletes context-injected and duplicate read tools from schema and executable registry', () => {
    expect(Object.keys(steelToolArgsSchemas)).not.toContain('run_file_ocr');
    expect(Object.keys(steelToolArgsSchemas)).not.toContain('lookup_quote_rules');
    expect(Object.keys(steelToolArgsSchemas)).not.toContain('read_working_order_items');
    expect(() => {
      // @ts-expect-error exercising a deleted executable tool name.
      getExecutableSteelToolDefinition('run_file_ocr');
    }).toThrow('Unknown Steel executable tool');
    expect(() => {
      // @ts-expect-error exercising a deleted executable tool name.
      getExecutableSteelToolDefinition('lookup_quote_rules');
    }).toThrow('Unknown Steel executable tool');
    expect(() => {
      // @ts-expect-error exercising a deleted executable tool name.
      getExecutableSteelToolDefinition('read_working_order_items');
    }).toThrow('Unknown Steel executable tool');
  });

  it('describes and validates one-call grouped v4.2 price lookup', () => {
    const definition = getSteelToolDefinition('search_price_candidates');

    expect(
      definition.argsSchema.parse({
        queries: [
          {
            category: '圓管',
            subcategory: '一般',
            material: '鎢',
            thicknessMm: ['2'],
            erpItemCode: '00123',
            keyword: '50x2',
          },
          { mode: 'category_discovery', keyword: '白鐵 方管' },
        ],
      }),
    ).toEqual({
      queries: [
        {
          queryId: 'q1',
          category: '圓管',
          subcategory: '一般',
          material: '鎢',
          thicknessMm: ['2'],
          erpItemCode: '00123',
          keyword: '50x2',
        },
        { queryId: 'q2', mode: 'category_discovery', keyword: '白鐵 方管' },
      ],
    });
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '加工/其他', subcategory: '扁' }],
      }),
    ).toThrow('扁');
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '鐵板/鋼板', material: '鋅' }],
      }),
    ).toThrow();
    expect(() =>
      definition.argsSchema.parse({
        queries: [{ category: '鐵板' }],
        customerTier: 'A',
      }),
    ).toThrow('Unrecognized key');

    expect(definition.description).toBe(
      'Find material, cutting, and processing price candidates for one or more order lines.',
    );
    expect(definition.description).not.toContain('queries');
    expect(definition.description).not.toContain('processingQueries');
    expect(definition.description).not.toContain('productNames');
    expect(definition.description).not.toContain('cuttingPrices');
    expect(definition.description).not.toContain('processingPrice');
    expect(definition.description).not.toContain('matchedQueryIds');
    expect(definition.description).not.toContain('candidateMatches');
    expect(definition.description).not.toContain('manualReviewNotes');
    expect(definition.description).not.toContain('10 rows');
    expect(definition.description).not.toContain('queryId');
    expect(definition.description).not.toContain('q1');
    expect(definition.description).not.toContain('clamped');
    expect(definition.description).not.toContain('parallel');
    expect(definition.description).not.toContain('no top-level');
  });
  it('uses AI-supplied keyword arrays for customer lookup only', () => {
    expect(getSteelToolDefinition('search_customers').description).toBe(
      'Find Steel customer records for quoting.',
    );
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

  it('does not expose OCR as a provider or executable Steel tool', () => {
    expect(getSteelToolDefinitions().map((entry) => entry.name)).not.toContain('run_file_ocr');
    expect(() => {
      // @ts-expect-error exercising a removed provider-visible tool name.
      getSteelToolDefinition('run_file_ocr');
    }).toThrow('Unknown Steel provider tool');
    expect(() => {
      // @ts-expect-error exercising a removed executable tool name.
      getExecutableSteelToolDefinition('run_file_ocr');
    }).toThrow('Unknown Steel executable tool');
    expect(() => {
      // @ts-expect-error exercising a removed public tool name.
      getSteelToolDefinition('lookup_catalog_families');
    }).toThrow('Unknown Steel provider tool');
  });

  it('removes Markdown reconstruction from the provider registry', () => {
    expect(getSteelToolDefinitions().map((entry) => entry.name)).not.toContain('read_markdown');
    expect(Object.keys(steelToolArgsSchemas)).not.toContain('read_markdown');
    expect(() => {
      // @ts-expect-error exercising a deleted provider-visible tool name.
      getSteelToolDefinition('read_markdown');
    }).toThrow('Unknown Steel provider tool');
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
