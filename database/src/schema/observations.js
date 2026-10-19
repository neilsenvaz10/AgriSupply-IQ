import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  OBSERVATION_MAX_DATE,
  OBSERVATION_MIN_DATE,
  factChecks,
  normalizedNameColumn,
  provenanceColumns,
  qualityColumns,
} from './helpers.js';
import { dataSources, ingestionRuns, sourceFiles } from './provenance.js';
import { commodities, markets, states, varieties } from './registry.js';
import { measurementUnits } from './units.js';

/**
 * Canonical observation (fact) tables.
 *
 * Granularities are DIFFERENT KINDS OF FACT, so each has its own table with its own required
 * keys. Because of that, a record of one granularity cannot be stored as another by accident:
 *
 *   mandi_observations                  market x commodity x variety x grade x DAY   (market_id NOT NULL)
 *   state_observations                  state x commodity x DAY                       (no market column)
 *   national_monthly_prices  India x commodity x MONTH, averages        (no market, no day)
 *   wpi_series + wpi_observations       national wholesale price INDEX x MONTH        (no currency, no unit)
 *
 * Prices carry an explicit currency and unit, arrivals an explicit unit; both reference
 * `measurement_units`. Values are stored as the source reported them; nothing is converted or
 * back-filled. Missing values are NULL, never 0.
 */

const priceNumeric = (name) => numeric(name, { precision: 16, scale: 4 });
const arrivalNumeric = (name) => numeric(name, { precision: 18, scale: 3 });

/** Ingestion linkage shared by every fact table. */
const linkage = () => ({
  sourceId: uuid('source_id')
    .notNull()
    .references(() => dataSources.id),
  sourceFileId: uuid('source_file_id'),
  ingestionRunId: uuid('ingestion_run_id').notNull(),
});

/** Composite foreign keys proving run and file belong to the fact's own source. */
const linkageKeys = (prefix, t) => [
  foreignKey({
    name: `${prefix}_run_fk`,
    columns: [t.ingestionRunId, t.sourceId],
    foreignColumns: [ingestionRuns.id, ingestionRuns.sourceId],
  }),
  foreignKey({
    name: `${prefix}_file_fk`,
    columns: [t.sourceFileId, t.sourceId],
    foreignColumns: [sourceFiles.id, sourceFiles.sourceId],
  }),
  index(`${prefix}_run_idx`).on(t.ingestionRunId),
  index(`${prefix}_file_idx`).on(t.sourceFileId),
  unique(`${prefix}_record_key_uq`).on(t.sourceId, t.sourceRecordKey),
];

/** Price (min/max/modal), currency, price unit and arrival columns for daily facts. */
const dailyMeasureColumns = () => ({
  minPrice: priceNumeric('min_price'),
  maxPrice: priceNumeric('max_price'),
  modalPrice: priceNumeric('modal_price'),
  priceCurrency: char('price_currency', { length: 3 }),
  priceUnit: text('price_unit').references(() => measurementUnits.code),
  sourcePriceUnitLabel: text('source_price_unit_label'),
  /** `source_stated`: the file says the unit. `assumed_from_documentation`: it does not (see source_assumptions). */
  unitBasis: text('unit_basis').notNull().default('source_stated'),
  arrivalQuantity: arrivalNumeric('arrival_quantity'),
  arrivalUnit: text('arrival_unit').references(() => measurementUnits.code),
  sourceArrivalUnitLabel: text('source_arrival_unit_label'),
});

/**
 * Value checks for a fact with min/max/modal prices.
 *
 * @param {string} prefix
 * @param {Record<string, any>} t
 * @param {{ min: any, max: any, modal: any, arrival?: any, arrivalUnit?: any }} c Columns.
 */
