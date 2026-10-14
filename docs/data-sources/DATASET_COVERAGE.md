# FASALYTICS — Dataset Coverage & Early Validation Selection

> **Status:** Milestone 2 analysis of the four historical datasets supplied by the team (updated in Milestone 3 for nationwide scope).
> **Analysed:** 14 October 2026 (read-only; originals unmodified).
> **Nature of the data:** every figure below is a **historical observation**, not a live or current market price.
> Nothing here is a forecast, and no gaps were filled or invented.

> ## ⚠️ Scope correction (read first)
> FASALYTICS is a **nationwide, all-crop platform** (PROJECT.md §0.1). Sections 3 and 4 below describe **early technical-validation series** (Potato and Onion in Maharashtra) chosen because the supplied files are continuous there. They are **not** the product scope and must not be hardcoded anywhere.
>
> Four things are deliberately kept separate in this document:
>
> | Concept | Where |
> |---|---|
> | **Platform-wide coverage** (what the architecture must support) | PROJECT.md §0.1, §4.2 |
> | **Actual dataset coverage** (what the files contain, by state and commodity) | Sections 1, 2, 9 |
> | **Forecast-eligible series** (provisional data-sufficiency screen; backtests decide) | Section 10 |
> | **Early validation examples** and **future nationwide expansion needs** | Sections 3–4, 11 |
>
> *Naming:* this file was previously `PILOT_SELECTION.md`; it was renamed to `DATASET_COVERAGE.md` in Milestone 4 to reflect the nationwide, all-crop scope. Content is unchanged. Earlier commit messages and history still use the old name.
>
> *Paths:* after Milestone 3 the originals live in `data/raw/` (§12). Checksums were verified identical before and after the move.

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
| Geography | 29 raw state spellings (≈26 canonical states/UTs), 1,598 markets | 33 raw state names with valid dates, no market column | India only | India only |
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

## 3. Early validation recommendation (not the product scope)

### First validation crop: **Potato** (Maharashtra)

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

## 4. Early validation mandis (Maharashtra)

> Selection is based only on observed coverage in Dataset A. These are example series for proving the pipeline; Section 10 shows the same screen applied nationwide. Distances, transport costs and coordinates are **not** verified yet.

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

## 8. Decision summary (early validation only)

> This table records the **technical-validation** choice. It is not a product restriction. See Sections 9–11 for nationwide coverage.

| Item | Choice |
|---|---|
| Region (validation) | Maharashtra |
| **Primary crop** | **Potato** (mandi-level continuity) |
| **Secondary crop** | **Onion** (highest decision value; gaps documented) |
| Primary mandis | Pune(Manjri), Vashi New Mumbai, Nasik (alternates: Solapur, Amravati, Akola) |
| Secondary mandis | Pune(Manjri), Lasalgaon(Vinchur), Kolhapur (alternates: Vashi, Solapur, Nagpur) |
| Historical datasets used | A (prices) and B (state-level arrivals/prices) |
| Datasets set aside | C and D |
| Blocking dependency for "live" features | Recent official data (Section 6) |

---

## 9. State-wise dataset coverage (nationwide view)

Recomputed in Milestone 3 directly from the files in `data/raw/`. State names are shown **as written** in each file; Section 11 lists the spelling conflicts a canonical registry must resolve.

### 9.1 Dataset A — mandi-level prices (2023-06-06 → 2025-06-11; 5 commodities; no arrivals)

"Series" = one (state, district, market, commodity) daily series. "Pass" = passes the provisional data-sufficiency screen in Section 10 (not forecast eligibility).

