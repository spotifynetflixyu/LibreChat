import { createSteelHandlers } from './handlers';

import type { Request, Response } from 'express';

function createResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
}

function createStreamResponse() {
  const chunks: string[] = [];
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    write: jest.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return {
    chunks,
    res: res as unknown as Response & {
      status: jest.Mock;
      setHeader: jest.Mock;
      write: jest.Mock;
      end: jest.Mock;
      json: jest.Mock;
    },
  };
}

function parseStreamChunks(chunks: readonly string[]) {
  return chunks
    .join('')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe('createSteelHandlers', () => {
  it('sends Steel chat through the OAuth provider without workbook patch options', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '| 品名 | 小計 |\n| --- | --- |\n| C100 | 643.2 |',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        authFilePath: undefined,
        maxOutputTokens: undefined,
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        steelRuntimePolicy: true,
      }),
    );
    const sendChatCalls = sendChat.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const sendChatOptions = sendChatCalls[0]?.[0];
    expect(sendChatOptions).toBeDefined();
    expect(sendChatOptions).not.toHaveProperty('workbookPatchTool');
    expect(sendChatOptions).not.toHaveProperty('workbookContextText');
    expect(sendChatOptions).not.toHaveProperty('executeFileOcr');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '| 品名 | 小計 |\n| --- | --- |\n| C100 | 643.2 |',
        unsupportedSettings: [],
        warnings: [],
        conversationId: expect.stringMatching(/^steel-chat-/),
      }),
    );
  });

  it('streams Steel chat progress, business tool status, text, and final response as NDJSON', async () => {
    const executeToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'lookup_quote_rules',
      data: { ruleSummary: 'C type lookup rules' },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const sendChat = jest.fn(async (options) => {
      options.onReasoningSummary?.('先查規則，再用文字表格回覆。');
      await options.executeSteelToolCall?.({
        toolName: 'lookup_quote_rules',
        arguments: { keywords: ['c_type'] },
        providerToolCallId: 'call_lookup_1',
        runState: { maxCalls: 8, callsUsed: 0 },
      });
      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '| 品名 | 小計 |\n| --- | --- |\n| C100 | 643.2 |',
        unsupportedSettings: [],
        warnings: [],
      };
    });
    const handlers = createSteelHandlers({
      executeToolCall,
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'C型鋼 C100 6M 一支多少' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
    const events = parseStreamChunks(chunks);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'progress', stage: 'request_validated' }),
        expect.objectContaining({ type: 'progress', stage: 'provider_request' }),
        expect.objectContaining({
          type: 'reasoning',
          summary: '先查規則，再用文字表格回覆。',
        }),
        expect.objectContaining({
          type: 'lookup',
          status: 'completed',
          toolName: 'lookup_quote_rules',
          ok: true,
        }),
        expect.objectContaining({
          type: 'text',
          delta: '| 品名 | 小計 |\n| --- | --- |\n| C100 | 643.2 |',
        }),
        expect.objectContaining({
          type: 'done',
          response: expect.objectContaining({
            conversationId: expect.stringMatching(/^steel-chat-/),
          }),
        }),
      ]),
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'patch_quote_workbook' }),
        expect.objectContaining({ toolName: 'patch_file_analysis_data' }),
        expect.objectContaining({ type: 'file_analysis_data' }),
      ]),
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('does not expose workbook or file-analysis REST handlers', () => {
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat: jest.fn(),
    });

    expect(handlers).not.toHaveProperty('createWorkbook');
    expect(handlers).not.toHaveProperty('patchWorkbook');
    expect(handlers).not.toHaveProperty('patchFileAnalysisData');
    expect(handlers).not.toHaveProperty('readFileAnalysisDataByConversation');
  });
});
