# Milestone 2.4 — implementation plan (proposal for review)

Status: **plan only; no migration, import or data change has been made.** Facts come from MILESTONE_2_4_AUDIT.md and
AUTHORITATIVE_SOURCES.md; the matching rules are in IDENTITY_RESOLUTION_DESIGN.md. Items marked **[DECISION]** need your approval.

## 1. What the existing schema already gives us (confirmed)

| Existing                                                                                                                                                                                                           | Useful for                                                                                 | Limitation                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `states`, `districts` (`lgd_code` unique, `UNIQUE(state_id, normalized_name)`, `provenance_run_id`)                                                                                                                | current reference units                                                                    | one row per unit, **no effective dates, no history**; reference = a Dec-2022 community mirror                                           |
| `state_aliases`, `district_aliases`, `market_aliases` (`source_key`, `source_label`, `source_context`, `resolution_status` in resolved/ambiguous/unresolved/rejected, `resolution_note`, `resolved_at`, target id) | recording what each source label resolved to                                               | **one status per label, no reviewer, no evidence reference, no validity window, no history** (a status change overwrites)               |
| `markets` (`government_market_code` unique, `latitude`/`longitude`, `classification`, `status` in active/inactive/unverified/merged, `merged_into_market_id`)                                                      | most columns for a verified mandi already exist and are **empty** (0 codes, 0 coordinates) | `status` has no "verified" value; one unique code cannot hold several registries' IDs; **`markets_identity_uq` includes `district_id`** |
| `observations` keep `source_*_label` verbatim and `market_id`                                                                                                                                                      | immutability of the original text                                                          | none (this is the property to preserve)                                                                                                 |

Constraint that shapes the design: `UNIQUE NULLS NOT DISTINCT (state_id, district_id, normalized_name, disambiguator)`.
The 213 unresolved mandis use `disambiguator = 'src-district:<label>'`. Setting their `district_id` changes the
identity columns of the row (the `id`, and therefore every observation link, does not change), and may **collide** with an
existing mandi of the same resolved name — a collision means "same market under two spellings" and must become a reviewed
**merge decision** (using `merged_into_market_id`), never an automatic one.

## 2. Minimum database changes proposed (additive; no data rewrites) **[DECISION]**

All new objects; nothing existing is dropped, altered in meaning, or backfilled by guesswork.

1. `geo_reference_set` — one row per acquired reference file: authority, source URL, retrieved_at, `file_sha256`, size,
   `as_of_date`, licence note, kind (`lgd_current`, `lgd_modifications`, `registry_enam`, `registry_agmarknet`, `state_apmc`,
   `gazette_extract`).
2. `admin_unit_version` — **versioned LGD records**: `unit_type` (state/district), `lgd_code`, `name`, `parent_lgd_code`,
   `valid_from`, `valid_to` (NULL = current), `change_type` (creation/rename/split/merge/boundary), `predecessor_lgd_codes`,
   `successor_lgd_codes`, `evidence_ref` (document + URL), `reference_set_id`. The existing `districts` remain the current set; each
   links to its version row.
3. `identity_decision` — append-only **review decisions**: `entity_kind` (state/district/market), `source_id`,
   `source_key` (the label key already used by the aliases), `target_kind`/`target_id`, `class` (V/S/A/U/H), `valid_from`,
   `valid_to`, `evidence` (jsonb checklist), `evidence_refs`, `reviewer`, `decided_at`, `status`, `supersedes_id`, `ruleset_version`,
   `rationale`. The alias tables are not modified; they remain the _source-side record_, and an applied decision updates
   their current resolution through a single audited function.
4. `market_registry_entry` — rows from a candidate registry: `reference_set_id`, `registry` (enam/agmarknet/state:X),
   `registry_market_id`, `name`, `state`/`district` as the registry states them, optional coordinates and status, `active_from`/`active_to`.
5. `market_identity_link` — `market_id` ↔ `registry_entry_id`, `class`, `evidence`, `decision_id`. This is where "verified" lives, so
   **`markets.status` and its check constraint need no change** and `government_market_code` is not overloaded. (Optionally the
   accepted registry ID is mirrored into `government_market_code` later.)
6. `identity_review_event` — append-only audit log (item, from/to class, actor, evidence, time).
7. `mapping_set` (version stamp) with `active` flag: every batch of applied decisions belongs to a numbered set; the API exposes
   the active set's number (used to invalidate stale cursors).

