import type {
  JSONValue,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3ToolCall,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ToolChoice,
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
type WorkbookPatchToolCall = LanguageModelV3ToolCall & { toolName: 'patch_workbook' };
type WorkbookPatchOperation = SteelProviderWorkbookPatchProposal['operations'][number];

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
    '統一用繁體中文回覆。',
    'Interpret the user request, normalize ambiguous material/specification text, and choose among the AI-callable Steel tools: lookup_quote_rules, lookup_instructions, lookup_catalog_families, search_customers, search_price_candidates, lookup_defaults, lookup_formula, and workbook patch output.',
    'Generate material/specification candidates in reasoning; do not call a backend tool only to normalize raw wording or create search terms.',
    'Use backend internal validation/calculation for unit-weight, cutting, processing, material-rule, and formula-version details; do not call separate low-level lookup tools for those details.',
    'Call backend tools when you need reviewed rows, scoped quote-default candidates, formula candidates, deterministic calculation, or validated workbook output.',
    'Backend validates structured inputs, searches reviewed source rows, applies bounded safety policy, and performs deterministic calculations; do not invent source facts or silently accept unchecked assumptions.',
    'Do not treat raw customer text such as `亞L30x30` as a confirmed product-price key.',
    'When catalog family wording is unclear, call lookup_catalog_families for reviewed vocabulary candidates, then choose catalogFamilies yourself or ask the user to confirm.',
    'Backend does not decide oral wording to catalog_family mappings; backend returns catalog vocabulary candidates and validates explicit keys selected by AI.',
    'Use canonical catalog family keys such as h_beam, c_type, and angle when calling lookup_quote_rules, lookup_instructions, search_price_candidates, lookup_defaults, or lookup_formula.',
    'For oral orders, first infer product/category candidates and choose the catalog key yourself; after choosing a catalog/category key, call lookup_quote_rules with the interpreted order context before category-dependent lookups such as search_price_candidates, lookup_defaults, or lookup_formula. lookup_instructions is legacy-compatible and should only be used when an instruction-only subset is needed.',
    'First derive candidate material and specification fields, then generate candidate material and specification queries such as 錏角鐵 30x30, 錏成型角鐵 30x30, 鍍鋅角鐵 30x30, 角鐵 30x30, or L30x30 before searching reviewed price rows.',
    'For material price questions like `一支多少`, search reviewed price rows with derived candidates.',
    'If instruction packets provide processing price candidate names or ERP item codes, call search_price_candidates for the reviewed processing rows before quoting those processing charges; do not quote processing prices solely from instruction packet text.',
    '遇到鋼材價格問題時，未取得 search_price_candidates tool result 前，不可回答查不到、不可宣稱已查表、不可要求使用者先補長度/客戶/厚度/分級。',
    'Do not stop before reviewed price lookup merely because length, thickness, customer, or tier is missing when bounded derived price queries can still be formed.',
    'Ask for missing length, thickness, customer, or tier after reviewed lookup, not before, unless no bounded derived price query can be formed.',
    'Do not pass customerTierId to search_price_candidates unless the user gave a customer/tier or search_customers returned a selected customer/tier; when tier is unknown, omit customerTierId so reviewed candidates can include all applicable tiers.',
    'When customer/tier is unknown, lookup_quote_rules may set customerContext.tierKnown=false, but must not invent customerId or customerTierId values such as 1 or 2. Unknown customer/tier context is represented by omitted IDs plus tierKnown=false.',
    'When customer/tier is not known, set customerContext.tierKnown=false in lookup_quote_rules and omit customerTierId from price lookup. If reviewed lookup returns tiered prices, use customerTierCode B as the primary provisional/default price, while still listing returned A/B/C/F tier options and asking the user to confirm customer tier when needed.',
    'For C 型鋼 / c_type with unspecified material or surface, AI may use productName 錏輕型鋼 as the usual high-confidence provisional candidate, but the first reply must also show same-spec reviewed alternatives such as 白鐵輕型鋼 or 黑鐵輕型鋼 when returned. In follow-up turns, if the user does not specify another material/surface after those options were shown, treat the default 錏輕型鋼 assumption as confirmed for the continuing quote context.',
    'For product-price rows, interpret unitPrice together with unit, productPriceUnitWeight, and productPriceUnitWeightUnit. If unit = kg, unitPrice is a per-kg price; convert length/piece weight into kg before multiplying unitPrice. If unit = piece, unitPrice is already a per-piece/per-unit total.',
    'For product-price rows with productPriceUnitWeightUnit = kg_per_m and unit = kg, calculate provisional piece amount from kg_per_m * requested meters * unitPrice; do not answer as if unitPrice were per-piece.',
    'For product-price rows whose product name/spec contains a fixed length in meters and productPriceUnitWeightUnit = kg_per_piece with unit = kg, price a whole source piece as pieceWeightKg * unitPrice. If unit = piece, price the whole source piece by unitPrice. Offcut/remnant is charged by default unless the user explicitly says remnants are not charged.',
    'If product-price row metadata says sourceUnitWeightOrigin = product_name_parentheses, treat the parenthesized product-name number as reviewed weight evidence and mention it when explaining the source.',
    'Apply product-price unit-weight calculation only to steel/material stock catalog families such as h_beam including 輕量H, c_type, angle, channel, flat_bar, rail, pipe, plate, mesh, grating, and floor deck. Do not apply this steel material rule to non-material product/accessory rows such as springs, screws, locks, wheels, windows, resin panels, doors, gates, or tools unless a reviewed rule explicitly says so.',
    'When a positive productPriceUnitWeight comes from the reviewed unit-weight column, it has priority over product-name parentheses. Parentheses are fallback-only for missing or zero unit-weight columns.',
    'For fixed-length material rows with a positive ratio/sourceRatio and a piece-total unitPrice, do not reinterpret that unitPrice as per-kg merely because the parenthetical weight conflicts with the reviewed unit-weight column. Keep the unitPrice as a piece total and flag the weight conflict for confirmation.',
    'When any unit-weight source is missing or contradictory, use related same-series/same-spec reviewed material rows, different-length rows, or comparable material rows to derive proportional inferred evidence if possible, but label that value as inferred/low-confidence or confirmation-needed and do not silently overwrite reviewed source values.',
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
    'For quick Steel price estimates with reviewed positive candidate prices, write provisional workbook preview rows with patch_workbook.',
    'For provisional price previews, update quote_details, price_sources, and interpretation_notes fields that describe the candidate, source, confidence, and confirmation needed.',
    'Do not write confirmed totals, summary total amount, customer_quote subtotal, quote_details subtotal, material_fee, or any customer-facing confirmed total before the user confirms the selected item, thickness, length, customer, and tier.',
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

function createInstructionLookupRequiredResult(call: LanguageModelV3ToolCall): SteelToolResult {
  return {
    ok: false,
    toolName: call.toolName,
    errorCategory: 'invalid_arguments',
    errorSummary:
      'lookup_quote_rules is required before category-dependent Steel lookups. When AI has selected a catalog/category key from oral order evidence, first call lookup_quote_rules with the interpreted order context, then call search_price_candidates, lookup_defaults, or lookup_formula. lookup_instructions is accepted only as a legacy instruction-only compatibility path.',
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

function getStringArrayProperty(value: unknown, key: string): string[] {
  if (!isJsonObject(value)) {
    return [];
  }

  const property = value[key];
  if (!Array.isArray(property)) {
    return [];
  }

  return property.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
  );
}

function hasCatalogContext(input: unknown): boolean {
  if (!isJsonObject(input)) {
    return false;
  }

  const contexts = input.catalogContexts;
  if (!Array.isArray(contexts)) {
    return false;
  }

  return contexts.some(
    (context) =>
      getStringArrayProperty(context, 'catalogCandidates').length > 0 ||
      getStringArrayProperty(context, 'packetGroupHints').length > 0,
  );
}

function isCategoryDependentLookup(call: SteelBusinessToolCall, input: unknown): boolean {
  switch (call.toolName) {
    case 'search_price_candidates':
      return getStringArrayProperty(input, 'catalogFamilies').length > 0;
    case 'lookup_defaults':
    case 'lookup_formula':
      return hasCatalogContext(input);
    default:
      return false;
  }
}

function hasCustomerTierFilter(input: unknown): boolean {
  return isJsonObject(input) && typeof input.customerTierId === 'number';
}

function hasUnknownCustomerTierContext(input: unknown): boolean {
  if (!isJsonObject(input)) {
    return false;
  }

  const customerContext = input.customerContext;
  return isJsonObject(customerContext) && customerContext.tierKnown === false;
}

function omitCustomerTierFilter(input: unknown): unknown {
  if (!isJsonObject(input)) {
    return input;
  }

  const { customerTierId, ...sanitizedInput } = input;
  void customerTierId;

  return sanitizedInput;
}

interface ExecutedSteelToolCall {
  call: SteelBusinessToolCall;
  input: unknown;
  result: SteelToolResult;
}

interface ParsedWorkbookPatchToolCall {
  call: WorkbookPatchToolCall;
  input: SteelProviderWorkbookPatchProposal;
}

async function executeSteelBusinessToolCalls({
  calls,
  executeSteelToolCall,
  allowCustomerTierFilter,
  hasInstructionLookupResult,
  runState,
}: {
  calls: SteelBusinessToolCall[];
  executeSteelToolCall: SteelProviderToolExecutor;
  allowCustomerTierFilter: boolean;
  hasInstructionLookupResult: boolean;
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

    if (!hasInstructionLookupResult && isCategoryDependentLookup(call, input)) {
      result = createInstructionLookupRequiredResult(call);
      executedCalls.push({
        call,
        input,
        result,
      });
      continue;
    }

    const executionInput =
      call.toolName === 'search_price_candidates' &&
      !allowCustomerTierFilter &&
      hasCustomerTierFilter(input)
        ? omitCustomerTierFilter(input)
        : input;

    try {
      result = await executeSteelToolCall({
        toolName: call.toolName,
        arguments: executionInput,
        providerToolCallId: call.toolCallId,
        runState,
      });
    } catch (error) {
      result = createToolExecutionErrorResult(call, error);
    }

    executedCalls.push({
      call,
      input: executionInput,
      result,
    });
  }

  return executedCalls;
}

function toAssistantToolCallMessage(
  executedCalls: ExecutedSteelToolCall[],
  workbookPatchCalls: ParsedWorkbookPatchToolCall[] = [],
): LanguageModelV3Message {
  return {
    role: 'assistant',
    content: [
      ...executedCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
      ...workbookPatchCalls.map(({ call, input }) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input,
      })),
    ],
  };
}

