import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createMethods, createModels } from '@librechat/data-schemas';
import type { SteelReviewErrorResponse, SteelReviewOperationCommit, SteelReviewOperationPrepare, SteelReviewOperationPrepared, SteelReviewSaveResponse, SteelReviewTable } from 'librechat-data-provider';
import type { Locator, Page } from '@playwright/test';
import {
  createSteelMarkdownCompletionServices,
  createSteelOcrStateService,
  createSteelQuotationStateService,
  prepareQuotationTurn,
} from '@librechat/api';
import { createSteelFullMarkdownPublisher } from '../../../packages/api/src/steel/markdown/full';
import { buildQuotationChunks } from '../../../packages/api/src/steel/quotation/protocol';
import { renderQuotationCustomerMarkdown } from '../../../packages/api/src/steel/quotation/preparation';
import { buildSteelQuotationStatusEvent } from '../../../packages/api/src/steel/native/events';
import {
  deleteConversations,
  deleteMessagesByConversation,
  seedConversations,
  seedMessages,
  withMongo,
} from './db';
import { getE2EUser } from '../../setup/user';
import { getAccessToken } from './helpers';

const ocr = [
  '## ocr_result',
  '| 來源 | 零件編號 | 長度 | 數量 | 頁碼 |',
  '| --- | --- | --- | --- | --- |',
  '| A | REVIEW-P1 | 1000 | 2 | 1 |',
  '| A | REVIEW-P2 | 2000 | 3 | 1 |',
].join('\n');

const publishedOcr = [
  '## source_file_mapping',
  '',
  '| 來源 | 檔名 |',
  '| --- | --- |',
  '| F1 | alpha.pdf |',
  '',
  '## ocr_result',
  '',
  '| 來源 | 零件編號 | 長度 | 數量 | 頁碼 | 類別 | 品名規格 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| F1 | REVIEW-P1 | 1000 | 2 | 1 | 鐵板 | 鋼板 6x1000x1000 |',
  '| F1 | REVIEW-P2 | 2000 | 3 | 1 | 鐵板 | 鋼板 6x1000x2000 |',
].join('\n');

