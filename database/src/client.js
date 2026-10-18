import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

/**
 * Creates a Drizzle client over a small `pg` pool.
 *
 * Milestone 8 uses this in tests and verification only. The Express API does not connect to
 * PostgreSQL until Milestone 10.
 *
 * @param {string} connectionString
 * @param {{ max?: number }} [options]
 */
export function createDb(connectionString, options = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 4,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });
  // An idle-client error must not crash the process; surface it on the next query instead.
  pool.on('error', () => undefined);

  return {
    db: drizzle(pool, { schema }),
    pool,
    /** Closes all connections. */
    close: () => pool.end(),
  };
}