const priceChecks = (prefix, t, c) => [
  check(
    `${prefix}_nonneg_ck`,
    sql`(${c.min} IS NULL OR ${c.min} >= 0) AND (${c.max} IS NULL OR ${c.max} >= 0) AND (${c.modal} IS NULL OR ${c.modal} >= 0)`,
  ),
  // Order is enforced only between values that exist; a missing value is never assumed.
  check(
    `${prefix}_order_ck`,
    sql`(${c.min} IS NULL OR ${c.modal} IS NULL OR ${c.min} <= ${c.modal})
      AND (${c.modal} IS NULL OR ${c.max} IS NULL OR ${c.modal} <= ${c.max})
      AND (${c.min} IS NULL OR ${c.max} IS NULL OR ${c.min} <= ${c.max})`,
  ),
  // A zero price is stored only when explicitly flagged for review.
  check(
    `${prefix}_zero_flag_ck`,
    sql`(coalesce(${c.min}, 1) > 0 AND coalesce(${c.max}, 1) > 0 AND coalesce(${c.modal}, 1) > 0) OR ${t.qualityStatus} = 'flagged'`,
  ),
];

/** Currency and unit must accompany any price. */
const priceUnitChecks = (prefix, t, c) => [
  check(
    `${prefix}_price_unit_ck`,
    sql`num_nonnulls(${c.min}, ${c.max}, ${c.modal}) = 0
      OR (${t.priceCurrency} IS NOT NULL AND ${t.priceUnit} IS NOT NULL)`,
  ),
  check(
    `${prefix}_unit_basis_ck`,
    sql`${t.unitBasis} IN ('source_stated', 'assumed_from_documentation')`,
  ),
  // A unit the source states must carry the source's own wording; an assumed one must not claim to.
  check(
    `${prefix}_unit_label_ck`,
    sql`num_nonnulls(${c.min}, ${c.max}, ${c.modal}) = 0
      OR (${t.unitBasis} = 'source_stated' AND ${t.sourcePriceUnitLabel} IS NOT NULL)
      OR (${t.unitBasis} = 'assumed_from_documentation' AND ${t.sourcePriceUnitLabel} IS NULL)`,
  ),
  check(
    `${prefix}_currency_ck`,
    sql`${t.priceCurrency} IS NULL OR ${t.priceCurrency} ~ '^[A-Z]{3}$'`,
  ),
];

/** Arrival quantity: non-negative and always paired with its unit. */
const arrivalChecks = (prefix, t) => [
  check(
    `${prefix}_arrival_ck`,
    sql`(${t.arrivalQuantity} IS NULL) = (${t.arrivalUnit} IS NULL) AND (${t.arrivalQuantity} IS NULL OR ${t.arrivalQuantity} >= 0)`,
  ),
];

const dayCheck = (name, column) =>
  check(
    name,
    sql`${column} BETWEEN DATE '${sql.raw(OBSERVATION_MIN_DATE)}' AND DATE '${sql.raw(OBSERVATION_MAX_DATE)}'`,
  );

const monthCheck = (name, column) =>
  check(
    name,
    sql`${column} BETWEEN DATE '${sql.raw(OBSERVATION_MIN_DATE)}' AND DATE '${sql.raw(OBSERVATION_MAX_DATE)}' AND extract(day FROM ${column}) = 1`,
  );

/**
 * Mandi-level daily observations: one source reports one market x commodity x variety x grade
 * on one day. `variety_id` is NULL when the variety is unknown or unmapped (the original label
 * is kept in `variety_label`); the unique key treats NULL as a value, so an unspecified variety
 * cannot be inserted twice either.
 */