Not proposed: changes to observation tables, original labels, or `states`/`districts` rows beyond optional version links.
Estimated sizes: reference and registry tables are thousands of rows; decisions are hundreds to low thousands. No
performance risk at 1,610 mandis; a join on `markets.district_id` stays indexed as today.

**[DECISION A]** Approve this additive schema (versus a lighter alternative: add only `identity_decision` + `geo_reference_set`
and defer registries and versioned admin units).

## 3. Staged rollout, with rollback

| Stage | Work                                                                                                                                                                                                                                         | Writes to development? | Exit criteria                                                             | Rollback                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0     | Approve decisions; correct `GEOGRAPHY_REVIEW_2_3D.md` group C (the pre-2014 guess is refuted); fix the guard-safe test habit                                                                                                                 | docs only              | review approved                                                           | revert docs commit                                                                             |
| 1     | **Acquire references** manually/with approval: LGD states+districts (and the modification report), a registry candidate (eNAM directory / AGMARKNET IDs). Record URL, size, SHA-256, licence. Files stay outside Git, with a manifest in Git | none                   | hashes recorded; licence read                                             | delete files                                                                                   |
| 2     | Schema migration on a **disposable** database only; privilege tests; the existing disposable guard applies                                                                                                                                   | no                     | migration + `db:verify` + tests green on disposable DB                    | drop disposable DB                                                                             |
| 3     | Dev migration (new tables only), after a verified backup and approval; load reference sets into `geo_reference_set`/`admin_unit_version`                                                                                                     | yes (additive)         | counts match files; baseline tables unchanged (hash check)                | `DROP` the new tables (nothing depends on them yet); backup restore as last resort             |
| 4     | **Candidate generation** (read-only analysis writing only `identity_decision` rows in `proposed`): state and district candidates for the 49 labels and the Telangana mandis                                                                  | yes (proposals only)   | every proposal has evidence checklist                                     | delete proposals (append-only; superseding is enough)                                          |
| 5     | **Mandi registry matching**: candidates per mandi, homonyms blocked across states, parenthesised variants left for a reviewer                                                                                                                | proposals only         | report of classes V/S/A/U counts                                          | same                                                                                           |
| 6     | **Review tooling** (CLI first, then a UI page): evidence view, impact preview, two-person rule for state changes and merges                                                                                                                  | decisions              | reviewers can accept/reject; audit log complete                           | revert tool; decisions are data                                                                |
| 7     | **Apply an accepted batch** as `mapping_set N`: update resolution on alias rows / `markets.district_id`, state of the 27 Telangana mandis, merges — with a before/after report and a pre-batch backup                                        | yes (audited)          | per-table before/after counts reviewed; observation tables byte-identical | deactivate `mapping_set N`; the function restores prior values from the decision/event history |
| 8     | **API/UI**: expose `identity_status` and mapping version; label "Andhra Pradesh" correction; cursors carry the mapping-set stamp; docs                                                                                                       | no                     | contract tests, OpenAPI, captures updated                                 | revert code; data unaffected                                                                   |

Every write stage: verified backup first, a disposable rehearsal, read-only before/after fingerprints (the method used in the
2026-10-20 recovery), and **no run of any write-capable test against development** (the fail-closed guard now enforces this).

## 4. Risks

| Risk                                                                                                     | Mitigation                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Merging different districts by name (e.g. same name in two states, Bangalore Urban vs Rural)             | state-first resolution; ambiguity class A; no cross-state matching; reviewer + evidence                                                  |
| Telangana/Andhra boundary (27 mandis under the wrong state; Telangana 10→33 districts, AP 13→26 in 2022) | treat as a state-correction decision per mandi with an official register as evidence; dated mapping; disclose until fixed                |
| Renamed and split districts (Gurugram, Nuh, Narmadapuram, AP 2022, Telangana 2016–2021)                  | class H with effective dates from gazette-level evidence; do not backfill                                                                |
| Duplicate / homonym mandi names (14 cross-state names; 314 parenthesised)                                | never match by name alone; registry ID required for V                                                                                    |
| Mandi closures and renamings                                                                             | `active_from/to`, `merged_into_market_id`, history events                                                                                |
| Source terms (LGD, data.gov.in, eNAM, AGMARKNET unknown)                                                 | read terms before use; store file hash and licence note; do not redistribute raw files                                                   |
| Scale                                                                                                    | thousands of rows; negligible; the heavy part is human review, not compute                                                               |
| API filters and cursors                                                                                  | district/state results change after Stage 7; mapping-set stamp makes old cursors explicit 400s; contract tests re-captured               |
| Forecasting eligibility (future)                                                                         | series only for verified identities, with an identity-continuity check across the window; district aggregates only on resolved districts |
| An unverified claim becoming "verified" in the UI                                                        | verification derives only from `market_identity_link` class V                                                                            |

