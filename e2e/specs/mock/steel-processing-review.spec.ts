import { expect, test } from '@playwright/test';
import type { SteelReviewTable, SteelReviewRow, SteelReviewOperation, SteelReviewRecovery } from 'librechat-data-provider';
import type { Auth, Fixture } from './steel-calculation-fixture';
import type { Page } from '@playwright/test';
import { deleteConversations, deleteMessagesByConversation, withMongo } from './db';
import { getAccessToken } from './helpers';
import {
  seedCalculation, readTable, saveApi, readback, openEditor, saveUi, reviewUrl,
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

async function readBoundFixture(page: Page, auth: Auth, fixture: Fixture): Promise<SteelReviewTable> {
  const owner = await readTable(page, auth, fixture);
  expect(named(owner, 'REVIEW-PROCESS').system?.parentRowId).toBe(named(owner, 'REVIEW-FLAT-A').rowId);
  expect(named(owner, 'REVIEW-PROCESS').source).toEqual(named(owner, 'REVIEW-FLAT-A').source);
  return owner;
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
    const owner = await readBoundFixture(page, auth, fixture);
    const parent = named(owner, 'REVIEW-FLAT-A');
    const process = named(owner, 'REVIEW-PROCESS');
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    const heading = page.locator('h2[data-markdown-title]').filter({ hasText: 'system_order' });
    await expect(heading).toContainText('Latest version');
    await expect(heading).not.toContainText(/v\d/);
    await expectBusinessEditable(dialog, process.rowId, owner.headers);
    await editBusinessValue(dialog, parent.rowId, '數量', '5');
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('2');
    await editBusinessValue(dialog, process.rowId, '總數', '7');
    await editBusinessValue(dialog, process.rowId, '單價', '9');
    expect(await readback(fixture)).toEqual(before);
    const saved = await saveUi(page, dialog);
    await expect(heading).toContainText('Latest version v2');
    expect(named(saved, 'REVIEW-PROCESS').values['總數']).toEqual({ baseline: '2', effective: '7' });
    const processCell = dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true }).locator('xpath=ancestor::td');
    await expect(processCell.locator('del')).toHaveText('2');
    const after = await readback(fixture);
    expect(before.messages[0].text).toContain(after.reviews[0].aiBaselineMarkdown);
    expect(after.quotation?.currentSystemOrder.customerQuoteMarkdown).toContain('| 總計 |  | 133 |');
    expect(after.messages[0].text).not.toContain('<del');
    expect(after.messages[0].text).not.toContain('~~');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(page.getByText('MATERIAL-SUFFIX', { exact: true })).toBeVisible();
    await expect(heading).toContainText('Latest version v2');
    await expect(page.locator('del')).toHaveCount(0);
    const reloaded = await openEditor(page, fixture);
    await expect(reloaded.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('7');
    await expect(reloaded.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true }).locator('xpath=ancestor::td').locator('del')).toHaveText('2');
    expect(await readback(fixture)).toEqual(after);
  });
  test('per-piece calculation UI is draft-only without history controls and saves clean values with persistent AI comparison', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await readBoundFixture(page, auth, fixture);
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
    await expect(amount).toHaveValue('');
    await expect(amount).toHaveValue('2');
    await editBusinessValue(dialog, process.rowId, '單價', '11');
    const firstSaved = await saveUi(page, dialog);
    expect(named(firstSaved, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ mode: 'perPiece', amount: '2', unit: '刀' });
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true }).locator('xpath=ancestor::td').locator('del')).toHaveText('2');
    await editBusinessValue(dialog, parent.rowId, '數量', '5');
    await editBusinessValue(dialog, process.rowId, '單價', '12');
    await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('10');
    const saved = await saveUi(page, dialog);
    expect(saved.changedRowIds.sort()).toEqual([parent.rowId, process.rowId].sort());
    expect(named(saved, 'REVIEW-PROCESS').calculation?.measurement).toMatchObject({ mode: 'perPiece', amount: '2', unit: '刀' });
    const after = await readback(fixture);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('MATERIAL-SUFFIX', { exact: true })).toBeVisible();
    await expect(page.locator('del')).toHaveCount(0);
    const reloaded = await openEditor(page, fixture);
    await expect(reloaded.getByRole('textbox', { name: `Measurement amount ${process.rowId}`, exact: true })).toHaveValue('2');
    await expect(reloaded.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveValue('10');
    await expect(reloaded.getByRole('textbox', { name: `單價 ${process.rowId}`, exact: true })).toHaveValue('12');
    expect(await readback(fixture)).toEqual(after);
  });

  test('whole batch UI keeps its amount through quantity changes and invalid measurement input stays a draft', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await readBoundFixture(page, auth, fixture);
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
    const owner = await readBoundFixture(page, auth, fixture);
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

  for (const phase of ['prepare', 'commit']) {
    test(`Save ${phase} locks measurement editing and prevents closing until latest Markdown is confirmed`, async ({ page }) => {
      const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
      const owner = await readBoundFixture(page, auth, fixture);
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
      await page.route(`**${reviewUrl(fixture.conversationId)}/${phase}`, async (route) => {
        entered(); await blocked; await route.continue();
      }, { times: 1 });
      const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/review/system_order/commit'));
      try {
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await received;
        await expect(amount).toBeDisabled();
        await expect(dialog.getByRole('textbox', { name: `總數 ${process.rowId}`, exact: true })).toHaveCount(0);
        await expect(dialog.getByRole('combobox', { name: `Measurement mode ${process.rowId}`, exact: true })).toBeDisabled();
        await expect(dialog.getByRole('combobox', { name: `類別 ${process.rowId}`, exact: true })).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'Close', exact: true }).first()).toBeDisabled();
        await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        expect(await readback(fixture)).toEqual(before);
      } finally {
        release();
      }
      const response = await committed;
      expect(response.status(), await response.text()).toBe(200);
      await expect(amount).toHaveValue('2');
      await expect(amount).toBeEditable();
      const current = await readTable(page, auth, fixture);
      expect(named(current, 'REVIEW-PROCESS').values['總數'].effective).toBe('4');
      const after = await readback(fixture);
      expect(after.messages).toHaveLength(before.messages.length);
      expect(current.outputId).toBe(owner.outputId);
      expect(before.messages[0].text).toContain(after.reviews[0].aiBaselineMarkdown);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    });
  }

  test('measurement conflict keeps the UI draft and retries against the latest saved owner version', async ({ page }) => {
    const fixture = await seedCalculation('flat', '', true); fixtures.push(fixture);
    const owner = await readBoundFixture(page, auth, fixture);
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
