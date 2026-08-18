import {
  createSteelNativeTool,
  getNativeSteelToolName,
  mergeSteelToolDefinitions,
  prepareSteelNativeToolConfig,
  resolveSteelProviderToolName,
  resolveNativeSteelToolName,
  stripPaddleOcrToolsForMainAgent,
  stripSteelToolsForOcrTurn,
} from './tools';

import type { LCTool, LCToolRegistry } from '@librechat/agents';
import type { SteelNativeToolExecute } from './tools';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';

function getNames(tools: readonly LCTool[] | undefined): string[] {
  return tools?.map((tool) => tool.name) ?? [];
}

type JsonSchemaValue =
  | null
  | boolean
  | number
  | string
  | JsonSchemaValue[]
  | { [key: string]: JsonSchemaValue };

function collectExclusiveBounds(value: JsonSchemaValue): JsonSchemaValue[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectExclusiveBounds);
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) =>
    key === 'exclusiveMinimum' || key === 'exclusiveMaximum'
      ? [nested]
      : collectExclusiveBounds(nested),
  );
}

function findSchemaProperty(value: JsonSchemaValue, propertyName: string): JsonSchemaValue | undefined {
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findSchemaProperty(nested, propertyName);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  const properties = value.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    if (propertyName in properties) {
      return properties[propertyName];
    }
  }
  for (const nested of Object.values(value)) {
    const found = findSchemaProperty(nested, propertyName);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

describe('Steel native tool adapter', () => {
  it('adds Steel business tools without removing existing user tools', () => {
    const existingTool: LCTool = {
      name: 'web_search',
      description: 'Existing web search',
      parameters: { type: 'object', properties: {} },
    };
    const registry: LCToolRegistry = new Map([[existingTool.name, existingTool]]);

    const result = mergeSteelToolDefinitions({
      toolDefinitions: [existingTool],
      toolRegistry: registry,
      aiVisibleTools: ['search_customers', 'search_price_candidates'],
    });

    expect(getNames(result.toolDefinitions)).toEqual([
      'web_search',
      'delegate_ocr',
      'search_customers',
      'search_price_candidates',
    ]);
    expect(result.toolRegistry.get('web_search')).toBe(existingTool);
  });

  it('limits Steel tools to the runtime policy', () => {
    const result = mergeSteelToolDefinitions({
      aiVisibleTools: ['search_customers', 'search_price_candidates'],
    });

    expect(getNames(result.toolDefinitions)).toEqual([
      'delegate_ocr',
      'search_customers',
      'search_price_candidates',
    ]);
  });

  it('emits provider-compatible schemas for every native Steel tool', () => {
    const result = mergeSteelToolDefinitions();
    const parameters = result.toolDefinitions.map(
      (definition) => definition.parameters as JsonSchemaValue,
    );
    const exclusiveBounds = parameters.flatMap(collectExclusiveBounds);
    const pageStart = findSchemaProperty(
      result.toolDefinitions.find(({ name }) => name === 'delegate_ocr')
        ?.parameters as JsonSchemaValue,
      'pageStart',
    );

    expect(exclusiveBounds.every((bound) => typeof bound === 'number')).toBe(true);
    expect(JSON.stringify(parameters)).not.toContain('"const":');
    expect(pageStart).toEqual(expect.objectContaining({ minimum: 1 }));
    expect(pageStart).not.toHaveProperty('exclusiveMinimum');
  });

  it('namespaces Steel tools deterministically when an existing tool has the same name', () => {
    const existingTool: LCTool = {
      name: 'search_customers',
      description: 'Existing non-Steel customer search',
      parameters: { type: 'object', properties: {} },
    };

    const result = mergeSteelToolDefinitions({
      toolDefinitions: [existingTool],
      toolRegistry: new Map([[existingTool.name, existingTool]]),
      aiVisibleTools: ['search_customers'],
    });

    expect(getNames(result.toolDefinitions)).toEqual([
      'search_customers',
      'delegate_ocr',
      'steel_search_customers',
    ]);
    expect(result.toolDefinitions?.find(({ name }) => name === 'delegate_ocr')?.description).toBe(
      'Use this tool only when the user explicitly asks to inspect or verify drawing-related information in original attached images or PDFs. Do not call it during quoting when confirmed OCR or table data is already available. Pass one or more relevant attachment keys as `file:<file_id>`.',
    );
    expect(getNativeSteelToolName('search_customers', result.nameMap)).toBe(
      'steel_search_customers',
    );
    expect(resolveNativeSteelToolName('steel_search_customers', result.nameMap)).toBe(
      'search_customers',
    );
    expect(result.toolRegistry.get('search_customers')).toBe(existingTool);
    expect(result.toolRegistry.get('steel_search_customers')).toEqual(
      expect.objectContaining({
        name: 'steel_search_customers',
        description: expect.stringContaining('Steel'),
      }),
    );
  });

  it('creates executable native Steel tools using mapped Steel tool names', async () => {
    const execute = jest.fn(
      async (_input: Parameters<SteelNativeToolExecute>[0]): Promise<SteelToolResult> => ({
        ok: true as const,
        toolName: 'search_customers' as const,
        data: { customers: [{ displayName: 'ACME' }] },
        sourceRefs: [],
        durationMs: 7,
        redactionVersion: 1 as const,
      }),
    );
    const tool = createSteelNativeTool({
      nativeToolName: 'steel_search_customers',
      steelToolName: 'search_customers',
      execute,
    });

    const result = await tool.invoke(
      { keywords: ['ACME'] },
      {
        toolCall: {
          id: 'call_123',
        },
      },
    );

    expect(execute).toHaveBeenCalledWith({
      arguments: { keywords: ['ACME'] },
      nativeToolName: 'steel_search_customers',
      providerToolCallId: 'call_123',
      toolName: 'search_customers',
    });
    expect(result.content).toContain('"ok":true');
    expect(result.artifact).toEqual(
      expect.objectContaining({
        type: 'steel_tool_result',
        toolName: 'search_customers',
      }),
    );
  });

  it('compacts successful price results for providers while preserving the full artifact', async () => {
    const tierPrices = { A: 101, B: 102, C: 103, D: 104, E: 105, F: 106 };
    const priceCandidate: SteelToolJsonObject = {
      id: 27,
      erpItemCode: 'DNB2001',
      productName: 'H型鋼 200x100x5.5x8 L6000',
      specKey: 'DNB2001 H200x100x5.5x8 L6000',
      category: 'H型鋼',
      subcategory: '一般',
      processingMethod: '鋸床',
      processingShape: '直線切割',
      material: 'SS400',
      unit: '支',
      formulaCode: 'DA',
      valueState: 'confirmed',
      unitPriceBase: 100,
      tierPrices,
      tierRatios: { A: null, B: null, C: null, D: null, E: null, F: null },
      unitWeightValue: 128.4,
      unitWeightBasis: 'kg_per_piece_or_stock_length',
      density: 7.85,
      thicknessMinMm: 5.5,
      thicknessMaxMm: 8,
      widthMm: 100,
      heightMm: 200,
      lengthMm: 6000,
      outerDiameterMm: null,
      nominalInch: null,
      webMm: 5.5,
      flangeMm: 8,
      lipMm: null,
      sheetWidthMm: null,
      sheetLengthMm: null,
      specSortKey: '0200-0100',
      costBasis: 'erp_price_list',
      quoteEligible: true,
      materialBillingMode: 'whole_stock',
      cuttingFeePolicy: 'add_when_cut',
      pricingOptions: [
        {
          source: 'tier_price',
          quoteEligible: true,
          quoteUnit: '支',
          tierPrices,
          defaultQuoteTier: 'B',
          defaultQuoteUnitPrice: 102,
          fallbackTiers: ['D', 'E'],
          manualReviewRequired: true,
          manualReviewNotes: ['fallback price requires human review'],
        },
      ],
      skippedPricingOptions: [
        {
          source: 'price_ratio',
          status: 'skipped',
          reason: 'category rule pending',
        },
      ],
    };
    const fullResult: SteelToolResult = {
      ok: true,
      toolName: 'search_price_candidates',
      data: {
        queryResults: [
          {
            queryId: 'q1',
            query: { category: 'H型鋼', keyword: '200x100' },
            status: 'ok',
            candidates: [priceCandidate],
            productNames: [],
            totalAvailable: 1,
            returnedCount: 1,
            selectionRequired: false,
            categoryCandidates: [
              {
                category: 'H型鋼',
                material: 'SS400',
                candidateCount: 1,
                exampleErpItemCode: 'DNB2001',
                exampleProductName: 'H型鋼 200x100x5.5x8 L6000',
              },
            ],
            issues: ['human explanation'],
          },
          {
            queryId: 'q2',
            query: { category: '槽鐵' },
            status: 'no_match',
            candidates: [],
            productNames: [],
            totalAvailable: 0,
            returnedCount: 0,
            selectionRequired: false,
            categoryCandidates: [],
            issues: [],
          },
        ],
        cuttingPrices: [
          {
            cuttingCategory: '工字鐵/H型鋼',
            sourceCategories: ['H型鋼'],
            queryIds: ['q1'],
            candidateMatches: [
              {
                queryId: 'q1',
                priceCandidateId: 27,
                erpItemCode: 'DNB2001',
                specKey: 'DNB2001 H200x100x5.5x8 L6000',
                cuttingPriceIds: [91],
              },
            ],
            manualReviewRequired: true,
            manualReviewNotes: ['cutting price requires human review'],
            prices: [
              {
                id: 91,
                cuttingCategory: '工字鐵/H型鋼',
                itemName: 'H型鋼切斷',
                cutType: '鋸切',
                specText: 'H200x100',
                inchMin: null,
                inchMax: null,
                mmMin: null,
                mmMax: null,
                heightMm: 200,
                widthMm: 100,
                thicknessMmValues: [5.5, 8],
                thicknessMmMin: 5.5,
                thicknessMmMax: 8,
                unit: '刀',
                tierPrices: { A: 11, B: 12, C: 13, F: 16 },
                notes: 'human cutting note',
              },
            ],
          },
        ],
        processingPrice: {
          maxQueries: 3,
          queryResults: [
            {
              queryId: 'p1',
              targetCategories: ['H型鋼'],
              processingCategories: ['加工/切工'],
              targetSpecs: [{ queryId: 'q1', category: 'H型鋼' }],
              totalAvailable: 1,
              returnedCount: 1,
              selectionRequired: false,
              productNames: [],
              groups: [
                {
                  processingCategory: '加工/切工',
                  totalAvailable: 1,
                  items: [{ ...priceCandidate, matchedQueryIds: ['q1'] }],
                },
              ],
              availableByCategory: [{ processingCategory: '加工/切工', totalAvailable: 1 }],
              suggestedKeywords: ['human suggestion'],
            },
          ],
        },
        summary: {
          queryCount: 2,
          matchedQueryCount: 1,
          noMatchQueryCount: 1,
        },
      },
      sourceRefs: [],
      durationMs: 41,
      redactionVersion: 1,
    };
    const execute = jest.fn(
      async (_input: Parameters<SteelNativeToolExecute>[0]): Promise<SteelToolResult> => fullResult,
    );
    const tool = createSteelNativeTool({
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
      execute,
    });

    const result = await tool.invoke({ queries: [] });
    const content = JSON.parse(result.content) as {
      ok: true;
      toolName: 'search_price_candidates';
      data: {
        queryResults: SteelToolJsonObject[];
        cuttingPrices: SteelToolJsonObject[];
        processingPrice: { queryResults: SteelToolJsonObject[] };
      };
    };

    expect(content).toEqual(
      expect.objectContaining({ ok: true, toolName: 'search_price_candidates' }),
    );
    expect(Object.keys(content)).toEqual(['ok', 'toolName', 'data']);
    expect(content.data.queryResults).toEqual([
      expect.objectContaining({
        queryId: 'q1',
        status: 'ok',
        totalAvailable: 1,
        returnedCount: 1,
        selectionRequired: false,
        productNames: [],
        categoryCandidates: [
          {
            category: 'H型鋼',
            material: 'SS400',
            candidateCount: 1,
            exampleErpItemCode: 'DNB2001',
            exampleProductName: 'H型鋼 200x100x5.5x8 L6000',
          },
        ],
        candidates: [
          expect.objectContaining({
            erpItemCode: 'DNB2001',
            productName: 'H型鋼 200x100x5.5x8 L6000',
            category: 'H型鋼',
            material: 'SS400',
            unit: '支',
            formulaCode: 'DA',
            unitWeightValue: 128.4,
            density: 7.85,
            lengthMm: 6000,
            quoteEligible: true,
            pricingOptions: [
              {
                source: 'tier_price',
                quoteEligible: true,
                quoteUnit: '支',
                tierPrices,
                defaultQuoteTier: 'B',
                defaultQuoteUnitPrice: 102,
                fallbackTiers: ['D', 'E'],
              },
            ],
          }),
        ],
      }),
      expect.objectContaining({
        queryId: 'q2',
        status: 'no_match',
        totalAvailable: 0,
        returnedCount: 0,
        candidates: [],
      }),
    ]);
    expect(content.data.cuttingPrices).toEqual([
      {
        cuttingCategory: '工字鐵/H型鋼',
        sourceCategories: ['H型鋼'],
        queryIds: ['q1'],
        prices: [
          {
            cuttingCategory: '工字鐵/H型鋼',
            itemName: 'H型鋼切斷',
            cutType: '鋸切',
            specText: 'H200x100',
            heightMm: 200,
            widthMm: 100,
            thicknessMmValues: [5.5, 8],
            thicknessMmMin: 5.5,
            thicknessMmMax: 8,
            unit: '刀',
            tierPrices: { A: 11, B: 12, C: 13, F: 16 },
          },
        ],
      },
    ]);
    expect(content.data.processingPrice.queryResults).toEqual([
      expect.objectContaining({
        queryId: 'p1',
        totalAvailable: 1,
        returnedCount: 1,
        groups: [
          expect.objectContaining({
            processingCategory: '加工/切工',
            items: [expect.objectContaining({ erpItemCode: 'DNB2001', matchedQueryIds: ['q1'] })],
          }),
        ],
      }),
    ]);
    expect(result.content).not.toContain('manualReviewNotes');
    expect(result.content).not.toContain('manualReviewRequired');
    expect(result.content).not.toContain('specKey');
    expect(result.content).not.toContain('unitWeightBasis');
    expect(result.content).not.toContain('skippedPricingOptions');
    expect(result.content).not.toContain('candidateMatches');
    expect(result.content).not.toContain('human');
    expect(result.content).not.toContain('sourceRefs');
    expect(result.content).not.toContain('durationMs');
    expect(result.content).not.toContain('redactionVersion');
    expect(result.content.length).toBeLessThan(JSON.stringify(fullResult).length * 0.75);
    expect(result.artifact?.result).toBe(fullResult);
  });

  it('compacts exact product-name price results', async () => {
    const fullResult: SteelToolResult = {
      ok: true,
      toolName: 'search_price_candidates',
      data: {
        productNames: ['方鐵 25mm'],
        productNamePrices: [
          {
            id: 12,
            erpItemCode: 'SQ25',
            productName: '方鐵 25mm',
            category: '方鐵',
            material: '黑鐵',
            unit: 'Kg',
            density: 7.85,
            widthMm: 25,
            quoteEligible: true,
            pricingOptions: [
              {
                quoteEligible: true,
                quoteUnit: 'Kg',
                tierPrices: { A: 30, B: 31 },
                manualReviewNotes: ['omit this prose'],
              },
            ],
          },
        ],
      },
      sourceRefs: [],
      durationMs: 10,
      redactionVersion: 1,
    };
    const tool = createSteelNativeTool({
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
      execute: async () => fullResult,
    });

    const result = await tool.invoke({ productNames: ['方鐵 25mm'] });

    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      toolName: 'search_price_candidates',
      data: {
        productNames: ['方鐵 25mm'],
        productNamePrices: [
          {
            erpItemCode: 'SQ25',
            productName: '方鐵 25mm',
            category: '方鐵',
            material: '黑鐵',
            unit: 'Kg',
            density: 7.85,
            widthMm: 25,
            quoteEligible: true,
            pricingOptions: [
              {
                quoteEligible: true,
                quoteUnit: 'Kg',
                tierPrices: { A: 30, B: 31 },
              },
            ],
          },
        ],
      },
    });
    expect(result.artifact?.result).toBe(fullResult);
  });

  it('leaves price lookup errors unchanged for the provider', async () => {
    const fullResult: SteelToolResult = {
      ok: false,
      toolName: 'search_price_candidates',
      errorCategory: 'invalid_arguments',
      errorSummary: 'queries are required',
      durationMs: 2,
      redactionVersion: 1,
    };
    const tool = createSteelNativeTool({
      nativeToolName: 'search_price_candidates',
      steelToolName: 'search_price_candidates',
      execute: async () => fullResult,
    });

    const result = await tool.invoke({});

    expect(JSON.parse(result.content)).toEqual(fullResult);
    expect(result.artifact?.result).toBe(fullResult);
  });

  it('resolves original and namespaced native tool names back to Steel provider tools', () => {
    expect(resolveSteelProviderToolName('search_customers')).toBe('search_customers');
    expect(resolveSteelProviderToolName('steel_search_customers')).toBe('search_customers');
    expect(resolveSteelProviderToolName('steel_lookup_quote_rules')).toBeUndefined();
    expect(resolveSteelProviderToolName('web_search')).toBeUndefined();
  });

  it('removes PaddleOCR while preserving Steel execution tools for OCR turns', () => {
    const result = stripSteelToolsForOcrTurn({
      tools: [
        { name: 'search_customers' },
        { name: 'search_price_candidates' },
        { name: 'delegate_ocr' },
        { name: 'paddleocr_vl---PaddleOCR' },
        { name: 'web_search' },
      ],
      toolDefinitions: [
        { name: 'search_customers', description: '', parameters: {} },
        { name: 'search_price_candidates', description: '', parameters: {} },
        { name: 'delegate_ocr', description: '', parameters: {} },
        { name: 'paddleocr_vl---PaddleOCR', description: '', parameters: {} },
        { name: 'web_search', description: '', parameters: {} },
      ],
      toolRegistry: new Map([
        ['search_customers', { name: 'search_customers' }],
        ['search_price_candidates', { name: 'search_price_candidates' }],
        ['delegate_ocr', { name: 'delegate_ocr' }],
        ['paddleocr_vl---PaddleOCR', { name: 'paddleocr_vl---PaddleOCR' }],
        ['web_search', { name: 'web_search' }],
      ]),
    });

    expect(result.tools?.map((tool) => (typeof tool === 'string' ? tool : tool?.name))).toEqual([
      'search_customers',
      'search_price_candidates',
      'delegate_ocr',
      'web_search',
    ]);
    expect(result.toolDefinitions?.map((tool) => tool.name)).toEqual([
      'search_customers',
      'search_price_candidates',
      'delegate_ocr',
      'web_search',
    ]);
    expect([...result.toolRegistry?.keys() ?? []]).toEqual([
      'search_customers',
      'search_price_candidates',
      'delegate_ocr',
      'web_search',
    ]);
  });

  it('removes PaddleOCR from a standard main agent without removing Steel tools', () => {
    const result = stripPaddleOcrToolsForMainAgent({
      tools: ['search_customers', 'delegate_ocr', 'paddleocr_vl---PaddleOCR', 'web_search'],
      toolDefinitions: [
        { name: 'search_customers', description: '', parameters: {} },
        { name: 'delegate_ocr', description: '', parameters: {} },
        { name: 'paddleocr_vl---PaddleOCR', description: '', parameters: {} },
      ],
    });

    expect(result.tools).toEqual(['search_customers', 'delegate_ocr', 'web_search']);
    expect(result.toolDefinitions?.map((tool) => tool.name)).toEqual([
      'search_customers',
      'delegate_ocr',
    ]);
  });

  it.each([
    {
      name: 'standard turns remove PaddleOCR and retain Steel tools',
      options: {},
      expected: ['search_customers', 'search_price_candidates', 'delegate_ocr', 'web_search'],
    },
    {
      name: 'OCR turns remove PaddleOCR while retaining all Steel tools',
      options: { ocrTurnActive: true },
      expected: ['search_customers', 'search_price_candidates', 'delegate_ocr', 'web_search'],
    },
    {
      name: 'preflight turns retain PaddleOCR and Steel tools',
      options: { allowPaddleOcr: true },
      expected: [
        'search_customers',
        'search_price_candidates',
        'delegate_ocr',
        'paddleocr_vl---PaddleOCR',
        'web_search',
      ],
    },
    {
      name: 'OCR preflight turns retain PaddleOCR and all Steel tools',
      options: { ocrTurnActive: true, allowPaddleOcr: true },
      expected: [
        'search_customers',
        'search_price_candidates',
        'delegate_ocr',
        'paddleocr_vl---PaddleOCR',
        'web_search',
      ],
    },
    {
      name: 'quote-only turns remove delegate OCR across native config collections',
      options: { excludeDelegateOcr: true },
      expected: ['search_customers', 'search_price_candidates', 'web_search'],
    },
  ])('$name across native config collections', ({ options, expected }) => {
    const paddleTool = { name: 'paddleocr_vl---PaddleOCR', description: '', parameters: {} };
    const steelCustomerTool = { name: 'search_customers', description: '', parameters: {} };
    const steelPriceTool = { name: 'search_price_candidates', description: '', parameters: {} };
    const delegateTool = { name: 'delegate_ocr', description: '', parameters: {} };
    const webTool = { name: 'web_search', description: '', parameters: {} };
    const result = prepareSteelNativeToolConfig(
      {
        tools: [steelCustomerTool, steelPriceTool, delegateTool, paddleTool, 'web_search'],
        toolDefinitions: [steelCustomerTool, steelPriceTool, delegateTool, paddleTool, webTool],
        toolRegistry: new Map([
          [steelCustomerTool.name, steelCustomerTool],
          [steelPriceTool.name, steelPriceTool],
          [delegateTool.name, delegateTool],
          [paddleTool.name, paddleTool],
          [webTool.name, webTool],
        ]),
      },
      options,
    );

    expect(result.tools?.map((tool) => (typeof tool === 'string' ? tool : tool?.name))).toEqual(
      expected,
    );
    expect(result.toolDefinitions?.map((tool) => tool.name)).toEqual(expected);
    expect([...result.toolRegistry?.keys() ?? []]).toEqual(expected);
  });
});
