import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Auth, Fixture } from './steel-calculation-fixture';
import {
  deleteConversations,
  deleteMessagesByConversation,
  withMongo,
} from './db';
import { getAccessToken } from './helpers';
import {
  openEditor,
  readTable,
  readback,
  saveUi,
  seedCalculation,
} from './steel-calculation-fixture';

function row(dialog: Locator, rowId: string): Locator {
  return dialog.locator(`tr[data-row-id="${rowId}"]`);
}

async function addItem(dialog: Awaited<ReturnType<typeof openEditor>>, existingIds: Set<string>): Promise<string> {
  await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
  const candidateRows = dialog.locator('tbody tr[data-row-id]');
  await expect.poll(async () => {
    const ids = await candidateRows.evaluateAll((elements) => elements
      .map((element) => element.getAttribute('data-row-id'))
      .filter((value): value is string => Boolean(value)));
    return ids.find((id) => !existingIds.has(id)) ?? '';
  }).not.toBe('');
  const ids = await candidateRows.evaluateAll((elements) => elements
    .map((element) => element.getAttribute('data-row-id'))
    .filter((value): value is string => Boolean(value)));
  const added = ids.find((id) => !existingIds.has(id));
  if (!added) throw new Error('Missing Add row row identity');
  return added;
}

async function fillNotes(dialog: Locator, rowId: string, value: string): Promise<void> {
  const notes = dialog.getByRole('textbox', { name: `備註 ${rowId}`, exact: true });
  await notes.fill(value);
  await notes.blur();
}

async function captureIfRequested(page: Page, suffix = ''): Promise<void> {
  const output = process.env.STEEL_REVIEW_UI_SCREENSHOT;
  if (!output) return;
  const path = suffix ? output.replace(/(\.[^.]+)?$/u, `-${suffix}$1`) : output;
  await page.setViewportSize({ width: 1660, height: 1000 });
  await page.screenshot({ path, fullPage: false, animations: 'disabled' });
}

