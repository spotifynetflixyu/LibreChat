import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import type { SteelQuotationScope, SteelQuotationActiveRun } from '@librechat/data-schemas';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import type { QuotationChunk, QuotationPythonEvidence } from './protocol';
import type { QuotationModelInput, QuotationModelResult } from './model';

import { createSteelQuotationStateService } from './state';
import { buildQuotationChunks } from './protocol';
import { runQuotationPreflight } from './runner';

const scope: SteelQuotationScope = {
  userId: 'quotation-runner-user',
  conversationId: 'quotation-runner-conversation',
};

const ocrHeaders = ['來源', '零件編號', '類別', '數量', '厚度', '寬度', '長度'];
const systemHeaders = [
  '型號',
  '品名規格',
  '材質編號',
  '單位',
  '數量',
  '單重',
  '總數',
  '單價',
  '計價基準',
  '公式編號',
  '厚度',
  '寬度',
  '長度',
  '肚',
  '類別',
  '備註',
];
const customerMarkdown = [
  '## customer_data',
  '',
  '| 客戶編號 | 客戶名稱 | 價格等級 | 說明 |',
  '| --- | --- | --- | --- |',
  '| C1 | 測試客戶 | B | |',
].join('\n');

function markdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function orderMarkdown(rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, index) => [
    'F1',
    `P${index + 1}`,
    '鐵板',
    '1',
    '6',
    '100',
    '200',
  ]);
  return `## ocr_result\n\n${markdownTable(ocrHeaders, rows)}`;
}

function candidate(): SteelToolJsonObject {
  return {
    erpItemCode: 'ERP-PLATE',
    productName: '鐵板 6T',
    category: '鐵板',
    material: '黑鐵',
    unit: 'Kg',
    formulaCode: 'PL',
    thicknessMinMm: 6,
    thicknessMaxMm: 6,
    tierPrices: { A: 11, B: 12, C: 13, D: 14, E: 15, F: 16 },
  };
}

function lookupResult(): SteelToolResult {
  return {
    ok: true,
    toolName: 'search_price_candidates',
    data: {
      queryResults: [{
        queryId: 'q1',
        status: 'ok',
        candidates: [candidate()],
      }],
    },
    durationMs: 1,
    redactionVersion: 1,
  };
}

function systemRow(source: QuotationChunk['sourceRows'][number]): readonly string[] {
  return [
    'ERP-PLATE',
    `鐵板 6T ${source.cells[1] ?? ''}`.trim(),
    '黑鐵',
    'Kg',
    source.cells[3] ?? '',
    '',
    source.cells[3] ?? '',
    '12',
    '2',
    'PL',
    source.cells[4] ?? '',
    source.cells[5] ?? '',
    source.cells[6] ?? '',
    '',
    '鐵板',
    '',
  ];
}

function childMarkdown(chunk: QuotationChunk, lookupCallId: string): string {
  const rows = chunk.sourceRows.map(systemRow);
  const lineage = Object.fromEntries(
    chunk.sourceRows.map((source, index) => [String(index + 1), {
      sourceRowId: source.sourceRowId,
      kind: 'material',
      lookupCallId,
      queryId: 'q1',
      candidateIdentity: {
        erpItemCode: 'ERP-PLATE',
        productName: '鐵板 6T',
        category: '鐵板',
        material: '黑鐵',
        formulaCode: 'PL',
      },
    }]),
  );
  return [
    '## system_order_chunk',
    '',
    markdownTable(systemHeaders, rows),
    '',
    '```json',
    JSON.stringify({ version: 1, quote_lineage: lineage }),
    '```',
  ].join('\n');
}

function childPythonEvidence(chunk: QuotationChunk): QuotationPythonEvidence {
  const quoteCalculations = Object.fromEntries(
    chunk.sourceRows.map((source, index) => [String(index + 1), { 總數: source.cells[3] ?? '' }]),
  );
  const toolCallId = `python-${chunk.chunkIndex}`;
  return {
    type: 'tool-result',
    toolCallId,
    payload: JSON.stringify({
      type: 'tool-result',
      toolCallId,
      toolName: 'code_interpreter',
      result: JSON.stringify({ quote_calculations: quoteCalculations }),
    }),
  };
}

