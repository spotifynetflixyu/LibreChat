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
  'unitWeightBasis',
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
  'priceSource',
  'quoteUnit',
  'tierPrices',
  'fallbackTiers',
] as const;

function compactCandidate(source: SteelToolJsonObject): SteelToolJsonObject {
  return pickJsonFields(source, compactCandidateFields);
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
    'truncated',
    'defaultMaterial',
    'availableMaterials',
    'defaultWhiteSteelSurface',
    'availableWhiteSteelSurfaces',
    'categoryMaterialOptions',
    'issue',
    'allowedMaterials',
    'allowedSurfaces',
    'unsupportedMaterials',
    'defaultMaterialGroups',
  ]);
  if (Array.isArray(source.candidates)) {
    queryResult.candidates = compactCandidates(source.candidates);
  }
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
  const group = pickJsonFields(source, [
    'processingCategory',
    'totalAvailable',
    'returnedCount',
    'truncated',
  ]);
  group.items = compactCandidates(source.items);
  return group;
}

function compactProcessingQueryResult(source: SteelToolJsonObject): SteelToolJsonObject {
  const queryResult = pickJsonFields(source, [
    'queryId',
    'totalAvailable',
    'returnedCount',
    'truncated',
    'defaultMaterial',
    'availableMaterials',
    'defaultWhiteSteelSurface',
    'availableWhiteSteelSurfaces',
  ]);
  queryResult.groups = compactJsonObjects(source.groups, compactProcessingGroup);
  return queryResult;
}

const essentialCandidateFields = [
  'erpItemCode',
  'productName',
  'category',
  'material',
  'unit',
  'formulaCode',
  'quoteEligible',
  'priceSource',
  'quoteUnit',
  'tierPrices',
  'fallbackTiers',
] as const;

interface CandidateCollection {
  query: SteelToolJsonObject;
  items: SteelToolJsonValue[];
  originalCount: number;
}

function updateCandidateCollection(entry: CandidateCollection): void {
  entry.query.returnedCount = entry.items.length;
  const totalAvailable =
    typeof entry.query.totalAvailable === 'number' ? entry.query.totalAvailable : undefined;
  entry.query.truncated =
    totalAvailable === undefined
      ? entry.items.length < entry.originalCount
      : entry.items.length < totalAvailable;
}

function updateProcessingReturnedCounts(processingQueries: SteelToolJsonObject[]): void {
  processingQueries.forEach((query) => {
    if (!Array.isArray(query.groups)) return;
    let returnedCount = 0;
    let truncated = false;
    query.groups.forEach((value) => {
      const group = getJsonObject(value);
      if (!group || !Array.isArray(group.items)) return;
      returnedCount += group.items.length;
      truncated ||= group.truncated === true;
    });
    query.returnedCount = returnedCount;
    const totalAvailable =
      typeof query.totalAvailable === 'number' ? query.totalAvailable : undefined;
    query.truncated =
      totalAvailable === undefined ? truncated : returnedCount < totalAvailable;
  });
}

function compactEssentialCandidates(queryResults: SteelToolJsonObject[]): void {
  queryResults.forEach((query) => {
    if (!Array.isArray(query.candidates)) return;
    query.candidates = compactJsonObjects(query.candidates, (candidate) =>
      pickJsonFields(candidate, essentialCandidateFields),
    );
    query.returnedCount = query.candidates.length;
  });
}

function trimCompactPriceResult(
  data: SteelToolJsonObject,
  maxSerializedChars: number,
): boolean {
  const serializedLength = () => JSON.stringify(data).length;
  if (serializedLength() <= maxSerializedChars) return true;

  data.responseTruncated = true;
  const queryResults = Array.isArray(data.queryResults)
    ? data.queryResults.flatMap((value) => {
        const query = getJsonObject(value);
        return query ? [query] : [];
      })
    : [];
  queryResults.forEach((query) => {
    delete query.categoryCandidates;
  });
  const materialCollections: CandidateCollection[] = [];
  const processingCollections: CandidateCollection[] = [];
  const cuttingCollections: CandidateCollection[] = [];
  queryResults.forEach((query) => {
    if (Array.isArray(query.candidates)) {
      materialCollections.push({
        query,
        items: query.candidates,
        originalCount: query.candidates.length,
      });
    }
  });
  const processing = getJsonObject(data.processingPrice);
  const processingQueries = processing && Array.isArray(processing.queryResults)
    ? processing.queryResults.flatMap((value) => {
        const query = getJsonObject(value);
        return query ? [query] : [];
      })
    : [];
  processingQueries.forEach((query) => {
    if (!Array.isArray(query.groups)) return;
    query.groups.forEach((value) => {
      const group = getJsonObject(value);
      if (group && Array.isArray(group.items)) {
        processingCollections.push({
          query: group,
          items: group.items,
          originalCount: group.items.length,
        });
      }
    });
  });
  if (Array.isArray(data.cuttingPrices)) {
    data.cuttingPrices.forEach((value) => {
      const group = getJsonObject(value);
      if (group && Array.isArray(group.prices)) {
        cuttingCollections.push({
          query: group,
          items: group.prices,
          originalCount: group.prices.length,
        });
      }
    });
  }

  const candidateCollections = [
    ...materialCollections,
    ...processingCollections,
    ...cuttingCollections,
  ];
  for (const entry of candidateCollections) updateCandidateCollection(entry);
  while (serializedLength() > maxSerializedChars) {
    let removed = false;
    for (const entry of candidateCollections) {
      if (serializedLength() <= maxSerializedChars) break;
      if (entry.items.length <= 1) continue;
      entry.items.pop();
      updateCandidateCollection(entry);
      removed = true;
    }
    if (!removed) break;
  }

  updateProcessingReturnedCounts(processingQueries);
  if (serializedLength() <= maxSerializedChars) return true;

  delete data.processingPrice;
  delete data.cuttingPrices;
  if (serializedLength() <= maxSerializedChars) return true;

  compactEssentialCandidates(queryResults);
  if (serializedLength() <= maxSerializedChars) return true;

  return false;
}

function compactPriceCandidateData(
  data: SteelToolJsonObject,
  maxSerializedChars = 79_500,
): SteelToolJsonObject | undefined {
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

  return trimCompactPriceResult(compactData, maxSerializedChars) ? compactData : undefined;
}

function getProviderVisibleResult(
  result: SteelToolResult,
  steelToolName: SteelProviderToolName,
): SteelToolResult | { ok: true; toolName: SteelProviderToolName; data: SteelToolJsonObject } {
  if (!result.ok || steelToolName !== 'search_price_candidates') {
    return result;
  }

  const compactData = compactPriceCandidateData(result.data);
  if (!compactData) {
    return {
      ok: false,
      toolName: result.toolName,
      errorCategory: 'repository_error',
      errorSummary: 'price_candidate_response_too_large',
      durationMs: result.durationMs,
      redactionVersion: 1,
    };
  }

  return {
    ok: true,
    toolName: result.toolName,
    data: compactData,
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
