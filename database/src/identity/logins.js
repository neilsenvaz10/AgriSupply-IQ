import { randomBytes } from 'node:crypto';

/**
 * Provisioning and revocation of the personal logins of human reviewers and approvers (Milestone 2.4, Stage 3c).
 *
 * One person, one login, one group. The login name is built from a fixed prefix and the person's identifier, so
 * the audit log (which records `session_user`) names the person. Nothing here is run by the product: an
 * administrator runs it with an explicit administrator connection after the authorization gate for real logins.
 * It creates no password policy beyond a random 192-bit password written to an owner-only file by the command line.
 *
 * Each login:
 *   - can log in, with CONNECTION LIMIT 2 and a VALID UNTIL (the credential expires by itself);
 *   - has no superuser, create-role, create-database, replication or bypass-RLS attribute;
 *   - is a member of exactly ONE of fasalytics_reviewer / fasalytics_approver, granted WITH INHERIT TRUE and
 *     SET FALSE (it uses the group's EXECUTE and SELECT, but cannot SET ROLE into the group or any other role);
 *   - holds nothing else: no write privilege on any table, no function outside its group.
 */

export const GROUPS = Object.freeze({
  reviewer: { group: 'fasalytics_reviewer', prefix: 'fasalytics_rv_' },
  approver: { group: 'fasalytics_approver', prefix: 'fasalytics_ap_' },
});
export const MAX_VALID_DAYS = 90;
const PERSON = /^[a-z][a-z0-9]{1,24}$/;

/**
 * @param {string} person
 * @param {'reviewer' | 'approver'} kind
 */
export const loginName = (person, kind) => {
  if (!PERSON.test(person))
    throw new Error(
      'the person identifier is 2-25 lower-case letters and digits, starting with a letter',
    );
  if (!GROUPS[kind]) throw new Error('the group is reviewer or approver');
  return `${GROUPS[kind].prefix}${person}`;
};

/** @param {string} name */
const personOf = (name) => name.replace(/^fasalytics_(rv|ap)_/, '');

/**
 * @param {import('pg').Client} admin A superuser connection to the database the logins will use.
 * @param {{ person: string, kind: 'reviewer' | 'approver', validUntil: Date }} options
 * @returns {Promise<{ role: string, password: string }>} The password is for the credential file, never for a log.
 */
export async function provisionReviewLogin(admin, { person, kind, validUntil }) {
  const role = loginName(person, kind);
  const days = (validUntil.getTime() - Date.now()) / 86_400_000;
  if (!(days > 0) || days > MAX_VALID_DAYS)
    throw new Error(`a login is valid for more than 0 and at most ${MAX_VALID_DAYS} days`);
  for (const k of /** @type {const} */ (['reviewer', 'approver'])) {
    const other = loginName(person, k);
    const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [other]);
    if ((exists.rowCount ?? 0) > 0)
      throw new Error(`${other} exists: one person has one login in one group`);
  }
  for (const g of Object.values(GROUPS)) {
    const found = await admin.query('SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [
      g.group,
    ]);
    if (found.rowCount === 0) throw new Error(`the group role ${g.group} does not exist`);
    if (found.rows[0].rolcanlogin)
      throw new Error(`the group role ${g.group} must not be able to log in`);
  }
  const database = (await admin.query('SELECT current_database() AS d')).rows[0].d;
  const password = randomBytes(24).toString('hex');
  const id = admin.escapeIdentifier(role);
  await admin.query('BEGIN');
  try {
    await admin.query(
      `CREATE ROLE ${id} LOGIN PASSWORD ${admin.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 VALID UNTIL ${admin.escapeLiteral(validUntil.toISOString())}`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(database)} TO ${id}`);
    await admin.query(
      `GRANT ${admin.escapeIdentifier(GROUPS[kind].group)} TO ${id} WITH INHERIT TRUE, SET FALSE`,
    );
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return { role, password };
}

/**
 * Ends a person's access: terminates their sessions, drops their login. The audit log keeps their name as text.
 * @param {import('pg').Client} admin
 * @param {string} role
 */
export async function revokeReviewLogin(admin, role) {
  if (!/^fasalytics_(rv|ap)_[a-z][a-z0-9]{1,24}$/.test(role))
    throw new Error('not a review login name');
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if ((exists.rowCount ?? 0) === 0) return { dropped: false };
  const id = admin.escapeIdentifier(role);
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()',
    [role],
  );
  await admin.query(`DROP OWNED BY ${id}`);
  await admin.query(`DROP ROLE ${id}`);
  return { dropped: true };
}

/**
 * The review logins that exist, with their group and expiry.
 * @param {import('pg').Client} admin
 */
export async function listReviewLogins(admin) {
  const rows = (
    await admin.query(
      `SELECT r.rolname AS role, g.rolname AS "group", r.rolcanlogin AS can_login, r.rolvaliduntil::text AS valid_until,
              r.rolconnlimit AS connection_limit, m.inherit_option, m.set_option
         FROM pg_roles r
         LEFT JOIN pg_auth_members m ON m.member = r.oid
         LEFT JOIN pg_roles g ON g.oid = m.roleid AND g.rolname IN ('fasalytics_reviewer', 'fasalytics_approver')
        WHERE r.rolname ~ '^fasalytics_(rv|ap)_' ORDER BY r.rolname`,
    )
  ).rows;
  return rows.map((r) => ({ ...r, person: personOf(r.role) }));
}

/**
 * Emergency revocation: every review login at once.
 * @param {import('pg').Client} admin
 */
export async function revokeAllReviewLogins(admin) {
  const done = [];
  for (const { role } of await listReviewLogins(admin))
    if ((await revokeReviewLogin(admin, role)).dropped) done.push(role);
  return done;
}

/**
 * Deviations of the connected login from the access design (an empty list means it conforms).
 * @param {import('pg').Client} client Connected as the review login.
 */
export async function reviewLoginProblems(client) {
  const problems = [];
  const me = (
    await client.query(
      `SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls, r.rolcanlogin,
              (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil > now()) AS valid,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships,
              (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                WHERE m.member = r.oid AND g.rolname IN ('fasalytics_reviewer', 'fasalytics_approver') AND m.inherit_option AND NOT m.set_option) AS good_memberships,
              has_table_privilege(current_user, 'public.identity_decision', 'INSERT, UPDATE, DELETE, TRUNCATE') AS writes_decisions,
              has_table_privilege(current_user, 'public.identity_review_event', 'INSERT, UPDATE, DELETE, TRUNCATE') AS writes_audit,
              has_table_privilege(current_user, 'public.markets', 'INSERT, UPDATE, DELETE, TRUNCATE') AS writes_markets,
              has_table_privilege(current_user, 'public.mandi_observations', 'INSERT, UPDATE, DELETE, TRUNCATE') AS writes_observations
         FROM pg_roles r WHERE r.rolname = current_user`,
    )
  ).rows[0];
  for (const k of [
    'rolsuper',
    'rolcreaterole',
    'rolcreatedb',
    'rolreplication',
    'rolbypassrls',
    'writes_decisions',
    'writes_audit',
    'writes_markets',
    'writes_observations',
  ])
    if (me[k]) problems.push(k);
  if (!me.valid) problems.push('no future expiry');
  if (me.memberships !== 1 || me.good_memberships !== 1)
    problems.push('not a member of exactly one group with INHERIT and no SET');
  return problems;
}
