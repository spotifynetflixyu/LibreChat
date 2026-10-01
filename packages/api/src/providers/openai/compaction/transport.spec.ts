import type { OpenAIOAuthProbeTransportFactory } from './transport';
import type { OpenAIOAuthFetch } from '~/steel/native/credentials';
import { createOpenAIOAuthProbeClient } from './transport';
import { probeOpenAIOAuthCompaction } from './probe';

describe('OAuth compaction diagnostic transport', () => {
  const auth = { accessToken: 'synthetic-token', accountId: 'synthetic-account' };

  function factory(): OpenAIOAuthProbeTransportFactory {
    return ({ fetch }) => {
      if (!fetch) {
        throw new Error('Fixture requires a fetch implementation');
      }
      return {
        kind: 'openai-compatible',
        baseURL: 'https://openai-oauth.local/v1',
        fetch,
        request: (requestPath, init) => fetch(`https://fixture.invalid${requestPath}`, init),
      };
    };
  }

  it('passes the deadline and merges headers without losing authentication', async () => {
    const captured: { url: string; headers: Headers; signal: AbortSignal | null | undefined }[] =
      [];
    const fetch: OpenAIOAuthFetch = async (input, init) => {
      captured.push({
        url: String(input),
        headers: new Headers(init?.headers),
        signal: init?.signal,
      });
      return new Response('{}');
    };
    const signal = new AbortController().signal;
    const client = createOpenAIOAuthProbeClient({
      auth,
      createTransport: factory(),
      fetch,
      signal,
      responsesLite: true,
    });
    await client.request('/models?client_version=0.144.1');
    await client.request('/responses/compact', {
      headers: { authorization: 'synthetic-token', 'content-type': 'application/json' },
    });
    expect(captured[1].signal).toBe(signal);
    expect(captured[1].headers.get('authorization')).toBe('synthetic-token');
    expect(captured[1].headers.get('originator')).toBe('codex_cli_rs');
    expect(captured[1].headers.get('user-agent')).toBe('codex_cli_rs/0.144.1');
    expect(captured[1].headers.get('x-openai-internal-codex-responses-lite')).toBe('true');
  });

  it('keeps Responses-lite opt-in for diagnostic compact/count requests', async () => {
    const captured: Headers[] = [];
    const fetch: OpenAIOAuthFetch = async (_input, init) => {
      captured.push(new Headers(init?.headers));
      return new Response('{}');
    };
    const client = createOpenAIOAuthProbeClient({
      auth,
      createTransport: factory(),
      fetch,
      signal: new AbortController().signal,
      responsesLite: false,
    });
    await client.request('/responses/input_tokens');
    expect(captured[0].has('x-openai-internal-codex-responses-lite')).toBe(false);
  });

  it('preserves upstream catalog auth failure hidden by the core catalog wrapper', async () => {
    const createTransport: OpenAIOAuthProbeTransportFactory = ({ fetch }) => {
      if (!fetch) {
        throw new Error('Fixture requires a fetch implementation');
      }
      return {
        kind: 'openai-compatible',
        baseURL: 'https://openai-oauth.local/v1',
        fetch,
        request: async () => {
          await fetch('https://fixture.invalid/models?client_version=0.144.1');
          return new Response('hidden upstream payload', { status: 502 });
        },
      };
    };
    const client = createOpenAIOAuthProbeClient({
      auth,
      createTransport,
      fetch: async () => new Response('private error text', { status: 401 }),
      signal: new AbortController().signal,
      responsesLite: false,
    });
    const response = await client.request('/models');
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
  });

  it('uses the installed core transport with only external HTTP replaced', async () => {
    const loadCore = new Function('return import("@openai-oauth/core")') as () => Promise<
      typeof import('@openai-oauth/core')
    >;
    const core = await loadCore();
    const captured: { url: URL; headers: Headers }[] = [];
    const fetch: OpenAIOAuthFetch = async (input, init) => {
      const url = new URL(String(input));
      captured.push({ url, headers: new Headers(init?.headers) });
      if (url.pathname.endsWith('/models')) {
        return Response.json({
          models: [{ slug: 'gpt-6.1-sol', supported_in_api: true, visibility: 'list' }],
        });
      }
      return new Response(null, { status: 404 });
    };
    const client = createOpenAIOAuthProbeClient({
      auth,
      createTransport: (options) =>
        core.createOpenAIOAuthTransport({
          ...options,
          codexVersion: '0.144.1',
        }),
      fetch,
      signal: new AbortController().signal,
      responsesLite: true,
    });
    const catalog = await client.request('/models');
    expect(await catalog.json()).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ id: 'gpt-6.1-sol' })]),
    });
    const compact = await client.request('/responses/compact', { method: 'POST' });
    expect(compact.status).toBe(404);
    const wire = captured[captured.length - 1];
    expect(wire.url.origin).toBe('https://chatgpt.com');
    expect(wire.url.pathname).toBe('/backend-api/codex/responses/compact');
    expect(wire.headers.get('authorization')).toBe('Bearer synthetic-token');
    expect(wire.headers.get('chatgpt-account-id')).toBe('synthetic-account');
    expect(wire.headers.get('originator')).toBe('codex_cli_rs');
    expect(wire.headers.get('x-openai-internal-codex-responses-lite')).toBe('true');
  });

  it('classifies malformed successful catalogs through the installed core as capability failures', async () => {
    const loadCore = new Function('return import("@openai-oauth/core")') as () => Promise<
      typeof import('@openai-oauth/core')
    >;
    const core = await loadCore();
    const signal = new AbortController().signal;
    const client = createOpenAIOAuthProbeClient({
      auth,
      createTransport: (options) =>
        core.createOpenAIOAuthTransport({ ...options, codexVersion: '0.144.1' }),
      fetch: async () => new Response('{', { status: 200 }),
      signal,
      responsesLite: false,
    });
    const result = await probeOpenAIOAuthCompaction({
      client,
      signal,
      model: 'gpt-6.1-sol',
      maxResponseBytes: 1024,
    });
    expect(result).toMatchObject({
      protocolCompatible: false,
      stage: 'catalog',
      code: 'malformed_json',
    });
    expect(result.checks).toHaveLength(1);
  });
});
