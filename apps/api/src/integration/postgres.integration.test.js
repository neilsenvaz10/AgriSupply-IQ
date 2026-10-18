import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../database/pool.js';
import { startServer } from '../lifecycle.js';
import { checkPostgres } from '../services/dependencyHealth.js';
import { testConfig } from '../test/helpers.js';

/**
 * Integration tests against the REAL FASALYTICS PostgreSQL container (host port 5433).
 *
 * PREREQUISITES
 *   - the database container is running: `docker compose --env-file database/.env up -d --wait db`
 *   - migrations are applied:            `npm run db:migrate` (in database/)
 *   - database/.env exists (the application-role URL is read from it)
 * Without them these tests are reported as SKIPPED (never as passed). Set REQUIRE_DB=1 to make a
 * missing database a FAILURE instead. DB_TEST_RESTART=1 additionally enables the disruptive
 * outage/recovery test, which stops and restarts only the `db` container (data is kept).
 */

const appUrl = process.env.TEST_DATABASE_URL ?? '';
const requireDatabase = process.env.REQUIRE_DB === '1';
const allowRestart = process.env.DB_TEST_RESTART === '1';

async function canConnect() {
  if (!appUrl) return false;
  const client = new pg.Client({ connectionString: appUrl, connectionTimeoutMillis: 3000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const shouldRun = requireDatabase || (await canConnect());
if (!shouldRun) {
  // eslint-disable-next-line no-console -- a skipped suite must be visible in the test output
  console.warn(
    'PostgreSQL integration tests are SKIPPED: the database is not reachable or database/.env is missing. ' +
      'Start it (docker compose --env-file database/.env up -d --wait db) or set REQUIRE_DB=1 to fail instead.',
  );
}

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** @param {string[]} args */
function compose(args) {
  const result = spawnSync('docker', ['compose', '--env-file', 'database/.env', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed`);
}

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {Array<() => Promise<unknown>>} */
const cleanup = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

/**
 * @param {Partial<import('../config/env.js').DatabasePoolConfig>} [pool]
 * @param {string} [url]
 */
function open(pool = {}, url = appUrl) {
  const config = testConfig({
    databaseUrl: url,
    databasePool: { ...testConfig().databasePool, healthTimeoutMs: 2000, ...pool },
  });
  const handle = createDatabasePool(config);
  cleanup.push(() => handle.close());
  return { config, ...handle };
}

describe.runIf(shouldRun)(
  'PostgreSQL (real container) - prerequisites: running db + migrations',
  () => {
    it('connects as the application role and reports healthy', async () => {
      const { config, pool } = open();
      const report = await checkPostgres(config, { pool });
      expect(report.status).toBe('healthy');

      const who = await pool.connect();
      try {
        const r = await who.query(
          'SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su',
        );
        expect(r.rows[0]).toEqual({ u: new URL(appUrl).username, su: false });
      } finally {
        who.release();
      }
    });

    it('reports invalid credentials as authentication_failed without leaking them', async () => {
      const wrong = new URL(appUrl);
      wrong.password = 'definitely-the-wrong-password';
      const { config, pool } = open({}, wrong.toString());
      const report = await checkPostgres(config, { pool });
      expect(report).toMatchObject({ status: 'unreachable', reason: 'authentication_failed' });
      const text = JSON.stringify(report);
      expect(text).not.toContain('definitely-the-wrong-password');
      expect(text).not.toContain(new URL(appUrl).password);
    });

    it('reports an unreachable database as connection_failed', async () => {
      const dead = new URL(appUrl);
      dead.hostname = '127.0.0.1';
      dead.port = '1';
      const { config, pool } = open({}, dead.toString());
      const report = await checkPostgres(config, { pool });
      expect(report).toMatchObject({ status: 'unreachable', reason: 'connection_failed' });
      expect(JSON.stringify(report)).not.toContain(new URL(appUrl).password);
    });

    it('times out when every pooled connection is busy, then recovers once one is released', async () => {
      const { config, pool } = open({ max: 1, connectionTimeoutMs: 5000 });
      const held = await pool.connect();
      const blocked = await checkPostgres(
        { ...config, databasePool: { ...config.databasePool, healthTimeoutMs: 300 } },
        { pool },
      );
      expect(blocked).toMatchObject({ status: 'unreachable', reason: 'timeout' });
      expect(blocked.latencyMs).toBeLessThan(1500);

      held.release();
      await sleep(50);
      expect((await checkPostgres(config, { pool })).status).toBe('healthy');
      expect(pool.waitingCount).toBe(0);
    });

    it('releases connections: repeated probes never exceed the pool bound or leave waiters', async () => {
      const { config, pool } = open({ max: 2 });
      for (let i = 0; i < 12; i += 1) {
        expect((await checkPostgres(config, { pool })).status).toBe('healthy');
      }
      await Promise.all(Array.from({ length: 6 }, () => checkPostgres(config, { pool })));
      expect(pool.totalCount).toBeLessThanOrEqual(2);
      expect(pool.waitingCount).toBe(0);
      expect(pool.idleCount).toBe(pool.totalCount);
    });

    it('cancels a statement that exceeds the query timeout and stays usable', async () => {
      const { pool } = open({ queryTimeoutMs: 300 });
      const client = await pool.connect();
      const startedAt = Date.now();
      await expect(client.query('SELECT pg_sleep(5)')).rejects.toBeDefined();
      expect(Date.now() - startedAt).toBeLessThan(2500);
      client.release(true);
      const next = await pool.connect();
      expect((await next.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
      next.release();
    });

    it('cannot perform DDL or touch the migration journal (least privilege)', async () => {
      const { pool } = open();
      for (const sql of [
        'CREATE TABLE public.api_should_not_exist (id int)',
        'ALTER TABLE system_metadata ADD COLUMN api_nope int',
        'DROP TABLE system_metadata',
        'TRUNCATE system_metadata',
        'CREATE SCHEMA api_nope',
        'CREATE ROLE api_nope',
        'SELECT * FROM drizzle.__drizzle_migrations LIMIT 1',
      ]) {
        await expect(/** @type {import('pg').Pool} */ (pool).query(sql)).rejects.toMatchObject({
          code: '42501',
        });
      }
    });

    it('shuts down gracefully: the HTTP server drains, then the pool is ended', async () => {
      const running = await startServer(testConfig({ databaseUrl: appUrl }));
      const res = await fetch(`http://127.0.0.1:${running.port}/health/dependencies`);
      const body = /** @type {any} */ (await res.json());
      expect(body.dependencies.postgres.status).toBe('healthy');
      expect(JSON.stringify(body)).not.toContain(new URL(appUrl).password);
      await running.close(2000);
      await expect(fetch(`http://127.0.0.1:${running.port}/health`)).rejects.toThrow();
    });

    it.runIf(allowRestart)(
      'DISRUPTIVE (DB_TEST_RESTART=1): outage and recovery on the SAME pool, data kept',
      async () => {
        const { config, pool } = open({ connectionTimeoutMs: 1500 });
        expect((await checkPostgres(config, { pool })).status).toBe('healthy');
        try {
          compose(['stop', 'db']);
          const down = await checkPostgres(config, { pool });
          expect(down).toMatchObject({ status: 'unreachable' });
          expect(['connection_failed', 'timeout']).toContain(down.reason);
        } finally {
          compose(['start', 'db']);
        }
        let recovered = 'unreachable';
        for (let i = 0; i < 30 && recovered !== 'healthy'; i += 1) {
          await sleep(1000);
          recovered = (await checkPostgres(config, { pool })).status;
        }
        expect(recovered).toBe('healthy');
      },
      90_000,
    );
  },
);
