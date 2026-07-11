import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';

import type {
  OpenAIOAuthTokenLoginMethod,
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenLogoutStatus,
  OpenAIOAuthTokenStatus,
} from 'librechat-data-provider';

import type {
  CodexAppServerClient,
  CodexAppServerJsonObject,
  StartCodexAppServerClientOptions,
} from './appserver';

import { startCodexAppServerClient } from './appserver';

type LoadAuthTokensOptions = {
  authFilePath?: string;
  ensureFresh?: boolean;
  fetch?: typeof fetch;
};

type EffectiveOpenAIOAuth = {
  accessToken: string;
  refreshToken?: string;
};

export type OpenAIOAuthTokenLoader = (
  options: LoadAuthTokensOptions,
) => Promise<EffectiveOpenAIOAuth>;

export type OpenAIOAuthTokenEnv = {
  [key: string]: string | undefined;
  CODEX_CLI_PATH?: string;
  CODEX_HOME?: string;
  HOME?: string;
  OPENAI_OAUTH_CODEX_LOGIN_TIMEOUT_MS?: string;
  STEEL_OPENAI_OAUTH_CODEX_LOGIN_TIMEOUT_MS?: string;
};

export type OpenAIOAuthCodexCommandRunner = (input: {
  args: string[];
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}) => Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

export type OpenAIOAuthAppServerFactory = (
  input: Pick<StartCodexAppServerClientOptions, 'command' | 'cwd' | 'env'>,
) => Promise<CodexAppServerClient>;

type OpenAIOAuthCodexLoginRecord = {
  authFilePath?: string;
  cleanupTimer?: NodeJS.Timeout;
  client: CodexAppServerClient;
  loginId: string;
  status: OpenAIOAuthTokenLoginStatus;
  timeoutTimer?: NodeJS.Timeout;
  unsubscribe: () => void;
};

type CodexLoginCapability =
  | {
      available: true;
      command: string;
    }
  | {
      available: false;
      reason: NonNullable<OpenAIOAuthTokenStatus['login']['reason']>;
    };

type PreparedAppServer =
  | {
      authFilePath?: string;
      client: CodexAppServerClient;
    }
  | {
      login: OpenAIOAuthTokenStatus['login'];
      reason: 'auth_path_unsupported' | 'codex_cli_unavailable' | 'login_failed';
    };

export type OpenAIOAuthCodexLoginStore = Map<string, OpenAIOAuthCodexLoginRecord>;

export type OpenAIOAuthTokenStatusDeps = {
  authFilePath?: string;
  env?: OpenAIOAuthTokenEnv;
  fetch?: typeof fetch;
  loadAuthTokens?: OpenAIOAuthTokenLoader;
  now?: () => Date;
  runCodexCommand?: OpenAIOAuthCodexCommandRunner;
  startAppServerClient?: OpenAIOAuthAppServerFactory;
};

export type OpenAIOAuthCodexLoginDeps = OpenAIOAuthTokenStatusDeps & {
  idFactory?: () => string;
  loginStore?: OpenAIOAuthCodexLoginStore;
  loginTimeoutMs?: number;
  method?: OpenAIOAuthTokenLoginMethod;
  sessionTtlMs?: number;
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<{ loadAuthTokens: OpenAIOAuthTokenLoader }>;

const codexCliProbeTimeoutMs = 5_000;
const defaultLoginTimeoutMs = 10 * 60 * 1000;
const defaultCompletedSessionTtlMs = 15 * 60 * 1000;
const defaultCodexLoginStore: OpenAIOAuthCodexLoginStore = new Map();

async function loadDefaultAuthTokens(
  options: LoadAuthTokensOptions,
): Promise<EffectiveOpenAIOAuth> {
  const core = await dynamicImport('@openai-oauth/core');
  return core.loadAuthTokens(options);
}

function decodeJwtClaims(token: string | undefined): { exp?: unknown } | undefined {
  if (!token) {
    return undefined;
  }
  const [, payload] = token.split('.');
  if (!payload) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
  } catch {
    return undefined;
  }
}

