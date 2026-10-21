import {
  compactName,
  digestOf,
  editDistance,
  isSpellingVariant,
  nameTokens,
  normalizeName,
} from './normalize.js';

/**
 * Deterministic, read-only discrepancy analysis between the registry/aliases and the official LGD reference
 * (Milestone 2.4, Stage 3b). A pure function of a snapshot: the same snapshot always gives the same findings in
 * the same order. It changes nothing and decides nothing; every finding keeps the source label exactly as the
 * source wrote it, the original geographic assignment, the dataset and the dates.
 *
 * Evidence classes of a label (strongest first). Only an official identifier would be proof; none of these is:
 *   exact_official_name    the label equals the CURRENT official name (or only differs in spaces/punctuation)
 *   documented_rename      the label equals a FORMER name in the unit's own LGD version history
 *   name_only_candidate    one plausible official unit by a spelling or word rule, nothing else ties them
 *   ambiguous              several official units fit
 *   state_mismatch         no candidate in the labelled state but exactly one other state has one
 *   unresolved_no_candidate nothing fits anywhere
 */

export const ANALYSIS_VERSION = 'geo-analysis-2';

/** Locale-independent ordering (ICU locale differences must not change the order of findings). */
const cmp = (/** @type {any} */ a, /** @type {any} */ b) => (a < b ? -1 : a > b ? 1 : 0);
export const LIMITATIONS = Object.freeze([
  'The dated LGD modification log is not available: rename, split and merger dates are unknown.',
  'LGD version-history pages list names and statuses but show an effective date only for the current version.',
  'Districts 599, 601 and 671 return an LGD error page: they have no official record here.',
]);

const PAGE_PREFIX = { state: 'lgd-state-pages', district: 'lgd-district-pages' };

/** @param {any} row */
const keyOf = (row) => `${row.unit_type}|${row.lgd_code}`;

/**
 * Official units with their name history, built from the loaded reference.
 * @param {any} snapshot
 */
function buildUnits(snapshot) {
  /** @type {Map<string, any[]>} */
  const byUnit = new Map();
  for (const row of snapshot.units) {
    const list = byUnit.get(keyOf(row)) ?? [];
    list.push(row);
    byUnit.set(keyOf(row), list);
  }
  const stateByCode = new Map(snapshot.states.map((s) => [String(s.lgd_code), s]));
  const districtByCode = new Map(snapshot.districts.map((d) => [String(d.lgd_code), d]));
  const states = new Map();
  const districts = new Map();
  for (const [key, rows] of [...byUnit.entries()].sort()) {
    const [type] = key.split('|');
    const pages = rows
      .filter((r) => r.set_code.startsWith(PAGE_PREFIX[/** @type {'state' | 'district'} */ (type)]))
      .sort((a, b) => a.history_seq - b.history_seq);
    const reports = rows.filter((r) => !pages.includes(r));
    const latest =
      pages.find((r) => r.is_latest_version) ?? reports.find((r) => r.is_latest_version) ?? rows[0];
    const reportRow = reports.find((r) => r.is_latest_version) ?? null;
    const currentName = (latest.name_en ?? '').trim();
    const former = [];
    const seen = new Set([normalizeName(currentName)]);
    for (const p of pages) {
      const n = normalizeName(p.name_en);
      if (!seen.has(n)) {
        seen.add(n);
        former.push({ name: p.name_en.trim(), historySeq: p.history_seq, status: p.status });
      }
    }
    const registry = (type === 'state' ? stateByCode : districtByCode).get(String(latest.lgd_code));
    const unit = {
      type,
      code: latest.lgd_code,
      name: currentName,
      stateCode: type === 'district' ? latest.parent_lgd_code : latest.lgd_code,
      status: latest.status,
      effectiveDate: latest.lgd_effective_date,
      effectiveIsBaseline: latest.lgd_effective_is_baseline,
      validFromKnown: latest.valid_from_known,
      versionCount: pages.length || 1,
      formerNames: former,
      targetVersionId: latest.id,
      reportVersionId: reportRow?.id ?? null,
      inReport: reportRow !== null,
      reference: {
        setCode: latest.set_code,
        setSha256: latest.set_sha256,
        sourceUrl: latest.source_url,
        sourceSha256: latest.source_sha256,
        retrievedAt: latest.retrieved_at,
      },
      registryId: registry?.id ?? null,
      registryName: registry?.name ?? null,
      registryActive: registry?.is_active ?? null,
    };
    (type === 'state' ? states : districts).set(String(unit.code), unit);
  }
  return { states, districts, stateByCode, districtByCode };
}

