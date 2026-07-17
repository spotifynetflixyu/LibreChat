import { steelToolArgsSchemas, type SteelToolName } from './schemas';

import type { ZodType } from 'zod';

export type SteelProviderToolName = Extract<
  SteelToolName,
  'search_customers' | 'search_price_candidates'
>;

export interface SteelToolDefinition<Name extends SteelToolName = SteelProviderToolName> {
  name: Name;
  description: string;
  argsSchema: ZodType;
  usagePolicy?: SteelToolUsagePolicy;
}

export interface SteelToolUsagePolicy {
  readonly requiresMissingMarkdownInHistory?: boolean;
  readonly forbiddenWhenHistoryHasNeededMarkdown?: boolean;
  readonly allowedScopes?: readonly string[];
  readonly currentConversationScoped?: boolean;
  readonly fileKeyParameter?: string;
  readonly ocrFileKeyParameter?: string;
  readonly defaultWorkbookFileKey?: string;
  readonly fileKeyRecommendedWhenMultipleOrders?: boolean;
  readonly ocrFileKeyRecommendedForFullContent?: boolean;
}

const providerToolNames = new Set<SteelProviderToolName>([
  'search_customers',
  'search_price_candidates',
]);

const executableSteelToolDefinitions: SteelToolDefinition<SteelToolName>[] = [
  {
    name: 'search_customers',
    description: 'Find Steel customer records for quoting.',
    argsSchema: steelToolArgsSchemas.search_customers,
  },
  {
    name: 'search_price_candidates',
    description:
      'Find material, cutting, and processing price candidates for one or more order lines.',
    argsSchema: steelToolArgsSchemas.search_price_candidates,
  },
];

function isSteelProviderToolName(value: SteelToolName): value is SteelProviderToolName {
  return providerToolNames.has(value as SteelProviderToolName);
}

const executableDefinitionsByName = new Map(
  executableSteelToolDefinitions.map((definition) => [definition.name, definition]),
);

export function getSteelToolDefinitions(): SteelToolDefinition<SteelProviderToolName>[] {
  return executableSteelToolDefinitions.filter(
    (definition): definition is SteelToolDefinition<SteelProviderToolName> =>
      isSteelProviderToolName(definition.name),
  );
}

export function isSteelToolName(value: string): value is SteelProviderToolName {
  return getSteelToolDefinitions().some((definition) => definition.name === value);
}

export function getSteelToolDefinition(
  name: SteelProviderToolName,
): SteelToolDefinition<SteelProviderToolName> {
  const definition = getSteelToolDefinitions().find((entry) => entry.name === name);

  if (!definition) {
    throw new Error(`Unknown Steel provider tool: ${name}`);
  }

  return definition;
}

export function isExecutableSteelToolName(value: string): value is SteelToolName {
  return executableDefinitionsByName.has(value as SteelToolName);
}

export function getExecutableSteelToolDefinition(
  name: SteelToolName,
): SteelToolDefinition<SteelToolName> {
  const definition = executableDefinitionsByName.get(name);

  if (!definition) {
    throw new Error(`Unknown Steel executable tool: ${name}`);
  }

  return definition;
}
