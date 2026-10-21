import { describe, expect, it } from 'vitest';
import { WORLD, worldRows, worldSnapshot } from '../test/geoFixtures.js';
import { analyse, summarise } from './analysis.js';
import {
  compactName,
  digestOf,
  editDistance,
  isSpellingVariant,
  normalizeName,
} from './normalize.js';
import {
  PROPOSAL_RULESET,
  buildProposals,
  countByClass,
  isMarketSpecificEvidence,
  requiresTwoReviewers,
} from './proposals.js';
import {
  AUTOMATIC_ACCEPTANCE,
  WORKFLOW,
  acceptanceBlockers,
  classifyProposeError,
  mappingSetCode,
  planSubmission,
  reversalArguments,
  reviewPolicy,
  submitWithRetry,
  toProposeCall,
} from './workflow.js';

/** Discrepancy analysis, candidate proposals and submission planning: pure functions, no database. */

const byLabel = (analysis, label) =>
  analysis.findings.find((f) => f.type === 'unresolved_district_alias' && f.source.label === label);

/** Market-specific evidence for both Betamandi mandis, as a reviewer would supply it from an official listing. */
const betaEvidence = () => {
  const rows = worldRows();
  const beta = WORLD.states.find((s) => s.key === 'beta');
  return new Map(
    rows.markets
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
};

describe('name rules', () => {
  it('normalises exactly like the registry and compares without spaces or punctuation', () => {
    expect(normalizeName('  Yamuna   NAGAR ')).toBe('yamuna nagar');
    expect(compactName('Janjgir-Champa')).toBe('janjgirchampa');
  });
  it('nominates spelling variants only within a small edit distance, never for very short names', () => {
    expect(editDistance('palakad', 'palakkad')).toBe(1);
    expect(isSpellingVariant('palakadx', 'palakkadx')).toBe(true);
    expect(isSpellingVariant('abc', 'abd')).toBe(false);
    expect(isSpellingVariant('gao', 'goa')).toBe(true);
    expect(isSpellingVariant('kanpur', 'chennai')).toBe(false);
    expect(isSpellingVariant('nagpur', 'nagpur')).toBe(false);
  });
  it('gives equal text and hashes for equal content whatever the key order', () => {
    expect(digestOf({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      digestOf({ a: [2, { c: 2, d: 1 }], b: 1 }),
    );
  });
});

describe('discrepancy analysis', () => {
  const analysis = /** @type {any} */ (analyse(worldSnapshot()));

  it('classifies each unresolved district label by the strongest evidence, never by similarity alone', () => {
    expect(byLabel(analysis, 'north ville').classification).toBe('exact_official_name');
    expect(byLabel(analysis, 'north ville').candidates[0]).toMatchObject({
      lgdCode: 990101,
      detail: 'spaces_or_punctuation_only',
    });
    expect(byLabel(analysis, 'oldname').classification).toBe('documented_rename');
    expect(byLabel(analysis, 'oldname').candidates[0]).toMatchObject({
      lgdCode: 990102,
      name: 'Newname',
      matchedName: 'Oldname',
      renameDate: 'not_published',
    });
    expect(byLabel(analysis, 'palakadx').classification).toBe('name_only_candidate');
    expect(byLabel(analysis, 'kanpurx').classification).toBe('ambiguous');
    expect(byLabel(analysis, 'kanpurx').candidates.map((c) => c.lgdCode)).toEqual([990104, 990105]);
    expect(byLabel(analysis, 'zzzzzz').classification).toBe('unresolved_no_candidate');
  });

  it('keeps a Bangalore-like label ambiguous: a former name of ONE district of a family is not that district', () => {
    // "oldmetro" is a former spelling in the history of Metro Rural only, but Metro Urban, Rural and South share
    // the stem and nothing official says which one the label meant
    const f = byLabel(analysis, 'oldmetro');
    expect(f.classification).toBe('ambiguous');
    expect(f.candidates.map((c) => c.lgdCode)).toEqual([990401, 990402, 990403]);
    expect(f.candidates.every((c) => c.partialNameMatch === true)).toBe(true);
    const proposal = buildProposals(analysis).find((p) => p.sourceLabel === 'oldmetro');
    expect(proposal).toMatchObject({
      decisionKind: 'mark_ambiguous',
      decisionClass: 'A',
      requiresTwoReviewers: true,
    });
    expect(proposal.targetDistrictId ?? null).toBeNull();
    expect(proposal.targetAdminUnitVersionId ?? null).toBeNull();
    // a partial name that has no family stays a plain name-only candidate
    const lone = analyse(
      worldSnapshot({
        ...WORLD,
        districts: [
          ...WORLD.districts,
          {
            code: 990501,
            state: 990001,
            history: ['Janjgir-Champax'],
            status: 'active',
            effective: '2005-01-01',
            baseline: true,
            registry: true,
          },
        ],
        unresolved: [
          {
            state: 'alpha',
            label: 'janjgir',
            markets: [{ name: 'J', obs: 1, first: '2024-01-01', last: '2024-01-02' }],
          },
        ],
      }),
    );
    expect(byLabel(lone, 'janjgir').classification).toBe('name_only_candidate');
  });

  it('flags a suspected state mismatch only when the labelled state has no fit and exactly one other state does', () => {
    const f = byLabel(analysis, 'betadist');
    expect(f.classification).toBe('state_mismatch');
    expect(f.candidates).toHaveLength(1);
    expect(f.candidates[0]).toMatchObject({ lgdCode: 990201, stateName: 'Beta' });
    expect(f.markets.map((m) => m.name)).toEqual(['Betamandi One', 'Betamandi Two']);
    expect(f.uncertainty.geographic).toBe('state_boundary_in_question');
  });

  it('retains the source name, original assignment, dataset provenance and dates of every finding', () => {
    const f = byLabel(analysis, 'oldname');
    expect(f.source).toMatchObject({
      label: 'oldname',
      stateLabel: 'alpha',
      dataset: 'synthetic-source-a',
      sourceKey: 'district|alpha|oldname',
    });
    expect(f.originalAssignment.labelledState).toMatchObject({ name: 'Alpha', lgdCode: 990001 });
    expect(f.observations).toBe(20);
    expect([f.firstDate, f.lastDate]).toEqual(['2023-06-06', '2025-06-11']);
    expect(f.datasets).toEqual(['synthetic-source-a']);
    expect(f.markets[0]).toMatchObject({
      name: 'Oldmandi',
      observations: 20,
      aliasSourceKey: 'market|alpha|oldname|oldmandi',
    });
    expect(f.candidates[0].reference).toMatchObject({
      setCode: 'lgd-district-pages-test',
      sourceUrl: 'https://example.invalid/district/990102',
    });
  });

  it('states the temporal uncertainty against the data window and never takes a retrieval time for a legal date', () => {
    expect(byLabel(analysis, 'north ville').candidates[0].temporal).toBe(
      'current_version_is_lgd_baseline_2005',
    );
    expect(byLabel(analysis, 'oldname').candidates[0].temporal).toBe(
      'current_version_predates_data_window',
    );
    expect(byLabel(analysis, 'oldname').uncertainty.renameDate).toBe('not_published');
    // a unit whose version carries no date: unknown, although the unit WAS retrieved on a known day
    const undated = byLabel(analysis, 'undateddist').candidates[0];
    expect(undated.temporal).toBe('current_version_date_unknown');
    expect(undated.currentVersionEffectiveDate).toBeNull();
    expect(undated.reference.retrievedAt).toBeTruthy();
    for (const f of analysis.findings.filter((x) => x.type === 'unresolved_district_alias'))
      for (const c of f.candidates) {
        expect(c.currentVersionEffectiveDate).not.toBe(c.reference.retrievedAt);
        expect(c).not.toHaveProperty('legalEffectiveDate');
      }
    const after = analyse(
      worldSnapshot({
        ...WORLD,
        unresolved: [
          {
            state: 'alpha',
            label: 'oldname',
            markets: [{ name: 'Early', obs: 1, first: '2010-01-01', last: '2011-01-01' }],
          },
        ],
      }),
    );
    expect(byLabel(after, 'oldname').candidates[0].temporal).toBe(
      'current_version_after_data_window',
    );
  });

  it('never treats the 2005 LGD baseline as a formation date, and keeps undated version changes visible', () => {
    const baseline = byLabel(analysis, 'north ville').candidates[0];
    expect(baseline).toMatchObject({
      currentVersionIsBaseline: true,
      baselineIsNotFormationDate: true,
      boundaryChanges: 'none_recorded',
    });
    // a district with several versions: its boundary may have changed, the dates are not published
    const renamed = byLabel(analysis, 'oldname').candidates[0];
    expect(renamed.versionCount).toBe(2);
    expect(renamed.boundaryChanges).toBe('versions_without_dates');
    const proposal = buildProposals(analysis).find((p) => p.sourceLabel === 'oldname');
    expect(proposal.evidence.candidates[0]).toMatchObject({
      boundaryChanges: 'versions_without_dates',
    });
    expect(proposal.evidence.limitations.join(' ')).toMatch(/modification log/);
    expect(analysis.limitations.join(' ')).toMatch(/rename, split and merger dates are unknown/);
  });

  it('reports an unresolved state label with its candidate but no conclusion', () => {
    const f = analysis.findings.find((x) => x.type === 'unresolved_state_alias');
    expect(f.source.label).toBe('Alhpa');
    expect(f.classification).toBe('name_only_candidate');
    expect(f.candidates.map((c) => c.name)).toEqual(['Alpha']);
  });

  it('finds official districts absent from the registry, registry districts with no official record, and inactive units', () => {
    expect(
      analysis.findings
        .filter((f) => f.type === 'official_district_absent_from_registry')
        .map((f) => f.official.lgdCode),
    ).toEqual([990107]);
    expect(
      analysis.findings
        .filter((f) => f.type === 'registry_district_without_official_record')
        .map((f) => f.registry.lgdCode),
    ).toEqual(['990999']);
    const inactive = analysis.findings.filter((f) => f.type === 'inactive_official_unit');
    expect(inactive.map((f) => f.official.lgdCode)).toEqual([990106]);
    expect(inactive[0].official.formerNames.map((n) => n.name)).toEqual(['Oldline']);
    expect(inactive[0].reliability).toBe('history_status_unverified');
    expect(inactive[0].note).toMatch(/NOT reliable evidence/);
  });

  it('finds the same mandi name in several locations without merging them', () => {
    const f = analysis.findings.filter((x) => x.type === 'ambiguous_market_name');
    expect(f).toHaveLength(1);
    expect(f[0].markets.map((m) => m.stateName)).toEqual(['Alpha', 'Beta']);
  });

  it('counts a mandi once in the distinct totals even when it sits under two labels', () => {
    const snapshot = worldSnapshot();
    const oldmandi = snapshot.markets.find((m) => m.name === 'Oldmandi');
    // the same mandi also carries an alias under another district label (two spellings of its state)
    const doubled = {
      ...snapshot,
      markets: [
        ...snapshot.markets,
        { ...oldmandi, alias_source_key: 'market|alpha|palakadx|oldmandi' },
      ],
    };
    const s = analyse(doubled).summary;
    expect(s.perLabelMarkets).toBe(s.distinctMarkets + 1);
    expect(s.perLabelObservations).toBe(s.distinctObservations + 20);
    expect(s.marketsUnderSeveralLabels).toEqual([
      { id: oldmandi.id, labels: ['district|alpha|oldname', 'district|alpha|palakadx'] },
    ]);
    expect(summarise(analysis.findings).marketsUnderSeveralLabels).toEqual([]);
  });

  it('is deterministic: the same snapshot in any row order gives identical findings', () => {
    const snapshot = worldSnapshot();
    const reversed = Object.fromEntries(
      Object.entries(snapshot).map(([k, v]) => [k, Array.isArray(v) ? [...v].reverse() : v]),
    );
    const strip = (a) => JSON.stringify(a.findings);
    expect(strip(analyse(reversed))).toBe(strip(analysis));
    expect(strip(analyse(snapshot))).toBe(strip(analysis));
  });

  it('prefers the closest spelling: a nearer candidate does not become ambiguous because a farther one exists', () => {
    const district = (code, name) => ({
      code,
      state: 990001,
      history: [name],
      status: 'active',
      effective: '2005-01-01',
      baseline: true,
      registry: true,
    });
    const world = {
      ...WORLD,
      districts: [...WORLD.districts, district(990301, 'Budaunx'), district(990302, 'Jalaunx')],
      unresolved: [
        {
          state: 'alpha',
          label: 'badaunx',
          markets: [{ name: 'Badmandi', obs: 1, first: '2024-01-01', last: '2024-01-02' }],
        },
      ],
    };
    const f = byLabel(analyse(worldSnapshot(world)), 'badaunx');
    expect(f.classification).toBe('name_only_candidate');
    expect(f.candidates.map((c) => c.lgdCode)).toEqual([990301]);
  });
});

describe('candidate proposals', () => {
  const analysis = /** @type {any} */ (analyse(worldSnapshot()));
  const proposals = buildProposals(analysis);
  const byClass = (c) => proposals.filter((p) => p.evidenceClass === c);

  it('records each evidence class as the right kind of decision, and fuzzy similarity as unresolved only', () => {
    expect(
      byClass('exact_official_name').map((p) => [p.sourceLabel, p.decisionKind, p.decisionClass]),
    ).toEqual([
      ['north ville', 'map_label', 'S'],
      ['undateddist', 'map_label', 'S'],
    ]);
    expect(byClass('documented_rename').map((p) => [p.decisionKind, p.decisionClass])).toEqual([
      ['map_label', 'H'],
    ]);
    expect(byClass('ambiguous').map((p) => [p.decisionKind, p.decisionClass])).toEqual([
      ['mark_ambiguous', 'A'],
      ['mark_ambiguous', 'A'],
    ]);
    for (const p of byClass('name_only_candidate')) {
      expect(p.decisionKind).toBe('mark_unresolved');
      expect(p.decisionClass).toBe('U');
      expect(p.targetDistrictId ?? null).toBeNull();
      expect(p.targetAdminUnitVersionId ?? null).toBeNull();
      expect(p.evidence.notAProof).toBe(true);
    }
    expect(
      proposals.some(
        (p) =>
          p.decisionKind === 'map_label' &&
          ['name_only_candidate', 'ambiguous', 'state_mismatch'].includes(p.evidenceClass),
      ),
    ).toBe(false);
  });

  it('keeps every suspected state mismatch a pending question: a state-level change is not evidence about one mandi', () => {
    const pending = byClass('state_mismatch');
    expect(pending.map((p) => p.original.marketName).sort()).toEqual([
      'Betamandi One',
      'Betamandi Two',
    ]);
    for (const p of pending) {
      expect(p).toMatchObject({
        decisionKind: 'mark_unresolved',
        decisionClass: 'U',
        entityKind: 'market',
        evidenceLevel: 'state_level_only',
        reviewStatus: 'candidate',
      });
      expect(p.targetStateId ?? null).toBeNull();
      expect(p.targetAdminUnitVersionId ?? null).toBeNull();
      expect(p.subjectMarketId).toBeTruthy();
      expect(p.evidence.marketSpecificEvidence).toEqual([]);
      expect(p.evidence.missingEvidence.join(' ')).toMatch(/official listing/);
      expect(p.evidence.stateLevelEvidence).toMatchObject({
        districtOfferedAsFit: { lgdCode: 990201, stateName: 'Beta' },
        stateRecord: { name: 'Beta', lgdEffectiveDate: '2014-06-17', legalEffectiveDate: null },
      });
      expect(p.evidence.stateLevelEvidence.appliesTo).toMatch(/not to any single mandi/);
      expect(p.uncertainty.marketLocation).toBe('not_established');
      expect(p.rationale).toMatch(/does not identify this mandi/);
      expect(acceptanceBlockers(p).join(' ')).toMatch(/only state-level evidence/);
    }
    // no state correction exists anywhere in the output without market-specific evidence
    expect(proposals.some((p) => p.decisionKind === 'correct_state')).toBe(false);
  });

  it('proposes a state correction for a mandi only when market-specific evidence names the target state', () => {
    const withEvidence = buildProposals(
      analyse(worldSnapshot(), { marketEvidence: betaEvidence() }),
    );
    const corrections = withEvidence.filter((p) => p.evidenceClass === 'state_mismatch');
    expect(corrections.map((p) => p.decisionKind)).toEqual(['correct_state', 'correct_state']);
    for (const p of corrections) {
      expect(p).toMatchObject({
        decisionClass: 'H',
        evidenceLevel: 'market_specific',
        requiresTwoReviewers: true,
      });
      expect(p.targetStateId).toBeTruthy();
      expect(p.evidence.marketSpecificEvidence).toHaveLength(1);
      expect(p.evidence.missingEvidence).toEqual([]);
      expect(acceptanceBlockers(p)).toContain('needs two distinct recommending reviewers');
    }
    // the evidence must be of a recognised kind, name the TARGET state, and carry a reference
    const target = analysis.context.officialStates.get('990002');
    const good = { type: 'official_market_listing', stateLgdCode: 990002, reference: 'doc' };
    expect(isMarketSpecificEvidence(good, target)).toBe(true);
    expect(isMarketSpecificEvidence({ ...good, stateLgdCode: 990001 }, target)).toBe(false);
    expect(isMarketSpecificEvidence({ ...good, type: 'district_label' }, target)).toBe(false);
    expect(isMarketSpecificEvidence({ ...good, reference: '  ' }, target)).toBe(false);
    expect(isMarketSpecificEvidence(null, target)).toBe(false);
    const weak = new Map([[corrections[0].subjectMarketId, [{ ...good, stateLgdCode: 990001 }]]]);
    const stillPending = buildProposals(analyse(worldSnapshot(), { marketEvidence: weak })).filter(
      (p) => p.evidenceClass === 'state_mismatch',
    );
    expect(stillPending.map((p) => p.decisionKind)).toEqual(['mark_unresolved', 'mark_unresolved']);
  });

  it('never accepts anything by itself, and a state correction cannot even be built without market evidence', () => {
    expect(AUTOMATIC_ACCEPTANCE).toBe(false);
    for (const p of proposals) {
      expect(p.reviewStatus).toBe('candidate');
      expect(toProposeCall(p).text).toMatch(/identity_propose/); // building a call is not accepting
    }
    for (const p of proposals.filter((x) => x.decisionKind !== 'map_label'))
      expect(acceptanceBlockers(p).length).toBeGreaterThan(0);
    const unsupported = {
      ...proposals.find((p) => p.evidenceClass === 'state_mismatch'),
      decisionKind: 'correct_state',
    };
    expect(() => toProposeCall(unsupported)).toThrow(/without market-specific evidence/);
  });

  it('carries the original identity, the proposed identity, the official code, references, uncertainty and the reason', () => {
    const p = byClass('documented_rename')[0];
    expect(p).toMatchObject({
      sourceKey: 'district|alpha|oldname',
      sourceLabel: 'oldname',
      proposed: { lgdCode: 990102, name: 'Newname' },
    });
    expect(p.evidence.original).toMatchObject({ sourceLabel: 'oldname', stateLabel: 'alpha' });
    expect(p.evidence.candidates[0]).toMatchObject({
      lgdCode: 990102,
      matchedName: 'Oldname',
      temporal: 'current_version_predates_data_window',
    });
    expect(p.evidenceRefs.some((r) => r.startsWith('lgd:lgd-district-pages-test#'))).toBe(true);
    expect(p.evidenceRefs).toContain('dataset:synthetic-source-a');
    expect(p.evidence.limitations.join(' ')).toMatch(/modification log/);
    expect(p.rationale).toMatch(/former name/);
    expect(p.evidence.rulesetVersion).toBe(PROPOSAL_RULESET);
  });

  it('gives every proposal a stable, unique key and an evidence digest that changes with the evidence', () => {
    expect(new Set(proposals.map((p) => p.proposalKey)).size).toBe(proposals.length);
    expect(buildProposals(analyse(worldSnapshot())).map((p) => p.proposalKey)).toEqual(
      proposals.map((p) => p.proposalKey),
    );
    const changed = buildProposals(
      analyse(
        worldSnapshot({
          ...WORLD,
          unresolved: WORLD.unresolved.map((u) =>
            u.label === 'oldname' ? { ...u, markets: [{ ...u.markets[0], obs: 99 }] } : u,
          ),
        }),
      ),
    ).find((p) => p.sourceKey === 'district|alpha|oldname');
    const original = byClass('documented_rename')[0];
    expect(changed.proposalKey).toBe(original.proposalKey); // same claim
    expect(changed.evidenceDigest).not.toBe(original.evidenceDigest); // new evidence
  });

  it('counts proposals by evidence class and applies the same two-reviewer rule as the database', () => {
    expect(countByClass(proposals)).toMatchObject({
      state_mismatch: { proposals: 2, twoReviewers: 0 },
      exact_official_name: { proposals: 2, twoReviewers: 0 },
      ambiguous: { proposals: 2, twoReviewers: 2 },
    });
    const rule = (decisionKind, decisionClass, entityKind) =>
      requiresTwoReviewers({ decisionKind, decisionClass, entityKind });
    expect(rule('map_label', 'S', 'district')).toBe(false);
    expect(rule('map_label', 'A', 'district')).toBe(true);
    expect(rule('map_label', 'S', 'state')).toBe(true);
    expect(rule('merge_markets', 'S', 'market')).toBe(true);
    expect(rule('correct_state', 'H', 'market')).toBe(true);
  });
});

describe('review workflow planning', () => {
  const analysis = /** @type {any} */ (analyse(worldSnapshot()));
  const proposals = buildProposals(analysis);
  const exists = (p, status, extra = {}) => ({
    id: 'd1',
    status,
    proposal_key: p.proposalKey,
    evidence_digest: p.evidenceDigest,
    source_id: p.sourceId,
    entity_kind: p.entityKind,
    source_key: p.sourceKey,
    subject_market_id: p.subjectMarketId ?? null,
    decision_kind: p.decisionKind,
    ...extra,
  });

  it('submits everything once and nothing twice', () => {
    expect(planSubmission(proposals, []).toSubmit).toHaveLength(proposals.length);
    expect(planSubmission([...proposals, proposals[0]], []).skipped).toEqual([
      { proposalKey: proposals[0].proposalKey, reason: 'duplicate_in_batch' },
    ]);
    const open = planSubmission(proposals, [exists(proposals[0], 'proposed')]);
    expect(open.skipped).toEqual([
      { proposalKey: proposals[0].proposalKey, reason: 'already_proposed' },
    ]);
    expect(open.toSubmit).toHaveLength(proposals.length - 1);
    expect(planSubmission(proposals, [exists(proposals[1], 'accepted')]).skipped[0].reason).toBe(
      'already_accepted',
    );
    // idempotent: planning again after everything was recorded submits nothing
    const all = proposals.map((p) => exists(p, 'proposed'));
    expect(planSubmission(proposals, all).toSubmit).toEqual([]);
  });

  it('does not re-propose rejected or withdrawn evidence, but allows a proposal with new evidence', () => {
    expect(planSubmission(proposals, [exists(proposals[2], 'rejected')]).skipped[0].reason).toBe(
      'same_evidence_already_closed',
    );
    expect(planSubmission(proposals, [exists(proposals[2], 'withdrawn')]).skipped[0].reason).toBe(
      'same_evidence_already_closed',
    );
    const withNewEvidence = planSubmission(proposals, [
      exists(proposals[2], 'rejected', { evidence_digest: 'other' }),
    ]);
    expect(withNewEvidence.skipped).toEqual([]);
    expect(withNewEvidence.toSubmit).toHaveLength(proposals.length);
  });

  it('leaves a label that already has a different accepted decision to a superseding decision', () => {
    const p = proposals[0];
    const plan = planSubmission(
      [p],
      [exists(p, 'accepted', { proposal_key: 'another-key', id: 'acc1' })],
    );
    expect(plan.toSubmit).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({
      reason: 'label_already_decided_needs_supersession',
      supersedes: 'acc1',
    });
    expect(reversalArguments({ id: 'acc1', status: 'accepted' })).toEqual({
      p_supersedes_id: 'acc1',
    });
    expect(() => reversalArguments({ id: 'x', status: 'proposed' })).toThrow(/only an accepted/);
  });

  it('expresses a proposal as the exact identity_propose call, with every value bound as a parameter', () => {
    const p = buildProposals(analyse(worldSnapshot(), { marketEvidence: betaEvidence() })).find(
      (x) => x.decisionKind === 'correct_state',
    );
    const call = toProposeCall(p);
    expect(call.text).toMatch(
      /^SELECT public\.identity_propose\(p_decision_kind => \$1, p_entity_kind => \$2/,
    );
    expect(call.text).toContain('p_subject_market_id =>');
    expect(call.text).toContain('p_evidence => $');
    expect(call.values[0]).toBe('correct_state');
    expect(call.values.some((v) => typeof v === 'string' && v.includes(p.proposalKey))).toBe(true);
    expect(call.values.some((v) => Array.isArray(v) && v.length > 0)).toBe(true);
    // nothing from a proposal is spliced into the SQL text
    expect(call.text).not.toContain(p.sourceLabel);
    expect(call.text).not.toContain(p.rationale);
    const hostile = {
      ...proposals[0],
      sourceLabel: "x'); DROP TABLE markets; --",
      rationale: "'; DELETE FROM states; --",
    };
    const hostileCall = toProposeCall(hostile);
    expect(hostileCall.text).not.toMatch(/DROP|DELETE/);
    expect(hostileCall.values).toContain("x'); DROP TABLE markets; --");
  });

  it('states the review policy: reviewer proposes, one or two reviewers, an independent approver', () => {
    expect(
      reviewPolicy(proposals.find((p) => p.evidenceClass === 'exact_official_name')),
    ).toMatchObject({ proposerRole: 'reviewer', recommendingReviewersNeeded: 1, highRisk: false });
    const correction = buildProposals(
      analyse(worldSnapshot(), { marketEvidence: betaEvidence() }),
    ).find((p) => p.decisionKind === 'correct_state');
    const high = reviewPolicy(correction);
    expect(high).toMatchObject({
      recommendingReviewersNeeded: 2,
      highRisk: true,
      approverRole: 'approver',
    });
    expect(high.reasons[0]).toMatch(/correct_state/);
    expect(WORKFLOW.application).toMatch(/applies NOTHING/);
    expect(WORKFLOW.deferral).toMatch(/needs_evidence/);
    expect(mappingSetCode(new Date('2026-10-22T00:00:00Z'), 1)).toBe('geo-ids-20261022-v1');
  });

  it('classifies a failed proposal call, and retries only what is transient', async () => {
    const dup = (constraint) => Object.assign(new Error('dup'), { code: '23505', constraint });
    expect(classifyProposeError(dup('idec_open_proposal_key_uq'))).toBe('duplicate_open');
    expect(classifyProposeError(dup('idec_proposal_evidence_uq'))).toBe('duplicate_evidence');
    expect(classifyProposeError(dup('something_else'))).toBe('error');
    expect(classifyProposeError({ code: '40001' })).toBe('retry');
    expect(classifyProposeError({ code: '40P01' })).toBe('retry');
    expect(classifyProposeError({ code: 'FI012' })).toBe('refused');
    expect(classifyProposeError(new Error('boom'))).toBe('error');

    const p = proposals[0];
    const sleeps = [];
    const sleep = async (ms) => void sleeps.push(ms);
    // a duplicate is reported, not raised
    const dupPool = {
      query: async () => {
        throw dup('idec_open_proposal_key_uq');
      },
    };
    await expect(submitWithRetry(dupPool, p, { sleep })).resolves.toEqual({
      status: 'duplicate_open',
    });
    // a transient conflict is retried with backoff, then succeeds
    let calls = 0;
    const flaky = {
      query: async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('x'), { code: '40001' });
        return { rows: [{ id: 'new-id' }] };
      },
    };
    await expect(submitWithRetry(flaky, p, { sleep, backoffMs: 10 })).resolves.toEqual({
      status: 'submitted',
      id: 'new-id',
    });
    expect(sleeps).toEqual([10, 20]);
    // a rule of the workflow is never retried
    let refusedCalls = 0;
    const refused = {
      query: async () => {
        refusedCalls += 1;
        throw Object.assign(new Error('no'), { code: 'FI012' });
      },
    };
    await expect(submitWithRetry(refused, p, { sleep })).rejects.toThrow('no');
    expect(refusedCalls).toBe(1);
    // retries are bounded
    const always = {
      query: async () => {
        throw Object.assign(new Error('busy'), { code: '40P01' });
      },
    };
    await expect(submitWithRetry(always, p, { sleep, attempts: 2 })).rejects.toThrow('busy');
  });
});
