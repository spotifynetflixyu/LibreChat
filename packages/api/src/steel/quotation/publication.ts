import type { SteelQuotationPublicationMessage } from '@librechat/data-schemas';
import type { ResponseAggregator } from '../../agents/responses/service';
import type { ResponseTracker } from '../../agents/responses/handlers';
import type { OutputItem } from '../../agents/responses/types';

export interface SteelQuotationPublicationContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface SteelQuotationPublicationMessageSnapshot extends Omit<SteelQuotationPublicationMessage, 'content'> {
  content?: SteelQuotationPublicationContentPart[];
}

export type SteelQuotationPublicationMessageFields = Omit<
  SteelQuotationPublicationMessageSnapshot,
  'messageId' | 'text' | 'content'
> & {
  sourceMessageId: string;
  conversationId: string;
  user: string;
};

export type SteelQuotationPublicationTrackerSnapshot = Pick<
  ResponseTracker,
  'items' | 'currentMessage' | 'currentContentIndex'
>;

export type SteelQuotationPublicationAggregatorSnapshot = Pick<
  ResponseAggregator,
  'reasoningChunks' | 'textChunks' | 'toolCalls' | 'toolOutputs'
>;

function appendRenderedText(current: string, next: string): string {
  if (current.length > 0 && next.length > 0 &&
    current[current.length - 1] !== ' ' && next[0] !== ' ') {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
}

function renderText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.reduce(
    (result, part) => (part.type === 'text' || part.type === 'output_text') && typeof part.text === 'string'
      ? appendRenderedText(result, part.text)
      : result,
    '',
  );
}

function trackerText(tracker: SteelQuotationPublicationTrackerSnapshot): string {
  const items: readonly OutputItem[] = Array.isArray(tracker.items) ? tracker.items : [];
  return items
    .flatMap((item) => item.type === 'message' ? item.content ?? [] : [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string')
    .join('');
}

function primaryText(input: {
  tracker?: SteelQuotationPublicationTrackerSnapshot | null;
  aggregator?: SteelQuotationPublicationAggregatorSnapshot | null;
}): string {
  if (input.tracker) {
    return trackerText(input.tracker);
  }
  return input.aggregator?.textChunks?.join('') ?? '';
}

/**
 * Captures the settled host response before the quotation workflow starts and
 * returns the callback used by the guarded publisher. Responses persistence
 * stores the ordinary assistant message shape; transport-only output items
 * remain in the live Responses response and are never copied into IMessage.
 */
export function createSteelQuotationPublicationMessageBuilder(input: {
  tracker?: SteelQuotationPublicationTrackerSnapshot | null;
  aggregator?: SteelQuotationPublicationAggregatorSnapshot | null;
  buildMessageFields: (
    targetMessageId: string,
  ) => SteelQuotationPublicationMessageFields | Promise<SteelQuotationPublicationMessageFields>;
}): (input: {
  targetMessageId: string;
  markdown: string;
}) => Promise<SteelQuotationPublicationMessageSnapshot> {
  const capturedPrimaryText = primaryText(input);
  return async ({ targetMessageId, markdown }) => {
    const fields = await input.buildMessageFields(targetMessageId);
    return {
      ...fields,
      messageId: targetMessageId,
      text: `${capturedPrimaryText}\n\n${markdown}`,
    };
  };
}

/** Projects the committed quotation into the Chat host's explicit text slot. */
export function projectSteelQuotationMessage(input: {
  message: SteelQuotationPublicationMessageSnapshot;
  markdown: string;
  quotationContentIndex?: number;
}): SteelQuotationPublicationMessageSnapshot {
  const content = input.message.content?.map((part) => ({ ...part }));
  if (!content) {
    return { ...input.message, text: `${input.message.text}\n\n${input.markdown}` };
  }
  if (input.quotationContentIndex !== undefined && input.quotationContentIndex >= 0 &&
    input.quotationContentIndex < content.length) {
    content[input.quotationContentIndex] = {
      ...content[input.quotationContentIndex],
      text: input.markdown,
    };
  } else {
    content.push({ type: 'text', text: input.markdown });
  }
  return { ...input.message, text: renderText(content), content };
}
