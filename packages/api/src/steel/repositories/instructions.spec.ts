import { searchSteelInstructionPackets } from './instructions';

import type { SteelRepositoryClient } from './types';

function fixtureText(key: string) {
  return `fixture:${key}`;
}

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
          instruction: fixtureText('instruction'),
          blocking_rules: [fixtureText('blocking-rule')],
          required_lookups: ['search_price_candidates', 'lookup_formula'],
          user_visible_notes: [fixtureText('user-visible-note')],
          confirmation_questions: [fixtureText('confirmation-question')],
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
        instruction: fixtureText('instruction'),
        blockingRules: [fixtureText('blocking-rule')],
        requiredLookups: ['search_price_candidates', 'lookup_formula'],
        userVisibleNotes: [fixtureText('user-visible-note')],
        confirmationQuestions: [fixtureText('confirmation-question')],
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
