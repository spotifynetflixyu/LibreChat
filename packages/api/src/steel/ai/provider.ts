import type {
  JSONValue,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3ToolCall,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { SteelOpenAIReasoningEffort } from './config';
import { serializeSteelRuntimeContext, type SteelRuntimeContext } from '../runtime/context';
import { createSteelPostgresPool } from '../postgres';
import { parseMarkdownTables } from '../markdown/table';
import { normalizeSteelSpecKey } from '../normalization/spec';
import {
  createSteelToolRunState,
  executeSteelTool,
  type SteelToolRunState,
} from '../tools/execute';
import {
  getSteelToolDefinitions,
  isSteelToolName,
  type SteelProviderToolName,
} from '../tools/registry';
import type { SteelToolResult } from '../tools/results';
import { defaultSteelPriceCustomerTierId, steelToolArgsSchemas } from '../tools/schemas';
import { runSteelFileOcr } from '../vision/ocr';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('openai-oauth-provider')>;

type CreateOpenAIOAuth = typeof createOpenAIOAuthType;
type SteelBusinessToolCall = LanguageModelV3ToolCall & { toolName: SteelProviderToolName };
type SearchPriceCandidatesInput = ReturnType<
  typeof steelToolArgsSchemas.search_price_candidates.parse
>;
type SearchPriceCandidateQuery =
  NonNullable<SearchPriceCandidatesInput['candidateQueries']>[number];
type SteelRoundTool = LanguageModelV3FunctionTool;
interface SteelPriceLookupRuntimeContext {
  customerTierId?: number;
  tableCandidateQueries: string[];
}
type SteelProviderRoundTiming = {
  round: number;
  generationDurationMs: number;
  toolDurationMs: number;
  promptMessageCount: number;
  generatedToolCallCount: number;
};
type SteelProviderTimings = {
  totalDurationMs: number;
  generationDurationMs: number;
  toolDurationMs: number;
  roundCount: number;
  rounds: SteelProviderRoundTiming[];
};

const defaultSteelToolMaxCalls = 8;

export interface SteelProviderExecuteToolCallOptions {
  toolName: string;
  arguments: unknown;
  providerToolCallId: string;
  runState: SteelToolRunState;
}

export type SteelProviderToolExecutor = (
  options: SteelProviderExecuteToolCallOptions,
) => Promise<SteelToolResult>;

export type SteelProviderToolStatusCallback = (event: {
  toolName: string;
  status: 'started' | 'completed' | 'failed';
  message?: string;
  result?: SteelToolResult;
  errorSummary?: string;
}) => void | Promise<void>;

export type SteelOAuthChatMessageRole = 'system' | 'user' | 'assistant';

export interface SteelOAuthChatFile {
  filename?: string;
  mediaType: string;
  data: Uint8Array | string | URL;
  pageCount?: number;
}

export interface SteelOAuthChatMessage {
  role: SteelOAuthChatMessageRole;
  content: string;
  messageId?: string;
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
  timings?: SteelProviderTimings;
  unsupportedSettings: string[];
  warnings: string[];
}

export interface SendSteelOAuthChatOptions {
  abortSignal?: AbortSignal;
  authFilePath?: string;
  conversationId?: string;
  createOpenAIOAuth?: CreateOpenAIOAuth;
  ensureFresh?: boolean;
  executeSteelToolCall?: SteelProviderToolExecutor;
  fetch?: FetchFunction;
  maxOutputTokens?: number;
  messages: SteelOAuthChatMessage[];
  model: string;
  onReasoningSummary?: (summary: string) => void;
  onTextDelta?: (delta: string) => void;
  onToolStatus?: SteelProviderToolStatusCallback;
  passThroughUnsupportedFiles?: boolean;
  reasoningEffort: SteelOpenAIReasoningEffort;
  steelToolMaxCalls?: number;
  steelRuntimePolicy?: boolean;
  steelRuntimeContext?: SteelRuntimeContext;
  workingMemorySummary?: string;
}

async function loadCreateOpenAIOAuth(): Promise<typeof createOpenAIOAuthType> {
  const provider = await dynamicImport('openai-oauth-provider');
  return provider.createOpenAIOAuth;
}

let defaultSteelToolClient: ReturnType<typeof createSteelPostgresPool> | undefined;
let steelBusinessFunctionTools: LanguageModelV3FunctionTool[] | undefined;

function getDefaultSteelToolClient() {
  defaultSteelToolClient ??= createSteelPostgresPool();
  return defaultSteelToolClient;
}

async function executeDefaultSteelToolCall({
  toolName,
  arguments: args,
  providerToolCallId,
  runState,
}: SteelProviderExecuteToolCallOptions): Promise<SteelToolResult> {
  return executeSteelTool({
    client: getDefaultSteelToolClient(),
    toolName,
    arguments: args,
    providerToolCallId,
    runState,
  });
}

function getSteelBusinessFunctionTools(): LanguageModelV3FunctionTool[] {
  steelBusinessFunctionTools ??= getSteelToolDefinitions().map((definition) => ({
    type: 'function',
    name: definition.name,
    description: definition.description,
    inputSchema: zodToJsonSchema(definition.argsSchema, {
      $refStrategy: 'none',
    }) as LanguageModelV3FunctionTool['inputSchema'],
  }));

  return steelBusinessFunctionTools;
}

function isVisualEvidenceFile(file: SteelOAuthChatFile): boolean {
  return getFileSourceKinds(file).length > 0;
}

function getRunFileOcrInventoryText(
  files: readonly SteelOAuthChatFile[],
  fileIndexOffset: number,
): string | undefined {
  const entries = files
    .map((file, index) => {
      if (!isVisualEvidenceFile(file)) {
        return undefined;
      }

      return `- fileIndex=${fileIndexOffset + index}; filename=${file.filename ?? '(unnamed)'}; mediaType=${file.mediaType}`;
    })
    .filter((entry): entry is string => entry !== undefined);

  return entries.length > 0
    ? `Uploaded visual evidence files available for OCR context preparation:\n${entries.join('\n')}`
    : undefined;
}

function toLanguageModelMessage(
  message: SteelOAuthChatMessage,
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
    visualFileIndexOffset = 0,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: ReadonlySet<SteelOAuthChatFile>;
    visualFileIndexOffset?: number;
  } = {},
): LanguageModelV3Message {
  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.content,
    };
  }

  const files = message.files ?? [];
  const ocrInventoryFiles =
    ocrAvailableVisualEvidenceFiles === undefined
      ? files
      : files.filter((file) => ocrAvailableVisualEvidenceFiles.has(file));
  const inventoryText = omitVisualEvidenceFileParts
    ? getRunFileOcrInventoryText(ocrInventoryFiles, visualFileIndexOffset)
    : undefined;

  return {
    role: message.role,
    content: [
      {
        type: 'text',
        text: inventoryText ? `${message.content}\n\n${inventoryText}` : message.content,
      },
      ...files
        .filter((file) => !omitVisualEvidenceFileParts || !isVisualEvidenceFile(file))
        .map((file) => {
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

function toPrompt(
  messages: SteelOAuthChatMessage[],
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: readonly SteelOAuthChatFile[];
  } = {},
): LanguageModelV3Prompt {
  let visualFileIndexOffset = 0;
  const ocrAvailableVisualEvidenceFileSet =
    ocrAvailableVisualEvidenceFiles !== undefined
      ? new Set(ocrAvailableVisualEvidenceFiles)
      : undefined;

  return messages.map((message) => {
    const promptMessage = toLanguageModelMessage(message, {
      omitVisualEvidenceFileParts,
      ocrAvailableVisualEvidenceFiles: ocrAvailableVisualEvidenceFileSet,
      visualFileIndexOffset,
    });
    visualFileIndexOffset += (message.files ?? []).filter((file) => {
      return (
        isVisualEvidenceFile(file) &&
        (ocrAvailableVisualEvidenceFileSet === undefined ||
          ocrAvailableVisualEvidenceFileSet.has(file))
      );
    }).length;

    return promptMessage;
  });
}

type VisualEvidenceSourceKind = 'image' | 'pdf' | 'scanned_pdf';

function getFileSourceKinds(file: SteelOAuthChatFile): VisualEvidenceSourceKind[] {
  const mediaType = file.mediaType.trim().toLowerCase();

  if (mediaType.startsWith('image/')) {
    return ['image'];
  }

  if (mediaType === 'application/pdf') {
    return ['pdf', 'scanned_pdf'];
  }

  return [];
}

function getVisualEvidenceFiles(
  messages: readonly SteelOAuthChatMessage[],
): SteelOAuthChatFile[] {
  const files: SteelOAuthChatFile[] = [];

  for (const message of messages) {
    for (const file of message.files ?? []) {
      if (getFileSourceKinds(file).length === 0) {
        continue;
      }

      files.push(file);
    }
  }

  return files;
}

function toPromptWithSystemInstruction(
  messages: SteelOAuthChatMessage[],
  systemInstruction: string,
  {
    omitVisualEvidenceFileParts = false,
    ocrAvailableVisualEvidenceFiles,
  }: {
    omitVisualEvidenceFileParts?: boolean;
    ocrAvailableVisualEvidenceFiles?: readonly SteelOAuthChatFile[];
  } = {},
): LanguageModelV3Prompt {
  return [
    {
      role: 'system',
      content: systemInstruction,
    },
    ...toPrompt(messages, { omitVisualEvidenceFileParts, ocrAvailableVisualEvidenceFiles }),
  ];
}

function getSystemInstruction({
  steelRuntimePolicy,
  steelRuntimeContext,
}: {
  steelRuntimePolicy?: boolean;
  steelRuntimeContext?: SteelRuntimeContext;
}): string | undefined {
  if (!steelRuntimePolicy) {
    return undefined;
  }

  if (!steelRuntimeContext) {
    throw new Error('Steel runtime context is required for Steel runtime policy.');
  }

  return `Steel Runtime Context\n\n${serializeSteelRuntimeContext(steelRuntimeContext)}`;
}

function getGeneratedText(result: LanguageModelV3GenerateResult): string {
  return result.content.reduce((text, part) => {
    if (part.type !== 'text') {
      return text;
    }

    return `${text}${part.text}`;
  }, '');
}

function isSteelBusinessToolCall(part: LanguageModelV3GenerateResult['content'][number]) {
  return part.type === 'tool-call' && isSteelToolName(part.toolName);
}

function getSteelBusinessToolCalls(result: LanguageModelV3GenerateResult): SteelBusinessToolCall[] {
  return result.content.filter(isSteelBusinessToolCall) as SteelBusinessToolCall[];
}

function parseToolCallInput(call: LanguageModelV3ToolCall): unknown {
  return JSON.parse(call.input);
}

function createInvalidToolInputResult(call: LanguageModelV3ToolCall): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'invalid_arguments',
    errorSummary: 'Steel tool input must be valid JSON.',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function createToolExecutionErrorResult(
  call: LanguageModelV3ToolCall,
  error: unknown,
): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'repository_error',
    errorSummary: error instanceof Error ? error.message : 'Steel tool execution failed.',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function isFatalSteelToolResult(result: SteelToolResult): boolean {
  return !result.ok && ['rate_limited', 'repository_error'].includes(result.errorCategory);
}

function getFatalSteelToolErrorMessage(call: SteelBusinessToolCall, result: SteelToolResult) {
  if (result.ok) {
    return '';
  }

  return `Steel tool ${call.toolName} failed: ${result.errorSummary}`;
}

function toJsonValue(value: unknown): JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return null;
  }

  return JSON.parse(serialized) as JSONValue;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

function isJsonObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findHeaderIndex(headers: readonly string[], patterns: readonly RegExp[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function getMarkdownTableSpecKeyCandidates(content: string): string[] {
  const candidates: string[] = [];

  for (const { headers, rows } of parseMarkdownTables(content)) {
    const codeIndex = findHeaderIndex(headers, [
      /代號/u,
      /型號/u,
      /品號/u,
      /erp/i,
      /item\s*code/i,
      /model\s*code/i,
    ]);
    const productNameIndex = findHeaderIndex(headers, [/品名/u, /產品/u, /product/i]);
    if (codeIndex < 0 || productNameIndex < 0) {
      continue;
    }

    for (const cells of rows) {
      const candidate = normalizeSteelSpecKey(cells[codeIndex], cells[productNameIndex]);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return uniqueStrings(candidates);
}

function createPriceLookupRuntimeContext(
  messages: readonly SteelOAuthChatMessage[],
): SteelPriceLookupRuntimeContext {
  return {
    tableCandidateQueries: uniqueStrings(
      messages.flatMap((message) => getMarkdownTableSpecKeyCandidates(message.content)),
    ),
  };
}

function readCustomerTierIds(result: SteelToolResult): number[] {
  if (!result.ok || result.toolName !== 'search_customers') {
    return [];
  }

  const customers = result.data.customers;
  if (!Array.isArray(customers)) {
    return [];
  }

  return uniqueStrings(
    customers.flatMap((customer) => {
      if (!isJsonObject(customer) || !isJsonObject(customer.customerTier)) {
        return [];
      }

      const id = customer.customerTier.id;
      return typeof id === 'number' && Number.isFinite(id) ? [String(id)] : [];
    }),
  ).map((id) => Number(id));
}

function updatePriceLookupRuntimeContext(
  context: SteelPriceLookupRuntimeContext,
  result: SteelToolResult,
) {
  const customerTierIds = readCustomerTierIds(result);
  if (customerTierIds.length === 1) {
    context.customerTierId = customerTierIds[0];
  }
}

function enrichSearchPriceInput(
  input: SearchPriceCandidatesInput,
  context: SteelPriceLookupRuntimeContext,
): SearchPriceCandidatesInput {
  const candidateQueries = uniqueStrings([
    ...input.candidateQueries,
    ...context.tableCandidateQueries,
  ]).slice(0, 20);
  const enrichedInput = {
    ...input,
    candidateQueries,
    customerTierId: input.customerTierId ?? context.customerTierId,
  };

  return steelToolArgsSchemas.search_price_candidates.parse(enrichedInput);
}

function isSearchPriceCoalesceCompatible(
  left: SearchPriceCandidatesInput,
  right: SearchPriceCandidatesInput,
): boolean {
  return (
    left.limit === right.limit &&
    (left.customerTierId ?? defaultSteelPriceCustomerTierId) ===
      (right.customerTierId ?? defaultSteelPriceCustomerTierId)
  );
}

function toBatchedPriceCandidate(
  input: SearchPriceCandidatesInput,
): SearchPriceCandidateQuery[] {
  return input.candidateQueries;
}

function createBatchedSearchPriceInput(
  inputs: readonly SearchPriceCandidatesInput[],
): SearchPriceCandidatesInput | undefined {
  if (inputs.length < 2) {
    return undefined;
  }

  const [firstInput] = inputs;
  if (!firstInput) {
    return undefined;
  }

  if (!inputs.every((input) => isSearchPriceCoalesceCompatible(firstInput, input))) {
    return undefined;
  }

  const candidateQueries = uniqueStrings(
    inputs.flatMap((input) => {
      return toBatchedPriceCandidate(input);
    }),
  );
  if (candidateQueries.length === 0 || candidateQueries.length > 20) {
    return undefined;
  }

  const batchedInput = {
    candidateQueries,
    limit: firstInput.limit,
  };

  if (firstInput.customerTierId === undefined) {
    return steelToolArgsSchemas.search_price_candidates.parse(batchedInput);
  }

  return steelToolArgsSchemas.search_price_candidates.parse({
    ...batchedInput,
    customerTierId: firstInput.customerTierId,
  });
}

interface ExecutedSteelToolCall {
  call: SteelBusinessToolCall;
  input: unknown;
  result: SteelToolResult;
}

function createInvalidToolArgumentsResult(
  call: LanguageModelV3ToolCall,
  errorSummary: string,
): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'invalid_arguments',
    errorSummary,
    durationMs: 0,
    redactionVersion: 1,
  };
}

function reserveProviderToolCall(
  call: LanguageModelV3ToolCall,
  runState: SteelToolRunState,
): SteelToolResult | undefined {
  if (runState.callsUsed < runState.maxCalls) {
    runState.callsUsed += 1;
    return undefined;
  }

  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'rate_limited',
    errorSummary: 'Steel tool call limit exceeded',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function recordProviderToolCallIfNeeded(
  runState: SteelToolRunState,
  callsUsedBeforeExecution: number,
  result: SteelToolResult,
) {
  if (
    runState.callsUsed === callsUsedBeforeExecution &&
    (!result.ok ? result.errorCategory !== 'rate_limited' : true)
  ) {
    runState.callsUsed += 1;
  }
}

async function executeProviderBusinessToolCall({
  call,
  executeSteelToolCall,
  input,
  runState,
}: {
  call: SteelBusinessToolCall;
  executeSteelToolCall: SteelProviderToolExecutor;
  input: unknown;
  runState: SteelToolRunState;
}): Promise<SteelToolResult> {
  if (runState.callsUsed >= runState.maxCalls) {
    return {
      ok: false,
      toolName: call.toolName,
      errorCategory: 'rate_limited',
      errorSummary: 'Steel tool call limit exceeded',
      durationMs: 0,
      redactionVersion: 1,
    };
  }

  const callsUsedBeforeExecution = runState.callsUsed;

  try {
    const result = await executeSteelToolCall({
      toolName: call.toolName,
      arguments: input,
      providerToolCallId: call.toolCallId,
      runState,
    });
    recordProviderToolCallIfNeeded(runState, callsUsedBeforeExecution, result);
    return result;
  } catch (error) {
    const result = createToolExecutionErrorResult(call, error);
    recordProviderToolCallIfNeeded(runState, callsUsedBeforeExecution, result);
    return result;
  }
}

async function executeSteelBusinessToolCalls({
  calls,
  executeSteelToolCall,
  files,
  onToolStatus,
  priceLookupContext,
  runState,
}: {
  calls: SteelBusinessToolCall[];
  executeSteelToolCall: SteelProviderToolExecutor;
  files: readonly SteelOAuthChatFile[];
  onToolStatus?: SteelProviderToolStatusCallback;
  priceLookupContext: SteelPriceLookupRuntimeContext;
  runState: SteelToolRunState;
}): Promise<ExecutedSteelToolCall[]> {
  const executedCalls: ExecutedSteelToolCall[] = [];
  const coalescedToolCallIds = new Set<string>();

  for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
    const call = calls[callIndex];
    if (!call || coalescedToolCallIds.has(call.toolCallId)) {
      continue;
    }

    let input: unknown;
    let result: SteelToolResult;
    try {
      input = parseToolCallInput(call);
    } catch {
      input = {};
      result = createInvalidToolInputResult(call);
      executedCalls.push({
        call,
        input,
        result,
      });
      continue;
    }

    if (call.toolName === 'run_file_ocr') {
      const parsedOcrInput = steelToolArgsSchemas.run_file_ocr.safeParse(input);
      if (!parsedOcrInput.success) {
        result = createInvalidToolArgumentsResult(
          call,
          parsedOcrInput.error.issues.map((issue) => issue.message).join('; '),
        );
        executedCalls.push({
          call,
          input,
          result,
        });
        continue;
      }

      result =
        reserveProviderToolCall(call, runState) ??
        (await (async () => {
          await onToolStatus?.({
            toolName: call.toolName,
            status: 'started',
            message: `${call.toolName} started`,
          });
          const toolResult = await runSteelFileOcr({
            arguments: parsedOcrInput.data,
            files,
            providerToolCallId: call.toolCallId,
          });
          await onToolStatus?.({
            toolName: call.toolName,
            status: toolResult.ok ? 'completed' : 'failed',
            message: toolResult.ok
              ? `${call.toolName} completed`
              : `${call.toolName} failed: ${toolResult.errorSummary}`,
            result: toolResult,
            errorSummary: toolResult.ok ? undefined : toolResult.errorSummary,
          });
          return toolResult;
        })());

      executedCalls.push({
        call,
        input: parsedOcrInput.data,
        result,
      });

      if (isFatalSteelToolResult(result)) {
        throw new Error(getFatalSteelToolErrorMessage(call, result));
      }
      continue;
    }

    if (call.toolName === 'search_price_candidates') {
      const parsedSearchInput = steelToolArgsSchemas.search_price_candidates.safeParse(input);
      if (parsedSearchInput.success) {
        const enrichedSearchInput = enrichSearchPriceInput(
          parsedSearchInput.data,
          priceLookupContext,
        );
        input = enrichedSearchInput;
        const groupedCalls: Array<{
          call: SteelBusinessToolCall;
          input: unknown;
          searchInput: SearchPriceCandidatesInput;
        }> = [{ call, input, searchInput: enrichedSearchInput }];

        for (const siblingCall of calls.slice(callIndex + 1)) {
          if (
            siblingCall.toolName !== 'search_price_candidates' ||
            coalescedToolCallIds.has(siblingCall.toolCallId)
          ) {
            continue;
          }

          let siblingInput: unknown;
          try {
            siblingInput = parseToolCallInput(siblingCall);
          } catch {
            continue;
          }

          const parsedSiblingSearchInput =
            steelToolArgsSchemas.search_price_candidates.safeParse(siblingInput);
          const enrichedSiblingSearchInput = parsedSiblingSearchInput.success
            ? enrichSearchPriceInput(parsedSiblingSearchInput.data, priceLookupContext)
            : undefined;
          if (
            enrichedSiblingSearchInput &&
            isSearchPriceCoalesceCompatible(enrichedSearchInput, enrichedSiblingSearchInput)
          ) {
            groupedCalls.push({
              call: siblingCall,
              input: enrichedSiblingSearchInput,
              searchInput: enrichedSiblingSearchInput,
            });
          }
        }

        const batchedInput = createBatchedSearchPriceInput(
          groupedCalls.map(({ searchInput }) => searchInput),
        );
        if (batchedInput) {
          result = await executeProviderBusinessToolCall({
            call,
            executeSteelToolCall,
            input: batchedInput,
            runState,
          });

          for (const groupedCall of groupedCalls) {
            coalescedToolCallIds.add(groupedCall.call.toolCallId);
            executedCalls.push({
              call: groupedCall.call,
              input: groupedCall.input,
              result,
            });
          }

          if (isFatalSteelToolResult(result)) {
            throw new Error(getFatalSteelToolErrorMessage(call, result));
          }
          continue;
        }
      }
    }

    result = await executeProviderBusinessToolCall({
      call,
      executeSteelToolCall,
      input,
      runState,
    });

    if (isFatalSteelToolResult(result)) {
      executedCalls.push({
        call,
        input,
        result,
      });
      throw new Error(getFatalSteelToolErrorMessage(call, result));
    }

    executedCalls.push({
      call,
      input,
      result,
    });
    updatePriceLookupRuntimeContext(priceLookupContext, result);
  }

  return executedCalls;
}

function toAssistantToolCallMessage(executedCalls: ExecutedSteelToolCall[]): LanguageModelV3Message {
  return {
    role: 'assistant',
    content: [
      ...executedCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
    ],
  };
}

function toToolResultMessage(executedCalls: ExecutedSteelToolCall[]): LanguageModelV3Message {
  return {
    role: 'tool',
    content: [
      ...executedCalls.map(({ call, result }) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          type: 'json' as const,
          value: toJsonValue(result),
        },
      })),
    ],
  };
}

function getReasoningSummaries(result: LanguageModelV3GenerateResult): string[] {
  return result.content
    .filter(
      (
        part,
      ): part is Extract<LanguageModelV3GenerateResult['content'][number], { type: 'reasoning' }> =>
        part.type === 'reasoning',
    )
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0);
}