export const mandiObservations = pgTable(
  'mandi_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    commodityId: uuid('commodity_id')
      .notNull()
      .references(() => commodities.id),
    varietyId: uuid('variety_id'),
    /** Variety exactly as the source wrote it (may be "Other", "Local", empty or unmapped). */
    varietyLabel: text('variety_label'),
    /** Grade exactly as the source wrote it (for example FAQ, Non-FAQ, Local). */
    grade: text('grade'),
    observedDate: date('observed_date', { mode: 'string' }).notNull(),
    ...dailyMeasureColumns(),
    // Original labels, preserved for audit and for re-resolution.
    sourceStateLabel: text('source_state_label'),
    sourceDistrictLabel: text('source_district_label'),
    sourceMarketLabel: text('source_market_label'),
    sourceCommodityLabel: text('source_commodity_label'),
    ...linkage(),
    ...provenanceColumns(),
    ...qualityColumns(),
  },
  (t) => [
    ...linkageKeys('mandi_obs', t),
    ...factChecks('mandi_obs', t),
    ...priceChecks('mandi_obs', t, { min: t.minPrice, max: t.maxPrice, modal: t.modalPrice }),
    ...priceUnitChecks('mandi_obs', t, { min: t.minPrice, max: t.maxPrice, modal: t.modalPrice }),
    ...arrivalChecks('mandi_obs', t),
    check(
      'mandi_obs_measure_ck',
      sql`num_nonnulls(${t.minPrice}, ${t.maxPrice}, ${t.modalPrice}, ${t.arrivalQuantity}) >= 1`,
    ),
    dayCheck('mandi_obs_date_ck', t.observedDate),
    // The variety, when present, must belong to this observation's commodity.
    foreignKey({
      name: 'mandi_obs_variety_fk',
      columns: [t.varietyId, t.commodityId],
      foreignColumns: [varieties.id, varieties.commodityId],
    }),
    // One source, one report of this market/commodity/variety/grade on this day.
    unique('mandi_obs_natural_uq')
      .on(t.sourceId, t.marketId, t.commodityId, t.varietyId, t.grade, t.observedDate)
      .nullsNotDistinct(),
    // Price history of one market for one commodity (the main read path).
    index('mandi_obs_history_idx').on(t.marketId, t.commodityId, t.observedDate),
    // Cross-market view of one commodity on a day (mandi comparison).
    index('mandi_obs_commodity_day_idx').on(t.commodityId, t.observedDate, t.marketId),
  ],
);

/**
 * State-level daily observations (for example reports that aggregate a whole state and give
 * arrivals). There is NO market column on purpose: a state figure is never a mandi figure.
 */
export const stateObservations = pgTable(
  'state_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id),
    commodityId: uuid('commodity_id')
      .notNull()
      .references(() => commodities.id),
    observedDate: date('observed_date', { mode: 'string' }).notNull(),
    ...dailyMeasureColumns(),
    sourceStateLabel: text('source_state_label'),
    sourceCommodityLabel: text('source_commodity_label'),
    sourceCommodityGroupLabel: text('source_commodity_group_label'),
    /** Title of the report the row came from (the same day can appear in overlapping reports). */
    sourceReportLabel: text('source_report_label'),
    ...linkage(),
    ...provenanceColumns(),
    ...qualityColumns(),
  },
  (t) => [
    ...linkageKeys('state_obs', t),
    ...factChecks('state_obs', t),
    ...priceChecks('state_obs', t, { min: t.minPrice, max: t.maxPrice, modal: t.modalPrice }),
    ...priceUnitChecks('state_obs', t, { min: t.minPrice, max: t.maxPrice, modal: t.modalPrice }),
    ...arrivalChecks('state_obs', t),
    check(
      'state_obs_measure_ck',
      sql`num_nonnulls(${t.minPrice}, ${t.maxPrice}, ${t.modalPrice}, ${t.arrivalQuantity}) >= 1`,
    ),
    dayCheck('state_obs_date_ck', t.observedDate),
    unique('state_obs_natural_uq').on(t.sourceId, t.stateId, t.commodityId, t.observedDate),
    index('state_obs_history_idx').on(t.stateId, t.commodityId, t.observedDate),
    index('state_obs_commodity_day_idx').on(t.commodityId, t.observedDate),
  ],
);

/**
 * National (India-wide) MONTHLY commodity price averages. No market, no state, no day: the
 * period is a month (first day stored) and the figures are averages, so they cannot be mistaken
 * for a mandi price on a day.
 */
