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
import type { SteelToolResult } from '../tools/results';

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
    const parameters = mergeSteelToolDefinitions().toolDefinitions.map(
      (definition) => definition.parameters as JsonSchemaValue,
    );
    const exclusiveBounds = parameters.flatMap(collectExclusiveBounds);

    expect(exclusiveBounds.length).toBeGreaterThan(0);
    expect(exclusiveBounds.every((bound) => typeof bound === 'number')).toBe(true);
    expect(JSON.stringify(parameters)).not.toContain('"const":');
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

  it('resolves original and namespaced native tool names back to Steel provider tools', () => {
    expect(resolveSteelProviderToolName('search_customers')).toBe('search_customers');
    expect(resolveSteelProviderToolName('steel_search_customers')).toBe('search_customers');
    expect(resolveSteelProviderToolName('steel_lookup_quote_rules')).toBeUndefined();
    expect(resolveSteelProviderToolName('web_search')).toBeUndefined();
  });

  it('removes Steel and PaddleOCR tools while preserving unrelated tools for OCR turns', () => {
    const result = stripSteelToolsForOcrTurn({
      tools: [
        { name: 'search_customers' },
        { name: 'delegate_ocr' },
        { name: 'paddleocr_vl---PaddleOCR' },
        { name: 'web_search' },
      ],
      toolDefinitions: [
        { name: 'search_price_candidates', description: '', parameters: {} },
        { name: 'delegate_ocr', description: '', parameters: {} },
        { name: 'paddleocr_vl---PaddleOCR', description: '', parameters: {} },
        { name: 'web_search', description: '', parameters: {} },
      ],
      toolRegistry: new Map([
        ['search_customers', { name: 'search_customers' }],
        ['delegate_ocr', { name: 'delegate_ocr' }],
        ['paddleocr_vl---PaddleOCR', { name: 'paddleocr_vl---PaddleOCR' }],
        ['web_search', { name: 'web_search' }],
      ]),
    });

    expect(result.tools?.map((tool) => (typeof tool === 'string' ? tool : tool?.name))).toEqual([
      'web_search',
    ]);
    expect(result.toolDefinitions?.map((tool) => tool.name)).toEqual(['web_search']);
    expect([...result.toolRegistry?.keys() ?? []]).toEqual(['web_search']);
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
      expected: ['search_customers', 'delegate_ocr', 'web_search'],
    },
    {
      name: 'OCR turns remove PaddleOCR and Steel tools',
      options: { ocrTurnActive: true },
      expected: ['web_search'],
    },
    {
      name: 'preflight turns retain PaddleOCR and Steel tools',
      options: { allowPaddleOcr: true },
      expected: [
        'search_customers',
        'delegate_ocr',
        'paddleocr_vl---PaddleOCR',
        'web_search',
      ],
    },
    {
      name: 'OCR preflight turns retain PaddleOCR while removing Steel tools',
      options: { ocrTurnActive: true, allowPaddleOcr: true },
      expected: ['paddleocr_vl---PaddleOCR', 'web_search'],
    },
  ])('$name across native config collections', ({ options, expected }) => {
    const paddleTool = { name: 'paddleocr_vl---PaddleOCR', description: '', parameters: {} };
    const steelTool = { name: 'search_customers', description: '', parameters: {} };
    const delegateTool = { name: 'delegate_ocr', description: '', parameters: {} };
    const webTool = { name: 'web_search', description: '', parameters: {} };
    const result = prepareSteelNativeToolConfig(
      {
        tools: [steelTool, delegateTool, paddleTool, 'web_search'],
        toolDefinitions: [steelTool, delegateTool, paddleTool, webTool],
        toolRegistry: new Map([
          [steelTool.name, steelTool],
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
