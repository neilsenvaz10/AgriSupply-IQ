import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { grantIdentityPrivileges } from '../identity/privileges.js';
import { runMigrations } from '../migrate.js';
import { describeIntegration } from '../test/db.js';
import { assertDisposable, guardedUrl } from '../test/disposable.js';
import { suffix } from '../test/fixtures.js';
import { WORLD, worldRows, worldSnapshot } from '../test/geoFixtures.js';
import { createLogins } from '../test/roles.js';
import { analyse } from './analysis.js';
import { buildProposals } from './proposals.js';
import { readSnapshot } from './snapshot.js';
import {
  classifyProposeError,
  planSubmission,
  submitWithRetry,
  toProposeCall,
} from './workflow.js';

/**
 * The Stage 3b workflow on a verified DISPOSABLE PostgreSQL server, in a database created for this suite: a
 * synthetic geography is loaded, analysed read-only, the candidate proposals are submitted through the REAL
 * identity functions by synthetic reviewer and approver logins, and the review rules are exercised. Nothing in
 * the registry, the aliases or any mandi is ever changed by a decision (a content hash proves it). No real
 * account exists or is created: the logins are temporary and dropped.
 */

const tag = suffix()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');
const DB = `s3a_geo_${tag}`.slice(0, 40);
const REVIEWER = 'fasalytics_reviewer';
const APPROVER = 'fasalytics_approver';

