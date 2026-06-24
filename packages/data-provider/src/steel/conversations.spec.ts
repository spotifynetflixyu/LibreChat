import {
  steelAuthenticatedConversationRequestSchema,
  steelConversationMessageRequestSchema,
  steelConversationMessagesResponseSchema,
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
        workbookId: 'legacy_workbook_id',
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      }),
    ).toEqual(
      {
        id: 'steel_meta_1',
        libreChatConversationId: 'lc_guest_1',
        createdFrom: 'guest',
        guestToken: 'raw-token-only-on-create',
        guestTokenIssued: true,
        status: 'active',
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      },
    );
  });

  it('does not expose workbook refs in conversation message requests', () => {
    expect(
      steelConversationMessageRequestSchema.parse({
        conversationId: 'steel_meta_1',
        message: '請報價',
        selectedWorkbookRefs: [
          {
            workbookId: 'wb_1',
            workbookVersion: 1,
            sheetId: 'system_order',
            rowId: 'row_1',
            columnKey: 'item',
          },
        ],
      }),
    ).toEqual({
      conversationId: 'steel_meta_1',
      message: '請報價',
    });
  });

  it('validates Steel active conversation messages for browser reload', () => {
    expect(
      steelConversationMessagesResponseSchema.parse({
        conversationId: 'steel-chat-1',
        messages: [
          {
            messageId: 'user-1',
            role: 'user',
            content: '上一輪報價',
            attachments: [
              {
                fileId: 'file-1',
                filename: 'PL.pdf',
                mediaType: 'application/pdf',
              },
            ],
            createdAt: '2026-06-24T00:00:00.000Z',
            updatedAt: '2026-06-24T00:00:00.000Z',
          },
          {
            messageId: 'assistant-1',
            role: 'assistant',
            content: '| 項次 | 型號 |\n| --- | --- |\n| 1 | CCG075 |',
            createdAt: '2026-06-24T00:00:01.000Z',
            updatedAt: '2026-06-24T00:00:01.000Z',
          },
        ],
      }),
    ).toEqual({
      conversationId: 'steel-chat-1',
      messages: [
        {
          messageId: 'user-1',
          role: 'user',
          content: '上一輪報價',
          attachments: [
            {
              fileId: 'file-1',
              filename: 'PL.pdf',
              mediaType: 'application/pdf',
            },
          ],
          createdAt: '2026-06-24T00:00:00.000Z',
          updatedAt: '2026-06-24T00:00:00.000Z',
        },
        {
          messageId: 'assistant-1',
          role: 'assistant',
          content: '| 項次 | 型號 |\n| --- | --- |\n| 1 | CCG075 |',
          createdAt: '2026-06-24T00:00:01.000Z',
          updatedAt: '2026-06-24T00:00:01.000Z',
        },
      ],
    });
  });
});
