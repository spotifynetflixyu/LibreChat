import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  createMethods,
  createModels,
  createSteelQuotationArtifactModel,
  createSteelQuotationStateModel,
  createSteelReviewWriteMethods,
} from '@librechat/data-schemas';
import type {
  ISteelQuotationArtifact,
  SteelMarkdownReference,
  SteelQuotationActiveRun,
  SteelQuotationArtifactRef,
  SteelQuotationCheckpointRef,
  SteelQuotationCurrentSystemOrder,
  SteelQuotationOcrSelection,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import type { SteelQuotationMessagePublication } from 'librechat-data-provider';
import type { SteelMarkdownCompletionInput, SteelPublishedResponsePort } from './completion';
import { createSteelQuotationErrorAppender, projectSteelQuotationTerminalMessage } from '../quotation/wiring';
import { createSteelMarkdownCompletionServices, shouldDeferSteelMarkdownPersistence } from './completion';
import { prepareQuotationTurn, renderQuotationCustomerMarkdown } from '../quotation/preparation';
import { normalizeSystemOrderMarkdown, systemOrderColumns } from './order';
import { canonicalizeSystemOrderMarkdown } from '../quotation/revision';
import { createSteelQuotationStateService } from '../quotation/state';
import { createSteelOcrResponseAuditService } from '../ocr/audit';
import { createSteelFullMarkdownPublisher } from './full';
import { createSteelOcrStateService } from '../ocr/state';
import { createSteelReviewService } from '../review';
import * as runner from '../quotation/runner';

const scope: SteelQuotationScope = {
  userId: '507f1f77bcf86cd799439011',
  conversationId: '6bf991da-be8c-5300-bd85-ff6ee2d17bb5',
};
const order = (quantity: string) =>
  `## ocr_result\n\n| 類別 | 零件編號 | 數量 | 來源 |\n| --- | --- | --- | --- |\n| 鋼板 | P1 | ${quantity} | 文字訂單 |`;
let server: MongoMemoryReplSet;
let db: ReturnType<typeof createMethods>;
let State: ReturnType<typeof createSteelQuotationStateModel>;
let Artifact: ReturnType<typeof createSteelQuotationArtifactModel>;
const services = () => ({
  ocr: createSteelOcrStateService(mongoose),
  quotation: createSteelQuotationStateService(mongoose),
});
beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  const models = createModels(mongoose);
  await Promise.all(Object.values(models).map((model) => model.init()));
  State = createSteelQuotationStateModel(mongoose);
  Artifact = createSteelQuotationArtifactModel(mongoose);
  db = createMethods(mongoose);
}, 60000);
beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
  await mongoose.models.Conversation.create({ ...scope, user: scope.userId, endpoint: 'agents' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function turn(
  markdown: string,
  responseId = 'assistant-2',
  generationId = 'ai-2',
  text = '數量2',
) {
  const quotation = await prepareQuotationTurn({
    scope,
    messageId: `user-${generationId}`,
    responseId,
    generationId,
    publicationStore: db,
    text,
  });
  let physical = markdown;
  const persist = jest.fn(async () =>
    db.saveMessage(
      { userId: scope.userId },
      {
        ...scope,
        messageId: responseId,
        user: scope.userId,
        text: physical,
        isCreatedByUser: false,
      },
      { context: 'ordinary completion test' },
    ),
  );
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
    applyMarkdown: (value) => {
      physical = value;
    },
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
  return {
    input,
    persist,
    run: () => createSteelMarkdownCompletionServices(services()).finalize(input),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalSystemOrder(value: string): string {
  const cells = [
    'M-1',
    value,
    'MAT-1',
    '10',
    '2',
    '20',
    '6',
    '100',
    '200',
    '0',
    'kg',
    '鋼板',
    '1',
    'kg',
    'F1',
    '',
  ];
  const raw = [
    '## system_order',
    '',
    `| ${systemOrderColumns.join(' | ')} |`,
    `| ${systemOrderColumns.map(() => '---').join(' | ')} |`,
    `| ${cells.join(' | ')} |`,
  ].join('\n');
  const normalized = normalizeSystemOrderMarkdown(raw);
  const canonical = canonicalizeSystemOrderMarkdown(normalized);
  if (!canonical) throw new Error('Failed to build canonical system order fixture');
  return canonical.markdown;
}

interface DurableOrderFixture {
  fixture: Awaited<ReturnType<typeof turn>>;
  run: SteelQuotationActiveRun;
  systemOrder: SteelQuotationCurrentSystemOrder;
  targetMessageId: string;
  owner: SteelMarkdownReference;
  publication: SteelQuotationMessagePublication;
  publishedResponse: SteelPublishedResponsePort;
}

async function seedPublishedOrder(
  rawMarkdown: string,
  options: {
    owner?: boolean;
    runOcrSelection?: SteelQuotationOcrSelection;
    systemOrderMarkdown?: string;
    normalizedMarkdown?: string;
    targetMessageId?: string;
    runId?: string;
  } = {},
): Promise<DurableOrderFixture> {
  const quotation = services().quotation;
  const prepared = await quotation.setOrder({
    scope,
    fullMarkdown: order('2'),
    revision: 'ocr-source',
    messageId: 'ocr-source-message',
  });
  if (!prepared.currentOrder) throw new Error('Missing quotation order fixture');
  const customer = await quotation.saveCustomer({
    scope,
    customerMarkdown: renderQuotationCustomerMarkdown({ tier: 'B' }),
    customerIdentity: 'fixture-customer',
    triggeringMessageId: 'user-ai-2',
    responseId: 'ai-2',
    orderHash: prepared.currentOrder.sha256,
    selectionProvenance: { method: 'unique' },
  });
  const fixture = await turn(rawMarkdown);
  const admission = fixture.input.req.steelNativeContext?.quotation?.publicationAdmission;
  if (!admission) throw new Error('Missing quotation publication admission');

  const runId = options.runId ?? 'quotation-run-error';
  const targetMessageId = options.targetMessageId ?? 'canonical-target';
  const canonical = canonicalSystemOrder('canonical');
  const normalizedMarkdown = options.normalizedMarkdown ?? canonical;
  const systemOrderMarkdown = options.systemOrderMarkdown ?? normalizedMarkdown;
  const normalizedSha256 = sha256(normalizedMarkdown);
  const systemOrderSha256 = sha256(systemOrderMarkdown);
  const now = new Date();
  const snapshotPayload = JSON.stringify({
    orderHash: prepared.currentOrder.sha256,
    customerIdentity: customer.customerIdentity,
    customerMarkdown: customer.customerMarkdown,
    ...(options.runOcrSelection ? { ocrSelection: options.runOcrSelection } : {}),
  });
  const snapshotSha256 = sha256(snapshotPayload);
  const receipt = {
    version: 1 as const,
    runId,
    targetMessageId,
    outputId: `system_order:${runId}`,
    inputSnapshotSha256: snapshotSha256,
    normalizedSha256,
    systemOrderSha256: normalizedSha256,
  };
  const publicationPayload = JSON.stringify(receipt);
  const snapshotRef: SteelQuotationArtifactRef = {
    artifactId: `${runId}:snapshot:${snapshotSha256}`,
    userId: scope.userId,
    conversationId: scope.conversationId,
    runId,
    operationId: 'snapshot',
    kind: 'snapshot',
    sha256: snapshotSha256,
  };
  const normalizedRef: SteelQuotationArtifactRef = {
    artifactId: `${runId}:system-order:normalized:${normalizedSha256}`,
    userId: scope.userId,
    conversationId: scope.conversationId,
    runId,
    operationId: 'system-order:normalized',
    kind: 'main',
    sha256: normalizedSha256,
  };
  const publicationRef: SteelQuotationArtifactRef = {
    artifactId: `${runId}:order-published:${sha256(publicationPayload)}`,
    userId: scope.userId,
    conversationId: scope.conversationId,
    runId,
    operationId: 'order-published',
    kind: 'main',
    sha256: sha256(publicationPayload),
  };
  const checkpointRefs: SteelQuotationCheckpointRef[] = [
    { ...normalizedRef, updatedAt: now },
    { ...publicationRef, updatedAt: now },
  ];
  const run: SteelQuotationActiveRun = {
    runId,
    index: 1,
    status: 'completed',
    triggerMessageId: 'user-ai-2',
    targetMessageId,
    snapshotRef,
    chunks: [{ index: 0, sourceRowCount: 1, status: 'completed' }],
    checkpointRefs,
    ...(options.runOcrSelection ? { ocrSelection: options.runOcrSelection } : {}),
    acceptedAt: now,
    updatedAt: now,
  };
  const systemOrder: SteelQuotationCurrentSystemOrder = {
    runId,
    sha256: systemOrderSha256,
    markdown: systemOrderMarkdown,
    messageId: targetMessageId,
    responseId: fixture.input.responseId,
    updatedAt: now,
  };
  const owner: SteelMarkdownReference = {
    kind: 'system_order',
    source: 'ai',
    snapshotId: `markdown:quotation:${runId}:ai:system_order`,
    generationId: `quotation:${runId}`,
    outputId: receipt.outputId,
    messageId: targetMessageId,
    title: 'system_order',
    revision: runId,
    sha256: normalizedSha256,
    lineageId: admission.lineageId,
    version: 1,
    savedAt: now,
  };
  const effectiveOwner: SteelMarkdownReference = { ...owner, source: 'human', sha256: systemOrderSha256 };
  const baselinePublication = { reference: owner, rawMarkdown: normalizedMarkdown, baselineMarkdown: normalizedMarkdown };
  const baselinePayload = JSON.stringify(baselinePublication);
  await Artifact.create([
    {
      ...scope,
      runId: `markdown:quotation:${runId}`,
      operationId: 'ai:system_order',
      kind: 'main',
      sha256: sha256(baselinePayload),
      payload: baselinePayload,
      markdownPublication: baselinePublication,
    } satisfies Partial<ISteelQuotationArtifact>,
    {
      ...scope,
      runId,
      operationId: snapshotRef.operationId,
      kind: snapshotRef.kind,
      sha256: snapshotSha256,
      payload: snapshotPayload,
      createdAt: now,
      updatedAt: now,
    } satisfies Partial<ISteelQuotationArtifact>,
    {
      ...scope,
      runId,
      operationId: normalizedRef.operationId,
      kind: normalizedRef.kind,
      sha256: normalizedSha256,
      payload: normalizedMarkdown,
      createdAt: now,
      updatedAt: now,
    } satisfies Partial<ISteelQuotationArtifact>,
    {
      ...scope,
      runId,
      operationId: publicationRef.operationId,
      kind: publicationRef.kind,
      sha256: publicationRef.sha256,
      payload: publicationPayload,
      createdAt: now,
      updatedAt: now,
    } satisfies Partial<ISteelQuotationArtifact>,
  ]);
  const updated = await State.findOneAndUpdate(
    { userId: scope.userId, conversationId: scope.conversationId },
    {
      $set: {
        activeRun: run,
        currentSystemOrder: systemOrder,
        'markdownPublication.current.system_order': { ai: owner, effective: effectiveOwner },
      },
    },
    { new: true },
  ).lean();
  if (!updated) throw new Error('Missing published quotation state fixture');
  const publication: SteelQuotationMessagePublication = {
    version: 1,
    runId,
    outputId: receipt.outputId,
    sourceMessageId: fixture.input.responseId,
    admissionSequence: admission.sequence,
    receiptSha256: publicationRef.sha256,
    tableContentIndex: 1,
    summaryContentIndex: 2,
    footerContentIndex: 3,
  };
  await db.saveMessage(
    { userId: scope.userId },
    {
      ...scope,
      messageId: targetMessageId,
      user: scope.userId,
      text: `host prefix\n\n${canonical}`,
      content: [
        { type: 'text', text: 'host prefix' },
        { type: 'text', text: canonical },
        { type: 'text', text: '' },
        { type: 'text', text: '' },
      ],
      isCreatedByUser: false,
      metadata: {
        steelQuotation: publication,
        ...(options.owner === false ? {} : { steelMarkdownOwners: { system_order: owner } }),
      },
    },
    { context: 'terminal quotation recovery test' },
  );
  const publishedResponse: SteelPublishedResponsePort = {
    load: async ({ responseId, conversationId, userId, tenantId }) => {
      const record = await db.getMessage({ user: userId, messageId: responseId });
      return record && record.conversationId === conversationId && record.tenantId === tenantId ? record : null;
    },
    accept: jest.fn(),
  };
  fixture.input.publishedResponse = publishedResponse;
  return { fixture, run, systemOrder, targetMessageId, owner, publication, publishedResponse };
}

it('rejects a new owner collision without reading its OCR into publication audit or mirrors', async () => {
  const fixture = await turn(order('2'));
  const dependencies = services();
  await dependencies.ocr.upsertCurrentOcrResult({
    conversationId: scope.conversationId,
    generationId: 'foreign-ai',
    attemptNumber: 1,
    markdown: order('999'),
  });
  await mongoose.models.Conversation.create({
    conversationId: scope.conversationId,
    user: '507f1f77bcf86cd799439012',
    endpoint: 'agents',
  });
  const audit = createSteelOcrResponseAuditService(mongoose);
  const auditSave = jest.spyOn(audit, 'save');
  await expect(
    createSteelMarkdownCompletionServices({ ...dependencies, audit }).finalize(fixture.input),
  ).rejects.toMatchObject({ code: 'superseded_response' });
  expect(auditSave).toHaveBeenCalledWith(
    expect.objectContaining({ baseResponse: '', baseRevision: undefined }),
  );
  expect(fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: 'assistant-2' })).toBeNull();
  expect((await dependencies.quotation.readState(scope))?.currentOrder).toBeUndefined();
  expect((await dependencies.ocr.readCurrentOcrResult(scope.conversationId))?.markdown).toBe(
    order('999'),
  );
  expect(await dependencies.ocr.readScopedCurrentOcrResult(scope)).toBeUndefined();
});

it('publishes the full clean response and fresh review baseline atomically', async () => {
  const fixture = await turn(order('2'));
  const result = await fixture.run();
  expect(fixture.persist).not.toHaveBeenCalled();
  expect((await db.getMessage({ user: scope.userId, messageId: 'assistant-2' }))?.text).toBe(
    result.markdown,
  );
  expect((await services().ocr.readCurrentOcrResult(scope.conversationId))?.markdown).toBe(
    order('2'),
  );
  expect((await services().quotation.readState(scope))?.currentOrder?.markdown).toBe(order('2'));
  expect(await db.readSteelMarkdownVersions(scope)).toEqual([
    expect.objectContaining({ latest: true, saves: 0, outputId: 'ocr_result:ai-2' }),
  ]);
});

it('projects a durable completed order into the terminal response without republishing raw error text', async () => {
  const fixture = await seedPublishedOrder(canonicalSystemOrder('partial'));
  const load = jest.spyOn(fixture.publishedResponse, 'load');
  const apply = jest.fn(fixture.fixture.input.applyMarkdown);
  fixture.fixture.input.applyMarkdown = apply;
  const notify = jest.fn(async () => undefined);
  fixture.fixture.input.onPublishedResponse = notify;
  const result = await fixture.fixture.run();
  const saved = await db.getMessage({ user: scope.userId, messageId: fixture.targetMessageId });

  expect(result).toMatchObject({
    markdown: saved?.text,
    acceptedRun: { runId: fixture.run.runId, status: 'completed' },
  });
  expect(saved?.text).toContain(canonicalSystemOrder('canonical'));
  expect(load).toHaveBeenCalledWith({
    responseId: fixture.targetMessageId,
    conversationId: scope.conversationId,
    userId: scope.userId,
  });
  expect(fixture.publishedResponse.accept).toHaveBeenCalledWith(saved);
  expect(notify).toHaveBeenCalledWith(saved);
  expect(apply).not.toHaveBeenCalled();
  expect(fixture.fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.fixture.input.responseId })).toBeNull();
});

