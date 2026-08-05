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

type KeepaliveStage = 'connect' | 'insert' | 'read' | 'delete' | 'count' | 'close' | 'unknown';

interface KeepaliveFailure {
  stage: KeepaliveStage;
  error: Error;
}

export interface PostgresQueryable {
  query: (text: string, values?: unknown[]) => Promise<PostgresQueryResult>;
  end: () => Promise<void>;
}

export class KeepaliveTargetError extends Error {
  readonly targetName: string;
  readonly operationError: Error;
  readonly operationStage?: KeepaliveStage;
  readonly cleanupError?: Error;
  readonly cleanupFailures: readonly KeepaliveFailure[];

  constructor(
    targetName: string,
    operationFailure: KeepaliveFailure | undefined,
    cleanupFailures: readonly KeepaliveFailure[],
  ) {
    const cleanupError =
      cleanupFailures.length > 0
        ? new AggregateError(
            cleanupFailures.map((failure) => failure.error),
            'Keepalive cleanup failed',
          )
        : undefined;
    super(
      operationFailure && cleanupError
        ? `Database keepalive target ${targetName} failed and cleanup also failed`
        : operationFailure
          ? `Database keepalive target ${targetName} failed`
          : `Database keepalive target ${targetName} cleanup failed`,
      { cause: operationFailure?.error ?? cleanupError },
    );
    this.name = 'KeepaliveTargetError';
    this.targetName = targetName;
    this.operationError = operationFailure?.error ?? cleanupError!;
    this.operationStage = operationFailure?.stage;
    this.cleanupError = cleanupError;
    this.cleanupFailures = cleanupFailures;
  }
}

export class KeepaliveRunError extends Error {
  readonly failures: readonly KeepaliveTargetError[];
  readonly runId: string;

  constructor(failures: readonly KeepaliveTargetError[], runId: string) {
    super(`Database keepalive failed for ${failures.length} target(s)`);
    this.name = 'KeepaliveRunError';
    this.failures = failures;
    this.runId = runId;
  }
}

const DATABASE_URL_PATTERN = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?):\/\/[^\s]+/gi;
const ERROR_STACK_FRAME_LIMIT = 12;

function appendErrorDetails(
  lines: string[],
  error: Error,
  indent: string,
  label: string,
  seen: Set<Error>,
): void {
  if (seen.has(error)) {
    lines.push(`${indent}${label}: [circular error]`);
    return;
  }
  seen.add(error);

  if (label === 'Error') {
    lines.push(`${indent}Error type: ${error.name}`, `${indent}Error: ${error.message}`);
  } else {
    lines.push(`${indent}${label}: ${error.name}: ${error.message}`);
  }

  const stackFrames = error.stack
    ?.split('\n')
    .slice(1, ERROR_STACK_FRAME_LIMIT + 1)
    .map((frame) => frame.trim())
    .filter(Boolean);
  if (stackFrames?.length) {
    lines.push(`${indent}Stack:`, ...stackFrames.map((frame) => `${indent}  ${frame}`));
  }

  if (error.cause instanceof Error) {
    appendErrorDetails(lines, error.cause, indent, 'Cause', seen);
  }
  if (error instanceof AggregateError) {
    error.errors.forEach((nestedError, index) => {
      if (nestedError instanceof Error) {
        appendErrorDetails(lines, nestedError, indent, `Nested error ${index + 1}`, seen);
      }
    });
  }
}

export function formatKeepaliveRunError(error: KeepaliveRunError): string {
  const lines = [error.message, `Run ID: ${error.runId}`];
  for (const failure of error.failures) {
    lines.push(`Target: ${failure.targetName}`);
    if (failure.operationStage) {
      lines.push(`  Operation stage: ${failure.operationStage}`);
      appendErrorDetails(lines, failure.operationError, '  ', 'Error', new Set());
    }
    for (const cleanupFailure of failure.cleanupFailures) {
      lines.push(`  Cleanup stage: ${cleanupFailure.stage}`);
      appendErrorDetails(lines, cleanupFailure.error, '  ', 'Error', new Set());
    }
  }
  return lines.join('\n').replace(DATABASE_URL_PATTERN, '<redacted-database-url>');
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
  let operationStage: KeepaliveStage = 'connect';
  let operationFailure: KeepaliveFailure | undefined;
  const cleanupFailures: KeepaliveFailure[] = [];

  try {
    store = await target.createStore();
    operationStage = 'insert';
    await store.insert(expected);
    inserted = true;
    operationStage = 'read';
    verifyKeepaliveRecords(expected, await store.read(runId));
  } catch (error) {
    operationFailure = {
      stage: operationStage,
      error: asError(error as Error | string | object),
    };
  } finally {
    if (store) {
      try {
        const deleted = await store.delete(runId);
        if (inserted && deleted !== KEEPALIVE_RECORD_COUNT) {
          cleanupFailures.push({
            stage: 'delete',
            error: new Error(
              `Keepalive cleanup deleted ${deleted} instead of ${KEEPALIVE_RECORD_COUNT}`,
            ),
          });
        }
      } catch (error) {
        cleanupFailures.push({
          stage: 'delete',
          error: asError(error as Error | string | object),
        });
      }
      try {
        const remaining = await store.count(runId);
        if (remaining !== 0) {
          cleanupFailures.push({
            stage: 'count',
            error: new Error(`Keepalive cleanup left ${remaining} record(s)`),
          });
        }
      } catch (error) {
        cleanupFailures.push({
          stage: 'count',
          error: asError(error as Error | string | object),
        });
      }
      try {
        await store.close();
      } catch (error) {
        cleanupFailures.push({
          stage: 'close',
          error: asError(error as Error | string | object),
        });
      }
    }
  }

  if (operationFailure || cleanupFailures.length > 0) {
    throw new KeepaliveTargetError(target.name, operationFailure, cleanupFailures);
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
        { stage: 'unknown', error: asError(result.reason as Error | string | object) },
        [],
      ),
    ];
  });
  if (failures.length > 0) {
    const error = new KeepaliveRunError(failures, runId);
    logger.error?.(formatKeepaliveRunError(error));
    throw error;
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
