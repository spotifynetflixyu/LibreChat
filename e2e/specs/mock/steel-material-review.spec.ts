import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createModels, createMethods } from '@librechat/data-schemas';
import {
  buildQuotationChunks,
  runQuotationPreflight,
  renderQuotationCustomerMarkdown,
  createSteelQuotationStateService,
  quotationChildSystemOrderColumns,
} from '@librechat/api';
import type { ISteelQuotationState, ISteelReviewOutput, IMessage } from '@librechat/data-schemas';
import type { SteelReviewTable, SteelReviewOperationPrepare, SteelReviewOperationPrepared, SteelReviewSaveResponse } from 'librechat-data-provider';
import type { Page, Locator } from '@playwright/test';
import { deleteConversations, deleteMessagesByConversation, seedConversations, withMongo } from './db';
import { getE2EUser } from '../../setup/user';
import { getAccessToken } from './helpers';

type Mode = 'plate' | 'profile' | 'unknown';
type Auth = { Authorization: string };
type Fixture = { conversationId: string; messageId: string; runId: string; lookups: number };

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

/** A normal runner/lookup/checkpoint/publication produces the review authority. */
async function seedCalculation(mode: Mode = 'plate', notes = ''): Promise<Fixture> {
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const email = getE2EUser().email;
  await seedConversations(email, [{ conversationId, title: 'Material calculation review', updatedAt: new Date() }]);
  const userId = await withMongo(async (database) => {
    const user = await database.collection('users').findOne({ email });
    if (!user) throw new Error('Missing authenticated fixture owner');
    return String(user._id);
  });
  const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
  await mongoose.connect(runtime.MONGO_URI);
  try {
    const scope = { userId, conversationId };
    const service = createSteelQuotationStateService(mongoose);
    const category = mode === 'profile' ? 'H型鋼' : '鐵板';
    const code = { plate: 'PLATE', profile: 'PROFILE', unknown: 'UNKNOWN' }[mode];
    const sourceRows = ['A', 'B'].map((part) => ['', part, category, '2', '6', '100', '200']);
    const order = `## ocr_result\n\n${table(['來源', '零件編號', '類別', '數量', '厚度', '寬度', '長度'], sourceRows)}`;
    const state = await service.setOrder({ scope, fullMarkdown: order });
    const customerMarkdown = renderQuotationCustomerMarkdown({ tier: 'B' });
    await service.saveCustomer({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'material-user', responseId: messageId,
      selectionProvenance: { method: 'default_tier', selectionMessageId: 'material-user' },
      orderHash: state.currentOrder!.sha256 });
    const ticket = await service.issueTicket({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'material-user',
      selectionProvenance: { method: 'default_tier', selectionMessageId: 'material-user' } });
    const chunks = buildQuotationChunks(order);
    const run = await service.acceptSignal({ scope, index: ticket.index, token: ticket.token,
      orderHash: ticket.orderHash, customerMarkdown, customerIdentity: ticket.customerIdentity,
      prompts: { child: 'material fixture child', main: 'material fixture review' },
      chunks: chunks.map((chunk) => ({ index: chunk.chunkIndex, sourceRowCount: chunk.sourceRows.length })),
      targetMessageId: messageId });
    createModels(mongoose);
    const methods = createMethods(mongoose);
    let lookups = 0;
    const candidate = {
      id: { plate: 1, profile: 2, unknown: 3 }[mode], erpItemCode: code, productName: `REVIEW-${code}`, category,
      material: 'M1', unit: mode === 'unknown' ? 'pc' : 'kg', quoteEligible: true,
      ...(mode === 'plate' ? { density: 7.85, exactPhysical: { density: '7.85' } } : {}),
      ...(mode === 'profile' ? { unitWeightValue: 1, lengthMm: 3,
        unitWeightBasis: 'kg_per_piece_or_stock_length', exactPhysical: { unitWeightValue: '1', lengthMm: '3' } } : {}),
      tierPrices: { A: 11, B: 10, C: 9, D: 8, E: 7, F: 6 },
    };
    const result = await runQuotationPreflight({ scope,
      modelOptions: { model: 'external-fixture-model' }, signal: new AbortController().signal,
      executeLookup: async () => {
        lookups += 1;
        return { ok: true, toolName: 'search_price_candidates',
          data: { queryResults: [{ queryId: 'q1', status: 'ok', candidates: [candidate] }] },
          durationMs: 1, redactionVersion: 1 };
      },
      invokeModel: async (input) => {
        if (input.role === 'main') return { markdown: '無待複核事項。', lookups: [], pythonEvidence: [] };
        if (!input.lookup) throw new Error('Missing real runner lookup seam');
        await input.lookup('material-lookup', { queries: [{ queryId: 'q1', categories: [category] }] });
        return { markdown: `## system_order_chunk\n\n${table(quotationChildSystemOrderColumns,
          ['A', 'B'].map((part) => [code, `REVIEW-${code}-${part}`, 'M1', mode === 'unknown' ? 'pc' : 'kg',
            '2', '1', mode === 'unknown' ? '3' : '2', '10', '2', '', '6', '100', '200', '', category, part, notes]))}`,
        lookups: [], pythonEvidence: [] };
      },
      publishFinal: (publication) => {
        const text = `MATERIAL-PREFIX\n\n${publication.markdown}\n\nMATERIAL-SUFFIX`;
        return methods.saveSteelQuotationMessage({ ...publication,
          message: { user: userId, messageId, conversationId,
            parentMessageId: '00000000-0000-0000-0000-000000000000',
            text, content: [{ type: 'text', text }], isCreatedByUser: false, sender: 'Assistant' } });
      },
    });
    expect(result.status).toBe('completed');
    expect(lookups).toBe(1);
    return { conversationId, messageId, runId: run.runId, lookups };
  } finally {
    await mongoose.disconnect();
  }
}

