import type { Request, Response } from 'express';

import { createSteelAdminHandlers } from './admin';

function createResponse(): Response {
  const response = {
    json: jest.fn(),
    status: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response as Response;
}

describe('Steel OpenAI OAuth admin handlers', () => {
  it('validates and forwards the structured login method', async () => {
    const startCodexLogin = jest.fn(async () => ({
      status: 'pending' as const,
      method: 'browser' as const,
      sessionId: 'session_1',
      startedAt: '2026-07-11T14:00:00.000Z',
      updatedAt: '2026-07-11T14:00:00.000Z',
    }));
    const handlers = createSteelAdminHandlers({
      env: { HOME: '/Users/neven', OPENAI_OAUTH_AUTH_FILE: '$HOME/oauth/auth.json' },
      startCodexLogin,
    });
    const response = createResponse();

    await handlers.startOpenAIOAuthCodexLogin({ body: { method: 'browser' } } as Request, response);

    expect(startCodexLogin).toHaveBeenCalledWith({
      authFilePath: '/Users/neven/oauth/auth.json',
      env: expect.any(Object),
      method: 'browser',
    });
    expect(response.status).toHaveBeenCalledWith(202);
  });

  it('rejects unsupported login methods before starting app-server', async () => {
    const startCodexLogin = jest.fn();
    const handlers = createSteelAdminHandlers({ startCodexLogin });
    const response = createResponse();

    await handlers.startOpenAIOAuthCodexLogin(
      { body: { method: 'password' } } as Request,
      response,
    );

    expect(startCodexLogin).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ message: 'Invalid Codex login method' });
  });

  it('invalidates usage after refresh, completed login, and logout', async () => {
    const invalidateUsageCache = jest.fn();
    const handlers = createSteelAdminHandlers({
      getCodexLoginStatus: jest.fn(() => ({
        status: 'succeeded',
        startedAt: '2026-07-11T14:00:00.000Z',
        updatedAt: '2026-07-11T14:00:01.000Z',
      })),
      invalidateUsageCache,
      logoutToken: jest.fn(async () => ({
        status: 'succeeded',
        fetchedAt: '2026-07-11T14:00:00.000Z',
      })),
      refreshToken: jest.fn(async () => ({
        provider: 'openai_oauth_responses',
        status: 'available',
        fetchedAt: '2026-07-11T14:00:00.000Z',
        accessToken: { status: 'valid' },
        refresh: { available: true },
        login: { available: true },
      })),
    });

    await handlers.refreshOpenAIOAuthToken({} as Request, createResponse());
    await handlers.readOpenAIOAuthCodexLoginStatus(
      { params: { sessionId: 'session_1' } } as Request,
      createResponse(),
    );
    await handlers.logoutOpenAIOAuthToken({} as Request, createResponse());

    expect(invalidateUsageCache).toHaveBeenCalledTimes(3);
  });
});