function toOutput(value: string | Buffer | undefined): string {
  if (!value) {
    return '';
  }
  return typeof value === 'string' ? value : value.toString('utf8');
}

function getNodeErrorCode(error: object): string | undefined {
  if (!('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

function runDefaultCodexCommand({
  args,
  command,
  cwd,
  env,
  timeoutMs,
}: Parameters<OpenAIOAuthCodexCommandRunner>[0]): ReturnType<OpenAIOAuthCodexCommandRunner> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, env, maxBuffer: 64_000, timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? 1 : 0,
          stderr: toOutput(stderr),
          stdout: toOutput(stdout),
        });
      },
    );
  });
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function resolveCodexCliCommands(env: OpenAIOAuthTokenEnv = process.env): string[] {
  const home = env.HOME ?? os.homedir();
  const configured = env.CODEX_CLI_PATH?.trim();
  if (configured) {
    return [configured];
  }
  return uniqueValues([
    'codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(home, 'Library/pnpm/bin/codex'),
    path.join(home, '.local/bin/codex'),
  ]);
}

function expandHomePath(value: string, home: string): string {
  if (value === '~') {
    return home;
  }
  return value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
}

function resolveCodexHomePath(env: OpenAIOAuthTokenEnv): string {
  const configuredHome = env.CODEX_HOME?.trim();
  if (configuredHome) {
    return path.resolve(expandHomePath(configuredHome, env.HOME ?? os.homedir()));
  }
  return path.join(env.HOME ?? os.homedir(), '.codex');
}

function createCodexEnv(env: OpenAIOAuthTokenEnv, codexHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...env,
    CODEX_HOME: codexHome,
    HOME: env.HOME ?? process.env.HOME ?? os.homedir(),
    NO_COLOR: '1',
  };
}

async function createCodexLoginCapability({
  env = process.env,
  runCodexCommand = runDefaultCodexCommand,
}: Pick<OpenAIOAuthTokenStatusDeps, 'env' | 'runCodexCommand'>): Promise<CodexLoginCapability> {
  const codexHome = resolveCodexHomePath(env);
  for (const command of resolveCodexCliCommands(env)) {
    try {
      const result = await runCodexCommand({
        args: ['--version'],
        command,
        env: createCodexEnv(env, codexHome),
        timeoutMs: codexCliProbeTimeoutMs,
      });
      if (result.exitCode === 0) {
        return { available: true, command };
      }
    } catch {
      continue;
    }
  }
  return { available: false, reason: 'codex_cli_unavailable' };
}

function toPublicCodexLoginCapability(
  login: CodexLoginCapability,
): OpenAIOAuthTokenStatus['login'] {
  return login.available
    ? { available: true }
    : { available: false, ...(login.reason ? { reason: login.reason } : {}) };
}

function createUnavailableStatus({
  fetchedAt,
  login,
  reason,
}: {
  fetchedAt: Date;
  login: OpenAIOAuthTokenStatus['login'];
  reason: OpenAIOAuthTokenStatus['reason'];
}): OpenAIOAuthTokenStatus {
  return {
    provider: 'openai_oauth_responses',
    status: 'unavailable',
    fetchedAt: fetchedAt.toISOString(),
    reason,
    accessToken: { status: 'unknown' },
    refresh: { available: false },
    login,
  };
}

function createAvailableStatus({
  auth,
  fetchedAt,
  login,
}: {
  auth: EffectiveOpenAIOAuth;
  fetchedAt: Date;
  login: OpenAIOAuthTokenStatus['login'];
}): OpenAIOAuthTokenStatus {
  const exp = decodeJwtClaims(auth.accessToken)?.exp;
  const expiresAtMs = typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
  const expiresInSeconds =
    expiresAtMs === undefined
      ? undefined
      : Math.max(0, Math.floor((expiresAtMs - fetchedAt.getTime()) / 1000));
  const accessToken =
    expiresAtMs === undefined
      ? { status: 'unknown' as const }
      : {
          status: expiresAtMs > fetchedAt.getTime() ? ('valid' as const) : ('expired' as const),
          expiresAt: new Date(expiresAtMs).toISOString(),
          expiresInSeconds,
        };
  return {
    provider: 'openai_oauth_responses',
    status: 'available',
    fetchedAt: fetchedAt.toISOString(),
    accessToken,
    refresh: { available: Boolean(auth.refreshToken) },
    login,
  };
}

