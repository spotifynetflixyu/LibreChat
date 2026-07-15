import { captureSteelNativeToolResult } from './tool-result';

describe('Steel native tool-result capture', () => {
  it('requires a provider tool call ID for price capture', async () => {
    const captureToolResult = jest.fn();

    await expect(
      captureSteelNativeToolResult({
        writer: { captureToolResult },
        conversationId: 'conversation_1',
        turnIndex: 2,
        result: {
          ok: true,
          toolName: 'search_price_candidates',
          data: { queryResults: [] },
          sourceRefs: [],
          durationMs: 1,
          redactionVersion: 1,
        },
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'missing_provider_tool_call_id' });
    expect(captureToolResult).not.toHaveBeenCalled();
  });

  it('captures customer results with the retained writer contract', async () => {
    const captureToolResult = jest.fn().mockResolvedValue({ savedCounts: { customer_fact: 1 } });
    const result = await captureSteelNativeToolResult({
      writer: { captureToolResult },
      conversationId: 'conversation_1',
      requestId: 'request_1',
      turnIndex: 2,
      result: {
        ok: true,
        toolName: 'search_customers',
        data: { customers: [] },
        sourceRefs: [],
        durationMs: 1,
        redactionVersion: 1,
      },
    });

    expect(result).toEqual({ status: 'captured', result: { savedCounts: { customer_fact: 1 } } });
    expect(captureToolResult).toHaveBeenCalledWith({
      conversationId: 'conversation_1',
      requestId: 'request_1',
      providerToolCallId: undefined,
      toolName: 'search_customers',
      turnIndex: 2,
      checkpointTurnIndex: 1,
      data: { customers: [] },
    });
  });
});
