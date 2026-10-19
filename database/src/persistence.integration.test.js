import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { systemMetadata } from './schema/index.js';
import { databaseAvailable } from './test/db.js';
import { assertDisposable } from './test/disposable.js';

/**
 * Persistence across container restarts and re-creation.
 *
 * DISRUPTIVE: restarts and recreates the FASALYTICS database container, so it only runs when
 * explicitly requested:   DB_TEST_RESTART=1 npm test
 * It never uses `down -v`, so the data volume is preserved by design.
 */

const enabled = process.env.DB_TEST_RESTART === '1' && databaseAvailable;
const appUrl = process.env.DATABASE_URL ?? '';
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? '';

/** @param {string[]} args */
function compose(args) {
  execFileSync('docker', ['compose', '--env-file', '.env', '-f', '../compose.yaml', ...args], {
    stdio: 'pipe',
    timeout: 120_000,
  });
}

/** Waits until a query succeeds again. */
async function waitUntilQueryable(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { db, close } = createDb(url, { max: 1 });
    try {
      await db.select().from(systemMetadata).limit(1);
      await close();
      return;
    } catch (error) {
      await close().catch(() => undefined);
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

describe.runIf(enabled)('persistence (disruptive; DB_TEST_RESTART=1)', () => {
  const key = `test:persist:${Date.now()}`;

  afterAll(async () => {
    const { db, close } = createDb(migrationUrl, { max: 1 });
    await db.delete(systemMetadata).where(eq(systemMetadata.key, key));
    await close();
  });

  it('keeps data across a container restart', async () => {
    await assertDisposable();
    await runMigrations(migrationUrl);
    const first = createDb(appUrl, { max: 1 });
    await first.db.insert(systemMetadata).values({ key, value: 'before-restart' });
    await first.close();

    compose(['restart', 'db']);
    await waitUntilQueryable(appUrl);

    const second = createDb(appUrl, { max: 1 });
    const rows = await second.db.select().from(systemMetadata).where(eq(systemMetadata.key, key));
    await second.close();
    expect(rows.map((r) => r.value)).toEqual(['before-restart']);
  });

  it('keeps data after the container is removed and created again (named volume)', async () => {
    compose(['rm', '--stop', '--force', 'db']); // removes only the db container, NOT the volume
    compose(['up', '-d', '--wait', 'db']);
    await waitUntilQueryable(appUrl);

    const { db, close } = createDb(appUrl, { max: 1 });
    const rows = await db.select().from(systemMetadata).where(eq(systemMetadata.key, key));
    await close();
    expect(rows.map((r) => r.value)).toEqual(['before-restart']);
  });

  it('is repeatable after recreation: migrations still report nothing to apply', async () => {
    const result = await runMigrations(migrationUrl);
    expect(result.applied).toBe(0);
  });
});
