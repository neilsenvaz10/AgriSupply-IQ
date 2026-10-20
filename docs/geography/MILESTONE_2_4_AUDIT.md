# Milestone 2.4 — Stage 1 audit of the existing geographic data

Date: 2026-10-20. Status: **read-only audit.** Every figure below was queried from the development database
in a `READ ONLY` transaction as the application role (`fasalytics_app`); nothing was written, migrated or imported.
Labels: **[CONFIRMED]** = measured or read in this audit; **[HYPOTHESIS]** = inference that still needs evidence.

## 1. Headline figures (all independently re-verified)

| Figure                                                                             |                                                                         Value | Status    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------: | --------- |
| Accepted observations (mandi + state + national + WPI)                             |                               2,698,327 (735,461 + 1,953,793 + 2,800 + 6,273) | CONFIRMED |
| Registered commodities                                                             |      434 (only 5 have mandi observations: Potato, Onion, Wheat, Tomato, Rice) | CONFIRMED |
| Mandi identities (`markets`)                                                       |                                              1,610, all `status = unverified` | CONFIRMED |
| States / districts in the registry                                                 | 36 / 763 (all with an LGD code; reference = a December 2022 community mirror) | CONFIRMED |
| Mandis with a government market code, coordinates, classification, or a merge link |                                                             **0** / 0 / 0 / 0 | CONFIRMED |
| Mandis without a district id                                                       |                                                                           213 | CONFIRMED |
| Observations in those mandis                                                       |                                                                        86,427 | CONFIRMED |
| Unresolved district alias rows                                                     |                                                                   49 (of 374) | CONFIRMED |
| Distinct (state label, district label) pairs behind them                           |                                              49 (48 distinct district labels) | CONFIRMED |
| Unresolved state labels                                                            |                                                                     1 (`Gao`) | CONFIRMED |
| `Gao` quarantined rows                                                             |                                           4 source rows (8 rejection records) | CONFIRMED |
| `Keralam`                                                                          |   resolved to KERALA by a reviewed decision; 128,371 state-level observations | CONFIRMED |

Observation date range of the mandi-level data: 2023-06-06 to 2025-06-11. State-level: 2022-01-01 to 2026-07-02.

## 2. "Unresolved" means four different things

The numbers 49, 213 and 86,427 describe different objects, which is why they are easy to confuse:

| Notion                               |  Count | What is counted                                                                                             | Where it comes from                                |
| ------------------------------------ | -----: | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Unresolved district **alias rows**   |     49 | One row per (source, state label, district label) the resolver could not match inside its resolved state    | `district_aliases.resolution_status <> 'resolved'` |
| Distinct unresolved **labels**       |     48 | The district text alone; `thiruchirappalli` occurs under two state spellings (`Tamilnadu`, `Tamil Nadu`)    | observations of mandis without a district          |
| Unresolved district **ids** (mandis) |    213 | Mandi identities whose `district_id` is NULL. Several mandis share one label, so 213 mandis map to 49 pairs | `markets.district_id IS NULL`                      |
| Affected **observations**            | 86,427 | Mandi-level rows belonging to those 213 mandis                                                              | join of the above                                  |

A mandi's identity is `(state, district or source-label disambiguator, normalised name)`. For the 213 mandis the
district part is stored as `src-district:<source label>`, so the original source label is preserved in the identity.
Resolving a label later therefore changes **how a mandi is grouped**, never the observation rows or their provenance.

## 3. Unresolved observations by the state of the mandi

Uttar Pradesh 20,504 · Haryana 13,688 · Andhra Pradesh 8,935 · Karnataka 7,097 · West Bengal 6,264 · Maharashtra 5,148 ·
Gujarat 5,108 · Odisha 4,343 · Tamil Nadu 4,206 · Punjab 3,792 · Delhi 3,713 · Madhya Pradesh 3,490 · Chhattisgarh 100 · Kerala 39
(sums to 86,427). [CONFIRMED]

## 4. Telangana / Andhra Pradesh — a finding that corrects an earlier note

- The mandi-level file has **no `Telangana` state label at all**. Its Andhra Pradesh label covers 30 mandis; **27 of
  them are towns that are in Telangana today** (e.g. Bowenpally, Gudimalkapur, Mahboob Manison, L B Nagar, Erragadda,
  Hanmarkonda, Sangareddy, Miryalguda, Mancharial) and carry district labels `hyderabad`, `warangal`, `nalgonda`, `medak`,
  `mahbubnagar`, `adilabad`, `karimnagar`, `nizamabad`. Only three are Andhra towns and resolved (Kurnool, Pattikonda,
  Tiruvuru). The 27 hold 8,935 observations. [CONFIRMED]
- Those rows are dated **2023-06 to 2025-06**, i.e. after the 2 June 2014 bifurcation. The earlier review document
  (`docs/data-sources/GEOGRAPHY_REVIEW_2_3D.md`, group C) guessed "the source using a pre-2014 state for older rows".
  **That hypothesis is refuted:** these are recent rows with a stale or wrong state label in the source. The document should
  be corrected in Stage 2 of the plan. [CONFIRMED]
