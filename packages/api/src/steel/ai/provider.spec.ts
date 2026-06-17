import { sendSteelOAuthChat } from './provider';

import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';
import type { SteelRepositoryClient, SteelSqlParameter } from '../repositories';

interface QueryCall {
  sql: string;
  values?: readonly SteelSqlParameter[];
}

interface AgentRuleRowFixture {
  id: string;
  slug: string;
  version: string;
  rule_type: string;
  title: string;
  locale: string;
  rule_sections: string[];
  sheet_id: string | null;
  selectors: object;
  prompt: string;
  tool_policy: object;
  output_policy: object;
  priority: string;
  confidence: string;
  active: boolean;
  review_state: string;
  source_refs: object[];
}

function isStringArray(value: SteelSqlParameter | undefined): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function createAgentRulesClient(
  rows: AgentRuleRowFixture[],
): SteelRepositoryClient & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];

  return {
    calls,
    query: async <Row extends object>(
      sql: string,
      values?: readonly SteelSqlParameter[],
    ): Promise<{ rows: Row[] }> => {
      calls.push({ sql, values });

      let filteredRows = rows;
      const reviewState = typeof values?.[0] === 'string' ? values[0] : undefined;
      if (reviewState) {
        filteredRows = filteredRows.filter((row) => row.review_state === reviewState);
      }

      if (sql.includes('active = true')) {
        filteredRows = filteredRows.filter((row) => row.active);
      }

      if (sql.includes('rule_type = ANY')) {
        const ruleTypes = values?.find(isStringArray) ?? [];
        filteredRows = filteredRows.filter((row) => ruleTypes.includes(row.rule_type));
      }

      if (sql.includes('rule_sections &&')) {
        const stringArrayValues = values?.filter(isStringArray) ?? [];
        const ruleSections = sql.includes('rule_type = ANY')
          ? (stringArrayValues[1] ?? [])
          : (stringArrayValues[0] ?? []);
        filteredRows = filteredRows.filter((row) =>
          row.rule_sections.some((section) => ruleSections.includes(section)),
        );
      }

      const limitValue = values?.[values.length - 1];
      const limit = typeof limitValue === 'number' ? limitValue : filteredRows.length;

      return { rows: filteredRows.slice(0, limit) as Row[] };
    },
  };
}

function createAgentRuleRow(prompt: string): AgentRuleRowFixture {
  return {
    id: '1',
    slug: 'steel-default-agent-instruction',
    version: '1',
    rule_type: 'agent_instruction_rule',
    title: 'Steel default agent instruction',
    locale: 'zh-TW',
    rule_sections: ['agent_instruction', 'tool_flow', 'inference_order', 'confirmation_policy'],
    sheet_id: null,
    selectors: { appliesTo: ['steel_quote_runtime'], locale: 'zh-TW' },
    prompt,
    tool_policy: { availableTools: ['lookup_quote_rules', 'run_file_ocr'] },
    output_policy: { answerLanguage: 'zh-TW' },
    priority: '10',
    confidence: 'high',
    active: true,
    review_state: 'reviewed',
    source_refs: [
      {
        channel: 'admin_table_ui',
        factType: 'agent_rule',
        locator: 'steel.agent_rules:1',
        canonicalKey: 'agent_default_instruction_zh_tw',
      },
    ],
  };
}

function createWorkbookRuleRow(prompt: string): AgentRuleRowFixture {
  return {
    ...createAgentRuleRow(prompt),
    id: '2',
    slug: 'steel-workbook-output-policy',
    rule_type: 'workbook_output_rule',
    title: 'Steel workbook output policy',
    rule_sections: ['workbook_output', 'workbook_patch', 'system_order'],
    selectors: { appliesTo: ['steel_quote_workbook'], locale: 'zh-TW' },
    tool_policy: { availableTools: ['patch_quote_workbook'] },
  };
}

function createOcrRuleRow(prompt: string): AgentRuleRowFixture {
  return {
    ...createAgentRuleRow(prompt),
    id: '3',
    slug: 'steel-drawing-ocr-policy',
    rule_type: 'inference_order_rule',
    title: 'Steel OCR policy',
    rule_sections: ['file_ocr', 'drawing_ocr', 'vision_evidence'],
    selectors: { sourceKinds: ['image', 'pdf', 'scanned_pdf'], requiresDrawingOcr: true },
    tool_policy: { requiredBefore: ['drawing_evidence_extraction'] },
  };
}

function createVisionRuleRow(prompt: string): AgentRuleRowFixture {
  return {
    ...createAgentRuleRow(prompt),
    id: '4',
    slug: 'steel-visual-inspection-policy',
    rule_type: 'tool_flow_rule',
    title: 'Steel visual inspection policy',
    rule_sections: ['visual_inspection', 'drawing_vision', 'tool_flow'],
    selectors: { sourceKinds: ['image', 'pdf', 'scanned_pdf'], requiresVisualInspection: true },
    tool_policy: { availableTools: ['run_visual_inspection', 'patch_file_analysis_data'] },
  };
}

