import {
  createSteelNativeTool,
  getNativeSteelToolName,
  mergeSteelToolDefinitions,
  resolveSteelProviderToolName,
  resolveNativeSteelToolName,
} from './tools';

import type { LCTool, LCToolRegistry } from '@librechat/agents';
import type { SteelNativeToolExecute } from './tools';
import type { SteelToolResult } from '../tools/results';

function getNames(tools: readonly LCTool[] | undefined): string[] {
  return tools?.map((tool) => tool.name) ?? [];
}

describe('Steel native tool adapter', () => {
  it('adds Steel compact workbook tools without removing existing user tools', () => {
    const existingTool: LCTool = {
      name: 'web_search',
      description: 'Existing web search',
      parameters: { type: 'object', properties: {} },
    };
    const registry: LCToolRegistry = new Map([[existingTool.name, existingTool]]);

    const result = mergeSteelToolDefinitions({
      toolDefinitions: [existingTool],
      toolRegistry: registry,
      contextMode: 'compact_workbook',
      aiVisibleTools: [
        'search_customers',
        'search_price_candidates',
        'run_file_ocr',
        'read_markdown',
      ],
    });

    expect(getNames(result.toolDefinitions)).toEqual([
      'web_search',
      'search_customers',
      'search_price_candidates',
      'run_file_ocr',
      'read_markdown',
    ]);
    expect(result.toolRegistry.get('web_search')).toBe(existingTool);
    expect(result.toolRegistry.get('read_markdown')).toEqual(
      expect.objectContaining({
        name: 'read_markdown',
        toolType: 'builtin',
      }),
    );
  });

  it('limits Steel tools to the runtime policy and omits compact-only workbook reads outside compact mode', () => {
    const result = mergeSteelToolDefinitions({
      contextMode: 'full',
      aiVisibleTools: ['search_customers', 'search_price_candidates', 'run_file_ocr'],
    });

    expect(getNames(result.toolDefinitions)).toEqual([
      'search_customers',
      'search_price_candidates',
      'run_file_ocr',
    ]);
    expect(result.toolRegistry.has('read_markdown')).toBe(false);
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
      contextMode: 'compact_workbook',
      aiVisibleTools: ['search_customers'],
    });

    expect(getNames(result.toolDefinitions)).toEqual(['search_customers', 'steel_search_customers']);
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
});
