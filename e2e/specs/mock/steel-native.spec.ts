import path from 'path';
import { readFileSync } from 'fs';
import { expect, test } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  selectMockEndpoint,
  sendMessageByButton,
  sendMessage,
  uploadProviderFile,
} from './helpers';
import type { UploadFixture } from './helpers';

const STEEL_NATIVE_ASSERTION_MARKER = 'E2E_ASSERT_STEEL_NATIVE';
const STEEL_NATIVE_ASSERTION_FINAL_TEXT = 'E2E Steel native assertion passed';
const STEEL_NATIVE_FILE_ASSERTION_MARKER = 'E2E_ASSERT_STEEL_NATIVE_FILE:';
const STEEL_NATIVE_FILE_ASSERTION_FINAL_TEXT = 'E2E Steel native file assertion passed';
const STEEL_NATIVE_PL_OCR_MARKER = 'E2E_ASSERT_STEEL_NATIVE_PL_OCR:';
const STEEL_NATIVE_PL_OCR_FINAL_TEXT = 'E2E Steel native PL OCR confirmation passed';
const STEEL_NATIVE_PL_QUOTE_MARKER = 'E2E_ASSERT_STEEL_NATIVE_PL_QUOTE:';
const STEEL_NATIVE_PL_QUOTE_FINAL_TEXT = 'E2E Steel native PL quote passed';

const pdfFixture: UploadFixture = {
  name: 'steel-native-provider-context.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 0 >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`,
  ),
};

const plPdfFixture: UploadFixture = {
  name: 'PL.pdf',
  mimeType: 'application/pdf',
  buffer: readFileSync(path.resolve(process.cwd(), 'docs/reference/example/PL.pdf')),
};

test.describe('Steel native chat', () => {
  test('exposes Steel context/tools and renders native activity by default', async ({ page }) => {
    test.setTimeout(90000);

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const response = await sendMessage(page, STEEL_NATIVE_ASSERTION_MARKER);
    expect(response.ok()).toBeTruthy();

    const assistantMessage = messagesView(page)
      .locator('.message-render')
      .filter({ hasText: STEEL_NATIVE_ASSERTION_FINAL_TEXT })
      .last();

    await expect(assistantMessage.locator('.agent-turn')).toBeVisible();
    await expect(assistantMessage.getByText(STEEL_NATIVE_ASSERTION_FINAL_TEXT)).toBeVisible();
    await expect(assistantMessage.locator('table tbody tr').first().locator('td').nth(1)).toHaveText(
      '10',
    );
    await expect(assistantMessage.getByLabel('Steel activity')).toBeVisible({ timeout: 30000 });
    await expect(assistantMessage.getByText('Steel form parsed')).toBeVisible();
    await expect(assistantMessage.getByText('Steel quote state saved')).toBeVisible();
  });

  test('keeps PDF provider files visible during the native Steel quote flow', async ({ page }) => {
    test.setTimeout(90000);

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    await uploadProviderFile(page, pdfFixture);
    await expect(page.getByRole('button', { name: pdfFixture.name })).toBeVisible();

    const response = await sendMessage(
      page,
      `${STEEL_NATIVE_FILE_ASSERTION_MARKER}${pdfFixture.name}`,
    );
    expect(response.ok()).toBeTruthy();

    const assistantMessage = messagesView(page)
      .locator('.message-render')
      .filter({ hasText: STEEL_NATIVE_FILE_ASSERTION_FINAL_TEXT })
      .last();

    await expect(assistantMessage.locator('.agent-turn')).toBeVisible();
    await expect(
      assistantMessage.getByText(`${STEEL_NATIVE_FILE_ASSERTION_FINAL_TEXT}: ${pdfFixture.name}`),
    ).toBeVisible();
    await expect(messagesView(page).getByRole('button', { name: pdfFixture.name })).toBeVisible();
    await expect(assistantMessage.getByLabel('Steel activity')).toBeVisible({ timeout: 30000 });
  });

  test('gates PL.pdf OCR confirmation before quoting confirmed rows', async ({ page }) => {
    test.setTimeout(120000);

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    await uploadProviderFile(page, plPdfFixture);
    await expect(page.getByRole('button', { name: plPdfFixture.name })).toBeVisible();

    let response = await sendMessage(page, `${STEEL_NATIVE_PL_OCR_MARKER}${plPdfFixture.name}`);
    expect(response.ok()).toBeTruthy();

    const ocrMessage = messagesView(page)
      .locator('.message-render')
      .filter({ hasText: STEEL_NATIVE_PL_OCR_FINAL_TEXT })
      .last();

    await expect(ocrMessage.locator('.agent-turn')).toBeVisible();
    await expect(ocrMessage.getByText(STEEL_NATIVE_PL_OCR_FINAL_TEXT)).toBeVisible();
    await expect(ocrMessage.getByText('OCR 結果確認')).toBeVisible();
    await expect(ocrMessage.locator('table tbody tr')).toHaveCount(2);
    await expect(ocrMessage.getByText('公司編號')).toHaveCount(0);
    await expect(ocrMessage.getByText('customer_quote')).toHaveCount(0);

    response = await sendMessageByButton(
      page,
      `${STEEL_NATIVE_PL_QUOTE_MARKER}${plPdfFixture.name} 確認上一輪資料正確，請產生報價。`,
    );
    expect(response.ok()).toBeTruthy();

    const quoteMessage = messagesView(page)
      .locator('.message-render')
      .filter({ hasText: STEEL_NATIVE_PL_QUOTE_FINAL_TEXT })
      .last();

    await expect(quoteMessage.locator('.agent-turn')).toBeVisible();
    await expect(quoteMessage.getByText(STEEL_NATIVE_PL_QUOTE_FINAL_TEXT)).toBeVisible();
    await expect(quoteMessage.locator('table tbody tr').first().locator('td').nth(1)).toHaveText(
      '10',
    );
    await expect(quoteMessage.getByLabel('Steel activity')).toBeVisible({ timeout: 30000 });
    await expect(messagesView(page).getByRole('button', { name: plPdfFixture.name })).toBeVisible();
  });
});
