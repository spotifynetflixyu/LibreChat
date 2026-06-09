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
  type SteelWorkbookSheetId,
} from 'librechat-data-provider';
import { createSteelPostgresPool } from '../postgres';
import { searchSteelAgentRules, type SteelAgentRule } from '../repositories';
import {
  createSteelToolRunState,
  executeSteelTool,
  type SteelToolRunState,
} from '../tools/execute';
import { getSteelToolDefinitions, isSteelToolName } from '../tools/registry';
import type { SteelToolResult } from '../tools/results';
import type { SteelToolName } from '../tools/schemas';
import {
  buildSemanticWorkbookPatchOperations,
  steelSemanticWorkbookPatchSchema,
  type SteelSemanticWorkbookPatch,
} from '../workbook/semantic';
import {
  getFirstWorkbookSubtotalMismatch,
  type WorkbookSubtotalMismatch,
} from '../workbook/subtotals';
import type { SteelRepositoryClient } from '../repositories';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('openai-oauth-provider')>;

type CreateOpenAIOAuth = typeof createOpenAIOAuthType;
type SteelBusinessToolCall = LanguageModelV3ToolCall & { toolName: SteelToolName };
type SemanticWorkbookPatchToolCall = LanguageModelV3ToolCall & {
  toolName: 'patch_quote_workbook';
};
type WorkbookPatchToolCall = SemanticWorkbookPatchToolCall;
type SteelRoundTool = LanguageModelV3FunctionTool;
type WorkbookPatchOperation = SteelProviderWorkbookPatchProposal['operations'][number];
type WorkbookPatchMissingCell = {
  sheetId: SteelWorkbookSheetId;
  columnKey: string;
};
type WorkbookPatchCompletion = {
  required: boolean;
  missingSheetIds: readonly SteelWorkbookSheetId[];
  missingCells: readonly WorkbookPatchMissingCell[];
};
const workbookPatchCompletionColumnKeysBySheet: Record<SteelWorkbookSheetId, readonly string[]> = {
  system_order: ['item_spec', 'unit_price'],
  quote_details: ['material_unit_price', 'subtotal'],
  summary: ['value'],
  manual_review: ['confirmation_needed'],
  price_sources: ['adopted_product_price_item'],
  interpretation_notes: ['content'],
  customer_quote: ['item_spec', 'unit_price', 'subtotal'],
};

const catalogFamilyPriceLookupInstruction =
  'When calling search_price_candidates after selecting a catalog family, use catalogFamilies with the selected catalog key and do not send oral family/category labels as productNames. When no reliable catalog key is available after lookup_catalog_families, use productNames with one or more AI-derived reviewed product/source-name candidates; do not pass the raw full user text, and mark the result as provisional/low confidence when appropriate. For multiple inferred reviewed product-name candidates, use productNames or candidateQueries; use candidateQueries when each candidate needs its own confidence/reason, and put candidate product-name lists in candidateQueries.productNames. Example: for C 型鋼/c_type, use catalogFamilies [c_type] with compact price-table specKeyContains 100x2.3 derived from C100x50x20x2.3t; do not use productNames [C型鋼]. If C 型鋼 material is unspecified, productNames [錏輕型鋼] is the preferred provisional reviewed product-name candidate; also query or surface bounded alternatives such as 白鐵輕型鋼 and 黑鐵輕型鋼 when returned.';

const defaultCustomerTierId = 2;
const defaultCustomerTierCode = 'B';

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
  onReasoningSummary?: (summary: string) => void;
  passThroughUnsupportedFiles?: boolean;
  reasoningEffort: SteelOpenAIReasoningEffort;
  steelToolMaxCalls?: number;
  steelRuntimePolicy?: boolean;
  agentRulesClient?: SteelRepositoryClient;
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

