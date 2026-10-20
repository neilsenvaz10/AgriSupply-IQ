import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Test-only: exposes the application-role connection string from the git-ignored
 * `database/.env` to the PostgreSQL integration tests as TEST_DATABASE_URL (and the wrong-role
 * checks). Deliberately NOT written to DATABASE_URL, so unit tests that call
 * `loadConfig(process.env)` are never affected. Real environment variables win.
 */
const file = fileURLToPath(new URL('../../../../database/.env', import.meta.url));

// A disposable run takes every URL from the provisioned environment and never reads the developer's
// `.env` (incident 2026-10-20). The write-capable migrator URL is never mapped from it at all.
if (process.env['FASALYTICS_DISPOSABLE_DB'] !== '1' && existsSync(file)) {
  const values = parseEnv(readFileSync(file, 'utf8'));
  const mapping = {
    TEST_DATABASE_URL: 'DATABASE_URL', // the read-only application role only
  };
  for (const [target, source] of Object.entries(mapping)) {
    if (process.env[target] === undefined && values[source]) process.env[target] = values[source];
  }
}
