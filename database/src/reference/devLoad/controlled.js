import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { insertReferenceSet } from '../lgdLoad.js';
import { buildLgdPlan } from '../lgdPlan.js';
import {
  APPROVED_TOTALS,
  AuthorizationError,
  confirmationPhrase,
  validateAuthorization,
} from './authorization.js';
import {
  REFERENCE_TABLES,
  fingerprintDifferences,
  fingerprintDigest,
  tableFingerprint,
} from './fingerprint.js';
import { loaderPrivilegeProblems } from './loaderRole.js';
import { ownerOnlyProblem, restrictToOwner } from './secureFile.js';

/**
 * Controlled development LGD reference load (Milestone 2.4).
 *
 * This is a SEPARATE entry point from the disposable-only loader. It never calls or relaxes the disposable
 * guard, there is no environment switch that turns it on, and it refuses to write unless every one of these
 * holds (any failure raises and nothing is written):
 *
 *   1. a valid, unexpired, unused authorization document (at most 24 hours, one use);
 *   2. the connection target is a loopback address that equals the authorized one, and the live database
 *      carries the authorized PostgreSQL system identifier, database name and migration journal;
 *   3. the source files produce exactly the authorized reference sets, fingerprints and row counts;
 *   4. the backup file matches its recorded checksum and age, and restore evidence ties that backup to the
 *      authorized table fingerprint;
 *   5. the live table fingerprint equals the authorized one, and both reference tables and the identity tables
 *      are empty;
 *   6. the login holds exactly the least-privilege set of `loaderRole.js`;
 *   7. an operator types the confirmation phrase in an interactive terminal.
 *
 * The four sets are then inserted in ONE transaction, verified, and committed only if the verification passes.
 * A rolled-back transaction leaves no rows; it can still have consumed sequence values or logged to the server
 * (PostgreSQL does not undo that), and the authorization is consumed by any attempt that reaches the write phase.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = 'fasalytics:lgd-reference-load';
export const RESTORE_EVIDENCE_FORMAT = 'fasalytics.restore-evidence/1';

export class LoadRefusedError extends AuthorizationError {}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
const refuse = (code, message) => {
  throw new LoadRefusedError(code, message);
};

/** @param {string} path */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Why a file's POSIX mode is not acceptable, or null. The authorization is owner-only (no group or other access
 * at all); the other material must at least not be writable by group or other. Windows has no POSIX mode bits,
 * so the check does not apply there (the ACLs of the owner's folder apply; see the documentation).
 *
 * @param {number} mode `stat.mode`
 * @param {boolean} ownerOnly
 * @returns {string | null}
 */
export function permissionProblem(mode, ownerOnly) {
  const bits = mode & 0o777;
  if (ownerOnly && (bits & 0o077) !== 0)
    return `mode ${bits.toString(8)} gives access to group or other: use chmod 600`;
  if (!ownerOnly && (bits & 0o022) !== 0)
    return `mode ${bits.toString(8)} lets group or other write: use chmod 644 or stricter`;
  return null;
}

/**
 * @param {string} path
 * @param {boolean} ownerOnly
 * @param {NodeJS.Platform} [platform]
 */
export function assertFilePermissions(path, ownerOnly, platform = process.platform) {
  if (ownerOnly) {
    const problem = ownerOnlyProblem(path, platform);
    if (problem) refuse('permissions', `${path}: ${problem}`);
    return;
  }
  if (platform === 'win32') return;
  const problem = permissionProblem(statSync(path).mode, false);
  if (problem) refuse('permissions', `${path}: ${problem}`);
}

/**
 * Host, port, database and login of a connection string (no password is read out).
 * @param {string} url
 */
export function describeUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    user: decodeURIComponent(u.username),
  };
}

/**
 * What the live server says about itself, from the catalog only.
 * @param {import('pg').Client} client
 */
export async function readLiveIdentity(client) {
  const row = (
    await client.query(
      `SELECT current_database() AS database, (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
              current_setting('server_version_num')::int AS version, current_user AS login`,
    )
  ).rows[0];
  const migrations = (
    await client.query(
      `SELECT id, left(hash, 12) AS h FROM drizzle.__drizzle_migrations ORDER BY id`,
    )
  ).rows.map((r) => `${r.id}:${r.h}`);
  return { ...row, migrations };
}

