import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { DISPOSABLE_FLAG, DISPOSABLE_TOKEN_ENV, checkDisposable } from './disposable.js';

/**
 * Regression tests for the disposable-database guard. They need no database: the decision logic
 * is exercised with an injected reader, the source is scanned, and a child test run proves that an
 * ordinary invocation cannot migrate or write to whatever database `database/.env` points at.
 */

const TOKEN = 'a'.repeat(48);
const SRC = fileURLToPath(new URL('..', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** @param {Record<string, string>} [extra] */
const env = (extra = {}) => ({
  [DISPOSABLE_FLAG]: '1',
  [DISPOSABLE_TOKEN_ENV]: TOKEN,
  DATABASE_MIGRATION_URL: 'postgresql://m@127.0.0.1:1/x',
  DATABASE_URL: 'postgresql://a@127.0.0.1:1/x',
  ...extra,
});

describe('disposable-database guard: decision logic', () => {
  it('accepts only when both connections carry the same token as the environment', async () => {
    expect(await checkDisposable(env(), async () => TOKEN)).toEqual({ ok: true });
  });

  it('refuses without the disposable flag, however the URLs look', async () => {
    const result = await checkDisposable(env({ [DISPOSABLE_FLAG]: '' }), async () => TOKEN);
    expect(result.ok).toBe(false);
  });

  it('refuses without a token, or with a short one', async () => {
    expect((await checkDisposable(env({ [DISPOSABLE_TOKEN_ENV]: '' }), async () => TOKEN)).ok).toBe(
      false,
    );
    expect(
      (await checkDisposable(env({ [DISPOSABLE_TOKEN_ENV]: 'short' }), async () => 'short')).ok,
    ).toBe(false);
  });

  it('refuses a database that has no identity (like the development database)', async () => {
    const result = await checkDisposable(env(), async () => null);
    expect(result).toMatchObject({ ok: false });
  });

  it('refuses a database whose identity differs from the environment', async () => {
    expect((await checkDisposable(env(), async () => 'b'.repeat(48))).ok).toBe(false);
  });

  it('refuses when only ONE of the two connections is disposable', async () => {
    const read = async (/** @type {string} */ url) =>
      url.includes('@127.0.0.1:1/x') && url.startsWith('postgresql://m') ? TOKEN : null;
    expect((await checkDisposable(env(), read)).ok).toBe(false);
  });

  it('refuses an unreachable database instead of assuming it is safe', async () => {
    const result = await checkDisposable(env(), async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(result.ok).toBe(false);
  });

  it('does not depend on host name or port', async () => {
    const dev = env({ DATABASE_MIGRATION_URL: 'postgresql://m@localhost:5433/fasalytics' });
    expect((await checkDisposable(dev, async () => null)).ok).toBe(false);
    const other = env({ DATABASE_MIGRATION_URL: 'postgresql://m@db.example.org:6543/x' });
    expect((await checkDisposable(other, async () => TOKEN)).ok).toBe(true);
  });
});

describe('every database-writing integration suite is guarded', () => {
  const files = [
    ...readdirSync(SRC).map((f) => f),
    ...readdirSync(`${SRC}ingest`).map((f) => `ingest/${f}`),
  ].filter((f) => f.endsWith('.integration.test.js'));

  it('finds the integration suites', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of files) {
    it(`${file} calls assertDisposable() before it writes`, () => {
      const text = readFileSync(`${SRC}${file}`, 'utf8');
      expect(text).toContain('assertDisposable()');
      // The guard must come before the first migration or insert in the file.
      const guard = text.indexOf('await assertDisposable()');
      expect(guard).toBeGreaterThan(-1);
      for (const risky of ['runMigrations(', 'INSERT INTO', '.insert(', 'loadReferenceSet(']) {
        const at = text.indexOf(risky, text.indexOf('beforeAll'));
        if (at !== -1 && !text.slice(0, at).includes('await assertDisposable()')) {
          throw new Error(`${file}: ${risky} appears before the disposable guard`);
        }
      }
    });
  }

  it('db:migrate stays an explicit command and the test runner never imports it as a side effect', () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
    expect(pkg.scripts['db:migrate']).toBe('node src/migrate.js');
    expect(pkg.scripts.test).not.toMatch(/migrate/);
  });
});

/** @param {string | undefined} url */
async function migrationCount(url) {
  if (!url) return null;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS t");
    if (exists.rows[0].t === null) return 0;
    return (await client.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations'))
      .rows[0].n;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe('an ordinary test run cannot migrate or write to the configured database', () => {
  const url = process.env.DATABASE_MIGRATION_URL;

  /**
   * Runs the Phase 1 database suite in a CHILD process the way `npm test` would (database/.env is
   * loaded by the child's own setup file), but without any disposable identity.
   *
   * @param {Record<string, string>} overrides
   */
  function child(overrides) {
    const base = { ...process.env };
    delete base[DISPOSABLE_FLAG];
    delete base[DISPOSABLE_TOKEN_ENV];
    delete base.REQUIRE_DB;
    delete base.FRESH_DB_BASELINE;
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--reporter=verbose',
        'src/database.integration.test.js',
      ],
      { cwd: ROOT, env: { ...base, ...overrides }, encoding: 'utf8', timeout: 90_000 },
    );
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  it('skips the suite, with the reason, and leaves the migration journal untouched', async () => {
    const before = await migrationCount(url);
    const run = child({});
    expect(run.status).toBe(0);
    expect(run.output).toMatch(/SKIPPED: not a verified disposable database/);
    expect(await migrationCount(url)).toBe(before);
  }, 120_000);

  it('still skips when someone only sets the flag and a made-up token', async () => {
    const before = await migrationCount(url);
    const run = child({ [DISPOSABLE_FLAG]: '1', [DISPOSABLE_TOKEN_ENV]: 'x'.repeat(48) });
    expect(run.status).toBe(0);
    expect(run.output).toMatch(/SKIPPED/);
    expect(await migrationCount(url)).toBe(before);
  }, 120_000);

  it('fails loudly (and writes nothing) under REQUIRE_DB=1 without a disposable identity', async () => {
    const before = await migrationCount(url);
    const run = child({ REQUIRE_DB: '1' });
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/not a verified disposable database/);
    expect(await migrationCount(url)).toBe(before);
  }, 120_000);
});
