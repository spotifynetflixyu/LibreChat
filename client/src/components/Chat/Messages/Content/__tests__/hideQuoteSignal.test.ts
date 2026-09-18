import { ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { SteelNativeActivityEvent } from '~/store/steel';
import {
  hasAcceptedQuotationPreflight,
  hideQuoteSignalFromContent,
  removeQuoteSignalSections,
} from '../hideQuoteSignal';

const quotationStarted: SteelNativeActivityEvent = {
  type: 'quotation_status',
  source: 'quotation_preflight',
  conversationId: 'conversation-1',
  messageId: 'assistant-1',
  index: 1,
  stage: 'accepted',
  status: 'running',
  completedChunks: 0,
  totalChunks: 1,
};

const textPart = (text: string): TMessageContentParts =>
  ({ type: ContentTypes.TEXT, text });

describe('hideQuoteSignal', () => {
  it('does not hide the signal before quotation preflight starts', () => {
    const content = [textPart('## quote_signal\n\nstart')];

    expect(hasAcceptedQuotationPreflight([], 'assistant-1')).toBe(false);
    expect(hideQuoteSignalFromContent(content, false)).toBe(content);
  });

  it('hides a valid signal from a live per-message quotation event', () => {
    const tool: TMessageContentParts = {
      type: ContentTypes.TOOL_CALL,
      tool_call: { id: 'tool-1', type: ToolCallTypes.TOOL_CALL, name: 'search_price_candidates', args: '{}' },
    };
    const content = [
      textPart('OCR result\n\n## quote_signal\n\nstart\n\n## customer_data\n\nCustomer'),
      undefined,
      tool,
    ];

    expect(hasAcceptedQuotationPreflight([quotationStarted], 'assistant-1')).toBe(true);
    const hidden = hideQuoteSignalFromContent(content, true);
    expect(hidden?.[0]).toEqual(
      textPart('OCR result\n\n## customer_data\n\nCustomer'),
    );
    expect(hidden?.[1]).toBeUndefined();
    expect(hidden?.[2]).toBe(tool);
  });

  it('hides a signal from persisted quotation progress while keeping object text shape', () => {
    const persistedEvent: SteelNativeActivityEvent = {
      ...quotationStarted,
      messageId: undefined,
      status: 'completed',
    };
    const content: TMessageContentParts[] = [
      {
        type: ContentTypes.TEXT,
        text: { value: '## quote_signal\n\nstart', annotations: [] },
      },
    ];

    expect(hasAcceptedQuotationPreflight([persistedEvent], 'assistant-1')).toBe(true);
    expect(hideQuoteSignalFromContent(content, true)).toEqual([undefined]);
  });

  it('rejects invalid sections, user text, and fenced examples', () => {
    const invalid = '## quote_signal\n\nstart now';
    const fenced = '```markdown\n## quote_signal\n\nstart\n```';
    const userContent = [textPart('## quote_signal\n\nstart')];

    expect(removeQuoteSignalSections(invalid)).toBe(invalid);
    expect(removeQuoteSignalSections(fenced)).toBe(fenced);
    expect(hideQuoteSignalFromContent(userContent, false)).toBe(userContent);
  });
});
