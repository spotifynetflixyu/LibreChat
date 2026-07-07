import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import {
  ChatModelStreamHandler,
  ContentTypes,
  GraphEvents,
  Providers,
  StepTypes,
} from '@librechat/agents';
import type { BindToolsInput } from '@librechat/agents/langchain/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@librechat/agents/langchain/messages';
import { RunnableLambda } from '@librechat/agents/langchain/runnables';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import { createOpenAIOAuthGraphModel, createOpenAIOAuthModel } from './oauth';

function createUsage(): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: {
      total: 12,
      noCache: 12,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 4,
      text: 4,
      reasoning: undefined,
    },
  };
}

function createGenerateResult(
  content: LanguageModelV3GenerateResult['content'],
): LanguageModelV3GenerateResult {
  return {
    content,
    finishReason: {
      unified: 'stop',
      raw: 'stop',
    },
    usage: createUsage(),
    response: {
      id: 'resp_native_oauth',
      modelId: 'gpt-5.5',
    },
    warnings: [],
  };
}

function createFakeOpenAIOAuth({
  doGenerate,
  doStream,
}: {
  doGenerate: jest.Mock;
  doStream?: jest.Mock;
}): typeof createOpenAIOAuthType {
  return jest.fn(() => {
    const modelFactory = (modelId: string) =>
      ({
        specificationVersion: 'v3' as const,
        provider: 'openai.responses',
        modelId,
        supportedUrls: {},
        doGenerate,
        ...(doStream ? { doStream } : {}),
      }) as unknown as LanguageModelV3;

    return modelFactory as unknown as ReturnType<typeof createOpenAIOAuthType>;
  }) as unknown as typeof createOpenAIOAuthType;
}

function getGenerateCall(doGenerate: jest.Mock): LanguageModelV3CallOptions {
  return doGenerate.mock.calls[0][0] as LanguageModelV3CallOptions;
}

