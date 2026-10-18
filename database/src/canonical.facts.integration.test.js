import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { shouldRunIntegration } from './test/db.js';
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
  nationalRow,
  one,
  requireCanonicalSchema,
  seedBasics,
  sha256,
  stateRow,
  withRollback,
  wpiRow,
} from './test/fixtures.js';

/**
 * Fact-table integrity: granularity separation, value constraints, missing values, duplicates,
 * conflicts and unit handling. Synthetic fixtures only; every test is rolled back.
 */
const appUrl = process.env.DATABASE_URL ?? '';

const constraintOf = async (c, table, row) => {
  const { text, values } = insertText(table, row);
  return (await expectViolation(c, text, values)).constraint;
};

describe.runIf(shouldRunIntegration)('canonical schema: observations', () => {
  /** @type {ReturnType<typeof createDb>} */
  let app;
  beforeAll(async () => {
    app = createDb(appUrl);
    await requireCanonicalSchema(app.pool);
  });
  afterAll(async () => {
    await app?.close();
  });
  const tx = (work) => withRollback(app.pool, work);

  describe('representative records (synthetic)', () => {
    it('1. stores a mandi-level daily commodity price', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = (await insertMandi(c, b)).rows[0];
        expect(r.observed_date).toBe('2024-03-04');
        expect(Number(r.modal_price)).toBe(1250);
        expect(r.price_currency).toBe('INR');
        expect(r.price_unit).toBe('quintal');
        expect(r.quality_status).toBe('accepted');
        expect(r.quality_flags).toEqual([]);
        expect(r.is_synthetic).toBe(false); // the flag exists; importers set it for demo data
      }));

    it('2. stores a state-level daily commodity observation (no market involved)', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = (await insertState(c, b, { arrival_quantity: null, arrival_unit: null })).rows[0];
        expect(r.state_id).toBe(b.stateId);
        expect(Object.keys(r)).not.toContain('market_id');
        expect(r.arrival_quantity).toBeNull();
      }));

    it('3. stores a national monthly commodity price (averages for a month)', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = (await insertNational(c, b, { source_reported_change: -14.43 })).rows[0];
        expect(r.period_month).toBe('2024-03-01');
        expect(r.country_code).toBe('IN');
        expect(Number(r.avg_modal_price)).toBe(2300);
        expect(Number(r.source_reported_change)).toBe(-14.43);
      }));

    it('4. stores a national monthly WPI index as an index, not a price', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const series = (
          await insertWpiSeries(c, b, { item_label: 'Test Item A', base_description: null })
        ).rows[0];
        const r = (await insertWpi(c, b, series.id)).rows[0];
        expect(Number(r.index_value)).toBe(131.6);
        for (const forbidden of [
          'price_currency',
          'price_unit',
          'modal_price',
          'arrival_quantity',
          'market_id',
        ]) {
          expect(Object.keys(r)).not.toContain(forbidden);
        }
        expect(series.commodity_id).toBeNull(); // an item is linked to a commodity only when it truly is one
      }));

    it('5. stores an arrival quantity with an explicit unit, at state and market level', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const s = (
          await insertState(c, b, {
            arrival_quantity: 2.0,
            arrival_unit: 'tonne',
            source_arrival_unit_label: 'Metric Tonnes',
          })
        ).rows[0];
        expect(s.arrival_unit).toBe('tonne');
        expect(s.source_arrival_unit_label).toBe('Metric Tonnes');
        const m = (await insertMandi(c, b, { arrival_quantity: 35, arrival_unit: 'quintal' }))
          .rows[0];
        expect(m.arrival_unit).toBe('quintal');
        const bundle = (
          await insertState(c, b, {
            commodity_id: b.otherCommodityId,
            price_unit: 'bundle',
            arrival_unit: 'bundle',
            arrival_quantity: 100,
            source_arrival_unit_label: 'Bundle',
          })
        ).rows[0];
        expect(bundle.price_unit).toBe('bundle');
      }));

    it('6. records a rejected record and a source conflict without overwriting anything', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const existing = (await insertMandi(c, b, { observed_date: '2024-05-05' })).rows[0];
        const rejection = await insertRow(c, 'ingestion_rejections', {
          ingestion_run_id: b.runId,
          source_row_number: 7,
          reason_code: 'price_ordering_violation',
          reason_detail: 'min price above modal price',
          raw_record: JSON.stringify({ Min_Price: '2500', Modal_Price: '2300', Max_Price: '2600' }),
          raw_record_sha256: sha256('row-7'),
        });
        expect(rejection.rows[0].raw_record.Min_Price).toBe('2500'); // original text preserved
        const conflict = await insertRow(c, 'observation_conflicts', {
          ingestion_run_id: b.runId,
          fact_type: 'mandi_price',
          mandi_observation_id: existing.id,
          incoming_record: JSON.stringify({ modal_price: '1300' }),
          incoming_fingerprint: sha256('different values'),
        });
        expect(conflict.rows[0].status).toBe('open');
        const unchanged = await one(c, `SELECT modal_price FROM mandi_observations WHERE id = $1`, [
          existing.id,
        ]);
        expect(Number(unchanged.modal_price)).toBe(1250);
      }));
  });

  describe('granularity cannot be mixed', () => {
    const columnsOf = async (table) =>
      (
        await app.pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        )
      ).rows.map((r) => r.column_name);

    it('WPI tables contain no money, unit, quantity, market or state columns', async () => {
      for (const table of ['wpi_series', 'wpi_observations']) {
        const columns = await columnsOf(table);
        for (const forbidden of [
          'price_currency',
          'price_unit',
          'min_price',
          'max_price',
          'modal_price',
          'arrival_quantity',
          'arrival_unit',
          'market_id',
          'state_id',
          'observed_date',
        ]) {
          expect(columns).not.toContain(forbidden);
        }
      }
      expect(await columnsOf('wpi_observations')).toContain('index_value');
    });

    it('the national monthly table has no market, state or day column', async () => {
      const columns = await columnsOf('national_monthly_prices');
      for (const forbidden of [
        'market_id',
        'state_id',
        'district_id',
        'observed_date',
        'modal_price',
      ]) {
        expect(columns).not.toContain(forbidden);
      }
      expect(columns).toEqual(
        expect.arrayContaining(['period_month', 'avg_modal_price', 'country_code']),
      );
    });

    it('the state table has no market column; the mandi table requires one', async () => {
      expect(await columnsOf('state_observations')).not.toContain('market_id');
      expect(await columnsOf('state_observations')).not.toContain('district_id');
      const info = await app.pool.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'mandi_observations' AND column_name = 'market_id'`,
      );
      expect(info.rows[0].is_nullable).toBe('NO');
    });

    it('a mandi observation cannot be stored without a market', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const bad = insertText('mandi_observations', mandiRow(b, { market_id: null }));
        expect((await expectViolation(c, bad.text, bad.values)).code).toBe('23502');
      }));

    it('a national period must be the first day of a month, never an arbitrary day', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        expect(
          await constraintOf(
            c,
            'national_monthly_prices',
            nationalRow(b, { period_month: '2024-03-15' }),
          ),
        ).toBe('national_price_month_ck');
        expect(
          await constraintOf(
            c,
            'wpi_observations',
            wpiRow(b, (await insertWpiSeries(c, b)).rows[0].id, { period_month: '2024-03-02' }),
          ),
        ).toBe('wpi_obs_month_ck');
      }));

    it('a national record can only be for India', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        expect(
          await constraintOf(c, 'national_monthly_prices', nationalRow(b, { country_code: 'US' })),
        ).toBe('national_price_country_ck');
      }));

    it('a WPI index must be positive and its series must belong to the same source', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const series = (await insertWpiSeries(c, b)).rows[0];
        expect(
          await constraintOf(c, 'wpi_observations', wpiRow(b, series.id, { index_value: 0 })),
        ).toBe('wpi_obs_value_ck');
        expect(
          await constraintOf(c, 'wpi_observations', wpiRow(b, series.id, { index_value: -5 })),
        ).toBe('wpi_obs_value_ck');
        const crossSource = wpiRow(
          { ...b, sourceId: b.otherSourceId, fileId: null, runId: b.otherRunId },
          series.id,
        );
        expect(await constraintOf(c, 'wpi_observations', crossSource)).toBe('wpi_obs_series_fk');
      }));
  });

  describe('value constraints', () => {
    /** @type {Array<[string, Record<string, unknown>, string]>} */
    const cases = [
      ['negative min price', { min_price: -1 }, 'mandi_obs_nonneg_ck'],
      ['negative max price', { max_price: -1 }, 'mandi_obs_nonneg_ck'],
      ['negative modal price', { modal_price: -0.01 }, 'mandi_obs_nonneg_ck'],
      ['min above modal', { min_price: 1300 }, 'mandi_obs_order_ck'],
      ['modal above max', { modal_price: 1600 }, 'mandi_obs_order_ck'],
      ['min above max (no modal)', { modal_price: null, min_price: 1600 }, 'mandi_obs_order_ck'],
      [
        'negative arrival',
        { arrival_quantity: -1, arrival_unit: 'quintal' },
        'mandi_obs_arrival_ck',
      ],
      [
        'arrival without a unit',
        { arrival_quantity: 5, arrival_unit: null },
        'mandi_obs_arrival_ck',
      ],
      [
        'unit without an arrival',
        { arrival_quantity: null, arrival_unit: 'quintal' },
        'mandi_obs_arrival_ck',
      ],
      ['price without a currency', { price_currency: null }, 'mandi_obs_price_unit_ck'],
      ['price without a unit', { price_unit: null }, 'mandi_obs_price_unit_ck'],
      ['malformed currency', { price_currency: 'inr' }, 'mandi_obs_currency_ck'],
      [
        'no measurement at all',
        { min_price: null, max_price: null, modal_price: null },
        'mandi_obs_measure_ck',
      ],
      ['date before the supported range', { observed_date: '1980-01-01' }, 'mandi_obs_date_ck'],
      ['date after the supported range', { observed_date: '2200-01-01' }, 'mandi_obs_date_ck'],
      [
        'malformed fingerprint',
        { record_fingerprint: 'not-a-hash'.padEnd(64, 'x') },
        'mandi_obs_fingerprint_ck',
      ],
      ['blank source record key', { source_record_key: '  ' }, 'mandi_obs_record_key_ck'],
      ['unknown quality status', { quality_status: 'rejected' }, 'mandi_obs_quality_status_ck'],
      ['flagged without a flag', { quality_status: 'flagged' }, 'mandi_obs_quality_flags_ck'],
      [
        'flag without flagged status',
        { quality_flags: '{price_outlier}' },
        'mandi_obs_quality_flags_ck',
      ],
    ];

    it.each(cases)('rejects %s', (_label, overrides, constraint) =>
      tx(async (c) => {
        const b = await seedBasics(c);
        expect(await constraintOf(c, 'mandi_observations', mandiRow(b, overrides))).toBe(
          constraint,
        );
      }),
    );

    it('rejects a nonexistent calendar date', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const bad = insertText('mandi_observations', mandiRow(b, { observed_date: '2024-02-30' }));
        expect((await expectViolation(c, bad.text, bad.values)).code).toBe('22008');
      }));

    it('rejects a unit or currency that does not exist in the reference table', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const unit = insertText('mandi_observations', mandiRow(b, { price_unit: 'furlong' }));
        expect((await expectViolation(c, unit.text, unit.values)).code).toBe('23503');
        const arrival = insertText(
          'mandi_observations',
          mandiRow(b, { arrival_quantity: 1, arrival_unit: 'cubit' }),
        );
        expect((await expectViolation(c, arrival.text, arrival.values)).code).toBe('23503');
      }));

    it('stores a zero price only when it is explicitly flagged for review', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        expect(
          await constraintOf(
            c,
            'mandi_observations',
            mandiRow(b, { min_price: 0, modal_price: 0, max_price: 0 }),
          ),
        ).toBe('mandi_obs_zero_flag_ck');
        const flagged = await insertMandi(c, b, {
          min_price: 0,
          modal_price: 0,
          max_price: 0,
          quality_status: 'flagged',
          quality_flags: '{zero_price}',
        });
        expect(flagged.rows[0].quality_flags).toEqual(['zero_price']);
      }));

    it('applies the same rules to state-level and national records', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        expect(await constraintOf(c, 'state_observations', stateRow(b, { modal_price: -5 }))).toBe(
          'state_obs_nonneg_ck',
        );
        expect(
          await constraintOf(c, 'state_observations', stateRow(b, { arrival_unit: null })),
        ).toBe('state_obs_arrival_ck');
        expect(await constraintOf(c, 'state_observations', stateRow(b, { min_price: 3000 }))).toBe(
          'state_obs_order_ck',
        );
        expect(
          await constraintOf(c, 'national_monthly_prices', nationalRow(b, { avg_min_price: 9999 })),
        ).toBe('national_price_order_ck');
        expect(
          await constraintOf(c, 'national_monthly_prices', nationalRow(b, { avg_modal_price: -1 })),
        ).toBe('national_price_nonneg_ck');
      }));
  });

  describe('missing values are explicit', () => {
    it('accepts NULL for every optional field and keeps them NULL (nothing is invented)', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = (
          await insertMandi(c, b, {
            variety_id: null,
            variety_label: null,
            grade: null,
            min_price: null,
            max_price: null,
            modal_price: 900,
            arrival_quantity: null,
            arrival_unit: null,
            source_file_id: null,
            source_row_number: null,
            source_published_at: null,
          })
        ).rows[0];
        for (const key of [
          'variety_id',
          'grade',
          'min_price',
          'max_price',
          'arrival_quantity',
          'source_file_id',
        ]) {
          expect(r[key]).toBeNull();
        }
        expect(Number(r.modal_price)).toBe(900);
      }));

    it('accepts an observation that carries only an arrival (no price at all)', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = (
          await insertMandi(c, b, {
            min_price: null,
            max_price: null,
            modal_price: null,
            price_currency: null,
            price_unit: null,
            arrival_quantity: 40,
            arrival_unit: 'quintal',
          })
        ).rows[0];
        expect(r.modal_price).toBeNull();
        expect(r.price_unit).toBeNull();
      }));
  });

  describe('duplicates and conflicts', () => {
    it('rejects the same source record key twice and the same natural key twice', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const first = (await insertMandi(c, b)).rows[0];
        expect(
          await constraintOf(
            c,
            'mandi_observations',
            mandiRow(b, {
              source_record_key: first.source_record_key,
              observed_date: '2024-03-05',
            }),
          ),
        ).toBe('mandi_obs_record_key_uq');
        expect(await constraintOf(c, 'mandi_observations', mandiRow(b))).toBe(
          'mandi_obs_natural_uq',
        );
      }));

    it('treats an unspecified variety and grade as a value, so NULLs cannot duplicate', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const open = { variety_id: null, grade: null };
        await insertMandi(c, b, open);
        expect(await constraintOf(c, 'mandi_observations', mandiRow(b, open))).toBe(
          'mandi_obs_natural_uq',
        );
      }));

    it('allows the same natural key from a different source (sources are never merged)', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        await insertMandi(c, b);
        await insertMandi(c, b, {
          source_id: b.otherSourceId,
          source_file_id: null,
          ingestion_run_id: b.otherRunId,
        });
      }));

    it('distinguishes variety, grade and date within one source', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        await insertMandi(c, b);
        await insertMandi(c, b, { grade: 'Local' });
        await insertMandi(c, b, { variety_id: null });
        await insertMandi(c, b, { observed_date: '2024-03-05' });
      }));

    it('makes a re-import idempotent: an exact duplicate inserts nothing, a changed record is a conflict', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const row = mandiRow(b);
        await insertRow(c, 'mandi_observations', row);

        // Importer pattern 1: exact duplicate (same natural key, same fingerprint) -> skipped.
        const columns = Object.keys(row);
        const upsert = `INSERT INTO mandi_observations (${columns.map((k) => `"${k}"`).join(', ')})
          VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
          ON CONFLICT ON CONSTRAINT mandi_obs_natural_uq DO NOTHING RETURNING id`;
        const values = columns.map((k) => row[k]);
        // Same natural key, a NEW source_record_key as a repeated import row would have:
        const again = await c.query(
          upsert,
          values.map((v, i) => (columns[i] === 'source_record_key' ? `${v}-again` : v)),
        );
        expect(again.rowCount).toBe(0);

        // Importer pattern 2: same natural key, different values -> fingerprint differs.
        const existing = await one(
          c,
          `SELECT id, record_fingerprint FROM mandi_observations WHERE source_id = $1 AND market_id = $2`,
          [b.sourceId, b.marketId],
        );
        const incomingFingerprint = sha256('different modal price');
        expect(incomingFingerprint).not.toBe(existing.record_fingerprint);
        const conflict = await insertRow(c, 'observation_conflicts', {
          ingestion_run_id: b.runId,
          fact_type: 'mandi_price',
          mandi_observation_id: existing.id,
          incoming_record: JSON.stringify({ modal_price: '1400' }),
          incoming_fingerprint: incomingFingerprint,
        });
        expect(conflict.rowCount).toBe(1);

        // Re-importing the same file again records the same candidate only once.
        const repeat = insertText('observation_conflicts', {
          ingestion_run_id: b.runId,
          fact_type: 'mandi_price',
          mandi_observation_id: existing.id,
          incoming_record: JSON.stringify({ modal_price: '1400' }),
          incoming_fingerprint: incomingFingerprint,
        });
        expect((await expectViolation(c, repeat.text, repeat.values)).constraint).toBe(
          'obs_conflicts_candidate_uq',
        );
        const original = await one(c, `SELECT modal_price FROM mandi_observations WHERE id = $1`, [
          existing.id,
        ]);
        expect(Number(original.modal_price)).toBe(1250);
      }));

    it('requires a conflict to reference exactly one existing observation of the matching type', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const mandi = (await insertMandi(c, b)).rows[0];
        const state = (await insertState(c, b)).rows[0];
        const base = {
          ingestion_run_id: b.runId,
          incoming_record: JSON.stringify({}),
          incoming_fingerprint: sha256('x'),
        };
        const none = { ...base, fact_type: 'mandi_price' };
        const both = {
          ...base,
          fact_type: 'mandi_price',
          mandi_observation_id: mandi.id,
          state_observation_id: state.id,
        };
        const wrongType = {
          ...base,
          fact_type: 'state_observation',
          mandi_observation_id: mandi.id,
        };
        for (const bad of [none, both, wrongType]) {
          expect(await constraintOf(c, 'observation_conflicts', bad)).toBe('obs_conflicts_ref_ck');
        }
        const dangling = insertText('observation_conflicts', {
          ...base,
          fact_type: 'mandi_price',
          mandi_observation_id: '00000000-0000-4000-8000-000000000000',
        });
        expect((await expectViolation(c, dangling.text, dangling.values)).code).toBe('23503');
        // An unknown fact type is refused (the reference check also fires; either is a rejection).
        const unknownType = await constraintOf(c, 'observation_conflicts', {
          ...base,
          fact_type: 'weather',
          mandi_observation_id: mandi.id,
        });
        expect(['obs_conflicts_type_ck', 'obs_conflicts_ref_ck']).toContain(unknownType);
      }));
  });

  describe('unit normalisation is derived through documented conversions only', () => {
    it('seeds exactly the documented physical units', async () => {
      const units = await app.pool.query(
        `SELECT code, dimension, kg_per_unit FROM measurement_units ORDER BY code`,
      );
      expect(
        units.rows.map((r) => [
          r.code,
          r.dimension,
          r.kg_per_unit === null ? null : Number(r.kg_per_unit),
        ]),
      ).toEqual([
        ['bundle', 'count', null],
        ['kg', 'mass', 1],
        ['nos', 'count', null],
        ['quintal', 'mass', 100],
        ['tonne', 'mass', 1000],
        ['unit', 'count', null],
      ]);
    });

    it('derives price per quintal and arrival tonnes from mass units, and NULL for count units', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        await insertMandi(c, b, {
          price_unit: 'tonne',
          min_price: 10000,
          modal_price: 12500,
          max_price: 15000,
          arrival_quantity: 350,
          arrival_unit: 'quintal',
        });
        const perQuintal = await one(
          c,
          `SELECT * FROM mandi_observations_normalized WHERE market_id = $1`,
          [b.marketId],
        );
        expect(Number(perQuintal.modal_price_per_quintal)).toBe(1250); // 12,500 per tonne = 1,250 per quintal
        expect(Number(perQuintal.min_price_per_quintal)).toBe(1000);
        expect(Number(perQuintal.arrival_tonnes)).toBe(35); // 350 quintals = 35 tonnes
        expect(perQuintal.price_currency).toBe('INR'); // currency is never converted

        await insertState(c, b, {
          commodity_id: b.otherCommodityId,
          price_unit: 'bundle',
          modal_price: 30,
          arrival_unit: 'bundle',
          arrival_quantity: 200,
        });
        const bundle = await one(
          c,
          `SELECT * FROM state_observations_normalized WHERE commodity_id = $1`,
          [b.otherCommodityId],
        );
        expect(bundle.modal_price_per_quintal).toBeNull();
        expect(bundle.arrival_tonnes).toBeNull();
      }));

    it('leaves the stored values in the original unit untouched', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = (
          await insertMandi(c, b, {
            price_unit: 'kg',
            modal_price: 12.5,
            min_price: 10,
            max_price: 15,
          })
        ).rows[0];
        expect(Number(r.modal_price)).toBe(12.5);
        expect(r.price_unit).toBe('kg');
        const view = await one(
          c,
          `SELECT modal_price_per_quintal FROM mandi_observations_normalized WHERE id = $1`,
          [r.id],
        );
        expect(Number(view.modal_price_per_quintal)).toBe(1250);
      }));
  });
});
