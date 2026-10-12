import type { SteelRepositoryClient, SteelSqlParameter } from './repositories/types';

export interface SteelPostgresPool extends SteelRepositoryClient {
  options: { min?: number };
  on(event: 'error', listener: () => void): void;
  end(): Promise<void>;
}

type WarningCode = 'POSTGRES_PRECONNECT_FAILED' | 'POSTGRES_CONNECTION_CLOSED';
type InitializationResult =
  | { ok: true }
  | { ok: false; error: { code: 'POSTGRES_PRECONNECT_FAILED' | 'POSTGRES_POOL_CLOSED' } };

export interface SteelPostgresService {
  client: SteelRepositoryClient;
  getClient(): SteelPostgresPool;
  initialize(config?: { keepAlive?: boolean }): Promise<InitializationResult>;
  close(): Promise<void>;
}

/** Owns the shared Steel pool for the server lifetime; request queries retain their normal errors. */
export function createSteelPostgresService({
  createPool,
  onWarning,
}: {
  createPool: () => SteelPostgresPool;
  onWarning: (code: WarningCode) => void;
}): SteelPostgresService {
  let pool: SteelPostgresPool | undefined;
  let retained = false;
  let closed = false;
  let warmed = false;
  let warming: Promise<InitializationResult> | undefined;
  let closing: Promise<void> | undefined;

  function getClient(): SteelPostgresPool {
    if (closed) {
      throw new Error('Steel PostgreSQL pool is closed');
    }
    if (pool) {
      return pool;
    }
    pool = createPool();
    if (retained) {
      pool.options.min = 1;
    }
    pool.on('error', () => {
      if (closed) {
        return;
      }
      warmed = false;
      onWarning('POSTGRES_CONNECTION_CLOSED');
      if (retained) {
        void warm();
      }
    });
    return pool;
  }

  function warm(): Promise<InitializationResult> {
    if (warming) {
      return warming;
    }
    warming = Promise.resolve()
      .then(async (): Promise<InitializationResult> => {
        if (closed) {
          return { ok: false, error: { code: 'POSTGRES_POOL_CLOSED' } };
        }
        try {
          await getClient().query('SELECT 1');
          if (closed) {
            return { ok: false, error: { code: 'POSTGRES_POOL_CLOSED' } };
          }
          warmed = true;
          return { ok: true };
        } catch {
          onWarning('POSTGRES_PRECONNECT_FAILED');
          return { ok: false, error: { code: 'POSTGRES_PRECONNECT_FAILED' } };
        }
      })
      .finally(() => {
        warming = undefined;
      });
    return warming;
  }

  function initialize(config?: { keepAlive?: boolean }): Promise<InitializationResult> {
    if (closed) {
      return Promise.resolve({ ok: false, error: { code: 'POSTGRES_POOL_CLOSED' } });
    }
    if (!config?.keepAlive) {
      return Promise.resolve({ ok: true });
    }
    retained = true;
    if (pool) {
      pool.options.min = 1;
    }
    return warmed ? Promise.resolve({ ok: true }) : warm();
  }

  function close(): Promise<void> {
    closed = true;
    closing ??= pool ? pool.end() : Promise.resolve();
    return closing;
  }

  const client: SteelRepositoryClient = {
    query<Row extends object>(sql: string, values?: readonly SteelSqlParameter[]) {
      return getClient().query<Row>(sql, values);
    },
  };

  return { client, getClient, initialize, close };
}
