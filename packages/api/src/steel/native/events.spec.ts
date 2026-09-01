import {
  appendSteelNativeActivityEvent,
  cloneSteelNativeHistory,
  upsertSteelNativePreflightToolCall,
  createSteelNativeHistory,
  ensureSteelNativeHistory,
  parseSteelNativeHistory,
  buildSteelCodeInterpreterAuditEvent,
  buildSteelQuoteAuditEvent,
  buildSteelNativeEventEnvelopes,
  buildSteelOcrPreprocessingEventEnvelopes,
  buildSteelPaddleOcrPreflightEventEnvelopes,
  steelNativeHistoryMaxBytes,
  steelNativeStreamEventName,
} from './events';

const memoryEvent = (message = 'Saved') => ({
  type: 'memory_saved' as const,
  source: 'tool_result' as const,
  message,
  savedCounts: { price_evidence: 1 },
});

describe('Steel native event mapping', () => {
  it('strictly parses and clones bounded history', () => {
    const history = createSteelNativeHistory();
    appendSteelNativeActivityEvent(history, memoryEvent('persisted'));

    const parsed = parseSteelNativeHistory(JSON.stringify(history));
    expect(parsed).toEqual(history);
    expect(parsed).not.toBe(history);
    expect(parsed?.activityEvents).not.toBe(history.activityEvents);

    const clone = cloneSteelNativeHistory(history);
    expect(clone).toEqual(history);
    expect(clone).not.toBe(history);
  });

  it('rejects malformed or over-budget persisted history', () => {
    expect(parseSteelNativeHistory('{bad json')).toBeUndefined();
    expect(
      parseSteelNativeHistory({
        activityEvents: [{ type: 'memory_saved' }],
        preflightToolCalls: [],
      }),
    ).toBeUndefined();

    const oversized = {
      activityEvents: Array.from({ length: 101 }, () => memoryEvent()),
      preflightToolCalls: [],
    };
    expect(parseSteelNativeHistory(oversized)).toBeUndefined();
  });

  it('reconstructs canonical history without unknown activity or preflight fields', () => {
    const history = parseSteelNativeHistory({
      activityEvents: [
        {
          ...memoryEvent('safe'),
          input_data: { raw: 'provider payload' },
          extras: { shouldNotPersist: true },
          missingPageRangesByFileKey: {
            'file:one': [{ pageStart: 1, pageEnd: 2, raw: 'provider payload' }],
          },
        },
      ],
      preflightToolCalls: [
        {
          type: 'tool_call',
          id: 'steel_paddleocr_preflight_pages_1_2',
          name: 'paddleocr_vl---PaddleOCR',
          args: {
            input_data:
              'https://files.example.test/chunk.pdf?X-Amz-Signature=debug-signature-value',
            output_mode: 'detailed',
            return_images: false,
            use_doc_orientation_classify: true,
            use_doc_unwarping: true,
            use_layout_detection: true,
          },
          progress: 0,
          extras: { raw: 'provider payload' },
        },
      ],
      rawProviderPayload: { shouldNotPersist: true },
    });

    expect(history).toEqual({
      activityEvents: [
        expect.objectContaining({
          type: 'memory_saved',
          source: 'tool_result',
          message: 'safe',
          savedCounts: { price_evidence: 1 },
        }),
      ],
      preflightToolCalls: [
        expect.objectContaining({
          type: 'tool_call',
          id: 'steel_paddleocr_preflight_pages_1_2',
          name: 'paddleocr_vl---PaddleOCR',
          progress: 0,
        }),
      ],
    });
    expect(history?.activityEvents[0]).not.toHaveProperty('input_data');
    expect(history?.activityEvents[0]).not.toHaveProperty('extras');
    expect(history?.preflightToolCalls[0]).not.toHaveProperty('extras');
    expect(history?.preflightToolCalls[0]?.args.input_data).toBe(
      'https://files.example.test/chunk.pdf?X-Amz-Signature=debug-signature-value',
    );
    expect(history?.activityEvents[0]).not.toHaveProperty('missingPageRangesByFileKey');

    const nestedRanges = parseSteelNativeHistory({
      activityEvents: [
        {
          type: 'parse_status',
          source: 'ocr_preprocessing',
          message: 'partial',
          parseStatus: 'partial',
          missingPageRangesByFileKey: {
            'file:one': [{ pageStart: 1, pageEnd: 2, raw: 'provider payload' }],
          },
        },
      ],
      preflightToolCalls: [],
    });
    expect(nestedRanges?.activityEvents[0]).toEqual(
      expect.objectContaining({
        missingPageRangesByFileKey: {
          'file:one': [{ pageStart: 1, pageEnd: 2 }],
        },
      }),
    );
  });

  it('sanitizes persisted error messages and preflight error output', () => {
    const errorMessage = [
      'provider failed',
      'https://user:password@example.test/report.pdf?X-Amz-Signature=secret&token=secret',
      'token=secret',
      'Bearer super-secret',
      'line\nnext\u0000part',
      'x'.repeat(600),
    ].join(' ');
    const sink: ReturnType<typeof memoryEvent>[] = [];

    expect(
      appendSteelNativeActivityEvent(sink, {
        type: 'parse_status',
        source: 'paddleocr_preflight',
        message: 'PaddleOCR preflight partial',
        parseStatus: 'partial',
        errorMessage,
      }),
    ).toBe(true);

    const persistedError = sink[0];
    expect(persistedError).toEqual(
      expect.objectContaining({
        errorMessage: expect.any(String),
      }),
    );
    const sanitized = (persistedError as { errorMessage?: string }).errorMessage;
    expect(sanitized).toContain('[redacted-url]');
    expect(sanitized).toContain('token=[REDACTED]');
    expect(sanitized).toContain('Bearer [REDACTED]');
    expect(sanitized).not.toContain('user:password@example.test');
    expect(sanitized).not.toContain('super-secret');
    expect(
      [...(sanitized ?? '')].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return (
          codePoint > 31 &&
          (codePoint < 127 || codePoint > 159) &&
          codePoint !== 0x2028 &&
          codePoint !== 0x2029
        );
      }),
    ).toBe(true);
    expect(sanitized?.length).toBeLessThanOrEqual(512);

    const legacyHistory = parseSteelNativeHistory({
      activityEvents: [],
      preflightToolCalls: [
        {
          type: 'tool_call',
          id: 'steel_paddleocr_preflight_pages_1_2',
          name: 'paddleocr_vl---PaddleOCR',
          args: {
            output_mode: 'detailed',
            return_images: false,
            use_doc_orientation_classify: true,
            use_doc_unwarping: true,
            use_layout_detection: true,
          },
          output: `Error: ${errorMessage}`,
          progress: 0,
        },
      ],
    });
    expect(legacyHistory?.preflightToolCalls[0]?.output).toContain('[redacted-url]');
    expect(legacyHistory?.preflightToolCalls[0]?.output).not.toContain('super-secret');

    const history = createSteelNativeHistory();
    expect(
      upsertSteelNativePreflightToolCall(history, {
        type: 'tool_call',
        id: 'steel_paddleocr_preflight_pages_1_2',
        name: 'paddleocr_vl---PaddleOCR',
        args: {
          output_mode: 'detailed',
          return_images: false,
          use_doc_orientation_classify: true,
          use_doc_unwarping: true,
          use_layout_detection: true,
        },
        output: `Error: ${errorMessage}`,
        progress: 0,
      }),
    ).toBe(false);

    const structuredFailure = {
      type: 'tool_call' as const,
      id: 'steel_paddleocr_preflight_pages_3_4',
      name: 'paddleocr_vl---PaddleOCR',
      args: {
        output_mode: 'detailed' as const,
        return_images: false,
        use_doc_orientation_classify: true,
        use_doc_unwarping: true,
        use_layout_detection: true,
      },
      output: JSON.stringify({
        status: 'failed',
        paddleocr: 'fail',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:pdf-1',
        filename: 'quote.pdf',
        chunkIndex: 1,
        chunkCount: 2,
        pageStart: 3,
        pageEnd: 4,
        attemptsUsed: 2,
        diagnosticCode: 'ai_studio_timeout',
        errorMessage: 'failed https://signed.example.test/?token=secret',
      }),
      progress: 1 as const,
    };
    expect(upsertSteelNativePreflightToolCall(history, structuredFailure)).toBe(true);
    const persistedFailure = JSON.parse(history.preflightToolCalls[0]?.output ?? '{}') as Record<
      string,
      unknown
    >;
    expect(persistedFailure).toEqual({
      status: 'fail',
      paddleocr: 'fail',
      ocrEngine: 'paddleocr_vl',
      ocrFileKey: 'file:pdf-1',
      filename: 'quote.pdf',
      chunkIndex: 1,
      chunkCount: 2,
      pageStart: 3,
      pageEnd: 4,
      dataSizeBytes: Buffer.byteLength(structuredFailure.output, 'utf8'),
      attemptsUsed: 2,
      errorCode: 'ai_studio_timeout',
      error: 'failed [redacted-url]',
      errorMessage: 'failed [redacted-url]',
    });
    expect(
      upsertSteelNativePreflightToolCall(history, {
        ...structuredFailure,
        output: JSON.stringify({ ...persistedFailure, rawProviderPayload: 'secret' }),
      }),
    ).toBe(false);
  });

  it('creates independent canonical histories', () => {
    const first = createSteelNativeHistory();
    const second = createSteelNativeHistory();

    expect(first).not.toBe(second);
    expect(first.activityEvents).not.toBe(second.activityEvents);
    expect(first.preflightToolCalls).not.toBe(second.preflightToolCalls);
  });

  it('upgrades legacy activity events without replacing their array', () => {
    const activityEvents = [memoryEvent('legacy')];
    const context: {
      steelActivityEvents: typeof activityEvents;
      steelHistory?: ReturnType<typeof createSteelNativeHistory>;
    } = { steelActivityEvents: activityEvents };

    const history = ensureSteelNativeHistory(context);

    expect(history.activityEvents).toBe(activityEvents);
    expect(history.preflightToolCalls).toEqual([]);
    expect(context.steelHistory).toBe(history);
    expect(context.steelActivityEvents).toBe(activityEvents);
  });

  it('prefers canonical history and repoints legacy alias', () => {
    const canonical = createSteelNativeHistory();
    const legacy = [memoryEvent('legacy')];
    const context = { steelHistory: canonical, steelActivityEvents: legacy };

    const history = ensureSteelNativeHistory(context);

    expect(history).toBe(canonical);
    expect(history.activityEvents).not.toBe(legacy);
    expect(context.steelActivityEvents).toBe(canonical.activityEvents);
  });

  it('appends validated events with bounded count and byte budgets', () => {
    const sink = [] as ReturnType<typeof memoryEvent>[];
    const identity = sink;

    expect(appendSteelNativeActivityEvent(sink, memoryEvent())).toBe(true);
    expect(sink).toHaveLength(1);
    expect(sink).toBe(identity);

    for (let index = 0; index < 110; index += 1) {
      appendSteelNativeActivityEvent(sink, memoryEvent(String(index)));
    }
    expect(sink).toHaveLength(100);
    expect(sink[0].message).toBe('10');
  });

  it('rejects malformed, oversized, and envelope values without throwing', () => {
    const sink = [] as ReturnType<typeof memoryEvent>[];
    const circular: Record<string, unknown> = {
      type: 'memory_saved',
      source: 'tool_result',
      message: 'circular',
      savedCounts: { price_evidence: 1 },
    };
    circular.self = circular;

    expect(
      appendSteelNativeActivityEvent(sink, {
        event: steelNativeStreamEventName,
        data: memoryEvent(),
      }),
    ).toBe(false);
    expect(
      appendSteelNativeActivityEvent(sink, { type: 'memory_saved', source: 'tool_result' }),
    ).toBe(false);
    expect(appendSteelNativeActivityEvent(sink, { ...memoryEvent('x'.repeat(20 * 1024)) })).toBe(
      false,
    );
    expect(() => appendSteelNativeActivityEvent(sink, circular)).not.toThrow();
    expect(sink).toEqual([]);
  });

  it('evicts oldest events to stay under total JSON byte budget', () => {
    const sink = [] as ReturnType<typeof memoryEvent>[];
    const payload = (index: number) => memoryEvent(`${index}-${'x'.repeat(14 * 1024)}`);

    for (let index = 0; index < 12; index += 1) {
      expect(appendSteelNativeActivityEvent(sink, payload(index))).toBe(true);
    }

    expect(sink.length).toBeLessThan(12);
    expect(Buffer.byteLength(JSON.stringify(sink), 'utf8')).toBeLessThanOrEqual(128 * 1024);
  });

  it('upserts PaddleOCR cards with full debug URLs under history budgets', () => {
    const history = createSteelNativeHistory();
    const card = {
      type: 'tool_call' as const,
      id: 'steel_paddleocr_preflight_pages_1_50',
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
        status: 'completed',
        paddleocr: 'ok',
        ocrEngine: 'paddleocr_vl',
        ocrFileKey: 'file:pdf-1',
        filename: 'quote.pdf',
        chunkIndex: 1,
        chunkCount: 1,
        pageStart: 1,
        pageEnd: 50,
        rawTextLength: 12,
        rawResultHash: 'hash',
        outputStorage: 'steel_working_order_memory:paddleocr_preflight',
      }),
      progress: 0 as const,
    };
    const identity = history.preflightToolCalls;
    expect(upsertSteelNativePreflightToolCall(history, card)).toBe(true);
    expect(history.preflightToolCalls).toBe(identity);
    expect(upsertSteelNativePreflightToolCall(history, { ...card, progress: 1 })).toBe(true);
    expect(history.preflightToolCalls).toHaveLength(1);
    expect(history.preflightToolCalls[0]?.progress).toBe(1);
    expect(history.preflightToolCalls[0]?.args.input_data).toBe(
      'https://files.example.test/chunk.pdf?signature=full-debug-value',
    );
    expect(JSON.parse(history.preflightToolCalls[0]?.output ?? '')).toEqual({
      status: 'ok',
      paddleocr: 'ok',
      ocrEngine: 'paddleocr_vl',
      ocrFileKey: 'file:pdf-1',
      filename: 'quote.pdf',
      chunkIndex: 1,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 50,
      dataSizeBytes: 12,
    });
    expect(
      upsertSteelNativePreflightToolCall(history, {
        ...card,
        args: { ...card.args, unexpected: 'raw provider payload' },
      }),
    ).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(history), 'utf8')).toBeLessThanOrEqual(128 * 1024);

    for (let index = 0; index < 100; index += 1) {
      appendSteelNativeActivityEvent(history, memoryEvent(`${index}-${'x'.repeat(1400)}`));
    }
    expect(Buffer.byteLength(JSON.stringify(history), 'utf8')).toBeLessThanOrEqual(128 * 1024);
  });

  it('preserves oversized preflight params and rejects oversized results', () => {
    const history = createSteelNativeHistory();
    const inputData = `https://files.example.test/chunk.pdf?${'signature=x'.repeat(2_000)}`;
    const card = {
      type: 'tool_call' as const,
      id: 'steel_paddleocr_preflight_large_params',
      name: 'paddleocr_vl---PaddleOCR',
      args: {
        input_data: inputData,
        output_mode: 'detailed' as const,
        return_images: false,
        use_doc_orientation_classify: true,
        use_doc_unwarping: true,
        use_layout_detection: true,
      },
      progress: 1 as const,
    };

    expect(upsertSteelNativePreflightToolCall(history, card)).toBe(true);
    expect(history.preflightToolCalls[0]?.args.input_data).toBe(inputData);
    expect(
      upsertSteelNativePreflightToolCall(history, {
        ...card,
        output: 'x'.repeat(4 * 1024 + 1),
      }),
    ).toBe(false);
  });

  it('evicts complete oldest cards before history reaches the Mongo-safe byte budget', () => {
    const history = createSteelNativeHistory();
    const inputData = `https://files.example.test/chunk.pdf?payload=${'x'.repeat(1024 * 1024)}`;

    for (let index = 0; index < 13; index += 1) {
      expect(
        upsertSteelNativePreflightToolCall(history, {
          type: 'tool_call',
          id: `steel_paddleocr_preflight_large_${index}`,
          name: 'paddleocr_vl---PaddleOCR',
          args: {
            input_data: `${inputData}${index}`,
            output_mode: 'detailed',
            return_images: false,
            use_doc_orientation_classify: true,
            use_doc_unwarping: true,
            use_layout_detection: true,
          },
          progress: 0,
        }),
      ).toBe(true);
    }

    expect(history.preflightToolCalls.length).toBeLessThan(13);
    expect(history.preflightToolCalls.at(-1)?.args.input_data).toBe(`${inputData}12`);
    expect(Buffer.byteLength(JSON.stringify(history), 'utf8')).toBeLessThanOrEqual(
      steelNativeHistoryMaxBytes,
    );
  });

  it('rejects unsafe quote source and missing page ranges', () => {
    const sink = [] as ReturnType<typeof memoryEvent>[];
    expect(
      appendSteelNativeActivityEvent(sink, {
        type: 'quote_audit',
        source: 'tool_result',
        stage: 'stage_2',
        status: 'started',
        message: 'Stage 2 started',
      }),
    ).toBe(false);
    expect(
      appendSteelNativeActivityEvent(sink, {
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'failed',
        parseStatus: 'partial',
        missingPageRangesByFileKey: { 'file-1': [{ pageStart: 0, pageEnd: 2 }] },
      }),
    ).toBe(false);
  });

  it('builds a Stage 2 quote audit event with trace ids', () => {
    expect(
      buildSteelQuoteAuditEvent({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        messageId: 'message_1',
      }),
    ).toEqual({
      type: 'quote_audit',
      source: 'quote_runtime',
      stage: 'stage_2',
      status: 'started',
      message: 'Stage 2 started',
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_1',
    });
  });

  it('builds an exact positive Code Interpreter audit event', () => {
    expect(
      buildSteelCodeInterpreterAuditEvent({
        stage: 'stage_1',
        conversationId: 'conversation_1',
        requestId: 'request_1',
        messageId: 'message_1',
        providerToolCallId: 'call_python',
      }),
    ).toEqual({
      type: 'quote_audit',
      source: 'quote_runtime',
      stage: 'stage_1',
      status: 'executed',
      message: 'Code Interpreter executed',
      toolName: 'code_interpreter',
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_1',
      providerToolCallId: 'call_python',
    });
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
        paddleOcrSavedCount: 1,
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

  it('maps cached completed PaddleOCR preflight into reused saved activity', () => {
    const events = buildSteelPaddleOcrPreflightEventEnvelopes({
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_2',
      preflight: {
        status: 'completed',
        completedKeys: ['file:file-a'],
        attemptedKeys: ['file:file-a'],
        failedKeys: [],
        paddleOcrSavedCount: 0,
      },
    });

    expect(events).toEqual([
      {
        event: steelNativeStreamEventName,
        data: {
          type: 'parse_status',
          message: 'Reused PaddleOCR preflight',
          parseStatus: 'saved',
          source: 'paddleocr_preflight',
          conversationId: 'conversation_1',
          requestId: 'request_1',
          messageId: 'message_2',
        },
      },
    ]);
  });

  it('does not emit PaddleOCR activity when no current files are present', () => {
    expect(
      buildSteelPaddleOcrPreflightEventEnvelopes({
        conversationId: 'conversation_1',
        requestId: 'request_1',
        messageId: 'message_2',
        preflight: {
          status: 'skipped',
          attemptedKeys: [],
          failedKeys: [],
          skippedReason: 'no_current_files',
          paddleOcrSavedCount: 0,
        },
      }),
    ).toEqual([]);
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
        progress: { stage: 'paddleocr_chunk_loaded', chunkIndex: 2, chunkCount: 5 },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Loaded saved PaddleOCR (chunk 2/5) (file:file-a)',
        parseStatus: 'partial',
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
        progress: { stage: 'organizer_chunk_loaded', chunkIndex: 2, chunkCount: 5 },
      }).map((entry) => entry.data),
    ).toEqual([
      expect.objectContaining({
        type: 'parse_status',
        source: 'ocr_preprocessing',
        message: 'Loaded saved OCR markdown (chunk 2/5) (file:file-a)',
        parseStatus: 'partial',
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
          missingPageRangesByFileKey: {
            'file:file-a': [
              { pageStart: 1, pageEnd: 2 },
              { pageStart: 4, pageEnd: 5 },
            ],
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
        missingPageRangesByFileKey: {
          'file:file-a': [
            { pageStart: 1, pageEnd: 2 },
            { pageStart: 4, pageEnd: 5 },
          ],
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