it('reloads the canonical table, completed prose, and terminal error from one durable message', async () => {
  const published = await seedPublishedOrder('An error occurred while processing the request');
  const admission = published.fixture.input.req.steelNativeContext?.quotation?.publicationAdmission;
  if (!admission) throw new Error('Missing publication admission');
  const summary = await db.appendSteelQuotationSummary({
    scope,
    runId: published.run.runId,
    targetMessageId: published.targetMessageId,
    sourceMessageId: admission.responseId,
    admission,
    summaryMarkdown: 'AI main response.',
    footerMarkdown: '## quote_summary\n\nBackend summary.',
  });
  if (!summary.ok) throw new Error('Missing published summary');
  const response = {
    messageId: admission.responseId,
    conversationId: scope.conversationId,
    user: scope.userId,
    content: [{ type: 'error', error: 'An error occurred while processing the request' }],
  };
  published.publishedResponse.appendErrors = createSteelQuotationErrorAppender({
    response, scope, admission, append: db.appendSteelQuotationErrors,
  });
  await published.fixture.run();
  const reloaded = await db.getMessage({ user: scope.userId, messageId: published.targetMessageId });
  expect(reloaded?.text).toBe(summary.message.text);
  expect(reloaded?.content).toEqual([...summary.message.content!, ...response.content]);
  expect(reloaded?.metadata).toEqual(summary.message.metadata);
  expect(projectSteelQuotationTerminalMessage({ response, saved: reloaded }).content)
    .toEqual(reloaded?.content);
  expect(published.publishedResponse.accept).toHaveBeenCalledWith(reloaded);
  expect(published.fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: admission.responseId })).toBeNull();
});

