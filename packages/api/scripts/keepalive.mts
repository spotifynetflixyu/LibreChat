import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { MongoClient } from 'mongodb';
import { Pool } from 'pg';

/**
 * Keeps the free-tier databases active by writing, reading back and deleting
 * one record per target. A real write is kept on purpose: a bare `SELECT 1`
 * or `ping` may not count as activity for the providers' inactivity checks.
 */

export interface KeepaliveRecord {
  run_id: string;
  sequence: number;
  created_at: Date;
  random_data: string;
}

export interface KeepaliveStore {
  insert(record: KeepaliveRecord): Promise<void>;
  exists(runId: string): Promise<boolean>;
  delete(runId: string): Promise<void>;
  close(): Promise<void>;
}

export interface KeepaliveTarget {
  name: string;
  createStore: () => Promise<KeepaliveStore>;
}

export interface PostgresQueryable {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null }>;
  end: () => Promise<void>;
}

const POSTGRES_TABLE = 'steel.keepalive';
const DATABASE_URL_PATTERN = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?):\/\/[^\s]+/gi;

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function createRunId(env: NodeJS.ProcessEnv = process.env): string {
  const runId = env.GITHUB_RUN_ID?.trim();
  return runId
    ? `github:${runId}:${env.GITHUB_RUN_ATTEMPT?.trim() || '1'}`
    : `local:${randomUUID()}`;
}

export function getMongoDatabaseName(uri: string): string {
  const parsed = URL.canParse(uri) ? new URL(uri) : undefined;
  if (parsed?.protocol !== 'mongodb:' && parsed?.protocol !== 'mongodb+srv:') {
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
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  const collection = client.db(databaseName).collection<KeepaliveRecord>('keepalive');
  return {
    insert: async (record) => void (await collection.insertOne({ ...record })),
    exists: async (runId) => (await collection.countDocuments({ run_id: runId })) > 0,
    delete: async (runId) => void (await collection.deleteMany({ run_id: runId })),
    close: () => client.close(),
  };
}

export function createPostgresStore(pool: PostgresQueryable): KeepaliveStore {
  return {
    insert: async (record) =>
      void (await pool.query(
        `INSERT INTO ${POSTGRES_TABLE} (run_id, sequence, created_at, random_data)
         VALUES ($1, $2, $3, $4)`,
        [record.run_id, record.sequence, record.created_at, record.random_data],
      )),
    exists: async (runId) =>
      ((await pool.query(`SELECT 1 FROM ${POSTGRES_TABLE} WHERE run_id = $1`, [runId]))
        .rowCount ?? 0) > 0,
    delete: async (runId) =>
      void (await pool.query(`DELETE FROM ${POSTGRES_TABLE} WHERE run_id = $1`, [runId])),
    close: () => pool.end(),
  };
}

/** Writes one record, confirms it reads back, then always deletes it and closes. */
export async function runTarget(target: KeepaliveTarget, runId: string): Promise<void> {
  const store = await target.createStore();
  try {
    await store.insert({
      run_id: runId,
      sequence: 1,
      created_at: new Date(),
      random_data: randomBytes(32).toString('hex'),
    });
    if (!(await store.exists(runId))) {
      throw new Error('Keepalive record was not readable after insert');
    }
  } finally {
    try {
      await store.delete(runId);
    } finally {
      await store.close();
    }
  }
}

export async function runTargets(
  targets: readonly KeepaliveTarget[],
  runId: string,
  logger: Pick<Console, 'info' | 'error'> = console,
): Promise<void> {
  const results = await Promise.allSettled(targets.map((target) => runTarget(target, runId)));
  const failures: string[] = [];
  results.forEach((result, index) => {
    const name = targets[index]?.name ?? 'unknown';
    if (result.status === 'fulfilled') {
      logger.info(`Database keepalive passed: ${name}`);
      return;
    }
    const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
    failures.push(
      `${name}: ${error.name}: ${error.message}`.replace(
        DATABASE_URL_PATTERN,
        '<redacted-database-url>',
      ),
    );
  });
  if (failures.length > 0) {
    logger.error([`Database keepalive failed (run ${runId})`, ...failures].join('\n'));
    throw new Error(`Database keepalive failed for ${failures.length} target(s)`);
  }
}

export async function runKeepalive(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const postgres = (name: string) =>
    createPostgresStore(
      new Pool({
        connectionString: requiredEnv(env, name),
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 30_000,
        query_timeout: 30_000,
        statement_timeout: 30_000,
        max: 1,
      }),
    );
  await runTargets(
    [
      {
        name: 'mongo-dev',
        createStore: () => createMongoStore(requiredEnv(env, 'MONGO_DEV_URI')),
      },
      {
        name: 'mongo-prod',
        createStore: () => createMongoStore(requiredEnv(env, 'MONGO_PROD_URI')),
      },
      { name: 'supabase-dev', createStore: async () => postgres('SUPABASE_DEV_URL') },
      { name: 'supabase-prod', createStore: async () => postgres('SUPABASE_PROD_URL') },
    ],
    createRunId(env),
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runKeepalive().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
