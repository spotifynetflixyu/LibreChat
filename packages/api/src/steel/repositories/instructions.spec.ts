import { searchSteelInstructionPackets } from './instructions';

import type { SteelRepositoryClient } from './types';

describe('Steel instruction packet repositories', () => {
  it('searches reviewed active instruction packets by packet groups and maps Admin-editable rule fields', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '21',
          slug: 'c-type-basic-quote-zh-v1',
          version: '1',
          title: 'C 型鋼專用計價規則',
          locale: 'zh-TW',
          packet_groups: ['c-type-quote-core'],
          selectors: {
            catalogFamilies: ['c_type'],
            taskTypes: ['material_price_lookup'],
          },
          instruction: 'C 型鋼仍必須先查 reviewed product-price rows。',
          blocking_rules: ['不要把 C型鋼 當作 productName filter 卡死價格查詢。'],
          required_lookups: ['search_price_candidates', 'lookup_formula'],
          user_visible_notes: ['材質不明時，錏輕型鋼可作高信心暫估候選。'],
          confirmation_questions: ['請確認材質是否為錏輕型鋼。'],
          priority: '90',
          confidence: 'high',
          active: true,
          review_state: 'reviewed',
          source_refs: [
            {
              channel: 'admin_rule',
              factType: 'instruction_packet',
              sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
              locator: 'c-type-basic-quote-zh-v1',
            },
          ],
        },
      ],
    });

    const result = await searchSteelInstructionPackets({ query } as SteelRepositoryClient, {
      packetGroups: ['c-type-quote-core', 'h-type-quote-core'],
      taskTypes: ['material_price_lookup'],
      catalogFamilies: ['c_type'],
      limit: 8,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.instruction_packets'), [
      'reviewed',
      'c-type-quote-core',
      'h-type-quote-core',
      8,
    ]);
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('active = true'));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('packet_groups &&'));
    expect(result).toEqual([
      {
        id: 21,
        slug: 'c-type-basic-quote-zh-v1',
        version: 1,
        title: 'C 型鋼專用計價規則',
        locale: 'zh-TW',
        packetGroups: ['c-type-quote-core'],
        selectors: {
          catalogFamilies: ['c_type'],
          taskTypes: ['material_price_lookup'],
        },
        instruction: 'C 型鋼仍必須先查 reviewed product-price rows。',
        blockingRules: ['不要把 C型鋼 當作 productName filter 卡死價格查詢。'],
        requiredLookups: ['search_price_candidates', 'lookup_formula'],
        userVisibleNotes: ['材質不明時，錏輕型鋼可作高信心暫估候選。'],
        confirmationQuestions: ['請確認材質是否為錏輕型鋼。'],
        priority: 90,
        confidence: 'high',
        active: true,
        reviewState: 'reviewed',
        sourceRefs: [
          {
            channel: 'admin_rule',
            factType: 'instruction_packet',
            sourceFile: 'tasks/steel-data-rules-architecture/instruction-packets.md',
            locator: 'c-type-basic-quote-zh-v1',
          },
        ],
      },
    ]);
  });
});
