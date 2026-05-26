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
          tool_calling: 'not_run',
          structured_output: 'not_run',
          workbook_patch: 'not_run',
          image_input: 'not_run',
          pdf_input: 'not_run',
          xlsx_input: 'not_run',
          file_search: 'not_run',
          code_interpreter: 'not_run',
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
