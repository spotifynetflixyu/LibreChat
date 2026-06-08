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
type WorkbookSubtotalMismatch = {
  expectedTotal: number;
  mismatchedFields: readonly string[];
  actualTotals: Record<string, number>;
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
    'Interpret the user request, normalize ambiguous material/specification text, and choose among the AI-callable Steel tools: lookup_quote_rules, lookup_catalog_families, search_customers, search_price_candidates, lookup_formula, and workbook patch output.',
    'Generate material/specification candidates in reasoning; do not call a backend tool only to normalize raw wording or create search terms.',
    'Use reviewed backend tools for unit-weight, cutting, processing, material-rule, and formula-version source context; do not call separate low-level lookup tools for those details.',
    'Call backend tools when you need reviewed rows, scoped quote-default candidates, formula candidates, calculation source context, or validated workbook output.',
    'AI owns quote arithmetic on the fixed OAuth/Codex path. Backend validates structured inputs, searches reviewed source rows, applies bounded safety policy, projects workbook patches, and checks workbook summary totals against the sum of line subtotal values; backend does not perform deterministic quote pricing.',
    'For customer-facing quote numbers, ensure quote_details subtotal values and summary totalAmount/confirmedAmount are internally consistent. If a summary total is present, it must equal the sum of numeric line subtotal values before you answer.',
    'Do not treat raw customer text such as `亞L30x30` as a confirmed product-price key.',
    'For oral material/category price, formula, or rules requests, call lookup_catalog_families before lookup_quote_rules, search_price_candidates, or lookup_formula. Use it to retrieve reviewed vocabulary candidates, then choose catalogFamilies yourself or ask the user to confirm.',
    'Backend does not decide oral wording to catalog_family mappings; backend returns catalog vocabulary candidates and validates explicit keys selected by AI.',
    'Use canonical catalog family keys such as h_beam, c_type, and angle when calling lookup_quote_rules, search_price_candidates, or lookup_formula.',
    'lookup_quote_rules returns both reviewed instruction packets and reviewed quote defaults; include all detected materials/catalog keys in one catalogContexts array when the order has multiple items.',
    'If the user provided a customer name in the same quote request, call search_customers in the initial lookup round when available, then pass the selected customerId/customerTierId/customerName as customerContext to lookup_quote_rules before price lookup so customer-scoped defaults/rules can be returned.',
    'For oral orders, first call lookup_catalog_families with the raw material/category wording, then infer product/category candidates and choose the catalog key yourself. After choosing a catalog/category key, call lookup_quote_rules with the interpreted order context before category-dependent lookups such as search_price_candidates or lookup_formula. lookup_quote_rules is the merged rule/default lookup surface: lookup_quote_rules = lookup_instructions + lookup_defaults.',
    'First derive candidate material and specification fields, then generate candidate material and specification queries such as 錏角鐵 30x30, 錏成型角鐵 30x30, 鍍鋅角鐵 30x30, 角鐵 30x30, or L30x30 before searching reviewed price rows.',
    'For material price questions like `一支多少`, search reviewed price rows with derived candidates.',
    'If instruction packets provide processing price candidate names or ERP item codes, call search_price_candidates for the reviewed processing rows before quoting those processing charges; do not quote processing prices solely from instruction packet text.',
    '遇到鋼材價格問題時，未取得 search_price_candidates tool result 前，不可回答查不到、不可宣稱已查表、不可要求使用者先補長度/客戶/厚度/分級。',
    'Do not stop before reviewed price lookup merely because length, thickness, customer, or tier is missing when bounded derived price queries can still be formed.',
    'Ask for missing length, thickness, customer, or tier after reviewed lookup, not before, unless no bounded derived price query can be formed.',
    'When customer/tier is unknown, lookup_quote_rules may set customerContext.tierKnown=false, but must not invent customerId. Unknown customer context is represented by omitted customerId plus tierKnown=false.',
    'When the user did not provide a customer, or search_customers cannot find a usable customer price tier, use the default price B tier for any product family. Pass customerTierId 2 to search_price_candidates. In the response, keep the notice short, for example `目前用 價格B：26.8 元/kg`, and say separately that a customer name can be used to look up that customer quote price. Do not add highest/most-expensive wording to the B price notice.',
    'When search_customers returns a usable customerTier.id for the selected customer, pass that customerTierId to search_price_candidates instead of the default B tier.',
    'When presenting a user-facing price bullet in Traditional Chinese, label it `價格`, not `reviewed 價格`; keep reviewed/source status in the source or note text instead.',
    'For C 型鋼 / c_type with unspecified material or surface, AI may use productNames [錏輕型鋼] as the usual high-confidence provisional candidate list. The first reply must also show same-spec reviewed alternatives such as 白鐵輕型鋼 or 黑鐵輕型鋼 when returned. In follow-up turns, if the user does not specify another material/surface after those options were shown, treat the default 錏輕型鋼 assumption as confirmed for the continuing quote context.',
    catalogFamilyPriceLookupInstruction,
    'For product-price rows, interpret unitPrice together with unit, productPriceUnitWeight, and productPriceUnitWeightUnit. If unit = kg, unitPrice is a per-kg price; convert length/piece weight into kg before multiplying unitPrice. If unit = piece, unitPrice is already a per-piece/per-unit total.',
    'For product-price rows with productPriceUnitWeightUnit = kg_per_m and unit = kg, calculate provisional piece amount from kg_per_m * requested meters * unitPrice; do not answer as if unitPrice were per-piece.',
    'For concise quick-price replies, if you show the total piece weight calculation, do not list unit weight as a separate bullet. Prefer one line such as `6M 一支重量：4 × 6 = 24 kg`, then the B/customer unit price and quote amount.',
    'For product-price rows whose product name/spec contains a fixed length in meters and productPriceUnitWeightUnit = kg_per_piece with unit = kg, price a whole source piece as pieceWeightKg * unitPrice. If unit = piece, price the whole source piece by unitPrice. Offcut/remnant is charged by default unless the user explicitly says remnants are not charged.',
    'If product-price row metadata says sourceUnitWeightOrigin = product_name_parentheses, treat the parenthesized product-name number as reviewed weight evidence and mention it when explaining the source.',
    'Apply product-price unit-weight calculation only to steel/material stock catalog families such as h_beam including 輕量H, c_type, angle, channel, flat_bar, rail, pipe, plate, mesh, grating, and floor deck. Do not apply this steel material rule to non-material product/accessory rows such as springs, screws, locks, wheels, windows, resin panels, doors, gates, or tools unless a reviewed rule explicitly says so.',
    'When a positive productPriceUnitWeight comes from the reviewed unit-weight column, it has priority over product-name parentheses. Parentheses are fallback-only for missing or zero unit-weight columns.',
    'For fixed-length material rows with a positive ratio/sourceRatio and a piece-total unitPrice, do not reinterpret that unitPrice as per-kg merely because the parenthetical weight conflicts with the reviewed unit-weight column. Keep the unitPrice as a piece total and flag the weight conflict for confirmation.',
    'When any unit-weight source is missing or contradictory, use related same-series/same-spec reviewed material rows, different-length rows, or comparable material rows to derive proportional inferred evidence if possible, but label that value as inferred/low-confidence or confirmation-needed and do not silently overwrite reviewed source values.',
    'For quick price questions like `一支多少`, if reviewed lookup returns one or more positive approximate candidates, lead with the highest-confidence source-backed candidate as a provisional quote or estimate, then list the other plausible candidates/specs/options for the user to confirm.',
    'If reviewed facts are missing, zero-valued, ambiguous, or only approximate, present bounded options with source differences and ask the user to confirm before treating the result as final; no confirmed customer-facing total is allowed before confirmation.',
    'If reviewed lookup returns no positive source-backed price candidates, do not invent a quote; explain the attempted candidate queries and ask for the missing detail or a user-supplied price.',
    'When workbook context is available and a candidate price is usable only as a preview, write provisional workbook updates with confidence, source, option notes, and the provisional `小計` amount when calculable instead of confirmed customer-facing totals.',
  ].join(' ');
}

