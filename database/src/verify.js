/**
 * Connection, privilege and persistence verification.
 *
 *   npm run db:verify
 *
 * Proves, against the real container, that:
 *  - both application roles can connect, and neither is a superuser;
 *  - migrations are applied and the table exists;
 *  - the application role can read and write data (and the data is really stored);
 *  - the application role CANNOT change the schema or touch the migration journal.
 *
 * It leaves no data behind. Exit code 1 if any check fails.
 */

import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  DatabaseConfigError,
  describeTarget,
  loadDatabaseEnvFile,
  readDatabaseConfig,
  redactSecrets,
} from './config.js';
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from './migrate.js';

/** SQLSTATE for "insufficient_privilege". */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * @typedef {object} CheckResult
 * @property {string} name
 * @property {boolean} ok
 * @property {string} detail
 */

/**
 * @template T
 * @param {string} connectionString
 * @param {(client: pg.Client) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Runs a statement that MUST be refused with `insufficient_privilege`.
 *
 * @param {pg.Client} client
 * @param {string} sql
 * @returns {Promise<{ denied: boolean, detail: string }>}
 */
async function expectDenied(client, sql) {
  try {
    await client.query(sql);
    return { denied: false, detail: 'statement was ALLOWED' };
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    return code === INSUFFICIENT_PRIVILEGE
      ? { denied: true, detail: 'denied (42501 insufficient_privilege)' }
      : { denied: false, detail: `failed with unexpected error ${code ?? 'unknown'}` };
  }
}

/**
 * @param {{ appUrl: string, migrationUrl: string }} urls
 * @returns {Promise<CheckResult[]>}
 */
