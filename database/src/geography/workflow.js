import { requiresTwoReviewers } from './proposals.js';

/**
 * Planning of the independent review workflow (Milestone 2.4, Stage 3b). It REUSES the Stage 3a decision
 * infrastructure (`identity_propose`, `identity_review`, `identity_accept`, `identity_reject`,
 * `identity_withdraw`, the mapping-set functions and the append-only audit log) and adds nothing to the database.
 *
 * What this module does: decide which candidate proposals still need submitting (duplicate prevention),
 * express a proposal as the exact call of `identity_propose`, and state the review policy that the database
 * enforces. What it never does: connect to a database, hold a credential, review, accept or apply anything.
 * Proposing needs a REVIEWER login, which does not exist yet; no account is created by this stage.
 */

/** The review policy, as enforced by the database functions and constraints of migration 0006. */
export const WORKFLOW = Object.freeze({
  states: ['proposed', 'accepted', 'rejected', 'superseded', 'withdrawn'],
  proposal:
    'A reviewer login calls identity_propose; the proposer is the session login and can never review or approve it.',
  evidenceReview:
    'Reviewers record a verdict with identity_review: recommend, reject or needs_evidence. Each reviewer counts once.',
  deferral:
    'A needs_evidence verdict defers a proposal: it blocks acceptance, and a new proposal with new evidence is the way forward (the same evidence is not re-proposed).',
  rejection:
    'identity_reject (approver) or any reject verdict closes the way to acceptance; the decision stays as an audit record.',
  approval:
    'An approver login calls identity_accept into a DRAFT mapping set. The approver is never the proposer or a reviewer of the same decision.',
  twoReviewers:
    'correct_state, merge_markets, class A and every state-level decision need TWO distinct recommending reviewers (generated column requires_two_reviewers).',
  versioning:
    'Accepted decisions belong to a numbered mapping set (draft, then active or inactive, reversible); exactly one set is active.',
  reversal:
    'A later decision about the same label with supersedes_id set replaces an accepted one; across sets the older set is simply deactivated. History is never deleted.',
  audit:
    'identity_review_event is append-only (no UPDATE, DELETE or TRUNCATE, even for the owner).',
  application:
    'Accepting a decision applies NOTHING: no market, district, alias or observation changes. Applying accepted mappings is a separate, separately approved stage.',
});

/**
 * Review requirements of one proposal.
 * @param {any} proposal
 */
export function reviewPolicy(proposal) {
  const two = requiresTwoReviewers(proposal);
  return {
    proposerRole: 'reviewer',
    recommendingReviewersNeeded: two ? 2 : 1,
    approverRole: 'approver',
    highRisk: two,
    reasons: [
      ...(['correct_state', 'merge_markets'].includes(proposal.decisionKind)
        ? [`decision kind ${proposal.decisionKind}`]
        : []),
      ...(proposal.decisionClass === 'A' ? ['class A (ambiguous identity)'] : []),
      ...(proposal.entityKind === 'state' ? ['state-level decision'] : []),
    ],
  };
}

/**
 * Which candidates to submit and which to skip, given the decisions that already exist.
 *
 * - the same proposal key already proposed or accepted: skipped (no duplicate open proposal);
 * - the same proposal key closed (rejected, withdrawn, superseded) with the SAME evidence: skipped, re-proposing
 *   needs new evidence (a different evidence digest);
 * - the label already has an accepted decision from a different proposal: skipped, a change needs a superseding
 *   decision (`supersedes_id`) chosen by a reviewer;
 * - the same key twice in one batch: only the first is kept.
 *
 * @param {any[]} proposals
 * @param {Array<{ id: string, status: string, proposal_key: string | null, evidence_digest: string | null, source_id: string, entity_kind: string, source_key: string, subject_market_id: string | null, decision_kind: string }>} existing
 */