/** @param {string} label @param {any} unit */
function rungsFor(label, unit) {
  const n = normalizeName(label);
  const c = compactName(label);
  const names = [
    { name: unit.name, former: false },
    ...unit.formerNames.map((f) => ({ name: f.name, former: true })),
  ];
  const out = [];
  for (const { name, former } of names) {
    if (normalizeName(name) === n)
      out.push({
        rung: former ? 'documented_rename' : 'exact_official_name',
        detail: 'exact',
        matchedName: name,
      });
    else if (compactName(name) === c)
      out.push({
        rung: former ? 'documented_rename' : 'exact_official_name',
        detail: 'spaces_or_punctuation_only',
        matchedName: name,
      });
  }
  if (out.length > 0) return out;
  const tokens = nameTokens(label);
  if (tokens.length === 1 && tokens[0].length >= 4) {
    for (const { name, former } of names)
      if (nameTokens(name).includes(tokens[0]) && nameTokens(name).length > 1)
        out.push({
          rung: 'token_containment',
          detail: former ? 'token_of_former_name' : 'token_of_current_name',
          matchedName: name,
        });
  }
  if (out.length > 0) return out;
  for (const { name } of names)
    if (isSpellingVariant(c, compactName(name)))
      out.push({
        rung: 'spelling_variant',
        detail: 'edit_distance',
        matchedName: name,
        distance: editDistance(c, compactName(name)),
      });
  return out;
}

/**
 * Candidates for a label among a set of units, by the strongest rung that finds anything.
 * @param {string} label
 * @param {any[]} units
 */
function candidatesAmong(label, units) {
  const exact = [];
  const rename = [];
  const token = [];
  const spelling = [];
  for (const unit of units) {
    const hits = rungsFor(label, unit);
    for (const hit of hits) {
      const entry = { unit, ...hit };
      if (hit.rung === 'exact_official_name') exact.push(entry);
      else if (hit.rung === 'documented_rename') rename.push(entry);
      else if (hit.rung === 'token_containment') token.push(entry);
      else spelling.push(entry);
    }
  }
  const distinct = (/** @type {any[]} */ list) => [
    ...new Map(list.map((e) => [e.unit.code, e])).values(),
  ];
  if (exact.length) return { rung: 'exact_official_name', entries: distinct(exact) };
  if (rename.length) return { rung: 'documented_rename', entries: distinct(rename) };
  if (token.length) {
    // A label that is part of a FORMER name whose stem has since been respelled (Bangalore Rural -> Bengaluru Rural)
    // does not single out one district: every district of the same state that shares the current name's stem is
    // equally a candidate (Bengaluru Urban, Rural, South). Without dated records it stays ambiguous.
    const stem = (/** @type {any} */ unit) => compactName(nameTokens(unit.name)[0] ?? '');
    const family = [];
    for (const e of token.filter((x) => x.detail === 'token_of_former_name'))
      for (const unit of units)
        if (unit.code !== e.unit.code && stem(unit) !== '' && stem(unit) === stem(e.unit))
          family.push({
            unit,
            rung: 'token_containment',
            detail: 'shares_name_stem_of_a_matched_unit',
            matchedName: unit.name,
          });
    return { rung: 'token_containment', entries: distinct([...token, ...family]) };
  }
  if (spelling.length) {
    // only the closest spellings count: a candidate two edits away does not make a one-edit candidate ambiguous
    const closest = Math.min(...spelling.map((e) => e.distance ?? Infinity));
    return {
      rung: 'spelling_variant',
      entries: distinct(spelling.filter((e) => e.distance === closest)),
    };
  }
  return { rung: 'none', entries: [] };
}

