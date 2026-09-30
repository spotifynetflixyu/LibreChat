import type { LanguageModelV3, LanguageModelV3GenerateResult } from '@ai-sdk/provider';
import type { createOpenAIOAuthTransport as createOpenAIOAuthTransportType } from '@openai-oauth/core';
import type { openaiCredentials as openaiCredentialsType } from '@openai-oauth/local';
import { Providers, initializeModel } from '@librechat/agents';
import { EModelEndpoint } from 'librechat-data-provider';
import { RunnableLambda } from '@librechat/agents/langchain/runnables';
import { generateTitle } from './title';

jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  initializeModel: jest.fn(),
}));

const mockInitializeModel = jest.mocked(initializeModel);

function createUsage(): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: {
      total: 21,
      noCache: 21,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: undefined,
    },
  };
}

function createFakeOpenAIOAuthDependencies(doGenerate: jest.Mock) {
  const createOpenAIOAuth = jest.fn(() => {
    const modelFactory = (modelId: string) =>
      ({
        specificationVersion: 'v3' as const,
        provider: 'openai.responses',
        modelId,
        supportedUrls: {},
        doGenerate,
        doStream: async () => { throw new Error('Title generation must not stream'); },
      }) satisfies LanguageModelV3;
    const unsupportedModel = (): never => { throw new Error('Unsupported title model kind'); };
    return Object.assign(modelFactory, {
      specificationVersion: 'v3' as const,
      languageModel: modelFactory,
      embeddingModel: unsupportedModel,
      image: unsupportedModel,
      imageModel: unsupportedModel,
    });
  });
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
  const openaiCredentials = jest.fn(() => ({
    kind: 'openai-oauth' as const,
    getSession: jest.fn(),
    refreshSession: jest.fn(),
  })) as unknown as typeof openaiCredentialsType;

  return {
    options: { createOpenAIOAuth, createOpenAIOAuthTransport, openaiCredentials },
    transport,
  };
}

