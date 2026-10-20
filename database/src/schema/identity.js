import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { adminUnitVersion } from './geography.js';
import { dataSources } from './provenance.js';
import { districts, markets, states } from './registry.js';

/**
 * Identity decision infrastructure (Phase 2, Milestone 2.4, Stage 3a, migration 0006).
 *
 * How a source label (a state, district or market as a source wrote it) is related to an official unit or
 * to another mandi is recorded as a DECISION with evidence, never as an overwrite:
 *
 *   proposed --(reviews)--> accepted --(a later decision)--> superseded
 *       |-> rejected      |-> withdrawn
 *
 *  - `identity_decision`: one row per proposal. Its descriptive columns are immutable; only the status
 *    machine moves (enforced by a trigger). Every transition is made by a SECURITY DEFINER function that
 *    records who did it, taken from the session login, never from a parameter.
 *  - `mapping_set`: a numbered, versioned group of accepted decisions. Exactly one set can be active; a set
 *    accepts new decisions only while it is a draft; activating and deactivating are reversible.
 *  - `identity_review_event`: the append-only audit log (UPDATE, DELETE and TRUNCATE are refused).
 *
 * Nothing here is applied to the registry: `markets.district_id`, aliases and observations are untouched.
 * A mapping set being "active" only says which accepted decisions are in effect for readers of the view
 * `identity_decision_in_effect`; applying them to data is a separate, reviewed step (a later stage).
 *
 * Separation of duties (see docs/geography/GEOGRAPHIC_ARCHITECTURE.md): proposers and reviewers hold the
 * reviewer role, approvers hold the approver role, no login may hold both, an approver can never be the
 * proposer or a reviewer of the same decision, and a decision that changes a state, merges mandis or records
 * an ambiguous identity needs TWO distinct recommending reviewers.
 */

export const DECISION_KINDS = /** @type {const} */ ([
  'map_label',
  'correct_state',
  'merge_markets',
  'mark_ambiguous',
  'mark_unresolved',
]);
export const ENTITY_KINDS = /** @type {const} */ (['state', 'district', 'market']);
export const DECISION_CLASSES = /** @type {const} */ (['V', 'S', 'A', 'U', 'H']);
export const DECISION_STATUSES = /** @type {const} */ ([
  'proposed',
  'accepted',
  'rejected',
  'superseded',
  'withdrawn',
]);
export const MAPPING_SET_STATUSES = /** @type {const} */ (['draft', 'active', 'inactive']);
export const EVENT_TYPES = /** @type {const} */ ([
  'proposed',
  'reviewed',
  'accepted',
  'rejected',
  'withdrawn',
  'superseded',
  'mapping_set_created',
  'mapping_set_activated',
  'mapping_set_deactivated',
]);
export const REVIEW_VERDICTS = /** @type {const} */ (['recommend', 'reject', 'needs_evidence']);

