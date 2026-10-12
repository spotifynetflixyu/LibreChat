import { EventEmitter } from 'node:events';
import { createSteelPostgresService } from './pool';

function fixture() {
  const events = new EventEmitter();
  const pool = {
    options: { min: 0 },
    query: jest.fn().mockResolvedValue({ rows: [] }),
    on: events.on.bind(events),
    end: jest.fn().mockResolvedValue(undefined),
  };
  const createPool = jest.fn(() => pool);
  const onWarning = jest.fn();
  const client = createSteelPostgresService({ createPool, onWarning });
  return { events, pool, createPool, onWarning, client };
}

it('keeps disabled startup fully lazy and shares one pool between callers', async () => {
  const { pool, createPool, client } = fixture();
  expect(await client.initialize()).toEqual({ ok: true });
  expect(createPool).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
  expect(pool.options.min).toBe(0);
  expect(client.getClient()).toBe(pool);
  expect(client.getClient()).toBe(pool);
  expect(createPool).toHaveBeenCalledTimes(1);
});

it('shares the lazy query client across concurrent catalog, tool, rule and quotation callers', async () => {
  const { pool, createPool, client } = fixture();
  await client.initialize();
  const callers = [client.client, client.client, client.client, client.client];
  expect(createPool).not.toHaveBeenCalled();
  await Promise.all(
    callers.map((consumer, index) =>
      consumer.query<{ id: string }>('SELECT id FROM steel.prices WHERE id = $1', [index]),
    ),
  );
  expect(createPool).toHaveBeenCalledTimes(1);
  expect(pool.query).toHaveBeenCalledTimes(4);
  expect(pool.query).toHaveBeenLastCalledWith('SELECT id FROM steel.prices WHERE id = $1', [3]);
  expect(pool.options.min).toBe(0);
});

it('preserves query results and failures instead of applying warm-up error handling', async () => {
  const { pool, onWarning, client } = fixture();
  const result = { rows: [{ id: 'item-1' }] };
  pool.query.mockResolvedValueOnce(result);
  expect(await client.client.query('SELECT id FROM steel.prices')).toBe(result);
  const failure = new Error('database unavailable');
  pool.query.mockRejectedValueOnce(failure);
  await expect(client.client.query('SELECT id FROM steel.prices')).rejects.toBe(failure);
  expect(onWarning).not.toHaveBeenCalled();
});

it('warms and retains one connection before the first query', async () => {
  const { pool, createPool, client } = fixture();
  await Promise.all([
    client.initialize({ keepAlive: true }),
    client.initialize({ keepAlive: true }),
  ]);
  expect(createPool).toHaveBeenCalledTimes(1);
  expect(pool.options.min).toBe(1);
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  await client.initialize({ keepAlive: true });
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(client.getClient()).toBe(pool);
});

it('reports warm-up failure safely and permits request and initialization retries', async () => {
  const { pool, onWarning, client } = fixture();
  pool.query.mockRejectedValueOnce(new Error('secret credential details'));
  expect(await client.initialize({ keepAlive: true })).toEqual({
    ok: false,
    error: { code: 'POSTGRES_PRECONNECT_FAILED' },
  });
  expect(onWarning).toHaveBeenCalledWith('POSTGRES_PRECONNECT_FAILED');
  await expect(client.getClient().query('SELECT id FROM steel.prices')).resolves.toEqual({
    rows: [],
  });
  expect(await client.initialize({ keepAlive: true })).toEqual({ ok: true });
  expect(pool.query).toHaveBeenCalledTimes(3);
});

it('allows a failed factory to be retried without caching the failure', async () => {
  const { pool, createPool, client } = fixture();
  createPool.mockImplementationOnce(() => {
    throw new Error('secret URL');
  });
  expect(await client.initialize({ keepAlive: true })).toMatchObject({ ok: false });
  expect(await client.initialize({ keepAlive: true })).toEqual({ ok: true });
  expect(client.getClient()).toBe(pool);
});

it('handles idle errors with one reconnect and never discloses raw errors', async () => {
  const { events, pool, onWarning, client } = fixture();
  await client.initialize({ keepAlive: true });
  const error = new Error('secret host and credentials');
  expect(() => {
    events.emit('error', error);
    events.emit('error', error);
  }).not.toThrow();
  await client.initialize({ keepAlive: true });
  expect(pool.query).toHaveBeenCalledTimes(2);
  expect(onWarning.mock.calls.every(([code]) => code === 'POSTGRES_CONNECTION_CLOSED')).toBe(true);
});

it('does not preconnect or reconnect when keep-alive is disabled', async () => {
  const { events, pool, client } = fixture();
  await client.initialize({ keepAlive: false });
  client.getClient();
  events.emit('error', new Error('offline'));
  await Promise.resolve();
  expect(pool.query).not.toHaveBeenCalled();
  expect(pool.options.min).toBe(0);
});

it('prevents a pending initialization from creating a pool after close', async () => {
  const { pool, createPool, client } = fixture();
  const initializing = client.initialize({ keepAlive: true });
  await client.close();
  expect(await initializing).toMatchObject({
    ok: false,
    error: { code: 'POSTGRES_POOL_CLOSED' },
  });
  expect(createPool).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
  expect(pool.end).not.toHaveBeenCalled();
});

it('drains a created pool exactly once and suppresses reconnects after close', async () => {
  const { events, pool, client } = fixture();
  await client.initialize({ keepAlive: true });
  await Promise.all([client.close(), client.close()]);
  events.emit('error', new Error('closed socket'));
  await Promise.resolve();
  expect(pool.end).toHaveBeenCalledTimes(1);
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(() => client.getClient()).toThrow('Steel PostgreSQL pool is closed');
});

it('starts shutdown while a warm query is active and waits for the pool to drain', async () => {
  const { pool, client } = fixture();
  let finishQuery!: () => void;
  const query = new Promise<{ rows: object[] }>((resolve) => {
    finishQuery = () => resolve({ rows: [] });
  });
  pool.query.mockReturnValueOnce(query);
  pool.end.mockImplementationOnce(async () => {
    await query;
  });
  const initializing = client.initialize({ keepAlive: true });
  await Promise.resolve();
  const closing = client.close();
  expect(pool.end).toHaveBeenCalledTimes(1);
  expect(await client.initialize({ keepAlive: true })).toMatchObject({
    ok: false,
    error: { code: 'POSTGRES_POOL_CLOSED' },
  });
  finishQuery();
  expect(await initializing).toEqual({ ok: false, error: { code: 'POSTGRES_POOL_CLOSED' } });
  await closing;
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(() => client.client.query('SELECT 1')).toThrow('Steel PostgreSQL pool is closed');
});

it('recovers idle errors without ending or replacing the pool while another query runs', async () => {
  const { events, pool, createPool, client } = fixture();
  await client.initialize({ keepAlive: true });
  let finishQuery!: () => void;
  pool.query.mockReturnValueOnce(
    new Promise<{ rows: object[] }>((resolve) => {
      finishQuery = () => resolve({ rows: [] });
    }),
  );
  const active = client.client.query('SELECT id FROM steel.prices');
  events.emit('error', new Error('idle socket closed'));
  await client.initialize({ keepAlive: true });
  expect(createPool).toHaveBeenCalledTimes(1);
  expect(pool.end).not.toHaveBeenCalled();
  finishQuery();
  await active;
});
