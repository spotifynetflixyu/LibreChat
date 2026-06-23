import { steelToolArgsSchemas, type SteelToolName } from './schemas';

import type { ZodType } from 'zod';

export type SteelProviderToolName = Extract<
  SteelToolName,
  'search_customers' | 'search_price_candidates' | 'run_file_ocr' | 'read_active_workbook'
>;

export type SteelProviderToolContextMode = 'full' | 'compact_workbook';

export interface SteelToolDefinition<Name extends SteelToolName = SteelProviderToolName> {
  name: Name;
  description: string;
  argsSchema: ZodType;
}

const providerToolNames = new Set<SteelProviderToolName>([
  'search_customers',
  'search_price_candidates',
  'run_file_ocr',
]);

const executableSteelToolDefinitions: SteelToolDefinition<SteelToolName>[] = [
  {
    name: 'lookup_quote_rules',
    description:
      'Search Steel quote rules, instruction packets, and quote defaults using AI-selected keywords with contains-style database lookup.',
    argsSchema: steelToolArgsSchemas.lookup_quote_rules,
  },
  {
    name: 'search_customers',
    description:
      'Search Steel customers using AI-selected keywords across ERP code, display name, legal name, tax id, and aliases.',
    argsSchema: steelToolArgsSchemas.search_customers,
  },
	  {
	    name: 'search_price_candidates',
	    description:
	      'Search unified Steel price candidates with AI-derived queries. Lookup mode requires each query to include a visible category enum value, optionally filters visible material enum values, thickness strings, spec strings, and product keyword text, and returns all A/B/C/F tier prices for each candidate. Set includeRelatedCutting=true when the same lookup should also return related 切工/切割 rows for long materials. If category is unclear, use category_discovery mode with a keyword first instead of guessing.',
	    argsSchema: steelToolArgsSchemas.search_price_candidates,
	  },
  {
    name: 'run_file_ocr',
    description:
      'Run PaddleOCR MCP on an uploaded image or whole PDF when the AI decides OCR is needed; PDFs are sent as one document, not page-by-page.',
    argsSchema: steelToolArgsSchemas.run_file_ocr,
  },
  {
    name: 'read_active_workbook',
    description:
      'Keyword-search compact active workbook context when exact row data is needed. Search by semantic keywords such as model, product name, customer, item number, part number, or status. Do not use spreadsheet coordinates. Returned matches include complete rowData for each matched row.',
    argsSchema: steelToolArgsSchemas.read_active_workbook,
  },
  {
    name: 'read_working_order_items',
    description:
      'Read conversation-scoped Working Order Memory by summary, item number, ERP item code, spec/product query, source file/page, or paginated rows. This is read-only; the backend saves final Markdown/tool/OCR evidence automatically.',
    argsSchema: steelToolArgsSchemas.read_working_order_items,
  },
];

function getProviderToolNames(contextMode: SteelProviderToolContextMode): Set<SteelProviderToolName> {
  if (contextMode !== 'compact_workbook') {
    return providerToolNames;
  }

  return new Set([...providerToolNames, 'read_active_workbook']);
}

function isSteelProviderToolName(
  value: SteelToolName,
  contextMode: SteelProviderToolContextMode,
): value is SteelProviderToolName {
  return getProviderToolNames(contextMode).has(value as SteelProviderToolName);
}

const executableDefinitionsByName = new Map(
  executableSteelToolDefinitions.map((definition) => [definition.name, definition]),
);

export function getSteelToolDefinitions(
  input: { contextMode?: SteelProviderToolContextMode } = {},
): SteelToolDefinition<SteelProviderToolName>[] {
  const contextMode = input.contextMode ?? 'full';

  return executableSteelToolDefinitions.filter(
    (definition): definition is SteelToolDefinition<SteelProviderToolName> =>
      isSteelProviderToolName(definition.name, contextMode),
  );
}

export function isSteelToolName(
  value: string,
  input: { contextMode?: SteelProviderToolContextMode } = {},
): value is SteelProviderToolName {
  const contextMode = input.contextMode ?? 'full';
  return getSteelToolDefinitions({ contextMode }).some((definition) => definition.name === value);
}

export function getSteelToolDefinition(
  name: SteelProviderToolName,
  input: { contextMode?: SteelProviderToolContextMode } = {},
): SteelToolDefinition<SteelProviderToolName> {
  const definition = getSteelToolDefinitions(input).find((entry) => entry.name === name);

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
