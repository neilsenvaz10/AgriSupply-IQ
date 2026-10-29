# Stage 3c: geographic identity review preparation

Milestone 2.4, Stage 3c. Status: **preparation only.** Nothing in this stage writes to the development database, creates a real login, submits a proposal or changes a geographic assignment. Everything that writes was rehearsed on disposable databases with synthetic people.

> **Warning: mapping-set activation has no database-enforced independent approval.** `mapping_set_activate` (and `mapping_set_deactivate`) can be run by any single approver login, including the approver who created the set and accepted every decision in it. The database enforces independence for _proposing, reviewing and accepting_ a decision (proposer, reviewers and approver are different people; two reviewers for high risk), but not for _activating_ the set that makes accepted decisions visible in `identity_decision_in_effect`. Until a future migration closes this, independence of activation is an **operating rule** in the runbook (a different approver activates than the one who accepted), checked by the operator, not by PostgreSQL. No mapping set has been created or activated, and nothing reads the view yet; gate D must not be opened before this is either enforced or explicitly accepted by the owner.

## 1. Audit of the existing workflow

Read from migrations 0006 and 0007 and checked against the live catalog of development (read-only, 2026-10-21).

| Area                         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write path                   | `identity_propose`, `identity_review`, `identity_accept`, `identity_reject`, `identity_withdraw`, `mapping_set_create`, `mapping_set_activate`, `mapping_set_deactivate` are the only way to write. All are SECURITY DEFINER with `search_path = pg_catalog, pg_temp`; the owner-only trigger refuses any other writer, a superuser included.                                                                                                                                                                    |
| Privileges (actual)          | `identity_propose`, `identity_review`, `identity_withdraw`: `fasalytics_reviewer` only. `identity_accept`, `identity_reject`, `mapping_set_*`: `fasalytics_approver` only. `PUBLIC` holds nothing; the internal helpers (`identity_log_event`, `identity_caller_role`, `identity_require_role`, guards) are executable only by the owner and the administrator. The application and ingest roles have SELECT on the identity tables and no function. The two group roles are NOLOGIN, no attributes, no members. |
| Caller identity              | `session_user`, never a parameter. A login in neither group (`FI011`) or in both (`FI010`) is refused, so the administrator and the owner cannot act as reviewer or approver.                                                                                                                                                                                                                                                                                                                                    |
| Separation                   | the proposer cannot review (`FI041`), nobody reviews twice (`FI042`), the approver is never the proposer (`FI053`, and a check constraint) or a reviewer of the decision (`FI054`); two distinct recommending reviewers for `correct_state`, `merge_markets`, class A and every state-level decision (`FI056`); any reject or `needs_evidence` verdict blocks acceptance (`FI055`).                                                                                                                              |
| Transactions and concurrency | every function locks the decision row (`FOR UPDATE`), the mapping-set row, and advisory locks per label and per mandi; the unique indexes stop what the locks do not. Rehearsed: two approvers accepting one decision at once give exactly one acceptance (the loser gets `FI051`); two reviewers reviewing at once are both recorded; identical concurrent proposals give one row.                                                                                                                              |
| Audit                        | `identity_review_event` is append-only (UPDATE, DELETE and TRUNCATE refused for everyone, owner included) and records the session login and role of every step, including mapping-set changes. Logins can be dropped without losing their name in the log (it is text).                                                                                                                                                                                                                                          |
| Migration 0007               | present and enabled in development: `idec_open_proposal_key_uq`, `idec_proposal_evidence_uq`, trigger `idec_state_evidence` (`FI057`).                                                                                                                                                                                                                                                                                                                                                                           |
| View                         | `identity_decision_in_effect` is `security_invoker`; it shows accepted decisions of the one active set. Nothing reads it yet.                                                                                                                                                                                                                                                                                                                                                                                    |

### Findings and recommendations

1. **One approver can create, fill and activate a mapping set** (`mapping_set_activate` has no second-person rule; see the warning above), and the approver who accepted a decision can also activate the set. Activation only changes what the view shows, and no application reads it until gate D, so this is acceptable for the pilot, but the runbook requires a _different_ approver to activate than the one who accepted (an operating rule, not a database rule). A database rule (activation by an approver who accepted nothing in the set) is a candidate for a future migration 0008; it is not needed before gate D.
2. **Adding a person to a group needs a superuser.** The group roles have no `CREATEROLE` members, so a reviewer cannot make anyone a reviewer. Membership is granted `WITH INHERIT TRUE, SET FALSE`, so a person uses the group's privileges but cannot `SET ROLE` into it (tested).
3. **No defect found in the state machine.** Hardening added in this stage: personal-login provisioning and revocation tooling, a command-line submitter that refuses anything outside the pilot rules, a read-only interpretation module, and the rehearsal harness. No migration is needed.

