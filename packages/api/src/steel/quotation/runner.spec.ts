import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AIMessageChunk } from '@librechat/agents/langchain/messages';

import type { SteelQuotationScope, SteelQuotationActiveRun } from '@librechat/data-schemas';
import { createOpenAIOAuthModel } from '../native/oauth';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import type { QuotationChunk } from './protocol';
import type { QuotationModelInput, QuotationModelResult } from './model';

import { createSteelQuotationStateService } from './state';
import { buildQuotationChunks, quotationSignal } from './protocol';
import { parseMarkdownTables } from '../markdown/table';
import { invokeQuotationModel } from './model';
import { acceptQuotationResponse, runQuotationPreflight } from './runner';
import type { QuotationProgress } from './runner';
import type { SteelNativeHistory } from '../native/events';
import { createSteelNativeHistory, appendSteelNativeActivityEvent, upsertSteelNativePreflightToolCall } from '../native/events';
import { getQuotationHistoryDelta, readQuotationHistory } from './history';
import { bindQuotationCustomerResult, defaultQuotationCustomerMarkdown, quotationPreparationStatus } from './preparation';

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

function mainMarkdown(order: string): string {
  const rows = buildQuotationChunks(order).flatMap((chunk) => chunk.sourceRows.map(systemRow));
  return `## system_order\n\n${markdownTable(systemHeaders, rows)}`;
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
        await input.onTextDelta?.('## system_order\n');
        await input.onTextDelta?.('preview row\n');
      }
      return {
        markdown: mainMarkdown((JSON.parse(input.input) as { order: string }).order),
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

  it('forwards main text during aggregation once chunks are saved and publishes only the finalized order', async () => {
    await prepareRun(1);
    const progress: QuotationProgress[] = [];
    const publishFinal = jest.fn(async () => undefined);
    const onTextDelta = jest.fn(async () => {
      const state = await service.readState(scope);
      expect(state?.activeRun?.status).toBe('aggregating');
      expect(state?.activeRun?.chunks.every((chunk) => chunk.status === 'completed')).toBe(true);
      expect(publishFinal).not.toHaveBeenCalled();
    });
    await runQuotationPreflight({
      ...runnerInput(createModel({ streamMain: true }), createLookupExecutor(), { publishFinal, onTextDelta }),
      onProgress: async (value) => { progress.push(value); },
    });
    expect(onTextDelta.mock.calls).toHaveLength(2);
    expect(progress.filter((value) => value.stage === 'main_streaming')).toHaveLength(1);
    expect(publishFinal).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining('## customer_quote') }));
    expect(publishFinal).toHaveBeenCalledTimes(1);
  });
  it('keeps streamed partial main output out of checkpoints and resumes without repeating child work', async () => {
    const run = await prepareRun(1);
    const executeLookup = createLookupExecutor();
    const publishFinal = jest.fn(async () => undefined);
    const onTextDelta = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('stream disconnected'));
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
      ['finalizing', 'finalizing', undefined, 2],
      ['completed', 'completed', undefined, 2],
    ]);
  });

  it('checkpoints a failed raw child before its repaired candidate and saves only the repaired chunk', async () => {
    const run = await prepareRun(1);
    const chunk = buildQuotationChunks(orderMarkdown(1))[0]!;
    const valid = childMarkdown(chunk.sourceRows.map(systemRow));
    const malformed = `${valid}\n| 未完成`;
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup-1', args: { queries: [{ queryId: 'q1' }] } }], response_metadata: { finish_reason: 'tool_calls' } }),
      new AIMessageChunk({ content: malformed, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: valid, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: mainMarkdown(orderMarkdown(1)), response_metadata: { finish_reason: 'stop' } }),
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
    expect(executeLookup).toHaveBeenCalledTimes(1);
    expect(providerInvoke).toHaveBeenCalledTimes(4);
    expect(oauthFactory).toHaveBeenCalledTimes(2);
    expect(progress.filter((event) => event.stage?.startsWith('chunk_repair_')).map((event) => [event.stage, event.repairAttempt])).toEqual([
      ['chunk_repair_started', 1], ['chunk_repair_succeeded', 1],
    ]);
    const history = await readQuotationHistory({ scope, runId: run.runId });
    expect(history.activityEvents.filter((event) => event.type === 'quotation_status' && event.stage.startsWith('chunk_repair_'))).toEqual([
      expect.objectContaining({ stage: 'chunk_repair_started', repairAttempt: 1, maxRepairAttempts: 2 }),
      expect.objectContaining({ stage: 'chunk_repair_succeeded', repairAttempt: 1, maxRepairAttempts: 2 }),
    ]);
  });

  it('resumes the pending sibling after repair exhaustion with its persisted conversation and tools', async () => {
    const run = await prepareRun(31);
    const chunks = buildQuotationChunks(orderMarkdown(31));
    const firstValid = childMarkdown(chunks[0]!.sourceRows.map(systemRow));
    const secondValid = childMarkdown(chunks[1]!.sourceRows.map(systemRow));
    const secondMalformed = `${secondValid}\n| 未完成`;
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup-1', args: { queries: [{ queryId: 'q1' }] } }], response_metadata: { finish_reason: 'tool_calls' } }),
      new AIMessageChunk({ content: firstValid, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup-2', args: { queries: [{ queryId: 'q1' }] } }], response_metadata: { finish_reason: 'tool_calls' } }),
      new AIMessageChunk({ content: secondMalformed, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: secondMalformed, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: secondMalformed, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: secondValid, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: mainMarkdown(orderMarkdown(31)), response_metadata: { finish_reason: 'stop' } }),
    ]);
    const executeLookup = createLookupExecutor();

    await expect(runQuotationPreflight(runnerInput(invokeQuotationModel, executeLookup))).rejects.toThrow(
      'incomplete Markdown row',
    );
    const interrupted = await service.readState(scope);
    expect(interrupted?.activeRun?.status).toBe('interrupted');
    expect(interrupted?.activeRun?.chunks.map((chunk) => chunk.status)).toEqual(['completed', 'pending']);
    const failedHistory = await readQuotationHistory({ scope, runId: run.runId });
    expect(failedHistory.activityEvents.filter((event) => event.type === 'quotation_status' && event.stage === 'chunk_repair_failed')).toEqual([
      expect.objectContaining({ repairAttempt: 2, maxRepairAttempts: 2, chunkIndex: 2, message: expect.stringContaining('incomplete Markdown row') }),
    ]);
    const savedFirst = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' });
    expect((JSON.parse(savedFirst!) as { markdown: string }).markdown).toBe(firstValid);
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:2' })).toBeUndefined();
    expect(executeLookup).toHaveBeenCalledTimes(2);
    expect(oauthFactory).toHaveBeenCalledTimes(2);
    const callsAfterFailure = providerInvoke.mock.calls.length;

    await expect(runQuotationPreflight(runnerInput(invokeQuotationModel, executeLookup))).resolves.toEqual(
      expect.objectContaining({ status: 'completed' }),
    );
    expect(providerInvoke).toHaveBeenCalledTimes(callsAfterFailure + 2);
    const resumedMessages = providerInvoke.mock.calls[callsAfterFailure]![0];
    expect(resumedMessages.some((message: { content: unknown }) => message.content === secondMalformed)).toBe(true);
    expect(resumedMessages.some((message: { tool_call_id?: string }) => message.tool_call_id === 'lookup-2')).toBe(true);
    expect(resumedMessages.some((message: { content: unknown }) => message.content === firstValid)).toBe(false);
    expect(executeLookup).toHaveBeenCalledTimes(2);
    expect(oauthFactory).toHaveBeenCalledTimes(4);
    const savedSecond = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:2' });
    expect((JSON.parse(savedSecond!) as { markdown: string }).markdown).toBe(secondValid);
  });

  it('saves a canonical chunk without another AI generation when only its closing delimiter is missing', async () => {
    const run = await prepareRun(1);
    const row = [...systemRow(buildQuotationChunks(orderMarkdown(1))[0]!.sourceRows[0]!)];
    row[15] = 'F1 P1';
    const valid = childMarkdown([row]);
    const missingDelimiter = valid.slice(0, -1);
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({ content: '', tool_calls: [{ name: 'search_price_candidates', id: 'lookup-format', args: {} }], response_metadata: { finish_reason: 'tool_calls' } }),
      new AIMessageChunk({ content: missingDelimiter, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: mainMarkdown(orderMarkdown(1)), response_metadata: { finish_reason: 'stop' } }),
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

  it('resumes a legacy failed output with its original input and durable lookup evidence', async () => {
    const run = await prepareRun(1);
    const lease = await service.acquireLease({ scope, runId: run.runId });
    const leased = { scope, runId: run.runId, leaseToken: lease!.leaseToken };
    const lookupKey = 'lookup:1:legacy:lookup-old';
    await service.checkpoint({ ...leased, operationId: lookupKey, kind: 'tool', payload: JSON.stringify({
      lookupCallId: 'lookup-old', arguments: { queries: [{ queryId: 'old-query' }] }, result: lookupResult(),
    }) });
    const valid = childMarkdown(buildQuotationChunks(orderMarkdown(1))[0]!.sourceRows.map(systemRow));
    const broken = `${valid}\n| interrupted output`;
    await service.checkpoint({ ...leased, operationId: 'child-output:1:legacy', kind: 'main', payload: JSON.stringify({
      markdown: broken, lookupOperations: [lookupKey], pythonOperations: [],
    }) });
    await service.interruptRun(leased);
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({ content: valid, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({ content: mainMarkdown(orderMarkdown(1)), response_metadata: { finish_reason: 'stop' } }),
    ]);
    const executeLookup = createLookupExecutor();
    await runQuotationPreflight(runnerInput(invokeQuotationModel, executeLookup));
    expect(executeLookup).not.toHaveBeenCalled();
    const resumed = providerInvoke.mock.calls[0]![0];
    expect(resumed[1].content).toContain('P1');
    expect(resumed[1].content).toContain('C1');
    expect(resumed[2].tool_calls[0].args.queries[0].queryId).toBe('old-query');
    expect(resumed[3].tool_call_id).toBe('lookup-old');
    expect(resumed[4].content).toBe(broken);
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
    expect(run?.triggerMessageId).toBe('confirmation-user');
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
    const reviews = `## manual_reviews_chunk\n\n${markdownTable(
      ['來源表格', '來源件號 / 項次', '問題欄位', '目前判斷', '需確認內容', '影響範圍'],
      [['F1', 'P1', '單價', '', '確認 P1 價格', '報價']],
    )}`;
    const mainInputs: string[] = [];
    const invokeModel = createModel({
      onMainInput: (input) => mainInputs.push(input),
      onChild: async (input) => {
        const rows = parseMarkdownTables((JSON.parse(input.input) as { chunk: string }).chunk)[0]!.rows;
        await input.lookup?.(`lookup-${rows[0]![1]}`, { queries: [] });
        return {
          markdown: childMarkdown(rows.map(systemRowFromSourceRow)) + (rows[0]![1] === 'P1' ? `\n\n${reviews}` : ''),
          lookups: [],
          pythonEvidence: [],
        };
      },
      failChunk: (chunkIndex) => {
        if (chunkIndex !== 2 || !failSecondChunk) return false;
        failSecondChunk = false;
        return true;
      },
    });
    const executeLookup = createLookupExecutor();
    await expect(runQuotationPreflight(runnerInput(invokeModel, executeLookup))).rejects.toThrow('child call 2 failed');
    const interrupted = await service.readState(scope);
    expect(interrupted?.activeRun?.status).toBe('interrupted');
    expect(interrupted?.activeRun?.chunks.map((chunk) => chunk.status)).toEqual(['completed', 'pending']);
    const saved = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' });
    expect((JSON.parse(saved!) as { markdown: string }).markdown).toContain(reviews);
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
    const mainInput = JSON.parse(mainInputs[0]!) as { order: string; customer: string; chunks: string[] };
    expect(mainInput.order).toBe(orderMarkdown(31));
    expect(mainInput.customer).toBe(customerMarkdown);
    const chunks = mainInput.chunks;
    expect(chunks).toHaveLength(2);
    expect(chunks.filter((chunk) => chunk.includes(reviews))).toHaveLength(1);
    expect(chunks.join('\n').match(/## manual_reviews_chunk/g)).toHaveLength(1);
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
    expect(mainInputs[0]).toContain('## system_order_chunk');
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
    const model = createModel({ onChild: async (input) => {
      await input.lookup?.('actual-call', { queries: [{ queryId: 'q1' }] });
      throw new Error('interrupted after lookup');
    } });
    await expect(runQuotationPreflight(runnerInput(model, createLookupExecutor()))).rejects.toThrow('interrupted after lookup');
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