function toWorkbookPatchToolResultValue(input: SteelProviderWorkbookPatchProposal): JSONValue {
  return toJsonValue({
    ok: true,
    toolName: 'patch_workbook',
    operationCount: input.operations.length,
    instruction:
      'Workbook patch captured for backend validation and application. Now answer the user in Traditional Chinese with the provisional quote, bounded options, source differences, and confirmation needed. Do not call patch_workbook again unless another workbook update is needed.',
  });
}

function toToolResultMessage(
  executedCalls: ExecutedSteelToolCall[],
  workbookPatchCalls: ParsedWorkbookPatchToolCall[] = [],
): LanguageModelV3Message {
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
      ...workbookPatchCalls.map(({ call, input }) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          type: 'json' as const,
          value: toWorkbookPatchToolResultValue(input),
        },
      })),
    ],
  };
}

function getRequiredPriceLookupReminderMessage(): LanguageModelV3Message {
  return {
    role: 'system',
    content:
      'This Steel price request still requires reviewed lookup. If you have selected a catalog/category key and lookup_quote_rules has not completed for this interpreted order context, call lookup_quote_rules first; otherwise call search_price_candidates with AI-derived candidate queries before answering. For C 型鋼/c_type such as C100x50x20x2.3t, use catalogFamilies [c_type], a compact price-table spec fragment such as 100x2.3, and productName 錏輕型鋼 when material is unspecified; omit customerTierId when tier is unknown so returned reviewed tiers can include the B default price and other A/B/C/F options.',
  };
}

