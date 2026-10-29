import { tableFingerprint, fingerprintDifferences } from '../reference/devLoad/fingerprint.js';
import { interpretInEffect, resolveLabel } from './interpret.js';
import { submitWithRetry, toProposeCall } from './workflow.js';

/**
 * Rehearsal of the COMPLETE review workflow (Milestone 2.4, Stage 3c) with SYNTHETIC reviewer and approver logins.
 *
 * It must only ever be given pools connected to a verified DISPOSABLE database (the callers check): it creates
 * decisions, reviews and mapping sets, and so it writes. It never touches the registry, the aliases or any
 * observation, and it proves that: the fingerprint of every other table is taken before and compared after.
 *
 * `pools` are connections of five distinct synthetic logins: revA, revB, revC (reviewers), app1, app2 (approvers).
 * `owner` can read every table. `reader` is a login with SELECT only (it stands for an API).
 *
 * @param {object} input
 * @param {{ query: Function, connect: Function }} input.owner
 * @param {Record<'revA' | 'revB' | 'revC' | 'app1' | 'app2', any>} input.pools
 * @param {{ query: Function }} input.reader
 * @param {Record<'revA' | 'revB' | 'revC' | 'app1' | 'app2', string>} input.names the login names, as the audit log records them
 * @param {any[]} input.proposals five pilot proposals (see pilot.js)
 * @param {string} input.tag short unique text for mapping-set codes
 * @returns {Promise<{ checks: Array<{ name: string, ok: boolean, detail?: string }>, summary: any }>}
 */
