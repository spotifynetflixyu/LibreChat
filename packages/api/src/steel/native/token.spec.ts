import os from 'os';
import path from 'path';
import { mkdtemp, readFile, rm } from 'fs/promises';

import type {
  CodexAppServerClient,
  CodexAppServerJsonObject,
  CodexAppServerJsonValue,
} from './appserver';
import type {
  OpenAIOAuthAppServerFactory,
  OpenAIOAuthCodexCommandRunner,
  OpenAIOAuthCodexLoginStore,
  OpenAIOAuthTokenLoader,
} from './token';

jest.mock('./credentials', () => ({
  loadOpenAIOAuthTokens: jest.fn(),
}));

import { CodexAppServerRequestError } from './appserver';
import { clearOpenAIOAuthCredentialInvalid, markOpenAIOAuthCredentialInvalid } from './auth-state';
import { loadOpenAIOAuthTokens } from './credentials';

import {
  cancelOpenAIOAuthCodexLogin,
  getOpenAIOAuthCodexLoginStatus,
  getOpenAIOAuthTokenStatus,
  logoutOpenAIOAuthToken,
  refreshOpenAIOAuthToken,
  startOpenAIOAuthCodexLogin,
} from './token';

const defaultLoadAuthTokens = jest.mocked(loadOpenAIOAuthTokens);
const workingCodexCommand: OpenAIOAuthCodexCommandRunner = jest.fn(async () => ({
  exitCode: 0,
  stderr: '',
  stdout: 'codex-cli 0.143.0',
}));

function createJwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `header.${payload}.signature_sensitive`;
}

function createAppServer(responses: Record<string, CodexAppServerJsonValue | Error> = {}): {
  client: CodexAppServerClient;
  close: jest.Mock;
  emit: (method: string, params: CodexAppServerJsonObject) => void;
  request: jest.Mock;
  startAppServerClient: OpenAIOAuthAppServerFactory;
} {
  const handlers = new Map<string, Set<(params: CodexAppServerJsonObject) => void>>();
  const close = jest.fn(() => {
    for (const handler of handlers.get('app-server/closed') ?? []) {
      handler({});
    }
  });
  const request = jest.fn(async (method: string) => {
    const response = responses[method];
    if (response instanceof Error) {
      throw response;
    }
    return response ?? {};
  });
  const client: CodexAppServerClient = {
    close,
    on: (method, handler) => {
      const methodHandlers = handlers.get(method) ?? new Set();
      methodHandlers.add(handler);
      handlers.set(method, methodHandlers);
      return () => methodHandlers.delete(handler);
    },
    request: request as CodexAppServerClient['request'],
  };
  return {
    client,
    close,
    emit: (method, params) => {
      for (const handler of handlers.get(method) ?? []) {
        handler(params);
      }
    },
    request,
    startAppServerClient: jest.fn(async () => client),
  };
}

