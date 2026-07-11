const { EModelEndpoint } = require('librechat-data-provider');
const {
  getOpenAIModels,
  getAnthropicModels,
  getBedrockModels,
  getGoogleModels,
} = require('@librechat/api');
const { getAppConfig } = require('./app');
const loadDefaultModels = require('./loadDefaultModels');

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));

jest.mock('@librechat/api', () => ({
  mergeHeaders: jest.fn(),
  getOpenAIModels: jest.fn(),
  getAnthropicModels: jest.fn(),
  getBedrockModels: jest.fn(),
  getGoogleModels: jest.fn(),
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

  it('places OPENAI_DEFAULT_MODEL first for OpenAI and OpenAI OAuth', async () => {
    const models = await loadDefaultModels({
      config: {},
      user: { id: 'user-1' },
    });

    expect(models[EModelEndpoint.openAI]).toEqual([
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.6-terra',
    ]);
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

    expect(models[EModelEndpoint.openAI]).toEqual([
      'gpt-5.5',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
    ]);
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

    expect(models[EModelEndpoint.openAI]).toEqual([
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.6-terra',
    ]);
    expect(models[EModelEndpoint.openAIOAuth]).toEqual([
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.6-terra',
    ]);
  });
});