describeIntegration(
  'geographic identity proposals (disposable server, own database, synthetic geography)',
  () => {
    /** @type {pg.Pool} */ let admin;
    /** @type {pg.Pool} */ let adminDb;
    /** @type {pg.Pool} */ let owner;
    /** @type {Awaited<ReturnType<typeof createLogins>>} */ let logins;
    /** @type {Record<string, pg.Pool>} */ const pools = {};
    /** @type {any[]} */ let proposals = [];
    /** @type {any[]} */ let supported = [];
    const world = worldRows();

    const rows = async (pool, text, values = []) => (await pool.query(text, values)).rows;
    const dbUrl = (base, database) => {
      const url = new URL(base);
      url.pathname = `/${database}`;
      return url.toString();
    };
    const registryHash = async () =>
      (
        await rows(
          owner,
          `SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
             SELECT s::text AS x FROM states s UNION ALL SELECT d::text FROM districts d UNION ALL SELECT m::text FROM markets m
             UNION ALL SELECT a::text FROM state_aliases a UNION ALL SELECT a::text FROM district_aliases a UNION ALL SELECT a::text FROM market_aliases a) t`,
        )
      )[0].h;
    const decisionsFor = (key) =>
      rows(
        owner,
        `SELECT id, status FROM identity_decision WHERE evidence->>'proposalKey' = $1 ORDER BY proposed_at`,
        [key],
      );
    const submit = async (as, proposal, extra = {}) => {
      const call = toProposeCall(proposal);
      let { text, values } = call;
      for (const [name, value] of Object.entries(extra)) {
        values = [...values, value];
        text = text.replace(') AS id', `, ${name} => $${values.length}) AS id`);
      }
      return (await pools[as].query(text, values)).rows[0].id;
    };
    const review = (as, id, verdict = 'recommend') =>
      pools[as].query('SELECT public.identity_review(p_decision_id => $1, p_verdict => $2)', [
        id,
        verdict,
      ]);
    const accept = (as, id, setId) =>
      pools[as].query('SELECT public.identity_accept($1, $2)', [id, setId]);
    const newSet = async (as = 'app1') =>
      (
        await pools[as].query('SELECT public.mapping_set_create($1) AS id', [
          `geo-test-${tag}-${Math.random().toString(36).slice(2, 8)}`,
        ])
      ).rows[0].id;
    const failure = async (promise) => {
      try {
        await promise;
      } catch (error) {
        return /** @type {any} */ (error).code;
      }
      return 'NOT REFUSED';
    };
    const pick = (cls, label) =>
      proposals.find((p) => p.evidenceClass === cls && (!label || p.sourceLabel === label));

    beforeAll(async () => {
      await assertDisposable();
      const base = await guardedUrl('DATABASE_ADMIN_URL');
      const migrationBase = await guardedUrl('DATABASE_MIGRATION_URL');
      admin = new pg.Pool({ connectionString: base, max: 2 });
      const migrator = new URL(migrationBase).username;
      await admin.query(`CREATE DATABASE ${DB} OWNER ${migrator}`);
      await admin.query(
        `ALTER DATABASE ${DB} SET fasalytics.disposable_token = '${process.env.FASALYTICS_DISPOSABLE_TOKEN}'`,
      );
      const ownerUrl = dbUrl(migrationBase, DB);
      await runMigrations(ownerUrl);
      owner = new pg.Pool({ connectionString: ownerUrl, max: 3 });
      adminDb = new pg.Pool({ connectionString: dbUrl(base, DB), max: 3 });
      await grantIdentityPrivileges(ownerUrl);
      logins = await createLogins(adminDb, tag, {
        revA: REVIEWER,
        revB: REVIEWER,
        revC: REVIEWER,
        app1: APPROVER,
        app2: APPROVER,
      });
      for (const key of Object.keys(logins.logins)) pools[key] = logins.poolFor(ownerUrl, key);

      // the synthetic geography, with the deterministic ids of the fixture
      const w = world;
      await owner.query(
        `INSERT INTO data_sources (id, code, name, source_type) VALUES ($1, $2, 'Synthetic source A', 'other')`,
        [w.sourceId, WORLD.sourceCode],
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
          [
            m.alias_source_id,
            m.alias_source_key,
            m.alias_source_label,
            m.alias_source_context,
            m.id,
          ],
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
      const client = await owner.connect();
      try {
        const snapshot = await readSnapshot(client);
        proposals = buildProposals(analyse(snapshot));
        // the same geography with market-specific evidence supplied from outside the database for both Betamandi mandis
        const beta = WORLD.states.find((x) => x.key === 'beta');
        const evidence = new Map(
          w.markets
            .filter((m) => m.name.startsWith('Betamandi'))
            .map((m) => [
              m.id,
              [
                {
                  type: 'official_market_listing',
                  stateLgdCode: beta?.lgd,
                  reference: `synthetic-listing:${m.name}`,
                },
              ],
            ]),
        );
        supported = buildProposals(analyse(snapshot, { marketEvidence: evidence }));
      } finally {
        client.release();
      }
    }, 120_000);

    afterAll(async () => {
      for (const p of Object.values(pools)) await p.end().catch(() => undefined);
      await owner?.end();
      await logins?.drop().catch(() => undefined);
      await adminDb?.end();
      await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await admin?.end();
    });

    it('reads the database snapshot read-only and gets the same findings as the in-memory geography', async () => {
      const before = await registryHash();
      const client = await owner.connect();
      let snapshot;
      try {
        snapshot = await readSnapshot(client);
        expect(
          (await client.query("SELECT current_setting('transaction_read_only') AS v")).rows[0].v,
        ).toBe('off'); // the snapshot's transaction is over
      } finally {
        client.release();
      }
      const shape = (a) =>
        a.findings.map((f) => [
          f.type,
          f.key,
          f.classification,
          (f.candidates ?? []).map((c) => c.lgdCode ?? c.name),
        ]);
      expect(shape(analyse(snapshot))).toEqual(shape(analyse(worldSnapshot())));
      expect(await registryHash()).toBe(before);
      expect(proposals.length).toBeGreaterThan(0);
    });

    it('analyses only with a login that can read and nothing else', async () => {
      // the owner, the administrator and a login that may write decisions are all refused ...
      for (const pool of [owner, adminDb]) {
        const client = await pool.connect();
        try {
          await expect(readSnapshot(client, { requireLowPrivilege: true })).rejects.toThrow(
            /more than read access/,
          );
        } finally {
          client.release();
        }
      }
      // ... and a login with SELECT only is accepted
      const reader = logins.logins.revC.name;
      await adminDb.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${reader}`);
      const client = await pools.revC.connect();
      try {
        const snapshot = await readSnapshot(client, { requireLowPrivilege: true });
        expect(snapshot.identity.login).toBe(reader);
        expect(snapshot.units.length).toBe(world.units.length);
        // the analysis session can write nothing: a write in a fresh transaction by that login is denied
        await expect(client.query('UPDATE markets SET name = name')).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        client.release();
      }
    });

    it('refuses to read through a connection that is not read only', async () => {
      const fake = {
        query: async (text) => ({ rows: text.startsWith('BEGIN') ? [] : [{ v: 'off' }] }),
      };
      await expect(readSnapshot(/** @type {any} */ (fake))).rejects.toThrow(/not read only/);
    });

    it('submits the candidates through the real function as a reviewer, once, and never twice', async () => {
      const exact = pick('exact_official_name');
      await submit('revA', exact);
      const id = (await decisionsFor(exact.proposalKey))[0];
      expect(id.status).toBe('proposed');
      const stored = (
        await rows(
          owner,
          'SELECT evidence, proposed_by, decision_class, evidence_refs FROM identity_decision WHERE id = $1',
          [id.id],
        )
      )[0];
      expect(stored.evidence).toMatchObject({
        proposalKey: exact.proposalKey,
        evidenceClass: 'exact_official_name',
        notAProof: false,
      });
      expect(stored.proposed_by).toBe(logins.logins.revA.name);
      expect(stored.decision_class).toBe('S');
      expect(stored.evidence_refs.length).toBeGreaterThan(0);
      // a second plan sees the open proposal and skips it
      const existing = await rows(
        owner,
        `SELECT id, status, decision_kind, entity_kind, source_id, source_key, subject_market_id, evidence->>'proposalKey' AS proposal_key, evidence->>'evidenceDigest' AS evidence_digest FROM identity_decision`,
      );
      const plan = planSubmission(proposals, existing);
      expect(plan.skipped).toEqual([
        { proposalKey: exact.proposalKey, reason: 'already_proposed' },
      ]);
      expect(plan.toSubmit).toHaveLength(proposals.length - 1);
    });

    it('rolls a whole batch back when one proposal in it is invalid, and the database refuses a wrong proposal outright', async () => {
      const before = (await rows(owner, 'SELECT count(*)::int AS n FROM identity_decision'))[0].n;
      const client = await pools.revA.connect();
      try {
        await client.query('BEGIN');
        const rename = pick('documented_rename');
        const call = toProposeCall(rename);
        await client.query(call.text, call.values);
        await expect(
          client.query(call.text, ['not_a_kind', ...call.values.slice(1)]),
        ).rejects.toThrow();
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect((await rows(owner, 'SELECT count(*)::int AS n FROM identity_decision'))[0].n).toBe(
        before,
      );
      // a map_label to a unit of the wrong type is refused by the database (state decision to a district unit)
      const exact = pick('exact_official_name');
      const wrongUnit = world.units.find((u) => u.unit_type === 'state' && u.is_latest_version).id;
      expect(
        await failure(
          submit('revA', {
            ...exact,
            proposalKey: 'wrong-unit',
            targetAdminUnitVersionId: wrongUnit,
          }),
        ),
      ).toBe('FI030');
    });

    it('lets an ordinary candidate (exact name, class S) go through one reviewer and one approver, changing nothing in the registry', async () => {
      const before = await registryHash();
      const exact = pick('exact_official_name');
      const { id } = (await decisionsFor(exact.proposalKey))[0];
      expect(await failure(review('revA', id))).toBe('FI041'); // the proposer cannot review their own proposal
      expect(await failure(accept('app1', id, await newSet()))).toBe('FI056'); // no recommending reviewer yet
      await review('revB', id);
      expect(await failure(accept('revC', id, await newSet()))).toBe('42501'); // a reviewer cannot approve
      const setId = await newSet();
      await accept('app1', id, setId);
      expect((await decisionsFor(exact.proposalKey))[0].status).toBe('accepted');
      expect(await registryHash()).toBe(before);
      // the same approver cannot be a reviewer, and an approver cannot propose
      expect(await failure(submit('app1', pick('documented_rename')))).toBe('42501');
    });

    it('needs two distinct recommending reviewers for the high-risk state correction, and records nothing in the registry', async () => {
      const before = await registryHash();
      const corrections = supported.filter((p) => p.decisionKind === 'correct_state');
      expect(corrections).toHaveLength(2);
      const p = corrections[0];
      const id = await submit('revA', p);
      expect(
        (
          await rows(owner, 'SELECT requires_two_reviewers FROM identity_decision WHERE id = $1', [
            id,
          ])
        )[0].requires_two_reviewers,
      ).toBe(true);
      await review('revB', id);
      const setId = await newSet();
      expect(await failure(accept('app1', id, setId))).toBe('FI056'); // one reviewer is not enough
      expect(await failure(review('revB', id))).toBe('FI042'); // a reviewer counts once
      await review('revC', id);
      expect(await failure(accept('revA', id, setId))).toBe('42501');
      await accept('app1', id, setId);
      expect((await decisionsFor(p.proposalKey))[0].status).toBe('accepted');
      // the mandi still belongs to the state the source gave it
      const market = (
        await rows(owner, 'SELECT state_id, district_id FROM markets WHERE id = $1', [
          p.subjectMarketId,
        ])
      )[0];
      expect(market.state_id).not.toBe(p.targetStateId);
      expect(market.district_id).toBeNull();
      expect(await registryHash()).toBe(before);
    });

    it('treats ambiguity as high risk too (class A needs two reviewers)', async () => {
      const p = pick('ambiguous');
      const id = await submit('revA', p);
      await review('revB', id);
      expect(await failure(accept('app1', id, await newSet()))).toBe('FI056');
    });

    it('defers on a needs_evidence verdict, rejects on request, and does not re-propose the same evidence', async () => {
      const rename = pick('documented_rename');
      const id = await submit('revA', rename);
      await review('revB', id, 'needs_evidence');
      await review('revC', id);
      expect(await failure(accept('app1', id, await newSet()))).toBe('FI055'); // deferred: blocked until new evidence
      await pools.app2.query('SELECT public.identity_reject($1, $2)', [
        id,
        'insufficient evidence for the rename date',
      ]);
      expect((await decisionsFor(rename.proposalKey))[0].status).toBe('rejected');
      const existing = await rows(
        owner,
        `SELECT id, status, decision_kind, entity_kind, source_id, source_key, subject_market_id, evidence->>'proposalKey' AS proposal_key, evidence->>'evidenceDigest' AS evidence_digest FROM identity_decision`,
      );
      expect(planSubmission([rename], existing).skipped[0].reason).toBe(
        'same_evidence_already_closed',
      );
      // new evidence (another digest) may be proposed again
      expect(
        planSubmission([{ ...rename, evidenceDigest: 'new-evidence' }], existing).toSubmit,
      ).toHaveLength(1);
    });

    it('records the name-only candidates only as unresolved, with the candidate noted, and an ordinary review suffices', async () => {
      const p = pick('name_only_candidate', 'palakadx');
      const id = await submit('revA', p);
      const row = (
        await rows(
          owner,
          'SELECT decision_kind, decision_class, target_district_id, target_admin_unit_version_id, evidence FROM identity_decision WHERE id = $1',
          [id],
        )
      )[0];
      expect(row).toMatchObject({
        decision_kind: 'mark_unresolved',
        decision_class: 'U',
        target_district_id: null,
        target_admin_unit_version_id: null,
      });
      expect(row.evidence.candidates[0]).toMatchObject({
        lgdCode: 990103,
        rung: 'spelling_variant',
      });
    });

    it('reverses an accepted decision with a superseding decision about the same label, and keeps the history', async () => {
      const exact = pick('exact_official_name');
      const accepted = (await decisionsFor(exact.proposalKey))[0];
      const setRow = (
        await rows(owner, 'SELECT mapping_set_id FROM identity_decision WHERE id = $1', [
          accepted.id,
        ])
      )[0];
      const replacement = {
        ...exact,
        proposalKey: 'reversal',
        evidenceDigest: 'reversal-digest',
        evidence: { ...exact.evidence, proposalKey: 'reversal', evidenceDigest: 'reversal-digest' },
        rationale: 'reversal after review: the label belongs elsewhere',
      };
      const newId = await submit('revA', replacement, { p_supersedes_id: accepted.id });
      await review('revB', newId);
      await accept('app1', newId, setRow.mapping_set_id);
      const states = await rows(
        owner,
        'SELECT id, status, supersedes_id FROM identity_decision WHERE id = ANY($1) ORDER BY proposed_at',
        [[accepted.id, newId]],
      );
      expect(states.map((s) => s.status)).toEqual(['superseded', 'accepted']);
      expect(states[1].supersedes_id).toBe(accepted.id);
      const events = await rows(
        owner,
        `SELECT event_type FROM identity_review_event WHERE decision_id = $1 ORDER BY id`,
        [accepted.id],
      );
      expect(events.map((e) => e.event_type)).toEqual([
        'proposed',
        'reviewed',
        'accepted',
        'superseded',
      ]);
    });

    it('keeps the suspected state mismatches pending: the unsupported mandis are recorded as open questions, one reviewer, registry untouched', async () => {
      const before = await registryHash();
      const pending = proposals.filter((p) => p.evidenceClass === 'state_mismatch');
      expect(pending).toHaveLength(2);
      for (const p of pending) {
        expect(p.decisionKind).toBe('mark_unresolved');
        const id = await submit('revA', p);
        const row = (
          await rows(
            owner,
            'SELECT decision_kind, target_state_id, subject_market_id, requires_two_reviewers, evidence FROM identity_decision WHERE id = $1',
            [id],
          )
        )[0];
        expect(row).toMatchObject({
          decision_kind: 'mark_unresolved',
          target_state_id: null,
          subject_market_id: p.subjectMarketId,
          requires_two_reviewers: false,
        });
        expect(row.evidence).toMatchObject({
          evidenceLevel: 'state_level_only',
          marketSpecificEvidence: [],
        });
      }
      expect(await registryHash()).toBe(before);
    });

    it('refuses to accept a state correction that has no market-specific evidence, whatever the reviewers say', async () => {
      const betaState = /** @type {any} */ (world.states.find((x) => x.name === 'Beta'));
      const betaUnit = /** @type {any} */ (
        world.units.find(
          (u) =>
            u.unit_type === 'state' &&
            u.lgd_code === 990002 &&
            u.is_latest_version &&
            u.set_code.includes('pages'),
        )
      );
      const market = /** @type {any} */ (world.markets.find((m) => m.name === 'Betamandi One'));
      const propose = (evidence) =>
        pools.revA.query(
          `SELECT public.identity_propose(p_decision_kind => 'correct_state', p_entity_kind => 'market', p_source_id => $1, p_source_key => $2, p_source_label => 'Betamandi One',
             p_decision_class => 'H', p_rationale => 'test', p_ruleset_version => 'test-1', p_subject_market_id => $3, p_target_state_id => $4,
             p_target_admin_unit_version_id => $5, p_evidence => $6::jsonb) AS id`,
          [
            world.sourceId,
            `unsupported-state-correction-${Math.random()}`,
            market.id,
            betaState.id,
            betaUnit.id,
            JSON.stringify(evidence),
          ],
        );
      const noEvidence = (await propose({ note: 'only a district label points to Beta' })).rows[0]
        .id;
      await review('revB', noEvidence);
      await review('revC', noEvidence);
      const setId = await newSet();
      expect(await failure(accept('app1', noEvidence, setId))).toBe('FI057');
      expect(
        (await rows(owner, 'SELECT status FROM identity_decision WHERE id = $1', [noEvidence]))[0]
          .status,
      ).toBe('proposed');
      for (const bad of [
        { marketSpecificEvidence: [] },
        { marketSpecificEvidence: 'yes' },
        { marketSpecificEvidence: {} },
      ]) {
        const id = (await propose(bad)).rows[0].id;
        await review('revB', id);
        await review('revC', id);
        expect(await failure(accept('app1', id, setId)), JSON.stringify(bad)).toBe('FI057');
      }
      // with an entry it is accepted (two reviewers and an approver, as always), and still changes no mandi
      const before = await registryHash();
      const ok = (
        await propose({
          marketSpecificEvidence: [
            { type: 'official_market_listing', stateLgdCode: 990002, reference: 'doc-1' },
          ],
        })
      ).rows[0].id;
      await review('revB', ok);
      await review('revC', ok);
      await accept('app1', ok, setId);
      expect(
        (await rows(owner, 'SELECT status FROM identity_decision WHERE id = $1', [ok]))[0].status,
      ).toBe('accepted');
      expect(await registryHash()).toBe(before);
    });

    it('stops a duplicate open proposal at the database, and the same evidence again, whatever its status', async () => {
      const open = pick('name_only_candidate', 'palakadx'); // still open since an earlier test
      const exact = pick('exact_official_name'); // accepted and then superseded since
      // already open since the first test: the unique index refuses a second identical claim
      let error;
      try {
        await submit('revB', open);
      } catch (e) {
        error = e;
      }
      expect(error).toMatchObject({ code: '23505', constraint: 'idec_open_proposal_key_uq' });
      expect(classifyProposeError(error)).toBe('duplicate_open');
      await expect(submitWithRetry(pools.revC, open)).resolves.toEqual({
        status: 'duplicate_open',
      });
      // a claim that was accepted (and later superseded) cannot be recorded again with the same evidence either
      await expect(submitWithRetry(pools.revC, exact)).resolves.toEqual({
        status: 'duplicate_evidence',
      });
      // a rejected claim cannot come back with the same evidence ...
      const rename = pick('documented_rename');
      await expect(submitWithRetry(pools.revC, rename)).resolves.toEqual({
        status: 'duplicate_evidence',
      });
      // ... but can with new evidence (a different digest)
      const better = {
        ...rename,
        evidenceDigest: 'new-evidence',
        evidence: { ...rename.evidence, evidenceDigest: 'new-evidence' },
      };
      expect((await submitWithRetry(pools.revC, better)).status).toBe('submitted');
      // a hand-made proposal without keys is not affected
      const handmade = () =>
        pools.revA.query(
          `SELECT public.identity_propose(p_decision_kind => 'mark_unresolved', p_entity_kind => 'district', p_source_id => $1, p_source_key => 'district|alpha|handmade', p_source_label => 'handmade', p_decision_class => 'U', p_rationale => 'x', p_ruleset_version => 'test-1', p_evidence => '{}'::jsonb)`,
          [world.sourceId],
        );
      await handmade();
      await handmade();
    });

    it('lets exactly one of several concurrent identical submissions win, and the others report a duplicate', async () => {
      const p = proposals.find((x) => x.sourceLabel === 'undateddist');
      const results = await Promise.all(
        ['revA', 'revB', 'revC'].map((who) => submitWithRetry(pools[who], p)),
      );
      expect(results.filter((r) => r.status === 'submitted')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'duplicate_open')).toHaveLength(2);
      expect(await decisionsFor(p.proposalKey)).toHaveLength(1);
      // repeating the whole batch changes nothing
      for (const p2 of proposals) await submitWithRetry(pools.revA, p2).catch(() => undefined);
      const count = (await rows(owner, 'SELECT count(*)::int AS n FROM identity_decision'))[0].n;
      for (const p2 of proposals) await submitWithRetry(pools.revA, p2).catch(() => undefined);
      expect((await rows(owner, 'SELECT count(*)::int AS n FROM identity_decision'))[0].n).toBe(
        count,
      );
    });

    it('leaves the audit log append-only and the registry, aliases and mandis exactly as the sources gave them', async () => {
      const refusals = [];
      for (const sql of [
        'UPDATE identity_review_event SET note = $1',
        'DELETE FROM identity_review_event WHERE $1::text IS NOT NULL',
      ]) {
        try {
          await owner.query(sql, ['x']);
          refusals.push('ALLOWED');
        } catch (error) {
          refusals.push(/** @type {any} */ (error).code);
        }
      }
      expect(refusals).toEqual(['55000', '55000']);
      const obs = await rows(owner, 'SELECT count(*)::int AS n FROM mandi_observations');
      expect(obs[0].n).toBe(0); // the synthetic geography has none; nothing was created
      const unresolved = await rows(
        owner,
        `SELECT count(*)::int AS n FROM district_aliases WHERE resolution_status = 'unresolved'`,
      );
      expect(unresolved[0].n).toBe(WORLD.unresolved.length); // no alias was resolved by any decision
    });
  },
  Boolean(process.env.DATABASE_ADMIN_URL),
);
