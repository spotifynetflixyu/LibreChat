import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import type { SteelOpenAIReasoningEffort } from './config';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('openai-oauth-provider')>;

type CreateOpenAIOAuth = typeof createOpenAIOAuthType;

export type SteelOAuthChatMessageRole = 'system' | 'user' | 'assistant';

export interface SteelOAuthChatFile {
  filename?: string;
  mediaType: string;
  data: Uint8Array | string | URL;
}

export interface SteelOAuthChatMessage {
  role: SteelOAuthChatMessageRole;
  content: string;
  files?: SteelOAuthChatFile[];
}

export interface SteelProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface SteelProviderChatResponse {
  provider: 'openai_oauth_responses';
  model: string;
  text: string;
  responseId?: string;
  usage?: SteelProviderUsage;
  unsupportedSettings: string[];
  warnings: string[];
}

export interface SendSteelOAuthChatOptions {
  abortSignal?: AbortSignal;
  authFilePath?: string;
  createOpenAIOAuth?: CreateOpenAIOAuth;
  ensureFresh?: boolean;
  fetch?: FetchFunction;
  maxOutputTokens?: number;
  messages: SteelOAuthChatMessage[];
  model: string;
  passThroughUnsupportedFiles?: boolean;
  reasoningEffort: SteelOpenAIReasoningEffort;
}

async function loadCreateOpenAIOAuth(): Promise<typeof createOpenAIOAuthType> {
  const provider = await dynamicImport('openai-oauth-provider');
  return provider.createOpenAIOAuth;
}

function toLanguageModelMessage(message: SteelOAuthChatMessage): LanguageModelV3Message {
  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.content,
    };
  }

  return {
    role: message.role,
    content: [
      {
        type: 'text',
        text: message.content,
      },
      ...(message.files ?? []).map((file) => {
        const mediaType = file.mediaType.trim().toLowerCase();

        return {
          type: 'file' as const,
          filename: file.filename,
          mediaType: file.mediaType,
          data: file.data,
          ...(mediaType.startsWith('image/')
            ? {
                providerOptions: {
                  openai: {
                    imageDetail: 'high',
                  },
                },
              }
            : {}),
        };
      }),
    ],
  };
}

function toPrompt(messages: SteelOAuthChatMessage[]): LanguageModelV3Prompt {
  return messages.map(toLanguageModelMessage);
}

function getGeneratedText(result: LanguageModelV3GenerateResult): string {
  return result.content.reduce((text, part) => {
    if (part.type !== 'text') {
      return text;
    }

    return `${text}${part.text}`;
  }, '');
}

function getWarningText(warning: SharedV3Warning): string {
  if (warning.type === 'other') {
    return warning.message;
  }

  return warning.details ? `${warning.feature}: ${warning.details}` : warning.feature;
}

function getUsage(result: LanguageModelV3GenerateResult): SteelProviderChatResponse['usage'] {
  const inputTokens = result.usage.inputTokens.total;
  const outputTokens = result.usage.outputTokens.total;
  const totalTokens =
    typeof inputTokens === 'number' && typeof outputTokens === 'number'
      ? inputTokens + outputTokens
      : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export async function sendSteelOAuthChat({
  abortSignal,
  authFilePath,
  createOpenAIOAuth: injectedCreateOpenAIOAuth,
  ensureFresh = true,
  fetch,
  maxOutputTokens,
  messages,
  model,
  passThroughUnsupportedFiles,
  reasoningEffort,
}: SendSteelOAuthChatOptions): Promise<SteelProviderChatResponse> {
  const createOpenAIOAuth = injectedCreateOpenAIOAuth ?? (await loadCreateOpenAIOAuth());
  const openai = createOpenAIOAuth({
    authFilePath,
    ensureFresh,
    fetch,
    responsesState: false,
  });

  const result = await openai(model).doGenerate({
    abortSignal,
    prompt: toPrompt(messages),
    maxOutputTokens,
    providerOptions: {
      openai: {
        passThroughUnsupportedFiles,
        reasoningEffort,
      },
    },
  });

  return {
    provider: 'openai_oauth_responses',
    model,
    text: getGeneratedText(result),
    responseId: result.response?.id,
    usage: getUsage(result),
    unsupportedSettings: [],
    warnings: result.warnings.map(getWarningText),
  };
}
