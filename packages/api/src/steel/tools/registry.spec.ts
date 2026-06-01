import { getSteelToolDefinition, getSteelToolDefinitions } from './registry';

describe('Steel tool registry', () => {
  it('exposes only provider-neutral business tools', () => {
    const toolNames = getSteelToolDefinitions().map((definition) => definition.name);

    expect(toolNames).toEqual([
      'lookup_customer',
      'search_customers',
      'normalize_quote_item',
      'search_price_candidates',
      'rank_price_candidates',
      'lookup_spec_price',
      'lookup_weight_spec',
      'lookup_cutting_price',
      'lookup_processing_price',
      'lookup_material_rules',
      'lookup_formula_version',
      'find_order_items',
      'search_source_chunks',
    ]);
    expect(toolNames).not.toContain('raw_sql');
    expect(toolNames).not.toContain('read_file');
  });

  it('keeps Zod validation owned by the backend registry', () => {
    const definition = getSteelToolDefinition('lookup_weight_spec');

    expect(definition.argsSchema.parse({ specKey: 'H100', limit: 2 })).toEqual({
      specKey: 'H100',
      limit: 2,
    });
    expect(() => definition.argsSchema.parse({ limit: 2 })).toThrow();
  });
});
