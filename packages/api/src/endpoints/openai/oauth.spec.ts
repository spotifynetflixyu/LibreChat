import { EModelEndpoint } from 'librechat-data-provider';
import type { ProviderInitializeParams } from '~/types';
import { initializeOpenAIOAuth } from './oauth';

const params: ProviderInitializeParams = {
  endpoint: EModelEndpoint.openAIOAuth,
  runtime: { requestBody: {} },
  db: { getUserKey: async () => '', getUserKeyValues: async () => ({ apiKey: '' }) },
};

describe('request-free OAuth provider initialization', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_DEFAULT_MODEL;
    delete process.env.STEEL_OPENAI_DEFAULT_MODEL;
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves the default model without an Express request', async () => {
    expect(await initializeOpenAIOAuth(params)).toEqual({
      provider: EModelEndpoint.openAIOAuth,
      llmConfig: { model: 'gpt-6.1-sol', streaming: true },
    });
  });

  it('returns native OAuth options without reading an OpenAI API key', async () => {
    const getUserKey = jest.fn();
    const getUserKeyValues = jest.fn();
    const result = await initializeOpenAIOAuth({
      ...params,
      model_parameters: { model: 'gpt-5.5', temperature: 0.2 },
      db: { getUserKey, getUserKeyValues },
    });
    expect(result).toEqual({
      provider: EModelEndpoint.openAIOAuth,
      llmConfig: { model: 'gpt-5.5', temperature: 0.2, streaming: true },
    });
    expect(getUserKey).not.toHaveBeenCalled();
    expect(getUserKeyValues).not.toHaveBeenCalled();
  });

  it('uses the UI-selected model instead of the configured default', async () => {
    process.env.OPENAI_DEFAULT_MODEL = 'gpt-5.6-luna';
    const result = await initializeOpenAIOAuth({
      ...params,
      model_parameters: { model: 'gpt-5.6-terra' },
    });
    expect(result.llmConfig.model).toBe('gpt-5.6-terra');
  });

  it('preserves explicit model and effort choices', async () => {
    const result = await initializeOpenAIOAuth({
      ...params,
      model_parameters: { model: 'gpt-5.6-luna', reasoning_effort: 'low' },
    });
    expect(result.llmConfig).toMatchObject({ model: 'gpt-5.6-luna', reasoning_effort: 'low' });
  });
});
