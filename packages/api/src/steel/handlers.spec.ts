import { createSteelAdminHandlers, createSteelHandlers } from './handlers';
import { readFile } from 'fs/promises';
import path from 'path';
import { logger } from '@librechat/data-schemas';
import { SteelConversationAccessError } from './conversations/service';
import { createSteelWorkbookService } from './workbook/service';
import { createSteelFileAnalysisService } from './vision/analysis';
import { createSteelPostgresPool } from './postgres';
import { executeSteelTool } from './tools/execute';

import type { Request, Response } from 'express';
import type {
  SteelFileAnalysisCreateRecord,
  SteelFileAnalysisRecord,
  SteelFileAnalysisRepository,
} from './vision/analysis';
import type {
  SteelWorkbookCreateRecord,
  SteelWorkbookPatchRecord,
  SteelWorkbookRecord,
  SteelWorkbookRepository,
} from './workbook/service';

class MemorySteelWorkbookRepository implements SteelWorkbookRepository {
  readonly workbooks = new Map<string, SteelWorkbookRecord>();
  readonly patches: SteelWorkbookPatchRecord[] = [];

  async create(record: SteelWorkbookCreateRecord): Promise<SteelWorkbookRecord> {
    this.workbooks.set(record.workbookId, record);
    return record;
  }

  async findByWorkbookId(workbookId: string): Promise<SteelWorkbookRecord | null> {
    return this.workbooks.get(workbookId) ?? null;
  }

  async findByConversationMetaId(conversationMetaId: string): Promise<SteelWorkbookRecord | null> {
    return (
      Array.from(this.workbooks.values()).find(
        (workbook) =>
          workbook.conversationMetaId === conversationMetaId && workbook.status === 'active',
      ) ?? null
    );
  }

  async update(record: SteelWorkbookRecord): Promise<SteelWorkbookRecord> {
    this.workbooks.set(record.workbookId, record);
    return record;
  }

  async createPatch(record: SteelWorkbookPatchRecord): Promise<SteelWorkbookPatchRecord> {
    this.patches.push(record);
    return record;
  }
}

class MemorySteelFileAnalysisRepository implements SteelFileAnalysisRepository {
  readonly records = new Map<string, SteelFileAnalysisRecord>();

  async create(record: SteelFileAnalysisCreateRecord): Promise<SteelFileAnalysisRecord> {
    this.records.set(record.conversationId, record);
    return record;
  }

  async findByConversationId(conversationId: string): Promise<SteelFileAnalysisRecord | null> {
    return this.records.get(conversationId) ?? null;
  }

  async update(record: SteelFileAnalysisRecord): Promise<SteelFileAnalysisRecord> {
    this.records.set(record.conversationId, record);
    return record;
  }
}

function createMemoryWorkbookService(id = 'wb_1') {
  return createSteelWorkbookService({
    repository: new MemorySteelWorkbookRepository(),
    id: () => id,
    now: () => new Date('2026-06-09T00:00:00.000Z'),
  });
}

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

function createBinaryResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & {
    status: jest.Mock;
    setHeader: jest.Mock;
    send: jest.Mock;
    json: jest.Mock;
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
  it('sends authenticated Steel chat through the OAuth provider adapter', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
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
        workbookPatchTool: true,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    });
  });

  it('streams Steel chat progress, lookup/tool status, text, and final response as NDJSON', async () => {
    const executeToolCall = jest.fn(async (options) => ({
      ok: true as const,
      toolName: options.toolName as 'lookup_quote_rules',
      data: { ruleSummary: 'C 型鋼 lookup rules' },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const sendChat = jest.fn(async (options) => {
      options.onReasoningSummary?.('先查 catalog key，再查報價規則。');
      await options.executeSteelToolCall?.({
        toolName: 'lookup_quote_rules',
        arguments: { catalogFamilies: ['c_type'] },
        providerToolCallId: 'call_lookup_1',
        runState: { maxCalls: 8, callsUsed: 0 },
      });
      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '小計：643.2',
        unsupportedSettings: [],
        warnings: [],
        workbookPatch: {
          operations: [
            {
              op: 'set_cell' as const,
              sheetId: 'quote_details' as const,
              rowId: 'line_1',
              columnKey: 'subtotal',
              value: 643.2,
            },
          ],
        },
      };
    });
    const workbookPatch = {
      workbook: { id: 'wb_1', version: 2, sheets: [] },
      changedPaths: [{ sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'subtotal' }],
      changedFieldSummary: [
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'subtotal',
          label: '小計',
          previousValue: null,
          nextValue: 643.2,
        },
      ],
    };
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(async () => ({
        workbook: { id: 'wb_1', version: 1, sheets: [] },
      })),
      patch: jest.fn(async () => workbookPatch),
    };
    const handlers = createSteelHandlers({
      executeToolCall,
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        messages: [{ role: 'user', content: 'C型鋼 C100 6M 一支多少' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'progress', stage: 'request_validated' }),
        expect.objectContaining({
          type: 'reasoning',
          summary: '先查 catalog key，再查報價規則。',
        }),
        expect.objectContaining({
          type: 'lookup',
          status: 'started',
          toolName: 'lookup_quote_rules',
        }),
        expect.objectContaining({
          type: 'lookup',
          status: 'completed',
          toolName: 'lookup_quote_rules',
          ok: true,
        }),
        expect.objectContaining({
          type: 'tool',
          status: 'completed',
          toolName: 'patch_quote_workbook',
          ok: true,
        }),
        expect.objectContaining({ type: 'text', delta: '小計：643.2' }),
        expect.objectContaining({
          type: 'done',
          response: expect.objectContaining({
            text: '小計：643.2',
            workbookPatch,
          }),
        }),
      ]),
    );
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'lookup_quote_rules',
      }),
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('streams run_file_ocr lifecycle events during visual evidence OCR', async () => {
    const executeFileOcr = jest.fn(async () => ({
      ok: true as const,
      toolName: 'run_file_ocr' as const,
      data: {
        filename: 'd.pdf',
        page: 1,
        text: 'OCR_SENTINEL',
      },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const sendChat = jest.fn(async (options) => {
      await options.executeFileOcr?.({
        arguments: {
          filename: 'd.pdf',
          page: 1,
          file_type: 'pdf',
          output_mode: 'detailed',
          dpi: 400,
        },
        files: [
          {
            filename: 'd.pdf',
            mediaType: 'application/pdf',
            data: new Uint8Array(Buffer.from('PDF_SENTINEL', 'utf8')),
          },
        ],
        providerToolCallId: 'call_ocr_1',
      });

      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已完成 d.pdf page 1 OCR。',
        unsupportedSettings: [],
        warnings: [],
      };
    });
    const handlers = createSteelHandlers({
      executeFileOcr,
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService: createMemoryWorkbookService(),
    });
    const req = {
      body: {
        conversationId: 'conversation_ocr_stream',
        messages: [
          {
            role: 'user',
            content: 'OCR d.pdf',
            files: [
              {
                filename: 'd.pdf',
                mediaType: 'application/pdf',
                dataBase64: Buffer.from('PDF_SENTINEL', 'utf8').toString('base64'),
              },
            ],
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
          type: 'tool',
          status: 'started',
          toolName: 'run_file_ocr',
          message: 'run_file_ocr started',
        }),
        expect.objectContaining({
          type: 'tool',
          status: 'completed',
          toolName: 'run_file_ocr',
          message: 'run_file_ocr completed',
          ok: true,
        }),
      ]),
    );
    expect(executeFileOcr).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: expect.objectContaining({
          filename: 'd.pdf',
          page: 1,
        }),
      }),
    );
  });

  it('persists file analysis patch proposals and returns the updated workspace', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已建立圖文判讀表格。',
      unsupportedSettings: [],
      warnings: [],
      fileAnalysisPatch: {
        sourceFiles: [
          {
            fileId: 'file_c_png',
            filename: 'c.png',
            mediaType: 'image/png',
            pageCount: 1,
          },
        ],
        patches: [
          {
            sheetId: 'file_analysis_data' as const,
            upsertColumns: [
              { key: 'part_no', label: '件號', valueType: 'text' as const },
              { key: 'spec', label: '規格', valueType: 'text' as const },
            ],
            upsertRows: [
              {
                id: 'row_pl1',
                sourceRef: {
                  fileId: 'file_c_png',
                  filename: 'c.png',
                  mediaType: 'image/png',
                  page: 1,
                },
                cells: { part_no: 'PL1', spec: '367×323×12t' },
                confidence: 'medium' as const,
                reviewStatus: 'pending_review' as const,
              },
            ],
          },
        ],
        summary: '新增 c.png 圖面判讀資料。',
      },
    }));
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService: createMemoryWorkbookService(),
      fileAnalysisService,
    });
    const req = {
      body: {
        conversationId: 'conversation_1',
        workbookId: 'wb_1',
        selectedWorkbookRefs: [],
        messages: [{ role: 'user', content: 'Read c.png' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(repository.records.get('conversation_1')?.sourceFiles).toEqual([
      {
        fileId: 'file_c_png',
        filename: 'c.png',
        mediaType: 'image/png',
        pageCount: 1,
      },
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '已建立圖文判讀表格。',
        fileAnalysisData: expect.objectContaining({
          id: 'fad_1',
          conversationId: 'conversation_1',
          version: 1,
          sheets: expect.objectContaining({
            file_analysis_data: expect.objectContaining({
              rows: [
                expect.objectContaining({
                  id: 'row_pl1',
                  cells: expect.objectContaining({
                    part_no: 'PL1',
                    source_filename: 'c.png',
                    source_page: 'page 1',
                    spec: '367×323×12t',
                  }),
                }),
              ],
            }),
          }),
        }),
      }),
    );
  });

  it('streams file analysis patch persistence status before the final response', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已建立圖文判讀表格。',
      unsupportedSettings: [],
      warnings: [],
      fileAnalysisPatch: {
        sourceFiles: [
          {
            fileId: 'file_c_png',
            filename: 'c.png',
            mediaType: 'image/png',
          },
        ],
        patches: [
          {
            sheetId: 'manual_review' as const,
            upsertColumns: [{ key: 'item', label: '項目', valueType: 'text' as const }],
            upsertRows: [
              {
                id: 'review_1',
                sourceRef: {
                  fileId: 'file_c_png',
                  filename: 'c.png',
                  mediaType: 'image/png',
                  page: 1,
                },
                cells: { item: '孔洞數需人工確認' },
              },
            ],
          },
        ],
      },
    }));
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService: createMemoryWorkbookService(),
      fileAnalysisService,
    });
    const req = {
      body: {
        conversationId: 'conversation_1',
        messages: [{ role: 'user', content: 'Read c.png' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          status: 'started',
          toolName: 'patch_file_analysis_data',
        }),
        expect.objectContaining({
          type: 'tool',
          status: 'completed',
          toolName: 'patch_file_analysis_data',
          ok: true,
        }),
        expect.objectContaining({
          type: 'done',
          response: expect.objectContaining({
            fileAnalysisData: expect.objectContaining({
              id: 'fad_1',
              conversationId: 'conversation_1',
              sheets: expect.objectContaining({
                manual_review: expect.objectContaining({
                  rows: [
                    expect.objectContaining({
                      id: 'review_1',
                      cells: { item: '孔洞數需人工確認' },
                    }),
                  ],
                }),
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it('lazily creates one backend workspace for file analysis patches without frontend ids', async () => {
    const fileAnalysisRepository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository: fileAnalysisRepository,
      id: () => 'fad_lazy_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const workbookRepository = new MemorySteelWorkbookRepository();
    const workbookService = createSteelWorkbookService({
      repository: workbookRepository,
      id: () => 'wb_lazy_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const sendChat = jest.fn(async (options) => {
      expect(options.workbookPatchTool).toBe(true);
      expect(options.workbookContextText).toContain('sheet id="quote_details"');

      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已建立 d.pdf 圖文判讀表格。',
        unsupportedSettings: [],
        warnings: [],
        fileAnalysisPatch: {
          sourceFiles: [
            {
              fileId: 'file_d_pdf',
              filename: 'd.pdf',
              mediaType: 'application/pdf',
              pageCount: 2,
            },
          ],
          patches: [
            {
              sheetId: 'file_analysis_data' as const,
              upsertColumns: [{ key: 'part_no', label: '件號', valueType: 'text' as const }],
              upsertRows: [
                {
                  id: 'row_pl1',
                  sourceRef: {
                    fileId: 'file_d_pdf',
                    filename: 'd.pdf',
                    mediaType: 'application/pdf',
                    page: 1,
                  },
                  cells: { part_no: 'PL1' },
                },
              ],
            },
          ],
        },
      };
    });
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
      fileAnalysisService,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'OCR d.pdf' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    const doneEvent = events.find((event) => event.type === 'done');
    const response = doneEvent?.response;
    const conversationId = response?.fileAnalysisData?.conversationId;
    expect(conversationId).toEqual(expect.stringMatching(/^steel-chat-/));
    expect(response).toEqual(
      expect.objectContaining({
        conversationId,
        workbookId: 'wb_lazy_1',
        fileAnalysisData: expect.objectContaining({
          id: 'fad_lazy_1',
          conversationId,
        }),
      }),
    );
    expect(workbookRepository.workbooks.get('wb_lazy_1')?.conversationMetaId).toBe(conversationId);
    expect(fileAnalysisRepository.records.get(conversationId)?.conversationId).toBe(conversationId);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          status: 'completed',
          toolName: 'patch_file_analysis_data',
          ok: true,
        }),
      ]),
    );
  });

  it('resolves workbook patches from conversation id without frontend workbook ids', async () => {
    const workbookRepository = new MemorySteelWorkbookRepository();
    const workbookService = createSteelWorkbookService({
      repository: workbookRepository,
      id: () => 'wb_conversation_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    await workbookService.create({ conversationMetaId: 'conversation_1' });
    const sendChat = jest.fn(async (options) => {
      expect(options.workbookPatchTool).toBe(true);
      expect(options.workbookContextText).toContain('sheet id="quote_details"');

      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已更新 workbook。',
        unsupportedSettings: [],
        warnings: [],
        workbookPatch: {
          operations: [
            {
              op: 'set_cell' as const,
              sheetId: 'quote_details' as const,
              rowId: 'line_1',
              columnKey: 'material_unit_price',
              value: 115,
            },
          ],
        },
      };
    });
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: {
        conversationId: 'conversation_1',
        messages: [{ role: 'user', content: '把 line 1 材料單價改成 115' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'done',
          response: expect.objectContaining({
            conversationId: 'conversation_1',
            workbookId: 'wb_conversation_1',
            workbookPatch: expect.objectContaining({
              workbook: expect.objectContaining({
                id: 'wb_conversation_1',
              }),
            }),
          }),
        }),
      ]),
    );
    expect(workbookRepository.workbooks.get('wb_conversation_1')?.version).toBe(1);
  });

  it('streams provider-side file analysis patch acknowledgement before persistence', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const sendChat = jest.fn(async (options) => {
      options.onToolStatus?.({
        toolName: 'patch_file_analysis_data',
        status: 'started',
        message: 'patch_file_analysis_data waiting for AI to convert OCR result',
      });
      options.onToolStatus?.({
        toolName: 'patch_file_analysis_data',
        status: 'completed',
        message: 'patch_file_analysis_data received; preparing summary',
      });

      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已建立圖文判讀表格。',
        unsupportedSettings: [],
        warnings: [],
        fileAnalysisPatch: {
          sourceFiles: [
            {
              fileId: 'file_c_png',
              filename: 'c.png',
              mediaType: 'image/png',
            },
          ],
          patches: [
            {
              sheetId: 'manual_review' as const,
              upsertColumns: [{ key: 'item', label: '項目', valueType: 'text' as const }],
              upsertRows: [
                {
                  id: 'review_1',
                  sourceRef: {
                    fileId: 'file_c_png',
                    filename: 'c.png',
                    mediaType: 'image/png',
                    page: 1,
                  },
                  cells: { item: '孔洞數需人工確認' },
                },
              ],
            },
          ],
        },
      };
    });
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService: createMemoryWorkbookService(),
      fileAnalysisService,
    });
    const req = {
      body: {
        conversationId: 'conversation_1',
        messages: [{ role: 'user', content: 'Read c.png' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    const providerWaitingIndex = events.findIndex(
      (event) =>
        event.type === 'tool' &&
        event.toolName === 'patch_file_analysis_data' &&
        event.message === 'patch_file_analysis_data waiting for AI to convert OCR result',
    );
    const providerAckIndex = events.findIndex(
      (event) =>
        event.type === 'tool' &&
        event.toolName === 'patch_file_analysis_data' &&
        event.message === 'patch_file_analysis_data received; preparing summary',
    );
    const persistenceStartIndex = events.findIndex(
      (event) =>
        event.type === 'tool' &&
        event.toolName === 'patch_file_analysis_data' &&
        event.message === 'patch_file_analysis_data started',
    );
    expect(providerWaitingIndex).toBeGreaterThan(-1);
    expect(providerAckIndex).toBeGreaterThan(-1);
    expect(providerAckIndex).toBeGreaterThan(providerWaitingIndex);
    expect(persistenceStartIndex).toBeGreaterThan(providerAckIndex);
  });

  it('streams persisted file analysis data before continuing to the next OCR page', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const executeFileOcr = jest.fn(async () => ({
      ok: true as const,
      toolName: 'run_file_ocr' as const,
      data: {
        filename: 'd.pdf',
        page: 2,
        text: 'PAGE_2_OCR_SENTINEL',
      },
      sourceRefs: [],
      durationMs: 1,
      redactionVersion: 1 as const,
    }));
    const pageOnePatch = {
      sourceFiles: [
        {
          fileId: 'file_d_pdf',
          filename: 'd.pdf',
          mediaType: 'application/pdf',
          pageCount: 2,
        },
      ],
      patches: [
        {
          sheetId: 'file_analysis_data' as const,
          upsertColumns: [{ key: 'part_no', label: '件號', valueType: 'text' as const }],
          upsertRows: [
            {
              id: 'row_page_1',
              sourceRef: {
                fileId: 'file_d_pdf',
                filename: 'd.pdf',
                mediaType: 'application/pdf',
                page: 1,
                pageCount: 2,
                sourceKey: 'd.pdf:p1:row_page_1',
                ocrEngine: 'PaddleOCR MCP',
                ocrStatus: 'completed' as const,
                ocrProgress: { current: 1, total: 2 },
              },
              cells: { part_no: 'PL1' },
            },
          ],
        },
      ],
      summary: 'd.pdf page 1 PaddleOCR completed.',
    };
    const sendChat = jest.fn(async (options) => {
      await options.onToolStatus?.({
        toolName: 'patch_file_analysis_data',
        status: 'completed',
        message: 'patch_file_analysis_data received; preparing OCR continuation',
        fileAnalysisPatch: pageOnePatch,
      });
      await options.executeFileOcr?.({
        arguments: {
          filename: 'd.pdf',
          page: 2,
          file_type: 'pdf',
          output_mode: 'detailed',
          dpi: 400,
        },
        files: [
          {
            filename: 'd.pdf',
            mediaType: 'application/pdf',
            data: new Uint8Array(Buffer.from('PDF_SENTINEL', 'utf8')),
            pageCount: 2,
          },
        ],
        providerToolCallId: 'call_ocr_page_2',
      });

      return {
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已完成 d.pdf 第 1 頁 OCR，繼續第 2 頁。',
        unsupportedSettings: [],
        warnings: [],
      };
    });
    const handlers = createSteelHandlers({
      executeFileOcr,
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService: createMemoryWorkbookService('wb_1'),
      fileAnalysisService,
    });
    const req = {
      body: {
        conversationId: 'conversation_1',
        messages: [{ role: 'user', content: 'OCR d.pdf' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    const fileAnalysisDataIndex = events.findIndex((event) => event.type === 'file_analysis_data');
    const nextOcrStartedIndex = events.findIndex(
      (event) =>
        event.type === 'tool' &&
        event.toolName === 'run_file_ocr' &&
        event.message === 'run_file_ocr started',
    );
    expect(fileAnalysisDataIndex).toBeGreaterThan(-1);
    expect(nextOcrStartedIndex).toBeGreaterThan(fileAnalysisDataIndex);
    expect(events[fileAnalysisDataIndex]).toEqual(
      expect.objectContaining({
        type: 'file_analysis_data',
        fileAnalysisData: expect.objectContaining({
          id: 'fad_1',
          conversationId: 'conversation_1',
          sheets: expect.objectContaining({
            file_analysis_data: expect.objectContaining({
              rows: [
                expect.objectContaining({
                  id: 'row_page_1',
                  cells: expect.objectContaining({
                    part_no: 'PL1',
                    source_filename: 'd.pdf',
                    source_page: 'page 1',
                  }),
                }),
              ],
            }),
          }),
        }),
      }),
    );
    expect(repository.records.get('conversation_1')?.sheets.file_analysis_data.rows).toHaveLength(
      1,
    );
  });

  it('patches file_analysis_data manually through the conversation-scoped handler endpoint', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      fileAnalysisService,
    });
    const req = {
      params: { conversationId: 'conversation_1' },
      body: {
        sourceFiles: [{ fileId: 'file_c_png', filename: 'c.png', mediaType: 'image/png' }],
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertColumns: [{ key: 'part_no', label: '件號', valueType: 'text' }],
            upsertRows: [
              {
                id: 'row_pl1',
                sourceRef: {
                  fileId: 'file_c_png',
                  filename: 'c.png',
                  mediaType: 'image/png',
                  page: 1,
                },
                cells: { part_no: 'PL7' },
              },
            ],
          },
        ],
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.patchFileAnalysisDataByConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      fileAnalysisData: expect.objectContaining({
        id: 'fad_1',
        conversationId: 'conversation_1',
        sheets: expect.objectContaining({
          file_analysis_data: expect.objectContaining({
            rows: [
              expect.objectContaining({
                id: 'row_pl1',
                cells: { part_no: 'PL7' },
              }),
            ],
          }),
        }),
      }),
    });
  });

  it('rejects old id-based manual file_analysis_data patch routes', async () => {
    const fileAnalysisService = {
      patch: jest.fn(),
      readByConversationId: jest.fn(),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      fileAnalysisService,
    });
    const req = {
      params: { fileAnalysisDataId: 'fad_1' },
      body: {
        conversationId: 'conversation_1',
        sourceFiles: [],
        patches: [],
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.patchFileAnalysisData(req, res);

    expect(fileAnalysisService.patch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Steel file_analysis_data id-based patch routes are disabled',
      errorCategory: 'steel_file_analysis_patch_route_disabled',
    });
  });

  it('reads persisted file_analysis_data by conversation id for reopened Steel chats', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    await fileAnalysisService.patch({
      conversationId: 'conversation_1',
      patch: {
        sourceFiles: [
          {
            fileId: 'file_d_pdf',
            filename: 'd.pdf',
            mediaType: 'application/pdf',
            pageCount: 2,
          },
        ],
        patches: [
          {
            sheetId: 'file_analysis_data' as const,
            upsertColumns: [{ key: 'part_no', label: '件號', valueType: 'text' as const }],
            upsertRows: [
              {
                id: 'row_page_1',
                sourceRef: {
                  fileId: 'file_d_pdf',
                  filename: 'd.pdf',
                  mediaType: 'application/pdf',
                  page: 1,
                },
                cells: { part_no: 'PL1' },
              },
            ],
          },
        ],
      },
    });
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      fileAnalysisService,
    });
    const req = {
      params: { conversationId: 'conversation_1' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.readFileAnalysisDataByConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      fileAnalysisData: expect.objectContaining({
        id: 'fad_1',
        conversationId: 'conversation_1',
        sheets: expect.objectContaining({
          file_analysis_data: expect.objectContaining({
            rows: [
              expect.objectContaining({
                id: 'row_page_1',
                cells: { part_no: 'PL1' },
              }),
            ],
          }),
        }),
      }),
    });
  });

  it('reads persisted workbook by conversation id for reopened Steel chats', async () => {
    const workbookRepository = new MemorySteelWorkbookRepository();
    const workbookService = createSteelWorkbookService({
      repository: workbookRepository,
      id: () => 'wb_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const created = await workbookService.create({
      conversationMetaId: 'conversation_1',
    });
    await workbookService.patch({
      workbookId: created.workbook.id,
      workbookVersion: created.workbook.version,
      selectedWorkbookRefs: [],
      operations: [
        {
          op: 'set_cell',
          sheetId: 'quote_details',
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          value: 115,
        },
      ],
    });
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      params: { conversationId: 'conversation_1' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.readWorkbookByConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      workbook: expect.objectContaining({
        id: 'wb_1',
        version: 1,
        sheets: expect.arrayContaining([
          expect.objectContaining({
            id: 'quote_details',
            rows: expect.arrayContaining([
              expect.objectContaining({
                id: 'line_1',
                cells: expect.objectContaining({ material_unit_price: 115 }),
              }),
            ]),
          }),
        ]),
      }),
    });
  });

  it('injects the latest saved file_analysis_data into the next provider request', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    await fileAnalysisService.patch({
      conversationId: 'conversation_1',
      patch: {
        sourceFiles: [{ fileId: 'file_c_png', filename: 'c.png', mediaType: 'image/png' }],
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertColumns: [{ key: 'part_no', label: '件號', valueType: 'text' }],
            upsertRows: [
              {
                id: 'row_pl1',
                sourceRef: {
                  fileId: 'file_c_png',
                  filename: 'c.png',
                  mediaType: 'image/png',
                  page: 1,
                },
                cells: { part_no: 'USER_CORRECTED_PL7' },
              },
            ],
          },
        ],
      },
    });
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService: createMemoryWorkbookService(),
      fileAnalysisService,
    });
    const req = {
      body: {
        conversationId: 'conversation_1',
        messages: [{ role: 'user', content: '用最新表格繼續判讀' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('USER_CORRECTED_PL7'),
          }),
        ]),
      }),
    );
  });

  it('smokes image OCR patch, manual correction, and next-turn file_analysis_data context', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const sendChat = jest
      .fn()
      .mockResolvedValueOnce({
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已用 OCR 建立 c.png 圖文判讀表格。',
        unsupportedSettings: [],
        warnings: [],
        fileAnalysisPatch: {
          sourceFiles: [
            {
              fileId: 'file_c_png',
              filename: 'c.png',
              mediaType: 'image/png',
              pageCount: 1,
            },
          ],
          patches: [
            {
              sheetId: 'file_analysis_data' as const,
              upsertColumns: [
                { key: 'part_no', label: '件號', valueType: 'text' as const },
                { key: 'spec', label: '規格', valueType: 'text' as const },
              ],
              upsertRows: [
                {
                  id: 'row_pl1',
                  sourceRef: {
                    fileId: 'file_c_png',
                    filename: 'c.png',
                    mediaType: 'image/png',
                    page: 1,
                  },
                  cells: { part_no: 'PL1', spec: '367×323×12t' },
                },
              ],
            },
          ],
          summary: 'OCR 初判 c.png。',
        },
      })
      .mockResolvedValueOnce({
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已依照修正後資料繼續判讀。',
        unsupportedSettings: [],
        warnings: [],
      });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService: createMemoryWorkbookService(),
      fileAnalysisService,
    });
    const firstReq = {
      body: {
        conversationId: 'conversation_1',
        workbookId: 'wb_1',
        messages: [
          {
            role: 'user',
            content: 'OCR 判讀 c.png',
            files: [
              {
                filename: 'c.png',
                mediaType: 'image/png',
                dataBase64: Buffer.from('PNG_SENTINEL_FOR_OCR', 'utf8').toString('base64'),
              },
            ],
          },
        ],
      },
    } as Request;
    const firstRes = createResponse();

    await handlers.chat(firstReq, firstRes);

    expect(firstRes.status).toHaveBeenCalledWith(200);
    expect(firstRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        fileAnalysisData: expect.objectContaining({
          version: 1,
          sheets: expect.objectContaining({
            file_analysis_data: expect.objectContaining({
              rows: [
                expect.objectContaining({
                  cells: { part_no: 'PL1', spec: '367×323×12t' },
                }),
              ],
            }),
          }),
        }),
      }),
    );

    const manualPatchReq = {
      params: { conversationId: 'conversation_1' },
      body: {
        sourceFiles: [
          {
            fileId: 'file_c_png',
            filename: 'c.png',
            mediaType: 'image/png',
            pageCount: 1,
          },
        ],
        patches: [
          {
            sheetId: 'file_analysis_data',
            upsertColumns: [
              { key: 'part_no', label: '件號', valueType: 'text' },
              { key: 'spec', label: '規格', valueType: 'text' },
            ],
            upsertRows: [
              {
                id: 'row_pl1',
                sourceRef: {
                  fileId: 'file_c_png',
                  filename: 'c.png',
                  mediaType: 'image/png',
                  page: 1,
                },
                cells: { part_no: 'PL7', spec: '367×323×12t' },
              },
            ],
          },
        ],
      },
    } as unknown as Request;
    const manualPatchRes = createResponse();

    await handlers.patchFileAnalysisDataByConversation(manualPatchReq, manualPatchRes);

    expect(manualPatchRes.status).toHaveBeenCalledWith(200);
    expect(manualPatchRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        fileAnalysisData: expect.objectContaining({
          version: 2,
        }),
      }),
    );

    const secondReq = {
      body: {
        conversationId: 'conversation_1',
        workbookId: 'wb_1',
        messages: [{ role: 'user', content: '用修正後資料繼續判讀' }],
      },
    } as Request;
    const secondRes = createResponse();

    await handlers.chat(secondReq, secondRes);

    const secondSendChatOptions = sendChat.mock.calls[1]?.[0];
    expect(secondSendChatOptions.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Latest saved file_analysis_data workspace'),
        }),
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('PL7'),
        }),
      ]),
    );
    expect(JSON.stringify(secondSendChatOptions.messages)).not.toContain('"part_no":"PL1"');
    expect(secondRes.status).toHaveBeenCalledWith(200);
  });

  it('smokes d.pdf upload interruption and go resume through file_analysis_data context', async () => {
    const repository = new MemorySteelFileAnalysisRepository();
    const fileAnalysisService = createSteelFileAnalysisService({
      repository,
      id: () => 'fad_1',
      now: () => new Date('2026-06-12T00:00:00.000Z'),
    });
    const dPdf = await readFile(path.join(__dirname, '../../../../docs/reference/example/d.pdf'));
    const sendChat = jest
      .fn()
      .mockResolvedValueOnce({
        provider: 'openai_oauth_responses' as const,
        model: 'gpt-5.5',
        text: '已完成 d.pdf page 1，停止在 page 2 前，可輸入 go 接續。',
        unsupportedSettings: [],
        warnings: [],
        fileAnalysisPatch: {
          sourceFiles: [
            {
              fileId: 'file_d_pdf',
              filename: 'd.pdf',
              mediaType: 'application/pdf',
              pageCount: 2,
              ocrEngine: 'PaddleOCR MCP',
              ocrStatus: 'completed' as const,
            },
          ],
          patches: [
            {
              sheetId: 'interpretation_notes' as const,
              upsertColumns: [
                { key: 'note', label: '判讀備註', valueType: 'text' as const },
                { key: 'ocr_status', label: 'OCR 狀態', valueType: 'status' as const },
              ],
              upsertRows: [
                {
                  id: 'd_pdf_page_1_progress',
                  sourceRef: {
                    fileId: 'file_d_pdf',
                    filename: 'd.pdf',
                    mediaType: 'application/pdf',
                    sourceKey: 'file_d_pdf:page:1:ocr-progress',
                    page: 1,
                    ocrEngine: 'PaddleOCR MCP',
                    ocrStatus: 'completed' as const,
                    processedAt: '2026-06-12T00:00:00.000Z',
                  },
                  cells: {
                    note: 'd.pdf page 1 已用 400 DPI 單頁圖片完成 PaddleOCR。',
                    ocr_status: 'completed',
                  },
                  confidence: 'medium' as const,
                },
              ],
            },
          ],
          summary: 'd.pdf page 1 completed; page 2 pending.',
        },
      })
      .mockImplementationOnce(async (options) => {
        const serializedMessages = JSON.stringify(options.messages);
        expect(serializedMessages).toContain('file_d_pdf:page:1:ocr-progress');
        expect(serializedMessages).toContain('d.pdf page 1 已用 400 DPI');
        expect(serializedMessages).toContain('"content":"go"');

        return {
          provider: 'openai_oauth_responses' as const,
          model: 'gpt-5.5',
          text: 'go 已接續處理 d.pdf page 2。',
          unsupportedSettings: [],
          warnings: [],
          fileAnalysisPatch: {
            sourceFiles: [
              {
                fileId: 'file_d_pdf',
                filename: 'd.pdf',
                mediaType: 'application/pdf',
                pageCount: 2,
                ocrEngine: 'PaddleOCR MCP',
                ocrStatus: 'completed' as const,
              },
            ],
            patches: [
              {
                sheetId: 'interpretation_notes' as const,
                upsertColumns: [
                  { key: 'note', label: '判讀備註', valueType: 'text' as const },
                  { key: 'ocr_status', label: 'OCR 狀態', valueType: 'status' as const },
                ],
                upsertRows: [
                  {
                    id: 'd_pdf_page_2_progress',
                    sourceRef: {
                      fileId: 'file_d_pdf',
                      filename: 'd.pdf',
                      mediaType: 'application/pdf',
                      sourceKey: 'file_d_pdf:page:2:ocr-progress',
                      page: 2,
                      ocrEngine: 'PaddleOCR MCP',
                      ocrStatus: 'completed' as const,
                      processedAt: '2026-06-12T00:05:00.000Z',
                    },
                    cells: {
                      note: 'd.pdf page 2 已用 400 DPI 單頁圖片完成 PaddleOCR。',
                      ocr_status: 'completed',
                    },
                    confidence: 'medium' as const,
                  },
                ],
              },
            ],
            summary: 'd.pdf page 2 completed after go resume.',
          },
        };
      });
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService: createMemoryWorkbookService(),
      fileAnalysisService,
    });
    const firstReq = {
      body: {
        conversationId: 'conversation_d_pdf',
        workbookId: 'wb_1',
        messages: [
          {
            role: 'user',
            content: 'OCR d.pdf，先處理第一頁',
            files: [
              {
                filename: 'd.pdf',
                mediaType: 'application/pdf',
                dataBase64: dPdf.toString('base64'),
              },
            ],
          },
        ],
      },
    } as Request;
    const firstRes = createResponse();

    await handlers.chat(firstReq, firstRes);

    expect(firstRes.status).toHaveBeenCalledWith(200);
    expect(firstRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        fileAnalysisData: expect.objectContaining({
          version: 1,
          sheets: expect.objectContaining({
            interpretation_notes: expect.objectContaining({
              rows: [
                expect.objectContaining({
                  sourceRef: expect.objectContaining({
                    sourceKey: 'file_d_pdf:page:1:ocr-progress',
                    page: 1,
                    ocrStatus: 'completed',
                  }),
                }),
              ],
            }),
          }),
        }),
      }),
    );

    const secondReq = {
      body: {
        conversationId: 'conversation_d_pdf',
        workbookId: 'wb_1',
        messages: [{ role: 'user', content: 'go' }],
      },
    } as Request;
    const secondRes = createResponse();

    await handlers.chat(secondReq, secondRes);

    expect(secondRes.status).toHaveBeenCalledWith(200);
    expect(secondRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'go 已接續處理 d.pdf page 2。',
        fileAnalysisData: expect.objectContaining({
          version: 2,
          sheets: expect.objectContaining({
            interpretation_notes: expect.objectContaining({
              rows: expect.arrayContaining([
                expect.objectContaining({
                  sourceRef: expect.objectContaining({
                    sourceKey: 'file_d_pdf:page:1:ocr-progress',
                    page: 1,
                  }),
                }),
                expect.objectContaining({
                  sourceRef: expect.objectContaining({
                    sourceKey: 'file_d_pdf:page:2:ocr-progress',
                    page: 2,
                    ocrStatus: 'completed',
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    );
    expect(sendChat).toHaveBeenCalledTimes(2);
  });

  const itLiveFileAnalysisWorkbook =
    process.env.STEEL_FILE_ANALYSIS_WORKBOOK_LIVE_TEST === 'true' ? it : it.skip;

  itLiveFileAnalysisWorkbook(
    'creates a workbook from file_analysis_data using only Supabase Steel rules and data',
    async () => {
      const fileAnalysisRepository = new MemorySteelFileAnalysisRepository();
      const fileAnalysisService = createSteelFileAnalysisService({
        repository: fileAnalysisRepository,
        id: () => 'fad_live_workbook',
        now: () => new Date('2026-06-12T00:00:00.000Z'),
      });
      await fileAnalysisService.patch({
        conversationId: 'conversation_file_analysis_to_workbook',
        patch: {
          sourceFiles: [
            {
              fileId: 'file_d_pdf',
              filename: 'd.pdf',
              mediaType: 'application/pdf',
              pageCount: 2,
              ocrEngine: 'PaddleOCR MCP',
              ocrStatus: 'completed',
            },
          ],
          patches: [
            {
              sheetId: 'file_analysis_data',
              upsertColumns: [
                { key: 'item_name', label: '品名', valueType: 'text' },
                { key: 'spec', label: '規格', valueType: 'text' },
                { key: 'length_m', label: '長度M', valueType: 'number' },
                { key: 'quantity', label: '數量', valueType: 'number' },
                { key: 'unit', label: '單位', valueType: 'text' },
              ],
              upsertRows: [
                {
                  id: 'ocr_line_c100',
                  sourceRef: {
                    fileId: 'file_d_pdf',
                    filename: 'd.pdf',
                    mediaType: 'application/pdf',
                    sourceKey: 'file_d_pdf:page:1:table:main:row:C100',
                    page: 1,
                    ocrEngine: 'PaddleOCR MCP',
                    ocrStatus: 'completed',
                    processedAt: '2026-06-12T00:00:00.000Z',
                  },
                  cells: {
                    item_name: 'C型鋼',
                    spec: 'C100x50x20x2.3t',
                    length_m: 6,
                    quantity: 1,
                    unit: '支',
                  },
                  confidence: 'medium',
                  reviewStatus: 'pending_review',
                },
              ],
            },
          ],
        },
      });
      const workbookRepository = new MemorySteelWorkbookRepository();
      const workbookService = createSteelWorkbookService({
        repository: workbookRepository,
        id: () => 'wb_live_file_analysis',
        now: () => new Date('2026-06-12T00:00:00.000Z'),
      });
      const created = await workbookService.create({
        conversationMetaId: 'conversation_file_analysis_to_workbook',
      });
      const pool = createSteelPostgresPool();
      const executedToolNames: string[] = [];
      const executeToolCall = jest.fn(async (options) => {
        executedToolNames.push(options.toolName);
        return executeSteelTool({
          client: pool,
          toolName: options.toolName,
          arguments: options.arguments,
          providerToolCallId: options.providerToolCallId,
          runState: options.runState,
        });
      });
      const sendChat = jest.fn(async (options) => {
        const serializedMessages = JSON.stringify(options.messages);
        expect(serializedMessages).toContain('Latest saved file_analysis_data workspace');
        expect(serializedMessages).toContain('C100x50x20x2.3t');
        expect(serializedMessages).toContain('file_d_pdf:page:1:table:main:row:C100');
        expect(options.workbookPatchTool).toBe(true);

        if (!options.executeSteelToolCall) {
          throw new Error('Steel tool executor is required for workbook generation.');
        }

        const runState = { maxCalls: 8, callsUsed: 0 };
        const rules = await options.executeSteelToolCall({
          toolName: 'lookup_quote_rules',
          arguments: {
            taskTypes: ['candidate_generation', 'material_price_lookup', 'workbook_generation'],
            evidenceSummary:
              'file_analysis_data row: C100x50x20x2.3t length 6M quantity 1 source d.pdf page 1',
            catalogContexts: [
              {
                catalogCandidates: ['c_type'],
                packetGroupHints: ['c-type-quote-core'],
              },
            ],
            customerContext: { tierKnown: false },
            reviewState: 'reviewed',
            limit: 10,
          },
          providerToolCallId: 'live_lookup_quote_rules',
          runState,
        });
        const prices = await options.executeSteelToolCall({
          toolName: 'search_price_candidates',
          arguments: {
            originalText: 'file_analysis_data: C100x50x20x2.3t 長度 6M 數量 1 支',
            catalogFamilies: ['c_type'],
            candidateQueries: [
              {
                queryId: 'file-analysis-c100x23',
                productNames: ['錏輕型鋼'],
                specKeyContains: '100x2.3',
                confidence: 'high',
                reason:
                  'Derived from file_analysis_data C100x50x20x2.3t row and reviewed c_type rules',
              },
            ],
            reviewState: 'reviewed',
            limit: 5,
          },
          providerToolCallId: 'live_search_price_candidates',
          runState,
        });

        if (!rules.ok) {
          throw new Error(`lookup_quote_rules failed: ${rules.errorSummary}`);
        }
        if (!prices.ok) {
          throw new Error(`search_price_candidates failed: ${prices.errorSummary}`);
        }

        const [priceCandidate] = prices.data.priceCandidates ?? [];
        if (!priceCandidate || typeof priceCandidate.unitPrice !== 'number') {
          throw new Error('Supabase search_price_candidates returned no numeric price candidate.');
        }

        const unitWeight = Number(priceCandidate.productPriceUnitWeight ?? 4);
        const lengthM = 6;
        const quantity = 1;
        const totalWeight = unitWeight * lengthM * quantity;
        const subtotal = Math.round(priceCandidate.unitPrice * totalWeight * 100) / 100;

        return {
          provider: 'openai_oauth_responses' as const,
          model: 'gpt-5.5',
          text: `已依 file_analysis_data 與 Supabase reviewed data 生成 workbook，小計：${subtotal}`,
          unsupportedSettings: [],
          warnings: [],
          workbookPatch: {
            operations: [
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'line_no',
                value: 1,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'customer_original_item_name',
                value: 'C100x50x20x2.3t',
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'normalized_item_name',
                value: String(priceCandidate.productName),
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'adopted_product_price_item',
                value: String(priceCandidate.specKey),
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'material_category',
                value: 'c_type',
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'spec',
                value: 'C100x50x20x2.3t',
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'finished_length_m',
                value: lengthM,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'quantity',
                value: quantity,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'unit',
                value: '支',
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'unit_weight_kg_per_m',
                value: unitWeight,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'total_weight_kg',
                value: totalWeight,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'material_unit_price',
                value: priceCandidate.unitPrice,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'material_pricing_unit',
                value: 'Kg',
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'billable_quantity',
                value: totalWeight,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'quote_details' as const,
                rowId: 'line_1',
                columnKey: 'subtotal',
                value: subtotal,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'price_sources' as const,
                rowId: 'source_1',
                columnKey: 'adopted_product_price_item',
                value: String(priceCandidate.specKey),
              },
              {
                op: 'set_cell' as const,
                sheetId: 'price_sources' as const,
                rowId: 'source_1',
                columnKey: 'adopted_unit_price',
                value: priceCandidate.unitPrice,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'price_sources' as const,
                rowId: 'source_1',
                columnKey: 'source_file',
                value: 'Supabase steel price_items',
              },
              {
                op: 'set_cell' as const,
                sheetId: 'summary' as const,
                rowId: 'summary_total_amount',
                columnKey: 'value',
                value: subtotal,
              },
              {
                op: 'set_cell' as const,
                sheetId: 'interpretation_notes' as const,
                rowId: 'note_1',
                columnKey: 'content',
                value:
                  'Workbook generated from saved file_analysis_data after lookup_quote_rules and search_price_candidates returned reviewed Supabase data.',
              },
            ],
          },
        };
      });
      const handlers = createSteelHandlers({
        executeToolCall,
        getModelsConfig: jest.fn(),
        sendChat,
        workbookService,
        fileAnalysisService,
      });
      const req = {
        body: {
          conversationId: 'conversation_file_analysis_to_workbook',
          workbookId: created.workbook.id,
          workbookVersion: created.workbook.version,
          selectedWorkbookRefs: [],
          messages: [{ role: 'user', content: '依照 file_analysis_data 生成報價 workbook' }],
        },
      } as Request;
      const { chunks, res } = createStreamResponse();

      try {
        await handlers.streamChat(req, res);
      } finally {
        await pool.end();
      }

      const events = parseStreamChunks(chunks);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(executedToolNames).toEqual(['lookup_quote_rules', 'search_price_candidates']);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'lookup',
            status: 'completed',
            toolName: 'lookup_quote_rules',
            ok: true,
          }),
          expect.objectContaining({
            type: 'tool',
            status: 'completed',
            toolName: 'search_price_candidates',
            ok: true,
          }),
          expect.objectContaining({
            type: 'tool',
            status: 'completed',
            toolName: 'patch_quote_workbook',
            ok: true,
          }),
        ]),
      );
      const doneEvent = events.find(
        (event): event is { type: 'done'; response: Record<string, unknown> } =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type?: string }).type === 'done',
      );
      expect(doneEvent?.response).toEqual(
        expect.objectContaining({
          text: expect.stringContaining('Supabase reviewed data'),
          workbookPatch: expect.objectContaining({
            workbook: expect.objectContaining({
              id: created.workbook.id,
            }),
          }),
        }),
      );
      const workbook = (doneEvent?.response.workbookPatch as { workbook?: { sheets?: any[] } })
        ?.workbook;
      const quoteDetails = workbook?.sheets?.find((sheet) => sheet.id === 'quote_details');
      const priceSources = workbook?.sheets?.find((sheet) => sheet.id === 'price_sources');
      const summary = workbook?.sheets?.find((sheet) => sheet.id === 'summary');

      expect(quoteDetails?.rows.find((row) => row.id === 'line_1')?.cells).toEqual(
        expect.objectContaining({
          customer_original_item_name: 'C100x50x20x2.3t',
          material_category: 'c_type',
          material_pricing_unit: 'Kg',
          subtotal: expect.any(Number),
        }),
      );
      expect(priceSources?.rows.find((row) => row.id === 'source_1')?.cells).toEqual(
        expect.objectContaining({
          source_file: 'Supabase steel price_items',
          adopted_unit_price: expect.any(Number),
        }),
      );
      expect(summary?.rows.find((row) => row.id === 'summary_total_amount')?.cells).toEqual(
        expect.objectContaining({
          value: expect.any(Number),
        }),
      );
    },
    60000,
  );

  it('streams a fatal Steel tool error without hiding the tool failure summary', async () => {
    const executeToolCall = jest.fn(async (options) => ({
      ok: false as const,
      toolName: options.toolName,
      errorCategory: 'repository_error' as const,
      errorSummary: 'Connection terminated due to connection timeout',
      durationMs: 5000,
      redactionVersion: 1 as const,
    }));
    const sendChat = jest.fn(async (options) => {
      await options.executeSteelToolCall?.({
        toolName: 'lookup_quote_rules',
        arguments: { catalogFamilies: ['c_type'] },
        providerToolCallId: 'call_lookup_1',
        runState: { maxCalls: 8, callsUsed: 0 },
      });
      throw new Error(
        'Steel tool lookup_quote_rules failed: Connection terminated due to connection timeout',
      );
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

    const events = parseStreamChunks(chunks);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'lookup',
          status: 'failed',
          toolName: 'lookup_quote_rules',
          message: 'lookup_quote_rules failed: Connection terminated due to connection timeout',
          ok: false,
        }),
        expect.objectContaining({
          type: 'error',
          errorSummary:
            'Steel tool lookup_quote_rules failed: Connection terminated due to connection timeout',
        }),
      ]),
    );
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalled();
  });

  it('streams sanitized provider error details for unknown provider failures', async () => {
    const sendChat = jest.fn(async () => {
      throw new Error(
        'Provider invalid_request_error: context length exceeded while creating response',
      );
    });
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
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

    const events = parseStreamChunks(chunks);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          errorCategory: 'unknown',
          errorSummary:
            'Provider invalid_request_error: context length exceeded while creating response',
        }),
      ]),
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('streams an actionable provider termination reason instead of a bare terminated error', async () => {
    const sendChat = jest.fn(async () => {
      throw new Error('terminated');
    });
    const handlers = createSteelHandlers({
      executeToolCall: jest.fn(),
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: '報價' }],
      },
    } as Request;
    const { chunks, res } = createStreamResponse();

    await handlers.streamChat(req, res);

    const events = parseStreamChunks(chunks);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          errorCategory: 'provider_terminated',
          errorSummary: expect.stringMatching(/provider request terminated/i),
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('"errorSummary":"terminated"');
    expect(res.end).toHaveBeenCalled();
  });

  it('applies provider workbook patch operations before returning the OAuth chat response', async () => {
    const operations = [
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'material_unit_price',
        value: 115,
        reason: 'AI matched the reviewed C-type steel quote line.',
      },
    ];
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已更新報價明細。',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: { operations },
    }));
    const workbookPatch = {
      workbook: { id: 'wb_1', version: 2, sheets: [] },
      changedPaths: [
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'material_unit_price' },
      ],
      changedFieldSummary: [
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          label: '材料單價',
          previousValue: null,
          nextValue: 115,
        },
      ],
    };
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(async () => ({
        workbook: { id: 'wb_1', version: 1, sheets: [] },
      })),
      patch: jest.fn(async () => workbookPatch),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const selectedWorkbookRefs = [
      {
        workbookId: 'wb_1',
        workbookVersion: 1,
        sheetId: 'quote_details',
        rowId: 'line_1',
        columnKey: 'material_unit_price',
      },
    ];
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs,
        messages: [{ role: 'user', content: '把 line 1 材料單價改成 115' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        workbookPatchTool: true,
      }),
    );
    expect(workbookService.read).toHaveBeenCalledWith({ workbookId: 'wb_1' });
    expect(workbookService.patch).toHaveBeenCalledWith({
      workbookId: 'wb_1',
      workbookVersion: 1,
      selectedWorkbookRefs,
      operations,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '已更新報價明細。',
        unsupportedSettings: [],
        warnings: [],
        workbookPatch,
      }),
    );
  });

  it('returns a visible workbook update summary when the model only emits a patch tool call', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: {
        operations: [
          {
            op: 'set_cell' as const,
            sheetId: 'quote_details' as const,
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            value: 115,
          },
        ],
      },
    }));
    const workbookPatch = {
      workbook: { id: 'wb_1', version: 2, sheets: [] },
      changedPaths: [
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'material_unit_price' },
      ],
      changedFieldSummary: [
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          label: '材料單價',
          previousValue: null,
          nextValue: 115,
        },
      ],
    };
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(async () => ({
        workbook: { id: 'wb_1', version: 1, sheets: [] },
      })),
      patch: jest.fn(async () => workbookPatch),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        messages: [{ role: 'user', content: 'set quote_details line_1 material_unit_price 115' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '已更新 workbook：材料單價 -> 115',
        unsupportedSettings: [],
        warnings: [],
        workbookPatch,
      }),
    );
  });

  it('replaces field-count-only workbook text with a concise order and change summary', async () => {
    const operations = [
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'customer',
        value: '龍頂',
      },
    ];
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已更新 workbook：19 個欄位',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: { operations },
    }));
    const workbookPatch = {
      workbook: { id: 'wb_1', version: 2, sheets: [] },
      changedPaths: [
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'customer_original_item_name',
        },
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'normalized_item_name',
        },
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'search_keywords' },
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'customer' },
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'customer_tier' },
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'material_unit_price' },
        { sheetId: 'quote_details' as const, rowId: 'line_1', columnKey: 'subtotal' },
      ],
      changedFieldSummary: [
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'customer_original_item_name',
          label: '客戶原始品名',
          previousValue: null,
          nextValue: 'C100x50x20x2.3t 6M',
        },
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'normalized_item_name',
          label: '標準化品名',
          previousValue: null,
          nextValue: '錏輕型鋼 C100x50x20x2.3t 6M',
        },
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'search_keywords',
          label: '搜尋關鍵字',
          previousValue: null,
          nextValue: '錏輕型鋼 100x2.3; 鍍鋅輕型鋼 100x2.3; 白鐵輕型鋼 100x2.3; 黑鐵輕型鋼 100x2.3',
        },
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'customer',
          label: '客戶',
          previousValue: null,
          nextValue: '龍頂',
        },
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'customer_tier',
          label: '分級',
          previousValue: 'B',
          nextValue: 'A',
        },
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'material_unit_price',
          label: '材料單價',
          previousValue: 26.8,
          nextValue: 26,
        },
        {
          sheetId: 'quote_details' as const,
          rowId: 'line_1',
          columnKey: 'subtotal',
          label: '小計',
          previousValue: 643.2,
          nextValue: 624,
        },
      ],
    };
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(async () => ({
        workbook: { id: 'wb_1', version: 1, sheets: [] },
      })),
      patch: jest.fn(async () => workbookPatch),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        messages: [{ role: 'user', content: '客戶是龍頂' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('訂單資訊'),
        workbookPatch,
      }),
    );
    const responseText = res.json.mock.calls[0]?.[0]?.text as string;
    expect(responseText).toContain('訂單資訊：C100x50x20x2.3t 6M；錏輕型鋼');
    expect(responseText).toContain('客戶：龍頂');
    expect(responseText).toContain('小計：624');
    expect(responseText).toContain('改動重點：已更新客戶、分級、材料單價、小計');
    expect(responseText).toContain('7 個欄位');
    expect(responseText).not.toContain('空白 ->');
    expect(responseText).not.toContain('搜尋關鍵字');
    expect(responseText).not.toContain('鍍鋅輕型鋼 100x2.3');
    expect(responseText).not.toBe('已更新 workbook：19 個欄位');
  });

  it('returns subtotal info and applies AI workbook patch data to matching fields', async () => {
    const repository = new MemorySteelWorkbookRepository();
    const workbookService = createSteelWorkbookService({
      id: () => 'wb_real_patch_1',
      now: () => new Date('2026-06-05T00:00:00.000Z'),
      repository,
    });
    const created = await workbookService.create({ conversationMetaId: 'steel_meta_1' });
    const operations = [
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'line_no',
        value: 1,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'customer_original_item_name',
        value: 'C100x50x20x2.3t 6M',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'normalized_item_name',
        value: '錏輕型鋼 100*2.3',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'adopted_product_price_item',
        value: 'CCG10023 錏輕型鋼 100*2.3',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'material_category',
        value: 'c_type',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'spec',
        value: 'C100x50x20x2.3t',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'finished_length_m',
        value: 6,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'quantity',
        value: 1,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'unit',
        value: '支',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'unit_weight_kg_per_m',
        value: 4,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'unit_weight_kg',
        value: 24,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'total_weight_kg',
        value: 24,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'weight_algorithm',
        value: '4 kg/m × 6M = 24 kg',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'customer',
        value: '龍頂',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'customer_tier',
        value: 'A級',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'material_unit_price',
        value: 26,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'material_unit_price_field',
        value: '售價A',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'material_pricing_unit',
        value: 'Kg',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'billable_quantity',
        value: 24,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'subtotal',
        value: 624,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'confidence',
        value: '中',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'low_confidence_reason',
        value: '需確認龍頂客戶全名與材質是否為錏輕型鋼',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'decision_evidence',
        value: '產品價格.xlsx CCG10023；龍頂客戶候選皆A級',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'quote_details' as const,
        rowId: 'line_1',
        columnKey: 'suggested_review',
        value: '確認客戶全名與材質後轉正式報價',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'customer',
        value: '龍頂',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'customer_tier',
        value: 'A級',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'customer_original_item_name',
        value: 'C100x50x20x2.3t 6M',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'normalized_item_name',
        value: '錏輕型鋼 100*2.3',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'adopted_product_price_item',
        value: 'CCG10023 錏輕型鋼 100*2.3',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'adopted_unit_price',
        value: 26,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'unit_price_field',
        value: '售價A',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'source_file',
        value: '產品價格.xlsx',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'price_sources' as const,
        rowId: 'source_1',
        columnKey: 'confidence',
        value: '中',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'interpretation_notes' as const,
        rowId: 'note_1',
        columnKey: 'item',
        value: 'C型鋼報價',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'interpretation_notes' as const,
        rowId: 'note_1',
        columnKey: 'content',
        value: 'C100 先採錏輕型鋼 100*2.3；6M 重量 24kg；小計 624。',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'interpretation_notes' as const,
        rowId: 'note_1',
        columnKey: 'confidence',
        value: '中',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'line_no',
        value: 1,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'model_code',
        value: 'CCG10023',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'item_spec',
        value: '錏輕型鋼 100*2.3',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'unit',
        value: '支',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'quantity',
        value: 1,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'unit_weight',
        value: 24,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'total_quantity',
        value: 1,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'unit_price',
        value: 624,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'pricing_basis',
        value: '暫估報價',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'length',
        value: 6000,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'category',
        value: 'c_type',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'system_order' as const,
        rowId: 'order_1',
        columnKey: 'note',
        value: '暫估；需確認龍頂客戶全名與材質是否為錏輕型鋼；待確認後轉正式訂單',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_customer',
        columnKey: 'item',
        value: '客戶',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_customer',
        columnKey: 'value',
        value: '龍頂',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_customer',
        columnKey: 'note',
        value: '暫估；確認客戶後可重算',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_customer_tier',
        columnKey: 'item',
        value: '分級',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_customer_tier',
        columnKey: 'value',
        value: 'A級',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_customer_tier',
        columnKey: 'note',
        value: '暫估；確認客戶價格等級後可重算',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_total_amount',
        columnKey: 'item',
        value: '暫估小計',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_total_amount',
        columnKey: 'value',
        value: 624,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_total_amount',
        columnKey: 'note',
        value: '待確認材質、客戶與分級後轉正式報價',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'manual_review' as const,
        rowId: 'review_1',
        columnKey: 'line_no',
        value: 1,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'manual_review' as const,
        rowId: 'review_1',
        columnKey: 'issue_type',
        value: '暫估報價確認',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'manual_review' as const,
        rowId: 'review_1',
        columnKey: 'estimated_value',
        value: '小計 624',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'manual_review' as const,
        rowId: 'review_1',
        columnKey: 'low_confidence_reason',
        value: '需確認龍頂客戶全名與材質是否為錏輕型鋼',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'manual_review' as const,
        rowId: 'review_1',
        columnKey: 'inferred_evidence',
        value: '產品價格.xlsx CCG10023；龍頂客戶候選皆A級',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'manual_review' as const,
        rowId: 'review_1',
        columnKey: 'confirmation_needed',
        value: '確認客戶全名與材質後轉正式報價',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'manual_review' as const,
        rowId: 'review_1',
        columnKey: 'amount_impact',
        value: 624,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'manual_review' as const,
        rowId: 'review_1',
        columnKey: 'suggested_action',
        value: '確認後更新正式報價',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'customer_quote' as const,
        rowId: 'customer_1',
        columnKey: 'line_no',
        value: 1,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'customer_quote' as const,
        rowId: 'customer_1',
        columnKey: 'item_spec',
        value: '錏輕型鋼 100*2.3',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'customer_quote' as const,
        rowId: 'customer_1',
        columnKey: 'quantity',
        value: 1,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'customer_quote' as const,
        rowId: 'customer_1',
        columnKey: 'unit',
        value: '支',
      },
      {
        op: 'set_cell' as const,
        sheetId: 'customer_quote' as const,
        rowId: 'customer_1',
        columnKey: 'unit_price',
        value: 624,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'customer_quote' as const,
        rowId: 'customer_1',
        columnKey: 'subtotal',
        value: 624,
      },
      {
        op: 'set_cell' as const,
        sheetId: 'customer_quote' as const,
        rowId: 'customer_1',
        columnKey: 'note',
        value: '暫估；需確認龍頂客戶全名與材質是否為錏輕型鋼',
      },
    ];
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '已更新 workbook：22 個欄位',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: { operations },
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: {
        workbookId: created.workbook.id,
        workbookVersion: created.workbook.version,
        selectedWorkbookRefs: [],
        messages: [{ role: 'user', content: '客戶是龍頂，C100 用A價重算' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0]?.[0];
    expect(response.text).toContain('小計：624');
    expect(response.text).toContain('改動重點：已更新客戶、分級、材料單價、小計');
    expect(response.workbookPatch.workbook.version).toBe(1);
    expect(response.workbookPatch.changedPaths).toEqual([]);
    const quoteDetails = response.workbookPatch.workbook.sheets.find(
      (sheet) => sheet.id === 'quote_details',
    );
    const priceSources = response.workbookPatch.workbook.sheets.find(
      (sheet) => sheet.id === 'price_sources',
    );
    const systemOrder = response.workbookPatch.workbook.sheets.find(
      (sheet) => sheet.id === 'system_order',
    );
    const summary = response.workbookPatch.workbook.sheets.find((sheet) => sheet.id === 'summary');
    const manualReview = response.workbookPatch.workbook.sheets.find(
      (sheet) => sheet.id === 'manual_review',
    );
    const interpretationNotes = response.workbookPatch.workbook.sheets.find(
      (sheet) => sheet.id === 'interpretation_notes',
    );
    const customerQuote = response.workbookPatch.workbook.sheets.find(
      (sheet) => sheet.id === 'customer_quote',
    );

    expect(quoteDetails.rows.find((row) => row.id === 'line_1')?.cells).toMatchObject({
      line_no: 1,
      customer_original_item_name: 'C100x50x20x2.3t 6M',
      normalized_item_name: '錏輕型鋼 100*2.3',
      adopted_product_price_item: 'CCG10023 錏輕型鋼 100*2.3',
      material_category: 'c_type',
      spec: 'C100x50x20x2.3t',
      finished_length_m: 6,
      quantity: 1,
      unit: '支',
      unit_weight_kg_per_m: 4,
      unit_weight_kg: 24,
      total_weight_kg: 24,
      customer: '龍頂',
      customer_tier: 'A級',
      material_unit_price: 26,
      material_unit_price_field: '售價A',
      material_pricing_unit: 'Kg',
      billable_quantity: 24,
      subtotal: 624,
    });
    expect(priceSources.rows.find((row) => row.id === 'source_1')?.cells).toMatchObject({
      customer: '龍頂',
      customer_tier: 'A級',
      customer_original_item_name: 'C100x50x20x2.3t 6M',
      normalized_item_name: '錏輕型鋼 100*2.3',
      adopted_product_price_item: 'CCG10023 錏輕型鋼 100*2.3',
      adopted_unit_price: 26,
      unit_price_field: '售價A',
      source_file: '產品價格.xlsx',
      confidence: '中',
    });
    expect(systemOrder.rows.find((row) => row.id === 'order_1')?.cells).toMatchObject({
      line_no: 1,
      model_code: 'CCG10023',
      item_spec: '錏輕型鋼 100*2.3',
      unit: '支',
      quantity: 1,
      unit_weight: 24,
      total_quantity: 1,
      unit_price: 624,
      pricing_basis: '暫估報價',
      length: 6000,
      category: 'c_type',
      note: expect.stringContaining('待確認'),
    });
    expect(summary.rows.find((row) => row.id === 'summary_customer')?.cells).toMatchObject({
      item: '客戶',
      value: '龍頂',
      note: expect.stringContaining('暫估'),
    });
    expect(summary.rows.find((row) => row.id === 'summary_customer_tier')?.cells).toMatchObject({
      item: '分級',
      value: 'A級',
      note: expect.stringContaining('暫估'),
    });
    expect(summary.rows.find((row) => row.id === 'summary_total_amount')?.cells).toMatchObject({
      item: '暫估小計',
      value: 624,
      note: expect.stringContaining('待確認'),
    });
    expect(manualReview.rows.find((row) => row.id === 'review_1')?.cells).toMatchObject({
      line_no: 1,
      issue_type: '暫估報價確認',
      estimated_value: '小計 624',
      low_confidence_reason: '需確認龍頂客戶全名與材質是否為錏輕型鋼',
      inferred_evidence: '產品價格.xlsx CCG10023；龍頂客戶候選皆A級',
      confirmation_needed: '確認客戶全名與材質後轉正式報價',
      amount_impact: 624,
      suggested_action: '確認後更新正式報價',
    });
    expect(interpretationNotes.rows.find((row) => row.id === 'note_1')?.cells).toMatchObject({
      item: 'C型鋼報價',
      content: 'C100 先採錏輕型鋼 100*2.3；6M 重量 24kg；小計 624。',
      confidence: '中',
    });
    expect(customerQuote.rows.find((row) => row.id === 'customer_1')?.cells).toMatchObject({
      line_no: 1,
      item_spec: '錏輕型鋼 100*2.3',
      quantity: 1,
      unit: '支',
      unit_price: 624,
      subtotal: 624,
      note: expect.stringContaining('暫估'),
    });
  });

  it('sends workbook structure context so AI resolves visible summary labels to internal patch targets', async () => {
    const operations = [
      {
        op: 'set_cell' as const,
        sheetId: 'summary' as const,
        rowId: 'summary_total_amount',
        columnKey: 'value',
        value: 100,
        reason: 'User asked to update the summary total amount.',
      },
    ];
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: { operations },
    }));
    const workbookPatch = {
      workbook: { id: 'wb_1', version: 2, sheets: [] },
      changedPaths: [
        { sheetId: 'summary' as const, rowId: 'summary_total_amount', columnKey: 'value' },
      ],
      changedFieldSummary: [
        {
          sheetId: 'summary' as const,
          rowId: 'summary_total_amount',
          columnKey: 'value',
          label: '值',
          previousValue: null,
          nextValue: 100,
        },
      ],
    };
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(async () => ({
        workbook: {
          id: 'wb_1',
          version: 1,
          sheets: [
            {
              id: 'summary',
              label: '總結',
              columns: [
                { key: 'item', label: '項目', valueType: 'text', editable: false },
                { key: 'value', label: '值', valueType: 'currency', editable: true },
                { key: 'note', label: '備註', valueType: 'text', editable: true },
              ],
              rows: [
                { id: 'summary_total_weight', cells: { item: '總重量', value: null, note: null } },
                { id: 'summary_total_amount', cells: { item: '總額', value: null, note: null } },
              ],
            },
          ],
        },
      })),
      patch: jest.fn(async () => workbookPatch),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        messages: [{ role: 'user', content: '總結的總額更新為100' }],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    const sendChatOptions = sendChat.mock.calls[0]?.[0];
    expect(workbookService.read).toHaveBeenCalledWith({ workbookId: 'wb_1' });
    expect(sendChatOptions).toEqual(
      expect.objectContaining({
        workbookPatchTool: true,
        workbookContextText: expect.stringContaining('sheet id="summary" label="總結"'),
      }),
    );
    expect(sendChatOptions.workbookContextText).toContain('column label="值" key="value"');
    expect(sendChatOptions.workbookContextText).toContain('row id="summary_total_amount"');
    expect(sendChatOptions.workbookContextText).toContain('item="總額"');
    expect(workbookService.patch).toHaveBeenCalledWith({
      workbookId: 'wb_1',
      workbookVersion: 1,
      selectedWorkbookRefs: [],
      operations,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '已更新 workbook：值 -> 100',
        unsupportedSettings: [],
        warnings: [],
        workbookPatch,
      }),
    );
  });

  it('decodes browser-safe chat file payloads before calling the provider adapter', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-file-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [
          {
            role: 'user',
            content: 'Read the attachment.',
            files: [
              {
                filename: 'steel-oauth-smoke.txt',
                mediaType: 'text/plain',
                dataBase64: Buffer.from('TXT_SENTINEL_7F3A', 'utf8').toString('base64'),
              },
            ],
          },
        ],
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: 'Read the attachment.',
            files: [
              {
                filename: 'steel-oauth-smoke.txt',
                mediaType: 'text/plain',
                data: new Uint8Array(Buffer.from('TXT_SENTINEL_7F3A', 'utf8')),
              },
            ],
          },
        ],
        passThroughUnsupportedFiles: true,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('resolves persisted fileId chat file refs before calling the provider adapter', async () => {
    const resolvedBytes = new Uint8Array(Buffer.from('PNG_SENTINEL', 'utf8'));
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-file-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const resolveEvidenceFile = jest.fn(async () => ({
      filename: 'c.png',
      mediaType: 'image/png',
      data: resolvedBytes,
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      resolveEvidenceFile,
      workbookService: createMemoryWorkbookService(),
    });
    const req = {
      user: { id: 'user_1' },
      body: {
        conversationId: 'conversation_1',
        messages: [
          {
            role: 'user',
            content: 'Read the persisted image again.',
            files: [
              {
                fileId: 'file_123',
                filename: 'c.png',
                mediaType: 'image/png',
              },
            ],
          },
        ],
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(resolveEvidenceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file_123',
        userId: 'user_1',
        conversationId: 'conversation_1',
      }),
    );
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: 'Read the persisted image again.',
            files: [
              {
                filename: 'c.png',
                mediaType: 'image/png',
                data: resolvedBytes,
              },
            ],
          },
        ],
        passThroughUnsupportedFiles: true,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('injects configured file instructions for image and PDF file payloads', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-file-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const instructions =
      'Attached images or image-based documents may be rotated. Preserve Chinese text exactly.';
    const req = {
      config: {
        fileAnalysis: { instructions },
      },
      body: {
        messages: [
          {
            role: 'user',
            content: 'Read the attachment.',
            files: [
              {
                filename: 'scan.pdf',
                mediaType: 'application/pdf',
                dataBase64: Buffer.from('PDF_SENTINEL', 'utf8').toString('base64'),
              },
            ],
          },
        ],
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: `${instructions}\n\nRead the attachment.`,
          }),
        ],
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('expands configured local OAuth auth file paths before calling the provider', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      env: {
        HOME: '/Users/tester',
        STEEL_OPENAI_OAUTH_AUTH_FILE: '$HOME/.codex/auth.json',
      },
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
        authFilePath: '/Users/tester/.codex/auth.json',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uses request-level reasoning effort when provided', async () => {
    const sendChat = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      model: 'gpt-5.5',
      text: 'steel-chat-ok',
      unsupportedSettings: [],
      warnings: [],
    }));
    const handlers = createSteelHandlers({
      env: { STEEL_OPENAI_REASONING_EFFORT: 'medium' },
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        reasoningEffort: 'high',
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningEffort: 'high',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects unsupported request-level reasoning effort values', async () => {
    const sendChat = jest.fn();
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
        reasoningEffort: 'minimal',
      },
    } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errorSummary: 'reasoningEffort must be one of: low, medium, high, xhigh',
      }),
    );
  });

  it('rejects API provider mode until the API adapter is implemented', async () => {
    const sendChat = jest.fn();
    const handlers = createSteelHandlers({
      env: { STEEL_OPENAI_PROVIDER: 'API' },
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

    expect(sendChat).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_api',
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      errorCategory: 'unknown',
      errorSummary:
        'STEEL_OPENAI_PROVIDER=API is reserved for the OpenAI API adapter, which is not implemented in this slice.',
    });
  });

  it('returns provider auth failures without triggering browser session refresh semantics', async () => {
    const sendChat = jest.fn(async () => {
      throw new Error('ChatGPT access token not found');
    });
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

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      errorCategory: 'auth',
      errorSummary:
        'OpenAI OAuth auth is unavailable. Run Codex login on the server or configure server auth material.',
    });
  });

  it('rejects malformed chat requests without calling the provider', async () => {
    const sendChat = jest.fn();
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
    });
    const req = { body: { messages: [] } } as Request;
    const res = createResponse();

    await handlers.chat(req, res);

    expect(sendChat).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '',
      unsupportedSettings: [],
      warnings: [],
      errorCategory: 'unknown',
      errorSummary: 'messages must contain at least one chat message',
    });
  });

  it('returns typed Steel conversation access error categories', async () => {
    const conversationService = {
      createAuthenticated: jest.fn(),
      createGuest: jest.fn(async () => {
        throw new SteelConversationAccessError(
          'Steel guest mode is disabled',
          'steel_guest_mode_disabled',
        );
      }),
      read: jest.fn(),
    };
    const handlers = createSteelHandlers({
      conversationService,
      getModelsConfig: jest.fn(),
    });
    const req = { body: { libreChatConversationId: 'lc_guest_1' } } as Request;
    const res = createResponse();

    await handlers.createGuestConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Steel guest mode is disabled',
      errorCategory: 'steel_guest_mode_disabled',
    });
  });

  it('creates Steel workbooks through the workbook service', async () => {
    const workbookService = {
      create: jest.fn(async () => ({
        workbook: {
          id: 'wb_1',
          version: 1,
          sheets: [],
        },
      })),
      patch: jest.fn(),
      read: jest.fn(),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      body: { conversationMetaId: 'steel_meta_1' },
    } as Request;
    const res = createResponse();

    await handlers.createWorkbook(req, res);

    expect(workbookService.create).toHaveBeenCalledWith({ conversationMetaId: 'steel_meta_1' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ workbook: { id: 'wb_1', version: 1, sheets: [] } });
  });

  it('returns a diagnostic workbook error in development for unexpected create failures', async () => {
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation();
    const workbookService = {
      create: jest.fn(async () => {
        throw new Error('Mongo workbook schema rejected sheets');
      }),
      patch: jest.fn(),
      read: jest.fn(),
    };
    const handlers = createSteelHandlers({
      env: { NODE_ENV: 'development' },
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      body: {},
    } as Request;
    const res = createResponse();

    await handlers.createWorkbook(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(loggerSpy).toHaveBeenCalledWith('[steelWorkbook] request failed:', expect.any(Error));
    expect(res.json).toHaveBeenCalledWith({
      message: 'Steel workbook request failed',
      errorCategory: 'steel_workbook_unknown',
      errorSummary: 'Mongo workbook schema rejected sheets',
    });
  });

  it('patches Steel workbooks through the conversation-scoped workbook service', async () => {
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(),
      patchByConversationMetaId: jest.fn(async () => ({
        changedPaths: [
          { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
        ],
        changedFieldSummary: [
          {
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            label: '材料單價',
            previousValue: null,
            nextValue: 115,
          },
        ],
        workbook: { id: 'wb_1', version: 2, sheets: [] },
      })),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      body: {
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        operations: [
          {
            op: 'set_cell',
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            value: 115,
          },
        ],
      },
      params: { conversationId: 'conversation_1' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.patchWorkbookByConversation(req, res);

    expect(workbookService.patchByConversationMetaId).toHaveBeenCalledWith({
      conversationMetaId: 'conversation_1',
      ...req.body,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        changedPaths: [
          { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
        ],
      }),
    );
  });

  it('rejects old id-based manual workbook patch routes', async () => {
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(),
      patch: jest.fn(),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      body: {
        workbookId: 'wb_1',
        workbookVersion: 1,
        selectedWorkbookRefs: [],
        operations: [
          {
            op: 'set_cell',
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            value: 115,
          },
        ],
      },
      params: { workbookId: 'wb_1' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.patchWorkbook(req, res);

    expect(workbookService.patch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Steel workbook id-based patch routes are disabled',
      errorCategory: 'steel_workbook_patch_route_disabled',
    });
  });

  it('exports the current workbook as streamed XLSX without recalculating workbook data', async () => {
    const workbookService = {
      create: jest.fn(),
      patch: jest.fn(),
      read: jest.fn(async () => ({
        workbook: {
          id: 'wb_1',
          version: 2,
          sheets: [
            {
              id: 'quote_details' as const,
              label: '報價明細',
              columns: [
                { key: 'line_no', label: '項次', valueType: 'number' as const, editable: false },
                {
                  key: 'material_unit_price',
                  label: '材料單價',
                  valueType: 'currency' as const,
                  editable: true,
                },
              ],
              rows: [{ id: 'line_1', cells: { line_no: 1, material_unit_price: null } }],
            },
            ...[
              'system_order',
              'summary',
              'manual_review',
              'price_sources',
              'interpretation_notes',
              'customer_quote',
            ].map((sheetId) => ({
              id: sheetId as
                | 'system_order'
                | 'summary'
                | 'manual_review'
                | 'price_sources'
                | 'interpretation_notes'
                | 'customer_quote',
              label: sheetId,
              columns: [
                { key: 'line_no', label: '項次', valueType: 'number' as const, editable: false },
              ],
              rows: [],
            })),
          ],
        },
      })),
    };
    const sendChat = jest.fn();
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      sendChat,
      workbookService,
    });
    const req = {
      body: { workbookVersion: 2, sheetIds: ['quote_details'] },
      params: { workbookId: 'wb_1' },
    } as unknown as Request;
    const res = createBinaryResponse();

    await handlers.exportWorkbook(req, res);

    expect(workbookService.read).toHaveBeenCalledWith({ workbookId: 'wb_1' });
    expect(workbookService.patch).not.toHaveBeenCalled();
    expect(sendChat).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('steel-workbook-wb_1-v2.xlsx'),
    );
    expect(Buffer.isBuffer(res.send.mock.calls[0]?.[0])).toBe(true);
  });

  it('rejects stale workbook export requests before streaming a file', async () => {
    const workbookService = {
      create: jest.fn(),
      patch: jest.fn(),
      read: jest.fn(async () => ({
        workbook: {
          id: 'wb_1',
          version: 3,
          sheets: [],
        },
      })),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      workbookService,
    });
    const req = {
      body: { workbookVersion: 2, sheetIds: ['quote_details'] },
      params: { workbookId: 'wb_1' },
    } as unknown as Request;
    const res = createBinaryResponse();

    await handlers.exportWorkbook(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Steel workbook version conflict',
      errorCategory: 'steel_workbook_version_conflict',
    });
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe('createSteelAdminHandlers', () => {
  it('returns the code-owned gpt-5.5 OAuth Responses support matrix', async () => {
    const handlers = createSteelAdminHandlers();
    const req = { body: {} } as Request;
    const res = createResponse();

    await handlers.requestCapabilitySmoke(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      source: 'code_owned_support_matrix',
      capabilities: expect.objectContaining({
        text: 'passed',
        streaming: 'passed',
        image_input: 'passed',
        pdf_input: 'passed',
        doc_input: 'passed',
        docx_input: 'passed',
        xls_input: 'passed',
        xlsx_input: 'passed',
        conversation_state: 'not_applicable',
      }),
    });
  });
});
