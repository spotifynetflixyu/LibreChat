import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { MongoClient } from 'mongodb';
import { Pool } from 'pg';

import type { Collection } from 'mongodb';

const KEEPALIVE_RECORD_COUNT = 5;
const MONGO_COLLECTION = 'keepalive';
const POSTGRES_TABLE = 'steel.keepalive';

export interface KeepaliveRecord {
  run_id: string;
  sequence: number;
  created_at: Date;
  random_data: string;
}

export interface KeepaliveReadRecord {
  run_id: string;
  sequence: number;
  created_at: Date | string;
  random_data: string;
}

export interface KeepaliveStore {
  insert(records: readonly KeepaliveRecord[]): Promise<void>;
  read(runId: string): Promise<readonly KeepaliveReadRecord[]>;
  delete(runId: string): Promise<number>;
  count(runId: string): Promise<number>;
  close(): Promise<void>;
}

export interface KeepaliveTarget {
  name: string;
  createStore: () => Promise<KeepaliveStore>;
}

interface KeepaliveLogger {
  info?: (message: string) => void;
  error?: (message: string) => void;
}

interface MongoKeepaliveDocument {
  run_id: string;
  sequence: number;
  created_at: Date;
  random_data: string;
}

interface PostgresQueryRow {
  run_id?: string;
  sequence?: number;
  created_at?: Date | string;
  random_data?: string;
  count?: number | string;
}

interface PostgresQueryResult {
  rows: PostgresQueryRow[];
  rowCount: number | null;
}

interface RunEnvironment {
  [key: string]: string | undefined;
  GITHUB_RUN_ID?: string;
  GITHUB_RUN_ATTEMPT?: string;
}

export interface PostgresQueryable {
  query: (text: string, values?: unknown[]) => Promise<PostgresQueryResult>;
  end: () => Promise<void>;
}

export class KeepaliveTargetError extends Error {
  readonly targetName: string;
  readonly operationError: Error;
  readonly cleanupError?: Error;

  constructor(targetName: string, operationError: Error, cleanupError?: Error) {
    super(
      cleanupError
        ? `Database keepalive target ${targetName} failed and cleanup also failed`
        : `Database keepalive target ${targetName} failed`,
      { cause: operationError },
    );
    this.name = 'KeepaliveTargetError';
    this.targetName = targetName;
    this.operationError = operationError;
    this.cleanupError = cleanupError;
  }
}

export class KeepaliveRunError extends Error {
  readonly failures: readonly KeepaliveTargetError[];

  constructor(failures: readonly KeepaliveTargetError[]) {
    super(`Database keepalive failed for ${failures.length} target(s)`);
    this.name = 'KeepaliveRunError';
    this.failures = failures;
  }
}

function asError(value: Error | string | object): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function createRunId(
  env: RunEnvironment = process.env,
  createId: () => string = randomUUID,
): string {
  const runId = env.GITHUB_RUN_ID?.trim();
  if (runId) {
    return `github:${runId}:${env.GITHUB_RUN_ATTEMPT?.trim() || '1'}`;
  }
  return `local:${createId()}`;
}

export function createKeepaliveRecords(
  runId: string,
  now: Date = new Date(),
  randomData: () => string = () => randomBytes(32).toString('hex'),
): readonly KeepaliveRecord[] {
  return Array.from({ length: KEEPALIVE_RECORD_COUNT }, (_, index) => ({
    run_id: runId,
    sequence: index + 1,
    created_at: new Date(now.getTime()),
    random_data: randomData(),
  }));
}

function dateValue(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Keepalive read returned an invalid created_at value');
  }
  return date;
}

