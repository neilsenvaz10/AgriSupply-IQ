# District-resolution review report (Milestone 2.4, Stage 2 completion)

Date: 2026-10-20. **Nothing in this report has been applied.** The registry, aliases, observations and source labels are unchanged; matches below are
_evidence for a future reviewed decision_. Machine-readable version: [`district_resolution_review_report.csv`](./district_resolution_review_report.csv)
(49 rows) and [`telangana_suspect_mandis_review_queue.csv`](./telangana_suspect_mandis_review_queue.csv) (27 rows).

Sources: the official LGD _All Districts Of India_ report downloaded by the owner on 2026-10-20 (784 active districts) and the official public LGD per-district
detail and version-history pages for the 91 districts that matter here (see REFERENCE_ACQUISITION.md). Name evidence is **not** the same as a geographic reassignment
decision: only the Telangana group below involves a possible change of state.

## 1. Result at a glance (49 unresolved district alias rows, 86,427 observations)

| Group                                                     | Labels | Observations | Meaning                                                                                                                                        |
| --------------------------------------------------------- | -----: | -----------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Confirmed by official name evidence**                |     23 |       38,436 | The label equals an official LGD district name, or is a **former name in that district's LGD version history**, inside the same resolved state |
| **2. Uncertain: spelling candidates**                     |     15 |       32,701 | One plausible official district, but nothing in the official files ties the label to it                                                        |
| **3. Ambiguous**                                          |      3 |        6,355 | Several official districts fit (Bangalore, Delhi, Kanpur)                                                                                      |
| **4. State-boundary (Telangana labelled Andhra Pradesh)** |      8 |        8,935 | Every label is a district of **Telangana** in the official list and of none in Andhra Pradesh; mandi-level decisions needed                    |

"Confirmed" means _the official name evidence is sufficient for a reviewer to accept a name-level alias inside the same state_. It is still a reviewed decision; nothing is verified or
applied until it is made (design: class V needs an identifier or an official dated record plus a reviewer).

## 2. Group 1 — confirmed by official name evidence (23 labels, 38,436 observations)

| Source state / district label   | Obs.  | Mandis | Official LGD district (code)   | Official evidence                                                  | Current version effective |
| ------------------------------- | ----- | ------ | ------------------------------ | ------------------------------------------------------------------ | ------------------------- |
| Haryana / yamuna nagar          | 6,052 | 6      | Yamunanagar (76)               | exact once spaces are ignored                                      | 01/01/2005                |
| Haryana / gurgaon               | 4,503 | 4      | Gurugram (62)                  | former name in LGD history: Gurgaon > Gurugram                     | 09/01/2017                |
| Haryana / mewat                 | 3,133 | 4      | Nuh (604)                      | former name in LGD history: Mewat > Nuh                            | 16/11/2016                |
| Punjab / muktsar                | 3,007 | 4      | Sri Muktsar Sahib (39)         | former name in LGD history: Muktsar > Sri Muktsar Sahib            | 16/03/2015                |
| West Bengal / north 24 parganas | 2,814 | 2      | North 24 Parganas (303)        | exact current official name                                        | 11/07/2019                |
| Gujarat / ahmedabad             | 2,767 | 5      | Ahmedabad (438)                | exact current official name                                        | 08/04/2016                |
| Orissa / keonjhar               | 2,118 | 5      | Kendujhar (361)                | former name in LGD history: Kendujhar > Keonjhar                   | 22/06/2026                |
| Tamilnadu / kancheepuram        | 2,054 | 6      | Kancheepuram (574)             | exact current official name                                        | 28/03/2020                |
| Madhya Pradesh / hoshangabad    | 1,940 | 9      | Narmadapuram (409)             | former name in LGD history: Hoshangabad > Narmadapuram             | 07/02/2022                |
| Uttar Pradesh / ambedkarnagar   | 1,887 | 1      | Ambedkar Nagar (121)           | exact once spaces are ignored                                      | 01/01/2005                |
| Gujarat / dahod                 | 1,822 | 4      | Dahod (445)                    | exact current official name                                        | 01/01/2005                |
| Karnataka / chikmagalur         | 1,288 | 5      | Chikkamagaluru (532)           | former name in LGD history: Chikmagalur > Chikkamagaluru           | 14/01/2015                |
| Karnataka / shimoga             | 1,175 | 3      | Shivamogga (547)               | former name in LGD history: Shimoga > Shivamogga                   | 14/01/2015                |
| Karnataka / belgaum             | 800   | 5      | Belagavi (527)                 | former name in LGD history: Belgaum > Belagavi                     | 14/01/2015                |
| Punjab / nawanshahr             | 785   | 5      | Shahid Bhagat Singh Nagar (40) | former name in LGD history: Nawanshahr > Shahid Bhagat Singh Nagar | 29/09/2008                |
| Karnataka / mysore              | 681   | 6      | Mysuru (545)                   | former name in LGD history: Mysore > Mysuru                        | 14/01/2015                |
| Uttar Pradesh / kushinagar      | 560   | 1      | Kushinagar (160)               | exact current official name                                        | 01/01/2005                |
| Gujarat / sabarkantha           | 519   | 5      | Sabar Kantha (458)             | exact once spaces are ignored                                      | 03/07/2015                |
| Karnataka / bijapur             | 198   | 3      | Vijayapura (530)               | former name in LGD history: Bijapur > Vijayapura                   | 14/01/2015                |
| Karnataka / bellary             | 154   | 2      | Ballari (528)                  | former name in LGD history: Bellary > Ballari                      | 15/11/2021                |
| Karnataka / tumkur              | 119   | 3      | Tumakuru (548)                 | former name in LGD history: Tumkur > Tumakuru                      | 14/01/2015                |
| Karnataka / bagalkot            | 43    | 2      | Bagalkote (524)                | former name in LGD history: Bagalkot > Bagalkote                   | 04/02/2015                |
| Orissa / jajpur                 | 17    | 1      | Jajpur (356)                   | exact current official name                                        | 01/01/2005                |

