import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Source registry and ingestion tracking (Phase 2, Milestone 2.1).
 *
 *   data_sources  ->  source_files  ->  ingestion_runs  ->  facts / rejections / conflicts
 *
 * Nothing here stores credentials. `endpoint_reference` is checked so it cannot embed a key,
 * token or `user:password@` and there is deliberately no free-form settings column.
 */

/** A provider of observations: a historical file family or a government/commercial API. */
export const dataSources = pgTable(
  'data_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable machine identifier, for example `agmarknet_market_prices_historical`. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    sourceType: text('source_type').notNull(),
    publisher: text('publisher'),
    description: text('description'),
    /** Public endpoint or portal URL, never including credentials. */
    endpointReference: text('endpoint_reference'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('data_sources_code_uq').on(t.code),
    check('data_sources_code_ck', sql`${t.code} ~ '^[a-z0-9][a-z0-9_.-]*$'`),
    check('data_sources_name_ck', sql`btrim(${t.name}) <> ''`),
    check(
      'data_sources_type_ck',
      sql`${t.sourceType} IN ('historical_file', 'government_api', 'commercial_api', 'manual_entry', 'other')`,
    ),
    check(
      'data_sources_no_credentials_ck',
      sql`${t.endpointReference} IS NULL OR (
        ${t.endpointReference} !~* '(api[_-]?key|apikey|token|secret|password|passwd|auth)=' AND
        ${t.endpointReference} !~ '://[^/@]*:[^/@]*@'
      )`,
    ),
  ],
);

/**
 * One physical input (a file, or a stored API response snapshot), identified by its SHA-256.
 * Registering the same bytes twice for a source is impossible, which is how a re-import of an
 * unchanged file is recognised.
 */
export const sourceFiles = pgTable(
  'source_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => dataSources.id),
    /** File name only. Never a local path (paths leak user names and machine layout). */
    fileName: text('file_name').notNull(),
    fileSha256: char('file_sha256', { length: 64 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** Dataset version or release label, when the provider states one. */
    datasetVersion: text('dataset_version'),
    reportedPeriodStart: date('reported_period_start', { mode: 'string' }),
    reportedPeriodEnd: date('reported_period_end', { mode: 'string' }),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('source_files_source_sha_uq').on(t.sourceId, t.fileSha256),
    // Lets child tables prove a file belongs to the same source as the run that used it.
    unique('source_files_id_source_uq').on(t.id, t.sourceId),
    check('source_files_sha_ck', sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check('source_files_name_ck', sql`btrim(${t.fileName}) <> '' AND ${t.fileName} !~ '[\\\\/]'`),
    check('source_files_size_ck', sql`${t.sizeBytes} IS NULL OR ${t.sizeBytes} >= 0`),
    check(
      'source_files_period_ck',
      sql`${t.reportedPeriodStart} IS NULL OR ${t.reportedPeriodEnd} IS NULL OR ${t.reportedPeriodEnd} >= ${t.reportedPeriodStart}`,
    ),
  ],
);

/**
 * Assumptions a source's data depends on that the source itself does not state (for example a
 * price unit that is only documented elsewhere). Facts built on an assumption carry
 * `unit_basis = 'assumed_from_documentation'`; this table says what was assumed and why.
 */
export const sourceAssumptions = pgTable(
  'source_assumptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => dataSources.id),
    assumptionCode: text('assumption_code').notNull(),
    statement: text('statement').notNull(),
    /** Where the assumption comes from (a document and section), so it can be re-checked. */
    evidenceReference: text('evidence_reference').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('source_assumptions_code_uq').on(t.sourceId, t.assumptionCode),
    check('source_assumptions_code_ck', sql`${t.assumptionCode} ~ '^[a-z][a-z0-9_]*$'`),
    check(
      'source_assumptions_text_ck',
      sql`btrim(${t.statement}) <> '' AND btrim(${t.evidenceReference}) <> ''`,
    ),
  ],
);

export const INGESTION_RUN_STATUSES = /** @type {const} */ ([
  'running',
  'succeeded',
  'succeeded_with_rejections',
  'failed',
  'cancelled',
]);

/**
 * One execution of an importer. Counters make a run auditable: every row read ends in exactly
 * one of loaded, exact duplicate, conflicting or rejected (loaded + duplicate + conflicting +
 * rejected may be less than read only while the run is still in progress).
 */
export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => dataSources.id),
    sourceFileId: uuid('source_file_id'),
    status: text('status').notNull().default('running'),
    importerName: text('importer_name').notNull(),
    importerVersion: text('importer_version').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    rowsRead: bigint('rows_read', { mode: 'number' }).notNull().default(0),
    rowsLoaded: bigint('rows_loaded', { mode: 'number' }).notNull().default(0),
    rowsExactDuplicate: bigint('rows_exact_duplicate', { mode: 'number' }).notNull().default(0),
    rowsConflicting: bigint('rows_conflicting', { mode: 'number' }).notNull().default(0),
    rowsRejected: bigint('rows_rejected', { mode: 'number' }).notNull().default(0),
    /** Short, non-sensitive failure description. Never a connection string or a raw record. */
    errorSummary: text('error_summary'),
    /** The interrupted run this one continues (same source). NULL for a first attempt. */
    resumedFromRunId: uuid('resumed_from_run_id'),
    /**
     * Last source record number whose batch is fully committed. Written in the same transaction
     * as the batch, so a resumed run can safely continue after it.
     */
    lastCommittedRow: bigint('last_committed_row', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: 'ingestion_runs_resumed_fk',
      columns: [t.resumedFromRunId, t.sourceId],
      foreignColumns: [t.id, t.sourceId],
    }),
    check('ingestion_runs_checkpoint_ck', sql`${t.lastCommittedRow} >= 0`),
    foreignKey({
      name: 'ingestion_runs_file_source_fk',
      columns: [t.sourceFileId, t.sourceId],
      foreignColumns: [sourceFiles.id, sourceFiles.sourceId],
    }),
    unique('ingestion_runs_id_source_uq').on(t.id, t.sourceId),
    index('ingestion_runs_source_started_idx').on(t.sourceId, t.startedAt),
    index('ingestion_runs_file_idx').on(t.sourceFileId),
    check(
      'ingestion_runs_status_ck',
      sql`${t.status} IN ('running', 'succeeded', 'succeeded_with_rejections', 'failed', 'cancelled')`,
    ),
    check('ingestion_runs_finished_ck', sql`(${t.status} = 'running') = (${t.finishedAt} IS NULL)`),
    check(
      'ingestion_runs_time_ck',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check(
      'ingestion_runs_counts_ck',
      sql`${t.rowsRead} >= 0 AND ${t.rowsLoaded} >= 0 AND ${t.rowsExactDuplicate} >= 0
        AND ${t.rowsConflicting} >= 0 AND ${t.rowsRejected} >= 0
        AND ${t.rowsLoaded} + ${t.rowsExactDuplicate} + ${t.rowsConflicting} + ${t.rowsRejected} <= ${t.rowsRead}`,
    ),
    check(
      'ingestion_runs_error_ck',
      sql`${t.errorSummary} IS NULL OR (length(${t.errorSummary}) <= 2000 AND ${t.errorSummary} !~ '://[^/@\\s]*:[^/@\\s]*@')`,
    ),
  ],
);

