import type { TSubmission } from './types';
import createPayload from './createPayload';
import { EModelEndpoint } from './schemas';

describe('createPayload', () => {
  it('preserves the Steel replay target and original PDF in a regenerated turn', () => {
    const files = [
      {
        file_id: 'file-bh-pdf',
        filename: 'BH.pdf',
        filepath: 'files/user-123/BH.pdf',
        type: 'application/pdf',
        bytes: 2048,
      },
    ];
    const submission = {
      userMessage: {
        messageId: 'user-1',
        conversationId: 'conversation-1',
        parentMessageId: null,
        isCreatedByUser: true,
        sender: 'User',
        text: '請重新 OCR 這份 PDF。',
        files,
      },
      isRegenerate: true,
      steelFlowResume: { kind: 'preflight', runId: 'ocr-run-1' },
      isTemporary: false,
      messages: [],
      conversation: {
        conversationId: 'conversation-1',
        endpoint: EModelEndpoint.agents,
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
      },
      endpointOption: {
        endpoint: EModelEndpoint.agents,
        endpointType: EModelEndpoint.agents,
      },
    } as TSubmission;

    const { payload } = createPayload(submission);

    expect(payload.isRegenerate).toBe(true);
    expect(payload.files).toEqual(files);
    expect(payload.steelFlowResume).toEqual(submission.steelFlowResume);
  });
});