| State (as written) | Rows | Districts | Markets | Commodities | Series | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Uttar Pradesh | 188,094 | 56 | 181 | 5 | 728 | 109 |
| Tamilnadu | 66,602 | 24 | 184 | 2 | 353 | 0 |
| Haryana | 63,222 | 18 | 80 | 4 | 229 | 45 |
| Madhya Pradesh | 55,901 | 44 | 285 | 4 | 471 | 2 |
| West Bengal | 53,927 | 14 | 43 | 5 | 137 | 37 |
| Maharashtra | 51,816 | 26 | 206 | 5 | 347 | 18 |
| Kerala | 45,605 | 9 | 58 | 5 | 155 | 23 |
| Punjab | 44,792 | 14 | 86 | 4 | 218 | 23 |
| Rajasthan | 35,785 | 28 | 98 | 5 | 183 | 15 |
| Gujarat | 26,652 | 16 | 73 | 5 | 116 | 11 |
| Himachal Pradesh | 22,837 | 8 | 33 | 5 | 96 | 14 |
| Orissa | 20,633 | 20 | 57 | 4 | 144 | 12 |
| Karnataka | 14,391 | 21 | 72 | 5 | 159 | 3 |
| Bihar | 12,454 | 19 | 31 | 4 | 54 | 8 |
| Andhra Pradesh | 9,616 | 10 | 30 | 5 | 58 | 4 |
| Jammu & Kashmir | 5,299 | 4 | 7 | 3 | 21 | 3 |
| Assam | 4,099 | 7 | 13 | 5 | 25 | 2 |
| Delhi | 3,713 | 1 | 5 | 5 | 12 | 2 |
| Nagaland | 3,012 | 11 | 16 | 3 | 31 | 1 |
| Chattisgarh | 2,603 | 9 | 24 | 4 | 32 | 2 |
| Chhattisgarh | 2,250 | 1 | 7 | 4 | 12 | 1 |
| Manipur | 1,317 | 2 | 2 | 3 | 6 | 0 |
| Chandigarh | 949 | 1 | 1 | 3 | 3 | 1 |
| Jammu and Kashmir | 926 | 1 | 2 | 3 | 6 | 0 |
| Meghalaya | 810 | 5 | 10 | 3 | 20 | 0 |
| Uttrakhand | 46 | 1 | 1 | 4 | 4 | 0 |
| Tamil Nadu | 26 | 3 | 6 | 1 | 6 | 0 |
| Tripura | 11 | 1 | 2 | 1 | 2 | 0 |
| Gao *(Goa, misspelt)* | 4 | 1 | 1 | 1 | 1 | 0 |

Commodity coverage in A:

| Commodity | Rows | States | Markets | Window |
|---|---:|---:|---:|---|
| Onion | 298,658 | 28 | 1,044 | 2023-06-06 → 2025-06-11 |
| Potato | 327,332 | 27 | 971 | 2023-06-06 → 2025-06-11 |
| Wheat | 76,976 | 18 | 738 | 2023-06-06 → 2024-02-06 |
| Tomato | 26,644 | 23 | 660 | 2023-06-06 → 2023-11-06 |
| Rice | 7,782 | 14 | 195 | 2025-04-06 → 2025-06-06 |

### 9.2 Dataset B — state-level prices and arrivals (2022-01-01 → 2026-07-02; 433 commodities)

"Series" = one (state, commodity) daily series, de-duplicated across overlapping reports.

| State (as written) | Rows | Commodities | First | Last | Series | Pass |
|---|---:|---:|---|---|---:|---:|
| Maharashtra | 143,769 | 142 | 2022-01-01 | 2026-07-02 | 142 | 73 |
| Gujarat | 134,539 | 155 | 2022-01-01 | 2026-07-02 | 155 | 80 |
| Keralam | 128,371 | 137 | 2022-01-01 | 2026-07-02 | 137 | 76 |
| Rajasthan | 126,495 | 152 | 2022-01-01 | 2026-07-02 | 152 | 64 |
| Karnataka | 124,169 | 145 | 2022-01-01 | 2026-07-02 | 145 | 62 |
| Uttar Pradesh | 121,885 | 176 | 2022-01-01 | 2026-07-02 | 176 | 59 |
| Telangana | 111,999 | 150 | 2022-01-01 | 2026-07-02 | 150 | 56 |
| Madhya Pradesh | 110,911 | 247 | 2022-01-01 | 2026-07-02 | 247 | 41 |
| Punjab | 94,464 | 130 | 2022-01-01 | 2026-07-02 | 130 | 43 |
| Haryana | 92,974 | 124 | 2022-01-01 | 2026-07-02 | 124 | 43 |
| NCT of Delhi | 89,047 | 128 | 2022-01-01 | 2026-07-02 | 128 | 34 |
| West Bengal | 80,425 | 74 | 2022-01-01 | 2026-07-02 | 74 | 43 |
| Chattisgarh | 73,403 | 136 | 2022-01-01 | 2026-07-02 | 136 | 27 |
| Tamil Nadu | 68,323 | 130 | 2022-01-01 | 2026-07-02 | 130 | 5 |
| Himachal Pradesh | 67,930 | 85 | 2022-01-01 | 2026-07-02 | 85 | 35 |
| Uttarakhand | 61,224 | 111 | 2022-01-01 | 2026-07-02 | 111 | 27 |
| Odisha | 57,206 | 132 | 2022-01-01 | 2026-07-02 | 132 | 25 |
| Jammu and Kashmir | 53,120 | 74 | 2022-01-01 | 2026-07-02 | 74 | 26 |
| Tripura | 47,284 | 82 | 2022-01-01 | 2026-07-02 | 82 | 20 |
| Andhra Pradesh | 30,061 | 67 | 2022-01-01 | 2026-07-02 | 67 | 12 |
| Nagaland | 23,482 | 72 | 2022-01-01 | 2026-07-02 | 72 | 6 |
| Meghalaya | 22,049 | 70 | 2022-01-03 | 2026-07-02 | 70 | 2 |
| Bihar | 19,307 | 98 | 2022-01-01 | 2026-07-02 | 98 | 2 |
| Goa | 17,978 | 22 | 2022-01-01 | 2026-07-02 | 22 | 6 |
| Manipur | 14,364 | 26 | 2022-01-03 | 2026-07-02 | 26 | 0 |
| Chandigarh | 14,265 | 28 | 2022-01-11 | 2026-07-02 | 28 | 0 |
| Assam | 14,033 | 84 | 2022-01-05 | 2026-07-02 | 84 | 0 |
| Andaman and Nicobar | 6,372 | 56 | 2022-01-20 | 2026-07-02 | 56 | 0 |
| Pondicherry | 3,796 | 18 | 2022-01-03 | 2026-07-02 | 18 | 0 |
| Arunachal Pradesh | 397 | 22 | 2025-10-27 | 2026-07-02 | 22 | 0 |
| Jharkhand | 117 | 18 | 2022-01-01 | **2023-01-24** | 18 | 0 |
| Mizoram | 39 | 9 | 2026-05-30 | 2026-07-01 | 9 | 0 |

