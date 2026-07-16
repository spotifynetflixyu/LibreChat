import type {
  OpenAIOAuthUsageRemaining,
  OpenAIOAuthUsageUnavailableReason,
  OpenAIOAuthUsageWindow,
  OpenAIOAuthUsageWindowKey,
} from 'librechat-data-provider';
import type { OpenAIOAuthTokenLoader, OpenAIOAuthTokens } from './credentials';

import {
  clearOpenAIOAuthCredentialInvalid,
  getOpenAIOAuthCredentialKey,
  isOpenAIOAuthUnauthorizedError,
  markOpenAIOAuthCredentialInvalid,
} from './auth-state';
import { loadOpenAIOAuthTokens } from './credentials';

const usageEndpoint = 'https://chatgpt.com/backend-api/wham/usage';
const defaultTtlMs = 60_000;

type CachedUsage = {
  expiresAtMs: number;
  response: OpenAIOAuthUsageRemaining;
};

export type OpenAIOAuthUsageCache = {
  entry?: CachedUsage;
  entries?: Map<string, CachedUsage>;
  inflight?: Map<string, Promise<OpenAIOAuthUsageRemaining>>;
};

export type OpenAIOAuthUsageDeps = {
  authFilePath?: string;
  cache?: OpenAIOAuthUsageCache;
  ensureFresh?: boolean;
  fetch?: typeof fetch;
  loadAuthTokens?: OpenAIOAuthTokenLoader;
  now?: () => Date;
  ttlMs?: number;
};

const defaultCache: OpenAIOAuthUsageCache = {};
const unavailableTtlMs = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toIsoFromEpochSeconds(value: number): string | undefined {
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function createUnavailableResponse({
  fetchedAt,
  reason,
}: {
  fetchedAt: Date;
  reason: OpenAIOAuthUsageUnavailableReason;
}): OpenAIOAuthUsageRemaining {
  return {
    provider: 'openai_oauth_responses',
    source: 'chatgpt_wham_usage',
    status: 'unavailable',
    fetchedAt: fetchedAt.toISOString(),
    reason,
    windows: [],
  };
}

function parseUsageWindow({
  key,
  limitReached,
  raw,
}: {
  key: OpenAIOAuthUsageWindowKey;
  limitReached: boolean;
  raw?: Record<string, unknown>;
}): OpenAIOAuthUsageWindow | undefined {
  if (!raw) {
    return undefined;
  }

  const usedPercent = getNumber(raw, 'used_percent');
  const limitWindowSeconds = getNumber(raw, 'limit_window_seconds');
  const resetAfterSeconds = getNumber(raw, 'reset_after_seconds');
  const resetAt = getNumber(raw, 'reset_at');
  if (usedPercent === undefined) {
    return undefined;
  }

  const normalizedResetAt = resetAt === undefined ? undefined : toIsoFromEpochSeconds(resetAt);

  return {
    key,
    usedPercent: clampPercent(usedPercent),
    remainingPercent: clampPercent(100 - usedPercent),
    ...(limitWindowSeconds !== undefined ? { limitWindowSeconds } : {}),
    ...(resetAfterSeconds !== undefined ? { resetAfterSeconds } : {}),
    ...(normalizedResetAt ? { resetAt: normalizedResetAt } : {}),
    limitReached,
  };
}

function parseUsagePayload({
  fetchedAt,
  payload,
  ttlMs,
}: {
  fetchedAt: Date;
  payload: unknown;
  ttlMs: number;
}): OpenAIOAuthUsageRemaining | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const rateLimit = getRecord(payload, 'rate_limit');
  if (!rateLimit) {
    return undefined;
  }

  const limitReached = getBoolean(rateLimit, 'limit_reached') ?? false;
  const primary = parseUsageWindow({
    key: 'primary',
    limitReached,
    raw: getRecord(rateLimit, 'primary_window'),
  });
  const secondary = parseUsageWindow({
    key: 'secondary',
    limitReached,
    raw: getRecord(rateLimit, 'secondary_window'),
  });
  const windows = [primary, secondary].filter(
    (window): window is OpenAIOAuthUsageWindow => window !== undefined,
  );
  if (windows.length === 0) {
    return undefined;
  }

  return {
    provider: 'openai_oauth_responses',
    source: 'chatgpt_wham_usage',
    status: 'available',
    fetchedAt: fetchedAt.toISOString(),
    cacheExpiresAt: new Date(fetchedAt.getTime() + ttlMs).toISOString(),
    windows,
  };
}

