# Canonical agricultural schema (Phase 2, Milestone 2.1)

> **Scope of this milestone:** database structure only. The schema is migration-managed and tested,
> but **no agricultural data has been imported**. Every registry, fact, provenance and quarantine
> table is empty after migration (the only rows are six physical units). Importers are Milestone 2.2.
> Source of truth for the definitions: `src/schema/*.js` (Drizzle) and `migrations/0001_*`, `0002_*`.

## 1. Design principles

1. **One fact table per observation granularity.** Mandi-daily, state-daily, national-monthly price
   and national-monthly WPI index are different kinds of fact, so they are different tables with
   different required keys. A record of one granularity cannot be stored as another by accident.
2. **Identity is a UUID, never a name.** Names are not keys. Source spellings and codes live in alias
   tables; the canonical rows are created deliberately, never inferred.
3. **Preserve, don't repair.** Original labels (state, district, market, commodity, variety, grade,
   unit text) are stored next to the normalised references, so any value traces back to the source.
4. **Missing is NULL.** A missing district, variety, grade, price or arrival is NULL. Nothing is
   defaulted, back-filled or converted to zero. An unknown variety is NULL, never a made-up row.
5. **The database refuses bad data.** Constraints, not importers alone, enforce non-negative values,
   price ordering, unit/currency pairing, date ranges, composite foreign keys and uniqueness.
6. **Nothing is silently overwritten.** Exact duplicates are skipped; conflicting records are kept
   in `observation_conflicts`; unloadable records are kept, raw, in `ingestion_rejections`.
7. **No built-in universe.** No state, district, mandi or crop list exists in code or migrations.
   Potato, Onion, Tomato or Maharashtra appear nowhere in the schema.

## 2. Entity-relationship overview

```text
 states 1---* districts                  data_sources 1---* source_files
   |             |                              |               |
   |  (district must belong to the market's      +---* ingestion_runs *---1 (optional) source_files
   |   own state: composite FK)                          |
   +---* markets *--- district (optional)               +--- ingestion_rejections   (quarantine, raw record kept)
            |                                            +--- observation_conflicts  (same key, different values)
 commodities 1---* varieties                             |
      |                                                  v   every fact row references source + run (+ file)
      |   (variety must belong to the                +-----------------------------------------------+
      |    observation's own commodity)              | mandi_observations   market x commodity x      |
      +-------- facts ----------------------------->|                     variety x grade x DAY     |
                                                     | state_observations   state x commodity x DAY   |
 *_aliases (state, district, market,                 | national_monthly_prices India x commodity x    |
   commodity, variety)                               |                     MONTH (averages)           |
   source label/code -> entity, with status          | wpi_series 1---* wpi_observations              |
                                                     |                     national INDEX x MONTH     |
 measurement_units  <--- price_unit / arrival_unit   +-----------------------------------------------+
```

## 3. Tables and key columns

