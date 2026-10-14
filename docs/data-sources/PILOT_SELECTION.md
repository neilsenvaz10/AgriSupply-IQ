# FASALYTICS — Pilot Crop & Mandi Selection

> **Status:** Milestone 2 analysis of the four historical datasets supplied by the team.
> **Analysed:** 14 October 2026 (read-only; originals unmodified).
> **Nature of the data:** every figure below is a **historical observation**, not a live or current market price.
> Nothing here is a forecast, and no gaps were filled or invented.

---

## 1. Datasets analysed

SHA-256 prefixes were recorded so later steps can prove the originals were not modified.

| # | File | Size | SHA-256 (first 16) |
|---|---|---|---|
| A | `Agriculture_price_dataset.csv` | 52.6 MB | `156D7F6357E7B90C` |
| B | `merged_preprocessed_all_reports.csv` | 473 MB | `899803AC0592CFBE` |
| C | `crop_price_dataset.csv` | 0.19 MB | `7AB839FEAAFAE49B` |
| D | `Wholesale-Price-Index-from-2012-to-2024.csv` | 0.06 MB | `7A91DCABCAF2398A` |

### Comparison

| | **A – market price rows** | **B – merged arrival reports** | **C – monthly crop prices** | **D – Wholesale Price Index** |
|---|---|---|---|---|
| Granularity | **Mandi × commodity × variety × grade × day** | **State × commodity × day** | National monthly average | National monthly index |
| Geography | 30 states, 1,598 markets | 34 states, no market column | India only | India only |
| Period | 2023-06-06 → 2025-06-11 | 2022-01-01 → 2026-07-02 | 2010-01 → 2025-03 | 2012 → 2024 |
| Min / Max / Modal price | ✅ all three (₹/quintal) | Modal only (₹/quintal) | Monthly averages | Index values, no ₹ |
| **Arrival quantity** | ❌ none | ✅ tonnes (≈100% populated) | ❌ | ❌ |
| Commodities | 5 (Potato, Onion, Wheat, Tomato, Rice) | 433 | 16 (no vegetables) | 41 |
| Rows | 737,392 | 1,973,777 | 2,810 | 41 crops × 154 cols |
| Nulls | 0 | ~0.01% | ~0.6% (`change`) | 0 |
| Fit for 1–7-day mandi forecasting | **Yes (price)** | **State level only** | No (monthly) | No (monthly index) |
| Best role | Mandi comparison, price model | Arrivals / supply-pressure, state price | Long-run context | Macro context only |

**Verdict per dataset**
- **A** is the only source with mandi-level prices, so it must drive mandi comparison. It has no arrivals.
- **B** is the only source with arrivals, but it is **state-level**: it cannot say how much arrived at Pune or Nashik specifically.
- **C and D** are national monthly series. They are unusable for 1–7-day forecasting and are excluded from the pilot (possible context charts later).

---

## 2. Data-quality findings

### Dataset A (mandi-level)

| Check | Result |
|---|---|
| Dates | Stored `M/D/YYYY`. Verified month-first (440,211 rows have a second field >12, none have a first field >12; file is chronological). 737 distinct dates, 0 unparsed. |
| Duplicates (market, commodity, variety, grade, date) | 0 |
| Price anomalies (all 30 states) | 3 modal ≤ 0; 1,860 rows with min > modal or modal > max; 611 max ≤ 0 |
| Anomalies in the pilot markets below | **0%** flagged |
| Multiple rows per market-day | Yes (varieties/grades): Onion averages 1.09 rows per market-day, max 3. A canonical rule (e.g. FAQ grade, median across varieties) must be defined in Phase 2. |
| Market naming | Several yards per city (`Pune`, `Pune(Manjri)`, `Pune(Moshi)`, `Pune(Khadiki)`, `Pune(Pimpri)`; three `Lasalgaon*` entries). Needs a canonical market registry and alias table. |
| Commodity coverage is **uneven in time** | See table below. |

**Active Maharashtra reporting days per commodity (Dataset A):**

| Commodity | Observation window | Days present | Notable gaps |
|---|---|---|---|
| Potato | 2023-06-06 → 2025-06-11 | 727 | none longer than 7 days |
| Onion | 2023-06-06 → 2025-06-11 | 639 | **30 days** (2024-06-06 → 2024-07-06) and **62 days** (2024-12-06 → 2025-02-06) |
| Tomato | 2023-06-06 → **2023-11-06** | 140 | stops after Nov 2023 |
| Wheat | 2023-06-06 → **2024-02-06** | ~245 | stops after Feb 2024 |
| Rice | **2025-04-06** → 2025-06-11 | ~60 | only starts in Apr 2025 |

The dataset appears to be a collection of per-commodity exports with different windows, **not** a uniform daily panel. The gaps are real absences in the file, not parsing errors. They must not be filled with invented prices.

### Dataset B (state-level with arrivals)

