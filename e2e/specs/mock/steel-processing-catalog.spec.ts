import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { Auth, Fixture } from './steel-calculation-fixture';
import { seedCalculation, readTable, readback, openEditor, saveUi, saveApi, classifyAddedRow } from './steel-calculation-fixture';
import { deleteConversations, deleteMessagesByConversation, withMongo } from './db';
import { getAccessToken } from './helpers';

async function fillNotes(dialog: Locator, rowId: string, value: string): Promise<void> {
  const notes = dialog.getByRole('textbox', { name: `備註 ${rowId}`, exact: true });
  await notes.fill(value);
  await notes.blur();
}

test.describe('Processing catalog normal review workflow', () => {
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

  test('filters processing options and retains query, measurement and notes grouping through keyboard correction and Save', async ({ page }) => {
    const fixture = await seedCalculation('plate', '', true); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const child = initial.rows.find((row) => row.system?.kind === 'processing');
    if (!child) throw new Error('Missing producer processing');
    await saveApi(page, auth, { conversationId: initial.conversationId, messageId: initial.messageId,
      kind: initial.kind, title: initial.title, outputId: initial.outputId, revision: initial.revision,
      operations: [{ type: 'update', rowId: child.rowId, measurement: { mode: 'perPiece', amount: '3', unit: '刀' } }] });
    const owner = await readTable(page, auth, fixture);
    const processing = owner.rows.find((row) => row.rowId === child.rowId)!;
    const parent = owner.rows.find((row) => row.rowId === processing.system?.parentRowId)!;
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    let queries = 0;
    page.on('request', (request) => {
      if (request.method() === 'GET' && request.url().includes('/review/system_order/catalog?')) queries += 1;
    });
    const model = dialog.getByRole('combobox', { name: `型號 ${processing.rowId}`, exact: true });
    await model.click();
    await expect(page.getByRole('option', { name: 'PC-MULTI-A Plate cutting A', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'PC-WRONG Other material drilling', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'PC-BAND Excluded thickness band', exact: true })).toHaveCount(0);
    const search = page.locator('input[placeholder="Search catalog"]:visible');
    await search.fill('PC-MULTI');
    await page.getByRole('option', { name: 'PC-MULTI-A Plate cutting A', exact: true }).click();
    await expect(model).toHaveText('PC-MULTI-A');
    const calls = queries;
    await model.click();
    await expect(search).toHaveValue('PC-MULTI');
    await search.press('ArrowDown');
    await expect(model).toHaveText('PC-MULTI-B');
    await expect(search).toBeVisible();
    expect(queries).toBe(calls);
    await search.press('Escape');
    await expect(model.locator('xpath=ancestor::td').locator('del')).toHaveText('PROCESS');
    await expect(model).toHaveText('PC-MULTI-B');
    await dialog.getByRole('textbox', { name: `數量 ${parent.rowId}`, exact: true }).fill('3');
    await dialog.getByRole('textbox', { name: `總數 ${processing.rowId}`, exact: true }).blur();
    await expect(dialog.getByRole('textbox', { name: `總數 ${processing.rowId}`, exact: true })).toHaveValue('9');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    const selected = saved.rows.find((row) => row.rowId === processing.rowId)!;
    expect(selected.system).toEqual(processing.system);
    expect(selected.source).toEqual(processing.source);
    expect(selected.calculation?.measurement).toEqual(processing.calculation?.measurement);
    expect(selected.values['總數'].effective).toBe('9');
    expect(selected.values['單價'].effective).toBe('3.123456789123456789');
    const after = await readback(fixture);
    expect(after.messages[0].messageId).toBe(before.messages[0].messageId);
    expect(after.reviews[0].aiBaselineMarkdown).toBe(before.reviews[0].aiBaselineMarkdown);
    expect(after.quotation?.currentSystemOrder?.customerQuoteMarkdown).toContain('| Plate cutting B | 9 | 29 |');
    await page.keyboard.press('Escape');
    await page.reload();
    const reopened = await openEditor(page, fixture);
    await expect(reopened.getByRole('combobox', { name: `型號 ${processing.rowId}`, exact: true })).toHaveText('PC-MULTI-B');
    await expect(reopened.getByRole('textbox', { name: `總數 ${processing.rowId}`, exact: true })).toHaveValue('9');
    expect(await readback(fixture)).toEqual(after);
  });

  test('queries the unsaved new material scope and saves a single missing-tier processing candidate with blank incomplete totals', async ({ page }) => {
    const fixture = await seedCalculation('plate', '', true); fixtures.push(fixture);
    const before = await readback(fixture);
    const initial = await readTable(page, auth, fixture);
    const oldProcessing = initial.rows.find((row) => row.system?.kind === 'processing');
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    const materialId = await classifyAddedRow(page, dialog, 'Material');
    const materialModel = dialog.getByRole('combobox', { name: `型號 ${materialId}`, exact: true });
    await materialModel.click();
    await page.locator('input[placeholder="Search catalog"]:visible').fill('SC-UNIQUE');
    await expect(materialModel).toHaveText('SC-UNIQUE');
    await dialog.getByRole('combobox', { name: `類別 ${materialId}`, exact: true }).click();
    await page.getByRole('option', { name: 'C型鋼', exact: true }).click();
    await fillNotes(dialog, materialId, 'SC-UNIQUE');
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    const childId = await classifyAddedRow(page, dialog, 'Processing');
    const childModel = dialog.getByRole('combobox', { name: `型號 ${childId}`, exact: true });
    await fillNotes(dialog, childId, 'SC-UNIQUE');
    const queried = page.waitForResponse((response) => response.request().method() === 'GET' &&
      response.url().includes('/review/system_order/catalog?') && response.url().includes('PC-NOPRICE'));
    await childModel.click();
    await page.locator('input[placeholder="Search catalog"]:visible').fill('PC-NOPRICE');
    const response = await queried;
    expect(new URL(response.url()).searchParams.get('materialCategory')).toBe('C型鋼');
    await expect(childModel).toHaveText('PC-NOPRICE');
    await expect(dialog.getByRole('textbox', { name: `單價 ${childId}`, exact: true })).toHaveValue('');
    await expect(dialog.getByRole('textbox', { name: `總數 ${childId}`, exact: true })).toHaveValue('');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    const child = saved.rows.find((row) => row.rowId === childId)!;
    expect(child.system?.parentRowId).toBe(materialId);
    expect(child.values['單價'].effective).toBe('');
    expect(child.values['總數'].effective).toBe('');
    expect(saved.rows.find((row) => row.rowId === oldProcessing?.rowId)).toMatchObject(oldProcessing!);
    const after = await readback(fixture);
    expect(after.reviews[0].receipts?.at(-1)?.snapshot?.selectionEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowId: childId, candidateId: '9007199254740997', customerTier: 'B', unitPrice: null }),
    ]));
    await page.keyboard.press('Escape');
    await page.reload();
    const reopened = await openEditor(page, fixture);
    await expect(reopened.getByRole('combobox', { name: `型號 ${childId}`, exact: true })).toHaveText('PC-NOPRICE');
    await expect(reopened.getByRole('textbox', { name: `單價 ${childId}`, exact: true })).toHaveValue('');
    expect(await readback(fixture)).toEqual(after);
  });
});
