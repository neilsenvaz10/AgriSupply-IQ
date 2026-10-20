import { vi } from 'vitest';

/**
 * SYNTHETIC test fixtures shaped like the historical market API responses
 * (docs/api/historical-market-api.md). Every name is artificial ("Testcrop", "Synthetic Mandi"),
 * the IDs are placeholders and nothing here is imported data or a real price. They exist only to
 * prove request construction, loading/empty/error states, pagination and labelling without a
 * network. Real captured responses are in docs/api/examples/real/.
 */

export const id = (/** @type {number} */ n) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const META = {
  data_status: 'historical_snapshot',
  is_live: false,
  notice: 'Historical records loaded from static files.',
  granularity: 'registry',
};

/**
 * @param {any[]} data
 * @param {{ hasMore?: boolean, next?: string | null, limit?: number, meta?: any }} [options]
 */
export function listBody(data, { hasMore = false, next = null, limit = 100, meta = META } = {}) {
  return {
    data,
    pagination: { limit, has_more: hasMore, next_cursor: hasMore ? (next ?? 'next-page') : null },
    meta,
  };
}

const NO_COVERAGE = { observations: 0, first_date: null, last_date: null };

/** @param {Partial<{ mandi: any, state: any, national: any }>} cov */
export function commodity(n, name, group, cov = {}) {
  return {
    id: id(n),
    name,
    commodity_group: group,
    coverage: {
      mandi_daily: cov.mandi ?? NO_COVERAGE,
      state_daily: cov.state ?? NO_COVERAGE,
      national_monthly: cov.national ?? NO_COVERAGE,
    },
  };
}

export const MANDI_COV = { observations: 120, first_date: '2024-01-02', last_date: '2024-03-28' };
export const STATE_COV = { observations: 900, first_date: '2022-01-01', last_date: '2026-07-02' };

/** Three commodities: one with mandi data, one state-level only, one with nothing. */
export const COMMODITIES = [
  commodity(101, 'Testcrop Alpha', 'Vegetables', { mandi: MANDI_COV, state: STATE_COV }),
  commodity(102, 'Testcrop Beta', 'Pulses', { state: STATE_COV }),
  commodity(103, 'Testcrop Gamma', 'Pulses'),
];

export const STATES = [
  {
    id: id(11),
    name: 'SYNTHETIC STATE ONE',
    kind: 'state',
    lgd_code: '90',
    source_labels: [
      {
        source_code: 'synthetic_state_source',
        source_label: 'Synthetic Spelling',
        resolution_status: 'resolved',
        mapping_basis: 'reviewed_decision',
        mapping_status: 'provisional',
        note: 'Mapped by a reviewed decision; pending authoritative confirmation.',
      },
    ],
  },
  { id: id(12), name: 'SYNTHETIC STATE TWO', kind: 'state', lgd_code: '91', source_labels: [] },
];

export function market(n, name, extra = {}) {
  return {
    id: id(n),
    name,
    state: { id: id(11), name: 'SYNTHETIC STATE ONE' },
    district: { id: id(31), name: 'SYNTHETIC DISTRICT' },
    district_status: 'resolved',
    source_district_label: null,
    verification_status: 'unverified',
    government_market_code: null,
    classification: null,
    ...extra,
  };
}

export const MARKETS = [
  market(201, 'Synthetic Mandi A'),
  market(202, 'Synthetic Mandi B', {
    district: null,
    district_status: 'unresolved',
    source_district_label: 'oddly spelled district',
  }),
];

/** @param {number} n */
export function observation(n, marketRow, extra = {}) {
  return {
    id: id(n),
    granularity: 'mandi_daily',
    observed_date: '2024-03-28',
    market: {
      id: marketRow.id,
      name: marketRow.name,
      verification_status: 'unverified',
      district_status: marketRow.district_status,
    },
    state: { id: id(11), name: 'SYNTHETIC STATE ONE', mapping_status: 'resolved' },
    district: marketRow.district,
    commodity: { id: id(101), name: 'Testcrop Alpha' },
    variety: null,
    grade: 'FAQ',
    min_price: 1900,
    max_price: 2100,
    modal_price: 2000,
    price_currency: 'INR',
    price_unit: 'quintal',
    source_price_unit_label: null,
    unit_basis: 'assumed_from_documentation',
    source_labels: {
      state: 'Synthetic State One',
      district: 'oddly spelled district',
      market: marketRow.name,
      commodity: 'Testcrop Alpha',
    },
    provenance: {
      source_code: 'synthetic_source',
      source_file_id: id(900),
      ingestion_run_id: id(901),
      source_row_number: 7,
      is_historical_snapshot: true,
      is_synthetic: false,
      quality_status: 'accepted',
      quality_flags: [],
    },
    ...extra,
  };
}

