import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATASETS } from './adapters/index.js';
import { main as cli } from './cli.js';
import { runIngestion } from './framework.js';
import { decisionsForSource, loadDecisions } from './registry/decisions.js';
import { loadReferenceSet } from './registry/load.js';
import { buildReports, writeReports } from './report.js';
import { databaseAvailable } from '../test/db.js';
import { assertDisposable } from '../test/disposable.js';
import { sha256, sha256File } from './util.js';

/**
 * Ingestion framework integration tests (real PostgreSQL, the ingestion role).
 *
 * PREREQUISITES: a DISPOSABLE migrated database with the ingestion role and its grants, announced
 * by FASALYTICS_DISPOSABLE_DB=1 plus DATABASE_INGEST_URL and DATABASE_MIGRATION_URL.
 * `npm run test:disposable` provides all of it. Without them these tests are reported as SKIPPED
 * (never as passed) and they can never run against the development database. They COMMIT data.
 */
const enabled =
  databaseAvailable &&
  process.env.FASALYTICS_DISPOSABLE_DB === '1' &&
  !!process.env.DATABASE_INGEST_URL &&
  !!process.env.DATABASE_MIGRATION_URL;
if (!enabled) {
  console.warn(
    'Ingestion integration tests are SKIPPED: they need a disposable database (FASALYTICS_DISPOSABLE_DB=1, DATABASE_INGEST_URL, DATABASE_MIGRATION_URL). Run `npm run test:disposable`.',
  );
}

const ALIASES = fileURLToPath(new URL('../../reference/aliases', import.meta.url));
const REFERENCE = fileURLToPath(new URL('../../reference/lgd', import.meta.url));
const RAW = fileURLToPath(new URL('../../../data/raw', import.meta.url));

const A_HEADER = [
  'STATE',
  'District Name',
  'Market Name',
  'Commodity',
  'Variety',
  'Grade',
  'Min_Price',
  'Max_Price',
  'Modal_Price',
  'Price Date',
];
const B_HEADER = [
  'source_file',
  'source_row_number',
  'report_title',
  'report_start_date',
  'report_end_date',
  'raw_column_count',
  'row_issue',
  'extra_columns_json',
  'State',
  'Commodity Group',
  'Commodity',
  'Date',
  'Date ISO',
  'Arrival Quantity',
  'Arrival Unit',
  'Modal Price',
  'Price Unit',
];
const C_HEADER = [
  'month',
  'commodity_name',
  'avg_modal_price',
  'avg_min_price',
  'avg_max_price',
  'state_name',
  'district_name',
  'calculationType',
  'change',
];

const quote = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (header, rows) =>
  [header, ...rows].map((r) => r.map(quote).join(',')).join('\n') + '\n';

