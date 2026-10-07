import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMethods, createModels, createSteelReviewWriteMethods, createSteelQuotationInputMethods,
  createSteelQuotationStateModel, createSteelQuotationArtifactModel, createSteelReviewOutputModel,
} from '@librechat/data-schemas';
import type {
  SteelQuotationActiveRun,
  SteelMarkdownReference,
  SteelQuotationOcrInput,
  SteelQuotationScope,
  SteelQuotationSnapshotPayload,
} from '@librechat/data-schemas';
import type { SteelMarkdownCompletionInput } from '../markdown/completion';
import type { QuotationModelInput, QuotationModelResult } from './model';
import type { OpenAIOAuthModelOptions } from '../native/oauth';
import type { SteelToolResult } from '../tools/results';
import {
  commitQuotationCustomerResponse,
  prepareQuotationTurn,
  renderQuotationCustomerMarkdown,
} from './preparation';
import { createSteelMarkdownCompletionServices } from '../markdown/completion';
import { createSteelQuotationPublicationPublisher } from './publication';
import { acceptQuotationSignal, runQuotationPreflight } from './runner';
import { createSteelFullMarkdownPublisher } from '../markdown/full';
import { createSteelQuotationStateService } from './state';
import { createSteelOcrStateService } from '../ocr/state';
import { parseMarkdownTables } from '../markdown/table';
import { createSteelReviewService } from '../review';
import { quotationStatus } from './routes';

jest.mock('../native/context', () => ({
  buildDefaultSteelGlobalAgentContext: jest.fn(async ({ mode }: { mode: string }) => ({ instructionPrefix: mode })),
}));

const scope: SteelQuotationScope = {
  userId: '507f1f77bcf86cd799439011',
  conversationId: '6bf991da-be8c-5300-bd85-ff6ee2d17bb5',
};
const ocrHeaders = ['來源', '零件編號', '類別', '數量', '厚度', '寬度', '長度'];
const systemHeaders = [
  '型號', '品名規格', '材質編號', '單位', '數量', '單重', '總數', '單價', '計價基準',
  '公式編號', '厚度', '寬度', '長度', '肚', '類別', '零件編號', '備註',
];

function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function orderMarkdown(quantity: string): string {
  return [
    '## source_file_mapping',
    '',
    markdownTable(['來源', '檔名'], [['F1', 'order.pdf']]),
    '',
    '## ocr_result',
    '',
    markdownTable(ocrHeaders, [['F1', 'P1', '鐵板', quantity, '6', '100', '200']]),
  ].join('\n');
}

function systemRow(source: readonly string[]): readonly string[] {
  return [
    'ERP-PLATE',
    `鐵板 6T ${source[1] ?? ''}`.trim(),
    '黑鐵', 'Kg', source[3] ?? '', '', source[3] ?? '', '12', '2', 'PL',
    source[4] ?? '', source[5] ?? '', source[6] ?? '', '', '鐵板', source[1] ?? '', '',
  ];
}

function childMarkdown(rows: readonly (readonly string[])[]): string {
  return markdownTable(systemHeaders, rows);
}

function lookupResult(): SteelToolResult {
  return {
    ok: true as const,
    toolName: 'search_price_candidates',
    data: {
      queryResults: [{
        queryId: 'q1',
        status: 'ok',
        candidates: [{
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
        }],
      }],
    },
    durationMs: 1,
    redactionVersion: 1,
  };
}

