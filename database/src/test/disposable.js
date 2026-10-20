import { timingSafeEqual } from 'node:crypto';
import pg from 'pg';

/**
 * Disposable-database identity guard.
 *
 * A database may be written to by the integration tests (migrations, fixtures, deletes) only when
 * it PROVES it is disposable. A host name or port proves nothing: the development database and a
 * throwaway one both live on localhost. The proof is a random token that exists in two places:
 *
 *   1. the environment of the test process   FASALYTICS_DISPOSABLE_TOKEN  (with FASALYTICS_DISPOSABLE_DB=1)
 *   2. the DATABASE itself, as a database-level setting   fasalytics.disposable_token
 *
 * `npm run test:disposable` creates a new container, generates a fresh token and stores it with
 * `ALTER DATABASE ... SET fasalytics.disposable_token`. CI does the same for its own container.
 * The development database never carries the setting, so no environment variable, `.env` file or
 * port number can make the tests treat it as disposable.
 *
 * FAIL CLOSED ON EVERY CONNECTION: the check does not look at a fixed pair of variables. It collects
 * every connection string in the environment (the named variables below AND any other variable whose
 * value is a postgres URL) and requires EVERY ONE of them to reach a database carrying the token.
 * A forgotten or inherited URL (for example DATABASE_INGEST_URL filled in from database/.env) therefore
 * makes the whole run refuse to write instead of silently writing through it. Incident 2026-10-20.
 */

export const DISPOSABLE_FLAG = 'FASALYTICS_DISPOSABLE_DB';
export const DISPOSABLE_TOKEN_ENV = 'FASALYTICS_DISPOSABLE_TOKEN';
export const DISPOSABLE_TOKEN_SETTING = 'fasalytics.disposable_token';
const MIN_TOKEN_LENGTH = 24;

/** Connection variables that can write (or read the schema) and must always be verified when set. */
export const WRITE_CAPABLE_URL_VARS = [
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'DATABASE_INGEST_URL',
  'TEST_DATABASE_URL',
  'TEST_DATABASE_MIGRATION_URL',
];
/** Without these two the suites cannot run at all. */
export const REQUIRED_URL_VARS = ['DATABASE_MIGRATION_URL', 'DATABASE_URL'];

const POSTGRES_URL = /^postgres(?:ql)?:\/\//i;

/**
 * Every connection string the process could use: the named variables that are set, plus ANY other
 * variable whose value looks like a postgres URL (so a new variable cannot bypass the guard).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Array<[string, string]>}
 */
export function collectDatabaseUrls(env) {
  /** @type {Array<[string, string]>} */
  const found = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (WRITE_CAPABLE_URL_VARS.includes(name) || POSTGRES_URL.test(value.trim())) {
      found.push([name, value]);
    }
  }
  return found.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * @typedef {{ ok: true } | { ok: false, reason: string }} DisposableCheck
 */

/**
 * Reads the database-level token of the database behind `url` (null when absent).
 *
 * @param {string} url
 * @returns {Promise<string | null>}
 */
export async function readDatabaseToken(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const result = await client.query('SELECT current_setting($1, true) AS token', [
      DISPOSABLE_TOKEN_SETTING,
    ]);
    const token = result.rows[0]?.token;
    return typeof token === 'string' && token !== '' ? token : null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** @param {string} a @param {string} b */
function sameToken(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Pure decision logic (the database read is injected so it can be tested without a database).
 *
 * @param {Record<string, string | undefined>} env
 * @param {(url: string) => Promise<string | null>} [readToken]
 * @returns {Promise<DisposableCheck>}
 */
export async function checkDisposable(env = process.env, readToken = readDatabaseToken) {
  if (env[DISPOSABLE_FLAG] !== '1') {
    return {
      ok: false,
      reason: `${DISPOSABLE_FLAG}=1 is not set (database integration tests only run against a disposable database)`,
    };
  }
  const token = env[DISPOSABLE_TOKEN_ENV] ?? '';
  if (token.length < MIN_TOKEN_LENGTH) {
    return {
      ok: false,
      reason: `${DISPOSABLE_TOKEN_ENV} is missing or too short (use \`npm run test:disposable\`)`,
    };
  }
  for (const required of REQUIRED_URL_VARS) {
    if (!env[required]) return { ok: false, reason: `${required} is not set` };
  }
  for (const [label, url] of collectDatabaseUrls(env)) {
    let found;
    try {
      found = await readToken(url);
    } catch {
      return { ok: false, reason: `${label} does not accept connections` };
    }
    if (found === null || !sameToken(found, token)) {
      return {
        ok: false,
        reason: `the database behind ${label} does not carry this run's disposable identity (setting ${DISPOSABLE_TOKEN_SETTING})`,
      };
    }
  }
  return { ok: true };
}

/** @type {Promise<DisposableCheck> | undefined} */
let cached;

/** Cached for the test process; the check reads the real environment. */
export function disposableCheck() {
  cached ??= checkDisposable();
  return cached;
}

/**
 * Call as the FIRST statement of every hook that migrates, inserts or deletes. Throws, so nothing
 * is written, when the target is not a verified disposable database.
 */
export async function assertDisposable() {
  const result = await disposableCheck();
  if (!result.ok) {
    throw new Error(
      `Refusing to write: the target is not a verified disposable database: ${result.reason}.`,
    );
  }
}

/**
 * The ONLY way an integration suite obtains a write-capable connection string. It re-verifies, at the
 * moment of use, that the database behind THIS variable carries the disposable identity, so a suite
 * can never open a pool on a URL that was not itself proven disposable.
 *
 * @param {string} name e.g. 'DATABASE_INGEST_URL'
 * @param {Record<string, string | undefined>} [env]
 * @param {(url: string) => Promise<string | null>} [readToken]
 * @returns {Promise<string>}
 */
export async function guardedUrl(name, env = process.env, readToken = readDatabaseToken) {
  const result = await checkDisposable(env, readToken);
  if (!result.ok) {
    throw new Error(
      `Refusing to connect with ${name}: the target is not a verified disposable database: ${result.reason}.`,
    );
  }
  const url = env[name];
  if (!url) throw new Error(`${name} is not set.`);
  return url;
}
