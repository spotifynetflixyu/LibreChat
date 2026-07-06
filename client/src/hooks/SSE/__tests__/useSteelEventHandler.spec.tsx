import { RecoilRoot, useRecoilValue } from 'recoil';
import { renderHook, act } from '@testing-library/react';
import type { EventSubmission, TMessage } from 'librechat-data-provider';
import { steelNativeActivityByMessageId, type SteelNativeActivityEvent } from '~/store/steel';
import useSteelEventHandler, {
  appendSteelNativeActivityEvent,
} from '~/hooks/SSE/useSteelEventHandler';

const createSubmission = (initialResponseId = 'assistant-1'): EventSubmission =>
  ({
    userMessage: {
      messageId: 'user-1',
      conversationId: 'conversation-1',
      isCreatedByUser: true,
    } as TMessage,
    initialResponse: {
      messageId: initialResponseId,
      conversationId: 'conversation-1',
      isCreatedByUser: false,
    } as TMessage,
    isTemporary: false,
    endpointOption: {},
    messages: [],
    conversation: { conversationId: 'conversation-1' },
  }) as unknown as EventSubmission;

const useHarness = (messageId: string) => {
  const steelEventHandler = useSteelEventHandler();
  const activity = useRecoilValue(steelNativeActivityByMessageId(messageId));
  return { activity, steelEventHandler };
};