export function verifyKeepaliveRecords(
  expected: readonly KeepaliveRecord[],
  actual: readonly KeepaliveReadRecord[],
): void {
  if (expected.length !== KEEPALIVE_RECORD_COUNT || actual.length !== KEEPALIVE_RECORD_COUNT) {
    throw new Error(`Keepalive expected exactly ${KEEPALIVE_RECORD_COUNT} records`);
  }

  const expectedBySequence = new Map(expected.map((record) => [record.sequence, record]));
  const seenSequences = new Set<number>();
  for (const record of actual) {
    const expectedRecord = expectedBySequence.get(record.sequence);
    if (!expectedRecord || seenSequences.has(record.sequence)) {
      throw new Error('Keepalive read returned unexpected or duplicate sequences');
    }
    seenSequences.add(record.sequence);
    if (
      record.run_id !== expectedRecord.run_id ||
      record.random_data !== expectedRecord.random_data ||
      dateValue(record.created_at).getTime() !== expectedRecord.created_at.getTime()
    ) {
      throw new Error(`Keepalive record ${record.sequence} did not match its inserted value`);
    }
  }
}

export function getMongoDatabaseName(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('Mongo URI is invalid');
  }

  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new Error('Mongo URI must use mongodb or mongodb+srv');
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName) {
    throw new Error('Mongo URI must include an explicit database path');
  }
  return databaseName;
}

