import net from 'node:net';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { systemMetadata } from './schema/index.js';
import { shouldRunIntegration } from './test/db.js';
import { runVerification } from './verify.js';

/**
 * Integration tests against the REAL FASALYTICS PostgreSQL container (host port 5433).
 * Skipped (and reported as skipped) when the database is down; set REQUIRE_DB=1 to make them
 * fail instead. They never touch any other PostgreSQL instance.
 */

const appUrl = process.env.DATABASE_URL ?? '';
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? '';

/**
 * @param {string} url
 * @param {{ database?: string, password?: string }} changes
 */
function withChanges(url, changes) {
  const u = new URL(url);
  if (changes.database) u.pathname = `/${changes.database}`;
  if (changes.password) u.password = changes.password;
  return u.toString();
}

/**
 * @param {string} url
 * @returns {Promise<{ ok: true } | { ok: false, code: string | undefined, message: string }>}
 */
async function tryConnect(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: /** @type {{ code?: string }} */ (error).code,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe.runIf(shouldRunIntegration)('PostgreSQL (real container)', () => {
  /** @type {ReturnType<typeof createDb>} */
  let app;
  /** @type {ReturnType<typeof createDb>} */
  let migrator;
  /** @type {string[]} */
  const createdKeys = [];

  beforeAll(async () => {
    await runMigrations(migrationUrl);
    app = createDb(appUrl);
    migrator = createDb(migrationUrl);
  });

  afterAll(async () => {
    // Remove anything these tests created (as the schema owner, regardless of test outcome).
    for (const key of createdKeys) {
      await migrator.db.delete(systemMetadata).where(eq(systemMetadata.key, key));
    }
    await app?.close();
    await migrator?.close();
  });

  describe('migrations', () => {
    it('are applied and the table exists', async () => {
      const result = await migrator.pool.query(
        "SELECT to_regclass('public.system_metadata') AS t, (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS n",
      );
      expect(result.rows[0].t).toBe('system_metadata');
      expect(result.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    it('are repeatable: running again applies nothing', async () => {
      const first = await runMigrations(migrationUrl);
      const second = await runMigrations(migrationUrl);
      expect(first.applied).toBe(0);
      expect(second.applied).toBe(0);
      expect(second.after).toBe(first.after);
    });

    it('are safe when two runners start at once (advisory lock)', async () => {
      const before = (await runMigrations(migrationUrl)).after;
      const results = await Promise.all([runMigrations(migrationUrl), runMigrations(migrationUrl)]);
      for (const r of results) expect(r.after).toBe(before);
    });
  });

  describe('the application role', () => {
    it('stores, reads, updates and deletes data through Drizzle', async () => {
      const key = `test:orm:${Date.now()}`;
      createdKeys.push(key);

      await app.db.insert(systemMetadata).values({ key, value: 'first' });
      const [inserted] = await app.db
        .select()
        .from(systemMetadata)
        .where(eq(systemMetadata.key, key));
      expect(inserted?.value).toBe('first');
      expect(inserted?.updatedAt).toBeInstanceOf(Date);

      await app.db
        .update(systemMetadata)
        .set({ value: 'second' })
        .where(eq(systemMetadata.key, key));
      const [updated] = await app.db
        .select()
        .from(systemMetadata)
        .where(eq(systemMetadata.key, key));
      expect(updated?.value).toBe('second');

      await app.db.delete(systemMetadata).where(eq(systemMetadata.key, key));
      const rows = await app.db.select().from(systemMetadata).where(eq(systemMetadata.key, key));
      expect(rows).toHaveLength(0);
    });

    it('is not a superuser and has no special attributes', async () => {
      const r = await app.pool.query(
        `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
           FROM pg_roles WHERE rolname = current_user`,
      );
      expect(r.rows[0]).toEqual({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
      });
    });

    it('has a statement timeout to bound runaway queries', async () => {
      const r = await app.pool.query('SHOW statement_timeout');
      expect(r.rows[0].statement_timeout).toBe('30s');
    });

    it('has exactly SELECT, INSERT, UPDATE and DELETE on the table', async () => {
      const r = await migrator.pool.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_name = 'system_metadata' AND grantee = $1 ORDER BY 1`,
        [new URL(appUrl).username],
      );
      expect(r.rows.map((row) => row.privilege_type)).toEqual([
        'DELETE',
        'INSERT',
        'SELECT',
        'UPDATE',
      ]);
    });

    it('cannot connect to the maintenance database', async () => {
      const result = await tryConnect(withChanges(appUrl, { database: 'postgres' }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('42501');
    });
  });

  it('passes the full privilege and persistence verification', async () => {
    const results = await runVerification({ appUrl, migrationUrl });
    const failed = results.filter((r) => !r.ok);
    expect(failed).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(15);
  });

  describe('authentication and exposure', () => {
    it('rejects a wrong password without revealing it', async () => {
      const wrong = 'definitely-the-wrong-password';
      const result = await tryConnect(withChanges(appUrl, { password: wrong }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('28P01');
        expect(result.message).not.toContain(wrong);
      }
    });

    it('is bound to loopback only (not reachable on the LAN address)', async () => {
      const lan = Object.values(os.networkInterfaces())
        .flat()
        .find((i) => i && i.family === 'IPv4' && !i.internal);
      if (!lan) return; // no external interface on this machine: nothing to test
      const port = Number(new URL(appUrl).port);
      const reachable = await new Promise((resolve) => {
        const socket = net.connect({ host: lan.address, port, timeout: 2000 });
        socket.once('connect', () => (socket.destroy(), resolve(true)));
        socket.once('timeout', () => (socket.destroy(), resolve(false)));
        socket.once('error', () => resolve(false));
      });
      expect(reachable).toBe(false);
    });
  });
});
