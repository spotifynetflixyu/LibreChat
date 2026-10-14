import type * as t from '~/types';
import { appendSteelNativeActivityEvent, createSteelNativeHistory } from './events';

export type SteelReplayEvent = t.StreamEvent & {
  event: 'steel_event';
  data: Record<string, unknown>;
};

export function isSteelReplayEvent(event: unknown): event is SteelReplayEvent {
  return (
    event != null &&
    typeof event === 'object' &&
    'event' in event &&
    event.event === 'steel_event' &&
    'data' in event &&
    event.data != null &&
    typeof event.data === 'object' &&
    !Array.isArray(event.data)
  );
}

export function getStableSteelReplayEventKey(event: unknown): string | undefined {
  if (!isSteelReplayEvent(event)) {
    return undefined;
  }
  try {
    return JSON.stringify(event);
  } catch {
    return undefined;
  }
}

/**
 * Keeps only the Steel replay events the bounded activity history would accept,
 * in one pass. Non-Steel events are untouched.
 */
export function sanitizeSteelReplayEvents(replayEvents: t.ServerSentEvent[]): void {
  const history = createSteelNativeHistory();
  const acceptedSteelEvents: t.ServerSentEvent[] = [];

  for (const event of replayEvents) {
    if (!isSteelReplayEvent(event) || !appendSteelNativeActivityEvent(history, event.data)) {
      continue;
    }
    acceptedSteelEvents.push(event);
    if (acceptedSteelEvents.length > history.activityEvents.length) {
      acceptedSteelEvents.splice(0, acceptedSteelEvents.length - history.activityEvents.length);
    }
  }

  const accepted = new Set(acceptedSteelEvents);
  const kept = replayEvents.filter((event) => !isSteelReplayEvent(event) || accepted.has(event));
  replayEvents.splice(0, replayEvents.length, ...kept);
}
