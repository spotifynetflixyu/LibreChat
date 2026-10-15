import type { IMessage } from '@librechat/data-schemas';
import type {
  SteelNativeHistory,
  SteelNativeStreamEvent,
  SteelNativePreflightToolCall,
} from './events';
import type { SteelNativeProviderStateMode } from './provider';
import type { SteelNativeContextMetadata } from './context';
import {
  createSteelNativeHistory,
  appendSteelNativeActivityEvent,
  upsertSteelNativePreflightToolCall,
} from './events';

export interface BuildSteelNativeResponseMessageMetadataInput {
  conversationId?: string;
  responseId?: string;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  requestedStore?: boolean;
  store: boolean;
  providerStateMode?: SteelNativeProviderStateMode;
  contextMetadata?: SteelNativeContextMetadata;
  activityEvents?: readonly SteelNativeStreamEvent[];
  preflightToolCalls?: readonly SteelNativePreflightToolCall[];
}

export interface SteelNativeResponseMessageMetadata {
  steel: {
    activityEvents?: readonly SteelNativeStreamEvent[];
    preflightToolCalls?: readonly SteelNativePreflightToolCall[];
    native: {
      ingress: 'open_responses';
      nativeContextVersion?: number;
      mode?: string;
      renderProfile?: string;
      globalApplied?: true;
      providerStateMode?: SteelNativeProviderStateMode;
      conversationId?: string;
      responseId?: string;
      turnIndex?: number;
      checkpointTurnIndex?: number;
      storage: {
        requestedStore: boolean | null;
        store: boolean;
        durable: boolean;
      };
    };
  };
}

export function buildSteelNativeResponseMessageMetadata({
  conversationId,
  responseId,
  turnIndex,
  checkpointTurnIndex,
  requestedStore,
  store,
  providerStateMode,
  contextMetadata,
  activityEvents,
  preflightToolCalls,
}: BuildSteelNativeResponseMessageMetadataInput): SteelNativeResponseMessageMetadata {
  return {
    steel: {
      native: {
        ingress: 'open_responses',
        ...(contextMetadata
          ? {
              nativeContextVersion: contextMetadata.nativeContextVersion,
              ...(contextMetadata.mode ? { mode: contextMetadata.mode } : {}),
              renderProfile: contextMetadata.renderProfile,
              globalApplied: contextMetadata.globalApplied,
            }
          : {}),
        ...(providerStateMode ? { providerStateMode } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(responseId ? { responseId } : {}),
        ...(turnIndex !== undefined ? { turnIndex } : {}),
        ...(checkpointTurnIndex !== undefined ? { checkpointTurnIndex } : {}),
        storage: {
          requestedStore: requestedStore ?? null,
          store,
          durable: store === true,
        },
      },
      ...(Array.isArray(activityEvents) && activityEvents.length > 0
        ? { activityEvents: [...activityEvents] }
        : {}),
      ...(Array.isArray(preflightToolCalls) && preflightToolCalls.length > 0
        ? { preflightToolCalls: [...preflightToolCalls] }
        : {}),
    },
  };
}

/** The `req.steelNativeContext` fields a Responses turn records on its assistant message. */
export interface SteelNativeResponseTurnContext {
  assistantTurnIndex?: number;
  memoryCheckpointTurnIndex?: number;
  requestedStore?: boolean;
  store?: boolean;
  providerStateMode?: SteelNativeProviderStateMode;
  contextMetadata?: SteelNativeContextMetadata;
  steelHistory?: SteelNativeHistory;
}

export function buildSteelNativeResponseTurnMetadata(
  context: SteelNativeResponseTurnContext | undefined,
  ids: { conversationId?: string; responseId?: string },
): SteelNativeResponseMessageMetadata {
  return buildSteelNativeResponseMessageMetadata({
    ...ids,
    turnIndex: context?.assistantTurnIndex,
    checkpointTurnIndex: context?.memoryCheckpointTurnIndex,
    requestedStore: context?.requestedStore,
    store: context?.store === true,
    providerStateMode: context?.providerStateMode ?? 'openai_responses_reconstructed',
    contextMetadata: context?.contextMetadata,
    activityEvents: context?.steelHistory?.activityEvents,
    preflightToolCalls: context?.steelHistory?.preflightToolCalls,
  });
}

type MessageMetadata = NonNullable<IMessage['metadata']>;

function isMetadataRecord(value: unknown): value is MessageMetadata {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asMetadataRecord(value: unknown): MessageMetadata {
  return isMetadataRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Merges Steel activity captured before and after a HITL pause. Events and
 * cards are re-validated through the bounded history; other Steel fields are
 * merged with the current response taking precedence.
 */
export function mergeSteelMessageMetadata(persisted: unknown, current: unknown): MessageMetadata {
  const persistedMetadata = asMetadataRecord(persisted);
  const currentMetadata = asMetadataRecord(current);
  const persistedSteel = asMetadataRecord(persistedMetadata.steel);
  const currentSteel = asMetadataRecord(currentMetadata.steel);

  const history = createSteelNativeHistory();
  for (const event of [
    ...asArray(persistedSteel.activityEvents),
    ...asArray(currentSteel.activityEvents),
  ]) {
    appendSteelNativeActivityEvent(history, event);
  }
  for (const card of [
    ...asArray(persistedSteel.preflightToolCalls),
    ...asArray(currentSteel.preflightToolCalls),
  ]) {
    upsertSteelNativePreflightToolCall(history, card);
  }

  const {
    activityEvents: _persistedEvents,
    preflightToolCalls: _persistedCards,
    native: persistedNative,
    ...persistedRest
  } = persistedSteel;
  const {
    activityEvents: _currentEvents,
    preflightToolCalls: _currentCards,
    native: currentNative,
    ...currentRest
  } = currentSteel;
  const hasNative = isMetadataRecord(persistedNative) || isMetadataRecord(currentNative);
  const mergedSteel: MessageMetadata = {
    ...persistedRest,
    ...currentRest,
    ...(hasNative
      ? { native: { ...asMetadataRecord(persistedNative), ...asMetadataRecord(currentNative) } }
      : {}),
    ...(history.activityEvents.length > 0 ? { activityEvents: history.activityEvents } : {}),
    ...(history.preflightToolCalls.length > 0
      ? { preflightToolCalls: history.preflightToolCalls }
      : {}),
  };
  const { steel: _steel, ...merged } = { ...persistedMetadata, ...currentMetadata };
  return Object.keys(mergedSteel).length > 0 ? { ...merged, steel: mergedSteel } : merged;
}
