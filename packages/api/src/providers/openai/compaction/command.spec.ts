import type { OpenAIOAuthCompactionCommandOptions } from './command';
import { runOpenAIOAuthCompactionCommand } from './command';

describe('OAuth compaction diagnostic command', () => {
  const loadTokens = jest.fn(async () => ({
    accessToken: 'private-fixture-token',
    accountId: 'private-fixture-account',
  }));
  const refreshCredentials = jest.fn(async () => ({
    auth: { accessToken: 'private-fixture-token', accountId: 'private-fixture-account' },
    refreshed: true,
  }));

  function options(argv: string[]): OpenAIOAuthCompactionCommandOptions {
    return {
      argv,
      env: {},
      loadTokens,
      refreshCredentials,
      fetch: async () => new Response('{}'),
      createTransport: ({ fetch }) => {
        if (!fetch) {
          throw new Error('Fixture requires fetch');
        }
        return {
          kind: 'openai-compatible',
          baseURL: 'https://fixture.invalid',
          fetch,
          request: async () => Response.json({ data: [] }),
        };
      },
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('shows help without credentials or provider calls', async () => {
    const result = await runOpenAIOAuthCompactionCommand(options(['--help']));
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('no runtime activation');
    expect(loadTokens).not.toHaveBeenCalled();
    expect(refreshCredentials).not.toHaveBeenCalled();
  });

  it.each([
    ['--unknown'],
    ['--model'],
    ['--model', 'bad model'],
    ['--mode', 'unsupported'],
    ['--mode'],
    ['--timeout-ms', '0'],
    ['--timeout-ms', '300001'],
    ['--timeout-ms', '1000', '--timeout-ms', '1000'],
    ['--refresh', '--refresh'],
  ])('rejects invalid arguments before reading credentials: %s', async (...argv: string[]) => {
    const result = await runOpenAIOAuthCompactionCommand(options(argv));
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('invalid_arguments');
    expect(loadTokens).not.toHaveBeenCalled();
  });

  it('reports a catalog rejection without exposing credentials or numeric usage', async () => {
    const result = await runOpenAIOAuthCompactionCommand(options([]));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('"modelListed":false');
    expect(result.output).toContain('"mode":"codex-v2"');
    expect(result.output).not.toContain('private-fixture');
    expect(result.output).not.toContain('input_tokens');
    expect(loadTokens).toHaveBeenCalledWith(expect.objectContaining({ ensureFresh: false }));
    expect(refreshCredentials).not.toHaveBeenCalled();
  });

  it('keeps the standalone diagnostic explicitly selectable', async () => {
    const result = await runOpenAIOAuthCompactionCommand(options(['--mode', 'standalone']));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('"mode":"standalone"');
    expect(result.output).toContain('"modelListed":false');
  });

  it('refreshes only when explicitly requested and forwards the auth-file override', async () => {
    await runOpenAIOAuthCompactionCommand(
      options(['--refresh', '--auth-file', '/fixture/auth.json']),
    );
    expect(loadTokens).not.toHaveBeenCalled();
    expect(refreshCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        authFilePath: '/fixture/auth.json',
        force: true,
      }),
    );
  });

  it('does not expose credential exceptions', async () => {
    loadTokens.mockRejectedValueOnce(new Error('secret=private-fixture-token'));
    const result = await runOpenAIOAuthCompactionCommand(options([]));
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('credential_load_failed');
    expect(result.output).not.toContain('private-fixture-token');
  });
});
