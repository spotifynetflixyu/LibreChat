import type { OpenAIOAuthTokenResponse } from '@openai-oauth/core';
import type { EffectiveAuth } from '@openai-oauth/local/auth-file';

export type OpenAIOAuthTokenLoaderOptions = {
  authFilePath?: string;
  ensureFresh?: boolean;
  fetch?: typeof fetch;
  now?: () => Date;
};

export type OpenAIOAuthTokens = EffectiveAuth;
export type OpenAIOAuthTokenLoader = (
  options: OpenAIOAuthTokenLoaderOptions,
) => Promise<OpenAIOAuthTokens>;
export type OpenAIOAuthCredentialRefreshOptions = OpenAIOAuthTokenLoaderOptions & {
  force: boolean;
};
export type OpenAIOAuthCredentialRefreshResult = {
  auth: OpenAIOAuthTokens;
  refreshed: boolean;
};

type LocalModule = Pick<
  typeof import('@openai-oauth/local/auth-file'),
  'loadAuthTokens' | 'saveAuthTokens'
>;
type CoreModule = Pick<
  typeof import('@openai-oauth/core'),
  'parseJwtClaims' | 'refreshOpenAIOAuthTokens'
>;

const dynamicImportLocal = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<LocalModule>;
const dynamicImportCore = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<CoreModule>;
const thresholdMs = 2 * 24 * 60 * 60 * 1000;
const refreshes = new Map<string, Promise<OpenAIOAuthCredentialRefreshResult>>();

function shouldAutoRefresh(
  auth: EffectiveAuth,
  now: Date,
  parse: CoreModule['parseJwtClaims'],
): boolean {
  const exp = parse(auth.accessToken)?.exp;
  const lastRefreshMs = typeof auth.lastRefresh === 'string' ? Date.parse(auth.lastRefresh) : NaN;
  return (
    typeof exp === 'number' &&
    Number.isFinite(exp) &&
    Number.isFinite(lastRefreshMs) &&
    exp * 1000 < now.getTime() + thresholdMs &&
    lastRefreshMs < now.getTime() - thresholdMs
  );
}

function preserveTokens(
  refreshed: OpenAIOAuthTokenResponse,
  auth: EffectiveAuth,
): OpenAIOAuthTokenResponse {
  return {
    ...refreshed,
    accountId: refreshed.accountId ?? auth.accountId,
    idToken: refreshed.idToken ?? auth.idToken,
    isFedRamp: auth.isFedRamp === true || refreshed.isFedRamp === true,
    refreshToken: refreshed.refreshToken ?? auth.refreshToken,
  };
}

async function runRefresh({
  core,
  fetch,
  force,
  local,
  now,
  sourcePath,
}: {
  core: CoreModule;
  fetch: typeof globalThis.fetch;
  force: boolean;
  local: LocalModule;
  now: () => Date;
  sourcePath: string;
}): Promise<OpenAIOAuthCredentialRefreshResult> {
  const auth = await local.loadAuthTokens({
    authFilePath: sourcePath,
    ensureFresh: false,
    fetch,
    now,
  });
  if (!auth.refreshToken) {
    if (force) {
      throw new Error('ChatGPT refresh token not found. Sign in again.');
    }
    return { auth, refreshed: false };
  }
  if (!force && !shouldAutoRefresh(auth, now(), core.parseJwtClaims)) {
    return { auth, refreshed: false };
  }
  const token = await core.refreshOpenAIOAuthTokens({ fetch, refreshToken: auth.refreshToken });
  const completedAt = now();
  const saved = await local.saveAuthTokens({
    authFilePath: sourcePath,
    now: () => completedAt,
    token: preserveTokens(token, auth),
  });
  return { auth: saved.auth, refreshed: true };
}

async function singleFlight(
  input: Parameters<typeof runRefresh>[0],
): Promise<OpenAIOAuthCredentialRefreshResult> {
  const existing = refreshes.get(input.sourcePath);
  if (existing) {
    const result = await existing;
    if (!input.force || result.refreshed) {
      return result;
    }
    if (refreshes.get(input.sourcePath) === existing) {
      refreshes.delete(input.sourcePath);
    }
    return singleFlight(input);
  }
  const promise = runRefresh(input);
  refreshes.set(input.sourcePath, promise);
  try {
    return await promise;
  } finally {
    if (refreshes.get(input.sourcePath) === promise) {
      refreshes.delete(input.sourcePath);
    }
  }
}

export async function refreshOpenAIOAuthCredentials(
  options: OpenAIOAuthCredentialRefreshOptions,
): Promise<OpenAIOAuthCredentialRefreshResult> {
  const local = await dynamicImportLocal('@openai-oauth/local/auth-file');
  const fetch = options.fetch ?? globalThis.fetch;
  const auth = await local.loadAuthTokens({
    authFilePath: options.authFilePath,
    ensureFresh: false,
    fetch,
    now: options.now,
  });
  if (!auth.sourcePath) {
    if (options.force) {
      throw new Error('OpenAI OAuth credential source path not found.');
    }
    return { auth, refreshed: false };
  }
  const core = await dynamicImportCore('@openai-oauth/core');
  return singleFlight({
    core,
    fetch,
    force: options.force,
    local,
    now: options.now ?? (() => new Date()),
    sourcePath: auth.sourcePath,
  });
}

export async function loadOpenAIOAuthTokens(
  options: OpenAIOAuthTokenLoaderOptions,
): Promise<OpenAIOAuthTokens> {
  if (options.ensureFresh !== false) {
    return (await refreshOpenAIOAuthCredentials({ ...options, force: false })).auth;
  }
  const local = await dynamicImportLocal('@openai-oauth/local/auth-file');
  return local.loadAuthTokens({
    authFilePath: options.authFilePath,
    ensureFresh: false,
    fetch: options.fetch ?? globalThis.fetch,
    now: options.now,
  });
}
