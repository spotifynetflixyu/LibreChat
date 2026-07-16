export type OpenAIOAuthTokenLoaderOptions = {
  authFilePath?: string;
  ensureFresh?: boolean;
  fetch?: typeof fetch;
};

export type OpenAIOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
};

export type OpenAIOAuthTokenLoader = (
  options: OpenAIOAuthTokenLoaderOptions,
) => Promise<OpenAIOAuthTokens>;

type OpenAIOAuthLocalModule = {
  loadAuthTokens: OpenAIOAuthTokenLoader;
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<OpenAIOAuthLocalModule>;

export async function loadOpenAIOAuthTokens(
  options: OpenAIOAuthTokenLoaderOptions,
): Promise<OpenAIOAuthTokens> {
  const local = await dynamicImport('@openai-oauth/local/auth-file');
  return local.loadAuthTokens(options);
}
