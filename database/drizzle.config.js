import { defineConfig } from 'drizzle-kit';
import { loadDatabaseEnvFile } from './src/config.js';

loadDatabaseEnvFile();

/**
 * drizzle-kit configuration. Migrations are generated into ./migrations (committed) and applied
 * by `npm run db:migrate` (src/migrate.js), which connects as the schema-owning migrator role.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.js',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? '' },
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  strict: true,
  verbose: true,
});
