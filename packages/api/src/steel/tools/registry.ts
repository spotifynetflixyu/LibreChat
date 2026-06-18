import { steelToolArgsSchemas, type SteelBusinessToolName } from './schemas';

import type { ZodType } from 'zod';

export interface SteelToolDefinition {
  name: SteelBusinessToolName;
  description: string;
  argsSchema: ZodType;
}

const steelToolDefinitions: SteelToolDefinition[] = [
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

const definitionsByName = new Map(
  steelToolDefinitions.map((definition) => [definition.name, definition]),
);

export function getSteelToolDefinitions(): SteelToolDefinition[] {
  return [...steelToolDefinitions];
}

export function isSteelToolName(value: string): value is SteelBusinessToolName {
  return definitionsByName.has(value as SteelBusinessToolName);
}

export function getSteelToolDefinition(name: SteelBusinessToolName): SteelToolDefinition {
  const definition = definitionsByName.get(name);

  if (!definition) {
    throw new Error(`Unknown Steel tool: ${name}`);
  }

  return definition;
}
