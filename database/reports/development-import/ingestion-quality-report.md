# Ingestion quality and coverage report

> Generated 2026-10-19T17:23:46.079Z. Historical records only: nothing here is a current market price, and historical coverage is not proven forecast eligibility (that needs backtesting, Phase 3).

> Mandi-level (dataset A) and state-level (dataset B) coverage are reported separately and are not comparable or additive.

## Geographic reference (provisional)

PROVISIONAL: a third-party mirror of LGD as of December 2022. It is not a verified current registry; post-2022 districts stay unresolved.

Reference set `lgd-github-mirror-2022-12`, status **provisional-historical**, reference date 2022-12, licence Government Open Data License - India (GODL-India), retrieved 2026-10-18T15:19:39Z.

Registry now holds 36 states/UTs and 763 districts.

## Reconciliation of every input row

| Dataset | Status                                             | Input rows | Accepted  | Exact duplicates skipped | Conflicts retained | Quarantined | Reconciled |
| ------- | -------------------------------------------------- | ---------- | --------- | ------------------------ | ------------------ | ----------- | ---------- |
| D       | initial load (1 run), 1 later idempotent re-run(s) | 6,273      | 6,273     | 0                        | 0                  | 0           | yes        |
| C       | initial load (1 run), 1 later idempotent re-run(s) | 2,810      | 2,800     | 0                        | 0                  | 10          | yes        |
| A       | initial load (1 run), 1 later idempotent re-run(s) | 737,392    | 735,461   | 0                        | 0                  | 1,931       | yes        |
| B       | initial load (1 run), 1 later idempotent re-run(s) | 1,973,777  | 1,953,793 | 19,739                   | 4                  | 241         | yes        |

Input rows = accepted + exact duplicates + conflicts + quarantined, for the initial load of each file (an interrupted run and its resume count as one load). Later runs of the same file are idempotent re-imports and appear in each dataset's run table. Dataset D counts one record per month cell.

## Dataset D: Wholesale Price Index (national, monthly)

Granularity: national WPI index x month (index numbers, not prices)

**Loaded**

| Measure        | Value                 |
| -------------- | --------------------- |
| observations   | 6,273                 |
| firstMonth     | 2012-04-01            |
| lastMonth      | 2024-12-01            |
| distinctSeries | 41                    |
| geography      | India (national) only |

**Quarantined by reason**

| Reason | Rows |
| ------ | ---- |

**Missing values**

| Field | Count                                         |
| ----- | --------------------------------------------- |
| note  | a month with no value is absent, never filled |

**Coverage gaps**: 0 series with missing months inside their range.

**Known source limitations**

- Index numbers, not prices. The index base period is not stated in the file (left NULL).
- Items are not linked to the commodity registry (a reviewed, separate step).
- National monthly series: context only, not for daily forecasting.

**Runs**

| Run      | Status    | Input | Accepted | Duplicates | Conflicts | Quarantined | Resumed from |
| -------- | --------- | ----- | -------- | ---------- | --------- | ----------- | ------------ |
| 9c437439 | succeeded | 6,273 | 6,273    | 0          | 0         | 0           | -            |
| 693cd2c3 | succeeded | 6,273 | 0        | 6,273      | 0         | 0           | -            |

## Dataset C: national monthly commodity prices

Granularity: India x commodity x month (monthly averages)

**Loaded**

| Measure             | Value                 |
| ------------------- | --------------------- |
| observations        | 2,800                 |
| firstMonth          | 2010-01-01            |
| lastMonth           | 2025-03-01            |
| distinctCommodities | 16                    |
| geography           | India (national) only |

**Quarantined by reason**

| Reason                   | Rows |
| ------------------------ | ---- |
| price_ordering_violation | 10   |

**Most common quarantine details**

| Reason                   | Detail                                     | Rows |
| ------------------------ | ------------------------------------------ | ---- |
| price_ordering_violation | min, modal and max prices are not in order | 10   |

**Missing values**

| Field                       | Count |
| --------------------------- | ----- |
| sourceReportedChangeMissing | 15    |

**Quality flags**

Flagged rows: 0. no flag counts.

**Unit and source assumptions**

- `change_column_meaning_unconfirmed`: The meaning of the "change" column (absolute or percentage, and its base) is unconfirmed. It is stored as reported and must not be used for modelling. Evidence: docs/data-sources/DATASET_COVERAGE.md; database/docs/CANONICAL_SCHEMA.md section 12.
- `price_unit_inr_per_quintal`: The file states no price unit or currency. Prices are taken as Indian rupees (INR) per quintal. This is an assumption, not a fact stated by the source. Evidence: docs/data-sources/DATASET_COVERAGE.md (dataset C description) and the project owner's Milestone 2.2 instruction; not stated in the source file.

**Coverage gaps**: 6 series with missing months inside their range (full list in the JSON report).

**Known source limitations**

- The price unit is not stated: INR per quintal is an assumption.
- The meaning of the "change" column is unconfirmed; it is stored as reported and must not be used for modelling.
- National monthly averages: unusable for daily mandi forecasting.

