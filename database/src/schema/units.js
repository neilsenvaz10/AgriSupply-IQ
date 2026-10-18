import { sql } from 'drizzle-orm';
import { check, numeric, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Measurement units and their documented conversions.
 *
 * Observations always store the value in the unit the source used (`price_unit`, `arrival_unit`
 * reference this table); nothing is converted on write. A normalised value is derived only
 * through `kg_per_unit`, and only between MASS units. Count units (bundle, piece) have no mass
 * conversion, so a price per bundle can never be silently treated as a price per quintal.
 *
 * Seed rows are physical constants (see migration 0002), not agricultural data.
 */
export const measurementUnits = pgTable(
  'measurement_units',
  {
    code: text('code').primaryKey(),
    label: text('label').notNull(),
    dimension: text('dimension').notNull(),
    /** Kilograms in one unit; set for mass units only. */
    kgPerUnit: numeric('kg_per_unit', { precision: 14, scale: 6 }),
  },
  (t) => [
    check('measurement_units_code_ck', sql`${t.code} ~ '^[a-z][a-z0-9_]*$'`),
    check('measurement_units_dimension_ck', sql`${t.dimension} IN ('mass', 'count')`),
    // Mass units need a positive conversion; count units must not have one.
    check(
      'measurement_units_conversion_ck',
      sql`(${t.dimension} = 'mass' AND ${t.kgPerUnit} > 0) OR (${t.dimension} = 'count' AND ${t.kgPerUnit} IS NULL)`,
    ),
  ],
);
