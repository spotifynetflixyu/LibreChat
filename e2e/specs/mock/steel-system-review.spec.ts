import mongoose from 'mongoose';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createModels, createMethods } from '@librechat/data-schemas';
import { steelReviewRecoverySchema } from 'librechat-data-provider';
import {
  createSteelOcrStateService,
  createSteelQuotationStateService,
  createSteelMarkdownCompletionServices,
  createSteelQuotationPublicationPublisher,
  publishCompletedQuotation,
  registerSteelMarkdownPublication,
  prepareQuotationTurn,
  runQuotationPreflight,
  renderQuotationCustomerMarkdown,
} from '@librechat/api';

import type { ISteelQuotationState, ISteelQuotationArtifact, ISteelReviewOutput, ISteelConversationOcrState, IMessage } from '@librechat/data-schemas';
import type { SteelReviewOperationPrepare, SteelReviewOperationPrepared, SteelReviewSaveResponse, SteelReviewTable } from 'librechat-data-provider';
import type { Locator, Page } from '@playwright/test';

import { deleteConversations, deleteMessagesByConversation, seedConversations, seedMessages, withMongo } from './db';
import { getE2EUser } from '../../setup/user';
import { getAccessToken } from './helpers';
const title = 'system_order｜覆核報價';
const order = [
  `## ${title}`,
  '',
  '| 型號 | 品名規格 | 材質編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 肚 | 類別 | 備註 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| T1 | REVIEW-MATERIAL-A | M1 | kg | 2 | 1 | 2 | 10 | 1 |  |  |  |  |  | 材料 |  |',
  '| T2 | REVIEW-MATERIAL-B | M1 | pc | 1 |  | 1 |  | 1 |  |  |  |  |  | 材料 |  |',
].join('\n');
const groupedOrder = `${order}
| P1 | REVIEW-PROCESS-A | M1 | pc | 1 |  | 3 | 5 | 1 |  |  |  |  |  | 加工/孔 |  |
| P2 | REVIEW-PROCESS-B | M1 | pc | 1 |  | 4 | 2 | 1 |  |  |  |  |  | 加工/孔 |  |`;
const ocr = '## ocr_result\n\n| 來源 | 零件編號 | 數量 |\n| --- | --- | --- |\n|  | SOURCE-A | 2 |';
const oldQuote = '## customer_quote｜歷史保留\n\n| 項目 | 小計 |\n| --- | --- |\n| OLD-KEEP | 456 |';

interface OrderFixture {
  conversationId: string;
  messageId: string;
  otherMessageId: string;
  ocrMessageId: string;
  runId: string;
}

async function seedOrder(withHistoricalQuote = true, withOcrReview = false,
  beforePublication?: (fixture: OrderFixture) => Promise<void>,
  options?: { orderMarkdown?: string; withSources?: boolean }) {
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const otherMessageId = randomUUID();
  const ocrMessageId = randomUUID();
  const ocrGenerationId = randomUUID();
  const email = getE2EUser().email;
  const orderMarkdown = options?.orderMarkdown ?? order;
  const sourceFiles = options?.withSources ? [
    { fileId: `group-alpha-${conversationId}`, filename: 'alpha.pdf' },
    { fileId: `group-beta-${conversationId}`, filename: 'beta.pdf' },
  ] : [];
  const ocrMarkdown = sourceFiles.length > 0
    ? '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 | 頁碼 |\n| --- | --- | --- | --- | --- |\n| F1 | SOURCE-A | 材料 | 2 | 1 |\n| F2 | SOURCE-B | 材料 | 1 | 2 |'
    : ocr;
  const messageText = `SYSTEM-PREFIX\n\n${orderMarkdown}${withHistoricalQuote ? `\n\n${oldQuote}` : ''}\n\nSYSTEM-SUFFIX`;
  await seedConversations(email, [{ conversationId, title: 'System order real Save proof', updatedAt: new Date() }]);
  await seedMessages(email, conversationId, [...(withHistoricalQuote ? [{ messageId, parentMessageId: withOcrReview ? ocrMessageId : '00000000-0000-0000-0000-000000000000',
    text: messageText, content: [{ type: 'text', text: messageText }], isCreatedByUser: false, sender: 'Assistant' }] : []),
  { messageId: otherMessageId, parentMessageId: messageId, text: orderMarkdown, content: [{ type: 'text', text: orderMarkdown }],
    isCreatedByUser: false, sender: 'Assistant' },
  ...(withOcrReview ? [{ messageId: ocrMessageId, parentMessageId: '00000000-0000-0000-0000-000000000000',
    text: ocrMarkdown, content: [{ type: 'text', text: ocrMarkdown }], isCreatedByUser: false, sender: 'Assistant' }] : [])]);
  const userId = await withMongo(async (db) => {
    const owner = await db.collection('users').findOne({ email });
    if (!owner) throw new Error('Missing authenticated user');
    return String(owner._id);
  });
  const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
  const db = new mongoose.Mongoose();
  await db.connect(runtime.MONGO_URI);
  try {
    const scope = { userId, conversationId };
    const service = createSteelQuotationStateService(db);
    const ocrService = createSteelOcrStateService(db);
    for (const sourceFile of sourceFiles) {
      await withMongo(async (database) => database.collection('files').insertOne({
        user: new ObjectId(userId), conversationId, messageId: ocrMessageId,
        file_id: sourceFile.fileId, filename: sourceFile.filename,
        filepath: join(__dirname, 'fixtures', sourceFile.filename), type: 'application/pdf',
        bytes: 1024, object: 'file', source: 'local', context: 'message_attachment',
        createdAt: new Date(), updatedAt: new Date(),
      }));
      await ocrService.allocateDelegateSourceMapping({ conversationId,
        fileId: sourceFile.fileId, sourceFilename: sourceFile.filename });
    }
    const customerMarkdown = renderQuotationCustomerMarkdown({ tier: 'B' });
    if (withOcrReview) {
      await ocrService.upsertCurrentOcrResult({ conversationId, generationId: ocrGenerationId,
        attemptNumber: 1, markdown: ocrMarkdown, messageId: ocrMessageId });
    }
    const current = await service.setOrder({ scope, fullMarkdown: ocrMarkdown,
      ...(withOcrReview ? { revision: ocrGenerationId, messageId: ocrMessageId } : {}) });
    const savedCustomer = await service.saveCustomer({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'quote-user', responseId: withOcrReview ? messageId : randomUUID(),
      selectionProvenance: { method: 'default_tier', selectionMessageId: 'quote-user' },
      orderHash: current.currentOrder!.sha256 });
    const ticket = await service.issueTicket({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'quote-user', selectionProvenance: { method: 'default_tier', selectionMessageId: 'quote-user' },
      ...(withOcrReview ? { responseId: messageId, preparationId: savedCustomer.preparationId,
        orderHash: current.currentOrder!.sha256, completionReceipt: {
        inputHash: createHash('sha256').update('## quote_signal\n\nstart').digest('hex'),
        markdown: '## quote_signal\n\nstart', ocrGeneration: ocrGenerationId,
        ocrHash: current.currentOrder!.sha256,
      } } : {}) });
    const run = await service.acceptSignal({ scope, index: ticket.index, token: ticket.token,
      orderHash: ticket.orderHash, customerMarkdown, customerIdentity: ticket.customerIdentity,
      prompts: { child: 'bounded child', main: 'bounded main' }, chunks: [{ index: 1, sourceRowCount: sourceFiles.length || 1 }],
      ...(sourceFiles.length > 0 ? { sourceSnapshot: {
        orderHash: current.currentOrder!.sha256, generationId: ocrGenerationId,
        resultMessageId: ocrMessageId, resultHash: current.currentOrder!.sha256,
        mappings: await ocrService.readSourceMappings(conversationId),
      } } : {}), targetMessageId: messageId });
    const lease = await service.acquireLease({ scope, runId: run.runId, leaseToken: randomUUID() });
    if (!lease) throw new Error('Missing fixture lease');
    await service.checkpoint({ scope, runId: run.runId, leaseToken: lease.leaseToken, operationId: 'final', kind: 'final', payload: orderMarkdown });
    const ref = (await service.readState(scope))?.activeRun?.checkpointRefs.find((entry) => entry.operationId === 'final');
    if (!ref) throw new Error('Missing normal final checkpoint');
    const completed = await service.completeRun({ scope, runId: run.runId, leaseToken: lease.leaseToken,
      finalRef: { ...scope, runId: run.runId, ...ref, kind: 'final' } });
    if (!completed) throw new Error('Missing completed quotation run');
    const fixture = { conversationId, messageId, otherMessageId, ocrMessageId, runId: run.runId };
    createModels(db);
    const methods = createMethods(db);
    if (beforePublication) {
      const saved = await methods.saveMessage({ userId }, {
        messageId, conversationId, parentMessageId: ocrMessageId, unfinished: true,
        text: messageText, content: [{ type: 'text', text: messageText }],
        isCreatedByUser: false, sender: 'Assistant',
      }, { context: 'steel-review-e2e-stream-snapshot' });
      if (!saved) throw new Error('Missing normal streamed quotation message');
    }
    await publishCompletedQuotation({ scope, run: completed, markdown: orderMarkdown, service,
      publishFinal: async (publication) => {
        await beforePublication?.(fixture);
        const text = withHistoricalQuote ? messageText
          : `SYSTEM-PREFIX\n\n${publication.markdown}\n\nSYSTEM-SUFFIX`;
        return methods.saveSteelQuotationMessage({
          ...publication,
          message: {
            user: userId, messageId, conversationId, parentMessageId: withOcrReview ? ocrMessageId : '00000000-0000-0000-0000-000000000000',
            text, content: [{ type: 'text', text }], isCreatedByUser: false, sender: 'Assistant',
          },
        });
      } });
    return fixture;
  } finally {
    await db.disconnect();
  }
}

async function replayCompleted(fixture: { conversationId: string; messageId: string; ocrMessageId: string }) {
  const email = getE2EUser().email;
  const userId = await withMongo(async (database) => {
    const user = await database.collection('users').findOne({ email });
    if (!user) throw new Error('Missing replay owner');
    return String(user._id);
  });
  const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
  const db = new mongoose.Mongoose();
  await db.connect(runtime.MONGO_URI);
  try {
    const scope = { userId, conversationId: fixture.conversationId };
    const quotation = createSteelQuotationStateService(db);
    const state = await quotation.readState(scope);
    createModels(db);
    const methods = createMethods(db);
    let projected = '## quote_signal\n\nstart';
    let writes = 0;
    let responseMessagePersisted = false;
    let persistedMessage: object | undefined;
    let loadedMessage: object | undefined;
    const persistMarkdown = async () => {
      writes += 1;
      const text = `SYSTEM-PREFIX\n\n${projected}\n\nSYSTEM-SUFFIX`;
      const saved = await methods.saveMessage({ userId }, { messageId: fixture.messageId,
        conversationId: fixture.conversationId, parentMessageId: fixture.ocrMessageId,
        text, content: [{ type: 'text', text }], isCreatedByUser: false, sender: 'Assistant',
      }, { context: 'steel-review-e2e-replay' });
      if (saved) {
        responseMessagePersisted = true;
        persistedMessage = saved;
      }
      return saved;
    };
    const result = await createSteelMarkdownCompletionServices({
      quotation, ocr: createSteelOcrStateService(db),
    }).finalize({
      req: { user: { id: userId }, steelNativeContext: { requestId: fixture.messageId,
        quotation: { scope, state: state ?? undefined, messageId: 'quote-user' } } },
      responseId: fixture.messageId, generationId: randomUUID(), markdown: projected, completed: true,
      applyMarkdown: (markdown) => { projected = markdown; },
      persistMarkdown,
      publishQuotation: async (publication) => {
        writes += 1;
        const text = `SYSTEM-PREFIX\n\n${publication.markdown}\n\nSYSTEM-SUFFIX`;
        const publish = createSteelQuotationPublicationPublisher({
          savePublication: methods.saveSteelQuotationMessage,
          buildMessage: () => ({ user: userId, messageId: fixture.messageId, conversationId: fixture.conversationId,
            parentMessageId: fixture.ocrMessageId, text, content: [{ type: 'text', text }],
            isCreatedByUser: false, sender: 'Assistant' }),
        });
        const saved = await publish(publication);
        if (saved.ok) {
          responseMessagePersisted = true;
          persistedMessage = saved.message;
        }
        return saved;
      },
      publishedResponse: {
        load: async ({ userId: owner, responseId }) => {
          const record = await methods.getMessage({ user: owner, messageId: responseId });
          loadedMessage = record ?? undefined;
          return record;
        },
        accept: (record) => {
          responseMessagePersisted = true;
          persistedMessage = record;
        },
      },
    });
    if (!responseMessagePersisted) await persistMarkdown();
    if (!persistedMessage) throw new Error('Missing durable replay response');
    return { result, writes, projected, acceptedSameRecord: persistedMessage === loadedMessage,
      persistedMessage: JSON.parse(JSON.stringify(persistedMessage)) };
  } finally {
    await db.disconnect();
  }
}

