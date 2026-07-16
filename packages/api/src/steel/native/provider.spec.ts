import {
  isSteelNativeProviderPolicyTarget,
  resolveSteelNativeProviderPolicy,
  toSteelNativeProviderMetadata,
} from './provider';

describe('Steel native provider policy resolver', () => {
  it('targets only OpenAI API and OpenAI OAuth provider branches', () => {
    expect(isSteelNativeProviderPolicyTarget('openai_oauth_responses')).toBe(true);
    expect(isSteelNativeProviderPolicyTarget('openAI')).toBe(true);
    expect(isSteelNativeProviderPolicyTarget('openai')).toBe(true);
    expect(isSteelNativeProviderPolicyTarget('openai_api')).toBe(true);
    expect(isSteelNativeProviderPolicyTarget('anthropic')).toBe(false);
    expect(isSteelNativeProviderPolicyTarget('google')).toBe(false);
  });

  it('forces OpenAI OAuth API into stateless reconstructed mode', () => {
    const result = resolveSteelNativeProviderPolicy({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      modelParameters: {
        previous_response_id: 'resp_previous',
        useResponsesApi: false,
      },
    });

    expect(result).toEqual({
      providerStateMode: 'openai_oauth_stateless',
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      responsesState: false,
      usedPreviousResponseId: false,
      modelParameters: {
        useResponsesApi: false,
      },
      unsupportedSettings: ['previous_response_id'],
      fallbackReason: 'oauth_provider_requires_reconstructed_context',
    });
    expect(toSteelNativeProviderMetadata(result)).toEqual({
      providerStateMode: 'openai_oauth_stateless',
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      responsesState: false,
      usedPreviousResponseId: false,
      fallbackReason: 'oauth_provider_requires_reconstructed_context',
      unsupportedSettings: ['previous_response_id'],
    });
  });

  it('defaults Steel OpenAI API-key specs to reconstructed Responses mode', () => {
    const result = resolveSteelNativeProviderPolicy({
      provider: 'openAI',
      model: 'gpt-5.5',
      modelParameters: {
        temperature: 0.2,
      },
    });

    expect(result).toEqual({
      providerStateMode: 'openai_responses_reconstructed',
      provider: 'openAI',
      model: 'gpt-5.5',
      responsesState: true,
      usedPreviousResponseId: false,
      modelParameters: {
        useResponsesApi: true,
      },
      unsupportedSettings: ['temperature'],
      fallbackReason: 'provider_response_id_missing',
    });
  });

  it('preserves explicit useResponsesApi false unless Steel enforcement is requested', () => {
    expect(
      resolveSteelNativeProviderPolicy({
        provider: 'openAI',
        model: 'gpt-4.1',
        modelParameters: {
          useResponsesApi: false,
        },
      }).modelParameters,
    ).toEqual({
      useResponsesApi: false,
    });

    expect(
      resolveSteelNativeProviderPolicy({
        provider: 'openAI',
        model: 'gpt-4.1',
        modelParameters: {
          useResponsesApi: false,
        },
        enforceResponsesApi: true,
      }).modelParameters,
    ).toEqual({
      useResponsesApi: true,
    });
  });

  it('uses previous_response_id only when a persisted provider response id is available', () => {
    expect(
      resolveSteelNativeProviderPolicy({
        provider: 'openAI',
        model: 'gpt-5.5',
        modelParameters: {
          previous_response_id: 'client_supplied',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        providerStateMode: 'openai_responses_reconstructed',
        usedPreviousResponseId: false,
        modelParameters: {
          useResponsesApi: true,
        },
        unsupportedSettings: ['previous_response_id'],
        fallbackReason: 'provider_response_id_missing',
      }),
    );

    const previousResponseResult = resolveSteelNativeProviderPolicy({
      provider: 'openAI',
      model: 'gpt-5.5',
      modelParameters: {},
      persistedPreviousResponseId: 'resp_persisted',
      allowPreviousResponseId: true,
    });

    expect(previousResponseResult).toEqual(
      expect.objectContaining({
        providerStateMode: 'openai_responses_previous_response_id',
        usedPreviousResponseId: true,
        modelParameters: {
          useResponsesApi: true,
          previous_response_id: 'resp_persisted',
        },
        unsupportedSettings: [],
      }),
    );
    expect(previousResponseResult).not.toHaveProperty('fallbackReason');
  });
});
