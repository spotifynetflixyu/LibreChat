import type {
  CaptureSteelNativeAssistantMarkdownResult,
  CaptureSteelNativeToolResultResult,
} from './markdown';

export const steelNativeStreamEventName = 'steel_event' as const;

export type SteelNativeEventSource =
  | 'assistant_markdown'
  | 'responses_output'
  | 'tool_result';

export type SteelNativeSavedCounts = Record<string, number>;

export interface SteelNativeEventBase {
  source: SteelNativeEventSource;
  conversationId?: string;
  requestId?: string;
  messageId?: string;
  toolName?: string;
  providerToolCallId?: string;
}

export interface SteelNativeParseStatusEvent extends SteelNativeEventBase {
  type: 'parse_status';
  message: string;
  parseStatus: 'saved' | 'partial' | 'skipped';
  savedCounts?: SteelNativeSavedCounts;
}

export interface SteelNativeMemorySavedEvent extends SteelNativeEventBase {
  type: 'memory_saved';
  message: string;
  savedCounts: SteelNativeSavedCounts;
}

export type SteelNativeStreamEvent = SteelNativeParseStatusEvent | SteelNativeMemorySavedEvent;

export interface SteelNativeEventEnvelope {
  event: typeof steelNativeStreamEventName;
  data: SteelNativeStreamEvent;
}

export interface BuildSteelNativeEventEnvelopesInput extends SteelNativeEventBase {
  capture: CaptureSteelNativeAssistantMarkdownResult | CaptureSteelNativeToolResultResult;
}

function hasSavedCounts(savedCounts?: SteelNativeSavedCounts): savedCounts is SteelNativeSavedCounts {
  if (!savedCounts) {
    return false;
  }

  return Object.values(savedCounts).some((count) => Number.isFinite(count) && count > 0);
}

function baseEvent(input: SteelNativeEventBase): SteelNativeEventBase {
  return {
    source: input.source,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.providerToolCallId ? { providerToolCallId: input.providerToolCallId } : {}),
  };
}

export function buildSteelNativeEventEnvelopes({
  capture,
  ...input
}: BuildSteelNativeEventEnvelopesInput): SteelNativeEventEnvelope[] {
  if (capture.status !== 'captured') {
    return [];
  }

  const events: SteelNativeEventEnvelope[] = [];
  const eventBase = baseEvent(input);

  if ('parseStatus' in capture.result) {
    const savedCounts = hasSavedCounts(capture.result.savedCounts)
      ? capture.result.savedCounts
      : undefined;
    events.push({
      event: steelNativeStreamEventName,
      data: {
        type: 'parse_status',
        message: `Markdown parse ${capture.result.parseStatus}`,
        parseStatus: capture.result.parseStatus,
        ...(savedCounts ? { savedCounts } : {}),
        ...eventBase,
      },
    });
  }

  if (hasSavedCounts(capture.result.savedCounts)) {
    events.push({
      event: steelNativeStreamEventName,
      data: {
        type: 'memory_saved',
        message: 'Working Order Memory saved',
        savedCounts: capture.result.savedCounts,
        ...eventBase,
      },
    });
  }

  return events;
}