it('persists unfinished main prose with an error in the canonical message before reloading', async () => {
  const published = await seedPublishedOrder('An error occurred while processing the request');
  const admission = published.fixture.input.req.steelNativeContext?.quotation?.publicationAdmission;
  if (!admission) throw new Error('Missing publication admission');
  const response = {
    messageId: admission.responseId,
    conversationId: scope.conversationId,
    user: scope.userId,
    content: [
      { type: 'text', text: 'host prefix' },
      { type: 'text', text: '' },
      { type: 'text', text: 'Partial AI main response.' },
      { type: 'text', text: '' },
      { type: 'error', error: 'An error occurred while processing the request' },
    ],
  };
  published.publishedResponse.appendErrors = createSteelQuotationErrorAppender({
    response, scope, admission, append: db.appendSteelQuotationErrors,
  });
  await published.fixture.run();
  const reloaded = await db.getMessage({ user: scope.userId, messageId: published.targetMessageId });
  expect(reloaded?.content?.[1]).toEqual({ type: 'text', text: published.systemOrder.markdown });
  expect(reloaded?.content?.[2]).toEqual({ type: 'text', text: 'Partial AI main response.' });
  expect(reloaded?.content?.[4]).toEqual(response.content[4]);
  expect(projectSteelQuotationTerminalMessage({ response, saved: reloaded }).content)
    .toEqual(reloaded?.content);
  expect(reloaded?.text).toContain('Partial AI main response.');
});

