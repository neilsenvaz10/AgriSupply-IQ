import { describe, expect, it } from 'vitest';
import {
  APPROVED_TOTALS,
  MAX_VALIDITY_MS,
  buildAuthorization,
  canonicalJson,
  confirmationPhrase,
  integrityOf,
  validateAuthorization,
} from './authorization.js';
import { assertFilePermissions, permissionProblem } from './controlled.js';
import { broadAclEntries } from './secureFile.js';
import { fingerprintDifferences, fingerprintDigest } from './fingerprint.js';

/** Authorization document rules (no database, no files). */

const sha = (c) => c.repeat(64);
const make = (over = {}, hours = 12, issuedAt = new Date('2026-10-21T10:00:00Z')) =>
  buildAuthorization({
    approvedBy: 'Test Approver',
    issuedAt,
    validHours: hours,
    loaderRole: 'fasalytics_ref_loader',
    target: {
      host: '127.0.0.1',
      port: 5433,
      database: 'fasalytics',
      systemIdentifier: '7697971194938445858',
      migrations: ['1:aaaaaaaaaaaa'],
    },
    plan: {
      totalSets: 4,
      totalUnits: 2899,
      sets: [
        { code: 'a', fileSha256: sha('a'), units: 36 },
        { code: 'b', fileSha256: sha('b'), units: 784 },
        { code: 'c', fileSha256: sha('c'), units: 41 },
        { code: 'd', fileSha256: sha('d'), units: 2038 },
      ],
    },
    backup: {
      path: '/b.dump',
      sha256: sha('e'),
      sizeBytes: 10,
      restoreEvidence: { path: '/e.json', sha256: sha('f') },
    },
    fingerprint: { path: '/f.json', fileSha256: sha('1'), digest: sha('2') },
    ...over,
  });
const NOW = new Date('2026-10-21T12:00:00Z');

/** Re-seals a mutated document so that only the rule under test fails. */
const reseal = (doc) => ({ ...doc, integrity: integrityOf(doc) });

