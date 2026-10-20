/**
 * Drizzle schema entry point (read by drizzle-kit and by application code).
 *
 * Add new tables as separate modules and re-export them here, then run
 * `npm run db:generate` to produce a migration. Never edit applied migrations.
 *
 * Phase 2, Milestone 2.1 added the canonical agricultural schema. It is described in
 * database/docs/CANONICAL_SCHEMA.md. No agricultural DATA is created by any migration.
 */
export { systemMetadata } from './systemMetadata.js';
export { measurementUnits } from './units.js';
export { states, districts, markets, commodities, varieties } from './registry.js';
export {
  dataSources,
  sourceFiles,
  sourceAssumptions,
  ingestionRuns,
  ingestionRejections,
} from './provenance.js';
export {
  stateAliases,
  districtAliases,
  marketAliases,
  commodityAliases,
  varietyAliases,
} from './aliases.js';
export {
  mandiObservations,
  stateObservations,
  nationalMonthlyPrices,
  wpiSeries,
  wpiObservations,
  observationConflicts,
} from './observations.js';
export { geoReferenceSet, adminUnitVersion } from './geography.js';
export { mappingSet, identityDecision, identityReviewEvent } from './identity.js';