| Check | Result |
|---|---|
| Rows with structural problems | 240 (`row_issue`: expected 8 columns, found 0 or 1); to be quarantined in Phase 2 |
| Report overlap | 19,976 duplicate (state, commodity, date) rows across all states; **0** for Maharashtra Onion/Potato/Tomato |
| Units | Metric tonnes and ₹/quintal for these three crops. Other rows use `Nos` / `Bundle` / ₹ per unit (must not be mixed) |
| Maharashtra Onion | 1,514 of 1,644 days (92.1%), 2022-01-01 → 2026-07-02 |
| Maharashtra Potato | 1,511 days (91.9%) |
| Maharashtra Tomato | 1,512 days (92.0%) |
| **One shared gap** | **2025-04-30 → 2025-09-01 (124 days)** is missing for all three crops |
| Arrival values | Onion median ≈ 20,970 t/day (ranges 23 → 80,038 t); Potato median ≈ 2,258 t. Confirmed non-null, but the magnitude of state-level totals must be sanity-checked against the source report definition in Phase 2. |

### A ↔ B consistency (Maharashtra, overlapping days)

| Crop | Overlap days | Correlation (daily) | Ratio B / A median |
|---|---|---|---|
| Onion | 598 | 0.984 | 0.984 |
| Potato | 686 | 0.798 | 0.981 |

Level agreement is good. Onion tracks very closely; Potato's lower correlation suggests B's state-level modal price is a different aggregation (to be understood before B is used as a model feature).

### Recency (important)

- Newest observation in any dataset: **2026-07-02** (Dataset B). Today is 2026-10-14, so the newest record is about **3.5 months old**.
- Newest mandi-level price (Dataset A): **2025-06-11**, about **16 months old**.
- **Therefore none of this data may be presented as current.** A forecast produced from it must be labelled with its cutoff date and marked stale. The product needs a separate recent-data feed (Section 6).

---

## 3. Pilot recommendation

### Primary crop: **Potato** (Maharashtra)

| Evidence | Value |
|---|---|
| Mandi-level days present (A) | 727 of 737 (~99%), no gap above 7 days |
| Maharashtra markets with ≥ 500 observations | 14 |
| Markets reporting each month | 30–35 |
| Candidate-market data-quality flags | 0% |
| Days with ≥ 3 candidate markets all reporting | 705 / 737 |
| State-level arrivals (B) | 1,511 days, tonnes |

Potato is the only crop whose **mandi-level series is continuous** across the whole window, which is what backtesting 1–7-day horizons needs.

**Caveat (honest limitation):** Potato prices are generally less volatile than Onion's, so measured forecast skill versus a naive baseline may be modest, and the decision value of "where to sell" is lower. The Phase 3 backtest decides whether a model beats persistence.

### Secondary crop: **Onion** (Maharashtra)

| Evidence | Value |
|---|---|
| Mandi-level days present (A) | 639 of 737 |
| Gaps | 30 days and 62 days (all markets, same dates) |
| Markets with ≥ 500 observations | 6 (36 with ≥ 300) |
| Price range seen (Nagpur, modal) | ₹875 → ₹6,250 / quintal; much higher volatility |
| State-level arrivals (B) | 1,514 days, tonnes |

Onion has the highest decision value (strong volatility, Lasalgaon/Nashik hub, many markets), but its gaps mean Phase 3 must train and score only on the continuous segments and report the gaps openly.

### Crops rejected for the pilot

| Crop | Reason |
|---|---|
| **Tomato** | Mandi-level data covers only 140 days (to Nov 2023), and no single market has more than 116 observations. State-level series in B is long but cannot support mandi comparison. Revisit if a longer mandi-level tomato export is supplied. |
| Wheat | Mandi data ends Feb 2024 (~245 days). |
| Rice | Mandi data starts Apr 2025 (~60 days). |
| Anything in C or D | Monthly national aggregates only. |

Dataset B contains 142 Maharashtra commodities, some with slightly more days than Onion (Soyabean, Wheat, Beans, Maize, each ~1,630). They have **no mandi-level** counterpart in A, so they cannot support mandi comparison and are out of scope.

---

## 4. Pilot mandis

> Selection is based only on observed coverage in Dataset A. Distances, transport costs and coordinates are **not** verified yet.

### Potato (primary): proposed set

| Market (as named in A) | District (A) | Observations | Coverage of 737 days | Max gap (days) |
|---|---|---|---|---|
| **Pune(Manjri)** | Pune | 659 | 89.4% | 5 |
| **Vashi New Mumbai** | Mumbai | 550 | 74.6% | 7 |
| **Nasik** | Nashik | 542 | 73.5% | 10 |
| **Solapur** | Solapur | 537 | 72.9% | 7 |
| Amrawati (Fruit & Veg Market) | Amravati | 570 | 77.3% | 6 |
| Akola | Akola | 533 | 72.4% | 7 |

