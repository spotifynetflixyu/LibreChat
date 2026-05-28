import {
  isSteelAIDriver,
  steelAIProviderErrorCategories,
  steelAIDrivers,
  steelCapabilityIds,
  steelFallbackEnvKeys,
  steelModelOptionSchema,
  steelProviderChatRequestSchema,
  steelProviderChatResponseSchema,
} from './ai';

describe('Steel AI public contracts', () => {
  it('keeps the v8.3 driver contract narrow', () => {
    expect(steelAIDrivers).toEqual(['openai_oauth_responses', 'openai_api']);
    expect(isSteelAIDriver('openai_oauth_responses')).toBe(true);
    expect(isSteelAIDriver('openai_api')).toBe(true);
    expect(isSteelAIDriver('openharness_chatgpt_oauth')).toBe(false);
  });

  it('uses the five approved fallback env keys only', () => {
    expect(steelFallbackEnvKeys).toEqual([
      'STEEL_FALLBACK_REQUIRE_CAPABILITY_PASSED',
      'STEEL_FALLBACK_ON_FILE_INPUT_UNSUPPORTED',
      'STEEL_FALLBACK_ON_VISION_INPUT_UNSUPPORTED',
      'STEEL_FALLBACK_ON_XLSX_INPUT_UNSUPPORTED',
      'STEEL_FALLBACK_ON_HOSTED_TOOL_UNSUPPORTED',
    ]);
  });

  it('models capabilities needed by the provider selector and smoke gates', () => {
    expect(steelCapabilityIds).toEqual([
      'text',
      'streaming',
      'tool_calling',
      'structured_output',
      'workbook_patch',
      'image_input',
      'pdf_input',
      'xlsx_input',
      'file_search',
      'code_interpreter',
      'conversation_state',
    ]);
  });

  it('accepts a model option shaped by LibreChat defaults and provider capabilities', () => {
    const parsed = steelModelOptionSchema.parse({
      id: 'openai_oauth_responses:gpt-5.1',
      label: 'gpt-5.1',
      model: 'gpt-5.1',
      provider: 'openai_oauth_responses',
      source: 'librechat_model_spec',
      endpoint: '/v1/responses',
      defaultForSteel: true,
      requestedSettings: {
        temperature: 0.2,
        reasoningSummary: 'auto',
      },
      capabilities: {
        text: 'passed',
        streaming: 'passed',
        tool_calling: 'passed',
        structured_output: 'passed',
        workbook_patch: 'unverified',
        image_input: 'failed',
        pdf_input: 'unverified',
        xlsx_input: 'unverified',
        file_search: 'unverified',
        code_interpreter: 'unverified',
        conversation_state: 'not_applicable',
      },
    });

    expect(parsed.defaultForSteel).toBe(true);
  });

  it('keeps provider chat responses sanitized for browser use', () => {
    expect(steelAIProviderErrorCategories).toEqual([
      'auth',
      'subscription_or_rate_limit',
      'provider_tool_call_unsupported',
      'provider_file_input_unsupported',
      'provider_vision_input_unsupported',
      'provider_xlsx_input_unsupported',
      'provider_hosted_tool_unsupported',
      'structured_output_invalid',
      'provider_timeout',
      'unknown',
    ]);

    const parsed = steelProviderChatResponseSchema.parse({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.4',
      text: 'steel-provider-ok',
      responseId: 'resp_123',
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      },
      unsupportedSettings: ['previous_response_id'],
      warnings: ['stateful replay is not supported'],
    });

    expect(parsed).toEqual({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.4',
      text: 'steel-provider-ok',
      responseId: 'resp_123',
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      },
      unsupportedSettings: ['previous_response_id'],
      warnings: ['stateful replay is not supported'],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/access_token|authorization|authFile|rawProvider/i);
  });

  it('validates minimal Steel provider chat requests', () => {
    expect(
      steelProviderChatRequestSchema.parse({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        maxOutputTokens: 64,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      maxOutputTokens: 64,
      reasoningEffort: 'high',
    });

    expect(() =>
      steelProviderChatRequestSchema.parse({
        messages: [],
      }),
    ).toThrow();
    expect(() =>
      steelProviderChatRequestSchema.parse({
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        reasoningEffort: 'none',
      }),
    ).toThrow();
  });

  it('validates browser-safe Steel provider chat file payloads', () => {
    const parsed = steelProviderChatRequestSchema.parse({
      messages: [
        {
          role: 'user',
          content: 'Read the attachment.',
          files: [
            {
              filename: 'steel-oauth-smoke.txt',
              mediaType: 'text/plain',
              dataBase64: Buffer.from('Steel OAuth capability smoke', 'utf8').toString('base64'),
            },
          ],
        },
      ],
    });

    expect(parsed.messages[0].files).toEqual([
      {
        filename: 'steel-oauth-smoke.txt',
        mediaType: 'text/plain',
        dataBase64: 'U3RlZWwgT0F1dGggY2FwYWJpbGl0eSBzbW9rZQ==',
      },
    ]);
    expect(() =>
      steelProviderChatRequestSchema.parse({
        messages: [
          {
            role: 'user',
            content: 'Read the attachment.',
            files: [{ filename: 'bad.txt', mediaType: 'text/plain', dataBase64: '' }],
          },
        ],
      }),
    ).toThrow();
  });
});
