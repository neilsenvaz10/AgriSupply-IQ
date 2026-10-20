# Geographic data-quality review (Milestone 2.3D)

Status: **investigation only.** Nothing in this document has been applied. No registry, alias, state or
district mapping, observation row or ingestion record was changed while writing it, and no mandi is
claimed to be officially verified (all 1,610 remain `unverified`).

Sources of the figures below: `GET /api/v1/geography/unresolved`, `GET /api/v1/states`, and
`database/reports/development-import/alias-resolution-report.json` (read only).

## 1. What is unresolved today

| Item                                                               | Count                                                                                      | Where it shows up                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| District labels that match no district inside their resolved state | **49**                                                                                     | `/geography/unresolved` → `districts`; mandi rows carry `district_status: "unresolved"` |
| Observations under those 49 labels                                 | **86,427** (of 2,698,327)                                                                  | the sum of per-label counts                                                             |
| Mandi–label pairs affected (sum of per-label market counts)        | 215                                                                                        | a mandi appears once per label it was seen with                                         |
| State label with no mapping                                        | **1** (`Gao`)                                                                              | 4 rows **quarantined**, not in the observation tables                                   |
| State labels flagged for review                                    | 11 (10 mapped by a reviewed decision, 1 unresolved); `Keralam` is exposed as `provisional` | `/states` → `source_labels[].mapping_status`                                            |

The reference set is `lgd-github-mirror-2022-12`: a community mirror of the Local Government Directory as
of December 2022, marked **provisional-historical** (36 states and UTs, 763 districts). It is not an
official publication and it is not current.

A district resolves only by an exact, case/whitespace-insensitive match **inside its already-resolved
state**. There is no fuzzy matching, by design. The 49 labels are therefore exactly the labels that this
strict rule could not match; most of them are plain spelling or renaming differences, but that is a
hypothesis until it is checked against an authoritative source (section 5).

## 2. The 49 unresolved district labels, grouped by likely cause

The "likely cause" column is **a hypothesis from general knowledge, not evidence**. Nothing here may be
applied without the evidence listed in section 5. Counts are observations, then mandis.

### A. Transliteration or spelling variant of a district that probably exists in the reference (30)

| Source state / label            |   Obs. | Mandis | Candidate (unconfirmed)              |
| ------------------------------- | -----: | -----: | ------------------------------------ |
| Uttar Pradesh / bulandshahar    | 10,713 |      9 | Bulandshahr                          |
| Uttar Pradesh / badaun          |  7,341 |      8 | Budaun                               |
| Haryana / yamuna nagar          |  6,052 |      6 | Yamunanagar                          |
| West Bengal / puruliya          |  3,450 |      3 | Purulia                              |
| Maharashtra / sholapur          |  3,278 |     12 | Solapur                              |
| Punjab / muktsar                |  3,007 |      4 | Sri Muktsar Sahib                    |
| West Bengal / north 24 parganas |  2,814 |      2 | North Twenty Four Parganas           |
| Gujarat / ahmedabad             |  2,767 |      5 | Ahmadabad                            |
| Orissa / keonjhar               |  2,118 |      5 | Kendujhar                            |
| Tamilnadu / thirunelveli        |  2,110 |      8 | Tirunelveli                          |
| Tamilnadu / kancheepuram        |  2,054 |      6 | Kancheepuram / Kanchipuram           |
| Uttar Pradesh / ambedkarnagar   |  1,887 |      1 | Ambedkar Nagar                       |
| Maharashtra / amarawati         |  1,870 |     13 | Amravati                             |
| Gujarat / dahod                 |  1,822 |      4 | Dohad                                |
| Orissa / khurda                 |  1,805 |      4 | Khordha                              |
| Karnataka / chikmagalur         |  1,288 |      5 | Chikkamagaluru                       |
| Karnataka / shimoga             |  1,175 |      3 | Shivamogga                           |
| Karnataka / belgaum             |    800 |      5 | Belagavi                             |
| Punjab / nawanshahr             |    785 |      5 | Shahid Bhagat Singh Nagar            |
| Karnataka / mysore              |    681 |      6 | Mysuru                               |
| Gujarat / sabarkantha           |    519 |      5 | Sabar Kantha                         |
| Orissa / angul                  |    403 |      5 | Anugul                               |
| Karnataka / bijapur             |    198 |      3 | Vijayapura                           |
| Karnataka / bellary             |    154 |      2 | Ballari                              |
| Karnataka / tumkur              |    119 |      3 | Tumakuru                             |
| Chattisgarh / janjgir           |    100 |      4 | Janjgir-Champa                       |
| Madhya Pradesh / anupur         |     89 |      3 | Anuppur                              |
| Karnataka / bagalkot            |     43 |      2 | Bagalkote                            |
| Kerala / palakad                |     39 |      2 | Palakkad                             |
| Orissa / jajpur                 |     17 |      1 | Jajpur (check spelling in reference) |

