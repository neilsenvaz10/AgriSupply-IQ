import { LIMITATIONS } from './analysis.js';
import { digestOf } from './normalize.js';

/**
 * Candidate identity proposals (Milestone 2.4, Stage 3b), derived from the findings of `analyse`.
 *
 * A proposal is DATA shaped like a call of `identity_propose`. This module never calls the database. A proposal
 * is a request for independent review, never a decision: nothing here is accepted, applied or reassigned, and a
 * fuzzy name similarity alone is never recorded as an identity (it becomes a `mark_unresolved` proposal that
 * only notes the candidate).
 *
 * Evidence class -> decision recorded (all start as `proposed`; the review workflow decides):
 *   exact_official_name     map_label district      class S  (same state, exact or spaces-only name match)
 *   documented_rename       map_label district      class H  (former name in the unit's own LGD history)
 *   name_only_candidate     mark_unresolved         class U  (spelling or word resemblance, candidate noted)
 *   ambiguous               mark_ambiguous          class A  (several official units fit; two reviewers)
 *   state_mismatch          per mandi: mark_unresolved class U while the evidence is state-level only (a district
 *                           label that belongs to another state says nothing about one mandi); correct_state class H
 *                           (two reviewers) only when market-specific evidence is supplied
 *   unresolved_no_candidate mark_unresolved         class U
 */

export const PROPOSAL_RULESET = 'geo-proposals-2';

const cmp = (/** @type {any} */ a, /** @type {any} */ b) => (a < b ? -1 : a > b ? 1 : 0);

/** The kinds of record that can identify ONE mandi (as opposed to a district label). */
export const MARKET_EVIDENCE_TYPES = Object.freeze([
  'official_market_listing',
  'government_market_code_record',
  'gazette_notification',
]);

/**
 * Whether a supplied entry is market-specific evidence for placing a mandi in the target state: a recognised kind
 * of record, naming the target state's LGD code, with a reference a reviewer can open.
 * @param {any} entry
 * @param {any} target official state unit
 */
export function isMarketSpecificEvidence(entry, target) {
  return Boolean(
    entry &&
    target &&
    MARKET_EVIDENCE_TYPES.includes(entry.type) &&
    Number(entry.stateLgdCode) === Number(target.code) &&
    typeof entry.reference === 'string' &&
    entry.reference.trim() !== '',
  );
}

/** Same rule as the database (generated column `requires_two_reviewers`). */
export const requiresTwoReviewers = (
  /** @type {{ decisionKind: string, decisionClass: string, entityKind: string }} */ p,
) =>
  ['correct_state', 'merge_markets'].includes(p.decisionKind) ||
  p.decisionClass === 'A' ||
  p.entityKind === 'state';

/**
 * @param {any} c candidate of a finding
 */
const compactCandidate = (c) => ({
  lgdCode: c.lgdCode,
  name: c.name,
  stateCode: c.stateCode,
  stateName: c.stateName,
  rung: c.rung,
  detail: c.detail,
  matchedName: c.matchedName,
  status: c.status,
  currentVersionEffectiveDate: c.currentVersionEffectiveDate,
  currentVersionIsBaseline: c.currentVersionIsBaseline,
  versionCount: c.versionCount,
  temporal: c.temporal,
  renameDate: c.renameDate,
  partialNameMatch: c.partialNameMatch,
  baselineIsNotFormationDate: c.baselineIsNotFormationDate,
  boundaryChanges: c.boundaryChanges,
});

/** @param {any} reference */
const referenceRef = (reference) =>
  `lgd:${reference.setCode}#${String(reference.setSha256).slice(0, 12)}${reference.sourceSha256 ? `:page#${String(reference.sourceSha256).slice(0, 12)}` : ''}`;

/**
 * @param {any} base
 * @param {{ proposalKeyParts: any, evidence: any, refs: string[] }} parts
 */
