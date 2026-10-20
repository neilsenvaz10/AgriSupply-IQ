import { Router } from 'express';
import { memoize } from '../market/cache.js';
import { readOnly } from '../market/db.js';
import { invalid, limitRule, parseQuery, requireWindow, rule } from '../market/params.js';
import {
  DATA_STATUS,
  GEOGRAPHY_REFERENCE,
  GRANULARITY,
  MARKET_VERIFICATION_NOTE,
  UNIT_NOTES,
} from '../market/policy.js';
import * as repo from '../market/repository.js';
import { methodNotAllowed } from '../middleware/methodNotAllowed.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Read-only historical market endpoints, mounted under /api/v1.
 *
 * Four observation granularities stay strictly separate, each with its own endpoint and table:
 * mandi-daily, state-daily, national-monthly and the national monthly WPI index. A missing mandi
 * price is never filled from a state or national value. Every response carries `meta` stating
 * that the data is a historical snapshot (`is_live: false`).
 *
 * Aggregates over the whole tables are memoised for CACHE_TTL_MS because the data only changes
 * when an operator runs the importer.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const AGGREGATE_TIMEOUT_MS = 20_000;

/**
 * @param {string} granularity
 * @param {Record<string, unknown>} [extra]
 */
function meta(granularity, extra = {}) {
  return {
    ...DATA_STATUS,
    granularity,
    ...(granularity in UNIT_NOTES
      ? { unit_note: UNIT_NOTES[/** @type {keyof typeof UNIT_NOTES} */ (granularity)] }
      : {}),
    ...extra,
  };
}

const geographyMeta = {
  geography_reference: GEOGRAPHY_REFERENCE,
  market_verification: MARKET_VERIFICATION_NOTE,
};

/**
 * @param {import('../database/pool.js').PoolLike | undefined} pool
 * @param {{ now?: () => number }} [options]
 */