function getCachedResponse({
  cache,
  key,
  nowMs,
}: {
  cache: OpenAIOAuthUsageCache;
  key: string;
  nowMs: number;
}): OpenAIOAuthUsageRemaining | undefined {
  const entry = cache.entries?.get(key) ?? (key === 'default' ? cache.entry : undefined);
  if (!entry || entry.expiresAtMs <= nowMs) {
    return undefined;
  }
  return entry.response;
}

function getCacheKey({ authFilePath }: Pick<OpenAIOAuthUsageDeps, 'authFilePath'>): string {
  return getOpenAIOAuthCredentialKey(authFilePath);
}

export function invalidateOpenAIOAuthUsageCache({
  authFilePath,
  cache = defaultCache,
}: Pick<OpenAIOAuthUsageDeps, 'authFilePath' | 'cache'> = {}): void {
  const key = getCacheKey({ authFilePath });
  cache.entries?.delete(key);
  cache.inflight?.delete(key);
  if (key === 'default') {
    delete cache.entry;
  }
}

function cacheResponse({
  cache,
  key,
  nowMs,
  response,
  ttlMs,
}: {
  cache: OpenAIOAuthUsageCache;
  key: string;
  nowMs: number;
  response: OpenAIOAuthUsageRemaining;
  ttlMs: number;
}): void {
  const entry = {
    expiresAtMs: nowMs + ttlMs,
    response,
  };
  cache.entries ??= new Map();
  cache.entries.set(key, entry);
  if (key === 'default') {
    cache.entry = entry;
  }
}

async function loadOpenAIOAuthUsageRemaining({
  authFilePath,
  ensureFresh = true,
  fetch: fetchImpl = globalThis.fetch,
  loadAuthTokens = loadOpenAIOAuthTokens,
  fetchedAt,
  ttlMs = defaultTtlMs,
}: Omit<OpenAIOAuthUsageDeps, 'cache' | 'now'> & {
  fetchedAt: Date;
}): Promise<OpenAIOAuthUsageRemaining> {
  let auth: OpenAIOAuthTokens;
  try {
    auth = await loadAuthTokens({
      ...(authFilePath ? { authFilePath } : {}),
      ensureFresh,
      fetch: fetchImpl,
    });
  } catch (error) {
    if (isOpenAIOAuthUnauthorizedError(error)) {
      markOpenAIOAuthCredentialInvalid(authFilePath);
      return createUnavailableResponse({ fetchedAt, reason: 'unauthorized' });
    }
    return createUnavailableResponse({ fetchedAt, reason: 'auth_unavailable' });
  }

  let response: Response;
  try {
    response = await fetchImpl(usageEndpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    });
  } catch {
    return createUnavailableResponse({ fetchedAt, reason: 'request_failed' });
  }

  if (!response.ok) {
    if (response.status === 401) {
      markOpenAIOAuthCredentialInvalid(authFilePath);
      return createUnavailableResponse({ fetchedAt, reason: 'unauthorized' });
    }
    return createUnavailableResponse({ fetchedAt, reason: 'request_failed' });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return createUnavailableResponse({ fetchedAt, reason: 'invalid_response' });
  }

  const parsed = parseUsagePayload({ fetchedAt, payload, ttlMs });
  if (!parsed) {
    return createUnavailableResponse({ fetchedAt, reason: 'invalid_response' });
  }

  clearOpenAIOAuthCredentialInvalid(authFilePath);
  return parsed;
}

export async function getOpenAIOAuthUsageRemaining({
  authFilePath,
  cache = defaultCache,
  ensureFresh = true,
  fetch: fetchImpl = globalThis.fetch,
  loadAuthTokens = loadOpenAIOAuthTokens,
  now = () => new Date(),
  ttlMs = defaultTtlMs,
}: OpenAIOAuthUsageDeps = {}): Promise<OpenAIOAuthUsageRemaining> {
  const fetchedAt = now();
  const nowMs = fetchedAt.getTime();
  const key = getCacheKey({ authFilePath });
  const cachedResponse = getCachedResponse({ cache, key, nowMs });
  if (cachedResponse) {
    return cachedResponse;
  }

  const inflight = cache.inflight?.get(key);
  if (inflight) {
    return inflight;
  }

  cache.inflight ??= new Map();
  const request = loadOpenAIOAuthUsageRemaining({
    authFilePath,
    ensureFresh,
    fetch: fetchImpl,
    loadAuthTokens,
    fetchedAt,
    ttlMs,
  });
  cache.inflight.set(key, request);

  try {
    const response = await request;
    cacheResponse({
      cache,
      key,
      nowMs,
      response,
      ttlMs: response.status === 'available' ? ttlMs : Math.min(ttlMs, unavailableTtlMs),
    });
    return response;
  } finally {
    cache.inflight.delete(key);
  }
}
