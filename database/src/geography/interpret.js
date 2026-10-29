/**
 * Read-only interpretation of the accepted identity decisions that are IN EFFECT (Milestone 2.4, Stage 3c).
 *
 * The input is the rows of the view `identity_decision_in_effect` (accepted decisions of the one active mapping
 * set). The output answers "what did the reviewers decide about this label?" for a reader such as an API. It
 * applies nothing: no registry row, alias, mandi or observation is changed by a decision, and this module has no
 * database access at all. It fails closed: a label with no decision, a conflicting decision, or a decision whose
 * validity does not cover the date asked about, resolves to null.
 */

/**
 * @param {any} row
 * @returns {string}
 */
export const labelKey = (row) => `${row.source_id}|${row.entity_kind}|${row.source_key}`;

/**
 * @param {any[]} rows rows of identity_decision_in_effect
 */
export function interpretInEffect(rows) {
  const sets = new Set(rows.map((r) => r.mapping_set_id));
  if (sets.size > 1)
    throw new Error(
      'the rows come from more than one mapping set: only the active set is in effect',
    );
  if (rows.some((r) => r.status !== 'accepted'))
    throw new Error('only accepted decisions can be in effect');
  /** @type {Map<string, any[]>} */
  const byLabel = new Map();
  for (const r of rows) {
    const key = r.subject_market_id
      ? `market|${r.subject_market_id}|${r.decision_kind}`
      : labelKey(r);
    byLabel.set(key, [...(byLabel.get(key) ?? []), r]);
  }
  const mappings = new Map();
  const conflicts = [];
  for (const [key, list] of byLabel) {
    if (list.length > 1) {
      conflicts.push({ key, decisionIds: list.map((r) => r.id).sort() });
      continue;
    }
    const r = list[0];
    mappings.set(key, {
      decisionId: r.id,
      kind: r.decision_kind,
      entityKind: r.entity_kind,
      sourceLabel: r.source_label,
      decisionClass: r.decision_class,
      targetDistrictId: r.target_district_id ?? null,
      targetStateId: r.target_state_id ?? null,
      targetAdminUnitVersionId: r.target_admin_unit_version_id ?? null,
      subjectMarketId: r.subject_market_id ?? null,
      validFrom: r.valid_from ?? null,
      validTo: r.valid_to ?? null,
      mappingSetCode: r.mapping_set_code ?? null,
      /** A map_label decision names a target; mark_ambiguous and mark_unresolved record that there is none. */
      identifies: r.decision_kind === 'map_label' || r.decision_kind === 'correct_state',
    });
  }
  return {
    applied: false,
    mappingSetCode: rows[0]?.mapping_set_code ?? null,
    count: mappings.size,
    mappings,
    conflicts,
  };
}

/**
 * What the decisions in effect say about one source label, on a date; null when nothing identifies it.
 * @param {ReturnType<typeof interpretInEffect>} interpretation
 * @param {{ sourceId: string, entityKind: string, sourceKey: string, date?: string | null }} label
 */
export function resolveLabel(interpretation, { sourceId, entityKind, sourceKey, date = null }) {
  const m = interpretation.mappings.get(`${sourceId}|${entityKind}|${sourceKey}`);
  if (!m || !m.identifies) return null;
  if (date && ((m.validFrom && date < m.validFrom) || (m.validTo && date > m.validTo))) return null;
  return m;
}
