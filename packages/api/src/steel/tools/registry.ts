import { steelToolArgsSchemas, type SteelToolName } from './schemas';

import type { ZodType } from 'zod';

export interface SteelToolDefinition {
  name: SteelToolName;
  description: string;
  argsSchema: ZodType;
}

const steelToolDefinitions: SteelToolDefinition[] = [
  {
    name: 'lookup_customer',
    description: 'Find one customer and tier match, or return candidates when ambiguous.',
    argsSchema: steelToolArgsSchemas.lookup_customer,
  },
  {
    name: 'search_customers',
    description: 'Search Steel customers by ERP code, display name, legal name, or alias.',
    argsSchema: steelToolArgsSchemas.search_customers,
  },
  {
    name: 'normalize_quote_item',
    description:
      'Resolve AI-proposed quote item candidates into usable or user-confirmation states.',
    argsSchema: steelToolArgsSchemas.normalize_quote_item,
  },
  {
    name: 'search_price_candidates',
    description: 'Search reviewed product price candidates without converting price units.',
    argsSchema: steelToolArgsSchemas.search_price_candidates,
  },
  {
    name: 'rank_price_candidates',
    description: 'Rank price candidates and decide whether to use, reject, or ask the user.',
    argsSchema: steelToolArgsSchemas.rank_price_candidates,
  },
  {
    name: 'lookup_spec_price',
    description: 'Look up product price candidates for a normalized spec key.',
    argsSchema: steelToolArgsSchemas.lookup_spec_price,
  },
  {
    name: 'lookup_weight_spec',
    description: 'Look up reviewed handbook-style weight specs separately from product price.',
    argsSchema: steelToolArgsSchemas.lookup_weight_spec,
  },
  {
    name: 'lookup_cutting_price',
    description: 'Look up cutting prices from reviewed cutting-price data.',
    argsSchema: steelToolArgsSchemas.lookup_cutting_price,
  },
  {
    name: 'lookup_hole_price',
    description: 'Look up round and non-round hole prices from reviewed hole-price data.',
    argsSchema: steelToolArgsSchemas.lookup_hole_price,
  },
  {
    name: 'lookup_processing_price',
    description: 'Look up generic processing prices from reviewed processing data.',
    argsSchema: steelToolArgsSchemas.lookup_processing_price,
  },
  {
    name: 'lookup_material_rules',
    description: 'Look up task-scoped material rules only.',
    argsSchema: steelToolArgsSchemas.lookup_material_rules,
  },
  {
    name: 'lookup_formula_version',
    description: 'Look up the latest reviewed active formula version by formula code.',
    argsSchema: steelToolArgsSchemas.lookup_formula_version,
  },
  {
    name: 'find_order_items',
    description: 'Find historical ERP order items by ERP order code.',
    argsSchema: steelToolArgsSchemas.find_order_items,
  },
  {
    name: 'search_source_chunks',
    description: 'Search active reviewed source chunks for bounded quote context.',
    argsSchema: steelToolArgsSchemas.search_source_chunks,
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
