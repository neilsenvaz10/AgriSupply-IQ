import { describe, expect, it } from 'vitest';
import { WORLD, pilotWorld, worldSnapshot } from '../test/geoFixtures.js';
import { analyse } from './analysis.js';
import { interpretInEffect, resolveLabel } from './interpret.js';
import { PILOT_MAX, pilotDisqualifiers, selectPilot } from './pilot.js';
import { buildProposals } from './proposals.js';

/** Pilot selection and the read-only interpretation of accepted decisions: pure functions, no database. */

const proposalsOf = (world) => buildProposals(analyse(worldSnapshot(world)));

describe('pilot selection', () => {
  it('takes only the least doubtful kind of proposal, fewest observations first, at most five', () => {
    const { selected, eligibleNotSelected, excluded } = selectPilot(proposalsOf(pilotWorld()));
    expect(selected).toHaveLength(PILOT_MAX);
    expect(selected.map((p) => p.sourceLabel)).toEqual([
      'north ville',
      'pilot alpha',
      'pilotbravo',
      'pilot charlie',
      'pilotdelta',
    ]);
    expect(eligibleNotSelected).toEqual(['district|alpha|pilot echo']);
    for (const p of selected)
      expect(p).toMatchObject({
        evidenceClass: 'exact_official_name',
        decisionKind: 'map_label',
        decisionClass: 'S',
        requiresTwoReviewers: false,
      });
    // an exact name whose unit carries no date is NOT a pilot item, and the reason is stated
    expect(excluded).toEqual([
      {
        sourceKey: 'district|alpha|undateddist',
        reasons: ['the current version does not carry the 2005 default date'],
      },
    ]);
  });

  it('never selects a rename, an ambiguous label, a name-only candidate or a state mismatch', () => {
    const proposals = proposalsOf(pilotWorld());
    const picked = new Set(selectPilot(proposals, { max: 5 }).selected.map((p) => p.evidenceClass));
    expect([...picked]).toEqual(['exact_official_name']);
    for (const p of proposals.filter((x) => x.evidenceClass !== 'exact_official_name'))
      expect(pilotDisqualifiers(p)).toContain('not an exact official name');
    const rename = proposals.find((p) => p.evidenceClass === 'documented_rename');
    expect(selectPilot([rename]).selected).toEqual([]);
  });

  it('refuses units with several versions, a partial name, no registry district or a high-risk rule', () => {
    const base = selectPilot(proposalsOf(pilotWorld())).selected[0];
    const mutate = (patch) => ({
      ...base,
      ...patch,
      evidence: {
        ...base.evidence,
        candidates: [{ ...base.evidence.candidates[0], ...(patch.candidate ?? {}) }],
      },
    });
    expect(pilotDisqualifiers(mutate({ candidate: { versionCount: 2 } }))).toContain(
      'the official unit has more than one version',
    );
    expect(
      pilotDisqualifiers(mutate({ candidate: { boundaryChanges: 'versions_without_dates' } })),
    ).toContain('undated version changes are recorded');
    expect(pilotDisqualifiers(mutate({ candidate: { partialNameMatch: true } }))).toContain(
      'partial name match',
    );
    expect(pilotDisqualifiers(mutate({ candidate: { status: 'inactive' } }))).toContain(
      'official unit is not active',
    );
    expect(
      pilotDisqualifiers(mutate({ candidate: { currentVersionIsBaseline: false } })),
    ).toContain('the current version does not carry the 2005 default date');
    expect(pilotDisqualifiers(mutate({ targetDistrictId: null }))).toContain(
      'the registry has no district for this unit',
    );
    expect(pilotDisqualifiers(mutate({ requiresTwoReviewers: true }))).toContain(
      'needs two reviewers',
    );
    expect(pilotDisqualifiers(base)).toEqual([]);
    expect(() => selectPilot([], { max: 6 })).toThrow(/between 1 and 5/);
    expect(() => selectPilot([], { max: 0 })).toThrow(/between 1 and 5/);
    expect(selectPilot(proposalsOf(pilotWorld()), { max: 2 }).selected).toHaveLength(2);
  });

  it('selects the same pilot whatever the input order', () => {
    const proposals = proposalsOf(pilotWorld());
    const a = selectPilot(proposals).selected.map((p) => p.proposalKey);
    const b = selectPilot([...proposals].reverse()).selected.map((p) => p.proposalKey);
    expect(b).toEqual(a);
    expect(WORLD.unresolved.length).toBeGreaterThan(0);
  });
});

describe('read-only interpretation of accepted decisions', () => {
  const row = (over = {}) => ({
    id: 'd1',
    mapping_set_id: 's1',
    mapping_set_code: 'set-1',
    status: 'accepted',
    decision_kind: 'map_label',
    entity_kind: 'district',
    source_id: 'src',
    source_key: 'district|alpha|oldname',
    source_label: 'oldname',
    subject_market_id: null,
    target_district_id: 'dist-1',
    target_state_id: null,
    target_admin_unit_version_id: 'unit-1',
    decision_class: 'H',
    valid_from: null,
    valid_to: null,
    ...over,
  });
  const ask = { sourceId: 'src', entityKind: 'district', sourceKey: 'district|alpha|oldname' };

  it('answers from the accepted decisions of the active set and applies nothing', () => {
    const i = interpretInEffect([
      row(),
      row({
        id: 'd2',
        source_key: 'district|alpha|other',
        decision_kind: 'mark_unresolved',
        target_district_id: null,
        target_admin_unit_version_id: null,
        decision_class: 'U',
      }),
    ]);
    expect(i).toMatchObject({ applied: false, count: 2, mappingSetCode: 'set-1', conflicts: [] });
    expect(resolveLabel(i, ask)).toMatchObject({
      decisionId: 'd1',
      targetDistrictId: 'dist-1',
      targetAdminUnitVersionId: 'unit-1',
    });
    // an "unresolved" or "ambiguous" decision records a question: it identifies nothing
    expect(resolveLabel(i, { ...ask, sourceKey: 'district|alpha|other' })).toBeNull();
  });

  it('fails closed: unknown labels, other dates, conflicts and mixed sets resolve to nothing or raise', () => {
    const i = interpretInEffect([row({ valid_from: '2024-01-01', valid_to: '2024-12-31' })]);
    expect(resolveLabel(i, { ...ask, date: '2024-06-01' })?.decisionId).toBe('d1');
    expect(resolveLabel(i, { ...ask, date: '2023-06-01' })).toBeNull();
    expect(resolveLabel(i, { ...ask, date: '2025-01-01' })).toBeNull();
    expect(resolveLabel(i, { ...ask, sourceKey: 'district|alpha|nothing' })).toBeNull();
    const conflict = interpretInEffect([row(), row({ id: 'd9' })]);
    expect(conflict.conflicts).toEqual([
      { key: 'src|district|district|alpha|oldname', decisionIds: ['d1', 'd9'] },
    ]);
    expect(resolveLabel(conflict, ask)).toBeNull();
    expect(() => interpretInEffect([row(), row({ id: 'x', mapping_set_id: 's2' })])).toThrow(
      /more than one mapping set/,
    );
    expect(() => interpretInEffect([row({ status: 'proposed' })])).toThrow(/only accepted/);
    expect(interpretInEffect([]).count).toBe(0);
  });
});
