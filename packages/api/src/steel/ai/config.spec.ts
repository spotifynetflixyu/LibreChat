import { resolveOpenAIOAuthAuthFilePath, OpenAIConfigError, parseOpenAIConfig } from './config';

describe('OpenAI runtime config', () => {
  it('defaults to OAuth, gpt-5.5, and medium reasoning effort', () => {
    expect(parseOpenAIConfig({})).toEqual({
      provider: 'OAUTH',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });
  });

  it('accepts API provider with the active approved model', () => {
    expect(
      parseOpenAIConfig({
        OPENAI_PROVIDER: 'API',
        OPENAI_DEFAULT_MODEL: 'gpt-5.5',
        OPENAI_REASONING_EFFORT: 'xhigh',
      }),
    ).toEqual({
      provider: 'API',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
    });
  });

  it('accepts a GPT-5.6 model as the LibreChat default', () => {
    expect(
      parseOpenAIConfig({
        OPENAI_DEFAULT_MODEL: 'gpt-5.6-luna',
      }),
    ).toEqual({
      provider: 'OAUTH',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'medium',
    });
  });

  it('accepts max reasoning effort for GPT-5.6', () => {
    expect(
      parseOpenAIConfig({
        OPENAI_DEFAULT_MODEL: 'gpt-5.6-luna',
        OPENAI_REASONING_EFFORT: 'max',
      }),
    ).toEqual({
      provider: 'OAUTH',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'max',
    });
  });

  it('accepts legacy Steel env names for existing deployments', () => {
    expect(
      parseOpenAIConfig({
        STEEL_OPENAI_PROVIDER: 'API',
        STEEL_OPENAI_DEFAULT_MODEL: 'gpt-5.5',
        STEEL_OPENAI_REASONING_EFFORT: 'xhigh',
      }),
    ).toEqual({
      provider: 'API',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
    });
  });

  it('rejects invalid provider and reasoning effort values', () => {
    expect(() =>
      parseOpenAIConfig({
        OPENAI_PROVIDER: 'LOCAL',
      }),
    ).toThrow(OpenAIConfigError);
    expect(() =>
      parseOpenAIConfig({
        OPENAI_REASONING_EFFORT: 'extreme',
      }),
    ).toThrow(OpenAIConfigError);
  });

  it('expands common local auth file path expressions', () => {
    expect(
      resolveOpenAIOAuthAuthFilePath({
        HOME: '/Users/tester',
        OPENAI_OAUTH_AUTH_FILE: '$HOME/.codex/auth.json',
      }),
    ).toBe('/Users/tester/.codex/auth.json');
    expect(
      resolveOpenAIOAuthAuthFilePath({
        HOME: '/Users/tester',
        OPENAI_OAUTH_AUTH_FILE: '~/.codex/auth.json',
      }),
    ).toBe('/Users/tester/.codex/auth.json');
    expect(
      resolveOpenAIOAuthAuthFilePath({
        CODEX_HOME: '/tmp/codex-home',
        OPENAI_OAUTH_AUTH_FILE: '${CODEX_HOME}/auth.json',
      }),
    ).toBe('/tmp/codex-home/auth.json');
  });

  it('expands legacy Steel auth file path expressions', () => {
    expect(
      resolveOpenAIOAuthAuthFilePath({
        HOME: '/Users/tester',
        STEEL_OPENAI_OAUTH_AUTH_FILE: '$HOME/.codex/auth.json',
      }),
    ).toBe('/Users/tester/.codex/auth.json');
  });
});
