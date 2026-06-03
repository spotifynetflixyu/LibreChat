import type {
  JSONValue,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3ToolCall,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { SteelOpenAIReasoningEffort } from './config';
import {
  requiredSteelWorkbookSheetIds,
  steelProviderWorkbookPatchProposalSchema,
  type SteelProviderWorkbookPatchProposal,
} from 'librechat-data-provider';
import { createSteelPostgresPool } from '../postgres';
import {
  createSteelToolRunState,
  executeSteelTool,
  type SteelToolRunState,
} from '../tools/execute';
import { getSteelToolDefinitions, isSteelToolName } from '../tools/registry';
import type { SteelToolResult } from '../tools/results';
import type { SteelToolName } from '../tools/schemas';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('openai-oauth-provider')>;

type CreateOpenAIOAuth = typeof createOpenAIOAuthType;
type SteelBusinessToolCall = LanguageModelV3ToolCall & { toolName: SteelToolName };

export interface SteelProviderExecuteToolCallOptions {
  toolName: string;
  arguments: unknown;
  providerToolCallId: string;
  runState: SteelToolRunState;
}

export type SteelProviderToolExecutor = (
  options: SteelProviderExecuteToolCallOptions,
) => Promise<SteelToolResult>;

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
  workbookPatch?: SteelProviderWorkbookPatchProposal;
}

