import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { logger } from '@librechat/data-schemas';
import {
  steelAuthenticatedConversationRequestSchema,
  steelGuestConversationRequestSchema,
} from 'librechat-data-provider';
import { buildSteelModelOptions } from './models';
import { applyFileInstructionsToMessages, type FileInstructionConfig } from '../files/instructions';
import { createMongooseSteelAuditRecorder } from './audit/service';
import { createMongooseSteelConversationRepository } from './conversations/repository';
import { createMongooseSteelRuleProposalRepository } from './rules/repository';
import {
  createSteelConversationService,
  SteelConversationAccessError,
  SteelConversationNotFoundError,
  SteelConversationUnauthenticatedError,
} from './conversations/service';
import {
  createMongooseSteelConversationHistoryRepository,
  createMongooseSteelWorkingOrderMemoryRollbackRepository,
} from './history/repository';
import { createSteelConversationHistoryService } from './history/service';
import {
  createMongooseSteelWorkingOrderMemoryReader,
  createMongooseSteelWorkingOrderMemoryWriter,
} from './memory/service';
import { createSteelRuleProposalService, SteelRuleProposalValidationError } from './rules/service';
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
  type SteelProviderToolExecutor,
  type SteelProviderChatResponse as SteelOAuthProviderChatResponse,
} from './ai/provider';
import { createSteelPostgresPool } from './postgres';
import { executeSteelTool } from './tools/execute';

import type { Request, Response } from 'express';
import type { SteelRepositoryClient } from './repositories';
import type { SteelToolResult } from './tools/results';
import type { SteelWorkingOrderMemoryReader } from './tools/execute';
import type {
  SteelProviderChatResponse as SteelDataProviderChatResponse,
  SteelProviderChatStreamEvent,
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
  executeToolCall?: SteelProviderToolExecutor;
  getModelsConfig: (req: Request) => Promise<ModelsConfig>;
  sendChat?: (options: SendSteelOAuthChatOptions) => Promise<SteelChatProviderResult>;
  resolveEvidenceFile?: (input: {
    fileId: string;
    request: Request;
    userId: string;
    conversationId?: string;
  }) => Promise<SteelOAuthChatFile>;
  conversationService?: ReturnType<typeof createSteelConversationService>;
  createWorkingOrderMemoryReader?: (conversationId: string) => SteelWorkingOrderMemoryReader;
  historyService?: ReturnType<typeof createSteelConversationHistoryService>;
  ruleProposalService?: ReturnType<typeof createSteelRuleProposalService>;
  workingOrderMemoryWriter?: ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>;
}

type SteelChatProviderResult = SteelOAuthProviderChatResponse;

type SteelChatErrorProvider = 'openai_oauth_responses' | 'openai_api';

interface SteelChatErrorResponse {
  provider: SteelChatErrorProvider;
  model: string;
  text: '';
  unsupportedSettings: string[];
  warnings: string[];
  errorCategory:
    | 'auth'
    | 'provider_timeout'
    | 'provider_terminated'
    | 'structured_output_invalid'
    | 'unknown';
  errorSummary: string;
}

let defaultStreamToolClient: ReturnType<typeof createSteelPostgresPool> | undefined;
let defaultHistoryService: ReturnType<typeof createSteelConversationHistoryService> | undefined;
let defaultWorkingOrderMemoryWriter:
  | ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>
  | undefined;

const steelConversationHistoryMaxTurns = 20;
const steelUserTurnSources = ['user_input', 'queued_steer'] as const;
type SteelUserTurnSource = (typeof steelUserTurnSources)[number];

const memoryOnlyToolClient: SteelRepositoryClient = {
  async query() {
    throw new Error('Steel Postgres client is not available for memory-only tool execution.');
  },
};

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

function isLookupStreamTool(toolName: string): boolean {
  return toolName.startsWith('lookup_');
}

function getStreamToolEventType(toolName: string): 'lookup' | 'tool' {
  return isLookupStreamTool(toolName) ? 'lookup' : 'tool';
}

function writeStreamEvent(res: Response, event: SteelProviderChatStreamEvent): void {
  res.write(`${JSON.stringify(event)}\n`);
}

