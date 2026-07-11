import { EModelEndpoint } from 'librechat-data-provider';
import { initializeOpenAIOAuth } from './oauth';

describe('initializeOpenAIOAuth', () => {
  it('returns native OAuth model options without requiring an OpenAI API key', async () => {
    const result = await initializeOpenAIOAuth({
      req: {
        body: {},
        user: { id: 'user-1' },
        config: { endpoints: {} },
      },
      endpoint: EModelEndpoint.openAIOAuth,
      model_parameters: {
        model: 'gpt-5.5',
        temperature: 0.2,
      },
      db: {
        getUserKeyValues: jest.fn(),
      },
    } as unknown as Parameters<typeof initializeOpenAIOAuth>[0]);

    expect(result).toEqual({
      provider: EModelEndpoint.openAIOAuth,
      llmConfig: {
        model: 'gpt-5.5',
        temperature: 0.2,
        streaming: true,
      },
    });
  });

  it('uses the UI-selected model instead of OPENAI_DEFAULT_MODEL', async () => {
    const originalDefaultModel = process.env.OPENAI_DEFAULT_MODEL;
    process.env.OPENAI_DEFAULT_MODEL = 'gpt-5.6-luna';

    try {
      const result = await initializeOpenAIOAuth({
        req: {
          body: {},
          user: { id: 'user-1' },
          config: { endpoints: {} },
        },
        endpoint: EModelEndpoint.openAIOAuth,
        model_parameters: {
          model: 'gpt-5.6-terra',
        },
        db: {
          getUserKeyValues: jest.fn(),
        },
      } as unknown as Parameters<typeof initializeOpenAIOAuth>[0]);

      expect(result.llmConfig.model).toBe('gpt-5.6-terra');
    } finally {
      if (originalDefaultModel === undefined) {
        delete process.env.OPENAI_DEFAULT_MODEL;
      } else {
        process.env.OPENAI_DEFAULT_MODEL = originalDefaultModel;
      }
    }
  });
});
