import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { normalizedNameColumn } from './helpers.js';

/**
 * Canonical registries: states/UTs, districts, markets (mandis), commodities, varieties.
 *
 * These tables are EMPTY after migration: no nationwide list is fabricated or hardcoded.
 * Rows are created deliberately from authoritative references or reviewed alias resolution
 * (Milestone 2.2 onwards). Every identity is a UUID; names are never keys on their own.
 * Source-specific spellings and codes live in the alias tables (see aliases.js).
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** States and union territories. */
export const states = pgTable(
  'states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: normalizedNameColumn('normalized_name', 'name'),
    kind: text('kind').notNull(),
    /** Local Government Directory code (or another stable official code) when known. */
    lgdCode: text('lgd_code'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('states_normalized_name_uq').on(t.normalizedName),
    unique('states_lgd_code_uq').on(t.lgdCode),
    check('states_name_ck', sql`btrim(${t.name}) <> ''`),
    check('states_kind_ck', sql`${t.kind} IN ('state', 'union_territory')`),
  ],
);

/** Districts. A district belongs to exactly one state or union territory. */
export const districts = pgTable(
  'districts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id),
    name: text('name').notNull(),
    normalizedName: normalizedNameColumn('normalized_name', 'name'),
    lgdCode: text('lgd_code'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    // The same district name legitimately exists in several states; it is unique within one.
    unique('districts_state_name_uq').on(t.stateId, t.normalizedName),
    // Lets markets prove that their district belongs to their own state.
    unique('districts_id_state_uq').on(t.id, t.stateId),
    unique('districts_lgd_code_uq').on(t.lgdCode),
    check('districts_name_ck', sql`btrim(${t.name}) <> ''`),
  ],
);

/**
 * Agricultural markets (APMC mandis and similar). Coordinates and district are optional because
 * many sources provide neither; nothing is guessed.
 *
 * `disambiguator` lets two genuinely different markets that share a name in the same district
 * coexist (for example "Block A" / "Block B"). `status = 'merged'` plus `merged_into_market_id`
 * records the outcome of a manual duplicate resolution without deleting history.
 */
export const markets = pgTable(
  'markets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id),
    districtId: uuid('district_id'),
    name: text('name').notNull(),
    normalizedName: normalizedNameColumn('normalized_name', 'name'),
    disambiguator: text('disambiguator').notNull().default(''),
    /** Optional official market code. */
    governmentMarketCode: text('government_market_code'),
    /** Free-text classification from the source (for example APMC, e-NAM linked). */
    classification: text('classification'),
    status: text('status').notNull().default('active'),
    mergedIntoMarketId: uuid('merged_into_market_id'),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [
    // A district, when given, must be a district OF THIS market's state.
    foreignKey({
      name: 'markets_district_state_fk',
      columns: [t.districtId, t.stateId],
      foreignColumns: [districts.id, districts.stateId],
    }),
    foreignKey({
      name: 'markets_merged_into_fk',
      columns: [t.mergedIntoMarketId],
      foreignColumns: [t.id],
    }),
    // Same name + same place + same disambiguator = the same market (NULL district counts as equal).
    unique('markets_identity_uq')
      .on(t.stateId, t.districtId, t.normalizedName, t.disambiguator)
      .nullsNotDistinct(),
    unique('markets_government_code_uq').on(t.governmentMarketCode),
    index('markets_state_district_idx').on(t.stateId, t.districtId),
    index('markets_normalized_name_idx').on(t.normalizedName),
    check('markets_name_ck', sql`btrim(${t.name}) <> ''`),
    check('markets_status_ck', sql`${t.status} IN ('active', 'inactive', 'unverified', 'merged')`),
    check(
      'markets_merge_ck',
      sql`(${t.status} = 'merged') = (${t.mergedIntoMarketId} IS NOT NULL) AND ${t.mergedIntoMarketId} IS DISTINCT FROM ${t.id}`,
    ),
    check(
      'markets_coordinates_ck',
      sql`(${t.latitude} IS NULL) = (${t.longitude} IS NULL)
        AND (${t.latitude} IS NULL OR (${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180))`,
    ),
  ],
);

/** Commodities (crops and products). No crop list is built in. */
export const commodities = pgTable(
  'commodities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: normalizedNameColumn('normalized_name', 'name'),
    /** Source classification such as "Vegetables" or "Cereals" when provided. */
    commodityGroup: text('commodity_group'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('commodities_normalized_name_uq').on(t.normalizedName),
    check('commodities_name_ck', sql`btrim(${t.name}) <> ''`),
  ],
);

/**
 * Varieties of a commodity. An observation with no known variety stores NULL (and the original
 * label in `variety_label`); an "unknown" variety row is never invented.
 */
export const varieties = pgTable(
  'varieties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commodityId: uuid('commodity_id')
      .notNull()
      .references(() => commodities.id),
    name: text('name').notNull(),
    normalizedName: normalizedNameColumn('normalized_name', 'name'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('varieties_commodity_name_uq').on(t.commodityId, t.normalizedName),
    // Lets observations prove that their variety belongs to their own commodity.
    unique('varieties_id_commodity_uq').on(t.id, t.commodityId),
    check('varieties_name_ck', sql`btrim(${t.name}) <> ''`),
  ],
);
