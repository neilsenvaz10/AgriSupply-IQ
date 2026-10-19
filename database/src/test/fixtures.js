import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' text. The default parser builds a local-time Date, which
// shifts the calendar day with the machine's timezone and would make date assertions flaky.
pg.types.setTypeParser(1082, (value) => value);

/**
 * SYNTHETIC test fixtures for the canonical schema. Every name is clearly artificial and carries
 * a random suffix; nothing here is application data or a seed record, and every test runs inside
 * a transaction that is rolled back, so no fixture row is ever committed.
 */

/**
 * Fails with an explicit message when the canonical schema has not been migrated, instead of a
 * confusing "relation does not exist" from the first test.
 *
 * @param {import('pg').Pool} pool
 */
export async function requireCanonicalSchema(pool) {
  const r = await pool.query("SELECT to_regclass('public.mandi_observations') AS t");
  if (r.rows[0].t === null) {
    throw new Error(
      'Prerequisite missing: the canonical schema is not migrated in this database. ' +
        'Run `npm run db:migrate` (or `npm run test:disposable` for a throwaway database).',
    );
  }
}

/** @param {string} text */
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export const suffix = () => randomUUID().slice(0, 8);

/**
 * Runs `work` in a transaction that is ALWAYS rolled back.
 *
 * @template T
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withRollback(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await work(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/**
 * Executes a statement that MUST fail, inside a savepoint so the surrounding transaction stays
 * usable. Resolves to the PostgreSQL error (`code`, `constraint`) or throws if it succeeded.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} text
 * @param {unknown[]} [values]
 * @returns {Promise<{ code: string, constraint?: string, message: string }>}
 */
export async function expectViolation(client, text, values = []) {
  await client.query('SAVEPOINT expect_violation');
  try {
    await client.query(text, values);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT expect_violation');
    return /** @type {any} */ (error);
  }
  await client.query('ROLLBACK TO SAVEPOINT expect_violation');
  throw new Error(`statement was ALLOWED but should have been rejected: ${text.slice(0, 80)}`);
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} text
 * @param {unknown[]} [values]
 */
export async function one(client, text, values = []) {
  const result = await client.query(text, values);
  return result.rows[0];
}

/**
 * Inserts the minimum registry, source, file and run needed by most fact-table tests.
 *
 * @param {import('pg').PoolClient} c
 */
