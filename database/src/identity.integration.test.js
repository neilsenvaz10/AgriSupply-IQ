import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantIdentityPrivileges } from './identity/privileges.js';
import { grantIngestPrivileges } from './ingest/privileges.js';
import { describeIntegration } from './test/db.js';
import { assertDisposable, guardedUrl } from './test/disposable.js';
import { suffix } from './test/fixtures.js';
import { createLogins } from './test/roles.js';

/**
 * Identity decision workflow (Milestone 2.4, Stage 3a, migration 0006) on a verified DISPOSABLE database,
 * with SYNTHETIC fixtures and temporary logins created through the admin connection. The state machine, the
 * separation of duties, the append-only audit log, the unique indexes and concurrent approvals are exercised
 * with several real database sessions. No registry row, alias, mandi or observation is ever changed by a
 * decision: a test below proves it with a content hash.
 *
 * Needs DATABASE_ADMIN_URL (provided by `npm run test:disposable` and by CI); skipped, and reported as skipped,
 * without it.
 */

const REVIEWER = 'fasalytics_reviewer';
const APPROVER = 'fasalytics_approver';
const tag = suffix();
let counter = 0;
const unique = (what) => `${what}-${tag}-${(counter += 1)}`;
const NAMED = {
  decisionKind: 'p_decision_kind',
  entityKind: 'p_entity_kind',
  sourceId: 'p_source_id',
  sourceKey: 'p_source_key',
  sourceLabel: 'p_source_label',
  decisionClass: 'p_decision_class',
  rationale: 'p_rationale',
  rulesetVersion: 'p_ruleset_version',
  subjectMarketId: 'p_subject_market_id',
  targetStateId: 'p_target_state_id',
  targetDistrictId: 'p_target_district_id',
  targetMarketId: 'p_target_market_id',
  targetAdminUnitVersionId: 'p_target_admin_unit_version_id',
  evidence: 'p_evidence',
  supersedesId: 'p_supersedes_id',
};

/** Resolves to the PostgreSQL error of a call that MUST fail; throws if it succeeded. */
async function fails(promise) {
  try {
    await promise;
  } catch (error) {
    return /** @type {{ code?: string, message: string }} */ (error);
  }
  throw new Error('expected the statement to fail, but it succeeded');
}

