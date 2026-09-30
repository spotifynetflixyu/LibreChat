import type { Request, Response } from 'express';
import type {
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenLogoutStatus,
  OpenAIOAuthTokenStatus,
} from 'librechat-data-provider';

jest.mock('./native/credentials', () => ({
  loadOpenAIOAuthTokens: jest.fn(),
}));

import { createSteelAdminHandlers } from './admin';

function createResponse(): Response {
  const response = Object.create(null) as Response;
  response.json = jest.fn();
  response.status = jest.fn().mockReturnValue(response);
  return response;
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
      getCodexLoginStatus: jest.fn((): OpenAIOAuthTokenLoginStatus => ({
        status: 'succeeded',
        startedAt: '2026-07-11T14:00:00.000Z',
        updatedAt: '2026-07-11T14:00:01.000Z',
      })),
      invalidateUsageCache,
      logoutToken: jest.fn(async (): Promise<OpenAIOAuthTokenLogoutStatus> => ({
        status: 'succeeded',
        fetchedAt: '2026-07-11T14:00:00.000Z',
      })),
      refreshToken: jest.fn(async (): Promise<OpenAIOAuthTokenStatus> => ({
        provider: 'openai_oauth_responses',
        status: 'available',
        fetchedAt: '2026-07-11T14:00:00.000Z',
        accessToken: { status: 'valid' },
        refresh: { available: true },
        login: { available: true },
      })),
    });

    await handlers.refreshOpenAIOAuthToken({} as Request, createResponse());
    const request = Object.create(null) as Request;
    request.params = { sessionId: 'session_1' };
    await handlers.readOpenAIOAuthCodexLoginStatus(request, createResponse());
    await handlers.logoutOpenAIOAuthToken({} as Request, createResponse());

    expect(invalidateUsageCache).toHaveBeenCalledTimes(3);
  });

  it('reports capability smoke support for the active Steel model', async () => {
    const handlers = createSteelAdminHandlers();
    const response = createResponse();

    await handlers.requestCapabilitySmoke({} as Request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.6-luna',
        provider: 'openai_oauth_responses',
        source: 'code_owned_support_matrix',
      }),
    );
  });
});
