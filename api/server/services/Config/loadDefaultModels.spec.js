const { EModelEndpoint, Providers } = require('librechat-data-provider');
const {
  getOpenAIModels,
  getAnthropicModels,
  getBedrockModels,
  getGoogleModels,
} = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { getAppConfig } = require('./app');
const loadDefaultModels = require('./loadDefaultModels');

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  mergeHeaders: jest.fn(),
  getOpenAIModels: jest.fn(),
  getAnthropicModels: jest.fn(),
  getBedrockModels: jest.fn(),
  getGoogleModels: jest.fn(),
  getAppConfigOptionsFromUser: jest.fn(),
}));

jest.mock('./app', () => ({
  getAppConfig: jest.fn(),
}));

describe('loadDefaultModels', () => {
  const originalOpenAIModels = process.env.OPENAI_MODELS;
  const originalOpenAIOAuthModels = process.env.OPENAI_OAUTH_MODELS;
  const originalOpenAIDefaultModel = process.env.OPENAI_DEFAULT_MODEL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_MODELS = 'gpt-5.5,gpt-5.6-luna,gpt-5.6-terra';
    delete process.env.OPENAI_OAUTH_MODELS;
    process.env.OPENAI_DEFAULT_MODEL = 'gpt-5.6-luna';
    getAppConfig.mockResolvedValue({});
    getOpenAIModels.mockImplementation(({ assistants, azure } = {}) => {
      if (assistants || azure) {
        return Promise.resolve([]);
      }
      return Promise.resolve(['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra']);
    });
    getAnthropicModels.mockResolvedValue([]);
    getBedrockModels.mockReturnValue([]);
    getGoogleModels.mockReturnValue([]);
  });

  afterAll(() => {
    if (originalOpenAIModels === undefined) {
      delete process.env.OPENAI_MODELS;
    } else {
      process.env.OPENAI_MODELS = originalOpenAIModels;
    }
    if (originalOpenAIOAuthModels === undefined) {
      delete process.env.OPENAI_OAUTH_MODELS;
    } else {
      process.env.OPENAI_OAUTH_MODELS = originalOpenAIOAuthModels;
    }
    if (originalOpenAIDefaultModel === undefined) {
      delete process.env.OPENAI_DEFAULT_MODEL;
    } else {
      process.env.OPENAI_DEFAULT_MODEL = originalOpenAIDefaultModel;
    }
  });

  it('defaults new chats to gpt-6.1-sol when it is available and no override is configured', async () => {
    delete process.env.OPENAI_DEFAULT_MODEL;
    getOpenAIModels.mockResolvedValue(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna']);
    const result = await loadDefaultModels({ user: { id: 'user1' } });
    expect(result[EModelEndpoint.openAIOAuth]).toEqual(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna']);
  });

  it('places OPENAI_DEFAULT_MODEL first for OpenAI and OpenAI OAuth', async () => {
    const models = await loadDefaultModels({
      config: {},
      user: { id: 'user-1' },
    });

    expect(models[EModelEndpoint.openAI]).toEqual(['gpt-5.6-luna', 'gpt-5.5', 'gpt-5.6-terra']);
    expect(models[EModelEndpoint.openAIOAuth]).toEqual([
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.6-terra',
    ]);
  });

  it('does not add OPENAI_DEFAULT_MODEL when it is outside the model allowlist', async () => {
    process.env.OPENAI_DEFAULT_MODEL = 'gpt-5.6-sol';

    const models = await loadDefaultModels({
      config: {},
      user: { id: 'user-1' },
    });

    expect(models[EModelEndpoint.openAI]).toEqual(['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra']);
    expect(models[EModelEndpoint.openAIOAuth]).toEqual([
      'gpt-5.5',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
    ]);
  });

  it('uses the OpenAI model list even when OPENAI_OAUTH_MODELS is configured', async () => {
    process.env.OPENAI_OAUTH_MODELS = 'gpt-5.6-terra,gpt-5.6-sol,gpt-5.6-luna';

    const models = await loadDefaultModels({
      config: {},
      user: { id: 'user-1' },
    });

    expect(models[EModelEndpoint.openAI]).toEqual(['gpt-5.6-luna', 'gpt-5.5', 'gpt-5.6-terra']);
    expect(models[EModelEndpoint.openAIOAuth]).toEqual([
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.6-terra',
    ]);
  });

  it('returns the Google catalog once under its configured endpoint', async () => {
    getOpenAIModels.mockResolvedValue(['gpt-5']);
    getAnthropicModels.mockResolvedValue(['claude-sonnet']);
    getBedrockModels.mockReturnValue(['amazon.nova-pro-v1:0']);
    getGoogleModels.mockReturnValue(['gemini-3.7-flash']);
    const models = await loadDefaultModels({ config: {}, user: { id: 'user-1' } });

    expect(models).toEqual(
      expect.objectContaining({
        [EModelEndpoint.openAI]: ['gpt-5'],
        [EModelEndpoint.google]: ['gemini-3.7-flash'],
        [EModelEndpoint.anthropic]: ['claude-sonnet'],
        [EModelEndpoint.bedrock]: ['amazon.nova-pro-v1:0'],
      }),
    );
    expect(models[Providers.VERTEXAI]).toBeUndefined();
    expect(getGoogleModels).toHaveBeenCalledTimes(1);
  });

  it('keeps the configured Google catalog empty when its model source fails', async () => {
    const error = new Error('Google models unavailable');
    getOpenAIModels.mockResolvedValue(['gpt-5']);
    getAnthropicModels.mockResolvedValue(['claude-sonnet']);
    getBedrockModels.mockReturnValue(['amazon.nova-pro-v1:0']);
    getGoogleModels.mockReturnValue(Promise.reject(error));

    const models = await loadDefaultModels({ config: {}, user: { id: 'user-1' } });

    expect(models[EModelEndpoint.google]).toEqual([]);
    expect(models[Providers.VERTEXAI]).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Error getting Google models:', error);
  });
});
