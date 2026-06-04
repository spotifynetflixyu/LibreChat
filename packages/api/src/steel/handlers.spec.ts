import { createSteelAdminHandlers, createSteelHandlers } from './handlers';
import { logger } from '@librechat/data-schemas';
import { SteelConversationAccessError } from './conversations/service';

import type { Request, Response } from 'express';

function createResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
}

describe('createSteelHandlers', () => {
  it('sends authenticated Steel chat through the OAuth provider adapter', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith({
      authFilePath: undefined,
      maxOutputTokens: undefined,
      messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    });
  });

  it('applies provider workbook patch operations before returning the OAuth chat response', async () => {
    const operations = [
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'material_unit_price',
        value: 115,
        reason: 'AI matched the reviewed C-type steel quote line.',
      },
    ];
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已更新報價明細。',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: { operations },
    }));
    const workbookPatch = {
      workbook: { id: 'wb_1', version: 2, sheets: [] },
      changedPaths: [
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'material_unit_price' },
      ],
      changedFieldSummary: [
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          label: '材料單價',
          previousValue: null,
          nextValue: 115,
        },
      ],
    };
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(async () => ({
        workbook: { id: 'wb_1', version: 1, sheets: [] },
      })),
      patch: jest.fn(async () => workbookPatch),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const selectedWorkbookRefs = [
      {
        workbookId: 'wb_1',
        workbookVersion: 1,
        sheetId: 'quote_details',
        rowId: 'line_1',
        columnKey: 'material_unit_price',
      },
    ];
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs,
        messages: [{ role: 'user', content: '把 line 1 材料單價改成 115' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        workbookPatchTool: true,
      }),
    );
    expect(workbookService.read).toHaveBeenCalledWith({ workbookId: 'wb_1' });
    expect(workbookService.patch).toHaveBeenCalledWith({
      workbookId: 'wb_1',
      workbookVersion: 1,
      selectedWorkbookRefs,
      operations,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '已更新報價明細。',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch,
    });
  });

  it('returns a visible workbook update summary when the model only emits a patch tool call', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: {
        operations: [
          {
            op: 'set_cell' as const,
            sheetId: 'quote_details' as const,
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            value: 115,
          },
        ],
      },
    }));
    const workbookPatch = {
      workbook: { id: 'wb_1', version: 2, sheets: [] },
      changedPaths: [
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'material_unit_price' },
      ],
      changedFieldSummary: [
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          label: '材料單價',
          previousValue: null,
          nextValue: 115,
        },
      ],
    };
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(async () => ({
        workbook: { id: 'wb_1', version: 1, sheets: [] },
      })),
      patch: jest.fn(async () => workbookPatch),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        messages: [{ role: 'user', content: 'set quote_details line_1 material_unit_price 115' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '已更新 workbook：材料單價 -> 115',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch,
    });
  });

  it('sends workbook structure context so AI resolves visible summary labels to internal patch targets', async () => {
    const operations = [
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_total_amount',
        columnKey: 'value',
        value: 100,
        reason: 'User asked to update the summary total amount.',
      },
    ];
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: { operations },
    }));
    const workbookPatch = {
      workbook: { id: 'wb_1', version: 2, sheets: [] },
      changedPaths: [
        { sheetId: 'summary' as const, rowId: 'summary_total_amount', columnKey: 'value' },
      ],
      changedFieldSummary: [
        {
          sheetId: 'summary' as const,
          rowId: 'summary_total_amount',
          columnKey: 'value',
          label: '值',
          previousValue: null,
          nextValue: 100,
        },
      ],
    };
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(async () => ({
        workbook: {
          id: 'wb_1',
          version: 1,
          sheets: [
            {
              id: 'summary',
              label: '總結',
              columns: [
                { key: 'item', label: '項目', valueType: 'text', editable: false },
                { key: 'value', label: '值', valueType: 'currency', editable: true },
                { key: 'note', label: '備註', valueType: 'text', editable: true },
              ],
              rows: [
                { id: 'summary_total_weight', cells: { item: '總重量', value: null, note: null } },
                { id: 'summary_total_amount', cells: { item: '總額', value: null, note: null } },
              ],
            },
          ],
        },
      })),
      patch: jest.fn(async () => workbookPatch),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        messages: [{ role: 'user', content: '總結的總額更新為100' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    const sendChatOptions = sendChat.mock.calls[0]?.[0];
    expect(workbookService.read).toHaveBeenCalledWith({ workbookId: 'wb_1' });
    expect(sendChatOptions).toEqual(
      expect.objectContaining({
        workbookPatchTool: true,
        workbookContextText: expect.stringContaining('sheet id="summary" label="總結"'),
      }),
    );
    expect(sendChatOptions.workbookContextText).toContain('column label="值" key="value"');
    expect(sendChatOptions.workbookContextText).toContain('row id="summary_total_amount"');
    expect(sendChatOptions.workbookContextText).toContain('item="總額"');
    expect(workbookService.patch).toHaveBeenCalledWith({
      workbookId: 'wb_1',
      workbookVersion: 1,
      selectedWorkbookRefs: [],
      operations,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '已更新 workbook：值 -> 100',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch,
    });
  });

  it('decodes browser-safe chat file payloads before calling the provider adapter', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-file-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [
          {
            role: 'user',
            content: 'Read the attachment.',
            files: [
              {
                filename: 'steel-oauth-smoke.txt',
                mediaType: 'text/plain',
                dataBase64: Buffer.from('TXT_SENTINEL_7F3A', 'utf8').toString('base64'),
              },
            ],
          },
        ],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: 'Read the attachment.',
            files: [
              {
                filename: 'steel-oauth-smoke.txt',
                mediaType: 'text/plain',
                data: new Uint8Array(Buffer.from('TXT_SENTINEL_7F3A', 'utf8')),
              },
            ],
          },
        ],
        passThroughUnsupportedFiles: true,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('injects configured file instructions for image and PDF file payloads', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-file-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const instructions =
      'Attached images or image-based documents may be rotated. Preserve Chinese text exactly.';
    const req = {
      config: {
        fileAnalysis: { instructions },
      },
      body: {
        messages: [
          {
            role: 'user',
            content: 'Read the attachment.',
            files: [
              {
                filename: 'scan.pdf',
                mediaType: 'application/pdf',
                dataBase64: Buffer.from('PDF_SENTINEL', 'utf8').toString('base64'),
              },
            ],
          },
        ],
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: `${instructions}\n\nRead the attachment.`,
          }),
        ],
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('expands configured local OAuth auth file paths before calling the provider', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      env: {
        HOME: '/Users/tester',
        STEEL_OPENAI_OAUTH_AUTH_FILE: '$HOME/.codex/auth.json',
      },
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        authFilePath: '/Users/tester/.codex/auth.json',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uses request-level reasoning effort when provided', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      env: { STEEL_OPENAI_REASONING_EFFORT: 'medium' },
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        reasoningEffort: 'high',
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningEffort: 'high',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects unsupported request-level reasoning effort values', async () => {
    const sendChat = jest.fn();
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        reasoningEffort: 'minimal',
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errorSummary: 'reasoningEffort must be one of: low, medium, high, xhigh',
      }),
    );
  });

  it('rejects API provider mode until the API adapter is implemented', async () => {
    const sendChat = jest.fn();
    const handlers = createSteelHandlers({
      env: { STEEL_OPENAI_PROVIDER: 'API' },
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_api',
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      errorCategory: 'unknown',
      errorSummary:
        'STEEL_OPENAI_PROVIDER=API is reserved for the OpenAI API adapter, which is not implemented in this slice.',
    });
  });

  it('returns provider auth failures without triggering browser session refresh semantics', async () => {
    const sendChat = jest.fn(async () => {
      throw new Error('ChatGPT access token not found');
    });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      errorCategory: 'auth',
      errorSummary:
        'OpenAI OAuth auth is unavailable. Run Codex login on the server or configure server auth material.',
    });
  });

  it('rejects malformed chat requests without calling the provider', async () => {
    const sendChat = jest.fn();
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = { body: { messages: [] } } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      errorCategory: 'unknown',
      errorSummary: 'messages must contain at least one chat message',
    });
  });

  it('returns typed Steel conversation access error categories', async () => {
    const conversationService = {
      createAuthenticated: jest.fn(),
      createGuest: jest.fn(async () => {
        throw new SteelConversationAccessError(
          'Steel guest mode is disabled',
          'steel_guest_mode_disabled',
        );
      }),
      read: jest.fn(),
    };
    const handlers = createSteelHandlers({
      conversationService,
      getModelsConfig: jest.fn(),
    });
    const req = { body: { libreChatConversationId: 'lc_guest_1' } } as Request;
    const res = createResponse();

    await handlers.createGuestConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Steel guest mode is disabled',
      errorCategory: 'steel_guest_mode_disabled',
    });
  });

  it('creates authenticated Steel rule proposals through the proposal service', async () => {
    const ruleProposalService = {
      create: jest.fn(async () => ({
        id: 'proposal_1',
        proposalType: 'customer_default',
        status: 'needs_review',
        scopeType: 'customer',
        customerId: 'cust_1',
        chargeType: 'cutting',
        formulaCode: 'C_TYPE_FINISHED_LENGTH',
        selector: { catalogFamily: 'c_channel' },
        proposedDefaultParameters: [{ key: 'unitPrice', value: 0, valueType: 'number' }],
        sourceRefs: [{ channel: 'conversation', factType: 'quote_override' }],
        createdFromConversationId: 'steel_meta_1',
        createdByUserId: 'user_1',
        reason: 'Pending Admin review.',
        confidence: 'high',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
      })),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      ruleProposalService,
    });
    const req = {
      user: { id: 'user_1' },
      body: {
        proposalType: 'customer_default',
        scopeType: 'customer',
        customerId: 'cust_1',
        chargeType: 'cutting',
        formulaCode: 'C_TYPE_FINISHED_LENGTH',
        selector: { catalogFamily: 'c_channel' },
        proposedDefaultParameters: [{ key: 'unitPrice', value: 0, valueType: 'number' }],
        sourceRefs: [{ channel: 'conversation', factType: 'quote_override' }],
        createdFromConversationId: 'steel_meta_1',
        reason: 'Pending Admin review.',
        confidence: 'high',
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.createRuleProposal(req, res);

    expect(ruleProposalService.create).toHaveBeenCalledWith({
      body: req.body,
      user: { id: 'user_1', role: undefined },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_review' }));
  });

  it('creates Steel workbooks through the workbook service', async () => {
    const workbookService = {
      create: jest.fn(async () => ({
        workbook: {
          id: 'wb_1',
          version: 1,
          sheets: [],
        },
      })),
      patch: jest.fn(),
      read: jest.fn(),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      body: { conversationMetaId: 'steel_meta_1' },
    } as Request;
    const res = createResponse();

    await handlers.createWorkbook(req, res);

    expect(workbookService.create).toHaveBeenCalledWith({ conversationMetaId: 'steel_meta_1' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ workbook: { id: 'wb_1', version: 1, sheets: [] } });
  });

  it('returns a diagnostic workbook error in development for unexpected create failures', async () => {
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation();
    const workbookService = {
      create: jest.fn(async () => {
        throw new Error('Mongo workbook schema rejected sheets');
      }),
      patch: jest.fn(),
      read: jest.fn(),
    };
    const handlers = createSteelHandlers({
      env: { NODE_ENV: 'development' },
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      body: {},
    } as Request;
    const res = createResponse();

    await handlers.createWorkbook(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(loggerSpy).toHaveBeenCalledWith('[steelWorkbook] request failed:', expect.any(Error));
    expect(res.json).toHaveBeenCalledWith({
      message: 'Steel workbook request failed',
      errorCategory: 'steel_workbook_unknown',
      errorSummary: 'Mongo workbook schema rejected sheets',
    });
  });

  it('patches Steel workbooks through the workbook service', async () => {
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(),
      patch: jest.fn(async () => ({
        changedPaths: [
          { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
        ],
        changedFieldSummary: [
          {
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            label: '材料單價',
            previousValue: null,
            nextValue: 115,
          },
        ],
        workbook: { id: 'wb_1', version: 2, sheets: [] },
      })),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        operations: [
          {
            op: 'set_cell',
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            value: 115,
          },
        ],
      },
      params: { workbookId: 'wb_1' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.patchWorkbook(req, res);

    expect(workbookService.patch).toHaveBeenCalledWith(req.body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        changedPaths: [
          { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
        ],
      }),
    );
  });
});

describe('createSteelAdminHandlers', () => {
  it('returns the code-owned gpt-5.5 OAuth Responses support matrix', async () => {
    const handlers = createSteelAdminHandlers();
    const req = { body: {} } as Request;
    const res = createResponse();

    await handlers.requestCapabilitySmoke(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      source: 'code_owned_support_matrix',
      capabilities: expect.objectContaining({
        text: 'passed',
        streaming: 'passed',
        image_input: 'passed',
        pdf_input: 'passed',
        doc_input: 'passed',
        docx_input: 'passed',
        xls_input: 'passed',
        xlsx_input: 'passed',
        conversation_state: 'not_applicable',
      }),
    });
  });
});