/**
 * A "latest observation per mandi" row: a mandi row plus the latest-date fields. `extra` overrides any field.
 *
 * @param {number} n
 * @param {any} marketRow
 * @param {Record<string, unknown>} [extra]
 */
export function latestObservation(n, marketRow, extra = {}) {
  const date = /** @type {string} */ (extra['observed_date'] ?? '2024-03-28');
  return {
    ...observation(n, marketRow, { observed_date: date, ...extra }),
    latest_observation_date: date,
    observations_on_latest_date: 1,
    ...extra,
  };
}

/** The meta block of /mandi-prices/latest. */
export function latestMeta(/** @type {string | null} */ referenceDate = '2024-03-28') {
  return {
    ...META,
    granularity: 'mandi_daily',
    endpoint: 'latest_observation_per_mandi',
    scope: "Each mandi's own latest available observation of the requested commodity.",
    ordering: 'mandi name, then id. This is alphabetical, not a ranking.',
    tie_break: 'Price-neutral.',
    date_semantics:
      'observed_date is the source-file date; requested_at is when this request was served.',
    requested_at: '2026-10-20T07:00:00.000Z',
    reference_date: referenceDate,
    reference_date_definition: 'The newest observation date in the same scope.',
    filters: { commodity_id: id(101), state_id: null, district_id: null },
  };
}

/** A state-level observation (a state as a whole). `extra` overrides any field. */
export function stateObservation(n, extra = {}) {
  return {
    id: id(n),
    granularity: 'state_daily',
    observed_date: '2026-07-02',
    state: { id: id(11), name: 'SYNTHETIC STATE ONE', mapping_status: 'resolved' },
    commodity: { id: id(101), name: 'Testcrop Alpha' },
    modal_price: 3100,
    price_currency: 'INR',
    price_unit: 'quintal',
    price_unit_dimension: 'mass',
    source_price_unit_label: 'Rs./Quintal',
    arrival_quantity: 12.5,
    arrival_unit: 'tonne',
    arrival_unit_dimension: 'mass',
    source_arrival_unit_label: 'Metric Tonnes',
    unit_basis: 'source_stated',
    source_labels: {
      state: 'Synthetic State One',
      commodity: 'Testcrop Alpha',
      commodity_group: null,
      report: 'synthetic report',
    },
    provenance: {
      source_code: 'synthetic_state_source',
      source_file_id: id(910),
      ingestion_run_id: id(911),
      source_row_number: 9,
      is_historical_snapshot: true,
      is_synthetic: false,
      quality_status: 'accepted',
      quality_flags: [],
    },
    ...extra,
  };
}

