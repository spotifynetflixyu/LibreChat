import React from 'react';
import { RecoilRoot } from 'recoil';
import { render } from '@testing-library/react';
import { ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type { TConversation, TMessage, TMessageContentParts } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TMessageChatContext } from '~/common';

jest.mock('~/utils', () => ({
  areMessageFieldsEqual: (previous?: TMessage | null, next?: TMessage | null) => previous === next,
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  getHeaderPrefixForScreenReader: () => '',
  getMessageAriaLabel: () => 'Assistant message',
  getMessageTimestampSource: (message?: TMessage | null) => message?.createdAt,
  getMessageProcessingStartedAt: (message?: TMessage | null) =>
    message?.isCreatedByUser === false &&
    !!message.clientTimestamp &&
    !Number.isNaN(new Date(message.clientTimestamp).getTime())
      ? message.clientTimestamp
      : undefined,
}));

jest.mock('~/hooks', () => ({
  useAttachments: () => ({ attachments: [], searchResults: {} }),
  useContentMetadata: () => ({ hasParallelContent: false }),
  useLocalize: () => (key: string) => key,
  useMessageActions: ({ chatContext }: { chatContext: TMessageChatContext }) => ({
    edit: false,
    index: 0,
    agent: undefined,
    assistant: undefined,
    enterEdit: jest.fn(),
    conversation: chatContext.conversation,
    messageLabel: 'Assistant',
    handleContinue: chatContext.handleContinue,
    handleFeedback: jest.fn(),
    latestMessageId: chatContext.latestMessageId,
    copyToClipboard: jest.fn(),
    getCanCopy: () => true,
    regenerateMessage: jest.fn(),
    latestMessageDepth: chatContext.latestMessageDepth,
  }),
}));

jest.mock('~/store', () => {
  const { atom } = jest.requireActual<typeof import('recoil')>('recoil');
  return {
    __esModule: true,
    default: {
      maximizeChatSpace: atom({ key: 'content-render-steel-maximize-chat-space', default: false }),
    },
  };
});

jest.mock('~/components/Chat/Messages/Content/Parts/AuthorHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/components/Chat/Messages/ui/HeaderLabel', () => ({
  getHeaderModelName: () => undefined,
}));
jest.mock('~/components/Chat/Messages/styles', () => ({
  revealOnRowHoverClasses: '',
  messageFooterClasses: '',
}));
jest.mock('~/components/Chat/Messages/MessageIcon', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/components/Chat/Messages/SiblingSwitch', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/components/Chat/Messages/HoverButtons', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/components/Chat/Messages/SubRow', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('~/components/Chat/Messages/ui/MessageRow', () => ({
  __esModule: true,
  default: jest.fn(({ children }: { children: ReactNode }) => <>{children}</>),
}));
jest.mock('~/components/Chat/Messages/Content/ContentParts', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

import ContentRender from '../ContentRender';

const mockContentParts = jest.requireMock('~/components/Chat/Messages/Content/ContentParts')
  .default as jest.Mock;
const mockMessageRow = jest.requireMock('~/components/Chat/Messages/ui/MessageRow')
  .default as jest.Mock;

const preflightToolCall = {
  type: 'tool_call' as const,
  id: 'paddle-1',
  name: 'paddleocr_vl---PaddleOCR',
  args: {
    input_data: 'https://files.example.test/chunk.pdf?signature=full-debug-value',
    output_mode: 'detailed' as const,
    return_images: false,
    use_doc_orientation_classify: true,
    use_doc_unwarping: true,
    use_layout_detection: true,
  },
  output: JSON.stringify({
    status: 'ok',
    paddleocr: 'ok',
    ocrEngine: 'paddleocr_vl',
    ocrFileKey: 'ocr-1',
    filename: 'scan.pdf',
    chunkIndex: 0,
    chunkCount: 1,
    pageStart: 1,
    pageEnd: 2,
    dataSizeBytes: 3,
  }),
  progress: 1 as const,
};

const chatContext = {
  ask: jest.fn(),
  index: 0,
  regenerate: jest.fn(),
  conversation: {
    conversationId: 'conversation-1',
    endpoint: 'openai_oauth_responses',
    model: 'gpt-4',
  } as TConversation,
  latestMessageId: 'assistant-1',
  latestMessageDepth: 0,
  handleContinue: jest.fn(),
  isSubmitting: false,
} as TMessageChatContext;

describe('ContentRender Steel history hydration', () => {
  beforeEach(() => {
    mockContentParts.mockClear();
    mockMessageRow.mockClear();
  });

  it('passes persisted events and preflight cards for non-Assistants history messages', () => {
    const activityEvents = [
      {
        type: 'memory_saved',
        source: 'paddleocr_preflight',
        message: 'Saved PaddleOCR preflight',
      },
    ];
    const rawContent = {
      type: ContentTypes.TEXT,
      text: 'Saved OCR response',
    } as TMessageContentParts;
    const message = {
      messageId: 'assistant-1',
      conversationId: 'conversation-1',
      parentMessageId: null,
      isCreatedByUser: false,
      text: 'Saved OCR response',
      createdAt: '2026-08-28T00:00:00.000Z',
      content: [rawContent],
      metadata: {
        steel: {
          activityEvents,
          preflightToolCalls: [preflightToolCall],
        },
      },
    } as TMessage;

    render(
      <RecoilRoot>
        <ContentRender
          message={message}
          siblingIdx={0}
          siblingCount={1}
          currentEditId={null}
          setSiblingIdx={jest.fn()}
          setCurrentEditId={jest.fn()}
          chatContext={chatContext}
        />
      </RecoilRoot>,
    );

    const passed = mockContentParts.mock.calls[0][0] as {
      content: Array<TMessageContentParts | undefined>;
      persistedActivityEvents: readonly unknown[];
    };
    expect(passed.persistedActivityEvents).toBe(activityEvents);
    expect(passed.content).toHaveLength(2);
    expect(passed.content[1]).toBe(rawContent);
    expect(passed.content[0]?.[ContentTypes.TOOL_CALL]).toMatchObject({
      type: ToolCallTypes.TOOL_CALL,
      id: 'paddle-1',
      name: 'paddleocr_vl---PaddleOCR',
      args: expect.objectContaining({
        input_data: 'https://files.example.test/chunk.pdf?signature=full-debug-value',
      }),
      output: preflightToolCall.output,
    });

    const passedRow = mockMessageRow.mock.calls[0][0] as { processingStartedAt?: string };
    expect(passedRow.processingStartedAt).toBeUndefined();
  });

  it('passes valid assistant client timestamp as processing start without using createdAt', () => {
    const message = {
      messageId: 'assistant-1',
      conversationId: 'conversation-1',
      parentMessageId: null,
      isCreatedByUser: false,
      text: 'Streaming OCR response',
      createdAt: '2026-08-28T00:01:00.000Z',
      clientTimestamp: '2026-08-28T00:00:00.000Z',
      content: [],
    } as TMessage;

    render(
      <RecoilRoot>
        <ContentRender
          message={message}
          siblingIdx={0}
          siblingCount={1}
          currentEditId={null}
          setSiblingIdx={jest.fn()}
          setCurrentEditId={jest.fn()}
          chatContext={chatContext}
        />
      </RecoilRoot>,
    );

    const passedRow = mockMessageRow.mock.calls[0][0] as { processingStartedAt?: string };
    expect(passedRow.processingStartedAt).toBe(message.clientTimestamp);
  });
});