export function planSubmission(proposals, existing) {
  const toSubmit = [];
  const skipped = [];
  const seen = new Set();
  for (const p of proposals) {
    if (seen.has(p.proposalKey)) {
      skipped.push({ proposalKey: p.proposalKey, reason: 'duplicate_in_batch' });
      continue;
    }
    seen.add(p.proposalKey);
    const same = existing.filter((d) => d.proposal_key === p.proposalKey);
    if (same.some((d) => d.status === 'proposed')) {
      skipped.push({ proposalKey: p.proposalKey, reason: 'already_proposed' });
      continue;
    }
    if (same.some((d) => d.status === 'accepted')) {
      skipped.push({ proposalKey: p.proposalKey, reason: 'already_accepted' });
      continue;
    }
    if (same.some((d) => d.evidence_digest === p.evidenceDigest)) {
      skipped.push({ proposalKey: p.proposalKey, reason: 'same_evidence_already_closed' });
      continue;
    }
    const labelAccepted = existing.find(
      (d) =>
        d.status === 'accepted' &&
        d.source_id === p.sourceId &&
        d.entity_kind === p.entityKind &&
        d.source_key === p.sourceKey &&
        (p.subjectMarketId ?? null) === (d.subject_market_id ?? null) &&
        d.proposal_key !== p.proposalKey,
    );
    if (labelAccepted) {
      skipped.push({
        proposalKey: p.proposalKey,
        reason: 'label_already_decided_needs_supersession',
        supersedes: labelAccepted.id,
      });
      continue;
    }
    toSubmit.push(p);
  }
  return { toSubmit, skipped };
}

/** @type {Array<[string, string | null]>} */
const ARGS = [
  ['p_decision_kind', 'decisionKind'],
  ['p_entity_kind', 'entityKind'],
  ['p_source_id', 'sourceId'],
  ['p_source_key', 'sourceKey'],
  ['p_source_label', 'sourceLabel'],
  ['p_decision_class', 'decisionClass'],
  ['p_rationale', 'rationale'],
  ['p_ruleset_version', null],
  ['p_source_context', 'sourceContext'],
  ['p_subject_market_id', 'subjectMarketId'],
  ['p_target_state_id', 'targetStateId'],
  ['p_target_district_id', 'targetDistrictId'],
  ['p_target_market_id', 'targetMarketId'],
  ['p_target_admin_unit_version_id', 'targetAdminUnitVersionId'],
  ['p_evidence', null],
  ['p_evidence_refs', null],
];

/**
 * The exact `identity_propose` call for a proposal. A REVIEWER login runs it, in its own session; nothing here
 * executes it.
 * @param {any} proposal
 * @returns {{ text: string, values: unknown[] }}
 */
export function toProposeCall(proposal) {
  if (
    proposal.decisionKind === 'correct_state' &&
    !(
      Array.isArray(proposal.evidence?.marketSpecificEvidence) &&
      proposal.evidence.marketSpecificEvidence.length > 0
    )
  )
    throw new Error(
      'refusing to build a state correction without market-specific evidence: a state-level change is not evidence about one mandi',
    );
  const values = [];
  const parts = [];
  for (const [name, field] of ARGS) {
    let value;
    if (name === 'p_ruleset_version') value = proposal.evidence.rulesetVersion;
    else if (name === 'p_evidence') value = JSON.stringify(proposal.evidence);
    else if (name === 'p_evidence_refs') value = proposal.evidenceRefs;
    else value = proposal[/** @type {string} */ (field)] ?? null;
    if (value === null && !['p_source_context'].includes(name)) continue;
    values.push(value);
    const cast = name === 'p_evidence' ? '::jsonb' : name === 'p_evidence_refs' ? '::text[]' : '';
    parts.push(`${name} => $${values.length}${cast}`);
  }
  return { text: `SELECT public.identity_propose(${parts.join(', ')}) AS id`, values };
}

/**
 * Name of a draft mapping set for a batch of accepted decisions, for example `geo-ids-20261022-v1`.
 * @param {Date} date
 * @param {number} version
 */
