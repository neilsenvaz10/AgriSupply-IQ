import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Milestone 8 initial table: a neutral key/value store for system-level facts.
 *
 * It exists so the migration, privilege and persistence machinery can be proven end to end
 * without prematurely designing agricultural tables. It holds NO market data. The commodity,
 * market, observation and provenance tables are designed in Phase 2 together with ingestion.
 */
export const systemMetadata = pgTable('system_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
