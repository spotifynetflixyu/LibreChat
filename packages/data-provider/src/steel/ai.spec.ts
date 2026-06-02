import {
  isSteelAIDriver,
  steelAIProviderErrorCategories,
  steelAIDrivers,
  steelCapabilityIds,
  steelModelOptionSchema,
  steelProviderChatRequestSchema,
  steelProviderChatResponseSchema,
  steelProviderWorkbookPatchProposalSchema,
} from './ai';
import { requiredSteelWorkbookSheetIds } from './workbooks';

describe('Steel AI public contracts', () => {
  it('keeps the v8.3 driver contract narrow', () => {
    expect(steelAIDrivers).toEqual(['openai_oauth_responses', 'openai_api']);
    expect(isSteelAIDriver('openai_oauth_responses')).toBe(true);
    expect(isSteelAIDriver('openai_api')).toBe(true);
    expect(isSteelAIDriver('openharness_chatgpt_oauth')).toBe(false);
  });

  it('does not expose a per-capability fallback env matrix', async () => {
    const contracts = await import('./ai');

    expect('steelFallbackEnvKeys' in contracts).toBe(false);
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
      'doc_input',
      'docx_input',
      'xls_input',
      'xlsx_input',
      'file_search',
      'code_interpreter',
      'conversation_state',
    ]);
  });

  it('accepts a model option shaped by LibreChat defaults and provider capabilities', () => {
    const parsed = steelModelOptionSchema.parse({
      id: 'openai_oauth_responses:gpt-5.5',
      label: 'gpt-5.5',
      model: 'gpt-5.5',
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
        doc_input: 'unverified',
        docx_input: 'unverified',
        xls_input: 'unverified',
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
      model: 'gpt-5.5',
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
      model: 'gpt-5.5',
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
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        workbookId: 'wb_1',
        workbookVersion: 2,
        selectedWorkbookRefs: [
          {
            workbookId: 'wb_1',
            workbookVersion: 2,
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
          },
        ],
        maxOutputTokens: 64,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      workbookId: 'wb_1',
      workbookVersion: 2,
      selectedWorkbookRefs: [
        {
          workbookId: 'wb_1',
          workbookVersion: 2,
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
        },
      ],
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

  it('allows Steel chat responses to carry an accepted workbook patch for UI refresh', () => {
    const sheets = requiredSteelWorkbookSheetIds.map((sheetId) => ({
      id: sheetId,
      label: sheetId,
      columns: [
        { key: 'material_unit_price', label: '材料單價', valueType: 'currency', editable: true },
      ],
      rows: [{ id: 'line_1', cells: { material_unit_price: 115 } }],
    }));
    const parsed = steelProviderChatResponseSchema.parse({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '已更新：報價明細 line-1 材料單價 120 -> 115',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: {
        workbook: {
          id: 'wb_1',
          version: 3,
          sheets,
        },
        changedPaths: [
          { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
        ],
        changedFieldSummary: [
          {
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            label: '材料單價',
            previousValue: 120,
            nextValue: 115,
          },
        ],
      },
    });

    expect(parsed.workbookPatch?.workbook?.version).toBe(3);
    expect(parsed.workbookPatch?.changedPaths).toEqual([
      { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
    ]);
  });

  it('allows provider tool output to propose operations-only workbook patches', () => {
    const parsed = steelProviderWorkbookPatchProposalSchema.parse({
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 115,
          reason: 'AI matched the reviewed C-type steel quote line.',
        },
      ],
    });

    expect(parsed.operations).toEqual([
      {
        op: 'set_cell',
        sheetId: 'quote_details',
        rowId: 'line_1',
        columnKey: 'material_unit_price',
        value: 115,
        reason: 'AI matched the reviewed C-type steel quote line.',
      },
    ]);
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