Dataset B commodity groups (by distinct commodities): Vegetables 101, Fruits 42, Flowers 31, Forest Products 34, Others 33, Pulses 32, Spices 29, Drug & Narcotics 29, Cereals 24, Oil Seeds 21, Live Stock/Poultry/Fisheries 17, Medicinal & Aromatic Plants 17, Oils & Fats 7, Dry Fruits 7, Fibre Crops 5, Beverages 4. Arrival units are **Metric Tonnes** for 1,876,567 rows, but **Nos** (42,040) and **Bundle** (35,191) for others, so units must be carried per record.

### 9.3 Datasets C and D

National monthly only (no state or district). They give long-run context (C: 16 commodities, 2010 → 2025-03; D: 41 index series, 2012 → 2024) but cannot support state, mandi or daily analysis.

---

## 10. Provisional data-sufficiency screen (NOT forecast eligibility)

A transparent first pass over every series in A and B, to show nationwide *data* availability. **This does not grant forecast eligibility.** Only Phase 3 time-based backtests against baselines can do that, and thresholds are configuration, not whitelists.

| Source | Criteria applied (all must hold) |
|---|---|
| A (mandi) | ≥ 365 reporting days · ≥ 60% coverage of own first→last span · max internal gap ≤ 31 days · last observation within 14 days of the file's end (2025-06-11) |
| B (state) | ≥ 730 reporting days · ≥ 70% coverage of own span · last observation within 30 days of the file's end (2026-07-02) |

### Status and caveats of these thresholds

The thresholds above (**365 days, 60% coverage, 31-day maximum gap** for mandi-level data) are **confirmed as the current provisional values**. They are preliminary data-sufficiency screens, **not proof of forecast accuracy**.

