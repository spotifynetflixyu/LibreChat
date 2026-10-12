import { steelQuotationOcrSourceSchema, steelQuotationStatusSchema } from './quotation';
import { steelQuotationCancel, steelQuotationStatus } from '../api-endpoints';

describe('Steel quotation data contracts', () => {
  it('escapes conversation and quotation index path parameters', () => {
    expect(steelQuotationStatus('conversation/with spaces')).toContain(
      '/conversations/conversation%2Fwith%20spaces/quotation',
    );
    expect(steelQuotationCancel('conversation/with spaces', 4)).toContain(
      '/conversations/conversation%2Fwith%20spaces/quotation/4/cancel',
    );
  });

  it('accepts the complete quotation status response contract', () => {
    expect(
      steelQuotationStatusSchema.parse({
        conversationId: 'conversation-1',
        index: 2,
        runId: 'quotation-run-2',
        status: 'aggregating',
        completedChunks: 2,
        totalChunks: 3,
        canCancel: true,
      }),
    ).toEqual({
      conversationId: 'conversation-1',
      index: 2,
      runId: 'quotation-run-2',
      status: 'aggregating',
      completedChunks: 2,
      totalChunks: 3,
      canCancel: true,
    });
  });

  it('accepts a frozen AI OCR source on the quotation status', () => {
    expect(
      steelQuotationStatusSchema.parse({
        conversationId: 'conversation-1',
        index: 2,
        runId: 'quotation-run-2',
        status: 'completed',
        completedChunks: 3,
        totalChunks: 3,
        canCancel: false,
        ocrSource: {
          source: 'ai',
          version: 2,
          savedAt: '2026-10-07T04:00:00.000Z',
          messageId: 'assistant-2',
          outputId: 'ocr_result:generation-2',
          title: 'quotation.pdf',
          revision: 'generation-2',
          aiSavedAt: '2026-10-07T03:59:00.000Z',
        },
      }),
    ).toMatchObject({ ocrSource: { source: 'ai', version: 2 } });
  });

  it('rejects invalid or expanded OCR source metadata', () => {
    expect(() =>
      steelQuotationOcrSourceSchema.parse({
        source: 'human',
        version: 0,
        savedAt: '2026-10-07T04:00:00.000Z',
        messageId: 'assistant-2',
        outputId: 'ocr_result:generation-2',
        title: 'quotation.pdf',
        revision: 'generation-2',
      }),
    ).toThrow();

    expect(() =>
      steelQuotationOcrSourceSchema.parse({
        source: 'human',
        version: 1,
        savedAt: '2026-10-07T04:00:00.000Z',
        messageId: 'assistant-2',
        outputId: 'ocr_result:generation-2',
        title: 'quotation.pdf',
        revision: 'generation-2',
        markdown: '# internal storage',
      }),
    ).toThrow();
  });
});
