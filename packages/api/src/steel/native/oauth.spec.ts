import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { BindToolsInput } from '@librechat/agents/langchain/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage } from '@librechat/agents/langchain/messages';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import { createSteelNativeOpenAIOAuthModel } from './oauth';

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

describe('Steel native OpenAI OAuth model adapter', () => {
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

    const model = createSteelNativeOpenAIOAuthModel({
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
    const model = createSteelNativeOpenAIOAuthModel({
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
    const model = createSteelNativeOpenAIOAuthModel({
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

  it('sends reconstructed PL.pdf OCR confirmation history, current PDF part, and Steel tools to OpenAI OAuth', async () => {
    const doGenerate = jest.fn(async () =>
      createGenerateResult([
        {
          type: 'text',
          text: '開始依確認的 OCR 表格報價',
        },
      ]),
    );
    const model = createSteelNativeOpenAIOAuthModel({
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
          name: 'run_file_ocr',
          description: 'Extract OCR rows from a permitted LibreChat file.',
          parameters: {
            type: 'object',
            properties: {
              fileIndex: { type: 'number' },
            },
            required: ['fileIndex'],
          },
        },
      },
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
            name: 'run_file_ocr',
          }),
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
    const model = createSteelNativeOpenAIOAuthModel({
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
});
