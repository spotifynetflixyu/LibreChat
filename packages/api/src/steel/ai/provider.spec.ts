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
    expect(systemPrompt.content).toContain('Do not treat raw customer text such as `亞L30x30`');
    expect(systemPrompt.content).toContain(
      'Generate material/specification candidates in reasoning',
    );
    expect(systemPrompt.content).toContain('Call backend tools when you need reviewed rows');
    expect(systemPrompt.content).toContain('lookup_defaults');
    expect(systemPrompt.content).not.toContain('lesson-memory');
    expect(systemPrompt.content).toContain('generate candidate material and specification queries');
    expect(systemPrompt.content).toContain('reviewed price rows');
    expect(systemPrompt.content).toContain('bounded options');
    expect(systemPrompt.content).toContain(
      'Ask for missing length, thickness, customer, or tier after reviewed lookup, not before',
    );
    expect(systemPrompt.content).toContain(
      'Do not pass customerTierId to search_price_candidates unless the user gave a customer/tier',
    );
    expect(systemPrompt.content).toContain(
      '未取得 search_price_candidates tool result 前，不可回答查不到',
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
              materialContexts: [
                {
                  lineRefs: ['line_1'],
                  materialCandidates: ['angle'],
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
              materialContexts: [{ materialCandidates: ['angle'] }],
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
    expect((doGenerate.mock.calls[2]?.[0] as LanguageModelV3CallOptions).toolChoice).toEqual({
      type: 'auto',
    });
    expect(executeSteelToolCall).toHaveBeenCalledTimes(2);
    expect(response.text).toBe('暫估採錏成型角鐵 30x30x2.5x6M。');
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
          message.content.includes('Call search_price_candidates'),
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