export async function runVerification({ appUrl, migrationUrl }) {
  /** @type {CheckResult[]} */
  const results = [];
  /** @param {string} name @param {boolean} ok @param {string} detail */
  const record = (name, ok, detail) => results.push({ name, ok, detail });

  // 1. Both roles connect, and neither is a superuser.
  for (const [label, url] of /** @type {const} */ ([
    ['application role connects', appUrl],
    ['migrator role connects', migrationUrl],
  ])) {
    try {
      const row = await withClient(url, async (c) => {
        const r = await c.query(
          'SELECT current_user AS who, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su',
        );
        return r.rows[0];
      });
      record(label, true, `as ${row.who}`);
      record(
        `${label.split(' ')[0]} role is not a superuser`,
        row.su === false,
        `rolsuper=${row.su}`,
      );
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error).code ?? 'error';
      record(label, false, `could not connect [${code}]`);
    }
  }

  // 2. Migrations applied and the table exists.
  try {
    const info = await withClient(migrationUrl, async (c) => {
      const journal = await c.query(
        `SELECT count(*)::int AS n FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
      );
      const table = await c.query("SELECT to_regclass('public.system_metadata') AS t");
      return { applied: journal.rows[0].n, table: table.rows[0].t };
    });
    record('migrations are applied', info.applied >= 1, `${info.applied} recorded in the journal`);
    record('table system_metadata exists', info.table !== null, String(info.table));
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code ?? 'error';
    record('migrations are applied', false, `could not read the journal [${code}]`);
  }

  // 3. The application role stores and reads data, inside a transaction that is rolled back.
  try {
    await withClient(appUrl, async (c) => {
      const key = `verify:${Date.now()}`;
      await c.query('BEGIN');
      try {
        await c.query('INSERT INTO system_metadata (key, value) VALUES ($1, $2)', [key, 'ok']);
        const read = await c.query('SELECT value FROM system_metadata WHERE key = $1', [key]);
        record(
          'application role can write and read',
          read.rows[0]?.value === 'ok',
          'insert + select',
        );
        await c.query('UPDATE system_metadata SET value = $2 WHERE key = $1', [key, 'changed']);
        await c.query('DELETE FROM system_metadata WHERE key = $1', [key]);
        record('application role can update and delete', true, 'update + delete');
      } finally {
        await c.query('ROLLBACK');
      }
    });
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code ?? 'error';
    record('application role can write and read', false, `failed [${code}]`);
  }

  // 4. The application role must NOT be able to change the schema or see the journal.
  const forbidden = [
    ['CREATE TABLE', 'CREATE TABLE public.verify_should_not_exist (id int)'],
    ['ALTER TABLE', 'ALTER TABLE system_metadata ADD COLUMN verify_nope int'],
    ['DROP TABLE', 'DROP TABLE system_metadata'],
    ['TRUNCATE', 'TRUNCATE system_metadata'],
    ['CREATE SCHEMA', 'CREATE SCHEMA verify_nope'],
    ['CREATE ROLE', 'CREATE ROLE verify_nope'],
    [
      'read the migration journal',
      `SELECT * FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" LIMIT 1`,
    ],
  ];
  try {
    await withClient(appUrl, async (c) => {
      for (const [label, sql] of forbidden) {
        const outcome = await expectDenied(c, sql);
        record(`application role cannot ${label}`, outcome.denied, outcome.detail);
      }
    });
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code ?? 'error';
    record('application role privilege checks', false, `could not run [${code}]`);
  }

  // 5. Canonical agricultural schema (Phase 2, Milestone 2.1): the application role gets data
  //    access only. It must not own, alter, drop, truncate or re-define anything.
  try {
    await withClient(appUrl, async (c) => {
      const present = await c.query("SELECT to_regclass('public.mandi_observations') AS t");
      if (present.rows[0].t === null) {
        record('canonical schema is migrated', false, 'public.mandi_observations is missing');
        return;
      }
      record('canonical schema is migrated', true, 'public.mandi_observations exists');

      const canonicalForbidden = [
        ['ALTER a canonical table', 'ALTER TABLE mandi_observations ADD COLUMN verify_nope int'],
        ['DROP a canonical table', 'DROP TABLE mandi_observations'],
        ['TRUNCATE a canonical table', 'TRUNCATE mandi_observations'],
        ['TRUNCATE a registry', 'TRUNCATE states CASCADE'],
        ['DROP a derived view', 'DROP VIEW mandi_observations_normalized'],
        ['CREATE a view', 'CREATE VIEW public.verify_should_not_exist AS SELECT 1'],
        ['DROP a constraint', 'ALTER TABLE mandi_observations DROP CONSTRAINT mandi_obs_nonneg_ck'],
        [
          'DISABLE triggers on a canonical table',
          'ALTER TABLE mandi_observations DISABLE TRIGGER ALL',
        ],
        ['COMMENT on a canonical table', "COMMENT ON TABLE states IS 'changed'"],
        [
          'change a unit conversion',
          "UPDATE measurement_units SET kg_per_unit = 1 WHERE code = 'quintal'",
        ],
        [
          'add a measurement unit',
          "INSERT INTO measurement_units (code, label, dimension, kg_per_unit) VALUES ('verify_nope', 'x', 'mass', 1)",
        ],
        ['delete a measurement unit', "DELETE FROM measurement_units WHERE code = 'kg'"],
      ];
      for (const [label, sql] of canonicalForbidden) {
        const outcome = await expectDenied(c, sql);
        record(`application role cannot ${label}`, outcome.denied, outcome.detail);
      }

      const units = await c.query('SELECT count(*)::int AS n FROM measurement_units');
      record(
        'application role can read measurement units',
        units.rows[0].n >= 1,
        `${units.rows[0].n} units`,
      );

      // Only SELECT/INSERT/UPDATE/DELETE on tables and views; never TRUNCATE, REFERENCES or TRIGGER.
      const grants = await c.query(
        `SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = current_user AND table_schema = 'public' ORDER BY 1`,
      );
      const types = grants.rows.map((r) => r.privilege_type);
      record(
        'application role holds only data-access table privileges',
        types.every((t) => ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(t)),
        types.join(', '),
      );

      const owned = await c.query(
        "SELECT count(*)::int AS n FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND relnamespace = 'public'::regnamespace",
      );
      record(
        'application role owns no relations',
        owned.rows[0].n === 0,
        `${owned.rows[0].n} owned`,
      );

      const seq = await c.query(
        `SELECT has_sequence_privilege(current_user, 'public.ingestion_rejections_id_seq', 'USAGE') AS usage,
                has_sequence_privilege(current_user, 'public.ingestion_rejections_id_seq', 'UPDATE') AS write`,
      );
      record(
        'application role may use but not alter sequences',
        seq.rows[0].usage === true && seq.rows[0].write === false,
        `usage=${seq.rows[0].usage} update=${seq.rows[0].write}`,
      );

      // Data access works through the constraints (rolled back: nothing is stored).
      await c.query('BEGIN');
      try {
        await c.query("INSERT INTO states (name, kind) VALUES ('Verify Temporary State', 'state')");
        const read = await c.query(
          "SELECT count(*)::int AS n FROM states WHERE name = 'Verify Temporary State'",
        );
        record(
          'application role can write and read canonical tables',
          read.rows[0].n === 1,
          'insert + select',
        );
      } finally {
        await c.query('ROLLBACK');
      }
    });
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code ?? 'error';
    record('canonical schema privilege checks', false, `could not run [${code}]`);
  }

  return results;
}

async function main() {
  loadDatabaseEnvFile();
  try {
    const { appUrl, migrationUrl } = readDatabaseConfig(process.env, {
      require: ['appUrl', 'migrationUrl'],
    });
    if (appUrl === null || migrationUrl === null) return;
    console.log(`Verifying ${describeTarget(appUrl)} and ${describeTarget(migrationUrl)}\n`);

    const results = await runVerification({ appUrl, migrationUrl });
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);

    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed.`);
    if (failed > 0) process.exitCode = 1;
  } catch (error) {
    if (error instanceof DatabaseConfigError) {
      console.error(error.message);
    } else {
      console.error(
        `Verification failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      );
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
