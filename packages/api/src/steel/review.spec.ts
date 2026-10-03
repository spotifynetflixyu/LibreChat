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

  it('requires a sidecar to match one actual managed table in the owned message', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'review-output-1',
        revision: 'review-revision-1',
        state: 'current' as const,
        headers: ['來源', '零件編號'],
        rows: [{
          rowId: 'row-1',
          values: {
            來源: { baseline: 'A', effective: 'A' },
            零件編號: { baseline: 'P-1', effective: 'P-1' },
          },
          source: null,
        }],
        messageText: [
          '## ocr_result',
          '',
          '| 來源 | 零件編號 |',
          '| --- | --- |',
          '| A | OTHER |',
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
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });

    reader.readSteelReview.mockResolvedValueOnce({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'review-output-1',
      revision: 'review-revision-1',
      state: 'current' as const,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
      messageText: `${managedMarkdown}\n\n${managedMarkdown}`,
    });
    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });

    reader.readSteelReview.mockResolvedValueOnce({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'review-output-1',
      revision: 'review-revision-1',
      state: 'current' as const,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
      messageText: `\`\`\`markdown\n${managedMarkdown}\n\`\`\``,
    });
    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });

    reader.readSteelReview.mockResolvedValueOnce({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'review-output-1',
      revision: 'review-revision-1',
      state: 'current' as const,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
      messageText: managedMarkdown,
    });
    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).resolves.toEqual({ table: expect.objectContaining({ outputId: 'review-output-1' }) });
  });

  it('keeps a trusted managed table readable when it has no rows', async () => {
    const emptyMarkdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
    ].join('\n');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result' as const,
          messageId: 'message-1',
          tableId: 'ocr_result:1',
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current' as const,
          markdown: emptyMarkdown,
          messageText: emptyMarkdown,
        }),
      },
    });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).resolves.toEqual({ table: expect.objectContaining({ rows: [], readOnly: false }) });
  });

  it('uses the authenticated content part when multiple rendered parts share a message', async () => {
    const firstPart = '| ordinary | table |\n| --- | --- |\n| keep | this |';
    const secondPart = managedMarkdown;
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result' as const,
          messageId: 'message-1',
          tableId: 'ocr_result:2',
          partIndex: 1,
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current' as const,
          markdown: managedMarkdown,
          messageText: secondPart,
          messageTextParts: [{ partIndex: 0, text: firstPart }, { partIndex: 1, text: secondPart }],
          messageTextPartIndex: 1,
        }),
      },
    });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:2',
      partIndex: 1,
    })).resolves.toEqual({
      table: expect.objectContaining({ tableId: 'ocr_result:2', partIndex: 1 }),
    });
  });
});
