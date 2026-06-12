import mongoose from 'mongoose';
import { logger } from '@librechat/data-schemas';
import {
  steelAuthenticatedConversationRequestSchema,
  steelGuestConversationRequestSchema,
  steelFileAnalysisManualPatchRequestSchema,
  steelProviderChatRequestSchema,
  steelProviderFileAnalysisPatchProposalSchema,
  steelProviderWorkbookPatchProposalSchema,
  steelWorkbookCreateRequestSchema,
  steelWorkbookExportRequestSchema,
} from 'librechat-data-provider';
import { ZodError } from 'zod';

import { buildSteelModelOptions } from './models';
import { applyFileInstructionsToMessages, type FileInstructionConfig } from '../files/instructions';
import { createMongooseSteelAuditRecorder } from './audit/service';
import { createMongooseSteelConversationRepository } from './conversations/repository';
import { createMongooseSteelRuleProposalRepository } from './rules/repository';
import { createMongooseSteelWorkbookRepository } from './workbook/repository';
import { createMongooseSteelFileAnalysisRepository } from './vision/repository';
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
import { createSteelFileAnalysisService } from './vision/analysis';
import { exportSteelWorkbookXlsx } from './exports/service';
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
import type { z } from 'zod';
import type {
  SteelWorkbook,
  SteelChangedFieldSummary,
  SteelProviderChatStreamEvent,
  SteelWorkbookCellValue,
  SteelFileAnalysisData,
  SteelProviderFileAnalysisPatchProposal,
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
  ruleProposalService?: ReturnType<typeof createSteelRuleProposalService>;
  workbookService?: ReturnType<typeof createSteelWorkbookService>;
  fileAnalysisService?: ReturnType<typeof createSteelFileAnalysisService>;
}

type SteelChatProviderResult = Omit<
  SteelOAuthProviderChatResponse,
  'fileAnalysisPatch' | 'workbookPatch'
> & {
  fileAnalysisPatch?: SteelProviderFileAnalysisPatchProposal;
  workbookPatch?: SteelProviderWorkbookPatchProposal;
};

type SteelChatProviderResultWithFileAnalysis = Omit<
  SteelOAuthProviderChatResponse,
  'fileAnalysisPatch' | 'workbookPatch'
> & {
  fileAnalysisData?: SteelFileAnalysisData;
  workbookPatch?: SteelProviderWorkbookPatchProposal;
};

type SteelChatHandlerResult = Omit<
  SteelOAuthProviderChatResponse,
  'fileAnalysisPatch' | 'workbookPatch'
> & {
  fileAnalysisData?: SteelFileAnalysisData;
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
let defaultStreamToolClient: ReturnType<typeof createSteelPostgresPool> | undefined;

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

function createDefaultStreamToolExecutor(): {
  executeToolCall: SteelProviderToolExecutor;
  close: () => Promise<void>;
} {
  const client = getDefaultStreamToolClient();

  return {
    executeToolCall: (options) =>
      executeSteelTool({
        client,
        toolName: options.toolName,
        arguments: options.arguments,
        providerToolCallId: options.providerToolCallId,
        runState: options.runState,
      }),
    close: async () => {},
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
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new Error(`messages[${index}].role must be system, user, or assistant`);
    }
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error(`messages[${index}].content must be a non-empty string`);
    }

    const files = await parseMessageFiles(item.files, index, context);

    messages.push(files ? { role, content, files } : { role, content });
  }

  return messages;
}

function parseOptionalConversationId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
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

function createDefaultWorkbookService() {
  return createSteelWorkbookService({
    repository: createMongooseSteelWorkbookRepository(mongoose),
  });
}

