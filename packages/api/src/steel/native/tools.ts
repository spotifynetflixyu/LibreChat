import { zodToJsonSchema } from 'zod-to-json-schema';
import { getSteelToolDefinitions, isSteelToolName } from '../tools/registry';
import {
  delegateOcrToolName,
  getDelegateOcrToolDefinition,
  isResolvedDelegateOcrPolicy,
} from './delegate';

import type { JsonSchemaType, LCTool, LCToolRegistry } from '@librechat/agents';
import type { SteelProviderToolName, SteelToolDefinition } from '../tools/registry';
import type { SteelToolJsonObject, SteelToolJsonValue, SteelToolResult } from '../tools/results';

export type NativeSteelToolNameMap = Map<SteelProviderToolName, string>;

export interface MergeSteelToolDefinitionsInput {
  toolDefinitions?: readonly LCTool[];
  toolRegistry?: LCToolRegistry;
  aiVisibleTools?: readonly string[];
}

export interface MergeSteelToolDefinitionsResult {
  toolDefinitions: LCTool[];
  toolRegistry: LCToolRegistry;
  nameMap: NativeSteelToolNameMap;
}

export interface SteelNativeToolConfig {
  tools?: readonly ({ name?: string } | string | null | undefined)[];
  toolDefinitions?: readonly LCTool[];
  toolRegistry?: LCToolRegistry;
  [key: string]: unknown;
}

export interface SteelNativeToolVisibilityOptions {
  ocrTurnActive?: boolean;
  allowPaddleOcr?: boolean;
  excludeDelegateOcr?: boolean;
  delegateOcrPolicy?: unknown;
  /** Internal initialization-only escape hatch. Never pass to provider binding. */
  initializationDefer?: boolean;
}

export interface SteelNativeToolInvokeConfig {
  toolCall?: {
    id?: unknown;
  };
}

export interface SteelNativeToolArtifact {
  type: 'steel_tool_result';
  toolName: SteelProviderToolName;
  nativeToolName: string;
  result: SteelToolResult;
}

export interface SteelNativeToolInvokeResult {
  content: string;
  artifact?: SteelNativeToolArtifact;
}

export interface SteelNativeToolExecuteInput {
  toolName: SteelProviderToolName;
  nativeToolName: string;
  arguments: unknown;
  providerToolCallId?: string;
}

export type SteelNativeToolExecute = (
  input: SteelNativeToolExecuteInput,
) => Promise<SteelToolResult>;

export interface SteelNativeExecutableTool {
  name: string;
  invoke(args: unknown, config?: SteelNativeToolInvokeConfig): Promise<SteelNativeToolInvokeResult>;
}

export interface CreateSteelNativeToolInput {
  nativeToolName: string;
  steelToolName: SteelProviderToolName;
  execute: SteelNativeToolExecute;
}

export function getNativeSteelToolName(
  toolName: SteelProviderToolName,
  nameMap: NativeSteelToolNameMap,
): string {
  return nameMap.get(toolName) ?? toolName;
}

export function resolveNativeSteelToolName(
  nativeToolName: string,
  nameMap: NativeSteelToolNameMap,
): SteelProviderToolName | undefined {
  for (const [steelToolName, mappedName] of nameMap.entries()) {
    if (nativeToolName === mappedName) {
      return steelToolName;
    }
  }

  return undefined;
}

export function resolveSteelProviderToolName(
  nativeToolName: string,
): SteelProviderToolName | undefined {
  if (isSteelToolName(nativeToolName)) {
    return nativeToolName;
  }

  if (!nativeToolName.startsWith('steel_')) {
    return undefined;
  }

  const unprefixedName = nativeToolName.slice('steel_'.length);
  return isSteelToolName(unprefixedName) ? unprefixedName : undefined;
}

function isPaddleOcrToolName(toolName: string): boolean {
  return toolName.toLowerCase().includes('paddleocr_vl');
}

function isPaddleOcrToolVisibleToMainAgent(toolName: string | undefined): boolean {
  return typeof toolName !== 'string' || !isPaddleOcrToolName(toolName);
}

