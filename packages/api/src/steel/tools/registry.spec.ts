import {
  getExecutableSteelToolDefinition,
  getSteelToolDefinition,
  getSteelToolDefinitions,
} from './registry';
import { steelToolArgsSchemas } from './schemas';

describe('Steel tool registry', () => {
  it('exposes only the minimal AI-led tool surface', () => {
    const toolNames = getSteelToolDefinitions().map((definition) => definition.name);

    expect(toolNames).toEqual(['search_customers', 'search_price_candidates', 'read_markdown']);
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
            limit: 101,
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
          limit: 100,
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

    expect(definition.description).toContain('one call');
    expect(definition.description).toContain('known order lines');
    expect(definition.description).toContain('processingQueries');
    expect(definition.description).toContain('productNames');
    expect(definition.description).toContain('cuttingPrices');
    expect(definition.description).not.toContain('queryId');
    expect(definition.description).not.toContain('q1');
    expect(definition.description).not.toContain('clamped');
    expect(definition.description).not.toContain('parallel');
    expect(definition.description).not.toContain('no top-level');
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

  it('exposes file-keyed Markdown-derived current-state reads by default', () => {
    const definition = getSteelToolDefinitions().find((entry) => entry.name === 'read_markdown');

    expect(definition).toBeDefined();
    expect(definition?.description).toContain('absent or incomplete in chat history');
    expect(definition?.description).toContain('same-turn OCR already present');
    expect(definition?.description).not.toContain('backend');
    expect(definition?.description).not.toContain('merging all OCR preprocessing chunks');
    expect(definition?.usagePolicy).toEqual({
      requiresMissingMarkdownInHistory: true,
      forbiddenWhenHistoryHasNeededMarkdown: true,
      allowedScopes: ['workbook', 'ocr'],
      currentConversationScoped: true,
      fileKeyParameter: 'fileKey',
      ocrFileKeyParameter: 'ocrFileKey',
      defaultWorkbookFileKey: 'default',
      fileKeyRecommendedWhenMultipleOrders: true,
      ocrFileKeyRecommendedForFullContent: true,
    });
    expect(
      definition?.argsSchema.parse({
        scope: 'workbook',
        reason: 'Need current parsed workbook after compact context',
      }),
    ).toEqual({
      scope: 'workbook',
      reason: 'Need current parsed workbook after compact context',
    });
    expect(
      definition?.argsSchema.parse({
        scope: 'workbook',
        fileKey: 'file:file-d',
      }),
    ).toEqual({
      scope: 'workbook',
      fileKey: 'file:file-d',
    });
    expect(
      definition?.argsSchema.parse({
        scope: 'ocr',
        ocrFileKey: 'file:file-d',
      }),
    ).toEqual({
      scope: 'ocr',
      ocrFileKey: 'file:file-d',
    });
    expect(
      definition?.argsSchema.parse({
        scope: 'ocr',
        fileKey: 'file:file-d',
      }),
    ).toEqual({
      scope: 'ocr',
      fileKey: 'file:file-d',
    });
    expect(() =>
      definition?.argsSchema.parse({
        scope: 'ocr',
        ocrFileKey: 'file:file-d',
        fileKey: 'file:file-e',
      }),
    ).toThrow('ocrFileKey and fileKey must match');
    expect(() =>
      definition?.argsSchema.parse({
        scope: 'quote',
      }),
    ).toThrow();
    expect(() =>
      definition?.argsSchema.parse({
        scope: 'all',
      }),
    ).toThrow();
    expect(() =>
      definition?.argsSchema.parse({
        query: 'CCG075',
      }),
    ).toThrow();
    expect(() =>
      definition?.argsSchema.parse({
        rowNo: 12,
        sheetIds: ['system_order'],
      }),
    ).toThrow();
    expect(getSteelToolDefinitions().map((entry) => entry.name)).toContain('read_markdown');
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
