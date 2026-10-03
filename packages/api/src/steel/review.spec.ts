import { createSteelReviewService } from './review';

const managedMarkdown = [
  '## ocr_result',
  '',
  '| 來源 | 零件編號 |',
  '| --- | --- |',
  '| A | P-1 |',
].join('\n');

describe('Steel review read service', () => {
  it('projects the requested table from the authenticated message identity', async () => {
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result',
          messageId: 'message-1',
          tableId: 'ocr_result:2',
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current',
          markdown: managedMarkdown,
          messageText: [
            '| ordinary | table |',
            '| --- | --- |',
            '| ignored | row |',
            '',
            managedMarkdown,
          ].join('\n'),
        }),
      },
    });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:2',
    })).resolves.toEqual({
      table: expect.objectContaining({
        tableId: 'ocr_result:2',
        outputId: 'ocr_result:generation-1',
        isLatest: true,
        readOnly: false,
        rows: [expect.objectContaining({ rowId: expect.any(String) })],
      }),
    });
  });

  it('rejects a same-heading table that is absent from the trusted canonical output', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: managedMarkdown,
        messageText: [
          '## ocr_result',
          '',
          '| 來源 | 零件編號 |',
          '| --- | --- |',
          '| attacker | fake |',
        ].join('\n'),
      }),
    };
    const service = createSteelReviewService({ reader });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects both identical canonical table copies as ambiguous', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: managedMarkdown,
        messageText: `${managedMarkdown}\n\n${managedMarkdown}`,
      }),
    };
    const service = createSteelReviewService({ reader });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });
});
