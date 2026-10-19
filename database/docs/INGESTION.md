# Historical data ingestion (Phase 2, Milestone 2.2)

> **Status.** The pipeline, registry loader, reports and tests are implemented and were exercised on
> the four real datasets **in disposable PostgreSQL containers only**. Nothing has been imported into
> the development database; that needs the project owner's explicit approval. The geographic reference
> is **provisional** (a December 2022 mirror of the Local Government Directory), not a verified current
> registry. Imported records are **historical**, never current prices, and historical coverage is not
> proven forecast eligibility.

## 1. What runs where

| Piece                                                                                               | Location                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| CLI                                                                                                 | `database/src/ingest/cli.js` (`npm run ingest -- <command>`)        |
| Common framework (file fingerprint, streaming, batches, idempotency, conflicts, quarantine, resume) | `src/ingest/framework.js`, `persist.js`, `csv.js`, `util.js`        |
| Identity resolution                                                                                 | `src/ingest/resolver.js`                                            |
| Dataset adapters (D, C, A, B)                                                                       | `src/ingest/adapters/`                                              |
| Registry reference loading                                                                          | `src/ingest/registry/` and `database/reference/`                    |
| Reports                                                                                             | `src/ingest/report.js`, output in `database/reports/milestone-2.2/` |
| Ingestion role grants                                                                               | `src/ingest/privileges.js`, `npm run db:grant-ingest`               |

## 2. Commands

All commands are dry runs unless `--write` is given.

```bash
cd database
npm run ingest -- registry:validate                       # verify the reference set and alias decisions
npm run ingest -- profile --dataset all                   # dry run: parse, validate, resolve, count (no database)
npm run ingest -- registry:load                           # dry run
DATABASE_INGEST_URL=... npm run ingest -- registry:load --write --yes
DATABASE_INGEST_URL=... npm run ingest -- import --dataset D,C,A,B --write --yes
DATABASE_INGEST_URL=... npm run ingest -- import --dataset A --write --yes --resume   # continue an interrupted run
DATABASE_INGEST_URL=... npm run ingest -- report          # quality and alias reports (read-only)
```

Options: `--dataset D|C|A|B|all` (comma list allowed), `--file`, `--data-dir`, `--reference <dir>`,
`--batch-size N` (default 2000), `--limit N` (first N records, for profiling), `--json`,
`--url-env NAME` (which environment variable holds the target URL; default `DATABASE_INGEST_URL`).

**Safety.** The target comes only from an environment variable, never the command line. Before a write
the CLI prints a credential-free summary (host, port, database, role, dataset, operation) and requires
`--yes` (or typing the database name). It **refuses to write to the development database host and port**
unless `--allow-development-target` is passed, which needs the project owner's approval. Files in
`data/raw/` are opened read-only and are never modified (a test checks their SHA-256 before and after).

## 3. Pipeline and guarantees

1. **Fingerprint** the file (SHA-256, streamed) and register source, assumptions and file idempotently.
2. **Stream** the CSV in bounded memory (one chunk and one record at a time; batches default to 2,000).
3. **Adapter** validates and normalises each record; **resolver** maps labels to registry identities.
4. **One transaction per batch** inserts new registry/alias rows, the facts, conflicts and rejections, and
   updates the run counters and the resume checkpoint together. Any error rolls the whole batch back and
   the run is marked `failed` (sanitised message). A simulated process death leaves the run `running`,
   never `succeeded`.
5. **Run summary** counts every input record into exactly one outcome and checks that they add up.

| Outcome         | Meaning                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted        | stored as a new observation                                                                                                                    |
| Exact duplicate | natural key exists with the same fingerprint: skipped (`ON CONFLICT DO NOTHING`)                                                               |
| Conflict        | natural key exists with a different fingerprint: existing row kept, incoming values stored in `observation_conflicts` once                     |
| Quarantined     | stored raw in `ingestion_rejections` with a reason code (invalid value, bad date, ordering, unit, structure, unresolved or ambiguous identity) |

