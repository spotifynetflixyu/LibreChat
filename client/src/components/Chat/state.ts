import { Constants } from 'librechat-data-provider';

export type ChatViewContentState = 'landing' | 'loading' | 'messages';

export function getChatViewContentState({
  conversationId,
  hasMessages,
  isLoading,
  messagesFetched,
}: {
  conversationId?: string;
  hasMessages: boolean;
  isLoading: boolean;
  messagesFetched: boolean;
}): ChatViewContentState {
  const hasEmptyMessages = !hasMessages;
  const isLandingPage =
    hasEmptyMessages && (conversationId === Constants.NEW_CONVO || !conversationId);
  const isNavigating = hasEmptyMessages && conversationId != null && !messagesFetched;

  if (isLoading && conversationId !== Constants.NEW_CONVO) {
    return 'loading';
  }
  if ((isLoading || isNavigating) && !isLandingPage) {
    return 'loading';
  }
  if (!isLandingPage) {
    return 'messages';
  }
  return 'landing';
}
