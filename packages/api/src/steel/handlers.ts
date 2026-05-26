import { buildSteelModelOptions } from './models';
import {
  parseSteelOpenAIConfig,
  resolveSteelOpenAIOAuthAuthFilePath,
  type SteelOpenAIConfigEnv,
} from './ai/config';
import {
  sendSteelOAuthChat,
  type SendSteelOAuthChatOptions,
  type SteelOAuthChatMessage,
  type SteelProviderChatResponse,
} from './ai/provider';

import type { Request, Response } from 'express';

type ModelsConfig = Record<string, string[] | undefined>;

interface SteelRequest extends Request {
  config?: {
    modelSpecs?: {
      list?: Array<{
        name: string;
        label?: string;
        default?: boolean;
        preset: {
          endpoint?: string | null;
          model?: string | null;
          temperature?: number;
          top_p?: number;
          topP?: number;
          max_tokens?: number;
          maxOutputTokens?: number;
          reasoning_summary?: string;
          reasoningSummary?: string;
          verbosity?: string;
        };
      }>;
    };
  };
}

export interface SteelHandlersDeps {
  env?: SteelOpenAIConfigEnv;
  getModelsConfig: (req: Request) => Promise<ModelsConfig>;
  sendChat?: (options: SendSteelOAuthChatOptions) => Promise<SteelProviderChatResponse>;
}

type SteelChatErrorProvider = 'openai_oauth_responses' | 'openai_api';

interface SteelChatErrorResponse {
  provider: SteelChatErrorProvider;
  model: string;
  text: '';
  unsupportedSettings: string[];
  warnings: string[];
  errorCategory: 'auth' | 'provider_timeout' | 'unknown';
  errorSummary: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createErrorResponse(
  provider: SteelChatErrorProvider,
  model: string,
  errorCategory: SteelChatErrorResponse['errorCategory'],
  errorSummary: string,
): SteelChatErrorResponse {
  return {
    provider,
    model,
    text: '',
    unsupportedSettings: [],
    warnings: [],
    errorCategory,
    errorSummary,
  };
}

function parseMessages(value: unknown): SteelOAuthChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('messages must contain at least one chat message');
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`messages[${index}] must be an object`);
    }

    const { role, content } = item;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new Error(`messages[${index}].role must be system, user, or assistant`);
    }
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error(`messages[${index}].content must be a non-empty string`);
    }

    return { role, content };
  });
}

function parseOptionalModel(value: unknown, defaultModel: string): string {
  if (value === undefined) {
    return defaultModel;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('model must be a non-empty string when provided');
  }

  return value;
}

function parseOptionalMaxOutputTokens(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('maxOutputTokens must be a positive integer when provided');
  }

  return value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getProviderErrorCategory(error: unknown): SteelChatErrorResponse['errorCategory'] {
  const message = getErrorMessage(error).toLowerCase();
  if (
    message.includes('access token') ||
    message.includes('account id') ||
    message.includes('auth')
  ) {
    return 'auth';
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'provider_timeout';
  }

  return 'unknown';
}

function getProviderErrorSummary(error: unknown): string {
  const category = getProviderErrorCategory(error);
  if (category === 'auth') {
    return 'OpenAI OAuth auth is unavailable. Run Codex login on the server or configure server auth material.';
  }
  if (category === 'provider_timeout') {
    return 'OpenAI OAuth provider request timed out.';
  }

  return 'OpenAI OAuth provider request failed.';
}

export function createSteelHandlers({
  env = process.env,
  getModelsConfig,
  sendChat = sendSteelOAuthChat,
}: SteelHandlersDeps) {
  return {
    async chat(req: Request, res: Response) {
      const config = parseSteelOpenAIConfig(env);
      const body = isRecord(req.body) ? req.body : {};

      let messages: SteelOAuthChatMessage[];
      let model: string;
      let maxOutputTokens: number | undefined;
      try {
        messages = parseMessages(body.messages);
        model = parseOptionalModel(body.model, config.model);
        maxOutputTokens = parseOptionalMaxOutputTokens(body.maxOutputTokens);
      } catch (error) {
        res
          .status(400)
          .json(
            createErrorResponse(
              'openai_oauth_responses',
              config.model,
              'unknown',
              getErrorMessage(error),
            ),
          );
        return;
      }

      if (config.provider === 'API') {
        res
          .status(501)
          .json(
            createErrorResponse(
              'openai_api',
              model,
              'unknown',
              'STEEL_OPENAI_PROVIDER=API is reserved for the OpenAI API adapter, which is not implemented in this slice.',
            ),
          );
        return;
      }

      try {
        const result = await sendChat({
          authFilePath: resolveSteelOpenAIOAuthAuthFilePath(env),
          maxOutputTokens,
          messages,
          model,
          reasoningEffort: config.reasoningEffort,
        });
        res.status(200).json(result);
      } catch (error) {
        res
          .status(502)
          .json(
            createErrorResponse(
              'openai_oauth_responses',
              model,
              getProviderErrorCategory(error),
              getProviderErrorSummary(error),
            ),
          );
      }
    },

    async listModels(req: SteelRequest, res: Response) {
      const models = await getModelsConfig(req);
      const options = buildSteelModelOptions({
        models,
        modelSpecs: req.config?.modelSpecs,
      });
      res.status(200).json({ options });
    },
  };
}

export function createSteelAdminHandlers() {
  return {
    async requestCapabilitySmoke(_req: Request, res: Response) {
      res.status(202).json({
        status: 'accepted',
        provider: 'openai_oauth_responses',
      });
    },
  };
}
