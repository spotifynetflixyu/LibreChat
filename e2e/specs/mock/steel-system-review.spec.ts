import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createModels, createMethods } from '@librechat/data-schemas';
import { steelReviewRecoverySchema } from 'librechat-data-provider';
import {
  createSteelQuotationStateService,
  publishCompletedQuotation,
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
const ocr = '## ocr_result\n\n| 零件編號 | 數量 |\n| --- | --- |\n| SOURCE-A | 2 |';
const oldQuote = '## customer_quote｜歷史保留\n\n| 項目 | 小計 |\n| --- | --- |\n| OLD-KEEP | 456 |';
const fullMessage = `SYSTEM-PREFIX\n\n${order}\n\n${oldQuote}\n\nSYSTEM-SUFFIX`;

async function seedOrder(withHistoricalQuote = true) {
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const otherMessageId = randomUUID();
  const email = getE2EUser().email;
  const messageText = withHistoricalQuote ? fullMessage : `SYSTEM-PREFIX\n\n${order}\n\nSYSTEM-SUFFIX`;
  await seedConversations(email, [{ conversationId, title: 'System order real Save proof', updatedAt: new Date() }]);
  await seedMessages(email, conversationId, [...(withHistoricalQuote ? [{ messageId, parentMessageId: '00000000-0000-0000-0000-000000000000',
    text: messageText, content: [{ type: 'text', text: messageText }], isCreatedByUser: false, sender: 'Assistant' }] : []),
  { messageId: otherMessageId, parentMessageId: messageId, text: order, content: [{ type: 'text', text: order }],
    isCreatedByUser: false, sender: 'Assistant' }]);
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
    const customerMarkdown = renderQuotationCustomerMarkdown({ tier: 'B' });
    const current = await service.setOrder({ scope, fullMarkdown: ocr });
    await service.saveCustomer({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'quote-user', responseId: randomUUID(),
      selectionProvenance: { method: 'default_tier', selectionMessageId: 'quote-user' },
      orderHash: current.currentOrder!.sha256 });
    const ticket = await service.issueTicket({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'quote-user', selectionProvenance: { method: 'default_tier', selectionMessageId: 'quote-user' } });
    const run = await service.acceptSignal({ scope, index: ticket.index, token: ticket.token,
      orderHash: ticket.orderHash, customerMarkdown, customerIdentity: ticket.customerIdentity,
      prompts: { child: 'bounded child', main: 'bounded main' }, chunks: [{ index: 1, sourceRowCount: 1 }], targetMessageId: messageId });
    const lease = await service.acquireLease({ scope, runId: run.runId, leaseToken: randomUUID() });
    if (!lease) throw new Error('Missing fixture lease');
    await service.checkpoint({ scope, runId: run.runId, leaseToken: lease.leaseToken, operationId: 'final', kind: 'final', payload: order });
    const ref = (await service.readState(scope))?.activeRun?.checkpointRefs.find((entry) => entry.operationId === 'final');
    if (!ref) throw new Error('Missing normal final checkpoint');
    const completed = await service.completeRun({ scope, runId: run.runId, leaseToken: lease.leaseToken,
      finalRef: { ...scope, runId: run.runId, ...ref, kind: 'final' } });
    if (!completed) throw new Error('Missing completed quotation run');
    await publishCompletedQuotation({ scope, run: completed, markdown: order, service,
      publishFinal: async ({ markdown }) => {
        if (withHistoricalQuote) return;
        const text = `SYSTEM-PREFIX\n\n${markdown}\n\nSYSTEM-SUFFIX`;
        createModels(db);
        const saved = await createMethods(db).saveMessage({ userId }, {
          messageId, conversationId, parentMessageId: '00000000-0000-0000-0000-000000000000',
          text, content: [{ type: 'text', text }], isCreatedByUser: false, sender: 'Assistant',
        }, { context: 'steel-review-e2e-publication' });
        if (!saved) throw new Error('Missing published quotation message');
      } });
    return { conversationId, messageId, otherMessageId, runId: run.runId };
  } finally {
    await db.disconnect();
  }
}

function reviewUrl(conversationId: string) {
  return `/api/steel/conversations/${conversationId}/review/system_order`;
}

async function readTable(page: Page, headers: { Authorization: string }, conversationId: string, messageId: string) {
  const response = await page.request.get(`${reviewUrl(conversationId)}?${new URLSearchParams({ messageId, title })}`, { headers });
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
  await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Steel source review' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function materialRow(dialog: Locator) {
  return dialog.locator('tbody tr').filter({ hasText: 'REVIEW-MATERIAL-A' });
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
      for (const collection of ['steel_review_outputs', 'steel_quotation_states', 'steel_quotation_artifacts', 'steel_conversation_ocr_state']) {
        await db.collection(collection).deleteMany({ conversationId: { $in: ids } });
      }
    });
    await deleteConversations(ids);
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
    expect(recovery.table.revision).toBe(before.quotation?.currentSystemOrder.sha256);
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
