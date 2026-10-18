/**
 * Repeatable migration runner.
 *
 *   npm run db:migrate
 *
 * Connects as the schema-owning `migrator` role (DATABASE_MIGRATION_URL) and applies every
 * pending migration from ./migrations. Safe to run any number of times: already-applied
 * migrations are skipped, and an advisory lock stops two runners from migrating at once.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import {
  DatabaseConfigError,
  describeTarget,
  loadDatabaseEnvFile,
  readDatabaseConfig,
  redactSecrets,
} from './config.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/** Arbitrary constant identifying FASALYTICS migrations to `pg_advisory_lock`. */
const MIGRATION_LOCK_KEY = 827_431_001;

/**
 * @param {pg.Pool} pool
 * @returns {Promise<number>} Number of migrations recorded as applied (0 if never migrated).
 */
async function countApplied(pool) {
  const exists = await pool.query('SELECT to_regclass($1) AS name', [
    `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
  ]);
  if (exists.rows[0]?.name === null) return 0;
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return result.rows[0]?.n ?? 0;
}

/**
 * Applies pending migrations.
 *
 * @param {string} connectionString Migrator-role connection string.
 * @param {{ migrationsFolder?: string }} [options] `migrationsFolder` is for tests that apply a
 *   subset of the history (for example only the Phase 1 baseline); it defaults to ./migrations.
 * @returns {Promise<{ before: number, after: number, applied: number }>}
 */
export async function runMigrations(connectionString, options = {}) {
  // A single connection: the advisory lock below is per-session.
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  pool.on('error', () => undefined);
  try {
    await pool.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const before = await countApplied(pool);
      await migrate(drizzle(pool), {
        migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER,
        migrationsSchema: MIGRATIONS_SCHEMA,
        migrationsTable: MIGRATIONS_TABLE,
      });
      const after = await countApplied(pool);
      return { before, after, applied: after - before };
    } finally {
      await pool.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  loadDatabaseEnvFile();
  try {
    const { migrationUrl } = readDatabaseConfig(process.env, { require: ['migrationUrl'] });
    if (migrationUrl === null) return;
    console.log(`Migrating as ${describeTarget(migrationUrl)} ...`);
    const result = await runMigrations(migrationUrl);
    console.log(
      result.applied === 0
        ? `Database is up to date (${result.after} migration(s) already applied).`
        : `Applied ${result.applied} migration(s); ${result.after} total.`,
    );
  } catch (error) {
    if (error instanceof DatabaseConfigError) {
      console.error(error.message);
    } else {
      const code = /** @type {{ code?: string }} */ (error).code;
      const text = error instanceof Error ? error.message : String(error);
      console.error(`Migration failed${code ? ` [${code}]` : ''}: ${redactSecrets(text)}`);
    }
    process.exitCode = 1;
  }
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
