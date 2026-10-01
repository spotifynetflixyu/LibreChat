import type { OpenAIOAuthFetch } from '~/steel/native/credentials';
import type { OAuthCompactionOptions } from './runtime';
import { inspectResponseStream, readBoundedJSON, readCompactionStream } from './stream';
import { createOAuthCompactionRuntime } from './runtime';
import Tokenizer from '~/utils/tokenizer';

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
  let counter: ReturnType<typeof Tokenizer.createExactTokenCounter> | undefined;
  const runtime = createOAuthCompactionRuntime(
    fetch,
    options,
    {
      compact: readCompactionStream,
      readError: readBoundedJSON,
      inspect: inspectResponseStream,
    },
    () => (counter ??= Tokenizer.createExactTokenCounter('o200k_base')),
  );
  return Object.assign(
    (input: Parameters<OpenAIOAuthFetch>[0], init?: RequestInit) => runtime.fetch(input, init),
    { compactOnly: runtime.compactOnly },
  );
}
