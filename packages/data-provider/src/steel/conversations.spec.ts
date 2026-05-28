import {
  steelAuthenticatedConversationRequestSchema,
  steelConversationReadResponseSchema,
  steelGuestConversationRequestSchema,
} from './conversations';

describe('Steel conversation public contracts', () => {
  it('validates authenticated conversation creation requests', () => {
    expect(
      steelAuthenticatedConversationRequestSchema.parse({
        libreChatConversationId: 'lc_1',
      }),
    ).toEqual({
      libreChatConversationId: 'lc_1',
    });
  });

  it('validates guest conversation creation requests and one-time token responses', () => {
    expect(
      steelGuestConversationRequestSchema.parse({
        libreChatConversationId: 'lc_guest_1',
      }),
    ).toEqual({
      libreChatConversationId: 'lc_guest_1',
    });

    expect(
      steelConversationReadResponseSchema.parse({
        id: 'steel_meta_1',
        libreChatConversationId: 'lc_guest_1',
        createdFrom: 'guest',
        status: 'active',
        guestTokenIssued: true,
        guestToken: 'raw-token-only-on-create',
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      }),
    ).toEqual(
      expect.objectContaining({
        createdFrom: 'guest',
        guestToken: 'raw-token-only-on-create',
        guestTokenIssued: true,
      }),
    );
  });
});
