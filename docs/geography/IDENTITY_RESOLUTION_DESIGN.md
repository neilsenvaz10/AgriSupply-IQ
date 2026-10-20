# Identity-resolution design (proposal)

Status: **design only.** No schema, data or code has been changed. This document describes how source labels could be
matched to authoritative geography and mandi identities **without ever overwriting what the source said**.

## 1. Principles

1. **Source labels are immutable.** `source_state_label`, `source_district_label`, `source_market_label` on every
   observation, and the alias tables, are never edited. A resolution is a _separate, dated, evidence-backed record_.
2. **Observations are never rewritten.** Mapping changes how mandis are grouped and filtered, not the 2,698,327 rows.
3. **Verified means an official identifier or an official dated record matched.** Name similarity, however strong, yields at
   most a _candidate_.
4. **Dated, not retrofitted.** A mapping carries `valid_from` / `valid_to`; it is judged against the geography in force on
   the observation date. Present-day districts are not assigned to historical observations automatically.
5. **Every decision is reviewable and reversible.** Decisions are append-only; "undo" is a superseding decision.
6. **Fail closed in the product.** Anything not verified stays labelled unverified, exactly as today.

## 2. Classification of candidate matches

| Class                                                | Meaning                                                | Entry condition                                                                                                                        | What the product may say                                 |
| ---------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **V — Verified**                                     | Matched through an authoritative identifier            | An LGD code or registry market ID from an official, hash-recorded source file, confirmed by a reviewer, plus consistent state/district | "Matched to <source> ID <id>" with source and date       |
| **S — Strong candidate, review required**            | Several independent attributes agree but no identifier | Exact normalised name after a _documented_ transliteration/spelling rule AND the same state AND (district or coordinates agree)        | "Probable match, not confirmed"                          |
| **A — Ambiguous**                                    | More than one plausible target                         | e.g. `bangalore` (Urban/Rural), `delhi` (11 districts), `kanpur` (Nagar/Dehat), a homonym market                                       | Stays unresolved; shows candidate list to reviewers only |
| **U — Unresolved**                                   | No acceptable candidate                                | no match, or evidence conflicts                                                                                                        | Unchanged from today                                     |
| **H — Historical change, effective-date validation** | Match exists only through a rename, split or merge     | A dated change record links the old and new unit                                                                                       | Mapped _as of_ the observation date; shows both names    |

A single observation label can move between classes as evidence arrives; every move is an event (section 5).

## 3. Evidence model

Each candidate link stores a structured **evidence checklist**, not a single score. A "confidence indicator" is the
_highest class reached_ plus the list of which checks passed:

| Check                  | Source type                        | Passes when                                                                    |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Identifier match       | LGD code / registry ID             | exact code match in a hash-recorded official file                              |
| Official change record | Gazette / Act / state notification | document reference and date recorded, effective date known                     |
| State agreement        | LGD / registry                     | candidate's state equals the source state **as resolved** (never guessed)      |
| District agreement     | LGD / registry                     | same, at district level                                                        |
| Name rule              | documented rule id                 | a named normalisation (e.g. "spelling variant, rule SP-03") — no fuzzy scoring |
| Corroboration          | government-derived mirror          | an independent derived source agrees                                           |
| Location               | coordinates / address              | within the candidate district polygon or address matches                       |
| Conflict               | any                                | another source disagrees (blocks promotion)                                    |

A candidate may be promoted to **V** only through an identifier or an official change record. Name rule + corroboration
caps at **S**.

## 4. Handling the known categories

| Category (from the audit)                                   | Approach                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30 spelling variants                                        | Rule-based candidate (S) against the authoritative list for the _observation-date_ spelling; reviewer confirms; promoted to V only when the official code is matched                                                                                                                                            |
| 7 renames/changes (gurgaon, mewat, hoshangabad, khandwa, …) | Class **H**: require the dated change record; store both names with `valid_from`; no mapping before the date                                                                                                                                                                                                    |
| 8 Telangana labels under Andhra Pradesh                     | Not a district problem: the **state** of 27 mandis is wrong in the source. Needs per-mandi evidence (the market yard's district, from an official register or a state directory). Until then they stay unresolved and the UI/API should disclose that "Andhra Pradesh" mandis include Telangana towns (Stage 7) |
| 4 ambiguous labels                                          | Class **A**; resolution only with the mandi's own location/registry entry                                                                                                                                                                                                                                       |
| `Keralam`                                                   | Keep as reviewed decision; promote once the primary eGazette document is attached as evidence                                                                                                                                                                                                                   |
| `Gao` (4 rows)                                              | Stays quarantined. A decision "Gao → Goa" needs source-row confirmation (market, commodity, date) or publisher statement; never inferred from the district label alone                                                                                                                                          |

## 5. Mandi identity resolution

A mandi has no official identifier in our data. Proposed order:

1. Acquire a **candidate registry** (eNAM directory, AGMARKNET IDs, state lists) as _source files with hashes_ — they are
   evidence, not truth.
2. Generate candidates per mandi from **registry entries in the same resolved state**, scoring only through the checklist
   above. Homonyms across states (14 names, 28 mandis) can never match across states.
3. Parenthesised variants (314 names: `Lasalgaon(Vinchur)`, `Kota (F&V)`) are **not** merged or split by rule. A reviewer
   decides "same market / separate yard / alias", citing the registry's own entries.
4. A mandi becomes V only with a registry ID **and** a consistent district. Name-only equals S at most.
5. Closures, renamings and merges are recorded with dates and the existing `merged_into_market_id` link (no deletion).

## 6. Review workflow

States: `proposed` → `in_review` → (`accepted` | `rejected` | `needs_evidence` | `deferred`) → optionally `superseded`.

- Every item shows: the original source labels (verbatim), the number of observations and date span affected, the candidate(s)
  with the evidence checklist, conflicts, and the _impact preview_ (which API filters and counts would change).
- A decision records: reviewer, timestamp, class, evidence references (document + URL + hash), free-text rationale, and the
  ruleset version.
- Two-person rule for promotions that change a **state** (Telangana, Gao) or merge mandis.
- Nothing applies automatically. Accepted decisions are applied in a **batch** with a before/after report (Stage 7).

## 6b. Audit history

An append-only event log (`identity_review_event`: item, from-class, to-class, actor, evidence, time). Supersession keeps the
prior decision. A restore of any prior state is possible from the log alone. Source labels and observations are never part of
the write set, so the audit trail cannot drift from the data.

## 7. Effect on the product

- **API filters.** `district_id` and `state_id` filters read the _accepted_ mapping. After a batch, results for a given
  district can gain mandis. Cursors issued before the batch refer to the old grouping; the existing filter-bound cursors
  already reject filter changes, and a mapping-set version stamp in the cursor fingerprint would make a stale cursor a clear 400.
- **Responses.** Add (later) `identity_status` (class), the mapping `valid_from`, and keep `source_labels` unchanged.
- **Forecasting eligibility (future).** Series are built per verified mandi identity. Unverified or ambiguous identities and
  any series whose identity changed in the window are excluded or flagged; district-level aggregates only use districts
  resolved as of each observation date.

## 8. Non-goals in this milestone

No fuzzy-string auto-matching, no automatic assignment of current districts to historical rows, no deletion or merging of
mandi rows without a recorded decision, no change to any original label.
