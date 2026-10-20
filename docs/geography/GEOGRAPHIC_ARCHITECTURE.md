# Geographic reference and identity decision infrastructure

Milestone 2.4, Stage 3a. Status: implemented and tested on disposable PostgreSQL only. **Nothing has been applied to the development database.** No geographic mapping has been proposed, accepted or applied; no observation, market, state, district or alias row is changed by this work.

## 1. What this adds

| Migration                                  | Tables                                                      | Other objects                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `0005_geographic_reference_infrastructure` | `geo_reference_set`, `admin_unit_version`                   | `append_only_guard()`, append-only triggers, view `admin_unit_current` (security invoker), write revocation                                |
| `0006_identity_decision_infrastructure`    | `mapping_set`, `identity_decision`, `identity_review_event` | role/guard helpers, 8 state-machine functions, guard triggers, view `identity_decision_in_effect` (security invoker), privilege revocation |

The 23 existing tables and the 5 existing migrations are untouched. Both migrations are purely additive and contain no top-level `INSERT` (asserted by `schema.test.js`).

## 2. Reference model

`geo_reference_set` records one acquired official reference: code, kind, authority, source URL, access method, original filename, format, SHA-256 (`file_sha256`, unique), fingerprint kind (`file` or `manifest` = SHA-256 of the list of page hashes), size, record count, retrieval time, as-of and publication dates, licence/terms notes. Raw files stay outside Git and outside the database.

`admin_unit_version` records one version of one official unit (LGD state or district) in one set. Key: `(reference_set_id, unit_type, lgd_code, history_seq)`; `history_seq` is the row's position in the source's own version history. Several snapshots of the same unit coexist because the set is part of the key. `is_latest_version` is unique per set and unit.

Date semantics (never conflated):

- `lgd_effective_date`: the date LGD displays. `lgd_effective_is_baseline` is true only for LGD's 2005-01-01 default (`aun_baseline_ck`). 31 of 36 states carry it.
- `legal_effective_date`: a legal date. It requires `legal_effective_evidence` (`aun_legal_evidence_ck`) and can never equal a baseline date (`aun_legal_not_baseline_ck`). The loader never fills it; legal dates are not inferred from the baseline. Example: Telangana's LGD date is 2014-06-17 while the legal appointed day is 2 June 2014; only the LGD date is stored.
- `valid_from_known` is true only for a dated, non-baseline version (`aun_valid_from_ck`).
- Also stored: LGD code, version and minor version, English and local name, parent LGD code (`aun_parent_ck`), state/UT kind, Census 2001/2011 codes, active/inactive status, order number/date, gazette date, government order reference, per-row source URL/SHA-256/retrieval time, `content_sha256` (idempotency) and the verbatim parsed `raw_record`.
- Optional `state_id` / `district_id` links record which registry row carries the LGD code. They are a record, not a change to the registry.

Both tables are append-only (UPDATE, DELETE and TRUNCATE raise `55000`).

## 3. Approval state machine

Decision states: `proposed` → `accepted` | `rejected` | `withdrawn`; `accepted` → `superseded`. No other edge exists (`FI023`); a same-status update is refused as an immutable-content change (`FI024`). Mapping sets: `draft` → `active` | `inactive`; `active` ↔ `inactive` (reversible); same-status updates `FI027`.

Writes happen only through SECURITY DEFINER functions: `identity_propose`, `identity_review`, `identity_accept`, `identity_reject`, `identity_withdraw`, `mapping_set_create`, `mapping_set_activate`, `mapping_set_deactivate`. The caller is `session_user`, never a parameter, so no reviewer identity can be supplied or invented. An owner-only guard trigger (`identity_owner_only_guard`) refuses writes unless `current_user` is the table owner (i.e. inside those functions), even for a superuser.

Rules enforced:

