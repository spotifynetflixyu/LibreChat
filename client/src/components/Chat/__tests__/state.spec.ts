import { Constants } from 'librechat-data-provider';
import { getChatViewContentState } from '../state';

describe('getChatViewContentState', () => {
  it('shows messages for an existing conversation whose empty messages query has completed', () => {
    expect(
      getChatViewContentState({
        conversationId: 'conversation-empty-shell',
        hasMessages: false,
        isLoading: false,
        messagesFetched: true,
      }),
    ).toBe('messages');
  });

  it('keeps the new conversation route on the landing page', () => {
    expect(
      getChatViewContentState({
        conversationId: String(Constants.NEW_CONVO),
        hasMessages: false,
        isLoading: false,
        messagesFetched: true,
      }),
    ).toBe('landing');
  });

  it('keeps an existing conversation loading before messages have been fetched', () => {
    expect(
      getChatViewContentState({
        conversationId: 'conversation-loading',
        hasMessages: false,
        isLoading: false,
        messagesFetched: false,
      }),
    ).toBe('loading');
  });
});
