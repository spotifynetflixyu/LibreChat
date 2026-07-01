import {
  isSteelAIDriver,
  steelAIProviderErrorCategories,
  steelAIDrivers,
  steelCapabilityIds,
  steelModelOptionSchema,
  steelProviderChatRequestSchema,
  steelProviderChatResponseSchema,
  steelProviderChatStreamEventSchema,
} from './ai';

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
      'provider_terminated',
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
    expect(JSON.stringify(parsed)).not.toMatch(
      /access_token|authorization|authFile|rawProvider|print\(|logs/i,
    );
  });

  it('validates minimal Steel provider chat requests', () => {
    expect(
      steelProviderChatRequestSchema.parse({
        editMessageId: 'user-message-1',
        model: 'gpt-5.5',
        messageSource: 'queued_steer',
        messages: [{ role: 'user', content: 'Say steel-chat-ok', messageId: 'user-message-1' }],
        maxOutputTokens: 64,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      editMessageId: 'user-message-1',
      model: 'gpt-5.5',
      messageSource: 'queued_steer',
      messages: [{ role: 'user', content: 'Say steel-chat-ok', messageId: 'user-message-1' }],
      maxOutputTokens: 64,
      reasoningEffort: 'high',
    });

    expect(() =>
      steelProviderChatRequestSchema.parse({
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        workbookId: 'wb_1',
      }),
    ).toThrow();

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

  it('does not expose chat-provider workbook or file-analysis patch payloads', () => {
    const parsed = steelProviderChatResponseSchema.parse({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '| 品名 | 小計 |\n| --- | --- |\n| C100 | 643.2 |',
      unsupportedSettings: [],
      warnings: [],
    });

    expect(parsed).not.toHaveProperty('workbookPatch');
    expect(parsed).not.toHaveProperty('fileAnalysisPatch');
    expect(parsed).not.toHaveProperty('fileAnalysisData');
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

  it('validates Steel chat stream events for progress, tools, text, done, and errors', () => {
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'progress',
        stage: 'provider_request',
        message: '等待模型回覆',
      }),
    ).toEqual({
      type: 'progress',
      stage: 'provider_request',
      message: '等待模型回覆',
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'lookup',
        status: 'completed',
        toolName: 'lookup_quote_rules',
        message: 'lookup_quote_rules completed',
        ok: true,
      }),
    ).toEqual({
      type: 'lookup',
      status: 'completed',
      toolName: 'lookup_quote_rules',
      message: 'lookup_quote_rules completed',
      ok: true,
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'tool',
        status: 'started',
        toolName: 'search_price_candidates',
        message: 'search_price_candidates started',
      }),
    ).toEqual({
      type: 'tool',
      status: 'started',
      toolName: 'search_price_candidates',
      message: 'search_price_candidates started',
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'reasoning',
        summary: '先查 catalog key，再查規則與價格。',
      }),
    ).toEqual({
      type: 'reasoning',
      summary: '先查 catalog key，再查規則與價格。',
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'memory_loaded',
        message: 'Loaded Working Order Memory',
        resultCount: 2,
      }),
    ).toEqual({
      type: 'memory_loaded',
      message: 'Loaded Working Order Memory',
      resultCount: 2,
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'memory_read',
        message: 'read_working_order_items completed',
        mode: 'rowNo',
        resultCount: 1,
      }),
    ).toEqual({
      type: 'memory_read',
      message: 'read_working_order_items completed',
      mode: 'rowNo',
      resultCount: 1,
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'memory_saved',
        message: 'Working Order Memory saved',
        savedCounts: { working_order_row: 2 },
        savedTableCounts: { system_order_table: 1 },
        totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2, working_order_row: 2 },
        totalTableCounts: { ocr_table: 2, system_order_table: 1 },
      }),
    ).toEqual({
      type: 'memory_saved',
      message: 'Working Order Memory saved',
      savedCounts: { working_order_row: 2 },
      savedTableCounts: { system_order_table: 1 },
      totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2, working_order_row: 2 },
      totalTableCounts: { ocr_table: 2, system_order_table: 1 },
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'parse_status',
        message: 'Markdown parse saved',
        parseStatus: 'saved',
        savedCounts: { working_order_row: 2 },
        savedTableCounts: { system_order_table: 1 },
        totalSavedCounts: { working_order_row: 2 },
        totalTableCounts: { system_order_table: 1 },
      }),
    ).toEqual({
      type: 'parse_status',
      message: 'Markdown parse saved',
      parseStatus: 'saved',
      savedCounts: { working_order_row: 2 },
      savedTableCounts: { system_order_table: 1 },
      totalSavedCounts: { working_order_row: 2 },
      totalTableCounts: { system_order_table: 1 },
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'steer_queued',
        message: 'Queued steer accepted',
      }),
    ).toEqual({
      type: 'steer_queued',
      message: 'Queued steer accepted',
    });
    expect(
      steelProviderChatStreamEventSchema.parse({ type: 'text', delta: '小計：643.2' }),
    ).toEqual({ type: 'text', delta: '小計：643.2' });
    expect(() =>
      steelProviderChatStreamEventSchema.parse({
        type: 'file_analysis_data',
        fileAnalysisData: {},
      }),
    ).toThrow();
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'done',
        response: {
          provider: 'openai_oauth_responses',
          model: 'gpt-5.5',
          text: '小計：643.2',
          unsupportedSettings: [],
          warnings: [],
        },
      }),
    ).toEqual({
      type: 'done',
      response: {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '小計：643.2',
        unsupportedSettings: [],
        warnings: [],
      },
    });
    expect(
      steelProviderChatStreamEventSchema.parse({
        type: 'error',
        errorCategory: 'provider_timeout',
        errorSummary: 'Provider timed out',
      }),
    ).toEqual({
      type: 'error',
      errorCategory: 'provider_timeout',
      errorSummary: 'Provider timed out',
    });
  });
});