function mainMarkdown(order: string): string {
  const rows = buildQuotationChunks(order).flatMap((chunk) => chunk.sourceRows.map(systemRow));
  return `## system_order\n\n${markdownTable(systemHeaders, rows)}`;
}

function createLookupExecutor(): (args: SteelToolJsonObject, callId: string) => Promise<SteelToolResult> {
  return jest.fn(async () => lookupResult());
}

function createModel(
  options: {
    failChunk?: (chunkIndex: number) => boolean;
    onChildStarted?: (chunkIndex: number) => void;
    onChild?: (input: QuotationModelInput, chunk: QuotationChunk) => Promise<QuotationModelResult> | QuotationModelResult;
  } = {},
) {
  return jest.fn(async (input: QuotationModelInput): Promise<QuotationModelResult> => {
    if (input.role === 'main') {
      return {
        markdown: mainMarkdown((JSON.parse(input.input) as { order: string }).order),
        lookups: [],
        pythonEvidence: [],
      };
    }
    const payload = JSON.parse(input.input) as { chunk: QuotationChunk };
    const chunk = payload.chunk;
    options.onChildStarted?.(chunk.chunkIndex);
    if (options.failChunk?.(chunk.chunkIndex)) {
      throw new Error(`chunk ${chunk.chunkIndex} failed`);
    }
    if (options.onChild) {
      return options.onChild(input, chunk);
    }
    const lookupCallId = `lookup-${chunk.chunkIndex}`;
    await input.lookup?.(lookupCallId, { queries: [] });
    const pythonEvidence = childPythonEvidence(chunk);
    await input.onPythonEvidence?.(pythonEvidence);
    return {
      markdown: childMarkdown(chunk, lookupCallId),
      lookups: [],
      pythonEvidence: [pythonEvidence],
    };
  });
}

let mongoServer: MongoMemoryServer;
let service: ReturnType<typeof createSteelQuotationStateService>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  await mongoose.connect(mongoServer.getUri());
  service = createSteelQuotationStateService(mongoose);
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

async function prepareRun(rowCount: number): Promise<SteelQuotationActiveRun> {
  const order = orderMarkdown(rowCount);
  await service.setOrder({ scope, fullMarkdown: order, revision: 'runner-test' });
  const ticket = await service.issueTicket({
    scope,
    customerMarkdown,
    customerIdentity: 'C1',
    triggeringMessageId: 'trigger-1',
    selectionProvenance: { method: 'unique', lookupMessageId: 'customer-lookup' },
  });
  const chunks = buildQuotationChunks(order);
  return service.acceptSignal({
    scope,
    index: ticket.index,
    token: ticket.token,
    orderHash: ticket.orderHash,
    customerMarkdown,
    customerIdentity: 'C1',
    prompts: { child: 'child', main: 'main' },
    chunks: chunks.map((chunk) => ({ index: chunk.chunkIndex, sourceRowCount: chunk.sourceRows.length })),
    targetMessageId: 'target-1',
  });
}

function runnerInput(
  invokeModel: ReturnType<typeof createModel>,
  executeLookup: (args: SteelToolJsonObject, callId: string) => Promise<SteelToolResult>,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: { run: SteelQuotationActiveRun }) => Promise<void>;
    publishFinal?: (input: { run: SteelQuotationActiveRun; markdown: string }) => Promise<void>;
  } = {},
) {
  return {
    scope,
    modelOptions: {} as OpenAIOAuthModelOptions,
    signal: options.signal ?? new AbortController().signal,
    invokeModel,
    executeLookup,
    onProgress: options.onProgress,
    publishFinal: options.publishFinal ?? jest.fn(async () => undefined),
  };
}

