import { nanoid } from 'nanoid';
import { StepTypes, ContentTypes, steelContentResetEvent } from 'librechat-data-provider';
import type { Agents } from 'librechat-data-provider';
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
  return phase === 'delta' || phase === 'complete' || phase === 'error' || phase === 'reset';
}

/** Clears one run step's streamed text or reasoning in the turn's aggregated content and on the client. */
export type SteelStepTextReset = (stepId: string) => Promise<void>;

export interface CreateSteelStepTextResetInput {
  contentParts?: Agents.MessageContentComplex[] | null;
  stepMap?: Map<string, { index: number }> | null;
  emit(event: { event: string; data: object }): Promise<void>;
}

/**
 * The reset a retried Steel attempt runs before it streams again: the step's
 * text part is emptied in place, so later deltas, the resume snapshot and the
 * saved message all continue from the new attempt only.
 */
export function createSteelStepTextReset({
  contentParts,
  stepMap,
  emit,
}: CreateSteelStepTextResetInput): SteelStepTextReset {
  return async (stepId) => {
    const index = stepMap?.get(stepId)?.index;
    const part = index === undefined ? undefined : contentParts?.[index];
    if (index === undefined || !contentParts || !part) {
      return;
    }
    if (part.type === ContentTypes.TEXT) {
      contentParts[index] = { ...part, text: '' };
    } else if (part.type === ContentTypes.THINK) {
      contentParts[index] = { ...part, think: '' };
    } else {
      return;
    }
    await emit({ event: steelContentResetEvent, data: { id: stepId } });
  };
}

/**
 * Streams delegate_ocr deltas into the assistant message as one message-creation
 * step per run and provider tool call, so the OCR answer renders while it is produced.
 * A `reset` clears that step's text before a retried attempt streams into it again.
 */
export function createDelegateOcrStreamHandler(resetStepText?: SteelStepTextReset): EventHandler {
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
      if (data.phase === 'reset') {
        const messageStepId = messageStepIds.get(streamKey);
        if (messageStepId) {
          await resetStepText?.(messageStepId);
        }
        return;
      }
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
