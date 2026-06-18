import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createSteelHandlers } from './handlers';
import {
  createMongooseSteelConversationHistoryRepository,
  createMongooseSteelWorkingOrderMemoryRollbackRepository,
} from './history/repository';
import { createSteelConversationHistoryService } from './history/service';
import {
  createMongooseSteelWorkingOrderMemoryReader,
  createMongooseSteelWorkingOrderMemoryWriter,
} from './memory/service';

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

async function withMongoMemory<T>(run: () => Promise<T>): Promise<T> {
  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  try {
    return await run();
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
    await mongoServer.stop();
  }
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

  it('forwards provider text deltas immediately without duplicating final text', async () => {
    const sendChat = jest.fn(async (options) => {
      options.onTextDelta?.('即時');
      options.onTextDelta?.('串流');
      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '即時串流',
        unsupportedSettings: [],
        warnings: [],
      };
    });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'stream text' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const textEvents = parseStreamChunks(chunks).filter((event) => {
      return (event as { type?: string }).type === 'text';
    });
    expect(textEvents).toEqual([
      { type: 'text', delta: '即時' },
      { type: 'text', delta: '串流' },
    ]);
  });

  it('builds same-conversation prompts from active DB history and Working Order Memory instead of browser-local prior messages', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已依資料庫歷史與工作訂單記憶回覆。',
      unsupportedSettings: [],
      warnings: [],
    }));
    const historyService = {
      appendTurn: jest.fn(async (turn) => ({
        ...turn,
        id: turn.messageId,
        revisions: [],
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        updatedAt: new Date('2026-06-18T00:00:00.000Z'),
      })),
      buildHistoryWindow: jest.fn(async () => [
        {
          id: 'turn_1',
          conversationId: 'steel_conversation_1',
          messageId: 'assistant_db_1',
          turnIndex: 2,
          role: 'assistant' as const,
          source: 'assistant_final' as const,
          state: 'active' as const,
          content: 'DB persisted final Markdown table',
          revisions: [],
          createdAt: new Date('2026-06-18T00:00:00.000Z'),
          updatedAt: new Date('2026-06-18T00:00:00.000Z'),
        },
      ]),
    };
    const memoryReader = {
      readWorkingOrderItems: jest.fn(async () => ({
        mode: 'summary',
        resultCount: 2,
        summary: { customer_fact: 1, working_order_row: 2 },
        workingOrderRows: [],
        memoryEntries: [
          {
            memoryKind: 'customer_fact',
            summary: '龍頂 B tier',
          },
        ],
      })),
    };
    const createWorkingOrderMemoryReader = jest.fn(() => memoryReader);
    const handlers = createSteelHandlers({
      createWorkingOrderMemoryReader,
      getModelsConfig: jest.fn(),
      historyService,
      sendChat,
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        conversationId: 'steel_conversation_1',
        messages: [
          { role: 'assistant', content: 'browser-local stale table' },
          { role: 'user', content: '新增第 3 項 CCG075 兩支' },
        ],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(historyService.buildHistoryWindow).toHaveBeenCalledWith({
      conversationId: 'steel_conversation_1',
      maxTurns: expect.any(Number),
    });
    expect(historyService.appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'steel_conversation_1',
        role: 'user',
        source: 'user_input',
        content: '新增第 3 項 CCG075 兩支',
        turnIndex: 3,
      }),
    );
    expect(createWorkingOrderMemoryReader).toHaveBeenCalledWith('steel_conversation_1');
    expect(memoryReader.readWorkingOrderItems).toHaveBeenCalledWith({ mode: 'summary' });

    const sendChatOptions = sendChat.mock.calls[0]?.[0];
    expect(sendChatOptions).toEqual(
      expect.objectContaining({
        conversationId: 'steel_conversation_1',
        workingMemorySummary: expect.stringContaining('working_order_row'),
        messages: [
          { role: 'assistant', content: 'DB persisted final Markdown table' },
          { role: 'user', content: '新增第 3 項 CCG075 兩支' },
        ],
      }),
    );
    expect(sendChatOptions?.workingMemorySummary).toContain('龍頂');
    expect(JSON.stringify(sendChatOptions?.messages)).not.toContain('browser-local stale table');
  });

  it('auto-captures final assistant Markdown into Working Order Memory after provider completion', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '| 項次 | 型號 | 品名規格 | 數量 |\n| --- | --- | --- | --- |\n| 1 | CCG075 | 錏輕型鋼 | 2 |',
      unsupportedSettings: [],
      warnings: [],
    }));
    const historyService = {
      appendTurn: jest.fn(async (turn) => ({
        ...turn,
        id: turn.messageId,
        revisions: [],
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        updatedAt: new Date('2026-06-18T00:00:00.000Z'),
      })),
      buildHistoryWindow: jest.fn(async () => []),
    };
    const memoryReader = {
      readWorkingOrderItems: jest.fn(async () => ({
        mode: 'summary',
        resultCount: 0,
        summary: {},
        workingOrderRows: [],
      })),
    };
    const workingOrderMemoryWriter = {
      captureAssistantFinalMarkdown: jest.fn(async () => ({
        parseStatus: 'saved' as const,
        savedCounts: { working_order_row: 1 },
      })),
    };
    const handlers = createSteelHandlers({
      createWorkingOrderMemoryReader: jest.fn(() => memoryReader),
      getModelsConfig: jest.fn(),
      historyService,
      sendChat,
      workingOrderMemoryWriter,
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        conversationId: 'steel_conversation_1',
        messages: [{ role: 'user', content: '報 CCG075 兩支' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(workingOrderMemoryWriter.captureAssistantFinalMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'steel_conversation_1',
        checkpointTurnIndex: 1,
        turnIndex: 2,
        content:
          '| 項次 | 型號 | 品名規格 | 數量 |\n| --- | --- | --- | --- |\n| 1 | CCG075 | 錏輕型鋼 | 2 |',
      }),
    );
  });

  it('binds the default stream read_working_order_items executor to the conversation memory reader', async () => {
    const memoryReader = {
      readWorkingOrderItems: jest.fn(async (input) => ({
        mode: input.mode,
        resultCount: input.mode === 'summary' ? 0 : 1,
        summary: input.mode === 'summary' ? {} : undefined,
        workingOrderRows:
          input.mode === 'rowNo'
            ? [
                {
                  rowNo: input.rowNo,
                  erpItemCode: 'CCG075',
                },
              ]
            : [],
      })),
    };
    const createWorkingOrderMemoryReader = jest.fn(() => memoryReader);
    const historyService = {
      appendTurn: jest.fn(async (turn) => ({
        ...turn,
        id: turn.messageId,
        revisions: [],
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        updatedAt: new Date('2026-06-18T00:00:00.000Z'),
      })),
      buildHistoryWindow: jest.fn(async () => []),
    };
    const sendChat = jest.fn(async (options) => {
      const toolResult = await options.executeSteelToolCall?.({
        toolName: 'read_working_order_items',
        arguments: { mode: 'rowNo', rowNo: 12 },
        providerToolCallId: 'call_memory_1',
        runState: { maxCalls: 8, callsUsed: 0 },
      });

      expect(toolResult).toEqual(
        expect.objectContaining({
          ok: true,
          toolName: 'read_working_order_items',
          data: expect.objectContaining({
            workingOrderRows: [expect.objectContaining({ erpItemCode: 'CCG075', rowNo: 12 })],
          }),
        }),
      );

      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已讀取工作訂單記憶。',
        unsupportedSettings: [],
        warnings: [],
      };
    });
    const handlers = createSteelHandlers({
      createWorkingOrderMemoryReader,
      getModelsConfig: jest.fn(),
      historyService,
      sendChat,
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        conversationId: 'steel_conversation_1',
        messages: [{ role: 'user', content: '第 12 項是多少？' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    expect(memoryReader.readWorkingOrderItems).toHaveBeenCalledWith({ mode: 'summary' });
    expect(memoryReader.readWorkingOrderItems).toHaveBeenCalledWith({
      mode: 'rowNo',
      rowNo: 12,
    });
    const events = parseStreamChunks(chunks);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'memory_loaded',
          resultCount: 0,
        }),
        expect.objectContaining({
          type: 'memory_read',
          mode: 'rowNo',
          resultCount: 1,
        }),
        expect.objectContaining({
          type: 'parse_status',
          parseStatus: 'skipped',
        }),
        expect.objectContaining({
          type: 'tool',
          status: 'completed',
          toolName: 'read_working_order_items',
          ok: true,
        }),
      ]),
    );
  });

  it('streams memory save activity after final assistant Markdown is parsed', async () => {
    const memoryReader = {
      readWorkingOrderItems: jest.fn(async () => ({
        mode: 'summary',
        resultCount: 0,
        summary: {},
        workingOrderRows: [],
      })),
    };
    const historyService = {
      appendTurn: jest.fn(async (turn) => ({
        ...turn,
        id: turn.messageId,
        revisions: [],
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        updatedAt: new Date('2026-06-18T00:00:00.000Z'),
      })),
      buildHistoryWindow: jest.fn(async () => []),
    };
    const workingOrderMemoryWriter = {
      captureAssistantFinalMarkdown: jest.fn(async () => ({
        parseStatus: 'saved' as const,
        savedCounts: { working_order_row: 1 },
      })),
    };
    const handlers = createSteelHandlers({
      createWorkingOrderMemoryReader: jest.fn(() => memoryReader),
      getModelsConfig: jest.fn(),
      historyService,
      sendChat: jest.fn(async () => ({
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '| 項次 | 型號 | 品名規格 |\n| --- | --- | --- |\n| 1 | CCG075 | 錏輕型鋼 |',
        unsupportedSettings: [],
        warnings: [],
      })),
      workingOrderMemoryWriter,
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        conversationId: 'steel_conversation_1',
        messages: [{ role: 'user', content: '報價' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    expect(parseStreamChunks(chunks)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'parse_status',
          parseStatus: 'saved',
          savedCounts: { working_order_row: 1 },
        }),
        expect.objectContaining({
          type: 'memory_saved',
          savedCounts: { working_order_row: 1 },
        }),
      ]),
    );
  });

  it('smoke-autosaves final Markdown tables into Mongo-backed Working Order Memory through the stream handler', async () => {
    await withMongoMemory(async () => {
      const conversationId = 'steel_smoke_autosave_1';
      const finalMarkdown = [
        '| 公司編號 | 項次 | 倉庫編號 | 型號 | 品名規格 | 材質編號 | 廠別編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 類別 | 交貨日期 | 備註 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- |',
        '| 01 | 1 | A | DNB70060 | 6.0m/mOT板雷射切割 |  |  | 片 | 2 |  |  | 38.5 | B | F1 | 6 | 700 | 6000 | 切割 |  | handler smoke |',
      ].join('\n');
      const historyService = createSteelConversationHistoryService({
        historyRepository: createMongooseSteelConversationHistoryRepository(mongoose),
        memoryRepository: createMongooseSteelWorkingOrderMemoryRollbackRepository(mongoose),
        now: () => new Date('2026-06-18T00:00:00.000Z'),
      });
      const createWorkingOrderMemoryReader = jest.fn((activeConversationId: string) =>
        createMongooseSteelWorkingOrderMemoryReader(mongoose, activeConversationId),
      );
      const sendChat = jest.fn(async () => ({
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: finalMarkdown,
        unsupportedSettings: [],
        warnings: [],
      }));
      const handlers = createSteelHandlers({
        createWorkingOrderMemoryReader,
        getModelsConfig: jest.fn(),
        historyService,
        sendChat,
        workingOrderMemoryWriter: createMongooseSteelWorkingOrderMemoryWriter(mongoose),
      });
      const req = {
        body: {
          conversationId,
          messages: [
            {
              role: 'user',
              content: '請輸出系統訂單 Markdown table',
              messageId: 'user_smoke_1',
            },
          ],
        },
      } as Request;
      const { chunks, res } = createStreamResponse();

      await handlers.streamChat(req, res);

      const events = parseStreamChunks(chunks);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'parse_status',
            parseStatus: 'saved',
            savedCounts: { working_order_row: 1 },
          }),
          expect.objectContaining({
            type: 'memory_saved',
            savedCounts: { working_order_row: 1 },
          }),
          expect.objectContaining({
            type: 'done',
            response: expect.objectContaining({
              conversationId,
              text: finalMarkdown,
            }),
          }),
        ]),
      );
      expect(createWorkingOrderMemoryReader).toHaveBeenCalledWith(conversationId);

      const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, conversationId);
      await expect(reader.readWorkingOrderItems({ mode: 'page', pageSize: 10 })).resolves.toEqual(
        expect.objectContaining({
          resultCount: 1,
          workingOrderRows: [
            expect.objectContaining({
              rowNo: 1,
              erpItemCode: 'DNB70060',
              productName: '6.0m/mOT板雷射切割',
              quantity: 2,
              unitPrice: 38.5,
            }),
          ],
        }),
      );
    });
  });

  it('captures successful tool and OCR results into Working Order Memory during streaming', async () => {
    const memoryReader = {
      readWorkingOrderItems: jest.fn(async () => ({
        mode: 'summary',
        resultCount: 0,
        summary: {},
        workingOrderRows: [],
      })),
    };
    const historyService = {
      appendTurn: jest.fn(async (turn) => ({
        ...turn,
        id: turn.messageId,
        revisions: [],
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        updatedAt: new Date('2026-06-18T00:00:00.000Z'),
      })),
      buildHistoryWindow: jest.fn(async () => []),
    };
    const executeToolCall = jest.fn(async () => ({
      ok: true as const,
      toolName: 'search_customers' as const,
      data: { customers: [{ displayName: '龍頂' }] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const workingOrderMemoryWriter = {
      captureAssistantFinalMarkdown: jest.fn(async () => ({
        parseStatus: 'skipped' as const,
        savedCounts: {},
      })),
      captureToolResult: jest
        .fn()
        .mockResolvedValueOnce({ savedCounts: { customer_fact: 1 } })
        .mockResolvedValueOnce({ savedCounts: { ocr_extract: 1 } }),
    };
    const handlers = createSteelHandlers({
      createWorkingOrderMemoryReader: jest.fn(() => memoryReader),
      executeToolCall,
      getModelsConfig: jest.fn(),
      historyService,
      sendChat: jest.fn(async (options) => {
        await options.executeSteelToolCall?.({
          toolName: 'search_customers',
          arguments: { keywords: ['龍頂'] },
          providerToolCallId: 'call_customer_1',
          runState: { maxCalls: 8, callsUsed: 0 },
        });
        await options.onToolStatus?.({
          toolName: 'run_file_ocr',
          status: 'completed',
          message: 'run_file_ocr completed',
          result: {
            ok: true,
            toolName: 'run_file_ocr',
            data: { filename: 'a.pdf', pageResults: [{ page: 1, text: 'OCR' }] },
            sourceRefs: [],
            durationMs: 1,
            redactionVersion: 1,
          },
        });
        return {
          provider: 'openai_oauth_responses' as const,
          model: 'gpt-5.5',
          text: '已完成。',
          unsupportedSettings: [],
          warnings: [],
        };
      }),
      workingOrderMemoryWriter,
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        conversationId: 'steel_conversation_1',
        messages: [{ role: 'user', content: '查客戶並 OCR' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    expect(workingOrderMemoryWriter.captureToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'steel_conversation_1',
        providerToolCallId: 'call_customer_1',
        toolName: 'search_customers',
        data: { customers: [{ displayName: '龍頂' }] },
      }),
    );
    expect(workingOrderMemoryWriter.captureToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'steel_conversation_1',
        toolName: 'run_file_ocr',
        data: { filename: 'a.pdf', pageResults: [{ page: 1, text: 'OCR' }] },
      }),
    );
    expect(parseStreamChunks(chunks)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'memory_saved',
          savedCounts: { customer_fact: 1 },
        }),
        expect.objectContaining({
          type: 'memory_saved',
          savedCounts: { ocr_extract: 1 },
        }),
      ]),
    );
  });

  it('persists queued-steer follow-up requests with queued source and emits steer_applied', async () => {
    const historyService = {
      appendTurn: jest.fn(async (turn) => ({
        ...turn,
        id: turn.messageId,
        revisions: [],
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        updatedAt: new Date('2026-06-18T00:00:00.000Z'),
      })),
      buildHistoryWindow: jest.fn(async () => []),
    };
    const memoryReader = {
      readWorkingOrderItems: jest.fn(async () => ({
        mode: 'summary',
        resultCount: 0,
        summary: {},
        workingOrderRows: [],
      })),
    };
    const handlers = createSteelHandlers({
      createWorkingOrderMemoryReader: jest.fn(() => memoryReader),
      getModelsConfig: jest.fn(),
      historyService,
      sendChat: jest.fn(async () => ({
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已套用 queued steer。',
        unsupportedSettings: [],
        warnings: [],
      })),
      workingOrderMemoryWriter: {
        captureAssistantFinalMarkdown: jest.fn(async () => ({
          parseStatus: 'skipped' as const,
          savedCounts: {},
        })),
      },
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        conversationId: 'steel_conversation_1',
        messageSource: 'queued_steer',
        messages: [{ role: 'user', content: '數量改成 3 支' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    expect(historyService.appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'queued_steer',
        queuedSteer: expect.objectContaining({
          targetRequestId: expect.stringMatching(/^steel-chat-/),
          status: 'applied',
        }),
      }),
    );
    expect(parseStreamChunks(chunks)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'steer_applied',
          message: 'Queued steer applied',
        }),
      ]),
    );
  });

  it('reruns an edited user message through history rollback instead of appending a branch', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已用編輯後訊息重跑。',
      unsupportedSettings: [],
      warnings: [],
    }));
    const historyService = {
      appendTurn: jest.fn(async (turn) => ({
        ...turn,
        id: turn.messageId,
        revisions: [],
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        updatedAt: new Date('2026-06-18T00:00:00.000Z'),
      })),
      editUserMessage: jest.fn(async () => ({
        updatedTurn: {
          id: 'user-message-1',
          conversationId: 'steel_conversation_1',
          messageId: 'user-message-1',
          turnIndex: 1,
          role: 'user' as const,
          source: 'user_input' as const,
          state: 'active' as const,
          content: '改成 3 支',
          revisions: [],
          createdAt: new Date('2026-06-18T00:00:00.000Z'),
          updatedAt: new Date('2026-06-18T00:00:00.000Z'),
        },
        supersededTurnCount: 2,
        supersededMemoryCount: 3,
      })),
      buildHistoryWindow: jest.fn(async () => [
        {
          id: 'user-message-1',
          conversationId: 'steel_conversation_1',
          messageId: 'user-message-1',
          turnIndex: 1,
          role: 'user' as const,
          source: 'user_input' as const,
          state: 'active' as const,
          content: '改成 3 支',
          revisions: [],
          createdAt: new Date('2026-06-18T00:00:00.000Z'),
          updatedAt: new Date('2026-06-18T00:00:00.000Z'),
        },
      ]),
    };
    const memoryReader = {
      readWorkingOrderItems: jest.fn(async () => ({
        mode: 'summary',
        resultCount: 0,
        summary: {},
        workingOrderRows: [],
      })),
    };
    const handlers = createSteelHandlers({
      createWorkingOrderMemoryReader: jest.fn(() => memoryReader),
      getModelsConfig: jest.fn(),
      historyService,
      sendChat,
      workingOrderMemoryWriter: {
        captureAssistantFinalMarkdown: jest.fn(async () => ({
          parseStatus: 'skipped' as const,
          savedCounts: {},
        })),
      },
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        conversationId: 'steel_conversation_1',
        editMessageId: 'user-message-1',
        messages: [{ role: 'user', content: '改成 3 支', messageId: 'user-message-1' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(historyService.editUserMessage).toHaveBeenCalledWith({
      conversationId: 'steel_conversation_1',
      messageId: 'user-message-1',
      nextContent: '改成 3 支',
    });
    expect(historyService.appendTurn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: '改成 3 支',
      }),
    );
    expect(sendChat.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        messages: [{ role: 'user', content: '改成 3 支' }],
      }),
    );
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
