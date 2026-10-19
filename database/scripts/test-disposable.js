/**
 * Runs the complete database verification against a THROWAWAY PostgreSQL container.
 *
 *   npm run test:disposable
 *
 * It never touches the development database or its volume:
 *   - starts `postgres:17-alpine` under a unique name (`fasalytics-test-<random>`) on a random
 *     free loopback port, with random credentials that exist only in this process;
 *   - initialises the least-privilege roles with the repository's own init script;
 *   - applies ONLY the Phase 1 baseline migration, stores a marker row, then upgrades to the
 *     current schema (proving fresh migration, preservation and repeatability);
 *   - runs `db:check`, the migration runner again, `db:verify` and the whole test suite with
 *     REQUIRE_DB=1 (a missing database fails; nothing is silently skipped);
 *   - removes the container and its anonymous volume, even on failure.
 * The container is the only thing deleted, and only by its own unique name.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrate.js';

const DATABASE_DIR = fileURLToPath(new URL('..', import.meta.url));
const INIT_DIR = join(DATABASE_DIR, 'init');
const IMAGE = 'postgres:17-alpine';
const name = `fasalytics-test-${randomBytes(4).toString('hex')}`;
const secret = () => randomBytes(24).toString('hex');
const [adminPw, migratorPw, appPw, ingestPw] = [secret(), secret(), secret(), secret()];
// The disposable identity: stored IN this database (ALTER DATABASE ... SET) and in the test environment.
// The integration tests refuse to write unless both match (src/test/disposable.js).
const disposableToken = secret();

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });
}

const docker = (args, options = {}) => spawnSync('docker', args, { encoding: 'utf8', ...options });

/** Removes ONLY the container this script created (never a compose project or a named volume). */
function cleanup() {
  if (!name.startsWith('fasalytics-test-')) return;
  docker(['rm', '-f', '-v', name]);
}

/**
 * @param {string} label
 * @param {string[]} command
 * @param {Record<string, string>} env
 */
function step(label, command, env) {
  console.log(`\n=== ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: DATABASE_DIR,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) =>
      code === 0 ? resolve(undefined) : reject(new Error(`${label} failed (exit ${code})`)),
    );
    child.on('error', reject);
  });
}

async function main() {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
    throw new Error('Docker is not available. Start Docker Desktop and try again.');
  }
  const port = await freePort();
  if (port === 5433 || port === 5432)
    throw new Error('refusing to use a development database port');

  console.log(`Starting disposable PostgreSQL "${name}" on 127.0.0.1:${port} ...`);
  const run = docker([
    'run',
    '-d',
    '--name',
    name,
    '-e',
    'POSTGRES_USER=fasalytics_admin',
    '-e',
    `POSTGRES_PASSWORD=${adminPw}`,
    '-e',
    'POSTGRES_DB=fasalytics',
    '-e',
    'DB_MIGRATOR_USER=fasalytics_migrator',
    '-e',
    `DB_MIGRATOR_PASSWORD=${migratorPw}`,
    '-e',
    'DB_APP_USER=fasalytics_app',
    '-e',
    `DB_APP_PASSWORD=${appPw}`,
    '-e',
    'DB_INGEST_USER=fasalytics_ingest',
    '-e',
    `DB_INGEST_PASSWORD=${ingestPw}`,
    '-v',
    `${INIT_DIR}:/docker-entrypoint-initdb.d:ro`,
    '-p',
    `127.0.0.1:${port}:5432`,
    IMAGE,
  ]);
  if (run.status !== 0) throw new Error(`could not start the container: ${run.stderr.trim()}`);

  // TCP readiness: the temporary server used during first-time initialisation has no TCP socket.
  let ready = false;
  for (let i = 0; i < 90 && !ready; i += 1) {
    ready =
      docker([
        'exec',
        name,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'fasalytics_admin',
        '-d',
        'fasalytics',
      ]).status === 0;
    if (!ready) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error('the disposable database did not become ready');
  const identity = docker([
    'exec',
    name,
    'psql',
    '-U',
    'fasalytics_admin',
    '-d',
    'fasalytics',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `ALTER DATABASE fasalytics SET fasalytics.disposable_token = '${disposableToken}'`,
  ]);
  if (identity.status !== 0)
    throw new Error('could not stamp the disposable identity on the database');

  const migrationUrl = `postgresql://fasalytics_migrator:${migratorPw}@127.0.0.1:${port}/fasalytics`;
  const appUrl = `postgresql://fasalytics_app:${appPw}@127.0.0.1:${port}/fasalytics`;
  const ingestUrl = `postgresql://fasalytics_ingest:${ingestPw}@127.0.0.1:${port}/fasalytics`;
  const env = {
    ...process.env,
    DATABASE_URL: appUrl,
    DATABASE_MIGRATION_URL: migrationUrl,
    DATABASE_INGEST_URL: ingestUrl,
    DB_INGEST_USER: 'fasalytics_ingest',
    FASALYTICS_DISPOSABLE_DB: '1',
    FASALYTICS_DISPOSABLE_TOKEN: disposableToken,
    REQUIRE_DB: '1',
    FRESH_DB_BASELINE: '',
  };

  // Phase 1 baseline only: copy migration 0000 and a one-entry journal into a temp folder.
  const baselineDir = mkdtempSync(join(tmpdir(), 'fasalytics-baseline-'));
  try {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    );
    const first = journal.entries[0];
    mkdirSync(join(baselineDir, 'meta'));
    cpSync(join(MIGRATIONS_FOLDER, `${first.tag}.sql`), join(baselineDir, `${first.tag}.sql`));
    writeFileSync(
      join(baselineDir, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: [first] }),
    );
    console.log(`\n=== Phase 1 baseline: applying only ${first.tag}`);
    const baseline = await runMigrations(migrationUrl, { migrationsFolder: baselineDir });
    console.log(`baseline applied: ${baseline.applied} migration(s)`);
    const client = new pg.Client({ connectionString: migrationUrl });
    await client.connect();
    await client.query(
      "INSERT INTO system_metadata (key, value) VALUES ('phase1-baseline-marker', 'kept')",
    );
    await client.end();
  } finally {
    rmSync(baselineDir, { recursive: true, force: true });
  }

  const npx = ['npx', '--no-install'];
  await step(
    'fresh upgrade from the Phase 1 baseline',
    [...npx, 'vitest', 'run', 'src/migrations.fresh.integration.test.js'],
    { ...env, FRESH_DB_BASELINE: '1' },
  );
  await step(
    'grant the ingestion role its narrow privileges (as the migrator)',
    ['node', 'scripts/grant-ingest-privileges.js'],
    env,
  );
  await step(
    'drizzle-kit check (migration history consistent)',
    [...npx, 'drizzle-kit', 'check'],
    env,
  );
  await step('migration runner (must report up to date)', ['node', 'src/migrate.js'], env);
  await step('privilege and data-access verification', ['node', 'src/verify.js'], env);
  // Optional: FASALYTICS_TEST_JSON=<file> also writes a machine-readable result (used to audit skips).
  const jsonOut = process.env.FASALYTICS_TEST_JSON;
  await step(
    'full database test suite (REQUIRE_DB=1)',
    [
      ...npx,
      'vitest',
      'run',
      ...(jsonOut ? ['--reporter=default', '--reporter=json', `--outputFile.json=${jsonOut}`] : []),
    ],
    env,
  );
  console.log('\nDisposable verification PASSED.');
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

try {
  await main();
} catch (error) {
  console.error(
    `\nDisposable verification FAILED: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
} finally {
  cleanup();
  console.log(`Removed disposable container ${name}.`);
}
