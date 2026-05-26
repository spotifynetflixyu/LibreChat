import { buildSteelModelOptions } from './models';

describe('Steel model options', () => {
  it('derives options from LibreChat model specs before Steel capability filtering', () => {
    const options = buildSteelModelOptions({
      models: {
        openAI: ['gpt-5.1', 'gpt-4.1'],
      },
      modelSpecs: {
        list: [
          {
            name: 'steel-default',
            label: 'Steel Default',
            default: true,
            preset: {
              endpoint: 'openAI',
              model: 'gpt-5.1',
              temperature: 0.2,
            },
          },
        ],
      },
      capabilities: {
        'openai_oauth_responses:gpt-5.1': {
          text: 'passed',
          streaming: 'passed',
          tool_calling: 'unverified',
          structured_output: 'unverified',
          workbook_patch: 'unverified',
          image_input: 'unverified',
          pdf_input: 'unverified',
          xlsx_input: 'unverified',
          file_search: 'unverified',
          code_interpreter: 'unverified',
          conversation_state: 'not_applicable',
        },
      },
    });

    expect(options).toEqual([
      expect.objectContaining({
        id: 'openai_oauth_responses:gpt-5.1',
        model: 'gpt-5.1',
        provider: 'openai_oauth_responses',
        source: 'librechat_model_spec',
        defaultForSteel: true,
        requestedSettings: expect.objectContaining({
          temperature: 0.2,
        }),
      }),
    ]);
  });
});
