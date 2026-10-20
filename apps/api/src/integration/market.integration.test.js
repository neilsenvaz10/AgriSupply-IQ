import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDatabasePool } from '../database/pool.js';
import { readOnly } from '../market/db.js';
import { testConfig } from '../test/helpers.js';
import { document, validate } from '../test/openapi.js';

/**
 * Integration tests of the historical market API against the REAL PostgreSQL database, connected
 * as the read-only application role (TEST_DATABASE_URL, read from the git-ignored database/.env).
 *
 * Two groups:
 *  1. "any content": needs only the migrated schema. Runs in CI against an empty database too.
 *  2. "historical data": needs the imported Milestone 2.2 data (2,698,327 observations) and checks
 *     real numbers. Skipped, and reported as skipped, when the tables are empty. Set
 *     REQUIRE_HISTORICAL_DATA=1 to make a missing import a failure instead.
 *
 * Every assertion here reads data; nothing is inserted, updated or deleted.
 */

const url = process.env.TEST_DATABASE_URL ?? '';
const requireDatabase = process.env.REQUIRE_DB === '1';
const requireData = process.env.REQUIRE_HISTORICAL_DATA === '1';

/** @returns {Promise<{ migrated: boolean, hasData: boolean }>} */
async function probe() {
  if (!url) return { migrated: false, hasData: false };
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const t = await client.query("SELECT to_regclass('public.mandi_observations') AS t");
    if (t.rows[0].t === null) return { migrated: false, hasData: false };
    const n = await client.query('SELECT count(*)::int AS n FROM mandi_observations');
    return { migrated: true, hasData: n.rows[0].n > 0 };
  } catch {
    return { migrated: false, hasData: false };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const state = await probe();
if (!state.migrated && !requireDatabase) {
  // eslint-disable-next-line no-console -- a skipped suite must be visible in the test output
  console.warn('Market API integration tests are SKIPPED: the migrated database is not reachable.');
} else if (state.migrated && !state.hasData) {
  // eslint-disable-next-line no-console -- a skipped suite must be visible in the test output
  console.warn(
    'Market API historical-data tests are SKIPPED: the observation tables are empty (run the Milestone 2.2 import, or set REQUIRE_HISTORICAL_DATA=1 to fail).',
  );
}

/** @type {import('../database/pool.js').DatabasePool} */
let database;
/** Direct read/privilege-probe connection (same application role). @type {pg.Pool} */
let direct;
/** @type {import('express').Express} */
let app;

/** @param {string} path */
const api = (path) => request(app).get(path);

/** Walks every page of a list endpoint. @param {string} path */
async function allPages(path) {
  /** @type {any[]} */
  const out = [];
  let cursor = null;
  for (let i = 0; i < 200; i += 1) {
    const res = await api(
      `${path}${path.includes('?') ? '&' : '?'}limit=500${cursor ? `&cursor=${cursor}` : ''}`,
    );
    expect(res.status).toBe(200);
    out.push(...res.body.data);
    cursor = res.body.pagination.next_cursor;
    if (!cursor) return out;
  }
  throw new Error('pagination did not terminate');
}

beforeAll(() => {
  if (!url) return;
  database = createDatabasePool(
    testConfig({
      databaseUrl: url,
      databasePool: {
        max: 3,
        connectionTimeoutMs: 3000,
        idleTimeoutMs: 5000,
        queryTimeoutMs: 8000,
        healthTimeoutMs: 2000,
      },
    }),
  );
  app = createApp(testConfig({ databaseUrl: url }), { pool: database.pool });
  direct = new pg.Pool({ connectionString: url, max: 2 });
  direct.on('error', () => undefined);
});
afterAll(async () => {
  await database?.close();
  await direct?.end();
});

describe.runIf(state.migrated || requireDatabase)(
  'historical market API on the real database (any content)',
  () => {
    const missing = randomUUID();

    it('every endpoint answers 200 and satisfies the OpenAPI schema, whatever the content', async () => {
      const wpi = await api('/api/v1/wpi/series?limit=1');
      const series = wpi.body.data?.[0]?.id ?? missing;
      const endpoints = [
        ['/api/v1/states', '/api/v1/states'],
        ['/api/v1/districts', '/api/v1/districts'],
        ['/api/v1/geography/unresolved', '/api/v1/geography/unresolved'],
        ['/api/v1/commodities', '/api/v1/commodities'],
        ['/api/v1/markets', '/api/v1/markets'],
        [
          `/api/v1/mandi-prices?commodity_id=${missing}&from=2024-01-01&to=2024-01-31`,
          '/api/v1/mandi-prices',
        ],
        [
          `/api/v1/state-prices?state_id=${missing}&from=2024-01-01&to=2024-01-31`,
          '/api/v1/state-prices',
        ],
        ['/api/v1/national-prices', '/api/v1/national-prices'],
        [`/api/v1/mandi-prices/latest?commodity_id=${missing}`, '/api/v1/mandi-prices/latest'],
        ['/api/v1/wpi/series', '/api/v1/wpi/series'],
        ['/api/v1/sources', '/api/v1/sources'],
        ['/api/v1/coverage', '/api/v1/coverage'],
      ];
      if (wpi.body.data?.length) {
        endpoints.push([
          `/api/v1/wpi/observations?series_id=${series}`,
          '/api/v1/wpi/observations',
        ]);
      }
      for (const [path, spec] of endpoints) {
        const res = await api(path);
        expect(res.status, path).toBe(200);
        const schema = document.paths[spec].get.responses['200'].content['application/json'].schema;
        expect(validate(schema, res.body), path).toEqual([]);
        expect(res.body.meta.is_live).toBe(false);
      }
    }, 30_000); // cold aggregates (coverage, sources) can take over a second each

    it('returns an empty page, not an error, for a window with no data', async () => {
      const res = await api(
        `/api/v1/mandi-prices?commodity_id=${missing}&from=1900-01-01&to=1900-01-31`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toEqual({ limit: 100, has_more: false, next_cursor: null });
    });

    it('returns 404 for an id that does not exist', async () => {
      for (const path of [`/api/v1/markets/${missing}`, `/api/v1/commodities/${missing}`]) {
        expect((await api(path)).status).toBe(404);
      }
      expect((await api(`/api/v1/wpi/observations?series_id=${missing}`)).status).toBe(404);
    });

    describe('read-only privilege enforcement', () => {
      it('the application role cannot write canonical tables (SQLSTATE 42501)', async () => {
        for (const sql of [
          "INSERT INTO states (name, kind) VALUES ('X', 'state')",
          'UPDATE mandi_observations SET modal_price = 1',
          'DELETE FROM state_observations',
          'TRUNCATE national_monthly_prices',
          'CREATE TABLE api_must_not_create (id int)',
        ]) {
          await expect(direct.query(sql), sql).rejects.toMatchObject({
            code: '42501',
          });
        }
      });

      it('the API transaction is itself read-only: a write fails and nothing is stored', async () => {
        const key = `api-must-not-write-${randomUUID()}`;
        // system_metadata is the one table the role may write; the READ ONLY transaction refuses it.
        await expect(
          readOnly(database.pool, (c) =>
            c.query('INSERT INTO system_metadata (key, value) VALUES ($1, $2)', [key, 'x']),
          ),
        ).rejects.toMatchObject({ status: 500 });
        const check = await direct.query(
          'SELECT count(*)::int AS n FROM system_metadata WHERE key = $1',
          [key],
        );
        expect(check.rows[0].n).toBe(0);
      });

      it('write methods on the data endpoints are refused with 405', async () => {
        for (const method of /** @type {const} */ (['post', 'put', 'patch', 'delete'])) {
          expect((await request(app)[method]('/api/v1/mandi-prices').send({})).status).toBe(405);
        }
      });
    });
  },
);

describe.runIf(state.hasData || requireData)('historical market API on the imported data', () => {
  it('reports the exact imported coverage, with date ranges and geography verification counts', async () => {
    const { data } = (await api('/api/v1/coverage')).body;
    expect(data.granularities.mandi_daily).toMatchObject({
      observations: 735461,
      first_date: '2023-06-06',
      last_date: '2025-06-11',
      markets: 1610,
      states: 25,
      commodities: 5,
    });
    expect(data.granularities.state_daily).toMatchObject({
      observations: 1953793,
      first_date: '2022-01-01',
      last_date: '2026-07-02',
      states: 32,
      commodities: 432,
    });
    expect(data.granularities.national_monthly).toMatchObject({
      observations: 2800,
      first_month: '2010-01-01',
      last_month: '2025-03-01',
    });
    expect(data.granularities.wpi_monthly_index).toMatchObject({
      observations: 6273,
      first_month: '2012-04-01',
      last_month: '2024-12-01',
      series: 41,
    });
    expect(data.geography).toMatchObject({
      markets_unverified: 1610,
      markets_with_unresolved_district: 213,
      mandi_observations_in_unresolved_district_markets: 86427,
      unresolved_district_labels: 49,
      unresolved_state_labels: 1,
    });
    const total =
      data.granularities.mandi_daily.observations +
      data.granularities.state_daily.observations +
      data.granularities.national_monthly.observations +
      data.granularities.wpi_monthly_index.observations;
    expect(total).toBe(2698327);
  });

  it('lists all 1,610 markets and every one is "unverified"', async () => {
    const markets = await allPages('/api/v1/markets');
    expect(markets).toHaveLength(1610);
    expect(new Set(markets.map((m) => m.id)).size).toBe(1610);
    expect(new Set(markets.map((m) => m.verification_status))).toEqual(new Set(['unverified']));
    const unresolved = markets.filter((m) => m.district_status === 'unresolved');
    expect(unresolved).toHaveLength(213);
    expect(unresolved.every((m) => typeof m.source_district_label === 'string')).toBe(true);
  });

  it('reports Gao as unresolved and the 49 unresolved district labels with their row counts', async () => {
    const { data } = (await api('/api/v1/geography/unresolved')).body;
    expect(data.states).toHaveLength(1);
    expect(data.states[0]).toMatchObject({
      source_label: 'Gao',
      status: 'unresolved',
      rows_quarantined: 4,
    });
    expect(data.districts).toHaveLength(49);
    expect(
      data.districts.reduce(
        (/** @type {number} */ a, /** @type {any} */ d) => a + d.observations,
        0,
      ),
    ).toBe(86427);
    // Unresolved labels are reported, never invented into districts.
    const districts = await allPages('/api/v1/districts');
    expect(districts).toHaveLength(763);
  });

  it('marks Keralam as a provisional mapping and keeps the source label', async () => {
    const states = await allPages('/api/v1/states');
    expect(states).toHaveLength(36);
    const kerala = states.find((s) => s.name === 'KERALA');
    expect(kerala.source_labels).toEqual([
      expect.objectContaining({
        source_label: 'Keralam',
        mapping_status: 'provisional',
        mapping_basis: 'reviewed_decision',
      }),
    ]);
    const orissa = states.find((s) => s.name === 'ODISHA');
    expect(orissa.source_labels[0]).toMatchObject({
      source_label: 'Orissa',
      mapping_status: 'resolved',
    });
    expect(states.some((s) => /^gao$/i.test(s.name))).toBe(false);
    expect(states.find((s) => s.name === 'GOA').source_labels).toEqual([]);

    const keralaId = kerala.id;
    const rows = (
      await api(`/api/v1/state-prices?state_id=${keralaId}&from=2025-01-01&to=2025-01-31&limit=50`)
    ).body.data;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.source_labels.state).toBe('Keralam');
      expect(r.state).toMatchObject({ name: 'KERALA', mapping_status: 'provisional' });
    }
  });

  it('exposes source provenance: files, fingerprints, importer version, load counters, assumptions', async () => {
    const { data } = (await api('/api/v1/sources')).body;
    const by = Object.fromEntries(data.map((/** @type {any} */ s) => [s.code, s]));
    expect(by.mandi_daily_prices_historical.initial_load).toMatchObject({
      importer_version: '2.2.1',
      rows_read: 737392,
      accepted: 735461,
      quarantined: 1931,
    });
    expect(by.state_daily_prices_arrivals_historical.initial_load).toMatchObject({
      rows_read: 1973777,
      accepted: 1953793,
      exact_duplicates: 19739,
      conflicts: 4,
      quarantined: 241,
    });
    expect(by.national_monthly_prices_historical.initial_load).toMatchObject({
      accepted: 2800,
      quarantined: 10,
    });
    expect(by.wpi_national_monthly_historical.initial_load).toMatchObject({ accepted: 6273 });
    expect(by.mandi_daily_prices_historical.files[0]).toMatchObject({
      file_name: 'Agriculture_price_dataset.csv',
      sha256: expect.stringMatching(/^156d7f6357e7b90c[0-9a-f]{48}$/),
    });
    expect(
      by.mandi_daily_prices_historical.assumptions.map((/** @type {any} */ a) => a.code),
    ).toEqual(expect.arrayContaining(['price_unit_inr_per_quintal']));
    expect(
      by.national_monthly_prices_historical.assumptions.map((/** @type {any} */ a) => a.code),
    ).toEqual(expect.arrayContaining(['change_column_meaning_unconfirmed']));
    for (const s of data.filter((/** @type {any} */ x) => x.observations)) {
      expect(s.observations.count).toBeGreaterThan(0);
    }
  });

  it('serves stable keyset pages of mandi prices: no overlap, no gap, strictly ordered', async () => {
    const wheat = (await api('/api/v1/commodities?q=wheat&limit=1')).body.data[0];
    const path = `/api/v1/mandi-prices?commodity_id=${wheat.id}&from=2023-08-01&to=2023-08-31`;
    const whole = (await api(`${path}&limit=500`)).body;
    expect(whole.data.length).toBeGreaterThan(20);
    const small = [];
    let cursor = null;
    for (let i = 0; i < 100; i += 1) {
      const res = await api(`${path}&limit=7${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.body.data.length).toBeLessThanOrEqual(7);
      small.push(...res.body.data);
      cursor = res.body.pagination.next_cursor;
      if (!cursor) break;
      if (small.length >= whole.data.length) break;
    }
    const n = Math.min(small.length, whole.data.length);
    expect(small.slice(0, n).map((r) => r.id)).toEqual(whole.data.slice(0, n).map((r) => r.id));
    const keys = small.map((r) => `${r.observed_date}|${r.id}`);
    expect([...keys].sort()).toEqual(keys); // ordered by (date, id)
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mandi rows are mandi-level with assumed INR/quintal units and full source labels; no arrivals', async () => {
    const wheat = (await api('/api/v1/commodities?q=wheat&limit=1')).body.data[0];
    const res = await api(
      `/api/v1/mandi-prices?commodity_id=${wheat.id}&from=2023-08-01&to=2023-08-31&limit=200`,
    );
    expect(res.body.meta).toMatchObject({ granularity: 'mandi_daily', is_live: false });
    for (const r of res.body.data) {
      expect(r.granularity).toBe('mandi_daily');
      expect(r.market.verification_status).toBe('unverified');
      expect(r).toMatchObject({
        price_currency: 'INR',
        price_unit: 'quintal',
        unit_basis: 'assumed_from_documentation',
        source_price_unit_label: null,
      });
      expect(r).not.toHaveProperty('arrival_quantity');
      expect(r.source_labels.market).toBeTruthy();
      expect(r.provenance).toMatchObject({
        source_code: 'mandi_daily_prices_historical',
        is_synthetic: false,
      });
      expect(r.provenance.source_row_number).toBeGreaterThan(0);
      expect(r.observed_date >= '2023-08-01' && r.observed_date <= '2023-08-31').toBe(true);
    }
  });

  it('never substitutes state or national values for a missing mandi price', async () => {
    const kerala = (await api('/api/v1/states?q=kerala')).body.data[0];
    // The mandi file ends on 2025-06-11; the state file runs to 2026-07-02.
    const window = 'from=2026-01-01&to=2026-01-31';
    const mandi = await api(`/api/v1/mandi-prices?state_id=${kerala.id}&${window}`);
    expect(mandi.status).toBe(200);
    expect(mandi.body.data).toEqual([]);
    const stateRows = await api(`/api/v1/state-prices?state_id=${kerala.id}&${window}&limit=5`);
    expect(stateRows.body.data.length).toBeGreaterThan(0);
    expect(stateRows.body.data[0].granularity).toBe('state_daily');
    expect(stateRows.body.data[0]).not.toHaveProperty('market');
  });

  it('state rows carry the original mixed units, count units are not converted, and arrivals stay arrivals', async () => {
    // Find a state/commodity/day with each count unit directly in the database (read-only).
    const found = await direct.query(
      `SELECT DISTINCT price_unit, arrival_unit, state_id, observed_date::text AS d
         FROM state_observations WHERE price_unit IN ('bundle', 'unit') AND observed_date >= '2025-01-01'
          AND observed_date < '2025-02-01' LIMIT 40`,
    );
    const units = new Set();
    for (const f of found.rows) {
      const res = await api(
        `/api/v1/state-prices?state_id=${f.state_id}&from=${f.d}&to=${f.d}&limit=500`,
      );
      for (const r of res.body.data) units.add(`${r.price_unit}/${r.arrival_unit}`);
      for (const r of res.body.data.filter((/** @type {any} */ x) => x.price_unit !== 'quintal')) {
        expect(r.price_unit_dimension).toBe('count');
        expect(r.unit_basis).toBe('source_stated');
        expect(r.source_price_unit_label).toMatch(/^Rs\.\//);
      }
    }
    expect(units.size).toBeGreaterThan(1);
    const sample = (
      await api(
        `/api/v1/state-prices?commodity_id=${(await api('/api/v1/commodities?q=wheat&limit=1')).body.data[0].id}&from=2025-01-01&to=2025-01-31&limit=20`,
      )
    ).body.data;
    for (const r of sample) {
      expect(r).toMatchObject({
        unit_basis: 'source_stated',
        arrival_unit: expect.any(String),
        source_arrival_unit_label: expect.any(String),
      });
      expect(r.provenance.source_code).toBe('state_daily_prices_arrivals_historical');
    }
  });

  it('latest per mandi: every mandi with the commodity appears once with its OWN latest date, identical to a direct SQL computation', async () => {
    const all = await allPages('/api/v1/commodities');
    const withMandi = all.filter((c) => c.coverage.mandi_daily.observations > 0);
    expect(withMandi).toHaveLength(5);
    for (const c of withMandi) {
      const rows = await allPages(`/api/v1/mandi-prices/latest?commodity_id=${c.id}`);
      const truth = await direct.query(
        `SELECT market_id, id, observed_date::text AS d, cnt FROM (
           SELECT market_id, id, observed_date,
                  count(*) OVER (PARTITION BY market_id, observed_date)::int AS cnt,
                  row_number() OVER (PARTITION BY market_id
                    ORDER BY observed_date DESC, variety_label ASC NULLS LAST, grade ASC NULLS LAST, id ASC) AS rn
             FROM mandi_observations WHERE commodity_id = $1) t
          WHERE rn = 1`,
        [c.id],
      );
      expect(rows.length, c.name).toBe(truth.rows.length);
      expect(new Set(rows.map((r) => r.market.id)).size, c.name).toBe(rows.length);
      const expected = new Map(truth.rows.map((r) => [r.market_id, [r.id, r.d, r.cnt]]));
      for (const r of rows) {
        expect(
          [r.id, r.latest_observation_date, r.observations_on_latest_date],
          `${c.name} ${r.market.name}`,
        ).toEqual(expected.get(r.market.id));
        expect(r.observed_date).toBe(r.latest_observation_date);
        expect(r.granularity).toBe('mandi_daily');
        expect(r.market.verification_status).toBe('unverified');
        expect(r).toMatchObject({
          price_unit: 'quintal',
          unit_basis: 'assumed_from_documentation',
        });
      }
      // Alphabetical by mandi name then id; no ranking by price or date.
      const keys = rows.map((r) => [r.market.name, r.market.id]);
      expect(keys).toEqual(
        [...keys].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1)),
      );
    }
  }, 120_000);

  it('latest per mandi: a mandi that stopped reporting keeps its own older date, and geography filters restrict the set', async () => {
    const onion = (await api('/api/v1/commodities?q=onion&limit=20')).body.data.find(
      (c) => c.name === 'Onion',
    );
    const global = onion.coverage.mandi_daily.last_date;
    const states = (await api('/api/v1/states?limit=100')).body.data;
    let older = null;
    for (const s of states) {
      const rows = await allPages(
        `/api/v1/mandi-prices/latest?commodity_id=${onion.id}&state_id=${s.id}`,
      );
      if (rows.length === 0) continue;
      expect(rows.every((r) => r.state.id === s.id)).toBe(true);
      const newest = rows
        .map((r) => r.latest_observation_date)
        .sort()
        .at(-1);
      const meta = (
        await api(`/api/v1/mandi-prices/latest?commodity_id=${onion.id}&state_id=${s.id}&limit=1`)
      ).body.meta;
      expect(meta.reference_date).toBe(newest); // the reference date is the newest date in the same scope
      if (newest < global) older = { state: s.name, newest };
    }
    // At least one state's newest Onion day is earlier than the national one (so the scope matters).
    expect(
      older,
      'expected a state whose latest day is earlier than the national latest',
    ).not.toBeNull();
  }, 120_000);

  it('serves the national monthly series and the WPI index series separately, with their own semantics', async () => {
    const national = await allPages('/api/v1/national-prices');
    expect(national).toHaveLength(2800);
    expect(new Set(national.map((r) => r.commodity.id)).size).toBe(16);
    expect(new Set(national.map((r) => r.unit_basis))).toEqual(
      new Set(['assumed_from_documentation']),
    );
    expect(new Set(national.map((r) => r.source_reported_change_status))).toEqual(
      new Set(['unconfirmed_not_for_modelling']),
    );
    const series = await allPages('/api/v1/wpi/series');
    expect(series).toHaveLength(41);
    const first = (await api(`/api/v1/wpi/observations?series_id=${series[0].id}&limit=500`)).body;
    expect(first.data.length).toBeGreaterThan(100);
    expect(first.meta.separation).toMatch(/not prices/);
    for (const r of first.data.slice(0, 20)) {
      expect(r.value_kind).toBe('index');
      for (const key of ['price_currency', 'price_unit', 'modal_price'])
        expect(r).not.toHaveProperty(key);
    }
  });

  it('lists the commodity catalog with observed coverage per granularity', async () => {
    const all = await allPages('/api/v1/commodities');
    expect(all).toHaveLength(434);
    const withMandi = all.filter((c) => c.coverage.mandi_daily.observations > 0);
    expect(withMandi).toHaveLength(5);
    expect(withMandi.reduce((a, c) => a + c.coverage.mandi_daily.observations, 0)).toBe(735461);
    expect(all.reduce((a, c) => a + c.coverage.state_daily.observations, 0)).toBe(1953793);
    expect(all.reduce((a, c) => a + c.coverage.national_monthly.observations, 0)).toBe(2800);
    const empty = all.find(
      (c) => c.coverage.state_daily.observations === 0 && c.coverage.mandi_daily.observations === 0,
    );
    if (empty)
      expect(empty.coverage.state_daily).toEqual({
        observations: 0,
        first_date: null,
        last_date: null,
      });
  });

  it('answers wide requests within a sensible time (state table, 366-day window, 500 rows)', async () => {
    const maha = (await api('/api/v1/states?q=maharashtra')).body.data[0];
    const started = performance.now();
    const res = await api(
      `/api/v1/state-prices?state_id=${maha.id}&from=2025-01-01&to=2025-12-31&limit=500`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(500);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