export const nationalMonthlyPrices = pgTable(
  'national_monthly_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 }).notNull().default('IN'),
    commodityId: uuid('commodity_id')
      .notNull()
      .references(() => commodities.id),
    /** First day of the month the averages describe. */
    periodMonth: date('period_month', { mode: 'string' }).notNull(),
    avgMinPrice: priceNumeric('avg_min_price'),
    avgMaxPrice: priceNumeric('avg_max_price'),
    avgModalPrice: priceNumeric('avg_modal_price'),
    priceCurrency: char('price_currency', { length: 3 }),
    priceUnit: text('price_unit').references(() => measurementUnits.code),
    sourcePriceUnitLabel: text('source_price_unit_label'),
    unitBasis: text('unit_basis').notNull().default('source_stated'),
    /** The source's "change" figure exactly as reported. Its definition is unconfirmed. */
    sourceReportedChange: numeric('source_reported_change', { precision: 16, scale: 4 }),
    sourceCalculationType: text('source_calculation_type'),
    sourceCommodityLabel: text('source_commodity_label'),
    ...linkage(),
    ...provenanceColumns(),
    ...qualityColumns(),
  },
  (t) => [
    ...linkageKeys('national_price', t),
    ...factChecks('national_price', t),
    ...priceChecks('national_price', t, {
      min: t.avgMinPrice,
      max: t.avgMaxPrice,
      modal: t.avgModalPrice,
    }),
    ...priceUnitChecks('national_price', t, {
      min: t.avgMinPrice,
      max: t.avgMaxPrice,
      modal: t.avgModalPrice,
    }),
    check('national_price_country_ck', sql`${t.countryCode} = 'IN'`),
    check(
      'national_price_measure_ck',
      sql`num_nonnulls(${t.avgMinPrice}, ${t.avgMaxPrice}, ${t.avgModalPrice}) >= 1`,
    ),
    monthCheck('national_price_month_ck', t.periodMonth),
    unique('national_price_natural_uq').on(t.sourceId, t.commodityId, t.periodMonth),
    index('national_price_series_idx').on(t.commodityId, t.periodMonth),
  ],
);

/**
 * Wholesale Price Index series. An index is dimensionless (a ratio to a base period), so there
 * is deliberately no currency, price unit or quantity anywhere in the WPI tables.
 * `commodity_id` links a series to the commodity registry only when it truly is that
 * commodity (an item such as "Wheat Atta" or "Cotton Oil" stays unlinked).
 */
export const wpiSeries = pgTable(
  'wpi_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => dataSources.id),
    /** Item label exactly as the source wrote it. */
    itemLabel: text('item_label').notNull(),
    normalizedLabel: normalizedNameColumn('normalized_label', 'item_label'),
    commodityId: uuid('commodity_id').references(() => commodities.id),
    /** Base period (for example a base year) when the source states it; NULL when unknown. */
    baseDescription: text('base_description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('wpi_series_source_label_uq').on(t.sourceId, t.normalizedLabel),
    unique('wpi_series_id_source_uq').on(t.id, t.sourceId),
    index('wpi_series_commodity_idx').on(t.commodityId),
    check('wpi_series_label_ck', sql`btrim(${t.itemLabel}) <> ''`),
  ],
);

/** One index value for one series and one month. */
export const wpiObservations = pgTable(
  'wpi_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seriesId: uuid('series_id').notNull(),
    periodMonth: date('period_month', { mode: 'string' }).notNull(),
    indexValue: numeric('index_value', { precision: 12, scale: 4 }).notNull(),
    ...linkage(),
    ...provenanceColumns(),
    ...qualityColumns(),
  },
  (t) => [
    ...linkageKeys('wpi_obs', t),
    ...factChecks('wpi_obs', t),
    // The series must belong to the same source as this observation.
    foreignKey({
      name: 'wpi_obs_series_fk',
      columns: [t.seriesId, t.sourceId],
      foreignColumns: [wpiSeries.id, wpiSeries.sourceId],
    }),
    check('wpi_obs_value_ck', sql`${t.indexValue} > 0`),
    monthCheck('wpi_obs_month_ck', t.periodMonth),
    unique('wpi_obs_natural_uq').on(t.seriesId, t.periodMonth),
    index('wpi_obs_month_idx').on(t.periodMonth),
  ],
);

