import pg from 'pg';

/**
 * Privileges of the INGESTION role (Phase 2, Milestone 2.2).
 *
 * The role exists so a bulk importer can load data without the power to change or destroy it:
 *
 *   - SELECT and INSERT on every canonical table (registries, aliases, sources, files, runs,
 *     rejections, conflicts, facts) and on the derived views;
 *   - UPDATE only on the progress columns of `ingestion_runs` (status, counters, checkpoint);
 *   - USAGE/SELECT on sequences (the rejection identity column);
 *   - NO DELETE, NO TRUNCATE, NO DDL, no ownership, no write access to `measurement_units`
 *     (conversion factors) or `system_metadata`.
 *
 * Idempotency and conflict handling need nothing more: duplicates are skipped with
 * `INSERT ... ON CONFLICT DO NOTHING`, conflicting records are INSERTed into
 * `observation_conflicts`, and nothing is ever updated or deleted. Resolving an alias or a
 * conflict is a reviewed action performed by a different role.
 *
 * Run as the MIGRATOR (the owner of the tables) after the migrations. Idempotent.
 */

export const RUN_PROGRESS_COLUMNS = [
  'status',
  'finished_at',
  'rows_read',
  'rows_loaded',
  'rows_exact_duplicate',
  'rows_conflicting',
  'rows_rejected',
  'error_summary',
  'last_committed_row',
];

const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * @param {string} migrationUrl Connection string of the migrator (table owner).
 * @param {string} ingestRole Name of an existing, login-capable ingestion role.
 * @returns {Promise<{ role: string }>}
 */
export async function grantIngestPrivileges(migrationUrl, ingestRole) {
  if (!ROLE_PATTERN.test(ingestRole)) {
    throw new Error('The ingestion role name must be lower-case letters, digits and underscores.');
  }
  const client = new pg.Client({ connectionString: migrationUrl, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ingestRole]);
    if (exists.rowCount === 0) {
      throw new Error(
        `The role "${ingestRole}" does not exist. Create it first (database/docs/INGESTION.md).`,
      );
    }
    const role = client.escapeIdentifier(ingestRole);
    const columns = RUN_PROGRESS_COLUMNS.map((c) => client.escapeIdentifier(c)).join(', ');
    await client.query('BEGIN');
    try {
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ${role}`);
      await client.query(`GRANT UPDATE (${columns}) ON TABLE public.ingestion_runs TO ${role}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      // Tables created by later migrations get the same narrow grant automatically.
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO ${role}`,
      );
      // Reference/system tables stay read-only for the ingestion role.
      await client.query(
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.measurement_units, public.system_metadata FROM ${role}`,
      );
      // Milestone 2.4: identity decisions are made by reviewers and approvers through functions, never by the
      // importer. The blanket grant above must not reach them, whatever the order the scripts are run in. The
      // reference tables (geo_reference_set, admin_unit_version) KEEP the importer's INSERT: that is the loader.
      await client.query(
        `DO $$ DECLARE t text; BEGIN
           FOREACH t IN ARRAY ARRAY['mapping_set', 'identity_decision', 'identity_review_event']
           LOOP
             IF to_regclass('public.' || t) IS NOT NULL THEN
               EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM ${role}', t);
             END IF;
           END LOOP;
         END $$`,
      );
      // Views are derived; nothing is written through them.
      await client.query(
        `DO $$ DECLARE v text; BEGIN
           FOR v IN SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'v'
           LOOP EXECUTE format('REVOKE INSERT ON TABLE public.%I FROM ${role}', v); END LOOP;
         END $$`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return { role: ingestRole };
  } finally {
    await client.end();
  }
}
