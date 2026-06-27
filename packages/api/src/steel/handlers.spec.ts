import { EventEmitter } from 'events';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createSteelHandlers } from './handlers';
import {
  createMongooseSteelConversationHistoryRepository,
  createMongooseSteelWorkingOrderMemoryRollbackRepository,
} from './history/repository';
import { createSteelConversationHistoryService } from './history/service';
import {
  createMongooseSteelOutputSheetMemoryReader,
  createMongooseSteelWorkingOrderMemoryReader,
  createMongooseSteelWorkingOrderMemoryWriter,
} from './memory/service';

import type { Request, Response } from 'express';
import type { SendSteelOAuthChatOptions } from './ai/provider';
import type {
  FullActiveSteelOutputSheets,
  PrepareSteelRuntimeContextInput,
  SteelRuntimeContext,
  SteelRuntimeContextConversationInput,
} from './runtime/context';

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

function createTestOutputSheets(): FullActiveSteelOutputSheets {
  return {
    system_order: {
      sheetId: 'system_order',
      rows: [
        {
          rowId: 'system_order:1',
          cells: {
            rowNo: 1,
            erpItemCode: 'CCG075',
          },
        },
      ],
    },
    customer_data: {
      sheetId: 'customer_data',
      rows: [
        {
          rowId: 'customer_data:1',
          cells: {
            customerTierId: 2,
          },
        },
      ],
    },
    manual_review: {
      sheetId: 'manual_review',
      rows: [],
    },
    customer_quote: {
      sheetId: 'customer_quote',
      rows: [
        {
          rowId: 'customer_quote:1',
          cells: {
            rowNo: 1,
            subtotal: 536,
          },
        },
      ],
    },
  };
}

