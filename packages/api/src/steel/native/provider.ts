export type SteelNativeProviderStateMode =
  | 'openai_oauth_stateless'
  | 'openai_responses_reconstructed'
  | 'openai_responses_previous_response_id';

export type SteelNativeProviderFallbackReason =
  | 'oauth_provider_requires_reconstructed_context'
  | 'provider_response_id_missing';

export interface SteelNativeProviderModelParameters {
  previous_response_id?: string;
  useResponsesApi?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface ResolveSteelNativeProviderPolicyInput {
  provider: string;
  model?: string;
  modelParameters?: SteelNativeProviderModelParameters;
  allowPreviousResponseId?: boolean;
  enforceResponsesApi?: boolean;
  persistedPreviousResponseId?: string;
}

export interface SteelNativeProviderPolicy {
  providerStateMode: SteelNativeProviderStateMode;
  provider: string;
  model?: string;
  responsesState: boolean;
  usedPreviousResponseId: boolean;
  modelParameters: SteelNativeProviderModelParameters;
  unsupportedSettings: string[];
  fallbackReason?: SteelNativeProviderFallbackReason;
}

export interface SteelNativeProviderMetadata {
  providerStateMode: SteelNativeProviderStateMode;
  provider: string;
  model?: string;
  responsesState: boolean;
  usedPreviousResponseId: boolean;
  fallbackReason?: SteelNativeProviderFallbackReason;
  unsupportedSettings?: string[];
}

const previousResponseIdKey = 'previous_response_id';
const openAIProviderNames = new Set(['openAI', 'openai', 'openai_api']);

function isOpenAIOAuthProvider(provider: string): boolean {
  return provider === 'openai_oauth_responses';
}

function isOpenAIProvider(provider: string): boolean {
  return openAIProviderNames.has(provider);
}

export function isSteelNativeProviderPolicyTarget(provider: string): boolean {
  return isOpenAIOAuthProvider(provider) || isOpenAIProvider(provider);
}

function getSupportedModelParameters(
  modelParameters: SteelNativeProviderModelParameters = {},
): {
  modelParameters: SteelNativeProviderModelParameters;
  hadPreviousResponseId: boolean;
  hadTemperature: boolean;
} {
  const { previous_response_id, temperature, ...rest } = modelParameters;
  return {
    modelParameters: rest,
    hadPreviousResponseId: previous_response_id !== undefined,
    hadTemperature: temperature !== undefined,
  };
}

function withResponsesApiDefault({
  enforceResponsesApi,
  modelParameters,
}: {
  enforceResponsesApi?: boolean;
  modelParameters: SteelNativeProviderModelParameters;
}): SteelNativeProviderModelParameters {
  if (enforceResponsesApi || modelParameters.useResponsesApi === undefined) {
    return {
      ...modelParameters,
      useResponsesApi: true,
    };
  }

  return modelParameters;
}

function getUnsupportedSettings(input: {
  hadPreviousResponseId: boolean;
  hadTemperature: boolean;
}): string[] {
  return [
    ...(input.hadPreviousResponseId ? [previousResponseIdKey] : []),
    ...(input.hadTemperature ? ['temperature'] : []),
  ];
}

export function resolveSteelNativeProviderPolicy({
  provider,
  model,
  modelParameters: rawModelParameters,
  allowPreviousResponseId,
  enforceResponsesApi,
  persistedPreviousResponseId,
}: ResolveSteelNativeProviderPolicyInput): SteelNativeProviderPolicy {
  const { modelParameters, hadPreviousResponseId, hadTemperature } =
    getSupportedModelParameters(rawModelParameters);
  const unsupportedSettings = getUnsupportedSettings({
    hadPreviousResponseId,
    hadTemperature,
  });

  if (isOpenAIOAuthProvider(provider)) {
    return {
      providerStateMode: 'openai_oauth_stateless',
      provider,
      model,
      responsesState: false,
      usedPreviousResponseId: false,
      modelParameters,
      unsupportedSettings,
      fallbackReason: 'oauth_provider_requires_reconstructed_context',
    };
  }

  const shouldUsePersistedPreviousResponseId =
    isOpenAIProvider(provider) &&
    allowPreviousResponseId === true &&
    typeof persistedPreviousResponseId === 'string' &&
    persistedPreviousResponseId.trim() !== '';

  if (shouldUsePersistedPreviousResponseId) {
    return {
      providerStateMode: 'openai_responses_previous_response_id',
      provider,
      model,
      responsesState: true,
      usedPreviousResponseId: true,
      modelParameters: {
        ...withResponsesApiDefault({
          enforceResponsesApi: true,
          modelParameters,
        }),
        previous_response_id: persistedPreviousResponseId,
      },
      unsupportedSettings: [],
    };
  }

  return {
    providerStateMode: 'openai_responses_reconstructed',
    provider,
    model,
    responsesState: true,
    usedPreviousResponseId: false,
    modelParameters: withResponsesApiDefault({
      enforceResponsesApi,
      modelParameters,
    }),
    unsupportedSettings,
    fallbackReason: 'provider_response_id_missing',
  };
}

export function toSteelNativeProviderMetadata({
  providerStateMode,
  provider,
  model,
  responsesState,
  usedPreviousResponseId,
  fallbackReason,
  unsupportedSettings,
}: SteelNativeProviderPolicy): SteelNativeProviderMetadata {
  return {
    providerStateMode,
    provider,
    model,
    responsesState,
    usedPreviousResponseId,
    fallbackReason,
    ...(unsupportedSettings.length > 0 ? { unsupportedSettings } : {}),
  };
}