it('adopts a completed order after input expiry and summary Stop without republishing its table', async () => {
  const fixture = await seedPublishedOrder('Summary stopped');
  await Artifact.deleteMany({ ...scope, runId: fixture.run.runId, operationId: 'snapshot' });
  const stopped = jest.fn(async () => { throw new Error('Summary stopped'); });
  fixture.fixture.input.assertActive = stopped;
  fixture.fixture.input.completed = false;
  await db.saveMessage({ userId: scope.userId }, {
    ...scope,
    messageId: fixture.targetMessageId,
    user: scope.userId,
    text: `host prefix\n\n${fixture.systemOrder.markdown}\n\n## notes\n\nSummary\n\n## quote_summary\n\nBackend footer`,
    content: [
      { type: 'text', text: 'host prefix' },
      { type: 'text', text: fixture.systemOrder.markdown },
      { type: 'text', text: '## notes\n\nSummary' },
      { type: 'text', text: '## quote_summary\n\nBackend footer' },
    ],
    isCreatedByUser: false,
    metadata: { steelMarkdownOwners: { system_order: fixture.owner }, steelQuotation: fixture.publication },
  });
  const result = await fixture.fixture.run();
  expect(result.acceptedRun?.status).toBe('completed');
  expect(result.markdown).toContain('Backend footer');
  expect(stopped).not.toHaveBeenCalled();
  expect(fixture.fixture.persist).not.toHaveBeenCalled();
});

it('persists a later ordinary reply without adopting the previous completed quotation', async () => {
  const published = await seedPublishedOrder('Original summary');
  const before = await db.getMessage({ user: scope.userId, messageId: published.targetMessageId });
  const later = await turn('A later ordinary answer', 'assistant-3', 'ai-3', '請說明');
  const result = await later.run();
  expect(result.acceptedRun).toBeUndefined();
  expect(later.persist).toHaveBeenCalled();
  expect((await db.getMessage({ user: scope.userId, messageId: 'assistant-3' }))?.text)
    .toContain('A later ordinary answer');
  expect((await db.getMessage({ user: scope.userId, messageId: published.targetMessageId }))?.text)
    .toBe(before?.text);
});

