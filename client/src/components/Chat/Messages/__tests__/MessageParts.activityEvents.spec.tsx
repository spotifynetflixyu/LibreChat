import React from 'react';
import { RecoilRoot } from 'recoil';
import { render } from '@testing-library/react';
import { ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';
import type { ReactNode } from 'react';

jest.mock('~/common', () => ({
  getHeaderPrefixForScreenReader: () => '',
  getMessageAriaLabel: () => 'Assistant message',
  isValidTimestamp: () => false,
  areMessageRowPropsEqual: () => true,
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

jest.mock('~/hooks', () => ({
  useAttachments: () => ({ attachments: [], searchResults: {} }),
  useContentMetadata: () => ({ hasParallelContent: false }),
  useLocalize: () => (key: string) => key,
  useMessageHelpers: () => ({
    edit: false,
    index: 0,
    agent: undefined,
    isLast: false,
    enterEdit: jest.fn(),
    assistant: undefined,
    handleScroll: jest.fn(),
    conversation: { conversationId: 'conversation-1' },
    isSubmitting: false,
    latestMessageId: 'assistant-1',
    handleContinue: jest.fn(),
    copyToClipboard: jest.fn(),
    getCanCopy: () => true,
    regenerateMessage: jest.fn(),
  }),
}));

jest.mock('~/store', () => {
  const { atom } = jest.requireActual<typeof import('recoil')>('recoil');
  return {
    __esModule: true,
    default: {
      maximizeChatSpace: atom({ key: 'message-parts-maximize-chat-space', default: false }),
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
jest.mock('../styles', () => ({
  revealOnRowHoverClasses: '',
  messageFooterClasses: '',
}));
jest.mock('../MessageIcon', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../SiblingSwitch', () => ({ __esModule: true, default: () => null }));
jest.mock('../HoverButtons', () => ({ __esModule: true, default: () => null }));
jest.mock('../SubRow', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('../ui/MessageRow', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('../Content/ContentParts', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

import MessageParts from '../MessageParts';

const mockContentParts = jest.requireMock('../Content/ContentParts').default as jest.Mock;

const renderMessage = (
  metadata: TMessage['metadata'],
  content?: Array<TMessageContentParts | undefined>,
) => {
  const message = {
    messageId: 'assistant-1',
    conversationId: 'conversation-1',
    parentMessageId: null,
    isCreatedByUser: false,
    text: 'assistant response',
    content,
    metadata,
  } as TMessage;

  return render(
    <RecoilRoot>
      <MessageParts
        message={message}
        siblingIdx={0}
        siblingCount={1}
        currentEditId={null}
        setSiblingIdx={jest.fn()}
      />
    </RecoilRoot>,
  );
};

describe('MessageParts Steel activity metadata', () => {
  beforeEach(() => mockContentParts.mockClear());

  it('passes persisted activity events from plain Steel metadata to ContentParts', () => {
    const activityEvents = [
      {
        type: 'memory_saved',
        source: 'paddleocr_preflight',
        message: 'Saved PaddleOCR preflight',
        savedCounts: { paddleocr_preflight: 1 },
      },
    ];

    renderMessage({ steel: { activityEvents } });

    expect(mockContentParts).toHaveBeenCalledWith(
      expect.objectContaining({ persistedActivityEvents: activityEvents }),
      {},
    );
  });

  it('ignores malformed Steel metadata containers', () => {
    renderMessage({ steel: ['not-an-object'] });

    expect(mockContentParts).toHaveBeenCalledWith(
      expect.objectContaining({ persistedActivityEvents: undefined }),
      {},
    );
  });

  it('prepends strict preflight cards while preserving existing tool content and activity events', () => {
    const existing = {
      type: ContentTypes.TOOL_CALL,
      [ContentTypes.TOOL_CALL]: {
        type: ToolCallTypes.TOOL_CALL,
        id: 'search-1',
        name: 'search_customers',
        args: '{}',
        output: 'done',
      },
    } as TMessageContentParts;
    const preflight = {
      type: 'tool_call',
      id: 'paddle-1',
      name: 'paddleocr_vl---PaddleOCR',
      args: {
        output_mode: 'detailed',
        return_images: false,
        use_doc_orientation_classify: true,
        use_doc_unwarping: true,
        use_layout_detection: true,
      },
      output: JSON.stringify({
        status: 'completed',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'ocr-1',
        filename: 'scan.pdf',
        chunkIndex: 0,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 2,
        rawTextLength: 3,
        rawResultHash: 'hash',
        outputStorage: 'steel_working_order_memory:paddleocr_preflight',
      }),
      progress: 1,
    };

    renderMessage(
      {
        steel: {
          preflightToolCalls: [preflight],
          activityEvents: [{ type: 'memory_saved', source: 'tool_result' }],
        },
      },
      [existing],
    );

    const passed = mockContentParts.mock.calls[0][0];
    expect(passed.content).toHaveLength(2);
    expect(passed.content[0][ContentTypes.TOOL_CALL].name).toBe('paddleocr_vl---PaddleOCR');
    expect(passed.content[1]).toBe(existing);
    expect(passed.persistedActivityEvents).toHaveLength(1);
  });

  it('drops malformed and duplicate preflight cards when existing content wins', () => {
    const existing = {
      type: ContentTypes.TOOL_CALL,
      [ContentTypes.TOOL_CALL]: { type: ToolCallTypes.TOOL_CALL, id: 'same', name: 'search_customers' },
    } as TMessageContentParts;
    renderMessage(
      {
        steel: {
          preflightToolCalls: [
            { type: 'tool_call', id: 'same', name: 'paddleocr_vl', args: {}, progress: 0 },
            { type: 'tool_call', id: 'bad', name: 'other', args: {}, progress: 0 },
            {
              type: 'tool_call',
              id: 'unsafe',
              name: 'paddleocr_vl---PaddleOCR',
              args: {
                output_mode: 'detailed',
                return_images: false,
                use_doc_orientation_classify: true,
                use_doc_unwarping: true,
                use_layout_detection: true,
              },
              output: JSON.stringify({
                status: 'completed',
                ocrEngine: 'paddleocr_vl',
                ocrFileKey: 'ocr-1',
                filename: 'scan.pdf',
                chunkIndex: 0,
                chunkCount: 1,
                pageStart: 1,
                pageEnd: 2,
                rawTextLength: 3,
                rawResultHash: 'hash',
                outputStorage: 'steel_working_order_memory:paddleocr_preflight',
                signedUrl: 'https://secret.example.test',
              }),
              progress: 1,
            },
          ],
        },
      },
      [existing],
    );
    const passed = mockContentParts.mock.calls[0][0];
    expect(passed.content).toEqual([existing]);
  });
});
