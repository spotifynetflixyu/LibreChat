import {
  buildSteelPostgresConfig,
  checkSteelPostgresConnection,
  getSteelPostgresConnectionString,
} from './postgres';

describe('Steel Postgres connection helpers', () => {
  it('reads STEEL_POSTGRES_URL from the provided environment', () => {
    const connectionString = getSteelPostgresConnectionString({
      STEEL_POSTGRES_URL: 'postgresql://user:pass@example.supabase.co:5432/postgres',
    });

    expect(connectionString).toBe(
      'postgresql://user:pass@example.supabase.co:5432/postgres?sslmode=require&uselibpqcompat=true',
    );
  });

  it('preserves explicit libpq-compatible Steel Postgres SSL parameters', () => {
    const connectionString = getSteelPostgresConnectionString({
      STEEL_POSTGRES_URL:
        'postgresql://user:pass@example.supabase.co:6543/postgres?sslmode=require&uselibpqcompat=true',
    });

    expect(connectionString).toBe(
      'postgresql://user:pass@example.supabase.co:6543/postgres?sslmode=require&uselibpqcompat=true',
    );
  });

  it('does not override explicit CA-backed verify-full settings', () => {
    const connectionString = getSteelPostgresConnectionString({
      STEEL_POSTGRES_URL:
        'postgresql://user:pass@example.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/certs/supabase.pem',
    });

    expect(connectionString).toBe(
      'postgresql://user:pass@example.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=/certs/supabase.pem',
    );
  });

  it('throws when STEEL_POSTGRES_URL is missing', () => {
    expect(() => getSteelPostgresConnectionString({})).toThrow(
      'STEEL_POSTGRES_URL is required for Steel Postgres access',
    );
  });

  it('builds a conservative pool config for Supabase-backed Steel queries', () => {
    const config = buildSteelPostgresConfig({
      STEEL_POSTGRES_URL: 'postgresql://user:pass@example.supabase.co:5432/postgres',
    });

    expect(config).toEqual({
      connectionString:
        'postgresql://user:pass@example.supabase.co:5432/postgres?sslmode=require&uselibpqcompat=true',
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      max: 5,
      ssl: true,
    });
  });

  it('checks Steel schema availability with a read-only query', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          steel_schema_exists: true,
          steel_table_count: '21',
          vector_extension_schema: 'public',
          vector_extension_version: '0.8.0',
        },
      ],
    });

    const result = await checkSteelPostgresConnection({ query });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("to_regnamespace('steel')"));
    expect(result).toEqual({
      steelSchemaExists: true,
      steelTableCount: 21,
      vectorExtensionSchema: 'public',
      vectorExtensionVersion: '0.8.0',
    });
  });
});