function reviewUrl(conversationId: string): string {
  return `/api/steel/conversations/${conversationId}/review/system_order`;
}

async function readTable(page: Page, auth: Auth, fixture: Fixture): Promise<SteelReviewTable> {
  const response = await page.request.get(`${reviewUrl(fixture.conversationId)}?${new URLSearchParams({
    messageId: fixture.messageId, title: 'system_order' })}`, { headers: auth });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json() as { table: SteelReviewTable }).table;
}

function requestFor(owner: SteelReviewTable, changes: Array<{ header: string; value: string }>): SteelReviewOperationPrepare {
  return { conversationId: owner.conversationId, messageId: owner.messageId, kind: owner.kind,
    title: owner.title, outputId: owner.outputId, revision: owner.revision,
    operations: [{ type: 'update', rowId: owner.rows[0].rowId, changes }] };
}

async function prepare(page: Page, auth: Auth, input: SteelReviewOperationPrepare): Promise<SteelReviewOperationPrepared> {
  const response = await page.request.post(`${reviewUrl(input.conversationId)}/prepare`, { headers: auth, data: input });
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<SteelReviewOperationPrepared>;
}

async function commit(page: Page, auth: Auth, prepared: SteelReviewOperationPrepared) {
  return page.request.post(`${reviewUrl(prepared.conversationId)}/commit`, { headers: auth,
    data: { ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest } });
}

async function saveApi(page: Page, auth: Auth, input: SteelReviewOperationPrepare): Promise<SteelReviewSaveResponse> {
  const prepared = await prepare(page, auth, input);
  const response = await commit(page, auth, prepared);
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<SteelReviewSaveResponse>;
}

async function readback(fixture: Fixture) {
  return withMongo(async (database) => ({
    messages: await database.collection<Pick<IMessage, 'messageId' | 'text' | 'content' | 'metadata'>>('messages')
      .find({ conversationId: fixture.conversationId }).toArray(),
    reviews: await database.collection<ISteelReviewOutput>('steel_review_outputs')
      .find({ conversationId: fixture.conversationId }).toArray(),
    quotation: await database.collection<ISteelQuotationState>('steel_quotation_states')
      .findOne({ conversationId: fixture.conversationId }),
    artifacts: await database.collection('steel_quotation_artifacts').find({ conversationId: fixture.conversationId })
      .sort({ operationId: 1 }).toArray(),
  }));
}

