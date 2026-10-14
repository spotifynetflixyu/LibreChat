import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { AIMessageChunk } from '@librechat/agents/langchain/messages';
import {
  createSteelCustomerMethods,
  createModels,
  createMethods,
  createSteelQuotationStateModel,
  createSteelQuotationArtifactModel,
} from '@librechat/data-schemas';
import type {
  SteelQuotationScope,
  SteelQuotationActiveRun,
  SteelQuotationPublicationProof,
  SteelQuotationPublicationSaveResult,
  SteelQuotationSavedMessage,
  SteelQuotationSummaryInput,
  SteelQuotationSummaryResult,
  SteelMarkdownAdmission,
} from '@librechat/data-schemas';
import type { SteelToolJsonObject, SteelToolResult } from '../tools/results';
import type { QuotationModelInput, QuotationModelResult } from './model';
import type { QuotationProgress, QuotationRunnerInput } from './runner';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { QuotationChunk } from './protocol';
import {
  bindQuotationCustomerResult,
  commitQuotationCustomerResponse,
  defaultQuotationCustomerMarkdown,
  prepareQuotationTurn,
  quotationPreparationStatus,
  renderQuotationCustomerMarkdown,
} from './preparation';
import {
  createSteelNativeHistory,
  appendSteelNativeActivityEvent,
  upsertSteelNativePreflightToolCall,
} from '../native/events';
import {
  acceptQuotationResponse,
  acceptQuotationSignal,
  hasCompleteSteelFormula,
  runQuotationPreflight,
} from './runner';
import { getQuotationHistoryDelta, readQuotationHistory } from './history';
import { createSteelQuotationPublicationPublisher } from './publication';
import { buildQuotationChunks, quotationSignal } from './protocol';
import { createSteelQuotationMessageNotifier } from './wiring';
import { createSteelQuotationStateService } from './state';
import { createOpenAIOAuthModel } from '../native/oauth';
import { parseMarkdownTables } from '../markdown/table';
import { seedLegacyPublication } from './fixtures';
import { invokeQuotationModel } from './model';
import { quotationStatus } from './routes';
import * as stateModule from './state';

jest.mock('../native/oauth', () => ({ createOpenAIOAuthModel: jest.fn() }));
const oauthFactory = jest.mocked(createOpenAIOAuthModel);

jest.mock('../native/context', () => ({
  buildDefaultSteelGlobalAgentContext: jest.fn(async ({ mode }: { mode: string }) => ({
    instructionPrefix: mode,
  })),
}));

const scope: SteelQuotationScope = {
  userId: 'quotation-runner-user',
  conversationId: '11111111-1111-4111-8111-111111111111',
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
  '零件編號',
  '備註',
];
const customerMarkdown = [
  '## customer_data',
  '',
  '| 客戶編號 | 客戶名稱 | 價格等級 | 說明 |',
  '| --- | --- | --- | --- |',
  '| C1 | 測試客戶 | B | |',
].join('\n');

function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
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
    exactPhysical: { density: '7.85' },
    tierPrices: { A: 11, B: 12, C: 13, D: 14, E: 15, F: 16 },
  };
}

