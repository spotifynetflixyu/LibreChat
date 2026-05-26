export interface OpenAIOAuthResponsesPayload {
  model: string;
  input: string;
}

export interface OpenAIOAuthResponse {
  id: string;
  output_text?: string;
}

export interface OpenAIOAuthProxyDeps {
  baseUrl: string;
  fetchResponses: (
    url: string,
    payload: OpenAIOAuthResponsesPayload,
  ) => Promise<OpenAIOAuthResponse>;
}

export function createOpenAIOAuthProxyClient({ baseUrl, fetchResponses }: OpenAIOAuthProxyDeps) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  return {
    createResponse(payload: OpenAIOAuthResponsesPayload): Promise<OpenAIOAuthResponse> {
      return fetchResponses(`${normalizedBaseUrl}/responses`, payload);
    },
  };
}