async function loadStatus({
  authFilePath,
  env,
  ensureFresh,
  fetch: fetchImpl = globalThis.fetch,
  loadAuthTokens = loadDefaultAuthTokens,
  now = () => new Date(),
  runCodexCommand,
  unavailableReason,
}: OpenAIOAuthTokenStatusDeps & {
  ensureFresh: boolean;
  unavailableReason: OpenAIOAuthTokenStatus['reason'];
}): Promise<OpenAIOAuthTokenStatus> {
  const fetchedAt = now();
  const login = await createCodexLoginCapability({ env, runCodexCommand });
  try {
    const auth = await loadAuthTokens({
      ...(authFilePath ? { authFilePath } : {}),
      ensureFresh,
      fetch: fetchImpl,
    });
    return createAvailableStatus({
      auth,
      fetchedAt,
      login: toPublicCodexLoginCapability(login),
    });
  } catch {
    return createUnavailableStatus({
      fetchedAt,
      login: toPublicCodexLoginCapability(login),
      reason: unavailableReason,
    });
  }
}

function parseLoginTimeoutMs({
  env,
  fallbackMs,
}: {
  env: OpenAIOAuthTokenEnv;
  fallbackMs: number;
}): number {
  const raw =
    env.OPENAI_OAUTH_CODEX_LOGIN_TIMEOUT_MS ?? env.STEEL_OPENAI_OAUTH_CODEX_LOGIN_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 30_000 && parsed <= 30 * 60 * 1000
    ? parsed
    : fallbackMs;
}

function resolveCodexHome({
  authFilePath,
  env,
}: {
  authFilePath?: string;
  env: OpenAIOAuthTokenEnv;
}): { codexHome: string; resolvedAuthFilePath?: string } | { reason: 'auth_path_unsupported' } {
  if (!authFilePath) {
    return { codexHome: resolveCodexHomePath(env) };
  }
  const resolvedAuthFilePath = path.resolve(authFilePath);
  if (path.basename(resolvedAuthFilePath) !== 'auth.json') {
    return { reason: 'auth_path_unsupported' };
  }
  return { codexHome: path.dirname(resolvedAuthFilePath), resolvedAuthFilePath };
}

