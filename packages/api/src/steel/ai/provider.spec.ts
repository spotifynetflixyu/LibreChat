import { sendSteelOAuthChat } from './provider';

import type { createOpenAIOAuth as createOpenAIOAuthType } from 'openai-oauth-provider';
import type { OpenAIOAuthProviderSettings } from 'openai-oauth-provider';
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';

describe('Steel OpenAI OAuth provider adapter', () => {
  it('passes server-side OAuth settings and returns a sanitized provider response', async () => {
    const fetchResponses = jest.fn();
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'steel-provider-mock-ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 5,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 3,
          text: 3,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_mock' },
      warnings: [],
    }));
    const settingsSeen: OpenAIOAuthProviderSettings[] = [];
    const createOpenAIOAuth = jest.fn((settings?: OpenAIOAuthProviderSettings) => {
      settingsSeen.push(settings ?? {});

      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.4',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    const response = await sendSteelOAuthChat({
      authFilePath: '/tmp/steel/auth.json',
      createOpenAIOAuth,
      ensureFresh: false,
      fetch: fetchResponses,
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'Reply exactly: steel-provider-mock-ok' }],
      reasoningEffort: 'medium',
    });

    expect(settingsSeen).toEqual([
      {
        authFilePath: '/tmp/steel/auth.json',
        ensureFresh: false,
        fetch: fetchResponses,
        responsesState: false,
      },
    ]);
    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Reply exactly: steel-provider-mock-ok' }],
          },
        ],
        providerOptions: {
          openai: {
            reasoningEffort: 'medium',
          },
        },
      }),
    );
    expect(response).toEqual({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.4',
      text: 'steel-provider-mock-ok',
      responseId: 'resp_steel_mock',
      usage: {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
      },
      unsupportedSettings: [],
      warnings: [],
    });
    expect(JSON.stringify(response)).not.toMatch(/authFile|authorization|access_token/i);
  });

  it('serializes user file attachments as provider file parts', async () => {
    const fileData = new TextEncoder().encode('TXT_SENTINEL_7F3A 中文 12345');
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'TXT_SENTINEL_7F3A' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 9,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 4,
          text: 4,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_file_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.4',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;
    const abortController = new AbortController();

    await sendSteelOAuthChat({
      abortSignal: abortController.signal,
      createOpenAIOAuth,
      ensureFresh: false,
      passThroughUnsupportedFiles: true,
      model: 'gpt-5.4',
      messages: [
        {
          role: 'user',
          content: 'Read the attached file and return its sentinel.',
          files: [
            {
              filename: 'steel-oauth-smoke.txt',
              mediaType: 'text/plain',
              data: fileData,
            },
          ],
        },
      ],
      reasoningEffort: 'medium',
    });

    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read the attached file and return its sentinel.' },
              {
                type: 'file',
                filename: 'steel-oauth-smoke.txt',
                mediaType: 'text/plain',
                data: fileData,
              },
            ],
          },
        ],
        abortSignal: abortController.signal,
        providerOptions: {
          openai: {
            passThroughUnsupportedFiles: true,
            reasoningEffort: 'medium',
          },
        },
      }),
    );
  });

  it('sets OpenAI image detail to high for image file parts', async () => {
    const imageData = new Uint8Array([137, 80, 78, 71]);
    const doGenerate = jest.fn(async (_options: LanguageModelV3CallOptions) => ({
      content: [{ type: 'text', text: 'PNG_SENTINEL_B7E4' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 12,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 4,
          text: 4,
          reasoning: undefined,
        },
      },
      response: { id: 'resp_steel_image_mock' },
      warnings: [],
    }));
    const createOpenAIOAuth = jest.fn(() => {
      return (() =>
        ({
          specificationVersion: 'v3',
          provider: 'openai.responses',
          modelId: 'gpt-5.4',
          supportedUrls: {},
          doGenerate,
        }) as unknown as LanguageModelV3) as ReturnType<typeof createOpenAIOAuthType>;
    }) as unknown as typeof createOpenAIOAuthType;

    await sendSteelOAuthChat({
      createOpenAIOAuth,
      ensureFresh: false,
      passThroughUnsupportedFiles: true,
      model: 'gpt-5.4',
      messages: [
        {
          role: 'user',
          content: 'Read the attached image and return its sentinel.',
          files: [
            {
              filename: 'steel-oauth-smoke.png',
              mediaType: 'image/png',
              data: imageData,
            },
          ],
        },
      ],
      reasoningEffort: 'medium',
    });

    expect(doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read the attached image and return its sentinel.' },
              {
                type: 'file',
                filename: 'steel-oauth-smoke.png',
                mediaType: 'image/png',
                data: imageData,
                providerOptions: {
                  openai: {
                    imageDetail: 'high',
                  },
                },
              },
            ],
          },
        ],
      }),
    );
  });
});
