import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * The authorization document of a controlled development LGD reference load (Milestone 2.4).
 *
 * It is a JSON file kept OUTSIDE Git. It does not grant anything by itself: every fact it pins (database
 * identity, source files, row counts, backup, fingerprint) is re-verified against the live system before any
 * write, and it can be used exactly once. The `integrity` field is a checksum that makes accidental edits
 * evident; it is not a signature.
 */

export const AUTHORIZATION_FORMAT = 'fasalytics.lgd-dev-load.authorization/1';
export const OPERATION = 'load-lgd-reference';
export const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The totals this reviewed code approves. A different plan needs a reviewed code change, not just a document. */
export const APPROVED_TOTALS = Object.freeze({ sets: 4, units: 2899 });

export class AuthorizationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
const fail = (code, message) => {
  throw new AuthorizationError(code, message);
};

/**
 * Stable JSON: object keys sorted at every level.
 * @param {any} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** @param {any} doc */
export const integrityOf = (doc) => {
  const rest = { ...doc };
  delete rest.integrity;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
};

/**
 * Builds a new authorization document.
 * @param {object} input
 * @param {string} input.approvedBy
 * @param {Date} input.issuedAt
 * @param {number} input.validHours
 * @param {object} input.target
 * @param {object} input.plan
 * @param {object} input.backup
 * @param {object} input.fingerprint
 * @param {string} input.loaderRole
 */
export function buildAuthorization(input) {
  const issuedAt = input.issuedAt;
  const expiresAt = new Date(issuedAt.getTime() + input.validHours * 3_600_000);
  const doc = {
    format: AUTHORIZATION_FORMAT,
    operation: OPERATION,
    authorizationId: randomUUID(),
    nonce: randomBytes(32).toString('hex'),
    approvedBy: input.approvedBy,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    target: input.target,
    plan: input.plan,
    backup: input.backup,
    fingerprint: input.fingerprint,
    loaderRole: input.loaderRole,
  };
  return { ...doc, integrity: integrityOf(doc) };
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Structural, time and integrity validation. It never touches the database or the file system.
 * @param {any} doc
 * @param {{ now?: Date, approvedTotals?: { sets: number, units: number } }} [options] `approvedTotals` exists for
 *        tests with small synthetic data; the command line never passes it, so the reviewed constant applies.
 */
export function validateAuthorization(doc, options = {}) {
  const now = options.now ?? new Date();
  const approved = options.approvedTotals ?? APPROVED_TOTALS;
  if (!doc || typeof doc !== 'object') fail('malformed', 'the authorization is not a JSON object');
  if (doc.format !== AUTHORIZATION_FORMAT) fail('format', 'unknown authorization format');
  if (doc.operation !== OPERATION) fail('operation', `the authorization is not for ${OPERATION}`);
  for (const key of [
    'authorizationId',
    'nonce',
    'approvedBy',
    'issuedAt',
    'expiresAt',
    'loaderRole',
  ])
    if (typeof doc[key] !== 'string' || doc[key].trim() === '')
      fail('malformed', `${key} is missing`);
  if (!/^[0-9a-f-]{36}$/.test(doc.authorizationId))
    fail('malformed', 'authorizationId is not a UUID');
  if (!HEX64.test(doc.nonce)) fail('malformed', 'nonce is not 64 hex characters');
  if (doc.integrity !== integrityOf(doc))
    fail('integrity', 'the authorization was edited after it was issued');
  const issued = Date.parse(doc.issuedAt);
  const expires = Date.parse(doc.expiresAt);
  if (Number.isNaN(issued) || Number.isNaN(expires))
    fail('malformed', 'issuedAt or expiresAt is not a date');
  if (expires <= issued) fail('malformed', 'expiresAt is not after issuedAt');
  if (expires - issued > MAX_VALIDITY_MS)
    fail('lifetime', 'an authorization may be valid for at most 24 hours');
  if (issued - now.getTime() > CLOCK_SKEW_MS)
    fail('not-yet-valid', 'the authorization was issued in the future');
  if (now.getTime() >= expires) fail('expired', `the authorization expired at ${doc.expiresAt}`);

  const t = doc.target;
  if (!t || typeof t !== 'object') fail('malformed', 'target is missing');
  for (const key of ['host', 'database', 'systemIdentifier'])
    if (typeof t[key] !== 'string' || t[key] === '') fail('malformed', `target.${key} is missing`);
  if (!Number.isInteger(t.port) || t.port < 1 || t.port > 65535)
    fail('malformed', 'target.port is invalid');
  if (
    !Array.isArray(t.migrations) ||
    t.migrations.length === 0 ||
    !t.migrations.every((/** @type {unknown} */ m) => typeof m === 'string')
  )
    fail('malformed', 'target.migrations is missing');

  const plan = doc.plan;
  if (!plan || !Array.isArray(plan.sets)) fail('malformed', 'plan.sets is missing');
  if (plan.totalSets !== plan.sets.length)
    fail('plan', 'plan.totalSets does not match the listed sets');
  let units = 0;
  for (const set of plan.sets) {
    if (
      typeof set.code !== 'string' ||
      !HEX64.test(set.fileSha256) ||
      !Number.isInteger(set.units) ||
      set.units < 0
    )
      fail('malformed', 'a planned set is malformed');
    units += set.units;
  }
  if (plan.totalUnits !== units) fail('plan', 'plan.totalUnits does not match the listed sets');
  if (plan.totalSets !== approved.sets || plan.totalUnits !== approved.units)
    fail(
      'plan',
      `this loader approves exactly ${approved.sets} sets and ${approved.units} unit rows; the authorization says ${plan.totalSets} and ${plan.totalUnits}`,
    );
  if (
    new Set(plan.sets.map((/** @type {{ code: string }} */ s) => s.code)).size !== plan.sets.length
  )
    fail('plan', 'duplicate set codes');

  const b = doc.backup;
  if (!b || typeof b.path !== 'string' || !HEX64.test(b.sha256) || !Number.isInteger(b.sizeBytes))
    fail('backup', 'backup path, sha256 and size are required');
  const r = b.restoreEvidence;
  if (!r || typeof r.path !== 'string' || !HEX64.test(r.sha256))
    fail('backup', 'restore evidence is required');
  const f = doc.fingerprint;
  if (!f || typeof f.path !== 'string' || !HEX64.test(f.fileSha256) || !HEX64.test(f.digest))
    fail('fingerprint', 'the approved fingerprint (file, file hash and digest) is required');
  return doc;
}

/**
 * The text an operator must type to confirm.
 * @param {any} doc
 */
export const confirmationPhrase = (doc) =>
  `LOAD LGD REFERENCE INTO ${doc.target.database} ${doc.target.systemIdentifier}`;
