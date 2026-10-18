import pg from 'pg';

/**
 * The single PostgreSQL connection pool of the Express API.
 *
 * - Connects with `DATABASE_URL`, which must be the least-privilege application role
 *   (`fasalytics_app`). Migration and administrative credentials never reach this process.
 * - Bounded: maximum connections, connection timeout, idle timeout and per-statement timeout
 *   (enforced both by the client and, via `statement_timeout`, by the server).
 * - Created ONCE by `startServer` and injected where needed; nothing here runs at import time,
 *   and nothing connects until the first query (so the API starts even if the database is down).
 */

/**
 * The part of `pg.Pool` this API uses. Tests inject a fake with this shape.
 *
 * @typedef {object} PoolLike
 * @property {() => Promise<import('pg').PoolClient>} connect
 * @property {() => Promise<void>} end
 * @property {(event: any, listener: any) => unknown} on
 * @property {number} [totalCount]
 * @property {number} [idleCount]
 * @property {number} [waitingCount]
 */

/**
 * @typedef {object} DatabasePool
 * @property {PoolLike} pool
 * @property {() => Promise<void>} close Ends the pool once; later calls return the same promise.
 */

/**
 * @typedef {object} PoolDeps
 * @property {new (options: import('pg').PoolConfig) => PoolLike} [PoolClass] Injectable for tests.
 * @property {import('../utils/logger.js').Logger} [logger]
 */

/**
 * @param {Pick<import('../config/env.js').AppConfig, 'databaseUrl' | 'databasePool'>} config
 * @param {PoolDeps} [deps]
 * @returns {DatabasePool}
 */
export function createDatabasePool(config, deps = {}) {
  if (config.databaseUrl === null) {
    throw new Error('createDatabasePool requires DATABASE_URL to be configured.');
  }
  const PoolClass = deps.PoolClass ?? pg.Pool;
  const { max, connectionTimeoutMs, idleTimeoutMs, queryTimeoutMs } = config.databasePool;
  const pool = new PoolClass({
    connectionString: config.databaseUrl,
    max,
    connectionTimeoutMillis: connectionTimeoutMs,
    idleTimeoutMillis: idleTimeoutMs,
    // Client-side deadline, and a server-side cap so a stuck statement cannot keep running.
    query_timeout: queryTimeoutMs,
    statement_timeout: queryTimeoutMs,
    application_name: 'fasalytics-api',
    allowExitOnIdle: false,
  });

  // An idle connection can die (database restart, network). Without a listener, `pg` re-throws
  // this event and crashes the process. Log the SQLSTATE/errno only, never the message.
  pool.on('error', (error) => {
    deps.logger?.warn('idle database connection failed', {
      code: /** @type {{ code?: string }} */ (error).code ?? 'unknown',
    });
  });

  // The same failure can hit a connection that is currently checked out (a probe or query in
  // flight). The client then emits 'error' directly; with no listener Node would treat it as an
  // uncaught exception and crash the API. The caller of the query still receives the failure.
  pool.on('connect', (/** @type {import('pg').PoolClient} */ client) => {
    client.on('error', (error) => {
      deps.logger?.warn('database connection failed', {
        code: /** @type {{ code?: string }} */ (error).code ?? 'unknown',
      });
    });
  });

  /** @type {Promise<void> | undefined} */
  let closing;
  const close = () => {
    closing ??= pool.end().catch((error) => {
      deps.logger?.warn('error while closing the database pool', {
        code: /** @type {{ code?: string }} */ (error).code ?? 'unknown',
      });
    });
    return closing;
  };
  return { pool, close };
}
