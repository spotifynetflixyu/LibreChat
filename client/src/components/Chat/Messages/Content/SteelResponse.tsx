import { useCallback, useContext, useMemo } from 'react';
import type { SteelFlowResume, TMessageContentParts } from 'librechat-data-provider';
import type { SteelActivityProps } from './SteelActivity';
import { hasAcceptedQuotationPreflight, hideQuoteSignalFromContent } from './hideQuoteSignal';
import SteelActivity, { useSteelActivityEvents } from './SteelActivity';
import { ChatContext } from '~/Providers';

type SteelResponseExtrasOptions = Omit<
  SteelActivityProps,
  'onResumeFlow' | 'onRetryFlow' | 'isSubmitting'
> & {
  content: Array<TMessageContentParts | undefined> | undefined;
};

/** Hides an accepted quote signal from the response and renders its Steel activity strip. */
export function useSteelResponseExtras({ content, ...activityProps }: SteelResponseExtrasOptions) {
  const { messageId, isCreatedByUser, persistedActivityEvents } = activityProps;
  const chat = useContext(ChatContext);
  const conversationId = activityProps.conversationId ?? chat?.conversation?.conversationId;
  const recoverFlow = useCallback(
    (steelFlowResume: SteelFlowResume) => {
      if (!chat || !conversationId || chat.isSubmitting ||
        chat.conversation?.conversationId !== conversationId) {
        return false;
      }
      const message = chat.getMessages(conversationId)?.find(
        (entry) => entry.messageId === messageId && entry.isCreatedByUser === false,
      );
      return message ? chat.regenerate(message, { steelFlowResume }) : false;
    },
    [chat, conversationId, messageId],
  );
  const events = useSteelActivityEvents(messageId, persistedActivityEvents);
  const displayContent = useMemo(
    () =>
      hideQuoteSignalFromContent(
        content,
        !isCreatedByUser && hasAcceptedQuotationPreflight(events, messageId),
      ),
    [content, events, isCreatedByUser, messageId],
  );
  return {
    displayContent,
    steelActivity: (
      <SteelActivity
        {...activityProps}
        conversationId={conversationId}
        isSubmitting={chat?.isSubmitting}
        onResumeFlow={chat ? recoverFlow : undefined}
        onRetryFlow={chat ? recoverFlow : undefined}
      />
    ),
  };
}
