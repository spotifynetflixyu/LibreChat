import { createSteelAdminHandlers, createSteelHandlers } from './handlers';
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
        selector: { materialFamily: 'c_channel' },
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
        selector: { materialFamily: 'c_channel' },
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
