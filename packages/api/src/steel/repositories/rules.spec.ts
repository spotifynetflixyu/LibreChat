import {
  searchSteelAgentRules,
  searchSteelCatalogFamilyRules,
  searchSteelCustomerRules,
  searchSteelQuoteRules,
} from './rules';

import type { SteelRepositoryClient, SteelSqlParameter } from './types';

interface QueryCall {
  sql: string;
  values?: readonly SteelSqlParameter[];
}

function createClient(rows: object[]): SteelRepositoryClient & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];

  return {
    calls,
    query: async <Row extends object>(
      sql: string,
      values?: readonly SteelSqlParameter[],
    ): Promise<{ rows: Row[] }> => {
      calls.push({ sql, values });
      return { rows: rows as Row[] };
    },
  };
}

function fixtureText(key: string) {
  return `fixture:${key}`;
}

describe('Steel rule repositories', () => {
  it('searches process and workbook output rules from agent_rules', async () => {
    const client = createClient([
      {
        id: '1',
        slug: 'default-agent-instruction',
        version: '1',
        rule_type: 'agent_instruction_rule',
        title: 'Default Agent Instruction',
        locale: 'zh-TW',
        rule_sections: ['tool_flow', 'workbook_output'],
        sheet_id: null,
        selectors: { route: '/steel/oauth-chat' },
        prompt: fixtureText('agent-rule-prompt'),
        tool_policy: { firstLookup: 'lookup_catalog_families' },
        output_policy: { workbookTool: 'patch_quote_workbook' },
        priority: '5',
        confidence: 'high',
        active: true,
        review_state: 'reviewed',
        source_refs: [
          {
            channel: 'admin_table_ui',
            factType: 'agent_rule',
            locator: 'steel.agent_rules:1',
          },
        ],
      },
    ]);

    const result = await searchSteelAgentRules(client, {
      ruleSections: ['tool_flow', 'workbook_output'],
      sheetIds: ['quote_details'],
      limit: 10,
    });

    expect(client.calls[0]?.sql).toContain('FROM steel.agent_rules');
    expect(client.calls[0]?.values).toEqual([
      'reviewed',
      ['tool_flow', 'workbook_output'],
      ['quote_details'],
      10,
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        id: 1,
        slug: 'default-agent-instruction',
        ruleType: 'agent_instruction_rule',
        ruleSections: ['tool_flow', 'workbook_output'],
        sheetId: undefined,
        prompt: fixtureText('agent-rule-prompt'),
        toolPolicy: { firstLookup: 'lookup_catalog_families' },
        outputPolicy: { workbookTool: 'patch_quote_workbook' },
      }),
    ]);
  });

  it('searches product-name inference rules for catalog-family lookup', async () => {
    const client = createClient([
      {
        id: '7',
        rule_type: 'similar_product_name_rule',
        catalog_family: 'angle',
        product_name: '錏角鐵',
        product_names: ['錏角鐵', '錏成型角鐵'],
        aliases: ['亞L30x30', 'L30x30'],
        selectors: { searchText: '亞L30x30' },
        prompt: fixtureText('catalog-family-rule-prompt'),
        priority: '10',
        confidence: 'medium',
        active: true,
        review_state: 'reviewed',
        source_refs: [
          {
            channel: 'admin_table_ui',
            factType: 'catalog_family_rule',
            locator: 'steel.catalog_family_rules:7',
          },
        ],
      },
    ]);

    const result = await searchSteelCatalogFamilyRules(client, {
      searchText: '亞L30x30',
      catalogFamilies: ['angle'],
      productNames: ['錏角鐵'],
      limit: 10,
    });

    expect(client.calls[0]?.sql).toContain('FROM steel.catalog_family_rules');
    expect(client.calls[0]?.values).toEqual(['reviewed', ['angle'], ['錏角鐵'], '%亞L30x30%', 10]);
    expect(result).toEqual([
      expect.objectContaining({
        id: 7,
        ruleType: 'similar_product_name_rule',
        catalogFamily: 'angle',
        productName: '錏角鐵',
        productNames: ['錏角鐵', '錏成型角鐵'],
        aliases: ['亞L30x30', 'L30x30'],
        prompt: fixtureText('catalog-family-rule-prompt'),
      }),
    ]);
  });

  it('searches quote rules by catalog, charge, and formula facets', async () => {
    const client = createClient([
      {
        id: '12',
        rule_type: 'calculation_rule',
        scope_type: 'catalog_family',
        catalog_family: 'c_type',
        product_family: null,
        charge_type: 'cutting',
        formula_code: 'C',
        selectors: { processingTypes: ['cutting', 'hole'] },
        parameters: [{ parameterKey: 'charge', value: 'free' }],
        prompt: fixtureText('quote-rule-prompt'),
        priority: '15',
        confidence: 'high',
        active: true,
        review_state: 'reviewed',
        source_refs: [
          {
            channel: 'admin_table_ui',
            factType: 'quote_rule',
            locator: 'steel.quote_rules:12',
          },
        ],
      },
    ]);

    const result = await searchSteelQuoteRules(client, {
      catalogFamilies: ['c_type'],
      chargeTypes: ['cutting', 'hole'],
      formulaCodes: ['C'],
      limit: 10,
    });

    expect(client.calls[0]?.sql).toContain('FROM steel.quote_rules');
    expect(client.calls[0]?.values).toEqual([
      'reviewed',
      ['c_type'],
      ['cutting', 'hole'],
      ['C'],
      10,
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        id: 12,
        ruleType: 'calculation_rule',
        scopeType: 'catalog_family',
        catalogFamily: 'c_type',
        chargeType: 'cutting',
        formulaCode: 'C',
        prompt: fixtureText('quote-rule-prompt'),
      }),
    ]);
  });

  it('searches customer-specific rules by customer and tier', async () => {
    const client = createClient([
      {
        id: '21',
        rule_type: 'customer_spec_rule',
        customer_id: '10',
        customer_tier_id: '2',
        catalog_family: 'h_beam',
        product_family: null,
        charge_type: 'cutting',
        formula_code: null,
        selectors: { spec: 'H 型鋼' },
        parameters: [],
        prompt: fixtureText('customer-rule-prompt'),
        priority: '5',
        confidence: 'high',
        active: true,
        review_state: 'reviewed',
        source_refs: [
          {
            channel: 'admin_table_ui',
            factType: 'customer_rule',
            locator: 'steel.customer_rules:21',
          },
        ],
      },
    ]);

    const result = await searchSteelCustomerRules(client, {
      customerIds: [10],
      customerTierIds: [2],
      catalogFamilies: ['h_beam'],
      limit: 20,
    });

    expect(client.calls[0]?.sql).toContain('FROM steel.customer_rules');
    expect(client.calls[0]?.values).toEqual(['reviewed', [10], [2], ['h_beam'], 20]);
    expect(result).toEqual([
      expect.objectContaining({
        id: 21,
        ruleType: 'customer_spec_rule',
        customerId: 10,
        customerTierId: 2,
        catalogFamily: 'h_beam',
        prompt: fixtureText('customer-rule-prompt'),
      }),
    ]);
  });
});
