import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/env.js';
import { testConfig } from '../test/helpers.js';
import { createDatabasePool } from './pool.js';

const SECRET = 'S3cr3t-pa55word-do-not-leak';
const URL_WITH_SECRET = `postgresql://fasalytics_app:${SECRET}@db:5432/fasalytics`;

/** A pool double that records how it was constructed and used. */
function fakePoolClass() {
  /** @type {Array<{ options: Record<string, unknown>, ended: number, handlers: Function[] }>} */
  const instances = [];
  class FakePool {
    /** @param {Record<string, unknown>} options */
    constructor(options) {
      this.record = { options, ended: 0, handlers: /** @type {Function[]} */ ([]) };
      instances.push(this.record);
    }
    /** @param {string} _event @param {Function} listener */
    on(_event, listener) {
      this.record.handlers.push(listener);
      return this;
    }
    async end() {
      this.record.ended += 1;
    }
    async connect() {
      throw new Error('not used');
    }
  }
  return { FakePool, instances };
}

describe('createDatabasePool', () => {
  it('builds one bounded pool from the validated configuration', () => {
    const { FakePool, instances } = fakePoolClass();
    createDatabasePool(
      testConfig({
        databaseUrl: URL_WITH_SECRET,
        databasePool: {
          max: 7,
          connectionTimeoutMs: 1234,
          idleTimeoutMs: 4321,
          queryTimeoutMs: 2222,
          healthTimeoutMs: 900,
        },
      }),
      { PoolClass: /** @type {any} */ (FakePool) },
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]?.options).toMatchObject({
      connectionString: URL_WITH_SECRET,
      max: 7,
      connectionTimeoutMillis: 1234,
      idleTimeoutMillis: 4321,
      query_timeout: 2222,
      statement_timeout: 2222,
      application_name: 'fasalytics-api',
    });
  });

  it('refuses to build a pool when DATABASE_URL is not configured', () => {
    expect(() => createDatabasePool(testConfig({ databaseUrl: null }))).toThrow(/DATABASE_URL/);
  });

  it('does not connect on creation (the API must start when the database is down)', () => {
    // The real pg.Pool is lazy: constructing it against a dead port must not throw or hang.
    const handle = createDatabasePool(
      testConfig({ databaseUrl: 'postgresql://fasalytics_app:x@127.0.0.1:1/none' }),
    );
    expect(handle.pool).toBeDefined();
    return handle.close();
  });

  it('handles idle-connection errors without throwing, logging the code only', () => {
    const { FakePool, instances } = fakePoolClass();
    const warn = vi.fn();
    createDatabasePool(testConfig({ databaseUrl: URL_WITH_SECRET }), {
      PoolClass: /** @type {any} */ (FakePool),
      logger: /** @type {any} */ ({ warn }),
    });
    const handler = instances[0]?.handlers[0];
    expect(handler).toBeTypeOf('function');
    const error = Object.assign(new Error(`connect failed for ${URL_WITH_SECRET}`), {
      code: '57P01',
    });
    expect(() => handler?.(error)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(warn.mock.calls)).toContain('57P01');
  });

  it('closes the pool exactly once however many times close() is called', async () => {
    const { FakePool, instances } = fakePoolClass();
    const handle = createDatabasePool(testConfig({ databaseUrl: URL_WITH_SECRET }), {
      PoolClass: /** @type {any} */ (FakePool),
    });
    await Promise.all([handle.close(), handle.close()]);
    await handle.close();
    expect(instances[0]?.ended).toBe(1);
  });

  it('does not reject when ending the pool fails', async () => {
    const { FakePool } = fakePoolClass();
    FakePool.prototype.end = async () => {
      throw Object.assign(new Error(`boom ${URL_WITH_SECRET}`), { code: 'XX000' });
    };
    const warn = vi.fn();
    const handle = createDatabasePool(testConfig({ databaseUrl: URL_WITH_SECRET }), {
      PoolClass: /** @type {any} */ (FakePool),
      logger: /** @type {any} */ ({ warn }),
    });
    await expect(handle.close()).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
  });
});

