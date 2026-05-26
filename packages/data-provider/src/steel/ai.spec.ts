import {
  isSteelAIDriver,
  steelAIDrivers,
  steelCapabilityIds,
  steelFallbackEnvKeys,
  steelModelOptionSchema,
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
        workbook_patch: 'not_run',
        image_input: 'failed',
        pdf_input: 'not_run',
        xlsx_input: 'not_run',
        file_search: 'not_run',
        code_interpreter: 'not_run',
        conversation_state: 'not_applicable',
      },
    });

    expect(parsed.defaultForSteel).toBe(true);
  });
});