describe('quotation runner integration', () => {
  it('reuses completed chunks after an interrupted child and runs only the pending chunk', async () => {
    await prepareRun(31);
    let failSecondChunk = true;
    const invokeModel = createModel({
      failChunk: (chunkIndex) => {
        if (chunkIndex !== 2 || !failSecondChunk) return false;
        failSecondChunk = false;
        return true;
      },
    });
    const executeLookup = createLookupExecutor();
    await expect(runQuotationPreflight(runnerInput(invokeModel, executeLookup))).rejects.toThrow('chunk 2 failed');
    const interrupted = await service.readState(scope);
    expect(interrupted?.activeRun?.status).toBe('interrupted');
    expect(interrupted?.activeRun?.chunks.map((chunk) => chunk.status)).toEqual(['completed', 'pending']);
    const callsAfterFailure = invokeModel.mock.calls.length;

    const completed = await runQuotationPreflight(runnerInput(invokeModel, executeLookup));
    expect(completed.status).toBe('completed');
    expect(invokeModel.mock.calls.length).toBe(callsAfterFailure + 2);
    const childIndexes = invokeModel.mock.calls
      .filter(([input]) => input.role === 'child')
      .map(([input]) => (JSON.parse(input.input) as { chunk: QuotationChunk }).chunk.chunkIndex);
    expect(childIndexes).toEqual([1, 2, 2]);
    expect(executeLookup).toHaveBeenCalledTimes(2);
  });

  it('keeps a saved main checkpoint when finalization progress fails and retries aggregation only', async () => {
    await prepareRun(1);
    const invokeModel = createModel();
    const executeLookup = createLookupExecutor();
    let failFinalizingProgress = true;
    const onProgress = jest.fn(async (progress: { run: SteelQuotationActiveRun }) => {
      if (failFinalizingProgress && progress.run.status === 'finalizing') {
        failFinalizingProgress = false;
        throw new Error('finalization progress failed');
      }
    });
    await expect(runQuotationPreflight(runnerInput(invokeModel, executeLookup, { onProgress }))).rejects.toThrow(
      'finalization progress failed',
    );
    const interrupted = await service.readState(scope);
    expect(interrupted?.activeRun?.status).toBe('interrupted');
    expect(interrupted?.activeRun?.checkpointRefs.some((ref) => ref.operationId === 'main')).toBe(true);
    const callsAfterFailure = invokeModel.mock.calls.length;

    const completed = await runQuotationPreflight(runnerInput(invokeModel, executeLookup, { onProgress }));
    expect(completed.status).toBe('completed');
    expect(invokeModel.mock.calls.length).toBe(callsAfterFailure);
    expect(executeLookup).toHaveBeenCalledTimes(1);
  });

  it('cancels a child execution and does not publish a late final response', async () => {
    const run = await prepareRun(1);
    let started!: () => void;
    const childStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const invokeModel = createModel({
      onChild: async (input) => {
        started();
        await new Promise<never>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
        });
        throw new Error('unreachable');
      },
    });
    const executeLookup = createLookupExecutor();
    const controller = new AbortController();
    const publishFinal = jest.fn(async () => undefined);
    const running = runQuotationPreflight(runnerInput(invokeModel, executeLookup, {
      signal: controller.signal,
      publishFinal,
    }));
    await childStarted;
    await service.cancelRun({ scope, runId: run.runId });
    controller.abort(new Error('cancel requested'));
    await expect(running).resolves.toEqual({ status: 'cancelled' });
    expect(publishFinal).not.toHaveBeenCalled();
    expect((await service.readState(scope))?.activeRun?.status).toBe('cancelled');
  });

  it('retries publication from the saved final artifact without rerunning model work', async () => {
    await prepareRun(1);
    const invokeModel = createModel();
    const executeLookup = createLookupExecutor();
    let firstPublication = true;
    const publishFinal = jest.fn(async () => {
      if (firstPublication) {
        firstPublication = false;
        throw new Error('publication unavailable');
      }
    });
    await expect(runQuotationPreflight(runnerInput(invokeModel, executeLookup, { publishFinal }))).rejects.toThrow(
      'publication unavailable',
    );
    const completedState = await service.readState(scope);
    expect(completedState?.activeRun?.status).toBe('completed');
    expect(completedState?.activeRun?.checkpointRefs.some((ref) => ref.operationId === 'final')).toBe(true);
    const callsAfterFailure = invokeModel.mock.calls.length;

    const recovered = await runQuotationPreflight(runnerInput(invokeModel, executeLookup, { publishFinal }));
    expect(recovered.status).toBe('completed');
    expect(invokeModel.mock.calls.length).toBe(callsAfterFailure);
    expect(publishFinal).toHaveBeenCalledTimes(2);
    expect((await service.readState(scope))?.activeRun?.checkpointRefs.some((ref) => ref.operationId === 'published')).toBe(true);
  });
});