describe('database configuration', () => {
  const base = { NODE_ENV: 'test' };
  const good = 'postgresql://fasalytics_app:pw@db:5432/fasalytics';

  it('defaults to bounded pool settings', () => {
    const config = loadConfig({ ...base, DATABASE_URL: good });
    expect(config.databasePool).toEqual({
      max: 5,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 30000,
      queryTimeoutMs: 5000,
      healthTimeoutMs: 2000,
    });
    expect(config.databaseUrl).toBe(good);
  });

  it('reads pool bounds from the environment', () => {
    const config = loadConfig({
      ...base,
      DB_POOL_MAX: '3',
      DB_CONNECTION_TIMEOUT_MS: '1500',
      DB_IDLE_TIMEOUT_MS: '9000',
      DB_QUERY_TIMEOUT_MS: '2500',
      DB_HEALTH_TIMEOUT_MS: '700',
    });
    expect(config.databasePool).toEqual({
      max: 3,
      connectionTimeoutMs: 1500,
      idleTimeoutMs: 9000,
      queryTimeoutMs: 2500,
      healthTimeoutMs: 700,
    });
  });

  it.each([
    ['DB_POOL_MAX', '0'],
    ['DB_POOL_MAX', '500'],
    ['DB_POOL_MAX', 'many'],
    ['DB_CONNECTION_TIMEOUT_MS', '5'],
    ['DB_IDLE_TIMEOUT_MS', '999999999'],
    ['DB_QUERY_TIMEOUT_MS', '-1'],
    ['DB_HEALTH_TIMEOUT_MS', '0'],
  ])('rejects %s=%s naming the variable', (key, value) => {
    expect(() => loadConfig({ ...base, [key]: value })).toThrow(new RegExp(key));
  });

  it.each([
    'postgresql://fasalytics_admin:pw@db:5432/fasalytics',
    'postgresql://fasalytics_migrator:pw@db:5432/fasalytics',
    'postgresql://postgres:pw@db:5432/fasalytics',
  ])('refuses a privileged role in DATABASE_URL (%s)', (url) => {
    expect(() => loadConfig({ ...base, DATABASE_URL: url })).toThrow(/application role/);
  });

  it('rejects a malformed URL without echoing it', () => {
    const bad = `not-a-url-${SECRET}`;
    let message = '';
    try {
      loadConfig({ ...base, DATABASE_URL: bad });
    } catch (error) {
      message = /** @type {Error} */ (error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain(SECRET);
  });

  it('never echoes the password when a pool variable is wrong', () => {
    let message = '';
    try {
      loadConfig({ ...base, DATABASE_URL: URL_WITH_SECRET, DB_POOL_MAX: 'x' });
    } catch (error) {
      message = /** @type {Error} */ (error).message;
    }
    expect(message).toMatch(/DB_POOL_MAX/);
    expect(message).not.toContain(SECRET);
  });
});

describe('checked-out connection failures', () => {
  it('attaches an error listener to every new client so a mid-query reset cannot crash the process', () => {
    const { FakePool, instances } = fakePoolClass();
    const warn = vi.fn();
    createDatabasePool(testConfig({ databaseUrl: URL_WITH_SECRET }), {
      PoolClass: /** @type {any} */ (FakePool),
      logger: /** @type {any} */ ({ warn }),
    });
    const onConnect = instances[0]?.handlers[1];
    expect(onConnect).toBeTypeOf('function');
    /** @type {Function | undefined} */
    let clientListener;
    onConnect?.({
      on: (/** @type {string} */ _e, /** @type {Function} */ l) => (clientListener = l),
    });
    expect(clientListener).toBeTypeOf('function');
    expect(() =>
      clientListener?.(
        Object.assign(new Error(`reset ${URL_WITH_SECRET}`), { code: 'ECONNRESET' }),
      ),
    ).not.toThrow();
    expect(JSON.stringify(warn.mock.calls)).toContain('ECONNRESET');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
  });
});
