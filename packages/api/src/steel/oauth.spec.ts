import { createOpenAIOAuthProxyClient } from './oauth';

describe('OpenAI OAuth proxy seam', () => {
  it('posts Responses payloads through an injectable localhost proxy client', async () => {
    const fetchResponses = jest.fn().mockResolvedValue({
      id: 'resp_1',
      output_text: 'ok',
    });
    const client = createOpenAIOAuthProxyClient({
      baseUrl: 'http://127.0.0.1:10531/v1',
      fetchResponses,
    });

    const response = await client.createResponse({
      model: 'gpt-5.1',
      input: 'quote this',
    });

    expect(fetchResponses).toHaveBeenCalledWith('http://127.0.0.1:10531/v1/responses', {
      model: 'gpt-5.1',
      input: 'quote this',
    });
    expect(response).toEqual({ id: 'resp_1', output_text: 'ok' });
  });
});