describe('useSteelEventHandler', () => {
  it('stores Steel parse activity under the event message id', () => {
    const { result } = renderHook(() => useHarness('assistant-2'), {
      wrapper: RecoilRoot,
    });

    act(() => {
      result.current.steelEventHandler(
        {
          event: 'steel_event',
          data: {
            type: 'parse_status',
            source: 'assistant_markdown',
            conversationId: 'conversation-1',
            messageId: 'assistant-2',
            message: 'Saved Markdown parse',
            parseStatus: 'saved',
            savedCounts: { working_order_row: 2 },
            savedTableCounts: { system_order_table: 1 },
            totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2, working_order_row: 2 },
            totalTableCounts: { ocr_table: 2, system_order_table: 1 },
          },
        },
        createSubmission(),
      );
    });

    expect(result.current.activity).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'assistant_markdown',
        messageId: 'assistant-2',
        parseStatus: 'saved',
        savedCounts: { working_order_row: 2 },
        savedTableCounts: { system_order_table: 1 },
        totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2, working_order_row: 2 },
        totalTableCounts: { ocr_table: 2, system_order_table: 1 },
      }),
    ]);
  });

  it('also stores assistant Markdown activity under the current assistant response id', () => {
    const { result } = renderHook(
      () => {
        const steelEventHandler = useSteelEventHandler();
        const eventActivity = useRecoilValue(steelNativeActivityByMessageId('assistant-saved'));
        const currentActivity = useRecoilValue(steelNativeActivityByMessageId('assistant-live'));
        return { currentActivity, eventActivity, steelEventHandler };
      },
      { wrapper: RecoilRoot },
    );

    act(() => {
      result.current.steelEventHandler(
        {
          event: 'steel_event',
          data: {
            type: 'parse_status',
            source: 'assistant_markdown',
            conversationId: 'conversation-1',
            messageId: 'assistant-saved',
            message: 'Saved Markdown parse',
            parseStatus: 'saved',
            savedCounts: { working_order_row: 1 },
          },
        },
        createSubmission('assistant-live'),
      );
    });

    expect(result.current.eventActivity).toHaveLength(1);
    expect(result.current.currentActivity).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'assistant_markdown',
        messageId: 'assistant-saved',
        parseStatus: 'saved',
      }),
    ]);
  });

  it('falls back to the current assistant response for tool-result events without message id', () => {
    const { result } = renderHook(() => useHarness('assistant-live'), {
      wrapper: RecoilRoot,
    });

    act(() => {
      result.current.steelEventHandler(
        {
          event: 'steel_event',
          data: {
            type: 'memory_saved',
            source: 'tool_result',
            conversationId: 'conversation-1',
            requestId: 'request-1',
            toolName: 'run_file_ocr',
            providerToolCallId: 'call-ocr',
            message: 'Saved Working Order Memory',
            savedCounts: { paddleocr_preflight: 1 },
          },
        },
        createSubmission('assistant-live'),
      );
    });

    expect(result.current.activity).toEqual([
      expect.objectContaining({
        type: 'memory_saved',
        source: 'tool_result',
        toolName: 'run_file_ocr',
        providerToolCallId: 'call-ocr',
        savedCounts: { paddleocr_preflight: 1 },
      }),
    ]);
  });

  it('stores PaddleOCR preflight activity under the current assistant response id', () => {
    const { result } = renderHook(() => useHarness('assistant-live'), {
      wrapper: RecoilRoot,
    });

    act(() => {
      result.current.steelEventHandler(
        {
          event: 'steel_event',
          data: {
            type: 'memory_saved',
            source: 'paddleocr_preflight',
            conversationId: 'conversation-1',
            requestId: 'request-1',
            message: 'Saved PaddleOCR preflight',
            savedCounts: { ocr_extract: 1 },
          },
        },
        createSubmission('assistant-live'),
      );
    });

    expect(result.current.activity).toEqual([
      expect.objectContaining({
        type: 'memory_saved',
        source: 'paddleocr_preflight',
        savedCounts: { ocr_extract: 1 },
      }),
    ]);
  });

  it('stores OCR preprocessing progress events and replaces matching running messages', () => {
    const { result } = renderHook(() => useHarness('assistant-live'), {
      wrapper: RecoilRoot,
    });

    const progressEventBase = {
      source: 'ocr_preprocessing',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      messageId: 'assistant-live',
    } as const;
    const progressEvents: SteelNativeActivityEvent[] = [
      {
        ...progressEventBase,
        type: 'parse_status' as const,
        message: 'Uploaded pdf to S3 (163 pages / 4 chunks) (file:BH.pdf)',
        parseStatus: 'partial' as const,
      },
      {
        ...progressEventBase,
        type: 'parse_status' as const,
        message: 'Running paddleocr_vl in PaddleOCR (chunk 1/4) (file:BH.pdf)',
        parseStatus: 'partial' as const,
      },
      {
        ...progressEventBase,
        type: 'parse_status' as const,
        message: 'Ran paddleocr_vl in PaddleOCR (chunk 1/4) (file:BH.pdf)',
        parseStatus: 'partial' as const,
      },
      {
        ...progressEventBase,
        type: 'memory_saved' as const,
        message: 'Saved PaddleOCR preflight (chunk 1/4) (file:BH.pdf)',
        savedCounts: { paddleocr_preflight: 1 },
      },
      {
        ...progressEventBase,
        type: 'parse_status' as const,
        message: 'Running OCR markdown process (chunk 1/4) (file:BH.pdf)',
        parseStatus: 'partial' as const,
      },
      {
        ...progressEventBase,
        type: 'parse_status' as const,
        message: 'Ran OCR markdown process (chunk 1/4) (file:BH.pdf)',
        parseStatus: 'partial' as const,
      },
      {
        ...progressEventBase,
        type: 'memory_saved' as const,
        message: 'Saved OCR markdown (chunk 1/4) (file:BH.pdf)',
        savedCounts: { ocr_extract: 1 },
      },
      {
        ...progressEventBase,
        type: 'parse_status' as const,
        message: 'Read OCR markdowns (file:BH.pdf: 4 chunks)',
        parseStatus: 'partial' as const,
      },
      {
        ...progressEventBase,
        type: 'parse_status' as const,
        message: 'Processing pdf with OCR markdowns (file:BH.pdf)',
        parseStatus: 'partial' as const,
      },
    ];

    act(() => {
      for (const progressEvent of progressEvents) {
        result.current.steelEventHandler(
          {
            event: 'steel_event',
            data: progressEvent,
          },
          createSubmission('assistant-live'),
        );
      }
    });

    expect(result.current.activity.map((event) => event.message)).toEqual([
      'Uploaded pdf to S3 (163 pages / 4 chunks) (file:BH.pdf)',
      'Ran paddleocr_vl in PaddleOCR (chunk 1/4) (file:BH.pdf)',
      'Saved PaddleOCR preflight (chunk 1/4) (file:BH.pdf)',
      'Ran OCR markdown process (chunk 1/4) (file:BH.pdf)',
      'Saved OCR markdown (chunk 1/4) (file:BH.pdf)',
      'Read OCR markdowns (file:BH.pdf: 4 chunks)',
      'Processing pdf with OCR markdowns (file:BH.pdf)',
    ]);
  });

  it('preserves OCR preprocessing error details for the activity UI', () => {
    const { result } = renderHook(() => useHarness('assistant-live'), {
      wrapper: RecoilRoot,
    });

    act(() => {
      result.current.steelEventHandler(
        {
          event: 'steel_event',
          data: {
            type: 'parse_status',
            source: 'ocr_preprocessing',
            conversationId: 'conversation-1',
            requestId: 'request-1',
            messageId: 'assistant-live',
            message: 'ocr preprocessing failed (file:BH.pdf)',
            parseStatus: 'partial',
            errorMessage: 'organizer timeout',
            failedKeys: ['file:BH.pdf'],
          },
        },
        createSubmission('assistant-live'),
      );
    });

    expect(result.current.activity).toEqual([
      expect.objectContaining({
        errorMessage: 'organizer timeout',
        failedKeys: ['file:BH.pdf'],
      }),
    ]);
  });

  it('deduplicates replayed Steel activity envelopes', () => {
    const event = {
      event: 'steel_event' as const,
      data: {
        type: 'memory_saved' as const,
        source: 'assistant_markdown' as const,
        conversationId: 'conversation-1',
        messageId: 'assistant-1',
        message: 'Saved Working Order Memory',
        savedCounts: { working_order_row: 2 },
      },
    };
    const { result } = renderHook(() => useHarness('assistant-1'), {
      wrapper: RecoilRoot,
    });

    act(() => {
      result.current.steelEventHandler(event, createSubmission());
      result.current.steelEventHandler(event, createSubmission());
    });

    expect(result.current.activity).toHaveLength(1);
    expect((result.current.activity[0] as SteelNativeActivityEvent).savedCounts).toEqual({
      working_order_row: 2,
    });
  });

  it('keeps activity events when displayed count metadata changes', () => {
    const first: SteelNativeActivityEvent = {
      type: 'memory_saved',
      source: 'assistant_markdown',
      message: 'Saved Working Order Memory',
      messageId: 'assistant-1',
      savedCounts: { working_order_row: 1 },
      totalTableCounts: { system_order_table: 1 },
    };
    const second: SteelNativeActivityEvent = {
      ...first,
      totalTableCounts: { system_order_table: 2 },
    };

    const activity = [first, second].reduce<SteelNativeActivityEvent[]>(
      appendSteelNativeActivityEvent,
      [],
    );

    expect(activity).toHaveLength(2);
    expect(activity[1]?.totalTableCounts).toEqual({ system_order_table: 2 });
  });

  it('replaces OCR preprocessing running progress with matching completed progress', () => {
    const base = {
      type: 'parse_status' as const,
      source: 'ocr_preprocessing' as const,
      conversationId: 'conversation-1',
      requestId: 'request-1',
      messageId: 'assistant-1',
      parseStatus: 'partial' as const,
    };
    const activity = [
      {
        ...base,
        message: 'Running paddleocr_vl in PaddleOCR (chunk 1/3) (file:BH.pdf)',
      },
      {
        ...base,
        message: 'Ran paddleocr_vl in PaddleOCR (chunk 1/3) (file:BH.pdf)',
      },
      {
        ...base,
        message: 'Running OCR markdown process (chunk 1/3) (file:BH.pdf)',
      },
      {
        ...base,
        message: 'Ran OCR markdown process (chunk 1/3) (file:BH.pdf)',
      },
    ].reduce<SteelNativeActivityEvent[]>(appendSteelNativeActivityEvent, []);

    expect(activity.map((event) => event.message)).toEqual([
      'Ran paddleocr_vl in PaddleOCR (chunk 1/3) (file:BH.pdf)',
      'Ran OCR markdown process (chunk 1/3) (file:BH.pdf)',
    ]);
  });

  it('retains more than twelve activity events for long Steel turns', () => {
    const events = Array.from({ length: 13 }, (_, index) => ({
      type: 'memory_saved' as const,
      source: 'tool_result' as const,
      message: `Saved ${index + 1}`,
      savedCounts: { ocr_extract: index + 1 },
      providerToolCallId: `call-${index + 1}`,
    }));

    const activity = events.reduce<SteelNativeActivityEvent[]>(appendSteelNativeActivityEvent, []);

    expect(activity).toHaveLength(13);
    expect(activity[0]?.providerToolCallId).toBe('call-1');
    expect(activity[12]?.providerToolCallId).toBe('call-13');
  });

  it('ignores activity envelopes with non-finite saved counts', () => {
    const { result } = renderHook(() => useHarness('assistant-1'), {
      wrapper: RecoilRoot,
    });

    act(() => {
      result.current.steelEventHandler(
        {
          event: 'steel_event',
          data: {
            type: 'memory_saved',
            source: 'assistant_markdown',
            conversationId: 'conversation-1',
            messageId: 'assistant-1',
            message: 'Saved Working Order Memory',
            savedCounts: { working_order_row: Number.NaN },
          },
        },
        createSubmission(),
      );
    });

    expect(result.current.activity).toEqual([]);
  });
});
