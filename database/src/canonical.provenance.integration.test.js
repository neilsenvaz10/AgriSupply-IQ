import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { describeIntegration } from './test/db.js';
import { assertDisposable } from './test/disposable.js';
import {
  expectViolation,
  insertMandi,
  insertNational,
  insertRow,
  insertState,
  insertText,
  insertWpi,
  insertWpiSeries,
  mandiRow,
  one,
  requireCanonicalSchema,
  seedBasics,
  sha256,
  suffix,
  withRollback,
} from './test/fixtures.js';

/**
 * Source registry, file fingerprints, ingestion runs, rejections and provenance traceability.
 * Synthetic fixtures only; every test is rolled back.
 */
// Constraint tests run as the schema OWNER (the migrator): they test the data rules, not role
// privileges. Since Milestone 2.2 the application role is read-only on these tables; its
// privileges are verified in verify.js and the privilege tests.
const appUrl = process.env.DATABASE_MIGRATION_URL ?? '';

const constraintOf = async (c, table, row) => {
  const { text, values } = insertText(table, row);
  return (await expectViolation(c, text, values)).constraint;
};

describeIntegration('canonical schema: sources, ingestion and provenance', () => {
  /** @type {ReturnType<typeof createDb>} */
  let app;
  beforeAll(async () => {
    await assertDisposable();
    app = createDb(appUrl);
    await requireCanonicalSchema(app.pool);
  });
  afterAll(async () => {
    await app?.close();
  });
  const tx = (work) => withRollback(app.pool, work);

  describe('data sources', () => {
    it('requires a machine-friendly unique code and a known type', () =>
      tx(async (c) => {
        const tag = suffix();
        await insertRow(c, 'data_sources', {
          code: `src_${tag}`,
          name: 'A',
          source_type: 'government_api',
        });
        expect(
          await constraintOf(c, 'data_sources', {
            code: `src_${tag}`,
            name: 'B',
            source_type: 'historical_file',
          }),
        ).toBe('data_sources_code_uq');
        expect(
          await constraintOf(c, 'data_sources', {
            code: 'Has Spaces',
            name: 'B',
            source_type: 'historical_file',
          }),
        ).toBe('data_sources_code_ck');
        expect(
          await constraintOf(c, 'data_sources', {
            code: `t_${tag}`,
            name: 'B',
            source_type: 'scraper',
          }),
        ).toBe('data_sources_type_ck');
      }));

    it('refuses an endpoint reference that embeds credentials', () =>
      tx(async (c) => {
        const tag = suffix();
        const bad = [
          'https://api.example.test/data?api_key=abc123',
          'https://api.example.test/data?token=abc',
          'https://api.example.test/data?password=x',
          'https://user:secret@api.example.test/data',
        ];
        for (const [i, endpoint_reference] of bad.entries()) {
          expect(
            await constraintOf(c, 'data_sources', {
              code: `cred_${tag}_${i}`,
              name: 'bad',
              source_type: 'government_api',
              endpoint_reference,
            }),
          ).toBe('data_sources_no_credentials_ck');
        }
        await insertRow(c, 'data_sources', {
          code: `ok_${tag}`,
          name: 'good',
          source_type: 'government_api',
          endpoint_reference: 'https://api.example.test/resource/market-prices',
        });
      }));

    it('has no column that could hold secrets or free-form settings', async () => {
      const cols = await app.pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'data_sources'`,
      );
      const names = cols.rows.map((r) => r.column_name);
      for (const risky of [
        'api_key',
        'token',
        'secret',
        'password',
        'credentials',
        'settings',
        'metadata',
        'config',
      ]) {
        expect(names).not.toContain(risky);
      }
    });
  });

  describe('source files (fingerprints)', () => {
    it('registers a file once per source by checksum, so an unchanged re-import is recognised', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const sha = sha256(`same-bytes-${b.tag}`);
        await insertRow(c, 'source_files', {
          source_id: b.sourceId,
          file_name: 'a.csv',
          file_sha256: sha,
        });
        expect(
          await constraintOf(c, 'source_files', {
            source_id: b.sourceId,
            file_name: 'renamed.csv',
            file_sha256: sha,
          }),
        ).toBe('source_files_source_sha_uq');
        await insertRow(c, 'source_files', {
          source_id: b.otherSourceId,
          file_name: 'a.csv',
          file_sha256: sha,
        });
      }));

    it('validates the checksum, rejects paths in the file name and impossible sizes or periods', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const base = {
          source_id: b.sourceId,
          file_name: 'ok.csv',
          file_sha256: sha256(`x-${b.tag}`),
        };
        expect(await constraintOf(c, 'source_files', { ...base, file_sha256: 'ABC' })).toBe(
          'source_files_sha_ck',
        );
        expect(
          await constraintOf(c, 'source_files', {
            ...base,
            file_name: 'C:\\Users\\someone\\ok.csv',
          }),
        ).toBe('source_files_name_ck');
        expect(
          await constraintOf(c, 'source_files', { ...base, file_name: '/home/someone/ok.csv' }),
        ).toBe('source_files_name_ck');
        expect(await constraintOf(c, 'source_files', { ...base, size_bytes: -1 })).toBe(
          'source_files_size_ck',
        );
        expect(
          await constraintOf(c, 'source_files', {
            ...base,
            reported_period_start: '2024-02-01',
            reported_period_end: '2024-01-01',
          }),
        ).toBe('source_files_period_ck');
      }));
  });

  describe('ingestion runs', () => {
    it('ties a run to a file of the SAME source', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        expect(
          await constraintOf(c, 'ingestion_runs', {
            source_id: b.otherSourceId,
            source_file_id: b.fileId, // file belongs to the first source
            importer_name: 't',
            importer_version: '1',
          }),
        ).toBe('ingestion_runs_file_source_fk');
      }));

    it('keeps status, finish time and counters consistent', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const base = { source_id: b.sourceId, importer_name: 't', importer_version: '1' };
        expect(await constraintOf(c, 'ingestion_runs', { ...base, status: 'succeeded' })).toBe(
          'ingestion_runs_finished_ck',
        );
        expect(
          await constraintOf(c, 'ingestion_runs', {
            ...base,
            status: 'running',
            finished_at: new Date().toISOString(),
          }),
        ).toBe('ingestion_runs_finished_ck');
        expect(
          await constraintOf(c, 'ingestion_runs', {
            ...base,
            status: 'nope',
            finished_at: new Date().toISOString(),
          }),
        ).toBe('ingestion_runs_status_ck');
        expect(
          await constraintOf(c, 'ingestion_runs', {
            ...base,
            rows_read: 10,
            rows_loaded: 8,
            rows_rejected: 5,
          }),
        ).toBe('ingestion_runs_counts_ck');
        expect(await constraintOf(c, 'ingestion_runs', { ...base, rows_rejected: -1 })).toBe(
          'ingestion_runs_counts_ck',
        );
        expect(
          await constraintOf(c, 'ingestion_runs', {
            ...base,
            status: 'failed',
            started_at: '2024-01-02T00:00:00Z',
            finished_at: '2024-01-01T00:00:00Z',
          }),
        ).toBe('ingestion_runs_time_ck');
        const done = await insertRow(c, 'ingestion_runs', {
          ...base,
          status: 'succeeded_with_rejections',
          finished_at: new Date().toISOString(),
          rows_read: 10,
          rows_loaded: 6,
          rows_exact_duplicate: 2,
          rows_conflicting: 1,
          rows_rejected: 1,
        });
        expect(done.rows[0].rows_read).toBe('10');
      }));

    it('refuses an error summary that leaks a connection string', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        expect(
          await constraintOf(c, 'ingestion_runs', {
            source_id: b.sourceId,
            importer_name: 't',
            importer_version: '1',
            status: 'failed',
            finished_at: new Date().toISOString(),
            error_summary: 'could not connect to postgresql://user:hunter2@db:5432/x',
          }),
        ).toBe('ingestion_runs_error_ck');
      }));
  });

  describe('rejections (quarantine)', () => {
    it('preserves the raw record exactly, numbers rows with an identity sequence the app role can use', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const raw = { State: 'Note:', 'Commodity Group': '', 'Arrival Quantity': '', extra: 'ü' };
        const r1 = await insertRow(c, 'ingestion_rejections', {
          ingestion_run_id: b.runId,
          source_row_number: 1,
          reason_code: 'structural_error',
          reason_detail: 'footer text in the State column',
          raw_record: JSON.stringify(raw),
          raw_record_sha256: sha256(JSON.stringify(raw)),
        });
        const r2 = await insertRow(c, 'ingestion_rejections', {
          ingestion_run_id: b.runId,
          source_row_number: 2,
          reason_code: 'invalid_date',
          raw_record: JSON.stringify({}),
          raw_record_sha256: sha256('{}'),
        });
        expect(r1.rows[0].raw_record).toEqual(raw);
        expect(Number(r2.rows[0].id)).toBeGreaterThan(Number(r1.rows[0].id));
      }));

    it('validates reason, hash and the record shape; one rejection per run and row', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const base = {
          ingestion_run_id: b.runId,
          source_row_number: 1,
          reason_code: 'other',
          raw_record: JSON.stringify({ a: '1' }),
          raw_record_sha256: sha256('a'),
        };
        await insertRow(c, 'ingestion_rejections', base);
        expect(await constraintOf(c, 'ingestion_rejections', base)).toBe(
          'ingestion_rejections_run_row_uq',
        );
        expect(
          await constraintOf(c, 'ingestion_rejections', {
            ...base,
            source_row_number: 2,
            reason_code: 'whatever',
          }),
        ).toBe('ingestion_rejections_reason_ck');
        expect(
          await constraintOf(c, 'ingestion_rejections', {
            ...base,
            source_row_number: 3,
            raw_record_sha256: 'zz',
          }),
        ).toBe('ingestion_rejections_sha_ck');
        expect(
          await constraintOf(c, 'ingestion_rejections', {
            ...base,
            source_row_number: 4,
            raw_record: JSON.stringify([1, 2]),
          }),
        ).toBe('ingestion_rejections_raw_ck');
        const orphan = insertText('ingestion_rejections', {
          ...base,
          source_row_number: 5,
          ingestion_run_id: '00000000-0000-4000-8000-000000000000',
        });
        expect((await expectViolation(c, orphan.text, orphan.values)).code).toBe('23503');
      }));
  });

  describe('observation provenance integrity', () => {
    it('requires every observation to reference an ingestion run of its own source', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        // Run belongs to ANOTHER source.
        expect(
          await constraintOf(
            c,
            'mandi_observations',
            mandiRow(b, { ingestion_run_id: b.otherRunId }),
          ),
        ).toBe('mandi_obs_run_fk');
        // No run at all.
        const noRun = insertText('mandi_observations', mandiRow(b, { ingestion_run_id: null }));
        expect((await expectViolation(c, noRun.text, noRun.values)).code).toBe('23502');
      }));

    it('requires a referenced source file to belong to the same source', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const otherFile = await insertRow(c, 'source_files', {
          source_id: b.otherSourceId,
          file_name: 'other.csv',
          file_sha256: sha256(`other-${b.tag}`),
        });
        expect(
          await constraintOf(
            c,
            'mandi_observations',
            mandiRow(b, { source_file_id: otherFile.rows[0].id }),
          ),
        ).toBe('mandi_obs_file_fk');
      }));

    it('applies the same provenance rules to every fact table', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const series = (await insertWpiSeries(c, b)).rows[0];
        /** @type {Array<[string, Function, string]>} */
        const cases = [
          ['state_observations', insertState, 'state_obs_run_fk'],
          ['national_monthly_prices', insertNational, 'national_price_run_fk'],
        ];
        for (const [table, insert, constraint] of cases) {
          const rows = (await insert(c, b)).rows[0];
          expect(rows.ingestion_run_id).toBe(b.runId);
          const bad = { ...rows };
          delete bad.id;
          delete bad.ingested_at;
          bad.ingestion_run_id = b.otherRunId;
          // A different natural key, so the provenance foreign key is what fails.
          if (bad.observed_date) bad.observed_date = '2024-09-09';
          if (bad.period_month) bad.period_month = '2024-09-01';
          bad.source_record_key = `${bad.source_record_key}-x`;
          bad.record_fingerprint = sha256(bad.source_record_key);
          expect(await constraintOf(c, table, bad)).toBe(constraint);
        }
        const wpi = (await insertWpi(c, b, series.id)).rows[0];
        expect(wpi.ingestion_run_id).toBe(b.runId);
        expect(
          await constraintOf(c, 'wpi_observations', {
            series_id: series.id,
            period_month: '2024-04-01',
            index_value: 100,
            source_id: b.sourceId,
            ingestion_run_id: b.otherRunId,
            source_record_key: 'k-wpi-bad',
            record_fingerprint: sha256('k-wpi-bad'),
          }),
        ).toBe('wpi_obs_run_fk');
      }));

    it('lets an observation be traced back to its source, file and run', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const obs = (
          await insertMandi(c, b, {
            source_row_number: 42,
            source_state_label: 'Chattisgarh',
            source_district_label: 'raipur',
            source_market_label: 'Raipur(Mandi)',
            source_commodity_label: 'Potato',
            is_historical_snapshot: true,
          })
        ).rows[0];
        const trace = await one(
          c,
          `SELECT s.code AS source_code, f.file_name, f.file_sha256, r.importer_name, o.source_row_number,
                  o.source_state_label, o.source_market_label, o.is_historical_snapshot
             FROM mandi_observations o
             JOIN data_sources s ON s.id = o.source_id
             JOIN source_files f ON f.id = o.source_file_id
             JOIN ingestion_runs r ON r.id = o.ingestion_run_id
            WHERE o.id = $1`,
          [obs.id],
        );
        expect(trace.source_code).toBe(`test_source_${b.tag}`);
        expect(trace.file_name).toBe(`test-${b.tag}.csv`);
        expect(trace.file_sha256).toBe(sha256(`file-${b.tag}`));
        expect(trace.importer_name).toBe('test-importer');
        expect(trace.source_row_number).toBe('42');
        expect(trace.source_state_label).toBe('Chattisgarh'); // original spelling preserved
        expect(trace.is_historical_snapshot).toBe(true);
      }));

    it('does not delete history: sources, files and runs cannot be removed while facts reference them', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        await insertMandi(c, b);
        for (const text of [
          `DELETE FROM ingestion_runs WHERE id = '${b.runId}'`,
          `DELETE FROM source_files WHERE id = '${b.fileId}'`,
          `DELETE FROM data_sources WHERE id = '${b.sourceId}'`,
          `DELETE FROM markets WHERE id = '${b.marketId}'`,
          `DELETE FROM commodities WHERE id = '${b.commodityId}'`,
        ]) {
          expect((await expectViolation(c, text)).code).toBe('23503');
        }
      }));
  });

  describe('indexes needed by the main read paths exist', () => {
    it('has the history, comparison and provenance indexes', async () => {
      const result = await app.pool.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const names = result.rows.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'mandi_obs_history_idx',
          'mandi_obs_commodity_day_idx',
          'mandi_obs_run_idx',
          'mandi_obs_file_idx',
          'state_obs_history_idx',
          'state_obs_commodity_day_idx',
          'national_price_series_idx',
          'wpi_obs_month_idx',
          'markets_state_district_idx',
          'ingestion_runs_source_started_idx',
          'obs_conflicts_open_idx',
        ]),
      );
    });

    it('uses the history index for a market price-history query', () =>
      tx(async (c) => {
        await c.query('SET LOCAL enable_seqscan = off');
        const plan = await c.query(
          `EXPLAIN SELECT observed_date, modal_price FROM mandi_observations
            WHERE market_id = $1 AND commodity_id = $2 AND observed_date >= '2024-01-01' ORDER BY observed_date`,
          ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
        );
        const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
        expect(text).toMatch(
          /mandi_obs_history_idx|mandi_obs_natural_uq|mandi_obs_commodity_day_idx/,
        );
      }));
  });
});
