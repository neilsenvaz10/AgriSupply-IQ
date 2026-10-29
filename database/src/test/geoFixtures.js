import { createHash } from 'node:crypto';

/**
 * A small SYNTHETIC geography for the Stage 3b tests: two states (Beta was carved out of Alpha), districts with
 * name histories, unresolved district and state labels, mandis, and one deliberately ambiguous mandi name.
 * Codes are 99xxxx so nothing here can be mistaken for an LGD code. The same spec is rendered either as an
 * in-memory snapshot (unit tests) or as rows in a disposable database (integration tests).
 */

export const WORLD = {
  sourceCode: 'synthetic-source-a',
  states: [
    {
      key: 'alpha',
      name: 'Alpha',
      lgd: 990001,
      kind: 'state',
      effective: '2005-01-01',
      baseline: true,
    },
    {
      key: 'beta',
      name: 'Beta',
      lgd: 990002,
      kind: 'state',
      effective: '2014-06-17',
      baseline: false,
    },
  ],
  // official districts: names in history order, the last one is current
  districts: [
    {
      code: 990101,
      state: 990001,
      history: ['Northville'],
      status: 'active',
      effective: '2005-01-01',
      baseline: true,
      registry: true,
    },
    {
      code: 990102,
      state: 990001,
      history: ['Oldname', 'Newname'],
      status: 'active',
      effective: '2016-03-04',
      baseline: false,
      registry: true,
    },
    {
      code: 990103,
      state: 990001,
      history: ['Palakkadx'],
      status: 'active',
      effective: '2005-01-01',
      baseline: true,
      registry: true,
    },
    {
      code: 990104,
      state: 990001,
      history: ['Kanpurx Nagar'],
      status: 'active',
      effective: '2005-01-01',
      baseline: true,
      registry: true,
    },
    {
      code: 990105,
      state: 990001,
      history: ['Kanpurx Dehat'],
      status: 'active',
      effective: '2005-01-01',
      baseline: true,
      registry: true,
    },
    {
      code: 990106,
      state: 990001,
      history: ['Oldline', 'Inactivedist'],
      status: 'inactive',
      effective: '2020-05-06',
      baseline: false,
      registry: true,
    },
    {
      code: 990107,
      state: 990001,
      history: ['Gapdist'],
      status: 'active',
      effective: '2005-01-01',
      baseline: true,
      registry: false,
    },
    // a family sharing a stem whose old spelling differs (like Bangalore / Bengaluru Urban, Rural, South)
    {
      code: 990401,
      state: 990001,
      history: ['Metro Urban'],
      status: 'active',
      effective: '2005-01-01',
      baseline: true,
      registry: true,
    },
    {
      code: 990402,
      state: 990001,
      history: ['Oldmetro Rural', 'Metro Rural'],
      status: 'active',
      effective: '2015-01-14',
      baseline: false,
      registry: true,
    },
    {
      code: 990403,
      state: 990001,
      history: ['Metro South'],
      status: 'active',
      effective: '2025-05-23',
      baseline: false,
      registry: true,
    },
    // a district whose current version has no date at all
    {
      code: 990108,
      state: 990001,
      history: ['Undateddist'],
      status: 'active',
      effective: null,
      baseline: false,
      registry: true,
    },
    {
      code: 990201,
      state: 990002,
      history: ['Betadist'],
      status: 'active',
      effective: '2014-06-17',
      baseline: false,
      registry: true,
    },
  ],
  // registry districts that have no official record
  registryOnly: [{ code: 990999, state: 'alpha', name: 'Nowhere' }],
  // unresolved district labels with the mandis filed under them
  unresolved: [
    {
      state: 'alpha',
      label: 'north ville',
      markets: [{ name: 'Northmandi', obs: 10, first: '2023-06-06', last: '2023-12-31' }],
    },
    {
      state: 'alpha',
      label: 'oldname',
      markets: [{ name: 'Oldmandi', obs: 20, first: '2023-06-06', last: '2025-06-11' }],
    },
    {
      state: 'alpha',
      label: 'palakadx',
      markets: [{ name: 'Palamandi', obs: 5, first: '2024-01-01', last: '2024-02-02' }],
    },
    {
      state: 'alpha',
      label: 'kanpurx',
      markets: [{ name: 'Kanpurmandi', obs: 3, first: '2024-10-12', last: '2024-11-11' }],
    },
    {
      state: 'alpha',
      label: 'betadist',
      markets: [
        { name: 'Betamandi One', obs: 7, first: '2023-06-06', last: '2025-06-11' },
        { name: 'Betamandi Two', obs: 4, first: '2023-06-06', last: '2024-01-01' },
      ],
    },
    {
      state: 'alpha',
      label: 'oldmetro',
      markets: [{ name: 'Metromandi', obs: 9, first: '2023-06-06', last: '2025-06-11' }],
    },
    {
      state: 'alpha',
      label: 'undateddist',
      markets: [{ name: 'Undatedmandi', obs: 1, first: '2024-01-01', last: '2024-01-02' }],
    },
    {
      state: 'alpha',
      label: 'zzzzzz',
      markets: [{ name: 'Lostmandi', obs: 2, first: '2023-07-01', last: '2023-07-02' }],
    },
  ],
  unresolvedStates: [{ label: 'Alhpa' }],
  // same mandi name in two states
  twinMarkets: [
    { name: 'Commonmandi', state: 'alpha' },
    { name: 'Commonmandi', state: 'beta' },
  ],
};

