import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { grantIdentityPrivileges } from '../identity/privileges.js';
import {
  listReviewLogins,
  loginName,
  provisionReviewLogin,
  revokeAllReviewLogins,
  revokeReviewLogin,
  reviewLoginProblems,
} from '../identity/logins.js';
import { describeIntegration } from '../test/db.js';
import { assertDisposable, guardedUrl } from '../test/disposable.js';
import { suffix } from '../test/fixtures.js';
import { createGeoDatabase } from '../test/geoDatabase.js';
import { pilotWorld } from '../test/geoFixtures.js';
import { createLogins, urlFor } from '../test/roles.js';
import { analyse } from './analysis.js';
import { selectPilot } from './pilot.js';
import { buildProposals } from './proposals.js';
import { runRehearsal } from './rehearsal.js';
import { readSnapshot } from './snapshot.js';

/**
 * Stage 3c: the personal reviewer and approver logins, and the complete review workflow rehearsed end to end on a
 * verified DISPOSABLE server, in a database of its own, with SYNTHETIC people. The logins are made by the real
 * provisioning code (the one an administrator will use after the authorization gate) and dropped at the end.
 * Nothing here can touch the development database.
 */

const SUBMIT = fileURLToPath(new URL('../../scripts/geo-submit.js', import.meta.url));
const tag = suffix()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');
const DB = `s3a_rev_${tag}`.slice(0, 40);
const KEYS = /** @type {const} */ (['revA', 'revB', 'revC', 'app1', 'app2']);
/** @type {Record<string, 'reviewer' | 'approver'>} */
const KIND = {
  revA: 'reviewer',
  revB: 'reviewer',
  revC: 'reviewer',
  app1: 'approver',
  app2: 'approver',
};

