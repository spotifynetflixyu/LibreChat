import { Pool } from 'pg';

import type { PoolConfig } from 'pg';

export interface SteelPostgresEnv {
  [key: string]: string | undefined;
  STEEL_POSTGRES_URL?: string;
}

const defaultPoolConfig = {
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  max: 5,
  ssl: true,
};

function withSteelPostgresSslDefaults(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get('sslmode');

    if (!sslmode) {
      url.searchParams.set('sslmode', 'require');
      url.searchParams.set('uselibpqcompat', 'true');
      return url.toString();
    }

    if (sslmode === 'require' && !url.searchParams.has('uselibpqcompat')) {
      url.searchParams.set('uselibpqcompat', 'true');
      return url.toString();
    }

    return connectionString;
  } catch {
    return connectionString;
  }
}

export function getSteelPostgresConnectionString(env: SteelPostgresEnv = process.env): string {
  const connectionString = env.STEEL_POSTGRES_URL?.trim();

  if (!connectionString) {
    throw new Error('STEEL_POSTGRES_URL is required for Steel Postgres access');
  }

  return withSteelPostgresSslDefaults(connectionString);
}

export function buildSteelPostgresConfig(env: SteelPostgresEnv = process.env): PoolConfig {
  return {
    connectionString: getSteelPostgresConnectionString(env),
    ...defaultPoolConfig,
  };
}

export function createSteelPostgresPool(env: SteelPostgresEnv = process.env): Pool {
  return new Pool(buildSteelPostgresConfig(env));
}

