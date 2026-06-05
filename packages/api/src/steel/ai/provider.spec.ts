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
    expect(systemPrompt.content).toContain('lookup_defaults');
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
      'the first reply must also show same-spec reviewed alternatives',
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
      'after choosing a catalog/category key, call lookup_quote_rules',
    );
    expect(systemPrompt.content).toContain('lookup_instructions is legacy-compatible');
    expect(systemPrompt.content).toContain(
      'When catalog family wording is unclear, call lookup_catalog_families for reviewed vocabulary candidates',
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
    expect(generateOptions.prompt[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '請說明亞L30x30的推論流程' }],
    });
  });

  it('executes AI-callable Steel business tools and continues with tool results', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_tool_call_1',
            toolName: 'lookup_instructions',
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
      toolName: 'lookup_instructions' as const,
      data: {
        packetGroups: [
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
      'lookup_instructions',
      'lookup_quote_rules',
      'lookup_catalog_families',
      'lookup_defaults',
      'lookup_formula',
      'search_customers',
      'search_price_candidates',
    ]);
    expect(executeSteelToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        providerToolCallId: 'steel_tool_call_1',
        toolName: 'lookup_instructions',
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
              toolName: 'lookup_instructions',
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
              toolName: 'lookup_instructions',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: true,
                  toolName: 'lookup_instructions',
                  data: expect.objectContaining({
                    packetGroups: expect.any(Array),
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
            toolName: 'lookup_instructions',
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
                  productName: '錏角鐵 L30x30',
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
      toolName: toolName as 'lookup_instructions' | 'search_price_candidates',
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
          : { packetGroups: [] },
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

  it('uses a customer lookup tier instead of the B default when a customer tier is found', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_quote_rules_unknown_customer',
            toolName: 'lookup_quote_rules',
            input: JSON.stringify({
              taskTypes: ['candidate_generation', 'material_price_lookup'],
              evidenceSummary: '龍頂 C型鋼 100x50x20 2.3t 一支多少',
              customerContext: {
                customerName: '龍頂',
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
        response: { id: 'resp_quote_rules_customer_lookup' },
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
      'lookup_quote_rules',
      'search_customers',
      'search_price_candidates',
    ]);
    expect(executeSteelToolCall.mock.calls[2]?.[0].arguments).toEqual(
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
                  productName: '錏輕型鋼',
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
    expect(serializedSecondPrompt).toContain('productName 錏輕型鋼');
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
            toolName: 'lookup_instructions',
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
                  productName: 'C型鋼',
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
        toolName: 'lookup_instructions' as const,
        data: {
          packets: [
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
        errorSummary: 'Do not use C型鋼 as productName after selecting c_type',
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
    expect(
      (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).tools?.map((tool) => tool.name),
    ).toEqual(['search_price_candidates']);
    expect(executeSteelToolCall).toHaveBeenCalledTimes(3);
    expect(response.text).toBe('找到 C 型鋼 100x2.3 的候選價格。');
  });

  it('requires a provisional workbook patch after a positive quick-price lookup when workbook context exists', async () => {
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
                  productName: '錏角鐵',
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
            toolCallId: 'workbook_patch_1',
            toolName: 'patch_workbook',
            input: JSON.stringify({
              operations: [
                {
                  op: 'set_cell',
                  sheetId: 'quote_details',
                  rowId: 'line_1',
                  columnKey: 'material_unit_price',
                  value: 194.3,
                  reason: 'Provisional estimate from reviewed positive price candidate.',
                },
                {
                  op: 'set_cell',
                  sheetId: 'quote_details',
                  rowId: 'line_1',
                  columnKey: 'confidence',
                  value: 'provisional',
                  reason: 'Thickness/customer tier still need confirmation.',
                },
              ],
            }),
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
    expect(firstSystemPrompt.content).toContain('write provisional workbook preview rows');
    expect(firstSystemPrompt.content).toContain('update the `小計` column');
    expect(firstSystemPrompt.content).toContain('Do not write confirmed totals');
    expect(firstSystemPrompt.content).not.toContain('quote_details subtotal');
    expect(firstSystemPrompt.content).toContain('interpreted order information');
    expect(firstSystemPrompt.content).toContain('Do not list a per-field diff');
    expect(firstSystemPrompt.content).toContain('Do not answer only with a field count');
    const thirdPrompt = (doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(
      thirdPrompt.some(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('patch_workbook'),
      ),
    ).toBe(true);
    const fourthPrompt = (doGenerate.mock.calls[3]?.[0] as LanguageModelV3CallOptions).prompt;
    expect(fourthPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: [
            expect.objectContaining({
              toolName: 'patch_workbook',
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: true,
                  operationCount: 2,
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
    expect(response.workbookPatch).toEqual({
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 194.3,
          reason: 'Provisional estimate from reviewed positive price candidate.',
        },
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'confidence',
          value: 'provisional',
          reason: 'Thickness/customer tier still need confirmation.',
        },
      ],
    });
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
          message.content.includes('lookup_instructions') &&
          message.content.includes('search_price_candidates'),
      ),
    ).toBe(true);
  });

  it('returns Steel tool execution failures to the model as tool results', async () => {
    const doGenerate = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'steel_tool_call_error_1',
            toolName: 'search_price_candidates',
            input: JSON.stringify({
              originalText: '亞L30x30',
              candidateQueries: [
                {
                  queryId: 'formed-angle-ya',
                  productName: '錏成型角鐵',
                  specKeyContains: '30x30',
                  reason: 'AI interpreted L30x30 as angle steel and 亞 as possible 錏',
                },
              ],
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
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '目前查表工具不可用，請稍後再試。' }],
        finishReason: { unified: 'stop', raw: 'stop' },
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
        response: { id: 'resp_steel_tool_error_final' },
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

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      executeSteelToolCall,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: '亞L30x30 一支多少' }],
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });

    const secondOptions = doGenerate.mock.calls[1]?.[0] as LanguageModelV3CallOptions;
    expect(secondOptions.prompt).toEqual(
      expect.arrayContaining([
        {
          role: 'tool',
          content: [
            expect.objectContaining({
              output: {
                type: 'json',
                value: expect.objectContaining({
                  ok: false,
                  toolName: 'search_price_candidates',
                  errorCategory: 'repository_error',
                  errorSummary: 'STEEL_POSTGRES_URL is required for Steel Postgres access',
                }),
              },
            }),
          ],
        },
      ]),
    );
  });

  it('enables the workbook patch tool and extracts model tool calls into patch operations', async () => {
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [
        { type: 'text', text: '已更新報價明細。' },
        {
          type: 'tool-call',
          toolCallId: 'tool_call_1',
          toolName: 'patch_workbook',
          input: JSON.stringify({
            operations: [
              {
                op: 'set_cell',
                sheetId: 'quote_details',
                rowId: 'line_1',
                columnKey: 'material_unit_price',
                value: 115,
                reason: 'User asked AI to update this workbook cell.',
              },
            ],
          }),
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
    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: { type: 'auto' },
        tools: [
          expect.objectContaining({
            type: 'function',
            name: 'patch_workbook',
            inputSchema: expect.objectContaining({
              properties: expect.objectContaining({
                operations: expect.objectContaining({
                  items: expect.objectContaining({
                    properties: expect.objectContaining({
                      op: { type: 'string', const: 'set_cell' },
                    }),
                  }),
                }),
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
          operations: [
            {
              op: 'set_cell',
              sheetId: 'quote_details',
              rowId: 'line_1',
              columnKey: 'material_unit_price',
              value: 115,
              reason: 'User asked AI to update this workbook cell.',
            },
          ],
        },
      }),
    );
  });
});