function createMockOpenAIOAuth(doGenerate: jest.Mock) {
  return jest.fn(() => {
    const modelFactory = () =>
      ({
        specificationVersion: 'v3' as const,
        provider: 'openai.responses',
        modelId: 'gpt-5.5',
        supportedUrls: {},
        doGenerate,
      }) as unknown as LanguageModelV3;

    return modelFactory as unknown as ReturnType<typeof createOpenAIOAuthType>;
  }) as unknown as typeof createOpenAIOAuthType;
}

const defaultAgentRulePrompt = [
  'DB_AGENT_RULE_SENTINEL',
  'fixture:agent-rule-line-1',
  'fixture:agent-rule-line-2',
].join('\n');

const steelBusinessToolNames = [
  'lookup_quote_rules',
  'search_customers',
  'search_price_candidates',
  'run_file_ocr',
] as const;

describe('Steel OpenAI OAuth provider adapter', () => {
  it('answers price turns without workbook/file-analysis tools or required price-loop gating', async () => {
    const agentRulesClient = createAgentRulesClient([
      createAgentRuleRow(defaultAgentRulePrompt),
      createWorkbookRuleRow('DB_WORKBOOK_RULE_SENTINEL'),
      createOcrRuleRow('OCR_RULE_SENTINEL'),
      createVisionRuleRow('VISION_RULE_SENTINEL'),
    ]);
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: '| 項目 | 金額 |\n| --- | --- |\n| PL6*80 | 待查 |' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
      response: { id: 'resp_single_shot_table' },
      warnings: [],
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'PL6*80 多少錢？請直接用表格回答。' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient,
      steelToolMaxCalls: 1,
    });

    expect(response.text).toContain('| 項目 | 金額 |');
    expect(doGenerate).toHaveBeenCalledTimes(1);
    const firstGenerateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(firstGenerateOptions.toolChoice).toEqual({ type: 'auto' });
    expect(firstGenerateOptions.tools?.map((tool) => tool.name)).toEqual(steelBusinessToolNames);
    expect(firstGenerateOptions.tools?.map((tool) => tool.name)).not.toContain(
      'lookup_catalog_families',
    );
    expect(firstGenerateOptions.tools?.map((tool) => tool.name)).not.toContain(
      'patch_quote_workbook',
    );
    expect(firstGenerateOptions.tools?.map((tool) => tool.name)).not.toContain(
      'patch_file_analysis_data',
    );
    const systemPrompt = firstGenerateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt.content).toContain('DB_AGENT_RULE_SENTINEL');
    expect(systemPrompt.content).not.toContain('DB_WORKBOOK_RULE_SENTINEL');
    expect(systemPrompt.content).not.toContain('OCR_RULE_SENTINEL');
    expect(systemPrompt.content).not.toContain('VISION_RULE_SENTINEL');
  });

  it('keeps the ordinary AI-led business tool loop', async () => {
    const doGenerate = jest
      .fn()
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_lookup_rules',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({ keywords: ['C 型鋼', 'C75'] }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
        response: { id: 'resp_business_tool_1' },
        warnings: [],
      }))
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [{ type: 'text', text: '已依查詢結果回覆。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 12 }, outputTokens: { total: 4 } },
        response: { id: 'resp_business_tool_2' },
        warnings: [],
      }));
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'lookup_quote_rules',
      data: { instructionPacketGroups: [] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '查 C 型鋼規則後回答。' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createAgentRulesClient([createAgentRuleRow(defaultAgentRulePrompt)]),
    });

    expect(response.text).toBe('已依查詢結果回覆。');
    expect(doGenerate).toHaveBeenCalledTimes(2);
    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'lookup_quote_rules',
        providerToolCallId: 'call_lookup_rules',
      }),
    );
  });

  it('does not batch same-round price tool calls when customer tiers differ', async () => {
    const doGenerate = jest
      .fn()
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_price_b',
            toolName: 'search_price_candidates',
            input: JSON.stringify({ candidateQueries: ['DNB70060'], limit: 5 }),
          },
          {
            type: 'tool-call',
            toolCallId: 'call_price_custom',
            toolName: 'search_price_candidates',
            input: JSON.stringify({ candidateQueries: ['DNB70060'], customerTierId: 5, limit: 5 }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
        response: { id: 'resp_price_tiers_1' },
        warnings: [],
      }))
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [{ type: 'text', text: '已依不同 tier 查詢結果回覆。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 12 }, outputTokens: { total: 4 } },
        response: { id: 'resp_price_tiers_2' },
        warnings: [],
      }));
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'search_price_candidates',
      data: { priceCandidates: [] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '用不同客戶 tier 查 DNB70060。' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createAgentRulesClient([createAgentRuleRow(defaultAgentRulePrompt)]),
    });

    expect(executeSteelToolCall).toHaveBeenCalledTimes(2);
    expect(executeSteelToolCall).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        providerToolCallId: 'call_price_b',
        arguments: { candidateQueries: ['DNB70060'], limit: 5 },
      }),
    );
    expect(executeSteelToolCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        providerToolCallId: 'call_price_custom',
        arguments: { candidateQueries: ['DNB70060'], customerTierId: 5, limit: 5 },
      }),
    );
  });

  it('applies a uniquely discovered customer tier to later price lookup calls', async () => {
    const doGenerate = jest
      .fn()
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_customer',
            toolName: 'search_customers',
            input: JSON.stringify({ keywords: ['大成'] }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
        response: { id: 'resp_customer_1' },
        warnings: [],
      }))
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_price',
            toolName: 'search_price_candidates',
            input: JSON.stringify({ candidateQueries: ['CCG075'], limit: 5 }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: { inputTokens: { total: 12 }, outputTokens: { total: 6 } },
        response: { id: 'resp_customer_2' },
        warnings: [],
      }))
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [{ type: 'text', text: '已用客戶 tier 查價。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 14 }, outputTokens: { total: 4 } },
        response: { id: 'resp_customer_3' },
        warnings: [],
      }));
    const executeSteelToolCall = jest.fn(async (options) => {
      if (options.toolName === 'search_customers') {
        return {
          ok: true as const,
          toolName: 'search_customers' as const,
          data: {
            customers: [
              {
                id: 8,
                displayName: '大成',
                customerTier: { id: 5, code: 'C', name: 'C tier' },
              },
            ],
          },
          sourceRefs: [],
          durationMs: 1,
          redactionVersion: 1 as const,
        };
      }

      return {
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: { priceCandidates: [] },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      };
    });

    await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '大成 CCG075 報價。' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createAgentRulesClient([createAgentRuleRow(defaultAgentRulePrompt)]),
    });

    expect(executeSteelToolCall).toHaveBeenLastCalledWith(
      expect.objectContaining({
        toolName: 'search_price_candidates',
        providerToolCallId: 'call_price',
        arguments: {
          candidateQueries: ['CCG075'],
          customerTierId: 5,
          limit: 5,
        },
      }),
    );
  });

  it('preserves prior Markdown table code and product name as price spec-key candidates', async () => {
    const doGenerate = jest
      .fn()
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_price_table',
            toolName: 'search_price_candidates',
            input: JSON.stringify({ candidateQueries: ['75x45x15x2.3'], limit: 5 }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
        response: { id: 'resp_table_1' },
        warnings: [],
      }))
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [{ type: 'text', text: '已保留前輪表格品項查價。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 12 }, outputTokens: { total: 4 } },
        response: { id: 'resp_table_2' },
        warnings: [],
      }));
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'search_price_candidates',
      data: { priceCandidates: [] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [
        {
          role: 'assistant',
          content: [
            '| 代號 | 品名規格 | 數量 |',
            '| --- | --- | --- |',
            '| CCG075 | 錏輕型鋼 75x45x15x2.3 | 1 |',
          ].join('\n'),
        },
        { role: 'user', content: '延續上表重新查價。' },
      ],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createAgentRulesClient([createAgentRuleRow(defaultAgentRulePrompt)]),
    });

    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'search_price_candidates',
        arguments: {
          candidateQueries: [
            '75x45x15x2.3',
            'CCG075_錏輕型鋼75x45x15x2.3',
          ],
          limit: 5,
        },
      }),
    );
  });

  it('returns neutral per-round provider timings', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'timed-ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
      response: { id: 'resp_timing' },
      warnings: [],
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'timing smoke' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      agentRulesClient: createAgentRulesClient([createAgentRuleRow(defaultAgentRulePrompt)]),
    });

    expect(response.timings).toEqual(
      expect.objectContaining({
        totalDurationMs: expect.any(Number),
        generationDurationMs: expect.any(Number),
        toolDurationMs: expect.any(Number),
        roundCount: 1,
        rounds: [
          expect.objectContaining({
            round: 0,
            generationDurationMs: expect.any(Number),
            toolDurationMs: expect.any(Number),
            promptMessageCount: expect.any(Number),
            generatedToolCallCount: 0,
          }),
        ],
      }),
    );
    expect(response.timings).not.toHaveProperty('workbookCompletionDurationMs');
    expect(response.timings?.rounds[0]).not.toHaveProperty('workbookPatchOperationCount');
    expect(response.timings?.rounds[0]).not.toHaveProperty('workbookCompletionRequired');
  });
});