Resume creates a new run (`resumed_from_run_id`) that skips records up to the last committed checkpoint.
A per-source advisory lock prevents two imports of one source at once.

## 4. Source-to-table mapping

| Dataset                                         | Table(s)                         | Natural key                                | Units                                                                   |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| D `Wholesale-Price-Index-from-2012-to-2024.csv` | `wpi_series`, `wpi_observations` | series + month                             | none (index numbers; never a price)                                     |
| C `crop_price_dataset.csv`                      | `national_monthly_prices`        | commodity + month                          | INR per quintal **assumed** (`unit_basis = assumed_from_documentation`) |
| A `Agriculture_price_dataset.csv`               | `mandi_observations`             | market + commodity + variety + grade + day | INR per quintal **assumed**                                             |
| B `merged_preprocessed_all_reports.csv`         | `state_observations`             | state + commodity + day                    | **stated per row**: tonne/nos/bundle, INR per quintal/bundle/unit       |

Assumptions are rows in `source_assumptions` (statement and evidence). For A and C the file states no
unit; the statement and its evidence (`DATASET_COVERAGE.md` and the Milestone 2.2 instruction) are stored,
and every row says `assumed_from_documentation` with no source unit label. Count units (bundle, nos, unit)
are never converted to mass; the normalised views return NULL for them. The meaning of dataset C's
`change` column stays unconfirmed (stored as `source_reported_change`, not for modelling).

## 5. Identity resolution

- **States/UTs and districts** come from the reference set in `database/reference/lgd/`
  (see `manifest.json`: source URL, retrieval time 2026-10-18T15:19:39Z, SHA-256, GODL-India licence,
  reference date 2022-12, status `provisional-historical`). Loading is itself an ingestion run, so every
  registry row records the run and file that introduced it. A newer or official export is added as another
  reference-set directory and loaded with `--reference`; existing rows keep their provenance, new codes are
  added, and any name that differs is quarantined (`ambiguous_entity`), never overwritten.
- **Resolution** is by reviewed decision (`reference/aliases/*.csv`, version-controlled, each with a note)
  or an exact case/whitespace-insensitive match. There is **no fuzzy matching**. States that do not
  resolve (for example `Gao`) are quarantined; districts resolve only inside their resolved state.
- **Mandis** have no authoritative list. A mandi is created from its source labels as `unverified`. When
  its district is unresolved, the source district label is part of its identity
  (`disambiguator = src-district:<label>`), so same-named mandis in different places never merge and no
  district is invented.
- **Commodities** are created per exact normalised label; labels that differ by punctuation stay separate
  (reported as possible duplicates). **Varieties:** `Other` and blank become NULL (label kept); `Local` is a
  real variety (treating it as unspecified collided with `Other` and produced 181 false conflicts, now fixed).
- The alias-resolution report (`reports/milestone-2.2/alias-resolution-report.md`) lists every state label
  that needs review, every unresolved district, mandi identities and possible duplicate commodity labels.

## 6. Roles and permissions

| Role                           | Canonical tables                                                                                | Notes                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `fasalytics_app` (Express API) | **SELECT only** (migration 0004 removes INSERT/UPDATE/DELETE); DML remains on `system_metadata` | The API reads agricultural data; it never writes it                                                                                  |
| `fasalytics_ingest` (importer) | `SELECT`, `INSERT`; `UPDATE` only on run-progress columns of `ingestion_runs`; sequence use     | No `DELETE`, `TRUNCATE`, DDL, ownership, or write access to `measurement_units`/`system_metadata`; cannot read the migration journal |
| `fasalytics_migrator`          | owner                                                                                           | DDL and migrations; also runs the grant script and can review/resolve aliases and conflicts                                          |
| `fasalytics_admin`             | bootstrap superuser                                                                             | administration only                                                                                                                  |

