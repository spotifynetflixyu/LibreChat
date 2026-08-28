import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { CallbackManager } from '@langchain/core/callbacks/manager';
import {
  ChatModelStreamHandler,
  ContentTypes,
  GraphEvents,
  Providers,
  StepTypes,
  ToolNode,
} from '@librechat/agents';
import type { BindToolsInput } from '@librechat/agents/langchain/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@librechat/agents/langchain/messages';
import { RunnableLambda } from '@librechat/agents/langchain/runnables';
import type { createOpenAIOAuth as createOpenAIOAuthType } from '@openai-oauth/ai-sdk';
import type { createOpenAIOAuthTransport as createOpenAIOAuthTransportType } from '@openai-oauth/core';
import type { openaiCredentials as openaiCredentialsType } from '@openai-oauth/local';
import {
  createOpenAIOAuthGraphModel,
  createOpenAIOAuthModel,
  createStatelessOpenAIOAuthProvider,
} from './oauth';
import {
  createDelegateOcrTool,
  delegateOcrStreamedArtifact,
  delegateOcrToolName,
} from './delegate';
import { clearOpenAIOAuthCredentialInvalid, isOpenAIOAuthCredentialInvalid } from './auth-state';

jest.mock('@langchain/core/callbacks/dispatch', () => {
  const actual = jest.requireActual<typeof import('@langchain/core/callbacks/dispatch')>(
    '@langchain/core/callbacks/dispatch',
  );
  return {
    ...actual,
    dispatchCustomEvent: jest.fn(actual.dispatchCustomEvent),
  };
});

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