**Runs**

| Run      | Status                    | Input | Accepted | Duplicates | Conflicts | Quarantined | Resumed from |
| -------- | ------------------------- | ----- | -------- | ---------- | --------- | ----------- | ------------ |
| be7a7551 | succeeded_with_rejections | 2,810 | 2,800    | 0          | 0         | 10          | -            |
| abbc698d | succeeded_with_rejections | 2,810 | 0        | 2,800      | 0         | 10          | -            |

## Dataset A: mandi-level daily prices

Granularity: market x commodity x variety x grade x day (prices; no arrivals)

**Loaded**

| Measure                            | Value      |
| ---------------------------------- | ---------- |
| observations                       | 735,461    |
| firstDate                          | 2023-06-06 |
| lastDate                           | 2025-06-11 |
| distinctObservationDays            | 737        |
| distinctResolvedStates             | 25         |
| distinctResolvedDistricts          | 325        |
| distinctSourceStateLabels          | 28         |
| distinctSourceDistrictLabels       | 372        |
| distinctMandis                     | 1,610      |
| distinctCommodities                | 5          |
| distinctVarieties                  | 107        |
| observationsWithUnresolvedDistrict | 86,427     |

**Quarantined by reason**

| Reason                   | Rows  |
| ------------------------ | ----- |
| price_ordering_violation | 1,248 |
| invalid_value            | 679   |
| unmapped_entity          | 4     |

**Most common quarantine details**

| Reason                   | Detail                                                    | Rows  |
| ------------------------ | --------------------------------------------------------- | ----- |
| price_ordering_violation | min, modal and max prices are not in order                | 1,248 |
| invalid_value            | max price is zero (non-positive prices are quarantined)   | 564   |
| invalid_value            | min price is zero (non-positive prices are quarantined)   | 114   |
| unmapped_entity          | state=Gao                                                 | 4     |
| invalid_value            | modal price is zero (non-positive prices are quarantined) | 1     |

**Missing values**

| Field              | Count                         |
| ------------------ | ----------------------------- |
| varietyUnspecified | 225,917                       |
| gradeMissing       | 0                             |
| minPriceMissing    | 0                             |
| maxPriceMissing    | 0                             |
| modalPriceMissing  | 0                             |
| arrivals           | never provided by this source |

**Quality flags**

Flagged rows: 0. no flag counts.

Unit basis: 735,461 rows use an assumed unit, 0 a source-stated unit.

**Unit and source assumptions**

- `price_date_month_first`: Price Date is read as month/day/year (M/D/YYYY). Evidence: docs/data-sources/DATASET_COVERAGE.md section 2 (440,211 rows have a second field above 12; none have a first field above 12).
- `price_unit_inr_per_quintal`: The file states no price unit or currency. Prices are taken as Indian rupees (INR) per quintal. This is an assumption, not a fact stated by the source. Evidence: docs/data-sources/DATASET_COVERAGE.md (section 1: dataset A prices in rupees per quintal) and the project owner's Milestone 2.2 instruction; not stated in the source file.

**Per-commodity windows (top 25 by rows)**

| Commodity | Observations | First      | Last       | Days with data |
| --------- | ------------ | ---------- | ---------- | -------------- |
| Potato    | 326,924      | 2023-06-06 | 2025-06-11 | 737            |
| Onion     | 297,894      | 2023-06-06 | 2025-06-11 | 647            |
| Wheat     | 76,289       | 2023-06-06 | 2024-02-06 | 246            |
| Tomato    | 26,573       | 2023-06-06 | 2023-11-06 | 154            |
| Rice      | 7,781        | 2025-04-06 | 2025-06-06 | 62             |

**Longest gaps (no observation on any commodity)**

| From | To  | Days |
| ---- | --- | ---- |

**Known source limitations**

- No arrivals and no market identifiers in the source; markets are identified by source labels and created as unverified.
- The price unit is not stated: INR per quintal is an assumption (see unit assumptions).
- Markets whose district is unresolved are identified by the source district label; they are not merged with any other market.
- Commodity coverage is uneven in time (per-commodity windows below); gaps are real absences and are never filled.

**Runs**

| Run      | Status                    | Input   | Accepted | Duplicates | Conflicts | Quarantined | Resumed from |
| -------- | ------------------------- | ------- | -------- | ---------- | --------- | ----------- | ------------ |
| 905a9358 | succeeded_with_rejections | 737,392 | 735,461  | 0          | 0         | 1,931       | -            |
| 966f5bf6 | succeeded_with_rejections | 737,392 | 0        | 735,461    | 0         | 1,931       | -            |

## Dataset B: state-level daily prices and arrivals

Granularity: state x commodity x day (state totals, never mandi figures)

**Loaded**

| Measure                 | Value                        |
| ----------------------- | ---------------------------- |
| observations            | 1,953,793                    |
| firstDate               | 2022-01-01                   |
| lastDate                | 2026-07-02                   |
| distinctObservationDays | 1,644                        |
| distinctResolvedStates  | 32                           |
| distinctCommodities     | 432                          |
| distinctDistricts       | not applicable (state-level) |
| distinctMandis          | not applicable (state-level) |