function getProvisionalWorkbookPatchReminderMessage(): LanguageModelV3Message {
  return {
    role: 'system',
    content:
      'This positive Steel price lookup still requires a provisional workbook preview. Call patch_workbook to update quote_details, price_sources, and interpretation_notes with provisional candidate/source/confidence notes. Do not write confirmed totals, summary total amount, customer_quote subtotal, quote_details subtotal, or material_fee before user confirmation.',
  };
}

function isJsonObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPositivePriceCandidate(result: SteelToolResult): boolean {
  if (!result.ok) {
    return false;
  }

  const priceCandidates = result.data.priceCandidates;
  if (!Array.isArray(priceCandidates)) {
    return false;
  }

  return priceCandidates.some((candidate) => {
    return (
      isJsonObject(candidate) && typeof candidate.unitPrice === 'number' && candidate.unitPrice > 0
    );
  });
}

function isCompletedPriceLookup(result: SteelToolResult): boolean {
  return result.ok || result.errorCategory !== 'invalid_arguments';
}

function isWorkbookPatchToolCall(
  part: LanguageModelV3GenerateResult['content'][number],
): part is WorkbookPatchToolCall {
  return part.type === 'tool-call' && part.toolName === 'patch_workbook';
}

function getWorkbookPatchToolCalls(result: LanguageModelV3GenerateResult): WorkbookPatchToolCall[] {
  return result.content.filter(isWorkbookPatchToolCall);
}

