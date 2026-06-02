import { createSteelRuleProposalService, SteelRuleProposalValidationError } from './service';

import type { SteelRuleProposalRepository } from './service';

const sourceRef = {
  channel: 'conversation',
  factType: 'quote_override',
  sourceFile: 'conversation:steel_meta_1',
  locator: 'message:m_1',
  confidence: 'high',
};

function createRepository(): SteelRuleProposalRepository & {
  create: jest.MockedFunction<SteelRuleProposalRepository['create']>;
} {
  return {
    create: jest.fn(async (record) => ({
      ...record,
      id: 'proposal_1',
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    })),
  };
}

describe('createSteelRuleProposalService', () => {
  it('creates only needs_review proposals owned by the authenticated user', async () => {
    const repository = createRepository();
    const service = createSteelRuleProposalService({ repository });

    const result = await service.create({
      body: {
        proposalType: 'customer_default',
        scopeType: 'customer',
        customerId: 'cust_1',
        materialFamily: 'c_channel',
        productFamily: 'c_type_steel',
        chargeType: 'cutting',
        formulaCode: 'C_TYPE_FINISHED_LENGTH',
        selector: {
          materialFamily: 'c_channel',
          productFamily: 'c_type_steel',
          workType: 'cutting',
        },
        proposedDefaultParameters: [{ key: 'unitPrice', value: 0, valueType: 'number' }],
        sourceRefs: [sourceRef],
        createdFromConversationId: 'steel_meta_1',
        createdFromWorkbookLineId: 'line_1',
        reason: 'Make this customer C-type cutting free by default.',
        confidence: 'high',
      },
      user: { id: 'user_1' },
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'needs_review',
        createdByUserId: 'user_1',
        reviewedByUserId: undefined,
        reviewedAt: undefined,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'proposal_1',
        status: 'needs_review',
        createdByUserId: 'user_1',
        createdAt: '2026-06-02T00:00:00.000Z',
      }),
    );
  });

  it('rejects missing authenticated users and malformed proposal bodies', async () => {
    const repository = createRepository();
    const service = createSteelRuleProposalService({ repository });

    await expect(
      service.create({
        body: {
          proposalType: 'customer_default',
          scopeType: 'customer',
          chargeType: 'cutting',
          formulaCode: 'C_TYPE_FINISHED_LENGTH',
          selector: { materialFamily: 'c_channel' },
          proposedDefaultParameters: [{ key: 'unitPrice', value: 0, valueType: 'number' }],
          sourceRefs: [sourceRef],
          createdFromConversationId: 'steel_meta_1',
          reason: 'Missing customerId.',
          confidence: 'high',
        },
        user: { id: 'user_1' },
      }),
    ).rejects.toBeInstanceOf(SteelRuleProposalValidationError);

    await expect(
      service.create({
        body: {},
        user: null,
      }),
    ).rejects.toBeInstanceOf(SteelRuleProposalValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });
});
