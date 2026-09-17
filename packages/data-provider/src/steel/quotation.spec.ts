import { steelQuotationCancel, steelQuotationStatus } from '../api-endpoints';
import { steelQuotationStatusSchema } from './quotation';

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
});
