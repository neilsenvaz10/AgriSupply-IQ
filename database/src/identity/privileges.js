import pg from 'pg';

/**
 * Privileges of the identity review workflow (Phase 2, Milestone 2.4, Stage 3a).
 *
 * Two GROUP roles take part. They are created by the cluster administrator (database/init does it for a
 * fresh cluster), never by a migration, and they are never login roles:
 *
 *   fasalytics_reviewer   proposes decisions and records review verdicts
 *   fasalytics_approver   accepts or rejects decisions and manages mapping sets
 *
 * What this module grants (idempotent, run as the schema OWNER after the migrations):
 *
 *   - USAGE on the schema and SELECT on the reference and identity relations, so reviewers and approvers can
 *     read what they decide on;
 *   - EXECUTE on exactly the functions of their role. There is NO direct INSERT, UPDATE or DELETE on any
 *     identity table for anybody: the SECURITY DEFINER functions are the only write path, and they identify
 *     the caller with session_user and refuse a login that is a member of both groups.
 *
 * Individual people are login roles that the administrator creates and makes members of ONE group; this
 * module creates no login and no password.
 */

export const REVIEWER_ROLE = 'fasalytics_reviewer';
export const APPROVER_ROLE = 'fasalytics_approver';

export const REVIEWER_FUNCTIONS = [
  'identity_propose(text, text, uuid, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, jsonb, text[], date, date, uuid)',
  'identity_review(uuid, text, text, jsonb)',
  'identity_withdraw(uuid, text)',
];
export const APPROVER_FUNCTIONS = [
  'identity_accept(uuid, uuid)',
  'identity_reject(uuid, text)',
  'mapping_set_create(text, text)',
  'mapping_set_activate(uuid)',
  'mapping_set_deactivate(uuid)',
];
export const READABLE_RELATIONS = [
  'geo_reference_set',
  'admin_unit_version',
  'admin_unit_current',
  'mapping_set',
  'identity_decision',
  'identity_review_event',
  'identity_decision_in_effect',
  'states',
  'districts',
  'markets',
  'data_sources',
  'market_aliases',
  'district_aliases',
  'state_aliases',
];

/**
 * @param {string} migrationUrl Connection string of the schema owner (the migrator).
 * @returns {Promise<{ granted: { reviewer: string[], approver: string[] } }>}
 */
export async function grantIdentityPrivileges(migrationUrl) {
  const client = new pg.Client({ connectionString: migrationUrl, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    for (const role of [REVIEWER_ROLE, APPROVER_ROLE]) {
      const found = await client.query('SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [
        role,
      ]);
      if (found.rowCount === 0) {
        throw new Error(
          `The group role "${role}" does not exist. The cluster administrator creates it (database/init for a fresh cluster).`,
        );
      }
      if (found.rows[0].rolcanlogin) {
        throw new Error(`The group role "${role}" must not be able to log in.`);
      }
    }
    const reviewer = client.escapeIdentifier(REVIEWER_ROLE);
    const approver = client.escapeIdentifier(APPROVER_ROLE);
    await client.query('BEGIN');
    try {
      for (const role of [reviewer, approver]) {
        await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        for (const relation of READABLE_RELATIONS) {
          await client.query(
            `GRANT SELECT ON TABLE public.${client.escapeIdentifier(relation)} TO ${role}`,
          );
        }
        // Nobody writes the tables directly.
        await client.query(
          `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.mapping_set, public.identity_decision, public.identity_review_event, public.geo_reference_set, public.admin_unit_version FROM ${role}`,
        );
      }
      for (const fn of REVIEWER_FUNCTIONS)
        await client.query(`GRANT EXECUTE ON FUNCTION public.${fn} TO ${reviewer}`);
      for (const fn of APPROVER_FUNCTIONS)
        await client.query(`GRANT EXECUTE ON FUNCTION public.${fn} TO ${approver}`);
      // The two roles never hold each other's functions.
      for (const fn of APPROVER_FUNCTIONS)
        await client.query(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM ${reviewer}`);
      for (const fn of REVIEWER_FUNCTIONS)
        await client.query(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM ${approver}`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return { granted: { reviewer: REVIEWER_FUNCTIONS, approver: APPROVER_FUNCTIONS } };
  } finally {
    await client.end();
  }
}
