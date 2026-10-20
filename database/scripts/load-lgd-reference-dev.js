/**
 * Controlled development load of the OFFICIAL LGD reference (Milestone 2.4).
 *
 * This is a separate command from scripts/load-lgd-reference.js, which stays disposable-only. It reads NO .env
 * file: the only connection it uses is DATABASE_REF_LOADER_URL, the dedicated least-privilege loader login
 * (see scripts/ref-loader-role.js). There is no switch that skips a check. The procedure and the checks are in
 * docs/geography/LGD_REFERENCE_LOAD_REHEARSAL.md and src/reference/devLoad/controlled.js.
 *
 *   fingerprint       --out <file>                                    read-only table fingerprint of the target
 *   restore-evidence  --backup <file> --fingerprint <file> --out <file>
 *                                                                     fingerprint of a backup restored to a
 *                                                                     verified DISPOSABLE database (uses the
 *                                                                     disposable environment, not the loader URL)
 *   authorize         --out-dir <dir> --backup <file> --evidence <file> --fingerprint <file>
 *                     --reference-dir <dir> --approved-by <name> [--valid-hours <1-24>]
 *   verify            --authorization <file> --reference-dir <dir>    every check, no write
 *   execute           --authorization <file> --reference-dir <dir>    every check, typed confirmation, one load
 *
 * Authorization files, evidence and fingerprints are written outside the Git working tree (refused otherwise).
 */
import { createInterface } from 'node:readline/promises';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { buildAuthorization } from '../src/reference/devLoad/authorization.js';
import {
  RESTORE_EVIDENCE_FORMAT,
  LoadRefusedError,
  describeUrl,
  readLiveIdentity,
  runControlledLoad,
  sha256File,
} from '../src/reference/devLoad/controlled.js';
import {
  fingerprintDigest,
  fingerprintDifferences,
  tableFingerprint,
} from '../src/reference/devLoad/fingerprint.js';
import {
  DEFAULT_LOADER_ROLE,
  loaderPrivilegeProblems,
} from '../src/reference/devLoad/loaderRole.js';
import { restrictToOwner } from '../src/reference/devLoad/secureFile.js';
import { buildLgdPlan } from '../src/reference/lgdPlan.js';
import { checkDisposable } from '../src/test/disposable.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} path */
function assertOutsideRepository(path) {
  const rel = relative(REPO_ROOT, resolve(path));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    throw new LoadRefusedError(
      'inside-repository',
      `${path} is inside the Git working tree: authorization material must stay outside it`,
    );
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    out: { type: 'string' },
    'out-dir': { type: 'string' },
    backup: { type: 'string' },
    evidence: { type: 'string' },
    fingerprint: { type: 'string' },
    'reference-dir': { type: 'string' },
    'approved-by': { type: 'string' },
    'valid-hours': { type: 'string', default: '12' },
    authorization: { type: 'string' },
  },
});

/** @param {string} name */
const need = (name) => {
  const value = /** @type {string | undefined} */ (values[name]);
  if (!value) throw new Error(`--${name} is required`);
  return value;
};

/** @param {string} path @param {unknown} value */
function writeOutside(path, value) {
  assertOutsideRepository(path);
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  restrictToOwner(path);
}

async function connectLoader() {
  const url = process.env.DATABASE_REF_LOADER_URL;
  if (!url) throw new Error('DATABASE_REF_LOADER_URL is not set (the dedicated loader login)');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  return { client, url };
}

