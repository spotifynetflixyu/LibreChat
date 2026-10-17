import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  createMethods,
  createModels,
  createSteelReviewWriteMethods,
} from '@librechat/data-schemas';
import type {
  SteelReviewTable,
  SteelReviewSaveResponse,
  SteelReviewReceiptStatus,
  SteelReviewErrorResponse,
  SteelReviewOperationCommit,
  SteelReviewOperationPrepare,
  SteelReviewOperationPrepared,
} from 'librechat-data-provider';
import type { Db, Document } from 'mongodb';
import { createSteelReviewSourceService, createSteelReviewSourceStorageReader } from '../sources';
import { resolveDownloadPath } from '../../storage/path';
import { createSteelRouteHandlers } from '../routes';
import { createSteelReviewService } from '../review';

/**
 * HTTP contract tests for the Steel OCR review routes, wired like
 * `api/server/routes/steel` over a real replica-set MongoDB. UI flows stay in
 * `e2e/specs/mock/steel-review.spec.ts`.
 */

type CommittedReceipt = Extract<SteelReviewReceiptStatus, { status: 'committed' }>;
type RecoveryResponse = Required<SteelReviewErrorResponse>;

interface ReviewHeaders {
  Authorization?: string;
}

interface ReviewResponse {
  status(): number;
  json<T = unknown>(): Promise<T>;
}

interface ReviewRequestOptions {
  headers?: ReviewHeaders;
  data?: object;
}

interface ReviewPage {
  request: {
    get(url: string, options?: ReviewRequestOptions): Promise<ReviewResponse>;
    post(url: string, options?: ReviewRequestOptions): Promise<ReviewResponse>;
  };
}

interface SeedConvo {
  conversationId: string;
  title: string;
  updatedAt: Date;
}

interface SeedMessage {
  messageId: string;
  parentMessageId: string | null;
  text: string;
  isCreatedByUser: boolean;
  sender: string;
  content?: object[];
  files?: object[];
}

const email = 'steel-review@librechat.test';
const headers: ReviewHeaders = {};
let server: MongoMemoryReplSet;
let app: express.Express;

function withMongo<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const { db } = mongoose.connection;
  if (!db) {
    throw new Error('MongoDB is not connected');
  }
  return fn(db);
}

async function resolveUserId(db: Db): Promise<string> {
  const user = await db.collection('users').findOne({ email });
  if (!user) {
    throw new Error('Missing authenticated fixture user');
  }
  return String(user._id);
}

async function seedConversations(convos: SeedConvo[]): Promise<void> {
  await withMongo(async (db) => {
    const user = await resolveUserId(db);
    await db.collection('conversations').insertMany(
      convos.map((convo) => ({
        ...convo,
        user,
        endpoint: 'openAI',
        isArchived: false,
        createdAt: convo.updatedAt,
      })),
    );
  });
}

async function seedMessages(conversationId: string, messages: SeedMessage[]): Promise<void> {
  await withMongo(async (db) => {
    const user = await resolveUserId(db);
    const start = Date.now();
    await db.collection('messages').insertMany(
      messages.map((message, index) => ({
        ...message,
        conversationId,
        user,
        endpoint: 'openAI',
        error: false,
        unfinished: false,
        createdAt: new Date(start + index * 1000),
        updatedAt: new Date(start + index * 1000),
      })),
    );
  });
}

async function send(test: request.Test): Promise<ReviewResponse> {
  const response = await test;
  return { status: () => response.status, json: async <T>() => response.body as T };
}

const page: ReviewPage = {
  request: {
    get: (url) => send(request(app).get(url)),
    post: (url, options) => send(request(app).post(url).send(options?.data)),
  },
};

function createApp(userId: string): express.Express {
  const db = createMethods(mongoose);
  const sourceService = createSteelReviewSourceService({
    reader: db,
    readStream: createSteelReviewSourceStorageReader({
      getStrategy: () => ({
        getDownloadStream: async (_req, filepath) => createReadStream(filepath),
      }),
      resolvePath: resolveDownloadPath,
    }),
  });
  const handlers = createSteelRouteHandlers({
    getModelsConfig: async () => ({}),
    reviewService: createSteelReviewService({
      reader: db,
      writer: createSteelReviewWriteMethods(mongoose),
      sourceAuthority: sourceService,
    }),
    sourceService,
  });
  const router = express.Router();
  router.get('/conversations/:conversationId/review/:kind', handlers.readReview);
  router.get('/conversations/:conversationId/review/:kind/receipt', handlers.readReviewReceipt);
  router.post('/conversations/:conversationId/review/:kind/prepare', handlers.prepareReview);
  router.post('/conversations/:conversationId/review/:kind/commit', handlers.commitReview);
  router.get('/conversations/:conversationId/review/:kind/sources', handlers.listReviewSources);
  router.get(
    '/conversations/:conversationId/review/:kind/sources/:fileId/page-count',
    handlers.readReviewSourcePageCount,
  );
  const result = express();
  result.use(express.json({ limit: '50mb' }));
  result.use((req, _res, next) => {
    req.user = { id: userId } as Express.User;
    next();
  });
  result.use('/api/steel', router);
  return result;
}

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  const models = createModels(mongoose);
  await Promise.all(Object.values(models).map((model) => model.init()));
  const { insertedId } = await mongoose.connection.collection('users').insertOne({
    email,
    name: 'Steel Review',
    username: 'steel-review',
    provider: 'local',
    role: 'USER',
  });
  app = createApp(String(insertedId));
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

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
  await seedConversations([
    { conversationId, title: 'Steel source review proof', updatedAt: new Date() },
  ]);
  await seedMessages(conversationId, [
    {
      messageId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: markdown,
      content: [{ type: 'text', text: markdown }],
      isCreatedByUser: false,
      sender: 'Assistant',
    },
  ]);
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
    await db.collection('messages').updateOne(
      { conversationId, messageId },
      {
        $set: {
          metadata: {
            steel: {
              preflightToolCalls: [
                {
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
                },
              ],
            },
          },
        },
      },
    );
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

async function seedSavedReviewData(page: ReviewPage, headers: ReviewHeaders) {
  const { conversationId, messageId } = await seedCurrent(ocr);
  const read = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
  expect(read.status()).toBe(200);
  const { table } = (await read.json()) as { table: SteelReviewTable };
  const prepared = await prepareQuantity(page, headers, table, '7');
  const saved = await commitOperation(page, headers, prepared);
  const snapshot = saved.savedSnapshot;
  if (!snapshot) throw new Error('Missing confirmed current-protocol snapshot');
  const userId = await withMongo(async (db) => {
    const owner = await db.collection('messages').findOne({ conversationId, messageId });
    if (!owner) throw new Error('Missing saved review owner');
    return String(owner.user);
  });
  return { conversationId, messageId, prepared, snapshot, userId };
}

