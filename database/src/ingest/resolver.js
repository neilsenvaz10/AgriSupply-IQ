import { randomUUID } from 'node:crypto';
import { normalizeLabel } from './util.js';

/**
 * Identity resolution: source labels to canonical registry entities, with explicit states.
 *
 * Rules (documented in database/docs/INGESTION.md):
 *  - A label resolves ONLY by (1) a reviewed alias decision or (2) an exact normalised match
 *    (case and whitespace only). There is no fuzzy matching.
 *  - Anything else is recorded as an `unresolved` alias (or `ambiguous` / `rejected` when a
 *    decision says so) and its observations are quarantined, never guessed.
 *  - Districts resolve only inside their already-resolved state, so a district name shared by
 *    several states can never cross states.
 *  - Markets have no authoritative reference. A market is created from its source labels with
 *    status `unverified`; when its district is unresolved the source district label becomes the
 *    market's `disambiguator`, so same-named markets in different places never merge and no
 *    district is invented.
 *  - Commodities and varieties are created per exact normalised source label; labels that differ
 *    in any other way stay separate (possible duplicates are reported for review, not merged).
 *
 * The resolver holds registry state in memory (bounded by the number of distinct labels) and
 * records NEW rows as "pending" with client-generated UUIDs. The persistence layer writes them in
 * the same transaction as the facts that use them; `commit()` / `rollback()` keep the caches in
 * step with what the database really accepted.
 */

/**
 * Variety labels that mean "not specified": stored as NULL, original label kept on the fact.
 * "Local" is NOT here: it is a distinct source label (a real variety row per commodity); treating it
 * as unspecified made it collide with "Other" and produced 181 false conflicts in dataset A.
 */
const UNSPECIFIED_VARIETY = new Set(['', 'other']);

/**
 * @typedef {'resolved' | 'ambiguous' | 'unresolved' | 'rejected'} AliasStatus
 * @typedef {{ id: string, name: string, lgd: string | null, kind: string }} StateEntry
 * @typedef {{ id: string, stateId: string, name: string, lgd: string | null }} DistrictEntry
 * @typedef {{ status: AliasStatus, entityId: string | null }} AliasEntry
 * @typedef {{ status: AliasStatus, entityId: string | null, note: string }} Decision
 */

export class Resolver {
  /**
   * @param {{
   *   sourceId: string,
   *   runId: string | null,
   *   states?: StateEntry[],
   *   districts?: DistrictEntry[],
   *   commodities?: Array<{ id: string, normalized: string }>,
   *   varieties?: Array<{ id: string, commodityId: string, normalized: string }>,
   *   markets?: Array<{ id: string, stateId: string, districtId: string | null, normalized: string, disambiguator: string }>,
   *   wpiSeries?: Array<{ id: string, normalized: string }>,
   *   aliases?: Array<{ table: string, key: string, status: AliasStatus, entityId: string | null }>,
   *   decisions?: Map<string, Decision>,
   * }} init
   */
  constructor(init) {
    this.sourceId = init.sourceId;
    this.runId = init.runId;
    this.decisions = init.decisions ?? new Map();
    /** @type {Map<string, StateEntry>} */
    this.statesByNorm = new Map();
    /** @type {Map<string, StateEntry>} */
    this.statesByLgd = new Map();
    /** @type {Map<string, Map<string, DistrictEntry>>} */
    this.districtsByState = new Map();
    /** @type {Map<string, DistrictEntry>} */
    this.districtsByLgd = new Map();
    for (const s of init.states ?? []) {
      this.statesByNorm.set(normalizeLabel(s.name), s);
      if (s.lgd) this.statesByLgd.set(s.lgd, s);
    }
    for (const d of init.districts ?? []) {
      let byName = this.districtsByState.get(d.stateId);
      if (!byName) this.districtsByState.set(d.stateId, (byName = new Map()));
      byName.set(normalizeLabel(d.name), d);
      if (d.lgd) this.districtsByLgd.set(d.lgd, d);
    }
    /** @type {Map<string, string>} */
    this.commodities = new Map((init.commodities ?? []).map((c) => [c.normalized, c.id]));
    /** @type {Map<string, string>} */
    this.varieties = new Map(
      (init.varieties ?? []).map((v) => [`${v.commodityId}|${v.normalized}`, v.id]),
    );
    /** @type {Map<string, string>} */
    this.markets = new Map(
      (init.markets ?? []).map((m) => [
        `${m.stateId}|${m.districtId ?? ''}|${m.normalized}|${m.disambiguator}`,
        m.id,
      ]),
    );
    /** @type {Map<string, string>} */
    this.wpiSeries = new Map((init.wpiSeries ?? []).map((s) => [s.normalized, s.id]));
    /** @type {Map<string, AliasEntry>} */
    this.aliases = new Map(
      (init.aliases ?? []).map((a) => [
        `${a.table}|${a.key}`,
        { status: a.status, entityId: a.entityId },
      ]),
    );
    this.pending = newPending();
    /** @type {Array<() => void>} */
    this.undo = [];
    /** Rows affected by each unresolved label, for the run summary and reports. */
    this.unresolved = { state: new Map(), district: new Map() };
    this.created = { commodities: 0, varieties: 0, markets: 0, aliases: 0, wpiSeries: 0 };
  }

