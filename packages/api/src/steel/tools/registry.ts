import { steelToolArgsSchemas, type SteelToolName } from './schemas';

import type { ZodType } from 'zod';

export interface SteelToolDefinition {
  name: SteelToolName;
  description: string;
  argsSchema: ZodType;
}

const steelToolDefinitions: SteelToolDefinition[] = [
  {
    name: 'lookup_instructions',
    description:
      'Retrieve reviewed Steel instruction packet groups for a batched interpreted order context.',
    argsSchema: steelToolArgsSchemas.lookup_instructions,
  },
  {
    name: 'lookup_catalog_families',
    description:
      'Retrieve reviewed catalog-family vocabulary candidates for AI selection; does not resolve oral wording to a single key.',
    argsSchema: steelToolArgsSchemas.lookup_catalog_families,
  },
  {
    name: 'lookup_defaults',
    description: 'Retrieve reviewed quote defaults for batched Steel material contexts.',
    argsSchema: steelToolArgsSchemas.lookup_defaults,
  },
  {
    name: 'lookup_formula',
    description: 'Retrieve reviewed formula candidates for batched Steel material contexts.',
    argsSchema: steelToolArgsSchemas.lookup_formula,
  },
  {
    name: 'search_customers',
    description: 'Search Steel customers by ERP code, display name, legal name, or alias.',
    argsSchema: steelToolArgsSchemas.search_customers,
  },
  {
    name: 'search_price_candidates',
    description:
      'Search reviewed product price candidates from normalized candidate queries without converting price units.',
    argsSchema: steelToolArgsSchemas.search_price_candidates,
  },
];

const definitionsByName = new Map(
  steelToolDefinitions.map((definition) => [definition.name, definition]),
);

export function getSteelToolDefinitions(): SteelToolDefinition[] {
  return [...steelToolDefinitions];
}

export function isSteelToolName(value: string): value is SteelToolName {
  return definitionsByName.has(value as SteelToolName);
}

export function getSteelToolDefinition(name: SteelToolName): SteelToolDefinition {
  const definition = definitionsByName.get(name);

  if (!definition) {
    throw new Error(`Unknown Steel tool: ${name}`);
  }

  return definition;
}