function isVisibleForSteelNativeTurn(
  toolName: string | undefined,
  {
    ocrTurnActive,
    allowPaddleOcr,
    excludeDelegateOcr,
    delegateOcrPolicy,
    initializationDefer,
  }: Required<SteelNativeToolVisibilityOptions>,
): boolean {
  if (toolName === delegateOcrToolName) {
    const policyAllowsDelegate =
      isResolvedDelegateOcrPolicy(delegateOcrPolicy) &&
      delegateOcrPolicy.allowed === true &&
      delegateOcrPolicy.allowedFileKeys.length > 0;
    if (
      excludeDelegateOcr ||
      ocrTurnActive ||
      (!policyAllowsDelegate &&
        !(initializationDefer && delegateOcrPolicy === undefined))
    ) {
      return false;
    }
  }
  if (excludeDelegateOcr && toolName === delegateOcrToolName) {
    return false;
  }
  if (!allowPaddleOcr && !isPaddleOcrToolVisibleToMainAgent(toolName)) {
    return false;
  }
  const steelProviderToolName =
    typeof toolName === 'string' ? resolveSteelProviderToolName(toolName) : undefined;
  const isAlwaysVisibleSteelTool =
    toolName === delegateOcrToolName ||
    steelProviderToolName === 'search_customers' ||
    steelProviderToolName === 'search_price_candidates';
  return (
    !ocrTurnActive ||
    typeof toolName !== 'string' ||
    steelProviderToolName === undefined ||
    isAlwaysVisibleSteelTool
  );
}

/** Applies the shared PaddleOCR and Steel-tool visibility policy to an initialized agent config. */
export function prepareSteelNativeToolConfig<T extends SteelNativeToolConfig>(
  config: T,
  options: SteelNativeToolVisibilityOptions = {},
): T {
  const visibility = {
    ocrTurnActive: options.ocrTurnActive === true,
    allowPaddleOcr: options.allowPaddleOcr === true,
    excludeDelegateOcr: options.excludeDelegateOcr === true,
    delegateOcrPolicy: options.delegateOcrPolicy,
    initializationDefer: options.initializationDefer === true,
  };
  const next = { ...config } as T;
  if (config.tools) {
    const tools = config.tools.filter((tool) =>
      isVisibleForSteelNativeTurn(
        typeof tool === 'string' ? tool : tool?.name,
        visibility,
      ),
    );
    if (tools.length !== config.tools.length) {
      next.tools = tools;
    }
  }
  if (config.toolDefinitions) {
    const toolDefinitions = config.toolDefinitions.filter((definition) =>
      isVisibleForSteelNativeTurn(definition.name, visibility),
    );
    if (toolDefinitions.length !== config.toolDefinitions.length) {
      next.toolDefinitions = toolDefinitions;
    }
  }
  if (config.toolRegistry) {
    const entries = [...config.toolRegistry.entries()].filter(([name, definition]) =>
      isVisibleForSteelNativeTurn(name, visibility) &&
      isVisibleForSteelNativeTurn(definition.name, visibility),
    );
    if (entries.length !== config.toolRegistry.size) {
      next.toolRegistry = new Map(entries);
    }
  }
  return next;
}

/** Removes the PaddleOCR MCP tool while preserving Steel tools for one OCR turn. */
export function stripSteelToolsForOcrTurn<T extends SteelNativeToolConfig>(config: T): T {
  return prepareSteelNativeToolConfig(config, { ocrTurnActive: true });
}

/** Removes PaddleOCR from a main agent while leaving the MCP catalog unchanged. */
export function stripPaddleOcrToolsForMainAgent<T extends SteelNativeToolConfig>(config: T): T {
  return prepareSteelNativeToolConfig(config);
}

function getProviderToolCallId(config?: SteelNativeToolInvokeConfig): string | undefined {
  return typeof config?.toolCall?.id === 'string' ? config.toolCall.id : undefined;
}

function getJsonObject(value: SteelToolJsonValue | undefined): SteelToolJsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function pickJsonFields(
  source: SteelToolJsonObject,
  fields: readonly string[],
): SteelToolJsonObject {
  return fields.reduce<SteelToolJsonObject>((result, field) => {
    const value = source[field];
    if (value !== undefined && value !== null) {
      result[field] = value;
    }
    return result;
  }, {});
}

function compactJsonObjects(
  value: SteelToolJsonValue | undefined,
  compact: (source: SteelToolJsonObject) => SteelToolJsonObject,
): SteelToolJsonObject[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const source = getJsonObject(entry);
        return source ? [compact(source)] : [];
      })
    : [];
}

const compactCandidateFields = [
  'erpItemCode',
  'productName',
  'category',
  'subcategory',
  'processingMethod',
  'processingShape',
  'material',
  'unit',
  'formulaCode',
  'unitWeightValue',
  'density',
  'thicknessMinMm',
  'thicknessMaxMm',
  'widthMm',
  'heightMm',
  'lengthMm',
  'outerDiameterMm',
  'nominalInch',
  'webMm',
  'flangeMm',
  'lipMm',
  'sheetWidthMm',
  'sheetLengthMm',
  'quoteEligible',
  'matchedQueryIds',
  'materialBillingMode',
  'cuttingFeePolicy',
] as const;