/**
 * Where the official unit's current version stands against the label's data window.
 * @param {any} unit
 * @param {string | null} first
 * @param {string | null} last
 */
function temporalFor(unit, first, last) {
  if (!unit.effectiveDate) return 'current_version_date_unknown';
  if (unit.effectiveIsBaseline) return 'current_version_is_lgd_baseline_2005';
  if (first && unit.effectiveDate < first) return 'current_version_predates_data_window';
  if (last && unit.effectiveDate > last) return 'current_version_after_data_window';
  return 'current_version_effective_inside_data_window';
}

/**
 * @param {any} snapshot
 * @param {{ marketEvidence?: Map<string, any[]> }} [options] market-specific evidence supplied from OUTSIDE the database (an
 *        official listing of one mandi, a government market code record, a gazette notification), by market id
 */
export function analyse(snapshot, { marketEvidence = new Map() } = {}) {
  const {
    states: officialStates,
    districts: officialDistricts,
    stateByCode,
  } = buildUnits(snapshot);
  const sourceCode = new Map(snapshot.sources.map((/** @type {any} */ s) => [s.id, s.code]));
  const stateById = new Map(snapshot.states.map((/** @type {any} */ s) => [s.id, s]));
  const districtById = new Map(snapshot.districts.map((/** @type {any} */ d) => [d.id, d]));

  // markets with their observations and provenance
  /** @type {Map<string, any>} */
  const marketInfo = new Map();
  for (const m of snapshot.markets) {
    const entry = marketInfo.get(m.id) ?? {
      id: m.id,
      name: m.name,
      normalizedName: m.normalized_name,
      stateId: m.state_id,
      districtId: m.district_id,
      status: m.status,
      governmentMarketCode: m.government_market_code ?? null,
      hasCoordinates: m.latitude !== null && m.latitude !== undefined,
      aliases: [],
      observations: 0,
      firstDate: null,
      lastDate: null,
      datasets: new Set(),
    };
    if (m.alias_source_key)
      entry.aliases.push({
        sourceId: m.alias_source_id,
        sourceKey: m.alias_source_key,
        label: m.alias_source_label,
        context: m.alias_source_context,
      });
    marketInfo.set(m.id, entry);
  }
  for (const o of snapshot.marketObservations) {
    const info = marketInfo.get(o.market_id);
    if (!info) continue;
    info.observations += o.observations;
    if (!info.firstDate || o.first_date < info.firstDate) info.firstDate = o.first_date;
    if (!info.lastDate || o.last_date > info.lastDate) info.lastDate = o.last_date;
    info.datasets.add(sourceCode.get(o.source_id) ?? o.source_id);
  }

  // registry state of a state label, through the resolved state aliases
  const stateAliasByKey = new Map(
    snapshot.stateAliases.map((/** @type {any} */ a) => [a.source_key, a]),
  );
  const officialStateOfLabel = (/** @type {string} */ label) => {
    const alias = stateAliasByKey.get(`state|${label}`);
    if (!alias || alias.resolution_status !== 'resolved' || !alias.state_id) return null;
    const registry = stateById.get(alias.state_id);
    return registry?.lgd_code ? (officialStates.get(String(registry.lgd_code)) ?? null) : null;
  };

  const findings = [];
  const allDistricts = [...officialDistricts.values()];
  const describeCandidate = (
    /** @type {any} */ e,
    /** @type {string | null} */ first,
    /** @type {string | null} */ last,
  ) => ({
    lgdCode: e.unit.code,
    name: e.unit.name,
    stateCode: e.unit.stateCode,
    stateName: officialStates.get(String(e.unit.stateCode))?.name ?? null,
    rung: e.rung,
    detail: e.detail,
    matchedName: e.matchedName,
    status: e.unit.status,
    currentVersionEffectiveDate: e.unit.effectiveDate,
    currentVersionIsBaseline: e.unit.effectiveIsBaseline,
    versionCount: e.unit.versionCount,
    temporal: temporalFor(e.unit, first, last),
    renameDate: e.rung === 'documented_rename' ? 'not_published' : undefined,
    partialNameMatch: e.rung === 'token_containment' ? true : undefined,
    // The 2005 LGD date is a default, never a formation date; extra versions are real changes whose dates are unknown.
    baselineIsNotFormationDate: e.unit.effectiveIsBaseline ? true : undefined,
    boundaryChanges: e.unit.versionCount > 1 ? 'versions_without_dates' : 'none_recorded',
    unitVersionId: e.unit.targetVersionId,
    registryDistrictId: e.unit.registryId,
    reference: e.unit.reference,
  });

  // ---- 1-3, 7: unresolved district aliases
  for (const alias of snapshot.districtAliases) {
    if (alias.resolution_status === 'resolved') continue;
    const [, stateKey = '', districtKey = ''] = alias.source_key.split('|');
    const labelState = stateKey;
    const label = alias.source_label;
    const markets = [...marketInfo.values()]
      .filter((m) =>
        m.aliases.some((/** @type {any} */ a) =>
          a.sourceKey.startsWith(`market|${stateKey}|${districtKey}|`),
        ),
      )
      .sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id));
    const observations = markets.reduce((n, m) => n + m.observations, 0);
    const first = markets.reduce(
      (d, m) => (m.firstDate && (!d || m.firstDate < d) ? m.firstDate : d),
      /** @type {string | null} */ (null),
    );
    const last = markets.reduce(
      (d, m) => (m.lastDate && (!d || m.lastDate > d) ? m.lastDate : d),
      /** @type {string | null} */ (null),
    );
    const labelledState = officialStateOfLabel(labelState);

    let classification = 'unresolved_no_candidate';
    let candidates = [];
    let note = '';
    if (labelledState) {
      const inState = candidatesAmong(
        label,
        allDistricts.filter((d) => String(d.stateCode) === String(labelledState.code)),
      );
      if (inState.entries.length > 0) {
        candidates = inState.entries.map((e) => describeCandidate(e, first, last));
        if (inState.entries.length > 1) classification = 'ambiguous';
        else if (inState.rung === 'exact_official_name') classification = 'exact_official_name';
        else if (inState.rung === 'documented_rename') classification = 'documented_rename';
        else classification = 'name_only_candidate';
      } else {
        const elsewhere = candidatesAmong(
          label,
          allDistricts.filter((d) => String(d.stateCode) !== String(labelledState.code)),
        );
        if (elsewhere.entries.length > 0) {
          candidates = elsewhere.entries.map((e) => describeCandidate(e, first, last));
          const states = new Set(elsewhere.entries.map((e) => e.unit.stateCode));
          classification =
            elsewhere.entries.length === 1 &&
            elsewhere.rung !== 'token_containment' &&
            elsewhere.rung !== 'spelling_variant'
              ? 'state_mismatch'
              : elsewhere.entries.length === 1
                ? 'name_only_candidate'
                : 'ambiguous';
          note = `no district of ${labelledState.name} fits; the strongest fit (${elsewhere.rung}) is in ${[...states].map((c) => officialStates.get(String(c))?.name).join(' and ')}`;
        }
      }
    } else {
      const r = candidatesAmong(label, allDistricts);
      candidates = r.entries.map((e) => describeCandidate(e, first, last));
      classification =
        r.entries.length === 0
          ? 'unresolved_no_candidate'
          : r.entries.length > 1
            ? 'ambiguous'
            : 'name_only_candidate';
      note = 'the state label is itself unresolved: only a name-only candidate is possible';
    }
    candidates.sort((a, b) => a.lgdCode - b.lgdCode);

    const stateCodes = new Set(candidates.map((c) => c.stateCode));
    findings.push({
      type: 'unresolved_district_alias',
      key: alias.source_key,
      classification,
      source: {
        aliasId: alias.id,
        sourceId: alias.source_id,
        dataset: sourceCode.get(alias.source_id) ?? null,
        sourceKey: alias.source_key,
        label,
        stateLabel: labelState,
        status: alias.resolution_status,
      },
      originalAssignment: {
        labelledState: labelledState
          ? {
              lgdCode: labelledState.code,
              name: labelledState.name,
              registryStateId: labelledState.registryId,
            }
          : null,
        registryDistrict: alias.district_id
          ? (districtById.get(alias.district_id)?.name ?? null)
          : null,
      },
      observations,
      firstDate: first,
      lastDate: last,
      datasets: [...new Set(markets.flatMap((m) => [...m.datasets]))].sort(),
      markets: markets.map((m) => ({
        id: m.id,
        name: m.name,
        stateId: m.stateId,
        stateName: stateById.get(m.stateId)?.name ?? null,
        districtId: m.districtId,
        observations: m.observations,
        firstDate: m.firstDate,
        lastDate: m.lastDate,
        aliasSourceId: m.aliases[0]?.sourceId ?? null,
        aliasSourceKey: m.aliases[0]?.sourceKey ?? null,
        aliasLabel: m.aliases[0]?.label ?? null,
        aliasContext: m.aliases[0]?.context ?? null,
        governmentMarketCode: m.governmentMarketCode,
        hasCoordinates: m.hasCoordinates,
        marketSpecificEvidence: marketEvidence.get(m.id) ?? [],
      })),
      candidates,
      candidateStates: [...stateCodes].sort(),
      uncertainty: {
        geographic:
          classification === 'state_mismatch'
            ? 'state_boundary_in_question'
            : classification === 'ambiguous'
              ? 'several_candidates'
              : classification === 'unresolved_no_candidate'
                ? 'no_candidate'
                : 'single_candidate_not_proof',
        temporal:
          candidates.length === 1
            ? candidates[0].temporal
            : candidates.length === 0
              ? 'no_candidate'
              : 'varies_by_candidate',
        renameDate: candidates.some((c) => c.rung === 'documented_rename')
          ? 'not_published'
          : 'not_applicable',
      },
      note,
    });
  }

  // ---- unresolved state aliases (e.g. Gao)
  for (const alias of snapshot.stateAliases) {
    if (alias.resolution_status === 'resolved') continue;
    const label = alias.source_label;
    const c = compactName(label);
    const entries = [...officialStates.values()].filter((s) => {
      const names = [s.name, ...s.formerNames.map((/** @type {any} */ f) => f.name)];
      return names.some((n) => compactName(n) === c || isSpellingVariant(c, compactName(n)));
    });
    const markets = [...marketInfo.values()].filter((m) =>
      m.aliases.some((/** @type {any} */ a) =>
        a.sourceKey.startsWith(`market|${alias.source_key.split('|')[1]}|`),
      ),
    );
    findings.push({
      type: 'unresolved_state_alias',
      key: alias.source_key,
      classification:
        entries.length === 1
          ? 'name_only_candidate'
          : entries.length > 1
            ? 'ambiguous'
            : 'unresolved_no_candidate',
      source: {
        aliasId: alias.id,
        sourceId: alias.source_id,
        dataset: sourceCode.get(alias.source_id) ?? null,
        sourceKey: alias.source_key,
        label,
        status: alias.resolution_status,
      },
      originalAssignment: { labelledState: null },
      observations: markets.reduce((n, m) => n + m.observations, 0),
      firstDate: markets.reduce(
        (d, m) => (m.firstDate && (!d || m.firstDate < d) ? m.firstDate : d),
        /** @type {string | null} */ (null),
      ),
      lastDate: markets.reduce(
        (d, m) => (m.lastDate && (!d || m.lastDate > d) ? m.lastDate : d),
        /** @type {string | null} */ (null),
      ),
      datasets: [...new Set(markets.flatMap((m) => [...m.datasets]))].sort(),
      markets: markets.map((m) => ({ id: m.id, name: m.name, observations: m.observations })),
      candidates: entries.map((s) => ({
        lgdCode: s.code,
        name: s.name,
        status: s.status,
        currentVersionEffectiveDate: s.effectiveDate,
        unitVersionId: s.targetVersionId,
        registryStateId: s.registryId,
        reference: s.reference,
      })),
      uncertainty: {
        geographic: 'single_candidate_not_proof',
        temporal: 'not_applicable',
        renameDate: 'not_applicable',
      },
      note: 'A state label that is not a recognised name; a spelling or letter-order resemblance is not proof.',
    });
  }

  // ---- 4. official districts absent from the registry
  for (const d of [...officialDistricts.values()].sort((a, b) => a.code - b.code)) {
    if (d.registryId) continue;
    const sameState = snapshot.districts.filter(
      (r) => String(stateByCode.get(String(d.stateCode))?.id) === String(r.state_id),
    );
    const similar = sameState.filter(
      (r) =>
        compactName(r.name) === compactName(d.name) ||
        isSpellingVariant(compactName(r.name), compactName(d.name)),
    );
    findings.push({
      type: 'official_district_absent_from_registry',
      key: `district|${d.code}`,
      classification: 'registry_gap',
      official: {
        lgdCode: d.code,
        name: d.name,
        stateCode: d.stateCode,
        stateName: officialStates.get(String(d.stateCode))?.name ?? null,
        status: d.status,
        currentVersionEffectiveDate: d.effectiveDate,
        effectiveIsBaseline: d.effectiveIsBaseline,
        versionCount: d.versionCount,
        formerNames: d.formerNames,
        unitVersionId: d.targetVersionId,
        reference: d.reference,
      },
      registryDistrictsWithSimilarName: similar.map((r) => ({
        id: r.id,
        name: r.name,
        lgdCode: r.lgd_code,
      })),
      note: 'The registry has no district with this LGD code. Adding districts is a registry change, outside identity decisions.',
    });
  }

  // ---- registry districts without an official record
  const marketsByDistrict = new Map();
  for (const m of marketInfo.values())
    if (m.districtId)
      marketsByDistrict.set(m.districtId, [...(marketsByDistrict.get(m.districtId) ?? []), m]);
  for (const r of snapshot.districts) {
    if (officialDistricts.has(String(r.lgd_code))) continue;
    const ms = marketsByDistrict.get(r.id) ?? [];
    findings.push({
      type: 'registry_district_without_official_record',
      key: `district|${r.lgd_code}`,
      classification: 'no_official_record',
      registry: {
        id: r.id,
        name: r.name,
        lgdCode: r.lgd_code,
        stateName: stateById.get(r.state_id)?.name ?? null,
      },
      markets: ms.map((m) => ({ id: m.id, name: m.name, observations: m.observations })),
      observations: ms.reduce((n, m) => n + m.observations, 0),
      note: 'LGD returned an error page for this id: the district cannot be verified against an official record.',
    });
  }

  // ---- 5. inactive or historical official units
  for (const u of [...officialStates.values(), ...officialDistricts.values()].sort(
    (a, b) => cmp(a.type, b.type) || a.code - b.code,
  )) {
    if (u.status !== 'inactive') continue;
    const ms =
      u.type === 'district' && u.registryId ? (marketsByDistrict.get(u.registryId) ?? []) : [];
    findings.push({
      type: 'inactive_official_unit',
      key: `${u.type}|${u.code}`,
      classification: u.inReport ? 'inactive_in_page_but_listed_in_report' : 'inactive',
      official: {
        unitType: u.type,
        lgdCode: u.code,
        name: u.name,
        stateCode: u.stateCode,
        status: u.status,
        currentVersionEffectiveDate: u.effectiveDate,
        effectiveIsBaseline: u.effectiveIsBaseline,
        versionCount: u.versionCount,
        formerNames: u.formerNames,
        unitVersionId: u.targetVersionId,
        reference: u.reference,
      },
      registryId: u.registryId,
      markets: ms.map((m) => ({ id: m.id, name: m.name, observations: m.observations })),
      observations: ms.reduce((n, m) => n + m.observations, 0),
      reliability: 'history_status_unverified',
      note: "The last row of the unit's own LGD history shows 'inactive' although the unit is listed as current in the report. This status is NOT reliable evidence: Maharashtra and Odisha, which are active states, appear here too. It must not be used to infer that a unit ended.",
    });
  }

  // ---- 6. ambiguous mandi names
  /** @type {Map<string, any[]>} */
  const byName = new Map();
  for (const m of marketInfo.values())
    byName.set(m.normalizedName, [...(byName.get(m.normalizedName) ?? []), m]);
  for (const [name, ms] of [...byName.entries()].sort()) {
    const locations = new Set(ms.map((m) => `${m.stateId}|${m.districtId ?? ''}`));
    if (ms.length < 2 || locations.size < 2) continue;
    findings.push({
      type: 'ambiguous_market_name',
      key: `market|${name}`,
      classification: 'same_name_several_locations',
      name,
      markets: ms
        .map((m) => ({
          id: m.id,
          name: m.name,
          stateName: stateById.get(m.stateId)?.name ?? null,
          districtName: m.districtId ? (districtById.get(m.districtId)?.name ?? null) : null,
          observations: m.observations,
          firstDate: m.firstDate,
          lastDate: m.lastDate,
          datasets: [...m.datasets].sort(),
        }))
        .sort((a, b) => cmp(String(a.stateName), String(b.stateName)) || cmp(a.id, b.id)),
      observations: ms.reduce((n, m) => n + m.observations, 0),
      note: 'Distinct mandis can share a name; the name alone never identifies one.',
    });
  }

  const order = [
    'unresolved_district_alias',
    'unresolved_state_alias',
    'official_district_absent_from_registry',
    'registry_district_without_official_record',
    'inactive_official_unit',
    'ambiguous_market_name',
  ];
  findings.sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type) || cmp(String(a.key), String(b.key)),
  );
  for (const f of findings)
    /** @type {any} */ (f).findingId = digestOf({ type: f.type, key: f.key }, 16);
  return {
    version: ANALYSIS_VERSION,
    limitations: LIMITATIONS,
    findings,
    summary: summarise(findings),
    context: { officialStates, officialDistricts },
  };
}

