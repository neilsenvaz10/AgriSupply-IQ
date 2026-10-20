# Official LGD reference load: rehearsal report

Milestone 2.4, after the Stage 3a development migration. Status: **rehearsed, and the controlled development loader implemented and rehearsed, on disposable databases only.** The development database was not written to; it was only read (fingerprints, a `pg_dump`).

## 1. Source files and hashes

All 1,666 files in `reference-acquisition-manifest.json` were re-hashed against the raw directory (outside Git): 0 missing, 0 mismatches. All were retrieved on 2026-10-20.

| Source                                                                                | SHA-256                                                            | Notes                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `All_Stateof_India_2026-10-20_16-37-34.xlsx` (owner download, LGD Download Directory) | `108f75e927bdec4defe8a57a693ff378318967ebaf0b555afcaed93c69213ad2` | 36 states and UTs                                                                 |
| `alldistrictbyDate2026_10_20_16_39_38_188.xls` (owner download)                       | `442cfd9700c201128ff646b025bb6f1f71bb039f65f50e97056e5306d82a36a1` | 784 districts; a date-window filter of the All Districts report, not a change log |
| LGD state detail and history pages (72 pages)                                         | manifest fingerprint `7e5bd034196f…`                               | public pages, 36 states                                                           |
| LGD district detail and history pages (1,574 pages)                                   | manifest fingerprint `62904cd1ac36…`                               | public pages, fetched 11:15 to 12:11 UTC under approval L                         |

## 2. Exact reference row counts

| Reference set                    | Fingerprint | Unit rows | Distinct units |
| -------------------------------- | ----------- | --------- | -------------- |
| `lgd-all-states-xlsx-20261020`   | file        | 36        | 36             |
| `lgd-all-districts-xls-20261020` | file        | 784       | 784            |
| `lgd-state-pages-20261020`       | manifest    | 41        | 36             |
| `lgd-district-pages-20261020`    | manifest    | 2,038     | 784            |
| **Total**                        | 4 sets      | **2,899** |                |

Version history: 411 districts have 1 history row, up to 36 rows for one district (mean 2.6). Of the 2,899 rows: 484 carry the LGD 2005-01-01 baseline flag, 336 have a real, dated, non-baseline LGD effective date, 1,288 are inactive historical versions, and **0 carry a legal effective date** (none is inferred). Telangana's LGD date is 2014-06-17 with no legal date.

No duplicate or conflicting records: 0 duplicate (set, type, code, seq) keys; exactly one latest version per unit per set; history sequences contiguous from 1; 0 name conflicts and 0 parent conflicts between the district report and the district pages; 0 name conflicts for states; every district's parent state exists in the state report.

## 3. Unresolved records (explicit, never silently dropped)

Districts **599 (Mahe), 601 (Yanam) and 671 (Shahdara)** are in the development registry (parents Puducherry, Puducherry, Delhi) but have **no official record**: LGD answers their detail pages with HTTP 200 and an error page ("Something went wrong", Error ID), and the district report does not list them.

Rehearsal finding and fix: with registry-supplied parents the loader tried to parse those error pages and aborted ("not a district detail page"). The plan now recognises an LGD error page, reports the unit as unresolved whatever the registry says, loads nothing for it, infers no parent, and names the codes in the page set's `notes` and in `plan.unresolved`. A unit test covers it. (`lgdPlan.js`, `lgdParse.test.js`, `geography.integration.test.js`.)

Other gaps (informational): 24 official districts have no district in the registry; 27 districts listed in the report show an inactive latest version on their page (kept as read, to be reviewed in Stage 3b); the registry parent equals the official parent for every linked district.

## 4. Disposable load results

Clone: restored from a fresh `pg_dump` of migrated development; its 28-table fingerprint matched development exactly before loading. Loader run as the **ingest role** through `scripts/load-lgd-reference.js`: 4 sets loaded (36 + 784 + 41 + 2,038 rows), provenance complete (source URL, page SHA-256, retrieval time on all page rows; file or manifest fingerprint, size, as-of date and access method on every set), foreign keys and links consistent (registry links by LGD code: 72 state rows and 1,520 district rows, 0 code mismatches), history sequencing contiguous.

## 5. Idempotence and rollback