Several of these are official **renamings** (Bengaluru, Mysuru, Belagavi, Kendujhar, Khordha and others),
which means a rename date matters: a 2022 reference may carry either the old or the new spelling.

### B. Renamed after, or administratively changed around, the reference date (7 labels)

| Source state / label          |  Obs. | Mandis | Note (unconfirmed)                                                                                                                                 |
| ----------------------------- | ----: | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Haryana / gurgaon             | 4,503 |      4 | Renamed Gurugram in 2016; the reference may use either form                                                                                        |
| Haryana / mewat               | 3,133 |      4 | Renamed Nuh in 2016                                                                                                                                |
| Madhya Pradesh / hoshangabad  | 1,940 |      9 | Renamed Narmadapuram; the date and the reference's spelling must be checked                                                                        |
| Madhya Pradesh / khandwa      | 1,461 |      7 | Possibly listed as East Nimar (Khandwa)                                                                                                            |
| Tamil Nadu / thiruvannamalai  |     3 |      1 | Spelling of Tiruvannamalai                                                                                                                         |
| Tamil Nadu / thiruchirappalli |    13 |      3 | Spelling of Tiruchirappalli; the same district also appears as `Tamilnadu` / thiruchirappalli (26 obs., 2 mandis), so it has two unresolved labels |

### C. State boundary issue, not a spelling issue (8)

Eight labels sit under `Andhra Pradesh` although the districts belong to **Telangana** in a post-2014
reference: `hyderabad` (4,984 obs., 5 mandis), `warangal` (1,379), `nalgonda` (899), `medak` (784),
`mahbubnagar` (678), `adilabad` (174), `karimnagar` (35), `nizamabad` (2). This is probably the source
using a pre-2014 state for older rows. Because districts resolve only inside the resolved state, these
**cannot** match by design, and correcting the district would also mean changing the _state_ of the mandi,
which is a different and larger decision than a spelling alias. Not applied.

### D. Ambiguous, or needing a closer look (4)

| Source state / label       |  Obs. | Mandis | Why it is ambiguous                                                                                                              |
| -------------------------- | ----: | -----: | -------------------------------------------------------------------------------------------------------------------------------- |
| Karnataka / bangalore      | 2,639 |      7 | Bengaluru Urban versus Bengaluru Rural                                                                                           |
| Delhi / delhi              | 3,713 |      5 | Delhi has several districts; "delhi" names the territory, not one of them                                                        |
| Uttar Pradesh / kanpur     |     3 |      1 | Kanpur Nagar versus Kanpur Dehat                                                                                                 |
| Uttar Pradesh / kushinagar |   560 |      1 | Probably a spelling variant (Kushinagar), but the reference spelling has not been checked, so it is listed here rather than in A |

An ambiguous label must **not** be resolved by choosing the most likely target. It needs the mandi's
actual location or APMC record.

Totals: 30 + 7 + 8 + 4 = 49 labels. All of the groupings are hypotheses; none has been verified.

## 3. `Keralam` (provisional state mapping)

