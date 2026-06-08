import { sendSteelOAuthChat } from './provider';

import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import type { OpenAIOAuthProviderSettings } from 'openai-oauth-provider';
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';

describe('Steel OpenAI OAuth provider adapter', () => {
  it('passes server-side OAuth settings and returns a sanitized provider response', async () => {
    const fetchResponses = jest.fn();
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'steel-provider-mock-ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_mock' },
      warnings: [],
    }));
    const settingsSeen: OpenAIOAuthProviderSettings[] = [];
    const createOpenAIOAuth = jest.fn((settings?: OpenAIOAuthProviderSettings) => {
      settingsSeen.push(settings ?? {});

      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      authFilePath: '/tmp/steel/auth.json',
      createOpenAIOAuth,
      ensureFresh: false,
      fetch: fetchResponses,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'Reply exactly: steel-provider-mock-ok' }],
      reasoningEffort: 'medium',
    });

    expect(settingsSeen).toEqual([
      {
        authFilePath: '/tmp/steel/auth.json',
        ensureFresh: false,
        fetch: fetchResponses,
        responsesState: false,
      },
    ]);
    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Reply exactly: steel-provider-mock-ok' }],
          },
        ],
        providerOptions: {
          openai: {
            reasoningEffort: 'medium',
          },
        },
      }),
    );
    expect(response).toEqual({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: 'steel-provider-mock-ok',
      responseId: 'resp_steel_mock',
      usage: {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
      },
      unsupportedSettings: [],
      warnings: [],
    });
    expect(JSON.stringify(response)).not.toMatch(/authFile|authorization|access_token/i);
  });

  it('requests provider reasoning summaries when a stream summary callback is present', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [
        { type: 'reasoning' as const, text: '先辨識 catalog key，再查 reviewed rules。' },
        { type: 'text' as const, text: 'ok' },
      ],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_reasoning_summary' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const onReasoningSummary = jest.fn();

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼一支多少？' }],
      onReasoningSummary,
      reasoningEffort: 'medium',
    });

    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          openai: {
            reasoningEffort: 'medium',
            reasoningSummary: 'auto',
          },
        },
      }),
    );
    expect(onReasoningSummary).toHaveBeenCalledWith('先辨識 catalog key，再查 reviewed rules。');
    expect(response.text).toBe('ok');
  });

  it('serializes user file attachments as provider file parts', async () => {
    const fileData = new TextEncoder().encode('TXT_SENTINEL_7F3A 中文 12345');
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'TXT_SENTINEL_7F3A' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 9,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 4,
          text: 4,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_file_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const abortController = new AbortController();

    await sendSteelOAuthChat({
      abortSignal: abortController.signal,
      createOpenAIOAuth,
      ensureFresh: false,
      passThroughUnsupportedFiles: true,
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: 'Read the attached file and return its sentinel.',
          files: [
            {
              filename: 'steel-oauth-smoke.txt',
              mediaType: 'text/plain',
              data: fileData,
            },
          ],
        },
      ],
      reasoningEffort: 'medium',
    });

    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read the attached file and return its sentinel.' },
              {
                type: 'file',
                filename: 'steel-oauth-smoke.txt',
                mediaType: 'text/plain',
                data: fileData,
              },
            ],
          },
        ],
        abortSignal: abortController.signal,
        providerOptions: {
          openai: {
            passThroughUnsupportedFiles: true,
            reasoningEffort: 'medium',
          },
        },
      }),
    );
  });

  it('sets OpenAI image detail to high for image file parts', async () => {
    const imageData = new Uint8Array([137, 80, 78, 71]);
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'PNG_SENTINEL_B7E4' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 12,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 4,
          text: 4,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_image_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      passThroughUnsupportedFiles: true,
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: 'Read the attached image and return its sentinel.',
          files: [
            {
              filename: 'steel-oauth-smoke.png',
              mediaType: 'image/png',
              data: imageData,
            },
          ],
        },
      ],
      reasoningEffort: 'medium',
    });

    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read the attached image and return its sentinel.' },
              {
                type: 'file',
                filename: 'steel-oauth-smoke.png',
                mediaType: 'image/png',
                data: imageData,
                providerOptions: {
                  openai: {
                    imageDetail: 'high',
                  },
                },
              },
            ],
          },
        ],
      }),
    );
  });

  it('adds the AI-led Steel runtime policy when requested', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: '我會先查 reviewed facts，再列出候選給使用者確認。' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 31,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 9,
          text: 9,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_runtime_policy_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請說明亞L30x30的推論流程' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    const generateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    const systemPrompt = generateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt).toEqual(
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('AI owns Steel tool orchestration'),
      }),
    );
    expect(systemPrompt.content).toContain('統一用繁體中文回覆');
    expect(systemPrompt.content).toContain('Do not treat raw customer text such as `亞L30x30`');
    expect(systemPrompt.content).toContain(
      'Generate material/specification candidates in reasoning',
    );
    expect(systemPrompt.content).toContain('Call backend tools when you need reviewed rows');
    expect(systemPrompt.content).toContain(
      'AI owns quote arithmetic on the fixed OAuth/Codex path',
    );
    expect(systemPrompt.content).toContain(
      'checks workbook summary totals against the sum of line subtotal values',
    );
    expect(systemPrompt.content).toContain('backend does not perform deterministic quote pricing');
    expect(systemPrompt.content).toContain('summary totalAmount/confirmedAmount');
    expect(systemPrompt.content).not.toContain('OpenAI code/Python');
    expect(systemPrompt.content).not.toContain('code-execution evidence');
    expect(systemPrompt.content).toContain(
      'lookup_quote_rules = lookup_instructions + lookup_defaults',
    );
    expect(systemPrompt.content).toContain('lookup_catalog_families');
    expect(systemPrompt.content).not.toContain('lesson-memory');
    expect(systemPrompt.content).toContain('generate candidate material and specification queries');
    expect(systemPrompt.content).toContain('reviewed price rows');
    expect(systemPrompt.content).toContain('bounded options');
    expect(systemPrompt.content).toContain(
      'Ask for missing length, thickness, customer, or tier after reviewed lookup, not before',
    );
    expect(systemPrompt.content).toContain(
      'search_customers cannot find a usable customer price tier',
    );
    expect(systemPrompt.content).toContain('must not invent customerId');
    expect(systemPrompt.content).toContain('Pass customerTierId 2 to search_price_candidates');
    expect(systemPrompt.content).toContain('目前用 價格B：26.8 元/kg');
    expect(systemPrompt.content).toContain('Do not add highest/most-expensive wording');
    expect(systemPrompt.content).toContain('do not list unit weight as a separate bullet');
    expect(systemPrompt.content).toContain('label it `價格`, not `reviewed 價格`');
    expect(systemPrompt.content).toContain('customer name can be used');
    expect(systemPrompt.content).toContain(
      'The first reply must also show same-spec reviewed alternatives',
    );
    expect(systemPrompt.content).toContain(
      'if the user does not specify another material/surface after those options were shown',
    );
    expect(systemPrompt.content).toContain('If unit = kg, unitPrice is a per-kg price');
    expect(systemPrompt.content).toContain('do not answer as if unitPrice were per-piece');
    expect(systemPrompt.content).toContain('sourceUnitWeightOrigin = product_name_parentheses');
    expect(systemPrompt.content).toContain('h_beam including 輕量H');
    expect(systemPrompt.content).toContain(
      'Do not apply this steel material rule to non-material product/accessory rows',
    );
    expect(systemPrompt.content).toContain(
      'reviewed unit-weight column, it has priority over product-name parentheses',
    );
    expect(systemPrompt.content).toContain(
      'fixed-length material rows with a positive ratio/sourceRatio',
    );
    expect(systemPrompt.content).toContain('related same-series/same-spec reviewed material rows');
    expect(systemPrompt.content).toContain(
      'Use canonical catalog family keys such as h_beam, c_type, and angle',
    );
    expect(systemPrompt.content).toContain(
      'After choosing a catalog/category key, call lookup_quote_rules',
    );
    expect(systemPrompt.content).toContain(
      'lookup_quote_rules returns both reviewed instruction packets and reviewed quote defaults',
    );
    expect(systemPrompt.content).toContain(
      'include all detected materials/catalog keys in one catalogContexts array',
    );
    expect(systemPrompt.content).toContain(
      'call search_customers in the initial lookup round when available',
    );
    expect(systemPrompt.content).toContain(
      'customerContext to lookup_quote_rules before price lookup',
    );
    expect(systemPrompt.content).not.toMatch(/lookup_defaults.*legacy.*follow-up/i);
    expect(systemPrompt.content).not.toMatch(/lookup_instructions.*legacy-compatible/i);
    expect(systemPrompt.content).toContain(
      'For oral material/category price, formula, or rules requests, call lookup_catalog_families before lookup_quote_rules',
    );
    expect(systemPrompt.content).toContain(
      'Backend does not decide oral wording to catalog_family mappings',
    );
    expect(systemPrompt.content).toContain(
      '未取得 search_price_candidates tool result 前，不可回答查不到',
    );
    expect(systemPrompt.content).toContain(
      'If instruction packets provide processing price candidate names or ERP item codes',
    );
    expect(systemPrompt.content).toContain('When calling search_price_candidates after selecting');
    expect(systemPrompt.content).toContain('use catalogFamilies with the selected catalog key');
    expect(systemPrompt.content).toContain(
      'do not send oral family/category labels as productNames',
    );
    expect(systemPrompt.content).toContain('When no reliable catalog key is available');
    expect(systemPrompt.content).toContain(
      'use productNames with one or more AI-derived reviewed product/source-name candidates',
    );
    expect(systemPrompt.content).toContain('candidateQueries.productNames');
    expect(systemPrompt.content).toContain(
      'For multiple inferred reviewed product-name candidates',
    );
    expect(systemPrompt.content).toContain('use productNames or candidateQueries');
    expect(systemPrompt.content).toContain('specKeyContains 100x2.3');
    expect(systemPrompt.content).toContain('productNames [錏輕型鋼]');
    const searchPriceTool = generateOptions.tools?.find(
      (tool) => tool.name === 'search_price_candidates',
    );
    const searchPriceToolSchema = JSON.stringify(searchPriceTool?.inputSchema);
    expect(searchPriceToolSchema).toContain('Reviewed product/source name');
    expect(searchPriceToolSchema).toContain('Multiple reviewed product/source name candidates');
    expect(searchPriceToolSchema).toContain('not oral/category/family label');
    expect(searchPriceToolSchema).toContain('catalogFamilies');
    expect(generateOptions.prompt[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '請說明亞L30x30的推論流程' }],
    });
  });

  it('requires catalog-family lookup before quote rules and price lookup for oral material price requests', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_catalog_lookup',
            toolName: 'lookup_catalog_families',
            input: JSON.stringify({
              searchText: 'C型鋼',
              limit: 5,
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 20,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_catalog_lookup' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_after_catalog',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_quote_rules_after_catalog' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_after_rules',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use selected c_type catalog key after reviewed rules lookup',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_after_rules' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '依 C 型鋼 catalog key 與規則查到候選。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_catalog_sequence_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async ({ toolName }) => ({
      ok: true as const,
      toolName: toolName as
        | 'lookup_catalog_families'
        | 'lookup_quote_rules'
        | 'search_price_candidates',
      data:
        toolName === 'lookup_catalog_families'
          ? {
              catalogFamilyCandidates: [
                {
                  key: 'c_type',
                  displayName: 'C 型鋼',
                  aliases: ['C型鋼', 'C鋼', '輕型鋼'],
                },
              ],
            }
          : toolName === 'search_price_candidates'
            ? {
                priceCandidates: [
                  {
                    productName: '錏輕型鋼',
                    specKey: '100x2.3',
                    unitPrice: 26.8,
                  },
                ],
              }
            : {
                instructionPackets: [
                  {
                    slug: 'c-type-basic-quote-zh-v1',
                    packetGroups: ['c-type-quote-core'],
                  },
                ],
              },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(
      (doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['lookup_catalog_families', 'search_customers']);
    expect((doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    expect(
      (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['lookup_quote_rules']);
    expect(
      (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['search_price_candidates']);
    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_catalog_families',
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    expect(response.text).toBe('依 C 型鋼 catalog key 與規則查到候選。');
  });

  it('executes AI-callable Steel business tools and continues with tool results', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_tool_call_1',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['quote_price'],
              evidenceSummary: 'user asked 亞L30x30 一支多少',
              catalogContexts: [
                {
                  lineRefs: ['line_1'],
                  catalogCandidates: ['angle'],
                  surfaceCandidates: ['錏', '鍍鋅'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 31,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_steel_tool_first' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '已查到角鐵/錏材推論規則。',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 44,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_steel_tool_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async () => ({
      ok: true as const,
      toolName: 'lookup_quote_rules' as const,
      data: {
        instructionPacketGroups: [
          {
            group: 'angle-zinc-quote-core',
            lineRefs: ['line_1'],
            packetSlugs: ['angle-surface-oral-zh-v1'],
          },
        ],
      },
      sourceRefs: [],
      durationMs: 2,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請查角鐵/錏材推論規則' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(doGenerate).toHaveBeenCalledTimes(2);
    const firstOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(firstOptions.tools?.map((tool) => tool.name)).toEqual([
      'lookup_quote_rules',
      'lookup_catalog_families',
      'lookup_formula',
      'search_customers',
      'search_price_candidates',
    ]);
    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        providerToolCallId: 'steel_tool_call_1',
        toolName: 'lookup_quote_rules',
        arguments: expect.objectContaining({
          evidenceSummary: 'user asked 亞L30x30 一支多少',
        }),
      }),
    );
    const secondOptions = doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions;
    expect(secondOptions.prompt).toEqual(
      expect.arrayContaining([
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'steel_tool_call_1',
              toolName: 'lookup_quote_rules',
              input: expect.objectContaining({
                evidenceSummary: 'user asked 亞L30x30 一支多少',
              }),
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'steel_tool_call_1',
              toolName: 'lookup_quote_rules',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: true,
                  toolName: 'lookup_quote_rules',
                  data: expect.objectContaining({
                    instructionPacketGroups: expect.any(Array),
                  }),
                }),
              },
            },
          ],
        },
      ]),
    );
    expect(response).toEqual(
      expect.objectContaining({
        text: '已查到角鐵/錏材推論規則。',
        responseId: 'resp_steel_tool_final',
        usage: {
          inputTokens: 75,
          outputTokens: 21,
          totalTokens: 96,
        },
      }),
    );
  });

  it('requires Steel tool calls until a price request gets search_price_candidates results', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_lookup_1',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['material_price_lookup'],
              evidenceSummary: 'user asked 亞L30x30 一支多少',
              catalogContexts: [{ catalogCandidates: ['angle'] }],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 20,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_required_lookup' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_1',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: '亞L30x30',
              candidateQueries: [
                {
                  queryId: 'formed-zinc-angle',
                  productNames: ['錏角鐵 L30x30'],
                  confidence: 'medium',
                  reason: 'AI interpreted 亞 as possible 錏 and L30x30 as angle steel',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_required_price' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '暫估採錏成型角鐵 30x30x2.5x6M。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_required_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async ({ toolName }) => ({
      ok: true as const,
      toolName: toolName as 'lookup_quote_rules' | 'search_price_candidates',
      data:
        toolName === 'search_price_candidates'
          ? {
              priceCandidates: [
                {
                  productName: '錏成型角鐵',
                  specKey: 'angle_L30x30x2.5x6M',
                  unitPrice: 194.3,
                },
              ],
            }
          : { instructionPacketGroups: [] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '亞L30x30 一支多少' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(doGenerate).toHaveBeenCalledTimes(3);
    expect((doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    expect((doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    expect(
      (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['search_price_candidates']);
    expect((doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'auto',
    });
    expect(executeSteelToolCall).toHaveBeenCalledTimes(2);
    expect(response.text).toBe('暫估採錏成型角鐵 30x30x2.5x6M。');
  });

  it('requires lookup_quote_rules before executing category-dependent price lookup', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_too_early',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'AI inferred C 型鋼 category and compact spec',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_price_too_early' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_after_reject',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_instruction' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_after_instruction',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use C 型鋼 instruction packet before reviewed price lookup',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 45,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_price_after_instruction' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '依 C 型鋼 instruction 查到候選。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_sequence_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async ({ toolName }) => ({
      ok: true as const,
      toolName: toolName as 'lookup_quote_rules' | 'search_price_candidates',
      data:
        toolName === 'search_price_candidates'
          ? {
              priceCandidates: [
                {
                  productName: '錏輕型鋼',
                  specKey: '100x2.3',
                  unitPrice: 26,
                },
              ],
            }
          : {
              instructionPackets: [
                {
                  slug: 'c-type-basic-quote-zh-v1',
                  packetGroups: ['c-type-quote-core'],
                },
              ],
            },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.arrayContaining([
            expect.objectContaining({
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: false,
                  toolName: 'search_price_candidates',
                  errorCategory: 'invalid_arguments',
                  errorSummary: expect.stringContaining('lookup_quote_rules'),
                }),
              },
            }),
          ]),
        }),
      ]),
    );
    expect(response.text).toBe('依 C 型鋼 instruction 查到候選。');
  });

  it('defaults unknown customer tier price filters to B customerTierId after quote rules mark the tier unknown', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_unknown_tier',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              customerContext: {
                customerTierId: 1,
                tierKnown: false,
              },
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_quote_rules_unknown_tier' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_bad_tier',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              customerTierId: 1,
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'AI inferred C 型鋼 category and compact spec',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 35,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_bad_tier' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '未提供客戶或找不到客戶分級時，目前用價格B：26.8 元/kg；提供客戶名稱後可再查該客戶報價。',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_final_b_default' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_quote_rules' as const,
        data: {
          instructionPackets: [
            {
              slug: 'c-type-basic-quote-zh-v1',
              packetGroups: ['c-type-quote-core'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: {
          priceCandidates: [
            {
              productName: '錏輕型鋼',
              specKey: '100x2.3',
              customerTierCode: 'B',
              unitPrice: 26.8,
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      });

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    expect(executeSteelToolCall.mock.calls[1]?.[0].arguments).toEqual(
      expect.objectContaining({ customerTierId: 2 }),
    );
    expect(doGenerate).toHaveBeenCalledTimes(3);
    const finalPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    const serializedFinalPrompt = JSON.stringify(finalPrompt);
    expect(serializedFinalPrompt).toContain('"toolName":"search_price_candidates"');
    expect(serializedFinalPrompt).toContain('"customerTierId":2');
    expect(serializedFinalPrompt).toContain('"customerTierCode":"B"');
    expect(response.text).toBe(
      '未提供客戶或找不到客戶分級時，目前用價格B：26.8 元/kg；提供客戶名稱後可再查該客戶報價。',
    );
  });

  it('uses a first-round customer lookup tier in quote rules and price lookup', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_catalog_lookup',
            toolName: 'lookup_catalog_families',
            input: JSON.stringify({
              searchText: 'C型鋼',
              limit: 5,
            }),
          },
          {
            type: 'tool-call',
            toolCallId: 'steel_customer_lookup',
            toolName: 'search_customers',
            input: JSON.stringify({
              searchText: '龍頂',
              limit: 3,
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_catalog_customer_lookup' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_customer',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: '龍頂 C型鋼 100x50x20 2.3t 一支多少',
              customerContext: {
                customerId: 10,
                customerName: '龍頂',
                customerTierId: 1,
                tierKnown: true,
              },
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 35,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_quote_rules_customer' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_customer_tier',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: '龍頂 C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              customerTierId: 1,
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use customer tier from search_customers',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_customer_tier' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已依龍頂客戶分級報價。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_final_customer_tier' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_catalog_families' as const,
        data: {
          catalogFamilyCandidates: [
            {
              key: 'c_type',
              displayName: 'C 型鋼',
              aliases: ['C型鋼', 'C鋼', '輕型鋼'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_customers' as const,
        data: {
          customers: [
            {
              id: 10,
              displayName: '龍頂',
              customerTier: {
                id: 1,
                code: 'A',
                name: 'A級',
              },
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_quote_rules' as const,
        data: {
          instructionPackets: [
            {
              slug: 'c-type-basic-quote-zh-v1',
              packetGroups: ['c-type-quote-core'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: {
          priceCandidates: [
            {
              productName: '錏輕型鋼',
              specKey: '100x2.3',
              customerTierCode: 'A',
              unitPrice: 26,
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      });

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '龍頂 C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_catalog_families',
      'search_customers',
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    expect(
      (doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['lookup_catalog_families', 'search_customers']);
    expect(
      (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['lookup_quote_rules']);
    expect(executeSteelToolCall.mock.calls[2]?.[0].arguments).toEqual(
      expect.objectContaining({
        customerContext: expect.objectContaining({
          customerId: 10,
          customerTierId: 1,
          tierKnown: true,
        }),
      }),
    );
    expect(executeSteelToolCall.mock.calls[3]?.[0].arguments).toEqual(
      expect.objectContaining({ customerTierId: 1 }),
    );
    expect(response.text).toBe('已依龍頂客戶分級報價。');
  });

  it('adds a specific price lookup reminder after quote rules when reviewed price lookup is still missing', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_only',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 C100x50x20x2.3t 6M 一支多少',
              customerContext: {
                tierKnown: false,
              },
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 25,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_quote_rules_only' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_after_reminder',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 C100x50x20x2.3t 6M 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  productNames: ['錏輕型鋼'],
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use the C 型鋼 compact reviewed price fragment after quote rules',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 35,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_after_reminder' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '目前用價格B：26.8 元/kg，並列出材質選項；提供客戶名稱後可再查該客戶報價。',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 45,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_final_after_reminder' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_quote_rules' as const,
        data: {
          instructionPackets: [
            {
              slug: 'c-type-basic-quote-zh-v1',
              packetGroups: ['c-type-quote-core'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: {
          priceCandidates: [
            {
              productName: '錏輕型鋼',
              specKey: '100x2.3',
              customerTierCode: 'B',
              unitPrice: 26.8,
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      });

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 C100x50x20x2.3t 6M 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_quote_rules',
      'search_price_candidates',
    ]);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    const serializedSecondPrompt = JSON.stringify(secondPrompt);
    expect((doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    expect(
      (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['search_price_candidates']);
    expect(serializedSecondPrompt).toContain('call search_price_candidates');
    expect(serializedSecondPrompt).toContain('100x2.3');
    expect(serializedSecondPrompt).toContain('productNames [錏輕型鋼]');
    expect(serializedSecondPrompt).toContain('candidateQueries.productNames');
    expect(serializedSecondPrompt).toContain('customerTierId 2');
    expect(serializedSecondPrompt).toContain('價格B');
    expect(serializedSecondPrompt).toContain('Do not add highest/most-expensive wording');
    expect(serializedSecondPrompt).toContain('do not list unit weight as a separate bullet');
    expect(response.text).toBe(
      '目前用價格B：26.8 元/kg，並列出材質選項；提供客戶名稱後可再查該客戶報價。',
    );
  });

  it('does not treat invalid search_price_candidates arguments as a completed price lookup', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_instruction_first',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 25,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_instruction_first' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_bad',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-bad-product-name',
                  productNames: ['C型鋼'],
                  specKeyContains: '100x50x20',
                  confidence: 'high',
                  reason: 'AI selected c_type but reused the family label',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_bad_price' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_good',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use C 型鋼 family with the reviewed spec fragment',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_good_price' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '找到 C 型鋼 100x2.3 的候選價格。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_c_type_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'lookup_quote_rules' as const,
        data: {
          instructionPackets: [
            {
              slug: 'c-type-basic-quote-zh-v1',
              packetGroups: ['c-type-quote-core'],
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: false as const,
        toolName: 'search_price_candidates' as const,
        errorCategory: 'invalid_arguments' as const,
        errorSummary: 'Do not use C型鋼 as productNames after selecting c_type',
        durationMs: 1,
        redactionVersion: 1 as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        toolName: 'search_price_candidates' as const,
        data: {
          priceCandidates: [
            {
              productName: '錏輕型鋼',
              specKey: '100x2.3',
              unitPrice: 123,
            },
          ],
        },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1 as const,
      });

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(doGenerate).toHaveBeenCalledTimes(4);
    expect((doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'required',
    });
    const thirdPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    const serializedThirdPrompt = JSON.stringify(thirdPrompt);
    expect(serializedThirdPrompt).toContain('use catalogFamilies with the selected catalog key');
    expect(serializedThirdPrompt).toContain(
      'do not send oral family/category labels as productNames',
    );
    expect(serializedThirdPrompt).toContain(
      'use productNames with one or more AI-derived reviewed product/source-name candidates',
    );
    expect(serializedThirdPrompt).toContain('candidateQueries.productNames');
    expect(serializedThirdPrompt).toContain('use productNames or candidateQueries');
    expect(serializedThirdPrompt).toContain('specKeyContains 100x2.3');
    expect(serializedThirdPrompt).toContain('productNames [錏輕型鋼]');
    expect(
      (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['search_price_candidates']);
    expect(executeSteelToolCall).toHaveBeenCalledTimes(3);
    expect(response.text).toBe('找到 C 型鋼 100x2.3 的候選價格。');
  });

  it('requires lookup_formula before final answer when reviewed rules require formula rows', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_catalog_lookup',
            toolName: 'lookup_catalog_families',
            input: JSON.stringify({
              searchText: 'C型鋼',
              limit: 5,
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 20,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_catalog' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: 'C型鋼 100x50x20 2.3t 一支多少',
              catalogContexts: [
                {
                  catalogCandidates: ['c_type'],
                  formulaCandidates: ['C'],
                  packetGroupHints: ['c-type-quote-core'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_rules' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: 'C型鋼 100x50x20 2.3t 一支多少？',
              catalogFamilies: ['c_type'],
              candidateQueries: [
                {
                  queryId: 'c-type-100x23',
                  productNames: ['錏輕型鋼'],
                  specKeyContains: '100x2.3',
                  confidence: 'high',
                  reason: 'Use selected c_type catalog key and reviewed C 型鋼 rules',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_price' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '沒有查公式也先回答。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_premature_text' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_formula',
            toolName: 'lookup_formula',
            input: JSON.stringify({
              catalogContexts: [
                {
                  lineRefs: ['line_1'],
                  catalogCandidates: ['c_type'],
                  formulaCandidates: ['C'],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_lookup' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '查過公式 C 後再回答 C 型鋼報價。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 65,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_formula_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async ({ toolName }) => ({
      ok: true as const,
      toolName: toolName as
        | 'lookup_catalog_families'
        | 'lookup_quote_rules'
        | 'search_price_candidates'
        | 'lookup_formula',
      data:
        toolName === 'lookup_catalog_families'
          ? {
              catalogFamilyCandidates: [
                {
                  key: 'c_type',
                  displayName: 'C 型鋼',
                  aliases: ['C型鋼', 'C鋼', '輕型鋼'],
                },
              ],
            }
          : toolName === 'lookup_quote_rules'
            ? {
                instructionPackets: [
                  {
                    slug: 'c-type-basic-quote-zh-v1',
                    requiredLookups: ['search_price_candidates', 'lookup_formula'],
                  },
                ],
                requiredLookups: ['search_price_candidates', 'lookup_formula'],
              }
            : toolName === 'lookup_formula'
              ? {
                  formulaCandidates: [
                    {
                      formulaCode: 'C',
                      displayName: 'C 型鋼公式',
                    },
                  ],
                }
              : {
                  priceCandidates: [
                    {
                      productName: '錏輕型鋼',
                      specKey: '100x2.3',
                      unitPrice: 26.8,
                    },
                  ],
                },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'C型鋼 100x50x20 2.3t 一支多少？' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    expect(executeSteelToolCall.mock.calls.map(([call]) => call.toolName)).toEqual([
      'lookup_catalog_families',
      'lookup_quote_rules',
      'search_price_candidates',
      'lookup_formula',
    ]);
    expect(
      (doGenerate.mock.calls[4]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['lookup_formula']);
    expect(
      JSON.stringify((doGenerate.mock.calls[4]?.[0] as LanguageModelV3CallOptions).prompt),
    ).toContain('lookup_formula');
    expect(response.text).toBe('查過公式 C 後再回答 C 型鋼報價。');
  });

  it('requires a provisional semantic workbook patch after a positive quick-price lookup when workbook context exists', async () => {
    const semanticPatch = {
      customer: {
        name: '未提供',
        tier: 'B級',
        note: '未提供客戶，暫用價格B',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerOriginalItemName: '亞L30x30 一支多少',
          normalizedItemName: '錏成型角鐵 30x30x2.5x6M',
          searchKeywords: ['錏角鐵', '30x30'],
          productPriceCandidateItems: '錏成型角鐵 30x30x2.5x6M 194.3元/支',
          adoptedProductPriceItem: '錏成型角鐵 30x30x2.5x6M',
          isExactMatch: false,
          materialCategory: '角鐵',
          material: '錏',
          spec: 'L30x30',
          quantity: 1,
          unit: '支',
          customerName: '未提供',
          customerTier: 'B級',
          materialUnitPrice: 194.3,
          materialPricingUnit: '支',
          billableQuantity: 1,
          subtotal: 194.3,
          confidence: '低',
          lowConfidenceReason: '使用者未提供厚度，暫採 reviewed 候選',
          suggestedReview: '確認厚度、長度與客戶分級',
          systemOrder: {
            itemSpec: '錏成型角鐵 30x30x2.5x6M',
            unit: '支',
            quantity: 1,
            totalQuantity: 1,
            unitPrice: 194.3,
            pricingBasis: '價格B暫估',
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '未確認',
            differenceNote: '亞L30x30 口語輸入未指定厚度',
          },
          customerQuote: {
            itemSpec: '錏成型角鐵 30x30x2.5x6M',
            quantity: 1,
            unit: '支',
            unitPrice: 194.3,
            subtotal: 194.3,
            note: '暫估，待確認厚度與客戶',
          },
          manualReview: {
            confirmationNeeded: '確認厚度、長度與客戶分級後轉正式報價',
          },
          interpretationNote: {
            item: '口語品名轉換',
            content: '亞L30x30 暫採錏成型角鐵候選；需確認厚度。',
            confidence: '低',
          },
        },
      ],
      summary: {
        totalAmount: 194.3,
        lowConfidenceAmount: 194.3,
        unconfirmedCount: 1,
        lowConfidenceCount: 1,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_price_1',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: '亞L30x30 一支多少',
              candidateQueries: [
                {
                  queryId: 'formed-zinc-angle',
                  productNames: ['錏角鐵'],
                  specKeyContains: '30x30',
                  confidence: 'medium',
                  reason: 'AI interpreted 亞 as possible 錏 and L30x30 as angle steel',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 30,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 7,
            text: 7,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_price_first' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '錏成型角鐵 L30x30x2.5x6M 暫估 194.3 元/支。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 40,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 9,
            text: 9,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_text_without_patch' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          { type: 'text', text: '已寫入 provisional workbook preview。' },
          {
            type: 'tool-call',
            toolCallId: 'semantic_workbook_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 55,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_patch_final' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '暫估採錏成型角鐵 30x30x2.5x6M，材料單價 194.3 元/支。另有 30x30x3.0 等候選，請確認厚度、長度與客戶分級。',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 18,
            text: 18,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_after_patch_text' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async () => ({
      ok: true as const,
      toolName: 'search_price_candidates' as const,
      data: {
        priceCandidates: [
          {
            productName: '錏成型角鐵',
            specKey: 'angle_L30x30x2.5x6M',
            unit: 'piece',
            unitPrice: 194.3,
          },
        ],
      },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '亞L30x30 一支多少' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\ncolumn label="材料單價" key="material_unit_price"\ncolumn label="小計" key="subtotal"\nrow id="line_1" cells: line_no=1 material_unit_price=null subtotal=null',
    });

    expect(doGenerate).toHaveBeenCalledTimes(4);
    const firstOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    const firstSystemPrompt = firstOptions.prompt[0] as { role: 'system'; content: string };
    expect(firstOptions.tools?.map((tool) => tool.name)).not.toContain('patch_workbook');
    expect(firstSystemPrompt.content).toContain('write provisional workbook preview rows');
    expect(firstSystemPrompt.content).toContain('update the `小計` column');
    expect(firstSystemPrompt.content).toContain(
      'Fill blank workbook cells when the value can be derived',
    );
    expect(firstSystemPrompt.content).toContain(
      'Leave a blank cell unchanged when material, customer, source, or calculation context is unavailable',
    );
    expect(firstSystemPrompt.content).toContain(
      'record the missing context in manual_review or interpretation_notes',
    );
    expect(firstSystemPrompt.content).toContain('Do not write confirmed totals');
    expect(firstSystemPrompt.content).toContain('quote_details subtotal values');
    expect(firstSystemPrompt.content).toContain('interpreted order information');
    expect(firstSystemPrompt.content).toContain('Do not list a per-field diff');
    expect(firstSystemPrompt.content).toContain('Do not answer only with a field count');
    expect(firstSystemPrompt.content).toContain('價格先於重量');
    expect(firstSystemPrompt.content).toContain('未確認單價或金額不可填 0');
    expect(firstSystemPrompt.content).toContain('系統訂單分頁材料列與加工列分開');
    expect(firstSystemPrompt.content).toContain('systemOrder.modelCode');
    expect(firstSystemPrompt.content).toContain('系統訂單.`型號`');
    expect(firstSystemPrompt.content).toContain('報價明細 小計');
    expect(firstSystemPrompt.content).toContain('確定金額');
    expect(firstSystemPrompt.content).toContain('低信心暫估金額');
    expect(firstSystemPrompt.content).toContain('給客戶用');
    expect(firstSystemPrompt.content).toContain('不得出現客戶分級');
    expect(firstSystemPrompt.content).toContain('calculation_results');
    expect(firstSystemPrompt.content).toContain('Keep patch_quote_workbook compact');
    expect(firstSystemPrompt.content).toContain('Do not hand-write workbook cell operations');
    expect(firstSystemPrompt.content).not.toContain('patch_workbook');
    const thirdPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(
      thirdPrompt.some(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('patch_quote_workbook') &&
          !message.content.includes('patch_workbook'),
      ),
    ).toBe(true);
    const fourthPrompt = (doGenerate.mock.calls[3]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(fourthPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: true,
                  projectedOperationCount: expect.any(Number),
                  complete: true,
                  instruction: expect.stringContaining('interpreted order information'),
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toContain('材料單價 194.3 元/支');
    expect(response.text).toContain('請確認厚度');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 194.3,
        }),
        expect.objectContaining({
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'item_spec',
          value: '錏成型角鐵 30x30x2.5x6M',
        }),
        expect.objectContaining({
          sheetId: 'manual_review',
          rowId: 'review_1',
          columnKey: 'confirmation_needed',
          value: '確認厚度、長度與客戶分級後轉正式報價',
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'subtotal',
          value: 194.3,
        }),
      ]),
    );
  });

  it('reprojects companion workbook sheets through semantic quote patches for quote follow-up updates', async () => {
    const semanticPatch = {
      customer: {
        name: '龍頂',
        tier: 'A級',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerOriginalItemName: 'C100x50x20x2.3t 6M 一支',
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '錏輕型鋼 100*2.3',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          confidence: '中',
          systemOrder: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
            pricingBasis: '龍頂A級',
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
            note: '暫估',
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質後轉正式報價',
          },
          interpretationNote: {
            item: '客戶分級',
            content: '客戶改為龍頂候選，C型鋼改用A級價格重算。',
          },
        },
      ],
      summary: {
        totalAmount: 624,
        lowConfidenceAmount: 624,
        unconfirmedCount: 1,
        totalWeightKg: 24,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_followup_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_followup_patch_1' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已依龍頂A級更新：價格 26，小計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_followup_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: 'C100x50x20x2.3t 6M 一支多少？' },
        {
          role: 'assistant',
          content: '暫估錏輕型鋼 100*2.3，價格B 26.8，小計 643.2。',
        },
        { role: 'user', content: '客戶是龍頂' },
      ],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26.8 subtotal=643.2',
    });

    expect(doGenerate).toHaveBeenCalledTimes(2);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: true,
                  missingSheetIds: [],
                  missingCells: [],
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toContain('小計 624');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'subtotal',
          value: 624,
        }),
      ]),
    );
  });

  it('requires semantic workbook coverage when a semantic patch omits required companion fields', async () => {
    const sparseSemanticPatch = {
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          subtotal: 624,
        },
      ],
    };
    const completionSemanticPatch = {
      customer: {
        name: '龍頂',
        tier: 'A級',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '錏輕型鋼 100*2.3',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          systemOrder: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: '客戶分級',
            content: '客戶改為龍頂候選，C型鋼改用A級價格重算。',
          },
        },
      ],
      summary: {
        totalAmount: 624,
        lowConfidenceAmount: 624,
        unconfirmedCount: 1,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_sparse_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(sparseSemanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_sparse_patch_1' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_sparse_patch_2',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(completionSemanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_sparse_patch_2' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已更新龍頂A級：小計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_sparse_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: 'C100x50x20x2.3t 6M 一支多少？' },
        {
          role: 'assistant',
          content: '暫估錏輕型鋼 100*2.3，價格B 26.8，小計 643.2。',
        },
        { role: 'user', content: '客戶是龍頂' },
      ],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26.8 subtotal=643.2',
    });

    expect(doGenerate).toHaveBeenCalledTimes(3);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: false,
                  missingCells: expect.any(Array),
                  instruction: expect.stringContaining('Call patch_quote_workbook again'),
                }),
              },
            }),
          ],
        }),
      ]),
    );
    const thirdPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(thirdPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: true,
                  missingSheetIds: [],
                  missingCells: [],
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toContain('小計 624');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'item_spec',
          value: '錏輕型鋼 100*2.3，6M',
        }),
        expect.objectContaining({
          sheetId: 'manual_review',
          rowId: 'review_1',
          columnKey: 'confirmation_needed',
          value: '確認龍頂客戶全名與材質',
        }),
      ]),
    );
  });

  it('projects semantic workbook patches into complete cell operations', async () => {
    const semanticPatch = {
      customer: {
        name: '龍頂',
        code: 'O-15',
        tier: 'A級',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerOriginalItemName: 'C100x50x20x2.3t 6M 一支',
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          searchKeywords: ['c_type', '錏輕型鋼', '100x2.3'],
          productPriceCandidateItems: '錏輕型鋼 100*2.3 A價26元/kg；白鐵輕型鋼 100*2.3 A價97元/kg',
          adoptedProductPriceItem: 'CCG10023 錏輕型鋼 100*2.3',
          isExactMatch: false,
          materialCategory: 'C型鋼',
          material: '錏',
          spec: 'C100x50x20x2.3t，6M',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialUnitPriceField: '售價A',
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          confidence: '中',
          lowConfidenceReason: '龍頂客戶仍有兩筆候選，需確認全名',
          decisionEvidence: 'search_customers + 產品價格.xlsx reviewed candidate',
          suggestedReview: '確認龍頂客戶全名與材質',
          systemOrder: {
            itemSpec: '錏C型鋼 C100x50x20x2.3 L=6000',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
            pricingBasis: '龍頂A級',
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏C型鋼 C100x50x20x2.3 L=6000',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
            note: '暫估',
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: '客戶分級',
            content: '客戶改為龍頂候選，C型鋼改用A級價格重算。',
          },
        },
      ],
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'semantic_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_semantic_patch' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已依龍頂A級更新：價格 26，小計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_semantic_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請把這筆C型鋼資料整理到 workbook' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26.8 subtotal=643.2',
    });

    expect(doGenerate).toHaveBeenCalledTimes(2);
    const firstOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(firstOptions.tools?.map((tool) => tool.name)).toContain('patch_quote_workbook');
    expect(firstOptions.tools?.map((tool) => tool.name)).not.toContain('patch_workbook');
    const semanticTool = firstOptions.tools?.find((tool) => tool.name === 'patch_quote_workbook');
    expect(JSON.stringify(semanticTool?.inputSchema)).toContain('quoteLines');
    const firstSystemPrompt = firstOptions.prompt[0] as { role: 'system'; content: string };
    expect(firstSystemPrompt.content).toContain('patch_quote_workbook');
    expect(firstSystemPrompt.content).toContain('changing one quote value');

    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: true,
                  complete: true,
                  projectedOperationCount: expect.any(Number),
                  missingSheetIds: [],
                  missingCells: [],
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toContain('小計 624');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'system_order',
          rowId: 'order_1',
          columnKey: 'unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'price_sources',
          rowId: 'source_1',
          columnKey: 'adopted_unit_price',
          value: 26,
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'unit_price',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'customer_quote',
          rowId: 'customer_1',
          columnKey: 'subtotal',
          value: 624,
        }),
      ]),
    );
  });

  it('accepts semantic workbook patches that project beyond 100 cell operations', async () => {
    const semanticPatch = {
      quoteLines: Array.from({ length: 12 }, (_, index) => {
        const lineNo = index + 1;

        return {
          lineId: `line_${lineNo}`,
          lineNo,
          normalizedItemName: `測試材料 ${lineNo}`,
          adoptedProductPriceItem: `測試品項 ${lineNo}`,
          quantity: 1,
          unit: '支',
          materialUnitPrice: 100 + lineNo,
          subtotal: 100 + lineNo,
          confidence: '中',
          systemOrder: {
            itemSpec: `測試材料 ${lineNo}`,
            unit: '支',
            quantity: 1,
            totalQuantity: 1,
            unitPrice: 100 + lineNo,
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: String(1000 + lineNo),
          },
          customerQuote: {
            itemSpec: `測試材料 ${lineNo}`,
            quantity: 1,
            unit: '支',
            unitPrice: 100 + lineNo,
            subtotal: 100 + lineNo,
          },
          manualReview: {
            confirmationNeeded: `確認第 ${lineNo} 筆材料`,
          },
          interpretationNote: {
            item: `第 ${lineNo} 筆`,
            content: `第 ${lineNo} 筆報價投影`,
          },
        };
      }),
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'semantic_large_patch_1',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 8,
            text: 8,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_semantic_large_patch' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已更新 12 筆 workbook 報價資料。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_semantic_large_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請把 12 筆材料整理到 workbook' }],
      reasoningEffort: 'medium',
      workbookPatchTool: true,
      workbookContextText: 'sheet id="quote_details" label="報價明細"',
    });

    expect(response.workbookPatch?.operations.length).toBeGreaterThan(100);
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_12',
          columnKey: 'subtotal',
          value: 112,
        }),
      ]),
    );
  });

  it('does not return text before a required price lookup has executed', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '我需要你先提供客戶和長度。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 20,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_missing_price_1' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '還是需要先補資料。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 24,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 6,
            text: 6,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_missing_price_2' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: '亞L30x30 一支多少' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
        steelToolMaxCalls: 1,
      }),
    ).rejects.toThrow(
      'search_price_candidates was required before answering this Steel price request.',
    );

    expect(doGenerate).toHaveBeenCalledTimes(2);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(
      secondPrompt.some(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('lookup_quote_rules') &&
          message.content.includes('search_price_candidates'),
      ),
    ).toBe(true);
  });

  it('stops the provider loop when Steel tool execution throws a repository error', async () => {
    const doGenerate = jest.fn().mockResolvedValueOnce({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'steel_tool_call_error_1',
          toolName: 'lookup_quote_rules',
          input: JSON.stringify({
            taskTypes: ['product_price'],
            packetGroupHints: ['c_type'],
            evidenceSummary: 'C100x50x20x2.3t 6M 一支多少',
            catalogContexts: [
              {
                catalogCandidates: ['c_type'],
                packetGroupHints: ['c_type'],
                lineRefs: ['user: C100x50x20x2.3t 6M 一支多少'],
              },
            ],
            customerContext: {
              customerTierId: 2,
              tierKnown: false,
            },
            reviewState: 'reviewed',
            limit: 20,
          }),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: {
        inputTokens: {
          total: 20,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 5,
          text: 5,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_tool_error_first' },
      warnings: [],
    });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async () => {
      throw new Error('STEEL_POSTGRES_URL is required for Steel Postgres access');
    });

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        executeSteelToolCall,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'C100x50x20x2.3t 6M 一支多少' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
      }),
    ).rejects.toThrow(
      'Steel tool lookup_quote_rules failed: STEEL_POSTGRES_URL is required for Steel Postgres access',
    );
    expect(executeSteelToolCall).toHaveBeenCalledTimes(1);
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('stops the provider loop on fatal Steel tool repository errors', async () => {
    const doGenerate = jest.fn().mockResolvedValueOnce({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'steel_lookup_repo_error_1',
          toolName: 'lookup_quote_rules',
          input: JSON.stringify({
            taskTypes: ['product_price'],
            packetGroupHints: ['c_type'],
            evidenceSummary: 'C100x50x20x2.3t 6M 一支多少',
            catalogContexts: [
              {
                catalogCandidates: ['c_type'],
                packetGroupHints: ['c_type'],
                lineRefs: ['user: C100x50x20x2.3t 6M 一支多少'],
              },
            ],
            customerContext: {
              customerTierId: 2,
              tierKnown: false,
            },
            reviewState: 'reviewed',
            limit: 20,
          }),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: {
        inputTokens: {
          total: 20,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 5,
          text: 5,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_lookup_repo_error' },
      warnings: [],
    });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const executeSteelToolCall = jest.fn(async () => ({
      ok: false as const,
      toolName: 'lookup_quote_rules',
      errorCategory: 'repository_error' as const,
      errorSummary: 'Connection terminated due to connection timeout',
      durationMs: 5000,
      redactionVersion: 1 as const,
    }));

    await expect(
      sendSteelOAuthChat({
        createOpenAIOAuth,
        ensureFresh: false,
        executeSteelToolCall,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'C100x50x20x2.3t 6M 一支多少' }],
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
      }),
    ).rejects.toThrow(
      'Steel tool lookup_quote_rules failed: Connection terminated due to connection timeout',
    );

    expect(executeSteelToolCall).toHaveBeenCalledTimes(1);
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('enables only the semantic workbook patch tool and projects model tool calls into patch operations', async () => {
    const semanticPatch = {
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          materialUnitPrice: 115,
          interpretationNote: {
            item: '手動更新',
            content: 'User asked AI to update quote_details line_1 material_unit_price to 115.',
          },
        },
      ],
    };
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [
        { type: 'text', text: '已更新報價明細。' },
        {
          type: 'tool-call',
          toolCallId: 'tool_call_1',
          toolName: 'patch_quote_workbook',
          input: JSON.stringify(semanticPatch),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: {
        inputTokens: {
          total: 21,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 8,
          text: 8,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_workbook_patch_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'set quote_details line_1 material_unit_price 115' }],
      reasoningEffort: 'medium',
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="summary" label="總結"\ncolumn label="值" key="value"\nrow id="summary_total_amount" cells: item="總額"',
    });

    const generateOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(generateOptions.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('sheet id="summary" label="總結"'),
        }),
      ]),
    );
    const systemPrompt = generateOptions.prompt[0] as { role: 'system'; content: string };
    expect(systemPrompt.content).toContain('column label="值" key="value"');
    expect(systemPrompt.content).toContain('Do not ask the user for internal workbook ids or keys');
    expect(systemPrompt.content).toContain('Do not list a per-field diff');
    expect(systemPrompt.content).toContain('Do not answer only with a field count');
    expect(systemPrompt.content).toContain('Do not hand-write workbook cell operations');
    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: { type: 'auto' },
        tools: [
          expect.objectContaining({
            type: 'function',
            name: 'patch_quote_workbook',
            inputSchema: expect.objectContaining({
              properties: expect.objectContaining({
                quoteLines: expect.any(Object),
              }),
            }),
          }),
        ],
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        text: '已更新報價明細。',
        workbookPatch: {
          operations: expect.arrayContaining([
            expect.objectContaining({
              op: 'set_cell',
              sheetId: 'quote_details',
              rowId: 'line_1',
              columnKey: 'material_unit_price',
              value: 115,
              reason: expect.any(String),
            }),
          ]),
        },
      }),
    );
  });

  it('keeps the fixed OAuth/Codex path free of registered code interpreter tools', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text' as const, text: 'oauth codex path only' }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: {
          total: 20,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 5,
          text: 5,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_oauth_codex_fixed_path' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請說明 subtotal validation 狀態' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    const firstOptions = doGenerate.mock.calls[0]?.[0] as LanguageModelV3CallOptions;
    expect(firstOptions.tools).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          type: 'provider',
        }),
      ]),
    );
  });

  it('accepts confirmed workbook totals when summary values match line subtotals', async () => {
    const semanticPatch = {
      customer: {
        name: '龍頂',
        tier: 'A級',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '錏輕型鋼 100*2.3',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          confidence: '中',
          systemOrder: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: 'subtotal validation',
            content: 'summary totals match line subtotal values.',
          },
        },
      ],
      summary: {
        totalAmount: 624,
        confirmedAmount: 624,
        totalWeightKg: 24,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_total_subtotal_match',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(semanticPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_total_subtotal_match' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已依 subtotal 檢查後更新：小計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_subtotal_validated_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: '請把目前 C 型鋼 line_1 的小計整理成正式 workbook total' },
      ],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26 subtotal=null',
    });

    expect(doGenerate).toHaveBeenCalledTimes(2);
    expect(response.text).toBe('已依 subtotal 檢查後更新：小計 624。');
    expect(response).not.toHaveProperty('calculationEvidence');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_confirmed_amount',
          columnKey: 'value',
          value: 624,
        }),
      ]),
    );
  });

  it('loops when workbook summary totals do not match line subtotals', async () => {
    const wrongPatch = {
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: '錏輕型鋼 100*2.3',
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          systemOrder: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
          },
          customerQuote: {
            itemSpec: '錏輕型鋼 100*2.3，6M',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: 'subtotal validation',
            content: 'summary total must match line subtotal sum.',
          },
        },
      ],
      summary: {
        totalAmount: 625,
        confirmedAmount: 625,
      },
    };
    const correctedPatch = {
      ...wrongPatch,
      summary: {
        totalAmount: 624,
        confirmedAmount: 624,
      },
    };
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_total_mismatch',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(wrongPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 10,
            text: 10,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_total_mismatch' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'workbook_total_corrected',
            toolName: 'patch_quote_workbook',
            input: JSON.stringify(correctedPatch),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 60,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 12,
            text: 12,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_total_corrected' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '已修正總結金額：小計合計 624。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 70,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 14,
            text: 14,
            reasoning: undefined,
          },
        },
        response: { id: 'resp_total_corrected_final' },
        warnings: [],
      });
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.5',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '請把 C 型鋼 line_1 的總結金額改成 confirmed total' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
      workbookPatchTool: true,
      workbookContextText:
        'sheet id="quote_details" label="報價明細"\nrow id="line_1" cells: normalized_item_name="錏輕型鋼 100*2.3" total_weight_kg=24 material_unit_price=26 subtotal=null',
    });

    expect(doGenerate).toHaveBeenCalledTimes(3);
    const secondPrompt = (doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_quote_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  complete: false,
                  subtotalMismatch: {
                    expectedTotal: 624,
                    mismatchedFields: ['summary.totalAmount', 'summary.confirmedAmount'],
                    actualTotals: {
                      'summary.confirmedAmount': 625,
                      'summary.totalAmount': 625,
                    },
                  },
                  instruction: expect.stringContaining('sum of line subtotal values'),
                }),
              },
            }),
          ],
        }),
      ]),
    );
    expect(response.text).toBe('已修正總結金額：小計合計 624。');
    expect(response).not.toHaveProperty('calculationEvidence');
    expect(response.workbookPatch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'subtotal',
          value: 624,
        }),
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_confirmed_amount',
          columnKey: 'value',
          value: 624,
        }),
      ]),
    );
    expect(response.workbookPatch?.operations).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          sheetId: 'summary',
          rowId: 'summary_total_amount',
          columnKey: 'value',
          value: 625,
        }),
      ]),
    );
  });
});
