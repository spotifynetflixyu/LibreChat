import { ContentTypes } from 'librechat-data-provider';
import type { Agents, TMessageContentParts } from 'librechat-data-provider';

/**
 * Folds a native context-compaction event into a response's content as a
 * summary marker. Returns `undefined` when the event must not change the
 * content: a terminal event without its start marker is an out-of-order
 * replay (persisted markers are already present on resume), and a terminal
 * marker is final, so late starts and conflicting terminal phases cannot
 * regress a completed, failed, or cancelled card.
 */
export function applyCompactionMarker(
  content: TMessageContentParts[] | undefined,
  compaction: Agents.OAuthCompactionEvent,
): TMessageContentParts[] | undefined {
  const next = [...(content ?? [])];
  const existingIndex = next.findIndex(
    (part) =>
      part?.type === ContentTypes.SUMMARY &&
      part.nativeCompaction?.id === compaction.id &&
      part.nativeCompaction.agentId === compaction.agentId &&
      part.nativeCompaction.runId === compaction.runId,
  );

  if (existingIndex < 0) {
    if (compaction.phase !== 'started') {
      return undefined;
    }
    next.push({
      type: ContentTypes.SUMMARY,
      content: [],
      nativeCompaction: compaction,
      agentId: compaction.agentId,
    });
    return next;
  }

  const existing = next[existingIndex];
  if (existing?.type !== ContentTypes.SUMMARY || !existing.nativeCompaction) {
    return undefined;
  }
  if (
    existing.nativeCompaction.phase !== 'started' &&
    compaction.phase !== existing.nativeCompaction.phase
  ) {
    return undefined;
  }
  next[existingIndex] = { ...existing, nativeCompaction: compaction };
  return next;
}