async function openEditor(page: Page, fixture: Fixture): Promise<Locator> {
  await page.goto(`/c/${fixture.conversationId}`);
  await expect(page.getByText('MATERIAL-SUFFIX', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Steel source review' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function saveUi(page: Page, dialog: Locator): Promise<SteelReviewSaveResponse> {
  const responseReady = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/review/system_order/commit'));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await responseReady;
  expect(response.status(), await response.text()).toBe(200);
  const saved = await response.json() as SteelReviewSaveResponse;
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  return saved;
}

function effective(owner: Pick<SteelReviewTable, 'rows'>, header: string): string | null {
  return owner.rows[0].values[header].effective;
}

test.describe('Material review capable automatic calculation', () => {
  const fixtures: Fixture[] = [];
  let auth: Auth;
  test.beforeEach(async ({ page }) => {
    await page.goto('/c/new');
    auth = { Authorization: `Bearer ${await getAccessToken(page)}` };
  });
  test.afterEach(async () => {
    const ids = fixtures.splice(0).map((fixture) => fixture.conversationId);
    await deleteMessagesByConversation(ids);
    await withMongo(async (database) => {
      for (const collection of ['steel_review_outputs', 'steel_quotation_states', 'steel_quotation_artifacts']) {
        await database.collection(collection).deleteMany({ conversationId: { $in: ids } });
      }
    });
    await deleteConversations(ids);
  });

  test('all material business inputs save without automatically changing unsupported quantities', async ({ page }) => {
    const fixture = await seedCalculation('unknown'); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    for (const header of initial.headers) {
      await expect(dialog.getByRole('textbox', { name: `${header} ${initial.rows[0].rowId}`, exact: true })).toBeEditable();
    }
    const updates = { '型號': 'MANUAL-CODE', '品名規格': 'MANUAL-NAME', '材質編號': 'M2', '單位': 'M',
      '數量': '5', '單重': '7', '總數': '11', '單價': '12', '計價基準': '3', '公式編號': 'MANUAL-FORMULA',
      '厚度': '2.54', '寬度': '125', '長度': '1000', '肚': '4', '類別': 'MANUAL-CATEGORY', '備註': 'MANUAL-NOTES' };
    for (const [header, value] of Object.entries(updates)) {
      await dialog.getByRole('textbox', { name: `${header} ${initial.rows[0].rowId}`, exact: true }).fill(value);
    }
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    for (const [header, value] of Object.entries(updates)) expect(effective(saved, header)).toBe(value);
    expect(saved.rows[0].system).toEqual(initial.rows[0].system);
    const after = await readback(fixture);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 162 |');
    expect(after.artifacts).toEqual(before.artifacts);
    await page.keyboard.press('Escape'); await page.reload();
    await expect(page.locator('del')).toHaveCount(0);
    const reopened = await readTable(page, auth, fixture);
    for (const [header, value] of Object.entries(updates)) expect(effective(reopened, header)).toBe(value);
    expect(await readback(fixture)).toEqual(after);
  });

  test('exact converted material dimensions calculate from current inputs rather than original notes', async ({ page }) => {
    const fixture = await seedCalculation('plate', '原厚度 99 mm'); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('textbox', { name: `厚度 ${initial.rows[0].rowId}`, exact: true }).fill('0.1 inch');
    const saved = await saveUi(page, dialog);
    expect(effective(saved, '厚度')).toBe('2.54');
    expect(effective(saved, '單重')).toBe('0.39878');
    expect(effective(saved, '總數')).toBe('0.79756');
    expect(effective(saved, '備註')).toBe(effective(initial, '備註'));
    expect(saved.rows[1]).toMatchObject({ rowId: initial.rows[1].rowId, values: initial.rows[1].values,
      source: initial.rows[1].source, system: initial.rows[1].system });
    const after = await readback(fixture);
    expect(after.reviews[0].rows[0].values['厚度'].effective).toBe('2.54');
    expect(after.quotation?.currentSystemOrder.markdown).toContain('| 2.54 | 100 | 200 |');
    expect(after.messages[0].text).not.toContain('~~');
    await page.keyboard.press('Escape'); await page.reload();
    expect(effective(await readTable(page, auth, fixture), '總數')).toBe('0.79756');
    expect(await readback(fixture)).toEqual(after);
  });

  test('quantity preserves manual unit weight across save and reload without another lookup', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const manuallyWeighted = await saveApi(page, auth, requestFor(initial, [{ header: '單重', value: '0.123456789' }]));
    expect(effective(manuallyWeighted, '單重')).toBe('0.123456789');
    expect(effective(manuallyWeighted, '總數')).toBe('0.246913578');
    const before = await readback(fixture);
    const current = await readTable(page, auth, fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('textbox', { name: `數量 ${current.rows[0].rowId}`, exact: true }).fill('3');
    const saved = await saveUi(page, dialog);
    expect(effective(saved, '單重')).toBe('0.123456789');
    expect(effective(saved, '總數')).toBe('0.370370367');
    const after = await readback(fixture);
    expect(after.artifacts).toEqual(before.artifacts);
    expect(fixture.lookups).toBe(1);
    await page.keyboard.press('Escape'); await page.reload();
    expect(effective(await readTable(page, auth, fixture), '單重')).toBe('0.123456789');
    expect(await readback(fixture)).toEqual(after);
  });

  test('last explicit manual total equal to the saved value wins after a changed dependency', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('textbox', { name: `數量 ${initial.rows[0].rowId}`, exact: true }).fill('3');
    const total = dialog.getByRole('textbox', { name: `總數 ${initial.rows[0].rowId}`, exact: true });
    await total.fill('99'); await total.fill(effective(initial, '總數') ?? ''); await total.press('Enter');
    const saved = await saveUi(page, dialog);
    expect(effective(saved, '數量')).toBe('3');
    expect(effective(saved, '總數')).toBe(effective(initial, '總數'));
    const repriced = await saveApi(page, auth, requestFor(await readTable(page, auth, fixture), [{ header: '單價', value: '11' }]));
    expect(effective(repriced, '總數')).toBe(effective(initial, '總數'));
    const requantified = await saveApi(page, auth, requestFor(await readTable(page, auth, fixture), [{ header: '數量', value: '4' }]));
    expect(effective(requantified, '總數')).toBe('3.768');
  });

  test('missing dimension saves the explicit blank and preserves uncomputable results', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('textbox', { name: `長度 ${initial.rows[0].rowId}`, exact: true }).fill('');
    const saved = await saveUi(page, dialog);
    expect(effective(saved, '長度')).toBe('');
    expect(effective(saved, '單重')).toBe(effective(initial, '單重'));
    expect(effective(saved, '總數')).toBe(effective(initial, '總數'));
    const after = await readback(fixture);
    await page.keyboard.press('Escape'); await page.reload();
    expect(effective(await readTable(page, auth, fixture), '長度')).toBe('');
    expect(await readback(fixture)).toEqual(after);
  });

  test('zero remains a computable material value distinct from a blank input', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const saved = await saveApi(page, auth, requestFor(initial, [{ header: '數量', value: '0' }]));
    expect(effective(saved, '數量')).toBe('0'); expect(effective(saved, '總數')).toBe('0');
    expect(effective(saved, '單重')).toBe(effective(initial, '單重'));
    const blank = await saveApi(page, auth, requestFor(await readTable(page, auth, fixture), [{ header: '數量', value: '' }]));
    expect(effective(blank, '數量')).toBe(''); expect(effective(blank, '總數')).toBe('0');
  });

  test('a repeating stock-length result does not replace saved material weight or total', async ({ page }) => {
    const fixture = await seedCalculation('profile'); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const saved = await saveApi(page, auth, requestFor(initial, [{ header: '長度', value: '1' }]));
    expect(effective(saved, '長度')).toBe('1');
    expect(effective(saved, '單重')).toBe(effective(initial, '單重'));
    expect(effective(saved, '總數')).toBe(effective(initial, '總數'));
  });

  test('nonoverlapping dimensions merge against latest material inputs between prepare and commit', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const local = await prepare(page, auth, requestFor(initial, [{ header: '寬度', value: '125' }]));
    await saveApi(page, auth, requestFor(initial, [{ header: '長度', value: '250' }]));
    const response = await commit(page, auth, local);
    expect(response.status(), await response.text()).toBe(200);
    const saved = await response.json() as SteelReviewSaveResponse;
    expect(effective(saved, '寬度')).toBe('125'); expect(effective(saved, '長度')).toBe('250');
    expect(effective(saved, '單重')).toBe('1.471875'); expect(effective(saved, '總數')).toBe('2.94375');
    const after = await readback(fixture);
    await openEditor(page, fixture); await page.keyboard.press('Escape'); await page.reload();
    expect(effective(await readTable(page, auth, fixture), '總數')).toBe('2.94375');
    expect(await readback(fixture)).toEqual(after);
  });

  test('a concurrent manual total is not overwritten by stale quantity derivation', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const local = await prepare(page, auth, requestFor(initial, [{ header: '數量', value: '3' }]));
    await saveApi(page, auth, requestFor(initial, [{ header: '總數', value: '77' }]));
    const before = await readback(fixture);
    const response = await commit(page, auth, local);
    expect(response.status()).toBe(409);
    const failure = await response.json() as { recovery: { conflicts: Array<{ kind: string; header?: string }> } };
    expect(failure.recovery.conflicts).toContainEqual(expect.objectContaining({ kind: 'field', header: '總數' }));
    expect(await readback(fixture)).toEqual(before);
  });

  test('a same-text concurrent manual total preserves its provenance against stale derivation', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const local = await prepare(page, auth, requestFor(initial, [{ header: '寬度', value: '125' }]));
    await saveApi(page, auth, requestFor(initial, [{ header: '數量', value: '4' },
      { header: '總數', value: effective(initial, '總數') ?? '' }]));
    const before = await readback(fixture);
    const response = await commit(page, auth, local);
    expect(response.status()).toBe(409);
    const failure = await response.json() as { recovery: { conflicts: Array<{ kind: string; header?: string }> } };
    expect(failure.recovery.conflicts).toContainEqual(expect.objectContaining({ kind: 'field', header: '總數' }));
    expect(await readback(fixture)).toEqual(before);
  });

  test('a desired derived result equal to the latest manual total removes the conflict', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const local = await prepare(page, auth, requestFor(initial, [{ header: '數量', value: '3' }]));
    await saveApi(page, auth, requestFor(initial, [{ header: '總數', value: '2.826' }]));
    const response = await commit(page, auth, local);
    expect(response.status(), await response.text()).toBe(200);
    const saved = await response.json() as SteelReviewSaveResponse;
    expect(effective(saved, '數量')).toBe('3'); expect(effective(saved, '總數')).toBe('2.826');
  });

  test('all manual and calculated conflicts retain the UI draft and retry from the latest version', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const dialog = await openEditor(page, fixture);
    const rowId = initial.rows[0].rowId;
    await dialog.getByRole('textbox', { name: `數量 ${rowId}`, exact: true }).fill('3');
    await dialog.getByRole('textbox', { name: `單價 ${rowId}`, exact: true }).fill('12');
    await saveApi(page, auth, requestFor(initial, [{ header: '總數', value: '77' }, { header: '單價', value: '20' }]));
    const before = await readback(fixture);
    const responseReady = page.waitForResponse((response) => response.request().method() === 'POST' &&
      response.url().endsWith('/review/system_order/prepare'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const response = await responseReady;
    expect(response.status()).toBe(409);
    const failure = await response.json() as { recovery: { conflicts: Array<{ kind: string; header?: string }> } };
    expect(failure.recovery.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'field', header: '總數' }),
      expect.objectContaining({ kind: 'field', header: '單價' }),
    ]));
    await expect(dialog.getByRole('textbox', { name: `數量 ${rowId}`, exact: true })).toHaveValue('3');
    await expect(dialog.getByRole('textbox', { name: `單價 ${rowId}`, exact: true })).toHaveValue('12');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    expect(effective(saved, '數量')).toBe('3');
    expect(effective(saved, '總數')).toBe('2.826');
    expect(effective(saved, '單價')).toBe('12');
    const after = await readback(fixture);
    await page.keyboard.press('Escape'); await page.reload();
    expect(effective(await readTable(page, auth, fixture), '總數')).toBe('2.826');
    expect(await readback(fixture)).toEqual(after);
  });

  test('invalid numeric text remains a local draft after failed Save', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    const input = dialog.getByRole('textbox', { name: `數量 ${initial.rows[0].rowId}`, exact: true });
    await input.fill('not-a-number');
    const responseReady = page.waitForResponse((response) => response.request().method() === 'POST' &&
      response.url().endsWith('/review/system_order/prepare'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await responseReady).ok()).toBe(false);
    await expect(input).toHaveValue('not-a-number');
    expect(await readback(fixture)).toEqual(before);
  });

  for (const kind of ['processing', 'unassigned'] as const) {
    test(`all ${kind} business cells remain editable without inferred row reclassification`, async ({ page }) => {
      const fixture = await seedCalculation(); fixtures.push(fixture);
      const initial = await readTable(page, auth, fixture);
      const rowId = randomUUID();
      const values = { '型號': `${kind}-code`, '品名規格': `${kind}-manual-row`, '材質編號': 'M1',
        '單位': 'pc', '數量': '1', '單重': '1', '總數': '2', '單價': '3', '計價基準': '2',
        '公式編號': 'manual', '厚度': '1', '寬度': '2', '長度': '3', '肚': '4',
        '類別': kind === 'processing' ? '加工/孔' : '', '備註': 'original' };
      await saveApi(page, auth, { conversationId: initial.conversationId, messageId: initial.messageId,
        kind: initial.kind, title: initial.title, outputId: initial.outputId, revision: initial.revision,
        operations: [{ type: 'add', rowId, position: { kind: 'end' },
          system: { kind, parentRowId: kind === 'processing' ? initial.rows[0].rowId : null },
          changes: Object.entries(values).map(([header, value]) => ({ header, value })) }] });
      const before = await readback(fixture);
      const dialog = await openEditor(page, fixture);
      for (const header of initial.headers) {
        await expect(dialog.getByRole('textbox', { name: `${header} ${rowId}`, exact: true })).toBeEditable();
      }
      await dialog.getByRole('textbox', { name: `類別 ${rowId}`, exact: true }).fill('USER-CATEGORY');
      await dialog.getByRole('textbox', { name: `備註 ${rowId}`, exact: true }).fill('USER-NOTES');
      await dialog.getByRole('textbox', { name: `長度 ${rowId}`, exact: true }).fill('9');
      expect(await readback(fixture)).toEqual(before);
      const saved = await saveUi(page, dialog);
      const row = saved.rows.find((candidate) => candidate.rowId === rowId);
      expect(row?.values['類別'].effective).toBe('USER-CATEGORY');
      expect(row?.values['備註'].effective).toBe('USER-NOTES');
      expect(row?.values['長度'].effective).toBe('9');
      expect(row?.values['單重'].effective).toBe('1');
      expect(row?.values['總數'].effective).toBe('2');
      expect(row?.system?.kind).toBe(kind);
      const after = await readback(fixture);
      await page.keyboard.press('Escape'); await page.reload();
      const reopened = await readTable(page, auth, fixture);
      expect(reopened.rows.find((candidate) => candidate.rowId === rowId)?.values['備註'].effective).toBe('USER-NOTES');
      expect(await readback(fixture)).toEqual(after);
    });
  }

  test('dirty dimension download saves and uses the confirmed clean calculated data', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('textbox', { name: `寬度 ${initial.rows[0].rowId}`, exact: true }).fill('125');
    const downloadReady = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download.*CSV/iu }).click();
    const download = await downloadReady;
    const filePath = await download.path();
    if (!filePath) throw new Error('Missing confirmed material download');
    const csv = await readFile(filePath, 'utf8');
    expect(csv).toContain('1.1775'); expect(csv).toContain('2.355'); expect(csv).not.toContain('~~');
    const saved = await readTable(page, auth, fixture);
    expect(effective(saved, '總數')).toBe('2.355');
    const after = await readback(fixture);
    expect(after.reviews[0].receipts).toHaveLength(1);
    expect(after.artifacts).toEqual(before.artifacts);
    const cleanDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download.*CSV/iu }).click();
    await cleanDownload;
    expect(await readback(fixture)).toEqual(after);
  });
});
