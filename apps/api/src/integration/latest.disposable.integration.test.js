import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDatabasePool } from '../database/pool.js';
import { checkDisposable } from '../test/disposable.js';
import { testConfig } from '../test/helpers.js';
import { document } from '../test/openapi.js';
import { createSchemaValidator } from '../test/openapiSchema.js';

/**
 * GET /api/v1/mandi-prices/latest against a DISPOSABLE PostgreSQL database seeded with SYNTHETIC rows.
 *
 * It WRITES (as the schema-owner role) and then deletes its rows, so it runs only when the database
 * proves it is disposable: FASALYTICS_DISPOSABLE_DB=1 plus a token that is also stamped inside the
 * database (see ../test/disposable.js). Without that it is reported as skipped and writes nothing;
 * the development database can never satisfy the guard. The API itself is exercised through its real
 * read-only application role, so the SQL runs exactly as in production.
 *
 * CI satisfies the guard (its database job stamps its own database) and `npm run test:disposable`
 * in database/ shows how to create one locally.
 */

const guard = await checkDisposable();
if (!guard.ok) {
  // eslint-disable-next-line no-console -- a skipped suite must be visible in the test output
  console.warn(`Latest-per-mandi disposable tests are SKIPPED: ${guard.reason}.`);
}

const sha = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
const tag = randomUUID().slice(0, 8);
const validator = createSchemaValidator();

/** @type {pg.Pool} */ let owner;
/** @type {import('../database/pool.js').DatabasePool} */ let database;
/** @type {import('express').Express} */ let app;
/** @type {Record<string, string>} */ const ids = {};
/** @type {string[]} */ const observationIds = [];
/** @type {string[]} */ const stateObservationIds = [];

/** @param {string} path */
const api = (path) => request(app).get(path);
const latest = (/** @type {string} */ query) => api(`/api/v1/mandi-prices/latest?${query}`);

