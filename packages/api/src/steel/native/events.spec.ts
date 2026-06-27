import {
  buildSteelNativeEventEnvelopes,
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
});
