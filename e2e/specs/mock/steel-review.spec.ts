import { ObjectId } from 'mongodb';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { encodeSteelReviewDigest } from 'librechat-data-provider';
import type { SteelReviewPrepared, SteelReviewSavedSnapshot, SteelReviewTable } from 'librechat-data-provider';
import type { Locator } from '@playwright/test';
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
      filepath: join(__dirname, 'fixtures', 'alpha.pdf'),
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

async function seedCapturedLegacyReview(fixtureName: 'steel-review-legacy03' | 'steel-review-legacy03-sourced' | 'steel-review-legacy04') {
  const fixture = JSON.parse(await readFile(`${__dirname}/fixtures/${fixtureName}.json`, 'utf8')) as {
    generatedFromCommit: string;
    realMongo: boolean;
    prepared: Omit<SteelReviewPrepared, 'sourceMappings' | 'sourceIntents'> &
      Partial<Pick<SteelReviewPrepared, 'sourceMappings'>> & { userId: string };
    savedSnapshot: SteelReviewSavedSnapshot;
  };
  const captured04 = fixtureName === 'steel-review-legacy04';
  expect(fixture.generatedFromCommit).toBe(captured04
    ? '65c9b2140c980c80b9797abc5909bbe5df65e072'
    : '1db96bd67f0af7c902c6c0d8556cb56f0d1dbe94');
  expect(fixture.realMongo).toBe(true);
  expect(Object.hasOwn(fixture.prepared, 'sourceMappings')).toBe(captured04);
  for (const row of fixture.prepared.rows) {
    expect(Object.hasOwn(row, 'origin')).toBe(false);
    expect(Object.hasOwn(row, 'deleted')).toBe(false);
  }
  expect(Object.hasOwn(fixture.prepared, 'sourceIntents')).toBe(false);
  expect(createHash('sha256').update(encodeSteelReviewDigest(fixture.prepared)).digest('hex'))
    .toBe(fixture.prepared.digest);
  const { conversationId, messageId } = await seedCurrent(fixture.prepared.aiBaselineMarkdown ?? '');
  const userId = await withMongo(async (db) => {
    const owner = await db.collection('messages').findOne({ conversationId, messageId });
    if (!owner) throw new Error('Missing legacy replay owner');
    return String(owner.user);
  });
  const prepared = { ...fixture.prepared, userId, conversationId, messageId };
  prepared.digest = createHash('sha256').update(encodeSteelReviewDigest(prepared)).digest('hex');
  const snapshot = { ...fixture.savedSnapshot, conversationId, messageId, digest: prepared.digest,
    ownerUpdated: fixture.savedSnapshot.ownerUpdated
      ? { ...fixture.savedSnapshot.ownerUpdated, conversationId, messageId } : undefined };
  const savedAt = new Date(snapshot.savedAt);
  const ownerUpdated = snapshot.ownerUpdated ? { ...snapshot.ownerUpdated, updatedAt: savedAt } : undefined;
  await withMongo(async (db) => {
    await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
      currentOcrResultMarkdown: prepared.aiBaselineMarkdown,
      currentOcrResultGenerationId: 'legacy-fixture-generation', sourceMappings: fixture.prepared.sourceMappings ?? [],
    } });
    await db.collection('messages').updateOne({ conversationId, messageId }, { $set: {
      text: snapshot.messageText, content: [{ type: 'text', text: snapshot.messageText }],
      metadata: { steelReview: { ocr_result: ownerUpdated } },
    } });
    await db.collection('steel_review_outputs').insertOne({
      userId, conversationId, messageId, kind: 'ocr_result', tableId: prepared.tableId,
      outputId: prepared.outputId, revision: snapshot.revision, state: 'current',
      latestOutputId: prepared.outputId, rows: snapshot.rows, headers: snapshot.headers,
      aiRawMarkdown: prepared.aiRawMarkdown, aiBaselineMarkdown: prepared.aiBaselineMarkdown,
      aiUpdatedAt: new Date('2026-10-03T13:42:29.807Z'),
      humanMarkdown: snapshot.effectiveMarkdown, humanSavedAt: savedAt,
      effectiveMarkdown: snapshot.effectiveMarkdown, displayMarkdown: snapshot.displayMarkdown,
      ...(fixture.prepared.sourceMappings ? { sourceMappings: fixture.prepared.sourceMappings } : {}),
      receipts: [{ operationId: snapshot.operationId, digest: snapshot.digest,
        revision: snapshot.revision, changedRows: snapshot.changedRows,
        changedRowIds: snapshot.changedRowIds, savedAt,
        snapshot: { ...snapshot, savedAt, ownerUpdated } }],
      createdAt: savedAt, updatedAt: savedAt,
    });
  });
  return { conversationId, messageId, prepared, snapshot, userId };
}

async function seedSelectorFiles(conversationId: string) {
  await withMongo(async (db) => {
    const alpha = await db.collection('files').findOne({ conversationId, file_id: 'review-alpha' });
    if (!alpha) throw new Error('Missing selector fixture file');
    await db.collection('files').insertMany([
      { ...alpha, _id: new ObjectId(), file_id: 'review-beta', filename: 'beta.pdf',
        filepath: join(__dirname, 'fixtures', 'beta.pdf') },
      { ...alpha, _id: new ObjectId(), file_id: 'review-gamma', filename: 'gamma.png',
        filepath: join(__dirname, 'fixtures', 'gamma.png'), type: 'image/png' },
      { ...alpha, _id: new ObjectId(), file_id: 'review-foreign-selector', tenantId: 'foreign-selector-tenant' },
      { ...alpha, _id: new ObjectId(), file_id: 'review-expired-selector', expiredAt: new Date(0) },
    ]);
  });
}

async function persistedSnapshot(conversationId: string) {
  return withMongo(async (db) => ({
    messages: await db.collection('messages').find({ conversationId }).toArray(),
    ocr: await db.collection('steel_conversation_ocr_state').findOne({ conversationId }),
    reviews: await db.collection('steel_review_outputs').find({ conversationId }).toArray(),
    quotations: await db.collection('steel_quotation_states').find({ conversationId }).toArray(),
  }));
}

function expectPreservedAiState(
  before: Awaited<ReturnType<typeof persistedSnapshot>>['ocr'],
  after: Awaited<ReturnType<typeof persistedSnapshot>>['ocr'],
) {
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  const { reviewLockToken: previousToken, ...original } = before ?? {};
  const { reviewLockToken: savedToken, ...saved } = after ?? {};
  expect(saved).toEqual(original);
  expect(typeof savedToken).toBe('string');
  expect(savedToken).not.toBe('');
  expect(savedToken).not.toBe(previousToken);
}

