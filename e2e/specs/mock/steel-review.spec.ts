import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
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
});