async function replayPublishedRun(fixture: OrderFixture) {
  const email = getE2EUser().email;
  const userId = await withMongo(async (database) => {
    const user = await database.collection('users').findOne({ email });
    if (!user) throw new Error('Missing runner replay owner');
    return String(user._id);
  });
  const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
  await mongoose.connect(runtime.MONGO_URI);
  try {
    const emissions: string[] = [];
    let modelCalls = 0;
    let lookupCalls = 0;
    let publishCalls = 0;
    const result = await runQuotationPreflight({
      scope: { userId, conversationId: fixture.conversationId },
      modelOptions: { model: 'unused-replay-model' }, signal: new AbortController().signal,
      invokeModel: async () => { modelCalls += 1; throw new Error('Replay must not invoke a model'); },
      executeLookup: async () => { lookupCalls += 1; throw new Error('Replay must not run lookup'); },
      publishFinal: async () => { publishCalls += 1; throw new Error('Replay must not publish again'); },
      projectFinal: async ({ markdown }) => { emissions.push(markdown); },
    });
    return { result, emissions, modelCalls, lookupCalls, publishCalls };
  } finally {
    await mongoose.disconnect();
  }
}


async function reviseCompleted(fixture: OrderFixture,
  beforeTerminal?: (messageId: string) => Promise<void>,
  afterRevisionCommit?: (messageId: string) => Promise<void>) {
  const email = getE2EUser().email;
  const userId = await withMongo(async (database) => {
    const owner = await database.collection('users').findOne({ email });
    if (!owner) throw new Error('Missing revision owner');
    return String(owner._id);
  });
  const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
  await mongoose.connect(runtime.MONGO_URI);
  try {
    const scope = { userId, conversationId: fixture.conversationId };
    const quotation = createSteelQuotationStateService(mongoose);
    const state = await quotation.readState(scope);
    const snapshot = state?.currentSystemOrder;
    if (!snapshot) throw new Error('Missing completed source order');
    const lines = snapshot.markdown.split('\n');
    const row = lines[4].split('|').slice(1, -1).map((value) => value.trim());
    row[6] = '3';
    const markdown = [
      '## system_order_updates', '',
      `| base_hash | row_index | ${lines[2].slice(1, -1).trim()} |`,
      `| --- | --- | ${lines[3].slice(1, -1).trim()} |`,
      `| ${snapshot.sha256} | 1 | ${row.join(' | ')} |`,
    ].join('\n');
    const messageId = randomUUID();
    const saveCurrentSystemOrder = quotation.saveCurrentSystemOrder;
    quotation.saveCurrentSystemOrder = async (input) => {
      const saved = await saveCurrentSystemOrder(input);
      if (saved?.messageId === messageId) await afterRevisionCommit?.(messageId);
      return saved;
    };
    const prepared = await prepareQuotationTurn({ scope, messageId: 'revision-user', responseId: messageId,
      text: '將第一列總數修正為3' });
    createModels(mongoose);
    const methods = createMethods(mongoose);
    let current = markdown;
    let terminalPaused = false;
    const pause = async () => {
      if (terminalPaused) return;
      terminalPaused = true;
      await beforeTerminal?.(messageId);
    };
    const message = () => ({
      user: userId, messageId, conversationId: fixture.conversationId, parentMessageId: fixture.messageId,
      text: `REVISION-PREFIX\n\n ${current} \n\nREVISION-SUFFIX`,
      content: [
        { type: 'text' as const, text: 'REVISION-PREFIX\n\n' },
        { type: 'tool_call' as const, tool_call: { id: 'revision-lookup', name: 'search_price_candidates',
          args: '{"queries":[]}', output: '{"ok":true}' } },
        { type: 'text' as const, text: current },
        { type: 'text' as const, text: '\n\nREVISION-SUFFIX' },
      ],
      metadata: { reviewBrowser: { retained: true } }, isCreatedByUser: false, sender: 'Assistant',
    });
    const finalizer = createSteelMarkdownCompletionServices({ quotation, ocr: createSteelOcrStateService(mongoose) });
    const input: Parameters<typeof finalizer.finalize>[0] = {
      req: { user: { id: userId }, steelNativeContext: { requestId: messageId, quotation: prepared } },
      responseId: messageId, generationId: messageId, markdown, completed: true,
      applyMarkdown: (value) => { current = value; },
      persistMarkdown: async (options) => {
        if (options?.completed !== false) await pause();
        return methods.saveMessage({ userId }, { ...message(), unfinished: options?.completed === false },
          { context: 'steel-review-e2e-normal-revision' });
      },
      publishQuotation: async (publication) => {
        await pause();
        return methods.saveSteelQuotationMessage({ ...publication, message: { ...message(), unfinished: false } });
      },
    };
    try {
      await finalizer.finalize(input);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'superseded_response') {
        await expect(finalizer.finalize(input)).rejects.toMatchObject({ code: 'superseded_response' });
      }
      throw error;
    }
    return { ...fixture, messageId };
  } finally {
    await mongoose.disconnect();
  }
}


async function adoptCompleted(fixture: OrderFixture, beforeSaveBarrier: () => Promise<void>,
  mode: 'adopted' | 'prepared' = 'adopted') {
  const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
  await mongoose.connect(runtime.MONGO_URI);
  try {
    createModels(mongoose);
    const methods = createMethods(mongoose);
    const owner = await mongoose.connection.collection('users').findOne({ email: getE2EUser().email });
    if (!owner) throw new Error('Missing adoption owner');
    const userId = String(owner._id);
    const scope = { userId, conversationId: fixture.conversationId };
    const quotation = createSteelQuotationStateService(mongoose);
    const state = await quotation.readState(scope);
    if (!state?.currentSystemOrder) throw new Error('Missing adoption system order');
    const stored = await methods.getMessage({ user: userId, messageId: fixture.messageId });
    if (!stored) throw new Error('Missing actual adoption response');
    const prepared = await prepareQuotationTurn({ scope, messageId: 'adoption-user', responseId: fixture.messageId,
      text: '核對報價' });
    const req = { user: { id: userId }, steelNativeContext: { requestId: fixture.messageId, quotation: prepared } };
    const finalizer = createSteelMarkdownCompletionServices({ quotation, ocr: createSteelOcrStateService(mongoose) });
    let projected = state.currentSystemOrder.markdown;
    const snapshot = () => {
      const text = `SYSTEM-PREFIX\n\n${projected}\n\nSYSTEM-SUFFIX`;
      return { ...stored, text, content: [{ type: 'text' as const, text }], unfinished: false };
    };
    const input: Parameters<typeof finalizer.finalize>[0] = {
      req, responseId: fixture.messageId, generationId: fixture.messageId,
      markdown: projected, completed: true,
      applyMarkdown: (markdown) => { projected = markdown; },
      persistMarkdown: () => methods.saveMessage({ userId }, snapshot(), { context: 'steel-review-adoption' }),
      publishQuotation: (proof) => methods.saveSteelQuotationMessage({ ...proof, message: snapshot() }),
    };
    if (mode === 'prepared') {
      let paused = false;
      input.onPrepared = async () => {
        if (paused) return;
        paused = true;
        await beforeSaveBarrier();
      };
      await expect(finalizer.finalize(input)).rejects.toMatchObject({ code: 'superseded_response' });
      await expect(finalizer.finalize(input)).rejects.toMatchObject({ code: 'superseded_response' });
      return;
    }
    const completed = await finalizer.finalize(input);
    if (!completed.publication) throw new Error('Missing normal branded publication');
    registerSteelMarkdownPublication(req, completed.publication, fixture.messageId, fixture.messageId);
    const readState = quotation.readState;
    let verifiedRead = false;
    quotation.readState = async (scopeToRead) => {
      const current = await readState(scopeToRead);
      if (!verifiedRead) {
        verifiedRead = true;
        await beforeSaveBarrier();
      }
      return current;
    };
    await expect(finalizer.finalize({ ...input, markdown: completed.markdown }))
      .rejects.toMatchObject({ code: 'superseded_response' });
    await expect(finalizer.finalize({ ...input, markdown: completed.markdown }))
      .rejects.toMatchObject({ code: 'superseded_response' });
  } finally {
    await mongoose.disconnect();
  }
}

function reviewUrl(conversationId: string) {
  return `/api/steel/conversations/${conversationId}/review/system_order`;
}

async function readTable(page: Page, headers: { Authorization: string }, conversationId: string, messageId: string, fullTitle = title) {
  const response = await page.request.get(`${reviewUrl(conversationId)}?${new URLSearchParams({ messageId, title: fullTitle })}`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json() as { table: SteelReviewTable }).table;
}

function requestFor(table: SteelReviewTable, changes: { header: string; value: string }[], rowIndex = 0): SteelReviewOperationPrepare {
  return { conversationId: table.conversationId, messageId: table.messageId, kind: table.kind, title: table.title,
    outputId: table.outputId, revision: table.revision,
    operations: [{ type: 'update', rowId: table.rows[rowIndex].rowId, changes }] };
}

async function prepare(page: Page, headers: { Authorization: string }, request: SteelReviewOperationPrepare) {
  const response = await page.request.post(`${reviewUrl(request.conversationId)}/prepare`, { headers, data: request });
  expect(response.status(), await response.text()).toBe(200);
  return await response.json() as SteelReviewOperationPrepared;
}

async function commit(page: Page, headers: { Authorization: string }, prepared: SteelReviewOperationPrepared) {
  return page.request.post(`${reviewUrl(prepared.conversationId)}/commit`, { headers,
    data: { ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest } });
}

async function readback(conversationId: string) {
  return withMongo(async (db) => ({
    messages: await db.collection<Pick<IMessage, 'messageId' | 'text' | 'content' | 'metadata'>>('messages').find({ conversationId }).sort({ messageId: 1 }).toArray(),
    reviews: await db.collection<ISteelReviewOutput>('steel_review_outputs').find({ conversationId }).toArray(),
    quotation: await db.collection<ISteelQuotationState>('steel_quotation_states').findOne({ conversationId }),
    artifacts: await db.collection<ISteelQuotationArtifact>('steel_quotation_artifacts').find({ conversationId }).sort({ operationId: 1 }).toArray(),
    ocr: await db.collection<ISteelConversationOcrState>('steel_conversation_ocr_state').find({ conversationId }).toArray(),
  }));
}