function getWorkbookPatchInstruction(workbookContextText?: string): string {
  const instruction = [
    'You can update the visible Steel workbook only by calling patch_quote_workbook.',
    'Use patch_quote_workbook for all workbook changes: send compact semantic customer, quoteLines, source, review, note, and summary data, and backend will project it into the workbook sheets.',
    'Do not hand-write workbook cell operations; backend projection owns cell operation generation.',
    'For quick Steel price estimates with reviewed positive candidate prices, write provisional workbook preview rows with patch_quote_workbook.',
    'When changing one quote value such as customer, tier, quantity, unit price, total weight, or subtotal, use patch_quote_workbook with the same lineId so related workbook cells are reprojected together across quote details, system order, summary, sources, review, notes, and customer quote.',
    'For provisional price previews, update every user-relevant workbook sheet when values are available: system_order, quote_details, summary, manual_review, price_sources, interpretation_notes, and customer_quote.',
    'Use system_order for ERP-style order fields, quote_details for calculation inputs and `小計`, summary for customer/tier/total preview, manual_review for confirmation risks, price_sources for reviewed source rows, interpretation_notes for concise reasoning notes, and customer_quote for provisional customer-facing line items.',
    'Keep patch_quote_workbook compact: one semantic quote line should carry the order, pricing, source, review, note, summary, and customer-facing values needed for this turn.',
    'Workbook fill contract follows docs/reference/訂單參考_轉檔.xlsx. 價格先於重量: material unit price and processing prices must come from reviewed backend tool results or an explicit user price; handbook/manual weights can support weight/spec evidence but cannot replace missing product prices.',
    'Do not invent customer tier, product price, unit weight, formula, material/spec, or processing facts. 未確認單價或金額不可填 0; write the string 未確認 for unknown visible values and create manual_review rows when required evidence is missing or ambiguous.',
    'Use calculation_results before resolved_quote_items when both are available. Treat those numbers as customer-facing only when line subtotal values and summary totals are internally consistent.',
    '系統訂單分頁材料列與加工列分開; create ERP rows with item numbers such as 10, 20, 30. For C 型鋼 defaults, write a material row only and put holes/cuts in notes unless reviewed rules or user input require separate processing rows.',
    'For 系統訂單.`型號`, fill semantic `systemOrder.modelCode` from the adopted product-price row `型號` returned by search_price_candidates, such as CCG10023. Do not copy oral product names or catalog family keys into 系統訂單.`型號`.',
    '報價明細 小計 equals material fee plus cutting, hole, slotting, bending, and other fees. If any required unit price is 未確認, subtotal must be 未確認. Include search keywords, candidate summary, adopted product price item, exact-match status, differences, confidence, review notes, and stock/remnant fields when derivable.',
    '總結 must include derivable rows for 客戶暫採, 客戶編號暫採, 分級暫採, 送貨地址, 聯繫人, 報價總額, 確定金額, 低信心暫估金額, 未確認項目數, 低信心項目數, 總重量kg, and processing totals. Do not mix 確定金額 with 低信心暫估金額.',
    '價格來源 needs one source row for each material or processing quote line. If no price is found, set adopted price item to 未確認 and source to 未找到 or the actual searched source.',
    '判讀備註 should record customer tier judgment, product price search strategy, oral name conversion, weight source, stock allocation rule, the no-zero unknown rule, OCR/drawing assumptions, and any approximate or substitute candidate use.',
    '給客戶用 is customer-visible only: 不得出現客戶分級, 價格來源, 搜尋關鍵字, 候選品項, 未採用原因, AI判斷, source refs, internal cost, margin, or low-confidence internal reasons. Unknown unit price or subtotal must be 未確認.',
    'Fill blank workbook cells when the value can be derived from user text, workbook context, reviewed tool results, or quote calculation results.',
    'Leave a blank cell unchanged when material, customer, source, or calculation context is unavailable, and record the missing context in manual_review or interpretation_notes instead of inventing a value.',
    'In quote_details, update the `小計` column using internal key `subtotal` when a reviewed candidate and calculable amount exist. Do not add or use a separate visible `報價` column.',
    'Summary and customer_quote totals may be written only as provisional `暫估/待確認` preview values before the user confirms the selected item, thickness, length, customer, and tier; do not label them as confirmed final totals.',
    'Use workbook structure context to resolve visible sheet, row, and column labels into internal sheetId, rowId, and columnKey values.',
    'If workbook context has columns but no rows yet, create first-row ids yourself with stable names: quote_details line_1, price_sources source_1, interpretation_notes note_1, manual_review review_1, system_order order_1, summary summary_1, and customer_quote customer_1.',
    'Do not ask the user for internal workbook ids or keys when the target can be resolved from context.',
    'If the target sheet, row, column, or value is still ambiguous after checking context, ask a short clarification instead of calling the tool.',
    'Do not write confirmed totals before the user confirms the selected item, thickness, length, customer, and tier.',
    'Do not only describe a workbook update when the update should be applied.',
    'After patch_quote_workbook succeeds, answer with a concise Traditional Chinese summary of the interpreted order information and key workbook changes. Do not list a per-field diff. Do not answer only with a field count such as `已更新 workbook：16 個欄位`.',
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
      'lookup_quote_rules is required before category-dependent Steel lookups. When AI has selected a catalog/category key from oral order evidence, first call lookup_quote_rules with the interpreted order context, then call search_price_candidates or lookup_formula.',
    durationMs: 0,
    redactionVersion: 1,
  };
}

