import { listReviewedSteelInstructionPackets, searchSteelInstructionPackets } from './instructions';

import type { SteelRepositoryClient } from './types';

const instructionPacketRow = {
  id: '11',
  slug: 'plate-runtime-packet',
  version: '1',
  title: 'Plate runtime packet',
  locale: 'zh-TW',
  packet_groups: ['quote_rules', 'plate'],
  selectors: { catalogFamily: 'plate' },
  instruction: 'Fixture instruction packet',
  blocking_rules: [],
  required_lookups: [],
  user_visible_notes: [],
  confirmation_questions: [],
  priority: '20',
  confidence: 'high',
  active: true,
  review_state: 'reviewed',
};

describe('Steel instruction packet repositories', () => {
  it('lists all reviewed active instruction packets without keyword filters or limit', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [instructionPacketRow] });

    const result = await listReviewedSteelInstructionPackets({
      query,
    } as SteelRepositoryClient);
    const sql = query.mock.calls[0]?.[0];

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.instruction_packets'), [
      'reviewed',
    ]);
    expect(sql).toEqual(expect.stringContaining('active = true'));
    expect(sql).not.toMatch(/review_state,\s*FROM/u);
    expect(sql).not.toEqual(expect.stringContaining('ILIKE'));
    expect(sql).not.toEqual(expect.stringContaining('LIMIT'));
    expect(result).toEqual([
      {
        id: 11,
        slug: 'plate-runtime-packet',
        version: 1,
        title: 'Plate runtime packet',
        locale: 'zh-TW',
        packetGroups: ['quote_rules', 'plate'],
        selectors: { catalogFamily: 'plate' },
        instruction: 'Fixture instruction packet',
        blockingRules: [],
        requiredLookups: [],
        userVisibleNotes: [],
        confirmationQuestions: [],
        priority: 20,
        confidence: 'high',
        active: true,
        reviewState: 'reviewed',
      },
    ]);
  });

  it('keeps keyword search available for tool/admin paths', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [instructionPacketRow] });

    await searchSteelInstructionPackets({ query } as SteelRepositoryClient, {
      keywords: ['plate'],
      limit: 5,
    });
    const sql = query.mock.calls[0]?.[0];

    expect(sql).toEqual(expect.stringContaining('ILIKE'));
    expect(sql).not.toMatch(/review_state,\s*FROM/u);
    expect(sql).toEqual(expect.stringContaining('LIMIT'));
  });
});
