import { steelToolArgsSchemas, type SteelToolName } from './schemas';

import type { ZodType } from 'zod';

export type SteelProviderToolName = Extract<
  SteelToolName,
  'search_customers' | 'search_price_candidates' | 'run_file_ocr'
>;

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
      'Search product price candidates from AI-derived candidateQueries only. The backend normalizes each keyword to spec_key format, uses contains-style spec_key lookup, accepts an optional customerTierId, uses known customer tier pricing, defaults missing tier context to B tier, and does not apply unit/category/review/active filters.',
    argsSchema: steelToolArgsSchemas.search_price_candidates,
  },
  {
    name: 'run_file_ocr',
    description:
      'Run PaddleOCR MCP on an uploaded image or whole PDF when the AI decides OCR is needed; PDFs are sent as one document, not page-by-page.',
    argsSchema: steelToolArgsSchemas.run_file_ocr,
  },
  {
    name: 'read_working_order_items',
    description:
      'Read conversation-scoped Working Order Memory by summary, item number, ERP item code, spec/product query, source file/page, or paginated rows. This is read-only; the backend saves final Markdown/tool/OCR evidence automatically.',
    argsSchema: steelToolArgsSchemas.read_working_order_items,
  },
];

function isSteelProviderToolName(value: SteelToolName): value is SteelProviderToolName {
  return providerToolNames.has(value as SteelProviderToolName);
}

const steelToolDefinitions = executableSteelToolDefinitions.filter(
  (definition): definition is SteelToolDefinition<SteelProviderToolName> =>
    isSteelProviderToolName(definition.name),
);

const providerDefinitionsByName = new Map(
  steelToolDefinitions.map((definition) => [definition.name, definition]),
);

const executableDefinitionsByName = new Map(
  executableSteelToolDefinitions.map((definition) => [definition.name, definition]),
);

export function getSteelToolDefinitions(): SteelToolDefinition<SteelProviderToolName>[] {
  return [...steelToolDefinitions];
}

export function isSteelToolName(value: string): value is SteelProviderToolName {
  return providerDefinitionsByName.has(value as SteelProviderToolName);
}

export function getSteelToolDefinition(
  name: SteelProviderToolName,
): SteelToolDefinition<SteelProviderToolName> {
  const definition = providerDefinitionsByName.get(name);

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
