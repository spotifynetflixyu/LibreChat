import mongoose from 'mongoose';
import { logger } from '@librechat/data-schemas';
import {
  steelAuthenticatedConversationRequestSchema,
  steelGuestConversationRequestSchema,
  steelProviderChatRequestSchema,
  steelProviderWorkbookPatchProposalSchema,
  steelWorkbookCreateRequestSchema,
} from 'librechat-data-provider';
import { ZodError } from 'zod';

import { buildSteelModelOptions } from './models';
import { applyFileInstructionsToMessages, type FileInstructionConfig } from '../files/instructions';
import { createMongooseSteelAuditRecorder } from './audit/service';
import { createMongooseSteelConversationRepository } from './conversations/repository';
import { createMongooseSteelRuleProposalRepository } from './rules/repository';
import { createMongooseSteelWorkbookRepository } from './workbook/repository';
import {
  createSteelConversationService,
  SteelConversationAccessError,
  SteelConversationNotFoundError,
  SteelConversationUnauthenticatedError,
} from './conversations/service';
import { createSteelRuleProposalService, SteelRuleProposalValidationError } from './rules/service';
import {
  createSteelWorkbookService,
  SteelWorkbookNotFoundError,
  SteelWorkbookValidationError,
  SteelWorkbookVersionConflictError,
} from './workbook/service';
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
  type SteelProviderChatResponse as SteelOAuthProviderChatResponse,
} from './ai/provider';

import type { Request, Response } from 'express';
import type { z } from 'zod';
import type {
  SteelWorkbook,
  SteelWorkbookCellValue,
  SteelProviderWorkbookPatchProposal,
  SteelWorkbookPatchResponse,
} from 'librechat-data-provider';

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
  sendChat?: (options: SendSteelOAuthChatOptions) => Promise<SteelChatProviderResult>;
  conversationService?: ReturnType<typeof createSteelConversationService>;
  ruleProposalService?: ReturnType<typeof createSteelRuleProposalService>;
  workbookService?: ReturnType<typeof createSteelWorkbookService>;
}

type SteelChatProviderResult = Omit<SteelOAuthProviderChatResponse, 'workbookPatch'> & {
  workbookPatch?: SteelProviderWorkbookPatchProposal;
};

type SteelChatHandlerResult = Omit<SteelOAuthProviderChatResponse, 'workbookPatch'> & {
  workbookPatch?: SteelWorkbookPatchResponse;
};

type SteelChatErrorProvider = 'openai_oauth_responses' | 'openai_api';

interface SteelChatErrorResponse {
  provider: SteelChatErrorProvider;
  model: string;
  text: '';
  unsupportedSettings: string[];
  warnings: string[];
  errorCategory: 'auth' | 'provider_timeout' | 'structured_output_invalid' | 'unknown';
  errorSummary: string;
}

const steelChatWorkbookContextSchema = steelProviderChatRequestSchema.pick({
  workbookId: true,
  workbookVersion: true,
  selectedWorkbookRefs: true,
});

type SteelChatWorkbookContext = z.infer<typeof steelChatWorkbookContextSchema>;

const maxWorkbookContextRowsPerSheet = 80;
const maxWorkbookContextCellLength = 120;

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

function createDefaultRuleProposalService() {
  return createSteelRuleProposalService({
    repository: createMongooseSteelRuleProposalRepository(mongoose),
  });
}

function createDefaultWorkbookService() {
  return createSteelWorkbookService({
    repository: createMongooseSteelWorkbookRepository(mongoose),
  });
}

function escapeWorkbookContextText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxWorkbookContextCellLength);
}

function formatWorkbookContextCellValue(value: SteelWorkbookCellValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return `"${escapeWorkbookContextText(value)}"`;
  }

  return String(value);
}

function formatWorkbookContextCells(row: SteelWorkbook['sheets'][number]['rows'][number]): string {
  const cells = Object.entries(row.cells).map(([key, value]) => {
    return `${escapeWorkbookContextText(key)}=${formatWorkbookContextCellValue(value)}`;
  });

  return cells.length > 0 ? cells.join(' ') : '(empty)';
}

