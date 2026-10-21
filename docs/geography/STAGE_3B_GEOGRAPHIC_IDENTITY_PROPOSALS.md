# Stage 3b: geographic identity proposals

Milestone 2.4, Stage 3b. Status: **implemented and tested on disposable databases; development was only read.** Nothing here corrects, reassigns or applies any geography. No mapping has been proposed, reviewed or accepted in any real database, and no reviewer or approver account exists.

## 1. Purpose

Find where the registry, the alias tables and the loaded official LGD reference disagree, keep the evidence, and prepare **candidate proposals for independent review** through the decision infrastructure of Stage 3a. The pipeline is deterministic, read-only and reproducible. A candidate is a request for review, never a decision.

## 2. What already existed and what was added

| Capability                                             | Existing (Stage 3a and earlier)                                                                                                                  | Added in Stage 3b                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Official reference, versions, provenance               | `geo_reference_set`, `admin_unit_version`, `admin_unit_current`                                                                                  | none                                                 |
| Decision kinds and classes                             | `map_label`, `correct_state`, `merge_markets`, `mark_ambiguous`, `mark_unresolved`; classes V, S, A, U, H                                        | none                                                 |
| Evidence storage                                       | `evidence` (jsonb), `evidence_refs`, `valid_from`, `valid_to`                                                                                    | the content of the evidence (section 5)              |
| Review rules                                           | proposer, reviewer and approver separation, two reviewers for high risk, append-only audit, mapping sets, supersession, `needs_evidence` verdict | none                                                 |
| Read-only discrepancy analysis                         | Stage 2 one-off scripts (outside the repository)                                                                                                 | `src/geography/analysis.js`, reproducible and tested |
| Candidate proposals with evidence classes              | a manual report                                                                                                                                  | `src/geography/proposals.js`                         |
| Duplicate prevention, submission plan, reversal helper | none (the database does not stop two identical open proposals)                                                                                   | `src/geography/workflow.js`                          |
| Command line                                           | none                                                                                                                                             | `scripts/geo-analyze.js` (read-only)                 |

Nothing is duplicated: no new table, migration or privilege. A database-level guard against duplicate open proposals is a future option (section 11).

## 3. Discrepancy analysis (`analyse`)

A pure function of a snapshot read inside a READ ONLY transaction (the reader refuses a connection that is not read only). Same snapshot, same findings, in the same order, whatever the row order. Every finding keeps the source label as written, the original assignment, the dataset, the observation count and the first and last date.

| Finding type                                | Meaning                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `unresolved_district_alias`                 | a district label the importer could not resolve, with the mandis filed under it                        |
| `unresolved_state_alias`                    | a state label that is not a recognised name                                                            |
| `official_district_absent_from_registry`    | an official LGD district with no registry district of that code                                        |
| `registry_district_without_official_record` | a registry district whose LGD code has no official record (LGD returned an error page)                 |
| `inactive_official_unit`                    | the latest version in the unit's own LGD history is inactive although the unit is listed in the report |
| `ambiguous_market_name`                     | the same mandi name in several locations                                                               |

Candidates for a label are searched by the strongest rung that finds anything, inside the label's own state first:

1. `exact_official_name`: equals the current official name, or differs only in spaces or punctuation;
2. `documented_rename`: equals a former name in the unit's own LGD version history;
3. `token_containment`: the label is one word of a longer official name (flagged `partialNameMatch`);
4. `spelling_variant`: closest edit distance (1 for names up to five letters, 2 for longer ones; for names under four letters only one adjacent transposition).

If the labelled state has no fit, the other states are searched the same way; exactly one fitting state gives `state_mismatch`. Several fits give `ambiguous`. Similarity of spelling is **never** enough to map a label.

### Results on development

See section 15 (updated after the hardening pass) for the current counts, section 13 for how the headline numbers reconcile, and section 12 for what changed. In short: 49 unresolved district aliases (213 mandis, 86,427 observations), of which 9 exact, 14 renames, 15 name-only, 3 ambiguous (Bangalore, Delhi, Kanpur) and 8 state mismatches (27 mandis, 8,935 observations, all pending); 69 candidate proposals; no state correction.

## 4. Temporal and geographic uncertainty

