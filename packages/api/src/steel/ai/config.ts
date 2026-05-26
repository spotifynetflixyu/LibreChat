import os from 'os';

export type SteelOpenAIProviderPreference = 'OAUTH' | 'API';
export type SteelOpenAIDefaultModel = 'gpt-5.4' | 'gpt-5.5';
export type SteelOpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface SteelOpenAIConfig {
  provider: SteelOpenAIProviderPreference;
  model: SteelOpenAIDefaultModel;
  reasoningEffort: SteelOpenAIReasoningEffort;
}

export interface SteelOpenAIConfigEnv {
  [key: string]: string | undefined;
  STEEL_OPENAI_PROVIDER?: string;
  STEEL_OPENAI_DEFAULT_MODEL?: string;
  STEEL_OPENAI_REASONING_EFFORT?: string;
  STEEL_OPENAI_OAUTH_AUTH_FILE?: string;
  CHATGPT_LOCAL_HOME?: string;
  CODEX_HOME?: string;
  HOME?: string;
}

export class SteelOpenAIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SteelOpenAIConfigError';
  }
}

const providerValues = ['OAUTH', 'API'] as const;
const modelValues = ['gpt-5.4', 'gpt-5.5'] as const;
const reasoningEffortValues = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

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

  throw new SteelOpenAIConfigError(`${name} must be one of: ${values.join(', ')}`);
}

export function parseSteelOpenAIConfig(env: SteelOpenAIConfigEnv = process.env): SteelOpenAIConfig {
  return {
    provider: parseEnumValue(
      'STEEL_OPENAI_PROVIDER',
      env.STEEL_OPENAI_PROVIDER,
      'OAUTH',
      providerValues,
    ),
    model: parseEnumValue(
      'STEEL_OPENAI_DEFAULT_MODEL',
      env.STEEL_OPENAI_DEFAULT_MODEL,
      'gpt-5.4',
      modelValues,
    ),
    reasoningEffort: parseEnumValue(
      'STEEL_OPENAI_REASONING_EFFORT',
      env.STEEL_OPENAI_REASONING_EFFORT,
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

export function resolveSteelOpenAIOAuthAuthFilePath(
  env: SteelOpenAIConfigEnv = process.env,
): string | undefined {
  const configuredPath = env.STEEL_OPENAI_OAUTH_AUTH_FILE;
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
