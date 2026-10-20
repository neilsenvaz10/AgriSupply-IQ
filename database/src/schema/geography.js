import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { districts, states } from './registry.js';

/**
 * Geographic reference infrastructure (Phase 2, Milestone 2.4, Stage 3a, migration 0005).
 *
 * Two APPEND-ONLY tables hold what an official source said, exactly as it said it:
 *
 *  - `geo_reference_set`: one row per acquired reference (a file, or a manifest that lists the SHA-256 of
 *    every page it consists of): source URL, authority, access method, retrieval and publication
 *    metadata, licence/terms notes and the SHA-256 fingerprint. Raw files stay outside Git and outside
 *    the database; the fingerprint is how a row is tied to its file.
 *  - `admin_unit_version`: one row per version of an official administrative unit (an LGD state or
 *    district) as listed in one reference set. Several snapshots of the same unit coexist without
 *    collisions because the set is part of the key.
 *
 * Nothing here changes `states`, `districts`, `markets`, the alias tables or any observation. The optional
 * `state_id` / `district_id` links only RECORD which registry row an official unit corresponds to by LGD
 * code; they never alter the registry. No geographic correction is made by this schema.
 *
 * Date semantics (see docs/geography/GEOGRAPHIC_ARCHITECTURE.md):
 *  - `lgd_effective_date` is the date LGD displays. `lgd_effective_is_baseline` marks LGD's 01/01/2005
 *    baseline, which is NOT a legal formation date.
 *  - `legal_effective_date` is the legal date and requires recorded evidence. It can never be copied from
 *    an LGD baseline date (constraint `aun_legal_not_baseline_ck`).
 */

export const REFERENCE_KINDS = /** @type {const} */ ([
  'lgd_snapshot',
  'lgd_modifications',
  'gazette_extract',
  'registry_listing',
  'other',
]);
export const ACCESS_METHODS = /** @type {const} */ ([
  'public_page',
  'manual_download',
  'api',
  'other',
]);
export const ADMIN_UNIT_TYPES = /** @type {const} */ (['state', 'district']);
export const ADMIN_UNIT_STATUSES = /** @type {const} */ (['active', 'inactive']);
/** LGD's default effective date for units that predate its records. Not a legal date. */
export const LGD_BASELINE_DATE = '2005-01-01';

