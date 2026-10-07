import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SteelReviewSaveResponse } from 'librechat-data-provider';
import type { Auth, Fixture } from './steel-calculation-fixture';
import { deleteConversations, deleteMessagesByConversation, withMongo } from './db';
import { getAccessToken } from './helpers';
import {
  seedCalculation, readTable, requestFor, prepare, commit, saveApi,
  readback, openEditor, saveUi, editBusinessValue, expectBusinessEditable, effective,
} from './steel-calculation-fixture';

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
    await expectBusinessEditable(dialog, initial.rows[0].rowId, initial.headers);
    const updates = { '型號': 'MANUAL-CODE', '品名規格': 'MANUAL-NAME', '材質編號': 'M2', '單位': 'M',
      '數量': '5', '單重': '7', '總數': '11', '單價': '12', '計價基準': '3', '公式編號': 'MANUAL-FORMULA',
      '厚度': '2.54', '寬度': '125', '長度': '1000', '肚': '4', '類別': '其他', '備註': 'MANUAL-NOTES' };
    for (const [header, value] of Object.entries(updates)) {
      await editBusinessValue(dialog, initial.rows[0].rowId, header, value);
    }
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    for (const [header, value] of Object.entries(updates)) expect(effective(saved, header)).toBe(value);
    expect(saved.rows[0].system).toEqual(initial.rows[0].system);
    expect(saved.rows[0].values['類別'].baseline).toBe('鐵板');
    await expect(dialog.getByRole('combobox', { name: `類別 ${initial.rows[0].rowId}`, exact: true })).toHaveText('其他');
    await expect(dialog.locator('del').filter({ hasText: /^鐵板$/u })).toBeVisible();
    const after = await readback(fixture);
    const savedMessage = after.messages.find((message) => message.messageId === fixture.messageId);
    expect(savedMessage?.text).toContain('MANUAL-CODE');
    expect(savedMessage?.text).not.toContain('~~');
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 162 |');
    expect(after.artifacts).toEqual(before.artifacts);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('cell', { name: 'MANUAL-CODE', exact: true })).toBeVisible();
    await expect(page.locator('del')).toHaveCount(0);
    await page.reload();
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
        '單位': 'kg', '數量': '02.00', '單重': '1.00', '總數': '2.00', '單價': '3.00', '計價基準': '2',
        '公式編號': 'manual', '厚度': '0.1 inch', '寬度': '2', '長度': '3', '肚': '4',
        '類別': kind === 'processing' ? '加工/孔' : '', '備註': 'original' };
      await saveApi(page, auth, { conversationId: initial.conversationId, messageId: initial.messageId,
        kind: initial.kind, title: initial.title, outputId: initial.outputId, revision: initial.revision,
        operations: [{ type: 'add', rowId, position: { kind: 'end' },
          system: { kind, parentRowId: kind === 'processing' ? initial.rows[0].rowId : null },
          changes: Object.entries(values).map(([header, value]) => ({ header, value })) }] });
      const added = (await readTable(page, auth, fixture)).rows.find((entry) => entry.rowId === rowId);
      expect(added?.values['厚度'].effective).toBe('2.54');
      expect(added?.values['數量'].effective).toBe('2');
      expect(added?.values['單重'].effective).toBe('1');
      expect(added?.values['總數'].effective).toBe('2');
      const before = await readback(fixture);
      const dialog = await openEditor(page, fixture);
      await expectBusinessEditable(dialog, rowId, initial.headers);
      const selectedCategory = kind === 'processing' ? '鐵板' : '加工/孔';
      await editBusinessValue(dialog, rowId, '類別', selectedCategory);
      await editBusinessValue(dialog, rowId, '數量', '3');
      await dialog.getByRole('textbox', { name: `備註 ${rowId}`, exact: true }).fill('USER-NOTES');
      await dialog.getByRole('textbox', { name: `長度 ${rowId}`, exact: true }).fill('9');
      expect(await readback(fixture)).toEqual(before);
      const saved = await saveUi(page, dialog);
      const row = saved.rows.find((candidate) => candidate.rowId === rowId);
      expect(row?.values['類別'].effective).toBe(selectedCategory);
      expect(row?.values['數量'].effective).toBe('3');
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

  test('a material added in the UI saves the computed total after its initial empty cells', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    const weight = dialog.getByRole('textbox', { name: /^單重 /u }).last();
    const label = await weight.getAttribute('aria-label');
    if (!label) throw new Error('Missing added material identity');
    const rowId = label.replace(/^單重 /u, '');
    await editBusinessValue(dialog, rowId, '單位', 'kg');
    await editBusinessValue(dialog, rowId, '單重', '3.00');
    await editBusinessValue(dialog, rowId, '數量', '02.00');
    await editBusinessValue(dialog, rowId, '單價', '4.00');
    await expect(dialog.getByRole('textbox', { name: `總數 ${rowId}`, exact: true })).toHaveValue('6');
    const saved = await saveUi(page, dialog);
    const row = saved.rows.find((entry) => entry.rowId === rowId);
    expect(row?.values['數量'].effective).toBe('2');
    expect(row?.values['單重'].effective).toBe('3');
    expect(row?.values['總數'].effective).toBe('6');
    await page.keyboard.press('Escape'); await page.reload();
    expect((await readTable(page, auth, fixture)).rows.find((entry) => entry.rowId === rowId)?.values['總數'].effective).toBe('6');
  });

  test('normal added material rows clean dimensions and calculate ordered manual weight inputs', async ({ page }) => {
    const fixture = await seedCalculation(); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const rowId = randomUUID();
    const saved = await saveApi(page, auth, { conversationId: initial.conversationId, messageId: initial.messageId,
      kind: initial.kind, title: initial.title, outputId: initial.outputId, revision: initial.revision,
      operations: [{ type: 'add', rowId, position: { kind: 'end' }, system: { kind: 'material', parentRowId: null },
        changes: [{ header: '品名規格', value: 'MANUAL-NEW' }, { header: '單位', value: 'kg' },
          { header: '厚度', value: '0.1 inch' }, { header: '數量', value: '02.00' },
          { header: '單重', value: '3.00' }, { header: '單價', value: '4.00' }] }] });
    const row = saved.rows.find((entry) => entry.rowId === rowId);
    expect(row?.values['厚度'].effective).toBe('2.54');
    expect(row?.values['數量'].effective).toBe('2');
    expect(row?.values['單重'].effective).toBe('3');
    expect(row?.values['總數'].effective).toBe('6');
    expect(row?.values['單價'].effective).toBe('4');
    const dialog = await openEditor(page, fixture);
    await expect(dialog.getByRole('textbox', { name: `厚度 ${rowId}`, exact: true })).toHaveValue('2.54');
    await expect(dialog.getByRole('textbox', { name: `總數 ${rowId}`, exact: true })).toHaveValue('6');
    await page.keyboard.press('Escape'); await page.reload();
    expect((await readTable(page, auth, fixture)).rows.find((entry) => entry.rowId === rowId)?.values['總數'].effective).toBe('6');
  });

  for (const mode of ['square', 'squareDensityOnly'] as const) {
    test(`${mode} width calculation uses the edited dimension rather than the stock width`, async ({ page }) => {
      const fixture = await seedCalculation(mode); fixtures.push(fixture);
      const initial = await readTable(page, auth, fixture);
      const dialog = await openEditor(page, fixture);
      await editBusinessValue(dialog, initial.rows[0].rowId, '寬度', '50');
      const saved = await saveUi(page, dialog);
      expect(effective(saved, '寬度')).toBe('50');
      expect(effective(saved, '單重')).toBe('3.925');
      expect(effective(saved, '總數')).toBe('7.85');
      await page.keyboard.press('Escape'); await page.reload();
      expect(effective(await readTable(page, auth, fixture), '單重')).toBe('3.925');
    });

  }

  for (const mode of ['round', 'flat'] as const) {
    test(`canonical ${mode} per-metre evidence computes length without a stock length`, async ({ page }) => {
      const fixture = await seedCalculation(mode); fixtures.push(fixture);
      const initial = await readTable(page, auth, fixture);
      const dialog = await openEditor(page, fixture);
      await editBusinessValue(dialog, initial.rows[0].rowId, '長度', '300');
      const saved = await saveUi(page, dialog);
      expect(effective(saved, '單重')).toBe('0.3');
      expect(effective(saved, '總數')).toBe('0.6');
      expect(saved.rows[0].calculation?.candidate?.erpItemCode).toBe(mode.toUpperCase());
      await page.keyboard.press('Escape'); await page.reload();
      expect(effective(await readTable(page, auth, fixture), '單重')).toBe('0.3');
    });
  }

  test('unsupported profile dimensions preserve a saved manual weight and total', async ({ page }) => {
    const fixture = await seedCalculation('round'); fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    await saveApi(page, auth, requestFor(initial, [{ header: '單重', value: '7' }]));
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    await editBusinessValue(dialog, initial.rows[0].rowId, '寬度', '50');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    expect(effective(saved, '單重')).toBe('7');
    expect(effective(saved, '總數')).toBe('14');
    await page.keyboard.press('Escape'); await page.reload();
    expect(effective(await readTable(page, auth, fixture), '單重')).toBe('7');
  });


});