describe('OpenAI OAuth token status service', () => {
  it('uses the shared credential loader by default', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const appServer = createAppServer({
      'account/read': { account: { type: 'chatgpt' }, requiresOpenaiAuth: true },
    });
    defaultLoadAuthTokens.mockResolvedValueOnce({
      accessToken: createJwt(1783562400),
      refreshToken: 'refresh_sensitive',
    });

    try {
      const result = await getOpenAIOAuthTokenStatus({
        authFilePath,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'available',
          accessToken: expect.objectContaining({ status: 'valid' }),
          refresh: { available: true },
        }),
      );
      expect(defaultLoadAuthTokens).toHaveBeenCalledWith({
        authFilePath,
        ensureFresh: false,
        fetch: globalThis.fetch,
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('returns sanitized access-token expiry and detected app-server capability', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const appServer = createAppServer({
      'account/read': { account: { type: 'chatgpt' }, requiresOpenaiAuth: true },
    });
    const loadAuthTokens = jest.fn(async () => ({
      accessToken: createJwt(1783562400),
      refreshToken: 'refresh_sensitive',
    }));

    try {
      const result = await getOpenAIOAuthTokenStatus({
        authFilePath,
        loadAuthTokens,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });

      expect(appServer.request).toHaveBeenCalledWith('account/read', { refreshToken: false });
      expect(result).toEqual({
        provider: 'openai_oauth_responses',
        status: 'available',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        accessToken: {
          status: 'valid',
          expiresAt: '2026-07-09T02:00:00.000Z',
          expiresInSeconds: 84358,
        },
        refresh: { available: true },
        login: { available: true },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /signature_sensitive|refresh_sensitive|auth\.json|codex-auth-test/i,
      );
      expect(appServer.close).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('does not trust a future local expiry when managed-account verification fails', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const appServer = createAppServer({
      'account/read': new CodexAppServerRequestError('unauthorized'),
    });
    const loadAuthTokens = jest.fn(async () => ({
      accessToken: createJwt(1783562400),
      refreshToken: 'refresh_sensitive',
    }));

    try {
      const result = await getOpenAIOAuthTokenStatus({
        authFilePath,
        loadAuthTokens,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });

      expect(appServer.request).toHaveBeenCalledWith('account/read', { refreshToken: false });
      expect(loadAuthTokens).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        provider: 'openai_oauth_responses',
        status: 'unavailable',
        fetchedAt: '2026-07-08T02:34:02.000Z',
        reason: 'verification_failed',
        accessToken: { status: 'invalid' },
        refresh: { available: false },
        login: { available: true },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /token_sensitive|refresh_sensitive|auth\.json|codex-auth-test/i,
      );
      expect(appServer.close).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('keeps an unexpired local token valid when verification is transiently unavailable', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const appServer = createAppServer({
      'account/read': new CodexAppServerRequestError('request_failed'),
    });
    try {
      const result = await getOpenAIOAuthTokenStatus({
        authFilePath: path.join(tempDir, 'auth.json'),
        loadAuthTokens: jest.fn(async () => ({
          accessToken: createJwt(1783562400),
          refreshToken: 'refresh_sensitive',
        })),
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'available',
          accessToken: expect.objectContaining({ status: 'valid' }),
        }),
      );
      expect(appServer.request).toHaveBeenCalledWith('account/read', { refreshToken: false });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('reports an expired local access token after a successful account check', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const appServer = createAppServer({
      'account/read': { account: { type: 'chatgpt' } },
    });
    try {
      const result = await getOpenAIOAuthTokenStatus({
        authFilePath: path.join(tempDir, 'auth.json'),
        loadAuthTokens: jest.fn(async () => ({ accessToken: createJwt(1783470000) })),
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'available',
          accessToken: expect.objectContaining({ status: 'expired', expiresInSeconds: 0 }),
        }),
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('reports a prior OAuth 401 for the same credential as invalid', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const appServer = createAppServer({
      'account/read': { account: { type: 'chatgpt' } },
    });
    markOpenAIOAuthCredentialInvalid(authFilePath);
    try {
      const result = await getOpenAIOAuthTokenStatus({
        authFilePath,
        loadAuthTokens: jest.fn(async () => ({ accessToken: createJwt(1783562400) })),
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'unavailable',
          reason: 'verification_failed',
          accessToken: { status: 'invalid' },
        }),
      );
    } finally {
      clearOpenAIOAuthCredentialInvalid(authFilePath);
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it.each([{ account: null }, { account: { type: 'apiKey' } }])(
    'rejects a non-ChatGPT managed account response: %j',
    async (accountResponse) => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
      const appServer = createAppServer({ 'account/read': accountResponse });
      try {
        const result = await getOpenAIOAuthTokenStatus({
          authFilePath: path.join(tempDir, 'auth.json'),
          loadAuthTokens: jest.fn(async () => ({ accessToken: createJwt(1783562400) })),
          runCodexCommand: workingCodexCommand,
          startAppServerClient: appServer.startAppServerClient,
        });

        expect(result).toEqual(
          expect.objectContaining({
            status: 'unavailable',
            reason: 'verification_failed',
            accessToken: { status: 'invalid' },
          }),
        );
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    },
  );

  it('returns sanitized unavailable state when auth loading fails', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const appServer = createAppServer({
      'account/read': { account: { type: 'chatgpt' }, requiresOpenaiAuth: true },
    });
    const result = await getOpenAIOAuthTokenStatus({
      authFilePath: path.join(tempDir, 'auth.json'),
      loadAuthTokens: jest.fn(async () => {
        throw new Error('token_sensitive /data/auth.json');
      }),
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand: workingCodexCommand,
      startAppServerClient: appServer.startAppServerClient,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('auth_unavailable');
    expect(JSON.stringify(result)).not.toMatch(/token_sensitive|auth\.json|\/data/i);
    await rm(tempDir, { force: true, recursive: true });
  });

  it('refreshes the managed account through app-server before reading token status', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const appServer = createAppServer({
      'account/read': { account: { type: 'chatgpt' }, requiresOpenaiAuth: true },
    });
    const loadAuthTokens: OpenAIOAuthTokenLoader = jest.fn(async () => ({
      accessToken: createJwt(1783562400),
      refreshToken: 'refresh_sensitive',
    }));

    try {
      const result = await refreshOpenAIOAuthToken({
        authFilePath,
        loadAuthTokens,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });

      expect(appServer.request).toHaveBeenCalledWith('account/read', { refreshToken: true });
      expect(loadAuthTokens).toHaveBeenCalledWith({
        authFilePath,
        ensureFresh: false,
        fetch: globalThis.fetch,
      });
      expect(result.status).toBe('available');
      expect(appServer.close).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it.each([
    [
      'device_code' as const,
      {
        loginId: 'login_device',
        type: 'chatgptDeviceCode',
        userCode: 'ABCD-12345',
        verificationUrl: 'https://auth.openai.com/codex/device',
      },
    ],
    [
      'browser' as const,
      {
        authUrl: 'https://auth.openai.com/oauth/authorize?client=codex',
        loginId: 'login_browser',
        type: 'chatgpt',
      },
    ],
  ])('starts a sanitized structured %s login', async (method, loginResponse) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const appServer = createAppServer({ 'account/login/start': loginResponse });
    try {
      const result = await startOpenAIOAuthCodexLogin({
        authFilePath: path.join(tempDir, 'auth.json'),
        idFactory: () => 'session_1',
        loginStore: new Map(),
        loginTimeoutMs: 60_000,
        method,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });
      const configToml = await readFile(path.join(tempDir, 'config.toml'), 'utf8');

      expect(appServer.request).toHaveBeenCalledWith('account/login/start', {
        type: method === 'browser' ? 'chatgpt' : 'chatgptDeviceCode',
      });
      expect(result).toEqual(
        expect.objectContaining({
          method,
          sessionId: 'session_1',
          status: 'pending',
        }),
      );
      if (method === 'browser') {
        expect(result.browser).toEqual({ authUrl: loginResponse.authUrl });
      } else {
        expect(result.device).toEqual({
          verificationUri: loginResponse.verificationUrl,
          userCode: loginResponse.userCode,
        });
      }
      expect(configToml).toContain('cli_auth_credentials_store = "file"');
      expect(JSON.stringify(result)).not.toMatch(/auth\.json|codex-auth-test|sensitive/i);
    } finally {
      appServer.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('completes only the matching structured login notification', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const store: OpenAIOAuthCodexLoginStore = new Map();
    const appServer = createAppServer({
      'account/login/start': {
        loginId: 'login_1',
        type: 'chatgptDeviceCode',
        userCode: 'ABCD-12345',
        verificationUrl: 'https://auth.openai.com/codex/device',
      },
    });
    const loadAuthTokens: OpenAIOAuthTokenLoader = jest.fn(async () => ({
      accessToken: createJwt(1783562400),
      refreshToken: 'refresh_sensitive',
    }));
    try {
      await startOpenAIOAuthCodexLogin({
        authFilePath,
        idFactory: () => 'session_2',
        loadAuthTokens,
        loginStore: store,
        loginTimeoutMs: 60_000,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        startAppServerClient: appServer.startAppServerClient,
      });

      appServer.emit('account/login/completed', {
        error: null,
        loginId: 'another_login',
        success: true,
      });
      expect(getOpenAIOAuthCodexLoginStatus('session_2', { loginStore: store }).status).toBe(
        'pending',
      );
      appServer.emit('account/login/completed', {
        error: null,
        loginId: 'login_1',
        success: true,
      });
      await new Promise((resolve) => setImmediate(resolve));

      const completed = getOpenAIOAuthCodexLoginStatus('session_2', { loginStore: store });
      expect(completed.status).toBe('succeeded');
      expect(completed.token?.accessToken.status).toBe('valid');
      expect(loadAuthTokens).toHaveBeenCalledWith({
        authFilePath,
        ensureFresh: false,
        fetch: globalThis.fetch,
      });
      expect(JSON.stringify(completed)).not.toMatch(
        /refresh_sensitive|auth\.json|codex-auth-test/i,
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('redacts structured login failures', async () => {
    const appServer = createAppServer({
      'account/login/start': new Error('token_sensitive /data/auth.json'),
    });
    const result = await startOpenAIOAuthCodexLogin({
      runCodexCommand: workingCodexCommand,
      startAppServerClient: appServer.startAppServerClient,
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('login_failed');
    expect(JSON.stringify(result)).not.toMatch(/token_sensitive|auth\.json|\/data/i);
    expect(appServer.close).toHaveBeenCalledTimes(1);
  });

  it('cancels a timed-out structured login and ignores late completion', async () => {
    jest.useFakeTimers();
    const store: OpenAIOAuthCodexLoginStore = new Map();
    const appServer = createAppServer({
      'account/login/cancel': { status: 'canceled' },
      'account/login/start': {
        loginId: 'login_timeout',
        type: 'chatgptDeviceCode',
        userCode: 'ABCD-12345',
        verificationUrl: 'https://auth.openai.com/codex/device',
      },
    });
    await startOpenAIOAuthCodexLogin({
      idFactory: () => 'session_timeout',
      loginStore: store,
      loginTimeoutMs: 30_000,
      runCodexCommand: workingCodexCommand,
      startAppServerClient: appServer.startAppServerClient,
    });

    jest.advanceTimersByTime(30_000);
    appServer.emit('account/login/completed', {
      error: null,
      loginId: 'login_timeout',
      success: true,
    });

    expect(appServer.request).toHaveBeenCalledWith('account/login/cancel', {
      loginId: 'login_timeout',
    });
    expect(getOpenAIOAuthCodexLoginStatus('session_timeout', { loginStore: store })).toEqual(
      expect.objectContaining({ reason: 'login_timeout', status: 'failed' }),
    );
    jest.useRealTimers();
  });

  it('cancels a pending structured login by session id', async () => {
    const store: OpenAIOAuthCodexLoginStore = new Map();
    const appServer = createAppServer({
      'account/login/cancel': { status: 'canceled' },
      'account/login/start': {
        loginId: 'login_back',
        type: 'chatgptDeviceCode',
        userCode: 'ABCD-12345',
        verificationUrl: 'https://auth.openai.com/codex/device',
      },
    });
    await startOpenAIOAuthCodexLogin({
      idFactory: () => 'session_back',
      loginStore: store,
      loginTimeoutMs: 60_000,
      runCodexCommand: workingCodexCommand,
      startAppServerClient: appServer.startAppServerClient,
    });

    await expect(cancelOpenAIOAuthCodexLogin('session_back', { loginStore: store })).resolves.toBe(
      true,
    );
    expect(appServer.request).toHaveBeenCalledWith('account/login/cancel', {
      loginId: 'login_back',
    });
    expect(appServer.close).toHaveBeenCalledTimes(1);
    expect(getOpenAIOAuthCodexLoginStatus('session_back', { loginStore: store })).toEqual(
      expect.objectContaining({ reason: 'login_not_found', status: 'failed' }),
    );
  });

  it('logs out through app-server and returns the sanitized current token status', async () => {
    const appServer = createAppServer({ 'account/logout': {} });
    const result = await logoutOpenAIOAuthToken({
      loadAuthTokens: jest.fn(async () => {
        throw new Error('auth removed');
      }),
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand: workingCodexCommand,
      startAppServerClient: appServer.startAppServerClient,
    });

    expect(appServer.request).toHaveBeenCalledWith('account/logout');
    expect(result.status).toBe('succeeded');
    expect(result.token?.status).toBe('unavailable');
    expect(appServer.close).toHaveBeenCalledTimes(1);
  });
});
