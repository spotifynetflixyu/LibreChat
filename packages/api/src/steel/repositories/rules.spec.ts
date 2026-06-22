import { listReviewedSteelAgentRules, listReviewedSteelQuoteRules } from './rules';

import type { SteelRepositoryClient } from './types';

const agentRuleRow = {
  id: '1',
  slug: 'steel-default-agent-instruction',
  version: '1',
  rule_type: 'agent_instruction_rule',
  title: 'Steel default agent instruction',
  locale: 'zh-TW',
  rule_sections: ['agent_instruction'],
  sheet_id: null,
  selectors: { appliesTo: ['steel_quote_runtime'] },
  prompt: 'Fixture agent instruction',
  tool_policy: { availableTools: ['search_customers'] },
  output_policy: null,
  priority: '10',
  confidence: 'high',
  active: true,
  review_state: 'reviewed',
  source_refs: [
    {
      channel: 'repo_docs',
      factType: 'agent_rule',
      canonicalKey: 'steel_default_agent_instruction',
    },
  ],
};

const quoteRuleRow = {
  id: '31',
  rule_type: 'formula_rule',
  scope_type: 'catalog_family',
  catalog_family: 'plate',
  product_family: 'laser_cut',
  charge_type: 'cutting',
  formula_code: 'PL',
  selectors: { catalogFamily: 'plate' },
  parameters: { density: 7.85 },
  prompt: 'Fixture quote rule',
  priority: '40',
  confidence: 'high',
  active: true,
  review_state: 'reviewed',
  source_refs: [
    {
      channel: 'repo_docs',
      factType: 'quote_rule',
      canonicalKey: 'plate_laser_cut_formula',
    },
  ],
};

describe('Steel agent and quote rule repositories', () => {
  it('lists all reviewed active agent rules without section filters or limit', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [agentRuleRow] });

    const result = await listReviewedSteelAgentRules({ query } as SteelRepositoryClient);
    const sql = query.mock.calls[0]?.[0];

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.agent_rules'), [
      'reviewed',
    ]);
    expect(sql).toEqual(expect.stringContaining('active = true'));
    expect(sql).not.toEqual(expect.stringContaining('rule_sections &&'));
    expect(sql).not.toEqual(expect.stringContaining('rule_type = ANY'));
    expect(sql).not.toEqual(expect.stringContaining('LIMIT'));
    expect(result).toEqual([
      {
        id: 1,
        slug: 'steel-default-agent-instruction',
        version: 1,
        ruleType: 'agent_instruction_rule',
        title: 'Steel default agent instruction',
        locale: 'zh-TW',
        ruleSections: ['agent_instruction'],
        sheetId: undefined,
        selectors: { appliesTo: ['steel_quote_runtime'] },
        prompt: 'Fixture agent instruction',
        toolPolicy: { availableTools: ['search_customers'] },
        outputPolicy: null,
        priority: 10,
        confidence: 'high',
        active: true,
        reviewState: 'reviewed',
        sourceRefs: [
          {
            channel: 'repo_docs',
            factType: 'agent_rule',
            canonicalKey: 'steel_default_agent_instruction',
          },
        ],
      },
    ]);
  });

  it('lists all reviewed active quote rules without keyword, scope, facet, or limit filters', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [quoteRuleRow] });

    const result = await listReviewedSteelQuoteRules({ query } as SteelRepositoryClient);
    const sql = query.mock.calls[0]?.[0];

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.quote_rules'), [
      'reviewed',
    ]);
    expect(sql).toEqual(expect.stringContaining('active = true'));
    expect(sql).not.toEqual(expect.stringContaining('ILIKE'));
    expect(sql).not.toEqual(expect.stringContaining("scope_type = 'company'"));
    expect(sql).not.toEqual(expect.stringContaining('ANY($'));
    expect(sql).not.toEqual(expect.stringContaining('LIMIT'));
    expect(result).toEqual([
      {
        id: 31,
        ruleType: 'formula_rule',
        scopeType: 'catalog_family',
        catalogFamily: 'plate',
        productFamily: 'laser_cut',
        chargeType: 'cutting',
        formulaCode: 'PL',
        selectors: { catalogFamily: 'plate' },
        parameters: { density: 7.85 },
        prompt: 'Fixture quote rule',
        priority: 40,
        confidence: 'high',
        active: true,
        reviewState: 'reviewed',
        sourceRefs: [
          {
            channel: 'repo_docs',
            factType: 'quote_rule',
            canonicalKey: 'plate_laser_cut_formula',
          },
        ],
      },
    ]);
  });
});