it('rejects an ordinary AI response that tries to publish a replacement system order', async () => {
  const published = await seedPublishedOrder('Original summary');
  const before = (await services().quotation.readState(scope))?.currentSystemOrder;
  const later = await turn(canonicalSystemOrder('AI replacement'), 'assistant-3', 'ai-3', '請說明');
  await expect(later.run()).rejects.toMatchObject({ code: 'invalid_system_order' });
  expect(later.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: 'assistant-3' })).toBeNull();
  expect((await services().quotation.readState(scope))?.currentSystemOrder).toMatchObject({ sha256: before?.sha256 });
  expect((await db.getMessage({ user: scope.userId, messageId: published.targetMessageId }))?.text)
    .toContain(canonicalSystemOrder('canonical'));
});

it('rejects a loaded owned response whose system order differs from the durable canonical table', async () => {
  const fixture = await seedPublishedOrder(canonicalSystemOrder('partial'));
  await db.saveMessage(
    { userId: scope.userId },
    {
      ...scope,
      messageId: fixture.targetMessageId,
      user: scope.userId,
      text: `host prefix\n\n${canonicalSystemOrder('forged')}`,
      isCreatedByUser: false,
      metadata: { steelMarkdownOwners: { system_order: fixture.owner }, steelQuotation: fixture.publication },
    },
    { context: 'terminal quotation recovery mismatch test' },
  );

  await expect(fixture.fixture.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect(fixture.publishedResponse.accept).not.toHaveBeenCalled();
  expect(fixture.fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.fixture.input.responseId })).toBeNull();
});

it('rejects a canonical response without the durable system order owner metadata', async () => {
  const fixture = await seedPublishedOrder(canonicalSystemOrder('partial'), { owner: false });
  await expect(fixture.fixture.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect(fixture.publishedResponse.accept).not.toHaveBeenCalled();
  expect(fixture.fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.fixture.input.responseId })).toBeNull();
});

it('fails closed when the frozen OCR selection does not match the completed run', async () => {
  const ocrReference: SteelMarkdownReference = {
    kind: 'ocr_result',
    source: 'ai',
    snapshotId: 'markdown:ocr-source:ai:ocr_result',
    generationId: 'ocr-source',
    outputId: 'ocr_result:ocr-source',
    messageId: 'ocr-source-message',
    title: 'ocr_result',
    revision: 'ocr-source',
    sha256: 'd'.repeat(64),
    lineageId: 'ocr-lineage',
    version: 1,
    savedAt: new Date(),
  };
  const selection: SteelQuotationOcrSelection = {
    candidates: { ai: ocrReference },
    selected: ocrReference,
    version: 1,
  };
  const fixture = await seedPublishedOrder(canonicalSystemOrder('partial'), {
    runOcrSelection: selection,
  });
  const before = await db.getMessage({ user: scope.userId, messageId: fixture.targetMessageId });
  const load = jest.spyOn(fixture.publishedResponse, 'load');

  await expect(fixture.fixture.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect(load).not.toHaveBeenCalled();
  expect(fixture.publishedResponse.accept).not.toHaveBeenCalled();
  expect(fixture.fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.targetMessageId })).toMatchObject({
    text: before?.text,
  });
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.fixture.input.responseId })).toBeNull();
});

it('rejects raw prose when a self-consistent normalized artifact is not a canonical system order', async () => {
  const nonCanonical = '## system_order\n\n| 品名 | 數量 |\n| --- | ---: |\n| canonical | 2 |';
  const fixture = await seedPublishedOrder('The quotation run failed before completion.', {
    systemOrderMarkdown: nonCanonical,
    normalizedMarkdown: nonCanonical,
  });
  const before = await db.getMessage({ user: scope.userId, messageId: fixture.targetMessageId });
  const load = jest.spyOn(fixture.publishedResponse, 'load');

  await expect(fixture.fixture.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect(load).toHaveBeenCalledWith({ responseId: fixture.targetMessageId, conversationId: scope.conversationId, userId: scope.userId });
  expect(fixture.publishedResponse.accept).not.toHaveBeenCalled();
  expect(fixture.fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.targetMessageId })).toMatchObject({
    text: before?.text,
  });
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.fixture.input.responseId })).toBeNull();
});

it('maps an authoritative publication read outage to response_save_failed', async () => {
  const fixture = await seedPublishedOrder(canonicalSystemOrder('partial'));
  const dependencies = services();
  jest.spyOn(dependencies.quotation, 'readState').mockRejectedValue(new Error('database unavailable'));
  const load = jest.spyOn(fixture.publishedResponse, 'load');

  await expect(
    createSteelMarkdownCompletionServices(dependencies).finalize(fixture.fixture.input),
  ).rejects.toMatchObject({ code: 'response_save_failed' });
  expect(load).not.toHaveBeenCalled();
  expect(fixture.publishedResponse.accept).not.toHaveBeenCalled();
  expect(fixture.fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.fixture.input.responseId })).toBeNull();
});

