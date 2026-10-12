import { createElement, type ReactNode } from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentTypes, StepEvents, StepTypes, ToolCallTypes } from 'librechat-data-provider';
import type {
  Agents,
  EventSubmission,
  TConversation,
  TMessage,
  TMessageContentParts,
} from 'librechat-data-provider';
import type { EventHandlerParams } from '~/hooks/SSE/useEventHandlers';
import type { TResData } from '~/common';
import useEventHandlers from '~/hooks/SSE/useEventHandlers';

jest.mock('~/Providers', () => ({
  useLiveAnnouncer: () => ({ announcePolite: jest.fn() }),
}));

jest.mock('~/data-provider', () => ({
  markTitleGenerationProcessed: jest.fn(),
  queueTitleGeneration: jest.fn(),
  startupConfigKey: jest.fn(() => ['startup-config']),
  useReconcileConversationCodeEnvironmentMutation: () => ({ mutate: jest.fn() }),
}));

jest.mock('~/hooks/Agents', () => ({
  useApplyAgentTemplate: () => jest.fn(),
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: 'test-token' }),
}));

jest.mock('~/hooks/Chat/useFocusRegeneratedResponse', () => ({
  __esModule: true,
  default: () => jest.fn(),
}));

jest.mock('~/hooks/SSE/useAttachmentHandler', () => ({
  __esModule: true,
  default: () => jest.fn(),
}));

jest.mock('~/hooks/SSE/useContentHandler', () => ({
  __esModule: true,
  default: () => ({ contentHandler: jest.fn(), resetContentHandler: jest.fn() }),
}));

jest.mock('~/hooks/SSE/useSteelEventHandler', () => ({
  __esModule: true,
  default: () => jest.fn(),
}));

const responseId = 'response-1';
const conversationId = 'conversation-1';
const userMessageId = 'user-1';

const createUserMessage = (): TMessage => ({
  messageId: userMessageId,
  conversationId,
  parentMessageId: '00000000-0000-0000-0000-000000000000',
  isCreatedByUser: true,
  sender: 'User',
  text: 'Please quote this order',
});

const createResponseMessage = (overrides: Partial<TMessage> = {}): TMessage => ({
  messageId: responseId,
  conversationId,
  parentMessageId: userMessageId,
  isCreatedByUser: false,
  sender: 'Assistant',
  text: '',
  content: [],
  ...overrides,
});

const createRunStep = (): Agents.RunStep => ({
  id: 'message-step-1',
  runId: responseId,
  index: 0,
  type: StepTypes.MESSAGE_CREATION,
  stepDetails: {
    type: StepTypes.MESSAGE_CREATION,
    message_creation: { message_id: 'message-1', phase: 'final_answer' },
  },
  usage: null,
});

const createMessageDelta = (text: string): Agents.MessageDeltaEvent => ({
  id: 'message-step-1',
  delta: { content: [{ type: ContentTypes.TEXT, text }] },
});

const getText = (message: TMessage | undefined): string => {
  const textPart = message?.content?.find((part) => part?.type === ContentTypes.TEXT);
  if (textPart?.type !== ContentTypes.TEXT) {
    return '';
  }
  return typeof textPart.text === 'string' ? textPart.text : (textPart.text?.value ?? '');
};

const getResponse = (messages: TMessage[]): TMessage | undefined =>
  messages.find((message) => message.messageId === responseId);

