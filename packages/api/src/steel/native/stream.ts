import { nanoid } from 'nanoid';
import { StepTypes } from 'librechat-data-provider';
import type { EventHandler } from '@librechat/agents';
import type { Response } from 'express';
import type { StreamEvent } from '~/types/events';
import type { DelegateOcrStreamEventPayload } from './delegate';
import type { SteelNativeHistory } from './events';
import { appendSteelNativeActivityEvent, steelNativeStreamEventName } from './events';
import { GenerationJobManager } from '~/stream/GenerationJobManager';
import { sendEvent } from '~/utils/events';

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

/** The request fields a Steel event emission reads. */
export interface SteelNativeEventRequest {
  _resumableJobCreatedAt?: number;
  steelNativeContext?: { steelHistory?: SteelNativeHistory };
}

/** A server-sent event a Steel workflow emits: activity envelopes and tool run steps. */
export interface SteelEmittedEvent {
  event: string;
  data: object;
}

export interface EmitSteelNativeEventsInput {
  events: readonly SteelEmittedEvent[];
  req?: SteelNativeEventRequest;
  res?: Response;
  streamId?: string | null;
  historyChanged?: boolean;
}

/**
 * Records Steel activity events in the turn's history, persists that history on
 * the resumable job, then emits every event through the job stream or, without
 * one, directly to the response.
 */
export async function emitSteelNativeEvents({
  events,
  req,
  res,
  streamId,
  historyChanged = false,
}: EmitSteelNativeEventsInput): Promise<void> {
  const history = req?.steelNativeContext?.steelHistory;
  let steelHistoryChanged = historyChanged;
  if (history) {
    for (const event of events) {
      if (event.event === steelNativeStreamEventName) {
        steelHistoryChanged =
          appendSteelNativeActivityEvent(history, event.data) || steelHistoryChanged;
      }
    }
  }
  const expectedCreatedAt = req?._resumableJobCreatedAt;
  if (steelHistoryChanged && streamId && history) {
    await GenerationJobManager.updateMetadata(
      streamId,
      { steelHistory: history },
      expectedCreatedAt,
    );
  }
  for (const event of events) {
    if (streamId) {
      await GenerationJobManager.emitChunk(
        streamId,
        event as StreamEvent,
        expectedCreatedAt == null ? undefined : { expectedCreatedAt },
      );
    } else if (typeof res?.write === 'function' && !res.writableEnded) {
      sendEvent(res, event as StreamEvent);
    }
  }
}