export async function runRehearsal({ owner, pools, reader, names, proposals, tag }) {
  if (proposals.length < 5) throw new Error('the rehearsal needs five pilot proposals');
  const [p0, p1, p2, p3, p4] = proposals;
  /** @type {Array<{ name: string, ok: boolean, detail?: string }>} */
  const checks = [];
  const check = (
    /** @type {string} */ name,
    /** @type {boolean} */ ok,
    /** @type {string} */ detail = '',
  ) => checks.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) });
  const rows = async (/** @type {string} */ text, values = []) =>
    (await owner.query(text, values)).rows;
  const codeOf = async (/** @type {Promise<any>} */ promise) => {
    try {
      await promise;
      return 'NOT REFUSED';
    } catch (error) {
      return /** @type {any} */ (error).code ?? String(error);
    }
  };
  const IDENTITY = ['identity_decision', 'mapping_set', 'identity_review_event'];
  const fingerprint = async () => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const f = await tableFingerprint(client);
      await client.query('ROLLBACK');
      return f;
    } finally {
      client.release();
    }
  };
  const review = (/** @type {any} */ who, /** @type {string} */ id, verdict = 'recommend') =>
    pools[who].query('SELECT public.identity_review(p_decision_id => $1, p_verdict => $2)', [
      id,
      verdict,
    ]);
  const accept = (/** @type {any} */ who, /** @type {string} */ id, /** @type {string} */ setId) =>
    pools[who].query('SELECT public.identity_accept($1, $2)', [id, setId]);
  const newSet = async (/** @type {any} */ who, /** @type {string} */ suffix) =>
    (
      await pools[who].query('SELECT public.mapping_set_create($1) AS id', [
        `rehearsal-${tag}-${suffix}`,
      ])
    ).rows[0].id;
  const status = async (/** @type {string} */ id) =>
    (await rows('SELECT status FROM identity_decision WHERE id = $1', [id]))[0]?.status;

  const before = await fingerprint();

  // ---- proposals, duplicates, attribution of the proposer
  const ids = [];
  for (const p of [p0, p1, p2, p3, p4]) {
    const r = await submitWithRetry(pools.revA, p);
    check(`proposal ${p.sourceLabel} submitted`, r.status === 'submitted', r.status);
    ids.push(/** @type {any} */ (r).id);
  }
  const proposedBy = await rows(
    'SELECT DISTINCT proposed_by FROM identity_decision WHERE id = ANY($1)',
    [ids],
  );
  check(
    'every proposal is attributed to the proposer login, not to a parameter',
    proposedBy.length === 1 && proposedBy[0].proposed_by === names.revA,
  );
  check(
    'a second identical submission is reported as a duplicate, by another reviewer too',
    (await submitWithRetry(pools.revB, p0)).status === 'duplicate_open',
  );
  check(
    'no proposal changed state by being proposed',
    (await Promise.all(ids.map(status))).every((s) => s === 'proposed'),
  );

  // ---- privilege enforcement
  check(
    'a reviewer cannot accept',
    (await codeOf(accept('revB', ids[0], await newSet('app1', 'probe')))) === '42501',
  );
  check(
    'an approver cannot propose',
    (await codeOf(pools.app1.query(toProposeCall(p0).text, toProposeCall(p0).values))) === '42501',
  );
  check(
    'a read-only login cannot run any identity function',
    (await codeOf(reader.query('SELECT public.mapping_set_create($1)', ['x']))) === '42501',
  );
  check(
    'nobody writes the tables directly',
    (await codeOf(
      pools.revA.query("INSERT INTO identity_decision (decision_kind) VALUES ('map_label')"),
    )) === '42501' &&
      (await codeOf(pools.app1.query("UPDATE identity_decision SET status = 'accepted'"))) ===
        '42501',
  );
  check(
    'the proposer cannot review their own proposal',
    (await codeOf(review('revA', ids[0]))) === 'FI041',
  );
  check(
    'acceptance without a review is refused',
    (await codeOf(accept('app1', ids[0], await newSet('app1', 'probe2')))) === 'FI056',
  );

  // ---- concurrent reviewers
  await Promise.all([review('revB', ids[0]), review('revC', ids[0])]);
  const reviews0 = await rows(
    "SELECT actor FROM identity_review_event WHERE decision_id = $1 AND event_type = 'reviewed' ORDER BY actor",
    [ids[0]],
  );
  check(
    'two reviewers reviewing at the same time are both recorded, once each',
    reviews0.length === 2 && reviews0[0].actor !== reviews0[1].actor,
  );

  // ---- concurrent approvers: exactly one acceptance
  const setA = await newSet('app1', 'a');
  const setB = await newSet('app2', 'b');
  const race = await Promise.allSettled([
    accept('app1', ids[0], setA),
    accept('app2', ids[0], setB),
  ]);
  const won = race.filter((r) => r.status === 'fulfilled').length;
  check(
    'two approvers accepting the same decision at once: exactly one wins',
    won === 1,
    `${won} accepted`,
  );
  check(
    'the loser is told the decision is no longer proposed',
    race.some((r) => r.status === 'rejected' && /** @type {any} */ (r.reason).code === 'FI051'),
  );
  const winnerSet = (
    await rows('SELECT mapping_set_id FROM identity_decision WHERE id = $1', [ids[0]])
  )[0].mapping_set_id;
  check(
    'the decision is accepted into exactly one mapping set',
    Boolean(winnerSet) && (await status(ids[0])) === 'accepted',
  );

  // ---- rejection
  await review('revB', ids[1]);
  await pools.app2.query('SELECT public.identity_reject($1, $2)', [
    ids[1],
    'rehearsal: rejected on review',
  ]);
  check('a rejected proposal is closed', (await status(ids[1])) === 'rejected');
  check(
    'rejected evidence cannot simply be proposed again',
    (await submitWithRetry(pools.revC, p1)).status === 'duplicate_evidence',
  );
  const better = {
    ...p1,
    evidenceDigest: 'new-evidence',
    evidence: { ...p1.evidence, evidenceDigest: 'new-evidence' },
  };
  check(
    'new evidence for a rejected claim can be proposed',
    (await submitWithRetry(pools.revC, better)).status === 'submitted',
  );

  // ---- deferral
  await review('revB', ids[2], 'needs_evidence');
  await review('revC', ids[2]);
  check(
    'a needs_evidence verdict defers: acceptance is blocked',
    (await codeOf(accept('app1', ids[2], winnerSet))) === 'FI055',
  );
  check('the deferred proposal stays proposed', (await status(ids[2])) === 'proposed');

  // ---- supersession inside the draft set, and a straightforward acceptance
  await review('revB', ids[3]);
  await accept('app1', ids[3], winnerSet);
  const replacement = {
    ...p3,
    evidenceDigest: 'reversal-evidence',
    evidence: { ...p3.evidence, evidenceDigest: 'reversal-evidence' },
    rationale: 'rehearsal: reversal after review',
  };
  const call = toProposeCall(replacement);
  const newId = (
    await pools.revA.query(
      call.text.replace(') AS id', ', p_supersedes_id => $' + (call.values.length + 1) + ') AS id'),
      [...call.values, ids[3]],
    )
  ).rows[0].id;
  await review('revB', newId);
  await accept('app2', newId, winnerSet);
  check(
    'a superseding decision closes the old one inside the draft set',
    (await status(ids[3])) === 'superseded' && (await status(newId)) === 'accepted',
  );
  await review('revC', ids[4]);
  await accept('app2', ids[4], winnerSet);

  // ---- audit attribution
  const events = await rows(
    'SELECT id, event_type, actor, actor_role FROM identity_review_event ORDER BY id',
  );
  const known = new Set(Object.values(names));
  check(
    'every audit event names one of the synthetic logins',
    events.every((e) => known.has(e.actor)),
  );
  check(
    'actors acted only in their own role',
    events.every(
      (e) =>
        (e.actor_role === 'reviewer') === [names.revA, names.revB, names.revC].includes(e.actor),
    ),
  );
  check(
    'the proposer of each decision is the reviewer login that proposed it',
    (
      await rows(
        `SELECT count(*)::int AS n FROM identity_review_event e JOIN identity_decision d ON d.id = e.decision_id
          WHERE e.event_type = 'proposed' AND (e.actor <> d.proposed_by OR e.actor_role <> 'reviewer')`,
      )
    )[0].n === 0,
  );
  check(
    'acceptances were made by approver logins who did not propose or review the decision',
    (
      await rows(
        `SELECT count(*)::int AS n FROM identity_decision d WHERE d.status IN ('accepted','superseded') AND (d.accepted_by = d.proposed_by OR EXISTS (SELECT 1 FROM identity_review_event e WHERE e.decision_id = d.id AND e.event_type = 'reviewed' AND e.actor = d.accepted_by))`,
      )
    )[0].n === 0,
  );
  check(
    'the audit log is append-only even for the owner',
    (await codeOf(owner.query("UPDATE identity_review_event SET note = 'x'"))) === '55000' &&
      (await codeOf(owner.query('DELETE FROM identity_review_event'))) === '55000',
  );

  // ---- read-only interpretation: nothing is in effect until the set is activated
  const inEffect = async () =>
    (await reader.query('SELECT * FROM identity_decision_in_effect')).rows;
  check('before activation nothing is in effect', (await inEffect()).length === 0);
  await pools.app1.query('SELECT public.mapping_set_activate($1)', [winnerSet]);
  const active = interpretInEffect(await inEffect());
  check(
    'after activation exactly the accepted decisions are in effect',
    active.count === 3 && active.conflicts.length === 0,
    `${active.count} in effect`,
  );
  const asked = (/** @type {any} */ p) => ({
    sourceId: p.sourceId,
    entityKind: p.entityKind,
    sourceKey: p.sourceKey,
  });
  check(
    'a reader resolves an accepted label to the proposed district, without applying anything',
    resolveLabel(active, asked(p0))?.targetDistrictId === p0.targetDistrictId &&
      active.applied === false,
  );
  check(
    'the superseded label is answered by its replacement',
    resolveLabel(active, asked(p3))?.decisionId === newId,
  );
  check(
    'rejected, deferred and unproposed labels resolve to nothing',
    resolveLabel(active, asked(p1)) === null && resolveLabel(active, asked(p2)) === null,
  );
  await pools.app1.query('SELECT public.mapping_set_deactivate($1)', [winnerSet]);
  check(
    'deactivating the set takes every decision out of effect (reversal)',
    (await inEffect()).length === 0,
  );

  // ---- acceptance rewrote nothing
  const after = await fingerprint();
  const changed = fingerprintDifferences(before, after, IDENTITY);
  check(
    'no other table changed: registry, aliases, mandis, reference and every observation row are identical',
    changed.length === 0,
    changed.join(', '),
  );
  check(
    'the identity tables hold exactly this rehearsal',
    Number((await rows('SELECT count(*)::int AS n FROM identity_decision'))[0].n) >= 7,
  );
  const summary = {
    decisions: await rows(
      'SELECT status, count(*)::int AS n FROM identity_decision GROUP BY 1 ORDER BY 1',
    ),
    events: events.length,
    otherTablesChanged: changed,
    observations: Object.fromEntries(
      [
        'mandi_observations',
        'state_observations',
        'national_monthly_prices',
        'wpi_observations',
      ].map((t) => [t, after[t]?.rows]),
    ),
  };
  return { checks, summary };
}
