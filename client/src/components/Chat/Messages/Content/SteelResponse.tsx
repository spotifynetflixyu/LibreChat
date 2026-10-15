import { useMemo } from 'react';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { SteelActivityProps } from './SteelActivity';
import { hasAcceptedQuotationPreflight, hideQuoteSignalFromContent } from './hideQuoteSignal';
import SteelActivity, { useSteelActivityEvents } from './SteelActivity';

type SteelResponseExtrasOptions = SteelActivityProps & {
  content: Array<TMessageContentParts | undefined> | undefined;
};

/** Hides an accepted quote signal from the response and renders its Steel activity strip. */
export function useSteelResponseExtras({ content, ...activityProps }: SteelResponseExtrasOptions) {
  const { messageId, isCreatedByUser, persistedActivityEvents } = activityProps;
  const events = useSteelActivityEvents(messageId, persistedActivityEvents);
  const displayContent = useMemo(
    () =>
      hideQuoteSignalFromContent(
        content,
        !isCreatedByUser && hasAcceptedQuotationPreflight(events, messageId),
      ),
    [content, events, isCreatedByUser, messageId],
  );
  return { displayContent, steelActivity: <SteelActivity {...activityProps} /> };
}
