import { readdirSync } from 'node:fs';
import { getTableColumns, getTableName } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';
import * as schema from './schema/index.js';
import { shouldRunIntegration } from './test/db.js';
import { assertDisposable } from './test/disposable.js';

/**
 * Fresh-database migration tests.
 *
 * PREREQUISITE: a DISPOSABLE database in which ONLY the Phase 1 baseline (migration 0000) has
 * been applied, plus one marker row in system_metadata. `npm run test:disposable` creates exactly
 * that (a throwaway PostgreSQL container) and sets FRESH_DB_BASELINE=1. These tests are skipped
 * everywhere else, so they can never run against the development database.
 */
const runnable = process.env.FRESH_DB_BASELINE === '1' && shouldRunIntegration;
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? '';
const appUrl = process.env.DATABASE_URL ?? '';

const MARKER_KEY = 'phase1-baseline-marker';
const sqlFiles = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql'));

describe.runIf(runnable)(
  'fresh database: Phase 1 baseline upgraded to the canonical schema',
  () => {
    /** @type {pg.Pool} */
    let migrator;
    /** @type {pg.Pool} */
    let app;
    /** @type {{ before: number, after: number, applied: number }} */
    let first;

    beforeAll(async () => {
      await assertDisposable();
      migrator = new pg.Pool({ connectionString: migrationUrl, max: 2 });
      app = new pg.Pool({ connectionString: appUrl, max: 2 });
    });
    afterAll(async () => {
      await migrator?.end();
      await app?.end();
    });

    it('starts from the Phase 1 baseline only: one migration, the marker row, no canonical tables', async () => {
      const journal = await migrator.query(
        'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
      );
      expect(journal.rows[0].n).toBe(1);
      const marker = await migrator.query('SELECT value FROM system_metadata WHERE key = $1', [
        MARKER_KEY,
      ]);
      expect(marker.rows[0]?.value).toBe('kept');
      const canonical = await migrator.query(
        "SELECT to_regclass('public.mandi_observations') AS t",
      );
      expect(canonical.rows[0].t).toBeNull();
    });

    it('applies every remaining migration from the baseline', async () => {
      first = await runMigrations(migrationUrl);
      expect(first.before).toBe(1);
      expect(first.after).toBe(sqlFiles.length);
      expect(first.applied).toBe(sqlFiles.length - 1);
    });

    it('preserves the existing Phase 1 table and its data', async () => {
      const marker = await migrator.query('SELECT value FROM system_metadata WHERE key = $1', [
        MARKER_KEY,
      ]);
      expect(marker.rows[0]?.value).toBe('kept');
      const columns = await migrator.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'system_metadata' ORDER BY ordinal_position",
      );
      expect(columns.rows.map((r) => r.column_name)).toEqual(['key', 'value', 'updated_at']);
    });

    it('is repeatable: running the migrations again applies nothing', async () => {
      const again = await runMigrations(migrationUrl);
      expect(again.applied).toBe(0);
      expect(again.before).toBe(again.after);
      const third = await runMigrations(migrationUrl);
      expect(third.applied).toBe(0);
    });

    it('creates exactly the tables the Drizzle schema declares (no drift)', async () => {
      const declared = Object.values(schema)
        .map((table) => getTableName(table))
        .sort();
      const actual = await migrator.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
      );
      expect(actual.rows.map((r) => r.table_name)).toEqual(declared);
    });

    it('creates exactly the columns the Drizzle schema declares', async () => {
      for (const table of Object.values(schema)) {
        const declared = Object.values(getTableColumns(table))
          .map((c) => c.name)
          .sort();
        const actual = await migrator.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY 1",
          [getTableName(table)],
        );
        expect(
          actual.rows.map((r) => r.column_name),
          getTableName(table),
        ).toEqual(declared);
      }
    });

    it('inserts NO agricultural data: every registry, fact and provenance table is empty', async () => {
      const tables = Object.values(schema)
        .map((table) => getTableName(table))
        .filter((name) => !['system_metadata', 'measurement_units'].includes(name));
      for (const name of tables) {
        const r = await migrator.query(`SELECT count(*)::int AS n FROM "${name}"`);
        expect(r.rows[0].n, name).toBe(0);
      }
    });

    it('seeds only the documented physical units', async () => {
      const r = await migrator.query('SELECT code FROM measurement_units ORDER BY code');
      expect(r.rows.map((x) => x.code)).toEqual([
        'bundle',
        'kg',
        'nos',
        'quintal',
        'tonne',
        'unit',
      ]);
    });

    it('creates both derived views with invoker security', async () => {
      const views = await migrator.query(
        "SELECT c.relname, c.reloptions FROM pg_class c WHERE c.relkind = 'v' AND c.relnamespace = 'public'::regnamespace ORDER BY 1",
      );
      expect(views.rows.map((v) => v.relname)).toEqual([
        'mandi_observations_normalized',
        'state_observations_normalized',
      ]);
      for (const view of views.rows) expect(view.reloptions).toContain('security_invoker=true');
    });

    it('gives the application role data access only: the migrator owns every relation', async () => {
      const owners = await migrator.query(
        `SELECT DISTINCT pg_get_userbyid(relowner) AS owner FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'v', 'S')`,
      );
      expect(owners.rows).toHaveLength(1);
      const appUser = new URL(appUrl).username;
      expect(owners.rows[0].owner).not.toBe(appUser);

      const ownsNothing = await app.query(
        "SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND pg_get_userbyid(relowner) = current_user",
      );
      expect(ownsNothing.rows[0].n).toBe(0);
    });

    it('leaves the application role read-only on every canonical relation (DML only on system_metadata)', async () => {
      const result = await app.query(
        `SELECT c.relname,
              has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
              has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
              has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
              has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
              has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v') ORDER BY 1`,
      );
      expect(result.rows.length).toBeGreaterThan(20);
      for (const row of result.rows) {
        expect(row.can_select, `${row.relname} select`).toBe(true);
        expect(row.can_truncate, `${row.relname} truncate`).toBe(false);
        const writes = [row.can_insert, row.can_update, row.can_delete];
        if (row.relname === 'system_metadata')
          expect(writes, row.relname).toEqual([true, true, true]);
        else expect(writes, row.relname).toEqual([false, false, false]);
      }
    });
  },
);