- Reload: all four sets `unchanged`.
- Retraction (owner-only) of all four sets left 0 reference rows and 0 identity rows; reload then gave the same counts (2,899 rows).
- Changed content under an existing fingerprint was refused.
- Retraction refusal while a decision references a unit is covered by `geography.integration.test.js`.
- Invalid rows rejected: bad status, legal date without evidence, baseline flag on a non-baseline date, duplicate key, district without parent, unknown unit type, unknown reference set.

## 6. Privilege verification

On the clone: the ingest role can insert reference rows only; it cannot update, delete or truncate them, write `mapping_set`, `identity_decision` or `identity_review_event`, run any identity function, or update `states` or `markets`. The application role has SELECT only and cannot run identity functions. Even the owner cannot update or delete reference rows (append-only). Table and function ACLs on the clone are byte-identical to development after the rehearsal. The ingest role keeps its existing INSERT on observation tables (pre-existing design, not changed).

## 7. Integrity after the rehearsal

Only `geo_reference_set` (0 to 4 rows) and `admin_unit_version` (0 to 2,899 rows) changed. All 23 original tables, `identity_decision`, `mapping_set` and `identity_review_event` are identical (26 tables compared); 2,698,327 observations; markets and assignments unchanged. Development was re-fingerprinted afterwards and is unchanged. The database suite passes (368 tests, 75/75 verification checks).

## 8. Controlled development load (implemented; rehearsed on a disposable stand-in; never run on development)

The disposable-only `scripts/load-lgd-reference.js` is unchanged and still refuses anything that is not a verified disposable database. The development load is a **separate command**, `scripts/load-lgd-reference-dev.js`, implemented in `src/reference/devLoad/`. It reads no `.env` file, has no bypass variable, never calls the disposable guard, and its only connection is `DATABASE_REF_LOADER_URL`, the dedicated loader login.

### 8.1 Authorization document

A JSON file kept outside Git (the tooling refuses to write it inside the working tree), format `fasalytics.lgd-dev-load.authorization/1`:

| Field                                 | Meaning                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `authorizationId`, `nonce`            | a UUID and 256 random bits, new for every document                                                                                       |
| `approvedBy`, `issuedAt`, `expiresAt` | the approver and a lifetime of at most 24 hours                                                                                          |
| `target`                              | host, port, database name, PostgreSQL `system_identifier`, and the migration journal (`id:hash12` for each of the 7 migrations)          |
| `plan`                                | exactly 4 sets and 2,899 unit rows, each set with its code, `file_sha256` fingerprint and row count                                      |
| `backup`                              | path, SHA-256 and size of the backup, and the path and SHA-256 of the restore evidence                                                   |
| `fingerprint`                         | path, file SHA-256 and digest of the approved 28-table fingerprint                                                                       |
| `loaderRole`                          | the one login that may be used                                                                                                           |
| `integrity`                           | SHA-256 of the canonical document: makes edits evident (it is not a signature; every fact is re-verified against the live system anyway) |

The totals 4 and 2,899 are also constants in reviewed code (`APPROVED_TOTALS`); a document cannot approve other totals. Tests pass smaller totals through a function parameter that the command line never sets.

### 8.2 Commands