- The label `Keralam` occurs only in the state-level dataset (128,371 observations).
- It is mapped to `KERALA` by a **reviewed decision**, stored as `mapping_status: provisional`.
- The recorded rationale: the English name was changed to Keralam by the Kerala (Alteration of Name) Act
  2026, notified 2026-08-25 **according to press reports**; the primary gazette was **not retrieved**; the
  2022 reference lists the state as KERALA; the dataset has no other Kerala label.
- Consequence: state-level Kerala data is queryable and is labelled provisional in the API and UI. It is
  not described as official anywhere.
- **Evidence still needed to promote it:** the Gazette of India notification (number and date), and the
  LGD entry reflecting the name, ideally with the LGD state code (the reference carries code `32`).
- Risk if wrong: low for values (the rows are state totals and nothing is merged with another state), but
  a wrong alias would attach 128,371 observations to the wrong name, so it stays provisional until the
  gazette is read.

## 4. `Gao` (unresolved state, 4 rows quarantined)

- `Gao` is not a recognised state name. The 4 rows are **quarantined**: they are not in the observation
  tables and so appear in no price view.
- The rows carry the district label `north goa`, which exists only under GOA in the 2022 mirror. That
  supports Goa, but it is an inference from a second unverified label, so the reviewed decision records it
  as **not applied** and flags it for an owner decision.
- Candidate: Goa (likely a typo). Impact if left: 4 observations missing from Goa; none visible anywhere.
- **Evidence needed:** the original source rows (market, commodity, date) cross-checked against a
  Goa APMC list, or the dataset publisher's confirmation. Until then the rows stay quarantined.

## 5. Requirements for an authoritative LGD reference

To replace the provisional mirror and settle sections 2–4, the project needs:

1. **Official LGD export** from lgdirectory.gov.in (the Ministry of Panchayati Raj / NIC), with the
   retrieval date, licence (GODL-India) and a checksum recorded in the manifest, not a community mirror.
2. **Current codes and names** for states, UTs and districts, with the **effective dates** of each
   rename, split and merge, so that an old label can be mapped _as of the observation date_.
3. **A change history table** (old name → new name, date, gazette reference) for the Telangana
   reorganisation, the Andhra Pradesh/Telangana district splits and the renamings in section 2B.
4. **A mandi reference.** LGD covers administrative areas, not markets. A market registry would need an
   APMC / eNAM / AGMARKNET market list. No mandi may be called verified until it matches one.
5. **A review process**: each alias is a reviewed decision recorded with the evidence and reviewer, as the
   existing state decisions are, and districts keep resolving only inside a resolved state.

## 6. Which corrections need external evidence

| Correction                               | Evidence needed before applying                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Group A spelling aliases (30 labels)     | Authoritative district list showing the target spelling; for renamed districts the rename date                          |
| Group B renamings and changes (7 labels) | Gazette or LGD change record with date; confirmation of which spelling the reference uses                               |
| Group C Telangana districts (8 labels)   | Reference state for the district, plus the decision to change the _state_ of the mandi (and every observation under it) |
| Group D ambiguous labels (4 labels)      | Mandi location or APMC record; never a guess                                                                            |
| `Keralam` → Kerala                       | The gazette notification                                                                                                |
| `Gao` → Goa                              | Source-row confirmation or publisher statement                                                                          |
| Marking any mandi verified               | A market reference list match (point 4 above)                                                                           |

Nothing in this milestone may substitute for that evidence, and none of the above has been done.

## 7. How the application treats the uncertainty today

- Every mandi is shown as `unverified`; an unresolved district is shown with the source's own label and
  a note that it is not mapped to the reference. The "Latest by mandi" cards do the same.
- Unresolved districts stay out of district filters (they have no district id); the state filter still
  finds them. Nothing falls back to a guessed district.
- State-level prices are never used to fill a missing mandi value.

## 8. Open decisions for the owner

1. Approve a process and an authoritative source for the LGD import (section 5).
2. Decide whether the Telangana districts under `Andhra Pradesh` should be re-stated (a data-model
   decision, not an alias).
3. Decide on `Gao` and `Keralam` once evidence is available.
4. Choose how to handle ambiguous labels (D): leave unresolved, or collect location evidence per mandi.