| Table                                                                                         | Purpose                                       | Key columns and rules                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `states`                                                                                      | States and union territories                  | `id`, `name`, generated `normalized_name` (unique), `kind` (`state` / `union_territory`), optional `lgd_code` (unique)                                                                                                                                                                                                                                                                             |
| `districts`                                                                                   | Districts                                     | `state_id` NOT NULL; unique `(state_id, normalized_name)`; unique `(id, state_id)` enables the markets check                                                                                                                                                                                                                                                                                       |
| `markets`                                                                                     | Mandis                                        | `state_id` NOT NULL, optional `district_id`; **composite FK `(district_id, state_id)` -> districts** so a district must belong to the market's state; unique identity `(state, district, normalized_name, disambiguator)` with NULL district counted as equal; optional coordinates (both or neither, in range); `status` incl. `merged` + `merged_into_market_id` for manual duplicate resolution |
| `commodities`                                                                                 | Commodities                                   | `name`, unique `normalized_name`, optional `commodity_group`                                                                                                                                                                                                                                                                                                                                       |
| `varieties`                                                                                   | Varieties                                     | `commodity_id` NOT NULL; unique `(commodity_id, normalized_name)`; unique `(id, commodity_id)` enables the observation check                                                                                                                                                                                                                                                                       |
| `state_aliases`, `district_aliases`, `market_aliases`, `commodity_aliases`, `variety_aliases` | Source label/code to entity                   | `source_id`, `source_key` (label + parent context), `source_label` (original), optional `source_code`, `resolution_status`, entity FK; unique `(source_id, source_key)` and `(source_id, source_code)`                                                                                                                                                                                             |
| `measurement_units`                                                                           | Units and conversions                         | `code`, `dimension` (`mass`/`count`), `kg_per_unit` (mass only); read-only for the application role                                                                                                                                                                                                                                                                                                |
| `data_sources`                                                                                | Providers                                     | unique `code`, `source_type`, optional `endpoint_reference` (checked: no key/token/password/`user:pass@`); **no settings or secret column exists**                                                                                                                                                                                                                                                 |
| `source_files`                                                                                | Input fingerprints                            | `file_sha256` unique per source, file name only (paths rejected), optional `dataset_version`, reported period                                                                                                                                                                                                                                                                                      |
| `ingestion_runs`                                                                              | One importer execution                        | status, importer name/version, counters (read, loaded, exact duplicate, conflicting, rejected), consistency checks; composite FK keeps run and file in the same source                                                                                                                                                                                                                             |
| `ingestion_rejections`                                                                        | Quarantine                                    | run, row number, `reason_code`, `raw_record` (jsonb, original text values), SHA-256; one per run and row                                                                                                                                                                                                                                                                                           |
| `observation_conflicts`                                                                       | Same key, different values                    | `fact_type` + exactly one FK to the existing observation, `incoming_record`, `incoming_fingerprint`, `status`; one row per candidate                                                                                                                                                                                                                                                               |
| `mandi_observations`                                                                          | **Mandi x commodity x variety x grade x day** | `market_id`, `commodity_id` NOT NULL, `variety_id` NULL = unknown, `grade`, `observed_date`, min/max/modal price, `price_currency`, `price_unit`, optional arrival + `arrival_unit`, original labels, provenance                                                                                                                                                                                   |
| `state_observations`                                                                          | **State x commodity x day**                   | `state_id`, `commodity_id`, `observed_date`; prices, arrival, units; **no market or district column**                                                                                                                                                                                                                                                                                              |
| `national_monthly_prices`                                                                     | **India x commodity x month**                 | `period_month` (first day), `avg_min/max/modal_price`, currency, unit, `source_reported_change`, `country_code = 'IN'`; no market, state or day                                                                                                                                                                                                                                                    |
| `wpi_series`, `wpi_observations`                                                              | **National WPI index x month**                | `index_value > 0`; **no currency, unit, quantity, market or state column**                                                                                                                                                                                                                                                                                                                         |

Provenance columns on every fact: `source_id`, `ingestion_run_id`, `source_file_id` (optional),
`source_record_key`, `source_row_number`, `record_fingerprint`, `source_published_at`, `ingested_at`,
`is_historical_snapshot`, `is_synthetic`, `quality_status`, `quality_flags`.

## 4. Observation granularity rules

| Question                                        | Table                             | What makes the wrong table impossible                                                                                                  |
| ----------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A price at a specific mandi on a day            | `mandi_observations`              | `market_id` NOT NULL, FK to `markets`                                                                                                  |
| A state figure (price and/or arrivals) on a day | `state_observations`              | no market column; arrivals here are **never** mandi arrivals                                                                           |
| An India-wide monthly average price             | `national_monthly_prices`         | `period_month` must be a first-of-month date; `country_code` must be `IN`; no market/state/day column                                  |
| A wholesale price **index** for a month         | `wpi_series` + `wpi_observations` | no currency or unit exists; `index_value` is dimensionless; a WPI row cannot be inserted into a price table because the columns differ |

District-level observations are intentionally **not** included. If a source provides them they
need their own table (`district_observations`, with `district_id` NOT NULL); folding them into the
state table would blend granularities.

