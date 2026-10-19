import { HttpError } from '../utils/httpError.js';

/**
 * Read-only access to PostgreSQL for the historical market endpoints.
 *
 * Every request runs inside `BEGIN READ ONLY ... ROLLBACK`, on top of the application role
 * (`fasalytics_app`), which only has SELECT on the canonical tables. Two independent guards: the
 * transaction refuses writes (SQLSTATE 25006) and the role would refuse them (42501).
 *
 * @typedef {import('pg').PoolClient} Client
 */

/**
 * Maps a driver error to a client-safe HTTP error. Messages never contain SQL, values or paths.
 *
 * @param {unknown} error
 * @returns {Error}
 */
export function mapDatabaseError(error) {
  if (error instanceof HttpError) return error;
  const e = /** @type {{ code?: string, message?: string }} */ (
    typeof error === 'object' && error !== null ? error : {}
  );
  const code = String(e.code ?? '');
  if (code === '57014' || /timeout|timed out/i.test(String(e.message ?? ''))) {
    return new HttpError(503, 'DEPENDENCY_TIMEOUT', 'The database did not answer in time.');
  }
  if (
    code.startsWith('08') ||
    code.startsWith('57P') ||
    code === '53300' ||
    ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code)
  ) {
    return new HttpError(503, 'DEPENDENCY_UNREACHABLE', 'The database is not reachable.');
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

/**
 * @template T
 * @param {import('../database/pool.js').PoolLike | undefined} pool
 * @param {(client: Client) => Promise<T>} work
 * @param {{ timeoutMs?: number }} [options] `timeoutMs` raises the server-side statement timeout
 *   for this transaction only (used by the cached coverage aggregates).
 * @returns {Promise<T>}
 */
export async function readOnly(pool, work, options = {}) {
  if (!pool) {
    throw new HttpError(503, 'DEPENDENCY_UNREACHABLE', 'The database is not configured.');
  }
  /** @type {Client | undefined} */
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    if (options.timeoutMs) {
      await client.query(`SET LOCAL statement_timeout = ${Math.trunc(options.timeoutMs)}`);
    }
    try {
      return await work(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }
  } catch (error) {
    throw mapDatabaseError(error);
  } finally {
    client?.release();
  }
}

/**
 * @param {Client} client
 * @param {string} text
 * @param {unknown[]} [values]
 * @returns {Promise<any[]>}
 */
export async function rows(client, text, values = []) {
  return (await client.query(text, values)).rows;
}
