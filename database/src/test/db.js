import pg from 'pg';

/**
 * Whether a real database accepts connections right now.
 *
 * @param {string | undefined} connectionString
 * @returns {Promise<boolean>}
 */
async function canConnect(connectionString) {
  if (!connectionString) return false;
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** True when the migrator and application connections both work. */
export const databaseAvailable =
  (await canConnect(process.env.DATABASE_MIGRATION_URL)) &&
  (await canConnect(process.env.DATABASE_URL));

/**
 * Set REQUIRE_DB=1 to make the integration tests RUN (and therefore FAIL) when the database is
 * down, instead of being reported as skipped.
 */
export const requireDatabase = process.env.REQUIRE_DB === '1';

/** `describe` that runs only when the database is reachable (or REQUIRE_DB=1). */
export const shouldRunIntegration = databaseAvailable || requireDatabase;