export interface SendSteelOAuthChatOptions {
  abortSignal?: AbortSignal;
  authFilePath?: string;
  createOpenAIOAuth?: CreateOpenAIOAuth;
  ensureFresh?: boolean;
  executeSteelToolCall?: SteelProviderToolExecutor;
  fetch?: FetchFunction;
  maxOutputTokens?: number;
  messages: SteelOAuthChatMessage[];
  model: string;
  passThroughUnsupportedFiles?: boolean;
  reasoningEffort: SteelOpenAIReasoningEffort;
  steelToolMaxCalls?: number;
  steelRuntimePolicy?: boolean;
  workbookContextText?: string;
  workbookPatchTool?: boolean;
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

function getSteelRuntimePolicyInstruction(): string {
  return [
    'AI owns Steel tool orchestration.',
    'Interpret the user request, normalize ambiguous material/specification text, and choose among the AI-callable Steel tools: lookup_instructions, search_customers, search_price_candidates, lookup_defaults, lookup_formula, and workbook patch output.',
    'Generate material/specification candidates in reasoning; do not call a backend tool only to normalize raw wording or create search terms.',
    'Use backend internal validation/calculation for unit-weight, cutting, processing, material-rule, and formula-version details; do not call separate low-level lookup tools for those details.',
    'Call backend tools when you need reviewed rows, scoped quote-default candidates, formula candidates, deterministic calculation, or validated workbook output.',
    'Backend validates structured inputs, searches reviewed source rows, applies bounded safety policy, and performs deterministic calculations; do not invent source facts or silently accept unchecked assumptions.',
    'Do not treat raw customer text such as `亞L30x30` as a confirmed product-price key.',
    'First derive candidate material and specification fields, then generate candidate material and specification queries such as 錏角鐵 30x30, 錏成型角鐵 30x30, 鍍鋅角鐵 30x30, 角鐵 30x30, or L30x30 before searching reviewed price rows.',
    'For material price questions like `一支多少`, search reviewed price rows with derived candidates.',
    '遇到鋼材價格問題時，未取得 search_price_candidates tool result 前，不可回答查不到、不可宣稱已查表、不可要求使用者先補長度/客戶/厚度/分級。',
    'Do not stop before reviewed price lookup merely because length, thickness, customer, or tier is missing when bounded derived price queries can still be formed.',
    'Ask for missing length, thickness, customer, or tier after reviewed lookup, not before, unless no bounded derived price query can be formed.',
    'Do not pass customerTierId to search_price_candidates unless the user gave a customer/tier or search_customers returned a selected customer/tier; when tier is unknown, omit customerTierId so reviewed candidates can include all applicable tiers.',
    'For quick price questions like `一支多少`, if reviewed lookup returns one or more positive approximate candidates, lead with the highest-confidence source-backed candidate as a provisional quote or estimate, then list the other plausible candidates/specs/options for the user to confirm.',
    'If reviewed facts are missing, zero-valued, ambiguous, or only approximate, present bounded options with source differences and ask the user to confirm before treating the result as final; no confirmed customer-facing total is allowed before confirmation.',
    'If reviewed lookup returns no positive source-backed price candidates, do not invent a quote; explain the attempted candidate queries and ask for the missing detail or a user-supplied price.',
    'When workbook context is available and a candidate price is usable only as a preview, write provisional workbook updates with confidence, source, and option notes instead of confirmed totals.',
  ].join(' ');
}

function getWorkbookPatchInstruction(workbookContextText?: string): string {
  const instruction = [
    'You can update the visible Steel workbook by calling the patch_workbook tool.',
    'Use the tool when the user asks to set or update an explicit workbook cell.',
    'Use workbook structure context to resolve visible sheet, row, and column labels into internal sheetId, rowId, and columnKey values.',
    'Do not ask the user for internal workbook ids or keys when the target can be resolved from context.',
    'If the target sheet, row, column, or value is still ambiguous after checking context, ask a short clarification instead of calling the tool.',
    'Do not only describe a workbook update when the update should be applied.',
  ].join(' ');

  return workbookContextText
    ? `${instruction}\n\nWorkbook structure context:\n${workbookContextText}`
    : instruction;
}

function toPromptWithSystemInstruction(
  messages: SteelOAuthChatMessage[],
  systemInstruction: string,
): LanguageModelV3Prompt {
  return [
    {
      role: 'system',
      content: systemInstruction,
    },
    ...toPrompt(messages),
  ];
}

function getSystemInstruction({
  steelRuntimePolicy,
  workbookContextText,
  workbookPatchTool,
}: {
  steelRuntimePolicy?: boolean;
  workbookContextText?: string;
  workbookPatchTool?: boolean;
}): string | undefined {
  const instructions = [
    ...(steelRuntimePolicy ? [getSteelRuntimePolicyInstruction()] : []),
    ...(workbookPatchTool ? [getWorkbookPatchInstruction(workbookContextText)] : []),
  ];

  return instructions.length > 0 ? instructions.join('\n\n') : undefined;
}

const workbookPatchFunctionTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'patch_workbook',
  description:
    'Propose explicit workbook cell updates for the current Steel quote workbook. The backend validates and applies the operations.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['operations'],
    properties: {
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'sheetId', 'rowId', 'columnKey', 'value', 'reason'],
          properties: {
            op: { type: 'string', const: 'set_cell' },
            sheetId: { type: 'string', enum: [...requiredSteelWorkbookSheetIds] },
            rowId: { type: 'string', minLength: 1 },
            columnKey: { type: 'string', minLength: 1 },
            value: { type: ['string', 'number', 'boolean', 'null'] },
            reason: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

function getGeneratedText(result: LanguageModelV3GenerateResult): string {
  return result.content.reduce((text, part) => {
    if (part.type !== 'text') {
      return text;
    }

    return `${text}${part.text}`;
  }, '');
}

function requiresReviewedPriceLookup(messages: SteelOAuthChatMessage[]): boolean {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  if (!latestUserMessage) {
    return false;
  }

  return /一支多少|多少錢|報價|價格|單價|price/i.test(latestUserMessage.content);
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

function toJsonValue(value: unknown): JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return null;
  }

  return JSON.parse(serialized) as JSONValue;
}

interface ExecutedSteelToolCall {
  call: SteelBusinessToolCall;
  input: unknown;
  result: SteelToolResult;
}

async function executeSteelBusinessToolCalls({
  calls,
  executeSteelToolCall,
  runState,
}: {
  calls: SteelBusinessToolCall[];
  executeSteelToolCall: SteelProviderToolExecutor;
  runState: SteelToolRunState;
}): Promise<ExecutedSteelToolCall[]> {
  const executedCalls: ExecutedSteelToolCall[] = [];

  for (const call of calls) {
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

    try {
      result = await executeSteelToolCall({
        toolName: call.toolName,
        arguments: input,
        providerToolCallId: call.toolCallId,
        runState,
      });
    } catch (error) {
      result = createToolExecutionErrorResult(call, error);
    }

    executedCalls.push({
      call,
      input,
      result,
    });
  }

  return executedCalls;
}

function toAssistantToolCallMessage(
  executedCalls: ExecutedSteelToolCall[],
): LanguageModelV3Message {
  return {
    role: 'assistant',
    content: executedCalls.map(({ call, input }) => ({
      type: 'tool-call' as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input,
    })),
  };
}

function toToolResultMessage(executedCalls: ExecutedSteelToolCall[]): LanguageModelV3Message {
  return {
    role: 'tool',
    content: executedCalls.map(({ call, result }) => ({
      type: 'tool-result' as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: {
        type: 'json' as const,
        value: toJsonValue(result),
      },
    })),
  };
}

function getRequiredPriceLookupReminderMessage(): LanguageModelV3Message {
  return {
    role: 'system',
    content:
      'This Steel price request still requires reviewed price lookup. Call search_price_candidates with AI-derived candidate queries before answering.',
  };
}

function getWorkbookPatch(
  result: LanguageModelV3GenerateResult,
): SteelProviderWorkbookPatchProposal | undefined {
  const operations = result.content.flatMap((part) => {
    if (part.type !== 'tool-call' || part.toolName !== 'patch_workbook') {
      return [];
    }

    const parsed = steelProviderWorkbookPatchProposalSchema.parse(JSON.parse(part.input));
    return parsed.operations;
  });

  return operations.length > 0 ? { operations } : undefined;
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
  passThroughUnsupportedFiles,
  reasoningEffort,
  steelToolMaxCalls = 8,
  steelRuntimePolicy,
  workbookContextText,
  workbookPatchTool,
}: SendSteelOAuthChatOptions): Promise<SteelProviderChatResponse> {
  const createOpenAIOAuth = injectedCreateOpenAIOAuth ?? (await loadCreateOpenAIOAuth());
  const openai = createOpenAIOAuth({
    authFilePath,
    ensureFresh,
    fetch,
    responsesState: false,
  });

  const systemInstruction = getSystemInstruction({
    steelRuntimePolicy,
    workbookContextText,
    workbookPatchTool,
  });
  const tools = [
    ...(steelRuntimePolicy ? getSteelBusinessFunctionTools() : []),
    ...(workbookPatchTool ? [workbookPatchFunctionTool] : []),
  ];
  const runState = createSteelToolRunState(steelToolMaxCalls);
  let prompt = systemInstruction
    ? toPromptWithSystemInstruction(messages, systemInstruction)
    : toPrompt(messages);
  const generationResults: LanguageModelV3GenerateResult[] = [];
  const mustGetReviewedPriceResult =
    steelRuntimePolicy === true && requiresReviewedPriceLookup(messages);
  let hasReviewedPriceResult = false;

  for (let round = 0; round <= steelToolMaxCalls; round += 1) {
    const forceToolCall = mustGetReviewedPriceResult && !hasReviewedPriceResult;
    const result = await openai(model).doGenerate({
      abortSignal,
      prompt,
      maxOutputTokens,
      ...(tools.length > 0
        ? {
            tools,
            toolChoice: { type: forceToolCall ? 'required' : 'auto' },
          }
        : {}),
      providerOptions: {
        openai: {
          passThroughUnsupportedFiles,
          reasoningEffort,
        },
      },
    });

    generationResults.push(result);

    const steelBusinessToolCalls = steelRuntimePolicy ? getSteelBusinessToolCalls(result) : [];
    if (steelBusinessToolCalls.length === 0) {
      if (forceToolCall) {
        prompt = [...prompt, getRequiredPriceLookupReminderMessage()];
        continue;
      }

      break;
    }

    const executedCalls = await executeSteelBusinessToolCalls({
      calls: steelBusinessToolCalls,
      executeSteelToolCall,
      runState,
    });
    if (executedCalls.some(({ call }) => call.toolName === 'search_price_candidates')) {
      hasReviewedPriceResult = true;
    }

    prompt = [
      ...prompt,
      toAssistantToolCallMessage(executedCalls),
      toToolResultMessage(executedCalls),
    ];
  }

  if (mustGetReviewedPriceResult && !hasReviewedPriceResult) {
    throw new Error(
      'search_price_candidates was required before answering this Steel price request.',
    );
  }

  const result = generationResults[generationResults.length - 1];
  if (!result) {
    throw new Error('OpenAI OAuth provider did not return a Steel chat result.');
  }

  const workbookPatch = getWorkbookPatch(result);

  return {
    provider: 'openai_oauth_responses',
    model,
    text: getGeneratedText(result),
    responseId: result.response?.id,
    usage: getUsage(generationResults),
    unsupportedSettings: [],
    warnings: getWarnings(generationResults),
    ...(workbookPatch ? { workbookPatch } : {}),
  };
}