describe('quotation final response reconciliation', () => {
  it.each([
    { name: 'partial draft', preview: 'draft-', finalReview: '' },
    { name: 'no-review sentinel', preview: '無待複核事項。', finalReview: '' },
    {
      name: 'notes before reviews',
      preview: '## notes\n\n補充。\n\n## manual_reviews\n\n需複核。',
      finalReview: '## manual_reviews\n\n需複核。\n\n## notes\n\n補充。\n\n',
    },
  ])('replaces $name once and ignores a stale delta frame', ({ preview, finalReview }) => {
    const userMessage = createUserMessage();
    const initialResponse = createResponseMessage();
    let messages = [userMessage, initialResponse];
    let completed = new Set<unknown>();
    let submitting = true;
    let conversationState: TConversation | null = {
      conversationId,
      endpoint: 'openAI',
    } as TConversation;
    let showStopButton = false;

    const setMessages = jest.fn((nextMessages: TMessage[]) => {
      messages = nextMessages;
    });
    const getMessages = jest.fn(() => messages);
    const setCompleted: EventHandlerParams['setCompleted'] = (update) => {
      completed = typeof update === 'function' ? update(completed) : update;
    };
    const setIsSubmitting: EventHandlerParams['setIsSubmitting'] = (update) => {
      submitting = typeof update === 'function' ? update(submitting) : update;
    };
    const setConversation: NonNullable<EventHandlerParams['setConversation']> = (update) => {
      conversationState = typeof update === 'function' ? update(conversationState) : update;
    };
    const setShowStopButton: EventHandlerParams['setShowStopButton'] = (update) => {
      showStopButton = typeof update === 'function' ? update(showStopButton) : update;
    };

    const submission: EventSubmission = {
      userMessage,
      initialResponse,
      // The UI cache already contains this turn's user/placeholder rows. The
      // transport submission carries only the history from before the turn.
      messages: [],
      conversation: conversationState,
      endpointOption: { endpoint: conversationState.endpoint },
      isRegenerate: false,
      isTemporary: false,
    };

    const pendingFrames: FrameRequestCallback[] = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        RecoilRoot,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(MemoryRouter, { initialEntries: [`/c/${conversationId}`] }, children),
        ),
      );

    const { result } = renderHook(
      () =>
        useEventHandlers({
          setMessages,
          getMessages,
          setCompleted,
          setIsSubmitting,
          setConversation,
          setShowStopButton,
        }),
      { wrapper },
    );

    act(() => {
      result.current.stepHandler(
        { event: StepEvents.ON_RUN_STEP, data: createRunStep() },
        submission,
      );
      result.current.stepHandler(
        { event: StepEvents.ON_MESSAGE_DELTA, data: createMessageDelta(preview) },
        submission,
      );
    });

    expect(pendingFrames).toHaveLength(1);
    expect(getText(getResponse(messages))).toBe('');

    const firstFrame = pendingFrames[0];
    expect(firstFrame).toBeDefined();
    act(() => firstFrame?.(0));
    expect(getText(getResponse(messages))).toBe(preview);

    act(() => {
      result.current.stepHandler(
        { event: StepEvents.ON_MESSAGE_DELTA, data: createMessageDelta('provisional') },
        submission,
      );
    });
    expect(pendingFrames).toHaveLength(2);
    const staleFrame = pendingFrames[1];
    expect(staleFrame).toBeDefined();
    expect(getText(getResponse(messages))).toBe(preview);

    const toolCall: TMessageContentParts = {
      type: ContentTypes.TOOL_CALL,
      tool_call: {
        type: ToolCallTypes.TOOL_CALL,
        id: 'lookup-1',
        name: 'search_price_candidates',
        args: '{}',
        output: '{"ok":true}',
        progress: 1,
      },
    };
    const authoritativeText =
      '## system_order\n\n| 品名規格 | 總數 | 小計 |\n| --- | ---: | ---: |\n| A | 1 | 100 |\n\n## customer_quote\n\n| 項目 | 金額 |\n| --- | ---: |\n| 合計 | 100 |\n\n' +
      finalReview +
      '## quote_summary\n\n查價輸出完成：共 1 筆 system_order。';
    const authoritativeContent: TMessageContentParts[] = [
      toolCall,
      { type: ContentTypes.TEXT, text: authoritativeText },
    ];
    const authoritativeResponse = createResponseMessage({
      createdAt: '2026-09-18T00:00:00.000Z',
      content: authoritativeContent,
    });
    const finalData = {
      final: true,
      conversation: { conversationId },
      requestMessage: userMessage,
      responseMessage: authoritativeResponse,
    };

    act(() => {
      // This is the same boundary used by useSSE before dispatching its terminal final event.
      result.current.cancelPendingDeltaFlush();
      result.current.finalHandler(finalData, submission);
    });

    expect(getResponse(messages)).toEqual(authoritativeResponse);
    expect(getText(getResponse(messages))).toBe(authoritativeText);
    expect(getResponse(messages)?.content).toEqual(authoritativeContent);
    expect(messages.filter((message) => message.messageId === responseId)).toHaveLength(1);
    const authoritativeWrites = setMessages.mock.calls.filter(([next]) => {
      const response = getResponse(next);
      return (
        getText(response) === authoritativeText &&
        response?.content?.some((part) => {
          return part?.type === ContentTypes.TOOL_CALL && part.tool_call?.id === 'lookup-1';
        })
      );
    });
    expect(authoritativeWrites).toHaveLength(1);

    act(() => staleFrame?.(0));

    expect(getResponse(messages)).toEqual(authoritativeResponse);
    expect(getText(getResponse(messages))).toBe(authoritativeText);
    expect(getResponse(messages)?.content).toEqual(authoritativeContent);
    expect(completed).toContain(initialResponse.messageId);
    expect(submitting).toBe(false);
    expect(showStopButton).toBe(false);
    expect(conversationState?.conversationId).toBe(conversationId);
  });

  it.each(['created', 'error'])('drains a committed quotation queued before the %s response row', (terminal) => {
    const userMessage = createUserMessage();
    const initialResponse = createResponseMessage();
    let messages: TMessage[] = [];
    const setMessages = jest.fn((nextMessages: TMessage[]) => {
      messages = nextMessages;
    });
    const getMessages = jest.fn(() => messages);
    const conversationState = { conversationId, endpoint: 'openAI' } as TConversation;
    const submission: EventSubmission = {
      userMessage,
      initialResponse,
      messages: [],
      conversation: conversationState,
      endpointOption: { endpoint: conversationState.endpoint },
      isRegenerate: false,
      isTemporary: false,
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        RecoilRoot,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(MemoryRouter, { initialEntries: [`/c/${conversationId}`] }, children),
        ),
      );

    const { result } = renderHook(
      () =>
        useEventHandlers({
          setMessages,
          getMessages,
          setCompleted: jest.fn(),
          setIsSubmitting: jest.fn(),
          setConversation: jest.fn(),
          setShowStopButton: jest.fn(),
        }),
      { wrapper },
    );

    const committedMessage = createResponseMessage({
      content: [{ type: ContentTypes.TEXT, text: 'committed order' }],
      metadata: {
        steelQuotation: {
          version: 1,
          runId: 'run-1',
          outputId: 'system_order:run-1',
          sourceMessageId: responseId,
          receiptSha256: 'a'.repeat(64),
          admissionSequence: 1,
          tableContentIndex: 0,
          summaryContentIndex: 1,
          footerContentIndex: 2,
        },
      },
    });
    const update = {
      message: committedMessage,
      publication: {
        version: 1 as const,
        runId: 'run-1',
        outputId: 'system_order:run-1',
        sourceMessageId: responseId,
        receiptSha256: 'a'.repeat(64),
        admissionSequence: 1,
        tableContentIndex: 0,
        summaryContentIndex: 1,
        footerContentIndex: 2,
      },
      update: 'order' as const,
    };

    act(() => result.current.messageUpdateHandler(update, submission));
    expect(messages).toEqual([]);

    act(() => {
      if (terminal === 'error') {
        result.current.errorHandler({
          data: createResponseMessage({ text: 'Summary failed' }) as unknown as TResData,
          submission,
        });
        return;
      }
      result.current.createdHandler(
        { created: true, responseMessageId: responseId } as unknown as TResData,
        submission,
      );
    });

    expect(messages.filter((message) => message.messageId === responseId)).toHaveLength(1);
    expect(messages.find((message) => message.messageId === responseId)?.text).toBe(
      'committed order',
    );
  });

  it('replaces the raw placeholder with the canonical committed response once', () => {
    const rawResponseId = 'response-raw_';
    const canonicalResponseId = 'response-canonical';
    const userMessage = createUserMessage();
    const initialResponse = createResponseMessage({ messageId: rawResponseId });
    let messages: TMessage[] = [];
    const setMessages = jest.fn((nextMessages: TMessage[]) => {
      messages = nextMessages;
    });
    const getMessages = jest.fn(() => messages);
    const conversationState = { conversationId, endpoint: 'openAI' } as TConversation;
    const submission: EventSubmission = {
      userMessage,
      initialResponse,
      messages: [],
      conversation: conversationState,
      endpointOption: { endpoint: conversationState.endpoint },
      isRegenerate: false,
      isTemporary: false,
    };
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        RecoilRoot,
        null,
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(MemoryRouter, { initialEntries: [`/c/${conversationId}`] }, children),
        ),
      );
    const { result } = renderHook(
      () =>
        useEventHandlers({
          setMessages,
          getMessages,
          setCompleted: jest.fn(),
          setIsSubmitting: jest.fn(),
          setConversation: jest.fn(),
          setShowStopButton: jest.fn(),
        }),
      { wrapper },
    );
    const update = {
      message: createResponseMessage({
        messageId: canonicalResponseId,
        content: [{ type: ContentTypes.TEXT, text: 'canonical order' }],
      }),
      publication: {
        version: 1 as const,
        runId: 'run-canonical',
        outputId: 'system_order:run-canonical',
        sourceMessageId: rawResponseId,
        receiptSha256: 'b'.repeat(64),
        admissionSequence: 2,
        tableContentIndex: 0,
        summaryContentIndex: 1,
        footerContentIndex: 2,
      },
      update: 'order' as const,
    };
    const staleUpdate = {
      ...update,
      message: createResponseMessage({
        messageId: canonicalResponseId,
        content: [{ type: ContentTypes.TEXT, text: 'stale order' }],
      }),
      publication: {
        ...update.publication,
        receiptSha256: 'c'.repeat(64),
        admissionSequence: 1,
      },
    };

    act(() => result.current.messageUpdateHandler(update, submission));
    act(() => result.current.messageUpdateHandler(staleUpdate, submission));
    act(() =>
      result.current.createdHandler(
        { created: true, responseMessageId: rawResponseId } as unknown as TResData,
        submission,
      ),
    );

    expect(messages.filter((message) => !message.isCreatedByUser)).toHaveLength(1);
    expect(messages.map((message) => message.messageId)).toEqual([
      userMessage.messageId,
      canonicalResponseId,
    ]);
    expect(messages.find((message) => message.messageId === canonicalResponseId)?.text).toBe(
      'canonical order',
    );
  });
});
