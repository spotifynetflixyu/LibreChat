import type { LanguageModelV3, LanguageModelV3GenerateResult } from '@ai-sdk/provider';
import type { createOpenAIOAuthTransport as createOpenAIOAuthTransportType } from '@openai-oauth/core';
import type { openaiCredentials as openaiCredentialsType } from '@openai-oauth/local';
import type { SteelRuntimeOtherGlobalRules } from '../runtime/context';
import type { SteelAgentRule } from '../repositories/rules';
import { generateOpenAIOAuthTitle, resolveSteelTitlePrompt } from './title';

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

describe('generateOpenAIOAuthTitle', () => {
  const originalModel = process.env.OPENAI_TITLE_MODEL;
  const originalEffort = process.env.OPENAI_TITLE_REASONING_EFFORT;
  afterAll(() => {
    if (originalModel === undefined) delete process.env.OPENAI_TITLE_MODEL;
    else process.env.OPENAI_TITLE_MODEL = originalModel;
    if (originalEffort === undefined) delete process.env.OPENAI_TITLE_REASONING_EFFORT;
    else process.env.OPENAI_TITLE_REASONING_EFFORT = originalEffort;
  });
  beforeEach(() => {
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

    const result = await generateOpenAIOAuthTitle({
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
    expect(promptText).not.toContain('Steel Runtime Context');
    expect(dependencies.options.createOpenAIOAuthTransport).toHaveBeenCalledWith(
      expect.objectContaining({ responsesState: false }),
    );
    expect(dependencies.options.createOpenAIOAuth).toHaveBeenCalledWith(dependencies.transport);
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

    const result = await generateOpenAIOAuthTitle({
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
    const result = await generateOpenAIOAuthTitle({
      inputText: 'Title this conversation.',
      ...dependencies.options,
    });
    expect(result.model).toBe(model);
    expect(doGenerate.mock.calls[0][0].providerOptions).toEqual({
      openai: { reasoningEffort: effort },
    });
  });
});

describe('resolveSteelTitlePrompt', () => {
  const titleRule: SteelAgentRule = {
    id: 1,
    slug: 'steel-conversation-title-policy',
    version: 1,
    ruleType: 'other',
    title: '對話標題規則',
    locale: 'zh-TW',
    ruleSections: ['conversation_title'],
    selectors: {},
    prompt: 'Title rule: begin with "{{first_filename}}".',
    toolPolicy: {},
    outputPolicy: {},
    priority: 40,
    confidence: 'high',
    active: true,
    reviewState: 'reviewed',
  };
  const otherRules = (titleRules: SteelAgentRule[]): SteelRuntimeOtherGlobalRules => ({
    ocrSharedRules: [],
    ocrVisionRules: [],
    ocrMainRules: [],
    ocrOrganizerRules: [],
    ocrDelegateRules: [],
    fileRules: [],
    sourcePriorityRules: [],
    markdownOutputRules: [],
    titleRules,
  });

  it('keeps the prompt and skips the rule read without attachments', async () => {
    const listOtherGlobalRules = jest.fn();
    await expect(
      resolveSteelTitlePrompt({
        titlePrompt: 'base',
        attachments: [{ filename: '  ' }],
        dependencies: { listOtherGlobalRules },
      }),
    ).resolves.toBe('base');
    expect(listOtherGlobalRules).not.toHaveBeenCalled();
  });

  it('renders filenames and the managed title rule', async () => {
    await expect(
      resolveSteelTitlePrompt({
        titlePrompt: 'base',
        attachments: [{ filename: 'PL.pdf' }, { name: 'B.png' }, { originalname: 'PL.pdf' }],
        dependencies: { listOtherGlobalRules: async () => otherRules([titleRule]) },
      }),
    ).resolves.toBe('base\n\nFile name(s): PL.pdf、B.png\nTitle rule: begin with "PL.pdf".');
  });
});
