import { spawn } from 'child_process';

export type CodexAppServerProcessSpawner = (input: {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onExit: () => void;
  onStdout: (chunk: string) => void;
}) => {
  close: () => void;
  write: (line: string) => void;
};

type JsonPrimitive = boolean | number | string | null;
export type CodexAppServerJsonValue =
  | CodexAppServerJsonObject
  | JsonPrimitive
  | CodexAppServerJsonValue[];
export type CodexAppServerJsonObject = { [key: string]: CodexAppServerJsonValue };
type NotificationHandler = (params: CodexAppServerJsonObject) => void;

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (value: CodexAppServerJsonValue) => void;
  timeout: NodeJS.Timeout;
};

export type CodexAppServerClient = {
  close(): void;
  on(method: string, handler: NotificationHandler): () => void;
  request<T extends CodexAppServerJsonValue = CodexAppServerJsonObject>(
    method: string,
    params?: CodexAppServerJsonObject,
  ): Promise<T>;
};

export type StartCodexAppServerClientOptions = {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  spawnProcess?: CodexAppServerProcessSpawner;
};

const defaultRequestTimeoutMs = 60_000;
const clientVersion = (process.env.npm_package_version ?? '0.8.7').replace(/^v/u, '');

function isJsonObject(
  value: CodexAppServerJsonValue | undefined,
): value is CodexAppServerJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function spawnDefaultCodexAppServer({
  args,
  command,
  cwd,
  env,
  onExit,
  onStdout,
}: Parameters<CodexAppServerProcessSpawner>[0]): ReturnType<CodexAppServerProcessSpawner> {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  let closed = false;
  let killTimer: NodeJS.Timeout | undefined;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    child.stdin.end();
    if (!child.killed) {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 1_000);
      killTimer.unref?.();
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', onStdout);
  child.once('error', onExit);
  child.once('exit', () => {
    if (killTimer) {
      clearTimeout(killTimer);
    }
    onExit();
  });

  return {
    close,
    write: (line) => {
      if (!closed) {
        child.stdin.write(`${line}\n`);
      }
    },
  };
}

function parseMessage(line: string): CodexAppServerJsonObject | undefined {
  try {
    const parsed = JSON.parse(line) as CodexAppServerJsonValue;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function startCodexAppServerClient({
  command,
  cwd,
  env,
  requestTimeoutMs = defaultRequestTimeoutMs,
  spawnProcess = spawnDefaultCodexAppServer,
}: StartCodexAppServerClientOptions): Promise<CodexAppServerClient> {
  let buffer = '';
  let closed = false;
  let nextRequestId = 1;
  const pending = new Map<number, PendingRequest>();
  const handlers = new Map<string, Set<NotificationHandler>>();
  const failPending = (message: string) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(message));
    }
    pending.clear();
  };
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    failPending('Codex app-server unavailable');
    for (const handler of handlers.get('app-server/closed') ?? []) {
      handler({});
    }
    handlers.clear();
    process.close();
  };
  const handleMessage = (message: CodexAppServerJsonObject) => {
    const id = typeof message.id === 'number' ? message.id : undefined;
    if (id !== undefined) {
      const request = pending.get(id);
      if (!request) {
        return;
      }
      pending.delete(id);
      clearTimeout(request.timeout);
      if (isJsonObject(message.error)) {
        request.reject(new Error('Codex app-server request failed'));
        return;
      }
      request.resolve(message.result ?? null);
      return;
    }

    const method = typeof message.method === 'string' ? message.method : undefined;
    const params = isJsonObject(message.params) ? message.params : {};
    if (!method) {
      return;
    }
    for (const handler of handlers.get(method) ?? []) {
      handler(params);
    }
  };
  const onStdout = (chunk: string) => {
    buffer += chunk;
    let lineEnd = buffer.indexOf('\n');
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (line) {
        const message = parseMessage(line);
        if (!message) {
          close();
          return;
        }
        handleMessage(message);
      }
      lineEnd = buffer.indexOf('\n');
    }
  };

  const process = spawnProcess({
    args: ['app-server', '--stdio'],
    command,
    cwd,
    env,
    onExit: close,
    onStdout,
  });

  const request = <T extends CodexAppServerJsonValue = CodexAppServerJsonObject>(
    method: string,
    params?: CodexAppServerJsonObject,
  ): Promise<T> => {
    if (closed) {
      return Promise.reject(new Error('Codex app-server unavailable'));
    }
    const id = nextRequestId;
    nextRequestId += 1;
    const promise = new Promise<CodexAppServerJsonValue>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Codex app-server request timed out'));
      }, requestTimeoutMs);
      timeout.unref?.();
      pending.set(id, { reject, resolve, timeout });
    });
    process.write(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
    return promise as Promise<T>;
  };
  const client: CodexAppServerClient = {
    close,
    on: (method, handler) => {
      const methodHandlers = handlers.get(method) ?? new Set<NotificationHandler>();
      methodHandlers.add(handler);
      handlers.set(method, methodHandlers);
      return () => {
        methodHandlers.delete(handler);
        if (methodHandlers.size === 0) {
          handlers.delete(method);
        }
      };
    },
    request,
  };

  try {
    await request('initialize', {
      capabilities: null,
      clientInfo: {
        name: 'librechat',
        title: 'LibreChat',
        version: clientVersion,
      },
    });
    process.write(JSON.stringify({ method: 'initialized' }));
    return client;
  } catch {
    close();
    throw new Error('Codex app-server unavailable');
  }
}