- The state-level file, by contrast, does carry both `Telangana` (111,999 rows) and `Andhra Pradesh` (30,061 rows).
- Consequence today: `state_id = ANDHRA PRADESH` mandi queries and the Andhra Pradesh state filter in the UI **include
  27 Telangana mandis**. This is a data-quality problem, not only an unresolved-label problem. [CONFIRMED]
- Why districts cannot match: districts resolve only inside the resolved state, and the 2022 mirror lists these districts
  under TELANGANA (33 districts) not ANDHRA PRADESH (26). Correct behaviour of a strict rule; wrong state input.
- Not yet established: whether the source's state field is wrong per row or per mandi, and which official record would
  settle each mandi (district of the market yard). [HYPOTHESIS: per mandi, since each mandi has a single state label]

## 5. Spelling, renaming and ambiguity categories (49 labels)

Re-classification of the 49 pairs. The grouping is a **hypothesis** from general knowledge and the two cited renaming
sources; none of it is applied.

| Category                                                   | Labels | Examples                                                                                     | Evidence still needed                                          |
| ---------------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Transliteration / spelling variant of an existing district |     30 | bulandshahar, badaun, puruliya, sholapur, amarawati, belgaum, mysore                         | Authoritative district list + the effective-date spelling      |
| Renamed or administratively changed                        |      7 | gurgaon, mewat, hoshangabad, khandwa, thiruvannamalai, thiruchirappalli (x2 state spellings) | Gazette / LGD change record with date                          |
| State boundary (Telangana under Andhra Pradesh)            |      8 | hyderabad, warangal, nalgonda, medak, mahbubnagar, adilabad, karimnagar, nizamabad           | Per-mandi evidence + a decision to correct the mandi's _state_ |
| Ambiguous or unchecked                                     |      4 | bangalore (Urban/Rural), delhi (11 districts), kanpur (Nagar/Dehat), kushinagar              | Mandi location / APMC record                                   |

The 4-label "ambiguous" count is 4 labels, not 4 observations; `bangalore` alone is 2,639 observations, `delhi` 3,713.

## 6. Mandi identity facts

- 1,610 identities, **0 same-state duplicate names** (the registry uses `(state, district/disambiguator, name)` so
  duplicates cannot occur by construction), **14 names that occur in two states** (Banda, Dindori, Fatehabad, Fatehpur,
  Gorakhpur, Jalalabad, Kota, Nokha, Padampur, Patan, Pratapgarh, Shahabad, Sirsa, Sultanpur) = 28 mandis. These are
  genuine homonyms; a name-only match would merge different markets. [CONFIRMED]
- 314 names contain a parenthesis (yard, market type or sub-market: `Lasalgaon(Vinchur)`, `Kota (F&V)`, `Mannargudi
II(Uzhavar Sandhai )`). Whether such a suffix denotes a separate market or an alias is **not decidable from the files**.
- 1,612 market alias rows for 1,610 mandis (2 mandis carry two source spellings). Every mandi has at least one observation
  (median 220, max 2,847, min 1). [CONFIRMED]
- Aliases carry `source_context` such as `Maharashtra|nashik`: the source's own state|district text. [CONFIRMED]
- No registry identifier exists for any mandi: not in the files, not in the database. [CONFIRMED]

## 7. Provisional and quarantined items

- **Keralam.** `Keralam` (state-level file only) maps to KERALA by a reviewed decision. This audit corroborated the rename
  from several news reports and the PRS text of the Bill: the _Kerala (Alteration of Name) Act, 2026_, with the commencement
  notified on 2026-08-25 (see AUTHORITATIVE_SOURCES.md). The primary Gazette of India PDF was **not retrieved**, so the status
  stays "provisional" until it is. [CONFIRMED that sources agree; NOT YET the primary document]
- **Gao.** Four source rows (district `north goa`) remain quarantined as `unmapped_entity`. They are not in any
  observation table. [CONFIRMED]

## 8. What is not known

1. The origin of the mandi file's state/district/market strings (which portal export, which date). Provenance beyond the
   importer's file fingerprint is not recorded.
2. Whether the 2022 mirror matches the official LGD today (the mirror is not an official publication).
3. Which of the 14 homonym pairs are the same market with a mislabelled state (none is assumed).
4. How many of the 213 mandis are closed, renamed or merged.

## 9. Method and reproducibility

Queries ran as `BEGIN READ ONLY` sessions (transaction flag confirmed `on`) as the application role; they are
`SELECT`-only over `markets`, `districts`, `states`, the alias tables, `mandi_observations`, `state_observations`,
`ingestion_rejections`, `pg_constraint` and `information_schema`. The development database was byte-identical before
and after (verified by table row counts and content hashes at the end of Stage 1).
