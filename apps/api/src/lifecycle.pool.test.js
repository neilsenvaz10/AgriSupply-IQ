import { describe, expect, it, vi } from 'vitest';
import { startServer } from './lifecycle.js';
import { testConfig } from './test/helpers.js';

const URL_WITH_SECRET = 'postgresql://fasalytics_app:S3cr3t@127.0.0.1:1/none';

/** A pool factory double: counts pools created and ended. */
function poolFactory() {
  const end = vi.fn(async () => undefined);
  const pool = { connect: vi.fn(), end, on: vi.fn() };
  const createPool = vi.fn(() => ({ pool: /** @type {any} */ (pool), close: end }));
  return { createPool, end, pool };
}

describe('startServer and the database pool', () => {
  it('creates no pool when DATABASE_URL is not set', async () => {
    const f = poolFactory();
    const running = await startServer(testConfig({ databaseUrl: null }), {
      createPool: /** @type {any} */ (f.createPool),
    });
    await running.close(1000);
    expect(f.createPool).not.toHaveBeenCalled();
  });

  it('creates exactly one pool and closes it on shutdown', async () => {
    const f = poolFactory();
    const running = await startServer(testConfig({ databaseUrl: URL_WITH_SECRET }), {
      createPool: /** @type {any} */ (f.createPool),
    });
    expect(f.createPool).toHaveBeenCalledTimes(1);
    expect(f.end).not.toHaveBeenCalled();
    await running.close(1000);
    await running.close(1000);
    expect(f.end).toHaveBeenCalledTimes(1);
  });

  it('serves requests (and probes through the one pool) before shutdown', async () => {
    const release = vi.fn();
    const f = poolFactory();
    f.pool.connect.mockResolvedValue({ query: vi.fn(async () => ({})), release });
    const running = await startServer(testConfig({ databaseUrl: URL_WITH_SECRET }), {
      createPool: /** @type {any} */ (f.createPool),
    });
    try {
      for (let i = 0; i < 3; i += 1) {
        const res = await fetch(`http://127.0.0.1:${running.port}/health/dependencies`);
        const body = /** @type {any} */ (await res.json());
        expect(body.dependencies.postgres.status).toBe('healthy');
      }
      expect(f.createPool).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(3);
    } finally {
      await running.close(1000);
    }
  });

  it('keeps /health a pure liveness check while the database is down', async () => {
    const running = await startServer(testConfig({ databaseUrl: URL_WITH_SECRET }));
    try {
      const live = await fetch(`http://127.0.0.1:${running.port}/health`);
      expect(live.status).toBe(200);
      const deps = await fetch(`http://127.0.0.1:${running.port}/health/dependencies`);
      expect(deps.status).toBe(200);
      const body = /** @type {any} */ (await deps.json());
      expect(body.dependencies.postgres).toMatchObject({
        status: 'unreachable',
        reason: 'connection_failed',
      });
      expect(JSON.stringify(body)).not.toContain('S3cr3t');
    } finally {
      await running.close(1000);
    }
  });

  it('closes the pool it created when the port cannot be bound', async () => {
    const first = await startServer(testConfig({ databaseUrl: null }));
    const f = poolFactory();
    try {
      await expect(
        startServer(testConfig({ port: first.port, databaseUrl: URL_WITH_SECRET }), {
          createPool: /** @type {any} */ (f.createPool),
        }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(f.end).toHaveBeenCalledTimes(1);
    } finally {
      await first.close(1000);
    }
  });

  it('does not close a pool it did not create', async () => {
    const f = poolFactory();
    const running = await startServer(testConfig({ databaseUrl: URL_WITH_SECRET }), {
      pool: /** @type {any} */ (f.pool),
      createPool: /** @type {any} */ (f.createPool),
    });
    await running.close(1000);
    expect(f.createPool).not.toHaveBeenCalled();
    expect(f.end).not.toHaveBeenCalled();
  });
});
