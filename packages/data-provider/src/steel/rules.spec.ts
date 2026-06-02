import { steelRuleProposalCreateRequestSchema, steelRuleProposalResponseSchema } from './rules';

const sourceRef = {
  channel: 'conversation',
  factType: 'quote_override',
  sourceFile: 'conversation:steel_meta_1',
  locator: 'message:m_1',
  confidence: 'high',
  canonicalKey: 'cutting.unitPrice',
};

describe('Steel rule proposal public contracts', () => {
  it('accepts a complete customer default proposal create payload', () => {
    const parsed = steelRuleProposalCreateRequestSchema.parse({
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
        specification: 'C100x50',
        workType: 'cutting',
      },
      proposedDefaultParameters: [
        {
          key: 'unitPrice',
          value: 0,
          valueType: 'number',
          unit: 'TWD',
        },
      ],
      sourceRefs: [sourceRef],
      createdFromConversationId: 'steel_meta_1',
      createdFromWorkbookLineId: 'line_1',
      reason: 'Customer asked to make C-type cutting free for future quotes.',
      confidence: 'high',
    });

    expect(parsed.proposedDefaultParameters[0]).toEqual({
      key: 'unitPrice',
      value: 0,
      valueType: 'number',
      unit: 'TWD',
    });
  });

  it('rejects missing proposal evidence, parameters, and customer scope', () => {
    expect(() =>
      steelRuleProposalCreateRequestSchema.parse({
        proposalType: 'customer_default',
        scopeType: 'customer',
        chargeType: 'cutting',
        formulaCode: 'C_TYPE_FINISHED_LENGTH',
        selector: { materialFamily: 'c_channel' },
        proposedDefaultParameters: [],
        sourceRefs: [],
        createdFromConversationId: 'steel_meta_1',
        reason: 'missing required evidence',
        confidence: 'high',
      }),
    ).toThrow();
  });

  it('does not accept client-supplied review status fields on create', () => {
    expect(() =>
      steelRuleProposalCreateRequestSchema.parse({
        proposalType: 'customer_default',
        scopeType: 'customer',
        customerId: 'cust_1',
        chargeType: 'cutting',
        formulaCode: 'C_TYPE_FINISHED_LENGTH',
        selector: { materialFamily: 'c_channel' },
        proposedDefaultParameters: [{ key: 'unitPrice', value: 0, valueType: 'number' }],
        sourceRefs: [sourceRef],
        createdFromConversationId: 'steel_meta_1',
        reason: 'status cannot be client-owned',
        confidence: 'high',
        status: 'reviewed',
      }),
    ).toThrow();
  });

  it('serializes pending proposal responses for browser use', () => {
    const parsed = steelRuleProposalResponseSchema.parse({
      id: 'proposal_1',
      proposalType: 'customer_default',
      status: 'needs_review',
      scopeType: 'customer',
      customerId: 'cust_1',
      chargeType: 'cutting',
      formulaCode: 'C_TYPE_FINISHED_LENGTH',
      selector: { materialFamily: 'c_channel' },
      proposedDefaultParameters: [{ key: 'unitPrice', value: 0, valueType: 'number' }],
      sourceRefs: [sourceRef],
      createdFromConversationId: 'steel_meta_1',
      createdByUserId: 'user_1',
      reason: 'Pending Admin review.',
      confidence: 'high',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
    });

    expect(parsed.status).toBe('needs_review');
    expect(JSON.stringify(parsed)).not.toMatch(/access_token|authorization|raw/i);
  });
});
