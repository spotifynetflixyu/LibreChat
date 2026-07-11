import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { logger } from '@librechat/data-schemas';
import {
  openAIOAuthTokenLoginMethodSchema,
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
  createMongooseSteelOutputSheetMemoryReader,
  createMongooseSteelWorkingOrderMemoryWriter,
} from './memory/service';
import { createSteelRuleProposalService, SteelRuleProposalValidationError } from './rules/service';
import {
  parseOpenAIConfig,
  resolveOpenAIOAuthAuthFilePath,
  type OpenAIConfigEnv,
  type OpenAIReasoningEffort,
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
import {
  listReviewedSteelAgentRules,
  listReviewedSteelOtherRules,
  listReviewedSteelOutputRules,
  listReviewedSteelQuoteRules,
} from './repositories';
import {
  createEmptySteelOutputSheetMemorySnapshot,
  prepareSteelRuntimeContext,
} from './runtime/context';
import { executeSteelTool } from './tools/execute';
import {
  getOpenAIOAuthCodexLoginStatus,
  getOpenAIOAuthTokenStatus,
  logoutOpenAIOAuthToken,
  refreshOpenAIOAuthToken,
  startOpenAIOAuthCodexLogin,
  type OpenAIOAuthCodexLoginDeps,
  type OpenAIOAuthTokenStatusDeps,
} from './native/token';
import { getOpenAIOAuthUsageRemaining, invalidateOpenAIOAuthUsageCache } from './native/usage';

import type { Request, Response } from 'express';
import type {
  PrepareSteelRuntimeContextInput,
  SteelRuntimeContext,
  SteelRuntimeContextDependencies,
} from './runtime/context';
import type { SteelRepositoryClient } from './repositories';
import type { SteelAgentRule } from './repositories/rules';
import type { SteelToolResult } from './tools/results';
import type { SteelOutputSheetMemoryReader } from './memory/service';
import type { SteelConversationTurnRecord } from './history/service';
import type {
  SteelConversationMessagesResponse,
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenLogoutStatus,
  OpenAIOAuthTokenStatus,
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
  env?: OpenAIConfigEnv;
  executeToolCall?: SteelProviderToolExecutor;
  getModelsConfig: (req: Request) => Promise<ModelsConfig>;
  getOpenAIOAuthUsageRemaining?: typeof getOpenAIOAuthUsageRemaining;
  sendChat?: (options: SendSteelOAuthChatOptions) => Promise<SteelChatProviderResult>;
  resolveEvidenceFile?: (input: {
    fileId: string;
    request: Request;
    userId: string;
    conversationId?: string;
  }) => Promise<SteelOAuthChatFile>;
  conversationService?: ReturnType<typeof createSteelConversationService>;
  createOutputSheetMemoryReader?: (conversationId: string) => SteelOutputSheetMemoryReader;
  historyService?: ReturnType<typeof createSteelConversationHistoryService>;
  prepareRuntimeContext?: (input: PrepareSteelRuntimeContextInput) => Promise<SteelRuntimeContext>;
  runtimeRulesClient?: SteelRepositoryClient;
  ruleProposalService?: ReturnType<typeof createSteelRuleProposalService>;
  workingOrderMemoryWriter?: ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>;
}

interface SteelHandlers {
  chat(req: Request, res: Response): Promise<void>;
  streamChat(req: Request, res: Response): Promise<void>;
  listModels(req: SteelRequest, res: Response): Promise<void>;
  readOpenAIOAuthUsage(req: SteelRequest, res: Response): Promise<void>;
  createAuthenticatedConversation(req: SteelRequest, res: Response): Promise<void>;
  createGuestConversation(req: SteelRequest, res: Response): Promise<void>;
  readConversation(req: SteelRequest, res: Response): Promise<void>;
  readConversationMessages(req: SteelRequest, res: Response): Promise<void>;
  createRuleProposal(req: SteelRequest, res: Response): Promise<void>;
}

interface SteelAdminHandlers {
  readOpenAIOAuthTokenStatus(_req: Request, res: Response): Promise<void>;
  refreshOpenAIOAuthToken(_req: Request, res: Response): Promise<void>;
  startOpenAIOAuthCodexLogin(_req: Request, res: Response): Promise<void>;
  readOpenAIOAuthCodexLoginStatus(req: Request, res: Response): Promise<void>;
  logoutOpenAIOAuthToken(_req: Request, res: Response): Promise<void>;
  requestCapabilitySmoke(_req: Request, res: Response): Promise<void>;
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

type OpenAIConfig = ReturnType<typeof parseOpenAIConfig>;

interface ParsedSteelChatRequest {
  conversationId?: string;
  editMessageId?: string;
  maxOutputTokens?: number;
  messageSource: SteelUserTurnSource;
  messages: SteelOAuthChatMessage[];
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  requestId: string;
}

let defaultStreamToolClient: ReturnType<typeof createSteelPostgresPool> | undefined;
let defaultHistoryService: ReturnType<typeof createSteelConversationHistoryService> | undefined;
let defaultWorkingOrderMemoryWriter:
  | ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>
  | undefined;

const steelConversationHistoryMaxTurns = 20;
const steelUserTurnSources = ['user_input', 'queued_steer'] as const;
type SteelUserTurnSource = (typeof steelUserTurnSources)[number];

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

type CloseEventTarget = {
  on?: (event: 'close', listener: () => void) => CloseEventTarget;
  off?: (event: 'close', listener: () => void) => CloseEventTarget;
  removeListener?: (event: 'close', listener: () => void) => CloseEventTarget;
};

function createRequestAbortSignal(req: Request, res: Response) {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  const targets: CloseEventTarget[] = [req, res];

  for (const target of targets) {
    target.on?.('close', abort);
  }

  return {
    signal: abortController.signal,
    cleanup: () => {
      for (const target of targets) {
        if (target.off) {
          target.off('close', abort);
          continue;
        }

        target.removeListener?.('close', abort);
      }
    },
  };
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

function createDefaultOutputSheetMemoryReader(conversationId: string) {
  return createMongooseSteelOutputSheetMemoryReader(mongoose, conversationId);
}

function getDefaultWorkingOrderMemoryWriter() {
  defaultWorkingOrderMemoryWriter ??= createMongooseSteelWorkingOrderMemoryWriter(mongoose);
  return defaultWorkingOrderMemoryWriter;
}

function hasRuleSection(rule: SteelAgentRule, matches: readonly string[]): boolean {
  return rule.ruleSections.some((section) => matches.some((match) => section.includes(match)));
}

function isOcrRule(rule: SteelAgentRule): boolean {
  return hasRuleSection(rule, ['file_ocr', 'drawing_ocr', 'vision_evidence']);
}

function filterOtherGlobalRules(rules: readonly SteelAgentRule[]) {
  const ocrRules = rules.filter(isOcrRule);

  return {
    ocrRules,
    fileRules: rules.filter((rule) => hasRuleSection(rule, ['file']) && !isOcrRule(rule)),
    sourcePriorityRules: rules.filter((rule) => hasRuleSection(rule, ['source_priority'])),
    markdownOutputRules: rules.filter((rule) => hasRuleSection(rule, ['markdown_output'])),
  };
}

function createRuntimeContextDependencies({
  conversationId,
  createOutputSheetMemoryReader,
  getRulesClient,
}: {
  conversationId?: string;
  createOutputSheetMemoryReader: (conversationId: string) => SteelOutputSheetMemoryReader;
  getRulesClient: () => SteelRepositoryClient;
}): SteelRuntimeContextDependencies {
  let agentRulesPromise: Promise<SteelAgentRule[]> | undefined;
  let outputRulesPromise: Promise<SteelAgentRule[]> | undefined;
  let otherRulesPromise: Promise<SteelAgentRule[]> | undefined;
  let rulesClient: SteelRepositoryClient | undefined;
  const getClient = () => {
    rulesClient ??= getRulesClient();
    return rulesClient;
  };
  const listAgentRuleRows = () => {
    agentRulesPromise ??= listReviewedSteelAgentRules(getClient());
    return agentRulesPromise;
  };
  const listOutputRuleRows = () => {
    outputRulesPromise ??= listReviewedSteelOutputRules(getClient());
    return outputRulesPromise;
  };
  const listOtherRuleRows = () => {
    otherRulesPromise ??= listReviewedSteelOtherRules(getClient());
    return otherRulesPromise;
  };

  return {
    listAgentRules: listAgentRuleRows,
    listReviewedInstructionPackets: async () => [],
    listReviewedQuoteDefaults: async () => [],
    listReviewedQuoteRules: () => listReviewedSteelQuoteRules(getClient()),
    listOutputRules: listOutputRuleRows,
    async listOtherGlobalRules() {
      return filterOtherGlobalRules(await listOtherRuleRows());
    },
    async readOutputSheetMemory() {
      if (!conversationId) {
        return createEmptySteelOutputSheetMemorySnapshot();
      }

      return createOutputSheetMemoryReader(conversationId).readOutputSheetMemory();
    },
  };
}

function createDefaultStreamToolExecutor({
  conversationId,
  createOutputSheetMemoryReader,
}: {
  conversationId?: string;
  createOutputSheetMemoryReader: (conversationId: string) => SteelOutputSheetMemoryReader;
}): {
  executeToolCall: SteelProviderToolExecutor;
  close: () => Promise<void>;
} {
  return {
    executeToolCall: (options) =>
      executeSteelTool({
        client: getDefaultStreamToolClient(),
        toolName: options.toolName,
        arguments: options.arguments,
        outputSheetMemoryReader: conversationId
          ? createOutputSheetMemoryReader(conversationId)
          : undefined,
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

function toConversationReloadMessage(
  turn: SteelConversationTurnRecord,
): SteelConversationMessagesResponse['messages'][number] {
  const attachments = turn.attachments?.map((attachment) => ({
    fileId: attachment.fileId,
    ...(attachment.filename ? { filename: attachment.filename } : {}),
    ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
  }));

  return {
    messageId: turn.messageId,
    role: turn.role,
    content: turn.content,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    createdAt: turn.createdAt.toISOString(),
    updatedAt: turn.updatedAt.toISOString(),
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

async function prepareChatContext({
  conversationId,
  editMessageId,
  historyService,
  messages,
  messageSource,
  requestId,
  userId,
}: {
  conversationId?: string;
  editMessageId?: string;
  historyService: ReturnType<typeof createSteelConversationHistoryService>;
  messageSource: SteelUserTurnSource;
  messages: SteelOAuthChatMessage[];
  requestId: string;
  userId?: string;
}): Promise<{
  messages: SteelOAuthChatMessage[];
  nextAssistantTurnIndex?: number;
  nextMemoryCheckpointTurnIndex?: number;
  edit?: {
    editMessageId: string;
    supersededAfterTurnIndex: number;
  };
}> {
  if (!conversationId) {
    return { messages };
  }

  const currentMessage = getCurrentPromptMessage(messages);
  if (!currentMessage) {
    return { messages };
  }

  const editResult =
    editMessageId && currentMessage.role === 'user'
      ? await historyService.editUserMessage({
          conversationId,
          messageId: editMessageId,
          nextContent: currentMessage.content,
          ...(userId ? { userId, editedByUserId: userId } : {}),
        })
      : undefined;

  const activeHistory = await historyService.buildHistoryWindow({
    conversationId,
    maxTurns: steelConversationHistoryMaxTurns,
    ...(userId ? { userId } : {}),
  });
  const nextTurnIndex = getNextTurnIndex(activeHistory);
  const nextAssistantTurnIndex = currentMessage.role === 'user' ? nextTurnIndex + 1 : nextTurnIndex;

  if (currentMessage.role === 'user' && !editMessageId) {
    await historyService.appendTurn({
      conversationId,
      ...(userId ? { userId } : {}),
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

  return {
    messages: editMessageId
      ? activeHistory.map(toHistoryChatMessage)
      : [...activeHistory.map(toHistoryChatMessage), currentMessage],
    nextAssistantTurnIndex,
    nextMemoryCheckpointTurnIndex: Math.max(0, nextAssistantTurnIndex - 1),
    edit:
      editMessageId && editResult?.updatedTurn
        ? {
            editMessageId,
            supersededAfterTurnIndex: editResult.updatedTurn.turnIndex,
          }
        : undefined,
  };
}

type PreparedSteelChatContext = Awaited<ReturnType<typeof prepareChatContext>>;

function getCurrentUserTurn(messages: readonly SteelOAuthChatMessage[]) {
  const currentMessage = getCurrentPromptMessage(messages);
  return currentMessage?.role === 'user' ? currentMessage : undefined;
}

async function buildSteelRuntimeContext({
  conversationId,
  createOutputSheetMemoryReader,
  parsedRequest,
  prepareDefaultRuntimeContext,
  prepareRuntimeContext,
  preparedContext,
  runtimeRulesClient,
}: {
  conversationId?: string;
  createOutputSheetMemoryReader: (conversationId: string) => SteelOutputSheetMemoryReader;
  parsedRequest: ParsedSteelChatRequest;
  prepareDefaultRuntimeContext: boolean;
  prepareRuntimeContext?: (input: PrepareSteelRuntimeContextInput) => Promise<SteelRuntimeContext>;
  preparedContext: PreparedSteelChatContext;
  runtimeRulesClient?: SteelRepositoryClient;
}): Promise<SteelRuntimeContext | undefined> {
  const shouldPrepareRuntimeContext =
    prepareRuntimeContext !== undefined || prepareDefaultRuntimeContext;

  if (!shouldPrepareRuntimeContext) {
    return undefined;
  }

  const prepare = prepareRuntimeContext ?? prepareSteelRuntimeContext;

  return prepare({
    conversation: {
      conversationId,
      requestId: parsedRequest.requestId,
      activeHistory: preparedContext.messages,
      currentUserTurn: getCurrentUserTurn(preparedContext.messages),
      edit: preparedContext.edit,
    },
    attachments: {
      currentTurnFiles: getCurrentUserTurn(preparedContext.messages)?.files ?? [],
      priorActiveFileEvidence: [],
    },
    dependencies: createRuntimeContextDependencies({
      conversationId,
      createOutputSheetMemoryReader,
      getRulesClient: () => runtimeRulesClient ?? getDefaultStreamToolClient(),
    }),
  });
}

async function persistAssistantTurn({
  conversationId,
  content,
  historyService,
  turnIndex,
  checkpointTurnIndex,
  userId,
  workingOrderMemoryWriter,
}: {
  conversationId?: string;
  content: string;
  historyService: ReturnType<typeof createSteelConversationHistoryService>;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  userId?: string;
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
      ...(userId ? { userId } : {}),
    });
    assistantTurnIndex = getNextTurnIndex(activeHistory);
  }

  const messageId = createSteelChatConversationId();
  await historyService.appendTurn({
    conversationId,
    ...(userId ? { userId } : {}),
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

function getMarkdownParseMessage(parseStatus: 'saved' | 'partial' | 'skipped') {
  if (parseStatus === 'saved') {
    return 'Saved Markdown parse';
  }
  if (parseStatus === 'partial') {
    return 'Partially parsed Markdown';
  }
  return 'Skipped Markdown parse';
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
  if (
    !conversationId ||
    !toolResult?.ok ||
    turnIndex === undefined ||
    toolName === 'run_file_ocr'
  ) {
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

function createToolExecutorWithMemoryCapture({
  baseExecuteToolCall,
  conversationId,
  getWorkingOrderMemoryWriter,
  preparedContext,
}: {
  baseExecuteToolCall?: SteelProviderToolExecutor;
  conversationId?: string;
  getWorkingOrderMemoryWriter: () => ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>;
  preparedContext: PreparedSteelChatContext;
}): SteelProviderToolExecutor | undefined {
  if (!baseExecuteToolCall) {
    return undefined;
  }

  return async (options) => {
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
  };
}

function createStreamToolExecutorWithMemoryEvents({
  baseExecuteToolCall,
  conversationId,
  getWorkingOrderMemoryWriter,
  preparedContext,
  res,
}: {
  baseExecuteToolCall?: SteelProviderToolExecutor;
  conversationId?: string;
  getWorkingOrderMemoryWriter: () => ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter>;
  preparedContext: PreparedSteelChatContext;
  res: Response;
}): SteelProviderToolExecutor {
  return async (options) => {
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
          message: 'Saved Working Order Memory',
          savedCounts: captureResult.savedCounts,
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
  if (typeof value === 'string' && (steelUserTurnSources as readonly string[]).includes(value)) {
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
  defaultReasoningEffort: OpenAIReasoningEffort,
): OpenAIReasoningEffort {
  if (value === undefined) {
    return defaultReasoningEffort;
  }
  if (typeof value === 'string' && (requestReasoningEfforts as readonly string[]).includes(value)) {
    return value as OpenAIReasoningEffort;
  }

  throw new Error(`reasoningEffort must be one of: ${requestReasoningEfforts.join(', ')}`);
}

async function parseSteelChatRunRequest({
  config,
  req,
  resolveEvidenceFile,
}: {
  config: OpenAIConfig;
  req: Request;
  resolveEvidenceFile?: SteelHandlersDeps['resolveEvidenceFile'];
}): Promise<ParsedSteelChatRequest> {
  const body = isRecord(req.body) ? req.body : {};
  const conversationId = parseOptionalConversationId(body.conversationId);
  const editMessageId = parseOptionalEditMessageId(body.editMessageId);
  const messageSource = parseOptionalMessageSource(body.messageSource);
  const messages = await parseMessages(body.messages, {
    conversationId,
    resolveEvidenceFile,
    request: req,
    userId: (req as SteelRequest).user?.id,
  });

  return {
    conversationId,
    editMessageId,
    maxOutputTokens: parseOptionalMaxOutputTokens(body.maxOutputTokens),
    messageSource,
    messages,
    model: parseOptionalModel(body.model, config.model),
    reasoningEffort: parseOptionalReasoningEffort(body.reasoningEffort, config.reasoningEffort),
    requestId: createSteelChatConversationId(),
  };
}

function sendInvalidSteelChatRequest(res: Response, config: OpenAIConfig, error: unknown) {
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
}

function sendUnsupportedApiProviderResponse(res: Response, model: string) {
  res
    .status(501)
    .json(
      createErrorResponse(
        'openai_api',
        model,
        'unknown',
        'OPENAI_PROVIDER=API is reserved for the OpenAI API adapter, which is not implemented in this slice.',
      ),
    );
}

function buildProviderBaseOptions({
  abortSignal,
  conversationId,
  env,
  executeSteelToolCall,
  maxOutputTokens,
  messages,
  model,
  reasoningEffort,
  steelRuntimeContext,
}: {
  abortSignal: AbortSignal;
  conversationId?: string;
  env: OpenAIConfigEnv;
  executeSteelToolCall?: SteelProviderToolExecutor;
  maxOutputTokens?: number;
  messages: SteelOAuthChatMessage[];
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  steelRuntimeContext?: SteelRuntimeContext;
}): SendSteelOAuthChatOptions {
  return {
    abortSignal,
    authFilePath: resolveOpenAIOAuthAuthFilePath(env),
    conversationId,
    executeSteelToolCall,
    maxOutputTokens,
    messages,
    model,
    ...(hasMessageFiles(messages) ? { passThroughUnsupportedFiles: true } : {}),
    reasoningEffort,
    steelRuntimePolicy: true,
    steelRuntimeContext,
  };
}

function isReadableErrorMessage(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed !== '[object Object]' && !isGenericErrorWrapper(trimmed);
}

function isGenericErrorWrapper(message: string): boolean {
  const normalized = message.trim().replace(/\.$/, '').toLowerCase();
  return (
    normalized === 'openai oauth provider request failed' ||
    normalized === 'streaming request failed'
  );
}

function extractJsonStringErrorMessage(value: string, depth: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }

  try {
    return extractReadableErrorMessage(JSON.parse(trimmed), depth + 1);
  } catch {
    return undefined;
  }
}

function extractReadableErrorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 5) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const jsonMessage = extractJsonStringErrorMessage(trimmed, depth);
    if (jsonMessage) {
      return jsonMessage;
    }
    return isReadableErrorMessage(trimmed) ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const message = extractReadableErrorMessage(entry, depth + 1);
      if (message) {
        return message;
      }
    }
    return undefined;
  }

  if (value instanceof Error) {
    const causeMessage = extractReadableErrorMessage(value.cause, depth + 1);
    if (causeMessage) {
      return causeMessage;
    }
    const message = extractReadableErrorMessage(value.message, depth + 1);
    if (message) {
      return message;
    }
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const fields = [
    'errorSummary',
    'message',
    'detail',
    'details',
    'description',
    'reason',
    'error',
    'errors',
    'cause',
    'response',
    'data',
    'body',
    'error_description',
    'errorMessage',
    'statusText',
  ];

  for (const field of fields) {
    const message = extractReadableErrorMessage(value[field], depth + 1);
    if (message) {
      return message;
    }
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  return extractReadableErrorMessage(error) ?? '';
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
    message.includes('auth.json') ||
    message.includes('codex login') ||
    message.includes('unauthorized') ||
    /\bauth(entication|orization)?\b/i.test(rawMessage)
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
  const message = getErrorMessage(error);
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

function createDefaultConversationService(env: OpenAIConfigEnv) {
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
  getOpenAIOAuthUsageRemaining: readOpenAIOAuthUsageRemaining = getOpenAIOAuthUsageRemaining,
  sendChat = sendSteelOAuthChat,
  resolveEvidenceFile,
  conversationService,
  createOutputSheetMemoryReader = createDefaultOutputSheetMemoryReader,
  historyService,
  prepareRuntimeContext,
  runtimeRulesClient,
  ruleProposalService,
  workingOrderMemoryWriter,
}: SteelHandlersDeps): SteelHandlers {
  const getConversationService = () => conversationService ?? createDefaultConversationService(env);
  const getHistoryService = () => historyService ?? getDefaultHistoryService();
  const getRuleProposalService = () => ruleProposalService ?? createDefaultRuleProposalService();
  const getWorkingOrderMemoryWriter = () =>
    workingOrderMemoryWriter ?? getDefaultWorkingOrderMemoryWriter();
  const canPersistConversationHistory = () =>
    historyService !== undefined || mongoose.connection.readyState === 1;
  const getConversationIdsForRequest = (requestedConversationId?: string) => {
    const responseConversationId = requestedConversationId ?? createSteelChatConversationId();
    const persistentConversationId =
      requestedConversationId ??
      (canPersistConversationHistory() ? responseConversationId : undefined);

    return {
      persistentConversationId,
      responseConversationId,
    };
  };

  return {
    async chat(req: Request, res: Response) {
      const config = parseOpenAIConfig(env);
      let parsedRequest: ParsedSteelChatRequest;
      try {
        parsedRequest = await parseSteelChatRunRequest({ config, req, resolveEvidenceFile });
      } catch (error) {
        sendInvalidSteelChatRequest(res, config, error);
        return;
      }
      const {
        conversationId,
        editMessageId,
        maxOutputTokens,
        messageSource,
        messages,
        model,
        reasoningEffort,
        requestId,
      } = parsedRequest;

      if (config.provider === 'API') {
        sendUnsupportedApiProviderResponse(res, model);
        return;
      }

      const { persistentConversationId, responseConversationId } =
        getConversationIdsForRequest(conversationId);
      const requestUser = getSteelRequestUser(req as SteelRequest);
      const messagesWithInstructions = applyFileInstructionsToMessages(
        messages,
        (req as SteelRequest).config,
      );
      const preparedContext = await prepareChatContext({
        conversationId: persistentConversationId,
        editMessageId,
        historyService: getHistoryService(),
        messageSource,
        messages: messagesWithInstructions,
        requestId,
        ...(requestUser?.id ? { userId: requestUser.id } : {}),
      });
      const steelRuntimeContext = await buildSteelRuntimeContext({
        conversationId: persistentConversationId,
        createOutputSheetMemoryReader,
        parsedRequest,
        prepareDefaultRuntimeContext: sendChat === sendSteelOAuthChat,
        prepareRuntimeContext,
        preparedContext,
        runtimeRulesClient,
      });
      const defaultToolExecutor = executeToolCall
        ? undefined
        : createDefaultStreamToolExecutor({
            conversationId: persistentConversationId,
            createOutputSheetMemoryReader,
          });
      const baseExecuteToolCall = executeToolCall ?? defaultToolExecutor?.executeToolCall;
      const executeToolCallWithMemoryCapture = createToolExecutorWithMemoryCapture({
        baseExecuteToolCall,
        conversationId: persistentConversationId,
        getWorkingOrderMemoryWriter,
        preparedContext,
      });
      const requestAbort = createRequestAbortSignal(req, res);

      let result: SteelChatProviderResult;
      try {
        result = await sendChat({
          ...buildProviderBaseOptions({
            abortSignal: requestAbort.signal,
            conversationId: responseConversationId,
            env,
            executeSteelToolCall: executeToolCallWithMemoryCapture,
            maxOutputTokens,
            messages: preparedContext.messages,
            model,
            reasoningEffort,
            steelRuntimeContext,
          }),
          onToolStatus: async (event) => {
            await captureSuccessfulToolResult({
              conversationId: persistentConversationId,
              toolName: event.toolName,
              toolResult: event.result,
              turnIndex: preparedContext.nextAssistantTurnIndex,
              checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
              workingOrderMemoryWriter: getWorkingOrderMemoryWriter(),
            });
          },
        });
        await persistAssistantTurn({
          conversationId: persistentConversationId,
          content: result.text,
          historyService: getHistoryService(),
          turnIndex: preparedContext.nextAssistantTurnIndex,
          checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
          ...(requestUser?.id ? { userId: requestUser.id } : {}),
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
        requestAbort.cleanup();
        await defaultToolExecutor?.close();
      }

      res.status(200).json({
        ...result,
        conversationId: responseConversationId,
      });
    },

    async streamChat(req: Request, res: Response) {
      const config = parseOpenAIConfig(env);
      let parsedRequest: ParsedSteelChatRequest;
      try {
        parsedRequest = await parseSteelChatRunRequest({ config, req, resolveEvidenceFile });
      } catch (error) {
        sendInvalidSteelChatRequest(res, config, error);
        return;
      }
      const {
        conversationId,
        editMessageId,
        maxOutputTokens,
        messageSource,
        messages,
        model,
        reasoningEffort,
        requestId,
      } = parsedRequest;

      if (config.provider === 'API') {
        sendUnsupportedApiProviderResponse(res, model);
        return;
      }

      const { persistentConversationId, responseConversationId } =
        getConversationIdsForRequest(conversationId);
      const requestUser = getSteelRequestUser(req as SteelRequest);
      const messagesWithInstructions = applyFileInstructionsToMessages(
        messages,
        (req as SteelRequest).config,
      );
      const preparedContext = await prepareChatContext({
        conversationId: persistentConversationId,
        editMessageId,
        historyService: getHistoryService(),
        messageSource,
        messages: messagesWithInstructions,
        requestId,
        ...(requestUser?.id ? { userId: requestUser.id } : {}),
      });
      const steelRuntimeContext = await buildSteelRuntimeContext({
        conversationId: persistentConversationId,
        createOutputSheetMemoryReader,
        parsedRequest,
        prepareDefaultRuntimeContext: sendChat === sendSteelOAuthChat,
        prepareRuntimeContext,
        preparedContext,
        runtimeRulesClient,
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
      const defaultToolExecutor = executeToolCall
        ? undefined
        : createDefaultStreamToolExecutor({
            conversationId: persistentConversationId,
            createOutputSheetMemoryReader,
          });
      const baseExecuteToolCall = executeToolCall ?? defaultToolExecutor?.executeToolCall;
      const requestAbort = createRequestAbortSignal(req, res);

      try {
        let streamedText = false;
        writeStreamEvent(res, {
          type: 'progress',
          stage: 'provider_request',
          message: 'Waiting for provider',
        });

        const result = await sendChat({
          ...buildProviderBaseOptions({
            abortSignal: requestAbort.signal,
            conversationId: responseConversationId,
            env,
            executeSteelToolCall: createStreamToolExecutorWithMemoryEvents({
              baseExecuteToolCall,
              conversationId: persistentConversationId,
              getWorkingOrderMemoryWriter,
              preparedContext,
              res,
            }),
            maxOutputTokens,
            messages: preparedContext.messages,
            model,
            reasoningEffort,
            steelRuntimeContext,
          }),
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
          onProviderRoundStatus: (event) => {
            writeStreamEvent(res, {
              type: 'progress',
              stage: 'provider_round',
              message: event.message,
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
              conversationId: persistentConversationId,
              toolName: event.toolName,
              toolResult: event.result,
              turnIndex: preparedContext.nextAssistantTurnIndex,
              checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
              workingOrderMemoryWriter: getWorkingOrderMemoryWriter(),
            });
            if (captureResult && hasSavedMemory(captureResult.savedCounts)) {
              writeStreamEvent(res, {
                type: 'memory_saved',
                message: 'Saved Working Order Memory',
                savedCounts: captureResult.savedCounts,
              });
            }
          },
        });
        const captureResult = await persistAssistantTurn({
          conversationId: persistentConversationId,
          content: result.text,
          historyService: getHistoryService(),
          turnIndex: preparedContext.nextAssistantTurnIndex,
          checkpointTurnIndex: preparedContext.nextMemoryCheckpointTurnIndex,
          ...(requestUser?.id ? { userId: requestUser.id } : {}),
          workingOrderMemoryWriter: getWorkingOrderMemoryWriter(),
        });
        if (captureResult) {
          writeStreamEvent(res, {
            type: 'parse_status',
            message: getMarkdownParseMessage(captureResult.parseStatus),
            parseStatus: captureResult.parseStatus,
            savedCounts: captureResult.savedCounts,
          });
          if (hasSavedMemory(captureResult.savedCounts)) {
            writeStreamEvent(res, {
              type: 'memory_saved',
              message: 'Saved Working Order Memory',
              savedCounts: captureResult.savedCounts,
            });
          }
        }

        const response = {
          ...result,
          conversationId: responseConversationId,
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
        requestAbort.cleanup();
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

    async readOpenAIOAuthUsage(_req: SteelRequest, res: Response) {
      const usage = await readOpenAIOAuthUsageRemaining({
        authFilePath: resolveOpenAIOAuthAuthFilePath(env),
      });
      res.status(200).json(usage);
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

    async readConversationMessages(req: SteelRequest, res: Response) {
      const conversationId = req.params.conversationId;
      if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
        res.status(400).json({ message: 'Invalid Steel conversation id' });
        return;
      }
      const requestUser = getSteelRequestUser(req);
      if (!requestUser?.id) {
        res.status(401).json({ message: 'Steel conversation messages require login' });
        return;
      }

      try {
        const activeTurns = await getHistoryService().listActiveTurns({
          conversationId,
          userId: requestUser.id,
        });
        const response: SteelConversationMessagesResponse = {
          conversationId,
          messages: activeTurns.map(toConversationReloadMessage),
        };
        res.status(200).json(response);
      } catch (error) {
        logger.error('[steel] Failed to read conversation messages', error);
        res.status(500).json({ message: 'Steel conversation messages request failed' });
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

export function createSteelAdminHandlers({
  env = process.env,
  getCodexLoginStatus = getOpenAIOAuthCodexLoginStatus,
  getTokenStatus = getOpenAIOAuthTokenStatus,
  invalidateUsageCache = invalidateOpenAIOAuthUsageCache,
  logoutToken = logoutOpenAIOAuthToken,
  refreshToken = refreshOpenAIOAuthToken,
  startCodexLogin = startOpenAIOAuthCodexLogin,
}: {
  env?: OpenAIConfigEnv;
  getCodexLoginStatus?: (
    sessionId: string,
    deps?: OpenAIOAuthCodexLoginDeps,
  ) => OpenAIOAuthTokenLoginStatus;
  getTokenStatus?: (deps?: OpenAIOAuthTokenStatusDeps) => Promise<OpenAIOAuthTokenStatus>;
  invalidateUsageCache?: typeof invalidateOpenAIOAuthUsageCache;
  logoutToken?: (deps?: OpenAIOAuthCodexLoginDeps) => Promise<OpenAIOAuthTokenLogoutStatus>;
  refreshToken?: (deps?: OpenAIOAuthTokenStatusDeps) => Promise<OpenAIOAuthTokenStatus>;
  startCodexLogin?: (deps?: OpenAIOAuthCodexLoginDeps) => Promise<OpenAIOAuthTokenLoginStatus>;
} = {}): SteelAdminHandlers {
  const authFilePath = resolveOpenAIOAuthAuthFilePath(env);

  return {
    async readOpenAIOAuthTokenStatus(_req: Request, res: Response): Promise<void> {
      const status = await getTokenStatus({
        authFilePath,
        env,
      });
      res.status(200).json(status);
    },

    async refreshOpenAIOAuthToken(_req: Request, res: Response): Promise<void> {
      const status = await refreshToken({
        authFilePath,
        env,
      });
      invalidateUsageCache({ authFilePath });
      res.status(200).json(status);
    },

    async startOpenAIOAuthCodexLogin(req: Request, res: Response): Promise<void> {
      const method = openAIOAuthTokenLoginMethodSchema.safeParse(req.body?.method ?? 'device_code');
      if (!method.success) {
        res.status(400).json({ message: 'Invalid Codex login method' });
        return;
      }
      const status = await startCodexLogin({
        authFilePath,
        env,
        method: method.data,
      });
      let statusCode = 500;
      if (status.status === 'pending') {
        statusCode = 202;
      } else if (status.status === 'succeeded') {
        statusCode = 200;
      } else if (status.status === 'unavailable') {
        statusCode = 503;
      }
      res.status(statusCode).json(status);
    },

    async readOpenAIOAuthCodexLoginStatus(req: Request, res: Response): Promise<void> {
      const sessionId = req.params.sessionId;
      if (!sessionId) {
        res.status(400).json({ message: 'Missing Codex login session id' });
        return;
      }

      const status = getCodexLoginStatus(sessionId, {
        authFilePath,
        env,
      });
      if (status.status === 'succeeded') {
        invalidateUsageCache({ authFilePath });
      }
      res.status(status.reason === 'login_not_found' ? 404 : 200).json(status);
    },

    async logoutOpenAIOAuthToken(_req: Request, res: Response): Promise<void> {
      const status = await logoutToken({ authFilePath, env });
      invalidateUsageCache({ authFilePath });
      let statusCode = 500;
      if (status.status === 'succeeded') {
        statusCode = 200;
      } else if (status.status === 'unavailable') {
        statusCode = 503;
      }
      res.status(statusCode).json(status);
    },

    async requestCapabilitySmoke(_req: Request, res: Response): Promise<void> {
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
