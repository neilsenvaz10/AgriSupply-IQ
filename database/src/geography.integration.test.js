import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadReferencePlan, retractReferenceSet } from './reference/lgdLoad.js';
import { buildLgdPlan, contentFingerprint } from './reference/lgdPlan.js';
import { describeIntegration } from './test/db.js';
import { assertDisposable, guardedUrl } from './test/disposable.js';
import { expectViolation, one, suffix, withRollback } from './test/fixtures.js';

/**
 * Geographic reference infrastructure (Milestone 2.4, Stage 3a, migration 0005) on a verified DISPOSABLE
 * database. Constraint tests run inside transactions that are rolled back; the loader tests commit synthetic
 * rows and remove them again with the owner-only `retractReferenceSet`. Nothing here reads or changes a
 * registry mandi, an alias or an observation.
 */

const sha = (text) => createHash('sha256').update(text).digest('hex');
const tag = suffix();
let n = 0;
const uniq = () => `${tag}${(n += 1)}`;

const setRow = (over = {}) => ({
  code: `s3a-geo-${uniq()}`,
  kind: 'lgd_snapshot',
  authority: 'synthetic',
  source_url: 'https://example.invalid/x',
  access_method: 'public_page',
  file_sha256: sha(`set-${uniq()}`),
  retrieved_at: '2026-10-20T00:00:00Z',
  ...over,
});
const unitRow = (setId, over = {}) => ({
  reference_set_id: setId,
  unit_type: 'district',
  lgd_code: 990100 + (n += 1),
  is_latest_version: true,
  version: 1,
  name_en: 'Synthetic',
  parent_lgd_code: 990001,
  status: 'active',
  content_sha256: sha(`unit-${uniq()}`),
  ...over,
});
describeIntegration('geographic reference tables (disposable database, synthetic fixtures)', () => {
  /** @type {pg.Pool} */ let owner;
  const tx = (work) => withRollback(owner, work);

  beforeAll(async () => {
    await assertDisposable();
    owner = new pg.Pool({ connectionString: await guardedUrl('DATABASE_MIGRATION_URL'), max: 3 });
  });
  afterAll(async () => {
    await owner?.end();
  });

  const insert = (c, table, row) => {
    const keys = Object.keys(row);
    return c.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => row[k]),
    );
  };
  const text = (table, row) => {
    const keys = Object.keys(row);
    return {
      text: `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      values: keys.map((k) => row[k]),
    };
  };

  describe('geo_reference_set', () => {
    it('stores a reference with its fingerprint and source metadata', () =>
      tx(async (c) => {
        const r = await insert(
          c,
          'geo_reference_set',
          setRow({
            fingerprint_kind: 'manifest',
            size_bytes: 10,
            record_count: 2,
            as_of_date: '2026-10-20',
            licence_note: 'l',
          }),
        );
        const row = await one(
          c,
          'SELECT code, kind, fingerprint_kind, file_sha256 FROM geo_reference_set WHERE id = $1',
          [r.rows[0].id],
        );
        expect(row.fingerprint_kind).toBe('manifest');
        expect(row.file_sha256).toHaveLength(64);
      }));

    it('refuses a duplicate code, a duplicate fingerprint and malformed values', () =>
      tx(async (c) => {
        const first = setRow();
        await insert(c, 'geo_reference_set', first);
        for (const [over, constraint] of [
          [{ file_sha256: sha(`other-${uniq()}`), code: first.code }, 'grs_code_uq'],
          [{ file_sha256: first.file_sha256 }, 'grs_sha256_uq'],
          [{ file_sha256: 'ABC' }, 'grs_sha256_ck'],
          [{ file_sha256: 'A'.repeat(64) }, 'grs_sha256_ck'],
          [{ code: 'Bad Code!' }, 'grs_code_ck'],
          [{ kind: 'guess' }, 'grs_kind_ck'],
          [{ access_method: 'scrape' }, 'grs_access_ck'],
          [{ fingerprint_kind: 'vibes' }, 'grs_fingerprint_ck'],
          [{ size_bytes: -1 }, 'grs_size_ck'],
          [{ authority: '  ' }, 'grs_text_ck'],
        ]) {
          const q = text('geo_reference_set', setRow(over));
          expect(
            (await expectViolation(c, q.text, q.values)).constraint,
            JSON.stringify(over),
          ).toBe(constraint);
        }
      }));
  });

  describe('admin_unit_version', () => {
    it('keeps several snapshots and versions of the same unit without collisions', () =>
      tx(async (c) => {
        const a = (await insert(c, 'geo_reference_set', setRow())).rows[0].id;
        const b = (await insert(c, 'geo_reference_set', setRow())).rows[0].id;
        const code = 990500;
        await insert(
          c,
          'admin_unit_version',
          unitRow(a, {
            lgd_code: code,
            history_seq: 1,
            is_latest_version: false,
            version: 1,
            status: 'inactive',
          }),
        );
        await insert(
          c,
          'admin_unit_version',
          unitRow(a, { lgd_code: code, history_seq: 2, is_latest_version: true, version: 2 }),
        );
        await insert(
          c,
          'admin_unit_version',
          unitRow(b, { lgd_code: code, history_seq: 1, is_latest_version: true, version: 2 }),
        ); // the same unit in another snapshot
        const rows = await c.query(
          'SELECT reference_set_id, history_seq FROM admin_unit_version WHERE lgd_code = $1 ORDER BY 1, 2',
          [code],
        );
        expect(rows.rowCount).toBe(3);
      }));

    it('refuses a duplicate unit position, two latest versions in one set, and a missing set', () =>
      tx(async (c) => {
        const s = (await insert(c, 'geo_reference_set', setRow())).rows[0].id;
        const base = unitRow(s, { lgd_code: 990600 });
        await insert(c, 'admin_unit_version', base);
        const dup = text(
          'admin_unit_version',
          unitRow(s, { lgd_code: 990600, history_seq: 1, is_latest_version: false }),
        );
        expect((await expectViolation(c, dup.text, dup.values)).constraint).toBe('aun_unit_seq_uq');
        const twoLatest = text(
          'admin_unit_version',
          unitRow(s, { lgd_code: 990600, history_seq: 2, is_latest_version: true }),
        );
        expect((await expectViolation(c, twoLatest.text, twoLatest.values)).constraint).toBe(
          'aun_latest_uq',
        );
        const noSet = text('admin_unit_version', unitRow('00000000-0000-4000-8000-000000000000'));
        expect((await expectViolation(c, noSet.text, noSet.values)).constraint).toBe(
          'aun_reference_set_fk',
        );
      }));

    it('enforces the unit-type rules: a district has a parent state code, a state does not', () =>
      tx(async (c) => {
        const s = (await insert(c, 'geo_reference_set', setRow())).rows[0].id;
        for (const [over, constraint] of [
          [{ unit_type: 'district', parent_lgd_code: null }, 'aun_parent_ck'],
          [{ unit_type: 'state', parent_lgd_code: 990001 }, 'aun_parent_ck'],
          [{ unit_type: 'district', state_kind: 'state' }, 'aun_parent_ck'],
          // an unknown type also fails aun_type_ck; PostgreSQL reports the alphabetically first violated check
          [{ unit_type: 'country' }, 'aun_parent_ck'],
          [{ status: 'maybe' }, 'aun_status_ck'],
          [{ lgd_code: 0 }, 'aun_code_ck'],
          [{ version: 0 }, 'aun_version_ck'],
          [{ name_en: ' ' }, 'aun_name_ck'],
          [{ content_sha256: 'xyz' }, 'aun_hash_ck'],
          [{ source_sha256: 'xyz' }, 'aun_hash_ck'],
        ]) {
          const q = text('admin_unit_version', unitRow(s, over));
          expect(
            (await expectViolation(c, q.text, q.values)).constraint,
            JSON.stringify(over),
          ).toBe(constraint);
        }
        await insert(
          c,
          'admin_unit_version',
          unitRow(s, {
            unit_type: 'state',
            parent_lgd_code: null,
            state_kind: 'union_territory',
            lgd_code: 990002,
          }),
        );
      }));

    it('keeps LGD dates apart from legal dates: the 2005 baseline is flagged and never becomes a legal date', () =>
      tx(async (c) => {
        const s = (await insert(c, 'geo_reference_set', setRow())).rows[0].id;
        const ok = unitRow(s, {
          lgd_effective_date: '2005-01-01',
          lgd_effective_is_baseline: true,
        });
        await insert(c, 'admin_unit_version', ok);
        for (const [over, constraint] of [
          [
            { lgd_effective_date: '2016-10-11', lgd_effective_is_baseline: true },
            'aun_baseline_ck',
          ], // the flag only fits the baseline date
          [
            { lgd_effective_date: '2016-10-11', legal_effective_date: '2016-10-11' },
            'aun_legal_evidence_ck',
          ], // a legal date needs evidence
          [
            {
              lgd_effective_date: '2005-01-01',
              lgd_effective_is_baseline: true,
              legal_effective_date: '2005-01-01',
              legal_effective_evidence: 'copied',
            },
            'aun_legal_not_baseline_ck',
          ],
          [
            {
              lgd_effective_date: '2005-01-01',
              lgd_effective_is_baseline: true,
              valid_from_known: true,
            },
            'aun_valid_from_ck',
          ],
          [{ valid_from_known: true }, 'aun_valid_from_ck'], // no date at all
        ]) {
          const q = text('admin_unit_version', unitRow(s, over));
          expect(
            (await expectViolation(c, q.text, q.values)).constraint,
            JSON.stringify(over),
          ).toBe(constraint);
        }
        // a real legal date with evidence is accepted, and a dated non-baseline version can be known
        await insert(
          c,
          'admin_unit_version',
          unitRow(s, {
            lgd_effective_date: '2014-06-17',
            valid_from_known: true,
            legal_effective_date: '2014-06-02',
            legal_effective_evidence: 'Andhra Pradesh Reorganisation Act, 2014, appointed day',
          }),
        );
      }));

    it('records which registry row carries an official unit, by code, without touching the registry', () =>
      tx(async (c) => {
        const s = (await insert(c, 'geo_reference_set', setRow())).rows[0].id;
        const st = await c.query(
          `INSERT INTO states (name, kind, lgd_code) VALUES ($1, 'state', '990777') RETURNING id`,
          [`S3A LINK ${uniq()}`],
        );
        const before = (
          await c.query('SELECT st::text AS t FROM states st WHERE id = $1', [st.rows[0].id])
        ).rows[0].t;
        await insert(
          c,
          'admin_unit_version',
          unitRow(s, {
            unit_type: 'state',
            parent_lgd_code: null,
            lgd_code: 990777,
            state_id: st.rows[0].id,
          }),
        );
        const bad = text(
          'admin_unit_version',
          unitRow(s, { unit_type: 'district', state_id: st.rows[0].id }),
        );
        expect((await expectViolation(c, bad.text, bad.values)).constraint).toBe('aun_parent_ck');
        expect(
          (await c.query('SELECT st::text AS t FROM states st WHERE id = $1', [st.rows[0].id]))
            .rows[0].t,
        ).toBe(before);
      }));

    it('shows the newest snapshot of every unit in admin_unit_current', () =>
      tx(async (c) => {
        const old = (
          await insert(c, 'geo_reference_set', setRow({ retrieved_at: '2026-01-01T00:00:00Z' }))
        ).rows[0].id;
        const fresh = (
          await insert(c, 'geo_reference_set', setRow({ retrieved_at: '2026-10-01T00:00:00Z' }))
        ).rows[0].id;
        await insert(
          c,
          'admin_unit_version',
          unitRow(old, { lgd_code: 990800, name_en: 'Old Name' }),
        );
        await insert(
          c,
          'admin_unit_version',
          unitRow(fresh, { lgd_code: 990800, name_en: 'New Name' }),
        );
        await insert(
          c,
          'admin_unit_version',
          unitRow(old, { lgd_code: 990801, name_en: 'Only Old' }),
        );
        const rows = await c.query(
          `SELECT lgd_code, name_en FROM admin_unit_current WHERE lgd_code IN (990800, 990801) ORDER BY lgd_code`,
        );
        expect(rows.rows).toEqual([
          { lgd_code: 990800, name_en: 'New Name' },
          { lgd_code: 990801, name_en: 'Only Old' },
        ]);
      }));

    it('is append-only: UPDATE and DELETE are refused, and so is changing a fingerprint', () =>
      tx(async (c) => {
        const s = (await insert(c, 'geo_reference_set', setRow())).rows[0].id;
        await insert(c, 'admin_unit_version', unitRow(s));
        for (const sql of [
          `UPDATE geo_reference_set SET notes = 'x' WHERE id = '${s}'`,
          `UPDATE geo_reference_set SET file_sha256 = '${'b'.repeat(64)}' WHERE id = '${s}'`,
          `DELETE FROM geo_reference_set WHERE id = '${s}'`,
          `UPDATE admin_unit_version SET name_en = 'x' WHERE reference_set_id = '${s}'`,
          `DELETE FROM admin_unit_version WHERE reference_set_id = '${s}'`,
        ]) {
          expect((await expectViolation(c, sql)).code, sql).toBe('55000');
        }
      }));
  });

  describe('idempotent loading and owner-only retraction (synthetic plan, committed then retracted)', () => {
    const planFor = (label) => {
      const mk = (u) => ({ ...u, contentSha256: contentFingerprint(u) });
      const unit = (code, over = {}) =>
        mk({
          unitType: 'district',
          lgdCode: code,
          historySeq: 1,
          isLatestVersion: true,
          version: 1,
          minorVersion: 1,
          nameEn: `Syn ${code}`,
          nameLocal: null,
          parentLgdCode: 990001,
          stateKind: null,
          census2001Code: null,
          census2011Code: '1',
          status: 'active',
          lgdEffectiveDate: '2005-01-01',
          lgdEffectiveIsBaseline: true,
          legalEffectiveDate: null,
          legalEffectiveEvidence: null,
          validFromKnown: false,
          orderNo: null,
          orderDate: null,
          gazetteDate: null,
          governmentOrderRef: null,
          sourceUrl: 'https://example.invalid/p',
          sourceSha256: sha(`page-${code}`),
          retrievedAt: '2026-10-20T00:00:00.000Z',
          rawRecord: { code },
          ...over,
        });
      return {
        sets: [
          {
            code: `s3a-load-${label}`,
            kind: 'lgd_snapshot',
            authority: 'synthetic',
            sourceUrl: 'https://example.invalid/l',
            accessMethod: 'manual_download',
            originalFilename: 'x.xls',
            format: 'xls',
            fileSha256: sha(`plan-${label}`),
            fingerprintKind: 'file',
            sizeBytes: 5,
            recordCount: 2,
            retrievedAt: '2026-10-20T00:00:00.000Z',
            asOfDate: '2026-10-20',
            publicationDate: null,
            publicationNote: null,
            licenceNote: 'l',
            termsNote: 't',
            notes: null,
            units: [unit(990901), unit(990902, { nameEn: 'Second', isLatestVersion: true })],
          },
        ],
      };
    };

    it('loads once, reloads as a no-op, and refuses changed content under the same fingerprint', async () => {
      const label = uniq();
      const plan = planFor(label);
      try {
        expect((await loadReferencePlan(owner, plan))[0]).toMatchObject({
          status: 'loaded',
          units: 2,
        });
        expect((await loadReferencePlan(owner, plan))[0]).toMatchObject({
          status: 'unchanged',
          units: 2,
        });
        const total = await owner.query(
          'SELECT count(*)::int AS n FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id WHERE s.code = $1',
          [`s3a-load-${label}`],
        );
        expect(total.rows[0].n).toBe(2);
        const changed = planFor(label);
        changed.sets[0].units[1] = {
          ...changed.sets[0].units[1],
          nameEn: 'Changed',
          contentSha256: 'f'.repeat(64),
        };
        await expect(loadReferencePlan(owner, changed)).rejects.toThrow(/different content/);
        // the refusal rolled back: nothing was added or altered
        const again = await owner.query(
          'SELECT count(*)::int AS n FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id WHERE s.code = $1',
          [`s3a-load-${label}`],
        );
        expect(again.rows[0].n).toBe(2);
      } finally {
        await retractReferenceSet(owner, `s3a-load-${label}`).catch(() => undefined);
      }
    });

    it('rolls the whole set back when one row is invalid (all or nothing)', async () => {
      const label = uniq();
      const plan = planFor(label);
      plan.sets[0].units[1] = { ...plan.sets[0].units[1], parentLgdCode: null }; // a district without a parent violates aun_parent_ck
      plan.sets[0].units[1].contentSha256 = contentFingerprint(plan.sets[0].units[1]);
      await expect(loadReferencePlan(owner, plan)).rejects.toThrow(/aun_parent_ck/);
      const left = await owner.query(
        'SELECT count(*)::int AS n FROM geo_reference_set WHERE code = $1',
        [`s3a-load-${label}`],
      );
      expect(left.rows[0].n).toBe(0);
    });

    it('links a unit to the registry row with the same LGD code and leaves that row byte-identical', async () => {
      const label = uniq();
      const created = await owner
        .query(
          `INSERT INTO districts (state_id, name, lgd_code) SELECT s.id, $1, '990901' FROM (SELECT id FROM states LIMIT 1) s RETURNING id`,
          [`S3A D ${label}`],
        )
        .catch(() => null);
      if (!created || created.rowCount === 0) {
        const s = await owner.query(
          `INSERT INTO states (name, kind) VALUES ($1, 'state') RETURNING id`,
          [`S3A S ${label}`],
        );
        await owner.query(
          `INSERT INTO districts (state_id, name, lgd_code) VALUES ($1, $2, '990901')`,
          [s.rows[0].id, `S3A D ${label}`],
        );
      }
      const before = (
        await owner.query(`SELECT d::text AS t FROM districts d WHERE lgd_code = '990901'`)
      ).rows[0].t;
      try {
        await loadReferencePlan(owner, planFor(label));
        const link = await owner.query(
          `SELECT v.district_id, d.id AS registry_id FROM admin_unit_version v JOIN districts d ON d.lgd_code = '990901' WHERE v.lgd_code = 990901 AND v.unit_type = 'district'`,
        );
        expect(link.rows[0].district_id).toBe(link.rows[0].registry_id);
        expect(
          (await owner.query(`SELECT d::text AS t FROM districts d WHERE lgd_code = '990901'`))
            .rows[0].t,
        ).toBe(before);
      } finally {
        await retractReferenceSet(owner, `s3a-load-${label}`).catch(() => undefined);
        const row = await owner.query(`SELECT state_id FROM districts WHERE lgd_code = '990901'`);
        await owner.query(`DELETE FROM districts WHERE lgd_code = '990901'`);
        await owner.query(`DELETE FROM states WHERE name LIKE 'S3A S %' AND id = $1`, [
          row.rows[0]?.state_id ?? null,
        ]);
      }
    });

    it('retracts a mistaken load (owner act) and refuses while an identity decision points at it', async () => {
      const label = uniq();
      const result = (await loadReferencePlan(owner, planFor(label)))[0];
      const source = await owner.query(
        `INSERT INTO data_sources (code, name, source_type) VALUES ($1, 'S3A', 'other') RETURNING id`,
        [`s3a-geo-${label}`],
      );
      const unit = await owner.query(
        `SELECT id FROM admin_unit_version WHERE reference_set_id = $1 LIMIT 1`,
        [result.id],
      );
      // an owner-level direct insert of a proposed decision (the functions are covered in identity.integration.test.js)
      const decision = await owner.query(
        `INSERT INTO identity_decision (decision_kind, entity_kind, source_id, source_key, source_label, target_admin_unit_version_id, decision_class, rationale, ruleset_version, proposed_by)
         VALUES ('map_label', 'district', $1, $2, 'x', $3, 'S', 'synthetic', 't', session_user) RETURNING id`,
        [source.rows[0].id, `k-${label}`, unit.rows[0].id],
      );
      try {
        await expect(retractReferenceSet(owner, `s3a-load-${label}`)).rejects.toThrow(
          /identity decisions point/,
        );
        const c = await owner.connect();
        try {
          await c.query('BEGIN');
          await c.query('ALTER TABLE identity_decision DISABLE TRIGGER USER');
          await c.query('DELETE FROM identity_decision WHERE id = $1', [decision.rows[0].id]);
          await c.query('ALTER TABLE identity_decision ENABLE TRIGGER USER');
          await c.query('COMMIT');
        } finally {
          c.release();
        }
        expect(await retractReferenceSet(owner, `s3a-load-${label}`)).toMatchObject({
          retracted: `s3a-load-${label}`,
          units: 2,
        });
        const left = await owner.query(
          'SELECT count(*)::int AS n FROM geo_reference_set WHERE code = $1',
          [`s3a-load-${label}`],
        );
        expect(left.rows[0].n).toBe(0);
        // the triggers are back on after the retraction
        expect(
          (
            await owner.query(
              `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('aun_append_only', 'grs_append_only', 'idec_guard') AND tgenabled = 'O'`,
            )
          ).rows[0].n,
        ).toBe(3);
      } finally {
        await owner
          .query('DELETE FROM data_sources WHERE id = $1', [source.rows[0].id])
          .catch(() => undefined);
      }
    });
  });

  const REAL = process.env.FASALYTICS_REFERENCE_DIR;
  describe.runIf(Boolean(REAL && existsSync(REAL)))(
    'the real official reference (validated files; disposable database only)',
    () => {
      it('loads the official states, districts and pages, reloads idempotently, and retracts cleanly', async () => {
        const plan = buildLgdPlan(/** @type {string} */ (REAL));
        const sets = plan.sets.map((s) => s.code);
        try {
          const first = await loadReferencePlan(owner, plan);
          expect(first.map((r) => r.status)).toEqual(['loaded', 'loaded', 'loaded', 'loaded']);
          const second = await loadReferencePlan(owner, plan);
          expect(second.map((r) => r.status)).toEqual([
            'unchanged',
            'unchanged',
            'unchanged',
            'unchanged',
          ]);
          const counts = await owner.query(
            `SELECT s.code, count(*)::int AS units, count(*) FILTER (WHERE v.is_latest_version)::int AS latest FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id WHERE s.code = ANY($1) GROUP BY 1 ORDER BY 1`,
            [sets],
          );
          expect(counts.rows.map((r) => r.units).sort((a, b) => a - b)).toEqual(
            plan.sets.map((s) => s.units.length).sort((a, b) => a - b),
          );
          const states = counts.rows.find((r) => r.code.startsWith('lgd-all-states'));
          const districts = counts.rows.find((r) => r.code.startsWith('lgd-all-districts'));
          expect([states.units, states.latest, districts.units, districts.latest]).toEqual([
            36, 36, 784, 784,
          ]);
          // The three districts whose parent state is unknown stay explicitly unresolved: reported as warnings and
          // absent from the page-derived set (the report lists them, but no parent is guessed for their pages).
          const unresolved = plan.warnings.filter((w) => /no parent state known/.test(w));
          expect(unresolved.map((w) => Number(/district (\d+)/.exec(w)?.[1])).sort()).toEqual([
            599, 601, 671,
          ]);
          const pageUnits = await owner.query(
            `SELECT count(*)::int AS n FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id WHERE s.code LIKE 'lgd-district-pages-%' AND v.lgd_code IN (599, 601, 671)`,
          );
          expect(pageUnits.rows[0].n).toBe(0);
          // Exactly one latest version per official unit in the state and district reports: no duplicates.
          const dupes = await owner.query(
            `SELECT count(*)::int AS n FROM (SELECT reference_set_id, unit_type, lgd_code FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id WHERE s.code = ANY($1) AND v.is_latest_version GROUP BY 1, 2, 3 HAVING count(*) > 1) d`,
            [sets],
          );
          expect(dupes.rows[0].n).toBe(0);
          const telangana = await owner.query(
            `SELECT lgd_effective_date::text AS d, lgd_effective_is_baseline AS b, valid_from_known AS k, legal_effective_date AS legal FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id WHERE s.code LIKE 'lgd-state-pages-%' AND v.lgd_code = 36 AND v.is_latest_version`,
          );
          expect(telangana.rows[0]).toEqual({ d: '2014-06-17', b: false, k: true, legal: null });
          const baseline = await owner.query(
            `SELECT count(*)::int AS n FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id WHERE s.code LIKE 'lgd-state-pages-%' AND v.is_latest_version AND v.lgd_effective_is_baseline`,
          );
          expect(baseline.rows[0].n).toBe(31);
          // Other suites share this database and may insert registry rows, so registry totals are not asserted.
          // Whatever registry link a unit carries must agree with its LGD code (a record, never a change).
          const wrong = await owner.query(
            `SELECT count(*)::int AS n FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id
               LEFT JOIN states st ON st.id = v.state_id LEFT JOIN districts d ON d.id = v.district_id
              WHERE s.code = ANY($1)
                AND ((v.state_id IS NOT NULL AND st.lgd_code IS DISTINCT FROM v.lgd_code::text)
                  OR (v.district_id IS NOT NULL AND d.lgd_code IS DISTINCT FROM v.lgd_code::text))`,
            [sets],
          );
          expect(wrong.rows[0].n).toBe(0);
        } finally {
          for (const code of [...sets].reverse())
            await retractReferenceSet(owner, code).catch(() => undefined);
        }
        const left = await owner.query(
          'SELECT count(*)::int AS n FROM geo_reference_set WHERE code = ANY($1)',
          [sets],
        );
        expect(left.rows[0].n).toBe(0);
      }, 120_000);
    },
  );
});
