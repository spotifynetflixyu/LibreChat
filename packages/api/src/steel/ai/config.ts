import os from 'os';

export type OpenAIProviderPreference = 'OAUTH' | 'API';
export type OpenAIDefaultModel = string;
export type OpenAIReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface OpenAIConfig {
  provider: OpenAIProviderPreference;
  model: OpenAIDefaultModel;
  reasoningEffort: OpenAIReasoningEffort;
}

export interface OpenAIConfigEnv {
  [key: string]: string | undefined;
  OPENAI_PROVIDER?: string;
  OPENAI_DEFAULT_MODEL?: string;
  OPENAI_REASONING_EFFORT?: string;
  OPENAI_OAUTH_AUTH_FILE?: string;
  STEEL_OPENAI_PROVIDER?: string;
  STEEL_OPENAI_DEFAULT_MODEL?: string;
  STEEL_OPENAI_REASONING_EFFORT?: string;
  STEEL_OPENAI_OAUTH_AUTH_FILE?: string;
  CHATGPT_LOCAL_HOME?: string;
  CODEX_CLI_PATH?: string;
  CODEX_HOME?: string;
  HOME?: string;
  OPENAI_OAUTH_CODEX_LOGIN_TIMEOUT_MS?: string;
  STEEL_OPENAI_OAUTH_CODEX_LOGIN_TIMEOUT_MS?: string;
}

export class OpenAIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAIConfigError';
  }
}

const providerValues = ['OAUTH', 'API'] as const;
const defaultModel = 'gpt-5.5';
const reasoningEffortValues = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

function getEnvValue(env: OpenAIConfigEnv, key: string, legacyKey: string): string | undefined {
  return env[key] ?? env[legacyKey];
}

function parseEnumValue<T extends string>(
  name: string,
  value: string | undefined,
  fallback: T,
  values: readonly T[],
): T {
  if (!value) {
    return fallback;
  }

  if (values.includes(value as T)) {
    return value as T;
  }

  throw new OpenAIConfigError(`${name} must be one of: ${values.join(', ')}`);
}

function parseModelValue(value: string | undefined): OpenAIDefaultModel {
  const model = value?.trim();
  return model || defaultModel;
}

export function parseOpenAIConfig(env: OpenAIConfigEnv = process.env): OpenAIConfig {
  return {
    provider: parseEnumValue(
      'OPENAI_PROVIDER',
      getEnvValue(env, 'OPENAI_PROVIDER', 'STEEL_OPENAI_PROVIDER'),
      'OAUTH',
      providerValues,
    ),
    model: parseModelValue(getEnvValue(env, 'OPENAI_DEFAULT_MODEL', 'STEEL_OPENAI_DEFAULT_MODEL')),
    reasoningEffort: parseEnumValue(
      'OPENAI_REASONING_EFFORT',
      getEnvValue(env, 'OPENAI_REASONING_EFFORT', 'STEEL_OPENAI_REASONING_EFFORT'),
      'medium',
      reasoningEffortValues,
    ),
  };
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function resolveOpenAIOAuthAuthFilePath(
  env: OpenAIConfigEnv = process.env,
): string | undefined {
  const configuredPath = getEnvValue(env, 'OPENAI_OAUTH_AUTH_FILE', 'STEEL_OPENAI_OAUTH_AUTH_FILE');
  if (!configuredPath) {
    return undefined;
  }

  const home = env.HOME || os.homedir();
  const envValues: Record<string, string | undefined> = {
    CHATGPT_LOCAL_HOME: env.CHATGPT_LOCAL_HOME,
    CODEX_HOME: env.CODEX_HOME,
    HOME: home,
  };
  const stripped = stripWrappingQuotes(configuredPath);
  const expandedHome =
    stripped === '~' || stripped.startsWith('~/') ? `${home}${stripped.slice(1)}` : stripped;
  const expandedEnv = expandedHome.replace(
    /\$(?:\{(CHATGPT_LOCAL_HOME|CODEX_HOME|HOME)\}|(CHATGPT_LOCAL_HOME|CODEX_HOME|HOME))/g,
    (match, bracedName: string | undefined, bareName: string | undefined) => {
      const name = bracedName ?? bareName;
      if (!name) {
        return match;
      }
      return envValues[name] ?? match;
    },
  );

  return expandedEnv.length > 0 ? expandedEnv : undefined;
}
