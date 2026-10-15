import { useMemo } from 'react';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';
import {
  getPersistedSteelActivityEvents,
  getPersistedSteelPreflightToolCallParts,
  prependPersistedSteelPreflightToolCallParts,
} from '~/utils/steel';

/** Restores persisted Steel activity events and preflight tool-call cards for a rendered message. */
export default function useSteelMessageContent(
  message: Pick<TMessage, 'metadata' | 'content'> | null | undefined,
): {
  persistedActivityEvents: readonly unknown[] | undefined;
  content: Array<TMessageContentParts | undefined>;
} {
  const metadata = message?.metadata;
  const rawContent = message?.content as Array<TMessageContentParts | undefined> | undefined;
  const persistedActivityEvents = useMemo(() => getPersistedSteelActivityEvents(metadata), [metadata]);
  const persistedPreflightToolCallParts = useMemo(
    () => getPersistedSteelPreflightToolCallParts(metadata),
    [metadata],
  );
  const content = useMemo(
    () => prependPersistedSteelPreflightToolCallParts(rawContent, persistedPreflightToolCallParts),
    [rawContent, persistedPreflightToolCallParts],
  );
  return { persistedActivityEvents, content };
}
