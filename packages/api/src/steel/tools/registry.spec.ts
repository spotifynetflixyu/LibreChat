import { getSteelToolDefinition, getSteelToolDefinitions } from './registry';

describe('Steel tool registry', () => {
  it('exposes only provider-neutral business tools', () => {
    const toolNames = getSteelToolDefinitions().map((definition) => definition.name);

    expect(toolNames).toEqual([
      'lookup_instructions',
      'lookup_quote_rules',
      'lookup_catalog_families',
      'lookup_defaults',
      'lookup_formula',
      'search_customers',
      'search_price_candidates',
    ]);
    expect(toolNames).not.toContain('normalize_quote_item');
    expect(toolNames).not.toContain('generate_price_search_terms');
    expect(toolNames).not.toContain('rank_price_candidates');
    expect(toolNames).not.toContain('raw_sql');
    expect(toolNames).not.toContain('read_file');
  });

  it('keeps Zod validation owned by the backend registry', () => {
    const definition = getSteelToolDefinition('search_price_candidates');

    expect(definition.argsSchema.parse({ productName: 'C型鋼', limit: 2 })).toEqual({
      productName: 'C型鋼',
      limit: 2,
    });
    expect(() => definition.argsSchema.parse({ limit: 2 })).toThrow();
  });

  it('requires a search text or explicit keys for catalog-family vocabulary lookup', () => {
    const definition = getSteelToolDefinition('lookup_catalog_families');

    expect(definition.argsSchema.parse({ searchText: 'H鋼', limit: 5 })).toEqual({
      searchText: 'H鋼',
      limit: 5,
    });
    expect(definition.argsSchema.parse({ keys: ['h_beam'] })).toEqual({
      keys: ['h_beam'],
    });
    expect(() => definition.argsSchema.parse({ limit: 5 })).toThrow();
  });
});