function createRequiredFormulaLookupReminderMessage(): LanguageModelV3Message {
  return {
    role: 'system',
    content:
      'The reviewed quote rules for this Steel material require lookup_formula before the final answer. Call lookup_formula with the selected catalogContexts and formulaCandidates from lookup_quote_rules, then use the reviewed formula rows together with the price candidates for the quote calculation.',
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
    case 'lookup_formula':
      return hasCatalogContext(input);
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

function getRequiredLookupsFromResult(result: SteelToolResult): SteelToolName[] {
  if (!result.ok) {
    return [];
  }

  const directRequiredLookups = result.data.requiredLookups;
  const packetRequiredLookups = result.data.instructionPackets;
  const lookupNames = [
    ...(Array.isArray(directRequiredLookups) ? directRequiredLookups : []),
    ...(Array.isArray(packetRequiredLookups)
      ? packetRequiredLookups.flatMap((packet) => {
          if (!isJsonObject(packet) || !Array.isArray(packet.requiredLookups)) {
            return [];
          }

          return packet.requiredLookups;
        })
      : []),
  ];

  return lookupNames.filter(
    (lookupName): lookupName is SteelToolName =>
      typeof lookupName === 'string' && isSteelToolName(lookupName),
  );
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
    return toJsonValue({
      ok: true,
      toolName: parsedCall.call.toolName,
      operationCount,
      ...projectedFields,
      complete: false,
      subtotalMismatch,
      instruction:
        'Workbook summary totals must equal the sum of line subtotal values. Call patch_quote_workbook again with corrected summary.totalAmount and summary.confirmedAmount values before answering.',
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
        'Semantic workbook patch projected but incomplete for this Steel quote update. Call patch_quote_workbook again with the same lineId and any derivable missing semantic fields. Do not hand-write workbook cell operations. If a value cannot be derived, leave that target cell blank and record the missing material/customer/source/calculation evidence in manual_review or interpretation_notes. Do not answer the user until the workbook patch is complete enough for this turn.',
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
    content: `This Steel quote update still requires a complete-enough semantic workbook patch for this turn.${missingSheetText}${missingCellText} Call patch_quote_workbook to update all user-relevant sheets when values are available: system_order, quote_details, summary, manual_review, price_sources, interpretation_notes, and customer_quote. Do not hand-write workbook cell operations; backend projection owns cell operation generation. Fill semantic fields when derivable from user text, workbook context, reviewed tool results, or calculation_results. Use calculation_results before interpreted quote items when both exist. Leave missing semantic values blank when material, customer, source, or calculation context is unavailable, and record the missing context in manual_review or interpretation_notes instead of inventing values. 未確認單價或金額不可填 0; write 未確認 instead. Include provisional candidate/source/confidence notes and the quote_details \`小計\` column (internal key subtotal) when a quote amount is calculable. Do not add or use a separate visible \`報價\` column. Summary/customer_quote totals must be labeled as 暫估/待確認 until the user confirms the selected item, thickness, length, customer, and tier. 給客戶用 must not expose customer tier, source refs, search keywords, candidates, AI/internal notes, cost, or margin. After the patch result, summarize only the interpreted order information, new 小計 amount when updated, and key workbook changes; do not list a per-field diff or answer only with a field count.`,
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

function toRoundedWorkbookAmount(value: number): number {
  return Number(value.toFixed(2));
}

function getNumericWorkbookAmount(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? toRoundedWorkbookAmount(value) : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.includes('未確認')) {
    return undefined;
  }

  const numericText = normalized.replaceAll(',', '');
  if (!/^-?\d+(?:\.\d+)?$/.test(numericText)) {
    return undefined;
  }

  const amount = Number(numericText);
  return Number.isFinite(amount) ? toRoundedWorkbookAmount(amount) : undefined;
}

function getWorkbookSubtotalTotal(input: SteelSemanticWorkbookPatch): number | undefined {
  if (input.quoteLines.length === 0) {
    return undefined;
  }

  let total = 0;
  for (const line of input.quoteLines) {
    const subtotal = getNumericWorkbookAmount(line.subtotal);
    if (subtotal === undefined) {
      return undefined;
    }

    total += subtotal;
  }

  return toRoundedWorkbookAmount(total);
}

function getWorkbookSubtotalMismatch(
  input: SteelSemanticWorkbookPatch,
): WorkbookSubtotalMismatch | undefined {
  const expectedTotal = getWorkbookSubtotalTotal(input);
  if (expectedTotal === undefined) {
    return undefined;
  }

  const summaryTotals = [
    ['summary.totalAmount', getNumericWorkbookAmount(input.summary?.totalAmount)],
    ['summary.confirmedAmount', getNumericWorkbookAmount(input.summary?.confirmedAmount)],
  ] as const;
  const actualTotals: Record<string, number> = {};
  const mismatchedFields: string[] = [];

  for (const [field, actualTotal] of summaryTotals) {
    if (actualTotal === undefined || actualTotal === expectedTotal) {
      continue;
    }

    mismatchedFields.push(field);
    actualTotals[field] = actualTotal;
  }

  return mismatchedFields.length > 0
    ? {
        expectedTotal,
        mismatchedFields,
        actualTotals,
      }
    : undefined;
}

function getFirstWorkbookSubtotalMismatch(
  parsedCalls: readonly ParsedWorkbookPatchToolCall[],
): WorkbookSubtotalMismatch | undefined {
  for (const { input } of parsedCalls) {
    const mismatch = getWorkbookSubtotalMismatch(input);
    if (mismatch !== undefined) {
      return mismatch;
    }
  }

  return undefined;
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
  hasRequiredFormulaResult,
  hasReviewedPriceResult,
  mustGetRequiredFormulaResult,
  mustGetReviewedPriceResult,
}: {
  hasRequiredFormulaResult: boolean;
  hasReviewedPriceResult: boolean;
  mustGetRequiredFormulaResult: boolean;
  mustGetReviewedPriceResult: boolean;
}): LanguageModelV3ToolChoice {
  if (
    (!mustGetReviewedPriceResult || hasReviewedPriceResult) &&
    (!mustGetRequiredFormulaResult || hasRequiredFormulaResult)
  ) {
    return { type: 'auto' };
  }

  return { type: 'required' };
}

function isFunctionToolWithName(tool: SteelRoundTool, name: string): boolean {
  return tool.type === 'function' && tool.name === name;
}

function getSteelToolsForRound({
  hasCatalogFamilyLookupResult,
  hasInstructionLookupResult,
  hasRequiredFormulaResult,
  hasReviewedPriceResult,
  mustGetRequiredFormulaResult,
  mustGetReviewedPriceResult,
  tools,
}: {
  hasCatalogFamilyLookupResult: boolean;
  hasInstructionLookupResult: boolean;
  hasRequiredFormulaResult: boolean;
  hasReviewedPriceResult: boolean;
  mustGetRequiredFormulaResult: boolean;
  mustGetReviewedPriceResult: boolean;
  tools: SteelRoundTool[];
}): SteelRoundTool[] {
  if (mustGetReviewedPriceResult && !hasCatalogFamilyLookupResult && !hasInstructionLookupResult) {
    return tools.filter(
      (tool) =>
        isFunctionToolWithName(tool, 'lookup_catalog_families') ||
        isFunctionToolWithName(tool, 'search_customers'),
    );
  }

  if (mustGetReviewedPriceResult && hasCatalogFamilyLookupResult && !hasInstructionLookupResult) {
    return tools.filter((tool) => isFunctionToolWithName(tool, 'lookup_quote_rules'));
  }

  if (mustGetReviewedPriceResult && hasInstructionLookupResult && !hasReviewedPriceResult) {
    return tools.filter((tool) => isFunctionToolWithName(tool, 'search_price_candidates'));
  }

  if (mustGetRequiredFormulaResult && !hasRequiredFormulaResult) {
    return tools.filter((tool) => isFunctionToolWithName(tool, 'lookup_formula'));
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
  onReasoningSummary,
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
  let hasCatalogFamilyLookupResult = false;
  let hasInstructionLookupResult = false;
  let hasRequiredFormulaResult = false;
  let hasPositiveReviewedPriceCandidate = false;
  const requiredSteelLookups = new Set<SteelToolName>();
  let forceDefaultCustomerTier = true;
  let selectedCustomerTierId: number | undefined;
  let hasWorkbookPatch = false;
  const workbookPatchOperations: WorkbookPatchOperation[] = [];

  for (let round = 0; round <= steelToolMaxCalls; round += 1) {
    const mustGetRequiredFormulaResult = requiredSteelLookups.has('lookup_formula');
    const toolChoice = getSteelToolChoice({
      hasRequiredFormulaResult,
      hasReviewedPriceResult,
      mustGetRequiredFormulaResult,
      mustGetReviewedPriceResult,
    });
    const roundTools = getSteelToolsForRound({
      hasCatalogFamilyLookupResult,
      hasInstructionLookupResult,
      hasRequiredFormulaResult,
      hasReviewedPriceResult,
      mustGetRequiredFormulaResult,
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
    const workbookSubtotalMismatch = getFirstWorkbookSubtotalMismatch(parsedWorkbookPatchCalls);
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

      if (mustGetRequiredFormulaResult && !hasRequiredFormulaResult) {
        prompt = [...prompt, createRequiredFormulaLookupReminderMessage()];
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
        ({ call, result: toolResult }) =>
          call.toolName === 'lookup_catalog_families' && toolResult.ok,
      )
    ) {
      hasCatalogFamilyLookupResult = true;
    }
    if (
      executedCalls.some(
        ({ call, result: toolResult }) => call.toolName === 'lookup_quote_rules' && toolResult.ok,
      )
    ) {
      hasInstructionLookupResult = true;
    }
    for (const requiredLookup of executedCalls.flatMap(({ result: toolResult }) =>
      getRequiredLookupsFromResult(toolResult),
    )) {
      requiredSteelLookups.add(requiredLookup);
    }
    if (
      executedCalls.some(
        ({ call, result: toolResult }) => call.toolName === 'lookup_formula' && toolResult.ok,
      )
    ) {
      hasRequiredFormulaResult = true;
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
    } else if (requiredSteelLookups.has('lookup_formula') && !hasRequiredFormulaResult) {
      prompt = [...nextPrompt, createRequiredFormulaLookupReminderMessage()];
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

  if (requiredSteelLookups.has('lookup_formula') && !hasRequiredFormulaResult) {
    throw new Error('lookup_formula was required before answering this Steel price request.');
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