it('rejects a malformed effective system order even when the normalized AI baseline is canonical', async () => {
  const malformedEffective = '## system_order\n\n| 品名 | 數量 |\n| --- | ---: |\n| effective | 3 |';
  const fixture = await seedPublishedOrder(canonicalSystemOrder('partial'), {
    systemOrderMarkdown: malformedEffective,
  });
  const before = await db.getMessage({ user: scope.userId, messageId: fixture.targetMessageId });
  const load = jest.spyOn(fixture.publishedResponse, 'load');

  await expect(fixture.fixture.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect(load).toHaveBeenCalledWith({ responseId: fixture.targetMessageId, conversationId: scope.conversationId, userId: scope.userId });
  expect(fixture.publishedResponse.accept).not.toHaveBeenCalled();
  expect(fixture.fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.targetMessageId })).toMatchObject({
    text: before?.text,
  });
  expect(await db.getMessage({ user: scope.userId, messageId: fixture.fixture.input.responseId })).toBeNull();
});

it('loads quotation prompt rules through the supplied PostgreSQL client', async () => {
  const quotationOrder = [
    '## ocr_result',
    '',
    '| 來源 | 零件編號 | 類別 | 數量 | 厚度 | 寬度 | 長度 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 文字訂單 | P1 | 鐵板 | 1 | 6 | 100 | 200 |',
  ].join('\n');
  await (await turn(quotationOrder)).run();
  const customer = await turn(
    renderQuotationCustomerMarkdown({ tier: 'B' }),
    'customer-ai',
    'customer-generation',
    '使用B級',
  );
  await customer.run();
  const fixture = await turn(
    '## quote_signal\n\nstart',
    'quote-ai',
    'quote-generation',
    '開始報價',
  );
  fixture.input.stage = 'workflow';
  const rules = ['quote_child', 'quote_main'].map((section, index) => ({
    id: index + 1,
    slug: `test-${section}`,
    version: 1,
    rule_kind: 'agent',
    title: section,
    locale: 'zh-TW',
    rule_sections: [section],
    selectors: {},
    prompt: 'Process the quotation rows.',
    tool_policy: {},
    output_policy: {},
    priority: 1,
    active: true,
    review_state: 'reviewed',
  }));
  const query = jest.fn().mockResolvedValue({ rows: rules });
  const runtimeRulesClient = { query };
  const acceptance = jest.spyOn(runner, 'acceptQuotationSignal');
  const result = await createSteelMarkdownCompletionServices({
    ...services(),
    runtimeRulesClient,
  }).finalize(fixture.input);
  expect(result.acceptedRun).toBeDefined();
  expect(acceptance).toHaveBeenCalledWith(expect.objectContaining({ runtimeRulesClient }));
  expect(query).toHaveBeenCalled();
  expect(query.mock.calls.every(([sql]) => sql.includes('steel.'))).toBe(true);
});

it('overwrites the chat message with the normalized AI baseline while leaving earlier messages intact', async () => {
  const raw =
    '## ocr_result｜測試\n\n| 來源 | 數量 | 長度 | 厚度 | 加工 |\n| --- | --- | --- | --- | --- |\n| 文字訂單 | 2支 | 1.25m | 6.35mm | 切割 |';
  await db.saveMessage(
    { userId: scope.userId },
    { ...scope, user: scope.userId, messageId: 'historical', text: raw, isCreatedByUser: false },
  );
  const fixture = await turn(raw);
  const apply = jest.fn(fixture.input.applyMarkdown);
  fixture.input.applyMarkdown = apply;
  const result = await fixture.run();
  expect(apply).toHaveBeenCalledWith(result.markdown);
  expect(result.markdown).toContain('| 數量 | 厚度 | 長度 | 加工 | 備註 | 來源 |');
  expect(result.markdown).toContain(
    '| 2 | 6 | 1250 | 切割 | 原長度 1.25m；原厚度 6.35mm | 文字訂單 |',
  );
  expect((await db.getMessage({ user: scope.userId, messageId: 'assistant-2' }))?.text).toBe(
    result.markdown,
  );
  expect((await db.getMessage({ user: scope.userId, messageId: 'historical' }))?.text).toBe(raw);
  const review = createSteelReviewService({
    reader: db,
    writer: createSteelReviewWriteMethods(mongoose),
  });
  const { table } = await review.read({
    ...scope,
    messageId: 'assistant-2',
    kind: 'ocr_result',
    title: 'ocr_result',
  });
  expect(table.rows[0].values['厚度']).toEqual({ baseline: '6', effective: '6' });
  expect(table.rows[0].values['長度']).toEqual({ baseline: '1250', effective: '1250' });
  expect(table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '2' });
});