const uuid = (/** @type {string} */ seed) => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const sha = (/** @type {string} */ seed) => createHash('sha256').update(seed).digest('hex');

/**
 * The rows of every table the tests need, as plain data.
 * @param {typeof WORLD} [world]
 */
export function worldRows(world = WORLD) {
  const sourceId = uuid(`source|${world.sourceCode}`);
  const states = world.states.map((s) => ({
    id: uuid(`state|${s.key}`),
    name: s.name,
    kind: s.kind,
    lgd_code: String(s.lgd),
    is_active: true,
  }));
  const stateByKey = new Map(world.states.map((s, i) => [s.key, states[i]]));
  const stateByCode = new Map(world.states.map((s, i) => [s.lgd, states[i]]));
  const districts = world.districts
    .filter((d) => d.registry)
    .map((d) => ({
      id: uuid(`district|${d.code}`),
      state_id: /** @type {any} */ (stateByCode.get(d.state)).id,
      name: d.history.at(-1)?.toUpperCase(),
      lgd_code: String(d.code),
      is_active: true,
    }));
  for (const r of world.registryOnly)
    districts.push({
      id: uuid(`district|${r.code}`),
      state_id: /** @type {any} */ (stateByKey.get(r.state)).id,
      name: r.name.toUpperCase(),
      lgd_code: String(r.code),
      is_active: true,
    });
  const stateAliases = [
    ...world.states.map((s) => ({
      id: uuid(`sa|${s.key}`),
      source_id: sourceId,
      source_key: `state|${s.key}`,
      source_label: s.key,
      resolution_status: 'resolved',
      state_id: /** @type {any} */ (stateByKey.get(s.key)).id,
    })),
    ...world.unresolvedStates.map((u) => ({
      id: uuid(`sa|${u.label}`),
      source_id: sourceId,
      source_key: `state|${u.label.toLowerCase()}`,
      source_label: u.label,
      resolution_status: 'unresolved',
      state_id: null,
    })),
  ];
  /** @type {any[]} */
  const districtAliases = [];
  /** @type {any[]} */
  const markets = [];
  /** @type {any[]} */
  const marketObservations = [];
  for (const u of world.unresolved) {
    districtAliases.push({
      id: uuid(`da|${u.state}|${u.label}`),
      source_id: sourceId,
      source_key: `district|${u.state}|${u.label}`,
      source_label: u.label,
      source_context: u.state,
      resolution_status: 'unresolved',
      district_id: null,
    });
    for (const m of u.markets) {
      const id = uuid(`market|${u.state}|${u.label}|${m.name}`);
      markets.push({
        id,
        state_id: /** @type {any} */ (stateByKey.get(u.state)).id,
        district_id: null,
        name: m.name,
        normalized_name: m.name.toLowerCase(),
        status: 'unverified',
        disambiguator: '',
        alias_source_id: sourceId,
        alias_source_key: `market|${u.state}|${u.label}|${m.name.toLowerCase()}`,
        alias_source_label: m.name,
        alias_source_context: `${u.state}|${u.label}`,
      });
      marketObservations.push({
        market_id: id,
        source_id: sourceId,
        observations: m.obs,
        first_date: m.first,
        last_date: m.last,
      });
    }
  }
  for (const t of world.twinMarkets)
    markets.push({
      id: uuid(`twin|${t.state}|${t.name}`),
      state_id: /** @type {any} */ (stateByKey.get(t.state)).id,
      district_id: null,
      name: t.name,
      normalized_name: t.name.toLowerCase(),
      status: 'unverified',
      disambiguator: '',
      alias_source_id: sourceId,
      alias_source_key: `market|${t.state}|-|${t.name.toLowerCase()}`,
      alias_source_label: t.name,
      alias_source_context: `${t.state}|-`,
    });

  // reference: a report set (latest only) and a page set (history) for each unit type
  const sets = [
    { code: 'lgd-all-states-xlsx-test', kind: 'lgd_snapshot', fingerprint_kind: 'file' },
    { code: 'lgd-all-districts-xls-test', kind: 'lgd_snapshot', fingerprint_kind: 'file' },
    { code: 'lgd-state-pages-test', kind: 'lgd_snapshot', fingerprint_kind: 'manifest' },
    { code: 'lgd-district-pages-test', kind: 'lgd_snapshot', fingerprint_kind: 'manifest' },
  ].map((s) => ({ ...s, set_sha256: sha(`set|${s.code}`) }));
  /** @type {any[]} */
  const units = [];
  const unit = (
    /** @type {any} */ set,
    /** @type {string} */ type,
    /** @type {number} */ code,
    /** @type {number} */ seq,
    /** @type {boolean} */ latest,
    /** @type {string} */ name,
    /** @type {number | null} */ parent,
    /** @type {string} */ status,
    /** @type {string | null} */ effective,
    /** @type {boolean} */ baseline,
  ) => {
    units.push({
      id: uuid(`unit|${set.code}|${type}|${code}|${seq}`),
      unit_type: type,
      lgd_code: code,
      history_seq: seq,
      is_latest_version: latest,
      name_en: name,
      parent_lgd_code: parent,
      status,
      lgd_effective_date: latest ? effective : null,
      lgd_effective_is_baseline: latest && baseline,
      valid_from_known: latest && !baseline && effective !== null,
      legal_effective_date: null,
      order_no: null,
      source_url: `https://example.invalid/${type}/${code}`,
      source_sha256: sha(`page|${type}|${code}|${seq}`),
      retrieved_at: '2026-10-20T12:00:00+00',
      set_code: set.code,
      set_kind: set.kind,
      fingerprint_kind: set.fingerprint_kind,
      set_sha256: set.set_sha256,
      state_id: null,
      district_id: null,
    });
  };
  for (const s of world.states) {
    unit(sets[0], 'state', s.lgd, 1, true, s.name, null, 'active', null, false);
    unit(sets[2], 'state', s.lgd, 1, true, s.name, null, 'active', s.effective, s.baseline);
  }
  for (const d of world.districts) {
    unit(
      sets[1],
      'district',
      d.code,
      1,
      true,
      d.history.at(-1) ?? '',
      d.state,
      'active',
      null,
      false,
    );
    d.history.forEach((name, i) => {
      const latest = i === d.history.length - 1;
      unit(
        sets[3],
        'district',
        d.code,
        i + 1,
        latest,
        name,
        d.state,
        latest ? d.status : 'inactive',
        d.effective,
        d.baseline,
      );
    });
  }
  return {
    sourceId,
    sources: [{ id: sourceId, code: world.sourceCode }],
    states,
    districts,
    stateAliases,
    districtAliases,
    markets,
    marketObservations,
    units,
    sets,
    decisions: /** @type {any[]} */ ([]),
  };
}

