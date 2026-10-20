import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../migrate.js';
import { describeIntegration } from '../../test/db.js';
import { assertDisposable, guardedUrl } from '../../test/disposable.js';
import { makeDirectory } from '../../test/lgdFixtures.js';
import { suffix } from '../../test/fixtures.js';
import { urlFor } from '../../test/roles.js';
import { retractReferenceSet } from '../lgdLoad.js';
import { buildLgdPlan } from '../lgdPlan.js';
import { buildAuthorization, confirmationPhrase } from './authorization.js';
import { RESTORE_EVIDENCE_FORMAT, runControlledLoad, sha256File } from './controlled.js';
import { fingerprintDigest, tableFingerprint } from './fingerprint.js';
import { ownerOnlyProblem, restrictToOwner } from './secureFile.js';
import { provisionLoaderRole, revokeLoaderRole } from './loaderRole.js';

/**
 * The controlled development LGD reference loader (Milestone 2.4) against a verified DISPOSABLE PostgreSQL
 * server, in a database created for this suite (so that stable-count and fingerprint assertions are not
 * disturbed by the other suites, which share the main disposable database). SYNTHETIC source files and a
 * synthetic "backup"; a dedicated loader login that is created and dropped here. Nothing touches the
 * development database: the loader command line reads no .env file and every URL here comes from the disposable
 * environment.
 */

const tag = suffix()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');
const DB = `s3a_ctl_${tag}`.slice(0, 40);
const SCRIPT = fileURLToPath(
  new URL('../../../scripts/load-lgd-reference-dev.js', import.meta.url),
);

