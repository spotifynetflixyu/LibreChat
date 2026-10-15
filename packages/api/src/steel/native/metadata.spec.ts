import type { SteelNativePreflightToolCall } from './events';
import {
  buildSteelAgentMessageMetadata,
  buildSteelNativeResponseMessageMetadata,
} from './metadata';
import { buildSteelDelegateOcrStatusEvent, createSteelNativeHistory } from './events';
import { steelNativeInstructionPrefixSections } from './context';

describe('Steel native response metadata', () => {
  it('builds auditable Open Responses message metadata', () => {
    expect(
      buildSteelNativeResponseMessageMetadata({
        conversationId: 'convo-1',
        responseId: 'resp-1',
        turnIndex: 8,
        checkpointTurnIndex: 7,
        requestedStore: false,
        store: true,
        providerStateMode: 'openai_responses_reconstructed',
        contextMetadata: {
          nativeContextVersion: 1,
          mode: 'standard',
          renderProfile: 'open_responses',
          globalApplied: true,
          attachmentBytePolicy: 'metadata_references_only',
          ocrExecutionPolicy: 'preflight_paddleocr_only',
          rulePrefixOrder: steelNativeInstructionPrefixSections,
        },
      }),
    ).toEqual({
      steel: {
        native: {
          ingress: 'open_responses',
          nativeContextVersion: 1,
          mode: 'standard',
          renderProfile: 'open_responses',
          globalApplied: true,
          providerStateMode: 'openai_responses_reconstructed',
          conversationId: 'convo-1',
          responseId: 'resp-1',
          turnIndex: 8,
          checkpointTurnIndex: 7,
          storage: {
            requestedStore: false,
            store: true,
            durable: true,
          },
        },
      },
    });
  });

  it('includes bounded activity events without dropping native storage metadata', () => {
    const activityEvents = [
      buildSteelDelegateOcrStatusEvent({
        conversationId: 'convo-1',
        delegateOcrIndex: 1,
        stage: 'paddleocr',
        status: 'started',
        message: 'OCR started',
      }),
    ];
    expect(
      buildSteelNativeResponseMessageMetadata({
        conversationId: 'convo-1',
        responseId: 'resp-1',
        store: false,
        activityEvents,
      }),
    ).toEqual({
      steel: {
        activityEvents,
        native: {
          ingress: 'open_responses',
          conversationId: 'convo-1',
          responseId: 'resp-1',
          storage: {
            requestedStore: null,
            store: false,
            durable: false,
          },
        },
      },
    });
  });

  it('persists preflight tool cards alongside native activity events', () => {
    const preflightToolCalls = [
      {
        type: 'tool_call' as const,
        id: 'paddle-1',
        name: 'paddleocr_vl_mcp_PaddleOCR',
        args: {
          input_data: 'https://files.example.test/chunk.pdf?signature=debug-value',
          output_mode: 'detailed' as const,
          return_images: false,
          use_doc_orientation_classify: true,
          use_doc_unwarping: true,
          use_layout_detection: true,
        },
        progress: 0 as const,
      },
    ];
    expect(
      buildSteelNativeResponseMessageMetadata({
        store: false,
        preflightToolCalls,
      }),
    ).toEqual({
      steel: {
        preflightToolCalls,
        native: {
          ingress: 'open_responses',
          storage: { requestedStore: null, store: false, durable: false },
        },
      },
    });
  });
});

describe('buildSteelAgentMessageMetadata', () => {
  it('omits the block when nothing was captured and copies captured history', () => {
    expect(buildSteelAgentMessageMetadata(undefined, createSteelNativeHistory())).toBeUndefined();
    const history = createSteelNativeHistory();
    history.preflightToolCalls.push({ id: 'card-1' } as SteelNativePreflightToolCall);
    const metadata = buildSteelAgentMessageMetadata(undefined, history);
    expect(metadata).toEqual({ preflightToolCalls: [{ id: 'card-1' }] });
    expect(metadata?.preflightToolCalls).not.toBe(history.preflightToolCalls);
  });
});
