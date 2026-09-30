import { Constants, EModelEndpoint } from 'librechat-data-provider';
import useGenerationsByLatest from '~/hooks/useGenerationsByLatest';

const base = {
  endpoint: EModelEndpoint.agents,
  messageId: 'response-1',
  latestMessageId: 'response-1',
  isSubmitting: false,
  isCreatedByUser: false,
};

describe('useGenerationsByLatest', () => {
  it('allows editing and branching OpenAI OAuth messages', () => {
    const result = useGenerationsByLatest({
      endpoint: EModelEndpoint.openAIOAuth,
      messageId: 'user-message',
      latestMessageId: 'assistant-message',
      isSubmitting: false,
      isCreatedByUser: true,
    });

    expect(result.isEditableEndpoint).toBe(true);
    expect(result.forkingSupported).toBe(true);
    expect(result.hideEditButton).toBe(false);
  });

  it('withholds the hover Continue control when the turn ran out of tool steps', () => {
    const result = useGenerationsByLatest({
      ...base,
      finish_reason: String(Constants.TOOL_CALL_LIMIT_FINISH_REASON),
    });

    expect(result.continueSupported).toBe(false);
  });

  it('still offers Continue for other incomplete finish reasons', () => {
    const result = useGenerationsByLatest({
      ...base,
      finish_reason: 'length',
    });

    expect(result.continueSupported).toBe(true);
  });
});