Notes:

- The **exact** rows (9) would already resolve with the current rule if the registry used the official spelling; the registry still carries the
  2022 mirror's spelling for several (e.g. AHMADABAD, DOHAD). Three need the rule to ignore internal spaces (Yamunanagar, Sabar Kantha, Ambedkar Nagar).
- The **former-name** rows come from LGD's own version history, e.g. Mewat → Nuh (effective 16/11/2016), Gurgaon → Gurugram (09/01/2017), Hoshangabad → Narmadapuram (07/02/2022),
  Muktsar → Sri Muktsar Sahib (16/03/2015), Nawanshahr → Shahid Bhagat Singh Nagar (29/09/2008), Karnataka's 2014-15 respellings (effective 14/01/2015 and later), Bellary → Ballari (15/11/2021).
  The date shown is the effective date of the district's **current** version only; older versions' dates are not displayed on the history page.
- All these renames took effect **before the first observation (2023-06-06)** except `keonjhar` (the official spelling changed again on 22/06/2026, after the data window; the label is a
  former spelling of the same code). So, inside the data window, the label was the correct name for these rows in most cases.
- `thiruchirappalli` appears under two state spellings (`Tamilnadu`, `Tamil Nadu`): it is one district, two alias rows.

## 3. Group 2 — uncertain: spelling candidates (15 labels, 32,701 observations)

| Source state / district label | Obs.   | Mandis | Candidate official district (code) | Why only a candidate                          |
| ----------------------------- | ------ | ------ | ---------------------------------- | --------------------------------------------- |
| Uttar Pradesh / bulandshahar  | 10,713 | 9      | Bulandshahr (134)                  | spelling differs; no former name in the files |
| Uttar Pradesh / badaun        | 7,341  | 8      | Budaun (133)                       | spelling differs; no former name in the files |
| West Bengal / puruliya        | 3,450  | 3      | Purulia (321)                      | spelling differs; no former name in the files |
| Maharashtra / sholapur        | 3,278  | 12     | Solapur (496)                      | spelling differs; no former name in the files |
| Tamilnadu / thirunelveli      | 2,110  | 8      | Tirunelveli (592)                  | spelling differs; no former name in the files |
| Maharashtra / amarawati       | 1,870  | 13     | Amravati (468)                     | spelling differs; no former name in the files |
| Orissa / khurda               | 1,805  | 4      | Khordha (362)                      | spelling differs; no former name in the files |
| Madhya Pradesh / khandwa      | 1,461  | 7      | Khandwa (East Nimar) (405)         | spelling differs; no former name in the files |
| Orissa / angul                | 403    | 5      | Anugola (344)                      | spelling differs; no former name in the files |
| Chattisgarh / janjgir         | 100    | 4      | Janjgir-Champa (379)               | spelling differs; no former name in the files |
| Madhya Pradesh / anupur       | 89     | 3      | Anuppur (390)                      | spelling differs; no former name in the files |
| Kerala / palakad              | 39     | 2      | Palakkad (563)                     | spelling differs; no former name in the files |
| Tamilnadu / thiruchirappalli  | 26     | 2      | Tiruchirappalli (591)              | spelling differs; no former name in the files |
| Tamil Nadu / thiruchirappalli | 13     | 3      | Tiruchirappalli (591)              | spelling differs; no former name in the files |
| Tamil Nadu / thiruvannamalai  | 3      | 1      | Tiruvannamalai (593)               | spelling differs; no former name in the files |