function compactPricingOption(source: SteelToolJsonObject): SteelToolJsonObject {
  return pickJsonFields(source, [
    'source',
    'quoteEligible',
    'quoteUnit',
    'tierPrices',
    'defaultQuoteTier',
    'defaultQuoteUnitPrice',
    'fallbackTiers',
  ]);
}

function compactCandidate(source: SteelToolJsonObject): SteelToolJsonObject {
  const candidate = pickJsonFields(source, compactCandidateFields);
  if (Array.isArray(source.pricingOptions)) {
    candidate.pricingOptions = compactJsonObjects(source.pricingOptions, compactPricingOption);
  }

  return candidate;
}

function compactCandidates(value: SteelToolJsonValue | undefined): SteelToolJsonValue[] {
  return compactJsonObjects(value, compactCandidate);
}

function compactCategoryCandidate(source: SteelToolJsonObject): SteelToolJsonObject {
  return pickJsonFields(source, [
    'category',
    'material',
    'candidateCount',
    'exampleErpItemCode',
    'exampleProductName',
  ]);
}

function compactQueryResult(source: SteelToolJsonObject): SteelToolJsonObject {
  const queryResult = pickJsonFields(source, [
    'queryId',
    'status',
    'totalAvailable',
    'returnedCount',
    'selectionRequired',
    'productNames',
  ]);
  queryResult.candidates = compactCandidates(source.candidates);
  if (Array.isArray(source.categoryCandidates)) {
    queryResult.categoryCandidates = compactJsonObjects(
      source.categoryCandidates,
      compactCategoryCandidate,
    );
  }
  return queryResult;
}

function compactCuttingPrice(source: SteelToolJsonObject): SteelToolJsonObject {
  return pickJsonFields(source, [
    'cuttingCategory',
    'itemName',
    'cutType',
    'specText',
    'inchMin',
    'inchMax',
    'mmMin',
    'mmMax',
    'heightMm',
    'widthMm',
    'thicknessMmValues',
    'thicknessMmMin',
    'thicknessMmMax',
    'unit',
    'tierPrices',
  ]);
}

function compactCuttingGroup(source: SteelToolJsonObject): SteelToolJsonObject {
  const group = pickJsonFields(source, ['cuttingCategory', 'sourceCategories', 'queryIds']);
  group.prices = compactJsonObjects(source.prices, compactCuttingPrice);
  return group;
}

function compactProcessingGroup(source: SteelToolJsonObject): SteelToolJsonObject {
  const group = pickJsonFields(source, ['processingCategory', 'totalAvailable']);
  group.items = compactCandidates(source.items);
  return group;
}

function compactProcessingQueryResult(source: SteelToolJsonObject): SteelToolJsonObject {
  const queryResult = pickJsonFields(source, [
    'queryId',
    'totalAvailable',
    'returnedCount',
    'selectionRequired',
    'productNames',
  ]);
  queryResult.groups = compactJsonObjects(source.groups, compactProcessingGroup);
  return queryResult;
}

function compactPriceCandidateData(data: SteelToolJsonObject): SteelToolJsonObject {
  if (data.productNamePrices !== undefined) {
    return {
      productNames: data.productNames ?? [],
      productNamePrices: compactCandidates(data.productNamePrices),
    };
  }

  const compactData: SteelToolJsonObject = {
    queryResults: compactJsonObjects(data.queryResults, compactQueryResult),
    cuttingPrices: compactJsonObjects(data.cuttingPrices, compactCuttingGroup),
  };
  const processingPrice = getJsonObject(data.processingPrice);
  if (processingPrice) {
    compactData.processingPrice = {
      queryResults: compactJsonObjects(processingPrice.queryResults, compactProcessingQueryResult),
    };
  }
  return compactData;
}

function getProviderVisibleResult(
  result: SteelToolResult,
  steelToolName: SteelProviderToolName,
): SteelToolResult | { ok: true; toolName: SteelProviderToolName; data: SteelToolJsonObject } {
  if (!result.ok || steelToolName !== 'search_price_candidates') {
    return result;
  }

  return {
    ok: true,
    toolName: result.toolName,
    data: compactPriceCandidateData(result.data),
  };
}