export async function seedBasics(c) {
  const tag = suffix();
  const state = await one(c, `INSERT INTO states (name, kind) VALUES ($1, 'state') RETURNING id`, [
    `Test State ${tag}`,
  ]);
  const otherState = await one(
    c,
    `INSERT INTO states (name, kind) VALUES ($1, 'union_territory') RETURNING id`,
    [`Test Territory ${tag}`],
  );
  const district = await one(
    c,
    `INSERT INTO districts (state_id, name) VALUES ($1, $2) RETURNING id`,
    [state.id, `Test District ${tag}`],
  );
  const market = await one(
    c,
    `INSERT INTO markets (state_id, district_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [state.id, district.id, `Test Mandi ${tag}`],
  );
  const commodity = await one(c, `INSERT INTO commodities (name) VALUES ($1) RETURNING id`, [
    `Test Commodity ${tag}`,
  ]);
  const otherCommodity = await one(c, `INSERT INTO commodities (name) VALUES ($1) RETURNING id`, [
    `Other Commodity ${tag}`,
  ]);
  const variety = await one(
    c,
    `INSERT INTO varieties (commodity_id, name) VALUES ($1, $2) RETURNING id`,
    [commodity.id, `Test Variety ${tag}`],
  );
  const source = await one(
    c,
    `INSERT INTO data_sources (code, name, source_type) VALUES ($1, $2, 'historical_file') RETURNING id`,
    [`test_source_${tag}`, `Test source ${tag}`],
  );
  const otherSource = await one(
    c,
    `INSERT INTO data_sources (code, name, source_type) VALUES ($1, $2, 'government_api') RETURNING id`,
    [`test_other_${tag}`, `Other test source ${tag}`],
  );
  const file = await one(
    c,
    `INSERT INTO source_files (source_id, file_name, file_sha256, size_bytes) VALUES ($1, $2, $3, 10) RETURNING id`,
    [source.id, `test-${tag}.csv`, sha256(`file-${tag}`)],
  );
  const run = await one(
    c,
    `INSERT INTO ingestion_runs (source_id, source_file_id, importer_name, importer_version)
     VALUES ($1, $2, 'test-importer', '0.0.0') RETURNING id`,
    [source.id, file.id],
  );
  const otherRun = await one(
    c,
    `INSERT INTO ingestion_runs (source_id, importer_name, importer_version)
     VALUES ($1, 'test-importer', '0.0.0') RETURNING id`,
    [otherSource.id],
  );
  return {
    tag,
    stateId: state.id,
    otherStateId: otherState.id,
    districtId: district.id,
    marketId: market.id,
    commodityId: commodity.id,
    otherCommodityId: otherCommodity.id,
    varietyId: variety.id,
    sourceId: source.id,
    otherSourceId: otherSource.id,
    fileId: file.id,
    runId: run.id,
    otherRunId: otherRun.id,
  };
}

let counter = 0;
const nextKey = () => `rec-${Date.now()}-${(counter += 1)}`;

/**
 * Builds a mandi-level daily observation row. Pass `overrides` (column name to value) to change
 * or add columns; pass `null` to set a column to NULL.
 *
 * @param {Awaited<ReturnType<typeof seedBasics>>} b
 * @param {Record<string, unknown>} [overrides]
 */
export function mandiRow(b, overrides = {}) {
  return {
    market_id: b.marketId,
    commodity_id: b.commodityId,
    variety_id: b.varietyId,
    variety_label: 'Test Variety',
    grade: 'FAQ',
    observed_date: '2024-03-04',
    min_price: 1000,
    max_price: 1500,
    modal_price: 1250,
    price_currency: 'INR',
    price_unit: 'quintal',
    source_price_unit_label: 'Rs./Quintal',
    source_id: b.sourceId,
    source_file_id: b.fileId,
    ingestion_run_id: b.runId,
    source_record_key: nextKey(),
    record_fingerprint: sha256(nextKey()),
    ...overrides,
  };
}

export function insertMandi(c, b, overrides = {}) {
  return insertRow(c, 'mandi_observations', mandiRow(b, overrides));
}

/** State-level daily observation (modal price and arrival), as dataset B would provide. */
export function stateRow(b, overrides = {}) {
  return {
    state_id: b.stateId,
    commodity_id: b.commodityId,
    observed_date: '2024-03-04',
    modal_price: 2000,
    price_currency: 'INR',
    price_unit: 'quintal',
    source_price_unit_label: 'Rs./Quintal',
    arrival_quantity: 12.5,
    arrival_unit: 'tonne',
    source_id: b.sourceId,
    source_file_id: b.fileId,
    ingestion_run_id: b.runId,
    source_record_key: nextKey(),
    record_fingerprint: sha256(nextKey()),
    ...overrides,
  };
}

export function insertState(c, b, overrides = {}) {
  return insertRow(c, 'state_observations', stateRow(b, overrides));
}

/** National monthly commodity price averages, as dataset C would provide. */
export function nationalRow(b, overrides = {}) {
  return {
    commodity_id: b.commodityId,
    period_month: '2024-03-01',
    avg_min_price: 2100,
    avg_max_price: 2500,
    avg_modal_price: 2300,
    price_currency: 'INR',
    price_unit: 'quintal',
    unit_basis: 'assumed_from_documentation',
    source_calculation_type: 'Monthly',
    source_id: b.sourceId,
    source_file_id: b.fileId,
    ingestion_run_id: b.runId,
    source_record_key: nextKey(),
    record_fingerprint: sha256(nextKey()),
    ...overrides,
  };
}

export function insertNational(c, b, overrides = {}) {
  return insertRow(c, 'national_monthly_prices', nationalRow(b, overrides));
}

/** Creates a WPI series for the base source. */
export function insertWpiSeries(c, b, overrides = {}) {
  return insertRow(c, 'wpi_series', {
    source_id: b.sourceId,
    item_label: `Test Item ${suffix()}`,
    ...overrides,
  });
}

/** One WPI index value (dataset D shape). */
export function wpiRow(b, seriesId, overrides = {}) {
  return {
    series_id: seriesId,
    period_month: '2024-03-01',
    index_value: 131.6,
    source_id: b.sourceId,
    source_file_id: b.fileId,
    ingestion_run_id: b.runId,
    source_record_key: nextKey(),
    record_fingerprint: sha256(nextKey()),
    ...overrides,
  };
}

export function insertWpi(c, b, seriesId, overrides = {}) {
  return insertRow(c, 'wpi_observations', wpiRow(b, seriesId, overrides));
}

/**
 * @param {import('pg').PoolClient} c
 * @param {string} table
 * @param {Record<string, unknown>} row
 */
export function insertRow(c, table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  return c.query(
    `INSERT INTO ${table} (${columns.map((k) => `"${k}"`).join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING *`,
    columns.map((k) => row[k]),
  );
}

/**
 * Builds the INSERT text/values for use with `expectViolation`.
 *
 * @param {string} table
 * @param {Record<string, unknown>} row
 */
export function insertText(table, row) {
  const columns = Object.keys(row);
  return {
    text: `INSERT INTO ${table} (${columns.map((k) => `"${k}"`).join(', ')})
           VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    values: columns.map((k) => row[k]),
  };
}