export async function createMongoStore(
  uri: string,
  createClient: (connectionString: string) => MongoClient = (connectionString) =>
    new MongoClient(connectionString, {
      connectTimeoutMS: 15_000,
      serverSelectionTimeoutMS: 15_000,
      socketTimeoutMS: 30_000,
    }),
): Promise<KeepaliveStore> {
  const databaseName = getMongoDatabaseName(uri);
  const client = createClient(uri);
  try {
    await client.connect();
    const collection: Collection<MongoKeepaliveDocument> = client
      .db(databaseName)
      .collection<MongoKeepaliveDocument>(MONGO_COLLECTION);
    return {
      async insert(records) {
        await collection.insertMany(records.map((record) => ({ ...record })), { ordered: true });
      },
      async read(runId) {
        const records = await collection.find({ run_id: runId }).sort({ sequence: 1 }).toArray();
        return records.map(({ run_id, sequence, created_at, random_data }) => ({
          run_id,
          sequence,
          created_at,
          random_data,
        }));
      },
      async delete(runId) {
        const result = await collection.deleteMany({ run_id: runId });
        return result.deletedCount;
      },
      count(runId) {
        return collection.countDocuments({ run_id: runId });
      },
      close() {
        return client.close();
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

export function createPostgresStore(
  connectionString: string,
  createPool: (url: string) => PostgresQueryable = (url) =>
    new Pool({
      connectionString: url,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
      max: 1,
    }),
): KeepaliveStore {
  const pool = createPool(connectionString);
  return {
    async insert(records) {
      await pool.query(
        `INSERT INTO ${POSTGRES_TABLE} (run_id, sequence, created_at, random_data)
         SELECT * FROM UNNEST($1::text[], $2::smallint[], $3::timestamptz[], $4::text[])`,
        [
          records.map((record) => record.run_id),
          records.map((record) => record.sequence),
          records.map((record) => record.created_at),
          records.map((record) => record.random_data),
        ],
      );
    },
    async read(runId) {
      const result = await pool.query(
        `SELECT run_id, sequence, created_at, random_data
         FROM ${POSTGRES_TABLE}
         WHERE run_id = $1
         ORDER BY sequence`,
        [runId],
      );
      return result.rows.map((row) => {
        if (
          typeof row.run_id !== 'string' ||
          typeof row.sequence !== 'number' ||
          row.created_at === undefined ||
          typeof row.random_data !== 'string'
        ) {
          throw new Error('Keepalive read returned an invalid Postgres row');
        }
        return {
          run_id: row.run_id,
          sequence: row.sequence,
          created_at: row.created_at,
          random_data: row.random_data,
        };
      });
    },
    async delete(runId) {
      const result = await pool.query(`DELETE FROM ${POSTGRES_TABLE} WHERE run_id = $1`, [runId]);
      return result.rowCount ?? 0;
    },
    async count(runId) {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${POSTGRES_TABLE} WHERE run_id = $1`,
        [runId],
      );
      const count = result.rows[0]?.count;
      if (typeof count === 'number') {
        return count;
      }
      return Number(count);
    },
    close() {
      return pool.end();
    },
  };
}

export async function runTarget(target: KeepaliveTarget, runId: string): Promise<void> {
  const expected = createKeepaliveRecords(runId);
  let store: KeepaliveStore | undefined;
  let inserted = false;
  let operationError: Error | undefined;
  let cleanupError: Error | undefined;

  try {
    store = await target.createStore();
    await store.insert(expected);
    inserted = true;
    verifyKeepaliveRecords(expected, await store.read(runId));
  } catch (error) {
    operationError = asError(error as Error | string | object);
  } finally {
    if (store) {
      const cleanupErrors: Error[] = [];
      try {
        const deleted = await store.delete(runId);
        if (inserted && deleted !== KEEPALIVE_RECORD_COUNT) {
          cleanupErrors.push(
            new Error(`Keepalive cleanup deleted ${deleted} instead of ${KEEPALIVE_RECORD_COUNT}`),
          );
        }
      } catch (error) {
        cleanupErrors.push(asError(error as Error | string | object));
      }
      try {
        const remaining = await store.count(runId);
        if (remaining !== 0) {
          cleanupErrors.push(new Error(`Keepalive cleanup left ${remaining} record(s)`));
        }
      } catch (error) {
        cleanupErrors.push(asError(error as Error | string | object));
      }
      try {
        await store.close();
      } catch (error) {
        cleanupErrors.push(asError(error as Error | string | object));
      }
      if (cleanupErrors.length > 0) {
        cleanupError = new AggregateError(cleanupErrors, 'Keepalive cleanup failed');
      }
    }
  }

  if (operationError || cleanupError) {
    throw new KeepaliveTargetError(target.name, operationError ?? cleanupError!, cleanupError);
  }
}

export async function runTargets(
  targets: readonly KeepaliveTarget[],
  runId: string,
  logger: KeepaliveLogger = console,
): Promise<void> {
  const results = await Promise.allSettled(
    targets.map(async (target) => {
      await runTarget(target, runId);
      logger.info?.(`Database keepalive passed: ${target.name}`);
    }),
  );
  const failures = results.flatMap((result, index) => {
    if (result.status !== 'rejected') {
      return [];
    }
    if (result.reason instanceof KeepaliveTargetError) {
      return [result.reason];
    }
    return [
      new KeepaliveTargetError(
        targets[index]?.name ?? 'unknown',
        asError(result.reason as Error | string | object),
      ),
    ];
  });
  if (failures.length > 0) {
    logger.error?.(`Database keepalive failed for ${failures.length} target(s)`);
    throw new KeepaliveRunError(failures);
  }
}

export async function runKeepalive(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const runId = createRunId(env);
  const targets: KeepaliveTarget[] = [
    {
      name: 'mongo-dev',
      createStore: () => createMongoStore(requiredEnv(env, 'MONGO_DEV_URI')),
    },
    {
      name: 'mongo-prod',
      createStore: () => createMongoStore(requiredEnv(env, 'MONGO_PROD_URI')),
    },
    {
      name: 'supabase-dev',
      createStore: async () => createPostgresStore(requiredEnv(env, 'SUPABASE_DEV_URL')),
    },
    {
      name: 'supabase-prod',
      createStore: async () => createPostgresStore(requiredEnv(env, 'SUPABASE_PROD_URL')),
    },
  ];
  await runTargets(targets, runId);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runKeepalive().catch((error: Error) => {
    console.error(error instanceof KeepaliveRunError ? error.message : 'Database keepalive failed');
    process.exitCode = 1;
  });
}