try {
  if (command === 'fingerprint') {
    const { client, url } = await connectLoader();
    try {
      const target = describeUrl(url);
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.host))
        throw new LoadRefusedError(
          'production-target',
          'only local targets are fingerprinted by this command',
        );
      await client.query('BEGIN READ ONLY');
      const fingerprint = await tableFingerprint(client);
      await client.query('ROLLBACK');
      writeOutside(need('out'), fingerprint);
      console.log(
        `fingerprint of ${Object.keys(fingerprint).length} tables written; digest ${fingerprintDigest(fingerprint).slice(0, 16)}…`,
      );
    } finally {
      await client.end();
    }
  } else if (command === 'restore-evidence') {
    const verdict = await checkDisposable();
    if (!verdict.ok)
      throw new LoadRefusedError(
        'not-disposable',
        `the restored copy must be in a verified disposable database: ${verdict.reason}`,
      );
    const url = process.env.DATABASE_MIGRATION_URL;
    if (!url) throw new Error('DATABASE_MIGRATION_URL (the restored disposable copy) is not set');
    const client = new pg.Client({ connectionString: url });
    client.on('error', () => undefined);
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const restored = await tableFingerprint(client);
      await client.query('ROLLBACK');
      const source = JSON.parse(readFileSync(need('fingerprint'), 'utf8'));
      const differences = fingerprintDifferences(source, restored);
      const evidence = {
        format: RESTORE_EVIDENCE_FORMAT,
        backupSha256: await sha256File(need('backup')),
        fingerprintDigest: fingerprintDigest(source),
        fingerprintMatchedSource: differences.length === 0,
        restoreTargetWasDisposable: true,
        tablesCompared: Object.keys(restored).length,
        differingTables: differences,
        restoredAt: new Date().toISOString(),
      };
      writeOutside(need('out'), evidence);
      console.log(
        evidence.fingerprintMatchedSource
          ? 'restore evidence written: the restored copy matches the fingerprint'
          : `restore evidence written, but ${differences.length} tables DIFFER`,
      );
      if (!evidence.fingerprintMatchedSource) process.exitCode = 1;
    } finally {
      await client.end();
    }
  } else if (command === 'authorize') {
    const hours = Number(values['valid-hours']);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24)
      throw new Error('--valid-hours must be between 0 and 24');
    const outDir = need('out-dir');
    assertOutsideRepository(outDir);
    const backupPath = resolve(need('backup'));
    const evidencePath = resolve(need('evidence'));
    const fingerprintPath = resolve(need('fingerprint'));
    const { client, url } = await connectLoader();
    try {
      const live = await readLiveIdentity(client);
      const problems = await loaderPrivilegeProblems(client);
      if (problems.length > 0) throw new LoadRefusedError('loader-privileges', problems.join('; '));
      const target = describeUrl(url);
      const baseline = JSON.parse(readFileSync(fingerprintPath, 'utf8'));
      await client.query('BEGIN READ ONLY');
      const current = await tableFingerprint(client);
      const registry = (
        await client.query(
          `SELECT d.lgd_code::int AS district, s.lgd_code::int AS state FROM districts d JOIN states s ON s.id = d.state_id WHERE d.lgd_code ~ '^[0-9]+$' AND s.lgd_code ~ '^[0-9]+$'`,
        )
      ).rows;
      await client.query('ROLLBACK');
      const differences = fingerprintDifferences(baseline, current);
      if (differences.length > 0)
        throw new LoadRefusedError(
          'fingerprint',
          `the live database differs from the fingerprint file: ${differences.join(', ')}`,
        );
      const plan = buildLgdPlan(need('reference-dir'), {
        extraParents: new Map(registry.map((r) => [r.district, r.state])),
      });
      const authorization = buildAuthorization({
        approvedBy: need('approved-by'),
        issuedAt: new Date(),
        validHours: hours,
        loaderRole: target.user || DEFAULT_LOADER_ROLE,
        target: {
          host: target.host,
          port: target.port,
          database: live.database,
          systemIdentifier: live.system_identifier,
          migrations: live.migrations,
        },
        plan: {
          totalSets: plan.sets.length,
          totalUnits: plan.sets.reduce((n, s) => n + s.units.length, 0),
          sets: plan.sets.map((s) => ({
            code: s.code,
            fileSha256: s.fileSha256,
            units: s.units.length,
          })),
        },
        backup: {
          path: backupPath,
          sha256: await sha256File(backupPath),
          sizeBytes: statSync(backupPath).size,
          restoreEvidence: { path: evidencePath, sha256: await sha256File(evidencePath) },
        },
        fingerprint: {
          path: fingerprintPath,
          fileSha256: await sha256File(fingerprintPath),
          digest: fingerprintDigest(baseline),
        },
      });
      const file = join(
        resolve(outDir),
        `lgd-dev-load-authorization-${authorization.authorizationId}.json`,
      );
      writeOutside(file, authorization);
      console.log(
        `authorization written: ${file}\nvalid until ${authorization.expiresAt}; it can be used once.`,
      );
    } finally {
      await client.end();
    }
  } else if (command === 'verify' || command === 'execute') {
    const url = process.env.DATABASE_REF_LOADER_URL;
    if (!url) throw new Error('DATABASE_REF_LOADER_URL is not set (the dedicated loader login)');
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    /** @type {import('node:readline/promises').Interface | undefined} */
    let rl;
    const result = await runControlledLoad({
      authorizationPath: need('authorization'),
      referenceDir: need('reference-dir'),
      loaderUrl: url,
      mode: command,
      interactive,
      log: (m) => console.log(`  ${m}`),
      confirm: async (phrase) => {
        rl = createInterface({ input: process.stdin, output: process.stdout });
        console.log(`\nTo continue type exactly:\n  ${phrase}`);
        try {
          return (await rl.question('> ')).trim();
        } finally {
          // close at once, whatever is typed: an open stdin would keep the process alive after a refusal
          rl.close();
        }
      },
    });
    rl?.close();
    console.log(`\nresult: ${JSON.stringify(result)}`);
  } else {
    console.error(
      'usage: load-lgd-reference-dev.js <fingerprint|restore-evidence|authorize|verify|execute> [options]',
    );
    process.exitCode = 2;
  }
} catch (error) {
  const code =
    error instanceof LoadRefusedError ||
    (error instanceof Error && error.name === 'AuthorizationError')
      ? ` [${/** @type {any} */ (error).code}]`
      : '';
  console.error(`REFUSED${code}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