function finish(base, parts) {
  const proposalKey = digestOf({ ...parts.proposalKeyParts, ruleset: PROPOSAL_RULESET }, 32);
  const evidence = {
    ...parts.evidence,
    proposalKey,
    rulesetVersion: PROPOSAL_RULESET,
    limitations: LIMITATIONS,
  };
  evidence.evidenceDigest = digestOf(parts.evidence, 32);
  return {
    proposalKey,
    evidenceDigest: evidence.evidenceDigest,
    reviewStatus: 'candidate',
    requiresTwoReviewers: requiresTwoReviewers(base),
    ...base,
    evidence,
    evidenceRefs: [...new Set(parts.refs)].sort(),
  };
}

/**
 * @param {{ findings: any[], context: { officialStates: Map<string, any> } }} analysis
 * @returns {any[]}
 */
export function buildProposals(analysis) {
  const proposals = [];
  const stateUnit = (/** @type {number | string} */ code) =>
    analysis.context.officialStates.get(String(code));

  for (const f of analysis.findings) {
    if (f.type === 'unresolved_district_alias') {
      const window = {
        observations: f.observations,
        firstDate: f.firstDate,
        lastDate: f.lastDate,
        datasets: f.datasets,
        markets: f.markets.length,
      };
      const original = {
        sourceKey: f.source.sourceKey,
        sourceLabel: f.source.label,
        stateLabel: f.source.stateLabel,
        labelledState: f.originalAssignment.labelledState,
      };
      const common = {
        findingId: f.findingId,
        source: f.source,
        sourceId: f.source.sourceId,
        sourceKey: f.source.sourceKey,
        sourceLabel: f.source.label,
        sourceContext: f.source.stateLabel,
      };
      const candidates = f.candidates.map(compactCandidate);
      const refs = f.candidates
        .flatMap((/** @type {any} */ c) => [referenceRef(c.reference)])
        .concat(f.datasets.map((/** @type {string} */ d) => `dataset:${d}`));

      if (f.classification === 'exact_official_name' || f.classification === 'documented_rename') {
        const c = f.candidates[0];
        const isRename = f.classification === 'documented_rename';
        proposals.push(
          finish(
            {
              ...common,
              evidenceClass: f.classification,
              decisionKind: 'map_label',
              entityKind: 'district',
              decisionClass: isRename ? 'H' : 'S',
              targetDistrictId: c.registryDistrictId,
              targetAdminUnitVersionId: c.unitVersionId,
              proposed: {
                lgdCode: c.lgdCode,
                name: c.name,
                stateCode: c.stateCode,
                stateName: c.stateName,
              },
              uncertainty: f.uncertainty,
              rationale: isRename
                ? `Label "${f.source.label}" (${f.source.stateLabel}) is a former name of ${c.name} (LGD ${c.lgdCode}) in that district's own LGD version history. The rename date is not published and only the current version's date is known.`
                : `Label "${f.source.label}" (${f.source.stateLabel}) equals the current official name ${c.name} (LGD ${c.lgdCode}) in the same state${c.detail === 'spaces_or_punctuation_only' ? ', ignoring spaces and punctuation only' : ''}. No LGD code accompanies the label.`,
            },
            {
              proposalKeyParts: {
                kind: 'map_label',
                entity: 'district',
                sourceId: f.source.sourceId,
                sourceKey: f.source.sourceKey,
                target: c.lgdCode,
              },
              evidence: {
                evidenceClass: f.classification,
                original,
                candidates,
                window,
                uncertainty: f.uncertainty,
                notAProof: false,
                requiresReview: true,
              },
              refs,
            },
          ),
        );
      } else if (f.classification === 'state_mismatch') {
        const c = f.candidates[0];
        const target = stateUnit(c.stateCode);
        for (const m of f.markets) {
          // A state-level reorganisation (the district label is an official district of another state) says nothing
          // about ONE mandi. Only market-specific evidence supplied from outside the database turns the proposal
          // into a state correction; without it the mandi stays an unresolved, pending question.
          const supplied = (m.marketSpecificEvidence ?? []).filter((/** @type {any} */ e) =>
            isMarketSpecificEvidence(e, target),
          );
          const specific = supplied.length > 0;
          const missing = specific
            ? []
            : [
                'an official listing of this mandi with its state and district',
                'a government market code record for this mandi',
                'a gazette notification or dated record for this market area',
              ];
          proposals.push(
            finish(
              {
                ...common,
                sourceId: m.aliasSourceId ?? f.source.sourceId,
                sourceKey: m.aliasSourceKey ?? `${f.source.sourceKey}|${m.id}`,
                sourceLabel: m.aliasLabel ?? m.name,
                sourceContext: m.aliasContext ?? f.source.stateLabel,
                evidenceClass: 'state_mismatch',
                evidenceLevel: specific ? 'market_specific' : 'state_level_only',
                decisionKind: specific ? 'correct_state' : 'mark_unresolved',
                entityKind: 'market',
                decisionClass: specific ? 'H' : 'U',
                subjectMarketId: m.id,
                targetStateId: specific ? (target?.registryId ?? null) : null,
                targetAdminUnitVersionId: specific ? (target?.targetVersionId ?? null) : null,
                proposed: specific
                  ? { lgdCode: target?.code, name: target?.name, kind: 'state' }
                  : null,
                original: {
                  marketName: m.name,
                  stateName: m.stateName,
                  districtId: m.districtId,
                  label: f.source.label,
                  stateLabel: f.source.stateLabel,
                },
                uncertainty: {
                  ...f.uncertainty,
                  stateBoundary: 'state_formation_date_not_a_legal_date_in_this_data',
                  marketLocation: specific
                    ? 'supported_by_market_specific_evidence'
                    : 'not_established',
                },
                rationale: specific
                  ? `Mandi "${m.name}" is filed under ${m.stateName} with district label "${f.source.label}"; ${supplied.length} market-specific record(s) place it in ${target?.name}. A change of state is proposed for review only; the mandi's recorded state and its ${m.observations} observations are not changed.`
                  : `Mandi "${m.name}" is filed under ${m.stateName} with district label "${f.source.label}". ${c.name} (LGD ${c.lgdCode}) is an official district of ${c.stateName} and no district of ${f.originalAssignment.labelledState?.name} fits that label, which is state-level evidence about the label. It does not identify this mandi, so the mandi stays where the source put it and the question stays open until market-specific evidence is reviewed.`,
              },
              {
                proposalKeyParts: {
                  kind: specific ? 'correct_state' : 'mark_unresolved',
                  entity: 'market',
                  subjectMarketId: m.id,
                  target: target?.code,
                },
                evidence: {
                  evidenceClass: 'state_mismatch',
                  evidenceLevel: specific ? 'market_specific' : 'state_level_only',
                  original: { ...original, marketName: m.name, marketId: m.id },
                  candidates,
                  window: {
                    observations: m.observations,
                    firstDate: m.firstDate,
                    lastDate: m.lastDate,
                    datasets: f.datasets,
                  },
                  uncertainty: f.uncertainty,
                  stateLevelEvidence: {
                    districtOfferedAsFit: {
                      lgdCode: c.lgdCode,
                      name: c.name,
                      stateName: c.stateName,
                    },
                    appliesTo:
                      'the district label, and so to every mandi filed under it; not to any single mandi',
                    stateRecord: target
                      ? {
                          lgdCode: target.code,
                          name: target.name,
                          lgdEffectiveDate: target.effectiveDate,
                          effectiveIsBaseline: target.effectiveIsBaseline,
                          legalEffectiveDate: null,
                        }
                      : null,
                  },
                  marketSpecificEvidence: supplied,
                  missingEvidence: missing,
                  marketIdentifiers: {
                    governmentMarketCode: m.governmentMarketCode ?? null,
                    coordinatesRecorded: m.hasCoordinates ?? false,
                  },
                  notAProof: true,
                  requiresReview: true,
                },
                refs: [...refs, ...(target ? [referenceRef(target.reference)] : [])],
              },
            ),
          );
        }
      } else {
        const ambiguous = f.classification === 'ambiguous';
        proposals.push(
          finish(
            {
              ...common,
              evidenceClass: f.classification,
              decisionKind: ambiguous ? 'mark_ambiguous' : 'mark_unresolved',
              entityKind: 'district',
              decisionClass: ambiguous ? 'A' : 'U',
              proposed: null,
              uncertainty: f.uncertainty,
              rationale: ambiguous
                ? `Label "${f.source.label}" (${f.source.stateLabel}) fits several official districts (${f.candidates.map((/** @type {any} */ c) => `${c.name} ${c.lgdCode}`).join(', ')}); it must not be mapped to any one of them without more evidence.`
                : f.classification === 'name_only_candidate'
                  ? `Label "${f.source.label}" (${f.source.stateLabel}) resembles ${f.candidates.map((/** @type {any} */ c) => `${c.name} (LGD ${c.lgdCode}) by ${c.rung.replace('_', ' ')}`).join(', ')}. A resemblance of names is not proof of identity: the label stays unresolved until independent evidence is reviewed.`
                  : `Label "${f.source.label}" (${f.source.stateLabel}) matches no official district.`,
            },
            {
              proposalKeyParts: {
                kind: ambiguous ? 'mark_ambiguous' : 'mark_unresolved',
                entity: 'district',
                sourceId: f.source.sourceId,
                sourceKey: f.source.sourceKey,
                candidates: f.candidates.map((/** @type {any} */ c) => c.lgdCode),
              },
              evidence: {
                evidenceClass: f.classification,
                original,
                candidates,
                window,
                uncertainty: f.uncertainty,
                notAProof: true,
                requiresReview: true,
              },
              refs,
            },
          ),
        );
      }
    } else if (f.type === 'unresolved_state_alias') {
      proposals.push(
        finish(
          {
            findingId: f.findingId,
            source: f.source,
            sourceId: f.source.sourceId,
            sourceKey: f.source.sourceKey,
            sourceLabel: f.source.label,
            sourceContext: null,
            evidenceClass: f.classification,
            decisionKind: 'mark_unresolved',
            entityKind: 'state',
            decisionClass: 'U',
            proposed: null,
            uncertainty: f.uncertainty,
            rationale: `State label "${f.source.label}" is not a recognised state name${f.candidates.length ? ` and resembles ${f.candidates.map((/** @type {any} */ c) => c.name).join(', ')}` : ''}. A resemblance is not proof; the label stays unresolved until the owner decides on independent evidence.`,
          },
          {
            proposalKeyParts: {
              kind: 'mark_unresolved',
              entity: 'state',
              sourceId: f.source.sourceId,
              sourceKey: f.source.sourceKey,
              candidates: f.candidates.map((/** @type {any} */ c) => c.lgdCode),
            },
            evidence: {
              evidenceClass: f.classification,
              original: { sourceKey: f.source.sourceKey, sourceLabel: f.source.label },
              candidates: f.candidates.map((/** @type {any} */ c) => ({
                lgdCode: c.lgdCode,
                name: c.name,
                status: c.status,
              })),
              window: {
                observations: f.observations,
                firstDate: f.firstDate,
                lastDate: f.lastDate,
                datasets: f.datasets,
                markets: f.markets.length,
              },
              uncertainty: f.uncertainty,
              notAProof: true,
              requiresReview: true,
            },
            refs: f.candidates
              .map((/** @type {any} */ c) => referenceRef(c.reference))
              .concat(f.datasets.map((/** @type {string} */ d) => `dataset:${d}`)),
          },
        ),
      );
    }
  }
  proposals.sort(
    (a, b) =>
      cmp(a.evidenceClass, b.evidenceClass) ||
      cmp(a.sourceKey, b.sourceKey) ||
      cmp(a.proposalKey, b.proposalKey),
  );
  return proposals;
}

/**
 * @param {any[]} proposals
 */
export function countByClass(proposals) {
  /** @type {Record<string, { proposals: number, twoReviewers: number }>} */
  const out = {};
  for (const p of proposals) {
    out[p.evidenceClass] ??= { proposals: 0, twoReviewers: 0 };
    out[p.evidenceClass].proposals += 1;
    if (p.requiresTwoReviewers) out[p.evidenceClass].twoReviewers += 1;
  }
  return out;
}