it('persists a full OCR response when its legacy source is reused in another same-owner conversation', async () => {
  const fixture = await turn(order('2'));
  const fileId = 'shared-order-file';
  const otherConversationId = '6bf991da-be8c-5300-bd85-ff6ee2d17bb6';
  await mongoose.models.Conversation.create({
    conversationId: otherConversationId,
    user: scope.userId,
    endpoint: 'agents',
  });
  await mongoose.models.Message.create([
    {
      messageId: 'user-ai-2',
      conversationId: scope.conversationId,
      user: scope.userId,
      isCreatedByUser: true,
      text: 'Read the attached order',
      files: [{ file_id: fileId }],
    },
    {
      messageId: 'other-upload',
      conversationId: otherConversationId,
      user: scope.userId,
      isCreatedByUser: true,
      text: 'Earlier use of the same file',
      files: [{ file_id: fileId }],
    },
  ]);
  await mongoose.models.File.create({
    user: scope.userId,
    messageId: 'other-upload',
    file_id: fileId,
    filename: 'order.pdf',
    filepath: '/test/order.pdf',
    type: 'application/pdf',
    bytes: 1,
    source: 'local',
  });
  await services().ocr.allocateDelegateSourceMapping({
    conversationId: scope.conversationId,
    fileId,
    sourceFilename: 'order.pdf',
  });
  fixture.input.markdown = `## source_file_mapping\n\n| 來源 | 檔名 |\n| --- | --- |\n| F1 | order.pdf |\n\n${order('2').replace('文字訂單', 'F1')}`;

  const result = await fixture.run();
  const saved = await db.getMessage({ user: scope.userId, messageId: 'assistant-2' });
  expect(saved).toMatchObject({
    text: result.markdown,
    parentMessageId: 'user-ai-2',
    unfinished: false,
  });
  expect(saved?.metadata?.steelMarkdownOwners).toMatchObject({
    ocr_result: { outputId: 'ocr_result:ai-2' },
  });
  expect(fixture.persist).not.toHaveBeenCalled();
  expect((await services().ocr.readCurrentOcrResult(scope.conversationId))?.markdown).toBe(
    order('2').replace('文字訂單', 'F1'),
  );
  expect((await services().quotation.readState(scope))?.currentOrder?.markdown).toBe(
    order('2').replace('文字訂單', 'F1'),
  );
  const review = createSteelReviewService({
    reader: db,
    writer: createSteelReviewWriteMethods(mongoose),
  });
  const { table } = await review.read({
    ...scope,
    messageId: 'assistant-2',
    kind: 'ocr_result',
    title: 'ocr_result',
  });
  expect(table.rows[0].source).toMatchObject({ fileId, filename: 'order.pdf' });
});

it.each([
  '## ocr_result_updates\n\n| x |\n| --- |\n| y |',
  `${order('2')}\n\n## ocr_deletions\n\nP1`,
])('rejects retired controls before any managed writes', async (markdown) => {
  const fixture = await turn(markdown);
  await expect(fixture.run()).rejects.toMatchObject({ code: 'retired_control_section' });
  expect(fixture.persist).not.toHaveBeenCalled();
  expect(await db.getMessage({ user: scope.userId, messageId: 'assistant-2' })).toBeNull();
  expect((await services().quotation.readState(scope))?.currentOrder).toBeUndefined();
});

it('allows fenced historical instructions while requiring a complete real target', async () => {
  const markdown = `\x60\x60\x60markdown\n## ocr_result_updates\nold example\n\x60\x60\x60\n\n${order('2')}`;
  const result = await (await turn(markdown)).run();
  expect(result.markdown).toContain('old example');
  expect((await services().ocr.readCurrentOcrResult(scope.conversationId))?.markdown).toContain(
    order('2'),
  );
});

it('preserves immutable AI and human history while a new AI owner resets its difference', async () => {
  await (await turn(order('2'))).run();
  const review = createSteelReviewService({
    reader: db,
    writer: createSteelReviewWriteMethods(mongoose),
  });
  async function save(messageId: string, value: string) {
    const { table } = await review.read({
      ...scope,
      messageId,
      kind: 'ocr_result',
      title: 'ocr_result',
    });
    const prepared = await review.prepare({
      ...scope,
      messageId,
      title: table.title,
      kind: table.kind,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value }] },
      ],
    });
    if (!('operationRequest' in prepared)) throw new Error('Missing operation request');
    return review.commit({
      ...scope,
      ...prepared.operationRequest,
      operationId: prepared.operationId,
      digest: prepared.digest,
    });
  }
  await save('assistant-2', '3');
  const savedHumanMessage = await db.getMessage({ user: scope.userId, messageId: 'assistant-2' });
  const humanHistory = await db.readSteelMarkdownHistory({
    ...scope,
    messages: [{ messageId: 'assistant-2', metadata: savedHumanMessage?.metadata ?? undefined }],
  });
  expect(humanHistory).toEqual([
    expect.objectContaining({
      reference: expect.objectContaining({ source: 'human' }),
      effectiveMarkdown: order('3'),
    }),
  ]);
  const firstVersions = await db.readSteelMarkdownVersions(scope);
  expect(firstVersions).toEqual([expect.objectContaining({ latest: true, saves: 1 })]);
  await (await turn(order('4'), 'assistant-4', 'ai-4', '數量4')).run();
  const historical = await review.read({
    ...scope,
    messageId: 'assistant-2',
    kind: 'ocr_result',
    title: 'ocr_result',
  });
  expect(historical.table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '3' });
  const fresh = await review.read({
    ...scope,
    messageId: 'assistant-4',
    kind: 'ocr_result',
    title: 'ocr_result',
  });
  expect(fresh.table.rows[0].values['數量']).toEqual({ baseline: '4', effective: '4' });
  await save('assistant-4', '5');
  expect(await db.readSteelMarkdownVersions(scope)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ messageId: 'assistant-2', latest: false, saves: 1 }),
      expect.objectContaining({ messageId: 'assistant-4', latest: true, saves: 1 }),
    ]),
  );
});

