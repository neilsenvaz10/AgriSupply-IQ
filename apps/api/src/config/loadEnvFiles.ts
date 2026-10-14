import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads `.env` files if present, WITHOUT overriding variables that are already set in the
 * process environment (real environment always wins).
 *
 * Search order (first file to define a variable wins):
 *   1. apps/api/.env       (service-local overrides)
 *   2. <repo root>/.env    (shared monorepo file; see root .env.example)
 *
 * Uses Node's built-in `process.loadEnvFile`, so no dotenv dependency is needed.
 * Returns the files that were loaded (for logging file names only, never contents).
 */
export function loadEnvFiles(): string[] {
  const candidates = [
    fileURLToPath(new URL('../../.env', import.meta.url)),
    fileURLToPath(new URL('../../../../.env', import.meta.url)),
  ];
  const loaded: string[] = [];
  for (const file of candidates) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      loaded.push(file);
    }
  }
  return loaded;
}