function getWarningText(warning: SharedV3Warning): string {
  if (warning.type === 'other') {
    return warning.message;
  }

  return warning.details ? `${warning.feature}: ${warning.details}` : warning.feature;
}

function sumTokenTotals(
  results: LanguageModelV3GenerateResult[],
  getTotal: (result: LanguageModelV3GenerateResult) => number | undefined,
) {
  const totals = results
    .map(getTotal)
    .filter((value): value is number => typeof value === 'number');

  return totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) : undefined;
}

function getUsage(results: LanguageModelV3GenerateResult[]): SteelProviderChatResponse['usage'] {
  const inputTokens = sumTokenTotals(results, (result) => result.usage.inputTokens.total);
  const outputTokens = sumTokenTotals(results, (result) => result.usage.outputTokens.total);
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

function getWarnings(results: LanguageModelV3GenerateResult[]): string[] {
  return results.flatMap((result) => result.warnings.map(getWarningText));
}

function sumRoundTimings(
  rounds: readonly SteelProviderRoundTiming[],
  getDuration: (round: SteelProviderRoundTiming) => number,
) {
  return rounds.reduce((total, round) => total + getDuration(round), 0);
}

function getProviderTimings({
  rounds,
  startedAt,
}: {
  rounds: readonly SteelProviderRoundTiming[];
  startedAt: number;
}): SteelProviderTimings {
  return {
    totalDurationMs: Math.max(0, Date.now() - startedAt),
    generationDurationMs: sumRoundTimings(rounds, (round) => round.generationDurationMs),
    toolDurationMs: sumRoundTimings(rounds, (round) => round.toolDurationMs),
    roundCount: rounds.length,
    rounds: [...rounds],
  };
}

function countGeneratedToolCalls(result: LanguageModelV3GenerateResult): number {
  return result.content.filter((part) => part.type === 'tool-call').length;
}

function getDefaultFinishReason() {
  return { unified: 'stop' as const, raw: 'stop' };
}

function getDefaultUsage(): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 0,
      text: 0,
      reasoning: 0,
    },
  };
}