function createTestRuntimeContext(
  conversation: SteelRuntimeContextConversationInput,
  overrides: {
    attachments?: SteelRuntimeContext['attachments'];
    outputSheets?: Partial<SteelRuntimeContext['outputSheets']>;
  } = {},
): SteelRuntimeContext {
  return {
    conversation,
    rules: {
      agentRules: [
        {
          id: 1,
          slug: 'steel-default-agent-instruction',
          version: 1,
          ruleType: 'agent_instruction_rule',
          title: 'Steel default agent instruction',
          locale: 'zh-TW',
          ruleSections: ['agent_instruction'],
          selectors: { appliesTo: ['steel_quote_runtime'] },
          prompt: 'Fixture agent instruction',
          toolPolicy: { availableTools: ['search_customers'] },
          outputPolicy: null,
          priority: 10,
          confidence: 'high',
          active: true,
          reviewState: 'reviewed',
          sourceRefs: [],
        },
      ],
      steelGlobalRules: {
        instructionPackets: [],
        quoteDefaults: [],
        quoteRules: [
          {
            id: 31,
            ruleType: 'formula_rule',
            scopeType: 'catalog_family',
            catalogFamily: 'plate',
            productFamily: undefined,
            chargeType: undefined,
            formulaCode: undefined,
            selectors: { catalogFamily: 'plate' },
            parameters: {},
            prompt: 'Fixture quote rule',
            priority: 40,
            confidence: 'high',
            active: true,
            reviewState: 'reviewed',
            sourceRefs: [],
          },
        ],
        groupedBy: {
          packetGroups: [],
          catalogFamilies: ['plate'],
          productFamilies: [],
          chargeTypes: [],
          formulaCodes: [],
          quoteRuleTypes: ['formula_rule'],
          quoteDefaultTypes: [],
        },
      },
      outputRules: [],
      otherGlobalRules: {
        fileRules: [],
        sourcePriorityRules: [],
        markdownOutputRules: [],
      },
    },
    outputSheets: {
      activeOnly: true,
      contextMode: 'compact_workbook',
      memoryName: 'Output Sheet Memory',
      contextName: 'Runtime Output Sheet Context',
      conversationId: conversation.conversationId,
      sheetIds: ['system_order', 'customer_data', 'manual_review', 'customer_quote'],
      previousOutputSheets: createTestOutputSheets(),
      derivedIndex: {
        lineItems: [{ rowNo: 1, erpItemCode: 'CCG075' }],
        customers: [{ customerTierId: 2 }],
        adoptedPrices: [],
        calculations: [{ rowNo: 1, subtotal: 536 }],
        ocrExtracts: [],
        unresolvedItems: [],
      },
      compactWorkbook: {
        sheets: {
          system_order: {
            sheetId: 'system_order',
            rowCount: 1,
            rows: [
              {
                rowId: 'system_order:1',
                rowIndex: 1,
                anchors: { rowNo: 1, erpItemCode: 'CCG075' },
              },
            ],
          },
          customer_data: {
            sheetId: 'customer_data',
            rowCount: 1,
            rows: [
              {
                rowId: 'customer_data:1',
                rowIndex: 1,
                anchors: { customerTierId: 2 },
              },
            ],
          },
          manual_review: {
            sheetId: 'manual_review',
            rowCount: 0,
            rows: [],
          },
          customer_quote: {
            sheetId: 'customer_quote',
            rowCount: 1,
            rows: [
              {
                rowId: 'customer_quote:1',
                rowIndex: 1,
                anchors: { rowNo: 1, subtotal: 536 },
              },
            ],
          },
        },
        unresolvedCount: 0,
      },
      ...overrides.outputSheets,
    },
    attachments: overrides.attachments ?? {
      currentTurnFiles: [],
      priorActiveFileEvidence: [],
    },
    toolPolicy: {
      aiVisibleTools: ['search_customers', 'search_price_candidates', 'read_markdown'],
      removedTools: [],
      ocrCorrectionPolicy: 'Do not rerun OCR for user corrections.',
      readMarkdownUsagePolicy: {
        requiresMissingMarkdownInHistory: true,
        forbiddenWhenHistoryHasNeededMarkdown: true,
        allowedScopes: ['workbook', 'ocr'],
        currentConversationScoped: true,
      },
    },
  };
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
      toolName: options.toolName as 'search_customers',
      data: { customers: [{ displayName: '大成鋼鐵', erpCustomerCode: 'A001' }] },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const sendChat = jest.fn(async (options) => {
      options.onReasoningSummary?.('先查客戶，再用文字表格回覆。');
      await options.executeSteelToolCall?.({
        toolName: 'search_customers',
        arguments: { keywords: ['大成'] },
        providerToolCallId: 'call_customer_1',
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
          summary: '先查客戶，再用文字表格回覆。',
        }),
        expect.objectContaining({
          type: 'tool',
          status: 'completed',
          toolName: 'search_customers',
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

  it('persists first-turn OCR confirmation history under the generated conversation id', async () => {
    const ocrConfirmation = [
      '已讀取附件 `PL.pdf`，並完成 OCR / 圖面初步判讀。',
      '',
      '## OCR 結果確認表',
      '',
      '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 |',
      '|---|---|---|---:|',
      '| PL.pdf | D3 | PL15*500 | 6 |',
    ].join('\n');
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: ocrConfirmation,
      unsupportedSettings: [],
      warnings: [],
    }));
    const historyService = {
      appendTurn: jest.fn(async (turn) => ({
        ...turn,
        id: turn.messageId,
        state: 'active' as const,
        revisions: [],
        createdAt: new Date('2026-06-24T00:00:00.000Z'),
        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
      })),
      buildHistoryWindow: jest.fn(async () => []),
    };
    const workingOrderMemoryWriter = {
      captureAssistantFinalMarkdown: jest.fn(async () => ({
        parseStatus: 'skipped' as const,
        savedCounts: {},
      })),
    };
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      historyService,
      sendChat,
      workingOrderMemoryWriter,
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        messages: [
          {
            role: 'user',
            content: 'Read the attached file(s).',
            messageId: 'user-pl-first',
            files: [
              {
                filename: 'PL.pdf',
                mediaType: 'application/pdf',
                dataBase64: Buffer.from('%PDF-1.4\n%%EOF', 'utf8').toString('base64'),
              },
            ],
          },
        ],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    const doneEvent = events.find(
      (event): event is { type: 'done'; response: { conversationId: string } } =>
        (event as { type?: unknown }).type === 'done',
    );
    const generatedConversationId = doneEvent?.response.conversationId;
    expect(generatedConversationId).toEqual(expect.stringMatching(/^steel-chat-/));

    const sendChatOptions = (sendChat.mock.calls as unknown as Array<[SendSteelOAuthChatOptions]>)[0]?.[0];
    expect(sendChatOptions?.conversationId).toBe(generatedConversationId);
    expect(sendChatOptions?.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Read the attached file(s).',
      }),
    ]);
    expect(historyService.appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: generatedConversationId,
        messageId: 'user-pl-first',
        role: 'user',
        content: 'Read the attached file(s).',
        attachments: [
          expect.objectContaining({
            filename: 'PL.pdf',
            mediaType: 'application/pdf',
          }),
        ],
      }),
    );
    expect(historyService.appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: generatedConversationId,
        role: 'assistant',
        source: 'assistant_final',
        content: ocrConfirmation,
      }),
    );
    expect(workingOrderMemoryWriter.captureAssistantFinalMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: generatedConversationId,
        content: ocrConfirmation,
      }),
    );
  });

  it('streams a readable provider error when upstream throws an object placeholder', async () => {
    const providerError = Object.assign(new Error('[object Object]'), {
      cause: { message: 'OpenAI payload rejected after PL.pdf upload' },
    });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat: jest.fn(async () => {
        throw providerError;
      }),
    });
    const req = {
      body: {
        messages: [
          {
            role: 'user',
            content: '請處理 PL.pdf',
            files: [
              {
                filename: 'PL.pdf',
                mediaType: 'application/pdf',
                dataBase64: Buffer.from('%PDF-1.4\n%%EOF', 'utf8').toString('base64'),
              },
            ],
          },
        ],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    const errorEvent = events.find(
      (event): event is { type: 'error'; errorSummary: string } =>
        (event as { type?: unknown }).type === 'error',
    );

    expect(errorEvent?.errorSummary).toContain('OpenAI payload rejected after PL.pdf upload');
    expect(errorEvent?.errorSummary).not.toContain('[object Object]');
    expect(res.end).toHaveBeenCalled();
  });

  it('streams nested provider response detail instead of a generic OAuth wrapper after OCR', async () => {
    const providerError = new Error('OpenAI OAuth provider request failed.', {
      cause: {
        status: 400,
        statusText: 'Bad Request',
        body: JSON.stringify({
          error: {
            message: 'Provider rejected follow-up after PL.pdf OCR table context.',
          },
        }),
      },
    });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat: jest.fn(async () => {
        throw providerError;
      }),
    });
    const req = {
      body: {
        messages: [
          {
            role: 'user',
            content: '請處理 PL.pdf',
            files: [
              {
                filename: 'PL.pdf',
                mediaType: 'application/pdf',
                dataBase64: Buffer.from('%PDF-1.4\n%%EOF', 'utf8').toString('base64'),
              },
            ],
          },
        ],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    const errorEvent = events.find(
      (event): event is { type: 'error'; errorSummary: string } =>
        (event as { type?: unknown }).type === 'error',
    );

    expect(errorEvent?.errorSummary).toBe(
      'Provider rejected follow-up after PL.pdf OCR table context.',
    );
    expect(errorEvent?.errorSummary).not.toBe('OpenAI OAuth provider request failed.');
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

  it('streams provider round progress from the provider callback', async () => {
    const sendChat = jest.fn(async (options) => {
      const roundStatusCallback = (
        options as SendSteelOAuthChatOptions & {
          onProviderRoundStatus?: (event: { message: string }) => void | Promise<void>;
        }
      ).onProviderRoundStatus;
      await roundStatusCallback?.({
        message: 'Provider round 1 generating final response after tool results',
      });

      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: 'final summary',
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
        messages: [{ role: 'user', content: 'stream round progress' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const progressEvents = parseStreamChunks(chunks).filter((event) => {
      return (event as { type?: string }).type === 'progress';
    });
    expect(progressEvents).toContainEqual({
      type: 'progress',
      stage: 'provider_round',
      message: 'Provider round 1 generating final response after tool results',
    });
  });

  it('passes request close abort signal to the streaming provider call', async () => {
    const req = Object.assign(new EventEmitter(), {
      body: {
        messages: [{ role: 'user', content: 'stream abort' }],
      },
    }) as Request & EventEmitter;
    let abortSignal: AbortSignal | undefined;
    const sendChat = jest.fn(async (options) => {
      abortSignal = options.abortSignal;
      expect(abortSignal?.aborted).toBe(false);
      req.emit('close');
      expect(abortSignal?.aborted).toBe(true);
      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: 'aborted after close',
        unsupportedSettings: [],
        warnings: [],
      };
    });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const { res } = createStreamResponse();

    await handlers.streamChat(req, res);

    expect(abortSignal).toBeDefined();
  });

  it('builds same-conversation prompts from active DB history and runtime context instead of browser-local prior messages', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已依資料庫歷史與 runtime context 回覆。',
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
    const prepareRuntimeContext = jest.fn(async (input) =>
      createTestRuntimeContext(input.conversation),
    );
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      historyService,
      prepareRuntimeContext,
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
    expect(prepareRuntimeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({
          conversationId: 'steel_conversation_1',
          activeHistory: [
            { role: 'assistant', content: 'DB persisted final Markdown table' },
            { role: 'user', content: '新增第 3 項 CCG075 兩支' },
          ],
          currentUserTurn: { role: 'user', content: '新增第 3 項 CCG075 兩支' },
        }),
      }),
    );

    const sendChatOptions = (sendChat.mock.calls as unknown as Array<[SendSteelOAuthChatOptions]>)[0]?.[0];
    expect(sendChatOptions).toEqual(
      expect.objectContaining({
        conversationId: 'steel_conversation_1',
        steelRuntimeContext: expect.objectContaining({
          outputSheets: expect.objectContaining({
            previousOutputSheets: expect.objectContaining({
              system_order: expect.objectContaining({
                rows: [expect.objectContaining({ rowId: 'system_order:1' })],
              }),
            }),
          }),
          rules: expect.objectContaining({
            agentRules: [expect.objectContaining({ slug: 'steel-default-agent-instruction' })],
            steelGlobalRules: expect.objectContaining({
              quoteRules: [expect.objectContaining({ catalogFamily: 'plate' })],
            }),
          }),
        }),
        messages: [
          { role: 'assistant', content: 'DB persisted final Markdown table' },
          { role: 'user', content: '新增第 3 項 CCG075 兩支' },
        ],
      }),
    );
    expect(sendChatOptions).not.toHaveProperty('workingMemorySummary');
    expect(JSON.stringify(sendChatOptions?.messages)).not.toContain('browser-local stale table');
  });

  it('reads active Steel conversation messages for browser reload', async () => {
    const createdAt = new Date('2026-06-24T00:00:00.000Z');
    const updatedAt = new Date('2026-06-24T00:00:01.000Z');
    const historyService = {
      appendTurn: jest.fn(),
      buildHistoryWindow: jest.fn(),
      editUserMessage: jest.fn(),
      listActiveTurns: jest.fn(async () => [
        {
          id: 'turn_1',
          conversationId: 'steel-chat-reload',
          messageId: 'user-1',
          turnIndex: 1,
          role: 'user' as const,
          source: 'user_input' as const,
          state: 'active' as const,
          content: '上一輪 PL15*500',
          attachments: [
            {
              fileId: 'file-1',
              filename: 'PL.pdf',
              mediaType: 'application/pdf',
            },
          ],
          revisions: [],
          createdAt,
          updatedAt,
        },
        {
          id: 'turn_2',
          conversationId: 'steel-chat-reload',
          messageId: 'assistant-1',
          turnIndex: 2,
          role: 'assistant' as const,
          source: 'assistant_final' as const,
          state: 'active' as const,
          content: '| 項次 | 型號 |\n| --- | --- |\n| 1 | CCG075 |',
          revisions: [],
          createdAt,
          updatedAt,
        },
      ]),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      historyService,
      sendChat: jest.fn(),
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      params: {
        conversationId: 'steel-chat-reload',
      },
      user: {
        id: 'user_1',
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.readConversationMessages(req, res);

    expect(historyService.listActiveTurns).toHaveBeenCalledWith({
      conversationId: 'steel-chat-reload',
      userId: 'user_1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      conversationId: 'steel-chat-reload',
      messages: [
        {
          messageId: 'user-1',
          role: 'user',
          content: '上一輪 PL15*500',
          attachments: [
            {
              fileId: 'file-1',
              filename: 'PL.pdf',
              mediaType: 'application/pdf',
            },
          ],
          createdAt: '2026-06-24T00:00:00.000Z',
          updatedAt: '2026-06-24T00:00:01.000Z',
        },
        {
          messageId: 'assistant-1',
          role: 'assistant',
          content: '| 項次 | 型號 |\n| --- | --- |\n| 1 | CCG075 |',
          createdAt: '2026-06-24T00:00:00.000Z',
          updatedAt: '2026-06-24T00:00:01.000Z',
        },
      ],
    });
  });

  it('requires an authenticated user before reading Steel reload messages', async () => {
    const historyService = {
      appendTurn: jest.fn(),
      buildHistoryWindow: jest.fn(),
      editUserMessage: jest.fn(),
      listActiveTurns: jest.fn(),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      historyService,
      sendChat: jest.fn(),
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      params: {
        conversationId: 'steel-chat-reload',
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.readConversationMessages(req, res);

    expect(historyService.listActiveTurns).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Steel conversation messages require login',
    });
  });

  it('prepares compact workbook runtime context without passing a runtime mode switch', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const prepareRuntimeContext = jest.fn(async (input) =>
      createTestRuntimeContext(input.conversation),
    );
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      prepareRuntimeContext,
      sendChat,
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        messages: [{ role: 'user', content: '測試 compact mode' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(prepareRuntimeContext).toHaveBeenCalledWith(
      expect.not.objectContaining({
        mode: expect.anything(),
      }),
    );
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
    const workingOrderMemoryWriter = {
      captureAssistantFinalMarkdown: jest.fn(async () => ({
        parseStatus: 'saved' as const,
        savedCounts: { working_order_row: 1 },
      })),
    };
    const handlers = createSteelHandlers({
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

  it('ignores removed non-stream provider tool-status OCR results', async () => {
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
        parseStatus: 'skipped' as const,
        savedCounts: {},
      })),
      captureToolResult: jest.fn(async () => ({
        savedCounts: {},
      })),
    };
    const sendChat = jest.fn(async (options) => {
      await options.onToolStatus?.({
        toolName: 'run_file_ocr',
        status: 'completed',
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
        text: '已 OCR。',
        unsupportedSettings: [],
        warnings: [],
      };
    });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      historyService,
      sendChat,
      workingOrderMemoryWriter,
    } as unknown as Parameters<typeof createSteelHandlers>[0]);
    const req = {
      body: {
        messages: [{ role: 'user', content: 'OCR a.pdf' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(workingOrderMemoryWriter.captureToolResult).not.toHaveBeenCalled();
  });

  it('reconstructs confirmed PL.pdf OCR follow-up from history and stored OCR evidence without runtime gates', async () => {
    await withMongoMemory(async () => {
      const ocrConfirmation = [
        '已讀取附件 `PL.pdf`，並完成 OCR / 圖面初步判讀。',
        '',
        '## OCR 結果確認表',
        '',
        '| 來源檔案 | 編號 | 斷面規格 | 孔數 / 件 | 總孔數 |',
        '|---|---|---|---:|---:|',
        '| PL.pdf | PL1 | PL6*80*1000 | 4 | 8 |',
      ].join('\n');
      const quoteMarkdown = [
        '| 項次 | 型號 | 品名規格 | 數量 |',
        '| --- | --- | --- | ---: |',
        '| 10 | PL6X80X1000 | PL6*80*1000 | 2 |',
      ].join('\n');
      const historyService = createSteelConversationHistoryService({
        historyRepository: createMongooseSteelConversationHistoryRepository(mongoose),
        memoryRepository: createMongooseSteelWorkingOrderMemoryRollbackRepository(mongoose),
        now: () => new Date('2026-06-26T00:00:00.000Z'),
      });
      const createOutputSheetMemoryReader = jest.fn((conversationId: string) =>
        createMongooseSteelOutputSheetMemoryReader(mongoose, conversationId),
      );
      const prepareRuntimeContext = jest.fn(async (input: PrepareSteelRuntimeContextInput) => {
        const outputSheetMemory = await input.dependencies.readOutputSheetMemory(
          input.conversation.conversationId,
        );
        const currentTurnFiles = input.attachments?.currentTurnFiles ?? [];
        const priorActiveFileEvidence = outputSheetMemory.derivedIndex.ocrExtracts;

        return createTestRuntimeContext(input.conversation, {
          attachments: {
            currentTurnFiles,
            priorActiveFileEvidence,
          },
          outputSheets: {
            derivedIndex: outputSheetMemory.derivedIndex,
          },
        });
      });
      const sendChat = jest
        .fn()
        .mockImplementationOnce(async (_options: SendSteelOAuthChatOptions) => {
          return {
            provider: 'openai_oauth_responses' as const,
            model: 'gpt-5.5',
            text: ocrConfirmation,
            unsupportedSettings: [],
            warnings: [],
          };
        })
        .mockImplementationOnce(async () => ({
          provider: 'openai_oauth_responses' as const,
          model: 'gpt-5.5',
          text: quoteMarkdown,
          unsupportedSettings: [],
          warnings: [],
        }));
      const handlers = createSteelHandlers({
        createOutputSheetMemoryReader,
        getModelsConfig: jest.fn(),
        historyService,
        prepareRuntimeContext,
        sendChat,
        workingOrderMemoryWriter: createMongooseSteelWorkingOrderMemoryWriter(mongoose),
      } as unknown as Parameters<typeof createSteelHandlers>[0]);
      const firstReq = {
        body: {
          messages: [
            {
              role: 'user',
              content: '請處理 PL.pdf，先輸出 OCR 表格。',
              messageId: 'user-pl-ocr',
              files: [
                {
                  filename: 'PL.pdf',
                  mediaType: 'application/pdf',
                  dataBase64: Buffer.from('%PDF-1.4\n%%EOF', 'utf8').toString('base64'),
                },
              ],
            },
          ],
        },
      } as Request;
      const firstRes = createResponse();

      await handlers.chat(firstReq, firstRes);

      const firstJson = firstRes.json.mock.calls[0]?.[0] as
        | { conversationId?: string; text?: string }
        | undefined;
      expect(firstJson?.text).toBe(ocrConfirmation);
      expect(firstJson?.conversationId).toEqual(expect.stringMatching(/^steel-chat-/));
      const conversationId = firstJson?.conversationId;
      if (!conversationId) {
        throw new Error('Expected generated Steel conversation id');
      }

      const secondReq = {
        body: {
          conversationId,
          messages: [
            {
              role: 'user',
              content: '確認上一輪 OCR 表格正確，請依 OCR 表單給出報價。',
              messageId: 'user-pl-confirm',
            },
          ],
        },
      } as Request;
      const secondRes = createResponse();

      await handlers.chat(secondReq, secondRes);

      expect(sendChat).toHaveBeenCalledTimes(2);
      const secondOptions = (sendChat.mock.calls as Array<[SendSteelOAuthChatOptions]>)[1]?.[0];
      expect(secondOptions?.model).toBe('gpt-5.5');
      expect(secondOptions?.messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
      ]);
      expect(secondOptions?.messages[1]?.content).toContain('OCR 結果確認表');
      expect(secondOptions?.messages[2]).toEqual(
        expect.objectContaining({
          role: 'user',
          content: '確認上一輪 OCR 表格正確，請依 OCR 表單給出報價。',
        }),
      );
      expect(
        secondOptions?.steelRuntimeContext?.attachments.priorActiveFileEvidence,
      ).toEqual([
        expect.objectContaining({
          kind: 'assistant_ocr_markdown',
          markdown: expect.stringContaining('PL6*80*1000'),
        }),
      ]);
      expect(secondOptions?.steelRuntimeContext?.toolPolicy.aiVisibleTools).toEqual(
        expect.arrayContaining(['search_price_candidates', 'read_markdown']),
      );
      expect(secondOptions?.steelRuntimeContext?.toolPolicy.aiVisibleTools).not.toContain(
        'run_file_ocr',
      );
      const serializedRuntimeContext = JSON.stringify(secondOptions?.steelRuntimeContext);
      expect(serializedRuntimeContext).not.toContain('ocrWorkflow');
      expect(serializedRuntimeContext).not.toContain('policy_blocked');
      expect(secondRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId,
          text: quoteMarkdown,
        }),
      );
    });
  });

  it('does not bind the default stream provider executor to working-order memory reads', async () => {
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
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已使用 runtime context 回覆。',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
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

    const events = parseStreamChunks(chunks);
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'memory_read',
        }),
      ]),
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'memory_loaded',
        }),
      ]),
    );
  });

  it('streams memory save activity after final assistant Markdown is parsed', async () => {
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
      const sendChat = jest.fn(async () => ({
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: finalMarkdown,
        unsupportedSettings: [],
        warnings: [],
      }));
      const handlers = createSteelHandlers({
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
      const reader = createMongooseSteelWorkingOrderMemoryReader(mongoose, conversationId);
      await expect(reader.readWorkingOrderItems({ mode: 'page', pageSize: 10 })).resolves.toEqual(
        expect.objectContaining({
          resultCount: 1,
          workingOrderRows: [
            expect.objectContaining({
              rowNo: 10,
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
      captureToolResult: jest.fn().mockResolvedValueOnce({ savedCounts: { customer_fact: 1 } }),
    };
    const handlers = createSteelHandlers({
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
    expect(workingOrderMemoryWriter.captureToolResult).toHaveBeenCalledTimes(1);
    expect(parseStreamChunks(chunks)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'memory_saved',
          savedCounts: { customer_fact: 1 },
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
    const handlers = createSteelHandlers({
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
    const prepareRuntimeContext = jest.fn(async (input) =>
      createTestRuntimeContext(input.conversation),
    );
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      historyService,
      prepareRuntimeContext,
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
    const sendChatOptions = (sendChat.mock.calls as unknown as Array<[SendSteelOAuthChatOptions]>)[0]?.[0];
    expect(sendChatOptions).toEqual(
      expect.objectContaining({
        messages: [{ role: 'user', content: '改成 3 支' }],
        steelRuntimeContext: expect.objectContaining({
          conversation: expect.objectContaining({
            edit: {
              editMessageId: 'user-message-1',
              supersededAfterTurnIndex: 1,
            },
            activeHistory: [{ role: 'user', content: '改成 3 支' }],
          }),
        }),
      }),
    );
    expect(sendChatOptions).not.toHaveProperty('workingMemorySummary');
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