/**
 * The in-memory snapshot (same shape as `readSnapshot`).
 * @param {typeof WORLD} [world]
 */
export function worldSnapshot(world = WORLD) {
  const rows = worldRows(world);
  return {
    identity: { database: 'synthetic', system_identifier: '0', login: 'test' },
    sources: rows.sources,
    states: rows.states,
    districts: rows.districts,
    stateAliases: rows.stateAliases,
    districtAliases: rows.districtAliases,
    markets: rows.markets,
    marketObservations: rows.marketObservations,
    units: rows.units.map((u) => ({
      ...u,
      state_id:
        u.unit_type === 'state'
          ? (rows.states.find((s) => s.lgd_code === String(u.lgd_code))?.id ?? null)
          : null,
      district_id:
        u.unit_type === 'district'
          ? (rows.districts.find((d) => d.lgd_code === String(u.lgd_code))?.id ?? null)
          : null,
    })),
    decisions: rows.decisions,
  };
}

/**
 * The synthetic geography plus five low-risk districts that qualify for a pilot (exact current name or spaces-only
 * difference, single version, the 2005 default date, active, present in the registry).
 */
export function pilotWorld() {
  const names = ['Pilotalpha', 'Pilotbravo', 'Pilotcharlie', 'Pilotdelta', 'Pilotecho'];
  const labels = ['pilot alpha', 'pilotbravo', 'pilot charlie', 'pilotdelta', 'pilot echo'];
  return {
    ...WORLD,
    districts: [
      ...WORLD.districts,
      ...names.map((name, i) => ({
        code: 990601 + i,
        state: 990001,
        history: [name],
        status: 'active',
        effective: '2005-01-01',
        baseline: true,
        registry: true,
      })),
    ],
    unresolved: [
      ...WORLD.unresolved,
      ...labels.map((label, i) => ({
        state: 'alpha',
        label,
        markets: [
          { name: `${names[i]} Mandi`, obs: 100 + i, first: '2023-06-06', last: '2025-06-11' },
        ],
      })),
    ],
  };
}