## 5. Source alias-resolution strategy

1. Each source label is recorded once per source as an alias row keyed by `source_key`: the
   normalised label **plus its parent context** (for example `maharashtra|nashik|lasalgaon(niphad)`),
   so the same market name in two districts or states yields two distinct alias rows.
2. `resolution_status`: `resolved` (maps to an entity; requires the entity and a timestamp),
   `ambiguous` (several candidates, needs a person), `unresolved` (not yet reviewed),
   `rejected` (deliberately not mapped). A database check keeps `resolved` and the entity in step.
3. Resolution is explicit and reviewed. There is **no fuzzy matching**, and an unresolved alias
   never creates a registry row. Observations whose alias is not `resolved` go to quarantine
   (`unmapped_entity` / `ambiguous_entity`) with their raw values.
4. Spelling variants (for example a misspelt state) are separate alias rows that resolve to the same
   entity. The original spelling stays in `source_label` and on the observation.
5. Genuine duplicate markets are handled by `markets.status = 'merged'` + `merged_into_market_id`;
   two truly different markets that share a name coexist through `disambiguator`.
6. `normalized_name` / `normalized_label` are **generated** columns (lower-case, whitespace
   collapsed and trimmed). They are comparison keys only and cannot be written directly.

## 6. Unit and currency conventions

- Values are stored **exactly as the source reported them**, with the unit they were reported in.
  `price_currency` is an ISO-4217-shaped code (`^[A-Z]{3}$`); nothing assumes INR. `price_unit` and
  `arrival_unit` reference `measurement_units`; the source's own text (`Rs./Quintal`,
  `Metric Tonnes`) is kept in `source_price_unit_label` / `source_arrival_unit_label`.
- Documented conversions (physical constants): 1 quintal = 100 kg, 1 tonne = 1000 kg. **Count units**
  (`bundle`, `nos`, `unit`) have no mass conversion and never convert to quintals.
- Normalised values are **derived, not stored**: views `mandi_observations_normalized` and
  `state_observations_normalized` give price per quintal and arrival in tonnes for mass units only
  (NULL for count units). Currency is never converted. The views use `security_invoker`.
- A price requires both currency and unit; an arrival requires its unit; a measurement-less row is
  refused; zero prices are accepted only when `quality_status = 'flagged'`.
- **Limitation:** a source file that states no unit (datasets A and C in this repository) needs the
  unit to be asserted by the importer from documentation, and that assumption must be recorded in
  `data_sources.description` and the run record.

## 7. Idempotency and conflict handling

Every fact has two uniqueness rules: a **natural key** (what the source reports: for mandi data
`source, market, commodity, variety, grade, date`, with NULL treated as a value) and a
**`(source_id, source_record_key)`** identity, plus a `record_fingerprint` (SHA-256 of the
normalised source values). The importer protocol for each source record:

| Situation                                            | Detection                                                  | Outcome                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| New record                                           | no row with this natural key                               | `INSERT`; `rows_loaded += 1`                                                                                                                  |
| **Exact duplicate** (re-import, overlapping reports) | natural key exists **and** same fingerprint                | skipped (`ON CONFLICT ... DO NOTHING`); `rows_exact_duplicate += 1`                                                                           |
| **Conflict**                                         | natural key exists, **different** fingerprint              | existing row untouched; incoming values stored in `observation_conflicts` (once per candidate); `rows_conflicting += 1`; a person resolves it |
| **Unloadable**                                       | fails a constraint or mapping                              | stored raw in `ingestion_rejections` with a reason; `rows_rejected += 1`                                                                      |
| Unchanged file                                       | `source_files (source_id, file_sha256)` already registered | recognised before any row is read                                                                                                             |

Because of this a repeated import is idempotent and never silently overwrites. Different sources
reporting the same market/day are separate rows (the key includes `source_id`) and are never averaged.

## 8. Constraints

