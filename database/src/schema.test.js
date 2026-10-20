import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema/index.js';

/** Static checks on the Drizzle schema and the migration files. No database is needed. */

const EXPECTED_TABLES = [
  'admin_unit_version',
  'commodities',
  'commodity_aliases',
  'data_sources',
  'district_aliases',
  'districts',
  'geo_reference_set',
  'identity_decision',
  'identity_review_event',
  'ingestion_rejections',
  'ingestion_runs',
  'mandi_observations',
  'mapping_set',
  'market_aliases',
  'markets',
  'measurement_units',
  'national_monthly_prices',
  'observation_conflicts',
  'source_assumptions',
  'source_files',
  'state_aliases',
  'state_observations',
  'states',
  'system_metadata',
  'varieties',
  'variety_aliases',
  'wpi_observations',
  'wpi_series',
];

const FACT_TABLES = [
  'mandi_observations',
  'state_observations',
  'national_monthly_prices',
  'wpi_observations',
];

const tableByName = Object.fromEntries(
  Object.values(schema).map((table) => [getTableName(table), table]),
);
const columnNames = (name) => Object.values(getTableColumns(tableByName[name])).map((c) => c.name);

describe('Drizzle schema', () => {
  it('declares exactly the Phase 1 table plus the canonical agricultural schema', () => {
    expect(Object.keys(tableByName).sort()).toEqual(EXPECTED_TABLES);
  });

  it('keeps system_metadata exactly as in Phase 1', () => {
    const columns = getTableColumns(schema.systemMetadata);
    expect(Object.keys(columns)).toEqual(['key', 'value', 'updatedAt']);
    expect(columns.key.primary).toBe(true);
    expect(columns.value.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });

  it('gives every table a primary key', () => {
    for (const name of EXPECTED_TABLES) {
      const hasPk = Object.values(getTableColumns(tableByName[name])).some((c) => c.primary);
      expect(hasPk, name).toBe(true);
    }
  });

  it('gives every fact table full provenance and quality columns', () => {
    for (const name of FACT_TABLES) {
      expect(columnNames(name), name).toEqual(
        expect.arrayContaining([
          'source_id',
          'ingestion_run_id',
          'source_file_id',
          'source_record_key',
          'record_fingerprint',
          'ingested_at',
          'is_historical_snapshot',
          'is_synthetic',
          'quality_status',
          'quality_flags',
        ]),
      );
      for (const required of [
        'source_id',
        'ingestion_run_id',
        'source_record_key',
        'record_fingerprint',
      ]) {
        expect(
          getTableColumns(tableByName[name])[camel(required)].notNull,
          `${name}.${required}`,
        ).toBe(true);
      }
    }
  });

  it('keeps granularities structurally separate', () => {
    expect(columnNames('mandi_observations')).toContain('market_id');
    expect(columnNames('state_observations')).not.toContain('market_id');
    for (const name of ['national_monthly_prices', 'wpi_series', 'wpi_observations']) {
      for (const forbidden of ['market_id', 'state_id', 'district_id', 'observed_date']) {
        expect(columnNames(name), name).not.toContain(forbidden);
      }
    }
    for (const name of ['wpi_series', 'wpi_observations']) {
      for (const forbidden of [
        'price_currency',
        'price_unit',
        'min_price',
        'max_price',
        'modal_price',
        'arrival_quantity',
      ]) {
        expect(columnNames(name), name).not.toContain(forbidden);
      }
    }
  });

  it('requires a market, commodity and date for every mandi observation', () => {
    const columns = getTableColumns(schema.mandiObservations);
    for (const key of ['marketId', 'commodityId', 'observedDate', 'sourceId', 'ingestionRunId']) {
      expect(columns[key].notNull, key).toBe(true);
    }
    expect(columns.varietyId.notNull).toBe(false); // unknown variety is NULL
    expect(columns.minPrice.notNull).toBe(false); // missing is never forced to a value
    expect(columns.arrivalQuantity.notNull).toBe(false);
  });

  it('has no column that could store credentials', () => {
    for (const name of EXPECTED_TABLES) {
      for (const column of columnNames(name)) {
        expect(column, `${name}.${column}`).not.toMatch(
          /password|secret|api_?key|token|credential/i,
        );
      }
    }
  });
});

/** @param {string} snake */
function camel(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

describe('migrations folder', () => {
  const files = readdirSync(MIGRATIONS_FOLDER);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();
  const sqlOf = (f) => readFileSync(join(MIGRATIONS_FOLDER, f), 'utf8');
  const allSql = sqlFiles.map(sqlOf).join('\n');

  it('contains numbered SQL migrations and the drizzle-kit journal', () => {
    expect(sqlFiles.length).toBeGreaterThanOrEqual(5);
    for (const file of sqlFiles) expect(file).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    expect(files).toContain('meta');
  });

  it('has a journal entry for every migration file and vice versa', () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    );
    const tags = journal.entries.map((/** @type {{ tag: string }} */ e) => `${e.tag}.sql`).sort();
    expect(tags).toEqual(sqlFiles);
  });

  it('never changes the already-applied Phase 1 migration', () => {
    const digest = createHash('sha256')
      .update(readFileSync(join(MIGRATIONS_FOLDER, '0000_initial_system_metadata.sql')))
      .digest('hex');
    expect(digest).toBe('2c3f53b9c58286aa3046c13b752dab49e850d149e9494315ef0206513be78826');
  });

  it('creates exactly the tables the schema declares', () => {
    const created = [...allSql.matchAll(/CREATE TABLE\s+"?([a-z_]+)"?/gi)].map((m) => m[1]).sort();
    expect(created).toEqual(EXPECTED_TABLES);
  });

  it('inserts only physical unit constants: no agricultural data in any migration', () => {
    // Function bodies (dollar-quoted) legitimately contain INSERT statements that only run when called, for
    // example the audit-event writer of Milestone 2.4; they insert nothing when the migration is applied.
    const topLevel = allSql.replace(/\$\$[\s\S]*?\$\$/g, ' ');
    const inserts = [...topLevel.matchAll(/INSERT INTO\s+"?([a-z_]+)"?/gi)].map((m) => m[1]);
    expect(new Set(inserts)).toEqual(new Set(['measurement_units']));
    expect(allSql).not.toMatch(
      /INSERT INTO\s+"?(states|districts|markets|commodities|varieties)"?/i,
    );
    // Milestone 2.4: the only INSERTs in migrations 0005 and 0006 are inside function bodies.
    for (const file of sqlFiles.filter((f) => /^000[56]_/.test(f))) {
      expect(sqlOf(file).replace(/\$\$[\s\S]*?\$\$/g, ' '), file).not.toMatch(/INSERT INTO/i);
    }
  });

  it('contains no credentials, role passwords or connection strings', () => {
    expect(allSql).not.toMatch(/PASSWORD\s+'/i);
    expect(allSql).not.toMatch(/postgres(ql)?:\/\/[^\s'"]*@/i);
    expect(allSql).not.toMatch(/CREATE\s+ROLE|ALTER\s+ROLE|GRANT\s+.*\s+TO\s+"?fasalytics/i);
  });

  it('never weakens privileges for PUBLIC or grants administrative rights', () => {
    // Word boundaries: `INSERT INTO public.x` is not a grant to PUBLIC.
    expect(allSql).not.toMatch(/\bTO\s+PUBLIC\b/i);
    expect(allSql).not.toMatch(/SUPERUSER|CREATEROLE|CREATEDB|BYPASSRLS/i);
  });

  it('keeps every constraint and index name within the 63-character PostgreSQL limit', () => {
    const names = [
      ...allSql.matchAll(/CONSTRAINT\s+"([^"]+)"/g),
      ...allSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"/g),
    ].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(50);
    for (const name of names) expect(name.length, name).toBeLessThanOrEqual(63);
  });

  it('defines CHECK constraints on every fact table', () => {
    for (const table of FACT_TABLES) {
      const block = allSql.slice(allSql.indexOf(`CREATE TABLE "${table}"`));
      const body = block.slice(0, block.indexOf('--> statement-breakpoint'));
      expect((body.match(/CHECK \(/g) ?? []).length, table).toBeGreaterThanOrEqual(5);
    }
  });

  it('contains no TypeScript', () => {
    expect(
      readdirSync(join(MIGRATIONS_FOLDER, '..', 'src', 'schema')).filter((f) => /\.tsx?$/.test(f)),
    ).toEqual([]);
  });
});
