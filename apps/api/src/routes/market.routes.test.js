import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { decodeCursor } from '../market/params.js';
import { testConfig } from '../test/helpers.js';
import { document, validate } from '../test/openapi.js';

/**
 * Route tests with a FAKE database pool.
 *
 * Every row below is a SYNTHETIC FIXTURE shaped like the repository's SQL output; none of it is
 * imported data. They prove validation, pagination, read-only SQL, error mapping and the OpenAPI
 * contract without a database. The real-data checks are in
 * src/integration/market.integration.test.js, which runs against the development database.
 */

const ID = (/** @type {number} */ n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PROV = {
  source_code: 'synthetic_source',
  source_file_id: ID(900),
  ingestion_run_id: ID(901),
  source_row_number: 7,
  is_historical_snapshot: true,
  is_synthetic: false,
  quality_status: 'accepted',
  quality_flags: [],
};

/** @type {Record<string, (text?: string, values?: unknown[]) => any[]>} */
const FIXTURES = {
  'FROM states s': () => [
    {
      id: ID(1),
      name: 'KERALA',
      kind: 'state',
      lgd_code: '32',
      source_labels: [
        {
          source_code: 'state_daily',
          source_label: 'Keralam',
          resolution_status: 'resolved',
          note: 'reviewed decision: x',
        },
      ],
    },
  ],
  'FROM districts d': () => [
    { id: ID(2), name: 'IDUKKI', lgd_code: '1', state_id: ID(1), state_name: 'KERALA' },
  ],
  'FROM commodities c': () => [{ id: ID(3), name: 'Wheat', commodity_group: null }],
  'FROM markets m': () => [
    {
      id: ID(4),
      name: 'Synthetic Mandi',
      disambiguator: 'src-district:synthetic',
      status: 'unverified',
      government_market_code: null,
      classification: null,
      state_id: ID(1),
      state_name: 'KERALA',
      district_id: null,
      district_name: null,
    },
  ],
  'FROM mandi_observations o': () => [
    {
      id: ID(5),
      observed_date: '2024-01-02',
      market_id: ID(4),
      market_name: 'Synthetic Mandi',
      market_status: 'unverified',
      district_id: null,
      disambiguator: 'src-district:synthetic',
      state_id: ID(1),
      state_name: 'KERALA',
      district_name: null,
      commodity_id: ID(3),
      commodity_name: 'Wheat',
      variety_id: null,
      variety_label: null,
      grade: 'FAQ',
      min_price: '2000.0000',
      max_price: '2500.0000',
      modal_price: '2300.0000',
      price_currency: 'INR',
      price_unit: 'quintal',
      source_price_unit_label: null,
      unit_basis: 'assumed_from_documentation',
      source_state_label: 'Kerala',
      source_district_label: 'synthetic',
      source_market_label: 'Synthetic Mandi',
      source_commodity_label: 'Wheat',
      ...PROV,
    },
  ],
  'FROM state_observations o': () => [
    {
      id: ID(6),
      observed_date: '2024-01-02',
      state_id: ID(1),
      state_name: 'KERALA',
      commodity_id: ID(3),
      commodity_name: 'Wheat',
      modal_price: '3100.0000',
      min_price: null,
      max_price: null,
      price_currency: 'INR',
      price_unit: 'bundle',
      source_price_unit_label: 'Rs./Bundle',
      arrival_quantity: '12.000',
      arrival_unit: 'bundle',
      source_arrival_unit_label: 'Bundle',
      arrival_dimension: 'count',
      price_dimension: 'count',
      unit_basis: 'source_stated',
      source_state_label: 'Keralam',
      source_commodity_label: 'Wheat',
      source_commodity_group_label: null,
      source_report_label: 'synthetic report',
      ...PROV,
    },
  ],
  'FROM national_monthly_prices o': () => [
    {
      id: ID(7),
      period_month: '2024-01-01',
      country_code: 'IN',
      commodity_id: ID(3),
      commodity_name: 'Wheat',
      avg_min_price: '1000.0000',
      avg_max_price: '1200.0000',
      avg_modal_price: '1100.0000',
      price_currency: 'INR',
      price_unit: 'quintal',
      source_price_unit_label: null,
      unit_basis: 'assumed_from_documentation',
      source_reported_change: '1.5000',
      source_calculation_type: 'Monthly',
      source_commodity_label: 'Wheat',
      ...PROV,
    },
  ],
  'FROM wpi_series ws': () => [
    {
      id: ID(8),
      item_label: 'Synthetic item',
      commodity_id: null,
      base_description: null,
      first_month: '2012-04-01',
      last_month: '2024-12-01',
      observations: 2,
    },
  ],
  'FROM wpi_observations o': () => [
    { id: ID(9), period_month: '2012-04-01', index_value: '107.7000', ...PROV },
  ],
};

/**
 * @param {{ onQuery?: (text: string, values: unknown[]) => any, connectError?: unknown }} [options]
 */
function fakePool(options = {}) {
  /** @type {Array<{ text: string, values: unknown[] }>} */
  const statements = [];
  const client = {
    query: vi.fn(async (/** @type {string} */ text, /** @type {unknown[]} */ values = []) => {
      statements.push({ text, values });
      if (options.onQuery) {
        const custom = options.onQuery(text, values);
        if (custom !== undefined) return custom;
      }
      if (/^(BEGIN|ROLLBACK|SET LOCAL)/.test(text)) return { rows: [] };
      if (text.includes('FROM wpi_series WHERE id'))
        return { rows: [{ id: ID(8), item_label: 'Synthetic item' }] };
      if (text.includes('WHERE m.id = $1')) return { rows: FIXTURES['FROM markets m']() };
      if (text.includes('count(*)::int AS n, min(observed_date)')) {
        return { rows: [{ n: 0, first: null, last: null, commodities: 0 }] };
      }
      const key = Object.keys(FIXTURES).find((k) => text.includes(k));
      return { rows: key ? FIXTURES[key](text, values) : [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => {
      if (options.connectError) throw options.connectError;
      return client;
    }),
    end: vi.fn(),
    on: vi.fn(),
  };
  return { pool, client, statements };
}

/** @param {any} pool */
const appWith = (pool) => createApp(testConfig({ databaseUrl: 'postgresql://x:y@db/f' }), { pool });

const GOOD = {
  uuid: ID(11),
};

describe('read-only historical market API (synthetic fixtures)', () => {
  describe('input validation', () => {
    it.each([
      ['unknown parameter', '/api/v1/states?colour=red'],
      ['limit above the maximum', '/api/v1/states?limit=501'],
      ['limit zero', '/api/v1/states?limit=0'],
      ['limit not a number', '/api/v1/states?limit=ten'],
      ['repeated parameter', '/api/v1/states?kind=state&kind=union_territory'],
      ['bad enum', '/api/v1/states?kind=country'],
      ['bad cursor', '/api/v1/states?cursor=not-a-cursor'],
      ['bad uuid', '/api/v1/districts?state_id=123'],
      ['mandi without any entity filter', '/api/v1/mandi-prices?from=2024-01-01&to=2024-01-31'],
      ['mandi without a window', `/api/v1/mandi-prices?market_id=${GOOD.uuid}`],
      [
        'not a real date',
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-02-30&to=2024-03-01`,
      ],
      [
        'reversed window',
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-03-01&to=2024-02-01`,
      ],
      [
        'window over 366 days',
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2023-01-01&to=2024-12-31`,
      ],
      [
        'state prices without state or commodity',
        '/api/v1/state-prices?from=2024-01-01&to=2024-01-31',
      ],
      ['bad month', '/api/v1/national-prices?from=2024-13'],
      ['reversed months', '/api/v1/national-prices?from=2024-06&to=2024-01'],
      ['wpi observations without series', '/api/v1/wpi/observations'],
      ['bad id in path', '/api/v1/markets/xyz'],
      ['unexpected parameter on a detail route', `/api/v1/markets/${GOOD.uuid}?limit=3`],
    ])('rejects %s with 400 INVALID_PARAMETER and never queries the database', async (_n, url) => {
      const { pool, client } = fakePool();
      const res = await request(appWith(pool)).get(url);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAMETER');
      expect(validate({ $ref: '#/components/schemas/ErrorResponse' }, res.body)).toEqual([]);
      expect(client.query).not.toHaveBeenCalled();
    });

    it('does not echo submitted values in error messages', async () => {
      const { pool } = fakePool();
      const res = await request(appWith(pool)).get('/api/v1/districts?state_id=SECRET-VALUE-123');
      expect(JSON.stringify(res.body)).not.toContain('SECRET-VALUE-123');
    });

    it('accepts a window of exactly 366 days', async () => {
      const { pool } = fakePool();
      const res = await request(appWith(pool)).get(
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-12-31`,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('read-only SQL', () => {
    const urls = [
      '/api/v1/states',
      '/api/v1/districts',
      '/api/v1/geography/unresolved',
      '/api/v1/commodities',
      `/api/v1/commodities/${GOOD.uuid}`,
      '/api/v1/markets',
      `/api/v1/markets/${GOOD.uuid}`,
      `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
      `/api/v1/state-prices?state_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
      '/api/v1/national-prices',
      '/api/v1/wpi/series',
      `/api/v1/wpi/observations?series_id=${GOOD.uuid}`,
      '/api/v1/sources',
      '/api/v1/coverage',
    ];
    it.each(urls)('GET %s runs only SELECTs inside a READ ONLY transaction', async (url) => {
      const { pool, statements, client } = fakePool();
      await request(appWith(pool)).get(url);
      expect(statements.length).toBeGreaterThan(2);
      // Cached aggregates run in their own transaction, so check every transaction in the list.
      expect(statements[0]?.text).toBe('BEGIN READ ONLY');
      expect(statements.at(-1)?.text).toBe('ROLLBACK');
      const begins = statements.filter((s) => s.text.startsWith('BEGIN')).length;
      expect(statements.filter((s) => s.text === 'BEGIN READ ONLY')).toHaveLength(begins);
      expect(statements.filter((s) => s.text === 'ROLLBACK')).toHaveLength(begins);
      expect(statements.some((s) => /^\s*COMMIT/i.test(s.text))).toBe(false);
      for (const { text } of statements) {
        expect(text).toMatch(
          /^\s*(SELECT|WITH|BEGIN READ ONLY|ROLLBACK|SET LOCAL statement_timeout = \d+)/,
        );
        expect(text).not.toMatch(
          /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|COPY)\b/i,
        );
      }
      expect(client.release).toHaveBeenCalled();
    });

    it('binds user text as a parameter and never concatenates it into SQL', async () => {
      const payload = "x'; DROP TABLE states; --";
      const { pool, statements } = fakePool();
      const res = await request(appWith(pool)).get(
        `/api/v1/states?q=${encodeURIComponent(payload)}`,
      );
      expect(res.status).toBe(200);
      const query = statements.find((s) => s.text.includes('FROM states s'));
      expect(query?.text).not.toContain('DROP TABLE');
      expect(query?.values.join('|')).toContain('drop table states');
    });

    it('escapes LIKE wildcards so "%" and "_" are matched literally', async () => {
      const { pool, statements } = fakePool();
      await request(appWith(pool)).get('/api/v1/commodities?q=100%25_x');
      const query = statements.find((s) => s.text.includes('FROM commodities c'));
      expect(query?.values).toContain('%100\\%\\_x%');
    });

    it('rejects every non-GET method with 405 and does not touch the database', async () => {
      const { pool, client } = fakePool();
      const app = appWith(pool);
      for (const method of ['post', 'put', 'patch', 'delete'] /** @type {const} */) {
        const res = await request(app)[method]('/api/v1/mandi-prices').send({});
        expect(res.status).toBe(405);
        expect(res.headers['allow']).toContain('GET');
      }
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe('pagination', () => {
    it('returns has_more and a cursor when more rows exist, and resumes after it', async () => {
      const row = FIXTURES['FROM mandi_observations o']()[0];
      const rows = [row, { ...row, id: ID(50) }, { ...row, id: ID(51) }];
      const { pool, statements } = fakePool({
        onQuery: (text) => (text.includes('FROM mandi_observations o') ? { rows } : undefined),
      });
      const app = appWith(pool);
      const base = `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31&limit=2`;
      const first = await request(app).get(base);
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.pagination).toMatchObject({ limit: 2, has_more: true });
      expect(decodeCursor(first.body.pagination.next_cursor)).toEqual(['2024-01-02', ID(50)]);

      await request(app).get(`${base}&cursor=${first.body.pagination.next_cursor}`);
      const resumed = statements.filter((s) => s.text.includes('FROM mandi_observations o')).at(-1);
      expect(resumed?.text).toContain('(o.observed_date, o.id) >');
      expect(resumed?.values).toEqual(expect.arrayContaining(['2024-01-02', ID(50)]));
      // limit + 1 rows are fetched to detect a further page, and the order is total.
      expect(resumed?.values.at(-1)).toBe(3);
      expect(resumed?.text).toMatch(/ORDER BY o\.observed_date, o\.id LIMIT/);
    });

    it('returns an empty page with has_more false and no cursor', async () => {
      const { pool } = fakePool({
        onQuery: (text) => (text.includes('FROM mandi_observations o') ? { rows: [] } : undefined),
      });
      const res = await request(appWith(pool)).get(
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toEqual({ limit: 100, has_more: false, next_cursor: null });
    });
  });

  describe('database failures', () => {
    it('answers 503 DEPENDENCY_UNREACHABLE when no pool is configured', async () => {
      const res = await request(createApp(testConfig())).get('/api/v1/states');
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_UNREACHABLE');
    });

    it('answers 503 DEPENDENCY_UNREACHABLE when the connection is refused', async () => {
      const { pool } = fakePool({
        connectError: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      });
      const res = await request(appWith(pool)).get('/api/v1/states');
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_UNREACHABLE');
    });

    it('answers 503 DEPENDENCY_TIMEOUT on a statement timeout (57014)', async () => {
      const { pool } = fakePool({
        onQuery: (text) => {
          if (text.includes('FROM states s'))
            throw Object.assign(new Error('canceling statement'), { code: '57014' });
          return undefined;
        },
      });
      const res = await request(appWith(pool)).get('/api/v1/states');
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_TIMEOUT');
    });

    it('answers 500 INTERNAL_ERROR without leaking the database message', async () => {
      const { pool } = fakePool({
        onQuery: (text) => {
          if (text.includes('FROM states s')) {
            throw Object.assign(new Error('relation "secret_table" password=hunter2'), {
              code: '42P01',
            });
          }
          return undefined;
        },
      });
      const res = await request(appWith(pool)).get('/api/v1/states');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toMatch(/secret_table|hunter2/);
    });

    it('rolls back and releases the connection even when a query fails', async () => {
      const { pool, statements, client } = fakePool({
        onQuery: (text) => {
          if (text.includes('FROM states s'))
            throw Object.assign(new Error('boom'), { code: '42P01' });
          return undefined;
        },
      });
      await request(appWith(pool)).get('/api/v1/states');
      expect(statements.at(-1)?.text).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for an unknown market, commodity and WPI series', async () => {
      const { pool } = fakePool({
        onQuery: (text) =>
          text.includes('WHERE m.id = $1') ||
          text.includes('WHERE id = $1') ||
          text.includes('FROM wpi_series WHERE id')
            ? { rows: [] }
            : undefined,
      });
      const app = appWith(pool);
      for (const url of [
        `/api/v1/markets/${GOOD.uuid}`,
        `/api/v1/commodities/${GOOD.uuid}`,
        `/api/v1/wpi/observations?series_id=${GOOD.uuid}`,
      ]) {
        const res = await request(app).get(url);
        expect(res.status, url).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('data integrity and the OpenAPI contract', () => {
    /** @type {Array<[string, string, string]>} [url, openapi path, label] */
    const endpoints = [
      ['/api/v1/states', '/api/v1/states', 'states'],
      ['/api/v1/districts', '/api/v1/districts', 'districts'],
      ['/api/v1/commodities', '/api/v1/commodities', 'commodities'],
      ['/api/v1/markets', '/api/v1/markets', 'markets'],
      [`/api/v1/markets/${GOOD.uuid}`, '/api/v1/markets/{id}', 'market'],
      [
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
        '/api/v1/mandi-prices',
        'mandi prices',
      ],
      [
        `/api/v1/state-prices?state_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
        '/api/v1/state-prices',
        'state prices',
      ],
      ['/api/v1/national-prices', '/api/v1/national-prices', 'national prices'],
      ['/api/v1/wpi/series', '/api/v1/wpi/series', 'wpi series'],
      [`/api/v1/wpi/observations?series_id=${GOOD.uuid}`, '/api/v1/wpi/observations', 'wpi obs'],
    ];

    it.each(endpoints)(
      'GET %s matches its documented schema and says it is not live',
      async (url, path) => {
        const { pool } = fakePool();
        const res = await request(appWith(pool)).get(url);
        expect(res.status).toBe(200);
        const schema = document.paths[path].get.responses['200'].content['application/json'].schema;
        expect(validate(schema, res.body)).toEqual([]);
        expect(res.body.meta).toMatchObject({ data_status: 'historical_snapshot', is_live: false });
        expect(res.headers['cache-control']).toBe('private, max-age=60');
      },
    );

    it('keeps the four granularities apart: each response carries only its own fields', async () => {
      const { pool } = fakePool();
      const app = appWith(pool);
      const mandi = (
        await request(app).get(
          `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
        )
      ).body.data[0];
      const state = (
        await request(app).get(
          `/api/v1/state-prices?state_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
        )
      ).body.data[0];
      const national = (await request(app).get('/api/v1/national-prices')).body.data[0];
      const wpi = (await request(app).get(`/api/v1/wpi/observations?series_id=${GOOD.uuid}`)).body
        .data[0];
      expect(mandi.granularity).toBe('mandi_daily');
      expect(mandi).toHaveProperty('market');
      expect(mandi).not.toHaveProperty('arrival_quantity');
      expect(state.granularity).toBe('state_daily');
      expect(state).not.toHaveProperty('market');
      expect(state).not.toHaveProperty('district');
      expect(national.granularity).toBe('national_monthly');
      expect(national).not.toHaveProperty('state');
      expect(national).not.toHaveProperty('market');
      expect(wpi.granularity).toBe('wpi_monthly_index');
      for (const key of ['price_currency', 'price_unit', 'modal_price']) {
        expect(wpi).not.toHaveProperty(key);
      }
    });

    it('states unit assumptions and keeps count units unconverted', async () => {
      const { pool } = fakePool();
      const app = appWith(pool);
      const mandi = await request(app).get(
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
      );
      expect(mandi.body.data[0]).toMatchObject({
        price_currency: 'INR',
        price_unit: 'quintal',
        unit_basis: 'assumed_from_documentation',
        source_price_unit_label: null,
      });
      expect(mandi.body.meta.unit_note).toMatch(/assumed to be INR per quintal/);
      const state = await request(app).get(
        `/api/v1/state-prices?state_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
      );
      expect(state.body.data[0]).toMatchObject({
        price_unit: 'bundle',
        price_unit_dimension: 'count',
        arrival_unit: 'bundle',
        arrival_unit_dimension: 'count',
        unit_basis: 'source_stated',
      });
      expect(state.body.meta.unit_note).toMatch(/Count units are never converted/);
      const national = await request(app).get('/api/v1/national-prices');
      expect(national.body.data[0].source_reported_change_status).toBe(
        'unconfirmed_not_for_modelling',
      );
    });

    it('preserves source labels and flags the provisional Keralam mapping', async () => {
      const { pool } = fakePool();
      const app = appWith(pool);
      const state = await request(app).get(
        `/api/v1/state-prices?state_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
      );
      expect(state.body.data[0].state).toMatchObject({ mapping_status: 'provisional' });
      expect(state.body.data[0].source_labels.state).toBe('Keralam');
      const mandi = await request(app).get(
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
      );
      expect(mandi.body.data[0].state.mapping_status).toBe('resolved'); // label "Kerala"
      const states = await request(app).get('/api/v1/states');
      expect(states.body.data[0].source_labels[0]).toMatchObject({
        source_label: 'Keralam',
        mapping_status: 'provisional',
        mapping_basis: 'reviewed_decision',
      });
    });

    it('shows market verification and district status, with the source district label', async () => {
      const { pool } = fakePool();
      const res = await request(appWith(pool)).get('/api/v1/markets');
      expect(res.body.data[0]).toMatchObject({
        verification_status: 'unverified',
        district: null,
        district_status: 'unresolved',
        source_district_label: 'synthetic',
      });
      expect(res.body.meta.market_verification).toMatch(/unverified/);
    });

    it('exposes provenance on every observation', async () => {
      const { pool } = fakePool();
      const res = await request(appWith(pool)).get(
        `/api/v1/mandi-prices?market_id=${GOOD.uuid}&from=2024-01-01&to=2024-01-31`,
      );
      expect(res.body.data[0].provenance).toMatchObject({
        source_code: 'synthetic_source',
        source_row_number: 7,
        is_historical_snapshot: true,
        is_synthetic: false,
      });
      expect(res.body.data[0].provenance.ingestion_run_id).toBeTruthy();
    });
  });
});