export const SOURCES = [
  {
    code: 'synthetic_mandi_source',
    name: 'Synthetic mandi file',
    source_type: 'historical_file',
    publisher: null,
    description: null,
    granularity: 'mandi_daily',
    files: [
      {
        id: id(900),
        file_name: 'synthetic_mandi.csv',
        sha256: 'a'.repeat(64),
        size_bytes: 10,
        registered_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    initial_load: {
      importer_version: '9.9.9',
      finished_at: '2026-01-01T00:00:00.000Z',
      rows_read: 12,
      accepted: 10,
      exact_duplicates: 0,
      conflicts: 0,
      quarantined: 2,
    },
    runs_total: 1,
    last_completed_run_at: '2026-01-01T00:00:00.000Z',
    observations: { count: 120, first_date: '2024-01-02', last_date: '2024-03-28' },
    assumptions: [
      {
        code: 'unit',
        statement: 'Prices are assumed to be INR per quintal.',
        evidence_reference: null,
      },
    ],
  },
];

export const UNRESOLVED = {
  states: [
    {
      source_code: 'synthetic_mandi_source',
      source_label: 'Synthetic Unknown State',
      status: 'unresolved',
      rows_quarantined: 4,
      note: null,
    },
  ],
  districts: [
    {
      source_state_label: 'Synthetic State One',
      source_district_label: 'oddly spelled district',
      status: 'unresolved',
      observations: 5,
      markets: 1,
    },
  ],
};

export const COVERAGE = {
  granularities: {
    mandi_daily: {
      observations: 120,
      first_date: '2024-01-02',
      last_date: '2024-03-28',
      markets: 2,
      states: 1,
      commodities: 1,
    },
    state_daily: {
      observations: 900,
      first_date: '2022-01-01',
      last_date: '2026-07-02',
      states: 2,
      commodities: 2,
    },
    national_monthly: {
      observations: 0,
      first_month: null,
      last_month: null,
      commodities: 0,
    },
    wpi_monthly_index: {
      observations: 0,
      first_month: null,
      last_month: null,
      series: 0,
    },
  },
  registry: { states: 2, districts: 2, markets: 2, commodities: 3, varieties: 0 },
  geography: {
    markets_unverified: 2,
    markets_with_unresolved_district: 1,
    mandi_observations_in_unresolved_district_markets: 5,
    unresolved_district_labels: 1,
    unresolved_state_labels: 0,
  },
  units: [],
};

/**
 * A fetch double that routes by pathname. `handlers` maps a path to a function receiving the URL
 * and returning `{ body, status? }` (or throwing for a network failure). Calls are recorded.
 *
 * @param {Record<string, (url: URL) => { body?: any, status?: number } | Promise<{ body?: any, status?: number }>>} handlers
 */
export function mockFetch(handlers) {
  const fn = vi.fn(async (input, init) => {
    // Opt-in latency (VITE_TEST_LATENCY_MS=30 npm test) makes the mocked API answer slowly, like a busy
    // CI runner, so a test that only passes when responses are instant fails here too.
    const latency = Number(import.meta.env.VITE_TEST_LATENCY_MS ?? 0);
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
    const url = new URL(String(input));
    const handler = handlers[url.pathname];
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!handler)
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 });
    // A handler may return a promise, so a test can hold a response back and release it later.
    const { body = {}, status = 200 } = await handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return fn;
}

/** Handlers for a healthy API serving the fixtures above. */
export function healthyHandlers(overrides = {}) {
  return {
    '/api/v1/coverage': () => ({
      body: { data: COVERAGE, meta: { ...META, granularity: 'coverage' } },
    }),
    '/api/v1/commodities': () => ({ body: listBody(COMMODITIES, { limit: 500 }) }),
    '/api/v1/states': () => ({ body: listBody(STATES, { limit: 100 }) }),
    '/api/v1/districts': () => ({
      body: listBody([
        {
          id: id(31),
          name: 'SYNTHETIC DISTRICT',
          lgd_code: '1',
          state: { id: id(11), name: 'SYNTHETIC STATE ONE' },
          reference_status: 'provisional-historical',
        },
      ]),
    }),
    '/api/v1/markets': () => ({ body: listBody(MARKETS, { limit: 50 }) }),
    [`/api/v1/markets/${id(201)}`]: () => ({
      body: {
        data: {
          ...MARKETS[0],
          coverage: {
            mandi_daily: {
              observations: 40,
              first_date: '2024-01-02',
              last_date: '2024-03-28',
              commodities: 1,
            },
          },
        },
        meta: META,
      },
    }),
    '/api/v1/mandi-prices/latest': () => ({
      body: {
        ...listBody(
          [
            latestObservation(701, MARKETS[0], { observed_date: '2024-03-28' }),
            latestObservation(702, MARKETS[1], { observed_date: '2024-03-18' }),
          ],
          { limit: 50 },
        ),
        meta: latestMeta('2024-03-28'),
      },
    }),
    '/api/v1/state-prices': () => ({
      body: listBody(
        [stateObservation(601), stateObservation(602, { observed_date: '2026-07-01' })],
        {
          limit: 50,
          meta: { ...META, granularity: 'state_daily' },
        },
      ),
    }),
    '/api/v1/sources': () => ({
      body: { data: SOURCES, meta: { ...META, granularity: 'provenance' } },
    }),
    '/api/v1/geography/unresolved': () => ({ body: { data: UNRESOLVED, meta: META } }),
    '/api/v1/mandi-prices': () => ({
      body: listBody(
        [
          observation(301, MARKETS[0]),
          observation(302, MARKETS[1], { observed_date: '2024-03-28' }),
        ],
        { limit: 100, meta: { ...META, granularity: 'mandi_daily' } },
      ),
    }),
    ...overrides,
  };
}
