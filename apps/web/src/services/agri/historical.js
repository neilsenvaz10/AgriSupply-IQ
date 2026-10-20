import { ApiError } from '../api/errors';

/**
 * Typed access to the read-only HISTORICAL market endpoints of the Express API
 * (`/api/v1`, see docs/api/historical-market-api.md).
 *
 * Guarantees:
 *  - Requests are built from validated parameters. A bad parameter throws an `ApiError` of kind
 *    `invalid_request` BEFORE anything is sent; unknown parameters are rejected.
 *  - Responses are checked: they must say they are a historical snapshot (`meta.is_live === false`).
 *    Anything else is a parse error, so a response that claims to be live is never shown.
 *  - Nothing here fabricates, defaults or substitutes data. A failure rejects.
 */

export const API_PREFIX = '/api/v1';
export const MAX_LIMIT = 500;
export const MAX_RANGE_DAYS = 366;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,600}$/;

/** @param {string} message */
const invalid = (message) => new ApiError('invalid_request', message);

/** @param {string} text */
function isRealDate(text) {
  if (!DATE.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Days between two ISO dates, inclusive.
 *
 * @param {string} from
 * @param {string} to
 */
export function spanDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
}

/** @typedef {(value: unknown, name: string) => string} Validator */

const V = {
  uuid: (v, name) => {
    if (typeof v !== 'string' || !UUID.test(v)) throw invalid(`"${name}" must be a UUID.`);
    return v.toLowerCase();
  },
  date: (v, name) => {
    if (typeof v !== 'string' || !isRealDate(v)) throw invalid(`"${name}" must be YYYY-MM-DD.`);
    return v;
  },
  limit: (v, name) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      throw invalid(`"${name}" must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
    return String(n);
  },
  cursor: (v, name) => {
    if (typeof v !== 'string' || !CURSOR.test(v)) throw invalid(`"${name}" is not a valid cursor.`);
    return v;
  },
  text: (v, name) => {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t.length < 1 || t.length > 80) throw invalid(`"${name}" must be 1-80 characters.`);
    return t;
  },
  month: (v, name) => {
    if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])(-01)?$/.test(v)) {
      throw invalid(`"${name}" must be a month (YYYY-MM).`);
    }
    return v.slice(0, 7);
  },
  /** @param {string[]} values */
  oneOf: (values) => (v, name) => {
    if (typeof v !== 'string' || !values.includes(v)) {
      throw invalid(`"${name}" must be one of: ${values.join(', ')}.`);
    }
    return v;
  },
};

/** Allowed query parameters per endpoint and how each is validated. */
const ENDPOINTS = {
  states: {
    path: '/states',
    params: {
      kind: V.oneOf(['state', 'union_territory']),
      q: V.text,
      limit: V.limit,
      cursor: V.cursor,
    },
  },
  districts: {
    path: '/districts',
    params: { state_id: V.uuid, q: V.text, limit: V.limit, cursor: V.cursor },
  },
  commodities: {
    path: '/commodities',
    params: { q: V.text, group: V.text, limit: V.limit, cursor: V.cursor },
  },
  markets: {
    path: '/markets',
    params: {
      state_id: V.uuid,
      district_id: V.uuid,
      district_status: V.oneOf(['resolved', 'unresolved']),
      q: V.text,
      limit: V.limit,
      cursor: V.cursor,
    },
  },
  marketDetail: { path: '/markets/{id}', params: {} },
  mandiPrices: {
    path: '/mandi-prices',
    params: {
      market_id: V.uuid,
      commodity_id: V.uuid,
      state_id: V.uuid,
      from: V.date,
      to: V.date,
      limit: V.limit,
      cursor: V.cursor,
    },
  },
  latestMandiPrices: {
    path: '/mandi-prices/latest',
    params: {
      commodity_id: V.uuid,
      state_id: V.uuid,
      district_id: V.uuid,
      limit: V.limit,
      cursor: V.cursor,
    },
  },
  statePrices: {
    path: '/state-prices',
    params: {
      state_id: V.uuid,
      commodity_id: V.uuid,
      from: V.date,
      to: V.date,
      limit: V.limit,
      cursor: V.cursor,
    },
  },
  coverage: { path: '/coverage', params: {} },
  sources: { path: '/sources', params: {} },
  unresolved: { path: '/geography/unresolved', params: {} },
};

/**
 * Builds `/api/v1/...?query` for an endpoint from validated parameters. Empty values are skipped.
 * Mirrors the server rules for the mandi endpoint (window, bounds, one entity filter) so a request
 * the server would reject is never sent.
 *
 * @param {keyof typeof ENDPOINTS} endpoint
 * @param {Record<string, unknown>} [params]
 * @param {{ id?: string }} [path]
 * @returns {string}
 */
export function buildPath(endpoint, params = {}, path = {}) {
  const spec = ENDPOINTS[endpoint];
  /** @type {Record<string, Validator>} */
  const rules = /** @type {any} */ (spec.params);
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(rules, key)) throw invalid(`Unknown parameter "${key}" for ${endpoint}.`);
  }
  const query = new URLSearchParams();
  for (const [name, validate] of Object.entries(rules)) {
    const raw = params[name];
    if (raw === undefined || raw === null || raw === '') continue;
    query.set(name, validate(raw, name));
  }
  if (endpoint === 'latestMandiPrices' && !query.get('commodity_id')) {
    throw invalid('A commodity is required for the latest observation of each mandi.');
  }
  if (endpoint === 'mandiPrices' || endpoint === 'statePrices') {
    const from = query.get('from');
    const to = query.get('to');
    if (!from || !to) throw invalid('Both "from" and "to" are required for price observations.');
    if (from > to) throw invalid('"from" must not be after "to".');
    if (spanDays(from, to) > MAX_RANGE_DAYS) {
      throw invalid(`The date range may span at most ${MAX_RANGE_DAYS} days.`);
    }
    const filters =
      endpoint === 'mandiPrices'
        ? ['market_id', 'commodity_id', 'state_id']
        : ['commodity_id', 'state_id'];
    if (!filters.some((name) => query.get(name))) {
      throw invalid(
        endpoint === 'mandiPrices'
          ? 'Give a market, a commodity or a state.'
          : 'Give a state or a commodity.',
      );
    }
  }
  let base = `${API_PREFIX}${spec.path}`;
  if (spec.path.includes('{id}')) {
    base = base.replace('{id}', V.uuid(path.id, 'id'));
  }
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/**
 * Checks the shared envelope and returns the body. Throws when it is not a historical snapshot.
 *
 * @param {unknown} body
 * @param {{ list: boolean }} shape
 * @returns {{ data: any, pagination: { limit: number, has_more: boolean, next_cursor: string | null } | null, meta: any }}
 */
export function parseEnvelope(body, { list }) {
  if (typeof body !== 'object' || body === null) throw new Error('response is not an object');
  const b = /** @type {Record<string, any>} */ (body);
  if (typeof b['meta'] !== 'object' || b['meta'] === null) throw new Error('meta is missing');
  if (b['meta'].is_live !== false || b['meta'].data_status !== 'historical_snapshot') {
    throw new Error(
      'the response does not declare itself a historical snapshot (is_live must be false)',
    );
  }
  if (list) {
    if (!Array.isArray(b['data'])) throw new Error('data is not a list');
    const p = b['pagination'];
    if (
      typeof p !== 'object' ||
      p === null ||
      typeof p.has_more !== 'boolean' ||
      !(p.next_cursor === null || typeof p.next_cursor === 'string')
    ) {
      throw new Error('pagination is missing');
    }
    return { data: b['data'], pagination: p, meta: b['meta'] };
  }
  if (typeof b['data'] !== 'object' || b['data'] === null) throw new Error('data is missing');
  return { data: b['data'], pagination: null, meta: b['meta'] };
}

/**
 * Row-level contract checks for the two observation endpoints. A row of the wrong granularity, or
 * one missing the fields the screens depend on (unit, unit basis, source labels, provenance), makes
 * the whole response unusable rather than being shown half-understood. In particular a state-level
 * row can never be returned as a mandi-level observation, and the reverse. Extra fields the API may
 * add later are tolerated and ignored.
 */
const ROW_CONTRACTS = {
  mandiPrices: {
    granularity: 'mandi_daily',
    required: [
      'id',
      'observed_date',
      'market',
      'state',
      'commodity',
      'modal_price',
      'price_unit',
      'unit_basis',
      'source_labels',
      'provenance',
    ],
  },
  latestMandiPrices: {
    granularity: 'mandi_daily',
    required: [
      'id',
      'observed_date',
      'latest_observation_date',
      'observations_on_latest_date',
      'market',
      'state',
      'commodity',
      'modal_price',
      'price_unit',
      'unit_basis',
      'source_labels',
      'provenance',
    ],
  },
  statePrices: {
    granularity: 'state_daily',
    required: [
      'id',
      'observed_date',
      'state',
      'commodity',
      'modal_price',
      'price_unit',
      'arrival_unit',
      'unit_basis',
      'source_labels',
      'provenance',
    ],
  },
};

/**
 * @param {'mandiPrices' | 'statePrices' | 'latestMandiPrices'} endpoint
 * @param {any[]} rows
 */
export function checkObservationRows(endpoint, rows) {
  const contract = ROW_CONTRACTS[endpoint];
  rows.forEach((row, i) => {
    if (typeof row !== 'object' || row === null) throw new Error(`row ${i} is not an object`);
    if (row.granularity !== contract.granularity) {
      throw new Error(`row ${i} is not a ${contract.granularity} observation`);
    }
    for (const key of contract.required) {
      if (!(key in row)) throw new Error(`row ${i} is missing "${key}"`);
    }
    if (endpoint === 'statePrices' && ('market' in row || 'district' in row)) {
      throw new Error(`row ${i} claims mandi-level fields on a state-level observation`);
    }
    if (endpoint === 'latestMandiPrices' && row.latest_observation_date !== row.observed_date) {
      throw new Error(`row ${i} has a latest_observation_date that differs from observed_date`);
    }
    if (
      typeof row.provenance !== 'object' ||
      row.provenance === null ||
      row.provenance.is_synthetic === true
    ) {
      throw new Error(`row ${i} has no usable provenance`);
    }
  });
}

/**
 * The latest-per-mandi endpoint must say what it is, and carry the reference date and request time
 * the freshness text relies on.
 *
 * @param {any} meta
 */
export function checkLatestMeta(meta) {
  if (meta.endpoint !== 'latest_observation_per_mandi') {
    throw new Error('meta does not identify the latest-observation endpoint');
  }
  if (!(meta.reference_date === null || /^\d{4}-\d{2}-\d{2}$/.test(String(meta.reference_date)))) {
    throw new Error('meta.reference_date is not a date');
  }
  if (typeof meta.requested_at !== 'string' || Number.isNaN(Date.parse(meta.requested_at))) {
    throw new Error('meta.requested_at is missing');
  }
}

/**
 * @param {import('../api/client').ApiClient} client
 * @param {keyof typeof ENDPOINTS} endpoint
 * @param {Record<string, unknown>} params
 * @param {{ list: boolean, signal?: AbortSignal, id?: string }} options
 * @returns {Promise<any>}
 */
async function request(client, endpoint, params, { list, signal, id }) {
  const path = buildPath(endpoint, params, { id });
  return client.get(path, {
    parse: (body) => {
      const envelope = parseEnvelope(body, { list });
      if (
        endpoint === 'mandiPrices' ||
        endpoint === 'statePrices' ||
        endpoint === 'latestMandiPrices'
      ) {
        checkObservationRows(endpoint, envelope.data);
      }
      if (endpoint === 'latestMandiPrices') checkLatestMeta(envelope.meta);
      return envelope;
    },
    signal,
  });
}

/** The endpoints used by the screens. Each resolves with `{ data, pagination, meta }`. */
export const historical = {
  /** @param {import('../api/client').ApiClient} c @param {Record<string, unknown>} [p] @param {AbortSignal} [signal] */
  states: (c, p = {}, signal) => request(c, 'states', p, { list: true, signal }),
  districts: (c, p = {}, signal) => request(c, 'districts', p, { list: true, signal }),
  commodities: (c, p = {}, signal) => request(c, 'commodities', p, { list: true, signal }),
  markets: (c, p = {}, signal) => request(c, 'markets', p, { list: true, signal }),
  /** @param {import('../api/client').ApiClient} c @param {string} id @param {AbortSignal} [signal] */
  market: (c, id, signal) => request(c, 'marketDetail', {}, { list: false, signal, id }),
  mandiPrices: (c, p = {}, signal) => request(c, 'mandiPrices', p, { list: true, signal }),
  statePrices: (c, p = {}, signal) => request(c, 'statePrices', p, { list: true, signal }),
  latestMandiPrices: (c, p = {}, signal) =>
    request(c, 'latestMandiPrices', p, { list: true, signal }),
  /** @param {import('../api/client').ApiClient} c @param {AbortSignal} [signal] */
  coverage: (c, signal) => request(c, 'coverage', {}, { list: false, signal }),
  sources: (c, signal) => request(c, 'sources', {}, { list: false, signal }),
  unresolved: (c, signal) => request(c, 'unresolved', {}, { list: false, signal }),
};

/**
 * Plain-language reason for a failed request, shown in the error state.
 *
 * @param {unknown} error
 */
export function describeError(error) {
  const kind = error instanceof ApiError ? error.kind : 'unknown';
  switch (kind) {
    case 'config':
      return 'The API address is not configured, so historical data cannot be loaded.';
    case 'timeout':
      return 'The API did not answer in time.';
    case 'network':
      return 'The API could not be reached.';
    case 'http':
      return error instanceof ApiError && error.status && error.status >= 500
        ? 'The API reported a problem while reading the historical data.'
        : 'The API rejected the request.';
    case 'invalid_request':
      return 'The selected filters are not valid for this request.';
    case 'parse':
      return 'The API answered in an unexpected format, so it was not displayed.';
    default:
      return 'Historical data could not be loaded.';
  }
}
