import type { OpenAIOAuthFetch } from '~/steel/native/credentials';
import type { OAuthCompactionOptions } from './runtime';
import { inspectResponseStream, readBoundedJSON, readCompactionStream } from './stream';
import { createOAuthCompactionRuntime } from './runtime';

export interface OAuthCompactionFetch extends OpenAIOAuthFetch {
  compactOnly(input: Parameters<OpenAIOAuthFetch>[0], init?: RequestInit): Promise<void>;
}

export interface OAuthCompactionFetchOptions extends OAuthCompactionOptions {
  readonly fetch: OpenAIOAuthFetch;
}

export function createOAuthCompactionFetch({
  fetch,
  ...options
}: OAuthCompactionFetchOptions): OAuthCompactionFetch {
  const runtime = createOAuthCompactionRuntime(fetch, options, {
    compact: readCompactionStream,
    readError: readBoundedJSON,
    inspect: inspectResponseStream,
  });
  return Object.assign(
    (input: Parameters<OpenAIOAuthFetch>[0], init?: RequestInit) => runtime.fetch(input, init),
    { compactOnly: runtime.compactOnly },
  );
}
