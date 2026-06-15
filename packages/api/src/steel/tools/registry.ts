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
      'Retrieve reviewed Steel instruction packets plus quote defaults for one batched interpreted order context; supports multiple catalog/material keys in catalogContexts.',
    argsSchema: steelToolArgsSchemas.lookup_quote_rules,
  },
  {
    name: 'lookup_catalog_families',
    description:
      'Retrieve reviewed catalog-family vocabulary candidates for AI selection; does not resolve oral wording to a single key.',
    argsSchema: steelToolArgsSchemas.lookup_catalog_families,
  },
  {
    name: 'search_customers',
    description: 'Search Steel customers by ERP code, display name, legal name, or alias.',
    argsSchema: steelToolArgsSchemas.search_customers,
  },
  {
    name: 'search_price_candidates',
    description:
      'Search reviewed product price candidates from AI-derived product-name text and ERP item code prefixes without converting price units. Batch related product names, specification fragments, and code prefixes into one call with productNames, erpItemCodes, or candidateQueries; do not call once per keyword. productNames searches price-row product names; erpItemCodes searches exact item codes or prefixes.',
    argsSchema: steelToolArgsSchemas.search_price_candidates,
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
