import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

import type {
  KeepaliveReadRecord,
  KeepaliveStore,
  PostgresQueryable,
} from './keepalive.mts';
import {
  KeepaliveRunError,
  createKeepaliveRecords,
  createMongoStore,
  createPostgresStore,
  createRunId,
  getMongoDatabaseName,
  runTarget,
  runTargets,
  verifyKeepaliveRecords,
} from './keepalive.mts';

class PostgresDouble implements PostgresQueryable {
  readonly rows: KeepaliveReadRecord[] = [];
  readonly queries: string[] = [];
  ended = false;

  async query(
    text: string,
    values: unknown[] = [],
  ): Promise<{
    rows: Array<Partial<KeepaliveReadRecord> & { count?: number }>;
    rowCount: number;
  }> {
    this.queries.push(text);
    if (text.startsWith('INSERT')) {
      const [runIds, sequences, createdAt, randomData] = values as [
        string[],
        number[],
        Date[],
        string[],
      ];
      this.rows.push(
        ...sequences.map((sequence, index) => ({
          run_id: runIds[index]!,
          sequence,
          created_at: createdAt[index]!,
          random_data: randomData[index]!,
        })),
      );
      return { rows: [], rowCount: this.rows.length };
    }
    if (text.startsWith('SELECT COUNT')) {
      const runId = values[0] as string;
      return {
        rows: [{ count: this.rows.filter((row) => row.run_id === runId).length }],
        rowCount: 1,
      };
    }
    if (text.startsWith('SELECT')) {
      const runId = values[0] as string;
      return {
        rows: this.rows.filter((row) => row.run_id === runId),
        rowCount: this.rows.length,
      };
    }
    if (text.startsWith('DELETE')) {
      const runId = values[0] as string;
      const before = this.rows.length;
      this.rows.splice(0, this.rows.length, ...this.rows.filter((row) => row.run_id !== runId));
      return { rows: [], rowCount: before - this.rows.length };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

test('generates and validates exactly five records', () => {
  const now = new Date('2026-07-22T01:02:03.000Z');
  const records = createKeepaliveRecords('run-1', now);
  assert.equal(records.length, 5);
  assert.deepEqual(
    records.map((record) => record.sequence),
    [1, 2, 3, 4, 5],
  );
  assert.equal(new Set(records.map((record) => record.random_data)).size, 5);
  assert(records.every((record) => /^[a-f0-9]{64}$/.test(record.random_data)));
  verifyKeepaliveRecords(records, [...records].reverse());
  assert.throws(() => verifyKeepaliveRecords(records, records.slice(0, 4)), /exactly 5/);
});

test('uses GitHub run id and attempt, or a local UUID', () => {
  assert.equal(createRunId({ GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' }), 'github:123:2');
  assert.equal(createRunId({ GITHUB_RUN_ID: '123' }), 'github:123:1');
  assert.equal(createRunId({}, () => 'uuid'), 'local:uuid');
});

test('requires an explicit Mongo database path', () => {
  assert.equal(getMongoDatabaseName('mongodb://localhost/steel_dev'), 'steel_dev');
  assert.throws(
    () => getMongoDatabaseName('mongodb://localhost/'),
    /explicit database path/,
  );
  assert.throws(
    () => getMongoDatabaseName('mongodb+srv://localhost'),
    /explicit database path/,
  );
});

test('runs real Mongo CRUD and leaves no records behind', async () => {
  const server = await MongoMemoryServer.create({ instance: { dbName: 'keepalive_test' } });
  const uri = server.getUri('keepalive_test');
  const target = {
    name: 'mongo-test',
    createStore: () => createMongoStore(uri),
  };
  const client = new MongoClient(uri);
  try {
    await runTarget(target, 'mongo-run');
    await client.connect();
    assert.equal(await client.db('keepalive_test').collection('keepalive').countDocuments(), 0);
  } finally {
    await client.close();
    await server.stop();
  }
});

test('runs Postgres CRUD through a narrow queryable double', async () => {
  const database = new PostgresDouble();
  const store = createPostgresStore('postgres://test', () => database);
  await runTarget({ name: 'postgres-test', createStore: async () => store }, 'postgres-run');
  assert.equal(database.rows.length, 0);
  assert.equal(database.ended, true);
  assert(database.queries.some((query) => query.includes('steel.keepalive')));
});

test('attempts every target and preserves operation and cleanup failures', async () => {
  let attempted = 0;
  let cleaned = 0;
  const passingStore: KeepaliveStore = {
    async insert() {},
    async read() {
      return [];
    },
    async delete() {
      cleaned += 1;
      return 0;
    },
    async count() {
      return 0;
    },
    async close() {},
  };

  await assert.rejects(
    runTargets(
      [
        {
          name: 'failing',
          createStore: async () => {
            attempted += 1;
            throw new Error('operation failure');
          },
        },
        {
          name: 'passing',
          createStore: async () => {
            attempted += 1;
            return passingStore;
          },
        },
      ],
      'run-all',
      {},
    ),
    (error: Error) => error instanceof KeepaliveRunError,
  );
  assert.equal(attempted, 2);
  assert.equal(cleaned, 1);

  const cleanupFailureStore: KeepaliveStore = {
    async insert() {
      throw new Error('operation failure');
    },
    async read() {
      return [];
    },
    async delete() {
      throw new Error('cleanup failure');
    },
    async count() {
      return 1;
    },
    async close() {},
  };
  await assert.rejects(
    runTarget({ name: 'cleanup-failure', createStore: async () => cleanupFailureStore }, 'run'),
    (error: Error) =>
      error instanceof Error &&
      'operationError' in error &&
      (error as { operationError: Error }).operationError.message === 'operation failure' &&
      Boolean((error as { cleanupError?: Error }).cleanupError),
  );

  const shortDeleteStore: KeepaliveStore = {
    async insert() {},
    async read() {
      throw new Error('read failure');
    },
    async delete() {
      return 4;
    },
    async count() {
      return 0;
    },
    async close() {},
  };
  await assert.rejects(
    runTarget({ name: 'short-delete', createStore: async () => shortDeleteStore }, 'run'),
    (error: Error) =>
      error instanceof Error &&
      'operationError' in error &&
      (error as { operationError: Error }).operationError.message === 'read failure' &&
      Boolean((error as { cleanupError?: Error }).cleanupError),
  );
});
