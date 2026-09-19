import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AIMessageChunk } from '@librechat/agents/langchain/messages';
import { createSteelQuotationStateModel, createSteelQuotationArtifactModel } from '@librechat/data-schemas';

import type { SteelQuotationScope, SteelQuotationActiveRun } from '@librechat/data-schemas';
import { createOpenAIOAuthModel } from '../native/oauth';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import type { QuotationChunk } from './protocol';
import type { QuotationModelInput, QuotationModelResult } from './model';

import { createSteelQuotationStateService } from './state';
import { buildQuotationChunks, splitQuotationChunk, quotationSignal } from './protocol';
import { parseMarkdownTables } from '../markdown/table';
import { invokeQuotationModel } from './model';
import { quotationStatus } from './routes';
import { acceptQuotationResponse, runQuotationPreflight } from './runner';
import type { QuotationProgress } from './runner';
import type { SteelNativeHistory } from '../native/events';
import { createSteelNativeHistory, appendSteelNativeActivityEvent, upsertSteelNativePreflightToolCall } from '../native/events';
import { getQuotationHistoryDelta, readQuotationHistory } from './history';
import { bindQuotationCustomerResult, defaultQuotationCustomerMarkdown, prepareQuotationTurn, quotationPreparationStatus } from './preparation';

jest.mock('../native/oauth', () => ({ createOpenAIOAuthModel: jest.fn() }));
const oauthFactory = jest.mocked(createOpenAIOAuthModel);

jest.mock('../native/context', () => ({
  buildDefaultSteelGlobalAgentContext: jest.fn(async ({ mode }: { mode: string }) => ({ instructionPrefix: mode })),
}));

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

function failedLookupResult(): SteelToolResult {
  return {
    ok: false,
    toolName: 'search_price_candidates',
    errorCategory: 'repository_error',
    errorSummary: 'temporary lookup failure',
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

function childMarkdown(rows: readonly (readonly string[])[]): string {
  return [
    '## system_order_chunk',
    '',
    markdownTable(systemHeaders, rows),
  ].join('\n');
}


function createLookupExecutor(): (args: SteelToolJsonObject, callId: string) => Promise<SteelToolResult> {
  return jest.fn(async () => lookupResult());
}

function createModel(
  options: {
    failChunk?: (childCall: number) => boolean;
    onChildStarted?: (childCall: number) => void;
    onChild?: (input: QuotationModelInput) => Promise<QuotationModelResult> | QuotationModelResult;
    onMainInput?: (input: string) => void;
    streamMain?: boolean;
  } = {},
) {
  let childCall = 0;
  return jest.fn(async (input: QuotationModelInput): Promise<QuotationModelResult> => {
    if (input.role === 'main') {
      options.onMainInput?.(input.input);
      if (options.streamMain) {
        await input.onTextDelta?.('## manual_reviews\n\n');
        await input.onTextDelta?.('需人工複核。');
      }
      return {
        markdown: options.streamMain ? '## manual_reviews\n\n需人工複核。' : '無待複核事項。',
        lookups: [],
        pythonEvidence: [],
      };
    }
    const payload = JSON.parse(input.input) as { chunk: string };
    const rows = parseMarkdownTables(payload.chunk)[0]?.rows ?? [];
    const call = ++childCall;
    options.onChildStarted?.(call);
    if (options.failChunk?.(call)) {
      throw new Error(`child call ${call} failed`);
    }
    if (options.onChild) {
      return options.onChild(input);
    }
    const lookupCallId = `lookup-${call}`;
    await input.lookup?.(lookupCallId, { queries: [{ queryId: 'q1', categories: ['鐵板'] }] });
    return {
      markdown: childMarkdown(rows.map(systemRowFromSourceRow)),
      lookups: [],
      pythonEvidence: [],
    };
  });
}

function systemRowFromSourceRow(row: readonly string[]): readonly string[] {
  return [
    'ERP-PLATE',
    row[1] ? `鐵板 6T ${row[1]}` : '鐵板 6T',
    '黑鐵', 'Kg', row[3] ?? '', '', row[3] ?? '', '12', '2', 'PL',
    row[4] ?? '', row[5] ?? '', row[6] ?? '', '', '鐵板', '',
  ];
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

async function prepareRun(rowCount: number, rowsPerChunk = 30): Promise<SteelQuotationActiveRun> {
  const order = orderMarkdown(rowCount);
  await service.setOrder({ scope, fullMarkdown: order, revision: 'runner-test' });
  const ticket = await service.issueTicket({
    scope,
    customerMarkdown,
    customerIdentity: 'C1',
    triggeringMessageId: 'trigger-1',
    selectionProvenance: { method: 'unique', lookupMessageId: 'customer-lookup' },
  });
  const chunks = buildQuotationChunks(order, rowsPerChunk);
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

type QuotationInvoker = (input: QuotationModelInput) => Promise<QuotationModelResult>;

function runnerInput(
  invokeModel: QuotationInvoker,
  executeLookup: (args: SteelToolJsonObject, callId: string) => Promise<SteelToolResult>,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: { run: SteelQuotationActiveRun }) => Promise<void>;
    publishFinal?: (input: { run: SteelQuotationActiveRun; markdown: string }) => Promise<void>;
    onTextDelta?: (text: string) => Promise<void>;
  } = {},
) {
  return {
    scope,
    modelOptions: {} as OpenAIOAuthModelOptions,
    signal: options.signal ?? new AbortController().signal,
    invokeModel,
    executeLookup,
    onProgress: options.onProgress,
    onTextDelta: options.onTextDelta,
    publishFinal: options.publishFinal ?? jest.fn(async () => undefined),
  };
}

function configureOAuthResponses(responses: AIMessageChunk[]): jest.Mock {
  const providerInvoke = jest.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected OAuth provider invocation');
    return response;
  });
  oauthFactory.mockReturnValue({ invoke: providerInvoke, stream: jest.fn() } as never);
  return providerInvoke;
}

