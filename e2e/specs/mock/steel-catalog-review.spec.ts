import { expect, test } from '@playwright/test';
import type { Auth, Fixture } from './steel-calculation-fixture';
import { seedCalculation, readTable, readback, openEditor, saveUi, saveApi } from './steel-calculation-fixture';
import { deleteConversations, deleteMessagesByConversation, withMongo } from './db';
import { getAccessToken } from './helpers';

test.describe('Material catalog normal review workflow', () => {
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

  test('a complete material candidate stays a draft until Save and preserves its processing row', async ({ page }) => {
    const fixture = await seedCalculation('plate', '', true); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const initialProcessing = initial.rows.find((row) => row.system?.kind === 'processing');
    if (!initialProcessing) throw new Error('Missing normal producer processing');
    await saveApi(page, auth, {
      conversationId: initial.conversationId, messageId: initial.messageId, kind: initial.kind,
      title: initial.title, outputId: initial.outputId, revision: initial.revision,
      operations: [{ type: 'update', rowId: initialProcessing.rowId,
        measurement: { mode: 'batch', amount: '7', unit: '刀' }, changes: [{ header: '單價', value: '13' }] }],
    });
    const owner = await readTable(page, auth, fixture);
    const material = owner.rows.find((row) => row.values['品名規格']?.effective === 'REVIEW-PLATE-A');
    const processing = owner.rows.find((row) => row.system?.kind === 'processing');
    if (!material || !processing) throw new Error('Missing normal producer material or processing');
    expect(processing.system?.parentRowId).toBe(material.rowId);
    expect(processing.calculation?.measurement).toEqual({ mode: 'batch', amount: '7', unit: '刀', ruleVersion: 'v1' });
    expect(processing.values['總數'].effective).toBe('7');
    expect(processing.values['單價'].effective).toBe('13');
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    const model = dialog.getByRole('combobox', { name: `型號 ${material.rowId}`, exact: true });
    await model.click();
    await expect(page.getByRole('option', { name: 'SC-UNIQUE Selector steel plate catalog-special 400mm', exact: true })).toBeVisible();
    const search = page.locator('input[placeholder="Search catalog"]:visible');
    await search.focus();
    await page.getByRole('option', { name: 'SC-UNIQUE Selector steel plate catalog-special 400mm', exact: true }).click();
    await expect(model).toHaveText('SC-UNIQUE');
    await expect(model).toHaveText('PLATE');
    await model.click();
    await page.locator('input[placeholder="Search catalog"]:visible').fill('SC-UNIQUE');
    await expect(model).toHaveText('SC-UNIQUE');
    await expect(dialog.getByRole('combobox', { name: `品名規格 ${material.rowId}`, exact: true })).toHaveText('Selector steel plate catalog-special 400mm');
    await dialog.getByRole('combobox', { name: `品名規格 ${material.rowId}`, exact: true }).click();
    await expect(page.getByRole('option', { name: 'SC-UNIQUE Selector steel plate catalog-special 400mm', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    for (const [header, value] of Object.entries({ 數量: '2', 材質編號: 'SS400', 寬度: '400', 厚度: '', 長度: '', 單價: '' })) {
      await expect(dialog.getByRole('textbox', { name: `${header} ${material.rowId}`, exact: true })).toHaveValue(value);
    }
    expect(await readback(fixture)).toEqual(before);
    await expect(model).toHaveText('PLATE');
    await expect(model).toHaveText('SC-UNIQUE');
    const saved = await saveUi(page, dialog);
    expect(saved.changedRowIds).toEqual([material.rowId]);
    expect(saved.rows.find((row) => row.rowId === processing.rowId)).toEqual(processing);
    const replacement = saved.rows.find((row) => row.rowId === material.rowId);
    expect(replacement?.values['單價'].effective).toBe('');
    expect(replacement?.values['數量']).toEqual(material.values['數量']);
    expect(replacement?.source).toEqual(material.source);
    const after = await readback(fixture);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.messages[0].messageId).toBe(fixture.messageId);
    expect(after.messages[0].text).toContain('SC-UNIQUE');
    const quoteLine = after.quotation?.currentSystemOrder?.customerQuoteMarkdown?.split('\n')
      .find((line) => line.includes('Selector steel plate catalog-special 400mm'));
    expect(quoteLine?.split('|').slice(1, -1).map((cell) => cell.trim())).toEqual([
      'Selector steel plate catalog-special 400mm', replacement?.values['總數'].effective, '',
    ]);
    expect(after.reviews[0].aiBaselineMarkdown).toBe(before.reviews[0].aiBaselineMarkdown);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('MATERIAL-SUFFIX', { exact: true })).toBeVisible();
    const reopened = await openEditor(page, fixture);
    await expect(reopened.getByRole('combobox', { name: `型號 ${material.rowId}`, exact: true })).toHaveText('SC-UNIQUE');
    await expect(reopened.getByRole('combobox', { name: `型號 ${material.rowId}`, exact: true }).locator('xpath=ancestor::td').locator('del')).toHaveText('PLATE');
    expect(await readback(fixture)).toEqual(after);
  });

  test('retains one row option batch and verifies a newly added material candidate on Save', async ({ page }) => {
    const fixture = await seedCalculation('plate', '', true); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const material = initial.rows.find((row) => row.system?.kind === 'material');
    if (!material) throw new Error('Missing normal material');
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    let queries = 0;
    page.on('request', (request) => {
      if (request.method() === 'GET' && request.url().includes('/review/system_order/catalog?')) queries += 1;
    });
    const model = dialog.getByRole('combobox', { name: `型號 ${material.rowId}`, exact: true });
    await model.click();
    const search = page.locator('input[placeholder="Search catalog"]:visible');
    await search.fill('SC-');
    await expect(page.getByRole('option', { name: 'SC-OTHER Other steel plate catalog-special 400mm', exact: true })).toBeVisible();
    await page.getByRole('option', { name: 'SC-UNIQUE Selector steel plate catalog-special 400mm', exact: true }).click();
    await expect(model).toHaveText('SC-UNIQUE');
    const calls = queries;
    await model.click();
    await expect(search).toHaveValue('SC-');
    await search.press('ArrowUp');
    await expect(model).toHaveText('SC-OTHER');
    await expect(search).toBeVisible();
    await search.press('ArrowDown');
    await expect(model).toHaveText('SC-UNIQUE');
    expect(queries).toBe(calls);
    await page.keyboard.press('Escape');
    await expect(model).toHaveText('PLATE');
    await dialog.getByRole('button', { name: 'Add item', exact: true }).click();
    const addedModel = dialog.getByRole('combobox', { name: /^型號 /u }).last();
    await addedModel.click();
    await expect(search).toHaveValue('');
    await search.fill('SC-UNIQUE');
    await expect(addedModel).toHaveText('SC-UNIQUE');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    const added = saved.rows.find((row) => row.origin === 'manual' && row.values['型號'].effective === 'SC-UNIQUE');
    expect(added?.calculation?.candidate?.erpItemCode).toBe('SC-UNIQUE');
    expect(added?.values['單價'].effective).toBe('');
    const after = await readback(fixture);
    expect(after.reviews[0].receipts?.at(-1)?.snapshot?.selectionEvidence).toEqual([
      expect.objectContaining({ rowId: added?.rowId, candidateId: '9007199254740993', customerTier: 'B', unitPrice: null }),
    ]);
    await page.keyboard.press('Escape');
    await page.reload();
    const reopened = await openEditor(page, fixture);
    await expect(reopened.getByRole('combobox', { name: `型號 ${added?.rowId}`, exact: true })).toHaveText('SC-UNIQUE');
    expect(await readback(fixture)).toEqual(after);
  });

});
