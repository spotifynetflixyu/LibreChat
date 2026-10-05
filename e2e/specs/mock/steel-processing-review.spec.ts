import { expect, test } from '@playwright/test';
import type { SteelReviewTable, SteelReviewRow, SteelReviewOperation, SteelReviewRecovery } from 'librechat-data-provider';
import type { Auth, Fixture } from './steel-calculation-fixture';
import type { Page } from '@playwright/test';
import { deleteConversations, deleteMessagesByConversation, withMongo } from './db';
import { getAccessToken } from './helpers';
import {
  seedCalculation, readTable, saveApi, readback, openEditor, saveUi, prepare, commit, reviewUrl,
  editBusinessValue, expectBusinessEditable,
} from './steel-calculation-fixture';

function named(owner: Pick<SteelReviewTable, 'rows'>, name: string): SteelReviewRow {
  const row = owner.rows.find((item) => item.values['品名規格']?.effective === name);
  if (!row) throw new Error(`Missing normal fixture row ${name}`);
  return row;
}

function intents(owner: SteelReviewTable, operations: SteelReviewOperation[]) {
  return { conversationId: owner.conversationId, messageId: owner.messageId, kind: owner.kind,
    title: owner.title, outputId: owner.outputId, revision: owner.revision, operations };
}

async function bindFixture(page: Page, auth: Auth, fixture: Fixture): Promise<SteelReviewTable> {
  const owner = await readTable(page, auth, fixture);
  await saveApi(page, auth, intents(owner, [{ type: 'update', rowId: named(owner, 'REVIEW-PROCESS').rowId,
    binding: { parentRowId: named(owner, 'REVIEW-FLAT-A').rowId } }]));
  return readTable(page, auth, fixture);
}