describe('quotation runner integration', () => {
  beforeEach(() => {
    oauthFactory.mockReset();
  });

  it('runs only one quotation when another retry arrives while its child is active', async () => {
    const run = await prepareRun(1);
    const lease = await service.acquireLease({ scope, runId: run.runId });
    await service.interruptRun({ scope, runId: run.runId, leaseToken: lease!.leaseToken });
    let releaseChild!: () => void;
    let childStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseChild = resolve; });
    const started = new Promise<void>((resolve) => { childStarted = resolve; });
    const originalModel = createModel();
    const model = jest.fn(async (input: QuotationModelInput) => {
      if (input.role === 'child') {
        childStarted();
        await gate;
      }
      return originalModel(input);
    });
    const publishFinal = jest.fn(async () => undefined);
    const input = runnerInput(model, createLookupExecutor(), { publishFinal });
    const first = runQuotationPreflight(input);
    try {
      await started;
      const activeLease = (await service.readState(scope))!.activeRun!.leaseToken;
      await expect(runQuotationPreflight(input)).resolves.toEqual({ status: 'busy' });
      expect((await service.readState(scope))!.activeRun!.leaseToken).toBe(activeLease);
      expect(model).toHaveBeenCalledTimes(1);
    } finally {
      releaseChild();
      await first;
    }
    expect(publishFinal).toHaveBeenCalledTimes(1);
    expect((await service.readState(scope))?.activeRun?.status).toBe('completed');
  });

  it.each(['paused', 'error'] as const)(
    'resumes a %s preflight with the correct persisted batch size and total', async (reason) => {
      const run = await prepareRun(163);
      const lease = (await service.acquireLease({ scope, runId: run.runId }))!;
      await service.interruptRun({ scope, runId: run.runId, leaseToken: lease.leaseToken,
        interruption: { reason, chunkIndex: 1 } });
      const resumed = createModel();
      const progress: QuotationProgress[] = [];
      await runQuotationPreflight({
        ...runnerInput(resumed, createLookupExecutor()),
        onProgress: async (event) => { progress.push(event); },
      });
      const rows = resumed.mock.calls.filter(([input]) => input.role === 'child')
        .map(([input]) => parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows.length);
      expect(rows).toEqual(reason === 'paused' ? [30, 30, 30, 30, 30, 13] : [12, 12, 6, 30, 30, 30, 30, 13]);
      const total = reason === 'paused' ? 6 : 8;
      expect(progress[progress.length - 1]).toEqual(expect.objectContaining({ completedChunks: total, totalChunks: total }));
      const state = await service.readState(scope);
      expect(quotationStatus(state, scope.conversationId))
        .toEqual(expect.objectContaining({ completedChunks: total, totalChunks: total }));
      const restored = await readQuotationHistory({ scope, runId: run.runId });
      expect(restored.activityEvents[restored.activityEvents.length - 1])
        .toEqual(expect.objectContaining({ completedChunks: total, totalChunks: total }));
    },
  );

  it('resumes the remaining small chunks after pause and a new message without changing the total', async () => {
    const run = await prepareRun(163);
    const controller = new AbortController();
    const validModel = createModel();
    const model = createModel({ onChild: async (input) => {
      const rows = parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows;
      if (rows.length === 30 && rows[0]![1] === 'P91') {
        return { markdown: '| incomplete', lookups: [], pythonEvidence: [] };
      }
      return validModel(input);
    } });
    await expect(runQuotationPreflight({
      ...runnerInput(model, createLookupExecutor(), { signal: controller.signal }),
      onProgress: async (event) => {
        if (event.stage === 'chunk_saved' && event.completedChunks === 4 && event.totalChunks === 8) {
          controller.abort(new Error('Paused after first recovery slice'));
        }
      },
    })).rejects.toThrow('Paused after first recovery slice');
    const paused = await service.readState(scope);
    expect(paused?.activeRun?.interruption).toEqual({ reason: 'paused', chunkIndex: 4 });
    expect(quotationStatus(paused, scope.conversationId))
      .toEqual(expect.objectContaining({ completedChunks: 4, totalChunks: 8 }));
    const savedSlice = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'leaf-v2:4:r.1' });
    expect(savedSlice).toBeTruthy();
    const prepared = await prepareQuotationTurn({
      scope, messageId: 'resume-message', responseId: 'resume-response', text: '接續報價',
    });
    expect(prepared.resume).toBe(false);
    expect((await service.readState(scope))?.pendingMessages).toHaveLength(0);
    const resumed = createModel();
    const events: QuotationProgress[] = [];
    await runQuotationPreflight({
      ...runnerInput(resumed, createLookupExecutor()),
      onProgress: async (event) => { events.push(event); },
    });
    expect(resumed.mock.calls.filter(([input]) => input.role === 'child')
      .map(([input]) => parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows.length))
      .toEqual([12, 6, 30, 13]);
    expect(events.filter((event) => event.stage === 'chunk_saved').map((event) => event.chunkIndex))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(events.find((event) => event.stage === 'chunk_saved' && event.chunkIndex === 4)?.attempt)
      .toEqual(expect.any(String));
    expect(events.filter((event) => event.stage === 'chunk_started')
      .map(({ chunkIndex, completedChunks, totalChunks }) => [chunkIndex, completedChunks, totalChunks]))
      .toEqual([[5, 4, 8], [6, 5, 8], [7, 6, 8], [8, 7, 8]]);
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'leaf-v2:4:r.1' })).toBe(savedSlice);
    const restored = await readQuotationHistory({ scope, runId: run.runId });
    expect(restored.activityEvents[restored.activityEvents.length - 1])
      .toEqual(expect.objectContaining({ completedChunks: 8, totalChunks: 8 }));
  });

  it('splits 24 to 12, 6 and 3 and records every source after all three retries fail', async () => {
    await prepareRun(24, 24);
    const attempted: string[][] = [];
    const model = jest.fn(async (input: QuotationModelInput): Promise<QuotationModelResult> => {
      if (input.role === 'main') return { markdown: '無待複核事項。', lookups: [], pythonEvidence: [] };
      expect(input.maxChildRepairAttempts).toBe(0);
      const rows = parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows;
      attempted.push(rows.map((row) => row[1]!));
      throw new Error('Provider unavailable');
    });
    const events: QuotationProgress[] = [];
    const result = await runQuotationPreflight({ ...runnerInput(model, createLookupExecutor()),
      onProgress: async (event) => { events.push(event); },
    });
    expect(attempted.map((rows) => rows.length)).toEqual([24, 12, 6, 3, 3, 6, 3, 3, 12, 6, 3, 3, 6, 3, 3]);
    for (let index = 1; index <= 24; index += 1) {
      expect(attempted.filter((rows) => rows.includes(`P${index}`))).toHaveLength(4);
    }
    const rows = parseMarkdownTables(result.markdown!)[0]!.rows;
    expect(rows).toHaveLength(24);
    expect(rows.every((row) => row[0] === '' && row[7] === '' && row[5] === '' && row[6] === '')).toBe(true);
    expect(rows.every((row, index) => row[15]!.includes(`P${index + 1}`))).toBe(true);
    expect(result.markdown).toContain('24 個材料項次報價失敗');
    expect(result.markdown).not.toContain('無待複核事項');
    expect(events.at(-1)).toEqual(expect.objectContaining({ completedChunks: 8, totalChunks: 8 }));
    const state = await service.readState(scope);
    expect(state?.activeRun?.status).toBe('completed');
    expect(state?.activeRun?.checkpointRefs.filter((ref) => ref.operationId.startsWith('leaf-v2:'))).toHaveLength(8);
    expect(await readQuotationHistory({ scope, runId: state!.activeRun!.runId })).toEqual(expect.objectContaining({
      activityEvents: expect.arrayContaining([expect.objectContaining({ completedChunks: 8, totalChunks: 8 })]),
    }));
  });

  it('keeps successful sibling chunks while only failed rows descend through smaller retries', async () => {
    await prepareRun(24, 24);
    const baseModel = createModel();
    const counts: number[] = [];
    const model = jest.fn(async (input: QuotationModelInput): Promise<QuotationModelResult> => {
      if (input.role === 'main') return baseModel(input);
      const rows = parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows;
      counts.push(rows.length);
      if (rows.some((row) => row[1] === 'P24')) throw new Error('One bad source group');
      return baseModel(input);
    });
    const result = await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    expect(counts).toEqual([24, 12, 12, 6, 6, 3, 3]);
    const rows = parseMarkdownTables(result.markdown!)[0]!.rows;
    expect(rows).toHaveLength(24);
    expect(rows.slice(0, 21).every((row) => row[0] === 'ERP-PLATE')).toBe(true);
    expect(rows.slice(21).every((row) => row[0] === '' && row[7] === '')).toBe(true);
    const status = quotationStatus(await service.readState(scope), scope.conversationId);
    expect(status).toEqual(expect.objectContaining({ completedChunks: 4, totalChunks: 4 }));
  });

  it('reuses exhausted fallback leaves after the main review is interrupted', async () => {
    const run = await prepareRun(1, 24);
    const failed = jest.fn(async (input: QuotationModelInput): Promise<QuotationModelResult> => {
      throw new Error(input.role === 'main' ? 'main review interrupted' : 'provider failed');
    });
    await expect(runQuotationPreflight(runnerInput(failed, createLookupExecutor())))
      .rejects.toThrow('main review interrupted');
    expect(failed.mock.calls.filter(([input]) => input.role === 'child')).toHaveLength(4);
    const saved = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'leaf-v2:1:r.1.1.1' });
    expect(JSON.parse(saved!).backendFailure.retryDepth).toBe(3);
    const resumed = createModel();
    const result = await runQuotationPreflight(runnerInput(resumed, createLookupExecutor()));
    expect(resumed.mock.calls.map(([input]) => input.role)).toEqual(['main']);
    expect(result.markdown).toContain('1 個材料項次報價失敗');
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'leaf-v2:1:r.1.1.1' })).toBe(saved);
  });

  it('resumes a paused three-row retry at the same depth without repeating saved siblings', async () => {
    const run = await prepareRun(24, 24);
    const controller = new AbortController();
    const baseModel = createModel();
    const counts: number[] = [];
    const model = jest.fn(async (input: QuotationModelInput): Promise<QuotationModelResult> => {
      if (input.role === 'main') return baseModel(input);
      const rows = parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows;
      counts.push(rows.length);
      if (rows.length > 3 && rows.some((row) => row[1] === 'P24')) throw new Error('Split this group');
      return baseModel(input);
    });
    await expect(runQuotationPreflight({ ...runnerInput(model, createLookupExecutor(), { signal: controller.signal }),
      onProgress: async (event) => {
        if (event.stage === 'chunk_saved' && event.completedChunks === 3 && event.totalChunks === 4) controller.abort(new Error('pause'));
      },
    })).rejects.toThrow('pause');
    const first = [...counts];
    const resumed = await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    expect(resumed.status).toBe('completed');
    expect(counts.slice(first.length)).toEqual([3]);
    expect(parseMarkdownTables(resumed.markdown!)[0]!.rows).toHaveLength(24);
    const restored = await readQuotationHistory({ scope, runId: run.runId });
    expect(restored.activityEvents.at(-1)).toEqual(expect.objectContaining({ completedChunks: 4, totalChunks: 4 }));
  });

  it.each(['checkpointed', 'artifact only'])(
    'resumes an exhausted legacy parent in 10-row slices with heartbeats and a %s recovery plan', async (planState) => {
      const run = await prepareRun(23);
      const lease = await service.acquireLease({ scope, runId: run.runId });
      const leased = { scope, runId: run.runId, leaseToken: lease!.leaseToken };
      await service.checkpoint({ ...leased, operationId: 'repair:1:legacy:2:chunk_repair_failed', kind: 'main',
        payload: JSON.stringify({ stage: 'chunk_repair_failed', repairAttempt: 2, maxRepairAttempts: 2 }),
      });
      await service.checkpoint({ ...leased, operationId: 'child-output:1:legacy', kind: 'main',
        payload: JSON.stringify({ markdown: '| incomplete', lookupOperations: [], pythonOperations: [] }),
      });
      await service.interruptRun(leased);
      {
        const recoveryLease = await service.acquireLease({ scope, runId: run.runId });
        const rows = buildQuotationChunks(orderMarkdown(23), 30)[0]!.sourceRows;
        const persistPlan = planState === 'artifact only' ? service.writeArtifact : service.checkpoint;
        await persistPlan({
          scope, runId: run.runId, leaseToken: recoveryLease!.leaseToken,
          operationId: 'split:1', kind: 'main', payload: JSON.stringify({
            version: 1, rowsPerSlice: 10,
            sourceRowIds: [rows.slice(0, 10), rows.slice(10, 20), rows.slice(20)]
              .map((slice) => slice.map((row) => row.sourceRowId)),
          }),
        });
        await service.interruptRun({ scope, runId: run.runId, leaseToken: recoveryLease!.leaseToken });
      }
      const State = createSteelQuotationStateModel(mongoose);
      const update = State.collection.findOneAndUpdate.bind(State.collection);
      const heartbeat = jest.spyOn(State.collection, 'findOneAndUpdate').mockImplementation(async (...args) => {
        if (!Array.isArray(args[1]) && args[1].$set?.['activeRun.checkpointRefs']) {
          const active = (await service.readState(scope))!.activeRun!;
          await service.heartbeatLease({
            scope, runId: run.runId, leaseToken: active.leaseToken,
            now: new Date(Math.max(Date.now(), active.updatedAt.getTime() + 1)),
          });
        }
        return update(...args);
      });
      const model = createModel({ onChild: async (input) => {
        const plan = JSON.parse((await service.readCheckpoint({ scope, runId: run.runId, operationId: 'split:1' }))!);
        expect(plan.version).toBe(1);
        expect(plan.rowsPerSlice).toBe(10);
        expect(plan.sourceRowIds.map((ids: string[]) => ids.length)).toEqual([10, 10, 3]);
        expect(input).not.toHaveProperty('continuation');
        const rows = parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows;
        await input.lookup?.(`lookup-${rows[0]![1]}`, { queries: [] });
        return { markdown: childMarkdown(rows.map(systemRowFromSourceRow)), lookups: [], pythonEvidence: [] };
      } });
      try {
        await expect(runQuotationPreflight(runnerInput(model, createLookupExecutor())))
          .resolves.toEqual(expect.objectContaining({ status: 'completed' }));
        expect(model.mock.calls.filter(([input]) => input.role === 'child').map(([input]) =>
          parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows.length)).toEqual([10, 10, 3]);
        expect(await createSteelQuotationArtifactModel(mongoose).countDocuments({
          ...scope, runId: run.runId, operationId: 'split:1',
        })).toBe(1);
      } finally {
        heartbeat.mockRestore();
      }
    },
  );

  it('rejects a changed recovery source plan before invoking a child', async () => {
    const run = await prepareRun(23);
    const lease = await service.acquireLease({ scope, runId: run.runId });
    const leased = { scope, runId: run.runId, leaseToken: lease!.leaseToken };
    await service.checkpoint({ ...leased, operationId: 'split:1', kind: 'main',
      payload: JSON.stringify({ version: 1, sourceRowIds: [['source-row-2']] }),
    });
    await service.interruptRun(leased);
    const model = createModel();
    await expect(runQuotationPreflight(runnerInput(model, createLookupExecutor())))
      .rejects.toThrow('recovery plan does not match');
    expect(model).not.toHaveBeenCalled();
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' })).toBeUndefined();
  });

  it('does not split valid saved output after interruption before the parent checkpoint', async () => {
    const run = await prepareRun(30);
    const lease = await service.acquireLease({ scope, runId: run.runId });
    const leased = { scope, runId: run.runId, leaseToken: lease!.leaseToken };
    const lookupKey = 'lookup:1:interrupted:lookup-old';
    await service.checkpoint({ ...leased, operationId: lookupKey, kind: 'tool', payload: JSON.stringify({
      lookupCallId: 'lookup-old', arguments: { queries: [] }, result: lookupResult(),
    }) });
    await service.checkpoint({ ...leased, operationId: 'child-output:1:interrupted', kind: 'main',
      payload: JSON.stringify({ markdown: childMarkdown(buildQuotationChunks(orderMarkdown(30), 30)[0]!.sourceRows.map(systemRow)),
        lookupOperations: [lookupKey], pythonOperations: [] }),
    });
    await service.interruptRun(leased);
    const model = createModel();
    await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    const childInputs = model.mock.calls.filter(([input]) => input.role === 'child');
    expect(childInputs).toHaveLength(1);
    expect(parseMarkdownTables(JSON.parse(childInputs[0]![0].input).chunk)[0]!.rows).toHaveLength(30);
    expect(childInputs[0]![0]).not.toHaveProperty('continuation');
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'split:1' })).toBeUndefined();
  });

  it.each(['checkpoint failure', 'cancellation', 'lease loss'])(
    'does not split a large child for %s even after its last repair event', async (failure) => {
      const run = await prepareRun(30);
      const controller = new AbortController();
      const model = createModel({ onChild: async (input) => {
        if (failure === 'checkpoint failure') {
          const insert = jest.spyOn(createSteelQuotationArtifactModel(mongoose).collection, 'insertOne')
            .mockRejectedValueOnce(new Error(failure));
          try { await input.onChildMessages?.([]); } finally { insert.mockRestore(); }
        }
        if (failure === 'cancellation') controller.abort(new Error(failure));
        if (failure === 'lease loss') await service.cancelRun({ scope, runId: run.runId });
        throw new Error(failure);
      } });
      const execution = runQuotationPreflight(runnerInput(model, createLookupExecutor(), { signal: controller.signal }));
      if (failure === 'lease loss') await expect(execution).resolves.toEqual({ status: 'cancelled' });
      else await expect(execution).rejects.toThrow(failure);
      expect(model).toHaveBeenCalledTimes(1);
      expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'split-v2:1:r' })).toBeUndefined();
    },
  );

  it.each(['usage', 'tool', 'progress'])(
    'preserves the retry node when its %s callback fails', async (callback) => {
      const run = await prepareRun(24, 24);
      const fail = async () => { throw new Error('callback unavailable'); };
      const model = createModel({ failChunk: (call) => call === 1, onChild: async (input) => {
        if (callback === 'usage') await input.onUsage?.({ input_tokens: 1, output_tokens: 1, total_tokens: 2 });
        if (callback === 'tool') await input.lookup?.('lookup-callback', { queries: [{ queryId: 'q1' }] });
        if (callback === 'progress') await input.onChildRepair?.({
          stage: 'chunk_repair_failed', repairAttempt: 0, maxRepairAttempts: 0, message: 'invalid output',
        });
        throw new Error('callback should have thrown');
      } });
      await expect(runQuotationPreflight({
        ...runnerInput(model, createLookupExecutor()),
        onUsage: fail,
        onTool: fail,
        onProgress: async (event) => { if (event.stage === 'chunk_repair_failed') await fail(); },
      })).rejects.toThrow('callback unavailable');
      expect(model).toHaveBeenCalledTimes(2);
      const interrupted = (await service.readState(scope))!.activeRun!;
      expect(interrupted.checkpointRefs.filter((ref) => ref.operationId.startsWith('split-v2:'))
        .map((ref) => ref.operationId)).toEqual(['split-v2:1:r']);
      expect(interrupted.checkpointRefs.some((ref) => ref.operationId.startsWith('leaf-v2:'))).toBe(false);
      const resumed = createModel();
      await expect(runQuotationPreflight(runnerInput(resumed, createLookupExecutor())))
        .resolves.toEqual(expect.objectContaining({ status: 'completed' }));
      expect(resumed.mock.calls.filter(([input]) => input.role === 'child')
        .map(([input]) => parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows.length)).toEqual([12, 12]);
      expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'split-v2:1:r.1' })).toBeUndefined();
    },
  );

  it('uses all saved recovery slices after a main failure and excludes legacy child review tables', async () => {
    const run = await prepareRun(163);
    const lease = (await service.acquireLease({ scope, runId: run.runId }))!;
    const leased = { scope, runId: run.runId, leaseToken: lease.leaseToken };
    await service.checkpoint({ ...leased, operationId: 'lookup:legacy', kind: 'tool',
      payload: JSON.stringify({ lookupCallId: 'legacy', arguments: {}, result: lookupResult() }) });
    const reviews = `## manual_reviews_chunk\n\n${markdownTable(
      ['來源表格', '來源件號 / 項次', '問題欄位', '目前判斷', '需確認內容', '影響範圍'],
      [['F1', 'P91', '單价', '', '確認價格', '報價']],
    )}`;
    const serialize = (markdown: string) => JSON.stringify({
      markdown, lookupOperations: ['lookup:legacy'], pythonOperations: [],
    });
    for (const chunk of buildQuotationChunks(orderMarkdown(163), 30)) {
      let markdown = childMarkdown(chunk.sourceRows.map(systemRow));
      if (chunk.chunkIndex === 4) {
        const slices = splitQuotationChunk(chunk);
        await service.checkpoint({ ...leased, operationId: 'split:4', kind: 'main', payload: JSON.stringify({
          version: 1, rowsPerSlice: 10, sourceRowIds: slices.map((slice) => slice.sourceRows.map((row) => row.sourceRowId)),
        }) });
        for (let index = 0; index < slices.length; index += 1) {
          await service.checkpoint({ ...leased, operationId: `slice:4:${index + 1}`, kind: 'chunk',
            payload: serialize(`${childMarkdown(slices[index]!.sourceRows.map(systemRow))}\n\n${reviews}`) });
        }
        markdown = markdown.replaceAll('| 12 |', '| 999 |');
      }
      await service.checkpoint({ ...leased, operationId: `chunk:${chunk.chunkIndex}`, kind: 'chunk',
        chunkIndex: chunk.chunkIndex, payload: serialize(markdown) });
    }
    await service.interruptRun({ ...leased, interruption: { reason: 'error' } });
    const model = createModel({ onMainInput: (input) => {
      const payload = JSON.parse(input);
      expect(Object.keys(payload).sort()).toEqual(['customer', 'order', 'system_order']);
      expect(parseMarkdownTables(payload.system_order)[0]!.rows).toHaveLength(163);
      expect(payload.system_order).not.toContain('999');
      expect(payload.system_order).not.toContain('manual_reviews_chunk');
    } });
    const progress: QuotationProgress[] = [];
    await runQuotationPreflight({ ...runnerInput(model, createLookupExecutor()),
      onProgress: async (event) => { progress.push(event); } });
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0]![0].role).toBe('main');
    expect(progress.filter((event) => event.stage === 'chunk_saved').map((event) => event.chunkIndex))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(progress[progress.length - 1]).toEqual(expect.objectContaining({ totalChunks: 8, completedChunks: 8 }));
  });

  it('preserves notes from a legacy completed main checkpoint without rerunning the model', async () => {
    const run = await prepareRun(1);
    const lease = (await service.acquireLease({ scope, runId: run.runId }))!;
    const leased = { scope, runId: run.runId, leaseToken: lease.leaseToken };
    const chunk = buildQuotationChunks(orderMarkdown(1), 30)[0]!;
    await service.checkpoint({ ...leased, operationId: 'lookup:legacy', kind: 'tool',
      payload: JSON.stringify({ lookupCallId: 'legacy', result: lookupResult() }) });
    const markdown = childMarkdown(chunk.sourceRows.map(systemRow));
    await service.checkpoint({ ...leased, operationId: 'chunk:1', kind: 'chunk', chunkIndex: 1,
      payload: JSON.stringify({ markdown, lookupOperations: ['lookup:legacy'], pythonOperations: [] }) });
    await service.checkpoint({ ...leased, operationId: 'main', kind: 'main',
      payload: markdown.replace('system_order_chunk', 'system_order') + '\n\n## notes\n\n已保存的主 agent 補充。' });
    await service.interruptRun(leased);
    const model = createModel();
    const result = await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    expect(model).not.toHaveBeenCalled();
    expect(result.markdown).toContain('## notes\n\n已保存的主 agent 補充。');
    expect(result.markdown!.indexOf('## notes')).toBeLessThan(result.markdown!.indexOf('## quote_summary'));
  });

  it('publishes the complete backend table before asking main for review-only output', async () => {
    await prepareRun(31);
    const onTextDelta = jest.fn(async (_text: string) => undefined);
    const publishFinal = jest.fn(async (_result: { markdown: string }) => undefined);
    const baseModel = createModel();
    const model = jest.fn(async (input: QuotationModelInput) => {
      if (input.role !== 'main') return baseModel(input);
      const payload = JSON.parse(input.input);
      expect(payload).not.toHaveProperty('chunks');
      expect(parseMarkdownTables(payload.system_order)[0]!.rows).toHaveLength(31);
      expect(onTextDelta.mock.calls[0]![0]).toContain(payload.system_order + '\n\n## customer_quote');
      expect(input.onTextDelta).toEqual(expect.any(Function));
      return { markdown: '無待複核事項。', lookups: [], pythonEvidence: [] };
    });
    await runQuotationPreflight(runnerInput(model, createLookupExecutor(), { onTextDelta, publishFinal }));
    const final = publishFinal.mock.calls[0]![0] as unknown as { markdown: string };
    expect(final.markdown.match(/## system_order/g)).toHaveLength(1);
    expect(parseMarkdownTables(final.markdown)[0]!.rows).toHaveLength(31);
    expect(final.markdown).toContain('## customer_quote');
    expect(final.markdown).not.toContain('manual_reviews_chunk');
  });

  it.each([false, true])('shares the normalized aggregate across preview, review, and final output (legacy checkpoint: %s)', async (legacyCheckpoint) => {
    const run = await prepareRun(25, 24);
    if (legacyCheckpoint) {
      const lease = (await service.acquireLease({ scope, runId: run.runId }))!;
      const leased = { scope, runId: run.runId, leaseToken: lease.leaseToken };
      await service.checkpoint({ ...leased, operationId: 'system-order', kind: 'main', payload: 'legacy unnormalized aggregate' });
      await service.interruptRun(leased);
    }
    const previews: string[] = [];
    let reviewedOrder = '';
    const baseModel = createModel({ onMainInput: (input) => {
      reviewedOrder = JSON.parse(input).system_order;
      expect(previews).toHaveLength(1);
      expect(previews[0]).toContain(reviewedOrder + '\n\n## customer_quote');
      const rows = parseMarkdownTables(reviewedOrder)[0]!.rows;
      expect(rows).toHaveLength(25);
      for (const row of rows) {
        expect(row[4]).toBe('2');
        expect(row[7]).toBe('1234.50');
        expect(row[8]).toBe('2');
        expect(row[10]).toBe('6');
      }
    } });
    const model = async (input: QuotationModelInput) => {
      const result = await baseModel(input);
      if (input.role === 'main') return result;
      const rows = parseMarkdownTables(result.markdown)[0]!.rows.map((row) => {
        const updated = [...row];
        updated[4] = '2支';
        updated[7] = '1,234.50元';
        updated[8] = 'B';
        updated[10] = '6 mm';
        return updated;
      });
      return { ...result, markdown: childMarkdown(rows) };
    };
    const result = await runQuotationPreflight(runnerInput(model, createLookupExecutor(), {
      onTextDelta: async (text) => { previews.push(text); },
    }));
    expect(result.status).toBe('completed');
    expect(result.markdown!.startsWith(reviewedOrder + '\n\n## customer_quote')).toBe(true);
    expect(result.markdown).not.toMatch(/2支|1,234\.50元|6 mm/);
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'system-order:normalized' }))
      .toBe(reviewedOrder);
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'final' })).toBe(result.markdown);
    if (legacyCheckpoint) {
      expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'system-order' }))
        .toBe('legacy unnormalized aggregate');
    }
  });

  it('keeps main review text unchecked, places notes after reviews, and appends the backend summary last', async () => {
    await prepareRun(1);
    const baseModel = createModel();
    const raw = '## notes\n\n主 agent 補充。\n\n## manual_reviews\n\n保留這段未使用表格的模型輸出。';
    const model = jest.fn(async (input: QuotationModelInput) => input.role === 'main'
      ? { markdown: raw, lookups: [], pythonEvidence: [] } : baseModel(input));
    const result = await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    expect(result.status).toBe('completed');
    expect(model.mock.calls.filter(([input]) => input.role === 'main')).toHaveLength(1);
    expect(model.mock.calls.find(([input]) => input.role === 'main')![0]).not.toHaveProperty('validateMainOutput');
    const markdown = result.markdown!;
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(['system_order', 'customer_quote', 'manual_reviews', 'notes', 'quote_summary']);
    expect(markdown).toContain('保留這段未使用表格的模型輸出。');
    expect(markdown).toContain('主 agent 補充。');
    expect(markdown).toContain('查價輸出完成：共 1 筆 system_order。');
    expect(markdown.endsWith('項次核對：材料項次 1／原始訂單 1 項；加工列 0 筆。')).toBe(true);
  });

  it('counts non-processing items against the original order separately from processing rows in the backend summary', async () => {
    await prepareRun(2);
    const baseModel = createModel();
    const model = jest.fn(async (input: QuotationModelInput) => {
      const result = await baseModel(input);
      if (input.role !== 'child') return result;
      const rows = parseMarkdownTables(result.markdown)[0]!.rows;
      const processing = Array.from({ length: systemHeaders.length }, () => '');
      processing[systemHeaders.indexOf('類別')] = '加工/孔';
      processing[systemHeaders.indexOf('備註')] = 'F1／P1；查無加工價格';
      return { ...result, markdown: childMarkdown([rows[0]!, processing, processing, rows[1]!]) };
    });
    const result = await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    const summary = result.markdown!.split('## quote_summary\n\n')[1];
    expect(summary).toContain('共 4 筆 system_order');
    expect(summary).toContain('材料項次 2／原始訂單 2 項；加工列 2 筆');
  });

  it('streams the backend table during aggregation and publishes the finalized review result', async () => {
    await prepareRun(1);
    const progress: QuotationProgress[] = [];
    const publishFinal = jest.fn(async () => undefined);
    const onTextDelta = jest.fn(async (text: string) => {
      const state = await service.readState(scope);
      expect(state?.activeRun?.status).toBe(text.includes('## quote_summary') ? 'finalizing' : 'aggregating');
      expect(state?.activeRun?.chunks.every((chunk) => chunk.status === 'completed')).toBe(true);
      expect(publishFinal).not.toHaveBeenCalled();
    });
    await runQuotationPreflight({
      ...runnerInput(createModel({ streamMain: true }), createLookupExecutor(), { publishFinal, onTextDelta }),
      onProgress: async (value) => { progress.push(value); },
    });
    expect(onTextDelta.mock.calls).toHaveLength(4);
    expect(progress.filter((value) => value.stage === 'main_streaming')).toHaveLength(1);
    expect(publishFinal).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining('## customer_quote') }));
    expect(publishFinal).toHaveBeenCalledTimes(1);
  });
  it('awaits delayed review delivery before its next delta, summary, and final replacement', async () => {
    await prepareRun(1);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const delivered: string[] = [];
    const baseModel = createModel();
    const reviewParts = ['## manual_reviews\n\n需確認', '尺寸。\n\n## notes\n\n備註。'];
    const model = async (input: QuotationModelInput) => {
      if (input.role !== 'main') return baseModel(input);
      expect(delivered[0]).toContain('## customer_quote');
      const first = input.onTextDelta!(reviewParts[0]!);
      const second = input.onTextDelta!(reviewParts[1]!);
      await Promise.all([first, second]);
      return { markdown: reviewParts.join(''), lookups: [], pythonEvidence: [] };
    };
    const publishFinal = jest.fn(async ({ markdown }: { markdown: string }) => {
      expect(delivered.at(-1)).toContain('## quote_summary');
      expect(delivered.join('')).toBe(markdown);
    });
    const execution = runQuotationPreflight(runnerInput(model, createLookupExecutor(), {
      publishFinal,
      onTextDelta: async (text) => {
        if (text.includes('## manual_reviews')) { started(); await gate; }
        delivered.push(text);
      },
    }));
    await entered;
    try {
      expect(delivered).toHaveLength(1);
      expect(publishFinal).not.toHaveBeenCalled();
    } finally { release(); }
    await expect(execution).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
    expect(delivered).toHaveLength(4);
    expect(delivered[1]).toBe('\n\n' + reviewParts[0]);
    expect(delivered[2]).toBe(reviewParts[1]);
    expect(publishFinal).toHaveBeenCalledTimes(1);
  });

  it.each(['cancel', 'transport failure'])('does not save a partial review on %s and resumes without repeating child lookup', async (failure) => {
    const run = await prepareRun(1);
    const controller = new AbortController();
    const executeLookup = createLookupExecutor();
    const publishFinal = jest.fn(async () => undefined);
    await expect(runQuotationPreflight(runnerInput(createModel({ streamMain: true }), executeLookup, {
      signal: controller.signal, publishFinal,
      onTextDelta: async (text) => {
        if (!text.includes('## manual_reviews')) return;
        if (failure === 'cancel') controller.abort(new Error('review cancelled'));
        else throw new Error('review transport failed');
      },
    }))).rejects.toThrow(failure === 'cancel' ? 'review cancelled' : 'review transport failed');
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'main-reviews' })).toBeUndefined();
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'final' })).toBeUndefined();
    expect(publishFinal).not.toHaveBeenCalled();
    const delivered: string[] = [];
    await runQuotationPreflight(runnerInput(createModel({ streamMain: true }), executeLookup, {
      publishFinal, onTextDelta: async (text) => { delivered.push(text); },
    }));
    expect(executeLookup).toHaveBeenCalledTimes(1);
    expect(delivered[0]).toContain('## customer_quote');
    expect(delivered.join('').match(/## manual_reviews/g)).toHaveLength(1);
    expect(delivered.at(-1)).toContain('## quote_summary');
  });

  it('resumes after backend table delivery fails without repeating child work', async () => {
    const run = await prepareRun(1);
    const executeLookup = createLookupExecutor();
    const publishFinal = jest.fn(async () => undefined);
    const onTextDelta = jest.fn().mockRejectedValue(new Error('stream disconnected'));
    await expect(runQuotationPreflight(runnerInput(createModel({ streamMain: true }), executeLookup, {
      publishFinal, onTextDelta,
    }))).rejects.toThrow('stream disconnected');
    const interrupted = await service.readState(scope);
    expect(interrupted?.activeRun?.status).toBe('interrupted');
    expect(interrupted?.activeRun?.chunks[0]?.status).toBe('completed');
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'main' })).toBeUndefined();
    expect(publishFinal).not.toHaveBeenCalled();
    await runQuotationPreflight(runnerInput(createModel(), executeLookup, { publishFinal }));
    expect(executeLookup).toHaveBeenCalledTimes(1);
    expect(publishFinal).toHaveBeenCalledTimes(1);
  });
  it('starts fresh work as running and reports distinct child checkpoints without fake recovery', async () => {
    const run = await prepareRun(31);
    expect(await readQuotationHistory({ scope, runId: run.runId })).toEqual(createSteelNativeHistory());
    const progress: QuotationProgress[] = [];
    const model = createModel({ onChild: async (input) => {
      expect((await service.readState(scope))?.activeRun?.status).toBe('running');
      const rows = parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows;
      await input.lookup?.('lookup', { queries: [{ queryId: 'q1' }] });
      return { markdown: childMarkdown(rows.map(systemRowFromSourceRow)), lookups: [], pythonEvidence: [] };
    } });
    await runQuotationPreflight({ ...runnerInput(model, createLookupExecutor()), onProgress: async (event) => { progress.push(event); } });
    expect(progress.map(({ stage, run: active, chunkIndex, completedChunks }) => [stage ?? active.status, active.status, chunkIndex, completedChunks])).toEqual([
      ['started', 'running', undefined, 0],
      ['chunk_started', 'running', 1, 0],
      ['chunk_saved', 'running', 1, 1],
      ['chunk_started', 'running', 2, 1],
      ['chunk_saved', 'running', 2, 2],
      ['aggregating', 'aggregating', undefined, 2],
      ['main_review_started', 'aggregating', undefined, 2],
      ['finalizing', 'finalizing', undefined, 2],
      ['completed', 'completed', undefined, 2],
    ]);
  });

  it('checkpoints a failed raw child before its repaired candidate and saves only the repaired chunk', async () => {
    const run = await prepareRun(1);
    const chunk = buildQuotationChunks(orderMarkdown(1), 30)[0]!;
    const valid = childMarkdown(chunk.sourceRows.map(systemRow));
    const malformed = `${valid}\n| 未完成`;
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup-1', args: { queries: [{ queryId: 'q1' }] } }], response_metadata: { finish_reason: 'tool_calls' } }),
      new AIMessageChunk({ content: malformed, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup-repair', args: { queries: [{ queryId: 'q1' }] } }], response_metadata: { finish_reason: 'tool_calls' } }),
      new AIMessageChunk({ content: valid, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: '無待複核事項。', response_metadata: { finish_reason: 'stop' } }),
    ]);
    const executeLookup = createLookupExecutor();
    const progress: QuotationProgress[] = [];
    await expect(runQuotationPreflight({ ...runnerInput(invokeQuotationModel, executeLookup), onProgress: async (event) => {
      progress.push(event);
      if (event.stage?.startsWith('chunk_repair_')) {
        const current = await service.readState(scope);
        expect(current?.activeRun?.checkpointRefs.some((ref) => ref.operationId.endsWith(`:${event.stage}`))).toBe(true);
        expect(current?.activeRun?.chunks[0]?.status).toBe('pending');
      }
    } })).resolves.toEqual(
      expect.objectContaining({ status: 'completed' }),
    );

    const state = await service.readState(scope);
    const rawRefs = state?.activeRun?.checkpointRefs.filter((ref) => ref.operationId.startsWith('child-output:1:')) ?? [];
    expect(rawRefs).toHaveLength(3);
    const rawCandidates = await Promise.all(rawRefs.slice(0, 2).map((ref) => service.readCheckpoint({
      scope, runId: run.runId, operationId: ref.operationId,
    })));
    expect((JSON.parse(rawCandidates[0]!) as { markdown: string }).markdown).toBe(malformed);
    expect((JSON.parse(rawCandidates[1]!) as { markdown: string }).markdown).toBe(valid);
    const savedChunk = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' });
    expect((JSON.parse(savedChunk!) as { markdown: string }).markdown).toBe(valid);
    expect(savedChunk).not.toContain(malformed);
    expect(executeLookup).toHaveBeenCalledTimes(2);
    expect(providerInvoke).toHaveBeenCalledTimes(5);
    expect(oauthFactory).toHaveBeenCalledTimes(3);
    expect(progress.filter((event) => event.stage?.startsWith('chunk_repair_')).map((event) => [event.stage, event.repairAttempt])).toEqual([]);
    const history = await readQuotationHistory({ scope, runId: run.runId });
    expect(history.activityEvents.filter((event) => event.type === 'quotation_status' && event.stage.startsWith('chunk_repair_'))).toEqual([]);
  });

  it('saves a canonical chunk without another AI generation when only its closing delimiter is missing', async () => {
    const run = await prepareRun(1);
    const row = [...systemRow(buildQuotationChunks(orderMarkdown(1), 30)[0]!.sourceRows[0]!)];
    row[15] = 'F1 P1';
    const valid = childMarkdown([row]);
    const missingDelimiter = valid.slice(0, -1);
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup-format', args: {} }], response_metadata: { finish_reason: 'tool_calls' } }),
      new AIMessageChunk({ content: missingDelimiter, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: '無待複核事項。', response_metadata: { finish_reason: 'stop' } }),
    ]);
    await runQuotationPreflight(runnerInput(invokeQuotationModel, createLookupExecutor()));
    expect(providerInvoke).toHaveBeenCalledTimes(3);
    const saved = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' });
    expect(JSON.parse(saved!).markdown).toBe(valid);
    const state = await service.readState(scope);
    const rawRef = state!.activeRun!.checkpointRefs.find((ref) => ref.operationId.startsWith('child-output:1:'))!;
    const raw = await service.readCheckpoint({ scope, runId: run.runId, operationId: rawRef.operationId });
    expect(JSON.parse(raw!).markdown).toBe(missingDelimiter);
  });

  it('checkpoints main Python results separately from child evidence', async () => {
    const run = await prepareRun(1);
    const model = createModel();
    const evidence = { type: 'tool-result' as const, toolCallId: 'python-main', payload: '{"output":"checked"}' };
    await runQuotationPreflight(runnerInput(async (input) => {
      if (input.role === 'main') await input.onPythonEvidence?.(evidence);
      return model(input);
    }, createLookupExecutor()));
    const state = await service.readState(scope);
    const ref = state!.activeRun!.checkpointRefs.find((entry) => entry.operationId.startsWith('python:main:'))!;
    expect(ref.kind).toBe('tool');
    expect(JSON.parse((await service.readCheckpoint({ scope, runId: run.runId, operationId: ref.operationId }))!)).toEqual(evidence);
    const child = JSON.parse((await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' }))!);
    expect(child.pythonOperations).toEqual([]);
  });

  it('repairs a legacy failed output from clean input with a fresh lookup', async () => {
    const run = await prepareRun(1);
    const lease = await service.acquireLease({ scope, runId: run.runId });
    const leased = { scope, runId: run.runId, leaseToken: lease!.leaseToken };
    const lookupKey = 'lookup:1:legacy:lookup-old';
    await service.checkpoint({ ...leased, operationId: lookupKey, kind: 'tool', payload: JSON.stringify({
      lookupCallId: 'lookup-old', arguments: { queries: [{ queryId: 'old-query' }] }, result: lookupResult(),
    }) });
    const valid = childMarkdown(buildQuotationChunks(orderMarkdown(1), 30)[0]!.sourceRows.map(systemRow));
    const broken = `${valid}\n| interrupted output`;
    await service.checkpoint({ ...leased, operationId: 'child-output:1:legacy', kind: 'main', payload: JSON.stringify({
      markdown: broken, lookupOperations: [lookupKey], pythonOperations: [],
    }) });
    await service.interruptRun(leased);
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup-new', args: { queries: [{ queryId: 'fresh-query' }] } }], response_metadata: { finish_reason: 'tool_calls' } }),
      new AIMessageChunk({ content: valid, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: '無待複核事項。', response_metadata: { finish_reason: 'stop' } }),
    ]);
    const executeLookup = createLookupExecutor();
    await runQuotationPreflight(runnerInput(invokeQuotationModel, executeLookup));
    expect(executeLookup).toHaveBeenCalledTimes(1);
    const resumed = providerInvoke.mock.calls[0]![0];
    expect(resumed[1].content).toContain('P1');
    expect(resumed[1].content).toContain('C1');
    expect(resumed).toHaveLength(2);
    expect(JSON.stringify(resumed)).not.toContain('old-query');
    expect(JSON.stringify(resumed)).not.toContain(broken);
    const savedRaw = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'child-output:1:legacy' });
    expect(JSON.parse(savedRaw!).markdown).toBe(broken);
    expect((await service.readState(scope))?.activeRun?.status).toBe('completed');
  });

  async function prepareCustomer(responseId = 'response-1', tier = 'C') {
    const state = await service.setOrder({ scope, fullMarkdown: orderMarkdown(31) });
    const result = await bindQuotationCustomerResult({
      scope, messageId: `user-${responseId}`, responseId,
      expectedOrderHash: state.currentOrder!.sha256,
      expectedCustomerPreparationId: state.currentCustomer?.preparationId,
      result: { ok: true, toolName: 'search_customers', durationMs: 1, redactionVersion: 1,
        data: { customers: [{ id: 1, erpCustomerCode: 'C1', displayName: '測試客戶', customerTier: tier }] } },
    });
    if (!result.ok) throw new Error('Customer setup failed');
    return `${String(result.data.customerDataMarkdown)}\n\n${quotationSignal}`;
  }

  it('accepts a later signal-only response using the saved customer and current turn snapshot', async () => {
    const response = await prepareCustomer();
    const customerOnly = response.replace(`\n\n${quotationSignal}`, '');
    await expect(acceptQuotationResponse({ scope, response: customerOnly, responseId: 'response-1', finishReason: 'stop' })).resolves.toBeUndefined();
    const state = await service.readState(scope);
    expect(state?.nextSignalIndex).toBe(0);
    const run = await acceptQuotationResponse({ scope, response: quotationSignal, responseId: 'confirmation-response',
      messageId: 'confirmation-user', expectedOrderHash: state?.currentOrder?.sha256,
      expectedCustomerPreparationId: state?.currentCustomer?.preparationId, finishReason: 'stop' });
    expect(run?.index).toBe(1);
    expect(run?.chunks.map((chunk) => chunk.sourceRowCount)).toEqual([24, 7]);
    expect(run?.triggerMessageId).toBe('confirmation-user');
  });

  it('accepts a fresh signal for a resubmitted quotation request after completion and keeps replay idempotent', async () => {
    const response = await prepareCustomer();
    const first = (await acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'stop' }))!;
    await runQuotationPreflight(runnerInput(createModel(), createLookupExecutor()));
    expect(await service.hasSystemOrder(scope)).toBe(true);
    const prepared = await prepareQuotationTurn({
      scope, messageId: first.triggerMessageId!, responseId: 'rerun-response', text: '依目前 OCR 彙整表開始報價',
    });
    expect(prepared.resume).toBe(false);
    expect(prepared.instruction).toContain(JSON.stringify({ hasOcrResult: true, hasCustomerData: true,
      hasSystemOrder: true, shouldAskToQuote: false }));
    const request = { scope, response: quotationSignal, responseId: 'rerun-response',
      messageId: first.triggerMessageId, expectedOrderHash: prepared.state.currentOrder?.sha256,
      expectedCustomerPreparationId: prepared.state.currentCustomer?.preparationId, finishReason: 'stop' };
    const next = (await acceptQuotationResponse(request))!;
    expect(next.runId).not.toBe(first.runId);
    expect(next.index).toBe(first.index + 1);
    expect(next.chunks.every((chunk) => chunk.status === 'pending')).toBe(true);
    expect(await service.hasSystemOrder(scope)).toBe(false);
    expect((await acceptQuotationResponse(request))?.runId).toBe(next.runId);
  });

  it('waits for an AI signal and resumes the same interrupted run without issuing another ticket', async () => {
    const response = await prepareCustomer();
    const first = (await acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'stop' }))!;
    const lease = await service.acquireLease({ scope, runId: first.runId });
    await service.interruptRun({ scope, runId: first.runId, leaseToken: lease!.leaseToken,
      interruption: { reason: 'paused' } });
    const prepared = await prepareQuotationTurn({ scope, messageId: 'continue-user',
      responseId: 'continue-response', text: '請繼續處理這份報價' });
    expect(prepared.resume).toBe(false);
    const request = { scope, responseId: 'continue-response', messageId: 'continue-user',
      expectedOrderHash: prepared.state.currentOrder?.sha256,
      expectedCustomerPreparationId: prepared.state.currentCustomer?.preparationId, finishReason: 'stop' };
    await expect(acceptQuotationResponse({ ...request, response: '這份報價尚未完成。' })).resolves.toBeUndefined();
    await expect(acceptQuotationResponse({ ...request, response: quotationSignal,
      expectedOrderHash: 'stale' })).rejects.toThrow('stale preparation');
    const accepted = await Promise.all([1, 2].map(() => acceptQuotationResponse({ ...request, response: quotationSignal })));
    expect(accepted.map((run) => run?.runId)).toEqual([first.runId, first.runId]);
    const state = await service.readState(scope);
    expect(state?.nextSignalIndex).toBe(first.index);
    expect(state?.tickets).toHaveLength(1);
    expect(state?.pendingMessages).toHaveLength(0);
    expect(state?.activeRun?.interruption?.reason).toBe('paused');
    const concurrent = await Promise.all([1, 2].map(() => service.acquireLease({ scope, runId: first.runId })));
    expect(concurrent.filter(Boolean)).toHaveLength(1);
  });

  it.each([false, true])('durably queues changed inputs before continuing a frozen run (mixed signal=%s)', async (mixedSignal) => {
    const response = await prepareCustomer();
    const first = (await acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'stop' }))!;
    const state = await service.readState(scope);
    const files = [{ fileId: 'original-file', filename: 'revision.pdf', mediaType: 'application/pdf' }];
    const accepted = await acceptQuotationResponse({ scope,
      response: `${orderMarkdown(2)}${mixedSignal ? `\n\n${quotationSignal}` : ''}`,
      responseId: 'correction-response', messageId: 'correction-user', messageText: '改用附件的訂單', messageFiles: files,
      expectedOrderHash: state?.currentOrder?.sha256,
      expectedCustomerPreparationId: state?.currentCustomer?.preparationId, finishReason: 'stop' });
    expect(accepted?.runId).toBe(first.runId);
    const after = await service.readState(scope);
    expect(after?.currentOrder?.sha256).toBe(state?.currentOrder?.sha256);
    expect(after?.nextSignalIndex).toBe(first.index);
    expect(after?.pendingMessages).toEqual([expect.objectContaining({ sourceMessageId: 'correction-user',
      sourceMessageText: '改用附件的訂單', sourceMessageFiles: files, targetMessageId: 'correction-response' })]);
  });

  it('persists explicit default-B Markdown before OCR and retains it for later quotation', async () => {
    const output = { scope, response: defaultQuotationCustomerMarkdown, responseId: 'default-b-response', messageId: 'default-b-user' };
    await expect(acceptQuotationResponse({ ...output, finishReason: 'length' })).resolves.toBeUndefined();
    expect((await service.readState(scope))?.currentCustomer).toBeUndefined();
    await Promise.all([1, 2].map(() => acceptQuotationResponse({ ...output, finishReason: 'stop' })));
    const first = await service.readState(scope);
    expect(first?.currentCustomer?.customerIdentity).toBe('explicit-default:B');
    expect(first?.currentCustomer?.customerMarkdown).toBe(defaultQuotationCustomerMarkdown);
    expect(first?.nextSignalIndex).toBe(0);
    expect(quotationPreparationStatus(first?.currentOrder?.markdown, first?.currentCustomer?.customerMarkdown)).toEqual({
      hasOcrResult: false, hasCustomerData: true, hasSystemOrder: false, shouldAskToQuote: false,
    });
    await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    const prepared = await service.readState(scope);
    expect(prepared?.currentCustomer?.preparationId).toBe(first?.currentCustomer?.preparationId);
    const run = await acceptQuotationResponse({ scope, response: quotationSignal, responseId: 'quote-after-ocr',
      messageId: 'confirmed-order', expectedOrderHash: prepared?.currentOrder?.sha256,
      expectedCustomerPreparationId: prepared?.currentCustomer?.preparationId, finishReason: 'stop' });
    expect(run?.index).toBe(1);
    const snapshot = await service.readArtifact({ scope, ref: run!.snapshotRef });
    expect((JSON.parse(snapshot!) as { customerMarkdown: string }).customerMarkdown).toBe(defaultQuotationCustomerMarkdown);
  });

  it('rejects a stale confirmation after the customer or order changed', async () => {
    await prepareCustomer();
    const first = await service.readState(scope);
    const input = { scope, response: quotationSignal, responseId: 'later-confirmation', messageId: 'confirm-user',
      expectedOrderHash: first?.currentOrder?.sha256, expectedCustomerPreparationId: first?.currentCustomer?.preparationId,
      finishReason: 'stop' };
    await prepareCustomer('new-customer-response', 'D');
    await expect(acceptQuotationResponse(input)).rejects.toThrow('stale preparation');
    const next = await service.readState(scope);
    await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    await expect(acceptQuotationResponse({ ...input, expectedCustomerPreparationId: next?.currentCustomer?.preparationId })).rejects.toThrow('stale preparation');
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);
  });

  it('rejects stale or fabricated customer Markdown without allocating a quotation', async () => {
    await prepareCustomer();
    await expect(acceptQuotationResponse({ scope, response: defaultQuotationCustomerMarkdown,
      responseId: 'stale-default', messageId: 'stale-user', finishReason: 'stop' })).rejects.toThrow('stale preparation');
    await expect(acceptQuotationResponse({ scope, response: defaultQuotationCustomerMarkdown.replace('| B |', '| A |'),
      responseId: 'forged', messageId: 'forged-user', finishReason: 'stop' })).rejects.toThrow('saved customer lookup');
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);
  });

  it('saves customer Markdown without an index and admits concurrent delivery only once', async () => {
    const response = await prepareCustomer();
    const prepared = await service.readState(scope);
    expect(prepared?.nextSignalIndex).toBe(0);
    expect(prepared?.currentCustomer?.customerMarkdown).toContain('| C |');
    const runs = await Promise.all(Array.from({ length: 2 }, () => acceptQuotationResponse({
      scope, response, responseId: 'response-1', finishReason: 'stop',
    })));
    expect(runs[0]?.runId).toBe(runs[1]?.runId);
    expect((await service.readState(scope))?.nextSignalIndex).toBe(1);
    const model = createModel();
    await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    const children = model.mock.calls.filter(([input]) => input.role === 'child');
    expect(children).toHaveLength(2);
    for (const [input] of children) {
      expect((JSON.parse(input.input) as { customer: string }).customer).toBe(prepared?.currentCustomer?.customerMarkdown);
    }
  });

  it('does not allocate an index for missing, mismatched, stale or unfinished response data', async () => {
    const response = await prepareCustomer();
    await expect(acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'length' })).resolves.toBeUndefined();
    for (const invalid of [
      quotationSignal,
      response.replace('| C |', '| A |'),
      ...['## ocr_result', '  ## ocr_result', '## ocr_result ##'].map((heading) =>
        `${orderMarkdown(1).replace('## ocr_result', heading)}\n\n${response}`),
    ]) {
      await expect(acceptQuotationResponse({ scope, response: invalid, responseId: 'response-1', finishReason: 'stop' })).rejects.toThrow();
    }
    await expect(acceptQuotationResponse({ scope, response, responseId: 'other-response', finishReason: 'stop' })).rejects.toThrow();
    await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    await expect(acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'stop' })).rejects.toThrow();
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);
  });

  it('invalidates a successful customer selection when a later lookup is unresolved', async () => {
    const response = await prepareCustomer();
    const state = await service.readState(scope);
    await bindQuotationCustomerResult({ scope, messageId: 'user-response-1', responseId: 'response-1',
      expectedOrderHash: state!.currentOrder!.sha256,
      expectedCustomerPreparationId: state?.currentCustomer?.preparationId,
      result: { ok: true, toolName: 'search_customers', durationMs: 1, redactionVersion: 1, data: { customers: [{ id: 1 }, { id: 2 }] } },
    });
    await expect(acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'stop' })).rejects.toThrow();
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);
  });

  it.each(['failure', 'multiple', 'unique'])('rejects a delayed older customer lookup with %s after a newer selection', async (outcome) => {
    await prepareCustomer('older-response', 'C');
    const beforeLookup = await service.readState(scope);
    await prepareCustomer('newer-response', 'D');
    const newer = await service.readState(scope);
    const result: SteelToolResult = outcome === 'failure'
      ? { ok: false, toolName: 'search_customers', durationMs: 1, redactionVersion: 1, errorCategory: 'repository_error', errorSummary: 'offline' }
      : { ok: true, toolName: 'search_customers', durationMs: 1, redactionVersion: 1,
          data: { customers: outcome === 'multiple' ? [{ id: 1 }, { id: 2 }] : [{ id: 1, customerTier: 'C' }] } };
    await expect(bindQuotationCustomerResult({ scope, messageId: 'older-user', responseId: 'older-response',
      expectedOrderHash: beforeLookup!.currentOrder!.sha256,
      expectedCustomerPreparationId: beforeLookup?.currentCustomer?.preparationId, result,
    })).rejects.toThrow('stale preparation');
    await expect(acceptQuotationResponse({ scope, response: quotationSignal, responseId: 'older-response',
      messageId: 'older-user', expectedOrderHash: beforeLookup!.currentOrder!.sha256,
      expectedCustomerPreparationId: beforeLookup?.currentCustomer?.preparationId, finishReason: 'stop',
    })).rejects.toThrow('stale preparation');
    const after = await service.readState(scope);
    expect(after?.currentCustomer).toEqual(newer?.currentCustomer);
    expect(after?.nextSignalIndex).toBe(0);
    expect(after?.activeRun).toBeUndefined();
  });

  it('keeps a cancelled signal replay terminal and allocates a fresh index for a new response', async () => {
    const response = await prepareCustomer();
    const first = await acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'stop' });
    await service.cancelRun({ scope, runId: first!.runId });
    const replay = await acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'stop' });
    expect(replay?.status).toBe('cancelled');
    expect((await service.readState(scope))?.nextSignalIndex).toBe(1);
    const nextResponse = await prepareCustomer('response-2', 'D');
    const next = await acceptQuotationResponse({ scope, response: nextResponse, responseId: 'response-2', finishReason: 'stop' });
    expect(next?.index).toBe(2);
    expect(next?.runId).not.toBe(first?.runId);
  });

  it('reuses completed chunks after an interrupted child and runs only the pending chunk', async () => {
    const run = await prepareRun(31);
    let failSecondChunk = true;
    const controller = new AbortController();
    const mainInputs: string[] = [];
    const invokeModel = createModel({
      onMainInput: (input) => mainInputs.push(input),
      onChild: async (input) => {
        const rows = parseMarkdownTables((JSON.parse(input.input) as { chunk: string }).chunk)[0]!.rows;
        await input.lookup?.(`lookup-${rows[0]![1]}`, { queries: [] });
        return {
          markdown: childMarkdown(rows.map(systemRowFromSourceRow)),
          lookups: [],
          pythonEvidence: [],
        };
      },
      failChunk: (chunkIndex) => {
        if (chunkIndex !== 2 || !failSecondChunk) return false;
        failSecondChunk = false;
        controller.abort(new Error('child call 2 paused'));
        return true;
      },
    });
    const executeLookup = createLookupExecutor();
    await expect(runQuotationPreflight(runnerInput(invokeModel, executeLookup, { signal: controller.signal }))).rejects.toThrow('child call 2 paused');
    const interrupted = await service.readState(scope);
    expect(interrupted?.activeRun?.status).toBe('interrupted');
    expect(interrupted?.activeRun?.chunks.map((chunk) => chunk.status)).toEqual(['completed', 'pending']);
    const saved = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' });
    expect((JSON.parse(saved!) as { markdown: string }).markdown).not.toContain('manual_reviews_chunk');
    const callsAfterFailure = invokeModel.mock.calls.length;

    const completed = await runQuotationPreflight(runnerInput(invokeModel, executeLookup));
    expect(completed.status).toBe('completed');
    expect(invokeModel.mock.calls.length).toBe(callsAfterFailure + 2);
    const childInputs = invokeModel.mock.calls
      .filter(([input]) => input.role === 'child')
      .map(([input]) => JSON.parse(input.input) as { chunk: string; customer: string });
    expect(childInputs).toHaveLength(3);
    expect(childInputs.every((payload) => !/sourceRows|sourceRowId|quote_lineage/iu.test(JSON.stringify(payload)))).toBe(true);
    expect(childInputs.map((payload) => Object.keys(payload).sort())).toEqual([
      ['chunk', 'customer'], ['chunk', 'customer'], ['chunk', 'customer'],
    ]);
    expect(childInputs.map((payload) => parseMarkdownTables(payload.chunk)[0]!.rows.map((row) => row[1]))).toEqual([
      Array.from({ length: 30 }, (_, index) => `P${index + 1}`), ['P31'], ['P31'],
    ]);
    expect(childInputs.every((payload) => payload.customer === customerMarkdown)).toBe(true);
    expect(mainInputs).toHaveLength(1);
    const mainInput = JSON.parse(mainInputs[0]!) as { order: string; customer: string; system_order: string };
    expect(mainInput.order).toBe(orderMarkdown(31));
    expect(mainInput.customer).toBe(customerMarkdown);
    expect(parseMarkdownTables(mainInput.system_order)[0]!.rows).toHaveLength(31);
    expect(mainInput.system_order).not.toContain('manual_reviews_chunk');
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
    expect(interrupted?.activeRun?.checkpointRefs.some((ref) => ref.operationId === 'main-reviews')).toBe(true);
    const callsAfterFailure = invokeModel.mock.calls.length;

    const completed = await runQuotationPreflight(runnerInput(invokeModel, executeLookup, { onProgress }));
    expect(completed.status).toBe('completed');
    expect(invokeModel.mock.calls.length).toBe(callsAfterFailure);
    expect(executeLookup).toHaveBeenCalledTimes(1);
  });

  it('completes a no-data child after a failed structured lookup and gives main only table chunks', async () => {
    await prepareRun(1);
    const mainInputs: string[] = [];
    const invokeModel = createModel({ onMainInput: (input) => mainInputs.push(input) });
    const executeLookup = jest.fn(async () => failedLookupResult());
    const completed = await runQuotationPreflight(runnerInput(invokeModel, executeLookup));
    expect(completed.status).toBe('completed');
    expect(executeLookup).toHaveBeenCalledTimes(1);
    expect(mainInputs).toHaveLength(1);
    expect(mainInputs[0]).not.toContain('quote_lineage');
    expect(mainInputs[0]).not.toContain('sourceRowId');
    expect(mainInputs[0]).toContain('## system_order');
    expect(mainInputs[0]).not.toContain('system_order_chunk');
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
    const onHistory = jest.fn(async (_history: SteelNativeHistory) => undefined);
    const recovered = await runQuotationPreflight({ ...runnerInput(invokeModel, executeLookup, { publishFinal }), onHistory });
    expect(recovered.status).toBe('completed');
    expect(invokeModel.mock.calls.length).toBe(callsAfterFailure);
    expect(publishFinal).toHaveBeenCalledTimes(2);
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onHistory.mock.calls[0]?.[0].preflightToolCalls).toEqual([expect.objectContaining({ name: 'search_price_candidates', progress: 1, args: { queries: [{ queryId: 'q1', categories: ['鐵板'] }] } })]);
    expect(onHistory.mock.calls[0]?.[0].activityEvents).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'quotation_status', status: 'completed', completedChunks: 1, totalChunks: 1 })]));
    expect(onHistory.mock.invocationCallOrder[0]).toBeLessThan(publishFinal.mock.invocationCallOrder[1]!);
    expect((await service.readState(scope))?.activeRun?.checkpointRefs.some((ref) => ref.operationId === 'published')).toBe(true);
  });

  it('restores published quotation tools and global chunk progress idempotently', async () => {
    const run = await prepareRun(31);
    const model = createModel();
    const lookup = createLookupExecutor();
    await runQuotationPreflight(runnerInput(model, lookup));
    const history = await readQuotationHistory({ scope, runId: run.runId });
    expect(history.preflightToolCalls).toHaveLength(2);
    expect(history.activityEvents).toEqual([
      expect.objectContaining({ chunkIndex: 1, completedChunks: 1, totalChunks: 2 }),
      expect.objectContaining({ chunkIndex: 2, completedChunks: 2, totalChunks: 2 }),
      expect.objectContaining({ status: 'completed', completedChunks: 2, totalChunks: 2 }),
    ]);
    const current = createSteelNativeHistory();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const delta = getQuotationHistoryDelta(current, history);
      delta.activityEvents.forEach((event) => appendSteelNativeActivityEvent(current, event));
      delta.preflightToolCalls.forEach((call) => upsertSteelNativePreflightToolCall(current, call));
    }
    expect(current).toEqual(history);
    const publishFinal = jest.fn();
    const onHistory = jest.fn();
    const previousCalls = model.mock.calls.length;
    await runQuotationPreflight({ ...runnerInput(model, lookup, { publishFinal }), onHistory });
    expect(onHistory).toHaveBeenCalledWith(history);
    expect(publishFinal).not.toHaveBeenCalled();
    expect(model).toHaveBeenCalledTimes(previousCalls);
  });

  it('restores actual lookup activity without declaring an interrupted chunk completed', async () => {
    const run = await prepareRun(1);
    const controller = new AbortController();
    const model = createModel({ onChild: async (input) => {
      await input.lookup?.('actual-call', { queries: [{ queryId: 'q1' }] });
      controller.abort(new Error('interrupted after lookup'));
      throw new Error('interrupted after lookup');
    } });
    await expect(runQuotationPreflight(runnerInput(model, createLookupExecutor(), { signal: controller.signal }))).rejects.toThrow('interrupted after lookup');
    const history = await readQuotationHistory({ scope, runId: run.runId });
    expect(history.preflightToolCalls).toEqual([expect.objectContaining({ id: expect.stringContaining(':actual-call'), progress: 1 })]);
    expect(history.activityEvents).toEqual([expect.objectContaining({ status: 'interrupted', completedChunks: 0, totalChunks: 1 })]);
    expect(await readQuotationHistory({ scope: { ...scope, userId: 'another-owner' }, runId: run.runId })).toEqual(createSteelNativeHistory());
    expect(await readQuotationHistory({ scope, runId: 'another-run' })).toEqual(createSteelNativeHistory());
    await service.cancelRun({ scope, runId: run.runId });
    const onHistory = jest.fn();
    await runQuotationPreflight({ ...runnerInput(model, createLookupExecutor()), onHistory });
    expect(onHistory.mock.calls[0]?.[0].activityEvents).toEqual([expect.objectContaining({ status: 'cancelled', completedChunks: 0 })]);
  });
});
