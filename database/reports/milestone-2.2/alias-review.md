# State and union-territory alias review (Milestone 2.2)

Ten reviewed decisions live in `database/reference/aliases/state-aliases.csv`. They apply to every source (`*`). Nothing is matched fuzzily; a label resolves only by one of these decisions or by an exact case/whitespace-insensitive match to the provisional December 2022 LGD mirror. Row counts were taken directly from the raw files.

| #   | Source label          | Proposed canonical state/UT                       | Reference evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Confidence / status                                                      | Applied automatically?                                                                 | Manual approval required?                                                                                                  |
| --- | --------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Chattisgarh`         | CHHATTISGARH (22)                                 | Spelling variant; LGD 2022 state 22 is CHHATTISGARH. Dataset A uses both spellings (districts rajnandgaon, durg, janjgir under this one are Chhattisgarh districts). A: 2,603 rows; B: 73,596 rows                                                                                                                                                                                                                                                                                                   | High                                                                     | Yes, through the reviewed decision file (not guessed)                                  | Routine sign-off                                                                                                           |
| 2   | `Orissa`              | ODISHA (21)                                       | Official rename (Orissa (Alteration of Name) Act 2011); LGD 2022 state 21 is ODISHA. Districts bargarh, dhenkanal, keonjhar, khurda are Odisha districts. A: 20,633 rows                                                                                                                                                                                                                                                                                                                             | High                                                                     | Yes, reviewed decision                                                                 | Routine sign-off                                                                                                           |
| 3   | `Tamilnadu`           | TAMIL NADU (33)                                   | Spacing variant; LGD state 33. Dataset A also uses the correct spelling for 26 other rows. A: 66,602 rows                                                                                                                                                                                                                                                                                                                                                                                            | High                                                                     | Yes, reviewed decision                                                                 | Routine sign-off                                                                                                           |
| 4   | `Uttrakhand`          | UTTARAKHAND (5)                                   | Spelling variant; LGD state 5. Its only district, champawat, is an Uttarakhand district. A: 46 rows                                                                                                                                                                                                                                                                                                                                                                                                  | High                                                                     | Yes, reviewed decision                                                                 | Routine sign-off                                                                                                           |
| 5   | `Jammu & Kashmir`     | JAMMU AND KASHMIR (1)                             | Ampersand variant of the LGD name (union territory, code 1). Ladakh is a separate LGD entity (37) and is not merged. A: 5,299 rows                                                                                                                                                                                                                                                                                                                                                                   | High                                                                     | Yes, reviewed decision                                                                 | Routine sign-off                                                                                                           |
| 6   | `NCT of Delhi`        | DELHI (7)                                         | Official long name of the union territory; LGD 2022 lists DELHI (7). B: 89,064 rows                                                                                                                                                                                                                                                                                                                                                                                                                  | High                                                                     | Yes, reviewed decision                                                                 | Routine sign-off                                                                                                           |
| 7   | `Pondicherry`         | PUDUCHERRY (34)                                   | Former name (renamed 2006); LGD 2022 lists PUDUCHERRY (34). B: 3,796 rows                                                                                                                                                                                                                                                                                                                                                                                                                            | High                                                                     | Yes, reviewed decision                                                                 | Routine sign-off                                                                                                           |
| 8   | `Andaman and Nicobar` | ANDAMAN AND NICOBAR ISLANDS (35)                  | Truncated label; no other Andaman or Nicobar entity exists in LGD 2022. B: 6,409 rows                                                                                                                                                                                                                                                                                                                                                                                                                | High                                                                     | Yes, reviewed decision                                                                 | Routine sign-off                                                                                                           |
| 9   | `Keralam`             | KERALA (32) - applied, pending owner confirmation | The 2022 LGD mirror cannot evidence this: it lists only KERALA. External evidence: press reports say the Kerala (Alteration of Name) Act 2026 was notified on 2026-08-25, making Keralam the official English name; I did not retrieve the gazette itself. Internal evidence: dataset B has no other Kerala label while it lists the other states under their usual names; dataset A's Kerala labels use Kerala districts. B: 131,223 rows (dated from 2022-01-01, so the source relabelled history) | Medium-high (identity is very likely; documentary evidence is secondary) | Yes, through the reviewed decision file, which I wrote (the importer did not guess it) | YES: confirm against the gazette or an official LGD export. If rejected, 131,223 rows of B move to quarantine on re-import |
| 10  | `Gao`                 | unresolved (not mapped)                           | Not a state name. Its 4 rows (dataset A) carry district north goa, which exists only under GOA in the LGD 2022 mirror, so Goa is plausible. That is inference from a second unverified label, so it is NOT applied                                                                                                                                                                                                                                                                                   | Unresolved                                                               | No: kept unresolved; 4 rows quarantined (unmapped_entity)                              | YES: an owner decision is needed to map it to Goa; 4 rows                                                                  |

All ten decisions were authored by this project's tooling, not supplied by an authority, so a project-owner sign-off is recommended for every one; `Keralam` and `Gao` are the two that matter.

## Owner decisions (2026-10-19)

- The eight routine aliases (`Chattisgarh`, `Orissa`, `Tamilnadu`, `Uttrakhand`, `Jammu & Kashmir`, `NCT of Delhi`, `Pondicherry`, `Andaman and Nicobar`) are **approved**; source labels and provenance are retained.
- `Keralam` -> Kerala stays a **provisional** alias pending authoritative confirmation.
- `Gao` stays **unresolved**; it is not mapped to Goa automatically.
- The 49 unresolved district labels stay explicitly flagged; no verified district identity is created for them.
- Importer 2.2.1 and the reconciled counts are accepted.

Sources for the Keralam rename (press reports; secondary): https://www.onmanorama.com/news/kerala/2026/08/26/its-official-kerala-is-now-keralam-as-centre-notifies-name-change.html and https://www.gktoday.in/kerala-officially-renamed-keralam/

# Unresolved district labels (dataset A, 49 labels)

A district label is unresolved when it is not in its resolved state's list in the December 2022 LGD mirror. Their rows are accepted unless they fail another check (38 of them did): their markets keep the source district label as part of their identity, so same-named mandis in different districts never merge. Total affected: **86,465 of 737,392 rows (11.7%)** in **213 market records (86,427 accepted observations)**. Most are spelling variants of real districts (for example `bulandshahar`, `badaun`, `sholapur`) or districts renamed or created after 2022 (for example `yamuna nagar`, `puruliya`); none is guessed.

| State label    | District label    |   Rows | Markets |
| -------------- | ----------------- | -----: | ------: |
| uttar pradesh  | bulandshahar      | 10,716 |       9 |
| uttar pradesh  | badaun            |  7,343 |       8 |
| haryana        | yamuna nagar      |  6,052 |       6 |
| andhra pradesh | hyderabad         |  4,984 |       5 |
| haryana        | gurgaon           |  4,503 |       4 |
| delhi          | delhi             |  3,713 |       5 |
| west bengal    | puruliya          |  3,452 |       3 |
| maharashtra    | sholapur          |  3,278 |      12 |
| haryana        | mewat             |  3,135 |       4 |
| punjab         | muktsar           |  3,007 |       4 |
| west bengal    | north 24 parganas |  2,814 |       2 |
| gujarat        | ahmedabad         |  2,767 |       5 |
| karnataka      | bangalore         |  2,639 |       7 |
| orissa         | keonjhar          |  2,118 |       5 |
| tamilnadu      | thirunelveli      |  2,110 |       8 |
| tamilnadu      | kancheepuram      |  2,054 |       6 |
| madhya pradesh | hoshangabad       |  1,952 |       9 |
| uttar pradesh  | ambedkarnagar     |  1,887 |       1 |
| maharashtra    | amarawati         |  1,870 |      13 |
| gujarat        | dahod             |  1,822 |       4 |
| orissa         | khurda            |  1,805 |       4 |
| madhya pradesh | khandwa           |  1,478 |       7 |
| andhra pradesh | warangal          |  1,379 |       2 |
| karnataka      | chikmagalur       |  1,288 |       5 |
| karnataka      | shimoga           |  1,175 |       3 |
| andhra pradesh | nalgonda          |    899 |       2 |
| karnataka      | belgaum           |    800 |       5 |
| punjab         | nawanshahr        |    785 |       5 |
| andhra pradesh | medak             |    784 |       6 |
| karnataka      | mysore            |    681 |       6 |
| andhra pradesh | mahbubnagar       |    678 |       4 |
| uttar pradesh  | kushinagar        |    560 |       1 |
| gujarat        | sabarkantha       |    519 |       5 |
| orissa         | angul             |    403 |       5 |
| karnataka      | bijapur           |    198 |       3 |
| andhra pradesh | adilabad          |    174 |       5 |
| karnataka      | bellary           |    154 |       2 |
| karnataka      | tumkur            |    119 |       3 |
| chattisgarh    | janjgir           |    100 |       4 |
| madhya pradesh | anupur            |     89 |       3 |
| karnataka      | bagalkot          |     43 |       2 |
| kerala         | palakad           |     39 |       2 |
| andhra pradesh | karimnagar        |     35 |       2 |
| tamilnadu      | thiruchirappalli  |     26 |       2 |
| orissa         | jajpur            |     17 |       1 |
| tamil nadu     | thiruchirappalli  |     13 |       3 |
| uttar pradesh  | kanpur            |      3 |       1 |
| tamil nadu     | thiruvannamalai   |      3 |       1 |
| andhra pradesh | nizamabad         |      2 |       1 |