describe('authorization document', () => {
  it('accepts a well formed, unexpired document and names the exact confirmation phrase', () => {
    const doc = make();
    expect(validateAuthorization(doc, { now: NOW })).toBe(doc);
    expect(confirmationPhrase(doc)).toBe('LOAD LGD REFERENCE INTO fasalytics 7697971194938445858');
    expect(APPROVED_TOTALS).toEqual({ sets: 4, units: 2899 });
  });

  it('refuses an expired document, one issued in the future, and one valid for more than 24 hours', () => {
    expect(() => validateAuthorization(make(), { now: new Date('2026-10-21T22:00:01Z') })).toThrow(
      /expired/,
    );
    expect(() => validateAuthorization(make(), { now: new Date('2026-10-21T09:00:00Z') })).toThrow(
      /future/,
    );
    const long = make({}, 24.5);
    expect(long.expiresAt > long.issuedAt).toBe(true);
    expect(() => validateAuthorization(long, { now: NOW })).toThrow(/at most 24 hours/);
    expect(MAX_VALIDITY_MS).toBe(86_400_000);
  });

  it('detects any edit made after issue', () => {
    const doc = make();
    expect(() =>
      validateAuthorization({ ...doc, approvedBy: 'Somebody Else' }, { now: NOW }),
    ).toThrow(/edited/);
    expect(() =>
      validateAuthorization({ ...doc, target: { ...doc.target, port: 5432 } }, { now: NOW }),
    ).toThrow(/edited/);
  });

  it('pins exactly 4 sets and 2,899 rows, and the listed sets must add up', () => {
    const doc = make();
    const wrongTotal = reseal({ ...doc, plan: { ...doc.plan, totalUnits: 2900 } });
    expect(() => validateAuthorization(wrongTotal, { now: NOW })).toThrow(/does not match/);
    const fiveSets = reseal({
      ...doc,
      plan: {
        totalSets: 5,
        totalUnits: 2900,
        sets: [...doc.plan.sets, { code: 'e', fileSha256: sha('9'), units: 1 }],
      },
    });
    expect(() => validateAuthorization(fiveSets, { now: NOW })).toThrow(/exactly 4 sets and 2899/);
    // the totals can only be changed by code (a parameter that the command line never passes)
    expect(
      validateAuthorization(fiveSets, { now: NOW, approvedTotals: { sets: 5, units: 2900 } }),
    ).toBeTruthy();
  });

  it('requires the backup, the restore evidence, the fingerprint and the other mandatory fields', () => {
    const doc = make();
    for (const field of ['backup', 'fingerprint', 'target', 'plan']) {
      const copy = { ...doc };
      delete copy[field];
      expect(() => validateAuthorization(reseal(copy), { now: NOW }), field).toThrow();
    }
    const noEvidence = reseal({ ...doc, backup: { ...doc.backup, restoreEvidence: undefined } });
    expect(() => validateAuthorization(noEvidence, { now: NOW })).toThrow(/restore evidence/);
    expect(() => validateAuthorization({ ...doc, format: 'x' }, { now: NOW })).toThrow(/format/);
    expect(() => validateAuthorization(null, { now: NOW })).toThrow(/not a JSON object/);
    expect(() => validateAuthorization(reseal({ ...doc, nonce: 'abc' }), { now: NOW })).toThrow(
      /nonce/,
    );
  });

  it('creates a new identifier and nonce each time', () => {
    const a = make();
    const b = make();
    expect(a.authorizationId).not.toBe(b.authorizationId);
    expect(a.nonce).not.toBe(b.nonce);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});

describe('table fingerprints', () => {
  const base = { t1: { rows: 1, hash: '10' }, t2: { rows: 2, hash: '20' } };
  it('has a digest that depends on every table and ignores key order', () => {
    expect(fingerprintDigest({ t2: base.t2, t1: base.t1 })).toBe(fingerprintDigest(base));
    expect(fingerprintDigest({ ...base, t2: { rows: 2, hash: '21' } })).not.toBe(
      fingerprintDigest(base),
    );
  });
  it('lists the tables that differ, optionally ignoring some', () => {
    const other = { t1: { rows: 1, hash: '10' }, t2: { rows: 3, hash: '30' }, t3: base.t1 };
    expect(fingerprintDifferences(base, other)).toEqual(['t2', 't3']);
    expect(fingerprintDifferences(base, other, ['t2', 't3'])).toEqual([]);
  });
});

describe('file permissions', () => {
  it('requires the authorization to be owner-only and the other material not to be writable by others', () => {
    expect(permissionProblem(0o600, true)).toBeNull();
    expect(permissionProblem(0o400, true)).toBeNull();
    expect(permissionProblem(0o640, true)).toMatch(/group or other/);
    expect(permissionProblem(0o644, true)).toMatch(/group or other/);
    expect(permissionProblem(0o644, false)).toBeNull();
    expect(permissionProblem(0o664, false)).toMatch(/write/);
    expect(permissionProblem(0o666, false)).toMatch(/write/);
    expect(permissionProblem(0o100600, true)).toBeNull();
  });

  it('does not apply POSIX mode bits to the non-secret material on Windows', () => {
    expect(() => assertFilePermissions('/does/not/matter', false, 'win32')).not.toThrow();
  });

  it('recognises an ACL that grants access to a broad group', () => {
    const users = [
      'C:\\x\\a.json BUILTIN\\Users:(I)(M)',
      '  NT AUTHORITY\\SYSTEM:(I)(F)',
      '  PC\\me:(I)(F)',
    ].join('\n');
    expect(broadAclEntries(users)).toHaveLength(1);
    expect(broadAclEntries('C:\\x\\a.json Everyone:(R)')).toHaveLength(1);
    expect(broadAclEntries('x NT AUTHORITY\\Authenticated Users:(M)')).toHaveLength(1);
    expect(broadAclEntries('x PC\\me:(F)\n  NT AUTHORITY\\SYSTEM:(F)')).toHaveLength(0);
  });
});
