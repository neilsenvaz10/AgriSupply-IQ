# Reference acquisition — manifest summary and procedure (Milestone 2.4, Stage 2)

Machine-readable manifest: [`reference-acquisition-manifest.json`](./reference-acquisition-manifest.json) (every acquired file with source URL,
retrieval time, size and SHA-256; every blocked attempt with its blocker; derived files flagged non-authoritative).
Reproduction script: [`acquire_references.sh`](./acquire_references.sh) (syntax-checked; not re-run after the first acquisition).

## 1. Where the files are

Raw files live **outside Git**: `C:\Users\DELL\Desktop\AgriSupply-IQ-reference-data\` (18 MB).

| Folder                          | Content                                                                                                              | Authoritative?                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `raw/enam/`                     | eNAM Directory PDF (+ response headers) and two eNAM page snapshots                                                  | yes (official publication)                |
| `raw/lgd/state_pages/`          | 36 LGD state detail pages + 36 version-history pages                                                                 | yes (official LGD public pages)           |
| `raw/pages/`                    | LGD, data.gov.in, NAPIX and eNAM landing/policy pages, the public States/UTs table and the recent-modifications feed | yes (official pages)                      |
| `raw/lgd/attempt_*_403.headers` | evidence of the two refused data.gov.in file downloads                                                               | evidence only                             |
| `derived/`                      | CSV/JSON extractions, text of the PDF, in-memory match results                                                       | **no** — derived, approximate where noted |

The original files are unchanged; derived files are separate. Totals: 90 acquired files, 16.2 MB (the eNAM PDF is 11.1 MB; three
data.gov.in landing pages are 1.1 MB each because the site is a client-rendered application).

## 2. What was acquired

| Item                                   | Source                                                                                       | SHA-256 (first 16) |          Size |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------ | ------------: |
| eNAM Directory 2021                    | https://enam.gov.in/assest/download/eNAM_Directory_20210720.pdf                              | `10bdc3e2e9619a99` |  11,116,583 B |
| LGD public States/UTs table (36 rows)  | https://lgdirectory.gov.in/globalviewstateforcitizen.do                                      | see manifest       |       ~135 KB |
| 36 state detail + 36 history pages     | https://lgdirectory.gov.in/globalviewStateDetail.do, viewStateHistoryReport.do               | see manifest       | ~720 KB total |
| LGD recent-modifications feed          | https://lgdirectory.gov.in/getLgdRecentModifications.do                                      | see manifest       |        ~92 KB |
| LGD terms, copyright and privacy pages | https://lgdirectory.gov.in/ (`termsconditions.do`, `copyRightPolicy.do`, `privacyPolicy.do`) | see manifest       |   ~46 KB each |

## 3. What could not be acquired (blockers, not substituted)

| Wanted                                                         | Result           | Why                                                                                                                        | What would unblock it                                                                              |
| -------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| LGD Districts CSV (data.gov.in)                                | HTTP 403         | static file refuses unauthenticated automated download; the page also embeds an API key that was deliberately **not** used | a person downloads it in a browser (login may be required)                                         |
| LGD States CSV (data.gov.in)                                   | HTTP 403         | same                                                                                                                       | same (not essential: the public States table covers it)                                            |
| LGD "All Districts of India" and "Download Only Modifications" | CAPTCHA form     | CAPTCHA not attempted                                                                                                      | a person solves the CAPTCHA and saves the files                                                    |
| LGD "List of Modifications Done in LGD"                        | CAPTCHA form     | same                                                                                                                       | same                                                                                               |
| LGD API (NAPIX: DISTRICT, OPERATIONS, …)                       | account required | creating an account is not permitted here                                                                                  | the owner registers and supplies a key through a secure channel, or approves a person-run download |
| eNAM file at the URL given in the brief                        | HTML page shell  | wrong path (`/web/assest/...`); the working path is `/assest/...`                                                          | resolved                                                                                           |

No community mirror was used as a substitute.

## 3b. Update — Stage 2 completion (2026-10-20, later)

The owner downloaded two official reports from the LGD Download Directory by hand (CAPTCHA solved by a person). They are kept **where the owner saved them**, unchanged:

| Original filename                              |      Size | SHA-256                                                            | Notes                                                                                                                                       |
| ---------------------------------------------- | --------: | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `All_Stateof_India_2026-10-20_16-37-34.xlsx`   |   5,652 B | `108f75e927bdec4defe8a57a693ff378318967ebaf0b555afcaed93c69213ad2` | _All States_ (36 rows incl. State Version); created 2026-10-20T11:07:34Z                                                                    |
| `alldistrictbyDate2026_10_20_16_39_38_188.xls` | 448,918 B | `442cfd9700c201128ff646b025bb6f1f71bb039f65f50e97056e5306d82a36a1` | _All Districts Of India_, window 01/01/2005–20/10/2026; 784 rows; SpreadsheetML XML despite the `.xls` name; generated 2026-10-20 16:39 IST |

Neither file is the dated **modification log**. Blockers that remain: the _List of Modifications Done In LGD_ (CAPTCHA) and the NAPIX API (account). Blockers now closed: LGD districts (obtained) and the data.gov.in CSVs (no longer needed).

Additional public pages fetched (no CAPTCHA): per-district detail and version-history pages for **91** districts (182 files, about 1.9 MB): all Telangana and Delhi districts, the Bengaluru and Kanpur districts, the official candidates for the 49 labels, and Shahdara, Mahe and Yanam.
They extend the manifest to **274 acquired files, 18.4 MB**. Derived (non-authoritative) files added: the parsed district rows, the official district list, the comparison with the registry, alias candidates and the targeted district history table.

**Procedure addition:** `acquire_references.sh` still reproduces the public-page part; the district pages use the same session and link pattern (`globalviewDistrictDetail.do?globaldistrictId=<code>`, `viewDistrictHistoryReport.do?globaldistrictId=<code>`) and can be extended to all 784 codes (about 14 MB) after approval.

## 4. Procedure (reproducible)

1. Run `docs/geography/acquire_references.sh [dir]` (Git Bash). It fetches only the public state-level pages and the eNAM PDF,
   with an honest User-Agent, 1 s between state pages, and writes `derived/SHA256SUMS.txt`.
2. Extract derived tables (`parse_states` equivalents are described in the findings report; the scratch scripts are not part of the repository).
3. Compare hashes against the manifest; a changed hash means the live page changed, not an error.

### Manual steps for the CAPTCHA-gated official files (needs a person)

1. Open https://lgdirectory.gov.in/downloadDirectory.do.
2. Choose **All Districts of India**, format CSV (or spreadsheet), solve the CAPTCHA, download.
3. Choose **Download Only Modifications** with a date range starting 2012-01-01 (or earlier), solve the CAPTCHA, download.
4. Save both files unchanged in `AgriSupply-IQ-reference-data\raw\lgd\manual\` and note the date and time of download.
5. Tell the agent; it will hash them, validate identifiers and extend the manifest. Do not rename or edit the files.

## 5. Reuse terms recorded

- LGD pages: the **Copyright Policy** permits free reproduction in any format "subject to … accurately and not … in a derogatory
  manner or in a misleading context", with the source prominently acknowledged. The **Terms** say the content must not be treated
  as a statement of law and that accuracy is not guaranteed — verify with State departments.
- eNAM directory: no licence; a disclaimer (page 185) says it is a general reference, maintained by APMCs who are responsible for
  its currency, and readers should contact the relevant APMC.
- data.gov.in: site footer states content is licensed under the Government Open Data License - India; the per-resource licence
  field for the LGD districts resource is empty.
- Consequence: raw files are kept private; the repository stores only the manifest, hashes and short derived statistics.

## LGD district detail and history pages (approved item L)

Fetched 2026-10-20 (11:34-12:12 UTC) from `globalviewDistrictDetail.do` and `viewDistrictHistoryReport.do` for all 784 districts: 1,574 raw pages (2 per district) in `raw/lgd/district_pages` (outside Git). The fetch log (696 districts, 1,392 requests) shows only HTTP 200; the other 88 districts were fetched earlier in Stage 2 and are hashed in the manifest. Conservative rate (about 5 minutes per 100 districts), no CAPTCHA, login or API key; the script halts on any non-200 or CAPTCHA page. No split relationships were inferred. Manifest: `reference-acquisition-manifest.json` (1,666 acquired files, 30,400,100 bytes).