function createWorkbookContextText(workbook: SteelWorkbook): string {
  return workbook.sheets
    .map((sheet) => {
      const columns = sheet.columns
        .map((column) => {
          return [
            `column label="${escapeWorkbookContextText(column.label)}"`,
            `key="${escapeWorkbookContextText(column.key)}"`,
            `type="${column.valueType}"`,
            `editable=${column.editable}`,
          ].join(' ');
        })
        .join('\n');
      const rows = sheet.rows
        .slice(0, maxWorkbookContextRowsPerSheet)
        .map((row) => {
          return `row id="${escapeWorkbookContextText(row.id)}" cells: ${formatWorkbookContextCells(row)}`;
        })
        .join('\n');

      return [
        `sheet id="${sheet.id}" label="${escapeWorkbookContextText(sheet.label)}"`,
        'columns:',
        columns || '(no columns)',
        'rows:',
        rows || '(no rows)',
      ].join('\n');
    })
    .join('\n\n');
}

async function getChatWorkbookContextText(
  workbookContext: SteelChatWorkbookContext,
  getWorkbookService: () => ReturnType<typeof createSteelWorkbookService>,
): Promise<string | undefined> {
  if (!workbookContext.workbookId || !workbookContext.workbookVersion) {
    return undefined;
  }

  const readResult = await getWorkbookService().read({ workbookId: workbookContext.workbookId });
  return createWorkbookContextText(readResult.workbook);
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

function sendRuleProposalError(res: Response, error: unknown) {
  if (error instanceof SteelRuleProposalValidationError) {
    res.status(error.statusCode).json({
      message: error.message,
      errorCategory: error.errorCategory,
    });
    return;
  }

  res.status(500).json({ message: 'Steel rule proposal request failed' });
}

function shouldExposeErrorSummary(env: SteelOpenAIConfigEnv): boolean {
  return env['NODE_ENV'] !== 'production';
}

function sendWorkbookError(res: Response, error: unknown, env: SteelOpenAIConfigEnv) {
  if (
    error instanceof SteelWorkbookNotFoundError ||
    error instanceof SteelWorkbookValidationError ||
    error instanceof SteelWorkbookVersionConflictError
  ) {
    res.status(error.statusCode).json({
      message: error.message,
      errorCategory: error.errorCategory,
    });
    return;
  }

  logger.error('[steelWorkbook] request failed:', error);
  res.status(500).json({
    message: 'Steel workbook request failed',
    errorCategory: 'steel_workbook_unknown',
    ...(shouldExposeErrorSummary(env) ? { errorSummary: getErrorMessage(error) } : {}),
  });
}

function isKnownWorkbookPatchError(error: unknown): error is Error {
  return (
    error instanceof SteelWorkbookNotFoundError ||
    error instanceof SteelWorkbookValidationError ||
    error instanceof SteelWorkbookVersionConflictError
  );
}

function rejectedWorkbookPatch(reason: string): SteelWorkbookPatchResponse {
  return {
    changedPaths: [],
    changedFieldSummary: [],
    rejectedReason: reason,
  };
}

function getWorkbookPatchSummaryText(
  responseText: string,
  patch: SteelWorkbookPatchResponse,
): string {
  if (responseText.trim().length > 0) {
    return responseText;
  }

  const [firstChange] = patch.changedFieldSummary;
  if (!firstChange) {
    return '已更新 workbook。';
  }

  if (patch.changedFieldSummary.length === 1) {
    return `已更新 workbook：${firstChange.label} -> ${String(firstChange.nextValue)}`;
  }

  return `已更新 workbook：${patch.changedFieldSummary.length} 個欄位`;
}

async function applyChatWorkbookPatch(
  result: SteelChatProviderResult,
  workbookContext: SteelChatWorkbookContext,
  getWorkbookService: () => ReturnType<typeof createSteelWorkbookService>,
): Promise<SteelChatHandlerResult> {
  const { workbookPatch, ...response } = result;
  if (!workbookPatch) {
    return response;
  }

  const proposal = steelProviderWorkbookPatchProposalSchema.parse(workbookPatch);
  if (!workbookContext.workbookId || !workbookContext.workbookVersion) {
    const rejectedReason = 'Workbook context is required to apply workbook patch operations.';
    return {
      ...response,
      warnings: [...response.warnings, rejectedReason],
      workbookPatch: rejectedWorkbookPatch(rejectedReason),
    };
  }

  try {
    const appliedPatch = await getWorkbookService().patch({
      workbookId: workbookContext.workbookId,
      workbookVersion: workbookContext.workbookVersion,
      selectedWorkbookRefs: workbookContext.selectedWorkbookRefs,
      operations: proposal.operations,
    });

    return {
      ...response,
      text: getWorkbookPatchSummaryText(response.text, appliedPatch),
      workbookPatch: appliedPatch,
    };
  } catch (error) {
    if (isKnownWorkbookPatchError(error)) {
      return {
        ...response,
        warnings: [...response.warnings, error.message],
        workbookPatch: rejectedWorkbookPatch(error.message),
      };
    }

    throw error;
  }
}

export function createSteelHandlers({
  env = process.env,
  getModelsConfig,
  sendChat = sendSteelOAuthChat,
  conversationService,
  ruleProposalService,
  workbookService,
}: SteelHandlersDeps) {
  const getConversationService = () => conversationService ?? createDefaultConversationService(env);
  const getRuleProposalService = () => ruleProposalService ?? createDefaultRuleProposalService();
  const getWorkbookService = () => workbookService ?? createDefaultWorkbookService();

  return {
    async chat(req: Request, res: Response) {
      const config = parseSteelOpenAIConfig(env);
      const body = isRecord(req.body) ? req.body : {};

      let messages: SteelOAuthChatMessage[];
      let model: string;
      let maxOutputTokens: number | undefined;
      let reasoningEffort: SteelOpenAIReasoningEffort;
      let workbookContext: SteelChatWorkbookContext;
      try {
        messages = parseMessages(body.messages);
        model = parseOptionalModel(body.model, config.model);
        maxOutputTokens = parseOptionalMaxOutputTokens(body.maxOutputTokens);
        reasoningEffort = parseOptionalReasoningEffort(
          body.reasoningEffort,
          config.reasoningEffort,
        );
        workbookContext = steelChatWorkbookContextSchema.parse(body);
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

      const messagesWithInstructions = applyFileInstructionsToMessages(
        messages,
        (req as SteelRequest).config,
      );

      let workbookContextText: string | undefined;
      try {
        workbookContextText = await getChatWorkbookContextText(workbookContext, getWorkbookService);
      } catch (error) {
        sendWorkbookError(res, error, env);
        return;
      }

      let result: SteelChatProviderResult;
      try {
        result = await sendChat({
          authFilePath: resolveSteelOpenAIOAuthAuthFilePath(env),
          maxOutputTokens,
          messages: messagesWithInstructions,
          model,
          ...(hasMessageFiles(messagesWithInstructions)
            ? { passThroughUnsupportedFiles: true }
            : {}),
          reasoningEffort,
          steelRuntimePolicy: true,
          ...(workbookContext.workbookId && workbookContext.workbookVersion
            ? { workbookContextText, workbookPatchTool: true }
            : {}),
        });
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
        return;
      }

      try {
        const response = await applyChatWorkbookPatch(result, workbookContext, getWorkbookService);
        res.status(200).json(response);
      } catch (error) {
        if (error instanceof ZodError) {
          res
            .status(502)
            .json(
              createErrorResponse(
                'openai_oauth_responses',
                model,
                'structured_output_invalid',
                'OpenAI OAuth provider returned an invalid Steel workbook patch.',
              ),
            );
          return;
        }

        sendWorkbookError(res, error, env);
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

    async createRuleProposal(req: SteelRequest, res: Response) {
      try {
        const result = await getRuleProposalService().create({
          body: req.body ?? {},
          user: getSteelRequestUser(req),
        });
        res.status(201).json(result);
      } catch (error) {
        sendRuleProposalError(res, error);
      }
    },

    async createWorkbook(req: SteelRequest, res: Response) {
      const parsed = steelWorkbookCreateRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid Steel workbook create request',
          errorCategory: 'steel_workbook_create_invalid',
        });
        return;
      }

      try {
        const result = await getWorkbookService().create(parsed.data);
        res.status(201).json(result);
      } catch (error) {
        sendWorkbookError(res, error, env);
      }
    },

    async readWorkbook(req: SteelRequest, res: Response) {
      try {
        const result = await getWorkbookService().read({
          workbookId: req.params.workbookId,
        });
        res.status(200).json(result);
      } catch (error) {
        sendWorkbookError(res, error, env);
      }
    },

    async patchWorkbook(req: SteelRequest, res: Response) {
      const body = isRecord(req.body) ? req.body : {};
      const bodyWorkbookId = body.workbookId;
      if (bodyWorkbookId !== undefined && bodyWorkbookId !== req.params.workbookId) {
        res.status(400).json({
          message: 'Steel workbook patch workbookId does not match route',
          errorCategory: 'steel_workbook_patch_invalid',
        });
        return;
      }

      try {
        const result = await getWorkbookService().patch({
          ...body,
          workbookId: req.params.workbookId,
        });
        res.status(200).json(result);
      } catch (error) {
        sendWorkbookError(res, error, env);
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
