import {
  buildSteelNativeEventEnvelopes,
  buildSteelOcrPreprocessingEventEnvelopes,
  buildSteelPaddleOcrPreflightEventEnvelopes,
  steelNativeStreamEventName,
} from './events';

describe('Steel native event mapping', () => {
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
          message: 'Saved Working Order Memory',
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

  it('includes table counts and active totals on captured tool events', () => {
    const events = buildSteelNativeEventEnvelopes({
      source: 'tool_result',
      conversationId: 'conversation_1',
      requestId: 'request_1',
      capture: {
        status: 'captured',
        result: {
          savedCounts: { price_evidence: 2 },
          totalSavedCounts: { price_evidence: 4 },
          totalTableCounts: {},
        },
      },
    });

    expect(events.map((entry) => entry.data)).toEqual([
      expect.objectContaining({
        type: 'memory_saved',
        totalSavedCounts: { price_evidence: 4 },
      }),
    ]);
  });

  it('does not emit events for routine skipped captures or empty save counts', () => {
    expect(
      buildSteelNativeEventEnvelopes({
        source: 'tool_result',
        capture: { status: 'skipped', reason: 'missing_tool_name' },
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
          message: 'Saved PaddleOCR preflight',
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
          message: 'Saved PaddleOCR preflight',
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

  it('maps OCR preprocessing chunk progress into native stream events', () => {
    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'pdf_chunks_ready', pageCount: 163, chunkCount: 4, source: 'uploaded' },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Uploaded pdf to S3 (163 pages / 4 chunks) (file:file-a)',
      }),
    ]);

    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'pdf_chunks_ready', pageCount: 106, chunkCount: 3, source: 'fetched' },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Fetched pdf chunks (106 pages / 3 chunks) (file:file-a)',
      }),
    ]);

    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'paddleocr_chunk_started', chunkIndex: 3, chunkCount: 5 },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Running paddleocr_vl in PaddleOCR (chunk 3/5) (file:file-a)',
      }),
    ]);

    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'paddleocr_chunk_saved', chunkIndex: 3, chunkCount: 5 },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Ran paddleocr_vl in PaddleOCR (chunk 3/5) (file:file-a)',
        parseStatus: 'partial',
      }),
      expect.objectContaining({
        type: 'memory_saved',
        source: 'ocr_preprocessing',
        message: 'Saved PaddleOCR preflight (chunk 3/5) (file:file-a)',
        savedCounts: { paddleocr_preflight: 1 },
      }),
    ]);

    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'organizer_chunk_started', chunkIndex: 3, chunkCount: 5 },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Running OCR markdown process (chunk 3/5) (file:file-a)',
      }),
    ]);

    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'organizer_chunk_saved', chunkIndex: 3, chunkCount: 5 },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Ran OCR markdown process (chunk 3/5) (file:file-a)',
        parseStatus: 'partial',
      }),
      expect.objectContaining({
        type: 'memory_saved',
        source: 'ocr_preprocessing',
        message: 'Saved OCR markdown (chunk 3/5) (file:file-a)',
        savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
      }),
    ]);

    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'merged_markdowns_read', chunkCount: 5 },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Read OCR markdowns (file:file-a: 5 chunks)',
      }),
    ]);

    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'processing_with_merged_markdown', chunkCount: 5 },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Processing pdf with OCR markdowns (file:file-a)',
      }),
    ]);

    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        ocrFileKey: 'file:file-a',
        progress: { stage: 'markdown_saved' },
      }),
    ).toEqual([]);
  });

  it('maps OCR preprocessing failures into UI-visible partial error activity', () => {
    expect(
      buildSteelOcrPreprocessingEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        messageId: 'message_2',
        ocrFileKey: 'file:file-a',
        progress: {
          stage: 'failed',
          errorMessage: 'organizer context exceeded token budget',
          missingPagesByFileKey: {
            'file:file-a': [1, 2, 4, 5],
          },
        },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'ocr preprocessing failed (file:file-a)',
        parseStatus: 'partial',
        errorMessage: 'organizer context exceeded token budget',
        failedKeys: ['file:file-a'],
        missingPagesByFileKey: {
          'file:file-a': [1, 2, 4, 5],
        },
      }),
    ]);
  });

  it('maps PaddleOCR preflight failures into UI-visible partial error activity', () => {
    expect(
      buildSteelPaddleOcrPreflightEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        messageId: 'message_2',
        preflight: {
          status: 'partial',
          attemptedKeys: ['file:file-a'],
          failedKeys: ['file:file-a'],
          errorMessage: 'provider timeout',
        },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'paddleocr_preflight',
        message: 'PaddleOCR preflight partial',
        parseStatus: 'partial',
        errorMessage: 'provider timeout',
        failedKeys: ['file:file-a'],
      }),
    ]);
  });
});
