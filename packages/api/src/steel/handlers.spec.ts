import { createSteelAdminHandlers, createSteelHandlers } from './handlers';
import { logger } from '@librechat/data-schemas';
import { SteelConversationAccessError } from './conversations/service';
import { createSteelWorkbookService } from './workbook/service';

import type { Request, Response } from 'express';
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

  async update(record: SteelWorkbookRecord): Promise<SteelWorkbookRecord> {
    this.workbooks.set(record.workbookId, record);
    return record;
  }

  async createPatch(record: SteelWorkbookPatchRecord): Promise<SteelWorkbookPatchRecord> {
    this.patches.push(record);
    return record;
  }
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

    expect(sendChat).toHaveBeenCalledWith({
      authFilePath: undefined,
      maxOutputTokens: undefined,
      messages: [{ role: 'user', content: 'Say steel-chat-ok' }],
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      steelRuntimePolicy: true,
    });
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
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '已更新報價明細。',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch,
    });
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
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '已更新 workbook：材料單價 -> 115',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch,
    });
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
    expect(res.json).toHaveBeenCalledWith({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: '已更新 workbook：值 -> 100',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch,
    });
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

  it('creates authenticated Steel rule proposals through the proposal service', async () => {
    const ruleProposalService = {
      create: jest.fn(async () => ({
        id: 'proposal_1',
        proposalType: 'customer_default',
        status: 'needs_review',
        scopeType: 'customer',
        customerId: 'cust_1',
        chargeType: 'cutting',
        formulaCode: 'C_TYPE_FINISHED_LENGTH',
        selector: { catalogFamily: 'c_channel' },
        proposedDefaultParameters: [{ key: 'unitPrice', value: 0, valueType: 'number' }],
        sourceRefs: [{ channel: 'conversation', factType: 'quote_override' }],
        createdFromConversationId: 'steel_meta_1',
        createdByUserId: 'user_1',
        reason: 'Pending Admin review.',
        confidence: 'high',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
      })),
    };
    const handlers = createSteelHandlers({
      getModelsConfig: jest.fn(),
      ruleProposalService,
    });
    const req = {
      user: { id: 'user_1' },
      body: {
        proposalType: 'customer_default',
        scopeType: 'customer',
        customerId: 'cust_1',
        chargeType: 'cutting',
        formulaCode: 'C_TYPE_FINISHED_LENGTH',
        selector: { catalogFamily: 'c_channel' },
        proposedDefaultParameters: [{ key: 'unitPrice', value: 0, valueType: 'number' }],
        sourceRefs: [{ channel: 'conversation', factType: 'quote_override' }],
        createdFromConversationId: 'steel_meta_1',
        reason: 'Pending Admin review.',
        confidence: 'high',
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.createRuleProposal(req, res);

    expect(ruleProposalService.create).toHaveBeenCalledWith({
      body: req.body,
      user: { id: 'user_1', role: undefined },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_review' }));
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

  it('patches Steel workbooks through the workbook service', async () => {
    const workbookService = {
      create: jest.fn(),
      read: jest.fn(),
      patch: jest.fn(async () => ({
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

    expect(workbookService.patch).toHaveBeenCalledWith(req.body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        changedPaths: [
          { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
        ],
      }),
    );
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
