# Operator runbook: geographic identity review (Stage 3c)

For the operator who runs the pilot. **Nothing here has been run on the development database.** Each gate below is a separate written authorization from the owner; passing one never implies the next. Every step names its tool; every tool refuses to act outside its rules. No credential, connection string or authorization goes into Git.

> **Warning: the database does not enforce independent approval of mapping-set activation.** Any single approver login can activate a set, even one they filled. The independence of the activator from the acceptor(s) required in gate D is checked by the operator against the audit log (`identity_review_event`: `accepted` events versus the `mapping_set_activated` event), not by PostgreSQL. Do not activate a set without that check, and do not open gate D without the owner's explicit acceptance of this limitation or a migration that enforces it.

Notation: `DEV` is the development database (`fasalytics`, 127.0.0.1:5433, PostgreSQL system identifier `7697971194938445858`). Commands run from the `database` folder. Variables such as `DATABASE_ADMIN_URL` are set in the shell for that command only (the tools read no `.env`).

## 0. Preflight (before every gate)

1. Docker Desktop is up (it has stopped on its own before); `fasalytics-db` and the other three containers are healthy.
2. `DEV` identity: database `fasalytics`, system identifier above, PostgreSQL 17.11, not in recovery.
3. 8 migrations applied (`SELECT count(*) FROM drizzle.__drizzle_migrations`), 28 tables, `main` at the reviewed commit, working tree clean.
4. No ingestion run active, no other writer (`pg_stat_activity` shows only idle sessions).
5. Fingerprint of the 28 tables equals the last approved one (`database/scripts` tooling / the read-only fingerprint of the previous gate); 2,698,327 observations; 4 reference sets, 2,899 reference rows.
6. Identity state is what the previous gate left: before gate A or B it is **0 decisions, 0 mapping sets, 0 events**.
7. Disk space for a backup (about 400 MB) and for a restore copy.

**Stop** if any item fails; report and wait.

## 1. Backup and restore rehearsal (before gates A, B and C, and whenever more than 24 hours old)

1. `pg_dump -Fc` of `DEV` to a timestamped file outside Git and outside the Docker volume; record size and SHA-256 in the access register; keep all older backups.
2. Restore it into a **new disposable** PostgreSQL container (stamped disposable token, own random credentials); compare the 28-table fingerprint with `DEV`. A mismatch stops the gate.
3. Optional but recommended before gate B: run the whole workflow on that copy with `scripts/geo-rehearse.js` (environment of the copy only; the script refuses anything not verified disposable). All checks must pass.
4. Remove the disposable container afterwards; keep the dump.

## 2. Gate A: create the real reviewer and approver logins

**Authorization needs:** the owner's written list of people (an identifier of 2-25 lower-case letters and digits, group, expiry of at most 90 days).

1. Preflight and a fresh backup (sections 0 and 1).
2. Administrator connection from `POSTGRES_*` in the shell only: `DATABASE_ADMIN_URL` (never printed or saved).
3. For each person: `node scripts/review-logins.js provision --person <id> --kind reviewer|approver --valid-days <n> --credential-file <path outside Git>`. At least **two reviewers and two approvers** are needed to run the pilot (the proposer, a reviewer, and two different approvers: one accepts, another activates).
4. `node scripts/review-logins.js list` shows each login in its group with its expiry.
5. Deliver each credential file to its owner by a channel outside this repository; delete the original.
6. Each person runs a self-check (`reviewLoginProblems`, run automatically by `geo-submit.js`): no excess privilege.
7. Post-checks: identity tables still empty; fingerprint of the 28 tables unchanged; `db:verify` passes.

**Stop conditions:** any login with an attribute outside the design; a person with two logins; an expiry beyond 90 days.
**Rollback:** `review-logins.js revoke --person <id> --kind <kind>`, or `revoke-all`.

## 3. Gate B: draft mapping set and pilot proposals

**Authorization needs:** the exact proposal keys (from the analysis, section 3 of `STAGE_3C_REVIEW_PREPARATION.md`; two for the strict pilot, at most five), the reviewer who proposes, and the approver who creates the set.

1. Preflight, fresh backup, restore rehearsal (section 1) and, recommended, the rehearsal script on the copy.
2. Regenerate the analysis read-only and confirm the keys and evidence are what was authorized: `node scripts/geo-analyze.js --out-dir <outside Git>` (application role). Confirm no existing decision for them.
3. An **approver** creates the draft set in a SQL session as their own login: `SELECT public.mapping_set_create('geo-ids-YYYYMMDD-v1', 'pilot')`. (Code format `geo-ids-<date>-v<n>`.)
4. The **reviewer** (own credential file) runs, with `DATABASE_URL` = the read-only application login and `DATABASE_REVIEW_URL` = their login: `node scripts/geo-submit.js --keys <k1,k2>` (dry run, read the plan), then the same with `--execute`. It refuses non-pilot items, approvers, over-privileged logins; a repeat reports `already_proposed`.
5. Post-checks: exactly the authorized number of decisions, all `proposed`; one `proposed` event each, by the reviewer's login; all other tables unchanged (fingerprint); observation count unchanged.

