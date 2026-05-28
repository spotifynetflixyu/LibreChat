import { buildSteelModelOptions } from './models';

describe('Steel model options', () => {
  it('derives the gpt-5.5 option from LibreChat model specs', () => {
    const options = buildSteelModelOptions({
      models: {
        openAI: ['gpt-5.5', 'gpt-5.4'],
      },
      modelSpecs: {
        list: [
          {
            name: 'steel-default',
            label: 'Steel Default',
            default: true,
            preset: {
              endpoint: 'openAI',
              model: 'gpt-5.5',
              temperature: 0.2,
            },
          },
          {
            name: 'old-steel-default',
            label: 'Old Steel Default',
            default: false,
            preset: {
              endpoint: 'openAI',
              model: 'gpt-5.4',
            },
          },
        ],
      },
      capabilities: {
        'openai_oauth_responses:gpt-5.5': {
          text: 'passed',
          streaming: 'passed',
          tool_calling: 'unverified',
          structured_output: 'unverified',
          workbook_patch: 'unverified',
          image_input: 'unverified',
          pdf_input: 'unverified',
          doc_input: 'unverified',
          docx_input: 'unverified',
          xls_input: 'unverified',
          xlsx_input: 'unverified',
          file_search: 'unverified',
          code_interpreter: 'unverified',
          conversation_state: 'not_applicable',
        },
      },
    });

    expect(options).toEqual([
      expect.objectContaining({
        id: 'openai_oauth_responses:gpt-5.5',
        model: 'gpt-5.5',
        provider: 'openai_oauth_responses',
        source: 'librechat_model_spec',
        defaultForSteel: true,
        requestedSettings: expect.objectContaining({
          temperature: 0.2,
        }),
      }),
    ]);
  });

  it('does not expose gpt-5.4 or lower endpoint models as active Steel options', () => {
    const options = buildSteelModelOptions({
      models: {
        openAI: ['gpt-5.5', 'gpt-5.4', 'gpt-4.1'],
      },
    });

    expect(options.map((option) => option.model)).toEqual(['gpt-5.5']);
  });
});
