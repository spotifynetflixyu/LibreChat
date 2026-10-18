import mongoose from 'mongoose';
import { Constants } from 'librechat-data-provider';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createSteelWorkingOrderMemoryModel } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { SteelRepositoryClient } from '../repositories/types';
import type { SteelNativeToolRequest } from './execute';
import {
  addSteelPaddleOcrMcpTool,
  getSteelNativeToolRunState,
  createSteelNativeToolExecute,
  getSteelRequestConversationId,
  mergeSteelNativeToolDefinitions,
} from './execute';
import { GenerationJobManager } from '~/stream/GenerationJobManager';
import { PADDLE_OCR_MCP_SERVER_NAME } from '../ocr/diagnostics';
import { createSteelNativeHistory } from './events';
import { emitSteelNativeEvents } from './stream';

const paddleToken = `${Constants.mcp_all}${Constants.mcp_delimiter}${PADDLE_OCR_MCP_SERVER_NAME}`;
const customerRow = {
  id: '1',
  erp_customer_code: 'C001',
  display_name: '龍頂鋼鐵',
  legal_name: '龍頂鋼鐵股份有限公司',
  tax_id: '12345678',
  customer_tier: 'A',
  status: 'active',
};

function createClient(): SteelRepositoryClient & { query: jest.Mock } {
  return { query: jest.fn().mockResolvedValue({ rows: [customerRow] }) };
}

function createResponse(): Response & { write: jest.Mock } {
  return { write: jest.fn(), writableEnded: false } as unknown as Response & { write: jest.Mock };
}

function writtenEvents(res: { write: jest.Mock }): unknown[] {
  return res.write.mock.calls.map(([chunk]: [string]) =>
    JSON.parse(chunk.replace(/^event: message\ndata: /u, '').trim()),
  );
}

let server: MongoMemoryReplSet;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  await createSteelWorkingOrderMemoryModel(mongoose).init();
}, 60000);

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

describe('getSteelNativeToolRunState', () => {
  it('shares one budget per request-scoped connection and falls back to the request', () => {
    const req = {};
    const connections = {};
    const scoped = getSteelNativeToolRunState({ req, requestScopedConnections: connections });

    expect(scoped).toMatchObject({ maxCalls: 8, maxCallsByTool: { search_price_candidates: 2 } });
    expect(getSteelNativeToolRunState({ req: {}, requestScopedConnections: connections })).toBe(
      scoped,
    );
    expect(getSteelNativeToolRunState({ req })).not.toBe(scoped);
    expect(getSteelNativeToolRunState({ req })).toBe(getSteelNativeToolRunState({ req }));
  });
});

describe('getSteelRequestConversationId', () => {
  it('prefers the body id and ignores blank ids', () => {
    expect(
      getSteelRequestConversationId({
        body: { conversationId: 'body' },
        steelNativeContext: { conversationId: 'context' },
      }),
    ).toBe('body');
    expect(getSteelRequestConversationId({ steelNativeContext: { conversationId: 'ctx' } })).toBe(
      'ctx',
    );
    expect(getSteelRequestConversationId({ body: { conversationId: '  ' } })).toBeUndefined();
  });
});

describe('addSteelPaddleOcrMcpTool', () => {
  const pdf = { fileId: 'file-1', filename: 'drawing.pdf', mediaType: 'application/pdf' };

  it('injects the PaddleOCR server once for turns with OCR-able files', () => {
    const req: SteelNativeToolRequest = { steelNativeContext: { currentTurnFiles: [pdf] } };

    expect(addSteelPaddleOcrMcpTool(['calculator'], req)).toEqual(['calculator', paddleToken]);
    expect(addSteelPaddleOcrMcpTool([], undefined, [pdf])).toEqual([paddleToken]);
    const selected = [`paddleocr_vl${Constants.mcp_delimiter}${PADDLE_OCR_MCP_SERVER_NAME}`];
    expect(addSteelPaddleOcrMcpTool(selected, req)).toBe(selected);
  });

  it('leaves tools unchanged without OCR-able files', () => {
    const tools = ['calculator'];
    const req: SteelNativeToolRequest = {
      body: { files: [{ fileId: 'notes', filename: 'notes.txt', mediaType: 'text/plain' }] },
    };

    expect(addSteelPaddleOcrMcpTool(tools, req)).toBe(tools);
  });
});

describe('mergeSteelNativeToolDefinitions', () => {
  it('adds the Steel definitions next to the loaded ones and keeps other result fields', () => {
    const merged = mergeSteelNativeToolDefinitions({
      toolDefinitions: [
        { name: 'calculator', description: 'Adds', parameters: { type: 'object', properties: {} } },
      ],
      userMCPAuthMap: { server: 'auth' },
    });
    const names = merged.toolDefinitions.map((definition) => definition.name);

    expect(names).toEqual(
      expect.arrayContaining(['calculator', 'search_customers', 'search_price_candidates']),
    );
    expect(merged.userMCPAuthMap).toEqual({ server: 'auth' });
  });
});