Each has exactly one plausible official district by spelling, but the official files contain no former-name or alias record for it. A reviewer needs one more
official fact (a state district list, a gazette, or the market's own register). Example: `khandwa` is an official respelling of East Nimar → Khandwa (East Nimar), effective
**05/10/2023, inside the data window**: before that date the official name was East Nimar.

## 4. Group 3 — ambiguous (3 labels, 6,355 observations)

| Source state / district label | Obs.  | Mandis | Official candidates                           |
| ----------------------------- | ----- | ------ | --------------------------------------------- |
| Delhi / delhi                 | 3,713 | 5      | 13 official Delhi districts (none is "Delhi") |
| Karnataka / bangalore         | 2,639 | 7      | Bengaluru Urban                               | Bengaluru Rural | Bengaluru South |
| Uttar Pradesh / kanpur        | 3     | 1      | Kanpur Nagar                                  | Kanpur Dehat    |

These cannot be resolved from names. They need the individual mandi's location (an official register entry).

## 5. Group 4 — state boundary: the 8 Telangana districts under an Andhra Pradesh label (8,935 observations, 27 mandis)

| Source label (state label Andhra Pradesh) | Obs.  | Mandis | Official district under TELANGANA (code)                  | LGD version history of that district                              |
| ----------------------------------------- | ----- | ------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| hyderabad                                 | 4,984 | 5      | Hyderabad (507)                                           | Hyderabad (current version effective 17/06/2014)                  |
| warangal                                  | 1,379 | 2      | Warangal (522)                                            | Warangal > Warangal Rural (current version effective 12/08/2021)  |
| nalgonda                                  | 899   | 2      | Nalgonda (514)                                            | Nalgonda (current version effective 16/11/2016)                   |
| medak                                     | 784   | 6      | Medak (513)                                               | Medak (current version effective 11/10/2016)                      |
| mahbubnagar                               | 678   | 4      | Mahabubnagar (512) [spelling variant, not an exact match] | Mahbubnagar > Mahabubnagar (current version effective 19/02/2019) |
| adilabad                                  | 174   | 5      | Adilabad (501)                                            | Adilabad (current version effective 16/11/2016)                   |
| karimnagar                                | 35    | 2      | Karimnagar (508)                                          | Karimnagar (current version effective 11/10/2016)                 |
| nizamabad                                 | 2     | 1      | Nizamabad (516)                                           | Nizamabad (current version effective 11/10/2016)                  |

Official evidence (state level): LGD lists Telangana as state code 36 and its 33 districts (codes 501–522 are the districts inherited from undivided Andhra Pradesh, 680–721 were created
2016–2021); the Andhra Pradesh list (28 districts) has none of these names. **Evidence level: name existence only.** The files contain no town-to-district data and no
predecessor/successor links, so they cannot say _which_ current Telangana district a market yard sits in. Several source labels are the **old undivided district** (Medak,
Nalgonda, Karimnagar, Warangal, Mahbubnagar, Adilabad, Nizamabad): e.g. Warangal (code 522) shows 17 versions with the names Warangal and Warangal Rural (current name Warangal, effective 12/08/2021), Hanumakonda (686) lists Warangal Urban
as its former name (effective 12/08/2021), and Sangareddy (691) and Siddipet (692) have an effective date of 11/10/2016 (the files do not say from which districts they were formed). The label `mahbubnagar` is the pre-2019 spelling of Mahabubnagar (renamed 19/02/2019).

### The 27 mandis (8,935 observations)

Per-mandi evidence is in the review queue CSV. Summary:

| Evidence per mandi                                                                          | Mandis |
| ------------------------------------------------------------------------------------------- | -----: |
| label district has an exact same-name district under Telangana                              |     23 |
| label district is a spelling variant of a Telangana district (`mahbubnagar` → Mahabubnagar) |      4 |
| the mandi's own name also equals an official Telangana district name                        |      9 |
| label district and name-derived district differ (split district)                            |      3 |
| any candidate under Andhra Pradesh                                                          |      0 |
| eNAM 2021 directory text signal (Telangana section, name column)                            |      4 |

**No mandi is moved.** For each, the candidate is "state TELANGANA" with the district to be decided from an official register (Telangana Agricultural Marketing Department
or the AGMARKNET market record). The state-level data already treats Telangana as a separate state (111,999 state-level rows) and the eNAM directory lists 57 Telangana mandis, so
the registry's 0 mandis under Telangana is a labelling error in the mandi file's state field, per mandi, until shown otherwise.

## 6. Comparison of the official district list with the 2022 registry (763 districts)

| Measure                                                                                    | Count |
| ------------------------------------------------------------------------------------------ | ----: |
| Official active districts (as of 2026-10-20)                                               |   784 |
| Duplicate codes / duplicate (state, name) pairs in the official file                       | 0 / 0 |
| Registry districts                                                                         |   763 |
| Identical code, name and state                                                             |   699 |
| Same code, **different name** (renamed or respelled since the mirror)                      |    61 |
| Same code, **different state**                                                             |     0 |
| **New** official codes absent from the registry (created or restructured after the mirror) |    24 |
| Registry codes **absent** from the official active list                                    |     3 |

- **New districts (24):** Andhra Pradesh Markapuram (790), Polavaram (791); Arunachal Pradesh Bichom (787), Keyi Panyor (786); Delhi Central North (796), Old Delhi (795), Outer North (794);
  Goa Kushavati (793); Gujarat Vav-Tharad (789); Haryana Hansi (792); Madhya Pradesh Maihar (784), Mauganj (766), Pandhurna (785); Nagaland Meluri (788), Niuland (764), Shamator (765);
  Rajasthan Balotra (775), Beawar (774), Deeg (767), Didwana-Kuchaman (768), Khairthal-Tijara (770), Kotputli-Behror (782), Phalodi (772), Salumbar (777).
- **Absent from the active list (3):** Shahdara (Delhi, 671), Mahe (Puducherry, 599), Yanam (Puducherry, 601). LGD's history pages for all three show only **Inactive** versions.
  **No registry mandi belongs to any of them.**
- **Renamed, same code (61):** includes real renamings — Ahmednagar → Ahilyanagar, Aurangabad → Chhatrapati Sambhajinagar, Osmanabad → Dharashiv, Karimganj → Sribhumi, Ramanagara →
  Bengaluru South (code 631, effective 23/05/2025), Y.S.R. → Y.S.R. Kadapa — and spelling/transliteration changes (Odisha: Anugola, Baragada, Debagada, Kendujhar, Khordha …). **70 resolved mandis
  (27,442 observations) sit in 15 such districts**: their `district_id` stays valid (same code), only the display name would change.
- Names alone are not a stable key: the Odisha respelling of 22/06/2026 shows that even the _current_ official spelling moves; the **LGD code** is the stable identifier.
- The 2022 mirror's other differences (Delhi 11 → 13, Rajasthan 33 → 41, Nagaland 14 → 17) are post-2022 reorganisations; none touches a registry mandi's resolved district today.

## 7. What these files can and cannot prove

| Can                                                                                                                                                                                | Cannot                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The set of active districts and their codes today; former names and the current version's effective date (public history pages); that the Telangana labels are Telangana districts | Which district a given market yard is in; predecessor/successor links for split districts; effective dates of **older** versions; the complete dated change log (the CAPTCHA-gated modification list was not obtained) |