let server: MongoMemoryReplSet;
let db: ReturnType<typeof createMethods>;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  const models = createModels(mongoose);
  await Promise.all(Object.values(models).map((model) => model.init()));
  db = createMethods(mongoose);
}, 60000);

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  await mongoose.models.Conversation.create({ ...scope, user: scope.userId, endpoint: 'agents' });
  await mongoose.models.File.create({
    user: scope.userId,
    conversationId: scope.conversationId,
    file_id: 'order-file',
    filename: 'order.pdf',
    filepath: '/test/order.pdf',
    type: 'application/pdf',
    bytes: 1,
    source: 'local',
  });
  await mongoose.models.File.create({
    user: scope.userId,
    conversationId: scope.conversationId,
    file_id: 'order-file-2',
    filename: 'replacement.pdf',
    filepath: '/test/replacement.pdf',
    type: 'application/pdf',
    bytes: 1,
    source: 'local',
  });
  await createSteelOcrStateService(mongoose).allocateDelegateSourceMapping({
    conversationId: scope.conversationId,
    fileId: 'order-file',
    sourceFilename: 'order.pdf',
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

async function publishAi(markdown = orderMarkdown('2')) {
  const responseId = 'assistant-ai';
  const generationId = 'ai-2';
  const quotation = await prepareQuotationTurn({
    scope,
    messageId: 'user-ai',
    responseId,
    generationId,
    publicationStore: db,
    text: '請整理訂單',
  });
  let physical = markdown;
  const persist = jest.fn(async () => db.saveMessage(
    { userId: scope.userId },
    { ...scope, messageId: responseId, user: scope.userId, text: physical, isCreatedByUser: false },
    { context: 'quotation input integration test' },
  ));
  const input: SteelMarkdownCompletionInput = {
    req: {
      user: { id: scope.userId },
      cookies: { lang: 'zh-TW' },
      steelNativeContext: { requestId: responseId, quotation },
    },
    responseId,
    generationId,
    markdown,
    completed: true,
    applyMarkdown: (value) => { physical = value; },
    persistMarkdown: persist,
    publishMarkdown: createSteelFullMarkdownPublisher({
      buildMessage: ({ markdown: clean }) => ({
        ...scope,
        messageId: responseId,
        user: scope.userId,
        text: clean,
        isCreatedByUser: false,
      }),
      savePublication: db.publishSteelMarkdown,
    }),
  };
  const result = await createSteelMarkdownCompletionServices({
    ocr: createSteelOcrStateService(mongoose),
    quotation: createSteelQuotationStateService(mongoose),
  }).finalize(input);
  expect(persist).not.toHaveBeenCalled();
  return { result, input };
}

async function saveHuman(quantity: string) {
  const review = createSteelReviewService({
    reader: db,
    writer: createSteelReviewWriteMethods(mongoose),
  });
  const { table } = await review.read({ ...scope, messageId: 'assistant-ai', kind: 'ocr_result', title: 'ocr_result' });
  const prepared = await review.prepare({
    ...scope,
    messageId: 'assistant-ai',
    title: table.title,
    kind: table.kind,
    outputId: table.outputId,
    revision: table.revision,
    operations: [{
      type: 'update',
      rowId: table.rows[0].rowId,
      changes: [{ header: '數量', value: quantity }],
    }],
  });
  if (!('operationRequest' in prepared)) throw new Error('Missing operation request');
  return review.commit({
    ...scope,
    ...prepared.operationRequest,
    operationId: prepared.operationId,
    digest: prepared.digest,
  });
}

function createRealQuotationPublisher() {
  return createSteelQuotationPublicationPublisher({
    scope,
    buildMessage: ({ targetMessageId, markdown }) => ({
      messageId: targetMessageId,
      sourceMessageId: targetMessageId,
      conversationId: scope.conversationId,
      user: scope.userId,
      text: markdown,
      isCreatedByUser: false,
      unfinished: false,
    }),
    savePublication: db.saveSteelQuotationMessage,
  });
}

function createReviewServiceWithSourceAuthority() {
  return createSteelReviewService({
    reader: db,
    writer: createSteelReviewWriteMethods(mongoose),
    sourceAuthority: {
      readMetadata: async ({ fileId }) => {
        const file = await mongoose.models.File.findOne({ file_id: fileId }).lean<{ file_id: string; filename: string; type?: string }>();
        return file ? { fileId, filename: file.filename, mediaType: file.type ?? 'application/pdf' } : null;
      },
      readPageCount: async () => ({ pageCount: 1 }),
    },
  });
}

async function saveHumanSourceCorrection() {
  const review = createReviewServiceWithSourceAuthority();
  const { table } = await review.read({ ...scope, messageId: 'assistant-ai', kind: 'ocr_result', title: 'ocr_result' });
  const prepared = await review.prepare({
    ...scope,
    messageId: 'assistant-ai',
    title: table.title,
    kind: table.kind,
    outputId: table.outputId,
    revision: table.revision,
    operations: [{
      type: 'update',
      rowId: table.rows[0].rowId,
      source: { fileId: 'order-file-2', pageNumber: null },
    }],
  });
  if (!('operationRequest' in prepared)) throw new Error('Missing source operation request');
  return review.commit({
    ...scope,
    ...prepared.operationRequest,
    operationId: prepared.operationId,
    digest: prepared.digest,
  });
}

async function admitPublishedHumanRun(): Promise<{
  service: ReturnType<typeof createSteelQuotationStateService>;
  run: SteelQuotationActiveRun;
  input: SteelQuotationOcrInput;
  snapshot: SteelQuotationSnapshotPayload;
}> {
  await publishAi();
  await saveHuman('3');
  const service = createSteelQuotationStateService(mongoose);
  const prepared = await prepareQuotationTurn({
    scope,
    messageId: 'user-human',
    responseId: 'assistant-human',
    generationId: 'human-3',
    publicationStore: db,
    text: '請使用已保存的 OCR 報價',
  });
  if (!prepared.state.currentOrder?.ocrSelection) throw new Error('Human OCR was not selected');
  const input = await service.readOcrInput(scope);
  if (!input) throw new Error('Quotation OCR input was not prepared');
  const customerResponse = `${renderQuotationCustomerMarkdown({ tier: 'B' })}\n\n## quote_signal\n\nstart`;
  await commitQuotationCustomerResponse({
    scope,
    response: customerResponse,
    responseId: 'customer-response',
    messageId: 'customer-message',
    messageText: '使用預設 B tier，報價',
    expectedOrderHash: prepared.state.currentOrder.sha256,
    service,
  });
  const ready = await service.readState(scope);
  const run = await acceptQuotationSignal({
    scope,
    response: '## quote_signal\n\nstart',
    responseId: 'quote-response',
    messageId: 'quote-message',
    expectedOrderHash: ready?.currentOrder?.sha256,
    expectedCustomerPreparationId: ready?.currentCustomer?.preparationId,
    finishReason: 'stop',
    service,
  });
  if (!run) throw new Error('Quotation run was not admitted');
  const payload = await service.readArtifact({ scope, ref: run.snapshotRef });
  if (!payload) throw new Error('Quotation snapshot was not saved');
  return { service, run, input, snapshot: JSON.parse(payload) as SteelQuotationSnapshotPayload };
}

function createRunnerModel(childInputs: string[], mainInputs: string[]) {
  return jest.fn(async (input: QuotationModelInput): Promise<QuotationModelResult> => {
    if (input.role === 'main') {
      mainInputs.push(input.input);
      return { markdown: '無待複核事項。', lookups: [], pythonEvidence: [] };
    }
    childInputs.push(input.input);
    const payload = JSON.parse(input.input) as { chunk: string };
    const rows = parseMarkdownTables(payload.chunk)[0]?.rows ?? [];
    await input.lookup?.('lookup', { queries: [{ queryId: 'q1' }] });
    return { markdown: childMarkdown(rows.map(systemRow)), lookups: [], pythonEvidence: [] };
  });
}

it('selects the newer human Save, freezes its clean Markdown and mappings at admission, and keeps later Save outside the run', async () => {
  const { service, run, input, snapshot } = await admitPublishedHumanRun();
  expect(input.selection.candidates.ai?.source).toBe('ai');
  expect(input.selection.candidates.human?.source).toBe('human');
  expect(new Date(input.selection.candidates.human!.savedAt).getTime())
    .toBeGreaterThan(new Date(input.selection.candidates.ai!.savedAt).getTime());
  expect(input.selection.selected.source).toBe('human');
  expect(input.markdown).toContain('| F1 | P1 |');
  expect(snapshot.orderMarkdown).toBe(input.markdown);
  expect(snapshot.ocrSelection).toEqual(JSON.parse(JSON.stringify(run.ocrSelection)));
  expect(snapshot.sourceSnapshot).toEqual(input.sourceSnapshot);
  expect(snapshot.sourceSnapshot?.mappings).toEqual([{ fileId: 'order-file', sourceCode: 'F1', sourceFilename: 'order.pdf' }]);

  const status = quotationStatus(await service.readState(scope), scope.conversationId);
  expect(status.ocrSource).toMatchObject({
    source: 'human',
    version: input.selection.version,
    messageId: input.selection.selected.messageId,
    outputId: input.selection.selected.outputId,
    title: input.selection.selected.title,
    revision: input.selection.selected.revision,
  });
  expect(status.ocrSource?.humanSavedAt).toBe(new Date(input.selection.selected.savedAt).toISOString());

  await saveHuman('4');
  const after = await service.readState(scope);
  const current = await service.readOcrInput(scope);
  expect(current?.markdown).toContain('| F1 | P1 | 鐵板 | 4 |');
  expect(after?.activeRun?.runId).toBe(run.runId);
  const frozenPayload = JSON.parse((await service.readArtifact({ scope, ref: run.snapshotRef }))!) as SteelQuotationSnapshotPayload;
  expect(frozenPayload.orderMarkdown).toBe(snapshot.orderMarkdown);
  expect(frozenPayload.ocrSelection).toEqual(snapshot.ocrSelection);
  expect(frozenPayload.sourceSnapshot).toEqual(snapshot.sourceSnapshot);
});

it('restores a fresh service and resumes child/main from the admitted snapshot', async () => {
  const { service, run, snapshot } = await admitPublishedHumanRun();
  await saveHuman('4');
  const restoredService = createSteelQuotationStateService(mongoose);
  expect((await restoredService.readState(scope))?.activeRun?.runId).toBe(run.runId);
  expect(await restoredService.readArtifact({ scope, ref: run.snapshotRef })).toBe(JSON.stringify(snapshot));

  const childInputs: string[] = [];
  const mainInputs: string[] = [];
  const model = createRunnerModel(childInputs, mainInputs);
  const publishFinal = createRealQuotationPublisher();
  const result = await runQuotationPreflight({
    scope,
    modelOptions: {} as OpenAIOAuthModelOptions,
    signal: new AbortController().signal,
    invokeModel: model,
    executeLookup: jest.fn(async () => lookupResult()),
    publishFinal,
  });
  expect(result.status).toBe('completed');
  expect(childInputs).toHaveLength(1);
  expect(childInputs[0]).toContain('| F1 | P1 | 鐵板 | 3 |');
  expect(childInputs[0]).not.toContain('| F1 | P1 | 鐵板 | 4 |');
  expect(mainInputs).toHaveLength(1);
  expect(mainInputs[0]).toContain('| F1 | P1 | 鐵板 | 3 |');
  expect(mainInputs[0]).not.toContain('| F1 | P1 | 鐵板 | 4 |');
  const completed = await service.readState(scope);
  expect(completed?.activeRun?.status).toBe('completed');
  expect(completed?.currentSystemOrder?.needsRequote).toBe(true);
  expect(completed?.currentSystemOrder?.ocrSelection).toEqual(completed?.activeRun?.ocrSelection);
  expect(completed?.currentSystemOrder?.sourceSnapshot).toEqual(snapshot.sourceSnapshot);
  const finalMessage = await db.getMessage({ user: scope.userId, messageId: run.targetMessageId! });
  expect(finalMessage?.text).toContain('## system_order');
  expect(finalMessage?.text).toContain('## quote_summary');
  expect(finalMessage?.metadata).toEqual(expect.objectContaining({ steelMarkdownOwners: expect.any(Object) }));
  const review = createSteelReviewService({ reader: db, writer: createSteelReviewWriteMethods(mongoose) });
  const systemReview = await review.read({ ...scope, messageId: run.targetMessageId!, kind: 'system_order', title: 'system_order' });
  expect(systemReview.table.sourceMappings).toEqual(snapshot.sourceSnapshot?.mappings);

  const replayModel = createRunnerModel([], []);
  const replay = await runQuotationPreflight({
    scope,
    modelOptions: {} as OpenAIOAuthModelOptions,
    signal: new AbortController().signal,
    invokeModel: replayModel,
    executeLookup: jest.fn(async () => lookupResult()),
    publishFinal: publishFinal,
  });
  expect(replay.status).toBe('completed');
  expect(replay.markdown).toBe(result.markdown);
  expect((await db.getMessage({ user: scope.userId, messageId: run.targetMessageId! }))?.text).toBe(finalMessage?.text);
  expect(await service.readArtifact({ scope, ref: run.snapshotRef })).toBeUndefined();
});

it('marks a completed quotation stale after a source-only human Save while retaining its source authority', async () => {
  const { service, run, snapshot } = await admitPublishedHumanRun();
  const childInputs: string[] = [];
  const mainInputs: string[] = [];
  const result = await runQuotationPreflight({
    scope,
    modelOptions: {} as OpenAIOAuthModelOptions,
    signal: new AbortController().signal,
    invokeModel: createRunnerModel(childInputs, mainInputs),
    executeLookup: jest.fn(async () => lookupResult()),
    publishFinal: createRealQuotationPublisher(),
  });
  expect(result.status).toBe('completed');
  expect((await service.readState(scope))?.currentSystemOrder?.needsRequote).toBeFalsy();

  await saveHumanSourceCorrection();
  const after = await service.readState(scope);
  expect(after?.currentSystemOrder?.needsRequote).toBe(true);
  expect(after?.currentSystemOrder?.ocrSelection).toEqual(after?.activeRun?.ocrSelection);
  expect(after?.currentSystemOrder?.sourceSnapshot).toEqual(snapshot.sourceSnapshot);
  expect(await service.readArtifact({ scope, ref: run.snapshotRef })).toBeUndefined();
});



it('retains the same input after publication failure and cleans it only after successful retry', async () => {
  const { service, run, snapshot } = await admitPublishedHumanRun();
  const model = createRunnerModel([], []);
  const runnerInput = {
    scope, modelOptions: {} as OpenAIOAuthModelOptions, signal: new AbortController().signal,
    invokeModel: model, executeLookup: jest.fn(async () => lookupResult()),
  };
  await expect(runQuotationPreflight({ ...runnerInput,
    publishFinal: async () => ({ ok: false as const, code: 'superseded' as const }),
  })).rejects.toThrow();
  expect((await service.readState(scope))?.activeRun?.status).toBe('completed');
  expect(await service.readArtifact({ scope, ref: run.snapshotRef })).toBe(JSON.stringify(snapshot));
  expect(await service.getArtifact({ scope, runId: run.runId, operationId: 'published' })).toBeNull();
  await saveHuman('4');
  const completedCalls = model.mock.calls.length;
  await expect(runQuotationPreflight({ ...runnerInput, publishFinal: createRealQuotationPublisher() }))
    .resolves.toMatchObject({ status: 'completed' });
  expect(model).toHaveBeenCalledTimes(completedCalls);
  expect(await service.readArtifact({ scope, ref: run.snapshotRef })).toBeUndefined();
  expect((await service.readState(scope))?.currentSystemOrder?.ocrSelection).toEqual(run.ocrSelection);
});

it.each(['ai', 'human'] as const)('atomically rejects a first %s candidate appearing after no-reference preparation', async (source) => {
  const State = createSteelQuotationStateModel(mongoose);
  let humanReference: SteelMarkdownReference | undefined;
  if (source === 'human') {
    await publishAi();
    await saveHuman('7');
    humanReference = (await State.findOne(scope).lean())?.markdownPublication?.lastHumanOcr;
    if (!humanReference) throw new Error('Missing successfully saved human candidate');
    await State.updateOne(scope, { $unset: {
      'markdownPublication.current.ocr_result': 1, 'markdownPublication.lastHumanOcr': 1,
    } });
  }
  const methods = createSteelQuotationInputMethods(mongoose);
  const service = createSteelQuotationStateService(mongoose, {
    ...methods,
    async admitSteelQuotationOcrInput(input) {
      // Introduce the real publication between public prechecks and atomic admission.
      if (source === 'ai') await publishAi();
      else await State.updateOne(scope, { $set: { 'markdownPublication.lastHumanOcr': humanReference } });
      return methods.admitSteelQuotationOcrInput(input);
    },
  });
  await service.setOrder({ scope, fullMarkdown: orderMarkdown('2'), revision: 'legacy' });
  const customerMarkdown = renderQuotationCustomerMarkdown({ tier: 'B' });
  const ticket = await service.issueTicket({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
    triggeringMessageId: 'legacy-quote', selectionProvenance: { method: 'default_tier' } });
  if (!ticket) throw new Error('Missing no-reference quotation ticket');
  expect((await service.readState(scope))?.currentOrder?.ocrSelection).toBeUndefined();
  await expect(service.acceptSignal({ scope, index: ticket.index, token: ticket.token,
    orderHash: ticket.orderHash, customerMarkdown, customerIdentity: ticket.customerIdentity,
    prompts: { child: 'child', main: 'main' }, chunks: [{ index: 1, sourceRowCount: 1 }] }))
    .rejects.toMatchObject({ code: 'concurrent_change' });
  expect((await service.readState(scope))?.activeRun).toBeUndefined();
  expect(await createSteelQuotationArtifactModel(mongoose).countDocuments({ ...scope, kind: 'snapshot' })).toBe(0);
});

it('rejects a present human candidate whose exact saved receipt or version proof no longer verifies', async () => {
  await publishAi();
  await saveHuman('7');
  const service = createSteelQuotationStateService(mongoose);
  const State = createSteelQuotationStateModel(mongoose);
  const Output = createSteelReviewOutputModel(mongoose);
  const state = await State.findOne(scope).lean();
  const human = state?.markdownPublication?.lastHumanOcr;
  const output = await Output.findOne(scope).lean();
  if (!human || !output) throw new Error('Missing successful human evidence');
  for (const update of [
    { 'receipts.0.digest': 'different-digest' },
    { 'receipts.0.revision': 'different-revision' },
    { 'receipts.0.snapshot.savedAt': new Date(human.savedAt.getTime() + 1) },
    { 'receipts.0.snapshot.title': 'different-title' },
  ]) {
    await Output.updateOne(scope, { $set: update });
    await expect(service.prepareOcrOrder(scope, state?.currentOrder?.sha256 ?? null))
      .rejects.toMatchObject({ code: 'invalid_snapshot' });
    await Output.updateOne(scope, { $set: { receipts: output.receipts } });
  }
  await State.updateOne(scope, { $set: { 'markdownPublication.lastHumanOcr.version': (human.version ?? 2) + 1 } });
  await expect(service.readOcrInput(scope)).rejects.toMatchObject({ code: 'invalid_snapshot' });
  await State.updateOne(scope, { $set: { 'markdownPublication.lastHumanOcr': human } });
  await Output.deleteOne(scope);
  await expect(service.readOcrInput(scope)).rejects.toMatchObject({ code: 'invalid_snapshot' });
  expect((await service.readState(scope))?.activeRun).toBeUndefined();
  expect(await createSteelQuotationArtifactModel(mongoose).countDocuments({ ...scope, kind: 'snapshot' })).toBe(0);
});

it('requires the exact historical AI OCR artifact before selecting a human-only candidate', async () => {
  await publishAi();
  await saveHuman('7');
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const aiArtifact = await Artifact.findOne({ ...scope, operationId: 'ai:ocr_result' }).lean();
  if (!aiArtifact?.markdownPublication) throw new Error('Missing original AI OCR artifact');
  await State.updateOne(scope, { $unset: { 'markdownPublication.current.ocr_result': 1 } });
  const service = createSteelQuotationStateService(mongoose);
  expect((await service.readOcrInput(scope))?.selection.selected.source).toBe('human');
  await Artifact.deleteOne({ _id: aiArtifact._id });
  const { _id: _ignored, ...wrongKindArtifact } = aiArtifact;
  await Artifact.create({ ...wrongKindArtifact, operationId: 'ai:customer_data', markdownPublication: {
    ...aiArtifact.markdownPublication, reference: { ...aiArtifact.markdownPublication.reference, kind: 'customer_data' },
  } });
  await expect(service.readOcrInput(scope)).rejects.toMatchObject({ code: 'invalid_snapshot' });
});
