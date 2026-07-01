import {
  buildSteelNativeEventEnvelopes,
  buildSteelPaddleOcrPreflightEventEnvelopes,
  steelNativeStreamEventName,
} from './events';

describe('Steel native event mapping', () => {
  it('maps captured assistant Markdown into parse and save native stream events', () => {
    const events = buildSteelNativeEventEnvelopes({
      source: 'assistant_markdown',
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_2',
      capture: {
        status: 'captured',
        result: {
          parseStatus: 'saved',
          savedCounts: { working_order_row: 2 },
        },
      },
    });

    expect(events).toEqual([
      {
        event: steelNativeStreamEventName,
        data: {
          type: 'parse_status',
          message: 'Markdown parse saved',
          parseStatus: 'saved',
          savedCounts: { working_order_row: 2 },
          source: 'assistant_markdown',
          conversationId: 'conversation_1',
          requestId: 'request_1',
          messageId: 'message_2',
        },
      },
      {
        event: steelNativeStreamEventName,
        data: {
          type: 'memory_saved',
          message: 'Working Order Memory saved',
          savedCounts: { working_order_row: 2 },
          source: 'assistant_markdown',
          conversationId: 'conversation_1',
          requestId: 'request_1',
          messageId: 'message_2',
        },
      },
    ]);
  });

  it('maps captured tool result saves without emitting parse status', () => {
    const events = buildSteelNativeEventEnvelopes({
      source: 'tool_result',
      conversationId: 'conversation_1',
      requestId: 'request_1',
      toolName: 'search_price_candidates',
      providerToolCallId: 'call_price',
      capture: {
        status: 'captured',
        result: {
          savedCounts: { price_evidence: 1 },
        },
      },
    });

    expect(events).toEqual([
      {
        event: steelNativeStreamEventName,
        data: {
          type: 'memory_saved',
          message: 'Working Order Memory saved',
          savedCounts: { price_evidence: 1 },
          source: 'tool_result',
          conversationId: 'conversation_1',
          requestId: 'request_1',
          toolName: 'search_price_candidates',
          providerToolCallId: 'call_price',
        },
      },
    ]);
  });

  it('includes table counts and active totals on captured assistant Markdown events', () => {
    const events = buildSteelNativeEventEnvelopes({
      source: 'assistant_markdown',
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_2',
      capture: {
        status: 'captured',
        result: {
          parseStatus: 'saved',
          savedCounts: { ocr_extract: 1, working_order_row: 2 },
          savedTableCounts: { ocr_table: 1, system_order_table: 1 },
          totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2, working_order_row: 2 },
          totalTableCounts: { ocr_table: 2, system_order_table: 1 },
        },
      },
    });

    expect(events.map((entry) => entry.data)).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        savedTableCounts: { ocr_table: 1, system_order_table: 1 },
        totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2, working_order_row: 2 },
        totalTableCounts: { ocr_table: 2, system_order_table: 1 },
      }),
      expect.objectContaining({
        type: 'memory_saved',
        savedTableCounts: { ocr_table: 1, system_order_table: 1 },
        totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2, working_order_row: 2 },
        totalTableCounts: { ocr_table: 2, system_order_table: 1 },
      }),
    ]);
  });

  it('does not emit events for routine skipped captures or empty save counts', () => {
    expect(
      buildSteelNativeEventEnvelopes({
        source: 'assistant_markdown',
        capture: { status: 'skipped', reason: 'blank_content' },
      }),
    ).toEqual([]);

    expect(
      buildSteelNativeEventEnvelopes({
        source: 'tool_result',
        capture: {
          status: 'captured',
          result: { savedCounts: { working_order_row: 0 } },
        },
      }),
    ).toEqual([]);

    expect(
      buildSteelNativeEventEnvelopes({
        source: 'tool_result',
        capture: {
          status: 'captured',
          result: { savedCounts: { working_order_row: Number.POSITIVE_INFINITY } },
        },
      }),
    ).toEqual([]);
  });

  it('maps completed PaddleOCR preflight into OCR saved activity', () => {
    const events = buildSteelPaddleOcrPreflightEventEnvelopes({
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_2',
      preflight: {
        status: 'completed',
        completedKeys: ['file:file-a'],
        attemptedKeys: ['file:file-a'],
        failedKeys: [],
        totalSavedCounts: { paddleocr_preflight: 2 },
        totalTableCounts: { ocr_table: 1 },
      },
    });

    expect(events).toEqual([
      {
        event: steelNativeStreamEventName,
        data: {
          type: 'memory_saved',
          message: 'PaddleOCR preflight saved',
          savedCounts: { paddleocr_preflight: 1 },
          totalSavedCounts: { paddleocr_preflight: 2 },
          totalTableCounts: { ocr_table: 1 },
          source: 'paddleocr_preflight',
          conversationId: 'conversation_1',
          requestId: 'request_1',
          messageId: 'message_2',
        },
      },
    ]);
  });

  it('maps partial PaddleOCR preflight into partial activity and saved OCR count', () => {
    const events = buildSteelPaddleOcrPreflightEventEnvelopes({
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_2',
      preflight: {
        status: 'partial',
        completedKeys: ['file:file-a'],
        attemptedKeys: ['file:file-a', 'file:file-b'],
        failedKeys: ['file:file-b'],
      },
    });

    expect(events).toEqual([
      {
        event: steelNativeStreamEventName,
        data: {
          type: 'parse_status',
          message: 'PaddleOCR preflight partial',
          parseStatus: 'partial',
          savedCounts: { paddleocr_preflight: 1 },
          source: 'paddleocr_preflight',
          conversationId: 'conversation_1',
          requestId: 'request_1',
          messageId: 'message_2',
        },
      },
      {
        event: steelNativeStreamEventName,
        data: {
          type: 'memory_saved',
          message: 'PaddleOCR preflight saved',
          savedCounts: { paddleocr_preflight: 1 },
          source: 'paddleocr_preflight',
          conversationId: 'conversation_1',
          requestId: 'request_1',
          messageId: 'message_2',
        },
      },
    ]);
  });

  it('maps already-completed PaddleOCR preflight into skipped activity', () => {
    const events = buildSteelPaddleOcrPreflightEventEnvelopes({
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_2',
      preflight: {
        status: 'skipped',
        completedKeys: ['file:file-a'],
        attemptedKeys: [],
        failedKeys: [],
        skippedReason: 'all_files_already_have_paddleocr',
      },
    });

    expect(events).toEqual([
      {
        event: steelNativeStreamEventName,
        data: {
          type: 'parse_status',
          message: 'PaddleOCR preflight skipped',
          parseStatus: 'skipped',
          source: 'paddleocr_preflight',
          conversationId: 'conversation_1',
          requestId: 'request_1',
          messageId: 'message_2',
        },
      },
    ]);
  });
});
