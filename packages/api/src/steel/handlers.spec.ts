import { createSteelHandlers } from './handlers';

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
      model: 'gpt-5.4',
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
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.4',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    });
  });

  it('expands configured local OAuth auth file paths before calling the provider', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.4',
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
      model: 'gpt-5.4',
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
      model: 'gpt-5.4',
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
      model: 'gpt-5.4',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      errorCategory: 'unknown',
      errorSummary: 'messages must contain at least one chat message',
    });
  });
});