export function createMarketRouter(pool, options = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, max-age=60');
    next();
  });

  const coverageByCommodity = memoize(
    () => readOnly(pool, (c) => repo.commodityCoverage(c), { timeoutMs: AGGREGATE_TIMEOUT_MS }),
    { ttlMs: CACHE_TTL_MS, now: options.now },
  );
  const coverage = memoize(
    () => readOnly(pool, (c) => repo.coverageSummary(c), { timeoutMs: AGGREGATE_TIMEOUT_MS }),
    { ttlMs: CACHE_TTL_MS, now: options.now },
  );
  const unresolved = memoize(
    () => readOnly(pool, (c) => repo.unresolvedGeography(c), { timeoutMs: AGGREGATE_TIMEOUT_MS }),
    { ttlMs: CACHE_TTL_MS, now: options.now },
  );
  const sources = memoize(
    () => readOnly(pool, (c) => repo.sourcesOverview(c), { timeoutMs: AGGREGATE_TIMEOUT_MS }),
    { ttlMs: CACHE_TTL_MS, now: options.now },
  );

  /** @param {string} path @param {import('express').RequestHandler} handler */
  const get = (path, handler) => {
    router
      .route(path)
      .get(handler)
      .all(methodNotAllowed(['GET']));
  };

  /** @param {unknown} id */
  const uuidParam = (id) => rule.uuid().parse(String(id), 'id');

  // ------------------------------------------------------------------------------ geography
  get('/states', async (req, res) => {
    const p = parseQuery(req.query, {
      kind: rule.oneOf(['state', 'union_territory']),
      q: rule.text(80),
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    const result = await readOnly(pool, (c) => repo.listStates(c, /** @type {any} */ (p)));
    res.json({ ...result, meta: meta('registry', { ...geographyMeta }) });
  });

  get('/districts', async (req, res) => {
    const p = parseQuery(req.query, {
      state_id: rule.uuid(),
      q: rule.text(80),
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    const result = await readOnly(pool, (c) => repo.listDistricts(c, /** @type {any} */ (p)));
    res.json({ ...result, meta: meta('registry', { ...geographyMeta }) });
  });

  get('/geography/unresolved', async (_req, res) => {
    const data = await unresolved.get();
    res.json({
      data,
      meta: meta('registry', {
        ...geographyMeta,
        note: 'Labels the sources used that could not be mapped to a reference identity. They are reported, never guessed.',
      }),
    });
  });

  // ---------------------------------------------------------------------------- commodities
  get('/commodities', async (req, res) => {
    const p = parseQuery(req.query, {
      q: rule.text(80),
      group: rule.text(80),
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    const cov = await coverageByCommodity.get();
    const result = await readOnly(pool, (c) =>
      repo.listCommodities(c, /** @type {any} */ (p), cov),
    );
    res.json({
      ...result,
      meta: meta('registry', {
        note: 'coverage lists observed rows per granularity; a commodity with 0 rows has no data at that granularity.',
      }),
    });
  });

  get('/commodities/:id', async (req, res) => {
    const id = uuidParam(req.params['id']);
    parseQuery(req.query, {});
    const cov = await coverageByCommodity.get();
    const data = await readOnly(pool, (c) => repo.getCommodity(c, id, cov));
    if (!data) throw new HttpError(404, 'NOT_FOUND', 'No such commodity.');
    res.json({ data, meta: meta('registry') });
  });

  // ---------------------------------------------------------------------------------- markets
  get('/markets', async (req, res) => {
    const p = parseQuery(req.query, {
      state_id: rule.uuid(),
      district_id: rule.uuid(),
      district_status: rule.oneOf(['resolved', 'unresolved']),
      verification_status: rule.oneOf(['unverified', 'verified']),
      q: rule.text(80),
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    const result = await readOnly(pool, (c) => repo.listMarkets(c, /** @type {any} */ (p)));
    res.json({ ...result, meta: meta('registry', { ...geographyMeta }) });
  });

  get('/markets/:id', async (req, res) => {
    const id = uuidParam(req.params['id']);
    parseQuery(req.query, {});
    const data = await readOnly(pool, (c) => repo.getMarket(c, id));
    if (!data) throw new HttpError(404, 'NOT_FOUND', 'No such market.');
    res.json({ data, meta: meta('registry', { ...geographyMeta }) });
  });

  // --------------------------------------------------------------------- observation endpoints
  get('/mandi-prices', async (req, res) => {
    const p = parseQuery(req.query, {
      market_id: rule.uuid(),
      commodity_id: rule.uuid(),
      state_id: rule.uuid(),
      from: { ...rule.date(), required: true },
      to: { ...rule.date(), required: true },
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    if (!p['market_id'] && !p['commodity_id'] && !p['state_id']) {
      throw invalid('Give at least one of "market_id", "commodity_id" or "state_id".');
    }
    requireWindow(p['from'], p['to']);
    const result = await readOnly(pool, (c) => repo.listMandiPrices(c, /** @type {any} */ (p)));
    res.json({
      ...result,
      meta: meta(GRANULARITY.MANDI, {
        ...geographyMeta,
        window: { from: p['from'], to: p['to'] },
        separation:
          'Mandi-level rows only. Missing mandi prices are never filled from state or national data, and this dataset has no arrivals.',
      }),
    });
  });

  // Registered with its own path, so it can never be mistaken for the date-window listing above.
  get('/mandi-prices/latest', async (req, res) => {
    const p = parseQuery(req.query, {
      commodity_id: { ...rule.uuid(), required: true },
      state_id: rule.uuid(),
      district_id: rule.uuid(),
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    const result = await readOnly(pool, (c) =>
      repo.listLatestMandiPrices(c, /** @type {any} */ (p)),
    );
    const { referenceDate, ...page } = result;
    res.json({
      ...page,
      meta: meta(GRANULARITY.MANDI, {
        ...geographyMeta,
        endpoint: 'latest_observation_per_mandi',
        scope:
          "Each mandi's own latest available observation of the requested commodity in the historical files. Mandis with no observation of that commodity are absent; nothing is taken from state-level or national data.",
        ordering:
          'mandi name, then id. This is alphabetical, not a ranking by price, date or anything else.',
        tie_break:
          'When a mandi has several rows on its latest date (varieties, grades) one is returned, chosen price-neutrally by variety label, then grade, then id; observations_on_latest_date gives the number of rows that date has.',
        date_semantics:
          'observed_date (= latest_observation_date) is the date in the source file. requested_at is when this request was served. They are unrelated.',
        requested_at: new Date().toISOString(),
        reference_date: referenceDate,
        reference_date_definition:
          'The newest observation date among the mandis matching the requested commodity and filters, in the historical files. It is not today and not a live feed.',
        filters: {
          commodity_id: p['commodity_id'],
          state_id: p['state_id'],
          district_id: p['district_id'],
        },
      }),
    });
  });

  get('/state-prices', async (req, res) => {
    const p = parseQuery(req.query, {
      state_id: rule.uuid(),
      commodity_id: rule.uuid(),
      from: { ...rule.date(), required: true },
      to: { ...rule.date(), required: true },
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    if (!p['state_id'] && !p['commodity_id']) {
      throw invalid('Give at least one of "state_id" or "commodity_id".');
    }
    requireWindow(p['from'], p['to']);
    const result = await readOnly(pool, (c) => repo.listStatePrices(c, /** @type {any} */ (p)));
    res.json({
      ...result,
      meta: meta(GRANULARITY.STATE, {
        geography_reference: GEOGRAPHY_REFERENCE,
        window: { from: p['from'], to: p['to'] },
        separation:
          'State-level rows only: they describe a state as a whole and must not be read as the price in any mandi.',
      }),
    });
  });

  get('/national-prices', async (req, res) => {
    const p = parseQuery(req.query, {
      commodity_id: rule.uuid(),
      from: rule.month(),
      to: rule.month(),
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    if (p['from'] && p['to'] && p['from'] > p['to'])
      throw invalid('"from" must not be after "to".');
    const result = await readOnly(pool, (c) => repo.listNationalPrices(c, /** @type {any} */ (p)));
    res.json({
      ...result,
      meta: meta(GRANULARITY.NATIONAL, {
        separation: 'National monthly averages only (India). Not a mandi or state price.',
      }),
    });
  });

  get('/wpi/series', async (req, res) => {
    const p = parseQuery(req.query, {
      q: rule.text(80),
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    const result = await readOnly(pool, (c) => repo.listWpiSeries(c, /** @type {any} */ (p)));
    res.json({ ...result, meta: meta(GRANULARITY.WPI) });
  });

  get('/wpi/observations', async (req, res) => {
    const p = parseQuery(req.query, {
      series_id: { ...rule.uuid(), required: true },
      from: rule.month(),
      to: rule.month(),
      limit: limitRule(),
      cursor: rule.cursor(),
    });
    if (p['from'] && p['to'] && p['from'] > p['to'])
      throw invalid('"from" must not be after "to".');
    const result = await readOnly(pool, (c) => repo.listWpiObservations(c, /** @type {any} */ (p)));
    if (!result) throw new HttpError(404, 'NOT_FOUND', 'No such WPI series.');
    res.json({
      ...result,
      meta: meta(GRANULARITY.WPI, {
        separation:
          'Index values (dimensionless). They are not prices and carry no currency or unit.',
      }),
    });
  });

  // ------------------------------------------------------------------ provenance and coverage
  get('/sources', async (_req, res) => {
    const data = await sources.get();
    res.json({
      data,
      meta: meta('provenance', {
        note: 'initial_load sums the first completed load of each source (an interrupted attempt and its resume count as one). Later runs only re-checked the same files.',
      }),
    });
  });

  get('/coverage', async (_req, res) => {
    const data = await coverage.get();
    res.json({
      data,
      meta: meta('coverage', {
        ...geographyMeta,
        provisional_mappings: [
          'Keralam is mapped to Kerala provisionally; confirm against an authoritative source.',
        ],
        unresolved_note:
          'Gao stays an unresolved state label; unresolved district labels are listed at /api/v1/geography/unresolved.',
        cache_ttl_seconds: CACHE_TTL_MS / 1000,
      }),
    });
  });

  return router;
}