function setStreamHeaders(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function getDefaultStreamToolClient() {
  defaultStreamToolClient ??= createSteelPostgresPool();
  return defaultStreamToolClient;
}

function getDefaultHistoryService() {
  defaultHistoryService ??= createSteelConversationHistoryService({
    historyRepository: createMongooseSteelConversationHistoryRepository(mongoose),
    memoryRepository: createMongooseSteelWorkingOrderMemoryRollbackRepository(mongoose),
  });
  return defaultHistoryService;
}

function createDefaultWorkingOrderMemoryReader(conversationId: string) {
  return createMongooseSteelWorkingOrderMemoryReader(mongoose, conversationId);
}

function getDefaultWorkingOrderMemoryWriter() {
  defaultWorkingOrderMemoryWriter ??= createMongooseSteelWorkingOrderMemoryWriter(mongoose);
  return defaultWorkingOrderMemoryWriter;
}

function createDefaultStreamToolExecutor({
  conversationId,
  createWorkingOrderMemoryReader,
}: {
  conversationId?: string;
  createWorkingOrderMemoryReader: (conversationId: string) => SteelWorkingOrderMemoryReader;
}): {
  executeToolCall: SteelProviderToolExecutor;
  close: () => Promise<void>;
} {
  const memoryReader =
    conversationId !== undefined ? createWorkingOrderMemoryReader(conversationId) : undefined;

  return {
    executeToolCall: (options) =>
      executeSteelTool({
        client:
          options.toolName === 'read_working_order_items'
            ? memoryOnlyToolClient
            : getDefaultStreamToolClient(),
        toolName: options.toolName,
        arguments: options.arguments,
        memoryReader,
        providerToolCallId: options.providerToolCallId,
        runState: options.runState,
      }),
    close: async () => {},
  };
}

function toHistoryChatMessage(turn: {
  role: 'user' | 'assistant';
  content: string;
}): SteelOAuthChatMessage {
  return {
    role: turn.role,
    content: turn.content,
  };
}

function getCurrentPromptMessage(messages: readonly SteelOAuthChatMessage[]) {
  return messages[messages.length - 1];
}

function getNextTurnIndex(turns: readonly { turnIndex: number }[]) {
  return turns.reduce((highest, turn) => Math.max(highest, turn.turnIndex), 0) + 1;
}

function getMessageAttachmentRefs(message: SteelOAuthChatMessage) {
  return message.files?.map((file, index) => ({
    fileId: `request-file-${index}`,
    filename: file.filename,
    mediaType: file.mediaType,
  }));
}

function getMemoryEntrySummaries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) =>
      isRecord(entry) && typeof entry.summary === 'string' ? entry.summary : undefined,
    )
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, 5);
}

function formatWorkingOrderMemorySummary(result: Record<string, unknown>): string | undefined {
  const resultCount = typeof result.resultCount === 'number' ? result.resultCount : undefined;
  const summary = isRecord(result.summary) ? JSON.stringify(result.summary) : undefined;
  const entrySummaries = getMemoryEntrySummaries(result.memoryEntries);
  const lines = [
    'Steel Working Order Memory (active conversation state; use read_working_order_items for details).',
    resultCount !== undefined ? `resultCount=${resultCount}` : undefined,
    summary ? `counts=${summary}` : undefined,
    ...entrySummaries.map((entry) => `entry=${entry}`),
  ].filter((line): line is string => line !== undefined);

  return lines.length > 1 ? lines.join('\n') : undefined;
}

async function buildWorkingOrderMemorySummary({
  conversationId,
  createWorkingOrderMemoryReader,
}: {
  conversationId: string;
  createWorkingOrderMemoryReader: (conversationId: string) => SteelWorkingOrderMemoryReader;
}) {
  const reader = createWorkingOrderMemoryReader(conversationId);
  const result = await reader.readWorkingOrderItems({ mode: 'summary' });
  return {
    resultCount: typeof result.resultCount === 'number' ? result.resultCount : undefined,
    summary: formatWorkingOrderMemorySummary(result),
  };
}