Idempotency and conflict handling need only `INSERT ... ON CONFLICT DO NOTHING` and `INSERT` into
`observation_conflicts`, so the ingestion role never needs `UPDATE` or `DELETE` on data. Resolving an alias
or a conflict is a reviewed action by a different role.

Creating the login role needs `CREATEROLE`. New volumes get it from the init script when
`DB_INGEST_USER`/`DB_INGEST_PASSWORD` are set. For an **existing** database an administrator creates the role
once (not done on the development database):

```sql
CREATE ROLE fasalytics_ingest LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE fasalytics TO fasalytics_ingest;
```

then the migrator runs `npm run db:grant-ingest` after the migrations. `npm run db:verify` checks both roles
(65 checks in a disposable database). Credentials are never printed or stored in code.

## 7. Verified results (disposable database, real files)

Recorded from the final run on a fresh PostgreSQL 17 container with migrations 0000-0004, the LGD reference
loaded (36 states/UTs, 763 districts), and the ingestion role. Dataset A was deliberately interrupted at
300,000 rows and resumed.

| Dataset | Input records |  Accepted | Exact duplicates | Conflicts | Quarantined                                           |
| ------- | ------------: | --------: | ---------------: | --------: | ----------------------------------------------------- |
| D       |         6,273 |     6,273 |                0 |         0 | 0                                                     |
| C       |         2,810 |     2,800 |                0 |         0 | 10 (price ordering)                                   |
| A       |       737,392 |   735,461 |                0 |         0 | 1,931 (1,248 price ordering, 679 zero price, 4 `Gao`) |
| B       |     1,973,777 | 1,953,793 |           19,739 |         4 | 241 (240 footer or broken rows, 1 zero modal price)   |

Total accepted observations: **2,698,327**; every input record is accounted for. Repeating all four imports
accepted 0 new rows (D 6,273, C 2,800, A 735,461 and B 1,973,532 exact duplicates; the same 4 conflicts were
not re-recorded; quarantined rows were re-quarantined in their new run). The dry run (no database) predicted
exactly the same accepted and quarantined counts.

Coverage highlights (details in the reports): dataset A has 1,610 mandis in 25 resolved states; 213 mandis
(86,427 observations, 11.7 %) have a district absent from the 2022 reference and are kept under their source
district label. Dataset B has 32 resolved states and 432 commodities. The four conflicts in B are genuine
disagreements between overlapping reports (one has a modal price of 133,100); they are kept, the existing
value is untouched.

### Performance (this machine, one Docker PostgreSQL, batch 2,000; measured, not a promise)

| Run                            |        Duration |            Rows/s |      Peak RSS |  Database growth |
| ------------------------------ | --------------: | ----------------: | ------------: | ---------------: |
| D                              |           0.6 s |           ~10,600 |        77 MiB |          3.7 MiB |
| C                              |           0.4 s |            ~7,600 |        97 MiB |          2.2 MiB |
| A (full, earlier run)          |          99.6 s |            ~7,400 |       231 MiB |          694 MiB |
| A (resumed part, 437,392 rows) |          59.3 s |            ~7,400 |       217 MiB |          419 MiB |
| B                              |           232 s |            ~8,500 |       278 MiB |        1,944 MiB |
| Repeat A / B (all duplicates)  |    53 s / 141 s | ~13,800 / ~14,000 | 252 / 292 MiB | ~1 MiB / 0.2 MiB |
| Dry run A / B (no database)    | 10.6 s / 25.8 s | ~70,000 / ~76,000 | 245 / 331 MiB |              n/a |

The resulting database was about 2.6 GB. Memory did not grow with file size.

### Skipped tests in the disposable run (14 of 320)

