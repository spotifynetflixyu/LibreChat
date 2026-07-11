import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile, spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';

import type {
  OpenAIOAuthTokenLoginStatus,
  OpenAIOAuthTokenStatus,
} from 'librechat-data-provider';

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

export type OpenAIOAuthCodexLoginSpawner = (input: {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onExit: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
  onOutput: (chunk: string) => void;
}) => {
  kill: () => void;
};

type OpenAIOAuthCodexLoginRecord = {
  authFilePath?: string;
  cleanupTimer?: NodeJS.Timeout;
  kill?: () => void;
  output: string;
  status: OpenAIOAuthTokenLoginStatus;
  timeoutTimer?: NodeJS.Timeout;
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

export type OpenAIOAuthCodexLoginStore = Map<string, OpenAIOAuthCodexLoginRecord>;

export type OpenAIOAuthTokenStatusDeps = {
  authFilePath?: string;
  env?: OpenAIOAuthTokenEnv;
  fetch?: typeof fetch;
  loadAuthTokens?: OpenAIOAuthTokenLoader;
  now?: () => Date;
  runCodexCommand?: OpenAIOAuthCodexCommandRunner;
};

export type OpenAIOAuthCodexLoginDeps = OpenAIOAuthTokenStatusDeps & {
  idFactory?: () => string;
  loginStore?: OpenAIOAuthCodexLoginStore;
  loginTimeoutMs?: number;
  sessionTtlMs?: number;
  spawnCodexLogin?: OpenAIOAuthCodexLoginSpawner;
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<{ loadAuthTokens: OpenAIOAuthTokenLoader }>;

const codexCliProbeTimeoutMs = 5_000;
const defaultLoginTimeoutMs = 10 * 60 * 1000;
const defaultCompletedSessionTtlMs = 15 * 60 * 1000;
const maxCodexLoginOutputChars = 20_000;
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
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return parsed;
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

function getNodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === 'string' ? code : undefined;
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
      {
        cwd,
        env,
        maxBuffer: 64_000,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? 1 : 0,
          stdout: toOutput(stdout),
          stderr: toOutput(stderr),
        });
      },
    );
  });
}

function spawnDefaultCodexLogin({
  args,
  command,
  cwd,
  env,
  onExit,
  onOutput,
}: Parameters<OpenAIOAuthCodexLoginSpawner>[0]): ReturnType<OpenAIOAuthCodexLoginSpawner> {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => onOutput(chunk));
  child.stderr.on('data', (chunk: string) => onOutput(chunk));
  child.once('error', () => onExit({ code: 1, signal: null }));
  child.once('exit', (code, signal) => onExit({ code, signal }));

  return {
    kill: () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    },
  };
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
  if (value.startsWith('~/')) {
    return path.join(home, value.slice(2));
  }

  return value;
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
}: Pick<OpenAIOAuthTokenStatusDeps, 'env' | 'runCodexCommand'>): Promise<
  CodexLoginCapability
> {
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
      // Keep the response sanitized; raw CLI errors can include local paths.
    }
  }

  return {
    available: false,
    reason: 'codex_cli_unavailable',
  };
}

function toPublicCodexLoginCapability(
  login: CodexLoginCapability,
): OpenAIOAuthTokenStatus['login'] {
  if (login.available) {
    return { available: true };
  }

  return {
    available: false,
    ...(login.reason ? { reason: login.reason } : {}),
  };
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
    accessToken: {
      status: 'unknown',
    },
    refresh: {
      available: false,
    },
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
    refresh: {
      available: Boolean(auth.refreshToken),
    },
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

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function trimDeviceUri(value: string): string {
  return value.replace(/[),.;]+$/u, '');
}

function normalizeDeviceCode(value: string): string | undefined {
  const normalized = value.replace(/\s+/gu, '-').toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4,5}$/u.test(normalized)) {
    return undefined;
  }
  if (!/\d/u.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function extractDeviceCodeCandidate(value: string): string | undefined {
  const candidate = value.match(/\b([A-Z0-9]{4}[- ][A-Z0-9]{4,5})\b/u)?.[1];
  return candidate ? normalizeDeviceCode(candidate) : undefined;
}

function isDeviceCodePrompt(value: string): boolean {
  return /\b(?:enter|use|copy|paste|input|type)\b.{0,100}\b(?:one-time\s+)?code\b/iu.test(value);
}

function parseCodexDeviceCode(output: string): string | undefined {
  const lines = output.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isDeviceCodePrompt(line)) {
      continue;
    }

    const sameLineCode = extractDeviceCodeCandidate(line);
    if (sameLineCode) {
      return sameLineCode;
    }

    for (let offset = 1; offset <= 3; offset += 1) {
      const nearbyLine = lines[index + offset];
      if (nearbyLine === undefined) {
        break;
      }

      const nearbyCode = extractDeviceCodeCandidate(nearbyLine);
      if (nearbyCode) {
        return nearbyCode;
      }
    }
  }

  return undefined;
}

