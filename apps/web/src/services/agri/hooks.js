import { historical } from './historical';
import { useApiQuery, usePagedQuery } from './useApiQuery';

/**
 * Screen-level data hooks over the historical market endpoints. Each one returns the standard
 * DataState (`status`, `data`, `reason`, `retry`) or, for paged lists, the pager object from
 * `usePagedQuery`. Nothing here supplies data itself.
 */

export const MARKET_PAGE_SIZE = 50;
export const OBSERVATION_PAGE_SIZE = 50;

export const STATE_OBSERVATION_PAGE_SIZE = 50;

/** Dataset coverage, date ranges and geography verification counts. */
export function useCoverage() {
  return useApiQuery('coverage', async (client, signal) => {
    const { data, meta } = await historical.coverage(client, signal);
    return { coverage: data, meta };
  });
}

/** All states and union territories (36 in the provisional reference). */
export function useStates() {
  return useApiQuery('states', async (client, signal) => {
    const page = await historical.states(client, { limit: 100 }, signal);
    return { items: page.data, hasMore: page.pagination.has_more };
  });
}

/**
 * Districts of one state. Disabled until a state is chosen, so the district filter depends on it.
 *
 * @param {string} stateId
 */
export function useDistricts(stateId) {
  return useApiQuery(
    `districts:${stateId}`,
    async (client, signal) => {
      const page = await historical.districts(client, { state_id: stateId, limit: 500 }, signal);
      return { items: page.data, hasMore: page.pagination.has_more };
    },
    { enabled: Boolean(stateId), unavailableReason: 'Choose a state first.' },
  );
}

/** The commodity catalogue with observed coverage per granularity (all commodities, one page). */
export function useCommodityCatalogue() {
  return useApiQuery('commodities', async (client, signal) => {
    const page = await historical.commodities(client, { limit: 500 }, signal);
    return { items: page.data, truncated: page.pagination.has_more, meta: page.meta };
  });
}

/**
 * The market directory, server-side paginated and filtered.
 *
 * @param {{ stateId?: string, districtId?: string, districtStatus?: string, q?: string }} filters
 */
export function useMarketDirectory({
  stateId = '',
  districtId = '',
  districtStatus = '',
  q = '',
} = {}) {
  const params = { state_id: stateId, district_id: districtId, district_status: districtStatus, q };
  return usePagedQuery(JSON.stringify(['markets', params]), (client, cursor, signal) =>
    historical.markets(client, { ...params, limit: MARKET_PAGE_SIZE, cursor }, signal),
  );
}

/**
 * One market with its mandi-price coverage.
 *
 * @param {string} marketId
 */
export function useMarketDetail(marketId) {
  return useApiQuery(
    `market:${marketId}`,
    async (client, signal) => (await historical.market(client, marketId, signal)).data,
    { enabled: Boolean(marketId), unavailableReason: 'Choose a market first.' },
  );
}

/**
 * Historical MANDI-level observations, server-side paginated. Only mandi rows: a missing mandi
 * price is never replaced by a state or national value. Disabled until the request is valid
 * (a window of at most 366 days and one of market, commodity or state).
 *
 * @param {{ marketId?: string, commodityId?: string, stateId?: string, from?: string, to?: string }} filters
 * @param {{ enabled?: boolean, unavailableReason?: string, pageSize?: number }} [options]
 */
export function useMandiObservations(
  { marketId = '', commodityId = '', stateId = '', from = '', to = '' },
  {
    enabled = true,
    unavailableReason = 'Choose filters first.',
    pageSize = OBSERVATION_PAGE_SIZE,
  } = {},
) {
  const params = { market_id: marketId, commodity_id: commodityId, state_id: stateId, from, to };
  const ready = enabled && Boolean(from && to && (marketId || commodityId || stateId));
  return usePagedQuery(
    JSON.stringify(['mandi-prices', params, pageSize]),
    (client, cursor, signal) =>
      historical.mandiPrices(client, { ...params, limit: pageSize, cursor }, signal),
    { enabled: ready, unavailableReason },
  );
}

/**
 * Historical STATE-level observations (a state as a whole, never a mandi), server-side paginated.
 * Disabled until the request is valid: a window of at most 366 days and a state or a commodity.
 *
 * @param {{ stateId?: string, commodityId?: string, from?: string, to?: string }} filters
 * @param {{ enabled?: boolean, unavailableReason?: string, pageSize?: number }} [options]
 */
export function useStateObservations(
  { stateId = '', commodityId = '', from = '', to = '' },
  {
    enabled = true,
    unavailableReason = 'Choose a state or a commodity to see historical state-level prices.',
    pageSize = STATE_OBSERVATION_PAGE_SIZE,
  } = {},
) {
  const params = { state_id: stateId, commodity_id: commodityId, from, to };
  const ready = enabled && Boolean(from && to && (stateId || commodityId));
  return usePagedQuery(
    JSON.stringify(['state-prices', params, pageSize]),
    (client, cursor, signal) =>
      historical.statePrices(client, { ...params, limit: pageSize, cursor }, signal),
    { enabled: ready, unavailableReason },
  );
}

/**
 * Sources, files, load counters and recorded assumptions. Loaded only when `enabled`.
 *
 * @param {boolean} [enabled]
 */
export function useSources(enabled = true) {
  return useApiQuery(
    'sources',
    async (client, signal) => (await historical.sources(client, signal)).data,
    { enabled, unavailableReason: 'Not requested yet.' },
  );
}

/**
 * Geographic labels the sources used that could not be mapped. Loaded only when `enabled`.
 *
 * @param {boolean} [enabled]
 */
export function useUnresolvedGeography(enabled = true) {
  return useApiQuery(
    'unresolved',
    async (client, signal) => (await historical.unresolved(client, signal)).data,
    { enabled, unavailableReason: 'Not requested yet.' },
  );
}