describeIntegration(
  'Stage 3c review workflow (disposable server, own database, synthetic people)',
  () => {
    /** @type {Awaited<ReturnType<typeof createGeoDatabase>>} */ let db;
    /** @type {Record<string, pg.Pool>} */ const pools = {};
    /** @type {Record<string, string>} */ const names = {};
    /** @type {Awaited<ReturnType<typeof createLogins>> | undefined} */ let readerLogin;
    /** @type {pg.Pool} */ let reader;
    let pilot = /** @type {any[]} */ ([]);
    let spare = /** @type {any} */ (null);
    let allProposals = /** @type {any[]} */ ([]);
    /** @type {Record<string, string>} */ const urls = {};
    const admin = async (work) => {
      const c = await db.adminDb.connect();
      try {
        return await work(c);
      } finally {
        c.release();
      }
    };

    beforeAll(async () => {
      await assertDisposable();
      db = await createGeoDatabase({
        adminUrl: await guardedUrl('DATABASE_ADMIN_URL'),
        migrationUrl: await guardedUrl('DATABASE_MIGRATION_URL'),
        database: DB,
        world: pilotWorld(),
      });
      await grantIdentityPrivileges(db.ownerUrl);
      for (const key of KEYS) {
        const made = await admin((c) =>
          provisionReviewLogin(c, {
            person: `${key.toLowerCase()}${tag}`.slice(0, 25),
            kind: KIND[key],
            validUntil: new Date(Date.now() + 7 * 86_400_000),
          }),
        );
        names[key] = made.role;
        urls[key] = urlFor(db.ownerUrl, made.role, made.password);
        pools[key] = new pg.Pool({
          connectionString: urlFor(db.ownerUrl, made.role, made.password),
          max: 3,
        });
        pools[key].on('error', () => undefined); // idle sessions of a revoked login are terminated by design
      }
      readerLogin = await createLogins(db.adminDb, tag, { reader: null });
      await db.adminDb.query(
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${readerLogin.logins.reader.name}`,
      );
      reader = readerLogin.poolFor(db.ownerUrl, 'reader');
      reader.on('error', () => undefined);
      const client = await db.owner.connect();
      try {
        allProposals = buildProposals(analyse(await readSnapshot(client)));
        const chosen = selectPilot(allProposals);
        pilot = chosen.selected;
        spare = allProposals.find((p) => p.sourceKey === chosen.eligibleNotSelected[0]);
      } finally {
        client.release();
      }
    }, 180_000);

    afterAll(async () => {
      for (const p of Object.values(pools)) await p.end().catch(() => undefined);
      await reader?.end().catch(() => undefined);
      await readerLogin?.drop().catch(() => undefined);
      if (db) await admin((c) => revokeAllReviewLogins(c)).catch(() => undefined);
      await db?.drop().catch(() => undefined);
    });

    it('names logins from the person and the group, and refuses anything else', () => {
      expect(loginName('alice', 'reviewer')).toBe('fasalytics_rv_alice');
      expect(loginName('bob2', 'approver')).toBe('fasalytics_ap_bob2');
      for (const bad of ['', 'A', 'Alice', '1abc', 'a b', 'a;drop', 'x'.repeat(26), 'al-ice'])
        expect(() => loginName(bad, 'reviewer'), bad).toThrow();
      expect(() => loginName('alice', /** @type {any} */ ('admin'))).toThrow();
    });

    it('provisions personal logins that conform to the access design: one group, no SET ROLE, no write, expiring', async () => {
      for (const key of KEYS) {
        const c = await pools[key].connect();
        try {
          expect(await reviewLoginProblems(/** @type {any} */ (c)), key).toEqual([]);
          for (const sql of [
            'SET ROLE fasalytics_reviewer',
            'SET ROLE fasalytics_approver',
            'CREATE TABLE s3a_x (id int)',
            'CREATE ROLE s3a_escalated',
            'GRANT fasalytics_approver TO CURRENT_USER',
            "INSERT INTO identity_decision (decision_kind) VALUES ('map_label')",
            'UPDATE identity_review_event SET note = $$x$$',
            'DELETE FROM markets',
            'TRUNCATE mandi_observations',
          ]) {
            let code = 'ALLOWED';
            try {
              await c.query(sql);
            } catch (error) {
              code = /** @type {any} */ (error).code;
            }
            expect(code, `${key}: ${sql}`).toBe('42501');
          }
        } finally {
          c.release();
        }
      }
      const listed = await admin((c) => listReviewLogins(c));
      const own = new Set(Object.values(names));
      const mine = listed.filter((l) => own.has(l.role));
      expect(mine.map((l) => l.role).sort()).toEqual(Object.values(names).sort());
      for (const l of mine) {
        expect(l).toMatchObject({
          can_login: true,
          connection_limit: 2,
          inherit_option: true,
          set_option: false,
        });
        expect(Date.parse(l.valid_until)).toBeGreaterThan(Date.now());
      }
    });

    it('refuses a second login for the same person, an over-long life, and a missing group', async () => {
      await admin(async (c) => {
        const person = `revA${tag}`.toLowerCase().slice(0, 25);
        await expect(
          provisionReviewLogin(c, {
            person,
            kind: 'approver',
            validUntil: new Date(Date.now() + 86_400_000),
          }),
        ).rejects.toThrow(/one person has one login/);
        await expect(
          provisionReviewLogin(c, {
            person: `new${tag}`.slice(0, 25),
            kind: 'reviewer',
            validUntil: new Date(Date.now() + 200 * 86_400_000),
          }),
        ).rejects.toThrow(/at most 90 days/);
        await expect(
          provisionReviewLogin(c, {
            person: `old${tag}`.slice(0, 25),
            kind: 'reviewer',
            validUntil: new Date(Date.now() - 1000),
          }),
        ).rejects.toThrow(/at most 90 days/);
      });
    });

    it('selects a pilot of five low-risk proposals from the synthetic geography', () => {
      expect(pilot).toHaveLength(5);
      for (const p of pilot)
        expect(p).toMatchObject({
          evidenceClass: 'exact_official_name',
          decisionKind: 'map_label',
          decisionClass: 'S',
          requiresTwoReviewers: false,
        });
    });

    it('submits a chosen pilot item from the command line as a reviewer: dry run first, then once, never twice, and refuses what is not pilot-grade', async () => {
      const run = (args, env = {}) =>
        spawnSync(process.execPath, [SUBMIT, ...args], {
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            DATABASE_URL: urlFor(
              db.ownerUrl,
              readerLogin?.logins.reader.name ?? '',
              readerLogin?.logins.reader.password ?? '',
            ),
            ...env,
          },
          encoding: 'utf8',
          timeout: 120_000,
        });
      const count = async () =>
        (
          await db.owner.query(
            "SELECT count(*)::int AS n FROM identity_decision WHERE evidence->>'proposalKey' = $1",
            [spare.proposalKey],
          )
        ).rows[0].n;
      const dry = run(['--keys', spare.proposalKey]);
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toMatch(/would submit/);
      expect(dry.stdout).toMatch(/dry run: nothing was written/);
      expect(await count()).toBe(0);
      const done = run(['--keys', spare.proposalKey, '--execute'], {
        DATABASE_REVIEW_URL: urls.revA,
      });
      expect(done.status, done.stderr).toBe(0);
      expect(done.stdout).toMatch(new RegExp(`submitting as ${names.revA}`));
      expect(done.stdout).toMatch(/submitted/);
      expect(await count()).toBe(1);
      const again = run(['--keys', spare.proposalKey, '--execute'], {
        DATABASE_REVIEW_URL: urls.revC,
      });
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toMatch(/already_proposed/);
      expect(await count()).toBe(1);
      // what it refuses
      const rename = allProposals.find((p) => p.evidenceClass === 'documented_rename');
      const ambiguous = allProposals.find((p) => p.evidenceClass === 'ambiguous');
      for (const key of [rename.proposalKey, ambiguous.proposalKey]) {
        const r = run(['--keys', key]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/is not a pilot item/);
      }
      expect(run(['--keys', 'does-not-exist']).stderr).toMatch(/no proposal has the key/);
      expect(run([]).stderr).toMatch(/--keys is required/);
      expect(run(['--keys', 'a,b,c,d,e,f']).stderr).toMatch(/at most 5/);
      expect(run(['--keys', `${spare.proposalKey},${spare.proposalKey}`]).stderr).toMatch(
        /listed twice/,
      );
      const asApprover = run(['--keys', pilot[0].proposalKey, '--execute'], {
        DATABASE_REVIEW_URL: urls.app1,
      });
      expect(asApprover.status).toBe(1);
      expect(asApprover.stderr).toMatch(/must be a reviewer login/);
      const asOwner = run(['--keys', pilot[0].proposalKey], { DATABASE_URL: db.ownerUrl });
      expect(asOwner.status).toBe(1);
      expect(asOwner.stderr).toMatch(/more than read access/);
      expect(
        (await db.owner.query('SELECT count(*)::int AS n FROM identity_decision')).rows[0].n,
      ).toBe(1); // nothing else was written
    }, 180_000);

    it('rehearses the complete workflow: propose, review, approve, reject, defer, duplicate, supersede, reverse, concurrency, privileges, audit and read-only interpretation', async () => {
      const result = await runRehearsal({
        owner: db.owner,
        pools: /** @type {any} */ (pools),
        reader,
        names: /** @type {any} */ (names),
        proposals: pilot,
        tag,
      });
      const failed = result.checks.filter((c) => !c.ok);
      expect(failed, JSON.stringify(failed)).toEqual([]);
      expect(result.checks.length).toBeGreaterThanOrEqual(30);
      expect(result.summary.otherTablesChanged).toEqual([]);
    }, 180_000);

    it('ends a person’s access at once, keeps their name in the audit log, and revokes everyone in an emergency', async () => {
      // Revocation terminates sessions on purpose. Close every pooled login connection FIRST, so that no pooled
      // client (idle or checked out) is left to receive the termination and raise an unhandled error.
      await Promise.all(Object.values(pools).map((p) => p.end().catch(() => undefined)));
      // The one session that must be seen terminated is a standalone client with its own error handler.
      const held = new pg.Client({ connectionString: urls.revB });
      held.on('error', () => undefined); // the session is terminated on purpose: its error must reach this handler
      await held.connect();
      await held.query('SELECT 1');
      const before = (
        await db.owner.query(
          'SELECT count(*)::int AS n FROM identity_review_event WHERE actor = $1',
          [names.revB],
        )
      ).rows[0].n;
      expect(before).toBeGreaterThan(0);
      await admin((c) => revokeReviewLogin(c, names.revB));
      await expect(held.query('SELECT 1')).rejects.toBeDefined(); // the session was terminated
      await held.end().catch(() => undefined);
      expect(
        (
          await db.owner.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1', [
            names.revB,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.owner.query(
            'SELECT count(*)::int AS n FROM identity_review_event WHERE actor = $1',
            [names.revB],
          )
        ).rows[0].n,
      ).toBe(before);
      const gone = new pg.Pool({ connectionString: urlFor(db.ownerUrl, names.revB, 'x'), max: 1 });
      gone.on('error', () => undefined);
      await expect(gone.query('SELECT 1')).rejects.toBeDefined();
      await gone.end().catch(() => undefined);
      const done = await admin((c) => revokeAllReviewLogins(c));
      // the emergency switch removes every review login of the cluster, this test's included
      expect(done.filter((n) => Object.values(names).includes(n)).sort()).toEqual(
        Object.values(names)
          .filter((n) => n !== names.revB)
          .sort(),
      );
      expect(await admin((c) => listReviewLogins(c))).toEqual([]);
      // the decisions and their audit trail outlive the logins
      expect(
        (await db.owner.query('SELECT count(*)::int AS n FROM identity_decision')).rows[0].n,
      ).toBeGreaterThanOrEqual(7);
    });
  },
  Boolean(process.env.DATABASE_ADMIN_URL),
);