describe('OpenAI OAuth model adapter', () => {
  it('creates a stateless OAuth provider model and converts LangChain messages to AI SDK prompt', async () => {
    const fetchFn = jest.fn() as unknown as FetchFunction;
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '收到',
        },
      ]),
    );
    const createOpenAIOAuth = createFakeOpenAIOAuth({ doGenerate });

    const model = createOpenAIOAuthModel({
      authFilePath: '/tmp/auth.json',
      createOpenAIOAuth,
      ensureFresh: false,
      fetch: fetchFn,
      model: 'gpt-5.5',
    });

    const result = await model.invoke([
      new SystemMessage('STEEL_RULES'),
      new HumanMessage('請解析報價單'),
    ]);

    expect(createOpenAIOAuth).toHaveBeenCalledWith({
      authFilePath: '/tmp/auth.json',
      ensureFresh: false,
      fetch: fetchFn,
      responsesState: false,
    });
    expect(getGenerateCall(doGenerate).prompt).toEqual([
      {
        role: 'system',
        content: 'STEEL_RULES',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '請解析報價單',
          },
        ],
      },
    ]);
    expect(result.content).toBe('收到');
    expect(result.response_metadata).toEqual(
      expect.objectContaining({
        id: 'resp_native_oauth',
        model: 'gpt-5.5',
        model_provider: 'openai_oauth_responses',
      }),
    );
    expect(result.usage_metadata).toEqual({
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
    });
  });

  it('can be piped after a system context runnable in the native graph path', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '已解析',
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate }),
      model: 'gpt-5.5',
    });
    const systemRunnable = RunnableLambda.from((messages: unknown) => messages);

    const result = await systemRunnable.pipe(model).invoke([new HumanMessage('請 OCR PL.pdf')]);

    expect(result.content).toBe('已解析');
  });

  it('applies native graph system context when LibreChat invokes the override model directly', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '已套用 context',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate }),
        model: 'gpt-5.5',
      },
      getSystemRunnable: () =>
        RunnableLambda.from((messages: BaseMessage[]) => [
          new SystemMessage('Steel Runtime Context'),
          ...messages,
        ]),
    });

    await model.invoke([new HumanMessage('請 OCR PL.pdf')]);

    expect(getGenerateCall(doGenerate).prompt).toEqual([
      {
        role: 'system',
        content: 'Steel Runtime Context',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '請 OCR PL.pdf',
          },
        ],
      },
    ]);

    doGenerate.mockClear();

    await model.invoke([new SystemMessage('Already prepared'), new HumanMessage('確認後報價')]);

    expect(getGenerateCall(doGenerate).prompt).toEqual([
      {
        role: 'system',
        content: 'Already prepared',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '確認後報價',
          },
        ],
      },
    ]);
  });

  it('preserves native graph system context after tools are bound', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '已查詢',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate }),
        model: 'gpt-5.5',
      },
      getSystemRunnable: () =>
        RunnableLambda.from((messages: BaseMessage[]) => [
          new SystemMessage('Steel Runtime Context'),
          ...messages,
        ]),
    });
    const tool = {
      type: 'function',
      function: {
        name: 'search_customers',
        description: 'Search customers',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    } as unknown as BindToolsInput;

    await model.bindTools([tool]).invoke([new HumanMessage('查 ACME 客戶')]);

    expect(getGenerateCall(doGenerate)).toEqual(
      expect.objectContaining({
        prompt: [
          {
            role: 'system',
            content: 'Steel Runtime Context',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '查 ACME 客戶',
              },
            ],
          },
        ],
        toolChoice: { type: 'auto' },
        tools: [
          expect.objectContaining({
            type: 'function',
            name: 'search_customers',
          }),
        ],
      }),
    );
  });

  it('passes native tools to the OAuth provider and maps tool calls back to AIMessageChunk', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'tool-call',
          toolCallId: 'call_customer',
          toolName: 'search_customers',
          input: '{"query":"ACME"}',
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate }),
      model: 'gpt-5.5',
    });
    const tool = {
      type: 'function',
      function: {
        name: 'search_customers',
        description: 'Search customers',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    } as unknown as BindToolsInput;

    const result = await model.bindTools([tool]).invoke([new HumanMessage('查 ACME 客戶')]);

    expect(getGenerateCall(doGenerate).tools).toEqual([
      {
        type: 'function',
        name: 'search_customers',
        description: 'Search customers',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ]);
    expect(result.tool_calls).toEqual([
      {
        id: 'call_customer',
        name: 'search_customers',
        args: {
          query: 'ACME',
        },
        type: 'tool_call',
      },
    ]);
    expect(result.response_metadata).toEqual(
      expect.objectContaining({
        finish_reason: 'stop',
      }),
    );
  });

  it('preserves native image and PDF content parts as provider file parts', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '檔案已接收',
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate }),
      model: 'gpt-5.5',
    });

    await model.invoke([
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: '計算孔位和折彎',
          },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,IMAGE_DATA',
            },
          },
          {
            type: 'input_file',
            filename: 'drawing.pdf',
            file_data: 'data:application/pdf;base64,PDF_DATA',
          },
        ],
      }),
    ]);

    expect(getGenerateCall(doGenerate).prompt).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '計算孔位和折彎',
          },
          {
            type: 'file',
            mediaType: 'image/png',
            data: 'IMAGE_DATA',
            providerOptions: {
              openai: {
                imageDetail: 'high',
              },
            },
          },
          {
            type: 'file',
            filename: 'drawing.pdf',
            mediaType: 'application/pdf',
            data: 'PDF_DATA',
          },
        ],
      },
    ]);
  });

  it('ignores invalid image URLs instead of failing prompt conversion', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '已接收文字',
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate }),
      model: 'gpt-5.5',
    });

    await model.invoke([
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: '只保留文字',
          },
          {
            type: 'image_url',
            image_url: {
              url: 'not a valid url',
            },
          },
        ],
      }),
    ]);

    expect(getGenerateCall(doGenerate).prompt).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '只保留文字',
          },
        ],
      },
    ]);
  });

  it('sends reconstructed PL.pdf OCR confirmation history, current PDF part, and Steel tools to OpenAI OAuth', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '開始依確認的 OCR 表格報價',
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate }),
      model: 'gpt-5.5',
    });
    const ocrConfirmationMarkdown = [
      '## OCR 結果確認表',
      '',
      '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 |',
      '|---|---|---|---:|---:|',
      '| PL.pdf | PL1 | PL6*80*1000 | 4 | 8 |',
    ].join('\n');
    const steelTools = [
      {
        type: 'function',
        function: {
          name: 'search_price_candidates',
          description: 'Search price candidates for confirmed quote rows.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      },
    ] as unknown as BindToolsInput[];

    await model.bindTools(steelTools).invoke([
      new SystemMessage('Steel Runtime Context: prompt-only OCR quote rules'),
      new AIMessage(ocrConfirmationMarkdown),
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: '確認上一輪 OCR 表格正確，請依 OCR 表單給出報價。',
          },
          {
            type: 'input_file',
            filename: 'PL.pdf',
            file_data: 'data:application/pdf;base64,PL_PDF_DATA',
          },
        ],
      }),
    ]);

    expect(getGenerateCall(doGenerate)).toEqual(
      expect.objectContaining({
        prompt: [
          {
            role: 'system',
            content: 'Steel Runtime Context: prompt-only OCR quote rules',
          },
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: ocrConfirmationMarkdown,
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '確認上一輪 OCR 表格正確，請依 OCR 表單給出報價。',
              },
              {
                type: 'file',
                filename: 'PL.pdf',
                mediaType: 'application/pdf',
                data: 'PL_PDF_DATA',
              },
            ],
          },
        ],
        toolChoice: { type: 'auto' },
        tools: [
          expect.objectContaining({
            type: 'function',
            name: 'search_price_candidates',
          }),
        ],
      }),
    );
  });

  it('streams native OAuth text and final usage through AIMessageChunk iterable', async () => {
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () => {
      const parts: LanguageModelV3StreamPart[] = [
        {
          type: 'text-delta',
          id: 'text_1',
          delta: '報價',
        },
        {
          type: 'text-delta',
          id: 'text_1',
          delta: '完成',
        },
        {
          type: 'response-metadata',
          id: 'resp_stream',
          modelId: 'gpt-5.5',
        },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: {
            unified: 'stop',
            raw: 'stop',
          },
        },
      ];

      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            for (const part of parts) {
              controller.enqueue(part);
            }
            controller.close();
          },
        }),
        warnings: [],
      };
    });
    const model = createOpenAIOAuthModel({
      createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate, doStream }),
      model: 'gpt-5.5',
    });

    const stream = await model.stream([new HumanMessage('輸出報價')]);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const finalChunk = chunks[chunks.length - 1];

    expect(chunks.map((chunk) => chunk.content)).toEqual(['報價', '完成', '']);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
    expect(finalChunk?.response_metadata).toEqual(
      expect.objectContaining({
        id: 'resp_stream',
        finish_reason: 'stop',
        model: 'gpt-5.5',
      }),
    );
    expect(finalChunk?.usage_metadata).toEqual({
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
    });
  });

  it('streams native OAuth graph output through doStream without doGenerate fallback', async () => {
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({
            type: 'text-delta',
            id: 'text_1',
            delta: '第一段',
          });
          controller.enqueue({
            type: 'text-delta',
            id: 'text_1',
            delta: '第二段',
          });
          controller.enqueue({
            type: 'finish',
            usage: createUsage(),
            finishReason: {
              unified: 'stop',
              raw: 'stop',
            },
          });
          controller.close();
        },
      }),
      warnings: [],
    }));
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate, doStream }),
        model: 'gpt-5.5',
      },
      getSystemRunnable: () => RunnableLambda.from((messages: BaseMessage[]) => messages),
    });

    const stream = await model.stream([new HumanMessage('輸出報價')]);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content)).toEqual(['第一段', '第二段', '']);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('creates a message run step before forwarding native OAuth graph text deltas', async () => {
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({
            type: 'text-delta',
            id: 'text_1',
            delta: '第一段',
          });
          controller.enqueue({
            type: 'text-delta',
            id: 'text_1',
            delta: '第二段',
          });
          controller.close();
        },
      }),
      warnings: [],
    }));
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate, doStream }),
        model: 'gpt-5.5',
      },
      getSystemRunnable: () => RunnableLambda.from((messages: BaseMessage[]) => messages),
    });
    const handler = new ChatModelStreamHandler();
    const events: Array<{ event: string; data: any }> = [];
    const stepIdsByKey = new Map<string, string>();
    const runSteps = new Map<string, any>();
    const graph: any = {
      config: { configurable: { thread_id: 'thread_1' } },
      messageIdsByStepKey: new Map(),
      prelimMessageIdsByStepKey: new Map(),
      messageStepHasTextDeltas: new Set(),
      messageStepHasToolCalls: new Map(),
      toolCallStepIds: new Map(),
      sessions: new Map(),
      getAgentContext: jest.fn(() => ({
        agentId: 'agent_1',
        currentTokenType: ContentTypes.TEXT,
        graphTools: [],
        provider: Providers.OPENAI,
        reasoningKey: 'reasoning_content',
        reasoningTransitionCount: 0,
        tokenTypeSwitch: 'content',
        toolDefinitions: [],
      })),
      getStepKey: jest.fn(() => 'agent_1:0'),
      getStepIdByKey: jest.fn((stepKey: string) => stepIdsByKey.get(stepKey) ?? ''),
      getRunStep: jest.fn((stepId: string) => runSteps.get(stepId)),
      dispatchRunStep: jest.fn(async (stepKey: string, stepDetails: any) => {
        const stepId = `step_${runSteps.size + 1}`;
        stepIdsByKey.set(stepKey, stepId);
        const runStep = {
          id: stepId,
          index: runSteps.size,
          stepDetails,
          stepIndex: runSteps.size,
          type: stepDetails.type,
          usage: null,
        };
        runSteps.set(stepId, runStep);
        events.push({ event: GraphEvents.ON_RUN_STEP, data: runStep });
        return stepId;
      }),
      dispatchMessageDelta: jest.fn(async (stepId: string, delta: any) => {
        graph.messageStepHasTextDeltas.add(stepId);
        events.push({ event: GraphEvents.ON_MESSAGE_DELTA, data: { id: stepId, delta } });
      }),
      dispatchReasoningDelta: jest.fn(),
    };

    const stream = await model.stream([new HumanMessage('輸出報價')]);
    for await (const chunk of stream) {
      await handler.handle(
        GraphEvents.CHAT_MODEL_STREAM,
        { chunk },
        { langgraph_node: 'agent_1', last_agent_id: 'agent_1' },
        graph,
      );
    }

    expect(events[0]).toMatchObject({
      event: GraphEvents.ON_RUN_STEP,
      data: {
        id: 'step_1',
        stepDetails: {
          type: StepTypes.MESSAGE_CREATION,
          message_creation: { message_id: expect.stringMatching(/^msg_/) },
        },
      },
    });
    expect(events.slice(1)).toEqual([
      {
        event: GraphEvents.ON_MESSAGE_DELTA,
        data: {
          id: 'step_1',
          delta: { content: [{ type: ContentTypes.TEXT, text: '第一段' }] },
        },
      },
      {
        event: GraphEvents.ON_MESSAGE_DELTA,
        data: {
          id: 'step_1',
          delta: { content: [{ type: ContentTypes.TEXT, text: '第二段' }] },
        },
      },
    ]);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('cancels the provider stream when the native OAuth chunk consumer exits early', async () => {
    const doGenerate = jest.fn();
    const cancel = jest.fn();
    const doStream = jest.fn(async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({
            type: 'text-delta',
            id: 'text_1',
            delta: '第一段',
          });
          controller.enqueue({
            type: 'text-delta',
            id: 'text_1',
            delta: '第二段',
          });
        },
        cancel,
      }),
      warnings: [],
    }));
    const model = createOpenAIOAuthModel({
      createOpenAIOAuth: createFakeOpenAIOAuth({ doGenerate, doStream }),
      model: 'gpt-5.5',
    });

    const stream = await model.stream([new HumanMessage('輸出報價')]);
    for await (const chunk of stream) {
      expect(chunk.content).toBe('第一段');
      break;
    }

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