function parseCodexDevice(output: string): OpenAIOAuthTokenLoginStatus['device'] | undefined {
  const sanitizedOutput = stripAnsi(output);
  const verificationUri = sanitizedOutput.match(/https:\/\/[^\s'"<>]+/u)?.[0];
  const userCode = parseCodexDeviceCode(sanitizedOutput);

  if (!verificationUri && !userCode) {
    return undefined;
  }

  return {
    ...(verificationUri ? { verificationUri: trimDeviceUri(verificationUri) } : {}),
    ...(userCode ? { userCode } : {}),
  };
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
  if (Number.isFinite(parsed) && parsed >= 30_000 && parsed <= 30 * 60 * 1000) {
    return parsed;
  }

  return fallbackMs;
}

function resolveCodexHome({
  authFilePath,
  env,
}: {
  authFilePath?: string;
  env: OpenAIOAuthTokenEnv;
}):
  | {
      codexHome: string;
      resolvedAuthFilePath?: string;
    }
  | {
      reason: 'auth_path_unsupported';
    } {
  if (authFilePath) {
    const resolvedAuthFilePath = path.resolve(authFilePath);
    if (path.basename(resolvedAuthFilePath) !== 'auth.json') {
      return { reason: 'auth_path_unsupported' };
    }

    return {
      codexHome: path.dirname(resolvedAuthFilePath),
      resolvedAuthFilePath,
    };
  }

  return { codexHome: resolveCodexHomePath(env) };
}

async function ensureCodexFileCredentialStore(codexHome: string): Promise<void> {
  await mkdir(codexHome, { mode: 0o700, recursive: true });
  const configPath = path.join(codexHome, 'config.toml');
  const setting = 'cli_auth_credentials_store = "file"';
  let existing = '';

  try {
    existing = await readFile(configPath, 'utf8');
  } catch (error) {
    if (getNodeErrorCode(error) !== 'ENOENT') {
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
  now,
  reason,
  status,
}: {
  now: Date;
  reason?: OpenAIOAuthTokenLoginStatus['reason'];
  status: OpenAIOAuthTokenLoginStatus['status'];
}): OpenAIOAuthTokenLoginStatus {
  return {
    status,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...(reason ? { reason } : {}),
  };
}

function findPendingLoginSession(
  store: OpenAIOAuthCodexLoginStore,
): OpenAIOAuthCodexLoginRecord | undefined {
  return Array.from(store.values()).find((record) => record.status.status === 'pending');
}

function updateLoginDevice(record: OpenAIOAuthCodexLoginRecord, now: Date): void {
  const device = parseCodexDevice(record.output);
  if (!device) {
    return;
  }

  record.status = {
    ...record.status,
    device,
    updatedAt: now.toISOString(),
  };
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
  if (record.cleanupTimer) {
    clearTimeout(record.cleanupTimer);
  }

  record.cleanupTimer = setTimeout(() => {
    store.delete(sessionId);
  }, sessionTtlMs);
  record.cleanupTimer.unref?.();
}

async function completeCodexLogin({
  authFilePath,
  code,
  deps,
  reason,
  record,
  sessionId,
  sessionTtlMs,
  store,
}: {
  authFilePath?: string;
  code: number | null;
  deps: OpenAIOAuthCodexLoginDeps;
  reason?: OpenAIOAuthTokenLoginStatus['reason'];
  record: OpenAIOAuthCodexLoginRecord;
  sessionId: string;
  sessionTtlMs: number;
  store: OpenAIOAuthCodexLoginStore;
}): Promise<void> {
  if (record.status.status !== 'pending') {
    return;
  }

  if (record.timeoutTimer) {
    clearTimeout(record.timeoutTimer);
  }

  const now = deps.now?.() ?? new Date();
  if (reason || code !== 0) {
    record.status = {
      ...record.status,
      status: 'failed',
      reason: reason ?? 'login_failed',
      updatedAt: now.toISOString(),
    };
    scheduleCompletedSessionCleanup({ record, sessionId, sessionTtlMs, store });
    return;
  }

  const token = await loadStatus({
    ...deps,
    authFilePath,
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

export function refreshOpenAIOAuthToken(
  deps: OpenAIOAuthTokenStatusDeps = {},
): Promise<OpenAIOAuthTokenStatus> {
  return loadStatus({
    ...deps,
    ensureFresh: true,
    unavailableReason: 'refresh_failed',
  });
}

export async function startOpenAIOAuthCodexLogin(
  deps: OpenAIOAuthCodexLoginDeps = {},
): Promise<OpenAIOAuthTokenLoginStatus> {
  const env = deps.env ?? process.env;
  const now = deps.now?.() ?? new Date();
  const login = await createCodexLoginCapability({
    env,
    runCodexCommand: deps.runCodexCommand,
  });
  if (!login.available) {
    return createLoginStatus({
      now,
      reason: 'codex_cli_unavailable',
      status: 'unavailable',
    });
  }

  const home = resolveCodexHome({ authFilePath: deps.authFilePath, env });
  if ('reason' in home) {
    return createLoginStatus({
      now,
      reason: home.reason,
      status: 'failed',
    });
  }

  const store = deps.loginStore ?? defaultCodexLoginStore;
  const pending = findPendingLoginSession(store);
  if (pending) {
    return pending.status;
  }

  try {
    await ensureCodexFileCredentialStore(home.codexHome);
  } catch {
    return createLoginStatus({
      now,
      reason: 'login_failed',
      status: 'failed',
    });
  }

  const sessionId = deps.idFactory?.() ?? randomUUID();
  const loginTimeoutMs = deps.loginTimeoutMs ?? parseLoginTimeoutMs({ env, fallbackMs: defaultLoginTimeoutMs });
  const sessionTtlMs = deps.sessionTtlMs ?? defaultCompletedSessionTtlMs;
  const expiresAt = new Date(now.getTime() + loginTimeoutMs).toISOString();
  const record: OpenAIOAuthCodexLoginRecord = {
    authFilePath: home.resolvedAuthFilePath ?? deps.authFilePath,
    output: '',
    status: {
      status: 'pending',
      sessionId,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt,
    },
  };

  store.set(sessionId, record);

  const spawnCodexLogin = deps.spawnCodexLogin ?? spawnDefaultCodexLogin;
  let child: ReturnType<OpenAIOAuthCodexLoginSpawner>;
  try {
    child = spawnCodexLogin({
      args: ['login', '--device-auth'],
      command: login.command ?? 'codex',
      cwd: home.codexHome,
      env: createCodexEnv(env, home.codexHome),
      onExit: (result) => {
        void completeCodexLogin({
          authFilePath: record.authFilePath,
          code: result.code,
          deps,
          record,
          sessionId,
          sessionTtlMs,
          store,
        });
      },
      onOutput: (chunk) => {
        record.output = `${record.output}${chunk}`.slice(-maxCodexLoginOutputChars);
        updateLoginDevice(record, deps.now?.() ?? new Date());
      },
    });
  } catch {
    record.status = {
      ...record.status,
      reason: 'login_failed',
      status: 'failed',
      updatedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
    scheduleCompletedSessionCleanup({ record, sessionId, sessionTtlMs, store });
    return record.status;
  }
  record.kill = child.kill;
  record.timeoutTimer = setTimeout(() => {
    record.kill?.();
    void completeCodexLogin({
      authFilePath: record.authFilePath,
      code: null,
      deps,
      reason: 'login_timeout',
      record,
      sessionId,
      sessionTtlMs,
      store,
    });
  }, loginTimeoutMs);
  record.timeoutTimer.unref?.();

  return record.status;
}

export function getOpenAIOAuthCodexLoginStatus(
  sessionId: string,
  deps: OpenAIOAuthCodexLoginDeps = {},
): OpenAIOAuthTokenLoginStatus {
  const record = (deps.loginStore ?? defaultCodexLoginStore).get(sessionId);
  if (!record) {
    return createLoginStatus({
      now: deps.now?.() ?? new Date(),
      reason: 'login_not_found',
      status: 'failed',
    });
  }

  if (record.status.status === 'pending') {
    updateLoginDevice(record, deps.now?.() ?? new Date());
  }

  return record.status;
}