async function prepareChatContext({
  conversationId,
  createWorkingOrderMemoryReader,
  editMessageId,
  historyService,
  messages,
  messageSource,
  requestId,
}: {
  conversationId?: string;
  createWorkingOrderMemoryReader: (conversationId: string) => SteelWorkingOrderMemoryReader;
  editMessageId?: string;
  historyService: ReturnType<typeof createSteelConversationHistoryService>;
  messageSource: SteelUserTurnSource;
  messages: SteelOAuthChatMessage[];
  requestId: string;
}): Promise<{
  messages: SteelOAuthChatMessage[];
  memoryLoadedResultCount?: number;
  nextAssistantTurnIndex?: number;
  nextMemoryCheckpointTurnIndex?: number;
  workingMemorySummary?: string;
}> {
  if (!conversationId) {
    return { messages };
  }

  const currentMessage = getCurrentPromptMessage(messages);
  if (!currentMessage) {
    return { messages };
  }

  if (editMessageId && currentMessage.role === 'user') {
    await historyService.editUserMessage({
      conversationId,
      messageId: editMessageId,
      nextContent: currentMessage.content,
    });
  }

  const activeHistory = await historyService.buildHistoryWindow({
    conversationId,
    maxTurns: steelConversationHistoryMaxTurns,
  });
  const nextTurnIndex = getNextTurnIndex(activeHistory);
  const nextAssistantTurnIndex =
    currentMessage.role === 'user' ? nextTurnIndex + 1 : nextTurnIndex;

  if (currentMessage.role === 'user' && !editMessageId) {
    await historyService.appendTurn({
      conversationId,
      requestId,
      messageId: currentMessage.messageId ?? createSteelChatConversationId(),
      turnIndex: nextTurnIndex,
      role: 'user',
      source: messageSource,
      content: currentMessage.content,
      attachments: getMessageAttachmentRefs(currentMessage),
      ...(messageSource === 'queued_steer'
        ? {
            queuedSteer: {
              targetRequestId: requestId,
              status: 'applied',
            },
          }
        : {}),
    });
  }

  const memorySummary = await buildWorkingOrderMemorySummary({
    conversationId,
    createWorkingOrderMemoryReader,
  });

  return {
    messages: editMessageId
      ? activeHistory.map(toHistoryChatMessage)
      : [...activeHistory.map(toHistoryChatMessage), currentMessage],
    memoryLoadedResultCount: memorySummary.resultCount,
    nextAssistantTurnIndex,
    nextMemoryCheckpointTurnIndex: Math.max(0, nextAssistantTurnIndex - 1),
    workingMemorySummary: memorySummary.summary,
  };
}

async function persistAssistantTurn({
  conversationId,
  content,
  historyService,
  turnIndex,
  checkpointTurnIndex,
  workingOrderMemoryWriter,
}: {
  conversationId?: string;
  content: string;
  historyService: ReturnType<typeof createSteelConversationHistoryService>;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  workingOrderMemoryWriter: ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>;
}) {
  if (!conversationId || content.trim().length === 0) {
    return undefined;
  }

  let assistantTurnIndex = turnIndex;
  if (assistantTurnIndex === undefined) {
    const activeHistory = await historyService.buildHistoryWindow({
      conversationId,
      maxTurns: steelConversationHistoryMaxTurns,
    });
    assistantTurnIndex = getNextTurnIndex(activeHistory);
  }

  const messageId = createSteelChatConversationId();
  await historyService.appendTurn({
    conversationId,
    messageId,
    turnIndex: assistantTurnIndex,
    role: 'assistant',
    source: 'assistant_final',
    content,
  });
  return workingOrderMemoryWriter.captureAssistantFinalMarkdown({
    conversationId,
    messageId,
    turnIndex: assistantTurnIndex,
    checkpointTurnIndex: checkpointTurnIndex ?? Math.max(0, assistantTurnIndex - 1),
    content,
  });
}

function hasSavedMemory(savedCounts: { [key: string]: number }) {
  return Object.values(savedCounts).some((count) => count > 0);
}

