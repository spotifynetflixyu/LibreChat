import { steelToolArgsSchemas, type SteelToolName } from './schemas';

import type { ZodType } from 'zod';

export type SteelProviderToolName = Extract<
  SteelToolName,
  'search_customers' | 'search_price_candidates' | 'run_file_ocr' | 'read_markdown'
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
}

export const steelReadMarkdownUsagePolicy = {
  requiresMissingMarkdownInHistory: true,
  forbiddenWhenHistoryHasNeededMarkdown: true,
  allowedScopes: ['workbook', 'ocr'],
  currentConversationScoped: true,
} as const satisfies SteelToolUsagePolicy;

const providerToolNames = new Set<SteelProviderToolName>([
  'search_customers',
  'search_price_candidates',
  'run_file_ocr',
  'read_markdown',
]);

const executableSteelToolDefinitions: SteelToolDefinition<SteelToolName>[] = [
  {
    name: 'search_customers',
    description:
      'Search Steel customers using AI-selected keywords across ERP code, display name, legal name, tax id, and aliases.',
    argsSchema: steelToolArgsSchemas.search_customers,
  },
  {
    name: 'search_price_candidates',
    description:
      'Search unified Steel price candidates with AI-derived query objects. Send only top-level queries. Each lookup query omits mode or uses mode=lookup, includes a visible category enum value, and may include material keyword enum value: 黑鐵, 白鐵, 錏, 鋁, or 鋅. It may also include thicknessMm string array, keyword text, and per-query limit defaulting to 30. If category is unclear, add a query with mode=category_discovery and keyword first instead of guessing.',
    argsSchema: steelToolArgsSchemas.search_price_candidates,
  },
  {
    name: 'run_file_ocr',
    description:
      'Run PaddleOCR MCP on an uploaded image or whole PDF when the AI decides OCR is needed; PDFs are sent as one document, not page-by-page. Do not call this for user confirmations or corrections of prior OCR/table content unless the user explicitly requests rerun OCR or provides new/changed file evidence.',
    argsSchema: steelToolArgsSchemas.run_file_ocr,
  },
  {
    name: 'read_markdown',
    description:
      'Read the current conversation-scoped Markdown text for either workbook or OCR data only when chat history no longer contains the complete assistant table/evidence. First inspect provider chat history; if the needed OCR/workbook Markdown is already present and complete enough there, do not call this tool. Use scope=workbook for the strict workbook including quote sheets, or scope=ocr for free-form drawing/OCR evidence. Do not pass row queries, quote scope, all scope, or conversation IDs; the backend uses the active conversation.',
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