async function streamToGenerateResult({
  stream,
  onReasoningSummary,
  onTextDelta,
}: {
  stream: ReadableStream<LanguageModelV3StreamPart>;
  onReasoningSummary?: (summary: string) => void;
  onTextDelta?: (delta: string) => void;
}): Promise<LanguageModelV3GenerateResult> {
  const content: LanguageModelV3GenerateResult['content'] = [];
  const warnings: SharedV3Warning[] = [];
  let response: LanguageModelV3GenerateResult['response'];
  let usage: LanguageModelV3GenerateResult['usage'] = getDefaultUsage();
  let finishReason: LanguageModelV3GenerateResult['finishReason'] = getDefaultFinishReason();
  let currentText = '';

  const flushText = () => {
    if (currentText.length === 0) {
      return;
    }

    content.push({ type: 'text', text: currentText });
    currentText = '';
  };

  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      const part = next.value;
      switch (part.type) {
        case 'stream-start':
          warnings.push(...part.warnings);
          break;
        case 'response-metadata':
          response = part;
          break;
        case 'text-delta':
          currentText += part.delta;
          onTextDelta?.(part.delta);
          break;
        case 'text-end':
          flushText();
          break;
        case 'reasoning-delta':
          onReasoningSummary?.(part.delta);
          break;
        case 'tool-call':
          flushText();
          content.push(part);
          break;
        case 'finish':
          flushText();
          usage = part.usage;
          finishReason = part.finishReason;
          break;
        case 'error':
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
        default:
          break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  flushText();

  return {
    content,
    finishReason,
    usage,
    response,
    warnings,
  };
}

export async function sendSteelOAuthChat({
  abortSignal,
  authFilePath,
  createOpenAIOAuth: injectedCreateOpenAIOAuth,
  ensureFresh = true,
  executeSteelToolCall = executeDefaultSteelToolCall,
  fetch,
  maxOutputTokens,
  messages,
  model,
  onReasoningSummary,
  onTextDelta,
  onToolStatus,
  passThroughUnsupportedFiles,
  reasoningEffort,
  steelToolMaxCalls,
  steelRuntimePolicy,
  steelRuntimeContext,
}: SendSteelOAuthChatOptions): Promise<SteelProviderChatResponse> {
  const providerStartedAt = Date.now();
  const promptMessages = messages;
  const allVisualEvidenceFiles =
    steelRuntimePolicy === true ? getVisualEvidenceFiles(promptMessages) : [];
  const systemInstruction = getSystemInstruction({
    steelRuntimePolicy,
    steelRuntimeContext,
  });
  const createOpenAIOAuth = injectedCreateOpenAIOAuth ?? (await loadCreateOpenAIOAuth());
  const openai = createOpenAIOAuth({
    authFilePath,
    ensureFresh,
    fetch,
    responsesState: false,
  });
  const tools = [
    ...(steelRuntimePolicy ? getSteelBusinessFunctionTools() : []),
  ] satisfies SteelRoundTool[];
  const maxToolCalls = steelToolMaxCalls ?? defaultSteelToolMaxCalls;
  const runState = createSteelToolRunState(maxToolCalls);
  const priceLookupContext = createPriceLookupRuntimeContext(promptMessages);
  const omitVisualEvidenceFileParts = false;
  let prompt = systemInstruction
    ? toPromptWithSystemInstruction(promptMessages, systemInstruction, {
        omitVisualEvidenceFileParts,
        ocrAvailableVisualEvidenceFiles: allVisualEvidenceFiles,
      })
    : toPrompt(promptMessages, {
        omitVisualEvidenceFileParts,
        ocrAvailableVisualEvidenceFiles: allVisualEvidenceFiles,
      });
  const generationResults: LanguageModelV3GenerateResult[] = [];
  const roundTimings: SteelProviderRoundTiming[] = [];

  for (let round = 0; round <= maxToolCalls; round += 1) {
    const promptMessageCount = prompt.length;
    const generationStartedAt = Date.now();
    const languageModel = openai(model);
    const callOptions = {
      abortSignal,
      prompt,
      maxOutputTokens,
      ...(tools.length > 0
        ? {
            tools,
            toolChoice: { type: 'auto' as const },
          }
        : {}),
      providerOptions: {
        openai: {
          passThroughUnsupportedFiles,
          reasoningEffort,
          ...(onReasoningSummary ? { reasoningSummary: 'auto' as const } : {}),
        },
      },
    };
    const result =
      onTextDelta && typeof languageModel.doStream === 'function'
        ? await streamToGenerateResult({
            ...(await languageModel.doStream(callOptions)),
            onReasoningSummary,
            onTextDelta,
          })
        : await languageModel.doGenerate(callOptions);
    const generationDurationMs = Math.max(0, Date.now() - generationStartedAt);
    let toolDurationMs = 0;

    generationResults.push(result);
    for (const summary of getReasoningSummaries(result)) {
      onReasoningSummary?.(summary);
    }
    let recordedRoundTiming = false;
    const recordRoundTiming = () => {
      if (recordedRoundTiming) {
        return;
      }

      recordedRoundTiming = true;
      roundTimings.push({
        round,
        generationDurationMs,
        toolDurationMs,
        promptMessageCount,
        generatedToolCallCount: countGeneratedToolCalls(result),
      });
    };

    const steelBusinessToolCalls = steelRuntimePolicy ? getSteelBusinessToolCalls(result) : [];
    if (steelBusinessToolCalls.length === 0) {
      recordRoundTiming();
      break;
    }
    if (round >= maxToolCalls) {
      throw new Error('Steel tool call limit exceeded');
    }

    const steelBusinessToolsStartedAt = Date.now();
    const executedCalls = await executeSteelBusinessToolCalls({
      calls: steelBusinessToolCalls,
      executeSteelToolCall,
      files: allVisualEvidenceFiles,
      onToolStatus,
      priceLookupContext,
      runState,
    });
    toolDurationMs += Math.max(0, Date.now() - steelBusinessToolsStartedAt);
    const nextPrompt = [
      ...prompt,
      toAssistantToolCallMessage(executedCalls),
      toToolResultMessage(executedCalls),
    ];
    prompt = nextPrompt;
    recordRoundTiming();
  }

  const result = generationResults[generationResults.length - 1];
  if (!result) {
    throw new Error('OpenAI OAuth provider did not return a Steel chat result.');
  }

  return {
    provider: 'openai_oauth_responses',
    model,
    text: getGeneratedText(result),
    responseId: result.response?.id,
    usage: getUsage(generationResults),
    timings: getProviderTimings({ rounds: roundTimings, startedAt: providerStartedAt }),
    unsupportedSettings: [],
    warnings: getWarnings(generationResults),
  };
}