const list = (values) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** One acquired official reference (file or manifest). Append-only. */
export const geoReferenceSet = pgTable(
  'geo_reference_set',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable human-readable identifier, for example `lgd-districts-2026-10-20`. */
    code: text('code').notNull(),
    kind: text('kind').notNull(),
    authority: text('authority').notNull(),
    sourceUrl: text('source_url').notNull(),
    accessMethod: text('access_method').notNull(),
    originalFilename: text('original_filename'),
    format: text('format'),
    /** SHA-256 of the file, or of the manifest listing the SHA-256 of every file in the set. */
    fileSha256: char('file_sha256', { length: 64 }).notNull(),
    fingerprintKind: text('fingerprint_kind').notNull().default('file'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    recordCount: integer('record_count'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    /** The date the source says its data is valid for, when it says so. */
    asOfDate: date('as_of_date'),
    publicationDate: date('publication_date'),
    publicationNote: text('publication_note'),
    licenceNote: text('licence_note'),
    termsNote: text('terms_note'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('grs_code_uq').on(t.code),
    unique('grs_sha256_uq').on(t.fileSha256),
    index('grs_kind_retrieved_idx').on(t.kind, t.retrievedAt),
    check('grs_code_ck', sql`${t.code} ~ '^[a-z0-9][a-z0-9._-]*$'`),
    check('grs_sha256_ck', sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check('grs_kind_ck', sql`${t.kind} IN (${list(REFERENCE_KINDS)})`),
    check('grs_access_ck', sql`${t.accessMethod} IN (${list(ACCESS_METHODS)})`),
    check('grs_fingerprint_ck', sql`${t.fingerprintKind} IN ('file', 'manifest')`),
    check('grs_text_ck', sql`btrim(${t.authority}) <> '' AND btrim(${t.sourceUrl}) <> ''`),
    check(
      'grs_size_ck',
      sql`(${t.sizeBytes} IS NULL OR ${t.sizeBytes} >= 0) AND (${t.recordCount} IS NULL OR ${t.recordCount} >= 0)`,
    ),
  ],
);

/**
 * One version of an official administrative unit, as listed in one reference set. Append-only.
 * `history_seq` is the 1-based position of the row in the source's own version history, because the source
 * can list the same version number more than once (minor versions are not always shown).
 */
export const adminUnitVersion = pgTable(
  'admin_unit_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referenceSetId: uuid('reference_set_id').notNull(),
    unitType: text('unit_type').notNull(),
    lgdCode: integer('lgd_code').notNull(),
    historySeq: integer('history_seq').notNull().default(1),
    /** True for the newest version of the unit inside this reference set. */
    isLatestVersion: boolean('is_latest_version').notNull(),
    version: integer('version'),
    minorVersion: integer('minor_version'),
    nameEn: text('name_en').notNull(),
    nameLocal: text('name_local'),
    /** Official parent: the state code of a district; null for a state. */
    parentLgdCode: integer('parent_lgd_code'),
    /** `state` or `union_territory`; only for states. */
    stateKind: text('state_kind'),
    census2001Code: text('census_2001_code'),
    census2011Code: text('census_2011_code'),
    status: text('status').notNull(),
    lgdEffectiveDate: date('lgd_effective_date'),
    lgdEffectiveIsBaseline: boolean('lgd_effective_is_baseline').notNull().default(false),
    legalEffectiveDate: date('legal_effective_date'),
    legalEffectiveEvidence: text('legal_effective_evidence'),
    /** True only when the effective date is a real, non-baseline date of THIS version. */
    validFromKnown: boolean('valid_from_known').notNull().default(false),
    orderNo: text('order_no'),
    orderDate: date('order_date'),
    gazetteDate: date('gazette_date'),
    governmentOrderRef: text('government_order_ref'),
    /** The page or row the data came from, with its own fingerprint and retrieval time. */
    sourceUrl: text('source_url'),
    sourceSha256: char('source_sha256', { length: 64 }),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }),
    /** SHA-256 of the canonical payload of this row: makes reloading idempotent and detects changed content. */
    contentSha256: char('content_sha256', { length: 64 }).notNull(),
    /** The parsed source fields as read, kept verbatim for traceability. */
    rawRecord: jsonb('raw_record')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Registry row that carries this LGD code today (a record, not a change). */
    stateId: uuid('state_id'),
    districtId: uuid('district_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'aun_reference_set_fk',
      columns: [t.referenceSetId],
      foreignColumns: [geoReferenceSet.id],
    }),
    foreignKey({ name: 'aun_state_fk', columns: [t.stateId], foreignColumns: [states.id] }),
    foreignKey({
      name: 'aun_district_fk',
      columns: [t.districtId],
      foreignColumns: [districts.id],
    }),
    unique('aun_unit_seq_uq').on(t.referenceSetId, t.unitType, t.lgdCode, t.historySeq),
    uniqueIndex('aun_latest_uq')
      .on(t.referenceSetId, t.unitType, t.lgdCode)
      .where(sql`${t.isLatestVersion}`),
    index('aun_code_idx').on(t.unitType, t.lgdCode),
    index('aun_parent_idx').on(t.parentLgdCode),
    index('aun_state_idx').on(t.stateId),
    index('aun_district_idx').on(t.districtId),
    check('aun_type_ck', sql`${t.unitType} IN (${list(ADMIN_UNIT_TYPES)})`),
    check('aun_status_ck', sql`${t.status} IN (${list(ADMIN_UNIT_STATUSES)})`),
    check('aun_code_ck', sql`${t.lgdCode} > 0 AND ${t.historySeq} >= 1`),
    check(
      'aun_version_ck',
      sql`(${t.version} IS NULL OR ${t.version} >= 1) AND (${t.minorVersion} IS NULL OR ${t.minorVersion} >= 0)`,
    ),
    check('aun_name_ck', sql`btrim(${t.nameEn}) <> ''`),
    // A district has a parent state code; a state does not. Links match the unit type.
    check(
      'aun_parent_ck',
      sql`(${t.unitType} = 'district' AND ${t.parentLgdCode} IS NOT NULL AND ${t.stateKind} IS NULL AND ${t.stateId} IS NULL)
        OR (${t.unitType} = 'state' AND ${t.parentLgdCode} IS NULL AND ${t.districtId} IS NULL)`,
    ),
    check(
      'aun_state_kind_ck',
      sql`${t.stateKind} IS NULL OR ${t.stateKind} IN ('state', 'union_territory')`,
    ),
    check(
      'aun_hash_ck',
      sql`${t.contentSha256} ~ '^[0-9a-f]{64}$' AND (${t.sourceSha256} IS NULL OR ${t.sourceSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    // LGD's baseline date is flagged explicitly and is never treated as a legal date.
    check(
      'aun_baseline_ck',
      sql`NOT ${t.lgdEffectiveIsBaseline} OR ${t.lgdEffectiveDate} = DATE '2005-01-01'`,
    ),
    check(
      'aun_legal_evidence_ck',
      sql`${t.legalEffectiveDate} IS NULL OR (${t.legalEffectiveEvidence} IS NOT NULL AND btrim(${t.legalEffectiveEvidence}) <> '')`,
    ),
    check(
      'aun_legal_not_baseline_ck',
      sql`NOT (${t.lgdEffectiveIsBaseline} AND ${t.legalEffectiveDate} IS NOT NULL AND ${t.legalEffectiveDate} = ${t.lgdEffectiveDate})`,
    ),
    check(
      'aun_valid_from_ck',
      sql`NOT ${t.validFromKnown} OR (${t.lgdEffectiveDate} IS NOT NULL AND NOT ${t.lgdEffectiveIsBaseline})`,
    ),
    check('aun_order_ck', sql`${t.orderNo} IS NULL OR btrim(${t.orderNo}) <> ''`),
  ],
);
