import { EModelEndpoint } from 'librechat-data-provider';
import useGenerationsByLatest from '~/hooks/useGenerationsByLatest';

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
});
