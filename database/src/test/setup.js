import { loadDatabaseEnvFile } from '../config.js';

/**
 * Integration tests must never inherit a write-capable connection from the developer's git-ignored
 * `database/.env` (incident 2026-10-20: DATABASE_INGEST_URL leaked from it into a "disposable" run and
 * the ingestion tests wrote fixtures into the development database).
 *
 *  - Disposable run (FASALYTICS_DISPOSABLE_DB=1): `.env` is NOT read at all. Every URL must come from the
 *    explicitly provisioned environment, and the guard verifies every one of them.
 *  - Ordinary run: `.env` is read (read-only suites and the CLI scripts need it), but the write-capable
 *    URLs it supplies are removed again, so no suite can write through them. Real environment
 *    variables always win and are left alone.
 */
const WRITE_CAPABLE_FROM_ENV_FILE = ['DATABASE_MIGRATION_URL', 'DATABASE_INGEST_URL'];

if (process.env.FASALYTICS_DISPOSABLE_DB !== '1') {
  const before = new Set(Object.keys(process.env));
  loadDatabaseEnvFile();
  for (const name of WRITE_CAPABLE_FROM_ENV_FILE) {
    if (!before.has(name)) delete process.env[name];
  }
}