  // ---------------------------------------------------------------- transaction bookkeeping

  /** The database accepted the pending rows: keep the cache entries. */
  commit() {
    this.pending = newPending();
    this.undo = [];
  }

  /** The database rejected them (rolled back): forget them. */
  rollback() {
    for (const fn of this.undo.reverse()) fn();
    this.pending = newPending();
    this.undo = [];
  }

  /** @template K, V @param {Map<K, V>} map @param {K} key @param {V} value */
  #put(map, key, value) {
    map.set(key, value);
    this.undo.push(() => map.delete(key));
  }

  /** @param {string} table @param {string} key @param {Omit<AliasRow, 'id' | 'table' | 'sourceId' | 'key'>} data */
  #addAlias(table, key, data) {
    const id = randomUUID();
    this.pending.aliases.push({ id, table, sourceId: this.sourceId, key, ...data });
    this.#put(this.aliases, `${table}|${key}`, { status: data.status, entityId: data.entityId });
    this.created.aliases += 1;
  }

  /** @param {string} kind @param {string} key */
  #decision(kind, key) {
    return this.decisions.get(`${kind}|${key}`) ?? this.decisions.get(`${kind}|*|${key}`) ?? null;
  }

  // ---------------------------------------------------------------- states

  /**
   * @param {string} label State label exactly as the source wrote it.
   * @returns {{ status: AliasStatus, stateId: string | null, note: string }}
   */
  state(label) {
    const norm = normalizeLabel(label);
    const key = `state|${norm}`;
    const known = this.aliases.get(`state_aliases|${key}`);
    if (known) return { status: known.status, stateId: known.entityId, note: '' };

    const decision = this.#decision('state', norm);
    /** @type {AliasStatus} */ let status;
    /** @type {string | null} */ let entityId = null;
    let note;
    if (decision) {
      status = decision.status;
      note = decision.note;
      if (status === 'resolved') {
        const target = decision.entityId ? this.statesByLgd.get(decision.entityId) : undefined;
        if (target) entityId = target.id;
        else {
          status = 'unresolved';
          note = `decision names LGD code ${decision.entityId}, which is not in the loaded registry`;
        }
      }
    } else {
      const exact = this.statesByNorm.get(norm);
      if (exact) {
        status = 'resolved';
        entityId = exact.id;
        note = `exact normalised match to "${exact.name}"`;
      } else {
        status = 'unresolved';
        note = 'no exact match in the loaded reference registry and no reviewed decision';
      }
    }
    this.#addAlias('state_aliases', key, {
      label: label.trim(),
      context: null,
      entityColumn: 'state_id',
      entityId,
      status,
      note,
    });
    return { status, stateId: entityId, note };
  }

  // ---------------------------------------------------------------- districts

  /**
   * @param {{ status: AliasStatus, stateId: string | null }} state Already-resolved state.
   * @param {string} stateLabel
   * @param {string} label District label exactly as the source wrote it.
   * @returns {{ status: AliasStatus, districtId: string | null }}
   */
  district(state, stateLabel, label) {
    if (state.status !== 'resolved' || !state.stateId)
      return { status: 'unresolved', districtId: null };
    const stateNorm = normalizeLabel(stateLabel);
    const norm = normalizeLabel(label);
    const key = `district|${stateNorm}|${norm}`;
    const known = this.aliases.get(`district_aliases|${key}`);
    if (known) return { status: known.status, districtId: known.entityId };

    const decision = this.#decision('district', `${stateNorm}|${norm}`);
    /** @type {AliasStatus} */ let status;
    /** @type {string | null} */ let entityId = null;
    let note;
    if (decision) {
      status = decision.status;
      note = decision.note;
      if (status === 'resolved') {
        const target = decision.entityId ? this.districtsByLgd.get(decision.entityId) : undefined;
        if (target && target.stateId === state.stateId) entityId = target.id;
        else {
          status = 'unresolved';
          note = 'decision target is not a district of the resolved state in the loaded registry';
        }
      }
    } else {
      const exact = this.districtsByState.get(state.stateId)?.get(norm);
      if (exact) {
        status = 'resolved';
        entityId = exact.id;
        note = `exact normalised match to "${exact.name}" within the resolved state`;
      } else {
        status = 'unresolved';
        note =
          "no exact match among this state's districts in the loaded reference registry (districts created or renamed after the reference date stay unresolved)";
      }
    }
    this.#addAlias('district_aliases', key, {
      label: label.trim(),
      context: stateLabel.trim(),
      entityColumn: 'district_id',
      entityId,
      status,
      note,
    });
    return { status, districtId: entityId };
  }

  // ---------------------------------------------------------------- markets

  /**
   * Finds or creates the market for these source labels. Never merges markets on name alone.
   *
   * @param {{ stateId: string }} state Resolved state.
   * @param {{ districtId: string | null }} district Result of {@link district} (may be unresolved).
   * @param {{ state: string, district: string, market: string }} labels
   * @returns {string} market id
   */
  market(state, district, labels) {
    const aliasKey = `market|${normalizeLabel(labels.state)}|${normalizeLabel(labels.district)}|${normalizeLabel(labels.market)}`;
    const known = this.aliases.get(`market_aliases|${aliasKey}`);
    if (known?.entityId) return known.entityId;

    const norm = normalizeLabel(labels.market);
    const disambiguator = district.districtId
      ? ''
      : `src-district:${normalizeLabel(labels.district)}`;
    const identity = `${state.stateId}|${district.districtId ?? ''}|${norm}|${disambiguator}`;
    let marketId = this.markets.get(identity);
    let note = 'exact identity match to an existing market';
    if (!marketId) {
      marketId = randomUUID();
      this.pending.markets.push({
        id: marketId,
        stateId: state.stateId,
        districtId: district.districtId,
        name: labels.market.trim(),
        disambiguator,
      });
      this.#put(this.markets, identity, marketId);
      this.created.markets += 1;
      note = 'market created from source labels; status unverified (no authoritative market list)';
    }
    this.#addAlias('market_aliases', aliasKey, {
      label: labels.market.trim(),
      context: `${labels.state.trim()}|${labels.district.trim()}`,
      entityColumn: 'market_id',
      entityId: marketId,
      status: 'resolved',
      note,
    });
    return marketId;
  }

  // ---------------------------------------------------------------- commodities and varieties

  /**
   * @param {string} label Commodity label exactly as the source wrote it.
   * @param {string | null} [group] Source commodity group, stored on creation only.
   * @returns {string} commodity id
   */
  commodity(label, group = null) {
    const norm = normalizeLabel(label);
    const key = `commodity|${norm}`;
    const known = this.aliases.get(`commodity_aliases|${key}`);
    if (known?.entityId) return known.entityId;

    let id = this.commodities.get(norm);
    let note = 'exact normalised match to an existing commodity';
    if (!id) {
      id = randomUUID();
      this.pending.commodities.push({ id, name: label.trim(), group: group?.trim() || null });
      this.#put(this.commodities, norm, id);
      this.created.commodities += 1;
      note = 'commodity created from this exact source label';
    }
    this.#addAlias('commodity_aliases', key, {
      label: label.trim(),
      context: null,
      entityColumn: 'commodity_id',
      entityId: id,
      status: 'resolved',
      note,
    });
    return id;
  }

  /**
   * @param {string} commodityId
   * @param {string} commodityLabel
   * @param {string} label Variety label exactly as the source wrote it.
   * @returns {string | null} variety id, or null when the variety is unspecified
   */
  variety(commodityId, commodityLabel, label) {
    const norm = normalizeLabel(label);
    if (UNSPECIFIED_VARIETY.has(norm)) return null;
    const key = `variety|${normalizeLabel(commodityLabel)}|${norm}`;
    const known = this.aliases.get(`variety_aliases|${key}`);
    if (known?.entityId) return known.entityId;

    const identity = `${commodityId}|${norm}`;
    let id = this.varieties.get(identity);
    let note = 'exact normalised match to an existing variety of this commodity';
    if (!id) {
      id = randomUUID();
      this.pending.varieties.push({ id, commodityId, name: label.trim() });
      this.#put(this.varieties, identity, id);
      this.created.varieties += 1;
      note = 'variety created from this exact source label';
    }
    this.#addAlias('variety_aliases', key, {
      label: label.trim(),
      context: commodityLabel.trim(),
      entityColumn: 'variety_id',
      entityId: id,
      status: 'resolved',
      note,
    });
    return id;
  }

  // ---------------------------------------------------------------- WPI series

  /** @param {string} label WPI item label exactly as the source wrote it. @returns {string} series id */
  wpiSeriesId(label) {
    const norm = normalizeLabel(label);
    let id = this.wpiSeries.get(norm);
    if (!id) {
      id = randomUUID();
      this.pending.wpiSeries.push({ id, itemLabel: label.trim() });
      this.#put(this.wpiSeries, norm, id);
      this.created.wpiSeries += 1;
    }
    return id;
  }

  /** Counts a row quarantined because an identity is unresolved. @param {'state' | 'district'} kind @param {string} label */
  noteUnresolved(kind, label) {
    const map = this.unresolved[kind];
    map.set(label.trim(), (map.get(label.trim()) ?? 0) + 1);
  }
}

/**
 * @typedef {object} AliasRow
 * @property {string} id
 * @property {string} table
 * @property {string} sourceId
 * @property {string} key
 * @property {string} label
 * @property {string | null} context
 * @property {string} entityColumn
 * @property {string | null} entityId
 * @property {AliasStatus} status
 * @property {string} note
 */

function newPending() {
  return {
    /** @type {AliasRow[]} */ aliases: [],
    /** @type {Array<{ id: string, name: string, group: string | null }>} */ commodities: [],
    /** @type {Array<{ id: string, commodityId: string, name: string }>} */ varieties: [],
    /** @type {Array<{ id: string, stateId: string, districtId: string | null, name: string, disambiguator: string }>} */ markets:
      [],
    /** @type {Array<{ id: string, itemLabel: string }>} */ wpiSeries: [],
  };
}