async function expectFixedReviewGeometry(dialog: Locator, rowCount: number): Promise<void> {
  const preview = dialog.getByRole('region', { name: 'Source page preview', exact: true });
  const table = dialog.getByRole('table', { name: 'Steel review table', exact: true });
  const tableViewport = table.locator('xpath=..');
  const footerSave = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(preview).toBeVisible();
  await expect(table).toBeVisible();
  await expect(table.locator('thead tr')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toHaveCount(rowCount);
  await expect(footerSave).toBeVisible();
  const close = footerSave.locator('xpath=../..').getByRole('button', { name: 'Close', exact: true });
  const addRow = dialog.getByRole('button', { name: 'Add row', exact: true });
  const viewUnlinked = dialog.getByRole('checkbox', { name: 'View unlinked', exact: true });
  const [closeBox, saveBox, addBox, checkboxBox] = await Promise.all([
    close.boundingBox(), footerSave.boundingBox(), addRow.boundingBox(), viewUnlinked.boundingBox(),
  ]);
  if (!closeBox || !saveBox || !addBox || !checkboxBox) throw new Error('Missing review action layout');
  expect(closeBox.x + closeBox.width).toBeLessThan(saveBox.x);
  expect(checkboxBox.x + checkboxBox.width).toBeLessThan(addBox.x);
  await expect(footerSave).toHaveClass(/bg-surface-submit/u);
  await expect(close).toHaveClass(/border-border-light/u);
  const caption = dialog.getByText(/^Unsaved changes:/u);
  if (await caption.count()) {
    const captionBox = await caption.boundingBox();
    if (!captionBox) throw new Error('Missing dirty-caption bounds');
    expect(captionBox.x + captionBox.width).toBeLessThanOrEqual(saveBox.x);
  }

  const viewport = await dialog.page().evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const previewBox = await preview.boundingBox();
  const tableViewportBox = await tableViewport.boundingBox();
  const footerBox = await footerSave.boundingBox();
  const rowBoxes = await Promise.all(Array.from({ length: rowCount }, (_, index) =>
    table.locator('tbody tr').nth(index).boundingBox()));
  for (const [label, box] of [
    ['preview', previewBox], ['table viewport', tableViewportBox], ['footer', footerBox],
  ] as const) {
    expect(box, `${label} has no layout bounds`).not.toBeNull();
    if (!box) continue;
    expect(box.width, `${label} width`).toBeGreaterThan(0);
    expect(box.height, `${label} height`).toBeGreaterThan(0);
    expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
  }
  if (tableViewportBox) {
    rowBoxes.forEach((box, index) => {
      expect(box, `row ${index + 1} has no layout bounds`).not.toBeNull();
      if (!box) return;
      expect(box.y, `row ${index + 1} top`).toBeGreaterThanOrEqual(tableViewportBox.y - 1);
      expect(box.y + box.height, `row ${index + 1} bottom`).toBeLessThanOrEqual(
        tableViewportBox.y + tableViewportBox.height + 1,
      );
    });
  }
}

test.describe('Steel source review normal UI acceptance', () => {
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
      for (const collection of [
        'files',
        'steel_conversation_ocr_state',
        'steel_review_outputs',
        'steel_quotation_states',
        'steel_quotation_artifacts',
      ]) {
        await database.collection(collection).deleteMany({ conversationId: { $in: ids } });
      }
    });
    await deleteConversations(ids);
  });

  test('bind popup keeps an unlinked row until real Save and reload reconciles membership', async ({ page }) => {
    const fixture = await seedCalculation('plate', '', false, { withSources: true });
    fixtures.push(fixture);
    const before = await readback(fixture);
    const dialog = await openEditor(page, fixture);
    const initial = await readTable(page, auth, fixture);
    const initialIds = new Set(initial.rows.map((entry) => entry.rowId));

    await expect(dialog.locator('thead tr')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: /Undo|Redo|Expand|Fullscreen|Download/iu })).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: 'View unlinked', exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Source file', exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Page', exact: true })).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'View unlinked', exact: true }).check();
    await expect(dialog.locator('tbody tr')).toHaveCount(2);
    const targetId = [...initialIds][0];
    if (!targetId) throw new Error('Missing initial review row identity');
    const notes = dialog.getByRole('textbox', { name: `備註 ${targetId}`, exact: true });
    const originalNotes = await notes.inputValue();
    const editedNotes = `${originalNotes} ESCAPE-${fixture.conversationId.slice(0, 8)}`;
    await notes.fill(editedNotes);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(notes).toHaveValue(editedNotes);
    await expect(dialog.getByText(/Unsaved changes: 1 rows/u)).toBeVisible();
    await notes.fill(originalNotes);
    await notes.blur();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expectFixedReviewGeometry(dialog, 2);

    const target = row(dialog, targetId);
    const linkButton = target.getByRole('button', { name: `Link ${targetId}`, exact: true });
    await expect(linkButton).toHaveText('');
    await expect(linkButton).toHaveClass(/bg-transparent/u);
    await expect(linkButton.locator('svg')).toHaveClass(/lucide-link-2/u);
    await linkButton.scrollIntoViewIfNeeded();
    await linkButton.hover();
    const linkBox = await linkButton.boundingBox();
    if (!linkBox) throw new Error('Missing Link button bounds');
    await page.mouse.move(linkBox.x + 5, linkBox.y + 5, { steps: 5 });
    await page.mouse.move(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2, { steps: 5 });
    await expect(page.locator('[role="tooltip"]').filter({ hasText: /^Link$/u })).toBeVisible();
    await linkButton.click();
    const bindDialog = page.getByRole('dialog', { name: /Link source/iu });
    await expect(bindDialog).toBeVisible();
    await expect(bindDialog.getByRole('combobox', { name: 'Source file', exact: true })).toHaveText('alpha.pdf');
    await expect(bindDialog.getByRole('combobox', { name: /page/iu })).toHaveText('1');
    await bindDialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(bindDialog).toHaveCount(0);
    const linkedButton = target.getByRole('button', { name: `Linked ${targetId}`, exact: true });
    await expect(linkedButton).toBeVisible();
    await expect(linkedButton).toHaveClass(/bg-surface-inverted/u);
    await expect(linkedButton).not.toHaveClass(/bg-surface-submit/u);
    await expect(linkedButton.locator('svg')).toHaveClass(/lucide-link-2/u);
    await linkedButton.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('[role="tooltip"]').filter({ hasText: /^Linked$/u })).toBeVisible();
    await dialog.getByRole('heading', { name: 'Steel source review', exact: true }).click();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(target).toBeVisible();
    await expectFixedReviewGeometry(dialog, 2);
    await captureIfRequested(page);
    const deleteButton = target.getByRole('button', { name: `Delete row ${targetId}`, exact: true });
    const normalDeleteColor = await deleteButton.evaluate((element) => getComputedStyle(element).color);
    await deleteButton.hover();
    await expect.poll(() => deleteButton.evaluate((element) => getComputedStyle(element).color)).not.toBe(normalDeleteColor);
    await captureIfRequested(page, 'delete-hover');
    await dialog.getByRole('heading', { name: 'Steel source review', exact: true }).click();
    const footerSave = dialog.getByRole('button', { name: 'Save', exact: true });
    await footerSave.locator('xpath=../..').getByRole('button', { name: 'Close', exact: true }).click();
    const closeConfirm = dialog.getByRole('alertdialog', { name: 'You have unsaved changes.', exact: true });
    await expect(closeConfirm).toBeVisible();
    await captureIfRequested(page, 'close-unsaved');
    await closeConfirm.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(closeConfirm).toHaveCount(0);
    await expect(target).toBeVisible();

    const draft = await readback(fixture);
    expect(draft).toEqual(before);
    await target.getByRole('button', { name: `Linked ${targetId}`, exact: true }).click();
    const reopenedBindDialog = page.getByRole('dialog', { name: /Link source/iu });
    await expect(reopenedBindDialog.getByRole('combobox', { name: 'Source file', exact: true })).toHaveText('alpha.pdf');
    await expect(reopenedBindDialog.getByRole('combobox', { name: /page/iu })).toHaveText('1');
    await reopenedBindDialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await reopenedBindDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(reopenedBindDialog).toHaveCount(0);
    await expect(target.getByRole('button', { name: `Linked ${targetId}`, exact: true })).toBeVisible();
    expect(await readback(fixture)).toEqual(before);
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'View unlinked', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'View unlinked', exact: true }).check();
    await expect(target).toBeVisible();
    expect(await readback(fixture)).toEqual(before);

    const saved = await saveUi(page, dialog);
    expect(saved.rows.find((entry) => entry.rowId === targetId)?.source).toMatchObject({
      fileId: `group-alpha-${fixture.conversationId}`,
      filename: 'alpha.pdf',
      pageNumber: 1,
    });
    await expect(dialog.locator(`tr[data-row-id="${targetId}"]`)).toHaveCount(0);
    await expect(dialog.locator('tbody tr')).toHaveCount(1);
    const after = await readback(fixture);
    expect(after).not.toEqual(before);
    await captureIfRequested(page, 'after-save');
    await page.keyboard.press('Escape');
    await page.reload();
    const reopened = await openEditor(page, fixture);
    await reopened.getByRole('checkbox', { name: 'View unlinked', exact: true }).check();
    await expect(reopened.locator('tbody tr')).toHaveCount(1);
    await reopened.getByRole('checkbox', { name: 'View unlinked', exact: true }).uncheck();
    await expect(reopened.locator(`tr[data-row-id="${targetId}"]`)).toBeVisible();
    expect(await readback(fixture)).toEqual(after);
  });

  test('Add row classification and trimmed notes derive processing source, order, and cascade', async ({ page }) => {
    const fixture = await seedCalculation('plate', '', false, { withSources: true });
    fixtures.push(fixture);
    const initial = await readTable(page, auth, fixture);
    const dialog = await openEditor(page, fixture);
    const existingIds = new Set(initial.rows.map((entry) => entry.rowId));
    const materialNote = `NEW-MATERIAL-${fixture.conversationId.slice(0, 8)}`;
    const processingNote = ` ${materialNote} `;
    const unlinkedNote = `UNLINKED-${fixture.conversationId.slice(0, 8)}`;
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
    const materialId = await addItem(dialog, existingIds);
    const material = row(dialog, materialId);
    await expect(material).toBeVisible();
    await expect(material.locator('td').nth(1).locator('input, textarea, [role="combobox"]').first()).toBeFocused();
    await expect(material.getByRole('button', { name: `Linked ${materialId}`, exact: true })).toBeVisible();
    await material.getByRole('combobox', { name: `Classify ${materialId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Material', exact: true }).click();
    await fillNotes(dialog, materialId, `  ${materialNote}  `);

    const normalProcessingId = await addItem(dialog, new Set([...existingIds, materialId]));
    const normalProcessing = row(dialog, normalProcessingId);
    await normalProcessing.getByRole('combobox', { name: `Classify ${normalProcessingId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Processing', exact: true }).click();
    await fillNotes(dialog, normalProcessingId, processingNote);
    await expect(normalProcessing).toBeVisible();
    const normalRows = await dialog.locator('tbody tr[data-row-id]').evaluateAll((rows) => rows.map((entry) => entry.getAttribute('data-row-id')));
    expect(normalRows.indexOf(materialId)).toBeGreaterThanOrEqual(0);
    expect(normalRows.indexOf(normalProcessingId)).toBe(normalRows.indexOf(materialId) + 1);

    await dialog.getByRole('checkbox', { name: 'View unlinked', exact: true }).check();
    const unlinkedMaterialId = await addItem(dialog, new Set([...existingIds, materialId, normalProcessingId]));
    const unlinkedMaterial = row(dialog, unlinkedMaterialId);
    await unlinkedMaterial.getByRole('combobox', { name: `Classify ${unlinkedMaterialId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Material', exact: true }).click();
    await fillNotes(dialog, unlinkedMaterialId, unlinkedNote);

    const processingId = await addItem(dialog, new Set([
      ...existingIds, materialId, normalProcessingId, unlinkedMaterialId,
    ]));
    const processing = row(dialog, processingId);
    await processing.getByRole('combobox', { name: `Classify ${processingId}`, exact: true }).click();
    await page.getByRole('option', { name: 'Processing', exact: true }).click();
    await fillNotes(dialog, processingId, unlinkedNote);
    await expect(normalProcessing).toHaveCount(0);
    await expect(processing).toBeVisible();
    await expect(dialog.getByText(/Unsaved changes: 4 rows/u)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

    const saved = await saveUi(page, dialog);
    const savedMaterial = saved.rows.find((entry) => entry.rowId === materialId);
    const savedNormalProcessing = saved.rows.find((entry) => entry.rowId === normalProcessingId);
    const savedUnlinkedMaterial = saved.rows.find((entry) => entry.rowId === unlinkedMaterialId);
    const savedProcessing = saved.rows.find((entry) => entry.rowId === processingId);
    expect(savedNormalProcessing?.system).toMatchObject({ kind: 'processing', parentRowId: materialId });
    expect(savedNormalProcessing?.source).toEqual(savedMaterial?.source ?? null);
    expect(savedProcessing?.system).toMatchObject({ kind: 'processing', parentRowId: unlinkedMaterialId });
    expect(savedProcessing?.source).toBeNull();
    expect(savedMaterial?.source).toMatchObject({
      fileId: `group-alpha-${fixture.conversationId}`,
      filename: 'alpha.pdf',
      pageNumber: 1,
    });
    expect(savedUnlinkedMaterial?.source).toBeNull();
    const savedMaterialIndex = saved.rows.findIndex((entry) => entry.rowId === materialId);
    expect(saved.rows[savedMaterialIndex + 1]?.rowId).toBe(normalProcessingId);
    await page.keyboard.press('Escape');
    const reopened = await openEditor(page, fixture);
    await row(reopened, materialId).getByRole('button', { name: `Delete row ${materialId}`, exact: true }).click();
    await expect(row(reopened, normalProcessingId)).toHaveClass(/opacity-70/u);
    await expect(row(reopened, processingId)).toHaveCount(0);
    await saveUi(page, reopened);
    const afterDelete = await readTable(page, auth, fixture);
    expect(afterDelete.rows.find((entry) => entry.rowId === materialId)?.deleted).toBe(true);
    expect(afterDelete.rows.find((entry) => entry.rowId === normalProcessingId)?.deleted).toBe(true);
    expect(afterDelete.rows.find((entry) => entry.rowId === processingId)?.deleted).toBe(false);
    expect(afterDelete.rows.find((entry) => entry.rowId === unlinkedMaterialId)?.deleted).toBe(false);
  });
});