**Stop conditions:** a proposal not in the authorized list, a duplicate that is not reported, any status other than `proposed`.
**Rollback:** the proposer calls `identity_withdraw(id, reason)` for each decision (they stay as audit records); a mistaken draft set is simply left unused.

## 4. Gate C: review and accept individual proposals

**Authorization needs:** one decision at a time (the proposal key), the reviewer and the approver who will act. Never a batch acceptance.

1. A reviewer **other than the proposer** reads the evidence in the decision (`evidence`, `evidence_refs`, `rationale`: official unit, page hash, dates, limitations) and opens the cited official page; records `identity_review(id, 'recommend' | 'reject' | 'needs_evidence', note)`. `needs_evidence` defers (acceptance is then blocked); new evidence means a new proposal with a new digest.
2. High-risk items (ambiguous, any state-level decision, any `correct_state`) need **two** recommending reviewers. A `correct_state` additionally needs `evidence.marketSpecificEvidence` (an official listing of that mandi, a market code record or a gazette notification); none exists today.
3. An approver who neither proposed nor reviewed calls `identity_accept(id, set)` into the **draft** set, or `identity_reject(id, reason)`.
4. After each acceptance: one `accepted` event by the approver; the registry, aliases, mandis and observations unchanged (fingerprint); the decision appears in `identity_decision` only, and `identity_decision_in_effect` is still empty (the set is a draft).
5. **Activation** is not part of this gate (it belongs to gate D): the set stays a draft.

**Stop conditions:** an acceptance by someone who proposed or reviewed (the database refuses it; investigate any attempt), any change to another table.
**Reversal:** a new proposal about the same label with `supersedes_id`, reviewed and accepted into the same draft set; or leave the set unused.

## 5. Gate D: expose accepted mappings through application APIs

**Authorization needs:** a design reviewed first (what a reader does with `identity_decision_in_effect`, validity dates, caching, how an API labels a mapped versus an unmapped record, that observations keep their source labels), separate from this runbook.

1. A **different approver than the one who accepted** the decisions activates the set: `mapping_set_activate(set)`. **Check first, by hand, that the activating login appears in no `accepted` event of the set** (this is not enforced by the database). Only one set is active; activation is reversible.
2. Readers use `identity_decision_in_effect` through `interpretInEffect` / `resolveLabel` (read-only, fails closed, honours `valid_from` and `valid_to`).
3. Deactivation (`mapping_set_deactivate`) takes every decision out of effect at once.

Never authorized by any gate: rewriting an observation, a market, a district or an alias.

## 6. Post-operation integrity checks (after every gate)

- Same 28 tables; the fingerprint of every table except the three identity tables equals the pre-gate fingerprint; the three identity tables equal exactly what the gate should have created.
- 2,698,327 observations; 4 reference sets and 2,899 rows.
- `SELECT status, count(*) FROM identity_decision GROUP BY 1` as expected; every audit event names a real person's login.
- `db:verify` passes; the API health check is ok.

## 7. Access revocation

- Planned end: `review-logins.js revoke`, or let `VALID UNTIL` expire.
- After a gate that needs a login only for a short time: revoke at once.
- **Emergency** (a leaked credential, a suspect login): `review-logins.js revoke-all` terminates all sessions and drops all review logins; then investigate with the audit log; re-provision after the cause is fixed.
- The administrator removes credential files from disk after delivery.

## 8. Rollback and recovery

| Situation                            | Action                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a wrong proposal                     | the proposer withdraws it (reason required)                                                                                                               |
| a wrong acceptance in a draft set    | a superseding decision, or leave the set unused                                                                                                           |
| a wrong active set                   | `mapping_set_deactivate`, or activate the previous set                                                                                                    |
| a wrong login                        | revoke and provision again                                                                                                                                |
| anything unexpected in another table | stop; compare fingerprints; restore from the verified backup only with the owner's approval (the identity workflow never writes outside its three tables) |

The three identity tables are append-only history by design: decisions are never deleted, only closed.

## 9. Stop conditions (any time)

A failed preflight; a fingerprint difference outside the identity tables; a refused or surprising database error (`FIxxx`, `42501`) that is not understood; an expired or missing authorization for the gate; Docker Desktop stopping; a person asking to act in the other role. Stop, record the state, report, and wait for the owner.
