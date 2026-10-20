import { timingSafeEqual } from 'node:crypto';
import pg from 'pg';

/**
 * Disposable-database identity guard for tests that WRITE (seed rows). Same rule as
 * database/src/test/disposable.js: a database is disposable only when a random token exists both in
 * the test environment (FASALYTICS_DISPOSABLE_TOKEN, with FASALYTICS_DISPOSABLE_DB=1) and inside the
 * database itself (`ALTER DATABASE ... SET fasalytics.disposable_token`). Host names and ports prove
 * nothing, and the development database never carries the token, so no environment or `.env` can make
 * these tests write to it. Both the migrator and the application URL must reach a stamped database.
 *
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function checkDisposable(env = process.env) {
  const token = env['FASALYTICS_DISPOSABLE_TOKEN'] ?? '';
  if (env['FASALYTICS_DISPOSABLE_DB'] !== '1' || token.length < 24) {
    return {
      ok: false,
      reason: 'FASALYTICS_DISPOSABLE_DB=1 and FASALYTICS_DISPOSABLE_TOKEN are not set',
    };
  }
  // Every connection string in the environment must reach the disposable database: the two the suite
  // needs, every other named write-capable variable, and any other variable that holds a postgres URL.
  for (const required of ['DATABASE_MIGRATION_URL', 'TEST_DATABASE_URL']) {
    if (!env[required]) return { ok: false, reason: `${required} is not set` };
  }
  const named = [
    'DATABASE_URL',
    'DATABASE_MIGRATION_URL',
    'DATABASE_INGEST_URL',
    'TEST_DATABASE_URL',
    'TEST_DATABASE_MIGRATION_URL',
  ];
  const targets = Object.entries(env)
    .filter(
      ([name, value]) =>
        value && (named.includes(name) || /^postgres(?:ql)?:\/\//i.test(value.trim())),
    )
    .map(([name]) => name);
  for (const name of targets) {
    const url = /** @type {string} */ (env[name]);
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    client.on('error', () => undefined);
    try {
      await client.connect();
      const result = await client.query(
        "SELECT current_setting('fasalytics.disposable_token', true) AS t",
      );
      const found = String(result.rows[0]?.t ?? '');
      const a = Buffer.from(found);
      const b = Buffer.from(token);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return {
          ok: false,
          reason: `the database behind ${name} does not carry this run's disposable identity`,
        };
      }
    } catch {
      return { ok: false, reason: `${name} does not accept connections` };
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  return { ok: true };
}
