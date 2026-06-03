import { searchSteelQuoteDefaults } from './defaults';

import type { SteelRepositoryClient } from './types';

describe('Steel quote default repositories', () => {
  it('searches reviewed active quote defaults by batched material, charge, and formula facets', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '55',
          default_type: 'true_zero_rule',
          origin_table: 'tasks/steel-data-rules-architecture/instruction-packets.md',
          origin_id: 'c-type-free-cutting-hole-v1',
          origin_revision: '1',
          scope_type: 'material_family',
          customer_id: null,
          customer_tier_id: null,
          material_family: 'c_type',
          product_family: null,
          charge_type: null,
          formula_code: 'C',
          selector: { materialFamily: 'c_type', chargeTypes: ['cutting', 'hole'] },
          effect: 'true_zero_rule',
          default_parameters: [
            {
              parameterKey: 'instruction',
              value: 'C 型鋼切工與孔費預設免費',
            },
          ],
          priority: '10',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'repo_docs',
              factType: 'quote_default',
              sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
              locator: 'c-type-basic-quote-zh-v1',
              canonicalKey: 'c_type_free_cutting_hole',
            },
          ],
        },
      ],
    });

    const result = await searchSteelQuoteDefaults({ query } as SteelRepositoryClient, {
      materialFamilies: ['angle', 'c_type'],
      chargeTypes: ['cutting', 'hole'],
      formulaCodes: ['C'],
      limit: 10,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.quote_defaults'), [
      'reviewed',
      'angle',
      'c_type',
      'cutting',
      'hole',
      'C',
      10,
    ]);
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('active = true'));
    expect(result).toEqual([
      {
        id: 55,
        defaultType: 'true_zero_rule',
        originTable: 'tasks/steel-data-rules-architecture/instruction-packets.md',
        originId: 'c-type-free-cutting-hole-v1',
        originRevision: '1',
        scopeType: 'material_family',
        customerId: null,
        customerTierId: null,
        materialFamily: 'c_type',
        productFamily: undefined,
        chargeType: undefined,
        formulaCode: 'C',
        selector: { materialFamily: 'c_type', chargeTypes: ['cutting', 'hole'] },
        effect: 'true_zero_rule',
        defaultParameters: [
          {
            parameterKey: 'instruction',
            value: 'C 型鋼切工與孔費預設免費',
          },
        ],
        priority: 10,
        confidence: 'high',
        active: true,
        reviewState: 'reviewed',
        sourceRefs: [
          {
            channel: 'repo_docs',
            factType: 'quote_default',
            sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
            locator: 'c-type-basic-quote-zh-v1',
            canonicalKey: 'c_type_free_cutting_hole',
          },
        ],
      },
    ]);
  });
});