/**
 * Checks the connection string and the live identity against the authorization.
 * @param {string} url
 * @param {any} doc
 * @param {Awaited<ReturnType<typeof readLiveIdentity>>} live
 */
export function verifyTarget(url, doc, live) {
  const target = describeUrl(url);
  if (!LOOPBACK.has(target.host))
    refuse(
      'production-target',
      `${target.host} is not a local address: remote databases are never loaded by this command`,
    );
  if (target.host !== doc.target.host || target.port !== doc.target.port)
    refuse('wrong-target', 'the connection host or port is not the authorized one');
  if (target.user !== doc.loaderRole)
    refuse('wrong-login', `the connection must use the dedicated loader login ${doc.loaderRole}`);
  if (live.database !== doc.target.database || target.database !== doc.target.database)
    refuse('wrong-database', 'the database name is not the authorized one');
  if (live.system_identifier !== doc.target.systemIdentifier)
    refuse('wrong-system-identifier', 'the PostgreSQL system identifier is not the authorized one');
  if (JSON.stringify(live.migrations) !== JSON.stringify(doc.target.migrations))
    refuse('wrong-migrations', 'the migration journal differs from the authorized one');
}

/**
 * The backup file, the restore evidence and the approved fingerprint file, against the authorization.
 * @param {any} doc
 * @param {Date} now
 */
export async function verifyEvidence(doc, now) {
  const backup = doc.backup;
  if (!existsSync(backup.path)) refuse('backup-missing', 'the backup file does not exist');
  const stat = statSync(backup.path);
  if (stat.size !== backup.sizeBytes)
    refuse('backup-checksum', 'the backup size differs from the authorized one');
  if ((await sha256File(backup.path)) !== backup.sha256)
    refuse('backup-checksum', 'the backup checksum differs from the authorized one');
  if (now.getTime() - stat.mtimeMs > BACKUP_MAX_AGE_MS)
    refuse('backup-stale', 'the backup is older than 24 hours: take a new one');

  if (!existsSync(backup.restoreEvidence.path))
    refuse('restore-evidence', 'the restore evidence file does not exist');
  if ((await sha256File(backup.restoreEvidence.path)) !== backup.restoreEvidence.sha256)
    refuse('restore-evidence', 'the restore evidence differs from the authorized one');
  const evidence = readJson(backup.restoreEvidence.path);
  if (
    evidence.format !== RESTORE_EVIDENCE_FORMAT ||
    evidence.backupSha256 !== backup.sha256 ||
    evidence.fingerprintDigest !== doc.fingerprint.digest ||
    evidence.restoreTargetWasDisposable !== true ||
    evidence.fingerprintMatchedSource !== true
  )
    refuse(
      'restore-evidence',
      'the restore evidence does not show this backup restored to the approved fingerprint',
    );
  if (
    Date.parse(evidence.restoredAt) < stat.mtimeMs ||
    Date.parse(evidence.restoredAt) > now.getTime()
  )
    refuse('restore-evidence', 'the restore evidence is dated outside the life of the backup');

  if (!existsSync(doc.fingerprint.path))
    refuse('fingerprint', 'the approved fingerprint file does not exist');
  if ((await sha256File(doc.fingerprint.path)) !== doc.fingerprint.fileSha256)
    refuse('fingerprint', 'the approved fingerprint file differs from the authorized one');
  const baseline = readJson(doc.fingerprint.path);
  if (fingerprintDigest(baseline) !== doc.fingerprint.digest)
    refuse('fingerprint', 'the approved fingerprint digest does not match its file');
  return baseline;
}

/**
 * The plan from the source files, which must equal the authorized plan exactly.
 * @param {string} referenceDir
 * @param {any} doc
 * @param {Map<number, number>} extraParents
 * @param {{ sets: number, units: number }} [totals]
 */