Primary keys on every table; foreign keys throughout (composite ones prove district-in-state,
variety-in-commodity, run-in-source, file-in-source, series-in-source); unique natural keys;
`CHECK` constraints for: non-negative prices and arrivals; `min <= modal <= max` between values
that exist; price needs currency and unit; arrival needs unit; at least one measurement; date range
`1990-01-01` to `2100-12-31`; first-of-month periods; positive WPI; coordinates; quality
status/flag consistency; SHA-256 shape; run status/finish-time/counters; no credentials in endpoint
references or error summaries; no paths in file names. Names stay within PostgreSQL's 63 characters
(a test enforces it).

## 9. Index strategy

| Index                                                                                          | Why it exists                                                                      |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `mandi_obs_history_idx (market_id, commodity_id, observed_date)`                               | The main read path: price history of one market for one commodity, ordered by date |
| `mandi_obs_commodity_day_idx (commodity_id, observed_date, market_id)`                         | Cross-market snapshot of one commodity on a day (mandi comparison)                 |
| `mandi_obs_natural_uq`, `*_record_key_uq`                                                      | Duplicate prevention (also serve idempotent upserts)                               |
| `state_obs_history_idx (state_id, commodity_id, observed_date)`, `state_obs_commodity_day_idx` | State series and cross-state snapshots                                             |
| `national_price_series_idx (commodity_id, period_month)`                                       | National monthly series per commodity                                              |
| `wpi_obs_natural_uq (series_id, period_month)`, `wpi_obs_month_idx`                            | A series' history; all series for a month                                          |
| `*_run_idx`, `*_file_idx`                                                                      | Trace facts to their run/file, remove or audit a run                               |
| `markets_state_district_idx`, `markets_normalized_name_idx`                                    | Geography browsing; alias lookups                                                  |
| alias `*_entity_idx`, `*_label_idx`                                                            | Find aliases of an entity; look up by normalised label                             |
| `obs_conflicts_open_idx` (partial, `status = 'open'`)                                          | The review queue stays small and fast                                              |
| `ingestion_runs_source_started_idx`, `ingestion_rejections_run_reason_idx`                     | Run history per source; rejection summaries per run                                |

**No partitioning.** Expected volume is millions of rows (the supplied files total about 2.7
million); the composite b-tree indexes above serve it. Revisit partitioning by `observed_date` only
if measured volumes and retention needs justify it.

## 10. Privilege model

Unchanged role separation (see `README.md`): bootstrap `fasalytics_admin` (administration only),
`fasalytics_migrator` (owns every object, runs migrations), `fasalytics_app` (data access).

- New tables, views and sequences are created by the migrator, so the existing `ALTER DEFAULT
PRIVILEGES` give the application role `SELECT/INSERT/UPDATE/DELETE` on tables and views and
  `USAGE/SELECT` on sequences. It **owns nothing**, so it cannot alter, drop, truncate, comment on,
  or disable triggers on any of them (verified by `npm run db:verify`).
- `measurement_units` is **read-only** for the application role (migration 0002 revokes write
  access without naming the role): a changed conversion factor would silently rescale every derived price.
- `PUBLIC` gets nothing; no migration grants to `PUBLIC` or creates roles (a test enforces it).
- Known limitation: the application role can `UPDATE`/`DELETE` fact and provenance rows. A separate
  ingestion role with insert-only access to facts is a recommended hardening before production.

## 11. Commands

```bash
cd database
npm run db:migrate                 # apply pending migrations (repeatable, advisory-locked)
npm run db:check                   # migration history consistent
npm run db:verify                  # connections, privileges, canonical-schema access (33 checks)
npm test                           # unit tests; integration tests need a migrated database
npm run test:disposable            # everything above against a THROWAWAY container (never your data)
```

`npm run test:disposable` starts a uniquely named `postgres:17-alpine` container on a random
loopback port with random credentials, applies only the Phase 1 baseline, stores a marker row,
upgrades to the current schema, runs `db:check`, the runner again, `db:verify` and the whole suite
with `REQUIRE_DB=1`, and removes the container. It never uses the development container or volume.
`npm test` run against the development database applies pending migrations first (existing
behaviour of the Milestone 8 tests), so prefer `test:disposable` when you want the development
database left untouched.

