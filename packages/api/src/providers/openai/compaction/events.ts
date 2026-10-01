import { ContentTypes } from 'librechat-data-provider';
import type { OAuthCompactionEvent, TMessageContentParts } from 'librechat-data-provider';
import type { EventHandler } from '@librechat/agents';

const eventName = 'on_context_compaction';

function readEvent(value: unknown): OAuthCompactionEvent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if ('input' in value) {
    value = value.input;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (
    !('id' in value) ||
    !('runId' in value) ||
    !('agentId' in value) ||
    !('executionId' in value) ||
    !('phase' in value)
  ) {
    return null;
  }
  const { id, runId, agentId, executionId, phase } = value;
  if (
    typeof id !== 'string' ||
    typeof runId !== 'string' ||
    typeof agentId !== 'string' ||
    typeof executionId !== 'string'
  ) {
    return null;
  }
  if ([id, runId, agentId, executionId].some((field) => field.length === 0 || field.length > 512)) {
    return null;
  }
  if (phase !== 'started' && phase !== 'completed' && phase !== 'failed' && phase !== 'cancelled') {
    return null;
  }
  return { id, runId, agentId, executionId, phase };
}

export function createOAuthCompactionEventHandler({
  contentParts,
  emitForJob,
}: {
  contentParts?: TMessageContentParts[];
  emitForJob: (event: { event: string; data: OAuthCompactionEvent }) => Promise<void>;
}): EventHandler {
  return {
    handle: async (_event, value, metadata) => {
      const data = readEvent(value);
      if (!data) {
        return;
      }
      if (metadata?.hide_sequential_outputs === true && data.agentId !== metadata.last_agent_id) {
        return;
      }
      const existing = contentParts?.find(
        (part) => part?.type === ContentTypes.SUMMARY && part.nativeCompaction?.id === data.id,
      );
      if (existing?.type === ContentTypes.SUMMARY) {
        if (existing.nativeCompaction?.phase !== 'started') {
          return;
        }
        existing.nativeCompaction = data;
      } else {
        contentParts?.push({ type: ContentTypes.SUMMARY, content: [], nativeCompaction: data });
      }
      await emitForJob({ event: eventName, data });
    },
  };
}
