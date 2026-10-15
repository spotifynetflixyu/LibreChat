import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

import type { KeepaliveStore, PostgresQueryable } from './keepalive.mts';
import {
  createMongoStore,
  createPostgresStore,
  createRunId,
  getMongoDatabaseName,
  runTarget,
  runTargets,
} from './keepalive.mts';

class PostgresDouble implements PostgresQueryable {
  readonly runIds: string[] = [];
  ended = false;

  async query(text: string, values: unknown[] = []): Promise<{ rowCount: number }> {
    const runId = values[0] as string;
    if (text.startsWith('INSERT')) {
      this.runIds.push(runId);
      return { rowCount: 1 };
    }
    if (text.startsWith('SELECT')) {
      return { rowCount: this.runIds.filter((id) => id === runId).length };
    }
    if (text.startsWith('DELETE')) {
      const before = this.runIds.length;
      this.runIds.splice(0, before, ...this.runIds.filter((id) => id !== runId));
      return { rowCount: before - this.runIds.length };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

test('uses GitHub run id and attempt, or a local UUID', () => {
  assert.equal(createRunId({ GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '3' }), 'github:42:3');
  assert.equal(createRunId({ GITHUB_RUN_ID: '42' }), 'github:42:1');
  assert.match(createRunId({}), /^local:[0-9a-f-]{36}$/);
});

test('requires an explicit Mongo database path', () => {
  assert.equal(getMongoDatabaseName('mongodb://localhost:27017/steel'), 'steel');
  assert.throws(() => getMongoDatabaseName('mongodb://localhost:27017'), /database path/);
  assert.throws(() => getMongoDatabaseName('postgres://localhost/steel'), /mongodb/);
  assert.throws(() => getMongoDatabaseName('not a uri'), /mongodb/);
});

test('writes, reads back and deletes a real Mongo record', async () => {
  const server = await MongoMemoryServer.create();
  const uri = `${server.getUri()}keepalive_test`;
  try {
    await runTarget({ name: 'mongo', createStore: () => createMongoStore(uri) }, 'run-1');
    const client = await MongoClient.connect(uri);
    try {
      assert.equal(await client.db().collection('keepalive').countDocuments(), 0);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('writes, reads back and deletes a Postgres record', async () => {
  const pool = new PostgresDouble();
  await runTarget({ name: 'pg', createStore: async () => createPostgresStore(pool) }, 'run-1');
  assert.deepEqual(pool.runIds, []);
  assert.equal(pool.ended, true);
});

test('deletes and closes even when the record cannot be read back', async () => {
  const calls: string[] = [];
  const store: KeepaliveStore = {
    insert: async () => void calls.push('insert'),
    exists: async () => (calls.push('exists'), false),
    delete: async () => void calls.push('delete'),
    close: async () => void calls.push('close'),
  };
  await assert.rejects(
    runTarget({ name: 'broken', createStore: async () => store }, 'run-1'),
    /not readable/,
  );
  assert.deepEqual(calls, ['insert', 'exists', 'delete', 'close']);
});

test('attempts every target and reports failures without database URLs', async () => {
  const pool = new PostgresDouble();
  const errors: string[] = [];
  const info: string[] = [];
  await assert.rejects(
    runTargets(
      [
        {
          name: 'mongo-prod',
          createStore: async () => {
            throw new Error('connect failed for mongodb+srv://user:secret@cluster/db');
          },
        },
        { name: 'supabase-dev', createStore: async () => createPostgresStore(pool) },
      ],
      'run-1',
      {
        info: (message: string) => info.push(message),
        error: (message: string) => errors.push(message),
      },
    ),
    /failed for 1 target/,
  );
  assert.deepEqual(info, ['Database keepalive passed: supabase-dev']);
  assert.match(errors[0] ?? '', /mongo-prod: Error: connect failed for <redacted-database-url>/);
  assert.doesNotMatch(errors[0] ?? '', /secret/);
});