function lookupResult(): SteelToolResult {
  return {
    ok: true,
    toolName: 'search_price_candidates',
    data: {
      queryResults: [
        {
          queryId: 'q1',
          status: 'ok',
          candidates: [candidate()],
        },
      ],
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
    source.cells[1] ?? '',
    '',
  ];
}

function childMarkdown(rows: readonly (readonly string[])[]): string {
  return markdownTable(systemHeaders, rows);
}

function createLookupExecutor(): (
  args: SteelToolJsonObject,
  callId: string,
) => Promise<SteelToolResult> {
  return jest.fn(async () => lookupResult());
}

function createModel(
  options: {
    failChunk?: (childCall: number) => boolean;
    onChildStarted?: (childCall: number) => void;
    onChild?: (input: QuotationModelInput) => Promise<QuotationModelResult> | QuotationModelResult;
    onMain?: (input: QuotationModelInput) => Promise<void> | void;
    onMainInput?: (input: string) => void;
    streamMain?: boolean;
    lookupArguments?: SteelToolJsonObject;
  } = {},
) {
  let childCall = 0;
  return jest.fn(async (input: QuotationModelInput): Promise<QuotationModelResult> => {
    if (input.role === 'main') {
      await options.onMain?.(input);
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
    await input.lookup?.(
      lookupCallId,
      options.lookupArguments ?? {
        queries: [{ queryId: 'q1', categories: ['鐵板'] }],
      },
    );
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
    '黑鐵',
    'Kg',
    row[3] ?? '',
    '',
    row[3] ?? '',
    '12',
    '2',
    'PL',
    row[4] ?? '',
    row[5] ?? '',
    row[6] ?? '',
    '',
    '鐵板',
    row[1] ?? '',
    '',
  ];
}

let mongoServer: MongoMemoryReplSet;
let service: ReturnType<typeof createSteelQuotationStateService>;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
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

async function prepareRun(
  rowCount: number,
  rowsPerChunk = 30,
  options: { scope?: SteelQuotationScope; targetMessageId?: string; bindCustomer?: boolean } = {},
): Promise<SteelQuotationActiveRun> {
  const runScope = options.scope ?? scope;
  const models = createModels(mongoose);
  await models.Conversation.updateOne(
    { conversationId: runScope.conversationId, user: runScope.userId },
    {
      $setOnInsert: {
        conversationId: runScope.conversationId,
        user: runScope.userId,
        endpoint: 'agents',
        ...(runScope.tenantId !== undefined ? { tenantId: runScope.tenantId } : {}),
      },
    },
    { upsert: true },
  );
  const order = orderMarkdown(rowCount);
  await service.setOrder({ scope: runScope, fullMarkdown: order, revision: 'runner-test' });
  const customer = await service.saveCustomer({
    scope: runScope,
    customerMarkdown,
    customerIdentity: 'C1',
    triggeringMessageId: 'customer-trigger',
    responseId: options.bindCustomer ? `${options.targetMessageId}:customer` : 'customer-response',
    orderHash: createHash('sha256').update(order).digest('hex'),
    selectionProvenance: { method: 'unique', lookupMessageId: 'customer-lookup' },
  });
  const ticket = await service.issueTicket({
    scope: runScope,
    customerMarkdown,
    customerIdentity: 'C1',
    triggeringMessageId: 'trigger-1',
    ...(options.bindCustomer
      ? {
          preparationId: customer.preparationId,
          responseId: customer.responseId,
          orderHash: customer.orderHash,
        }
      : {}),
    selectionProvenance: { method: 'unique', lookupMessageId: 'customer-lookup' },
  });
  const chunks = buildQuotationChunks(order, rowsPerChunk);
  const acceptedRun = await service.acceptSignal({
    scope: runScope,
    index: ticket.index,
    token: ticket.token,
    orderHash: ticket.orderHash,
    customerMarkdown,
    customerIdentity: 'C1',
    prompts: { child: 'child', main: 'main' },
    chunks: chunks.map((chunk) => ({
      index: chunk.chunkIndex,
      sourceRowCount: chunk.sourceRows.length,
    })),
    targetMessageId: options.targetMessageId ?? 'target-1',
  });
  if (!acceptedRun) throw new Error('Quotation test run was not accepted');
  const methods = createMethods(mongoose);
  const admission = await methods.admitSteelMarkdown({
    scope: runScope,
    responseId: acceptedRun.targetMessageId ?? options.targetMessageId ?? 'target-1',
    generationId: `test-generation-${acceptedRun.runId}`,
  });
  if (!admission) throw new Error('Quotation test admission was not created');
  return acceptedRun;
}

type QuotationInvoker = (input: QuotationModelInput) => Promise<QuotationModelResult>;

function runnerInput(
  invokeModel: QuotationInvoker,
  executeLookup: (args: SteelToolJsonObject, callId: string) => Promise<SteelToolResult>,
  options: {
    scope?: SteelQuotationScope;
    signal?: AbortSignal;
    onProgress?: (progress: QuotationProgress) => Promise<void>;
    publishFinal?: (
      input: SteelQuotationPublicationProof & { markdown: string },
    ) => Promise<SteelQuotationPublicationSaveResult | void>;
    onTextDelta?: (text: string) => Promise<void>;
    appendSummary?: (input: SteelQuotationSummaryInput) => Promise<SteelQuotationSummaryResult>;
    onSummaryCommitted?: (message: SteelQuotationSavedMessage) => Promise<void>;
    onCompletedReplay?: (targetMessageId: string) => Promise<void>;
    onPublicationCommitted?: (message: SteelQuotationSavedMessage) => Promise<void>;
    refreshPublicationAdmission?: () => Promise<SteelMarkdownAdmission | undefined>;
    summarySourceMessageId?: string;
  } = {},
): QuotationRunnerInput {
  const runScope = options.scope ?? scope;
  let methods: ReturnType<typeof createMethods> | undefined;
  let publisher: ReturnType<typeof createSteelQuotationPublicationPublisher> | undefined;
  const ensureMethods = async () => {
    if (methods) return methods;
    const models = createModels(mongoose);
    await models.Conversation.updateOne(
      { conversationId: runScope.conversationId, user: runScope.userId },
      {
        $setOnInsert: {
          conversationId: runScope.conversationId,
          user: runScope.userId,
          endpoint: 'agents',
          ...(runScope.tenantId !== undefined ? { tenantId: runScope.tenantId } : {}),
        },
      },
      { upsert: true },
    );
    methods = createMethods(mongoose);
    return methods;
  };
  const ensurePublisher = async (run: SteelQuotationActiveRun) => {
    if (publisher) return publisher;
    const db = await ensureMethods();
    const admission = await db.admitSteelMarkdown({
      scope: runScope,
      responseId: run.targetMessageId ?? 'target-1',
      generationId: `test-generation-${run.runId}`,
    });
    if (!admission) throw new Error('Quotation test admission was not created');
    publisher = createSteelQuotationPublicationPublisher({
      scope: runScope,
      onPublicationCommitted: options.onPublicationCommitted,
      buildMessage: ({ targetMessageId, markdown }) => ({
        messageId: targetMessageId,
        sourceMessageId: targetMessageId,
        conversationId: runScope.conversationId,
        user: runScope.userId,
        text: markdown,
        isCreatedByUser: false,
      }),
      savePublication: db.saveSteelQuotationMessage,
    });
    return publisher;
  };
  const customPublish = options.publishFinal;
  return {
    scope: runScope,
    modelOptions: {} as OpenAIOAuthModelOptions,
    signal: options.signal ?? new AbortController().signal,
    invokeModel,
    executeLookup,
    onProgress: options.onProgress,
    onTextDelta: options.onTextDelta,
    publishFinal: async (input: SteelQuotationPublicationProof & { markdown: string }) => {
      if (!input.run) throw new Error('Quotation publication test proof is missing its run');
      const run = input.run;
      const saved = await customPublish?.(input);
      return saved ?? (await ensurePublisher(run))(input);
    },
    appendSummary: options.appendSummary ?? (async (input) => {
      const db = await ensureMethods();
      return db.appendSteelQuotationSummary(input);
    }),
    onSummaryCommitted: options.onSummaryCommitted,
    onCompletedReplay: options.onCompletedReplay,
    refreshPublicationAdmission: options.refreshPublicationAdmission ?? (async () => {
      const active = (await service.readState(runScope))?.activeRun;
      if (!active) return undefined;
      const db = await ensureMethods();
      return (await db.admitSteelMarkdown({
        scope: runScope,
        responseId: active.targetMessageId ?? active.triggerMessageId ?? 'target-1',
        generationId: `test-generation-${active.runId}`,
      })) ?? undefined;
    }),
    summarySourceMessageId: options.summarySourceMessageId,
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

  it('preserves the published table and surfaces a main error for the terminal message', async () => {
    await prepareRun(1);
    const mainError = new Error('main review failed');
    const model = createModel();
    const publishFinal = jest.fn(async () => undefined);
    await expect(runQuotationPreflight(runnerInput(
      async (input) => {
        if (input.role === 'main') throw mainError;
        return model(input);
      },
      createLookupExecutor(),
      { publishFinal },
    ))).rejects.toBe(mainError);
    expect(publishFinal).toHaveBeenCalledTimes(1);
    const state = await service.readState(scope);
    expect(state?.activeRun?.status).toBe('completed');
    expect(state?.currentSystemOrder).toBeDefined();
    expect(state?.activeRun?.interruption).toBeUndefined();
  });

  it('refuses a completed publication marker without its durable receipt after a publisher error', async () => {
    const run = await prepareRun(1);
    const failure = new Error('publication failed before commit');
    const model = createModel();
    await expect(runQuotationPreflight(runnerInput(model, createLookupExecutor(), {
      publishFinal: async () => {
        await createSteelQuotationStateModel(mongoose).updateOne(scope, {
          $set: { 'activeRun.status': 'completed' },
          $push: { 'activeRun.checkpointRefs': {
            ...scope, runId: run.runId, operationId: 'order-published', kind: 'main',
            artifactId: 'missing-receipt', sha256: 'a'.repeat(64), updatedAt: new Date(),
          } },
        });
        throw failure;
      },
    }))).rejects.toBe(failure);
    expect(model.mock.calls.some(([input]) => input.role === 'main')).toBe(false);
  });

  it('drains an in-flight heartbeat and fences stale timer ticks before publication', async () => {
    const run = await prepareRun(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let renewalFinished = false;
    let publicationReads = 0;
    let heartbeatCalls = 0;
    const heartbeatLease = jest.fn(async (input: Parameters<typeof service.heartbeatLease>[0]) => {
      if (++heartbeatCalls === 1) {
        await gate;
        const renewed = await service.heartbeatLease(input);
        renewalFinished = true;
        return renewed;
      }
      return service.heartbeatLease(input);
    });
    const factory = jest.spyOn(stateModule, 'createSteelQuotationStateService')
      .mockReturnValue({ ...service, heartbeatLease, readState: async (input) => {
        const state = await service.readState(input);
        if (state?.activeRun?.checkpointRefs.some((ref) => ref.operationId === 'calculation:basis') &&
          ++publicationReads === 2) {
          setImmediate(release);
        }
        return state;
      } });
    const originalInterval = global.setInterval;
    let tick!: () => Promise<void>;
    const timer = jest.spyOn(global, 'setInterval').mockImplementation((callback, delay) => {
      tick = callback as () => Promise<void>;
      return originalInterval(() => {}, delay);
    });
    try {
      const model = createModel({ onChildStarted: () => {
        void tick();
        void tick();
        expect(heartbeatLease).toHaveBeenCalledTimes(1);
      },
        onMain: async (input) => { expect(input.signal.aborted).toBe(false); } });
      const input = runnerInput(model, createLookupExecutor());
      const publish = input.publishFinal!;
      await expect(runQuotationPreflight({ ...input, refreshPublicationAdmission: async () => {
        await tick();
        expect(heartbeatLease).not.toHaveBeenCalled();
        return input.refreshPublicationAdmission!();
      }, publishFinal: async (proof) => {
        expect(renewalFinished).toBe(true);
        const renewals = heartbeatLease.mock.calls.length;
        await tick();
        expect(heartbeatLease).toHaveBeenCalledTimes(renewals);
        return publish(proof);
      } })).resolves.toMatchObject({ status: 'completed' });
      expect(heartbeatLease).toHaveBeenCalledTimes(2);
      expect(model.mock.calls.filter(([call]) => call.role === 'main')).toHaveLength(1);
      const message = await createMethods(mongoose).getMessage({ user: scope.userId,
        messageId: run.targetMessageId! });
      expect(message?.text).toContain('## quote_summary');
      expect((await service.readState(scope))?.activeRun?.status).toBe('completed');
    } finally {
      release();
      timer.mockRestore();
      factory.mockRestore();
    }
  });

  it.each(['lease loss', 'renewal error', 'user stop'] as const)(
    'does not publish after %s at the final lease renewal', async (failure) => {
      await prepareRun(1);
      const controller = new AbortController();
      const error = new Error(failure);
      const heartbeatLease = jest.fn(async (input: Parameters<typeof service.heartbeatLease>[0]) => {
        if (failure === 'renewal error') throw error;
        if (failure === 'user stop') controller.abort(error);
        if (failure === 'lease loss') {
          await createSteelQuotationStateModel(mongoose).updateOne(scope, {
            $set: { 'activeRun.leaseExpiresAt': new Date(0) },
          });
        }
        return service.heartbeatLease(input);
      });
      const factory = jest.spyOn(stateModule, 'createSteelQuotationStateService')
        .mockReturnValue({ ...service, heartbeatLease });
      const originalInterval = global.setInterval;
      const timer = jest.spyOn(global, 'setInterval').mockImplementation((_callback, delay) =>
        originalInterval(() => {}, delay));
      try {
        const publishFinal = jest.fn();
        const onProgress = jest.fn();
        await expect(runQuotationPreflight(runnerInput(createModel(), createLookupExecutor(), {
          signal: controller.signal, publishFinal, onProgress,
        }))).rejects.toThrow();
        expect(heartbeatLease).toHaveBeenCalledTimes(1);
        expect(publishFinal).not.toHaveBeenCalled();
        expect(onProgress.mock.calls.some(([progress]) => progress.stage === 'main_consolidating')).toBe(false);
        expect((await service.readState(scope))?.currentSystemOrder).toBeUndefined();
      } finally {
        timer.mockRestore();
        factory.mockRestore();
      }
    },
  );

  it('sends the committed titled system order before main consolidation and model execution', async () => {
    const run = await prepareRun(1);
    const sent: string[] = [];
    const notify = createSteelQuotationMessageNotifier({
      scope, responseId: run.targetMessageId!, emit: async ({ event }) => { sent.push(event); },
    });
    const model = createModel({ onMain: () => {
      sent.push('main_model');
      expect(sent).toEqual(['steel_message_update', 'main_consolidating', 'main_model']);
    } });
    await expect(runQuotationPreflight(runnerInput(model, createLookupExecutor(), {
      onPublicationCommitted: (message) => notify(message),
      onProgress: async (progress) => {
        expect(progress.run.status).not.toBe('aggregating');
        if (progress.stage !== 'main_consolidating') return;
        const message = await createMethods(mongoose).getMessage({ user: scope.userId,
          messageId: run.targetMessageId! });
        expect(message?.text).toContain('## system_order\n\n');
        expect(progress.run.status).toBe('completed');
        sent.push(progress.stage);
      },
    }))).resolves.toMatchObject({ status: 'completed' });
  });

  it('keeps a completed publication after a user Stop during main without retrying children', async () => {
    const run = await prepareRun(1);
    const controller = new AbortController();
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const model = createModel({
      onMain: async (input) => {
        entered();
        await new Promise<never>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
        });
      },
    });
    const publishFinal = jest.fn(async () => undefined);
    const execution = runQuotationPreflight(
      runnerInput(model, createLookupExecutor(), {
        signal: controller.signal,
        publishFinal,
      }),
    );
    await waiting;
    controller.abort(new Error('user paused quotation'));
    await expect(execution).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
    const state = await service.readState(scope);
    expect(state?.activeRun?.runId).toBe(run.runId);
    expect(state?.activeRun?.status).toBe('completed');
    expect(state?.activeRun?.interruption).toBeUndefined();
    expect(publishFinal).toHaveBeenCalledTimes(1);
    const calls = model.mock.calls.length;
    await expect(runQuotationPreflight(runnerInput(model, createLookupExecutor()))).resolves.toMatchObject({ status: 'completed' });
    expect(model.mock.calls.length).toBe(calls);
  });

  it('uses the supplied PostgreSQL client for default quotation lookups', async () => {
    await prepareRun(1);
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const input = runnerInput(
      createModel({
        lookupArguments: {
          queries: [{ categories: ['鐵板'], materials: ['黑鐵'], thicknessMm: ['6'] }],
        },
      }),
      createLookupExecutor(),
    );
    const { executeLookup, ...defaultLookupInput } = input;
    const result = await runQuotationPreflight({ ...defaultLookupInput, client: { query } });
    expect(query).toHaveBeenCalled();
    expect(executeLookup).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });

  it('admits candidates using only the physical evidence consumed by their formula', () => {
    expect(
      hasCompleteSteelFormula({
        erpItemCode: 'SQ-1',
        category: '方鐵',
        ruleVersion: 'steel-weight-v1',
        exactPhysical: { density: '7.85' },
      }),
    ).toBe(true);
    expect(
      hasCompleteSteelFormula({
        erpItemCode: 'SQ-1',
        category: '方鐵',
        ruleVersion: 'steel-weight-v1',
        exactPhysical: {},
      }),
    ).toBe(false);
    expect(
      hasCompleteSteelFormula({
        erpItemCode: 'H-1',
        category: 'H型鋼',
        ruleVersion: 'steel-weight-v1',
        unitWeightBasis: 'kg_per_m',
        exactPhysical: { unitWeightValue: '1' },
      }),
    ).toBe(true);
    expect(
      hasCompleteSteelFormula({
        erpItemCode: 'H-1',
        category: 'H型鋼',
        ruleVersion: 'steel-weight-v1',
        unitWeightBasis: 'kg_per_piece_or_stock_length',
        exactPhysical: { unitWeightValue: '1' },
      }),
    ).toBe(false);
    for (const category of ['平鐵', '圓條']) {
      expect(
        hasCompleteSteelFormula({
          erpItemCode: `${category}-1`,
          category,
          ruleVersion: 'steel-weight-v1',
          unitWeightBasis: 'kg_per_m',
          exactPhysical: { unitWeightValue: '1' },
        }),
      ).toBe(true);
    }
  });

  it('runs only one quotation when another retry arrives while its child is active', async () => {
    const run = await prepareRun(1);
    const lease = await service.acquireLease({ scope, runId: run.runId });
    await service.interruptRun({ scope, runId: run.runId, leaseToken: lease!.leaseToken });
    let releaseChild!: () => void;
    let childStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    const started = new Promise<void>((resolve) => {
      childStarted = resolve;
    });
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

  it('announces the running quotation before preparing recovery checkpoints or calling the model', async () => {
    await prepareRun(3);
    const model = createModel();
    const started = jest.fn();
    await runQuotationPreflight(runnerInput(model, createLookupExecutor(), {
      onProgress: async (event) => {
        if (event.stage !== 'started') return;
        const active = (await service.readState(scope))!.activeRun!;
        expect(active.status).toBe('running');
        expect(active.leaseToken).toBeDefined();
        expect(active.checkpointRefs.some((ref) => ref.operationId === 'recovery-policy')).toBe(false);
        expect(model).not.toHaveBeenCalled();
        started();
      },
    }));
    expect(started).toHaveBeenCalledTimes(1);
  });

  it.each(['paused', 'error'] as const)(
    'resumes a %s preflight with the correct persisted batch size and total',
    async (reason) => {
      const run = await prepareRun(163);
      const lease = (await service.acquireLease({ scope, runId: run.runId }))!;
      await service.interruptRun({
        scope,
        runId: run.runId,
        leaseToken: lease.leaseToken,
        interruption: { reason, chunkIndex: 1 },
      });
      const resumed = createModel();
      const progress: QuotationProgress[] = [];
      await runQuotationPreflight({
        ...runnerInput(resumed, createLookupExecutor()),
        onProgress: async (event) => {
          progress.push(event);
        },
      });
      const rows = resumed.mock.calls
        .filter(([input]) => input.role === 'child')
        .map(([input]) => parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows.length);
      expect(rows).toEqual([30, 30, 30, 30, 30, 13]);
      const total = 6;
      expect(progress[progress.length - 1]).toEqual(
        expect.objectContaining({ completedChunks: total, totalChunks: total }),
      );
      const state = await service.readState(scope);
      expect(quotationStatus(state, scope.conversationId)).toEqual(
        expect.objectContaining({ completedChunks: total, totalChunks: total }),
      );
      const restored = await readQuotationHistory({ scope, runId: run.runId });
      expect(restored.activityEvents[restored.activityEvents.length - 1]).toEqual(
        expect.objectContaining({ completedChunks: total, totalChunks: total }),
      );
    },
  );

  it('resumes the remaining small chunks after pause and a new message without changing the total', async () => {
    const run = await prepareRun(163);
    const controller = new AbortController();
    const validModel = createModel();
    const model = createModel({
      onChild: async (input) => {
        const rows = parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows;
        if (rows.length === 30 && rows[0]![1] === 'P91') {
          return { markdown: '| incomplete', lookups: [], pythonEvidence: [] };
        }
        return validModel(input);
      },
    });
    await expect(
      runQuotationPreflight({
        ...runnerInput(model, createLookupExecutor(), { signal: controller.signal }),
        onProgress: async (event) => {
          if (
            event.stage === 'chunk_saved' &&
            event.completedChunks === 4 &&
            event.totalChunks === 8
          ) {
            controller.abort(new Error('Paused after first recovery slice'));
          }
        },
      }),
    ).rejects.toThrow('Paused after first recovery slice');
    const paused = await service.readState(scope);
    expect(paused?.activeRun?.interruption).toEqual({ reason: 'paused', chunkIndex: 4 });
    expect(quotationStatus(paused, scope.conversationId)).toEqual(
      expect.objectContaining({ completedChunks: 4, totalChunks: 8 }),
    );
    const savedSlice = await service.readCheckpoint({
      scope,
      runId: run.runId,
      operationId: 'leaf-v2:4:r.1',
    });
    expect(savedSlice).toBeTruthy();
    const prepared = await prepareQuotationTurn({
      scope,
      messageId: 'resume-message',
      responseId: 'resume-response',
      text: '接續報價',
    });
    expect(prepared.resume).toBe(true);
    expect((await service.readState(scope))?.pendingMessages).toHaveLength(0);
    const resumed = createModel();
    const events: QuotationProgress[] = [];
    await runQuotationPreflight({
      ...runnerInput(resumed, createLookupExecutor()),
      onProgress: async (event) => {
        events.push(event);
      },
    });
    expect(
      resumed.mock.calls
        .filter(([input]) => input.role === 'child')
        .map(([input]) => parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows.length),
    ).toEqual([12, 6, 30, 13]);
    expect(
      events.filter((event) => event.stage === 'chunk_saved').map((event) => event.chunkIndex),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      events.find((event) => event.stage === 'chunk_saved' && event.chunkIndex === 4)?.attempt,
    ).toEqual(expect.any(String));
    expect(
      events
        .filter((event) => event.stage === 'chunk_started')
        .map(({ chunkIndex, completedChunks, totalChunks }) => [
          chunkIndex,
          completedChunks,
          totalChunks,
        ]),
    ).toEqual([
      [5, 4, 8],
      [6, 5, 8],
      [7, 6, 8],
      [8, 7, 8],
    ]);
    expect(
      await service.readCheckpoint({ scope, runId: run.runId, operationId: 'leaf-v2:4:r.1' }),
    ).toBe(savedSlice);
    const restored = await readQuotationHistory({ scope, runId: run.runId });
    expect(restored.activityEvents[restored.activityEvents.length - 1]).toEqual(
      expect.objectContaining({ completedChunks: 8, totalChunks: 8 }),
    );
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
    const rows = parseMarkdownTables((await service.readState(scope))?.currentSystemOrder?.markdown ?? '')[0]!.rows;
    expect(rows).toHaveLength(24);
    expect(rows.slice(0, 21).every((row) => row[0] === 'ERP-PLATE')).toBe(true);
    const headers = parseMarkdownTables(result.markdown!)[0]!.headers;
    expect(
      rows
        .slice(21)
        .every((row) => row[headers.indexOf('型號')] === '' && row[headers.indexOf('單價')] === ''),
    ).toBe(true);
    const status = quotationStatus(await service.readState(scope), scope.conversationId);
    expect(status).toEqual(expect.objectContaining({ completedChunks: 4, totalChunks: 4 }));
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
      if (rows.length > 3 && rows.some((row) => row[1] === 'P24'))
        throw new Error('Split this group');
      return baseModel(input);
    });
    await expect(
      runQuotationPreflight({
        ...runnerInput(model, createLookupExecutor(), { signal: controller.signal }),
        onProgress: async (event) => {
          if (
            event.stage === 'chunk_saved' &&
            event.completedChunks === 3 &&
            event.totalChunks === 4
          )
            controller.abort(new Error('pause'));
        },
      }),
    ).rejects.toThrow('pause');
    const first = [...counts];
    const resumed = await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    expect(resumed.status).toBe('completed');
    expect(counts.slice(first.length)).toEqual([3]);
    expect(
      parseMarkdownTables((await service.readState(scope))?.currentSystemOrder?.markdown ?? '')[0]!.rows,
    ).toHaveLength(24);
    const restored = await readQuotationHistory({ scope, runId: run.runId });
    expect(restored.activityEvents[restored.activityEvents.length - 1]).toEqual(
      expect.objectContaining({ completedChunks: 4, totalChunks: 4 }),
    );
  });

  it('does not split valid saved output after interruption before the parent checkpoint', async () => {
    const run = await prepareRun(30);
    const lease = await service.acquireLease({ scope, runId: run.runId });
    const leased = { scope, runId: run.runId, leaseToken: lease!.leaseToken };
    const lookupKey = 'lookup:1:interrupted:lookup-old';
    await service.checkpoint({
      ...leased,
      operationId: lookupKey,
      kind: 'tool',
      payload: JSON.stringify({
        lookupCallId: 'lookup-old',
        arguments: { queries: [] },
        result: lookupResult(),
      }),
    });
    await service.checkpoint({
      ...leased,
      operationId: 'child-output:1:interrupted',
      kind: 'main',
      payload: JSON.stringify({
        markdown: childMarkdown(
          buildQuotationChunks(orderMarkdown(30), 30)[0]!.sourceRows.map(systemRow),
        ),
        lookupOperations: [lookupKey],
        pythonOperations: [],
      }),
    });
    await service.interruptRun(leased);
    const model = createModel();
    await runQuotationPreflight(runnerInput(model, createLookupExecutor()));
    const childInputs = model.mock.calls.filter(([input]) => input.role === 'child');
    expect(childInputs).toHaveLength(1);
    expect(parseMarkdownTables(JSON.parse(childInputs[0]![0].input).chunk)[0]!.rows).toHaveLength(
      30,
    );
    expect(childInputs[0]![0]).not.toHaveProperty('continuation');
    expect(
      await service.readCheckpoint({ scope, runId: run.runId, operationId: 'split-v2:1:r' }),
    ).toBeUndefined();
  });

  it.each(['checkpoint failure', 'cancellation', 'lease loss'])(
    'does not split a large child for %s even after its last repair event',
    async (failure) => {
      const run = await prepareRun(30);
      const controller = new AbortController();
      const model = createModel({
        onChild: async (input) => {
          if (failure === 'checkpoint failure') {
            const insert = jest
              .spyOn(createSteelQuotationArtifactModel(mongoose).collection, 'insertOne')
              .mockRejectedValueOnce(new Error(failure));
            try {
              await input.onChildMessages?.([]);
            } finally {
              insert.mockRestore();
            }
          }
          if (failure === 'cancellation') controller.abort(new Error(failure));
          if (failure === 'lease loss') await service.cancelRun({ scope, runId: run.runId });
          throw new Error(failure);
        },
      });
      const execution = runQuotationPreflight(
        runnerInput(model, createLookupExecutor(), { signal: controller.signal }),
      );
      if (failure === 'lease loss')
        await expect(execution).resolves.toEqual({ status: 'cancelled' });
      else await expect(execution).rejects.toThrow(failure);
      expect(model).toHaveBeenCalledTimes(1);
      expect(
        await service.readCheckpoint({ scope, runId: run.runId, operationId: 'split-v2:1:r' }),
      ).toBeUndefined();
    },
  );

  it.each(['usage', 'tool', 'progress'])(
    'preserves the retry node when its %s callback fails',
    async (callback) => {
      const run = await prepareRun(24, 24);
      const fail = async () => {
        throw new Error('callback unavailable');
      };
      const model = createModel({
        failChunk: (call) => call === 1,
        onChild: async (input) => {
          if (callback === 'usage')
            await input.onUsage?.({ input_tokens: 1, output_tokens: 1, total_tokens: 2 });
          if (callback === 'tool')
            await input.lookup?.('lookup-callback', { queries: [{ queryId: 'q1' }] });
          if (callback === 'progress')
            await input.onChildRepair?.({
              stage: 'chunk_repair_failed',
              repairAttempt: 0,
              maxRepairAttempts: 0,
              message: 'invalid output',
            });
          throw new Error('callback should have thrown');
        },
      });
      await expect(
        runQuotationPreflight({
          ...runnerInput(model, createLookupExecutor()),
          onUsage: fail,
          onTool: fail,
          onProgress: async (event) => {
            if (event.stage === 'chunk_repair_failed') await fail();
          },
        }),
      ).rejects.toThrow('callback unavailable');
      expect(model).toHaveBeenCalledTimes(2);
      const interrupted = (await service.readState(scope))!.activeRun!;
      expect(
        interrupted.checkpointRefs
          .filter((ref) => ref.operationId.startsWith('split-v2:'))
          .map((ref) => ref.operationId),
      ).toEqual(['split-v2:1:r']);
      expect(interrupted.checkpointRefs.some((ref) => ref.operationId.startsWith('leaf-v2:'))).toBe(
        false,
      );
      const resumed = createModel();
      await expect(
        runQuotationPreflight(runnerInput(resumed, createLookupExecutor())),
      ).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
      expect(
        resumed.mock.calls
          .filter(([input]) => input.role === 'child')
          .map(([input]) => parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows.length),
      ).toEqual([12, 12]);
      expect(
        await service.readCheckpoint({ scope, runId: run.runId, operationId: 'split-v2:1:r.1' }),
      ).toBeUndefined();
    },
  );

  it('replays a completed receipt without rerunning models or publishing again', async () => {
    const run = await prepareRun(1);
    const model = createModel();
    const lookup = createLookupExecutor();
    const publishFinal = jest.fn(async () => undefined);
    await expect(runQuotationPreflight(runnerInput(model, lookup, { publishFinal }))).resolves.toMatchObject({
      status: 'completed',
    });
    const callsAfterCompletion = model.mock.calls.length;
    const replay = jest.fn(async (_targetMessageId: string) => undefined);
    await expect(runQuotationPreflight({
      ...runnerInput(model, lookup, { publishFinal, onCompletedReplay: replay }),
    })).resolves.toMatchObject({ status: 'completed' });
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(run.targetMessageId);
    expect(model.mock.calls.length).toBe(callsAfterCompletion);
    expect(publishFinal).toHaveBeenCalledTimes(1);
  });

  it('rejects an old completed receipt without a compatibility recovery path', async () => {
    const run = await prepareRun(1);
    const finalMarkdown = [
      '## system_order',
      '',
      '| 型號 | 品名規格 | 材質編號 | 單價 | 數量 | 總數 | 厚度 | 寬度 | 長度 | 肚 | 單位 | 類別 | 單重 | 計價基準 | 公式編號 | 備註 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| ERP-PLATE | 鐵板 6T P1 | 黑鐵 | 12 | 1 | 1 | 6 | 100 | 200 |  | Kg | 鐵板 |  | 2 | PL | P1 |',
    ].join('\n');
    await seedLegacyPublication({ mongoose, scope, run, markdown: finalMarkdown });
    const model = jest.fn(async () => {
      throw new Error('legacy replay must not invoke a model');
    });
    const replay = jest.fn(async (_targetMessageId: string) => undefined);
    await expect(
      runQuotationPreflight(runnerInput(model, createLookupExecutor(), { onCompletedReplay: replay })),
    ).rejects.toThrow('Completed quotation has no trusted publication receipt');
    expect(replay).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
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
      expect(input.onTextDelta).toEqual(expect.any(Function));
      await input.onTextDelta?.('## manual_reviews\n\n需人工複核。');
      return { markdown: '無待複核事項。', lookups: [], pythonEvidence: [] };
    });
    await runQuotationPreflight(
      runnerInput(model, createLookupExecutor(), { onTextDelta, publishFinal }),
    );
    expect(onTextDelta).toHaveBeenCalledWith(expect.stringContaining('manual_reviews'));
    expect(onTextDelta.mock.calls.map(([text]) => text).join('')).not.toContain('system_order');
    expect(onTextDelta.mock.calls.map(([text]) => text).join('')).not.toContain('customer_quote');
    const final = publishFinal.mock.calls[0]![0] as unknown as { markdown: string };
    expect(final.markdown.match(/## system_order/g)).toHaveLength(1);
    expect(parseMarkdownTables(final.markdown)[0]!.rows).toHaveLength(31);
    expect(final.markdown).not.toContain('## customer_quote');
    expect(final.markdown).not.toContain('manual_reviews_chunk');
  });

  it('uses one normalized aggregate for publication and main review without a late final checkpoint', async () => {
    const run = await prepareRun(3);
    let reviewedOrder = '';
    const baseModel = createModel({
      onMainInput: (input) => { reviewedOrder = JSON.parse(input).system_order; },
    });
    const result = await runQuotationPreflight(runnerInput(baseModel, createLookupExecutor()));
    expect(result.status).toBe('completed');
    const normalized = await service.readCheckpoint({
      scope,
      runId: run.runId,
      operationId: 'system-order:normalized',
    });
    expect(normalized).toBe(reviewedOrder);
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'final' })).toBeUndefined();
    expect(await service.readCheckpoint({ scope, runId: run.runId, operationId: 'order-published' })).toEqual(
      expect.any(String),
    );
  });

  it('keeps main review text unchecked, places notes after reviews, and appends the backend summary last', async () => {
    await prepareRun(1);
    const baseModel = createModel();
    const raw =
      '## notes\n\n主 agent 補充。\n\n## manual_reviews\n\n保留這段未使用表格的模型輸出。';
    const committed = jest.fn(async (_message: SteelQuotationSavedMessage) => undefined);
    const model = jest.fn(async (input: QuotationModelInput) =>
      input.role === 'main' ? { markdown: raw, lookups: [], pythonEvidence: [] } : baseModel(input),
    );
    const result = await runQuotationPreflight(
      runnerInput(model, createLookupExecutor(), { onSummaryCommitted: committed }),
    );
    expect(result.status).toBe('completed');
    expect(model.mock.calls.filter(([input]) => input.role === 'main')).toHaveLength(1);
    expect(model.mock.calls.find(([input]) => input.role === 'main')![0]).not.toHaveProperty(
      'validateMainOutput',
    );
    expect(committed).toHaveBeenCalledTimes(1);
    const committedMessage = committed.mock.calls[0]![0];
    expect(committedMessage.text).toContain('保留這段未使用表格的模型輸出。');
    expect(committedMessage.text).toContain('主 agent 補充。');
    expect(committedMessage.text).toContain('查價輸出完成：共 1 筆 system_order。');
    expect(committedMessage.text).toMatch(/項次核對：材料項次 1／原始訂單 1 項；加工列 0 筆。$/u);
  });

  it('forwards the original 17-column child source and filters control sections from main deltas', async () => {
    await prepareRun(1);
    let mainPayload: { system_order: string; review_remarks: string } | undefined;
    const deltas: string[] = [];
    const publishFinal = jest.fn(async () => undefined);
    const baseModel = createModel();
    const model = jest.fn(async (input: QuotationModelInput) => {
      if (input.role !== 'main') return baseModel(input);
      mainPayload = JSON.parse(input.input) as typeof mainPayload;
      await input.onTextDelta?.('## SYSTEM_ORDER\n\n| forbidden |\n| --- |\n| table |\n');
      await input.onTextDelta?.('## MANUAL_REVIEWS\n\n需人工複核。');
      await input.onTextDelta?.('\n\n## Quote_Signal\n\n| leaked |\n| --- |\n| no |');
      return { markdown: '## manual_reviews\n\n需人工複核。', lookups: [], pythonEvidence: [] };
    });
    await runQuotationPreflight(runnerInput(model, createLookupExecutor(), {
      publishFinal,
      onTextDelta: async (text) => { deltas.push(text); },
    }));
    expect(publishFinal).toHaveBeenCalledTimes(1);
    expect(mainPayload).toBeDefined();
    expect(parseMarkdownTables(mainPayload!.system_order)[0]!.headers).toHaveLength(16);
    expect(parseMarkdownTables(mainPayload!.system_order)[0]!.headers).not.toContain('零件編號');
    const reviewRemarks = parseMarkdownTables(mainPayload!.review_remarks)[0]!;
    expect(reviewRemarks.headers).toEqual(systemHeaders);
    expect(reviewRemarks.rows[0]?.[15]).toBe('P1');
    expect(reviewRemarks.rows[0]?.[16]).toBe('');
    expect(deltas.join('')).toMatch(/manual_reviews/iu);
    expect(deltas.join('')).not.toContain('system_order');
    expect(deltas.join('')).not.toContain('customer_quote');
    expect(deltas.join('')).not.toContain('forbidden');
  });

  it('keeps a completed publication when summary delivery fails after main streaming', async () => {
    const run = await prepareRun(1);
    const executeLookup = createLookupExecutor();
    const publishFinal = jest.fn(async () => undefined);
    const onTextDelta = jest.fn().mockRejectedValue(new Error('stream disconnected'));
    const result = await runQuotationPreflight(
      runnerInput(createModel({ streamMain: true }), executeLookup, {
        publishFinal,
        onTextDelta,
      }),
    );
    expect(result.status).toBe('completed');
    expect(publishFinal).toHaveBeenCalledTimes(1);
    expect((await service.readState(scope))?.activeRun?.runId).toBe(run.runId);
    expect((await service.readState(scope))?.activeRun?.status).toBe('completed');
    expect(executeLookup).toHaveBeenCalledTimes(1);
  });
  it('starts fresh work as running and reports distinct child checkpoints without fake recovery', async () => {
    const run = await prepareRun(31);
    expect(await readQuotationHistory({ scope, runId: run.runId })).toEqual(
      createSteelNativeHistory(),
    );
    const progress: QuotationProgress[] = [];
    const model = createModel({
      onChild: async (input) => {
        expect((await service.readState(scope))?.activeRun?.status).toBe('running');
        const rows = parseMarkdownTables(JSON.parse(input.input).chunk)[0]!.rows;
        await input.lookup?.('lookup', { queries: [{ queryId: 'q1' }] });
        return {
          markdown: childMarkdown(rows.map(systemRowFromSourceRow)),
          lookups: [],
          pythonEvidence: [],
        };
      },
    });
    await runQuotationPreflight({
      ...runnerInput(model, createLookupExecutor()),
      onProgress: async (event) => {
        progress.push(event);
      },
    });
    expect(progress.slice(0, 5).map(({ stage, run: active, chunkIndex, completedChunks }) => [
      stage ?? active.status,
      active.status,
      chunkIndex,
      completedChunks,
    ])).toEqual([
      ['started', 'running', undefined, 0],
      ['chunk_started', 'running', 1, 0],
      ['chunk_saved', 'running', 1, 1],
      ['chunk_started', 'running', 2, 1],
      ['chunk_saved', 'running', 2, 2],
    ]);
    expect(progress.some((event) => event.stage === 'main_review_started')).toBe(true);
    expect(progress[progress.length - 1]).toEqual(expect.objectContaining({ run: expect.objectContaining({ status: 'completed' }) }));
  });

  it('checkpoints a failed raw child before its repaired candidate and saves only the repaired chunk', async () => {
    const run = await prepareRun(1);
    const chunk = buildQuotationChunks(orderMarkdown(1), 30)[0]!;
    const valid = childMarkdown(chunk.sourceRows.map(systemRow));
    const canonicalValid = `## system_order_chunk\n\n${valid}`;
    const malformed = `${valid}\n| 未完成`;
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({
        content: '',
        tool_calls: [
          {
            name: 'search_price_candidates',
            id: 'lookup-1',
            args: { queries: [{ queryId: 'q1' }] },
          },
        ],
        response_metadata: { finish_reason: 'tool_calls' },
      }),
      new AIMessageChunk({ content: malformed, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({
        content: '',
        tool_calls: [
          {
            name: 'search_price_candidates',
            id: 'lookup-repair',
            args: { queries: [{ queryId: 'q1' }] },
          },
        ],
        response_metadata: { finish_reason: 'tool_calls' },
      }),
      new AIMessageChunk({ content: valid, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({
        content: '無待複核事項。',
        response_metadata: { finish_reason: 'stop' },
      }),
    ]);
    const executeLookup = createLookupExecutor();
    const progress: QuotationProgress[] = [];
    await expect(
      runQuotationPreflight({
        ...runnerInput(invokeQuotationModel, executeLookup),
        onProgress: async (event) => {
          progress.push(event);
          if (event.stage?.startsWith('chunk_repair_')) {
            const current = await service.readState(scope);
            expect(
              current?.activeRun?.checkpointRefs.some((ref) =>
                ref.operationId.endsWith(`:${event.stage}`),
              ),
            ).toBe(true);
            expect(current?.activeRun?.chunks[0]?.status).toBe('pending');
          }
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'completed' }));

    const state = await service.readState(scope);
    const rawRefs =
      state?.activeRun?.checkpointRefs.filter((ref) =>
        ref.operationId.startsWith('child-output:1:'),
      ) ?? [];
    expect(rawRefs).toHaveLength(3);
    const rawCandidates = await Promise.all(
      rawRefs.slice(0, 2).map((ref) =>
        service.readCheckpoint({
          scope,
          runId: run.runId,
          operationId: ref.operationId,
        }),
      ),
    );
    expect((JSON.parse(rawCandidates[0]!) as { markdown: string }).markdown).toBe(
      `## system_order_chunk\n\n${malformed}`,
    );
    expect((JSON.parse(rawCandidates[1]!) as { markdown: string }).markdown).toBe(canonicalValid);
    const savedChunk = await service.readCheckpoint({
      scope,
      runId: run.runId,
      operationId: 'chunk:1',
    });
    expect((JSON.parse(savedChunk!) as { markdown: string }).markdown).toBe(canonicalValid);
    expect(savedChunk).not.toContain(malformed);
    expect(executeLookup).toHaveBeenCalledTimes(2);
    expect(providerInvoke).toHaveBeenCalledTimes(5);
    expect(oauthFactory).toHaveBeenCalledTimes(3);
    expect(
      progress
        .filter((event) => event.stage?.startsWith('chunk_repair_'))
        .map((event) => [event.stage, event.repairAttempt]),
    ).toEqual([]);
    const history = await readQuotationHistory({ scope, runId: run.runId });
    expect(
      history.activityEvents.filter(
        (event) => event.type === 'quotation_status' && event.stage.startsWith('chunk_repair_'),
      ),
    ).toEqual([]);
  });

  it('saves a canonical chunk without another AI generation when only its closing delimiter is missing', async () => {
    const run = await prepareRun(1);
    const row = [...systemRow(buildQuotationChunks(orderMarkdown(1), 30)[0]!.sourceRows[0]!)];
    row[16] = 'F1 P1';
    const valid = childMarkdown([row]);
    const canonicalValid = `## system_order_chunk\n\n${valid}`;
    const missingDelimiter = valid.slice(0, -1);
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({
        content: '',
        tool_calls: [{ name: 'search_price_candidates', id: 'lookup-format', args: {} }],
        response_metadata: { finish_reason: 'tool_calls' },
      }),
      new AIMessageChunk({
        content: missingDelimiter,
        response_metadata: { finish_reason: 'stop' },
      }),
      new AIMessageChunk({
        content: '無待複核事項。',
        response_metadata: { finish_reason: 'stop' },
      }),
    ]);
    await runQuotationPreflight(runnerInput(invokeQuotationModel, createLookupExecutor()));
    expect(providerInvoke).toHaveBeenCalledTimes(3);
    const saved = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' });
    expect(JSON.parse(saved!).markdown).toBe(canonicalValid);
    const state = await service.readState(scope);
    const rawRefs = state!.activeRun!.checkpointRefs.filter((ref) =>
      ref.operationId.startsWith('child-output:1:'),
    );
    const rawPayloads = await Promise.all(
      rawRefs.map((ref) =>
        service.readCheckpoint({
          scope,
          runId: run.runId,
          operationId: ref.operationId,
        }),
      ),
    );
    expect(rawPayloads.map((raw) => JSON.parse(raw!).markdown)).toContain(
      `## system_order_chunk\n\n${missingDelimiter.trim()}`,
    );
  });

  it('repairs a legacy failed output from clean input with a fresh lookup', async () => {
    const run = await prepareRun(1);
    const lease = await service.acquireLease({ scope, runId: run.runId });
    const leased = { scope, runId: run.runId, leaseToken: lease!.leaseToken };
    const lookupKey = 'lookup:1:legacy:lookup-old';
    await service.checkpoint({
      ...leased,
      operationId: lookupKey,
      kind: 'tool',
      payload: JSON.stringify({
        lookupCallId: 'lookup-old',
        arguments: { queries: [{ queryId: 'old-query' }] },
        result: lookupResult(),
      }),
    });
    const valid = childMarkdown(
      buildQuotationChunks(orderMarkdown(1), 30)[0]!.sourceRows.map(systemRow),
    );
    const broken = `${valid}\n| interrupted output`;
    await service.checkpoint({
      ...leased,
      operationId: 'child-output:1:legacy',
      kind: 'main',
      payload: JSON.stringify({
        markdown: broken,
        lookupOperations: [lookupKey],
        pythonOperations: [],
      }),
    });
    await service.interruptRun(leased);
    const providerInvoke = configureOAuthResponses([
      new AIMessageChunk({
        content: '',
        tool_calls: [
          {
            name: 'search_price_candidates',
            id: 'lookup-new',
            args: { queries: [{ queryId: 'fresh-query' }] },
          },
        ],
        response_metadata: { finish_reason: 'tool_calls' },
      }),
      new AIMessageChunk({ content: valid, response_metadata: { finish_reason: 'stop' } }),
      new AIMessageChunk({
        content: '無待複核事項。',
        response_metadata: { finish_reason: 'stop' },
      }),
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
    const savedRaw = await service.readCheckpoint({
      scope,
      runId: run.runId,
      operationId: 'child-output:1:legacy',
    });
    expect(JSON.parse(savedRaw!).markdown).toBe(broken);
    expect((await service.readState(scope))?.activeRun?.status).toBe('completed');
  });

  async function prepareCustomer(responseId = 'response-1', tier = 'C') {
    const state = await service.setOrder({ scope, fullMarkdown: orderMarkdown(31) });
    const result = await bindQuotationCustomerResult({
      scope,
      messageId: `user-${responseId}`,
      responseId: `customer-${responseId}`,
      expectedOrderHash: state.currentOrder!.sha256,
      expectedCustomerPreparationId: state.currentCustomer?.preparationId,
      result: {
        ok: true,
        toolName: 'search_customers',
        durationMs: 1,
        redactionVersion: 1,
        data: {
          customers: [
            { id: 1, erpCustomerCode: 'C1', displayName: '測試客戶', customerTier: tier },
          ],
        },
      },
    });
    if (!result.ok) throw new Error('Customer setup failed');
    const customerDataMarkdown = String(result.data.customerDataMarkdown);
    await commitQuotationCustomerResponse({
      scope,
      response: customerDataMarkdown,
      responseId: `customer-${responseId}`,
      messageId: `user-${responseId}`,
      expectedOrderHash: state.currentOrder!.sha256,
      expectedCustomerPreparationId: state.currentCustomer?.preparationId,
    });
    return customerDataMarkdown;
  }

  async function acceptPreparedSignal(responseId = 'response-1', messageId = `user-${responseId}`) {
    const prepared = await service.readState(scope);
    const run = await acceptQuotationResponse({
      scope,
      response: quotationSignal,
      responseId,
      messageId,
      expectedOrderHash: prepared?.currentOrder?.sha256,
      expectedCustomerPreparationId: prepared?.currentCustomer?.preparationId,
      finishReason: 'stop',
    });
    if (run) {
      const models = createModels(mongoose);
      await models.Conversation.updateOne(
        { conversationId: scope.conversationId, user: scope.userId },
        {
          $setOnInsert: {
            conversationId: scope.conversationId,
            user: scope.userId,
            endpoint: 'agents',
          },
        },
        { upsert: true },
      );
      const admission = await createMethods(mongoose).admitSteelMarkdown({
        scope,
        responseId: run.targetMessageId ?? responseId,
        generationId: `test-generation-${run.runId}`,
      });
      if (!admission) throw new Error('Quotation test admission was not created');
    }
    return run;
  }

  it('accepts a clear direct tier without calling customer lookup and saves the canonical blank customer', async () => {
    const state = await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    const response = renderQuotationCustomerMarkdown({ tier: 'D' });
    await expect(
      acceptQuotationResponse({
        scope,
        response,
        responseId: 'tier-response',
        messageId: 'tier-user',
        messageText: 'use Tier D',
        expectedOrderHash: state.currentOrder!.sha256,
        finishReason: 'stop',
      }),
    ).resolves.toBeUndefined();
    const saved = await service.readState(scope);
    expect(saved?.currentCustomer?.customerIdentity).toBe('explicit-default:D');
    expect(saved?.currentCustomer?.customerMarkdown).toBe(response);
  });

  it('preserves a resolved customer identity when the current user changes only the tier', async () => {
    await prepareCustomer();
    const before = await service.readState(scope);
    const response = renderQuotationCustomerMarkdown({
      tier: 'F',
      customerCode: 'C1',
      customerName: '測試客戶',
    });
    await expect(
      acceptQuotationResponse({
        scope,
        response,
        responseId: 'tier-change-response',
        messageId: 'tier-change-user',
        messageText: '使用F級',
        expectedOrderHash: before?.currentOrder?.sha256,
        expectedCustomerPreparationId: before?.currentCustomer?.preparationId,
        finishReason: 'stop',
      }),
    ).resolves.toBeUndefined();
    const saved = await service.readState(scope);
    expect(saved?.currentCustomer?.customerIdentity).toBe('1');
    expect(saved?.currentCustomer?.customerMarkdown).toContain('| C1 | 測試客戶 | F |');
  });

  it('commits customer data before admitting a same-turn quotation signal', async () => {
    const state = await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    const response = `${renderQuotationCustomerMarkdown({ tier: 'B' })}\n\n${quotationSignal}`;
    const run = await acceptQuotationResponse({
      scope,
      response,
      responseId: 'same-response',
      messageId: 'same-user',
      messageText: '使用預設 B tier，報價',
      expectedOrderHash: state.currentOrder!.sha256,
      finishReason: 'stop',
    });
    expect(run?.index).toBe(1);
    expect((await service.readState(scope))?.currentCustomer?.customerIdentity).toBe(
      'explicit-default:B',
    );
  });

  it('replays an accepted mixed response without queueing or rewriting its customer', async () => {
    const state = await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    const response = `${renderQuotationCustomerMarkdown({ tier: 'B' })}\n\n${quotationSignal}`;
    const first = await acceptQuotationResponse({
      scope,
      response,
      responseId: 'accepted-retry',
      messageId: 'accepted-user',
      messageText: '使用預設 B tier，報價',
      expectedOrderHash: state.currentOrder!.sha256,
      finishReason: 'stop',
    });
    const accepted = await service.readState(scope);
    const prepared = accepted?.currentCustomer;
    expect(first?.runId).toBeDefined();
    expect(prepared).toBeDefined();
    await service.clearCustomer({
      scope,
      responseId: 'accepted-retry',
      preparationId: prepared!.preparationId,
      orderHash: state.currentOrder!.sha256,
    });
    const retried = await acceptQuotationResponse({
      scope,
      response,
      responseId: 'accepted-retry',
      messageId: 'retry-user',
      messageText: '改用附件的訂單',
      messageFiles: [{ fileId: 'retry-file', filename: 'retry.pdf', mediaType: 'application/pdf' }],
      expectedOrderHash: state.currentOrder!.sha256,
      finishReason: 'stop',
    });
    const after = await service.readState(scope);
    expect(retried?.runId).toBe(first?.runId);
    expect(after?.pendingMessages).toHaveLength(0);
    expect(after?.currentCustomer).toEqual(prepared);
    expect(after?.nextSignalIndex).toBe(1);
    const result = await runQuotationPreflight(runnerInput(createModel(), createLookupExecutor()));
    expect(result.status).toBe('completed');
    expect((await service.readState(scope))?.currentCustomer).toEqual(prepared);
    expect(
      await service.getArtifact({ scope, runId: first!.runId, operationId: 'order-published' }),
    ).not.toBeNull();
  });

  it('rejects a receipt-backed retired OCR update without allocating a run', async () => {
    const state = await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    const customer = await service.saveCustomer({
      scope,
      customerMarkdown: renderQuotationCustomerMarkdown({ tier: 'B' }),
      customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'receipt-user',
      responseId: 'receipt-response',
      orderHash: state.currentOrder!.sha256,
      selectionProvenance: { method: 'default_tier', selectionMessageId: 'receipt-user' },
    });
    const canonicalResponse = `## ocr_result_updates\n\n| 零件編號 | 備註 |\n| --- | --- |\n| P1 | 修訂 |\n\n${quotationSignal}`;
    const response = `${canonicalResponse}\n`;
    const receipt = {
      inputHash: createHash('sha256').update(response).digest('hex'),
      markdown: canonicalResponse,
      ocrGeneration: 'ocr-generation-1',
      ocrHash: createHash('sha256').update('ocr').digest('hex'),
    };
    const request = {
      scope,
      response,
      responseId: 'receipt-response',
      messageId: 'receipt-user',
      expectedOrderHash: state.currentOrder!.sha256,
      expectedCustomerPreparationId: customer.preparationId,
      completionReceipt: receipt,
      finishReason: 'stop',
      service,
    };
    await expect(acceptQuotationSignal(request)).rejects.toMatchObject({
      code: 'retired_control_section',
    });
    await expect(
      acceptQuotationSignal({ ...request, response: canonicalResponse }),
    ).rejects.toMatchObject({ code: 'retired_control_section' });
    const after = await service.readState(scope);
    expect(after?.currentCustomer).toEqual(customer);
    expect(after?.activeRun).toBeUndefined();
    expect(after?.nextSignalIndex).toBe(0);
    expect(after?.pendingMessages).toHaveLength(0);
  });

  it('accepts a later signal-only response using the saved customer and current turn snapshot', async () => {
    const response = await prepareCustomer();
    const state = await service.readState(scope);
    await expect(
      acceptQuotationResponse({
        scope,
        response,
        responseId: 'response-1',
        expectedOrderHash: state?.currentOrder?.sha256,
        expectedCustomerPreparationId: state?.currentCustomer?.preparationId,
        finishReason: 'stop',
      }),
    ).resolves.toBeUndefined();
    expect(state?.nextSignalIndex).toBe(0);
    const run = await acceptPreparedSignal('confirmation-response', 'confirmation-user');
    expect(run?.index).toBe(1);
    expect(run?.chunks.map((chunk) => chunk.sourceRowCount)).toEqual([24, 7]);
    expect(run?.triggerMessageId).toBe('confirmation-user');
  });

  it('waits for an AI signal and resumes the same interrupted run without issuing another ticket', async () => {
    await prepareCustomer();
    const first = (await acceptPreparedSignal('response-1'))!;
    const lease = await service.acquireLease({ scope, runId: first.runId });
    await service.interruptRun({
      scope,
      runId: first.runId,
      leaseToken: lease!.leaseToken,
      interruption: { reason: 'paused' },
    });
    const prepared = await prepareQuotationTurn({
      scope,
      messageId: 'continue-user',
      responseId: 'continue-response',
      text: '請繼續處理這份報價',
    });
    expect(prepared.resume).toBe(true);
    const request = {
      scope,
      responseId: 'continue-response',
      messageId: 'continue-user',
      expectedOrderHash: prepared.state.currentOrder?.sha256,
      expectedCustomerPreparationId: prepared.state.currentCustomer?.preparationId,
      finishReason: 'stop',
    };
    await expect(
      acceptQuotationResponse({ ...request, response: '這份報價尚未完成。' }),
    ).resolves.toBeUndefined();
    await expect(
      acceptQuotationResponse({
        ...request,
        response: quotationSignal,
        expectedOrderHash: 'stale',
      }),
    ).rejects.toThrow('stale preparation');
    const accepted = await Promise.all(
      [1, 2].map(() => acceptQuotationResponse({ ...request, response: quotationSignal })),
    );
    expect(accepted.map((run) => run?.runId)).toEqual([first.runId, first.runId]);
    const state = await service.readState(scope);
    expect(state?.nextSignalIndex).toBe(first.index);
    expect(state?.tickets).toHaveLength(1);
    expect(state?.pendingMessages).toHaveLength(0);
    expect(state?.activeRun?.interruption?.reason).toBe('paused');
    const concurrent = await Promise.all(
      [1, 2].map(() => service.acquireLease({ scope, runId: first.runId })),
    );
    expect(concurrent.filter(Boolean)).toHaveLength(1);
  });

  it.each([false, true])(
    'rejects changed inputs while a quotation run is unfinished (mixed signal=%s)',
    async (mixedSignal) => {
      await prepareCustomer();
      const first = (await acceptPreparedSignal('response-1'))!;
      const state = await service.readState(scope);
      const files = [
        { fileId: 'original-file', filename: 'revision.pdf', mediaType: 'application/pdf' },
      ];
      const response = `${orderMarkdown(2)}${mixedSignal ? `\n\n${quotationSignal}` : ''}`;
      await expect(
        acceptQuotationResponse({
          scope,
          response,
          responseId: 'correction-response',
          messageId: 'correction-user',
          messageText: '改用附件的訂單',
          messageFiles: files,
          expectedOrderHash: state?.currentOrder?.sha256,
          expectedCustomerPreparationId: state?.currentCustomer?.preparationId,
          finishReason: 'stop',
        }),
      ).rejects.toMatchObject({ code: 'quotation_busy' });
      const after = await service.readState(scope);
      expect(after?.currentOrder?.sha256).toBe(state?.currentOrder?.sha256);
      expect(after?.nextSignalIndex).toBe(first.index);
      expect(after?.pendingMessages).toHaveLength(0);
    },
  );

  it('persists explicit default-B Markdown before OCR and retains it for later quotation', async () => {
    const output = {
      scope,
      response: defaultQuotationCustomerMarkdown,
      responseId: 'default-b-response',
      messageId: 'default-b-user',
      messageText: '使用預設 B tier',
    };
    await expect(
      acceptQuotationResponse({ ...output, finishReason: 'length' }),
    ).resolves.toBeUndefined();
    expect((await service.readState(scope))?.currentCustomer).toBeUndefined();
    await Promise.all(
      [1, 2].map(() => acceptQuotationResponse({ ...output, finishReason: 'stop' })),
    );
    const first = await service.readState(scope);
    expect(first?.currentCustomer?.customerIdentity).toBe('explicit-default:B');
    expect(first?.currentCustomer?.customerMarkdown).toBe(defaultQuotationCustomerMarkdown);
    expect(first?.nextSignalIndex).toBe(0);
    expect(
      quotationPreparationStatus(
        first?.currentOrder?.markdown,
        first?.currentCustomer?.customerMarkdown,
      ),
    ).toEqual({
      hasOcrResult: false,
      hasCustomerData: true,
      hasSystemOrder: false,
      shouldAskToQuote: false,
    });
    await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    const prepared = await service.readState(scope);
    expect(prepared?.currentCustomer?.preparationId).toBe(first?.currentCustomer?.preparationId);
    const run = await acceptQuotationResponse({
      scope,
      response: quotationSignal,
      responseId: 'quote-after-ocr',
      messageId: 'confirmed-order',
      expectedOrderHash: prepared?.currentOrder?.sha256,
      expectedCustomerPreparationId: prepared?.currentCustomer?.preparationId,
      finishReason: 'stop',
    });
    expect(run?.index).toBe(1);
    const snapshot = await service.readArtifact({ scope, ref: run!.snapshotRef });
    expect((JSON.parse(snapshot!) as { customerMarkdown: string }).customerMarkdown).toBe(
      defaultQuotationCustomerMarkdown,
    );
  });

  it('rejects a stale confirmation after the customer or order changed', async () => {
    await prepareCustomer();
    const first = await service.readState(scope);
    const input = {
      scope,
      response: quotationSignal,
      responseId: 'later-confirmation',
      messageId: 'confirm-user',
      expectedOrderHash: first?.currentOrder?.sha256,
      expectedCustomerPreparationId: first?.currentCustomer?.preparationId,
      finishReason: 'stop',
    };
    await prepareCustomer('new-customer-response', 'D');
    await expect(acceptQuotationResponse(input)).rejects.toThrow('stale preparation');
    const next = await service.readState(scope);
    await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    await expect(
      acceptQuotationResponse({
        ...input,
        expectedCustomerPreparationId: next?.currentCustomer?.preparationId,
      }),
    ).rejects.toThrow('stale preparation');
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);
  });

  it('rejects mismatched or fabricated customer Markdown without allocating a quotation', async () => {
    await prepareCustomer();
    const prepared = await service.readState(scope);
    await expect(
      acceptQuotationResponse({
        scope,
        response: defaultQuotationCustomerMarkdown,
        responseId: 'mismatched-default',
        messageId: 'mismatched-user',
        messageText: '報價',
        expectedOrderHash: prepared?.currentOrder?.sha256,
        expectedCustomerPreparationId: prepared?.currentCustomer?.preparationId,
        finishReason: 'stop',
      }),
    ).rejects.toThrow('trusted customer lookup');
    await expect(
      acceptQuotationResponse({
        scope,
        response: defaultQuotationCustomerMarkdown.replace('| B |', '| A |'),
        responseId: 'forged',
        messageId: 'forged-user',
        expectedOrderHash: prepared?.currentOrder?.sha256,
        expectedCustomerPreparationId: prepared?.currentCustomer?.preparationId,
        finishReason: 'stop',
      }),
    ).rejects.toThrow('trusted customer lookup');
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);
  });

  it('quotes with the latest customer tier confirmed in the Markdown editor', async () => {
    const markdown = await prepareCustomer();
    const models = createModels(mongoose);
    await models.Conversation.create({
      conversationId: scope.conversationId,
      user: scope.userId,
      endpoint: 'agents',
    });
    const messageId = 'customer-response-1';
    const reference = {
      kind: 'customer_data' as const,
      source: 'ai' as const,
      snapshotId: 'customer-snapshot',
      generationId: 'customer-generation',
      outputId: 'customer-output',
      messageId,
      title: 'customer_data',
      revision: 'customer-revision',
      sha256: createHash('sha256').update(markdown).digest('hex'),
      lineageId: 'customer-lineage',
      version: 1,
      savedAt: new Date(),
    };
    await models.Message.create({
      messageId,
      conversationId: scope.conversationId,
      user: scope.userId,
      text: markdown,
      content: [{ type: 'text', text: markdown }],
      isCreatedByUser: false,
      metadata: { steelMarkdownOwners: { customer_data: reference } },
    });
    await createSteelQuotationArtifactModel(mongoose).create({
      ...scope,
      runId: 'markdown:customer-generation',
      operationId: 'ai:customer_data',
      kind: 'main',
      sha256: reference.sha256,
      payload: markdown,
      markdownPublication: { reference, rawMarkdown: markdown, baselineMarkdown: markdown },
    });
    await createSteelQuotationStateModel(mongoose).updateOne(scope, {
      $set: {
        'markdownPublication.current.customer_data': { ai: reference, effective: reference },
      },
    });
    const before = await service.readState(scope);
    const edit = await createSteelCustomerMethods(mongoose).commitSteelCustomer({
      ...scope,
      messageId,
      title: reference.title,
      outputId: reference.outputId,
      revision: reference.revision,
      tier: 'F',
      expectedTier: 'C',
    });
    expect(edit).toMatchObject({ ok: true, value: { tier: 'F' } });
    await expect(
      acceptQuotationResponse({
        scope,
        response: quotationSignal,
        responseId: 'stale-confirmation',
        messageId: 'confirm-user',
        expectedOrderHash: before?.currentOrder?.sha256,
        expectedCustomerPreparationId: before?.currentCustomer?.preparationId,
        finishReason: 'stop',
      }),
    ).rejects.toThrow('stale preparation');
    const run = await acceptPreparedSignal('fresh-confirmation');
    expect(run?.status).toBe('queued');
    expect((await service.readState(scope))?.currentCustomer?.customerMarkdown).toContain('| F |');
  });

  it('saves customer Markdown without an index and admits concurrent delivery only once', async () => {
    await prepareCustomer();
    const prepared = await service.readState(scope);
    expect(prepared?.nextSignalIndex).toBe(0);
    expect(prepared?.currentCustomer?.customerMarkdown).toContain('| C |');
    const runs = await Promise.all(
      Array.from({ length: 2 }, () => acceptPreparedSignal('response-1')),
    );
    expect(runs[0]?.runId).toBe(runs[1]?.runId);
    expect((await service.readState(scope))?.nextSignalIndex).toBe(1);
    expect(runs[0]?.chunks.map((chunk) => chunk.sourceRowCount)).toEqual([24, 7]);
    expect((await service.readState(scope))?.currentCustomer?.customerMarkdown).toBe(
      prepared?.currentCustomer?.customerMarkdown,
    );
  });

  it('does not allocate an index for missing, mismatched, stale or unfinished response data', async () => {
    const response = await prepareCustomer();
    const prepared = await service.readState(scope);
    await expect(
      acceptQuotationResponse({
        scope,
        response,
        responseId: 'response-1',
        finishReason: 'length',
      }),
    ).resolves.toBeUndefined();
    for (const invalid of [quotationSignal, response.replace('| C |', '| A |')]) {
      await expect(
        acceptQuotationResponse({
          scope,
          response: invalid,
          responseId: 'response-1',
          finishReason: 'stop',
        }),
      ).rejects.toThrow();
    }
    for (const heading of ['## ocr_result', '  ## ocr_result', '## ocr_result ##']) {
      await expect(
        acceptQuotationResponse({
          scope,
          response: `${orderMarkdown(1).replace('## ocr_result', heading)}\n\n${response}`,
          responseId: 'response-1',
          expectedOrderHash: prepared?.currentOrder?.sha256,
          expectedCustomerPreparationId: prepared?.currentCustomer?.preparationId,
          finishReason: 'stop',
        }),
      ).resolves.toBeUndefined();
    }
    for (const heading of [
      '## ocr_result_updates',
      '  ## ocr_result_updates',
      '## ocr_result_updates ##',
    ]) {
      await expect(
        acceptQuotationResponse({
          scope,
          response: `${orderMarkdown(1).replace('## ocr_result', heading)}\n\n${response}`,
          responseId: 'response-1',
          expectedOrderHash: prepared?.currentOrder?.sha256,
          expectedCustomerPreparationId: prepared?.currentCustomer?.preparationId,
          finishReason: 'stop',
        }),
      ).rejects.toMatchObject({ code: 'retired_control_section' });
    }
    await expect(
      acceptQuotationResponse({
        scope,
        response,
        responseId: 'other-response',
        expectedOrderHash: prepared?.currentOrder?.sha256,
        expectedCustomerPreparationId: prepared?.currentCustomer?.preparationId,
        finishReason: 'stop',
      }),
    ).resolves.toBeUndefined();
    await service.setOrder({ scope, fullMarkdown: orderMarkdown(1) });
    const revised = await service.readState(scope);
    await expect(
      acceptQuotationResponse({
        scope,
        response,
        responseId: 'response-1',
        expectedOrderHash: revised?.currentOrder?.sha256,
        expectedCustomerPreparationId: revised?.currentCustomer?.preparationId,
        finishReason: 'stop',
      }),
    ).resolves.toBeUndefined();
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);
  });

  it('invalidates a successful customer selection when a later lookup is unresolved', async () => {
    const response = await prepareCustomer();
    const state = await service.readState(scope);
    await bindQuotationCustomerResult({
      scope,
      messageId: 'user-response-1',
      responseId: 'response-1',
      expectedOrderHash: state!.currentOrder!.sha256,
      expectedCustomerPreparationId: state?.currentCustomer?.preparationId,
      result: {
        ok: true,
        toolName: 'search_customers',
        durationMs: 1,
        redactionVersion: 1,
        data: { customers: [{ id: 1 }, { id: 2 }] },
      },
    });
    await expect(
      acceptQuotationResponse({ scope, response, responseId: 'response-1', finishReason: 'stop' }),
    ).rejects.toThrow();
    expect((await service.readState(scope))?.nextSignalIndex).toBe(0);
  });

  it.each(['failure', 'multiple', 'unique'])(
    'rejects a delayed older customer lookup with %s after a newer selection',
    async (outcome) => {
      await prepareCustomer('older-response', 'C');
      const beforeLookup = await service.readState(scope);
      await prepareCustomer('newer-response', 'D');
      const newer = await service.readState(scope);
      const result: SteelToolResult =
        outcome === 'failure'
          ? {
              ok: false,
              toolName: 'search_customers',
              durationMs: 1,
              redactionVersion: 1,
              errorCategory: 'repository_error',
              errorSummary: 'offline',
            }
          : {
              ok: true,
              toolName: 'search_customers',
              durationMs: 1,
              redactionVersion: 1,
              data: {
                customers:
                  outcome === 'multiple' ? [{ id: 1 }, { id: 2 }] : [{ id: 1, customerTier: 'C' }],
              },
            };
      await expect(
        bindQuotationCustomerResult({
          scope,
          messageId: 'older-user',
          responseId: 'older-response',
          expectedOrderHash: beforeLookup!.currentOrder!.sha256,
          expectedCustomerPreparationId: beforeLookup?.currentCustomer?.preparationId,
          result,
        }),
      ).rejects.toThrow('stale preparation');
      await expect(
        acceptQuotationResponse({
          scope,
          response: quotationSignal,
          responseId: 'older-response',
          messageId: 'older-user',
          expectedOrderHash: beforeLookup!.currentOrder!.sha256,
          expectedCustomerPreparationId: beforeLookup?.currentCustomer?.preparationId,
          finishReason: 'stop',
        }),
      ).rejects.toThrow('stale preparation');
      const after = await service.readState(scope);
      expect(after?.currentCustomer).toEqual(newer?.currentCustomer);
      expect(after?.nextSignalIndex).toBe(0);
      expect(after?.activeRun).toBeUndefined();
    },
  );

  it('keeps a cancelled signal replay terminal and allocates a fresh index for a new response', async () => {
    await prepareCustomer();
    const first = await acceptPreparedSignal('response-1');
    await service.cancelRun({ scope, runId: first!.runId });
    const replay = await acceptPreparedSignal('response-1');
    expect(replay?.status).toBe('cancelled');
    expect((await service.readState(scope))?.nextSignalIndex).toBe(1);
    await prepareCustomer('response-2', 'D');
    const next = await acceptPreparedSignal('response-2');
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
        const rows = parseMarkdownTables((JSON.parse(input.input) as { chunk: string }).chunk)[0]!
          .rows;
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
    await expect(
      runQuotationPreflight(runnerInput(invokeModel, executeLookup, { signal: controller.signal })),
    ).rejects.toThrow('child call 2 paused');
    const interrupted = await service.readState(scope);
    expect(interrupted?.activeRun?.status).toBe('interrupted');
    expect(interrupted?.activeRun?.chunks.map((chunk) => chunk.status)).toEqual([
      'completed',
      'pending',
    ]);
    const saved = await service.readCheckpoint({ scope, runId: run.runId, operationId: 'chunk:1' });
    expect((JSON.parse(saved!) as { markdown: string }).markdown).not.toContain(
      'manual_reviews_chunk',
    );
    const callsAfterFailure = invokeModel.mock.calls.length;

    const completed = await runQuotationPreflight(runnerInput(invokeModel, executeLookup));
    expect(completed.status).toBe('completed');
    expect(invokeModel.mock.calls.length).toBe(callsAfterFailure + 2);
    const childInputs = invokeModel.mock.calls
      .filter(([input]) => input.role === 'child')
      .map(([input]) => JSON.parse(input.input) as { chunk: string; customer: string });
    expect(childInputs).toHaveLength(3);
    expect(
      childInputs.every(
        (payload) => !/sourceRows|sourceRowId|quote_lineage/iu.test(JSON.stringify(payload)),
      ),
    ).toBe(true);
    expect(childInputs.map((payload) => Object.keys(payload).sort())).toEqual([
      ['chunk', 'customer'],
      ['chunk', 'customer'],
      ['chunk', 'customer'],
    ]);
    expect(
      childInputs.map((payload) =>
        parseMarkdownTables(payload.chunk)[0]!.rows.map((row) => row[1]),
      ),
    ).toEqual([Array.from({ length: 30 }, (_, index) => `P${index + 1}`), ['P31'], ['P31']]);
    expect(childInputs.every((payload) => payload.customer === customerMarkdown)).toBe(true);
    expect(mainInputs).toHaveLength(1);
    const mainInput = JSON.parse(mainInputs[0]!) as {
      order: string;
      customer: string;
      system_order: string;
    };
    expect(mainInput.order).toBe(orderMarkdown(31));
    expect(mainInput.customer).toBe(customerMarkdown);
    expect(parseMarkdownTables(mainInput.system_order)[0]!.rows).toHaveLength(31);
    expect(mainInput.system_order).not.toContain('manual_reviews_chunk');
    expect(executeLookup).toHaveBeenCalledTimes(2);
  });

  it('completes a no-data child after a failed structured lookup and gives main the merged child table', async () => {
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
    const mainInput = JSON.parse(mainInputs[0]!) as {
      system_order: string;
      review_remarks: string;
    };
    expect(mainInput.system_order).toContain('## system_order');
    expect(mainInput.review_remarks).toContain('## system_order_chunk');
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
    const running = runQuotationPreflight(
      runnerInput(invokeModel, executeLookup, {
        signal: controller.signal,
        publishFinal,
      }),
    );
    await childStarted;
    await service.cancelRun({ scope, runId: run.runId });
    controller.abort(new Error('cancel requested'));
    await expect(running).resolves.toEqual({ status: 'cancelled' });
    expect(publishFinal).not.toHaveBeenCalled();
    expect((await service.readState(scope))?.activeRun?.status).toBe('cancelled');
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
    const model = createModel({
      onChild: async (input) => {
        await input.lookup?.('actual-call', { queries: [{ queryId: 'q1' }] });
        controller.abort(new Error('interrupted after lookup'));
        throw new Error('interrupted after lookup');
      },
    });
    await expect(
      runQuotationPreflight(
        runnerInput(model, createLookupExecutor(), { signal: controller.signal }),
      ),
    ).rejects.toThrow('interrupted after lookup');
    const history = await readQuotationHistory({ scope, runId: run.runId });
    expect(history.preflightToolCalls).toEqual([
      expect.objectContaining({ id: expect.stringContaining(':actual-call'), progress: 1 }),
    ]);
    expect(history.activityEvents).toEqual([
      expect.objectContaining({ status: 'interrupted', completedChunks: 0, totalChunks: 1 }),
    ]);
    expect(
      await readQuotationHistory({
        scope: { ...scope, userId: 'another-owner' },
        runId: run.runId,
      }),
    ).toEqual(createSteelNativeHistory());
    expect(await readQuotationHistory({ scope, runId: 'another-run' })).toEqual(
      createSteelNativeHistory(),
    );
    await service.cancelRun({ scope, runId: run.runId });
    const onHistory = jest.fn();
    await runQuotationPreflight({ ...runnerInput(model, createLookupExecutor()), onHistory });
    expect(onHistory.mock.calls[0]?.[0].activityEvents).toEqual([
      expect.objectContaining({ status: 'cancelled', completedChunks: 0 }),
    ]);
  });

  it('retains the committed current projection for terminal adoption', async () => {
    const run = await prepareRun(1);
    const model = createModel();
    await expect(runQuotationPreflight(runnerInput(model, createLookupExecutor()))).resolves.toMatchObject({ status: 'completed' });
    const current = (await service.readState(scope))?.currentSystemOrder;
    expect(current).toEqual(expect.objectContaining({ runId: run.runId, messageId: 'target-1' }));
    expect(current?.markdown).toContain('## system_order');
    expect(current?.markdown).not.toContain('## customer_quote');
  });

});