async function captureSuccessfulToolResult({
  conversationId,
  providerToolCallId,
  toolName,
  toolResult,
  turnIndex,
  checkpointTurnIndex,
  workingOrderMemoryWriter,
}: {
  conversationId?: string;
  providerToolCallId?: string;
  toolName: string;
  toolResult?: SteelToolResult;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  workingOrderMemoryWriter: ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>;
}) {
  if (!conversationId || !toolResult?.ok || turnIndex === undefined) {
    return undefined;
  }

  return workingOrderMemoryWriter.captureToolResult({
    conversationId,
    providerToolCallId,
    toolName,
    turnIndex,
    checkpointTurnIndex: checkpointTurnIndex ?? Math.max(0, turnIndex - 1),
    data: toolResult.data,
  });
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

async function parseMessageFiles(
  value: unknown,
  index: number,
  context: {
    conversationId?: string;
    resolveEvidenceFile?: SteelHandlersDeps['resolveEvidenceFile'];
    request?: Request;
    userId?: string;
  },
): Promise<SteelOAuthChatFile[] | undefined> {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`messages[${index}].files must be a non-empty array when provided`);
  }

  const files: SteelOAuthChatFile[] = [];

  for (let fileIndex = 0; fileIndex < value.length; fileIndex += 1) {
    const file = value[fileIndex];
    if (!isRecord(file)) {
      throw new Error(`messages[${index}].files[${fileIndex}] must be an object`);
    }
    const { fileId, filename, mediaType, dataBase64 } = file;
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

    if (fileId !== undefined) {
      if (typeof fileId !== 'string' || fileId.trim().length === 0) {
        throw new Error(`messages[${index}].files[${fileIndex}].fileId must be a non-empty string`);
      }
      if (!context.userId) {
        throw new Error(
          `messages[${index}].files[${fileIndex}].fileId requires an authenticated user`,
        );
      }
      if (!context.resolveEvidenceFile) {
        throw new Error('Steel evidence file resolver is not configured');
      }
      if (!context.request) {
        throw new Error('Steel evidence file resolver requires the original request');
      }

      files.push(
        await context.resolveEvidenceFile({
          fileId: fileId.trim(),
          request: context.request,
          userId: context.userId,
          conversationId: context.conversationId,
        }),
      );
      continue;
    }

    files.push({
      filename,
      mediaType,
      data: parseBase64FileData(dataBase64, index, fileIndex),
    });
  }

  return files;
}

async function parseMessages(
  value: unknown,
  context: {
    conversationId?: string;
    resolveEvidenceFile?: SteelHandlersDeps['resolveEvidenceFile'];
    request?: Request;
    userId?: string;
  } = {},
): Promise<SteelOAuthChatMessage[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('messages must contain at least one chat message');
  }

  const messages: SteelOAuthChatMessage[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item)) {
      throw new Error(`messages[${index}] must be an object`);
    }

    const { role, content } = item;
    const messageId = typeof item.messageId === 'string' ? item.messageId.trim() : undefined;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new Error(`messages[${index}].role must be system, user, or assistant`);
    }
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error(`messages[${index}].content must be a non-empty string`);
    }

    const files = await parseMessageFiles(item.files, index, context);

    messages.push(files ? { role, content, messageId, files } : { role, content, messageId });
  }

  return messages;
}

function parseOptionalConversationId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseOptionalEditMessageId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseOptionalMessageSource(value: unknown): SteelUserTurnSource {
  if (value === undefined) {
    return 'user_input';
  }
  if (
    typeof value === 'string' &&
    (steelUserTurnSources as readonly string[]).includes(value)
  ) {
    return value as SteelUserTurnSource;
  }

  throw new Error(`messageSource must be one of: ${steelUserTurnSources.join(', ')}`);
}

function createSteelChatConversationId() {
  return `steel-chat-${randomUUID()}`;
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
  const rawMessage = getErrorMessage(error);
  if (rawMessage.startsWith('Steel tool ')) {
    return 'unknown';
  }

  const message = rawMessage.toLowerCase();
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
  if (message === 'terminated' || message.includes('terminated')) {
    return 'provider_terminated';
  }

  return 'unknown';
}

