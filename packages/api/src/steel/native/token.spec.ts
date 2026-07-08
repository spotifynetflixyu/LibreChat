import {
  getOpenAIOAuthCodexLoginStatus,
  getOpenAIOAuthTokenStatus,
  refreshOpenAIOAuthToken,
  startOpenAIOAuthCodexLogin,
  type OpenAIOAuthCodexCommandRunner,
  type OpenAIOAuthCodexLoginSpawner,
  type OpenAIOAuthCodexLoginStore,
  type OpenAIOAuthTokenLoader,
} from './token';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

function createJwt(exp: number, iat = 1783519200): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, iat, email: 'person@example.com' })).toString(
    'base64url',
  );
  return `${header}.${payload}.signature_sensitive`;
}

describe('OpenAI OAuth token status service', () => {
  const workingCodexCommand: OpenAIOAuthCodexCommandRunner = jest.fn(async () => ({
    exitCode: 0,
    stderr: '',
    stdout: 'codex 0.143.0',
  }));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns sanitized access-token expiry and detected Codex login capability', async () => {
    const loadAuthTokens: OpenAIOAuthTokenLoader = jest.fn(async () => ({
      accessToken: createJwt(1783562400),
      accountId: 'acct_sensitive',
      refreshToken: 'refresh_sensitive',
    }));

    const result = await getOpenAIOAuthTokenStatus({
      authFilePath: '/data/openai-oauth/auth.json',
      loadAuthTokens,
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand: workingCodexCommand,
    });

    expect(workingCodexCommand).toHaveBeenCalledWith({
      args: ['--version'],
      command: 'codex',
      env: expect.objectContaining({
        CODEX_HOME: expect.stringContaining('.codex'),
      }),
      timeoutMs: 5000,
    });
    expect(loadAuthTokens).toHaveBeenCalledWith({
      authFilePath: '/data/openai-oauth/auth.json',
      ensureFresh: false,
      fetch: globalThis.fetch,
    });
    expect(result).toEqual({
      provider: 'openai_oauth_responses',
      status: 'available',
      fetchedAt: '2026-07-08T02:34:02.000Z',
      accessToken: {
        status: 'valid',
        expiresAt: '2026-07-09T02:00:00.000Z',
        expiresInSeconds: 84358,
      },
      refresh: {
        available: true,
      },
      login: {
        available: true,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /signature_sensitive|refresh_sensitive|acct_sensitive|person@example.com|auth\.json|\/data/i,
    );
  });

  it('marks the access token expired without exposing token contents', async () => {
    const result = await getOpenAIOAuthTokenStatus({
      loadAuthTokens: jest.fn(async () => ({
        accessToken: createJwt(1783478041),
        refreshToken: 'refresh_sensitive',
      })),
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand: workingCodexCommand,
    });

    expect(result.status).toBe('available');
    expect(result.accessToken.status).toBe('expired');
    expect(result.accessToken.expiresInSeconds).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/refresh_sensitive/i);
  });

  it('returns sanitized unavailable state when auth loading fails', async () => {
    const result = await getOpenAIOAuthTokenStatus({
      loadAuthTokens: jest.fn(async () => {
        throw new Error('token_sensitive auth failure');
      }),
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand: workingCodexCommand,
    });

    expect(result).toEqual({
      provider: 'openai_oauth_responses',
      status: 'unavailable',
      fetchedAt: '2026-07-08T02:34:02.000Z',
      reason: 'auth_unavailable',
      accessToken: {
        status: 'unknown',
      },
      refresh: {
        available: false,
      },
      login: {
        available: true,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/token_sensitive|auth failure/i);
  });

  it('refreshes through the OAuth provider and returns the refreshed sanitized status', async () => {
    const loadAuthTokens: OpenAIOAuthTokenLoader = jest.fn(async () => ({
      accessToken: createJwt(1783562400),
      refreshToken: 'refresh_sensitive',
    }));

    const result = await refreshOpenAIOAuthToken({
      authFilePath: '/data/openai-oauth/auth.json',
      loadAuthTokens,
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand: workingCodexCommand,
    });

    expect(loadAuthTokens).toHaveBeenCalledWith({
      authFilePath: '/data/openai-oauth/auth.json',
      ensureFresh: true,
      fetch: globalThis.fetch,
    });
    expect(result.status).toBe('available');
    expect(result.accessToken.status).toBe('valid');
    expect(JSON.stringify(result)).not.toMatch(/refresh_sensitive|auth\.json|\/data/i);
  });

  it('marks Codex login unavailable when the server-side CLI probe fails', async () => {
    const result = await getOpenAIOAuthTokenStatus({
      loadAuthTokens: jest.fn(async () => ({
        accessToken: createJwt(1783562400),
        refreshToken: 'refresh_sensitive',
      })),
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand: jest.fn(async () => ({
        exitCode: 1,
        stderr: 'spawn /sensitive/path ENOENT',
        stdout: '',
      })),
    });

    expect(result.login).toEqual({
      available: false,
      reason: 'codex_cli_unavailable',
    });
    expect(JSON.stringify(result)).not.toMatch(/sensitive|ENOENT/i);
  });

  it('detects Codex CLI from common local install paths when backend PATH misses it', async () => {
    const runCodexCommand: OpenAIOAuthCodexCommandRunner = jest.fn(async ({ command }) => ({
      exitCode: command === '/opt/homebrew/bin/codex' ? 0 : 1,
      stderr: command === 'codex' ? 'ENOENT /sensitive/path' : '',
      stdout: command === '/opt/homebrew/bin/codex' ? 'codex-cli 0.143.0' : '',
    }));

    const result = await getOpenAIOAuthTokenStatus({
      env: {
        HOME: '/Users/neven',
      },
      loadAuthTokens: jest.fn(async () => ({
        accessToken: createJwt(1783562400),
        refreshToken: 'refresh_sensitive',
      })),
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand,
    });

    expect(runCodexCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ command: 'codex' }),
    );
    expect(runCodexCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ command: '/opt/homebrew/bin/codex' }),
    );
    expect(result.login).toEqual({ available: true });
    expect(JSON.stringify(result)).not.toMatch(/sensitive|homebrew|\/Users\/neven/i);
  });

  it('expands configured Codex home before probing the server-side CLI', async () => {
    const runCodexCommand: OpenAIOAuthCodexCommandRunner = jest.fn(async () => ({
      exitCode: 0,
      stderr: '',
      stdout: 'codex-cli 0.143.0',
    }));

    await getOpenAIOAuthTokenStatus({
      env: {
        CODEX_CLI_PATH: '/usr/local/bin/codex',
        CODEX_HOME: '~/.librechat-openai-oauth',
        HOME: '/Users/neven',
      },
      loadAuthTokens: jest.fn(async () => ({
        accessToken: createJwt(1783562400),
        refreshToken: 'refresh_sensitive',
      })),
      now: () => new Date('2026-07-08T02:34:02.000Z'),
      runCodexCommand,
    });

    expect(runCodexCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/usr/local/bin/codex',
        env: expect.objectContaining({
          CODEX_HOME: '/Users/neven/.librechat-openai-oauth',
        }),
      }),
    );
  });

  it('starts a sanitized Codex device-login session in the auth file directory', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const store: OpenAIOAuthCodexLoginStore = new Map();
    const spawnCodexLogin: OpenAIOAuthCodexLoginSpawner = jest.fn(
      ({ cwd, env, onExit, onOutput }) => {
        onOutput(
          [
            '1. Open this link in your browser',
            '   https://auth.openai.com/codex/device',
            '',
            '2. Enter this one-time code (expires in 15 minutes)',
            '   ABCD-EFGH1',
          ].join('\n'),
        );
        return {
          kill: () => onExit({ code: 1, signal: null }),
        };
      },
    );

    try {
      const result = await startOpenAIOAuthCodexLogin({
        authFilePath,
        idFactory: () => 'session_1',
        loginStore: store,
        loginTimeoutMs: 60_000,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        spawnCodexLogin,
      });
      const configToml = await readFile(path.join(tempDir, 'config.toml'), 'utf8');

      expect(result).toEqual({
        status: 'pending',
        sessionId: 'session_1',
        startedAt: '2026-07-08T02:34:02.000Z',
        updatedAt: '2026-07-08T02:34:02.000Z',
        expiresAt: '2026-07-08T02:35:02.000Z',
        device: {
          verificationUri: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-EFGH1',
        },
      });
      expect(configToml).toContain('cli_auth_credentials_store = "file"');
      expect(spawnCodexLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['login', '--device-auth'],
          command: 'codex',
          cwd: tempDir,
          env: expect.objectContaining({
            CODEX_HOME: tempDir,
          }),
        }),
      );
      expect(JSON.stringify(result)).not.toMatch(/auth\.json|codex-auth-test|refresh_sensitive/i);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('returns a refreshed sanitized token status after Codex device login succeeds', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const store: OpenAIOAuthCodexLoginStore = new Map();
    let finishLogin: (() => void) | undefined;
    const loadAuthTokens: OpenAIOAuthTokenLoader = jest.fn(async () => ({
      accessToken: createJwt(1783562400),
      refreshToken: 'refresh_sensitive',
    }));
    const spawnCodexLogin: OpenAIOAuthCodexLoginSpawner = jest.fn(({ onExit, onOutput }) => {
      onOutput('Go to https://auth.openai.com/codex/device and use code WXYZ-1234');
      finishLogin = () => onExit({ code: 0, signal: null });
      return {
        kill: jest.fn(),
      };
    });

    try {
      const started = await startOpenAIOAuthCodexLogin({
        authFilePath,
        idFactory: () => 'session_2',
        loadAuthTokens,
        loginStore: store,
        loginTimeoutMs: 60_000,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        spawnCodexLogin,
      });

      finishLogin?.();
      await new Promise((resolve) => setImmediate(resolve));
      const completed = getOpenAIOAuthCodexLoginStatus('session_2', {
        loginStore: store,
        now: () => new Date('2026-07-08T02:34:03.000Z'),
      });

      expect(started.status).toBe('pending');
      expect(loadAuthTokens).toHaveBeenCalledWith({
        authFilePath,
        ensureFresh: false,
        fetch: globalThis.fetch,
      });
      expect(completed.status).toBe('succeeded');
      expect(completed.token?.accessToken.status).toBe('valid');
      expect(JSON.stringify(completed)).not.toMatch(/refresh_sensitive|auth\.json|codex-auth-test/i);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('parses a pending Codex device code on status read after multiline CLI output', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const store: OpenAIOAuthCodexLoginStore = new Map();
    const spawnCodexLogin: OpenAIOAuthCodexLoginSpawner = jest.fn(({ onOutput }) => {
      onOutput('Open https://auth.openai.com/codex/device\n');
      onOutput('Enter this one-time code (expires in 15 minutes)\n   WXYZ-12345\n');
      return {
        kill: jest.fn(),
      };
    });

    try {
      await startOpenAIOAuthCodexLogin({
        authFilePath,
        idFactory: () => 'session_3',
        loginStore: store,
        loginTimeoutMs: 60_000,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        spawnCodexLogin,
      });

      const result = getOpenAIOAuthCodexLoginStatus('session_3', {
        loginStore: store,
        now: () => new Date('2026-07-08T02:34:03.000Z'),
      });

      expect(result.device).toEqual({
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'WXYZ-12345',
      });
      expect(JSON.stringify(result)).not.toMatch(/auth\.json|codex-auth-test/i);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('does not parse the Open this instruction as a Codex device code', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const store: OpenAIOAuthCodexLoginStore = new Map();
    let emitOutput: ((chunk: string) => void) | undefined;
    const spawnCodexLogin: OpenAIOAuthCodexLoginSpawner = jest.fn(({ onOutput }) => {
      emitOutput = onOutput;
      onOutput(
        [
          'Use your device code to grant access to Codex CLI',
          'Follow these steps to sign in:',
          '1. Open this link in your browser',
          '   https://auth.openai.com/codex/device',
        ].join('\n'),
      );
      return {
        kill: jest.fn(),
      };
    });

    try {
      const started = await startOpenAIOAuthCodexLogin({
        authFilePath,
        idFactory: () => 'session_4',
        loginStore: store,
        loginTimeoutMs: 60_000,
        now: () => new Date('2026-07-08T02:34:02.000Z'),
        runCodexCommand: workingCodexCommand,
        spawnCodexLogin,
      });

      expect(started.device).toEqual({
        verificationUri: 'https://auth.openai.com/codex/device',
      });
      expect(started.device?.userCode).toBeUndefined();

      emitOutput?.('\n2. Enter this one-time code\n   WXYZ-12345\n');

      const result = getOpenAIOAuthCodexLoginStatus('session_4', {
        loginStore: store,
        now: () => new Date('2026-07-08T02:34:03.000Z'),
      });

      expect(result.device).toEqual({
        verificationUri: 'https://auth.openai.com/codex/device',
        userCode: 'WXYZ-12345',
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