const steelAgentRuleSections = [
  'agent_instruction',
  'tool_flow',
  'inference_order',
  'confirmation_policy',
] as const;
const steelWorkbookRuleTypes = ['workbook_output_rule'] as const;
const steelOcrRuleSections = ['file_ocr', 'drawing_ocr', 'vision_evidence'] as const;
const steelOcrRuleTypes = ['inference_order_rule', 'tool_flow_rule', 'output_policy_rule'] as const;

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

function getVisualEvidenceSourceKinds(messages: readonly SteelOAuthChatMessage[]) {
  const sourceKinds = new Set<VisualEvidenceSourceKind>();

  for (const message of messages) {
    for (const file of message.files ?? []) {
      for (const sourceKind of getFileSourceKinds(file)) {
        sourceKinds.add(sourceKind);
      }
    }
  }

  return [...sourceKinds];
}

function readSelectorStrings(rule: SteelAgentRule, key: string): string[] {
  const selectors = rule.selectors;

  if (typeof selectors !== 'object' || selectors === null || Array.isArray(selectors)) {
    return [];
  }

  const value = selectors[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function matchesOcrSourceKind(rule: SteelAgentRule, sourceKinds: readonly string[]) {
  const selectorSourceKinds = readSelectorStrings(rule, 'sourceKinds');

  if (selectorSourceKinds.length === 0) {
    return true;
  }

  return selectorSourceKinds.some((sourceKind) => sourceKinds.includes(sourceKind));
}

function formatOcrRuleInstruction(rule: SteelAgentRule) {
  const source = rule.sourceRefs[0];
  const provenance = [
    source?.sourceFile ? `sourceFile=${source.sourceFile}` : undefined,
    source?.locator ? `locator=${source.locator}` : undefined,
    source?.canonicalKey ? `canonicalKey=${source.canonicalKey}` : undefined,
    source?.sha256 ? `sha256=${source.sha256}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  return provenance
    ? `${rule.prompt.trim()}\nOCR rule provenance: ${provenance}`
    : rule.prompt.trim();
}

async function getSteelRuntimePolicyInstruction(client: SteelRepositoryClient): Promise<string> {
  const rules = await searchSteelAgentRules(client, {
    ruleSections: steelAgentRuleSections,
    limit: 20,
  });
  const prompts = rules.map((rule) => rule.prompt.trim()).filter(Boolean);

  if (prompts.length === 0) {
    throw new Error('steel.agent_rules did not return reviewed Agent Prompt rules.');
  }

  return prompts.join('\n\n');
}

async function getSteelWorkbookOutputInstruction(
  client: SteelRepositoryClient,
  workbookContextText?: string,
): Promise<string> {
  const rules = await searchSteelAgentRules(client, {
    ruleTypes: steelWorkbookRuleTypes,
    limit: 20,
  });
  const prompts = rules.map((rule) => rule.prompt.trim()).filter(Boolean);

  if (prompts.length === 0) {
    throw new Error('steel.agent_rules did not return reviewed workbook output rules.');
  }

  const instruction = prompts.join('\n\n');

  return workbookContextText
    ? `${instruction}\n\nWorkbook structure context:\n${workbookContextText}`
    : instruction;
}

async function getSteelOcrInstruction(
  client: SteelRepositoryClient,
  sourceKinds: readonly VisualEvidenceSourceKind[],
): Promise<string> {
  const rules = await searchSteelAgentRules(client, {
    ruleTypes: steelOcrRuleTypes,
    ruleSections: steelOcrRuleSections,
    limit: 20,
  });
  const prompts = rules
    .filter((rule) => matchesOcrSourceKind(rule, sourceKinds))
    .map(formatOcrRuleInstruction)
    .filter(Boolean);

  if (prompts.length === 0) {
    throw new Error('steel.agent_rules did not return reviewed OCR rules.');
  }

  return prompts.join('\n\n');
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

async function getSystemInstruction({
  agentRulesClient,
  steelRuntimePolicy,
  workbookContextText,
  workbookPatchTool,
  ocrSourceKinds,
}: {
  agentRulesClient?: SteelRepositoryClient;
  steelRuntimePolicy?: boolean;
  workbookContextText?: string;
  workbookPatchTool?: boolean;
  ocrSourceKinds?: readonly VisualEvidenceSourceKind[];
}): Promise<string | undefined> {
  const hasOcrRules = (ocrSourceKinds?.length ?? 0) > 0;

  if ((steelRuntimePolicy || workbookPatchTool || hasOcrRules) && !agentRulesClient) {
    throw new Error('steel.agent_rules client is required for Steel runtime rules.');
  }

  const instructions = [
    ...(steelRuntimePolicy && agentRulesClient
      ? [await getSteelRuntimePolicyInstruction(agentRulesClient)]
      : []),
    ...(hasOcrRules && agentRulesClient
      ? [await getSteelOcrInstruction(agentRulesClient, ocrSourceKinds ?? [])]
      : []),
    ...(workbookPatchTool && agentRulesClient
      ? [await getSteelWorkbookOutputInstruction(agentRulesClient, workbookContextText)]
      : []),
  ];

  return instructions.length > 0 ? instructions.join('\n\n') : undefined;
}

const semanticWorkbookPatchFunctionTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'patch_quote_workbook',
  description:
    'Propose a compact semantic Steel quote workbook update. Use this for quote/order results; backend projects the semantic quote data into validated workbook cell updates across all relevant sheets.',
  inputSchema: zodToJsonSchema(steelSemanticWorkbookPatchSchema, {
    $refStrategy: 'none',
  }) as LanguageModelV3FunctionTool['inputSchema'],
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
      'lookup_quote_rules is required before category-dependent Steel lookups. When AI has selected a catalog/category key from oral order evidence, first call lookup_quote_rules with the interpreted order context, then call search_price_candidates.',
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

function isCategoryDependentLookup(call: SteelBusinessToolCall, input: unknown): boolean {
  switch (call.toolName) {
    case 'search_price_candidates':
      return getStringArrayProperty(input, 'catalogFamilies').length > 0;
    default:
      return false;
  }
}

function hasUnknownCustomerTierContext(input: unknown): boolean {
  if (!isJsonObject(input)) {
    return false;
  }

  const customerContext = input.customerContext;
  return isJsonObject(customerContext) && customerContext.tierKnown === false;
}

function getKnownCustomerTierIdFromContext(input: unknown): number | undefined {
  if (!isJsonObject(input)) {
    return undefined;
  }

  const customerContext = input.customerContext;
  if (!isJsonObject(customerContext) || customerContext.tierKnown !== true) {
    return undefined;
  }

  return typeof customerContext.customerTierId === 'number'
    ? customerContext.customerTierId
    : undefined;
}

function getSingleCustomerSearchTierId(result: SteelToolResult): number | undefined {
  if (!result.ok || !Array.isArray(result.data.customers)) {
    return undefined;
  }

  const tierIds = new Set<number>();
  for (const customer of result.data.customers) {
    if (!isJsonObject(customer) || !isJsonObject(customer.customerTier)) {
      continue;
    }

    const tierId = customer.customerTier.id;
    if (typeof tierId === 'number') {
      tierIds.add(tierId);
    }
  }

  return tierIds.size === 1 ? [...tierIds][0] : undefined;
}

function withDefaultCustomerTierFilter({
  forceDefaultCustomerTier,
  input,
  selectedCustomerTierId,
}: {
  forceDefaultCustomerTier: boolean;
  input: unknown;
  selectedCustomerTierId?: number;
}): unknown {
  if (!isJsonObject(input)) {
    return input;
  }

  if (!forceDefaultCustomerTier && typeof input.customerTierId === 'number') {
    return input;
  }

  if (!forceDefaultCustomerTier && selectedCustomerTierId !== undefined) {
    return {
      ...input,
      customerTierId: selectedCustomerTierId,
    };
  }

  return {
    ...input,
    customerTierId: defaultCustomerTierId,
  };
}

interface ExecutedSteelToolCall {
  call: SteelBusinessToolCall;
  input: unknown;
  result: SteelToolResult;
}

interface ParsedWorkbookPatchToolCall {
  call: WorkbookPatchToolCall;
  input: SteelSemanticWorkbookPatch;
  patchProposal: SteelProviderWorkbookPatchProposal;
  projectedFromSemantic: boolean;
}

async function executeSteelBusinessToolCalls({
  calls,
  executeSteelToolCall,
  forceDefaultCustomerTier,
  hasInstructionLookupResult,
  runState,
  selectedCustomerTierId,
}: {
  calls: SteelBusinessToolCall[];
  executeSteelToolCall: SteelProviderToolExecutor;
  forceDefaultCustomerTier: boolean;
  hasInstructionLookupResult: boolean;
  runState: SteelToolRunState;
  selectedCustomerTierId?: number;
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
      call.toolName === 'search_price_candidates'
        ? withDefaultCustomerTierFilter({
            forceDefaultCustomerTier,
            input,
            selectedCustomerTierId,
          })
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

    if (isFatalSteelToolResult(result)) {
      executedCalls.push({
        call,
        input: executionInput,
        result,
      });
      throw new Error(getFatalSteelToolErrorMessage(call, result));
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

function getMissingProvisionalWorkbookPatchSheetIds(
  operations: readonly WorkbookPatchOperation[],
): SteelWorkbookSheetId[] {
  const touchedSheetIds = new Set(operations.map((operation) => operation.sheetId));
  return requiredSteelWorkbookSheetIds.filter((sheetId) => !touchedSheetIds.has(sheetId));
}

function isMeaningfulWorkbookPatchValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  return typeof value !== 'string' || value.trim().length > 0;
}

function getPatchedWorkbookColumnKeysBySheet(
  operations: readonly WorkbookPatchOperation[],
): Map<SteelWorkbookSheetId, Set<string>> {
  const columnKeysBySheet = new Map<SteelWorkbookSheetId, Set<string>>();
  for (const operation of operations) {
    if (!isMeaningfulWorkbookPatchValue(operation.value)) {
      continue;
    }

    const columnKeys = columnKeysBySheet.get(operation.sheetId) ?? new Set<string>();
    columnKeys.add(operation.columnKey);
    columnKeysBySheet.set(operation.sheetId, columnKeys);
  }

  return columnKeysBySheet;
}

function getMissingWorkbookPatchCells(
  operations: readonly WorkbookPatchOperation[],
): WorkbookPatchMissingCell[] {
  const columnKeysBySheet = getPatchedWorkbookColumnKeysBySheet(operations);
  return requiredSteelWorkbookSheetIds.flatMap((sheetId) => {
    const patchedColumnKeys = columnKeysBySheet.get(sheetId);
    return workbookPatchCompletionColumnKeysBySheet[sheetId]
      .filter((columnKey) => !patchedColumnKeys?.has(columnKey))
      .map((columnKey) => ({ sheetId, columnKey }));
  });
}

function getWorkbookPatchCompletion(
  operations: readonly WorkbookPatchOperation[],
): WorkbookPatchCompletion {
  return {
    required: true,
    missingSheetIds: getMissingProvisionalWorkbookPatchSheetIds(operations),
    missingCells: getMissingWorkbookPatchCells(operations),
  };
}

function isWorkbookPatchCompletionComplete(completion?: WorkbookPatchCompletion): boolean {
  return (
    completion === undefined ||
    (completion.missingSheetIds.length === 0 && completion.missingCells.length === 0)
  );
}

function toWorkbookPatchToolResultValue(
  parsedCall: ParsedWorkbookPatchToolCall,
  completion?: WorkbookPatchCompletion,
  {
    subtotalMismatch,
  }: {
    subtotalMismatch?: WorkbookSubtotalMismatch;
  } = {},
): JSONValue {
  const operationCount = parsedCall.patchProposal.operations.length;
  const projectedFields = parsedCall.projectedFromSemantic
    ? { projectedOperationCount: operationCount }
    : {};
  if (subtotalMismatch) {
    const instruction = subtotalMismatch.unknownSubtotalLineRefs
      ? 'Workbook summary.totalAmount cannot be numeric while any line subtotal is unknown. Call patch_quote_workbook again with summary.totalAmount set to 未確認 or provide reviewed/user-confirmed line subtotals before answering.'
      : 'Workbook summary.totalAmount must equal the sum of line subtotal values. Call patch_quote_workbook again with corrected summary.totalAmount before answering.';

    return toJsonValue({
      ok: true,
      toolName: parsedCall.call.toolName,
      operationCount,
      ...projectedFields,
      complete: false,
      subtotalMismatch,
      instruction,
    });
  }

  if (completion?.required && !isWorkbookPatchCompletionComplete(completion)) {
    return toJsonValue({
      ok: true,
      toolName: parsedCall.call.toolName,
      operationCount,
      ...projectedFields,
      complete: false,
      missingSheetIds: completion.missingSheetIds,
      missingCells: completion.missingCells,
      instruction:
        'Semantic workbook patch projected but incomplete for this Steel quote update. Call patch_quote_workbook again with the same lineId and any derivable missing semantic fields. Include top-level customerQuoteTotal when customer_quote has a customer-facing total row. Do not hand-write workbook cell operations. If a value cannot be derived, leave that target cell blank and record the missing material/customer/source/calculation evidence in manual_review or interpretation_notes. Do not answer the user until the workbook patch is complete enough for this turn.',
    });
  }

  return toJsonValue({
    ok: true,
    toolName: parsedCall.call.toolName,
    operationCount,
    ...projectedFields,
    ...(completion?.required ? { complete: true, missingSheetIds: [], missingCells: [] } : {}),
    instruction:
      'Semantic workbook patch captured for backend validation and application. Now answer the user in Traditional Chinese with only the interpreted order information, new 小計 amount when updated, and key workbook changes. Do not list a per-field diff or long search/candidate fields. Do not answer only with a field count such as 已更新 workbook：N 個欄位. Do not call patch_quote_workbook again unless another workbook update is needed.',
  });
}

function toToolResultMessage(
  executedCalls: ExecutedSteelToolCall[],
  workbookPatchCalls: ParsedWorkbookPatchToolCall[] = [],
  workbookPatchCompletion?: WorkbookPatchCompletion,
  options: {
    subtotalMismatch?: WorkbookSubtotalMismatch;
  } = {},
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
      ...workbookPatchCalls.map((parsedCall) => ({
        type: 'tool-result' as const,
        toolCallId: parsedCall.call.toolCallId,
        toolName: parsedCall.call.toolName,
        output: {
          type: 'json' as const,
          value: toWorkbookPatchToolResultValue(parsedCall, workbookPatchCompletion, options),
        },
      })),
    ],
  };
}

function getRequiredPriceLookupReminderMessage(): LanguageModelV3Message {
  return {
    role: 'system',
    content: `This Steel price request still requires reviewed lookup. For oral material/category wording, call lookup_catalog_families first to retrieve reviewed catalog key candidates. If the user provided a customer name, call search_customers in the initial lookup round when available, then pass the selected customer context to lookup_quote_rules. If you have selected a catalog/category key and lookup_quote_rules has not completed for this interpreted order context, call lookup_quote_rules first; otherwise call search_price_candidates with AI-derived candidate queries before answering. ${catalogFamilyPriceLookupInstruction} When the user did not provide a customer or customer tier is unknown/not found, use default price ${defaultCustomerTierCode} by passing customerTierId ${defaultCustomerTierId}; keep the notice short, for example 目前用 價格B：26.8 元/kg, and say separately that a customer name can be used to look up that customer's quote price. Do not add highest/most-expensive wording.`,
  };
}

function getProvisionalWorkbookPatchReminderMessage(
  missingSheetIds: readonly SteelWorkbookSheetId[] = requiredSteelWorkbookSheetIds,
  missingCells: readonly WorkbookPatchMissingCell[] = [],
): LanguageModelV3Message {
  const missingSheetText =
    missingSheetIds.length > 0 ? ` Missing sheets: ${missingSheetIds.join(', ')}.` : '';
  const missingCellText =
    missingCells.length > 0
      ? ` Missing cells: ${missingCells
          .map(({ sheetId, columnKey }) => `${sheetId}.${columnKey}`)
          .join(', ')}.`
      : '';

  return {
    role: 'system',
    content: `This Steel quote update still requires a complete-enough semantic workbook patch for this turn.${missingSheetText}${missingCellText} Call patch_quote_workbook to update all user-relevant sheets when values are available: system_order, quote_details, summary, manual_review, price_sources, interpretation_notes, and customer_quote. Do not hand-write workbook cell operations; backend projection owns cell operation generation. Fill semantic fields when derivable from user text, workbook context, reviewed tool results, or calculation_results. Use calculation_results before interpreted quote items when both exist. Leave missing semantic values blank when material, customer, source, or calculation context is unavailable, and record the missing context in manual_review or interpretation_notes instead of inventing values. 未確認單價或金額不可填 0; write 未確認 instead. Include provisional candidate/source/confidence notes and the quote_details \`小計\` column (internal key subtotal) when a quote amount is calculable. Do not add or use a separate visible \`報價\` column. Summary/customer_quote totals must be labeled as 暫估/待確認 until the user confirms the selected item, thickness, length, customer, and tier. When customer_quote has a customer-facing total, provide top-level customerQuoteTotal with itemSpec 報價總額, blank quantity/unit/unitPrice, and customer-facing total in subtotal. 給客戶用 must not expose customer tier, source refs, search keywords, candidates, AI/internal notes, cost, or margin. After the patch result, summarize only the interpreted order information, new 小計 amount when updated, and key workbook changes; do not list a per-field diff or answer only with a field count.`,
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

function isWorkbookPatchToolCall(
  part: LanguageModelV3GenerateResult['content'][number],
): part is WorkbookPatchToolCall {
  return part.type === 'tool-call' && part.toolName === 'patch_quote_workbook';
}

function getWorkbookPatchToolCalls(result: LanguageModelV3GenerateResult): WorkbookPatchToolCall[] {
  return result.content.filter(isWorkbookPatchToolCall);
}

function parseWorkbookPatchToolCalls(
  calls: WorkbookPatchToolCall[],
): ParsedWorkbookPatchToolCall[] {
  return calls.map((call) => {
    const input = JSON.parse(call.input);
    const semanticPatch = steelSemanticWorkbookPatchSchema.parse(input);
    const patchProposal = steelProviderWorkbookPatchProposalSchema.parse({
      operations: buildSemanticWorkbookPatchOperations(semanticPatch),
    });

    return {
      call,
      input: semanticPatch,
      patchProposal,
      projectedFromSemantic: true,
    };
  });
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
  agentRulesClient,
  authFilePath,
  createOpenAIOAuth: injectedCreateOpenAIOAuth,
  ensureFresh = true,
  executeSteelToolCall = executeDefaultSteelToolCall,
  fetch,
  maxOutputTokens,
  messages,
  model,
  onReasoningSummary,
  passThroughUnsupportedFiles,
  reasoningEffort,
  steelToolMaxCalls = 8,
  steelRuntimePolicy,
  workbookContextText,
  workbookPatchTool,
}: SendSteelOAuthChatOptions): Promise<SteelProviderChatResponse> {
  const ocrSourceKinds = steelRuntimePolicy === true ? getVisualEvidenceSourceKinds(messages) : [];
  const shouldLoadAgentRules =
    steelRuntimePolicy === true || workbookPatchTool === true || ocrSourceKinds.length > 0;
  const systemInstruction = await getSystemInstruction({
    agentRulesClient: shouldLoadAgentRules
      ? (agentRulesClient ?? getDefaultSteelToolClient())
      : undefined,
    steelRuntimePolicy,
    workbookContextText,
    workbookPatchTool,
    ocrSourceKinds,
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
    ...(workbookPatchTool ? [semanticWorkbookPatchFunctionTool] : []),
  ] satisfies SteelRoundTool[];
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
  let forceDefaultCustomerTier = true;
  let selectedCustomerTierId: number | undefined;
  let hasWorkbookPatch = false;
  const workbookPatchOperations: WorkbookPatchOperation[] = [];

  for (let round = 0; round <= steelToolMaxCalls; round += 1) {
    const toolChoice = getSteelToolChoice({
      hasReviewedPriceResult,
      mustGetReviewedPriceResult,
    });
    const result = await openai(model).doGenerate({
      abortSignal,
      prompt,
      maxOutputTokens,
      ...(tools.length > 0
        ? {
            tools,
            toolChoice,
          }
        : {}),
      providerOptions: {
        openai: {
          passThroughUnsupportedFiles,
          reasoningEffort,
          ...(onReasoningSummary ? { reasoningSummary: 'auto' as const } : {}),
        },
      },
    });

    generationResults.push(result);
    for (const summary of getReasoningSummaries(result)) {
      onReasoningSummary?.(summary);
    }
    const workbookPatchCalls = workbookPatchTool ? getWorkbookPatchToolCalls(result) : [];
    const parsedWorkbookPatchCalls = parseWorkbookPatchToolCalls(workbookPatchCalls);
    const workbookSubtotalMismatch = getFirstWorkbookSubtotalMismatch(
      parsedWorkbookPatchCalls.map(({ input }) => input),
    );
    const acceptedWorkbookPatchCalls = workbookSubtotalMismatch ? [] : parsedWorkbookPatchCalls;
    workbookPatchOperations.push(
      ...acceptedWorkbookPatchCalls.flatMap(({ patchProposal }) => patchProposal.operations),
    );
    hasWorkbookPatch = workbookPatchOperations.length > 0;
    const requiresWorkbookPatchCompletion =
      (mustGetProvisionalWorkbookPatch && hasPositiveReviewedPriceCandidate) ||
      (steelRuntimePolicy === true && hasWorkbookPatch);
    const workbookPatchCompletion = requiresWorkbookPatchCompletion
      ? getWorkbookPatchCompletion(workbookPatchOperations)
      : undefined;
    const hasCompleteWorkbookPatch =
      workbookPatchCompletion === undefined ||
      (hasWorkbookPatch && isWorkbookPatchCompletionComplete(workbookPatchCompletion));

    const steelBusinessToolCalls = steelRuntimePolicy ? getSteelBusinessToolCalls(result) : [];
    if (steelBusinessToolCalls.length === 0) {
      if (mustGetReviewedPriceResult && !hasReviewedPriceResult) {
        prompt = [...prompt, getRequiredPriceLookupReminderMessage()];
        continue;
      }

      if (workbookSubtotalMismatch && parsedWorkbookPatchCalls.length > 0) {
        prompt = [
          ...prompt,
          toAssistantToolCallMessage([], parsedWorkbookPatchCalls),
          toToolResultMessage([], parsedWorkbookPatchCalls, workbookPatchCompletion, {
            subtotalMismatch: workbookSubtotalMismatch,
          }),
        ];
        continue;
      }

      if (parsedWorkbookPatchCalls.length > 0 && requiresWorkbookPatchCompletion) {
        prompt = [
          ...prompt,
          toAssistantToolCallMessage([], parsedWorkbookPatchCalls),
          toToolResultMessage([], parsedWorkbookPatchCalls, workbookPatchCompletion),
        ];
        continue;
      }

      if (requiresWorkbookPatchCompletion && !hasCompleteWorkbookPatch) {
        prompt = [
          ...prompt,
          getProvisionalWorkbookPatchReminderMessage(
            workbookPatchCompletion?.missingSheetIds,
            workbookPatchCompletion?.missingCells,
          ),
        ];
        continue;
      }

      break;
    }

    const executedCalls = await executeSteelBusinessToolCalls({
      calls: steelBusinessToolCalls,
      executeSteelToolCall,
      forceDefaultCustomerTier,
      hasInstructionLookupResult,
      runState,
      selectedCustomerTierId,
    });
    if (
      executedCalls.some(
        ({ call, result: toolResult }) => call.toolName === 'lookup_quote_rules' && toolResult.ok,
      )
    ) {
      hasInstructionLookupResult = true;
    }
    const customerTierContextCalls = executedCalls.filter(
      ({ call, result: toolResult }) => call.toolName === 'lookup_quote_rules' && toolResult.ok,
    );
    const knownCustomerTierId = customerTierContextCalls
      .map(({ input }) => getKnownCustomerTierIdFromContext(input))
      .find((tierId) => tierId !== undefined);
    const searchedCustomerTierId = executedCalls
      .filter(({ call }) => call.toolName === 'search_customers')
      .map(({ result: toolResult }) => getSingleCustomerSearchTierId(toolResult))
      .find((tierId) => tierId !== undefined);
    const nextSelectedCustomerTierId =
      knownCustomerTierId ?? searchedCustomerTierId ?? selectedCustomerTierId;
    if (nextSelectedCustomerTierId !== undefined) {
      selectedCustomerTierId = nextSelectedCustomerTierId;
      forceDefaultCustomerTier = false;
    } else if (customerTierContextCalls.some(({ input }) => hasUnknownCustomerTierContext(input))) {
      forceDefaultCustomerTier = true;
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
      toToolResultMessage(executedCalls, parsedWorkbookPatchCalls, workbookPatchCompletion, {
        subtotalMismatch: workbookSubtotalMismatch,
      }),
    ];
    if (mustGetReviewedPriceResult && !hasReviewedPriceResult) {
      prompt = [...nextPrompt, getRequiredPriceLookupReminderMessage()];
    } else if (workbookSubtotalMismatch) {
      prompt = nextPrompt;
    } else if (requiresWorkbookPatchCompletion && !hasCompleteWorkbookPatch) {
      prompt = [
        ...nextPrompt,
        getProvisionalWorkbookPatchReminderMessage(
          workbookPatchCompletion?.missingSheetIds,
          workbookPatchCompletion?.missingCells,
        ),
      ];
    } else {
      prompt = nextPrompt;
    }
  }

  if (mustGetReviewedPriceResult && !hasReviewedPriceResult) {
    throw new Error(
      'search_price_candidates was required before answering this Steel price request.',
    );
  }

  const finalWorkbookPatchCompletion =
    (mustGetProvisionalWorkbookPatch && hasPositiveReviewedPriceCandidate) ||
    (steelRuntimePolicy === true && hasWorkbookPatch)
      ? getWorkbookPatchCompletion(workbookPatchOperations)
      : undefined;
  if (
    ((mustGetProvisionalWorkbookPatch && hasPositiveReviewedPriceCandidate) ||
      (steelRuntimePolicy === true && hasWorkbookPatch)) &&
    (!hasWorkbookPatch || !isWorkbookPatchCompletionComplete(finalWorkbookPatchCompletion))
  ) {
    const missingSheetIds = finalWorkbookPatchCompletion?.missingSheetIds ?? [];
    const missingCells =
      finalWorkbookPatchCompletion?.missingCells
        .map(({ sheetId, columnKey }) => `${sheetId}.${columnKey}`)
        .join(', ') ?? '';
    throw new Error(
      `complete patch_quote_workbook was required before answering this Steel quote update. Missing sheets: ${missingSheetIds.join(', ')}. Missing cells: ${missingCells}`,
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