| Command                                   | Does                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref-loader-role.js provision` / `revoke` | an administrator creates or drops the loader login (section 8.4)                                                                                                                          |
| `fingerprint`                             | read-only fingerprint of the target (28 tables)                                                                                                                                           |
| `restore-evidence`                        | runs against a backup restored into a verified **disposable** database; records that the restored copy equals the approved fingerprint and that the backup checksum is the one authorized |
| `authorize`                               | verifies loader privileges and the live fingerprint, builds the plan from the source files, hashes the backup and the evidence, and writes the authorization                              |
| `verify`                                  | every check below, no write, the authorization is not consumed                                                                                                                            |
| `execute`                                 | every check, the typed confirmation, then one load                                                                                                                                        |

### 8.3 Checks (any failure refuses, nothing is written)

1. The document is well formed, unedited, not expired, issued at most 5 minutes ahead, valid at most 24 hours, has never been used (no `.state` file next to it), and is owner-only (section 8.10).
2. The connection host is loopback (`localhost`, `127.0.0.1`, `::1`) and equals the authorized host and port: a remote host is refused as a production target before any connection is made. The login equals `loaderRole`.
3. From the catalog: database name, PostgreSQL system identifier and migration journal equal the authorized ones, which also defeats a tunnel to another server.
4. The source files produce exactly the authorized sets, fingerprints and row counts.
5. The backup exists, has the authorized size and SHA-256, and is no older than 24 hours. The restore evidence has the authorized SHA-256, names this backup, was produced against a disposable restore, matched the fingerprint, and is dated within the life of the backup. The approved fingerprint file matches its hash and digest.
6. The live fingerprint of all 28 tables equals the approved one, and both reference tables and all three identity tables are empty (so a repeated execution is refused).
7. The login holds exactly the least-privilege set (section 8.4).
8. Execute only: a person types `LOAD LGD REFERENCE INTO <database> <system identifier>` at an interactive terminal (stdin and stdout must be a TTY); a non-interactive run or a different text is refused without consuming the authorization.

### 8.4 Loader login lifecycle

`provision` (administrator, `DATABASE_ADMIN_URL`) creates `fasalytics_ref_loader`: LOGIN, no superuser, create-database, create-role, replication or bypass-RLS attribute, no membership, `CONNECTION LIMIT 3`, `VALID UNTIL` equal to the authorization lifetime (so the credential expires by itself), and a random password written only to an owner-only file outside Git (never printed). Grants: CONNECT; USAGE on `public` and `drizzle`; SELECT on every table (to verify fingerprints) and on the migration journal; INSERT on `geo_reference_set` and `admin_unit_version` only. The loader checks its own privileges through the catalog and refuses on any difference: no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER anywhere, no INSERT elsewhere, no function execution (so no identity or mapping function), no CREATE, no sequence use. `revoke` terminates its sessions, runs `DROP OWNED` and drops it: run it after every attempt, successful or not.

### 8.5 Transaction

One `REPEATABLE READ` transaction with a 15-minute statement timeout, an advisory lock and a 10-second lock timeout. Inside it the pre-conditions are checked again, the four sets are inserted, and before `COMMIT` the loader verifies that exactly the four authorized sets exist (no others), exactly 2,899 unit rows, no duplicate history versions, one latest version per unit, no conflicting district names or parents between the report and the pages, provenance on every page row, no legal effective date, empty identity tables, and that every other table still equals the approved fingerprint. Any problem rolls back. After the commit a fresh read-only look repeats the verification and the report is written. A rollback leaves no rows; it does not undo effects PostgreSQL does not make transactional (server logging, consumed sequence values; these tables use none), and the authorization is consumed by any attempt that reached the write phase.

### 8.6 Audit evidence

Next to the authorization (outside Git): `<authorization>.state` (consumption and outcome), `<authorization>.report.json` (status, problems, set list, totals, unresolved districts, timings, post-load fingerprint digest), the fingerprint file and the restore evidence. The reference rows themselves carry source URLs, page hashes and retrieval times.

### 8.7 Failure recovery and reference retraction

- Refused before the write phase: nothing changed and the authorization is still usable once the cause is fixed (unless it expired).
- Failed or interrupted inside the transaction: PostgreSQL rolled it back; the authorization is spent; run `revoke`, find the cause, and issue a new authorization.
- Committed but wrong: the owner retracts the sets with `retractReferenceSet` (refused while any decision references them), or restores the verified backup if anything beyond the two reference tables differs.

### 8.8 Exact procedure for a development execution (each step needs its own approval)

1. Check out the reviewed commit; `npm run db:check`, lint and the disposable suite pass; the development database is idle (no ingestion run).
2. Take a new `pg_dump -Fc` backup outside Git; record its SHA-256.
3. Restore it into a **disposable** PostgreSQL; run `restore-evidence` (disposable environment) against the fingerprint.
4. An administrator runs `ref-loader-role.js provision` against development; the credential file stays outside Git.
5. `fingerprint`, then `authorize` (named approver, at most 24 hours), then `verify`.
6. At an interactive terminal: `execute`, and type the phrase.
7. Review the report; run `ref-loader-role.js revoke`; re-fingerprint development: 26 tables unchanged, reference tables 4 and 2,899 rows, identity tables 0, observations 2,698,327.

### 8.9 Disposable rehearsal results

On a stand-in made from a `pg_dump` of migrated development (restored into a disposable server, with the backup also restored into a second database for the evidence): provision, fingerprint, restore evidence (match), authorize, `verify` (all checks), non-interactive `execute` refused (no state file), a remote target refused, then the authorized load with the real files and the real pinned totals: committed, 4 sets and 2,899 rows, 15 seconds, no problems, unresolved districts 599, 601 and 671 recorded; reuse of the same authorization refused; a second authorization refused because the database no longer equals the approved fingerprint; the 26 other tables are identical (including the identity tables) and the 2,698,327 observations are intact; `revoke` dropped the login and it can no longer connect. The typed prompt was injected in this run because no terminal was attached; the TTY requirement itself is covered only by the non-interactive refusal tests.

The automated suite (`src/reference/devLoad/controlled.integration.test.js`, in its own database on the disposable server, synthetic sources) covers: success, `verify`, missing, expired, over-long, edited and reused authorizations, wrong database name, system identifier, port, host, journal and login, production hosts, a drifted database, wrong, missing and stale backups, bad evidence and fingerprint files, changed sources, wrong counts and the pinned constant, a login without INSERT and nine kinds of excess privilege, the forbidden statements as the loader, non-interactive and wrong confirmations, an injected failure, a killed connection, repeated execution and retraction. After every failed attempt the reference tables are empty.

### 8.10 Real-terminal confirmation test and file protection

The interactive confirmation was exercised in a real Windows console (a Terminal-panel PowerShell tab) with the loader attached to that console (`stdin` and `stdout` are a TTY), against a disposable server holding a restore of the migrated development database. The keystrokes were written into the console input buffer with `WriteConsoleInput`, as if typed:

- **Wrong phrase** (`yes, load it`): `REFUSED [confirmation]`, no state file, the authorization stays unused. This run also found a defect that is now fixed: the process did not exit after a refusal because the readline interface kept stdin open; it is now closed as soon as the answer is read.
- **Correct phrase** (`LOAD LGD REFERENCE INTO <database> <system identifier>`): `committed`, 4 sets and 2,899 rows, no problems, state file `committed`.
- **Same authorization again**: `REFUSED [reused]` before any prompt.

File protection (found by the same test and fixed): on Windows a new file inherits the ACL of its folder, which gave `BUILTIN\Users` modify rights on the authorization and the credential. Now every secret file (authorization, evidence, fingerprint, state, report, loader credential) is created with mode 600 on POSIX, and on Windows `icacls` removes the inherited entries and the Everyone, Users and Authenticated Users groups by SID and grants only the current user. `execute` and `verify` refuse (`[permissions]`) an authorization that group or other can access (POSIX mode bits, or a broad ACL entry on Windows) and, on POSIX, backup, evidence or fingerprint files that group or other can write. Verified on Windows: files written by the tools carry a single entry for the current user.

Limits: the permission checks protect against other local accounts, not against the same account or an administrator; the authorization checksum is not a signature. The test harness that typed the answers is a script, not a person.

## 9. Development backup requirements

A fresh timestamped `pg_dump -Fc` outside Git and outside the Docker volume, SHA-256 recorded, listed and restored into a disposable instance with a matching fingerprint, immediately before the load; all existing backups and `fasalytics_pgdata` preserved.

## 10. Remaining risks

- A loader credential can add arbitrary reference rows (append-only, constrained, but unreviewed); hence the short-lived dedicated role.
- Districts 599, 601 and 671 and the 24 unmatched official districts are unresolved for Stage 3b; the dated modification log (item M) is still missing, so no split or merger relation exists.
- The LGD pages were scraped once; the fetch log does not cover 88 districts fetched earlier (their hashes are in the manifest).
- 27 inactive-latest districts need review.
- Reference rows are "as read from LGD", not legally verified.

## 11. Recommendation

The controlled loader is implemented and rehearsed. The development load is **ready to be authorized separately**: it needs a new backup with restore evidence, an administrator-provisioned loader login, a named approver, an idle development database, and a person at a terminal. Nothing in this document or its tooling has written to development.