**Quarantined by reason**

| Reason           | Rows |
| ---------------- | ---- |
| structural_error | 240  |
| invalid_value    | 1    |

**Most common quarantine details**

| Reason           | Detail                                                    | Rows |
| ---------------- | --------------------------------------------------------- | ---- |
| structural_error | source row_issue: expected 8 columns, found 1             | 120  |
| structural_error | source row_issue: expected 8 columns, found 0             | 120  |
| invalid_value    | Modal Price is zero (non-positive prices are quarantined) | 1    |

**Missing values**

| Field             | Count |
| ----------------- | ----- |
| arrivalMissing    | 0     |
| modalPriceMissing | 0     |

**Quality flags**

Flagged rows: 156. zero_arrival: 156

**Unit mix**

| Price unit | Arrival unit | Rows      |
| ---------- | ------------ | --------- |
| quintal    | tonne        | 1,876,562 |
| unit       | nos          | 42,040    |
| bundle     | bundle       | 35,191    |

Mass units (tonne) and count units (nos, bundle) are kept apart; counts are never converted to tonnes.

**Unit and source assumptions**

- `state_arrivals_are_not_mandi_arrivals`: Arrival quantities are state-level totals as reported. They are never attributed to any market. Evidence: docs/data-sources/DATASET_COVERAGE.md section 1 (dataset B is state level).

**Per-commodity windows (top 25 by rows)**

| Commodity             | Observations | First      | Last       | Days with data |
| --------------------- | ------------ | ---------- | ---------- | -------------- |
| Potato                | 35,271       | 2022-01-01 | 2026-07-02 | 1,521          |
| Onion                 | 33,988       | 2022-01-01 | 2026-07-02 | 1,521          |
| Green Chilli          | 33,198       | 2022-01-01 | 2026-07-02 | 1,521          |
| Tomato                | 32,622       | 2022-01-01 | 2026-07-02 | 1,521          |
| Banana                | 31,952       | 2022-01-01 | 2026-07-02 | 1,644          |
| Brinjal               | 31,832       | 2022-01-01 | 2026-07-02 | 1,521          |
| Cabbage               | 31,601       | 2022-01-01 | 2026-07-02 | 1,521          |
| Cauliflower           | 30,879       | 2022-01-01 | 2026-07-02 | 1,521          |
| Cucumbar(Kheera)      | 29,840       | 2022-01-01 | 2026-07-02 | 1,521          |
| Bitter gourd          | 29,500       | 2022-01-01 | 2026-07-02 | 1,521          |
| Pumpkin               | 29,089       | 2022-01-01 | 2026-07-02 | 1,521          |
| Bottle gourd          | 28,952       | 2022-01-01 | 2026-07-02 | 1,521          |
| Bhindi(Ladies Finger) | 28,657       | 2022-01-01 | 2026-07-02 | 1,521          |
| Carrot                | 27,763       | 2022-01-01 | 2026-07-02 | 1,521          |
| Apple                 | 27,251       | 2022-01-01 | 2026-07-02 | 1,644          |
| Ginger(Green)         | 27,186       | 2022-01-01 | 2026-07-02 | 1,521          |
| Paddy(Common)         | 25,987       | 2022-01-01 | 2026-07-02 | 1,644          |
| Raddish               | 25,862       | 2022-01-01 | 2026-07-02 | 1,521          |
| Capsicum              | 24,516       | 2022-01-01 | 2026-07-02 | 1,521          |
| Garlic                | 24,081       | 2022-01-01 | 2026-07-02 | 1,521          |
| Papaya                | 23,948       | 2022-01-01 | 2026-07-02 | 1,644          |
| Mousambi(Sweet Lime)  | 23,049       | 2022-01-01 | 2026-07-02 | 1,644          |
| Pomegranate           | 22,588       | 2022-01-01 | 2026-07-02 | 1,644          |
| Lemon                 | 21,288       | 2022-01-01 | 2026-07-02 | 1,521          |
| Ridgeguard(Tori)      | 20,810       | 2022-01-01 | 2026-07-02 | 1,521          |

**Longest gaps (no observation on any commodity)**

| From | To  | Days |
| ---- | --- | ---- |

**Known source limitations**

- State-level only: arrivals cannot be attributed to a mandi.
- Units are mixed (tonnes, bundles, pieces); counts are not converted to mass.
- Overlapping report files repeat the same state/commodity/day; exact repeats are skipped and differing repeats are kept as conflicts for review.
- Footer text and structurally broken source rows are quarantined, not repaired.

**Runs**

| Run      | Status                    | Input     | Accepted  | Duplicates | Conflicts | Quarantined | Resumed from |
| -------- | ------------------------- | --------- | --------- | ---------- | --------- | ----------- | ------------ |
| 583a8bfc | succeeded_with_rejections | 1,973,777 | 1,953,793 | 19,739     | 4         | 241         | -            |
| 8c6c8c29 | succeeded_with_rejections | 1,973,777 | 0         | 1,973,532  | 4         | 241         | -            |
