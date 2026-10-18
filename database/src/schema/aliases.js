import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { normalizedNameColumn } from './helpers.js';
import { dataSources } from './provenance.js';
import { commodities, districts, markets, states, varieties } from './registry.js';

/**
 * Source alias tables: how a source's own labels and codes map onto canonical entities.
 *
 * Strategy (documented in database/docs/CANONICAL_SCHEMA.md):
 *  1. A source label is recorded as an alias row scoped to ONE source, keyed by `source_key`
 *     (the label plus its parent context, for example "maharashtra|nashik|lasalgaon(niphad)").
 *  2. `resolution_status` says what is known: `resolved` (maps to an entity), `ambiguous`
 *     (several candidates, needs a person), `unresolved` (not yet looked at) or `rejected`
 *     (deliberately not mapped).
 *  3. An alias is NEVER resolved by fuzzy matching and an unresolved alias never creates a
 *     registry entity. Records whose alias is not `resolved` go to quarantine.
 *  4. The original spelling is kept in `source_label`, so "Chattisgarh" stays visible even
 *     after it resolves to the canonical state.
 */

export const ALIAS_RESOLUTION_STATUSES = /** @type {const} */ ([
  'resolved',
  'ambiguous',
  'unresolved',
  'rejected',
]);

/**
 * @param {string} tableName
 * @param {string} entityColumn Name of the column that points at the canonical entity.
 * @param {{ id: any }} entityTable
 * @param {string} prefix Short prefix for constraint and index names.
 */
function aliasTable(tableName, entityColumn, entityTable, prefix) {
  return pgTable(
    tableName,
    {
      id: uuid('id').primaryKey().defaultRandom(),
      sourceId: uuid('source_id')
        .notNull()
        .references(() => dataSources.id),
      /** Identity of the label inside its source: label plus parent context, normalised. */
      sourceKey: text('source_key').notNull(),
      /** The label exactly as the source wrote it. */
      sourceLabel: text('source_label').notNull(),
      /** Parent labels as written by the source (for example the state of a district). */
      sourceContext: text('source_context'),
      /** The source's own identifier or code for this entity, when it has one. */
      sourceCode: text('source_code'),
      normalizedLabel: normalizedNameColumn('normalized_label', 'source_label'),
      entityId: uuid(entityColumn).references(() => entityTable.id),
      resolutionStatus: text('resolution_status').notNull().default('unresolved'),
      resolutionNote: text('resolution_note'),
      resolvedAt: timestamp('resolved_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique(`${prefix}_source_key_uq`).on(t.sourceId, t.sourceKey),
      unique(`${prefix}_source_code_uq`).on(t.sourceId, t.sourceCode),
      index(`${prefix}_entity_idx`).on(t.entityId),
      index(`${prefix}_label_idx`).on(t.normalizedLabel),
      check(`${prefix}_key_ck`, sql`btrim(${t.sourceKey}) <> '' AND btrim(${t.sourceLabel}) <> ''`),
      check(
        `${prefix}_status_ck`,
        sql`${t.resolutionStatus} IN ('resolved', 'ambiguous', 'unresolved', 'rejected')`,
      ),
      // Resolved means exactly: it points at an entity and records when.
      check(
        `${prefix}_resolved_ck`,
        sql`(${t.resolutionStatus} = 'resolved') = (${t.entityId} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL)`,
      ),
    ],
  );
}

export const stateAliases = aliasTable('state_aliases', 'state_id', states, 'state_alias');
export const districtAliases = aliasTable(
  'district_aliases',
  'district_id',
  districts,
  'district_alias',
);
export const marketAliases = aliasTable('market_aliases', 'market_id', markets, 'market_alias');
export const commodityAliases = aliasTable(
  'commodity_aliases',
  'commodity_id',
  commodities,
  'commodity_alias',
);
export const varietyAliases = aliasTable(
  'variety_aliases',
  'variety_id',
  varieties,
  'variety_alias',
);
