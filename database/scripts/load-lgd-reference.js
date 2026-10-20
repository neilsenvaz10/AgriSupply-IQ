/**
 * Loads the OFFICIAL LGD reference (Milestone 2.4, Stage 3a) into geo_reference_set / admin_unit_version.
 *
 *   node scripts/load-lgd-reference.js --dir <reference-data-dir> --plan-only
 *   node scripts/load-lgd-reference.js --dir <reference-data-dir> [--url-env DATABASE_INGEST_URL]
 *
 * --plan-only parses the raw files and prints what WOULD be loaded: it opens no database connection.
 *
 * A real load writes, so it runs ONLY against a verified disposable database: the same fail-closed guard as
 * the integration tests (FASALYTICS_DISPOSABLE_DB=1, FASALYTICS_DISPOSABLE_TOKEN and EVERY connection string
 * in the environment must reach a database carrying that identity). The development database never does, so
 * this script cannot load it. A development load needs its own reviewed procedure and approval.
 *
 * Raw files stay outside Git and are never modified. Idempotent: loading the same files again is a no-op.
 * No registry row, alias, mandi or observation is changed and no geographic correction is applied.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { loadDatabaseEnvFile } from '../src/config.js';
import { loadReferencePlan } from '../src/reference/lgdLoad.js';
import { buildLgdPlan } from '../src/reference/lgdPlan.js';
import { checkDisposable } from '../src/test/disposable.js';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    'plan-only': { type: 'boolean', default: false },
    'url-env': { type: 'string', default: 'DATABASE_INGEST_URL' },
  },
});
if (!values.dir) {
  console.error('--dir <reference-data-dir> is required');
  process.exit(2);
}
const summarise = (plan) =>
  plan.sets
    .map(
      (s) =>
        `  ${s.code}: ${s.units.length} unit rows, fingerprint ${s.fileSha256.slice(0, 12)}… (${s.fingerprintKind})`,
    )
    .join('\n');

try {
  if (values['plan-only']) {
    const plan = buildLgdPlan(values.dir);
    console.log(`Plan (no database was contacted):\n${summarise(plan)}`);
    for (const w of plan.warnings) console.log(`  warning: ${w}`);
  } else {
    // A disposable run never reads the developer .env (see src/test/setup.js for the same rule).
    if (process.env.FASALYTICS_DISPOSABLE_DB !== '1') loadDatabaseEnvFile();
    const verdict = await checkDisposable();
    if (!verdict.ok) {
      console.error(
        `Refusing to load: the target is not a verified disposable database: ${verdict.reason}.`,
      );
      process.exit(3);
    }
    const url = process.env[values['url-env']];
    if (!url) throw new Error(`${values['url-env']} is not set`);
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
      const registry = await pool.query(
        `SELECT d.lgd_code::int AS district, s.lgd_code::int AS state FROM districts d JOIN states s ON s.id = d.state_id WHERE d.lgd_code ~ '^[0-9]+$' AND s.lgd_code ~ '^[0-9]+$'`,
      );
      const plan = buildLgdPlan(values.dir, {
        extraParents: new Map(registry.rows.map((r) => [r.district, r.state])),
      });
      console.log(`Plan:\n${summarise(plan)}`);
      for (const w of plan.warnings) console.log(`  warning: ${w}`);
      for (const r of await loadReferencePlan(pool, plan))
        console.log(`  ${r.status}: ${r.code} (${r.units} rows)`);
    } finally {
      await pool.end();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
