/**
 * Grants the ingestion role its narrow privileges (run as the MIGRATOR, after the migrations).
 *
 *   npm run db:grant-ingest
 *
 * Reads DATABASE_MIGRATION_URL and the role name from DB_INGEST_USER (default fasalytics_ingest).
 * Prints no credentials. Idempotent. See src/ingest/privileges.js for exactly what is granted.
 */
import { loadDatabaseEnvFile, describeTarget, readDatabaseConfig } from '../src/config.js';
import { grantIngestPrivileges } from '../src/ingest/privileges.js';

loadDatabaseEnvFile();
try {
  const { migrationUrl } = readDatabaseConfig(process.env, { require: ['migrationUrl'] });
  if (migrationUrl === null) throw new Error('DATABASE_MIGRATION_URL is not set.');
  const role = process.env.DB_INGEST_USER ?? 'fasalytics_ingest';
  console.log(
    `Granting ingestion privileges to role "${role}" on ${describeTarget(migrationUrl)} ...`,
  );
  await grantIngestPrivileges(migrationUrl, role);
  console.log(
    'Done: SELECT and INSERT on tables, limited UPDATE on run progress, no DELETE, no DDL.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