export const FACT_TYPES = /** @type {const} */ ([
  'mandi_price',
  'state_observation',
  'national_commodity_price',
  'wpi_index',
]);

/**
 * A source record that has the same natural key as an existing observation but DIFFERENT
 * values. It is kept here (with the incoming values and its fingerprint) next to a reference to
 * the existing observation, never silently overwriting it. Exactly one reference column is set,
 * and it must match `fact_type`.
 */
export const observationConflicts = pgTable(
  'observation_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingestionRunId: uuid('ingestion_run_id')
      .notNull()
      .references(() => ingestionRuns.id),
    factType: text('fact_type').notNull(),
    mandiObservationId: uuid('mandi_observation_id'),
    stateObservationId: uuid('state_observation_id'),
    nationalPriceObservationId: uuid('national_price_observation_id'),
    wpiObservationId: uuid('wpi_observation_id'),
    incomingRecord: jsonb('incoming_record').notNull(),
    incomingFingerprint: char('incoming_fingerprint', { length: 64 }).notNull(),
    status: text('status').notNull().default('open'),
    resolutionNote: text('resolution_note'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Short, explicit names: generated names exceed PostgreSQL's 63-character identifier limit.
    foreignKey({
      name: 'obs_conflicts_mandi_fk',
      columns: [t.mandiObservationId],
      foreignColumns: [mandiObservations.id],
    }),
    foreignKey({
      name: 'obs_conflicts_state_fk',
      columns: [t.stateObservationId],
      foreignColumns: [stateObservations.id],
    }),
    foreignKey({
      name: 'obs_conflicts_national_fk',
      columns: [t.nationalPriceObservationId],
      foreignColumns: [nationalMonthlyPrices.id],
    }),
    foreignKey({
      name: 'obs_conflicts_wpi_fk',
      columns: [t.wpiObservationId],
      foreignColumns: [wpiObservations.id],
    }),
    // The same conflicting candidate is recorded once, however often the file is re-imported.
    unique('obs_conflicts_candidate_uq')
      .on(
        t.factType,
        t.mandiObservationId,
        t.stateObservationId,
        t.nationalPriceObservationId,
        t.wpiObservationId,
        t.incomingFingerprint,
      )
      .nullsNotDistinct(),
    index('obs_conflicts_run_idx').on(t.ingestionRunId),
    index('obs_conflicts_open_idx')
      .on(t.status)
      .where(sql`${t.status} = 'open'`),
    check(
      'obs_conflicts_type_ck',
      sql`${t.factType} IN ('mandi_price', 'state_observation', 'national_commodity_price', 'wpi_index')`,
    ),
    check(
      'obs_conflicts_ref_ck',
      sql`num_nonnulls(${t.mandiObservationId}, ${t.stateObservationId}, ${t.nationalPriceObservationId}, ${t.wpiObservationId}) = 1
        AND (CASE ${t.factType}
          WHEN 'mandi_price' THEN ${t.mandiObservationId} IS NOT NULL
          WHEN 'state_observation' THEN ${t.stateObservationId} IS NOT NULL
          WHEN 'national_commodity_price' THEN ${t.nationalPriceObservationId} IS NOT NULL
          WHEN 'wpi_index' THEN ${t.wpiObservationId} IS NOT NULL
          ELSE false END)`,
    ),
    check('obs_conflicts_fingerprint_ck', sql`${t.incomingFingerprint} ~ '^[0-9a-f]{64}$'`),
    check(
      'obs_conflicts_status_ck',
      sql`${t.status} IN ('open', 'kept_existing', 'replaced_existing', 'dismissed')`,
    ),
    check('obs_conflicts_resolved_ck', sql`(${t.status} = 'open') = (${t.resolvedAt} IS NULL)`),
    check('obs_conflicts_record_ck', sql`jsonb_typeof(${t.incomingRecord}) = 'object'`),
  ],
);