## 5. Blockers and unknowns

1. LGD download format, modification-report availability and licence could **not** be confirmed (automated fetches returned 403
   or lacked detail). A manual browser check is needed.
2. No verified official mandi master list with stable IDs and open licence was found (only candidates: eNAM directory PDF,
   AGMARKNET's internal IDs reachable via a derived mirror).
3. Primary gazettes were not retrieved for Keralam, Telangana districts, Haryana renames, Narmadapuram.
4. The mandi file's own origin is undocumented.

## 6. Decisions requiring approval

| #   | Decision                                                                                                                                                                                                                                 | Recommendation                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A   | Approve the additive schema in section 2 (or the lighter variant)                                                                                                                                                                        | full additive schema, built in two migrations (reference+decision first, registries second) |
| B   | Authorize downloading official reference files: LGD states + districts (+ modification report). Expected **small** (kilobytes to a few MB; village/ward files are not needed and will not be fetched). Registry directory files likewise | approve after a manual terms check                                                          |
| C   | Approve the evidence hierarchy and the class definitions (V/S/A/U/H); in particular "name-only is never verified"                                                                                                                        | approve                                                                                     |
| D   | Policy for the 27 Telangana mandis: show them under their source state until a per-mandi decision exists, with a visible note                                                                                                            | approve                                                                                     |
| E   | Two-person review for state changes and merges                                                                                                                                                                                           | approve; or name the reviewers                                                              |
| F   | Whether Stage 4–5 candidate analysis may write `proposed` decisions to development                                                                                                                                                       | after Stage 3, yes                                                                          |
| G   | Where the reviewed artifacts live (reference files outside Git; manifests and decisions exports in Git)                                                                                                                                  | as described                                                                                |

## 7. Out of scope here

Forecasting, live ingestion, AI Copilot, allocation, simulation, any frontend redesign (the Stitch layout is untouched).

## 8. Stage 2 update — effect on this plan (2026-10-20)

Source: [MILESTONE_2_4_STAGE_2_FINDINGS.md](./MILESTONE_2_4_STAGE_2_FINDINGS.md). Nothing was applied to the database.

- **Schema (section 2) — recommended amendments:** `admin_unit_version` gains `version`, `minor_version`, `census_2011_code`, order number/date, gazette date,
  `go_file_ref`, **separate `lgd_effective_date` and `legal_effective_date`**, a baseline flag and `status`; `market_registry_entry.registry_market_id` becomes
  **nullable** with `source_row_ref`, `postal_address`, `pin_code`, `contact_number`, `listing_as_of`; `geo_reference_set` gains `access_method`, `terms_note`, `retrieval_notes`;
  `market_identity_link` gets a class for address+PIN corroboration and never an "identifier" class for eNAM. The other objects are unchanged. (The brief's "six-table schema"
  is the Stage 1 list of seven objects including `mapping_set`.)
- **Stage 1 of the rollout (acquisition) is partly done:** the official state reference and the eNAM directory are acquired and hashed (outside Git);
  the **official district list and the modification list are blocked behind a CAPTCHA** and need a person (procedure in REFERENCE_ACQUISITION.md) or an approved NAPIX account.
- **Blocker for stages 4–5:** district candidate generation cannot start without the official district file; the 49 labels stay unresolved until then.
- **Mandi registry (stage 5):** the eNAM 2021 directory has no identifier, covers at most about 37% of the registry's mandis by name, and is a printed list: use it as
  corroboration (name + district + PIN) only. An identifier source (AGMARKNET market records or a state list) is still needed before any mandi can be class V.
- **Telangana (decision D):** a review queue of the 27 mandis exists (`telangana_suspect_mandis_review_queue.csv`). The official sources agree that Telangana is a separate state
  (LGD code 36; 57 Telangana mandis in the eNAM directory) while the registry holds 0 mandis under Telangana.
- **New decisions for the owner:**
  - **H.** Who downloads the CAPTCHA-gated LGD district and modification files, or whether to approve a NAPIX account.
  - **I.** Whether an `lgd_effective_date` equal to the 2005 baseline may ever be shown as a date to users (recommended: no; show "recorded in LGD, no legal date").
  - **J.** Which mandi identifier source to evaluate next (AGMARKNET records vs state lists), subject to a terms check.

## 9. Stage 3 readiness (Stage 2 completion, 2026-10-20)

Evidence: [MILESTONE_2_4_STAGE_2_FINDINGS.md](./MILESTONE_2_4_STAGE_2_FINDINGS.md) section 0 and [DISTRICT_RESOLUTION_REVIEW.md](./DISTRICT_RESOLUTION_REVIEW.md). Nothing here was applied.

**Verdict.** The official references are **sufficient for Stage 3a** (reference sets, versioned LGD units, decisions, review events, mapping sets) on a **disposable database**. They are **not sufficient for Stage 3b** (mandi identity registry and links): no verified identifier source exists yet.
District splits cannot be modelled from the official files: they hold current names, former names and the **current version's** effective date, but no predecessor/successor links and no dates for older versions.

### 9.1 Required tables and constraints (Stage 3a)

| Table                   | Key columns                                                                                                                                                                                                                                                                                                                                                                            | Constraints                                                                                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geo_reference_set`     | code, kind, authority, source URL, access method, retrieved_at, as_of_date, original filename, `file_sha256`, size, licence/terms notes                                                                                                                                                                                                                                                | `UNIQUE(file_sha256)`; `CHECK(file_sha256 ~ '^[0-9a-f]{64}$')`                                                                                                                                                                                                                                                         |
| `admin_unit_version`    | `reference_set_id`, `unit_type` (state/district), `lgd_code`, `version`, `minor_version`, names (English/local), `parent_lgd_code`, Census 2001/2011 codes, `status` (active/inactive), `lgd_effective_date`, `lgd_effective_is_baseline`, `legal_effective_date`, `valid_from_known`, order no/date, gazette date, GO file ref, `is_current`, nullable `state_id`/`district_id` links | `UNIQUE(reference_set_id, unit_type, lgd_code, version, minor_version)`; partial `UNIQUE(unit_type, lgd_code) WHERE is_current`; `CHECK` exactly one of `state_id`/`district_id` per `unit_type`; a legal effective date requires recorded evidence; rows are never edited after insert                                |
| `mapping_set`           | label, created_by/at, status (active/inactive), report                                                                                                                                                                                                                                                                                                                                 | at most one active set (partial unique index)                                                                                                                                                                                                                                                                          |
| `identity_decision`     | entity_kind, source_id, source_key, target state/district/market (exactly one), class (V/S/A/U/H), `valid_from`/`valid_to`, evidence jsonb, evidence refs, reviewer(s), decided_at, status, `supersedes_id`, `mapping_set_id`, ruleset version                                                                                                                                         | `CHECK` target matches entity_kind; `CHECK(valid_to IS NULL OR valid_to >= valid_from)`; evidence object required when accepted; partial `UNIQUE(source_id, entity_kind, source_key) WHERE status='accepted' AND valid_to IS NULL`; a second reviewer is required when a decision changes a **state** or merges mandis |
| `identity_review_event` | decision/item, from-class, to-class, actor, evidence, time (bigint identity)                                                                                                                                                                                                                                                                                                           | append-only (no UPDATE/DELETE privilege; guard trigger)                                                                                                                                                                                                                                                                |

Stage 3b (later): `market_registry_entry` (nullable `registry_market_id`, `source_row_ref`, address, PIN, contact, listing date) and `market_identity_link`.
`markets_identity_uq` includes `district_id`: applying a district to one of the 213 unresolved mandis must go through a reviewed function that detects identity collisions and turns them into merge decisions.
Privileges: the application role gets `SELECT` only on all new tables; a loader role (the existing ingest role, extended) gets `INSERT/SELECT` on reference tables; a new **review** role gets `INSERT/SELECT` on decisions and events. **Role design needs your approval.**

### 9.2 Migration order (additive; existing tables untouched)

1. `0005` reference sets and versioned units (+ indexes, privileges).
2. `0006` mapping sets, decisions, review events (+ append-only guard, role grants).
3. `0007` (Stage 3b, later) registry entries and identity links.
4. `0008` read views for the API (current official unit; accepted mapping), used from Stage 8.
5. **Data loads are not migrations:** a reviewed loader (allow-listed, hash-verified files, idempotent by `file_sha256`) populates reference tables; decisions are created only through the review tool.

### 9.3 Disposable-database test strategy

Every write-capable test runs only on a verified disposable database through the existing fail-closed guard (all connection strings verified; `guardedUrl()`); development is never a target.

1. Fresh upgrade from the Phase 1 baseline through the new migrations, and "migrate twice" repeatability (extends `test:disposable`).
2. Constraint and privilege tests for each table (uniques, partial uniques, checks, FKs, append-only behaviour, the application role cannot write).
3. Loader tests with **synthetic miniature LGD fixtures** kept separate from real data: idempotent reload by hash, duplicate-code rejection, baseline-date flagging, rename and inactive handling.
4. A **real-subset test** (skips when the files are absent, like the historical-data suite): load the 36 states, 784 districts and 91 history records from the hash-verified official files into the disposable database only; assert counts against this report.
5. Decision lifecycle: supersede, one active accepted decision per label, two-person rule for state changes and merges, collision with `markets_identity_uq`.
6. Apply and rollback of a mapping set on a **clone of the development backup** (the recovery method): before/after fingerprints, with the observation tables byte-identical.
7. CI: real-file tests skip, synthetic tests run, and the database job already stamps its disposable database.

### 9.4 Historical effective-date handling

- Store what LGD states (`lgd_effective_date`, flagged when it equals the 01/01/2005 baseline) and, separately, the legal date with its evidence (`legal_effective_date`). LGD's date can differ from the legal one (Telangana: LGD 17/06/2014 versus the appointed day, 2 June 2014).
- A label maps to a **code** when it equals any name in that code's version history (code identity is date-independent). The **display name as of an observation date** uses version dates and is only exact where `valid_from_known`.
- The observation window is 2023-06-06 to 2025-06-11, so effective dates inside it matter: Khandwa (East Nimar) 05/10/2023 and Bengaluru South 23/05/2025 (code 631, formerly Ramanagara), plus renames in the other 61 renamed codes whose dates were not fetched. Dates after the window (the Odisha respelling of 22/06/2026) must not be applied backwards.
- Splits (Telangana 2016, 2019 and 2021; Andhra Pradesh 2022): the files hold no predecessor links, so an old-district label is **never** auto-assigned to a successor; a decision per mandi is required.

### 9.5 Rollback approach

Schema: each migration is additive and unreferenced by existing tables, so rollback is dropping the new objects in reverse order (after a verified backup, and on the disposable clone first). Data: every load carries a `reference_set_id` and is removed by an allow-listed script, not by timestamp.
Decisions are append-only and "undo" is a superseding decision. Applying a batch creates `mapping_set N`; rollback is **deactivating it**, which restores prior values from the decision and event history. Every development write stage is preceded by a verified backup and read-only before/after fingerprints.

### 9.6 Remaining evidence gaps

1. The **dated modification log** (`lgdTransaction.do`, CAPTCHA): needed for older version dates and change operations. Alternatively the version-specific detail pages, if reachable (untested).
2. **Predecessor/successor relations** for split districts (gazettes or state notifications).
3. An **official register entry per mandi** for the 27 Telangana mandis and for the 3 ambiguous labels.
4. A **mandi identifier source** (AGMARKNET market records or state lists); eNAM 2021 is corroboration only.
5. Primary Gazette texts (Keralam, AP Reorganisation Act 2014); LGD does not yet show Keralam.
6. History pages for the remaining roughly 690 districts if a complete `admin_unit_version` is wanted (about 14 MB, public).

### 9.7 Decisions requested

- **K.** Approve Stage 3a (schema for reference sets, versioned units, decisions, events, mapping sets) on a disposable database.
- **L.** Approve fetching the public version-history pages for **all 784 districts** (about 14 MB, polite rate) so the versions table is complete.
- **M.** Provide the dated modification list by hand (CAPTCHA) for at least Telangana, Andhra Pradesh, Karnataka, Haryana, Madhya Pradesh, Delhi, Odisha and Puducherry.
- **N.** Role design (a separate review role) and who the two reviewers are.

## 10. Stage 3a status (implemented on disposable PostgreSQL only)

Stage 3a is implemented as migrations `0005_geographic_reference_infrastructure` and `0006_identity_decision_infrastructure`; see [GEOGRAPHIC_ARCHITECTURE.md](GEOGRAPHIC_ARCHITECTURE.md) for the exact design, state machine, role model, test results, limitations, development-migration prerequisites and rollback.

- Section 9.1 tables are delivered as five tables and two views; 9.3 test strategy was executed on verified disposable containers; 9.5 rollback is documented.
- The development database was not modified. No mapping was proposed, accepted or applied.
- Still blocked: item M (dated LGD modification logs, manual CAPTCHA download), real reviewer/approver logins, and approval to migrate the development database. Stage 3b (proposing mappings and any correction) stays blocked until these are resolved and reviewed.
