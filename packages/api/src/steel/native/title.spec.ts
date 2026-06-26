import type { LanguageModelV3, LanguageModelV3GenerateResult } from '@ai-sdk/provider';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import { generateOpenAIOAuthTitle } from './title';

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

function createFakeOpenAIOAuth(doGenerate: jest.Mock): typeof createOpenAIOAuthType {
  return jest.fn(() => {
    const modelFactory = (modelId: string) =>
      ({
        specificationVersion: 'v3' as const,
        provider: 'openai.responses',
        modelId,
        supportedUrls: {},
        doGenerate,
      }) satisfies LanguageModelV3;
    return modelFactory;
  }) as typeof createOpenAIOAuthType;
}

describe('generateOpenAIOAuthTitle', () => {
  it('generates a title through OpenAI OAuth without tools or Steel runtime context', async () => {
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

    const createOpenAIOAuth = createFakeOpenAIOAuth(doGenerate);

    const result = await generateOpenAIOAuthTitle({
      contentParts: [{ type: 'text', text: 'Assistant OCR table' }],
      createOpenAIOAuth,
      inputText: 'OCR檔案內容，逐一列表給我核對。',
      model: 'gpt-5.5',
      titlePrompt: 'Only return a concise title.',
      titlePromptTemplate: 'User: {input}\nAI: {output}',
    });

    const callOptions = doGenerate.mock.calls[0][0];
    const promptText = JSON.stringify(callOptions.prompt);

    expect(result).toEqual({
      model: 'gpt-5.5',
      title: 'PL OCR Review',
      usage: {
        input_tokens: 21,
        output_tokens: 5,
      },
    });
    expect(callOptions.tools).toBeUndefined();
    expect(promptText).toContain('OCR檔案內容，逐一列表給我核對。');
    expect(promptText).toContain('Assistant OCR table');
    expect(promptText).not.toContain('Steel Runtime Context');
    expect(createOpenAIOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        responsesState: false,
      }),
    );
  });
});
