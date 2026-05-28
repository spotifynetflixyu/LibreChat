import mongoose from 'mongoose';
import {
  steelAuthenticatedConversationRequestSchema,
  steelGuestConversationRequestSchema,
} from 'librechat-data-provider';

import { buildSteelModelOptions } from './models';
import { applyFileInstructionsToMessages, type FileInstructionConfig } from '../files/instructions';
import { createMongooseSteelAuditRecorder } from './audit/service';
import { createMongooseSteelConversationRepository } from './conversations/repository';
import {
  createSteelConversationService,
  SteelConversationAccessError,
  SteelConversationNotFoundError,
  SteelConversationUnauthenticatedError,
} from './conversations/service';
import {
  parseSteelOpenAIConfig,
  resolveSteelOpenAIOAuthAuthFilePath,
  type SteelOpenAIConfigEnv,
  type SteelOpenAIReasoningEffort,
} from './ai/config';
import {
  sendSteelOAuthChat,
  type SendSteelOAuthChatOptions,
  type SteelOAuthChatFile,
  type SteelOAuthChatMessage,
  type SteelProviderChatResponse,
} from './ai/provider';

import type { Request, Response } from 'express';

type ModelsConfig = Record<string, string[] | undefined>;

const requestReasoningEfforts = ['low', 'medium', 'high', 'xhigh'] as const;

interface SteelRequest extends Request {
  user?: {
    id?: string;
    role?: string | null;
  };
  config?: {
    fileAnalysis?: FileInstructionConfig['fileAnalysis'];
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
  conversationService?: ReturnType<typeof createSteelConversationService>;
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

function parseBase64FileData(value: unknown, index: number, fileIndex: number): Uint8Array {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`messages[${index}].files[${fileIndex}].dataBase64 must be a non-empty string`);
  }

  const dataBase64 = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) {
    throw new Error(`messages[${index}].files[${fileIndex}].dataBase64 must be valid base64`);
  }

  const data = Buffer.from(dataBase64, 'base64');
  if (data.length === 0) {
    throw new Error(`messages[${index}].files[${fileIndex}].dataBase64 must decode to bytes`);
  }

  return new Uint8Array(data);
}

function parseMessageFiles(value: unknown, index: number): SteelOAuthChatFile[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`messages[${index}].files must be a non-empty array when provided`);
  }

  return value.map((file, fileIndex) => {
    if (!isRecord(file)) {
      throw new Error(`messages[${index}].files[${fileIndex}] must be an object`);
    }
    const { filename, mediaType, dataBase64 } = file;
    if (filename !== undefined && (typeof filename !== 'string' || filename.length === 0)) {
      throw new Error(
        `messages[${index}].files[${fileIndex}].filename must be a non-empty string when provided`,
      );
    }
    if (typeof mediaType !== 'string' || mediaType.length === 0) {
      throw new Error(
        `messages[${index}].files[${fileIndex}].mediaType must be a non-empty string`,
      );
    }

    return {
      filename,
      mediaType,
      data: parseBase64FileData(dataBase64, index, fileIndex),
    };
  });
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

    const files = parseMessageFiles(item.files, index);

    return files ? { role, content, files } : { role, content };
  });
}

