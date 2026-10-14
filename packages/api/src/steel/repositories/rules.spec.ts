import { listReviewedSteelRules } from './rules';

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
  it('loads every reviewed active rule kind in one unfiltered query', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await listReviewedSteelRules({ query } as SteelRepositoryClient);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(values).toEqual(['reviewed', ['agent', 'output', 'other', 'steel']]);
    expect(sql).toEqual(expect.stringContaining('FROM steel.rules'));
    expect(sql).toEqual(expect.stringContaining('active = true'));
    expect(sql).toEqual(expect.stringContaining('rule_kind = ANY($2::text[])'));
    expect(sql).not.toMatch(/review_state,\s*FROM/u);
    expect(sql).not.toEqual(expect.stringContaining('ILIKE'));
    expect(sql).not.toEqual(expect.stringContaining('LIMIT'));
  });

  it('partitions rows by rule kind and maps agent and quote rule fields', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [agentRuleRow, outputRuleRow, otherRuleRow, quoteRuleRow],
    });

    const result = await listReviewedSteelRules({ query } as SteelRepositoryClient);

    expect(result.agentRules).toHaveLength(1);
    expect(result.agentRules[0]).toMatchObject({
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
    });
    expect(result.outputRules).toEqual([
      expect.objectContaining({ id: 2, ruleType: 'output', ruleSections: ['workbook_output'] }),
    ]);
    expect(result.otherRules).toEqual([
      expect.objectContaining({ id: 3, ruleType: 'other', ruleSections: ['file_ocr', 'drawing_ocr'] }),
    ]);
    expect(result.quoteRules).toEqual([
      expect.objectContaining({
        id: 31,
        ruleType: 'formula_rule',
        scopeType: 'catalog_family',
        catalogFamily: 'plate',
        productFamily: 'laser_cut',
        chargeType: 'cutting',
        formulaCode: 'PL',
        selectors: expect.objectContaining({ catalogFamily: 'plate' }),
        parameters: { density: 7.85 },
        prompt: 'Fixture quote rule',
        priority: 40,
        confidence: 'high',
        active: true,
        reviewState: 'reviewed',
      }),
    ]);
  });
});