describeIntegration(
  'controlled development loader (disposable server, own database, synthetic sources)',
  () => {
    /** @type {pg.Pool} */ let admin;
    /** @type {pg.Pool} */ let owner;
    /** @type {string} */ let ownerUrl;
    /** @type {string} */ let adminDbUrl;
    /** @type {string} */ let work;
    /** @type {{ role: string, url: string }} */ let loader;
    /** @type {string[]} */ const extraRoles = [];
    let counter = 0;

    const rows = async (pool, text, values = []) => (await pool.query(text, values)).rows;
    const dbUrl = (base, database) => {
      const url = new URL(base);
      url.pathname = `/${database}`;
      return url.toString();
    };
    const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

    const loaderClient = async (url = loader.url) => {
      const c = new pg.Client({ connectionString: url });
      c.on('error', () => undefined);
      await c.connect();
      return c;
    };

    /**
     * Builds all the material of one authorized load in its own folder and returns what the tests need.
     * `tweak` can change the pieces before the authorization is sealed.
     */
    async function scenario(tweak = {}) {
      counter += 1;
      const dir = join(work, `s${counter}`);
      mkdirSync(dir, { recursive: true });
      const referenceDir = makeDirectory();
      const backupPath = join(dir, 'backup.dump');
      writeFileSync(backupPath, randomBytes(2048));
      const client = await loaderClient();
      let baseline;
      let live;
      try {
        await client.query('BEGIN READ ONLY');
        baseline = await tableFingerprint(client);
        await client.query('ROLLBACK');
        live = (
          await client.query(
            `SELECT (SELECT system_identifier::text FROM pg_control_system()) AS sid,
                    (SELECT array_agg(id || ':' || left(hash, 12) ORDER BY id) FROM drizzle.__drizzle_migrations) AS migrations`,
          )
        ).rows[0];
      } finally {
        await client.end();
      }
      const fingerprintPath = join(dir, 'fingerprint.json');
      writeFileSync(fingerprintPath, JSON.stringify(baseline));
      const evidencePath = join(dir, 'restore-evidence.json');
      writeFileSync(
        evidencePath,
        JSON.stringify({
          format: RESTORE_EVIDENCE_FORMAT,
          backupSha256: await sha256File(backupPath),
          fingerprintDigest: fingerprintDigest(baseline),
          fingerprintMatchedSource: true,
          restoreTargetWasDisposable: true,
          restoredAt: new Date().toISOString(),
          ...(tweak.evidence ?? {}),
        }),
      );
      const plan = buildLgdPlan(referenceDir);
      const units = plan.sets.reduce((n, s) => n + s.units.length, 0);
      const url = new URL(loader.url);
      const doc = buildAuthorization({
        approvedBy: 'Synthetic Approver',
        issuedAt: tweak.issuedAt ?? new Date(),
        validHours: tweak.validHours ?? 12,
        loaderRole: loader.role,
        target: {
          host: url.hostname,
          port: Number(url.port),
          database: DB,
          systemIdentifier: live.sid,
          migrations: live.migrations,
          ...(tweak.target ?? {}),
        },
        plan: {
          totalSets: plan.sets.length,
          totalUnits: units,
          sets: plan.sets.map((s) => ({
            code: s.code,
            fileSha256: s.fileSha256,
            units: s.units.length,
          })),
          ...(tweak.plan ?? {}),
        },
        backup: {
          path: backupPath,
          sha256: await sha256File(backupPath),
          sizeBytes: 2048,
          restoreEvidence: { path: evidencePath, sha256: await sha256File(evidencePath) },
        },
        fingerprint: {
          path: fingerprintPath,
          fileSha256: await sha256File(fingerprintPath),
          digest: fingerprintDigest(baseline),
        },
      });
      const authorizationPath = join(dir, 'authorization.json');
      writeFileSync(authorizationPath, JSON.stringify(doc), { mode: 0o600 });
      restrictToOwner(authorizationPath);
      return {
        dir,
        doc,
        plan,
        units,
        referenceDir,
        backupPath,
        evidencePath,
        fingerprintPath,
        authorizationPath,
        statePath: `${authorizationPath}.state`,
        reportPath: `${authorizationPath}.report.json`,
        baseline,
      };
    }

    const run = (s, over = {}) =>
      runControlledLoad({
        authorizationPath: s.authorizationPath,
        referenceDir: s.referenceDir,
        loaderUrl: loader.url,
        mode: 'execute',
        interactive: true,
        confirm: async (phrase) => phrase,
        approvedTotals: { sets: s.plan.sets.length, units: s.units },
        ...over,
      });
    const refused = async (promise) => {
      try {
        await promise;
      } catch (error) {
        return /** @type {any} */ (error).code ?? String(error);
      }
      return 'NOT REFUSED';
    };
    const referenceRows = async () =>
      (
        await rows(
          owner,
          `SELECT (SELECT count(*) FROM geo_reference_set)::int AS s, (SELECT count(*) FROM admin_unit_version)::int AS u`,
        )
      )[0];

    beforeAll(async () => {
      await assertDisposable();
      const base = await guardedUrl('DATABASE_ADMIN_URL');
      const migrationBase = await guardedUrl('DATABASE_MIGRATION_URL');
      admin = new pg.Pool({ connectionString: base, max: 2 });
      const migrator = new URL(migrationBase).username;
      await admin.query(`CREATE DATABASE ${DB} OWNER ${migrator}`);
      await admin.query(
        `ALTER DATABASE ${DB} SET fasalytics.disposable_token = '${process.env.FASALYTICS_DISPOSABLE_TOKEN}'`,
      );
      ownerUrl = dbUrl(migrationBase, DB);
      adminDbUrl = dbUrl(base, DB);
      await runMigrations(ownerUrl);
      owner = new pg.Pool({ connectionString: ownerUrl, max: 3 });
      const seed = await owner.query(`SELECT 1 FROM drizzle.__drizzle_migrations LIMIT 1`);
      expect(seed.rowCount).toBeGreaterThan(0);
      // a little registry content so that the fingerprint means something
      await owner.query(
        `INSERT INTO states (name, kind, lgd_code) VALUES ('Controlled Test State', 'state', '990001')`,
      );
      work = mkdtempSync(join(tmpdir(), 'lgd-controlled-'));
      const client = new pg.Client({ connectionString: adminDbUrl });
      await client.connect();
      try {
        const made = await provisionLoaderRole(client, {
          role: `s3a_loader_${tag}`.slice(0, 40),
          validUntil: new Date(Date.now() + 3_600_000),
        });
        loader = { role: made.role, url: urlFor(ownerUrl, made.role, made.password) };
      } finally {
        await client.end();
      }
    }, 120_000);

    afterEach(async () => {
      // every test starts from an empty reference area, whatever the previous one did
      const sets = await rows(owner, 'SELECT code FROM geo_reference_set');
      for (const { code } of sets) await retractReferenceSet(owner, code);
    });

    afterAll(async () => {
      await owner?.end();
      const client = new pg.Client({ connectionString: adminDbUrl });
      try {
        await client.connect();
        for (const role of [loader?.role, ...extraRoles].filter(Boolean))
          await revokeLoaderRole(client, { role });
      } catch {
        /* the database is dropped below anyway */
      } finally {
        await client.end().catch(() => undefined);
      }
      await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      for (const role of [loader?.role, ...extraRoles].filter(Boolean))
        await admin?.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
      await admin?.end();
      if (work) rmSync(work, { recursive: true, force: true });
    });

    describe('the authorized load', () => {
      it('verify mode runs every check and writes nothing, and does not consume the authorization', async () => {
        const s = await scenario();
        const result = await run(s, { mode: 'verify' });
        expect(result.status).toBe('verified');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
        expect(existsSync(s.statePath)).toBe(false);
      });

      it('loads all four sets in one transaction, verifies them, reports, and consumes the authorization', async () => {
        const s = await scenario();
        const before = await owner.query(`SELECT count(*)::int AS n FROM states`);
        const result = await run(s);
        expect(result).toMatchObject({ status: 'committed', sets: 4, totalUnits: s.units });
        expect(await referenceRows()).toEqual({ s: 4, u: s.units });
        const report = JSON.parse(readFileSync(s.reportPath, 'utf8'));
        expect(report).toMatchObject({ status: 'committed', problems: [] });
        expect(JSON.parse(readFileSync(s.statePath, 'utf8')).status).toBe('committed');
        // nothing else changed: identity tables empty, registry as it was
        expect(
          (
            await rows(
              owner,
              `SELECT (SELECT count(*) FROM identity_decision)::int + (SELECT count(*) FROM mapping_set)::int + (SELECT count(*) FROM identity_review_event)::int AS n`,
            )
          )[0].n,
        ).toBe(0);
        expect((await owner.query(`SELECT count(*)::int AS n FROM states`)).rows[0].n).toBe(
          before.rows[0].n,
        );
        // the same authorization cannot be used again
        expect(await refused(run(s))).toBe('reused');
      }, 120_000);

      it('refuses a repeated execution with a fresh authorization because the reference area is no longer empty', async () => {
        const first = await scenario();
        await run(first);
        const second = await scenario();
        expect(await refused(run(second))).toBe('precondition');
        expect(await referenceRows()).toEqual({ s: 4, u: first.units });
        expect(existsSync(second.statePath)).toBe(false);
      }, 120_000);
    });

    describe('missing, expired and reused authorizations', () => {
      it('refuses a missing authorization document', async () => {
        const s = await scenario();
        rmSync(s.authorizationPath);
        expect(await refused(run(s))).toBe('missing-authorization');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
      });

      it('refuses an expired authorization and one valid for more than 24 hours', async () => {
        const expired = await scenario({
          issuedAt: new Date(Date.now() - 13 * 3_600_000),
          validHours: 12,
        });
        expect(await refused(run(expired))).toBe('expired');
        const tooLong = await scenario({ validHours: 30 });
        expect(await refused(run(tooLong))).toBe('lifetime');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
      });

      it('refuses an authorization that was edited, and one that was already used (state file)', async () => {
        const s = await scenario();
        const doc = JSON.parse(readFileSync(s.authorizationPath, 'utf8'));
        doc.approvedBy = 'Someone Else';
        writeFileSync(s.authorizationPath, JSON.stringify(doc), { mode: 0o600 });
        expect(await refused(run(s))).toBe('integrity');
        const used = await scenario();
        writeFileSync(used.statePath, JSON.stringify({ status: 'committed' }));
        expect(await refused(run(used))).toBe('reused');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
      });
    });

    describe('file protection', () => {
      it('refuses an authorization that other local users can read, and accepts it once it is owner-only', async () => {
        const s = await scenario();
        expect(ownerOnlyProblem(s.authorizationPath)).toBeNull();
        if (process.platform === 'win32')
          execFileSync('icacls', [s.authorizationPath, '/grant', 'BUILTIN\\Users:(R)'], {
            stdio: 'ignore',
          });
        else chmodSync(s.authorizationPath, 0o644);
        expect(ownerOnlyProblem(s.authorizationPath)).not.toBeNull();
        expect(await refused(run(s, { mode: 'verify' }))).toBe('permissions');
        restrictToOwner(s.authorizationPath);
        expect(ownerOnlyProblem(s.authorizationPath)).toBeNull();
        expect((await run(s, { mode: 'verify' })).status).toBe('verified');
        expect(existsSync(s.statePath)).toBe(false);
      });
    });

    describe('target identity', () => {
      it('refuses a wrong database name, system identifier, port, migration journal and login', async () => {
        const cases = [
          [{ target: { database: 'fasalytics' } }, 'wrong-database'],
          [{ target: { systemIdentifier: '1234567890123456789' } }, 'wrong-system-identifier'],
          [{ target: { port: 6 } }, 'wrong-target'],
          [{ target: { host: 'localhost' } }, 'wrong-target'],
          [{ target: { migrations: ['1:000000000000'] } }, 'wrong-migrations'],
        ];
        for (const [tweak, code] of cases) {
          const s = await scenario(tweak);
          expect(await refused(run(s)), JSON.stringify(tweak)).toBe(code);
        }
        const wrongLogin = await scenario();
        const doc = JSON.parse(readFileSync(wrongLogin.authorizationPath, 'utf8'));
        const other = buildAuthorization({
          ...doc,
          issuedAt: new Date(),
          validHours: 12,
          loaderRole: 'someone_else',
        });
        writeFileSync(wrongLogin.authorizationPath, JSON.stringify(other), { mode: 0o600 });
        expect(await refused(run(wrongLogin))).toBe('wrong-login');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
      });

      it('refuses a production (non-local) target before any connection is made', async () => {
        const s = await scenario();
        const remote = new URL(loader.url);
        remote.hostname = '203.0.113.7';
        expect(await refused(run(s, { loaderUrl: remote.toString() }))).toBe('production-target');
        remote.hostname = 'db.example.com';
        expect(await refused(run(s, { loaderUrl: remote.toString() }))).toBe('production-target');
        expect(existsSync(s.statePath)).toBe(false);
      });
    });

    describe('fingerprint, backup, sources and counts', () => {
      it('refuses a database that differs from the approved fingerprint, and leaves no rows', async () => {
        const s = await scenario();
        await owner.query(
          `INSERT INTO states (name, kind, lgd_code) VALUES ('Drift State', 'state', '990002')`,
        );
        try {
          expect(await refused(run(s))).toBe('precondition');
          expect(await referenceRows()).toEqual({ s: 0, u: 0 });
          expect(existsSync(s.statePath)).toBe(false);
        } finally {
          await owner.query(`DELETE FROM states WHERE lgd_code = '990002'`);
        }
      });

      it('refuses a wrong or changed backup, a stale backup and bad restore evidence', async () => {
        const changed = await scenario();
        writeFileSync(changed.backupPath, randomBytes(2048));
        expect(await refused(run(changed))).toBe('backup-checksum');
        const missing = await scenario();
        rmSync(missing.backupPath);
        expect(await refused(run(missing))).toBe('backup-missing');
        const stale = await scenario();
        const old = new Date(Date.now() - 3 * 86_400_000);
        utimesSync(stale.backupPath, old, old);
        expect(await refused(run(stale))).toBe('backup-stale');
        const unmatched = await scenario({ evidence: { fingerprintMatchedSource: false } });
        expect(await refused(run(unmatched))).toBe('restore-evidence');
        const otherBackup = await scenario({ evidence: { backupSha256: sha('another') } });
        expect(await refused(run(otherBackup))).toBe('restore-evidence');
        const tampered = await scenario();
        writeFileSync(tampered.evidencePath, '{}');
        expect(await refused(run(tampered))).toBe('restore-evidence');
        const fp = await scenario();
        writeFileSync(fp.fingerprintPath, JSON.stringify({ states: { rows: 9, hash: '1' } }));
        expect(await refused(run(fp))).toBe('fingerprint');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
      });

      it('refuses changed source files and wrong counts', async () => {
        const changed = await scenario();
        const page = join(
          changed.referenceDir,
          'raw',
          'lgd',
          'district_pages',
          'district_990101_history.html',
        );
        writeFileSync(page, readFileSync(page, 'utf8').replace('Old Name', 'Another Name'));
        expect(await refused(run(changed))).toBe('source-changed');
        const counts = await scenario({
          plan: { totalUnits: 9999 },
        });
        expect(await refused(run(counts))).toBe('plan');
        // the reviewed constant applies when no test parameter is given: synthetic data is not 2,899 rows
        const constant = await scenario();
        expect(await refused(run(constant, { approvedTotals: undefined }))).toBe('plan');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
      });
    });

    describe('the loader login', () => {
      /** Provisions an extra login, lets `adjust` change it, and returns its URL. */
      async function extraLogin(name, adjust) {
        const role = `s3a_${name}_${tag}`.slice(0, 40);
        extraRoles.push(role);
        const client = new pg.Client({ connectionString: adminDbUrl });
        await client.connect();
        try {
          const made = await provisionLoaderRole(client, {
            role,
            validUntil: new Date(Date.now() + 3_600_000),
          });
          await adjust(client, role);
          return { role, url: urlFor(ownerUrl, role, made.password) };
        } finally {
          await client.end();
        }
      }

      it('refuses a login that lacks INSERT on a reference table', async () => {
        const weak = await extraLogin('noinsert', (c, r) =>
          c.query(`REVOKE INSERT ON public.admin_unit_version FROM ${r}`),
        );
        const s = await scenario();
        const doc = JSON.parse(readFileSync(s.authorizationPath, 'utf8'));
        writeFileSync(
          s.authorizationPath,
          JSON.stringify(
            buildAuthorization({
              ...doc,
              issuedAt: new Date(),
              validHours: 12,
              loaderRole: weak.role,
            }),
          ),
          { mode: 0o600 },
        );
        expect(await refused(run(s, { loaderUrl: weak.url }))).toBe('loader-privileges');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
      });

      it('refuses a login with any excess privilege', async () => {
        const grants = [
          'GRANT UPDATE ON public.geo_reference_set TO %r',
          'GRANT DELETE ON public.admin_unit_version TO %r',
          'GRANT INSERT ON public.mandi_observations TO %r',
          'GRANT INSERT ON public.mapping_set TO %r',
          'GRANT TRUNCATE ON public.markets TO %r',
          'GRANT EXECUTE ON FUNCTION public.mapping_set_create(text, text) TO %r',
          'GRANT fasalytics_approver TO %r',
          'ALTER ROLE %r CREATEROLE',
          'GRANT CREATE ON SCHEMA public TO %r',
        ];
        for (const [index, sql] of grants.entries()) {
          const excess = await extraLogin(`ex${index}`, (c, r) => c.query(sql.replaceAll('%r', r)));
          const s = await scenario();
          const doc = JSON.parse(readFileSync(s.authorizationPath, 'utf8'));
          writeFileSync(
            s.authorizationPath,
            JSON.stringify(
              buildAuthorization({
                ...doc,
                issuedAt: new Date(),
                validHours: 12,
                loaderRole: excess.role,
              }),
            ),
            { mode: 0o600 },
          );
          expect(await refused(run(s, { loaderUrl: excess.url })), sql).toBe('loader-privileges');
        }
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
      }, 120_000);

      it('cannot update or delete reference rows, write decisions or mappings, change observations, or manage roles', async () => {
        const c = await loaderClient();
        try {
          const attempts = [
            `UPDATE geo_reference_set SET notes = 'x'`,
            `DELETE FROM admin_unit_version`,
            `TRUNCATE geo_reference_set`,
            `INSERT INTO mapping_set (code, created_by) VALUES ('x', 'x')`,
            `INSERT INTO identity_decision (decision_kind) VALUES ('map_label')`,
            `INSERT INTO identity_review_event (event_type, actor, actor_role) VALUES ('proposed', 'x', 'reviewer')`,
            `SELECT public.mapping_set_create('x')`,
            `INSERT INTO mandi_observations (market_id) VALUES (NULL)`,
            `UPDATE mandi_observations SET modal_price = 0`,
            `DELETE FROM state_observations`,
            `UPDATE markets SET name = name`,
            `UPDATE states SET name = name`,
            `CREATE ROLE s3a_x_${tag}`,
            `ALTER ROLE ${loader.role} SUPERUSER`,
            `CREATE TABLE s3a_x (id int)`,
          ];
          for (const sql of attempts) {
            let code = 'ALLOWED';
            try {
              await c.query('BEGIN');
              await c.query(sql);
            } catch (error) {
              code = /** @type {any} */ (error).code;
            } finally {
              await c.query('ROLLBACK');
            }
            expect(code, sql).toBe('42501');
          }
        } finally {
          await c.end();
        }
      });
    });

    describe('operator confirmation', () => {
      it('refuses a non-interactive run and a wrong confirmation, without consuming the authorization', async () => {
        const s = await scenario();
        expect(await refused(run(s, { interactive: false }))).toBe('noninteractive');
        expect(await refused(run(s, { confirm: undefined }))).toBe('noninteractive');
        expect(await refused(run(s, { confirm: async () => 'yes' }))).toBe('confirmation');
        expect(
          await refused(run(s, { confirm: async () => confirmationPhrase(s.doc).toLowerCase() })),
        ).toBe('confirmation');
        expect(existsSync(s.statePath)).toBe(false);
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
        // the typed phrase names the database and the operation
        let asked = '';
        await run(s, {
          confirm: async (phrase) => {
            asked = phrase;
            return phrase;
          },
        });
        expect(asked).toBe(`LOAD LGD REFERENCE INTO ${DB} ${s.doc.target.systemIdentifier}`);
      }, 120_000);

      it('refuses on the command line when no terminal is attached', async () => {
        const s = await scenario();
        const result = spawnSync(
          process.execPath,
          [
            SCRIPT,
            'execute',
            '--authorization',
            s.authorizationPath,
            '--reference-dir',
            s.referenceDir,
          ],
          {
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              DATABASE_REF_LOADER_URL: loader.url,
            },
            encoding: 'utf8',
            timeout: 60_000,
          },
        );
        // the pinned totals (4 sets, 2,899 rows) are not those of the synthetic data: refused before anything else
        expect(result.status).toBe(1);
        expect(`${result.stderr}`).toMatch(/REFUSED \[(plan|noninteractive)\]/);
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
        expect(existsSync(s.statePath)).toBe(false);
      });
    });

    describe('failure and interruption', () => {
      it('rolls everything back when the transaction fails after the inserts, and burns the authorization', async () => {
        const s = await scenario();
        const code = await refused(
          run(s, {
            hooks: {
              afterInsert: async (client) => {
                const inside = await client.query(
                  'SELECT (SELECT count(*) FROM geo_reference_set)::int AS s, (SELECT count(*) FROM admin_unit_version)::int AS u',
                );
                expect(inside.rows[0]).toEqual({ s: 4, u: s.units });
                throw new Error('injected failure');
              },
            },
          }),
        );
        expect(code).toMatch(/injected failure/);
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
        expect(JSON.parse(readFileSync(s.statePath, 'utf8')).status).toBe('rolled-back');
        expect(await refused(run(s))).toBe('reused');
      }, 120_000);

      it('rolls back when the connection is killed in the middle of the transaction', async () => {
        const s = await scenario();
        const outcome = await refused(
          run(s, {
            hooks: {
              afterInsert: async () => {
                await admin.query(
                  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND datname = $2 AND pid <> pg_backend_pid()`,
                  [loader.role, DB],
                );
                await new Promise((r) => setTimeout(r, 300));
              },
            },
          }),
        );
        expect(outcome).not.toBe('NOT REFUSED');
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
        expect(existsSync(s.reportPath)).toBe(false);
      }, 120_000);

      it('retraction removes a committed load and leaves the rest of the database as it was', async () => {
        const s = await scenario();
        await run(s);
        for (const { code } of await rows(owner, 'SELECT code FROM geo_reference_set'))
          await retractReferenceSet(owner, code);
        expect(await referenceRows()).toEqual({ s: 0, u: 0 });
        const c = await loaderClient();
        try {
          await c.query('BEGIN READ ONLY');
          const after = await tableFingerprint(c);
          await c.query('ROLLBACK');
          expect(fingerprintDigest(after)).toBe(fingerprintDigest(s.baseline));
        } finally {
          await c.end();
        }
      }, 120_000);
    });
  },
  Boolean(process.env.DATABASE_ADMIN_URL),
);