export const REJECTION_REASONS = /** @type {const} */ ([
  'structural_error',
  'missing_required_value',
  'invalid_value',
  'invalid_date',
  'negative_value',
  'price_ordering_violation',
  'unmapped_entity',
  'ambiguous_entity',
  'unsupported_unit',
  'other',
]);

/**
 * Quarantine: records that could not be loaded, with their original values preserved so a fix
 * to the importer or the registry can re-process them. A rejection is never a silent drop.
 */
export const ingestionRejections = pgTable(
  'ingestion_rejections',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ingestionRunId: uuid('ingestion_run_id')
      .notNull()
      .references(() => ingestionRuns.id),
    sourceRowNumber: bigint('source_row_number', { mode: 'number' }),
    reasonCode: text('reason_code').notNull(),
    reasonDetail: text('reason_detail'),
    /** The record exactly as read (column name to original text value). */
    rawRecord: jsonb('raw_record').notNull(),
    rawRecordSha256: char('raw_record_sha256', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ingestion_rejections_run_row_uq').on(t.ingestionRunId, t.sourceRowNumber),
    index('ingestion_rejections_run_reason_idx').on(t.ingestionRunId, t.reasonCode),
    check(
      'ingestion_rejections_reason_ck',
      sql`${t.reasonCode} IN ('structural_error', 'missing_required_value', 'invalid_value', 'invalid_date', 'negative_value', 'price_ordering_violation', 'unmapped_entity', 'ambiguous_entity', 'unsupported_unit', 'other')`,
    ),
    check('ingestion_rejections_sha_ck', sql`${t.rawRecordSha256} ~ '^[0-9a-f]{64}$'`),
    check('ingestion_rejections_raw_ck', sql`jsonb_typeof(${t.rawRecord}) = 'object'`),
  ],
);
