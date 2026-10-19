# Historical market API (Milestone 2.3A)

Read-only Express endpoints under `/api/v1` that expose the **historical** data imported in Milestone 2.2
(2,698,327 accepted observations). The machine-readable contract is
[express.openapi.json](./express.openapi.json); this page explains the rules behind it.

> **These are historical records, not live data.** Every response carries
> `meta.data_status = "historical_snapshot"` and `meta.is_live = false`. Nothing here is a forecast,
> a prediction or a current market price.

## Real examples versus fixtures

- [`examples/real/`](./examples/real/) holds **real responses** captured from the development database
  (imported records, importer 2.2.1). Each file says so in `_about`, shows the request and the capture time,
  and notes when `data` was shortened. A contract test validates them against the OpenAPI document.
- The route tests in `apps/api/src/routes/market.routes.test.js` use **synthetic fixtures** (IDs such as
  `00000000-0000-4000-8000-...`, source `synthetic_source`). They prove validation, SQL safety and error
  handling and are never shown as data.
- `apps/api/src/integration/market.integration.test.js` checks real numbers against the development database
  and is skipped (and reported as skipped) when the tables are empty.

## Endpoints (all `GET`)

| Path                                | Purpose                                                                                      | Required filters                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/states`                           | States and union territories with source labels and mapping status                           | none                                                            |
| `/districts`                        | Districts (provisional December 2022 reference)                                              | none                                                            |
| `/geography/unresolved`             | Labels that could not be mapped (Gao, 49 district labels) with row counts                    | none                                                            |
| `/commodities`, `/commodities/{id}` | Commodity catalog with observed coverage per granularity                                     | none                                                            |
| `/markets`, `/markets/{id}`         | Market directory with verification and district status                                       | none                                                            |
| `/mandi-prices`                     | **Mandi-level** daily prices                                                                 | `from`, `to` and one of `market_id`, `commodity_id`, `state_id` |
| `/state-prices`                     | **State-level** daily prices and arrivals                                                    | `from`, `to` and one of `state_id`, `commodity_id`              |
| `/national-prices`                  | **National** monthly average prices                                                          | none (`from`/`to` months optional)                              |
| `/wpi/series`, `/wpi/observations`  | Wholesale Price Index **index** series                                                       | `series_id` for observations                                    |
| `/sources`                          | Provenance and freshness: files, SHA-256, load counters, assumptions, date ranges            | none                                                            |
| `/coverage`                         | Counts and date ranges per granularity, registry sizes, geography verification counts, units | none                                                            |

Other methods answer `405`. There is no endpoint for forecasts, live prices or writes.

## Conventions

- **Pagination.** Keyset (cursor) pagination: `limit` (1-500, default 100) and an opaque `cursor`. A response
  has `pagination: { limit, has_more, next_cursor }`; pass `next_cursor` back as `cursor`. Order is a total
  order ending in the row id, so pages never overlap or skip, and page 10,000 costs the same as page 1.
- **Bounded windows.** Daily endpoints require `from` and `to` (YYYY-MM-DD) spanning at most 366 days.
- **Validation.** Unknown or repeated parameters, malformed UUIDs, impossible dates and out-of-range limits
  answer `400 INVALID_PARAMETER`; messages name the parameter, never the submitted value.
- **Errors.** The standard error body. A database that cannot be reached answers `503 DEPENDENCY_UNREACHABLE`,
  a statement timeout `503 DEPENDENCY_TIMEOUT`, anything unexpected a generic `500`. Never SQL, paths or secrets.
- **Safety.** Parameterized queries only; every request runs in `BEGIN READ ONLY ... ROLLBACK` as the
  `fasalytics_app` role, which has `SELECT` only on the canonical tables. Statement timeout comes from
  `DB_QUERY_TIMEOUT_MS` (default 5 s); the cached aggregates below use 20 s.
- **Caching.** `Cache-Control: private, max-age=60`. `/coverage`, `/sources`, `/geography/unresolved` and the
  per-commodity coverage inside `/commodities` are computed once and memoised in the process for 10 minutes
  (the data changes only when an operator runs the importer).
- **Numbers.** Prices and quantities are JSON numbers (the database stores them as exact decimals).

## Data-integrity rules built into the responses

1. **Four granularities, four endpoints.** Mandi-daily, state-daily, national-monthly and WPI rows come from
   separate tables and are never joined or merged. Each row has `granularity`. A missing mandi price is
   **never** filled from a state or national value (a test asks for a mandi window with no data and shows the
   state endpoint has rows for the same period, but the mandi endpoint stays empty).
2. **Units.**
   - Mandi and national prices: INR per quintal is an **assumption**
     (`unit_basis: "assumed_from_documentation"`, `source_price_unit_label: null`); `meta.unit_note` says so.
   - State rows: units are stated per row by the source (`unit_basis: "source_stated"`) and are **mixed**:
     prices in `quintal`, `bundle` or `unit`; arrivals in `tonne`, `bundle` or `nos`, with the original label
     (`source_price_unit_label`, `source_arrival_unit_label`) and `*_unit_dimension` (`mass` or `count`).
     Count units are never converted to mass.
   - National `source_reported_change` is unconfirmed (`source_reported_change_status:
"unconfirmed_not_for_modelling"`).
   - WPI values are dimensionless indices (`value_kind: "index"`): no currency, unit or price field.
3. **Geography is provisional.** The reference is a third-party December 2022 LGD mirror.
   - All **1,610 markets** are `verification_status: "unverified"`.
   - **213 markets** (86,427 observations) have an unresolved district; `district_status: "unresolved"`, with
     the file's own label in `source_district_label`. The **49 unresolved district labels** are listed with
     row counts at `/geography/unresolved`.
   - **Keralam** is mapped to Kerala **provisionally** (`mapping_status: "provisional"` with a note); the source
     label is preserved in `source_labels`.
   - **Gao** stays unresolved: it is absent from `/states` and appears in `/geography/unresolved` (4 quarantined rows).
4. **Provenance on every observation.** `provenance` carries `source_code`, `source_file_id`,
   `ingestion_run_id`, `source_row_number` (the row in the original file), `is_historical_snapshot`,
   `is_synthetic` and `quality_flags`; `/sources` resolves the file (name, SHA-256) and the load counters.

## Examples (real records)

`GET /api/v1/state-prices?state_id=<Kerala id>&from=2025-01-01&to=2025-01-31&limit=2` returns state-level rows
with the original label and the provisional mapping, for example (excerpt of
[state-prices-keralam.json](./examples/real/state-prices-keralam.json)):

```json
{
  "granularity": "state_daily",
  "observed_date": "2025-01-01",
  "state": { "name": "KERALA", "mapping_status": "provisional" },
  "price_unit": "quintal",
  "source_price_unit_label": "Rs./Quintal",
  "arrival_unit": "tonne",
  "source_arrival_unit_label": "Metric Tonnes",
  "unit_basis": "source_stated",
  "source_labels": { "state": "Keralam" }
}
```

`GET /api/v1/mandi-prices?commodity_id=<Wheat id>&from=2023-08-01&to=2023-08-31&limit=2` returns mandi-level
rows with assumed units and the source labels ([mandi-prices.json](./examples/real/mandi-prices.json)). More
real captures: [coverage](./examples/real/coverage.json), [sources](./examples/real/sources.json),
[unresolved geography](./examples/real/geography-unresolved.json),
[market with unresolved district](./examples/real/market-unresolved-district.json),
[national prices](./examples/real/national-prices.json), [WPI](./examples/real/wpi-observations.json),
[states](./examples/real/states-kerala.json), [commodity](./examples/real/commodity-wheat.json).

## Query performance (development database, local, measured)

| Request                                           |                                  p50 |    p95 |
| ------------------------------------------------- | -----------------------------------: | -----: |
| mandi, market + commodity, 366 days               |                                 9 ms |  20 ms |
| mandi, commodity only, 366 days, 500 rows         |                                22 ms |  33 ms |
| mandi, state only, 366 days, 500 rows             |                               115 ms | 127 ms |
| state-level, state + commodity, 366 days          |                                15 ms |  32 ms |
| state-level, state only, 366 days, 500 rows       |                                90 ms | 101 ms |
| state-level, commodity only, 366 days, 500 rows   |                                18 ms |  19 ms |
| national, all rows (500)                          |                                20 ms |  37 ms |
| markets list (100)                                |                                 8 ms |  32 ms |
| cached aggregates (coverage, sources, unresolved) |                                 1 ms |  16 ms |
| cached aggregates, first (cold) call              |                            0.1-1.4 s |        |
| 40 consecutive pages of 500 state rows            | first 102 ms, last 47 ms, max 131 ms |        |

Query plans (`EXPLAIN (ANALYZE, BUFFERS)`): state-level queries use `state_obs_history_idx` or
`state_obs_commodity_day_idx` (a bitmap or index scan; 0.8-15 ms inside PostgreSQL). Mandi queries with a
market or commodity use `mandi_obs_history_idx` / `mandi_obs_commodity_day_idx`. A mandi query filtered **only
by state** has no matching index (the state lives on `markets`), so PostgreSQL scans `mandi_observations` in
parallel (about 57 ms for the 735k-row table). That is acceptable at this size, so **no index or migration was
added**; see the recommendation in the milestone report.

## Known limitations

- Historical only; the latest mandi date is 2025-06-11 and the latest state date 2026-07-02.
- Geography and market identities are provisional/unverified (above); nothing is verified or live.
- `/commodities` lists commodities by exact source label (for example `Barley (Jau)` and `Barley(Jau)` are
  separate rows); no fuzzy merging.
- Aggregates are cached for 10 minutes in each API process.
- Not wired to the React frontend yet.
