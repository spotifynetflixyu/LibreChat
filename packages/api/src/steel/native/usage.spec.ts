import { getOpenAIOAuthUsageRemaining } from './usage';

const primaryResetAt = 1782471969;
const weeklyResetAt = 1782975152;

function createUsagePayload() {
  return {
    user_id: 'user_sensitive',
    account_id: 'acct_sensitive',
    email: 'person@example.com',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 20,
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
