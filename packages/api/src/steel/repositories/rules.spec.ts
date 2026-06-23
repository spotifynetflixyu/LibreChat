import {
  listReviewedSteelAgentRules,
  listReviewedSteelOtherRules,
  listReviewedSteelOutputRules,
  listReviewedSteelQuoteRules,
} from './rules';

import type { SteelRepositoryClient } from './types';

const agentRuleRow = {
  id: '1',
  slug: 'steel-default-agent-instruction',
  version: '1',
  rule_kind: 'agent',
  title: 'Steel default agent instruction',
  locale: 'zh-TW',
  rule_sections: ['agent_instruction'],
  selectors: { appliesTo: ['steel_quote_runtime'], confidence: 'high' },
  prompt: 'Fixture agent instruction',
  tool_policy: { availableTools: ['search_customers'] },
  output_policy: null,
  priority: '10',
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
  slug: 'steel_quote_rules_plate',
  version: '1',
  rule_kind: 'steel',
  title: 'Steel plate rule',
  locale: 'zh-TW',
  rule_sections: ['steel_quote_rule', 'plate_weight_processing'],
  selectors: {
    ruleType: 'formula_rule',
    scopeType: 'catalog_family',
    catalogFamily: 'plate',
    productFamily: 'laser_cut',
    chargeType: 'cutting',
    formulaCode: 'PL',
    confidence: 'high',
  },
  tool_policy: { density: 7.85 },
  output_policy: {},
  prompt: 'Fixture quote rule',
  priority: '40',
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

const outputRuleRow = {
  ...agentRuleRow,
  id: '2',
  slug: 'steel-workbook-output-policy',
  rule_kind: 'output',
  title: 'Steel workbook output policy',
  rule_sections: ['workbook_output'],
  priority: '20',
};

const otherRuleRow = {
  ...agentRuleRow,
  id: '3',
  slug: 'steel-drawing-ocr-policy',
  rule_kind: 'other',
  title: 'Steel OCR policy',
  rule_sections: ['file_ocr', 'drawing_ocr'],
  priority: '30',
};

describe('Steel agent and quote rule repositories', () => {
  it('lists reviewed active agent rules without output or other rules', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [agentRuleRow] });

    const result = await listReviewedSteelAgentRules({ query } as SteelRepositoryClient);
    const sql = query.mock.calls[0]?.[0];

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.rules'), [
      'reviewed',
      'agent',
    ]);
    expect(sql).toEqual(expect.stringContaining('active = true'));
    expect(sql).toEqual(expect.stringContaining('rule_kind = $2'));
    expect(sql).not.toEqual(expect.stringContaining('LIMIT'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(
      {
        id: 1,
        slug: 'steel-default-agent-instruction',
        version: 1,
        ruleType: 'agent',
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
    );
  });

  it('lists reviewed active output rules separately from agent and other rules', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [outputRuleRow] });

    const result = await listReviewedSteelOutputRules({ query } as SteelRepositoryClient);
    const sql = query.mock.calls[0]?.[0];

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.rules'), [
      'reviewed',
      'output',
    ]);
    expect(sql).toEqual(expect.stringContaining('rule_kind = $2'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 2,
      slug: 'steel-workbook-output-policy',
      ruleType: 'output',
      ruleSections: ['workbook_output'],
    });
  });

  it('lists reviewed active other rules separately for conditional context', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [otherRuleRow] });

    const result = await listReviewedSteelOtherRules({ query } as SteelRepositoryClient);
    const sql = query.mock.calls[0]?.[0];

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.rules'), [
      'reviewed',
      'other',
    ]);
    expect(sql).toEqual(expect.stringContaining('rule_kind = $2'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 3,
      slug: 'steel-drawing-ocr-policy',
      ruleType: 'other',
      ruleSections: ['file_ocr', 'drawing_ocr'],
    });
  });

  it('lists all reviewed active quote rules without keyword, scope, facet, or limit filters', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [quoteRuleRow] });

    const result = await listReviewedSteelQuoteRules({ query } as SteelRepositoryClient);
    const sql = query.mock.calls[0]?.[0];

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.rules'), [
      'reviewed',
    ]);
    expect(sql).toEqual(expect.stringContaining('active = true'));
    expect(sql).toEqual(expect.stringContaining("rule_kind = 'steel'"));
    expect(sql).not.toEqual(expect.stringContaining('ILIKE'));
    expect(sql).not.toEqual(expect.stringContaining('ANY($'));
    expect(sql).not.toEqual(expect.stringContaining('LIMIT'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(
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
    );
  });
});