function createDefaultFileAnalysisService() {
  return createSteelFileAnalysisService({
    repository: createMongooseSteelFileAnalysisRepository(mongoose),
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

function createFileAnalysisContextText(fileAnalysisData: SteelFileAnalysisData): string {
  const fileAnalysisRows = fileAnalysisData.sheets.file_analysis_data.rows
    .slice(0, 80)
    .map((row) => ({
      id: row.id,
      sourceRef: {
        fileId: row.sourceRef.fileId,
        filename: row.sourceRef.filename,
        mediaType: row.sourceRef.mediaType,
        sourceKey: row.sourceRef.sourceKey,
        imageIndex: row.sourceRef.imageIndex,
        page: row.sourceRef.page,
        regionLabel: row.sourceRef.regionLabel,
        ocrEngine: row.sourceRef.ocrEngine,
        ocrStatus: row.sourceRef.ocrStatus,
        processedAt: row.sourceRef.processedAt,
      },
      cells: row.cells,
    }));
  const manualReviewRows = fileAnalysisData.sheets.manual_review.rows.slice(0, 40).map((row) => ({
    id: row.id,
    sourceRef: row.sourceRef,
    cells: row.cells,
    confidence: row.confidence,
    reviewStatus: row.reviewStatus,
    rowWarnings: row.rowWarnings,
  }));
  const interpretationNoteRows = fileAnalysisData.sheets.interpretation_notes.rows
    .slice(0, 40)
    .map((row) => ({
      id: row.id,
      sourceRef: row.sourceRef,
      cells: row.cells,
      confidence: row.confidence,
    }));

  return [
    'Latest saved file_analysis_data workspace. Treat this as user-reviewed current data for this conversation and prefer it over older OCR guesses.',
    JSON.stringify({
      id: fileAnalysisData.id,
      conversationId: fileAnalysisData.conversationId,
      workbookId: fileAnalysisData.workbookId,
      version: fileAnalysisData.version,
      sourceFiles: fileAnalysisData.sourceFiles,
      file_analysis_data: {
        columns: fileAnalysisData.sheets.file_analysis_data.columns,
        rows: fileAnalysisRows,
      },
      manual_review: {
        columns: fileAnalysisData.sheets.manual_review.columns,
        rows: manualReviewRows,
      },
      interpretation_notes: {
        columns: fileAnalysisData.sheets.interpretation_notes.columns,
        rows: interpretationNoteRows,
      },
    }),
  ].join('\n');
}

async function addFileAnalysisContextToMessages(
  messages: SteelOAuthChatMessage[],
  conversationId: string | undefined,
  getFileAnalysisService: () => ReturnType<typeof createSteelFileAnalysisService>,
): Promise<SteelOAuthChatMessage[]> {
  if (!conversationId) {
    return messages;
  }

  const fileAnalysisData = await getFileAnalysisService().readByConversationId(conversationId);
  if (!fileAnalysisData) {
    return messages;
  }

  return [
    ...messages,
    {
      role: 'system',
      content: createFileAnalysisContextText(fileAnalysisData),
    },
  ];
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

function formatWorkbookPatchValue(value: SteelWorkbookCellValue | undefined): string {
  if (value === undefined || value === null || value === '') {
    return '空白';
  }

  return String(value);
}

function formatWorkbookPatchSummaryValue(value: SteelWorkbookCellValue | undefined): string {
  return formatWorkbookPatchValue(value).replace(/\s+/g, ' ').trim();
}

function truncateWorkbookPatchSummaryValue(value: string, maxLength = 48): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function findWorkbookPatchChange(
  changes: SteelChangedFieldSummary[],
  columnKey: string,
): SteelChangedFieldSummary | undefined {
  return changes.find((change) => change.columnKey === columnKey);
}

function getWorkbookPatchNextValue(
  changes: SteelChangedFieldSummary[],
  columnKey: string,
): string | undefined {
  const change = findWorkbookPatchChange(changes, columnKey);
  if (!change) {
    return undefined;
  }

  const value = formatWorkbookPatchSummaryValue(change.nextValue);
  return value === '空白' ? undefined : truncateWorkbookPatchSummaryValue(value);
}

function getWorkbookPatchChangedLabels(changes: SteelChangedFieldSummary[]): string[] {
  const priorityLabels = [
    '客戶',
    '分級',
    '材料單價',
    '小計',
    '採用產品價格品項',
    '標準化品名',
    '價格來源',
    '判讀備註',
  ];
  const changedLabels = changes.map((change) => change.label);
  const labels = priorityLabels.filter((label) => changedLabels.includes(label));

  if (labels.length > 0) {
    return labels.slice(0, 4);
  }

  return changedLabels.slice(0, 4);
}

function isWorkbookFieldCountOnlyText(text: string): boolean {
  const normalized = text.trim();

  return (
    normalized === '已更新 workbook。' ||
    /^已更新\s*workbook\s*[：:]\s*\d+\s*個欄位[。.]?$/.test(normalized)
  );
}

function getWorkbookPatchFallbackSummary(patch: SteelWorkbookPatchResponse): string {
  const changes = patch.changedFieldSummary;
  if (changes.length === 0) {
    return '已更新 workbook，本輪新增資訊已套用。';
  }

  const orderInfo = [
    getWorkbookPatchNextValue(changes, 'customer_original_item_name'),
    getWorkbookPatchNextValue(changes, 'normalized_item_name'),
    getWorkbookPatchNextValue(changes, 'adopted_product_price_item'),
  ]
    .filter((value) => value !== undefined)
    .join('；');
  const customer = getWorkbookPatchNextValue(changes, 'customer');
  const customerTier = getWorkbookPatchNextValue(changes, 'customer_tier');
  const price = getWorkbookPatchNextValue(changes, 'material_unit_price');
  const subtotal = getWorkbookPatchNextValue(changes, 'subtotal');
  const orderInfoParts = [
    orderInfo.length > 0 ? orderInfo : undefined,
    customer ? `客戶：${customer}` : undefined,
    customerTier ? `分級：${customerTier}` : undefined,
    price ? `價格：${price}` : undefined,
    subtotal ? `小計：${subtotal}` : undefined,
  ].filter((value) => value !== undefined);
  const changedLabels = getWorkbookPatchChangedLabels(changes);
  const changedLabelText = changedLabels.length > 0 ? changedLabels.join('、') : 'workbook 欄位';

  return [
    `已更新 workbook。`,
    `訂單資訊：${orderInfoParts.length > 0 ? orderInfoParts.join('；') : '本輪資訊已套用'}。`,
    `改動重點：已更新${changedLabelText}等 ${changes.length} 個欄位。`,
  ].join('\n');
}

function getWorkbookPatchSummaryText(
  responseText: string,
  patch: SteelWorkbookPatchResponse,
): string {
  const trimmedResponseText = responseText.trim();
  if (trimmedResponseText.length > 0 && !isWorkbookFieldCountOnlyText(trimmedResponseText)) {
    return trimmedResponseText;
  }

  const [firstChange] = patch.changedFieldSummary;
  if (!firstChange) {
    return getWorkbookPatchFallbackSummary(patch);
  }

  if (patch.changedFieldSummary.length === 1) {
    return `已更新 workbook：${firstChange.label} -> ${String(firstChange.nextValue)}`;
  }

  return getWorkbookPatchFallbackSummary(patch);
}

async function applyChatWorkbookPatch(
  result: SteelChatProviderResultWithFileAnalysis,
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

async function applyChatFileAnalysisPatch(
  result: SteelChatProviderResult,
  context: {
    conversationId?: string;
    workbookId?: string;
  },
  getFileAnalysisService: () => ReturnType<typeof createSteelFileAnalysisService>,
): Promise<SteelChatProviderResultWithFileAnalysis> {
  const { fileAnalysisPatch, ...response } = result;
  if (!fileAnalysisPatch) {
    return response;
  }

  const proposal = steelProviderFileAnalysisPatchProposalSchema.parse(fileAnalysisPatch);
  if (!context.conversationId) {
    return {
      ...response,
      warnings: [...response.warnings, 'conversationId is required to persist file_analysis_data.'],
    };
  }

  const fileAnalysisData = await getFileAnalysisService().patch({
    conversationId: context.conversationId,
    workbookId: context.workbookId,
    patch: proposal,
  });

  return {
    ...response,
    fileAnalysisData,
  };
}

export function createSteelHandlers({
  env = process.env,
  executeToolCall,
  getModelsConfig,
  sendChat = sendSteelOAuthChat,
  resolveEvidenceFile,
  conversationService,
  ruleProposalService,
  workbookService,
  fileAnalysisService,
}: SteelHandlersDeps) {
  const getConversationService = () => conversationService ?? createDefaultConversationService(env);
  const getRuleProposalService = () => ruleProposalService ?? createDefaultRuleProposalService();
  const getWorkbookService = () => workbookService ?? createDefaultWorkbookService();
  const getFileAnalysisService = () => fileAnalysisService ?? createDefaultFileAnalysisService();

  return {
    async chat(req: Request, res: Response) {
      const config = parseSteelOpenAIConfig(env);
      const body = isRecord(req.body) ? req.body : {};

      let messages: SteelOAuthChatMessage[];
      let model: string;
      let maxOutputTokens: number | undefined;
      let reasoningEffort: SteelOpenAIReasoningEffort;
      let workbookContext: SteelChatWorkbookContext;
      let conversationId: string | undefined;
      try {
        conversationId = parseOptionalConversationId(body.conversationId);
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

      let messagesWithInstructions = applyFileInstructionsToMessages(
        messages,
        (req as SteelRequest).config,
      );
      if (fileAnalysisService) {
        messagesWithInstructions = await addFileAnalysisContextToMessages(
          messagesWithInstructions,
          conversationId,
          getFileAnalysisService,
        );
      }

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
        const responseWithFileAnalysis = await applyChatFileAnalysisPatch(
          result,
          {
            conversationId,
            workbookId: workbookContext.workbookId,
          },
          getFileAnalysisService,
        );
        const response = await applyChatWorkbookPatch(
          responseWithFileAnalysis,
          workbookContext,
          getWorkbookService,
        );
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
                'OpenAI OAuth provider returned an invalid Steel structured patch.',
              ),
            );
          return;
        }

        sendWorkbookError(res, error, env);
      }
    },

    async streamChat(req: Request, res: Response) {
      const config = parseSteelOpenAIConfig(env);
      const body = isRecord(req.body) ? req.body : {};

      let messages: SteelOAuthChatMessage[];
      let model: string;
      let maxOutputTokens: number | undefined;
      let reasoningEffort: SteelOpenAIReasoningEffort;
      let workbookContext: SteelChatWorkbookContext;
      let conversationId: string | undefined;
      try {
        conversationId = parseOptionalConversationId(body.conversationId);
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

      let messagesWithInstructions = applyFileInstructionsToMessages(
        messages,
        (req as SteelRequest).config,
      );
      if (fileAnalysisService) {
        messagesWithInstructions = await addFileAnalysisContextToMessages(
          messagesWithInstructions,
          conversationId,
          getFileAnalysisService,
        );
      }

      let workbookContextText: string | undefined;
      try {
        workbookContextText = await getChatWorkbookContextText(workbookContext, getWorkbookService);
      } catch (error) {
        sendWorkbookError(res, error, env);
        return;
      }

      setStreamHeaders(res);
      writeStreamEvent(res, {
        type: 'progress',
        stage: 'request_validated',
        message: 'Request validated',
      });

      const defaultToolExecutor = executeToolCall ? undefined : createDefaultStreamToolExecutor();
      const baseExecuteToolCall = executeToolCall ?? defaultToolExecutor?.executeToolCall;

      try {
        writeStreamEvent(res, {
          type: 'progress',
          stage: 'provider_request',
          message: 'Waiting for provider',
        });

        const result = await sendChat({
          authFilePath: resolveSteelOpenAIOAuthAuthFilePath(env),
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
          messages: messagesWithInstructions,
          model,
          onReasoningSummary: (summary) => {
            writeStreamEvent(res, {
              type: 'reasoning',
              summary,
            });
          },
          ...(hasMessageFiles(messagesWithInstructions)
            ? { passThroughUnsupportedFiles: true }
            : {}),
          reasoningEffort,
          steelRuntimePolicy: true,
          ...(workbookContext.workbookId && workbookContext.workbookVersion
            ? { workbookContextText, workbookPatchTool: true }
            : {}),
        });

        if (result.workbookPatch?.operations.length) {
          writeStreamEvent(res, {
            type: 'tool',
            status: 'started',
            toolName: 'patch_quote_workbook',
            message: 'patch_quote_workbook started',
          });
        }

        if (result.fileAnalysisPatch?.patches.length) {
          writeStreamEvent(res, {
            type: 'tool',
            status: 'started',
            toolName: 'patch_file_analysis_data',
            message: 'patch_file_analysis_data started',
          });
        }

        const responseWithFileAnalysis = await applyChatFileAnalysisPatch(
          result,
          {
            conversationId,
            workbookId: workbookContext.workbookId,
          },
          getFileAnalysisService,
        );
        const response = await applyChatWorkbookPatch(
          responseWithFileAnalysis,
          workbookContext,
          getWorkbookService,
        );

        if (result.fileAnalysisPatch?.patches.length) {
          writeStreamEvent(res, {
            type: 'tool',
            status: response.fileAnalysisData ? 'completed' : 'failed',
            toolName: 'patch_file_analysis_data',
            message: response.fileAnalysisData
              ? 'patch_file_analysis_data completed'
              : 'conversationId is required to persist file_analysis_data.',
            ok: Boolean(response.fileAnalysisData),
          });
        }

        if (result.workbookPatch?.operations.length) {
          writeStreamEvent(res, {
            type: 'tool',
            status: response.workbookPatch?.rejectedReason ? 'failed' : 'completed',
            toolName: 'patch_quote_workbook',
            message: response.workbookPatch?.rejectedReason ?? 'patch_quote_workbook completed',
            ok: response.workbookPatch?.rejectedReason ? false : true,
          });
        }

        if (response.text.length > 0) {
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

    async patchFileAnalysisData(req: SteelRequest, res: Response) {
      const parsed = steelFileAnalysisManualPatchRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid Steel file analysis patch request',
          errorCategory: 'steel_file_analysis_patch_invalid',
        });
        return;
      }

      try {
        const fileAnalysisData = await getFileAnalysisService().patch({
          conversationId: parsed.data.conversationId,
          workbookId: parsed.data.workbookId,
          patch: {
            fileAnalysisDataId: req.params.fileAnalysisDataId,
            sourceFiles: parsed.data.sourceFiles,
            patches: parsed.data.patches,
            summary: parsed.data.summary,
          },
        });
        res.status(200).json({ fileAnalysisData });
      } catch (error) {
        sendWorkbookError(res, error, env);
      }
    },

    async exportWorkbook(req: SteelRequest, res: Response) {
      const parsed = steelWorkbookExportRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid Steel workbook export request',
          errorCategory: 'steel_workbook_export_invalid',
        });
        return;
      }

      try {
        const { workbook } = await getWorkbookService().read({
          workbookId: req.params.workbookId,
        });
        if (workbook.version !== parsed.data.workbookVersion) {
          throw new SteelWorkbookVersionConflictError();
        }

        const result = await exportSteelWorkbookXlsx({
          workbook,
          sheetIds: parsed.data.sheetIds,
        });
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.buffer);
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