test.describe('Processing measurement normal review workflow', () => {
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

  test('processing without a measurement preserves manual values and popup baseline after Save and chat reload', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const parent = named(owner, 'REVIEW-FLAT-A');
    const process = named(owner, 'REVIEW-PROCESS');
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    await expectBusinessEditable(dialog, process.rowId, owner.headers);
    await editBusinessValue(dialog, parent.rowId, '數量', '5');
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('2');
    await editBusinessValue(dialog, process.rowId, '總數', '7');
    await editBusinessValue(dialog, process.rowId, '單價', '9');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    expect(named(saved, 'REVIEW-PROCESS').values['總數']).toEqual({ baseline: '2', effective: '7' });
    const processCell = dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true }).locator('xpath=ancestor::td');
    await expect(processCell.locator('del')).toHaveText('2');
    const after = await readback(fixture);
    expect(after.reviews[0].aiBaselineMarkdown).toBe(before.reviews[0].aiBaselineMarkdown);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 133 |');
    expect(after.messages[0].text).not.toContain('<del');
    expect(after.messages[0].text).not.toContain('~~');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(page.getByText('MATERIAL-SUFFIX', { exact: true })).toBeVisible();
    await expect(page.locator('del')).toHaveCount(0);
    const reloaded = await openEditor(page, fixture);
    await expect(reloaded.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('7');
    await expect(reloaded.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true }).locator('xpath=ancestor::td').locator('del')).toHaveText('2');
    expect(await readback(fixture)).toEqual(after);
  });
  test('explicit per-piece measurement persists and quantity changes recompute its total against the current parent', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const measured = await saveApi(page, auth, intents(owner, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'perPiece', amount: '2', unit: '刀' } }]));
    expect(named(measured, 'REVIEW-PROCESS').values['總數'].effective).toBe('4');
    const current = await readTable(page, auth, fixture);
    const parent = named(current, 'REVIEW-FLAT-A');
    const saved = await saveApi(page, auth, intents(current, [{ type: 'update', rowId: parent.rowId,
      changes: [{ header: '數量', value: '5' }] }]));
    expect(named(saved, 'REVIEW-PROCESS').values['總數'].effective).toBe('10');
    expect(named(saved, 'REVIEW-FLAT-A').values['單重'].effective).toBe('1');
    expect(saved.changedRowIds.sort()).toEqual([parent.rowId, process.rowId].sort());
    const after = await readback(fixture);
    expect(after.reviews[0].rows.find((row) => row.rowId === process.rowId)?.calculation?.measurement)
      .toMatchObject({ mode: 'perPiece', amount: '2', unit: '刀' });
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 170 |');
    await page.goto(`/c/${fixture.conversationId}`);
    await expect(page.getByText('MATERIAL-SUFFIX', { exact: true })).toBeVisible();
    const reloaded = await readTable(page, auth, fixture);
    expect(named(reloaded, 'REVIEW-PROCESS').values['總數'].effective).toBe('10');
    expect(await readback(fixture)).toEqual(after);
  });

  test('a batch measure never multiplies again on parent quantity or binding changes', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    await saveApi(page, auth, intents(owner, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'batch', amount: '7', unit: '刀' } }]));
    const current = await readTable(page, auth, fixture);
    const parent = named(current, 'REVIEW-FLAT-A');
    const other = named(current, 'REVIEW-FLAT-B');
    const saved = await saveApi(page, auth, intents(current, [
      { type: 'update', rowId: parent.rowId, changes: [{ header: '數量', value: '5' }] },
      { type: 'update', rowId: other.rowId, changes: [{ header: '數量', value: '4' }] },
      { type: 'update', rowId: process.rowId, binding: { parentRowId: other.rowId } },
    ]));
    expect(named(saved, 'REVIEW-PROCESS').values['總數'].effective).toBe('7');
    expect(named(saved, 'REVIEW-PROCESS').system?.parentRowId).toBe(other.rowId);
    const after = await readback(fixture);
    const reloaded = await readTable(page, auth, fixture);
    expect(named(reloaded, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ mode: 'batch', amount: '7' });
    expect(await readback(fixture)).toEqual(after);
  });

  test('a later manual total wins until a later computable quantity change and per-piece rebind', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const parent = named(owner, 'REVIEW-FLAT-A');
    const other = named(owner, 'REVIEW-FLAT-B');
    const manual = await saveApi(page, auth, intents(owner, [
      { type: 'update', rowId: process.rowId, measurement: { mode: 'perPiece', amount: '2', unit: '刀' } },
      { type: 'update', rowId: parent.rowId, changes: [{ header: '數量', value: '5' }] },
      { type: 'update', rowId: process.rowId, changes: [{ header: '總數', value: '99' }] },
    ]));
    expect(named(manual, 'REVIEW-PROCESS').values['總數'].effective).toBe('99');
    const current = await readTable(page, auth, fixture);
    const derived = await saveApi(page, auth, intents(current, [
      { type: 'update', rowId: parent.rowId, changes: [{ header: '數量', value: '3' }] },
    ]));
    expect(named(derived, 'REVIEW-PROCESS').values['總數'].effective).toBe('6');
    const next = await readTable(page, auth, fixture);
    const rebound = await saveApi(page, auth, intents(next, [
      { type: 'update', rowId: other.rowId, changes: [{ header: '數量', value: '4' }] },
      { type: 'update', rowId: process.rowId, binding: { parentRowId: other.rowId } },
    ]));
    expect(named(rebound, 'REVIEW-PROCESS').values['總數'].effective).toBe('8');
  });

  test('missing and cleared measurement preserve manually saved totals while zero is an explicit calculable amount', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    await saveApi(page, auth, intents(owner, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'perPiece', amount: null, unit: '刀' }, changes: [{ header: '總數', value: '99' }] }]));
    const current = await readTable(page, auth, fixture);
    const cleared = await saveApi(page, auth, intents(current, [{ type: 'update', rowId: process.rowId, measurement: null }]));
    expect(named(cleared, 'REVIEW-PROCESS').values['總數'].effective).toBe('99');
    expect(named(cleared, 'REVIEW-PROCESS').calculation?.measurement).toBeUndefined();
    const next = await readTable(page, auth, fixture);
    const zero = await saveApi(page, auth, intents(next, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'perPiece', amount: '0', unit: '刀' } }]));
    expect(named(zero, 'REVIEW-PROCESS').values['總數'].effective).toBe('0');
  });

  for (const sample of [
    { name: 'without remainder', stockLengthMm: '400', remainderMm: '0', headTrimMm: '0', tailTrimMm: '0', pieceHeadTrimMm: '0', pieceTailTrimMm: '0', stockCount: '1', pieceCount: '2', quantity: '2', knives: '1' },
    { name: 'with remainder', stockLengthMm: '500', remainderMm: '100', headTrimMm: '0', tailTrimMm: '0', pieceHeadTrimMm: '0', pieceTailTrimMm: '0', stockCount: '1', pieceCount: '2', quantity: '2', knives: '2' },
    { name: 'with stock head and tail trims', stockLengthMm: '420', remainderMm: '0', headTrimMm: '10', tailTrimMm: '10', pieceHeadTrimMm: '0', pieceTailTrimMm: '0', stockCount: '1', pieceCount: '2', quantity: '2', knives: '3' },
    { name: 'with each finished piece head and tail trims', stockLengthMm: '440', remainderMm: '0', headTrimMm: '0', tailTrimMm: '0', pieceHeadTrimMm: '10', pieceTailTrimMm: '10', stockCount: '1', pieceCount: '2', quantity: '2', knives: '5' },
    { name: 'with two identical stocks', stockLengthMm: '400', remainderMm: '0', headTrimMm: '0', tailTrimMm: '0', pieceHeadTrimMm: '0', pieceTailTrimMm: '0', stockCount: '2', pieceCount: '2', quantity: '4', knives: '2' },
    { name: 'with a full stock without a cut', stockLengthMm: '200', remainderMm: '0', headTrimMm: '0', tailTrimMm: '0', pieceHeadTrimMm: '0', pieceTailTrimMm: '0', stockCount: '1', pieceCount: '1', quantity: '1', knives: '0' },
  ]) {
    test(`confirmed explicit cutting plan ${sample.name} persists its exact counted result`, async ({ page }) => {
      const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
      const owner = await bindFixture(page, auth, fixture);
      const process = named(owner, 'REVIEW-PROCESS');
      const parent = named(owner, 'REVIEW-FLAT-A');
      const group = { stockLengthMm: sample.stockLengthMm, pieceLengthMm: '200', pieceCount: sample.pieceCount,
        stockCount: sample.stockCount, lossMm: '0', remainderMm: sample.remainderMm,
        headTrimMm: sample.headTrimMm, tailTrimMm: sample.tailTrimMm,
        pieceHeadTrimMm: sample.pieceHeadTrimMm, pieceTailTrimMm: sample.pieceTailTrimMm };
      const saved = await saveApi(page, auth, intents(owner, [
        { type: 'update', rowId: parent.rowId, changes: [{ header: '數量', value: sample.quantity }] },
        { type: 'update', rowId: process.rowId, measurement: { mode: 'cutting', amount: null, unit: '刀', confirmed: true, groups: [group] } },
      ]));
      expect(named(saved, 'REVIEW-PROCESS').values['總數'].effective).toBe(sample.knives);
      expect(named(saved, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ mode: 'cutting', confirmed: true, groups: [group] });
      const after = await readback(fixture);
      const reloaded = await readTable(page, auth, fixture);
      expect(named(reloaded, 'REVIEW-PROCESS').values['總數'].effective).toBe(sample.knives);
      expect(await readback(fixture)).toEqual(after);
    });
  }

  test('metadata-only measurement Save keeps identical clean Markdown but persists a new review revision', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const before = await readback(fixture);
    const saved = await saveApi(page, auth, intents(owner, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'perPiece', amount: '1', unit: '刀' } }]));
    expect(named(saved, 'REVIEW-PROCESS').values['總數'].effective).toBe('2');
    expect(saved.changedRows).toBe(1);
    expect(saved.changedRowIds).toEqual([process.rowId]);
    expect(saved.revision).not.toBe(owner.revision);
    const after = await readback(fixture);
    expect(after.messages[0].text).toBe(before.messages[0].text);
    expect(after.reviews[0].rows.find((row) => row.rowId === process.rowId)?.calculation?.measurement)
      .toMatchObject({ mode: 'perPiece', amount: '1' });
    const current = await readTable(page, auth, fixture);
    expect(current.revision).toBe(saved.revision);
    const dialog = await openEditor(page, fixture);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    expect(await readback(fixture)).toEqual(after);
  });

  test('conflicting measurement changes return latest complete Markdown without overwriting either saved input', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const local = await prepare(page, auth, intents(owner, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'perPiece', amount: '3', unit: '刀' } }]));
    await saveApi(page, auth, intents(owner, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'perPiece', amount: '2', unit: '刀' } }]));
    const before = await readback(fixture);
    const response = await commit(page, auth, local);
    expect(response.status()).toBe(409);
    const { recovery } = await response.json() as { recovery: SteelReviewRecovery };
    expect(recovery.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'measurement', rowId: process.rowId })]));
    expect(recovery.table.rows).toEqual(expect.arrayContaining([expect.objectContaining({ rowId: process.rowId })]));
    expect(recovery.table.effectiveMarkdown).toContain('REVIEW-PROCESS');
    expect(await readback(fixture)).toEqual(before);
  });

  test('new malformed measurement numbers fail normal API validation and leave database unchanged', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const before = await readback(fixture);
    const response = await page.request.post(`${reviewUrl(fixture.conversationId)}/prepare`, { headers: auth,
      data: intents(owner, [{ type: 'update', rowId: process.rowId,
        measurement: { mode: 'perPiece', amount: 'NaN', unit: '刀' } }]) });
    expect(response.status()).toBe(400);
    expect(await readback(fixture)).toEqual(before);
  });

  test('a previously confirmed cutting layout becomes noncomputable after a new quantity or finished length and preserves total', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const parent = named(owner, 'REVIEW-FLAT-A');
    await saveApi(page, auth, intents(owner, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'cutting', amount: null, unit: '刀', confirmed: true,
        groups: [{ stockLengthMm: '400', pieceLengthMm: '200', pieceCount: '2', stockCount: '1', lossMm: '0',
          remainderMm: '0', headTrimMm: '0', tailTrimMm: '0', pieceHeadTrimMm: '0', pieceTailTrimMm: '0' }] } }]));
    const current = await readTable(page, auth, fixture);
    expect(named(current, 'REVIEW-PROCESS').values['總數'].effective).toBe('1');
    const quantityChanged = await saveApi(page, auth, intents(current, [{ type: 'update', rowId: parent.rowId,
      changes: [{ header: '數量', value: '3' }] }]));
    expect(named(quantityChanged, 'REVIEW-PROCESS').values['總數'].effective).toBe('1');
    const next = await readTable(page, auth, fixture);
    const lengthChanged = await saveApi(page, auth, intents(next, [{ type: 'update', rowId: parent.rowId,
      changes: [{ header: '長度', value: '250' }] }]));
    expect(named(lengthChanged, 'REVIEW-PROCESS').values['總數'].effective).toBe('1');
    expect(named(lengthChanged, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ mode: 'cutting', confirmed: true });
  });

  test('per-piece calculation UI is draft-only with undo and redo and saves clean values with persistent AI comparison', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const parent = named(owner, 'REVIEW-FLAT-A');
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('combobox', { name: `Measurement mode ${process.rowId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Per piece', exact: true }).click();
    const amount = dialog.getByRole('textbox', { name: `Measurement amount ${process.rowId}`, exact: true });
    await amount.fill('2');
    await amount.blur();
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('4');
    expect(await readback(fixture)).toEqual(before);
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(amount).toHaveValue('');
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(amount).toHaveValue('2');
    await saveUi(page, dialog);
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true }).locator('xpath=ancestor::td').locator('del')).toHaveText('2');
    await editBusinessValue(dialog, parent.rowId, '數量', '5');
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('10');
    const saved = await saveUi(page, dialog);
    expect(saved.changedRowIds.sort()).toEqual([parent.rowId, process.rowId].sort());
    const after = await readback(fixture);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('MATERIAL-SUFFIX', { exact: true })).toBeVisible();
    await expect(page.locator('del')).toHaveCount(0);
    const reloaded = await openEditor(page, fixture);
    await expect(reloaded.getByRole('textbox', { name: `Measurement amount ${process.rowId}`, exact: true })).toHaveValue('2');
    await expect(reloaded.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('10');
    expect(await readback(fixture)).toEqual(after);
  });

  test('whole batch UI keeps its amount through quantity changes and invalid measurement input stays a draft', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const parent = named(owner, 'REVIEW-FLAT-A');
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('combobox', { name: `Measurement mode ${process.rowId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Batch', exact: true }).click();
    const amount = dialog.getByRole('textbox', { name: `Measurement amount ${process.rowId}`, exact: true });
    await amount.fill('abc');
    await amount.blur();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(amount).toHaveValue('abc');
    expect(await readback(fixture)).toEqual(before);
    await amount.fill('7');
    await amount.blur();
    await editBusinessValue(dialog, parent.rowId, '數量', '5');
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('7');
    const saved = await saveUi(page, dialog);
    expect(named(saved, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ mode: 'batch', amount: '7' });
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('cutting UI requires explicit stock inputs, persists plan version, and permits a missing input without clearing total', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('combobox', { name: `Measurement mode ${process.rowId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Confirmed cutting plan', exact: true }).click();
    await dialog.getByRole('textbox', { name: `Plan ID ${process.rowId}`, exact: true }).fill('LAYOUT-1');
    await dialog.getByRole('textbox', { name: `Plan version ${process.rowId}`, exact: true }).fill('3');
    await dialog.getByRole('button', { name: `Add stock group ${process.rowId}`, exact: true }).click();
    const fields = {
      'Stock length (mm)': '400', 'Finished piece length (mm)': '200', 'Pieces per stock': '2', 'Identical stocks': '1',
      'Kerf / other loss per stock (mm)': '0', 'Remainder per stock (mm)': '0', 'Stock head trim (mm)': '0',
      'Stock tail trim (mm)': '0', 'Head trim per finished piece (mm)': '0', 'Tail trim per finished piece (mm)': '0',
    };
    for (const [label, value] of Object.entries(fields)) {
      const input = dialog.getByRole('textbox', { name: `${label} ${process.rowId} 1`, exact: true });
      await expect(input).toHaveValue('');
      await input.fill(value);
    }
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('2');
    await dialog.getByRole('checkbox', { name: `Confirm cutting plan ${process.rowId}`, exact: true }).check();
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('1');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    expect(named(saved, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ mode: 'cutting', planId: 'LAYOUT-1', planVersion: '3', confirmed: true });
    const loss = dialog.getByRole('textbox', { name: `Kerf / other loss per stock (mm) ${process.rowId} 1`, exact: true });
    await loss.fill('');
    await loss.blur();
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('1');
    const incomplete = await saveUi(page, dialog);
    expect(named(incomplete, 'REVIEW-PROCESS').values['總數'].effective).toBe('1');
    expect(named(incomplete, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ groups: [{ lossMm: null }] });
    const after = await readback(fixture);
    await page.keyboard.press('Escape');
    const reloaded = await openEditor(page, fixture);
    await expect(reloaded.getByRole('textbox', { name: `Plan version ${process.rowId}`, exact: true })).toHaveValue('3');
    await expect(reloaded.getByRole('textbox', { name: `Kerf / other loss per stock (mm) ${process.rowId} 1`, exact: true })).toHaveValue('');
    expect(await readback(fixture)).toEqual(after);
  });

  test('new measurement input during Save remains a draft after confirmation and history reset', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('combobox', { name: `Measurement mode ${process.rowId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Per piece', exact: true }).click();
    const amount = dialog.getByRole('textbox', { name: `Measurement amount ${process.rowId}`, exact: true });
    await amount.fill('2'); await amount.blur();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const received = new Promise<void>((resolve) => { entered = resolve; });
    await page.route(`**${reviewUrl(fixture.conversationId)}/commit`, async (route) => {
      entered(); await blocked; await route.continue();
    }, { times: 1 });
    const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
    try {
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await received;
      await amount.fill('3'); await amount.blur();
      expect(await readback(fixture)).toEqual(before);
    } finally {
      release();
    }
    const response = await committed;
    expect(response.status(), await response.text()).toBe(200);
    await expect(amount).toHaveValue('3');
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    const first = await readTable(page, auth, fixture);
    expect(named(first, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ amount: '2' });
    expect(named(first, 'REVIEW-PROCESS').values['總數'].effective).toBe('4');
    const saved = await saveUi(page, dialog);
    expect(named(saved, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ amount: '3' });
    expect(named(saved, 'REVIEW-PROCESS').values['總數'].effective).toBe('6');
  });

  test('measurement conflict keeps the UI draft and retries against the latest saved owner version', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await bindFixture(page, auth, fixture);
    const process = named(owner, 'REVIEW-PROCESS');
    const dialog = await openEditor(page, fixture);
    await dialog.getByRole('combobox', { name: `Measurement mode ${process.rowId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Per piece', exact: true }).click();
    const amount = dialog.getByRole('textbox', { name: `Measurement amount ${process.rowId}`, exact: true });
    await amount.fill('3'); await amount.blur();
    await saveApi(page, auth, intents(owner, [{ type: 'update', rowId: process.rowId,
      measurement: { mode: 'perPiece', amount: '2', unit: '刀' } }]));
    const before = await readback(fixture);
    const prepareResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/prepare'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const response = await prepareResponse;
    expect(response.status()).toBe(409);
    const failure = await response.json() as { recovery: SteelReviewRecovery };
    expect(failure.recovery.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'measurement', rowId: process.rowId })]));
    await expect(amount).toHaveValue('3');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    expect(named(saved, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ amount: '3' });
    expect(named(saved, 'REVIEW-PROCESS').values['總數'].effective).toBe('6');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

});
