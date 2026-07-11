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
    description:
      'Search Steel customers using AI-selected keywords across ERP code, display name, legal name, tax id, and aliases.',
    argsSchema: steelToolArgsSchemas.search_customers,
  },
  {
    name: 'search_price_candidates',
    description:
      'Search price candidates for multiple order lines in one call with 1-20 top-level queries. Query IDs are assigned from input order as q1, q2, and so on; supplied queryId values are ignored, and result order matches query order. A lookup query uses a category enum and may filter by subcategory, contains-match material family (黑鐵, 白鐵, 鋁, 錏, 鋅, 鎢, 塑膠), positive decimal thicknessMm, erpItemCode, keyword, and a per-query limit (default 30; positive values above 100 are clamped to 100). Thickness ranges include the lower bound and exclude the upper bound; scalar bounds match exactly. Omit limit normally and use 100 only to expand candidates. Results are grouped by generated queryId; after all normal price queries finish, supported categories receive one consolidated automatic cutting-price lookup with no cutting row limit. If category is unclear, use mode=category_discovery with keyword instead of guessing.',
    argsSchema: steelToolArgsSchemas.search_price_candidates,
  },
  {
    name: 'read_markdown',
    description:
      'Read the current conversation-scoped Markdown text for either workbook or OCR data only when chat history no longer contains the complete assistant table/evidence. First inspect provider chat history; if the needed OCR/workbook Markdown is already present and complete enough there, do not call this tool. Use scope=workbook without fileKey for the combined current workbook. Use scope=workbook with fileKey=file:<id> when multiple OCR files each have their own order and you need one file-specific workbook; use fileKey=default for the text/manual/default order when it coexists with OCR-file orders. For OCR, call scope=ocr without fileKey/ocrFileKey; the backend returns every current OCR Markdown result, merging all OCR preprocessing chunks per file and labeling each file as <file_key>. Do not pass row queries, quote scope, all scope, or conversation IDs; the backend uses the active conversation.',
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
