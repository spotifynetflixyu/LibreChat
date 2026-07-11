import { zodToJsonSchema } from 'zod-to-json-schema';
import { getSteelToolDefinitions, isSteelToolName } from '../tools/registry';

import type { JsonSchemaType, LCTool, LCToolRegistry } from '@librechat/agents';
import type { SteelProviderToolName, SteelToolDefinition } from '../tools/registry';
import type { SteelToolResult } from '../tools/results';
import type { SteelRuntimeContext } from '../runtime/context';

export type NativeSteelToolNameMap = Map<SteelProviderToolName, string>;

export interface MergeSteelToolDefinitionsInput {
  toolDefinitions?: readonly LCTool[];
  toolRegistry?: LCToolRegistry;
  runtimeContext?: Pick<SteelRuntimeContext, 'outputSheets' | 'toolPolicy'>;
  aiVisibleTools?: readonly string[];
}

export interface MergeSteelToolDefinitionsResult {
  toolDefinitions: LCTool[];
  toolRegistry: LCToolRegistry;
  nameMap: NativeSteelToolNameMap;
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

function getProviderToolCallId(config?: SteelNativeToolInvokeConfig): string | undefined {
  return typeof config?.toolCall?.id === 'string' ? config.toolCall.id : undefined;
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
        content: JSON.stringify(result),
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
      input.runtimeContext?.toolPolicy.aiVisibleTools ??
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