async function seedSelectorFiles(conversationId: string) {
  await withMongo(async (db) => {
    const alpha = await db.collection('files').findOne({ conversationId, file_id: 'review-alpha' });
    if (!alpha) throw new Error('Missing selector fixture file');
    await db.collection('files').insertMany([
      {
        ...alpha,
        _id: new ObjectId(),
        file_id: 'review-beta',
        filename: 'beta.pdf',
        filepath: join(__dirname, 'fixtures', 'beta.pdf'),
      },
      {
        ...alpha,
        _id: new ObjectId(),
        file_id: 'review-gamma',
        filename: 'gamma.png',
        filepath: join(__dirname, 'fixtures', 'gamma.png'),
        type: 'image/png',
      },
      {
        ...alpha,
        _id: new ObjectId(),
        file_id: 'review-foreign-selector',
        tenantId: 'foreign-selector-tenant',
      },
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
  const { reviewLockToken: previousToken, ...original } = before ?? ({} as Document);
  const { reviewLockToken: savedToken, ...saved } = after ?? ({} as Document);
  expect(saved).toEqual(original);
  expect(typeof savedToken).toBe('string');
  expect(savedToken).not.toBe('');
  expect(savedToken).not.toBe(previousToken);
}

function readUrl(conversationId: string, messageId: string, title = 'ocr_result') {
  const query = new URLSearchParams({ messageId, title });
  return `/api/steel/conversations/${conversationId}/review/ocr_result?${query}`;
}

function titleReadUrl(conversationId: string, messageId: string, title = 'ocr_result') {
  const query = new URLSearchParams({ messageId, title });
  return `/api/steel/conversations/${conversationId}/review/ocr_result?${query}`;
}

type ReviewOperation = SteelReviewOperationPrepare['operations'][number];
type InsertPosition = Extract<ReviewOperation, { type: 'add' }>['position'];
type SourceUpdate = NonNullable<Extract<ReviewOperation, { type: 'update' }>['source']> & {
  rowId: string;
};

function requestForRows(
  table: SteelReviewTable,
  rows: SteelReviewTable['rows'] = table.rows,
  sourceIntents: readonly SourceUpdate[] = [],
): SteelReviewOperationPrepare {
  const original = new Map(table.rows.map((row) => [row.rowId, row]));
  const sources = new Map(sourceIntents.map(({ rowId, ...source }) => [rowId, source]));
  const operations: ReviewOperation[] = [];
  for (const row of rows) {
    const previous = original.get(row.rowId);
    const source =
      sources.get(row.rowId) ??
      (row.source
        ? { fileId: row.source.fileId, pageNumber: row.source.pageNumber }
        : { fileId: null, pageNumber: null });
    if (!previous) {
      const insertion = row.insertion;
      const position: InsertPosition =
        insertion?.kind === 'after' && insertion.rowId
          ? { kind: 'after', rowId: insertion.rowId }
          : { kind: insertion?.kind === 'start' ? 'start' : 'end' };
      operations.push({
        type: 'add',
        rowId: row.rowId,
        position,
        source,
        changes: table.headers
          .filter((header) => !['來源', '頁碼'].includes(header))
          .map((header) => ({ header, value: row.values[header].effective })),
      });
      continue;
    }
    if (previous.deleted && !row.deleted) operations.push({ type: 'restore', rowId: row.rowId });
    const changes = table.headers
      .filter((header) => previous.values[header].effective !== row.values[header].effective)
      .map((header) => ({ header, value: row.values[header].effective }));
    const changedSource =
      sources.has(row.rowId) ||
      previous.source?.fileId !== row.source?.fileId ||
      previous.source?.pageNumber !== row.source?.pageNumber;
    if (changes.length || changedSource) {
      operations.push({
        type: 'update',
        rowId: row.rowId,
        ...(changes.length ? { changes } : {}),
        ...(changedSource ? { source } : {}),
      });
    }
    if (!previous.deleted && row.deleted) operations.push({ type: 'delete', rowId: row.rowId });
  }
  return {
    conversationId: table.conversationId,
    messageId: table.messageId,
    kind: table.kind,
    title: table.title,
    outputId: table.outputId,
    revision: table.revision,
    operations,
  };
}

function operationCommit(operation: SteelReviewOperationPrepared): SteelReviewOperationCommit {
  return {
    ...operation.operationRequest,
    operationId: operation.operationId,
    digest: operation.digest,
  };
}

async function prepareQuantity(
  page: ReviewPage,
  headers: ReviewHeaders,
  table: SteelReviewTable,
  value: string,
  title?: string,
) {
  const request: SteelReviewOperationPrepare & { title?: string } = {
    conversationId: table.conversationId,
    messageId: table.messageId,
    kind: table.kind,
    title: title ?? table.title,
    outputId: table.outputId,
    revision: table.revision,
    operations: [
      { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value }] },
    ],
  };
  const url = `/api/steel/conversations/${table.conversationId}/review/ocr_result`;
  const response = await page.request.post(`${url}/prepare`, { headers, data: request });
  expect(response.status()).toBe(200);
  return (await response.json()) as SteelReviewOperationPrepared;
}

async function commitOperation(
  page: ReviewPage,
  headers: ReviewHeaders,
  operation: SteelReviewOperationPrepared,
) {
  const request = {
    ...operation.operationRequest,
    operationId: operation.operationId,
    digest: operation.digest,
  };
  const response = await page.request.post(
    `/api/steel/conversations/${request.conversationId}/review/ocr_result/commit`,
    { headers, data: request },
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as SteelReviewSaveResponse;
}
describe('Steel OCR review routes', () => {
  afterEach(async () => {
    await Promise.all(
      Object.entries(mongoose.connection.collections)
        .filter(([name]) => name !== 'users')
        .map(([, collection]) => collection.deleteMany({})),
    );
  });

  it('title locator requires the exact title and rejects removed positional fields', async () => {
    const markdown = `TITLE-KEEP-PREFIX\n\n## Ordinary table\n| Key | Value |\n| --- | --- |\n| Keep | 8 |\n\n${ocr}`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(response.status()).toBe(200);
    const { table } = (await response.json()) as { table: SteelReviewTable };
    expect(table.title).toBe('ocr_result');
    expect(table).not.toHaveProperty('tableId');
    expect(table).not.toHaveProperty('partIndex');
    for (const title of ['OCR_RESULT', 'ocr_result extra', 'ocr_resul']) {
      expect(
        (
          await page.request.get(titleReadUrl(conversationId, messageId, title), { headers })
        ).status(),
      ).toBe(404);
    }
    const missingTitle = `/api/steel/conversations/${conversationId}/review/ocr_result?${new URLSearchParams({ messageId })}`;
    expect((await page.request.get(missingTitle, { headers })).status()).toBe(400);
    for (const field of ['tableId=ocr_result%3A99', 'partIndex=99']) {
      expect(
        (
          await page.request.get(`${titleReadUrl(conversationId, messageId)}&${field}`, { headers })
        ).status(),
      ).toBe(400);
    }
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('title locator keeps one row ledger and immutable current-protocol receipts across consecutive Saves', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const initial = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(initial.status()).toBe(200);
    const { table } = (await initial.json()) as { table: SteelReviewTable };
    const rowIds = table.rows.map((row) => row.rowId);
    const operation = await prepareQuantity(page, headers, table, '7');
    const firstReceipt = await commitOperation(page, headers, operation);
    const first = await persistedSnapshot(conversationId);
    expect(first.reviews).toHaveLength(1);
    const response = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(response.status()).toBe(200);
    const { table: current } = (await response.json()) as { table: SteelReviewTable };
    expect(current.title).toBe(table.title);
    expect(current.rows.map((row) => row.rowId)).toEqual(rowIds);
    await commitOperation(page, headers, await prepareQuantity(page, headers, current, '8'));
    const second = await persistedSnapshot(conversationId);
    expect(second.reviews).toHaveLength(1);
    expect(second.reviews[0]?.title).toBe('ocr_result');
    expect(
      second.reviews[0]?.rows.map((row: SteelReviewTable['rows'][number]) => row.rowId),
    ).toEqual(rowIds);
    expect(second.reviews[0]?.aiRawMarkdown).toBe(first.reviews[0]?.aiRawMarkdown);
    expect(second.reviews[0]?.aiBaselineMarkdown).toBe(first.reviews[0]?.aiBaselineMarkdown);
    expect(second.reviews[0]?.receipts).toHaveLength(2);
    expect(second.reviews[0]?.receipts[0]).toEqual(first.reviews[0]?.receipts[0]);
    expect(second.messages.find((message) => message.messageId === messageId)?.text).toBe(
      ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'),
    );
    expect(await commitOperation(page, headers, operation)).toEqual(firstReceipt);
    expect(await persistedSnapshot(conversationId)).toEqual(second);
  });

  it('title locator re-resolves a moved physical section and rejects forged storage aliases without writing', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const read = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const operation = await prepareQuantity(page, headers, table, '7', 'ocr_result');
    const prefix =
      'TITLE-NEW-PREFIX\n\n## Unrelated insertion\n| Key | Value |\n| --- | --- |\n| Keep | 55 |\n\n';
    await withMongo(async (db) => {
      await db.collection('messages').updateOne(
        { conversationId, messageId },
        {
          $set: {
            text: prefix + ocr,
            content: [{ type: 'text', text: prefix + ocr }],
          },
        },
      );
    });
    const moved = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const forgedPrepare = await page.request.post(`${url}/prepare`, {
      headers,
      data: { ...operation.operationRequest, tableId: 'ocr_result:1' },
    });
    expect(forgedPrepare.status()).toBe(400);
    const forgedCommit = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...operation.operationRequest,
        tableId: 'ocr_result:1',
        operationId: operation.operationId,
        digest: operation.digest,
      },
    });
    expect(forgedCommit.status()).toBe(400);
    expect(await persistedSnapshot(conversationId)).toEqual(moved);
    await commitOperation(page, headers, operation);
    const after = await persistedSnapshot(conversationId);
    const clean =
      prefix + ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |');
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(clean);
    expect(after.messages.find((message) => message.messageId === messageId)?.content).toEqual([
      { type: 'text', text: clean },
    ]);
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews[0]?.title).toBe('ocr_result');
    const latest = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(latest.status()).toBe(200);
    expect(await latest.json()).toMatchObject({
      table: {
        title: 'ocr_result',
        rows: [{ rowId: table.rows[0].rowId, values: { 數量: { effective: '7' } } }, {}],
      },
    });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  it('title locator rejects duplicated full titles without creating or changing any data', async () => {
    const { conversationId, messageId } = await seedCurrent(`${ocr}\n\n${ocr}`);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(titleReadUrl(conversationId, messageId), { headers });
    expect(response.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('a registered review cannot expose a table removed from the message', async () => {
    const { conversationId, messageId } = await seedCurrent('REVIEW-REMOVED-TARGET');
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
        rows: [
          {
            rowId: 'registered-row',
            source: null,
            values: {
              來源: { baseline: 'A', effective: 'A' },
              零件編號: { baseline: 'REVIEW-P1', effective: 'REVIEW-P1' },
              長度: { baseline: '1000', effective: '1000' },
              數量: { baseline: '2', effective: '2' },
              頁碼: { baseline: '1', effective: '1' },
            },
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(result.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('foreign and missing mapped files leave rows unlocated without exposing source metadata', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    await withMongo(async (db) => {
      await db.collection('files').updateOne(
        { conversationId, file_id: 'review-alpha' },
        {
          $set: { user: new ObjectId(), filename: 'PRIVATE-FOREIGN.pdf' },
        },
      );
      await db.collection('steel_conversation_ocr_state').updateOne(
        { conversationId },
        {
          $set: {
            sourceMappings: [
              { fileId: 'review-alpha', sourceCode: 'A', sourceFilename: 'PRIVATE-FOREIGN.pdf' },
            ],
          },
        },
      );
    });
    const before = await persistedSnapshot(conversationId);
    const foreign = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(foreign.status()).toBe(200);
    const foreignBody = await foreign.json();
    expect(foreignBody).toMatchObject({ table: { rows: [{ source: null }, { source: null }] } });
    expect(JSON.stringify(foreignBody)).not.toContain('PRIVATE-FOREIGN');
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await withMongo(async (db) => {
      await db.collection('files').deleteOne({ conversationId, file_id: 'review-alpha' });
    });
    const missing = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(missing.status()).toBe(200);
    expect(await missing.json()).toMatchObject({
      table: { rows: [{ source: null }, { source: null }] },
    });
  });

  it('an attachment cannot certify an explicit other-chat file or choose between duplicate file records', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    await seedMessages(conversationId, [
      {
        messageId: randomUUID(),
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        text: 'Review uploaded source',
        isCreatedByUser: true,
        sender: 'User',
        files: [{ file_id: 'review-alpha' }],
      },
    ]);
    try {
      await withMongo(async (db) => {
        await db.collection('files').updateOne(
          { conversationId, file_id: 'review-alpha' },
          {
            $set: { conversationId: randomUUID(), filename: 'PRIVATE-OTHER-CHAT.pdf' },
          },
        );
      });
      const foreign = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(foreign.status()).toBe(200);
      const foreignData = await foreign.json();
      expect(foreignData).toMatchObject({ table: { rows: [{ source: null }, { source: null }] } });
      expect(JSON.stringify(foreignData)).not.toContain('PRIVATE-OTHER-CHAT');
      await withMongo(async (db) => {
        await db
          .collection('files')
          .updateOne({ file_id: 'review-alpha' }, { $set: { conversationId } });
        const original = await db
          .collection('files')
          .findOne({ conversationId, file_id: 'review-alpha' });
        if (!original) throw new Error('Missing owned fixture file');
        await db
          .collection('files')
          .insertOne({ ...original, _id: new ObjectId(), filename: 'PRIVATE-DUPLICATE.pdf' });
      });
      const duplicate = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(duplicate.status()).toBe(200);
      expect(await duplicate.json()).toMatchObject({
        table: { rows: [{ source: null }, { source: null }] },
      });
    } finally {
      await withMongo(async (db) => {
        await db
          .collection('files')
          .updateMany({ file_id: 'review-alpha' }, { $set: { conversationId } });
      });
    }
  });

  it('legacy OCR identity shared by another tenant does not expose unscoped current state', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    await withMongo(async (db) => {
      const own = await db.collection('conversations').findOne({ conversationId });
      if (!own) {
        throw new Error('Missing owned fixture conversation');
      }
      await db
        .collection('conversations')
        .insertOne({ ...own, _id: new ObjectId(), tenantId: 'review-other-tenant' });
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(result.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('ordinary tables after other heading levels do not inherit an OCR section identity', async () => {
    for (const heading of ['# unrelated', '### unrelated']) {
      const markdown = `${ocr}\n\n${heading}\n${ocr.split('\n').slice(1).join('\n').replaceAll('REVIEW-P', 'UNMANAGED-P')}`;
      const { conversationId, messageId } = await seedCurrent(markdown);
      await withMongo(async (db) => {
        await db.collection('steel_conversation_ocr_state').updateOne(
          { conversationId },
          {
            $set: { currentOcrResultMarkdown: markdown },
          },
        );
      });
      const before = await persistedSnapshot(conversationId);
      const result = await page.request.get(
        readUrl(conversationId, messageId, heading.replaceAll('#', '').trim()),
        { headers },
      );
      expect(result.status()).toBe(404);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  it('a historical sidecar updated later cannot mask the authoritative current output', async () => {
    const { conversationId, messageId, snapshot } = await seedSavedReviewData(page, headers);
    await withMongo(async (db) => {
      const current = await db
        .collection('steel_review_outputs')
        .findOne({ conversationId, messageId, title: 'ocr_result' });
      if (!current) throw new Error('Missing current-protocol saved owner');
      await db.collection('steel_review_outputs').insertOne({
        ...current,
        _id: new ObjectId(),
        outputId: 'ocr_result:historical-generation',
        revision: 'historical-sidecar',
        state: 'historical',
        rows: current.rows.map((row: SteelReviewTable['rows'][number], index: number) => ({
          ...row,
          rowId: createHash('sha256')
            .update(
              `ocr_result:historical-generation:${index}:${JSON.stringify(current.headers.map((header: string) => row.values[header].baseline ?? ''))}`,
            )
            .digest('hex'),
        })),
        updatedAt: new Date(Date.now() + 60_000),
        receipts: [],
      });
    });
    const before = await persistedSnapshot(conversationId);
    const result = await page.request.get(readUrl(conversationId, messageId), { headers });
    expect(result.status()).toBe(200);
    expect(await result.json()).toMatchObject({
      table: {
        title: 'ocr_result',
        outputId: 'ocr_result:review-proof-generation',
        revision: snapshot.revision,
        isLatest: true,
        readOnly: false,
      },
    });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('identical duplicate tables are ambiguous and get no managed target', async () => {
    const { conversationId, messageId } = await seedCurrent(`${ocr}\n\n${ocr}`);
    const before = await persistedSnapshot(conversationId);
    for (const title of ['ocr_result']) {
      const result = await page.request.get(readUrl(conversationId, messageId, title), { headers });
      expect(result.status()).toBe(404);
    }
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('source identity collisions fail closed even when one duplicate is not previewable', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    await withMongo(async (db) => {
      const file = await db.collection('files').findOne({ conversationId });
      if (!file) throw new Error('Missing fixture file');
      await db
        .collection('files')
        .insertOne({ ...file, _id: new ObjectId(), filename: 'collision.txt', type: 'text/plain' });
    });
    const before = await persistedSnapshot(conversationId);
    const root = `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
    const query = new URLSearchParams({ messageId, title: 'ocr_result' });
    const list = await page.request.get(`${root}?${query}`, { headers });
    expect(list.status()).toBe(200);
    expect(await list.json()).toEqual({ sources: [] });
    const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
    expect(binary.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('legacy source identity cannot reuse a same-user file ID claimed by another chat', async () => {
    const current = await seedCurrent(ocr);
    const other = await seedCurrent(ocr);
    await withMongo(async (db) => {
      await db.collection('files').updateOne(
        { conversationId: current.conversationId },
        {
          $unset: { conversationId: '' },
        },
      );
    });
    try {
      const before = await persistedSnapshot(current.conversationId);
      const otherBefore = await persistedSnapshot(other.conversationId);
      const review = await page.request.get(
        readUrl(current.conversationId, current.messageId, 'ocr_result'),
        { headers },
      );
      expect(review.status()).toBe(200);
      expect(await review.json()).toMatchObject({
        table: {
          rows: [{ source: null }, { source: null }],
        },
      });
      const root = `/api/steel/conversations/${current.conversationId}/review/ocr_result/sources`;
      const query = new URLSearchParams({ messageId: current.messageId, title: 'ocr_result' });
      const list = await page.request.get(`${root}?${query}`, { headers });
      expect(list.status()).toBe(200);
      expect(await list.json()).toEqual({ sources: [] });
      const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
      expect(binary.status()).toBe(404);
      expect(await persistedSnapshot(current.conversationId)).toEqual(before);
      expect(await persistedSnapshot(other.conversationId)).toEqual(otherBefore);
    } finally {
      await withMongo(async (db) => {
        await db.collection('files').updateOne(
          { messageId: current.messageId },
          {
            $set: { conversationId: current.conversationId },
          },
        );
      });
    }
  });

  it('an expired clicked message is rejected with or without source mappings', async () => {
    for (const withSource of [false, true]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      await withMongo(async (db) => {
        await db.collection('messages').updateOne(
          { conversationId, messageId },
          {
            $set: { expiredAt: new Date(Date.now() - 60_000) },
          },
        );
        if (!withSource) {
          await db.collection('steel_conversation_ocr_state').updateOne(
            { conversationId },
            {
              $set: { sourceMappings: [] },
            },
          );
        }
      });
      const before = await persistedSnapshot(conversationId);
      const review = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(review.status()).toBe(404);
      const root = `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
      const query = new URLSearchParams({ messageId, title: 'ocr_result' });
      const list = await page.request.get(`${root}?${query}`, { headers });
      expect(list.status()).toBe(200);
      expect(await list.json()).toEqual({ sources: [] });
      const binary = await page.request.get(`${root}/review-alpha?${query}`, { headers });
      expect(binary.status()).toBe(404);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  it('an unavailable source stays unlocated without blocking a later business-cell Save', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    for (const quantity of ['7', '8']) {
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      const { table } = (await read.json()) as { table: SteelReviewTable };
      if (quantity === '8') expect(table.rows[0].source).toBeNull();
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepare = await page.request.post(`${url}/prepare`, {
        headers,
        data: requestForRows(table, rows),
      });
      expect(prepare.status()).toBe(200);
      const save = await page.request.post(`${url}/commit`, {
        headers,
        data: operationCommit(await prepare.json()),
      });
      expect(save.status()).toBe(200);
      if (quantity === '7') {
        await withMongo(async (db) => {
          await db.collection('files').updateOne(
            { conversationId, file_id: 'review-alpha' },
            {
              $set: { expiredAt: new Date(Date.now() - 60_000) },
            },
          );
        });
      }
    }
    const after = await persistedSnapshot(conversationId);
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(
      ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'),
    );
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toMatchObject({
      table: {
        rows: [
          { source: null, values: { 數量: { baseline: '2', effective: '8' } } },
          { source: null },
        ],
      },
    });
  });

  it('clearing an OCR cell keeps its AI baseline and clean reload does not resurrect the old value', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['長度'].effective = null;
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(prepare.status()).toBe(200);
    const saved = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(await prepare.json()),
    });
    expect(saved.status()).toBe(200);
    const snapshot = await persistedSnapshot(conversationId);
    expect(snapshot.messages.find((message) => message.messageId === messageId)?.text).toBe(
      ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 |  | 2 | 1 |'),
    );
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(reloaded.status()).toBe(200);
    const current = (await reloaded.json()) as { table: SteelReviewTable };
    expect(current.table.rows[0].values['長度']).toEqual({ baseline: '1000', effective: '' });
    const noChange = await page.request.post(`${url}/prepare`, {
      headers,
      data: {
        ...requestForRows(current.table),
        operations: [
          {
            type: 'update',
            rowId: current.table.rows[0].rowId,
            changes: [{ header: '長度', value: null }],
          },
        ],
      },
    });
    expect(noChange.status()).toBe(200);
    const noOp = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(await noChange.json()),
    });
    expect(noOp.status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(snapshot);
  });

  for (const proof of [
    'matching_receipt',
    'missing_receipt',
    'mismatched_receipt',
    'mismatched_hash',
    'mismatched_digest',
  ] as const) {
    it(`a pre-selector saved source stays reliable only with matching immutable proof: ${proof}`, async () => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const saveQuantity = async (table: SteelReviewTable, quantity: string) => {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = quantity;
        const prepare = await page.request.post(`${url}/prepare`, {
          headers,
          data: requestForRows(table, rows),
        });
        expect(prepare.status()).toBe(200);
        const commit = await page.request.post(`${url}/commit`, {
          headers,
          data: operationCommit(await prepare.json()),
        });
        expect(commit.status()).toBe(200);
      };
      const initial = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(initial.status()).toBe(200);
      await saveQuantity(((await initial.json()) as { table: SteelReviewTable }).table, '7');
      await withMongo(async (db) => {
        const filter = { conversationId, messageId, kind: 'ocr_result' };
        const legacy = await db.collection('steel_review_outputs').updateOne(filter, {
          $unset: {
            sourceMappings: '',
            'receipts.$[].snapshot.sourceMappings': '',
          },
        });
        expect(legacy.matchedCount).toBe(1);
        if (proof === 'missing_receipt') {
          await db.collection('steel_review_outputs').updateOne(filter, { $set: { receipts: [] } });
        }
        if (proof === 'mismatched_receipt') {
          await db.collection('steel_review_outputs').updateOne(filter, {
            $set: {
              'receipts.0.snapshot.rows.0.values.數量.effective': '999',
            },
          });
        }
        if (proof === 'mismatched_hash') {
          await db.collection('steel_review_outputs').updateOne(filter, {
            $set: {
              'receipts.0.snapshot.messageSha256': '0'.repeat(64),
            },
          });
        }
        if (proof === 'mismatched_digest') {
          await db.collection('steel_review_outputs').updateOne(filter, {
            $set: {
              'receipts.0.snapshot.digest': '0'.repeat(64),
            },
          });
        }
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      const { table } = (await read.json()) as { table: SteelReviewTable };
      expect(table.rows.map((row) => row.source)).toEqual(
        proof === 'matching_receipt'
          ? before.reviews[0].rows.map((row: SteelReviewTable['rows'][number]) => row.source)
          : [null, null],
      );
      expect(table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '7' });
      expect(table.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      await saveQuantity(table, '8');
      const after = await persistedSnapshot(conversationId);
      expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(
        ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'),
      );
      expectPreservedAiState(before.ocr, after.ocr);
      expect(after.reviews[0].receipts.slice(0, before.reviews[0].receipts.length)).toEqual(
        before.reviews[0].receipts,
      );
      const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({
        table: {
          rows: [{ values: { 數量: { baseline: '2', effective: '8' } } }, {}],
        },
      });
    });
  }

  for (const proof of ['matching_receipt', 'mismatched_hash', 'mismatched_digest'] as const) {
    it(`a second-part legacy source requires exact full-message immutable proof: ${proof}`, async () => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      const prefix = 'LEGACY-PART-PREFIX';
      const suffix = 'LEGACY-PART-SUFFIX';
      await withMongo(async (db) => {
        await db.collection('messages').updateOne(
          { conversationId, messageId },
          {
            $set: {
              text: `${prefix} ${ocr} ${suffix}`,
              content: [
                { type: 'text', text: prefix },
                { type: 'text', text: ocr },
                { type: 'text', text: suffix },
              ],
            },
          },
        );
      });
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const saveQuantity = async (table: SteelReviewTable, quantity: string) => {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = quantity;
        const prepare = await page.request.post(`${url}/prepare`, {
          headers,
          data: requestForRows(table, rows),
        });
        expect(prepare.status()).toBe(200);
        const commit = await page.request.post(`${url}/commit`, {
          headers,
          data: operationCommit(await prepare.json()),
        });
        expect(commit.status()).toBe(200);
      };
      const initial = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(initial.status()).toBe(200);
      await saveQuantity(((await initial.json()) as { table: SteelReviewTable }).table, '7');
      await withMongo(async (db) => {
        const filter = { conversationId, messageId, kind: 'ocr_result' };
        const legacy = await db.collection('steel_review_outputs').updateOne(filter, {
          $unset: {
            sourceMappings: '',
            'receipts.$[].snapshot.sourceMappings': '',
          },
        });
        expect(legacy.matchedCount).toBe(1);
        if (proof === 'mismatched_hash') {
          await db.collection('steel_review_outputs').updateOne(filter, {
            $set: {
              'receipts.0.snapshot.messageSha256': '0'.repeat(64),
            },
          });
        }
        if (proof === 'mismatched_digest') {
          await db.collection('steel_review_outputs').updateOne(filter, {
            $set: {
              'receipts.0.snapshot.digest': '0'.repeat(64),
            },
          });
        }
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      const { table } = (await read.json()) as { table: SteelReviewTable };
      expect(table.title).toBe('ocr_result');
      expect(table).not.toHaveProperty('partIndex');
      expect(table.rows.map((row) => row.source)).toEqual(
        proof === 'matching_receipt'
          ? before.reviews[0].rows.map((row: SteelReviewTable['rows'][number]) => row.source)
          : [null, null],
      );
      expect(table.rows[0].values['數量']).toEqual({ baseline: '2', effective: '7' });
      expect(table.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      await saveQuantity(table, '8');
      const after = await persistedSnapshot(conversationId);
      expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(
        `${prefix} ${ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |')} ${suffix}`,
      );
      expect(after.messages.find((message) => message.messageId === messageId)?.content).toEqual([
        { type: 'text', text: prefix },
        {
          type: 'text',
          text: ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'),
        },
        { type: 'text', text: suffix },
      ]);
      expectPreservedAiState(before.ocr, after.ocr);
      expect(after.reviews[0].receipts.slice(0, before.reviews[0].receipts.length)).toEqual(
        before.reviews[0].receipts,
      );
      const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({
        table: {
          rows: [{ values: { 數量: { baseline: '2', effective: '8' } } }, {}],
        },
      });
    });
  }

  it('source and page cells cannot bypass the dedicated source association contract', async () => {
    for (const [header, value] of [
      ['來源', 'FORGED-SOURCE'],
      ['頁碼', '99'],
    ]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      const { table } = (await read.json()) as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values[header].effective = value;
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const prepare = await page.request.post(`${url}/prepare`, {
        headers,
        data: requestForRows(table, rows),
      });
      if (prepare.status() === 200) {
        const commit = await page.request.post(`${url}/commit`, {
          headers,
          data: operationCommit(await prepare.json()),
        });
        expect([400, 409]).toContain(commit.status());
      }
      expect([400, 409]).toContain(prepare.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  it('the backend saves only its exact message target and rejects a second stale prepared operation', async () => {
    const markdown = `CAS-PREFIX\n\n${ocr}\n\n## Other data\n| Name | Value |\n| --- | --- |\n| KEEP | 42 |\n\nCAS-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    const previousMessageId = randomUUID();
    await seedMessages(conversationId, [
      {
        messageId: previousMessageId,
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        text: ocr.replace('REVIEW-P1', 'OTHER-MESSAGE-KEEP'),
        content: [{ type: 'text', text: ocr.replace('REVIEW-P1', 'OTHER-MESSAGE-KEEP') }],
        isCreatedByUser: false,
        sender: 'Assistant',
      },
    ]);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne(
        { conversationId, messageId },
        {
          $set: {
            text: `${markdown} CAS-SECOND-PART`,
            content: [
              { type: 'text', text: markdown },
              { type: 'text', text: 'CAS-SECOND-PART' },
            ],
            'metadata.steelReview.system_order': {
              version: 1,
              kind: 'system_order',
              conversationId,
              messageId,
              tableId: 'system_order:unrelated',
              outputId: 'system_order:previous-run',
              revision: 'UNRELATED-STATUS-KEEP',
              updatedAt: new Date(Date.now() - 60_000),
            },
          },
        },
      );
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const operations: SteelReviewOperationPrepared[] = [];
    for (const quantity of ['7', '8']) {
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepared = await page.request.post(`${url}/prepare`, {
        headers,
        data: requestForRows(table, rows),
      });
      expect(prepared.status()).toBe(200);
      operations.push((await prepared.json()) as SteelReviewOperationPrepared);
    }
    const saved = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(operations[0]),
    });
    expect(saved.status()).toBe(200);
    const savedBody = await saved.json<SteelReviewSaveResponse>();
    const after = await persistedSnapshot(conversationId);
    const expected = markdown.replace(
      '| A | REVIEW-P1 | 1000 | 2 | 1 |',
      '| A | REVIEW-P1 | 1000 | 7 | 1 |',
    );
    const message = after.messages.find((candidate) => candidate.messageId === messageId);
    expect(message?.text).toBe(`${expected} CAS-SECOND-PART`);
    expect(message?.content).toEqual([
      { type: 'text', text: expected },
      { type: 'text', text: 'CAS-SECOND-PART' },
    ]);
    expect(savedBody.savedSnapshot).toMatchObject({
      conversationId,
      messageId,
      messageText: `${expected} CAS-SECOND-PART`,
      messageSha256: createHash('sha256').update(`${expected} CAS-SECOND-PART`).digest('hex'),
      messageTextParts: [
        { partIndex: 0, text: expected },
        { partIndex: 1, text: 'CAS-SECOND-PART' },
      ],
      ownerUpdated: {
        version: 1,
        kind: 'ocr_result',
        conversationId,
        messageId,
        title: table.title,
        outputId: table.outputId,
        revision: savedBody.revision,
      },
    });
    expect(message?.metadata?.steel).toEqual(
      before.messages.find((candidate) => candidate.messageId === messageId)?.metadata?.steel,
    );
    expect(message?.metadata?.steelReview?.system_order).toEqual(
      before.messages.find((candidate) => candidate.messageId === messageId)?.metadata?.steelReview
        ?.system_order,
    );
    expect(message?.metadata?.steelReview?.ocr_result).toMatchObject({
      kind: 'ocr_result',
      conversationId,
      messageId,
      title: table.title,
      outputId: table.outputId,
      revision: savedBody.revision,
    });

    expect(after.messages.find((candidate) => candidate.messageId === previousMessageId)).toEqual(
      before.messages.find((candidate) => candidate.messageId === previousMessageId),
    );
    const review = after.reviews[0];
    expect(review?.aiRawMarkdown).toBe(ocr);
    expect(review?.aiBaselineMarkdown).toBe(ocr);
    expect(review?.humanMarkdown).toBe(
      ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'),
    );
    expect(review?.effectiveMarkdown).toBe(review?.humanMarkdown);
    // A human Save must not replace the latest AI input or advance its timestamp.
    expectPreservedAiState(before.ocr, after.ocr);
    expect(review?.aiUpdatedAt).toEqual(before.ocr?.updatedAt);
    expect(review?.humanSavedAt.getTime()).toBeGreaterThan(before.ocr?.updatedAt.getTime());
    const stale = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(operations[1]),
    });
    expect(stale.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(after);
    const reloaded = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(reloaded.status()).toBe(200);
    expect(await reloaded.json()).toMatchObject({
      table: {
        messageId,
        isLatest: true,
        readOnly: false,
        rows: [
          { values: { 數量: { baseline: '2', effective: '7' } } },
          { values: { 數量: { baseline: '3', effective: '3' } } },
        ],
      },
    });
  });

  for (const collision of ['other_message', 'other_kind', 'two_other_owners'] as const) {
    it(`first OCR Save preserves unrelated review owners sharing its outputId: ${collision}`, async () => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      const { table } = (await read.json()) as { table: SteelReviewTable };
      const foreignMessageIds = [randomUUID(), randomUUID()];
      await seedMessages(
        conversationId,
        foreignMessageIds.map((id) => ({
          messageId: id,
          parentMessageId: '00000000-0000-0000-0000-000000000000',
          text: `UNRELATED-OWNER-PREFIX ${id}\n${ocr}\nUNRELATED-OWNER-SUFFIX`,
          isCreatedByUser: false,
          sender: 'Assistant',
        })),
      );
      await withMongo(async (db) => {
        const owner = await db.collection('messages').findOne({ conversationId, messageId });
        if (!owner) throw new Error('Missing current owner');
        const scopes =
          collision === 'two_other_owners'
            ? foreignMessageIds.map((id) => ({
                messageId: id,
                kind: 'ocr_result',
                title: 'ocr_result',
              }))
            : [
                {
                  messageId: collision === 'other_message' ? foreignMessageIds[0] : messageId,
                  kind: collision === 'other_kind' ? 'system_order' : 'ocr_result',
                  title: 'ocr_result',
                },
              ];
        await db.collection('steel_review_outputs').insertMany(
          scopes.map((scope) => ({
            userId: owner.user,
            ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
            conversationId,
            ...scope,
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
          })),
        );
      });
      const before = await persistedSnapshot(conversationId);
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '7';
      const preparedResponse = await page.request.post(
        `/api/steel/conversations/${conversationId}/review/ocr_result/prepare`,
        {
          headers,
          data: requestForRows(table, rows),
        },
      );
      expect(preparedResponse.status()).toBe(200);
      const prepared = (await preparedResponse.json()) as SteelReviewOperationPrepared;
      const committed = await page.request.post(
        `/api/steel/conversations/${conversationId}/review/ocr_result/commit`,
        {
          headers,
          data: operationCommit(prepared),
        },
      );
      expect(committed.status()).toBe(200);
      const after = await persistedSnapshot(conversationId);
      expect(after.reviews).toHaveLength(before.reviews.length + 1);
      for (const original of before.reviews) {
        expect(after.reviews.find((row) => row._id.equals(original._id))).toEqual(original);
      }
      const saved = after.reviews.find(
        (row) =>
          row.messageId === messageId && row.kind === 'ocr_result' && row.title === table.title,
      );
      expect(saved).toMatchObject({ kind: 'ocr_result', outputId: table.outputId, rows });
      for (const original of before.messages.filter((message) => message.messageId !== messageId)) {
        expect(after.messages.find((message) => message.messageId === original.messageId)).toEqual(
          original,
        );
      }
      expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(
        ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |'),
      );
      expectPreservedAiState(before.ocr, after.ocr);
      const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(reopened.status()).toBe(200);
      expect(await reopened.json()).toMatchObject({
        table: { messageId, title: table.title, rows },
      });
    });
  }

  it('committed receipt replay rejects client replacement projections', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    const prepare = await page.request.post(
      `/api/steel/conversations/${conversationId}/review/ocr_result/prepare`,
      {
        headers,
        data: requestForRows(table, rows),
      },
    );
    expect(prepare.status()).toBe(200);
    const prepared = (await prepare.json()) as SteelReviewOperationPrepared;
    const commitUrl = `/api/steel/conversations/${conversationId}/review/ocr_result/commit`;
    expect(
      (await page.request.post(commitUrl, { headers, data: operationCommit(prepared) })).status(),
    ).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const replay = await page.request.post(commitUrl, {
      headers,
      data: { ...operationCommit(prepared), cleanReplacementText: 'UNSIGNED-CLEAN-TEXT' },
    });
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  for (const stage of ['first_save', 'saved_output'] as const) {
    for (const boundary of ['prepare', 'commit'] as const) {
      it(`located source metadata cannot be erased through ${boundary}: ${stage}`, async () => {
        const { conversationId, messageId } = await seedCurrent(ocr);
        const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
          headers,
        });
        expect(read.status()).toBe(200);
        let { table } = (await read.json()) as { table: SteelReviewTable };
        const reviewUrl = `/api/steel/conversations/${conversationId}/review/ocr_result`;
        if (stage === 'saved_output') {
          const initialRows = structuredClone(table.rows);
          initialRows[0].values['數量'].effective = '4';
          const initialPrepare = await page.request.post(`${reviewUrl}/prepare`, {
            headers,
            data: requestForRows(table, initialRows),
          });
          expect(initialPrepare.status()).toBe(200);
          expect(
            (
              await page.request.post(`${reviewUrl}/commit`, {
                headers,
                data: operationCommit(await initialPrepare.json()),
              })
            ).status(),
          ).toBe(200);
          const savedRead = await page.request.get(
            readUrl(conversationId, messageId, 'ocr_result'),
            { headers },
          );
          expect(savedRead.status()).toBe(200);
          ({ table } = (await savedRead.json()) as { table: SteelReviewTable });
        }
        expect(table.rows[0].source).toMatchObject({ fileId: 'review-alpha', pageNumber: 1 });
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = '7';
        let payload: (SteelReviewOperationCommit | SteelReviewTable) & {
          rows: SteelReviewTable['rows'];
        };
        if (boundary === 'commit') {
          const validPrepare = await page.request.post(`${reviewUrl}/prepare`, {
            headers,
            data: requestForRows(table, rows),
          });
          expect(validPrepare.status()).toBe(200);
          const prepared = (await validPrepare.json()) as SteelReviewOperationPrepared;
          rows[0].source = null;
          payload = { ...operationCommit(prepared), rows };
        } else {
          rows[0].source = null;
          payload = { ...table, rows };
        }
        const before = await persistedSnapshot(conversationId);
        const rejected = await page.request.post(`${reviewUrl}/${boundary}`, {
          headers,
          data: payload,
        });
        expect(rejected.status()).toBe(400);
        expect(await rejected.json()).toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
        expect(await persistedSnapshot(conversationId)).toEqual(before);
      });
    }
  }

  it('OCR ledger authority rejects forged identities and anchors while independent manual rows save atomically', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const before = await persistedSnapshot(conversationId);
    const manualValues = new Map([
      ['零件編號', 'API-MANUAL'],
      ['數量', '4'],
    ]);
    const makeManual = (ordinal: number) => ({
      rowId: randomUUID(),
      origin: 'manual' as const,
      deleted: false,
      insertion: { kind: 'end' as const, ordinal },
      source: null,
      values: Object.fromEntries(
        table.headers.map((header) => [
          header,
          {
            baseline: null,
            effective: manualValues.get(header) ?? '',
          },
        ]),
      ),
    });
    const update = {
      type: 'update',
      rowId: table.rows[0].rowId,
      changes: [{ header: '數量', value: '8' }],
    };
    const add = {
      type: 'add',
      rowId: randomUUID(),
      position: { kind: 'end' },
      changes: [{ header: '數量', value: '4' }],
    };
    const attacks = [
      { name: 'origin', operations: [{ ...update, origin: 'manual' }] },
      { name: 'baseline', operations: [{ ...update, baseline: null }] },
      { name: 'duplicate', operations: [update, update] },
      { name: 'unknown_row', operations: [{ ...update, rowId: randomUUID() }] },
      { name: 'existing_row_add', operations: [{ ...add, rowId: table.rows[0].rowId }] },
      {
        name: 'foreign_anchor',
        operations: [{ ...add, position: { kind: 'after', rowId: randomUUID() } }],
      },
      { name: 'ai_insertion', operations: [{ ...add, origin: 'ai' }] },
    ];
    for (const attack of attacks) {
      const refused = await page.request.post(`${url}/prepare`, {
        headers,
        data: { ...requestForRows(table), operations: attack.operations },
      });
      expect([400, 409]).toContain(refused.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
    const first = makeManual(0);
    const second = makeManual(1);
    const preparedResponse = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, [...table.rows, first, second]),
    });
    expect(preparedResponse.status()).toBe(200);
    const prepared = (await preparedResponse.json()) as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(2);
    expect(prepared.caption.changedRowIds).toEqual([first.rowId, second.rowId]);
    expect(prepared.rows.map((row) => row.rowId)).toEqual([
      ...table.rows.map((row) => row.rowId),
      first.rowId,
      second.rowId,
    ]);
    const forged = { ...operationCommit(prepared), rows: structuredClone(prepared.rows) };
    Reflect.set(forged.rows[0], 'origin', 'manual');
    expect([400, 409]).toContain(
      (await page.request.post(`${url}/commit`, { headers, data: forged })).status(),
    );
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const committed = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(prepared),
    });
    expect(committed.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows.slice(-2)).toMatchObject([
      { rowId: first.rowId, origin: 'manual', deleted: false, source: null },
      { rowId: second.rowId, origin: 'manual', deleted: false, source: null },
    ]);
    expect(saved.messages.find((message) => message.messageId === messageId)?.text).toBe(
      ocr + '\n|  | API-MANUAL |  | 4 |  |\n|  | API-MANUAL |  | 4 |  |',
    );
    expect(saved.reviews[0]?.receipts).toHaveLength(1);
    expectPreservedAiState(before.ocr, saved.ocr);
    expect(
      (
        await page.request.post(`${url}/commit`, { headers, data: operationCommit(prepared) })
      ).status(),
    ).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
    const currentResponse = await page.request.get(
      readUrl(conversationId, messageId, 'ocr_result'),
      { headers },
    );
    expect(currentResponse.status()).toBe(200);
    const { table: current } = (await currentResponse.json()) as { table: SteelReviewTable };
    for (const attack of ['anchor', 'ordinal', 'placement_swap']) {
      const changes = [{ header: '數量', value: '5' }];
      const operations =
        attack === 'placement_swap'
          ? [
              {
                type: 'add',
                rowId: first.rowId,
                position: { kind: 'after', rowId: second.rowId },
                changes,
              },
            ]
          : [
              {
                type: 'update',
                rowId: first.rowId,
                changes,
                ...(attack === 'anchor'
                  ? { position: { kind: 'after', rowId: table.rows[0].rowId } }
                  : { ordinal: 3 }),
              },
            ];
      const refused = await page.request.post(`${url}/prepare`, {
        headers,
        data: { ...requestForRows(current), operations },
      });
      expect([400, 409]).toContain(refused.status());
      expect(await persistedSnapshot(conversationId)).toEqual(saved);
    }
  });

  it('a reliable saved source reuses its code and same-association intent is a no-op', async () => {
    const { conversationId, messageId, snapshot } = await seedSavedReviewData(page, headers);
    const before = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    expect(table.rows).toEqual(snapshot.rows);
    expect(table.rows[0].source).toMatchObject({ fileId: 'review-alpha', pageNumber: 1 });
    const noop = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, undefined, [
        { rowId: table.rows[0].rowId, fileId: 'review-alpha', pageNumber: 1 },
      ]),
    });
    expect(noop.status()).toBe(200);
    const noopPrepared = (await noop.json()) as SteelReviewOperationPrepared;
    expect(noopPrepared.caption.changedRows).toBe(0);
    const noopCommit = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(noopPrepared),
    });
    expect(noopCommit.status()).toBe(200);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const changed = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, undefined, [
        { rowId: table.rows[0].rowId, fileId: 'review-alpha', pageNumber: 2 },
      ]),
    });
    expect(changed.status()).toBe(200);
    const changedPrepared = (await changed.json()) as SteelReviewOperationPrepared;
    expect(changedPrepared.caption.changedRows).toBe(1);
    expect(changedPrepared.rows[0].values['來源']).toEqual({ baseline: 'A', effective: 'A' });
    expect(changedPrepared.rows[0].values['頁碼']).toEqual({ baseline: '1', effective: '2' });
    const commit = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(changedPrepared),
    });
    expect(commit.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.receipts.slice(0, 1)).toEqual(before.reviews[0]?.receipts);
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(
      snapshot.messageText.replace(
        '| A | REVIEW-P1 | 1000 | 7 | 1 |',
        '| A | REVIEW-P1 | 1000 | 7 | 2 |',
      ),
    );
    expectPreservedAiState(before.ocr, after.ocr);
  });

  for (const [reservedCode, nextCode] of [
    ['F7', 'F8'],
    ['F9007199254740993', 'F9007199254740994'],
  ]) {
    it(`unproven source ${reservedCode} remains reserved without becoming a file association`, async () => {
      const markdown = ocr.replace('| A | REVIEW-P2', `| ${reservedCode} | REVIEW-P2`);
      const { conversationId, messageId } = await seedCurrent(markdown);
      await seedSelectorFiles(conversationId);
      await withMongo(async (db) => {
        await db.collection('steel_conversation_ocr_state').updateOne(
          { conversationId },
          {
            $set: {
              currentOcrResultMarkdown: markdown,
              sourceMappings: [],
            },
          },
        );
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      const { table } = (await read.json()) as { table: SteelReviewTable };
      expect(table.rows.map((row) => row.source)).toEqual([null, null]);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const response = await page.request.post(`${url}/prepare`, {
        headers,
        data: requestForRows(table, undefined, [
          { rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 1 },
        ]),
      });
      expect(response.status()).toBe(200);
      const prepared = (await response.json()) as SteelReviewOperationPrepared;
      expect(prepared.rows[0].values['來源'].effective).toBe(nextCode);
      expect(prepared.rows[1]).toEqual({ ...table.rows[1], origin: 'ai', deleted: false });
      expect(await persistedSnapshot(conversationId)).toEqual(before);
      const commit = await page.request.post(`${url}/commit`, {
        headers,
        data: operationCommit(prepared),
      });
      expect(commit.status()).toBe(200);
      const after = await persistedSnapshot(conversationId);
      const reopen = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(reopen.status()).toBe(200);
      const reopened = (await reopen.json()) as { table: SteelReviewTable };
      expect(reopened.table.rows[0].source).toMatchObject({ fileId: 'review-beta', pageNumber: 1 });
      expect(reopened.table.rows[1]).toEqual({
        ...table.rows[1],
        origin: 'ai',
        deleted: false,
        ocrLink: null,
      });
      expect(reopened.table.rows[1].source).toBeNull();
      expectPreservedAiState(before.ocr, after.ocr);
      expect(await persistedSnapshot(conversationId)).toEqual(after);
    });
  }

  it('source operations reject caller media metadata instead of importing it into a saved row', async () => {
    const { conversationId, messageId } = await seedSavedReviewData(page, headers);
    const read = await page.request.get(readUrl(conversationId, messageId), { headers });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const before = await persistedSnapshot(conversationId);
    const request = requestForRows(table);
    const response = await page.request.post(
      `/api/steel/conversations/${conversationId}/review/ocr_result/prepare`,
      {
        headers,
        data: {
          ...request,
          operations: [
            {
              type: 'update',
              rowId: table.rows[0].rowId,
              source: {
                fileId: 'review-alpha',
                pageNumber: 2,
                filename: 'FORGED.png',
                mediaType: 'image/png',
              },
            },
          ],
        },
      },
    );
    expect(response.status()).toBe(400);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('new human source codes reserve unavailable owner AI codes without locating their old rows', async () => {
    const markdown = ocr.replace('| A | REVIEW-P2', '| F7 | REVIEW-P2');
    const { conversationId, messageId } = await seedCurrent(markdown);
    await seedSelectorFiles(conversationId);
    await withMongo(async (db) => {
      await db.collection('steel_conversation_ocr_state').updateOne(
        { conversationId },
        {
          $set: {
            currentOcrResultMarkdown: markdown,
            sourceMappings: [
              { fileId: 'review-alpha', sourceCode: 'A', sourceFilename: 'alpha.pdf' },
              { fileId: 'review-expired-selector', sourceCode: 'F7', sourceFilename: 'alpha.pdf' },
            ],
          },
        },
      );
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    expect(table.rows[1].source).toBeNull();
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, undefined, [
        { rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 },
      ]),
    });
    expect(response.status()).toBe(200);
    const prepared = (await response.json()) as SteelReviewOperationPrepared;
    expect(prepared.rows[0].values['來源'].effective).toBe('F8');
    expect(prepared.rows[1]).toEqual({ ...table.rows[1], origin: 'ai', deleted: false });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(prepared),
    });
    expect(commit.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({
      table: { rows: [{}, { source: null, values: { 來源: { effective: 'F7' } } }] },
    });
    expectPreservedAiState(before.ocr, after.ocr);
  });

  it('source selector page counts come from actual authorized PDF/image bytes without writes', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    await seedSelectorFiles(conversationId);
    const before = await persistedSnapshot(conversationId);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result/sources`;
    for (const [fileId, pageCount] of [
      ['review-alpha', 3],
      ['review-beta', 2],
      ['review-gamma', 1],
    ] as const) {
      const response = await page.request.get(
        `${url}/${fileId}/page-count?${new URLSearchParams({ messageId })}`,
        { headers },
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ pageCount });
    }
    for (const fileId of [
      'review-foreign-selector',
      'review-expired-selector',
      'missing-selector-file',
    ]) {
      const response = await page.request.get(
        `${url}/${fileId}/page-count?${new URLSearchParams({ messageId })}`,
        { headers },
      );
      expect(response.status()).toBe(404);
    }
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('a source-only Save freezes trusted mapping and updates only the clicked message without staling its quote', async () => {
    const markdown = `SELECTOR-PREFIX\n\n${ocr}\n\nSELECTOR-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    await seedSelectorFiles(conversationId);
    const otherMessageId = randomUUID();
    await seedMessages(conversationId, [
      {
        messageId: otherMessageId,
        parentMessageId: messageId,
        text: ocr,
        content: [{ type: 'text', text: ocr }],
        isCreatedByUser: false,
        sender: 'Assistant',
      },
    ]);
    const runId = randomUUID();
    const orderHash = createHash('sha256').update(ocr).digest('hex');
    await withMongo(async (db) => {
      const owner = await db.collection('messages').findOne({ conversationId, messageId });
      if (!owner) throw new Error('Missing selector quotation owner');
      await db.collection('steel_quotation_states').insertOne({
        userId: String(owner.user),
        conversationId,
        currentOrder: { markdown: ocr, sha256: orderHash },
        currentSystemOrder: {
          runId,
          messageId: randomUUID(),
          markdown: 'ORDER-UNCHANGED',
          sha256: createHash('sha256').update('ORDER-UNCHANGED').digest('hex'),
          customerQuoteMarkdown: 'INTERNAL-QUOTE-UNCHANGED',
          updatedAt: new Date(),
        },
        nextSignalIndex: 2,
        pendingMessages: [],
        tickets: [
          {
            index: 1,
            token: randomUUID(),
            orderHash,
            customerMarkdown: 'CUSTOMER-UNCHANGED',
            customerIdentity: 'CUSTOMER-1',
            triggeringMessageId: messageId,
            selectionProvenance: { method: 'unique' },
            issuedAt: new Date(),
            acceptedRunId: runId,
            completionReceipt: {
              inputHash: 'FROZEN-INPUT',
              markdown: 'ORDER-UNCHANGED',
              ocrGeneration: 'review-proof-generation',
              ocrHash: orderHash,
            },
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, undefined, [
        { rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 },
      ]),
    });
    expect(response.status()).toBe(200);
    const prepared = (await response.json()) as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRowIds).toEqual([table.rows[0].rowId]);
    expect(prepared.caption.changedRows).toBe(1);
    expect(prepared.rows[0].source).toMatchObject({
      fileId: 'review-beta',
      pageNumber: 2,
      filename: 'beta.pdf',
    });
    expect(prepared.rows[0].values['來源'].effective).toMatch(/^F\d+$/u);
    expect(prepared.rows[0].values['頁碼']).toEqual({ baseline: '1', effective: '2' });
    for (const header of ['零件編號', '長度', '數量'])
      expect(prepared.rows[0].values[header]).toEqual(table.rows[0].values[header]);
    expect(prepared.rows[1]).toEqual({ ...table.rows[1], origin: 'ai', deleted: false });
    const mapping = {
      fileId: 'review-beta',
      sourceCode: prepared.rows[0].values['來源'].effective,
      sourceFilename: 'beta.pdf',
    };
    expect(prepared).toMatchObject({
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]),
    });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(prepared),
    });
    expect(commit.status()).toBe(200);
    const saved = await commit.json<SteelReviewSaveResponse>();
    expect(saved.savedSnapshot).toMatchObject({
      rows: prepared.rows,
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]),
    });
    const after = await persistedSnapshot(conversationId);
    const sourceCode = prepared.rows[0].values['來源'].effective;
    const clean = markdown.replace(
      '| A | REVIEW-P1 | 1000 | 2 | 1 |',
      `| ${sourceCode} | REVIEW-P1 | 1000 | 2 | 2 |`,
    );
    const clicked = after.messages.find((message) => message.messageId === messageId);
    expect(clicked?.text).toBe(clean);
    expect(clicked?.content).toEqual([{ type: 'text', text: clean }]);
    expect(after.messages.find((message) => message.messageId === otherMessageId)).toEqual(
      before.messages.find((message) => message.messageId === otherMessageId),
    );
    expect(after.quotations).toEqual(before.quotations);
    expectPreservedAiState(before.ocr, after.ocr);
    expect(after.reviews[0]).toMatchObject({
      rows: prepared.rows,
      sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]),
    });
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({
      table: {
        rows: prepared.rows,
        sourceMappings: expect.arrayContaining([expect.objectContaining(mapping)]),
      },
    });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  it('new source choices reject foreign expired missing multi-source and out-of-range pages before writes', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    await seedSelectorFiles(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
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
      const response = await page.request.post(
        `/api/steel/conversations/${conversationId}/review/ocr_result/prepare`,
        {
          headers,
          data: {
            ...requestForRows(table),
            operations: [{ type: 'update', rowId: table.rows[0].rowId, source: intent }],
          },
        },
      );
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  it('source commit reauthorizes selected file and rejects changed immutable receipt intent', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    await seedSelectorFiles(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const response = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, undefined, [
        { rowId: table.rows[0].rowId, fileId: 'review-beta', pageNumber: 2 },
      ]),
    });
    expect(response.status()).toBe(200);
    const prepared = (await response.json()) as SteelReviewOperationPrepared;
    await withMongo(async (db) => {
      await db
        .collection('files')
        .updateOne(
          { conversationId, file_id: 'review-beta' },
          { $set: { expiredAt: new Date(0) } },
        );
    });
    const before = await persistedSnapshot(conversationId);
    const refused = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(prepared),
    });
    expect(refused.status()).toBeGreaterThanOrEqual(400);
    expect(refused.status()).toBeLessThan(500);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    await withMongo(async (db) => {
      await db
        .collection('files')
        .updateOne({ conversationId, file_id: 'review-beta' }, { $unset: { expiredAt: '' } });
    });
    const committed = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(prepared),
    });
    expect(committed.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    const tampered = operationCommit(prepared);
    tampered.operations = [
      {
        type: 'update',
        rowId: table.rows[0].rowId,
        source: { fileId: 'review-beta', pageNumber: 1 },
      },
    ];
    const refusedReplay = await page.request.post(`${url}/commit`, { headers, data: tampered });
    expect(refusedReplay.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(saved);
  });

  it('an OCR Save marks only a quotation with proven OCR lineage as needing requote', async () => {
    for (const linked of [true, false]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      const runId = randomUUID();
      const orderHash = createHash('sha256')
        .update(linked ? ocr : 'UNRELATED-OCR')
        .digest('hex');
      const systemOrder =
        '## system_order\n| 型號 | 數量 | 總數 | 單價 |\n| --- | --- | --- | --- |\n| KEEP-ORDER | 2 | 4 | 100 |';
      await withMongo(async (db) => {
        const owner = await db.collection('messages').findOne({ conversationId, messageId });
        if (!owner) throw new Error('Missing scoped quotation owner');
        await db.collection('steel_quotation_states').insertOne({
          userId: String(owner.user),
          conversationId,
          // Preparing a new order must not make an unrelated older quote share its lineage.
          currentOrder: { markdown: ocr, sha256: createHash('sha256').update(ocr).digest('hex') },
          currentSystemOrder: {
            runId,
            messageId: randomUUID(),
            markdown: systemOrder,
            sha256: createHash('sha256').update(systemOrder).digest('hex'),
            customerQuoteMarkdown: 'INTERNAL-QUOTE-KEEP',
            updatedAt: new Date(),
          },
          nextSignalIndex: 2,
          pendingMessages: [],
          tickets: [
            {
              index: 1,
              token: randomUUID(),
              orderHash,
              customerMarkdown: 'CUSTOMER-KEEP',
              customerIdentity: 'CUSTOMER-1',
              triggeringMessageId: messageId,
              selectionProvenance: { method: 'unique' },
              issuedAt: new Date(),
              acceptedRunId: runId,
              completionReceipt: {
                inputHash: 'FROZEN-INPUT',
                markdown: systemOrder,
                ocrGeneration: linked ? 'review-proof-generation' : 'unrelated-generation',
                ocrHash: orderHash,
              },
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
      const before = await persistedSnapshot(conversationId);
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      const { table } = (await read.json()) as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '7';
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const prepare = await page.request.post(`${url}/prepare`, {
        headers,
        data: requestForRows(table, rows),
      });
      expect(prepare.status()).toBe(200);
      const save = await page.request.post(`${url}/commit`, {
        headers,
        data: operationCommit(await prepare.json()),
      });
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

  it('review commit rejects client AI and target projections outside the owned title', async () => {
    const markdown = `INTEGRITY-PREFIX\n\n${ocr}\n\nINTEGRITY-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    const read = await page.request.get(readUrl(conversationId, messageId), { headers });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const prepared = await prepareQuantity(page, headers, table, '9');
    const before = await persistedSnapshot(conversationId);
    for (const projection of [
      {
        target: {
          start: 0,
          end: markdown.length,
          sha256: createHash('sha256').update(markdown).digest('hex'),
        },
      },
      { targetText: markdown },
      { replacementText: 'CORRUPTED-PREFIX' },
      { cleanReplacementText: 'CORRUPTED-PREFIX' },
      { effectiveMarkdown: 'CORRUPTED-PREFIX' },
      { aiBaselineMarkdown: 'FORGED-AI-BASELINE' },
      { aiRawMarkdown: 'FORGED-AI-RAW' },
    ]) {
      const refused = await page.request.post(
        `/api/steel/conversations/${conversationId}/review/ocr_result/commit`,
        { headers, data: { ...operationCommit(prepared), ...projection } },
      );
      expect(refused.status()).toBe(400);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  it('prepare cannot overwrite a physical OCR table that drifted from its trusted state', async () => {
    for (const hasHumanSave of [false, true]) {
      const { conversationId, messageId } = await seedCurrent(ocr);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      let { table } = (await read.json()) as { table: SteelReviewTable };
      if (hasHumanSave) {
        const rows = structuredClone(table.rows);
        rows[0].values['數量'].effective = '7';
        const prepared = await page.request.post(`${url}/prepare`, {
          headers,
          data: requestForRows(table, rows),
        });
        expect(prepared.status()).toBe(200);
        const saved = await page.request.post(`${url}/commit`, {
          headers,
          data: operationCommit(await prepared.json()),
        });
        expect(saved.status()).toBe(200);
        const reread = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
          headers,
        });
        table = ((await reread.json()) as { table: SteelReviewTable }).table;
      }
      const drifted = ocr.replace(
        '| A | REVIEW-P1 | 1000 | 2 | 1 |',
        '| A | REVIEW-P1 | 1000 | 88 | 1 |',
      );
      await withMongo((db) =>
        db.collection('messages').updateOne(
          { conversationId, messageId },
          {
            $set: { text: drifted, content: [{ type: 'text', text: drifted }] },
          },
        ),
      );
      const before = await persistedSnapshot(conversationId);
      const invalidRead = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect([200, 404]).toContain(invalidRead.status());
      if (invalidRead.status() === 200) {
        expect((await invalidRead.json<{ table: SteelReviewTable | null }>()).table).toBeNull();
      }
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = '9';
      if (!hasHumanSave) {
        rows[0].values['數量'].baseline = '88';
        rows[0].rowId = createHash('sha256')
          .update(`${table.outputId}:0:${JSON.stringify(['A', 'REVIEW-P1', '1000', '88', '1'])}`)
          .digest('hex');
      }
      const prepare = await page.request.post(`${url}/prepare`, {
        headers,
        data: requestForRows(table, rows),
      });
      if (prepare.status() === 200) {
        const commit = await page.request.post(`${url}/commit`, {
          headers,
          data: operationCommit(await prepare.json()),
        });
        expect([400, 404, 409]).toContain(commit.status());
      }
      expect([400, 404, 409]).toContain(prepare.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });

  it('an OCR saved snapshot contains only its owned section when AI storage has other headings', async () => {
    const markdown = [
      'SECTION-KEEP-PREFIX',
      '## customer_data\n| Customer |\n| --- |\n| SECTION-KEEP-CUSTOMER |',
      ocr,
      '## Extra data\n| Name |\n| --- |\n| SECTION-KEEP-EXTRA |',
      'SECTION-KEEP-SUFFIX',
    ].join('\n\n');
    const { conversationId, messageId } = await seedCurrent(markdown);
    await withMongo((db) =>
      db.collection('steel_conversation_ocr_state').updateOne(
        { conversationId },
        {
          $set: { currentOcrResultMarkdown: markdown },
        },
      ),
    );
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    expect(table).not.toBeNull();
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(prepare.status()).toBe(200);
    const saved = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(await prepare.json()),
    });
    expect(saved.status()).toBe(200);
    const body = await saved.json<SteelReviewSaveResponse>();
    const expected = ocr.replace(
      '| A | REVIEW-P1 | 1000 | 2 | 1 |',
      '| A | REVIEW-P1 | 1000 | 7 | 1 |',
    );
    expect(body.savedSnapshot?.effectiveMarkdown).toBe(expected);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.effectiveMarkdown).toBe(expected);
    expect(after.reviews[0]?.humanMarkdown).toBe(expected);
    expect(after.messages[0]?.text).toBe(markdown.replace(ocr, expected));
    expectPreservedAiState(before.ocr, after.ocr);
  });

  it('an earlier committed operation returns its immutable saved snapshot after a later Save', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    async function save(quantity: string) {
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      expect(read.status()).toBe(200);
      const { table } = (await read.json()) as { table: SteelReviewTable };
      const rows = structuredClone(table.rows);
      rows[0].values['數量'].effective = quantity;
      const prepare = await page.request.post(`${url}/prepare`, {
        headers,
        data: requestForRows(table, rows),
      });
      expect(prepare.status()).toBe(200);
      const operation = (await prepare.json()) as SteelReviewOperationPrepared;
      const commit = await page.request.post(`${url}/commit`, {
        headers,
        data: operationCommit(operation),
      });
      expect(commit.status()).toBe(200);
      return { operation, saved: await commit.json<SteelReviewSaveResponse>() };
    }
    const first = await save('7');
    const receiptQuery = new URLSearchParams({
      messageId,
      title: first.operation.operationRequest.title,
      outputId: first.operation.operationRequest.outputId,
      operationId: first.operation.operationId,
      digest: first.operation.digest,
    });
    const receiptUrl = `${url}/receipt?${receiptQuery}`;
    const firstState = await persistedSnapshot(conversationId);
    const committedReceipt = await page.request.get(receiptUrl, { headers });
    expect(committedReceipt.status()).toBe(200);
    const receipt = await committedReceipt.json<CommittedReceipt>();
    expect(receipt.snapshot).toEqual(first.saved.savedSnapshot);
    expect(receipt).toMatchObject({
      status: 'committed',
      snapshot: {
        operationId: first.operation.operationId,
        revision: first.saved.revision,
        effectiveMarkdown: first.saved.effectiveMarkdown,
        messageSha256: first.saved.messageSha256,
      },
    });
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
    const retry = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(first.operation),
    });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual(first.saved);
    expect(await persistedSnapshot(conversationId)).toEqual(afterSecond);
    const historicalReceipt = await page.request.get(receiptUrl, { headers });
    expect(historicalReceipt.status()).toBe(200);
    expect(await historicalReceipt.json()).toEqual(receipt);
    expect(await persistedSnapshot(conversationId)).toEqual(afterSecond);
    const newMessageId = randomUUID();
    await seedMessages(conversationId, [
      {
        messageId: newMessageId,
        parentMessageId: messageId,
        text: ocr,
        content: [{ type: 'text', text: ocr }],
        isCreatedByUser: false,
        sender: 'Assistant',
      },
    ]);
    await withMongo(async (db) => {
      await db.collection('steel_conversation_ocr_state').updateOne(
        { conversationId },
        {
          $set: {
            currentOcrResultMessageId: newMessageId,
            currentOcrResultGenerationId: 'review-next-generation',
            currentOcrResultMarkdown: ocr,
            updatedAt: new Date(),
          },
        },
      );
    });
    const afterNewAI = await persistedSnapshot(conversationId);
    const oldOwnerReceipt = await page.request.get(receiptUrl, { headers });
    expect(oldOwnerReceipt.status()).toBe(200);
    expect(await oldOwnerReceipt.json()).toEqual(receipt);
    const oldOwner = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(oldOwner.status()).toBe(200);
    expect(await oldOwner.json()).toMatchObject({
      table: {
        readOnly: true,
        isLatest: false,
        aiUpdatedAt: firstState.ocr?.updatedAt.toISOString(),
      },
    });
    expect(await persistedSnapshot(conversationId)).toEqual(afterNewAI);
    const unknownOwner = new URLSearchParams(receiptQuery);
    unknownOwner.set('messageId', randomUUID());
    const missingMessage = await page.request.get(`${url}/receipt?${unknownOwner}`, { headers });
    expect(missingMessage.status()).toBe(404);
    const missingChat = await page.request.get(
      `/api/steel/conversations/${randomUUID()}/review/ocr_result/receipt?${receiptQuery}`,
      { headers },
    );
    expect(missingChat.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(afterNewAI);
    await withMongo(async (db) => {
      await db.collection('messages').updateOne(
        { conversationId, messageId },
        {
          $set: { expiredAt: new Date(Date.now() - 60_000) },
        },
      );
    });
    const expiredState = await persistedSnapshot(conversationId);
    const unavailableReceipt = await page.request.get(receiptUrl, { headers });
    expect(unavailableReceipt.status()).toBe(404);
    const unavailableReplay = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(first.operation),
    });
    expect(unavailableReplay.status()).toBe(404);
    expect(await persistedSnapshot(conversationId)).toEqual(expiredState);
  });

  it('representation-only OCR whitespace is a confirmed no-op with no DB or timestamp write', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(response.status()).toBe(200);
    const { table } = (await response.json()) as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = ' 2 ';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(prepare.status()).toBe(200);
    const prepared = (await prepare.json()) as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(0);
    const commit = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(prepared),
    });
    expect(commit.status()).toBe(200);
    expect(await commit.json()).toMatchObject({ changedRows: 0 });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({
      table: { rows: [{ values: { 數量: { baseline: '2', effective: '2' } } }, {}] },
    });
  });

  it('OCR Save canonicalizes cell whitespace before persisting and the saved table reopens', async () => {
    const markdown = `WHITESPACE-KEEP-PREFIX\n\n${ocr}\n\nWHITESPACE-KEEP-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(response.status()).toBe(200);
    const { table } = (await response.json()) as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = ' \r\n7\r\n ';
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(prepare.status()).toBe(200);
    const prepared = (await prepare.json()) as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(1);
    const commit = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(prepared),
    });
    expect(commit.status()).toBe(200);
    const receipt = await commit.json<SteelReviewSaveResponse>();
    expect(receipt.savedSnapshot?.rows[0].values['數量']).toEqual({
      baseline: '2',
      effective: '7',
    });
    const after = await persistedSnapshot(conversationId);
    const expected = markdown.replace(
      '| A | REVIEW-P1 | 1000 | 2 | 1 |',
      '| A | REVIEW-P1 | 1000 | 7 | 1 |',
    );
    expect(after.messages.find((message) => message.messageId === messageId)?.text).toBe(expected);
    expect(after.reviews[0]?.humanMarkdown).toBe(
      expected.slice(
        expected.indexOf('## ocr_result'),
        expected.indexOf('\n\nWHITESPACE-KEEP-SUFFIX'),
      ),
    );
    expectPreservedAiState(before.ocr, after.ocr);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({
      table: {
        rows: [{ rowId: rows[0].rowId, values: { 數量: { baseline: '2', effective: '7' } } }, {}],
      },
    });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  it('an OCR business cell containing a literal backslash and pipe roundtrips through Save and reopen', async () => {
    const markdown = `PIPE-KEEP-PREFIX\n\n${ocr}\n\nPIPE-KEEP-SUFFIX`;
    const { conversationId, messageId } = await seedCurrent(markdown);
    const before = await persistedSnapshot(conversationId);
    const response = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(response.status()).toBe(200);
    const { table } = (await response.json()) as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    const literal = 'REVIEW\\|PART';
    rows[0].values['零件編號'].effective = literal;
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepare = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(prepare.status()).toBe(200);
    const prepared = (await prepare.json()) as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(1);
    const commit = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(prepared),
    });
    expect(commit.status()).toBe(200);
    const receipt = await commit.json<SteelReviewSaveResponse>();
    expect(receipt.savedSnapshot?.rows[0].values['零件編號']).toEqual({
      baseline: 'REVIEW-P1',
      effective: literal,
    });
    const after = await persistedSnapshot(conversationId);
    const savedMessage = after.messages.find((message) => message.messageId === messageId);
    expect(savedMessage?.text.startsWith('PIPE-KEEP-PREFIX\n\n')).toBe(true);
    expect(savedMessage?.text.endsWith('\n\nPIPE-KEEP-SUFFIX')).toBe(true);
    expect(savedMessage?.content).toEqual([{ type: 'text', text: savedMessage?.text }]);
    expectPreservedAiState(before.ocr, after.ocr);
    const reopened = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({
      table: {
        rows: [
          {
            rowId: rows[0].rowId,
            values: {
              零件編號: { baseline: 'REVIEW-P1', effective: literal },
              數量: { effective: '2' },
            },
          },
          {},
        ],
      },
    });
    expect(await persistedSnapshot(conversationId)).toEqual(after);
  });

  it('changed-row operations prepare without writes and reject immutable fields and ambiguous positions', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const before = await persistedSnapshot(conversationId);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = {
      conversationId,
      messageId,
      kind: 'ocr_result',
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '7' }] },
      ],
    };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const invalidOperations = [
      {
        type: 'update',
        rowId: table.rows[0].rowId,
        changes: [{ header: '來源', value: 'FORGED' }],
      },
      {
        type: 'update',
        rowId: table.rows[0].rowId,
        baseline: 'FORGED',
        changes: [{ header: '數量', value: '7' }],
      },
      { type: 'update', rowId: table.rows[0].rowId, source: { fileId: null, pageNumber: 1 } },
      { type: 'update', rowId: table.rows[0].rowId, source: { fileId: 'review-alpha' } },
      { type: 'update', rowId: table.rows[0].rowId, source: null },
      {
        type: 'add',
        rowId: randomUUID(),
        position: { kind: 'end', rowId: table.rows[0].rowId },
        changes: [{ header: '零件編號', value: 'BAD-POSITION' }],
      },
      {
        type: 'add',
        rowId: randomUUID(),
        position: { kind: 'after' },
        changes: [{ header: '零件編號', value: 'BAD-POSITION' }],
      },
      {
        type: 'add',
        rowId: randomUUID(),
        position: { kind: 'after', rowId: null },
        changes: [{ header: '零件編號', value: 'BAD-POSITION' }],
      },
      { type: 'delete', rowId: table.rows[0].rowId, origin: 'manual' },
    ];
    for (const operation of invalidOperations) {
      const rejected = await page.request.post(`${url}/prepare`, {
        headers,
        data: { ...request, operations: [operation] },
      });
      expect([400, 409]).toContain(rejected.status());
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
    const mixed = await page.request.post(`${url}/prepare`, {
      headers,
      data: { ...request, rows: table.rows },
    });
    expect([400, 409]).toContain(mixed.status());
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    for (const source of [
      { fileId: null, pageNumber: null },
      { fileId: 'review-alpha', pageNumber: null },
    ]) {
      const sourcePrepared = await page.request.post(`${url}/prepare`, {
        headers,
        data: { ...request, operations: [{ type: 'update', rowId: table.rows[0].rowId, source }] },
      });
      expect(sourcePrepared.status()).toBe(200);
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
    const prepared = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepared.status()).toBe(200);
    const result = (await prepared.json()) as SteelReviewOperationPrepared;
    expect(result.operationRequest).toEqual(request);
    expect(result.caption).toMatchObject({ changedRows: 1, changedRowIds: [table.rows[0].rowId] });
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const commit = await page.request.post(`${url}/commit`, {
      headers,
      data: { ...result.operationRequest, operationId: result.operationId, digest: result.digest },
    });
    expect(commit.status()).toBe(200);
    const saved = await persistedSnapshot(conversationId);
    expect(saved.reviews[0]?.rows[1].values).toEqual(table.rows[1].values);
    expect(saved.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  it('changed-row requests reject unknown captured versions before and after a real Save', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const request: SteelReviewOperationPrepare = {
      conversationId,
      messageId,
      kind: 'ocr_result',
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '7' }] },
      ],
    };
    const rejectUnknown = async (value: string) => {
      const before = await persistedSnapshot(conversationId);
      const response = await page.request.post(`${url}/prepare`, {
        headers,
        data: {
          ...request,
          revision: 'unknown-never-existed',
          operations: [
            { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value }] },
          ],
        },
      });
      expect(response.status()).toBe(409);
      const failure = (await response.json()) as SteelReviewErrorResponse;
      expect(failure.code).toBe('REVIEW_CONFLICT');
      expect(failure).not.toHaveProperty('recovery');
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    };
    await rejectUnknown('7');
    const prepared = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepared.status()).toBe(200);
    const operation = (await prepared.json()) as SteelReviewOperationPrepared;
    const committed = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...operation.operationRequest,
        operationId: operation.operationId,
        digest: operation.digest,
      },
    });
    expect(committed.status()).toBe(200);
    await rejectUnknown('7');
    await rejectUnknown('9');
    const disjoint = await page.request.post(`${url}/prepare`, {
      headers,
      data: {
        ...request,
        operations: [
          { type: 'update', rowId: table.rows[1].rowId, changes: [{ header: '數量', value: '8' }] },
        ],
      },
    });
    expect(disjoint.status()).toBe(200);
    const next = (await disjoint.json()) as SteelReviewOperationPrepared;
    const merged = await page.request.post(`${url}/commit`, {
      headers,
      data: { ...next.operationRequest, operationId: next.operationId, digest: next.digest },
    });
    expect(merged.status()).toBe(200);
    const latest = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(latest.status()).toBe(200);
    const current = (await latest.json()) as { table: SteelReviewTable };
    expect(current.table.rows.map((row) => row.values['數量'].effective)).toEqual(['7', '8']);
    expect(current.table.rows.map((row) => row.values['數量'].baseline)).toEqual(['2', '3']);
  });

  it('changed-row receipts reject request tampering and replay their original snapshot after a later Save', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = {
      conversationId,
      messageId,
      kind: 'ocr_result',
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '7' }] },
      ],
    };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepared = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepared.status()).toBe(200);
    const first = (await prepared.json()) as SteelReviewOperationPrepared;
    const firstBody = {
      ...first.operationRequest,
      operationId: first.operationId,
      digest: first.digest,
    };
    const committed = await page.request.post(`${url}/commit`, { headers, data: firstBody });
    expect(committed.status()).toBe(200);
    const firstSaved = (await committed.json()) as SteelReviewSaveResponse;
    const secondRequest = {
      ...request,
      revision: firstSaved.revision,
      operations: [
        {
          type: 'update' as const,
          rowId: table.rows[1].rowId,
          changes: [{ header: '數量', value: '8' }],
        },
      ],
    };
    const preparedAgain = await page.request.post(`${url}/prepare`, {
      headers,
      data: secondRequest,
    });
    expect(preparedAgain.status()).toBe(200);
    const second = (await preparedAgain.json()) as SteelReviewOperationPrepared;
    const secondSave = await page.request.post(`${url}/commit`, {
      headers,
      data: { ...second.operationRequest, operationId: second.operationId, digest: second.digest },
    });
    expect(secondSave.status()).toBe(200);
    const beforeRetry = await persistedSnapshot(conversationId);
    const tampered = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...firstBody,
        operations: [
          { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '9' }] },
        ],
      },
    });
    expect([400, 409]).toContain(tampered.status());
    expect(await persistedSnapshot(conversationId)).toEqual(beforeRetry);
    const downgrade = await page.request.post(`${url}/commit`, { headers, data: first });
    expect([400, 409]).toContain(downgrade.status());
    expect(await persistedSnapshot(conversationId)).toEqual(beforeRetry);
    const stripped = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...first,
        operations: undefined,
        operationRequest: undefined,
        requestDigest: undefined,
      },
    });
    expect([400, 409]).toContain(stripped.status());
    expect(await persistedSnapshot(conversationId)).toEqual(beforeRetry);
    const replay = await page.request.post(`${url}/commit`, { headers, data: firstBody });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(firstSaved);
    expect(await persistedSnapshot(conversationId)).toEqual(beforeRetry);
    expect(beforeRetry.messages.find((message) => message.messageId === messageId)?.text).toBe(
      ocr
        .replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 7 | 1 |')
        .replace('| A | REVIEW-P2 | 2000 | 3 | 1 |', '| A | REVIEW-P2 | 2000 | 8 | 1 |'),
    );
    expect(beforeRetry.reviews[0]?.rows).toMatchObject([
      { values: { 數量: { baseline: '2', effective: '7' } } },
      { values: { 數量: { baseline: '3', effective: '8' } } },
    ]);
    expect(beforeRetry.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  it('ordered row updates retain tombstone values and count restore plus update once', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    expect(read.status()).toBe(200);
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const rowId = table.rows[0].rowId;
    const request: SteelReviewOperationPrepare = {
      conversationId,
      messageId,
      kind: 'ocr_result',
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        { type: 'update', rowId, changes: [{ header: '數量', value: '7' }] },
        { type: 'delete', rowId },
      ],
    };
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const prepared = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepared.status()).toBe(200);
    const first = (await prepared.json()) as SteelReviewOperationPrepared;
    expect(first.caption.changedRows).toBe(1);
    const committed = await page.request.post(`${url}/commit`, {
      headers,
      data: { ...first.operationRequest, operationId: first.operationId, digest: first.digest },
    });
    expect(committed.status()).toBe(200);
    const deleted = (await committed.json()) as SteelReviewSaveResponse;
    const afterDelete = await persistedSnapshot(conversationId);
    expect(afterDelete.reviews[0]?.rows[0]).toMatchObject({
      deleted: true,
      values: { 數量: { baseline: '2', effective: '7' } },
    });
    expect(
      afterDelete.messages.find((message) => message.messageId === messageId)?.text,
    ).not.toContain('REVIEW-P1');
    const restored = await page.request.post(`${url}/prepare`, {
      headers,
      data: {
        ...request,
        revision: deleted.revision,
        operations: [
          { type: 'restore', rowId },
          { type: 'update', rowId, changes: [{ header: '數量', value: '8' }] },
        ],
      },
    });
    expect(restored.status()).toBe(200);
    const second = (await restored.json()) as SteelReviewOperationPrepared;
    expect(second.caption.changedRows).toBe(1);
    const saved = await page.request.post(`${url}/commit`, {
      headers,
      data: { ...second.operationRequest, operationId: second.operationId, digest: second.digest },
    });
    expect(saved.status()).toBe(200);
    const afterRestore = await persistedSnapshot(conversationId);
    expect(afterRestore.reviews[0]?.rows[0]).toMatchObject({
      deleted: false,
      values: { 數量: { baseline: '2', effective: '8' } },
    });
    expect(afterRestore.messages.find((message) => message.messageId === messageId)?.text).toBe(
      ocr.replace('| A | REVIEW-P1 | 1000 | 2 | 1 |', '| A | REVIEW-P1 | 1000 | 8 | 1 |'),
    );
    expect(afterRestore.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  it('a bare update based on a tombstone cannot adopt another editor restore', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const initial = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const { table } = (await initial.json()) as { table: SteelReviewTable };
    const identity = {
      conversationId,
      messageId,
      kind: 'ocr_result' as const,
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
    };
    const deletion = await page.request.post(`${url}/prepare`, {
      headers,
      data: { ...identity, operations: [{ type: 'delete', rowId: table.rows[0].rowId }] },
    });
    expect(deletion.status()).toBe(200);
    const prepared = (await deletion.json()) as SteelReviewOperationPrepared;
    const deleted = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...prepared.operationRequest,
        operationId: prepared.operationId,
        digest: prepared.digest,
      },
    });
    expect(deleted.status()).toBe(200);
    const capturedDeleted = (await deleted.json()) as SteelReviewSaveResponse;
    const latest = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const current = ((await latest.json()) as { table: SteelReviewTable }).table;
    const rows = structuredClone(current.rows);
    rows[0].deleted = false;
    const foreignRestore = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(current, rows),
    });
    expect(foreignRestore.status()).toBe(200);
    const restored = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(await foreignRestore.json()),
    });
    expect(restored.status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const base = { ...identity, revision: capturedDeleted.revision };
    const update = {
      type: 'update' as const,
      rowId: table.rows[0].rowId,
      changes: [{ header: '數量', value: '8' }],
    };
    const rejected = await page.request.post(`${url}/prepare`, {
      headers,
      data: { ...base, operations: [update] },
    });
    expect(rejected.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const explicit = await page.request.post(`${url}/prepare`, {
      headers,
      data: { ...base, operations: [{ type: 'restore', rowId: table.rows[0].rowId }, update] },
    });
    expect(explicit.status()).toBe(200);
    const result = (await explicit.json()) as SteelReviewOperationPrepared;
    const saved = await page.request.post(`${url}/commit`, {
      headers,
      data: { ...result.operationRequest, operationId: result.operationId, digest: result.digest },
    });
    expect(saved.status()).toBe(200);
    expect((await persistedSnapshot(conversationId)).reviews[0]?.rows[0]).toMatchObject({
      deleted: false,
      values: { 數量: { baseline: '2', effective: '8' } },
    });
  });

  for (const position of ['after', 'start', 'end'] as const) {
    it(`concurrent operation additions at the same anchor retain both identities and unique ordinals: ${position}`, async () => {
      const { conversationId, messageId } = await seedCurrent(ocr);
      const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
      const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      const { table } = (await read.json()) as { table: SteelReviewTable };
      const identity = {
        conversationId,
        messageId,
        kind: 'ocr_result' as const,
        title: table.title,
        outputId: table.outputId,
        revision: table.revision,
      };
      const rowIds = [randomUUID(), randomUUID()];
      const pending: SteelReviewOperationPrepared[] = [];
      for (const rowId of rowIds) {
        const response = await page.request.post(`${url}/prepare`, {
          headers,
          data: {
            ...identity,
            operations: [
              {
                type: 'add',
                rowId,
                position:
                  position === 'after'
                    ? { kind: position, rowId: table.rows[1].rowId }
                    : { kind: position },
                changes: [
                  { header: '零件編號', value: 'CONCURRENT-ADD' },
                  { header: '數量', value: '1' },
                ],
              },
            ],
          },
        });
        expect(response.status()).toBe(200);
        pending.push((await response.json()) as SteelReviewOperationPrepared);
      }
      const bodies = pending.map((prepared) => ({
        ...prepared.operationRequest,
        operationId: prepared.operationId,
        digest: prepared.digest,
      }));
      const first = await page.request.post(`${url}/commit`, { headers, data: bodies[0] });
      expect(first.status()).toBe(200);
      const firstReceipt = await first.json();
      const second = await page.request.post(`${url}/commit`, { headers, data: bodies[1] });
      expect(second.status()).toBe(200);
      const merged = await persistedSnapshot(conversationId);
      const added = merged.reviews[0]?.rows.filter(
        (row: SteelReviewTable['rows'][number]) => row.origin === 'manual',
      );
      expect(added.map((row: SteelReviewTable['rows'][number]) => row.rowId)).toEqual(rowIds);
      expect(added.map((row: SteelReviewTable['rows'][number]) => row.insertion?.ordinal)).toEqual([
        0, 1,
      ]);
      const replay = await page.request.post(`${url}/commit`, { headers, data: bodies[0] });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual(firstReceipt);
      expect(await persistedSnapshot(conversationId)).toEqual(merged);
      expect(merged.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
    });
  }

  it('an operation delete conflicts with a changed row and a disjoint update preserves foreign deletion', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const identity = {
      conversationId,
      messageId,
      kind: 'ocr_result' as const,
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
    };
    const prepare = await page.request.post(`${url}/prepare`, {
      headers,
      data: { ...identity, operations: [{ type: 'delete', rowId: table.rows[0].rowId }] },
    });
    expect(prepare.status()).toBe(200);
    const pending = (await prepare.json()) as SteelReviewOperationPrepared;
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[1].deleted = true;
    const foreign = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(foreign.status()).toBe(200);
    const foreignSave = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(await foreign.json()),
    });
    expect(foreignSave.status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const rejected = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...pending.operationRequest,
        operationId: pending.operationId,
        digest: pending.digest,
      },
    });
    expect(rejected.status()).toBe(409);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const disjoint = await page.request.post(`${url}/prepare`, {
      headers,
      data: {
        ...identity,
        operations: [
          {
            type: 'update',
            rowId: table.rows[0].rowId,
            changes: [{ header: '長度', value: '1234' }],
          },
        ],
      },
    });
    expect(disjoint.status()).toBe(200);
    const result = (await disjoint.json()) as SteelReviewOperationPrepared;
    const saved = await page.request.post(`${url}/commit`, {
      headers,
      data: { ...result.operationRequest, operationId: result.operationId, digest: result.digest },
    });
    expect(saved.status()).toBe(200);
    const merged = await persistedSnapshot(conversationId);
    expect(merged.reviews[0]?.rows).toMatchObject([
      { deleted: false, values: { 數量: { effective: '7' }, 長度: { effective: '1234' } } },
      { deleted: true },
    ]);
    expect(merged.messages.find((message) => message.messageId === messageId)?.text).not.toContain(
      'REVIEW-P2',
    );
    expect(merged.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  it('commit conflicts preserve authoritative recovery after another Save between prepare and commit', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = {
      conversationId,
      messageId,
      kind: 'ocr_result',
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '9' }] },
      ],
    };
    const preview = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(preview.status()).toBe(200);
    const prepared = (await preview.json()) as SteelReviewOperationPrepared;
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[1].values['長度'].effective = '2345';
    const foreign = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(foreign.status()).toBe(200);
    expect(
      (
        await page.request.post(`${url}/commit`, {
          headers,
          data: operationCommit(await foreign.json()),
        })
      ).status(),
    ).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const latest = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const current = (await latest.json()) as { table: SteelReviewTable };
    const conflict = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...prepared.operationRequest,
        operationId: prepared.operationId,
        digest: prepared.digest,
      },
    });
    expect(conflict.status()).toBe(409);
    const body = (await conflict.json()) as SteelReviewErrorResponse;
    expect(body.code).toBe('REVIEW_CONFLICT');
    expect(body.recovery?.table).toMatchObject({
      conversationId,
      messageId,
      title: table.title,
      outputId: table.outputId,
      revision: current.table.revision,
      isLatest: true,
      readOnly: false,
      headers: current.table.headers,
      rows: current.table.rows,
      effectiveMarkdown: current.table.effectiveMarkdown,
      aiRawMarkdown: current.table.aiRawMarkdown,
      aiBaselineMarkdown: current.table.aiBaselineMarkdown,
    });
    expect(body.recovery?.table.title).toBe(current.table.title);
    expect(body.recovery?.table).not.toHaveProperty('partIndex');
    expect(body.recovery?.conflicts).toEqual([
      {
        kind: 'field',
        rowId: table.rows[0].rowId,
        header: '數量',
        expected: '2',
        current: '7',
        requested: '9',
      },
    ]);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('operation conflicts return all unequal fields and one authoritative latest Markdown without writes', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[0].values['長度'].effective = '1234';
    rows[1].values['數量'].effective = '8';
    const foreign = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(foreign.status()).toBe(200);
    const committed = await page.request.post(`${url}/commit`, {
      headers,
      data: operationCommit(await foreign.json()),
    });
    expect(committed.status()).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const current = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const latest = (await current.json()) as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = {
      conversationId,
      messageId,
      kind: 'ocr_result',
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        {
          type: 'update',
          rowId: table.rows[0].rowId,
          changes: [
            { header: '數量', value: '9' },
            { header: '長度', value: '1234' },
          ],
        },
        { type: 'update', rowId: table.rows[1].rowId, changes: [{ header: '數量', value: '10' }] },
      ],
    };
    const conflict = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(conflict.status()).toBe(409);
    const body = await conflict.json<RecoveryResponse>();
    expect(body.code).toBe('REVIEW_CONFLICT');
    expect(body.recovery.table).toMatchObject({
      conversationId,
      messageId,
      outputId: table.outputId,
      revision: latest.table.revision,
      effectiveMarkdown: latest.table.effectiveMarkdown,
      isLatest: true,
      readOnly: false,
    });
    expect(body.recovery.table.rows).toEqual(latest.table.rows);
    expect(body.recovery.conflicts).toHaveLength(2);
    expect(body.recovery.conflicts).toEqual(
      expect.arrayContaining([
        {
          kind: 'field',
          rowId: table.rows[0].rowId,
          header: '數量',
          expected: '2',
          current: '7',
          requested: '9',
        },
        {
          kind: 'field',
          rowId: table.rows[1].rowId,
          header: '數量',
          expected: '3',
          current: '8',
          requested: '10',
        },
      ]),
    );
    expect(
      body.recovery.conflicts.some((field) => 'header' in field && field.header === '長度'),
    ).toBe(false);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const retry = await page.request.post(`${url}/prepare`, {
      headers,
      data: { ...request, revision: body.recovery.table.revision },
    });
    expect(retry.status()).toBe(200);
    const prepared = (await retry.json()) as SteelReviewOperationPrepared;
    const saved = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...prepared.operationRequest,
        operationId: prepared.operationId,
        digest: prepared.digest,
      },
    });
    expect(saved.status()).toBe(200);
    const after = await persistedSnapshot(conversationId);
    expect(after.reviews[0]?.rows).toMatchObject([
      {
        values: {
          數量: { baseline: '2', effective: '9' },
          長度: { baseline: '1000', effective: '1234' },
        },
      },
      { values: { 數量: { baseline: '3', effective: '10' } } },
    ]);
    expect(after.reviews[0]?.aiBaselineMarkdown).toBe(ocr);
  });

  it('all requested values already equal latest automatically remove conflict without DB writes', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const rows = structuredClone(table.rows);
    rows[0].values['數量'].effective = '7';
    rows[1].values['數量'].effective = '8';
    const foreign = await page.request.post(`${url}/prepare`, {
      headers,
      data: requestForRows(table, rows),
    });
    expect(foreign.status()).toBe(200);
    expect(
      (
        await page.request.post(`${url}/commit`, {
          headers,
          data: operationCommit(await foreign.json()),
        })
      ).status(),
    ).toBe(200);
    const before = await persistedSnapshot(conversationId);
    const request: SteelReviewOperationPrepare = {
      conversationId,
      messageId,
      kind: 'ocr_result',
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '7' }] },
        { type: 'update', rowId: table.rows[1].rowId, changes: [{ header: '數量', value: '8' }] },
      ],
    };
    const prepare = await page.request.post(`${url}/prepare`, { headers, data: request });
    expect(prepare.status()).toBe(200);
    const prepared = (await prepare.json()) as SteelReviewOperationPrepared;
    expect(prepared.caption.changedRows).toBe(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
    const saved = await page.request.post(`${url}/commit`, {
      headers,
      data: {
        ...prepared.operationRequest,
        operationId: prepared.operationId,
        digest: prepared.digest,
      },
    });
    expect(saved.status()).toBe(200);
    expect((await saved.json<SteelReviewSaveResponse>()).changedRows).toBe(0);
    expect(await persistedSnapshot(conversationId)).toEqual(before);
  });

  it('a Save racing after conflict recovery returns a newer conflict instead of overwriting', async () => {
    const { conversationId, messageId } = await seedCurrent(ocr);
    const url = `/api/steel/conversations/${conversationId}/review/ocr_result`;
    const read = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
      headers,
    });
    const { table } = (await read.json()) as { table: SteelReviewTable };
    const request: SteelReviewOperationPrepare = {
      conversationId,
      messageId,
      kind: 'ocr_result',
      title: table.title,
      outputId: table.outputId,
      revision: table.revision,
      operations: [
        { type: 'update', rowId: table.rows[0].rowId, changes: [{ header: '數量', value: '9' }] },
      ],
    };
    let expectedRevision = table.revision;
    for (const value of ['7', '8']) {
      const current = await page.request.get(readUrl(conversationId, messageId, 'ocr_result'), {
        headers,
      });
      const latest = (await current.json()) as { table: SteelReviewTable };
      const rows = structuredClone(latest.table.rows);
      rows[0].values['數量'].effective = value;
      const foreign = await page.request.post(`${url}/prepare`, {
        headers,
        data: requestForRows(latest.table, rows),
      });
      expect(foreign.status()).toBe(200);
      expect(
        (
          await page.request.post(`${url}/commit`, {
            headers,
            data: operationCommit(await foreign.json()),
          })
        ).status(),
      ).toBe(200);
      const before = await persistedSnapshot(conversationId);
      const failed = await page.request.post(`${url}/prepare`, {
        headers,
        data: { ...request, revision: expectedRevision },
      });
      expect(failed.status()).toBe(409);
      const body = await failed.json<RecoveryResponse>();
      expect(body.recovery.conflicts).toEqual([
        {
          kind: 'field',
          rowId: table.rows[0].rowId,
          header: '數量',
          expected: value === '7' ? '2' : '7',
          current: value,
          requested: '9',
        },
      ]);
      expect(body.recovery.table.revision).not.toBe(expectedRevision);
      expect(body.recovery.table.rows[0].values['數量'].effective).toBe(value);
      expectedRevision = body.recovery.table.revision;
      expect(await persistedSnapshot(conversationId)).toEqual(before);
    }
  });
});