function sanitizeProviderErrorSummary(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/access_token\s*[:=]\s*["']?[^"',\s]+/gi, 'access_token=[REDACTED]')
    .replace(/authorization\s*[:=]\s*["']?[^"',\n]+/gi, 'authorization=[REDACTED]')
    .replace(/authFile(Path)?\s*[:=]\s*["']?[^"',\n]+/gi, 'authFile=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function getProviderErrorSummary(error: unknown): string {
  const category = getProviderErrorCategory(error);
  if (category === 'auth') {
    return 'OpenAI OAuth auth is unavailable. Run Codex login on the server or configure server auth material.';
  }
  if (category === 'provider_timeout') {
    return 'OpenAI OAuth provider request timed out.';
  }
  if (category === 'provider_terminated') {
    return 'OpenAI OAuth provider request terminated before completion. The provider or network closed the connection without a detailed cause; check server/provider logs around this request and retry with a smaller context if it repeats.';
  }
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Steel tool ')) {
    return message;
  }

  const sanitizedMessage = sanitizeProviderErrorSummary(message);
  return sanitizedMessage.length > 0 ? sanitizedMessage : 'OpenAI OAuth provider request failed.';
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

export function createSteelHandlers({
  env = process.env,
  executeToolCall,
  getModelsConfig,
  sendChat = sendSteelOAuthChat,
  resolveEvidenceFile,
  conversationService,
  createWorkingOrderMemoryReader = createDefaultWorkingOrderMemoryReader,
  historyService,
  ruleProposalService,
  workingOrderMemoryWriter,
}: SteelHandlersDeps) {
  const getConversationService = () => conversationService ?? createDefaultConversationService(env);
  const getHistoryService = () => historyService ?? getDefaultHistoryService();
  const getRuleProposalService = () => ruleProposalService ?? createDefaultRuleProposalService();
  const getWorkingOrderMemoryWriter = () =>
    workingOrderMemoryWriter ?? getDefaultWorkingOrderMemoryWriter();

  return {
    async chat(req: Request, res: Response) {
      const config = parseSteelOpenAIConfig(env);
      const body = isRecord(req.body) ? req.body : {};

      let messages: SteelOAuthChatMessage[];
      let model: string;
      let maxOutputTokens: number | undefined;
      let reasoningEffort: SteelOpenAIReasoningEffort;
      let conversationId: string | undefined;
      let editMessageId: string | undefined;
      let messageSource: SteelUserTurnSource;
      const requestId = createSteelChatConversationId();
      try {
        conversationId = parseOptionalConversationId(body.conversationId);
        editMessageId = parseOptionalEditMessageId(body.editMessageId);
        messageSource = parseOptionalMessageSource(body.messageSource);
        messages = await parseMessages(body.messages, {
          conversationId,
          resolveEvidenceFile,
          request: req,
          userId: (req as SteelRequest).user?.id,
        });
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

      const messagesWithInstructions = applyFileInstructionsToMessages(
        messages,
        (req as SteelRequest).config,
      );
      const preparedContext = await prepareChatContext({
        conversationId,
        createWorkingOrderMemoryReader,
        editMessageId,
        historyService: getHistoryService(),
        messageSource,
        messages: messagesWithInstructions,
        requestId,
      });
      const defaultToolExecutor = executeToolCall
        ? undefined
        : createDefaultStreamToolExecutor({
            conversationId,
            createWorkingOrderMemoryReader,
          });
      const baseExecuteToolCall = executeToolCall ?? defaultToolExecutor?.executeToolCall;
      const executeToolCallWithMemoryCapture = baseExecuteToolCall
        ? async (options: Parameters<SteelProviderToolExecutor>[0]) => {
            const toolResult = await baseExecuteToolCall(options);
            await captureSuccessfulToolResult({
              conversationId,
              providerToolCallId: options.providerToolCallId,
              toolName: options.toolName,
              toolResult,
              turnIndex: preparedContext.nextAssistantTurnIndex,
              checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
              workingOrderMemoryWriter: getWorkingOrderMemoryWriter(),
            });
            return toolResult;
          }
        : undefined;

      let result: SteelChatProviderResult;
      try {
        result = await sendChat({
          authFilePath: resolveSteelOpenAIOAuthAuthFilePath(env),
          conversationId,
          executeSteelToolCall: executeToolCallWithMemoryCapture,
          maxOutputTokens,
          messages: preparedContext.messages,
          model,
          ...(hasMessageFiles(preparedContext.messages)
            ? { passThroughUnsupportedFiles: true }
            : {}),
          reasoningEffort,
          steelRuntimePolicy: true,
          workingMemorySummary: preparedContext.workingMemorySummary,
        });
        await persistAssistantTurn({
          conversationId,
          content: result.text,
          historyService: getHistoryService(),
          turnIndex: preparedContext.nextAssistantTurnIndex,
          checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
          workingOrderMemoryWriter: getWorkingOrderMemoryWriter(),
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
      } finally {
        await defaultToolExecutor?.close();
      }

      res.status(200).json({
        ...result,
        conversationId: conversationId ?? createSteelChatConversationId(),
      });
    },

    async streamChat(req: Request, res: Response) {
      const config = parseSteelOpenAIConfig(env);
      const body = isRecord(req.body) ? req.body : {};

      let messages: SteelOAuthChatMessage[];
      let model: string;
      let maxOutputTokens: number | undefined;
      let reasoningEffort: SteelOpenAIReasoningEffort;
      let conversationId: string | undefined;
      let editMessageId: string | undefined;
      let messageSource: SteelUserTurnSource;
      const requestId = createSteelChatConversationId();
      try {
        conversationId = parseOptionalConversationId(body.conversationId);
        editMessageId = parseOptionalEditMessageId(body.editMessageId);
        messageSource = parseOptionalMessageSource(body.messageSource);
        messages = await parseMessages(body.messages, {
          conversationId,
          resolveEvidenceFile,
          request: req,
          userId: (req as SteelRequest).user?.id,
        });
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

      const messagesWithInstructions = applyFileInstructionsToMessages(
        messages,
        (req as SteelRequest).config,
      );
      const preparedContext = await prepareChatContext({
        conversationId,
        createWorkingOrderMemoryReader,
        editMessageId,
        historyService: getHistoryService(),
        messageSource,
        messages: messagesWithInstructions,
        requestId,
      });

      setStreamHeaders(res);
      writeStreamEvent(res, {
        type: 'progress',
        stage: 'request_validated',
        message: 'Request validated',
      });
      if (messageSource === 'queued_steer') {
        writeStreamEvent(res, {
          type: 'steer_applied',
          message: 'Queued steer applied',
        });
      }
      if (preparedContext.memoryLoadedResultCount !== undefined) {
        writeStreamEvent(res, {
          type: 'memory_loaded',
          message: 'Loaded Working Order Memory',
          resultCount: preparedContext.memoryLoadedResultCount,
        });
      }

      const defaultToolExecutor = executeToolCall
        ? undefined
        : createDefaultStreamToolExecutor({
            conversationId,
            createWorkingOrderMemoryReader,
          });
      const baseExecuteToolCall = executeToolCall ?? defaultToolExecutor?.executeToolCall;

      try {
        let streamedText = false;
        writeStreamEvent(res, {
          type: 'progress',
          stage: 'provider_request',
          message: 'Waiting for provider',
        });

        const result = await sendChat({
          authFilePath: resolveSteelOpenAIOAuthAuthFilePath(env),
          conversationId,
          executeSteelToolCall: async (options) => {
            const type = getStreamToolEventType(options.toolName);
            writeStreamEvent(res, {
              type,
              status: 'started',
              toolName: options.toolName,
              message: `${options.toolName} started`,
            });

            try {
              if (!baseExecuteToolCall) {
                throw new Error('Steel stream tool executor is not available.');
              }

              const toolResult = await baseExecuteToolCall(options);
              const failedToolMessage =
                toolResult.ok === false
                  ? `${options.toolName} failed: ${toolResult.errorSummary}`
                  : undefined;
              writeStreamEvent(res, {
                type,
                status: toolResult.ok ? 'completed' : 'failed',
                toolName: options.toolName,
                message: failedToolMessage ?? `${options.toolName} completed`,
                ok: toolResult.ok,
              });
              const captureResult = await captureSuccessfulToolResult({
                conversationId,
                providerToolCallId: options.providerToolCallId,
                toolName: options.toolName,
                toolResult,
                turnIndex: preparedContext.nextAssistantTurnIndex,
                checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
                workingOrderMemoryWriter: getWorkingOrderMemoryWriter(),
              });
              if (captureResult && hasSavedMemory(captureResult.savedCounts)) {
                writeStreamEvent(res, {
                  type: 'memory_saved',
                  message: 'Working Order Memory saved',
                  savedCounts: captureResult.savedCounts,
                });
              }
              if (
                options.toolName === 'read_working_order_items' &&
                toolResult.ok &&
                isRecord(toolResult.data)
              ) {
                writeStreamEvent(res, {
                  type: 'memory_read',
                  message: `${options.toolName} completed`,
                  mode: typeof toolResult.data.mode === 'string' ? toolResult.data.mode : undefined,
                  resultCount:
                    typeof toolResult.data.resultCount === 'number'
                      ? toolResult.data.resultCount
                      : undefined,
                });
              }
              return toolResult;
            } catch (error) {
              writeStreamEvent(res, {
                type,
                status: 'failed',
                toolName: options.toolName,
                message: getErrorMessage(error),
                ok: false,
              });
              throw error;
            }
          },
          maxOutputTokens,
          messages: preparedContext.messages,
          model,
          onTextDelta: (delta) => {
            streamedText = true;
            writeStreamEvent(res, {
              type: 'text',
              delta,
            });
          },
          onReasoningSummary: (summary) => {
            writeStreamEvent(res, {
              type: 'reasoning',
              summary,
            });
          },
          onToolStatus: async (event) => {
            writeStreamEvent(res, {
              type: 'tool',
              status: event.status,
              toolName: event.toolName,
              message:
                event.message ??
                event.errorSummary ??
                (event.result?.ok === false
                  ? `${event.toolName} failed: ${event.result.errorSummary}`
                  : `${event.toolName} ${event.status}`),
              ok: event.result?.ok,
            });
            const captureResult = await captureSuccessfulToolResult({
              conversationId,
              toolName: event.toolName,
              toolResult: event.result,
              turnIndex: preparedContext.nextAssistantTurnIndex,
              checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
              workingOrderMemoryWriter: getWorkingOrderMemoryWriter(),
            });
            if (captureResult && hasSavedMemory(captureResult.savedCounts)) {
              writeStreamEvent(res, {
                type: 'memory_saved',
                message: 'Working Order Memory saved',
                savedCounts: captureResult.savedCounts,
              });
            }
          },
          ...(hasMessageFiles(preparedContext.messages)
            ? { passThroughUnsupportedFiles: true }
            : {}),
          reasoningEffort,
          steelRuntimePolicy: true,
          workingMemorySummary: preparedContext.workingMemorySummary,
        });
        const captureResult = await persistAssistantTurn({
          conversationId,
          content: result.text,
          historyService: getHistoryService(),
          turnIndex: preparedContext.nextAssistantTurnIndex,
          checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
          workingOrderMemoryWriter: getWorkingOrderMemoryWriter(),
        });
        if (captureResult) {
          writeStreamEvent(res, {
            type: 'parse_status',
            message: `Markdown parse ${captureResult.parseStatus}`,
            parseStatus: captureResult.parseStatus,
            savedCounts: captureResult.savedCounts,
          });
          if (hasSavedMemory(captureResult.savedCounts)) {
            writeStreamEvent(res, {
              type: 'memory_saved',
              message: 'Working Order Memory saved',
              savedCounts: captureResult.savedCounts,
            });
          }
        }

        const response = {
          ...result,
          conversationId: conversationId ?? createSteelChatConversationId(),
        };

        if (!streamedText && response.text.length > 0) {
          writeStreamEvent(res, {
            type: 'text',
            delta: response.text,
          });
        }

        writeStreamEvent(res, {
          type: 'done',
          response,
        });
      } catch (error) {
        writeStreamEvent(res, {
          type: 'error',
          errorCategory: getProviderErrorCategory(error),
          errorSummary: getProviderErrorSummary(error),
        });
      } finally {
        await defaultToolExecutor?.close();
        res.end();
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
          image_input: 'passed',
          pdf_input: 'passed',
          doc_input: 'passed',
          docx_input: 'passed',
          xls_input: 'passed',
          xlsx_input: 'passed',
          file_search: 'not_applicable',
          code_interpreter: 'unverified',
          conversation_state: 'not_applicable',
        },
        model: 'gpt-5.5',
        provider: 'openai_oauth_responses',
        source: 'code_owned_support_matrix',
      });
    },
  };
}