- Proposer cannot review (`FI041`), nobody reviews twice (`FI042`); approver cannot be the proposer (`FI053`) or a reviewer (`FI054`).
- One recommending reviewer is required; two distinct reviewers when `requires_two_reviewers` (generated column: `correct_state`, `merge_markets`, class A, entity kind state) (`FI056`). Any `reject` or `needs_evidence` verdict blocks acceptance (`FI055`).
- Acceptance is one transaction: row lock, checks, status change, audit event. It targets an existing draft set (`FI052`).
- No conflicting active accepted mapping: unique indexes allow one accepted decision per label per mapping set, one per subject market/kind per set, and one superseding decision per decision. A conflict surfaces as `FI058` or `23505`; concurrent approvals cannot bypass the indexes.
- `identity_review_event` is append-only and records every action with actor, role and time. Accepted-decision history is protected from update and delete.
- A login in both reviewer and approver groups, or in neither, is refused (`FI010`/`FI011`); wrong role for an action `FI012`.
- Other codes: `FI020` direct write, `FI021`/`FI022` creation state/actor, `FI025`/`FI026`/`FI028` mapping-set rules, `FI030`/`FI031` proposal target/supersession, `FI040` unknown verdict, `FI043` reason required, `FI044` only the proposer withdraws, `FI050` not found, `FI051` wrong status, `FI061`/`FI062` activation rules.

Mapping-set semantics: a draft accepts decisions; activating one replaces the single active set (`mset_one_active_uq`); "in effect" is the view `identity_decision_in_effect` (accepted decisions of the active set). Superseding flips the old decision only inside the same draft set; across sets it is lineage only. **Nothing is applied to the registry**; applying mappings is a later, separately approved stage.

## 4. Role and privilege model

- Application role: read-only on all five tables and both views. Cannot create, review or approve.
- Ingestion role: `INSERT` on the two reference tables only (the loader); no write to the identity tables, no execute on the functions.
- Migration/owner role: owns the objects and runs the loader's retract.
- `fasalytics_reviewer` and `fasalytics_approver`: NOLOGIN group roles created by `database/init/01-roles-and-privileges.sh` (not by migrations; a guard test forbids role names in migrations). `database/scripts/grant-identity-privileges.js` grants them `USAGE`/`SELECT` and the matching function `EXECUTE`, and revokes the other group's functions. Individual human logins are made members by an administrator; **no reviewer account was invented or created** outside synthetic test logins that are dropped afterwards.
- `PUBLIC` has no execute on the functions; the migrations revoke default write privileges for non-owners, and `src/ingest/privileges.js` re-revokes identity-table writes after its blanket grant.

## 5. Indexes and constraints

Reference: `grs_code_uq`, `grs_sha256_uq`, `grs_*_ck`; `aun_unit_seq_uq`, partial `aun_latest_uq`, `aun_code_idx`, `aun_parent_idx`, `aun_state_idx`, `aun_district_idx`, FKs `aun_reference_set_fk`, `aun_state_fk`, `aun_district_fk`, and the `aun_*_ck` family (type, status, code, version, name, parent, state kind, hash, baseline, legal evidence, legal-not-baseline, valid-from, order).

Identity: `mset_one_active_uq` (one active set), `idec_one_accepted_label_uq`, one accepted per subject market/kind per set, one superseding decision per decision, one review verdict per actor per decision, `idec_target_ck`, `idec_lifecycle_ck`, `idec_separation_ck`, and FKs from decisions to units, sets and events.

## 6. Loader

`database/scripts/load-lgd-reference.js` (`--dir`, `--plan-only`, `--url-env`) builds four reference sets from the owner-downloaded and publicly fetched files: all states (xlsx), all districts (xls), state pages, district pages. It refuses to write unless `checkDisposable()` passes. Reload is idempotent by `file_sha256`; the same fingerprint with different content is an error. `retractReferenceSet` (owner only) removes a mistaken load and refuses while any decision references it. Plan on the full acquisition: 36 + 784 + 41 + 2,038 unit rows; districts 599, 601 and 671 have no known parent state and their pages are skipped with a warning.

