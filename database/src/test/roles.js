import { randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * SYNTHETIC login roles for the identity-workflow tests (Milestone 2.4, Stage 3a).
 *
 * The workflow identifies people by their database login, so testing separation of duties needs several
 * distinct logins. They are created here, with random passwords, through an ADMIN connection to a verified
 * DISPOSABLE database, made members of the two group roles, used, and dropped. They are never real accounts
 * and nothing here is a seed: no reviewer or approver is ever created by a migration or a script of the
 * product. The admin connection comes from DATABASE_ADMIN_URL, which the disposable guard verifies like every
 * other connection string.
 */

/**
 * @param {string} baseUrl Any connection string to the disposable database (the host, port and database are reused).
 * @param {string} user
 * @param {string} password
 */
export function urlFor(baseUrl, user, password) {
  const url = new URL(baseUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

/**
 * @param {import('pg').Pool} admin Pool of a superuser-capable admin connection to the disposable database.
 * @param {string} tag Short unique tag for this test file.
 * @param {Record<string, string | string[] | null>} spec Login key to group role(s), for example
 *        `{ revA: 'fasalytics_reviewer', approver1: 'fasalytics_approver', both: ['fasalytics_reviewer', 'fasalytics_approver'], nobody: null }`.
 */
export async function createLogins(admin, tag, spec) {
  const database = (await admin.query('SELECT current_database() AS d')).rows[0].d;
  const logins = {};
  for (const [key, groups] of Object.entries(spec)) {
    const name = `s3a_${tag}_${key}`.toLowerCase();
    const password = randomBytes(18).toString('hex');
    const client = await admin.connect();
    try {
      await client.query(
        `CREATE ROLE ${client.escapeIdentifier(name)} LOGIN PASSWORD ${client.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await client.query(
        `GRANT CONNECT ON DATABASE ${client.escapeIdentifier(database)} TO ${client.escapeIdentifier(name)}`,
      );
      for (const group of /** @type {string[]} */ (
        [groups].flat().filter((g) => typeof g === 'string')
      )) {
        await client.query(
          `GRANT ${client.escapeIdentifier(group)} TO ${client.escapeIdentifier(name)}`,
        );
      }
    } finally {
      client.release();
    }
    logins[key] = { name, password };
  }
  return {
    logins,
    /** A pool that connects as the login (a distinct session login each). */
    poolFor(baseUrl, key, max = 2) {
      return new pg.Pool({
        connectionString: urlFor(baseUrl, logins[key].name, logins[key].password),
        max,
      });
    },
    async drop() {
      for (const { name } of Object.values(logins)) {
        const client = await admin.connect();
        try {
          const id = client.escapeIdentifier(name);
          await client.query(`DROP OWNED BY ${id}`).catch(() => undefined);
          await client.query(`DROP ROLE IF EXISTS ${id}`);
        } finally {
          client.release();
        }
      }
    },
  };
}
