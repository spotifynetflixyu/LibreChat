import { buildSteelNativeResponseMessageMetadata } from './metadata';

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
          contextMode: 'compact_workbook',
          renderProfile: 'open_responses',
          globalApplied: true,
          attachmentBytePolicy: 'metadata_references_only',
          ocrExecutionPolicy: 'agent_calls_run_file_ocr',
          rulePrefixOrder: steelNativeInstructionPrefixSections,
        },
      }),
    ).toEqual({
      steel: {
        native: {
          ingress: 'open_responses',
          nativeContextVersion: 1,
          contextMode: 'compact_workbook',
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
});