describe('createSteelNativeToolExecute', () => {
  const steelContext = { requestId: 'response-1', assistantTurnIndex: 2 };

  it('runs the Steel tool, captures its result, and streams the saved activity', async () => {
    const client = createClient();
    const res = createResponse();
    const req: SteelNativeToolRequest = {
      body: { conversationId: 'conversation-1' },
      steelNativeContext: { ...steelContext, steelHistory: createSteelNativeHistory() },
    };
    const execute = createSteelNativeToolExecute({
      req,
      res,
      client,
      runState: getSteelNativeToolRunState({ req }),
    });

    const result = await execute({
      nativeToolName: 'search_customers',
      toolName: 'search_customers',
      arguments: { keywords: ['龍頂'] },
      providerToolCallId: 'call-1',
    });

    expect(result).toMatchObject({ ok: true, toolName: 'search_customers' });
    expect(client.query).toHaveBeenCalledTimes(1);
    const memories = await createSteelWorkingOrderMemoryModel(mongoose).find({}).lean();
    expect(memories).toEqual([
      expect.objectContaining({
        conversationId: 'conversation-1',
        memoryKind: 'customer_fact',
        requestId: 'response-1',
        sourceRefs: [{ sourceId: 'call-1', sourceKind: 'tool_result' }],
      }),
    ]);
    expect(writtenEvents(res)).toEqual([
      expect.objectContaining({
        event: 'steel_event',
        data: expect.objectContaining({ source: 'tool_result', toolName: 'search_customers' }),
      }),
    ]);
    expect(req.steelNativeContext?.steelHistory?.activityEvents).toHaveLength(1);
  });

  it('skips capture and activity without a conversation', async () => {
    const res = createResponse();
    const req: SteelNativeToolRequest = { steelNativeContext: steelContext };
    const execute = createSteelNativeToolExecute({
      req,
      res,
      client: createClient(),
      runState: getSteelNativeToolRunState({ req }),
    });

    await expect(
      execute({
        nativeToolName: 'search_customers',
        toolName: 'search_customers',
        arguments: { keywords: ['龍頂'] },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await createSteelWorkingOrderMemoryModel(mongoose).countDocuments()).toBe(0);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('keeps price lookup and unsaved-order customer lookup out of quotation turns', async () => {
    const client = createClient();
    const req: SteelNativeToolRequest = {
      body: { conversationId: 'conversation-1' },
      steelNativeContext: {
        ...steelContext,
        quotation: {
          scope: { userId: '507f1f77bcf86cd799439011', conversationId: 'conversation-1' },
          messageId: 'message-1',
        },
      },
    };
    const execute = createSteelNativeToolExecute({
      req,
      client,
      runState: getSteelNativeToolRunState({ req }),
    });

    await expect(
      execute({
        nativeToolName: 'search_price_candidates',
        toolName: 'search_price_candidates',
        arguments: { queries: [] },
      }),
    ).rejects.toThrow('Price lookup is only available inside quotation chunks');
    await expect(
      execute({
        nativeToolName: 'search_customers',
        toolName: 'search_customers',
        arguments: { keywords: ['龍頂'] },
      }),
    ).rejects.toThrow('Customer lookup requires a saved order and no unfinished quotation');
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('emitSteelNativeEvents', () => {
  const event = {
    event: 'steel_event',
    data: {
      type: 'memory_saved',
      source: 'tool_result',
      message: 'Saved',
      savedCounts: { customer_fact: 1 },
    },
  };

  it('persists the changed history on the resumable job before emitting through it', async () => {
    const updateMetadata = jest
      .spyOn(GenerationJobManager, 'updateMetadata')
      .mockResolvedValue(undefined);
    const emitChunk = jest.spyOn(GenerationJobManager, 'emitChunk').mockResolvedValue(undefined);
    const res = createResponse();
    const req = {
      _resumableJobCreatedAt: 42,
      steelNativeContext: { steelHistory: createSteelNativeHistory() },
    };

    await emitSteelNativeEvents({ events: [event], req, res, streamId: 'stream-1' });

    expect(updateMetadata).toHaveBeenCalledWith(
      'stream-1',
      { steelHistory: req.steelNativeContext.steelHistory },
      42,
    );
    expect(emitChunk).toHaveBeenCalledWith('stream-1', event, { expectedCreatedAt: 42 });
    expect(updateMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      emitChunk.mock.invocationCallOrder[0],
    );
    expect(res.write).not.toHaveBeenCalled();
  });

  it('writes directly to an open response without a stream', async () => {
    const res = createResponse();
    await emitSteelNativeEvents({ events: [event], res });
    expect(writtenEvents(res)).toEqual([event]);

    const ended = Object.assign(createResponse(), { writableEnded: true });
    await emitSteelNativeEvents({ events: [event], res: ended });
    expect(ended.write).not.toHaveBeenCalled();
  });
});
