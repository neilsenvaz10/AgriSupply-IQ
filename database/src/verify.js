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
 * @param {{ appUrl: string, migrationUrl: string, ingestUrl?: string | null }} urls
 * @returns {Promise<CheckResult[]>}
 */
export async function runVerification({ appUrl, migrationUrl, ingestUrl = null }) {
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

      // Only SELECT on canonical relations (DML remains only on system_metadata); never TRUNCATE,
      // REFERENCES or TRIGGER anywhere.
      const grants = await c.query(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
          WHERE grantee = current_user AND table_schema = 'public' ORDER BY 1, 2`,
      );
      const writable = grants.rows.filter(
        (r) => r.privilege_type !== 'SELECT' && r.table_name !== 'system_metadata',
      );
      record(
        'application role is read-only on every canonical relation',
        writable.length === 0,
        writable.length === 0
          ? 'SELECT only'
          : `writable: ${writable.map((r) => r.table_name).join(', ')}`,
      );
      const types = [...new Set(grants.rows.map((r) => r.privilege_type))];
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

      // Since Milestone 2.2 the application role only READS agricultural data; ingestion uses a
      // separate, narrower role. Every canonical relation must refuse writes from this role.
      const writes = [
        [
          'INSERT into a registry',
          "INSERT INTO states (name, kind) VALUES ('Verify Temporary State', 'state')",
        ],
        ['UPDATE a registry', 'UPDATE states SET is_active = false'],
        ['DELETE from a registry', 'DELETE FROM commodities'],
        ['INSERT an observation', 'INSERT INTO mandi_observations (market_id) VALUES (NULL)'],
        ['UPDATE an observation', 'UPDATE mandi_observations SET modal_price = 0'],
        ['DELETE an observation', 'DELETE FROM state_observations'],
        ['UPDATE a WPI observation', 'UPDATE wpi_observations SET index_value = 1'],
        ['DELETE provenance (source files)', 'DELETE FROM source_files'],
        ['UPDATE an ingestion run', "UPDATE ingestion_runs SET status = 'succeeded'"],
        ['DELETE quarantined records', 'DELETE FROM ingestion_rejections'],
        ['UPDATE a conflict record', "UPDATE observation_conflicts SET status = 'dismissed'"],
        ['UPDATE an alias decision', "UPDATE state_aliases SET resolution_status = 'resolved'"],
      ];
      for (const [label, sql] of writes) {
        const outcome = await expectDenied(c, sql);
        record(`application role cannot ${label}`, outcome.denied, outcome.detail);
      }
      const readable = await c.query('SELECT count(*)::int AS n FROM states');
      record('application role can read canonical tables', readable.rows[0].n >= 0, 'select');
    });
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code ?? 'error';
    record('canonical schema privilege checks', false, `could not run [${code}]`);
  }

  // 6. The ingestion role (when configured): enough to load data, nothing to change or destroy it.
  if (ingestUrl) {
    try {
      await withClient(ingestUrl, async (c) => {
        const who = await c.query(
          'SELECT current_user AS u, (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = current_user) AS powerful',
        );
        record(
          'ingestion role connects and is not privileged',
          who.rows[0].powerful === false,
          `as ${who.rows[0].u}`,
        );

        const denied = [
          ['DELETE from a fact table', 'DELETE FROM mandi_observations'],
          ['DELETE from a registry', 'DELETE FROM states'],
          ['DELETE quarantined records', 'DELETE FROM ingestion_rejections'],
          ['UPDATE a fact table', 'UPDATE mandi_observations SET modal_price = 0'],
          ['UPDATE a registry', 'UPDATE states SET is_active = false'],
          ['UPDATE an alias decision', "UPDATE state_aliases SET resolution_status = 'resolved'"],
          ['UPDATE a conflict record', "UPDATE observation_conflicts SET status = 'dismissed'"],
          ['UPDATE the run source or file', 'UPDATE ingestion_runs SET source_id = source_id'],
          ['TRUNCATE a fact table', 'TRUNCATE mandi_observations'],
          ['change a unit conversion', 'UPDATE measurement_units SET kg_per_unit = 1'],
          [
            'add a measurement unit',
            "INSERT INTO measurement_units (code, label, dimension, kg_per_unit) VALUES ('verify_nope', 'x', 'mass', 1)",
          ],
          [
            'write system_metadata',
            "INSERT INTO system_metadata (key, value) VALUES ('verify_nope', 'x')",
          ],
          ['CREATE TABLE', 'CREATE TABLE public.verify_ingest_nope (id int)'],
          ['ALTER a canonical table', 'ALTER TABLE mandi_observations ADD COLUMN verify_nope int'],
          ['DROP a canonical table', 'DROP TABLE mandi_observations'],
          ['CREATE ROLE', 'CREATE ROLE verify_nope'],
          [
            'read the migration journal',
            `SELECT * FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" LIMIT 1`,
          ],
        ];
        for (const [label, sql] of denied) {
          const outcome = await expectDenied(c, sql);
          record(`ingestion role cannot ${label}`, outcome.denied, outcome.detail);
        }

        // What it MUST be able to do (all rolled back).
        await c.query('BEGIN');
        try {
          const state = await c.query(
            "INSERT INTO states (name, kind) VALUES ('Verify Ingest State', 'state') RETURNING id",
          );
          const src = await c.query(
            "INSERT INTO data_sources (code, name, source_type) VALUES ('verify_ingest_src', 'verify', 'other') RETURNING id",
          );
          const run = await c.query(
            "INSERT INTO ingestion_runs (source_id, importer_name, importer_version) VALUES ($1, 'verify', '0') RETURNING id",
            [src.rows[0].id],
          );
          await c.query(
            'UPDATE ingestion_runs SET rows_read = 5, rows_rejected = 5, last_committed_row = 5 WHERE id = $1',
            [run.rows[0].id],
          );
          const rej = await c.query(
            `INSERT INTO ingestion_rejections (ingestion_run_id, source_row_number, reason_code, raw_record, raw_record_sha256)
             VALUES ($1, 1, 'other', '{}'::jsonb, repeat('a', 64)) RETURNING id`,
            [run.rows[0].id],
          );
          const read = await c.query('SELECT count(*)::int AS n FROM states WHERE id = $1', [
            state.rows[0].id,
          ]);
          record(
            'ingestion role can insert registry, source, run and quarantine rows, update run progress, and read back',
            read.rows[0].n === 1 && Number(rej.rows[0].id) > 0,
            'insert + progress update + identity sequence + select',
          );
        } finally {
          await c.query('ROLLBACK');
        }
      });
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error).code ?? 'error';
      record('ingestion role privilege checks', false, `could not run [${code}]`);
    }
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

    const ingestUrl = process.env.DATABASE_INGEST_URL?.trim() || null;
    const results = await runVerification({ appUrl, migrationUrl, ingestUrl });
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
