import { nanoid } from 'nanoid';
import { StepTypes } from 'librechat-data-provider';
import type { EventHandler } from '@librechat/agents';
import type { DelegateOcrStreamEventPayload } from './delegate';

function isDelegateOcrStreamEventPayload(value: unknown): value is DelegateOcrStreamEventPayload {
  if (value == null || typeof value !== 'object') return false;
  const phase = (value as { phase?: unknown }).phase;
  return phase === 'delta' || phase === 'complete' || phase === 'error';
}

/**
 * Streams delegate_ocr deltas into the assistant message as one message-creation
 * step per run and provider tool call, so the OCR answer renders while it is produced.
 */
export function createDelegateOcrStreamHandler(): EventHandler {
  const messageStepIds = new Map<string, string>();

  return {
    handle: async (_event, data, metadata, graph) => {
      if (!graph || !isDelegateOcrStreamEventPayload(data)) return;
      const providerToolCallId = data.providerToolCallId;
      if (typeof providerToolCallId !== 'string' || providerToolCallId === '') return;

      const metadataRunId = metadata?.run_id;
      const runId =
        typeof metadataRunId === 'string' && metadataRunId !== '' ? metadataRunId : graph.runId || 'run';
      const streamKey = `${runId}:${providerToolCallId}`;
      if (data.phase !== 'delta') {
        messageStepIds.delete(streamKey);
        return;
      }
      if (data.delta === '') return;

      let messageStepId = messageStepIds.get(streamKey);
      if (!messageStepId) {
        messageStepId = await graph.dispatchRunStep(
          `delegate_ocr_stream:${streamKey}:${nanoid()}`,
          { type: StepTypes.MESSAGE_CREATION, message_creation: { message_id: streamKey } },
          metadata,
        );
        messageStepIds.set(streamKey, messageStepId);
      }

      await graph.dispatchMessageDelta(
        messageStepId,
        { content: [{ type: 'text', text: data.delta, tool_call_ids: [providerToolCallId] }] },
        metadata,
      );
    },
  };
}