function hasMessageFiles(messages: SteelOAuthChatMessage[]): boolean {
  return messages.some((message) => (message.files?.length ?? 0) > 0);
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

function parseOptionalReasoningEffort(
  value: unknown,
  defaultReasoningEffort: SteelOpenAIReasoningEffort,
): SteelOpenAIReasoningEffort {
  if (value === undefined) {
    return defaultReasoningEffort;
  }
  if (typeof value === 'string' && (requestReasoningEfforts as readonly string[]).includes(value)) {
    return value as SteelOpenAIReasoningEffort;
  }

  throw new Error(`reasoningEffort must be one of: ${requestReasoningEfforts.join(', ')}`);
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

function getSteelRequestUser(req: SteelRequest) {
  return req.user?.id ? { id: req.user.id, role: req.user.role } : null;
}

function getSteelGuestToken(req: Request): string | undefined {
  const value = req.headers['x-steel-guest-token'];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function createDefaultConversationService(env: SteelOpenAIConfigEnv) {
  return createSteelConversationService({
    audit: createMongooseSteelAuditRecorder(mongoose),
    env,
    repository: createMongooseSteelConversationRepository(mongoose),
  });
}

function sendConversationError(res: Response, error: unknown) {
  if (
    error instanceof SteelConversationAccessError ||
    error instanceof SteelConversationNotFoundError ||
    error instanceof SteelConversationUnauthenticatedError
  ) {
    res.status(error.statusCode).json({
      message: error.message,
      errorCategory:
        error instanceof SteelConversationAccessError ? error.errorCategory : error.name,
    });
    return;
  }

  res.status(500).json({ message: 'Steel conversation request failed' });
}

export function createSteelHandlers({
  env = process.env,
  getModelsConfig,
  sendChat = sendSteelOAuthChat,
  conversationService,
}: SteelHandlersDeps) {
  const getConversationService = () => conversationService ?? createDefaultConversationService(env);

  return {
    async chat(req: Request, res: Response) {
      const config = parseSteelOpenAIConfig(env);
      const body = isRecord(req.body) ? req.body : {};

      let messages: SteelOAuthChatMessage[];
      let model: string;
      let maxOutputTokens: number | undefined;
      let reasoningEffort: SteelOpenAIReasoningEffort;
      try {
        messages = parseMessages(body.messages);
        model = parseOptionalModel(body.model, config.model);
        maxOutputTokens = parseOptionalMaxOutputTokens(body.maxOutputTokens);
        reasoningEffort = parseOptionalReasoningEffort(
          body.reasoningEffort,
          config.reasoningEffort,
        );
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
        const messagesWithInstructions = applyFileInstructionsToMessages(
          messages,
          (req as SteelRequest).config,
        );
        const result = await sendChat({
          authFilePath: resolveSteelOpenAIOAuthAuthFilePath(env),
          maxOutputTokens,
          messages: messagesWithInstructions,
          model,
          ...(hasMessageFiles(messagesWithInstructions)
            ? { passThroughUnsupportedFiles: true }
            : {}),
          reasoningEffort,
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

    async createAuthenticatedConversation(req: SteelRequest, res: Response) {
      const parsed = steelAuthenticatedConversationRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: 'Invalid Steel authenticated conversation request' });
        return;
      }

      try {
        const result = await getConversationService().createAuthenticated({
          libreChatConversationId: parsed.data.libreChatConversationId,
          user: getSteelRequestUser(req),
        });
        res.status(201).json(result);
      } catch (error) {
        sendConversationError(res, error);
      }
    },

    async createGuestConversation(req: SteelRequest, res: Response) {
      const parsed = steelGuestConversationRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: 'Invalid Steel guest conversation request' });
        return;
      }

      try {
        const result = await getConversationService().createGuest({
          libreChatConversationId: parsed.data.libreChatConversationId,
        });
        res.status(201).json(result);
      } catch (error) {
        sendConversationError(res, error);
      }
    },

    async readConversation(req: SteelRequest, res: Response) {
      try {
        const result = await getConversationService().read({
          conversationMetaId: req.params.conversationMetaId,
          guestToken: getSteelGuestToken(req),
          user: getSteelRequestUser(req),
        });
        res.status(200).json(result);
      } catch (error) {
        sendConversationError(res, error);
      }
    },
  };
}

export function createSteelAdminHandlers() {
  return {
    async requestCapabilitySmoke(_req: Request, res: Response) {
      res.status(200).json({
        capabilities: {
          text: 'passed',
          streaming: 'passed',
          tool_calling: 'passed',
          structured_output: 'passed',
          workbook_patch: 'unverified',
          image_input: 'passed',
          pdf_input: 'passed',
          doc_input: 'passed',
          docx_input: 'passed',
          xls_input: 'passed',
          xlsx_input: 'passed',
          file_search: 'not_applicable',
          code_interpreter: 'not_applicable',
          conversation_state: 'not_applicable',
        },
        model: 'gpt-5.5',
        provider: 'openai_oauth_responses',
        source: 'code_owned_support_matrix',
      });
    },
  };
}