/** Inserts one synthetic mandi observation as the owner and remembers its id. */
async function mandi(/** @type {Record<string, unknown>} */ row) {
  const full = {
    commodity_id: ids['C1'],
    variety_id: null,
    variety_label: null,
    grade: 'FAQ',
    modal_price: 200,
    is_historical_snapshot: true, // as the importer marks every historical row
    price_currency: 'INR',
    price_unit: 'quintal',
    source_price_unit_label: null,
    unit_basis: 'assumed_from_documentation',
    source_id: ids['source'],
    source_file_id: ids['file'],
    ingestion_run_id: ids['run'],
    source_row_number: observationIds.length + 1,
    source_state_label: 'Synthetic State',
    source_district_label: 'synthetic district',
    source_market_label: 'Synthetic market',
    source_commodity_label: 'Synthetic crop',
    ...row,
  };
  // min <= modal <= max is a database constraint: derive a valid band around the modal price.
  full['min_price'] = Number(full['modal_price']) - 10;
  full['max_price'] = Number(full['modal_price']) + 10;
  full['source_record_key'] = `rec-${tag}-${observationIds.length}`;
  full['record_fingerprint'] = sha(`fp-${tag}-${observationIds.length}`);
  const columns = Object.keys(full);
  const result = await owner.query(
    `INSERT INTO mandi_observations (${columns.map((c) => `"${c}"`).join(', ')})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    columns.map((c) => full[c]),
  );
  observationIds.push(result.rows[0].id);
  return result.rows[0].id;
}

/** @param {string} sql @param {unknown[]} [values] */
async function one(sql, values = []) {
  return (await owner.query(sql, values)).rows[0];
}

describe.runIf(guard.ok)(
  'latest observation per mandi (disposable database, synthetic data)',
  () => {
    beforeAll(async () => {
      owner = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATION_URL'], max: 2 });
      database = createDatabasePool(
        testConfig({
          databaseUrl: process.env['TEST_DATABASE_URL'] ?? null,
          databasePool: {
            max: 3,
            connectionTimeoutMs: 3000,
            idleTimeoutMs: 5000,
            queryTimeoutMs: 8000,
            healthTimeoutMs: 2000,
          },
        }),
      );
      app = createApp(testConfig({ databaseUrl: process.env['TEST_DATABASE_URL'] ?? null }), {
        pool: database.pool,
      });

      // --- registry: two states, two districts in S1, markets, two commodities (+ one with no data)
      ids['S1'] = (
        await one(`INSERT INTO states (name, kind) VALUES ($1, 'state') RETURNING id`, [
          `ZZ Synthetic State One ${tag}`,
        ])
      ).id;
      ids['S2'] = (
        await one(`INSERT INTO states (name, kind) VALUES ($1, 'state') RETURNING id`, [
          `ZZ Synthetic State Two ${tag}`,
        ])
      ).id;
      ids['D1'] = (
        await one(`INSERT INTO districts (state_id, name) VALUES ($1, $2) RETURNING id`, [
          ids['S1'],
          `District One ${tag}`,
        ])
      ).id;
      ids['D2'] = (
        await one(`INSERT INTO districts (state_id, name) VALUES ($1, $2) RETURNING id`, [
          ids['S1'],
          `District Two ${tag}`,
        ])
      ).id;
      const market = async (
        /** @type {string} */ key,
        /** @type {string} */ name,
        /** @type {string} */ state,
        /** @type {string | null} */ district,
      ) => {
        ids[key] = (
          await one(
            `INSERT INTO markets (state_id, district_id, name, disambiguator, status) VALUES ($1, $2, $3, $4, 'unverified') RETURNING id`,
            [state, district, `${name} ${tag}`, district ? '' : 'src-district:odd label'],
          )
        ).id;
      };
      await market('M1', 'ZZ Mkt A', ids['S1'], ids['D1']); // several dates, a same-day tie, another commodity later
      await market('M2', 'ZZ Mkt B', ids['S1'], ids['D2']); // one observation, source-stated unit
      await market('M3', 'ZZ Mkt C', ids['S2'], null); // other state, unresolved district, oldest date
      await market('M4', 'ZZ Mkt D', ids['S1'], ids['D1']); // only the OTHER commodity
      await market('M5', 'ZZ Mkt E', ids['S1'], ids['D1']); // no mandi observations at all
      ids['C1'] = (
        await one(`INSERT INTO commodities (name) VALUES ($1) RETURNING id`, [
          `Synthetic Crop ${tag}`,
        ])
      ).id;
      ids['C2'] = (
        await one(`INSERT INTO commodities (name) VALUES ($1) RETURNING id`, [`Other Crop ${tag}`])
      ).id;
      ids['C3'] = (
        await one(`INSERT INTO commodities (name) VALUES ($1) RETURNING id`, [
          `Unobserved Crop ${tag}`,
        ])
      ).id;
      ids['source'] = (
        await one(
          `INSERT INTO data_sources (code, name, source_type) VALUES ($1, $2, 'historical_file') RETURNING id`,
          [`zz_latest_${tag}`, `ZZ latest test ${tag}`],
        )
      ).id;
      ids['file'] = (
        await one(
          `INSERT INTO source_files (source_id, file_name, file_sha256, size_bytes) VALUES ($1, $2, $3, 1) RETURNING id`,
          [ids['source'], `zz-${tag}.csv`, sha(`file-${tag}`)],
        )
      ).id;
      ids['run'] = (
        await one(
          `INSERT INTO ingestion_runs (source_id, source_file_id, importer_name, importer_version) VALUES ($1, $2, 'test', '0.0.0') RETURNING id`,
          [ids['source'], ids['file']],
        )
      ).id;
      ids['VA'] = (
        await one(
          `INSERT INTO varieties (commodity_id, name) VALUES ($1, 'Variety A') RETURNING id`,
          [ids['C1']],
        )
      ).id;
      ids['VB'] = (
        await one(
          `INSERT INTO varieties (commodity_id, name) VALUES ($1, 'Variety B') RETURNING id`,
          [ids['C1']],
        )
      ).id;

      // --- M1: an old day, then a latest day (2024-02-20) with TWO rows (tie), and a LATER day for the other commodity
      await mandi({ market_id: ids['M1'], observed_date: '2024-01-10', modal_price: 111 });
      ids['M1-B'] = await mandi({
        market_id: ids['M1'],
        observed_date: '2024-02-20',
        modal_price: 222,
        variety_id: ids['VB'],
        variety_label: 'Variety B',
        grade: 'FAQ',
      });
      ids['M1-A'] = await mandi({
        market_id: ids['M1'],
        observed_date: '2024-02-20',
        modal_price: 999,
        variety_id: ids['VA'],
        variety_label: 'Variety A',
        grade: 'X',
      });
      await mandi({
        market_id: ids['M1'],
        commodity_id: ids['C2'],
        observed_date: '2024-04-01',
        modal_price: 777,
      });
      // --- M2: a single, later observation with a unit the source states
      ids['M2-1'] = await mandi({
        market_id: ids['M2'],
        observed_date: '2024-03-05',
        modal_price: 333,
        unit_basis: 'source_stated',
        source_price_unit_label: 'Rs./Quintal',
      });
      // --- M3: only an old one
      ids['M3-1'] = await mandi({
        market_id: ids['M3'],
        observed_date: '2024-01-01',
        modal_price: 444,
      });
      // --- M4: only the other commodity
      await mandi({
        market_id: ids['M4'],
        commodity_id: ids['C2'],
        observed_date: '2024-05-05',
        modal_price: 555,
      });
      // --- a STATE-level observation of C1 for S1 (much later): it must never stand in for M4/M5 or anything else
      const state = await one(
        `INSERT INTO state_observations (state_id, commodity_id, observed_date, modal_price, price_currency, price_unit,
         source_price_unit_label, arrival_quantity, arrival_unit, source_id, source_file_id, ingestion_run_id,
         source_record_key, record_fingerprint)
       VALUES ($1, $2, '2025-01-01', 888, 'INR', 'quintal', 'Rs./Quintal', 1, 'tonne', $3, $4, $5, $6, $7) RETURNING id`,
        [
          ids['S1'],
          ids['C1'],
          ids['source'],
          ids['file'],
          ids['run'],
          `state-${tag}`,
          sha(`state-${tag}`),
        ],
      );
      stateObservationIds.push(state.id);
    }, 60_000);

    afterAll(async () => {
      if (owner) {
        await owner
          .query('DELETE FROM state_observations WHERE id = ANY($1::uuid[])', [stateObservationIds])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM mandi_observations WHERE id = ANY($1::uuid[])', [observationIds])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM ingestion_runs WHERE id = $1', [ids['run']])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM source_files WHERE id = $1', [ids['file']])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM data_sources WHERE id = $1', [ids['source']])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM markets WHERE id = ANY($1::uuid[])', [
            [
              ids['M1'],
              ids['M2'],
              ids['M3'],
              ids['M4'],
              ids['M5'],
              ids['M6'],
              ids['M7'],
              ids['M8'],
            ],
          ])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM varieties WHERE id = ANY($1::uuid[])', [[ids['VA'], ids['VB']]])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM commodities WHERE id = ANY($1::uuid[])', [
            [ids['C1'], ids['C2'], ids['C3']],
          ])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM districts WHERE id = ANY($1::uuid[])', [[ids['D1'], ids['D2']]])
          .catch(() => undefined);
        await owner
          .query('DELETE FROM states WHERE id = ANY($1::uuid[])', [
            [ids['S1'], ids['S2'], ids['S3']],
          ])
          .catch(() => undefined);
      }
      await database?.close();
      await owner?.end();
    }, 60_000);

    const names = (/** @type {any[]} */ rows) =>
      rows.map((r) => r.market.name.replace(` ${tag}`, ''));

    it('returns one row per mandi, each with its OWN latest date, ordered by mandi name (not by date or price)', async () => {
      const res = await latest(`commodity_id=${ids['C1']}`);
      expect(res.status).toBe(200);
      expect(names(res.body.data)).toEqual(['ZZ Mkt A', 'ZZ Mkt B', 'ZZ Mkt C']);
      expect(res.body.data.map((r) => r.latest_observation_date)).toEqual([
        '2024-02-20',
        '2024-03-05',
        '2024-01-01',
      ]);
      // dates descending would be B, A, C and prices would reorder again: the order is the name order
      expect(res.body.meta.ordering).toMatch(/not a ranking/);
    });

    it("uses only the requested commodity: another commodity's later observation never moves a mandi's date", async () => {
      const res = await latest(`commodity_id=${ids['C1']}`);
      const m1 = res.body.data.find((r) => r.market.id === ids['M1']);
      expect(m1.latest_observation_date).toBe('2024-02-20'); // not 2024-04-01 (C2)
      expect(m1.commodity.name).toBe(`Synthetic Crop ${tag}`);
      const other = await latest(`commodity_id=${ids['C2']}`);
      expect(names(other.body.data)).toEqual(['ZZ Mkt A', 'ZZ Mkt D']);
      expect(other.body.data.map((r) => r.latest_observation_date)).toEqual([
        '2024-04-01',
        '2024-05-05',
      ]);
    });

    it('breaks a same-date tie deterministically and price-neutrally, and reports how many rows that date has', async () => {
      const first = await latest(`commodity_id=${ids['C1']}`);
      const m1 = first.body.data.find((r) => r.market.id === ids['M1']);
      // Variety A sorts before Variety B although its price (999) is the HIGHER one: the rule is not about price.
      expect(m1.id).toBe(ids['M1-A']);
      expect(m1.variety.label).toBe('Variety A');
      expect(m1.modal_price).toBe(999);
      expect(m1.observations_on_latest_date).toBe(2);
      for (let i = 0; i < 3; i += 1) {
        const again = await latest(`commodity_id=${ids['C1']}`);
        expect(again.body.data.map((r) => r.id)).toEqual(first.body.data.map((r) => r.id));
      }
      expect(
        first.body.data.find((r) => r.market.id === ids['M2']).observations_on_latest_date,
      ).toBe(1);
    });

    it('omits mandis without an observation of the commodity and never uses state-level data in their place', async () => {
      const res = await latest(`commodity_id=${ids['C1']}`);
      const returned = res.body.data.map((r) => r.market.id);
      expect(returned).not.toContain(ids['M4']); // only the other commodity
      expect(returned).not.toContain(ids['M5']); // no mandi observations at all
      // A state-level observation of C1 (2025-01-01, price 888) exists for S1 but appears nowhere.
      // (Checked on the values, not on the raw JSON text, where a random UUID could contain "888".)
      for (const r of res.body.data) {
        expect(r.modal_price).not.toBe(888);
        expect(r.observed_date).not.toBe('2025-01-01');
      }
      for (const r of res.body.data) expect(r.granularity).toBe('mandi_daily');
    });

    it('applies state and district filters', async () => {
      const s1 = await latest(`commodity_id=${ids['C1']}&state_id=${ids['S1']}`);
      expect(names(s1.body.data)).toEqual(['ZZ Mkt A', 'ZZ Mkt B']);
      const s2 = await latest(`commodity_id=${ids['C1']}&state_id=${ids['S2']}`);
      expect(names(s2.body.data)).toEqual(['ZZ Mkt C']);
      const d2 = await latest(`commodity_id=${ids['C1']}&district_id=${ids['D2']}`);
      expect(names(d2.body.data)).toEqual(['ZZ Mkt B']);
      const mismatch = await latest(
        `commodity_id=${ids['C1']}&state_id=${ids['S2']}&district_id=${ids['D2']}`,
      );
      expect(mismatch.body.data).toEqual([]);
      // a mandi whose district is unresolved can never match a district filter
      const d1 = await latest(`commodity_id=${ids['C1']}&district_id=${ids['D1']}`);
      expect(names(d1.body.data)).toEqual(['ZZ Mkt A']);
    });

    it('reports the newest observation date in the same scope as the reference date (not today)', async () => {
      const all = await latest(`commodity_id=${ids['C1']}`);
      expect(all.body.meta.reference_date).toBe('2024-03-05');
      expect(
        (await latest(`commodity_id=${ids['C1']}&state_id=${ids['S2']}`)).body.meta.reference_date,
      ).toBe('2024-01-01');
      expect(
        (await latest(`commodity_id=${ids['C1']}&district_id=${ids['D1']}`)).body.meta
          .reference_date,
      ).toBe('2024-02-20');
      // The observation dates and the request time are different things.
      expect(Date.parse(all.body.meta.requested_at)).toBeGreaterThan(Date.parse('2026-01-01'));
      expect(all.body.meta.reference_date).not.toBe(all.body.meta.requested_at.slice(0, 10));
    });

    it('paginates with a stable keyset cursor: every mandi exactly once, in order, nothing skipped', async () => {
      const full = (await latest(`commodity_id=${ids['C1']}`)).body.data.map((r) => r.market.id);
      const walked = [];
      let cursor = '';
      for (let i = 0; i < 10; i += 1) {
        const page = await latest(`commodity_id=${ids['C1']}&limit=1${cursor}`);
        expect(page.body.data.length).toBeLessThanOrEqual(1);
        walked.push(...page.body.data.map((r) => r.market.id));
        if (!page.body.pagination.next_cursor) {
          expect(page.body.pagination.has_more).toBe(false);
          break;
        }
        expect(page.body.pagination.has_more).toBe(true);
        cursor = `&cursor=${page.body.pagination.next_cursor}`;
      }
      expect(walked).toEqual(full);
      expect(new Set(walked).size).toBe(3);
      // limit 2 splits 3 mandis into 2 + 1
      const p1 = await latest(`commodity_id=${ids['C1']}&limit=2`);
      expect(p1.body.data).toHaveLength(2);
      const p2 = await latest(
        `commodity_id=${ids['C1']}&limit=2&cursor=${p1.body.pagination.next_cursor}`,
      );
      expect(p2.body.data).toHaveLength(1);
      expect(p2.body.pagination).toEqual({ limit: 2, has_more: false, next_cursor: null });
    });

    it('returns an empty list (not an error) for a commodity with no mandi observations', async () => {
      const res = await latest(`commodity_id=${ids['C3']}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toEqual({ limit: 100, has_more: false, next_cursor: null });
      expect(res.body.meta.reference_date).toBeNull();
      const unknown = await latest(`commodity_id=${randomUUID()}`);
      expect(unknown.status).toBe(200);
      expect(unknown.body.data).toEqual([]);
    });

    it('rejects invalid parameters with the standard error body', async () => {
      for (const query of [
        '',
        'commodity_id=nope',
        `commodity_id=${ids['C1']}&state_id=x`,
        `commodity_id=${ids['C1']}&district_id=x`,
        `commodity_id=${ids['C1']}&limit=0`,
        `commodity_id=${ids['C1']}&limit=501`,
        `commodity_id=${ids['C1']}&cursor=bad`,
        `commodity_id=${ids['C1']}&bogus=1`,
      ]) {
        const res = await latest(query);
        expect(res.status, query).toBe(400);
        expect(res.body.error.code).toBe('INVALID_PARAMETER');
      }
    });

    it('preserves the original units, unit assumptions, provenance and verification metadata', async () => {
      const rows = (await latest(`commodity_id=${ids['C1']}`)).body.data;
      const m1 = rows.find((r) => r.market.id === ids['M1']);
      expect(m1).toMatchObject({
        price_currency: 'INR',
        price_unit: 'quintal',
        unit_basis: 'assumed_from_documentation',
        source_price_unit_label: null,
      });
      const m2 = rows.find((r) => r.market.id === ids['M2']);
      expect(m2).toMatchObject({
        unit_basis: 'source_stated',
        source_price_unit_label: 'Rs./Quintal',
      });
      for (const r of rows) {
        expect(r.provenance).toMatchObject({
          source_code: `zz_latest_${tag}`,
          source_file_id: ids['file'],
          ingestion_run_id: ids['run'],
          is_historical_snapshot: true,
          is_synthetic: false,
        });
        expect(r.provenance.source_row_number).toBeGreaterThan(0);
        expect(r.market.verification_status).toBe('unverified');
      }
      const m3 = rows.find((r) => r.market.id === ids['M3']);
      expect(m3.market.district_status).toBe('unresolved');
      expect(m3.district).toBeNull();
      expect(m3.source_labels.district).toBe('synthetic district');
      expect(rows.find((r) => r.market.id === ids['M1']).market.district_status).toBe('resolved');
    });

    it('is historical-only and matches the OpenAPI response schema (Ajv)', async () => {
      const res = await latest(`commodity_id=${ids['C1']}`);
      expect(res.body.meta).toMatchObject({
        is_live: false,
        data_status: 'historical_snapshot',
        endpoint: 'latest_observation_per_mandi',
      });
      const verdict = validator.check('LatestMandiPriceList', res.body);
      expect(verdict.errors).toEqual([]);
      const empty = await latest(`commodity_id=${ids['C3']}`);
      expect(validator.check('LatestMandiPriceList', empty.body).errors).toEqual([]);
      expect(
        document.paths['/api/v1/mandi-prices/latest'].get.parameters.some(
          (p) => p.name === 'commodity_id' && p.required,
        ),
      ).toBe(true);
    });

    it('is read-only: writes through the API role fail, and write methods are refused', async () => {
      const appPool = new pg.Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1 });
      try {
        await expect(
          appPool.query("INSERT INTO states (name, kind) VALUES ('x', 'state')"),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(appPool.query('DELETE FROM mandi_observations')).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await appPool.end();
      }
      expect((await request(app).post('/api/v1/mandi-prices/latest').send({})).status).toBe(405);
    });

    it('stays bounded: a page is answered from the index without loading every mandi', async () => {
      const started = performance.now();
      const res = await latest(`commodity_id=${ids['C1']}&limit=2`);
      expect(res.status).toBe(200);
      expect(performance.now() - started).toBeLessThan(2000);
    });

    it('breaks ties level by level: date, then variety, then grade, then observation id (never price)', async () => {
      // Its own state, so no other test's counts change.
      ids['S3'] = (
        await one(`INSERT INTO states (name, kind) VALUES ($1, 'state') RETURNING id`, [
          `ZZ Synthetic State Three ${tag}`,
        ])
      ).id;
      for (const [key, name] of [
        ['M6', 'ZZ Mkt F'],
        ['M7', 'ZZ Mkt G'],
        ['M8', 'ZZ Mkt H'],
      ]) {
        ids[key] = (
          await one(
            `INSERT INTO markets (state_id, district_id, name, disambiguator, status) VALUES ($1, NULL, $2, 'src-district:odd label', 'unverified') RETURNING id`,
            [ids['S3'], `${name} ${tag}`],
          )
        ).id;
      }
      const day = '2024-04-01';
      // M6: same date and variety; grade breaks the tie. Grade A has the LOWEST price and still wins.
      await mandi({
        market_id: ids['M6'],
        observed_date: day,
        variety_label: 'Same',
        grade: 'C',
        modal_price: 900,
      });
      ids['M6-A'] = await mandi({
        market_id: ids['M6'],
        observed_date: day,
        variety_label: 'Same',
        grade: 'A',
        modal_price: 100,
      });
      await mandi({
        market_id: ids['M6'],
        observed_date: day,
        variety_label: 'Same',
        grade: 'B',
        modal_price: 500,
      });
      // M7: identical date, variety label and grade (two variety rows that share a label): only the id
      // can decide, whatever the prices are. (The natural key forbids the same variety id twice.)
      const x = await mandi({
        market_id: ids['M7'],
        observed_date: day,
        variety_id: ids['VA'],
        variety_label: 'Same',
        grade: 'FAQ',
        modal_price: 700,
      });
      const y = await mandi({
        market_id: ids['M7'],
        observed_date: day,
        variety_id: ids['VB'],
        variety_label: 'Same',
        grade: 'FAQ',
        modal_price: 300,
      });
      // M8: a missing variety label sorts AFTER a stated one (NULLS LAST), and an older date never wins.
      await mandi({
        market_id: ids['M8'],
        observed_date: day,
        variety_label: null,
        grade: 'FAQ',
        modal_price: 21,
      });
      ids['M8-V'] = await mandi({
        market_id: ids['M8'],
        observed_date: day,
        variety_id: ids['VA'],
        variety_label: 'Zed',
        grade: 'FAQ',
        modal_price: 22,
      });
      await mandi({
        market_id: ids['M8'],
        observed_date: '2024-03-31',
        variety_label: 'Aaa',
        grade: 'A',
        modal_price: 23,
      });

      const res = await latest(`commodity_id=${ids['C1']}&state_id=${ids['S3']}`);
      expect(res.status).toBe(200);
      const byMarket = (/** @type {string} */ key) =>
        res.body.data.find((r) => r.market.id === ids[key]);
      expect(byMarket('M6').id).toBe(ids['M6-A']);
      expect(byMarket('M6').observations_on_latest_date).toBe(3);
      expect(byMarket('M7').id).toBe([x, y].sort()[0]);
      expect(byMarket('M7').observations_on_latest_date).toBe(2);
      expect(byMarket('M8').id).toBe(ids['M8-V']);
      expect(byMarket('M8').latest_observation_date).toBe(day);
      for (let i = 0; i < 3; i += 1) {
        const again = await latest(`commodity_id=${ids['C1']}&state_id=${ids['S3']}`);
        expect(again.body.data.map((r) => r.id)).toEqual(res.body.data.map((r) => r.id));
      }
    });

    it('refuses a cursor reused with a different commodity, state or district, but resumes with the same filters', async () => {
      const first = await latest(`commodity_id=${ids['C1']}&limit=1`);
      const cursor = first.body.pagination.next_cursor;
      expect(cursor).toBeTruthy();
      for (const other of [
        `commodity_id=${ids['C2']}`,
        `commodity_id=${ids['C1']}&state_id=${ids['S1']}`,
        `commodity_id=${ids['C1']}&district_id=${ids['D1']}`,
      ]) {
        const res = await latest(`${other}&limit=1&cursor=${cursor}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_PARAMETER');
      }
      const same = await latest(`commodity_id=${ids['C1']}&limit=1&cursor=${cursor}`);
      expect(same.status).toBe(200);
      expect(same.body.data[0].id).not.toBe(first.body.data[0].id);
    });
  },
);
