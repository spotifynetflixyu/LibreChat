import { sendSteelOAuthChat, type SteelProviderToolExecutor } from './provider';

import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3,
} from '@ai-sdk/provider';
import type { SteelRepositoryClient, SteelSqlParameter } from '../repositories';
import type { SteelRuntimeContext } from '../runtime/context';
import type { SteelToolJsonValue, SteelToolResult } from '../tools/results';

interface SearchPriceCandidatesInputFixture {
  queries: SteelToolJsonValue[];
}

interface ToolResultPartFixture {
  type: 'tool-result';
  toolCallId: string;
  output: { value: SteelToolResult };
}

interface ToolMessageFixture {
  role: 'tool';
  content: ToolResultPartFixture[];
}

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
    tool_policy: {
      availableTools: ['search_customers', 'search_price_candidates', 'run_file_ocr'],
    },
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

function createMockStreamingOpenAIOAuth({
  doGenerate,
  doStream,
}: {
  doGenerate: jest.Mock;
  doStream: jest.Mock;
}) {
  return jest.fn(() => {
    const modelFactory = () =>
      ({
        specificationVersion: 'v3' as const,
        provider: 'openai.responses',
        modelId: 'gpt-5.5',
        supportedUrls: {},
        doGenerate,
        doStream,
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
  'search_customers',
  'search_price_candidates',
  'run_file_ocr',
  'read_markdown',
] as const;

function createProviderRuntimeContext({
  agentPrompt = defaultAgentRulePrompt,
  includeOcrRules = false,
  workbookPrompt,
}: {
  agentPrompt?: string;
  includeOcrRules?: boolean;
  workbookPrompt?: string;
} = {}): SteelRuntimeContext {
  const compactWorkbook = {
    sheets: {
      system_order: {
        sheetId: 'system_order' as const,
        rowCount: 1,
        rows: [
          {
            rowId: 'system_order:1',
            rowIndex: 1,
            anchors: {
              rowNo: 1,
              erpItemCode: 'CCG075',
            },
          },
        ],
      },
      customer_data: {
        sheetId: 'customer_data' as const,
        rowCount: 1,
        rows: [
          {
            rowId: 'customer_data:1',
            rowIndex: 1,
            anchors: {
              customerTier: 'B',
            },
          },
        ],
      },
      manual_review: {
        sheetId: 'manual_review' as const,
        rowCount: 0,
        rows: [],
      },
      customer_quote: {
        sheetId: 'customer_quote' as const,
        rowCount: 1,
        rows: [
          {
            rowId: 'customer_quote:1',
            rowIndex: 1,
            anchors: {
              rowNo: 1,
              subtotal: 536,
            },
          },
        ],
      },
    },
    unresolvedCount: 0,
  };
  const workbookRule = workbookPrompt
    ? [
        {
          id: 2,
          slug: 'steel-workbook-output-policy',
          version: 1,
          ruleType: 'workbook_output_rule',
          title: 'Steel workbook output policy',
          locale: 'zh-TW',
          ruleSections: ['workbook_output'],
          selectors: { appliesTo: ['steel_quote_runtime'] },
          prompt: workbookPrompt,
          toolPolicy: {},
          outputPolicy: {
            defaultCustomerTierWhenUncertain: 'B',
            synchronizedSheetsOnCustomerTierChange: ['system_order', 'customer_quote'],
          },
          priority: 20,
          confidence: 'high',
          active: true,
          reviewState: 'reviewed' as const,
          sourceRefs: [],
        },
      ]
    : [];
  const ocrRules = includeOcrRules
    ? [
        {
          id: 3,
          slug: 'steel-drawing-ocr-policy',
          version: 1,
          ruleType: 'inference_order_rule',
          title: 'Steel OCR policy',
          locale: 'zh-TW',
          ruleSections: ['file_ocr'],
          selectors: { sourceKinds: ['image', 'pdf'] },
          prompt: 'OCR_RULE_SENTINEL',
          toolPolicy: {},
          outputPolicy: null,
          priority: 30,
          confidence: 'high',
          active: true,
          reviewState: 'reviewed' as const,
          sourceRefs: [],
        },
      ]
    : undefined;

  return {
    conversation: {
      conversationId: 'steel_conversation_1',
      requestId: 'request_1',
      activeHistory: [{ role: 'user', content: 'runtime context request' }],
      currentUserTurn: { role: 'user', content: 'runtime context request' },
    },
    rules: {
      agentRules: [
        {
          id: 1,
          slug: 'steel-default-agent-instruction',
          version: 1,
          ruleType: 'agent_instruction_rule',
          title: 'Steel default agent instruction',
          locale: 'zh-TW',
          ruleSections: ['agent_instruction'],
          selectors: { appliesTo: ['steel_quote_runtime'] },
          prompt: agentPrompt,
          toolPolicy: { availableTools: ['search_customers'] },
          outputPolicy: null,
          priority: 10,
          confidence: 'high',
          active: true,
          reviewState: 'reviewed',
          sourceRefs: [],
        },
      ],
      steelGlobalRules: {
        instructionPackets: [],
        quoteDefaults: [],
        quoteRules: [
          {
            id: 31,
            ruleType: 'formula_rule',
            scopeType: 'catalog_family',
            catalogFamily: 'plate',
            productFamily: undefined,
            chargeType: undefined,
            formulaCode: undefined,
            selectors: { catalogFamily: 'plate' },
            parameters: {},
            prompt: 'QUOTE_RULE_SENTINEL',
            priority: 40,
            confidence: 'high',
            active: true,
            reviewState: 'reviewed',
            sourceRefs: [],
          },
        ],
        groupedBy: {
          packetGroups: [],
          catalogFamilies: ['plate'],
          productFamilies: [],
          chargeTypes: [],
          formulaCodes: [],
          quoteRuleTypes: ['formula_rule'],
          quoteDefaultTypes: [],
        },
      },
      outputRules: workbookRule,
      otherGlobalRules: {
        ocrRules,
        fileRules: [],
        sourcePriorityRules: [],
        markdownOutputRules: [],
      },
    },
      outputSheets: {
        activeOnly: true,
        contextMode: 'compact_workbook',
      memoryName: 'Output Sheet Memory',
      contextName: 'Runtime Output Sheet Context',
      conversationId: 'steel_conversation_1',
      sheetIds: ['system_order', 'customer_data', 'manual_review', 'customer_quote'],
      previousOutputSheets: {
        system_order: {
          sheetId: 'system_order',
          rows: [
            {
              rowId: 'system_order:1',
              cells: {
                rowNo: 1,
                erpItemCode: 'CCG075',
              },
            },
          ],
        },
        customer_data: {
          sheetId: 'customer_data',
          rows: [
            {
              rowId: 'customer_data:1',
              cells: {
                customerTier: 'B',
              },
            },
          ],
        },
        manual_review: {
          sheetId: 'manual_review',
          rows: [],
        },
        customer_quote: {
          sheetId: 'customer_quote',
          rows: [
            {
              rowId: 'customer_quote:1',
              cells: {
                rowNo: 1,
                subtotal: 536,
              },
            },
          ],
        },
      },
      derivedIndex: {
        lineItems: [{ rowNo: 1, erpItemCode: 'CCG075' }],
        customers: [{ customerTier: 'B' }],
        adoptedPrices: [],
        calculations: [{ rowNo: 1, subtotal: 536 }],
        ocrExtracts: [],
        unresolvedItems: [],
      },
      compactWorkbook,
    },
    attachments: {
      currentTurnFiles: [],
      priorActiveFileEvidence: [],
      includeOcrRules: includeOcrRules,
    },
    toolPolicy: {
      aiVisibleTools: [
        'search_customers',
        'search_price_candidates',
        'run_file_ocr',
        'read_markdown',
      ],
      removedTools: [],
      ocrCorrectionPolicy: 'Do not rerun OCR for user corrections.',
      readMarkdownUsagePolicy: {
        requiresMissingMarkdownInHistory: true,
        forbiddenWhenHistoryHasNeededMarkdown: true,
        allowedScopes: ['workbook', 'ocr'],
        currentConversationScoped: true,
      },
    },
  };
}

describe('OpenAI OAuth provider adapter', () => {
  it('uses provider doStream for live text deltas when streaming callbacks are provided', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_1' });
        controller.enqueue({ type: 'text-start', id: 'txt_1' });
        controller.enqueue({ type: 'text-delta', id: 'txt_1', delta: '即時' });
        controller.enqueue({ type: 'text-delta', id: 'txt_1', delta: '回覆' });
        controller.enqueue({ type: 'text-end', id: 'txt_1' });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 7 }, outputTokens: { total: 3 } },
        });
        controller.close();
      },
    });
    const doGenerate = jest.fn();
    const doStream = jest.fn(async (_options: LanguageModelV3CallOptions) => ({ stream }));
    const onTextDelta = jest.fn();

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth: createMockStreamingOpenAIOAuth({ doGenerate, doStream }),
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'stream smoke' }],
      onTextDelta,
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      steelRuntimeContext: createProviderRuntimeContext(),
    });

    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
    expect(onTextDelta).toHaveBeenCalledWith('即時');
    expect(onTextDelta).toHaveBeenCalledWith('回覆');
    expect(response).toEqual(
      expect.objectContaining({
        text: '即時回覆',
        responseId: 'resp_stream_1',
      }),
    );
  });

  it('continues to a second provider stream after streamed tool-call results', async () => {
    const firstStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_tool_1' });
        controller.enqueue({
          type: 'tool-call',
          toolCallId: 'call_customer_stream',
          toolName: 'search_customers',
          input: JSON.stringify({ keywords: ['大成'] }),
        });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
          usage: { inputTokens: { total: 11 }, outputTokens: { total: 3 } },
        });
        controller.close();
      },
    });
    const secondStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_tool_2' });
        controller.enqueue({ type: 'text-start', id: 'txt_2' });
        controller.enqueue({ type: 'text-delta', id: 'txt_2', delta: '工具後' });
        controller.enqueue({ type: 'text-delta', id: 'txt_2', delta: '回覆' });
        controller.enqueue({ type: 'text-end', id: 'txt_2' });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 13 }, outputTokens: { total: 4 } },
        });
        controller.close();
      },
    });
    const doGenerate = jest.fn();
    const doStream = jest
      .fn()
      .mockResolvedValueOnce({ stream: firstStream })
      .mockResolvedValueOnce({ stream: secondStream });
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'search_customers',
      data: { customers: [{ displayName: '大成鋼鐵', erpCustomerCode: 'A001' }] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const onTextDelta = jest.fn();

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth: createMockStreamingOpenAIOAuth({ doGenerate, doStream }),
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'stream tool loop' }],
      onTextDelta,
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      steelRuntimeContext: createProviderRuntimeContext(),
    });

    expect(doStream).toHaveBeenCalledTimes(2);
    expect(doGenerate).not.toHaveBeenCalled();
    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'search_customers',
        providerToolCallId: 'call_customer_stream',
      }),
    );
    expect(onTextDelta).toHaveBeenCalledWith('工具後');
    expect(onTextDelta).toHaveBeenCalledWith('回覆');
    expect(response).toEqual(
      expect.objectContaining({
        text: '工具後回覆',
        responseId: 'resp_stream_tool_2',
      }),
    );
  });

  it('reports provider round progress while a post-tool final stream is still generating', async () => {
    const firstStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_round_progress_1' });
        controller.enqueue({
          type: 'tool-call',
          toolCallId: 'call_round_progress_price',
          toolName: 'search_price_candidates',
          input: JSON.stringify({
            queries: [{ category: '鐵板/鋼板', material: '黑鐵', thicknessMm: ['15'] }],
          }),
        });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
          usage: { inputTokens: { total: 11 }, outputTokens: { total: 3 } },
        });
        controller.close();
      },
    });
    const secondStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_round_progress_2' });
        setTimeout(() => {
          controller.enqueue({ type: 'text-start', id: 'txt_round_progress' });
          controller.enqueue({
            type: 'text-delta',
            id: 'txt_round_progress',
            delta: 'final-ok',
          });
          controller.enqueue({ type: 'text-end', id: 'txt_round_progress' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: { inputTokens: { total: 13 }, outputTokens: { total: 2 } },
          });
          controller.close();
        }, 40);
      },
    });
    const doGenerate = jest.fn();
    const doStream = jest
      .fn()
      .mockResolvedValueOnce({ stream: firstStream })
      .mockResolvedValueOnce({ stream: secondStream });
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'search_price_candidates',
      data: { priceCandidates: [{ productName: '15.0m/mOT板雷射切割' }] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const onProviderRoundStatus = jest.fn();

    const responsePromise = sendSteelOAuthChat({
      createOpenAIOAuth: createMockStreamingOpenAIOAuth({ doGenerate, doStream }),
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'PL15 報價。' }],
      onProviderRoundStatus,
      onTextDelta: jest.fn(),
      providerRoundProgressIntervalMs: 5,
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      steelRuntimeContext: createProviderRuntimeContext(),
    } as Parameters<typeof sendSteelOAuthChat>[0] & {
      onProviderRoundStatus: jest.Mock;
      providerRoundProgressIntervalMs: number;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onProviderRoundStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        round: 1,
        status: 'started',
        message: expect.stringContaining('final response'),
      }),
    );
    expect(onProviderRoundStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        round: 1,
        status: 'waiting',
        elapsedMs: expect.any(Number),
        message: expect.stringContaining('elapsed'),
      }),
    );

    const response = await responsePromise;
    expect(response.text).toBe('final-ok');
  });

  it('preserves structured provider stream error details after streamed tool results', async () => {
    const providerErrorMessage = 'Provider rejected follow-up after PL.pdf OCR tool result.';
    const firstStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_tool_error_1' });
        controller.enqueue({
          type: 'tool-call',
          toolCallId: 'call_customer_stream_error',
          toolName: 'search_customers',
          input: JSON.stringify({ keywords: ['大成'] }),
        });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
          usage: { inputTokens: { total: 11 }, outputTokens: { total: 3 } },
        });
        controller.close();
      },
    });
    const secondStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_tool_error_2' });
        controller.enqueue({
          type: 'error',
          error: {
            error: {
              message: providerErrorMessage,
            },
          },
        });
        controller.close();
      },
    });
    const doGenerate = jest.fn();
    const doStream = jest
      .fn()
      .mockResolvedValueOnce({ stream: firstStream })
      .mockResolvedValueOnce({ stream: secondStream });
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'search_customers',
      data: { customers: [{ displayName: '大成鋼鐵', erpCustomerCode: 'A001' }] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth: createMockStreamingOpenAIOAuth({ doGenerate, doStream }),
        ensureFresh: false,
        executeSteelToolCall,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'stream tool loop' }],
        onTextDelta: jest.fn(),
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        steelRuntimeContext: createProviderRuntimeContext(),
      }),
    ).rejects.toThrow(providerErrorMessage);

    expect(doStream).toHaveBeenCalledTimes(2);
    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'search_customers',
        providerToolCallId: 'call_customer_stream_error',
      }),
    );
  });

  it('retries transient provider overloads after streamed tool results before failing the turn', async () => {
    const firstStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_retry_1' });
        controller.enqueue({
          type: 'tool-call',
          toolCallId: 'call_customer_stream_retry',
          toolName: 'search_customers',
          input: JSON.stringify({ keywords: ['大成'] }),
        });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
          usage: { inputTokens: { total: 11 }, outputTokens: { total: 3 } },
        });
        controller.close();
      },
    });
    const overloadedStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_retry_2' });
        controller.enqueue({
          type: 'error',
          error: {
            error: {
              message: 'Our servers are currently overloaded. Please try again later.',
            },
          },
        });
        controller.close();
      },
    });
    const retryStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_retry_3' });
        controller.enqueue({ type: 'text-start', id: 'txt_retry' });
        controller.enqueue({ type: 'text-delta', id: 'txt_retry', delta: 'retry-ok' });
        controller.enqueue({ type: 'text-end', id: 'txt_retry' });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 12 }, outputTokens: { total: 2 } },
        });
        controller.close();
      },
    });
    const doGenerate = jest.fn();
    const doStream = jest
      .fn()
      .mockResolvedValueOnce({ stream: firstStream })
      .mockResolvedValueOnce({ stream: overloadedStream })
      .mockResolvedValueOnce({ stream: retryStream });
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'search_customers',
      data: { customers: [{ displayName: '大成鋼鐵', erpCustomerCode: 'A001' }] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const onTextDelta = jest.fn();

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth: createMockStreamingOpenAIOAuth({ doGenerate, doStream }),
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'stream tool loop' }],
      onTextDelta,
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      steelRuntimeContext: createProviderRuntimeContext(),
    });

    expect(doStream).toHaveBeenCalledTimes(3);
    expect(executeSteelToolCall).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledWith('retry-ok');
    expect(response).toEqual(
      expect.objectContaining({
        text: 'retry-ok',
        responseId: 'resp_stream_retry_3',
      }),
    );
  });

  it('retries transient provider read ETIMEDOUT after streamed tool results', async () => {
    const firstStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_timeout_1' });
        controller.enqueue({
          type: 'tool-call',
          toolCallId: 'call_customer_timeout_retry',
          toolName: 'search_customers',
          input: JSON.stringify({ keywords: ['大成'] }),
        });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
          usage: { inputTokens: { total: 11 }, outputTokens: { total: 3 } },
        });
        controller.close();
      },
    });
    const retryStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: 'resp_stream_timeout_3' });
        controller.enqueue({ type: 'text-start', id: 'txt_timeout_retry' });
        controller.enqueue({ type: 'text-delta', id: 'txt_timeout_retry', delta: 'timeout-retry-ok' });
        controller.enqueue({ type: 'text-end', id: 'txt_timeout_retry' });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 12 }, outputTokens: { total: 2 } },
        });
        controller.close();
      },
    });
    const doGenerate = jest.fn();
    const doStream = jest
      .fn()
      .mockResolvedValueOnce({ stream: firstStream })
      .mockRejectedValueOnce(new Error('read ETIMEDOUT'))
      .mockResolvedValueOnce({ stream: retryStream });
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'search_customers',
      data: { customers: [{ displayName: '大成鋼鐵', erpCustomerCode: 'A001' }] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const onTextDelta = jest.fn();

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth: createMockStreamingOpenAIOAuth({ doGenerate, doStream }),
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'stream timeout tool loop' }],
      onTextDelta,
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      steelRuntimeContext: createProviderRuntimeContext(),
    });

    expect(doStream).toHaveBeenCalledTimes(3);
    expect(executeSteelToolCall).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledWith('timeout-retry-ok');
    expect(response).toEqual(
      expect.objectContaining({
        text: 'timeout-retry-ok',
        responseId: 'resp_stream_timeout_3',
      }),
    );
  });

  it('does not retry transient provider errors after the request aborts', async () => {
    const abortController = new AbortController();
    const doGenerate = jest.fn(async () => {
      abortController.abort();
      throw new Error('read ETIMEDOUT');
    });

    await expect(
      sendSteelOAuthChat({
        abortSignal: abortController.signal,
        createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
        ensureFresh: false,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'abort before retry' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        steelRuntimeContext: createProviderRuntimeContext(),
      }),
    ).rejects.toThrow('OpenAI OAuth provider request aborted.');

    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('answers price turns without workbook/file-analysis tools or required price-loop gating', async () => {
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
      steelRuntimeContext: createProviderRuntimeContext({
        workbookPrompt: 'DB_WORKBOOK_RULE_SENTINEL',
      }),
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
    expect(firstGenerateOptions.tools?.map((tool) => tool.name)).not.toContain(
      'save_working_order_items',
    );
    const systemPrompt = firstGenerateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt.content).toContain('DB_AGENT_RULE_SENTINEL');
    expect(systemPrompt.content).toContain('QUOTE_RULE_SENTINEL');
    expect(systemPrompt.content).toContain('DB_WORKBOOK_RULE_SENTINEL');
    expect(systemPrompt.content).toContain('Output Sheet Memory');
    expect(systemPrompt.content).toContain('CCG075');
    expect(systemPrompt.content).not.toContain('OCR_RULE_SENTINEL');
    expect(systemPrompt.content).not.toContain('VISION_RULE_SENTINEL');
  });

  it('always exposes read_markdown with the compact workbook runtime prompt', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 5 }, outputTokens: { total: 1 } },
      response: { id: 'resp_compact_tools' },
      warnings: [],
    }));

    await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '工具列表測試' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      steelRuntimeContext: createProviderRuntimeContext(),
      steelToolMaxCalls: 1,
    });

    const compactGenerateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;

    expect(compactGenerateOptions.tools?.map((tool) => tool.name)).toEqual([
      'search_customers',
      'search_price_candidates',
      'run_file_ocr',
      'read_markdown',
    ]);
    expect(JSON.stringify(compactGenerateOptions.prompt[0])).not.toContain(
      '"rows":[{"rowId":"system_order:1","cells"',
    );
  });

  it('uses provider-prepared runtime context as the Steel instruction source', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: '只使用 DB agent rule。' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
      response: { id: 'resp_agent_rule_only' },
      warnings: [],
    }));

    await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '測試 agent rule source。' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      steelRuntimeContext: createProviderRuntimeContext(),
      steelToolMaxCalls: 1,
    });

    const firstGenerateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    const systemPrompt = firstGenerateOptions.prompt[0] as { role: 'system'; content: string };

    expect(systemPrompt.content).toContain('Steel Runtime Context');
    expect(systemPrompt.content).toContain('DB_AGENT_RULE_SENTINEL');
    expect(systemPrompt.content).toContain('QUOTE_RULE_SENTINEL');
    expect(systemPrompt.content).toContain('Runtime Output Sheet Context');
    expect(systemPrompt.content).not.toContain('Do not wait for catalog-family lookup');
    expect(systemPrompt.content).not.toContain('Final quote, OCR, and file-analysis outputs');
  });

  it('places runtime context before persisted history and ignores compact memory summaries', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: '已讀取記憶後回覆。' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 9 }, outputTokens: { total: 4 } },
      response: { id: 'resp_memory_prompt_order' },
      warnings: [],
    }));

    await sendSteelOAuthChat({
      createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [
        { role: 'assistant', content: 'DB history: previous final Markdown table' },
        { role: 'user', content: 'current user request' },
      ],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      steelRuntimeContext: createProviderRuntimeContext(),
      workingMemorySummary:
        'Working Order Memory: rows=2; customer=龍頂; unresolved=第 2 項缺厚度',
    } as Parameters<typeof sendSteelOAuthChat>[0] & { workingMemorySummary: string });

    const firstGenerateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;

    expect(firstGenerateOptions.prompt.map((message) => message.role)).toEqual([
      'system',
      'assistant',
      'user',
    ]);
    expect(firstGenerateOptions.prompt[0]).toEqual(
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('DB_AGENT_RULE_SENTINEL'),
      }),
    );
    expect(JSON.stringify(firstGenerateOptions.prompt)).not.toContain(
      'Working Order Memory: rows=2',
    );
    expect(firstGenerateOptions.prompt[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
      }),
    );
    expect(firstGenerateOptions.prompt[2]).toEqual(
      expect.objectContaining({
        role: 'user',
      }),
    );
  });

  it('keeps the ordinary AI-led business tool loop', async () => {
    const doGenerate = jest
      .fn()
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_search_customers',
            toolName: 'search_customers',
            input: JSON.stringify({ keywords: ['大成', 'A001'] }),
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
      toolName: options.toolName as 'search_customers',
      data: { customers: [{ displayName: '大成鋼鐵', erpCustomerCode: 'A001' }] },
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
      steelRuntimeContext: createProviderRuntimeContext(),
    });

    expect(response.text).toBe('已依查詢結果回覆。');
    expect(doGenerate).toHaveBeenCalledTimes(2);
    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'search_customers',
        providerToolCallId: 'call_search_customers',
      }),
    );
  });

  it('batches same-round lookup price tool calls without customer tier props', async () => {
    const doGenerate = jest
      .fn()
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_price_b',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              queries: [{ category: '鐵板/鋼板', material: '黑鐵', keyword: 'DNB70060', limit: 5 }],
            }),
          },
          {
            type: 'tool-call',
            toolCallId: 'call_price_custom',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              queries: [{ category: '鐵板/鋼板', material: '黑鐵', keyword: 'DNB70160', limit: 5 }],
            }),
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
      data: {
        priceCandidates: [{ id: 1, erpItemCode: 'OTL006', unitPrice: 40 }],
        categoryCandidates: [],
        searchQueries: (options.arguments as SearchPriceCandidatesInputFixture).queries,
      },
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
      steelRuntimeContext: createProviderRuntimeContext(),
    });

    expect(executeSteelToolCall).toHaveBeenCalledTimes(1);
    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        providerToolCallId: 'call_price_b',
        arguments: {
          queries: [
            { category: '鐵板/鋼板', material: '黑鐵', keyword: 'DNB70060', limit: 5 },
            { category: '鐵板/鋼板', material: '黑鐵', keyword: 'DNB70160', limit: 5 },
          ],
        },
      }),
    );
    const secondGenerateOptions = doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions;
    const toolResultMessage = secondGenerateOptions.prompt.find(
      (message) => message.role === 'tool',
    ) as unknown as ToolMessageFixture;
    const toolResults = toolResultMessage.content.filter(
      (part) => part.type === 'tool-result',
    );
    const primaryToolResult = toolResults.find(
      (part) => part.toolCallId === 'call_price_b',
    )?.output.value as SteelToolResult;
    const coalescedToolResult = toolResults.find(
      (part) => part.toolCallId === 'call_price_custom',
    )?.output.value as SteelToolResult;

    expect(primaryToolResult).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          priceCandidates: [expect.objectContaining({ erpItemCode: 'OTL006' })],
        }),
      }),
    );
    expect(coalescedToolResult).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          coalescedWithProviderToolCallId: 'call_price_b',
          priceCandidateCount: 1,
          searchQueryCount: 2,
        }),
      }),
    );
    expect(JSON.stringify(coalescedToolResult)).not.toContain('OTL006');
  });

  it('does not apply discovered customer tier to later price lookup calls', async () => {
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
            input: JSON.stringify({
              queries: [{ category: 'C型鋼', material: '錏', keyword: 'CCG075', limit: 5 }],
            }),
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
    const executeSteelToolCall = jest.fn<
      ReturnType<SteelProviderToolExecutor>,
      Parameters<SteelProviderToolExecutor>
    >(async (options): Promise<SteelToolResult> => {
      if (options.toolName === 'search_customers') {
        return {
          ok: true as const,
          toolName: 'search_customers' as const,
          data: {
            customers: [
              {
                id: 8,
                displayName: '大成',
                customerTier: 'C',
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
      steelRuntimeContext: createProviderRuntimeContext(),
    });

    expect(executeSteelToolCall).toHaveBeenLastCalledWith(
      expect.objectContaining({
        toolName: 'search_price_candidates',
        providerToolCallId: 'call_price',
        arguments: {
          queries: [{ category: 'C型鋼', material: '錏', keyword: 'CCG075', limit: 5 }],
        },
      }),
    );
  });

  it('does not enrich price lookup with prior Markdown table text without category', async () => {
    const doGenerate = jest
      .fn()
      .mockImplementationOnce(async (_options: LanguageModelV3CallOptions) => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_price_table',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              queries: [{ category: 'C型鋼', material: '錏', keyword: '75x45x15x2.3', limit: 5 }],
            }),
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
      steelRuntimeContext: createProviderRuntimeContext(),
    });

    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'search_price_candidates',
        arguments: {
          queries: [{ category: 'C型鋼', material: '錏', keyword: '75x45x15x2.3', limit: 5 }],
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
      steelRuntimeContext: createProviderRuntimeContext(),
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

  it('stops the default tool loop after the internal max tool-call budget', async () => {
    let loopCallIndex = 0;
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => {
      loopCallIndex += 1;

      return {
        content: [
          {
            type: 'tool-call',
            toolCallId: `call_loop_${loopCallIndex}`,
            toolName: 'search_customers',
            input: JSON.stringify({ keywords: ['loop'] }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
        response: { id: `resp_loop_${loopCallIndex}` },
        warnings: [],
      };
    });
    const executeSteelToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'search_customers',
      data: { customers: [] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth: createMockOpenAIOAuth(doGenerate),
        ensureFresh: false,
        executeSteelToolCall,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'keep looping tools' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        steelRuntimeContext: createProviderRuntimeContext(),
      }),
    ).rejects.toThrow('Steel tool call limit exceeded');
    expect(executeSteelToolCall).toHaveBeenCalledTimes(8);
  });
});
