import type { CodexAppServerProcessSpawner } from './appserver';

import { startCodexAppServerClient } from './appserver';

function createSpawner(
  onWrite: (message: Record<string, unknown>, emit: (chunk: string) => void) => void,
) {
  const writes: Record<string, unknown>[] = [];
  const close = jest.fn();
  const spawnProcess: CodexAppServerProcessSpawner = jest.fn(({ onStdout }) => ({
    close,
    write: (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      writes.push(message);
      onWrite(message, onStdout);
    },
  }));

  return { close, spawnProcess, writes };
}

describe('Codex app-server client', () => {
  it('initializes JSONL stdio before correlating requests and notifications', async () => {
    const notification = jest.fn();
    const { close, spawnProcess, writes } = createSpawner((message, emit) => {
      if (message.method === 'initialize') {
        const response = `${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`;
        emit(response.slice(0, 8));
        emit(response.slice(8));
      }
      if (message.method === 'account/logout') {
        emit(
          `${JSON.stringify({ method: 'account/updated', params: { authMode: null } })}\n${JSON.stringify({ id: message.id, result: {} })}\n`,
        );
      }
    });

    const client = await startCodexAppServerClient({
      command: '/usr/local/bin/codex',
      cwd: '/srv/codex-home',
      env: { CODEX_HOME: '/srv/codex-home' },
      spawnProcess,
    });
    client.on('account/updated', notification);
    await client.request('account/logout');

    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['app-server', '--stdio'],
        command: '/usr/local/bin/codex',
        cwd: '/srv/codex-home',
      }),
    );
    expect(writes).toEqual([
      {
        id: 1,
        method: 'initialize',
        params: {
          capabilities: null,
          clientInfo: {
            name: 'librechat',
            title: 'LibreChat',
            version: '0.8.7',
          },
        },
      },
      { method: 'initialized' },
      { id: 2, method: 'account/logout' },
    ]);
    expect(notification).toHaveBeenCalledWith({ authMode: null });

    client.close();
    client.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects app-server errors without exposing raw messages or data', async () => {
    const { close, spawnProcess } = createSpawner((message, emit) => {
      if (message.method === 'initialize') {
        emit(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`);
      }
      if (message.method === 'account/logout') {
        emit(
          `${JSON.stringify({
            id: message.id,
            error: {
              code: -32600,
              data: { token: 'token_sensitive' },
              message: '/data/openai-oauth/auth.json refresh_sensitive',
            },
          })}\n`,
        );
      }
    });
    const client = await startCodexAppServerClient({
      command: 'codex',
      cwd: '/srv/codex-home',
      env: {},
      spawnProcess,
    });

    await expect(client.request('account/logout')).rejects.toThrow(
      'Codex app-server request failed',
    );
    await expect(client.request('account/logout')).rejects.not.toThrow(/sensitive|auth\.json/i);
    client.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects pending requests when the process exits', async () => {
    let exit: (() => void) | undefined;
    const close = jest.fn();
    const spawnProcess: CodexAppServerProcessSpawner = jest.fn(({ onExit, onStdout }) => {
      exit = onExit;
      return {
        close,
        write: (line) => {
          const message = JSON.parse(line) as { id?: number; method?: string };
          if (message.method === 'initialize') {
            onStdout(`${JSON.stringify({ id: message.id, result: {} })}\n`);
          }
        },
      };
    });
    const client = await startCodexAppServerClient({
      command: 'codex',
      cwd: '/srv/codex-home',
      env: {},
      spawnProcess,
    });
    const pending = client.request('account/read', { refreshToken: true });

    exit?.();

    await expect(pending).rejects.toThrow('Codex app-server unavailable');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