const list = (values) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** A versioned group of accepted decisions. At most one set is active at a time. */
export const mappingSet = pgTable(
  'mapping_set',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    description: text('description'),
    status: text('status').notNull().default('draft'),
    /** Login that created the set (taken from the session, not supplied). */
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedBy: text('activated_by'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    deactivatedBy: text('deactivated_by'),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    activationCount: integer('activation_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('mset_code_uq').on(t.code),
    // At most ONE active set: every active row maps to the same constant key.
    uniqueIndex('mset_one_active_uq')
      .on(sql`(true)`)
      .where(sql`${t.status} = 'active'`),
    check('mset_code_ck', sql`${t.code} ~ '^[a-z0-9][a-z0-9._-]*$'`),
    check('mset_status_ck', sql`${t.status} IN (${list(MAPPING_SET_STATUSES)})`),
    check(
      'mset_count_ck',
      sql`${t.activationCount} >= 0 AND (${t.status} <> 'active' OR ${t.activationCount} >= 1)`,
    ),
    check(
      'mset_active_by_ck',
      sql`${t.status} <> 'active' OR (${t.activatedBy} IS NOT NULL AND ${t.activatedAt} IS NOT NULL)`,
    ),
  ],
);

/** One proposed, accepted, rejected, superseded or withdrawn identity decision. */
export const identityDecision = pgTable(
  'identity_decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mappingSetId: uuid('mapping_set_id'),
    decisionKind: text('decision_kind').notNull(),
    entityKind: text('entity_kind').notNull(),
    /** The label exactly as the source wrote it, with its source: the same identity the alias tables use. */
    sourceId: uuid('source_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceLabel: text('source_label').notNull(),
    sourceContext: text('source_context'),
    /** The mandi a market-level decision is about (correct_state, merge_markets). */
    subjectMarketId: uuid('subject_market_id'),
    targetStateId: uuid('target_state_id'),
    targetDistrictId: uuid('target_district_id'),
    targetMarketId: uuid('target_market_id'),
    /** The official LGD version row that is the evidence for a state or district target. */
    targetAdminUnitVersionId: uuid('target_admin_unit_version_id'),
    decisionClass: text('decision_class').notNull(),
    status: text('status').notNull().default('proposed'),
    /** Derived: state labels, state corrections, merges and ambiguous identities need two reviewers. */
    requiresTwoReviewers: boolean('requires_two_reviewers').generatedAlwaysAs(
      sql`(decision_kind IN ('correct_state', 'merge_markets') OR decision_class = 'A' OR entity_kind = 'state')`,
    ),
    evidence: jsonb('evidence')
      .notNull()
      .default(sql`'{}'::jsonb`),
    evidenceRefs: text('evidence_refs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    rationale: text('rationale').notNull(),
    rulesetVersion: text('ruleset_version').notNull(),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    supersedesId: uuid('supersedes_id'),
    proposedBy: text('proposed_by').notNull(),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedBy: text('accepted_by'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedReason: text('closed_reason'),
  },
  (t) => [
    foreignKey({
      name: 'idec_mapping_set_fk',
      columns: [t.mappingSetId],
      foreignColumns: [mappingSet.id],
    }),
    foreignKey({ name: 'idec_source_fk', columns: [t.sourceId], foreignColumns: [dataSources.id] }),
    foreignKey({
      name: 'idec_subject_market_fk',
      columns: [t.subjectMarketId],
      foreignColumns: [markets.id],
    }),
    foreignKey({
      name: 'idec_target_state_fk',
      columns: [t.targetStateId],
      foreignColumns: [states.id],
    }),
    foreignKey({
      name: 'idec_target_district_fk',
      columns: [t.targetDistrictId],
      foreignColumns: [districts.id],
    }),
    foreignKey({
      name: 'idec_target_market_fk',
      columns: [t.targetMarketId],
      foreignColumns: [markets.id],
    }),
    foreignKey({
      name: 'idec_target_unit_fk',
      columns: [t.targetAdminUnitVersionId],
      foreignColumns: [adminUnitVersion.id],
    }),
    foreignKey({ name: 'idec_supersedes_fk', columns: [t.supersedesId], foreignColumns: [t.id] }),
    // Inside one mapping set a label has at most one ACCEPTED decision (also under concurrent approvals).
    // Different sets are different versions: only the active set is in effect.
    uniqueIndex('idec_one_accepted_label_uq')
      .on(t.mappingSetId, t.sourceId, t.entityKind, t.sourceKey)
      .where(sql`${t.status} = 'accepted'`),
    // Inside one mapping set a mandi has at most one accepted decision of each market-level kind.
    uniqueIndex('idec_one_accepted_subject_uq')
      .on(t.mappingSetId, t.subjectMarketId, t.decisionKind)
      .where(sql`${t.status} = 'accepted' AND ${t.subjectMarketId} IS NOT NULL`),
    // A decision is superseded by at most one later decision.
    uniqueIndex('idec_supersedes_uq')
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} IS NOT NULL`),
    index('idec_status_idx').on(t.status),
    index('idec_set_idx').on(t.mappingSetId),
    index('idec_label_idx').on(t.sourceId, t.entityKind, t.sourceKey),
    check('idec_kind_ck', sql`${t.decisionKind} IN (${list(DECISION_KINDS)})`),
    check('idec_entity_ck', sql`${t.entityKind} IN (${list(ENTITY_KINDS)})`),
    check('idec_class_ck', sql`${t.decisionClass} IN (${list(DECISION_CLASSES)})`),
    check('idec_status_ck', sql`${t.status} IN (${list(DECISION_STATUSES)})`),
    check(
      'idec_text_ck',
      sql`btrim(${t.sourceKey}) <> '' AND btrim(${t.sourceLabel}) <> '' AND btrim(${t.rationale}) <> '' AND btrim(${t.rulesetVersion}) <> ''`,
    ),
    check('idec_evidence_ck', sql`jsonb_typeof(${t.evidence}) = 'object'`),
    check(
      'idec_valid_ck',
      sql`${t.validTo} IS NULL OR ${t.validFrom} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
    check('idec_supersedes_ck', sql`${t.supersedesId} IS NULL OR ${t.supersedesId} <> ${t.id}`),
    check(
      'idec_one_target_ck',
      sql`num_nonnulls(${t.targetStateId}, ${t.targetDistrictId}, ${t.targetMarketId}) <= 1`,
    ),
    // What each kind of decision must (and must not) point at.
    check(
      'idec_target_ck',
      sql`CASE ${t.decisionKind}
        WHEN 'map_label' THEN
          (${t.entityKind} = 'state' AND ${t.subjectMarketId} IS NULL AND num_nonnulls(${t.targetStateId}, ${t.targetAdminUnitVersionId}) >= 1 AND ${t.targetDistrictId} IS NULL AND ${t.targetMarketId} IS NULL)
          OR (${t.entityKind} = 'district' AND ${t.subjectMarketId} IS NULL AND num_nonnulls(${t.targetDistrictId}, ${t.targetAdminUnitVersionId}) >= 1 AND ${t.targetStateId} IS NULL AND ${t.targetMarketId} IS NULL)
          OR (${t.entityKind} = 'market' AND ${t.subjectMarketId} IS NULL AND ${t.targetMarketId} IS NOT NULL AND ${t.targetStateId} IS NULL AND ${t.targetDistrictId} IS NULL AND ${t.targetAdminUnitVersionId} IS NULL)
        WHEN 'correct_state' THEN
          ${t.entityKind} = 'market' AND ${t.subjectMarketId} IS NOT NULL AND num_nonnulls(${t.targetStateId}, ${t.targetAdminUnitVersionId}) >= 1 AND ${t.targetDistrictId} IS NULL AND ${t.targetMarketId} IS NULL
        WHEN 'merge_markets' THEN
          ${t.entityKind} = 'market' AND ${t.subjectMarketId} IS NOT NULL AND ${t.targetMarketId} IS NOT NULL AND ${t.subjectMarketId} <> ${t.targetMarketId} AND ${t.targetStateId} IS NULL AND ${t.targetDistrictId} IS NULL AND ${t.targetAdminUnitVersionId} IS NULL
        ELSE num_nonnulls(${t.targetStateId}, ${t.targetDistrictId}, ${t.targetMarketId}, ${t.targetAdminUnitVersionId}) = 0
      END`,
    ),
    // Who and when must agree with the status.
    check(
      'idec_lifecycle_ck',
      sql`CASE ${t.status}
        WHEN 'proposed' THEN ${t.mappingSetId} IS NULL AND ${t.acceptedBy} IS NULL AND ${t.acceptedAt} IS NULL AND ${t.closedBy} IS NULL AND ${t.closedAt} IS NULL
        WHEN 'accepted' THEN ${t.mappingSetId} IS NOT NULL AND ${t.acceptedBy} IS NOT NULL AND ${t.acceptedAt} IS NOT NULL AND ${t.closedBy} IS NULL AND ${t.closedAt} IS NULL
        WHEN 'superseded' THEN ${t.mappingSetId} IS NOT NULL AND ${t.acceptedBy} IS NOT NULL AND ${t.acceptedAt} IS NOT NULL AND ${t.closedBy} IS NOT NULL AND ${t.closedAt} IS NOT NULL
        ELSE ${t.acceptedBy} IS NULL AND ${t.acceptedAt} IS NULL AND ${t.closedBy} IS NOT NULL AND ${t.closedAt} IS NOT NULL
      END`,
    ),
    // The approver is never the proposer.
    check('idec_separation_ck', sql`${t.acceptedBy} IS NULL OR ${t.acceptedBy} <> ${t.proposedBy}`),
  ],
);

/** Append-only audit log of every proposal, review, decision and mapping-set change. */
export const identityReviewEvent = pgTable(
  'identity_review_event',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    eventType: text('event_type').notNull(),
    decisionId: uuid('decision_id'),
    mappingSetId: uuid('mapping_set_id'),
    /** The login that acted, taken from the session. */
    actor: text('actor').notNull(),
    /** `reviewer` or `approver`: the role the actor acted in. */
    actorRole: text('actor_role').notNull(),
    verdict: text('verdict'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    note: text('note'),
    evidence: jsonb('evidence')
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: 'irev_decision_fk',
      columns: [t.decisionId],
      foreignColumns: [identityDecision.id],
    }),
    foreignKey({
      name: 'irev_mapping_set_fk',
      columns: [t.mappingSetId],
      foreignColumns: [mappingSet.id],
    }),
    // A reviewer's verdict counts once per decision.
    uniqueIndex('irev_one_review_uq')
      .on(t.decisionId, t.actor)
      .where(sql`${t.eventType} = 'reviewed'`),
    index('irev_decision_idx').on(t.decisionId, t.id),
    index('irev_set_idx').on(t.mappingSetId, t.id),
    check('irev_type_ck', sql`${t.eventType} IN (${list(EVENT_TYPES)})`),
    check('irev_role_ck', sql`${t.actorRole} IN ('reviewer', 'approver')`),
    check(
      'irev_verdict_ck',
      sql`(${t.eventType} = 'reviewed') = (${t.verdict} IS NOT NULL) AND (${t.verdict} IS NULL OR ${t.verdict} IN (${list(REVIEW_VERDICTS)}))`,
    ),
    check('irev_subject_ck', sql`num_nonnulls(${t.decisionId}, ${t.mappingSetId}) >= 1`),
    check('irev_actor_ck', sql`btrim(${t.actor}) <> ''`),
    check('irev_evidence_ck', sql`jsonb_typeof(${t.evidence}) = 'object'`),
  ],
);