- They may change during Phase 3 as backtesting reveals what the models actually need.
- Forecast eligibility ultimately requires **time-based backtesting** against baselines; passing this screen only creates a candidate pool.
- **State-level data cannot automatically qualify for mandi-level forecasting.** State series are assessed and labelled separately (State-Level Intelligence).
- **Different reporting frequencies need different criteria.** Daily mandi series, daily state series and monthly national series (Datasets C and D) must not share one day-count threshold.
- **Data freshness is assessed separately** from historical coverage. A long, continuous series that ended months ago is not eligible for *current* decision support, whatever its coverage. (The freshness check inside this screen is relative to each file's own end date, not to today.)

### Results

| Level | Series evaluated | Pass screen | Notes |
|---|---:|---:|---|
| **A — mandi × commodity** | 3,629 | **336** | **All 336 are Potato**, across 21 states; 335 distinct markets |
| **B — state × commodity** | 3,100 | **867** | 172 of 433 commodities pass in at least one state |

What this shows:
- **Potato** clears the mandi-level screen in 21 states (largest: Uttar Pradesh 109, Haryana 45, West Bengal 37, Kerala 23, Punjab 23, Maharashtra 18). Maharashtra is therefore *one of 21*, not the scope.
- **Onion, Tomato, Wheat, Rice pass nowhere at mandi level**: the supplied Onion file has shared 30-day and 62-day holes, and the others cover windows shorter than the screen. This reflects the supplied files, **not the real markets**; a better recent or complete export may change it.
- At **state level** (B), 172 commodities across groups (vegetables, fruits, pulses, cereals, oilseeds, spices and others) have long, mostly continuous series. These map to the **State-Level Intelligence** tier, not mandi-level intelligence.
- No series has been backtested. The numbers above are a *candidate pool*.

### Provisional tier mapping (to be confirmed by Phase 2/3)

| Tier | Provisional population from the supplied files |
|---|---|
| Full Intelligence | Candidates only: the 336 Potato mandi series, **pending backtests**; none confirmed |
| Limited Intelligence | Mandi series in A that fail the screen (3,293), mostly due to short windows or gaps |
| State-Level Intelligence | The 867 state × commodity series in B that pass the screen |
| Insufficient Data | Remaining series (for example B series with < 730 days or stale) |

---

## 11. Future nationwide expansion requirements

1. **Canonical geography registry.** Raw state names are inconsistent *within and between* files:
   - A: `Chattisgarh` vs `Chhattisgarh`; `Jammu & Kashmir` vs `Jammu and Kashmir`; `Tamilnadu` vs `Tamil Nadu`; `Orissa`; `Uttrakhand`; `Gao` (Goa).
   - B: `Keralam`, `NCT of Delhi`, `Odisha`, `Chattisgarh`, `Pondicherry`.
   - Only-in-A states: Kerala, Orissa, Delhi, Tamilnadu, Uttrakhand, Chhattisgarh, Jammu & Kashmir, Gao. Only-in-B: Keralam, Odisha, NCT of Delhi, Telangana, Jharkhand, Goa, Mizoram, Arunachal Pradesh, Andaman & Nicobar, Pondicherry, Uttarakhand.
   - Canonical IDs and a **human-reviewed alias table** are required. **No automatic fuzzy merging.**
2. **Composite market keys.** 16 market names occur in more than one state (for example Banda, Fatehpur, Gorakhpur, Kota, Patan, Pratapgarh, Sirsa); market name alone is not an identifier. Several yards per city must be modelled explicitly.
3. **Telangana is absent from A** and appears only in B; Jharkhand has B data only to 2023-01-24; Mizoram and Arunachal Pradesh have data only from 2026. Coverage cannot be assumed uniform.
4. **Commodities beyond A's five** exist only at state level in B. Mandi-level data for the rest requires a complete export from an official source (Phase 2 investigation of AGMARKNET, data.gov.in and CEDA).
5. **Recent data feed** (Section 6): the newest mandi observation is 2025-06-11 and the newest state observation 2026-07-02.
6. **Mandi-level arrivals** do not exist in the supplied files.
7. **Verified mandi coordinates** are not in the files and are required for distance, transport cost and mapping.
8. **Variety and grade handling** (Section 2): a documented rule for multiple varieties/grades per market-day.
9. **Units**: Nos and Bundle records in B must never be combined with Metric Tonnes / ₹ per quintal.

---

## 12. Raw data locations and integrity (updated in Milestone 3)

| Dataset | Original location | Current path | SHA-256 (verified before and after move) |
|---|---|---|---|
| A `Agriculture_price_dataset.csv` | repo root | `data/raw/Agriculture_price_dataset.csv` | `156D7F6357E7B90C8AB4AD8B0CE6BAF94B2A99D952024148BD980D8A748410CB` |
| B `merged_preprocessed_all_reports.csv` | repo root | `data/raw/merged_preprocessed_all_reports.csv` | `899803AC0592CFBE99F481D647CBD70F7579E3FC53784EEF485B247D8B18C754` |
| C `crop_price_dataset.csv` | repo root | `data/raw/crop_price_dataset.csv` | `7AB839FEAAFAE49B933D762CD632D872B2F2289FC001124BDA2D3C69EA671AB5` |
| D `Wholesale-Price-Index-from-2012-to-2024.csv` | repo root | `data/raw/Wholesale-Price-Index-from-2012-to-2024.csv` | `7A91DCABCAF2398AE10C631F1D4BDB98B4888C8E9480A7295BE17BB5D080601E` |

- Files are excluded from Git by `.gitignore` (`data/raw/*` and `*.csv`); only `data/raw/.gitkeep` is tracked.
- Raw files are **read-only inputs**. Processed outputs belong in `data/processed/` (ignored).
- Verify at any time with `Get-FileHash <file> -Algorithm SHA256`.