async function ensureCodexFileCredentialStore(codexHome: string): Promise<void> {
  await mkdir(codexHome, { mode: 0o700, recursive: true });
  const configPath = path.join(codexHome, 'config.toml');
  const setting = 'cli_auth_credentials_store = "file"';
  let existing = '';
  try {
    existing = await readFile(configPath, 'utf8');
  } catch (error) {
    if (typeof error !== 'object' || error === null || getNodeErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
  const next = /^\s*cli_auth_credentials_store\s*=/mu.test(existing)
    ? existing.replace(/^\s*cli_auth_credentials_store\s*=.*$/mu, setting)
    : `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${setting}\n`;
  if (next !== existing) {
    await writeFile(configPath, next, { mode: 0o600 });
  }
}

function createLoginStatus({
  method,
  now,
  reason,
  status,
}: {
  method?: OpenAIOAuthTokenLoginMethod;
  now: Date;
  reason?: OpenAIOAuthTokenLoginStatus['reason'];
  status: OpenAIOAuthTokenLoginStatus['status'];
}): OpenAIOAuthTokenLoginStatus {
  return {
    status,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...(method ? { method } : {}),
    ...(reason ? { reason } : {}),
  };
}

async function prepareAppServer(deps: OpenAIOAuthTokenStatusDeps): Promise<PreparedAppServer> {
  const env = deps.env ?? process.env;
  const login = await createCodexLoginCapability({
    env,
    runCodexCommand: deps.runCodexCommand,
  });
  if (!login.available) {
    return {
      login: toPublicCodexLoginCapability(login),
      reason: 'codex_cli_unavailable',
    };
  }
  const home = resolveCodexHome({ authFilePath: deps.authFilePath, env });
  if ('reason' in home) {
    return { login: { available: true }, reason: home.reason };
  }
  try {
    await ensureCodexFileCredentialStore(home.codexHome);
    const startClient = deps.startAppServerClient ?? startCodexAppServerClient;
    const client = await startClient({
      command: login.command,
      cwd: home.codexHome,
      env: createCodexEnv(env, home.codexHome),
    });
    return {
      authFilePath: home.resolvedAuthFilePath ?? deps.authFilePath,
      client,
    };
  } catch {
    return { login: { available: true }, reason: 'login_failed' };
  }
}

function getString(record: CodexAppServerJsonObject, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function getSafeUrl(record: CodexAppServerJsonObject, key: string): string | undefined {
  const value = getString(record, key);
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function findPendingLoginSession(
  store: OpenAIOAuthCodexLoginStore,
): OpenAIOAuthCodexLoginRecord | undefined {
  return Array.from(store.values()).find((record) => record.status.status === 'pending');
}

function scheduleCompletedSessionCleanup({
  record,
  sessionId,
  sessionTtlMs,
  store,
}: {
  record: OpenAIOAuthCodexLoginRecord;
  sessionId: string;
  sessionTtlMs: number;
  store: OpenAIOAuthCodexLoginStore;
}): void {
  record.cleanupTimer = setTimeout(() => store.delete(sessionId), sessionTtlMs);
  record.cleanupTimer.unref?.();
}

function closeLoginRecord(record: OpenAIOAuthCodexLoginRecord): void {
  if (record.timeoutTimer) {
    clearTimeout(record.timeoutTimer);
  }
  record.unsubscribe();
  record.client.close();
}

function failLoginRecord({
  now,
  reason,
  record,
  sessionId,
  sessionTtlMs,
  store,
}: {
  now: Date;
  reason: OpenAIOAuthTokenLoginStatus['reason'];
  record: OpenAIOAuthCodexLoginRecord;
  sessionId: string;
  sessionTtlMs: number;
  store: OpenAIOAuthCodexLoginStore;
}): void {
  if (record.status.status !== 'pending') {
    return;
  }
  record.status = {
    ...record.status,
    status: 'failed',
    reason,
    updatedAt: now.toISOString(),
  };
  closeLoginRecord(record);
  scheduleCompletedSessionCleanup({ record, sessionId, sessionTtlMs, store });
}

async function completeLoginRecord({
  deps,
  record,
  sessionId,
  sessionTtlMs,
  store,
  success,
}: {
  deps: OpenAIOAuthCodexLoginDeps;
  record: OpenAIOAuthCodexLoginRecord;
  sessionId: string;
  sessionTtlMs: number;
  store: OpenAIOAuthCodexLoginStore;
  success: boolean;
}): Promise<void> {
  if (record.status.status !== 'pending') {
    return;
  }
  if (!success) {
    failLoginRecord({
      now: deps.now?.() ?? new Date(),
      reason: 'login_failed',
      record,
      sessionId,
      sessionTtlMs,
      store,
    });
    return;
  }
  closeLoginRecord(record);
  const token = await loadStatus({
    ...deps,
    authFilePath: record.authFilePath,
    ensureFresh: false,
    unavailableReason: 'auth_unavailable',
  });
  record.status =
    token.status === 'available'
      ? {
          ...record.status,
          status: 'succeeded',
          token,
          updatedAt: (deps.now?.() ?? new Date()).toISOString(),
        }
      : {
          ...record.status,
          status: 'failed',
          reason: 'login_failed',
          updatedAt: (deps.now?.() ?? new Date()).toISOString(),
        };
  scheduleCompletedSessionCleanup({ record, sessionId, sessionTtlMs, store });
}

export function getOpenAIOAuthTokenStatus(
  deps: OpenAIOAuthTokenStatusDeps = {},
): Promise<OpenAIOAuthTokenStatus> {
  return loadStatus({
    ...deps,
    ensureFresh: false,
    unavailableReason: 'auth_unavailable',
  });
}

export async function refreshOpenAIOAuthToken(
  deps: OpenAIOAuthTokenStatusDeps = {},
): Promise<OpenAIOAuthTokenStatus> {
  const prepared = await prepareAppServer(deps);
  if ('reason' in prepared) {
    return createUnavailableStatus({
      fetchedAt: deps.now?.() ?? new Date(),
      login: prepared.login,
      reason: 'refresh_failed',
    });
  }
  try {
    await prepared.client.request('account/read', { refreshToken: true });
  } catch {
    prepared.client.close();
    return createUnavailableStatus({
      fetchedAt: deps.now?.() ?? new Date(),
      login: { available: true },
      reason: 'refresh_failed',
    });
  }
  prepared.client.close();
  return loadStatus({
    ...deps,
    authFilePath: prepared.authFilePath,
    ensureFresh: false,
    unavailableReason: 'refresh_failed',
  });
}

export async function startOpenAIOAuthCodexLogin(
  deps: OpenAIOAuthCodexLoginDeps = {},
): Promise<OpenAIOAuthTokenLoginStatus> {
  const now = deps.now?.() ?? new Date();
  const method = deps.method ?? 'device_code';
  const store = deps.loginStore ?? defaultCodexLoginStore;
  const pending = findPendingLoginSession(store);
  if (pending) {
    return pending.status;
  }
  const prepared = await prepareAppServer(deps);
  if ('reason' in prepared) {
    return createLoginStatus({
      method,
      now,
      reason: prepared.reason === 'login_failed' ? 'login_failed' : prepared.reason,
      status: prepared.reason === 'codex_cli_unavailable' ? 'unavailable' : 'failed',
    });
  }

  const sessionId = deps.idFactory?.() ?? randomUUID();
  const loginTimeoutMs =
    deps.loginTimeoutMs ??
    parseLoginTimeoutMs({ env: deps.env ?? process.env, fallbackMs: defaultLoginTimeoutMs });
  const sessionTtlMs = deps.sessionTtlMs ?? defaultCompletedSessionTtlMs;
  const expiresAt = new Date(now.getTime() + loginTimeoutMs).toISOString();
  const recordRef: { current?: OpenAIOAuthCodexLoginRecord } = {};
  let earlyCompletion: { loginId?: string; success: boolean } | undefined;
  const onCompleted = (params: CodexAppServerJsonObject) => {
    const completion = {
      loginId: getString(params, 'loginId'),
      success: params.success === true,
    };
    if (!recordRef.current) {
      earlyCompletion = completion;
      return;
    }
    if (completion.loginId !== recordRef.current.loginId) {
      return;
    }
    void completeLoginRecord({
      deps,
      record: recordRef.current,
      sessionId,
      sessionTtlMs,
      store,
      ...completion,
    });
  };
  const unsubscribeCompleted = prepared.client.on('account/login/completed', onCompleted);

  let response: CodexAppServerJsonObject;
  try {
    response = await prepared.client.request('account/login/start', {
      type: method === 'browser' ? 'chatgpt' : 'chatgptDeviceCode',
    });
  } catch {
    unsubscribeCompleted();
    prepared.client.close();
    return createLoginStatus({ method, now, reason: 'login_failed', status: 'failed' });
  }
  const loginId = getString(response, 'loginId');
  const authUrl = getSafeUrl(response, 'authUrl');
  const verificationUri = getSafeUrl(response, 'verificationUrl');
  const userCode = getString(response, 'userCode');
  const validResponse =
    loginId &&
    ((method === 'browser' && authUrl) ||
      (method === 'device_code' && verificationUri && userCode));
  if (!validResponse) {
    unsubscribeCompleted();
    prepared.client.close();
    return createLoginStatus({ method, now, reason: 'login_failed', status: 'failed' });
  }

  const status: OpenAIOAuthTokenLoginStatus = {
    status: 'pending',
    method,
    sessionId,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt,
    ...(authUrl ? { browser: { authUrl } } : {}),
    ...(verificationUri && userCode ? { device: { verificationUri, userCode } } : {}),
  };
  const unsubscribeClosed = prepared.client.on('app-server/closed', () => {
    if (!recordRef.current) {
      return;
    }
    failLoginRecord({
      now: deps.now?.() ?? new Date(),
      reason: 'login_failed',
      record: recordRef.current,
      sessionId,
      sessionTtlMs,
      store,
    });
  });
  const record: OpenAIOAuthCodexLoginRecord = {
    authFilePath: prepared.authFilePath,
    client: prepared.client,
    loginId,
    status,
    unsubscribe: () => {
      unsubscribeCompleted();
      unsubscribeClosed();
    },
  };
  recordRef.current = record;
  store.set(sessionId, record);
  record.timeoutTimer = setTimeout(() => {
    if (!record) {
      return;
    }
    void record.client
      .request('account/login/cancel', { loginId: record.loginId })
      .catch(() => undefined);
    failLoginRecord({
      now: deps.now?.() ?? new Date(),
      reason: 'login_timeout',
      record,
      sessionId,
      sessionTtlMs,
      store,
    });
  }, loginTimeoutMs);
  record.timeoutTimer.unref?.();
  if (earlyCompletion?.loginId === loginId) {
    void completeLoginRecord({
      deps,
      record,
      sessionId,
      sessionTtlMs,
      store,
      success: earlyCompletion.success,
    });
  }
  return status;
}

export function getOpenAIOAuthCodexLoginStatus(
  sessionId: string,
  deps: OpenAIOAuthCodexLoginDeps = {},
): OpenAIOAuthTokenLoginStatus {
  return (
    (deps.loginStore ?? defaultCodexLoginStore).get(sessionId)?.status ??
    createLoginStatus({
      now: deps.now?.() ?? new Date(),
      reason: 'login_not_found',
      status: 'failed',
    })
  );
}

export async function logoutOpenAIOAuthToken(
  deps: OpenAIOAuthCodexLoginDeps = {},
): Promise<OpenAIOAuthTokenLogoutStatus> {
  const now = deps.now?.() ?? new Date();
  const store = deps.loginStore ?? defaultCodexLoginStore;
  for (const [sessionId, record] of store) {
    if (record.status.status !== 'pending') {
      continue;
    }
    void record.client
      .request('account/login/cancel', { loginId: record.loginId })
      .catch(() => undefined);
    failLoginRecord({
      now,
      reason: 'login_failed',
      record,
      sessionId,
      sessionTtlMs: deps.sessionTtlMs ?? defaultCompletedSessionTtlMs,
      store,
    });
  }
  const prepared = await prepareAppServer(deps);
  if ('reason' in prepared) {
    return {
      status: prepared.reason === 'codex_cli_unavailable' ? 'unavailable' : 'failed',
      fetchedAt: now.toISOString(),
      reason: prepared.reason === 'login_failed' ? 'logout_failed' : prepared.reason,
    };
  }
  try {
    await prepared.client.request('account/logout');
  } catch {
    prepared.client.close();
    return { status: 'failed', fetchedAt: now.toISOString(), reason: 'logout_failed' };
  }
  prepared.client.close();
  const token = await loadStatus({
    ...deps,
    authFilePath: prepared.authFilePath,
    ensureFresh: false,
    unavailableReason: 'auth_unavailable',
  });
  return { status: 'succeeded', fetchedAt: now.toISOString(), token };
}