function reviewValue(dialog: Locator, value: string) {
  return dialog.locator(`input[value=${JSON.stringify(value)}]`).or(dialog.getByText(value, { exact: true }));
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
      await db.collection('steel_delegate_ocr_runs').deleteMany({ conversationId: { $in: ids } });
      await db.collection('steel_quotation_states').deleteMany({ conversationId: { $in: ids } });
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
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await expect(reviewValue(dialog, 'REVIEW-P2')).toBeVisible();
    await expect(reviewValue(dialog, 'UNMANAGED')).toHaveCount(0);
    await expect(dialog.getByRole('textbox')).toHaveCount(6);
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
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
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
        { ...file, _id: new ObjectId(), file_id: 'review-beta', filename: 'beta.pdf', filepath: join(__dirname, 'fixtures', 'beta.pdf') },
        { ...file, _id: new ObjectId(), file_id: 'review-gamma', filename: 'gamma.png', filepath: join(__dirname, 'fixtures', 'gamma.png'), type: 'image/png' },
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
    await expect(reviewValue(dialog, 'ALPHA-ONE-A')).toBeVisible();
    await expect(reviewValue(dialog, 'ALPHA-ONE-B')).toBeVisible();
    await expect(reviewValue(dialog, 'ALPHA-TWO')).toHaveCount(0);
    await expect(reviewValue(dialog, 'UNLOCATED-PREVIEW')).toBeVisible();
    await expect(reviewValue(dialog, 'UNPREVIEWABLE-SOURCE')).toBeVisible();
    await expect(reviewValue(dialog, 'OUT-OF-RANGE-PAGE')).toBeVisible();
    await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(reviewValue(dialog, 'ALPHA-TWO')).toBeVisible();
    await expect(reviewValue(dialog, 'ALPHA-ONE-A')).toHaveCount(0);
    await expect.poll(checksum).not.toBe('');
    await expect.poll(checksum).not.toBe(firstPage);
    await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(reviewValue(dialog, 'BETA-TWO')).toBeVisible();
    await dialog.getByRole('button', { name: 'Previous page', exact: true }).click();
    await expect(reviewValue(dialog, 'BETA-ONE')).toBeVisible();
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
    await expect(reviewValue(dialog, 'GAMMA-ONE')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await expect(reviewValue(dialog, 'ALPHA-ONE-A')).toBeVisible();
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
      await expect(reviewValue(dialog, 'ALPHA-ONE-A')).toBeVisible();
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
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await expect(dialog.getByText(/loading.*(source|files)/i)).toBeVisible();
    releaseRequest();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(reviewValue(dialog, 'REVIEW-P2')).toBeVisible();
    await page.unroute(isSourceList);
    await dialog.getByRole('button', { name: /retry/i }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => dialog.locator('canvas').evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
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
      await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
      await expect(reviewValue(dialog, 'REVIEW-P2')).toBeVisible();
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


  test('an unavailable source stays unlocated without blocking a later business-cell Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    for (const quantity of ['7', '8']) {
      const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      if (quantity === '8') expect(table.rows[0].source).toBeNull();
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
      expect(prepare.status()).toBe(200);
      const save = await page.request.post(`${url}/commit`, { headers, data: await prepare.json() });
      expect(save.status()).toBe(200);
      if (quantity === '7') {
        await withMongo(async (db) => {
          await db.collection('files').updateOne({ conversationId, file_id: 'review-alpha' }, {
            $set: { expiredAt: new Date(Date.now() - 60_000) },
          });
        });
      }
    }
    const after = await persistedSnapshot(conversationId);
    expect(after.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toMatchObject({ table: {
      rows: [{ source: null, values: { 數量: { baseline: '2', effective: '8' } } }, { source: null }],
    } });
  });

  test('clearing an OCR cell keeps its AI baseline and clean reload does not resurrect the old value', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['長度'].effective = null;
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
    expect(prepare.status()).toBe(200);
    const saved = await page.request.post(`${url}/commit`, { headers, data: await prepare.json() });
    expect(saved.status()).toBe(200);
    const snapshot = await persistedSnapshot(conversationId);
    expect(snapshot.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 |  | 2 | 1 |'));
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reloaded.status()).toBe(200);
    const current = await reloaded.json() as { table: SteelReviewTable };
    expect(current.table.rows[0].values['長度']).toEqual({ baseline: '1000', effective: null });
    const noChange = await page.request.post(`${url}/prepare`, { headers, data: current.table });
    expect(noChange.status()).toBe(200);
    const noOp = await page.request.post(`${url}/commit`, { headers, data: await noChange.json() });
    expect(noOp.status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(snapshot);
  });

  for (const proof of ['matching_receipt', 'missing_receipt', 'mismatched_receipt', 'mismatched_hash', 'mismatched_digest'] as const) {
    test(`a pre-selector saved source stays reliable only with matching immutable proof: ${proof}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const saveQuantity = async (table: SteelReviewTable, quantity: string) => {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = quantity;
        const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
        expect(prepare.status()).toBe(200);
        const commit = await page.request.post(`${url}/commit`, { headers, data: await prepare.json() });
        expect(commit.status()).toBe(200);
      };
      const initial = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(initial.status()).toBe(200);
      await saveQuantity((await initial.json() as { table: SteelReviewTable }).table, '7');
      await withMongo(async (db) => {
        const filter = { conversationId, messageId, kind: 'ocr_result' };
        const legacy = await db.collection('steel_review_outputs').updateOne(filter, { $unset: {
          sourceMappings: '',
          'receipts.$[].snapshot.sourceMappings': '',
        } });
        expect(legacy.matchedCount).toBe(1);
        if (proof === 'missing_receipt') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: { receipts: [] } });
        }
        if (proof === 'mismatched_receipt') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.rows.0.values.數量.effective': '999',
          } });
        }
        if (proof === 'mismatched_hash') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.messageSha256': '0'.repeat(64),
          } });
        }
        if (proof === 'mismatched_digest') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.digest': '0'.repeat(64),
          } });
        }
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      expect(table.rows.map((row) => row.source)).toEqual(proof === 'matching_receipt'
        ? before.reviews[0].rows.map((row: SteelReviewTable['rows'][number]) => row.source)
        : [null, null]);
      expect(table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '7' });
      expect(table.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      await saveQuantity(table, '8');
      const after = await persistedSnapshot(conversationId);
      expect(after.messages.find((message) => message.messageId === messageId)?.text)
        .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
      expectPreservedAiState(before.ocr, after.ocr);
      expect(after.reviews[0].receipts.slice(0, before.reviews[0].receipts.length))
        .toEqual(before.reviews[0].receipts);
      const reopened = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({ table: {
        rows: [{ values: { 數量: { baseline: '2', effective: '8' } } }, {}],
      } });
    });
  }

  for (const proof of ['matching_receipt', 'mismatched_hash', 'mismatched_digest'] as const) {
    test(`a second-part legacy source requires exact full-message immutable proof: ${proof}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const prefix = 'LEGACY-PART-PREFIX';
      const suffix = 'LEGACY-PART-SUFFIX';
      await withMongo(async (db) => {
        await db.collection('messages').updateOne({ conversationId, messageId }, { $set: {
          text: `${prefix} ${ocr} ${suffix}`,
          content: [{ type: 'text', text: prefix }, { type: 'text', text: ocr }, { type: 'text', text: suffix }],
        } });
      });
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const saveQuantity = async (table: SteelReviewTable, quantity: string) => {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = quantity;
        const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
        expect(prepare.status()).toBe(200);
        const commit = await page.request.post(`${url}/commit`, { headers, data: await prepare.json() });
        expect(commit.status()).toBe(200);
      };
      const initial = await page.request.get(`${readUrl(conversationId, messageId, 1)}&partIndex=1`, { headers });
      expect(initial.status()).toBe(200);
      await saveQuantity((await initial.json() as { table: SteelReviewTable }).table, '7');
      await withMongo(async (db) => {
        const filter = { conversationId, messageId, kind: 'ocr_result' };
        const legacy = await db.collection('steel_review_outputs').updateOne(filter, { $unset: {
          sourceMappings: '',
          'receipts.$[].snapshot.sourceMappings': '',
        } });
        expect(legacy.matchedCount).toBe(1);
        if (proof === 'mismatched_hash') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.messageSha256': '0'.repeat(64),
          } });
        }
        if (proof === 'mismatched_digest') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: {
            'receipts.0.snapshot.digest': '0'.repeat(64),
          } });
        }
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(`${readUrl(conversationId, messageId, 1)}&partIndex=1`, { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      expect(table.partIndex).toBe(1);
      expect(table.rows.map((row) => row.source)).toEqual(proof === 'matching_receipt'
        ? before.reviews[0].rows.map((row: SteelReviewTable['rows'][number]) => row.source)
        : [null, null]);
      expect(table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '7' });
      expect(table.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      await saveQuantity(table, '8');
      const after = await persistedSnapshot(conversationId);
      expect(after.messages.find((message) => message.messageId === messageId)?.text)
        .toBe(`${prefix} ${ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |')} ${suffix}`);
      expect(after.messages.find((message) => message.messageId === messageId)?.content).toEqual([
        { type: 'text', text: prefix },
        { type: 'text', text: ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |') },
        { type: 'text', text: suffix },
      ]);
      expectPreservedAiState(before.ocr, after.ocr);
      expect(after.reviews[0].receipts.slice(0, before.reviews[0].receipts.length))
        .toEqual(before.reviews[0].receipts);
      const reopened = await page.request.get(`${readUrl(conversationId, messageId, 1)}&partIndex=1`, { headers });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({ table: {
        rows: [{ values: { 數量: { baseline: '2', effective: '8' } } }, {}],
      } });
    });
  }

  test('source and page cells cannot bypass the dedicated source association contract', async ({ page }) => {
    for (const [header, value] of [['來源', 'FORGED-SOURCE'], ['頁碼', '99']]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values[header].effective = value;
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
      if (prepare.status() === 200) {
        const commit = await page.request.post(`${url}/commit`, { headers, data: await prepare.json() });
        expect([400, 409]).toContain(commit.status());
      }
      expect([400, 409]).toContain(prepare.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('the backend saves only its exact message target and rejects a second stale prepared operation', async ({ page }) => {
    const markdown = `CAS-PREFIX\n\n${ocr}\n\n## Other data\n| Name | Value |\n| --- | --- |\n| KEEP | 42 |\n\nCAS-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const previousMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: previousMessageId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: ocr.replace('REVIEW-P1', 'OTHER-MESSAGE-KEEP'),
      content: [{ type: 'text', text: ocr.replace('REVIEW-P1', 'OTHER-MESSAGE-KEEP') }],
      isCreatedByUser: false, sender: 'Assistant',
    }]);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, { $set: {
        text: `${markdown} CAS-SECOND-PART`,
        content: [{ type: 'text', text: markdown }, { type: 'text', text: 'CAS-SECOND-PART' }],
        'metadata.steelReview.system_order': {
          version: 1, kind: 'system_order', conversationId, messageId,
          tableId: 'system_order:unrelated', outputId: 'system_order:previous-run',
          revision: 'UNRELATED-STATUS-KEEP', updatedAt: new Date(Date.now() - 60_000),
        },
      } });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const operations: SteelReviewPrepared[] = [];
    for (const quantity of ['7', '8']) {
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepared = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
      expect(prepared.status()).toBe(200);
      operations.push(await prepared.json() as SteelReviewPrepared);
    }
    const saved = await page.request.post(`${url}/commit`, { headers, data: operations[0] });
    expect(saved.status()).toBe(200);
    const savedBody = await saved.json();
    const after = await persistedSnapshot(conversationId);
    const expected = markdown.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |');
    const message = after.messages.find((candidate) => candidate.messageId === messageId);
    expect(message?.text).toBe(`${expected} CAS-SECOND-PART`);
    expect(message?.content).toEqual([{ type: 'text', text: expected }, { type: 'text', text: 'CAS-SECOND-PART' }]);
    expect(savedBody.savedSnapshot).toMatchObject({
      conversationId, messageId, messageText: `${expected} CAS-SECOND-PART`,
      messageSha256: createHash('sha256').update(`${expected} CAS-SECOND-PART`).digest('hex'),
      messageTextParts: [{ partIndex: 0, text: expected }, { partIndex: 1, text: 'CAS-SECOND-PART' }],
      ownerUpdated: { version: 1, kind: 'ocr_result', conversationId, messageId,
        tableId: table.tableId, outputId: table.outputId, revision: savedBody.revision },
    });
    expect(message?.metadata?.steel).toEqual(before.messages.find((candidate) => candidate.messageId === messageId)?.metadata?.steel);
    expect(message?.metadata?.steelReview?.system_order).toEqual(before.messages.find((candidate) => candidate.messageId === messageId)?.metadata?.steelReview?.system_order);
    expect(message?.metadata?.steelReview?.ocr_result).toMatchObject({
      kind: 'ocr_result', conversationId, messageId, tableId: table.tableId,
      outputId: table.outputId, revision: savedBody.revision,
    });

    expect(after.messages.find((candidate) => candidate.messageId === previousMessageId))
      .toEqual(before.messages.find((candidate) => candidate.messageId === previousMessageId));
    const review = after.reviews[0];
    expect(review?.aiRawMarkdown).toBe(ocr);
    expect(review?.aiBaselineMarkdown).toBe(ocr);
    expect(review?.humanMarkdown).toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'));
    expect(review?.effectiveMarkdown).toBe(review?.humanMarkdown);
    // A human Save must not replace the latest AI input or advance its timestamp.
    expectPreservedAiState(before.ocr, after.ocr);
    expect(review?.aiUpdatedAt).toEqual(before.ocr?.updatedAt);
    expect(review?.humanSavedAt.getTime()).toBeGreaterThan(before.ocr?.updatedAt.getTime());
    const stale = await page.request.post(`${url}/commit`, { headers, data: operations[1] });
    expect(stale.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(after);
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toMatchObject({ table: {
      messageId, isLatest: true, readOnly: false,
      rows: [{ values: { 數量: { baseline: '2', effective: '7' } } }, { values: { 數量: { baseline: '3', effective: '3' } } }],
    } });
  });

  for (const collision of ['other_message', 'other_table', 'two_other_owners'] as const) {
    test(`first OCR Save preserves unrelated review owners sharing its outputId: ${collision}`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const foreignMessageIds = [randomUUID(), randomUUID()];
      await seedMessages(getE2EUser().email, conversationId, foreignMessageIds.map((id) => ({
        messageId: id,
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        text: `UNRELATED-OWNER-PREFIX ${id}\n${ocr}\nUNRELATED-OWNER-SUFFIX`,
        isCreatedByUser: false,
        sender: 'Assistant',
      })));
      await withMongo(async (db) => {
        const owner = await db.collection('messages').findOne({ conversationId, messageId });
        if (!owner) throw new Error('Missing current owner');
        const scopes = collision === 'two_other_owners'
          ? foreignMessageIds.map((id) => ({ messageId: id, tableId: 'ocr_result:1' }))
          : [{
            messageId: collision === 'other_message' ? foreignMessageIds[0] : messageId,
            tableId: collision === 'other_table' ? 'ocr_result:99' : 'ocr_result:1',
          }];
        await db.collection('steel_review_outputs').insertMany(scopes.map((scope) => ({
          userId: owner.user,
          ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
          conversationId,
          ...scope,
          kind: 'ocr_result',
          outputId: table.outputId,
          revision: table.revision,
          state: 'current',
          headers: table.headers,
          rows: table.rows,
          aiRawMarkdown: ocr,
          aiBaselineMarkdown: ocr,
          effectiveMarkdown: ocr,
          receipts: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        })));
      });
      const before = await persistedSnapshot(conversationId);
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '7';
      const preparedResponse = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
        headers, data: { ...table, rows },
      });
      expect(preparedResponse.status()).toBe(200);
      const prepared = await preparedResponse.json() as SteelReviewPrepared;
      const committed = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/commit`, {
        headers, data: prepared,
      });
      expect(committed.status()).toBe(200);
      const after = await persistedSnapshot(conversationId);
      expect(after.reviews).toHaveLength(before.reviews.length + 1);
      for (const original of before.reviews) {
        expect(after.reviews.find((row) => row._id.equals(original._id))).toEqual(original);
      }
      const saved = after.reviews.find((row) => row.messageId === messageId && row.tableId === table.tableId);
      expect(saved).toMatchObject({ kind: 'ocr_result', outputId: table.outputId, rows });
      for (const original of before.messages.filter((message) => message.messageId !== messageId)) {
        expect(after.messages.find((message) => message.messageId === original.messageId)).toEqual(original);
      }
      expect(after.messages.find((message) => message.messageId === messageId)?.text)
        .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'));
      expectPreservedAiState(before.ocr, after.ocr);
      const reopened = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({ table: { messageId, tableId: table.tableId, rows } });
    });
  }

  test('committed receipt replay binds cleanReplacementText to its original digest', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    const prepare = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
      headers, data: { ...table, rows },
    });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewPrepared;
    const commitUrl = `/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    expect((await page.request.post(commitUrl, { headers, data: prepared })).status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const replay = await page.request.post(commitUrl, {
      headers,
      data: { ...prepared, cleanReplacementText: `${prepared.cleanReplacementText}\nUNSIGNED-CLEAN-TEXT` },
    });
    expect(replay.status()).toBe(409);
    expect(await replay.json()).toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  for (const stage of ['first_save', 'saved_output'] as const) {
    for (const boundary of ['prepare', 'commit'] as const) {
      test(`located source metadata cannot be erased through ${boundary}: ${stage}`, async ({ page }) => {
        const { conversationId, messageId } = await seedCurrent(ocr);
        conversations.push(conversationId);
        const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
        expect(read.status()).toBe(200);
        let { table } = await read.json() as { table: SteelReviewTable };
        const reviewUrl = `/api/steel/conversations/${conversationId}/review/ocr_result`;
        if (stage === 'saved_output') {
          const initialRows = structuredClone(table.rows);
          initialRows[0].values['數量'].effective = '4';
          const initialPrepare = await page.request.post(`${reviewUrl}/prepare`, {
            headers, data: { ...table, rows: initialRows },
          });
          expect(initialPrepare.status()).toBe(200);
          expect((await page.request.post(`${reviewUrl}/commit`, {
            headers, data: await initialPrepare.json(),
          })).status()).toBe(200);
          const savedRead = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
          expect(savedRead.status()).toBe(200);
          ({ table } = await savedRead.json() as { table: SteelReviewTable });
        }
        expect(table.rows[0].source).toMatchObject({ fileId: 'review-alpha', pageNumber: 1 });
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = '7';
        let payload: SteelReviewPrepared | SteelReviewTable;
        if (boundary === 'commit') {
          const validPrepare = await page.request.post(`${reviewUrl}/prepare`, {
            headers, data: { ...table, rows },
          });
          expect(validPrepare.status()).toBe(200);
          const prepared = await validPrepare.json() as SteelReviewPrepared;
          rows[0].source = null;
          const forged = { ...prepared, rows };
          const owner = await withMongo((db) => db.collection('messages').findOne({ conversationId, messageId }));
          if (!owner) throw new Error('Missing current owner');
          forged.digest = createHash('sha256').update(encodeSteelReviewDigest({
            ...forged,
            userId: String(owner.user),
            ...(typeof owner.tenantId === 'string' ? { tenantId: owner.tenantId } : {}),
          })).digest('hex');
          payload = forged;
        } else {
          rows[0].source = null;
          payload = { ...table, rows };
        }
        const before = await persistedSnapshot(conversationId);
        const rejected = await page.request.post(`${reviewUrl}/${boundary}`, { headers, data: payload });
        expect(rejected.status()).toBe(400);
        expect(await rejected.json()).toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
        expect(await persistedSnapshot(conversationId)).toEqual(before);
      });
    }
  }

  test('a legacy OCR row with initially null source metadata remains saveable', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const cleared = await withMongo((db) => db.collection('steel_conversation_ocr_state').updateOne(
      { conversationId }, { $set: { sourceMappings: [] } },
    ));
    expect(cleared.matchedCount).toBe(1);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows.every((row) => row.source === null)).toBe(true);
    const before = await persistedSnapshot(conversationId);
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    const reviewUrl = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${reviewUrl}/prepare`, { headers, data: { ...table, rows } });
    expect(prepare.status()).toBe(200);
    const commit = await page.request.post(`${reviewUrl}/commit`, { headers, data: await prepare.json() });
    expect(commit.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.rows).toEqual(rows);
    expect(after.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'));
    expectPreservedAiState(before.ocr, after.ocr);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows } });
  });

  test('an unlocated row uses existing source menus as a local draft then dirty-close Save updates the scoped chat', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: { sourceMappings: [] } });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows[0].source).toBeNull();
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="REVIEW-P1"]') });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Change source ${table.rows[0].rowId}`, exact: true }).click();
    await row.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    const sourcePage = row.getByRole('combobox', { name: 'Source page', exact: true });
    await sourcePage.click();
    await expect(page.getByRole('option', { name: '3', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard unsaved changes', exact: true })).toHaveCount(0);
    await sourcePage.click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await expect(row.locator('td').nth(4).getByText('2', { exact: true })).toBeVisible();
    await expect(row.locator('td').nth(4).locator('del')).toHaveText('1');
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(row.getByRole('combobox', { name: 'Source page', exact: true })).toHaveText('2');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save updates', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const after = await persistedSnapshot(conversationId);
    const updated = after.reviews[0]?.rows[0];
    expect(updated).toMatchObject({ rowId: table.rows[0].rowId,
      source: { fileId: 'review-alpha', pageNumber: 2, filename: 'alpha.pdf' },
      values: { 頁碼: { baseline: '1', effective: '2' }, 數量: { baseline: '2', effective: '2' } } });
    expect(updated.values['來源'].effective).toMatch(/^F\d+$/u);
    const clean = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', `| ${updated.values['來源'].effective} | REVIEW-P1 | 1000 | 2 | 2 |`);
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(clean);
    expect(after.messages.find((message) => message.messageId === messageId)?.content)
      .toEqual([{ type: 'text', text: clean }]);
    expectPreservedAiState(before.ocr, after.ocr);
    await expect(page.locator('del')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('a source file swap clears its page and clearing the association remains a legal explicit Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="REVIEW-P1"]') });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Change source ${table.rows[0].rowId}`, exact: true }).click();
    await row.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await expect(row.getByRole('combobox', { name: 'Source page', exact: true })).toHaveText('No page');
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows[0].source).toMatchObject({ fileId: 'review-beta', pageNumber: null });
    expect(saved.reviews[0]?.rows[0].values['頁碼'].effective).toBe('');
    expect(saved.reviews[0]?.rows[1]).toEqual(table.rows[1]);
    await row.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'Clear source', exact: true }).click();
    await expect(row.getByRole('combobox', { name: 'Source page', exact: true })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect.poll(async () => (await persistedSnapshot(conversationId)).reviews[0]?.rows[0].source).toBeNull();
    const cleared = await persistedSnapshot(conversationId);
    expect(cleared.reviews[0]?.rows[0].values['來源']).toEqual({ baseline: 'A', effective: '' });
    expect(cleared.reviews[0]?.rows[0].values['頁碼']).toEqual({ baseline: '1', effective: '' });
    expect(cleared.reviews[0]?.receipts).toHaveLength(2);
    expectPreservedAiState(before.ocr, cleared.ocr);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(cleared);
  });

  test('an authentic committed 03 operation replays immutably while fresh legacy-shaped writes are refused', async ({ page }) => {
    const { conversationId, messageId, prepared, snapshot, userId } = await seedCapturedLegacyReview('steel-review-legacy03');
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const replay = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ savedSnapshot: snapshot });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const tampered = await page.request.post(`${url}/commit`, { headers, data: {
      ...prepared, cleanReplacementText: prepared.cleanReplacementText.replace('7', '99'),
    } });
    expect(tampered.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '8';
    const fresh = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
    expect(fresh.status()).toBe(200);
    const freshPrepared = await fresh.json() as SteelReviewPrepared;
    const legacy = Object.fromEntries(Object.entries(freshPrepared)
      .filter(([key]) => key !== 'sourceMappings' && key !== 'sourceIntents')) as Omit<SteelReviewPrepared, 'sourceMappings' | 'sourceIntents'>;
    legacy.digest = createHash('sha256').update(encodeSteelReviewDigest({ ...legacy, userId })).digest('hex');
    const downgraded = await page.request.post(`${url}/commit`, { headers, data: legacy });
    expect(downgraded.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('an authentic committed 04 receipt preserves its pre-ledger digest while stripped fresh 05 writes are refused', async ({ page }) => {
    const { conversationId, messageId, prepared, snapshot, userId } = await seedCapturedLegacyReview('steel-review-legacy04');
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const replay = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ savedSnapshot: snapshot });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const tampered = await page.request.post(`${url}/commit`, { headers, data: {
      ...prepared, cleanReplacementText: prepared.cleanReplacementText.replace('7', '99'),
    } });
    expect(tampered.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const noChange = await page.request.post(`${url}/prepare`, { headers, data: table });
    expect(noChange.status()).toBe(200);
    const noOp = await noChange.json() as SteelReviewPrepared;
    expect(noOp.caption.changedRows).toBe(0);
    expect((await page.request.post(`${url}/commit`, { headers, data: noOp })).status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '8';
    const fresh = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
    expect(fresh.status()).toBe(200);
    const current = await fresh.json() as SteelReviewPrepared;
    for (const row of current.rows) {
      expect(row).toMatchObject({ origin: 'ai', deleted: false });
    }
    const stripped = structuredClone(current);
    for (const row of stripped.rows) {
      Reflect.deleteProperty(row, 'origin');
      Reflect.deleteProperty(row, 'deleted');
    }
    stripped.digest = createHash('sha256').update(encodeSteelReviewDigest({ ...stripped, userId })).digest('hex');
    expect([400, 409]).toContain((await page.request.post(`${url}/commit`, { headers, data: stripped })).status());
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a reliable authentic 03 source reuses its code and same-association intent is a no-op', async ({ page }) => {
    const { conversationId, messageId, snapshot } = await seedCapturedLegacyReview('steel-review-legacy03-sourced');
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows).toEqual(snapshot.rows);
    expect(Object.hasOwn(table.rows[0].source ?? {}, 'mediaType')).toBe(false);
    const noop = await page.request.post(`${url}/prepare`, { headers, data: {
      ...table, sourceIntents: [{ rowId: table.rows[0].rowId, fileId: 'review-alpha', pageNumber: 1 }],
    } });
    expect(noop.status()).toBe(200);
    const noopPrepared = await noop.json() as SteelReviewPrepared;
    expect(noopPrepared.caption.changedRows).toBe(0);
    const noopCommit = await page.request.post(`${url}/commit`, { headers, data: noopPrepared });
    expect(noopCommit.status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const changed = await page.request.post(`${url}/prepare`, { headers, data: {
      ...table, sourceIntents: [{ rowId: table.rows[0].rowId, fileId: 'review-alpha', pageNumber: 2 }],
    } });
    expect(changed.status()).toBe(200);
    const changedPrepared = await changed.json() as SteelReviewPrepared;
    expect(changedPrepared.caption.changedRows).toBe(1);
    expect(changedPrepared.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
    expect(changedPrepared.rows[0].values['頁碼']).toEqual({ baseline: '1', effective: '2' });
    const commit = await page.request.post(`${url}/commit`, { headers, data: changedPrepared });
    expect(commit.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.receipts.slice(0, 1)).toEqual(before.reviews[0]?.receipts);
    expect(after.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(snapshot.messageText.replace('| A | LEGACY-P1 | 7 | 1 |', '| A | LEGACY-P1 | 7 | 2 |'));
    expectPreservedAiState(before.ocr, after.ocr);
  });

  test('returning a source draft to the authentic legacy file and page is a zero-write UI no-op', async ({ page }) => {
    const { conversationId, messageId } = await seedCapturedLegacyReview('steel-review-legacy03-sourced');
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows[0].source?.mediaType).toBeUndefined();
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="LEGACY-P1"]') });
    await row.getByRole('button', { name: `Change source ${table.rows[0].rowId}`, exact: true }).click();
    await row.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'beta.pdf', exact: true }).click();
    await expect(dialog.getByText('Unsaved changes: 1 rows', { exact: true })).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await row.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'alpha.pdf', exact: true }).click();
    await row.getByRole('combobox', { name: 'Source page', exact: true }).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard unsaved changes', exact: true })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  for (const [reservedCode, nextCode] of [['F7', 'F8'], ['F9007199254740993', 'F9007199254740994']]) {
    test(`unproven source ${reservedCode} remains reserved without becoming a file association`, async ({ page }) => {
      const markdown = ocr.replace('| A | REVIEW-P2', `| ${reservedCode} | REVIEW-P2`);
      const { conversationId, messageId } = await seedCurrent(markdown);
      conversations.push(conversationId);
      await seedSelectorFiles(conversationId);
      await withMongo(async (db) => {
        await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
          currentOcrResultMarkdown: markdown, sourceMappings: [],
        } });
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      expect(table.rows.map((row) => row.source)).toEqual([null, null]);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const response = await page.request.post(`${url}/prepare`, { headers, data: {
        ...table, sourceIntents: [{ rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 1 }],
      } });
      expect(response.status()).toBe(200);
      const prepared = await response.json() as SteelReviewPrepared;
      expect(prepared.rows[0].values['來源'].effective).toBe(nextCode);
      expect(prepared.rows[1]).toEqual(table.rows[1]);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      const commit = await page.request.post(`${url}/commit`, { headers, data: prepared });
      expect(commit.status()).toBe(200);
      const after = await persistedSnapshot(conversationId);
      const reopen = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(reopen.status()).toBe(200);
      const reopened = await reopen.json() as { table: SteelReviewTable };
      expect(reopened.table.rows[0].source).toMatchObject({ fileId: 'review-beta', pageNumber: 1 });
      expect(reopened.table.rows[1]).toEqual(table.rows[1]);
      expect(reopened.table.rows[1].source).toBeNull();
      expectPreservedAiState(before.ocr, after.ocr);
      expect(await persistedSnapshot(conversationId)).toEqual(after);
    });
  }
  test('a valid source intent cannot import forged client media into an authentic legacy row', async ({ page }) => {
    const { conversationId, messageId } = await seedCapturedLegacyReview('steel-review-legacy03-sourced');
    conversations.push(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows[0].source?.mediaType).toBeUndefined();
    const rows = structuredClone(table.rows);
    rows[0].source = { fileId: 'review-alpha', pageNumber: 2, filename: 'alpha.pdf', mediaType: 'image/png' };
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
      headers, data: { ...table, rows,
        sourceIntents: [{ rowId: rows[0].rowId, fileId: 'review-alpha', pageNumber: 2 }] },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('new human source codes reserve unavailable owner AI codes without locating their old rows', async ({ page }) => {
    const markdown = ocr.replace('| A | REVIEW-P2', '| F7 | REVIEW-P2');
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    await withMongo(async (db) => {
      await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
        currentOcrResultMarkdown: markdown,
        sourceMappings: [{ fileId: 'review-alpha', sourceCode: 'A', sourceFilename: 'alpha.pdf' },
          { fileId: 'review-expired-selector', sourceCode: 'F7', sourceFilename: 'alpha.pdf' }],
      } });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table.rows[1].source).toBeNull();
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, { headers, data: {
      ...table, sourceIntents: [{ rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 }],
    } });
    expect(response.status()).toBe(200);
    const prepared = await response.json() as SteelReviewPrepared;
    expect(prepared.rows[0].values['來源'].effective).toBe('F8');
    expect(prepared.rows[1]).toEqual(table.rows[1]);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(commit.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: [{}, { source: null,
      values: { 來源: { effective: 'F7' } } }] } });
    expectPreservedAiState(before.ocr, after.ocr);
  });

  test('one image can bind two independent rows and reopening its preview does not write again', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, { headers, data: {
      ...table, sourceIntents: table.rows.map((row) => ({ rowId: row.rowId, fileId: 'review-gamma', pageNumber: 1 })),
    } });
    expect(response.status()).toBe(200);
    const prepared = await response.json() as SteelReviewPrepared;
    expect(prepared.caption.changedRows).toBe(2);
    expect(prepared.rows.map((row) => row.rowId)).toEqual(table.rows.map((row) => row.rowId));
    for (const row of prepared.rows) expect(row.source).toEqual({
      fileId: 'review-gamma', pageNumber: 1, filename: 'gamma.png', mediaType: 'image/png',
    });
    expect(prepared.rows[0].values['來源'].effective).toBe(prepared.rows[1].values['來源'].effective);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(commit.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows).toEqual(prepared.rows);
    expectPreservedAiState(before.ocr, saved.ocr);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await dialog.getByRole('combobox', { name: 'Source file', exact: true }).click();
    await page.getByRole('option', { name: 'gamma.png', exact: true }).click();
    await expect(reviewValue(dialog, 'REVIEW-P1')).toBeVisible();
    await expect(reviewValue(dialog, 'REVIEW-P2')).toBeVisible();
    const image = dialog.getByRole('img', { name: 'Source page preview', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(800);
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

  test('source selector page counts come from actual authorized PDF/image bytes without writes', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
    for (const [fileId, pageCount] of [['review-alpha', 3], ['review-beta', 2], ['review-gamma', 1]] as const) {
      const response = await page.request.get(`${url}/${fileId}/page-count?${new URLSearchParams({ messageId })}`, { headers });
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ pageCount });
    }
    for (const fileId of ['review-foreign-selector', 'review-expired-selector', 'missing-selector-file']) {
      const response = await page.request.get(`${url}/${fileId}/page-count?${new URLSearchParams({ messageId })}`, { headers });
      expect(response.status()).toBe(404);
    }
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('a source-only Save freezes trusted mapping and updates only the clicked message without staling its quote', async ({ page }) => {
    const markdown = `SELECTOR-PREFIX\n\n${ocr}\n\nSELECTOR-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const otherMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: otherMessageId, parentMessageId: messageId, text: ocr,
      content: [{ type: 'text', text: ocr }], isCreatedByUser: false, sender: 'Assistant',
    }]);
    const runId = randomUUID();
    const orderHash = createHash('sha256').update(ocr).digest('hex');
    await withMongo(async (db) => {
      const owner = await db.collection('messages').findOne({ conversationId, messageId });
      if (!owner) throw new Error('Missing selector quotation owner');
      await db.collection('steel_quotation_states').insertOne({
        userId: String(owner.user), conversationId,
        currentOrder: { markdown: ocr, sha256: orderHash },
        currentSystemOrder: { runId, messageId: randomUUID(), markdown: 'ORDER-UNCHANGED',
          sha256: createHash('sha256').update('ORDER-UNCHANGED').digest('hex'),
          customerQuoteMarkdown: 'INTERNAL-QUOTE-UNCHANGED', updatedAt: new Date() },
        nextSignalIndex: 2, pendingMessages: [],
        tickets: [{ index: 1, token: randomUUID(), orderHash, customerMarkdown: 'CUSTOMER-UNCHANGED',
          customerIdentity: 'CUSTOMER-1', triggeringMessageId: messageId,
          selectionProvenance: { method: 'unique' }, issuedAt: new Date(), acceptedRunId: runId,
          completionReceipt: { inputHash: 'FROZEN-INPUT', markdown: 'ORDER-UNCHANGED',
            ocrGeneration: 'review-proof-generation', ocrHash: orderHash } }],
        createdAt: new Date(), updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, { headers, data: {
      ...table, sourceIntents: [{ rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 }],
    } });
    expect(response.status()).toBe(200);
    const prepared = await response.json() as SteelReviewPrepared;
    expect(prepared.caption.changedRowIds).toEqual([table.rows[0].rowId]);
    expect(prepared.caption.changedRows).toBe(1);
    expect(prepared.rows[0].source).toMatchObject({ fileId: 'review-beta', pageNumber: 2, filename: 'beta.pdf' });
    expect(prepared.rows[0].values['來源'].effective).toMatch(/^F\d+$/u);
    expect(prepared.rows[0].values['頁碼']).toEqual({ baseline: '1', effective: '2' });
    for (const header of ['零件編號', '長度', '數量']) expect(prepared.rows[0].values[header]).toEqual(table.rows[0].values[header]);
    expect(prepared.rows[1]).toEqual(table.rows[1]);
    const mapping = { fileId: 'review-beta', sourceCode: prepared.rows[0].values['來源'].effective, sourceFilename: 'beta.pdf' };
    expect(prepared).toMatchObject({ sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]) });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(commit.status()).toBe(200);
    const saved = await commit.json();
    expect(saved.savedSnapshot).toMatchObject({ rows: prepared.rows,
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]) });
    const after = await persistedSnapshot(conversationId);
    const sourceCode = prepared.rows[0].values['來源'].effective;
    const clean = markdown.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', `| ${sourceCode} | REVIEW-P1 | 1000 | 2 | 2 |`);
    const clicked = after.messages.find((message) => message.messageId === messageId);
    expect(clicked?.text).toBe(clean);
    expect(clicked?.content).toEqual([{ type: 'text', text: clean }]);
    expect(after.messages.find((message) => message.messageId === otherMessageId))
      .toEqual(before.messages.find((message) => message.messageId === otherMessageId));
    expect(after.quotations).toEqual(before.quotations);
    expectPreservedAiState(before.ocr, after.ocr);
    expect(after.reviews[0]).toMatchObject({ rows: prepared.rows,
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]) });
    const reopened = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: prepared.rows,
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]) } });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('new source choices reject foreign expired missing multi-source and out-of-range pages before writes', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const before = await persistedSnapshot(conversationId);
    for (const intent of [
      { fileId: 'review-foreign-selector', pageNumber: 1 },
      { fileId: 'review-expired-selector', pageNumber: 1 },
      { fileId: 'missing-selector-file', pageNumber: 1 },
      { fileId: 'review-beta', pageNumber: 3 },
      { fileId: 'review-gamma', pageNumber: 2 },
      { fileId: ['review-alpha', 'review-beta'], pageNumber: 1 },
      { fileId: 'review-alpha', pageNumber: [1, 2] },
      { fileId: null, pageNumber: 1 },
    ]) {
      const response = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
        headers, data: { ...table, sourceIntents: [{ rowId: table.rows[0].rowId, ...intent }] },
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('source commit reauthorizes selected file and a new receipt cannot be downgraded to legacy shape', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await seedSelectorFiles(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, { headers, data: {
      ...table, sourceIntents: [{ rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 }],
    } });
    expect(response.status()).toBe(200);
    const prepared = await response.json() as SteelReviewPrepared;
    await withMongo(async (db) => {
      await db.collection('files').updateOne({ conversationId, file_id: 'review-beta' }, { $set: { expiredAt: new Date(0) } });
    });
    const before = await persistedSnapshot(conversationId);
    const refused = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(refused.status()).toBeGreaterThanOrEqual(400);
    expect(refused.status()).toBeLessThan(500);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await withMongo(async (db) => {
      await db.collection('files').updateOne({ conversationId, file_id: 'review-beta' }, { $unset: { expiredAt: '' } });
    });
    const committed = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(committed.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    const legacy = Object.fromEntries(Object.entries(prepared).filter(([key]) => key !== 'sourceMappings' && key !== 'sourceIntents'));
    const downgraded = await page.request.post(`${url}/commit`, { headers, data: legacy });
    expect(downgraded.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

  test('an OCR Save marks only a quotation with proven OCR lineage as needing requote', async ({ page }) => {
    for (const linked of [true, false]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const runId = randomUUID();
      const orderHash = createHash('sha256').update(linked ? ocr : 'UNRELATED-OCR').digest('hex');
      const systemOrder = '## system_order\n| 型號 | 數量 | 總數 | 單價 |\n| --- | --- | --- | --- |\n| KEEP-ORDER | 2 | 4 | 100 |';
      await withMongo(async (db) => {
        const owner = await db.collection('messages').findOne({ conversationId, messageId });
        if (!owner) throw new Error('Missing scoped quotation owner');
        await db.collection('steel_quotation_states').insertOne({
          userId: String(owner.user), conversationId,
          // Preparing a new order must not make an unrelated older quote share its lineage.
          currentOrder: { markdown: ocr, sha256: createHash('sha256').update(ocr).digest('hex') },
          currentSystemOrder: {
            runId, messageId: randomUUID(), markdown: systemOrder,
            sha256: createHash('sha256').update(systemOrder).digest('hex'),
            customerQuoteMarkdown: 'INTERNAL-QUOTE-KEEP', updatedAt: new Date(),
          },
          nextSignalIndex: 2, pendingMessages: [],
          tickets: [{ index: 1, token: randomUUID(), orderHash, customerMarkdown: 'CUSTOMER-KEEP',
            customerIdentity: 'CUSTOMER-1', triggeringMessageId: messageId,
            selectionProvenance: { method: 'unique' }, issuedAt: new Date(), acceptedRunId: runId,
            completionReceipt: { inputHash: 'FROZEN-INPUT', markdown: systemOrder,
              ocrGeneration: linked ? 'review-proof-generation' : 'unrelated-generation', ocrHash: orderHash },
          }], createdAt: new Date(), updatedAt: new Date(),
        });
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '7';
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
      expect(prepare.status()).toBe(200);
      const save = await page.request.post(`${url}/commit`, { headers, data: await prepare.json() });
      expect(save.status()).toBe(200);
      const after = await persistedSnapshot(conversationId);
      const quotation = after.quotations[0];
      expectPreservedAiState(before.ocr, after.ocr);
      expect(quotation.currentSystemOrder.markdown).toBe(systemOrder);
      expect(quotation.currentSystemOrder.customerQuoteMarkdown).toBe('INTERNAL-QUOTE-KEEP');
      expect(quotation.tickets).toEqual(before.quotations[0].tickets);
      expect(quotation.currentOrder).toEqual(before.quotations[0].currentOrder);
      if (linked) expect(quotation.currentSystemOrder.needsRequote).toBe(true);
      else expect(quotation).toEqual(before.quotations[0]);
    }
  });

  test('review commit rejects a client-rehashed target outside the owned OCR table', async ({ page }) => {
    const markdown = `INTEGRITY-PREFIX\n\n${ocr}\n\nINTEGRITY-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '9';
    const prepare = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/prepare`, {
      headers, data: { ...table, rows },
    });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewPrepared;
    const forged = {
      ...prepared,
      target: { ...prepared.target, start: 0, end: markdown.length, sha256: createHash('sha256').update(markdown).digest('hex') },
      targetText: markdown,
      replacementText: 'CORRUPTED-PREFIX\n' + prepared.cleanReplacementText,
      cleanReplacementText: 'CORRUPTED-PREFIX\n' + prepared.cleanReplacementText,
      effectiveMarkdown: 'CORRUPTED-PREFIX\n' + prepared.cleanReplacementText,
      displayMarkdown: 'CORRUPTED-PREFIX\n' + prepared.cleanReplacementText,
      aiBaselineMarkdown: 'FORGED-AI-BASELINE',
      aiRawMarkdown: 'FORGED-AI-RAW',
    };
    const owner = before.messages.find((message) => message.messageId === messageId);
    forged.digest = createHash('sha256').update(JSON.stringify({
      userId: String(owner?.user), tenantId: owner?.tenantId ?? null,
      conversationId, kind: forged.kind, messageId, tableId: forged.tableId,
      partIndex: forged.partIndex ?? null, outputId: forged.outputId,
      revision: forged.revision, rows: forged.rows, headers: forged.headers,
      messageSha256: forged.messageSha256, target: forged.target, targetText: forged.targetText,
      replacementText: forged.replacementText, cleanReplacementText: forged.cleanReplacementText,
      effectiveMarkdown: forged.effectiveMarkdown, displayMarkdown: forged.displayMarkdown,
      aiBaselineMarkdown: forged.aiBaselineMarkdown ?? null, aiRawMarkdown: forged.aiRawMarkdown ?? null,
      caption: forged.caption,
    })).digest('hex');
    const commit = await page.request.post(`/api/steel/conversations/${conversationId}/review/ocr_result/commit`, { headers, data: forged });
    expect([400, 409]).toContain(commit.status());
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  test('prepare cannot overwrite a physical OCR table that drifted from its trusted state', async ({ page }) => {
    for (const hasHumanSave of [false, true]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(read.status()).toBe(200);
      let { table } = await read.json() as { table: SteelReviewTable };
      if (hasHumanSave) {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = '7';
        const prepared = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
        expect(prepared.status()).toBe(200);
        const saved = await page.request.post(`${url}/commit`, { headers, data: await prepared.json() });
        expect(saved.status()).toBe(200);
        const reread = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
        table = (await reread.json() as { table: SteelReviewTable }).table;
      }
      const drifted = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 88 | 1 |');
      await withMongo((db) => db.collection('messages').updateOne({ conversationId, messageId }, {
        $set: { text: drifted, content: [{ type: 'text', text: drifted }] },
      }));
      const before = await persistedSnapshot(conversationId);
      const invalidRead = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect([200, 404]).toContain(invalidRead.status());
      if (invalidRead.status() === 200) {
        expect((await invalidRead.json()).table).toBeNull();
      }
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '9';
      if (!hasHumanSave) {
        rows[0].values['數量'].baseline = '88';
        rows[0].rowId = createHash('sha256')
          .update(`${table.outputId}:0:${JSON.stringify(['A', 'REVIEW-P1', '1000', '88', '1'])}`)
          .digest('hex');
      }
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
      if (prepare.status() === 200) {
        const commit = await page.request.post(`${url}/commit`, { headers, data: await prepare.json() });
        expect([400, 404, 409]).toContain(commit.status());
      }
      expect([400, 404, 409]).toContain(prepare.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('an OCR saved snapshot contains only its owned section when AI storage has other headings', async ({ page }) => {
    const markdown = [
      'SECTION-KEEP-PREFIX',
      '## customer_data\n| Customer |\n| --- |\n| SECTION-KEEP-CUSTOMER |',
      ocr,
      '## Extra data\n| Name |\n| --- |\n| SECTION-KEEP-EXTRA |',
      'SECTION-KEEP-SUFFIX',
    ].join('\n\n');
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    await withMongo((db) => db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, {
      $set: { currentOcrResultMarkdown: markdown },
    }));
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 2), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    expect(table).not.toBeNull();
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
    expect(prepare.status()).toBe(200);
    const saved = await page.request.post(`${url}/commit`, { headers, data: await prepare.json() });
    expect(saved.status()).toBe(200);
    const body = await saved.json();
    const expected = ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |');
    expect(body.savedSnapshot.effectiveMarkdown).toBe(expected);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.effectiveMarkdown).toBe(expected);
    expect(after.reviews[0]?.humanMarkdown).toBe(expected);
    expect(after.messages[0]?.text).toBe(markdown.replace(ocr, expected));
    expectPreservedAiState(before.ocr, after.ocr);
  });

  test('an earlier committed operation returns its immutable saved snapshot after a later Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    async function save(quantity: string) {
      const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
      expect(read.status()).toBe(200);
      const { table } = await read.json() as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
      expect(prepare.status()).toBe(200);
      const operation = await prepare.json() as SteelReviewPrepared;
      const commit = await page.request.post(`${url}/commit`, { headers, data: operation });
      expect(commit.status()).toBe(200);
      return { operation, saved: await commit.json() };
    }
    const first = await save('7');
    const receiptQuery = new URLSearchParams({ messageId, tableId: first.operation.tableId,
      outputId: first.operation.outputId, operationId: first.operation.operationId, digest: first.operation.digest });
    const receiptUrl = `${url}/receipt?${receiptQuery}`;
    const firstState = await persistedSnapshot(conversationId);
    const committedReceipt = await page.request.get(receiptUrl, { headers });
    expect(committedReceipt.status()).toBe(200);
    const receipt = await committedReceipt.json();
    expect(receipt.snapshot).toEqual(first.saved.savedSnapshot);
    expect(receipt).toMatchObject({ status: 'committed', snapshot: {
      operationId: first.operation.operationId, revision: first.saved.revision,
      effectiveMarkdown: first.saved.effectiveMarkdown, messageSha256: first.saved.messageSha256,
    } });
    expect(await persistedSnapshot(conversationId)).toEqual(firstState);
    const wrongDigest = new URLSearchParams(receiptQuery);
    wrongDigest.set('digest', '0'.repeat(64));
    const conflictReceipt = await page.request.get(`${url}/receipt?${wrongDigest}`, { headers });
    expect(conflictReceipt.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(firstState);
    const missingOperation = new URLSearchParams(receiptQuery);
    missingOperation.set('operationId', randomUUID());
    const absentReceipt = await page.request.get(`${url}/receipt?${missingOperation}`, { headers });
    expect(absentReceipt.status()).toBe(200);
    expect(await absentReceipt.json()).toEqual({ status: 'absent' });
    expect(await persistedSnapshot(conversationId)).toEqual(firstState);
    const second = await save('8');
    expect(second.saved.revision).not.toBe(first.saved.revision);
    const afterSecond = await persistedSnapshot(conversationId);
    const retry = await page.request.post(`${url}/commit`, { headers, data: first.operation });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual(first.saved);
    expect(await persistedSnapshot(conversationId)).toEqual(afterSecond);
    const historicalReceipt = await page.request.get(receiptUrl, { headers });
    expect(historicalReceipt.status()).toBe(200);
    expect(await historicalReceipt.json()).toEqual(receipt);
    expect(await persistedSnapshot(conversationId)).toEqual(afterSecond);
    const newMessageId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: newMessageId, parentMessageId: messageId, text: ocr,
      content: [{ type: 'text', text: ocr }], isCreatedByUser: false, sender: 'Assistant',
    }]);
    await withMongo(async (db) => {
      await db.collection('steel_conversation_ocr_state').updateOne({ conversationId }, { $set: {
        currentOcrResultMessageId: newMessageId, currentOcrResultGenerationId: 'review-next-generation',
        currentOcrResultMarkdown: ocr, updatedAt: new Date(),
      } });
    });
    const afterNewAI = await persistedSnapshot(conversationId);
    const oldOwnerReceipt = await page.request.get(receiptUrl, { headers });
    expect(oldOwnerReceipt.status()).toBe(200);
    expect(await oldOwnerReceipt.json()).toEqual(receipt);
    const oldOwner = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(oldOwner.status()).toBe(200);
    expect(await oldOwner.json()).toMatchObject({ table: {
      readOnly: true, isLatest: false, aiUpdatedAt: firstState.ocr?.updatedAt.toISOString(),
    } });
    expect(await persistedSnapshot(conversationId)).toEqual(afterNewAI);
    const unknownOwner = new URLSearchParams(receiptQuery);
    unknownOwner.set('messageId', randomUUID());
    const missingMessage = await page.request.get(`${url}/receipt?${unknownOwner}`, { headers });
    expect(missingMessage.status()).toBe(404);
    const missingChat = await page.request.get(`/api/steel/conversations/${randomUUID()}/review/ocr_result/receipt?${receiptQuery}`, { headers });
    expect(missingChat.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(afterNewAI);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne({ conversationId, messageId }, {
        $set: { expiredAt: new Date(Date.now() - 60_000) },
      });
    });
    const expiredState = await persistedSnapshot(conversationId);
    const unavailableReceipt = await page.request.get(receiptUrl, { headers });
    expect(unavailableReceipt.status()).toBe(404);
    const unavailableReplay = await page.request.post(`${url}/commit`, { headers, data: first.operation });
    expect(unavailableReplay.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(expiredState);
  });

  test('representation-only OCR whitespace is a confirmed no-op with no DB or timestamp write', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(response.status()).toBe(200);
    const { table } = await response.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = ' 2 ';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewPrepared;
    expect(prepared.caption.changedRows).toBe(0);
    const commit = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(commit.status()).toBe(200);
    expect(await commit.json()).toMatchObject({ changedRows: 0 });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: [{ values: { 數量: { baseline: '2', effective: '2' } } }, {}] } });
  });

  test('OCR Save canonicalizes cell whitespace before persisting and the saved table reopens', async ({ page }) => {
    const markdown = `WHITESPACE-KEEP-PREFIX\n\n${ocr}\n\nWHITESPACE-KEEP-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(response.status()).toBe(200);
    const { table } = await response.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = ' \r\n7\r\n ';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewPrepared;
    expect(prepared.caption.changedRows).toBe(1);
    const commit = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(commit.status()).toBe(200);
    const receipt = await commit.json();
    expect(receipt.savedSnapshot.rows[0].values['數量']).toEqual({ baseline: '2', effective: '7' });
    const after = await persistedSnapshot(conversationId);
    const expected = markdown.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |');
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(expected);
    expect(after.reviews[0]?.humanMarkdown).toBe(expected.slice(expected.indexOf('## ocr_result'), expected.indexOf('\n\nWHITESPACE-KEEP-SUFFIX')));
    expectPreservedAiState(before.ocr, after.ocr);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: [{ rowId: rows[0].rowId, values: { 數量: { baseline: '2', effective: '7' } } }, {}] } });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('an OCR business cell containing a literal backslash and pipe roundtrips through Save and reopen', async ({ page }) => {
    const markdown = `PIPE-KEEP-PREFIX\n\n${ocr}\n\nPIPE-KEEP-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(response.status()).toBe(200);
    const { table } = await response.json() as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    const literal = 'REVIEW\\|PART';
    rows[0].values['零件編號'].effective = literal;
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: { ...table, rows } });
    expect(prepare.status()).toBe(200);
    const prepared = await prepare.json() as SteelReviewPrepared;
    expect(prepared.caption.changedRows).toBe(1);
    const commit = await page.request.post(`${url}/commit`, { headers, data: prepared });
    expect(commit.status()).toBe(200);
    const receipt = await commit.json();
    expect(receipt.savedSnapshot.rows[0].values['零件編號']).toEqual({ baseline: 'REVIEW-P1', effective: literal });
    const after = await persistedSnapshot(conversationId);
    const savedMessage = after.messages.find((message) => message.messageId === messageId);
    expect(savedMessage?.text.startsWith('PIPE-KEEP-PREFIX\n\n')).toBe(true);
    expect(savedMessage?.text.endsWith('\n\nPIPE-KEEP-SUFFIX')).toBe(true);
    expect(savedMessage?.content).toEqual([{ type: 'text', text: savedMessage?.text }]);
    expectPreservedAiState(before.ocr, after.ocr);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ table: { rows: [{ rowId: rows[0].rowId, values: { 零件編號: { baseline: 'REVIEW-P1', effective: literal }, 數量: { effective: '2' } } }, {}] } });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('saving representation-only OCR whitespace clears the local draft without marking Updated', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill(' 2 ');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await expect(quantity).toHaveValue('2');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Save updates', exact: true })).toHaveCount(0);
    await expect(page.getByText('Updated', { exact: true })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  for (const foreignScope of ['owner', 'tenant'] as const) {
    test(`generic message edit hides foreign ${foreignScope} managed OCR state without writes`, async ({ page }) => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      conversations.push(conversationId);
      await withMongo(async (db) => {
        const scope = foreignScope === 'owner'
          ? { user: new ObjectId().toHexString() }
          : { tenantId: 'foreign-managed-review-tenant' };
        await db.collection('conversations').updateOne({ conversationId }, { $set: scope });
        await db.collection('messages').updateOne({ conversationId, messageId }, { $set: scope });
      });
      const before = await persistedSnapshot(conversationId);
      const response = await page.request.put(`/api/messages/${conversationId}/${messageId}`, {
        headers,
        data: { text: 'FOREIGN-MANAGED-STATE-MUST-NOT-BE-CHANGED', model: 'gpt-4o-mini' },
      });
      expect(response.status()).toBe(404);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    });
  }

  test('a foreign tenant ordinary message cannot bypass the scoped edit guard', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await withMongo(async (db) => {
      await db.collection('conversations').updateOne({ conversationId }, {
        $set: { tenantId: 'foreign-ordinary-review-tenant' },
      });
      await db.collection('messages').updateOne({ conversationId, messageId }, {
        $set: { tenantId: 'foreign-ordinary-review-tenant', text: 'FOREIGN-ORDINARY-KEEP', content: [{ type: 'text', text: 'FOREIGN-ORDINARY-KEEP' }] },
      });
      await db.collection('steel_conversation_ocr_state').deleteOne({ conversationId });
    });
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.put(`/api/messages/${conversationId}/${messageId}`, {
      headers,
      data: { text: 'FOREIGN-ORDINARY-MUST-NOT-BE-CHANGED', model: 'gpt-4o-mini' },
    });
    expect(response.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
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


  test('OCR row CRUD is local and adding then deleting before Save is a net-zero no-op', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await expect(dialog.locator('tbody tr')).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(3);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.locator('tbody tr').last().getByRole('button', { name: /^Delete row(?:\s|$)/ }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(2);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(3);
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(2);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard unsaved changes', exact: true })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  });

  test('two identical OCR additions retain independent identities and one selected source through Save and reload', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    for (let index = 0; index < 2; index += 1) {
      await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
      const row = dialog.locator('tbody tr').last();
      await row.locator('td').nth(1).getByRole('textbox').fill('MANUAL-DUPLICATE');
      await row.locator('td').nth(2).getByRole('textbox').fill('3000');
      await row.locator('td').nth(3).getByRole('textbox').fill('4');
      await row.locator('td').nth(3).getByRole('textbox').press('Enter');
    }
    await expect(dialog.getByText(/Unsaved.*2|2.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 2 rows', { exact: true })).toBeVisible();
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews).toHaveLength(1);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const added = table.rows.filter((row) => row.values['零件編號'].effective === 'MANUAL-DUPLICATE');
    expect(added).toHaveLength(2);
    expect(new Set(added.map((row) => row.rowId)).size).toBe(2);
    for (const row of added) {
      expect(row).toMatchObject({ origin: 'manual', deleted: false,
        source: { fileId: 'review-alpha', pageNumber: 1, filename: 'alpha.pdf' } });
      expect(Object.values(row.values).every((cell) => cell.baseline === null)).toBe(true);
      expect(row.values['數量'].effective).toBe('4');
    }
    expect(after.reviews[0]?.rows).toEqual(table.rows);
    expect(after.reviews[0]?.receipts).toMatchObject([{ changedRows: 2 }]);
    expect(after.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr + '\n| A | MANUAL-DUPLICATE | 3000 | 4 | 1 |\n| A | MANUAL-DUPLICATE | 3000 | 4 | 1 |');
    expect(after.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
    expectPreservedAiState(before.ocr, after.ocr);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(4);
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('deleting all OCR rows keeps popup AI tombstones and saves a reopenable clean header-only table', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    for (const id of ['REVIEW-P1', 'REVIEW-P2']) {
      const row = dialog.locator('tbody tr').filter({ has: page.locator(`input[value="${id}"]`) });
      await row.getByRole('button', { name: /^Delete row(?:\s|$)/ }).click();
      await expect(dialog.locator('del').filter({ hasText: id })).toBeVisible();
    }
    await expect(dialog.getByText(/Unsaved.*2|2.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 2 rows', { exact: true })).toBeVisible();
    const after = await persistedSnapshot(conversationId);
    const emptyMarkdown = ocr.split('\n').slice(0, 3).join('\n');
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(emptyMarkdown);
    expect(after.reviews[0]).toMatchObject({ aiBaselineMarkdown: ocr,
      effectiveMarkdown: emptyMarkdown,
      rows: [{ origin: 'ai', deleted: true }, { origin: 'ai', deleted: true }],
      receipts: [{ changedRows: 2 }] });
    expectPreservedAiState(before.ocr, after.ocr);
    // Session history survives Save; this restoration is local until the next Save.
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    await expect(dialog.locator('input[value="REVIEW-P2"]')).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(after);
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('del')).toHaveCount(0);
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download table as CSV', exact: true }).click();
    const download = await downloadReady;
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('Missing header-only confirmed CSV');
    const csv = await readFile(downloadedPath, 'utf8');
    expect(csv).toContain('來源,零件編號,長度,數量,頁碼');
    expect(csv).not.toMatch(/REVIEW-P1|REVIEW-P2|<del>|~~/);
    await page.reload();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(dialog.locator('del').filter({ hasText: 'REVIEW-P1' })).toBeVisible();
    await expect(dialog.locator('del').filter({ hasText: 'REVIEW-P2' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Add row', exact: true })).toBeEnabled();
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  test('OCR cell history groups a focused edit, survives Save, and resets when the dialog reopens', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    const undo = dialog.getByRole('button', { name: 'Undo', exact: true });
    const redo = dialog.getByRole('button', { name: 'Redo', exact: true });
    await quantity.fill('7');
    await quantity.press('8');
    await quantity.press('Enter');
    await expect(quantity).toHaveValue('78');
    await undo.click();
    await expect(quantity).toHaveValue('2');
    await expect(undo).toBeDisabled();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await redo.click();
    await expect(quantity).toHaveValue('78');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const saved = await persistedSnapshot(conversationId);
    expect(saved.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 78 | 1 |'));
    await undo.click();
    await expect(quantity).toHaveValue('2');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
    await redo.click();
    await expect(quantity).toHaveValue('78');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await undo.click();
    await quantity.fill('9');
    await quantity.press('Enter');
    await expect(redo).toBeDisabled();
    await undo.click();
    await expect(quantity).toHaveValue('2');
    await redo.click();
    await expect(quantity).toHaveValue('9');
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(quantity).toHaveValue('78');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

  test('OCR source and business undo stay attached to one row across page filters before and after Save', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const row = dialog.locator('tbody tr').filter({ has: page.locator('input[value="REVIEW-P1"]') });
    const quantity = row.locator('td').nth(3).getByRole('textbox');
    await quantity.fill('7');
    await quantity.press('Enter');
    await row.getByRole('button', { name: `Change source ${table.rows[0].rowId}`, exact: true }).click();
    await row.getByRole('combobox', { name: 'Source page', exact: true }).click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    const selectPage = async (value: string) => {
      await dialog.getByRole('combobox', { name: 'Page', exact: true }).click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0);
    };
    await selectPage('2');
    await expect(quantity).toHaveValue('7');
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(row).toHaveCount(0);
    await selectPage('1');
    await expect(quantity).toHaveValue('7');
    await expect(row.locator('td').nth(4).getByText('1', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(row).toHaveCount(0);
    await selectPage('2');
    await expect(quantity).toHaveValue('7');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows[0]).toMatchObject({ rowId: table.rows[0].rowId,
      source: { fileId: 'review-alpha', pageNumber: 2 }, values: { 數量: { baseline: '2', effective: '7' } } });
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await selectPage('1');
    await expect(quantity).toHaveValue('7');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(quantity).toHaveValue('2');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await selectPage('2');
    await expect(quantity).toHaveValue('7');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('a failed OCR prepare keeps grouped history and retry saves only the chosen draft', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const prepareUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/prepare`;
    await page.route(prepareUrl, (route) => route.abort('failed'));
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('7');
    await quantity.press('8');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(quantity).toHaveValue('78');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(quantity).toHaveValue('2');
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(quantity).toHaveValue('78');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.unroute(prepareUrl);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const saved = await persistedSnapshot(conversationId);
    expect(saved.messages.find((message) => message.messageId === messageId)?.text)
      .toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 78 | 1 |'));
    expect(saved.reviews[0]?.receipts).toHaveLength(1);
    expectPreservedAiState(before.ocr, saved.ocr);
  });

  test('deleting a previously saved manual OCR row changes one row without inventing an AI comparison', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    const added = dialog.locator('tbody tr').last();
    await added.locator('td').nth(1).getByRole('textbox').fill('MANUAL-ONLY');
    await added.locator('td').nth(3).getByRole('textbox').fill('4');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const first = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(read.status()).toBe(200);
    const { table } = await read.json() as { table: SteelReviewTable };
    const manual = table.rows.find((row) => row.values['零件編號'].effective === 'MANUAL-ONLY');
    expect(manual).toBeDefined();
    await dialog.locator('tbody tr').filter({ has: page.locator('input[value="MANUAL-ONLY"]') })
      .getByRole('button', { name: /^Delete row(?:\s|$)/ }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    await expect(dialog.locator('del').filter({ hasText: 'MANUAL-ONLY' })).toHaveCount(0);
    expect(await persistedSnapshot(conversationId)).toEqual(first);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect.poll(async () => (await persistedSnapshot(conversationId)).reviews[0]?.receipts.length).toBe(2);
    const second = await persistedSnapshot(conversationId);
    expect(second.messages.find((message) => message.messageId === messageId)?.text).toBe(ocr);
    expect(second.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
    expect(second.reviews[0]?.rows).toContainEqual(expect.objectContaining({ rowId: manual?.rowId,
      origin: 'manual', deleted: true }));
    expect(second.reviews[0]?.receipts[1]).toMatchObject({ changedRows: 1, changedRowIds: [manual?.rowId] });
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(dialog.locator('input[value="MANUAL-ONLY"]')).toBeVisible();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(second);
    await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(dialog.locator('input[value="MANUAL-ONLY"]')).toHaveCount(0);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(second);
  });

  test('OCR Save displays authoritative prepared and confirmed row counts without writing presentation copy into chat', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    let resumeCommit: (() => void) | undefined;
    const commitPaused = new Promise<void>((resolve) => { resumeCommit = resolve; });
    const commitUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    await page.route(commitUrl, async (route) => {
      await commitPaused;
      await route.continue();
    });
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('7');
    await quantity.press('Enter');
    await quantity.fill('8');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    try {
      await expect(dialog.getByText('This save will update 1 rows', { exact: true })).toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    } finally {
      resumeCommit?.();
    }
    await expect(dialog.getByText('Updated 1 rows', { exact: true })).toBeVisible();
    const after = await persistedSnapshot(conversationId);
    expect(after.messages[0]?.text).toBe(ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'));
    expect(after.messages[0]?.content).toEqual([{ type: 'text', text: after.messages[0]?.text }]);
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews[0]?.receipts).toMatchObject([{ changedRows: 1 }]);
    expectPreservedAiState(before.ocr, after.ocr);
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await expect(dialog.getByText('This save will update 1 rows', { exact: true })).toHaveCount(0);
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


  test('a known historical OCR message stays read-only through the generic edit endpoint', async ({ page }) => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const historicalId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: historicalId, parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: ocr, content: [{ type: 'text', text: ocr }], isCreatedByUser: false, sender: 'Assistant',
    }]);
    const current = await page.request.get(readUrl(conversationId, messageId, 1), { headers });
    expect(current.status()).toBe(200);
    const { table } = await current.json() as { table: SteelReviewTable };
    await withMongo(async (db) => {
      const message = await db.collection('messages').findOne({ conversationId, messageId: historicalId });
      if (!message) throw new Error('Missing historical message');
      await db.collection('steel_review_outputs').insertOne({
        userId: message.user, conversationId, messageId: historicalId,
        kind: 'ocr_result', tableId: 'ocr_result:1', outputId: 'ocr_result:previous-owner',
        revision: 'previous-owner-revision', state: 'historical',
        headers: table.headers, rows: table.rows, aiRawMarkdown: ocr,
        aiBaselineMarkdown: ocr, effectiveMarkdown: ocr, receipts: [],
        createdAt: new Date(), updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const historical = await page.request.get(readUrl(conversationId, historicalId, 1), { headers });
    expect(historical.status()).toBe(200);
    expect(await historical.json()).toMatchObject({ table: { readOnly: true, isLatest: false } });
    for (const data of [
      { text: 'HISTORY-CORRUPTED', model: 'gpt-4o' },
      { index: 0, text: 'HISTORY-CORRUPTED', model: 'gpt-4o' },
    ]) {
      const edited = await page.request.put(`/api/messages/${conversationId}/${historicalId}`, { headers, data });
      expect(edited.status()).toBe(409);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  test('a completed historical OCR without a human sidecar cannot bypass the generic edit guard', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const historicalId = randomUUID();
    await seedMessages(getE2EUser().email, conversationId, [{
      messageId: historicalId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: ocr,
      content: [{ type: 'text', text: ocr }],
      isCreatedByUser: false,
      sender: 'Assistant',
    }]);
    await withMongo(async (db) => {
      await db.collection('steel_delegate_ocr_runs').insertOne({
        conversationId,
        status: 'completed',
        responseGenerationId: 'previous-completed-ocr',
        finalizedCandidate: {
          targetMessageId: historicalId,
          generationId: 'previous-completed-ocr',
          markdown: ocr,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const runBefore = await withMongo((db) => db.collection('steel_delegate_ocr_runs').findOne({ conversationId }));
    const historical = await page.request.get(readUrl(conversationId, historicalId, 1), { headers });
    expect(historical.status()).toBe(200);
    expect(await historical.json()).toMatchObject({ table: { readOnly: true, isLatest: false } });
    expect(before.reviews).toHaveLength(0);
    for (const data of [
      { text: 'COMPLETED-HISTORY-MUST-NOT-BE-CHANGED', model: 'gpt-4o' },
      { index: 0, text: 'COMPLETED-HISTORY-MUST-NOT-BE-CHANGED', model: 'gpt-4o' },
    ]) {
      const edited = await page.request.put(`/api/messages/${conversationId}/${historicalId}`, { headers, data });
      expect(edited.status()).toBe(409);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      expect(await withMongo((db) => db.collection('steel_delegate_ocr_runs').findOne({ conversationId }))).toEqual(runBefore);
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

  test('discard after an uncommitted failed Save resolves without causing a DB write', async ({ page }) => {
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
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.unroute(commitUrl);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    await expect(quantity).toHaveValue('2');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
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


  test('a draft edited during OCR Save survives the confirmed earlier snapshot', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const commitUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    let firstCommitted: Awaited<ReturnType<typeof persistedSnapshot>> | undefined;
    let releaseResponse: (() => void) | undefined;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route(commitUrl, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      firstCommitted = await persistedSnapshot(conversationId);
      await responseGate;
      await route.fulfill({ response });
    });
    try {
      await page.goto(`/c/${conversationId}`);
      await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Steel source review' });
      const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
      await quantity.fill('7');
      await dialog.getByRole('button', { name: /^Save/ }).click();
      await expect.poll(() => firstCommitted !== undefined).toBe(true);
      await quantity.fill('10');
      releaseResponse?.();
      await expect(dialog.getByRole('button', { name: /^Save/ })).toBeEnabled();
      await expect(quantity).toHaveValue('10');
      await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toBeVisible();
      expect(await persistedSnapshot(conversationId)).toEqual(firstCommitted);
      expect(firstCommitted?.messages[0]?.text).toContain('| A | REVIEW-P1 | 1000 | 7 | 1 |');
      await page.unroute(commitUrl);
      await dialog.getByRole('button', { name: /^Save/ }).click();
      await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).not.toBeVisible();
      await expect(quantity).toHaveValue('10');
      expect((await persistedSnapshot(conversationId)).messages[0]?.text)
        .toContain('| A | REVIEW-P1 | 1000 | 10 | 1 |');
    } finally {
      releaseResponse?.();
      await page.unroute(commitUrl);
    }
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
    // Fixture values contain no commas, quotes or line breaks.
    const [columns, ...records] = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((line) =>
      line.split(',').map((value) => value.replace(/^"|"$/g, '')));
    expect(records.map((record) => Object.fromEntries(columns.map((column, index) => [column, record[index]])))).toEqual([
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
  test('closed managed toolbars download confirmed OCR data without creating a human Save', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    await page.goto(`/c/${conversationId}`);
    await expect(page.getByRole('button', { name: 'Open Steel review', exact: true })).toBeVisible();
    for (const expanded of [false, true]) {
      if (expanded) await page.getByRole('button', { name: 'Expand table', exact: true }).click();
      const scope = expanded ? page.getByRole('dialog', { name: 'Expand table' }) : page;
      const downloadReady = page.waitForEvent('download');
      await scope.getByRole('button', { name: 'Download table as CSV', exact: true }).click();
      const download = await downloadReady;
      const downloadedPath = await download.path();
      if (!downloadedPath) throw new Error('Missing completed confirmed CSV');
      const csv = await readFile(downloadedPath, 'utf8');
      expect(csv).toContain('A,REVIEW-P1,1000,2,1');
      expect(csv).toContain('A,REVIEW-P2,2000,3,1');
      expect(csv).not.toMatch(/<del>|~~|Updated|Previous version/);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      if (expanded) await scope.getByRole('button', { name: 'Close table', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('9');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByText(/Unsaved.*1|1.*unsaved/i)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    const saved = await persistedSnapshot(conversationId);
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download table as CSV', exact: true }).click();
    const download = await downloadReady;
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('Missing completed saved CSV');
    expect(await readFile(downloadedPath, 'utf8')).toContain('A,REVIEW-P1,1000,9,1');
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

  test('a failed receipt lookup can retry without committing an unsaved OCR draft', async ({ page }) => {
    const { conversationId } = await seedCurrent(ocr);
    conversations.push(conversationId);
    const before = await persistedSnapshot(conversationId);
    const commitUrl = `**/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    let commits = 0;
    await page.route(commitUrl, async (route) => {
      commits += 1;
      await route.abort('failed');
    });
    let receiptCalls = 0;
    await page.route(/\/review\/ocr_result\/receipt\?/, async (route) => {
      receiptCalls += 1;
      if (receiptCalls === 1) await route.abort('failed');
      else await route.continue();
    });
    await page.goto(`/c/${conversationId}`);
    await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Steel source review' });
    const quantity = dialog.locator('tbody tr').first().locator('td').nth(3).getByRole('textbox');
    await quantity.fill('7');
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect.poll(() => receiptCalls).toBe(1);
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(quantity).toHaveValue('7');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const retry = dialog.getByRole('button', { name: /Retry.*receipt|Retry.*lookup/i });
    if (await retry.count()) await retry.click();
    else await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(receiptCalls).toBe(2);
    expect(commits).toBe(1);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

});