/** @param {any[]} findings */
export function summarise(findings) {
  /** @type {Record<string, Record<string, number>>} */
  const byType = {};
  for (const f of findings) {
    byType[f.type] ??= {};
    byType[f.type][f.classification] = (byType[f.type][f.classification] ?? 0) + 1;
  }
  const aliases = findings.filter((f) => f.type === 'unresolved_district_alias');
  // A mandi can sit under two district labels (two spellings of its state): per-label totals count it twice, the
  // distinct totals count it once.
  /** @type {Map<string, { observations: number, labels: string[] }>} */
  const distinct = new Map();
  for (const f of aliases)
    for (const m of f.markets) {
      const entry = distinct.get(m.id) ?? {
        observations: m.observations,
        labels: /** @type {string[]} */ ([]),
      };
      entry.labels.push(f.source.sourceKey);
      distinct.set(m.id, entry);
    }
  return {
    findings: findings.length,
    byType,
    unresolvedDistrictAliases: aliases.length,
    perLabelMarkets: aliases.reduce((n, f) => n + f.markets.length, 0),
    perLabelObservations: aliases.reduce((n, f) => n + f.observations, 0),
    distinctMarkets: distinct.size,
    distinctObservations: [...distinct.values()].reduce((n, e) => n + e.observations, 0),
    marketsUnderSeveralLabels: [...distinct.entries()]
      .filter(([, e]) => e.labels.length > 1)
      .map(([id, e]) => ({ id, labels: e.labels.sort() }))
      .sort((a, b) => cmp(a.id, b.id)),
  };
}