## 2. Reviewer and approver access design

### Principles

One person, one login, one group; personal logins only (no shared accounts, no service accounts that can propose or approve); least privilege; credentials outside Git; every act attributable to a person by the audit log; access ends at a stated date by itself.

### Roles

| Role                                    | Responsibilities                                                                                                   | Can                                                                                                           | Cannot                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Reviewer** (`fasalytics_rv_<person>`) | proposes decisions, records an evidence verdict (`recommend`, `reject`, `needs_evidence`), withdraws own proposals | `identity_propose`, `identity_review`, `identity_withdraw`; SELECT on reference, registry and identity tables | accept, reject as approver, manage sets, review own proposal, write any table directly |
| **Approver** (`fasalytics_ap_<person>`) | accepts or rejects a reviewed proposal into a **draft** mapping set, creates, activates and deactivates sets       | `identity_accept`, `identity_reject`, `mapping_set_*`; SELECT as above                                        | propose, review, accept own or reviewed decisions, write any table directly            |
| **Administrator**                       | creates and revokes logins, backups, migrations                                                                    | database administration                                                                                       | act as reviewer or approver (refused by the functions)                                 |
| **Operator**                            | runs the runbook, holds the authorization of each gate                                                             | runs the tooling                                                                                              | decide on evidence                                                                     |

A person who proposes is a reviewer; the person who approves is another person. Two reviewers are required for high-risk items; the approver must be a third person.

### Provisioning (administrator, after gate A)

`node scripts/review-logins.js provision --person <id> --kind reviewer|approver --valid-days <1-90> --credential-file <path outside Git>` with `DATABASE_ADMIN_URL` set explicitly (no `.env` is read). The login: LOGIN, no superuser, create-role, create-database, replication or bypass-RLS, `CONNECTION LIMIT 2`, `VALID UNTIL` (at most 90 days), member of exactly one group with INHERIT and no SET, nothing else. The random 192-bit password is written only to the owner-only credential file (mode 600 / owner-only ACL, refused inside the Git tree, never printed). The person receives it by a channel outside this repository; the administrator deletes the original. `reviewLoginProblems` lets the login check itself; the command-line submitter runs it.

### Revocation

`review-logins.js revoke --person <id> --kind ...` terminates the person's sessions, drops owned objects and the login. **Emergency:** `review-logins.js revoke-all` removes every review login at once; it needs only the administrator connection. Decisions and audit events survive (the actor is stored as text). `VALID UNTIL` ends access by itself even if nobody acts.

### Credential storage

Outside Git, in a folder only that person and the administrator can read; the repository never contains a password, a connection string with a password, or an authorization. People keep their credential in their own secret store, not in a shared folder; rotation = revoke and provision again.

### Identity attribution

The audit log records `session_user`, so the login name must identify the person: `fasalytics_rv_<person>` / `fasalytics_ap_<person>`, one-to-one with a named human recorded in the operator's access register (outside Git).

### Separation of duties and high-risk items

Enforced by the database (section 1). High-risk items (ambiguous labels, state labels, any `correct_state`) need two distinct recommending reviewers plus an approver, three different people.

## 3. Pilot candidates (not submitted)

`selectPilot` (pure, deterministic) allows only: an exact current official name (or a spaces-or-punctuation difference only) of exactly one district of the label's own state; an official unit with a single version still carrying LGD's 2005 default date (no recorded change of name or boundary), active, already a district of the registry, no partial name match, one reviewer. Renames, ambiguous labels (Bangalore, Delhi, Kanpur), state mismatches (Telangana), name-only candidates and any unit with undated version changes are never pilot items.

**Strict pilot (recommended): 2 items.**

| Label (source geography)                                                               | Proposed official unit                     | Match                         | Evidence (loaded reference)                                                                                                                                                         | LGD dates                                                                             | Observations                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| `ambedkarnagar` (label state `uttar pradesh`, dataset `mandi_daily_prices_historical`) | **Ambedkar Nagar, LGD 121**, Uttar Pradesh | equal once spaces are ignored | set `lgd-district-pages-20261020` (fingerprint `62904cd1ac36`), page `globalviewDistrictDetail.do?globaldistrictId=121`, SHA-256 `6fdfe982a1f9…`, retrieved 2026-10-20 11:15:39 UTC | one version; current version dated 2005-01-01 (LGD default, **not** a formation date) | 1,887, one mandi, 2023-06-06 to 2025-06-11 |
| `yamuna nagar` (label state `haryana`, same dataset)                                   | **Yamunanagar, LGD 76**, Haryana           | equal once spaces are ignored | same set, page `…globaldistrictId=76`, SHA-256 `af16b0c401b8…`, retrieved 2026-10-20 11:15:23 UTC                                                                                   | one version; 2005-01-01 default                                                       | 6,052, six mandis, same window             |