| Tests                                                                  | File                                       | Why skipped                                                                                     | Needs                                                                           | Expected? | Run separately?                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| 11 "fresh database: Phase 1 baseline upgraded to the canonical schema" | `src/migrations.fresh.integration.test.js` | They assert a database holding only migration 0000; by the full-suite step it is fully migrated | `FRESH_DB_BASELINE=1` (set by the harness for the earlier "fresh upgrade" step) | Yes       | Already run, and passing, in that earlier step of `npm run test:disposable`                             |
| 3 "persistence (disruptive)"                                           | `src/persistence.integration.test.js`      | They restart and recreate the development `db` container                                        | `DB_TEST_RESTART=1` plus a verified disposable target                           | Yes       | No: unsafe here (they target the compose stack). A disposable-container variant is a Milestone 2.3 task |

The API suite also skips one test (database outage and recovery, `DB_TEST_RESTART=1`) because it stops the
development `db` container.

### Corrective verification (2026-10-19)

- **Zero prices are quarantined.** The first run flagged and stored zero prices (the schema allows them only
  when flagged). The Milestone 2.2 rule is that non-positive prices are quarantined, so importer 2.2.1
  rejects any zero price (reason `invalid_value`, detail "price is zero") for A, B and C. This moved 67 rows
  of A and 1 row of B from accepted to quarantined; the figures above are after that change.
- **Independent reconciliation.** The expected counts were recomputed straight from the raw files with
  separate code (Python, no importer code), and 82 SQL checks were run against the disposable database: every
  row has exactly one outcome, record keys and source row numbers are unique, every accepted row carries
  source file, run, record key, fingerprint and row number, no row is both accepted and quarantined, every
  quarantined row keeps its raw record and hash, conflicts point at an existing stored row with a different
  fingerprint (stored value untouched), repeat imports added no observation, no mandi/state/national
  boundary is crossed, A and C are stored as assumed INR/quintal, B keeps its stated units, WPI has no price
  column, and no stored price is zero or negative. All dataset A and B interruptions (A at 300,000 rows, B
  at 800,000) resumed to the same totals.
- **Stale runs.** A run whose process died stays "running"; a new import of the same source (not only
  `--resume`) now closes it as failed ("interrupted; the process ended before the run completed").

## 8. Known limitations and risks

- The reference is provisional (December 2022): 49 district labels in dataset A are unresolved (for example
  districts that dataset A files under the state label `Andhra Pradesh` but that are not in Andhra Pradesh's 2022
  list, and districts created after 2022). None of them is guessed.
- `Gao` is unresolved on purpose (not assumed to be Goa). The state alias decisions (renames, misspellings,
  `Keralam`) are proposals pending the owner's review.
- Mandis are `unverified` and keyed by source labels; re-keying them once districts are authoritatively
  resolved is a Milestone 2.3 task.
- Units for A and C are assumed; `change` in C is unconfirmed; B's arrival magnitudes need a sanity check.
- Quarantined rows are recorded again by every later run of the same file (observations are not).
- The application role's loss of write access is applied by migration 0004: applying it to the development
  database is part of the approval for importing there.

## 9. API boundaries for the frontend (not built)

The React Dashboard, Market Explorer and Commodities pages must keep showing "unavailable" until Express
exposes read-only endpoints over this data. Required next (PROJECT.md section 5.5 names), all behind the
application role (read-only), all returning provenance and freshness (`observed_date`, source, granularity,
unit basis, "historical snapshot"):

- `GET /api/v1/commodities` (+ capability tier later) for the Commodities page and pickers;
- `GET /api/v1/states`, `/districts`, `/markets` (with `status: unverified` and district resolution state)
  for the Market Explorer;
- `GET /api/v1/prices` (mandi series, with the unit assumption flagged) and a separate state-level series
  endpoint, never merged;
- coverage and freshness metadata for the Dashboard data-feed chip.

## 10. Recommended Milestone 2.3

1. Owner review of the state alias decisions and the unresolved district list; supply an official LGD
   export (captcha download) to replace or supplement the 2022 mirror.
2. Re-key mandis after district resolution; link WPI items to commodities by reviewed decision.
3. Read-only Express endpoints and the first real Dashboard/Explorer data wiring.
4. Approval-gated import into the development database (apply migrations 0003-0004, create the ingestion
   role, `registry:load`, then `import`).
