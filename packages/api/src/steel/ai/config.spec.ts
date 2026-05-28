import {
  parseSteelOpenAIConfig,
  resolveSteelOpenAIOAuthAuthFilePath,
  SteelOpenAIConfigError,
} from './config';

describe('Steel OpenAI runtime config', () => {
  it('defaults to OAuth, gpt-5.5, and medium reasoning effort', () => {
    expect(parseSteelOpenAIConfig({})).toEqual({
      provider: 'OAUTH',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });
  });

  it('accepts API provider with the active approved model', () => {
    expect(
      parseSteelOpenAIConfig({
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

  it('rejects invalid provider, model, and reasoning effort values', () => {
    expect(() =>
      parseSteelOpenAIConfig({
        STEEL_OPENAI_PROVIDER: 'LOCAL',
      }),
    ).toThrow(SteelOpenAIConfigError);
    expect(() =>
      parseSteelOpenAIConfig({
        STEEL_OPENAI_DEFAULT_MODEL: 'gpt-5.4',
      }),
    ).toThrow(SteelOpenAIConfigError);
    expect(() =>
      parseSteelOpenAIConfig({
        STEEL_OPENAI_DEFAULT_MODEL: 'gpt-4.1',
      }),
    ).toThrow(SteelOpenAIConfigError);
    expect(() =>
      parseSteelOpenAIConfig({
        STEEL_OPENAI_REASONING_EFFORT: 'extreme',
      }),
    ).toThrow(SteelOpenAIConfigError);
  });

  it('expands common local auth file path expressions', () => {
    expect(
      resolveSteelOpenAIOAuthAuthFilePath({
        HOME: '/Users/tester',
        STEEL_OPENAI_OAUTH_AUTH_FILE: '$HOME/.codex/auth.json',
      }),
    ).toBe('/Users/tester/.codex/auth.json');
    expect(
      resolveSteelOpenAIOAuthAuthFilePath({
        HOME: '/Users/tester',
        STEEL_OPENAI_OAUTH_AUTH_FILE: '~/.codex/auth.json',
      }),
    ).toBe('/Users/tester/.codex/auth.json');
    expect(
      resolveSteelOpenAIOAuthAuthFilePath({
        CODEX_HOME: '/tmp/codex-home',
        STEEL_OPENAI_OAUTH_AUTH_FILE: '${CODEX_HOME}/auth.json',
      }),
    ).toBe('/tmp/codex-home/auth.json');
  });
});