## 7. Disposable test results

Verified disposable PostgreSQL 17 containers only (the guard checks every connection string including `DATABASE_ADMIN_URL`). `npm run test:disposable`: 16 files passed, 363 tests passed, 14 skipped, 75/75 `db:verify` checks, fresh upgrade of the Phase 1 baseline through 0006 (7 migrations), migration idempotence, concurrency and rollback tests, read-only app role, real official load/reload/retract. Four views are asserted `security_invoker`. Lint, prettier, `tsc` and `drizzle-kit check` clean.

## 8. Known limitations

- The districts report is the All Districts export filtered by a date window, not a change log. Dated LGD modification logs (item M) are still missing, so district split/merge relationships are not inferred.
- Public pages give versions and only the current version's effective date.
- Districts 599, 601, 671: parent state unknown in the downloads.
- 88 districts' pages were fetched before the fetch log existed (their hashes are in the manifest).
- Real reviewer/approver logins do not exist yet.
- The identity workflow is tested with synthetic fixtures; no real decision exists.

## 9. Development migration prerequisites

Before 0005/0006 are applied to the development database (not done; needs explicit approval): a verified backup; `database/init` group roles created in the dev cluster (`fasalytics_reviewer`, `fasalytics_approver`) as an administrator; run migrations with the owner role; run `db:grant-identity` and the ingest-privilege script; run `db:verify`; confirm observations and the original 23 tables are byte-identical afterwards.

## 10. Rollback

Migrations are additive, so rollback is dropping the five tables, two views, eight functions and helper functions in reverse order (`mapping_set` family first), then removing the journal rows for 0005/0006. Because nothing in existing tables references them, this cannot affect observations. A mistaken reference load is removed with `retractReferenceSet`, not by hand.

## 11. Security review (final review of Stage 3a)

- Every function that is `SECURITY DEFINER` sets `search_path = pg_catalog, pg_temp` (hardened during the review from `pg_catalog, public`); all object references in function bodies are schema-qualified; there is no dynamic SQL in the workflow functions (the only `EXECUTE format` is in migration-time privilege `DO` blocks over catalog names, using `%I`).
- EXECUTE is withdrawn from `PUBLIC` on all eleven functions; the reviewer group holds 3 and the approver group 5. Internal helpers (`identity_log_event`) are executable by nobody but the owner, so audit events cannot be forged.
- Tests (synthetic logins, disposable database): a reviewer or approver cannot `GRANT` themselves the other group, `SET ROLE` or `SET SESSION AUTHORIZATION`, create roles or objects, replace a function, disable or drop a trigger, call the audit helper, or update, delete or truncate the audit log and decisions; the application role cannot forge audit events or run any identity function; a temporary table with a reserved name cannot hijack a definer function.
- Residual risks: the ingestion role keeps INSERT on the two reference tables (the loader), so ingest credentials can add reference rows; reviewer identity is only as distinct as the logins an administrator issues (one shared login would be one principal).

## 12. Controlled development loading of the reference

Reference data reaches a non-disposable database only through `scripts/load-lgd-reference-dev.js` (`src/reference/devLoad/`), which is separate from the disposable-only loader and has no bypass switch. It requires a one-use authorization document (at most 24 hours; pinned database identity from the PostgreSQL catalog, the 4 sets and 2,899 rows, backup checksum, restore evidence and the approved table fingerprint), a loader login that holds exactly INSERT on the two reference tables plus read access, and a typed confirmation at an interactive terminal. The four sets are inserted in one transaction, verified, and committed only if every check passes. The loader cannot write identity tables, run identity functions, update or delete reference rows, change observations, or manage roles. Districts that LGD answers with an error page (599, 601, 671) are recorded as unresolved in the page set's notes and in the report; no parent is inferred. Details: `LGD_REFERENCE_LOAD_REHEARSAL.md` section 8; migration prerequisites: `DEV_MIGRATION_CHECKLIST.md`.