describeIntegration(
  'identity decision workflow (disposable database, synthetic fixtures, separate logins)',
  () => {
    /** @type {pg.Pool} */ let owner;
    /** @type {pg.Pool} */ let admin;
    /** @type {pg.Pool} */ let app;
    /** @type {Awaited<ReturnType<typeof createLogins>>} */ let logins;
    /** @type {Record<string, pg.Pool>} */ const pools = {};
    const fx = /** @type {Record<string, string>} */ ({});
    let registryHash = '';
    const baseUrl = () => process.env.DATABASE_MIGRATION_URL ?? '';

    const rows = async (pool, text, values = []) => (await pool.query(text, values)).rows;
    const call = async (pool, fn, args) => {
      const keys = Object.keys(args);
      const text = `SELECT public.${fn}(${keys.map((k, i) => `${NAMED[k] ?? `p_${k}`} => $${i + 1}${k === 'evidence' ? '::jsonb' : ''}`).join(', ')}) AS r`;
      return (
        await pool.query(
          text,
          keys.map((k) => (k === 'evidence' ? JSON.stringify(args[k]) : args[k])),
        )
      ).rows[0].r;
    };
    const propose = (as, o = {}) =>
      call(pools[as], 'identity_propose', {
        decisionKind: 'map_label',
        entityKind: 'district',
        sourceId: fx.source,
        sourceKey: unique('label'),
        sourceLabel: 'a label',
        decisionClass: 'S',
        rationale: 'synthetic test rationale',
        rulesetVersion: 'test-1',
        targetAdminUnitVersionId: fx.districtUnit,
        ...o,
      });
    const review = (as, id, verdict = 'recommend') =>
      call(pools[as], 'identity_review', { decision_id: id, verdict });
    const newSet = (as = 'approver1') =>
      call(pools[as], 'mapping_set_create', { code: unique('set') });
    const statusOf = async (id) =>
      (await rows(owner, 'SELECT status FROM identity_decision WHERE id = $1', [id]))[0].status;
    const setStatus = async (id) =>
      (
        await rows(owner, 'SELECT status, activation_count FROM mapping_set WHERE id = $1', [id])
      )[0];
    const registryFingerprint = async () => {
      const r = await rows(
        owner,
        `SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
           SELECT s::text AS x FROM states s WHERE id IN ($1, $2) UNION ALL SELECT d::text FROM districts d WHERE id = $3
           UNION ALL SELECT m::text FROM markets m WHERE id IN ($4, $5)) t`,
        [fx.stateOne, fx.stateTwo, fx.district, fx.marketOne, fx.marketTwo],
      );
      return r[0].h;
    };

    beforeAll(async () => {
      await assertDisposable();
      owner = new pg.Pool({ connectionString: await guardedUrl('DATABASE_MIGRATION_URL'), max: 4 });
      admin = new pg.Pool({ connectionString: await guardedUrl('DATABASE_ADMIN_URL'), max: 3 });
      app = new pg.Pool({ connectionString: await guardedUrl('DATABASE_URL'), max: 2 });
      await grantIdentityPrivileges(baseUrl());
      logins = await createLogins(admin, tag, {
        revA: REVIEWER,
        revB: REVIEWER,
        revC: REVIEWER,
        approver1: APPROVER,
        approver2: APPROVER,
        both: [REVIEWER, APPROVER],
        nobody: null,
      });
      for (const key of Object.keys(logins.logins)) pools[key] = logins.poolFor(baseUrl(), key);
      pools['reviewer'] = pools['revA'];

      // synthetic registry and official-unit fixtures (committed, removed in afterAll)
      /** @param {string} text @param {unknown[]} values @returns {Promise<string>} */
      const q = async (text, values) => (await owner.query(text, values)).rows[0].id;
      fx.source = await q(
        `INSERT INTO data_sources (code, name, source_type) VALUES ($1, $2, 'other') RETURNING id`,
        [`s3a-id-${tag}`, `S3A identity source ${tag}`],
      );
      fx.stateOne = await q(`INSERT INTO states (name, kind) VALUES ($1, 'state') RETURNING id`, [
        `S3A STATE ONE ${tag}`,
      ]);
      fx.stateTwo = await q(`INSERT INTO states (name, kind) VALUES ($1, 'state') RETURNING id`, [
        `S3A STATE TWO ${tag}`,
      ]);
      fx.district = await q(`INSERT INTO districts (state_id, name) VALUES ($1, $2) RETURNING id`, [
        fx.stateOne,
        `S3A DISTRICT ${tag}`,
      ]);
      fx.marketOne = await q(
        `INSERT INTO markets (state_id, district_id, name, disambiguator, status) VALUES ($1, $2, $3, '', 'unverified') RETURNING id`,
        [fx.stateOne, fx.district, `S3A Mandi A ${tag}`],
      );
      fx.marketTwo = await q(
        `INSERT INTO markets (state_id, district_id, name, disambiguator, status) VALUES ($1, NULL, $2, $3, 'unverified') RETURNING id`,
        [fx.stateOne, `S3A Mandi B ${tag}`, `src-district:s3a ${tag}`],
      );
      fx.refSet = await q(
        `INSERT INTO geo_reference_set (code, kind, authority, source_url, access_method, file_sha256, retrieved_at)
         VALUES ($1, 'lgd_snapshot', 'synthetic', 'https://example.invalid/s3a', 'other', $2, now()) RETURNING id`,
        [`s3a-id-${tag}`, createHash('sha256').update(`s3a-id-${tag}`).digest('hex')],
      );
      const unit = (type, code, parent, name) =>
        q(
          `INSERT INTO admin_unit_version (reference_set_id, unit_type, lgd_code, is_latest_version, version, name_en, parent_lgd_code, status, content_sha256)
           VALUES ($1, $2, $3, true, 1, $4, $5, 'active', $6) RETURNING id`,
          [
            fx.refSet,
            type,
            code,
            name,
            parent,
            createHash('sha256').update(`${type}${code}${tag}`).digest('hex'),
          ],
        );
      fx.stateUnit = await unit('state', 990001, null, `Synthetic State ${tag}`);
      fx.districtUnit = await unit('district', 990002, 990001, `Synthetic District ${tag}`);
      registryHash = await registryFingerprint();
    }, 60_000);

    afterAll(async () => {
      try {
        // Remove only this file's rows. The append-only triggers are switched off for the cleanup in this
        // disposable database (an owner act), inside one transaction, and switched on again.
        const c = await owner?.connect();
        if (c) {
          try {
            await c.query('BEGIN');
            for (const t of [
              'identity_review_event',
              'identity_decision',
              'mapping_set',
              'admin_unit_version',
              'geo_reference_set',
            ]) {
              await c.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
            }
            await c.query(
              `DELETE FROM identity_review_event WHERE decision_id IN (SELECT id FROM identity_decision WHERE source_id = $1)
                           OR mapping_set_id IN (SELECT id FROM mapping_set WHERE code LIKE $2)`,
              [fx.source, `%-${tag}-%`],
            );
            await c.query(
              `UPDATE identity_decision SET supersedes_id = NULL WHERE source_id = $1`,
              [fx.source],
            );
            await c.query(`DELETE FROM identity_decision WHERE source_id = $1`, [fx.source]);
            await c.query(`DELETE FROM mapping_set WHERE code LIKE $1`, [`%-${tag}-%`]);
            await c.query(`DELETE FROM admin_unit_version WHERE reference_set_id = $1`, [
              fx.refSet,
            ]);
            await c.query(`DELETE FROM geo_reference_set WHERE id = $1`, [fx.refSet]);
            await c.query(`DELETE FROM markets WHERE id IN ($1, $2)`, [fx.marketOne, fx.marketTwo]);
            await c.query(`DELETE FROM districts WHERE id = $1`, [fx.district]);
            await c.query(`DELETE FROM states WHERE id IN ($1, $2)`, [fx.stateOne, fx.stateTwo]);
            await c.query(`DELETE FROM data_sources WHERE id = $1`, [fx.source]);
            for (const t of [
              'identity_review_event',
              'identity_decision',
              'mapping_set',
              'admin_unit_version',
              'geo_reference_set',
            ]) {
              await c.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
            }
            await c.query('COMMIT');
          } catch (error) {
            await c.query('ROLLBACK').catch(() => undefined);
            throw error;
          } finally {
            c.release();
          }
        }
      } finally {
        for (const pool of new Set(Object.values(pools))) await pool.end().catch(() => undefined);
        await logins?.drop().catch(() => undefined);
        await app?.end();
        await admin?.end();
        await owner?.end();
      }
    }, 60_000);

    describe('roles and privileges', () => {
      it('the application role can read the new tables and cannot write them or run the functions', async () => {
        for (const t of [
          'geo_reference_set',
          'admin_unit_version',
          'admin_unit_current',
          'mapping_set',
          'identity_decision',
          'identity_review_event',
          'identity_decision_in_effect',
        ]) {
          await app.query(`SELECT count(*) FROM ${t}`);
        }
        for (const text of [
          `INSERT INTO mapping_set (code, created_by) VALUES ('x-${tag}', 'app')`,
          `UPDATE identity_decision SET status = 'accepted'`,
          'DELETE FROM identity_review_event',
          'TRUNCATE identity_decision',
          `INSERT INTO geo_reference_set (code, kind, authority, source_url, access_method, file_sha256, retrieved_at) VALUES ('x', 'other', 'a', 'u', 'other', '${'0'.repeat(64)}', now())`,
        ]) {
          expect((await fails(app.query(text))).code, text).toBe('42501');
        }
        const e1 = await fails(app.query(`SELECT public.mapping_set_create('x-${tag}')`));
        expect(e1.code).toBe('42501');
        const e2 = await fails(
          app.query(`SELECT public.identity_accept('${fx.source}'::uuid, '${fx.source}'::uuid)`),
        );
        expect(e2.code).toBe('42501');
      });

      it('nobody but the owner has any direct write privilege on an identity table', async () => {
        const grants = await rows(
          owner,
          `SELECT c.relname, pg_get_userbyid(a.grantee) AS grantee, a.privilege_type
             FROM pg_class c, LATERAL aclexplode(c.relacl) a
            WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('mapping_set', 'identity_decision', 'identity_review_event', 'geo_reference_set', 'admin_unit_version')
              AND a.grantee <> c.relowner AND a.privilege_type <> 'SELECT'`,
        );
        // the loader role (ingestion) may INSERT into the two reference tables only, and only if it exists
        const unexpected = grants.filter(
          (g) =>
            !(
              g.privilege_type === 'INSERT' &&
              ['geo_reference_set', 'admin_unit_version'].includes(g.relname)
            ),
        );
        expect(unexpected).toEqual([]);
      });

      it('the ingestion role cannot write the identity tables even after its blanket grant is re-run', async () => {
        const ingestUrl = process.env.DATABASE_INGEST_URL;
        if (!ingestUrl) return; // the ingestion role is optional; reported as passed without it
        const ingestRole = decodeURIComponent(new URL(ingestUrl).username);
        await grantIngestPrivileges(baseUrl(), ingestRole);
        const ingest = new pg.Pool({
          connectionString: await guardedUrl('DATABASE_INGEST_URL'),
          max: 1,
        });
        try {
          for (const t of ['mapping_set', 'identity_decision', 'identity_review_event']) {
            expect((await fails(ingest.query(`INSERT INTO ${t} DEFAULT VALUES`))).code, t).toBe(
              '42501',
            );
          }
          const c = await ingest.connect();
          try {
            await c.query('BEGIN');
            await c.query(
              `INSERT INTO geo_reference_set (code, kind, authority, source_url, access_method, file_sha256, retrieved_at) VALUES ('s3a-ingest-${tag}', 'other', 'a', 'u', 'other', '${'a'.repeat(64)}', now())`,
            );
          } finally {
            await c.query('ROLLBACK');
            c.release();
          }
        } finally {
          await ingest.end();
        }
      });

      it('reviewers and approvers cannot write a table directly, and the owner-only guard stops even a superuser', async () => {
        expect(
          (
            await fails(
              pools['revA'].query(
                `INSERT INTO identity_decision (decision_kind) VALUES ('map_label')`,
              ),
            )
          ).code,
        ).toBe('42501');
        expect(
          (
            await fails(
              pools['approver1'].query(
                `INSERT INTO mapping_set (code, created_by) VALUES ('y-${tag}', 'approver1')`,
              ),
            )
          ).code,
        ).toBe('42501');
        // a superuser holds every privilege, yet the trigger refuses anything but the owner's functions
        expect(
          (
            await fails(
              admin.query(`INSERT INTO mapping_set (code, created_by) VALUES ('z-${tag}', 'x')`),
            )
          ).code,
        ).toBe('FI020');
        expect(
          (
            await fails(
              admin.query(
                `INSERT INTO identity_review_event (event_type, mapping_set_id, actor, actor_role) VALUES ('mapping_set_created', NULL, 'x', 'approver')`,
              ),
            )
          ).code,
        ).toBe('FI020');
      });
    });

    describe('privilege escalation and audit forgery', () => {
      it('a reviewer or approver cannot grant themselves a role, switch identity, create objects or forge an audit event', async () => {
        for (const who of ['revA', 'approver1']) {
          const other = who === 'revA' ? 'fasalytics_approver' : 'fasalytics_reviewer';
          const attempts = [
            `GRANT ${other} TO ${logins.logins[who].name}`,
            `SET ROLE ${other}`,
            `SET SESSION AUTHORIZATION ${logins.logins[who === 'revA' ? 'approver1' : 'revA'].name}`,
            `CREATE ROLE s3a_escalated_${tag}`,
            `ALTER ROLE ${logins.logins[who].name} SUPERUSER`,
            `CREATE TABLE public.s3a_x_${tag} (id int)`,
            `CREATE FUNCTION public.identity_propose(int) RETURNS int LANGUAGE sql AS 'SELECT 1'`,
            `CREATE OR REPLACE FUNCTION public.identity_caller_role() RETURNS text LANGUAGE sql AS $$SELECT 'approver'::text$$`,
            `ALTER TABLE public.identity_decision DISABLE TRIGGER ALL`,
            `ALTER TABLE public.identity_review_event DISABLE TRIGGER irev_append_only`,
            `DROP TRIGGER irev_append_only ON public.identity_review_event`,
            `SELECT public.identity_log_event('accepted', NULL, NULL, 'approver', NULL, NULL, NULL, 'forged', '{}'::jsonb)`,
            `UPDATE public.identity_review_event SET note = 'x'`,
            `DELETE FROM public.identity_review_event`,
            `TRUNCATE public.identity_review_event`,
            `UPDATE public.identity_decision SET status = 'accepted'`,
          ];
          for (const sql of attempts) {
            const error = await fails(pools[who].query(sql));
            expect(error.code, `${who}: ${sql}`).toBe('42501');
          }
        }
      });

      it('a reviewer cannot run approver functions and an approver cannot run reviewer functions', async () => {
        const id = await propose('revA');
        expect(
          (
            await fails(
              call(pools['revA'], 'identity_accept', { decision_id: id, mapping_set_id: id }),
            )
          ).code,
        ).toBe('42501');
        expect(
          (await fails(call(pools['revA'], 'mapping_set_create', { code: unique('x') }))).code,
        ).toBe('42501');
        expect(
          (
            await fails(
              call(pools['approver1'], 'identity_review', {
                decision_id: id,
                verdict: 'recommend',
              }),
            )
          ).code,
        ).toBe('42501');
      });

      it('a temporary table or function with a reserved name cannot hijack a definer function (pg_temp is searched last)', async () => {
        // Temporary tables are denied by default (asserted first); TEMP is then granted to the synthetic login to
        // prove the search_path ordering holds even if a deployment ever allows it.
        expect(
          (await fails(pools['revA'].query('CREATE TEMP TABLE s3a_denied (id int)'))).code,
        ).toBe('42501');
        await admin.query(
          `GRANT TEMPORARY ON DATABASE ${(await admin.query('SELECT quote_ident(current_database()) AS d')).rows[0].d} TO ${logins.logins['revA'].name}`,
        );
        const c = await pools['revA'].connect();
        try {
          await c.query('CREATE TEMP TABLE identity_decision (id uuid)');
          await c.query('CREATE TEMP TABLE admin_unit_version (id uuid, unit_type text)');
          const r = await c.query(
            'SELECT public.identity_propose(p_decision_kind => $1, p_entity_kind => $2, p_source_id => $3, p_source_key => $4, p_source_label => $5, p_decision_class => $6, p_rationale => $7, p_ruleset_version => $8, p_target_admin_unit_version_id => $9) AS id',
            [
              'map_label',
              'district',
              fx.source,
              unique('tmp'),
              'tmp label',
              'S',
              'synthetic',
              'test-1',
              fx.districtUnit,
            ],
          );
          const stored = await rows(
            owner,
            'SELECT proposed_by FROM public.identity_decision WHERE id = $1',
            [r.rows[0].id],
          );
          expect(stored[0].proposed_by).toBe(logins.logins['revA'].name);
          expect(
            (await c.query('SELECT count(*)::int AS n FROM pg_temp.identity_decision')).rows[0].n,
          ).toBe(0);
        } finally {
          c.release();
        }
      });

      it('the application role cannot forge audit events or run any identity function', async () => {
        for (const sql of [
          `SELECT public.identity_log_event('accepted', NULL, NULL, 'approver', NULL, NULL, NULL, 'forged', '{}'::jsonb)`,
          `UPDATE public.identity_review_event SET note = 'x'`,
          `DELETE FROM public.identity_review_event`,
          `SELECT public.mapping_set_activate(gen_random_uuid())`,
        ]) {
          expect((await fails(app.query(sql))).code, sql).toBe('42501');
        }
      });
    });

    describe('separation of duties', () => {
      it('refuses a login that belongs to both groups, or to neither', async () => {
        expect((await fails(propose('both'))).code).toBe('FI010');
        expect(
          (await fails(call(pools['both'], 'mapping_set_create', { code: unique('set') }))).code,
        ).toBe('FI010');
        const noGroup = await fails(
          call(pools['nobody'], 'identity_propose', {
            decisionKind: 'mark_unresolved',
            entityKind: 'district',
            sourceId: fx.source,
            sourceKey: 'k',
            sourceLabel: 'l',
            decisionClass: 'U',
            rationale: 'r',
            rulesetVersion: 'v',
          }),
        );
        expect(noGroup.code).toBe('42501'); // no EXECUTE at all
      });

      it('checks the role inside the function too: an approver cannot propose even if EXECUTE were granted', async () => {
        await admin.query(
          `GRANT EXECUTE ON FUNCTION public.identity_propose(text, text, uuid, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, jsonb, text[], date, date, uuid) TO ${APPROVER}`,
        );
        try {
          expect((await fails(propose('approver1'))).code).toBe('FI012');
        } finally {
          await admin.query(
            `REVOKE EXECUTE ON FUNCTION public.identity_propose(text, text, uuid, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, jsonb, text[], date, date, uuid) FROM ${APPROVER}`,
          );
        }
        await admin.query(
          `GRANT EXECUTE ON FUNCTION public.identity_accept(uuid, uuid) TO ${REVIEWER}`,
        );
        try {
          const id = await propose('revA');
          expect(
            (
              await fails(
                call(pools['revB'], 'identity_accept', {
                  decision_id: id,
                  mapping_set_id: await newSet(),
                }),
              )
            ).code,
          ).toBe('FI012');
        } finally {
          await admin.query(
            `REVOKE EXECUTE ON FUNCTION public.identity_accept(uuid, uuid) FROM ${REVIEWER}`,
          );
        }
      });

      it('the proposer cannot review, a reviewer counts once, and a reviewer cannot be the approver', async () => {
        const id = await propose('revA');
        expect((await fails(review('revA', id))).code).toBe('FI041');
        await review('revB', id);
        expect((await fails(review('revB', id))).code).toBe('FI042');
        const e = await fails(
          call(pools['revB'], 'identity_review', { decision_id: id, verdict: 'maybe' }),
        );
        expect(e.code).toBe('FI040');
      });

      it('an ordinary decision needs ONE recommending reviewer, a sensitive one needs TWO distinct reviewers', async () => {
        const set = await newSet();
        const ordinary = await propose('revA');
        expect(
          (
            await fails(
              call(pools['approver1'], 'identity_accept', {
                decision_id: ordinary,
                mapping_set_id: set,
              }),
            )
          ).code,
        ).toBe('FI056');
        await review('revB', ordinary);
        await call(pools['approver1'], 'identity_accept', {
          decision_id: ordinary,
          mapping_set_id: set,
        });
        expect(await statusOf(ordinary)).toBe('accepted');

        const kinds = [
          {
            decisionKind: 'map_label',
            entityKind: 'state',
            targetAdminUnitVersionId: fx.stateUnit,
          },
          {
            decisionKind: 'correct_state',
            entityKind: 'market',
            subjectMarketId: fx.marketOne,
            targetAdminUnitVersionId: fx.stateUnit,
            // since migration 0007 a state correction is accepted only with market-specific evidence
            evidence: {
              marketSpecificEvidence: [
                { type: 'official_market_listing', stateLgdCode: 1, reference: 'synthetic' },
              ],
            },
          },
          {
            decisionKind: 'merge_markets',
            entityKind: 'market',
            subjectMarketId: fx.marketTwo,
            targetMarketId: fx.marketOne,
            targetAdminUnitVersionId: undefined,
          },
          {
            decisionKind: 'mark_ambiguous',
            entityKind: 'district',
            decisionClass: 'A',
            targetAdminUnitVersionId: undefined,
          },
        ];
        for (const k of kinds) {
          const id = await propose('revA', k);
          expect(
            (
              await rows(
                owner,
                'SELECT requires_two_reviewers AS r FROM identity_decision WHERE id = $1',
                [id],
              )
            )[0].r,
            k.decisionKind,
          ).toBe(true);
          await review('revB', id);
          expect(
            (
              await fails(
                call(pools['approver1'], 'identity_accept', {
                  decision_id: id,
                  mapping_set_id: set,
                }),
              )
            ).code,
            k.decisionKind,
          ).toBe('FI056');
          await review('revC', id);
          await call(pools['approver2'], 'identity_accept', {
            decision_id: id,
            mapping_set_id: set,
          });
          expect(await statusOf(id), k.decisionKind).toBe('accepted');
        }
        expect(
          (
            await rows(
              owner,
              'SELECT requires_two_reviewers AS r FROM identity_decision WHERE id = $1',
              [ordinary],
            )
          )[0].r,
        ).toBe(false);
      });

      it('a reject or needs-evidence verdict blocks acceptance; the approver is never the proposer or a reviewer', async () => {
        const set = await newSet();
        const id = await propose('revA');
        await review('revB', id, 'recommend');
        await review('revC', id, 'needs_evidence');
        expect(
          (
            await fails(
              call(pools['approver1'], 'identity_accept', { decision_id: id, mapping_set_id: set }),
            )
          ).code,
        ).toBe('FI055');
        await call(pools['approver1'], 'identity_reject', {
          decision_id: id,
          reason: 'needs more evidence',
        });
        expect(await statusOf(id)).toBe('rejected');
        // proposer separation is also a table rule: accepted_by <> proposed_by
        expect(
          (
            await rows(
              owner,
              `SELECT conname FROM pg_constraint WHERE conname = 'idec_separation_ck'`,
            )
          ).length,
        ).toBe(1);
      });
    });

    describe('state machine, audit log and immutability', () => {
      it('records every step in an append-only log with the real session logins', async () => {
        const set = await newSet();
        const id = await propose('revA');
        await review('revB', id);
        await call(pools['approver1'], 'identity_accept', { decision_id: id, mapping_set_id: set });
        const events = await rows(
          owner,
          'SELECT event_type, actor, actor_role, verdict, from_status, to_status FROM identity_review_event WHERE decision_id = $1 ORDER BY id',
          [id],
        );
        expect(events.map((e) => e.event_type)).toEqual(['proposed', 'reviewed', 'accepted']);
        expect(events.map((e) => e.actor)).toEqual([
          logins.logins['revA'].name,
          logins.logins['revB'].name,
          logins.logins['approver1'].name,
        ]);
        expect(events.map((e) => e.actor_role)).toEqual(['reviewer', 'reviewer', 'approver']);
        expect(events[1].verdict).toBe('recommend');
        expect(events[2]).toMatchObject({ from_status: 'proposed', to_status: 'accepted' });
        const d = (
          await rows(
            owner,
            'SELECT proposed_by, accepted_by, mapping_set_id FROM identity_decision WHERE id = $1',
            [id],
          )
        )[0];
        expect(d).toMatchObject({
          proposed_by: logins.logins['revA'].name,
          accepted_by: logins.logins['approver1'].name,
          mapping_set_id: set,
        });
      });

      it('refuses UPDATE, DELETE and TRUNCATE of the audit log and of decisions, even for the owner', async () => {
        for (const text of [
          `UPDATE identity_review_event SET note = 'x'`,
          'DELETE FROM identity_review_event',
          'TRUNCATE identity_review_event',
          'DELETE FROM identity_decision',
          'TRUNCATE identity_decision',
          'DELETE FROM mapping_set',
          'TRUNCATE mapping_set',
          `UPDATE geo_reference_set SET notes = 'x'`,
          'DELETE FROM admin_unit_version',
          'TRUNCATE admin_unit_version',
        ]) {
          // PostgreSQL itself refuses TRUNCATE of a table that a foreign key references (0A000); the others are
          // refused by the append-only trigger (55000). Either way the data stays.
          expect(['55000', '0A000'], text).toContain((await fails(owner.query(text))).code);
        }
      });

      it('keeps the content of a decision immutable and allows only the defined status edges', async () => {
        const set = await newSet();
        const id = await propose('revA');
        expect(
          (
            await fails(
              owner.query(`UPDATE identity_decision SET rationale = 'changed' WHERE id = $1`, [id]),
            )
          ).code,
        ).toBe('FI024');
        expect(
          (
            await fails(
              owner.query(`UPDATE identity_decision SET target_district_id = $2 WHERE id = $1`, [
                id,
                fx.district,
              ]),
            )
          ).code,
        ).toBe('FI024');
        expect(
          (
            await fails(
              owner.query(`UPDATE identity_decision SET status = 'superseded' WHERE id = $1`, [id]),
            )
          ).code,
        ).toBe('FI023');
        await review('revB', id);
        await call(pools['approver1'], 'identity_accept', { decision_id: id, mapping_set_id: set });
        for (const to of ['proposed', 'rejected', 'withdrawn']) {
          expect(
            (
              await fails(
                owner.query(`UPDATE identity_decision SET status = $2 WHERE id = $1`, [id, to]),
              )
            ).code,
            to,
          ).toBe('FI023');
        }
        expect(
          (
            await fails(
              call(pools['approver1'], 'identity_reject', { decision_id: id, reason: 'too late' }),
            )
          ).code,
        ).toBe('FI051');
      });

      it('lets only the proposer withdraw a proposal, with a reason', async () => {
        const id = await propose('revA');
        expect(
          (await fails(call(pools['revB'], 'identity_withdraw', { decision_id: id, reason: 'x' })))
            .code,
        ).toBe('FI044');
        expect(
          (await fails(call(pools['revA'], 'identity_withdraw', { decision_id: id, reason: ' ' })))
            .code,
        ).toBe('FI043');
        await call(pools['revA'], 'identity_withdraw', {
          decision_id: id,
          reason: 'changed my mind',
        });
        expect(await statusOf(id)).toBe('withdrawn');
      });

      it('validates what a decision points at (check constraints and the official unit type)', async () => {
        expect(
          (await fails(propose('revA', { targetAdminUnitVersionId: fx.stateUnit }))).code,
        ).toBe('FI030'); // district decision, state unit
        expect(
          (
            await fails(
              propose('revA', {
                decisionKind: 'merge_markets',
                entityKind: 'market',
                subjectMarketId: fx.marketOne,
                targetMarketId: fx.marketOne,
                targetAdminUnitVersionId: undefined,
              }),
            )
          ).code,
        ).toBe('23514');
        expect(
          (
            await fails(
              propose('revA', {
                decisionKind: 'mark_unresolved',
                targetAdminUnitVersionId: fx.districtUnit,
              }),
            )
          ).code,
        ).toBe('23514');
        expect((await fails(propose('revA', { decisionClass: 'Z' }))).code).toBe('23514');
        expect((await fails(propose('revA', { evidence: ['not', 'an', 'object'] }))).code).toBe(
          '23514',
        );
        expect((await fails(propose('revA', { rationale: '   ' }))).code).toBe('23514');
      });
    });

    describe('conflicting mappings and mapping sets', () => {
      it('refuses a second accepted decision for the same label inside one set, allows it in another set', async () => {
        const key = unique('conflict');
        const setA = await newSet();
        const setB = await newSet();
        const first = await propose('revA', { sourceKey: key });
        const second = await propose('revA', { sourceKey: key });
        await review('revB', first);
        await review('revB', second);
        await call(pools['approver1'], 'identity_accept', {
          decision_id: first,
          mapping_set_id: setA,
        });
        expect(
          (
            await fails(
              call(pools['approver2'], 'identity_accept', {
                decision_id: second,
                mapping_set_id: setA,
              }),
            )
          ).code,
        ).toBe('FI058');
        expect(await statusOf(second)).toBe('proposed');
        await call(pools['approver2'], 'identity_accept', {
          decision_id: second,
          mapping_set_id: setB,
        });
        expect(await statusOf(second)).toBe('accepted');
      });

      it('the unique indexes alone stop a race that bypasses the functions (two direct updates)', async () => {
        const key = unique('race');
        const set = await newSet();
        const a = await propose('revA', { sourceKey: key });
        const b = await propose('revA', { sourceKey: key });
        const accept = (id) =>
          `UPDATE identity_decision SET status = 'accepted', mapping_set_id = '${set}', accepted_by = 'someone-else', accepted_at = now() WHERE id = '${id}'`;
        const one = await owner.connect();
        const two = await owner.connect();
        try {
          await one.query('BEGIN');
          await two.query('BEGIN');
          await one.query(accept(a));
          const second = two.query(accept(b)); // waits for the first transaction's index entry
          await new Promise((resolve) => setTimeout(resolve, 300));
          await one.query('COMMIT');
          expect((await fails(second)).code).toBe('23505');
        } finally {
          await one.query('ROLLBACK').catch(() => undefined);
          await two.query('ROLLBACK').catch(() => undefined);
          one.release();
          two.release();
        }
        expect(await statusOf(a)).toBe('accepted');
        expect(await statusOf(b)).toBe('proposed');
      });

      it('concurrent approvals: two approvers on the same label give exactly one accepted decision', async () => {
        const key = unique('concurrent');
        const set = await newSet();
        const a = await propose('revA', { sourceKey: key });
        const b = await propose('revA', { sourceKey: key });
        for (const id of [a, b]) await review('revB', id);
        const results = await Promise.allSettled([
          call(pools['approver1'], 'identity_accept', { decision_id: a, mapping_set_id: set }),
          call(pools['approver2'], 'identity_accept', { decision_id: b, mapping_set_id: set }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = /** @type {PromiseRejectedResult} */ (
          results.find((r) => r.status === 'rejected')
        );
        expect(['FI058', '23505']).toContain(rejected.reason.code);
        const accepted = await rows(
          owner,
          `SELECT count(*)::int AS n FROM identity_decision WHERE source_key = $1 AND status = 'accepted'`,
          [key],
        );
        expect(accepted[0].n).toBe(1);
      });

      it('concurrent approvals of the SAME decision: one wins, the other is told it is no longer proposed', async () => {
        const set = await newSet();
        const id = await propose('revA');
        await review('revB', id);
        const results = await Promise.allSettled([
          call(pools['approver1'], 'identity_accept', { decision_id: id, mapping_set_id: set }),
          call(pools['approver2'], 'identity_accept', { decision_id: id, mapping_set_id: set }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(
          /** @type {PromiseRejectedResult} */ (results.find((r) => r.status === 'rejected')).reason
            .code,
        ).toBe('FI051');
        const log = await rows(
          owner,
          `SELECT count(*)::int AS n FROM identity_review_event WHERE decision_id = $1 AND event_type = 'accepted'`,
          [id],
        );
        expect(log[0].n).toBe(1);
      });

      it('replacing a decision inside a draft set closes the old one; across sets it is lineage only', async () => {
        const key = unique('supersede');
        const draft = await newSet();
        const old = await propose('revA', { sourceKey: key });
        await review('revB', old);
        await call(pools['approver1'], 'identity_accept', {
          decision_id: old,
          mapping_set_id: draft,
        });
        const replacement = await propose('revA', { sourceKey: key, supersedesId: old });
        await review('revB', replacement);
        await call(pools['approver2'], 'identity_accept', {
          decision_id: replacement,
          mapping_set_id: draft,
        });
        expect(await statusOf(old)).toBe('superseded');
        expect(await statusOf(replacement)).toBe('accepted');
        // another set: the old decision stays accepted in its own set (so reactivating that set is a true rollback)
        const other = await newSet();
        const third = await propose('revA', { sourceKey: key, supersedesId: replacement });
        await review('revB', third);
        await call(pools['approver1'], 'identity_accept', {
          decision_id: third,
          mapping_set_id: other,
        });
        expect(await statusOf(replacement)).toBe('accepted');
        expect((await fails(propose('revA', { sourceKey: key, supersedesId: old }))).code).toBe(
          'FI031',
        ); // old is superseded
        expect(
          (await fails(propose('revA', { sourceKey: unique('other-label'), supersedesId: third })))
            .code,
        ).toBe('FI031'); // other label
      });

      it('decisions are accepted only into a draft set; activation is reversible and only one set is active', async () => {
        const setA = await newSet();
        const setB = await newSet();
        const a = await propose('revA');
        const b = await propose('revA');
        for (const id of [a, b]) await review('revB', id);
        await call(pools['approver1'], 'identity_accept', { decision_id: a, mapping_set_id: setA });
        await call(pools['approver1'], 'identity_accept', { decision_id: b, mapping_set_id: setB });
        const inEffect = async () =>
          (
            await rows(
              owner,
              'SELECT id FROM identity_decision_in_effect WHERE id IN ($1, $2) ORDER BY id',
              [a, b],
            )
          ).map((r) => r.id);

        expect(await inEffect()).toEqual([]);
        await call(pools['approver1'], 'mapping_set_activate', { mapping_set_id: setA });
        expect(await inEffect()).toEqual([a]);
        expect(
          (
            await fails(
              call(pools['approver1'], 'identity_accept', {
                decision_id: await propose('revA'),
                mapping_set_id: setA,
              }),
            )
          ).code,
        ).toBe('FI052'); // active, not draft
        expect(
          (await fails(call(pools['approver1'], 'mapping_set_activate', { mapping_set_id: setA })))
            .code,
        ).toBe('FI061');
        // activating B replaces A ...
        await call(pools['approver2'], 'mapping_set_activate', { mapping_set_id: setB });
        expect(await inEffect()).toEqual([b]);
        expect((await setStatus(setA)).status).toBe('inactive');
        // ... and the rollback is activating A again; nothing about the decisions changed
        await call(pools['approver1'], 'mapping_set_activate', { mapping_set_id: setA });
        expect(await inEffect()).toEqual([a]);
        expect(await setStatus(setA)).toMatchObject({ status: 'active', activation_count: 2 });
        await call(pools['approver1'], 'mapping_set_deactivate', { mapping_set_id: setA });
        expect(await inEffect()).toEqual([]);
        expect(
          (
            await fails(
              call(pools['approver1'], 'mapping_set_deactivate', { mapping_set_id: setA }),
            )
          ).code,
        ).toBe('FI062');
        expect(await statusOf(a)).toBe('accepted');
        // a set cannot be edited or have two active at once
        expect(
          (
            await fails(
              owner.query(`UPDATE mapping_set SET code = 'renamed-${tag}' WHERE id = $1`, [setA]),
            )
          ).code,
        ).toBe('FI027');
        const events = await rows(
          owner,
          `SELECT event_type FROM identity_review_event WHERE mapping_set_id = $1 ORDER BY id`,
          [setA],
        );
        expect(events.map((e) => e.event_type)).toEqual(
          expect.arrayContaining([
            'mapping_set_created',
            'mapping_set_activated',
            'mapping_set_deactivated',
          ]),
        );
      });

      it('concurrent activations never leave two active sets', async () => {
        const sets = [await newSet(), await newSet(), await newSet()];
        const results = await Promise.allSettled([
          call(pools['approver1'], 'mapping_set_activate', { mapping_set_id: sets[0] }),
          call(pools['approver2'], 'mapping_set_activate', { mapping_set_id: sets[1] }),
          call(pools['approver1'], 'mapping_set_activate', { mapping_set_id: sets[2] }),
        ]);
        expect(
          results.every((r) => r.status === 'fulfilled'),
          JSON.stringify(results.filter((r) => r.status === 'rejected')),
        ).toBe(true);
        const active = await rows(
          owner,
          `SELECT count(*)::int AS n FROM mapping_set WHERE status = 'active'`,
        );
        expect(active[0].n).toBe(1);
      });
    });

    describe('integrity: nothing is applied to the registry', () => {
      it('leaves every registry fixture (states, district, markets) byte-identical after all of the above', async () => {
        expect(await registryFingerprint()).toBe(registryHash);
        const m = await rows(
          owner,
          'SELECT district_id, state_id, status FROM markets WHERE id = $1',
          [fx.marketTwo],
        );
        expect(m[0].district_id).toBeNull(); // an accepted decision about this mandi did not set its district
      });

      it('adds no observation rows through the workflow: observations are not referenced by any identity table', async () => {
        // Observation counts are not asserted: other suites share this database and insert their own rows.
        const refs = await rows(
          owner,
          `SELECT count(*)::int AS n FROM information_schema.table_constraints c
             JOIN information_schema.constraint_column_usage u ON u.constraint_name = c.constraint_name
            WHERE c.constraint_type = 'FOREIGN KEY'
              AND u.table_name IN ('mandi_observations', 'state_observations')
              AND c.table_name IN ('mapping_set', 'identity_decision', 'identity_review_event', 'geo_reference_set', 'admin_unit_version')`,
        );
        expect(refs[0].n).toBe(0);
      });
    });
  },
  Boolean(process.env.DATABASE_ADMIN_URL),
);