Both: decision `map_label` (district), expected class **S** (strong candidate, no identifier on the label), **one** recommending reviewer plus an approver. Limitations: no LGD code accompanies the labels, so identity rests on the name inside the label's own state; the official dates are LGD's default and say nothing about when the district was formed; the dated LGD modification log is unavailable; the retrieval times are provenance, not legal dates.

**Conditional extension (up to three more, only if you accept the stated caveat):** these are exact current-name matches that the strict rules exclude for a reason a reviewer can weigh.

| Label                                     | Unit                     | Caveat                                                                                                            | Observations       |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| `kushinagar` (Uttar Pradesh)              | Kushinagar, LGD 160      | two versions in the unit's history, dates not published; current version 2005 default                             | 560, one mandi     |
| `dahod` (Gujarat)                         | Dahod, LGD 445           | three versions (undated); the last history row shows "inactive", an unreliable status (active states show it too) | 1,822, four mandis |
| `jajpur` (Orissa, state spelled `orissa`) | Jajpur, LGD 356 (Odisha) | two versions (undated); same unreliable "inactive" flag                                                           | 17, one mandi      |

Excluded exact-name candidates and why: `ahmedabad`, `sabarkantha`, `kancheepuram` and `north 24 parganas` have a current version dated after 2005 (a recorded change whose nature and date are not published) and several versions.

## 4. Rehearsal of the complete workflow (disposable only)

Run twice: (a) in the automated suite on a synthetic geography, with logins created by the real provisioning code (`src/geography/rehearsal.integration.test.js`, run by `npm run test:disposable`); (b) on a **restored copy of the development database** with its real data and the real pilot candidates (`scripts/geo-rehearse.js`, which refuses to run against anything but a verified disposable database).

Result on the copy of development: **37 of 37 checks passed**, covering:

- proposal submission (five proposals, attributed to the proposer's login), a duplicate by another reviewer reported, nothing changed state by being proposed;
- privilege enforcement: a reviewer cannot accept, an approver cannot propose, a read-only login cannot run any function, nobody writes the tables directly, the proposer cannot review, acceptance without a review is refused;
- two reviewers reviewing at the same time (both recorded once), two approvers accepting one decision at the same time (exactly one acceptance, the other told it is no longer proposed);
- rejection (closed; the same evidence cannot be proposed again, new evidence can), deferral by `needs_evidence` (acceptance blocked, still proposed);
- supersession (the reversal closes the old decision inside the draft set) and activation / deactivation of the set (reversible);
- audit attribution: every event names one of the synthetic logins in its own role, proposals by reviewers, acceptances by approvers who neither proposed nor reviewed, audit log append-only for the owner;
- read-only interpretation: nothing in effect before activation; after activation exactly the accepted decisions, a reader resolves an accepted label to its district, the superseded label to its replacement, rejected / deferred / unproposed labels to nothing; deactivation empties it;
- **no other table changed**: the fingerprint of every table except the three identity tables, every observation row included (735,461 + 1,953,793 + 2,800 + 6,273), is identical before and after.

The automated suite adds: login attributes (one group, no `SET ROLE`, no write, expiring), refusal of a second login for a person and of an over-long life, the command-line submitter (dry run, once, never twice, refuses non-pilot, approver and over-privileged connections), and revocation (a person's open session is terminated, their name stays in the audit log; emergency revocation of everyone).

## 5. Authorization gates

| Gate  | Authorizes                                                                                        | Not included                                                   |
| ----- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **A** | creating the real reviewer and approver logins (named people, groups, expiry)                     | any proposal                                                   |
| **B** | creating a draft mapping set and submitting the pilot proposals                                   | any review or acceptance                                       |
| **C** | reviewing and accepting individual proposals (each acceptance is its own decision of an approver) | activation for readers                                         |
| **D** | exposing accepted mappings through application APIs (and activating the set that feeds them)      | rewriting any historical row (never authorized by these gates) |

Full procedure, stop conditions, rollback and revocation: `STAGE_3C_OPERATOR_RUNBOOK.md`.

## 6. Remaining risks and blockers

- Real people have not been named: gate A needs a list (person identifiers, group, expiry).
- Only two pilot items qualify under the strict rules; the other three need a caveat accepted.
- Evidence limits remain: no dated LGD modification log, no market-specific evidence for the 27 Telangana mandis, districts 599, 601 and 671 without an official record.
- A single approver can still activate a set they filled (operating rule only); a future migration could enforce a second person.
- Acceptance does not change any API output or row; gate D must be designed (what a reader does with `identity_decision_in_effect`, caching, dated validity) before it is opened.
