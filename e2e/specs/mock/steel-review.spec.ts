import Papa from 'papaparse';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
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
      filepath: '/tmp/steel-source-review-fixtures/alpha.pdf',
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

async function persistedSnapshot(conversationId: string) {
  return withMongo(async (db) => ({
    messages: await db.collection('messages').find({ conversationId }).toArray(),
    ocr: await db.collection('steel_conversation_ocr_state').findOne({ conversationId }),
    reviews: await db.collection('steel_review_outputs').find({ conversationId }).toArray(),
  }));
}

function readUrl(conversationId: string, messageId: string, tableIndex: number) {
  const query = new URLSearchParams({ messageId, tableId: `ocr_result:${tableIndex}` });
  return `/api/steel/conversations/${conversationId}/review/ocr_result?${query}`;
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
      await db.collection('files').deleteMany({ conversationId: { $in: ids } });
    });
    await deleteConversations(ids);
  });

  test('only the canonical table opens and read/reload leaves DB and unrelated text unchanged', async ({ page }) => {
    const markdown = [
      'REVIEW-UNRELATED-PREFIX',
      '## Ordinary table\n| Label | Value |\n| --- | --- |\n| Plain | Keep |',
      ocr,
      '## ocr_result\n| 來源 | 零件編號 | 長度 | 數量 | 頁碼 |\n| --- | --- | --- | --- | --- |\n| A | UNMANAGED | 5 | 9 | 1 |',
      '## customer_quote\n| Item | Subtotal |\n| --- | --- |\n| Keep quote | 42 |',
      '```markdown\n' + ocr + '\n```',
      'REVIEW-UNRELATED-SUFFIX',
    ].join('\n\n');
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const target = await page.request.get(readUrl(conversationId, messageId, 2), { headers });
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
    const unbound = await page.request.get(readUrl(conversationId, messageId, 3), { headers });
    expect(unbound.status()).toBe(404);
    await page.goto(`/c/${conversationId}`);
    await expect(page.getByText('REVIEW-UNRELATED-SUFFIX', { exact: true })).toBeVisible();
    const button = page.getByRole('button', { name: 'Open Steel review', exact: true });
    await expect(button).toHaveCount(1);
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('REVIEW-P1', { exact: true })).toBeVisible();
    await expect(dialog.getByText('REVIEW-P2', { exact: true })).toBeVisible();
    await expect(dialog.getByText('UNMANAGED', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open Steel review', exact: true })).toHaveCount(1);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a normal upload attached to a prior user message locates its source without File conversation metadata', async ({ page }) => {
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
    await withMongo(async (db) => {
      await db.collection('files').updateOne({ conversationId, file_id: 'review-alpha' }, {
        $unset: { conversationId: '', messageId: '' },
      });
    });
    try {
      const before = await persistedSnapshot(conversationId);
      const result = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(result.status()).toBe(200);
      expect(await result.json()).toMatchObject({ table: { rows: [
        { source: { fileId: 'review-alpha', pageNumber: 1 } },
        { source: { fileId: 'review-alpha', pageNumber: 1 } },
      ] } });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
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
    const result = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(result.status()).toBe(200);
    const data = await result.json();
    expect(data).toMatchObject({ table: { isLatest: true, rows: [{ source: { fileId: 'review-alpha' } }, { source: { fileId: 'review-alpha' } }] } });
    expect(data.table.partIndex).toBeUndefined();
    await page.goto(`/c/${conversationId}`);
    await expect(page.getByRole('button', { name: 'Open Steel review', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(dialog.getByText('REVIEW-P1', { exact: true })).toBeVisible();
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
    const result = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
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
    const result = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
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
    const foreign = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(foreign.status()).toBe(200);
    const foreignBody = await foreign.json();
    expect(foreignBody).toMatchObject({ table: { rows: [{ source: null }, { source: null }] } });
    expect(JSON.stringify(foreignBody)).not.toContain('PRIVATE-FOREIGN');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await withMongo(async (db) => {
      await db.collection('files').deleteOne({ conversationId, file_id: 'review-alpha' });
    });
    const missing = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
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
      const foreign = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
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
      const duplicate = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
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
    const result = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
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
      const result = await page.request.get(readUrl(conversationId, messageId, 2), { headers });
      expect(result.status()).toBe(404);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('a historical sidecar updated later cannot mask the authoritative current output', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      const message = await db.collection('messages').findOne({ conversationId, messageId });
      if (!message) {
        throw new Error('Missing fixture message');
      }
      const rows = [
        ['A', 'REVIEW-P1', '1000', '2', '1'],
        ['A', 'REVIEW-P2', '2000', '3', '1'],
      ].map((values, i) => ({
        rowId: `identity-row-${i}`,
        source: null,
        values: Object.fromEntries(['來源', '零件編號', '長度', '數量', '頁碼'].map((key, j) => [key, {
          baseline: values[j], effective: values[j],
        }])),
      }));
      const owner = {
        userId: message.user,
        conversationId,
        messageId,
        kind: 'ocr_result',
        tableId: 'ocr_result:1',
        headers: ['來源', '零件編號', '長度', '數量', '頁碼'],
        rows,
        createdAt: new Date(),
      };
      await db.collection('steel_review_outputs').insertMany([
        { ...owner, outputId: 'ocr_result:review-proof-generation', revision: 'current-sidecar', state: 'current', updatedAt: new Date(1) },
        { ...owner, outputId: 'ocr_result:historical-generation', revision: 'historical-sidecar', state: 'historical', updatedAt: new Date() },
      ]);
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(result.status()).toBe(200);
    expect(await result.json()).toMatchObject({ table: {
      outputId: 'ocr_result:review-proof-generation', revision: 'current-sidecar', isLatest: true, readOnly: false,
    } });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('identical duplicate tables are ambiguous and get no managed target', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(`${ocr}\n\n${ocr}`);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    for (const tableIndex of [1, 2]) {
      const result = await page.request.get(readUrl(conversationId, messageId, tableIndex), { headers });
      expect(result.status()).toBe(404);
    }
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('real multi-PDF/image preview filters independent page rows and never writes the chat', async ({ page }) => {
    const markdown = [
      'PREVIEW-KEEP-PREFIX',
      '## ocr_result',
      '| 來源 | 零件編號 | 長度 | 數量 | 頁碼 |',
      '| --- | --- | --- | --- | --- |',
      '| A | ALPHA-ONE-A | 1000 | 2 | 1 |',
      '| A | ALPHA-ONE-B | 1000 | 2 | 1 |',
      '| A | ALPHA-TWO | 2000 | 3 | 2 |',
      '| B | BETA-TWO | 2000 | 3 | 2 |',
      '| B | BETA-ONE | 2000 | 3 | 1 |',
      '| C | GAMMA-ONE | 3000 | 4 | 1 |',
      '| D | UNPREVIEWABLE-SOURCE | 3000 | 4 | 1 |',
      '| A | OUT-OF-RANGE-PAGE | 3000 | 4 | 99 |',
      '|  | UNLOCATED-PREVIEW | 4000 | 5 |  |',
      'PREVIEW-KEEP-SUFFIX',
    ].join('\n');
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      const alpha = await db.collection('files').findOne({ conversationId, file_id: 'review-alpha' });
      if (!alpha) throw new Error('Missing fixture file');
      const file = alpha;
      await db.collection('files').insertMany([
        { ...file, _id: new ObjectId(), file_id: 'review-beta', filename: 'beta.pdf', filepath: '/tmp/steel-source-review-fixtures/beta.pdf' },
        { ...file, _id: new ObjectId(), file_id: 'review-gamma', filename: 'gamma.png', filepath: '/tmp/steel-source-review-fixtures/gamma.png', type: 'image/png' },
        { ...file, _id: new ObjectId(), file_id: 'review-unpreviewable', filename: 'delta.heic', type: 'image/heic' },
        { ...file, _id: new ObjectId(), file_id: 'review-foreign-tenant', filename: 'foreign-tenant.pdf', tenantId: 'different-tenant' },
      ]);
      await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
        currentOcrResultMarkdown: markdown,
        sourceMappings: [
          { fileId: 'review-alpha', sourceCode: 'A', sourceFilename: 'alpha.pdf' },
          { fileId: 'review-beta', sourceCode: 'B', sourceFilename: 'beta.pdf' },
          { fileId: 'review-gamma', sourceCode: 'C', sourceFilename: 'gamma.png' },
          { fileId: 'review-unpreviewable', sourceCode: 'D', sourceFilename: 'delta.heic' },
        ],
      } });
    });
    const before = await persistedSnapshot(conversationId);
    const sourcesUrl = `/api/steel/conversations/${conversationId}/review/ocr_result/sources?${new URLSearchParams({ messageId, tableId: 'ocr_result:1' })}`;
    const sources = await page.request.get(sourcesUrl, { headers });
    expect(sources.status()).toBe(200);
    expect(await sources.json()).toMatchObject({ sources: [
      { fileId: 'review-alpha' }, { fileId: 'review-beta' }, { fileId: 'review-gamma' },
    ] });
    const foreign = await page.request.get(`${sourcesUrl.split('?')[0]}/review-foreign-tenant?${new URLSearchParams({ messageId })}`, { headers });
    expect(foreign.status()).toBe(404);
    const missingOwnerQuery = new URLSearchParams({ messageId: 'missing-review-owner' });
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
    await expect(dialog.getByText('ALPHA-ONE-A', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ALPHA-ONE-B', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ALPHA-TWO', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('UNLOCATED-PREVIEW', { exact: true })).toBeVisible();
    await expect(dialog.getByText('UNPREVIEWABLE-SOURCE', { exact: true })).toBeVisible();
    await expect(dialog.getByText('OUT-OF-RANGE-PAGE', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(dialog.getByText('ALPHA-TWO', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ALPHA-ONE-A', { exact: true })).toHaveCount(0);
    await expect.poll(checksum).not.toBe('');
    await expect.poll(checksum).not.toBe(firstPage);
    await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(dialog.getByText('BETA-TWO', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Previous page', exact: true }).click();
    await expect(dialog.getByText('BETA-ONE', { exact: true })).toBeVisible();
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
    await dialog.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'gamma.png', exact: true }).click();
    const image = dialog.getByRole('img', { name: 'Source page preview', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(800);
    await expect(dialog.getByText('GAMMA-ONE', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await expect(dialog.getByText('ALPHA-ONE-A', { exact: true })).toBeVisible();
    const fullscreenBounds = await dialog.boundingBox();
    expect(fullscreenBounds?.x).toBeCloseTo(0, 0);
    expect(fullscreenBounds?.y).toBeCloseTo(0, 0);
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    // Radix positions and focuses the selected item after opening its portal.
    // Exercise Escape after the menu's observable keyboard readiness.
    await expect(page.getByRole('option', { name: 'alpha.pdf', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(page.getByText('PREVIEW-KEEP-PREFIX', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const themeColors: string[] = [];
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => localStorage.setItem('color-theme', value), mode);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(new RegExp(mode));
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      await expect(dialog.getByText('ALPHA-ONE-A', { exact: true })).toBeVisible();
      await expect.poll(checksum).not.toBe('');
      const narrowBounds = await dialog.boundingBox();
      expect(narrowBounds?.width).toBeLessThanOrEqual(390);
      await expect(dialog.getByRole('combobox', { name: 'Source file', exact: true })).toBeVisible();
      themeColors.push(await dialog.evaluate((element) => getComputedStyle(element).backgroundColor));
      await dialog.getByRole('combobox', { name: 'Source file', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
    expect(themeColors[0]).not.toBe(themeColors[1]);
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
    const query = new URLSearchParams({ messageId });
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
    await expect(dialog.getByText('REVIEW-P1', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/loading.*(source|files)/i)).toBeVisible();
    releaseRequest();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByText('REVIEW-P2', { exact: true })).toBeVisible();
    await page.unroute(isSourceList);
    await dialog.getByRole('button', { name: /retry/i }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => dialog.locator('canvas').evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await expect(dialog.getByText('REVIEW-P1', { exact: true })).toBeVisible();
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
      const review = await page.request.get(readUrl(current.conversationId, current.messageId, 1), { headers });
      expect(review.status()).toBe(200);
      expect(await review.json()).toMatchObject({ table: {
        rows: [{ source: null }, { source: null }],
      } });
      const root = `/api/steel/conversations/${current.conversationId}/review/ocr_result/sources`;
      const query = new URLSearchParams({ messageId: current.messageId });
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
      const review = await page.request.get(readUrl(current.conversationId, current.messageId, 1), { headers });
      expect(review.status()).toBe(200);
      expect(await review.json()).toMatchObject({ table: {
        rows: [{ source: null }, { source: null }],
      } });
      const root = `/api/steel/conversations/${current.conversationId}/review/ocr_result/sources`;
      const query = new URLSearchParams({ messageId: current.messageId });
      const list = await page.request.get(`${root}?${query}`, { headers });
      expect(list.status()).toBe(200);
      expect(await list.json()).toEqual({ sources: [] });
      const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
      expect(binary.status()).toBe(404);
      await page.goto(`/c/${current.conversationId}`);
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Steel source review' });
      await expect(dialog.getByText('REVIEW-P1', { exact: true })).toBeVisible();
      await expect(dialog.getByText('REVIEW-P2', { exact: true })).toBeVisible();
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
      const review = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(review.status()).toBe(404);
      const root = `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
      const query = new URLSearchParams({ messageId });
      const list = await page.request.get(`${root}?${query}`, { headers });
      expect(list.status()).toBe(200);
      expect(await list.json()).toEqual({ sources: [] });
      const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
      expect(binary.status()).toBe(404);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });


  test('manual OCR Save changes only the clicked message and chat reload shows clean saved values', async ({ page }) => {
    const markdown = [
      'SAVE-KEEP-PREFIX',
      ocr,
      '## Keep this table\n| Label | Value |\n| --- | --- |\n| Unrelated | 4242 |',
      'SAVE-KEEP-SUFFIX',
    ].join('\n\n');
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const previousMessageId = randomUUID();
    const previousMarkdown = ocr.replace('REVIEW-P1', 'PREVIOUS-SAME-TITLE').replace('| 1000 | 2 |', '| 1000 | 97 |');
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: previousMessageId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: previousMarkdown,
      content: [{ type: 'text', text: previousMarkdown }],
      isCreatedByUser: false,
      sender: 'Assistant',
    }]);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, { $set: {
        parentMessageId: previousMessageId,
        text: `${markdown} SAVE-SECOND-PART-KEEP`,
        content: [{ type: 'text', text: markdown }, { type: 'text', text: 'SAVE-SECOND-PART-KEEP' }],
      } });
      await db.collection('messages').updateOne({ conversationId, messageId: previousMessageId }, {
        $set: { createdAt: new Date(Date.now() - 60_000), updatedAt: new Date(Date.now() - 60_000) },
      });
    });
    const otherChat = await seedCurrent(ocr.replace('REVIEW-P1', 'OTHER-CHAT-SAME-TITLE'));
    conversations.push(otherChat.conversationId);
    const before = await persistedSnapshot(conversationId);
    const otherBefore = await persistedSnapshot(otherChat.conversationId);
    const previousBefore = before.messages.find((message) => message.messageId === previousMessageId);
    const recognized = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(recognized.status()).toBe(200);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
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
    }).toContain('| A | REVIEW-P1 | 1000 | 9 | 1 |');
    const after = await persistedSnapshot(conversationId);
    const savedMessage = after.messages.find((message) => message.messageId === messageId);
    const expectedMarkdown = markdown.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 9 | 1 |');
    expect(savedMessage?.text).toBe(`${expectedMarkdown} SAVE-SECOND-PART-KEEP`);
    expect(savedMessage?.content).toEqual([
      { type: 'text', text: expectedMarkdown },
      { type: 'text', text: 'SAVE-SECOND-PART-KEEP' },
    ]);
    expect(after.messages.find((message) => message.messageId === previousMessageId)).toEqual(previousBefore);
    expect(await persistedSnapshot(otherChat.conversationId)).toEqual(otherBefore);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
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
    await expect(page.getByText('Updated', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Updated', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).last().click();
    await expect(quantity).toHaveValue('9');
    await expect(dialog.locator('del').filter({ hasText: /^2$/ })).toBeVisible();
    expect((await persistedSnapshot(conversationId)).messages.find((message) => message.messageId === previousMessageId)).toEqual(previousBefore);
  });


  test('dirty OCR Escape offers continue and discard without saving the chat', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
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
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 11 | 1 |'));
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
    const recognized = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(recognized.status()).toBe(200);
    const replacement = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 99 | 1 |');
    for (const data of [{ text: replacement, model: 'gpt-4o' }, { text: replacement, index: 0, model: 'gpt-4o' }]) {
      const response = await page.request.put(`/api/messages/${conversationId}/${messageId}`, { headers, data });
      expect(response.status()).toBe(409);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
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
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
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
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
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


  test('OCR download saves the focused draft and exports the confirmed clean snapshot', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('8');
    const downloadReady = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download.*CSV/i }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('Missing completed CSV download');
    const csv = await readFile(downloadedPath, 'utf8');
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toEqual([
      { 來源: 'A', 零件編號: 'REVIEW-P1', 長度: '1000', 數量: '8', 頁碼: '1' },
      { 來源: 'A', 零件編號: 'REVIEW-P2', 長度: '2000', 數量: '3', 頁碼: '1' },
    ]);
    expect(csv).not.toMatch(/<del>|~~|Updated|Previous version/);
    const saved = await persistedSnapshot(conversationId);
    expect(saved.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    const unchangedDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download.*CSV/i }).click();
    await unchangedDownload;
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

});
