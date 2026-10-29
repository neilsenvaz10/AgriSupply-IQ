/**
 * Selection of a small PILOT of low-risk proposals (Milestone 2.4, Stage 3c). Pure and deterministic.
 *
 * A pilot item must be the least doubtful kind of proposal there is: a label that equals the CURRENT official name
 * (or differs only in spaces or punctuation) of exactly one district of its own state, whose official unit has a
 * single version, still carries LGD's 2005 default date (so no change of name or boundary is recorded since), is
 * active, is already a district of the registry, and is not a partial name match. Renames, ambiguous labels,
 * state corrections and name-only candidates are never pilot items, whatever their counts.
 */

export const PILOT_MAX = 5;

/**
 * Why a proposal is not a pilot item (an empty list means it qualifies).
 * @param {any} proposal
 * @returns {string[]}
 */
export function pilotDisqualifiers(proposal) {
  const reasons = [];
  if (proposal.evidenceClass !== 'exact_official_name') reasons.push('not an exact official name');
  if (proposal.decisionKind !== 'map_label' || proposal.entityKind !== 'district')
    reasons.push('not a district label mapping');
  const candidates = proposal.evidence?.candidates ?? [];
  if (candidates.length !== 1) reasons.push('not exactly one candidate');
  const c = candidates[0];
  if (c) {
    if (!['exact', 'spaces_or_punctuation_only'].includes(c.detail))
      reasons.push('name match is not exact');
    if (c.partialNameMatch) reasons.push('partial name match');
    if (c.status !== 'active') reasons.push('official unit is not active');
    if (c.versionCount !== 1) reasons.push('the official unit has more than one version');
    if (c.boundaryChanges !== 'none_recorded') reasons.push('undated version changes are recorded');
    if (c.currentVersionIsBaseline !== true)
      reasons.push('the current version does not carry the 2005 default date');
  }
  if (!proposal.targetDistrictId) reasons.push('the registry has no district for this unit');
  if (!proposal.targetAdminUnitVersionId) reasons.push('no official unit version to cite');
  if (proposal.requiresTwoReviewers) reasons.push('needs two reviewers');
  return reasons;
}

/**
 * Up to `max` pilot proposals, the ones that touch the fewest observations first (ties by source key).
 * @param {any[]} proposals
 * @param {{ max?: number }} [options]
 */
export function selectPilot(proposals, { max = PILOT_MAX } = {}) {
  if (!Number.isInteger(max) || max < 1 || max > PILOT_MAX)
    throw new Error(`a pilot has between 1 and ${PILOT_MAX} items`);
  const eligible = [];
  const excluded = [];
  for (const p of proposals) {
    const reasons = pilotDisqualifiers(p);
    if (reasons.length === 0) eligible.push(p);
    else if (p.evidenceClass === 'exact_official_name')
      excluded.push({ sourceKey: p.sourceKey, reasons });
  }
  const obs = (/** @type {any} */ p) => p.evidence?.window?.observations ?? 0;
  eligible.sort(
    (a, b) =>
      obs(a) - obs(b) || (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0),
  );
  return {
    selected: eligible.slice(0, max),
    eligibleNotSelected: eligible.slice(max).map((p) => p.sourceKey),
    excluded,
  };
}