async function seedCurrent(markdown: string) {
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const email = getE2EUser().email;
  await seedConversations(email, [{ conversationId, title: 'Steel source review proof', updatedAt: new Date() }]);
  await seedMessages(email, conversationId, [{
    messageId,
    parentMessageId: '00000000-0000-0000-0000-000000000000',
    text: markdown,
    content: [{ type: 'text', text: markdown }],
    isCreatedByUser: false,
    sender: 'Assistant',
  }]);
  await withMongo(async (db) => {
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      throw new Error('Missing authenticated fixture user');
    }
    await db.collection('files').insertOne({
      user: user._id,
      conversationId,
      messageId,
      file_id: 'review-alpha',
      filename: 'alpha.pdf',
      filepath: join(__dirname, 'fixtures', 'alpha.pdf'),
      type: 'application/pdf',
      bytes: 1024,
      object: 'file',
      source: 'local',
      context: 'message_attachment',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('messages').updateOne({ conversationId, messageId }, {
      $set: { metadata: { steel: { preflightToolCalls: [{
        type: 'tool_call',
        id: 'review-proof-paddle',
        name: 'paddleocr_vl',
        args: {
          output_mode: 'detailed',
          return_images: false,
          use_doc_orientation_classify: false,
          use_doc_unwarping: false,
          use_layout_detection: false,
        },
        progress: 1,
      }] } } },
    });
    await db.collection('steel_conversation_ocr_state').insertOne({
      conversationId,
      currentOcrResultMarkdown: ocr,
      currentOcrResultMessageId: messageId,
      currentOcrResultGenerationId: 'review-proof-generation',
      currentOcrResultAttemptId: 'review-proof-attempt',
      sourceMappings: [{ fileId: 'review-alpha', sourceCode: 'A', sourceFilename: 'alpha.pdf' }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  return { conversationId, messageId };
}

interface PublishedSourceFixture {
  fileId: string;
  filename: string;
  type: string;
}

/** Seed the representative OCR response through the normal admission/publication boundary. */
async function seedCurrentPublished(markdown: string, sourceFiles: PublishedSourceFixture[] = [
  { fileId: 'review-alpha', filename: 'alpha.pdf', type: 'application/pdf' },
], reuse?: { conversationId: string; messageId?: string; parentMessageId?: string }) {
  const conversationId = reuse?.conversationId ?? randomUUID();
  const messageId = reuse?.messageId ?? randomUUID();
  const email = getE2EUser().email;
  if (!reuse) await seedConversations(email, [{ conversationId, title: 'Steel source review proof', updatedAt: new Date() }]);
  const { userId, userObjectId } = await withMongo(async (db) => {
    const user = await db.collection('users').findOne({ email });
    if (!user) throw new Error('Missing authenticated fixture user');
    return { userId: String(user._id), userObjectId: user._id };
  });
  if (!reuse) await withMongo(async (db) => {
    await db.collection('files').insertMany(sourceFiles.map((source) => ({
      user: userObjectId,
      conversationId,
      messageId,
      file_id: source.fileId,
      filename: source.filename,
      filepath: join(__dirname, 'fixtures', source.type === 'image/heic' ? 'alpha.pdf' : source.filename),
      type: source.type,
      bytes: 1024,
      object: 'file',
      source: 'local',
      context: 'message_attachment',
      createdAt: new Date(),
      updatedAt: new Date(),
    })));
  });
  const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
  await mongoose.connect(runtime.MONGO_URI);
  try {
    createModels(mongoose);
    const methods = createMethods(mongoose);
    const ocrService = createSteelOcrStateService(mongoose);
    for (const source of sourceFiles) {
      await ocrService.allocateDelegateSourceMapping({ conversationId,
        fileId: source.fileId, sourceFilename: source.filename });
    }
    const scope = { userId, conversationId };
    const generationId = randomUUID();
    const userMessageId = `ocr-user-${generationId}`;
    await seedMessages(email, conversationId, [{ messageId: userMessageId,
      parentMessageId: reuse?.parentMessageId ?? null, text: '確認 OCR 來源表格',
      isCreatedByUser: true, sender: 'User' }]);
    const quotation = await prepareQuotationTurn({ scope, messageId: userMessageId,
      responseId: messageId, generationId, publicationStore: methods, text: '確認 OCR 來源表格' });
    let physical = markdown;
    const finalizer = createSteelMarkdownCompletionServices({
      ocr: ocrService,
      quotation: createSteelQuotationStateService(mongoose),
    });
    const result = await finalizer.finalize({
      req: { user: { id: userId }, cookies: { lang: 'zh-TW' },
        steelNativeContext: { requestId: messageId, ocrTurnActive: true, quotation } },
      responseId: messageId,
      generationId,
      markdown,
      completed: true,
      applyMarkdown: (value) => { physical = value; },
      persistMarkdown: (options) => methods.saveMessage({ userId }, {
        user: userId, conversationId, messageId, text: physical,
        content: [{ type: 'text', text: physical }], isCreatedByUser: false, sender: 'Assistant',
        unfinished: options?.completed === false,
      }, { context: 'steel-review-e2e-normal-ocr' }),
      publishMarkdown: createSteelFullMarkdownPublisher({
        buildMessage: ({ markdown: clean }) => ({ user: userId, conversationId, messageId,
          ...(reuse?.parentMessageId ? { parentMessageId: reuse.parentMessageId } : {}),
          text: clean, isCreatedByUser: false, sender: 'Assistant' }),
        savePublication: methods.publishSteelMarkdown,
      }),
    });
    if (!result.publication) throw new Error('Missing normal OCR publication');
  } finally {
    await mongoose.disconnect();
  }
  return { conversationId, messageId };
}

async function seedSavedReviewData(page: Page, headers: { Authorization: string }) {
  const { conversationId, messageId } = await seedCurrent(ocr);
  const read = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
  expect(read.status()).toBe(200);
  const { table } = await read.json() as { table: SteelReviewTable };
  const prepared = await prepareQuantity(page, headers, table, '7');
  const saved = await commitOperation(page, headers, prepared);
  const snapshot = saved.savedSnapshot;
  if (!snapshot) throw new Error('Missing confirmed current-protocol snapshot');
  const userId = await withMongo(async (db) => {
    const owner = await db.collection('messages').findOne({ conversationId, messageId });
    if (!owner) throw new Error('Missing saved review owner');
    return String(owner.user);
  });
  return { conversationId, messageId, prepared, snapshot, userId };
}

async function seedSelectorFiles(conversationId: string) {
  await withMongo(async (db) => {
    const alpha = await db.collection('files').findOne({ conversationId, file_id: 'review-alpha' });
    if (!alpha) throw new Error('Missing selector fixture file');
    await db.collection('files').insertMany([
      { ...alpha, _id: new ObjectId(), file_id: 'review-beta', filename: 'beta.pdf',
        filepath: join(__dirname, 'fixtures', 'beta.pdf') },
      { ...alpha, _id: new ObjectId(), file_id: 'review-gamma', filename: 'gamma.png',
        filepath: join(__dirname, 'fixtures', 'gamma.png'), type: 'image/png' },
      { ...alpha, _id: new ObjectId(), file_id: 'review-foreign-selector', tenantId: 'foreign-selector-tenant' },
      { ...alpha, _id: new ObjectId(), file_id: 'review-expired-selector', expiredAt: new Date(0) },
    ]);
  });
}

async function persistedSnapshot(conversationId: string) {
  return withMongo(async (db) => ({
    messages: await db.collection('messages').find({ conversationId }).toArray(),
    ocr: await db.collection('steel_conversation_ocr_state').findOne({ conversationId }),
    reviews: await db.collection('steel_review_outputs').find({ conversationId }).toArray(),
    quotations: await db.collection('steel_quotation_states').find({ conversationId }).toArray(),
  }));
}

function expectPreservedAiState(
  before: Awaited<ReturnType<typeof persistedSnapshot>>['ocr'],
  after: Awaited<ReturnType<typeof persistedSnapshot>>['ocr'],
) {
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  const { reviewLockToken: previousToken, ...original } = before ?? {};
  const { reviewLockToken: savedToken, ...saved } = after ?? {};
  expect(saved).toEqual(original);
  expect(typeof savedToken).toBe('string');
  expect(savedToken).not.toBe('');
  expect(savedToken).not.toBe(previousToken);
}

function reviewValue(dialog: Locator, value: string) {
  return dialog.locator(`input[value=${JSON.stringify(value)}]`).or(dialog.getByText(value, { exact: true }));
}

async function bindSource(page: Page, row: Locator, rowId: string, filename: string, pageNumber: string): Promise<void> {
  await row.getByRole('button', { name: new RegExp(`^(?:Link|Linked) ${rowId}$`, 'u') }).click();
  const popup = page.getByRole('dialog', { name: 'Link source', exact: true });
  await popup.getByRole('combobox', { name: 'Source file', exact: true }).click();
  await page.getByRole('option', { name: filename, exact: true }).click();
  await popup.getByRole('combobox', { name: /page/iu }).click();
  await page.getByRole('option', { name: pageNumber, exact: true }).click();
  await popup.getByRole('button', { name: 'Confirm', exact: true }).click();
}

function readUrl(conversationId: string, messageId: string, title = 'ocr_result') {
  const query = new URLSearchParams({ messageId, title });
  return `/api/steel/conversations/${conversationId}/review/ocr_result?${query}`;
}

function titleReadUrl(conversationId: string, messageId: string, title = 'ocr_result') {
  const query = new URLSearchParams({ messageId, title });
  return `/api/steel/conversations/${conversationId}/review/ocr_result?${query}`;
}

type ReviewOperation = SteelReviewOperationPrepare['operations'][number];
type SourceUpdate = NonNullable<Extract<ReviewOperation, { type: 'update' }>['source']> & { rowId: string };

function requestForRows(
  table: SteelReviewTable,
  rows: SteelReviewTable['rows'] = table.rows,
  sourceIntents: readonly SourceUpdate[] = [],
): SteelReviewOperationPrepare {
  const original = new Map(table.rows.map((row) => [row.rowId, row]));
  const sources = new Map(sourceIntents.map(({ rowId, ...source }) => [rowId, source]));
  const operations: ReviewOperation[] = [];
  for (const row of rows) {
    const previous = original.get(row.rowId);
    const source = sources.get(row.rowId) ?? (row.source
      ? { fileId: row.source.fileId, pageNumber: row.source.pageNumber } : { fileId: null, pageNumber: null });
    if (!previous) {
      const insertion = row.insertion;
      const position = insertion?.kind === 'after'
        ? { kind: 'after' as const, rowId: insertion.rowId }
        : { kind: insertion?.kind ?? 'end' as const };
      operations.push({ type: 'add', rowId: row.rowId, position, source,
        changes: table.headers.filter((header) => !['來源', '頁碼'].includes(header))
          .map((header) => ({ header, value: row.values[header].effective })) });
      continue;
    }
    if (previous.deleted && !row.deleted) operations.push({ type: 'restore', rowId: row.rowId });
    const changes = table.headers.filter((header) => previous.values[header].effective !== row.values[header].effective)
      .map((header) => ({ header, value: row.values[header].effective }));
    const changedSource = sources.has(row.rowId) || previous.source?.fileId !== row.source?.fileId ||
      previous.source?.pageNumber !== row.source?.pageNumber;
    if (changes.length || changedSource) {
      operations.push({ type: 'update', rowId: row.rowId,
        ...(changes.length ? { changes } : {}), ...(changedSource ? { source } : {}) });
    }
    if (!previous.deleted && row.deleted) operations.push({ type: 'delete', rowId: row.rowId });
  }
  return { conversationId: table.conversationId, messageId: table.messageId,
    kind: table.kind, title: table.title, outputId: table.outputId, revision: table.revision, operations };
}

function operationCommit(operation: SteelReviewOperationPrepared): SteelReviewOperationCommit {
  return { ...operation.operationRequest, operationId: operation.operationId, digest: operation.digest };
}

async function prepareQuantity(
  page: Page,
  headers: { Authorization: string },
  table: SteelReviewTable,
  value: string,
  title?: string,
) {
  const request: SteelReviewOperationPrepare & { title?: string } = {
    conversationId: table.conversationId, messageId: table.messageId,
    kind: table.kind, title: title ?? table.title,
    outputId: table.outputId, revision: table.revision,
    operations: [{ type: 'update', rowId: table.rows[0].rowId,
      changes: [{ header: '數量', value }] }],
  };
  const url = `/api/steel/conversations/${table.conversationId}/review/ocr_result`;
  const response = await page.request.post(`${url}/prepare`, { headers, data: request });
  expect(response.status()).toBe(200);
  return await response.json() as SteelReviewOperationPrepared;
}

async function commitOperation(
  page: Page,
  headers: { Authorization: string },
  operation: SteelReviewOperationPrepared,
) {
  const request = { ...operation.operationRequest,
    operationId: operation.operationId, digest: operation.digest };
  const response = await page.request.post(
    `/api/steel/conversations/${request.conversationId}/review/ocr_result/commit`,
    { headers, data: request },
  );
  expect(response.status()).toBe(200);
  return await response.json() as SteelReviewSaveResponse;
}

test.describe('Steel managed source review', () => {
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
      await db.collection('steel_conversation_ocr_state').deleteMany({ conversationId: { $in: ids } });
      await db.collection('steel_review_outputs').deleteMany({ conversationId: { $in: ids } });
      await db.collection('steel_delegate_ocr_runs').deleteMany({ conversationId: { $in: ids } });
      await db.collection('steel_quotation_states').deleteMany({ conversationId: { $in: ids } });
      await db.collection('steel_quotation_artifacts').deleteMany({ conversationId: { $in: ids } });
      await db.collection('files').deleteMany({ conversationId: { $in: ids } });
    });
    await deleteConversations(ids);
  });

  test('normal new AI publication retains the saved historical OCR sidecar and opens it read-only after reload', async ({ page }) => {
    const original = await seedCurrentPublished(publishedOcr);
    conversations.push(original.conversationId);
    const read = await page.request.get(titleReadUrl(original.conversationId, original.messageId), { headers });
    const table = (await read.json() as { table: SteelReviewTable }).table;
    await commitOperation(page, headers, await prepareQuantity(page, headers, table, '7'));
    const newer = await seedCurrentPublished(publishedOcr.replace('| F1 | REVIEW-P1 | 1000 | 2 |', '| F1 | REVIEW-P1 | 1000 | 4 |'), undefined,
      { conversationId: original.conversationId, parentMessageId: original.messageId });
    const historical = await page.request.get(titleReadUrl(original.conversationId, original.messageId), { headers });
    expect(historical.status()).toBe(200);
    const old = (await historical.json() as { table: SteelReviewTable }).table;
    expect(old).toMatchObject({ readOnly: true, isLatest: false });
    expect(old.rows[0].values['數量'].effective).toBe('7');
    const current = await page.request.get(titleReadUrl(newer.conversationId, newer.messageId), { headers });
    expect((await current.json() as { table: SteelReviewTable }).table).toMatchObject({ readOnly: false, isLatest: true });
    const saved = await persistedSnapshot(original.conversationId);
    await page.goto(`/c/${original.conversationId}`);
    await expect(page.getByText('Previous version v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Save/ })).toBeDisabled();
    await expect(reviewValue(dialog, '7')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.reload();
    await expect(page.getByText('Previous version v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Steel source review' }).getByRole('textbox')).toHaveCount(0);
    expect(await persistedSnapshot(original.conversationId)).toEqual(saved);
  });

  test('saved human OCR admission remains fixed after another Save and reload shows its actual quotation source', async ({ page }) => {
    const fixture = await seedCurrentPublished(publishedOcr);
    conversations.push(fixture.conversationId);
    const read = await page.request.get(titleReadUrl(fixture.conversationId, fixture.messageId), { headers });
    expect(read.status()).toBe(200);
    const original = (await read.json() as { table: SteelReviewTable }).table;
    const saved = await commitOperation(page, headers, await prepareQuantity(page, headers, original, '7'));
    expect(saved.savedSnapshot).toBeDefined();
    const userId = await withMongo(async (db) => {
      const message = await db.collection('messages').findOne({ conversationId: fixture.conversationId, messageId: fixture.messageId });
      if (!message) throw new Error('Missing saved OCR message');
      return String(message.user);
    });
    const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
    const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
    const targetMessageId = randomUUID();
    await mongoose.connect(runtime.MONGO_URI);
    let runId: string;
    let inputHash: string;
    try {
      createModels(mongoose);
      const methods = createMethods(mongoose);
      const service = createSteelQuotationStateService(mongoose);
      const scope = { userId, conversationId: fixture.conversationId };
      const before = await service.ensureState(scope);
      const prepared = await service.prepareOcrOrder(scope, before.currentOrder?.sha256 ?? null);
      expect(prepared.input?.selection.selected.source).toBe('human');
      expect(prepared.input?.selection.version).toBe(2);
      expect(prepared.input?.sourceSnapshot.mappings).toEqual([expect.objectContaining({ fileId: 'review-alpha', sourceCode: 'F1' })]);
      const customerMarkdown = renderQuotationCustomerMarkdown({ tier: 'B' });
      await service.saveCustomer({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
        triggeringMessageId: 'source-customer', responseId: 'source-customer-response',
        orderHash: prepared.state.currentOrder!.sha256,
        selectionProvenance: { method: 'default_tier', selectionMessageId: 'source-customer' } });
      const ticket = await service.issueTicket({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
        triggeringMessageId: 'source-quote', selectionProvenance: { method: 'default_tier', selectionMessageId: 'source-customer' } });
      const run = await service.acceptSignal({ scope, index: ticket.index, token: ticket.token,
        orderHash: ticket.orderHash, customerMarkdown, customerIdentity: ticket.customerIdentity,
        prompts: { child: 'External provider fixture child', main: 'External provider fixture main' },
        chunks: buildQuotationChunks(prepared.state.currentOrder!.markdown, 30).map((chunk) => ({ index: chunk.chunkIndex, sourceRowCount: chunk.sourceRows.length })),
        targetMessageId });
      runId = run.runId;
      inputHash = run.snapshotRef.sha256;
      await methods.saveMessage({ userId }, { user: userId, conversationId: fixture.conversationId,
        messageId: targetMessageId, parentMessageId: fixture.messageId, text: 'Saved quotation admission',
        content: [{ type: 'text', text: 'Saved quotation admission' }], isCreatedByUser: false, sender: 'Assistant',
        metadata: { steel: { activityEvents: [buildSteelQuotationStatusEvent({ conversationId: fixture.conversationId,
          messageId: targetMessageId, index: run.index, runId, stage: 'accepted', status: 'queued', completedChunks: 0, totalChunks: run.chunks.length })] } },
      }, { context: 'normal quotation admission browser proof' });
    } finally {
      await mongoose.disconnect();
    }
    const currentRead = await page.request.get(titleReadUrl(fixture.conversationId, fixture.messageId), { headers });
    const current = (await currentRead.json() as { table: SteelReviewTable }).table;
    await commitOperation(page, headers, await prepareQuantity(page, headers, current, '8'));
    const statusResponse = await page.request.get(`/api/steel/conversations/${fixture.conversationId}/quotation`, { headers });
    expect(statusResponse.status()).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ runId, ocrSource: { source: 'human', version: 2 } });
    await withMongo(async (db) => {
      const state = await db.collection('steel_quotation_states').findOne({ conversationId: fixture.conversationId, userId });
      expect(state?.activeRun.snapshotRef.sha256).toBe(inputHash);
      expect(state?.markdownPublication.lastHumanOcr.version).toBe(3);
      const artifact = await db.collection('steel_quotation_artifacts').findOne({ conversationId: fixture.conversationId, runId, operationId: 'snapshot' });
      const snapshot = JSON.parse(artifact!.payload);
      expect(snapshot.ocrSelection.selected.sha256).toBe(state?.activeRun.ocrSelection.selected.sha256);
      expect(snapshot.orderMarkdown).toContain('| 7 |');
      expect(snapshot.orderMarkdown).not.toContain('| 8 |');
    });
    await page.goto(`/c/${fixture.conversationId}`);
    await expect(page.getByText('Quotation source: Saved human OCR v2', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Quotation source: Saved human OCR v2', { exact: true })).toBeVisible();
    await page.getByText('Quotation source: Saved human OCR v2', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'e2e/specs/.test-results/steel-quotation-source-human.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.getByText('Quotation source: Saved human OCR v2', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText('Quotation source: Saved human OCR v2', { exact: true })).toBeInViewport();
    await page.screenshot({ path: 'e2e/specs/.test-results/steel-quotation-source-narrow.png' });
  });

  test('only the canonical table opens and read/reload leaves DB and unrelated text unchanged', async ({ page }) => {
    const markdown = [
      'REVIEW-UNRELATED-PREFIX',
      '## Ordinary table\n| Label | Value |\n| --- | --- |\n| Plain | Keep |',
      ocr,
      '## Unmanaged source table\n| 來源 | 零件編號 | 長度 | 數量 | 頁碼 |\n| --- | --- | --- | --- | --- |\n| A | UNMANAGED | 5 | 9 | 1 |',
      '## customer_quote\n| Item | Subtotal |\n| --- | --- |\n| Keep quote | 42 |',
      '```markdown\n' + ocr + '\n```',
      'REVIEW-UNRELATED-SUFFIX',
    ].join('\n\n');
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const target = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(target.status()).toBe(200);
    expect(await target.json()).toMatchObject({ table: {
      conversationId,
      messageId,
      kind: 'ocr_result',
      isLatest: true,
      readOnly: false,
      rows: [
        { source: { fileId: 'review-alpha', pageNumber: 1 } },
        { source: { fileId: 'review-alpha', pageNumber: 1 } },
      ],
    } });
    const unbound = await page.request.get(readUrl(conversationId, messageId, 'Unmanaged source table'), { headers });
    expect(unbound.status()).toBe(404);
    await page.goto(`/c/${conversationId}`);
    await expect(page.getByText('REVIEW-UNRELATED-SUFFIX', { exact: true })).toBeVisible();
    const button = page.getByRole('button', { name: 'Open Steel review', exact: true });
    await expect(button).toHaveCount(1);
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(dialog).toBeVisible();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await expect(reviewValue(dialog, 'REVIEW-P2')).toBeVisible();
    await expect(reviewValue(dialog, 'UNMANAGED')).toHaveCount(0);
    await expect(dialog.getByRole('textbox')).toHaveCount(6);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open Steel review', exact: true })).toHaveCount(1);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('title locator requires the exact title and rejects removed positional fields', async ({ page }) => {
    const markdown = `TITLE-KEEP-PREFIX\n\n## Ordinary table\n| Key | Value |\n| --- | --- |\n| Keep | 8 |\n\n${ocr}`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(response.status()).toBe(200);
    const { table } = await response.json() as { table: SteelReviewTable };
    expect(table.title).toBe('ocr_result');
    expect(table).not.toHaveProperty('tableId');
    expect(table).not.toHaveProperty('partIndex');
    for (const title of ['OCR_RESULT', 'ocr_result extra', 'ocr_resul']) {
      expect((await page.request.get(titleReadUrl(conversationId, messageId, title), { headers })).status()).toBe(404);
    }
    const missingTitle = `/api/steel/conversations/${conversationId}/review/ocr_result?${new URLSearchParams({ messageId })}`;
    expect((await page.request.get(missingTitle, { headers })).status()).toBe(400);
    for (const field of ['tableId=ocr_result%3A99', 'partIndex=99']) {
      expect((await page.request.get(`${titleReadUrl(conversationId, messageId)}&${field}`, { headers })).status()).toBe(400);
    }
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('title locator UI sends only changed rows and updates only its exact message and section', async ({ page }) => {
    const markdown = `TITLE-KEEP-PREFIX\n\n${ocr}\n\n## Other data\n| Key | Value |\n| --- | --- |\n| Keep | 42 |\n\nTITLE-KEEP-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const otherMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: otherMessageId, parentMessageId: messageId,
      text: ocr, content: [{ type: 'text', text: ocr }], isCreatedByUser: false, sender: 'Assistant',
    }]);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="REVIEW-P1"]') });
    await row.locator('input').last().fill('9');
    const prepareRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/ocr_result/prepare'));
    const commitRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/review/ocr_result/commit'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const preparedBody = (await prepareRequest).postDataJSON() as SteelReviewOperationPrepare & { title: string };
    const committedBody = (await commitRequest).postDataJSON() as SteelReviewOperationCommit & { title: string };
    for (const body of [preparedBody, committedBody]) {
      expect(body.title).toBe('ocr_result');
      expect(body.messageId).toBe(messageId);
      expect(body).not.toHaveProperty('tableId');
      expect(body).not.toHaveProperty('partIndex');
      expect(body.operations).toEqual([{ type: 'update', rowId: table.rows[0].rowId,
        changes: [{ header: '數量', value: '9' }] }]);
      expect(body).not.toHaveProperty('rows');
      expect(body).not.toHaveProperty('aiRawMarkdown');
      expect(body).not.toHaveProperty('aiBaselineMarkdown');
    }
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toHaveCount(0);
    const after = await persistedSnapshot(conversationId);
    const clean = markdown.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 9 | 1 |');
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(clean);
    expect(after.messages.find((message) => message.messageId === messageId)?.content).toEqual([{ type: 'text', text: clean }]);
    expect(after.messages.find((message) => message.messageId === otherMessageId))
      .toEqual(before.messages.find((message) => message.messageId === otherMessageId));
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews[0]?.aiRawMarkdown).toBe(ocr);
    expectPreservedAiState(before.ocr, after.ocr);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await persistedSnapshot(conversationId)).toEqual(after);
    const reloaded = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toMatchObject({ table: { title: 'ocr_result',
      rows: [{ rowId: table.rows[0].rowId, values: { 數量: { baseline: '2', effective: '9' } } }, {}] } });
    await expect(page.locator('del')).toHaveCount(0);
  });

  test('title locator keeps one row ledger and immutable current-protocol receipts across consecutive Saves', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const initial = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(initial.status()).toBe(200);
    const { table } = await initial.json() as { table: SteelReviewTable };
    const rowIds = table.rows.map((row) => row.rowId);
    const operation = await prepareQuantity(page, headers, table, '7');
    const firstReceipt = await commitOperation(page, headers, operation);
    const first = await persistedSnapshot(conversationId);
    expect(first.reviews).toHaveLength(1);
    const response = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(response.status()).toBe(200);
    const { table: current } = await response.json() as { table: SteelReviewTable };
    expect(current.title).toBe(table.title);
    expect(current.rows.map((row) => row.rowId)).toEqual(rowIds);
    await commitOperation(page, headers, await prepareQuantity(page, headers, current, '8'));
    const second = await persistedSnapshot(conversationId);
    expect(second.reviews).toHaveLength(1);
    expect(second.reviews[0]?.title).toBe('ocr_result');
    expect(second.reviews[0]?.rows.map((row: SteelReviewTable['rows'][number]) => row.rowId)).toEqual(rowIds);
    expect(second.reviews[0]?.aiRawMarkdown).toBe(first.reviews[0]?.aiRawMarkdown);
    expect(second.reviews[0]?.aiBaselineMarkdown).toBe(first.reviews[0]?.aiBaselineMarkdown);
    expect(second.reviews[0]?.receipts).toHaveLength(2);
    expect(second.reviews[0]?.receipts[0]).toEqual(first.reviews[0]?.receipts[0]);
    expect(second.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
    expect(await commitOperation(page, headers, operation)).toEqual(firstReceipt);
    expect(await persistedSnapshot(conversationId)).toEqual(second);
  });

  test('title locator re-resolves a moved physical section and rejects forged storage aliases without writing', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const operation = await prepareQuantity(page, headers, table, '7', 'ocr_result');
    const prefix = 'TITLE-NEW-PREFIX\n\n## Unrelated insertion\n| Key | Value |\n| --- | --- |\n| Keep | 55 |\n\n';
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, { $set: {
        text: prefix + ocr, content: [{ type: 'text', text: prefix + ocr }],
      } });
    });
    const moved = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const forgedPrepare = await page.request.post(`${url}/prepare`, { headers,
      data: { ...operation.operationRequest, tableId: 'ocr_result:1' } });
    expect(forgedPrepare.status()).toBe(400);
    const forgedCommit = await page.request.post(`${url}/commit`, { headers, data: {
      ...operation.operationRequest, tableId: 'ocr_result:1',
      operationId: operation.operationId, digest: operation.digest,
    } });
    expect(forgedCommit.status()).toBe(400);
    expect(await persistedSnapshot(conversationId)).toEqual(moved);
    await commitOperation(page, headers, operation);
    const after = await persistedSnapshot(conversationId);
    const clean = prefix + ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |');
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(clean);
    expect(after.messages.find((message) => message.messageId === messageId)?.content).toEqual([{ type: 'text', text: clean }]);
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews[0]?.title).toBe('ocr_result');
    const latest = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(latest.status()).toBe(200);
    expect(await latest.json()).toMatchObject({ table: { title: 'ocr_result',
      rows: [{ rowId: table.rows[0].rowId, values: { 數量: { effective: '7' } } }, {}] } });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('title locator rejects duplicated full titles without creating or changing any data', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(`${ocr}\n\n${ocr}`);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(response.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a normal upload attached to a prior user message locates its source without File conversation metadata', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const userMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: userMessageId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: 'Review uploaded source',
      isCreatedByUser: true,
      sender: 'User',
      files: [{ file_id: 'review-alpha' }],
    }]);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, {
        $set: { parentMessageId: userMessageId },
      });
      await db.collection('files').updateOne({ conversationId, file_id: 'review-alpha' }, {
        $unset: { conversationId: '', messageId: '' },
      });
    });
    try {
      const before = await persistedSnapshot(conversationId);
      const result = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(result.status()).toBe(200);
      expect(await result.json()).toMatchObject({ table: { rows: [
        { source: { fileId: 'review-alpha', pageNumber: 1 } },
        { source: { fileId: 'review-alpha', pageNumber: 1 } },
      ] } });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      await page.goto(`/c/${conversationId}`);
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Steel source review' });
      await dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 /u }).fill('7');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      const saved = await persistedSnapshot(conversationId);
      expect(saved.messages.find((message) => message.messageId === messageId)?.text)
        .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'));
      const reloaded = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(reloaded.status()).toBe(200);
      expect(await reloaded.json()).toMatchObject({ table: { rows: [
        { source: { fileId: 'review-alpha', pageNumber: 1 }, values: { 數量: { effective: '7' } } },
        { source: { fileId: 'review-alpha', pageNumber: 1 } },
      ] } });
      await page.keyboard.press('Escape');
      await page.reload();
      await expect(page.getByRole('row').filter({ hasText: 'REVIEW-P1' })
        .getByRole('cell', { name: '7', exact: true })).toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(saved);
    } finally {
      await withMongo(async (db) => {
        await db.collection('files').updateOne({ file_id: 'review-alpha' }, { $set: { conversationId } });
      });
    }
  });

  test('a saved text-only Markdown supports its actual text target without inventing a content mirror', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, { $unset: { content: '' } });
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(result.status()).toBe(200);
    const data = await result.json();
    expect(data).toMatchObject({ table: { isLatest: true, rows: [{ source: { fileId: 'review-alpha' } }, { source: { fileId: 'review-alpha' } }] } });
    expect(data.table).not.toHaveProperty('partIndex');
    expect(data.table.title).toBe('ocr_result');
    await page.goto(`/c/${conversationId}`);
    await expect(page.getByRole('button', { name: 'Open Steel review', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open Steel review', exact: true })).toHaveCount(1);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a stale rendered content mirror is rejected without changing either message representation', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, {
        $set: { content: [{ type: 'text', text: ocr.replace('REVIEW-P1', 'RENDERED-DIFFERENT') }] },
      });
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(result.status()).toBe(404);
    await page.goto(`/c/${conversationId}`);
    await expect(page.getByText('RENDERED-DIFFERENT', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Steel review', exact: true })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a registered review cannot expose a table removed from the message', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent('REVIEW-REMOVED-TARGET');
    conversations.push(conversationId);
    await withMongo(async (db) => {
      const message = await db.collection('messages').findOne({ conversationId, messageId });
      if (!message) {
        throw new Error('Missing seeded review message');
      }
      await db.collection('steel_review_outputs').insertOne({
        userId: message.user,
        conversationId,
        messageId,
        kind: 'ocr_result',
        tableId: 'ocr_result:1',
        outputId: 'review-registered-output',
        revision: 'review-registered-revision',
        state: 'current',
        latestOutputId: 'review-registered-output',
        headers: ['來源', '零件編號', '長度', '數量', '頁碼'],
        rows: [{
          rowId: 'registered-row',
          source: null,
          values: {
            '來源': { baseline: 'A', effective: 'A' },
            '零件編號': { baseline: 'REVIEW-P1', effective: 'REVIEW-P1' },
            '長度': { baseline: '1000', effective: '1000' },
            '數量': { baseline: '2', effective: '2' },
            '頁碼': { baseline: '1', effective: '1' },
          },
        }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(result.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('foreign and missing mapped files leave rows unlocated without exposing source metadata', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      await db.collection('files').updateOne({ conversationId, file_id: 'review-alpha' }, {
        $set: { user: new ObjectId(), filename: 'PRIVATE-FOREIGN.pdf' },
      });
      await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, {
        $set: { sourceMappings: [{ fileId: 'review-alpha', sourceCode: 'A', sourceFilename: 'PRIVATE-FOREIGN.pdf' }] },
      });
    });
    const before = await persistedSnapshot(conversationId);
    const foreign = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(foreign.status()).toBe(200);
    const foreignBody = await foreign.json();
    expect(foreignBody).toMatchObject({ table: { rows: [{ source: null }, { source: null }] } });
    expect(JSON.stringify(foreignBody)).not.toContain('PRIVATE-FOREIGN');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await withMongo(async (db) => {
      await db.collection('files').deleteOne({ conversationId, file_id: 'review-alpha' });
    });
    const missing = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(missing.status()).toBe(200);
    expect(await missing.json()).toMatchObject({ table: { rows: [{ source: null }, { source: null }] } });
  });

  test('an attachment cannot certify an explicit other-chat file or choose between duplicate file records', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: randomUUID(),
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: 'Review uploaded source',
      isCreatedByUser: true,
      sender: 'User',
      files: [{ file_id: 'review-alpha' }],
    }]);
    try {
      await withMongo(async (db) => {
        await db.collection('files').updateOne({ conversationId, file_id: 'review-alpha' }, {
          $set: { conversationId: randomUUID(), filename: 'PRIVATE-OTHER-CHAT.pdf' },
        });
      });
      const foreign = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(foreign.status()).toBe(200);
      const foreignData = await foreign.json();
      expect(foreignData).toMatchObject({ table: { rows: [{ source: null }, { source: null }] } });
      expect(JSON.stringify(foreignData)).not.toContain('PRIVATE-OTHER-CHAT');
      await withMongo(async (db) => {
        await db.collection('files').updateOne({ file_id: 'review-alpha' }, { $set: { conversationId } });
        const original = await db.collection('files').findOne({ conversationId, file_id: 'review-alpha' });
        if (!original) throw new Error('Missing owned fixture file');
        await db.collection('files').insertOne({ ...original, _id: new ObjectId(), filename: 'PRIVATE-DUPLICATE.pdf' });
      });
      const duplicate = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(duplicate.status()).toBe(200);
      expect(await duplicate.json()).toMatchObject({ table: { rows: [{ source: null }, { source: null }] } });
    } finally {
      await withMongo(async (db) => {
        await db.collection('files').updateMany({ file_id: 'review-alpha' }, { $set: { conversationId } });
      });
    }
  });

  test('legacy OCR identity shared by another tenant does not expose unscoped current state', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      const own = await db.collection('conversations').findOne({ conversationId });
      if (!own) {
        throw new Error('Missing owned fixture conversation');
      }
      await db.collection('conversations').insertOne({ ...own, _id: new ObjectId(), tenantId: 'review-other-tenant' });
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(result.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('ordinary tables after other heading levels do not inherit an OCR section identity', async ({ page }) => {
    for (const heading of ['# unrelated', '### unrelated']) {
      const markdown = `${ocr}\n\n${heading}\n${ocr.split('\n').slice(1).join('\n').replaceAll('REVIEW-P', 'UNMANAGED-P')}`;
      const { conversationId, messageId } = await seedCurrent(markdown);
      conversations.push(conversationId);
      await withMongo(async (db) => {
        await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, {
          $set: { currentOcrResultMarkdown: markdown },
        });
      });
      const before = await persistedSnapshot(conversationId);
      const result = await page.request.get(readUrl(conversationId, messageId, heading.replaceAll('#', '').trim()), { headers });
      expect(result.status()).toBe(404);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('a historical sidecar updated later cannot mask the authoritative current output', async ({ page }) => {
    const { conversationId, messageId, snapshot } = await seedSavedReviewData(page, headers);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      const current = await db.collection('steel_review_outputs').findOne({ conversationId, messageId, title: 'ocr_result' });
      if (!current) throw new Error('Missing current-protocol saved owner');
      await db.collection('steel_review_outputs').insertOne({ ...current, _id: new ObjectId(),
        outputId: 'ocr_result:historical-generation', revision: 'historical-sidecar', state: 'historical',
        rows: current.rows.map((row: SteelReviewTable['rows'][number], index: number) => ({ ...row,
          rowId: createHash('sha256').update(`ocr_result:historical-generation:${index}:${JSON.stringify(current.headers.map((header: string) => row.values[header].baseline ?? ''))}`).digest('hex'),
        })),
        updatedAt: new Date(Date.now() + 60_000), receipts: [],
      });
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId), { headers });
    expect(result.status()).toBe(200);
    expect(await result.json()).toMatchObject({ table: {
      title: 'ocr_result', outputId: 'ocr_result:review-proof-generation',
      revision: snapshot.revision, isLatest: true, readOnly: false,
    } });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('identical duplicate tables are ambiguous and get no managed target', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(`${ocr}\n\n${ocr}`);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    for (const title of ['ocr_result']) {
      const result = await page.request.get(readUrl(conversationId, messageId, title), { headers });
      expect(result.status()).toBe(404);
    }
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });
  test('real multi-PDF/image preview filters independent page rows and never writes the chat', async ({ page }) => {
    const markdown = [
      'PREVIEW-KEEP-PREFIX',
      '## source_file_mapping',
      '| 來源 | 檔名 |',
      '| --- | --- |',
      '| F1 | alpha.pdf |',
      '| F2 | beta.pdf |',
      '| F3 | gamma.png |',
      '| F4 | delta.heic |',
      '## ocr_result',
      '| 來源 | 頁碼 | 類別 | 零件編號 | 品名規格 | 厚度 | 長度 | 寬度 | 數量 | 加工 | 備註 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| F1 | 1 | 鐵板 | ALPHA-ONE-A | 鋼板 6x1000x1000 | 6 | 1000 | 1000 | 2 |  |  |',
      '| F1 | 1 | 鐵板 | ALPHA-ONE-B | 鋼板 6x1000x1000 | 6 | 1000 | 1000 | 2 |  |  |',
      '| F1 | 2 | 鐵板 | ALPHA-TWO | 鋼板 6x1000x2000 | 6 | 2000 | 1000 | 3 |  |  |',
      '| F2 | 2 | 鐵板 | BETA-TWO | 鋼板 6x1000x2000 | 6 | 2000 | 1000 | 3 |  |  |',
      '| F2 | 1 | 鐵板 | BETA-ONE | 鋼板 6x1000x2000 | 6 | 2000 | 1000 | 3 |  |  |',
      '| F3 | 1 | 鐵板 | GAMMA-ONE | 鋼板 6x1000x3000 | 6 | 3000 | 1000 | 4 |  |  |',
      '| F4 | 1 | 鐵板 | UNPREVIEWABLE-SOURCE | 鋼板 6x1000x3000 | 6 | 3000 | 1000 | 4 |  |  |',
      '| F1 | 99 | 鐵板 | OUT-OF-RANGE-PAGE | 鋼板 6x1000x3000 | 6 | 3000 | 1000 | 4 |  |  |',
      '|  |  | 鐵板 | UNLOCATED-PREVIEW | 鋼板 6x1000x4000 | 6 | 4000 | 1000 | 5 |  |  |',
      'PREVIEW-KEEP-SUFFIX',
    ].join('\n');
    const { conversationId, messageId } = await seedCurrentPublished(markdown, [
      { fileId: 'review-alpha', filename: 'alpha.pdf', type: 'application/pdf' },
      { fileId: 'review-beta', filename: 'beta.pdf', type: 'application/pdf' },
      { fileId: 'review-gamma', filename: 'gamma.png', type: 'image/png' },
      { fileId: 'review-unpreviewable', filename: 'delta.heic', type: 'image/heic' },
    ]);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      const alpha = await db.collection('files').findOne({ conversationId, file_id: 'review-alpha' });
      if (!alpha) throw new Error('Missing fixture file');
      await db.collection('files').insertOne({ ...alpha, _id: new ObjectId(), file_id: 'review-foreign-tenant', filename: 'foreign-tenant.pdf', tenantId: 'different-tenant' });
    });
    const before = await persistedSnapshot(conversationId);
    const sourcesUrl = `/api/steel/conversations/${conversationId}/review/ocr_result/sources?${new URLSearchParams({ messageId, title: 'ocr_result' })}`;
    const sources = await page.request.get(sourcesUrl, { headers });
    expect(sources.status()).toBe(200);
    expect(await sources.json()).toMatchObject({ sources: [
      { fileId: 'review-alpha' }, { fileId: 'review-beta' }, { fileId: 'review-gamma' },
    ] });
    const foreign = await page.request.get(`${sourcesUrl.split('?')[0]}/review-foreign-tenant?${new URLSearchParams({ messageId })}`, { headers });
    expect(foreign.status()).toBe(404);
    const missingOwnerQuery = new URLSearchParams({ messageId: 'missing-review-owner', title: 'ocr_result' });
    const missingOwnerList = await page.request.get(`${sourcesUrl.split('?')[0]}?${missingOwnerQuery}`, { headers });
    expect(missingOwnerList.status()).toBe(200);
    expect(await missingOwnerList.json()).toEqual({ sources: [] });
    const missingOwnerBinary = await page.request.get(`${sourcesUrl.split('?')[0]}/review-alpha?${missingOwnerQuery}`, { headers });
    expect(missingOwnerBinary.status()).toBe(404);
    const binary = await page.request.get(`${sourcesUrl.split('?')[0]}/review-alpha?${new URLSearchParams({ messageId })}`, { headers });
    expect(binary.status()).toBe(200);
    expect((await binary.body()).subarray(0, 5).toString()).toBe('%PDF-');
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const tableHeaders = await dialog.locator('thead tr th').allTextContents();
    expect(tableHeaders.slice(1)).toEqual(['來源', '頁碼', '類別', '零件編號', '品名規格', '厚度', '長度', '寬度', '數量', '加工', '備註']);
    const heading = page.locator('h2[data-markdown-title]').filter({ hasText: 'ocr_result' });
    await expect(heading).toContainText('Latest version');
    const canvas = dialog.locator('canvas');
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    const checksum = () => canvas.evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext('2d');
      if (!context || element.width === 0 || element.height === 0) return '';
      const data = context.getImageData(0, 0, element.width, element.height).data;
      let value = 0;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && data[i] < 200) ink += 1;
        value = (value * 31 + data[i]) >>> 0;
      }
      return ink > 500 ? `${element.width}:${element.height}:${value}` : '';
    });
    await expect.poll(checksum).not.toBe('');
    const firstPage = await checksum();
    await expect(reviewValue(dialog, 'ALPHA-ONE-A')).toBeVisible();
    await expect(reviewValue(dialog, 'ALPHA-ONE-B')).toBeVisible();
    await expect(reviewValue(dialog, 'ALPHA-TWO')).toHaveCount(0);
    await expect(reviewValue(dialog, 'UNPREVIEWABLE-SOURCE')).toHaveCount(0);
    await expect(reviewValue(dialog, 'OUT-OF-RANGE-PAGE')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(reviewValue(dialog, 'ALPHA-TWO')).toBeVisible();
    await expect(reviewValue(dialog, 'ALPHA-ONE-A')).toHaveCount(0);
    await expect.poll(checksum).not.toBe('');
    await expect.poll(checksum).not.toBe(firstPage);
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(reviewValue(dialog, 'BETA-TWO')).toBeVisible();
    await dialog.getByRole('button', { name: 'Previous page', exact: true }).click();
    await expect(reviewValue(dialog, 'BETA-ONE')).toBeVisible();
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(canvas).toHaveCSS('transform', /1\.25/);
    const canvasBounds = await canvas.boundingBox();
    if (!canvasBounds) throw new Error('Missing rendered PDF canvas');
    const panStart = { x: canvasBounds.x + canvasBounds.width / 2, y: canvasBounds.y + canvasBounds.height / 2 };
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panStart.x + 30, panStart.y + 20);
    await page.mouse.up();
    await expect(canvas).toHaveCSS('transform', /30, 20\)$/);
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'gamma.png', exact: true }).click();
    const image = dialog.getByRole('img', { name: 'Source page preview', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(800);
    await expect(reviewValue(dialog, 'GAMMA-ONE')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await expect(reviewValue(dialog, 'ALPHA-ONE-A')).toBeVisible();
    if (process.env.STEEL_REVIEW_UI_SCREENSHOT) {
      await page.setViewportSize({ width: 1660, height: 1000 });
      await page.screenshot({
        path: process.env.STEEL_REVIEW_UI_SCREENSHOT.replace(/(\.[^.]+)?$/u, '-ocr$1'),
        fullPage: false,
        animations: 'disabled',
      });
    }
    await dialog.getByRole('checkbox', { name: 'View unlinked', exact: true }).check();
    await expect(reviewValue(dialog, 'UNLOCATED-PREVIEW')).toBeVisible();
    const existingRowIds = new Set(await dialog.locator('tbody tr[data-row-id]').evaluateAll((rows) => rows
      .map((entry) => entry.getAttribute('data-row-id'))
      .filter((rowId): rowId is string => Boolean(rowId))));
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    await expect.poll(async () => (await dialog.locator('tbody tr[data-row-id]').evaluateAll((rows) => rows
      .map((entry) => entry.getAttribute('data-row-id'))
      .filter((rowId): rowId is string => Boolean(rowId)))).find((rowId) => !existingRowIds.has(rowId)) ?? '')
      .not.toBe('');
    const addedRowId = (await dialog.locator('tbody tr[data-row-id]').evaluateAll((rows) => rows
      .map((entry) => entry.getAttribute('data-row-id'))
      .filter((rowId): rowId is string => Boolean(rowId)))).find((rowId) => !existingRowIds.has(rowId));
    if (!addedRowId) throw new Error('Missing OCR Add row row identity');
    const addedRow = dialog.locator(`tr[data-row-id="${addedRowId}"]`);
    await addedRow.getByRole('combobox', { name: `類別 ${addedRowId}`, exact: true }).click();
    await page.getByRole('option', { name: 'H型鋼', exact: true }).click();
    await addedRow.getByRole('button', { name: `Link ${addedRowId}`, exact: true }).click();
    const bindDialog = page.getByRole('dialog', { name: 'Link source', exact: true });
    await expect(bindDialog).toBeVisible();
    await bindDialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await bindDialog.getByRole('combobox', { name: /page/iu }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await bindDialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(addedRow.getByRole('button', { name: `Linked ${addedRowId}`, exact: true })).toBeVisible();
    await addedRow.getByRole('button', { name: `Delete row ${addedRowId}`, exact: true }).click();
    await expect(addedRow).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'View unlinked', exact: true }).uncheck();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(page.getByRole('option', { name: 'alpha.pdf', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });


  test('source identity collisions fail closed even when one duplicate is not previewable', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      const file = await db.collection('files').findOne({ conversationId });
      if (!file) throw new Error('Missing fixture file');
      await db.collection('files').insertOne({ ...file, _id: new ObjectId(), filename: 'collision.txt', type: 'text/plain' });
    });
    const before = await persistedSnapshot(conversationId);
    const root = `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
    const query = new URLSearchParams({ messageId, title: 'ocr_result' });
    const list = await page.request.get(`${root}?${query}`, { headers });
    expect(list.status()).toBe(200);
    expect(await list.json()).toEqual({ sources: [] });
    const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
    expect(binary.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a source-list network failure keeps rows and exposes retry to the real backend', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const isSourceList = (url: URL) => url.pathname === `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
    let releaseRequest = () => {};
    const pending = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await page.route(isSourceList, async (route) => {
      await pending;
      await route.abort('internetdisconnected');
    });
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await expect(dialog.getByText(/loading.*(source|files)/i)).toBeVisible();
    releaseRequest();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(reviewValue(dialog, 'REVIEW-P2')).toBeVisible();
    await page.unroute(isSourceList);
    await dialog.getByRole('button', { name: /retry/i }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => dialog.locator('canvas').evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('legacy source identity cannot reuse a same-user file ID claimed by another chat', async ({ page }) => {
    const current = await seedCurrent(ocr);
    const other = await seedCurrent(ocr);
    conversations.push(current.conversationId, other.conversationId);
    await withMongo(async (db) => {
      await db.collection('files').updateOne({ conversationId: current.conversationId }, {
        $unset: { conversationId: '' },
      });
    });
    try {
      const before = await persistedSnapshot(current.conversationId);
      const otherBefore = await persistedSnapshot(other.conversationId);
      const review = await page.request.get(readUrl(current.conversationId, current.messageId, 'ocr_result'), { headers });
      expect(review.status()).toBe(200);
      expect(await review.json()).toMatchObject({ table: {
        rows: [{ source: null }, { source: null }],
      } });
      const root = `/api/steel/conversations/${current.conversationId}/review/ocr_result/sources`;
      const query = new URLSearchParams({ messageId: current.messageId, title: 'ocr_result' });
      const list = await page.request.get(`${root}?${query}`, { headers });
      expect(list.status()).toBe(200);
      expect(await list.json()).toEqual({ sources: [] });
      const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
      expect(binary.status()).toBe(404);
      expect(await persistedSnapshot(current.conversationId)).toEqual(before);
      expect(await persistedSnapshot(other.conversationId)).toEqual(otherBefore);
    } finally {
      await withMongo(async (db) => {
        await db.collection('files').updateOne({ messageId: current.messageId }, {
          $set: { conversationId: current.conversationId },
        });
      });
    }
  });

  test('legacy source attachment provenance shared with another chat stays unlocated and unreadable', async ({ page }) => {
    const current = await seedCurrent(ocr);
    const otherConversationId = randomUUID();
    conversations.push(current.conversationId, otherConversationId);
    await seedConversations(getE2EUser().email, [{ conversationId: otherConversationId, title: 'Competing legacy attachment' }]);
    await seedMessages(getE2EUser().email, otherConversationId, [{
      messageId: randomUUID(),
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: 'Earlier upload claim',
      isCreatedByUser: true,
      sender: 'User',
      files: [{ file_id: 'review-alpha' }],
    }]);
    await withMongo(async (db) => {
      await db.collection('files').updateOne({ conversationId: current.conversationId }, {
        $unset: { conversationId: '' },
      });
    });
    try {
      const before = await persistedSnapshot(current.conversationId);
      const otherBefore = await persistedSnapshot(otherConversationId);
      const review = await page.request.get(readUrl(current.conversationId, current.messageId, 'ocr_result'), { headers });
      expect(review.status()).toBe(200);
      expect(await review.json()).toMatchObject({ table: {
        rows: [{ source: null }, { source: null }],
      } });
      const root = `/api/steel/conversations/${current.conversationId}/review/ocr_result/sources`;
      const query = new URLSearchParams({ messageId: current.messageId, title: 'ocr_result' });
      const list = await page.request.get(`${root}?${query}`, { headers });
      expect(list.status()).toBe(200);
      expect(await list.json()).toEqual({ sources: [] });
      const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
      expect(binary.status()).toBe(404);
      await page.goto(`/c/${current.conversationId}`);
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Steel source review' });
      await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
      await expect(reviewValue(dialog, 'REVIEW-P2')).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: 'Source file', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      expect(await persistedSnapshot(current.conversationId)).toEqual(before);
      expect(await persistedSnapshot(otherConversationId)).toEqual(otherBefore);
    } finally {
      await withMongo(async (db) => {
        await db.collection('files').updateOne({ messageId: current.messageId }, {
          $set: { conversationId: current.conversationId },
        });
      });
    }
  });

  test('an expired clicked message is rejected with or without source mappings', async ({ page }) => {
    for (const withSource of [false, true]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      await withMongo(async (db) => {
        await db.collection('messages').updateOne({ conversationId, messageId }, {
          $set: { expiredAt: new Date(Date.now() - 60_000) },
        });
        if (!withSource) {
          await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, {
            $set: { sourceMappings: [] },
          });
        }
      });
      const before = await persistedSnapshot(conversationId);
      const review = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(review.status()).toBe(404);
      const root = `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
      const query = new URLSearchParams({ messageId, title: 'ocr_result' });
      const list = await page.request.get(`${root}?${query}`, { headers });
      expect(list.status()).toBe(200);
      expect(await list.json()).toEqual({ sources: [] });
      const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
      expect(binary.status()).toBe(404);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });


  test('an unavailable source stays unlocated without blocking a later business-cell Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    for (const quantity of ['7', '8']) {
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      if (quantity === '8') expect(table.rows[0].source).toBeNull();
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      expect(prepare.status()).toBe(200);
      const save = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
      expect(save.status()).toBe(200);
      if (quantity === '7') {
        await withMongo(async (db) => {
          await db.collection('files').updateOne({ conversationId, file_id: 'review-alpha' }, {
            $set: { expiredAt: new Date(Date.now() - 60_000) },
          });
        });
      }
    }
    const after = await persistedSnapshot(conversationId);
    expect(after.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toMatchObject({ table: {
      rows: [{ source: null, values: { 數量: { baseline: '2', effective: '8' } } }, { source: null }],
    } });
  });

  test('clearing an OCR cell keeps its AI baseline and clean reload does not resurrect the old value', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['長度'].effective = null;
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(prepare.status()).toBe(200);
    const saved = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
    expect(saved.status()).toBe(200);
    const snapshot = await persistedSnapshot(conversationId);
    expect(snapshot.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 |  | 2 | 1 |'));
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(reloaded.status()).toBe(200);
    const current = await reloaded.json() as { table: SteelReviewTable };
    expect(current.table.rows[0].values['長度']).toEqual({ baseline: '1000', effective: '' });
    const noChange = await page.request.post(`${url}/prepare`, { headers, data: { ...requestForRows(current.table), operations: [{ type: 'update', rowId: current.table.rows[0].rowId,
      changes: [{ header: '長度', value: null }] }] } });
    expect(noChange.status()).toBe(200);
    const noOp = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await noChange.json()) });
    expect(noOp.status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(snapshot);
  });

  for (const proof of ['matching_receipt', 'missing_receipt', 'mismatched_receipt', 'mismatched_hash', 'mismatched_digest'] as const) {
    test(`a pre-selector saved source stays reliable only with matching immutable proof: ${proof}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const saveQuantity = async (table: SteelReviewTable, quantity: string) => {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = quantity;
        const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
        expect(prepare.status()).toBe(200);
        const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
        expect(commit.status()).toBe(200);
      };
      const initial = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(initial.status()).toBe(200);
      await saveQuantity((await initial.json() as { table: SteelReviewTable }).table, '7');
      await withMongo(async (db) => {
        const filter = { conversationId, messageId, kind: 'ocr_result' };
        const legacy = await db.collection('steel_review_outputs').updateOne(filter, { $unset: {
          sourceMappings: '',
          'receipts.$[].snapshot.sourceMappings': '',
        } });
        expect(legacy.matchedCount).toBe(1);
        if (proof === 'missing_receipt') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: { receipts: [] } });
        }
        if (proof === 'mismatched_receipt') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.rows.0.values.數量.effective': '999',
          } });
        }
        if (proof === 'mismatched_hash') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.messageSha256': '0'.repeat(64),
          } });
        }
        if (proof === 'mismatched_digest') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.digest': '0'.repeat(64),
          } });
        }
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      expect(table.rows.map((row) => row.source)).toEqual(proof === 'matching_receipt'
        ? before.reviews[0].rows.map((row: SteelReviewTable['rows'][number]) => row.source)
        : [null, null]);
      expect(table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '7' });
      expect(table.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      await saveQuantity(table, '8');
      const after = await persistedSnapshot(conversationId);
      expect(after.messages.find((message) => message.messageId === messageId)?.text)
        .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
      expectPreservedAiState(before.ocr, after.ocr);
      expect(after.reviews[0].receipts.slice(0, before.reviews[0].receipts.length))
        .toEqual(before.reviews[0].receipts);
      const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({ table: {
        rows: [{ values: { 數量: { baseline: '2', effective: '8' } } }, {}],
      } });
    });
  }

  for (const proof of ['matching_receipt', 'mismatched_hash', 'mismatched_digest'] as const) {
    test(`a second-part legacy source requires exact full-message immutable proof: ${proof}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const prefix = 'LEGACY-PART-PREFIX';
      const suffix = 'LEGACY-PART-SUFFIX';
      await withMongo(async (db) => {
        await db.collection('messages').updateOne({ conversationId, messageId }, { $set: {
          text: `${prefix} ${ocr} ${suffix}`,
          content: [{ type: 'text', text: prefix }, { type: 'text', text: ocr }, { type: 'text', text: suffix }],
        } });
      });
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const saveQuantity = async (table: SteelReviewTable, quantity: string) => {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = quantity;
        const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
        expect(prepare.status()).toBe(200);
        const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
        expect(commit.status()).toBe(200);
      };
      const initial = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(initial.status()).toBe(200);
      await saveQuantity((await initial.json() as { table: SteelReviewTable }).table, '7');
      await withMongo(async (db) => {
        const filter = { conversationId, messageId, kind: 'ocr_result' };
        const legacy = await db.collection('steel_review_outputs').updateOne(filter, { $unset: {
          sourceMappings: '',
          'receipts.$[].snapshot.sourceMappings': '',
        } });
        expect(legacy.matchedCount).toBe(1);
        if (proof === 'mismatched_hash') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.messageSha256': '0'.repeat(64),
          } });
        }
        if (proof === 'mismatched_digest') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.digest': '0'.repeat(64),
          } });
        }
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      expect(table.title).toBe('ocr_result');
      expect(table).not.toHaveProperty('partIndex');
      expect(table.rows.map((row) => row.source)).toEqual(proof === 'matching_receipt'
        ? before.reviews[0].rows.map((row: SteelReviewTable['rows'][number]) => row.source)
        : [null, null]);
      expect(table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '7' });
      expect(table.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      await saveQuantity(table, '8');
      const after = await persistedSnapshot(conversationId);
      expect(after.messages.find((message) => message.messageId === messageId)?.text)
        .toBe(`${prefix} ${ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |')} ${suffix}`);
      expect(after.messages.find((message) => message.messageId === messageId)?.content).toEqual([
        { type: 'text', text: prefix },
        { type: 'text', text: ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |') },
        { type: 'text', text: suffix },
      ]);
      expectPreservedAiState(before.ocr, after.ocr);
      expect(after.reviews[0].receipts.slice(0, before.reviews[0].receipts.length))
        .toEqual(before.reviews[0].receipts);
      const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({ table: {
        rows: [{ values: { 數量: { baseline: '2', effective: '8' } } }, {}],
      } });
    });
  }

  test('source and page cells cannot bypass the dedicated source association contract', async ({ page }) => {
    for (const [header, value] of [['來源', 'FORGED-SOURCE'], ['頁碼', '99']]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values[header].effective = value;
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      if (prepare.status() === 200) {
        const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
        expect([400, 409]).toContain(commit.status());
      }
      expect([400, 409]).toContain(prepare.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('the backend saves only its exact message target and rejects a second stale prepared operation', async ({ page }) => {
    const markdown = `CAS-PREFIX\n\n${ocr}\n\n## Other data\n| Name | Value |\n| --- | --- |\n| KEEP | 42 |\n\nCAS-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const previousMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: previousMessageId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: ocr.replace('REVIEW-P1', 'OTHER-MESSAGE-KEEP'),
      content: [{ type: 'text', text: ocr.replace('REVIEW-P1', 'OTHER-MESSAGE-KEEP') }],
      isCreatedByUser: false, sender: 'Assistant',
    }]);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, { $set: {
        text: `${markdown} CAS-SECOND-PART`,
        content: [{ type: 'text', text: markdown }, { type: 'text', text: 'CAS-SECOND-PART' }],
        'metadata.steelReview.system_order': {
          version: 1, kind: 'system_order', conversationId, messageId,
          tableId: 'system_order:unrelated', outputId: 'system_order:previous-run',
          revision: 'UNRELATED-STATUS-KEEP', updatedAt: new Date(Date.now() - 60_000),
        },
      } });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const operations: SteelReviewOperationPrepared[] = [];
    for (const quantity of ['7', '8']) {
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepared = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      expect(prepared.status()).toBe(200);
      operations.push(await prepared.json() as SteelReviewOperationPrepared);
    }
    const saved = await page.request.post(`${url}/commit`, { headers, data: operationCommit(operations[0]) });
    expect(saved.status()).toBe(200);
    const savedBody = await saved.json();
    const after = await persistedSnapshot(conversationId);
    const expected = markdown.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |');
    const message = after.messages.find((candidate) => candidate.messageId === messageId);
    expect(message?.text).toBe(`${expected} CAS-SECOND-PART`);
    expect(message?.content).toEqual([{ type: 'text', text: expected }, { type: 'text', text: 'CAS-SECOND-PART' }]);
    expect(savedBody.savedSnapshot).toMatchObject({
      conversationId, messageId, messageText: `${expected} CAS-SECOND-PART`,
      messageSha256: createHash('sha256').update(`${expected} CAS-SECOND-PART`).digest('hex'),
      messageTextParts: [{ partIndex: 0, text: expected }, { partIndex: 1, text: 'CAS-SECOND-PART' }],
      ownerUpdated: { version: 1, kind: 'ocr_result', conversationId, messageId,
        title: table.title, outputId: table.outputId, revision: savedBody.revision },
    });
    expect(message?.metadata?.steel).toEqual(before.messages.find((candidate) => candidate.messageId === messageId)?.metadata?.steel);
    expect(message?.metadata?.steelReview?.system_order).toEqual(before.messages.find((candidate) => candidate.messageId === messageId)?.metadata?.steelReview?.system_order);
    expect(message?.metadata?.steelReview?.ocr_result).toMatchObject({
      kind: 'ocr_result', conversationId, messageId, title: table.title,
      outputId: table.outputId, revision: savedBody.revision,
    });

    expect(after.messages.find((candidate) => candidate.messageId === previousMessageId))
      .toEqual(before.messages.find((candidate) => candidate.messageId === previousMessageId));
    const review = after.reviews[0];
    expect(review?.aiRawMarkdown).toBe(ocr);
    expect(review?.aiBaselineMarkdown).toBe(ocr);
    expect(review?.humanMarkdown).toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'));
    expect(review?.effectiveMarkdown).toBe(review?.humanMarkdown);
    // A human Save must not replace the latest AI input or advance its timestamp.
    expectPreservedAiState(before.ocr, after.ocr);
    expect(review?.aiUpdatedAt).toEqual(before.ocr?.updatedAt);
    expect(review?.humanSavedAt.getTime()).toBeGreaterThan(before.ocr?.updatedAt.getTime());
    const stale = await page.request.post(`${url}/commit`, { headers, data: operationCommit(operations[1]) });
    expect(stale.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(after);
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toMatchObject({ table: {
      messageId, isLatest: true, readOnly: false,
      rows: [{ values: { 數量: { baseline: '2', effective: '7' } } }, { values: { 數量: { baseline: '3', effective: '3' } } }],
    } });
  });

  for (const collision of ['other_message', 'other_kind', 'two_other_owners'] as const) {
    test(`first OCR Save preserves unrelated review owners sharing its outputId: ${collision}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const foreignMessageIds = [randomUUID(), randomUUID()];
      await seedMessages(getE2EUser().email, conversationId, foreignMessageIds.map((id) => ({
        messageId: id,
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        text: `UNRELATED-OWNER-PREFIX ${id}\n${ocr}\nUNRELATED-OWNER-SUFFIX`,
        isCreatedByUser: false,
        sender: 'Assistant',
      })));
      await withMongo(async (db) => {
        const owner = await db.collection('messages').findOne({ conversationId, messageId });
        if (!owner) throw new Error('Missing current owner');
        const scopes = collision === 'two_other_owners'
          ? foreignMessageIds.map((id) => ({ messageId: id, kind: 'ocr_result', title: 'ocr_result' }))
          : [{
            messageId: collision === 'other_message' ? foreignMessageIds[0] : messageId,
            kind: collision === 'other_kind' ? 'system_order' : 'ocr_result', title: 'ocr_result',
          }];
        await db.collection('steel_review_outputs').insertMany(scopes.map((scope) => ({
          userId: owner.user,
          ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
          conversationId,
          ...scope,
          outputId: table.outputId,
          revision: table.revision,
          state: 'current',
          headers: table.headers,
          rows: table.rows,
          aiRawMarkdown: ocr,
          aiBaselineMarkdown: ocr,
          effectiveMarkdown: ocr,
          receipts: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        })));
      });
      const before = await persistedSnapshot(conversationId);
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '7';
      const preparedResponse = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
        headers, data: requestForRows(table, rows),
      });
      expect(preparedResponse.status()).toBe(200);
      const prepared = await preparedResponse.json() as SteelReviewOperationPrepared;
      const committed = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/commit`, {
        headers, data: operationCommit(prepared),
      });
      expect(committed.status()).toBe(200);
      const after = await persistedSnapshot(conversationId);
      expect(after.reviews).toHaveLength(before.reviews.length + 1);
      for (const original of before.reviews) {
        expect(after.reviews.find((row) => row._id.equals(original._id))).toEqual(original);
      }
      const saved = after.reviews.find((row) => row.messageId === messageId && row.kind === 'ocr_result' && row.title === table.title);
      expect(saved).toMatchObject({ kind: 'ocr_result', outputId: table.outputId, rows });
      for (const original of before.messages.filter((message) => message.messageId !== messageId)) {
        expect(after.messages.find((message) => message.messageId === original.messageId)).toEqual(original);
      }
      expect(after.messages.find((message) => message.messageId === messageId)?.text)
        .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'));
      expectPreservedAiState(before.ocr, after.ocr);
      const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({ table: { messageId, title: table.title, rows } });
    });
  }

  test('committed receipt replay rejects client replacement projections', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    const prepare = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
      headers, data: requestForRows(table, rows),
    });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewOperationPrepared;
    const commitUrl = `/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    expect((await page.request.post(commitUrl, { headers, data: operationCommit(prepared) })).status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const replay = await page.request.post(commitUrl, {
      headers,
      data: { ...operationCommit(prepared), cleanReplacementText: 'UNSIGNED-CLEAN-TEXT' },
    });
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  for (const stage of ['first_save', 'saved_output'] as const) {
    for (const boundary of ['prepare', 'commit'] as const) {
      test(`located source metadata cannot be erased through ${boundary}: ${stage}`, async ({ page }) => {
        const { conversationId, messageId } = await seedCurrent(ocr);
        conversations.push(conversationId);
        const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
        expect(read.status()).toBe(200);
        let { table } = await read.json() as { table: SteelReviewTable };
        const reviewUrl = `/api/steel/conversations/${conversationId}/review/ocr_result`;
        if (stage === 'saved_output') {
          const initialRows = structuredClone(table.rows);
          initialRows[0].values['數量'].effective = '4';
          const initialPrepare = await page.request.post(`${reviewUrl}/prepare`, {
            headers, data: requestForRows(table, initialRows),
          });
          expect(initialPrepare.status()).toBe(200);
          expect((await page.request.post(`${reviewUrl}/commit`, {
            headers, data: operationCommit(await initialPrepare.json()),
          })).status()).toBe(200);
          const savedRead = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
          expect(savedRead.status()).toBe(200);
          ({ table } = await savedRead.json() as { table: SteelReviewTable });
        }
        expect(table.rows[0].source).toMatchObject({ fileId: 'review-alpha', pageNumber: 1 });
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = '7';
        let payload: (SteelReviewOperationCommit | SteelReviewTable) & { rows: SteelReviewTable['rows'] };
        if (boundary === 'commit') {
          const validPrepare = await page.request.post(`${reviewUrl}/prepare`, {
            headers, data: requestForRows(table, rows),
          });
          expect(validPrepare.status()).toBe(200);
          const prepared = await validPrepare.json() as SteelReviewOperationPrepared;
          rows[0].source = null;
          payload = { ...operationCommit(prepared), rows };
        } else {
          rows[0].source = null;
          payload = { ...table, rows };
        }
        const before = await persistedSnapshot(conversationId);
        const rejected = await page.request.post(`${reviewUrl}/${boundary}`, { headers, data: payload });
        expect(rejected.status()).toBe(400);
        expect(await rejected.json()).toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
        expect(await persistedSnapshot(conversationId)).toEqual(before);
      });
    }
  }

  test('an unlocated row uses existing source menus as a local draft then dirty-close Save updates the scoped chat', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: { sourceMappings: [] } });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows[0].source).toBeNull();
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="REVIEW-P1"]') });
    await dialog.getByRole('checkbox', { name: 'View unlinked', exact: true }).check();
    await expect(row).toBeVisible();
    await bindSource(page, row, table.rows[0].rowId, 'alpha.pdf', '2');
    await dialog.getByRole('checkbox', { name: 'View unlinked', exact: true }).uncheck();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(row.getByRole('button', { name: `Linked ${table.rows[0].rowId}`, exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.keyboard.press('Escape');
    const prepareRequest = page.waitForRequest((request) => request.method() === 'POST' &&
      request.url().endsWith(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`));
    const commitRequest = page.waitForRequest((request) => request.method() === 'POST' &&
      request.url().endsWith(`/api/steel/conversations/${conversationId}/review/ocr_result/commit`));
    await page.getByRole('button', { name: 'Save updates', exact: true }).click();
    const prepareBody = (await prepareRequest).postDataJSON() as SteelReviewOperationPrepare;
    const commitBody = (await commitRequest).postDataJSON() as SteelReviewOperationCommit;
    expect(prepareBody.operations).toEqual([{ type: 'update', rowId: table.rows[0].rowId,
      source: { fileId: 'review-alpha', pageNumber: 2 } }]);
    expect(commitBody.operations).toEqual(prepareBody.operations);
    for (const body of [prepareBody, commitBody]) {
      expect(body).not.toHaveProperty('rows');
      expect(body).not.toHaveProperty('aiRawMarkdown');
      expect(body).not.toHaveProperty('aiBaselineMarkdown');
    }
    await expect(dialog).not.toBeVisible();
    const after = await persistedSnapshot(conversationId);
    const updated = after.reviews[0]?.rows[0];
    expect(updated).toMatchObject({ rowId: table.rows[0].rowId,
      source: { fileId: 'review-alpha', pageNumber: 2, filename: 'alpha.pdf' },
      values: { 頁碼: { baseline: '1', effective: '2' }, 數量: { baseline: '2', effective: '2' } } });
    expect(updated.values['來源'].effective).toMatch(/^F\d+$/u);
    const clean = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', `| ${updated.values['來源'].effective} | REVIEW-P1 | 1000 | 2 | 2 |`);
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(clean);
    expect(after.messages.find((message) => message.messageId === messageId)?.content)
      .toEqual([{ type: 'text', text: clean }]);
    expectPreservedAiState(before.ocr, after.ocr);
    await expect(page.locator('del')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('a source file and page binding remains a local draft until explicit Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="REVIEW-P1"]') });
    await expect(row).toBeVisible();
    await bindSource(page, row, table.rows[0].rowId, 'beta.pdf', '2');
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows[0].source).toMatchObject({ fileId: 'review-beta', pageNumber: 2 });
    expect(saved.reviews[0]?.rows[0].values['頁碼'].effective).toBe('2');
    expect(saved.reviews[0]?.rows[1]).toEqual({ ...table.rows[1], origin: 'ai', deleted: false });
    expectPreservedAiState(before.ocr, saved.ocr);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

  test('OCR ledger authority rejects forged identities and anchors while independent manual rows save atomically', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const before = await persistedSnapshot(conversationId);
    const manualValues = new Map([['零件編號', 'API-MANUAL'], ['數量', '4']]);
    const makeManual = (ordinal: number) => ({
      rowId: randomUUID(), origin: 'manual' as const, deleted: false,
      insertion: { kind: 'end' as const, ordinal }, source: null,
      values: Object.fromEntries(table.headers.map((header) => [header, {
        baseline: null, effective: manualValues.get(header) ?? '',
      }])),
    });
    const update = { type: 'update', rowId: table.rows[0].rowId,
      changes: [{ header: '數量', value: '8' }] };
    const add = { type: 'add', rowId: randomUUID(), position: { kind: 'end' },
      changes: [{ header: '數量', value: '4' }] };
    const attacks = [
      { name: 'origin', operations: [{ ...update, origin: 'manual' }] },
      { name: 'baseline', operations: [{ ...update, baseline: null }] },
      { name: 'duplicate', operations: [update, update] },
      { name: 'unknown_row', operations: [{ ...update, rowId: randomUUID() }] },
      { name: 'existing_row_add', operations: [{ ...add, rowId: table.rows[0].rowId }] },
      { name: 'foreign_anchor', operations: [{ ...add, position: { kind: 'after', rowId: randomUUID() } }] },
      { name: 'ai_insertion', operations: [{ ...add, origin: 'ai' }] },
    ];
    for (const attack of attacks) {
      const refused = await page.request.post(`${url}/prepare`, { headers,
        data: { ...requestForRows(table), operations: attack.operations } });
      expect([400, 409], attack.name).toContain(refused.status());
      expect(await persistedSnapshot(conversationId), attack.name).toEqual(before);
    }
    const first = makeManual(0);
    const second = makeManual(1);
    const preparedResponse = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, [...table.rows, first, second]) });
    expect(preparedResponse.status()).toBe(200);
    const prepared = await preparedResponse.json() as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(2);
    expect(prepared.caption.changedRowIds).toEqual([first.rowId, second.rowId]);
    expect(prepared.rows.map((row) => row.rowId)).toEqual([...table.rows.map((row) => row.rowId), first.rowId, second.rowId]);
    const forged = { ...operationCommit(prepared), rows: structuredClone(prepared.rows) };
    Reflect.set(forged.rows[0], 'origin', 'manual');
    expect([400, 409]).toContain((await page.request.post(`${url}/commit`, { headers, data: forged })).status());
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const committed = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(committed.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows.slice(-2)).toMatchObject([
      { rowId: first.rowId, origin: 'manual', deleted: false, source: null },
      { rowId: second.rowId, origin: 'manual', deleted: false, source: null },
    ]);
    expect(saved.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr + '\n|  | API-MANUAL |  | 4 |  |\n|  | API-MANUAL |  | 4 |  |');
    expect(saved.reviews[0]?.receipts).toHaveLength(1);
    expectPreservedAiState(before.ocr, saved.ocr);
    expect((await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) })).status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
    const currentResponse = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(currentResponse.status()).toBe(200);
    const { table: current } = await currentResponse.json() as { table: SteelReviewTable };
    for (const attack of ['anchor', 'ordinal', 'placement_swap']) {
      const changes = [{ header: '數量', value: '5' }];
      const operations = attack === 'placement_swap'
        ? [{ type: 'add', rowId: first.rowId, position: { kind: 'after', rowId: second.rowId }, changes }]
        : [{ type: 'update', rowId: first.rowId, changes,
          ...(attack === 'anchor' ? { position: { kind: 'after', rowId: table.rows[0].rowId } }
            : { ordinal: 3 }) }];
      const refused = await page.request.post(`${url}/prepare`, { headers,
        data: { ...requestForRows(current), operations } });
      expect([400, 409], attack).toContain(refused.status());
      expect(await persistedSnapshot(conversationId), attack).toEqual(saved);
    }
  });

  test('a reliable saved source reuses its code and same-association intent is a no-op', async ({ page }) => {
    const { conversationId, messageId, snapshot } = await seedSavedReviewData(page, headers);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows).toEqual(snapshot.rows);
    expect(table.rows[0].source).toMatchObject({ fileId: 'review-alpha', pageNumber: 1 });
    const noop = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, undefined, [{ rowId: table.rows[0].rowId, fileId: 'review-alpha', pageNumber: 1 }]) });
    expect(noop.status()).toBe(200);
    const noopPrepared = await noop.json() as SteelReviewOperationPrepared;
    expect(noopPrepared.caption.changedRows).toBe(0);
    const noopCommit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(noopPrepared) });
    expect(noopCommit.status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const changed = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, undefined, [{ rowId: table.rows[0].rowId, fileId: 'review-alpha', pageNumber: 2 }]) });
    expect(changed.status()).toBe(200);
    const changedPrepared = await changed.json() as SteelReviewOperationPrepared;
    expect(changedPrepared.caption.changedRows).toBe(1);
    expect(changedPrepared.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
    expect(changedPrepared.rows[0].values['頁碼']).toEqual({ baseline: '1', effective: '2' });
    const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(changedPrepared) });
    expect(commit.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.receipts.slice(0, 1)).toEqual(before.reviews[0]?.receipts);
    expect(after.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(snapshot.messageText.replace('| A | REVIEW-P1 | 1000 | 7 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 2 |'));
    expectPreservedAiState(before.ocr, after.ocr);
  });

  test('returning a source draft to the saved file and page is a zero-write UI no-op', async ({ page }) => {
    const { conversationId, messageId } = await seedSavedReviewData(page, headers);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows[0].source).toMatchObject({ fileId: 'review-alpha', pageNumber: 1 });
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="REVIEW-P1"]') });
    await bindSource(page, row, table.rows[0].rowId, 'beta.pdf', '2');
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await expect(row).toBeVisible();
    await bindSource(page, row, table.rows[0].rowId, 'alpha.pdf', '1');
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
    await expect(row).toBeVisible();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard unsaved changes', exact: true })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  for (const [reservedCode, nextCode] of [['F7', 'F8'], ['F9007199254740993', 'F9007199254740994']]) {
    test(`unproven source ${reservedCode} remains reserved without becoming a file association`, async ({ page }) => {
      const markdown = ocr.replace('| A | REVIEW-P2', `| ${reservedCode} | REVIEW-P2`);
      const { conversationId, messageId } = await seedCurrent(markdown);
      conversations.push(conversationId);
      await seedSelectorFiles(conversationId);
      await withMongo(async (db) => {
        await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
          currentOcrResultMarkdown: markdown, sourceMappings: [],
        } });
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      expect(table.rows.map((row) => row.source)).toEqual([null, null]);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const response = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, undefined, [{ rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 1 }]) });
      expect(response.status()).toBe(200);
      const prepared = await response.json() as SteelReviewOperationPrepared;
      expect(prepared.rows[0].values['來源'].effective).toBe(nextCode);
      expect(prepared.rows[1]).toEqual({ ...table.rows[1], origin: 'ai', deleted: false });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
      expect(commit.status()).toBe(200);
      const after = await persistedSnapshot(conversationId);
      const reopen = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(reopen.status()).toBe(200);
      const reopened = await reopen.json() as { table: SteelReviewTable };
      expect(reopened.table.rows[0].source).toMatchObject({ fileId: 'review-beta', pageNumber: 1 });
      expect(reopened.table.rows[1]).toEqual({ ...table.rows[1], origin: 'ai', deleted: false });
      expect(reopened.table.rows[1].source).toBeNull();
      expectPreservedAiState(before.ocr, after.ocr);
      expect(await persistedSnapshot(conversationId)).toEqual(after);
    });
  }
  test('source operations reject caller media metadata instead of importing it into a saved row', async ({ page }) => {
    const { conversationId, messageId } = await seedSavedReviewData(page, headers);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const before = await persistedSnapshot(conversationId);
    const request = requestForRows(table);
    const response = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
      headers, data: { ...request, operations: [{ type: 'update', rowId: table.rows[0].rowId,
        source: { fileId: 'review-alpha', pageNumber: 2, filename: 'FORGED.png', mediaType: 'image/png' } }] },
    });
    expect(response.status()).toBe(400);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('new human source codes reserve unavailable owner AI codes without locating their old rows', async ({ page }) => {
    const markdown = ocr.replace('| A | REVIEW-P2', '| F7 | REVIEW-P2');
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    await withMongo(async (db) => {
      await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
        currentOcrResultMarkdown: markdown,
        sourceMappings: [{ fileId: 'review-alpha', sourceCode: 'A', sourceFilename: 'alpha.pdf' },
          { fileId: 'review-expired-selector', sourceCode: 'F7', sourceFilename: 'alpha.pdf' }],
      } });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows[1].source).toBeNull();
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, undefined, [{ rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 }]) });
    expect(response.status()).toBe(200);
    const prepared = await response.json() as SteelReviewOperationPrepared;
    expect(prepared.rows[0].values['來源'].effective).toBe('F8');
    expect(prepared.rows[1]).toEqual({ ...table.rows[1], origin: 'ai', deleted: false });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(commit.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: [{}, { source: null,
      values: { 來源: { effective: 'F7' } } }] } });
    expectPreservedAiState(before.ocr, after.ocr);
  });

  test('one image can bind two independent rows and reopening its preview does not write again', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, undefined, table.rows.map((row) => ({ rowId: row.rowId, fileId: 'review-gamma', pageNumber: 1 }))) });
    expect(response.status()).toBe(200);
    const prepared = await response.json() as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(2);
    expect(prepared.rows.map((row) => row.rowId)).toEqual(table.rows.map((row) => row.rowId));
    for (const row of prepared.rows) expect(row.source).toEqual({
      fileId: 'review-gamma', pageNumber: 1, filename: 'gamma.png', mediaType: 'image/png',
    });
    expect(prepared.rows[0].values['來源'].effective).toBe(prepared.rows[1].values['來源'].effective);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(commit.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows).toEqual(prepared.rows);
    expectPreservedAiState(before.ocr, saved.ocr);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'gamma.png', exact: true }).click();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await expect(reviewValue(dialog, 'REVIEW-P2')).toBeVisible();
    const image = dialog.getByRole('img', { name: 'Source page preview', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(800);
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

  test('source selector page counts come from actual authorized PDF/image bytes without writes', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
    for (const [fileId, pageCount] of [['review-alpha', 3], ['review-beta', 2], ['review-gamma', 1]] as const) {
      const response = await page.request.get(`${url}/${fileId}/page-count?${new URLSearchParams({ messageId })}`, { headers });
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ pageCount });
    }
    for (const fileId of ['review-foreign-selector', 'review-expired-selector', 'missing-selector-file']) {
      const response = await page.request.get(`${url}/${fileId}/page-count?${new URLSearchParams({ messageId })}`, { headers });
      expect(response.status()).toBe(404);
    }
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a source-only Save freezes trusted mapping and updates only the clicked message without staling its quote', async ({ page }) => {
    const markdown = `SELECTOR-PREFIX\n\n${ocr}\n\nSELECTOR-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const otherMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: otherMessageId, parentMessageId: messageId, text: ocr,
      content: [{ type: 'text', text: ocr }], isCreatedByUser: false, sender: 'Assistant',
    }]);
    const runId = randomUUID();
    const orderHash = createHash('sha256').update(ocr).digest('hex');
    await withMongo(async (db) => {
      const owner = await db.collection('messages').findOne({ conversationId, messageId });
      if (!owner) throw new Error('Missing selector quotation owner');
      await db.collection('steel_quotation_states').insertOne({
        userId: String(owner.user), conversationId,
        currentOrder: { markdown: ocr, sha256: orderHash },
        currentSystemOrder: { runId, messageId: randomUUID(), markdown: 'ORDER-UNCHANGED',
          sha256: createHash('sha256').update('ORDER-UNCHANGED').digest('hex'),
          customerQuoteMarkdown: 'INTERNAL-QUOTE-UNCHANGED', updatedAt: new Date() },
        nextSignalIndex: 2, pendingMessages: [],
        tickets: [{ index: 1, token: randomUUID(), orderHash, customerMarkdown: 'CUSTOMER-UNCHANGED',
          customerIdentity: 'CUSTOMER-1', triggeringMessageId: messageId,
          selectionProvenance: { method: 'unique' }, issuedAt: new Date(), acceptedRunId: runId,
          completionReceipt: { inputHash: 'FROZEN-INPUT', markdown: 'ORDER-UNCHANGED',
            ocrGeneration: 'review-proof-generation', ocrHash: orderHash } }],
        createdAt: new Date(), updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, undefined, [{ rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 }]) });
    expect(response.status()).toBe(200);
    const prepared = await response.json() as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRowIds).toEqual([table.rows[0].rowId]);
    expect(prepared.caption.changedRows).toBe(1);
    expect(prepared.rows[0].source).toMatchObject({ fileId: 'review-beta', pageNumber: 2, filename: 'beta.pdf' });
    expect(prepared.rows[0].values['來源'].effective).toMatch(/^F\d+$/u);
    expect(prepared.rows[0].values['頁碼']).toEqual({ baseline: '1', effective: '2' });
    for (const header of ['零件編號', '長度', '數量']) expect(prepared.rows[0].values[header]).toEqual(table.rows[0].values[header]);
    expect(prepared.rows[1]).toEqual({ ...table.rows[1], origin: 'ai', deleted: false });
    const mapping = { fileId: 'review-beta', sourceCode: prepared.rows[0].values['來源'].effective, sourceFilename: 'beta.pdf' };
    expect(prepared).toMatchObject({ sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]) });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(commit.status()).toBe(200);
    const saved = await commit.json();
    expect(saved.savedSnapshot).toMatchObject({ rows: prepared.rows,
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]) });
    const after = await persistedSnapshot(conversationId);
    const sourceCode = prepared.rows[0].values['來源'].effective;
    const clean = markdown.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', `| ${sourceCode} | REVIEW-P1 | 1000 | 2 | 2 |`);
    const clicked = after.messages.find((message) => message.messageId === messageId);
    expect(clicked?.text).toBe(clean);
    expect(clicked?.content).toEqual([{ type: 'text', text: clean }]);
    expect(after.messages.find((message) => message.messageId === otherMessageId))
      .toEqual(before.messages.find((message) => message.messageId === otherMessageId));
    expect(after.quotations).toEqual(before.quotations);
    expectPreservedAiState(before.ocr, after.ocr);
    expect(after.reviews[0]).toMatchObject({ rows: prepared.rows,
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]) });
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: prepared.rows,
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]) } });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('new source choices reject foreign expired missing multi-source and out-of-range pages before writes', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const before = await persistedSnapshot(conversationId);
    for (const intent of [
      { fileId: 'review-foreign-selector', pageNumber: 1 },
      { fileId: 'review-expired-selector', pageNumber: 1 },
      { fileId: 'missing-selector-file', pageNumber: 1 },
      { fileId: 'review-beta', pageNumber: 3 },
      { fileId: 'review-gamma', pageNumber: 2 },
      { fileId: ['review-alpha', 'review-beta'], pageNumber: 1 },
      { fileId: 'review-alpha', pageNumber: [1, 2] },
      { fileId: null, pageNumber: 1 },
    ]) {
      const response = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
        headers, data: { ...requestForRows(table), operations: [{ type: 'update', rowId: table.rows[0].rowId, source: intent }] },
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('source commit reauthorizes selected file and rejects changed immutable receipt intent', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, undefined, [{ rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 }]) });
    expect(response.status()).toBe(200);
    const prepared = await response.json() as SteelReviewOperationPrepared;
    await withMongo(async (db) => {
      await db.collection('files').updateOne({ conversationId, file_id: 'review-beta' }, { $set: { expiredAt: new Date(0) } });
    });
    const before = await persistedSnapshot(conversationId);
    const refused = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(refused.status()).toBeGreaterThanOrEqual(400);
    expect(refused.status()).toBeLessThan(500);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await withMongo(async (db) => {
      await db.collection('files').updateOne({ conversationId, file_id: 'review-beta' }, { $unset: { expiredAt: '' } });
    });
    const committed = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(committed.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    const tampered = operationCommit(prepared);
    tampered.operations = [{ type: 'update', rowId: table.rows[0].rowId,
      source: { fileId: 'review-beta', pageNumber: 1 } }];
    const refusedReplay = await page.request.post(`${url}/commit`, { headers, data: tampered });
    expect(refusedReplay.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

  test('an OCR Save marks only a quotation with proven OCR lineage as needing requote', async ({ page }) => {
    for (const linked of [true, false]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const runId = randomUUID();
      const orderHash = createHash('sha256').update(linked ? ocr : 'UNRELATED-OCR').digest('hex');
      const systemOrder = '## system_order\n| 型號 | 數量 | 總數 | 單價 |\n| --- | --- | --- | --- |\n| KEEP-ORDER | 2 | 4 | 100 |';
      await withMongo(async (db) => {
        const owner = await db.collection('messages').findOne({ conversationId, messageId });
        if (!owner) throw new Error('Missing scoped quotation owner');
        await db.collection('steel_quotation_states').insertOne({
          userId: String(owner.user), conversationId,
          // Preparing a new order must not make an unrelated older quote share its lineage.
          currentOrder: { markdown: ocr, sha256: createHash('sha256').update(ocr).digest('hex') },
          currentSystemOrder: {
            runId, messageId: randomUUID(), markdown: systemOrder,
            sha256: createHash('sha256').update(systemOrder).digest('hex'),
            customerQuoteMarkdown: 'INTERNAL-QUOTE-KEEP', updatedAt: new Date(),
          },
          nextSignalIndex: 2, pendingMessages: [],
          tickets: [{ index: 1, token: randomUUID(), orderHash, customerMarkdown: 'CUSTOMER-KEEP',
            customerIdentity: 'CUSTOMER-1', triggeringMessageId: messageId,
            selectionProvenance: { method: 'unique' }, issuedAt: new Date(), acceptedRunId: runId,
            completionReceipt: { inputHash: 'FROZEN-INPUT', markdown: systemOrder,
              ocrGeneration: linked ? 'review-proof-generation' : 'unrelated-generation', ocrHash: orderHash },
          }], createdAt: new Date(), updatedAt: new Date(),
        });
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '7';
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      expect(prepare.status()).toBe(200);
      const save = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
      expect(save.status()).toBe(200);
      const after = await persistedSnapshot(conversationId);
      const quotation = after.quotations[0];
      expectPreservedAiState(before.ocr, after.ocr);
      expect(quotation.currentSystemOrder.markdown).toBe(systemOrder);
      expect(quotation.currentSystemOrder.customerQuoteMarkdown).toBe('INTERNAL-QUOTE-KEEP');
      expect(quotation.tickets).toEqual(before.quotations[0].tickets);
      expect(quotation.currentOrder).toEqual(before.quotations[0].currentOrder);
      if (linked) expect(quotation.currentSystemOrder.needsRequote).toBe(true);
      else expect(quotation).toEqual(before.quotations[0]);
    }
  });

  test('review commit rejects client AI and target projections outside the owned title', async ({ page }) => {
    const markdown = `INTEGRITY-PREFIX\n\n${ocr}\n\nINTEGRITY-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const prepared = await prepareQuantity(page, headers, table, '9');
    const before = await persistedSnapshot(conversationId);
    for (const projection of [
      { target: { start: 0, end: markdown.length, sha256: createHash('sha256').update(markdown).digest('hex') } },
      { targetText: markdown }, { replacementText: 'CORRUPTED-PREFIX' },
      { cleanReplacementText: 'CORRUPTED-PREFIX' }, { effectiveMarkdown: 'CORRUPTED-PREFIX' },
      { aiBaselineMarkdown: 'FORGED-AI-BASELINE' }, { aiRawMarkdown: 'FORGED-AI-RAW' },
    ]) {
      const refused = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/commit`,
        { headers, data: { ...operationCommit(prepared), ...projection } });
      expect(refused.status()).toBe(400);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('prepare cannot overwrite a physical OCR table that drifted from its trusted state', async ({ page }) => {
    for (const hasHumanSave of [false, true]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      let { table } = await read.json() as { table: SteelReviewTable };
      if (hasHumanSave) {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = '7';
        const prepared = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
        expect(prepared.status()).toBe(200);
        const saved = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepared.json()) });
        expect(saved.status()).toBe(200);
        const reread = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
        table = (await reread.json() as { table: SteelReviewTable }).table;
      }
      const drifted = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 88 | 1 |');
      await withMongo((db) => db.collection('messages').updateOne({ conversationId, messageId }, {
        $set: { text: drifted, content: [{ type: 'text', text: drifted }] },
      }));
      const before = await persistedSnapshot(conversationId);
      const invalidRead = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect([200, 404]).toContain(invalidRead.status());
      if (invalidRead.status() === 200) {
        expect((await invalidRead.json()).table).toBeNull();
      }
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '9';
      if (!hasHumanSave) {
        rows[0].values['數量'].baseline = '88';
        rows[0].rowId = createHash('sha256')
          .update(`${table.outputId}:0:${JSON.stringify(['A', 'REVIEW-P1', '1000', '88', '1'])}`)
          .digest('hex');
      }
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      if (prepare.status() === 200) {
        const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
        expect([400, 404, 409]).toContain(commit.status());
      }
      expect([400, 404, 409]).toContain(prepare.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('an OCR saved snapshot contains only its owned section when AI storage has other headings', async ({ page }) => {
    const markdown = [
      'SECTION-KEEP-PREFIX',
      '## customer_data\n| Customer |\n| --- |\n| SECTION-KEEP-CUSTOMER |',
      ocr,
      '## Extra data\n| Name |\n| --- |\n| SECTION-KEEP-EXTRA |',
      'SECTION-KEEP-SUFFIX',
    ].join('\n\n');
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    await withMongo((db) => db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, {
      $set: { currentOcrResultMarkdown: markdown },
    }));
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table).not.toBeNull();
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(prepare.status()).toBe(200);
    const saved = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
    expect(saved.status()).toBe(200);
    const body = await saved.json();
    const expected = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |');
    expect(body.savedSnapshot.effectiveMarkdown).toBe(expected);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.effectiveMarkdown).toBe(expected);
    expect(after.reviews[0]?.humanMarkdown).toBe(expected);
    expect(after.messages[0]?.text).toBe(markdown.replace(ocr, expected));
    expectPreservedAiState(before.ocr, after.ocr);
  });

  test('an earlier committed operation returns its immutable saved snapshot after a later Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    async function save(quantity: string) {
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      expect(prepare.status()).toBe(200);
      const operation = await prepare.json() as SteelReviewOperationPrepared;
      const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(operation) });
      expect(commit.status()).toBe(200);
      return { operation, saved: await commit.json() };
    }
    const first = await save('7');
    const receiptQuery = new URLSearchParams({ messageId, title: first.operation.operationRequest.title,
      outputId: first.operation.operationRequest.outputId, operationId: first.operation.operationId, digest: first.operation.digest });
    const receiptUrl = `${url}/receipt?${receiptQuery}`;
    const firstState = await persistedSnapshot(conversationId);
    const committedReceipt = await page.request.get(receiptUrl, { headers });
    expect(committedReceipt.status()).toBe(200);
    const receipt = await committedReceipt.json();
    expect(receipt.snapshot).toEqual(first.saved.savedSnapshot);
    expect(receipt).toMatchObject({ status: 'committed', snapshot: {
      operationId: first.operation.operationId, revision: first.saved.revision,
      effectiveMarkdown: first.saved.effectiveMarkdown, messageSha256: first.saved.messageSha256,
    } });
    expect(await persistedSnapshot(conversationId)).toEqual(firstState);
    const wrongDigest = new URLSearchParams(receiptQuery);
    wrongDigest.set('digest', '0'.repeat(64));
    const conflictReceipt = await page.request.get(`${url}/receipt?${wrongDigest}`, { headers });
    expect(conflictReceipt.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(firstState);
    const missingOperation = new URLSearchParams(receiptQuery);
    missingOperation.set('operationId', randomUUID());
    const absentReceipt = await page.request.get(`${url}/receipt?${missingOperation}`, { headers });
    expect(absentReceipt.status()).toBe(200);
    expect(await absentReceipt.json()).toEqual({ status: 'absent' });
    expect(await persistedSnapshot(conversationId)).toEqual(firstState);
    const second = await save('8');
    expect(second.saved.revision).not.toBe(first.saved.revision);
    const afterSecond = await persistedSnapshot(conversationId);
    const retry = await page.request.post(`${url}/commit`, { headers, data: operationCommit(first.operation) });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual(first.saved);
    expect(await persistedSnapshot(conversationId)).toEqual(afterSecond);
    const historicalReceipt = await page.request.get(receiptUrl, { headers });
    expect(historicalReceipt.status()).toBe(200);
    expect(await historicalReceipt.json()).toEqual(receipt);
    expect(await persistedSnapshot(conversationId)).toEqual(afterSecond);
    const newMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: newMessageId, parentMessageId: messageId, text: ocr,
      content: [{ type: 'text', text: ocr }], isCreatedByUser: false, sender: 'Assistant',
    }]);
    await withMongo(async (db) => {
      await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
        currentOcrResultMessageId: newMessageId, currentOcrResultGenerationId: 'review-next-generation',
        currentOcrResultMarkdown: ocr, updatedAt: new Date(),
      } });
    });
    const afterNewAI = await persistedSnapshot(conversationId);
    const oldOwnerReceipt = await page.request.get(receiptUrl, { headers });
    expect(oldOwnerReceipt.status()).toBe(200);
    expect(await oldOwnerReceipt.json()).toEqual(receipt);
    const oldOwner = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(oldOwner.status()).toBe(200);
    expect(await oldOwner.json()).toMatchObject({ table: {
      readOnly: true, isLatest: false, aiUpdatedAt: firstState.ocr?.updatedAt.toISOString(),
    } });
    expect(await persistedSnapshot(conversationId)).toEqual(afterNewAI);
    const unknownOwner = new URLSearchParams(receiptQuery);
    unknownOwner.set('messageId', randomUUID());
    const missingMessage = await page.request.get(`${url}/receipt?${unknownOwner}`, { headers });
    expect(missingMessage.status()).toBe(404);
    const missingChat = await page.request.get(`/api/steel/conversations/${randomUUID()}/review/ocr_result/receipt?${receiptQuery}`, { headers });
    expect(missingChat.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(afterNewAI);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, {
        $set: { expiredAt: new Date(Date.now() - 60_000) },
      });
    });
    const expiredState = await persistedSnapshot(conversationId);
    const unavailableReceipt = await page.request.get(receiptUrl, { headers });
    expect(unavailableReceipt.status()).toBe(404);
    const unavailableReplay = await page.request.post(`${url}/commit`, { headers, data: operationCommit(first.operation) });
    expect(unavailableReplay.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(expiredState);
  });

  test('representation-only OCR whitespace is a confirmed no-op with no DB or timestamp write', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(response.status()).toBe(200);
    const { table } = await response.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = ' 2 ';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(0);
    const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(commit.status()).toBe(200);
    expect(await commit.json()).toMatchObject({ changedRows: 0 });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: [{ values: { 數量: { baseline: '2', effective: '2' } } }, {}] } });
  });

  test('OCR Save canonicalizes cell whitespace before persisting and the saved table reopens', async ({ page }) => {
    const markdown = `WHITESPACE-KEEP-PREFIX\n\n${ocr}\n\nWHITESPACE-KEEP-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(response.status()).toBe(200);
    const { table } = await response.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = ' \r\n7\r\n ';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(1);
    const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(commit.status()).toBe(200);
    const receipt = await commit.json();
    expect(receipt.savedSnapshot.rows[0].values['數量']).toEqual({ baseline: '2', effective: '7' });
    const after = await persistedSnapshot(conversationId);
    const expected = markdown.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |');
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(expected);
    expect(after.reviews[0]?.humanMarkdown).toBe(expected.slice(expected.indexOf('## ocr_result'), expected.indexOf('\n\nWHITESPACE-KEEP-SUFFIX')));
    expectPreservedAiState(before.ocr, after.ocr);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: [{ rowId: rows[0].rowId, values: { 數量: { baseline: '2', effective: '7' } } }, {}] } });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('an OCR business cell containing a literal backslash and pipe roundtrips through Save and reopen', async ({ page }) => {
    const markdown = `PIPE-KEEP-PREFIX\n\n${ocr}\n\nPIPE-KEEP-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(response.status()).toBe(200);
    const { table } = await response.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    const literal = 'REVIEW\\|PART';
    rows[0].values['零件編號'].effective = literal;
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(1);
    const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) });
    expect(commit.status()).toBe(200);
    const receipt = await commit.json();
    expect(receipt.savedSnapshot.rows[0].values['零件編號']).toEqual({ baseline: 'REVIEW-P1', effective: literal });
    const after = await persistedSnapshot(conversationId);
    const savedMessage = after.messages.find((message) => message.messageId === messageId);
    expect(savedMessage?.text.startsWith('PIPE-KEEP-PREFIX\n\n')).toBe(true);
    expect(savedMessage?.text.endsWith('\n\nPIPE-KEEP-SUFFIX')).toBe(true);
    expect(savedMessage?.content).toEqual([{ type: 'text', text: savedMessage?.text }]);
    expectPreservedAiState(before.ocr, after.ocr);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: [{ rowId: rows[0].rowId, values: { 零件編號: { baseline: 'REVIEW-P1', effective: literal }, 數量: { effective: '2' } } }, {}] } });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('saving representation-only OCR whitespace clears the local draft without marking Updated', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 /u });
    await quantity.fill(' 2 ');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await expect(quantity).toHaveValue('2');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Save updates', exact: true })).toHaveCount(0);
    await expect(page.getByText('Latest version v2', { exact: true })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  for (const foreignScope of ['owner', 'tenant'] as const) {
    test(`generic message edit hides foreign ${foreignScope} managed OCR state without writes`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      await withMongo(async (db) => {
        const scope = foreignScope === 'owner'
          ? { user: new ObjectId().toHexString() }
          : { tenantId: 'foreign-managed-review-tenant' };
        await db.collection('conversations').updateOne({ conversationId }, { $set: scope });
        await db.collection('messages').updateOne({ conversationId, messageId }, { $set: scope });
      });
      const before = await persistedSnapshot(conversationId);
      const response = await page.request.put(`/api/messages/${conversationId}/${messageId}`, {
        headers,
        data: { text: 'FOREIGN-MANAGED-STATE-MUST-NOT-BE-CHANGED', model: 'gpt-4o-mini' },
      });
      expect(response.status()).toBe(404);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    });
  }

  test('a foreign tenant ordinary message cannot bypass the scoped edit guard', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      await db.collection('conversations').updateOne({ conversationId }, {
        $set: { tenantId: 'foreign-ordinary-review-tenant' },
      });
      await db.collection('messages').updateOne({ conversationId, messageId }, {
        $set: { tenantId: 'foreign-ordinary-review-tenant', text: 'FOREIGN-ORDINARY-KEEP', content: [{ type: 'text', text: 'FOREIGN-ORDINARY-KEEP' }] },
      });
      await db.collection('steel_conversation_ocr_state').deleteOne({ conversationId });
    });
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.put(`/api/messages/${conversationId}/${messageId}`, {
      headers,
      data: { text: 'FOREIGN-ORDINARY-MUST-NOT-BE-CHANGED', model: 'gpt-4o-mini' },
    });
    expect(response.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('manual OCR Save changes only the clicked message and chat reload shows clean saved values', async ({ page }) => {
    const markdown = [
      'SAVE-KEEP-PREFIX',
      publishedOcr,
      '## Keep this table\n| Label | Value |\n| --- | --- |\n| Unrelated | 4242 |',
      'SAVE-KEEP-SUFFIX',
    ].join('\n\n');
    const { conversationId, messageId } = await seedCurrentPublished(markdown);
    conversations.push(conversationId);
    const previousMessageId = randomUUID();
    const previousMarkdown = publishedOcr.replace('REVIEW-P1', 'PREVIOUS-SAME-TITLE').replace('| 1000 | 2 |', '| 1000 | 97 |');
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: previousMessageId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: previousMarkdown,
      content: [{ type: 'text', text: previousMarkdown }],
      isCreatedByUser: false,
      sender: 'Assistant',
    }]);
    await withMongo(async (db) => {
      const currentOwner = await db.collection('messages').findOne({ conversationId, messageId });
      await db.collection('messages').updateOne({ conversationId, messageId: currentOwner!.parentMessageId },
        { $set: { parentMessageId: previousMessageId } });
      await db.collection('messages').updateOne({ conversationId, messageId }, { $set: {
        text: `${markdown} SAVE-SECOND-PART-KEEP`,
        content: [{ type: 'text', text: markdown }, { type: 'text', text: 'SAVE-SECOND-PART-KEEP' }],
      } });
      await db.collection('messages').updateOne({ conversationId, messageId: previousMessageId }, {
        $set: { createdAt: new Date(Date.now() - 60_000), updatedAt: new Date(Date.now() - 60_000) },
      });
    });
    const otherChat = await seedCurrentPublished(publishedOcr.replace('REVIEW-P1', 'OTHER-CHAT-SAME-TITLE'));
    conversations.push(otherChat.conversationId);
    const before = await persistedSnapshot(conversationId);
    const otherBefore = await persistedSnapshot(otherChat.conversationId);
    const previousBefore = before.messages.find((message) => message.messageId === previousMessageId);
    const recognized = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(recognized.status()).toBe(200);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 / });
    await expect(quantity).toHaveValue('2');
    await quantity.fill('9');
    await quantity.press('Enter');
    const oneUnsavedRow = dialog.getByText(/Unsaved.*1|1.*unsaved/i);
    await expect(oneUnsavedRow).toBeVisible();
    await quantity.fill('10');
    await quantity.press('Enter');
    await expect(oneUnsavedRow).toBeVisible();
    await quantity.fill('2');
    await quantity.press('Enter');
    await expect(oneUnsavedRow).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    // Save includes the focused value even before Enter or blur.
    await quantity.fill('9');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect.poll(async () => {
      const snapshot = await persistedSnapshot(conversationId);
      return snapshot.messages.find((message) => message.messageId === messageId)?.text;
    }).toContain('| F1 | REVIEW-P1 | 1000 | 9 | 1 |');
    const after = await persistedSnapshot(conversationId);
    const savedMessage = after.messages.find((message) => message.messageId === messageId);
    const expectedMarkdown = markdown.replace('| F1 | REVIEW-P1 | 1000 | 2 | 1 |', '| F1 | REVIEW-P1 | 1000 | 9 | 1 |');
    expect(savedMessage?.text).toBe(`${expectedMarkdown} SAVE-SECOND-PART-KEEP`);
    expect(savedMessage?.content).toEqual([
      { type: 'text', text: expectedMarkdown },
      { type: 'text', text: 'SAVE-SECOND-PART-KEEP' },
    ]);
    expect(after.messages.find((message) => message.messageId === previousMessageId)).toEqual(previousBefore);
    expect(await persistedSnapshot(otherChat.conversationId)).toEqual(otherBefore);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    expect(await read.json()).toMatchObject({ table: {
      messageId,
      isLatest: true,
      readOnly: false,
      rows: [
        { values: { 數量: { baseline: '2', effective: '9' } } },
        { values: { 數量: { baseline: '3', effective: '3' } } },
      ],
    } });
    await expect(dialog.locator('del').filter({ hasText: /^2$/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Latest version v2', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Latest version v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).last().click();
    await expect(quantity).toHaveValue('9');
    await expect(dialog.locator('del').filter({ hasText: /^2$/ })).toBeVisible();
    expect((await persistedSnapshot(conversationId)).messages.find((message) => message.messageId === previousMessageId)).toEqual(previousBefore);
  });

  test('the OCR editor sends only changed row values and replays its immutable operation request', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('7');
    const prepareRequest = page.waitForRequest((request) => request.method() === 'POST' &&
      request.url().endsWith(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`));
    const commitRequest = page.waitForRequest((request) => request.method() === 'POST' &&
      request.url().endsWith(`/api/steel/conversations/${conversationId}/review/ocr_result/commit`));
    await dialog.getByRole('button', { name: /^Save/ }).click();
    const preparedBody = (await prepareRequest).postDataJSON() as SteelReviewOperationPrepare;
    const committedBody = (await commitRequest).postDataJSON() as SteelReviewOperationCommit;
    expect(preparedBody.operations).toEqual([{ type: 'update', rowId: expect.any(String),
      changes: [{ header: '數量', value: '7' }] }]);
    expect(committedBody.operations).toEqual(preparedBody.operations);
    expect(committedBody).toMatchObject({ ...preparedBody, operationId: expect.any(String), digest: expect.any(String) });
    for (const body of [preparedBody, committedBody]) {
      for (const field of ['rows', 'headers', 'aiBaselineMarkdown', 'aiRawMarkdown', 'target', 'targetText', 'sourceMappings', 'effectiveMarkdown']) {
        expect(body).not.toHaveProperty(field);
      }
    }
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const saved = await persistedSnapshot(conversationId);
    expect(saved.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'));
    expect(saved.reviews[0]?.rows[1].values).toMatchObject({ 數量: { baseline: '3', effective: '3' } });
    expect(saved.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  test('changed-row operations prepare without writes and reject immutable fields and ambiguous positions', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = { conversationId, messageId, kind: 'ocr_result',
      title: table.title, outputId: table.outputId, revision: table.revision,
      operations: [{ type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '7' }] }] };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const invalidOperations = [
      { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '來源', value: 'FORGED' }] },
      { type: 'update', rowId: table.rows[0].rowId, baseline: 'FORGED', changes: [{ header: '數量', value: '7' }] },
      { type: 'update', rowId: table.rows[0].rowId, source: { fileId: null, pageNumber: 1 } },
      { type: 'update', rowId: table.rows[0].rowId, source: { fileId: 'review-alpha' } },
      { type: 'update', rowId: table.rows[0].rowId, source: null },
      { type: 'add', rowId: randomUUID(), position: { kind: 'end', rowId: table.rows[0].rowId }, changes: [{ header: '零件編號', value: 'BAD-POSITION' }] },
      { type: 'add', rowId: randomUUID(), position: { kind: 'after' }, changes: [{ header: '零件編號', value: 'BAD-POSITION' }] },
      { type: 'add', rowId: randomUUID(), position: { kind: 'after', rowId: null }, changes: [{ header: '零件編號', value: 'BAD-POSITION' }] },
      { type: 'delete', rowId: table.rows[0].rowId, origin: 'manual' },
    ];
    for (const operation of invalidOperations) {
      const rejected = await page.request.post(`${url}/prepare`, { headers, data: { ...request, operations: [operation] } });
      expect([400, 409]).toContain(rejected.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
    const mixed = await page.request.post(`${url}/prepare`, { headers, data: { ...request, rows: table.rows } });
    expect([400, 409]).toContain(mixed.status());
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    for (const source of [{ fileId: null, pageNumber: null }, { fileId: 'review-alpha', pageNumber: null }]) {
      const sourcePrepared = await page.request.post(`${url}/prepare`, { headers, data: { ...request,
        operations: [{ type: 'update', rowId: table.rows[0].rowId, source }] } });
      expect(sourcePrepared.status()).toBe(200);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
    const prepared = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepared.status()).toBe(200);
    const result = await prepared.json() as SteelReviewOperationPrepared;
    expect(result.operationRequest).toEqual(request);
    expect(result.caption).toMatchObject({ changedRows: 1, changedRowIds: [table.rows[0].rowId] });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, { headers,
      data: { ...result.operationRequest, operationId: result.operationId, digest: result.digest } });
    expect(commit.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows[1].values).toEqual(table.rows[1].values);
    expect(saved.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  test('changed-row requests reject unknown captured versions before and after a real Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const request: SteelReviewOperationPrepare = { conversationId, messageId, kind: 'ocr_result',
      title: table.title, outputId: table.outputId, revision: table.revision,
      operations: [{ type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '7' }] }] };
    const rejectUnknown = async (value: string) => {
      const before = await persistedSnapshot(conversationId);
      const response = await page.request.post(`${url}/prepare`, { headers, data: { ...request,
        revision: 'unknown-never-existed',
        operations: [{ type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value }] }] } });
      expect(response.status()).toBe(409);
      const failure = await response.json() as SteelReviewErrorResponse;
      expect(failure.code).toBe('REVIEW_CONFLICT');
      expect(failure).not.toHaveProperty('recovery');
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    };
    await rejectUnknown('7');
    const prepared = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepared.status()).toBe(200);
    const operation = await prepared.json() as SteelReviewOperationPrepared;
    const committed = await page.request.post(`${url}/commit`, { headers,
      data: { ...operation.operationRequest, operationId: operation.operationId, digest: operation.digest } });
    expect(committed.status()).toBe(200);
    await rejectUnknown('7');
    await rejectUnknown('9');
    const disjoint = await page.request.post(`${url}/prepare`, { headers, data: { ...request,
      operations: [{ type: 'update', rowId: table.rows[1].rowId, changes: [{ header: '數量', value: '8' }] }] } });
    expect(disjoint.status()).toBe(200);
    const next = await disjoint.json() as SteelReviewOperationPrepared;
    const merged = await page.request.post(`${url}/commit`, { headers,
      data: { ...next.operationRequest, operationId: next.operationId, digest: next.digest } });
    expect(merged.status()).toBe(200);
    const latest = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(latest.status()).toBe(200);
    const current = await latest.json() as { table: SteelReviewTable };
    expect(current.table.rows.map((row) => row.values['數量'].effective)).toEqual(['7', '8']);
    expect(current.table.rows.map((row) => row.values['數量'].baseline)).toEqual(['2', '3']);
  });

  test('changed-row receipts reject request tampering and replay their original snapshot after a later Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = { conversationId, messageId, kind: 'ocr_result',
      title: table.title, outputId: table.outputId, revision: table.revision,
      operations: [{ type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '7' }] }] };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepared = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepared.status()).toBe(200);
    const first = await prepared.json() as SteelReviewOperationPrepared;
    const firstBody = { ...first.operationRequest, operationId: first.operationId, digest: first.digest };
    const committed = await page.request.post(`${url}/commit`, { headers, data: firstBody });
    expect(committed.status()).toBe(200);
    const firstSaved = await committed.json() as SteelReviewSaveResponse;
    const secondRequest = { ...request, revision: firstSaved.revision,
      operations: [{ type: 'update' as const, rowId: table.rows[1].rowId, changes: [{ header: '數量', value: '8' }] }] };
    const preparedAgain = await page.request.post(`${url}/prepare`, { headers, data: secondRequest });
    expect(preparedAgain.status()).toBe(200);
    const second = await preparedAgain.json() as SteelReviewOperationPrepared;
    const secondSave = await page.request.post(`${url}/commit`, { headers,
      data: { ...second.operationRequest, operationId: second.operationId, digest: second.digest } });
    expect(secondSave.status()).toBe(200);
    const beforeRetry = await persistedSnapshot(conversationId);
    const tampered = await page.request.post(`${url}/commit`, { headers, data: { ...firstBody,
      operations: [{ type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '9' }] }] } });
    expect([400, 409]).toContain(tampered.status());
    expect(await persistedSnapshot(conversationId)).toEqual(beforeRetry);
    const downgrade = await page.request.post(`${url}/commit`, { headers, data: first });
    expect([400, 409]).toContain(downgrade.status());
    expect(await persistedSnapshot(conversationId)).toEqual(beforeRetry);
    const stripped = await page.request.post(`${url}/commit`, { headers, data: { ...first,
      operations: undefined, operationRequest: undefined, requestDigest: undefined } });
    expect([400, 409]).toContain(stripped.status());
    expect(await persistedSnapshot(conversationId)).toEqual(beforeRetry);
    const replay = await page.request.post(`${url}/commit`, { headers, data: firstBody });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(firstSaved);
    expect(await persistedSnapshot(conversationId)).toEqual(beforeRetry);
    expect(beforeRetry.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |')
        .replace('| A | REVIEW-P2 | 2000 | 3 | 1 |', '| A | REVIEW-P2 | 2000 | 8 | 1 |'));
    expect(beforeRetry.reviews[0]?.rows).toMatchObject([
      { values: { 數量: { baseline: '2', effective: '7' } } },
      { values: { 數量: { baseline: '3', effective: '8' } } },
    ]);
    expect(beforeRetry.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  test('ordered row updates retain tombstone values and count restore plus update once', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const rowId = table.rows[0].rowId;
    const request: SteelReviewOperationPrepare = { conversationId, messageId, kind: 'ocr_result',
      title: table.title, outputId: table.outputId, revision: table.revision,
      operations: [{ type: 'update', rowId, changes: [{ header: '數量', value: '7' }] }, { type: 'delete', rowId }] };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepared = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepared.status()).toBe(200);
    const first = await prepared.json() as SteelReviewOperationPrepared;
    expect(first.caption.changedRows).toBe(1);
    const committed = await page.request.post(`${url}/commit`, { headers,
      data: { ...first.operationRequest, operationId: first.operationId, digest: first.digest } });
    expect(committed.status()).toBe(200);
    const deleted = await committed.json() as SteelReviewSaveResponse;
    const afterDelete = await persistedSnapshot(conversationId);
    expect(afterDelete.reviews[0]?.rows[0]).toMatchObject({ deleted: true, values: { 數量: { baseline: '2', effective: '7' } } });
    expect(afterDelete.messages.find((message) => message.messageId === messageId)?.text).not.toContain('REVIEW-P1');
    const restored = await page.request.post(`${url}/prepare`, { headers, data: { ...request, revision: deleted.revision,
      operations: [{ type: 'restore', rowId }, { type: 'update', rowId, changes: [{ header: '數量', value: '8' }] }] } });
    expect(restored.status()).toBe(200);
    const second = await restored.json() as SteelReviewOperationPrepared;
    expect(second.caption.changedRows).toBe(1);
    const saved = await page.request.post(`${url}/commit`, { headers,
      data: { ...second.operationRequest, operationId: second.operationId, digest: second.digest } });
    expect(saved.status()).toBe(200);
    const afterRestore = await persistedSnapshot(conversationId);
    expect(afterRestore.reviews[0]?.rows[0]).toMatchObject({ deleted: false, values: { 數量: { baseline: '2', effective: '8' } } });
    expect(afterRestore.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
    expect(afterRestore.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  test('OCR row CRUD is local and adding then deleting before Save is a net-zero no-op', async ({ page }) => {
    const { conversationId } = await seedCurrentPublished(publishedOcr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(dialog.locator('tbody tr')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(3);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.locator('tbody tr').last().getByRole('button', { name: /^Delete row(?:\s|$)/ }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(2);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard unsaved changes', exact: true })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
  });

  test('two identical OCR additions retain independent identities and one selected source through Save and reload', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect.poll(() => dialog.locator('canvas').evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    for (let index = 0; index < 2; index += 1) {
      await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
      const row = dialog.locator('tbody tr').last();
      await row.locator('td').nth(1).getByRole('textbox').fill('MANUAL-DUPLICATE');
      await row.locator('td').nth(2).getByRole('textbox').fill('3000');
      await row.locator('td').nth(3).getByRole('textbox').fill('4');
      await row.locator('td').nth(3).getByRole('textbox').press('Enter');
    }
    await expect(dialog.getByText(/Unsaved.*2|2.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const prepareRequest = page.waitForRequest((request) => request.method() === 'POST' &&
      request.url().endsWith(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`));
    const commitRequest = page.waitForRequest((request) => request.method() === 'POST' &&
      request.url().endsWith(`/api/steel/conversations/${conversationId}/review/ocr_result/commit`));
    await dialog.getByRole('button', { name: /^Save/ }).click();
    const prepareBody = (await prepareRequest).postDataJSON() as SteelReviewOperationPrepare;
    const commitBody = (await commitRequest).postDataJSON() as SteelReviewOperationCommit;
    expect(prepareBody.operations).toHaveLength(2);
    const newIds = prepareBody.operations.map((operation) => operation.rowId);
    expect(new Set(newIds).size).toBe(2);
    for (const operation of prepareBody.operations) {
      expect(operation.type).toBe('add');
      if (operation.type !== 'add') throw new Error('Expected independent add operations');
      expect(operation.source).toEqual({ fileId: 'review-alpha', pageNumber: 1 });
      expect(operation.position.kind).toMatch(/^(?:after|end)$/);
      if (operation.position.kind === 'after') expect(newIds).not.toContain(operation.position.rowId);
      expect(operation).not.toHaveProperty('ordinal');
      expect(operation).not.toHaveProperty('values');
      expect(operation.changes).toEqual(expect.arrayContaining([{ header: '零件編號', value: 'MANUAL-DUPLICATE' },
        { header: '長度', value: '3000' }, { header: '數量', value: '4' }]));
    }
    const [firstAdd, secondAdd] = prepareBody.operations;
    if (firstAdd.type !== 'add' || secondAdd.type !== 'add') throw new Error('Expected two add operations');
    expect(firstAdd.position).toEqual(secondAdd.position);
    expect(commitBody.operations).toEqual(prepareBody.operations);
    expect(prepareBody).not.toHaveProperty('rows');
    expect(commitBody).not.toHaveProperty('rows');
    await expect(dialog.getByText('Updated 2 rows', { exact: true })).toBeVisible();
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews).toHaveLength(1);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const added = table.rows.filter((row) => row.values['零件編號'].effective === 'MANUAL-DUPLICATE');
    expect(added).toHaveLength(2);
    expect(new Set(added.map((row) => row.rowId)).size).toBe(2);
    expect(added.map((row) => row.insertion?.ordinal)).toEqual([0, 1]);
    const replay = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/commit`,
      { headers, data: commitBody });
    expect(replay.status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(after);
    for (const row of added) {
      expect(row).toMatchObject({ origin: 'manual', deleted: false,
        source: { fileId: 'review-alpha', pageNumber: 1, filename: 'alpha.pdf' } });
      expect(Object.values(row.values).every((cell) => cell.baseline === null)).toBe(true);
      expect(row.values['數量'].effective).toBe('4');
    }
    expect(after.reviews[0]?.rows).toEqual(table.rows);
    expect(after.reviews[0]?.receipts).toMatchObject([{ changedRows: 2 }]);
    expect(after.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr + '\n| A | MANUAL-DUPLICATE | 3000 | 4 | 1 |\n| A | MANUAL-DUPLICATE | 3000 | 4 | 1 |');
    expect(after.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
    expectPreservedAiState(before.ocr, after.ocr);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(4);
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('deleting all OCR rows keeps popup AI tombstones and saves a reopenable clean header-only table', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    for (const id of ['REVIEW-P1', 'REVIEW-P2']) {
      const row = dialog.locator('tbody tr').filter({ has: page.locator(`input[value="${id}"]`) });
      await row.getByRole('button', { name: /^Delete row(?:\s|$)/ }).click();
      await expect(dialog.locator('del').filter({ hasText: id })).toBeVisible();
    }
    await expect(dialog.getByText(/Unsaved.*2|2.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 2 rows', { exact: true })).toBeVisible();
    const after = await persistedSnapshot(conversationId);
    const emptyMarkdown = ocr.split('\n').slice(0, 3).join('\n');
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(emptyMarkdown);
    expect(after.reviews[0]).toMatchObject({ aiBaselineMarkdown: ocr,
      effectiveMarkdown: emptyMarkdown,
      rows: [{ origin: 'ai', deleted: true }, { origin: 'ai', deleted: true }],
      receipts: [{ changedRows: 2 }] });
    expectPreservedAiState(before.ocr, after.ocr);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(after);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('del')).toHaveCount(0);
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download table as CSV', exact: true }).click();
    const download = await downloadReady;
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('Missing header-only confirmed CSV');
    const csv = await readFile(downloadedPath, 'utf8');
    expect(csv).toContain('來源,零件編號,長度,數量,頁碼');
    expect(csv).not.toMatch(/REVIEW-P1|REVIEW-P2|<del>|~~/);
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(dialog.locator('del').filter({ hasText: 'REVIEW-P1' })).toBeVisible();
    await expect(dialog.locator('del').filter({ hasText: 'REVIEW-P2' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add row', exact: true })).toBeEnabled();
    expect(await persistedSnapshot(conversationId)).toEqual(after);
    await expect.poll(() => dialog.locator('canvas').evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    const addedRow = dialog.locator('tbody tr').filter({ has: page.getByRole('textbox', { name: /^零件編號 /u }) }).last();
    await addedRow.getByRole('textbox', { name: /^零件編號 /u }).fill('AFTER-ALL-DELETE');
    await addedRow.getByRole('textbox', { name: /^長度 /u }).fill('500');
    await addedRow.getByRole('textbox', { name: /^數量 /u }).fill('4');
    await addedRow.getByRole('textbox', { name: /^數量 /u }).press('Enter');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const afterAdd = await persistedSnapshot(conversationId);
    expect(afterAdd.reviews[0]?.rows).toMatchObject([
      { origin: 'ai', deleted: true }, { origin: 'ai', deleted: true },
      { origin: 'manual', deleted: false, insertion: { kind: 'end', ordinal: 0 },
        values: { 零件編號: { baseline: null, effective: 'AFTER-ALL-DELETE' } } },
    ]);
    expect(afterAdd.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(emptyMarkdown + '\n| A | AFTER-ALL-DELETE | 500 | 4 | 1 |');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(dialog.locator('input[value="AFTER-ALL-DELETE"]')).toBeVisible();
    await expect(dialog.locator('del').filter({ hasText: 'REVIEW-P1' })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(afterAdd);
  });
  test('OCR additions allocate new ordinals after saved manual rows and tombstones', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect.poll(() => dialog.locator('canvas').evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    for (const [index, part] of ['FIRST-SAVED', 'SECOND-SAVED', 'AFTER-TOMBSTONE'].entries()) {
      if (index === 2) {
        await dialog.locator('tbody tr').filter({ has: page.locator('input[value="SECOND-SAVED"]') })
          .getByRole('button', { name: /^Delete row(?:\s|$)/ }).click();
        await dialog.getByRole('button', { name: /^Save/ }).click();
        await expect.poll(async () => (await persistedSnapshot(conversationId)).reviews[0]?.receipts.length).toBe(3);
        await expect(dialog.getByRole('button', { name: 'Add row', exact: true })).toBeEnabled();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      }
      await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
      const row = dialog.locator('tbody tr').last();
      await row.locator('td').nth(1).getByRole('textbox').fill(part);
      await row.locator('td').nth(3).getByRole('textbox').fill('4');
      await row.locator('td').nth(3).getByRole('textbox').press('Enter');
      await dialog.getByRole('button', { name: /^Save/ }).click();
      await expect.poll(async () => (await persistedSnapshot(conversationId)).reviews[0]?.receipts.length).toBe(index === 2 ? 4 : index + 1);
      await expect(dialog.locator(`input[value="${part}"]`)).toBeVisible();
      await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    }
    const saved = await persistedSnapshot(conversationId);
    const manual = saved.reviews[0]?.rows.filter((row) => row.origin === 'manual');
    expect(manual).toMatchObject([
      { deleted: false, insertion: { kind: 'after', ordinal: 0 } },
      { deleted: true, insertion: { kind: 'after', ordinal: 1 } },
      { deleted: false, insertion: { kind: 'after', ordinal: 2 } },
    ]);
    expect(new Set(manual?.map((row) => row.insertion?.rowId)).size).toBe(1);
    expect(saved.messages.find((message) => message.messageId === messageId)?.text).toContain('FIRST-SAVED');
    expect(saved.messages.find((message) => message.messageId === messageId)?.text).toContain('AFTER-TOMBSTONE');
    expect(saved.messages.find((message) => message.messageId === messageId)?.text).not.toContain('SECOND-SAVED');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(dialog.locator('input[value="AFTER-TOMBSTONE"]')).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });



  test('OCR restored tombstone edit then delete saves one normal compound draft', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const initial = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(initial.status()).toBe(200);
    const { table } = await initial.json() as { table: SteelReviewTable };
    const rowId = table.rows[0].rowId;
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="REVIEW-P1"]') });
    await row.getByRole('button', { name: `Delete row ${rowId}`, exact: true }).click();
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const deleted = await persistedSnapshot(conversationId);
    expect(deleted.reviews[0]?.rows[0]).toMatchObject({ rowId, deleted: true });
    await dialog.getByRole('button', { name: `Restore row ${rowId}`, exact: true }).click();
    const quantity = row.locator('td').nth(3).getByRole('textbox');
    await quantity.fill('9');
    await quantity.press('Enter');
    await row.getByRole('button', { name: `Delete row ${rowId}`, exact: true }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(deleted);
    const preparedResponse = page.waitForResponse((response) => response.url().endsWith(`${url}/prepare`) && response.request().method() === 'POST');
    const committedResponse = page.waitForResponse((response) => response.url().endsWith(`${url}/commit`) && response.request().method() === 'POST');
    void committedResponse.catch(() => undefined);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    const prepared = await preparedResponse;
    expect(prepared.status(), await prepared.text()).toBe(200);
    const request = prepared.request().postDataJSON() as SteelReviewOperationPrepare;
    expect(request.operations).toEqual([
      { type: 'restore', rowId },
      { type: 'update', rowId, changes: [{ header: '數量', value: '9' }] },
      { type: 'delete', rowId },
    ]);
    const committed = await committedResponse;
    expect(committed.status(), await committed.text()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows[0]).toMatchObject({ rowId, deleted: true,
      values: { 數量: { baseline: '2', effective: '9' } } });
    expect(saved.reviews[0]?.rows[1]).toEqual(deleted.reviews[0]?.rows[1]);
    expect(saved.reviews[0]?.receipts).toMatchObject([{ changedRows: 1 }, { changedRows: 1 }]);
    expect(saved.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
    expectPreservedAiState(deleted.ocr, saved.ocr);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(dialog.getByRole('button', { name: `Restore row ${rowId}`, exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });



  test('a failed OCR prepare keeps retained draft and retry saves only the chosen draft', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const prepareUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/prepare`;
    await page.route(prepareUrl, (route) => route.abort('failed'));
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('7');
    await quantity.press('8');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(quantity).toHaveValue('78');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await expect(quantity).toHaveValue('2');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await expect(quantity).toHaveValue('78');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.unroute(prepareUrl);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const saved = await persistedSnapshot(conversationId);
    expect(saved.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 78 | 1 |'));
    expect(saved.reviews[0]?.receipts).toHaveLength(1);
    expectPreservedAiState(before.ocr, saved.ocr);
  });

  test('deleting a previously saved manual OCR row changes one row without inventing an AI comparison', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrentPublished(publishedOcr);
    conversations.push(conversationId);
    const original = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    const added = dialog.locator('tbody tr').last();
    await added.getByRole('textbox', { name: /^零件編號 / }).fill('MANUAL-ONLY');
    await added.getByRole('textbox', { name: /^數量 / }).fill('4');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const first = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const manual = table.rows.find((row) => row.values['零件編號'].effective === 'MANUAL-ONLY');
    expect(manual).toBeDefined();
    await dialog.locator('tbody tr').filter({ has: page.locator('input[value="MANUAL-ONLY"]') })
      .getByRole('button', { name: /^Delete row(?:\s|$)/ }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    await expect(dialog.locator('del').filter({ hasText: 'MANUAL-ONLY' })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(first);
    await expect(dialog.locator('input[value="MANUAL-ONLY"]')).toHaveCount(0);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(first);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect.poll(async () => (await persistedSnapshot(conversationId)).reviews[0]?.receipts.length).toBe(2);
    const second = await persistedSnapshot(conversationId);
    expect(second.messages.find((message) => message.messageId === messageId)?.text).toBe(original.messages.find((message) => message.messageId === messageId)?.text);
    expect(second.reviews[0]?.aiBaselineMarkdown).toBe(first.reviews[0]?.aiBaselineMarkdown);
    expect(second.reviews[0]?.rows).toContainEqual(expect.objectContaining({ rowId: manual?.rowId,
      origin: 'manual', deleted: true }));
    expect(second.reviews[0]?.receipts[1]).toMatchObject({ changedRows: 1, changedRowIds: [manual?.rowId] });
    await expect(dialog.locator('input[value="MANUAL-ONLY"]')).toHaveCount(0);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(second);
  });

  test('OCR Save displays authoritative prepared and confirmed row counts without writing presentation copy into chat', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    let resumeCommit: (() => void) | undefined;
    const commitPaused = new Promise<void>((resolve) => { resumeCommit = resolve; });
    const commitUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    await page.route(commitUrl, async (route) => {
      await commitPaused;
      await route.continue();
    });
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('7');
    await quantity.press('Enter');
    await quantity.fill('8');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    try {
      await expect(dialog.getByText('This save will update 1 rows', { exact: true })).toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    } finally {
      resumeCommit?.();
    }
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const after = await persistedSnapshot(conversationId);
    expect(after.messages[0]?.text).toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
    expect(after.messages[0]?.content).toEqual([{ type: 'text', text: after.messages[0]?.text }]);
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews[0]?.receipts).toMatchObject([{ changedRows: 1 }]);
    expectPreservedAiState(before.ocr, after.ocr);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await expect(dialog.getByText('This save will update 1 rows', { exact: true })).toHaveCount(0);
  });

  test('dirty OCR Escape offers continue and discard without saving the chat', async ({ page }) => {
    const { conversationId } = await seedCurrentPublished(publishedOcr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 / });
    await quantity.fill('8');
    await quantity.press('Escape');
    await expect(page.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(quantity).toHaveValue('8');
    for (const exit of ['close', 'outside']) {
      await quantity.focus();
      if (exit === 'close') {
        await dialog.getByRole('button', { name: /Close/i }).last().click();
      } else {
        await page.mouse.click(5, 5);
      }
      await expect(page.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
      await expect(quantity).toHaveValue('8');
    }
    await quantity.press('Escape');
    await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(quantity).toHaveValue('2');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await quantity.fill('11');
    await quantity.press('Escape');
    await page.getByRole('button', { name: 'Save updates', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await persistedSnapshot(conversationId)).messages[0]?.text)
      .toBe(before.messages[0]?.text?.replace('| F1 | REVIEW-P1 | 1000 | 2 | 1 |', '| F1 | REVIEW-P1 | 1000 | 11 | 1 |'));
  });


  test('ordinary message edits cannot bypass the managed OCR Save contract', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const ordinaryMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: ordinaryMessageId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: 'ORDINARY-BEFORE',
      isCreatedByUser: true,
      sender: 'User',
    }]);
    const ordinary = await page.request.put(`/api/messages/${conversationId}/${ordinaryMessageId}`, {
      headers,
      data: { text: 'ORDINARY-AFTER', model: 'gpt-4o' },
    });
    expect(ordinary.status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    expect(before.messages.find((message) => message.messageId === ordinaryMessageId)?.text).toBe('ORDINARY-AFTER');
    const recognized = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(recognized.status()).toBe(200);
    const replacement = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 99 | 1 |');
    for (const data of [{ text: replacement, model: 'gpt-4o' }, { text: replacement, index: 0, model: 'gpt-4o' }]) {
      const response = await page.request.put(`/api/messages/${conversationId}/${messageId}`, { headers, data });
      expect(response.status()).toBe(409);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });


  test('a known historical OCR message stays read-only through the generic edit endpoint', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const historicalId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: historicalId, parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: ocr, content: [{ type: 'text', text: ocr }], isCreatedByUser: false, sender: 'Assistant',
    }]);
    const current = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    expect(current.status()).toBe(200);
    const { table } = await current.json() as { table: SteelReviewTable };
    await withMongo(async (db) => {
      const message = await db.collection('messages').findOne({ conversationId, messageId: historicalId });
      if (!message) throw new Error('Missing historical message');
      await db.collection('steel_review_outputs').insertOne({
        userId: message.user, conversationId, messageId: historicalId,
        kind: 'ocr_result', tableId: 'ocr_result:1', outputId: 'ocr_result:previous-owner',
        revision: 'previous-owner-revision', state: 'historical',
        headers: table.headers, rows: table.rows.map((row, index) => ({ ...row,
          rowId: createHash('sha256').update(`ocr_result:previous-owner:${index}:${JSON.stringify(table.headers.map((header) => row.values[header].baseline ?? ''))}`).digest('hex'),
        })), aiRawMarkdown: ocr,
        aiBaselineMarkdown: ocr, effectiveMarkdown: ocr, receipts: [],
        createdAt: new Date(), updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const historical = await page.request.get(readUrl(conversationId, historicalId, 'ocr_result'), { headers });
    expect(historical.status()).toBe(200);
    expect(await historical.json()).toMatchObject({ table: { readOnly: true, isLatest: false } });
    for (const data of [
      { text: 'HISTORY-CORRUPTED', model: 'gpt-4o' },
      { index: 0, text: 'HISTORY-CORRUPTED', model: 'gpt-4o' },
    ]) {
      const edited = await page.request.put(`/api/messages/${conversationId}/${historicalId}`, { headers, data });
      expect(edited.status()).toBe(409);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('a completed historical OCR without a human sidecar cannot bypass the generic edit guard', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const historicalId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: historicalId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: ocr,
      content: [{ type: 'text', text: ocr }],
      isCreatedByUser: false,
      sender: 'Assistant',
    }]);
    await withMongo(async (db) => {
      await db.collection('steel_delegate_ocr_runs').insertOne({
        conversationId,
        status: 'completed',
        responseGenerationId: 'previous-completed-ocr',
        finalizedCandidate: {
          targetMessageId: historicalId,
          generationId: 'previous-completed-ocr',
          markdown: ocr,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const runBefore = await withMongo((db) => db.collection('steel_delegate_ocr_runs').findOne({ conversationId }));
    const historical = await page.request.get(readUrl(conversationId, historicalId, 'ocr_result'), { headers });
    expect(historical.status()).toBe(200);
    expect(await historical.json()).toMatchObject({ table: { readOnly: true, isLatest: false } });
    expect(before.reviews).toHaveLength(0);
    for (const data of [
      { text: 'COMPLETED-HISTORY-MUST-NOT-BE-CHANGED', model: 'gpt-4o' },
      { index: 0, text: 'COMPLETED-HISTORY-MUST-NOT-BE-CHANGED', model: 'gpt-4o' },
    ]) {
      const edited = await page.request.put(`/api/messages/${conversationId}/${historicalId}`, { headers, data });
      expect(edited.status()).toBe(409);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      expect(await withMongo((db) => db.collection('steel_delegate_ocr_runs').findOne({ conversationId }))).toEqual(runBefore);
    }
  });

  test('failed OCR Save keeps the focused draft and retries through the real backend', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const commitUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    await page.route(commitUrl, (route) => route.abort('failed'));
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 /u });
    await quantity.fill('7');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(quantity).toHaveValue('7');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await quantity.press('Escape');
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(quantity).toHaveValue('7');
    await page.unroute(commitUrl);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect.poll(async () => {
      const snapshot = await persistedSnapshot(conversationId);
      return snapshot.messages[0]?.text;
    }).toContain('| A | REVIEW-P1 | 1000 | 7 | 1 |');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
  });

  test('discard after an uncommitted failed Save resolves without causing a DB write', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const commitUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    await page.route(commitUrl, (route) => route.abort('failed'));
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('7');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.unroute(commitUrl);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(quantity).toHaveValue('2');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a lost committed OCR Save response is reconciled without a second DB mutation', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const commitUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    let firstCommitted: Awaited<ReturnType<typeof persistedSnapshot>> | undefined;
    let commits = 0;
    await page.route(commitUrl, async (route) => {
      commits += 1;
      if (commits > 1) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      firstCommitted = await persistedSnapshot(conversationId);
      await route.abort('failed');
    });
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 /u });
    const oneUnsavedRow = dialog.getByText(/Unsaved.*1|1.*unsaved/i);
    await quantity.fill('7');
    await quantity.press('Enter');
    await expect(oneUnsavedRow).toBeVisible();
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect.poll(() => firstCommitted !== undefined).toBe(true);
    await expect.poll(async () =>
      await dialog.getByRole('alert').count() > 0 || await oneUnsavedRow.count() === 0,
    ).toBe(true);
    if (await dialog.getByRole('alert').count() > 0) {
      await dialog.getByRole('button', { name: /^Save/ }).click();
    }
    await expect(oneUnsavedRow).toHaveCount(0);
    await expect(quantity).toHaveValue('7');
    expect(await persistedSnapshot(conversationId)).toEqual(firstCommitted);
    await page.unroute(commitUrl);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(firstCommitted);
  });


  for (const merge of ['other_row', 'other_field', 'same_value'] as const) {
    test(`the OCR editor merges a same-output Save without losing current values: ${merge}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      await page.goto(`/c/${conversationId}`);
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Steel source review' });
      const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
      await quantity.fill('9');
      await quantity.press('Enter');
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      if (merge === 'other_row') rows[1].values['數量'].effective = '7';
      if (merge === 'other_field') rows[0].values['長度'].effective = '1234';
      if (merge === 'same_value') rows[0].values['數量'].effective = '9';
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      expect(prepare.status()).toBe(200);
      const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
      expect(commit.status()).toBe(200);
      const otherSaved = await persistedSnapshot(conversationId);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      const refreshed = page.waitForResponse((response) => response.request().method() === 'GET' &&
        response.url().includes(readUrl(conversationId, messageId, 'ocr_result')));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      expect((await refreshed).status()).toBe(200);
      await expect(quantity).toHaveValue('9');
      await expect(dialog.getByRole('button', { name: /^Save/ })).toBeEnabled();
      const requestReady = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`${url}/prepare`));
      await dialog.getByRole('button', { name: /^Save/ }).click();
      const submitted = (await requestReady).postDataJSON() as SteelReviewOperationPrepare;
      expect(submitted.revision).toBe(table.revision);
      expect(submitted.operations).toEqual([{ type: 'update', rowId: table.rows[0].rowId,
        changes: [{ header: '數量', value: '9' }] }]);
      expect(submitted).not.toHaveProperty('rows');
      await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
      const merged = await persistedSnapshot(conversationId);
      expect(merged.reviews[0]?.rows[0].values['數量']).toEqual({ baseline: '2', effective: '9' });
      if (merge === 'other_row') expect(merged.reviews[0]?.rows[1].values['數量'].effective).toBe('7');
      if (merge === 'other_field') expect(merged.reviews[0]?.rows[0].values['長度'].effective).toBe('1234');
      if (merge === 'same_value') expect(merged).toEqual(otherSaved);
      expect(merged.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
      if (merge !== 'same_value') expectPreservedAiState(otherSaved.ocr, merged.ocr);
      const clean = merge === 'other_row'
        ? ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 9 | 1 |')
          .replace('| A | REVIEW-P2 | 2000 | 3 | 1 |', '| A | REVIEW-P2 | 2000 | 7 | 1 |')
        : ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', `| A | REVIEW-P1 | ${merge === 'other_field' ? '1234' : '1000'} | 9 | 1 |`);
      expect(merged.messages.find((message) => message.messageId === messageId)?.text).toBe(clean);
      if (merge !== 'same_value') {
        await quantity.fill('10');
        await quantity.press('Enter');
        await expect(quantity).toHaveValue('9');
        if (merge === 'other_field') {
          await expect(dialog.locator('tbody tr').first().locator('td').nth(2).getByRole('textbox')).toHaveValue('1234');
        }
        expect(await persistedSnapshot(conversationId)).toEqual(merged);
        await expect(quantity).toHaveValue('10');
        await expect(quantity).toHaveValue('9');
      }
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      await expect(quantity).toHaveValue('9');
      expect(await persistedSnapshot(conversationId)).toEqual(merged);
    });
  }

  for (const change of ['disjoint', 'conflict'] as const) {
    test(`an OCR operation handles a real foreign Save between prepare and commit: ${change}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const commitUrl = `**${url}/commit`;
      let otherSaved: Awaited<ReturnType<typeof persistedSnapshot>> | undefined;
      let commitStatus: number | undefined;
      await page.route(commitUrl, async (route) => {
        const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
        expect(read.status()).toBe(200);
        const { table } = await read.json() as { table: SteelReviewTable };
        const rows = structuredClone(table.rows);
        rows[change === 'disjoint' ? 1 : 0].values['數量'].effective = '7';
        const foreignPrepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
        expect(foreignPrepare.status()).toBe(200);
        const foreignCommit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreignPrepare.json()) });
        expect(foreignCommit.status()).toBe(200);
        otherSaved = await persistedSnapshot(conversationId);
        const response = await route.fetch();
        commitStatus = response.status();
        await route.fulfill({ response });
      });
      try {
        await page.goto(`/c/${conversationId}`);
        await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Steel source review' });
        const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
        await quantity.fill('9');
        await dialog.getByRole('button', { name: /^Save/ }).click();
        await expect.poll(() => commitStatus).toBe(change === 'disjoint' ? 200 : 409);
        if (change === 'conflict') {
          await expect(dialog.getByRole('alert')).toBeVisible();
          await expect(quantity).toHaveValue('9');
          await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
          expect(await persistedSnapshot(conversationId)).toEqual(otherSaved);
        } else {
          await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
          const merged = await persistedSnapshot(conversationId);
          expect(merged.reviews[0]?.rows).toMatchObject([
            { values: { 數量: { baseline: '2', effective: '9' } } },
            { values: { 數量: { baseline: '3', effective: '7' } } },
          ]);
          expect(merged.messages.find((message) => message.messageId === messageId)?.text)
            .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 9 | 1 |')
              .replace('| A | REVIEW-P2 | 2000 | 3 | 1 |', '| A | REVIEW-P2 | 2000 | 7 | 1 |'));
          expect(merged.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
          await expect(dialog.locator('tbody tr').last().locator('td').nth(3).getByRole('textbox')).toHaveValue('7');
          expect(await persistedSnapshot(conversationId)).toEqual(merged);
        }
      } finally {
        await page.unroute(commitUrl);
      }
    });
  }

  test('a bare update based on a tombstone cannot adopt another editor restore', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const initial = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const { table } = await initial.json() as { table: SteelReviewTable };
    const identity = { conversationId, messageId, kind: 'ocr_result' as const, title: table.title, outputId: table.outputId, revision: table.revision };
    const deletion = await page.request.post(`${url}/prepare`, { headers, data: { ...identity,
      operations: [{ type: 'delete', rowId: table.rows[0].rowId }] } });
    expect(deletion.status()).toBe(200);
    const prepared = await deletion.json() as SteelReviewOperationPrepared;
    const deleted = await page.request.post(`${url}/commit`, { headers,
      data: { ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest } });
    expect(deleted.status()).toBe(200);
    const capturedDeleted = await deleted.json() as SteelReviewSaveResponse;
    const latest = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const current = (await latest.json() as { table: SteelReviewTable }).table;
    const rows = structuredClone(current.rows);
    rows[0].deleted = false;
    const foreignRestore = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(current, rows) });
    expect(foreignRestore.status()).toBe(200);
    const restored = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreignRestore.json()) });
    expect(restored.status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const base = { ...identity, revision: capturedDeleted.revision };
    const update = { type: 'update' as const, rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '8' }] };
    const rejected = await page.request.post(`${url}/prepare`, { headers, data: { ...base, operations: [update] } });
    expect(rejected.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const explicit = await page.request.post(`${url}/prepare`, { headers,
      data: { ...base, operations: [{ type: 'restore', rowId: table.rows[0].rowId }, update] } });
    expect(explicit.status()).toBe(200);
    const result = await explicit.json() as SteelReviewOperationPrepared;
    const saved = await page.request.post(`${url}/commit`, { headers,
      data: { ...result.operationRequest, operationId: result.operationId, digest: result.digest } });
    expect(saved.status()).toBe(200);
    expect((await persistedSnapshot(conversationId)).reviews[0]?.rows[0])
      .toMatchObject({ deleted: false, values: { 數量: { baseline: '2', effective: '8' } } });
  });

  for (const position of ['after', 'start', 'end'] as const) {
    test(`concurrent operation additions at the same anchor retain both identities and unique ordinals: ${position}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      const { table } = await read.json() as { table: SteelReviewTable };
      const identity = { conversationId, messageId, kind: 'ocr_result' as const, title: table.title, outputId: table.outputId, revision: table.revision };
      const rowIds = [randomUUID(), randomUUID()];
      const pending: SteelReviewOperationPrepared[] = [];
      for (const rowId of rowIds) {
        const response = await page.request.post(`${url}/prepare`, { headers, data: { ...identity,
          operations: [{ type: 'add', rowId, position: position === 'after' ? { kind: position, rowId: table.rows[1].rowId } : { kind: position },
            changes: [{ header: '零件編號', value: 'CONCURRENT-ADD' }, { header: '數量', value: '1' }] }] } });
        expect(response.status()).toBe(200);
        pending.push(await response.json() as SteelReviewOperationPrepared);
      }
      const bodies = pending.map((prepared) => ({ ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest }));
      const first = await page.request.post(`${url}/commit`, { headers, data: bodies[0] });
      expect(first.status()).toBe(200);
      const firstReceipt = await first.json();
      const second = await page.request.post(`${url}/commit`, { headers, data: bodies[1] });
      expect(second.status()).toBe(200);
      const merged = await persistedSnapshot(conversationId);
      const added = merged.reviews[0]?.rows.filter((row: SteelReviewTable['rows'][number]) => row.origin === 'manual');
      expect(added.map((row: SteelReviewTable['rows'][number]) => row.rowId)).toEqual(rowIds);
      expect(added.map((row: SteelReviewTable['rows'][number]) => row.insertion?.ordinal)).toEqual([0, 1]);
      const replay = await page.request.post(`${url}/commit`, { headers, data: bodies[0] });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual(firstReceipt);
      expect(await persistedSnapshot(conversationId)).toEqual(merged);
      expect(merged.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
    });
  }

  test('an operation delete conflicts with a changed row and a disjoint update preserves foreign deletion', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const { table } = await read.json() as { table: SteelReviewTable };
    const identity = { conversationId, messageId, kind: 'ocr_result' as const, title: table.title, outputId: table.outputId, revision: table.revision };
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...identity,
      operations: [{ type: 'delete', rowId: table.rows[0].rowId }] } });
    expect(prepare.status()).toBe(200);
    const pending = await prepare.json() as SteelReviewOperationPrepared;
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[1].deleted = true;
    const foreign = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(foreign.status()).toBe(200);
    const foreignSave = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreign.json()) });
    expect(foreignSave.status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const rejected = await page.request.post(`${url}/commit`, { headers,
      data: { ...pending.operationRequest, operationId: pending.operationId, digest: pending.digest } });
    expect(rejected.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const disjoint = await page.request.post(`${url}/prepare`, { headers, data: { ...identity,
      operations: [{ type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '長度', value: '1234' }] }] } });
    expect(disjoint.status()).toBe(200);
    const result = await disjoint.json() as SteelReviewOperationPrepared;
    const saved = await page.request.post(`${url}/commit`, { headers,
      data: { ...result.operationRequest, operationId: result.operationId, digest: result.digest } });
    expect(saved.status()).toBe(200);
    const merged = await persistedSnapshot(conversationId);
    expect(merged.reviews[0]?.rows).toMatchObject([
      { deleted: false, values: { 數量: { effective: '7' }, 長度: { effective: '1234' } } },
      { deleted: true },
    ]);
    expect(merged.messages.find((message) => message.messageId === messageId)?.text).not.toContain('REVIEW-P2');
    expect(merged.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  for (const action of ['save', 'edit'] as const) {
    test(`a conflicting same-field Save retains the dirty editor on reconnect: ${action}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      await page.goto(`/c/${conversationId}`);
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Steel source review' });
      const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
      await quantity.fill('9');
      await quantity.press('Enter');
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '7';
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      expect(prepare.status()).toBe(200);
      const commit = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await prepare.json()) });
      expect(commit.status()).toBe(200);
      const otherSaved = await persistedSnapshot(conversationId);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      const refreshed = page.waitForResponse((response) => response.request().method() === 'GET' &&
        response.url().includes(readUrl(conversationId, messageId, 'ocr_result')));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      expect((await refreshed).status()).toBe(200);
      await expect(quantity).toHaveValue('9');
      if (action === 'edit') {
        await dialog.locator('tbody tr').first().locator('td').nth(2).getByRole('textbox').fill('1234');
        await expect(quantity).toHaveValue('9');
      }
      await expect(dialog.getByRole('button', { name: /^Save/ })).toBeEnabled();
      await dialog.getByRole('button', { name: /^Save/ }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(quantity).toHaveValue('9');
      if (action === 'save') {
        const staleRows = structuredClone(table.rows);
        staleRows[0].values['數量'].effective = '9';
        const staleAttempt = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, staleRows) });
        expect(staleAttempt.status()).toBe(409);
        expect(await persistedSnapshot(conversationId)).toEqual(otherSaved);
        await expect(quantity).toHaveValue('9');
      }
      expect(await persistedSnapshot(conversationId)).toEqual(otherSaved);
      for (const close of ['escape', 'first_close', 'last_close', 'outside']) {
        if (close === 'escape') await page.keyboard.press('Escape');
        else if (close === 'outside') await page.mouse.click(1, 1);
        else await dialog.getByRole('button', { name: 'Close', exact: true }).nth(close === 'first_close' ? 0 : 1).click();
        await expect(dialog.getByRole('alertdialog')).toBeVisible();
        await dialog.getByRole('button', { name: 'Continue editing', exact: true }).click();
        await expect(quantity).toHaveValue('9');
        await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
        expect(await persistedSnapshot(conversationId)).toEqual(otherSaved);
      }
      await page.keyboard.press('Escape');
      await dialog.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(otherSaved);
    });
  }

  for (const check of ['caption', 'escape', 'first_close', 'last_close', 'outside'] as const) {
    test(`a superseded dirty OCR editor retains its caption and asks before closing: ${check}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      await page.goto(`/c/${conversationId}`);
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Steel source review' });
      const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
      await quantity.fill('6');
      await dialog.getByRole('button', { name: /^Save/ }).click();
      await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
      await quantity.fill('9');
      await quantity.press('Enter');
      const newMessageId = randomUUID();
      await seedMessages(getE2EUser().email, conversationId, [{
        messageId: newMessageId, parentMessageId: messageId, text: ocr,
        content: [{ type: 'text', text: ocr }], isCreatedByUser: false, sender: 'Assistant',
      }]);
      await withMongo(async (db) => {
        await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
          currentOcrResultMessageId: newMessageId, currentOcrResultGenerationId: 'review-superseding-generation',
          currentOcrResultMarkdown: ocr, updatedAt: new Date(),
        } });
      });
      const afterAI = await persistedSnapshot(conversationId);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      const refreshed = page.waitForResponse((response) => response.request().method() === 'GET' &&
        response.url().includes(readUrl(conversationId, messageId, 'ocr_result')));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      expect((await refreshed).status()).toBe(200);
      await expect(reviewValue(dialog, '9')).toBeVisible();
      if (check === 'caption') {
        await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
      }
      await expect(dialog.getByRole('button', { name: /^Save/ })).toBeDisabled();
      if (check === 'first_close' || check === 'last_close') {
        await dialog.getByRole('button', { name: 'Close', exact: true }).nth(check === 'first_close' ? 0 : 1).click();
      } else if (check === 'outside') {
        await page.mouse.click(1, 1);
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('alertdialog')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Save updates', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Continue editing', exact: true }).click();
      await expect(reviewValue(dialog, '9')).toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(afterAI);
      await page.keyboard.press('Escape');
      await dialog.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(afterAI);
    });
  }

  test('a failed receipt lookup can retry without committing an unsaved OCR draft', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const commitUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    let commits = 0;
    await page.route(commitUrl, async (route) => {
      commits += 1;
      await route.abort('failed');
    });
    let receiptCalls = 0;
    await page.route(/\/review\/ocr_result\/receipt\?/, async (route) => {
      receiptCalls += 1;
      if (receiptCalls === 1) await route.abort('failed');
      else await route.continue();
    });
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 / });
    await quantity.fill('7');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect.poll(() => receiptCalls).toBe(1);
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(reviewValue(dialog, '7')).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const retry = dialog.getByRole('button', { name: /Retry.*receipt|Retry.*lookup/i });
    if (await retry.count()) await retry.click();
    else await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(receiptCalls).toBe(2);
    expect(commits).toBe(1);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('commit conflicts preserve authoritative recovery after another Save between prepare and commit', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const { table } = await read.json() as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = { conversationId, messageId, kind: 'ocr_result',
      title: table.title, outputId: table.outputId, revision: table.revision,
      operations: [{ type: 'update', rowId: table.rows[0].rowId,
        changes: [{ header: '數量', value: '9' }] }] };
    const preview = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(preview.status()).toBe(200);
    const prepared = await preview.json() as SteelReviewOperationPrepared;
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[1].values['長度'].effective = '2345';
    const foreign = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(foreign.status()).toBe(200);
    expect((await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreign.json()) })).status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const latest = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const current = await latest.json() as { table: SteelReviewTable };
    const conflict = await page.request.post(`${url}/commit`, { headers, data: {
      ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest } });
    expect(conflict.status()).toBe(409);
    const body = await conflict.json() as SteelReviewErrorResponse;
    expect(body.code).toBe('REVIEW_CONFLICT');
    expect(body.recovery?.table).toMatchObject({ conversationId, messageId, title: table.title,
      outputId: table.outputId, revision: current.table.revision, isLatest: true, readOnly: false,
      headers: current.table.headers, rows: current.table.rows, effectiveMarkdown: current.table.effectiveMarkdown,
      aiRawMarkdown: current.table.aiRawMarkdown, aiBaselineMarkdown: current.table.aiBaselineMarkdown });
    expect(body.recovery?.table.title).toBe(current.table.title);
    expect(body.recovery?.table).not.toHaveProperty('partIndex');
    expect(body.recovery?.conflicts).toEqual([{ kind: 'field', rowId: table.rows[0].rowId,
      header: '數量', expected: '2', current: '7', requested: '9' }]);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('operation conflicts return all unequal fields and one authoritative latest Markdown without writes', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[0].values['長度'].effective = '1234';
    rows[1].values['數量'].effective = '8';
    const foreign = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(foreign.status()).toBe(200);
    const committed = await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreign.json()) });
    expect(committed.status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const current = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const latest = await current.json() as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = { conversationId, messageId, kind: 'ocr_result',
      title: table.title, outputId: table.outputId, revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [
          { header: '數量', value: '9' }, { header: '長度', value: '1234' },
        ] },
        { type: 'update', rowId: table.rows[1].rowId, changes: [{ header: '數量', value: '10' }] },
      ] };
    const conflict = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(conflict.status()).toBe(409);
    const body = await conflict.json();
    expect(body.code).toBe('REVIEW_CONFLICT');
    expect(body.recovery.table).toMatchObject({ conversationId, messageId, outputId: table.outputId,
      revision: latest.table.revision, effectiveMarkdown: latest.table.effectiveMarkdown,
      isLatest: true, readOnly: false });
    expect(body.recovery.table.rows).toEqual(latest.table.rows);
    expect(body.recovery.conflicts).toHaveLength(2);
    expect(body.recovery.conflicts).toEqual(expect.arrayContaining([
      { kind: 'field', rowId: table.rows[0].rowId, header: '數量', expected: '2', current: '7', requested: '9' },
      { kind: 'field', rowId: table.rows[1].rowId, header: '數量', expected: '3', current: '8', requested: '10' },
    ]));
    expect(body.recovery.conflicts.some((field: { header?: string }) => field.header === '長度')).toBe(false);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const retry = await page.request.post(`${url}/prepare`, { headers, data: { ...request,
      revision: body.recovery.table.revision } });
    expect(retry.status()).toBe(200);
    const prepared = await retry.json() as SteelReviewOperationPrepared;
    const saved = await page.request.post(`${url}/commit`, { headers, data: {
      ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest } });
    expect(saved.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.rows).toMatchObject([
      { values: { 數量: { baseline: '2', effective: '9' }, 長度: { baseline: '1000', effective: '1234' } } },
      { values: { 數量: { baseline: '3', effective: '10' } } },
    ]);
    expect(after.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  test('all requested values already equal latest automatically remove conflict without DB writes', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[1].values['數量'].effective = '8';
    const foreign = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(foreign.status()).toBe(200);
    expect((await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreign.json()) })).status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const request: SteelReviewOperationPrepare = { conversationId, messageId, kind: 'ocr_result',
      title: table.title, outputId: table.outputId, revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '7' }] },
        { type: 'update', rowId: table.rows[1].rowId, changes: [{ header: '數量', value: '8' }] },
      ] };
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const saved = await page.request.post(`${url}/commit`, { headers, data: {
      ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest } });
    expect(saved.status()).toBe(200);
    expect((await saved.json()).changedRows).toBe(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('conflict recovery marks file and page then retries its latest revision preserving foreign fields', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 /u });
    await quantity.fill('9');
    await quantity.press('Enter');
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[0].values['長度'].effective = '1234';
    const foreign = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
    expect(foreign.status()).toBe(200);
    expect((await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreign.json()) })).status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const failedResponse = page.waitForResponse((response) => response.request().method() === 'POST' &&
      response.url().endsWith(`${url}/prepare`));
    await dialog.getByRole('button', { name: /^Save/ }).click();
    const conflict = await failedResponse;
    expect(conflict.status()).toBe(409);
    const body = await conflict.json();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(quantity).toHaveValue('9');
    await expect(dialog.locator('tbody tr').first().getByRole('textbox', { name: /^長度 /u })).toHaveValue('1234');
    await expect(dialog.getByRole('img', { name: /Conflicts on this file/i }).first()).toBeVisible();
    await expect(dialog.getByRole('img', { name: /Conflicts on this page/i }).first()).toBeVisible();
    const fileMenu = dialog.getByRole('combobox', { name: 'Source file', exact: true });
    await fileMenu.click();
    await expect(page.getByRole('option', { name: /alpha.pdf/ }).getByRole('img', { name: /Conflicts on this file/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    const pageMenu = dialog.getByRole('combobox', { name: 'Page', exact: true });
    await pageMenu.click();
    await expect(page.getByRole('option', { name: /^1\b/ }).getByRole('img', { name: /Conflicts on this page/i })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const retryRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`${url}/prepare`));
    await dialog.getByRole('button', { name: /^Save/ }).click();
    const request = (await retryRequest).postDataJSON() as SteelReviewOperationPrepare;
    expect(request.revision).toBe(body.recovery.table.revision);
    expect(request.revision).not.toBe(table.revision);
    expect(request.operations).toEqual([{ type: 'update', rowId: table.rows[0].rowId,
      changes: [{ header: '數量', value: '9' }] }]);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await expect(dialog.getByRole('img', { name: /Conflicts on this (file|page)/i })).toHaveCount(0);
    const after = await persistedSnapshot(conversationId);
    expect(after.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1234 | 9 | 1 |'));
    expect(after.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(quantity).toHaveValue('9');
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('a Save racing after conflict recovery returns a newer conflict instead of overwriting', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
    const { table } = await read.json() as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = { conversationId, messageId, kind: 'ocr_result',
      title: table.title, outputId: table.outputId, revision: table.revision,
      operations: [{ type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '9' }] }] };
    let expectedRevision = table.revision;
    for (const value of ['7', '8']) {
      const current = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      const latest = await current.json() as { table: SteelReviewTable };
      const rows = structuredClone(latest.table.rows);
      rows[0].values['數量'].effective = value;
      const foreign = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(latest.table, rows) });
      expect(foreign.status()).toBe(200);
      expect((await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreign.json()) })).status()).toBe(200);
      const before = await persistedSnapshot(conversationId);
      const failed = await page.request.post(`${url}/prepare`, { headers, data: { ...request, revision: expectedRevision } });
      expect(failed.status()).toBe(409);
      const body = await failed.json();
      expect(body.recovery.conflicts).toEqual([{ kind: 'field', rowId: table.rows[0].rowId,
        header: '數量', expected: value === '7' ? '2' : '7', current: value, requested: '9' }]);
      expect(body.recovery.table.revision).not.toBe(expectedRevision);
      expect(body.recovery.table.rows[0].values['數量'].effective).toBe(value);
      expectedRevision = body.recovery.table.revision;
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  for (const location of ['located', 'unlocated'] as const) {
    test(`using the latest conflicted value preserves other local changes: ${location}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      if (location === 'unlocated') {
        await withMongo(async (db) => {
          await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: { sourceMappings: [] } });
        });
      }
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      await page.goto(`/c/${conversationId}`);
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Steel source review' });
      const rowsUi = dialog.locator('tbody tr');
      const quantity = rowsUi.first().locator('td').nth(3).getByRole('textbox');
      const otherQuantity = rowsUi.last().locator('td').nth(3).getByRole('textbox');
      await quantity.fill('9');
      await quantity.press('Enter');
      await otherQuantity.fill('10');
      await otherQuantity.press('Enter');
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '7';
      rows[0].values['長度'].effective = '1234';
      const foreign = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
      expect(foreign.status()).toBe(200);
      expect((await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreign.json()) })).status()).toBe(200);
      const before = await persistedSnapshot(conversationId);
      const failed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`${url}/prepare`));
      await dialog.getByRole('button', { name: /^Save/ }).click();
      const response = await failed;
      expect(response.status()).toBe(409);
      const body = await response.json();
      if (location === 'unlocated') {
        await expect(dialog.getByRole('img', { name: /Conflicts in unlocated rows/i })).toBeVisible();
      }
      await dialog.getByRole('button', { name: /Use latest value/i }).first().click();
      await expect(quantity).toHaveValue('7');
      await expect(otherQuantity).toHaveValue('10');
      await expect(rowsUi.first().locator('td').nth(2).getByRole('textbox')).toHaveValue('1234');
      await expect(dialog.getByRole('button', { name: /Use latest value/i })).toHaveCount(0);
      await expect(dialog.getByRole('img', { name: /Conflicts (on this|in unlocated)/i })).toHaveCount(0);
      await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      const nextRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`${url}/prepare`));
      await dialog.getByRole('button', { name: /^Save/ }).click();
      const request = (await nextRequest).postDataJSON() as SteelReviewOperationPrepare;
      expect(request.revision).toBe(body.recovery.table.revision);
      expect(request.operations).toEqual([{ type: 'update', rowId: table.rows[1].rowId,
        changes: [{ header: '數量', value: '10' }] }]);
      await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
      const after = await persistedSnapshot(conversationId);
      expect(after.reviews[0]?.rows).toMatchObject([
        { values: { 數量: { baseline: '2', effective: '7' }, 長度: { effective: '1234' } } },
        { values: { 數量: { baseline: '3', effective: '10' } } },
      ]);
      expect(after.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
      if (location === 'unlocated') expect(after.reviews[0]?.rows.every((row: SteelReviewTable['rows'][number]) => row.source === null)).toBe(true);
    });
  }

  for (const publication of ['foreign_save', 'new_ai', 'outside_section'] as const) {
    test(`a delayed committed response cannot rewind current chat or cache: ${publication}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const commitUrl = `**${url}/commit`;
      let releaseResponse: (() => void) | undefined;
      const held = new Promise<void>((resolve) => { releaseResponse = resolve; });
      let committed = false;
      await page.route(commitUrl, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed = true;
        await held;
        await route.fulfill({ response });
      });
      try {
        await page.goto(`/c/${conversationId}`);
        await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Steel source review' });
        const quantity = dialog.locator('tbody tr').first().getByRole('textbox', { name: /^數量 / });
        await quantity.fill('9');
        await quantity.press('Enter');
        await dialog.getByRole('button', { name: /^Save/ }).click();
        await expect.poll(() => committed).toBe(true);
        if (publication === 'foreign_save') {
          const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
          const { table } = await read.json() as { table: SteelReviewTable };
          const rows = structuredClone(table.rows);
          rows[0].values['長度'].effective = '1234';
          const foreign = await page.request.post(`${url}/prepare`, { headers, data: requestForRows(table, rows) });
          expect(foreign.status()).toBe(200);
          expect((await page.request.post(`${url}/commit`, { headers, data: operationCommit(await foreign.json()) })).status()).toBe(200);
        } else if (publication === 'outside_section') {
          await withMongo(async (db) => {
            const current = await db.collection('messages').findOne({ conversationId, messageId });
            if (!current || typeof current.text !== 'string') throw new Error('Missing committed prefix fixture');
            const latestText = `LATER-UNMANAGED-PREFIX\n\n${current.text}`;
            await db.collection('messages').updateOne({ conversationId, messageId }, {
              $set: { text: latestText, content: [{ type: 'text', text: latestText }], updatedAt: new Date() },
            });
          });
        } else {
          const newAi = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 4 | 1 |');
          await withMongo(async (db) => {
            await db.collection('messages').updateOne({ conversationId, messageId }, {
              $set: { text: newAi, content: [{ type: 'text', text: newAi }] },
              $unset: { 'metadata.steelReview.ocr_result': '' },
            });
            await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
              currentOcrResultGenerationId: 'review-delayed-response-new-ai',
              currentOcrResultAttemptId: 'review-delayed-response-new-attempt',
              currentOcrResultMarkdown: newAi, updatedAt: new Date(),
            } });
          });
        }
        const latest = await persistedSnapshot(conversationId);
        releaseResponse?.();
        await expect(dialog.getByRole('button', { name: /^Save/ })).not.toHaveAttribute('aria-busy', 'true');
        expect(await persistedSnapshot(conversationId)).toEqual(latest);
        if (publication !== 'new_ai') {
          await expect(quantity).toHaveValue('9');
          if (publication === 'foreign_save') await expect(dialog.locator('tbody tr').first().getByRole('textbox', { name: /^長度 / })).toHaveValue('1234');
          await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
        } else {
          await expect(dialog.getByRole('button', { name: 'Add row', exact: true })).toHaveCount(0);
          await expect(dialog.getByRole('textbox')).toHaveCount(0);
          await expect(dialog.getByRole('button', { name: /^Save/ })).toBeDisabled();
        }
        const live = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), { headers });
        const { table } = await live.json() as { table: SteelReviewTable };
        expect(table.rows[0].values['數量'].effective).toBe(publication === 'new_ai' ? '4' : '9');
        if (publication === 'foreign_save') expect(table.rows[0].values['長度'].effective).toBe('1234');
        const chatRow = page.getByTestId('message-body').locator('tbody tr')
          .filter({ has: page.getByText('REVIEW-P1', { exact: true }) }).first();
        await expect(chatRow.locator('td').nth(3)).toHaveText(publication === 'new_ai' ? '4' : '9');
        if (publication === 'foreign_save') await expect(chatRow.locator('td').nth(2)).toHaveText('1234');
        await expect(chatRow.locator('del')).toHaveCount(0);
        if (publication === 'outside_section') {
          await expect(page.getByTestId('message-body').getByText('LATER-UNMANAGED-PREFIX', { exact: true })).toBeVisible();
        }
        await page.reload();
        await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
        const reopened = page.getByRole('dialog', { name: 'Steel source review' });
        await expect(reopened.locator('tbody tr').first().getByRole('textbox', { name: /^數量 / }))
          .toHaveValue(publication === 'new_ai' ? '4' : '9');
        if (publication === 'new_ai') {
          await expect(reopened.locator('del', { hasText: '9' })).toHaveCount(0);
        }
        expect(await persistedSnapshot(conversationId)).toEqual(latest);
      } finally {
        releaseResponse?.();
        await page.unroute(commitUrl);
      }
    });
  }

});