export function createSteelNativeTool({
  execute,
  nativeToolName,
  steelToolName,
}: CreateSteelNativeToolInput): SteelNativeExecutableTool {
  return {
    name: nativeToolName,
    async invoke(args, config) {
      const result = await execute({
        toolName: steelToolName,
        nativeToolName,
        arguments: args,
        providerToolCallId: getProviderToolCallId(config),
      });

      return {
        content: JSON.stringify(getProviderVisibleResult(result, steelToolName)),
        artifact: {
          type: 'steel_tool_result',
          toolName: steelToolName,
          nativeToolName,
          result,
        },
      };
    },
  };
}

function getAiVisibleTools(input: MergeSteelToolDefinitionsInput): Set<string> {
  return new Set(
    input.aiVisibleTools ??
      getSteelToolDefinitions().map((definition) => definition.name),
  );
}

const jsonSchemaByToolName = new Map<SteelProviderToolName, JsonSchemaType>();

type JsonSchemaValue =
  | null
  | boolean
  | number
  | string
  | JsonSchemaValue[]
  | { [key: string]: JsonSchemaValue };

function normalizeExclusiveBounds(value: JsonSchemaValue): JsonSchemaValue {
  if (Array.isArray(value)) {
    return value.map(normalizeExclusiveBounds);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const normalized: { [key: string]: JsonSchemaValue } = {};
  for (const [key, nested] of Object.entries(value)) {
    if ((key === 'exclusiveMinimum' || key === 'exclusiveMaximum') && typeof nested === 'boolean') {
      if (!nested) {
        continue;
      }

      const boundary = value[key === 'exclusiveMinimum' ? 'minimum' : 'maximum'];
      if (typeof boundary !== 'number') {
        throw new Error(`${key} requires a numeric boundary`);
      }
      normalized[key] = boundary;
      continue;
    }

    normalized[key] = normalizeExclusiveBounds(nested);
  }
  return normalized;
}

function getJsonSchema(definition: SteelToolDefinition): JsonSchemaType {
  const cached = jsonSchemaByToolName.get(definition.name);
  if (cached) {
    return cached;
  }

  const schema = zodToJsonSchema(definition.argsSchema, {
    name: definition.name,
    target: 'openApi3',
  }) as JsonSchemaValue;
  const normalizedSchema = normalizeExclusiveBounds(schema) as JsonSchemaType;
  jsonSchemaByToolName.set(definition.name, normalizedSchema);
  return normalizedSchema;
}

function getAvailableNativeToolName(steelToolName: SteelProviderToolName, usedNames: Set<string>) {
  if (!usedNames.has(steelToolName)) {
    return steelToolName;
  }

  const namespacedName = `steel_${steelToolName}`;
  if (usedNames.has(namespacedName)) {
    throw new Error(`Steel tool name collision: ${steelToolName}`);
  }

  return namespacedName;
}

function toNativeToolDefinition({
  definition,
  name,
}: {
  definition: SteelToolDefinition;
  name: string;
}): LCTool {
  return {
    name,
    description:
      name === definition.name
        ? definition.description
        : `Steel ${definition.name}: ${definition.description}`,
    parameters: getJsonSchema(definition),
    allowed_callers: ['direct'],
    toolType: 'builtin',
  };
}

export function mergeSteelToolDefinitions(
  input: MergeSteelToolDefinitionsInput = {},
): MergeSteelToolDefinitionsResult {
  const aiVisibleTools = getAiVisibleTools(input);
  const toolDefinitions = [...(input.toolDefinitions ?? [])];
  const toolRegistry: LCToolRegistry = new Map(input.toolRegistry ?? []);
  const usedNames = new Set([
    ...toolDefinitions.map((definition) => definition.name),
    ...toolRegistry.keys(),
  ]);
  const nameMap: NativeSteelToolNameMap = new Map();

  if (usedNames.has(delegateOcrToolName)) {
    throw new Error(`Steel tool name collision: ${delegateOcrToolName}`);
  }
  const delegateDefinition = getDelegateOcrToolDefinition();
  usedNames.add(delegateOcrToolName);
  toolDefinitions.push(delegateDefinition);
  toolRegistry.set(delegateOcrToolName, delegateDefinition);

  for (const definition of getSteelToolDefinitions()) {
    if (!aiVisibleTools.has(definition.name)) {
      continue;
    }

    const nativeName = getAvailableNativeToolName(definition.name, usedNames);
    const nativeDefinition = toNativeToolDefinition({ definition, name: nativeName });
    usedNames.add(nativeName);
    nameMap.set(definition.name, nativeName);
    toolDefinitions.push(nativeDefinition);
    toolRegistry.set(nativeName, nativeDefinition);
  }

  return {
    toolDefinitions,
    toolRegistry,
    nameMap,
  };
}