Best joint coverage: **Pune(Manjri) + Solapur + Vashi New Mumbai report together on 475 days**; Nasik, Pune(Manjri) and Vashi together on 472. Recommended core triple for the first vertical slice: **Pune(Manjri), Vashi New Mumbai, Nasik**. They are well-known, geographically distinct hubs, and Solapur and Akola remain as alternates. Use Solapur if a pairing with a southern/eastern market is preferred.

### Onion (secondary): proposed set

| Market (as named in A) | District (A) | Observations | Coverage of 737 days | Max gap (days) |
|---|---|---|---|---|
| **Pune(Manjri)** | Pune | 574 | 77.9% | 62 |
| **Lasalgaon(Vinchur)** | Nashik | 594 | 80.6% | 68 |
| **Kolhapur** | Kolhapur | 505 | 68.5% | 62 |
| Vashi New Mumbai | Mumbai | 482 | 65.4% | 62 |
| Solapur | Solapur | 522 | 70.8% | 63 |
| Nagpur | Nagpur | 705 rows (market-days not yet counted) | not computed | not computed |

Best joint coverage: **Kolhapur + Lasalgaon(Vinchur) + Pune(Manjri) report together on 443 days**. Note that Nagpur has the most Onion rows (705), but rows include multiple varieties on the same day, so market-day coverage must be re-counted in Phase 2 before Nagpur is considered.

**Open items for mandi selection**
- `Lasalgaon`, `Lasalgaon(Niphad)`, `Lasalgaon(Vinchur)` and `Pimpalgaon` are distinct yard names in one district; confirm in Phase 2 whether they are separate markets or alias candidates.
- Each pilot market must have geocoordinates from a reliable source before routing (Phase 5).

---

## 5. What the data can and cannot support

| Capability (PROJECT.md) | Supported by the supplied data? |
|---|---|
| Historical price series per mandi | ✅ Potato (strong), Onion (with gaps) |
| ≥ 3 mandi comparison | ✅ Potato and Onion |
| 1–7-day price forecasting (backtested) | ✅ Feasible on historical data; skill vs baseline unproven |
| **Mandi-level arrival features** | ❌ Arrivals exist only at state level |
| Supply-pressure / crowd-aware proxy | ⚠️ State-level only; must be disclosed as such |
| Current / "live" recommendations | ❌ Latest mandi price is June 2025; latest state record is July 2026 |
| Weather, transport, mandi fees | ❌ Not present in any dataset |
| Tomato mandi comparison | ❌ Insufficient mandi data |

---

## 6. Historical vs recent data strategy

| Layer | Source | Use | Rules |
|---|---|---|---|
| **Historical** (this milestone) | Datasets A and B | EDA, feature engineering, training, backtesting, trends | Every row tagged `source`, `is_historical = true`; never shown as current |
| **Recent** (Phase 2+) | Official portal download or adapter (AGMARKNET, data.gov.in, CEDA per PROJECT.md §4.1) | Latest prices, forecast inputs, current recommendations | Terms and coverage must be verified before coding; not assumed available |
| **Freshness gate** | Computed per series | Forecast labelled with data cutoff; marked stale beyond a configured age | A forecast built from outdated inputs must say so |

**Data still required**
1. Mandi-level observations after 2025-06-11 for the pilot markets (and ideally after 2026-07-02), from an official source.
2. Mandi-level **arrival quantities** (Dataset A has none). Without them, supply pressure stays state-level.
3. The missing windows in Onion (2024-06-06 → 07-06; 2024-12-06 → 2025-02-06) and in B (2025-04-30 → 2025-09-01) if any official source can fill them; **never interpolate them into the training set**.
4. Market geocoordinates and verified transport tariffs (Phase 5).
5. For Tomato, a continuous mandi-level export longer than the current 140 days.

---

## 7. Limitations of this analysis

- Profiling covered completeness, continuity, units and internal consistency. It did **not** validate the numbers against the original AGMARKNET portal; Phase 2 must do the 20-row manual reconciliation required by PROJECT.md §20.
- Market names are taken as written in the files; no canonicalisation has been applied.
- "Proposed" selections are based on this historical window only and may change once recent data is obtained.
- No models were trained and no data was ingested or altered.

---

## 8. Decision summary

| Item | Choice |
|---|---|
| Region | Maharashtra |
| **Primary crop** | **Potato** (mandi-level continuity) |
| **Secondary crop** | **Onion** (highest decision value; gaps documented) |
| Primary mandis | Pune(Manjri), Vashi New Mumbai, Nasik (alternates: Solapur, Amravati, Akola) |
| Secondary mandis | Pune(Manjri), Lasalgaon(Vinchur), Kolhapur (alternates: Vashi, Solapur, Nagpur) |
| Historical datasets used | A (prices) and B (state-level arrivals/prices) |
| Datasets set aside | C and D |
| Blocking dependency for "live" features | Recent official data (Section 6) |

