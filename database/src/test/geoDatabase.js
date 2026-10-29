import pg from 'pg';
import { runMigrations } from '../migrate.js';
import { WORLD, worldRows } from './geoFixtures.js';

/**
 * A fresh, migrated DATABASE of its own on a verified disposable server, holding a synthetic geography (see
 * geoFixtures.js). Callers must have passed `assertDisposable()` first. Everything is dropped by `drop()`.
 *
 * @param {object} options
 * @param {string} options.adminUrl connection string of the administrator (from `guardedUrl`)
 * @param {string} options.migrationUrl connection string of the migrator (from `guardedUrl`)
 * @param {string} options.database name of the new database
 * @param {typeof WORLD} [options.world]
 */
export async function createGeoDatabase({ adminUrl, migrationUrl, database, world = WORLD }) {
  const urlFor = (/** @type {string} */ base) => {
    const url = new URL(base);
    url.pathname = `/${database}`;
    return url.toString();
  };
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const migrator = new URL(migrationUrl).username;
  await admin.query(`CREATE DATABASE ${database} OWNER ${migrator}`);
  await admin.query(
    `ALTER DATABASE ${database} SET fasalytics.disposable_token = '${process.env.FASALYTICS_DISPOSABLE_TOKEN}'`,
  );
  const ownerUrl = urlFor(migrationUrl);
  await runMigrations(ownerUrl);
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 4 });
  const adminDb = new pg.Pool({ connectionString: urlFor(adminUrl), max: 3 });
  const w = worldRows(world);
  await owner.query(
    `INSERT INTO data_sources (id, code, name, source_type) VALUES ($1, $2, 'Synthetic source A', 'other')`,
    [w.sourceId, world.sourceCode],
  );
  for (const s of w.states)
    await owner.query(
      `INSERT INTO states (id, name, kind, lgd_code, is_active) VALUES ($1, $2, $3, $4, true)`,
      [s.id, s.name, s.kind, s.lgd_code],
    );
  for (const d of w.districts)
    await owner.query(
      `INSERT INTO districts (id, state_id, name, lgd_code, is_active) VALUES ($1, $2, $3, $4, true)`,
      [d.id, d.state_id, d.name, d.lgd_code],
    );
  for (const a of w.stateAliases)
    await owner.query(
      `INSERT INTO state_aliases (id, source_id, source_key, source_label, state_id, resolution_status, resolved_at) VALUES ($1, $2, $3, $4, $5, $6, ${a.state_id ? 'now()' : 'NULL'})`,
      [a.id, a.source_id, a.source_key, a.source_label, a.state_id, a.resolution_status],
    );
  for (const a of w.districtAliases)
    await owner.query(
      `INSERT INTO district_aliases (id, source_id, source_key, source_label, source_context, resolution_status) VALUES ($1, $2, $3, $4, $5, 'unresolved')`,
      [a.id, a.source_id, a.source_key, a.source_label, a.source_context],
    );
  for (const m of w.markets) {
    await owner.query(
      `INSERT INTO markets (id, state_id, name, status) VALUES ($1, $2, $3, 'unverified')`,
      [m.id, m.state_id, m.name],
    );
    await owner.query(
      `INSERT INTO market_aliases (source_id, source_key, source_label, source_context, market_id, resolution_status, resolved_at) VALUES ($1, $2, $3, $4, $5, 'resolved', now())`,
      [m.alias_source_id, m.alias_source_key, m.alias_source_label, m.alias_source_context, m.id],
    );
  }
  const setIds = new Map();
  for (const s of w.sets) {
    const r = await owner.query(
      `INSERT INTO geo_reference_set (code, kind, authority, source_url, access_method, file_sha256, fingerprint_kind, retrieved_at) VALUES ($1, 'lgd_snapshot', 'synthetic', 'https://example.invalid', 'other', $2, $3, now()) RETURNING id`,
      [s.code, s.set_sha256, s.fingerprint_kind],
    );
    setIds.set(s.code, r.rows[0].id);
  }
  for (const u of w.units)
    await owner.query(
      `INSERT INTO admin_unit_version (id, reference_set_id, unit_type, lgd_code, history_seq, is_latest_version, name_en, parent_lgd_code, status,
         lgd_effective_date, lgd_effective_is_baseline, valid_from_known, source_url, source_sha256, retrieved_at, content_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        u.id,
        setIds.get(u.set_code),
        u.unit_type,
        u.lgd_code,
        u.history_seq,
        u.is_latest_version,
        u.name_en,
        u.parent_lgd_code,
        u.status,
        u.lgd_effective_date,
        u.lgd_effective_is_baseline,
        u.valid_from_known,
        u.source_url,
        u.source_sha256,
        u.retrieved_at,
        u.id.replaceAll('-', '').padEnd(64, '0'),
      ],
    );
  return {
    ownerUrl,
    owner,
    adminDb,
    world: w,
    async drop() {
      await owner.end().catch(() => undefined);
      await adminDb.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    },
  };
}
