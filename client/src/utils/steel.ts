import {
  ContentTypes,
  ToolCallTypes,
  isFailedSteelPreflightOutput,
  parseSteelNativePreflightToolCall,
} from 'librechat-data-provider';
import type {
  TMessage,
  TMessageContentParts,
  SteelNativePreflightToolCall,
} from 'librechat-data-provider';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function getPersistedSteelActivityEvents(
  metadata: TMessage['metadata'],
): readonly unknown[] | undefined {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.steel)) {
    return undefined;
  }

  const activityEvents = metadata.steel.activityEvents;
  return Array.isArray(activityEvents) ? activityEvents : undefined;
}

function toPreflightToolCallPart(card: SteelNativePreflightToolCall): TMessageContentParts {
  return {
    type: ContentTypes.TOOL_CALL,
    tool_call: {
      type: ToolCallTypes.TOOL_CALL,
      id: card.id,
      name: card.name,
      args: { ...card.args },
      ...(card.output !== undefined
        ? {
            output: card.output,
            runStepStatus: isFailedSteelPreflightOutput(card.output) ? 'failed' : 'completed',
          }
        : {}),
      progress: card.progress,
    },
  } as TMessageContentParts;
}

export function getPersistedSteelPreflightToolCallParts(
  metadata: TMessage['metadata'],
): TMessageContentParts[] {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.steel)) {
    return [];
  }
  const cards = metadata.steel.preflightToolCalls;
  if (!Array.isArray(cards)) {
    return [];
  }
  const seen = new Set<string>();
  const parts: TMessageContentParts[] = [];
  for (const card of cards) {
    if (seen.size >= 100) {
      break;
    }
    const parsed = parseSteelNativePreflightToolCall(card);
    if (!parsed || seen.has(parsed.id)) {
      continue;
    }
    seen.add(parsed.id);
    parts.push(toPreflightToolCallPart(parsed));
  }
  return parts;
}

export function prependPersistedSteelPreflightToolCallParts(
  content: Array<TMessageContentParts | undefined> | undefined,
  persistedPreflightToolCallParts: TMessageContentParts[],
): Array<TMessageContentParts | undefined> {
  const safeContent = Array.isArray(content) ? content : [];
  if (persistedPreflightToolCallParts.length === 0) {
    return safeContent;
  }
  const existingToolCallIds = new Set<string>();
  for (const part of safeContent) {
    if (part?.type !== ContentTypes.TOOL_CALL) {
      continue;
    }
    const id = (part[ContentTypes.TOOL_CALL] as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && id.length > 0) {
      existingToolCallIds.add(id);
    }
  }
  return [
    ...persistedPreflightToolCallParts.filter(
      (part) => !existingToolCallIds.has((part[ContentTypes.TOOL_CALL] as { id: string }).id),
    ),
    ...safeContent,
  ];
}

type SteelErrorResponse = {
  status?: unknown;
  data?: { code?: unknown; recovery?: unknown };
};

/** The HTTP status and body of a failed Steel API call, from an axios-shaped error. */
export function getSteelErrorResponse(error: unknown): SteelErrorResponse | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = error.response;
  return typeof response === 'object' && response !== null
    ? (response as SteelErrorResponse)
    : undefined;
}

/** Empties one streamed text or reasoning part so a retried Steel attempt can stream over it. */
export function clearSteelStepText(message: TMessage, index: number): TMessage | undefined {
  const part = message.content?.[index];
  if (!message.content || !part) {
    return undefined;
  }
  let cleared: TMessageContentParts;
  if (part.type === ContentTypes.TEXT) {
    cleared = { ...part, text: '' };
  } else if (part.type === ContentTypes.THINK) {
    cleared = { ...part, think: '' };
  } else {
    return undefined;
  }
  const content = [...message.content];
  content[index] = cleared;
  return { ...message, content };
}
