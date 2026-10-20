# Milestone 2.4 — Stage 2 findings: official reference acquisition and validation

Date: 2026-10-20. No database write, migration, import or registry change was made; the development database was only read (read-only
transactions). Labels: **[CONFIRMED]** = observed in an acquired official file or page; **[DERIVED]** = computed by this stage from those
files; **[HYPOTHESIS]** = still needs evidence. File inventory and hashes: [REFERENCE_ACQUISITION.md](./REFERENCE_ACQUISITION.md) and the manifest.

## 0. Stage 2 completion (2026-10-20, with the owner-downloaded official LGD files) — this section supersedes sections 1–10 where they differ

**Files** (originals unchanged, outside Git, in `C:\Users\DELL\Desktop\AgriSupply-IQ-reference-data\`):

| File (original name)                           |      Size | SHA-256                                                            | Format                                                                                                                                                                                                                                                                                                  | Acquired                                 |
| ---------------------------------------------- | --------: | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `All_Stateof_India_2026-10-20_16-37-34.xlsx`   |   5,652 B | `108f75e927bdec4d…18967ebaf0b555afcaed93c69213ad2`                 | xlsx (Apache POI), sheet `allStateofIndia`: title, header, **36** rows; S.No., State Code, **State Version**, names, Census 2001/2011, State/UT                                                                                                                                                         | created 2026-10-20T11:07:34Z (IST 16:37) |
| `alldistrictbyDate2026_10_20_16_39_38_188.xls` | 448,918 B | `442cfd9700c201128ff646b025bb6f1f71bb039f65f50e97056e5306d82a36a1` | **SpreadsheetML 2003 XML with an .xls extension**, sheet `Report`: title lines "All Districts Of India" and "Modification done between (From 01/01/2005 - TO 20/10/2026)", header, **784** rows, footer "Oct 20, 2026, 4:39 PM"; District Code, District Name, State Code, State Name, Census 2001/2011 | 2026-10-20 IST 16:39                     |

- **What they are.** The first is the _All States_ report (not one of the two named reports, a useful cross-check). The second is the _All Districts_ report **filtered by a modification-date window that covers 2005 to today, so it
  lists every active district**. It is **not a change log**: it has no per-record dates, versions, status or operation columns. The dated modification list (`lgdTransaction.do`) is **still not obtained**.
- **Validation (all [CONFIRMED]).** States: 36 rows, 28 states + 8 UTs, unique codes, names and versions agree with the public state pages (Andhra Pradesh version 2, Jammu and Kashmir version 3) and with the registry 36/36.
  Districts: 784 rows, codes 1–796 (12 unused/inactive codes), **0 duplicate codes, 0 duplicate (state, name)**, all 36 states present (1 to 75 districts each), Census 2001 code empty for 169 and Census 2011 code empty for 22 (newer districts).
  Kerala is still listed as **Kerala** (version 1) on 2026-10-20, two months after the _Kerala (Alteration of Name) Act, 2026_ commenced (25 August 2026): LGD does not yet record Keralam, so the alias stays provisional.
- **Extra official evidence gathered (public pages, no CAPTCHA):** per-district detail and version-history pages for **91 targeted districts** (all 33 Telangana, the 13 Delhi, the 3 Bengaluru, 2 Kanpur, the official candidates for the 49 labels, and the 3 registry districts missing
  from the list). They give versions, the former names per version and the **effective date of the current version**; older versions' dates are not shown. [Manifest: 274 acquired files, 18.4 MB.]

**Comparison with the 2022 registry (763 districts):** 699 identical; **61 same code, different name** (renamings/respellings; 0 changed state); **24 new codes** (Rajasthan 8, Nagaland 3, Madhya Pradesh 3, Delhi 3, Andhra Pradesh 2, Arunachal Pradesh 2, Goa, Gujarat, Haryana 1 each);
**3 registry codes inactive** (Shahdara, Mahe, Yanam: LGD shows only Inactive versions; no registry mandi belongs to them). 70 resolved mandis (27,442 observations) sit in 15 districts whose official name differs; their `district_id` stays valid (same code).

**The 49 unresolved alias rows** (full detail: [DISTRICT_RESOLUTION_REVIEW.md](./DISTRICT_RESOLUTION_REVIEW.md)):

| Group                                                                                                                       | Labels | Observations |
| --------------------------------------------------------------------------------------------------------------------------- | -----: | -----------: |
| Confirmed by official name evidence (exact official name, or a **former name in the LGD version history** of the same code) |     23 |       38,436 |
| Uncertain: one spelling candidate, no official tie                                                                          |     15 |       32,701 |
| Ambiguous (Bangalore, Delhi, Kanpur)                                                                                        |      3 |        6,355 |
| State boundary: Telangana districts under an Andhra Pradesh label                                                           |      8 |        8,935 |

**Official name matches are not reassignment decisions.** Groups 1–3 stay inside one state. Only group 4 involves a state change, and nothing is moved.

**Telangana (27 mandis, 8,935 observations).** All 8 source labels exist as districts of **Telangana** in the official list (7 exact, `mahbubnagar` = spelling variant of Mahabubnagar renamed 19/02/2019) and none exists in Andhra Pradesh. The files cannot say which current district each market yard
is in (no town-level data; no predecessor/successor links for the split districts). Per-mandi evidence is in the review queue CSV; **no mandi is moved**.

**Stage 3 readiness (details: IMPLEMENTATION_PLAN section 9).** The official references are **sufficient to start the reference-and-decision part of the amended schema** (states, districts, versions, decisions, review events, mapping sets), on a disposable database. They are **not sufficient** for the mandi-identity
part (no identifier source) or for modelling district splits (no predecessor links; dated change log missing).

## 1. Summary

| Question                                      | Answer                                                                                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official LGD **state** reference obtained?    | **Yes**, from the official public pages (36 states/UTs, with versions and order details). Registry vs official: **36 / 36 identical** by LGD code, name and kind                                                             |
| Official LGD **district** reference obtained? | **No — blocked.** The district list and the full modification list require a CAPTCHA; data.gov.in file URLs return 403; the LGD API needs an account. Nothing was bypassed and no mirror was substituted                     |
| Does LGD hold historical effective dates?     | **Yes, in structure**: every entity has versions, status, order number/date, an effective date, gazette date and a Government Order PDF; a dated modification feed exists. **But** the effective dates need care (section 3) |
| eNAM directory usable for identity?           | **Only as weak corroboration.** 1,000 mandis, April 2021, 21 states/UTs; **no identifier, no coordinates**; name, district, postal address with PIN, phone, commodities                                                      |
| The 27 suspected Telangana mandis             | Flagged for individual review (queue file); the eNAM directory settles at most 4 by name; none appears under Andhra Pradesh                                                                                                  |
| Does the proposed schema need changes?        | Yes, small (section 7)                                                                                                                                                                                                       |

## 2. LGD — what the official pages show

Source: https://lgdirectory.gov.in/ (Ministry of Panchayati Raj owns the content; the National Informatics Centre hosts it). [CONFIRMED]

- **Public States/UTs table** (no CAPTCHA to view): columns _State LGD Code, English name, local-language name, State or UT, Census 2001
  code, Census 2011 code_, plus per-row links to Details, **View History**, Government Order and Map. 36 rows: 28 states + 8 UTs;
  **0 duplicate codes, 0 duplicate names.**
- **Registry vs official: identical** on all 36 (codes 1–38 as in the registry, names, state/UT kind). No missing and no extra state. [DERIVED]
- **Census 2011 code** is `00` for Telangana and Ladakh and empty for the merged Dadra and Nagar Haveli and Daman and Diu: LGD itself
  marks the units that did not exist in 2011 — a ready bridge to Census-era names.
- **Detail pages** (`globalviewStateDetail.do`) give _State Version, Minor Version_, and a **Government Order** block: order number, order
  date, **effective date**, **gazette publication date**, and the order PDF. **History pages** (`viewStateHistoryReport.do`) list every version
  with `Active/Inactive` (e.g. Andhra Pradesh: version 1 _Inactive_, version 2 _Active_; Jammu and Kashmir: three versions).
- **Recent-modifications feed** (public): transaction id, state, district, operation name, description, user, **Government Order file**,
  operation timestamp — e.g. 50 Karnataka transactions on 2026-10-19 (local body coverage changes, a parent change, reactivations).
  The feed is evidence that LGD records **dated, order-backed changes**; the complete list (`lgdTransaction.do`, and the
  Download Directory's "Download Only Modifications" with _from/to dates_) is behind a CAPTCHA.
- **Terms**: Copyright Policy allows free reproduction with prominent acknowledgement and non-misleading use; Terms disclaim accuracy and legal force.

## 3. LGD effective dates: what they are and are not

[CONFIRMED] from the 36 detail pages:

- **31 of 36** units carry the effective date `01/01/2005`: that is LGD's **baseline**, not a legal creation date. Only 5 states carry a
  Government Order block: Chandigarh (1966 Act), Jammu and Kashmir and Ladakh (order 53 of 09/08/2019; effective 24/08/2019 and 23/08/2019),
  Dadra and Nagar Haveli and Daman and Diu (09/12/2019) and Telangana (order 33004/99 dated 04/03/2014).
- **Telangana**: LGD effective date **17/06/2014**, order date and gazette date 04/03/2014. The legal appointed day under the Andhra Pradesh
  Reorganisation Act, 2014 is **2 June 2014** (secondary sources; the primary text was not read). Andhra Pradesh version 2 also shows
  17/06/2014. So **LGD's effective date is the date the change was recorded/effective in LGD, which can differ from the legal date.**
- Odisha shows version 1 minor version 2; Puducherry and Kerala show no rename entry (no `Keralam` change has been recorded in the page
  retrieved, which is consistent with the Act having commenced on 25 August 2026 — **[HYPOTHESIS]**: LGD may not yet reflect it; to check on the next retrieval).

Consequence for the design: store **two** dates, `lgd_effective_date` (as LGD states it, with a flag when it equals the 2005 baseline) and
`legal_effective_date` (from the Act/Gazette, entered with evidence). A mapping must never use the baseline date as a legal start.

## 4. eNAM directory

Source: `eNAM_Directory_20210720.pdf` (11,116,583 bytes, SHA-256 `10bdc3e2…304eaa`, 188 pages). [CONFIRMED]

- **Publisher/date**: Department of Agriculture, Cooperation & Farmers' Welfare, Ministry of Agriculture & Farmers' Welfare; lead agency SFAC.
  Foreword dated 12 April 2021, PDF created 14 April 2021, coverage "as on 31 March 2021". (The server's Last-Modified is 24 May 2026: a re-upload,
  not a new edition.)
- **Content**: 1,000 mandis in 18 states and 3 UTs. Official state table: Andhra Pradesh 33, Chhattisgarh 14, Gujarat 122, Haryana 81,
  Himachal Pradesh 19, Jharkhand 19, Karnataka 2, Kerala 6, Madhya Pradesh 80, Maharashtra 118, Odisha 41, Punjab 37, Rajasthan 144,
  Tamil Nadu 63, **Telangana 57**, Uttar Pradesh 125, Uttarakhand 16, West Bengal 18, Chandigarh 1, Jammu & Kashmir 2, Puducherry 2.
- **Columns per mandi**: serial number (per state table), mandi name, district, postal address (with PIN code), mandi contact number, commodity group,
  commodity names. **No mandi identifier, no coordinates, no active/closed status, no alias list.** It is a printed booklet exported from CorelDRAW,
  not a data file: cells wrap mid-word.
- **Disclaimer**: information is maintained by each APMC, may be out of date, and is "a general reference source".
- **Extraction** [DERIVED, approximate]: layout-aware extraction found **exactly 1,000 rows** (matching the official total) but the per-state
  split drifts by a few rows (e.g. Telangana 52 vs 57, Rajasthan 145 vs 144, Haryana 77 vs 81, Karnataka and Kerala sections merge), because
  state headings and wrapped cells are ambiguous. The rows are an **index for candidate matching only**.

### Candidate matching against the 1,610 registry mandis (in memory; name similarity is never verification)

| Result (text containment of the mandi's base name inside an eNAM row of the same state) | Mandis |
| --------------------------------------------------------------------------------------- | -----: |
| no candidate in the same state section                                                  |  1,018 |
| exactly one text candidate                                                              |    359 |
| several text candidates (ambiguous)                                                     |    233 |

So at most **592 of 1,610 (37%)** can even appear in the 2021 eNAM list, and the true overlap is lower because short names occur inside addresses.
Most registry mandis are **not eNAM mandis** (e.g. state-run Rythu Bazars, many Uttar Pradesh and Madhya Pradesh yards). The directory therefore
**cannot be the identity registry**; with an identifier-free layout it can corroborate a name+district+PIN triple for the mandis it does list.

## 5. The 27 suspected Telangana mandis — individual review queue

File: [`telangana_suspect_mandis_review_queue.csv`](./telangana_suspect_mandis_review_queue.csv) (27 rows, 8,935 observations, 2023-06 to 2025-06; all
`verified = no`, status `needs_individual_authoritative_review`). [CONFIRMED/DERIVED]

- Registry state `ANDHRA PRADESH`, source state label `Andhra Pradesh`, district unresolved, source district label one of
  `hyderabad, warangal, nalgonda, medak, mahbubnagar, adilabad, karimnagar, nizamabad`.
- **Official statement of the boundary**: LGD lists Telangana as state code 36 and the eNAM directory lists **57 Telangana mandis** under its own
  state heading. The registry holds **0** mandis under Telangana.
- eNAM text signal: **4** name-column text candidates in the Telangana section (Gajwel, Karimnagar ×2 entries, Nizamabad), **12** address/district-only
  mentions, **11** none. **None** of the 27 has a candidate in the eNAM Andhra Pradesh section. The weak signal supports "these are not Andhra
  mandis" but identifies a district for few of them. Several are state-run _Rythu Bazar_ markets that eNAM does not list.
- Evidence still required for each: an official register entry (Telangana Agricultural Marketing Department, or the AGMARKNET market record) giving the
  market yard's district, then a reviewed state-correction decision (two-person rule).

## 6. Candidate geography matches produced

- **States**: 36/36 exact on code and name against the official LGD list — **verified by identifier**, class V (state level only).
- **Districts**: not produced — the official district reference is blocked. Matching the 49 labels against the community mirror would repeat Stage 1 and
  is not authoritative, so it was not done.
- **Mandis**: the eNAM text-candidate report above (read-only, in memory; stored only as derived files outside Git).

## 7. Does the proposed schema need modification? (recommendation)

The Stage 1 plan listed seven new objects (the brief calls them the six-table schema; `mapping_set` is the seventh). Based on the real source structures:

| Object                                                      | Change recommended                                                                                                                                                                                                                      | Reason from the sources                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `geo_reference_set`                                         | add `access_method` (public page / CAPTCHA download / API / manual), `terms_note`, `retrieval_notes`, `raw_file_sha256` list                                                                                                            | LGD content arrives from pages, forms and PDFs, not one file                                                               |
| `admin_unit_version`                                        | add `version`, `minor_version`, `census_2011_code`, `order_no`, `order_date`, `gazette_date`, `go_file_ref`, **`lgd_effective_date` and separate `legal_effective_date`**, `lgd_effective_is_baseline` flag, `status` (Active/Inactive) | the LGD record has exactly these fields; 31/36 effective dates are the 2005 baseline; Telangana differs from the legal day |
| `market_registry_entry`                                     | make `registry_market_id` **nullable**; add `source_row_ref` (page + serial within state), `postal_address`, `pin_code`, `contact_number`, `commodity_groups`, `listing_as_of`                                                          | eNAM has no identifier; a serial is only a row position in one edition                                                     |
| `market_identity_link`                                      | allow link class `address_pin_corroboration`; never `identifier` for eNAM                                                                                                                                                               | no eNAM identifier exists                                                                                                  |
| `identity_decision`, `identity_review_event`, `mapping_set` | no change                                                                                                                                                                                                                               | as designed                                                                                                                |
| New (optional)                                              | a small `pin_district_evidence` concept only if a PIN→district source is approved                                                                                                                                                       | eNAM gives PINs, LGD does not; not an LGD attribute                                                                        |

No change to observations, aliases' source labels, `states` or `districts`.

## 8. Recommendations for Stage 3

1. **Unblock districts** (owner action): download "All Districts of India" and "Download Only Modifications" from the LGD Download Directory by hand
   (procedure in REFERENCE_ACQUISITION.md), or approve a person-run NAPIX registration. This is the gating item.
2. Then, still read-only: validate district codes (duplicates, missing, per-state counts vs the registry's 763), diff the official list against the 2022 mirror,
   and classify the 49 labels using the official names and the modification list (dated, with orders).
3. Decide the mandi-identity source: the eNAM directory is corroboration only. Candidates to evaluate next: AGMARKNET market records (identifiers inside the portal),
   the Telangana Agricultural Marketing Department list for the 27, and state APMC lists. Each needs a terms check.
4. Only after 1–3, and after approval of the schema in section 7, proceed to the additive migration on a disposable database.
5. Re-check LGD for `Keralam` on each retrieval and attach the primary Gazette PDF as evidence.

## 9. Corrections and cautions for earlier documents

- AUTHORITATIVE_SOURCES.md and the plan now state which items are **verified** rather than "not verified" (updated in this stage).
- The Stage 1 note that LGD CSV download "may no longer work" is refined: bulk download exists but requires a CAPTCHA; it is not machine-retrievable.
- The brief's eNAM URL (`/web/assest/download/...`) returns an HTML shell; the working link is `/assest/download/...`.
- The LGD states page and each state's detail page are **public**; do not treat the CAPTCHA-gated pages as the only official route for states.

## 10. Safety record

Read-only database sessions only; no migration, no insert, no registry/alias/observation change; no CAPTCHA, login, API key or account was used;
the page-embedded data.gov.in API key was ignored; no village, ward or local-body data and no community mirror were downloaded; Stitch frontend and Docker
services untouched; nothing staged, committed or pushed.
