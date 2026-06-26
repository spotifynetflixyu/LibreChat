import type { SteelNativeContextMetadata } from './context';
import type { SteelNativeProviderStateMode } from './provider';

export interface BuildSteelNativeResponseMessageMetadataInput {
  conversationId?: string;
  responseId?: string;
  turnIndex?: number;
  checkpointTurnIndex?: number;
  requestedStore?: boolean;
  store: boolean;
  providerStateMode?: SteelNativeProviderStateMode;
  contextMetadata?: SteelNativeContextMetadata;
}

export interface SteelNativeResponseMessageMetadata {
  steel: {
    native: {
      ingress: 'open_responses';
      nativeContextVersion?: number;
      contextMode?: string;
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
}: BuildSteelNativeResponseMessageMetadataInput): SteelNativeResponseMessageMetadata {
  return {
    steel: {
      native: {
        ingress: 'open_responses',
        ...(contextMetadata
          ? {
              nativeContextVersion: contextMetadata.nativeContextVersion,
              contextMode: contextMetadata.contextMode,
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
    },
  };
}