Each candidate states where the official unit's **current** version stands against the label's data window (2023-06-06 to 2025-06-11): `current_version_predates_data_window`, `..._effective_inside_data_window`, `..._after_data_window`, `current_version_is_lgd_baseline_2005` (2005 is LGD's default, not a formation date), or `current_version_date_unknown`. A rename's own date is always `not_published`. For state mismatches the LGD date of Telangana (2014-06-17) is recorded together with `legalEffectiveDate: null`: the legal date is not in the data.

## 5. Proposal schema

A proposal has the shape of an `identity_propose` call plus its audit context:

| Field                                         | Content                                                                                                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proposalKey`                                 | 32 hex characters, a hash of the claim (kind, entity, source label or mandi, target, rule set); the same claim always has the same key                                                                                                                    |
| `evidenceDigest`                              | hash of the evidence; changes when the evidence changes                                                                                                                                                                                                   |
| `evidenceClass`                               | `exact_official_name`, `documented_rename`, `name_only_candidate`, `ambiguous`, `state_mismatch`, `unresolved_no_candidate`                                                                                                                               |
| `decisionKind`, `entityKind`, `decisionClass` | see the mapping below                                                                                                                                                                                                                                     |
| source identity                               | `sourceId`, `sourceKey`, `sourceLabel`, `sourceContext` (the label exactly as the source wrote it)                                                                                                                                                        |
| proposed identity                             | official code, name, state; `targetAdminUnitVersionId` (the official version row that is the evidence) and `targetDistrictId` or `targetStateId` when the registry has the unit                                                                           |
| `evidence` (jsonb)                            | original assignment, candidates with rung, matched name, status, current-version date, temporal state, reference set code, set fingerprint, page hash and URL, retrieval time; observation window and datasets; uncertainty; `notAProof`; the limitations |
| `evidenceRefs`                                | `lgd:<set>#<fingerprint>:page#<hash>` and `dataset:<code>`                                                                                                                                                                                                |
| `rationale`                                   | the reason for proposing the match                                                                                                                                                                                                                        |
| `reviewStatus`                                | always `candidate` here; real status is the database's                                                                                                                                                                                                    |

Mapping from evidence to decision:

| Evidence class      | Decision                                                                                                                                  | Class | Reviewers               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------- |
| exact official name | `map_label` district                                                                                                                      | S     | one                     |
| documented rename   | `map_label` district                                                                                                                      | H     | one                     |
| name-only candidate | `mark_unresolved` (candidate noted, no target)                                                                                            | U     | one (state labels: two) |
| ambiguous           | `mark_ambiguous`                                                                                                                          | A     | two                     |
| state mismatch      | `mark_unresolved` per mandi while the evidence is state-level only; `correct_state` (H, two reviewers) only with market-specific evidence | U / H | one / two               |
| no candidate        | `mark_unresolved`                                                                                                                         | U     | one                     |

Counts on development: 69 proposals (9 exact, 14 rename, 16 name-only, 3 ambiguous, 27 pending state mismatches); 4 are high risk (two reviewers). **The 27 suspected Telangana mandis are 27 separate pending `mark_unresolved` proposals; none is a state correction and none is reassigned.**

## 6. Evidence requirements for acceptance

A reviewer should be able to answer, from the proposal alone: what the source wrote and where; which official unit is proposed and which official record shows it (set, fingerprint, page hash); why the rung is sufficient; what is uncertain (dates, state boundary, partial name); what independent evidence is missing. Specific wants:

- renames: the date of the rename, from the LGD modification log or a gazette;
- state corrections: the mandi's own official listing (state and district) and the date its market area changed state;
- ambiguous labels: a district-level disambiguator from the source;
- name-only candidates: any identifier or independent record that ties the label to the unit.

## 7. Review and approval workflow (reused from Stage 3a)

| Step            | Mechanism                                                                                  | Rule                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Proposal        | a **reviewer** login calls `identity_propose`                                              | the proposer is the session login; cannot review or approve it                                                             |
| Evidence review | `identity_review` with `recommend`, `reject` or `needs_evidence`                           | each reviewer counts once; the proposer cannot review                                                                      |
| Deferral        | a `needs_evidence` verdict                                                                 | blocks acceptance (`FI055`); new evidence means a new proposal with a different evidence digest                            |
| Rejection       | `identity_reject` (approver) or a reject verdict                                           | closes the decision; the audit record stays                                                                                |
| Approval        | an **approver** login calls `identity_accept` into a draft mapping set                     | never the proposer or a reviewer; one recommending reviewer, two for high risk (`FI056`)                                   |
| Versioning      | numbered mapping sets (`geo-ids-YYYYMMDD-vN`), one active at a time, reversible activation | accepted decisions are in effect only through the active set                                                               |
| Reversal        | a new decision about the same label with `supersedes_id`, reviewed like any other          | inside a draft set the old decision becomes superseded; across sets the older set is deactivated; history is never deleted |
| Audit           | `identity_review_event`                                                                    | append-only, even for the owner                                                                                            |
| Application     | **none**                                                                                   | accepting applies nothing; applying accepted mappings is a separate, separately approved stage                             |

`planSubmission` prevents duplicates: an identical claim already proposed or accepted is skipped, closed evidence is not re-proposed, a label with a different accepted decision needs a superseding decision, and a key repeated in one batch is kept once. `toProposeCall` expresses a proposal as the exact `identity_propose` call. Neither connects to a database.

## 8. Security considerations

- The analysis opens a READ ONLY transaction, verifies the server reports it as read only, and always rolls back; the command line uses the application role by default (SELECT only) and refuses an output folder inside the Git working tree.
- No proposal is submitted by any code here: proposing needs a reviewer login, and none exists. Creating the real logins is a separate approval.
- Evidence is data about names and official records; it holds no credential.
- Duplicate prevention is enforced by the database once migration 0007 is applied (section 14); until then the planner is the only protection, and development does not have 0007.
- Reviewer distinctness depends on the administrator issuing one login per person.

## 9. Government-source gaps and limitations

- The **dated LGD modification log** is not available: rename, split and merger dates are unknown, and no split or merger relation can be inferred. Candidates for historical changes are only name-based.
- LGD version-history pages give names and statuses but a date only for the current version.
- Districts **599 (Mahe), 601 (Yanam) and 671 (Shahdara)** return an LGD error page: no official record, no verification possible.
- Telangana's formation is recorded by LGD as 2014-06-17; the legal date is not in the data.
- 24 official districts are absent from the registry; 29 official units are inactive in their own history yet listed in the report; both need decisions outside identity mapping (registry additions, status review).
- Partial-name matches are weak candidates and `bangalore` is ambiguous (Bengaluru Urban, Rural and South); spelling candidates are not proof.
- Mandi-level official identifiers (a government market code per mandi) are not available for most mandis.

## 10. Validation and acceptance criteria

Implemented and passing: deterministic candidate generation in any row order; ambiguity handling; closest-spelling rule; temporal uncertainty; provenance retention; fuzzy similarity never recorded as a mapping; a state correction per mandi, two reviewers; duplicate prevention and non-re-proposal of closed evidence; submission through the real database functions by synthetic logins; reviewer/approver separation (`FI041`, `FI042`, `FI056`, `42501`); deferral blocks acceptance (`FI055`); rejection; reversal by supersession with an intact audit trail; whole-batch rollback; the registry, aliases and mandis byte-identical after every decision (content hash); the audit log append-only.

Acceptance of Stage 3b for review: tests green on disposable databases; development fingerprint unchanged (28 tables, 2,698,327 observations, identity tables empty); no new privileges; this document.

## 11. Remaining work and deployment plan

1. Independent review of this stage; decisions on the weak candidates.
2. Obtain the dated LGD modification log (manual download behind a CAPTCHA) and re-run the analysis; extend the rules to split and merger candidates once dates exist.
3. Create the real reviewer and approver logins (administrator; each person one login in one group) after approval.
4. Submit the candidates in batches into a draft mapping set, through `planSubmission` and `toProposeCall`, as a reviewer login.
5. Migration 0007 (duplicate protection and the state-evidence guard, section 14) is ready and rehearsed on disposable databases; applying it to development needs its own backup, clone rehearsal and approval, before any proposal is submitted.
6. After accepted mapping sets exist: a separate, separately approved stage decides how (and whether) accepted decisions are applied or exposed in the API, with dated validity, never by rewriting observations.

Nothing in this plan writes to development without a separate approval.

## 12. Independent review and hardening pass

A second, independent review of every module of this stage. Defects and weaknesses found, and what was done:

| #   | Finding                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                             | Test                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `bangalore` was classified as a name-only candidate for Bengaluru Rural alone (it matched the former name "Bangalore Rural")                                                                                                         | a label that is part of a FORMER name whose stem has since been respelled now brings in every district of the same state that shares the current name's stem (Urban, Rural, South): ambiguous, two reviewers, no target                                                                                                                                                                                                         | `keeps a Bangalore-like label ambiguous`                                                   |
| 2   | each of the 27 suspected Telangana mandis was a `correct_state` proposal although the only evidence is that the district label is an official Telangana district, which is state-level evidence about the label, not about one mandi | without market-specific evidence a mandi is proposed only as `mark_unresolved` (class U, `evidenceLevel: state_level_only`, `missingEvidence` listed); `correct_state` exists only when evidence of a recognised kind, naming the target state and carrying a reference, is supplied from outside the database; building a `correct_state` call without it throws; the database refuses to accept one (migration 0007, `FI057`) | unit tests and `refuses to accept a state correction that has no market-specific evidence` |
| 3   | duplicate open proposals were prevented only by the planner                                                                                                                                                                          | database guarantee in migration 0007 (section 14)                                                                                                                                                                                                                                                                                                                                                                               | duplicate and concurrency tests                                                            |
| 4   | per-label totals counted a mandi once for every alias it carries (86,461 observations, 215 mandis) next to distinct totals                                                                                                           | the summary now reports both, and names the mandis under several labels (section 13)                                                                                                                                                                                                                                                                                                                                            | `counts a mandi once in the distinct totals`                                               |
| 5   | the "inactive" status of the last row of an LGD history page was presented as a finding without a warning                                                                                                                            | it is flagged `history_status_unverified`: Maharashtra and Odisha, which are active states, show it too, so it is not evidence that a unit ended                                                                                                                                                                                                                                                                                | analysis test                                                                              |
| 6   | ordering used `localeCompare`, which depends on the machine's locale                                                                                                                                                                 | locale-independent comparison everywhere                                                                                                                                                                                                                                                                                                                                                                                        | `is deterministic`                                                                         |
| 7   | the command line read through whatever login `DATABASE_URL` named                                                                                                                                                                    | `readSnapshot` can require a read-only login and the command line does: it refuses a superuser or any login that can write markets, decisions, reference rows or observations                                                                                                                                                                                                                                                   | `analyses only with a login that can read and nothing else`                                |
| 8   | undated version changes were not visible on a candidate                                                                                                                                                                              | `boundaryChanges: versions_without_dates` when a unit has more than one version; `baselineIsNotFormationDate` for the 2005 default                                                                                                                                                                                                                                                                                              | temporal tests                                                                             |
| 9   | no proof that proposal values never reach SQL text                                                                                                                                                                                   | a test with hostile labels: every value is a bound parameter                                                                                                                                                                                                                                                                                                                                                                    | `expresses a proposal as the exact identity_propose call`                                  |

Checked and found sound: the snapshot is a fixed set of SELECT statements in a READ ONLY transaction, always rolled back; the call builder uses a fixed list of argument names and numbered parameters; proposals are pure data; analysis output is a function of the snapshot only; the audit log stays append-only; separation of duties, the two-reviewer rule, deferral and reversal are the database's own, unchanged.

## 13. Reconciliation of the headline numbers

| Pair                                             | Cause                                                                                                                                                                                                                                                                                                                                                                                                                                          | Query and scope                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 86,461 vs 86,427 observations, 215 vs 213 mandis | Two mandis, **Manachanallur (Uzhavar Sandhai)** (14 observations) and **Manapparai (Uzhavar Sandhai)** (20), each carry two market aliases, one filed under the state spelling `Tamil Nadu` and one under `Tamilnadu`. Both belong to the district label `thiruchirappalli`, which exists once per state spelling, so the per-label totals count each of the two mandis twice: 213 + 2 = 215 mandis and 86,427 + 14 + 20 = 86,461 observations | 86,427 / 213 is **distinct mandis with no district** (`SELECT count(DISTINCT id), sum(observations) FROM markets WHERE district_id IS NULL`, joined to `mandi_observations`); the same 213 mandis are exactly those reached through the 49 unresolved aliases (none missed, none that already have a district). 86,461 / 215 is the **sum over the 49 labels** of the mandis found by the alias key prefix `market\|state\|district\|` |
| 29 vs 27 inactive units                          | 27 are **districts** and 2 are **states** (Maharashtra and Odisha). The manual review counted districts only                                                                                                                                                                                                                                                                                                                                   | units whose latest history row is `inactive` in the page sets: 27 in `lgd-district-pages`, 2 in `lgd-state-pages`; 26 of the 27 districts are linked to a registry district. Both states are active, so this status is unreliable (finding 5)                                                                                                                                                                                          |

Historical data was not touched; the summary now prints both totals so the two never need reconciling again.

## 14. Duplicate-proposal protection: decision

**Decision: enforce it in the database, in migration 0007, rehearsed on disposable databases only.** Reasons: the planner can be bypassed or raced (two reviewers submitting the same batch at once), the cost is two partial unique indexes, and nothing existing is affected.

- `idec_open_proposal_key_uq`: unique on `evidence->>'proposalKey'` where `status = 'proposed'`. At most one open proposal per generated claim.
- `idec_proposal_evidence_uq`: unique on `(proposalKey, evidenceDigest)` for every status. The same claim with the same evidence can be recorded once, whatever became of it; new evidence has a new digest. Hand-made proposals without these keys are unaffected.
- `identity_state_evidence_guard` trigger (`FI057`): a `correct_state` decision cannot become accepted unless `evidence.marketSpecificEvidence` is a non-empty array. The database does not judge the entries; reviewers do.

Concurrency: the unique index serialises identical inserts. A second concurrent identical `identity_propose` waits for the first transaction and then fails with `23505` on the constraint (the first wins; the loser leaves no row). Submitters use `submitWithRetry`: `23505` on either index is reported as `duplicate_open` / `duplicate_evidence` (not an error), `40001`, `40P01` and `55P03` are retried with exponential backoff (three attempts), a workflow rule (`FIxxx`) is never retried. Tested with three simultaneous reviewers submitting the same proposal: exactly one row, two duplicates reported; repeating a whole batch changes nothing.

Rollout: 0007 is **not applied to development**. It is additive (two indexes, one trigger), safe on the empty identity tables, idempotent under the migration runner, and needs the same backup, rehearsal on a disposable clone and approval as 0005 and 0006 before it is applied. Until then the planner is the only protection in development; no proposal has been submitted there.

## 15. Updated results (development, read-only, hardened code)

| Finding                                                | Count                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Unresolved district aliases                            | 49: 9 exact official name, 14 documented rename, 15 name-only, **3 ambiguous (Bangalore, Delhi, Kanpur)**, 8 state mismatch |
| Mandis / observations under them                       | 213 mandis, 86,427 observations (distinct)                                                                                  |
| Suspected Telangana mandis                             | 27 mandis, 8,935 observations, **all pending as `mark_unresolved`, none as a state correction**                             |
| Unresolved state alias                                 | 1 (Gao): name-only candidate Goa                                                                                            |
| Official districts absent from the registry            | 24                                                                                                                          |
| Registry districts without an official record          | 3 (599, 601, 671)                                                                                                           |
| Inactive-in-history official units (unreliable status) | 29 (27 districts, 2 states)                                                                                                 |
| Mandi names in several locations                       | 14                                                                                                                          |

Candidate proposals: **69** (9 exact, 14 rename, 16 name-only, 3 ambiguous, 27 pending state mismatches), 4 high risk (three ambiguous labels and the state label); **0** state corrections.

## 16. Temporal evidence

- LGD retrieval times are provenance (`retrievedAt`) only. Every date shown as an effective date comes from the unit's own version row (`lgd_effective_date`); a test asserts that no candidate's effective date equals its retrieval time and that no candidate carries a legal date.
- The 2005 default is flagged `currentVersionIsBaseline` and `baselineIsNotFormationDate` and gives the temporal state `current_version_is_lgd_baseline_2005`; it is never used as a formation or change date.
- A rename's date is always `not_published`. A unit with more than one version carries `boundaryChanges: versions_without_dates`: its area may have changed at an unknown time.
- No split or merger is inferred anywhere: without dated official records a candidate stays a name-based question, and a label that fits several units stays ambiguous.
- Unknown dates stay visible: `current_version_date_unknown`, `renameDate`, `stateBoundary` and the `limitations` list travel in every proposal's evidence.
