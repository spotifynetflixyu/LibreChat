import { getOpenAIOAuthUsageRemaining, invalidateOpenAIOAuthUsageCache } from './usage';

const primaryResetAt = 1782471969;
const weeklyResetAt = 1782975152;

function createUsagePayload(usedPercent = 20) {
  return {
    user_id: 'user_sensitive',
    account_id: 'acct_sensitive',
    email: 'person@example.com',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: usedPercent,
        limit_window_seconds: 18000,
        reset_after_seconds: 14685,
        reset_at: primaryResetAt,
      },
      secondary_window: {
        used_percent: 45,
        limit_window_seconds: 604800,
        reset_after_seconds: 517868,
        reset_at: weeklyResetAt,
      },
    },
  };
}

describe('OpenAI OAuth usage remaining service', () => {
  it('fetches ChatGPT OAuth WHAM usage and returns only sanitized remaining windows', async () => {
    const loadAuthTokens = jest.fn(async () => ({
      accessToken: 'token_sensitive',
      accountId: 'acct_sensitive',
      email: 'person@example.com',
      refreshToken: 'refresh_sensitive',
    }));
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify(createUsagePayload())));

    const result = await getOpenAIOAuthUsageRemaining({
      cache: {},
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:00.000Z'),
      ttlMs: 60_000,
    });

    expect(loadAuthTokens).toHaveBeenCalledWith({
      ensureFresh: true,
      fetch: fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://chatgpt.com/backend-api/wham/usage', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer token_sensitive',
      },
    });
    expect(result).toEqual({
      provider: 'openai_oauth_responses',
      source: 'chatgpt_wham_usage',
      status: 'available',
      fetchedAt: '2026-06-26T07:00:00.000Z',
      cacheExpiresAt: '2026-06-26T07:01:00.000Z',
      windows: [
        {
          key: 'primary',
          usedPercent: 20,
          remainingPercent: 80,
          limitWindowSeconds: 18000,
          resetAfterSeconds: 14685,
          resetAt: '2026-06-26T11:06:09.000Z',
          limitReached: false,
        },
        {
          key: 'secondary',
          usedPercent: 45,
          remainingPercent: 55,
          limitWindowSeconds: 604800,
          resetAfterSeconds: 517868,
          resetAt: '2026-07-02T06:52:32.000Z',
          limitReached: false,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /token_sensitive|refresh_sensitive|acct_sensitive|person@example.com|user_sensitive/i,
    );
  });

  it('uses the in-memory cache until the TTL expires', async () => {
    const cache = {};
    let nowMs = Date.parse('2026-06-26T07:00:00.000Z');
    const loadAuthTokens = jest.fn(async () => ({
      accessToken: 'token_sensitive',
      accountId: 'acct_sensitive',
    }));
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify(createUsagePayload())));

    await getOpenAIOAuthUsageRemaining({
      cache,
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date(nowMs),
      ttlMs: 60_000,
    });
    nowMs += 30_000;
    await getOpenAIOAuthUsageRemaining({
      cache,
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date(nowMs),
      ttlMs: 60_000,
    });
    nowMs += 31_000;
    await getOpenAIOAuthUsageRemaining({
      cache,
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date(nowMs),
      ttlMs: 60_000,
    });

    expect(loadAuthTokens).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('invalidates the auth-file cache after token actions', async () => {
    const cache = {};
    const fetchImpl = jest.fn(async () => createResponse(createUsagePayload()));
    const deps = {
      authFilePath: '/data/openai-oauth/auth.json',
      cache,
      fetch: fetchImpl as typeof fetch,
      loadAuthTokens: jest.fn(async () => ({ accessToken: 'token_sensitive' })),
      now: () => new Date('2026-06-26T07:00:00.000Z'),
    };

    await getOpenAIOAuthUsageRemaining(deps);
    await getOpenAIOAuthUsageRemaining(deps);
    invalidateOpenAIOAuthUsageCache({ authFilePath: deps.authFilePath, cache });
    await getOpenAIOAuthUsageRemaining(deps);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps cached usage separate by auth file path', async () => {
    const cache = {};
    const loadAuthTokens = jest.fn(async ({ authFilePath }: { authFilePath?: string }) => ({
      accessToken: `token_sensitive_${authFilePath}`,
    }));
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(createUsagePayload(20))))
      .mockResolvedValueOnce(new Response(JSON.stringify(createUsagePayload(70))));

    const first = await getOpenAIOAuthUsageRemaining({
      authFilePath: '/tmp/auth-a.json',
      cache,
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:00.000Z'),
    });
    const second = await getOpenAIOAuthUsageRemaining({
      authFilePath: '/tmp/auth-b.json',
      cache,
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:30.000Z'),
    });
    const firstAgain = await getOpenAIOAuthUsageRemaining({
      authFilePath: '/tmp/auth-a.json',
      cache,
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:45.000Z'),
    });

    expect(first.windows[0]?.remainingPercent).toBe(80);
    expect(second.windows[0]?.remainingPercent).toBe(30);
    expect(firstAgain.windows[0]?.remainingPercent).toBe(80);
    expect(loadAuthTokens).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent usage requests for the same auth file path', async () => {
    const cache = {};
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchImpl = jest.fn(() => fetchResponse);
    const loadAuthTokens = jest.fn(async () => ({
      accessToken: 'token_sensitive',
    }));

    const first = getOpenAIOAuthUsageRemaining({
      authFilePath: '/tmp/auth-a.json',
      cache,
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:00.000Z'),
    });
    const second = getOpenAIOAuthUsageRemaining({
      authFilePath: '/tmp/auth-a.json',
      cache,
      fetch: fetchImpl,
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:00.000Z'),
    });

    resolveFetch(new Response(JSON.stringify(createUsagePayload())));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(loadAuthTokens).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns sanitized unavailable state when OAuth auth cannot be loaded', async () => {
    const loadAuthTokens = jest.fn(async () => {
      throw new Error('token_sensitive in auth file');
    });

    const result = await getOpenAIOAuthUsageRemaining({
      cache: {},
      fetch: jest.fn(),
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:00.000Z'),
    });

    expect(result).toEqual({
      provider: 'openai_oauth_responses',
      source: 'chatgpt_wham_usage',
      status: 'unavailable',
      fetchedAt: '2026-06-26T07:00:00.000Z',
      reason: 'auth_unavailable',
      windows: [],
    });
    expect(JSON.stringify(result)).not.toMatch(/token_sensitive|auth file/i);
  });

  it('caches unavailable auth state briefly', async () => {
    const cache = {};
    const loadAuthTokens = jest.fn(async () => {
      throw new Error('token_sensitive in auth file');
    });

    await getOpenAIOAuthUsageRemaining({
      authFilePath: '/tmp/auth-a.json',
      cache,
      fetch: jest.fn(),
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:00.000Z'),
    });
    await getOpenAIOAuthUsageRemaining({
      authFilePath: '/tmp/auth-a.json',
      cache,
      fetch: jest.fn(),
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:05.000Z'),
    });
    await getOpenAIOAuthUsageRemaining({
      authFilePath: '/tmp/auth-a.json',
      cache,
      fetch: jest.fn(),
      loadAuthTokens,
      now: () => new Date('2026-06-26T07:00:11.000Z'),
    });

    expect(loadAuthTokens).toHaveBeenCalledTimes(2);
  });

  it('returns sanitized unavailable state when usage payload shape is invalid', async () => {
    const result = await getOpenAIOAuthUsageRemaining({
      cache: {},
      fetch: jest.fn(async () => new Response(JSON.stringify({ account_id: 'acct_sensitive' }))),
      loadAuthTokens: jest.fn(async () => ({
        accessToken: 'token_sensitive',
        accountId: 'acct_sensitive',
      })),
      now: () => new Date('2026-06-26T07:00:00.000Z'),
    });

    expect(result).toEqual({
      provider: 'openai_oauth_responses',
      source: 'chatgpt_wham_usage',
      status: 'unavailable',
      fetchedAt: '2026-06-26T07:00:00.000Z',
      reason: 'invalid_response',
      windows: [],
    });
    expect(JSON.stringify(result)).not.toMatch(/token_sensitive|acct_sensitive/i);
  });
});