## 12. Known limitations

- No data and no importers yet; registries are empty until Milestone 2.2.
- Units for datasets A and C are not stated in the files (assumed rupees per quintal from the
  dataset documentation) and must be confirmed and recorded by the importer.
- Dataset A has no market identifier; market identity rests on state + district + name, which
  needs reviewed alias resolution (16 market names occur in more than one place).
- No district-level fact table; no forecast or model tables (by design).
- The application role has write access to facts (see section 10).
- Whether the "change" column of dataset C is an absolute or percentage change is unconfirmed; it is
  stored as `source_reported_change` and must not be used as a feature until defined.

## 13. How Milestone 2.2 will ingest each existing dataset

All four files stay in `data/raw/` (git-ignored, read-only). Each import registers the file
(`source_files` + SHA-256), opens an `ingestion_runs` row, loads valid rows, and quarantines the rest.

| Dataset                                                                            | Target                           | Mapping and rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** `Agriculture_price_dataset.csv` (737,392 rows)                               | `mandi_observations`             | State/District/Market/Commodity/Variety via alias tables scoped to this source. 30 raw state spellings (misspellings, `&` vs `and`, a leading space, an unrecognised `Gao`) become alias rows; unresolved ones quarantine their rows. District and market keys include the parent labels, so the 16 market names that occur in several places stay distinct. `Variety` `Other`/`Local` keep the label and use NULL `variety_id`. `Grade` stored as given. `Min/Max/Modal_Price` in INR per quintal (unit asserted by the importer). Dates are month-first (`M/D/YYYY`). Rows with min > modal or modal > max (about 1,860), and non-positive prices, are quarantined (`price_ordering_violation`/`negative_value`) or flagged if zero. No arrivals. |
| **B** `merged_preprocessed_all_reports.csv` (1,973,777 rows)                       | `state_observations`             | `Date ISO` is the date. Footer text in the `State` column (`Note:`, the weighted-average formula, empty) and the 240 rows with `row_issue` are quarantined (`structural_error`). `Arrival Unit` `Metric Tonnes`/`Nos`/`Bundle` map to `tonne`/`nos`/`bundle`; `Price Unit` `Rs./Quintal`/`Rs./Bundle`/`Rs./Unit` map to INR with `quintal`/`bundle`/`unit`, so count-unit rows never convert to quintals. `Commodity Group` fills `commodity_group`; `report_title` fills `source_report_label`; `source_file` and `source_row_number` fill provenance. The ~19,976 overlapping report rows are exact duplicates (skipped) or conflicts (recorded). State arrivals are never presented as mandi arrivals.                                           |
| **C** `crop_price_dataset.csv` (2,810 rows)                                        | `national_monthly_prices`        | Importer asserts `state_name = India`, `district_name = All`, `calculationType = Monthly`, else quarantines. `month` is the period; `avg_*_price` map to the averages (unit asserted); `change` goes to `source_reported_change`. 16 commodities via aliases. Unusable for daily forecasting; context only.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **D** `Wholesale-Price-Index-from-2012-to-2024.csv` (41 items x 153 month columns) | `wpi_series`, `wpi_observations` | Unpivot the `Month-Year` columns; one series per `Crop` label (original text kept); one observation per series and month. Index values only: never a currency or a price. A series is linked to `commodities` only after review (items such as flour or oil products stay unlinked). The base period is not stated in the file, so `base_description` stays NULL.                                                                                                                                                                                                                                                                                                                                                                                   |

**Recommended Milestone 2.2 order:** (1) authoritative state/UT/district reference load with
reviewed aliases; (2) alias-review tooling and the importer framework (run/file registration,
fingerprints, quarantine, conflicts); (3) datasets D and C (small, prove the framework);
(4) dataset A (mandi prices); (5) dataset B (state arrivals); (6) generated coverage report and
data-quality summary. Nothing is imported until you approve that milestone.