async function openEditor(page: Page, conversationId: string) {
  await page.goto(`/c/${conversationId}`);
  await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
  await page.getByTestId('message-body').filter({ hasText: 'SYSTEM-SUFFIX' })
    .getByRole('button', { name: 'Open Steel review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Steel source review' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function materialRow(dialog: Locator) {
  return dialog.locator('tbody tr').filter({ hasText: 'REVIEW-MATERIAL-A' });
}

async function seedGroup() {
  return seedOrder(true, true, undefined, { orderMarkdown: groupedOrder, withSources: true });
}

function rowNamed(table: SteelReviewTable, name: string) {
  const row = table.rows.find((entry) => entry.values['品名規格'].effective === name);
  if (!row) throw new Error(`Missing normal group fixture row: ${name}`);
  return row;
}

function operationsFor(table: SteelReviewTable, operations: SteelReviewOperationPrepare['operations']): SteelReviewOperationPrepare {
  return { conversationId: table.conversationId, messageId: table.messageId, kind: table.kind,
    title: table.title, outputId: table.outputId, revision: table.revision, operations };
}

async function bindGroup(page: Page, headers: { Authorization: string }, fixture: OrderFixture) {
  const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
  const parent = rowNamed(table, 'REVIEW-MATERIAL-A');
  const prepared = await prepare(page, headers, operationsFor(table,
    ['REVIEW-PROCESS-A', 'REVIEW-PROCESS-B'].map((name) => ({ type: 'update' as const,
      rowId: rowNamed(table, name).rowId, binding: { parentRowId: parent.rowId } }))));
  const response = await commit(page, headers, prepared);
  expect(response.status(), await response.text()).toBe(200);
  return readTable(page, headers, fixture.conversationId, fixture.messageId);
}

async function newMaterialIdentity(dialog: Locator, initial: SteelReviewTable) {
  const existingIds = new Set(initial.rows.map((row) => row.rowId));
  for (const action of await dialog.getByRole('button', { name: /^Add processing under /u }).all()) {
    const rowId = (await action.getAttribute('aria-label'))?.replace(/^Add processing under /u, '');
    if (rowId && !existingIds.has(rowId)) return rowId;
  }
  throw new Error('Missing new material identity');
}

async function selectPreview(page: Page, dialog: Locator, filename: string, pageNumber: string) {
  // The global preview selector precedes each row's source correction selector.
  await dialog.getByRole('combobox', { name: 'Source file', exact: true }).first().click();
  await page.getByRole('option', { name: filename, exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
  await page.getByRole('option', { name: pageNumber, exact: true }).click();
}

async function saveUiDraft(page: Page, dialog: Locator): Promise<SteelReviewSaveResponse> {
  const prepared = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/prepare'));
  const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit')).catch(() => null);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const preview = await prepared;
  expect(preview.status(), await preview.text()).toBe(200);
  const response = await committed;
  if (!response) throw new Error('Missing review commit response');
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<SteelReviewSaveResponse>;
}

test.describe('System order atomic manual review', () => {
  const conversations: string[] = [];
  let headers: { Authorization: string };
  test.beforeEach(async ({ page }) => {
    await page.goto('/c/new');
    headers = { Authorization: `Bearer ${await getAccessToken(page)}` };
  });
  test.afterEach(async () => {
    const ids = conversations.splice(0);
    await deleteMessagesByConversation(ids);
    await withMongo(async (db) => {
      for (const collection of ['steel_review_outputs', 'steel_quotation_states', 'steel_quotation_artifacts', 'steel_conversation_ocr_state', 'files']) {
        await db.collection(collection).deleteMany({ conversationId: { $in: ids } });
      }
    });
    await deleteConversations(ids);
  });

  test('explicit processing binding advances review revision without rewriting canonical Markdown and conflicts with a different parent', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const parentA = rowNamed(initial, 'REVIEW-MATERIAL-A');
    const parentB = rowNamed(initial, 'REVIEW-MATERIAL-B');
    const child = rowNamed(initial, 'REVIEW-PROCESS-A');
    expect(parentA.system).toMatchObject({ kind: 'material', parentRowId: null });
    expect(child.system).toMatchObject({ kind: 'processing', parentRowId: null });
    const before = await readback(fixture.conversationId);
    const first = await prepare(page, headers, operationsFor(initial, [{ type: 'update', rowId: child.rowId,
      binding: { parentRowId: parentA.rowId } }]));
    const second = await prepare(page, headers, operationsFor(initial, [{ type: 'update', rowId: child.rowId,
      binding: { parentRowId: parentB.rowId } }]));
    expect(await readback(fixture.conversationId)).toEqual(before);
    const response = await commit(page, headers, first);
    expect(response.status(), await response.text()).toBe(200);
    const saved = await response.json() as SteelReviewSaveResponse;
    expect(saved.revision).not.toBe(initial.revision);
    expect(saved.changedRowIds).toEqual([child.rowId]);
    expect(saved.caption.customerQuoteChangedRows).toBe(0);
    const after = await readback(fixture.conversationId);
    expect(after.quotation?.currentSystemOrder.markdown).toBe(before.quotation?.currentSystemOrder.markdown);
    expect(after.quotation?.currentSystemOrder.sha256).toBe(before.quotation?.currentSystemOrder.sha256);
    const conflict = await commit(page, headers, second);
    expect(conflict.status()).toBe(409);
    const body = await conflict.json();
    const recovery = steelReviewRecoverySchema.parse(body.recovery);
    expect(recovery.conflicts).toContainEqual({ kind: 'binding', rowId: child.rowId,
      expected: null, current: parentA.rowId, requested: parentB.rowId });
    expect(recovery.table.revision).toBe(saved.revision);
    expect(await readback(fixture.conversationId)).toEqual(after);
    expect(await (await commit(page, headers, first)).json()).toEqual(saved);
    expect(await readback(fixture.conversationId)).toEqual(after);
    const current = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(current, 'REVIEW-PROCESS-A').system?.parentRowId).toBe(parentA.rowId);
    const noop = await prepare(page, headers, operationsFor(current, [{ type: 'update', rowId: child.rowId,
      binding: { parentRowId: parentA.rowId } }]));
    expect((await (await commit(page, headers, noop)).json() as SteelReviewSaveResponse).changedRows).toBe(0);
    expect(await readback(fixture.conversationId)).toEqual(after);
    await page.goto(`/c/${fixture.conversationId}`);
    await page.reload();
    expect(rowNamed(await readTable(page, headers, fixture.conversationId, fixture.messageId), 'REVIEW-PROCESS-A').system?.parentRowId)
      .toBe(parentA.rowId);
    expect(await readback(fixture.conversationId)).toEqual(after);
  });

  test('completed replay preserves a metadata-only human binding Save and its immutable receipt', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const parent = rowNamed(initial, 'REVIEW-MATERIAL-A');
    const child = rowNamed(initial, 'REVIEW-PROCESS-A');
    const before = await readback(fixture.conversationId);
    const prepared = await prepare(page, headers, operationsFor(initial, [{ type: 'update', rowId: child.rowId,
      binding: { parentRowId: parent.rowId } }]));
    expect((await commit(page, headers, prepared)).status()).toBe(200);
    const saved = await readback(fixture.conversationId);
    expect(saved.quotation?.currentSystemOrder.markdown).toBe(before.quotation?.currentSystemOrder.markdown);
    expect(saved.reviews[0].revision).not.toBe(saved.quotation?.currentSystemOrder.sha256);
    const completion = await replayCompleted(fixture);
    expect(completion.writes).toBe(0);
    expect(completion.acceptedSameRecord).toBe(true);
    expect(completion.result.markdown).toBe(saved.quotation?.currentSystemOrder.markdown);
    const afterCompletion = await readback(fixture.conversationId);
    // Receipt replay may refresh the quotation broker's bookkeeping timestamp.
    expect({ ...afterCompletion, quotation: { ...afterCompletion.quotation, updatedAt: saved.quotation?.updatedAt } }).toEqual(saved);
    const runner = await replayPublishedRun(fixture);
    expect(runner.result.status).toBe('completed');
    expect(runner.result.markdown).toBe(saved.quotation?.currentSystemOrder.markdown);
    expect([runner.modelCalls, runner.lookupCalls, runner.publishCalls]).toEqual([0, 0, 0]);
    expect(await readback(fixture.conversationId)).toEqual(afterCompletion);
    await page.goto(`/c/${fixture.conversationId}`);
    await page.reload();
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    const reloaded = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(reloaded, 'REVIEW-PROCESS-A').system?.parentRowId).toBe(parent.rowId);
    expect(reloaded.revision).toBe(saved.reviews[0].revision);
    expect(await readback(fixture.conversationId)).toEqual(afterCompletion);
  });

  test('group restore preserves prior individual deletion and exact stable row identities and receipts', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    let table = await bindGroup(page, headers, fixture);
    const ids = table.rows.map((row) => row.rowId);
    const parent = rowNamed(table, 'REVIEW-MATERIAL-A');
    const childA = rowNamed(table, 'REVIEW-PROCESS-A');
    const childB = rowNamed(table, 'REVIEW-PROCESS-B');
    const individual = await prepare(page, headers, operationsFor(table, [{ type: 'delete', rowId: childB.rowId }]));
    expect((await commit(page, headers, individual)).status()).toBe(200);
    table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const beforeCascade = await readback(fixture.conversationId);
    const deletion = await prepare(page, headers, operationsFor(table, [{ type: 'delete', rowId: parent.rowId }]));
    expect(deletion.caption.changedRowIds.sort()).toEqual([parent.rowId, childA.rowId].sort());
    expect(deletion.caption.customerQuoteChangedRows).toBe(2);
    expect((await commit(page, headers, deletion)).status()).toBe(200);
    table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(table, 'REVIEW-PROCESS-A')).toMatchObject({ deleted: true,
      system: { kind: 'processing', parentRowId: parent.rowId, cascadeDeletedBy: parent.rowId } });
    expect(rowNamed(table, 'REVIEW-PROCESS-B')).toMatchObject({ deleted: true,
      system: { kind: 'processing', parentRowId: parent.rowId, cascadeDeletedBy: null } });
    const restoration = await prepare(page, headers, operationsFor(table, [{ type: 'restore', rowId: parent.rowId }]));
    expect(restoration.caption.changedRows).toBe(2);
    expect(restoration.caption.customerQuoteChangedRows).toBe(2);
    expect((await commit(page, headers, restoration)).status()).toBe(200);
    const restored = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(restored.rows.map((row) => row.rowId)).toEqual(ids);
    expect(rowNamed(restored, 'REVIEW-MATERIAL-A').deleted).toBe(false);
    expect(rowNamed(restored, 'REVIEW-PROCESS-A')).toMatchObject({ deleted: false,
      system: { kind: 'processing', parentRowId: parent.rowId, cascadeDeletedBy: null } });
    expect(rowNamed(restored, 'REVIEW-PROCESS-B').deleted).toBe(true);
    const after = await readback(fixture.conversationId);
    expect(after.quotation?.currentSystemOrder.markdown).toContain('REVIEW-PROCESS-A');
    expect(after.quotation?.currentSystemOrder.markdown).not.toContain('REVIEW-PROCESS-B');
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 35 |');
    expect(after.reviews[0].aiBaselineMarkdown).toBe(beforeCascade.reviews[0].aiBaselineMarkdown);
    expect(after.reviews[0].receipts.slice(0, beforeCascade.reviews[0].receipts.length)).toEqual(beforeCascade.reviews[0].receipts);
    await page.goto(`/c/${fixture.conversationId}`);
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(after);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(restored.rows);
  });

  test('processing added from another preview inherits its material source and dirty download saves the latest clean rows', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const table = await bindGroup(page, headers, fixture);
    const parent = rowNamed(table, 'REVIEW-MATERIAL-A');
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    const parentRow = materialRow(dialog);
    await parentRow.getByRole('button', { name: `Change source ${parent.rowId}`, exact: true }).click();
    await parentRow.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await parentRow.getByRole('combobox', { name: 'Source page', exact: true }).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 3 rows', { exact: true })).toBeVisible();
    await expect(materialRow(dialog)).toHaveCount(0);
    await dialog.getByRole('combobox', { name: 'Material', exact: true }).click();
    await page.getByRole('option', { name: 'T1', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add processing', exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 4 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(before);
    const prepareRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
    const commitResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    const downloadReady = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download.*CSV/i }).click();
    const submitted = (await prepareRequest).postDataJSON() as SteelReviewOperationPrepare;
    const committed = await commitResponse;
    expect(committed.status(), await committed.text()).toBe(200);
    const savedResponse = await committed.json() as SteelReviewSaveResponse;
    expect(savedResponse.changedRows).toBe(4);
    expect(savedResponse.caption.customerQuoteChangedRows).toBe(1);
    expect(submitted.operations).toHaveLength(2);
    expect(submitted.operations.find((operation) => operation.type === 'update')).toEqual({ type: 'update', rowId: parent.rowId,
      source: { fileId: `group-alpha-${fixture.conversationId}`, pageNumber: 1 } });
    const addition = submitted.operations.find((operation) => operation.type === 'add');
    expect(addition).toMatchObject({ type: 'add', system: { kind: 'processing', parentRowId: parent.rowId } });
    expect(addition).not.toHaveProperty('source');
    const download = await downloadReady;
    const path = await download.path();
    if (!path) throw new Error('Missing clean group download');
    const csv = await readFile(path, 'utf8');
    expect(csv).toContain('REVIEW-MATERIAL-A');
    expect(csv).toContain('REVIEW-PROCESS-A');
    expect(csv).not.toMatch(/<del>|~~|Updated|Previous version/);
    expect(csv.split(/\r?\n/u).filter((line) => line.length > 0)).toHaveLength(6);
    const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(saved.rows).toHaveLength(5);
    const processing = saved.rows.filter((row) => row.system?.kind === 'processing');
    expect(processing).toHaveLength(3);
    for (const row of [rowNamed(saved, 'REVIEW-MATERIAL-A'), ...processing]) {
      expect(row.source).toMatchObject({ fileId: `group-alpha-${fixture.conversationId}`, pageNumber: 1, filename: 'alpha.pdf' });
    }
    for (const row of processing) expect(row.system?.parentRowId).toBe(parent.rowId);
    const after = await readback(fixture.conversationId);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 43 |');
    expect(after.ocr).toEqual(before.ocr);
    expect(after.messages.find((message) => message.messageId === fixture.otherMessageId))
      .toEqual(before.messages.find((message) => message.messageId === fixture.otherMessageId));
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
    for (const row of processing) {
      await expect(dialog.getByRole('combobox', { name: `Bind processing ${row.rowId}`, exact: true })).toBeVisible();
    }
    expect(await readback(fixture.conversationId)).toEqual(after);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(after);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
  });

  test('a material source conflict marks preview files and pages, retains the group draft and retries from the latest revision', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const table = await bindGroup(page, headers, fixture);
    const parent = rowNamed(table, 'REVIEW-MATERIAL-A');
    const dialog = await openEditor(page, fixture.conversationId);
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    const parentRow = materialRow(dialog);
    await parentRow.getByRole('button', { name: `Change source ${parent.rowId}`, exact: true }).click();
    await parentRow.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await parentRow.getByRole('combobox', { name: 'Source page', exact: true }).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
    const remote = await prepare(page, headers, operationsFor(table, [{ type: 'update', rowId: parent.rowId,
      source: { fileId: `group-beta-${fixture.conversationId}`, pageNumber: 2 } }]));
    const remoteResponse = await commit(page, headers, remote);
    expect(remoteResponse.status(), await remoteResponse.text()).toBe(200);
    const latest = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const afterRemote = await readback(fixture.conversationId);
    const conflictResponse = page.waitForResponse((response) => response.status() === 409 &&
      response.request().method() === 'POST' && response.url().includes('/review/system_order/'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const conflict = await conflictResponse;
    const recovery = steelReviewRecoverySchema.parse((await conflict.json()).recovery);
    expect(recovery.table.revision).toBe(latest.revision);
    expect(recovery.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'source', rowId: parent.rowId }),
    ]));
    await expect(dialog.getByRole('region', { name: 'Conflicts need review before saving again.', exact: true })).toBeVisible();
    await expect(dialog.getByText('Unsaved changes: 3 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(afterRemote);
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    for (const filename of ['alpha.pdf', 'beta.pdf']) {
      await expect(page.getByRole('option').filter({ hasText: filename })
        .getByRole('img', { name: 'Conflicts on this file', exact: true })).toBeVisible();
    }
    await page.getByRole('option').filter({ hasText: 'alpha.pdf' }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await expect(page.getByRole('option').filter({ hasText: /^1/u })
      .getByRole('img', { name: 'Conflicts on this page', exact: true })).toBeVisible();
    await page.getByRole('option').filter({ hasText: /^1/u }).click();
    const retried = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
    const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const request = (await retried).postDataJSON() as SteelReviewOperationPrepare;
    expect(request.revision).toBe(latest.revision);
    expect(request.operations).toEqual([{ type: 'update', rowId: parent.rowId,
      source: { fileId: `group-alpha-${fixture.conversationId}`, pageNumber: 1 } }]);
    const response = await committed;
    expect(response.status(), await response.text()).toBe(200);
    expect((await response.json() as SteelReviewSaveResponse).changedRows).toBe(3);
    const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    for (const row of saved.rows.filter((entry) => entry.rowId === parent.rowId || entry.system?.parentRowId === parent.rowId)) {
      expect(row.source).toMatchObject({ fileId: `group-alpha-${fixture.conversationId}`, pageNumber: 1 });
    }
    await expect(dialog.getByRole('region', { name: 'Conflicts need review before saving again.', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const after = await readback(fixture.conversationId);
    expect(after.ocr).toEqual(afterRemote.ocr);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(after);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
  });

  for (const classify of [false, true]) {
    test(`unsaved material group cancellation preserves a valid existing ${classify ? 'unassigned' : 'processing'} tombstone`, async ({ page }) => {
      const fixture = await seedOrder(true, true, undefined, {
        orderMarkdown: classify ? groupedOrder.replace('| 加工/孔 |', '|  |') : groupedOrder, withSources: true,
      });
      conversations.push(fixture.conversationId);
      const initial = classify ? await readTable(page, headers, fixture.conversationId, fixture.messageId)
        : await bindGroup(page, headers, fixture);
      const child = rowNamed(initial, 'REVIEW-PROCESS-A');
      const before = await readback(fixture.conversationId);
      const dialog = await openEditor(page, fixture.conversationId);
      await selectPreview(page, dialog, 'beta.pdf', '2');
      await dialog.getByRole('button', { name: 'Add material', exact: true }).click();
      const materialId = await newMaterialIdentity(dialog, initial);
      await selectPreview(page, dialog, 'alpha.pdf', '1');
      if (classify) {
        await dialog.getByRole('combobox', { name: 'Material', exact: true }).click();
        await page.getByRole('option', { name: materialId, exact: true }).click();
        await dialog.getByRole('combobox', { name: `Classify ${child.rowId}`, exact: true }).click();
        await page.getByRole('option', { name: 'Processing', exact: true }).click();
      } else {
        await dialog.getByRole('combobox', { name: `Bind processing ${child.rowId}`, exact: true }).click();
        await page.getByRole('option', { name: materialId, exact: true }).click();
      }
      await selectPreview(page, dialog, 'beta.pdf', '2');
      await dialog.getByRole('button', { name: `Delete group ${materialId}`, exact: true }).click();
      await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
      expect(await readback(fixture.conversationId)).toEqual(before);
      const undo = dialog.getByRole('button', { name: 'Undo', exact: true });
      await undo.click();
      await expect(dialog.getByRole('button', { name: `Delete group ${materialId}`, exact: true })).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: `Bind processing ${child.rowId}`, exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
      const submitted = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
      const result = await saveUiDraft(page, dialog);
      expect((await submitted).postDataJSON().operations).toEqual([{ type: 'delete', rowId: child.rowId }]);
      expect(result.changedRows).toBe(1);
      const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      expect(saved.rows.some((row) => row.rowId === materialId)).toBe(false);
      expect(rowNamed(saved, 'REVIEW-PROCESS-A')).toEqual({ ...child, origin: 'ai', deleted: true });
      expect(saved.rows.filter((row) => row.rowId !== child.rowId)).toEqual(initial.rows.filter((row) => row.rowId !== child.rowId).map((row) => ({ ...row, origin: 'ai', deleted: false })));
      const after = await readback(fixture.conversationId);
      expect(after.ocr).toEqual(before.ocr);
      await page.keyboard.press('Escape');
      await page.reload();
      expect(await readback(fixture.conversationId)).toEqual(after);
      expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
    });
  }

  test('all-new material group cancellation is net zero and one Undo restores its exact draft identities', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    await selectPreview(page, dialog, 'beta.pdf', '2');
    await dialog.getByRole('button', { name: 'Add material', exact: true }).click();
    const materialId = await newMaterialIdentity(dialog, initial);
    await dialog.getByRole('button', { name: `Add processing under ${materialId}`, exact: true }).click();
    let childId: string | undefined;
    const existingIds = new Set(initial.rows.map((row) => row.rowId));
    for (const action of await dialog.getByRole('combobox', { name: /^Bind processing /u }).all()) {
      const rowId = (await action.getAttribute('aria-label'))?.replace(/^Bind processing /u, '');
      if (rowId && !existingIds.has(rowId)) childId = rowId;
    }
    if (!childId) throw new Error('Missing new processing identity');
    await expect(dialog.getByText('Unsaved changes: 2 rows', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: `Delete group ${materialId}`, exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    expect(await readback(fixture.conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(dialog.getByRole('button', { name: `Add processing under ${materialId}`, exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: `Bind processing ${childId}`, exact: true })).toBeVisible();
    await expect(dialog.getByText('Unsaved changes: 2 rows', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(before);
  });

  for (const mode of ['edit', 'delete', 'restore-edit-delete'] as const) {
    test(`classification composes with source and price edits before ${mode}`, async ({ page }) => {
      const fixture = await seedOrder(true, true, undefined, {
        orderMarkdown: groupedOrder.replace('| 材料 |  |', '|  |  |'), withSources: true,
      });
      conversations.push(fixture.conversationId);
      let initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      const rowId = rowNamed(initial, 'REVIEW-MATERIAL-A').rowId;
      if (mode === 'restore-edit-delete') {
        const deletion = await prepare(page, headers, operationsFor(initial, [{ type: 'delete', rowId }]));
        const response = await commit(page, headers, deletion);
        expect(response.status(), await response.text()).toBe(200);
        initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      }
      const before = await readback(fixture.conversationId);
      const dialog = await openEditor(page, fixture.conversationId);
      if (mode === 'restore-edit-delete') {
        await dialog.getByRole('button', { name: `Restore row ${rowId}`, exact: true }).click();
      }
      await dialog.getByRole('combobox', { name: `Classify ${rowId}`, exact: true }).click();
      await page.getByRole('option', { name: 'Material', exact: true }).click();
      const row = materialRow(dialog);
      await row.getByRole('textbox', { name: `單價 ${rowId}`, exact: true }).fill('7');
      await row.getByRole('textbox', { name: `單價 ${rowId}`, exact: true }).press('Enter');
      await row.getByRole('button', { name: `Change source ${rowId}`, exact: true }).click();
      await row.getByRole('combobox', { name: 'Source file', exact: true }).click();
      await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
      await row.getByRole('combobox', { name: 'Source page', exact: true }).click();
      await page.getByRole('option', { name: '2', exact: true }).click();
      await selectPreview(page, dialog, 'beta.pdf', '2');
      if (mode !== 'edit') {
        await dialog.getByRole('button', { name: `Delete group ${rowId}`, exact: true }).click();
      }
      await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
      expect(await readback(fixture.conversationId)).toEqual(before);
      const submitted = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
      const result = await saveUiDraft(page, dialog);
      const operations = (await submitted).postDataJSON().operations as SteelReviewOperationPrepare['operations'];
      let expectedTypes = ['classify', 'update'];
      if (mode === 'delete') expectedTypes = ['classify', 'update', 'delete'];
      if (mode === 'restore-edit-delete') expectedTypes = ['restore', 'classify', 'update', 'delete'];
      expect(operations.map((operation) => operation.type)).toEqual(expectedTypes);
      expect(operations.every((operation) => operation.rowId === rowId)).toBe(true);
      expect(result.changedRows).toBe(1);
      const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      expect(rowNamed(saved, 'REVIEW-MATERIAL-A')).toMatchObject({ deleted: mode !== 'edit',
        system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
        source: { fileId: `group-beta-${fixture.conversationId}`, pageNumber: 2 },
        values: { 單價: { baseline: '10', effective: '7' } },
      });
      expect(saved.rows.filter((entry) => entry.rowId !== rowId)).toEqual(initial.rows.filter((entry) => entry.rowId !== rowId).map((entry) => ({ ...entry, origin: 'ai', deleted: false })));
      const after = await readback(fixture.conversationId);
      expect(after.ocr).toEqual(before.ocr);
      await page.keyboard.press('Escape');
      await page.reload();
      expect(await readback(fixture.conversationId)).toEqual(after);
      expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
    });
  }

  for (const same of [true, false]) {
    test(`concurrent classification is ${same ? 'a same-value zero-write receipt' : 'a different-value conflict with latest recovery'}`, async ({ page }) => {
      const fixture = await seedOrder(true, true, undefined, {
        orderMarkdown: groupedOrder.replace('| 材料 |  |', '|  |  |'), withSources: true,
      });
      conversations.push(fixture.conversationId);
      const initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      const rowId = rowNamed(initial, 'REVIEW-MATERIAL-A').rowId;
      const parent = rowNamed(initial, 'REVIEW-MATERIAL-B');
      const first = await prepare(page, headers, operationsFor(initial, [{ type: 'classify', rowId,
        system: { kind: 'material', parentRowId: null } }]));
      const second = await prepare(page, headers, operationsFor(initial, [{ type: 'classify', rowId,
        system: same ? { kind: 'material', parentRowId: null } : { kind: 'processing', parentRowId: parent.rowId } }]));
      const firstResponse = await commit(page, headers, first);
      expect(firstResponse.status(), await firstResponse.text()).toBe(200);
      const firstResult = await firstResponse.json() as SteelReviewSaveResponse;
      const afterFirst = await readback(fixture.conversationId);
      const secondResponse = await commit(page, headers, second);
      expect(secondResponse.status(), await secondResponse.text()).toBe(same ? 200 : 409);
      if (same) {
        const result = await secondResponse.json() as SteelReviewSaveResponse;
        expect(result.changedRows).toBe(0);
        expect(result.revision).toBe(firstResult.revision);
      } else {
        const recovery = steelReviewRecoverySchema.parse((await secondResponse.json()).recovery);
        expect(recovery.table.revision).toBe(firstResult.revision);
        expect(recovery.table.rows.find((entry) => entry.rowId === rowId)?.system?.kind).toBe('material');
        expect(recovery.conflicts).toContainEqual({ kind: 'binding', rowId,
          expected: null, current: null, requested: parent.rowId });
      }
      expect(await readback(fixture.conversationId)).toEqual(afterFirst);
      expect(await (await commit(page, headers, first)).json()).toEqual(firstResult);
      expect(await readback(fixture.conversationId)).toEqual(afterFirst);
      await page.goto(`/c/${fixture.conversationId}`);
      await page.reload();
      expect(await readback(fixture.conversationId)).toEqual(afterFirst);
    });
  }

  for (const classify of [false, true]) {
    test(`an ordered material Add supports an existing ${classify ? 'unassigned classification' : 'processing binding'} after a later material price edit`, async ({ page }) => {
      const fixture = await seedOrder(true, true, undefined, {
        orderMarkdown: classify ? groupedOrder.replace('| 加工/孔 |', '|  |') : groupedOrder,
        withSources: true,
      });
      conversations.push(fixture.conversationId);
      const initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      const child = rowNamed(initial, 'REVIEW-PROCESS-A');
      expect(child.system?.kind).toBe(classify ? 'unassigned' : 'processing');
      const before = await readback(fixture.conversationId);
      const dialog = await openEditor(page, fixture.conversationId);
      await dialog.getByRole('button', { name: 'Add material', exact: true }).click();
      const existingIds = new Set(initial.rows.map((row) => row.rowId));
      let materialId: string | undefined;
      for (const action of await dialog.getByRole('button', { name: /^Add processing under /u }).all()) {
        const label = await action.getAttribute('aria-label');
        const rowId = label?.replace(/^Add processing under /u, '');
        if (rowId && !existingIds.has(rowId)) materialId = rowId;
      }
      if (!materialId) throw new Error('Missing ordered new material identity');
      if (classify) {
        await dialog.getByRole('combobox', { name: 'Material', exact: true }).click();
        await page.getByRole('option', { name: materialId, exact: true }).click();
        await dialog.getByRole('combobox', { name: `Classify ${child.rowId}`, exact: true }).click();
        await page.getByRole('option', { name: 'Processing', exact: true }).click();
      } else {
        await dialog.getByRole('combobox', { name: `Bind processing ${child.rowId}`, exact: true }).click();
        await page.getByRole('option', { name: materialId, exact: true }).click();
      }
      await dialog.getByRole('textbox', { name: `單價 ${materialId}`, exact: true }).fill('7');
      await dialog.getByRole('textbox', { name: `單價 ${materialId}`, exact: true }).press('Enter');
      await expect(dialog.getByText('Unsaved changes: 2 rows', { exact: true })).toBeVisible();
      expect(await readback(fixture.conversationId)).toEqual(before);
      const submitted = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
      const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      const request = (await submitted).postDataJSON() as SteelReviewOperationPrepare;
      expect(request.operations).toHaveLength(2);
      expect(request.operations[0]).toMatchObject({ type: 'add', rowId: materialId,
        system: { kind: 'material', parentRowId: null } });
      expect(request.operations[1]).toEqual(classify
        ? { type: 'classify', rowId: child.rowId, system: { kind: 'processing', parentRowId: materialId } }
        : { type: 'update', rowId: child.rowId, binding: { parentRowId: materialId } });
      const response = await committed;
      expect(response.status(), await response.text()).toBe(200);
      expect((await response.json() as SteelReviewSaveResponse).changedRows).toBe(2);
      const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      const material = saved.rows.find((row) => row.rowId === materialId);
      expect(material).toMatchObject({ system: { kind: 'material' }, values: { 單價: { effective: '7' } } });
      expect(rowNamed(saved, 'REVIEW-PROCESS-A')).toMatchObject({
        rowId: child.rowId, system: { kind: 'processing', parentRowId: materialId }, source: material?.source,
      });
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      const after = await readback(fixture.conversationId);
      expect(after.ocr).toEqual(before.ocr);
      expect(after.messages.find((message) => message.messageId === fixture.otherMessageId))
        .toEqual(before.messages.find((message) => message.messageId === fixture.otherMessageId));
      await page.keyboard.press('Escape');
      await page.reload();
      expect(await readback(fixture.conversationId)).toEqual(after);
      expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
    });
  }

  for (const mode of ['classified-binding', 'restored-binding', 'restored-child-edit', 'parent-child-redelete', 'individual-redelete', 'child-only-redelete'] as const) {
    test(`activated material dependency and restored group compound draft: ${mode}`, async ({ page }) => {
      const fixture = mode === 'classified-binding'
        ? await seedOrder(true, true, undefined, { orderMarkdown: groupedOrder.replace('| 材料 |  |', '|  |  |'), withSources: true })
        : await seedGroup();
      conversations.push(fixture.conversationId);
      let initial = mode === 'classified-binding' || mode === 'restored-binding'
        ? await readTable(page, headers, fixture.conversationId, fixture.messageId)
        : await bindGroup(page, headers, fixture);
      const parentId = rowNamed(initial, 'REVIEW-MATERIAL-A').rowId;
      const childId = rowNamed(initial, 'REVIEW-PROCESS-A').rowId;
      if (mode !== 'classified-binding') {
        const deletion = await prepare(page, headers, operationsFor(initial, [{ type: 'delete', rowId: parentId }]));
        const response = await commit(page, headers, deletion);
        expect(response.status(), await response.text()).toBe(200);
        initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
        expect(rowNamed(initial, 'REVIEW-MATERIAL-A').deleted).toBe(true);
      }
      const before = await readback(fixture.conversationId);
      const dialog = await openEditor(page, fixture.conversationId);
      if (mode === 'classified-binding') {
        await dialog.getByRole('combobox', { name: `Classify ${parentId}`, exact: true }).click();
        await page.getByRole('option', { name: 'Material', exact: true }).click();
      } else {
        await dialog.getByRole('button', { name: `Restore row ${parentId}`, exact: true }).click();
      }
      if (mode === 'classified-binding' || mode === 'restored-binding') {
        await dialog.getByRole('combobox', { name: `Bind processing ${childId}`, exact: true }).click();
        await page.getByRole('option', { name: 'T1', exact: true }).click();
      }
      const editsChild = mode === 'restored-child-edit' || mode === 'parent-child-redelete' || mode === 'child-only-redelete';
      if (editsChild) {
        await dialog.getByRole('textbox', { name: `單價 ${childId}`, exact: true }).fill('8');
        await dialog.getByRole('textbox', { name: `單價 ${childId}`, exact: true }).press('Enter');
      }
      const editsParent = mode !== 'individual-redelete' && mode !== 'child-only-redelete';
      if (editsParent) {
        await dialog.getByRole('textbox', { name: `單價 ${parentId}`, exact: true }).fill('7');
        await dialog.getByRole('textbox', { name: `單價 ${parentId}`, exact: true }).press('Enter');
      }
      const deletesGroup = mode === 'parent-child-redelete' || mode === 'child-only-redelete';
      if (deletesGroup) {
        await dialog.getByRole('button', { name: `Delete group ${parentId}`, exact: true }).click();
      }
      if (mode === 'individual-redelete') {
        await dialog.getByRole('button', { name: `Delete row ${childId}`, exact: true }).click();
      }
      let changedRows = 2;
      if (mode === 'child-only-redelete') changedRows = 1;
      if (mode === 'restored-child-edit' || mode === 'individual-redelete') changedRows = 3;
      await expect(dialog.getByText(`Unsaved changes: ${changedRows} rows`, { exact: true })).toBeVisible();
      expect(await readback(fixture.conversationId)).toEqual(before);
      const submitted = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
      const result = await saveUiDraft(page, dialog);
      const operations = (await submitted).postDataJSON().operations as SteelReviewOperationPrepare['operations'];
      const activationIndex = operations.findIndex((operation) => operation.rowId === parentId &&
        (operation.type === 'restore' || operation.type === 'classify'));
      const childIndex = operations.findIndex((operation) => operation.rowId === childId);
      await test.info().attach('saved-ordered-operations', { body: JSON.stringify(operations), contentType: 'application/json' });
      expect(result.changedRows).toBe(changedRows);
      const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      const after = await readback(fixture.conversationId);
      expect(after.reviews[0]?.rows).toEqual(saved.rows);
      const parent = rowNamed(saved, 'REVIEW-MATERIAL-A');
      const child = rowNamed(saved, 'REVIEW-PROCESS-A');
      expect(parent).toMatchObject({ deleted: deletesGroup, system: { kind: 'material', parentRowId: null },
        values: { 單價: { baseline: '10', effective: editsParent ? '7' : '10' } } });
      expect(child).toMatchObject({ deleted: deletesGroup || mode === 'individual-redelete', source: parent.source,
        system: { kind: 'processing', parentRowId: parentId, cascadeDeletedBy: deletesGroup ? parentId : null },
        values: { 單價: { baseline: '5', effective: editsChild ? '8' : '5' } } });
      if (mode !== 'classified-binding' && mode !== 'restored-binding') {
        expect(rowNamed(saved, 'REVIEW-PROCESS-B')).toMatchObject({ deleted: deletesGroup,
          system: { parentRowId: parentId, cascadeDeletedBy: deletesGroup ? parentId : null } });
      }
      if (!deletesGroup) {
        expect(activationIndex).toBeGreaterThanOrEqual(0);
        expect(childIndex).toBeGreaterThan(activationIndex);
      }
      expect(after.reviews[0]?.receipts.at(-1)?.changedRows).toBe(changedRows);
      expect(after.ocr).toEqual(before.ocr);
      expect(after.messages.find((message) => message.messageId === fixture.otherMessageId))
        .toEqual(before.messages.find((message) => message.messageId === fixture.otherMessageId));
      await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await page.reload();
      expect(await readback(fixture.conversationId)).toEqual(after);
      expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
      if (mode === 'individual-redelete') {
        const nextDeletion = await prepare(page, headers, operationsFor(saved, [{ type: 'delete', rowId: parentId }]));
        expect((await commit(page, headers, nextDeletion)).status()).toBe(200);
        const groupDeleted = await readTable(page, headers, fixture.conversationId, fixture.messageId);
        const nextRestoration = await prepare(page, headers, operationsFor(groupDeleted, [{ type: 'restore', rowId: parentId }]));
        expect((await commit(page, headers, nextRestoration)).status()).toBe(200);
        const final = await readTable(page, headers, fixture.conversationId, fixture.messageId);
        expect(rowNamed(final, 'REVIEW-PROCESS-A')).toMatchObject({ deleted: true, system: { cascadeDeletedBy: null } });
        expect(rowNamed(final, 'REVIEW-PROCESS-B').deleted).toBe(false);
        expect((await readback(fixture.conversationId)).reviews[0]?.rows).toEqual(final.rows);
        await page.reload();
        expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(final.rows);
      }
    });
  }

  test('a restored child rebound before its original group is re-deleted keeps individual restore available after Save', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const bound = await bindGroup(page, headers, fixture);
    const parentId = rowNamed(bound, 'REVIEW-MATERIAL-A').rowId;
    const otherParentId = rowNamed(bound, 'REVIEW-MATERIAL-B').rowId;
    const childId = rowNamed(bound, 'REVIEW-PROCESS-A').rowId;
    const initialDeletion = await prepare(page, headers, operationsFor(bound, [{ type: 'delete', rowId: parentId }]));
    expect((await commit(page, headers, initialDeletion)).status()).toBe(200);
    const deleted = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(deleted, 'REVIEW-PROCESS-A')).toMatchObject({ deleted: true,
      system: { parentRowId: parentId, cascadeDeletedBy: parentId } });
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    await dialog.getByRole('button', { name: `Restore row ${parentId}`, exact: true }).click();
    await dialog.getByRole('combobox', { name: `Bind processing ${childId}`, exact: true }).click();
    await page.getByRole('option', { name: 'T2', exact: true }).click();
    await dialog.getByRole('button', { name: `Delete group ${parentId}`, exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(before);
    const submitted = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
    const result = await saveUiDraft(page, dialog);
    const operations = (await submitted).postDataJSON().operations as SteelReviewOperationPrepare['operations'];
    await test.info().attach('rebound-after-group-redelete-operations', { body: JSON.stringify(operations), contentType: 'application/json' });
    expect(result.changedRows).toBe(1);
    const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const after = await readback(fixture.conversationId);
    expect(after.reviews[0]?.rows).toEqual(saved.rows);
    expect(rowNamed(saved, 'REVIEW-MATERIAL-A').deleted).toBe(true);
    expect(rowNamed(saved, 'REVIEW-PROCESS-B')).toMatchObject({ deleted: true,
      system: { parentRowId: parentId, cascadeDeletedBy: parentId } });
    expect(rowNamed(saved, 'REVIEW-PROCESS-A')).toMatchObject({ deleted: false,
      system: { kind: 'processing', parentRowId: otherParentId, cascadeDeletedBy: null },
      source: rowNamed(saved, 'REVIEW-MATERIAL-B').source });
    expect(after.reviews[0]?.receipts.at(-1)?.changedRows).toBe(1);
    expect(after.ocr).toEqual(before.ocr);
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(after);
    const reopened = await openEditor(page, fixture.conversationId);
    await reopened.getByRole('button', { name: `Delete row ${childId}`, exact: true }).click();
    expect((await saveUiDraft(page, reopened)).changedRows).toBe(1);
    const childDeleted = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(childDeleted, 'REVIEW-PROCESS-A')).toMatchObject({ deleted: true,
      system: { parentRowId: otherParentId, cascadeDeletedBy: null } });
    const afterChildDelete = await readback(fixture.conversationId);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(afterChildDelete);
    const restoredEditor = await openEditor(page, fixture.conversationId);
    const restore = restoredEditor.getByRole('button', { name: `Restore row ${childId}`, exact: true });
    await expect(restore).toBeVisible();
    await restore.click();
    expect((await saveUiDraft(page, restoredEditor)).changedRows).toBe(1);
    const final = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(final, 'REVIEW-PROCESS-A')).toMatchObject({ deleted: false,
      system: { parentRowId: otherParentId, cascadeDeletedBy: null } });
    expect(rowNamed(final, 'REVIEW-MATERIAL-A').deleted).toBe(true);
    expect(rowNamed(final, 'REVIEW-PROCESS-B')).toMatchObject({ deleted: true,
      system: { parentRowId: parentId, cascadeDeletedBy: parentId } });
    const afterRestore = await readback(fixture.conversationId);
    expect(afterRestore.reviews[0]?.rows).toEqual(final.rows);
    expect(afterRestore.reviews[0]?.receipts.slice(0, afterChildDelete.reviews[0]?.receipts.length))
      .toEqual(afterChildDelete.reviews[0]?.receipts);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(afterRestore);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(final.rows);
  });

  test('an individually deleted processing row can restore locally and after Save while its material stays active', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const table = await bindGroup(page, headers, fixture);
    const child = rowNamed(table, 'REVIEW-PROCESS-A');
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    await dialog.getByRole('button', { name: `Delete row ${child.rowId}`, exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: `Bind processing ${child.rowId}`, exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: `Restore row ${child.rowId}`, exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    expect(await readback(fixture.conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: `Delete row ${child.rowId}`, exact: true }).click();
    const deletedResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const deletion = await deletedResponse;
    expect(deletion.status(), await deletion.text()).toBe(200);
    const deleted = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(deleted, 'REVIEW-PROCESS-A')).toMatchObject({ deleted: true,
      system: { parentRowId: child.system?.parentRowId, cascadeDeletedBy: null } });
    const afterDelete = await readback(fixture.conversationId);
    await page.keyboard.press('Escape');
    await page.reload();
    const reopened = await openEditor(page, fixture.conversationId);
    await expect(reopened.getByRole('combobox', { name: `Bind processing ${child.rowId}`, exact: true })).toHaveCount(0);
    await reopened.getByRole('button', { name: `Restore row ${child.rowId}`, exact: true }).click();
    await expect(reopened.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(afterDelete);
    const restoredResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await reopened.getByRole('button', { name: 'Save', exact: true }).click();
    const restoration = await restoredResponse;
    expect(restoration.status(), await restoration.text()).toBe(200);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(table.rows);
    const afterRestore = await readback(fixture.conversationId);
    expect(afterRestore.reviews[0].receipts.slice(0, afterDelete.reviews[0].receipts.length)).toEqual(afterDelete.reviews[0].receipts);
    expect(afterRestore.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 43 |');
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(afterRestore);
  });

  test('an imported unassigned row is classified explicitly in a reversible draft and cannot be classified again after Save', async ({ page }) => {
    const fixture = await seedOrder(true, true, undefined, {
      orderMarkdown: groupedOrder.replace('| 材料 |  |', '|  |  |'), withSources: true,
    });
    conversations.push(fixture.conversationId);
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const row = rowNamed(table, 'REVIEW-MATERIAL-A');
    expect(row.system?.kind).toBe('unassigned');
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    const classify = dialog.getByRole('combobox', { name: `Classify ${row.rowId}`, exact: true });
    await classify.click();
    await page.getByRole('option', { name: 'Material', exact: true }).click();
    await expect(dialog.getByRole('button', { name: `Delete group ${row.rowId}`, exact: true })).toBeVisible();
    await expect(classify).toHaveCount(0);
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(classify).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await readback(fixture.conversationId)).toEqual(before);
    const submitted = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
    const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const response = await committed;
    expect(response.status(), await response.text()).toBe(200);
    expect((await submitted).postDataJSON().operations).toEqual([
      { type: 'classify', rowId: row.rowId, system: { kind: 'material', parentRowId: null } },
    ]);
    const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(saved, 'REVIEW-MATERIAL-A').system).toMatchObject({ kind: 'material', parentRowId: null });
    expect(saved.rows.filter((entry) => entry.system?.kind === 'processing').every((entry) => entry.system?.parentRowId === null)).toBe(true);
    const after = await readback(fixture.conversationId);
    expect(after.reviews[0].aiBaselineMarkdown).toBe(before.quotation?.currentSystemOrder.markdown);
    expect(after.ocr).toEqual(before.ocr);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.reload();
    const reopened = await openEditor(page, fixture.conversationId);
    await expect(reopened.getByRole('combobox', { name: `Classify ${row.rowId}`, exact: true })).toHaveCount(0);
    await expect(reopened.getByRole('button', { name: `Delete group ${row.rowId}`, exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(after);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
  });

  test('a material added on a preview page and its under-row processing save in one ordered request', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const before = await readback(fixture.conversationId);
    const initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const dialog = await openEditor(page, fixture.conversationId);
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add material', exact: true }).click();
    const existingIds = new Set(initial.rows.map((row) => row.rowId));
    let materialId: string | undefined;
    for (const action of await dialog.getByRole('button', { name: /^Add processing under /u }).all()) {
      const label = await action.getAttribute('aria-label');
      const rowId = label?.replace(/^Add processing under /u, '');
      if (rowId && !existingIds.has(rowId)) materialId = rowId;
    }
    if (!materialId) throw new Error('Missing new material action identity');
    await dialog.getByRole('button', { name: `Add processing under ${materialId}`, exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 2 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(before);
    const submitted = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
    const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const request = (await submitted).postDataJSON() as SteelReviewOperationPrepare;
    const response = await committed;
    expect(response.status(), await response.text()).toBe(200);
    const result = await response.json() as SteelReviewSaveResponse;
    expect(result.changedRows).toBe(2);
    expect(request.operations).toHaveLength(2);
    expect(request.operations[0]).toMatchObject({ type: 'add', rowId: materialId,
      system: { kind: 'material', parentRowId: null },
      source: { fileId: `group-beta-${fixture.conversationId}`, pageNumber: 2 },
    });
    expect(request.operations[1]).toMatchObject({ type: 'add', system: { kind: 'processing', parentRowId: materialId } });
    expect(request.operations[1]).not.toHaveProperty('source');
    const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const added = saved.rows.filter((row) => !initial.rows.some((old) => old.rowId === row.rowId));
    expect(added).toHaveLength(2);
    for (const row of added) expect(row.source).toMatchObject({ fileId: `group-beta-${fixture.conversationId}`, pageNumber: 2 });
    expect(added.find((row) => row.system?.kind === 'processing')?.system?.parentRowId).toBe(materialId);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    const after = await readback(fixture.conversationId);
    expect(after.ocr).toEqual(before.ocr);
    expect(after.reviews[0].aiBaselineMarkdown).toBe(before.quotation?.currentSystemOrder.markdown);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(after);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
  });

  test('processing rebind across preview pages is one draft and preserves a later binding input during Save', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const bound = await bindGroup(page, headers, fixture);
    const parentA = rowNamed(bound, 'REVIEW-MATERIAL-A');
    const parentB = rowNamed(bound, 'REVIEW-MATERIAL-B');
    const child = rowNamed(bound, 'REVIEW-PROCESS-A');
    const sourceA = { fileId: `group-alpha-${fixture.conversationId}`, pageNumber: 1 };
    const sourceB = { fileId: `group-beta-${fixture.conversationId}`, pageNumber: 2 };
    const assigned = await prepare(page, headers, operationsFor(bound, [
      { type: 'update', rowId: parentA.rowId, source: sourceA },
      { type: 'update', rowId: parentB.rowId, source: sourceB },
    ]));
    expect((await commit(page, headers, assigned)).status()).toBe(200);
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    const selectPreview = async (filename: string, pageNumber: string) => {
      await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
      await page.getByRole('option', { name: filename, exact: true }).click();
      await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
      await page.getByRole('option', { name: pageNumber, exact: true }).click();
    };
    await selectPreview('alpha.pdf', '1');
    const binding = dialog.getByRole('combobox', { name: `Bind processing ${child.rowId}`, exact: true });
    await expect(binding).toHaveText('T1');
    await binding.click();
    await page.getByRole('option', { name: 'T2', exact: true }).click();
    await expect(binding).toHaveCount(0);
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(binding).toHaveText('T1');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await readback(fixture.conversationId)).toEqual(before);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const received = new Promise<void>((resolve) => { entered = resolve; });
    const routePattern = `**${reviewUrl(fixture.conversationId)}/commit`;
    await page.route(routePattern, async (route) => {
      entered();
      await blocked;
      await route.continue();
    }, { times: 1 });
    const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    try {
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await received;
      await selectPreview('beta.pdf', '2');
      await expect(binding).toHaveText('T2');
      await binding.click();
      await page.getByRole('option', { name: 'T1', exact: true }).click();
      expect(await readback(fixture.conversationId)).toEqual(before);
    } finally {
      release();
    }
    const firstResponse = await committed;
    expect(firstResponse.status(), await firstResponse.text()).toBe(200);
    await selectPreview('alpha.pdf', '1');
    await expect(binding).toHaveText('T1');
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    const savedFirst = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(savedFirst, 'REVIEW-PROCESS-A')).toMatchObject({
      system: { parentRowId: parentB.rowId }, source: sourceB,
    });
    const retryRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
    const retried = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await retryRequest).postDataJSON().operations).toEqual([
      { type: 'update', rowId: child.rowId, binding: { parentRowId: parentA.rowId } },
    ]);
    const retryResponse = await retried;
    expect(retryResponse.status(), await retryResponse.text()).toBe(200);
    const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(rowNamed(saved, 'REVIEW-PROCESS-A')).toMatchObject({
      system: { parentRowId: parentA.rowId }, source: sourceA,
    });
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const after = await readback(fixture.conversationId);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toBe(before.quotation?.currentSystemOrder.customerQuoteMarkdown);
    expect(after.ocr).toEqual(before.ocr);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(after);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows).toEqual(saved.rows);
  });

  test('material group delete and restore are single UI drafts with one undo and exact Save captions', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const table = await bindGroup(page, headers, fixture);
    const parent = rowNamed(table, 'REVIEW-MATERIAL-A');
    const group = [parent, rowNamed(table, 'REVIEW-PROCESS-A'), rowNamed(table, 'REVIEW-PROCESS-B')];
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    const undo = dialog.getByRole('button', { name: 'Undo', exact: true });
    const redo = dialog.getByRole('button', { name: 'Redo', exact: true });
    await expect(dialog.getByRole('button', { name: `Delete row ${parent.rowId}`, exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: `Delete group ${parent.rowId}`, exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 3 rows', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Restore row ${parent.rowId}`, exact: true })).toBeVisible();
    for (const row of group.slice(1)) {
      await expect(dialog.getByRole('button', { name: `Restore row ${row.rowId}`, exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('combobox', { name: `Bind processing ${row.rowId}`, exact: true })).toHaveCount(0);
      await expect(dialog.locator('del').filter({ hasText: row.values['品名規格'].effective ?? '' })).toBeVisible();
    }
    expect(await readback(fixture.conversationId)).toEqual(before);
    await undo.click();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await expect(dialog.getByRole('button', { name: `Delete group ${parent.rowId}`, exact: true })).toBeVisible();
    for (const row of group.slice(1)) {
      await expect(dialog.getByRole('combobox', { name: `Bind processing ${row.rowId}`, exact: true })).toHaveText('T1');
    }
    expect(await readback(fixture.conversationId)).toEqual(before);
    await redo.click();
    await expect(dialog.getByText('Unsaved changes: 3 rows', { exact: true })).toBeVisible();
    const prepareRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/system_order/prepare'));
    const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const submitted = (await prepareRequest).postDataJSON() as SteelReviewOperationPrepare;
    const savedResponse = await committed;
    expect(savedResponse.status(), await savedResponse.text()).toBe(200);
    const saved = await savedResponse.json() as SteelReviewSaveResponse;
    expect(submitted.operations).toEqual([{ type: 'delete', rowId: parent.rowId }]);
    expect(saved.changedRows).toBe(3);
    expect(saved.caption.customerQuoteChangedRows).toBe(3);
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    const deleted = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(deleted.rows.map((row) => row.rowId)).toEqual(table.rows.map((row) => row.rowId));
    expect(deleted.rows.filter((row) => row.deleted).map((row) => row.rowId).sort()).toEqual(group.map((row) => row.rowId).sort());
    const afterDelete = await readback(fixture.conversationId);
    expect(afterDelete.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  |  |');
    expect(afterDelete.quotation?.currentSystemOrder.markdown).not.toContain('REVIEW-MATERIAL-A');
    expect(afterDelete.quotation?.currentSystemOrder.markdown).not.toContain('REVIEW-PROCESS-');
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(afterDelete);
    const reopened = await openEditor(page, fixture.conversationId);
    for (const row of group.slice(1)) {
      await expect(reopened.getByRole('button', { name: `Restore row ${row.rowId}`, exact: true })).toHaveCount(0);
      await expect(reopened.getByRole('combobox', { name: `Bind processing ${row.rowId}`, exact: true })).toHaveCount(0);
    }
    await reopened.getByRole('button', { name: `Restore row ${parent.rowId}`, exact: true }).click();
    await expect(reopened.getByText('Unsaved changes: 3 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(afterDelete);
    const restoration = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await reopened.getByRole('button', { name: 'Save', exact: true }).click();
    const restoredResponse = await restoration;
    expect(restoredResponse.status(), await restoredResponse.text()).toBe(200);
    const restoredSave = await restoredResponse.json() as SteelReviewSaveResponse;
    expect(restoredSave.changedRows).toBe(3);
    expect(restoredSave.caption.customerQuoteChangedRows).toBe(3);
    const restored = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(restored.rows).toEqual(table.rows);
    const afterRestore = await readback(fixture.conversationId);
    expect(afterRestore.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 43 |');
    expect(afterRestore.reviews[0].aiBaselineMarkdown).toBe(before.reviews[0].aiBaselineMarkdown);
    expect(afterRestore.reviews[0].receipts.slice(0, afterDelete.reviews[0].receipts.length)).toEqual(afterDelete.reviews[0].receipts);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(afterRestore);
  });

  test('a material cascade prepared before a new explicitly bound child refuses an unexamined destructive deletion', async ({ page }) => {
    const fixture = await seedGroup();
    conversations.push(fixture.conversationId);
    const table = await bindGroup(page, headers, fixture);
    const parent = rowNamed(table, 'REVIEW-MATERIAL-A');
    const deletion = await prepare(page, headers, operationsFor(table, [{ type: 'delete', rowId: parent.rowId }]));
    const childId = randomUUID();
    const addition = await prepare(page, headers, operationsFor(table, [{ type: 'add', rowId: childId,
      position: { kind: 'after', rowId: parent.rowId },
      system: { kind: 'processing', parentRowId: parent.rowId },
      changes: [{ header: '總數', value: '2' }, { header: '單價', value: '3' }] }]));
    expect((await commit(page, headers, addition)).status()).toBe(200);
    const before = await readback(fixture.conversationId);
    const conflict = await commit(page, headers, deletion);
    expect(conflict.status()).toBe(409);
    const body = await conflict.json();
    const recovery = steelReviewRecoverySchema.parse(body.recovery);
    expect(recovery.table.rows.find((row) => row.rowId === childId)).toMatchObject({ deleted: false,
      system: { kind: 'processing', parentRowId: parent.rowId } });
    expect(recovery.conflicts.length).toBeGreaterThan(0);
    expect(await readback(fixture.conversationId)).toEqual(before);
    expect((await readTable(page, headers, fixture.conversationId, fixture.messageId)).rows.filter((row) => !row.deleted))
      .toHaveLength(5);
  });

  test('system-order material addition remains a draft until Save and keeps its stable identity on reload', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    await dialog.getByRole('button', { name: 'Add material', exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(before);
    const response = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const saved = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(saved.rows).toHaveLength(3);
    const added = saved.rows.find((row) => !initial.rows.some((original) => original.rowId === row.rowId));
    expect(added).toMatchObject({ origin: 'manual', deleted: false });
    expect(added?.rowId).toBeTruthy();
    expect(added?.values['型號'].baseline).toBeNull();
    const after = await readback(fixture.conversationId);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 20 |');
    expect(after.quotation?.currentOrder).toEqual(before.quotation?.currentOrder);
    expect(after.ocr).toEqual(before.ocr);
    expect(after.messages.find((message) => message.messageId === fixture.otherMessageId))
      .toEqual(before.messages.find((message) => message.messageId === fixture.otherMessageId));
    expect(after.reviews[0].aiBaselineMarkdown).toBe(initial.aiBaselineMarkdown ?? order);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(after);
    const reloaded = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(reloaded.rows.map((row) => row.rowId)).toEqual(saved.rows.map((row) => row.rowId));
    expect(reloaded.rows.find((row) => row.rowId === added?.rowId)).toEqual(added);
  });

  test('system-order price editing is a local draft until atomic Save and reload retains clean values', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const initial = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    const row = materialRow(dialog);
    await row.getByRole('textbox').last().fill('10.01');
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(before);
    const commitResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await commitResponse).status()).toBe(200);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(materialRow(dialog).locator('del')).toContainText('10');
    const after = await readback(fixture.conversationId);
    expect(after.quotation?.currentSystemOrder.runId).toBe(fixture.runId);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| REVIEW-MATERIAL-A | 2 | 21 |');
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 21 |');
    expect(after.quotation?.currentOrder).toEqual(before.quotation?.currentOrder);
    expect(after.quotation?.currentCustomer).toEqual(before.quotation?.currentCustomer);
    expect(after.ocr).toEqual(before.ocr);
    expect(after.artifacts).toEqual(before.artifacts);
    const savedText = after.messages.find((message) => message.messageId === fixture.messageId)?.text;
    expect(savedText).toContain('| 2 | 10.01 |');
    expect(savedText).toContain(oldQuote);
    expect(savedText).toContain('SYSTEM-PREFIX');
    expect(savedText).toContain('SYSTEM-SUFFIX');
    expect(savedText).not.toContain('~~');
    expect(after.messages.find((message) => message.messageId === fixture.otherMessageId))
      .toEqual(before.messages.find((message) => message.messageId === fixture.otherMessageId));
    expect(after.reviews[0]?.aiBaselineMarkdown).toBe(initial.aiBaselineMarkdown ?? order);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.locator('del')).toHaveCount(0);
    await expect(page.getByText('Updated', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(after);
    const reopened = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(reopened.rows[0].values['單價']).toMatchObject({ baseline: '10', effective: '10.01' });
    expect(reopened.rows[0].rowId).toBe(initial.rows[0].rowId);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Steel source review' }).getByText(
      'Updated 1 system-order rows; 1 internal quotation rows; total 21', { exact: true })).toBeVisible();
  });

  for (const values of [{ total: '2.1', price: '10.01', subtotal: '22' }, { total: '0', price: '10', subtotal: '0' },
    { total: '2', price: '', subtotal: '' }]) {
  test(`quote subtotal distinguishes decimal, zero and missing: ${values.total} × ${values.price}`, async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const before = await readback(fixture.conversationId);
    const operation = await prepare(page, headers, requestFor(table, [{ header: '總數', value: values.total }, { header: '單價', value: values.price }]));
    expect(await readback(fixture.conversationId)).toEqual(before);
    const response = await commit(page, headers, operation);
    expect(response.status()).toBe(200);
    const saved = await response.json() as SteelReviewSaveResponse;
    expect(saved.changedRows).toBe(1);
    const after = await readback(fixture.conversationId);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown)
      .toContain(`| REVIEW-MATERIAL-A | ${values.total} | ${values.subtotal} |`);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain(`| 總計 |  | ${values.subtotal} |`);
    expect(after.messages.find((message) => message.messageId === fixture.messageId)?.text).toContain(oldQuote);
    expect(after.ocr).toEqual(before.ocr);
    expect(await (await commit(page, headers, operation)).json()).toEqual(saved);
    expect(await readback(fixture.conversationId)).toEqual(after);
  });

  }

  test('prepare then commit merges another saved field and derives the quote from the transaction-current values', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const total = await prepare(page, headers, requestFor(table, [{ header: '總數', value: '3.2' }]));
    const price = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '11.1' }]));
    expect((await commit(page, headers, price)).status()).toBe(200);
    const merged = await commit(page, headers, total);
    expect(merged.status(), await merged.text()).toBe(200);
    const latest = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(latest.rows[0].values['總數'].effective).toBe('3.2');
    expect(latest.rows[0].values['單價'].effective).toBe('11.1');
    expect((await readback(fixture.conversationId)).quotation?.currentSystemOrder.customerQuoteMarkdown)
      .toContain('| REVIEW-MATERIAL-A | 3.2 | 36 |');
  });

  test('same-field conflict returns latest values, preserves DB and a same-value retry is a no-op', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const local = await prepare(page, headers, requestFor(table, [{ header: '總數', value: '8' }, { header: '單價', value: '12' }]));
    const foreign = await prepare(page, headers, requestFor(table, [{ header: '總數', value: '7' }, { header: '單價', value: '11' }]));
    expect((await commit(page, headers, foreign)).status()).toBe(200);
    const before = await readback(fixture.conversationId);
    const conflicted = await commit(page, headers, local);
    expect(conflicted.status()).toBe(409);
    const conflictBody = await conflicted.json();
    expect(conflictBody).toMatchObject({ code: 'REVIEW_CONFLICT' });
    const recovery = steelReviewRecoverySchema.parse(conflictBody.recovery);
    expect(recovery.table.effectiveMarkdown).toBe(before.quotation?.currentSystemOrder.markdown);
    expect(recovery.table.revision).toBe(before.reviews[0].revision);
    expect(recovery.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'field', header: '總數', current: '7', requested: '8' }),
      expect.objectContaining({ kind: 'field', header: '單價', current: '11', requested: '12' }),
    ]));
    expect(recovery.conflicts).toHaveLength(2);
    expect(await readback(fixture.conversationId)).toEqual(before);
    const same = await prepare(page, headers, requestFor(table, [{ header: '總數', value: '7' }]));
    const noop = await commit(page, headers, same);
    expect(noop.status()).toBe(200);
    expect((await noop.json() as SteelReviewSaveResponse).changedRows).toBe(0);
    expect(await readback(fixture.conversationId)).toEqual(before);
  });

  test('system-order undo and redo stay local, Save clears history and dirty close can discard later input', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    const total = materialRow(dialog).getByRole('textbox').first();
    const undo = dialog.getByRole('button', { name: 'Undo', exact: true });
    const redo = dialog.getByRole('button', { name: 'Redo', exact: true });
    await total.fill('5');
    await total.press('Enter');
    await undo.click();
    await expect(total).toHaveValue('2');
    await redo.click();
    await expect(total).toHaveValue('5');
    expect(await readback(fixture.conversationId)).toEqual(before);
    const savedResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await savedResponse).status()).toBe(200);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    const saved = await readback(fixture.conversationId);
    expect(saved.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| REVIEW-MATERIAL-A | 5 | 50 |');
    await total.fill('9');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(total).toHaveValue('9');
    expect(await readback(fixture.conversationId)).toEqual(saved);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(saved);
  });

  test('download first saves dirty system order atomically and repeated clean download does not write', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    await materialRow(dialog).getByRole('textbox').first().fill('3.1');
    const downloadReady = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download.*CSV/i }).click();
    const download = await downloadReady;
    const filePath = await download.path();
    if (!filePath) throw new Error('Missing completed download');
    const csv = await readFile(filePath, 'utf8');
    expect(csv).toContain('REVIEW-MATERIAL-A');
    expect(csv).toContain(',3.1,10,');
    expect(csv).not.toMatch(/<del>|~~|Updated|Previous version/);
    const saved = await readback(fixture.conversationId);
    expect(saved.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| REVIEW-MATERIAL-A | 3.1 | 31 |');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const cleanReady = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download.*CSV/i }).click();
    await cleanReady;
    expect(await readback(fixture.conversationId)).toEqual(saved);
  });

  test('failed prepare keeps system-order draft and prevents download until retry succeeds', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const before = await readback(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    const price = materialRow(dialog).getByRole('textbox').last();
    await price.fill('12');
    let downloads = 0;
    page.on('download', () => downloads++);
    const routePattern = '**/review/system_order/prepare';
    await page.route(routePattern, (route) => route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'REVIEW_SAVE_FAILED' }) }));
    await dialog.getByRole('button', { name: /Download.*CSV/i }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(downloads).toBe(0);
    expect(await readback(fixture.conversationId)).toEqual(before);
    await expect(price).toHaveValue('12');
    await page.unroute(routePattern);
    const downloadReady = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download.*CSV/i }).click();
    await downloadReady;
    expect((await readback(fixture.conversationId)).quotation?.currentSystemOrder.customerQuoteMarkdown)
      .toContain('| REVIEW-MATERIAL-A | 2 | 24 |');
  });

  test('a system-order Save needs no customer-quote chat section and never inserts one', async ({ page }) => {
    const fixture = await seedOrder(false);
    conversations.push(fixture.conversationId);
    const dialog = await openEditor(page, fixture.conversationId);
    await expect(materialRow(dialog).getByRole('textbox').last()).toBeEditable();
    await page.keyboard.press('Escape');
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const operation = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '12' }]));
    const response = await commit(page, headers, operation);
    expect(response.status()).toBe(200);
    const after = await readback(fixture.conversationId);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| REVIEW-MATERIAL-A | 2 | 24 |');
    const savedMessage = after.messages.find((message) => message.messageId === fixture.messageId);
    expect(savedMessage?.text).not.toContain('customer_quote');
    expect(JSON.stringify(savedMessage?.content)).not.toContain('customer_quote');
    const reopened = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    expect(reopened.rows[0].values['單價'].effective).toBe('12');
  });

  test('an OCR business Save remains stale after a system-order price Save and reload', async ({ page }) => {
    const fixture = await seedOrder(false, true);
    conversations.push(fixture.conversationId);
    const ocrUrl = `/api/steel/conversations/${fixture.conversationId}/review/ocr_result`;
    const sourceResponse = await page.request.get(`${ocrUrl}?${new URLSearchParams({ messageId: fixture.ocrMessageId, title: 'ocr_result' })}`, { headers });
    expect(sourceResponse.status()).toBe(200);
    const source = (await sourceResponse.json() as { table: SteelReviewTable }).table;
    const preparedResponse = await page.request.post(`${ocrUrl}/prepare`, { headers,
      data: requestFor(source, [{ header: '數量', value: '3' }]) });
    expect(preparedResponse.status(), await preparedResponse.text()).toBe(200);
    const prepared = await preparedResponse.json() as SteelReviewOperationPrepared;
    const sourceSave = await page.request.post(`${ocrUrl}/commit`, { headers,
      data: { ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest } });
    expect(sourceSave.status(), await sourceSave.text()).toBe(200);
    const stale = await readback(fixture.conversationId);
    expect(stale.quotation?.currentSystemOrder.needsRequote).toBe(true);
    const provenance = stale.quotation?.currentSystemOrder.requoteProvenance;
    expect(provenance).toMatchObject({ sourceMessageId: fixture.ocrMessageId, changedRows: 1 });
    await page.goto(`/c/${fixture.conversationId}`);
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    await page.getByTestId('message-body').filter({ hasText: 'SYSTEM-SUFFIX' })
      .getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(dialog).toBeVisible();
    await materialRow(dialog).getByRole('textbox').last().fill('12');
    const savedResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await savedResponse).status()).toBe(200);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const saved = await readback(fixture.conversationId);
    expect(saved.quotation?.currentSystemOrder.needsRequote).toBe(true);
    expect(saved.quotation?.currentSystemOrder.requoteProvenance).toEqual(provenance);
    expect(saved.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| REVIEW-MATERIAL-A | 2 | 24 |');
    expect(saved.ocr).toEqual(stale.ocr);
    expect(saved.messages.find((message) => message.messageId === fixture.ocrMessageId))
      .toEqual(stale.messages.find((message) => message.messageId === fixture.ocrMessageId));
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(saved);
  });

  test('completed receipt replay retains a human-saved system order without another message write', async ({ page }) => {
    const fixture = await seedOrder(false, true);
    conversations.push(fixture.conversationId);
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const prepared = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '12' }]));
    expect((await commit(page, headers, prepared)).status()).toBe(200);
    const saved = await readback(fixture.conversationId);
    const replay = await replayCompleted(fixture);
    expect(replay.result.markdown).toContain('| 2 | 12 |');
    expect(replay.result.markdown).not.toContain('customer_quote');
    expect(replay.projected).toBe(replay.result.markdown);
    expect(replay.writes).toBe(0);
    expect(replay.acceptedSameRecord).toBe(true);
    const savedMessage = JSON.parse(JSON.stringify(
      saved.messages.find((message) => message.messageId === fixture.messageId),
    ));
    // getMessage uses the schema's select:false for the internal Meili index flag.
    delete savedMessage._meiliIndex;
    expect(replay.persistedMessage).toEqual(savedMessage);
    const afterReplay = await readback(fixture.conversationId);
    expect({ ...afterReplay, quotation: { ...afterReplay.quotation, updatedAt: saved.quotation?.updatedAt } }).toEqual(saved);
    await page.goto(`/c/${fixture.conversationId}`);
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    await page.getByTestId('message-body').filter({ hasText: 'SYSTEM-SUFFIX' })
      .getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(materialRow(dialog).getByRole('textbox').last()).toHaveValue('12');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(afterReplay);
  });

  test('completed runner replay projects the human-saved value without model lookup or publication writes', async ({ page }) => {
    const fixture = await seedOrder(false, true);
    conversations.push(fixture.conversationId);
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const prepared = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '12' }]));
    expect((await commit(page, headers, prepared)).status()).toBe(200);
    const saved = await readback(fixture.conversationId);
    const replay = await replayPublishedRun(fixture);
    expect(replay.result.status).toBe('completed');
    expect(replay.result.markdown).toContain('| 2 | 12 |');
    expect(replay.emissions).toEqual([replay.result.markdown]);
    expect(replay.emissions[0]).not.toContain('customer_quote');
    expect([replay.modelCalls, replay.lookupCalls, replay.publishCalls]).toEqual([0, 0, 0]);
    expect(await readback(fixture.conversationId)).toEqual(saved);
    await page.goto(`/c/${fixture.conversationId}`);
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(saved);
  });

  test('a manual Save before first publication rejects the stale writer and preserves the saved message', async ({ page }) => {
    let signalReady!: (fixture: OrderFixture) => void;
    let releasePublication!: () => void;
    const ready = new Promise<OrderFixture>((resolve) => { signalReady = resolve; });
    const paused = new Promise<void>((resolve) => { releasePublication = resolve; });
    const publication = seedOrder(false, true, async (fixture) => {
      signalReady(fixture);
      await paused;
    });
    const outcome = publication.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
    const fixture = await ready;
    conversations.push(fixture.conversationId);
    let saved;
    try {
      const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      const prepared = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '12' }]));
      expect((await commit(page, headers, prepared)).status()).toBe(200);
      saved = await readback(fixture.conversationId);
    } finally {
      releasePublication();
    }
    const result = await outcome;
    const after = await readback(fixture.conversationId);
    expect(after.messages.find((message) => message.messageId === fixture.messageId))
      .toEqual(saved!.messages.find((message) => message.messageId === fixture.messageId));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'superseded_response' }) });
    expect(after).toEqual(saved);
    await page.goto(`/c/${fixture.conversationId}`);
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    await page.getByTestId('message-body').filter({ hasText: 'SYSTEM-SUFFIX' })
      .getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(materialRow(dialog).getByRole('textbox').last()).toHaveValue('12');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('SYSTEM-SUFFIX', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(saved);
  });


  test('a delayed unpublished completion preserves the different canonical revision owner', async ({ page }) => {
    let releaseFirst!: () => void;
    let firstReady!: (fixture: OrderFixture) => void;
    const pausedFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const readyFirst = new Promise<OrderFixture>((resolve) => { firstReady = resolve; });
    const first = seedOrder(false, true, async (fixture) => { firstReady(fixture); await pausedFirst; });
    const firstOutcome = first.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
    const fixture = await Promise.race([readyFirst, firstOutcome.then((result) => {
      if (!result.ok) throw result.error;
      throw new Error('Initial publication completed before reaching its barrier');
    })]);
    conversations.push(fixture.conversationId);
    let releaseRevision!: () => void;
    let revisionReady!: (messageId: string) => void;
    const pausedRevision = new Promise<void>((resolve) => { releaseRevision = resolve; });
    const readyRevision = new Promise<string>((resolve) => { revisionReady = resolve; });
    const revision = reviseCompleted(fixture, async (messageId) => { revisionReady(messageId); await pausedRevision; });
    const revisionOutcome = revision.then((result) => ({ ok: true, fixture: result }), (error) => ({ ok: false, error }));
    let messageId: string;
    try {
      messageId = await Promise.race([readyRevision, revisionOutcome.then((result) => {
        if (!result.ok) throw result.error;
        throw new Error('Revision completed before reaching its terminal barrier');
      })]);
      const before = await readback(fixture.conversationId);
      expect(before.artifacts.some((artifact) => artifact.operationId === 'published')).toBe(false);
      const originalMessage = before.messages.find((message) => message.messageId === fixture.messageId);
      const target = before.messages.find((message) => message.messageId === messageId);
      expect(target?.text).toContain('REVISION-SUFFIX');
      expect(target?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'tool_call' })]));
      const replay = await replayCompleted(fixture);
      expect(replay.writes).toBe(1);
      const after = await readback(fixture.conversationId);
      const preserved = after.messages.find((message) => message.messageId === messageId);
      expect(preserved?.text).toBe(target?.text);
      expect(preserved?.content).toEqual(target?.content);
      expect(preserved?.metadata).toEqual(target?.metadata);
      expect(after.messages.find((message) => message.messageId === fixture.messageId)).toEqual(originalMessage);
      expect(after.quotation?.currentSystemOrder).toEqual(before.quotation?.currentSystemOrder);
      expect(after.artifacts.some((artifact) => artifact.operationId === 'published')).toBe(true);
    } finally {
      releaseRevision();
      releaseFirst();
      await Promise.all([revisionOutcome, firstOutcome]);
    }
    expect(await revisionOutcome).toMatchObject({ ok: true });
    expect(await firstOutcome).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'superseded_response' }) });
    const saved = await readback(fixture.conversationId);
    await page.goto(`/c/${fixture.conversationId}`);
    await expect(page.getByText('REVISION-SUFFIX', { exact: true })).toBeVisible();
    await page.getByTestId('message-body').filter({ hasText: 'REVISION-SUFFIX' })
      .getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(materialRow(page.getByRole('dialog', { name: 'Steel source review' }))
      .getByRole('textbox').nth(0)).toHaveValue('3');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('REVISION-SUFFIX', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(saved);
  });

  test('a normal later revision keeps its current message, tool content and saved value through runner replay', async ({ page }) => {
    const original = await seedOrder(false, true);
    conversations.push(original.conversationId);
    const before = await readback(original.conversationId);
    const fixture = await reviseCompleted(original);
    const revised = await readback(fixture.conversationId);
    expect(revised.quotation?.activeRun?.targetMessageId).toBe(original.messageId);
    expect(revised.quotation?.currentSystemOrder?.messageId).toBe(fixture.messageId);
    expect(revised.messages.find((message) => message.messageId === original.messageId))
      .toEqual(before.messages.find((message) => message.messageId === original.messageId));
    const revisedTitle = revised.quotation!.currentSystemOrder!.markdown.split('\n')[0].replace(/^##\s+/u, '');
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId, revisedTitle);
    expect(table.rows[0].values['總數'].effective).toBe('3');
    const prepared = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '12' }]));
    expect((await commit(page, headers, prepared)).status()).toBe(200);
    const saved = await readback(fixture.conversationId);
    const message = saved.messages.find((entry) => entry.messageId === fixture.messageId);
    expect(message?.metadata).toMatchObject({ reviewBrowser: { retained: true } });
    expect(message?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'tool_call',
      tool_call: expect.objectContaining({ id: 'revision-lookup' }) })]));
    expect(saved.quotation?.currentSystemOrder?.customerQuoteMarkdown).toContain('| REVIEW-MATERIAL-A | 3 | 36 |');
    const replay = await replayPublishedRun(fixture);
    expect(replay.result.status).toBe('completed');
    expect(replay.emissions).toEqual([replay.result.markdown]);
    expect(replay.result.markdown).toContain('| 3 | 12 |');
    expect([replay.modelCalls, replay.lookupCalls, replay.publishCalls]).toEqual([0, 0, 0]);
    expect(await readback(fixture.conversationId)).toEqual(saved);
    await page.goto(`/c/${fixture.conversationId}`);
    await expect(page.getByText('REVISION-SUFFIX', { exact: true })).toBeVisible();
    await page.getByTestId('message-body').filter({ hasText: 'REVISION-SUFFIX' })
      .getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(materialRow(page.getByRole('dialog', { name: 'Steel source review' }))
      .getByRole('textbox').last()).toHaveValue('12');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('REVISION-SUFFIX', { exact: true })).toBeVisible();
    expect(await readback(fixture.conversationId)).toEqual(saved);
  });

  test('a human Save after a normal revision commit defeats the stale terminal writer', async ({ page }) => {
    const original = await seedOrder(false, true);
    conversations.push(original.conversationId);
    let readyRevision!: (messageId: string) => void;
    let releaseTerminal!: () => void;
    const ready = new Promise<string>((resolve) => { readyRevision = resolve; });
    const paused = new Promise<void>((resolve) => { releaseTerminal = resolve; });
    const revision = reviseCompleted(original, async (messageId) => {
      readyRevision(messageId);
      await paused;
    });
    const outcome = revision.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
    const messageId = await Promise.race([ready, outcome.then((result) => {
      if (!result.ok) throw result.error;
      throw new Error('Revision completed before reaching the Save barrier');
    })]);
    let saved;
    try {
      const revised = await readback(original.conversationId);
      const revisedTitle = revised.quotation!.currentSystemOrder!.markdown.split('\n')[0].replace(/^##\s+/u, '');
      const table = await readTable(page, headers, original.conversationId, messageId, revisedTitle);
      const prepared = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '12' }]));
      expect((await commit(page, headers, prepared)).status()).toBe(200);
      saved = await readback(original.conversationId);
    } finally {
      releaseTerminal();
    }
    const result = await outcome;
    const after = await readback(original.conversationId);
    expect(after.messages.find((message) => message.messageId === messageId))
      .toEqual(saved!.messages.find((message) => message.messageId === messageId));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'superseded_response' }) });
    expect(after).toEqual(saved);
    await page.goto(`/c/${original.conversationId}`);
    await expect(page.getByText('REVISION-SUFFIX', { exact: true })).toBeVisible();
    await page.getByTestId('message-body').filter({ hasText: 'REVISION-SUFFIX' })
      .getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(materialRow(page.getByRole('dialog', { name: 'Steel source review' }))
      .getByRole('textbox').last()).toHaveValue('12');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('REVISION-SUFFIX', { exact: true })).toBeVisible();
    expect(await readback(original.conversationId)).toEqual(saved);
  });

  test('a human Save before the revision result returns is not blessed by a newer canonical read', async ({ page }) => {
    const original = await seedOrder(false, true);
    conversations.push(original.conversationId);
    let readyRevision!: (messageId: string) => void;
    let releaseTerminal!: () => void;
    const ready = new Promise<string>((resolve) => { readyRevision = resolve; });
    const paused = new Promise<void>((resolve) => { releaseTerminal = resolve; });
    const revision = reviseCompleted(original, undefined, async (messageId) => {
      readyRevision(messageId);
      await paused;
    });
    const outcome = revision.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
    const messageId = await Promise.race([ready, outcome.then((result) => {
      if (!result.ok) throw result.error;
      throw new Error('Revision completed before reaching the Save barrier');
    })]);
    let saved;
    try {
      const revised = await readback(original.conversationId);
      const revisedTitle = revised.quotation!.currentSystemOrder!.markdown.split('\n')[0].replace(/^##\s+/u, '');
      const table = await readTable(page, headers, original.conversationId, messageId, revisedTitle);
      const prepared = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '12' }]));
      expect((await commit(page, headers, prepared)).status()).toBe(200);
      saved = await readback(original.conversationId);
    } finally {
      releaseTerminal();
    }
    const result = await outcome;
    const after = await readback(original.conversationId);
    expect(after.messages.find((message) => message.messageId === messageId))
      .toEqual(saved!.messages.find((message) => message.messageId === messageId));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'superseded_response' }) });
    expect(after).toEqual(saved);
    await page.goto(`/c/${original.conversationId}`);
    await expect(page.getByText('REVISION-SUFFIX', { exact: true })).toBeVisible();
    await page.getByTestId('message-body').filter({ hasText: 'REVISION-SUFFIX' })
      .getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(materialRow(page.getByRole('dialog', { name: 'Steel source review' }))
      .getByRole('textbox').last()).toHaveValue('12');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('REVISION-SUFFIX', { exact: true })).toBeVisible();
    expect(await readback(original.conversationId)).toEqual(saved);
  });

  for (const mode of ['adopted', 'prepared'] as const) {
  test(`a ${mode} publication cannot bless a human Save made before the next canonical read`, async ({ page }) => {
    const fixture = await seedOrder(false, true);
    conversations.push(fixture.conversationId);
    let readyAdoption!: () => void;
    let releaseAdoption!: () => void;
    const ready = new Promise<void>((resolve) => { readyAdoption = resolve; });
    const paused = new Promise<void>((resolve) => { releaseAdoption = resolve; });
    const adoption = adoptCompleted(fixture, async () => { readyAdoption(); await paused; }, mode);
    const outcome = adoption.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
    await Promise.race([ready, outcome.then((result) => {
      if (!result.ok) throw result.error;
      throw new Error('Adoption completed before reaching the Save barrier');
    })]);
    let saved;
    try {
      const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
      const prepared = await prepare(page, headers, requestFor(table, [{ header: '單價', value: '12' }]));
      expect((await commit(page, headers, prepared)).status()).toBe(200);
      saved = await readback(fixture.conversationId);
    } finally {
      releaseAdoption();
    }
    expect(await outcome).toEqual({ ok: true });
    expect(await readback(fixture.conversationId)).toEqual(saved);
    const dialog = await openEditor(page, fixture.conversationId);
    await expect(materialRow(dialog).getByRole('textbox').last()).toHaveValue('12');
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readback(fixture.conversationId)).toEqual(saved);
  });

  }

  test('system-order callers cannot supply another run, customer snapshot or immutable column', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const before = await readback(fixture.conversationId);
    const request = requestFor(table, [{ header: '單價', value: '12' }]);
    for (const extra of [{ runId: 'another-run' }, { customerIdentity: 'another-customer' }, { customerTier: 'F' }]) {
      const response = await page.request.post(`${reviewUrl(fixture.conversationId)}/prepare`, { headers, data: { ...request, ...extra } });
      expect(response.status()).toBe(400);
    }
    const unknownVersion = await page.request.post(`${reviewUrl(fixture.conversationId)}/prepare`, { headers,
      data: { ...request, revision: '0'.repeat(64) } });
    expect(unknownVersion.status()).toBe(409);
    expect(await unknownVersion.json()).toMatchObject({ code: 'REVIEW_CONFLICT' });
    const immutable = await page.request.post(`${reviewUrl(fixture.conversationId)}/prepare`, { headers,
      data: requestFor(table, [{ header: '型號', value: 'FREE-TEXT-MODEL' }]) });
    expect(immutable.status()).toBe(409);
    expect(await immutable.json()).toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
    expect(await readback(fixture.conversationId)).toEqual(before);
  });

  test('invalid system-order numeric draft is rejected without DB writes', async ({ page }) => {
    const fixture = await seedOrder();
    conversations.push(fixture.conversationId);
    const table = await readTable(page, headers, fixture.conversationId, fixture.messageId);
    const before = await readback(fixture.conversationId);
    const response = await page.request.post(`${reviewUrl(fixture.conversationId)}/prepare`, { headers,
      data: requestFor(table, [{ header: '總數', value: 'not-a-number' }]) });
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
    expect(await readback(fixture.conversationId)).toEqual(before);
  });
});
