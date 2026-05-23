import { Pool } from 'pg';

import type { PoolConfig } from 'pg';

export interface SteelPostgresEnv {
  [key: string]: string | undefined;
  STEEL_POSTGRES_URL?: string;
}

export interface SteelPostgresHealth {
  steelSchemaExists: boolean;
  steelTableCount: number;
  vectorExtensionSchema: string | null;
  vectorExtensionVersion: string | null;
}

interface SteelPostgresHealthRow {
  steel_schema_exists: boolean;
  steel_table_count: number | string;
  vector_extension_schema: string | null;
  vector_extension_version: string | null;
}

export interface SteelPostgresQueryable {
  query(sql: string): Promise<{
    rows: SteelPostgresHealthRow[];
  }>;
}

const defaultPoolConfig = {
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  max: 5,
};

const readinessQuery = `
SELECT
  to_regnamespace('steel') IS NOT NULL AS steel_schema_exists,
  (
    SELECT COUNT(*)::int
    FROM information_schema.tables
    WHERE table_schema = 'steel'
      AND table_type = 'BASE TABLE'
  ) AS steel_table_count,
  (
    SELECT extnamespace::regnamespace::text
    FROM pg_extension
    WHERE extname = 'vector'
  ) AS vector_extension_schema,
  (
    SELECT extversion
    FROM pg_extension
    WHERE extname = 'vector'
  ) AS vector_extension_version
`;

export function getSteelPostgresConnectionString(env: SteelPostgresEnv = process.env) {
  const connectionString = env.STEEL_POSTGRES_URL?.trim();

  if (!connectionString) {
    throw new Error('STEEL_POSTGRES_URL is required for Steel Postgres access');
  }

  return connectionString;
}

export function buildSteelPostgresConfig(env: SteelPostgresEnv = process.env): PoolConfig {
  return {
    connectionString: getSteelPostgresConnectionString(env),
    ...defaultPoolConfig,
  };
}

export function createSteelPostgresPool(env: SteelPostgresEnv = process.env) {
  return new Pool(buildSteelPostgresConfig(env));
}

export async function checkSteelPostgresConnection(
  client: SteelPostgresQueryable,
): Promise<SteelPostgresHealth> {
  const result = await client.query(readinessQuery);
  const row = result.rows[0];

  if (!row) {
    throw new Error('Steel Postgres readiness query returned no rows');
  }

  return {
    steelSchemaExists: row.steel_schema_exists,
    steelTableCount: Number(row.steel_table_count),
    vectorExtensionSchema: row.vector_extension_schema,
    vectorExtensionVersion: row.vector_extension_version,
  };
}