export function planMatchingAuthorization(
  referenceDir,
  doc,
  extraParents,
  totals = APPROVED_TOTALS,
) {
  const plan = buildLgdPlan(referenceDir, { extraParents });
  const planned = plan.sets.map((s) => ({
    code: s.code,
    fileSha256: s.fileSha256,
    units: s.units.length,
  }));
  const approved = doc.plan.sets;
  const key = (/** @type {any} */ s) => `${s.code}|${s.fileSha256}|${s.units}`;
  if (planned.map(key).sort().join('\n') !== approved.map(key).sort().join('\n'))
    refuse(
      'source-changed',
      'the source files do not produce exactly the authorized reference sets, fingerprints and row counts',
    );
  const units = plan.sets.reduce((n, s) => n + s.units.length, 0);
  if (plan.sets.length !== totals.sets || units !== totals.units)
    refuse(
      'counts',
      `expected ${totals.sets} sets and ${totals.units} rows, planned ${plan.sets.length} and ${units}`,
    );
  return plan;
}

/**
 * Reads the registry (read only) for parents of districts the report omits; the same step as the disposable loader.
 * @param {import('pg').Client} client
 */
async function registryParents(client) {
  const rows = (
    await client.query(
      `SELECT d.lgd_code::int AS district, s.lgd_code::int AS state FROM districts d JOIN states s ON s.id = d.state_id
        WHERE d.lgd_code ~ '^[0-9]+$' AND s.lgd_code ~ '^[0-9]+$'`,
    )
  ).rows;
  return new Map(rows.map((r) => [r.district, r.state]));
}

/**
 * Checks inside the transaction that the database holds exactly what the authorization approves.
 * @param {import('pg').Client} client
 * @param {any} doc
 * @param {Record<string, { rows: number, hash: string }>} baseline
 * @param {{ loaded: boolean }} state
 */
async function verifyState(client, doc, baseline, state) {
  const problems = [];
  const one = async (/** @type {string} */ sql) => (await client.query(sql)).rows[0];
  const sets = (
    await client.query(
      `SELECT s.code, s.file_sha256, s.record_count, (SELECT count(*)::int FROM admin_unit_version v WHERE v.reference_set_id = s.id) AS units
         FROM geo_reference_set s ORDER BY s.code`,
    )
  ).rows;
  const expectedSets = state.loaded ? doc.plan.sets : [];
  if (sets.length !== expectedSets.length)
    problems.push(`expected ${expectedSets.length} reference sets, found ${sets.length}`);
  for (const e of expectedSets) {
    const found = sets.find((s) => s.code === e.code);
    if (!found) problems.push(`reference set ${e.code} is missing`);
    else {
      if (found.file_sha256 !== e.fileSha256)
        problems.push(`reference set ${e.code} has another fingerprint`);
      if (found.units !== e.units)
        problems.push(`reference set ${e.code} has ${found.units} rows, expected ${e.units}`);
    }
  }
  for (const s of sets)
    if (!expectedSets.some((e) => e.code === s.code))
      problems.push(`unexpected reference set ${s.code}`);
  const total = (await one('SELECT count(*)::int AS n FROM admin_unit_version')).n;
  if (total !== (state.loaded ? doc.plan.totalUnits : 0))
    problems.push(
      `expected ${state.loaded ? doc.plan.totalUnits : 0} administrative unit rows, found ${total}`,
    );

  if (state.loaded) {
    const dup = (
      await one(
        `SELECT count(*)::int AS n FROM (SELECT 1 FROM admin_unit_version GROUP BY reference_set_id, unit_type, lgd_code, history_seq HAVING count(*) > 1) d`,
      )
    ).n;
    if (dup > 0) problems.push(`${dup} duplicate history versions`);
    const latest = (
      await one(
        `SELECT count(*)::int AS n FROM (SELECT 1 FROM admin_unit_version GROUP BY reference_set_id, unit_type, lgd_code HAVING count(*) FILTER (WHERE is_latest_version) <> 1) d`,
      )
    ).n;
    if (latest > 0) problems.push(`${latest} units without exactly one latest version`);
    const conflict = (
      await one(
        `SELECT count(*)::int AS n FROM admin_unit_version r JOIN geo_reference_set rs ON rs.id = r.reference_set_id AND rs.code LIKE 'lgd-all-districts%'
           JOIN admin_unit_version p ON p.unit_type = 'district' AND p.lgd_code = r.lgd_code AND p.is_latest_version
           JOIN geo_reference_set ps ON ps.id = p.reference_set_id AND ps.code LIKE 'lgd-district-pages%'
          WHERE r.parent_lgd_code <> p.parent_lgd_code OR upper(btrim(r.name_en)) <> upper(btrim(p.name_en))`,
      )
    ).n;
    if (conflict > 0)
      problems.push(`${conflict} conflicting district codes between the report and the pages`);
    const provenance = (
      await one(
        `SELECT count(*)::int AS n FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id
          WHERE s.fingerprint_kind = 'manifest' AND (v.source_url IS NULL OR v.source_sha256 IS NULL OR v.retrieved_at IS NULL)`,
      )
    ).n;
    if (provenance > 0)
      problems.push(`${provenance} page rows without source URL, hash or retrieval time`);
    const legal = (
      await one(
        'SELECT count(*)::int AS n FROM admin_unit_version WHERE legal_effective_date IS NOT NULL',
      )
    ).n;
    if (legal > 0) problems.push(`${legal} rows carry a legal effective date`);
  }
  for (const table of ['identity_decision', 'mapping_set', 'identity_review_event']) {
    const n = (await one(`SELECT count(*)::int AS n FROM ${table}`)).n;
    if (n > 0) problems.push(`${table} holds ${n} rows`);
  }
  const live = await tableFingerprint(client);
  const changed = fingerprintDifferences(baseline, live, state.loaded ? REFERENCE_TABLES : []);
  if (changed.length > 0)
    problems.push(`tables differ from the approved fingerprint: ${changed.join(', ')}`);
  return { problems, sets, total };
}