describe('generateTitle', () => {
  const originalModel = process.env.OPENAI_TITLE_MODEL;
  const originalEffort = process.env.OPENAI_TITLE_REASONING_EFFORT;
  afterAll(() => {
    if (originalModel === undefined) delete process.env.OPENAI_TITLE_MODEL;
    else process.env.OPENAI_TITLE_MODEL = originalModel;
    if (originalEffort === undefined) delete process.env.OPENAI_TITLE_REASONING_EFFORT;
    else process.env.OPENAI_TITLE_REASONING_EFFORT = originalEffort;
  });
  beforeEach(() => {
    mockInitializeModel.mockReset();
    delete process.env.OPENAI_TITLE_MODEL;
    delete process.env.OPENAI_TITLE_REASONING_EFFORT;
  });

  it('generates a user-message-only title through OpenAI OAuth without tools or Steel runtime context', async () => {
    const doGenerate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'PL OCR Review' }],
      finishReason: {
        unified: 'stop',
        raw: 'stop',
      },
      response: {
        id: 'resp_title',
        modelId: 'gpt-5.5',
      },
      usage: createUsage(),
      warnings: [],
    } satisfies LanguageModelV3GenerateResult);

    const dependencies = createFakeOpenAIOAuthDependencies(doGenerate);

    const result = await generateTitle({
      endpoint: EModelEndpoint.openAIOAuth,
      provider: Providers.OPENAI,
      clientOptions: {
        model: 'selected-chat-model',
      },
      contentParts: [{ type: 'text', text: 'Assistant OCR table' }],
      ...dependencies.options,
      inputText: 'OCR檔案內容，逐一列表給我核對。',
      titlePrompt: 'Only return a concise title.',
      titlePromptTemplate: 'User: {input}\nAI: {output}',
    });

    const callOptions = doGenerate.mock.calls[0][0];
    const promptText = JSON.stringify(callOptions.prompt);

    expect(result.model).toBe('gpt-6-luna');
    expect(result.title).toBe('PL OCR Review');
    expect(result.usage).toEqual({
      input_tokens: 21,
      output_tokens: 5,
    });
    expect(callOptions.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'none',
      },
    });
    expect(callOptions.temperature).toBeUndefined();
    expect(callOptions.tools).toBeUndefined();
    expect(promptText).toContain('OCR檔案內容，逐一列表給我核對。');
    expect(promptText).not.toContain('Assistant OCR table');
    expect(promptText).not.toContain('Steel Runtime Context');
    expect(dependencies.options.createOpenAIOAuthTransport).toHaveBeenCalledWith(
      expect.objectContaining({ responsesState: false }),
    );
    expect(dependencies.options.createOpenAIOAuth).toHaveBeenCalledWith(dependencies.transport);
  });

  it.each([
    ['provider-only fallback', { provider: Providers.OPENAI }],
    ['explicit OpenAI endpoint', { endpoint: EModelEndpoint.openAI, provider: Providers.OPENAI }],
  ])(
    'uses fallback title options for the OpenAI API through %s without mutating the selected client options',
    async (_requestName, request) => {
      const model = RunnableLambda.from(async () => ({ content: 'OpenAI API title' }));
      mockInitializeModel.mockReturnValue(model);
      const clientOptions = {
        model: 'selected-chat-model',
        temperature: 0.4,
      };

      const result = await generateTitle({
        ...request,
        clientOptions,
        inputText: 'Summarize this conversation.',
      });

      expect(mockInitializeModel).toHaveBeenCalledWith({
        provider: Providers.OPENAI,
        clientOptions: {
          model: 'gpt-6-luna',
          reasoning_effort: 'none',
        },
      });
      expect(clientOptions).toEqual({
        model: 'selected-chat-model',
        temperature: 0.4,
      });
      expect(result.model).toBe('gpt-6-luna');
    },
  );

  it('preserves selected client options for a custom endpoint using Providers.OPENAI', async () => {
    const model = RunnableLambda.from(async () => ({ content: 'Custom provider title' }));
    mockInitializeModel.mockReturnValue(model);
    const clientOptions = {
      model: 'custom-selected-model',
      temperature: 0.4,
    };

    const result = await generateTitle({
      endpoint: 'custom-provider',
      provider: Providers.OPENAI,
      clientOptions,
      inputText: 'Summarize this conversation.',
    });

    expect(mockInitializeModel).toHaveBeenCalledWith({
      provider: Providers.OPENAI,
      clientOptions,
    });
    expect(result.model).toBe('custom-selected-model');
  });

  it('preserves selected client options for Azure OpenAI using Providers.OPENAI', async () => {
    const model = RunnableLambda.from(async () => ({ content: 'Azure OpenAI title' }));
    mockInitializeModel.mockReturnValue(model);
    const clientOptions = {
      model: 'azure-selected-model',
      temperature: 0.4,
    };

    const result = await generateTitle({
      endpoint: EModelEndpoint.azureOpenAI,
      provider: Providers.OPENAI,
      clientOptions,
      inputText: 'Summarize this conversation.',
    });

    expect(mockInitializeModel).toHaveBeenCalledWith({
      provider: Providers.OPENAI,
      clientOptions,
    });
    expect(result.model).toBe('azure-selected-model');
  });

  it('preserves client options for non-OpenAI providers', async () => {
    const model = RunnableLambda.from(async () => ({ content: 'Anthropic title' }));
    mockInitializeModel.mockReturnValue(model);
    const clientOptions = {
      model: 'claude-selected-model',
      temperature: 0.4,
    };

    await generateTitle({
      provider: Providers.ANTHROPIC,
      clientOptions,
      inputText: 'Summarize this conversation.',
    });

    expect(mockInitializeModel).toHaveBeenCalledWith({
      provider: Providers.ANTHROPIC,
      clientOptions,
    });
  });

  it('adds file review guidance to the title prompt without overriding the model title', async () => {
    const doGenerate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'PL.pdf 內容核對' }],
      finishReason: {
        unified: 'stop',
        raw: 'stop',
      },
      response: {
        id: 'resp_title',
        modelId: 'gpt-5.5',
      },
      usage: createUsage(),
      warnings: [],
    } satisfies LanguageModelV3GenerateResult);

    const dependencies = createFakeOpenAIOAuthDependencies(doGenerate);

    const result = await generateTitle({
      endpoint: EModelEndpoint.openAIOAuth,
      provider: Providers.OPENAI,
      clientOptions: {
        model: 'gpt-5.5',
      },
      contentParts: [],
      ...dependencies.options,
      inputText: 'OCR檔案內容，逐一列表給我核對。',
      titlePrompt: [
        'Only return a concise title.',
        'File name(s): PL.pdf',
        'Title rule: For OCR or file-content review conversations, include the file name.',
      ].join('\n'),
    });
    const callOptions = doGenerate.mock.calls[0][0];
    const promptText = JSON.stringify(callOptions.prompt);

    expect(result).toEqual({
      model: 'gpt-6-luna',
      title: 'PL.pdf 內容核對',
      usage: {
        input_tokens: 21,
        output_tokens: 5,
      },
    });
    expect(promptText).toContain('File name(s): PL.pdf');
    expect(promptText).toContain('include the file name');
    expect(promptText).toContain('OCR檔案內容，逐一列表給我核對。');
  });

  it.each([
    ['custom env', ' custom-title-model ', ' low ', 'custom-title-model', 'low'],
    ['blank env', '  ', '  ', 'gpt-6-luna', 'none'],
  ])('uses %s for OAuth titles', async (_label, modelEnv, effortEnv, model, effort) => {
    process.env.OPENAI_TITLE_MODEL = modelEnv;
    process.env.OPENAI_TITLE_REASONING_EFFORT = effortEnv;
    const doGenerate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Configured title' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: createUsage(),
      warnings: [],
    } satisfies LanguageModelV3GenerateResult);
    const dependencies = createFakeOpenAIOAuthDependencies(doGenerate);
    const result = await generateTitle({
      endpoint: EModelEndpoint.openAIOAuth,
      provider: Providers.OPENAI,
      inputText: 'Title this conversation.',
      ...dependencies.options,
    });
    expect(result.model).toBe(model);
    expect(doGenerate.mock.calls[0][0].providerOptions).toEqual({
      openai: { reasoningEffort: effort },
    });
  });

  it('uses env title options for the OpenAI API without mutating chat options', async () => {
    process.env.OPENAI_TITLE_MODEL = ' custom-title-model ';
    process.env.OPENAI_TITLE_REASONING_EFFORT = ' low ';
    mockInitializeModel.mockReturnValue(
      RunnableLambda.from(async () => ({ content: 'Configured API title' })),
    );
    const clientOptions = { model: 'chat-model', temperature: 0.4 };
    const result = await generateTitle({
      endpoint: EModelEndpoint.openAI,
      provider: Providers.OPENAI,
      clientOptions,
      inputText: 'Title this conversation.',
    });
    expect(mockInitializeModel).toHaveBeenCalledWith({
      provider: Providers.OPENAI,
      clientOptions: { model: 'custom-title-model', reasoning_effort: 'low' },
    });
    expect(result.model).toBe('custom-title-model');
    expect(clientOptions).toEqual({ model: 'chat-model', temperature: 0.4 });
  });

});
