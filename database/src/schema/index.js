/**
 * Drizzle schema entry point (read by drizzle-kit and by application code).
 *
 * Add new tables as separate modules and re-export them here, then run
 * `npm run db:generate` to produce a migration. Never edit applied migrations.
 */
export { systemMetadata } from './systemMetadata.js';