export const mappingSetCode = (date, version) =>
  `geo-ids-${date.toISOString().slice(0, 10).replaceAll('-', '')}-v${version}`;

/**
 * How to reverse an accepted decision: a NEW proposal about the same label that supersedes it, reviewed like any
 * other. Returns the extra argument of the `identity_propose` call.
 * @param {{ id: string, status: string }} accepted
 */
export function reversalArguments(accepted) {
  if (accepted.status !== 'accepted') throw new Error('only an accepted decision can be reversed');
  return { p_supersedes_id: accepted.id };
}

/** Nothing in this module accepts anything: acceptance is only ever a reviewed act of an approver login. */
export const AUTOMATIC_ACCEPTANCE = false;

/**
 * Why a proposal cannot simply be accepted, whatever the reviewers are asked. An empty list does NOT mean it may be
 * accepted automatically: acceptance always needs the independent reviewers and an approver.
 * @param {any} proposal
 * @returns {string[]}
 */
export function acceptanceBlockers(proposal) {
  const blockers = [];
  const e = proposal.evidence ?? {};
  if (e.notAProof) blockers.push('the evidence is not proof of identity');
  if (proposal.evidenceLevel === 'state_level_only')
    blockers.push('only state-level evidence: it does not identify this mandi');
  if (
    proposal.decisionKind === 'correct_state' &&
    !(Array.isArray(e.marketSpecificEvidence) && e.marketSpecificEvidence.length > 0)
  )
    blockers.push('no market-specific evidence for a state correction');
  if (['mark_unresolved', 'mark_ambiguous'].includes(proposal.decisionKind))
    blockers.push('records an open question, not a mapping');
  if (requiresTwoReviewers(proposal)) blockers.push('needs two distinct recommending reviewers');
  if (proposal.decisionClass === 'H')
    blockers.push('rename or boundary change without a published date');
  return blockers;
}

/**
 * What a failed `identity_propose` call means for a submitter.
 *  duplicate_open      an identical claim is already open (unique index idec_open_proposal_key_uq): not an error
 *  duplicate_evidence  this claim with this evidence was recorded before (idec_proposal_evidence_uq): needs new evidence
 *  retry               a transient conflict (serialization failure, deadlock, lock timeout): try again
 *  refused             a rule of the workflow (FIxxx): do not retry, read the message
 *  error               anything else
 * @param {any} error
 */
export function classifyProposeError(error) {
  const code = error?.code ?? '';
  if (code === '23505' && error?.constraint === 'idec_open_proposal_key_uq')
    return 'duplicate_open';
  if (code === '23505' && error?.constraint === 'idec_proposal_evidence_uq')
    return 'duplicate_evidence';
  if (['40001', '40P01', '55P03'].includes(code)) return 'retry';
  if (/^FI\d{3}$/.test(code)) return 'refused';
  return 'error';
}

/**
 * Submits one proposal as the reviewer login behind `pool`, safely repeatable: a duplicate is reported, not raised,
 * and a transient conflict is retried a few times. The caller owns the pool and its (reviewer) login.
 * @param {{ query: (text: string, values: unknown[]) => Promise<{ rows: any[] }> }} pool
 * @param {any} proposal
 * @param {{ attempts?: number, backoffMs?: number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ status: 'submitted', id: string } | { status: 'duplicate_open' | 'duplicate_evidence' }>}
 */
export async function submitWithRetry(pool, proposal, options = {}) {
  const attempts = options.attempts ?? 3;
  const sleep =
    options.sleep ?? ((/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)));
  const call = toProposeCall(proposal);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await pool.query(call.text, call.values);
      return { status: 'submitted', id: result.rows[0].id };
    } catch (error) {
      const kind = classifyProposeError(error);
      if (kind === 'duplicate_open' || kind === 'duplicate_evidence') return { status: kind };
      if (kind !== 'retry' || attempt >= attempts) throw error;
      await sleep((options.backoffMs ?? 50) * 2 ** (attempt - 1));
    }
  }
}
