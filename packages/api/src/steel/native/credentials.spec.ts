import os from 'os';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';

import { loadOpenAIOAuthTokens, refreshOpenAIOAuthCredentials } from './credentials';

function createJwtPayload(payload: {
  exp?: number | string;
  'https://api.openai.com/auth'?: { chatgpt_account_is_fedramp: boolean };
}): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encodedPayload}.signature_sensitive`;
}

function createJwt(exp: number): string {
  return createJwtPayload({ exp });
}

describe('OpenAI OAuth credential loader', () => {
  it('loads Codex auth.json through the installed local OAuth package', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const accessToken = createJwt(1893456000);

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      await expect(
        loadOpenAIOAuthTokens({
          authFilePath,
          ensureFresh: false,
          fetch: globalThis.fetch,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          accessToken,
          refreshToken: 'refresh_sensitive',
        }),
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('refreshes only when token expiry is near and last refresh is old, persisting an identical token', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-refresh-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const accessToken = createJwt(Math.floor(now.getTime() / 1000) + 60 * 60);
    const fetchFn = jest.fn(
      async () =>
        new Response(JSON.stringify({ access_token: accessToken }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-07-15T11:59:59.000Z',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            id_token: 'id_sensitive',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      await expect(
        loadOpenAIOAuthTokens({
          authFilePath,
          fetch: fetchFn,
          now: () => now,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          accessToken,
          accountId: 'account_test',
          idToken: 'id_sensitive',
          refreshToken: 'refresh_sensitive',
          lastRefresh: now.toISOString(),
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const persisted = JSON.parse(await readFile(authFilePath, 'utf8')) as {
        last_refresh?: string;
        tokens?: {
          account_id?: string;
          id_token?: string;
          refresh_token?: string;
        };
      };
      expect(persisted).toEqual(
        expect.objectContaining({
          last_refresh: now.toISOString(),
          tokens: expect.objectContaining({
            account_id: 'account_test',
            id_token: 'id_sensitive',
            refresh_token: 'refresh_sensitive',
          }),
        }),
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('records the successful refresh completion time', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-completion-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    let currentTime = new Date('2026-07-18T12:00:00.000Z');
    const completedAt = new Date('2026-07-18T12:05:00.000Z');
    const accessToken = createJwt(Math.floor(currentTime.getTime() / 1000) + 60 * 60);
    const fetchFn = jest.fn(async () => {
      currentTime = completedAt;
      return new Response(JSON.stringify({ access_token: accessToken }), { status: 200 });
    });

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-07-15T11:59:59.000Z',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      await expect(
        loadOpenAIOAuthTokens({ authFilePath, fetch: fetchFn, now: () => currentTime }),
      ).resolves.toEqual(expect.objectContaining({ lastRefresh: completedAt.toISOString() }));
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('shares one refresh across concurrent eligible loads', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-concurrency-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const accessToken = createJwt(Math.floor(now.getTime() / 1000) + 60 * 60);
    const fetchFn = jest.fn(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return new Response(JSON.stringify({ access_token: accessToken }), { status: 200 });
    });

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-07-15T11:59:59.000Z',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      const [first, second] = await Promise.all([
        loadOpenAIOAuthTokens({ authFilePath, fetch: fetchFn, now: () => now }),
        loadOpenAIOAuthTokens({ authFilePath, fetch: fetchFn, now: () => now }),
      ]);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(first).toEqual(
        expect.objectContaining({ accessToken, lastRefresh: now.toISOString() }),
      );
      expect(second).toEqual(first);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('preserves FedRAMP state when a partial refresh response omits identity claims', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-fedramp-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const accessToken = createJwt(Math.floor(now.getTime() / 1000) + 60 * 60);
    const idToken = createJwtPayload({
      'https://api.openai.com/auth': { chatgpt_account_is_fedramp: true },
    });
    const fetchFn = jest.fn(
      async () => new Response(JSON.stringify({ access_token: accessToken }), { status: 200 }),
    );

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-07-15T11:59:59.000Z',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            id_token: idToken,
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      await expect(
        loadOpenAIOAuthTokens({ authFilePath, fetch: fetchFn, now: () => now }),
      ).resolves.toEqual(expect.objectContaining({ accessToken, isFedRamp: true }));
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('forces refresh despite fresh eligibility inputs and persists same-token completion', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-force-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const accessToken = createJwt(Math.floor(now.getTime() / 1000) + 7 * 24 * 60 * 60);
    const fetchFn = jest.fn(
      async () => new Response(JSON.stringify({ access_token: accessToken }), { status: 200 }),
    );
    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          last_refresh: '2026-07-18T11:00:00.000Z',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );
      const result = await refreshOpenAIOAuthCredentials({
        authFilePath,
        fetch: fetchFn,
        force: true,
        now: () => now,
      });
      expect(result).toEqual({
        auth: expect.objectContaining({ accessToken, lastRefresh: now.toISOString() }),
        refreshed: true,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('shares one external call across concurrent forced refreshes', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-force-race-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const accessToken = createJwt(1785000000);
    const fetchFn = jest.fn(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return new Response(JSON.stringify({ access_token: accessToken }), { status: 200 });
    });
    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );
      const options = { authFilePath, fetch: fetchFn, force: true, now: () => now };
      const [first, second] = await Promise.all([
        refreshOpenAIOAuthCredentials(options),
        refreshOpenAIOAuthCredentials(options),
      ]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('retries forced refresh after joining an automatic no-op', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-mixed-race-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const accessToken = createJwt(1785000000);
    const fetchFn = jest.fn(
      async () => new Response(JSON.stringify({ access_token: accessToken }), { status: 200 }),
    );
    let authFileReads = 0;
    let releaseAutomaticRead = (): void => undefined;
    let signalAutomaticRead = (): void => undefined;
    const automaticReadStarted = new Promise<void>((resolve) => {
      signalAutomaticRead = resolve;
    });
    const automaticReadRelease = new Promise<void>((resolve) => {
      releaseAutomaticRead = resolve;
    });
    const originalReadFile = fsPromises.readFile.bind(fsPromises);
    const readFileSpy = jest
      .spyOn(fsPromises, 'readFile')
      .mockImplementation(async (filePath, options) => {
        if (String(filePath) === authFilePath) {
          authFileReads += 1;
          if (authFileReads === 2) {
            signalAutomaticRead();
            await automaticReadRelease;
          }
        }
        return originalReadFile(filePath, options);
      });
    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          last_refresh: '2026-07-18T11:00:00.000Z',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );
      const automatic = loadOpenAIOAuthTokens({ authFilePath, fetch: fetchFn, now: () => now });
      await automaticReadStarted;
      const forced = refreshOpenAIOAuthCredentials({
        authFilePath,
        fetch: fetchFn,
        force: true,
        now: () => now,
      });
      while (authFileReads < 3) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      releaseAutomaticRead();
      const [automaticAuth, forcedResult] = await Promise.all([automatic, forced]);
      expect(automaticAuth.lastRefresh).toBe('2026-07-18T11:00:00.000Z');
      expect(forcedResult.refreshed).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      releaseAutomaticRead();
      readFileSpy.mockRestore();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('does not persist a failed forced refresh', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-force-failure-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const lastRefresh = '2026-07-18T11:00:00.000Z';
    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          last_refresh: lastRefresh,
          tokens: {
            access_token: createJwt(1785000000),
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );
      await expect(
        refreshOpenAIOAuthCredentials({
          authFilePath,
          fetch: async () => new Response('{}', { status: 500 }),
          force: true,
        }),
      ).rejects.toThrow('OpenAI OAuth token request failed with HTTP 500');
      const persisted = JSON.parse(await readFile(authFilePath, 'utf8')) as {
        last_refresh?: string;
      };
      expect(persisted.last_refresh).toBe(lastRefresh);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('does not refresh when only token expiry is near', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-expiry-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const accessToken = createJwt(Math.floor(now.getTime() / 1000) + 60 * 60);
    const fetchFn = jest.fn(async () => new Response('{}', { status: 500 }));

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-07-18T11:00:00.000Z',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      await expect(
        loadOpenAIOAuthTokens({ authFilePath, fetch: fetchFn, now: () => now }),
      ).resolves.toEqual(expect.objectContaining({ accessToken }));
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it.each([
    {
      accessToken: createJwt(1784635200),
      lastRefresh: '2026-07-15T11:59:59.000Z',
      name: 'only last refresh is old',
    },
    {
      accessToken: createJwtPayload({}),
      lastRefresh: '2026-07-15T11:59:59.000Z',
      name: 'access token exp is missing',
    },
    {
      accessToken: createJwtPayload({ exp: 'soon' }),
      lastRefresh: '2026-07-15T11:59:59.000Z',
      name: 'access token exp is unparseable',
    },
    {
      accessToken: createJwt(1784379600),
      lastRefresh: undefined,
      name: 'last refresh is missing',
    },
    {
      accessToken: createJwt(1784379600),
      lastRefresh: 'invalid-date',
      name: 'last refresh is unparseable',
    },
    {
      accessToken: createJwt(1784548800),
      lastRefresh: '2026-07-15T11:59:59.000Z',
      name: 'token expiry is exactly two days away',
    },
    {
      accessToken: createJwt(1784379600),
      lastRefresh: '2026-07-16T12:00:00.000Z',
      name: 'last refresh is exactly two days old',
    },
  ])('does not refresh when $name', async ({ accessToken, lastRefresh }) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-policy-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const fetchFn = jest.fn(async () => new Response('{}', { status: 500 }));

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          ...(lastRefresh ? { last_refresh: lastRefresh } : {}),
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      await expect(
        loadOpenAIOAuthTokens({ authFilePath, fetch: fetchFn, now: () => now }),
      ).resolves.toEqual(expect.objectContaining({ accessToken }));
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('does not advance last refresh after a failed refresh request', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-failure-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const now = new Date('2026-07-18T12:00:00.000Z');
    const lastRefresh = '2026-07-15T11:59:59.000Z';
    const accessToken = createJwt(Math.floor(now.getTime() / 1000) + 60 * 60);
    const fetchFn = jest.fn(async () => new Response('{}', { status: 500 }));

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: lastRefresh,
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      await expect(
        loadOpenAIOAuthTokens({ authFilePath, fetch: fetchFn, now: () => now }),
      ).rejects.toThrow('OpenAI OAuth token request failed with HTTP 500');
      const persisted = JSON.parse(await readFile(authFilePath, 'utf8')) as {
        last_refresh?: string;
      };
      expect(persisted.last_refresh).toBe(lastRefresh);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
