import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../test/helpers.js';
import { checkDependencies, checkPostgres, summarize } from './dependencyHealth.js';

const SECRET = 'S3cr3t-pa55word-do-not-leak';
const URL_WITH_SECRET = `postgresql://fasalytics_app:${SECRET}@db:5432/fasalytics`;

/**
 * A pool/client double. `connect` and `query` behaviours are configurable so each failure mode
 * can be exercised without a database.
 *
 * @param {{ connect?: () => Promise<void>, query?: () => Promise<unknown> }} [behaviour]
 */
function fakePool(behaviour = {}) {
  const release = vi.fn();
  const query = vi.fn(behaviour.query ?? (async () => ({ rows: [{ ok: 1 }] })));
  const client = { query, release };
  const connect = vi.fn(async () => {
    await behaviour.connect?.();
    return client;
  });
  return { pool: /** @type {any} */ ({ connect }), client, connect, query, release };
}

const config = testConfig({ databaseUrl: URL_WITH_SECRET });
const never = () => new Promise(() => undefined);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('checkPostgres', () => {
  it('is not_configured without DATABASE_URL and never touches a pool', async () => {
    const f = fakePool();
    const report = await checkPostgres(testConfig({ databaseUrl: null }), { pool: f.pool });
    expect(report.status).toBe('not_configured');
    expect(f.connect).not.toHaveBeenCalled();
  });

  it('is not_checked (never healthy) when configured but no pool is available', async () => {
    const report = await checkPostgres(config);
    expect(report.status).toBe('not_checked');
  });

  it('is healthy only after SELECT 1 succeeded, and releases the connection normally', async () => {
    const f = fakePool();
    const report = await checkPostgres(config, { pool: f.pool });
    expect(report.status).toBe('healthy');
    expect(report.latencyMs).toBeTypeOf('number');
    expect(f.query).toHaveBeenCalledWith('SELECT 1 AS ok');
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(false);
  });

  it.each([
    ['ECONNREFUSED', 'connection_failed'],
    ['ENOTFOUND', 'connection_failed'],
    ['57P03', 'connection_failed'],
    ['57P01', 'connection_failed'],
    ['28P01', 'authentication_failed'],
    ['57014', 'timeout'],
  ])('maps driver code %s to reason %s', async (code, reason) => {
    const f = fakePool({
      connect: async () => {
        throw Object.assign(new Error(`failed ${URL_WITH_SECRET}`), { code });
      },
    });
    const report = await checkPostgres(config, { pool: f.pool });
    expect(report).toMatchObject({ status: 'unreachable', reason });
  });

  it('reports query_failed when connected but the query fails, and destroys the connection', async () => {
    const f = fakePool({
      query: async () => {
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      },
    });
    const report = await checkPostgres(config, { pool: f.pool });
    expect(report).toMatchObject({ status: 'unreachable', reason: 'query_failed' });
    expect(f.release).toHaveBeenCalledWith(true);
  });

  it('times out a connection that never arrives', async () => {
    const f = fakePool({ connect: never });
    const report = await checkPostgres(
      testConfig({
        databaseUrl: URL_WITH_SECRET,
        databasePool: { ...config.databasePool, healthTimeoutMs: 100 },
      }),
      { pool: f.pool },
    );
    expect(report).toMatchObject({ status: 'unreachable', reason: 'timeout' });
    expect(report.latencyMs).toBeLessThan(1000);
  });

  it('releases a connection that arrives after the deadline (no leak)', async () => {
    const f = fakePool({ connect: () => sleep(250) });
    const report = await checkPostgres(
      testConfig({
        databaseUrl: URL_WITH_SECRET,
        databasePool: { ...config.databasePool, healthTimeoutMs: 100 },
      }),
      { pool: f.pool },
    );
    expect(report.reason).toBe('timeout');
    await sleep(400);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(true);
    expect(f.query).not.toHaveBeenCalled();
  });

  it('times out a query that never returns and still releases the connection', async () => {
    const f = fakePool({ query: never });
    const report = await checkPostgres(
      testConfig({
        databaseUrl: URL_WITH_SECRET,
        databasePool: { ...config.databasePool, healthTimeoutMs: 100 },
      }),
      { pool: f.pool },
    );
    expect(report).toMatchObject({ status: 'unreachable', reason: 'timeout' });
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(true);
  });

  it('never leaks the password, connection string or raw driver text', async () => {
    const attempts = [
      Object.assign(new Error(`password authentication failed for ${URL_WITH_SECRET}`), {
        code: '28P01',
      }),
      Object.assign(new Error(`connect ECONNREFUSED db:5432 ${SECRET}`), { code: 'ECONNREFUSED' }),
      new Error(`something odd with ${SECRET}`),
    ];
    for (const error of attempts) {
      const f = fakePool({
        connect: async () => {
          throw error;
        },
      });
      const text = JSON.stringify(await checkPostgres(config, { pool: f.pool }));
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('fasalytics_app');
      expect(text).not.toContain('5432');
      expect(text).not.toContain(error.message);
    }
  });
});

describe('checkDependencies with a database', () => {
  it('reports healthy postgres alongside the intelligence probe, and summarizes', async () => {
    const f = fakePool();
    const fetchImpl = async () =>
      new Response(JSON.stringify({ status: 'ok', service: 'fasalytics-intelligence' }), {
        status: 200,
      });
    const reports = await checkDependencies(
      testConfig({ databaseUrl: URL_WITH_SECRET, mlServiceUrl: 'http://intelligence:8000' }),
      { pool: f.pool, fetchImpl: /** @type {any} */ (fetchImpl) },
    );
    expect(reports.postgres.status).toBe('healthy');
    expect(reports.intelligence_service.status).toBe('healthy');
    expect(summarize(reports)).toBe('healthy');
  });

  it('degrades overall when only the database is down, keeping the other report intact', async () => {
    const f = fakePool({
      connect: async () => {
        throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
      },
    });
    const fetchImpl = async () =>
      new Response(JSON.stringify({ status: 'ok', service: 'fasalytics-intelligence' }), {
        status: 200,
      });
    const reports = await checkDependencies(
      testConfig({ databaseUrl: URL_WITH_SECRET, mlServiceUrl: 'http://intelligence:8000' }),
      { pool: f.pool, fetchImpl: /** @type {any} */ (fetchImpl) },
    );
    expect(reports.postgres.status).toBe('unreachable');
    expect(reports.intelligence_service.status).toBe('healthy');
    expect(summarize(reports)).toBe('degraded');
  });
});
