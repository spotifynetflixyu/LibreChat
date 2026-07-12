import { steelToolArgsSchemas, type SteelToolName } from './schemas';

import type { ZodType } from 'zod';

export type SteelProviderToolName = Extract<
  SteelToolName,
  'search_customers' | 'search_price_candidates' | 'read_markdown'
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

export const steelReadMarkdownUsagePolicy = {
  requiresMissingMarkdownInHistory: true,
  forbiddenWhenHistoryHasNeededMarkdown: true,
  allowedScopes: ['workbook', 'ocr'],
  currentConversationScoped: true,
  fileKeyParameter: 'fileKey',
  ocrFileKeyParameter: 'ocrFileKey',
  defaultWorkbookFileKey: 'default',
  fileKeyRecommendedWhenMultipleOrders: true,
  ocrFileKeyRecommendedForFullContent: true,
} as const satisfies SteelToolUsagePolicy;

const providerToolNames = new Set<SteelProviderToolName>([
  'search_customers',
  'search_price_candidates',
  'read_markdown',
]);

const executableSteelToolDefinitions: SteelToolDefinition<SteelToolName>[] = [
  {
    name: 'search_customers',
    description: 'Search Steel customers by one or more names, aliases, tax IDs, or ERP codes.',
    argsSchema: steelToolArgsSchemas.search_customers,
  },
  {
    name: 'search_price_candidates',
    description:
      'Search price candidates for all known order lines in one call. For a known category, use lookup queries with category and only confirmed filters; when the category is unknown, use category_discovery with keyword. Use erpItemCode only to retrieve an already confirmed row, not for initial discovery. Omit limit normally. Matching cuttingPrices are returned automatically; do not query cutting prices separately.',
    argsSchema: steelToolArgsSchemas.search_price_candidates,
  },
  {
    name: 'read_markdown',
    description:
      'Recover workbook or OCR Markdown only when the needed content is absent or incomplete in chat history. For workbook, omit fileKey for the combined workbook; use file:<id> for one OCR-file order or default for a text/manual order. For OCR, omit the file key for all results or provide one file key for one source. Do not call for same-turn OCR already present in runtime context.',
    argsSchema: steelToolArgsSchemas.read_markdown,
    usagePolicy: steelReadMarkdownUsagePolicy,
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
