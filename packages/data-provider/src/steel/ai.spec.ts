import {
  isSteelAIDriver,
  steelAIProviderErrorCategorySchema,
  steelCapabilityIds,
  steelCapabilityMapSchema,
  steelModelOptionSchema,
} from './ai';

describe('Steel AI formal contracts', () => {
  it('recognizes supported Steel AI drivers', () => {
    expect(isSteelAIDriver('openai_oauth_responses')).toBe(true);
    expect(isSteelAIDriver('openai_api')).toBe(true);
    expect(isSteelAIDriver('openharness_chatgpt_oauth')).toBe(false);
  });

  it('keeps the capability map and model option schemas available', () => {
    const capabilities = Object.fromEntries(
      steelCapabilityIds.map((capability) => [capability, 'unverified']),
    );
    expect(steelCapabilityMapSchema.parse(capabilities)).toEqual(capabilities);
    expect(
      steelModelOptionSchema.parse({
        id: 'openai_oauth_responses:gpt-5.5',
        label: 'GPT-5.5',
        model: 'gpt-5.5',
        provider: 'openai_oauth_responses',
        source: 'default_preset',
        endpoint: '/v1/responses',
        defaultForSteel: true,
        requestedSettings: {},
        capabilities,
      }),
    ).toMatchObject({ model: 'gpt-5.5' });
  });

  it('keeps provider error categories available to formal consumers', () => {
    expect(steelAIProviderErrorCategorySchema.parse('provider_vision_input_unsupported')).toBe(
      'provider_vision_input_unsupported',
    );
  });
});
