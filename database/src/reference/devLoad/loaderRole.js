import { randomBytes } from 'node:crypto';
import { REFERENCE_TABLES } from './fingerprint.js';

/**
 * The dedicated, least-privilege, short-lived login of a controlled development LGD reference load.
 *
 * Lifecycle (an administrator runs it, see docs/geography/LGD_REFERENCE_LOAD_REHEARSAL.md):
 *   1. `provisionLoaderRole` creates the login with a random password and a `VALID UNTIL` equal to the
 *      authorization lifetime, so the credential stops working by itself.
 *   2. The controlled loader connects as that login and refuses to write unless `assertLoaderLeastPrivilege`
 *      finds EXACTLY the privileges below.
 *   3. `revokeLoaderRole` revokes everything and drops the login. It is run whether the load succeeded or not.
 *
 * Exact privileges: CONNECT on the database, USAGE on schemas public and drizzle, SELECT on every table of the
 * schema (needed to verify fingerprints) and on the migration journal, INSERT on the two reference tables.
 * Nothing else: no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER anywhere, no function execution (so no
 * identity or mapping function), no CREATE, no role membership, no role attribute.
 */

export const DEFAULT_LOADER_ROLE = 'fasalytics_ref_loader';
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * @param {import('pg').Client} admin A connection of an administrator (superuser).
 * @param {{ role?: string, validUntil: Date }} options
 * @returns {Promise<{ role: string, password: string }>} The password is returned to the caller, never logged.
 */
export async function provisionLoaderRole(admin, options) {
  const role = options.role ?? DEFAULT_LOADER_ROLE;
  if (!IDENT.test(role)) throw new Error('invalid role name');
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if ((exists.rowCount ?? 0) > 0)
    throw new Error(
      `the role ${role} already exists: revoke it first, a fresh credential is used for each load`,
    );
  const database = (await admin.query('SELECT current_database() AS d')).rows[0].d;
  const password = randomBytes(24).toString('hex');
  const id = admin.escapeIdentifier(role);
  await admin.query('BEGIN');
  try {
    await admin.query(
      `CREATE ROLE ${id} LOGIN PASSWORD ${admin.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 3 VALID UNTIL ${admin.escapeLiteral(options.validUntil.toISOString())}`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(database)} TO ${id}`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${id}`);
    await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${id}`);
    await admin.query(
      `GRANT INSERT ON TABLE ${REFERENCE_TABLES.map((t) => `public.${admin.escapeIdentifier(t)}`).join(', ')} TO ${id}`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA drizzle TO ${id}`);
    await admin.query(`GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO ${id}`);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return { role, password };
}

/**
 * Revokes every privilege of the loader login and drops it. Idempotent.
 * @param {import('pg').Client} admin
 * @param {{ role?: string }} [options]
 */
export async function revokeLoaderRole(admin, options = {}) {
  const role = options.role ?? DEFAULT_LOADER_ROLE;
  if (!IDENT.test(role)) throw new Error('invalid role name');
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if ((exists.rowCount ?? 0) === 0) return { dropped: false };
  const id = admin.escapeIdentifier(role);
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()`,
    [role],
  );
  await admin.query(`DROP OWNED BY ${id}`);
  await admin.query(`DROP ROLE ${id}`);
  return { dropped: true };
}

/**
 * Reads the privileges of the CONNECTED login and returns every deviation from the exact set above.
 * An empty list means the login is acceptable.
 *
 * @param {import('pg').Client} client Connected as the loader login.
 * @returns {Promise<string[]>}
 */
export async function loaderPrivilegeProblems(client) {
  const problems = [];
  const role = (
    await client.query(
      `SELECT current_user AS name, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin,
              rolvaliduntil, (rolvaliduntil IS NOT NULL AND rolvaliduntil > now()) AS valid,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships
         FROM pg_roles r WHERE r.rolname = current_user`,
    )
  ).rows[0];
  if (role.rolsuper) problems.push('the login is a superuser');
  if (role.rolcreaterole) problems.push('the login can create roles');
  if (role.rolcreatedb) problems.push('the login can create databases');
  if (role.rolreplication) problems.push('the login has the replication attribute');
  if (role.rolbypassrls) problems.push('the login bypasses row level security');
  if (!role.rolcanlogin) problems.push('the login cannot log in');
  if (!role.valid) problems.push('the login has no future VALID UNTIL');
  if (role.memberships > 0) problems.push('the login is a member of other roles');

  const tables = (
    await client.query(
      `SELECT c.relname AS name,
              has_table_privilege(current_user, c.oid, 'SELECT') AS sel,
              has_table_privilege(current_user, c.oid, 'INSERT') AS ins,
              has_table_privilege(current_user, c.oid, 'UPDATE') AS upd,
              has_table_privilege(current_user, c.oid, 'DELETE') AS del,
              has_table_privilege(current_user, c.oid, 'TRUNCATE') AS trunc,
              has_table_privilege(current_user, c.oid, 'REFERENCES') AS refs,
              has_table_privilege(current_user, c.oid, 'TRIGGER') AS trig
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') ORDER BY 1`,
    )
  ).rows;
  for (const t of tables) {
    const isReference = REFERENCE_TABLES.includes(t.name);
    if (!t.sel) problems.push(`no SELECT on ${t.name}`);
    if (isReference && !t.ins) problems.push(`no INSERT on ${t.name}`);
    if (!isReference && t.ins) problems.push(`INSERT on ${t.name}`);
    for (const [flag, label] of [
      ['upd', 'UPDATE'],
      ['del', 'DELETE'],
      ['trunc', 'TRUNCATE'],
      ['refs', 'REFERENCES'],
      ['trig', 'TRIGGER'],
    ])
      if (t[flag]) problems.push(`${label} on ${t.name}`);
  }
  for (const needed of REFERENCE_TABLES)
    if (!tables.some((t) => t.name === needed)) problems.push(`table ${needed} does not exist`);

  const sequences = (
    await client.query(
      `SELECT c.relname AS name FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
          AND (has_sequence_privilege(current_user, c.oid, 'USAGE') OR has_sequence_privilege(current_user, c.oid, 'UPDATE'))`,
    )
  ).rows;
  for (const s of sequences) problems.push(`USAGE or UPDATE on sequence ${s.name}`);

  const functions = (
    await client.query(
      `SELECT p.proname AS name FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
          AND p.prorettype <> 'trigger'::regtype AND has_function_privilege(current_user, p.oid, 'EXECUTE')`,
    )
  ).rows;
  for (const f of functions) problems.push(`EXECUTE on function ${f.name}`);

  const create = (
    await client.query(
      `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
              has_database_privilege(current_user, current_database(), 'CREATE') AS db_create`,
    )
  ).rows[0];
  if (create.schema_create) problems.push('CREATE on schema public');
  if (create.db_create) problems.push('CREATE on the database');
  return problems;
}