/**
 * @typedef {object} ControlledLoadOptions
 * @property {string} authorizationPath
 * @property {string} referenceDir
 * @property {string} loaderUrl Connection string of the dedicated loader login.
 * @property {'verify' | 'execute'} mode `verify` runs every check and writes nothing.
 * @property {boolean} interactive Whether a person is at a terminal.
 * @property {(phrase: string) => Promise<string>} [confirm] Asks the operator to type the phrase.
 * @property {Date} [now]
 * @property {{ sets: number, units: number }} [approvedTotals] Tests with small synthetic data only; never set by the command line.
 * @property {(message: string) => void} [log]
 * @property {{ afterInsert?: (client: pg.Client) => Promise<void> }} [hooks] Failure injection for tests only.
 */

/**
 * @param {ControlledLoadOptions} options
 */
export async function runControlledLoad(options) {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const statePath = `${options.authorizationPath}.state`;
  const reportPath = `${options.authorizationPath}.report.json`;

  if (!existsSync(options.authorizationPath))
    refuse('missing-authorization', 'the authorization document does not exist');
  /** @type {any} */
  let doc;
  try {
    doc = readJson(options.authorizationPath);
  } catch {
    refuse('malformed', 'the authorization document is not valid JSON');
  }
  assertFilePermissions(options.authorizationPath, true);
  validateAuthorization(doc, { now, approvedTotals: options.approvedTotals });
  if (existsSync(statePath))
    refuse('reused', 'this authorization was already used; a new one is required');
  log('authorization is well formed and unexpired');

  const target = describeUrl(options.loaderUrl);
  if (!LOOPBACK.has(target.host))
    refuse(
      'production-target',
      `${target.host} is not a local address: remote databases are never loaded by this command`,
    );

  for (const path of [doc.backup.path, doc.backup.restoreEvidence.path, doc.fingerprint.path])
    if (existsSync(path)) assertFilePermissions(path, false);
  const baseline = await verifyEvidence(doc, now);
  log('backup checksum, restore evidence and approved fingerprint verified');

  const client = new pg.Client({
    connectionString: options.loaderUrl,
    connectionTimeoutMillis: 10_000,
  });
  client.on('error', () => undefined);
  await client.connect();
  let consumed = false;
  /** @type {any} */
  let transactionFailure = null;
  try {
    const live = await readLiveIdentity(client);
    verifyTarget(options.loaderUrl, doc, live);
    log(`target verified: ${live.database}, system identifier ${live.system_identifier}`);

    const privileges = await loaderPrivilegeProblems(client);
    if (privileges.length > 0)
      refuse(
        'loader-privileges',
        `the loader login is not the approved least-privilege login: ${privileges.join('; ')}`,
      );
    log('loader login holds exactly the approved privileges');

    const plan = planMatchingAuthorization(
      options.referenceDir,
      doc,
      await registryParents(client),
      options.approvedTotals ?? APPROVED_TOTALS,
    );
    log(
      `source files produce the authorized ${plan.sets.length} sets and ${plan.sets.reduce((n, s) => n + s.units.length, 0)} rows`,
    );

    // Read-only pre-check in its own transaction (also the whole of `verify` mode).
    await client.query('BEGIN READ ONLY');
    try {
      const pre = await verifyState(client, doc, baseline, { loaded: false });
      if (pre.problems.length > 0) refuse('precondition', pre.problems.join('; '));
    } finally {
      await client.query('ROLLBACK');
    }
    log('database equals the approved fingerprint; reference and identity tables are empty');
    if (options.mode === 'verify') return { status: 'verified', sets: plan.sets.length };

    // ---- the operator
    if (!options.interactive || !options.confirm)
      refuse('noninteractive', 'a person must confirm this load at an interactive terminal');
    const phrase = confirmationPhrase(doc);
    const typed = await options.confirm(phrase);
    if (typed !== phrase) refuse('confirmation', 'the typed confirmation does not match');

    // ---- consume the authorization: any attempt that gets this far uses it up
    try {
      writeFileSync(
        statePath,
        JSON.stringify({
          authorizationId: doc.authorizationId,
          status: 'in-progress',
          startedAt: now.toISOString(),
        }),
        { flag: 'wx', mode: 0o600 },
      );
    } catch {
      refuse('reused', 'this authorization was already used; a new one is required');
    }
    restrictToOwner(statePath);
    consumed = true;

    // ---- the one controlled transaction
    const started = Date.now();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE');
    try {
      await client.query("SET LOCAL statement_timeout = '15min'");
      await client.query("SET LOCAL lock_timeout = '10s'");
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [
        LOCK_KEY,
      ]);
      if (!lock.rows[0].ok) refuse('locked', 'another controlled load is running');
      const pre = await verifyState(client, doc, baseline, { loaded: false });
      if (pre.problems.length > 0) refuse('precondition', pre.problems.join('; '));
      for (const set of plan.sets) await insertReferenceSet(/** @type {any} */ (client), set);
      if (options.hooks?.afterInsert) await options.hooks.afterInsert(client);
      const post = await verifyState(client, doc, baseline, { loaded: true });
      if (post.problems.length > 0) refuse('verification', post.problems.join('; '));
      await client.query('COMMIT');
    } catch (error) {
      transactionFailure = error;
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    log('committed');

    // ---- after commit, from a fresh read-only look
    await client.query('BEGIN READ ONLY');
    let after;
    try {
      after = await verifyState(client, doc, baseline, { loaded: true });
    } finally {
      await client.query('ROLLBACK');
    }
    const report = {
      authorizationId: doc.authorizationId,
      approvedBy: doc.approvedBy,
      status: after.problems.length === 0 ? 'committed' : 'committed-with-problems',
      problems: after.problems,
      committedAt: new Date().toISOString(),
      seconds: Math.round((Date.now() - started) / 1000),
      sets: after.sets,
      totalUnits: after.total,
      unresolved: plan.unresolved,
      postFingerprintDigest: fingerprintDigest(await tableFingerprint(client)),
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    restrictToOwner(reportPath);
    writeFileSync(
      statePath,
      JSON.stringify({
        authorizationId: doc.authorizationId,
        status: report.status,
        finishedAt: report.committedAt,
      }),
      { mode: 0o600 },
    );
    return {
      status: report.status,
      sets: after.sets.length,
      totalUnits: after.total,
      problems: after.problems,
    };
  } catch (error) {
    if (consumed) {
      writeFileSync(
        statePath,
        JSON.stringify({
          authorizationId: doc.authorizationId,
          status: 'rolled-back',
          error: error instanceof Error ? error.message.slice(0, 500) : String(error),
          finishedAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
    }
    void transactionFailure;
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
