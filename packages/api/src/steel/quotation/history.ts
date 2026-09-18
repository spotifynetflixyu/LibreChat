import mongoose from 'mongoose';

import type { SteelQuotationScope } from '@librechat/data-schemas';
import type { SteelNativeHistory, SteelNativePreflightToolCall } from '../native/events';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';

import { createSteelQuotationStateService } from './state';
import {
  createSteelNativeHistory,
  appendSteelNativeActivityEvent,
  buildSteelQuotationStatusEvent,
  upsertSteelNativePreflightToolCall,
} from '../native/events';

export interface SavedQuotationLookup {
  lookupCallId: string;
  arguments: SteelToolJsonObject;
  result: SteelToolResult;
}

/** Quote steps share content slots with the signal and final response text. */
export function upsertQuotationToolContent(parts: unknown[], call: SteelNativePreflightToolCall): number {
  const found = parts.findIndex((part) => {
    const value = part as { type?: string; tool_call?: { id?: string } } | undefined;
    return value?.type === 'tool_call' && value.tool_call?.id === call.id;
  });
  const index = found < 0 ? parts.length : found;
  const previous = parts[index] as { tool_call?: Record<string, unknown> } | undefined;
  parts[index] = {
    type: 'tool_call',
    tool_call: {
      ...previous?.tool_call,
      type: 'tool_call',
      id: call.id,
      name: call.name,
      args: JSON.stringify(call.args),
      ...(call.output !== undefined ? { output: call.output } : {}),
      progress: call.progress,
    },
  };
  return index;
}

export function getQuotationHistoryDelta(current: SteelNativeHistory, restored: SteelNativeHistory): SteelNativeHistory {
  return {
    preflightToolCalls: restored.preflightToolCalls.filter((call) =>
      !current.preflightToolCalls.some((saved) => saved.id === call.id && JSON.stringify(saved) === JSON.stringify(call)),
    ),
    activityEvents: restored.activityEvents.filter((event) =>
      !current.activityEvents.some((saved) => saved.type === 'quotation_status' && event.type === 'quotation_status' &&
        saved.runId === event.runId && saved.index === event.index && saved.stage === event.stage &&
        saved.status === event.status && saved.chunkIndex === event.chunkIndex && saved.attempt === event.attempt &&
        saved.completedChunks === event.completedChunks && saved.totalChunks === event.totalChunks),
    ),
  };
}

export async function readQuotationHistory(input: {
  scope: SteelQuotationScope;
  runId: string;
}): Promise<SteelNativeHistory> {
  const history = createSteelNativeHistory();
  const service = createSteelQuotationStateService(mongoose);
  const state = await service.readState(input.scope);
  const run = state?.activeRun;
  if (!run || run.runId !== input.runId) return history;
  if (run.status === 'queued' && run.checkpointRefs.every((ref) => ref.kind === 'snapshot')) return history;

  const lookups = await Promise.all(run.checkpointRefs
    .filter((ref) => ref.kind === 'tool' && ref.operationId.startsWith('lookup:'))
    .map(async (ref) => ({
      operationId: ref.operationId,
      payload: await service.readArtifact({ scope: input.scope, ref: { ...ref, ...input.scope, runId: run.runId } }),
    })));
  for (const { operationId, payload } of lookups) {
    const match = /^lookup:(\d+):([^:]+):(.+)$/u.exec(operationId);
    if (!match || !payload || !run.chunks.some((chunk) => chunk.index === Number(match[1]))) continue;
    try {
      const lookup = JSON.parse(payload) as SavedQuotationLookup;
      if (lookup?.lookupCallId !== match[3] || lookup.result?.toolName !== 'search_price_candidates') continue;
      upsertSteelNativePreflightToolCall(history, {
        type: 'tool_call',
        id: `quotation:${run.runId}:${match[1]}:${match[2]}:${lookup.lookupCallId}`,
        name: 'search_price_candidates',
        args: lookup.arguments,
        output: JSON.stringify(lookup.result),
        progress: 1,
      });
    } catch {
      continue;
    }
  }

  const completed = run.chunks.filter((chunk) => chunk.status === 'completed' && chunk.checkpointRef);
  const base = { conversationId: input.scope.conversationId, runId: run.runId, index: run.index, totalChunks: run.chunks.length };
  for (let index = 0; index < completed.length; index += 1) {
    appendSteelNativeActivityEvent(history, buildSteelQuotationStatusEvent({
      ...base,
      stage: 'chunk_saved',
      status: 'running',
      chunkIndex: completed[index]!.index,
      completedChunks: index + 1,
      message: 'Restored from saved quotation checkpoints',
    }));
  }
  appendSteelNativeActivityEvent(history, buildSteelQuotationStatusEvent({
    ...base,
    stage: run.status,
    status: run.status,
    completedChunks: completed.length,
    message: 'Restored from saved quotation checkpoints',
  }));
  return history;
}
