/**
 * Grants the identity review workflow its privileges (run as the MIGRATOR, after the migrations).
 *
 *   npm run db:grant-identity
 *
 * Reads DATABASE_MIGRATION_URL. Idempotent. Prints no credentials. Creates no login and no password:
 * it only grants SELECT and EXECUTE to the two group roles fasalytics_reviewer and fasalytics_approver.
 */
import { loadDatabaseEnvFile, describeTarget, readDatabaseConfig } from '../src/config.js';
import { grantIdentityPrivileges } from '../src/identity/privileges.js';

loadDatabaseEnvFile();
try {
  const { migrationUrl } = readDatabaseConfig(process.env, { require: ['migrationUrl'] });
  if (migrationUrl === null) throw new Error('DATABASE_MIGRATION_URL is not set.');
  console.log(`Granting identity workflow privileges on ${describeTarget(migrationUrl)} ...`);
  const result = await grantIdentityPrivileges(migrationUrl);
  console.log(
    `Done: reviewer role may execute ${result.granted.reviewer.length} functions, approver role ${result.granted.approver.length}; no direct table writes for anyone.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