describe.runIf(enabled)('ingestion framework (disposable database, ingestion role)', () => {
  /** @type {pg.Pool} */ let ingest;
  /** @type {pg.Pool} */ let owner;
  /** @type {pg.Pool} */ let app;
  let dir = '';
  let decisions;

  beforeAll(async () => {
    await assertDisposable();
    ingest = new pg.Pool({ connectionString: process.env.DATABASE_INGEST_URL, max: 4 });
    owner = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    dir = mkdtempSync(join(tmpdir(), 'fasalytics-ingest-'));
    decisions = await loadDecisions(ALIASES);
    await loadReferenceSet({ pool: ingest, directory: REFERENCE });
  });
  afterAll(async () => {
    await Promise.all([ingest?.end(), owner?.end(), app?.end()]);
    rmSync(dir, { recursive: true, force: true });
  });

  const tag = () => randomUUID().slice(0, 6);
  /** @param {string} text @param {unknown[]} [values] @returns {Promise<any>} */
  const one = async (text, values = []) => (await owner.query(text, values)).rows[0];
  const count = async (text, values = []) => Number((await one(text, values)).n);

  /** Writes a CSV and imports it (write mode, ingestion role). */
  async function importCsv(dataset, header, rows, options = {}) {
    const file = options.file ?? join(dir, `${dataset}-${tag()}.csv`);
    if (!options.file) writeFileSync(file, toCsv(header, rows));
    const { adapter } = DATASETS[dataset];
    return runIngestion({
      adapter,
      filePath: file,
      mode: 'write',
      pool: ingest,
      decisions: decisionsForSource(decisions, adapter.source.code),
      batchSize: options.batchSize ?? 1000,
      ...options.extra,
    });
  }

  const rowA = (t, o = {}) => {
    const v = {
      STATE: 'Maharashtra',
      'District Name': 'nashik',
      'Market Name': `Mandi ${t}`,
      Commodity: `Crop ${t}`,
      Variety: 'Sharbati',
      Grade: 'FAQ',
      Min_Price: '2000',
      Max_Price: '2500',
      Modal_Price: '2300',
      'Price Date': '6/6/2023',
      ...o,
    };
    return A_HEADER.map((h) => v[h]);
  };
  const rowB = (t, o = {}) => {
    const v = {
      source_file: 'r1.csv',
      source_row_number: '3',
      report_title: 'Report 1',
      report_start_date: '',
      report_end_date: '',
      raw_column_count: '8',
      row_issue: '',
      extra_columns_json: '',
      State: 'Maharashtra',
      'Commodity Group': 'Vegetables',
      Commodity: `Veg ${t}`,
      Date: '05-01-2023',
      'Date ISO': '2023-01-05',
      'Arrival Quantity': '2.00',
      'Arrival Unit': 'Metric Tonnes',
      'Modal Price': '4000.00',
      'Price Unit': 'Rs./Quintal',
      ...o,
    };
    return B_HEADER.map((h) => v[h]);
  };

  // ------------------------------------------------------------------ registry loading
  describe('registry loading', () => {
    it('loaded 36 states/UTs and 763 districts with the reference file as provenance', async () => {
      expect(await count('SELECT count(*) AS n FROM states')).toBeGreaterThanOrEqual(36);
      const prov = await one(
        `SELECT count(*)::int AS n, bool_and(r.importer_name = 'registry-loader') AS loader, bool_and(f.file_sha256 ~ '^[0-9a-f]{64}$') AS hashed
           FROM states s JOIN ingestion_runs r ON r.id = s.provenance_run_id JOIN source_files f ON f.id = r.source_file_id
          WHERE s.lgd_code IS NOT NULL`,
      );
      expect(prov).toMatchObject({ n: 36, loader: true, hashed: true });
      const assumption = await one(
        `SELECT statement FROM source_assumptions WHERE assumption_code = 'reference_is_provisional'`,
      );
      expect(assumption.statement).toMatch(/NOT a verified current/);
    });

    it('is idempotent: loading again adds nothing and reports every row as an exact duplicate', async () => {
      const before = await count(
        'SELECT (SELECT count(*) FROM states) + (SELECT count(*) FROM districts) AS n',
      );
      const result = await loadReferenceSet({ pool: ingest, directory: REFERENCE });
      expect(result.runs.states).toMatchObject({ read: 36, loaded: 0, duplicate: 36, rejected: 0 });
      expect(result.runs.districts).toMatchObject({
        read: 763,
        loaded: 0,
        duplicate: 763,
        rejected: 0,
      });
      expect(
        await count('SELECT (SELECT count(*) FROM states) + (SELECT count(*) FROM districts) AS n'),
      ).toBe(before);
    });

    it('quarantines a changed reference name instead of overwriting the existing row', async () => {
      const copy = join(dir, 'ref-changed');
      cpSync(REFERENCE, copy, { recursive: true });
      const text = readFileSync(join(copy, '1-state.csv'), 'utf8').replace(
        'ANDHRA PRADESH,ANDHRA PRADESH',
        'ANDHRA RENAMED,ANDHRA RENAMED',
      );
      writeFileSync(join(copy, '1-state.csv'), text);
      const manifest = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'));
      manifest.referenceSet = 'lgd-changed-test';
      manifest.files[0].sha256 = sha256(text);
      writeFileSync(join(copy, 'manifest.json'), JSON.stringify(manifest));
      const result = await loadReferenceSet({ pool: ingest, directory: copy });
      expect(result.runs.states).toMatchObject({ read: 36, loaded: 0, duplicate: 35, rejected: 1 });
      const existing = await one(`SELECT name FROM states WHERE lgd_code = '28'`);
      expect(existing.name).toBe('ANDHRA PRADESH');
      const rejection = await one(
        `SELECT reason_code, reason_detail FROM ingestion_rejections WHERE ingestion_run_id = $1`,
        [result.runs.states.runId],
      );
      expect(rejection.reason_code).toBe('ambiguous_entity');
      expect(rejection.reason_detail).toMatch(/ANDHRA RENAMED/);
    });
  });

  // ------------------------------------------------------------------ dataset D
  describe('dataset D (WPI)', () => {
    const header = ['Crop', 'January-2013', 'February-2013', 'March-2013'];
    it('imports index values to the WPI tables only, preserves granularity, and is idempotent', async () => {
      const t = tag();
      const rows = [
        [`Item ${t} A`, '131.60', '132.30', ''],
        [`Item ${t} B`, '100.00', 'n/a', '101.5'],
      ];
      const file = join(dir, `D-${t}.csv`);
      writeFileSync(file, toCsv(header, rows));
      const first = await importCsv('D', header, rows, { file });
      expect(first).toMatchObject({
        read: 5,
        loaded: 4,
        duplicate: 0,
        conflicting: 0,
        rejected: 1,
        reconciled: true,
      });
      expect(first.rejectionsByReason).toEqual({ invalid_value: 1 });
      expect(
        await count(
          `SELECT count(*) AS n FROM wpi_observations o JOIN wpi_series s ON s.id = o.series_id WHERE s.item_label LIKE $1`,
          [`Item ${t}%`],
        ),
      ).toBe(4);
      expect(
        await count(
          `SELECT count(*) AS n FROM wpi_series WHERE item_label LIKE $1 AND commodity_id IS NOT NULL`,
          [`Item ${t}%`],
        ),
      ).toBe(0);
      // the same labels never appear in any price table
      expect(
        await count(`SELECT count(*) AS n FROM commodities WHERE name LIKE $1`, [`Item ${t}%`]),
      ).toBe(0);

      const again = await importCsv('D', header, rows, { file });
      expect(again).toMatchObject({
        loaded: 0,
        duplicate: 4,
        conflicting: 0,
        rejected: 1,
        reconciled: true,
      });
      expect(
        await count(
          `SELECT count(*) AS n FROM wpi_observations o JOIN wpi_series s ON s.id = o.series_id WHERE s.item_label LIKE $1`,
          [`Item ${t}%`],
        ),
      ).toBe(4);
    });

    it('keeps the existing value and records a conflict when the same month arrives with another value', async () => {
      const t = tag();
      const f1 = join(dir, `D1-${t}.csv`);
      const f2 = join(dir, `D2-${t}.csv`);
      writeFileSync(f1, toCsv(header, [[`Item ${t}`, '131.60', '132.30', '133.00']]));
      writeFileSync(f2, toCsv(header, [[`Item ${t}`, '131.60', '999.99', '133.00']]));
      await importCsv('D', header, [], { file: f1 });
      const second = await importCsv('D', header, [], { file: f2 });
      expect(second).toMatchObject({ loaded: 0, duplicate: 2, conflicting: 1, reconciled: true });
      expect(second.status).toBe('succeeded_with_rejections');
      const conflict = await one(
        `SELECT c.status, c.incoming_record->'values'->>'index_value' AS incoming, o.index_value::text AS existing, c.fact_type
           FROM observation_conflicts c JOIN wpi_observations o ON o.id = c.wpi_observation_id JOIN wpi_series s ON s.id = o.series_id
          WHERE s.item_label = $1`,
        [`Item ${t}`],
      );
      expect(conflict).toMatchObject({
        status: 'open',
        incoming: '999.99',
        existing: '132.3000',
        fact_type: 'wpi_index',
      });
    });
  });

  // ------------------------------------------------------------------ dataset C
  describe('dataset C (national monthly)', () => {
    it('records the unit assumption, marks rows as assumed, and quarantines an out-of-order average with the raw row', async () => {
      const t = tag();
      const rows = [
        [
          '2025-03-01',
          `Grain ${t}`,
          '2341.58',
          '2191.23',
          '2402.98',
          'India',
          'All',
          'Monthly',
          '-14.43',
        ],
        [
          '2025-02-01',
          `Grain ${t}`,
          '2356.01',
          '2900.00',
          '2414.46',
          'India',
          'All',
          'Monthly',
          '3.1',
        ],
        [
          '2025-01-01',
          `Grain ${t}`,
          '2382.20',
          '2221.31',
          '2448.22',
          'India',
          'All',
          'Monthly',
          '',
        ],
      ];
      const result = await importCsv('C', C_HEADER, rows);
      expect(result).toMatchObject({ read: 3, loaded: 2, rejected: 1, reconciled: true });
      const facts = await owner.query(
        `SELECT n.unit_basis, n.price_unit, n.source_price_unit_label, n.source_reported_change::text AS change, n.country_code
           FROM national_monthly_prices n JOIN commodities c ON c.id = n.commodity_id WHERE c.name = $1 ORDER BY n.period_month`,
        [`Grain ${t}`],
      );
      expect(facts.rows).toEqual([
        {
          unit_basis: 'assumed_from_documentation',
          price_unit: 'quintal',
          source_price_unit_label: null,
          change: null,
          country_code: 'IN',
        },
        {
          unit_basis: 'assumed_from_documentation',
          price_unit: 'quintal',
          source_price_unit_label: null,
          change: '-14.4300',
          country_code: 'IN',
        },
      ]);
      const rejection = await one(
        `SELECT reason_code, raw_record FROM ingestion_rejections WHERE ingestion_run_id = $1`,
        [result.runId],
      );
      expect(rejection.reason_code).toBe('price_ordering_violation');
      expect(rejection.raw_record.avg_min_price).toBe('2900.00'); // the original text, untouched
      const assumptions = await owner.query(
        `SELECT a.assumption_code FROM source_assumptions a JOIN data_sources s ON s.id = a.source_id WHERE s.code = 'national_monthly_prices_historical' ORDER BY 1`,
      );
      expect(assumptions.rows.map((r) => r.assumption_code)).toEqual([
        'change_column_meaning_unconfirmed',
        'price_unit_inr_per_quintal',
      ]);
    });
  });

  // ------------------------------------------------------------------ dataset A
  describe('dataset A (mandi daily)', () => {
    it('resolves, quarantines and traces records; never merges same-named markets; keeps unspecified varieties NULL', async () => {
      const t = tag();
      const rows = [
        rowA(t), // resolved state + district
        rowA(t, { 'District Name': 'nashik', 'Price Date': '6/7/2023' }),
        rowA(t, { STATE: 'Chattisgarh', 'District Name': 'raipur' }), // reviewed decision
        rowA(t, { 'District Name': 'a-district-after-2022', 'Market Name': `Mandi ${t}` }), // unresolved district, same market name
        rowA(t, { STATE: 'Gao' }), // unresolved state
        rowA(t, { Variety: 'Other', 'Price Date': '6/8/2023' }),
        rowA(t, { Variety: 'Local', 'Price Date': '6/8/2023' }),
        rowA(t, { Min_Price: '2600', 'Price Date': '6/9/2023' }), // ordering violation
        rowA(t, { 'Price Date': '2/30/2023' }), // impossible date
      ];
      const result = await importCsv('A', A_HEADER, rows);
      expect(result).toMatchObject({
        read: 9,
        loaded: 6,
        duplicate: 0,
        conflicting: 0,
        rejected: 3,
        reconciled: true,
      });
      expect(result.rejectionsByReason).toEqual({
        unmapped_entity: 1,
        price_ordering_violation: 1,
        invalid_date: 1,
      });

      // Same market name, three different identities (resolved district / reviewed state / unresolved district): never merged.
      const markets = await owner.query(
        `SELECT m.disambiguator, m.district_id IS NULL AS no_district, m.status FROM markets m WHERE m.name = $1 ORDER BY 1`,
        [`Mandi ${t}`],
      );
      expect(markets.rows).toHaveLength(3);
      expect(markets.rows.every((m) => m.status === 'unverified')).toBe(true);
      // Raipur is in the reference (resolved); only the post-2022 district keeps its source label as identity.
      expect(markets.rows.filter((m) => m.no_district).map((m) => m.disambiguator)).toEqual([
        'src-district:a-district-after-2022',
      ]);

      // Variety: Other -> NULL (label kept), Local -> a real variety.
      const varieties = await owner.query(
        `SELECT o.variety_label, o.variety_id IS NULL AS unspecified FROM mandi_observations o JOIN commodities c ON c.id = o.commodity_id
          WHERE c.name = $1 AND o.observed_date = '2023-06-08' ORDER BY 1`,
        [`Crop ${t}`],
      );
      expect(varieties.rows).toEqual([
        { variety_label: 'Local', unspecified: false },
        { variety_label: 'Other', unspecified: true },
      ]);

      // Traceability: source, file, fingerprint, run, original row, labels, unit basis.
      const trace = await one(
        `SELECT s.code, f.file_sha256, r.importer_name, o.source_row_number::int AS row, o.source_state_label, o.source_district_label,
                o.source_market_label, o.unit_basis, o.price_unit, o.is_historical_snapshot
           FROM mandi_observations o JOIN data_sources s ON s.id = o.source_id JOIN source_files f ON f.id = o.source_file_id JOIN ingestion_runs r ON r.id = o.ingestion_run_id
           JOIN commodities c ON c.id = o.commodity_id WHERE c.name = $1 AND o.source_state_label = 'Chattisgarh'`,
        [`Crop ${t}`],
      );
      expect(trace).toMatchObject({
        code: 'mandi_daily_prices_historical',
        importer_name: 'fasalytics-historical-importer',
        row: 3,
        source_state_label: 'Chattisgarh',
        source_district_label: 'raipur',
        unit_basis: 'assumed_from_documentation',
        price_unit: 'quintal',
        is_historical_snapshot: true,
      });
      expect(trace.file_sha256).toMatch(/^[0-9a-f]{64}$/);

      // Alias rows: reviewed spelling resolved, Gao unresolved; no Gao market exists.
      const gao = await one(
        `SELECT resolution_status, state_id FROM state_aliases WHERE source_label = 'Gao'`,
      );
      expect(gao).toMatchObject({ resolution_status: 'unresolved', state_id: null });
      const rejection = await one(
        `SELECT reason_code, reason_detail, raw_record->>'STATE' AS state FROM ingestion_rejections WHERE ingestion_run_id = $1 AND reason_code = 'unmapped_entity'`,
        [result.runId],
      );
      expect(rejection).toMatchObject({ reason_detail: 'state=Gao', state: 'Gao' });
    });

    it('is idempotent and records a conflict (never an overwrite) when a re-import changes a price', async () => {
      const t = tag();
      const rows = [rowA(t), rowA(t, { 'Price Date': '6/7/2023' })];
      const file = join(dir, `A-${t}.csv`);
      writeFileSync(file, toCsv(A_HEADER, rows));
      expect(await importCsv('A', A_HEADER, [], { file })).toMatchObject({ loaded: 2 });
      const again = await importCsv('A', A_HEADER, [], { file });
      expect(again).toMatchObject({ loaded: 0, duplicate: 2, conflicting: 0, reconciled: true });
      const changed = join(dir, `A2-${t}.csv`);
      writeFileSync(
        changed,
        toCsv(A_HEADER, [rowA(t, { Modal_Price: '2310' }), rowA(t, { 'Price Date': '6/7/2023' })]),
      );
      const third = await importCsv('A', A_HEADER, [], { file: changed });
      expect(third).toMatchObject({ loaded: 0, duplicate: 1, conflicting: 1, reconciled: true });
      const existing = await one(
        `SELECT o.modal_price::text AS m FROM mandi_observations o JOIN commodities c ON c.id = o.commodity_id WHERE c.name = $1 AND o.observed_date = '2023-06-06'`,
        [`Crop ${t}`],
      );
      expect(existing.m).toBe('2300.0000');
      expect(
        await count(
          `SELECT count(*) AS n FROM mandi_observations o JOIN commodities c ON c.id = o.commodity_id WHERE c.name = $1`,
          [`Crop ${t}`],
        ),
      ).toBe(2);
    });

    it('treats a within-file duplicate like a cross-run one: identical is skipped, different is a conflict', async () => {
      const t = tag();
      const rows = [rowA(t), rowA(t), rowA(t, { Modal_Price: '2400' })];
      const result = await importCsv('A', A_HEADER, rows);
      expect(result).toMatchObject({
        read: 3,
        loaded: 1,
        duplicate: 1,
        conflicting: 1,
        reconciled: true,
      });
    });
  });

  // ------------------------------------------------------------------ dataset B
  describe('dataset B (state daily)', () => {
    it('keeps mass and count units apart, quarantines footers, and separates exact duplicates from conflicts', async () => {
      const t = tag();
      const rows = [
        rowB(t), // tonnes
        rowB(t, {
          Commodity: `Bunch ${t}`,
          'Arrival Quantity': '120',
          'Arrival Unit': 'Bundle',
          'Modal Price': '30',
          'Price Unit': 'Rs./Bundle',
        }),
        rowB(t, {
          Commodity: `Piece ${t}`,
          'Arrival Quantity': '900',
          'Arrival Unit': 'Nos',
          'Modal Price': '12',
          'Price Unit': 'Rs./Unit',
        }),
        rowB(t, { source_file: 'r2.csv', source_row_number: '77', report_title: 'Report 2' }), // overlapping report, identical values
        rowB(t, { source_file: 'r3.csv', 'Modal Price': '4100.00' }), // overlapping report, different value
        rowB(t, { State: 'Note:' }), // footer
        rowB(t, { row_issue: 'expected 8 columns, found 1', State: '' }),
        rowB(t, { Commodity: `Bad ${t}`, 'Arrival Unit': 'Truckloads' }),
      ];
      const result = await importCsv('B', B_HEADER, rows);
      expect(result).toMatchObject({
        read: 8,
        loaded: 3,
        duplicate: 1,
        conflicting: 1,
        rejected: 3,
        reconciled: true,
      });
      expect(result.rejectionsByReason).toEqual({ structural_error: 2, unsupported_unit: 1 });

      const units = await owner.query(
        `SELECT c.name, o.arrival_unit, o.price_unit, o.arrival_quantity::text AS arrival, v.arrival_tonnes::text AS tonnes, v.modal_price_per_quintal::text AS per_quintal
           FROM state_observations o JOIN commodities c ON c.id = o.commodity_id JOIN state_observations_normalized v ON v.id = o.id
          WHERE c.name LIKE $1 ORDER BY c.name`,
        [`%${t}`],
      );
      const byName = Object.fromEntries(units.rows.map((r) => [r.name.split(' ')[0], r]));
      expect(byName.Veg).toMatchObject({
        arrival_unit: 'tonne',
        price_unit: 'quintal',
        arrival: '2.000',
      });
      expect(Number(byName.Veg.tonnes)).toBe(2);
      expect(Number(byName.Veg.per_quintal)).toBe(4000);
      expect(byName.Bunch).toMatchObject({
        arrival_unit: 'bundle',
        price_unit: 'bundle',
        arrival: '120.000',
        tonnes: null,
        per_quintal: null,
      });
      expect(byName.Piece).toMatchObject({
        arrival_unit: 'nos',
        price_unit: 'unit',
        tonnes: null,
        per_quintal: null,
      });

      // No state-level record landed in a mandi table, and the original report line stays traceable.
      expect(
        await count(
          `SELECT count(*) AS n FROM mandi_observations o JOIN commodities c ON c.id = o.commodity_id WHERE c.name LIKE $1`,
          [`%${t}`],
        ),
      ).toBe(0);
      const label = await one(
        `SELECT o.source_report_label FROM state_observations o JOIN commodities c ON c.id = o.commodity_id WHERE c.name = $1`,
        [`Veg ${t}`],
      );
      expect(label.source_report_label).toBe('Report 1 | r1.csv#3');
      expect(
        await count(`SELECT count(*) AS n FROM observation_conflicts WHERE ingestion_run_id = $1`, [
          result.runId,
        ]),
      ).toBe(1);
    });
  });

  // ------------------------------------------------------------------ interruption, resume, rollback
  describe('interrupted, resumed and failed imports', () => {
    const makeRows = (t, n) =>
      Array.from({ length: n }, (_, i) =>
        rowA(t, {
          'Market Name': `Mandi ${t} ${i % 3}`,
          'Price Date': `${1 + (i % 12)}/${1 + Math.floor(i / 12)}/2023`,
        }),
      );

    it('survives a crash: the run is left "running", and resume continues after the committed batch without duplicates', async () => {
      const t = tag();
      const file = join(dir, `crash-${t}.csv`);
      writeFileSync(file, toCsv(A_HEADER, makeRows(t, 25)));
      await expect(
        importCsv('A', A_HEADER, [], {
          file,
          batchSize: 5,
          extra: { testHooks: { crashAfterBatches: 2 } },
        }),
      ).rejects.toThrow(/simulated crash/);
      const crashed = await one(
        `SELECT id, status, rows_read::int AS read, rows_loaded::int AS loaded, last_committed_row::int AS last FROM ingestion_runs WHERE source_file_id = (SELECT id FROM source_files WHERE file_name = $1) ORDER BY started_at DESC LIMIT 1`,
        [`crash-${t}.csv`],
      );
      expect(crashed).toMatchObject({ status: 'running', read: 10, loaded: 10, last: 10 }); // never a misleading "succeeded"

      const resumed = await importCsv('A', A_HEADER, [], {
        file,
        batchSize: 5,
        extra: { resume: true },
      });
      expect(resumed).toMatchObject({
        read: 15,
        loaded: 15,
        duplicate: 0,
        conflicting: 0,
        skippedByResume: 10,
        reconciled: true,
      });
      expect(resumed.resumedFromRunId).toBe(crashed.id);
      const old = await one(`SELECT status, error_summary FROM ingestion_runs WHERE id = $1`, [
        crashed.id,
      ]);
      expect(old.status).toBe('failed');
      expect(old.error_summary).toMatch(/superseded/);
      expect(
        await count(
          `SELECT count(*) AS n FROM mandi_observations o JOIN commodities c ON c.id = o.commodity_id WHERE c.name = $1`,
          [`Crop ${t}`],
        ),
      ).toBe(25);
    });

    it('a plain re-import after a crash closes the stale "running" run as failed and adds no duplicate', async () => {
      const t = tag();
      const file = join(dir, `stale-${t}.csv`);
      writeFileSync(file, toCsv(A_HEADER, makeRows(t, 20)));
      await expect(
        importCsv('A', A_HEADER, [], {
          file,
          batchSize: 5,
          extra: { testHooks: { crashAfterBatches: 2 } },
        }),
      ).rejects.toThrow(/simulated crash/);
      const again = await importCsv('A', A_HEADER, [], { file, batchSize: 5 });
      expect(again).toMatchObject({ read: 20, loaded: 10, duplicate: 10, reconciled: true });
      const running = await count(
        `SELECT count(*) AS n FROM ingestion_runs WHERE source_file_id = (SELECT id FROM source_files WHERE file_name = $1) AND status = 'running'`,
        [`stale-${t}.csv`],
      );
      expect(running).toBe(0);
      expect(
        await count(
          `SELECT count(*) AS n FROM mandi_observations o JOIN commodities c ON c.id = o.commodity_id WHERE c.name = $1`,
          [`Crop ${t}`],
        ),
      ).toBe(20);
    });

    it('a failed run records a failure (sanitised), keeps its committed batches, and can be resumed', async () => {
      const t = tag();
      const file = join(dir, `fail-${t}.csv`);
      writeFileSync(file, toCsv(A_HEADER, makeRows(t, 12)));
      await expect(
        importCsv('A', A_HEADER, [], {
          file,
          batchSize: 4,
          extra: { testHooks: { failAfterBatches: 1 } },
        }),
      ).rejects.toThrow(/simulated failure/);
      const failed = await one(
        `SELECT id, status, finished_at IS NOT NULL AS finished, error_summary, rows_read::int AS read FROM ingestion_runs WHERE source_file_id = (SELECT id FROM source_files WHERE file_name = $1) ORDER BY started_at DESC LIMIT 1`,
        [`fail-${t}.csv`],
      );
      expect(failed).toMatchObject({ status: 'failed', finished: true, read: 4 });
      expect(failed.error_summary).not.toMatch(/postgres(ql)?:\/\//);
      const resumed = await importCsv('A', A_HEADER, [], {
        file,
        batchSize: 4,
        extra: { resume: true },
      });
      expect(resumed).toMatchObject({ read: 8, loaded: 8, reconciled: true });
      expect(
        await count(
          `SELECT count(*) AS n FROM mandi_observations o JOIN commodities c ON c.id = o.commodity_id WHERE c.name = $1`,
          [`Crop ${t}`],
        ),
      ).toBe(12);
    });

    it('rolls back a whole batch on a database error: no facts, no registry rows and no counters leak', async () => {
      const t = tag();
      const good = makeRows(t, 4);
      const poisoned = [
        rowA(`${t}-new`, { Modal_Price: '99999999999999999999', Max_Price: '', Min_Price: '' }),
        rowA(`${t}-other`),
      ];
      const file = join(dir, `rollback-${t}.csv`);
      writeFileSync(file, toCsv(A_HEADER, [...good, ...poisoned]));
      await expect(importCsv('A', A_HEADER, [], { file, batchSize: 4 })).rejects.toThrow(
        /numeric field overflow|overflow/,
      );
      const run = await one(
        `SELECT status, rows_read::int AS read, rows_loaded::int AS loaded, last_committed_row::int AS last, error_summary FROM ingestion_runs WHERE source_file_id = (SELECT id FROM source_files WHERE file_name = $1) ORDER BY started_at DESC LIMIT 1`,
        [`rollback-${t}.csv`],
      );
      expect(run).toMatchObject({ status: 'failed', read: 4, loaded: 4, last: 4 });
      expect(
        await count(`SELECT count(*) AS n FROM commodities WHERE name LIKE $1`, [`Crop ${t}-%`]),
      ).toBe(0);
      expect(
        await count(`SELECT count(*) AS n FROM markets WHERE name LIKE $1`, [`Mandi ${t}-%`]),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*) AS n FROM mandi_observations o JOIN commodities c ON c.id = o.commodity_id WHERE c.name LIKE $1`,
          [`Crop ${t}%`],
        ),
      ).toBe(4);
    });

    it('refuses to resume when there is nothing to resume, and refuses a second concurrent import of a source', async () => {
      const t = tag();
      const file = join(dir, `noresume-${t}.csv`);
      writeFileSync(file, toCsv(A_HEADER, [rowA(t)]));
      await expect(importCsv('A', A_HEADER, [], { file, extra: { resume: true } })).rejects.toThrow(
        /no interrupted run/,
      );
      const lock = await owner.connect();
      try {
        await lock.query(
          `SELECT pg_advisory_lock(hashtext('fasalytics:ingest:mandi_daily_prices_historical'))`,
        );
        await expect(importCsv('A', A_HEADER, [rowA(t)])).rejects.toThrow(/already running/);
      } finally {
        await lock.query(`SELECT pg_advisory_unlock_all()`);
        lock.release();
      }
    });
  });

  // ------------------------------------------------------------------ fingerprints, dry runs, safety
  describe('file fingerprints, dry runs and write safety', () => {
    it('fingerprints a file by its bytes: a copy under another name is the same file, a changed file is new', async () => {
      const t = tag();
      const body = toCsv(A_HEADER, [rowA(t)]);
      const one1 = join(dir, `fp1-${t}.csv`);
      const two = join(dir, `fp2-${t}.csv`);
      writeFileSync(one1, body);
      writeFileSync(two, body);
      const a = await importCsv('A', A_HEADER, [], { file: one1 });
      const b = await importCsv('A', A_HEADER, [], { file: two });
      expect(b.file.sha256).toBe(a.file.sha256);
      expect(
        await count(`SELECT count(*) AS n FROM source_files WHERE file_sha256 = $1`, [
          a.file.sha256,
        ]),
      ).toBe(1);
      const stored = await one(`SELECT file_name FROM source_files WHERE file_sha256 = $1`, [
        a.file.sha256,
      ]);
      expect(stored.file_name).not.toMatch(/[\\/]/); // a name, never a path
      const changed = join(dir, `fp3-${t}.csv`);
      writeFileSync(changed, toCsv(A_HEADER, [rowA(t, { Modal_Price: '2301' })]));
      const c = await importCsv('A', A_HEADER, [], { file: changed });
      expect(c.file.sha256).not.toBe(a.file.sha256);
    });

    it('a dry run touches no database: nothing is created or counted', async () => {
      const t = tag();
      const file = join(dir, `dry-${t}.csv`);
      writeFileSync(file, toCsv(A_HEADER, [rowA(t), rowA(t, { STATE: 'Gao' })]));
      const before = await count(
        `SELECT (SELECT count(*) FROM ingestion_runs) + (SELECT count(*) FROM mandi_observations) + (SELECT count(*) FROM commodities) + (SELECT count(*) FROM source_files) AS n`,
      );
      const { readReferenceSet } = await import('./registry/lgd.js');
      const { resolverFromReference } = await import('./registry/memory.js');
      const ref = await readReferenceSet(REFERENCE);
      const { adapter } = DATASETS.A;
      const dry = await runIngestion({
        adapter,
        filePath: file,
        mode: 'dry-run',
        dryRunResolver: () =>
          resolverFromReference(ref, decisionsForSource(decisions, adapter.source.code)),
      });
      expect(dry).toMatchObject({
        mode: 'dry-run',
        read: 2,
        wouldLoad: 1,
        rejected: 1,
        reconciled: true,
      });
      expect(
        await count(
          `SELECT (SELECT count(*) FROM ingestion_runs) + (SELECT count(*) FROM mandi_observations) + (SELECT count(*) FROM commodities) + (SELECT count(*) FROM source_files) AS n`,
        ),
      ).toBe(before);
    });

    it('write mode needs a pool, and the CLI refuses a write without confirmation or against the development database', async () => {
      const { adapter } = DATASETS.D;
      await expect(
        runIngestion({ adapter, filePath: join(dir, 'x.csv'), mode: 'write' }),
      ).rejects.toThrow();
      const file = join(dir, `cli-${tag()}.csv`);
      writeFileSync(file, toCsv(['Crop', 'January-2013'], [['X', '1']]));
      const before = await count('SELECT count(*) AS n FROM ingestion_runs');
      await expect(cli(['import', '--dataset', 'D', '--file', file, '--write'])).rejects.toThrow(
        /needs --yes/,
      );
      expect(await count('SELECT count(*) AS n FROM ingestion_runs')).toBe(before);
      const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
      if (existsSync(envFile)) {
        const dev = readFileSync(envFile, 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
        if (dev) {
          process.env.TEST_DEV_TARGET = dev;
          await expect(
            cli([
              'import',
              '--dataset',
              'D',
              '--file',
              file,
              '--write',
              '--yes',
              '--url-env',
              'TEST_DEV_TARGET',
            ]),
          ).rejects.toThrow(/DEVELOPMENT database/);
          delete process.env.TEST_DEV_TARGET;
        }
      }
    });
  });

  // ------------------------------------------------------------------ roles
  describe('role restrictions', () => {
    it('lets the ingestion role load but not alter or destroy, and keeps the application role read-only', async () => {
      const denied = async (pool, text) => {
        try {
          await pool.query(text);
          return 'ALLOWED';
        } catch (error) {
          return /** @type {any} */ (error).code;
        }
      };
      for (const text of [
        'DELETE FROM mandi_observations',
        'UPDATE mandi_observations SET modal_price = 1',
        'DELETE FROM ingestion_rejections',
        "UPDATE state_aliases SET resolution_status = 'rejected'",
        'UPDATE ingestion_runs SET source_id = source_id',
        'TRUNCATE mandi_observations',
        'DROP TABLE states',
      ]) {
        expect(await denied(ingest, text), text).toBe('42501');
      }
      for (const text of [
        "INSERT INTO states (name, kind) VALUES ('Nope', 'state')",
        'UPDATE states SET is_active = false',
        'DELETE FROM markets',
      ]) {
        expect(await denied(app, text), text).toBe('42501');
      }
    });
  });

  // ------------------------------------------------------------------ authentic samples (read-only)
  describe.runIf(existsSync(join(RAW, 'Agriculture_price_dataset.csv')))(
    'authentic dataset samples',
    () => {
      it('imports the first records of each real file, reconciles every row, and never modifies the originals', async () => {
        const files = Object.values(DATASETS).map((d) => join(RAW, d.defaultFile));
        const before = await Promise.all(files.map((f) => sha256File(f)));
        for (const [key, { adapter, defaultFile }] of Object.entries(DATASETS)) {
          const limit = key === 'D' ? 400 : 1500;
          const result = await importCsv(key, [], [], {
            file: join(RAW, defaultFile),
            extra: { limit },
          });
          expect(result.read, key).toBe(limit);
          expect(result.reconciled, key).toBe(true);
          expect(result.loaded + result.duplicate + result.conflicting + result.rejected, key).toBe(
            result.read,
          );
          const again = await importCsv(key, [], [], {
            file: join(RAW, defaultFile),
            extra: { limit },
          });
          expect(again.loaded, `${key} re-import`).toBe(0);
          expect(adapter.dataset).toBe(key);
        }
        const after = await Promise.all(files.map((f) => sha256File(f)));
        expect(after).toEqual(before);
      });
    },
  );

  // ------------------------------------------------------------------ reports
  describe('quality and alias reports', () => {
    it('reconciles every dataset, separates granularities, and leaks no credential', async () => {
      const reports = await buildReports(owner, {
        referenceManifest: JSON.parse(readFileSync(join(REFERENCE, 'manifest.json'), 'utf8')),
      });
      expect(Object.keys(reports.quality.datasets)).toEqual(['D', 'C', 'A', 'B']);
      for (const d of Object.values(reports.quality.datasets)) {
        expect(d.imported).toBe(true);
        for (const run of d.runs)
          expect(run.status === 'running' || run.reconciled, `${d.dataset} ${run.runId}`).toBe(
            true,
          );
        expect(d.unitAssumptions).toBeDefined();
      }
      expect(reports.quality.mandiLevelVersusStateLevel).toMatch(/separately/);
      expect(reports.quality.notice).toMatch(
        /not proven forecast eligibility|not a current market price/,
      );
      expect(reports.quality.datasets.D.indexNotice).toMatch(/never rupee prices/);
      expect(reports.aliases.reference.caution).toMatch(/PROVISIONAL/);
      expect(
        reports.aliases.states.some((s) => s.sourceLabel === 'Gao' && s.status === 'unresolved'),
      ).toBe(true);
      expect(reports.aliases.statesNeedingReview.length).toBeGreaterThan(0);

      const out = mkdtempSync(join(tmpdir(), 'fasalytics-reports-'));
      try {
        const files = writeReports(reports, out);
        expect(files).toHaveLength(4);
        const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
        expect(JSON.parse(readFileSync(files[0], 'utf8')).datasets.A.title).toMatch(/Dataset A/);
        for (const url of [
          process.env.DATABASE_URL,
          process.env.DATABASE_MIGRATION_URL,
          process.env.DATABASE_INGEST_URL,
        ]) {
          expect(text).not.toContain(new URL(String(url)).password);
        }
        expect(text).not.toMatch(/postgres(ql)?:\/\//);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    });
  });
});