it('creates a fresh baseline for the same text and physical message in a different generation', async () => {
  await (await turn(order('2'))).run();
  await (await turn(order('2'), 'assistant-2', 'ai-4')).run();
  expect(await db.readSteelMarkdownVersions(scope)).toEqual([
    expect.objectContaining({ outputId: 'ocr_result:ai-4', latest: true, saves: 0 }),
  ]);
});

it('makes a regenerated OCR sibling latest and its predecessor read-only', async () => {
  await (await turn(order('2'))).run();
  const regenerated = await turn(order('4'), 'assistant-regenerated', 'ai-regenerated');
  regenerated.input.req.steelNativeContext!.quotation!.messageId = 'user-ai-2';
  await regenerated.run();
  const review = createSteelReviewService({
    reader: db,
    writer: createSteelReviewWriteMethods(mongoose),
  });
  const old = await review.read({
    ...scope,
    messageId: 'assistant-2',
    kind: 'ocr_result',
    title: 'ocr_result',
  });
  const current = await review.read({
    ...scope,
    messageId: 'assistant-regenerated',
    kind: 'ocr_result',
    title: 'ocr_result',
  });
  expect(old.table).toMatchObject({ isLatest: false, readOnly: true, previousVersion: true });
  expect(current.table).toMatchObject({ isLatest: true, readOnly: false });
  await expect(
    review.prepare({
      ...scope,
      messageId: old.table.messageId,
      kind: old.table.kind,
      title: old.table.title,
      outputId: old.table.outputId,
      revision: old.table.revision,
      operations: [
        {
          type: 'update',
          rowId: old.table.rows[0].rowId,
          changes: [{ header: '數量', value: '9' }],
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' });
});

it('publishes confirmed direct tier data with a version badge and no editor', async () => {
  await (
    await turn(
      renderQuotationCustomerMarkdown({ tier: 'B' }),
      'assistant-customer',
      'customer-2',
      '使用預設 B tier',
    )
  ).run();
  expect(await db.readSteelMarkdownVersions(scope)).toEqual([
    expect.objectContaining({ kind: 'customer_data', latest: true, saves: 0 }),
  ]);
});

it('refuses an older admitted normal turn without overwriting the latest owner', async () => {
  const older = await turn(order('2'));
  const newer = await turn(order('4'), 'assistant-4', 'ai-4');
  await newer.run();
  await expect(older.run()).rejects.toMatchObject({ code: 'superseded_response' });
  expect((await services().ocr.readCurrentOcrResult(scope.conversationId))?.markdown).toBe(
    order('4'),
  );
});

it('commits delegate completion and claim cleanup with its full clean publication', async () => {
  const fixture = await turn(order('2'));
  const ocr = services().ocr;
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
  await ocr.allocateDelegateSourceMapping({
    conversationId: scope.conversationId,
    fileId: 'order-file',
    sourceFilename: 'order.pdf',
  });
  fixture.input.markdown = `## source_file_mapping\n\n| 來源 | 檔名 |\n| --- | --- |\n| F1 | order.pdf |\n\n${order('2').replace('文字訂單', 'F1')}`;
  const claim = await ocr.claimNewDelegateOcrIndex({
    conversationId: scope.conversationId,
    triggeringMessageId: 'user-ai-2',
    claimToken: 'delegate-claim',
  });
  if (!claim) throw new Error('Missing delegate claim');
  await ocr.materializeDelegateOcrRun({
    ...claim,
    toolParameters: {},
    files: [{ fileId: 'order-file', filename: 'order.pdf' }],
  });
  const lease = await ocr.acquireDelegateExecutionLease({
    claimToken: claim.claimToken,
    leaseToken: 'delegate-lease',
  });
  if (!lease) throw new Error('Missing delegate lease');
  fixture.input.req.steelNativeContext!.delegateOcrContext = {
    didExecute: true,
    delegateOcrExecutionLease: lease,
    activeRun: {
      claimToken: claim.claimToken,
      delegateOcrIndex: claim.delegateOcrIndex,
      executionLeaseToken: lease.executionLeaseToken,
      agentAttemptNumber: 1,
    },
  };
  const result = await fixture.run();
  const run = await ocr.findDelegateOcrRunByClaimToken(claim.claimToken);
  expect(run?.status).toBe('completed');
  expect(run?.finalizationJournal).toMatchObject({
    candidateValidated: true,
    messagePersisted: true,
    resultPersisted: true,
    claimCleared: true,
  });
  expect(await ocr.readActiveDelegateClaim(scope.conversationId)).toBeUndefined();
  expect((await db.getMessage({ user: scope.userId, messageId: 'assistant-2' }))?.text).toBe(
    result.markdown,
  );
  expect(await fixture.run()).toMatchObject({ markdown: result.markdown });
});

 it('defers scoped plain prose to the terminal finalizer and preserves unscoped persistence', () => {
  expect(shouldDeferSteelMarkdownPersistence({ steelNativeContext: { quotation: { scope } } },
    'main summary')).toBe(true);
  expect(shouldDeferSteelMarkdownPersistence({}, 'main summary')).toBe(false);
});
