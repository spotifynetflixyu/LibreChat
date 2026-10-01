import type { createOpenAIOAuthTransport } from '@openai-oauth/core';
import type { OpenAIOAuthFetch, OpenAIOAuthTokens } from '~/steel/native/credentials';
import type { OpenAIOAuthProbeClient } from './types';
import { toOpenAIOAuthLibraryFetch } from '~/steel/native/credentials';

export type OpenAIOAuthProbeTransportFactory = typeof createOpenAIOAuthTransport;

export interface OpenAIOAuthProbeTransportOptions {
  auth: OpenAIOAuthTokens;
  createTransport: OpenAIOAuthProbeTransportFactory;
  fetch: OpenAIOAuthFetch;
  responsesLite: boolean;
  signal: AbortSignal;
}

export function createOpenAIOAuthProbeClient({
  auth,
  createTransport,
  fetch,
  responsesLite,
  signal,
}: OpenAIOAuthProbeTransportOptions): OpenAIOAuthProbeClient {
  let clientVersion: string | undefined;
  let catalogStatus: number | undefined;
  const compatibleFetch: OpenAIOAuthFetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (url.pathname.endsWith('/models')) {
      const version = url.searchParams.get('client_version');
      if (version && /^\d+\.\d+\.\d+$/.test(version)) {
        clientVersion = version;
      }
    }
    const responsesPath = /\/responses(?:\/(?:compact|input_tokens))?$/.test(url.pathname);
    if (responsesPath && clientVersion) {
      headers.set('originator', 'codex_cli_rs');
      headers.set('user-agent', `codex_cli_rs/${clientVersion}`);
    }
    if (responsesLite && /\/responses\/(?:compact|input_tokens)$/.test(url.pathname)) {
      headers.set('x-openai-internal-codex-responses-lite', 'true');
    }
    const response = await fetch(input, { ...init, headers, signal: init?.signal ?? signal });
    if (url.pathname.endsWith('/models')) {
      catalogStatus = response.status;
    }
    return response;
  };
  const transport = createTransport({
    auth,
    fetch: toOpenAIOAuthLibraryFetch(compatibleFetch),
    responsesState: false,
  });
  return {
    provider: 'openai_oauth_responses',
    authKind: 'oauth',
    request: async (requestPath, init) => {
      const response = await transport.request(requestPath, init);
      if (
        requestPath.replace(/^\//, '') === 'models' &&
        response.status === 502 &&
        catalogStatus != null
      ) {
        await response.body?.cancel();
        // Core also turns malformed successful catalogs into 502. An empty success
        // lets the probe classify that payload as malformed without retaining it.
        return new Response(null, { status: catalogStatus });
      }
      return response;
    },
  };
}