function parseWorkbookPatchToolCalls(
  calls: WorkbookPatchToolCall[],
): ParsedWorkbookPatchToolCall[] {
  return calls.map((call) => ({
    call,
    input: steelProviderWorkbookPatchProposalSchema.parse(JSON.parse(call.input)),
  }));
}

function getWorkbookPatchFromOperations(
  operations: WorkbookPatchOperation[],
): SteelProviderWorkbookPatchProposal | undefined {
  return operations.length > 0 ? { operations } : undefined;
}

function getWarningText(warning: SharedV3Warning): string {
  if (warning.type === 'other') {
    return warning.message;
  }

  return warning.details ? `${warning.feature}: ${warning.details}` : warning.feature;
}

function getSteelToolChoice({
  hasReviewedPriceResult,
  mustGetReviewedPriceResult,
}: {
  hasReviewedPriceResult: boolean;
  mustGetReviewedPriceResult: boolean;
}): LanguageModelV3ToolChoice {
  if (!mustGetReviewedPriceResult || hasReviewedPriceResult) {
    return { type: 'auto' };
  }

  return { type: 'required' };
}

function getSteelToolsForRound({
  hasInstructionLookupResult,
  hasReviewedPriceResult,
  mustGetReviewedPriceResult,
  tools,
}: {
  hasInstructionLookupResult: boolean;
  hasReviewedPriceResult: boolean;
  mustGetReviewedPriceResult: boolean;
  tools: LanguageModelV3FunctionTool[];
}): LanguageModelV3FunctionTool[] {
  if (mustGetReviewedPriceResult && hasInstructionLookupResult && !hasReviewedPriceResult) {
    return tools.filter((tool) => tool.name === 'search_price_candidates');
  }

  return tools;
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
  const mustGetProvisionalWorkbookPatch = mustGetReviewedPriceResult && workbookPatchTool === true;
  let hasReviewedPriceResult = false;
  let hasInstructionLookupResult = false;
  let hasPositiveReviewedPriceCandidate = false;
  let allowCustomerTierFilter = true;
  let hasWorkbookPatch = false;
  const workbookPatchOperations: WorkbookPatchOperation[] = [];

  for (let round = 0; round <= steelToolMaxCalls; round += 1) {
    const forceToolCall = mustGetReviewedPriceResult && !hasReviewedPriceResult;
    const toolChoice = getSteelToolChoice({
      hasReviewedPriceResult,
      mustGetReviewedPriceResult,
    });
    const roundTools = getSteelToolsForRound({
      hasInstructionLookupResult,
      hasReviewedPriceResult,
      mustGetReviewedPriceResult,
      tools,
    });
    const result = await openai(model).doGenerate({
      abortSignal,
      prompt,
      maxOutputTokens,
      ...(roundTools.length > 0
        ? {
            tools: roundTools,
            toolChoice,
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
    const workbookPatchCalls = workbookPatchTool ? getWorkbookPatchToolCalls(result) : [];
    const parsedWorkbookPatchCalls = parseWorkbookPatchToolCalls(workbookPatchCalls);
    workbookPatchOperations.push(
      ...parsedWorkbookPatchCalls.flatMap(({ input }) => input.operations),
    );
    hasWorkbookPatch = workbookPatchOperations.length > 0;

    const steelBusinessToolCalls = steelRuntimePolicy ? getSteelBusinessToolCalls(result) : [];
    if (steelBusinessToolCalls.length === 0) {
      if (forceToolCall) {
        prompt = [...prompt, getRequiredPriceLookupReminderMessage()];
        continue;
      }

      if (
        mustGetProvisionalWorkbookPatch &&
        hasPositiveReviewedPriceCandidate &&
        !hasWorkbookPatch
      ) {
        prompt = [...prompt, getProvisionalWorkbookPatchReminderMessage()];
        continue;
      }

      if (
        parsedWorkbookPatchCalls.length > 0 &&
        mustGetProvisionalWorkbookPatch &&
        hasPositiveReviewedPriceCandidate
      ) {
        prompt = [
          ...prompt,
          toAssistantToolCallMessage([], parsedWorkbookPatchCalls),
          toToolResultMessage([], parsedWorkbookPatchCalls),
        ];
        continue;
      }

      break;
    }

    const executedCalls = await executeSteelBusinessToolCalls({
      calls: steelBusinessToolCalls,
      executeSteelToolCall,
      allowCustomerTierFilter,
      hasInstructionLookupResult,
      runState,
    });
    if (
      executedCalls.some(
        ({ call, result: toolResult }) =>
          (call.toolName === 'lookup_quote_rules' || call.toolName === 'lookup_instructions') &&
          toolResult.ok,
      )
    ) {
      hasInstructionLookupResult = true;
    }
    const customerTierContextCalls = executedCalls.filter(
      ({ call, result: toolResult }) =>
        (call.toolName === 'lookup_quote_rules' || call.toolName === 'lookup_instructions') &&
        toolResult.ok,
    );
    if (customerTierContextCalls.some(({ input }) => hasUnknownCustomerTierContext(input))) {
      allowCustomerTierFilter = false;
    }
    const priceLookupCalls = executedCalls.filter(
      ({ call }) => call.toolName === 'search_price_candidates',
    );
    if (priceLookupCalls.length > 0) {
      hasReviewedPriceResult =
        hasReviewedPriceResult ||
        priceLookupCalls.some(({ result: toolResult }) => isCompletedPriceLookup(toolResult));
      hasPositiveReviewedPriceCandidate =
        hasPositiveReviewedPriceCandidate ||
        priceLookupCalls.some(({ result: toolResult }) => hasPositivePriceCandidate(toolResult));
    }

    const nextPrompt = [
      ...prompt,
      toAssistantToolCallMessage(executedCalls, parsedWorkbookPatchCalls),
      toToolResultMessage(executedCalls, parsedWorkbookPatchCalls),
    ];
    prompt =
      mustGetReviewedPriceResult && !hasReviewedPriceResult
        ? [...nextPrompt, getRequiredPriceLookupReminderMessage()]
        : nextPrompt;
  }

  if (mustGetReviewedPriceResult && !hasReviewedPriceResult) {
    throw new Error(
      'search_price_candidates was required before answering this Steel price request.',
    );
  }

  if (mustGetProvisionalWorkbookPatch && hasPositiveReviewedPriceCandidate && !hasWorkbookPatch) {
    throw new Error(
      'patch_workbook was required before answering this provisional Steel price request.',
    );
  }

  const result = generationResults[generationResults.length - 1];
  if (!result) {
    throw new Error('OpenAI OAuth provider did not return a Steel chat result.');
  }

  const workbookPatch = getWorkbookPatchFromOperations(workbookPatchOperations);

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