function createStreamResult(parts: LanguageModelV3StreamPart[]) {
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

function createFakeOpenAIOAuthDependencies(input: { doGenerate: jest.Mock; doStream?: jest.Mock }) {
  const credentials = {
    kind: 'openai-oauth' as const,
    getSession: jest.fn(),
    refreshSession: jest.fn(),
  };
  const transport = {
    kind: 'openai-compatible' as const,
    provider: 'chatgpt-codex' as const,
    baseURL: 'https://openai-oauth.local/v1',
    fetch: jest.fn(),
    request: jest.fn(),
    capabilities: {
      responses: true as const,
      chatCompletions: true as const,
      models: true as const,
      streaming: true as const,
    },
  };
  const createOpenAIOAuth = createFakeOpenAIOAuth(input);
  const createOpenAIOAuthTransport = jest.fn(
    () => transport,
  ) as unknown as typeof createOpenAIOAuthTransportType;
  const openaiCredentials = jest.fn(() => credentials) as unknown as typeof openaiCredentialsType;

  return {
    options: {
      createOpenAIOAuth,
      createOpenAIOAuthTransport,
      openaiCredentials,
    },
    transport,
  };
}

function getGenerateCall(doGenerate: jest.Mock): LanguageModelV3CallOptions {
  return doGenerate.mock.calls[0][0] as LanguageModelV3CallOptions;
}

function quoteMessages(userText = '請報價'): BaseMessage[] {
  return [
    new HumanMessage(userText),
    new ToolMessage({
      content: '{}',
      name: 'search_price_candidates',
      tool_call_id: 'call_price_fixture',
    }),
  ];
}

describe('OpenAI OAuth model adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the LibreChat credential loader for default provider credentials', async () => {
    const fetchFn = jest.fn() as unknown as FetchFunction;
    const loadAuthTokens = jest.fn(async () => ({
      accessToken: 'access_sensitive',
      accountId: 'account_test',
      sourcePath: '/tmp/default-provider-auth.json',
    }));
    const dependencies = createFakeOpenAIOAuthDependencies({ doGenerate: jest.fn() });

    await createStatelessOpenAIOAuthProvider({
      authFilePath: '/tmp/default-provider-auth.json',
      createOpenAIOAuth: dependencies.options.createOpenAIOAuth,
      createOpenAIOAuthTransport: dependencies.options.createOpenAIOAuthTransport,
      ensureFresh: false,
      fetch: fetchFn,
      loadAuthTokens,
    });

    const transportOptions = (
      dependencies.options.createOpenAIOAuthTransport as unknown as jest.Mock
    ).mock.calls[0][0] as { auth: () => Promise<unknown> };
    await expect(transportOptions.auth()).resolves.toEqual(
      expect.objectContaining({ accessToken: 'access_sensitive' }),
    );
    expect(loadAuthTokens).toHaveBeenCalledWith({
      authFilePath: '/tmp/default-provider-auth.json',
      ensureFresh: false,
      fetch: fetchFn,
    });
    expect(dependencies.options.openaiCredentials).not.toHaveBeenCalled();
  });

  it('records only an OAuth Chat 401 as invalid credential evidence', async () => {
    const authFilePath = '/tmp/oauth-chat-401-auth.json';
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) as unknown as FetchFunction;
    const dependencies = createFakeOpenAIOAuthDependencies({ doGenerate: jest.fn() });
    try {
      await createStatelessOpenAIOAuthProvider({
        authFilePath,
        ...dependencies.options,
        fetch: fetchFn,
      });
      const transportOptions = (
        dependencies.options.createOpenAIOAuthTransport as unknown as jest.Mock
      ).mock.calls[0][0] as { fetch: FetchFunction };

      await transportOptions.fetch('https://chatgpt.com/backend-api/codex/responses');
      expect(isOpenAIOAuthCredentialInvalid(authFilePath)).toBe(false);

      await transportOptions.fetch('https://chatgpt.com/backend-api/codex/responses');
      expect(isOpenAIOAuthCredentialInvalid(authFilePath)).toBe(true);

      await transportOptions.fetch('https://chatgpt.com/backend-api/codex/responses');
      expect(isOpenAIOAuthCredentialInvalid(authFilePath)).toBe(false);
    } finally {
      clearOpenAIOAuthCredentialInvalid(authFilePath);
    }
  });

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
    const dependencies = createFakeOpenAIOAuthDependencies({ doGenerate });

    const model = createOpenAIOAuthModel({
      authFilePath: '/tmp/auth.json',
      ...dependencies.options,
      ensureFresh: false,
      fetch: fetchFn,
      model: 'gpt-5.5',
    });

    const result = await model.invoke([
      new SystemMessage('STEEL_RULES'),
      new HumanMessage('請解析報價單'),
    ]);

    expect(dependencies.options.openaiCredentials).toHaveBeenCalledWith({
      authFilePath: '/tmp/auth.json',
      ensureFresh: false,
      fetch: fetchFn,
    });
    expect(dependencies.options.createOpenAIOAuthTransport).toHaveBeenCalledWith({
      auth: expect.any(Function),
      fetch: expect.any(Function),
      responsesState: false,
    });
    expect(dependencies.options.createOpenAIOAuth).toHaveBeenCalledWith(dependencies.transport);
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

  it('constructs the current OAuth provider from local credentials', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: 'luna ready',
        },
      ]),
    );
    const credentials = {
      kind: 'openai-oauth' as const,
      getSession: jest.fn(),
      refreshSession: jest.fn(),
    };
    const openaiCredentials = jest.fn(() => credentials);
    const fetchFn = jest.fn(async () => new Response()) as unknown as FetchFunction;
    const transport = {
      kind: 'openai-compatible' as const,
      provider: 'chatgpt-codex' as const,
      baseURL: 'https://openai-oauth.local/v1',
      fetch: jest.fn(),
      request: jest.fn(),
      capabilities: {
        responses: true as const,
        chatCompletions: true as const,
        models: true as const,
        streaming: true as const,
      },
    };
    const createOpenAIOAuthTransport = jest.fn(
      () => transport,
    ) as unknown as typeof createOpenAIOAuthTransportType;
    const createOpenAIOAuth = createFakeOpenAIOAuth({ doGenerate });

    const model = createOpenAIOAuthModel({
      authFilePath: '/tmp/luna-auth.json',
      createOpenAIOAuth,
      createOpenAIOAuthTransport,
      ensureFresh: false,
      fetch: fetchFn,
      model: 'gpt-5.6-luna',
      openaiCredentials,
    });

    await expect(model.invoke([new HumanMessage('Reply exactly: OK')])).resolves.toEqual(
      expect.objectContaining({ content: 'luna ready' }),
    );
    expect(openaiCredentials).toHaveBeenCalledWith({
      authFilePath: '/tmp/luna-auth.json',
      ensureFresh: false,
      fetch: expect.any(Function),
    });
    expect(createOpenAIOAuthTransport).toHaveBeenCalledWith({
      auth: expect.any(Function),
      fetch: expect.any(Function),
      responsesState: false,
    });
    expect(createOpenAIOAuth).toHaveBeenCalledWith(transport);

    const transportFetch = createOpenAIOAuthTransport.mock.calls[0]?.[0].fetch;
    expect(transportFetch).toBeDefined();
    await transportFetch?.('https://chatgpt.com/backend-api/codex/models?client_version=0.144.1');
    await transportFetch?.('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
    });
    const responseHeaders = new Headers(fetchFn.mock.calls[1]?.[1]?.headers);
    expect(responseHeaders.get('originator')).toBe('codex_cli_rs');
    expect(responseHeaders.get('user-agent')).toBe('codex_cli_rs/0.144.1');
  });

  it('does not serialize temperature for OpenAI OAuth requests', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const newline = String.fromCharCode(10);
    const fetchFn = jest.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const body = [
          `data: ${JSON.stringify({
            type: 'response.created',
            response: {
              id: 'resp_luna',
              created_at: 1,
              model: 'gpt-5.6-luna',
            },
          })}`,
          `data: ${JSON.stringify({
            type: 'response.output_text.delta',
            item_id: 'item_luna',
            delta: 'ok',
          })}`,
          `data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: 1,
                output_tokens: 1,
              },
            },
          })}`,
          'data: [DONE]',
        ].join(`${newline}${newline}`);

        return new Response(`${body}${newline}${newline}`, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    ) as unknown as FetchFunction;
    const transport = {
      kind: 'openai-compatible' as const,
      provider: 'chatgpt-codex' as const,
      baseURL: 'https://openai-oauth.local/v1',
      fetch: fetchFn,
      request: jest.fn(),
      capabilities: {
        responses: true as const,
        chatCompletions: true as const,
        models: true as const,
        streaming: true as const,
      },
    };
    const nativeRequire = process
      .getBuiltinModule('module')
      .createRequire(`${process.cwd()}/package.json`);
    const { createOpenAIOAuth } = nativeRequire(
      '@openai-oauth/ai-sdk',
    ) as typeof import('@openai-oauth/ai-sdk');
    const provider = createOpenAIOAuth(transport);
    const result = await provider('gpt-5.6-luna').doGenerate({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Reply exactly: OK' }],
        },
      ],
      providerOptions: {
        openai: {
          reasoningEffort: 'none',
        },
      },
    });

    expect(result.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'ok' }),
    ]);
    expect(requestBody).toEqual(
      expect.objectContaining({
        model: 'gpt-5.6-luna',
        reasoning: { effort: 'none' },
        stream: true,
      }),
    );
    expect(requestBody).not.toHaveProperty('temperature');
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
      ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
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
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
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

  it('returns terminal tool output directly without another provider invocation', async () => {
    const answer = '## 原始圖面確認\n\n開槽連續邊長為 1,400mm。';
    const doGenerate = jest.fn(async () => createGenerateResult([]));
    const doStream = jest.fn();
    const runSystemContext = jest.fn((messages: BaseMessage[]) => messages);
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.6-luna',
      },
      getSystemRunnable: () => RunnableLambda.from(runSystemContext),
      terminalToolNames: ['delegate_ocr'],
    });
    const messages = [
      new HumanMessage('請重新確認開槽連續邊長'),
      new ToolMessage({
        content: answer,
        name: 'delegate_ocr',
        tool_call_id: 'call_delegate_1',
      }),
    ];

    await expect(model.invoke(messages)).resolves.toEqual(
      expect.objectContaining({ content: answer }),
    );
    const stream = await model.stream(messages);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content)).toEqual([answer]);
    expect(runSystemContext).not.toHaveBeenCalled();
    expect(doGenerate).not.toHaveBeenCalled();
    expect(doStream).not.toHaveBeenCalled();
  });

  it('dedupes an artifact-marked ToolNode delegate while preserving unmarked terminal output', async () => {
    const delegateMessage = (id: string) =>
      new AIMessage({
        content: '',
        tool_calls: [
          {
            name: delegateOcrToolName,
            args: { fileKeys: ['file:image-1'] },
            id,
          },
        ],
      });
    const answer = '## 原始圖面確認\n\n開槽連續邊長為 1,400mm。';
    const streamedEvents: unknown[] = [];
    const streamedToolNode = new ToolNode({
      tools: [
        createDelegateOcrTool({
          execute: async ({ onDelta }) => {
            await onDelta?.('## 原始圖面確認\n\n');
            await onDelta?.('開槽連續邊長為 1,400mm。');
            return answer;
          },
        }),
      ],
    });
    const streamedToolMessages = (await streamedToolNode.invoke(
      [delegateMessage('call_streamed_terminal')],
      {
        configurable: { delegateOcrStreaming: true },
        callbacks: new CallbackManager('delegate-parent-run', {
          handlers: [
            {
              handleCustomEvent(_eventName: string, payload: unknown): void {
                streamedEvents.push(payload);
              },
            },
          ],
        }),
      },
    )) as ToolMessage[];
    const streamedToolMessage = streamedToolMessages[0];
    expect(streamedToolMessage).toBeInstanceOf(ToolMessage);
    expect(streamedToolMessage.content).toBe(answer);
    expect(streamedToolMessage.artifact).toEqual(delegateOcrStreamedArtifact);
    expect(streamedEvents).toHaveLength(3);

    const markedDoGenerate = jest.fn(async () => createGenerateResult([]));
    const markedDoStream = jest.fn();
    const markedSystemRunnable = jest.fn((messages: BaseMessage[]) => messages);
    const markedModel = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({
          doGenerate: markedDoGenerate,
          doStream: markedDoStream,
        }).options,
        model: 'gpt-5.6-luna',
      },
      getSystemRunnable: () => RunnableLambda.from(markedSystemRunnable),
      terminalToolNames: [delegateOcrToolName],
    });
    const terminalMessages = [
      new HumanMessage('請重新確認開槽連續邊長'),
      delegateMessage('call_streamed_terminal'),
      streamedToolMessage,
      new ToolMessage({
        content: '{"items":[]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_parallel_price',
      }),
    ];

    await expect(markedModel.invoke(terminalMessages)).resolves.toEqual(
      expect.objectContaining({ content: '' }),
    );
    const markedStream = await markedModel.stream(terminalMessages);
    const markedChunks = [];
    for await (const chunk of markedStream) {
      markedChunks.push(chunk);
    }
    expect(markedChunks.map((chunk) => chunk.content)).toEqual(['']);
    expect(markedSystemRunnable).not.toHaveBeenCalled();
    expect(markedDoGenerate).not.toHaveBeenCalled();
    expect(markedDoStream).not.toHaveBeenCalled();

    const unmarkedToolNode = new ToolNode({
      tools: [
        createDelegateOcrTool({
          execute: async () => answer,
        }),
      ],
    });
    const unmarkedToolMessages = (await unmarkedToolNode.invoke([
      delegateMessage('call_unmarked_terminal'),
    ])) as ToolMessage[];
    const unmarkedToolMessage = unmarkedToolMessages[0];
    expect(unmarkedToolMessage.artifact).toBeUndefined();
    expect(unmarkedToolMessage.content).toBe(answer);

    const unmarkedDoGenerate = jest.fn(async () => createGenerateResult([]));
    const unmarkedDoStream = jest.fn();
    const unmarkedSystemRunnable = jest.fn((messages: BaseMessage[]) => messages);
    const unmarkedModel = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({
          doGenerate: unmarkedDoGenerate,
          doStream: unmarkedDoStream,
        }).options,
        model: 'gpt-5.6-luna',
      },
      getSystemRunnable: () => RunnableLambda.from(unmarkedSystemRunnable),
      terminalToolNames: [delegateOcrToolName],
    });
    const unmarkedTerminalMessages = [
      new HumanMessage('請重新確認開槽連續邊長'),
      delegateMessage('call_unmarked_terminal'),
      unmarkedToolMessage,
      new ToolMessage({
        content: '{"items":[]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_parallel_price_unmarked',
      }),
    ];

    await expect(unmarkedModel.invoke(unmarkedTerminalMessages)).resolves.toEqual(
      expect.objectContaining({ content: answer }),
    );
    const unmarkedStream = await unmarkedModel.stream(unmarkedTerminalMessages);
    const unmarkedChunks = [];
    for await (const chunk of unmarkedStream) {
      unmarkedChunks.push(chunk);
    }
    expect(unmarkedChunks.map((chunk) => chunk.content)).toEqual([answer]);
    expect(unmarkedSystemRunnable).not.toHaveBeenCalled();
    expect(unmarkedDoGenerate).not.toHaveBeenCalled();
    expect(unmarkedDoStream).not.toHaveBeenCalled();
  });

  it('continues through the provider for non-terminal tool output', async () => {
    const doGenerate = jest.fn(async () => createGenerateResult([{ type: 'text', text: 'draft' }]));
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.6-luna',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const result = await model.invoke([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{"items":[]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ]);

    expect(result.content).toBe('draft');
    expect(doGenerate).toHaveBeenCalledTimes(1);
    expect(getGenerateCall(doGenerate).toolChoice).toEqual({ type: 'auto' });
  });

  it.each([
    ['missing system_order', '## customer_quote\nDRAFT'],
    ['missing customer_quote', '## system_order\n\nA'],
    ['reversed headings', '## customer_quote\nDRAFT\n\n## system_order\n\nA'],
    ['inline mentions', 'Please use ## system_order and ## customer_quote'],
    ['third-level headings', '### system_order\n\nA\n\n### customer_quote\nDRAFT'],
    ['fenced headings', '```markdown\n## system_order\n\nA\n\n## customer_quote\nDRAFT\n```'],
  ])('passes through %s without Stage2', async (_label, text) => {
    const doGenerate = jest.fn(async () => createGenerateResult([{ type: 'text', text }]));
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    await expect(
      model.invoke([
        new HumanMessage('請報價'),
        new ToolMessage({
          content: '{}',
          name: 'search_price_candidates',
          tool_call_id: 'call_price_1',
        }),
      ]),
    ).resolves.toEqual(expect.objectContaining({ content: text }));
    expect(doGenerate).toHaveBeenCalledTimes(1);
    expect(dispatchCustomEvent).not.toHaveBeenCalled();
  });

  it('passes through streamed headings inside a fenced block without Stage2', async () => {
    const text = '```markdown\n## system_order\n\nA\n\n## customer_quote\nDRAFT\n```';
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: '```markdown\n## system_' },
        { type: 'text-delta', id: 'text_1', delta: 'order\n\nA\n\n## customer_quote\nDRAFT\n```' },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const chunks = [];
    for await (const chunk of await model.stream([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ])) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content).join('')).toBe(text);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('passes through a mixed valid-looking response with a client tool call', async () => {
    const text = '## system_order\n\nA\n\n## customer_quote\nDRAFT';
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        { type: 'text', text },
        {
          type: 'tool-call',
          toolCallId: 'call_price_2',
          toolName: 'search_price_candidates',
          input: '{}',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const result = await model.invoke([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ]);

    expect(result.content).toBe(text);
    expect(result.tool_calls).toEqual([
      expect.objectContaining({ name: 'search_price_candidates' }),
    ]);
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('passes through valid headings when the provider already used Code Interpreter', async () => {
    const text = '## system_order\n\nA\n\n## customer_quote\n100';
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'tool-call',
          toolCallId: 'call_python',
          toolName: 'code_interpreter',
          input: '{}',
          providerExecuted: true,
        },
        { type: 'text', text },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });
    const config = {
      configurable: {
        thread_id: 'conversation_stage_1_generate',
        requestBody: { messageId: 'message_stage_1_generate' },
      },
    };

    const result = await model.invoke([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ], config);

    expect(result.content).toBe(text);
    expect(doGenerate).toHaveBeenCalledTimes(1);
    expect(dispatchCustomEvent).toHaveBeenCalledTimes(1);
    expect(dispatchCustomEvent).toHaveBeenCalledWith(
      'steel_event',
      expect.objectContaining({
        type: 'quote_audit',
        stage: 'stage_1',
        status: 'executed',
        message: 'Code Interpreter executed',
        toolName: 'code_interpreter',
        providerToolCallId: 'call_python',
      }),
      expect.objectContaining({ configurable: config.configurable }),
    );
  });

  it('streams valid headings without Stage2 when the provider already used Code Interpreter', async () => {
    const text = '## system_order\n\nA\n\n## customer_quote\n100';
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        {
          type: 'tool-call',
          toolCallId: 'call_python',
          toolName: 'code_interpreter',
          input: '{}',
          providerExecuted: true,
        },
        { type: 'text-delta', id: 'text_1', delta: text },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });
    const config = {
      configurable: {
        thread_id: 'conversation_stage_1_stream',
        requestBody: { messageId: 'message_stage_1_stream' },
      },
    };

    const chunks = [];
    for await (const chunk of await model.stream(
      [
        new HumanMessage('請報價'),
        new ToolMessage({
          content: '{}',
          name: 'search_price_candidates',
          tool_call_id: 'call_price_1',
        }),
      ],
      config,
    )) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content).join('')).toBe(text);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
    expect(dispatchCustomEvent).toHaveBeenCalledTimes(1);
    expect(dispatchCustomEvent).toHaveBeenCalledWith(
      'steel_event',
      expect.objectContaining({
        type: 'quote_audit',
        stage: 'stage_1',
        status: 'executed',
        message: 'Code Interpreter executed',
        toolName: 'code_interpreter',
        providerToolCallId: 'call_python',
      }),
      expect.objectContaining({ configurable: config.configurable }),
    );
  });

  it('does not audit a client-executed Code Interpreter tool call', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'tool-call',
          toolCallId: 'call_client_python',
          toolName: 'code_interpreter',
          input: '{}',
          providerExecuted: false,
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    await model.invoke(
      [
        new HumanMessage('請報價'),
        new ToolMessage({
          content: '{}',
          name: 'search_price_candidates',
          tool_call_id: 'call_price_1',
        }),
      ],
      { configurable: { thread_id: 'conversation_client_python' } },
    );

    expect(dispatchCustomEvent).not.toHaveBeenCalled();
  });

  it('keeps fenced headings as pass-through when opener and closer split across deltas', async () => {
    const text = '```markdown\n## system_order\n\nA\n\n## customer_quote\nDRAFT\n```';
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: '`' },
        {
          type: 'text-delta',
          id: 'text_1',
          delta: '``markdown\n## system_order\n\nA\n\n## customer_quote\nDRAFT\n',
        },
        { type: 'text-delta', id: 'text_1', delta: '``' },
        { type: 'text-delta', id: 'text_1', delta: '`' },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const chunks = [];
    for await (const chunk of await model.stream([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ])) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content).join('')).toBe(text);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('flushes Stage1 before a tool-input-start and preserves stream metadata', async () => {
    const text = '## system_order\n\nA\n\n## customer_quote\nDRAFT';
    const responseMetadata = {
      type: 'response-metadata' as const,
      id: 'resp_tool_input',
      modelId: 'gpt-5.5',
    };
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: text },
        {
          type: 'tool-input-start',
          id: 'input_1',
          toolName: 'search_price_candidates',
        },
        responseMetadata,
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const chunks = [];
    for await (const chunk of await model.stream([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ])) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content).join('')).toBe(text);
    expect(chunks[chunks.length - 1]?.response_metadata).toEqual(
      expect.objectContaining({
        id: responseMetadata.id,
        finish_reason: 'tool_calls',
        model: responseMetadata.modelId,
      }),
    );
    expect(chunks[chunks.length - 1]?.usage_metadata).toEqual({
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
    });
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('flushes pending Stage1 text before a client tool call and skips Stage2', async () => {
    const stageOne = '## system_order\n\nA';
    const draft = '\n\n## customer_quote\nDRAFT';
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: `${stageOne}${draft}` },
        {
          type: 'tool-call',
          toolCallId: 'call_price_2',
          toolName: 'search_price_candidates',
          input: '{}',
        },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const chunks = [];
    for await (const chunk of await model.stream([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ])) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content).join('')).toBe(`${stageOne}${draft}`);
    expect(chunks.findIndex((chunk) => chunk.content.includes('DRAFT'))).toBeLessThan(
      chunks.findIndex((chunk) => chunk.tool_calls?.[0]?.name === 'search_price_candidates'),
    );
    expect(chunks[chunks.length - 1]?.usage_metadata).toEqual({
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
    });
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(dispatchCustomEvent).not.toHaveBeenCalled();
  });

  it('flushes buffered manual_review unchanged before a provider error', async () => {
    const prefix = [
      '## system_order',
      '',
      '| 品名規格 | 總數 | 單價 |',
      '|---|---:|---:|',
      '| A | 2 | 10.5 |',
      '',
    ].join('\n');
    const manualReview = ['## manual_review', '', '| 問題欄位 |', '|---|', '| 尺寸 |'].join('\n');
    const providerError = new Error('provider failed');
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: `${prefix}## manual_` },
        {
          type: 'text-delta',
          id: 'text_1',
          delta: `review\n${manualReview.slice('## manual_review\n'.length)}`,
        },
        { type: 'error', error: providerError },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });
    const output = await model.stream(quoteMessages());
    const iterator = output[Symbol.asyncIterator]();

    const first = await iterator.next();
    const second = await iterator.next();
    expect(first.value?.content).toBe(prefix);
    expect(second.value?.content).toBe(manualReview);
    expect(`${first.value?.content ?? ''}${second.value?.content ?? ''}`).toBe(
      `${prefix}${manualReview}`,
    );
    expect(`${first.value?.content ?? ''}${second.value?.content ?? ''}`).not.toContain(
      '## customer_quote',
    );
    await expect(iterator.next()).rejects.toThrow(providerError);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(dispatchCustomEvent).not.toHaveBeenCalled();
  });

  it('does not retry a truncated generate result as a final draft', async () => {
    const truncatedResult = createGenerateResult([{ type: 'text', text: 'partial' }]);
    truncatedResult.finishReason = { unified: 'length', raw: 'length' };
    const doGenerate = jest.fn(async () => truncatedResult);
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const result = await model.invoke([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ]);

    expect(result.content).toBe('partial');
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('does not retry a truncated stream as a final draft', async () => {
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: 'partial' },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'length', raw: 'length' },
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const chunks = [];
    for await (const chunk of await model.stream([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ])) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content)).toEqual(['partial', '']);
    expect(doStream).toHaveBeenCalledTimes(1);
  });

  it('passes through a provider Code Interpreter generate result without retrying', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'tool-call',
          toolCallId: 'call_python',
          toolName: 'code_interpreter',
          input: '{}',
          providerExecuted: true,
        },
        {
          type: 'text',
          text: '| 品項 | 價格 |\n|---|---:|\n| A | 100 |',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const result = await model.invoke([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{"items":[{"name":"A"}]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ]);

    expect(result.content).toBe('| 品項 | 價格 |\n|---|---:|\n| A | 100 |');
    expect(doGenerate).toHaveBeenCalledTimes(1);
    expect(getGenerateCall(doGenerate).toolChoice).toEqual({ type: 'auto' });
  });

  it('passes through a provider Code Interpreter stream without retrying', async () => {
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        {
          type: 'tool-call',
          toolCallId: 'call_python',
          toolName: 'code_interpreter',
          input: '{}',
          providerExecuted: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'call_python',
          toolName: 'code_interpreter',
          result: '100',
        },
        {
          type: 'text-delta',
          id: 'text_1',
          delta: '| 品項 | 價格 |\n|---|---:|\n| A | 100 |',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const chunks = [];
    for await (const chunk of await model.stream([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{"items":[{"name":"A"}]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ])) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      '| 品項 | 價格 |\n|---|---:|\n| A | 100 |',
      '',
    ]);
    expect(chunks.some((chunk) => (chunk.tool_calls?.length ?? 0) > 0)).toBe(false);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(
      ((doStream as jest.Mock).mock.calls[0][0] as LanguageModelV3CallOptions).toolChoice,
    ).toEqual({ type: 'auto' });
  });

  it('passes through a client price requery without retrying', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'tool-call',
          toolCallId: 'call_price_2',
          toolName: 'search_price_candidates',
          input: '{"query":"A 2mm"}',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const result = await model.invoke([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{"items":[{"name":"A"}]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ]);

    expect(result.tool_calls).toEqual([
      {
        id: 'call_price_2',
        name: 'search_price_candidates',
        args: { query: 'A 2mm' },
        type: 'tool_call',
      },
    ]);
    expect(doGenerate).toHaveBeenCalledTimes(1);
    expect(getGenerateCall(doGenerate).toolChoice).toEqual({ type: 'auto' });
  });

  it('passes through a client price requery stream without retrying', async () => {
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        {
          type: 'tool-call',
          toolCallId: 'call_price_2',
          toolName: 'search_price_candidates',
          input: '{"query":"A 2mm"}',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    const chunks = [];
    for await (const chunk of await model.stream([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{"items":[{"name":"A"}]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ])) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.tool_calls).toEqual([
      {
        id: 'call_price_2',
        name: 'search_price_candidates',
        args: { query: 'A 2mm' },
        type: 'tool_call',
      },
    ]);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
    expect(
      ((doStream as jest.Mock).mock.calls[0][0] as LanguageModelV3CallOptions).toolChoice,
    ).toEqual({ type: 'auto' });
  });

  it('keeps auto tool choice when a price result belongs to an earlier turn', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '先確認新需求',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    await model.invoke([
      new HumanMessage('上一輪報價'),
      new ToolMessage({
        content: '{"items":[]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
      new HumanMessage('請確認新需求'),
    ]);

    expect(getGenerateCall(doGenerate).toolChoice).toEqual({ type: 'auto' });
  });

  it('keeps auto tool choice when there is no current-turn price result', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '請提供規格',
        },
      ]),
    );
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });

    await model.invoke([new HumanMessage('請報價')]);

    expect(getGenerateCall(doGenerate).toolChoice).toEqual({ type: 'auto' });
  });

  it('keeps auto tool choice and does not retry when Code Interpreter is disabled', async () => {
    const doGenerate = jest.fn(async () => createGenerateResult([{ type: 'text', text: 'draft' }]));
    const model = createOpenAIOAuthGraphModel({
      modelOptions: {
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        enableCodeInterpreter: false,
        model: 'gpt-5.5',
      },
      terminalToolNames: ['delegate_ocr'],
    });
    const tool = {
      type: 'function',
      function: {
        name: 'search_customers',
        description: 'Search customers',
        parameters: { type: 'object', properties: {} },
      },
    } as unknown as BindToolsInput;

    await model.bindTools([tool]).invoke([
      new HumanMessage('請報價'),
      new ToolMessage({
        content: '{"items":[{"name":"A"}]}',
        name: 'search_price_candidates',
        tool_call_id: 'call_price_1',
      }),
    ]);

    expect(doGenerate).toHaveBeenCalledTimes(1);
    expect(getGenerateCall(doGenerate).toolChoice).toEqual({ type: 'auto' });
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
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
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
          expect.objectContaining({
            type: 'provider',
            id: 'openai.code_interpreter',
            name: 'code_interpreter',
          }),
        ],
      }),
    );
  });

  it('adds the provider-hosted Code Interpreter by default and allows explicit disabling', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: 'ok',
        },
      ]),
    );
    const tool = {
      type: 'function',
      function: {
        name: 'search_customers',
        description: 'Search customers',
        parameters: { type: 'object', properties: {} },
      },
    } as unknown as BindToolsInput;
    const dependencies = createFakeOpenAIOAuthDependencies({ doGenerate });
    const enabledModel = createOpenAIOAuthModel({
      ...dependencies.options,
      model: 'gpt-5.5',
    });
    await enabledModel.bindTools([tool]).invoke([new HumanMessage('報價')]);

    expect(getGenerateCall(doGenerate).tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'search_customers' }),
      {
        type: 'provider',
        id: 'openai.code_interpreter',
        name: 'code_interpreter',
        args: {},
      },
    ]);

    doGenerate.mockClear();
    const disabledModel = createOpenAIOAuthModel({
      ...dependencies.options,
      enableCodeInterpreter: false,
      model: 'gpt-5.5',
    });
    await disabledModel.bindTools([tool]).invoke([new HumanMessage('報價')]);
    expect(getGenerateCall(doGenerate).tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'search_customers' }),
    ]);
  });

  it('omits provider-executed calls and results while preserving final text', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'tool-call',
          toolCallId: 'call_python',
          toolName: 'code_interpreter',
          input: '{}',
          providerExecuted: true,
        },
        {
          type: 'text',
          text: '計算完成',
        },
      ]),
    );
    const dependencies = createFakeOpenAIOAuthDependencies({ doGenerate });
    const model = createOpenAIOAuthModel({
      ...dependencies.options,
      enableCodeInterpreter: true,
      model: 'gpt-5.5',
    });

    const result = await model.invoke(quoteMessages());
    expect(result.content).toBe('計算完成');
    expect(result.tool_calls).toHaveLength(0);

    const doStream = jest.fn(async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({
            type: 'tool-call',
            toolCallId: 'call_python',
            toolName: 'code_interpreter',
            input: '{}',
            providerExecuted: true,
          });
          controller.enqueue({
            type: 'tool-result',
            toolCallId: 'call_python',
            toolName: 'code_interpreter',
            result: '計算完成',
          });
          controller.enqueue({ type: 'text-delta', id: 'text_1', delta: '計算完成' });
          controller.close();
        },
      }),
      warnings: [],
    }));
    const streamingModel = createOpenAIOAuthModel({
      ...createFakeOpenAIOAuthDependencies({ doGenerate: jest.fn(), doStream }).options,
      enableCodeInterpreter: true,
      model: 'gpt-5.5',
    });
    const chunks = [];
    for await (const chunk of await streamingModel.stream([new HumanMessage('請報價')])) {
      chunks.push(chunk);
    }
    expect(chunks.map((chunk) => chunk.content)).toEqual(['計算完成', '']);
    expect(chunks.some((chunk) => (chunk.tool_calls?.length ?? 0) > 0)).toBe(false);
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
      ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
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
      {
        type: 'provider',
        id: 'openai.code_interpreter',
        name: 'code_interpreter',
        args: {},
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
      ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
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
            type: 'image_url',
            image_url: {
              url: 'data:image/jpeg;base64,LOW_DETAIL_IMAGE_DATA',
              detail: 'low',
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
            mediaType: 'image/jpeg',
            data: 'LOW_DETAIL_IMAGE_DATA',
            providerOptions: {
              openai: {
                imageDetail: 'low',
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
      ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
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
      ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
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
          expect.objectContaining({
            type: 'provider',
            id: 'openai.code_interpreter',
            name: 'code_interpreter',
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
      ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
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
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
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
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
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

  it('generates customer_quote in the backend before manual_review with one provider call', async () => {
    const providerText = [
      '## system_order｜報價.pdf（file-1）',
      '',
      '| 備註 | 單價 | 品名規格 | 總數 |',
      '|---|---:|---|---:|',
      '| 現貨 | 38.5 | PL6\\|54 | 2.060154 |',
      '',
      '## manual_review｜報價.pdf（file-1）',
      '',
      '| 問題欄位 |',
      '|---|',
      '| 無 |',
    ].join('\n');
    const doGenerate = jest.fn(async () =>
      createGenerateResult([{ type: 'text', text: providerText }]),
    );
    const model = createOpenAIOAuthModel({
      ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
      model: 'gpt-5.5',
    });

    const result = await model.invoke(quoteMessages());
    const content = String(result.content);

    expect(content).toContain(
      '## customer_quote｜報價.pdf（file-1）\n\n| 項目 | 總數 | 小計 |\n| --- | --- | --- |\n| PL6\\|54 | 2.060154 | 80 |\n| 總計 |  | 80 |',
    );
    expect(content.indexOf('## system_order')).toBeLessThan(content.indexOf('## customer_quote'));
    expect(content.indexOf('## customer_quote')).toBeLessThan(content.indexOf('## manual_review'));
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it.each(['invoke', 'stream'] as const)(
    'preserves one existing customer_quote during %s',
    async (mode) => {
      const providerText = [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| A | 1 | 2 |',
        '',
        '## customer_quote',
        '| 項目 | 總數 | 小計 |',
        '| --- | --- | --- |',
        '| A | 1 | 2 |',
        '| 總計 |  | 2 |',
      ].join('\n');
      const doGenerate = jest.fn(async () =>
        createGenerateResult([{ type: 'text', text: providerText }]),
      );
      const doStream = jest.fn(async () =>
        createStreamResult([
          { type: 'text-delta', id: 'text_1', delta: providerText },
          {
            type: 'finish',
            usage: createUsage(),
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ]),
      );
      const model = createOpenAIOAuthModel({
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      });

      let content: string;
      if (mode === 'invoke') {
        content = String((await model.invoke(quoteMessages())).content);
      } else {
        const chunks = [];
        for await (const chunk of await model.stream(quoteMessages())) {
          chunks.push(chunk);
        }
        content = chunks.map((chunk) => chunk.content).join('');
      }

      expect(content).toBe(providerText);
      expect(content.match(/## customer_quote/g)).toHaveLength(1);
    },
  );

  it.each(['invoke', 'stream'] as const)(
    'does not compose customer_quote outside a current price-result flow during %s',
    async (mode) => {
      const providerText = [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| OCR only | 1 | 2 |',
      ].join('\n');
      const doGenerate = jest.fn(async () =>
        createGenerateResult([{ type: 'text', text: providerText }]),
      );
      const doStream = jest.fn(async () =>
        createStreamResult([
          { type: 'text-delta', id: 'text_1', delta: providerText },
          {
            type: 'finish',
            usage: createUsage(),
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ]),
      );
      const model = createOpenAIOAuthModel({
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      });
      const messages = [new HumanMessage('只整理內容')];

      let content: string;
      if (mode === 'invoke') {
        content = String((await model.invoke(messages)).content);
      } else {
        const chunks = [];
        for await (const chunk of await model.stream(messages)) {
          chunks.push(chunk);
        }
        content = chunks.map((chunk) => chunk.content).join('');
      }

      expect(content).toBe(providerText);
      expect(content).not.toContain('## customer_quote');
    },
  );

  it('buffers a split manual_review heading and inserts one backend quote before it', async () => {
    const prefix = [
      '## system_order',
      '',
      '| 品名規格 | 總數 | 單價 |',
      '|---|---:|---:|',
      '| A | 2 | 10.5 |',
      '',
    ].join('\n');
    const manualReview = [
      '## manual_review',
      '',
      '| 問題欄位 |',
      '|---|',
      '| 尺寸 |',
    ].join('\n');
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: `${prefix}## manual_` },
        {
          type: 'text-delta',
          id: 'text_1',
          delta: `review\n${manualReview.slice('## manual_review\n'.length)}`,
        },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
      model: 'gpt-5.5',
    });

    const output = await model.stream(quoteMessages());
    const iterator = output[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value?.content).toContain('## system_order');
    expect(first.value?.content).not.toContain('manual_review');

    const chunks = first.done || !first.value ? [] : [first.value];
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      chunks.push(next.value);
    }
    const content = chunks.map((chunk) => chunk.content).join('');

    expect(content).toContain('| A | 2 | 21 |');
    expect(content.indexOf('## customer_quote')).toBeLessThan(content.indexOf('## manual_review'));
    expect(content.match(/## customer_quote/g)).toHaveLength(1);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('appends exactly one backend quote at clean stop without manual_review', async () => {
    const providerText = [
      '## system_order｜訂單',
      '',
      '| 品名規格 | 總數 | 單價 |',
      '|---|---:|---:|',
      '| A | 2 | 10.5 |',
    ].join('\n');
    const expectedQuote = [
      '## customer_quote｜訂單',
      '',
      '| 項目 | 總數 | 小計 |',
      '| --- | --- | --- |',
      '| A | 2 | 21 |',
      '| 總計 |  | 21 |',
    ].join('\n');
    const doGenerate = jest.fn(async () =>
      createGenerateResult([{ type: 'text', text: providerText }]),
    );
    const model = createOpenAIOAuthModel({
      ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
      model: 'gpt-5.5',
    });

    const result = await model.invoke(quoteMessages());
    const content = String(result.content);

    expect(content).toBe(`${providerText}\n\n${expectedQuote}`);
    expect(content.match(/## customer_quote/g)).toHaveLength(1);
    expect(doGenerate).toHaveBeenCalledTimes(1);
  });

  it('inserts the backend quote after system_order and before trailing summary text', async () => {
    const systemOrder = [
      '## system_order｜訂單',
      '',
      '| 品名規格 | 總數 | 單價 |',
      '|---|---:|---:|',
      '| A | 2 | 10.5 |',
    ].join('\n');
    const summary = '查價輸出完成：共 1 筆 system_order，無待複核事項。';
    const providerText = `${systemOrder}\n\n${summary}`;
    const expectedQuote = [
      '## customer_quote｜訂單',
      '',
      '| 項目 | 總數 | 小計 |',
      '| --- | --- | --- |',
      '| A | 2 | 21 |',
      '| 總計 |  | 21 |',
    ].join('\n');
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: providerText },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
      model: 'gpt-5.5',
    });

    const chunks = [];
    for await (const chunk of await model.stream(quoteMessages())) {
      chunks.push(chunk);
    }
    const content = chunks.map((chunk) => chunk.content).join('');

    expect(content).toBe(`${systemOrder}\n\n${expectedQuote}\n\n${summary}`);
    expect(content.match(/## customer_quote/g)).toHaveLength(1);
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('preserves CRLF and trailing row spaces when inserting a streamed quote', async () => {
    const systemOrder = [
      '## system_order｜訂單',
      '',
      '| 品名規格 | 總數 | 單價 |',
      '|---|---:|---:|',
      '| A | 2 | 10.5 |   ',
    ].join('\r\n');
    const summary = '查價輸出完成。';
    const providerText = `${systemOrder}\r\n\r\n${summary}`;
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: providerText },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
      model: 'gpt-5.5',
    });

    const chunks = [];
    for await (const chunk of await model.stream(quoteMessages())) {
      chunks.push(chunk);
    }
    const content = chunks.map((chunk) => chunk.content).join('');

    expect(content).toContain('| A | 2 | 10.5 |   \r\n\n## customer_quote｜訂單');
    expect(content).toContain('| A | 2 | 21 |');
    expect(content.indexOf('## customer_quote')).toBeLessThan(content.indexOf(summary));
    expect(content.match(/## customer_quote/g)).toHaveLength(1);
  });

  it('streams a split table row without a leading pipe before provider completion', async () => {
    const prefix = [
      '## system_order｜訂單',
      '',
      '品名規格 | 總數 | 單價',
      '---|---:|---:',
      '',
    ].join('\n');
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        { type: 'text-delta', id: 'text_1', delta: prefix },
        { type: 'text-delta', id: 'text_1', delta: 'A | 2 | 10.5' },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
      model: 'gpt-5.5',
    });

    const output = await model.stream(quoteMessages());
    const iterator = output[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();

    expect(first.value?.content).toContain('品名規格 | 總數 | 單價');
    expect(second.value?.content).toBe('A | 2 | 10.5');
    expect(second.value?.content).not.toContain('customer_quote');
    await iterator.return?.();
  });

  it.each([
    ['單價', '| 品名規格 | 總數 |', '|---|---:|', '| A | 2 |'],
    ['總數', '| 品名規格 | 單價 |', '|---|---:|', '| A | 10.5 |'],
  ])(
    'passes manual_review unchanged when system_order is missing %s',
    async (_missing, header, separator, row) => {
      const providerText = [
        '## system_order｜訂單',
        '',
        header,
        separator,
        row,
        '',
        '## manual_review｜訂單',
        '',
        '| 問題欄位 |',
        '|---|',
        '| 尺寸 |',
      ].join('\n');
      const doGenerate = jest.fn();
      const doStream = jest.fn(async () =>
        createStreamResult([
          { type: 'text-delta', id: 'text_1', delta: providerText },
          {
            type: 'finish',
            usage: createUsage(),
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ]),
      );
      const model = createOpenAIOAuthModel({
        ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
        model: 'gpt-5.5',
      });

      const chunks = [];
      for await (const chunk of await model.stream(quoteMessages())) {
        chunks.push(chunk);
      }
      const content = chunks.map((chunk) => chunk.content).join('');

      expect(content).toBe(providerText);
      expect(content).toContain('## manual_review｜訂單');
      expect(content).not.toContain('## customer_quote');
      expect(doStream).toHaveBeenCalledTimes(1);
      expect(doGenerate).not.toHaveBeenCalled();
    },
  );

  it.each(['length', 'tool-calls'] as const)(
    'does not append a backend quote for a %s finish',
    async (finishReason) => {
      const providerText = [
        '## system_order｜訂單',
        '',
        '| 品名規格 | 總數 | 單價 |',
        '|---|---:|---:|',
        '| A | 2 | 10.5 |',
      ].join('\n');
      const result = createGenerateResult([{ type: 'text', text: providerText }]);
      result.finishReason = { unified: finishReason, raw: finishReason };
      const doGenerate = jest.fn(async () => result);
      const model = createOpenAIOAuthModel({
        ...createFakeOpenAIOAuthDependencies({ doGenerate }).options,
        model: 'gpt-5.5',
      });

      const output = await model.invoke(quoteMessages());

      expect(output.content).toBe(providerText);
      expect(String(output.content)).not.toContain('## customer_quote');
      expect(doGenerate).toHaveBeenCalledTimes(1);
    },
  );

  it('inserts a quote before a fenced manual_review at clean stop', async () => {
    const systemOrder = [
      '## system_order｜訂單',
      '',
      '| 品名規格 | 總數 | 單價 |',
      '|---|---:|---:|',
      '| A | 2 | 10.5 |',
    ].join('\n');
    const fencedText = [
      '```markdown',
      '## manual_review｜訂單',
      '',
      '| 問題欄位 |',
      '|---|',
      '| 尺寸 |',
      '```',
    ].join('\n');
    const providerText = `${systemOrder}\n\n${fencedText}`;
    const expectedQuote = [
      '## customer_quote｜訂單',
      '',
      '| 項目 | 總數 | 小計 |',
      '| --- | --- | --- |',
      '| A | 2 | 21 |',
      '| 總計 |  | 21 |',
    ].join('\n');
    const doGenerate = jest.fn();
    const doStream = jest.fn(async () =>
      createStreamResult([
        {
          type: 'text-delta',
          id: 'text_1',
          delta: providerText,
        },
        {
          type: 'finish',
          usage: createUsage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
    );
    const model = createOpenAIOAuthModel({
      ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
      model: 'gpt-5.5',
    });

    const chunks = [];
    for await (const chunk of await model.stream(quoteMessages())) {
      chunks.push(chunk);
    }
    const content = chunks.map((chunk) => chunk.content).join('');
    const fenceEnd = content.indexOf('```', content.indexOf('## manual_review'));
    const quoteStart = content.indexOf('## customer_quote');

    expect(content).toBe(`${systemOrder}\n\n${expectedQuote}\n\n${fencedText}`);
    expect(content.match(/## customer_quote/g)).toHaveLength(1);
    expect(fenceEnd).toBeGreaterThan(-1);
    expect(quoteStart).toBeLessThan(content.indexOf('```markdown'));
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
      ...createFakeOpenAIOAuthDependencies({ doGenerate, doStream }).options,
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
