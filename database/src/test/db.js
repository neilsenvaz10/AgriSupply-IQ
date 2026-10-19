import { describe } from 'vitest';
import { disposableCheck } from './disposable.js';

/**
 * Integration tests write (migrations, fixtures, deletes), so they run ONLY against a database that
 * proves it is disposable (see ./disposable.js). Otherwise they are reported as SKIPPED, with the
 * reason in the suite name, and nothing is written. The development database is never such a
 * target, even when `database/.env` points at it.
 *
 * REQUIRE_DB=1 (used by `test:disposable` and CI) turns a missing disposable database into a
 * FAILURE instead of a skip; it still never lets a test write to an unverified database, because
 * every integration suite calls `assertDisposable()` before its first write.
 */
const check = await disposableCheck();

/** True when the target is a verified disposable database. */
export const databaseAvailable = check.ok;

export const requireDatabase = process.env.REQUIRE_DB === '1';

/** Run the suite when the target is verified, or (to fail loudly) when REQUIRE_DB=1. */
export const shouldRunIntegration = check.ok || requireDatabase;

/** Explanation shown in the name of a skipped suite. */
export const skipReason = check.ok
  ? ''
  : `SKIPPED: not a verified disposable database (${check.reason}); run \`npm run test:disposable\``;

/**
 * `describe` for database-writing integration suites.
 *
 * @param {string} name
 * @param {() => void} fn
 * @param {boolean} [extraCondition]
 */
export function describeIntegration(name, fn, extraCondition = true) {
  if (shouldRunIntegration && extraCondition) return describe(name, fn);
  return describe.skip(extraCondition ? `${name} [${skipReason}]` : name, fn);
}
