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
});
